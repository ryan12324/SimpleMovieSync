const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const TranscodeService = require('./services/transcodeService');
const SyncService = require('./services/syncService');
const { basicAuth } = require('./middleware/auth');

// Admin authentication middleware
const htpasswdPath = process.env.HTPASSWD_PATH || path.join(__dirname, '../.htpasswd');
const adminAuth = basicAuth(htpasswdPath);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/transcoded', express.static(path.join(__dirname, '../transcoded')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/mkv', 'video/avi', 'video/webm', 'video/quicktime', 'video/x-matroska'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(mp4|mkv|avi|webm|mov)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024 // 10GB limit
  }
});

// Initialize services
const transcodeService = new TranscodeService(path.join(__dirname, '../transcoded'));
const syncService = new SyncService(io);

// Store for rooms and movies
const rooms = new Map();
const movies = new Map();

// API Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/watch/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'watch.html'));
});

// Upload movie (admin only)
app.post('/api/upload', adminAuth, upload.single('movie'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const movieId = uuidv4();
    const movieData = {
      id: movieId,
      originalName: req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      uploadedAt: new Date(),
      transcodeStatus: 'pending',
      qualities: []
    };

    movies.set(movieId, movieData);

    res.json({
      success: true,
      movie: movieData
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Get all movies
app.get('/api/movies', (req, res) => {
  res.json(Array.from(movies.values()));
});

// Get specific movie
app.get('/api/movies/:movieId', (req, res) => {
  const movie = movies.get(req.params.movieId);
  if (!movie) {
    return res.status(404).json({ error: 'Movie not found' });
  }
  res.json(movie);
});

// Start transcoding (admin only)
app.post('/api/movies/:movieId/transcode', adminAuth, async (req, res) => {
  const movie = movies.get(req.params.movieId);
  if (!movie) {
    return res.status(404).json({ error: 'Movie not found' });
  }

  const qualities = req.body.qualities || ['360p', '480p', '720p', '1080p'];

  try {
    movie.transcodeStatus = 'processing';
    movie.qualities = [];

    // Start transcoding in background
    transcodeService.transcodeMovie(movie, qualities, (progress) => {
      movie.transcodeProgress = progress;
      io.to('admin').emit('transcodeProgress', { movieId: movie.id, progress });
    }).then((transcodedQualities) => {
      movie.transcodeStatus = 'completed';
      movie.qualities = transcodedQualities;
      io.to('admin').emit('transcodeComplete', { movieId: movie.id, qualities: transcodedQualities });
    }).catch((error) => {
      movie.transcodeStatus = 'failed';
      movie.transcodeError = error.message;
      io.to('admin').emit('transcodeError', { movieId: movie.id, error: error.message });
    });

    res.json({ success: true, message: 'Transcoding started' });
  } catch (error) {
    console.error('Transcode error:', error);
    res.status(500).json({ error: 'Failed to start transcoding' });
  }
});

// Create room (admin only)
app.post('/api/rooms', adminAuth, (req, res) => {
  const { movieId, name } = req.body;
  const movie = movies.get(movieId);

  if (!movie) {
    return res.status(404).json({ error: 'Movie not found' });
  }

  if (movie.transcodeStatus !== 'completed') {
    return res.status(400).json({ error: 'Movie transcoding not completed' });
  }

  const roomId = uuidv4().substring(0, 8);
  const room = {
    id: roomId,
    name: name || `Room ${roomId}`,
    movieId,
    movie,
    createdAt: new Date(),
    viewers: [],
    playbackState: {
      isPlaying: false,
      currentTime: 0,
      lastUpdate: Date.now()
    },
    chat: [],
    reactions: []
  };

  rooms.set(roomId, room);
  syncService.createRoom(roomId, room);

  res.json({ success: true, room });
});

// Get all rooms
app.get('/api/rooms', (req, res) => {
  res.json(Array.from(rooms.values()).map(room => ({
    ...room,
    viewerCount: room.viewers.length
  })));
});

// Get specific room
app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json(room);
});

// Delete room (admin only)
app.delete('/api/rooms/:roomId', adminAuth, (req, res) => {
  const roomId = req.params.roomId;
  if (!rooms.has(roomId)) {
    return res.status(404).json({ error: 'Room not found' });
  }

  syncService.deleteRoom(roomId);
  rooms.delete(roomId);

  res.json({ success: true });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join admin room for updates
  socket.on('joinAdmin', () => {
    socket.join('admin');
    console.log('Admin joined:', socket.id);
  });

  // Join viewing room
  socket.on('joinRoom', ({ roomId, username }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username || `Viewer ${socket.id.substring(0, 4)}`;

    // Add viewer to room
    const viewer = {
      id: socket.id,
      username: socket.username,
      joinedAt: new Date()
    };
    room.viewers.push(viewer);

    // Send current state to new viewer
    socket.emit('roomState', {
      room: {
        ...room,
        viewerCount: room.viewers.length
      },
      playbackState: room.playbackState,
      chat: room.chat.slice(-50), // Last 50 messages
      viewers: room.viewers
    });

    // Notify others
    socket.to(roomId).emit('viewerJoined', { viewer });
    io.to(roomId).emit('viewerCount', { count: room.viewers.length });

    console.log(`${socket.username} joined room ${roomId}`);
  });

  // Leave room
  socket.on('leaveRoom', () => {
    handleLeaveRoom(socket);
  });

  // Playback sync events (admin controls)
  socket.on('play', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.playbackState.isPlaying = true;
    room.playbackState.currentTime = currentTime;
    room.playbackState.lastUpdate = Date.now();

    socket.to(roomId).emit('syncPlay', {
      currentTime,
      serverTime: Date.now()
    });
  });

  socket.on('pause', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.playbackState.isPlaying = false;
    room.playbackState.currentTime = currentTime;
    room.playbackState.lastUpdate = Date.now();

    socket.to(roomId).emit('syncPause', {
      currentTime,
      serverTime: Date.now()
    });
  });

  socket.on('seek', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.playbackState.currentTime = currentTime;
    room.playbackState.lastUpdate = Date.now();

    socket.to(roomId).emit('syncSeek', {
      currentTime,
      serverTime: Date.now()
    });
  });

  // Request sync (for viewers who fall out of sync)
  socket.on('requestSync', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // Calculate actual current time based on last update
    let currentTime = room.playbackState.currentTime;
    if (room.playbackState.isPlaying) {
      const elapsed = (Date.now() - room.playbackState.lastUpdate) / 1000;
      currentTime += elapsed;
    }

    socket.emit('syncState', {
      isPlaying: room.playbackState.isPlaying,
      currentTime,
      serverTime: Date.now()
    });
  });

  // Chat messages
  socket.on('chatMessage', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const chatMessage = {
      id: uuidv4(),
      username: socket.username,
      message: message.substring(0, 500), // Limit message length
      timestamp: new Date()
    };

    room.chat.push(chatMessage);

    // Keep only last 200 messages
    if (room.chat.length > 200) {
      room.chat = room.chat.slice(-200);
    }

    io.to(roomId).emit('newMessage', chatMessage);
  });

  // Emoji reactions
  socket.on('reaction', ({ roomId, emoji }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const reaction = {
      id: uuidv4(),
      username: socket.username,
      emoji,
      timestamp: Date.now()
    };

    io.to(roomId).emit('newReaction', reaction);
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    handleLeaveRoom(socket);
    console.log('Client disconnected:', socket.id);
  });

  function handleLeaveRoom(socket) {
    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.viewers = room.viewers.filter(v => v.id !== socket.id);
        socket.to(socket.roomId).emit('viewerLeft', { viewerId: socket.id, username: socket.username });
        io.to(socket.roomId).emit('viewerCount', { count: room.viewers.length });
      }
      socket.leave(socket.roomId);
    }
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SimpleMovieSync server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});

module.exports = { app, server, io };
