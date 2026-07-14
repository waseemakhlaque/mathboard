// pdfPages.js — lazy PDF page backgrounds (single PDF blob, render on demand)
// Self-heals missing/corrupted blob data by re-fetching from source when available.

import { storeBlobData } from './blobs.js';
import { getBlob, putBlob } from './storage.js';
import { authHeaders, ensureValidToken } from './auth.js';

export const PDF_WARN_BYTES = 15 * 1024 * 1024;
export const PDF_MAX_BYTES = 100 * 1024 * 1024;
export const PDF_WARN_PAGES = 20;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pdfDocCache = new Map(); // pdfBlobId -> PDFDocumentProxy
const renderCache = new Map(); // key -> jpeg data URL

// Hooks wired by app.js so we avoid circular imports
let _mbToast = (msg) => console.warn('mbToast not wired:', msg);

export function setToastHook(fn) {
  _mbToast = fn;
}

export function isPdfPageBg(bg) {
  return !!(bg && bg.type === 'pdf-page' && bg.pdfBlobId && bg.pageNum);
}

export function isImportedPageBg(bg) {
  return !!(bg && (bg.type === 'image' || bg.type === 'blob' || bg.blobId || isPdfPageBg(bg)));
}

export function pdfImportNeedsConfirm(byteLength, numPages) {
  return byteLength > PDF_WARN_BYTES || numPages > PDF_WARN_PAGES;
}

export function assertPdfImportSize(byteLength) {
  if (byteLength > PDF_MAX_BYTES) {
    throw new Error(`PDF too large (${(byteLength / 1e6).toFixed(1)} MB). Maximum is ${Math.round(PDF_MAX_BYTES / 1e6)} MB.`);
  }
}

/** Build page records that reference one stored PDF blob (no upfront rasterisation). */
export async function buildLazyPdfPages(arrayBuffer, pdfDoc, onProgress, sourceUrl) {
  assertPdfImportSize(arrayBuffer.byteLength);
  const n = pdfDoc.numPages;
  const pdfBlobId = await storeBlobData(new Blob([arrayBuffer], { type: 'application/pdf' }), 'application/pdf');
  pdfDocCache.set(pdfBlobId, pdfDoc);
  const pages = [];
  for (let i = 1; i <= n; i++) {
    onProgress?.(i, n);
    const bg = { type: 'pdf-page', pdfBlobId, pageNum: i, totalPages: n };
    // Track the source URL so loadPdfDoc can re-fetch if blob data is lost
    if (sourceUrl) bg.src = sourceUrl;
    pages.push({
      id: uid(),
      paper: 'plain',
      background: bg,
      strokes: [],
      objects: [],
      instruments: [],
    });
  }
  return pages;
}

/**
 * Load a PDF document by blob id.
 * Self-healing: if the stored bytes are missing/empty and bg.src exists,
 * re-fetch the PDF from source, re-store under the same pdfBlobId, and continue.
 * Returns null on unrecoverable failures (caller shows blank page).
 */
async function loadPdfDoc(pdfBlobId, bg) {
  // Fast path: already loaded and cached
  if (pdfDocCache.has(pdfBlobId)) return pdfDocCache.get(pdfBlobId);

  let rec = await getBlob(pdfBlobId);
  const bufOk = rec?.blob && rec.blob.size > 0;
  // Message must not tell a locally-imported PDF (no bg.src) to "reopen from Past
  // papers" — there's nothing there to reopen. Only papers/books opened from the
  // gated library carry a src; local file-picker imports never do (by design).
  const lostMsg = bg?.src
    ? 'This paper\'s data was cleared by Safari — reopen it from Past papers to restore it.'
    : 'This PDF\'s data was cleared by Safari and can\'t be recovered automatically — please re-import the file.';

  // Self-heal: blob missing/empty but we have a source URL
  if (!bufOk && bg?.src) {
    try {
      _mbToast('Restoring paper data…');
      await ensureValidToken();
      const res = await fetch(bg.src, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const freshBuf = await res.arrayBuffer();
      if (!freshBuf || freshBuf.byteLength === 0) throw new Error('Empty response');
      // Re-store under the SAME pdfBlobId so page references stay valid
      await putBlob(pdfBlobId, new Blob([freshBuf], { type: 'application/pdf' }), 'application/pdf');
      rec = await getBlob(pdfBlobId);
      _mbToast('Paper restored from server.');
    } catch (e) {
      _mbToast(lostMsg);
      console.warn('PDF self-heal failed for', bg.src, e);
      return null;
    }
  }

  if (!rec?.blob || rec.blob.size === 0) {
    _mbToast(lostMsg);
    return null;
  }

  try {
    const buf = await rec.blob.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    pdfDocCache.set(pdfBlobId, pdf);
    return pdf;
  } catch (e) {
    // Stored bytes existed but pdf.js couldn't parse them (truncated/corrupt write) —
    // same user-facing outcome as a missing blob, so use the same message rather
    // than failing silently (previously this only logged, leaving the user with no
    // explanation for why the page went blank).
    _mbToast(lostMsg);
    console.warn('PDF parse failed for', pdfBlobId, e);
    return null;
  }
}

/** Render one PDF page to a JPEG data URL (cached). */
export async function renderPdfPageDataUrl(bg) {
  if (!isPdfPageBg(bg) || !window.pdfjsLib) return null;
  const key = `${bg.pdfBlobId}:${bg.pageNum}`;
  if (renderCache.has(key)) return renderCache.get(key);
  const pdf = await loadPdfDoc(bg.pdfBlobId, bg);
  if (!pdf) return null;
  // The outer PDF can parse fine (loadPdfDoc succeeds) while one specific page's
  // content stream is corrupt — seen live as "PDF file is empty, i.e. its size is
  // zero bytes" thrown from pdf.js during getPage()/render() on a single page deep
  // into a large document. Previously this call was unguarded here and at its one
  // direct caller (the page-thumbnail strip), so the rejection went uncaught and
  // surfaced as the raw pdf.js error banner with that page's thumbnail stuck blank.
  // Per the skip-and-continue rule: one bad page must not throw, it just renders blank.
  try {
    const pg = await pdf.getPage(bg.pageNum);
    const base = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: 1500 / base.width });
    const oc = document.createElement('canvas');
    oc.width = Math.round(vp.width);
    oc.height = Math.round(vp.height);
    const cx = oc.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, oc.width, oc.height);
    await pg.render({ canvasContext: cx, viewport: vp }).promise;
    const url = oc.toDataURL('image/jpeg', 0.92);
    renderCache.set(key, url);
    return url;
  } catch (e) {
    console.warn('PDF page render failed for', key, e);
    return null;
  }
}

/** Load a decoded Image for a pdf-page background (for canvas draw + export). */
export function loadPdfPageImage(bg) {
  return new Promise((resolve) => {
    renderPdfPageDataUrl(bg).then((url) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }).catch(() => resolve(null));
  });
}

export function collectPdfBlobIds(nb) {
  const ids = new Set();
  for (const sec of nb.sections || []) {
    for (const pg of sec.pages || []) {
      if (pg.background?.pdfBlobId) ids.add(pg.background.pdfBlobId);
    }
  }
  return ids;
}

/**
 * Destroy cached PDFDocumentProxy objects for blob ids NOT in the given set.
 * Call when a notebook is closed to free memory from heavy PDFs.
 */
export function destroyUnusedPdfDocs(keepIds) {
  const keep = new Set(keepIds || []);
  for (const [id, doc] of pdfDocCache) {
    if (!keep.has(id)) {
      try { doc.destroy(); } catch (_) { /* non-fatal */ }
      pdfDocCache.delete(id);
    }
  }
  // Also clear render cache entries for destroyed docs
  for (const key of renderCache.keys()) {
    const blobId = key.split(':')[0];
    if (!keep.has(blobId)) renderCache.delete(key);
  }
}