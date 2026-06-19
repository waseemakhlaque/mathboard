// MathBoard — a pencil-first notebook whiteboard for A-level maths.
// Copyright © 2026 Waseem Akhlaque. MIT License (see LICENSE).
//
// app.js — paginated notebook whiteboard.
// Vanilla JS, Canvas 2D. Strokes are stored in page units (PAGE_W x PAGE_H) so
// pan/zoom never distorts saved ink. One page is shown at a time.

import { getAllNotebooks, getNotebook, saveNotebook, deleteNotebook } from './storage.js';

// ---- constants ---------------------------------------------------------------
const PAGE_W = 1000;          // page units (A4 portrait ratio ~ 1.414)
const PAGE_H = 1414;
const PAPERS = ['plain', 'squared', 'graph', 'cornell', 'argand', 'vectorgrid'];
const COLORS = ['#1b1b1b', '#2566c8', '#d23b3b', '#1f9d57', '#e0892a', '#8a4fd0'];
const UNDO_CAP = 60;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---- application state -------------------------------------------------------
const S = {
  notebook: null,           // current notebook object
  pageIndex: 0,
  tool: 'pen',              // pen | highlighter | eraser | lasso
  color: COLORS[0],
  width: 4,                 // page units
  fingerDraw: false,
  // camera (css px): screenCss = page*scale + offset
  scale: 1, offsetX: 0, offsetY: 0,
  // interaction
  drawing: null,            // active stroke being drawn
  actionBefore: null,       // strokes snapshot taken at action start (for undo)
  undo: [], redo: [],
  lassoPath: null,          // points (page units) of in-progress lasso
  selection: null,          // { strokes:[refs], bbox:{x,y,w,h} }
  moving: null,             // { lastX, lastY }
  // multi-touch gesture
  touch: new Map(),         // pointerId -> {x,y} css
  gref: null,
  dirty: true,
};

let cv, ctx, dpr = 1;

// ---- helpers -----------------------------------------------------------------
const page = () => S.notebook.pages[S.pageIndex];
const clone = (o) => JSON.parse(JSON.stringify(o));
const $ = (sel) => document.querySelector(sel);

function toPage(cssX, cssY) {
  return { x: (cssX - S.offsetX) / S.scale, y: (cssY - S.offsetY) / S.scale };
}

function newPage(paper = 'graph') {
  return { id: uid(), paper, strokes: [] };
}

function newNotebook(title) {
  const t = Date.now();
  return { id: uid(), title: title || 'Untitled lesson', created: t, updated: t, pages: [newPage()] };
}

// ---- persistence (debounced) -------------------------------------------------
let saveTimer = null;
function persist() {
  if (!S.notebook) return;
  S.notebook.updated = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNotebook(clone(S.notebook)), 400);
}

// ---- undo / redo (snapshot of current page strokes) --------------------------
function beginAction() { S.actionBefore = clone(page().strokes); }
function commitAction() {
  if (!S.actionBefore) return;
  if (JSON.stringify(S.actionBefore) !== JSON.stringify(page().strokes)) {
    S.undo.push(S.actionBefore);
    if (S.undo.length > UNDO_CAP) S.undo.shift();
    S.redo = [];
    persist();
  }
  S.actionBefore = null;
}
function doUndo() {
  if (!S.undo.length) return;
  S.redo.push(clone(page().strokes));
  page().strokes = S.undo.pop();
  clearSelection(); mark(); persist();
}
function doRedo() {
  if (!S.redo.length) return;
  S.undo.push(clone(page().strokes));
  page().strokes = S.redo.pop();
  clearSelection(); mark(); persist();
}

// ---- geometry helpers --------------------------------------------------------
function strokeBBox(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const p of s.points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a.y > pt.y) !== (b.y > pt.y)) &&
        (pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
  }
  return inside;
}
function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

// ---- rendering ---------------------------------------------------------------
function mark() { S.dirty = true; }

function resizeCanvas() {
  const r = cv.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  mark();
}

function fitPage() {
  const r = cv.getBoundingClientRect();
  const m = 24;
  S.scale = Math.min((r.width - m) / PAGE_W, (r.height - m) / PAGE_H);
  S.offsetX = (r.width - PAGE_W * S.scale) / 2;
  S.offsetY = (r.height - PAGE_H * S.scale) / 2;
  mark();
}

// page background images (imported PDF/photo pages), cached + lazily decoded
const imgCache = new Map(); // pageId -> { img, loaded }
function pageImage(pg) {
  if (!pg.background || pg.background.type !== 'image') return null;
  let e = imgCache.get(pg.id);
  if (!e) {
    const img = new Image();
    e = { img, loaded: false };
    imgCache.set(pg.id, e);
    img.onload = () => { e.loaded = true; mark(); };
    img.src = pg.background.data;
  }
  return e.loaded ? e.img : null;
}
function drawContain(c, img) {
  const s = Math.min(PAGE_W / img.width, PAGE_H / img.height);
  const w = img.width * s, h = img.height * s;
  c.drawImage(img, (PAGE_W - w) / 2, (PAGE_H - h) / 2, w, h);
}
// dispatch: imported image background, else paper template
function drawBackground(c, pg, img) {
  if (pg.background && pg.background.type === 'image') {
    if (img) drawContain(c, img);
  } else {
    drawTemplate(c, pg.paper);
  }
}
// ensure all imported page images are decoded before export
function ensureImagesLoaded() {
  const pend = S.notebook.pages.filter((p) => p.background && p.background.type === 'image');
  return Promise.all(pend.map((p) => new Promise((res) => {
    const e = imgCache.get(p.id);
    if (e && e.loaded) return res();
    const img = new Image();
    img.onload = () => { imgCache.set(p.id, { img, loaded: true }); res(); };
    img.onerror = () => res();
    img.src = p.background.data;
  })));
}

function drawTemplate(c, paper) {
  c.lineWidth = 1;
  const line = (x1, y1, x2, y2, col, w) => {
    c.strokeStyle = col; c.lineWidth = w; c.beginPath();
    c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  };
  const grid = (step, col) => {
    for (let x = step; x < PAGE_W; x += step) line(x, 0, x, PAGE_H, col, 1);
    for (let y = step; y < PAGE_H; y += step) line(0, y, PAGE_W, y, col, 1);
  };
  const faint = '#dfe6ef', mid = '#c2d0e0', axis = '#7d8aa0';
  if (paper === 'squared') grid(40, faint);
  else if (paper === 'graph') { grid(20, faint); grid(100, mid); }
  else if (paper === 'cornell') {
    for (let y = 80; y < PAGE_H; y += 56) line(0, y, PAGE_W, y, faint, 1);
    line(240, 0, 240, PAGE_H, mid, 1.5);
  } else if (paper === 'argand') {
    grid(50, faint);
    line(0, PAGE_H / 2, PAGE_W, PAGE_H / 2, axis, 2);
    line(PAGE_W / 2, 0, PAGE_W / 2, PAGE_H, axis, 2);
    c.fillStyle = axis; c.font = '24px sans-serif';
    c.fillText('Re', PAGE_W - 56, PAGE_H / 2 - 12);
    c.fillText('Im', PAGE_W / 2 + 12, 32);
  } else if (paper === 'vectorgrid') {
    grid(50, faint);
    line(0, PAGE_H / 2, PAGE_W, PAGE_H / 2, axis, 2);
    line(PAGE_W / 2, 0, PAGE_W / 2, PAGE_H, axis, 2);
  }
}

function drawStroke(c, s) {
  const pts = s.points;
  c.strokeStyle = s.color;
  c.fillStyle = s.color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.globalAlpha = s.tool === 'highlighter' ? 0.3 : 1;
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0].x, pts[0].y, Math.max(s.width / 2, 0.6), 0, Math.PI * 2);
    c.fill();
  } else {
    for (let i = 1; i < pts.length; i++) {
      const pAvg = ((pts[i].p ?? 0.5) + (pts[i - 1].p ?? 0.5)) / 2;
      const f = s.tool === 'highlighter' ? 1 : 0.45 + 0.9 * pAvg;
      c.lineWidth = s.width * f;
      c.beginPath();
      c.moveTo(pts[i - 1].x, pts[i - 1].y);
      c.lineTo(pts[i].x, pts[i].y);
      c.stroke();
    }
  }
  c.globalAlpha = 1;
}

// draws one page's full content into a context already scaled to page units
function drawPageContent(c, pg) {
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, PAGE_W, PAGE_H);
  const e = imgCache.get(pg.id);
  drawBackground(c, pg, e && e.loaded ? e.img : null);
  for (const s of pg.strokes) drawStroke(c, s);
}

function render() {
  if (S.dirty && S.notebook && !$('#editor').classList.contains('hidden')) {
    const r = cv.getBoundingClientRect();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    // app background
    ctx.fillStyle = '#eef1f6';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // camera transform (page units -> device px)
    ctx.setTransform(dpr * S.scale, 0, 0, dpr * S.scale, dpr * S.offsetX, dpr * S.offsetY);
    // page shadow + sheet
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 14 / S.scale;
    ctx.shadowOffsetY = 6 / S.scale;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.restore();
    // clip to page, draw content
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, PAGE_W, PAGE_H);
    ctx.clip();
    drawBackground(ctx, page(), pageImage(page()));
    for (const s of page().strokes) drawStroke(ctx, s);
    if (S.drawing) drawStroke(ctx, S.drawing);
    // selection highlight
    if (S.selection) {
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#2566c8';
      const b = S.selection.bbox;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#2566c8'; ctx.lineWidth = 1.5 / S.scale;
      ctx.setLineDash([8 / S.scale, 6 / S.scale]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
    }
    // lasso in progress
    if (S.lassoPath && S.lassoPath.length > 1) {
      ctx.strokeStyle = '#2566c8'; ctx.lineWidth = 1.5 / S.scale;
      ctx.setLineDash([8 / S.scale, 6 / S.scale]);
      ctx.beginPath();
      ctx.moveTo(S.lassoPath[0].x, S.lassoPath[0].y);
      for (const p of S.lassoPath) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    S.dirty = false;
  }
  requestAnimationFrame(render);
}

// ---- selection ---------------------------------------------------------------
function clearSelection() { S.selection = null; S.lassoPath = null; mark(); }

function finishLasso() {
  const poly = S.lassoPath;
  S.lassoPath = null;
  if (!poly || poly.length < 3) { mark(); return; }
  const hits = page().strokes.filter((s) => s.points.some((p) => pointInPoly(p, poly)));
  if (hits.length) S.selection = { strokes: hits, bbox: strokeBBox(hits) };
  else S.selection = null;
  mark();
}

// ---- pointer input -----------------------------------------------------------
function pressureOf(e) {
  if (e.pointerType === 'pen' && e.pressure > 0) return e.pressure;
  return 0.5;
}
function isDrawPointer(e) {
  if (e.pointerType === 'pen' || e.pointerType === 'mouse') return true;
  if (e.pointerType === 'touch') return S.fingerDraw && S.touch.size === 1;
  return false;
}

function onDown(e) {
  try { cv.setPointerCapture(e.pointerId); } catch (_) { /* non-fatal */ }
  if (e.pointerType === 'touch') {
    S.touch.set(e.pointerId, cssPt(e));
    setGestureRef();
    // a touch ends any pen drawing safety
  }
  if (!isDrawPointer(e)) { mark(); return; }
  const p = toPage(...cssArr(e));

  if (S.tool === 'lasso') {
    if (S.selection && p.x >= S.selection.bbox.x && p.x <= S.selection.bbox.x + S.selection.bbox.w &&
        p.y >= S.selection.bbox.y && p.y <= S.selection.bbox.y + S.selection.bbox.h) {
      beginAction();
      S.moving = { lastX: p.x, lastY: p.y };
    } else {
      clearSelection();
      S.lassoPath = [p];
    }
    return;
  }
  if (S.tool === 'eraser') {
    beginAction();
    eraseAt(p);
    S.drawing = { eraser: true };  // flag active erase
    return;
  }
  // pen / highlighter
  beginAction();
  S.drawing = { tool: S.tool, color: S.color, width: S.width, points: [{ x: p.x, y: p.y, p: pressureOf(e) }] };
  mark();
}

function onMove(e) {
  if (e.pointerType === 'touch') {
    if (S.touch.has(e.pointerId)) S.touch.set(e.pointerId, cssPt(e));
    if (!S.fingerDraw || S.touch.size > 1) { handleGesture(); return; }
  }
  if (S.moving) {
    const p = toPage(...cssArr(e));
    const dx = p.x - S.moving.lastX, dy = p.y - S.moving.lastY;
    for (const s of S.selection.strokes) for (const pt of s.points) { pt.x += dx; pt.y += dy; }
    S.selection.bbox = strokeBBox(S.selection.strokes);
    S.moving.lastX = p.x; S.moving.lastY = p.y;
    mark(); return;
  }
  if (S.lassoPath) { S.lassoPath.push(toPage(...cssArr(e))); mark(); return; }
  if (S.drawing && S.drawing.eraser) { eraseAt(toPage(...cssArr(e))); return; }
  if (S.drawing) {
    const p = toPage(...cssArr(e));
    S.drawing.points.push({ x: p.x, y: p.y, p: pressureOf(e) });
    mark();
  }
}

function onUp(e) {
  if (e.pointerType === 'touch') {
    S.touch.delete(e.pointerId);
    setGestureRef();
  }
  if (S.moving) { S.moving = null; commitAction(); return; }
  if (S.lassoPath) { finishLasso(); return; }
  if (S.drawing && S.drawing.eraser) { S.drawing = null; commitAction(); return; }
  if (S.drawing) {
    if (S.drawing.points.length) page().strokes.push(S.drawing);
    S.drawing = null;
    commitAction();
    mark();
  }
}

function eraseAt(p) {
  const r = (S.width + 14);
  const r2 = r * r;
  const before = page().strokes.length;
  page().strokes = page().strokes.filter((s) => !s.points.some((q) => dist2(q, p) < r2));
  if (page().strokes.length !== before) mark();
}

const cssPt = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const cssArr = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

// ---- multi-touch pan / zoom --------------------------------------------------
function setGestureRef() {
  const pts = [...S.touch.values()];
  if (pts.length >= 2) {
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    S.gref = { mode: 2, dist: d, mid, scale: S.scale,
      pageMid: { x: (mid.x - S.offsetX) / S.scale, y: (mid.y - S.offsetY) / S.scale } };
  } else if (pts.length === 1) {
    S.gref = { mode: 1, start: { ...pts[0] }, offX: S.offsetX, offY: S.offsetY };
  } else S.gref = null;
}
function handleGesture() {
  const pts = [...S.touch.values()];
  if (!S.gref) return;
  if (S.gref.mode === 2 && pts.length >= 2) {
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const ns = Math.max(0.08, Math.min(8, S.gref.scale * (d / S.gref.dist)));
    S.scale = ns;
    S.offsetX = mid.x - S.gref.pageMid.x * ns;
    S.offsetY = mid.y - S.gref.pageMid.y * ns;
    mark();
  } else if (S.gref.mode === 1 && pts.length === 1) {
    S.offsetX = S.gref.offX + (pts[0].x - S.gref.start.x);
    S.offsetY = S.gref.offY + (pts[0].y - S.gref.start.y);
    mark();
  }
}

// trackpad / wheel zoom on desktop
function onWheel(e) {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  const pageX = (cx - S.offsetX) / S.scale, pageY = (cy - S.offsetY) / S.scale;
  if (e.ctrlKey || e.metaKey) {
    const ns = Math.max(0.08, Math.min(8, S.scale * (1 - e.deltaY * 0.01)));
    S.scale = ns;
    S.offsetX = cx - pageX * ns; S.offsetY = cy - pageY * ns;
  } else {
    S.offsetX -= e.deltaX; S.offsetY -= e.deltaY;
  }
  mark();
}

// ---- export ------------------------------------------------------------------
function renderPageToCanvas(pg, sf = 2) {
  const oc = document.createElement('canvas');
  oc.width = PAGE_W * sf; oc.height = PAGE_H * sf;
  const c = oc.getContext('2d');
  c.scale(sf, sf);
  drawPageContent(c, pg);
  return oc;
}
function exportPNG() {
  const oc = renderPageToCanvas(page(), 2);
  oc.toBlob((blob) => downloadBlob(blob, `${S.notebook.title}-p${S.pageIndex + 1}.png`));
}
async function exportPDF() {
  if (!window.jspdf) { alert('PDF library not loaded (need internet on first use).'); return; }
  await ensureImagesLoaded();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  S.notebook.pages.forEach((pg, i) => {
    const oc = renderPageToCanvas(pg, 2);
    if (i > 0) pdf.addPage();
    pdf.addImage(oc.toDataURL('image/png'), 'PNG', 0, 0, W, H);
  });
  pdf.save(`${S.notebook.title}.pdf`);
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---- PDF import (past papers -> annotatable pages) ---------------------------
function busy(on, msg) {
  const el = $('#busy');
  el.querySelector('.busy-msg').textContent = msg || 'Working…';
  el.classList.toggle('hidden', !on);
}
function withTimeout(promise, ms, label) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + ' timed out')), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}
async function renderPdfToPages(arrayBuffer) {
  if (!window.pdfjsLib) throw new Error('PDF engine not loaded.');
  const pdf = await withTimeout(pdfjsLib.getDocument({ data: arrayBuffer }).promise, 20000, 'Opening PDF');
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    busy(true, `Importing PDF — page ${i} of ${pdf.numPages}…`);
    const pg = await pdf.getPage(i);
    const base = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: 1500 / base.width });   // ~1500px wide = crisp
    const oc = document.createElement('canvas');
    oc.width = Math.round(vp.width); oc.height = Math.round(vp.height);
    const task = pg.render({ canvasContext: oc.getContext('2d'), viewport: vp });
    await withTimeout(task.promise, 30000, `Rendering page ${i}`).catch((e) => { try { task.cancel(); } catch (_) {} throw e; });
    pages.push({ id: uid(), paper: 'plain', background: { type: 'image', data: oc.toDataURL('image/jpeg', 0.9) }, strokes: [] });
  }
  return pages;
}
async function insertPdfIntoNotebook(file) {
  try {
    busy(true, 'Reading PDF…');
    const pages = await renderPdfToPages(await file.arrayBuffer());
    S.notebook.pages.splice(S.pageIndex + 1, 0, ...pages);
    S.pageIndex += 1;
    S.undo = []; S.redo = []; clearSelection();
    updatePageLabel(); persist(); mark();
  } catch (e) { alert('Could not import PDF: ' + e.message); }
  finally { busy(false); }
}
async function importPdfAsNotebook(file) {
  try {
    busy(true, 'Reading PDF…');
    const pages = await renderPdfToPages(await file.arrayBuffer());
    const nb = newNotebook(file.name.replace(/\.pdf$/i, ''));
    nb.pages = pages.length ? pages : [newPage()];
    await saveNotebook(nb);
    busy(false);
    openNotebook(nb.id);
  } catch (e) { busy(false); alert('Could not import PDF: ' + e.message); }
}

// ---- UI: library <-> editor --------------------------------------------------
function show(view) {
  $('#library').classList.toggle('hidden', view !== 'library');
  $('#editor').classList.toggle('hidden', view !== 'editor');
}

async function renderLibrary() {
  const list = $('#nb-list');
  list.innerHTML = '';
  const nbs = (await getAllNotebooks()).sort((a, b) => b.updated - a.updated);
  if (!nbs.length) {
    list.innerHTML = '<p class="muted">No lessons yet. Create your first notebook.</p>';
  }
  for (const nb of nbs) {
    const card = document.createElement('div');
    card.className = 'nb-card';
    card.innerHTML = `<div class="nb-title">${escapeHtml(nb.title)}</div>
      <div class="nb-meta">${nb.pages.length} page${nb.pages.length > 1 ? 's' : ''} · ${new Date(nb.updated).toLocaleDateString()}</div>
      <div class="nb-actions">
        <button class="open">Open</button>
        <button class="ren">Rename</button>
        <button class="del danger">Delete</button>
      </div>`;
    card.querySelector('.open').onclick = () => openNotebook(nb.id);
    card.querySelector('.ren').onclick = async () => {
      const t = prompt('Rename lesson', nb.title);
      if (t) { nb.title = t.trim(); await saveNotebook(nb); renderLibrary(); }
    };
    card.querySelector('.del').onclick = async () => {
      if (confirm(`Delete "${nb.title}"? This cannot be undone.`)) { await deleteNotebook(nb.id); renderLibrary(); }
    };
    list.appendChild(card);
  }
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function openNotebook(id) {
  S.notebook = await getNotebook(id);
  if (!S.notebook) return;
  S.pageIndex = 0; S.undo = []; S.redo = []; clearSelection();
  show('editor');
  requestAnimationFrame(() => { resizeCanvas(); fitPage(); updatePageLabel(); updateTitle(); });
}

async function createNotebook() {
  const t = prompt('New lesson name', 'Vectors — Lesson 1');
  if (t === null) return;
  const nb = newNotebook(t.trim() || 'Untitled lesson');
  await saveNotebook(nb);
  openNotebook(nb.id);
}

// ---- editor controls ---------------------------------------------------------
function updatePageLabel() { $('#page-label').textContent = `${S.pageIndex + 1} / ${S.notebook.pages.length}`; }
function updateTitle() { $('#nb-name').value = S.notebook.title; }

function setTool(t) {
  S.tool = t;
  if (t !== 'lasso') clearSelection();
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
}

function bindEditor() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));

  const sw = $('#swatches');
  COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (i === 0 ? ' active' : '');
    b.style.background = c;
    b.onclick = () => {
      S.color = c;
      document.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    };
    sw.appendChild(b);
  });

  $('#width').oninput = (e) => { S.width = +e.target.value; $('#width-val').textContent = e.target.value; };
  $('#undo').onclick = doUndo;
  $('#redo').onclick = doRedo;
  $('#fit').onclick = fitPage;
  $('#finger').onchange = (e) => { S.fingerDraw = e.target.checked; };

  $('#prev').onclick = () => { if (S.pageIndex > 0) { S.pageIndex--; S.undo = []; S.redo = []; clearSelection(); updatePageLabel(); mark(); } };
  $('#next').onclick = () => { if (S.pageIndex < S.notebook.pages.length - 1) { S.pageIndex++; S.undo = []; S.redo = []; clearSelection(); updatePageLabel(); mark(); } };
  $('#addpage').onclick = () => {
    const paper = $('#paper').value;
    S.notebook.pages.splice(S.pageIndex + 1, 0, newPage(paper));
    S.pageIndex++; S.undo = []; S.redo = []; clearSelection();
    updatePageLabel(); persist(); mark();
  };
  $('#paper').onchange = (e) => { page().paper = e.target.value; persist(); mark(); };

  // branding overlay (remembers on/off across sessions)
  const brandOn = localStorage.getItem('mb-brand') !== 'off';
  const applyBrand = (on) => {
    $('#brand').classList.toggle('hidden', !on);
    $('#brand-toggle').classList.toggle('brand-toggle-active', on);
    localStorage.setItem('mb-brand', on ? 'on' : 'off');
  };
  applyBrand(brandOn);
  $('#brand-toggle').onclick = () => applyBrand($('#brand').classList.contains('hidden'));

  $('#export-pdf').onclick = exportPDF;
  $('#export-png').onclick = exportPNG;
  $('#insert-pdf').onclick = () => $('#pdf-file').click();
  $('#pdf-file').onchange = (e) => { const f = e.target.files[0]; if (f) insertPdfIntoNotebook(f); e.target.value = ''; };
  $('#back').onclick = () => { show('library'); renderLibrary(); };

  $('#nb-name').onchange = (e) => { S.notebook.title = e.target.value.trim() || 'Untitled lesson'; persist(); };

  // keyboard shortcuts (desktop)
  window.addEventListener('keydown', (e) => {
    if ($('#editor').classList.contains('hidden')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
    else if (e.key === 'p') setTool('pen');
    else if (e.key === 'h') setTool('highlighter');
    else if (e.key === 'e') setTool('eraser');
    else if (e.key === 'l') setTool('lasso');
  });
}

function bindCanvas() {
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch') { S.touch.delete(e.pointerId); setGestureRef(); } });
  cv.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', resizeCanvas);
}

// ---- boot --------------------------------------------------------------------
function init() {
  cv = $('#board');
  ctx = cv.getContext('2d');
  bindEditor();
  bindCanvas();
  $('#new-nb').onclick = createNotebook;
  $('#import-pdf-lib').onclick = () => $('#pdf-file-lib').click();
  $('#pdf-file-lib').onchange = (e) => { const f = e.target.files[0]; if (f) importPdfAsNotebook(f); e.target.value = ''; };
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  }
  show('library');
  renderLibrary();
  requestAnimationFrame(render);

  // Service worker (offline PWA). Disabled on localhost to avoid stale-cache
  // surprises during development; enabled when served from a real host/LAN IP.
  const devHost = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !devHost) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
