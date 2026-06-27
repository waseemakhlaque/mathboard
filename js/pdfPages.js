// pdfPages.js — lazy PDF page backgrounds (single PDF blob, render on demand)

import { storeBlobData } from './blobs.js';
import { getBlob } from './storage.js';

export const PDF_WARN_BYTES = 15 * 1024 * 1024;
export const PDF_MAX_BYTES = 100 * 1024 * 1024;
export const PDF_WARN_PAGES = 20;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pdfDocCache = new Map(); // pdfBlobId -> PDFDocumentProxy
const renderCache = new Map(); // key -> jpeg data URL

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
export async function buildLazyPdfPages(arrayBuffer, pdfDoc, onProgress) {
  assertPdfImportSize(arrayBuffer.byteLength);
  const n = pdfDoc.numPages;
  const pdfBlobId = await storeBlobData(new Blob([arrayBuffer], { type: 'application/pdf' }), 'application/pdf');
  pdfDocCache.set(pdfBlobId, pdfDoc);
  const pages = [];
  for (let i = 1; i <= n; i++) {
    onProgress?.(i, n);
    pages.push({
      id: uid(),
      paper: 'plain',
      background: { type: 'pdf-page', pdfBlobId, pageNum: i, totalPages: n },
      strokes: [],
      objects: [],
      instruments: [],
    });
  }
  return pages;
}

async function loadPdfDoc(pdfBlobId) {
  if (pdfDocCache.has(pdfBlobId)) return pdfDocCache.get(pdfBlobId);
  const rec = await getBlob(pdfBlobId);
  if (!rec?.blob) return null;
  const buf = await rec.blob.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  pdfDocCache.set(pdfBlobId, pdf);
  return pdf;
}

/** Render one PDF page to a JPEG data URL (cached). */
export async function renderPdfPageDataUrl(bg) {
  if (!isPdfPageBg(bg) || !window.pdfjsLib) return null;
  const key = `${bg.pdfBlobId}:${bg.pageNum}`;
  if (renderCache.has(key)) return renderCache.get(key);
  const pdf = await loadPdfDoc(bg.pdfBlobId);
  if (!pdf) return null;
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
