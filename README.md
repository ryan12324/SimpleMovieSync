# SimpleMovieSync

A synchronized movie streaming application that allows multiple people to watch movies together in real-time with chat and emoji reactions.

## Features

- **Multi-Quality Streaming**: Automatically transcode movies into multiple qualities (360p, 480p, 720p, 1080p)
- **Perfect Sync**: Real-time synchronization of playback across all viewers (play, pause, seek)
- **Live Chat**: Chat with other viewers while watching
- **Emoji Reactions**: Express yourself with floating emoji reactions
- **Admin Panel**: Upload movies, manage transcoding, and create rooms
- **HTPasswd Authentication**: Secure admin panel with standard htpasswd authentication
- **Cloudflare Tunnel**: Built-in support for remote access via Cloudflare Tunnel

## Quick Start

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/yourusername/SimpleMovieSync.git
cd SimpleMovieSync
```

2. Create admin credentials:
```bash
mkdir -p config
# Using htpasswd (if available)
htpasswd -c config/.htpasswd admin
# Or use the built-in script after npm install
npm install
node scripts/add-user.js add admin yourpassword
mv .htpasswd config/
```

3. Run with Docker Compose:
```bash
docker-compose up -d
```

4. Access the application at `http://localhost:3000`

### Manual Installation

1. Prerequisites:
   - Node.js 18+
   - FFmpeg installed and available in PATH

2. Install dependencies:
```bash
npm install
```

3. Create admin user:
```bash
node scripts/add-user.js add admin yourpassword
```

4. Start the server:
```bash
npm start
```

## Cloudflare Tunnel Setup

The Docker image includes Cloudflare Tunnel (cloudflared) for easy remote access.

### Option 1: Quick Tunnel (Temporary URL)

For testing or temporary access, use a quick tunnel that generates a random URL:

```bash
CLOUDFLARE_QUICK_TUNNEL=true docker-compose up -d
```

Check the logs for your tunnel URL:
```bash
docker logs simplemoviesync 2>&1 | grep "trycloudflare.com"
```

### Option 2: Named Tunnel (Persistent URL)

For a permanent custom domain:

1. **Create a Cloudflare account** at https://dash.cloudflare.com

2. **Add your domain** to Cloudflare (or use a free subdomain)

3. **Create a tunnel** in the Cloudflare Zero Trust dashboard:
   - Go to https://one.dash.cloudflare.com
   - Navigate to **Access** > **Tunnels**
   - Click **Create a tunnel**
   - Name your tunnel (e.g., "simplemoviesync")
   - Copy the tunnel token

4. **Configure the tunnel**:
   - In the tunnel configuration, add a public hostname
   - Set the service to `http://localhost:3000`

5. **Run with your tunnel token**:
```bash
CLOUDFLARE_TUNNEL_TOKEN=your-token-here docker-compose up -d
```

Or create a `.env` file:
```env
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoixxxxxx...
```

Then run:
```bash
docker-compose up -d
```

### Verify Tunnel Status

```bash
# View all logs
docker logs simplemoviesync

# Follow logs in real-time
docker logs -f simplemoviesync
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `HTPASSWD_PATH` | Path to htpasswd file | `./.htpasswd` |
| `NODE_ENV` | Environment mode | `development` |
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare named tunnel token | - |
| `CLOUDFLARE_QUICK_TUNNEL` | Enable quick tunnel (set to `true`) | - |
| `VIDEOS_PATH` | Path to video library | `./videos` |

### Docker Compose

The `docker-compose.yml` file includes:
- Persistent volumes for uploads and transcoded files
- Health checks
- Auto-restart policy
- Cloudflare Tunnel support

Mount your htpasswd file:
```yaml
volumes:
  - ./config:/app/config:ro
```

## Usage

### Admin Panel

1. Navigate to `/admin` and login with your credentials
2. Upload a movie file (MP4, MKV, AVI, WebM supported)
3. Click "Transcode" and select desired qualities
4. Once transcoding completes, click "Create Room"
5. Share the room link with viewers

### Watching

1. Visit the room link or select a room from the homepage
2. Enter your display name
3. Use the video controls to play/pause/seek (synced for all viewers)
4. Chat and react with emojis!

### Keyboard Shortcuts (Watch Page)

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `Left Arrow` | Seek back 10s |
| `Right Arrow` | Seek forward 10s |
| `F` | Toggle fullscreen |

## Managing Users

Use the built-in script to manage admin users:

```bash
# Add a user
node scripts/add-user.js add username password

# Delete a user
node scripts/add-user.js delete username

# List all users
node scripts/add-user.js list
```

## API Endpoints

### Public

- `GET /` - Homepage
- `GET /watch/:roomId` - Watch room page
- `GET /api/rooms` - List all rooms
- `GET /api/rooms/:roomId` - Get room details

### Admin (requires authentication)

- `GET /admin` - Admin panel
- `POST /api/upload` - Upload movie
- `GET /api/movies` - List all movies
- `POST /api/movies/:movieId/transcode` - Start transcoding
- `POST /api/rooms` - Create room
- `DELETE /api/rooms/:roomId` - Delete room

## WebSocket Events

### Client to Server

- `joinRoom` - Join a viewing room
- `play` - Broadcast play event
- `pause` - Broadcast pause event
- `seek` - Broadcast seek event
- `chatMessage` - Send chat message
- `reaction` - Send emoji reaction

### Server to Client

- `roomState` - Initial room state
- `syncPlay/syncPause/syncSeek` - Playback sync events
- `syncHeartbeat` - Periodic sync updates
- `newMessage` - New chat message
- `newReaction` - New emoji reaction
- `viewerJoined/viewerLeft` - Viewer notifications

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with nodemon)
npm run dev

# Run in production mode
npm start
```

## GitHub Container Registry

Images are automatically built and pushed to GitHub Container Registry.

Pull the latest image:
```bash
docker pull ghcr.io/ryan12324/simplemoviesync:latest
```

Run directly:
```bash
docker run -d \
  -p 3000:3000 \
  -v ./config:/app/config:ro \
  -v ./uploads:/app/uploads \
  -v ./transcoded:/app/transcoded \
  -e CLOUDFLARE_TUNNEL_TOKEN=your-token \
  ghcr.io/ryan12324/simplemoviesync:latest
```

## License

MIT
