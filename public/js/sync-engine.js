/**
 * SyncEngine: High-Precision NTP Clock Sync & Drift Compensator
 * Enables millisecond-level audio synchronization across multiple devices.
 */
class SyncEngine {
  constructor(socket) {
    this.socket = socket;
    this.clockOffset = 0;       // serverTime - clientLocalTime (ms)
    this.roundTripTime = 0;     // latency (ms)
    this.offsetHistory = [];    // samples for outlier rejection
    this.rttHistory = [];       // recent RTT samples for smooth display
    this.isSynced = false;
    this.onSyncUpdate = null;

    this.syncTimer = null;

    // Fast-lock on initial connect & auto-reconnects (when mobile wakes up from sleep)
    if (this.socket && typeof this.socket.on === 'function') {
      this.socket.on('connect', () => {
        this.rttHistory = [];
        this.offsetHistory = [];
        this.isSynced = false;
        this.startSyncLoop();
      });
    }

    // Start sync immediately
    this.startSyncLoop();
  }

  startSyncLoop() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    // Initial burst: sample 5 times in quick succession for fast precision lock
    let burstCount = 0;
    const burst = () => {
      this.sampleClock(() => {
        burstCount++;
        if (burstCount < 5) {
          setTimeout(burst, burstCount < 2 ? 150 : 250);
        } else {
          // Staggered sync with randomized jitter (5000ms - 8000ms) to prevent multi-device socket thundering herd
          this.scheduleJitteredSync();
        }
      });
    };
    burst();
  }

  scheduleJitteredSync() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    const delay = 5000 + Math.random() * 3000;
    this.syncTimer = setTimeout(() => {
      this.sampleClock(() => {
        this.scheduleJitteredSync();
      });
    }, delay);
  }

  forceResync(callback) {
    // Multi-sample burst on mobile wakeup to avoid stale single-packet latency spike
    let count = 0;
    const burst = () => {
      this.sampleClock(() => {
        count++;
        if (count < 3) {
          setTimeout(burst, 120);
        } else {
          if (callback) callback();
        }
      });
    };
    burst();
  }

  sampleClock(callback) {
    const t0 = performance.now();
    const clientTimestamp = Date.now();

    this.socket.emit('sync-time', clientTimestamp, (response) => {
      if (!response) return;
      const t3 = performance.now();
      const rtt = Math.max(1, t3 - t0);
      const serverTime = response.serverTime;

      // Cristian's Algorithm
      const estimatedClientAtServerTime = clientTimestamp + (rtt / 2);
      const sampleOffset = serverTime - estimatedClientAtServerTime;

      // Save sample history for precision weighting
      this.offsetHistory.push({ offset: sampleOffset, rtt: rtt });
      if (this.offsetHistory.length > 10) {
        this.offsetHistory.shift();
      }

      this.rttHistory.push(rtt);
      if (this.rttHistory.length > 6) {
        this.rttHistory.shift();
      }

      // Smooth median RTT for stable UI display (filters out transient touch spikes)
      const sortedRtt = [...this.rttHistory].sort((a, b) => a - b);
      const medianRtt = sortedRtt[Math.floor(sortedRtt.length / 2)];
      this.roundTripTime = medianRtt;

      if (!this.isSynced) {
        // Initial lock: use average of lowest 50% RTT samples
        const sortedByRtt = [...this.offsetHistory].sort((a, b) => a.rtt - b.rtt);
        const bestSamples = sortedByRtt.slice(0, Math.max(1, Math.ceil(sortedByRtt.length / 2)));
        this.clockOffset = bestSamples.reduce((sum, s) => sum + s.offset, 0) / bestSamples.length;
        if (this.offsetHistory.length >= 4) {
          this.isSynced = true;
        }
      } else {
        // Steady State: Adapt clockOffset using slow Exponential Moving Average (EMA)
        // If RTT is unusually high (spike / mobile gesture pause), reject it so clockOffset NEVER jumps!
        if (rtt <= medianRtt * 1.5 + 80) {
          this.clockOffset = (this.clockOffset * 0.96) + (sampleOffset * 0.04);
        }
      }

      if (typeof this.onSyncUpdate === 'function') {
        this.onSyncUpdate({
          offset: this.clockOffset,
          rtt: this.roundTripTime
        });
      }

      if (callback) callback();
    });
  }

  // Current synchronized server timestamp (ms)
  getServerTime() {
    return Date.now() + this.clockOffset;
  }

  // Calculate where the track SHOULD be right at this millisecond
  getExpectedPosition(roomState) {
    if (!roomState || !roomState.currentTrack) return 0;
    
    if (roomState.status !== 'playing') {
      return Math.max(0, roomState.position || 0);
    }

    const currentServerTime = this.getServerTime();
    if (roomState.updatedAt > currentServerTime) {
      return Math.max(0, roomState.position || 0);
    }
    const elapsedSeconds = (currentServerTime - roomState.updatedAt) / 1000;
    const rate = roomState.playbackRate || 1.0;
    const expected = (roomState.position || 0) + (elapsedSeconds * rate);

    return Math.max(0, expected);
  }

  // Calculate drift between client player and server expected position
  calculateDrift(actualPosition, roomState) {
    const expected = this.getExpectedPosition(roomState);
    return actualPosition - expected; // positive = ahead, negative = behind
  }
}

window.SyncEngine = SyncEngine;
