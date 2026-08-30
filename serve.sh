#!/usr/bin/env bash
# Serve the viewer on http://localhost:8000
# USDZ loading needs a real http scheme (not file://), hence a local server.
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
echo "Viewer:  http://localhost:${PORT}/"
exec python3 -m http.server "${PORT}"
