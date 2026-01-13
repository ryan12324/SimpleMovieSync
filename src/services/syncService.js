class SyncService {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.syncInterval = null;

    // Start periodic sync broadcasts
    this.startSyncBroadcasts();
  }

  createRoom(roomId, roomData) {
    this.rooms.set(roomId, {
      id: roomId,
      playbackState: roomData.playbackState || {
        isPlaying: false,
        currentTime: 0,
        lastUpdate: Date.now()
      },
      syncTolerance: 2, // seconds of allowed drift
      lastSyncBroadcast: Date.now()
    });
  }

  deleteRoom(roomId) {
    this.rooms.delete(roomId);
  }

  updatePlaybackState(roomId, state) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.playbackState = {
      ...room.playbackState,
      ...state,
      lastUpdate: Date.now()
    };
  }

  getCurrentTime(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return 0;

    let currentTime = room.playbackState.currentTime;

    if (room.playbackState.isPlaying) {
      const elapsed = (Date.now() - room.playbackState.lastUpdate) / 1000;
      currentTime += elapsed;
    }

    return currentTime;
  }

  getPlaybackState(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      isPlaying: room.playbackState.isPlaying,
      currentTime: this.getCurrentTime(roomId),
      serverTime: Date.now()
    };
  }

  startSyncBroadcasts() {
    // Broadcast sync state every 5 seconds to keep viewers in sync
    this.syncInterval = setInterval(() => {
      this.rooms.forEach((room, roomId) => {
        if (room.playbackState.isPlaying) {
          const state = this.getPlaybackState(roomId);
          this.io.to(roomId).emit('syncHeartbeat', state);
        }
      });
    }, 5000);
  }

  stopSyncBroadcasts() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // Calculate time adjustment for network latency
  calculateTimeAdjustment(clientTime, serverTime, networkLatency) {
    const halfLatency = networkLatency / 2;
    return serverTime - clientTime + halfLatency;
  }
}

module.exports = SyncService;
