/**
 * AudioEQManager
 * High-performance Web Audio API chain for 8D Spatial Audio and +12dB Bass Boost EQ.
 */
class AudioEQManager {
  constructor(audioElement) {
    this.audioElement = audioElement;
    this.audioCtx = null;
    this.sourceNode = null;
    this.bassFilter = null;
    this.pannerNode = null;
    this.is8DActive = false;
    this.isBassBoostActive = false;
    this.panAngle = 0;
    this.panTimer = null;
  }

  init() {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.audioCtx = new AudioContextClass();

      // Create MediaElementSource from audioElement
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audioElement);

      // 1. Bass Booster: BiquadFilter lowshelf at 100Hz
      this.bassFilter = this.audioCtx.createBiquadFilter();
      this.bassFilter.type = 'lowshelf';
      this.bassFilter.frequency.setValueAtTime(100, this.audioCtx.currentTime);
      this.bassFilter.gain.setValueAtTime(0, this.audioCtx.currentTime);

      // 2. 8D Audio Panner: StereoPannerNode with smooth continuous binaural rotation
      if (typeof this.audioCtx.createStereoPanner === 'function') {
        this.pannerNode = this.audioCtx.createStereoPanner();
        this.pannerNode.pan.setValueAtTime(0, this.audioCtx.currentTime);
      }

      // Chain: source -> bassFilter -> pannerNode -> destination
      if (this.pannerNode) {
        this.sourceNode.connect(this.bassFilter);
        this.bassFilter.connect(this.pannerNode);
        this.pannerNode.connect(this.audioCtx.destination);
      } else {
        this.sourceNode.connect(this.bassFilter);
        this.bassFilter.connect(this.audioCtx.destination);
      }
    } catch (e) {
      console.warn('AudioEQManager init note:', e);
    }
  }

  ensureContext() {
    if (!this.audioCtx) this.init();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  toggleBassBoost() {
    this.ensureContext();
    this.isBassBoostActive = !this.isBassBoostActive;
    if (this.bassFilter && this.audioCtx) {
      const targetGain = this.isBassBoostActive ? 12 : 0; // +12dB low-end punch
      try {
        this.bassFilter.gain.setTargetAtTime(targetGain, this.audioCtx.currentTime, 0.05);
      } catch (e) {
        this.bassFilter.gain.value = targetGain;
      }
    }
    return this.isBassBoostActive;
  }

  toggle8D() {
    this.ensureContext();
    this.is8DActive = !this.is8DActive;
    if (this.is8DActive) {
      this.start8DRotation();
    } else {
      this.stop8DRotation();
    }
    return this.is8DActive;
  }

  start8DRotation() {
    if (this.panTimer) clearInterval(this.panTimer);
    // Smooth 360 degree spatial panning
    this.panTimer = setInterval(() => {
      if (!this.is8DActive || !this.pannerNode || !this.audioCtx) return;
      this.panAngle += 0.04;
      if (this.panAngle > Math.PI * 2) this.panAngle -= Math.PI * 2;
      const panVal = Math.sin(this.panAngle);
      try {
        this.pannerNode.pan.setValueAtTime(panVal, this.audioCtx.currentTime);
      } catch (e) {
        this.pannerNode.pan.value = panVal;
      }
    }, 40);
  }

  stop8DRotation() {
    if (this.panTimer) {
      clearInterval(this.panTimer);
      this.panTimer = null;
    }
    if (this.pannerNode && this.audioCtx) {
      try {
        this.pannerNode.pan.setValueAtTime(0, this.audioCtx.currentTime);
      } catch (e) {
        this.pannerNode.pan.value = 0;
      }
    }
  }
}

/**
 * UnifiedSyncPlayer
 * Intelligent dual-engine (YouTube IFrame API & HTML5 Audio) with zero-stutter drift correction.
 */
class UnifiedSyncPlayer {
  constructor(syncEngine, options = {}) {
    this.syncEngine = syncEngine;
    this.options = options;
    this.activeType = null; // 'youtube' | 'mp3'
    this.currentTrack = null;
    this.roomState = null;
    this.isMuted = false;
    this.volume = 1.0;
    this.isUnlocked = false;
    this.lastSeekTime = 0; // cooldown to prevent seek spam
    this.lastRateChangeTime = 0; // cooldown to prevent rapid speed flapping
    this.currentPlaybackRate = 1.0;

    // Callbacks
    this.onProgress = options.onProgress || null;
    this.onDriftUpdate = options.onDriftUpdate || null;
    this.onTrackEnded = options.onTrackEnded || null;
    this.onUserPlay = options.onUserPlay || null;
    this.onUserPause = options.onUserPause || null;
    this.onUserPrev = options.onUserPrev || null;

    this.hasInitialSynced = false;
    this.scheduledTimer = null;
    this.isKicked = false;
    this.isMaintenanceLocked = false;
    this.isLocalMode = false;

    // Use DOM audio element for superior mobile browser compatibility & background playback
    this.audioElement = document.getElementById('html5-audio') || new Audio();
    this.audioElement.preload = 'auto';
    this.audioElement.playsInline = true;
    this.audioElement.setAttribute('playsinline', '');
    this.audioElement.setAttribute('webkit-playsinline', '');

    // Audio EQ & 8D Spatial Audio Engine
    this.eqManager = new AudioEQManager(this.audioElement);

    // YouTube Player reference
    this.ytPlayer = null;
    this.ytReady = false;
    this.ytContainer = document.getElementById('youtube-player-container');

    this.initAudioListeners();
    this.initYouTubeAPI();
    this.startDriftCorrectionLoop();
  }

  // Mobile Lock Screen & Background Playback Handler (MediaSession API)
  updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata || !track) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: track.title || 'Sync Party Track',
        artist: track.artist || 'SyncTunes',
        album: 'Live Music Room',
        artwork: track.thumbnail ? [
          { src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }
        ] : [
          { src: 'https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg', sizes: '512x512', type: 'image/jpeg' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => {
        if (this.onUserPlay) this.onUserPlay(this.getCurrentTime());
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (this.onUserPause) this.onUserPause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (this.onUserPrev) this.onUserPrev();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (this.onTrackEnded) this.onTrackEnded();
      });
    } catch (e) {}
  }

  toggle8D() {
    return this.eqManager.toggle8D();
  }

  toggleBassBoost() {
    return this.eqManager.toggleBassBoost();
  }

  getEQState() {
    return {
      is8D: this.eqManager.is8DActive,
      isBass: this.eqManager.isBassBoostActive
    };
  }

  // Set Website Maintenance Mode lock (Instantly silences and stops all non-admin players)
  setMaintenanceMode(isMaintenance, isAdmin) {
    this.isMaintenanceLocked = !!isMaintenance && !isAdmin;
    if (this.isMaintenanceLocked) {
      clearTimeout(this.scheduledTimer);
      // Immediately stop and kill any playing sound
      try {
        if (this.audioElement) {
          this.audioElement.pause();
          this.audioElement.currentTime = 0;
          this.audioElement.src = '';
        }
      } catch (e) {}

      if (this.ytReady && this.ytPlayer) {
        try {
          if (typeof this.ytPlayer.pauseVideo === 'function') this.ytPlayer.pauseVideo();
          if (typeof this.ytPlayer.stopVideo === 'function') this.ytPlayer.stopVideo();
          if (typeof this.ytPlayer.mute === 'function') this.ytPlayer.mute();
        } catch (e) {}
      }

      if (this.ytContainer) {
        this.ytContainer.classList.remove('active');
      }

      if (this.eqManager) {
        this.eqManager.stop8DRotation();
      }
    }
  }

  // Mark player permanently silenced/kicked when removed by admin
  markKicked() {
    this.isKicked = true;
    this.roomState = null;
    this.currentTrack = null;
    this.activeType = null;
    clearTimeout(this.scheduledTimer);

    // Silence & unload HTML5 Audio
    try {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement.load();
    } catch (e) {}

    // Silence & stop YouTube
    if (this.ytPlayer) {
      try {
        if (typeof this.ytPlayer.stopVideo === 'function') this.ytPlayer.stopVideo();
        if (typeof this.ytPlayer.pauseVideo === 'function') this.ytPlayer.pauseVideo();
        if (typeof this.ytPlayer.mute === 'function') this.ytPlayer.mute();
        if (typeof this.ytPlayer.cueVideoById === 'function') this.ytPlayer.cueVideoById('');
      } catch (e) {}
    }
    if (this.ytContainer) {
      this.ytContainer.classList.remove('active');
    }
    if (this.eqManager) {
      this.eqManager.stop8DRotation();
    }
  }

  // Mobile Audio Unlock: Unlocks both HTML5 Audio and YouTube Audio
  unlock() {
    if (this.isKicked || this.isMaintenanceLocked) return;
    if (this.isUnlocked) return; // STRICT ONE-SHOT GUARD: Never re-run or interrupt if already unlocked!
    this.isUnlocked = true;
    if (this.eqManager) {
      this.eqManager.ensureContext();
    }

    // Unlock HTML5 Audio using a tiny silent sound wave
    try {
      const silentSound = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      if (!this.audioElement.src || this.audioElement.src === window.location.href) {
        this.audioElement.src = silentSound;
      }
      const p = this.audioElement.play();
      if (p !== undefined) {
        p.then(() => {
          if (this.audioElement.src === silentSound) {
            this.audioElement.pause();
          }
        }).catch(() => {});
      }
    } catch (e) {}

    // Unlock YouTube
    if (this.ytReady && this.ytPlayer) {
      try {
        if (typeof this.ytPlayer.unMute === 'function') {
          this.ytPlayer.unMute();
          this.ytPlayer.setVolume(this.volume * 100);
        }
      } catch (e) {}
    }

    // Only start playing if not already playing - NEVER force seek!
    if (this.roomState && this.roomState.currentTrack && this.roomState.status === 'playing') {
      const isAlreadyPlaying = (this.activeType === 'youtube' && this.ytPlayer && typeof this.ytPlayer.getPlayerState === 'function' && this.ytPlayer.getPlayerState() === 1) ||
                               ((this.activeType === 'mp3' || this.activeType === 'local') && !this.audioElement.paused);
      if (!isAlreadyPlaying) {
        this.syncToState(this.roomState, false);
      }
    }
  }

  // Safe handler for track ended: prevents premature queue skips from network hiccups or buffer resets
  handleTrackEnded() {
    if (this.isKicked || this.isMaintenanceLocked) return;
    const dur = this.getDuration();
    const cur = this.getCurrentTime();
    // Strict Guard: Must have a known duration (> 8s), and current position must be at the very end (within 3.5s)
    if (!dur || isNaN(dur) || dur <= 8 || cur < dur - 3.5) {
      console.warn(`[Player] Ignored premature track-ended event: cur=${cur}, dur=${dur}`);
      return;
    }
    if (this.onTrackEnded) this.onTrackEnded();
  }

  initAudioListeners() {
    this.audioElement.addEventListener('ended', () => {
      this.handleTrackEnded();
    });

    this.audioElement.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
    });
  }

  initYouTubeAPI() {
    if (window.YT && window.YT.Player) {
      this.createYTPlayer();
    } else {
      window.onYouTubeIframeAPIReady = () => {
        this.createYTPlayer();
      };
    }
  }

  createYTPlayer() {
    const el = document.getElementById('yt-player');
    if (!el) return;

    this.ytPlayer = new window.YT.Player('yt-player', {
      height: '100%',
      width: '100%',
      playerVars: {
        autoplay: 1,
        controls: 1, // Keep controls visible so users can easily unmute/tap on mobile
        disablekb: 0,
        fs: 1,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        enablejsapi: 1,
        origin: 'https://music-together-tr1h.onrender.com',
        widget_referrer: 'https://music-together-tr1h.onrender.com'
      },
      events: {
        onReady: (event) => {
          this.ytReady = true;
          try {
            this.ytPlayer.unMute();
            this.ytPlayer.setVolume(this.volume * 100);
          } catch (e) {}
          console.log('[YouTube Player Ready]');
          if (this.roomState && this.roomState.currentTrack?.type === 'youtube') {
            this.syncToState(this.roomState, true);
          }
        },
        onStateChange: (event) => {
          if (this.isMaintenanceLocked) {
            try {
              if (typeof this.ytPlayer.pauseVideo === 'function') this.ytPlayer.pauseVideo();
              if (typeof this.ytPlayer.stopVideo === 'function') this.ytPlayer.stopVideo();
              if (typeof this.ytPlayer.mute === 'function') this.ytPlayer.mute();
            } catch (e) {}
            return;
          }

          if (this.activeType !== 'youtube') {
            if (event.data === window.YT.PlayerState.PLAYING || event.data === window.YT.PlayerState.BUFFERING) {
              try {
                this.ytPlayer.pauseVideo();
                this.ytPlayer.stopVideo();
                this.ytPlayer.mute();
              } catch (e) {}
            }
            return;
          }

          if (event.data === window.YT.PlayerState.PLAYING) {
            if (this.roomState && this.roomState.status === 'paused') {
              // User tapped Play directly on the YouTube video!
              const cur = (typeof this.ytPlayer.getCurrentTime === 'function') ? (this.ytPlayer.getCurrentTime() || 0) : 0;
              if (this.onUserPlay) {
                this.onUserPlay(cur);
              }
            } else if (this.roomState && this.roomState.status === 'playing') {
              const expectedPos = this.syncEngine.getExpectedPosition(this.roomState);
              const cur = (typeof this.ytPlayer.getCurrentTime === 'function') ? (this.ytPlayer.getCurrentTime() || 0) : 0;
              const drift = Math.abs(cur - expectedPos);
              if (drift > 3.5 && (Date.now() - this.lastSeekTime > 3500)) {
                this.ytPlayer.seekTo(expectedPos, true);
                this.lastSeekTime = Date.now();
              }
            }
          } else if (event.data === window.YT.PlayerState.PAUSED) {
            if (this.isMaintenanceLocked) {
              return;
            }
            if (this.roomState && this.roomState.status === 'playing') {
              // Room is actively playing!
              // Prevent accidental mobile touches, background blur, or browser low-power mode from pausing the room!
              if (this.isUnlocked && typeof this.ytPlayer.playVideo === 'function') {
                try { this.ytPlayer.playVideo(); } catch (e) {}
              }
            }
          }

          if (event.data === window.YT.PlayerState.ENDED) {
            this.handleTrackEnded();
          }
        }
      }
    });

    const fixIframeAttrs = () => {
      const iframe = document.querySelector('#youtube-player-container iframe');
      if (iframe) {
        try {
          iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
          iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
        } catch (e) {}
      }
    };
    setTimeout(fixIframeAttrs, 300);
    setTimeout(fixIframeAttrs, 1000);
  }

  // Load a new track
  loadTrack(track, autoplay = true, startPosition = 0, startAtServerTime = null) {
    if (this.isKicked || this.isMaintenanceLocked) return;
    this.currentTrack = track;
    this.activeType = track.type;
    this.isLocalMode = (track.type === 'local' || track.isLocal === true);
    this.hasInitialSynced = false;
    this.lastSeekTime = Date.now();
    clearTimeout(this.scheduledTimer);
    this.updateMediaSession(track);

    if (track.type === 'youtube') {
      this.audioElement.pause();
      this.audioElement.src = '';
      if (this.ytContainer) {
        this.ytContainer.classList.add('active');
      }

      if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.loadVideoById === 'function') {
        try {
          this.ytPlayer.unMute();
          this.ytPlayer.setVolume(this.volume * 100);
          this.ytPlayer.loadVideoById({
            videoId: track.id,
            startSeconds: startPosition || 0
          });
          if (!autoplay) {
            this.ytPlayer.pauseVideo();
          } else {
            const serverNow = this.syncEngine.getServerTime();
            if (startAtServerTime && startAtServerTime > serverNow) {
              this.ytPlayer.pauseVideo();
              const delayMs = startAtServerTime - serverNow;
              this.scheduledTimer = setTimeout(() => {
                if (this.roomState && this.roomState.status === 'playing') {
                  if (this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
                    this.ytPlayer.playVideo();
                  }
                }
              }, delayMs);
            } else {
              this.ytPlayer.playVideo();
            }
          }
        } catch (e) {
          console.error('YouTube load error:', e);
        }
      }
    } else if (track.type === 'mp3' || track.type === 'local') {
      // Sync Guardian: Completely silence and stop any lingering YouTube playback
      if (this.ytReady && this.ytPlayer) {
        try {
          if (typeof this.ytPlayer.stopVideo === 'function') this.ytPlayer.stopVideo();
          if (typeof this.ytPlayer.pauseVideo === 'function') this.ytPlayer.pauseVideo();
          if (typeof this.ytPlayer.mute === 'function') this.ytPlayer.mute();
          if (typeof this.ytPlayer.cueVideoById === 'function') this.ytPlayer.cueVideoById('');
        } catch (e) {}
      }
      if (this.ytContainer) {
        this.ytContainer.classList.remove('active');
      }

      let finalAudioSrc = track.url || '';
      if (finalAudioSrc.startsWith('/')) {
        const baseOrigin = (window.location.protocol === 'file:' || !window.location.host)
          ? 'https://music-together-tr1h.onrender.com'
          : window.location.origin;
        finalAudioSrc = baseOrigin + finalAudioSrc;
      }
      this.audioElement.src = finalAudioSrc;
      this.audioElement.volume = this.volume;
      this.audioElement.muted = false;

      const applyStartTime = () => {
        let expected = startPosition || 0;
        if (this.roomState && this.roomState.status === 'playing') {
          expected = this.syncEngine.getExpectedPosition(this.roomState);
        }
        if (expected >= 0 && Math.abs(this.audioElement.currentTime - expected) > 0.03) {
          try { this.audioElement.currentTime = expected; } catch (e) {}
        }
      };

      if (this.audioElement.readyState >= 1) {
        applyStartTime();
      } else {
        this.audioElement.addEventListener('loadedmetadata', applyStartTime, { once: true });
        this.audioElement.addEventListener('canplay', applyStartTime, { once: true });
      }

      if (autoplay) {
        const serverNow = this.syncEngine.getServerTime();
        if (startAtServerTime && startAtServerTime > serverNow) {
          const delayMs = startAtServerTime - serverNow;
          this.scheduledTimer = setTimeout(() => {
            if (this.roomState && this.roomState.status === 'playing') {
              applyStartTime();
              this.audioElement.play().catch(() => {});
            }
          }, delayMs);
        } else {
          applyStartTime();
          const playPromise = this.audioElement.play();
          if (playPromise !== undefined) {
            playPromise.catch(e => {
              console.warn('Audio play waiting for user touch:', e);
              const sn = document.getElementById('sound-notice');
              if (sn) sn.style.display = 'block';
            });
          }
        }
      }
    }
  }

  schedulePlay(targetPosition, startAtServerTime) {
    if (this.isKicked || this.isMaintenanceLocked) return;
    clearTimeout(this.scheduledTimer);
    const serverNow = this.syncEngine.getServerTime();
    const delayMs = startAtServerTime - serverNow;

    if (delayMs > 30) {
      if (this.activeType === 'mp3' || this.activeType === 'local') {
        try {
          if (this.audioElement.readyState >= 1) {
            this.audioElement.currentTime = targetPosition;
          }
          this.audioElement.pause();
        } catch (e) {}
      } else if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {
        try {
          const cur = (typeof this.ytPlayer.getCurrentTime === 'function') ? (this.ytPlayer.getCurrentTime() || 0) : 0;
          if (Math.abs(cur - targetPosition) > 1.5) {
            this.ytPlayer.seekTo(targetPosition, true);
          }
          this.ytPlayer.pauseVideo();
        } catch (e) {}
      }

      this.scheduledTimer = setTimeout(() => {
        // Sync Guardian: If state changed to paused during delay, do not start!
        if (this.roomState && this.roomState.status !== 'playing') {
          return;
        }
        if (this.isMaintenanceLocked) {
          return;
        }
        if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {
          try {
            this.ytPlayer.unMute();
            if (this.isUnlocked && typeof this.ytPlayer.playVideo === 'function') {
              this.ytPlayer.playVideo();
            }
          } catch (e) {}
        } else if (this.activeType === 'mp3' || this.activeType === 'local') {
          if (this.isUnlocked) {
            const expectedNow = this.syncEngine.getExpectedPosition(this.roomState);
            if (this.audioElement.readyState >= 1 && Math.abs(this.audioElement.currentTime - expectedNow) > 0.5) {
              try { this.audioElement.currentTime = expectedNow; } catch (e) {}
            }
            this.audioElement.play().catch(() => {});
          }
        }
      }, delayMs);
    } else {
      const elapsed = Math.max(0, -delayMs / 1000);
      this.play(targetPosition + elapsed, false);
    }
  }

  // Sync to room state
  syncToState(state, forceSeek = false) {
    if (this.isKicked || this.isMaintenanceLocked) return;
    if (this.isLocalMode) return; // Dedicated Local Device Playback: Preserve user's local track
    this.roomState = state;
    if (!state.currentTrack) {
      this.stop();
      return;
    }

    const isNewTrack = !this.currentTrack || (this.currentTrack.id !== state.currentTrack.id);
    const expectedPos = this.syncEngine.getExpectedPosition(state);

    if (isNewTrack) {
      this.loadTrack(state.currentTrack, state.status === 'playing', expectedPos, state.updatedAt);
      return;
    }

    if (state.status === 'playing') {
      const serverNow = this.syncEngine.getServerTime();
      if (state.updatedAt > serverNow) {
        this.schedulePlay(state.position, state.updatedAt);
      } else {
        this.play(expectedPos, forceSeek);
      }
    } else {
      clearTimeout(this.scheduledTimer);
      this.pause(state.position);
    }
  }

  play(targetPosition = null, forceSeek = false) {
    if (this.isKicked || this.isMaintenanceLocked) return;
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
    }

    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {
      const cur = this.getCurrentTime();
      const isAlreadyPlaying = (typeof this.ytPlayer.getPlayerState === 'function' && this.ytPlayer.getPlayerState() === 1);
      const drift = (targetPosition !== null) ? Math.abs(cur - targetPosition) : 0;
      // If already playing smoothly, NEVER hard-seek for normal drifts (< 3.0s)!
      const shouldSeek = forceSeek || (targetPosition !== null && drift > 3.0) || (!isAlreadyPlaying && drift > 1.0);
      try {
        this.ytPlayer.unMute();
        if (targetPosition !== null && shouldSeek) {
          this.ytPlayer.seekTo(targetPosition, true);
          this.lastSeekTime = Date.now();
        }
        if (this.isUnlocked && !isAlreadyPlaying) {
          this.ytPlayer.playVideo();
        }
      } catch (e) {}
    } else if (this.activeType === 'mp3' || this.activeType === 'local') {
      const cur = this.audioElement.currentTime || 0;
      const isAlreadyPlaying = !this.audioElement.paused && this.audioElement.readyState >= 2;
      const drift = (targetPosition !== null) ? Math.abs(cur - targetPosition) : 0;
      // If already playing in foreground or background, NEVER hard-seek for normal drifts (< 2.5s)!
      const shouldSeek = forceSeek || (targetPosition !== null && drift > 2.5) || (!isAlreadyPlaying && drift > 0.5);
      if (targetPosition !== null && shouldSeek) {
        try { this.audioElement.currentTime = targetPosition; } catch (e) {}
        this.lastSeekTime = Date.now();
      }
      if (this.isUnlocked && !isAlreadyPlaying) {
        this.audioElement.play().catch(e => console.warn('Audio play interrupted:', e));
      }
    }
  }

  pause(targetPosition = null) {
    clearTimeout(this.scheduledTimer);
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = 'paused'; } catch (e) {}
    }
    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {
      try {
        if (typeof this.ytPlayer.pauseVideo === 'function') {
          this.ytPlayer.pauseVideo();
        }
        // CRITICAL FIX: On mobile YouTube, calling seekTo while paused triggers re-buffering
        // which causes YouTube to auto-resume playback on some devices. Only seek if drift > 2.0s!
        if (targetPosition !== null && !isNaN(targetPosition) && typeof this.ytPlayer.getCurrentTime === 'function') {
          const cur = this.ytPlayer.getCurrentTime() || 0;
          if (Math.abs(cur - targetPosition) > 2.0 && typeof this.ytPlayer.seekTo === 'function') {
            this.ytPlayer.seekTo(targetPosition, true);
          }
        }
      } catch (e) {}
    } else if (this.activeType === 'mp3' || this.activeType === 'local') {
      try {
        this.audioElement.pause();
        if (targetPosition !== null && !isNaN(targetPosition) && this.audioElement.readyState >= 1) {
          if (Math.abs(this.audioElement.currentTime - targetPosition) > 0.5) {
            this.audioElement.currentTime = targetPosition;
          }
        }
      } catch (e) {}
    }
  }

  seek(seconds) {
    this.lastSeekTime = Date.now();
    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {
      try {
        this.ytPlayer.seekTo(seconds, true);
        if (this.roomState && this.roomState.status === 'playing') {
          this.ytPlayer.playVideo();
        }
      } catch (e) {}
    } else if (this.activeType === 'mp3' || this.activeType === 'local') {
      try {
        this.audioElement.currentTime = seconds;
        if ((this.roomState && this.roomState.status === 'playing') || this.isLocalMode) {
          this.audioElement.play().catch(() => {});
        }
      } catch (e) {}
    }
  }

  stop() {
    clearTimeout(this.scheduledTimer);
    this.pause(0);
    this.roomState = null;
    this.currentTrack = null;
    this.activeType = null;
    this.isLocalMode = false;
    if (this.ytPlayer) {
      try {
        if (typeof this.ytPlayer.stopVideo === 'function') this.ytPlayer.stopVideo();
        if (typeof this.ytPlayer.pauseVideo === 'function') this.ytPlayer.pauseVideo();
        if (typeof this.ytPlayer.mute === 'function') this.ytPlayer.mute();
        if (typeof this.ytPlayer.cueVideoById === 'function') this.ytPlayer.cueVideoById('');
      } catch (e) {}
    }
    if (this.ytContainer) {
      this.ytContainer.classList.remove('active');
    }
    try {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement.load();
    } catch (e) {}
  }

  getCurrentTime() {
    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getCurrentTime === 'function') {
      return this.ytPlayer.getCurrentTime() || 0;
    } else if (this.activeType === 'mp3' || this.activeType === 'local') {
      return this.audioElement.currentTime || 0;
    }
    return 0;
  }

  getDuration() {
    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getDuration === 'function') {
      return this.ytPlayer.getDuration() || 0;
    } else if (this.activeType === 'mp3' || this.activeType === 'local') {
      return this.audioElement.duration || 0;
    }
    return 0;
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    this.audioElement.volume = this.volume;
    if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.setVolume === 'function') {
      try {
        this.ytPlayer.setVolume(this.volume * 100);
      } catch (e) {}
    }
  }

  setMute(mute) {
    this.isMuted = mute;
    this.audioElement.muted = mute;
    if (this.ytReady && this.ytPlayer) {
      try {
        if (mute) this.ytPlayer.mute();
        else this.ytPlayer.unMute();
      } catch (e) {}
    }
  }

  /**
   * Continuous zero-stutter drift correction loop.
   * Restores smooth speed-up and speed-down gliding (1.25x / 0.75x for YouTube; 1.08x / 0.92x for MP3).
   * Eliminates buffer-stutter by NEVER seeking for normal drifts!
   */
  startDriftCorrectionLoop() {
    setInterval(() => {
      // 0. Hard Silence Guardian: If kicked or maintenance locked, strictly silence and exit!
      if (this.isKicked || this.isMaintenanceLocked) {
        if ((this.activeType === 'mp3' || this.activeType === 'local') && this.audioElement && !this.audioElement.paused) {
          try { this.audioElement.pause(); } catch (e) {}
        }
        if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {
          try {
            if (typeof this.ytPlayer.pauseVideo === 'function') this.ytPlayer.pauseVideo();
            if (typeof this.ytPlayer.mute === 'function') this.ytPlayer.mute();
          } catch (e) {}
        }
        return;
      }

      // Local Device Playback Mode: Independent local playback (bypasses room drift synchronization)
      if (this.isLocalMode || this.activeType === 'local' || (this.currentTrack && this.currentTrack.isLocal)) {
        if (this.onProgress) {
          this.onProgress(this.getCurrentTime(), this.getDuration());
        }
        return;
      }

      // Sync Guardian: If MP3 is playing, ensure YouTube is strictly stopped and muted!
      if (this.activeType === 'mp3' && this.ytReady && this.ytPlayer) {
        try {
          if (typeof this.ytPlayer.getPlayerState === 'function') {
            const ytSt = this.ytPlayer.getPlayerState();
            if (ytSt === 1 || ytSt === 3) { // 1 = PLAYING, 3 = BUFFERING
              this.ytPlayer.pauseVideo();
              this.ytPlayer.stopVideo();
              this.ytPlayer.mute();
            }
          }
        } catch (e) {}
      }

      // Sync Guardian: If room is paused, ensure both players are paused!
      if (!this.roomState || this.roomState.status !== 'playing' || !this.currentTrack) {
        if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {
          try {
            if (typeof this.ytPlayer.getPlayerState === 'function' && this.ytPlayer.getPlayerState() === 1) {
              this.ytPlayer.pauseVideo();
            }
          } catch (e) {}
        } else if (this.activeType === 'mp3') {
          if (!this.audioElement.paused) {
            try { this.audioElement.pause(); } catch (e) {}
          }
        }
        if (this.onProgress) {
          this.onProgress(this.getCurrentTime(), this.getDuration());
        }
        return;
      }

      const serverNow = this.syncEngine.getServerTime();
      if (this.roomState.updatedAt > serverNow) {
        return; // Waiting for synchronized countdown start
      }

      // YouTube buffering check: If buffering (3) or unstarted (-1), do not adjust rate or seek!
      if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getPlayerState === 'function') {
        const ytState = this.ytPlayer.getPlayerState();
        if (ytState === 3 || ytState === -1) {
          return;
        }
      }

      const actualPos = this.getCurrentTime();
      const expectedPos = this.syncEngine.getExpectedPosition(this.roomState);
      const drift = actualPos - expectedPos; // seconds (positive = ahead, negative = behind)
      const driftMs = Math.round(drift * 1000);

      if (this.onDriftUpdate) {
        this.onDriftUpdate(driftMs);
      }

      if (this.onProgress) {
        this.onProgress(actualPos, this.getDuration());
      }

      const absDrift = Math.abs(drift);
      const timeSinceLastSeek = Date.now() - this.lastSeekTime;
      const timeSinceLastRateChange = Date.now() - (this.lastRateChangeTime || 0);

      if (this.activeType === 'youtube') {
        // YouTube Player Intelligent Speed Drift Correction:
        // 1. Massive drift (> 5.5s) -> Snap seek to catch up instantly
        if (absDrift > 5.5 && timeSinceLastSeek > 3500) {
          this.seek(expectedPos);
          this.setPlaybackRate(1.0);
        }
        // 2. High audible drift (> 0.5s) -> Noticeable speed catch-up (1.15x / 0.85x)
        else if (absDrift > 0.5) {
          if (timeSinceLastRateChange > 600 || this.currentPlaybackRate === 1.0) {
            this.setPlaybackRate(drift < 0 ? 1.15 : 0.85);
          }
        }
        // 3. Moderate drift (0.15s - 0.5s) -> Gentle speed catch-up (1.08x / 0.92x)
        else if (absDrift > 0.15) {
          if (timeSinceLastRateChange > 600 || this.currentPlaybackRate === 1.0) {
            this.setPlaybackRate(drift < 0 ? 1.08 : 0.92);
          }
        }
        // 4. Subtle drift (60ms - 150ms) -> Micro speed gliding (1.03x / 0.97x)
        else if (absDrift > 0.06) {
          if (timeSinceLastRateChange > 800 || this.currentPlaybackRate === 1.0) {
            this.setPlaybackRate(drift < 0 ? 1.03 : 0.97);
          }
        }
        // 5. Perfect sync (<= 60ms) -> Return smoothly to normal 1.0x
        else {
          if (this.currentPlaybackRate !== 1.0) {
            this.setPlaybackRate(1.0);
          }
        }
      } else if (this.activeType === 'mp3') {
        // HTML5 Audio (MP3 / Upload File) Precision Drift Correction:
        // 1. Massive drift (> 2.5s) -> Snap seek
        if (absDrift > 2.5 && timeSinceLastSeek > 2500) {
          this.seek(expectedPos);
          this.setPlaybackRate(1.0);
        }
        // 2. Audible drift (> 0.4s) -> Smooth speed catch-up (1.12x / 0.88x)
        else if (absDrift > 0.4) {
          if (timeSinceLastRateChange > 600 || this.currentPlaybackRate === 1.0) {
            this.setPlaybackRate(drift < 0 ? 1.12 : 0.88);
          }
        }
        // 3. Noticeable drift (0.12s - 0.4s) -> Gentle speed gliding (1.05x / 0.95x)
        else if (absDrift > 0.12) {
          if (timeSinceLastRateChange > 600 || this.currentPlaybackRate === 1.0) {
            this.setPlaybackRate(drift < 0 ? 1.05 : 0.95);
          }
        }
        // 4. Tiny drift (40ms - 120ms) -> Micro speed gliding (1.02x / 0.98x)
        else if (absDrift > 0.04) {
          if (timeSinceLastRateChange > 800 || this.currentPlaybackRate === 1.0) {
            this.setPlaybackRate(drift < 0 ? 1.02 : 0.98);
          }
        }
        // 5. Perfect in-sync deadband (<= 40ms) -> Flat 1.0x
        else {
          if (this.currentPlaybackRate !== 1.0) {
            this.setPlaybackRate(1.0);
          }
        }
      }
    }, 250);
  }

  setPlaybackRate(rate) {
    if (this.currentPlaybackRate === rate) return;
    this.currentPlaybackRate = rate;
    this.lastRateChangeTime = Date.now();

    if (this.activeType === 'mp3' || this.activeType === 'local') {
      try {
        this.audioElement.preservesPitch = true;
        this.audioElement.playbackRate = rate;
      } catch (e) {}
    } else if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.setPlaybackRate === 'function') {
      try { this.ytPlayer.setPlaybackRate(rate); } catch (e) {}
    }
  }
}

window.UnifiedSyncPlayer = UnifiedSyncPlayer;
