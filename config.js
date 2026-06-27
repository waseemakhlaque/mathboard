// MathBoard runtime config — plain script (NOT an ES module), loaded before app.js.
// Empty by default so the solo / offline app never reaches out to any server.
// On a deployed host, fill in Supabase values for cloud sync (see docs/SUPABASE-SETUP.md).
window.MB_CONFIG = {
  collabServerUrl: '',
  supabaseUrl: '',
  supabaseAnonKey: '',
  syncApiUrl: '',  // optional; defaults to supabaseUrl + /functions/v1/mathboard
};
