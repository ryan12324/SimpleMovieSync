#!/bin/sh

# Start Cloudflare Tunnel if token is provided
if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
    echo "Starting Cloudflare Tunnel..."
    cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" &
elif [ -n "$CLOUDFLARE_QUICK_TUNNEL" ]; then
    echo "Starting Cloudflare Quick Tunnel..."
    cloudflared tunnel --no-autoupdate --url http://localhost:3000 &
fi

# Start the Node.js application
echo "Starting SimpleMovieSync..."
exec node src/server.js
