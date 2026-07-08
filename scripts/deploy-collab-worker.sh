#!/usr/bin/env bash
# Deploy MathBoard Yjs collab Worker (Cloudflare Durable Objects) — from repo root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/collab-worker"
if [ ! -d node_modules ]; then
  echo "→ Installing collab-worker dependencies…"
  npm install
fi
echo "→ Deploying mathboard-collab Worker…"
npx wrangler deploy
echo ""
echo "Set in config.js (already default if account matches):"
echo "  collabServerUrl: 'wss://mathboard-collab.<your-subdomain>.workers.dev'"
echo "Then hard-refresh the PWA and click Collaborate with ?room=lesson-1"
