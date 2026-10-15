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

    // Callbacks
    this.onProgress = options.onProgress || null;
    this.onDriftUpdate = options.onDriftUpdate || null;
    this.onTrackEnded = options.onTrackEnded || null;

    // Use DOM audio element for superior mobile browser compatibility
    this.audioElement = document.getElementById('html5-audio') || new Audio();
    this.audioElement.preload = 'auto';
    this.audioElement.playsInline = true;
    this.audioElement.crossOrigin = 'anonymous';

    // YouTube Player reference
    this.ytPlayer = null;
    this.ytReady = false;
    this.ytContainer = document.getElementById('youtube-player-container');

    this.initAudioListeners();
    this.initYouTubeAPI();
    this.startDriftCorrectionLoop();
  }

  // Mobile Audio Unlock: Unlocks both HTML5 Audio and YouTube Audio
  unlock() {
    this.isUnlocked = true;

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
        if (this.roomState && this.roomState.status === 'playing') {
          if (typeof this.ytPlayer.playVideo === 'function') {
            this.ytPlayer.playVideo();
          }
        }
      } catch (e) {}
    }

    // Immediately sync to current room track
    if (this.roomState && this.roomState.currentTrack) {
      this.syncToState(this.roomState, true);
    }
  }

  initAudioListeners() {
    this.audioElement.addEventListener('ended', () => {
      if (this.onTrackEnded) this.onTrackEnded();
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
        origin: window.location.origin
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
          if (event.data === window.YT.PlayerState.ENDED) {
            if (this.onTrackEnded) this.onTrackEnded();
          }
        }
      }
    });
  }

  // Load a new track
  loadTrack(track, autoplay = true, startPosition = 0) {
    this.currentTrack = track;
    this.activeType = track.type;
    this.lastSeekTime = Date.now(); // reset cooldown

    if (track.type === 'youtube') {
      // Pause MP3 audio
      this.audioElement.pause();
      this.audioElement.src = '';
      if (this.ytContainer) {
        this.ytContainer.classList.add('active');
        this.ytContainer.style.display = 'block';
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
            this.ytPlayer.playVideo();
          }
        } catch (e) {
          console.error('YouTube load error:', e);
        }
      }
    } else if (track.type === 'mp3') {
      // Stop YouTube
      if (this.ytReady && this.ytPlayer && typeof this.ytPlayer.stopVideo === 'function') {
        try { this.ytPlayer.stopVideo(); } catch (e) {}
      }
      if (this.ytContainer) {
        this.ytContainer.classList.remove('active');
        this.ytContainer.style.display = 'none';
      }

      this.audioElement.src = track.url;
      this.audioElement.currentTime = startPosition || 0;
      this.audioElement.volume = this.volume;
      this.audioElement.muted = false;

      if (autoplay) {
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

  // Sync to room state
  syncToState(state, forceSeek = false) {
    this.roomState = state;
    if (!state.currentTrack) {
      this.stop();
      return;
    }

    const isNewTrack = !this.currentTrack || (this.currentTrack.id !== state.currentTrack.id);
    const expectedPos = this.syncEngine.getExpectedPosition(state);

    if (isNewTrack) {
      this.loadTrack(state.currentTrack, state.status === 'playing', expectedPos);
      return;
    }

    if (state.status === 'playing') {
      this.play(expectedPos, forceSeek);
    } else {
      this.pause(state.position);
    }
  }

  play(targetPosition = null, forceSeek = false) {
    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {
      try {
        this.ytPlayer.unMute();
        if (targetPosition !== null && forceSeek) {
          this.ytPlayer.seekTo(targetPosition, true);
          this.lastSeekTime = Date.now();
        }
        if (this.isUnlocked) {
          this.ytPlayer.playVideo();
        }
      } catch (e) {}
    } else if (this.activeType === 'mp3') {
      if (targetPosition !== null && forceSeek) {
        this.audioElement.currentTime = targetPosition;
        this.lastSeekTime = Date.now();
      }
      if (this.isUnlocked) {
        this.audioElement.play().catch(e => console.warn('MP3 play interrupted:', e));
      }
    }
  }

  pause(targetPosition = null) {
    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {
      try {
        this.ytPlayer.pauseVideo();
        if (targetPosition !== null) {
          this.ytPlayer.seekTo(targetPosition, true);
        }
      } catch (e) {}
    } else if (this.activeType === 'mp3') {
      this.audioElement.pause();
      if (targetPosition !== null) {
        this.audioElement.currentTime = targetPosition;
      }
    }
  }

  seek(seconds) {
    this.lastSeekTime = Date.now();
    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer) {
      try {
        this.ytPlayer.seekTo(seconds, true);
      } catch (e) {}
    } else if (this.activeType === 'mp3') {
      this.audioElement.currentTime = seconds;
    }
  }

  stop() {
    this.pause(0);
    this.currentTrack = null;
    this.activeType = null;
    if (this.ytContainer) {
      this.ytContainer.classList.remove('active');
      this.ytContainer.style.display = 'none';
    }
  }

  getCurrentTime() {
    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getCurrentTime === 'function') {
      return this.ytPlayer.getCurrentTime() || 0;
    } else if (this.activeType === 'mp3') {
      return this.audioElement.currentTime || 0;
    }
    return 0;
  }

  getDuration() {
    if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getDuration === 'function') {
      return this.ytPlayer.getDuration() || 0;
    } else if (this.activeType === 'mp3') {
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
   * FIX: Never trigger aggressive seek loops while YouTube is buffering!
   * Uses smooth micro playback speed adjustments (1.04x / 0.96x) so sound never cuts out!
   */
  startDriftCorrectionLoop() {
    setInterval(() => {
      if (!this.roomState || this.roomState.status !== 'playing' || !this.currentTrack) {
        if (this.onProgress) {
          this.onProgress(this.getCurrentTime(), this.getDuration());
        }
        return;
      }

      // Check YouTube buffering state: If buffering (3) or unstarted (-1), DO NOT SEEK!
      if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.getPlayerState === 'function') {
        const ytState = this.ytPlayer.getPlayerState();
        if (ytState === 3 || ytState === -1) {
          // Buffering or loading: let it buffer naturally, don't interrupt!
          return;
        }
      }

      const actualPos = this.getCurrentTime();
      const expectedPos = this.syncEngine.getExpectedPosition(this.roomState);
      const drift = actualPos - expectedPos; // seconds
      const driftMs = Math.round(drift * 1000);

      if (this.onDriftUpdate) {
        this.onDriftUpdate(driftMs);
      }

      if (this.onProgress) {
        this.onProgress(actualPos, this.getDuration());
      }

      const absDrift = Math.abs(drift);
      const timeSinceLastSeek = Date.now() - this.lastSeekTime;

      // Only hard-seek if drift is HUGE (> 1.8 seconds) AND cooldown has passed (at least 3.5s)
      if (absDrift > 1.8 && timeSinceLastSeek > 3500) {
        this.seek(expectedPos);
        this.setPlaybackRate(1.0);
      } 
      // Moderate drift (60ms to 1800ms) -> Micro rate adjustment (NO SOUND CUT!)
      else if (absDrift > 0.06) {
        if (drift < 0) {
          // Behind server -> slightly accelerate (1.04x) to silently catch up
          this.setPlaybackRate(1.04);
        } else {
          // Ahead of server -> slightly decelerate (0.96x)
          this.setPlaybackRate(0.96);
        }
      } 
      // Tight sync (< 60ms) -> Standard 1.0x speed
      else {
        this.setPlaybackRate(1.0);
      }
    }, 400);
  }

  setPlaybackRate(rate) {
    if (this.activeType === 'mp3') {
      try { this.audioElement.playbackRate = rate; } catch (e) {}
    } else if (this.activeType === 'youtube' && this.ytReady && this.ytPlayer && typeof this.ytPlayer.setPlaybackRate === 'function') {
      try { this.ytPlayer.setPlaybackRate(rate); } catch (e) {}
    }
  }
}

window.UnifiedSyncPlayer = UnifiedSyncPlayer;
