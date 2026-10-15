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
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e4);
    cb(null, `${uniqueSuffix}-${cleanName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max per song
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
    if (allowedExts.includes(ext) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed (.mp3, .wav, .ogg, .m4a, .aac, .flac)'));
    }
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

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

// Upload audio file
app.post('/api/upload', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }

  // Derive title from original file name
  const originalName = req.file.originalname;
  const title = path.basename(originalName, path.extname(originalName));

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
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '246890';

// List uploaded tracks
app.get('/api/tracks', (req, res) => {
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Could not read uploads' });
    const tracks = files.map(filename => {
      const stats = fs.statSync(path.join(UPLOADS_DIR, filename));
      // Extract clean title
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
    }).sort((a, b) => b.uploadedAt - a.uploadedAt);
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
