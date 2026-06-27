// blobs.js — large PDF/image storage outside notebook JSON (IndexedDB blob store)

import { putBlob, getBlob, deleteBlob } from './storage.js';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const urlCache = new Map(); // blobId -> object URL

/** Store raw bytes; returns blob id. */
export async function storeBlobData(blob, mime = 'application/octet-stream') {
  const id = uid();
  await putBlob(id, blob, mime);
  return id;
}

/** data: URL → blob store id. */
export async function storeDataUrl(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return storeBlobData(blob, blob.type || 'image/jpeg');
}

/** Resolve background or image-object ref to a display URL (cached object URL). */
export async function resolveMediaUrl(ref) {
  if (!ref) return null;
  if (ref.type === 'blob' && ref.blobId) {
    if (urlCache.has(ref.blobId)) return urlCache.get(ref.blobId);
    const rec = await getBlob(ref.blobId);
    if (!rec?.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    urlCache.set(ref.blobId, url);
    return url;
  }
  if (ref.data) return ref.data;
  if (typeof ref === 'string' && ref.startsWith('data:')) return ref;
  return null;
}

/** Sync URL for already-resolved blob ids (after hydrate). */
export function cachedMediaUrl(blobId) {
  return urlCache.get(blobId) || null;
}

export function setCachedUrl(blobId, url) {
  if (blobId && url) urlCache.set(blobId, url);
}

export function revokeBlobUrl(blobId) {
  const u = urlCache.get(blobId);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(blobId);
}

export async function deleteMediaBlob(blobId) {
  if (!blobId) return;
  revokeBlobUrl(blobId);
  await deleteBlob(blobId);
}

/** Convert inline data URL on a page background to blob ref (in-place). */
export async function migrateBackground(pg) {
  const bg = pg.background;
  if (!bg || bg.type !== 'image' || !bg.data || bg.blobId) return false;
  const blobId = await storeDataUrl(bg.data);
  pg.background = { type: 'blob', blobId, mime: 'image/jpeg' };
  return true;
}

/** Convert inline data on an image object to blob ref. */
export async function migrateObjectImage(o) {
  if (o.kind !== 'image' || !o.data || o.blobId) return false;
  o.blobId = await storeDataUrl(o.data);
  delete o.data;
  return true;
}

/** Walk notebook and migrate all inline media to blob store. */
export async function migrateNotebookMedia(nb) {
  let n = 0;
  for (const sec of nb.sections || []) {
    for (const pg of sec.pages || []) {
      if (await migrateBackground(pg)) n++;
      for (const o of pg.objects || []) {
        if (await migrateObjectImage(o)) n++;
      }
    }
  }
  return n;
}

/** Collect blob ids referenced by a notebook (for export cleanup). */
export function collectBlobIds(nb) {
  const ids = new Set();
  for (const sec of nb.sections || []) {
    for (const pg of sec.pages || []) {
      if (pg.background?.blobId) ids.add(pg.background.blobId);
      if (pg.background?.pdfBlobId) ids.add(pg.background.pdfBlobId);
      for (const o of pg.objects || []) if (o.blobId) ids.add(o.blobId);
    }
  }
  return ids;
}

/** Inline blob data into export package sidecar (for portable JSON export). */
export async function inlineBlobsForExport(nb) {
  const sidecar = {};
  for (const id of collectBlobIds(nb)) {
    const rec = await getBlob(id);
    if (!rec?.blob) continue;
    const buf = await rec.blob.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    sidecar[id] = { mime: rec.mime, b64 };
  }
  return sidecar;
}

/** Restore sidecar blobs after import. */
export async function restoreBlobsFromSidecar(sidecar) {
  if (!sidecar || typeof sidecar !== 'object') return;
  for (const [id, rec] of Object.entries(sidecar)) {
    if (!rec?.b64) continue;
    const bin = atob(rec.b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await putBlob(id, new Blob([arr], { type: rec.mime || 'application/octet-stream' }), rec.mime);
  }
}
