#!/usr/bin/env bash
# MathBoard — deploy Supabase backend (free tier). Run from repo root after `supabase login`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== MathBoard Supabase deploy ==="
echo ""

# ---- auth check -----------------------------------------------------------
if ! supabase projects list &>/dev/null; then
  echo "Not logged in to Supabase CLI."
  echo ""
  echo "  1. Create a FREE account at https://supabase.com (no credit card required)."
  echo "  2. Run:  supabase login"
  echo "     (opens browser — paste the verification code if prompted)"
  echo "  3. Re-run:  ./scripts/deploy-supabase.sh"
  echo ""
  exit 1
fi

# ---- project ref ----------------------------------------------------------
REF="${1:-}"
if [ -z "$REF" ]; then
  echo "Your Supabase projects:"
  supabase projects list
  echo ""
  echo "Paste ONLY the project ref (20 chars), e.g. mjiuhdcxdllurizffvik"
  echo "NOT the Next.js setup text from the dashboard."
  read -rp "Project ref: " REF
fi
if [ -z "$REF" ]; then echo "No ref — aborting."; exit 1; fi

echo ""
echo "→ Linking project $REF ..."
supabase link --project-ref "$REF" --yes

echo "→ Pushing database migration (notebooks table + RLS) ..."
supabase db push --yes

echo "→ Deploying mathboard Edge Function ..."
supabase functions deploy mathboard --yes

echo ""
echo "→ API keys for config.local.js:"
supabase projects api-keys --project-ref "$REF"

URL="https://${REF}.supabase.co"
SYNC="${URL}/functions/v1/mathboard"

echo "=== Deploy complete ==="
echo ""
if [ -f "$ROOT/config.local.js" ]; then
  echo "config.local.js already exists — anon key should match the 'anon' row above."
else
  echo "1. cp config.example.js config.local.js"
  echo "2. Fill supabaseUrl and supabaseAnonKey (use legacy anon JWT, NOT sb_publishable)."
fi
echo ""
echo "→ Create teacher user: dashboard → Authentication → Users → Add user"
echo "→ Open MathBoard → Sync → sign in → Sync now"
echo ""
echo "Sync API: $SYNC"
