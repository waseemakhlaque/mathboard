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

/** Blob store — keeps large PDF page rasters out of notebook JSON. */
export async function putBlob(id, blob, mime = 'application/octet-stream') {
  const store = await blobStore('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ id, blob, mime, created: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getBlob(id) {
  const store = await blobStore('readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
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
