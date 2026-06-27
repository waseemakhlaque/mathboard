#!/usr/bin/env bash
# Start Yjs websocket server for Phase 9 live collab (from repo root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/collab-server"
if [ ! -d node_modules ]; then
  echo "→ Installing collab-server dependencies (one time)…"
  npm install
fi
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
echo ""
echo "Collab server: ws://${IP}:1234"
echo "Add to config.local.js:  collabServerUrl: 'ws://${IP}:1234'"
echo "Open MathBoard on iPad/other device at http://${IP}:8768 (not localhost)."
echo ""
exec npm start
