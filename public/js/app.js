document.addEventListener('DOMContentLoaded', () => {
  // 1. Setup Room & User info
  const urlParams = new URLSearchParams(window.location.search);
  const initialUrlRoom = (urlParams.get('room') || '').trim();
  let currentRoomId = initialUrlRoom || (localStorage.getItem('sync_last_room') || '').trim();
  
  let savedName = localStorage.getItem('sync_username') || '';
  let selectedAvatar = localStorage.getItem('sync_avatar') || '🎧';

  function generate6DigitCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
  let newGeneratedCode = generate6DigitCode();

  // Automatic in-app update check for Web users (Never show inside native app or if dismissed)
  function checkWebAutoUpdate() {
    // 1. If running inside Native Android App, DO NOT show the web banner
    // (Native Kotlin handles its own system update dialog when a real update exists)
    if (navigator.userAgent && navigator.userAgent.includes('SyncTunesNativeApp')) {
      return;
    }

    fetch('/api/app-version')
      .then(r => r.json())
      .then(data => {
        if (data && data.versionCode) {
          // 2. If user already dismissed this version update, do not show again
          const dismissedVersion = localStorage.getItem('dismissed_update_version');
          if (dismissedVersion === String(data.versionCode)) {
            return;
          }

          const banner = document.getElementById('app-update-banner');
          const title = document.getElementById('update-banner-title');
          const desc = document.getElementById('update-banner-desc');
          if (banner) {
            if (title) title.textContent = `🎉 New Update Available (v${data.versionName || 'latest'})!`;
            if (desc && data.releaseNotes) desc.textContent = data.releaseNotes.split('\n')[0] || 'Tap to update app';
            banner.style.display = 'block';
          }
        }
      })
      .catch(() => {});
  }
  setTimeout(checkWebAutoUpdate, 2000);

  window.dismissUpdateBanner = function() {
    const banner = document.getElementById('app-update-banner');
    if (banner) banner.style.display = 'none';
    try {
      localStorage.setItem('dismissed_update_version', '4');
    } catch (e) {}
  };

  // DOM Elements
  const roomNameEl = document.getElementById('room-name');
  const btnCopyRoomCode = document.getElementById('btn-copy-room-code');
  const btnSwitchRoom = document.getElementById('btn-switch-room');
  const userCountEl = document.getElementById('user-count');
  const myProfilePill = document.getElementById('my-profile-pill');
  const friendsListEl = document.getElementById('friends-list');
  const pingMsEl = document.getElementById('ping-ms');
  const driftBadgeEl = document.getElementById('drift-badge');
  const unlockOverlay = document.getElementById('unlock-overlay');

  // Welcome / 6-Digit Room & Guest Modal Elements
  const welcomeModal = document.getElementById('welcome-modal');
  const guestNameInput = document.getElementById('guest-name-input');
  const guestNameError = document.getElementById('guest-name-error');
  const avatarPicker = document.getElementById('avatar-picker');

  // Mandatory Name Validation Helper (Zero random names allowed)
  function validateGuestName() {
    const inputVal = guestNameInput ? guestNameInput.value.trim() : '';
    const finalName = inputVal || savedName;
    if (!finalName) {
      if (guestNameError) {
        guestNameError.textContent = '⚠️ নাম দেওয়া বাধ্যতামূলক! দয়া করে আপনার নাম লিখুন।';
        guestNameError.style.display = 'block';
      }
      if (guestNameInput) {
        guestNameInput.style.borderColor = '#ff4d4d';
        guestNameInput.focus();
        try {
          guestNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {}
      }
      showToast('⚠️ নাম দেওয়া বাধ্যতামূলক! দয়া করে আপনার নাম লিখুন।');
      alert('⚠️ নাম দেওয়া বাধ্যতামূলক!\nদয়া করে প্রথমে আপনার নাম লিখুন (Please enter your name first).');
      return null;
    }
    if (guestNameError) guestNameError.style.display = 'none';
    if (guestNameInput) guestNameInput.style.borderColor = '';
    savedName = finalName;
    try {
      localStorage.setItem('sync_username', savedName);
      localStorage.setItem('sync_avatar', selectedAvatar);
    } catch (e) {}
    return finalName;
  }

  if (guestNameInput) {
    guestNameInput.addEventListener('input', () => {
      if (guestNameInput.value.trim()) {
        if (guestNameError) guestNameError.style.display = 'none';
        guestNameInput.style.borderColor = '';
      }
    });
    guestNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (panelCreateRoom && panelCreateRoom.style.display !== 'none') {
          if (btnCreateRoomSubmit) btnCreateRoomSubmit.click();
        } else if (panelJoinRoom && panelJoinRoom.style.display !== 'none') {
          if (btnJoinRoomSubmit) btnJoinRoomSubmit.click();
        } else {
          if (btnCreateRoomSubmit) btnCreateRoomSubmit.click();
        }
      }
    });
  }
  
  const tabCreateRoom = document.getElementById('tab-create-room');
  const tabJoinRoom = document.getElementById('tab-join-room');
  const panelCreateRoom = document.getElementById('panel-create-room');
  const panelJoinRoom = document.getElementById('panel-join-room');
  const generatedRoomCodeEl = document.getElementById('generated-room-code');
  const btnRefreshCode = document.getElementById('btn-refresh-code');
  const btnCreateRoomSubmit = document.getElementById('btn-create-room-submit');
  const joinRoomCodeInput = document.getElementById('join-room-code-input');
  const btnJoinRoomSubmit = document.getElementById('btn-join-room-submit');

  const welcomeTabGuest = document.getElementById('welcome-tab-guest');
  const welcomeTabAdmin = document.getElementById('welcome-tab-admin');
  const welcomeGuestSection = document.getElementById('welcome-guest-section');
  const welcomeAdminSection = document.getElementById('welcome-admin-section');
  const btnToggleAdminEntry = document.getElementById('btn-toggle-admin-entry');
  const entryAdminBox = document.getElementById('entry-admin-box');
  const entryAdminPass = document.getElementById('entry-admin-pass');
  const entryAdminError = document.getElementById('entry-admin-error');
  const btnSubmitEntryAdmin = document.getElementById('btn-submit-entry-admin');

  const qrModalCodeEl = document.getElementById('qr-modal-code');
  const btnCopyCodeOnly = document.getElementById('btn-copy-code-only');

  const coverImg = document.getElementById('cover-img');
  const coverPlaceholder = document.getElementById('cover-placeholder');
  const trackTitleEl = document.getElementById('track-title');
  const trackSubEl = document.getElementById('track-sub') || document.querySelector('.track-sub');
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

  const btnToggleRoomLock = document.getElementById('btn-toggle-room-lock');
  let currentRoomLocked = false;
  let isKickedFromRoom = false;

  const ytSearchInput = document.getElementById('yt-search-input');
  const btnYtSearch = document.getElementById('btn-yt-search');
  const ytSearchResults = document.getElementById('yt-search-results');
  const ytSearchSpinner = document.getElementById('yt-search-spinner');
  const ytSearchCards = document.getElementById('yt-search-cards');
  const toggleDirectLink = document.getElementById('toggle-direct-link');
  const directLinkSection = document.getElementById('direct-link-section');
  const directLinkArrow = document.getElementById('direct-link-arrow');

  function showToast(msg, duration = 3000) {
    let toast = document.getElementById('sync-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sync-toast';
      toast.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:rgba(18,22,34,0.95); border:1px solid var(--accent-pink); color:#fff; padding:10px 20px; border-radius:30px; font-size:0.85rem; font-weight:600; z-index:999999; box-shadow:0 4px 20px rgba(0,0,0,0.5); pointer-events:none; transition:opacity 0.3s ease; text-align:center; max-width:90%;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.opacity = '0';
    }, duration);
  }

  function updateRoomLockBadge(isLocked) {
    currentRoomLocked = !!isLocked;
    if (!btnToggleRoomLock) return;
    if (currentRoomLocked) {
      btnToggleRoomLock.className = 'room-lock-pill locked';
      btnToggleRoomLock.textContent = '🔒 Locked';
      if (isAdmin) {
        btnToggleRoomLock.title = 'Room is Locked! Tap to Unlock (Admin)';
      } else if (isHost) {
        btnToggleRoomLock.title = hasAdminInRoom ? '👑 Admin is in room (Only Admin can unlock)' : 'Room is Locked! Tap to Unlock (Host)';
      } else {
        btnToggleRoomLock.title = 'Room is Locked';
      }
    } else {
      btnToggleRoomLock.className = 'room-lock-pill unlocked';
      btnToggleRoomLock.textContent = '🔓 Open';
      if (isAdmin) {
        btnToggleRoomLock.title = 'Room is Open. Tap to Lock (Admin)';
      } else if (isHost) {
        btnToggleRoomLock.title = hasAdminInRoom ? '👑 Admin is in room (Only Admin can lock)' : 'Room is Open. Tap to Lock (Host)';
      } else {
        btnToggleRoomLock.title = 'Room is Open';
      }
    }
  }

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

  if (roomNameEl) roomNameEl.textContent = '#' + (currentRoomId || 'party');
  if (qrModalCodeEl) qrModalCodeEl.textContent = currentRoomId || 'party';

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
  let isMaintenanceMode = false;
  let hasAdminInRoom = false;
  let cachedUsers = [];
  let cachedHostId = null;
  let cachedMp3Tracks = [];
  let lastStateVersion = 0;
  let queuePreloader = null;

  function updateMaintenanceUI() {
    const maintenanceOverlay = document.getElementById('maintenance-overlay');
    const adminMaintenanceBar = document.getElementById('admin-maintenance-bar');
    const adminControlStrip = document.getElementById('admin-control-strip');
    const acsStatusText = document.getElementById('acs-maint-status-text');
    const btnAcsToggle = document.getElementById('btn-acs-toggle-maintenance');
    const statusBadge = document.getElementById('admin-maintenance-status-badge');
    const toggleBtn = document.getElementById('btn-toggle-maintenance');
    const adminBadgeIcon = document.getElementById('admin-badge-icon');

    // 0. Update player maintenance lock immediately (instantly silences playback for public visitors)
    if (player && typeof player.setMaintenanceMode === 'function') {
      player.setMaintenanceMode(isMaintenanceMode, isAdmin);
    }

    // 1. Admin Control Strip (STRICTLY ONLY VISIBLE WHEN LOGGED IN AS ADMIN)
    if (adminControlStrip) {
      adminControlStrip.style.display = isAdmin ? 'flex' : 'none';
    }

    if (adminBadgeIcon) {
      adminBadgeIcon.textContent = isAdmin ? '👑' : '🔒';
    }

    if (isMaintenanceMode) {
      if (isAdmin) {
        if (maintenanceOverlay) {
          maintenanceOverlay.classList.remove('active');
          maintenanceOverlay.style.display = 'none';
        }
        if (adminMaintenanceBar) adminMaintenanceBar.style.display = 'block';
      } else {
        if (maintenanceOverlay) {
          maintenanceOverlay.classList.add('active');
          maintenanceOverlay.style.display = 'flex';
        }
        if (adminMaintenanceBar) adminMaintenanceBar.style.display = 'none';
        try {
          if (player && typeof player.pause === 'function') player.pause();
        } catch (e) {}
      }

      // Update Strip UI
      if (acsStatusText) {
        acsStatusText.innerHTML = 'Website: <strong style="color: #ff4d4d;">🔴 Admin Test Mode (Public Blocked)</strong>';
      }
      if (btnAcsToggle) {
        btnAcsToggle.textContent = '🚀 Make Website LIVE for Public';
        btnAcsToggle.className = 'btn-acs-maint is-maintenance';
      }

      // Update Modal UI
      if (statusBadge) {
        statusBadge.textContent = '🔴 ON (Admin Test Mode - Public Blocked)';
        statusBadge.style.color = '#ff4d4d';
      }
      if (toggleBtn) {
        toggleBtn.textContent = '🚀 Publish & Make Website LIVE';
        toggleBtn.classList.remove('is-inactive');
        toggleBtn.classList.add('is-active');
        toggleBtn.style.background = '#10b981';
        toggleBtn.style.color = '#fff';
      }
    } else {
      if (maintenanceOverlay) {
        maintenanceOverlay.classList.remove('active');
        maintenanceOverlay.style.display = 'none';
      }
      if (adminMaintenanceBar) adminMaintenanceBar.style.display = 'none';

      // Update Strip UI
      if (acsStatusText) {
        acsStatusText.innerHTML = 'Website: <strong style="color: #10b981;">🟢 Live (Public Can Use)</strong>';
      }
      if (btnAcsToggle) {
        btnAcsToggle.textContent = '🚧 Lock Site (Admin Test Mode)';
        btnAcsToggle.className = 'btn-acs-maint is-live';
      }

      // Update Modal UI
      if (statusBadge) {
        statusBadge.textContent = '🟢 OFF (Website is Live)';
        statusBadge.style.color = '#10b981';
      }
      if (toggleBtn) {
        toggleBtn.textContent = '🚧 Lock Site (Admin Test Mode)';
        toggleBtn.classList.remove('is-active');
        toggleBtn.classList.add('is-inactive');
        toggleBtn.style.background = 'linear-gradient(135deg, #f72585, #b5179e)';
        toggleBtn.style.color = '#fff';
      }
    }
  }

  function resetPlayerAndUI() {
    try {
      if (player && typeof player.stop === 'function') {
        player.stop();
      }
    } catch (e) {}
    currentRoomState = null;
    const ytContainer = document.getElementById('youtube-player-container');
    if (ytContainer) {
      ytContainer.classList.remove('active');
    }
    if (trackTitleEl) trackTitleEl.textContent = 'No track playing';
    if (trackSubEl) trackSubEl.textContent = 'Add a song below';
    if (trackSourceEl) {
      trackSourceEl.textContent = 'IDLE';
      trackSourceEl.className = 'badge-source';
    }
    if (coverImg) coverImg.style.display = 'none';
    if (coverPlaceholder) {
      coverPlaceholder.style.display = 'block';
      coverPlaceholder.textContent = '🎵';
    }
    if (waveBarsContainer) waveBarsContainer.classList.remove('playing');
    if (typeof updatePlayPauseButton === 'function') updatePlayPauseButton(false);
    if (typeof renderQueue === 'function') renderQueue([]);
  }

  function preloadNextQueueTrack(queue) {
    if (!queue || !Array.isArray(queue) || queue.length === 0) return;
    const nextTrack = queue[0];
    if (nextTrack && nextTrack.type === 'mp3' && nextTrack.url) {
      try {
        if (!queuePreloader) {
          queuePreloader = new Audio();
          queuePreloader.preload = 'auto';
          queuePreloader.volume = 0;
        }
        if (queuePreloader.dataset.src !== nextTrack.url) {
          queuePreloader.dataset.src = nextTrack.url;
          queuePreloader.src = nextTrack.url;
          console.log('[10-Device Optimization] Preloaded next audio track:', nextTrack.title);
        }
      } catch (e) {}
    }
  }

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
      // Auto play next track in queue (only host triggers queue advancement to prevent race condition)
      if (isHost) {
        socket.emit('next-track');
      }
    },
    onUserPrev: () => {
      player.seek(0);
    },
    onUserPlay: (pos) => {
      if (isKickedFromRoom) return;
      triggerUnlock();
      socket.emit('play', { position: pos });
    },
    onUserPause: (pos) => {
      // Intentionally do not broadcast pause from touch/iframe events!
      // Master play/pause button is the authoritative pause control.
    }
  });

  // 4. Mobile Audio Unlock Behavior (Guarded One-Shot)
  let isAudioUnlocked = false;
  const triggerUnlock = () => {
    if (isKickedFromRoom || isAudioUnlocked) return;
    isAudioUnlocked = true;
    player.unlock();
    if (unlockOverlay) unlockOverlay.style.display = 'none';
    const soundNotice = document.getElementById('sound-notice');
    if (soundNotice) soundNotice.style.display = 'none';

    document.removeEventListener('click', triggerUnlock);
    document.removeEventListener('touchstart', triggerUnlock);
  };

  if (unlockOverlay) {
    unlockOverlay.style.display = 'none'; // Replaced by the attractive welcome modal
    unlockOverlay.addEventListener('click', triggerUnlock);
  }

  // Initial user gesture unlocks Web Audio for mobile browsers (runs strictly once)
  document.addEventListener('click', triggerUnlock, { once: true });
  document.addEventListener('touchstart', triggerUnlock, { once: true, passive: true });

  // 4b. Welcome Modal: 6-Digit Room Setup, Guest Creation & Admin Entry
  if (myProfilePill) {
    myProfilePill.textContent = `${selectedAvatar} ${savedName}`;
    myProfilePill.addEventListener('click', () => {
      if (welcomeModal) {
        if (guestNameInput) guestNameInput.value = savedName;
        welcomeModal.style.display = 'flex';
        welcomeModal.classList.add('open');
        if (guestNameInput) guestNameInput.focus();
      }
    });
  }

  if (guestNameInput) {
    guestNameInput.value = savedName;
  }

  if (avatarPicker) {
    const avatarButtons = avatarPicker.querySelectorAll('.avatar-option');
    avatarButtons.forEach(btn => {
      if (btn.getAttribute('data-avatar') === selectedAvatar) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
      btn.addEventListener('click', () => {
        avatarButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedAvatar = btn.getAttribute('data-avatar') || '🎧';
      });
    });
  }

  // Room code generator & refresh
  if (generatedRoomCodeEl) generatedRoomCodeEl.textContent = newGeneratedCode;
  if (btnRefreshCode) {
    btnRefreshCode.addEventListener('click', (e) => {
      e.stopPropagation();
      newGeneratedCode = generate6DigitCode();
      if (generatedRoomCodeEl) generatedRoomCodeEl.textContent = newGeneratedCode;
    });
  }

  // If page was loaded with ?room=849201 in URL
  if (initialUrlRoom && initialUrlRoom.length > 0) {
    if (tabJoinRoom && tabCreateRoom) {
      tabJoinRoom.classList.add('active');
      tabCreateRoom.classList.remove('active');
    }
    if (panelJoinRoom && panelCreateRoom) {
      panelJoinRoom.style.display = 'flex';
      panelCreateRoom.style.display = 'none';
    }
    if (joinRoomCodeInput) {
      joinRoomCodeInput.value = initialUrlRoom;
    }
    if (btnJoinRoomSubmit) {
      btnJoinRoomSubmit.textContent = `🎉 Join Room (${initialUrlRoom})`;
    }
  }

  // Room tab switcher (Create Room vs Join with Code)
  if (tabCreateRoom && tabJoinRoom) {
    tabCreateRoom.addEventListener('click', () => {
      tabCreateRoom.classList.add('active');
      tabJoinRoom.classList.remove('active');
      if (panelCreateRoom) panelCreateRoom.style.display = 'flex';
      if (panelJoinRoom) panelJoinRoom.style.display = 'none';
    });

    tabJoinRoom.addEventListener('click', () => {
      tabJoinRoom.classList.add('active');
      tabCreateRoom.classList.remove('active');
      if (panelCreateRoom) panelCreateRoom.style.display = 'none';
      if (panelJoinRoom) panelJoinRoom.style.display = 'flex';
      if (joinRoomCodeInput) joinRoomCodeInput.focus();
    });
  }

  const joinRoomErrorEl = document.getElementById('join-room-error');

  // Handle "Create & Enter Room"
  if (btnCreateRoomSubmit) {
    btnCreateRoomSubmit.addEventListener('click', () => {
      const validName = validateGuestName();
      if (!validName) return;

      const targetCode = newGeneratedCode || generate6DigitCode();
      btnCreateRoomSubmit.disabled = true;
      const originalText = btnCreateRoomSubmit.textContent;
      btnCreateRoomSubmit.textContent = '⏳ Creating Room...';

      if (!socket.connected) {
        socket.connect();
      }

      resetPlayerAndUI();

      let finished = false;
      const timeoutId = setTimeout(() => {
        if (!finished) {
          finished = true;
          btnCreateRoomSubmit.disabled = false;
          btnCreateRoomSubmit.textContent = originalText;
          showToast('⚠️ Network connection delay. Retrying...');
          if (!socket.connected) socket.connect();
        }
      }, 7000);

      socket.emit('create-room', {
        roomId: targetCode,
        userName: validName,
        avatar: selectedAvatar
      }, (res) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        btnCreateRoomSubmit.disabled = false;
        btnCreateRoomSubmit.textContent = originalText;

        if (res && res.success) {
          currentRoomId = targetCode;
          localStorage.setItem('sync_last_room', currentRoomId);
          try {
            const newUrl = `${window.location.pathname}?room=${encodeURIComponent(currentRoomId)}`;
            window.history.replaceState({ room: currentRoomId }, '', newUrl);
          } catch (e) {}

          if (roomNameEl) roomNameEl.textContent = '#' + currentRoomId;
          if (qrModalCodeEl) qrModalCodeEl.textContent = currentRoomId;
          if (myProfilePill) myProfilePill.textContent = `${selectedAvatar} ${savedName}`;

          if (welcomeModal) {
            welcomeModal.classList.remove('open');
            welcomeModal.style.display = 'none';
          }
          try { triggerUnlock(); } catch (e) {}
          showToast(`🎉 Room #${currentRoomId} Created! Welcome, ${validName}!`);
        } else {
          alert(res?.message || 'Could not create room. Please try again.');
        }
      });
    });
  }

  // Handle "Join Friend's Room" (Strict Verification: Room must exist!)
  const handleJoinByCode = () => {
    const validName = validateGuestName();
    if (!validName) return;

    const inputCode = joinRoomCodeInput ? joinRoomCodeInput.value.trim().toLowerCase() : '';
    if (!inputCode) {
      if (joinRoomErrorEl) {
        joinRoomErrorEl.textContent = '⚠️ Please enter a 6-digit room code!';
        joinRoomErrorEl.style.display = 'block';
      }
      showToast('⚠️ Please enter a 6-digit room code!');
      if (joinRoomCodeInput) joinRoomCodeInput.focus();
      return;
    }

    if (joinRoomErrorEl) joinRoomErrorEl.style.display = 'none';

    if (btnJoinRoomSubmit) {
      btnJoinRoomSubmit.disabled = true;
      btnJoinRoomSubmit.textContent = '⏳ Joining Room...';
    }

    if (!socket.connected) {
      socket.connect();
    }

    resetPlayerAndUI();

    let finished = false;
    const timeoutId = setTimeout(() => {
      if (!finished) {
        finished = true;
        if (btnJoinRoomSubmit) {
          btnJoinRoomSubmit.disabled = false;
          btnJoinRoomSubmit.textContent = '🎉 Join Friend\'s Room';
        }
        showToast('⚠️ Network connection delay. Retrying...');
        if (!socket.connected) socket.connect();
      }
    }, 7000);

    socket.emit('join-room', {
      roomId: inputCode,
      userName: validName,
      avatar: selectedAvatar,
      isAdmin: isAdmin
    }, (res) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      if (btnJoinRoomSubmit) {
        btnJoinRoomSubmit.disabled = false;
        btnJoinRoomSubmit.textContent = '🎉 Join Friend\'s Room';
      }

      if (res && res.success) {
        currentRoomId = inputCode;
        localStorage.setItem('sync_last_room', currentRoomId);
        try {
          const newUrl = `${window.location.pathname}?room=${encodeURIComponent(currentRoomId)}`;
          window.history.replaceState({ room: currentRoomId }, '', newUrl);
        } catch (e) {}

        if (roomNameEl) roomNameEl.textContent = '#' + currentRoomId;
        if (qrModalCodeEl) qrModalCodeEl.textContent = currentRoomId;
        if (myProfilePill) myProfilePill.textContent = `${selectedAvatar} ${savedName}`;

        if (welcomeModal) {
          welcomeModal.classList.remove('open');
          welcomeModal.style.display = 'none';
        }
        try { triggerUnlock(); } catch (e) {}
        showToast(`🎉 Joined Room #${currentRoomId} as ${validName}!`);
      } else {
        if (joinRoomErrorEl) {
          if (res?.isLocked) {
            joinRoomErrorEl.innerHTML = `🔒 <b>Room #${inputCode} is locked!</b><br>If you are Admin, enter password below to bypass lock:`;
            if (entryAdminBox) entryAdminBox.style.display = 'block';
            if (entryAdminPass) entryAdminPass.focus();
          } else {
            joinRoomErrorEl.textContent = res?.message || `Room #${inputCode} does not exist! Please check the 6-digit code or create a room first.`;
          }
          joinRoomErrorEl.style.display = 'block';
        }
      }
    });
  };

  if (btnJoinRoomSubmit) btnJoinRoomSubmit.addEventListener('click', handleJoinByCode);
  if (joinRoomCodeInput) {
    joinRoomCodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleJoinByCode();
    });
  }

  // Copy 6-digit room code from Header
  if (btnCopyRoomCode) {
    btnCopyRoomCode.addEventListener('click', () => {
      const code = currentRoomId || 'party';
      navigator.clipboard.writeText(code).then(() => {
        btnCopyRoomCode.textContent = '✅ Copied!';
        setTimeout(() => { btnCopyRoomCode.textContent = '📋 Copy'; }, 2000);
      });
    });
  }

  // Switch Room from Header
  if (btnSwitchRoom) {
    btnSwitchRoom.addEventListener('click', () => {
      resetPlayerAndUI();
      if (welcomeModal) {
        newGeneratedCode = generate6DigitCode();
        if (generatedRoomCodeEl) generatedRoomCodeEl.textContent = newGeneratedCode;
        if (guestNameInput) guestNameInput.value = savedName;
        if (joinRoomErrorEl) joinRoomErrorEl.style.display = 'none';
        welcomeModal.style.display = 'flex';
        welcomeModal.classList.add('open');
        if (guestNameInput) guestNameInput.focus();
      }
    });
  }

  // Mode Switcher in Welcome Modal: Guest Entry vs Admin Login
  if (welcomeTabGuest && welcomeTabAdmin) {
    welcomeTabGuest.addEventListener('click', () => {
      welcomeTabGuest.classList.add('active');
      welcomeTabAdmin.classList.remove('active');
      if (welcomeGuestSection) welcomeGuestSection.style.display = 'block';
      if (welcomeAdminSection) welcomeAdminSection.style.display = 'none';
    });
    welcomeTabAdmin.addEventListener('click', () => {
      welcomeTabAdmin.classList.add('active');
      welcomeTabGuest.classList.remove('active');
      if (welcomeGuestSection) welcomeGuestSection.style.display = 'none';
      if (welcomeAdminSection) welcomeAdminSection.style.display = 'block';

      const savedPass = localStorage.getItem('sync_admin_pass') || sessionStorage.getItem('sync_admin_pass');
      if (savedPass && entryAdminPass) entryAdminPass.value = savedPass;

      const authCard = document.getElementById('entry-admin-authenticated-view');
      const passView = document.getElementById('entry-admin-pass-view');
      if (isAdmin && authCard && passView) {
        authCard.style.display = 'block';
        passView.style.display = 'none';
      } else if (authCard && passView) {
        authCard.style.display = 'none';
        passView.style.display = 'block';
        if (entryAdminPass) entryAdminPass.focus();
      }
    });
  }

  const btnEnterExistingAdmin = document.getElementById('btn-enter-existing-admin');
  if (btnEnterExistingAdmin) {
    btnEnterExistingAdmin.addEventListener('click', () => {
      const savedPass = localStorage.getItem('sync_admin_pass') || sessionStorage.getItem('sync_admin_pass') || '246890';
      if (entryAdminPass) entryAdminPass.value = savedPass;
      handleAdminEntry();
    });
  }

  // Toggle Admin Entry in Welcome Modal (Shortcut button)
  if (btnToggleAdminEntry) {
    btnToggleAdminEntry.addEventListener('click', () => {
      if (welcomeTabAdmin) {
        welcomeTabAdmin.click();
      } else if (entryAdminBox) {
        const isHidden = entryAdminBox.style.display === 'none' || !entryAdminBox.style.display;
        entryAdminBox.style.display = isHidden ? 'block' : 'none';
        if (isHidden && entryAdminPass) {
          entryAdminPass.focus();
        }
      }
    });
  }

  // Submit Admin Entry from Welcome Modal
  const handleAdminEntry = () => {
    const rawName = guestNameInput ? guestNameInput.value.trim() : '';
    const validName = rawName || 'Admin';

    const pass = entryAdminPass ? entryAdminPass.value.trim() : '';
    if (!pass) {
      if (entryAdminError) {
        entryAdminError.textContent = 'Please enter password!';
        entryAdminError.style.display = 'block';
      }
      return;
    }

    socket.emit('admin-login', { password: pass }, (res) => {
      if (res && res.success) {
        isAdmin = true;
        localStorage.setItem('is_sync_admin', 'true');
        localStorage.setItem('sync_admin_pass', pass);
        sessionStorage.setItem('is_sync_admin', 'true');
        sessionStorage.setItem('sync_admin_pass', pass);
        updateMaintenanceUI();
        const adminBadgeIcon = document.getElementById('admin-badge-icon');
        if (adminBadgeIcon) adminBadgeIcon.textContent = '👑';

        let name = validName;
        if (!name.includes('Admin') && !name.includes('👑')) name = `${name} 👑`;
        savedName = name;
        selectedAvatar = '👑';
        localStorage.setItem('sync_username', savedName);
        localStorage.setItem('sync_avatar', selectedAvatar);

        let targetRoom = (joinRoomCodeInput && joinRoomCodeInput.value.trim()) ? joinRoomCodeInput.value.trim().toLowerCase() : '';
        if (!targetRoom && currentRoomId) targetRoom = currentRoomId.toLowerCase();
        if (!targetRoom) targetRoom = newGeneratedCode;

        resetPlayerAndUI();

        const finishEnter = () => {
          currentRoomId = targetRoom;
          localStorage.setItem('sync_last_room', currentRoomId);
          try {
            const newUrl = `${window.location.pathname}?room=${encodeURIComponent(currentRoomId)}`;
            window.history.replaceState({ room: currentRoomId }, '', newUrl);
          } catch (e) {}

          if (roomNameEl) roomNameEl.textContent = '#' + currentRoomId;
          if (qrModalCodeEl) qrModalCodeEl.textContent = currentRoomId;
          if (myProfilePill) myProfilePill.textContent = `${selectedAvatar} ${savedName}`;

          if (welcomeModal) {
            welcomeModal.classList.remove('open');
            welcomeModal.style.display = 'none';
          }
          triggerUnlock();
          renderFriendsList(cachedUsers, cachedHostId);
          renderMp3Library(cachedMp3Tracks);
          showToast(`Entered Room #${targetRoom} as Admin 👑`);
        };

        // Admin enters room (bypassing any room lock!)
        socket.emit('join-room', {
          roomId: targetRoom,
          userName: savedName,
          avatar: selectedAvatar,
          isAdmin: true
        }, (jRes) => {
          if (jRes && jRes.success) {
            finishEnter();
          } else {
            // Room does not exist yet -> create it
            socket.emit('create-room', {
              roomId: targetRoom,
              userName: savedName,
              avatar: selectedAvatar
            }, (cRes) => {
              finishEnter();
            });
          }
        });
      } else {
        if (entryAdminError) {
          entryAdminError.textContent = res?.message || 'Incorrect Admin Password!';
          entryAdminError.style.display = 'block';
        }
      }
    });
  };

  // Welcome Modal: Forgot Password & Security Question Toggle
  const linkEntryAdminForgot = document.getElementById('link-entry-admin-forgot');
  const entryAdminPassView = document.getElementById('entry-admin-pass-view');
  const entryAdminForgotView = document.getElementById('entry-admin-forgot-view');
  const entryAdminSecAnswer = document.getElementById('entry-admin-sec-answer');
  const entryAdminNewPass = document.getElementById('entry-admin-new-pass');
  const entryAdminForgotError = document.getElementById('entry-admin-forgot-error');
  const btnSubmitEntryForgot = document.getElementById('btn-submit-entry-forgot');
  const btnBackEntryLogin = document.getElementById('btn-back-entry-login');

  if (linkEntryAdminForgot) {
    linkEntryAdminForgot.addEventListener('click', (e) => {
      e.preventDefault();
      if (entryAdminPassView) entryAdminPassView.style.display = 'none';
      if (entryAdminForgotView) entryAdminForgotView.style.display = 'block';
      if (entryAdminSecAnswer) {
        entryAdminSecAnswer.value = '';
        entryAdminSecAnswer.focus();
      }
      if (entryAdminForgotError) entryAdminForgotError.style.display = 'none';
    });
  }

  if (btnBackEntryLogin) {
    btnBackEntryLogin.addEventListener('click', () => {
      if (entryAdminPassView) entryAdminPassView.style.display = 'block';
      if (entryAdminForgotView) entryAdminForgotView.style.display = 'none';
    });
  }

  if (btnSubmitEntryForgot) {
    btnSubmitEntryForgot.addEventListener('click', () => {
      const rawName = guestNameInput ? guestNameInput.value.trim() : '';
      const validName = rawName || 'Admin';

      const answer = entryAdminSecAnswer ? entryAdminSecAnswer.value.trim() : '';
      const newPass = entryAdminNewPass ? entryAdminNewPass.value.trim() : '';
      if (!answer) {
        if (entryAdminForgotError) {
          entryAdminForgotError.textContent = 'Please enter secret phrase!';
          entryAdminForgotError.style.display = 'block';
        }
        return;
      }

      socket.emit('admin-forgot-password', { securityAnswer: answer, newPassword: newPass }, (res) => {
        if (res && res.success) {
          isAdmin = true;
          localStorage.setItem('is_sync_admin', 'true');
          if (newPass) localStorage.setItem('sync_admin_pass', newPass);
          sessionStorage.setItem('is_sync_admin', 'true');
          if (newPass) sessionStorage.setItem('sync_admin_pass', newPass);
          updateMaintenanceUI();
          const adminBadgeIcon = document.getElementById('admin-badge-icon');
          if (adminBadgeIcon) adminBadgeIcon.textContent = '👑';

          let name = validName;
          if (!name.includes('Admin') && !name.includes('👑')) name = `${name} 👑`;
          savedName = name;
          selectedAvatar = '👑';
          localStorage.setItem('sync_username', savedName);
          localStorage.setItem('sync_avatar', selectedAvatar);

          let targetRoom = (joinRoomCodeInput && joinRoomCodeInput.value.trim()) ? joinRoomCodeInput.value.trim().toLowerCase() : '';
          if (!targetRoom && currentRoomId) targetRoom = currentRoomId.toLowerCase();
          if (!targetRoom) targetRoom = newGeneratedCode;

          resetPlayerAndUI();

          const finishEnter = () => {
            currentRoomId = targetRoom;
            try {
              const newUrl = `${window.location.pathname}?room=${encodeURIComponent(currentRoomId)}`;
              window.history.replaceState({ room: currentRoomId }, '', newUrl);
            } catch (e) {}

            if (roomNameEl) roomNameEl.textContent = '#' + currentRoomId;
            if (qrModalCodeEl) qrModalCodeEl.textContent = currentRoomId;
            if (myProfilePill) myProfilePill.textContent = `${selectedAvatar} ${savedName}`;

            if (welcomeModal) {
            welcomeModal.classList.remove('open');
            welcomeModal.style.display = 'none';
          }
            triggerUnlock();
            renderFriendsList(cachedUsers, cachedHostId);
            renderMp3Library(cachedMp3Tracks);
            showToast(`Verified & Entered Room #${targetRoom} as Admin 👑`);
          };

          socket.emit('join-room', {
            roomId: targetRoom,
            userName: savedName,
            avatar: selectedAvatar,
            isAdmin: true
          }, (jRes) => {
            if (jRes && jRes.success) {
              finishEnter();
            } else {
              socket.emit('create-room', {
                roomId: targetRoom,
                userName: savedName,
                avatar: selectedAvatar
              }, (cRes) => {
                finishEnter();
              });
            }
          });
        } else {
          if (entryAdminForgotError) {
            entryAdminForgotError.textContent = res?.message || 'Incorrect Security Answer!';
            entryAdminForgotError.style.display = 'block';
          }
        }
      });
    });
  }

  if (btnSubmitEntryAdmin) btnSubmitEntryAdmin.addEventListener('click', handleAdminEntry);
  if (entryAdminPass) {
    entryAdminPass.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleAdminEntry();
    });
  }

  // Maintenance status broadcast from server
  socket.on('maintenance-status', (data) => {
    const prevMode = isMaintenanceMode;
    isMaintenanceMode = !!data.isMaintenanceMode;
    const hasSavedAdmin = (localStorage.getItem('is_sync_admin') === 'true' && localStorage.getItem('sync_admin_pass'));
    if (data.isAdmin) {
      isAdmin = true;
    } else if (!hasSavedAdmin) {
      isAdmin = false;
    }
    updateMaintenanceUI();

    if (prevMode && !isMaintenanceMode) {
      showToast('🎉 Maintenance Mode OFF! Website is now LIVE for all users.');
    } else if (!prevMode && isMaintenanceMode && isAdmin) {
      showToast('🚧 Maintenance Mode ON! Public users are blocked. Test freely.');
    }
  });

  // Reusable Auto-restore admin session (persists across mobile restarts, socket reconnects and page reloads)
  function tryAutoRestoreAdmin() {
    const savedAdminFlag = localStorage.getItem('is_sync_admin') || sessionStorage.getItem('is_sync_admin');
    const savedAdminPass = localStorage.getItem('sync_admin_pass') || sessionStorage.getItem('sync_admin_pass');
    if (savedAdminFlag === 'true' && savedAdminPass) {
      isAdmin = true; // Optimistically treat as admin so UI never shows maintenance blocker
      if (entryAdminPass) entryAdminPass.value = savedAdminPass;
      if (adminPassInput) adminPassInput.value = savedAdminPass;
      const authCard = document.getElementById('entry-admin-authenticated-view');
      const passView = document.getElementById('entry-admin-pass-view');
      if (authCard && passView) {
        authCard.style.display = 'block';
        passView.style.display = 'none';
      }
      updateMaintenanceUI();
      socket.emit('admin-login', { password: savedAdminPass }, (res) => {
        if (res && res.success) {
          isAdmin = true;
          localStorage.setItem('is_sync_admin', 'true');
          localStorage.setItem('sync_admin_pass', savedAdminPass);
          const adminBadgeIcon = document.getElementById('admin-badge-icon');
          if (adminBadgeIcon) adminBadgeIcon.textContent = '👑';
          updateMaintenanceUI();
          renderFriendsList(cachedUsers, cachedHostId);
          renderMp3Library(cachedMp3Tracks);
        } else if (res && res.message && res.message.toLowerCase().includes('invalid')) {
          localStorage.removeItem('is_sync_admin');
          localStorage.removeItem('sync_admin_pass');
          sessionStorage.removeItem('is_sync_admin');
          sessionStorage.removeItem('sync_admin_pass');
          isAdmin = false;
          if (authCard && passView) {
            authCard.style.display = 'none';
            passView.style.display = 'block';
          }
          updateMaintenanceUI();
        }
      });
    }
  }

  // Restore on initial load and on every socket reconnect
  tryAutoRestoreAdmin();
  socket.on('connect', () => {
    tryAutoRestoreAdmin();
  });

  // 5. Sync Engine Updates (Latency & Clock Offset)
  let hasFirstClockSync = false;
  syncEngine.onSyncUpdate = ({ offset, rtt }) => {
    const displayPing = Math.round(rtt);
    pingMsEl.textContent = `${displayPing}ms`;
    if (pingMsEl.parentElement) {
      if (displayPing < 150) {
        pingMsEl.parentElement.style.color = '#10b981'; // Green
      } else if (displayPing < 350) {
        pingMsEl.parentElement.style.color = '#00f2fe'; // Cyan / Good Cloud Sync
      } else {
        pingMsEl.parentElement.style.color = '#ffd166'; // Yellow
      }
    }
    if (!hasFirstClockSync) {
      hasFirstClockSync = true;
      if (currentRoomState && currentRoomState.status === 'playing') {
        player.syncToState(currentRoomState, false);
      }
    }
  };

  // 6. Join Room (on initial connect and auto-reconnects)
  socket.on('connect', () => {
    if (currentRoomId && savedName) {
      socket.emit('join-room', {
        roomId: currentRoomId,
        userName: savedName,
        avatar: selectedAvatar,
        isAdmin: isAdmin
      }, (res) => {
        if (res && res.success) {
          if (welcomeModal) {
            welcomeModal.classList.remove('open');
            welcomeModal.style.display = 'none';
          }
          if (roomNameEl) roomNameEl.textContent = '#' + currentRoomId;
          if (qrModalCodeEl) qrModalCodeEl.textContent = currentRoomId;
          if (myProfilePill) myProfilePill.textContent = `${selectedAvatar} ${savedName}`;
          try { triggerUnlock(); } catch (e) {}
        } else if (res && !res.success) {
          console.warn('Re-join room warning:', res.message);
          if (welcomeModal) {
            welcomeModal.style.display = 'flex';
            welcomeModal.classList.add('open');
            if (joinRoomErrorEl) {
              joinRoomErrorEl.textContent = res.message;
              joinRoomErrorEl.style.display = 'block';
            }
          }
        }
      });
    }
  });

  socket.on('join-error', ({ message }) => {
    if (welcomeModal) {
      welcomeModal.style.display = 'flex';
      welcomeModal.classList.add('open');
      if (joinRoomErrorEl) {
        joinRoomErrorEl.textContent = message;
        joinRoomErrorEl.style.display = 'block';
      }
    } else {
      alert(message);
    }
  });

  // 7. Socket Event Listeners
  socket.on('room-state', (state) => {
    if (state.version) lastStateVersion = state.version;
    currentRoomState = state;
    cachedHostId = state.hostSocketId;
    isHost = (state.hostSocketId === socket.id);
    hasAdminInRoom = !!state.hasAdmin;
    updateUIFromState(state);
    player.syncToState(state, false);
    preloadNextQueueTrack(state.queue);
    if (state.chatHistory && Array.isArray(state.chatHistory)) {
      renderChatHistory(state.chatHistory);
    }
  });

  socket.on('state-sync', (syncData) => {
    if (!currentRoomState) return;
    // Guard against out-of-order packets on cellular networks across 10 devices
    if (syncData.version && syncData.version < lastStateVersion) {
      console.log(`[Sync] Dropped out-of-order state v${syncData.version} (current v${lastStateVersion})`);
      return;
    }
    if (syncData.version) {
      lastStateVersion = syncData.version;
    }

    currentRoomState.status = syncData.status;
    currentRoomState.position = syncData.position;
    currentRoomState.updatedAt = syncData.updatedAt;
    if (syncData.currentTrack !== undefined) {
      currentRoomState.currentTrack = syncData.currentTrack;
    }

    updatePlayPauseButton(syncData.status === 'playing');
    player.syncToState(currentRoomState, !!syncData.isSeek);
  });

  socket.on('track-changed', (state) => {
    if (state.version) lastStateVersion = state.version;
    currentRoomState = state;
    cachedHostId = state.hostSocketId;
    isHost = (state.hostSocketId === socket.id);
    hasAdminInRoom = !!state.hasAdmin;
    updateUIFromState(state);
    player.syncToState(state, false);
    preloadNextQueueTrack(state.queue);
    if (state.chatHistory && Array.isArray(state.chatHistory)) {
      renderChatHistory(state.chatHistory);
    }
  });

  socket.on('users-updated', ({ users, userCount, hostSocketId, hasAdmin }) => {
    cachedUsers = users || [];
    cachedHostId = hostSocketId;
    if (hasAdmin !== undefined) hasAdminInRoom = !!hasAdmin;
    isHost = (hostSocketId === socket.id);
    userCountEl.textContent = `${userCount} listener${userCount > 1 ? 's' : ''}`;
    renderFriendsList(cachedUsers, cachedHostId);
    updateRoomLockBadge(currentRoomLocked);
  });

  socket.on('host-changed', ({ newHostId, newHostName }) => {
    cachedHostId = newHostId;
    isHost = (newHostId === socket.id);
    if (isHost) {
      showToast('👑 You are now the Room Host!');
    } else {
      showToast(`👑 ${newHostName} is now the Room Host!`);
    }
    renderFriendsList(cachedUsers, cachedHostId);
    updateRoomLockBadge(currentRoomLocked);
  });

  socket.on('queue-updated', ({ queue }) => {
    if (currentRoomState) currentRoomState.queue = queue;
    renderQueue(queue);
    preloadNextQueueTrack(queue);
  });

  socket.on('reaction-received', ({ emoji, senderName, senderId }) => {
    spawnFloatingEmoji(emoji, senderName, senderId === socket.id);
  });

  // 7b. Mobile Tab Wakeup & Sleep Recovery: Instant Resync across 10 devices
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[Wakeup] Phone screen activated - resyncing clock and room state');
      syncEngine.forceResync(() => {
        socket.emit('get-state', (res) => {
          if (res && res.state) {
            if (res.state.version && res.state.version >= lastStateVersion) {
              lastStateVersion = res.state.version;
              currentRoomState = res.state;
              updateUIFromState(res.state);
              player.syncToState(res.state, true);
              preloadNextQueueTrack(res.queue);
            }
          }
        });
      });
    }
  });

  // 8. UI State Updating
  function updateUIFromState(state) {
    updatePlayPauseButton(state.status === 'playing');
    updateRoomLockBadge(state.isLocked);

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
        }
      } else {
        if (ytContainer) {
          ytContainer.classList.remove('active');
        }
      }
    } else {
      const ytContainer = document.getElementById('youtube-player-container');
      if (ytContainer) {
        ytContainer.classList.remove('active');
      }
      if (trackTitleEl) trackTitleEl.textContent = 'No track playing';
      if (trackSubEl) trackSubEl.textContent = 'Add a song below';
      if (trackSourceEl) {
        trackSourceEl.textContent = 'IDLE';
        trackSourceEl.className = 'badge-source';
      }
      if (coverImg) coverImg.style.display = 'none';
      if (coverPlaceholder) {
        coverPlaceholder.style.display = 'block';
        coverPlaceholder.textContent = '🎵';
      }
      if (waveBarsContainer) waveBarsContainer.classList.remove('playing');
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
      
      let adminActionsHtml = '';
      if (isAdmin && u.id !== hostId) {
        adminActionsHtml += `<button class="btn-mini btn-make-host" data-id="${u.id}" data-name="${escapeHtml(u.name)}" style="background:rgba(255,215,0,0.25); color:#ffd700; border:1px solid rgba(255,215,0,0.5); padding:2px 7px; border-radius:6px; margin-left:6px; cursor:pointer;" title="Make Room Host">👑 Set Host</button>`;
      }
      if (isAdmin && u.id !== socket.id) {
        adminActionsHtml += `<button class="btn-mini btn-kick-friend" data-id="${u.id}" data-name="${escapeHtml(u.name)}" style="background:rgba(255,50,50,0.3); color:#ff6b6b; border:1px solid rgba(255,50,50,0.5); padding:2px 7px; border-radius:6px; margin-left:6px; cursor:pointer;" title="Kick Out">🚫 Out</button>`;
      }

      pill.innerHTML = `<span>${u.avatar || '🎧'}</span> <span>${escapeHtml(u.name)}</span> ${u.id === hostId ? '<small>👑 Host</small>' : ''} ${adminActionsHtml}`;
      
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

      const makeHostBtn = pill.querySelector('.btn-make-host');
      if (makeHostBtn) {
        makeHostBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetId = e.currentTarget.getAttribute('data-id');
          const targetName = e.currentTarget.getAttribute('data-name');
          if (confirm(`Make "${targetName}" the Host of this room?`)) {
            socket.emit('admin-set-host', { targetSocketId: targetId }, (res) => {
              if (res && !res.success) {
                showToast(res.message || 'Failed to set host');
              } else {
                showToast(`👑 ${targetName} is now the Room Host!`);
              }
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

  // 9. Playback Control Handlers (OPTIMISTIC 0ms RESPONSE with Debounce Guard)
  let lastControlAction = 0;
  btnPlayMaster.addEventListener('click', () => {
    if (isKickedFromRoom) return;
    triggerUnlock();
    const now = Date.now();
    if (now - lastControlAction < 250) return;
    lastControlAction = now;

    if (!currentRoomState || !currentRoomState.currentTrack) {
      alert('Please search YouTube or select an MP3 track first!');
      return;
    }

    const isPlaying = currentRoomState.status === 'playing';
    const currentPos = player.getCurrentTime();

    // 1. Instant local UI update (0ms delay)
    updatePlayPauseButton(!isPlaying);
    currentRoomState.status = isPlaying ? 'paused' : 'playing';

    // 2. Coordinated Audio Action (Instant 0ms Local Play + Dynamic Speed-Gliding Sync)
    if (isPlaying) {
      player.pause(currentPos);
      socket.emit('pause', { position: currentPos });
    } else {
      player.play(currentPos, false);
      socket.emit('play', { position: currentPos });
    }
  });

  const btnPrev = document.getElementById('btn-prev');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      triggerUnlock();
      const now = Date.now();
      if (now - lastControlAction < 300) return;
      lastControlAction = now;
      player.seek(0);
    });
  }

  btnNext.addEventListener('click', () => {
    triggerUnlock();
    const now = Date.now();
    if (now - lastControlAction < 300) return;
    lastControlAction = now;
    socket.emit('next-track', { clientServerTime: syncEngine.getServerTime() });
  });

  let lastSeekCommitTime = 0;
  const handleSeekCommit = () => {
    if (!timeSlider) return;
    const now = Date.now();
    if (now - lastSeekCommitTime < 300) return; // Prevent duplicate seek calls from touchend + change
    lastSeekCommitTime = now;
    const duration = player.getDuration();
    if (duration > 0) {
      // Guard against seeking past the end (cap at duration - 1.5s to prevent accidental track exit)
      const targetPos = Math.min((parseFloat(timeSlider.value) / 100) * duration, Math.max(0, duration - 1.5));
      player.seek(targetPos);
      const nowServer = syncEngine.getServerTime();
      socket.emit('seek', { position: targetPos, clientServerTime: nowServer });
    }
    isSeeking = false;
  };

  timeSlider.addEventListener('mousedown', () => { isSeeking = true; });
  timeSlider.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });

  timeSlider.addEventListener('input', () => {
    const duration = player.getDuration();
    if (duration > 0) {
      const targetPos = (parseFloat(timeSlider.value) / 100) * duration;
      currentTimeLabel.textContent = formatTime(targetPos);
    }
  });

  timeSlider.addEventListener('change', handleSeekCommit);
  timeSlider.addEventListener('mouseup', handleSeekCommit);
  timeSlider.addEventListener('touchend', handleSeekCommit);

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
    if (isKickedFromRoom) return;
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
      socket.emit('change-track', { track, autoplay: true, clientServerTime: syncEngine.getServerTime() });
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

  // 10b. YouTube Search & Direct Link Toggle
  if (toggleDirectLink && directLinkSection) {
    toggleDirectLink.addEventListener('click', () => {
      const isHidden = directLinkSection.style.display === 'none';
      directLinkSection.style.display = isHidden ? 'block' : 'none';
      if (directLinkArrow) directLinkArrow.textContent = isHidden ? '▲' : '▼';
    });
  }

  const performYouTubeSearch = async () => {
    if (!ytSearchInput) return;
    const q = ytSearchInput.value.trim();
    if (!q) {
      ytSearchInput.focus();
      return;
    }

    if (ytSearchResults) ytSearchResults.style.display = 'block';
    if (ytSearchSpinner) ytSearchSpinner.style.display = 'block';
    if (ytSearchCards) ytSearchCards.innerHTML = '';

    try {
      const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (ytSearchSpinner) ytSearchSpinner.style.display = 'none';

      if (!data.success || !data.results || data.results.length === 0) {
        if (ytSearchCards) {
          ytSearchCards.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:12px;">No videos found. Try a different search!</div>';
        }
        return;
      }

      renderYouTubeSearchResults(data.results);
    } catch (err) {
      console.error('YouTube search error:', err);
      if (ytSearchSpinner) ytSearchSpinner.style.display = 'none';
      if (ytSearchCards) {
        ytSearchCards.innerHTML = '<div style="color:#ff6b6b; font-size:0.8rem; text-align:center; padding:12px;">Search failed. Please check internet connection.</div>';
      }
    }
  };

  if (btnYtSearch) btnYtSearch.addEventListener('click', performYouTubeSearch);
  if (ytSearchInput) {
    ytSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performYouTubeSearch();
    });
  }

  function renderYouTubeSearchResults(results) {
    if (!ytSearchCards) return;
    ytSearchCards.innerHTML = '';

    results.forEach(item => {
      const card = document.createElement('div');
      card.className = 'yt-search-card';

      card.innerHTML = `
        <div class="yt-search-thumb-wrap">
          <img src="${item.thumbnail}" class="yt-search-thumb" alt="${escapeHtml(item.title)}">
          ${item.duration ? `<span class="yt-search-duration">${escapeHtml(item.duration)}</span>` : ''}
        </div>
        <div class="yt-search-meta">
          <div class="yt-search-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="yt-search-sub">${escapeHtml(item.channel || '')} ${item.views ? `• ${escapeHtml(item.views)}` : ''}</div>
        </div>
        <div class="yt-search-actions">
          <button class="btn-yt-card-play" title="Play Now">▶ Play</button>
          <button class="btn-yt-card-queue" title="Add to Queue">+ Queue</button>
        </div>
      `;

      card.querySelector('.btn-yt-card-play').addEventListener('click', () => {
        triggerUnlock();
        const track = {
          id: item.id,
          type: 'youtube',
          title: item.title,
          thumbnail: item.thumbnail,
          url: `https://www.youtube.com/watch?v=${item.id}`
        };
        socket.emit('change-track', { track, autoplay: true, clientServerTime: syncEngine.getServerTime() });
        showToast(`Playing "${item.title.substring(0, 24)}..."`);
      });

      card.querySelector('.btn-yt-card-queue').addEventListener('click', () => {
        triggerUnlock();
        const track = {
          id: item.id,
          type: 'youtube',
          title: item.title,
          thumbnail: item.thumbnail,
          url: `https://www.youtube.com/watch?v=${item.id}`
        };
        socket.emit('add-queue', track);
        showToast(`Added to queue: "${item.title.substring(0, 24)}..."`);
      });

      ytSearchCards.appendChild(card);
    });
  }

  // 10c. Room Lock Toggle Handler
  if (btnToggleRoomLock) {
    btnToggleRoomLock.addEventListener('click', () => {
      if (hasAdminInRoom && !isAdmin) {
        showToast('👑 Admin is present in this room! Only Admin can lock or unlock.');
        return;
      }
      if (!isAdmin && !isHost) {
        showToast('🔒 Only the Admin or Room Host can lock or unlock this room.');
        return;
      }
      socket.emit('toggle-room-lock', (res) => {
        if (res && res.success) {
          updateRoomLockBadge(res.isLocked);
          showToast(res.isLocked ? '🔒 Room Locked! No new guests can join.' : '🔓 Room Unlocked! Guests can join.');
        } else {
          showToast(res?.message || 'Permission denied');
        }
      });
    });
  }

  socket.on('room-lock-changed', ({ isLocked, by }) => {
    updateRoomLockBadge(isLocked);
    showToast(`Room was ${isLocked ? '🔒 LOCKED' : '🔓 UNLOCKED'} by ${by}`);
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
        socket.emit('change-track', { track, autoplay: true, clientServerTime: syncEngine.getServerTime() });
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
    uploadStatusEl.style.color = 'var(--accent-cyan)';
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    uploadStatusEl.textContent = `Uploading: 0% (${sizeMb} MB)...`;

    const formData = new FormData();
    formData.append('audio', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);
    xhr.timeout = 15 * 60 * 1000; // 15 minutes timeout (allows large files up to 250MB!)

    const startTime = Date.now();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        const uploadedMb = (e.loaded / (1024 * 1024)).toFixed(1);
        const totalMb = (e.total / (1024 * 1024)).toFixed(1);
        const elapsedSec = Math.max(0.5, (Date.now() - startTime) / 1000);
        const speedKb = Math.round((e.loaded / 1024) / elapsedSec);
        uploadStatusEl.textContent = `Uploading: ${percent}% (${uploadedMb}/${totalMb} MB • ${speedKb} KB/s)...`;
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.success && data.track) {
            uploadStatusEl.style.color = '#10b981';
            uploadStatusEl.textContent = `✓ Uploaded: ${data.track.title}!`;
            setTimeout(() => { uploadStatusEl.style.display = 'none'; }, 4000);
            loadUploadedTracks();
            socket.emit('add-queue', data.track);
          } else {
            uploadStatusEl.style.color = '#ff4d4d';
            uploadStatusEl.textContent = `Upload failed: ${data.error || 'Server error'}`;
          }
        } catch (e) {
          uploadStatusEl.style.color = '#ff4d4d';
          uploadStatusEl.textContent = `Response error: ${e.message}`;
        }
      } else {
        uploadStatusEl.style.color = '#ff4d4d';
        uploadStatusEl.textContent = `Upload failed with status ${xhr.status}`;
      }
    };

    xhr.onerror = () => {
      uploadStatusEl.style.color = '#ff4d4d';
      uploadStatusEl.textContent = 'Upload network error. Check internet connection.';
    };

    xhr.ontimeout = () => {
      uploadStatusEl.style.color = '#ff4d4d';
      uploadStatusEl.textContent = 'Upload timed out. Try a smaller file or faster network.';
    };

    xhr.send(formData);
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
    const activeRoom = currentRoomId || 'party';
    if (qrModalCodeEl) qrModalCodeEl.textContent = activeRoom;

    try {
      const netInfo = await fetch('/api/network-info').then(r => r.json());
      const shareUrl = `${netInfo.primaryUrl}?room=${encodeURIComponent(activeRoom)}`;
      shareLinkInput.value = shareUrl;

      const qrRes = await fetch(`/api/qrcode?url=${encodeURIComponent(shareUrl)}`).then(r => r.json());
      qrImg.src = qrRes.qrDataUrl;

      qrModal.classList.add('open');
    } catch (e) {
      shareLinkInput.value = `${window.location.origin}?room=${encodeURIComponent(activeRoom)}`;
      qrModal.classList.add('open');
    }
  });

  if (btnCopyCodeOnly) {
    btnCopyCodeOnly.addEventListener('click', () => {
      const code = currentRoomId || 'party';
      navigator.clipboard.writeText(code).then(() => {
        btnCopyCodeOnly.textContent = '✅ Code Copied!';
        setTimeout(() => { btnCopyCodeOnly.textContent = '📋 Copy 6-Digit Code'; }, 2000);
      });
    });
  }

  btnCloseModal.addEventListener('click', () => {
    qrModal.classList.remove('open');
  });

  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) qrModal.classList.remove('open');
  });

  btnCopyLink.addEventListener('click', () => {
    navigator.clipboard.writeText(shareLinkInput.value).then(() => {
      btnCopyLink.textContent = '✅ Link Copied!';
      setTimeout(() => { btnCopyLink.textContent = '🔗 Copy Link'; }, 2000);
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
  const adminModalTitle = document.getElementById('admin-modal-title');
  const adminPassInput = document.getElementById('admin-pass-input');
  const adminLoginError = document.getElementById('admin-login-error');
  const btnSubmitAdmin = document.getElementById('btn-submit-admin');
  const btnCancelAdmin = document.getElementById('btn-cancel-admin');
  const adminPassSection = document.getElementById('admin-pass-section');
  const adminForgotSection = document.getElementById('admin-forgot-section');
  const adminDashboardSection = document.getElementById('admin-dashboard-section');
  const btnCloseAdminPanel = document.getElementById('btn-close-admin-panel');
  const btnAdminLogout = document.getElementById('btn-admin-logout');
  const btnAcsLogout = document.getElementById('btn-acs-logout');
  const btnToggleMaintenance = document.getElementById('btn-toggle-maintenance');
  const btnToggleMaintenanceTop = document.getElementById('btn-toggle-maintenance-top');
  const btnAcsToggleMaintenance = document.getElementById('btn-acs-toggle-maintenance');
  const btnMaintenanceAdmin = document.getElementById('btn-maintenance-admin');

  function openAdminModal() {
    if (!adminModal) return;
    if (isAdmin) {
      if (adminModalTitle) adminModalTitle.textContent = '👑 Admin Control Panel';
      if (adminPassSection) adminPassSection.style.display = 'none';
      if (adminForgotSection) adminForgotSection.style.display = 'none';
      if (adminDashboardSection) adminDashboardSection.style.display = 'block';
    } else {
      if (adminModalTitle) adminModalTitle.textContent = '🔒 Admin Verification';
      if (adminPassSection) adminPassSection.style.display = 'block';
      if (adminForgotSection) adminForgotSection.style.display = 'none';
      if (adminDashboardSection) adminDashboardSection.style.display = 'none';
      if (adminPassInput) {
        const savedPass = localStorage.getItem('sync_admin_pass') || sessionStorage.getItem('sync_admin_pass') || '';
        adminPassInput.value = savedPass;
        setTimeout(() => adminPassInput.focus(), 100);
      }
      if (adminLoginError) adminLoginError.style.display = 'none';
    }
    adminModal.classList.add('open');
  }

  if (btnAdminLogin) {
    btnAdminLogin.addEventListener('click', openAdminModal);
  }

  if (btnMaintenanceAdmin) {
    btnMaintenanceAdmin.addEventListener('click', openAdminModal);
  }

  const toggleMaintenanceHandler = () => {
    const targetMode = !isMaintenanceMode;
    socket.emit('toggle-maintenance', { enabled: targetMode }, (res) => {
      if (res && res.success) {
        isMaintenanceMode = res.isMaintenanceMode;
        updateMaintenanceUI();
        showToast(isMaintenanceMode ? '🚧 Website Maintenance Mode ENABLED! Public is blocked.' : '✅ Website Maintenance Mode DISABLED! Website is LIVE.');
      } else {
        showToast('❌ ' + (res?.message || 'Failed to toggle maintenance mode'));
      }
    });
  };

  if (btnToggleMaintenance) {
    btnToggleMaintenance.addEventListener('click', toggleMaintenanceHandler);
  }

  if (btnToggleMaintenanceTop) {
    btnToggleMaintenanceTop.addEventListener('click', toggleMaintenanceHandler);
  }

  if (btnAcsToggleMaintenance) {
    btnAcsToggleMaintenance.addEventListener('click', toggleMaintenanceHandler);
  }

  const handleAdminLogout = () => {
    if (confirm('Are you sure you want to log out as Admin?')) {
      socket.emit('admin-logout', () => {
        isAdmin = false;
        localStorage.removeItem('is_sync_admin');
        localStorage.removeItem('sync_admin_pass');
        sessionStorage.removeItem('is_sync_admin');
        sessionStorage.removeItem('sync_admin_pass');
        if (adminBadgeIcon) adminBadgeIcon.textContent = '🔒';
        if (adminModal) adminModal.classList.remove('open');
        updateMaintenanceUI();
        renderFriendsList(cachedUsers, cachedHostId);
        renderMp3Library(cachedMp3Tracks);
        showToast('🚪 Logged out as Admin.');
      });
    }
  };

  if (btnAdminLogout) {
    btnAdminLogout.addEventListener('click', handleAdminLogout);
  }

  if (btnAcsLogout) {
    btnAcsLogout.addEventListener('click', handleAdminLogout);
  }

  if (btnCloseAdminPanel) {
    btnCloseAdminPanel.addEventListener('click', () => {
      if (adminModal) adminModal.classList.remove('open');
    });
  }

  const submitAdminPass = () => {
    const pass = adminPassInput.value.trim();
    if (!pass) return;

    socket.emit('admin-login', { password: pass }, (res) => {
      if (res && res.success) {
        isAdmin = true;
        localStorage.setItem('is_sync_admin', 'true');
        localStorage.setItem('sync_admin_pass', pass);
        sessionStorage.setItem('is_sync_admin', 'true');
        sessionStorage.setItem('sync_admin_pass', pass);
        updateMaintenanceUI();
        if (adminBadgeIcon) adminBadgeIcon.textContent = '👑';
        if (adminModal) adminModal.classList.remove('open');
        renderFriendsList(cachedUsers, cachedHostId);
        renderMp3Library(cachedMp3Tracks);
        showToast('👑 Admin Authenticated successfully!');
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

  // 15b. Headphone Audio FX: 8D Audio & Bass Booster
  const btnToggle8D = document.getElementById('btn-toggle-8d');
  const status8D = document.getElementById('status-8d');
  const btnToggleBass = document.getElementById('btn-toggle-bass');
  const statusBass = document.getElementById('status-bass');

  if (btnToggle8D) {
    btnToggle8D.addEventListener('click', () => {
      triggerUnlock();
      const isActive = player.toggle8D();
      btnToggle8D.classList.toggle('active', isActive);
      if (status8D) status8D.textContent = isActive ? 'ON' : 'OFF';
      showToast(isActive ? '🎧 8D Audio ON! Put on headphones for 360° sound.' : '🎧 8D Audio OFF');
    });
  }

  if (btnToggleBass) {
    btnToggleBass.addEventListener('click', () => {
      triggerUnlock();
      const isActive = player.toggleBassBoost();
      btnToggleBass.classList.toggle('active', isActive);
      if (statusBass) statusBass.textContent = isActive ? 'ON' : 'OFF';
      showToast(isActive ? '🔊 Bass Boost (+12dB) ON! Feel the low-end punch.' : '🔊 Bass Boost OFF');
    });
  }

  // 15c. Admin Forgot Password (Security Verification) in Admin Modal
  const linkAdminForgot = document.getElementById('link-admin-forgot');
  const adminSecAnswer = document.getElementById('admin-sec-answer');
  const adminNewPass = document.getElementById('admin-new-pass');
  const adminForgotError = document.getElementById('admin-forgot-error');
  const btnSubmitAdminForgot = document.getElementById('btn-submit-admin-forgot');
  const btnBackAdminLogin = document.getElementById('btn-back-admin-login');

  if (linkAdminForgot) {
    linkAdminForgot.addEventListener('click', (e) => {
      e.preventDefault();
      if (adminPassSection) adminPassSection.style.display = 'none';
      if (adminForgotSection) adminForgotSection.style.display = 'block';
      if (adminSecAnswer) {
        adminSecAnswer.value = '';
        adminSecAnswer.focus();
      }
      if (adminForgotError) adminForgotError.style.display = 'none';
    });
  }

  if (btnBackAdminLogin) {
    btnBackAdminLogin.addEventListener('click', () => {
      if (adminPassSection) adminPassSection.style.display = 'block';
      if (adminForgotSection) adminForgotSection.style.display = 'none';
    });
  }

  if (btnSubmitAdminForgot) {
    btnSubmitAdminForgot.addEventListener('click', () => {
      const answer = adminSecAnswer ? adminSecAnswer.value.trim() : '';
      const newPass = adminNewPass ? adminNewPass.value.trim() : '';
      if (!answer) {
        if (adminForgotError) {
          adminForgotError.textContent = 'Please enter secret phrase!';
          adminForgotError.style.display = 'block';
        }
        return;
      }

      socket.emit('admin-forgot-password', { securityAnswer: answer, newPassword: newPass }, (res) => {
        if (res && res.success) {
          isAdmin = true;
          localStorage.setItem('is_sync_admin', 'true');
          if (newPass) localStorage.setItem('sync_admin_pass', newPass);
          sessionStorage.setItem('is_sync_admin', 'true');
          if (newPass) sessionStorage.setItem('sync_admin_pass', newPass);
          updateMaintenanceUI();
          const adminBadgeIcon = document.getElementById('admin-badge-icon');
          if (adminBadgeIcon) adminBadgeIcon.textContent = '👑';
          if (adminModal) adminModal.classList.remove('open');
          renderFriendsList(cachedUsers, cachedHostId);
          renderMp3Library(cachedMp3Tracks);
          showToast(res.message || '👑 Verified as Admin!');
          if (adminForgotSection) adminForgotSection.style.display = 'none';
          if (adminPassSection) adminPassSection.style.display = 'block';
        } else {
          if (adminForgotError) {
            adminForgotError.textContent = res?.message || 'Incorrect Security Answer!';
            adminForgotError.style.display = 'block';
          }
        }
      });
    });
  }

  // 15d. Live Room Chat
  const chatMessagesEl = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatUnreadBadge = document.getElementById('chat-unread-badge');
  const floatChatUnreadBadge = document.getElementById('float-chat-unread-badge');
  const btnFloatingChat = document.getElementById('btn-floating-chat');
  let unreadChatCount = 0;
  let isChatTabActive = false;

  function renderChatMessage(msg) {
    if (!chatMessagesEl) return;
    const isMe = msg.senderId === socket.id;
    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${isMe ? 'chat-msg-me' : ''}`;

    const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    msgEl.innerHTML = `
      <div class="chat-sender-header">
        <span>${escapeHtml(msg.senderAvatar || '🎧')}</span>
        <span class="chat-sender-name">${escapeHtml(msg.senderName || 'Guest')}</span>
        ${msg.isAdmin ? '<small style="color:#ffd700; font-weight:700;">👑</small>' : ''}
        <span class="chat-time">${timeStr}</span>
      </div>
      <div class="chat-bubble ${msg.isAdmin ? 'admin-bubble' : ''}">
        ${escapeHtml(msg.text)}
      </div>
    `;

    chatMessagesEl.appendChild(msgEl);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function renderChatHistory(history) {
    if (!chatMessagesEl) return;
    chatMessagesEl.innerHTML = `
      <div class="chat-welcome-notice">
        💬 Welcome to Room Live Chat! Message your friends while listening together in sync.
      </div>
    `;
    history.forEach(renderChatMessage);
  }

  function handleSendChatMessage() {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;
    triggerUnlock();

    socket.emit('send-chat-message', { text }, (res) => {
      if (res && !res.success) {
        showToast(res.message || 'Could not send message');
      }
    });

    chatInput.value = '';
    chatInput.focus();
  }

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSendChatMessage();
    });
  }

  // Quick Chat Emojis
  document.querySelectorAll('.btn-chat-emoji').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const emoji = e.currentTarget.getAttribute('data-emoji');
      if (chatInput) {
        chatInput.value += emoji;
        chatInput.focus();
      }
    });
  });

  // Floating Chat Button: Directly opens Live Chat Tab
  if (btnFloatingChat) {
    btnFloatingChat.addEventListener('click', () => {
      const chatTabBtn = document.querySelector('.tab-btn[data-tab="tab-chat"]');
      if (chatTabBtn) {
        chatTabBtn.click();
        chatTabBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      if (chatInput) chatInput.focus();
    });
  }

  // Track chat tab visibility & clear unread badges
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      isChatTabActive = (target === 'tab-chat');
      if (isChatTabActive) {
        unreadChatCount = 0;
        if (chatUnreadBadge) chatUnreadBadge.style.display = 'none';
        if (floatChatUnreadBadge) floatChatUnreadBadge.style.display = 'none';
        if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      }
    });
  });

  // Socket listener for incoming chat messages
  socket.on('new-chat-message', (msg) => {
    renderChatMessage(msg);
    if (!isChatTabActive) {
      unreadChatCount++;
      if (chatUnreadBadge) {
        chatUnreadBadge.textContent = unreadChatCount;
        chatUnreadBadge.style.display = 'inline-block';
      }
      if (floatChatUnreadBadge) {
        floatChatUnreadBadge.textContent = unreadChatCount;
        floatChatUnreadBadge.style.display = 'inline-block';
      }
    }
  });

  // Socket listener for when this client is kicked by admin
  socket.on('kicked-from-party', ({ reason }) => {
    isKickedFromRoom = true;
    player.markKicked();
    resetPlayerAndUI();
    currentRoomState = null;
    currentRoomId = null;

    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch (e) {}

    const kickedOverlay = document.getElementById('kicked-overlay');
    if (kickedOverlay) {
      kickedOverlay.classList.add('open');
      const reasonP = kickedOverlay.querySelector('p');
      if (reasonP && reason) reasonP.textContent = reason;
    }
  });

  const kickedOverlayEl = document.getElementById('kicked-overlay');
  if (kickedOverlayEl) {
    kickedOverlayEl.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    const btnKickedHome = document.getElementById('btn-kicked-home');
    if (btnKickedHome) {
      btnKickedHome.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.href = window.location.origin + window.location.pathname;
      });
    }
  }

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
