document.addEventListener('DOMContentLoaded', () => {
  // 1. Setup Room & User info
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room') || 'party';
  
  let savedName = localStorage.getItem('sync_username');
  if (!savedName) {
    const emojis = ['🎧', '⚡', '🎵', '🔥', '🚀', '🌟'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    savedName = `Friend ${Math.floor(Math.random() * 900) + 100} ${randomEmoji}`;
    localStorage.setItem('sync_username', savedName);
  }

  // DOM Elements
  const roomNameEl = document.getElementById('room-name');
  const userCountEl = document.getElementById('user-count');
  const friendsListEl = document.getElementById('friends-list');
  const pingMsEl = document.getElementById('ping-ms');
  const driftBadgeEl = document.getElementById('drift-badge');
  const unlockOverlay = document.getElementById('unlock-overlay');

  const coverImg = document.getElementById('cover-img');
  const coverPlaceholder = document.getElementById('cover-placeholder');
  const trackTitleEl = document.getElementById('track-title');
  const trackSubEl = document.getElementById('track-sub');
  const trackSourceEl = document.getElementById('track-source');
  const waveBarsContainer = document.getElementById('wave-bars');

  const timeSlider = document.getElementById('time-slider');
  const currentTimeLabel = document.getElementById('current-time-label');
  const totalTimeLabel = document.getElementById('total-time-label');

  const btnPlayMaster = document.getElementById('btn-play-master');
  const btnNext = document.getElementById('btn-next');
  const volumeSlider = document.getElementById('volume-slider');
  const btnMute = document.getElementById('btn-mute');

  const ytUrlInput = document.getElementById('yt-url-input');
  const btnYtPlay = document.getElementById('btn-yt-play');
  const btnYtQueue = document.getElementById('btn-yt-queue');

  const mp3FileInput = document.getElementById('mp3-file-input');
  const mp3Dropzone = document.getElementById('mp3-dropzone');
  const uploadStatusEl = document.getElementById('upload-status');
  const mp3ListEl = document.getElementById('mp3-list');
  const queueListEl = document.getElementById('queue-list');

  const btnShare = document.getElementById('btn-share');
  const qrModal = document.getElementById('qr-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const qrImg = document.getElementById('qr-img');
  const shareLinkInput = document.getElementById('share-link-input');
  const btnCopyLink = document.getElementById('btn-copy-link');

  roomNameEl.textContent = '#' + roomId;

  // 2. Connect Socket.IO with WebSocket transport for zero latency
  const socket = io({
    transports: ['websocket', 'polling'],
    upgrade: true
  });
  const syncEngine = new SyncEngine(socket);

  let currentRoomState = null;
  let isHost = false;
  let isSeeking = false;
  let isAdmin = false;
  let cachedUsers = [];
  let cachedHostId = null;
  let cachedMp3Tracks = [];

  // 3. Initialize Unified Player
  const player = new UnifiedSyncPlayer(syncEngine, {
    onProgress: (current, duration) => {
      if (!isSeeking && duration > 0) {
        timeSlider.value = (current / duration) * 100;
        currentTimeLabel.textContent = formatTime(current);
        totalTimeLabel.textContent = formatTime(duration);
      } else if (!isSeeking) {
        currentTimeLabel.textContent = formatTime(current);
      }
    },
    onDriftUpdate: (driftMs) => {
      driftBadgeEl.textContent = `Sync: ${driftMs >= 0 ? '+' : ''}${driftMs}ms`;
      if (Math.abs(driftMs) < 50) {
        driftBadgeEl.style.color = '#10b981'; // Green
      } else if (Math.abs(driftMs) < 200) {
        driftBadgeEl.style.color = '#ffd166'; // Yellow
      } else {
        driftBadgeEl.style.color = '#ff6b6b'; // Red
      }
    },
    onTrackEnded: () => {
      // Auto play next track in queue
      socket.emit('next-track');
    }
  });

  // 4. Mobile Audio Unlock Behavior
  const triggerUnlock = () => {
    player.unlock();
    if (unlockOverlay) unlockOverlay.style.display = 'none';
    const soundNotice = document.getElementById('sound-notice');
    if (soundNotice) soundNotice.style.display = 'none';
  };

  if (unlockOverlay) {
    unlockOverlay.style.display = 'block';
    unlockOverlay.addEventListener('click', triggerUnlock);
  }

  // Any tap or click anywhere on screen ensures audio is unmuted
  document.addEventListener('click', triggerUnlock);
  document.addEventListener('touchstart', triggerUnlock, { passive: true });

  // 5. Sync Engine Updates (Latency & Clock Offset)
  syncEngine.onSyncUpdate = ({ offset, rtt }) => {
    pingMsEl.textContent = `${Math.round(rtt)}ms`;
  };

  // 6. Join Room
  socket.emit('join-room', {
    roomId,
    userName: savedName
  });

  // 7. Socket Event Listeners
  socket.on('room-state', (state) => {
    currentRoomState = state;
    isHost = state.isHost;
    updateUIFromState(state);
    player.syncToState(state, true);
  });

  socket.on('state-sync', (syncData) => {
    if (!currentRoomState) return;
    currentRoomState.status = syncData.status;
    currentRoomState.position = syncData.position;
    currentRoomState.updatedAt = syncData.updatedAt;
    currentRoomState.currentTrack = syncData.currentTrack;

    updatePlayPauseButton(syncData.status === 'playing');
    player.syncToState(currentRoomState, !!syncData.isSeek);
  });

  socket.on('track-changed', (state) => {
    currentRoomState = state;
    updateUIFromState(state);
    player.syncToState(state, true);
  });

  socket.on('users-updated', ({ users, userCount, hostSocketId }) => {
    userCountEl.textContent = `${userCount} listener${userCount > 1 ? 's' : ''}`;
    renderFriendsList(users, hostSocketId);
  });

  socket.on('queue-updated', ({ queue }) => {
    if (currentRoomState) currentRoomState.queue = queue;
    renderQueue(queue);
  });

  socket.on('reaction-received', ({ emoji, senderName, senderId }) => {
    spawnFloatingEmoji(emoji, senderName, senderId === socket.id);
  });

  // 8. UI State Updating
  function updateUIFromState(state) {
    updatePlayPauseButton(state.status === 'playing');

    if (state.currentTrack) {
      trackTitleEl.textContent = state.currentTrack.title || 'Untitled Track';
      trackSourceEl.textContent = state.currentTrack.type.toUpperCase();
      trackSourceEl.className = `badge-source ${state.currentTrack.type}`;

      if (state.currentTrack.thumbnail) {
        coverImg.src = state.currentTrack.thumbnail;
        coverImg.style.display = 'block';
        coverPlaceholder.style.display = 'none';
      } else {
        coverImg.style.display = 'none';
        coverPlaceholder.style.display = 'block';
        coverPlaceholder.textContent = state.currentTrack.type === 'youtube' ? '🎬' : '🎵';
      }

      const ytContainer = document.getElementById('youtube-player-container');
      if (state.currentTrack.type === 'youtube') {
        if (ytContainer) {
          ytContainer.classList.add('active');
          ytContainer.style.display = 'block';
        }
      } else {
        if (ytContainer) {
          ytContainer.classList.remove('active');
          ytContainer.style.display = 'none';
        }
      }
    } else {
      const ytContainer = document.getElementById('youtube-player-container');
      if (ytContainer) {
        ytContainer.classList.remove('active');
        ytContainer.style.display = 'none';
      }
      trackTitleEl.textContent = 'No track playing';
      trackSubEl.textContent = 'Add a song below';
      trackSourceEl.textContent = 'IDLE';
      trackSourceEl.className = 'badge-source';
      coverImg.style.display = 'none';
      coverPlaceholder.style.display = 'block';
      coverPlaceholder.textContent = '🎵';
      waveBarsContainer.classList.remove('playing');
    }

    renderQueue(state.queue || []);
  }

  function updatePlayPauseButton(isPlaying) {
    if (isPlaying) {
      btnPlayMaster.innerHTML = '⏸';
      waveBarsContainer.classList.add('playing');
    } else {
      btnPlayMaster.innerHTML = '▶';
      waveBarsContainer.classList.remove('playing');
    }
  }

  function renderFriendsList(users, hostId) {
    cachedUsers = users;
    cachedHostId = hostId;
    friendsListEl.innerHTML = '';
    users.forEach(u => {
      const pill = document.createElement('div');
      pill.className = `friend-pill ${u.id === hostId ? 'host' : ''}`;
      
      let kickBtnHtml = '';
      if (isAdmin && u.id !== socket.id) {
        kickBtnHtml = `<button class="btn-mini btn-kick-friend" data-id="${u.id}" data-name="${escapeHtml(u.name)}" style="background:rgba(255,50,50,0.3); color:#ff6b6b; border:1px solid rgba(255,50,50,0.5); padding:2px 7px; border-radius:6px; margin-left:6px; cursor:pointer;" title="Kick Out">🚫 Out</button>`;
      }

      pill.innerHTML = `<span>${u.avatar || '🎧'}</span> <span>${escapeHtml(u.name)}</span> ${u.id === hostId ? '<small>👑 Host</small>' : ''} ${kickBtnHtml}`;
      
      const kickBtn = pill.querySelector('.btn-kick-friend');
      if (kickBtn) {
        kickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetId = e.currentTarget.getAttribute('data-id');
          const targetName = e.currentTarget.getAttribute('data-name');
          if (confirm(`Remove "${targetName}" from the party?`)) {
            socket.emit('admin-kick-user', { targetSocketId: targetId }, (res) => {
              if (res && !res.success) alert(res.message);
            });
          }
        });
      }

      friendsListEl.appendChild(pill);
    });
  }

  function renderQueue(queue) {
    queueListEl.innerHTML = '';
    if (!queue || queue.length === 0) {
      queueListEl.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:12px;">Queue is empty. Add songs from YouTube or MP3!</div>';
      return;
    }

    queue.forEach((track, index) => {
      const item = document.createElement('div');
      item.className = 'queue-item';
      item.innerHTML = `
        <div class="queue-item-info">
          <span>${track.type === 'youtube' ? '🎬' : '🎵'}</span>
          <div class="queue-item-title">${escapeHtml(track.title)}</div>
        </div>
        <div class="queue-item-actions">
          <button class="btn-mini btn-remove-q" data-index="${index}" title="Remove">✕</button>
        </div>
      `;
      queueListEl.appendChild(item);
    });

    queueListEl.querySelectorAll('.btn-remove-q').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-index'));
        socket.emit('remove-queue', { index: idx });
      });
    });
  }

  // 9. Playback Control Handlers (OPTIMISTIC 0ms RESPONSE)
  btnPlayMaster.addEventListener('click', () => {
    triggerUnlock();
    if (!currentRoomState || !currentRoomState.currentTrack) {
      alert('Please add a YouTube song or upload an MP3 track first!');
      return;
    }

    const isPlaying = currentRoomState.status === 'playing';
    const currentPos = player.getCurrentTime();

    // 1. Instant local UI update (0ms delay)
    updatePlayPauseButton(!isPlaying);
    currentRoomState.status = isPlaying ? 'paused' : 'playing';

    // 2. Instant local audio action
    if (isPlaying) {
      player.pause(currentPos);
      socket.emit('pause', { position: currentPos });
    } else {
      player.play(currentPos, false);
      socket.emit('play', { position: currentPos });
    }
  });

  btnNext.addEventListener('click', () => {
    triggerUnlock();
    socket.emit('next-track');
  });

  timeSlider.addEventListener('mousedown', () => { isSeeking = true; });
  timeSlider.addEventListener('touchstart', () => { isSeeking = true; });

  timeSlider.addEventListener('input', () => {
    const duration = player.getDuration();
    if (duration > 0) {
      const targetPos = (timeSlider.value / 100) * duration;
      currentTimeLabel.textContent = formatTime(targetPos);
    }
  });

  timeSlider.addEventListener('change', () => {
    const duration = player.getDuration();
    if (duration > 0) {
      const targetPos = (timeSlider.value / 100) * duration;
      player.seek(targetPos);
      socket.emit('seek', { position: targetPos });
    }
    isSeeking = false;
  });

  volumeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    player.setVolume(val);
  });

  btnMute.addEventListener('click', () => {
    const nextMute = !player.isMuted;
    player.setMute(nextMute);
    btnMute.innerHTML = nextMute ? '🔇' : '🔊';
  });

  // Sound Watchdog Banner
  const soundNoticeEl = document.getElementById('sound-notice');
  if (soundNoticeEl) {
    soundNoticeEl.addEventListener('click', () => {
      triggerUnlock();
      player.unlock();
      soundNoticeEl.style.display = 'none';
    });
  }

  // Check every 1.5s if song is supposed to be playing but local sound is blocked
  setInterval(() => {
    if (!currentRoomState || currentRoomState.status !== 'playing' || !currentRoomState.currentTrack) {
      if (soundNoticeEl) soundNoticeEl.style.display = 'none';
      return;
    }

    let isSilent = false;
    if (player.activeType === 'mp3') {
      if (player.audioElement.paused || player.audioElement.muted) {
        isSilent = true;
      }
    } else if (player.activeType === 'youtube' && player.ytPlayer) {
      try {
        if (typeof player.ytPlayer.isMuted === 'function' && player.ytPlayer.isMuted()) {
          isSilent = true;
        }
      } catch (e) {}
    }

    if (soundNoticeEl) {
      soundNoticeEl.style.display = isSilent ? 'block' : 'none';
    }
  }, 1500);

  // 10. YouTube Extractor & Handler (Zero-Delay Instant Dispatch)
  function extractYouTubeId(url) {
    if (!url) return null;
    const clean = url.trim();
    if (clean.length === 11 && !clean.includes('/') && !clean.includes('?')) {
      return clean;
    }
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
    const match = clean.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }

  function handleYouTubeAction(playNow = true) {
    triggerUnlock();
    const input = ytUrlInput.value.trim();
    if (!input) {
      alert('Please enter a YouTube video URL or ID');
      return;
    }

    const videoId = extractYouTubeId(input);
    if (!videoId) {
      alert('Invalid YouTube URL. Please copy and paste a valid YouTube video link.');
      return;
    }

    ytUrlInput.value = '';

    // Create track object immediately (NO 3-second network wait!)
    const track = {
      id: videoId,
      type: 'youtube',
      title: `YouTube Video (${videoId})`,
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`
    };

    if (playNow) {
      socket.emit('change-track', { track, autoplay: true });
    } else {
      socket.emit('add-queue', track);
    }

    // Fetch prettier title in background without blocking
    fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`)
      .then(res => res.json())
      .then(data => {
        if (data.title && currentRoomState?.currentTrack?.id === videoId) {
          trackTitleEl.textContent = data.title;
        }
      })
      .catch(() => {});
  }

  btnYtPlay.addEventListener('click', () => handleYouTubeAction(true));
  btnYtQueue.addEventListener('click', () => handleYouTubeAction(false));
  ytUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleYouTubeAction(true);
  });

  // 11. MP3 Upload & Server File Listing
  function loadUploadedTracks() {
    fetch('/api/tracks')
      .then(res => res.json())
      .then(data => {
        renderMp3Library(data.tracks || []);
      })
      .catch(err => console.error('Error fetching tracks:', err));
  }

  function renderMp3Library(tracks) {
    cachedMp3Tracks = tracks;
    mp3ListEl.innerHTML = '';
    if (tracks.length === 0) {
      mp3ListEl.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:12px;">No MP3s uploaded yet. Drag & drop or select files above!</div>';
      return;
    }

    tracks.forEach(track => {
      const item = document.createElement('div');
      item.className = 'queue-item';

      let delBtnHtml = '';
      if (isAdmin) {
        delBtnHtml = `<button class="btn-mini btn-del-mp3" data-filename="${track.filename}" data-title="${escapeHtml(track.title)}" style="background:rgba(255,50,50,0.25); color:#ff6b6b; border:1px solid rgba(255,50,50,0.4); padding:3px 8px; border-radius:6px; margin-left:4px; cursor:pointer;" title="Delete File from Server">🗑️ Delete</button>`;
      }

      item.innerHTML = `
        <div class="queue-item-info">
          <span>🎵</span>
          <div class="queue-item-title">${escapeHtml(track.title)}</div>
        </div>
        <div class="queue-item-actions">
          <button class="btn-mini btn-play-mp3" title="Play Now">▶ Play</button>
          <button class="btn-mini btn-q-mp3" title="Add to Queue">+ Queue</button>
          ${delBtnHtml}
        </div>
      `;

      item.querySelector('.btn-play-mp3').addEventListener('click', () => {
        triggerUnlock();
        socket.emit('change-track', { track, autoplay: true });
      });

      item.querySelector('.btn-q-mp3').addEventListener('click', () => {
        triggerUnlock();
        socket.emit('add-queue', track);
      });

      const delBtn = item.querySelector('.btn-del-mp3');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fname = e.currentTarget.getAttribute('data-filename');
          const ftitle = e.currentTarget.getAttribute('data-title');
          if (confirm(`Are you sure you want to delete "${ftitle}" from the server?`)) {
            socket.emit('admin-delete-track', { filename: fname }, (res) => {
              if (res && res.success) {
                loadUploadedTracks();
              } else {
                alert(res?.message || 'Failed to delete track');
              }
            });
          }
        });
      }

      mp3ListEl.appendChild(item);
    });
  }

  function uploadFile(file) {
    if (!file) return;
    triggerUnlock();

    uploadStatusEl.style.display = 'block';
    uploadStatusEl.textContent = `Uploading ${file.name}...`;

    const formData = new FormData();
    formData.append('audio', file);

    fetch('/api/upload', {
      method: 'POST',
      body: formData
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.track) {
          uploadStatusEl.textContent = `✓ Uploaded ${data.track.title}!`;
          setTimeout(() => { uploadStatusEl.style.display = 'none'; }, 3000);
          loadUploadedTracks();
          // Auto add to queue or play if nothing playing
          socket.emit('add-queue', data.track);
        } else {
          uploadStatusEl.textContent = `Upload failed: ${data.error || 'Unknown error'}`;
        }
      })
      .catch(err => {
        uploadStatusEl.textContent = `Upload failed: ${err.message}`;
      });
  }

  // File dropzone events
  mp3Dropzone.addEventListener('click', () => mp3FileInput.click());
  mp3FileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
    }
  });

  mp3Dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    mp3Dropzone.classList.add('dragover');
  });

  mp3Dropzone.addEventListener('dragleave', () => {
    mp3Dropzone.classList.remove('dragover');
  });

  mp3Dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    mp3Dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  // 12. Tabs (YouTube / MP3 / Queue)
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const targetPane = document.getElementById(tab.getAttribute('data-tab'));
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // 13. Emoji Reactions (🔥 ❤️ 🎵 🕺 🎉)
  document.querySelectorAll('.btn-reaction').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.getAttribute('data-emoji');
      socket.emit('send-reaction', { emoji });
    });
  });

  function spawnFloatingEmoji(emoji, senderName, isSelf) {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    
    // Random horizontal position across bottom
    const randomLeft = Math.floor(Math.random() * 70) + 15;
    el.style.left = `${randomLeft}vw`;

    document.body.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 2400);
  }

  // 14. QR Code & Share Modal
  btnShare.addEventListener('click', async () => {
    try {
      const netInfo = await fetch('/api/network-info').then(r => r.json());
      const shareUrl = `${netInfo.primaryUrl}?room=${encodeURIComponent(roomId)}`;
      shareLinkInput.value = shareUrl;

      const qrRes = await fetch(`/api/qrcode?url=${encodeURIComponent(shareUrl)}`).then(r => r.json());
      qrImg.src = qrRes.qrDataUrl;

      qrModal.classList.add('open');
    } catch (e) {
      shareLinkInput.value = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
      qrModal.classList.add('open');
    }
  });

  btnCloseModal.addEventListener('click', () => {
    qrModal.classList.remove('open');
  });

  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) qrModal.classList.remove('open');
  });

  btnCopyLink.addEventListener('click', () => {
    navigator.clipboard.writeText(shareLinkInput.value).then(() => {
      btnCopyLink.textContent = '✓ Copied!';
      setTimeout(() => { btnCopyLink.textContent = '📋 Copy Link'; }, 2000);
    });
  });

  // Utility helpers
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  // 15. Admin Management Panel & Actions
  const btnAdminLogin = document.getElementById('btn-admin-login');
  const adminBadgeIcon = document.getElementById('admin-badge-icon');
  const adminModal = document.getElementById('admin-modal');
  const adminPassInput = document.getElementById('admin-pass-input');
  const adminLoginError = document.getElementById('admin-login-error');
  const btnSubmitAdmin = document.getElementById('btn-submit-admin');
  const btnCancelAdmin = document.getElementById('btn-cancel-admin');

  if (btnAdminLogin) {
    btnAdminLogin.addEventListener('click', () => {
      if (isAdmin) {
        if (confirm('You are logged in as Admin. Do you want to log out?')) {
          isAdmin = false;
          sessionStorage.removeItem('is_sync_admin');
          if (adminBadgeIcon) adminBadgeIcon.textContent = '🔒';
          renderFriendsList(cachedUsers, cachedHostId);
          renderMp3Library(cachedMp3Tracks);
        }
      } else {
        if (adminModal) {
          adminModal.classList.add('open');
          adminPassInput.value = '';
          adminLoginError.style.display = 'none';
          adminPassInput.focus();
        }
      }
    });
  }

  const submitAdminPass = () => {
    const pass = adminPassInput.value.trim();
    if (!pass) return;

    socket.emit('admin-login', { password: pass }, (res) => {
      if (res && res.success) {
        isAdmin = true;
        sessionStorage.setItem('is_sync_admin', 'true');
        if (adminBadgeIcon) adminBadgeIcon.textContent = '👑';
        if (adminModal) adminModal.classList.remove('open');
        renderFriendsList(cachedUsers, cachedHostId);
        renderMp3Library(cachedMp3Tracks);
      } else {
        adminLoginError.textContent = res?.message || 'Incorrect Password!';
        adminLoginError.style.display = 'block';
      }
    });
  };

  if (btnSubmitAdmin) btnSubmitAdmin.addEventListener('click', submitAdminPass);
  if (adminPassInput) {
    adminPassInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitAdminPass();
    });
  }
  if (btnCancelAdmin) {
    btnCancelAdmin.addEventListener('click', () => {
      if (adminModal) adminModal.classList.remove('open');
    });
  }

  // Socket listener for when this client is kicked by admin
  socket.on('kicked-from-party', ({ reason }) => {
    player.stop();
    const kickedOverlay = document.getElementById('kicked-overlay');
    if (kickedOverlay) kickedOverlay.classList.add('open');
    socket.disconnect();
  });

  // Socket listener for library updates (when admin deletes an MP3)
  socket.on('library-updated', () => {
    loadUploadedTracks();
  });

  // Check if session previously had admin access
  if (sessionStorage.getItem('is_sync_admin') === 'true') {
    // Discreetly prompt server for re-auth
    // User can click 🔒 and enter 246890 if disconnected
  }

  // Initial loads
  loadUploadedTracks();
});
