document.addEventListener("DOMContentLoaded", function () {
  const uploadForm = document.getElementById("upload-form");
  const uploadArea = document.getElementById("upload-area");
  const fileInput = document.getElementById("video-upload");
  const fileName = document.getElementById("file-name");
  const errorMessage = document.getElementById("error-message");
  const submitButton = document.getElementById("submit-button");
  const progressContainer = document.getElementById("progress-container");
  const progressIndicator = document.getElementById("progress-indicator");
  const progressText = document.getElementById("progress-text");
  const transcriptContainer = document.getElementById("transcript-container");
  const transcriptContent = document.getElementById("transcript-content");
  const videoPreview = document.getElementById("video-preview");

  let selectedFile = null;
  let transcriptionId = null;
  let pollingInterval = null;

  // Handle click on upload area
  uploadArea.addEventListener("click", function () {
    fileInput.click();
  });

  // Handle drag and drop
  uploadArea.addEventListener("dragover", function (e) {
    e.preventDefault();
    uploadArea.style.backgroundColor = "#f3f4f6";
  });

  uploadArea.addEventListener("dragleave", function () {
    uploadArea.style.backgroundColor = "";
  });

  uploadArea.addEventListener("drop", function (e) {
    e.preventDefault();
    uploadArea.style.backgroundColor = "";

    if (e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });

  // Handle file selection
  fileInput.addEventListener("change", function () {
    if (fileInput.files.length > 0) {
      handleFileSelection(fileInput.files[0]);
    }
  });

  function handleFileSelection(file) {
    if (!file.type.startsWith("video/")) {
      showError("Please select a valid video file");
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      // 100MB limit
      showError("File size exceeds the 100MB limit");
      return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    errorMessage.style.display = "none";

    // Create a URL for the video preview
    const videoURL = URL.createObjectURL(file);
    videoPreview.src = videoURL;
    videoPreview.style.display = "block";

    // Enable the submit button once the video is loaded
    videoPreview.onloadedmetadata = function () {
      submitButton.disabled = false;
    };
  }

  // Handle form submission
  uploadForm.addEventListener("submit", function (e) {
    e.preventDefault();

    if (!selectedFile) {
      showError("Please select a video file");
      return;
    }

    startTranscription();
  });

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = "block";
  }

  async function startTranscription() {
    submitButton.disabled = true;
    progressContainer.style.display = "block";
    progressIndicator.style.width = "0%";
    progressText.textContent = "Uploading video...";

    try {
      // Create a FormData object to send the file
      const formData = new FormData();
      formData.append("video", selectedFile);

      // Upload the video to our server
      const uploadResponse = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.error || "Failed to upload video");
      }

      const uploadData = await uploadResponse.json();
      transcriptionId = uploadData.transcriptionId;

      // Update progress
      updateProgress(30);
      progressText.textContent = "Transcribing video...";

      // Start polling for transcription status
      pollingInterval = setInterval(checkTranscriptionStatus, 3000);
    } catch (error) {
      console.error("Transcription error:", error);
      showError("An error occurred: " + error.message);
      submitButton.disabled = false;
      progressContainer.style.display = "none";
    }
  }

  async function checkTranscriptionStatus() {
    try {
      const statusResponse = await fetch(`/status/${transcriptionId}`);

      if (!statusResponse.ok) {
        clearInterval(pollingInterval);
        const errorData = await statusResponse.json();
        throw new Error(
          errorData.error || "Failed to check transcription status"
        );
      }

      const statusData = await statusResponse.json();

      // Update progress based on status
      switch (statusData.status) {
        case "queued":
          updateProgress(40);
          progressText.textContent = "Queued for transcription...";
          break;
        case "processing":
          updateProgress(60);
          progressText.textContent = "Processing transcription...";
          break;
        case "completed":
          clearInterval(pollingInterval);
          updateProgress(100);
          progressText.textContent = "Transcription complete!";

          // Get the full transcript
          getTranscript();
          break;
        case "error":
          clearInterval(pollingInterval);
          throw new Error(statusData.error || "Transcription failed");
        default:
          updateProgress(50);
          progressText.textContent = "Processing...";
      }
    } catch (error) {
      clearInterval(pollingInterval);
      console.error("Status check error:", error);
      showError("An error occurred: " + error.message);
      submitButton.disabled = false;
      progressContainer.style.display = "none";
    }
  }

  async function getTranscript() {
    try {
      const transcriptResponse = await fetch(`/transcript/${transcriptionId}`);

      if (!transcriptResponse.ok) {
        const errorData = await transcriptResponse.json();
        throw new Error(errorData.error || "Failed to retrieve transcript");
      }

      const transcriptData = await transcriptResponse.json();

      // Display the transcript
      showTranscript(transcriptData.transcript);
    } catch (error) {
      console.error("Transcript retrieval error:", error);
      showError("An error occurred: " + error.message);
      submitButton.disabled = false;
      progressContainer.style.display = "none";
    }
  }

  function updateProgress(value) {
    progressIndicator.style.width = `${value}%`;
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  function showTranscript(transcript) {
    transcriptContent.innerHTML = "";

    transcript.forEach((segment) => {
      const segmentDiv = document.createElement("div");
      segmentDiv.className = "transcript-segment";

      const speakerLabel = document.createElement("div");
      speakerLabel.className = "speaker-label";
      speakerLabel.textContent = `${segment.speaker}:`;

      const speakerText = document.createElement("div");
      speakerText.className = "speaker-text";
      speakerText.textContent = segment.text;

      const timestamp = document.createElement("div");
      timestamp.className = "timestamp";
      timestamp.textContent = `${formatTime(segment.start)} - ${formatTime(
        segment.end
      )}`;

      segmentDiv.appendChild(speakerLabel);
      segmentDiv.appendChild(speakerText);
      segmentDiv.appendChild(timestamp);

      transcriptContent.appendChild(segmentDiv);
    });

    transcriptContainer.style.display = "block";
    progressContainer.style.display = "none";
    submitButton.disabled = false;
  }
});
