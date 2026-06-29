// MathBoard runtime config — plain script (NOT an ES module), loaded before app.js.
// Supabase anon key is public (client-side). Do not put service-role secrets here.
// Override locally via gitignored config.local.js (see config.example.js).
window.MB_CONFIG = {
  supabaseUrl: 'https://mjiuhdcxdllurizffvik.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qaXVoZGN4ZGxsdXJpemZmdmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTg0NDAsImV4cCI6MjA5ODA3NDQ0MH0.YFdbJRYeaEXf25GdMvzTzJHx_Vl8R9EERAmdIyG3whQ',
  syncApiUrl: '',  // optional; defaults to supabaseUrl + /functions/v1/mathboard
  collabServerUrl: 'wss://mathboard-collab.waseemakhlaque85.workers.dev',
  // Usage analytics (Cloudflare Web Analytics). Paste the beacon TOKEN from
  // Cloudflare dashboard → Analytics & Logs → Web Analytics → Add a site.
  // Leave '' to disable (no tracking). Privacy-friendly, no personal data.
  cfAnalyticsToken: '',
  // P1: Brand badge — shown in present mode. Override via config.local.js.
  brandName: 'MathBoard',
  brandTeacher: 'Waseem Akhlaque',
  brandTitle: 'A Level Mathematics Teacher',
  brandImage: './assets/waseem.jpg',
  brandPhone: '03212890512',
};
