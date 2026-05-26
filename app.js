/* ==========================================================================
   VibeDJ - Core Application Controller & Audio Engine
   ========================================================================== */

// Global Audio Context (lazily initialized on first interaction)
let audioCtx = null;

// Default sample tracks served with CORS support (SoundHelix)
const DEFAULT_TRACKS_A = [
  { id: 'a-1', title: 'SoundHelix Song 1', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', bpm: 128, duration: 372 },
  { id: 'a-2', title: 'SoundHelix Song 2', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', bpm: 95, duration: 425 }
];

const DEFAULT_TRACKS_B = [
  { id: 'b-1', title: 'SoundHelix Song 3', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', bpm: 110, duration: 302 },
  { id: 'b-2', title: 'SoundHelix Song 4', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', bpm: 132, duration: 302 }
];

// Helper to downsample AudioBuffer into peak amplitudes
function extractPeaks(audioBuffer, sampleCount) {
  const channelData = audioBuffer.getChannelData(0); // Left channel
  const step = Math.floor(channelData.length / sampleCount);
  const peaks = [];
  for (let i = 0; i < sampleCount; i++) {
    let max = 0;
    const start = i * step;
    for (let j = 0; j < step; j++) {
      const val = Math.abs(channelData[start + j]);
      if (val > max) max = val;
    }
    peaks.push(max);
  }
  return peaks;
}

// Helper to procedurally generate a realistic DJ-style waveform
function generateProceduralPeaks(sampleCount) {
  const peaks = [];
  for (let i = 0; i < sampleCount; i++) {
    const pct = i / sampleCount;
    // Generate a nice waveform shape with intro, drops, and outro
    const envelope = Math.sin(pct * Math.PI) * (0.85 + 0.15 * Math.sin(pct * Math.PI * 6));
    const noise = 0.2 + 0.5 * Math.sin(i * 0.08) * Math.cos(i * 0.15) + 0.3 * Math.sin(i * 0.4);
    const peak = Math.max(0.04, Math.abs(noise) * envelope);
    peaks.push(peak);
  }
  return peaks;
}

// Deck Class to encapsulate turntable states & controls
class Deck {
  constructor(id, audioElId, canvasId, vinylId, tonearmId, playlistBodyId, emptyMsgId, progressBarId, progressFillId) {
    this.id = id; // 'a' or 'b'
    this.audio = document.getElementById(audioElId);
    this.canvas = document.getElementById(canvasId);
    this.canvasCtx = this.canvas.getContext('2d');
    this.vinyl = document.getElementById(vinylId);
    this.tonearm = document.getElementById(tonearmId);
    this.playlistBody = document.getElementById(playlistBodyId);
    this.emptyMsg = document.getElementById(emptyMsgId);
    this.progressBar = document.getElementById(progressBarId);
    this.progressFill = document.getElementById(progressFillId);
    
    // Web Audio Nodes
    this.sourceNode = null;
    this.eqLow = null;
    this.eqMid = null;
    this.eqHigh = null;
    this.analyser = null;
    this.channelGainNode = null;
    this.crossfadeGainNode = null;
    
    // State
    this.playlist = [];
    this.loadedIndex = null;
    this.highlightedIndex = null;
    this.isPlaying = false;
    this.cueTime = 0;
    this.pitch = 0; // -8 to +8
    this.visMode = 'overview'; // default visualizer is the static waveform overview
    
    // Bind UI elements
    this.playBtn = document.getElementById(`deck-${this.id}-play`);
    this.stopBtn = document.getElementById(`deck-${this.id}-stop`);
    this.cueBtn = document.getElementById(`deck-${this.id}-cue`);
    this.nextBtn = document.getElementById(`deck-${this.id}-next`);
    this.pitchSlider = document.getElementById(`deck-${this.id}-pitch`);
    this.pitchValueText = document.getElementById(`deck-${this.id}-pitch-value`);
    this.pitchResetBtn = document.getElementById(`deck-${this.id}-pitch-reset`);
    this.bpmText = document.getElementById(`deck-${this.id}-bpm-display`);
    this.trackTitleText = document.getElementById(`deck-${this.id}-track-title`);
    this.timeCurrentText = document.getElementById(`deck-${this.id}-time-current`);
    this.timeRemainText = document.getElementById(`deck-${this.id}-time-remain`);
    this.vuContainer = document.getElementById(`deck-${this.id}-vu`);
    this.visToggleBtn = document.getElementById(`deck-${this.id}-vis-toggle`);
    
    // Init Visualizer Canvas Resolution
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  setPlayingState(playing) {
    this.isPlaying = playing;
    const box = document.getElementById(`playlist-box-${this.id}`);
    if (box) {
      if (playing) {
        box.classList.add('playlist-disabled');
      } else {
        box.classList.remove('playlist-disabled');
      }
    }
  }

  resizeCanvas() {
    this.canvas.width = this.canvas.clientWidth * window.devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;
    if (this.visMode === 'overview') {
      this.drawOverviewWaveform();
    }
  }

  // Decodes full ArrayBuffer in the background to get exact waveform peaks
  decodeTrackWaveform(track) {
    if (!track.file || track.decodedPeaks) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        initAudioContext();
        
        const arrayBuffer = e.target.result;
        // Decode
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        // Extract peaks (30000 samples for high-definition zoom)
        const peaks = extractPeaks(audioBuffer, 30000);
        track.peaks = peaks;
        track.decodedPeaks = true;
        
        // If this track is currently loaded on this deck, draw it!
        if (this.playlist[this.loadedIndex] === track) {
          if (this.visMode === 'overview') this.drawOverviewWaveform();
          else if (this.visMode === 'zoom') this.drawZoomWaveform();
        }
      } catch (err) {
        console.warn('Failed to decode exact waveform for:', track.title, err);
      }
    };
    reader.readAsArrayBuffer(track.file);
  }

  // Renders the full static track waveform with glowing playhead bar
  drawOverviewWaveform() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.canvasCtx;

    // Clear
    ctx.fillStyle = '#08090d';
    ctx.fillRect(0, 0, width, height);

    if (this.loadedIndex === null) return;
    const track = this.playlist[this.loadedIndex];
    if (!track.peaks) {
      track.peaks = generateProceduralPeaks(30000);
    }

    const peaks = track.peaks;
    const barCount = 150; // Draw exactly 150 crisp columns
    const spacing = 2; // 2px spacing for a clean premium look
    const barWidth = (width / barCount) - spacing;

    const duration = this.audio.duration || 0;
    const currentTime = this.audio.currentTime || 0;
    const playPercent = duration > 0 ? (currentTime / duration) : 0;
    const currentBarIndex = Math.floor(playPercent * barCount);

    // Colors
    const activeColor = this.id === 'a' ? '#00f2fe' : '#f35588';
    const inactiveColor = this.id === 'a' ? 'rgba(0, 242, 254, 0.2)' : 'rgba(243, 85, 136, 0.2)';

    ctx.shadowBlur = 0; // Reset shadows for peaks

    // Downsample factor
    const step = Math.max(1, Math.floor(peaks.length / barCount));

    // Draw peaks
    for (let i = 0; i < barCount; i++) {
      const x = i * (barWidth + spacing);
      
      // Get max peak in this chunk
      let maxVal = 0;
      const start = i * step;
      for (let j = 0; j < step; j++) {
        const val = peaks[start + j] || 0;
        if (val > maxVal) maxVal = val;
      }

      const barHeight = maxVal * height * 0.85;
      const y = (height - barHeight) / 2;

      // Played vs Remaining color
      if (i <= currentBarIndex) {
        ctx.fillStyle = activeColor;
      } else {
        ctx.fillStyle = inactiveColor;
      }

      ctx.fillRect(x, y, barWidth, barHeight);
    }

    // Draw glowing vertical playhead bar
    if (duration > 0) {
      const playheadX = playPercent * width;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowBlur = 10;
      ctx.shadowColor = activeColor;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow
    }

    // Draw vertical Cue Point line
    if (duration > 0 && this.cueTime > 0) {
      const cuePct = this.cueTime / duration;
      const cueX = cuePct * width;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ff7a00'; // Neon Orange
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#ff7a00';
      ctx.beginPath();
      ctx.moveTo(cueX, 0);
      ctx.lineTo(cueX, height);
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow

      // Text label "CUE"
      ctx.fillStyle = '#ff7a00';
      ctx.font = 'bold 8px Orbitron, sans-serif';
      ctx.fillText('CUE', cueX + 4, 10);
    }
  }

  // Renders the rolling 1-second zoomed-in waveform centered on the playhead
  drawZoomWaveform() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.canvasCtx;

    // Clear
    ctx.fillStyle = '#08090d';
    ctx.fillRect(0, 0, width, height);

    if (this.loadedIndex === null) return;
    const track = this.playlist[this.loadedIndex];
    if (!track.peaks) {
      track.peaks = generateProceduralPeaks(30000);
    }

    const peaks = track.peaks;
    const duration = this.audio.duration || 0;
    const currentTime = this.audio.currentTime || 0;

    if (duration === 0) {
      // Draw a flat line
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    // Zero horizontal line
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // 1-second window settings
    const windowSecs = 1;
    const halfWindow = windowSecs / 2;
    const pixelsPerSecond = width / windowSecs;

    // Draw vertical bars (e.g. 100 distinct bars across the width)
    const barCount = 100;
    const barPitch = width / barCount;
    const barWidth = barPitch - 2;

    const activeColor = this.id === 'a' ? '#00f2fe' : '#f35588';
    const inactiveColor = this.id === 'a' ? 'rgba(0, 242, 254, 0.25)' : 'rgba(243, 85, 136, 0.25)';

    for (let i = 0; i < barCount; i++) {
      const x = i * barPitch;
      
      // Calculate relative time offset for this bar
      const timeOffset = ((x - width / 2) / pixelsPerSecond);
      const t = currentTime + timeOffset;

      // Draw flat line if out of track bounds
      if (t < 0 || t > duration) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fillRect(x, height / 2 - 1, barWidth, 2);
        continue;
      }

      // Sample index
      const peakIdx = Math.floor((t / duration) * peaks.length);
      const peakVal = peaks[Math.min(peaks.length - 1, Math.max(0, peakIdx))] || 0;

      const barHeight = peakVal * height * 0.9;
      const y = (height - barHeight) / 2;

      // Left of center is played (active color), right of center is incoming (inactive color)
      if (x <= width / 2) {
        ctx.fillStyle = activeColor;
      } else {
        ctx.fillStyle = inactiveColor;
      }

      ctx.fillRect(x, y, barWidth, barHeight);
    }

    // Draw grid tick marks for tenths of a second (100ms)
    const tickInterval = 0.1; // 100ms
    const startTick = Math.ceil((currentTime - halfWindow) / tickInterval);
    const endTick = Math.floor((currentTime + halfWindow) / tickInterval);
    
    for (let tick = startTick; tick <= endTick; tick++) {
      const t = tick * tickInterval;
      if (t < 0 || t > duration) continue;
      const tickX = width / 2 + (t - currentTime) * pixelsPerSecond;
      
      // Major ticks are integers or half-seconds (0.5s)
      const isMajor = Math.abs(t % 0.5) < 0.001 || Math.abs((t % 0.5) - 0.5) < 0.001;
      ctx.fillStyle = isMajor ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.12)';
      const tickHeight = isMajor ? 8 : 4;
      
      ctx.fillRect(tickX - 0.5, 0, 1, tickHeight);
      ctx.fillRect(tickX - 0.5, height - tickHeight, 1, tickHeight);
    }

    // Draw Central Playhead line (exact center)
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.shadowColor = activeColor;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset shadow

    // Draw vertical Cue Point line in Zoom mode
    if (duration > 0 && this.cueTime > 0) {
      const timeOffset = this.cueTime - currentTime;
      const cueX = width / 2 + timeOffset * pixelsPerSecond;
      
      if (cueX >= 0 && cueX <= width) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ff7a00'; // Neon Orange
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#ff7a00';
        ctx.beginPath();
        ctx.moveTo(cueX, 0);
        ctx.lineTo(cueX, height);
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow

        // Label
        ctx.fillStyle = '#ff7a00';
        ctx.font = 'bold 8px Orbitron, sans-serif';
        ctx.fillText('CUE', cueX + 4, 12);
      }
    }
  }

  // Setup Web Audio Graph for this deck
  initAudioGraph() {
    if (this.sourceNode) return; // Already initialized

    try {
      this.sourceNode = audioCtx.createMediaElementSource(this.audio);
      
      // EQ Nodes (Bass: Low Shelf, Mid: Peaking, Treble: High Shelf)
      this.eqLow = audioCtx.createBiquadFilter();
      this.eqLow.type = 'lowshelf';
      this.eqLow.frequency.value = 250;
      this.eqLow.gain.value = 0;

      this.eqMid = audioCtx.createBiquadFilter();
      this.eqMid.type = 'peaking';
      this.eqMid.frequency.value = 1500;
      this.eqMid.Q.value = 1.0;
      this.eqMid.gain.value = 0;

      this.eqHigh = audioCtx.createBiquadFilter();
      this.eqHigh.type = 'highshelf';
      this.eqHigh.frequency.value = 8000;
      this.eqHigh.gain.value = 0;

      // Analyser Node for Visualizers & VU Meter
      this.analyser = audioCtx.createAnalyser();
      this.analyser.fftSize = 256;

      // Volume Channel Fader
      this.channelGainNode = audioCtx.createGain();
      // Start channel fader volume from slider setting
      const initialVol = parseFloat(document.getElementById(`mixer-${this.id}-volume`).value);
      this.channelGainNode.gain.setValueAtTime(initialVol, audioCtx.currentTime);

      // Crossfader volume modifier
      this.crossfadeGainNode = audioCtx.createGain();
      
      // Routing
      // Audio -> Low -> Mid -> High -> Analyser -> Channel Fader -> Crossfader Gain -> Destination
      this.sourceNode.connect(this.eqLow);
      this.eqLow.connect(this.eqMid);
      this.eqMid.connect(this.eqHigh);
      this.eqHigh.connect(this.analyser);
      this.analyser.connect(this.channelGainNode);
      this.channelGainNode.connect(this.crossfadeGainNode);
      this.crossfadeGainNode.connect(audioCtx.destination);
    } catch (e) {
      console.error(`Failed to setup Audio Graph for Deck ${this.id.toUpperCase()}:`, e);
    }
  }

  // Load playlists & default tracks
  setPlaylist(tracks) {
    this.playlist = tracks.map((t, idx) => ({
      id: t.id || `${this.id}-${Date.now()}-${idx}`,
      title: t.title || 'Unknown Track',
      url: t.url || t.uri || null,
      file: t.file || null,
      bpm: t.bpm || null,
      duration: t.duration || 0,
      cueTime: t.cueTime || 0,
      peaks: t.peaks || generateProceduralPeaks(30000)
    }));
    this.renderPlaylist();
  }

  // Add individual track
  addTrack(track) {
    if (!track.peaks) {
      track.peaks = generateProceduralPeaks(30000);
    }
    track.cueTime = track.cueTime || 0;
    track.url = track.url || track.uri || null;
    track.file = track.file || null;
    this.playlist.push(track);
    this.renderPlaylist();
    if (this.loadedIndex === null) {
      this.loadTrack(0, false);
    }

    // Background decode exact waveform peaks for local files
    if (track.file) {
      this.decodeTrackWaveform(track);
    }
  }

  // Re-render playlist table
  renderPlaylist() {
    this.playlistBody.innerHTML = '';
    
    if (this.playlist.length === 0) {
      this.emptyMsg.style.display = 'block';
      return;
    } else {
      this.emptyMsg.style.display = 'none';
    }

    this.playlist.forEach((track, index) => {
      const tr = document.createElement('tr');
      tr.dataset.index = index;
      
      const isLocalMissing = !track.file && track.url && !track.url.startsWith('http://') && !track.url.startsWith('https://') && !track.url.startsWith('data:');
      
      // Determine loaded and highlighted classes
      if (index === this.loadedIndex) {
        tr.classList.add('loaded-track');
      }
      if (index === this.highlightedIndex) {
        tr.classList.add('highlighted-track');
      }
      if (isLocalMissing) {
        tr.classList.add('missing-file-track');
      }

      // Format duration
      let durText = '--:--';
      if (track.duration > 0) {
        const m = Math.floor(track.duration / 60);
        const s = Math.floor(track.duration % 60);
        durText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      }

      let titleHtml = escapeHtml(track.title);
      if (isLocalMissing) {
        titleHtml = `<span class="missing-file-warning" title="Locally Missing - Hitting Play will prompt you to locate the file!">${escapeHtml(track.title)} <span style="color: #ff5555; font-size: 10px; margin-left: 6px; font-weight: bold;">⚠️ OFFLINE</span></span>`;
      }

      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${titleHtml}</td>
        <td class="bpm-cell" data-index="${index}">${track.bpm ? (Number.isInteger(track.bpm) ? track.bpm : track.bpm.toFixed(2)) : '--'}</td>
        <td>${durText}</td>
        <td>
          <button class="play-row-btn" title="Load & Cue">LOAD</button>
          <button class="delete-row-btn" title="Remove">🗑️</button>
        </td>
      `;

      // Event listener for row selection (highlight)
      tr.addEventListener('click', (e) => {
        // Prevent trigger if clicking on inputs, action buttons
        if (e.target.classList.contains('play-row-btn') || 
            e.target.classList.contains('delete-row-btn') || 
            e.target.tagName === 'INPUT') {
          return;
        }
        this.highlightTrack(index);
      });

      // Actions within rows
      tr.querySelector('.play-row-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.loadTrack(index, false); // Load & Cue (no autoplay)
      });

      tr.querySelector('.delete-row-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const trackTitle = this.playlist[index].title;
        if (confirm(`Are you sure you want to remove "${trackTitle}" from the playlist?`)) {
          this.removeTrack(index);
        }
      });

      // Double-click to inline edit BPM
      const bpmCell = tr.querySelector('.bpm-cell');
      bpmCell.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.startBpmEdit(bpmCell, index);
      });

      this.playlistBody.appendChild(tr);
    });
  }

  highlightTrack(index) {
    this.highlightedIndex = index;
    // Toggle class directly on existing rows to preserve DOM elements and enable double-clicks
    const rows = Array.from(this.playlistBody.children);
    rows.forEach((row, idx) => {
      if (idx === index) {
        row.classList.add('highlighted-track');
      } else {
        row.classList.remove('highlighted-track');
      }
    });
  }

  removeTrack(index) {
    // If we're removing the currently loaded track, stop it first
    if (index === this.loadedIndex) {
      this.stop();
      this.loadedIndex = null;
      this.trackTitleText.textContent = 'NO TRACK LOADED';
      this.timeCurrentText.textContent = '00:00';
      this.timeRemainText.textContent = '-00:00';
      this.bpmText.textContent = '--';
      this.progressFill.style.width = '0%';
    }
    
    this.playlist.splice(index, 1);
    
    // Adjust indices
    if (this.loadedIndex > index) this.loadedIndex--;
    if (this.highlightedIndex === index) {
      this.highlightedIndex = null;
    } else if (this.highlightedIndex > index) {
      this.highlightedIndex--;
    }
    
    this.renderPlaylist();
  }

  // Double click BPM editor
  startBpmEdit(cell, index) {
    const currentBpm = this.playlist[index].bpm;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.className = 'bpm-input';
    input.placeholder = 'BPM';
    input.value = currentBpm || '';
    
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();

    const saveBpm = () => {
      const parsed = parseFloat(input.value);
      if (isNaN(parsed) || parsed <= 0) {
        this.playlist[index].bpm = null;
      } else {
        let val = parsed;
        if (val < 40) val = 40;
        if (val > 250) val = 250;
        // Keep up to two decimal places
        val = parseFloat(val.toFixed(2));
        this.playlist[index].bpm = val;
      }
      this.renderPlaylist();
      // If currently loaded, update pitch display as well
      if (index === this.loadedIndex) {
        this.updateBpmDisplay();
      }
    };

    input.addEventListener('blur', saveBpm);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') saveBpm();
    });
  }

  // Load a track from playlist index
  loadTrack(index, autoplay = false, forcePrompt = false) {
    if (index < 0 || index >= this.playlist.length) return;

    const track = this.playlist[index];
    const isLocalMissing = !track.file && track.url && !track.url.startsWith('http://') && !track.url.startsWith('https://') && !track.url.startsWith('data:');

    if (isLocalMissing) {
      if (autoplay || forcePrompt) {
        // Prompt user to select/locate the file!
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'audio/*';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileInput.onchange = (e) => {
          const file = e.target.files[0];
          if (file) {
            track.file = file;
            track.url = URL.createObjectURL(file);
            this.renderPlaylist();
            this.decodeTrackWaveform(track);
            // Now proceed to load the track!
            this.loadTrack(index, autoplay, forcePrompt);
          }
          document.body.removeChild(fileInput);
        };
        
        fileInput.click();
        return;
      } else {
        // If autoplay and forcePrompt are false, just load metadata and draw offline waveform without file picker!
        this.loadedIndex = index;
        this.audio.src = ""; // Clear src to avoid loading failures
        this.setPlayingState(false);
        this.cueTime = track.cueTime || 0;

        this.trackTitleText.textContent = track.title.toUpperCase();
        this.updateBpmDisplay();
        this.updateTimeDisplays();

        if (this.visMode === 'overview') {
          this.drawOverviewWaveform();
        } else if (this.visMode === 'zoom') {
          this.drawZoomWaveform();
        }
        
        this.renderPlaylist();
        return;
      }
    }

    this.loadedIndex = index;
    
    // Cancel old play state
    this.audio.pause();
    this.setPlayingState(false);
    this.cueTime = track.cueTime || 0;
    
    // Load source
    if (track.file) {
      this.audio.src = URL.createObjectURL(track.file);
    } else if (track.url) {
      this.audio.src = track.url;
    }

    this.audio.load();

    // Reset pitch fader & application
    this.audio.playbackRate = 1.0 + (this.pitch / 100.0);

    // Dynamic title display
    this.trackTitleText.textContent = track.title.toUpperCase();
    this.updateBpmDisplay();

    this.audio.onloadedmetadata = () => {
      // Save duration if we didn't have it
      if (this.playlist[index].duration === 0) {
        this.playlist[index].duration = this.audio.duration;
        this.renderPlaylist();
      }
      
      // Set playhead position directly to the saved cue point
      this.audio.currentTime = this.cueTime;
      this.updateTimeDisplays();
      
      // Update the static overview or zoom visualizer visual
      if (this.visMode === 'overview') {
        this.drawOverviewWaveform();
      } else if (this.visMode === 'zoom') {
        this.drawZoomWaveform();
      }
    };

    this.audio.onerror = (e) => {
      console.error('Audio loading error:', e);
      this.trackTitleText.textContent = 'LOADING ERROR - CORS OR INVALID URL';
    };

    // Try decoding local file peaks if not already decoded
    if (track.file) {
      this.decodeTrackWaveform(track);
    }

    this.renderPlaylist();

    // Draw initial waveform shape right away (procedural peak data)
    if (this.visMode === 'overview') {
      this.drawOverviewWaveform();
    } else if (this.visMode === 'zoom') {
      this.drawZoomWaveform();
    }

    if (autoplay) {
      // Auto-init Web Audio on first gesture
      initAudioContext();
      this.initAudioGraph();
      
      // Delay play slightly to avoid browser context race
      setTimeout(() => {
        this.play();
      }, 50);
    }
  }

  play() {
    if (this.loadedIndex === null) {
      // If nothing loaded, try playing highlighted or first track
      if (this.highlightedIndex !== null) {
        this.loadTrack(this.highlightedIndex, true);
      } else if (this.playlist.length > 0) {
        this.loadTrack(0, true);
      }
      return;
    }

    const track = this.playlist[this.loadedIndex];
    const isLocalMissing = !track.file && track.url && !track.url.startsWith('http://') && !track.url.startsWith('https://') && !track.url.startsWith('data:');

    if (isLocalMissing) {
      // Trigger loadTrack with autoplay = true to open the relocation file explorer
      this.loadTrack(this.loadedIndex, true);
      return;
    }

    initAudioContext();
    this.initAudioGraph();

    this.audio.play()
      .then(() => {
        this.setPlayingState(true);
        this.playBtn.classList.add('active');
        this.playBtn.querySelector('.play-icon').classList.add('hidden');
        this.playBtn.querySelector('.pause-icon').classList.remove('hidden');
        this.vinyl.classList.add('spinning');
        this.tonearm.classList.add('active');
        
        // Start visuals rendering loops
        drawVisuals(this);
      })
      .catch(err => {
        console.warn('Autoplay blocked or play failed:', err);
      });
  }

  pause() {
    this.audio.pause();
    this.setPlayingState(false);
    this.playBtn.classList.remove('active');
    this.playBtn.querySelector('.play-icon').classList.remove('hidden');
    this.playBtn.querySelector('.pause-icon').classList.add('hidden');
    this.vinyl.classList.remove('spinning');
    this.tonearm.classList.remove('active');
  }

  stop() {
    this.pause();
    this.audio.currentTime = 0;
    this.updateTimeDisplays();
    this.progressFill.style.width = '0%';
  }

  cue() {
    initAudioContext();
    this.initAudioGraph();

    if (this.isPlaying) {
      // If playing, return to cue point and pause
      this.pause();
      this.audio.currentTime = this.cueTime;
    } else {
      // If paused, set new cue point at current position, or if already there, tap play
      if (this.audio.currentTime === this.cueTime) {
        this.play();
      } else {
        this.cueTime = this.audio.currentTime;
        if (this.loadedIndex !== null) {
          this.playlist[this.loadedIndex].cueTime = this.cueTime;
        }
        if (this.visMode === 'overview') {
          this.drawOverviewWaveform();
        } else if (this.visMode === 'zoom') {
          this.drawZoomWaveform();
        }
      }
    }
  }

  next() {
    if (this.playlist.length === 0) return;
    let nextIdx = (this.loadedIndex !== null ? this.loadedIndex + 1 : 0);
    if (nextIdx >= this.playlist.length) nextIdx = 0;
    this.loadTrack(nextIdx, this.isPlaying);
  }

  // Adjust pitch rate (-8% to +8%)
  setPitch(val) {
    this.pitch = parseFloat(val);
    const playbackRate = 1.0 + (this.pitch / 100.0);
    this.audio.playbackRate = playbackRate;
    
    // Update Text display
    const sign = this.pitch >= 0 ? '+' : '';
    this.pitchValueText.textContent = `${sign}${this.pitch.toFixed(1)}%`;
    this.updateBpmDisplay();
    
    // Dynamically speed up/slow down vinyl spinning animation
    if (this.isPlaying) {
      const baseDuration = 3.0; // 3 seconds per rotation at 1.0 speed
      const newDuration = baseDuration / playbackRate;
      this.vinyl.style.animationDuration = `${newDuration.toFixed(2)}s`;
    }
  }

  resetPitch() {
    this.pitchSlider.value = 0;
    this.setPitch(0);
  }

  // Render dynamic BPM display relative to Pitch
  updateBpmDisplay() {
    if (this.loadedIndex === null) {
      this.bpmText.textContent = '--';
      return;
    }
    const baseBpm = this.playlist[this.loadedIndex].bpm;
    if (!baseBpm) {
      this.bpmText.textContent = '--';
      return;
    }
    const adjustedBpm = baseBpm * (1.0 + (this.pitch / 100.0));
    this.bpmText.textContent = adjustedBpm.toFixed(2);
  }

  // Render remaining and current play timer metrics
  updateTimeDisplays() {
    if (!this.audio.duration) return;
    
    const curr = this.audio.currentTime;
    const dur = this.audio.duration;
    const remain = Math.max(0, dur - curr);

    // Current Time
    const cm = Math.floor(curr / 60);
    const cs = Math.floor(curr % 60);
    this.timeCurrentText.textContent = `${cm.toString().padStart(2, '0')}:${cs.toString().padStart(2, '0')}`;

    // Remaining Time
    const rm = Math.floor(remain / 60);
    const rs = Math.floor(remain % 60);
    this.timeRemainText.textContent = `-${rm.toString().padStart(2, '0')}:${rs.toString().padStart(2, '0')}`;

    // Progress Bar Fill
    const percent = (curr / dur) * 100;
    this.progressFill.style.width = `${percent}%`;
  }
}

// Global Variables
let deckA = null;
let deckB = null;

let autoDjActive = false;
let autoDjTriggerSecs = 10;
let crossfadeDuration = 10; // same as trigger
let crossfadeIntervalId = null;
let isCrossfading = false;

// ==========================================
// Initializations
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  // Setup Decks
  deckA = new Deck(
    'a', 
    'audio-deck-a', 
    'deck-a-visualizer', 
    'deck-a-vinyl', 
    'deck-a-tonearm', 
    'playlist-body-a', 
    'empty-msg-a',
    'deck-a-progress-bar',
    'deck-a-progress-fill'
  );

  deckB = new Deck(
    'b', 
    'audio-deck-b', 
    'deck-b-visualizer', 
    'deck-b-vinyl', 
    'deck-b-tonearm', 
    'playlist-body-b', 
    'empty-msg-b',
    'deck-b-progress-bar',
    'deck-b-progress-fill'
  );

  // Playlists start empty
  deckA.renderPlaylist();
  deckB.renderPlaylist();

  // Setup Event Listeners
  setupControllerListeners();
  setupAutodjListeners();
  setupGlobalShortcuts();

  // Start digital clock
  setInterval(updateClock, 1000);
});

// Initialize context on user click
function initAudioContext() {
  if (audioCtx) return;
  
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  const indicator = document.getElementById('audio-status');
  indicator.classList.remove('offline');
  indicator.classList.add('online');
  indicator.textContent = 'AUDIO ENGINE: ONLINE';
}

function updateClock() {
  const clock = document.getElementById('clock-display');
  const now = new Date();
  clock.textContent = now.toTimeString().split(' ')[0];
}

// ==========================================
// Playlist Imports & Exports
// ==========================================

function exportPlaylist(deck) {
  // Prepare JSON (omit files, keep URL, BPM, and cue point metadata)
  const data = deck.playlist.map(t => ({
    title: t.title,
    url: t.url || (t.file ? t.file.name : null),
    bpm: t.bpm || null,
    duration: t.duration || 0,
    cueTime: t.cueTime || 0
  }));

  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `VibeDJ_Playlist_${deck.id.toUpperCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function triggerImportFile(deck) {
  const inputEl = document.getElementById(`file-import-${deck.id}`);
  inputEl.click();
}

function handleImportFile(deck, event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const tracks = JSON.parse(e.target.result);
      if (Array.isArray(tracks)) {
        deck.setPlaylist(tracks);
        deck.loadTrack(0, false);
      } else {
        alert('Invalid playlist format. Must be an array of tracks.');
      }
    } catch (err) {
      alert('Error parsing playlist JSON file.');
      console.error(err);
    }
  };
  reader.readAsText(file);
}

// ==========================================
// Controller Controls Listeners
// ==========================================

function setupControllerListeners() {
  // Play/Pause, Stop, Cue, Next actions per deck
  [deckA, deckB].forEach(deck => {
    deck.playBtn.addEventListener('click', () => {
      if (deck.isPlaying) deck.pause();
      else deck.play();
    });

    deck.stopBtn.addEventListener('click', () => deck.stop());
    deck.cueBtn.addEventListener('click', () => deck.cue());
    deck.nextBtn.addEventListener('click', () => deck.next());

    // Pitch Range Slider
    deck.pitchSlider.addEventListener('input', (e) => deck.setPitch(e.target.value));
    deck.pitchResetBtn.addEventListener('click', () => deck.resetPitch());

    // Audio Metadata progress bar seeking
    deck.progressBar.addEventListener('click', (e) => {
      if (!deck.audio.duration) return;
      const rect = deck.progressBar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = clickX / rect.width;
      deck.audio.currentTime = deck.audio.duration * pct;
      deck.updateTimeDisplays();
    });

    // Audio elements update hooks
    deck.audio.addEventListener('timeupdate', () => {
      deck.updateTimeDisplays();
      checkAutoDjTrigger(); // Check AutoDJ transitions

      // Update progress visuals on static waveform overview or zoom
      if (deck.visMode === 'overview') {
        deck.drawOverviewWaveform();
      } else if (deck.visMode === 'zoom') {
        deck.drawZoomWaveform();
      }
    });

    deck.audio.addEventListener('ended', () => {
      deck.stop();
      if (!autoDjActive) {
        // Standard playback next track
        deck.next();
      }
    });

    // Add URL Loader action
    document.getElementById(`btn-load-url-${deck.id}`).addEventListener('click', () => {
      const urlInput = document.getElementById(`url-input-${deck.id}`);
      const url = urlInput.value.trim();
      if (!url) return;

      // Extract raw title from end of filename
      let title = 'URL Track';
      try {
        const decoded = decodeURIComponent(url);
        const parts = decoded.split('/');
        const filePart = parts[parts.length - 1];
        if (filePart) title = filePart.replace(/\.[^/.]+$/, "");
      } catch(e){}

      deck.addTrack({
        id: `${deck.id}-${Date.now()}`,
        title: title,
        url: url,
        bpm: null,
        duration: 0
      });
      urlInput.value = '';
    });

    // Local file picker loader
    const filePicker = document.getElementById(`file-input-${deck.id}`);
    filePicker.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const fileName = file.name.replace(/\.[^/.]+$/, "");
        
        // Check if there is an existing track in the playlist with no file,
        // whose title matches the file name (case-insensitive, ignoring extension)
        // or whose URL matches the exact imported local filename
        const matchedTrack = deck.playlist.find(t => 
          !t.file && 
          (t.title.toLowerCase() === fileName.toLowerCase() || 
           (t.url && (t.url.toLowerCase() === file.name.toLowerCase() || t.url.toLowerCase() === fileName.toLowerCase())))
        );

        if (matchedTrack) {
          // Relocate/bind the file to this existing track!
          matchedTrack.file = file;
          matchedTrack.url = URL.createObjectURL(file);
          deck.decodeTrackWaveform(matchedTrack);
        } else {
          // Add as a new track!
          deck.addTrack({
            id: `${deck.id}-${Date.now()}-${Math.random()}`,
            title: fileName,
            file: file,
            bpm: null,
            duration: 0
          });
        }
      });
      deck.renderPlaylist();

      // If the currently loaded track was matched and bound, reload it!
      if (deck.loadedIndex !== null) {
        const loadedTrack = deck.playlist[deck.loadedIndex];
        if (loadedTrack.file && !deck.audio.src) {
          deck.loadTrack(deck.loadedIndex, deck.isPlaying);
        }
      }
      
      // Clear file picker so same file can be uploaded again
      filePicker.value = '';
    });

    // Local folder relocation picker
    const folderPicker = document.getElementById(`folder-input-${deck.id}`);
    folderPicker.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      let relocatedCount = 0;

      files.forEach(file => {
        // Skip files that aren't audio
        if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i)) {
          return;
        }

        const fileName = file.name.replace(/\.[^/.]+$/, "");
        
        // Find existing offline tracks that match
        const matchedTrack = deck.playlist.find(t => 
          !t.file && 
          (t.title.toLowerCase() === fileName.toLowerCase() || 
           (t.url && (t.url.toLowerCase() === file.name.toLowerCase() || t.url.toLowerCase() === fileName.toLowerCase())))
        );

        if (matchedTrack) {
          matchedTrack.file = file;
          matchedTrack.url = URL.createObjectURL(file);
          deck.decodeTrackWaveform(matchedTrack);
          relocatedCount++;
        }
      });

      deck.renderPlaylist();

      // If the currently loaded track was matched and bound, reload it!
      if (deck.loadedIndex !== null) {
        const loadedTrack = deck.playlist[deck.loadedIndex];
        if (loadedTrack.file && !deck.audio.src) {
          deck.loadTrack(deck.loadedIndex, deck.isPlaying);
        }
      }

      // Show alert with the count of successfully relocated tracks
      if (relocatedCount > 0) {
        alert(`Folder scanned! Successfully matched and relocated ${relocatedCount} offline track(s).`);
      } else {
        alert(`Folder scanned, but no matching offline tracks were found in the selected folder.`);
      }

      // Clear picker value
      folderPicker.value = '';
    });

    // Visualizer Toggle Mode Button
    deck.visToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Cycle through 3 modes: overview -> zoom -> live -> overview
      if (deck.visMode === 'overview') {
        deck.visMode = 'zoom';
        deck.visToggleBtn.textContent = '🔍 ZOOM WAVE';
        deck.drawZoomWaveform();
      } else if (deck.visMode === 'zoom') {
        deck.visMode = 'live';
        deck.visToggleBtn.textContent = '⚡ LIVE WAVE';
        // Clear canvas and trigger live visualizer if playing
        deck.canvasCtx.fillStyle = '#08090d';
        deck.canvasCtx.fillRect(0, 0, deck.canvas.width, deck.canvas.height);
        if (deck.isPlaying) {
          drawVisuals(deck);
        }
      } else {
        deck.visMode = 'overview';
        deck.visToggleBtn.textContent = '📊 OVERVIEW';
        deck.drawOverviewWaveform();
      }
    });

    // Make canvas clickable & draggable to scrub/seek during overview or zoom modes
    deck.canvas.addEventListener('mousedown', (e) => {
      if (!deck.audio.duration) return;
      
      initAudioContext();
      deck.initAudioGraph();

      const rect = deck.canvas.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const startTime = deck.audio.currentTime;
      let hasDragged = false;
      const wasPlaying = deck.isPlaying;

      if (wasPlaying) {
        deck.audio.pause();
      }

      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          hasDragged = true;
        }

        if (hasDragged) {
          if (deck.visMode === 'overview') {
            const pct = (moveEvent.clientX - rect.left) / rect.width;
            deck.audio.currentTime = deck.audio.duration * Math.max(0, Math.min(1, pct));
            deck.updateTimeDisplays();
            deck.drawOverviewWaveform();
          } else if (deck.visMode === 'zoom') {
            const pixelsPerSecond = rect.width / 1; // 1 second window
            const deltaSecs = -deltaX / pixelsPerSecond;
            const targetTime = startTime + deltaSecs;
            deck.audio.currentTime = Math.max(0, Math.min(deck.audio.duration, targetTime));
            deck.updateTimeDisplays();
            deck.drawZoomWaveform();
          }
        }
      };

      const onMouseUp = (upEvent) => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        if (!hasDragged) {
          // Normal click behavior
          const clickX = upEvent.clientX - rect.left;
          if (deck.visMode === 'overview') {
            const pct = clickX / rect.width;
            deck.audio.currentTime = deck.audio.duration * pct;
            deck.updateTimeDisplays();
            deck.drawOverviewWaveform();
          } else if (deck.visMode === 'zoom') {
            const pixelsPerSecond = rect.width / 1; // 1 second window
            const timeOffset = (clickX - rect.width / 2) / pixelsPerSecond;
            const targetTime = startTime + timeOffset;
            deck.audio.currentTime = Math.max(0, Math.min(deck.audio.duration, targetTime));
            deck.updateTimeDisplays();
            deck.drawZoomWaveform();
          }
        }

        if (wasPlaying) {
          deck.audio.play().catch(err => console.warn(err));
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    // Import/Export buttons
    document.getElementById(`btn-export-${deck.id}`).addEventListener('click', () => exportPlaylist(deck));
    document.getElementById(`btn-import-${deck.id}`).addEventListener('click', () => triggerImportFile(deck));
    document.getElementById(`file-import-${deck.id}`).addEventListener('change', (e) => handleImportFile(deck, e));
  });

  // Mixer EQ Knobs & Kills Listeners
  ['a', 'b'].forEach(ch => {
    const deck = ch === 'a' ? deckA : deckB;

    const setupEqKnobAndKill = (eqId, nodeProp) => {
      const knob = document.getElementById(`mixer-${ch}-eq-${eqId}`);
      const valText = document.getElementById(`mixer-${ch}-eq-${eqId}-val`);
      const killBtn = document.getElementById(`mixer-${ch}-kill-${eqId}`);
      
      const min = parseFloat(knob.dataset.min) || -12;
      const max = parseFloat(knob.dataset.max) || 12;
      const range = max - min;
      
      // Initialize rotation visually
      const initVal = parseFloat(knob.dataset.value) || 0;
      const initPct = (initVal - min) / range;
      const initAngle = -135 + initPct * 270;
      knob.style.transform = `rotate(${initAngle}deg)`;

      // Mouse drag logic
      knob.addEventListener('mousedown', (e) => {
        e.preventDefault();
        initAudioContext();
        deck.initAudioGraph();

        const startY = e.clientY;
        const startVal = parseFloat(knob.dataset.value) || 0;
        const sensitivity = 150; // Drag Y distance (px) for full sweep

        const onMouseMove = (moveEvent) => {
          const deltaY = startY - moveEvent.clientY; // up is positive delta
          let newVal = startVal + (deltaY / sensitivity) * range;
          newVal = Math.max(min, Math.min(max, newVal));

          // Save current val attribute
          knob.dataset.value = newVal;

          // Visual Rotate Pointer
          const pct = (newVal - min) / range;
          const angle = -135 + pct * 270;
          knob.style.transform = `rotate(${angle}deg)`;

          // Adjust audio filter (if not killed)
          const isKilled = killBtn.classList.contains('active');
          if (isKilled) {
            valText.textContent = `KILL`;
          } else {
            valText.textContent = `${newVal >= 0 ? '+' : ''}${newVal.toFixed(1)}dB`;
            if (deck[nodeProp]) {
              deck[nodeProp].gain.setValueAtTime(newVal, audioCtx.currentTime);
            }
          }
        };

        const onMouseUp = () => {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });

      // Double click to reset value to 0dB
      knob.addEventListener('dblclick', (e) => {
        e.preventDefault();
        initAudioContext();
        deck.initAudioGraph();

        // Reset value
        knob.dataset.value = 0;

        // Reset visual rotation pointer (center)
        const pct = (0 - min) / range;
        const angle = -135 + pct * 270;
        knob.style.transform = `rotate(${angle}deg)`;

        // Adjust audio filter (if not currently killed)
        const isKilled = killBtn.classList.contains('active');
        if (isKilled) {
          valText.textContent = `KILL`;
        } else {
          valText.textContent = `0.0dB`;
          if (deck[nodeProp]) {
            deck[nodeProp].gain.setValueAtTime(0, audioCtx.currentTime);
          }
        }
      });

      // Kill button click logic
      killBtn.addEventListener('click', () => {
        initAudioContext();
        deck.initAudioGraph();

        const isCurrentlyKilled = killBtn.classList.contains('active');
        if (isCurrentlyKilled) {
          // Disable Kill -> Restore current knob value
          killBtn.classList.remove('active');
          const currentVal = parseFloat(knob.dataset.value) || 0;
          valText.textContent = `${currentVal >= 0 ? '+' : ''}${currentVal.toFixed(1)}dB`;
          
          if (deck[nodeProp]) {
            deck[nodeProp].gain.setValueAtTime(currentVal, audioCtx.currentTime);
          }
        } else {
          // Enable Kill -> Silence frequency
          killBtn.classList.add('active');
          valText.textContent = `KILL`;
          
          if (deck[nodeProp]) {
            // Mute frequency (set BiquadFilter gain to -40dB)
            deck[nodeProp].gain.setValueAtTime(-40, audioCtx.currentTime);
          }
        }
      });
    };

    setupEqKnobAndKill('hi', 'eqHigh');
    setupEqKnobAndKill('mid', 'eqMid');
    setupEqKnobAndKill('low', 'eqLow');

    // Volume Channel Faders
    const volSlider = document.getElementById(`mixer-${ch}-volume`);
    volSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value);
      if (deck.channelGainNode) {
        deck.channelGainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
      }
    });
  });

  // Master Crossfader
  const crossfader = document.getElementById('mixer-crossfader');
  crossfader.addEventListener('input', (e) => {
    applyCrossfade(parseFloat(e.target.value));
  });

  // Initial crossfade values alignment
  applyCrossfade(0.5);

  // Match BPM Button Click Listener
  const matchBpmBtn = document.getElementById('mixer-match-bpm');
  matchBpmBtn.addEventListener('click', () => {
    // 1. Ensure both decks have a loaded track
    if (deckA.loadedIndex === null || deckB.loadedIndex === null) {
      alert('Both decks must have a track loaded to perform beatmatching!');
      return;
    }
    const bpmA = deckA.playlist[deckA.loadedIndex].bpm;
    const bpmB = deckB.playlist[deckB.loadedIndex].bpm;
    if (!bpmA || !bpmB) {
      alert('Both loaded tracks must have a defined BPM value to match!');
      return;
    }

    // 2. Check play states to decide match strategy
    const isAPlaying = deckA.isPlaying;
    const isBPlaying = deckB.isPlaying;

    if (isAPlaying && !isBPlaying) {
      // Deck A is playing alone. Match Deck B to Deck A.
      const adjustedBpmA = bpmA * (1.0 + (deckA.pitch / 100.0));
      // Calculate target pitch for Deck B
      let targetPitchB = 100.0 * (adjustedBpmA / bpmB - 1.0);
      // Clamp to pitch limits (-8% to +8%)
      targetPitchB = Math.max(-8.0, Math.min(8.0, targetPitchB));
      
      deckB.pitchSlider.value = targetPitchB;
      deckB.setPitch(targetPitchB);
    } 
    else if (isBPlaying && !isAPlaying) {
      // Deck B is playing alone. Match Deck A to Deck B.
      const adjustedBpmB = bpmB * (1.0 + (deckB.pitch / 100.0));
      // Calculate target pitch for Deck A
      let targetPitchA = 100.0 * (adjustedBpmB / bpmA - 1.0);
      // Clamp to pitch limits (-8% to +8%)
      targetPitchA = Math.max(-8.0, Math.min(8.0, targetPitchA));
      
      deckA.pitchSlider.value = targetPitchA;
      deckA.setPitch(targetPitchA);
    } 
    else if (isAPlaying && isBPlaying) {
      // Both decks are playing. Determine which deck is dominant based on crossfader value.
      // If crossfader is to the left (<= 0.5), Deck A is dominant, else Deck B.
      const crossVal = parseFloat(document.getElementById('mixer-crossfader').value);
      if (crossVal <= 0.5) {
        // Deck A is dominant. Match Deck B to Deck A.
        const adjustedBpmA = bpmA * (1.0 + (deckA.pitch / 100.0));
        let targetPitchB = 100.0 * (adjustedBpmA / bpmB - 1.0);
        targetPitchB = Math.max(-8.0, Math.min(8.0, targetPitchB));
        deckB.pitchSlider.value = targetPitchB;
        deckB.setPitch(targetPitchB);
      } else {
        // Deck B is dominant. Match Deck A to Deck B.
        const adjustedBpmB = bpmB * (1.0 + (deckB.pitch / 100.0));
        let targetPitchA = 100.0 * (adjustedBpmB / bpmA - 1.0);
        targetPitchA = Math.max(-8.0, Math.min(8.0, targetPitchA));
        deckA.pitchSlider.value = targetPitchA;
        deckA.setPitch(targetPitchA);
      }
    } 
    else {
      // Neither deck is playing. Set both decks pitch to achieve the average base BPM.
      const avgBpm = (bpmA + bpmB) / 2.0;
      
      let targetPitchA = 100.0 * (avgBpm / bpmA - 1.0);
      targetPitchA = Math.max(-8.0, Math.min(8.0, targetPitchA));
      deckA.pitchSlider.value = targetPitchA;
      deckA.setPitch(targetPitchA);

      let targetPitchB = 100.0 * (avgBpm / bpmB - 1.0);
      targetPitchB = Math.max(-8.0, Math.min(8.0, targetPitchB));
      deckB.pitchSlider.value = targetPitchB;
      deckB.setPitch(targetPitchB);
    }
  });

  // Play Both Decks simultaneously click listener
  const playBothBtn = document.getElementById('mixer-play-both');
  playBothBtn.addEventListener('click', () => {
    // Only work when no deck is playing
    if (deckA.isPlaying || deckB.isPlaying) {
      return;
    }

    if (deckA.loadedIndex === null && deckB.loadedIndex === null) {
      alert('Load tracks onto the decks before playing!');
      return;
    }

    // Initialize audio context to unlock sound on click gesture
    initAudioContext();

    if (deckA.loadedIndex !== null) {
      deckA.play();
    }
    if (deckB.loadedIndex !== null) {
      deckB.play();
    }
  });
}

// Compute Constant-Power Crossfading Curves
function applyCrossfade(val) {
  // val is 0.0 (all Deck A) to 1.0 (all Deck B)
  // Constant power formula: cos (left) & sin (right)
  const leftVol = Math.cos(val * Math.PI / 2);
  const rightVol = Math.sin(val * Math.PI / 2);

  if (deckA.crossfadeGainNode) {
    deckA.crossfadeGainNode.gain.setValueAtTime(leftVol, audioCtx.currentTime);
  }
  if (deckB.crossfadeGainNode) {
    deckB.crossfadeGainNode.gain.setValueAtTime(rightVol, audioCtx.currentTime);
  }

  // Active Deck Status Indicator Updates
  const ledA = document.getElementById('led-deck-a');
  const ledB = document.getElementById('led-deck-b');
  
  if (val <= 0.1) {
    ledA.classList.add('active');
    ledB.classList.remove('active');
  } else if (val >= 0.9) {
    ledB.classList.add('active');
    ledA.classList.remove('active');
  } else {
    // Both active
    ledA.classList.add('active');
    ledB.classList.add('active');
  }
}

// ==========================================
// Keyboard Shortcuts Manager
// ==========================================

function setupGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Skip if user typing inside input boxes
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    const key = e.key.toLowerCase();
    
    // Determine target deck: if crossfader is to left, Deck A is primary. Otherwise Deck B.
    const crossfaderVal = parseFloat(document.getElementById('mixer-crossfader').value);
    const activeDeck = crossfaderVal < 0.5 ? deckA : deckB;

    if (e.code === 'Space') {
      e.preventDefault();
      if (activeDeck.isPlaying) activeDeck.pause();
      else activeDeck.play();
    } else if (key === 'a') {
      if (deckA.isPlaying) deckA.pause();
      else deckA.play();
    } else if (key === 'l') {
      if (deckB.isPlaying) deckB.pause();
      else deckB.play();
    } else if (key === 'c') {
      deckA.cue();
    }
  });
}

// ==========================================
// AutoDJ Core State Machine
// ==========================================

function setupAutodjListeners() {
  const toggleBtn = document.getElementById('autodj-toggle');
  const timeInput = document.getElementById('autodj-time');

  toggleBtn.addEventListener('click', () => {
    autoDjActive = !autoDjActive;
    if (autoDjActive) {
      toggleBtn.classList.add('active');
      autoDjTriggerSecs = parseInt(timeInput.value) || 10;
      crossfadeDuration = autoDjTriggerSecs;
    } else {
      toggleBtn.classList.remove('active');
      stopAutoCrossfade();
    }
  });

  timeInput.addEventListener('change', () => {
    autoDjTriggerSecs = parseInt(timeInput.value) || 10;
    crossfadeDuration = autoDjTriggerSecs;
  });
}

// Triggers transition if track nears completion
function checkAutoDjTrigger() {
  if (!autoDjActive || isCrossfading) return;

  const crossfaderVal = parseFloat(document.getElementById('mixer-crossfader').value);
  
  // Decide which source deck is currently active and can transition
  if (crossfaderVal <= 0.1 && deckA.isPlaying) {
    const remain = deckA.audio.duration - deckA.audio.currentTime;
    if (remain > 0 && remain <= autoDjTriggerSecs) {
      triggerAutoDjTransition(deckA, deckB);
    }
  } else if (crossfaderVal >= 0.9 && deckB.isPlaying) {
    const remain = deckB.audio.duration - deckB.audio.currentTime;
    if (remain > 0 && remain <= autoDjTriggerSecs) {
      triggerAutoDjTransition(deckB, deckA);
    }
  }
}

// Automate Deck transition over X seconds
function triggerAutoDjTransition(sourceDeck, targetDeck) {
  if (targetDeck.playlist.length === 0) {
    console.warn('AutoDJ transition skipped: target playlist is empty.');
    return;
  }

  isCrossfading = true;
  console.log(`AutoDJ: Transitioning from Deck ${sourceDeck.id.toUpperCase()} to Deck ${targetDeck.id.toUpperCase()} over ${crossfadeDuration}s...`);

  // Load next track on target deck if none loaded
  if (targetDeck.loadedIndex === null) {
    targetDeck.loadTrack(0, false);
  }

  // Pre-roll and start playing target deck
  targetDeck.play();

  // Visual feedback update
  const crossfader = document.getElementById('mixer-crossfader');
  const startVal = parseFloat(crossfader.value);
  const endVal = targetDeck.id === 'b' ? 1.0 : 0.0;
  
  const startTime = performance.now();
  const durationMs = crossfadeDuration * 1000;

  function animateFader(now) {
    if (!autoDjActive) {
      // Stopped intermediate
      isCrossfading = false;
      return;
    }

    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1.0);
    
    // Linear slider interpolation, mapped to constant-power in applyCrossfade
    const currentVal = startVal + (endVal - startVal) * progress;
    crossfader.value = currentVal;
    applyCrossfade(currentVal);

    if (progress < 1.0) {
      requestAnimationFrame(animateFader);
    } else {
      // Transition complete
      sourceDeck.stop();
      isCrossfading = false;
      console.log(`AutoDJ: Transition complete. Active Deck is now ${targetDeck.id.toUpperCase()}.`);
    }
  }

  requestAnimationFrame(animateFader);
}

function stopAutoCrossfade() {
  isCrossfading = false;
}

// ==========================================
// Real-time Canvas & VU Rendering Loop
// ==========================================

function drawVisuals(deck) {
  if (!deck.isPlaying) return;

  requestAnimationFrame(() => drawVisuals(deck));

  const width = deck.canvas.width;
  const height = deck.canvas.height;
  const ctx = deck.canvasCtx;

  // Toggle Mode overview waveform
  if (deck.visMode === 'overview') {
    deck.drawOverviewWaveform();
    
    // We still extract real-time analysis peaks for bouncing the VU fader LEDs
    if (deck.analyser) {
      const bufferLength = deck.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      deck.analyser.getByteTimeDomainData(dataArray);
      let peak = 0;
      for (let i = 0; i < bufferLength; i++) {
        const amplitude = Math.abs(dataArray[i] - 128);
        if (amplitude > peak) {
          peak = amplitude;
        }
      }
      updateVuMeter(deck.vuContainer, peak / 128.0);
    }
    return;
  }

  // Toggle Mode zoom waveform
  if (deck.visMode === 'zoom') {
    deck.drawZoomWaveform();
    
    // We still extract real-time analysis peaks for bouncing the VU fader LEDs
    if (deck.analyser) {
      const bufferLength = deck.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      deck.analyser.getByteTimeDomainData(dataArray);
      let peak = 0;
      for (let i = 0; i < bufferLength; i++) {
        const amplitude = Math.abs(dataArray[i] - 128);
        if (amplitude > peak) {
          peak = amplitude;
        }
      }
      updateVuMeter(deck.vuContainer, peak / 128.0);
    }
    return;
  }

  // Live spectrogram mode
  ctx.fillStyle = 'rgba(8, 9, 13, 0.25)';
  ctx.fillRect(0, 0, width, height);

  if (!deck.analyser) return;

  // Time-domain Waveform extraction
  const bufferLength = deck.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  deck.analyser.getByteTimeDomainData(dataArray);

  // Draw Glowing waveform line
  ctx.lineWidth = 3;
  ctx.strokeStyle = deck.id === 'a' ? 'rgba(0, 242, 254, 0.85)' : 'rgba(243, 85, 136, 0.85)';
  ctx.shadowBlur = 8;
  ctx.shadowColor = deck.id === 'a' ? 'rgba(0, 242, 254, 0.6)' : 'rgba(243, 85, 136, 0.6)';

  ctx.beginPath();
  const sliceWidth = width / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0; // center at 1
    const y = (v * height) / 2;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

    x += sliceWidth;
  }

  ctx.lineTo(width, height / 2);
  ctx.stroke();
  ctx.shadowBlur = 0; // Reset shadows

  // Peak analysis for LED VU meter
  let peak = 0;
  for (let i = 0; i < bufferLength; i++) {
    const amplitude = Math.abs(dataArray[i] - 128);
    if (amplitude > peak) {
      peak = amplitude;
    }
  }

  // Normalize Peak scale [0.0 - 1.0]
  const normalizedPeak = peak / 128.0;
  updateVuMeter(deck.vuContainer, normalizedPeak);
}

// Light up LED strips matching peak power amplitude
function updateVuMeter(vuContainer, normalizedPeak) {
  const leds = Array.from(vuContainer.children);
  const totalLeds = leds.length;
  // Threshold curves: first index is top red, last is bottom green
  const litCount = Math.round(normalizedPeak * 1.5 * totalLeds); // scale a bit to make it bouncy

  leds.forEach((led, idx) => {
    // VU is ordered top-to-bottom: [RED, AMBER, GREEN...]
    // A high litCount lights up leds starting from bottom (index totalLeds-1) upwards
    const reverseIndex = totalLeds - 1 - idx;
    if (reverseIndex < litCount) {
      led.classList.add('lit');
    } else {
      led.classList.remove('lit');
    }
  });
}

// Helper to escape HTML and prevent XSS injections
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
