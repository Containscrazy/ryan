import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Setup Express
const app = express();
const port = process.env.PORT || 3000;

// Get directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
});

// Serve static files
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Store transcription jobs
const transcriptionJobs = {};

// AssemblyAI API key - make sure it's properly formatted
const ASSEMBLY_API_KEY = process.env.ASSEMBLY_API_KEY;

// Verify API key is present
if (!ASSEMBLY_API_KEY) {
  console.error("ERROR: ASSEMBLY_API_KEY environment variable is not set");
}

// Upload endpoint
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    const filePath = req.file.path;

    // Upload to AssemblyAI
    console.log("Uploading to AssemblyAI...");
    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      body: fs.createReadStream(filePath),
      headers: {
        Authorization: `${ASSEMBLY_API_KEY}`, // Make sure there's no "Bearer " prefix
      },
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("Upload error response:", errorText);
      throw new Error(`Upload failed with status: ${uploadResponse.status}`);
    }

    const uploadData = await uploadResponse.json();
    const audioUrl = uploadData.upload_url;

    // Start transcription with speaker diarization
    console.log("Starting transcription...");
    const transcriptionResponse = await fetch(
      "https://api.assemblyai.com/v2/transcript",
      {
        method: "POST",
        headers: {
          Authorization: `${ASSEMBLY_API_KEY}`, // Make sure there's no "Bearer " prefix
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audio_url: audioUrl,
          speaker_labels: true,
          speakers_expected: 2, // You can adjust this or make it dynamic
        }),
      }
    );

    if (!transcriptionResponse.ok) {
      const errorText = await transcriptionResponse.text();
      console.error("Transcription error response:", errorText);
      throw new Error(
        `Transcription request failed with status: ${transcriptionResponse.status}`
      );
    }

    const transcriptionData = await transcriptionResponse.json();
    const transcriptionId = transcriptionData.id;

    // Store job info
    transcriptionJobs[transcriptionId] = {
      status: "queued",
      filePath: filePath,
      created: new Date(),
    };

    // Return the transcription ID to the client
    res.json({ transcriptionId });

    // Clean up old files periodically
    cleanupOldFiles();
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Status endpoint
app.get("/status/:id", async (req, res) => {
  try {
    const transcriptionId = req.params.id;

    if (!transcriptionJobs[transcriptionId]) {
      return res.status(404).json({ error: "Transcription job not found" });
    }

    // Check status with AssemblyAI
    const statusResponse = await fetch(
      `https://api.assemblyai.com/v2/transcript/${transcriptionId}`,
      {
        headers: {
          Authorization: `${ASSEMBLY_API_KEY}`, // Make sure there's no "Bearer " prefix
        },
      }
    );

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error("Status check error response:", errorText);
      throw new Error(
        `Status check failed with status: ${statusResponse.status}`
      );
    }

    const statusData = await statusResponse.json();

    // Update our local status
    transcriptionJobs[transcriptionId].status = statusData.status;

    if (statusData.status === "error") {
      transcriptionJobs[transcriptionId].error = statusData.error;
    }

    // Return status to client
    res.json({ status: statusData.status, error: statusData.error });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Transcript endpoint
app.get("/transcript/:id", async (req, res) => {
  try {
    const transcriptionId = req.params.id;

    if (!transcriptionJobs[transcriptionId]) {
      return res.status(404).json({ error: "Transcription job not found" });
    }

    // Get transcript from AssemblyAI
    const transcriptResponse = await fetch(
      `https://api.assemblyai.com/v2/transcript/${transcriptionId}`,
      {
        headers: {
          Authorization: `${ASSEMBLY_API_KEY}`, // Make sure there's no "Bearer " prefix
        },
      }
    );

    if (!transcriptResponse.ok) {
      const errorText = await transcriptResponse.text();
      console.error("Transcript retrieval error response:", errorText);
      throw new Error(
        `Transcript retrieval failed with status: ${transcriptResponse.status}`
      );
    }

    const transcriptData = await transcriptResponse.json();

    if (transcriptData.status !== "completed") {
      return res
        .status(400)
        .json({ error: "Transcription is not yet complete" });
    }

    // Process the transcript to format it with speakers
    const formattedTranscript = processTranscript(transcriptData);

    // Return the formatted transcript
    res.json({ transcript: formattedTranscript });
  } catch (error) {
    console.error("Transcript retrieval error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Process the transcript to format with speakers
function processTranscript(transcriptData) {
  const utterances = transcriptData.utterances || [];

  if (!utterances.length) {
    console.log("No utterances found in transcript data:", transcriptData);
    return [];
  }

  return utterances.map((utterance, index) => {
    return {
      speaker: `Speaker ${utterance.speaker}`,
      text: utterance.text,
      start: utterance.start / 1000, // Convert from milliseconds to seconds
      end: utterance.end / 1000,
    };
  });
}

// Clean up old files (older than 1 hour)
function cleanupOldFiles() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  Object.keys(transcriptionJobs).forEach((id) => {
    const job = transcriptionJobs[id];

    if (job.created < oneHourAgo) {
      // Delete the file
      if (job.filePath && fs.existsSync(job.filePath)) {
        fs.unlinkSync(job.filePath);
      }

      // Remove from our tracking
      delete transcriptionJobs[id];
    }
  });
}

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(
    `API Key length: ${ASSEMBLY_API_KEY ? ASSEMBLY_API_KEY.length : "not set"}`
  );
});
