// storage.js — IndexedDB: notebooks + blob store (offline-first persistence)

const DB_NAME = 'mathboard';
const DB_VERSION = 2;
const STORE_NB = 'notebooks';
const STORE_BLOB = 'blobs';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NB)) {
        db.createObjectStore(STORE_NB, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOB)) {
        db.createObjectStore(STORE_BLOB, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function nbStore(mode) {
  return openDB().then((db) => db.transaction(STORE_NB, mode).objectStore(STORE_NB));
}

function blobStore(mode) {
  return openDB().then((db) => db.transaction(STORE_BLOB, mode).objectStore(STORE_BLOB));
}

export async function getAllNotebooks() {
  const store = await nbStore('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getNotebook(id) {
  const store = await nbStore('readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveNotebook(nb) {
  const store = await nbStore('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(nb);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteNotebook(id) {
  const store = await nbStore('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Quick probe — Safari Private Browsing blocks IndexedDB. */
export async function storageReady() {
  try {
    const db = await openDB();
    return !!db;
  } catch {
    return false;
  }
}

/** Blob store — keeps large PDF page rasters out of notebook JSON.
 *  Stores raw bytes (ArrayBuffer) instead of Blob objects to avoid
 *  iPad Safari zero-byte Blob corruption on IndexedDB restart. */
export async function putBlob(id, blob, mime = 'application/octet-stream') {
  const buf = await blob.arrayBuffer();
  const store = await blobStore('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ id, buf, mime, created: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getBlob(id) {
  const store = await blobStore('readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => {
      const rec = req.result || null;
      if (!rec) { resolve(null); return; }
      // Backward compatibility: old records stored raw Blob as 'blob'
      if (rec.blob && !rec.buf) {
        if (rec.blob.size > 0) {
          // Async migration path: read the old Blob, rewrite in new format, then resolve.
          rec.blob.arrayBuffer().then((newBuf) => {
            rec.buf = newBuf;
            delete rec.blob;
            rec.blob = new Blob([rec.buf], { type: rec.mime || 'application/octet-stream' });
            // One-time migration write (fire-and-forget, non-fatal if it fails)
            blobStore('readwrite').then((writeStore) => {
              try {
                writeStore.put({ id: rec.id, buf: newBuf, mime: rec.mime, created: rec.created || Date.now() });
              } catch (_) { /* non-fatal */ }
            }).catch(() => { /* non-fatal */ });
            resolve(rec);
          }).catch(reject);
          return;
        }
        delete rec.blob;
      }
      // Reconstruct Blob from stored bytes so existing callers keep working
      if (rec.buf) {
        rec.blob = new Blob([rec.buf], { type: rec.mime || 'application/octet-stream' });
      }
      resolve(rec);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBlob(id) {
  const store = await blobStore('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
