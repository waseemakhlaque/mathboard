// share.js — export / import / share hooks + sync provider (portal-ready)

import { packageNotebook, unpackNotebook, notebookFilename, freshId, FORMAT_VERSION, APP_NAME, normalizeNotebook } from './model.js';
import { saveNotebook, getNotebook, getAllNotebooks, deleteNotebook } from './storage.js';

let statusListeners = [];
let remoteProvider = null;

const SYNC_URL_KEY = 'mb-sync-url';

export function onSyncStatus(fn) { statusListeners.push(fn); }

function emitStatus(s) {
  for (const fn of statusListeners) fn(s);
}

export function getSyncBaseUrl() {
  try { return localStorage.getItem(SYNC_URL_KEY) || ''; } catch { return ''; }
}

export function setSyncBaseUrl(url) {
  const u = (url || '').trim().replace(/\/$/, '');
  try {
    if (u) localStorage.setItem(SYNC_URL_KEY, u);
    else localStorage.removeItem(SYNC_URL_KEY);
  } catch { /* ok */ }
  remoteProvider = u ? createSyncProvider({ mode: 'remote', baseUrl: u }) : null;
  emitStatus({ mode: u ? 'remote' : 'local', state: u ? 'configured' : 'offline', at: Date.now() });
  return u;
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function exportNotebookJSON(nb) {
  const json = JSON.stringify(packageNotebook(nb), null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), notebookFilename(nb));
  emitStatus({ mode: 'local', state: 'exported', at: Date.now() });
}

export async function importNotebookFromFile(file) {
  const text = await file.text();
  let pkg;
  try { pkg = JSON.parse(text); } catch (_) { throw new Error('File is not valid JSON.'); }
  const nb = unpackNotebook(pkg);
  const existing = await getAllNotebooks();
  const ids = new Set(existing.map((n) => n.id));
  if (ids.has(nb.id)) nb.id = freshId();
  nb.updated = Date.now();
  await saveNotebook(nb);
  emitStatus({ mode: 'local', state: 'imported', at: Date.now(), id: nb.id });
  return nb;
}

export async function shareNotebook(nb) {
  const json = JSON.stringify(packageNotebook(nb));
  const name = notebookFilename(nb);
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.share) {
    try {
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ title: nb.title, text: 'MathBoard lesson', files: [file] });
        emitStatus({ mode: 'local', state: 'shared', at: Date.now() });
        return 'shared';
      }
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  exportNotebookJSON(nb);
  return 'downloaded';
}

/** Sync provider — local (IndexedDB) or remote REST API. */
export function createSyncProvider({ mode = 'local', baseUrl = null } = {}) {
  if (mode === 'remote') {
    return {
      mode: 'remote',
      baseUrl,
      status: baseUrl ? 'idle' : 'unconfigured',
      async list() {
        if (!baseUrl) throw new Error('Remote sync URL not configured.');
        const res = await fetch(`${baseUrl}/notebooks`, { credentials: 'include' });
        if (!res.ok) throw new Error('Could not list remote lessons.');
        return res.json();
      },
      async pull(id) {
        if (!baseUrl) throw new Error('Remote sync URL not configured.');
        const res = await fetch(`${baseUrl}/notebooks/${id}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Could not fetch lesson.');
        return unpackNotebook(await res.json());
      },
      async push(nb) {
        if (!baseUrl) throw new Error('Remote sync URL not configured.');
        const res = await fetch(`${baseUrl}/notebooks/${nb.id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(packageNotebook(nb)),
        });
        if (!res.ok) throw new Error('Could not upload lesson.');
        emitStatus({ mode: 'remote', state: 'synced', at: Date.now(), id: nb.id });
        return { ok: true };
      },
      async remove(id) {
        if (!baseUrl) throw new Error('Remote sync URL not configured.');
        await fetch(`${baseUrl}/notebooks/${id}`, { method: 'DELETE', credentials: 'include' });
        return { ok: true };
      },
    };
  }
  return {
    mode: 'local',
    status: 'offline',
    list: () => getAllNotebooks(),
    pull: (id) => getNotebook(id),
    push: (nb) => saveNotebook(nb).then(() => {
      emitStatus({ mode: 'local', state: 'saved', at: Date.now(), id: nb.id });
      return { ok: true };
    }),
    remove: (id) => deleteNotebook(id),
  };
}

function activeProvider() {
  if (remoteProvider) return remoteProvider;
  const url = getSyncBaseUrl();
  if (url) {
    remoteProvider = createSyncProvider({ mode: 'remote', baseUrl: url });
    return remoteProvider;
  }
  return createSyncProvider({ mode: 'local' });
}

export const sync = {
  get mode() { return activeProvider().mode; },
  push(nb) { return activeProvider().push(nb); },
  pull(id) { return activeProvider().pull(id); },
  list() { return activeProvider().list(); },
  remove(id) { return activeProvider().remove(id); },
};

/** Push all local notebooks to remote (when configured). */
export async function syncAllToRemote() {
  const url = getSyncBaseUrl();
  if (!url) throw new Error('Set a cloud sync URL first.');
  const remote = createSyncProvider({ mode: 'remote', baseUrl: url });
  const local = await getAllNotebooks();
  let n = 0;
  for (const nb of local) {
    await remote.push(normalizeNotebook(nb));
    n++;
  }
  emitStatus({ mode: 'remote', state: 'synced-all', at: Date.now(), count: n });
  return n;
}

/** Pull remote lesson list and merge into IndexedDB (by id). */
export async function pullRemoteCatalog() {
  const url = getSyncBaseUrl();
  if (!url) throw new Error('Set a cloud sync URL first.');
  const remote = createSyncProvider({ mode: 'remote', baseUrl: url });
  const list = await remote.list();
  let n = 0;
  for (const meta of list) {
    const id = meta.id || meta;
    const nb = await remote.pull(id);
    await saveNotebook(normalizeNotebook(nb));
    n++;
  }
  emitStatus({ mode: 'remote', state: 'pulled', at: Date.now(), count: n });
  return n;
}

export function notifySaved(nb) {
  emitStatus({ mode: sync.mode, state: 'saved', at: Date.now(), id: nb?.id });
}

export function getPortalAPI() {
  return {
    version: FORMAT_VERSION,
    app: APP_NAME,
    packageNotebook,
    unpackNotebook,
    normalizeNotebook,
    createSyncProvider,
    sync,
    getSyncBaseUrl,
    setSyncBaseUrl,
    syncAllToRemote,
    pullRemoteCatalog,
    exportNotebookJSON,
    importNotebookFromFile,
    shareNotebook,
    onSyncStatus,
  };
}

// Restore remote URL on load
setSyncBaseUrl(getSyncBaseUrl());
