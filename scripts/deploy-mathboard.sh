#!/usr/bin/env bash
# Deploy MathBoard PWA + /api/rag/* (Vectorize search + ingest).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Deploying mathboard (static assets + worker/index.js RAG routes)…"
npx wrangler deploy

echo ""
echo "If not done yet, set ingest token (once):"
echo "  export INGEST_TOKEN=\$(openssl rand -hex 24)"
echo "  echo \"\$INGEST_TOKEN\" | npx wrangler secret put INGEST_TOKEN"
echo ""
echo "Verify:"
echo "  curl -s https://mathboard.waseemakhlaque85.workers.dev/api/rag/health"
echo ""
echo "Then ingest:"
echo "  cd scripts && export INGEST_TOKEN='your-token' && node rag-ingest.mjs"
