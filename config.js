// MathBoard runtime config — plain script (NOT an ES module), loaded before app.js.
// Empty by default so the solo / offline app never reaches out to any server and stays
// byte-for-byte unchanged. On a deployed host, set collabServerUrl to enable live collaboration.
window.MB_CONFIG = { collabServerUrl: '' };
