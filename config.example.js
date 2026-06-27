// Copy to config.local.js (git-ignored) and fill in after ./scripts/deploy-supabase.sh
// Supabase Free tier — no payment required for personal / classroom sync.
window.MB_CONFIG = {
  ...window.MB_CONFIG,
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabaseAnonKey: 'YOUR_ANON_KEY',
  syncApiUrl: '',  // optional; defaults to .../functions/v1/mathboard
  collabServerUrl: '',  // Phase 9 — Yjs websocket URL (set after collab server deploy)
};
