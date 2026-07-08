// js/collab/collab.js — Yjs realtime sync (Phase 9). Loaded only via dynamic import when collabServerUrl is set.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

let provider = null;
let ydoc = null;
let pagesMap = null;
let pageObs = null;
let localOrigin = null;
let ctx = null;
let connectTimer = null;

const CONNECT_TIMEOUT_MS = 15000;

function roomName() {
  const q = new URLSearchParams(location.search).get('room');
  if (q) return q.trim();
  const name = prompt('Collaboration room name (share this with students):', 'mathboard-1');
  return name ? name.trim() : '';
}

function wsBase(url) {
  const u = url.replace(/\/$/, '');
  return u.startsWith('ws') ? u : u.replace(/^http/, 'ws');
}

function setCollabStatus(text, state) {
  const el = document.getElementById('collab-status');
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state || '';
}

function clearConnectTimer() {
  if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
}

function getPageStruct(pageId) {
  let st = pagesMap.get(pageId);
  if (!st) {
    st = new Y.Map();
    const strokes = new Y.Array();
    st.set('strokes', strokes);
    pagesMap.set(pageId, st);
  }
  return st;
}

function yStrokesFor(pageId) {
  return getPageStruct(pageId).get('strokes');
}

function bindCurrentPage() {
  if (pageObs) pageObs();
  pageObs = null;
  const pg = ctx.page?.();
  if (!pg || !pagesMap) return;

  const yStrokes = yStrokesFor(pg.id);
  const applyRemote = () => {
    const arr = yStrokes.toArray();
    if (JSON.stringify(pg.strokes) !== JSON.stringify(arr)) {
      pg.strokes = arr;
      ctx.mark?.();
    }
  };

  const onY = (event) => {
    if (event.transaction.origin === localOrigin) return;
    applyRemote();
  };
  yStrokes.observe(onY);
  pageObs = () => yStrokes.unobserve(onY);

  // Seed room with local ink if Y side is empty.
  if (!yStrokes.length && pg.strokes?.length) {
    ydoc.transact(() => {
      yStrokes.insert(0, pg.strokes);
    }, localOrigin);
  } else if (yStrokes.length) {
    applyRemote();
  }
}

// P0: Pause sync during active drawing to prevent lag
let syncPaused = false;

/** Pause collaboration sync (call when starting a drawing stroke). */
export function pauseCollabSync() {
  syncPaused = true;
}

/** Resume collaboration sync and push accumulated changes (call after committing stroke). */
export function resumeCollabSync() {
  if (!syncPaused) return;
  syncPaused = false;
  collabPushPage(); // Push accumulated changes now
}

/** Push current page strokes to Yjs (call after local edits). */
export function collabPushPage() {
  if (syncPaused || !ydoc || !ctx?.page) return;
  const pg = ctx.page();
  if (!pg) return;
  const yStrokes = yStrokesFor(pg.id);
  const local = pg.strokes || [];
  if (JSON.stringify(yStrokes.toArray()) === JSON.stringify(local)) return;
  ydoc.transact(() => {
    yStrokes.delete(0, yStrokes.length);
    if (local.length) yStrokes.insert(0, local);
  }, localOrigin);
}

function setupAwarenessOverlay() {
  let layer = document.getElementById('collab-cursors');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'collab-cursors';
    layer.className = 'collab-cursors';
    document.querySelector('.stage')?.appendChild(layer);
  }
  const aw = provider.awareness;
  const render = () => {
    layer.innerHTML = '';
    const states = aw.getStates();
    states.forEach((st, clientId) => {
      if (clientId === aw.clientID || !st?.cursor) return;
      const el = document.createElement('div');
      el.className = 'collab-cursor';
      el.style.transform = `translate(${st.cursor.x}px, ${st.cursor.y}px)`;
      el.textContent = st.user?.name || `User ${clientId}`;
      layer.appendChild(el);
    });
  };
  aw.setLocalStateField('user', { name: ctx.userName?.() || 'Teacher' });
  aw.on('change', render);
  render();

  const cv = document.getElementById('board');
  if (cv) {
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      aw.setLocalStateField('cursor', { x: e.clientX - r.left, y: e.clientY - r.top });
    });
  }
}

function failCollab(message) {
  clearConnectTimer();
  setCollabStatus('✕ Offline', 'error');
  stopCollab();
  alert(message);
}

export function startCollab(c) {
  ctx = c;
  const raw = ((window.MB_CONFIG && window.MB_CONFIG.collabServerUrl) || '').trim();
  if (!raw) return { connected: false, reason: 'no-server' };
  if (!navigator.onLine) return { connected: false, reason: 'offline' };

  const room = roomName();
  if (!room) return { connected: false, reason: 'no-room' };

  localOrigin = Symbol('local');
  ydoc = new Y.Doc();
  pagesMap = ydoc.getMap('pages');

  provider = new WebsocketProvider(wsBase(raw), room, ydoc, { connect: true });

  document.getElementById('collab-bar')?.classList.remove('hidden');
  setCollabStatus('○ Connecting…', 'connecting');

  connectTimer = setTimeout(() => {
    if (provider?.wsconnected) return;
    failCollab('Could not connect to the collaboration server. Check collabServerUrl and that the server is running.');
  }, CONNECT_TIMEOUT_MS);

  provider.on('status', ({ status }) => {
    if (status === 'connected') {
      clearConnectTimer();
      setCollabStatus('● Live', 'live');
    } else if (status === 'disconnected') {
      setCollabStatus('○ Disconnected', 'offline');
    } else {
      setCollabStatus('○ Connecting…', 'connecting');
    }
  });

  provider.on('connection-error', () => {
    if (provider?.wsconnected) return;
    failCollab('Collaboration server unreachable. Check your network and server URL.');
  });

  provider.on('sync', (synced) => {
    if (synced) {
      clearConnectTimer();
      bindCurrentPage();
      setupAwarenessOverlay();
      setCollabStatus('● Live', 'live');
    }
  });

  const onOffline = () => {
    if (provider) setCollabStatus('○ Offline', 'offline');
  };
  window.addEventListener('offline', onOffline, { once: true });

  return { connected: true, room, url: wsUrl };
}

export function onCollabPageSwitch() {
  bindCurrentPage();
}

export function stopCollab() {
  clearConnectTimer();
  pageObs?.();
  pageObs = null;
  provider?.destroy();
  provider = null;
  ydoc = null;
  document.getElementById('collab-cursors')?.remove();
  document.getElementById('collab-bar')?.classList.add('hidden');
}

export function collabActive() {
  return !!provider;
}
