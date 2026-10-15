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
    this.isSynced = false;
    this.onSyncUpdate = null;

    // Start sync immediately
    this.startSyncLoop();
  }

  startSyncLoop() {
    // 1. Initial burst: sample 5 times in quick succession
    let burstCount = 0;
    const burst = () => {
      this.sampleClock(() => {
        burstCount++;
        if (burstCount < 5) {
          setTimeout(burst, 300);
        } else {
          // Periodic sync every 4 seconds to maintain drift < 10ms
          setInterval(() => this.sampleClock(), 4000);
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
      const rtt = t3 - t0;
      const serverTime = response.serverTime;

      // Cristian's Algorithm
      // Client time when server generated response estimate:
      const estimatedClientAtServerTime = clientTimestamp + (rtt / 2);
      const sampleOffset = serverTime - estimatedClientAtServerTime;

      // Save sample with weight based on RTT (lower RTT = higher precision)
      this.offsetHistory.push({ offset: sampleOffset, rtt: rtt });
      if (this.offsetHistory.length > 10) {
        this.offsetHistory.shift();
      }

      // Outlier filtering: sort by RTT and take median of the lowest 50%
      const sortedByRtt = [...this.offsetHistory].sort((a, b) => a.rtt - b.rtt);
      const bestSamples = sortedByRtt.slice(0, Math.max(1, Math.ceil(sortedByRtt.length / 2)));
      
      const avgOffset = bestSamples.reduce((sum, s) => sum + s.offset, 0) / bestSamples.length;
      this.clockOffset = avgOffset;
      this.roundTripTime = rtt;
      this.isSynced = true;

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
