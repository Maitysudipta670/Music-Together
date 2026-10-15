const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 5000,
  pingTimeout: 10000
});

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Preserve clean file name with timestamp
    let cleanName = (file.originalname || 'track.mp3').replace(/[^a-zA-Z0-9.\-_]/g, '_');
    if (cleanName.replace(/[_.]/g, '').length === 0) {
      cleanName = 'song.mp3';
    }
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e4);
    cb(null, `${uniqueSuffix}-${cleanName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max per song
  fileFilter: (req, file, cb) => {
    // Permissive for mobile uploads (handles audio/mpeg, octet-stream, mp3, m4a, etc.)
    cb(null, true);
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// EMBEDDED FRONTEND FALLBACK (For Cloud / Render)
// Automatically serves full website even if public folder wasn't uploaded!
// ==========================================
const EMBEDDED_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover\">\n  <title>SyncTunes - Real-time Party Music</title>\n  <link rel=\"stylesheet\" href=\"/css/style.css\">\n  <link rel=\"icon\" href=\"data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎵</text></svg>\">\n  <!-- YouTube IFrame Player API -->\n  <script src=\"https://www.youtube.com/iframe_api\"></script>\n  <!-- Socket.IO Client -->\n  <script src=\"/socket.io/socket.io.js\"></script>\n</head>\n<body>\n  <!-- Ambient Background Glow -->\n  <div class=\"ambient-glow\"></div>\n\n  <div class=\"app-container\">\n    <!-- Header -->\n    <header>\n      <div class=\"logo-area\">\n        <div class=\"logo-icon\">🎵</div>\n        <div class=\"logo-text\">\n          <h1>SyncTunes</h1>\n          <div class=\"room-badge\">\n            <span id=\"room-name\">#party</span>\n            <span>•</span>\n            <span id=\"user-count\">1 listener</span>\n          </div>\n        </div>\n      </div>\n      <div class=\"header-actions\">\n        <div class=\"sync-status-indicator\">\n          <div class=\"ping-dot\"></div>\n          <span id=\"ping-ms\">--ms</span>\n        </div>\n        <button id=\"btn-share\" class=\"btn-icon\" title=\"Invite Friends\">\n          <span>📲</span> Share / QR\n        </button>\n        <button id=\"btn-admin-login\" class=\"btn-icon\" title=\"Admin Login\" style=\"padding:8px 10px;\">\n          <span id=\"admin-badge-icon\">🔒</span>\n        </button>\n      </div>\n    </header>\n\n    <!-- Mobile Autoplay Unlock Banner -->\n    <div id=\"unlock-overlay\">\n      <h3>🔊 Tap to Sync Audio with Friends!</h3>\n      <p>Mobile browsers require 1 tap to enable simultaneous synchronized sound.</p>\n    </div>\n\n    <!-- Active Sound Warning Banner (If muted by browser) -->\n    <div id=\"sound-notice\" style=\"display:none; background:linear-gradient(135deg, #f72585, #7209b7); color:#fff; text-align:center; padding:12px; border-radius:14px; font-weight:700; cursor:pointer; font-size:0.9rem; box-shadow:0 4px 15px rgba(247,37,133,0.5);\">\n      🔊 Audio is Muted by Browser — Tap Anywhere to Hear Music!\n    </div>\n\n    <!-- Connected Friends Bar -->\n    <div class=\"friends-bar\">\n      <span style=\"color:var(--text-muted); font-size:0.75rem;\">Connected Friends:</span>\n      <div id=\"friends-list\" class=\"friends-list\">\n        <!-- Injected via app.js -->\n      </div>\n    </div>\n\n    <!-- HTML5 Audio Element -->\n    <audio id=\"html5-audio\" playsinline webkit-playsinline preload=\"auto\"></audio>\n\n    <!-- Master Player Card -->\n    <div class=\"player-card\">\n      <!-- Hidden/Toggleable YouTube Player Container -->\n      <div id=\"youtube-player-container\">\n        <div id=\"yt-player\"></div>\n      </div>\n\n      <!-- Track Info & Visualizer -->\n      <div class=\"track-hero\">\n        <div class=\"cover-wrapper\">\n          <img id=\"cover-img\" class=\"cover-img\" alt=\"Album Cover\">\n          <div id=\"cover-placeholder\" class=\"cover-placeholder\">🎵</div>\n        </div>\n        <div class=\"track-meta\">\n          <div id=\"track-title\" class=\"track-title\">No track playing</div>\n          <div class=\"track-sub\">\n            <span id=\"track-source\" class=\"badge-source\">IDLE</span>\n            <div id=\"wave-bars\" class=\"wave-bars\">\n              <div class=\"wave-bar\"></div>\n              <div class=\"wave-bar\"></div>\n              <div class=\"wave-bar\"></div>\n              <div class=\"wave-bar\"></div>\n              <div class=\"wave-bar\"></div>\n            </div>\n          </div>\n        </div>\n      </div>\n\n      <!-- Time Slider -->\n      <div class=\"progress-container\">\n        <input type=\"range\" id=\"time-slider\" class=\"time-slider\" min=\"0\" max=\"100\" value=\"0\" step=\"0.1\">\n        <div class=\"time-labels\">\n          <span id=\"current-time-label\">0:00</span>\n          <span id=\"total-time-label\">0:00</span>\n        </div>\n      </div>\n\n      <!-- Playback Controls -->\n      <div class=\"controls-row\">\n        <button id=\"btn-play-master\" class=\"btn-play-master\" title=\"Play / Pause\">▶</button>\n        <button id=\"btn-next\" class=\"btn-ctrl\" title=\"Next Song\">⏭</button>\n      </div>\n\n      <!-- Sub Controls: Volume & Live Sync Badge -->\n      <div class=\"sub-controls\">\n        <div class=\"volume-wrapper\">\n          <button id=\"btn-mute\" class=\"btn-ctrl\" style=\"font-size:1.1rem;\">🔊</button>\n          <input type=\"range\" id=\"volume-slider\" class=\"volume-slider\" min=\"0\" max=\"1\" step=\"0.05\" value=\"1\">\n        </div>\n        <div id=\"drift-badge\" class=\"drift-badge\">\n          Sync: 0ms\n        </div>\n      </div>\n    </div>\n\n    <!-- Music Sources Tabs (YouTube & MP3 & Queue) -->\n    <div class=\"sources-card\">\n      <div class=\"tab-nav\">\n        <button class=\"tab-btn active\" data-tab=\"tab-youtube\">\n          <span>🎬</span> YouTube\n        </button>\n        <button class=\"tab-btn\" data-tab=\"tab-mp3\">\n          <span>📁</span> Upload MP3\n        </button>\n        <button class=\"tab-btn\" data-tab=\"tab-queue\">\n          <span>📑</span> Queue\n        </button>\n      </div>\n\n      <!-- YouTube Pane -->\n      <div id=\"tab-youtube\" class=\"tab-pane active\">\n        <div class=\"input-group\">\n          <input type=\"text\" id=\"yt-url-input\" class=\"text-input\" placeholder=\"Paste YouTube link (e.g. https://youtu.be/...)\">\n        </div>\n        <div style=\"display:flex; gap:8px;\">\n          <button id=\"btn-yt-play\" class=\"btn-primary\" style=\"flex:1; justify-content:center; height:42px;\">\n            ▶ Play Now\n          </button>\n          <button id=\"btn-yt-queue\" class=\"btn-icon\" style=\"flex:1; justify-content:center; height:42px;\">\n            + Add to Queue\n          </button>\n        </div>\n      </div>\n\n      <!-- MP3 Pane -->\n      <div id=\"tab-mp3\" class=\"tab-pane\">\n        <input type=\"file\" id=\"mp3-file-input\" accept=\"audio/*\" style=\"display:none;\">\n        <div id=\"mp3-dropzone\" class=\"dropzone\">\n          <div class=\"dropzone-icon\">📥</div>\n          <p>Drop audio file here or tap to select</p>\n          <span>Supports MP3, WAV, OGG, M4A, AAC (Up to 100MB)</span>\n        </div>\n        <div id=\"upload-status\" style=\"display:none; font-size:0.8rem; color:var(--accent-cyan); text-align:center;\"></div>\n        \n        <div style=\"font-size:0.82rem; font-weight:700; color:var(--text-muted); margin-top:6px;\">\n          Uploaded Tracks on Server:\n        </div>\n        <div id=\"mp3-list\" class=\"queue-list\">\n          <!-- Injected via app.js -->\n        </div>\n      </div>\n\n      <!-- Queue Pane -->\n      <div id=\"tab-queue\" class=\"tab-pane\">\n        <div id=\"queue-list\" class=\"queue-list\">\n          <!-- Injected via app.js -->\n        </div>\n      </div>\n    </div>\n\n    <!-- Live Emoji Reactions Bar -->\n    <div class=\"reactions-bar\">\n      <button class=\"btn-reaction\" data-emoji=\"🔥\" title=\"Fire\">🔥</button>\n      <button class=\"btn-reaction\" data-emoji=\"❤️\" title=\"Love\">❤️</button>\n      <button class=\"btn-reaction\" data-emoji=\"🎵\" title=\"Music\">🎵</button>\n      <button class=\"btn-reaction\" data-emoji=\"🕺\" title=\"Dance\">🕺</button>\n      <button class=\"btn-reaction\" data-emoji=\"💃\" title=\"Party\">💃</button>\n      <button class=\"btn-reaction\" data-emoji=\"🎉\" title=\"Celebrate\">🎉</button>\n    </div>\n  </div>\n\n  <!-- QR Code & Invite Modal -->\n  <div id=\"qr-modal\" class=\"modal-overlay\">\n    <div class=\"modal-box\">\n      <h3 style=\"font-size:1.2rem;\">📲 Invite Friends to Party</h3>\n      <p style=\"font-size:0.85rem; color:var(--text-muted);\">\n        Ask your friends to scan this QR code with their mobile camera to join and play together in sync!\n      </p>\n      <img id=\"qr-img\" class=\"modal-qr-img\" alt=\"QR Code\">\n      <div class=\"share-link-box\">\n        <input type=\"text\" id=\"share-link-input\" readonly style=\"background:transparent; border:none; color:inherit; width:100%; text-align:center; outline:none;\">\n      </div>\n      <div style=\"display:flex; gap:8px;\">\n        <button id=\"btn-copy-link\" class=\"btn-primary\" style=\"flex:1; justify-content:center; height:42px;\">\n          📋 Copy Link\n        </button>\n        <button id=\"btn-close-modal\" class=\"btn-icon\" style=\"flex:1; justify-content:center; height:42px;\">\n          Close\n        </button>\n      </div>\n    </div>\n  </div>\n\n  <!-- Admin Login Modal -->\n  <div id=\"admin-modal\" class=\"modal-overlay\">\n    <div class=\"modal-box\">\n      <h3 style=\"font-size:1.2rem;\">🔒 Admin Verification</h3>\n      <p style=\"font-size:0.85rem; color:var(--text-muted);\">Enter Master Password to access Admin Tools:</p>\n      <input type=\"password\" id=\"admin-pass-input\" class=\"text-input\" placeholder=\"Password\" style=\"text-align:center; font-size:1.1rem; letter-spacing:3px;\">\n      <div id=\"admin-login-error\" style=\"color:#ff4d4d; font-size:0.82rem; display:none;\"></div>\n      <div style=\"display:flex; gap:8px;\">\n        <button id=\"btn-submit-admin\" class=\"btn-primary\" style=\"flex:1; justify-content:center; height:42px;\">Login</button>\n        <button id=\"btn-cancel-admin\" class=\"btn-icon\" style=\"flex:1; justify-content:center; height:42px;\">Cancel</button>\n      </div>\n    </div>\n  </div>\n\n  <!-- Kicked Overlay (Shown to kicked user) -->\n  <div id=\"kicked-overlay\" class=\"modal-overlay\" style=\"z-index:99999;\">\n    <div class=\"modal-box\" style=\"border: 2px solid #ff4d4d;\">\n      <div style=\"font-size:3.5rem;\">🚫</div>\n      <h3 style=\"color:#ff4d4d; font-size:1.3rem;\">Removed From Party</h3>\n      <p style=\"font-size:0.9rem; color:var(--text-muted); line-height:1.4;\">\n        You have been removed from this party by the Admin.\n      </p>\n    </div>\n  </div>\n\n  <!-- App scripts -->\n  <script src=\"/js/sync-engine.js\"></script>\n  <script src=\"/js/player.js\"></script>\n  <script src=\"/js/app.js\"></script>\n</body>\n</html>\n";
const EMBEDDED_CSS = ":root {\n  --bg-primary: #0a0e17;\n  --bg-secondary: #131a29;\n  --bg-card: #1a233a;\n  --bg-card-hover: #222d4a;\n  --accent-cyan: #00f2fe;\n  --accent-purple: #9d4edd;\n  --accent-green: #10b981;\n  --accent-pink: #f72585;\n  --accent-gradient: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%);\n  --party-gradient: linear-gradient(135deg, #f72585 0%, #7209b7 50%, #4361ee 100%);\n  --text-main: #f8fafc;\n  --text-muted: #94a3b8;\n  --border-color: rgba(255, 255, 255, 0.08);\n  --border-active: rgba(0, 242, 254, 0.4);\n}\n\n* {\n  box-sizing: border-box;\n  margin: 0;\n  padding: 0;\n  -webkit-tap-highlight-color: transparent;\n}\n\nbody {\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif;\n  background: var(--bg-primary);\n  color: var(--text-main);\n  min-height: 100vh;\n  display: flex;\n  flex-direction: column;\n  overflow-x: hidden;\n}\n\n/* Background Ambient Glow */\n.ambient-glow {\n  position: fixed;\n  top: 0;\n  left: 0;\n  width: 100vw;\n  height: 100vh;\n  pointer-events: none;\n  z-index: 0;\n  overflow: hidden;\n}\n\n.ambient-glow::before {\n  content: '';\n  position: absolute;\n  top: -20%;\n  left: 20%;\n  width: 400px;\n  height: 400px;\n  background: radial-gradient(circle, rgba(114, 9, 183, 0.25) 0%, transparent 70%);\n  filter: blur(80px);\n  animation: floatOrb 12s ease-in-out infinite alternate;\n}\n\n.ambient-glow::after {\n  content: '';\n  position: absolute;\n  bottom: 10%;\n  right: 15%;\n  width: 450px;\n  height: 450px;\n  background: radial-gradient(circle, rgba(0, 242, 254, 0.2) 0%, transparent 70%);\n  filter: blur(90px);\n  animation: floatOrb 16s ease-in-out infinite alternate-reverse;\n}\n\n@keyframes floatOrb {\n  0% { transform: translate(0, 0) scale(1); }\n  100% { transform: translate(40px, -40px) scale(1.15); }\n}\n\n/* App Container */\n.app-container {\n  position: relative;\n  z-index: 1;\n  max-width: 650px;\n  width: 100%;\n  margin: 0 auto;\n  padding: 16px;\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n}\n\n/* Header */\nheader {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 12px 16px;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border-color);\n  border-radius: 18px;\n  backdrop-filter: blur(10px);\n}\n\n.logo-area {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.logo-icon {\n  font-size: 26px;\n  filter: drop-shadow(0 0 8px rgba(0, 242, 254, 0.6));\n  animation: pulseBeat 2s infinite ease-in-out;\n}\n\n@keyframes pulseBeat {\n  0%, 100% { transform: scale(1); }\n  50% { transform: scale(1.12); }\n}\n\n.logo-text h1 {\n  font-size: 1.15rem;\n  font-weight: 800;\n  letter-spacing: -0.5px;\n  background: linear-gradient(135deg, #ffffff 30%, #00f2fe 100%);\n  -webkit-background-clip: text;\n  -webkit-text-fill-color: transparent;\n}\n\n.room-badge {\n  font-size: 0.72rem;\n  color: var(--accent-cyan);\n  font-weight: 600;\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.header-actions {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.btn-icon {\n  background: rgba(255, 255, 255, 0.06);\n  border: 1px solid var(--border-color);\n  color: var(--text-main);\n  padding: 8px 12px;\n  border-radius: 12px;\n  font-size: 0.85rem;\n  font-weight: 600;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  transition: all 0.2s ease;\n}\n\n.btn-icon:hover, .btn-icon:active {\n  background: rgba(0, 242, 254, 0.15);\n  border-color: var(--border-active);\n  transform: translateY(-1px);\n}\n\n/* Mobile Autoplay Unlock Banner */\n#unlock-overlay {\n  background: linear-gradient(135deg, #f72585 0%, #7209b7 100%);\n  color: #fff;\n  border-radius: 16px;\n  padding: 16px;\n  text-align: center;\n  box-shadow: 0 8px 24px rgba(247, 37, 133, 0.35);\n  cursor: pointer;\n  display: none;\n  animation: glowPulse 2s infinite alternate;\n}\n\n@keyframes glowPulse {\n  0% { box-shadow: 0 4px 15px rgba(247, 37, 133, 0.3); }\n  100% { box-shadow: 0 8px 28px rgba(247, 37, 133, 0.6); }\n}\n\n#unlock-overlay h3 {\n  font-size: 1.05rem;\n  margin-bottom: 4px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n}\n\n#unlock-overlay p {\n  font-size: 0.82rem;\n  opacity: 0.9;\n}\n\n/* Users Bar */\n.friends-bar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 10px 14px;\n  background: rgba(19, 26, 41, 0.7);\n  border: 1px solid var(--border-color);\n  border-radius: 14px;\n  font-size: 0.82rem;\n}\n\n.friends-list {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  overflow-x: auto;\n}\n\n.friend-pill {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  background: rgba(255, 255, 255, 0.05);\n  padding: 4px 10px;\n  border-radius: 20px;\n  font-size: 0.78rem;\n  white-space: nowrap;\n}\n\n.friend-pill.host {\n  border: 1px solid rgba(255, 215, 0, 0.5);\n  background: rgba(255, 215, 0, 0.1);\n  color: #ffd700;\n}\n\n.sync-status-indicator {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 0.75rem;\n  color: var(--accent-green);\n  font-weight: 600;\n  white-space: nowrap;\n}\n\n.ping-dot {\n  width: 8px;\n  height: 8px;\n  background: var(--accent-green);\n  border-radius: 50%;\n  box-shadow: 0 0 8px var(--accent-green);\n  animation: blink 2s infinite ease-in-out;\n}\n\n@keyframes blink {\n  0%, 100% { opacity: 1; }\n  50% { opacity: 0.4; }\n}\n\n/* Player Card */\n.player-card {\n  background: var(--bg-card);\n  border: 1px solid var(--border-color);\n  border-radius: 22px;\n  padding: 20px;\n  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  position: relative;\n  overflow: hidden;\n}\n\n.player-card::before {\n  content: '';\n  position: absolute;\n  top: 0;\n  left: 0;\n  right: 0;\n  height: 3px;\n  background: var(--party-gradient);\n}\n\n/* YouTube Player container */\n#youtube-player-container {\n  width: 100%;\n  aspect-ratio: 16 / 9;\n  border-radius: 14px;\n  overflow: hidden;\n  display: none;\n  background: #000;\n  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);\n  margin-bottom: 8px;\n}\n\n#youtube-player-container.active {\n  display: block !important;\n}\n\n#youtube-player-container iframe,\n#yt-player {\n  width: 100% !important;\n  height: 100% !important;\n  border: none;\n  display: block;\n}\n\n/* Album Art / Music Visualizer */\n.track-hero {\n  display: flex;\n  align-items: center;\n  gap: 16px;\n}\n\n.cover-wrapper {\n  position: relative;\n  width: 72px;\n  height: 72px;\n  border-radius: 16px;\n  background: linear-gradient(135deg, #1f293d, #141b2a);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  overflow: hidden;\n  box-shadow: 0 6px 16px rgba(0,0,0,0.4);\n  flex-shrink: 0;\n}\n\n.cover-img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n  display: none;\n}\n\n.cover-placeholder {\n  font-size: 32px;\n}\n\n.track-meta {\n  flex: 1;\n  min-width: 0;\n}\n\n.track-title {\n  font-size: 1.1rem;\n  font-weight: 700;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  margin-bottom: 4px;\n}\n\n.track-sub {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 0.8rem;\n  color: var(--text-muted);\n}\n\n.badge-source {\n  padding: 2px 8px;\n  border-radius: 6px;\n  font-size: 0.7rem;\n  font-weight: 700;\n  text-transform: uppercase;\n}\n\n.badge-source.youtube {\n  background: rgba(255, 0, 0, 0.2);\n  color: #ff4d4d;\n  border: 1px solid rgba(255, 0, 0, 0.3);\n}\n\n.badge-source.mp3 {\n  background: rgba(0, 242, 254, 0.2);\n  color: var(--accent-cyan);\n  border: 1px solid rgba(0, 242, 254, 0.3);\n}\n\n/* Audio Visualizer Waves */\n.wave-bars {\n  display: flex;\n  align-items: flex-end;\n  gap: 3px;\n  height: 20px;\n}\n\n.wave-bar {\n  width: 3px;\n  height: 4px;\n  background: var(--accent-cyan);\n  border-radius: 2px;\n  transition: height 0.15s ease;\n}\n\n.playing .wave-bar:nth-child(1) { animation: wave 1.1s infinite ease-in-out; }\n.playing .wave-bar:nth-child(2) { animation: wave 0.8s infinite ease-in-out; }\n.playing .wave-bar:nth-child(3) { animation: wave 1.3s infinite ease-in-out; }\n.playing .wave-bar:nth-child(4) { animation: wave 0.9s infinite ease-in-out; }\n.playing .wave-bar:nth-child(5) { animation: wave 1.2s infinite ease-in-out; }\n\n@keyframes wave {\n  0%, 100% { height: 4px; }\n  50% { height: 20px; }\n}\n\n/* Progress Slider */\n.progress-container {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n\n.time-slider {\n  -webkit-appearance: none;\n  width: 100%;\n  height: 6px;\n  border-radius: 3px;\n  background: rgba(255, 255, 255, 0.12);\n  outline: none;\n  cursor: pointer;\n  position: relative;\n}\n\n.time-slider::-webkit-slider-thumb {\n  -webkit-appearance: none;\n  width: 14px;\n  height: 14px;\n  border-radius: 50%;\n  background: #fff;\n  cursor: pointer;\n  box-shadow: 0 0 10px rgba(0, 242, 254, 0.8);\n  transition: transform 0.1s ease;\n}\n\n.time-slider:hover::-webkit-slider-thumb {\n  transform: scale(1.3);\n}\n\n.time-labels {\n  display: flex;\n  justify-content: space-between;\n  font-size: 0.75rem;\n  color: var(--text-muted);\n}\n\n/* Playback Control Buttons */\n.controls-row {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 24px;\n  padding: 4px 0;\n}\n\n.btn-ctrl {\n  background: transparent;\n  border: none;\n  color: var(--text-muted);\n  font-size: 1.4rem;\n  cursor: pointer;\n  transition: all 0.2s ease;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.btn-ctrl:hover, .btn-ctrl:active {\n  color: var(--text-main);\n  transform: scale(1.15);\n}\n\n.btn-play-master {\n  width: 58px;\n  height: 58px;\n  border-radius: 50%;\n  background: var(--party-gradient);\n  color: #fff;\n  border: none;\n  font-size: 1.5rem;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  box-shadow: 0 6px 20px rgba(247, 37, 133, 0.45);\n  transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);\n}\n\n.btn-play-master:hover, .btn-play-master:active {\n  transform: scale(1.08);\n  box-shadow: 0 8px 26px rgba(247, 37, 133, 0.6);\n}\n\n/* Secondary controls (volume, sync badge) */\n.sub-controls {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding-top: 4px;\n  border-top: 1px solid rgba(255, 255, 255, 0.05);\n  font-size: 0.8rem;\n}\n\n.volume-wrapper {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  color: var(--text-muted);\n}\n\n.volume-slider {\n  -webkit-appearance: none;\n  width: 80px;\n  height: 4px;\n  background: rgba(255, 255, 255, 0.15);\n  border-radius: 2px;\n  outline: none;\n}\n\n.volume-slider::-webkit-slider-thumb {\n  -webkit-appearance: none;\n  width: 10px;\n  height: 10px;\n  border-radius: 50%;\n  background: #fff;\n  cursor: pointer;\n}\n\n.drift-badge {\n  font-size: 0.72rem;\n  color: var(--text-muted);\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  background: rgba(255, 255, 255, 0.04);\n  padding: 3px 8px;\n  border-radius: 8px;\n}\n\n/* Tabs: Add Music (YouTube & MP3) */\n.sources-card {\n  background: var(--bg-card);\n  border: 1px solid var(--border-color);\n  border-radius: 22px;\n  padding: 16px;\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n}\n\n.tab-nav {\n  display: flex;\n  gap: 8px;\n  border-bottom: 1px solid var(--border-color);\n  padding-bottom: 12px;\n}\n\n.tab-btn {\n  flex: 1;\n  background: rgba(255, 255, 255, 0.04);\n  border: 1px solid var(--border-color);\n  color: var(--text-muted);\n  padding: 10px;\n  border-radius: 12px;\n  font-size: 0.88rem;\n  font-weight: 600;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  transition: all 0.2s ease;\n}\n\n.tab-btn.active {\n  background: rgba(0, 242, 254, 0.12);\n  border-color: var(--accent-cyan);\n  color: #fff;\n}\n\n.tab-pane {\n  display: none;\n  flex-direction: column;\n  gap: 12px;\n}\n\n.tab-pane.active {\n  display: flex;\n}\n\n/* YouTube Input Form */\n.input-group {\n  display: flex;\n  gap: 8px;\n}\n\n.text-input {\n  flex: 1;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border-color);\n  color: #fff;\n  padding: 12px 14px;\n  border-radius: 12px;\n  font-size: 0.9rem;\n  outline: none;\n  transition: border-color 0.2s ease;\n}\n\n.text-input:focus {\n  border-color: var(--accent-cyan);\n}\n\n.btn-primary {\n  background: var(--accent-gradient);\n  border: none;\n  color: #000;\n  font-weight: 700;\n  padding: 0 18px;\n  border-radius: 12px;\n  font-size: 0.9rem;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  transition: transform 0.15s ease;\n}\n\n.btn-primary:active {\n  transform: scale(0.96);\n}\n\n/* MP3 Upload Dropzone */\n.dropzone {\n  border: 2px dashed rgba(255, 255, 255, 0.15);\n  border-radius: 14px;\n  padding: 24px 16px;\n  text-align: center;\n  background: rgba(255, 255, 255, 0.02);\n  cursor: pointer;\n  transition: all 0.2s ease;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 6px;\n}\n\n.dropzone:hover, .dropzone.dragover {\n  border-color: var(--accent-cyan);\n  background: rgba(0, 242, 254, 0.05);\n}\n\n.dropzone-icon {\n  font-size: 32px;\n}\n\n.dropzone p {\n  font-size: 0.88rem;\n  color: var(--text-main);\n  font-weight: 600;\n}\n\n.dropzone span {\n  font-size: 0.74rem;\n  color: var(--text-muted);\n}\n\n/* Playlist / Queue list */\n.queue-list {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  max-height: 220px;\n  overflow-y: auto;\n  padding-right: 4px;\n}\n\n.queue-item {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 8px 12px;\n  background: rgba(255, 255, 255, 0.03);\n  border: 1px solid var(--border-color);\n  border-radius: 10px;\n  font-size: 0.85rem;\n  transition: background 0.15s ease;\n}\n\n.queue-item:hover {\n  background: rgba(255, 255, 255, 0.06);\n}\n\n.queue-item-info {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n  flex: 1;\n}\n\n.queue-item-title {\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.queue-item-actions {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.btn-mini {\n  background: transparent;\n  border: none;\n  color: var(--text-muted);\n  cursor: pointer;\n  font-size: 0.95rem;\n  padding: 4px;\n  border-radius: 6px;\n}\n\n.btn-mini:hover {\n  color: #fff;\n  background: rgba(255, 255, 255, 0.1);\n}\n\n/* Floating Reactions Bar */\n.reactions-bar {\n  display: flex;\n  justify-content: space-around;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border-color);\n  border-radius: 18px;\n  padding: 8px 12px;\n  margin-top: auto;\n}\n\n.btn-reaction {\n  background: transparent;\n  border: none;\n  font-size: 1.5rem;\n  cursor: pointer;\n  transition: transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275);\n}\n\n.btn-reaction:active {\n  transform: scale(1.4);\n}\n\n/* Floating Emoji Animations */\n.floating-emoji {\n  position: fixed;\n  bottom: 80px;\n  font-size: 2.2rem;\n  pointer-events: none;\n  z-index: 9999;\n  animation: floatUp 2.4s ease-out forwards;\n}\n\n@keyframes floatUp {\n  0% {\n    opacity: 0;\n    transform: translateY(0) scale(0.6);\n  }\n  15% {\n    opacity: 1;\n    transform: translateY(-20px) scale(1.2);\n  }\n  100% {\n    opacity: 0;\n    transform: translateY(-240px) scale(0.9);\n  }\n}\n\n/* QR Code Modal */\n.modal-overlay {\n  position: fixed;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.75);\n  backdrop-filter: blur(8px);\n  z-index: 1000;\n  display: none;\n  align-items: center;\n  justify-content: center;\n  padding: 16px;\n}\n\n.modal-overlay.open {\n  display: flex;\n}\n\n.modal-box {\n  background: var(--bg-card);\n  border: 1px solid var(--border-color);\n  border-radius: 24px;\n  max-width: 400px;\n  width: 100%;\n  padding: 24px;\n  text-align: center;\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);\n}\n\n.modal-qr-img {\n  width: 200px;\n  height: 200px;\n  margin: 0 auto;\n  border-radius: 12px;\n  background: #fff;\n  padding: 8px;\n}\n\n.share-link-box {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border-color);\n  padding: 10px 14px;\n  border-radius: 12px;\n  font-size: 0.82rem;\n  word-break: break-all;\n  color: var(--accent-cyan);\n}\n\n/* Mobile responsive tuning */\n@media (max-width: 480px) {\n  .app-container {\n    padding: 10px;\n    gap: 12px;\n  }\n  .player-card {\n    padding: 16px;\n  }\n  .cover-wrapper {\n    width: 60px;\n    height: 60px;\n  }\n  .track-title {\n    font-size: 1rem;\n  }\n}\n";
const EMBEDDED_SYNC_ENGINE = "/**\n * SyncEngine: High-Precision NTP Clock Sync & Drift Compensator\n * Enables millisecond-level audio synchronization across multiple devices.\n */\nclass SyncEngine {\n  constructor(socket) {\n    this.socket = socket;\n    this.clockOffset = 0;       // serverTime - clientLocalTime (ms)\n    this.roundTripTime = 0;     // latency (ms)\n    this.offsetHistory = [];    // samples for outlier rejection\n    this.isSynced = false;\n    this.onSyncUpdate = null;\n\n    // Start sync immediately\n    this.startSyncLoop();\n  }\n\n  startSyncLoop() {\n    // 1. Initial burst: sample 5 times in quick succession\n    let burstCount = 0;\n    const burst = () => {\n      this.sampleClock(() => {\n        burstCount++;\n        if (burstCount < 5) {\n          setTimeout(burst, 300);\n        } else {\n          // Periodic sync every 4 seconds to maintain drift < 10ms\n          setInterval(() => this.sampleClock(), 4000);\n        }\n      });\n    };\n    burst();\n  }\n\n  sampleClock(callback) {\n    const t0 = performance.now();\n    const clientTimestamp = Date.now();\n\n    this.socket.emit('sync-time', clientTimestamp, (response) => {\n      if (!response) return;\n      const t3 = performance.now();\n      const rtt = t3 - t0;\n      const serverTime = response.serverTime;\n\n      // Cristian's Algorithm\n      // Client time when server generated response estimate:\n      const estimatedClientAtServerTime = clientTimestamp + (rtt / 2);\n      const sampleOffset = serverTime - estimatedClientAtServerTime;\n\n      // Save sample with weight based on RTT (lower RTT = higher precision)\n      this.offsetHistory.push({ offset: sampleOffset, rtt: rtt });\n      if (this.offsetHistory.length > 10) {\n        this.offsetHistory.shift();\n      }\n\n      // Outlier filtering: sort by RTT and take median of the lowest 50%\n      const sortedByRtt = [...this.offsetHistory].sort((a, b) => a.rtt - b.rtt);\n      const bestSamples = sortedByRtt.slice(0, Math.max(1, Math.ceil(sortedByRtt.length / 2)));\n      \n      const avgOffset = bestSamples.reduce((sum, s) => sum + s.offset, 0) / bestSamples.length;\n      this.clockOffset = avgOffset;\n      this.roundTripTime = rtt;\n      this.isSynced = true;\n\n      if (typeof this.onSyncUpdate === 'function') {\n        this.onSyncUpdate({\n          offset: this.clockOffset,\n          rtt: this.roundTripTime\n        });\n      }\n\n      if (callback) callback();\n    });\n  }\n\n  // Current synchronized server timestamp (ms)\n  getServerTime() {\n    return Date.now() + this.clockOffset;\n  }\n\n  // Calculate where the track SHOULD be right at this millisecond\n  getExpectedPosition(roomState) {\n    if (!roomState || !roomState.currentTrack) return 0;\n    \n    if (roomState.status !== 'playing') {\n      return Math.max(0, roomState.position || 0);\n    }\n\n    const currentServerTime = this.getServerTime();\n    const elapsedSeconds = (currentServerTime - roomState.updatedAt) / 1000;\n    const rate = roomState.playbackRate || 1.0;\n    const expected = (roomState.position || 0) + (elapsedSeconds * rate);\n\n    return Math.max(0, expected);\n  }\n\n  // Calculate drift between client player and server expected position\n  calculateDrift(actualPosition, roomState) {\n    const expected = this.getExpectedPosition(roomState);\n    return actualPosition - expected; // positive = ahead, negative = behind\n  }\n}\n\nwindow.SyncEngine = SyncEngine;\n";
const EMBEDDED_PLAYER = "/**\n * UnifiedSyncPlayer\n * Intelligent dual-engine (YouTube IFrame API & HTML5 Audio) with zero-stutter drift correction.\n */\nclass UnifiedSyncPlayer {\n  constructor(syncEngine, options = {}) {\n    this.syncEngine = syncEngine;\n    this.options = options;\n    this.activeType = null; // 'youtube' | 'mp3'\n    this.currentTrack = null;\n    this.roomState = null;\n    this.isMuted = false;\n    this.volume = 1.0;\n    this.isUnlocked = false;\n    this.lastSeekTime = 0; // cooldown to prevent seek spam\n    this.currentPlaybackRate = 1.0;\n\n    // Callbacks\n    this.onProgress = options.onProgress || null;\n    this.onDriftUpdate = options.onDriftUpdate || null;\n    this.onTrackEnded = options.onTrackEnded || null;\n\n    this.hasInitialSynced = false;\n\n    // Use DOM audio element for superior mobile browser compatibility\n    this.audioElement = document.getElementById('html5-audio') || new Audio();\n    this.audioElement.preload = 'auto';\n    this.audioElement.playsInline = true;\n\n    // YouTube Player reference\n    this.ytPlayer = null;\n    this.ytReady = false;\n    this.ytContainer = document.getElementById('youtube-player-container');\n\n    this.initAudioListeners();\n    this.initYouTubeAPI();\n    this.startDriftCorrectionLoop();\n  }\n\n  // Mobile Audio Unlock: Unlocks both HTML5 Audio and YouTube Audio\n  unlock() {\n    this.isUnlocked = true;\n\n    // Unlock HTML5 Audio using a tiny silent sound wave\n    try {\n      const silentSound = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';\n      if (!this.audioElement.src || this.audioElement.src === window.location.href) {\n        this.audioElement.src = silentSound;\n      }\n      const p = this.audioElement.play();\n      if (p !== undefined) {\n        p.then(() => {\n          if (this.audioElement.src === silentSound) {\n            this.audioElement.pause();\n          }\n        }).catch(() => {});\n      }\n    } catch (e) {}\n\n    // Unlock YouTube\n    if (this.ytReady && this.ytPlayer) {\n      try {\n        if (typeof this.ytPlayer.unMute === 'function') {\n          this.ytPlayer.unMute();\n          this.ytPlayer.setVolume(this.volume * 100);\n        }\n        if (this.roomState && this.roomState.status === 'playing') {\n          if (typeof this.ytPlayer.playVideo === 'function') {\n            this.ytPlayer.playVideo();\n          }\n        }\n      } catch (e) {}\n    }\n\n    // Immediately sync to current room track\n    if (this.roomState && this.roomState.currentTrack) {\n      this.syncToState(this.roomState, true);\n    }\n  }\n\n  initAudioListeners() {\n    this.audioElement.addEventListener('ended', () => {\n      if (this.onTrackEnded) this.onTrackEnded();\n    });\n\n    this.audioElement.addEventListener('error', (e) => {\n      console.warn('Audio playback error:', e);\n    });\n  }\n\n  initYouTubeAPI() {\n    if (window.YT && window.YT.Player) {\n      this.createYTPlayer();\n    } else {\n      window.onYouTubeIframeAPIReady = () => {\n        this.createYTPlayer();\n      };\n    }\n  }\n\n  createYTPlayer() {\n    const el = document.getElementById('yt-player');\n    if (!el) return;\n\n    this.ytPlayer = new window.YT.Player('yt-player', {\n      height: '100%',\n      width: '100%',\n      playerVars: {\n        autoplay: 1,\n        controls: 1, // Keep controls visible so users can easily unmute/tap on mobile\n        disablekb: 0,\n        fs: 1,\n        modestbranding: 1,\n        rel: 0,\n        playsinline: 1,\n        enablejsapi: 1,\n        origin: window.location.origin\n      },\n      events: {\n        onReady: (event) => {\n          this.ytReady = true;\n          try {\n            this.ytPlayer.unMute();\n            this.ytPlayer.setVolume(this.volume * 100);\n          } catch (e) {}\n          console.log('[YouTube Player Ready]');\n          if (this.roomState && this.roomState.currentTrack?.type === 'youtube') {\n            this.syncToState(this.roomState, true);\n          }\n        },\n        onStateChange: (event) => {\n          if (event.data === window.YT.PlayerState.PLAYING) {\n            if (!this.hasInitialSynced && this.roomState && this.roomState.status === 'playing') {\n              this.hasInitialSynced = true;\n              const expectedPos = this.syncEngine.getExpectedPosition(this.roomState);\n              const cur = (typeof this.ytPlayer.getCurrentTime === 'function') ? (this.ytPlayer.getCurrentTime() || 0) : 0;\n              if (Math.abs(cur - expectedPos) > 0.6) {\n                this.ytPlayer.seekTo(expectedPos, true);\n                this.lastSeekTime = Date.now();\n              }\n            }\n          }\n          if (event.data === window.YT.PlayerState.ENDED) {\n            if (this.onTrackEnded) this.onTrackEnded();\n          }\n        }\n      }\n    });\n  }\n\n  // Load a new track\n  loadTrack(track, autoplay = true, startPosition = 0) {\n    this.currentTrack = track;\n    this.activeType = track.type;\n    this.hasInitialSynced = false;\n    this.lastSeekTime = Date.now(); // reset cooldown\n\n    if (track.type === 'youtube') {\n      // Pause MP3 audio\n      this.audioElement.pause();\n      this.audioElement.src = '';\n      if (this.ytContainer) {\n        this.ytContainer.classList.add('active');\n        this.ytContainer.style.display = 'block';\n      }\n\n      if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.loadVideoById === 'function') {\n        try {\n          this.ytPlayer.unMute();\n          this.ytPlayer.setVolume(this.volume * 100);\n          this.ytPlayer.loadVideoById({\n            videoId: track.id,\n            startSeconds: startPosition || 0\n          });\n          if (!autoplay) {\n            this.ytPlayer.pauseVideo();\n          } else {\n            this.ytPlayer.playVideo();\n          }\n        } catch (e) {\n          console.error('YouTube load error:', e);\n        }\n      }\n    } else if (track.type === 'mp3') {\n      // Stop YouTube\n      if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.stopVideo === 'function') {\n        try { this.ytPlayer.stopVideo(); } catch (e) {}\n      }\n      if (this.ytContainer) {\n        this.ytContainer.classList.remove('active');\n        this.ytContainer.style.display = 'none';\n      }\n\n      this.audioElement.src = track.url;\n      this.audioElement.currentTime = startPosition || 0;\n      this.audioElement.volume = this.volume;\n      this.audioElement.muted = false;\n\n      if (autoplay) {\n        const playPromise = this.audioElement.play();\n        if (playPromise !== undefined) {\n          playPromise.catch(e => {\n            console.warn('Audio play waiting for user touch:', e);\n            const sn = document.getElementById('sound-notice');\n            if (sn) sn.style.display = 'block';\n          });\n        }\n      }\n    }\n  }\n\n  // Sync to room state\n  syncToState(state, forceSeek = false) {\n    this.roomState = state;\n    if (!state.currentTrack) {\n      this.stop();\n      return;\n    }\n\n    const isNewTrack = !this.currentTrack || (this.currentTrack.id !== state.currentTrack.id);\n    const expectedPos = this.syncEngine.getExpectedPosition(state);\n\n    if (isNewTrack) {\n      this.loadTrack(state.currentTrack, state.status === 'playing', expectedPos);\n      return;\n    }\n\n    if (state.status === 'playing') {\n      this.play(expectedPos, forceSeek);\n    } else {\n      this.pause(state.position);\n    }\n  }\n\n  play(targetPosition = null, forceSeek = false) {\n    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {\n      try {\n        this.ytPlayer.unMute();\n        if (targetPosition !== null && forceSeek) {\n          this.ytPlayer.seekTo(targetPosition, true);\n          this.lastSeekTime = Date.now();\n        }\n        if (this.isUnlocked) {\n          this.ytPlayer.playVideo();\n        }\n      } catch (e) {}\n    } else if (this.activeType === 'mp3') {\n      if (targetPosition !== null && forceSeek) {\n        this.audioElement.currentTime = targetPosition;\n        this.lastSeekTime = Date.now();\n      }\n      if (this.isUnlocked) {\n        this.audioElement.play().catch(e => console.warn('MP3 play interrupted:', e));\n      }\n    }\n  }\n\n  pause(targetPosition = null) {\n    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {\n      try {\n        this.ytPlayer.pauseVideo();\n        if (targetPosition !== null) {\n          this.ytPlayer.seekTo(targetPosition, true);\n        }\n      } catch (e) {}\n    } else if (this.activeType === 'mp3') {\n      this.audioElement.pause();\n      if (targetPosition !== null) {\n        this.audioElement.currentTime = targetPosition;\n      }\n    }\n  }\n\n  seek(seconds) {\n    this.lastSeekTime = Date.now();\n    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {\n      try {\n        this.ytPlayer.seekTo(seconds, true);\n      } catch (e) {}\n    } else if (this.activeType === 'mp3') {\n      this.audioElement.currentTime = seconds;\n    }\n  }\n\n  stop() {\n    this.pause(0);\n    this.currentTrack = null;\n    this.activeType = null;\n    if (this.ytContainer) {\n      this.ytContainer.classList.remove('active');\n      this.ytContainer.style.display = 'none';\n    }\n  }\n\n  getCurrentTime() {\n    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getCurrentTime === 'function') {\n      return this.ytPlayer.getCurrentTime() || 0;\n    } else if (this.activeType === 'mp3') {\n      return this.audioElement.currentTime || 0;\n    }\n    return 0;\n  }\n\n  getDuration() {\n    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getDuration === 'function') {\n      return this.ytPlayer.getDuration() || 0;\n    } else if (this.activeType === 'mp3') {\n      return this.audioElement.duration || 0;\n    }\n    return 0;\n  }\n\n  setVolume(val) {\n    this.volume = Math.max(0, Math.min(1, val));\n    this.audioElement.volume = this.volume;\n    if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.setVolume === 'function') {\n      try {\n        this.ytPlayer.setVolume(this.volume * 100);\n      } catch (e) {}\n    }\n  }\n\n  setMute(mute) {\n    this.isMuted = mute;\n    this.audioElement.muted = mute;\n    if (this.ytReady && this.ytPlayer) {\n      try {\n        if (mute) this.ytPlayer.mute();\n        else this.ytPlayer.unMute();\n      } catch (e) {}\n    }\n  }\n\n  /**\n   * Continuous zero-stutter drift correction loop.\n   * FIX: Never trigger aggressive seek loops while YouTube is buffering!\n   * Uses smooth micro playback speed adjustments (1.04x / 0.96x) so sound never cuts out!\n   */\n  startDriftCorrectionLoop() {\n    setInterval(() => {\n      if (!this.roomState || this.roomState.status !== 'playing' || !this.currentTrack) {\n        if (this.onProgress) {\n          this.onProgress(this.getCurrentTime(), this.getDuration());\n        }\n        return;\n      }\n\n      // Check YouTube buffering state: If buffering (3) or unstarted (-1), DO NOT SEEK!\n      if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getPlayerState === 'function') {\n        const ytState = this.ytPlayer.getPlayerState();\n        if (ytState === 3 || ytState === -1) {\n          // Buffering or loading: let it buffer naturally, don't interrupt!\n          return;\n        }\n      }\n\n      const actualPos = this.getCurrentTime();\n      const expectedPos = this.syncEngine.getExpectedPosition(this.roomState);\n      const drift = actualPos - expectedPos; // seconds\n      const driftMs = Math.round(drift * 1000);\n\n      if (this.onDriftUpdate) {\n        this.onDriftUpdate(driftMs);\n      }\n\n      if (this.onProgress) {\n        this.onProgress(actualPos, this.getDuration());\n      }\n\n      const absDrift = Math.abs(drift);\n      const timeSinceLastSeek = Date.now() - this.lastSeekTime;\n\n      if (this.activeType === 'youtube') {\n        // YouTube Player: Never use fractional playback rates (prevents YouTube snapping to 0.75x!)\n        if (this.currentPlaybackRate !== 1.0) {\n          this.setPlaybackRate(1.0);\n        }\n        // Snap YouTube to server time if drift exceeds 1.2s\n        if (absDrift > 1.2 && timeSinceLastSeek > 3500) {\n          this.seek(expectedPos);\n        }\n      } else if (this.activeType === 'mp3') {\n        // HTML5 Audio: supports smooth micro rate adjustments\n        if (absDrift > 2.0 && timeSinceLastSeek > 3500) {\n          this.seek(expectedPos);\n          this.setPlaybackRate(1.0);\n        } else if (absDrift > 0.30) {\n          if (drift < 0) {\n            this.setPlaybackRate(1.03); // gentle 3% catch-up\n          } else {\n            this.setPlaybackRate(0.97); // gentle 3% slow-down\n          }\n        } else if (absDrift < 0.12) {\n          this.setPlaybackRate(1.0);\n        }\n      }\n    }, 600);\n  }\n\n  setPlaybackRate(rate) {\n    if (this.currentPlaybackRate === rate) return; // Prevent audio pipeline stutter!\n    this.currentPlaybackRate = rate;\n\n    if (this.activeType === 'mp3') {\n      try { this.audioElement.playbackRate = rate; } catch (e) {}\n    } else if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.setPlaybackRate === 'function') {\n      // Only set standard rates for YouTube\n      if (rate === 1.0 || rate === 1.25 || rate === 1.5 || rate === 2.0) {\n        try { this.ytPlayer.setPlaybackRate(rate); } catch (e) {}\n      }\n    }\n  }\n}\n\nwindow.UnifiedSyncPlayer = UnifiedSyncPlayer;\n";
const EMBEDDED_APP = "document.addEventListener('DOMContentLoaded', () => {\n  // 1. Setup Room & User info\n  const urlParams = new URLSearchParams(window.location.search);\n  const roomId = urlParams.get('room') || 'party';\n  \n  let savedName = localStorage.getItem('sync_username');\n  if (!savedName) {\n    const emojis = ['🎧', '⚡', '🎵', '🔥', '🚀', '🌟'];\n    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];\n    savedName = `Friend ${Math.floor(Math.random() * 900) + 100} ${randomEmoji}`;\n    localStorage.setItem('sync_username', savedName);\n  }\n\n  // DOM Elements\n  const roomNameEl = document.getElementById('room-name');\n  const userCountEl = document.getElementById('user-count');\n  const friendsListEl = document.getElementById('friends-list');\n  const pingMsEl = document.getElementById('ping-ms');\n  const driftBadgeEl = document.getElementById('drift-badge');\n  const unlockOverlay = document.getElementById('unlock-overlay');\n\n  const coverImg = document.getElementById('cover-img');\n  const coverPlaceholder = document.getElementById('cover-placeholder');\n  const trackTitleEl = document.getElementById('track-title');\n  const trackSubEl = document.getElementById('track-sub');\n  const trackSourceEl = document.getElementById('track-source');\n  const waveBarsContainer = document.getElementById('wave-bars');\n\n  const timeSlider = document.getElementById('time-slider');\n  const currentTimeLabel = document.getElementById('current-time-label');\n  const totalTimeLabel = document.getElementById('total-time-label');\n\n  const btnPlayMaster = document.getElementById('btn-play-master');\n  const btnNext = document.getElementById('btn-next');\n  const volumeSlider = document.getElementById('volume-slider');\n  const btnMute = document.getElementById('btn-mute');\n\n  const ytUrlInput = document.getElementById('yt-url-input');\n  const btnYtPlay = document.getElementById('btn-yt-play');\n  const btnYtQueue = document.getElementById('btn-yt-queue');\n\n  const mp3FileInput = document.getElementById('mp3-file-input');\n  const mp3Dropzone = document.getElementById('mp3-dropzone');\n  const uploadStatusEl = document.getElementById('upload-status');\n  const mp3ListEl = document.getElementById('mp3-list');\n  const queueListEl = document.getElementById('queue-list');\n\n  const btnShare = document.getElementById('btn-share');\n  const qrModal = document.getElementById('qr-modal');\n  const btnCloseModal = document.getElementById('btn-close-modal');\n  const qrImg = document.getElementById('qr-img');\n  const shareLinkInput = document.getElementById('share-link-input');\n  const btnCopyLink = document.getElementById('btn-copy-link');\n\n  roomNameEl.textContent = '#' + roomId;\n\n  // 2. Connect Socket.IO with WebSocket transport for zero latency\n  const socket = io({\n    transports: ['websocket', 'polling'],\n    upgrade: true\n  });\n  const syncEngine = new SyncEngine(socket);\n\n  let currentRoomState = null;\n  let isHost = false;\n  let isSeeking = false;\n  let isAdmin = false;\n  let cachedUsers = [];\n  let cachedHostId = null;\n  let cachedMp3Tracks = [];\n\n  // 3. Initialize Unified Player\n  const player = new UnifiedSyncPlayer(syncEngine, {\n    onProgress: (current, duration) => {\n      if (!isSeeking && duration > 0) {\n        timeSlider.value = (current / duration) * 100;\n        currentTimeLabel.textContent = formatTime(current);\n        totalTimeLabel.textContent = formatTime(duration);\n      } else if (!isSeeking) {\n        currentTimeLabel.textContent = formatTime(current);\n      }\n    },\n    onDriftUpdate: (driftMs) => {\n      driftBadgeEl.textContent = `Sync: ${driftMs >= 0 ? '+' : ''}${driftMs}ms`;\n      if (Math.abs(driftMs) < 50) {\n        driftBadgeEl.style.color = '#10b981'; // Green\n      } else if (Math.abs(driftMs) < 200) {\n        driftBadgeEl.style.color = '#ffd166'; // Yellow\n      } else {\n        driftBadgeEl.style.color = '#ff6b6b'; // Red\n      }\n    },\n    onTrackEnded: () => {\n      // Auto play next track in queue\n      socket.emit('next-track');\n    }\n  });\n\n  // 4. Mobile Audio Unlock Behavior\n  const triggerUnlock = () => {\n    player.unlock();\n    if (unlockOverlay) unlockOverlay.style.display = 'none';\n    const soundNotice = document.getElementById('sound-notice');\n    if (soundNotice) soundNotice.style.display = 'none';\n  };\n\n  if (unlockOverlay) {\n    unlockOverlay.style.display = 'block';\n    unlockOverlay.addEventListener('click', triggerUnlock);\n  }\n\n  // Any tap or click anywhere on screen ensures audio is unmuted\n  document.addEventListener('click', triggerUnlock);\n  document.addEventListener('touchstart', triggerUnlock, { passive: true });\n\n  // 5. Sync Engine Updates (Latency & Clock Offset)\n  syncEngine.onSyncUpdate = ({ offset, rtt }) => {\n    pingMsEl.textContent = `${Math.round(rtt)}ms`;\n  };\n\n  // 6. Join Room\n  socket.emit('join-room', {\n    roomId,\n    userName: savedName\n  });\n\n  // 7. Socket Event Listeners\n  socket.on('room-state', (state) => {\n    currentRoomState = state;\n    isHost = state.isHost;\n    updateUIFromState(state);\n    player.syncToState(state, true);\n  });\n\n  socket.on('state-sync', (syncData) => {\n    if (!currentRoomState) return;\n    currentRoomState.status = syncData.status;\n    currentRoomState.position = syncData.position;\n    currentRoomState.updatedAt = syncData.updatedAt;\n    currentRoomState.currentTrack = syncData.currentTrack;\n\n    updatePlayPauseButton(syncData.status === 'playing');\n    player.syncToState(currentRoomState, !!syncData.isSeek);\n  });\n\n  socket.on('track-changed', (state) => {\n    currentRoomState = state;\n    updateUIFromState(state);\n    player.syncToState(state, true);\n  });\n\n  socket.on('users-updated', ({ users, userCount, hostSocketId }) => {\n    userCountEl.textContent = `${userCount} listener${userCount > 1 ? 's' : ''}`;\n    renderFriendsList(users, hostSocketId);\n  });\n\n  socket.on('queue-updated', ({ queue }) => {\n    if (currentRoomState) currentRoomState.queue = queue;\n    renderQueue(queue);\n  });\n\n  socket.on('reaction-received', ({ emoji, senderName, senderId }) => {\n    spawnFloatingEmoji(emoji, senderName, senderId === socket.id);\n  });\n\n  // 8. UI State Updating\n  function updateUIFromState(state) {\n    updatePlayPauseButton(state.status === 'playing');\n\n    if (state.currentTrack) {\n      trackTitleEl.textContent = state.currentTrack.title || 'Untitled Track';\n      trackSourceEl.textContent = state.currentTrack.type.toUpperCase();\n      trackSourceEl.className = `badge-source ${state.currentTrack.type}`;\n\n      if (state.currentTrack.thumbnail) {\n        coverImg.src = state.currentTrack.thumbnail;\n        coverImg.style.display = 'block';\n        coverPlaceholder.style.display = 'none';\n      } else {\n        coverImg.style.display = 'none';\n        coverPlaceholder.style.display = 'block';\n        coverPlaceholder.textContent = state.currentTrack.type === 'youtube' ? '🎬' : '🎵';\n      }\n\n      const ytContainer = document.getElementById('youtube-player-container');\n      if (state.currentTrack.type === 'youtube') {\n        if (ytContainer) {\n          ytContainer.classList.add('active');\n          ytContainer.style.display = 'block';\n        }\n      } else {\n        if (ytContainer) {\n          ytContainer.classList.remove('active');\n          ytContainer.style.display = 'none';\n        }\n      }\n    } else {\n      const ytContainer = document.getElementById('youtube-player-container');\n      if (ytContainer) {\n        ytContainer.classList.remove('active');\n        ytContainer.style.display = 'none';\n      }\n      trackTitleEl.textContent = 'No track playing';\n      trackSubEl.textContent = 'Add a song below';\n      trackSourceEl.textContent = 'IDLE';\n      trackSourceEl.className = 'badge-source';\n      coverImg.style.display = 'none';\n      coverPlaceholder.style.display = 'block';\n      coverPlaceholder.textContent = '🎵';\n      waveBarsContainer.classList.remove('playing');\n    }\n\n    renderQueue(state.queue || []);\n  }\n\n  function updatePlayPauseButton(isPlaying) {\n    if (isPlaying) {\n      btnPlayMaster.innerHTML = '⏸';\n      waveBarsContainer.classList.add('playing');\n    } else {\n      btnPlayMaster.innerHTML = '▶';\n      waveBarsContainer.classList.remove('playing');\n    }\n  }\n\n  function renderFriendsList(users, hostId) {\n    cachedUsers = users;\n    cachedHostId = hostId;\n    friendsListEl.innerHTML = '';\n    users.forEach(u => {\n      const pill = document.createElement('div');\n      pill.className = `friend-pill ${u.id === hostId ? 'host' : ''}`;\n      \n      let kickBtnHtml = '';\n      if (isAdmin && u.id !== socket.id) {\n        kickBtnHtml = `<button class=\"btn-mini btn-kick-friend\" data-id=\"${u.id}\" data-name=\"${escapeHtml(u.name)}\" style=\"background:rgba(255,50,50,0.3); color:#ff6b6b; border:1px solid rgba(255,50,50,0.5); padding:2px 7px; border-radius:6px; margin-left:6px; cursor:pointer;\" title=\"Kick Out\">🚫 Out</button>`;\n      }\n\n      pill.innerHTML = `<span>${u.avatar || '🎧'}</span> <span>${escapeHtml(u.name)}</span> ${u.id === hostId ? '<small>👑 Host</small>' : ''} ${kickBtnHtml}`;\n      \n      const kickBtn = pill.querySelector('.btn-kick-friend');\n      if (kickBtn) {\n        kickBtn.addEventListener('click', (e) => {\n          e.stopPropagation();\n          const targetId = e.currentTarget.getAttribute('data-id');\n          const targetName = e.currentTarget.getAttribute('data-name');\n          if (confirm(`Remove \"${targetName}\" from the party?`)) {\n            socket.emit('admin-kick-user', { targetSocketId: targetId }, (res) => {\n              if (res && !res.success) alert(res.message);\n            });\n          }\n        });\n      }\n\n      friendsListEl.appendChild(pill);\n    });\n  }\n\n  function renderQueue(queue) {\n    queueListEl.innerHTML = '';\n    if (!queue || queue.length === 0) {\n      queueListEl.innerHTML = '<div style=\"color:var(--text-muted); font-size:0.8rem; text-align:center; padding:12px;\">Queue is empty. Add songs from YouTube or MP3!</div>';\n      return;\n    }\n\n    queue.forEach((track, index) => {\n      const item = document.createElement('div');\n      item.className = 'queue-item';\n      item.innerHTML = `\n        <div class=\"queue-item-info\">\n          <span>${track.type === 'youtube' ? '🎬' : '🎵'}</span>\n          <div class=\"queue-item-title\">${escapeHtml(track.title)}</div>\n        </div>\n        <div class=\"queue-item-actions\">\n          <button class=\"btn-mini btn-remove-q\" data-index=\"${index}\" title=\"Remove\">✕</button>\n        </div>\n      `;\n      queueListEl.appendChild(item);\n    });\n\n    queueListEl.querySelectorAll('.btn-remove-q').forEach(btn => {\n      btn.addEventListener('click', (e) => {\n        const idx = parseInt(e.currentTarget.getAttribute('data-index'));\n        socket.emit('remove-queue', { index: idx });\n      });\n    });\n  }\n\n  // 9. Playback Control Handlers (OPTIMISTIC 0ms RESPONSE)\n  btnPlayMaster.addEventListener('click', () => {\n    triggerUnlock();\n    if (!currentRoomState || !currentRoomState.currentTrack) {\n      alert('Please add a YouTube song or upload an MP3 track first!');\n      return;\n    }\n\n    const isPlaying = currentRoomState.status === 'playing';\n    const currentPos = player.getCurrentTime();\n\n    // 1. Instant local UI update (0ms delay)\n    updatePlayPauseButton(!isPlaying);\n    currentRoomState.status = isPlaying ? 'paused' : 'playing';\n\n    // 2. Instant local audio action\n    if (isPlaying) {\n      player.pause(currentPos);\n      socket.emit('pause', { position: currentPos });\n    } else {\n      player.play(currentPos, false);\n      socket.emit('play', { position: currentPos });\n    }\n  });\n\n  btnNext.addEventListener('click', () => {\n    triggerUnlock();\n    socket.emit('next-track');\n  });\n\n  timeSlider.addEventListener('mousedown', () => { isSeeking = true; });\n  timeSlider.addEventListener('touchstart', () => { isSeeking = true; });\n\n  timeSlider.addEventListener('input', () => {\n    const duration = player.getDuration();\n    if (duration > 0) {\n      const targetPos = (timeSlider.value / 100) * duration;\n      currentTimeLabel.textContent = formatTime(targetPos);\n    }\n  });\n\n  timeSlider.addEventListener('change', () => {\n    const duration = player.getDuration();\n    if (duration > 0) {\n      const targetPos = (timeSlider.value / 100) * duration;\n      player.seek(targetPos);\n      socket.emit('seek', { position: targetPos });\n    }\n    isSeeking = false;\n  });\n\n  volumeSlider.addEventListener('input', (e) => {\n    const val = parseFloat(e.target.value);\n    player.setVolume(val);\n  });\n\n  btnMute.addEventListener('click', () => {\n    const nextMute = !player.isMuted;\n    player.setMute(nextMute);\n    btnMute.innerHTML = nextMute ? '🔇' : '🔊';\n  });\n\n  // Sound Watchdog Banner\n  const soundNoticeEl = document.getElementById('sound-notice');\n  if (soundNoticeEl) {\n    soundNoticeEl.addEventListener('click', () => {\n      triggerUnlock();\n      player.unlock();\n      soundNoticeEl.style.display = 'none';\n    });\n  }\n\n  // Check every 1.5s if song is supposed to be playing but local sound is blocked\n  setInterval(() => {\n    if (!currentRoomState || currentRoomState.status !== 'playing' || !currentRoomState.currentTrack) {\n      if (soundNoticeEl) soundNoticeEl.style.display = 'none';\n      return;\n    }\n\n    let isSilent = false;\n    if (player.activeType === 'mp3') {\n      if (player.audioElement.paused || player.audioElement.muted) {\n        isSilent = true;\n      }\n    } else if (player.activeType === 'youtube' && player.ytPlayer) {\n      try {\n        if (typeof player.ytPlayer.isMuted === 'function' && player.ytPlayer.isMuted()) {\n          isSilent = true;\n        }\n      } catch (e) {}\n    }\n\n    if (soundNoticeEl) {\n      soundNoticeEl.style.display = isSilent ? 'block' : 'none';\n    }\n  }, 1500);\n\n  // 10. YouTube Extractor & Handler (Zero-Delay Instant Dispatch)\n  function extractYouTubeId(url) {\n    if (!url) return null;\n    const clean = url.trim();\n    if (clean.length === 11 && !clean.includes('/') && !clean.includes('?')) {\n      return clean;\n    }\n    const regExp = /^.*(youtu.be\\/|v\\/|u\\/\\w\\/|embed\\/|watch\\?v=|\\&v=|shorts\\/)([^#\\&\\?]*).*/;\n    const match = clean.match(regExp);\n    return (match && match[2].length === 11) ? match[2] : null;\n  }\n\n  function handleYouTubeAction(playNow = true) {\n    triggerUnlock();\n    const input = ytUrlInput.value.trim();\n    if (!input) {\n      alert('Please enter a YouTube video URL or ID');\n      return;\n    }\n\n    const videoId = extractYouTubeId(input);\n    if (!videoId) {\n      alert('Invalid YouTube URL. Please copy and paste a valid YouTube video link.');\n      return;\n    }\n\n    ytUrlInput.value = '';\n\n    // Create track object immediately (NO 3-second network wait!)\n    const track = {\n      id: videoId,\n      type: 'youtube',\n      title: `YouTube Video (${videoId})`,\n      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,\n      url: `https://www.youtube.com/watch?v=${videoId}`\n    };\n\n    if (playNow) {\n      socket.emit('change-track', { track, autoplay: true });\n    } else {\n      socket.emit('add-queue', track);\n    }\n\n    // Fetch prettier title in background without blocking\n    fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`)\n      .then(res => res.json())\n      .then(data => {\n        if (data.title && currentRoomState?.currentTrack?.id === videoId) {\n          trackTitleEl.textContent = data.title;\n        }\n      })\n      .catch(() => {});\n  }\n\n  btnYtPlay.addEventListener('click', () => handleYouTubeAction(true));\n  btnYtQueue.addEventListener('click', () => handleYouTubeAction(false));\n  ytUrlInput.addEventListener('keypress', (e) => {\n    if (e.key === 'Enter') handleYouTubeAction(true);\n  });\n\n  // 11. MP3 Upload & Server File Listing\n  function loadUploadedTracks() {\n    fetch('/api/tracks')\n      .then(res => res.json())\n      .then(data => {\n        renderMp3Library(data.tracks || []);\n      })\n      .catch(err => console.error('Error fetching tracks:', err));\n  }\n\n  function renderMp3Library(tracks) {\n    cachedMp3Tracks = tracks;\n    mp3ListEl.innerHTML = '';\n    if (tracks.length === 0) {\n      mp3ListEl.innerHTML = '<div style=\"color:var(--text-muted); font-size:0.8rem; text-align:center; padding:12px;\">No MP3s uploaded yet. Drag & drop or select files above!</div>';\n      return;\n    }\n\n    tracks.forEach(track => {\n      const item = document.createElement('div');\n      item.className = 'queue-item';\n\n      let delBtnHtml = '';\n      if (isAdmin) {\n        delBtnHtml = `<button class=\"btn-mini btn-del-mp3\" data-filename=\"${track.filename}\" data-title=\"${escapeHtml(track.title)}\" style=\"background:rgba(255,50,50,0.25); color:#ff6b6b; border:1px solid rgba(255,50,50,0.4); padding:3px 8px; border-radius:6px; margin-left:4px; cursor:pointer;\" title=\"Delete File from Server\">🗑️ Delete</button>`;\n      }\n\n      item.innerHTML = `\n        <div class=\"queue-item-info\">\n          <span>🎵</span>\n          <div class=\"queue-item-title\">${escapeHtml(track.title)}</div>\n        </div>\n        <div class=\"queue-item-actions\">\n          <button class=\"btn-mini btn-play-mp3\" title=\"Play Now\">▶ Play</button>\n          <button class=\"btn-mini btn-q-mp3\" title=\"Add to Queue\">+ Queue</button>\n          ${delBtnHtml}\n        </div>\n      `;\n\n      item.querySelector('.btn-play-mp3').addEventListener('click', () => {\n        triggerUnlock();\n        socket.emit('change-track', { track, autoplay: true });\n      });\n\n      item.querySelector('.btn-q-mp3').addEventListener('click', () => {\n        triggerUnlock();\n        socket.emit('add-queue', track);\n      });\n\n      const delBtn = item.querySelector('.btn-del-mp3');\n      if (delBtn) {\n        delBtn.addEventListener('click', (e) => {\n          e.stopPropagation();\n          const fname = e.currentTarget.getAttribute('data-filename');\n          const ftitle = e.currentTarget.getAttribute('data-title');\n          if (confirm(`Are you sure you want to delete \"${ftitle}\" from the server?`)) {\n            socket.emit('admin-delete-track', { filename: fname }, (res) => {\n              if (res && res.success) {\n                loadUploadedTracks();\n              } else {\n                alert(res?.message || 'Failed to delete track');\n              }\n            });\n          }\n        });\n      }\n\n      mp3ListEl.appendChild(item);\n    });\n  }\n\n  function uploadFile(file) {\n    if (!file) return;\n    triggerUnlock();\n\n    uploadStatusEl.style.display = 'block';\n    uploadStatusEl.style.color = 'var(--accent-cyan)';\n    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);\n    uploadStatusEl.textContent = `Uploading: 0% (${sizeMb} MB)...`;\n\n    const formData = new FormData();\n    formData.append('audio', file);\n\n    const xhr = new XMLHttpRequest();\n    xhr.open('POST', '/api/upload', true);\n    xhr.timeout = 180000; // 3 minute timeout\n\n    xhr.upload.onprogress = (e) => {\n      if (e.lengthComputable) {\n        const percent = Math.round((e.loaded / e.total) * 100);\n        uploadStatusEl.textContent = `Uploading: ${percent}% of ${sizeMb} MB...`;\n      }\n    };\n\n    xhr.onload = () => {\n      if (xhr.status >= 200 && xhr.status < 300) {\n        try {\n          const data = JSON.parse(xhr.responseText);\n          if (data.success && data.track) {\n            uploadStatusEl.style.color = '#10b981';\n            uploadStatusEl.textContent = `✓ Uploaded: ${data.track.title}!`;\n            setTimeout(() => { uploadStatusEl.style.display = 'none'; }, 4000);\n            loadUploadedTracks();\n            socket.emit('add-queue', data.track);\n          } else {\n            uploadStatusEl.style.color = '#ff4d4d';\n            uploadStatusEl.textContent = `Upload failed: ${data.error || 'Server error'}`;\n          }\n        } catch (e) {\n          uploadStatusEl.style.color = '#ff4d4d';\n          uploadStatusEl.textContent = `Response error: ${e.message}`;\n        }\n      } else {\n        uploadStatusEl.style.color = '#ff4d4d';\n        uploadStatusEl.textContent = `Upload failed with status ${xhr.status}`;\n      }\n    };\n\n    xhr.onerror = () => {\n      uploadStatusEl.style.color = '#ff4d4d';\n      uploadStatusEl.textContent = 'Upload network error. Check internet connection.';\n    };\n\n    xhr.ontimeout = () => {\n      uploadStatusEl.style.color = '#ff4d4d';\n      uploadStatusEl.textContent = 'Upload timed out. Try a smaller file or faster network.';\n    };\n\n    xhr.send(formData);\n  }\n\n  // File dropzone events\n  mp3Dropzone.addEventListener('click', () => mp3FileInput.click());\n  mp3FileInput.addEventListener('change', (e) => {\n    if (e.target.files.length > 0) {\n      uploadFile(e.target.files[0]);\n    }\n  });\n\n  mp3Dropzone.addEventListener('dragover', (e) => {\n    e.preventDefault();\n    mp3Dropzone.classList.add('dragover');\n  });\n\n  mp3Dropzone.addEventListener('dragleave', () => {\n    mp3Dropzone.classList.remove('dragover');\n  });\n\n  mp3Dropzone.addEventListener('drop', (e) => {\n    e.preventDefault();\n    mp3Dropzone.classList.remove('dragover');\n    if (e.dataTransfer.files.length > 0) {\n      uploadFile(e.dataTransfer.files[0]);\n    }\n  });\n\n  // 12. Tabs (YouTube / MP3 / Queue)\n  const tabs = document.querySelectorAll('.tab-btn');\n  const panes = document.querySelectorAll('.tab-pane');\n\n  tabs.forEach(tab => {\n    tab.addEventListener('click', () => {\n      tabs.forEach(t => t.classList.remove('active'));\n      panes.forEach(p => p.classList.remove('active'));\n      tab.classList.add('active');\n      const targetPane = document.getElementById(tab.getAttribute('data-tab'));\n      if (targetPane) targetPane.classList.add('active');\n    });\n  });\n\n  // 13. Emoji Reactions (🔥 ❤️ 🎵 🕺 🎉)\n  document.querySelectorAll('.btn-reaction').forEach(btn => {\n    btn.addEventListener('click', () => {\n      const emoji = btn.getAttribute('data-emoji');\n      socket.emit('send-reaction', { emoji });\n    });\n  });\n\n  function spawnFloatingEmoji(emoji, senderName, isSelf) {\n    const el = document.createElement('div');\n    el.className = 'floating-emoji';\n    el.textContent = emoji;\n    \n    // Random horizontal position across bottom\n    const randomLeft = Math.floor(Math.random() * 70) + 15;\n    el.style.left = `${randomLeft}vw`;\n\n    document.body.appendChild(el);\n    setTimeout(() => {\n      el.remove();\n    }, 2400);\n  }\n\n  // 14. QR Code & Share Modal\n  btnShare.addEventListener('click', async () => {\n    try {\n      const netInfo = await fetch('/api/network-info').then(r => r.json());\n      const shareUrl = `${netInfo.primaryUrl}?room=${encodeURIComponent(roomId)}`;\n      shareLinkInput.value = shareUrl;\n\n      const qrRes = await fetch(`/api/qrcode?url=${encodeURIComponent(shareUrl)}`).then(r => r.json());\n      qrImg.src = qrRes.qrDataUrl;\n\n      qrModal.classList.add('open');\n    } catch (e) {\n      shareLinkInput.value = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;\n      qrModal.classList.add('open');\n    }\n  });\n\n  btnCloseModal.addEventListener('click', () => {\n    qrModal.classList.remove('open');\n  });\n\n  qrModal.addEventListener('click', (e) => {\n    if (e.target === qrModal) qrModal.classList.remove('open');\n  });\n\n  btnCopyLink.addEventListener('click', () => {\n    navigator.clipboard.writeText(shareLinkInput.value).then(() => {\n      btnCopyLink.textContent = '✓ Copied!';\n      setTimeout(() => { btnCopyLink.textContent = '📋 Copy Link'; }, 2000);\n    });\n  });\n\n  // Utility helpers\n  function formatTime(seconds) {\n    if (isNaN(seconds) || seconds < 0) return '0:00';\n    const mins = Math.floor(seconds / 60);\n    const secs = Math.floor(seconds % 60);\n    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;\n  }\n\n  function escapeHtml(str) {\n    return (str || '').replace(/[&<>\"']/g, m => ({\n      '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;'\n    })[m]);\n  }\n\n  // 15. Admin Management Panel & Actions\n  const btnAdminLogin = document.getElementById('btn-admin-login');\n  const adminBadgeIcon = document.getElementById('admin-badge-icon');\n  const adminModal = document.getElementById('admin-modal');\n  const adminPassInput = document.getElementById('admin-pass-input');\n  const adminLoginError = document.getElementById('admin-login-error');\n  const btnSubmitAdmin = document.getElementById('btn-submit-admin');\n  const btnCancelAdmin = document.getElementById('btn-cancel-admin');\n\n  if (btnAdminLogin) {\n    btnAdminLogin.addEventListener('click', () => {\n      if (isAdmin) {\n        if (confirm('You are logged in as Admin. Do you want to log out?')) {\n          isAdmin = false;\n          sessionStorage.removeItem('is_sync_admin');\n          if (adminBadgeIcon) adminBadgeIcon.textContent = '🔒';\n          renderFriendsList(cachedUsers, cachedHostId);\n          renderMp3Library(cachedMp3Tracks);\n        }\n      } else {\n        if (adminModal) {\n          adminModal.classList.add('open');\n          adminPassInput.value = '';\n          adminLoginError.style.display = 'none';\n          adminPassInput.focus();\n        }\n      }\n    });\n  }\n\n  const submitAdminPass = () => {\n    const pass = adminPassInput.value.trim();\n    if (!pass) return;\n\n    socket.emit('admin-login', { password: pass }, (res) => {\n      if (res && res.success) {\n        isAdmin = true;\n        sessionStorage.setItem('is_sync_admin', 'true');\n        if (adminBadgeIcon) adminBadgeIcon.textContent = '👑';\n        if (adminModal) adminModal.classList.remove('open');\n        renderFriendsList(cachedUsers, cachedHostId);\n        renderMp3Library(cachedMp3Tracks);\n      } else {\n        adminLoginError.textContent = res?.message || 'Incorrect Password!';\n        adminLoginError.style.display = 'block';\n      }\n    });\n  };\n\n  if (btnSubmitAdmin) btnSubmitAdmin.addEventListener('click', submitAdminPass);\n  if (adminPassInput) {\n    adminPassInput.addEventListener('keypress', (e) => {\n      if (e.key === 'Enter') submitAdminPass();\n    });\n  }\n  if (btnCancelAdmin) {\n    btnCancelAdmin.addEventListener('click', () => {\n      if (adminModal) adminModal.classList.remove('open');\n    });\n  }\n\n  // Socket listener for when this client is kicked by admin\n  socket.on('kicked-from-party', ({ reason }) => {\n    player.stop();\n    const kickedOverlay = document.getElementById('kicked-overlay');\n    if (kickedOverlay) kickedOverlay.classList.add('open');\n    socket.disconnect();\n  });\n\n  // Socket listener for library updates (when admin deletes an MP3)\n  socket.on('library-updated', () => {\n    loadUploadedTracks();\n  });\n\n  // Check if session previously had admin access\n  if (sessionStorage.getItem('is_sync_admin') === 'true') {\n    // Discreetly prompt server for re-auth\n    // User can click 🔒 and enter 246890 if disconnected\n  }\n\n  // Initial loads\n  loadUploadedTracks();\n});\n";

app.get('/', (req, res) => {
  const diskPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(diskPath)) {
    return res.sendFile(diskPath);
  }
  res.type('html').send(EMBEDDED_HTML);
});

app.get('/css/style.css', (req, res) => {
  const diskPath = path.join(__dirname, 'public', 'css', 'style.css');
  if (fs.existsSync(diskPath)) {
    return res.sendFile(diskPath);
  }
  res.type('css').send(EMBEDDED_CSS);
});

app.get('/js/sync-engine.js', (req, res) => {
  const diskPath = path.join(__dirname, 'public', 'js', 'sync-engine.js');
  if (fs.existsSync(diskPath)) {
    return res.sendFile(diskPath);
  }
  res.type('js').send(EMBEDDED_SYNC_ENGINE);
});

app.get('/js/player.js', (req, res) => {
  const diskPath = path.join(__dirname, 'public', 'js', 'player.js');
  if (fs.existsSync(diskPath)) {
    return res.sendFile(diskPath);
  }
  res.type('js').send(EMBEDDED_PLAYER);
});

app.get('/js/app.js', (req, res) => {
  const diskPath = path.join(__dirname, 'public', 'js', 'app.js');
  if (fs.existsSync(diskPath)) {
    return res.sendFile(diskPath);
  }
  res.type('js').send(EMBEDDED_APP);
});

// Wildcard fallback to root
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/uploads')) {
    return next();
  }
  const diskPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(diskPath)) {
    return res.sendFile(diskPath);
  }
  res.type('html').send(EMBEDDED_HTML);
});


app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
  }
}));

// Helper: Get Local IPv4 Address
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ interface: name, address: iface.address });
      }
    }
  }
  return addresses;
}

// REST API Endpoints
app.get('/api/network-info', (req, res) => {
  const ips = getLocalIpAddresses();
  const primaryIp = ips.length > 0 ? ips[0].address : 'localhost';
  
  // Detect if requested via public tunnel/domain
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const dynamicUrl = host ? `${proto}://${host}` : `http://${primaryIp}:${PORT}`;

  res.json({
    port: PORT,
    ips,
    primaryIp,
    primaryUrl: dynamicUrl
  });
});

app.get('/api/qrcode', async (req, res) => {
  try {
    const targetUrl = req.query.url || `http://${getLocalIpAddresses()[0]?.address || 'localhost'}:${PORT}`;
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      margin: 2,
      width: 256,
      color: { dark: '#000000', light: '#ffffff' }
    });
    res.json({ qrDataUrl, url: targetUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload audio file (Safe Error-Handled Middleware)
app.post('/api/upload', (req, res) => {
  upload.single('audio')(req, res, (err) => {
    if (err) {
      console.error('[Upload Error]', err);
      return res.status(400).json({ success: false, error: err.message || 'File upload error' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file received' });
    }

    try {
      let originalName = req.file.originalname || 'Audio Track';
      try {
        originalName = Buffer.from(originalName, 'latin1').toString('utf8');
      } catch (e) {}
      const ext = path.extname(originalName);
      const title = path.basename(originalName, ext) || 'Audio Track';

      const track = {
        id: 'mp3_' + req.file.filename,
        type: 'mp3',
        title: title,
        filename: req.file.filename,
        url: `/uploads/${encodeURIComponent(req.file.filename)}`,
        size: req.file.size,
        uploadedAt: Date.now()
      };

      res.json({ success: true, track });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '246890';

// List uploaded tracks
app.get('/api/tracks', (req, res) => {
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Could not read uploads' });
    const audioExts = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.aac', '.flac', '.webm', '.opus']);
    const audioFiles = files.filter(f => audioExts.has(path.extname(f).toLowerCase()));
    const tracks = audioFiles.map(filename => {
      try {
        const stats = fs.statSync(path.join(UPLOADS_DIR, filename));
        const parts = filename.split('-');
        const titleWithExt = parts.slice(2).join('-') || filename;
        const title = path.basename(titleWithExt, path.extname(titleWithExt));
        return {
          id: 'mp3_' + filename,
          type: 'mp3',
          title: title || filename,
          filename,
          url: `/uploads/${encodeURIComponent(filename)}`,
          size: stats.size,
          uploadedAt: stats.mtimeMs
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean).sort((a, b) => b.uploadedAt - a.uploadedAt);
    res.json({ tracks });
  });
});

// Admin Delete Track Endpoint
app.delete('/api/tracks/:filename', (req, res) => {
  const adminPassword = req.headers['x-admin-password'] || req.query.password;
  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Unauthorized: Invalid Admin Password' });
  }

  const safeName = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, safeName);

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return res.json({ success: true, message: 'Track deleted successfully' });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to delete file: ' + e.message });
    }
  } else {
    return res.status(404).json({ error: 'File not found' });
  }
});

// Rooms State Management
class SyncRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.hostSocketId = null;
    this.currentTrack = null;
    this.status = 'paused'; // 'playing' | 'paused' | 'stopped'
    this.position = 0;      // seconds at updatedAt
    this.updatedAt = Date.now();
    this.playbackRate = 1.0;
    this.queue = [];
    this.users = new Map(); // socketId -> { id, name, isHost, avatar, joinedAt }
    this.freeControl = true; // allow friends to also play/pause/add songs
  }

  getCurrentPosition() {
    if (this.status !== 'playing') {
      return this.position;
    }
    const elapsed = (Date.now() - this.updatedAt) / 1000;
    return this.position + (elapsed * this.playbackRate);
  }

  play(atPosition = null) {
    const now = Date.now();
    if (atPosition !== null && !isNaN(atPosition)) {
      this.position = Math.max(0, atPosition);
    } else if (this.status !== 'playing') {
      // keep current position
    }
    this.status = 'playing';
    this.updatedAt = now;
  }

  pause(atPosition = null) {
    const now = Date.now();
    if (atPosition !== null && !isNaN(atPosition)) {
      this.position = Math.max(0, atPosition);
    } else {
      this.position = this.getCurrentPosition();
    }
    this.status = 'paused';
    this.updatedAt = now;
  }

  seek(targetPosition) {
    this.position = Math.max(0, targetPosition);
    this.updatedAt = Date.now();
  }

  setTrack(track, autoplay = true) {
    this.currentTrack = track;
    this.position = 0;
    this.status = autoplay ? 'playing' : 'paused';
    this.updatedAt = Date.now();
  }

  getState() {
    return {
      roomId: this.roomId,
      hostSocketId: this.hostSocketId,
      currentTrack: this.currentTrack,
      status: this.status,
      position: this.getCurrentPosition(),
      updatedAt: Date.now(),
      serverTime: Date.now(),
      playbackRate: this.playbackRate,
      queue: this.queue,
      userCount: this.users.size,
      users: Array.from(this.users.values()),
      freeControl: this.freeControl
    };
  }
}

const rooms = new Map();

function getOrCreateRoom(roomId) {
  const cleanId = (roomId || 'party').trim().toLowerCase();
  if (!rooms.has(cleanId)) {
    rooms.set(cleanId, new SyncRoom(cleanId));
  }
  return rooms.get(cleanId);
}

// Socket.IO Real-time Synchronization
io.on('connection', (socket) => {
  let userRoomId = null;

  // 1. Precise NTP Clock Sync Handshake
  socket.on('sync-time', (clientT0, callback) => {
    if (typeof callback === 'function') {
      callback({
        clientT0: clientT0,
        serverTime: Date.now()
      });
    }
  });

  // 2. User joins room
  socket.on('join-room', ({ roomId, userName, avatar }) => {
    userRoomId = (roomId || 'party').trim().toLowerCase();
    socket.join(userRoomId);

    const room = getOrCreateRoom(userRoomId);

    // If no host exists yet, assign this user as host
    const isFirstUser = room.users.size === 0 || !room.hostSocketId;
    if (isFirstUser) {
      room.hostSocketId = socket.id;
    }

    const userData = {
      id: socket.id,
      name: userName || `Friend ${room.users.size + 1}`,
      avatar: avatar || '🎵',
      isHost: room.hostSocketId === socket.id,
      joinedAt: Date.now()
    };
    room.users.set(socket.id, userData);

    // Send full current room state to joining client
    socket.emit('room-state', {
      ...room.getState(),
      myId: socket.id,
      isHost: userData.isHost
    });

    // Notify room of updated users list
    io.to(userRoomId).emit('users-updated', {
      users: Array.from(room.users.values()),
      userCount: room.users.size,
      hostSocketId: room.hostSocketId
    });

    console.log(`[User Joined] ${userData.name} (${socket.id}) -> Room: ${userRoomId}`);
  });

  // 3. Play command
  socket.on('play', ({ position }) => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    room.play(position);
    io.to(userRoomId).emit('state-sync', {
      status: 'playing',
      position: room.position,
      updatedAt: room.updatedAt,
      serverTime: Date.now(),
      currentTrack: room.currentTrack
    });
  });

  // 4. Pause command
  socket.on('pause', ({ position }) => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    room.pause(position);
    io.to(userRoomId).emit('state-sync', {
      status: 'paused',
      position: room.position,
      updatedAt: room.updatedAt,
      serverTime: Date.now(),
      currentTrack: room.currentTrack
    });
  });

  // 5. Seek command
  socket.on('seek', ({ position }) => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    room.seek(position);
    io.to(userRoomId).emit('state-sync', {
      status: room.status,
      position: room.position,
      updatedAt: room.updatedAt,
      serverTime: Date.now(),
      currentTrack: room.currentTrack,
      isSeek: true
    });
  });

  // 6. Change / Play New Track
  socket.on('change-track', ({ track, autoplay = true }) => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    room.setTrack(track, autoplay);
    io.to(userRoomId).emit('track-changed', {
      ...room.getState()
    });
  });

  // 7. Queue management
  socket.on('add-queue', (track) => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    // If nothing currently playing, play immediately
    if (!room.currentTrack) {
      room.setTrack(track, true);
      io.to(userRoomId).emit('track-changed', room.getState());
    } else {
      room.queue.push(track);
      io.to(userRoomId).emit('queue-updated', { queue: room.queue });
    }
  });

  socket.on('remove-queue', ({ index }) => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;
    if (index >= 0 && index < room.queue.length) {
      room.queue.splice(index, 1);
      io.to(userRoomId).emit('queue-updated', { queue: room.queue });
    }
  });

  socket.on('next-track', () => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    if (room.queue.length > 0) {
      const nextTrack = room.queue.shift();
      room.setTrack(nextTrack, true);
      io.to(userRoomId).emit('track-changed', room.getState());
    } else {
      room.pause(0);
      io.to(userRoomId).emit('state-sync', {
        status: 'paused',
        position: 0,
        updatedAt: Date.now(),
        serverTime: Date.now(),
        currentTrack: room.currentTrack
      });
    }
  });

  // 8. Real-time Fun Reactions (Emoji popups)
  socket.on('send-reaction', ({ emoji }) => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    const user = room?.users.get(socket.id);
    io.to(userRoomId).emit('reaction-received', {
      emoji: emoji || '🔥',
      senderName: user ? user.name : 'Friend',
      senderId: socket.id
    });
  });

  // 9. Host controls toggle
  socket.on('toggle-free-control', () => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (room && room.hostSocketId === socket.id) {
      room.freeControl = !room.freeControl;
      io.to(userRoomId).emit('control-mode-changed', { freeControl: room.freeControl });
    }
  });

  // 10. Admin Authentication
  socket.on('admin-login', ({ password }, cb) => {
    if (password === ADMIN_PASSWORD) {
      socket.isAdmin = true;
      console.log(`[Admin Login Success] Socket: ${socket.id}`);
      if (typeof cb === 'function') cb({ success: true, message: 'Admin authenticated' });
    } else {
      console.warn(`[Admin Login Failed] Socket: ${socket.id}`);
      if (typeof cb === 'function') cb({ success: false, message: 'Invalid Admin Password' });
    }
  });

  // 11. Admin Kick User
  socket.on('admin-kick-user', ({ targetSocketId }, cb) => {
    if (!socket.isAdmin) {
      if (typeof cb === 'function') cb({ success: false, message: 'Admin permission required' });
      return;
    }

    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    const targetUser = room.users.get(targetSocketId);
    const targetName = targetUser?.name || 'User';

    if (targetSocket) {
      targetSocket.emit('kicked-from-party', {
        reason: 'You were removed from the party by Admin.'
      });
      targetSocket.disconnect(true);
    }

    room.users.delete(targetSocketId);
    io.to(userRoomId).emit('users-updated', {
      users: Array.from(room.users.values()),
      userCount: room.users.size,
      hostSocketId: room.hostSocketId
    });

    console.log(`[Admin Kicked] ${targetName} (${targetSocketId})`);
    if (typeof cb === 'function') cb({ success: true, message: `Kicked ${targetName}` });
  });

  // 12. Admin Delete Track
  socket.on('admin-delete-track', ({ filename }, cb) => {
    if (!socket.isAdmin) {
      if (typeof cb === 'function') cb({ success: false, message: 'Admin permission required' });
      return;
    }

    const safeName = path.basename(filename);
    const filePath = path.join(UPLOADS_DIR, safeName);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        if (typeof cb === 'function') cb({ success: false, message: e.message });
        return;
      }
    }

    // If currently playing in any room, stop or skip
    rooms.forEach(room => {
      if (room.currentTrack?.filename === safeName) {
        if (room.queue.length > 0) {
          const next = room.queue.shift();
          room.setTrack(next, true);
          io.to(room.roomId).emit('track-changed', room.getState());
        } else {
          room.stop();
          io.to(room.roomId).emit('track-changed', room.getState());
        }
      } else {
        room.queue = room.queue.filter(t => t.filename !== safeName);
        io.to(room.roomId).emit('queue-updated', { queue: room.queue });
      }
    });

    io.emit('library-updated');
    console.log(`[Admin Deleted Track] ${safeName}`);
    if (typeof cb === 'function') cb({ success: true, message: 'Track deleted' });
  });

  // 10. Disconnect handling
  socket.on('disconnect', () => {
    if (userRoomId && rooms.has(userRoomId)) {
      const room = rooms.get(userRoomId);
      const user = room.users.get(socket.id);
      room.users.delete(socket.id);

      // Reassign host if host left
      if (room.hostSocketId === socket.id && room.users.size > 0) {
        const nextHostId = room.users.keys().next().value;
        room.hostSocketId = nextHostId;
        const newHostUser = room.users.get(nextHostId);
        if (newHostUser) newHostUser.isHost = true;
      }

      io.to(userRoomId).emit('users-updated', {
        users: Array.from(room.users.values()),
        userCount: room.users.size,
        hostSocketId: room.hostSocketId
      });

      console.log(`[User Left] ${user?.name || socket.id} from Room: ${userRoomId}`);

      // Cleanup room after 30 minutes if empty
      if (room.users.size === 0) {
        setTimeout(() => {
          if (rooms.get(userRoomId)?.users.size === 0) {
            rooms.delete(userRoomId);
            console.log(`[Room Cleaned] Room ${userRoomId} deleted`);
          }
        }, 30 * 60 * 1000);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log(`\n======================================================`);
  console.log(`  🎵 SYNC PARTY MUSIC SERVER IS RUNNING! 🎵`);
  console.log(`======================================================`);
  console.log(`  Local (This PC):    http://localhost:${PORT}`);
  ips.forEach(ip => {
    console.log(`  Friends Mobile:     http://${ip.address}:${PORT}`);
  });
  console.log(`======================================================\n`);
});
