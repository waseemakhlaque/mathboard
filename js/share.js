// share.js — export / import / share hooks + hybrid sync (local-first, cloud when signed in)

import { packageNotebook, unpackNotebook, notebookFilename, freshId, FORMAT_VERSION, APP_NAME, normalizeNotebook } from './model.js';
import { saveNotebook, getNotebook, getAllNotebooks, deleteNotebook } from './storage.js';
import { inlineBlobsForExport, restoreBlobsFromSidecar } from './blobs.js';
import {
  authHeaders, defaultSyncApiUrl, getSupabaseAnonKey, isSignedIn, ensureValidToken,
} from './auth.js';

let statusListeners = [];
const SYNC_URL_KEY = 'mb-sync-url';
const pendingRemote = new Set();
let remotePushTimer = null;

export function onSyncStatus(fn) { statusListeners.push(fn); }

function emitStatus(s) {
  for (const fn of statusListeners) fn(s);
}

export function getSyncBaseUrl() {
  try {
    const saved = localStorage.getItem(SYNC_URL_KEY) || '';
    if (saved) return saved;
  } catch { /* ok */ }
  return defaultSyncApiUrl();
}

export function setSyncBaseUrl(url) {
  const u = (url || '').trim().replace(/\/$/, '');
  try {
    if (u) localStorage.setItem(SYNC_URL_KEY, u);
    else localStorage.removeItem(SYNC_URL_KEY);
  } catch { /* ok */ }
  emitStatus({
    mode: u && isSignedIn() ? 'remote' : 'local',
    state: u ? (isSignedIn() ? 'configured' : 'configured') : 'offline',
    at: Date.now(),
  });
  return u;
}

function canUseRemote() {
  return !!(getSyncBaseUrl() && isSignedIn() && getSupabaseAnonKey());
}

async function remoteFetch(path, opts = {}) {
  const base = getSyncBaseUrl();
  if (!base) throw new Error('Remote sync URL not configured.');
  if (!getSupabaseAnonKey()) throw new Error('Set supabaseAnonKey in config.js.');
  if (!isSignedIn()) throw new Error('Sign in to sync (Sync dialog).');
  const ok = await ensureValidToken();
  if (!ok) throw new Error('Session expired — sign in again.');
  const headers = authHeaders(opts.headers || {});
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { ...opts, headers, credentials: 'omit' });
  return res;
}

async function remotePushPackage(nb) {
  const pkg = packageNotebook(nb);
  const sidecar = await inlineBlobsForExport(nb);
  if (Object.keys(sidecar).length) pkg.blobs = sidecar;
  const res = await remoteFetch(`/notebooks/${encodeURIComponent(nb.id)}`, {
    method: 'PUT',
    body: JSON.stringify(pkg),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || 'Could not upload lesson.');
  }
}

async function remotePullPackage(id) {
  const res = await remoteFetch(`/notebooks/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || 'Could not fetch lesson.');
  }
  const pkg = await res.json();
  if (pkg.blobs) await restoreBlobsFromSidecar(pkg.blobs);
  return unpackNotebook(pkg);
}

function scheduleRemotePush(nb) {
  if (!canUseRemote() || !nb?.id) return;
  pendingRemote.add(nb.id);
  clearTimeout(remotePushTimer);
  remotePushTimer = setTimeout(flushRemotePush, 900);
}

async function flushRemotePush() {
  if (!canUseRemote()) return;
  const ids = [...pendingRemote];
  pendingRemote.clear();
  for (const id of ids) {
    try {
      const nb = await getNotebook(id);
      if (nb) {
        await remotePushPackage(normalizeNotebook(nb));
        emitStatus({ mode: 'remote', state: 'synced', at: Date.now(), id });
      }
    } catch (e) {
      pendingRemote.add(id);
      emitStatus({ mode: 'remote', state: 'sync-error', at: Date.now(), id, error: e.message });
    }
  }
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function exportNotebookJSON(nb) {
  const pkg = packageNotebook(nb);
  const sidecar = await inlineBlobsForExport(nb);
  if (Object.keys(sidecar).length) pkg.blobs = sidecar;
  const json = JSON.stringify(pkg, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), notebookFilename(nb));
  emitStatus({ mode: 'local', state: 'exported', at: Date.now() });
}

export async function importNotebookFromFile(file) {
  const text = await file.text();
  let pkg;
  try { pkg = JSON.parse(text); } catch (_) { throw new Error('File is not valid JSON.'); }
  const nb = unpackNotebook(pkg);
  if (pkg.blobs) await restoreBlobsFromSidecar(pkg.blobs);
  const existing = await getAllNotebooks();
  const ids = new Set(existing.map((n) => n.id));
  if (ids.has(nb.id)) nb.id = freshId();
  nb.updated = Date.now();
  await saveNotebook(nb);
  scheduleRemotePush(nb);
  emitStatus({ mode: 'local', state: 'imported', at: Date.now(), id: nb.id });
  return nb;
}

export async function shareNotebook(nb) {
  const pkg = packageNotebook(nb);
  const sidecar = await inlineBlobsForExport(nb);
  if (Object.keys(sidecar).length) pkg.blobs = sidecar;
  const json = JSON.stringify(pkg);
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
  await exportNotebookJSON(nb);
  return 'downloaded';
}

/** Remote-only provider (internal). */
export function createSyncProvider({ mode = 'local', baseUrl = null } = {}) {
  if (mode === 'remote') {
    return {
      mode: 'remote',
      baseUrl,
      status: baseUrl ? 'idle' : 'unconfigured',
      async list() {
        const res = await remoteFetch('/notebooks');
        if (!res.ok) throw new Error('Could not list remote lessons.');
        return res.json();
      },
      async pull(id) { return remotePullPackage(id); },
      async push(nb) {
        await remotePushPackage(normalizeNotebook(nb));
        emitStatus({ mode: 'remote', state: 'synced', at: Date.now(), id: nb.id });
        return { ok: true };
      },
      async remove(id) {
        const res = await remoteFetch(`/notebooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Could not delete remote lesson.');
        return { ok: true };
      },
    };
  }
  return {
    mode: 'local',
    status: 'offline',
    list: () => getAllNotebooks(),
    pull: (id) => getNotebook(id),
    push: (nb) => saveNotebook(normalizeNotebook(nb)).then(() => {
      emitStatus({ mode: 'local', state: 'saved', at: Date.now(), id: nb.id });
      return { ok: true };
    }),
    remove: (id) => deleteNotebook(id),
  };
}

/** Hybrid: IndexedDB always; cloud push when signed in + URL set. */
const hybridProvider = {
  get mode() { return canUseRemote() ? 'remote' : 'local'; },
  push(nb) {
    const normalized = normalizeNotebook(nb);
    return saveNotebook(normalized).then(() => {
      emitStatus({ mode: 'local', state: 'saved', at: Date.now(), id: nb.id });
      scheduleRemotePush(normalized);
      return { ok: true };
    });
  },
  pull: (id) => getNotebook(id),
  list: () => getAllNotebooks(),
  async remove(id) {
    await deleteNotebook(id);
    if (canUseRemote()) {
      try {
        await createSyncProvider({ mode: 'remote', baseUrl: getSyncBaseUrl() }).remove(id);
      } catch (_) { /* offline — local delete stands */ }
    }
  },
};

export const sync = {
  get mode() { return hybridProvider.mode; },
  push(nb) { return hybridProvider.push(nb); },
  pull(id) { return hybridProvider.pull(id); },
  list() { return hybridProvider.list(); },
  remove(id) { return hybridProvider.remove(id); },
};

/** Push all local notebooks to remote (when configured). */
export async function syncAllToRemote() {
  if (!canUseRemote()) throw new Error('Sign in and save sync URL first.');
  const local = await getAllNotebooks();
  let n = 0;
  for (const nb of local) {
    await remotePushPackage(normalizeNotebook(nb));
    n++;
  }
  emitStatus({ mode: 'remote', state: 'synced-all', at: Date.now(), count: n });
  return n;
}

/**
 * Two-way merge: pull newer remote lessons, push newer/local-only lessons.
 * Last-write-wins by notebook.updated (ms timestamp).
 */
export async function mergeSync() {
  if (!canUseRemote()) throw new Error('Sign in and save sync URL first.');
  const remote = createSyncProvider({ mode: 'remote', baseUrl: getSyncBaseUrl() });
  const list = await remote.list();
  const remoteIds = new Set();
  let pulled = 0, pushed = 0;

  for (const meta of list) {
    const id = meta.id || meta;
    remoteIds.add(id);
    const remoteNb = await remotePullPackage(id);
    const local = await getNotebook(id);
    if (!local) {
      await saveNotebook(normalizeNotebook(remoteNb));
      pulled++;
    } else if ((remoteNb.updated || 0) > (local.updated || 0)) {
      await saveNotebook(normalizeNotebook(remoteNb));
      pulled++;
    } else if ((local.updated || 0) > (remoteNb.updated || 0)) {
      await remotePushPackage(normalizeNotebook(local));
      pushed++;
    }
  }

  const localAll = await getAllNotebooks();
  for (const nb of localAll) {
    if (!remoteIds.has(nb.id)) {
      await remotePushPackage(normalizeNotebook(nb));
      pushed++;
    }
  }

  emitStatus({ mode: 'remote', state: 'merged', at: Date.now(), pulled, pushed });
  return { pulled, pushed };
}

/** @deprecated use mergeSync — kept for API compat */
export async function pullRemoteCatalog() {
  const r = await mergeSync();
  return r.pulled + r.pushed;
}

export function notifySaved(nb) {
  emitStatus({ mode: sync.mode, state: 'saved', at: Date.now(), id: nb?.id });
}

/** Retry pending cloud uploads (e.g. after reconnect). */
export async function retryPendingSync() {
  if (!pendingRemote.size) return 0;
  await flushRemotePush();
  return pendingRemote.size;
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
    mergeSync,
    pullRemoteCatalog,
    retryPendingSync,
    exportNotebookJSON,
    importNotebookFromFile,
    shareNotebook,
    onSyncStatus,
  };
}

// Restore saved sync URL on load; retry cloud queue when back online.
setSyncBaseUrl(getSyncBaseUrl());
window.addEventListener('online', () => {
  if (canUseRemote()) flushRemotePush().catch(() => {});
});
