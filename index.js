import "./styles.css";
import { getDetector, detectObjects } from "./yolo.js";

const CAMERA_POLL_DELAY = 150;

const imageButtons = document.querySelectorAll(".image-btn");
const cameraButton = document.querySelector("#camera-button");
const statusBanner = document.querySelector("#status-banner");
const placeholder = document.querySelector("#placeholder");
const mediaStack = document.querySelector("#media-stack");
const imageElement = document.querySelector("#preview-image");
const videoElement = document.querySelector("#preview-video");
const overlayCanvas = document.querySelector("#overlay");
const resultSummary = document.querySelector("#result-summary");
const detectionList = document.querySelector("#detection-list");

const overlayContext = overlayCanvas.getContext("2d");
const offscreenCanvas = document.createElement("canvas");
const offscreenContext = offscreenCanvas.getContext("2d", {
  willReadFrequently: true,
});

let currentMode = "idle";
let currentSession = 0;
let currentStream = null;
let latestDetections = [];
let activeMediaElement = null;

function setActiveButton(activeButton) {
  const allButtons = [...imageButtons, cameraButton];
  allButtons.forEach((button) => {
    button.classList.toggle("is-active", button === activeButton);
  });
}

function setStatus(message, tone = "info") {
  statusBanner.textContent = message;
  statusBanner.dataset.tone = tone;
}

function updateResults(detections) {
  latestDetections = detections;
  detectionList.innerHTML = "";

  if (!detections.length) {
    resultSummary.textContent = "No objects detected.";
    return;
  }

  resultSummary.textContent = `Detected ${detections.length} object(s).`;

  detections.forEach((item) => {
    const li = document.createElement("li");
    li.className = "detection-item";

    const percent = `${Math.round((item.score ?? 0) * 100)}%`;
    const { xmin, ymin, xmax, ymax } = item.box;
    const boxText = `x:${Math.round(xmin * 100)}% · y:${Math.round(ymin * 100)}% · w:${Math.round((xmax - xmin) * 100)}% · h:${Math.round((ymax - ymin) * 100)}%`;

    li.innerHTML = `
      <div class="detection-item__top">
        <span class="detection-item__label">${item.label}</span>
        <span class="detection-item__score">${percent}</span>
      </div>
      <div class="detection-item__meta">${boxText}</div>
    `;

    detectionList.appendChild(li);
  });
}

function clearOverlay() {
  overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function syncOverlaySize() {
  if (!activeMediaElement) {
    overlayCanvas.width = 0;
    overlayCanvas.height = 0;
    return null;
  }

  const bounds = activeMediaElement.getBoundingClientRect();
  const parentBounds = mediaStack.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const pixelRatio = window.devicePixelRatio || 1;
  const left = Math.max(0, bounds.left - parentBounds.left);
  const top = Math.max(0, bounds.top - parentBounds.top);

  overlayCanvas.width = Math.round(width * pixelRatio);
  overlayCanvas.height = Math.round(height * pixelRatio);
  overlayCanvas.style.width = `${width}px`;
  overlayCanvas.style.height = `${height}px`;
  overlayCanvas.style.left = `${left}px`;
  overlayCanvas.style.top = `${top}px`;

  overlayContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  overlayContext.lineWidth = 3;
  overlayContext.font = '600 14px "Segoe UI", sans-serif';
  overlayContext.textBaseline = "top";

  return { width, height };
}

function drawDetections(detections) {
  const size = syncOverlaySize();

  if (!size) {
    clearOverlay();
    return;
  }

  const { width, height } = size;
  overlayContext.clearRect(0, 0, width, height);

  detections.forEach((item, index) => {
    const { xmin, ymin, xmax, ymax } = item.box;
    const x = xmin * width;
    const y = ymin * height;
    const boxWidth = (xmax - xmin) * width;
    const boxHeight = (ymax - ymin) * height;
    const hue = (index * 57) % 360;
    const stroke = `hsl(${hue} 100% 60%)`;
    const fill = `hsla(${hue} 100% 55% / 0.18)`;
    const label = `${item.label} ${Math.round((item.score ?? 0) * 100)}%`;

    overlayContext.fillStyle = fill;
    overlayContext.strokeStyle = stroke;
    overlayContext.fillRect(x, y, boxWidth, boxHeight);
    overlayContext.strokeRect(x, y, boxWidth, boxHeight);

    const textWidth = overlayContext.measureText(label).width;
    const textHeight = 24;
    const textY = Math.max(0, y - textHeight - 6);

    overlayContext.fillStyle = stroke;
    overlayContext.fillRect(x, textY, textWidth + 16, textHeight);
    overlayContext.fillStyle = "#020617";
    overlayContext.fillText(label, x + 8, textY + 5);
  });
}

function resetViewer() {
  placeholder.hidden = true;
  imageElement.hidden = true;
  videoElement.hidden = true;
  activeMediaElement = null;
  clearOverlay();
}

function showImageViewer() {
  placeholder.hidden = true;
  imageElement.hidden = false;
  videoElement.hidden = true;
  activeMediaElement = imageElement;
}

function showVideoViewer() {
  placeholder.hidden = true;
  videoElement.hidden = false;
  imageElement.hidden = true;
  activeMediaElement = videoElement;
}

function stopCameraStream() {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }
  videoElement.pause();
  videoElement.srcObject = null;
}

function isRetryableCameraError(error) {
  return [
    "NotFoundError",
    "OverconstrainedError",
    "DevicesNotFoundError",
  ].includes(error?.name);
}

async function requestCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera API is not supported in this browser.");
  }

  const constraintOptions = [
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    },
    { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: true, audio: false },
  ];

  let lastError = null;

  for (const constraints of constraintOptions) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (!isRetryableCameraError(error)) throw error;
    }
  }

  throw lastError ?? new Error("Could not find a valid camera device.");
}

function getCameraErrorMessage(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera permission denied. Please allow access in your browser settings.";
    case "NotReadableError":
    case "TrackStartError":
      return "Camera is likely in use by another application. Close it and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera found. Please check your device connection.";
    default:
      return error?.message || "An unknown camera error occurred.";
  }
}

function waitForImageLoad(image) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to load the image."));
    };
    const cleanup = () => {
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    };
    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
  });
}

async function handleImageClick(event) {
  const button = event.currentTarget;
  const imageUrl = button.dataset.url;

  const sessionId = ++currentSession;
  currentMode = "image";
  setActiveButton(button);
  stopCameraStream();
  resetViewer();
  showImageViewer();
  updateResults([]);

  setStatus(
    "Loading model and image. This might take a moment the first time...",
  );

  // Pre-warm the detector so the UI doesn't hang unexpectedly later
  getDetector().catch(console.error);

  try {
    imageElement.src = imageUrl;
    await waitForImageLoad(imageElement);

    if (sessionId !== currentSession) return;

    setStatus("Detecting objects in the image...");
    const detections = await detectObjects(imageUrl);

    if (sessionId !== currentSession) return;

    drawDetections(detections);
    updateResults(detections);
    setStatus("Image object detection complete.", "success");
  } catch (error) {
    console.error(error);
    setStatus(
      error.message || "An error occurred while analyzing the image.",
      "error",
    );
    updateResults([]);
  }
}

async function runCameraLoop(sessionId) {
  while (currentMode === "camera" && sessionId === currentSession) {
    if (!videoElement.videoWidth || !videoElement.videoHeight) {
      await new Promise((resolve) => setTimeout(resolve, CAMERA_POLL_DELAY));
      continue;
    }

    offscreenCanvas.width = videoElement.videoWidth;
    offscreenCanvas.height = videoElement.videoHeight;
    offscreenContext.drawImage(
      videoElement,
      0,
      0,
      offscreenCanvas.width,
      offscreenCanvas.height,
    );

    try {
      // NOTE: See review below on how this can be optimized!
      const snapshot = offscreenCanvas.toDataURL("image/jpeg", 0.8);
      const detections = await detectObjects(snapshot);

      if (sessionId !== currentSession || currentMode !== "camera") return;

      drawDetections(detections);
      updateResults(detections);

      setStatus(
        detections.length
          ? `Detecting ${detections.length} object(s) in real-time.`
          : "Analyzing live feed. Move the camera if no objects are detected.",
        detections.length ? "success" : "info",
      );
    } catch (error) {
      console.error(error);
      if (sessionId !== currentSession || currentMode !== "camera") return;
      setStatus(
        error.message || "An error occurred during camera analysis.",
        "error",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, CAMERA_POLL_DELAY));
  }
}

async function handleCameraClick() {
  const sessionId = ++currentSession;
  currentMode = "camera";
  setActiveButton(cameraButton);
  stopCameraStream();
  resetViewer();
  showVideoViewer();
  updateResults([]);
  setStatus("Requesting camera permissions...");

  // Pre-warm the detector
  getDetector().catch(console.error);

  try {
    currentStream = await requestCameraStream();
    if (sessionId !== currentSession) {
      stopCameraStream();
      return;
    }

    videoElement.srcObject = currentStream;
    await videoElement.play();

    if (sessionId !== currentSession) {
      stopCameraStream();
      return;
    }

    setStatus("Camera started. Preparing real-time object detection...");
    await runCameraLoop(sessionId);
  } catch (error) {
    console.error(error);
    stopCameraStream();
    setStatus(getCameraErrorMessage(error), "error");
    updateResults([]);
  }
}

window.addEventListener("resize", () => {
  if (activeMediaElement && latestDetections.length) {
    drawDetections(latestDetections);
  } else if (activeMediaElement) {
    syncOverlaySize();
    clearOverlay();
  }
});

imageButtons.forEach((btn) => btn.addEventListener("click", handleImageClick));
cameraButton.addEventListener("click", handleCameraClick);

setActiveButton(null);
