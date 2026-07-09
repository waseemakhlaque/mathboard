// Copy to config.local.js (git-ignored) and fill in after ./scripts/deploy-supabase.sh
// App access is login-based (signed-in + profiles.active_until). No billing keys.
window.MB_CONFIG = {
  ...window.MB_CONFIG,
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabaseAnonKey: 'YOUR_ANON_KEY',
  syncApiUrl: '',  // optional; defaults to .../functions/v1/mathboard
  collabServerUrl: '',  // Phase 9 — Yjs websocket URL (set after collab server deploy)
  cfAnalyticsToken: '',  // Cloudflare Web Analytics beacon token (usage dashboard); '' = off
};
