let jobId = null;
let anchorTime = null;
let beats = [];
let ws = null;
let wsOriginal = null;
let wsProcessed = null;
let processedAudioUrl = null;
let originalAudioUrl = null;

// DOM elements
const fileInput = document.getElementById("file");
const uploadProgress = document.getElementById("uploadProgress");
const uploadProgressContainer = document.getElementById("uploadProgressContainer");
const uploadProgressFill = document.getElementById("uploadProgressFill");
const uploadLabel = document.getElementById("uploadLabel");
const uploadPercent = document.getElementById("uploadPercent");
const analysisDiv = document.getElementById("analysis");

const playBtn = document.getElementById("play");
const playBtnIcon = playBtn.querySelector(".btn-icon");
const setDownbeatBtn = document.getElementById("setDownbeat");
const anchorInfo = document.getElementById("anchorInfo");
const timeDisplay = document.getElementById("timeDisplay");
const durationDisplay = document.getElementById("durationDisplay");
const trackName = document.querySelector(".track-name");

// Zoom controls
const zoomInBtn = document.getElementById("zoomIn");
const zoomOutBtn = document.getElementById("zoomOut");
const zoomFitBtn = document.getElementById("zoomFit");
const zoomLevelDisplay = document.getElementById("zoomLevel");

// Comparison elements
const comparisonSection = document.getElementById("comparisonSection");
const playComparisonBtn = document.getElementById("playComparison");
const comparisonStats = document.getElementById("comparisonStats");

const bpmInput = document.getElementById("bpm");
const strengthInput = document.getElementById("strength");
const cfInput = document.getElementById("cf");

const processBtn = document.getElementById("process");
const processLoader = document.getElementById("processLoader");
const processStatus = document.getElementById("processStatus");

// Export elements
const exportOptions = document.getElementById("exportOptions");
const downloadWavBtn = document.getElementById("downloadWav");
const downloadMp3Btn = document.getElementById("downloadMp3");

// Zoom state
let currentZoom = 1;
let minZoom = 1;
let maxZoom = 100;

// Time formatting utility
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3);
  return `${mins.toString().padStart(2, '0')}:${secs.padStart(6, '0')}`;
}

// Update zoom level display
function updateZoomDisplay() {
  if (currentZoom >= 10) {
    zoomLevelDisplay.textContent = `${Math.round(currentZoom)}x`;
  } else {
    zoomLevelDisplay.textContent = `${currentZoom.toFixed(1)}x`;
  }
  
  // Update button states
  zoomOutBtn.disabled = currentZoom <= minZoom;
  zoomInBtn.disabled = currentZoom >= maxZoom;
}

// Zoom functions
function zoomIn() {
  if (!ws || currentZoom >= maxZoom) return;
  
  const zoomFactor = currentZoom < 10 ? 1.5 : 2;
  currentZoom = Math.min(currentZoom * zoomFactor, maxZoom);
  
  // For WaveSurfer v6, zoom takes pixels per second
  const pixelsPerSecond = Math.max(50 * currentZoom, 50);
  ws.zoom(pixelsPerSecond);
  updateZoomDisplay();
}

function zoomOut() {
  if (!ws || currentZoom <= minZoom) return;
  
  const zoomFactor = currentZoom <= 10 ? 1.5 : 2;
  currentZoom = Math.max(currentZoom / zoomFactor, minZoom);
  
  // For WaveSurfer v6, zoom takes pixels per second
  const pixelsPerSecond = Math.max(50 * currentZoom, 50);
  ws.zoom(pixelsPerSecond);
  updateZoomDisplay();
}

function zoomToFit() {
  if (!ws) return;
  
  currentZoom = minZoom;
  ws.zoom(50); // Reset to minimum zoom
  updateZoomDisplay();
}

// Initialize comparison waveforms
function initComparisonWaveforms() {
  // Initialize original waveform
  if (wsOriginal) wsOriginal.destroy();
  wsOriginal = WaveSurfer.create({
    container: "#waveOriginal",
    waveColor: "#666666",
    progressColor: "#ff6b35",
    cursorColor: "#ffffff",
    height: 80,
    barWidth: 1,
    barGap: 0.5,
    responsive: true,
    normalize: true,
    backend: 'WebAudio',
    interact: false
  });

  // Initialize processed waveform
  if (wsProcessed) wsProcessed.destroy();
  wsProcessed = WaveSurfer.create({
    container: "#waveProcessed",
    waveColor: "#00cc66",
    progressColor: "#00ff88",
    cursorColor: "#ffffff", 
    height: 80,
    barWidth: 1,
    barGap: 0.5,
    responsive: true,
    normalize: true,
    backend: 'WebAudio',
    interact: false
  });

  // Load audio files
  if (originalAudioUrl) {
    wsOriginal.load(originalAudioUrl);
  }
  
  if (processedAudioUrl) {
    wsProcessed.load(processedAudioUrl);
    
    wsProcessed.on("ready", () => {
      playComparisonBtn.disabled = false;
      updateComparisonStats();
    });
  }
}

// Update comparison statistics
function updateComparisonStats() {
  if (!ws || !wsProcessed) return;
  
  try {
    const originalDuration = ws.getDuration();
    const processedDuration = wsProcessed.getDuration();
    
    // Safely extract BPM from analysis div
    let originalBpm = 120; // Default fallback
    const analysisText = analysisDiv.textContent || '';
    const bpmMatch = analysisText.match(/(\d+\.?\d*)/);
    if (bpmMatch) {
      originalBpm = parseFloat(bpmMatch[1]);
    }
    
    const targetBpm = parseFloat(bpmInput.value) || originalBpm;
    
    const timeDiff = processedDuration - originalDuration;
    const bpmChange = targetBpm - originalBpm;
    const percentChange = ((processedDuration / originalDuration - 1) * 100);
    
    comparisonStats.innerHTML = `
      <div class="stat-item">
        <span class="stat-label">Original Duration:</span>
        <span class="stat-value">${formatTime(originalDuration)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Processed Duration:</span>
        <span class="stat-value">${formatTime(processedDuration)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Time Difference:</span>
        <span class="stat-value ${timeDiff >= 0 ? 'text-warning' : 'text-success'}">${timeDiff >= 0 ? '+' : ''}${timeDiff.toFixed(3)}s</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">BPM Change:</span>
        <span class="stat-value ${bpmChange >= 0 ? 'text-success' : 'text-warning'}">${originalBpm.toFixed(1)} → ${targetBpm.toFixed(1)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Length Change:</span>
        <span class="stat-value ${percentChange >= 0 ? 'text-warning' : 'text-success'}">${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(1)}%</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Anchor Point:</span>
        <span class="stat-value">${formatTime(anchorTime || 0)}</span>
      </div>
    `;
  } catch (error) {
    console.error('Error updating comparison stats:', error);
    comparisonStats.innerHTML = '<div class="stat-item"><span class="stat-label">Error loading comparison data</span></div>';
  }
}

// Show comparison section with animation
function showComparisonSection() {
  comparisonSection.style.display = 'block';
  comparisonSection.style.opacity = '0';
  comparisonSection.style.transform = 'translateY(-20px)';
  
  setTimeout(() => {
    comparisonSection.style.transition = 'all 0.5s ease';
    comparisonSection.style.opacity = '1';
    comparisonSection.style.transform = 'translateY(0)';
  }, 100);
  
  // Initialize comparison waveforms
  setTimeout(() => {
    initComparisonWaveforms();
  }, 300);
}

// Initialize waveform with professional styling
function initWave(url, filename) {
  if (ws) ws.destroy();

  ws = WaveSurfer.create({
    container: "#wave",
    waveColor: "#666666",
    progressColor: "#00ccaa",
    cursorColor: "#ffffff",
    height: 180,
    barWidth: 2,
    barGap: 1,
    barRadius: 1,
    responsive: true,
    normalize: true,
    backend: 'WebAudio',
    cursorWidth: 2,
    hideScrollbar: false,
    scrollParent: true
  });

  ws.load(url);
  originalAudioUrl = url; // Store for comparison

  ws.on("ready", () => {
    playBtn.disabled = false;
    setDownbeatBtn.disabled = false;
    
    // Enable zoom controls
    zoomInBtn.disabled = false;
    zoomOutBtn.disabled = true; // Start at min zoom
    zoomFitBtn.disabled = false;
    
    anchorInfo.textContent = "Click on waveform to set downbeat anchor point";
    
    // Update track info
    trackName.textContent = filename || "Audio Track";
    const duration = ws.getDuration();
    durationDisplay.textContent = `/ ${formatTime(duration)}`;
    
    // Reset zoom state
    currentZoom = minZoom;
    updateZoomDisplay();
    
    // Visual feedback for ready state
    document.querySelector('.waveform-container').style.borderColor = 'var(--accent-green)';
    setTimeout(() => {
      document.querySelector('.waveform-container').style.borderColor = '';
    }, 1500);
  });

  ws.on("seek", () => {
    anchorTime = ws.getCurrentTime();
    anchorInfo.innerHTML = `<span class="text-success">Downbeat anchor: ${formatTime(anchorTime)}</span> (click waveform to reposition)`;
    processBtn.disabled = false;
    
    // Visual feedback for anchor set
    setDownbeatBtn.style.background = 'var(--accent-orange)';
    setDownbeatBtn.style.borderColor = 'var(--accent-orange)';
    setDownbeatBtn.style.color = 'white';
    setTimeout(() => {
      setDownbeatBtn.style.background = '';
      setDownbeatBtn.style.borderColor = '';
      setDownbeatBtn.style.color = '';
    }, 1000);
  });

  // Update time display during playback
  ws.on("audioprocess", () => {
    const currentTime = ws.getCurrentTime();
    timeDisplay.textContent = formatTime(currentTime);
  });

  // Update play button state
  ws.on("play", () => {
    playBtnIcon.textContent = "⏸";
  });
  
  ws.on("pause", () => {
    playBtnIcon.textContent = "▶";
  });

  ws.on("finish", () => {
    playBtnIcon.textContent = "▶";
    timeDisplay.textContent = formatTime(0);
  });
}

// Enhanced upload function with progress tracking
function uploadFileWithProgress(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    // Show progress bar
    uploadProgressContainer.style.display = "block";
    uploadLabel.textContent = "Uploading audio file...";
    uploadPercent.textContent = "0%";
    uploadProgressFill.style.width = "0%";

    // Reset states
    analysisDiv.innerHTML = "";
    processStatus.innerHTML = "";
    exportOptions.style.display = "none";
    processBtn.disabled = true;
    anchorInfo.textContent = "Upload in progress...";

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const percentComplete = Math.round((e.loaded / e.total) * 100);
        uploadProgressFill.style.width = `${percentComplete}%`;
        uploadPercent.textContent = `${percentComplete}%`;
        
        // Update label based on progress
        if (percentComplete < 30) {
          uploadLabel.textContent = "Uploading audio file...";
        } else if (percentComplete < 70) {
          uploadLabel.textContent = "Processing audio data...";
        } else if (percentComplete < 90) {
          uploadLabel.textContent = "Analyzing beats...";
        } else {
          uploadLabel.textContent = "Finishing up...";
        }
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          
          // Complete animation
          uploadProgressFill.style.width = "100%";
          uploadPercent.textContent = "100%";
          uploadLabel.textContent = "Upload complete!";
          
          setTimeout(() => {
            uploadProgressContainer.style.display = "none";
            resolve(data);
          }, 800);
          
        } catch (error) {
          reject(new Error("Failed to parse server response"));
        }
      } else {
        try {
          const errorData = JSON.parse(xhr.responseText);
          reject(new Error(errorData.detail || "Upload failed"));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener("error", () => {
      uploadProgressContainer.style.display = "none";
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("timeout", () => {
      uploadProgressContainer.style.display = "none";
      reject(new Error("Upload timeout"));
    });

    xhr.open("POST", "/api/upload");
    xhr.timeout = 120000; // 2 minute timeout
    xhr.send(formData);
  });
}

// Main upload handler
async function handleFileUpload(file) {
  try {
    uploadProgress.innerHTML = "";
    
    const data = await uploadFileWithProgress(file);
    
    jobId = data.job_id;
    beats = data.beats;

    uploadProgress.innerHTML = `<span class="text-success">✓ Upload successful</span> • Job: <code>${jobId}</code>`;
    
    analysisDiv.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-lg); text-align: center;">
        <div>
          <div style="font-size: 18px; font-weight: 500; color: var(--accent-red);">${data.bpm_estimate.toFixed(2)}</div>
          <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">BPM Detected</div>
        </div>
        <div>
          <div style="font-size: 18px; font-weight: 500; color: var(--accent-blue);">${beats.length}</div>
          <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Beat Points</div>
        </div>
      </div>
    `;

    // Load audio into waveform
    const url = URL.createObjectURL(file);
    initWave(url, file.name);

    // Pre-fill BPM input
    bpmInput.value = (Math.round(data.bpm_estimate * 100) / 100).toFixed(2);
    bpmInput.style.borderColor = 'var(--accent-red)';
    setTimeout(() => {
      bpmInput.style.borderColor = '';
    }, 1500);
    
    // Hide comparison section and export options when loading new file
    comparisonSection.style.display = 'none';
    exportOptions.style.display = 'none';
    
  } catch (error) {
    uploadProgressContainer.style.display = "none";
    uploadProgress.innerHTML = `<span class="text-error">⚠ ${error.message}</span>`;
    anchorInfo.textContent = "Upload failed";
  }
}

// File input handler
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Reset UI state
  trackName.textContent = "No file loaded";
  timeDisplay.textContent = "00:00.000";
  durationDisplay.textContent = "/ 00:00.000";
  anchorTime = null;
  
  // Reset zoom controls
  zoomInBtn.disabled = true;
  zoomOutBtn.disabled = true;
  zoomFitBtn.disabled = true;
  currentZoom = minZoom;
  updateZoomDisplay();

  // Validate file type
  const validTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/m4a'];
  if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|m4a)$/i)) {
    uploadProgress.innerHTML = `<span class="text-error">⚠ Please select a valid audio file (MP3, WAV, M4A)</span>`;
    return;
  }

  // Check file size (100MB limit)
  const maxSize = 100 * 1024 * 1024; // 100MB
  if (file.size > maxSize) {
    uploadProgress.innerHTML = `<span class="text-error">⚠ File too large. Maximum size is 100MB.</span>`;
    return;
  }

  await handleFileUpload(file);
});

// Play button handler
playBtn.addEventListener("click", () => {
  if (!ws) return;
  ws.playPause();
});

// Zoom control handlers
zoomInBtn.addEventListener("click", zoomIn);
zoomOutBtn.addEventListener("click", zoomOut);
zoomFitBtn.addEventListener("click", zoomToFit);

// Process button handler with enhanced UI feedback and comparison
processBtn.addEventListener("click", async () => {
  if (!jobId || anchorTime === null) return;

  // Update button state
  processBtn.disabled = true;
  processBtn.classList.add('loading');
  processStatus.innerHTML = `
    <span class="text-success">⚡ Processing audio...</span><br>
    <span style="font-size: 10px; color: var(--text-dim);">Analyze → Time Warp → Export</span>
  `;

  const payload = {
    job_id: jobId,
    target_bpm: parseFloat(bpmInput.value),
    strength: parseFloat(strengthInput.value),
    anchor_time: anchorTime,
    crossfade_ms: parseInt(cfInput.value, 10),
    engine: "auto"
  };

  try {
    const res = await fetch("/api/process", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Process failed");
    }

    // Success state
    processBtn.classList.remove('loading');
    processStatus.innerHTML = `
      <span class="text-success">✓ Processing complete!</span><br>
      <span style="font-size: 10px; color: var(--text-dim);">Your time-warped audio is ready</span>
    `;
    
    // Set up download links
    const downloadBaseUrl = `/api/download/${jobId}`;
    downloadWavBtn.href = `${downloadBaseUrl}?format=wav`;
    downloadMp3Btn.href = `${downloadBaseUrl}?format=mp3&bitrate=320`;
    
    // Store processed audio URL for comparison
    processedAudioUrl = `${downloadBaseUrl}?format=wav&preview=true`;
    
    // Show export options
    exportOptions.style.display = 'block';
    downloadWavBtn.style.display = 'inline-flex';
    downloadMp3Btn.style.display = 'inline-flex';
    
    // Show comparison section
    showComparisonSection();

  } catch (error) {
    processBtn.classList.remove('loading');
    processBtn.disabled = false;
    processStatus.innerHTML = `<span class="text-error">⚠ ${error.message}</span>`;
  }
});

// Play comparison button handler
playComparisonBtn.addEventListener("click", () => {
  if (!wsProcessed) return;
  
  const playIcon = playComparisonBtn.querySelector(".btn-icon");
  const playLabel = playComparisonBtn.querySelector(".btn-label");
  
  if (wsProcessed.isPlaying()) {
    wsProcessed.pause();
    playIcon.textContent = "▶";
    playLabel.textContent = "Play Processed";
  } else {
    wsProcessed.play();
    playIcon.textContent = "⏸";
    playLabel.textContent = "Pause Processed";
  }
});

// Keyboard shortcuts for zoom and playback
document.addEventListener("keydown", (e) => {
  // Only handle shortcuts if not typing in inputs
  if (e.target.tagName === 'INPUT') return;
  
  switch(e.key) {
    case '+':
    case '=':
      e.preventDefault();
      zoomIn();
      break;
    case '-':
      e.preventDefault();
      zoomOut();
      break;
    case '0':
      e.preventDefault();
      zoomToFit();
      break;
    case ' ':
      e.preventDefault();
      if (ws) ws.playPause();
      break;
  }
});

// Enhanced input interactions
[bpmInput, strengthInput, cfInput].forEach(input => {
  input.addEventListener('focus', (e) => {
    e.target.style.transform = 'scale(1.02)';
    e.target.parentElement.style.transform = 'scale(1.02)';
  });
  
  input.addEventListener('blur', (e) => {
    e.target.style.transform = '';
    e.target.parentElement.style.transform = '';
  });
});

// Initialize app state
document.addEventListener('DOMContentLoaded', () => {
  // Set initial time display
  timeDisplay.textContent = "00:00.000";
  durationDisplay.textContent = "/ 00:00.000";
  
  // Add subtle load animations
  const elements = ['.app-toolbar', '.upload-section', '.waveform-section', '.params-section'];
  elements.forEach((selector, index) => {
    const element = document.querySelector(selector);
    if (element) {
      element.style.opacity = '0';
      element.style.transform = 'translateY(10px)';
      setTimeout(() => {
        element.style.transition = 'all 0.4s ease';
        element.style.opacity = '1';
        element.style.transform = 'translateY(0)';
      }, index * 100);
    }
  });
  
  // Mouse wheel zoom (when hovering over waveform) - add after DOM is ready
  const waveContainer = document.querySelector('#wave');
  if (waveContainer) {
    waveContainer.addEventListener('wheel', (e) => {
      if (!ws || !e.ctrlKey) return; // Only zoom with Ctrl+scroll
      
      e.preventDefault();
      
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    });
  }
});