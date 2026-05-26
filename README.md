# 🎛️ VibeDJ — Professional Browser DJ Console

VibeDJ is a high-fidelity, interactive, and completely client-side DJ mixing console. Built entirely with vanilla HTML5, CSS3, and JavaScript, it runs 100% dependency-free directly in the web browser. 

Featuring professional Web Audio API signal routing, a real-time three-mode canvas visualization suite, intelligent playlist portability with smart directory file-matching relocation, and a precise AutoDJ transition automator, VibeDJ delivers a studio-grade digital vinyl system (DVS) and CDJ experience on the web.

---

## ✨ Features & Architecture

### 1. Symmetrical Dual-Deck Console & Central Mixer
* **Flanking Turntables**: Two identical digital vinyl decks (Deck A & Deck B) styled with a sleek, graphite-slate dark theme, neon accent glows, and realistic rotating vinyl platters. 
* **Mechanical needle arms** pivot dynamically onto the vinyl record during active playback and automatically swing back to standby when paused or stopped.
* **3-Band EQ System**: Studio-grade vertical rotary controls adjusting High (Highshelf), Mid (Peaking), and Low (Lowshelf) frequencies between `-12dB` and `+12dB` with a 0.0dB center-detent double-click reset.
* **Instant EQ Kill Buttons**: Dedicated **K** buttons adjacent to each knob immediately plunge the frequency band to `-40dB` (glowing active red and displaying a distinct `KILL` warning overlay) for clean isolate cuts.
* **Master Crossfader**: Smooth linear crossfader employing a constant-power mathematical curve to guarantee equal sound pressure levels when blending channels.
* **Responsive VU LED Strips**: Dual stereo-style amplitude meters that bounce dynamically in response to real-time signal peaks.

### 2. High-Precision Pitch Shifting & CDJ-Style BPM
* **Dynamic BPM Calculations**: Mirrors professional Pioneer CDJ/Rekordbox hardware displays. The digital BPM readout atop the turntable dynamically recalculates in real-time with **two-decimal precision** (`toFixed(2)`) to account for speed pitch adjustments.
* **Speed Faders**: High-resolution range sliders adjusting the playback speed (`-8%` to `+8%`) with proportional vinyl platter rotation speed scaling.
* **Floating Point Editing**: Supports full double-click inline BPM editing in the playlist with incremental decimal values (`0.01` steps) which automatically recalculate the active playback rates.
* **Intelligent MATCH BPM Controls**: A dedicated amber-accented physical button on the mixer central column. Clicking it instantly beatmatches loaded tracks based on real-time play states:
  - **Single Deck Playing**: Dynamically matches the pitch slider on the idle deck to make its BPM match the active, adjusted playing rate of the live deck.
  - **Dual Decks Playing**: Automatically identifies the primary active deck using the crossfader position (left of center dominant Deck A, right of center dominant Deck B) and matches the opposite deck's rate to it.
  - **No Decks Playing**: Computes the exact average base BPM of both loaded tracks and adjusts the pitch faders on both decks so they play at the average speed.
  - Automatically clamps target speeds within safe physical hardware fader boundaries (`-8%` to `+8%`) and displays safe UI warnings if tracks or base BPM values are missing.
* **Simultaneous PLAY BOTH Controls**: A dedicated glowing green button on the central mixer panel. Clicking it unlocks sound and launches playback on both virtual decks simultaneously from their current cue points, automatically handling `AudioContext` initialization on click. Includes built-in safety lockout: only functions when **neither deck is currently playing audio** to prevent disrupting a live active mix.

### 3. Interactive Three-Mode Waveform Viewport
Cycle seamlessly between three distinct high-fidelity visualization engines using the floating canvas mode selectors:
* **📊 OVERVIEW (Static Envelope)**: Decodes and renders a complete static waveform amplitude envelope representing the entire track. Features high-performance background asynchronous `decodeAudioData` processing for local files, an animated vertical glowing playhead, and **direct click-to-seek progress scrubbing**.
* **⚡ LIVE WAVE (Rolling Zoom)**: Centers the playhead in a stationary middle position while a rolling 1-second high-definition zoomed-in wave slides smoothly under it. Includes 100ms grid ticking markers, and features **tactile click-and-drag scratch scrolling** (which automatically pauses playback during mouse scrolling and resumes on release to simulate high-precision physical vinyl scratching).
* **📈 LIVE SWEEP (Time Domain)**: Renders a scrolling, high-energy neon oscilloscope frequency wave direct from the Web Audio `AnalyserNode` to follow live transient details.

### 4. Smart Playlist System & Offline File Relocation
* **Playback Safety Locks**: To eliminate live performance slip-ups, the entire playlist panel is visually grayed out (`opacity: 0.4` with a blur filter) and made completely unclickable while its corresponding deck is actively playing audio.
* **JSON Portability & Cue Points**: Set local hot cue points that display as glowing vertical neon-orange lines across the waveform. Playlists can be exported and imported as JSON metadata preserving track URLs, durations, inline edited BPMs, and cue point triggers.
* **Standalone "Load & Cue" Operations**: The playlist row `LOAD` action cues tracks instantly, positioning the playhead exactly at its saved cue point, rendering visual envelopes, and leaving it paused in standby rather than forcing disruptive auto-plays.
* **Smart Relocation Engine**: Locally loaded playlists flag local paths as `⚠️ OFFLINE`. Users can bind files individually, use **SELECT FILE** to auto-resolve matching file names, or click **LOCATE FOLDER** to scan an entire directory and bulk-link matching tracks in a single click, restoring all cues and custom BPM settings instantly.

### 5. Intelligent AutoDJ Automator
* **Remaining-Time Monitor**: Constantly tracks the active playing deck's current playhead.
* **Automated Transitions**: Upon reaching a configurable trigger window (default `10` seconds remaining), AutoDJ automatically triggers the opposite deck, spins up the vinyl, and performs a smooth master crossfade.
* **Fader Animation**: The physical UI crossfader dynamically moves across the mixer screen using a high-precision `requestAnimationFrame` loop, ensuring full visual and acoustic alignment.

---

## 🎛️ Keyboard Shortcuts

Execute professional, instant transitions with dedicated console hotkeys:

| Key | Action |
|---|---|
| **Spacebar** | Toggle Play / Pause on the **currently highlighted** deck |
| **A** | Toggle Play / Pause on **Deck A** |
| **L** | Toggle Play / Pause on **Deck B** |
| **C** | Instantly return **Deck A** playhead to its saved Cue Point |
| **Double-Click (BPM Cell)** | Edit track BPM inline (supports floats, press **Enter** to save) |

---

## 🚀 Quick Start & Development

Because VibeDJ is built as a zero-dependency static application, starting it requires no bundle steps or package installations. 

### Running Locally
To launch the application, serve the directory using any local HTTP static server:

```bash
# Using Node.js npx:
npx http-server -p 8080

# Or Python 3:
python3 -m http-server 8080
```

Open your browser and navigate to **`http://localhost:8080`**.

### Basic Mixing Workflow
1. **Initialize Audio**: Click anywhere on the browser window to initialize the Web Audio API engine. The status display will shift from **STANDBY** to **ONLINE**.
2. **Add Tracks**: Paste remote MP3 stream URLs or drag-and-drop local audio files directly into the Deck A and Deck B playlist bins.
3. **Set Cues**: Play a track, pause at your desired transient, click **CUE** to lock a cue marker, and click `EXPORT PLAYLIST` to save your setup.
4. **Beatmatch**: Note the high-precision decimal BPM readouts at the top of the decks. Adjust the speed sliders until the decimal BPM readouts of both decks match perfectly.
5. **Crossfade**: Hit play on the cued deck, then slowly slide the master crossfader to transition the mix!

---

## 🎨 Technology Stack & Aesthetics

* **Frontend Structure**: Clean semantic HTML5 structure with distinct responsive panels.
* **Logic Engine**: High-performance, object-oriented ES6+ JavaScript.
* **Signal Path**: Web Audio API (`AudioContext`, `BiquadFilterNode`, `AnalyserNode`, `GainNode`).
* **Graphics**: High-performance HTML5 `<canvas>` rendering 60fps waveform calculations.
* **Design System**: Space-graphite console aesthetics incorporating glassmorphism, responsive CSS grid layouts, radial EQ knob rotations, and hardware-themed LED VU peak monitors.
