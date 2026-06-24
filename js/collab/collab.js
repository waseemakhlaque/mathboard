// js/collab/collab.js
// Live-collaboration entry point. IMPORTANT: this file (and everything under js/collab/) is loaded
// ONLY via a dynamic import() from app.js when collabAvailable() is true — it is never statically
// imported, never precached by the service worker, and never fetched on localhost/offline. This
// keeps the solo, offline static app byte-for-byte unchanged. The real realtime client (presence,
// CRDT sync, rooms) lands in the online-portal phase; this is the gated, isolated shell.

export function startCollab(ctx) {
  const url = ((window.MB_CONFIG && window.MB_CONFIG.collabServerUrl) || '').trim();
  if (!url) return { connected: false, reason: 'no-server' };
  // TODO (online-portal phase): open the realtime connection (WebSocket / Yjs) to `url`,
  // bind the current notebook (ctx.notebook()) to a shared document, and render presence.
  alert('Live collaboration server:\n' + url + '\n\nThe realtime client will be implemented in the online-portal phase.');
  return { connected: false, url, ctx };
}
