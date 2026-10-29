const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
server.timeout = 15 * 60 * 1000;
server.keepAliveTimeout = 15 * 60 * 1000;
server.headersTimeout = 16 * 60 * 1000;
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
  limits: { fileSize: 250 * 1024 * 1024 }, // 250 MB max per song
  fileFilter: (req, file, cb) => {
    // Permissive for mobile uploads (handles audio/mpeg, octet-stream, mp3, m4a, etc.)
    cb(null, true);
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

// ========================================================
// 📱 In-App Auto-Update Endpoint for SyncTunes Android App
// ========================================================
app.get('/api/app-version', (req, res) => {
  res.json({
    versionCode: 4, // Bumped to 2 for In-App Auto-Update!
    versionName: "1.3.0",
    apkUrl: "https://music-together-tr1h.onrender.com/download/latest.apk",
    releaseNotes: "• Zero-delay precision audio sync\n• Fixed track auto-skipping\n• Restored original working UI\n* signature",
    forceUpdate: false
  });
});

// Serve the latest APK for in-app downloads
app.get('/download/latest.apk', (req, res) => {
  const apkPath = path.join(__dirname, 'public', 'downloads', 'SyncTunes-latest.apk');
  if (fs.existsSync(apkPath)) {
    res.download(apkPath, 'SyncTunes-latest.apk');
  } else {
    res.status(404).json({ error: 'No APK update uploaded yet. Place SyncTunes-latest.apk in public/downloads/' });
  }
});

// SEO: Robots.txt & Sitemap for Google Search Console
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nSitemap: https://${req.headers.host}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${req.headers.host}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

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
  req.setTimeout(15 * 60 * 1000);
  res.setTimeout(15 * 60 * 1000);
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

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '246890';
// Secret Recovery Phrase strictly stored on server (never exposed to client)
const ADMIN_SECURITY_ANSWER = 'I am a good boy';

// Global Website Maintenance / Staging Flag
// Starts in Admin-Test Mode (true) on fresh deploy so Admin can test first before making site Live!
// (Can be overridden to start directly Live by setting AUTO_MAINTENANCE=false in Render environment variables)
let isMaintenanceMode = process.env.AUTO_MAINTENANCE === 'false' ? false : true;

// Maintenance status API endpoint
app.get('/api/maintenance', (req, res) => {
  res.json({ isMaintenanceMode });
});

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

// YouTube Search API (Zero API key needed, high performance with 15-min in-memory cache)
const searchCache = new Map();

app.get('/api/youtube-search', (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ success: false, error: 'Query parameter q is required' });
  }

  const cacheKey = query.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < 15 * 60 * 1000)) {
    return res.json({ success: true, results: cached.results, cached: true });
  }

  const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const request = https.get(ytUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  }, (ytRes) => {
    let data = '';
    ytRes.on('data', chunk => { data += chunk; });
    ytRes.on('end', () => {
      try {
        const match = data.match(/var ytInitialData = ({.*?});<\/script>/s) || data.match(/ytInitialData\s*=\s*({.+?});/);
        if (!match) {
          return res.json({ success: true, results: [] });
        }
        const json = JSON.parse(match[1]);
        const contents = json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
        const results = [];
        if (contents) {
          for (const section of contents) {
            const itemSection = section.itemSectionRenderer?.contents;
            if (itemSection) {
              for (const item of itemSection) {
                const vr = item.videoRenderer;
                if (vr && vr.videoId) {
                  results.push({
                    id: vr.videoId,
                    title: vr.title?.runs?.[0]?.text || 'YouTube Video',
                    duration: vr.lengthText?.simpleText || '',
                    channel: vr.ownerText?.runs?.[0]?.text || '',
                    thumbnail: vr.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
                    views: vr.viewCountText?.simpleText || ''
                  });
                  if (results.length >= 10) break;
                }
              }
              if (results.length > 0) break;
            }
          }
        }
        searchCache.set(cacheKey, { timestamp: Date.now(), results });
        res.json({ success: true, results });
      } catch (err) {
        console.error('YouTube Search Parse Error:', err);
        res.status(500).json({ success: false, error: 'Failed to parse YouTube results' });
      }
    });
  });

  request.on('error', (err) => {
    console.error('YouTube Search Request Error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch search results' });
  });

  request.setTimeout(10000, () => {
    request.destroy();
    res.status(504).json({ success: false, error: 'Search request timeout' });
  });
});

// Rooms State Management
class SyncRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.version = 1;
    this.hostSocketId = null;
    this.currentTrack = null;
    this.status = 'paused'; // 'playing' | 'paused' | 'stopped'
    this.position = 0;      // seconds at updatedAt
    this.updatedAt = Date.now();
    this.playbackRate = 1.0;
    this.queue = [];
    this.users = new Map(); // socketId -> { id, name, isHost, avatar, joinedAt }
    this.freeControl = true; // allow friends to also play/pause/add songs
    this.isLocked = false;   // Room lock: only Host or Admin can lock / unlock
    this.kickedUsers = new Set(); // Sockets kicked from this room
    this.chatHistory = [];   // Live Room Chat messages (last 50)
  }

  getCurrentPosition() {
    if (this.status !== 'playing') {
      return this.position;
    }
    const now = Date.now();
    if (now < this.updatedAt) {
      return this.position;
    }
    const elapsed = (now - this.updatedAt) / 1000;
    return this.position + (elapsed * this.playbackRate);
  }

  play(atPosition = null, atTimestamp = null) {
    this.version++;
    const now = atTimestamp || (Date.now() + 800);
    if (atPosition !== null && !isNaN(atPosition)) {
      this.position = Math.max(0, atPosition);
    }
    this.status = 'playing';
    this.updatedAt = now;
  }

  pause(atPosition = null) {
    this.version++;
    const now = Date.now();
    if (atPosition !== null && !isNaN(atPosition)) {
      this.position = Math.max(0, atPosition);
    } else {
      this.position = this.getCurrentPosition();
    }
    this.status = 'paused';
    this.updatedAt = now;
  }

  seek(targetPosition, atTimestamp = null) {
    this.version++;
    const now = atTimestamp || (this.status === 'playing' ? (Date.now() + 500) : Date.now());
    this.position = Math.max(0, targetPosition);
    this.updatedAt = now;
  }

  setTrack(track, autoplay = true, atTimestamp = null) {
    this.version++;
    const now = atTimestamp || (autoplay ? (Date.now() + 700) : Date.now());
    this.currentTrack = track;
    this.position = 0;
    this.status = autoplay ? 'playing' : 'paused';
    this.updatedAt = now;
  }

  hasAdmin() {
    for (const u of this.users.values()) {
      if (u.isAdmin) return true;
    }
    return false;
  }

  getState() {
    return {
      roomId: this.roomId,
      version: this.version,
      hostSocketId: this.hostSocketId,
      currentTrack: this.currentTrack,
      status: this.status,
      position: this.getCurrentPosition(),
      updatedAt: this.updatedAt,
      startAt: this.updatedAt,
      serverTime: Date.now(),
      playbackRate: this.playbackRate,
      queue: this.queue,
      userCount: this.users.size,
      users: Array.from(this.users.values()),
      freeControl: this.freeControl,
      isLocked: this.isLocked,
      hasAdmin: this.hasAdmin(),
      chatHistory: this.chatHistory ? this.chatHistory.slice(-50) : []
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

  // Send initial maintenance status
  socket.emit('maintenance-status', { isMaintenanceMode, isAdmin: !!socket.isAdmin });

  // 1. Precise NTP Clock Sync Handshake
  socket.on('sync-time', (clientT0, callback) => {
    if (typeof callback === 'function') {
      callback({
        clientT0: clientT0,
        serverTime: Date.now()
      });
    }
  });

  function cleanLeaveRoom(s) {
    if (userRoomId && rooms.has(userRoomId)) {
      s.leave(userRoomId);
      const prevRoom = rooms.get(userRoomId);
      prevRoom.users.delete(s.id);
      if (prevRoom.hostSocketId === s.id && prevRoom.users.size > 0) {
        const nextHostId = prevRoom.users.keys().next().value;
        prevRoom.hostSocketId = nextHostId;
        const newHostUser = prevRoom.users.get(nextHostId);
        if (newHostUser) newHostUser.isHost = true;
      }
      io.to(userRoomId).emit('users-updated', {
        users: Array.from(prevRoom.users.values()),
        userCount: prevRoom.users.size,
        hostSocketId: prevRoom.hostSocketId,
        hasAdmin: prevRoom.hasAdmin()
      });
      // Cleanup empty room after 15 mins (except default party lounge)
      if (prevRoom.users.size === 0 && userRoomId !== 'party') {
        const toDeleteId = userRoomId;
        setTimeout(() => {
          if (rooms.get(toDeleteId)?.users.size === 0) {
            rooms.delete(toDeleteId);
            console.log(`[Room Cleaned] Inactive Room ${toDeleteId} deleted`);
          }
        }, 15 * 60 * 1000);
      }
      console.log(`[User Left] ${s.id} left Room: ${userRoomId}`);
      userRoomId = null;
    }
  }

  // 2a. Create a brand new 6-digit room (Registers room on server)
  socket.on('create-room', ({ roomId, userName, avatar }, callback) => {
    // MAINTENANCE CHECK: Only Admin can create rooms during maintenance
    if (isMaintenanceMode && !socket.isAdmin) {
      if (typeof callback === 'function') {
        callback({ success: false, maintenance: true, message: 'Website is currently Under Maintenance. Only Admin can access.' });
      }
      return;
    }

    const cleanId = (roomId || '').trim().toLowerCase();
    if (!cleanId) {
      if (typeof callback === 'function') callback({ success: false, message: 'Invalid Room Code' });
      return;
    }

    cleanLeaveRoom(socket);

    userRoomId = cleanId;
    socket.join(userRoomId);

    // If room already exists, join existing room rather than wiping it!
    let room = rooms.get(userRoomId);
    if (room && room.kickedUsers && (room.kickedUsers.has(socket.id) || (socket.isKickedFromRooms && socket.isKickedFromRooms.has(cleanId)))) {
      const errMsg = `🚫 You were removed from Room #${cleanId} by the Admin and cannot rejoin.`;
      if (typeof callback === 'function') callback({ success: false, message: errMsg });
      else socket.emit('join-error', { message: errMsg });
      return;
    }

    let isNew = false;
    if (!room) {
      room = new SyncRoom(userRoomId);
      room.hostSocketId = socket.id;
      rooms.set(userRoomId, room);
      isNew = true;
    } else if (!room.hostSocketId || room.users.size === 0) {
      room.hostSocketId = socket.id;
    }

    const userData = {
      id: socket.id,
      name: userName || (socket.isAdmin ? 'Admin 👑' : `Host`),
      avatar: avatar || (socket.isAdmin ? '👑' : '🎵'),
      isHost: isNew || (room.hostSocketId === socket.id),
      isAdmin: socket.isAdmin || false,
      joinedAt: Date.now()
    };
    room.users.set(socket.id, userData);

    if (typeof callback === 'function') {
      callback({ success: true, roomId: userRoomId, state: room.getState() });
    }

    socket.emit('room-state', {
      ...room.getState(),
      myId: socket.id,
      isHost: userData.isHost,
      isAdmin: userData.isAdmin
    });

    io.to(userRoomId).emit('users-updated', {
      users: Array.from(room.users.values()),
      userCount: room.users.size,
      hostSocketId: room.hostSocketId
    });

    console.log(`[Room ${isNew ? 'Created' : 'Joined'}] ${userData.name} (${socket.id}) in Room: ${userRoomId}`);
  });

  // 2b. Join an existing room with code (Strict Validation: room must exist!)
  socket.on('join-room', ({ roomId, userName, avatar, isAdmin: clientIsAdmin }, callback) => {
    const cleanId = (roomId || '').trim().toLowerCase();

    // STRICT VALIDATION: Room must already exist on server!
    if (!cleanId || !rooms.has(cleanId)) {
      const errMsg = `Room #${cleanId || ''} does not exist! Ask your friend to click "Create Room" first or check the 6-digit code.`;
      if (typeof callback === 'function') {
        callback({ success: false, message: errMsg });
      } else {
        socket.emit('join-error', { message: errMsg });
      }
      return;
    }

    const room = rooms.get(cleanId);

    // KICK/BAN VALIDATION:
    if (room.kickedUsers && (room.kickedUsers.has(socket.id) || (socket.isKickedFromRooms && socket.isKickedFromRooms.has(cleanId)))) {
      const errMsg = `🚫 You were removed from Room #${cleanId} by the Admin and cannot rejoin.`;
      if (typeof callback === 'function') callback({ success: false, message: errMsg });
      else socket.emit('join-error', { message: errMsg });
      return;
    }

    // MAINTENANCE CHECK: Only Admin can enter rooms during maintenance
    const hasAdminPrivilege = socket.isAdmin || clientIsAdmin;
    if (isMaintenanceMode && !hasAdminPrivilege) {
      const errMsg = 'Website is currently Under Maintenance. Only Admin can access.';
      if (typeof callback === 'function') callback({ success: false, maintenance: true, message: errMsg });
      else socket.emit('join-error', { message: errMsg, maintenance: true });
      return;
    }

    // LOCK VALIDATION: If room is locked, Admin can ALWAYS enter!
    if (room.isLocked && !hasAdminPrivilege) {
      const errMsg = `🔒 Room #${cleanId} is locked by Host / Admin! Guests cannot join right now.`;
      if (typeof callback === 'function') {
        callback({ success: false, message: errMsg, isLocked: true });
      } else {
        socket.emit('join-error', { message: errMsg, isLocked: true });
      }
      return;
    }

    cleanLeaveRoom(socket);

    userRoomId = cleanId;
    socket.join(userRoomId);

    const isFirstUser = room.users.size === 0 || !room.hostSocketId;
    if (isFirstUser) {
      room.hostSocketId = socket.id;
    }

    const userData = {
      id: socket.id,
      name: userName || (hasAdminPrivilege ? 'Admin 👑' : `Friend ${room.users.size + 1}`),
      avatar: avatar || (hasAdminPrivilege ? '👑' : '🎵'),
      isHost: (room.hostSocketId === socket.id),
      isAdmin: hasAdminPrivilege || false,
      joinedAt: Date.now()
    };
    room.users.set(socket.id, userData);

    if (typeof callback === 'function') {
      callback({ success: true, roomId: userRoomId, state: room.getState() });
    }

    socket.emit('room-state', {
      ...room.getState(),
      myId: socket.id,
      isHost: userData.isHost,
      isAdmin: userData.isAdmin
    });

    io.to(userRoomId).emit('users-updated', {
      users: Array.from(room.users.values()),
      userCount: room.users.size,
      hostSocketId: room.hostSocketId
    });

    console.log(`[User Joined] ${userData.name} (${socket.id}) joined Room: ${userRoomId}`);
  });

  // 2b. User updates profile (name or avatar)
  socket.on('update-profile', ({ userName, avatar }) => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (user) {
      if (userName && userName.trim()) user.name = userName.trim();
      if (avatar) user.avatar = avatar;
      io.to(userRoomId).emit('users-updated', {
        users: Array.from(room.users.values()),
        userCount: room.users.size,
        hostSocketId: room.hostSocketId
      });
      console.log(`[Profile Updated] ${user.name} (${socket.id})`);
    }
  });

  // 3. Play command (INSTANT PLAY - NO 800ms DELAY)
  socket.on('play', ({ position }) => {
    if (isMaintenanceMode && !socket.isAdmin) return;
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    // Instant playback start: speed-gliding handles millisecond device alignment dynamically
    const startAt = Date.now();
    room.play(position, startAt);
    io.to(userRoomId).emit('state-sync', {
      version: room.version,
      status: 'playing',
      position: room.position,
      updatedAt: startAt,
      startAt: startAt,
      serverTime: Date.now(),
      currentTrack: room.currentTrack
    });
  });

  // 4. Pause command (INSTANT STOP ON ALL DEVICES)
  socket.on('pause', ({ position }) => {
    if (isMaintenanceMode && !socket.isAdmin) return;
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    room.pause(position);
    io.to(userRoomId).emit('state-sync', {
      version: room.version,
      status: 'paused',
      position: room.position,
      updatedAt: room.updatedAt,
      startAt: room.updatedAt,
      serverTime: Date.now(),
      currentTrack: room.currentTrack
    });
  });

  // 5. Seek command (INSTANT SEEK)
  socket.on('seek', ({ position }) => {
    if (isMaintenanceMode && !socket.isAdmin) return;
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    const startAt = Date.now();
    room.seek(position, startAt);
    io.to(userRoomId).emit('state-sync', {
      version: room.version,
      status: room.status,
      position: room.position,
      updatedAt: startAt,
      startAt: startAt,
      serverTime: Date.now(),
      currentTrack: room.currentTrack,
      isSeek: true
    });
  });

  // 6. Change / Play New Track (INSTANT CHANGE)
  socket.on('change-track', ({ track, autoplay = true }) => {
    if (isMaintenanceMode && !socket.isAdmin) return;
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    const startAt = Date.now();
    room.setTrack(track, autoplay, startAt);
    io.to(userRoomId).emit('track-changed', {
      ...room.getState(),
      updatedAt: startAt,
      startAt: startAt
    });
  });

  // 7. Queue management
  socket.on('add-queue', (track) => {
    if (isMaintenanceMode && !socket.isAdmin) return;
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    // If nothing currently playing, play immediately
    if (!room.currentTrack) {
      const startAt = Date.now();
      room.setTrack(track, true, startAt);
      io.to(userRoomId).emit('track-changed', {
        ...room.getState(),
        updatedAt: startAt,
        startAt: startAt
      });
    } else {
      room.queue.push(track);
      io.to(userRoomId).emit('queue-updated', { queue: room.queue });
    }
  });

  socket.on('remove-queue', ({ index }) => {
    if (isMaintenanceMode && !socket.isAdmin) return;
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;
    if (index >= 0 && index < room.queue.length) {
      room.queue.splice(index, 1);
      io.to(userRoomId).emit('queue-updated', { queue: room.queue });
    }
  });

  socket.on('next-track', () => {
    if (isMaintenanceMode && !socket.isAdmin) return;
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    if (room.queue.length > 0) {
      const nextTrack = room.queue.shift();
      const startAt = Date.now();
      room.setTrack(nextTrack, true, startAt);
      io.to(userRoomId).emit('track-changed', {
        ...room.getState(),
        updatedAt: startAt,
        startAt: startAt
      });
    } else {
      // Keep track loaded at 0 position, paused - NEVER wipe currentTrack!
      room.pause(0);
      io.to(userRoomId).emit('state-sync', {
        version: room.version,
        status: 'paused',
        position: 0,
        updatedAt: room.updatedAt,
        startAt: room.updatedAt,
        serverTime: Date.now(),
        currentTrack: room.currentTrack
      });
    }
  });

  // Fetch current state on demand (e.g., when mobile tab wakes up from sleep)
  socket.on('get-state', (callback) => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (room && typeof callback === 'function') {
      callback({
        state: room.getState(),
        queue: room.queue
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

  // 9b. Toggle Room Lock
  socket.on('toggle-room-lock', (callback) => {
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    const user = room.users.get(socket.id);
    if (!user) return;

    const isUserAdmin = socket.isAdmin || user.isAdmin;
    const isUserHost = (room.hostSocketId === socket.id);
    const adminInRoom = room.hasAdmin();

    // User's Strict Rules:
    // 1. If Admin is in the room: Host CANNOT lock/unlock. ONLY Admin can lock/unlock!
    // 2. If NO Admin is in the room: Host CAN lock/unlock!
    // 3. When Admin leaves the room: Host can lock/unlock again!
    if (adminInRoom) {
      if (!isUserAdmin) {
        if (typeof callback === 'function') {
          callback({ success: false, message: '👑 Admin is present in this room! Only Admin can lock or unlock the room.' });
        }
        return;
      }
    } else {
      if (!isUserHost && !isUserAdmin) {
        if (typeof callback === 'function') {
          callback({ success: false, message: '🔒 Only the Room Host can lock or unlock this room.' });
        }
        return;
      }
    }

    room.isLocked = !room.isLocked;
    const actorName = isUserAdmin ? 'Admin 👑' : (user.name || 'Host');

    io.to(userRoomId).emit('room-lock-changed', {
      isLocked: room.isLocked,
      by: actorName,
      hasAdmin: adminInRoom
    });

    console.log(`[Room Lock] Room ${userRoomId} ${room.isLocked ? 'LOCKED' : 'UNLOCKED'} by ${actorName}`);
    if (typeof callback === 'function') {
      callback({ success: true, isLocked: room.isLocked });
    }
  });

  // 9c. Admin Assigns/Chooses Room Host
  socket.on('admin-set-host', ({ targetSocketId }, cb) => {
    if (!socket.isAdmin) {
      if (typeof cb === 'function') cb({ success: false, message: 'Admin permission required' });
      return;
    }
    if (!userRoomId) return;
    const room = rooms.get(userRoomId);
    if (!room) return;

    if (!room.users.has(targetSocketId)) {
      if (typeof cb === 'function') cb({ success: false, message: 'User not found in room' });
      return;
    }

    room.hostSocketId = targetSocketId;
    room.users.forEach((u, sid) => {
      u.isHost = (sid === targetSocketId);
    });

    const newHost = room.users.get(targetSocketId);
    const newHostName = newHost ? newHost.name : 'Friend';

    io.to(userRoomId).emit('users-updated', {
      users: Array.from(room.users.values()),
      userCount: room.users.size,
      hostSocketId: room.hostSocketId,
      hasAdmin: room.hasAdmin()
    });

    io.to(userRoomId).emit('host-changed', {
      newHostId: targetSocketId,
      newHostName: newHostName
    });

    console.log(`[Admin Changed Host] ${newHostName} (${targetSocketId}) is now Host of Room ${userRoomId}`);
    if (typeof cb === 'function') cb({ success: true, newHost: newHostName });
  });

  // 10. Admin Authentication
  socket.on('admin-login', ({ password }, cb) => {
    if (password === ADMIN_PASSWORD) {
      socket.isAdmin = true;
      if (userRoomId && rooms.has(userRoomId)) {
        const room = rooms.get(userRoomId);
        const user = room.users.get(socket.id);
        if (user) user.isAdmin = true;
        io.to(userRoomId).emit('users-updated', {
          users: Array.from(room.users.values()),
          userCount: room.users.size,
          hostSocketId: room.hostSocketId,
          hasAdmin: room.hasAdmin()
        });
      }
      console.log(`[Admin Login Success] Socket: ${socket.id}`);
      socket.emit('maintenance-status', { isMaintenanceMode, isAdmin: true });
      if (typeof cb === 'function') cb({ success: true, message: 'Admin authenticated', isMaintenanceMode });
    } else {
      console.warn(`[Admin Login Failed] Socket: ${socket.id}`);
      if (typeof cb === 'function') cb({ success: false, message: 'Invalid Admin Password' });
    }
  });

  // 10b. Admin Forgot Password via Secret Verification Phrase
  socket.on('admin-forgot-password', ({ securityAnswer, newPassword }, cb) => {
    // Strictly verify against server-side secret (never exposed to client)
    if (typeof securityAnswer === 'string' && securityAnswer.trim() === ADMIN_SECURITY_ANSWER) {
      if (newPassword && typeof newPassword === 'string' && newPassword.trim().length >= 4) {
        ADMIN_PASSWORD = newPassword.trim();
        console.log(`[Admin Password Updated] New password set via recovery key`);
      }
      socket.isAdmin = true;
      if (userRoomId && rooms.has(userRoomId)) {
        const room = rooms.get(userRoomId);
        const user = room.users.get(socket.id);
        if (user) user.isAdmin = true;
        io.to(userRoomId).emit('users-updated', {
          users: Array.from(room.users.values()),
          userCount: room.users.size,
          hostSocketId: room.hostSocketId,
          hasAdmin: true
        });
      }
      console.log(`[Admin Recovery Success] Socket: ${socket.id}`);
      socket.emit('maintenance-status', { isMaintenanceMode, isAdmin: true });
      if (typeof cb === 'function') cb({ success: true, message: 'Security verified! 👑 Logged in as Admin.', isMaintenanceMode });
    } else {
      console.warn(`[Admin Recovery Failed] Socket: ${socket.id}`);
      if (typeof cb === 'function') cb({ success: false, message: 'Incorrect Security Answer! Please enter exact phrase.' });
    }
  });

  // 10c. Admin Toggle Website Maintenance Mode
  socket.on('toggle-maintenance', ({ enabled }, cb) => {
    if (!socket.isAdmin) {
      if (typeof cb === 'function') cb({ success: false, message: 'Admin permission required' });
      return;
    }
    isMaintenanceMode = (enabled !== undefined) ? !!enabled : !isMaintenanceMode;
    console.log(`[Maintenance Mode Changed] isMaintenanceMode = ${isMaintenanceMode} by Admin ${socket.id}`);
    
    // Broadcast maintenance state to all connected clients
    io.emit('maintenance-status', { isMaintenanceMode });

    // When Maintenance is turned ON, immediately pause all active rooms so visitors' music completely stops
    if (isMaintenanceMode) {
      for (const [rId, room] of rooms.entries()) {
        if (room.status === 'playing') {
          room.pause(room.position);
          io.to(rId).emit('state-sync', {
            version: ++room.version,
            status: 'paused',
            position: room.position,
            updatedAt: room.updatedAt,
            startAt: room.updatedAt,
            serverTime: Date.now(),
            currentTrack: room.currentTrack
          });
        }
      }
    }

    if (typeof cb === 'function') cb({ success: true, isMaintenanceMode });
  });

  // 10d. Admin Logout
  socket.on('admin-logout', (cb) => {
    socket.isAdmin = false;
    if (userRoomId && rooms.has(userRoomId)) {
      const room = rooms.get(userRoomId);
      const user = room.users.get(socket.id);
      if (user) user.isAdmin = false;
      io.to(userRoomId).emit('users-updated', {
        users: Array.from(room.users.values()),
        userCount: room.users.size,
        hostSocketId: room.hostSocketId,
        hasAdmin: room.hasAdmin()
      });
    }
    socket.emit('maintenance-status', { isMaintenanceMode, isAdmin: false });
    if (typeof cb === 'function') cb({ success: true });
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

    if (!room.kickedUsers) room.kickedUsers = new Set();
    room.kickedUsers.add(targetSocketId);

    if (targetSocket) {
      targetSocket.isKickedFromRooms = targetSocket.isKickedFromRooms || new Set();
      targetSocket.isKickedFromRooms.add(userRoomId);

      targetSocket.emit('kicked-from-party', {
        reason: 'You were removed from this party by the Admin.'
      });
      try { targetSocket.leave(userRoomId); } catch (e) {}
      targetSocket.disconnect(true);
    }

    room.users.delete(targetSocketId);
    io.to(userRoomId).emit('users-updated', {
      users: Array.from(room.users.values()),
      userCount: room.users.size,
      hostSocketId: room.hostSocketId,
      hasAdmin: room.hasAdmin()
    });

    console.log(`[Admin Kicked] ${targetName} (${targetSocketId}) from Room ${userRoomId}`);
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

  // 13. Live Room Chat
  socket.on('send-chat-message', ({ text }, cb) => {
    if (!userRoomId || !rooms.has(userRoomId)) {
      if (typeof cb === 'function') cb({ success: false, message: 'Not in a room' });
      return;
    }
    const cleanText = (text || '').trim();
    if (!cleanText) return;
    if (cleanText.length > 300) {
      if (typeof cb === 'function') cb({ success: false, message: 'Message too long (max 300 chars)' });
      return;
    }

    const room = rooms.get(userRoomId);
    const user = room.users.get(socket.id);
    const senderName = user?.name || (socket.isAdmin ? 'Admin 👑' : 'Guest');
    const senderAvatar = user?.avatar || (socket.isAdmin ? '👑' : '🎧');

    const chatMsg = {
      id: 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      senderId: socket.id,
      senderName,
      senderAvatar,
      isAdmin: socket.isAdmin || false,
      text: cleanText,
      timestamp: Date.now()
    };

    if (!room.chatHistory) room.chatHistory = [];
    room.chatHistory.push(chatMsg);
    if (room.chatHistory.length > 50) room.chatHistory.shift();

    io.to(userRoomId).emit('new-chat-message', chatMsg);
    if (typeof cb === 'function') cb({ success: true });
  });

  // 14. Disconnect handling
  socket.on('disconnect', () => {
    cleanLeaveRoom(socket);
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
