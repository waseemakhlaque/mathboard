// MathBoard — a pencil-first notebook whiteboard for A-level maths.
// Copyright © 2026 Waseem Akhlaque. MIT License (see LICENSE).
//
// app.js — paginated notebook whiteboard.
// Vanilla JS, Canvas 2D. Strokes are stored in page units (PAGE_W x PAGE_H) so
// pan/zoom never distorts saved ink. One page is shown at a time.

import { notebookKind, normalizeNotebook, allPages } from './model.js';
import {
  downloadBlob, exportNotebookJSON, importNotebookFromFile, shareNotebook,
  onSyncStatus, getPortalAPI, sync, getSyncBaseUrl, setSyncBaseUrl,
  syncAllToRemote, pullRemoteCatalog,
} from './share.js';
import {
  setupGeo, setGeoTool, syncGeoLayer, loadGeoPage, teardownGeo, clearGeoPage,
  restoreGeoItems, drawGeoSvgToCanvas, geoToolActive, flushGeo,
} from './geo.js';
import {
  setupMech, setupMechPanel, drawMechItems, handleMechClick, setMechPlacing,
} from './mech.js';
import {
  setupCplx, setupCplxPanel, drawCplxLoci, handleCplxClick, setCplxPlacing,
} from './cplx.js';
import {
  setupInstruments, setInstTool, instToolActive, handleInstClick, drawInstruments,
} from './instruments.js';
import {
  setupCalculus, setupCalculusPanel, drawCalcItems, clearCalcPage,
} from './calculus.js';
import { getAllNotebooks, getNotebook, saveNotebook, deleteNotebook } from './storage.js';

// ---- constants ---------------------------------------------------------------
const PAGE_W = 1000;          // page units (A4 portrait ratio ~ 1.414)
const PAGE_H = 1414;
const PAPERS = ['plain', 'squared', 'graph', 'dotted', 'lined', 'cornell', 'argand', 'vectorgrid', 'axes'];
const COLORS = ['#1b1b1b', '#2566c8', '#d23b3b', '#1f9d57', '#e0892a', '#8a4fd0'];
const PEN_WIDTHS = { fine: 4, marker: 10, calligraphy: 6 };
const UNDO_CAP = 60;
const UNIT = 50;              // page units per "1" on the grid — vectors snap to this
const FORCE_SCALE = 32;       // page units (px) per 1 N for the live force-vector primitive
const GRID_PAPERS = ['argand', 'vectorgrid', 'axes'];   // papers where vectors snap to integer points

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---- application state -------------------------------------------------------
const S = {
  notebook: null,           // current notebook object
  sectionIndex: 0,
  pageIndex: 0,
  tool: 'pen',              // pen | highlighter | eraser | lasso
  penType: 'fine',          // fine | marker | calligraphy (pen tool only)
  color: COLORS[0],
  width: 4,                 // page units
  fingerDraw: false,
  // camera (css px): screenCss = page*scale + offset
  scale: 1, offsetX: 0, offsetY: 0,
  // interaction
  drawing: null,            // active stroke being drawn
  creating: null,           // active math object (vector / line) being drawn
  snap: true,               // snap vector endpoints to grid
  radians: false,           // angle display: radians vs degrees
  polar: false,             // complex numbers shown in polar (r∠θ) vs Cartesian (a+bi)
  editingId: null,          // id of text object currently being edited (hidden on canvas)
  actionBefore: null,       // page snapshot taken at action start (for undo)
  undo: [], redo: [],
  lassoPath: null,          // points (page units) of in-progress lasso
  selection: null,          // { strokes:[refs], bbox:{x,y,w,h} }
  moving: null,             // { lastX, lastY }
  selObj: null,             // selected math object/shape/text (Select tool)
  selStrokes: [],           // ink strokes selected by Select tool
  objMove: null,            // { lastX, lastY } — dragging selection body
  objResize: null,          // handle name — dragging a selected object's handle
  // multi-touch gesture
  touch: new Map(),         // pointerId -> {x,y} css
  gref: null,
  dirty: true,
  // live demo animation engine (Module 1)
  playing: false,           // demo bar Play/Pause state
  demoT: 0,                 // normalized parameter 0..1 that animated objects read
  demoPeriod: 5,            // seconds for one full sweep when playing
  demoLast: 0,              // last rAF timestamp (ms)
};

let cv, ctx, dpr = 1;

// ---- helpers -----------------------------------------------------------------
function sections() {
  if (!S.notebook?.sections?.length) normalizeNotebook(S.notebook);
  return S.notebook.sections;
}
function pages() { return sections()[S.sectionIndex].pages; }
const page = () => pages()[S.pageIndex];
const objs = () => { const p = page(); if (!p.objects) p.objects = []; return p.objects; };  // math objects (vectors/lines)
const fns = () => { const p = page(); if (!p.functions) p.functions = []; return p.functions; };  // graphed y=f(x)
const clone = (o) => JSON.parse(JSON.stringify(o));
const $ = (sel) => document.querySelector(sel);

function toPage(cssX, cssY) {
  return { x: (cssX - S.offsetX) / S.scale, y: (cssY - S.offsetY) / S.scale };
}

function newPage(paper = 'graph') {
  return { id: uid(), paper, strokes: [], objects: [], instruments: [] };
}

function newNotebook(title, kind = 'lesson') {
  const t = Date.now();
  return {
    id: uid(), title: title || 'Untitled lesson', kind, created: t, updated: t,
    sections: [{ id: uid(), title: 'Section 1', pages: [newPage()] }],
  };
}
function pageIsPdf(pg) { return !!(pg.background && pg.background.type === 'image'); }

// ---- persistence (debounced) -------------------------------------------------
let saveTimer = null;
function persist() {
  if (!S.notebook) return;
  S.notebook.updated = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => sync.push(clone(S.notebook)), 400);
}

// ---- undo / redo (full page snapshot: ink, objects, grapher, flags, paper) ---
function snapshotPage() {
  flushGeo();
  const p = page();
  return {
    strokes: clone(p.strokes),
    objects: clone(objs()),
    functions: clone(p.functions || []),
    showResultant: !!p.showResultant,
    showConjugate: !!p.showConjugate,
    showParallelogram: !!p.showParallelogram,
    paper: p.paper,
    background: p.background ? clone(p.background) : null,
    geoItems: clone(p.geoItems || []),
    geoConstructs: clone(p.geoConstructs || []),
    geoLabelN: p.geoLabelN || 0,
    mechItems: clone(p.mechItems || []),
    cplxLoci: clone(p.cplxLoci || []),
    calcItems: clone(p.calcItems || []),
    instruments: clone(p.instruments || []),
  };
}
function restorePage(s) {
  const p = page();
  p.strokes = clone(s.strokes);
  p.objects = clone(s.objects);
  p.functions = clone(s.functions || []);
  p.showResultant = !!s.showResultant;
  p.showConjugate = !!s.showConjugate;
  p.showParallelogram = !!s.showParallelogram;
  p.paper = s.paper;
  const bgChanged = JSON.stringify(p.background || null) !== JSON.stringify(s.background || null);
  if (s.background) p.background = clone(s.background);
  else delete p.background;
  if (bgChanged) imgCache.delete(p.id);
  thumbCache.delete(p.id);
  p.geoItems = clone(s.geoItems || []);
  p.geoConstructs = clone(s.geoConstructs || []);
  p.geoLabelN = s.geoLabelN || 0;
  p.mechItems = clone(s.mechItems || []);
  p.cplxLoci = clone(s.cplxLoci || []);
  p.calcItems = clone(s.calcItems || []);
  p.instruments = clone(s.instruments || []);
  restoreGeoItems(p.geoItems);
  updatePageLabel();
  if (!$('#graph').classList.contains('hidden')) renderGraphList();
}
function beginAction() { S.actionBefore = snapshotPage(); }
function commitAction() {
  if (!S.actionBefore) return;
  if (JSON.stringify(S.actionBefore) !== JSON.stringify(snapshotPage())) {
    S.undo.push(S.actionBefore);
    if (S.undo.length > UNDO_CAP) S.undo.shift();
    S.redo = [];
    thumbCache.delete(page().id);
    persist();
  }
  S.actionBefore = null;
}
function doUndo() {
  if (!S.undo.length) return;
  S.redo.push(snapshotPage());
  restorePage(S.undo.pop());
  clearSelection(); mark(); persist();
}
function doRedo() {
  if (!S.redo.length) return;
  S.undo.push(snapshotPage());
  restorePage(S.redo.pop());
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
  if (r.width < 2 || r.height < 2) return;   // ignore transient zero-size during layout
  dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  // keep the page fitted & centred so it can never drift off-screen on resize
  if (S.notebook && !$('#editor').classList.contains('hidden')) fitPage();
  else mark();
}

function fitPage() {
  const r = cv.getBoundingClientRect();
  const present = $('#editor')?.classList.contains('present-mode');
  const m = present ? 10 : 24;
  S.scale = Math.min((r.width - m) / PAGE_W, (r.height - m) / PAGE_H);
  S.offsetX = (r.width - PAGE_W * S.scale) / 2;
  S.offsetY = (r.height - PAGE_H * S.scale) / 2;
  mark();
}

// page strip thumbnails (blank pages rendered; PDF pages use background JPEG)
const thumbCache = new Map(); // pageId -> data URL
const THUMB_W = 56, THUMB_H = 79;
function makePageThumbUrl(pg) {
  let url = thumbCache.get(pg.id);
  if (url) return url;
  const oc = document.createElement('canvas');
  oc.width = THUMB_W; oc.height = THUMB_H;
  const c = oc.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, THUMB_W, THUMB_H);
  const sf = THUMB_W / PAGE_W;
  c.scale(sf, sf);
  drawTemplate(c, pg.paper);
  for (const s of pg.strokes) drawStroke(c, s);
  url = oc.toDataURL('image/jpeg', 0.72);
  thumbCache.set(pg.id, url);
  return url;
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
// inserted diagram/photo objects (movable, not page background)
const objImgCache = new Map(); // object id -> { img, loaded }
function objImage(o) {
  if (o.kind !== 'image' || !o.data) return null;
  let e = objImgCache.get(o.id);
  if (!e) {
    const img = new Image();
    e = { img, loaded: false };
    objImgCache.set(o.id, e);
    img.onload = () => { e.loaded = true; mark(); };
    img.onerror = () => { e.loaded = true; mark(); };
    img.src = o.data;
  }
  return e.loaded ? e.img : null;
}
function purgeObjImage(id) { objImgCache.delete(id); }
function ensureObjImagesLoaded() {
  const list = [];
  if (!S.notebook) return Promise.resolve();
  for (const pg of allPages(S.notebook)) {
    for (const o of (pg.objects || [])) if (o.kind === 'image' && o.data) list.push(o);
  }
  return Promise.all(list.map((o) => new Promise((res) => {
    const e = objImgCache.get(o.id);
    if (e && e.loaded) return res();
    const img = new Image();
    img.onload = () => { objImgCache.set(o.id, { img, loaded: true }); res(); };
    img.onerror = () => res();
    img.src = o.data;
  })));
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
  const pend = allPages(S.notebook).filter((p) => p.background && p.background.type === 'image');
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
  else if (paper === 'dotted') {
    c.fillStyle = mid;
    for (let x = 40; x < PAGE_W; x += 40) for (let y = 40; y < PAGE_H; y += 40) { c.beginPath(); c.arc(x, y, 1.7, 0, Math.PI * 2); c.fill(); }
  } else if (paper === 'lined') {
    for (let y = 64; y < PAGE_H; y += 48) line(0, y, PAGE_W, y, faint, 1);
    line(86, 0, 86, PAGE_H, '#edc1c1', 1.5);
  } else if (paper === 'cornell') {
    for (let y = 80; y < PAGE_H; y += 56) line(0, y, PAGE_W, y, faint, 1);
    line(240, 0, 240, PAGE_H, mid, 1.5);
  } else if (paper === 'argand' || paper === 'vectorgrid' || paper === 'axes') {
    const cx = PAGE_W / 2, cy = PAGE_H / 2, g = UNIT;
    for (let x = cx % g; x < PAGE_W; x += g) line(x, 0, x, PAGE_H, faint, 1);
    for (let y = cy % g; y < PAGE_H; y += g) line(0, y, PAGE_W, y, faint, 1);
    line(0, cy, PAGE_W, cy, axis, 2);            // x-axis (sits on a grid line)
    line(cx, 0, cx, PAGE_H, axis, 2);            // y-axis
    if (paper === 'argand') {
      c.fillStyle = axis; c.font = '24px sans-serif';
      c.fillText('Re', PAGE_W - 56, cy - 12);
      c.fillText('Im', cx + 12, 32);
    } else if (paper === 'axes') {
      c.fillStyle = axis; c.font = '16px sans-serif'; c.textAlign = 'center';
      for (let n = 1; cx + n * g < PAGE_W; n++) c.fillText(String(n), cx + n * g, cy + 18);
      for (let n = 1; cx - n * g > 0; n++) c.fillText(String(-n), cx - n * g, cy + 18);
      for (let n = 1; cy + n * g < PAGE_H; n++) c.fillText(String(-n), cx - 16, cy + n * g + 5);
      for (let n = 1; cy - n * g > 0; n++) c.fillText(String(n), cx - 16, cy - n * g + 5);
      c.textAlign = 'start'; c.font = '22px sans-serif';
      c.fillText('x', PAGE_W - 22, cy - 10); c.fillText('y', cx + 10, 26);
    }
  }
}

function inkWidth(s, pt, prev) {
  const w = s.width;
  if (s.tool === 'highlighter') return w;
  if (s.penType === 'marker') return w * 2.2;
  if (s.penType === 'calligraphy' && prev) {
    const ang = Math.atan2(pt.y - prev.y, pt.x - prev.x);
    return w * (0.3 + 1.35 * Math.abs(Math.cos(ang - 0.785)));
  }
  return w * (0.45 + 0.9 * (pt.p ?? 0.5));
}

function drawStroke(c, s) {
  const pts = s.points;
  const hl = s.tool === 'highlighter';
  c.strokeStyle = s.color;
  c.fillStyle = s.color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.globalAlpha = hl ? 0.3 : 1;
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0].x, pts[0].y, Math.max(inkWidth(s, pts[0], null) / 2, 0.6), 0, Math.PI * 2);
    c.fill();
  } else if (pts.length === 2) {
    c.lineWidth = inkWidth(s, pts[1], pts[0]);
    c.beginPath(); c.moveTo(pts[0].x, pts[0].y); c.lineTo(pts[1].x, pts[1].y); c.stroke();
  } else {
    // smooth: quadratic curves through the midpoints of consecutive samples
    for (let i = 1; i < pts.length - 1; i++) {
      const p1 = pts[i], p0 = pts[i - 1], p2 = pts[i + 1];
      const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      c.lineWidth = inkWidth(s, p1, p0);
      c.beginPath();
      c.moveTo(m1.x, m1.y);
      c.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y);
      c.stroke();
    }
  }
  c.globalAlpha = 1;
}

// ---- math objects: vectors & lines ------------------------------------------
const fmt = (n) => Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
const formatAngle = (rad) => S.radians ? `${rad.toFixed(2)} rad` : `${Math.round(rad * 180 / Math.PI)}°`;
function vecInfo(o) {
  const dx = (o.to.x - o.from.x) / UNIT, dy = (o.from.y - o.to.y) / UNIT;   // y up = positive
  return { dx, dy, mag: Math.hypot(dx, dy), angRad: Math.atan2(dy, dx) };
}
function complexInfo(o) {                          // a + bi from page point, origin at page centre
  const a = (o.at.x - PAGE_W / 2) / UNIT, b = (PAGE_H / 2 - o.at.y) / UNIT;
  return { a, b, mod: Math.hypot(a, b), argRad: Math.atan2(b, a) };
}
function drawArrow(c, a, b, col, dashed) {
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 3.5; c.lineCap = 'round'; c.lineJoin = 'round';
  if (dashed) c.setLineDash([14, 10]);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  c.setLineDash([]);
  const ang = Math.atan2(b.y - a.y, b.x - a.x), h = 22;
  if (Math.hypot(b.x - a.x, b.y - a.y) < 4) return;
  c.beginPath(); c.moveTo(b.x, b.y);
  c.lineTo(b.x - h * Math.cos(ang - 0.4), b.y - h * Math.sin(ang - 0.4));
  c.lineTo(b.x - h * Math.cos(ang + 0.4), b.y - h * Math.sin(ang + 0.4));
  c.closePath(); c.fill();
}
function drawComplex(c, o, col) {
  const cx = PAGE_W / 2, cy = PAGE_H / 2, z = complexInfo(o);
  c.strokeStyle = col; c.lineWidth = 2; c.setLineDash([]);
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(o.at.x, o.at.y); c.stroke();   // position line
  c.fillStyle = col; c.beginPath(); c.arc(o.at.x, o.at.y, 7, 0, Math.PI * 2); c.fill();
  if (page().showConjugate) {
    const px = cx + z.a * UNIT, py = cy + z.b * UNIT;                      // reflect in real axis
    c.setLineDash([6, 6]); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(px, py); c.stroke(); c.setLineDash([]);
    c.lineWidth = 2; c.beginPath(); c.arc(px, py, 6, 0, Math.PI * 2); c.stroke();
    c.font = '20px sans-serif'; c.fillText('z̄', px + 10, py + 6);
  }
  const lx = o.at.x + 12, ly = o.at.y - 10;
  const tag = o.ctag ? `${o.ctag} = ` : 'z = ';
  c.fillStyle = col; c.font = '600 24px sans-serif';
  if (S.polar) c.fillText(`${tag}${z.mod.toFixed(2)} ∠ ${formatAngle(z.argRad)}`, lx, ly);
  else c.fillText(`${tag}${fmt(z.a)} ${z.b < 0 ? '−' : '+'} ${fmt(Math.abs(z.b))}i`, lx, ly);
  if (o.omega) {
    c.font = '16px sans-serif';
    const ow = o.omega;
    c.fillText(`ω = ${fmt(ow.re)} ${ow.im < 0 ? '−' : '+'} ${fmt(Math.abs(ow.im))}i`, lx, ly + 48);
  }
  c.font = '18px sans-serif';
  c.fillText(`|z| = ${z.mod.toFixed(2)}   arg ${formatAngle(z.argRad)}`, lx, ly + (o.omega ? 70 : 24));
}
// animated tracer: a point sweeping a circular path, driven by S.demoT (Module 1 demo primitive)
function drawTracer(c, o) {
  const col = o.color || '#2566c8';
  const r = Math.hypot(o.edge.x - o.center.x, o.edge.y - o.center.y);
  c.strokeStyle = col; c.globalAlpha = 0.35; c.lineWidth = 1.5; c.setLineDash([6, 6]);
  c.beginPath(); c.arc(o.center.x, o.center.y, r, 0, Math.PI * 2); c.stroke();
  c.setLineDash([]); c.globalAlpha = 1;
  const ang = S.demoT * Math.PI * 2;
  const px = o.center.x + Math.cos(ang) * r, py = o.center.y - Math.sin(ang) * r;
  c.strokeStyle = col; c.lineWidth = 2;
  c.beginPath(); c.moveTo(o.center.x, o.center.y); c.lineTo(px, py); c.stroke();
  c.fillStyle = col; c.beginPath(); c.arc(px, py, 7, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
  if (o.label) { c.fillStyle = col; c.font = '600 18px sans-serif'; c.fillText(o.label, px + 10, py - 8); }
}
// live force vector with auto-resolved horizontal/vertical components (Module 2).
// liveAngle = base angleDeg (+ demoT sweep when o.anim) so it can be dragged AND animated.
function forceLiveAngle(o) { return (o.angleDeg || 0) + (o.anim ? S.demoT * 360 : 0); }
function compArrow(c, a, b, col) {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 2) return;
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2; c.setLineDash([8, 6]);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
  const ang = Math.atan2(b.y - a.y, b.x - a.x), h = 12;
  c.beginPath(); c.moveTo(b.x, b.y);
  c.lineTo(b.x - h * Math.cos(ang - 0.4), b.y - h * Math.sin(ang - 0.4));
  c.lineTo(b.x - h * Math.cos(ang + 0.4), b.y - h * Math.sin(ang + 0.4));
  c.closePath(); c.fill();
}
function forceTip(o) {
  const th = forceLiveAngle(o) * Math.PI / 180;
  return { x: o.at.x + o.mag * Math.cos(th) * FORCE_SCALE, y: o.at.y - o.mag * Math.sin(th) * FORCE_SCALE };
}
function drawForceVec(c, o) {
  const col = o.color || '#d23b3b';
  const th = forceLiveAngle(o) * Math.PI / 180;
  const Fx = o.mag * Math.cos(th), Fy = o.mag * Math.sin(th);
  const tip = forceTip(o), corner = { x: tip.x, y: o.at.y };
  compArrow(c, o.at, corner, '#1f9d57');         // horizontal component Fx
  compArrow(c, corner, tip, '#2566c8');          // vertical component Fy
  // right-angle marker at the corner
  if (Math.abs(Fx) > 0.05 && Math.abs(Fy) > 0.05) {
    const dx = Math.sign(o.at.x - corner.x) * 12, dy = Math.sign(tip.y - corner.y) * 12;
    c.strokeStyle = '#88929c'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(corner.x + dx, corner.y); c.lineTo(corner.x + dx, corner.y + dy); c.lineTo(corner.x, corner.y + dy); c.stroke();
  }
  drawArrow(c, o.at, tip, col, false);            // the force itself
  c.fillStyle = '#1b1b1b'; c.beginPath(); c.arc(o.at.x, o.at.y, 4, 0, Math.PI * 2); c.fill();
  const degs = Math.round((forceLiveAngle(o) % 360 + 360) % 360);
  c.font = '600 17px sans-serif'; c.fillStyle = col;
  c.fillText(`F = ${fmt(o.mag)} N  @ ${degs}°`, tip.x + 10, tip.y - 6);
  c.font = '14px sans-serif';
  c.fillStyle = '#1f9d57'; c.fillText(`Fx = ${fmt(Fx)}`, (o.at.x + corner.x) / 2 - 24, o.at.y + (Fy >= 0 ? 20 : -8));
  c.fillStyle = '#2566c8'; c.fillText(`Fy = ${fmt(Fy)}`, corner.x + 8, (corner.y + tip.y) / 2);
}
// labelled arrow used by the live mechanics primitives
function labeledArrow(c, a, b, col, dashed, lab) {
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = dashed ? 2 : 3; c.setLineDash(dashed ? [8, 6] : []);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
  if (Math.hypot(b.x - a.x, b.y - a.y) > 4) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x), h = 13;
    c.beginPath(); c.moveTo(b.x, b.y);
    c.lineTo(b.x - h * Math.cos(ang - 0.4), b.y - h * Math.sin(ang - 0.4));
    c.lineTo(b.x - h * Math.cos(ang + 0.4), b.y - h * Math.sin(ang + 0.4));
    c.closePath(); c.fill();
  }
  if (lab) { c.font = '600 14px sans-serif'; c.fillStyle = col; c.fillText(lab, b.x + 5, b.y - 4); }
}
// inclined-plane block (Module 3): drag/animate the slope angle; weight, normal, friction +
// along/perpendicular components all update live.
function inclineLiveAngle(o) {
  const base = o.anim ? (5 + S.demoT * 80) : (o.angleDeg || 30);
  return Math.max(5, Math.min(85, base));
}
function inclineGeom(o) {
  const a = o.at, B = o.base || 300, ang = inclineLiveAngle(o) * Math.PI / 180;
  const h = B * Math.tan(ang);
  return { a, B, ang, h, b: { x: a.x + B, y: a.y }, top: { x: a.x + B, y: a.y - h } };
}
function drawInclineObj(c, o) {
  const { a, ang, b, top } = inclineGeom(o);
  c.fillStyle = 'rgba(200,210,220,0.35)'; c.strokeStyle = '#5a6570'; c.lineWidth = 2.5; c.setLineDash([]);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(top.x, top.y); c.closePath(); c.fill(); c.stroke();
  c.strokeStyle = '#88929c'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(a.x - 50, a.y); c.lineTo(b.x + 40, b.y); c.stroke();
  // up-slope unit (a -> top) and outward normal (away from interior corner b)
  const hx = top.x - a.x, hy = top.y - a.y, len = Math.hypot(hx, hy) || 1;
  const ux = hx / len, uy = hy / len;
  let outx = uy, outy = -ux;                       // a perpendicular
  const mid = { x: a.x + hx * 0.5, y: a.y + hy * 0.5 };
  if ((b.x - mid.x) * outx + (b.y - mid.y) * outy > 0) { outx = -outx; outy = -outy; }
  // block on the slope
  const bw = 46, bh = 30;
  c.save(); c.translate(mid.x, mid.y); c.rotate(Math.atan2(uy, ux));
  c.fillStyle = '#c8d4e0'; c.strokeStyle = '#4a5560'; c.lineWidth = 2;
  c.fillRect(-bw / 2, -bh, bw, bh); c.strokeRect(-bw / 2, -bh, bw, bh);
  c.restore();
  const C = { x: mid.x + outx * (bh / 2 + 2), y: mid.y + outy * (bh / 2 + 2) };
  const m = o.mass || 2, g = 9.8, mg = m * g, mu = o.mu || 0, FS = 4;
  const N = mg * Math.cos(ang);
  labeledArrow(c, C, { x: C.x, y: C.y + mg * FS }, '#1f9d57', false, 'mg');                                  // weight
  labeledArrow(c, C, { x: C.x + outx * N * FS, y: C.y + outy * N * FS }, '#2566c8', false, 'N');             // normal
  labeledArrow(c, C, { x: C.x - ux * mg * Math.sin(ang) * FS, y: C.y - uy * mg * Math.sin(ang) * FS }, '#e0892a', true, 'mg sinα'); // down-slope
  labeledArrow(c, C, { x: C.x - outx * mg * Math.cos(ang) * FS, y: C.y - outy * mg * Math.cos(ang) * FS }, '#8a4fd0', true, 'mg cosα'); // into slope
  if (mu > 0) { const f = mu * N; labeledArrow(c, C, { x: C.x + ux * f * FS, y: C.y + uy * f * FS }, '#d23b3b', false, 'f'); }
  c.fillStyle = '#4a5560'; c.font = '600 16px sans-serif';
  c.fillText(`α = ${Math.round(inclineLiveAngle(o))}°   m = ${fmt(m)} kg   μ = ${fmt(mu)}`, a.x + 6, a.y - 12);
}
function drawCircle(c, o, col) {
  const r = Math.hypot(o.edge.x - o.center.x, o.edge.y - o.center.y);
  c.strokeStyle = col; c.lineWidth = 3; c.setLineDash([]);
  c.beginPath(); c.arc(o.center.x, o.center.y, r, 0, Math.PI * 2); c.stroke();
  c.fillStyle = col; c.beginPath(); c.arc(o.center.x, o.center.y, 4, 0, Math.PI * 2); c.fill();
  const a = (o.center.x - PAGE_W / 2) / UNIT, b = (PAGE_H / 2 - o.center.y) / UNIT;
  const cstr = (Math.abs(a) < 0.05 && Math.abs(b) < 0.05) ? 'z'
    : `z − (${fmt(a)} ${b < 0 ? '−' : '+'} ${fmt(Math.abs(b))}i)`;
  c.font = '18px sans-serif';
  c.fillText(`|${cstr}| = ${(r / UNIT).toFixed(2)}`, o.center.x + r + 6, o.center.y);
}
function drawText(c, o) {
  if (S.editingId === o.id) return;   // hidden on canvas while the overlay editor is open
  c.fillStyle = o.color || '#1b1b1b';
  c.font = `${o.size}px sans-serif`;
  c.textAlign = 'start'; c.textBaseline = 'top';
  (o.text || '').split('\n').forEach((ln, i) => c.fillText(ln, o.at.x, o.at.y + i * o.size * 1.25));
  c.textBaseline = 'alphabetic';
}
function textBox(o) {
  const lines = (o.text || ' ').split('\n');
  const w = Math.max(40, Math.max(...lines.map((l) => l.length)) * o.size * 0.55);
  const h = Math.max(o.size, lines.length * o.size * 1.25);
  return { w, h };
}

// ---- equation objects (LaTeX via MathLive) -----------------------------------
// Equations are stored as { kind:'equation', at:{x,y}, latex:'...', color, size }
// and rendered to canvas via an offscreen <math-field> element.
let eqRenderCache = new Map(); // latex+size -> { img, w, h }

function renderEquationToImage(latex, size) {
  const key = latex + '|' + size;
  let hit = eqRenderCache.get(key);
  if (hit) return hit;
  // Use an offscreen math-field to render LaTeX to SVG/HTML, then canvas
  const mf = document.createElement('math-field');
  mf.style.position = 'absolute'; mf.style.left = '-9999px'; mf.style.top = '-9999px';
  mf.style.fontSize = size + 'px';
  mf.value = latex;
  document.body.appendChild(mf);
  // Force layout so MathLive renders
  const rect = mf.getBoundingClientRect();
  const svg = mf.querySelector('math') || mf.querySelector('svg');
  let img = null, w = 40, h = size * 1.4;
  if (svg) {
    const ser = new XMLSerializer();
    const svgStr = ser.serializeToString(svg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); };
    img.src = url;
    // approximate dimensions from the SVG viewBox
    const vb = svg.getAttribute('viewBox');
    if (vb) {
      const parts = vb.split(/\s+/).map(Number);
      w = parts[2] || 40; h = parts[3] || size * 1.4;
    }
  } else {
    // fallback: render text approximation
    const oc = document.createElement('canvas');
    oc.width = 40; oc.height = size * 1.4;
    const cx = oc.getContext('2d');
    cx.fillStyle = '#1b1b1b'; cx.font = `${size}px serif`;
    cx.fillText(latex.replace(/\\/g, ''), 0, size);
    img = oc;
    w = oc.width; h = oc.height;
  }
  document.body.removeChild(mf);
  hit = { img, w, h };
  eqRenderCache.set(key, hit);
  return hit;
}

function drawEquation(c, o) {
  if (S.editingId === o.id) return;
  const r = renderEquationToImage(o.latex || '\\text{ }', o.size || 34);
  if (r.img && r.img.complete !== false) {
    try { c.drawImage(r.img, o.at.x, o.at.y, r.w, r.h); } catch (_) {}
  } else if (r.img && r.img.tagName === 'CANVAS') {
    c.drawImage(r.img, o.at.x, o.at.y, r.w, r.h);
  } else {
    // fallback text
    c.fillStyle = o.color || '#1b1b1b';
    c.font = `${o.size || 34}px serif`;
    c.fillText((o.latex || '').replace(/[\\{}]/g, ''), o.at.x, o.at.y + (o.size || 34));
  }
}
function equationBox(o) {
  const r = renderEquationToImage(o.latex || '\\text{ }', o.size || 34);
  return { w: r.w + 8, h: r.h + 8 };
}
function pointInEquation(o, p) {
  const b = equationBox(o);
  return p.x >= o.at.x - 4 && p.x <= o.at.x + b.w + 4 && p.y >= o.at.y - 4 && p.y <= o.at.y + b.h + 4;
}
function drawObject(c, o) {
  const col = o.color || '#1b1b1b';
  if (o.kind === 'line') {
    c.strokeStyle = col; c.lineWidth = 3; c.lineCap = 'round'; c.setLineDash([]);
    c.beginPath(); c.moveTo(o.from.x, o.from.y); c.lineTo(o.to.x, o.to.y); c.stroke();
    return;
  }
  if (o.kind === 'text') { drawText(c, o); return; }
  if (o.kind === 'equation') { drawEquation(c, o); return; }
  if (o.kind === 'rect') {
    c.strokeStyle = col; c.lineWidth = 3; c.setLineDash([]);
    c.strokeRect(Math.min(o.from.x, o.to.x), Math.min(o.from.y, o.to.y), Math.abs(o.to.x - o.from.x), Math.abs(o.to.y - o.from.y));
    return;
  }
  if (o.kind === 'ellipse') {
    c.strokeStyle = col; c.lineWidth = 3; c.setLineDash([]);
    c.beginPath();
    c.ellipse((o.from.x + o.to.x) / 2, (o.from.y + o.to.y) / 2, Math.abs(o.to.x - o.from.x) / 2, Math.abs(o.to.y - o.from.y) / 2, 0, 0, Math.PI * 2);
    c.stroke();
    return;
  }
  if (o.kind === 'complex') { drawComplex(c, o, col); return; }
  if (o.kind === 'circle') { drawCircle(c, o, col); return; }
  if (o.kind === 'tracer') { drawTracer(c, o); return; }
  if (o.kind === 'forcevec') { drawForceVec(c, o); return; }
  if (o.kind === 'incline') { drawInclineObj(c, o); return; }
  if (o.kind === 'image') {
    const img = objImage(o);
    const x0 = Math.min(o.from.x, o.to.x), y0 = Math.min(o.from.y, o.to.y);
    const w = Math.abs(o.to.x - o.from.x), h = Math.abs(o.to.y - o.from.y);
    if (img && w > 1 && h > 1) c.drawImage(img, x0, y0, w, h);
    else { c.fillStyle = '#e8edf3'; c.fillRect(x0, y0, w, h); }
    return;
  }
  if (o.kind === 'graphpt') {
    const m = pageToMath(o.at.x, o.at.y);
    c.fillStyle = o.color || '#d23b3b';
    c.beginPath(); c.arc(o.at.x, o.at.y, 7, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
    c.font = '600 18px sans-serif';
    c.fillText(`(${fmt(m.x)}, ${fmt(m.y)})`, o.at.x + 10, o.at.y - 8);
    return;
  }
  if (o.kind === 'tangent') {
    c.strokeStyle = o.color || '#d23b3b'; c.lineWidth = 2.5; c.setLineDash([10, 6]);
    c.beginPath(); c.moveTo(o.from.x, o.from.y); c.lineTo(o.to.x, o.to.y); c.stroke();
    c.setLineDash([]);
    return;
  }
  if (o.kind === 'intersect') {
    const r = 9;
    c.strokeStyle = o.color || '#8a4fd0'; c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(o.at.x - r, o.at.y); c.lineTo(o.at.x + r, o.at.y);
    c.moveTo(o.at.x, o.at.y - r); c.lineTo(o.at.x, o.at.y + r);
    c.stroke();
    c.beginPath(); c.arc(o.at.x, o.at.y, 5, 0, Math.PI * 2); c.fillStyle = o.color; c.fill();
    if (o.label) { c.font = '600 17px sans-serif'; c.fillText(o.label, o.at.x + 10, o.at.y + 5); }
    return;
  }
  drawArrow(c, o.from, o.to, col, o.kind === 'resultant');
  const v = vecInfo(o);
  const lx = o.to.x + 12, ly = o.to.y - 10;
  c.fillStyle = col; c.font = '600 24px sans-serif';
  c.fillText(`(${fmt(v.dx)}, ${fmt(v.dy)})`, lx, ly);
  c.font = '18px sans-serif';
  c.fillText(`|v| = ${v.mag.toFixed(2)}   ${formatAngle(v.angRad)}`, lx, ly + 24);
}
function drawObjects(c, pg) {
  refreshGraphObjects();
  for (const o of (pg.objects || [])) drawObject(c, o);
  if (pg.showParallelogram) {
    const vs = (pg.objects || []).filter((o) => o.kind === 'vector');
    if (vs.length >= 2) {
      const O = vs[0].from, A = vs[0].to;
      const v2x = vs[1].to.x - vs[1].from.x, v2y = vs[1].to.y - vs[1].from.y;
      const B = { x: O.x + v2x, y: O.y + v2y };
      const C = { x: A.x + v2x, y: A.y + v2y };
      c.strokeStyle = '#8a4fd0'; c.lineWidth = 2; c.setLineDash([12, 8]);
      c.beginPath();
      c.moveTo(A.x, A.y); c.lineTo(C.x, C.y);
      c.moveTo(B.x, B.y); c.lineTo(C.x, C.y);
      c.stroke();
      c.setLineDash([]);
    }
  }
  if (pg.showResultant) {
    const vs = (pg.objects || []).filter((o) => o.kind === 'vector');
    if (vs.length) {
      let sx = 0, sy = 0;
      for (const v of vs) { sx += v.to.x - v.from.x; sy += v.to.y - v.from.y; }
      const cx = PAGE_W / 2, cy = PAGE_H / 2;
      drawObject(c, { kind: 'resultant', from: { x: cx, y: cy }, to: { x: cx + sx, y: cy + sy }, color: '#8a4fd0' });
    }
  }
}
function snapPt(p) {
  if (!S.snap || !GRID_PAPERS.includes(page().paper)) return p;
  const g = UNIT, cx = PAGE_W / 2, cy = PAGE_H / 2;
  return { x: cx + Math.round((p.x - cx) / g) * g, y: cy + Math.round((p.y - cy) / g) * g };
}
function pointSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ---- graphing: y(x), parametric, probe points, tangents, intersections ----------
const gridCx = () => PAGE_W / 2;
const gridCy = () => PAGE_H / 2;
const mathToPage = (x, y) => ({ x: gridCx() + x * UNIT, y: gridCy() - y * UNIT });
const pageToMath = (px, py) => ({ x: (px - gridCx()) / UNIT, y: (gridCy() - py) / UNIT });

// Memoised mathjs compile — avoids recompiling expressions every frame (esp. during live demo
// animation, which redraws at ~60 fps). Cleared if it grows large.
const _compileCache = new Map();
function compileExpr(expr) {
  let node = _compileCache.get(expr);
  if (!node) {
    node = math.compile(expr);            // throws on invalid expr — callers wrap in try/catch
    if (_compileCache.size > 300) _compileCache.clear();
    _compileCache.set(expr, node);
  }
  return node;
}
function evalFnY(f, x) {
  const num = (v, dflt) => (v != null && v !== '' ? Number(math.evaluate(String(v), calcScope())) : dflt);
  let A = num(f.amp, 1); if (!isFinite(A)) A = 1;
  let k = num(f.period, 1); if (!isFinite(k)) k = 1;
  let c = num(f.phase, 0); if (!isFinite(c)) c = 0;
  let dsh = num(f.vshift, 0); if (!isFinite(dsh)) dsh = 0;
  const y = compileExpr(f.expr).evaluate({ x: k * x + c });
  return A * y + dsh;
}
function applyGraphAmp(f) { /* amp/period applied in evalFnY */ }
function evalParam(f, t) {
  const nx = compileExpr(f.exprX || 't');
  const ny = compileExpr(f.exprY || 't');
  return { x: nx.evaluate({ t }), y: ny.evaluate({ t }) };
}
function fnPointAt(f, param) {
  if (f.mode === 'param') {
    const { x, y } = evalParam(f, param);
    if (!isFinite(x) || !isFinite(y)) return null;
    return mathToPage(x, y);
  }
  try {
    const y = evalFnY(f, param);
    if (typeof y !== 'number' || !isFinite(y)) return null;
    return mathToPage(param, y);
  } catch (_) { return null; }
}
function slopeAt(f, param) {
  const h = 1e-4;
  if (f.mode === 'param') {
    const p0 = evalParam(f, param - h), p1 = evalParam(f, param + h);
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    if (Math.abs(dx) < 1e-12) return 0;
    return dy / dx;
  }
  try {
    return (evalFnY(f, param + h) - evalFnY(f, param - h)) / (2 * h);
  } catch (_) { return 0; }
}
function projectGraphPt(o, p) {
  const f = fns()[o.fnIndex];
  if (!f) return;
  let best = o.param, bestD = Infinity;
  if (f.mode === 'param') {
    const t0 = f.tMin ?? 0, t1 = f.tMax ?? Math.PI * 2;
    const steps = 240;
    for (let i = 0; i <= steps; i++) {
      const t = t0 + (t1 - t0) * i / steps;
      const pt = fnPointAt(f, t);
      if (!pt) continue;
      const d = dist2(pt, p);
      if (d < bestD) { bestD = d; best = t; }
    }
  } else {
    for (let x = -12; x <= 12; x += 0.08) {
      const pt = fnPointAt(f, x);
      if (!pt) continue;
      const d = dist2(pt, p);
      if (d < bestD) { bestD = d; best = x; }
    }
  }
  o.param = best;
  const at = fnPointAt(f, best);
  if (at) o.at = at;
}
function updateTangentGeom(o) {
  const pt = objs().find((x) => x.id === o.ptId);
  if (!pt || pt.kind !== 'graphpt') return;
  const f = fns()[pt.fnIndex];
  if (!f) return;
  const at = fnPointAt(f, pt.param);
  if (!at) return;
  pt.at = at;
  const m = slopeAt(f, pt.param);
  const ang = Math.atan2(-m, 1);
  const len = 2.8 * UNIT;
  o.from = { x: at.x - Math.cos(ang) * len, y: at.y - Math.sin(ang) * len };
  o.to = { x: at.x + Math.cos(ang) * len, y: at.y + Math.sin(ang) * len };
  o.color = f.color || o.color;
}
function syncTangentsFor(pt) {
  for (const o of objs()) if (o.kind === 'tangent' && o.ptId === pt.id) updateTangentGeom(o);
}
function refreshGraphObjects() {
  for (const o of objs()) {
    if (o.kind === 'graphpt') {
      const f = fns()[o.fnIndex];
      if (f) { const at = fnPointAt(f, o.param); if (at) o.at = at; }
    }
    if (o.kind === 'tangent') updateTangentGeom(o);
  }
}
function findFnIntersections(i, j) {
  const f1 = fns()[i], f2 = fns()[j];
  if (!f1 || !f2 || f1.mode === 'param' || f2.mode === 'param') return [];
  const pts = [];
  let prev = null;
  for (let x = -10; x <= 10; x += 0.08) {
    let d;
    try { d = evalFnY(f1, x) - evalFnY(f2, x); } catch (_) { prev = null; continue; }
    if (typeof d !== 'number' || !isFinite(d)) { prev = null; continue; }
    if (prev && prev.d * d < 0) {
      let a = prev.x, b = x;
      for (let k = 0; k < 24; k++) {
        const m = (a + b) / 2;
        const dm = evalFnY(f1, m) - evalFnY(f2, m);
        if (prev.d * dm <= 0) b = m; else a = m;
      }
      const xi = (a + b) / 2;
      try {
        const yi = evalFnY(f1, xi);
        if (isFinite(yi)) pts.push(mathToPage(xi, yi));
      } catch (_) { /* skip */ }
    }
    prev = { x, d };
  }
  return pts;
}
function addGraphPoint(fnIndex = 0) {
  const f = fns()[fnIndex];
  if (!f) return;
  beginAction();
  const param = f.mode === 'param' ? (f.tMin ?? 0) : 0;
  const at = fnPointAt(f, param);
  if (!at) { S.actionBefore = null; return; }
  const o = { id: uid(), kind: 'graphpt', fnIndex, param, at, color: f.color || '#d23b3b' };
  objs().push(o);
  commitAction();
  S.selStrokes = [];
  S.selObj = o;
  S.tool = 'select';
  if (cv) cv.classList.add('cur-select');
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === 'select'));
  mark();
}
function addTangentAtSelection() {
  const pt = S.selObj?.kind === 'graphpt' ? S.selObj : objs().find((o) => o.kind === 'graphpt');
  if (!pt) { alert('Select a point on a curve first (+ Point), or create one.'); return; }
  if (objs().some((o) => o.kind === 'tangent' && o.ptId === pt.id)) return;
  beginAction();
  const o = { id: uid(), kind: 'tangent', ptId: pt.id, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: '#d23b3b' };
  updateTangentGeom(o);
  objs().push(o);
  commitAction();
  mark();
}
function markIntersections() {
  if (fns().length < 2) { alert('Add at least two y(x) curves first.'); return; }
  beginAction();
  page().objects = objs().filter((o) => o.kind !== 'intersect');
  for (const at of findFnIntersections(0, 1)) {
    const m = pageToMath(at.x, at.y);
    objs().push({ id: uid(), kind: 'intersect', at, label: `(${fmt(m.x)}, ${fmt(m.y)})`, color: '#8a4fd0' });
  }
  commitAction();
  mark();
}

// graphed functions y = f(x) or parametric, origin at page centre
function drawFunctions(c, pg) {
  const list = pg.functions || [];
  if (!list.length || !window.math) return;
  c.textAlign = 'start';
  let labelY = 30;
  for (const f of list) {
    if (f.mode === 'param') {
      if (!f.exprX?.trim() || !f.exprY?.trim()) continue;
      c.strokeStyle = f.color; c.lineWidth = 3; c.lineJoin = 'round'; c.lineCap = 'round'; c.setLineDash([]);
      c.beginPath();
      const t0 = f.tMin ?? 0, t1 = f.tMax ?? Math.PI * 2;
      let pen = false, lastPy = null;
      for (let i = 0; i <= 400; i++) {
        const t = t0 + (t1 - t0) * i / 400;
        let pt;
        try { pt = fnPointAt(f, t); } catch (_) { pen = false; continue; }
        if (!pt) { pen = false; continue; }
        if (pen && lastPy != null && Math.abs(pt.y - lastPy) > PAGE_H * 0.8) pen = false;
        if (!pen) { c.moveTo(pt.x, pt.y); pen = true; } else c.lineTo(pt.x, pt.y);
        lastPy = pt.y;
      }
      c.stroke();
      c.fillStyle = f.color; c.font = '600 20px sans-serif';
      c.fillText(`(${f.exprX}, ${f.exprY})`, 16, labelY); labelY += 26;
      continue;
    }
    if (!f.expr || !f.expr.trim()) continue;
    let node;
    try { node = compileExpr(f.expr); } catch (_) { continue; }
    // precompute transform parameters A·f(k·x + φ) + d once per curve
    const pnum = (v, dflt) => { if (v == null || v === '') return dflt; try { const n = Number(math.evaluate(String(v), calcScope())); return isFinite(n) ? n : dflt; } catch (_) { return dflt; } };
    const A = pnum(f.amp, 1), k = pnum(f.period, 1), ph = pnum(f.phase, 0), vs = pnum(f.vshift, 0);
    c.strokeStyle = f.color; c.lineWidth = 3; c.lineJoin = 'round'; c.lineCap = 'round'; c.setLineDash([]);
    c.beginPath();
    let pen = false, lastPy = null;
    for (let px = 0; px <= PAGE_W; px += 2) {
      const x = (px - gridCx()) / UNIT;
      let y;
      try { y = A * node.evaluate({ x: k * x + ph }) + vs; } catch (_) { pen = false; continue; }
      if (typeof y !== 'number' || !isFinite(y)) { pen = false; continue; }
      const py = gridCy() - y * UNIT;
      if (pen && lastPy != null && Math.abs(py - lastPy) > PAGE_H * 1.5) pen = false;
      if (!pen) { c.moveTo(px, py); pen = true; } else c.lineTo(px, py);
      lastPy = py;
    }
    c.stroke();
    c.fillStyle = f.color; c.font = '600 22px sans-serif';
    let lbl = 'y = ' + f.expr;
    const tp = [];
    if (A !== 1) tp.push('A=' + fmt(A));
    if (k !== 1) tp.push('k=' + fmt(k));
    if (ph !== 0) tp.push('φ=' + fmt(ph));
    if (vs !== 0) tp.push('d=' + fmt(vs));
    if (tp.length) lbl += '  [' + tp.join(', ') + ']';
    c.fillText(lbl, 16, labelY); labelY += 28;
  }
}

// interactive unit circle for trigonometry teaching (page-level, exports with the page)
function drawTrig(c, pg) {
  const u = pg.unitCircle;
  if (!u || !u.show) return;
  const R = UNIT, cx = gridCx(), cy = gridCy();
  const th = (u.angleDeg || 0) * Math.PI / 180;
  const px = cx + Math.cos(th) * R, py = cy - Math.sin(th) * R;
  c.lineWidth = 2; c.setLineDash([]);
  c.strokeStyle = '#5a6570';
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
  // cos (horizontal) and sin (vertical) projections
  c.strokeStyle = '#1f9d57'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(px, cy); c.stroke();         // cos
  c.strokeStyle = '#d23b3b';
  c.beginPath(); c.moveTo(px, cy); c.lineTo(px, py); c.stroke();         // sin
  // radius
  c.strokeStyle = '#2566c8'; c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(px, py); c.stroke();
  // angle arc
  c.strokeStyle = '#e0892a'; c.lineWidth = 2;
  c.beginPath(); c.arc(cx, cy, R * 0.3, 0, -th, th > 0); c.stroke();
  c.fillStyle = '#2566c8'; c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1b1b1b'; c.font = '600 16px sans-serif'; c.textAlign = 'left';
  const s = Math.sin(th), co = Math.cos(th), tn = Math.tan(th);
  c.fillText(`θ = ${u.angleDeg || 0}°`, cx + R + 12, cy - R - 4);
  c.fillStyle = '#d23b3b'; c.fillText(`sin = ${s.toFixed(3)}`, cx + R + 12, cy - R + 18);
  c.fillStyle = '#1f9d57'; c.fillText(`cos = ${co.toFixed(3)}`, cx + R + 12, cy - R + 38);
  c.fillStyle = '#8a4fd0'; c.fillText(`tan = ${Math.abs(tn) > 1e4 ? '∞' : tn.toFixed(3)}`, cx + R + 12, cy - R + 58);
}

// draws one page's full content into a context already scaled to page units
function drawPageContent(c, pg) {
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, PAGE_W, PAGE_H);
  const e = imgCache.get(pg.id);
  drawBackground(c, pg, e && e.loaded ? e.img : null);
  drawFunctions(c, pg);
  drawTrig(c, pg);
  drawCalcItems(c, pg);
  drawObjects(c, pg);
  drawMechItems(c, pg);
  drawCplxLoci(c, pg);
  drawInstruments(c, pg);
  for (const s of pg.strokes) drawStroke(c, s);
}

function render() {
  // live demo: advance the parameter while playing and force a redraw each frame
  if (S.playing && S.notebook && !$('#editor').classList.contains('hidden')) {
    const now = performance.now();
    const dt = (now - S.demoLast) / 1000; S.demoLast = now;
    S.demoT += dt / Math.max(0.5, S.demoPeriod);
    if (S.demoT > 1) S.demoT -= 1;
    syncDemoUI();
    S.dirty = true;
  }
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
    drawFunctions(ctx, page());
    drawTrig(ctx, page());
    drawCalcItems(ctx, page());
    drawObjects(ctx, page());
    drawMechItems(ctx, page());
    drawCplxLoci(ctx, page());
    drawInstruments(ctx, page());
    if (S.creating) drawObject(ctx, S.creating);
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
    // selected object or ink: dashed bbox + square drag handles
    if (S.selObj && objs().includes(S.selObj)) drawSelBox(ctx, objBBox(S.selObj), objHandles(S.selObj));
    else if (S.selStrokes.length && S.selStrokes.every((s) => page().strokes.includes(s))) {
      drawSelBox(ctx, strokeBBox(S.selStrokes), []);
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
    syncGeoLayer(S.offsetX, S.offsetY, S.scale);
    S.dirty = false;
  }
  requestAnimationFrame(render);
}

// ---- selection ---------------------------------------------------------------
function drawSelBox(c, b, handles) {
  const pad = 6;
  const bx = b.x - pad, by = b.y - pad, bw = b.w + pad * 2, bh = b.h + pad * 2;
  c.strokeStyle = '#2566c8'; c.lineWidth = 1.5 / S.scale;
  c.setLineDash([7 / S.scale, 5 / S.scale]);
  c.strokeRect(bx, by, bw, bh);
  c.setLineDash([]);
  const hs = 9 / S.scale;
  c.fillStyle = '#ffffff';
  for (const h of handles) {
    c.beginPath(); c.rect(h.x - hs, h.y - hs, hs * 2, hs * 2);
    c.fill(); c.stroke();
  }
}
function clearSelection() { S.selection = null; S.lassoPath = null; S.selObj = null; S.selStrokes = []; mark(); }

function touchToolCanInteract() {
  return ['select','lasso','text','equation','plotz','circle','line','rect','ellipse','vector','eraser'].includes(S.tool);
}
function selectionBBox(selection) {
  const boxes = [];
  if (selection.strokes?.length) boxes.push(strokeBBox(selection.strokes));
  if (selection.objects?.length) boxes.push(...selection.objects.map(objBBox));
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  return boxes.slice(1).reduce((acc, b) => {
    const x0 = Math.min(acc.x, b.x), y0 = Math.min(acc.y, b.y);
    const x1 = Math.max(acc.x + acc.w, b.x + b.w), y1 = Math.max(acc.y + acc.h, b.y + b.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, boxes[0]);
}
function objectInLasso(o, poly) {
  const b = objBBox(o);
  const pts = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x + b.w / 2, y: b.y + b.h / 2 },
  ];
  return pts.some((p) => pointInPoly(p, poly));
}

// ---- object selection / move / resize (the "tldraw" capability) -------------
// The Select tool grabs a single math object/shape/text and lets you drag its
// body to move it, or drag a handle to reshape it. Geometry is stored in page
// units, so moves/resizes are zoom-independent like everything else.
function objPoints(o) {                 // the point refs that define an object's geometry
  if (o.kind === 'text' || o.kind === 'equation' || o.kind === 'complex' || o.kind === 'graphpt' || o.kind === 'intersect' || o.kind === 'forcevec' || o.kind === 'incline') return [o.at];
  if (o.kind === 'circle' || o.kind === 'tracer') return [o.center, o.edge];
  return [o.from, o.to];               // vector / line / rect / ellipse
}
function objBBox(o) {
  if (o.kind === 'circle' || o.kind === 'tracer') {
    const r = Math.hypot(o.edge.x - o.center.x, o.edge.y - o.center.y);
    return { x: o.center.x - r, y: o.center.y - r, w: 2 * r, h: 2 * r };
  }
  if (o.kind === 'text') { const b = textBox(o); return { x: o.at.x, y: o.at.y, w: b.w, h: b.h }; }
  if (o.kind === 'equation') { const b = equationBox(o); return { x: o.at.x, y: o.at.y, w: b.w, h: b.h }; }
  if (o.kind === 'complex') return { x: o.at.x - 10, y: o.at.y - 10, w: 20, h: 20 };
  if (o.kind === 'forcevec') {
    const tip = forceTip(o);
    const x0 = Math.min(o.at.x, tip.x), y0 = Math.min(o.at.y, tip.y);
    return { x: x0, y: y0, w: Math.abs(tip.x - o.at.x), h: Math.abs(tip.y - o.at.y) };
  }
  if (o.kind === 'incline') {
    const g = inclineGeom(o);
    return { x: g.a.x - 50, y: g.top.y - 70, w: g.B + 110, h: (g.a.y - g.top.y) + 120 };
  }
  if (o.kind === 'graphpt' || o.kind === 'intersect') return { x: o.at.x - 12, y: o.at.y - 12, w: 24, h: 24 };
  if (o.kind === 'tangent') return { x: Math.min(o.from.x, o.to.x), y: Math.min(o.from.y, o.to.y), w: Math.abs(o.to.x - o.from.x), h: Math.abs(o.to.y - o.from.y) };
  const x0 = Math.min(o.from.x, o.to.x), y0 = Math.min(o.from.y, o.to.y);
  return { x: x0, y: y0, w: Math.abs(o.to.x - o.from.x), h: Math.abs(o.to.y - o.from.y) };
}
function objHandles(o) {                 // named drag handles, in page units
  if (o.kind === 'vector' || o.kind === 'line')
    return [{ name: 'from', x: o.from.x, y: o.from.y }, { name: 'to', x: o.to.x, y: o.to.y }];
  if (o.kind === 'circle' || o.kind === 'tracer')
    return [{ name: 'center', x: o.center.x, y: o.center.y }, { name: 'edge', x: o.edge.x, y: o.edge.y }];
  if (o.kind === 'complex')
    return [{ name: 'at', x: o.at.x, y: o.at.y }];
  if (o.kind === 'forcevec') {
    const tip = forceTip(o);
    return [{ name: 'at', x: o.at.x, y: o.at.y }, { name: 'tip', x: tip.x, y: tip.y }];
  }
  if (o.kind === 'incline') {
    const g = inclineGeom(o);
    return [{ name: 'at', x: o.at.x, y: o.at.y }, { name: 'apex', x: g.top.x, y: g.top.y }];
  }
  if (o.kind === 'rect' || o.kind === 'ellipse' || o.kind === 'image') {
    const x0 = Math.min(o.from.x, o.to.x), y0 = Math.min(o.from.y, o.to.y),
          x1 = Math.max(o.from.x, o.to.x), y1 = Math.max(o.from.y, o.to.y);
    return [{ name: 'nw', x: x0, y: y0 }, { name: 'ne', x: x1, y: y1 },
            { name: 'sw', x: x0, y: y1 }, { name: 'se', x: x1, y: y1 }];
  }
  if (o.kind === 'text') { const b = textBox(o); return [{ name: 'size', x: o.at.x + b.w, y: o.at.y + b.h }]; }
  if (o.kind === 'equation') { const b = equationBox(o); return [{ name: 'size', x: o.at.x + b.w, y: o.at.y + b.h }]; }
  return [];
}
function applyHandle(o, name, p) {        // drag a handle to point p (snapped on grid papers)
  const sp = snapPt(p);
  if (name === 'from') o.from = sp;
  else if (name === 'to') o.to = sp;
  else if (name === 'tip') {
    const dx = p.x - o.at.x, dy = o.at.y - p.y;   // y up
    o.mag = Math.max(0.1, Math.round(Math.hypot(dx, dy) / FORCE_SCALE * 10) / 10);
    o.angleDeg = Math.atan2(dy, dx) * 180 / Math.PI - (o.anim ? S.demoT * 360 : 0);
  }
  else if (name === 'apex') {
    o.anim = false;                                // grabbing the apex switches to manual angle
    const h = Math.max(20, o.at.y - p.y);
    o.angleDeg = Math.max(5, Math.min(85, Math.atan(h / (o.base || 300)) * 180 / Math.PI));
  }
  else if (name === 'at') o.at = sp;
  else if (name === 'edge') o.edge = sp;
  else if (name === 'center') { const dx = sp.x - o.center.x, dy = sp.y - o.center.y; o.center = sp; o.edge = { x: o.edge.x + dx, y: o.edge.y + dy }; }
  else if (name === 'size') {
    if (o.kind === 'equation') {
      const b = equationBox(o);
      o.size = Math.max(14, Math.min(120, o.size * Math.max(20, p.x - o.at.x) / (b.w || 1)));
    } else {
      const b = textBox(o);
      o.size = Math.max(10, Math.min(220, o.size * Math.max(20, p.x - o.at.x) / (b.w || 1)));
    }
  }
  else {                                  // rect / ellipse / image corner
    const pt = o.kind === 'image' ? p : snapPt(p);
    let x0 = Math.min(o.from.x, o.to.x), y0 = Math.min(o.from.y, o.to.y),
        x1 = Math.max(o.from.x, o.to.x), y1 = Math.max(o.from.y, o.to.y);
    if (name.includes('n')) y0 = pt.y; else y1 = pt.y;
    if (name.includes('w')) x0 = pt.x; else x1 = pt.x;
    if (o.kind === 'image') {
      const min = 48;
      if (x1 - x0 < min) { if (name.includes('w')) x0 = x1 - min; else x1 = x0 + min; }
      if (y1 - y0 < min) { if (name.includes('n')) y0 = y1 - min; else y1 = y0 + min; }
    }
    o.from = { x: x0, y: y0 }; o.to = { x: x1, y: y1 };
  }
}
function moveObject(o, dx, dy) { for (const pt of objPoints(o)) { pt.x += dx; pt.y += dy; } }
function hitObject(p) {                   // topmost object under p (or null)
  const tol = 14 / S.scale, list = objs();
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (objHit(o, p, tol)) return o;
    const b = objBBox(o);
    if (['rect', 'ellipse', 'text', 'equation', 'complex', 'circle', 'image'].includes(o.kind) &&
        p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return o;
  }
  return null;
}
function handleAt(o, p) {                  // name of the handle near p (or null)
  const tol = 20 / S.scale;
  for (const h of objHandles(o)) if (Math.abs(p.x - h.x) < tol && Math.abs(p.y - h.y) < tol) return h.name;
  return null;
}
function hitStroke(p) {                    // topmost ink stroke under p (or null)
  const tol = 14 / S.scale;
  const strokes = page().strokes;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    const hitR = tol + s.width * (s.penType === 'marker' ? 1.2 : 0.5);
    for (let j = 0; j < s.points.length; j++) {
      if (Math.hypot(p.x - s.points[j].x, p.y - s.points[j].y) < hitR) return s;
      if (j > 0 && pointSegDist(p, s.points[j - 1], s.points[j]) < hitR) return s;
    }
  }
  return null;
}
function deleteSelection() {
  if (!S.selObj && !S.selStrokes.length) return;
  beginAction();
  if (S.selObj) {
    const i = objs().indexOf(S.selObj);
    if (i >= 0) objs().splice(i, 1);
    if (S.selObj.kind === 'image') purgeObjImage(S.selObj.id);
    if (S.selObj.kind === 'graphpt') {
      const pid = S.selObj.id;
      page().objects = objs().filter((o) => !(o.kind === 'tangent' && o.ptId === pid));
    }
    S.selObj = null;
  }
  if (S.selStrokes.length) {
    const set = new Set(S.selStrokes);
    page().strokes = page().strokes.filter((s) => !set.has(s));
    S.selStrokes = [];
  }
  commitAction(); mark();
}

function finishLasso() {
  const poly = S.lassoPath;
  S.lassoPath = null;
  if (!poly || poly.length < 3) { mark(); return; }
  const hits = page().strokes.filter((s) => s.points.some((p) => pointInPoly(p, poly)));
  const objHits = page().objects.filter((o) => objectInLasso(o, poly));
  if (hits.length || objHits.length) S.selection = { strokes: hits, objects: objHits, bbox: selectionBBox({ strokes: hits, objects: objHits }) };
  else S.selection = null;
  mark();
}

// ---- pointer input -----------------------------------------------------------
function pressureOf(e) {
  if (e.pointerType === 'pen' && e.pressure > 0) return e.pressure;
  return 0.5;
}
function isDrawPointer(e) {
  if (geoToolActive() || instToolActive()) return false;
  if (e.pointerType === 'pen' || e.pointerType === 'mouse' || e.pointerType === 'eraser') return true;
  if (e.pointerType === 'touch') return S.fingerDraw && S.touch.size === 1 && ['pen', 'highlighter'].includes(S.tool);
  return false;
}

// A second finger means "I'm navigating, not editing": revert any uncommitted
// edit started by the first finger so a two-finger pan/zoom never leaves a stray
// object (e.g. plot-z), an accidental move, or half a stroke behind.
function abortGesture() {
  const selIdx = S.selObj ? objs().indexOf(S.selObj) : -1;
  if (S.actionBefore) {
    restorePage(S.actionBefore);
    S.selObj = selIdx >= 0 ? objs()[selIdx] : null;
    S.selStrokes = [];
    S.selection = null;
  }
  S.creating = null; S.drawing = null; S.lassoPath = null;
  S.moving = null; S.objMove = null; S.objResize = null;
  S.actionBefore = null;
  mark();
}

function onDown(e) {
  try { cv.setPointerCapture(e.pointerId); } catch (_) { /* non-fatal */ }
  if (e.pointerType === 'touch') {
    S.touch.set(e.pointerId, cssPt(e));
    setGestureRef();
    if (S.touch.size >= 2) { abortGesture(); return; }  // 2+ fingers = pan/zoom only; cancel any tool action
  }
  if (!isDrawPointer(e) && !(e.pointerType === 'touch' && touchToolCanInteract())) { mark(); return; }
  const p = toPage(...cssArr(e));

  if (handleInstClick(p)) return;
  if (handleCplxClick(p)) return;
  if (handleMechClick(p)) return;

  // Apple Pencil eraser end — always erase, any selected tool
  if (e.pointerType === 'eraser') {
    beginAction();
    eraseAt(p);
    S.drawing = { eraser: true };
    return;
  }

  if (S.tool === 'select') {
    if (S.selObj) {
      const h = handleAt(S.selObj, p);
      if (h) { beginAction(); S.objResize = h; return; }
    }
    const hit = hitObject(p);
    if (hit) {
      S.selStrokes = [];
      S.selObj = hit; beginAction();
      S.objMove = { lastX: p.x, lastY: p.y };
    } else {
      const ink = hitStroke(p);
      if (ink) {
        S.selObj = null;
        S.selStrokes = [ink];
        beginAction();
        S.objMove = { lastX: p.x, lastY: p.y };
      } else {
        S.selObj = null; S.selStrokes = [];
        S.objMove = null; S.objResize = null;
      }
    }
    mark();
    return;
  }
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
  if (['vector', 'line', 'rect', 'ellipse'].includes(S.tool)) {
    beginAction();
    const sp = snapPt(p);
    S.creating = { kind: S.tool, from: sp, to: sp, color: S.color };
    mark();
    return;
  }
  if (S.tool === 'text') {
    const hit = [...objs()].reverse().find((o) => o.kind === 'text' && pointInText(o, p));
    beginAction();
    if (hit) openTextEditor(hit);
    else {
      const o = { id: uid(), kind: 'text', at: p, text: '', color: S.color, size: 34 };
      objs().push(o);
      openTextEditor(o);
    }
    return;
  }
  if (S.tool === 'equation') {
    const hit = [...objs()].reverse().find((o) => o.kind === 'equation' && pointInEquation(o, p));
    beginAction();
    if (hit) openEquationEditor(hit);
    else {
      const o = { id: uid(), kind: 'equation', at: p, latex: 'x^2 + y^2 = r^2', color: S.color, size: 34 };
      objs().push(o);
      openEquationEditor(o);
    }
    return;
  }
  if (S.tool === 'plotz') {
    beginAction();
    S.creating = { kind: 'complex', at: snapPt(p), color: S.color };
    mark();
    return;
  }
  if (S.tool === 'circle') {
    beginAction();
    const sp = snapPt(p);
    S.creating = { kind: 'circle', center: sp, edge: sp, color: S.color };
    mark();
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
  const stroke = { tool: S.tool, color: S.color, width: S.width, points: [{ x: p.x, y: p.y, p: pressureOf(e) }] };
  if (S.tool === 'pen') stroke.penType = S.penType;
  S.drawing = stroke;
  mark();
}

function onMove(e) {
  if (e.pointerType === 'touch') {
    if (S.touch.has(e.pointerId)) S.touch.set(e.pointerId, cssPt(e));
    if (S.touch.size > 1) { handleGesture(); return; }
    if (!S.fingerDraw && !touchToolCanInteract()) return;
  }
  if (S.objResize) { applyHandle(S.selObj, S.objResize, toPage(...cssArr(e))); mark(); return; }
  if (S.objMove) {
    const p = toPage(...cssArr(e));
    if (S.selObj?.kind === 'graphpt') {
      projectGraphPt(S.selObj, p);
      syncTangentsFor(S.selObj);
    } else if (S.selObj) {
      const dx = p.x - S.objMove.lastX, dy = p.y - S.objMove.lastY;
      moveObject(S.selObj, dx, dy);
    } else for (const s of S.selStrokes) for (const pt of s.points) { pt.x += p.x - S.objMove.lastX; pt.y += p.y - S.objMove.lastY; }
    S.objMove.lastX = p.x; S.objMove.lastY = p.y;
    mark(); return;
  }
  if (S.moving) {
    const p = toPage(...cssArr(e));
    const dx = p.x - S.moving.lastX, dy = p.y - S.moving.lastY;
    for (const s of (S.selection.strokes || [])) for (const pt of s.points) { pt.x += dx; pt.y += dy; }
    for (const o of (S.selection.objects || [])) moveObject(o, dx, dy);
    S.selection.bbox = selectionBBox(S.selection);
    S.moving.lastX = p.x; S.moving.lastY = p.y;
    mark(); return;
  }
  if (S.lassoPath) { S.lassoPath.push(toPage(...cssArr(e))); mark(); return; }
  if (S.creating) {
    const sp = snapPt(toPage(...cssArr(e)));
    if (S.creating.kind === 'complex') S.creating.at = sp;
    else if (S.creating.kind === 'circle') S.creating.edge = sp;
    else S.creating.to = sp;
    mark(); return;
  }
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
  if (S.objResize) { S.objResize = null; commitAction(); mark(); return; }
  if (S.objMove) { S.objMove = null; commitAction(); mark(); return; }
  if (S.moving) { S.moving = null; commitAction(); return; }
  if (S.lassoPath) { finishLasso(); return; }
  if (S.creating) {
    const o = S.creating;
    let ok = true;
    if (o.kind === 'circle') ok = Math.hypot(o.edge.x - o.center.x, o.edge.y - o.center.y) > 6;
    else if (o.from && o.to) ok = Math.hypot(o.to.x - o.from.x, o.to.y - o.from.y) > 4;   // vector/line/rect/ellipse
    // complex (a single point) always commits
    if (ok) objs().push(o);
    S.creating = null; commitAction(); mark(); return;
  }
  if (S.drawing && S.drawing.eraser) { S.drawing = null; commitAction(); return; }
  if (S.drawing) {
    if (S.drawing.points.length) page().strokes.push(S.drawing);
    S.drawing = null;
    commitAction();
    mark();
  }
}

// Eraser hit test — vertices AND segments (fast strokes can gap between samples).
function strokeEraseHit(s, p, r) {
  const pts = s.points;
  if (!pts.length) return false;
  for (let j = 0; j < pts.length; j++) {
    if (Math.hypot(p.x - pts[j].x, p.y - pts[j].y) < r) return true;
    if (j > 0 && pointSegDist(p, pts[j - 1], pts[j]) < r) return true;
  }
  return false;
}
function pointErased(p, q, r) {
  return Math.hypot(p.x - q.x, p.y - q.y) < r;
}
// Split a stroke at erased samples so only the touched segment disappears (not the whole path).
function splitStrokeAtErase(s, r, p) {
  const segs = [];
  let run = [];
  const pts = s.points;
  for (let j = 0; j < pts.length; j++) {
    const q = pts[j];
    const hit = pointErased(p, q, r) || (j > 0 && pointSegDist(p, pts[j - 1], q) < r);
    if (hit) {
      if (run.length) { segs.push(run); run = []; }
    } else run.push(q);
  }
  if (run.length) segs.push(run);
  return segs
    .filter((pts) => pts.length > 0)
    .map((pts) => ({ tool: s.tool, penType: s.penType, color: s.color, width: s.width, points: pts }));
}
function eraseAt(p) {
  const r = (S.width + 14);
  const strokesBefore = page().strokes.length;
  const next = [];
  for (const s of page().strokes) {
    if (!strokeEraseHit(s, p, r)) next.push(s);
    else next.push(...splitStrokeAtErase(s, r, p));
  }
  page().strokes = next;
  const objBefore = objs().length;
  page().objects = objs().filter((o) => {
    if (!objHit(o, p, r)) return true;
    if (o.kind === 'image') purgeObjImage(o.id);
    return false;
  });
  if (page().strokes.length !== strokesBefore || page().objects.length !== objBefore) mark();
}
function pointInText(o, p) {
  const b = textBox(o);
  return p.x >= o.at.x - 8 && p.x <= o.at.x + b.w + 8 && p.y >= o.at.y - 8 && p.y <= o.at.y + b.h + 8;
}
function objHit(o, p, r) {
  if (o.kind === 'graphpt' || o.kind === 'intersect') return Math.hypot(p.x - o.at.x, p.y - o.at.y) < r + 10;
  if (o.kind === 'tangent') return pointSegDist(p, o.from, o.to) < r + 4;
  if (o.kind === 'forcevec') return pointSegDist(p, o.at, forceTip(o)) < r + 6 || Math.hypot(p.x - o.at.x, p.y - o.at.y) < r + 8;
  if (o.kind === 'incline') { const bb = objBBox(o); return p.x >= bb.x - r && p.x <= bb.x + bb.w + r && p.y >= bb.y - r && p.y <= bb.y + bb.h + r; }
  if (o.kind === 'text') return pointInText(o, p);
  if (o.kind === 'complex') return Math.hypot(p.x - o.at.x, p.y - o.at.y) < r + 8;
  if (o.kind === 'circle' || o.kind === 'tracer') {
    const rad = Math.hypot(o.edge.x - o.center.x, o.edge.y - o.center.y);
    const d = Math.hypot(p.x - o.center.x, p.y - o.center.y);
    return Math.abs(d - rad) < r || d < r;
  }
  if (o.kind === 'rect' || o.kind === 'image') {
    const x0 = Math.min(o.from.x, o.to.x), y0 = Math.min(o.from.y, o.to.y), x1 = Math.max(o.from.x, o.to.x), y1 = Math.max(o.from.y, o.to.y);
    return p.x >= x0 - r && p.x <= x1 + r && p.y >= y0 - r && p.y <= y1 + r;
  }
  if (o.kind === 'ellipse') {
    const cx = (o.from.x + o.to.x) / 2, cy = (o.from.y + o.to.y) / 2, rx = Math.abs(o.to.x - o.from.x) / 2 || 1, ry = Math.abs(o.to.y - o.from.y) / 2 || 1;
    return Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1) * Math.min(rx, ry) < r + 4;
  }
  return pointSegDist(p, o.from, o.to) < r;   // line / vector / resultant
}

const cssPt = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const cssArr = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

// ---- text boxes (GoodNotes/OneNote-style typed text) ------------------------
let textTarget = null;
function sizeTextEditor() {
  const ta = $('#text-editor');
  ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
  ta.style.width = 'auto'; ta.style.width = Math.max(60, ta.scrollWidth + 6) + 'px';
}
function openTextEditor(o) {
  textTarget = o; S.editingId = o.id;
  const ta = $('#text-editor');
  ta.style.left = (o.at.x * S.scale + S.offsetX) + 'px';
  ta.style.top = (o.at.y * S.scale + S.offsetY) + 'px';
  ta.style.fontSize = (o.size * S.scale) + 'px';
  ta.style.color = o.color;
  ta.value = o.text || '';
  ta.classList.remove('hidden');
  mark();
  setTimeout(() => { ta.focus(); sizeTextEditor(); }, 0);
}
function commitTextEditor() {
  const ta = $('#text-editor');
  if (!textTarget) return;
  textTarget.text = ta.value;
  if (!ta.value.trim()) { const i = objs().indexOf(textTarget); if (i >= 0) objs().splice(i, 1); }
  S.editingId = null; textTarget = null;
  ta.classList.add('hidden');
  commitAction(); persist(); mark();
}
function setupText() {
  const ta = $('#text-editor');
  ta.addEventListener('input', sizeTextEditor);
  ta.addEventListener('blur', commitTextEditor);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); ta.blur(); } e.stopPropagation(); });
}

// ---- equation editor (LaTeX via MathLive <math-field>) -----------------------
let eqTarget = null;
let eqField = null; // the <math-field> overlay

function openEquationEditor(o) {
  eqTarget = o; S.editingId = o.id;
  if (!eqField) {
    eqField = document.createElement('math-field');
    eqField.id = 'eq-editor';
    eqField.style.position = 'absolute';
    eqField.style.zIndex = '100';
    eqField.style.background = '#fff';
    eqField.style.border = '2px solid #2566c8';
    eqField.style.borderRadius = '6px';
    eqField.style.padding = '4px 8px';
    eqField.style.fontSize = '20px';
    eqField.style.minWidth = '120px';
    eqField.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    eqField.setAttribute('virtual-keyboard-mode', 'manual');
    document.body.appendChild(eqField);
    eqField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEquationEditor(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelEquationEditor(); }
      e.stopPropagation();
    });
    eqField.addEventListener('blur', commitEquationEditor);
  }
  eqField.style.left = (o.at.x * S.scale + S.offsetX) + 'px';
  eqField.style.top = (o.at.y * S.scale + S.offsetY) + 'px';
  eqField.value = o.latex || '';
  eqField.classList.remove('hidden');
  mark();
  setTimeout(() => { eqField.focus(); eqField.setValue?.(o.latex || ''); }, 0);
}
function commitEquationEditor() {
  if (!eqTarget || !eqField) return;
  const latex = eqField.value || '';
  eqTarget.latex = latex;
  if (!latex.trim()) {
    const i = objs().indexOf(eqTarget);
    if (i >= 0) objs().splice(i, 1);
  }
  S.editingId = null; eqTarget = null;
  eqField.classList.add('hidden');
  eqRenderCache = new Map(); // invalidate cache since latex changed
  commitAction(); persist(); mark();
}
function cancelEquationEditor() {
  if (!eqTarget) return;
  // remove the object if it was just created and has no content
  if (!eqTarget.latex || !eqTarget.latex.trim()) {
    const i = objs().indexOf(eqTarget);
    if (i >= 0) objs().splice(i, 1);
  }
  S.editingId = null; eqTarget = null;
  eqField.classList.add('hidden');
  mark();
}

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
  (async () => {
    await ensureObjImagesLoaded();
    const oc = renderPageToCanvas(page(), 2);
    await drawGeoSvgToCanvas(oc.getContext('2d'), page());
    oc.toBlob((blob) => downloadBlob(blob, `${S.notebook.title}-p${S.pageIndex + 1}.png`));
  })();
}
async function exportPDF() {
  if (!window.jspdf) { alert('PDF library not loaded (need internet on first use).'); return; }
  await ensureImagesLoaded();
  await ensureObjImagesLoaded();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const all = allPages(S.notebook);
  for (let i = 0; i < all.length; i++) {
    const pg = all[i];
    const oc = renderPageToCanvas(pg, 2);
    await drawGeoSvgToCanvas(oc.getContext('2d'), pg);
    if (i > 0) pdf.addPage();
    pdf.addImage(oc.toDataURL('image/png'), 'PNG', 0, 0, W, H);
  }
  pdf.save(`${S.notebook.title}.pdf`);
}
async function importJsonAsNotebook(file) {
  try {
    busy(true, 'Importing lesson…');
    const nb = await importNotebookFromFile(file);
    busy(false);
    setLibTab(notebookKind(nb));
    openNotebook(nb.id);
  } catch (e) { busy(false); alert('Could not import lesson: ' + e.message); }
}

// ---- insert image (movable object on current page) ----------------------------
function imageDataUrl(img, usePng) {
  const maxDim = 1400;
  let dw = img.width, dh = img.height;
  if (dw > maxDim || dh > maxDim) {
    const s = maxDim / Math.max(dw, dh);
    dw = Math.round(dw * s); dh = Math.round(dh * s);
  }
  const oc = document.createElement('canvas');
  oc.width = dw; oc.height = dh;
  const cx = oc.getContext('2d');
  if (!usePng) { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, dw, dh); }
  cx.drawImage(img, 0, 0, dw, dh);
  return usePng ? oc.toDataURL('image/png') : oc.toDataURL('image/jpeg', 0.88);
}
function insertImageFile(file) {
  if (!file || !file.type.startsWith('image/')) { alert('Please choose a PNG, JPEG, WebP, or GIF image.'); return; }
  busy(true, 'Adding image…');
  const reader = new FileReader();
  reader.onerror = () => { busy(false); alert('Could not read image.'); };
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => { busy(false); alert('Could not load image.'); };
    img.onload = () => {
      try {
        const usePng = file.type === 'image/png' || file.type === 'image/gif';
        const data = imageDataUrl(img, usePng);
        const maxW = 480, maxH = 400;
        let w = img.width, h = img.height;
        const fit = Math.min(maxW / w, maxH / h, 1);
        w = Math.round(w * fit); h = Math.round(h * fit);
        const x = (PAGE_W - w) / 2, y = (PAGE_H - h) / 2;
        beginAction();
        const o = { id: uid(), kind: 'image', from: { x, y }, to: { x: x + w, y: y + h }, data };
        objs().unshift(o);
        commitAction();
        persist();
        thumbCache.delete(page().id);
        S.selStrokes = [];
        S.selObj = o;
        S.tool = 'select';
        if (cv) cv.classList.add('cur-select');
        document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === 'select'));
        setTab('draw');
        mark();
      } catch (e) { alert('Could not add image: ' + e.message); }
      busy(false);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// place any canvas (e.g. a stats chart) onto the page as a movable image object
function placeImageFromCanvas(canvas) {
  if (!canvas) { alert('Run an analysis first to create a chart.'); return; }
  let data;
  try { data = canvas.toDataURL('image/png'); } catch (_) { alert('Could not capture the chart.'); return; }
  const w = Math.min(420, canvas.width || 320);
  const h = Math.round(w * (canvas.height || 200) / (canvas.width || 320));
  const x = (PAGE_W - w) / 2, y = (PAGE_H - h) / 2;
  beginAction();
  const o = { id: uid(), kind: 'image', from: { x, y }, to: { x: x + w, y: y + h }, data };
  objs().unshift(o);
  commitAction();
  persist();
  thumbCache.delete(page().id);
  S.selStrokes = []; S.selObj = o; S.tool = 'select';
  if (cv) cv.classList.add('cur-select');
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === 'select'));
  setTab('draw');
  mark();
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
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';   // ensure worker set even if init timing missed it
  }
  const pdf = await withTimeout(pdfjsLib.getDocument({ data: arrayBuffer }).promise, 20000, 'Opening PDF');
  const newPgs = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    busy(true, `Importing PDF — page ${i} of ${pdf.numPages}…`);
    const pg = await pdf.getPage(i);
    const base = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: 1500 / base.width });   // ~1500px wide = crisp
    const oc = document.createElement('canvas');
    oc.width = Math.round(vp.width); oc.height = Math.round(vp.height);
    const cx = oc.getContext('2d');
    cx.fillStyle = '#ffffff';                            // PDF.js renders onto transparent — paint white first
    cx.fillRect(0, 0, oc.width, oc.height);              // (otherwise JPEG turns the page black/blank)
    const task = pg.render({ canvasContext: cx, viewport: vp });
    await withTimeout(task.promise, 30000, `Rendering page ${i}`).catch((e) => { try { task.cancel(); } catch (_) {} throw e; });
    newPgs.push({ id: uid(), paper: 'plain', background: { type: 'image', data: oc.toDataURL('image/jpeg', 0.92) }, strokes: [], objects: [], instruments: [] });
  }
  return newPgs;
}
async function insertPdfIntoNotebook(file) {
  try {
    busy(true, 'Reading PDF…');
    const newPgs = await renderPdfToPages(await file.arrayBuffer());
    addPagesAfterCurrent(newPgs);
  } catch (e) { alert('Could not import PDF: ' + e.message); }
  finally { busy(false); }
}
async function importPdfAsNotebook(file) {
  try {
    busy(true, 'Reading PDF…');
    const newPgs = await renderPdfToPages(await file.arrayBuffer());
    const nb = newNotebook(file.name.replace(/\.pdf$/i, ''), 'paper');
    nb.sections[0].pages = newPgs.length ? newPgs : [newPage('plain')];
    await saveNotebook(nb);
    busy(false);
    setLibTab('paper');
    openNotebook(nb.id);
  } catch (e) { busy(false); alert('Could not import PDF: ' + e.message); }
}

// ---- UI: library <-> editor --------------------------------------------------
let libTab = 'lesson';

function updateSyncStatus(s) {
  const el = $('#sync-status');
  if (!el) return;
  const labels = {
    saved: '● Saved', exported: '● Exported', imported: '● Imported', shared: '● Shared',
    synced: '● Synced', 'synced-all': '● Synced all', pulled: '● Pulled', configured: '● Cloud ready',
  };
  el.textContent = labels[s.state] || (getSyncBaseUrl() ? '● Cloud' : '● Local');
  el.title = getSyncBaseUrl() ? `Cloud: ${getSyncBaseUrl()}` : 'Offline · saved on this device';
  if (s.state === 'saved') {
    clearTimeout(updateSyncStatus._t);
    updateSyncStatus._t = setTimeout(() => {
      el.textContent = getSyncBaseUrl() ? '● Cloud' : '● Local';
    }, 2500);
  }
}

function show(view) {
  $('#library').classList.toggle('hidden', view !== 'library');
  $('#editor').classList.toggle('hidden', view !== 'editor');
}

function setLibTab(t) {
  libTab = t;
  const head = $('.lib-head');
  head.classList.toggle('lib-lesson', t === 'lesson');
  head.classList.toggle('lib-paper', t === 'paper');
  document.querySelectorAll('.lib-tab').forEach((b) => b.classList.toggle('active', b.dataset.lib === t));
  renderLibrary();
}

function notebookCardThumb(nb) {
  const pg = allPages(nb)[0];
  if (!pg) return '<div class="nb-thumb"></div>';
  if (pageIsPdf(pg)) return `<div class="nb-thumb"><img src="${pg.background.data}" alt="" /></div>`;
  return `<div class="nb-thumb"><img class="nb-thumb-blank" src="${makePageThumbUrl(pg)}" alt="" /></div>`;
}

async function renderLibrary() {
  const list = $('#nb-list');
  list.innerHTML = '';
  const nbs = (await getAllNotebooks())
    .filter((nb) => notebookKind(nb) === libTab)
    .sort((a, b) => b.updated - a.updated);
  if (!nbs.length) {
    const msg = libTab === 'paper'
      ? 'No past papers yet. Import a PDF to annotate exam questions.'
      : 'No lessons yet. Create your first blank lesson notebook.';
    list.innerHTML = `<p class="muted lib-empty">${msg}</p>`;
    return;
  }
  for (const nb of nbs) {
    const kind = notebookKind(nb);
    const card = document.createElement('div');
    card.className = 'nb-card';
    card.innerHTML = `${notebookCardThumb(nb)}
      <div class="nb-body">
        <span class="nb-badge ${kind}">${kind === 'paper' ? 'Past paper' : 'Lesson'}</span>
        <div class="nb-title">${escapeHtml(nb.title)}</div>
        <div class="nb-meta">${allPages(nb).length} page${allPages(nb).length > 1 ? 's' : ''} · ${(nb.sections || []).length} sec · ${new Date(nb.updated).toLocaleDateString()}</div>
        <div class="nb-actions">
          <button class="open">Open</button>
          <button class="exp">Export</button>
          <button class="ren">Rename</button>
          <button class="del danger">Delete</button>
        </div>
      </div>`;
    card.querySelector('.open').onclick = () => openNotebook(nb.id);
    card.querySelector('.exp').onclick = () => exportNotebookJSON(nb);
    card.querySelector('.ren').onclick = async () => {
      const t = prompt('Rename', nb.title);
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
  const raw = await getNotebook(id);
  if (!raw) return;
  S.notebook = normalizeNotebook(raw);
  if (!S.notebook.kind) { S.notebook.kind = notebookKind(S.notebook); persist(); }
  S.sectionIndex = 0; S.pageIndex = 0; S.undo = []; S.redo = []; clearSelection();
  setPresentMode(false);
  show('editor');
  requestAnimationFrame(() => {
    resizeCanvas(); fitPage(); updatePageLabel(); updateTitle(); updatePresentTitle();
    renderSectionStrip(); loadGeoPage(page());
  });
}

async function createNotebook() {
  const t = prompt('New lesson name', 'Vectors — Lesson 1');
  if (t === null) return;
  const nb = newNotebook(t.trim() || 'Untitled lesson', 'lesson');
  await saveNotebook(nb);
  openNotebook(nb.id);
}

function clearPage() {
  if (!confirm('Clear everything on this page? You can undo with ⌘Z.')) return;
  const pg = page();
  beginAction();
  pg.strokes = []; pg.objects = []; pg.functions = [];
  pg.mechItems = []; pg.cplxLoci = []; pg.calcItems = []; pg.instruments = [];
  pg.geoItems = []; pg.geoLabelN = 0;
  delete pg.unitCircle;
  teardownGeo(); loadGeoPage(pg);
  commitAction();
  thumbCache.delete(pg.id);
  clearSelection(); setGeoTool(null); setInstTool(null);
  updatePageLabel(); persist(); mark();
}

function goToPage(i) {
  if (!S.notebook || i < 0 || i >= pages().length || i === S.pageIndex) return;
  flushGeo();
  S.pageIndex = i;
  S.undo = []; S.redo = [];
  clearSelection();
  setGeoTool(null); setInstTool(null);
  loadGeoPage(page());
  updatePageLabel();
  mark();
}

// Insert page(s) after current; wrapped for rule compliance, undo cleared (structural change).
function addPagesAfterCurrent(items) {
  const arr = Array.isArray(items) ? items : [items];
  beginAction();
  pages().splice(S.pageIndex + 1, 0, ...arr);
  S.pageIndex += 1;
  commitAction();
  S.undo = []; S.redo = [];
  clearSelection();
  updatePageLabel();
  persist();
  mark();
}

function duplicatePage(i) {
  const src = pages()[i];
  if (!src) return;
  flushGeo();
  const copy = clone(src); copy.id = uid();
  pages().splice(i + 1, 0, copy);
  S.undo = []; S.redo = [];
  S.pageIndex = i + 1;
  clearSelection(); teardownGeo(); loadGeoPage(page());
  updatePageLabel(); persist(); mark();
}
function deletePage(i) {
  if (pages().length <= 1) { alert('A notebook needs at least one page.'); return; }
  if (!confirm(`Delete page ${i + 1}? This cannot be undone.`)) return;
  flushGeo();
  thumbCache.delete(pages()[i].id);
  pages().splice(i, 1);
  if (S.pageIndex >= pages().length) S.pageIndex = pages().length - 1;
  S.undo = []; S.redo = [];
  clearSelection(); teardownGeo(); loadGeoPage(page());
  updatePageLabel(); persist(); mark();
}
function movePage(i, dir) {
  const j = i + dir;
  const arr = pages();
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  if (S.pageIndex === i) S.pageIndex = j;
  else if (S.pageIndex === j) S.pageIndex = i;
  updatePageLabel(); persist(); mark();
}
function deleteSection(i) {
  if (sections().length <= 1) { alert('A notebook needs at least one section.'); return; }
  const sec = sections()[i];
  if (!confirm(`Delete section "${sec.title}" and its ${sec.pages.length} page(s)?`)) return;
  flushGeo();
  sections().splice(i, 1);
  if (S.sectionIndex > i) S.sectionIndex--;
  if (S.sectionIndex >= sections().length) S.sectionIndex = sections().length - 1;
  S.pageIndex = 0;
  S.undo = []; S.redo = [];
  clearSelection(); teardownGeo(); loadGeoPage(page());
  renderSectionStrip(); updatePageLabel(); persist(); mark();
}

function goToSection(i) {
  if (!S.notebook || i < 0 || i >= sections().length || i === S.sectionIndex) return;
  flushGeo();
  S.sectionIndex = i;
  S.pageIndex = 0;
  S.undo = []; S.redo = [];
  clearSelection();
  setGeoTool(null); setInstTool(null);
  loadGeoPage(page());
  updatePageLabel();
  renderSectionStrip();
  mark();
}

function addSection() {
  const t = prompt('Section name', `Section ${sections().length + 1}`);
  if (t === null) return;
  beginAction();
  sections().push({ id: uid(), title: t.trim() || `Section ${sections().length + 1}`, pages: [newPage(page().paper)] });
  S.sectionIndex = sections().length - 1;
  S.pageIndex = 0;
  commitAction();
  renderSectionStrip();
  updatePageLabel();
  persist();
  mark();
}

function renderSectionStrip() {
  const wrap = $('#section-tabs');
  if (!wrap || !S.notebook) return;
  wrap.innerHTML = '';
  sections().forEach((sec, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-tab' + (i === S.sectionIndex ? ' active' : '');
    btn.textContent = sec.title;
    btn.title = sec.title;
    btn.onclick = () => goToSection(i);
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      const t = prompt('Rename section', sec.title);
      if (t && t.trim()) { sec.title = t.trim(); renderSectionStrip(); persist(); }
    };
    if (i === S.sectionIndex && sections().length > 1) {
      const x = document.createElement('span');
      x.className = 'sec-del'; x.textContent = '×'; x.title = 'Delete section';
      x.onclick = (e) => { e.stopPropagation(); deleteSection(i); };
      btn.appendChild(x);
    }
    wrap.appendChild(btn);
  });
}

function renderPageStrip() {
  const wrap = $('#page-thumbs');
  if (!wrap || !S.notebook) return;
  wrap.innerHTML = '';
  pages().forEach((pg, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'page-thumb' + (i === S.pageIndex ? ' active' : '') + (pageIsPdf(pg) ? ' pdf' : ' blank');
    btn.title = `Page ${i + 1}`;
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = pageIsPdf(pg) ? pg.background.data : makePageThumbUrl(pg);
    btn.appendChild(img);
    const num = document.createElement('span');
    num.className = 'page-thumb-num';
    num.textContent = String(i + 1);
    btn.appendChild(num);
    const acts = document.createElement('div');
    acts.className = 'page-thumb-acts';
    const mk = (txt, title, fn) => {
      const a = document.createElement('button');
      a.type = 'button'; a.className = 'pt-act'; a.textContent = txt; a.title = title;
      a.onclick = (e) => { e.stopPropagation(); fn(); };
      return a;
    };
    acts.append(
      mk('‹', 'Move left', () => movePage(i, -1)),
      mk('⧉', 'Duplicate page', () => duplicatePage(i)),
      mk('✕', 'Delete page', () => deletePage(i)),
      mk('›', 'Move right', () => movePage(i, 1)),
    );
    btn.appendChild(acts);
    btn.onclick = () => goToPage(i);
    wrap.appendChild(btn);
  });
  const active = wrap.querySelector('.page-thumb.active');
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

function updatePresentTitle() {
  const el = $('#nb-title-present');
  if (el && S.notebook) el.textContent = S.notebook.title;
}

function setPresentMode(on) {
  $('#editor').classList.toggle('present-mode', on);
  const btn = $('#present-toggle');
  btn.classList.toggle('brand-toggle-active', on);
  btn.textContent = on ? 'Exit' : 'Present';
  btn.title = on ? 'Exit present mode' : 'Present mode (classroom / projector)';
  if (on) {
    if (TOOL_TAB[S.tool] === 'maths') setTool('pen');
    else setTab('draw');
    fitPage();
  }
  updatePresentTitle();
  requestAnimationFrame(resizeCanvas);
}

// ---- editor controls ---------------------------------------------------------
function updatePageLabel() {
  $('#page-label').textContent = `${S.pageIndex + 1} / ${pages().length}`;
  const sel = $('#paper'); if (sel) sel.value = page().paper;
  const rb = $('#resultant'); if (rb) rb.classList.toggle('brand-toggle-active', !!page().showResultant);
  const pb = $('#parallelogram'); if (pb) pb.classList.toggle('brand-toggle-active', !!page().showParallelogram);
  const cb = $('#conjugate'); if (cb) cb.classList.toggle('brand-toggle-active', !!page().showConjugate);
  renderPageStrip();
  renderSectionStrip();
}
function updateTitle() { $('#nb-name').value = S.notebook.title; updatePresentTitle(); }

const TOOL_TAB = {
  pen: 'draw', highlighter: 'draw', eraser: 'draw', lasso: 'draw', select: 'draw', text: 'draw', equation: 'draw', line: 'draw', rect: 'draw', ellipse: 'draw',
  vector: 'maths', plotz: 'maths', circle: 'maths',
};
function setTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tbar-tools .group').forEach((g) => {
    g.classList.toggle('show', (g.dataset.tabs || '').split(' ').includes(name));
  });
}
function setTool(t) {
  setGeoTool(null);
  setInstTool(null);
  setMechPlacing(null);
  setCplxPlacing(null);
  S.tool = t;
  if (t !== 'lasso') clearSelection();
  if (cv) cv.classList.toggle('cur-select', t === 'select');
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  if (TOOL_TAB[t]) setTab(TOOL_TAB[t]);
}

function loadCustomColors() {
  try { return JSON.parse(localStorage.getItem('mb-custom-colors') || '[]'); }
  catch { return []; }
}
function saveCustomColor(c) {
  let list = loadCustomColors().filter((x) => x.toLowerCase() !== c.toLowerCase());
  list.unshift(c.toLowerCase());
  if (list.length > 4) list = list.slice(0, 4);
  localStorage.setItem('mb-custom-colors', JSON.stringify(list));
}
function allSwatchColors() {
  return [...COLORS, ...loadCustomColors().filter((c) => !COLORS.includes(c))];
}
function pickColor(c, el) {
  S.color = c;
  document.querySelectorAll('#swatches .swatch').forEach((x) => x.classList.remove('active'));
  if (el) el.classList.add('active');
  const pick = $('#color-pick');
  if (pick) pick.value = c;
}
function buildSwatches() {
  const sw = $('#swatches');
  if (!sw) return;
  sw.innerHTML = '';
  allSwatchColors().forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (c === S.color ? ' active' : '');
    b.style.background = c;
    b.title = c;
    b.onclick = () => pickColor(c, b);
    sw.appendChild(b);
  });
}
function setPenType(t) {
  S.penType = t;
  document.querySelectorAll('.pen-btn').forEach((b) => b.classList.toggle('active', b.dataset.pen === t));
  S.width = PEN_WIDTHS[t] || 4;
  const slider = $('#width'), val = $('#width-val');
  if (slider) slider.value = S.width;
  if (val) val.textContent = S.width;
}

function bindEditor() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  document.querySelectorAll('.tab-btn').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
  setTab('draw');
  buildSwatches();
  document.querySelectorAll('.pen-btn').forEach((b) => { b.onclick = () => setPenType(b.dataset.pen); });
  $('#color-more').onclick = () => $('#color-pick').click();
  $('#color-pick').oninput = (e) => {
    const c = e.target.value.toLowerCase();
    saveCustomColor(c);
    buildSwatches();
    const el = [...$('#swatches').querySelectorAll('.swatch')].find((s) => s.title === c);
    pickColor(c, el);
  };

  $('#width').oninput = (e) => { S.width = +e.target.value; $('#width-val').textContent = e.target.value; };
  $('#undo').onclick = doUndo;
  $('#redo').onclick = doRedo;
  $('#fit').onclick = fitPage;
  $('#present-toggle').onclick = () => setPresentMode(!$('#editor').classList.contains('present-mode'));
  $('#finger').onchange = (e) => { S.fingerDraw = e.target.checked; };

  $('#prev').onclick = () => goToPage(S.pageIndex - 1);
  $('#next').onclick = () => goToPage(S.pageIndex + 1);
  $('#strip-add').onclick = () => {
    const paper = pageIsPdf(page()) ? 'plain' : (page().paper || $('#paper').value || 'graph');
    addPagesAfterCurrent(newPage(paper));
  };
  $('#addpage').onclick = () => addPagesAfterCurrent(newPage($('#paper').value));
  $('#section-add')?.addEventListener('click', addSection);
  $('#paper').onchange = (e) => { page().paper = e.target.value; thumbCache.delete(page().id); persist(); mark(); };
  $('#resultant').onclick = () => { page().showResultant = !page().showResultant; updatePageLabel(); persist(); mark(); };
  $('#parallelogram').onclick = () => { page().showParallelogram = !page().showParallelogram; updatePageLabel(); persist(); mark(); };
  $('#conjugate').onclick = () => { page().showConjugate = !page().showConjugate; updatePageLabel(); persist(); mark(); };
  $('#snap').onchange = (e) => { S.snap = e.target.checked; };
  $('#radians').onchange = (e) => { S.radians = e.target.checked; mark(); };
  $('#polar').onchange = (e) => { S.polar = e.target.checked; mark(); };

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
  $('#export-json').onclick = () => { if (S.notebook) exportNotebookJSON(S.notebook); };
  $('#share-lesson').onclick = async () => {
    if (!S.notebook) return;
    const r = await shareNotebook(S.notebook);
    if (r === 'downloaded') { /* fallback export already ran */ }
  };
  $('#insert-pdf').onclick = () => $('#pdf-file').click();
  $('#insert-img').onclick = () => $('#img-file').click();
  $('#clear-page').onclick = clearPage;
  $('#pdf-file').onchange = (e) => { const f = e.target.files[0]; if (f) insertPdfIntoNotebook(f); e.target.value = ''; };
  $('#img-file').onchange = (e) => { const f = e.target.files[0]; if (f) insertImageFile(f); e.target.value = ''; };
  document.querySelectorAll('[data-geo]').forEach((b) => {
    if (!b.dataset.geo) return;
    b.onclick = () => { setInstTool(null); setGeoTool(b.dataset.geo); setTab('maths'); };
  });
  document.querySelectorAll('[data-inst]').forEach((b) => {
    b.onclick = () => { setGeoTool(null); setInstTool(b.dataset.inst); setTab('maths'); };
  });
  $('#geo-clear').onclick = () => {
    if (confirm('Clear all geometry on this page?')) clearGeoPage();
  };
  $('#back').onclick = () => { S.playing = false; setPresentMode(false); setGeoTool(null); setInstTool(null); teardownGeo(); show('library'); renderLibrary(); };

  $('#nb-name').onchange = (e) => { S.notebook.title = e.target.value.trim() || 'Untitled lesson'; persist(); };

  // keyboard shortcuts (desktop)
  window.addEventListener('keydown', (e) => {
    if ($('#editor').classList.contains('hidden')) return;
    if (/^(INPUT|TEXTAREA|SELECT|MATH-FIELD)$/.test(e.target.tagName)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
    else if (e.key === 'p') setTool('pen');
    else if (e.key === 'h') setTool('highlighter');
    else if (e.key === 'e') setTool('eraser');
    else if (e.key === 'l') setTool('lasso');
    else if (e.key === 's') setTool('select');
    else if (e.key === 'v') setTool('vector');
    else if (e.key === 'z') setTool('plotz');
    else if (e.key === 't') setTool('text');
    else if (e.key === 'q') setTool('equation');
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setPresentMode(!$('#editor').classList.contains('present-mode')); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && (S.selObj || S.selStrokes.length)) { e.preventDefault(); deleteSelection(); }
  });
}

function bindCanvas() {
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch') { S.touch.delete(e.pointerId); setGestureRef(); } });
  cv.addEventListener('wheel', onWheel, { passive: false });
  // double-tap a text box (any tool) to edit it
  cv.addEventListener('dblclick', (e) => {
    const p = toPage(...cssArr(e));
    const hit = [...objs()].reverse().find((o) => o.kind === 'text' && pointInText(o, p));
    if (hit) { beginAction(); openTextEditor(hit); }
  });
  window.addEventListener('resize', resizeCanvas);
}

// ---- fx-991-equivalent scientific calculator --------------------------------
let calcDeg = true, calcAns = 0, mathFrac = null, calcShift = false, calcAlpha = false;
let calcLastExpr = null, calcResultValue = null, calcDisplayMode = 0; // 0=D 1=frac 2=surd
let intgMode = 'integral';
const calcVars = {};            // STO/RCL/ALPHA variables A–F, X, Y, M
let stoPending = false, rclAlpha = false, hypPending = false;
const SHIFT_MAP = {
  'sin(': 'asin(', 'cos(': 'acos(', 'tan(': 'atan(', 'log(': 'e^(', 'log10(': '10^(',
  '^': 'nthRoot(', 'sqrt(': 'cbrt(', '^2': '^3', 'inv': '!', 'e10': 'pi', 'int': 'diff',
  'hyp': 'abs(', '*': 'permutations(', '/': 'combinations(', 'rcl': 'sto', 'mplus': 'mminus',
  'ran': 'ranint', 'ac': 'off', 'pol': 'rec', 'sum': 'prod',
};
const CALC_FMT = ['D', 'F', '√'];

function showCalcView(view) {
  $('#calc-keys').classList.toggle('hidden', view !== 'keys');
  document.querySelector('.calc-ctl')?.classList.toggle('hidden', view !== 'keys');
  document.querySelector('.calc-funcs')?.classList.toggle('hidden', view !== 'keys');
  $('#calc-table').classList.toggle('hidden', view !== 'table');
  $('#calc-matrix').classList.toggle('hidden', view !== 'matrix');
  $('#calc-intg')?.classList.toggle('hidden', view !== 'intg');
  $('#calc-eqn')?.classList.toggle('hidden', view !== 'eqn');
  $('#calc-base')?.classList.toggle('hidden', view !== 'base');
  const mn = $('#calc-modename');
  const names = { table: 'TABLE', matrix: 'MATRIX', eqn: 'EQN', base: 'BASE-N', intg: intgMode === 'derivative' ? 'd/dx' : '∫dx' };
  if (mn) mn.textContent = names[view] || 'COMP';
}
function calcReset() {
  calcSetExpr(''); $('#calc-result').textContent = '0'; $('#calc-history').textContent = '';
  calcResultValue = null; calcShift = false; calcAlpha = false; stoPending = false; rclAlpha = false; hypPending = false;
  $('#calc-shift-ind')?.classList.remove('on'); $('#calc-alpha-ind')?.classList.remove('on');
  $('#calc-mode-menu')?.classList.add('hidden');
  showCalcView('keys');
  calcExprEl()?.focus();
}
function toggleModeMenu() { $('#calc-mode-menu')?.classList.toggle('hidden'); }
function setCalcMode(m) {
  $('#calc-mode-menu')?.classList.add('hidden');
  if (m === 'keys') showCalcView('keys');
  else if (m === 'intg-integral') openIntg('integral');
  else if (m === 'intg-derivative') openIntg('derivative');
  else if (m === 'table') showCalcView('table');
  else if (m === 'matrix') { showCalcView('matrix'); $('#mx-tab-mat')?.click(); }
  else if (m === 'vector') { showCalcView('matrix'); $('#mx-tab-vec')?.click(); }
  else if (m === 'eqn') openEqn();
  else if (m === 'base') showCalcView('base');
  else if (m === 'deg') setCalcDeg(true);
  else if (m === 'rad') setCalcDeg(false);
}
function setCalcDeg(on) { calcDeg = on; const m = $('#calc-mode'); if (m) m.textContent = on ? 'DEG' : 'RAD'; }
function openIntg(mode) {
  intgMode = mode === 'derivative' ? 'derivative' : 'integral';
  $('#calc-mode-menu')?.classList.add('hidden');
  showCalcView('intg');
  $('#intg-bounds')?.classList.toggle('hidden', intgMode === 'derivative');
  $('#intg-point')?.classList.toggle('hidden', intgMode !== 'derivative');
  $('#intg-tab-int')?.classList.toggle('active', intgMode === 'integral');
  $('#intg-tab-der')?.classList.toggle('active', intgMode === 'derivative');
}
// numeric definite integral (composite Simpson) using the calculator angle mode
function simpsonCalc(node, a, b, n = 400) {
  if (a === b) return 0;
  if (n % 2) n++;
  const sc = calcScope();
  const f = (x) => node.evaluate({ ...sc, x });
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (h / 3) * s;
}
function calcComputeIntg() {
  const out = $('#intg-out');
  const fx = $('#intg-fx').value.trim();
  if (!fx) { out.innerHTML = '<div class="ct-err">Enter f(x).</div>'; return; }
  let node;
  try { node = math.compile(fx); } catch (_) { out.innerHTML = '<div class="ct-err">Check f(x).</div>'; return; }
  const toL = window.MathLive?.convertAsciiMathToLatex;
  try {
    if (intgMode === 'derivative') {
      const x0 = Number(math.evaluate($('#intg-x0').value || '0', calcScope()));
      const sc = calcScope();
      const h = 1e-5;
      const d = (node.evaluate({ ...sc, x: x0 + h }) - node.evaluate({ ...sc, x: x0 - h })) / (2 * h);
      let sym = '';
      try { sym = math.derivative(fx, 'x').toString(); } catch (_) {}
      calcResultValue = d; calcDisplayMode = 0;
      if (toL) calcSetExpr(`\\frac{d}{dx}\\left(${toL(fx)}\\right)\\Big|_{x=${toL(String($('#intg-x0').value || '0'))}}`);
      $('#calc-history').textContent = sym ? `f'(x) = ${sym}` : 'd/dx';
      calcRenderResult();
      out.innerHTML = `<div class="ct-ok">f′(${fmt(x0)}) = ${calcFormatPlain(d)}${sym ? `<br>f′(x) = ${escapeHtml(sym)}` : ''}</div>`;
    } else {
      const a = Number(math.evaluate($('#intg-a').value || '0', calcScope()));
      const b = Number(math.evaluate($('#intg-b').value || '0', calcScope()));
      const val = simpsonCalc(node, a, b);
      calcResultValue = val; calcDisplayMode = 0;
      if (toL) calcSetExpr(`\\int_{${toL(String($('#intg-a').value || '0'))}}^{${toL(String($('#intg-b').value || '0'))}}\\left(${toL(fx)}\\right)\\,dx`);
      $('#calc-history').textContent = `∫ from ${fmt(a)} to ${fmt(b)}`;
      calcRenderResult();
      out.innerHTML = `<div class="ct-ok">∫ = ${calcFormatPlain(val)}</div>`;
    }
  } catch (e) { out.innerHTML = '<div class="ct-err">Could not compute. Check inputs &amp; angle mode.</div>'; }
}

// ---- EQN mode: simultaneous (2/3), quadratic, cubic --------------------------
let eqnType = 'lin2';
const EQN_SPEC = {
  lin2: { rows: 2, labels: ['a', 'b', 'c'], hint: 'a·x + b·y = c' },
  lin3: { rows: 3, labels: ['a', 'b', 'c', 'd'], hint: 'a·x + b·y + c·z = d' },
  quad: { rows: 1, labels: ['a', 'b', 'c'], hint: 'a·x² + b·x + c = 0' },
  cubic: { rows: 1, labels: ['a', 'b', 'c', 'd'], hint: 'a·x³ + b·x² + c·x + d = 0' },
};
function openEqn() { showCalcView('eqn'); renderEqnFields(); }
function renderEqnFields() {
  const spec = EQN_SPEC[eqnType];
  document.querySelectorAll('[data-eqn]').forEach((b) => b.classList.toggle('active', b.dataset.eqn === eqnType));
  const hint = $('#eqn-hint'); if (hint) hint.textContent = spec.hint;
  const wrap = $('#eqn-fields'); if (!wrap) return;
  wrap.innerHTML = '';
  for (let r = 0; r < spec.rows; r++) {
    const row = document.createElement('div');
    row.className = 'eqn-row';
    spec.labels.forEach((lab, c) => {
      const inp = document.createElement('input');
      inp.className = 'ct-in';
      inp.id = `eqn-${r}-${c}`;
      inp.placeholder = lab;
      inp.value = (spec.rows === 1) ? (c === 0 ? '1' : '0') : '';
      row.appendChild(inp);
    });
    wrap.appendChild(row);
  }
}
function eqnVal(r, c) { return Number(math.evaluate($(`#eqn-${r}-${c}`).value || '0')); }
// Durand–Kerner: all roots (real + complex) of a polynomial given coeffs high→low
function polyRoots(coeffs) {
  let c = coeffs.slice();
  while (c.length > 1 && Math.abs(c[0]) < 1e-12) c.shift();
  const n = c.length - 1;
  if (n < 1) return [];
  const a = c.map((k) => math.complex(k / c[0], 0));
  let roots = [];
  for (let i = 0; i < n; i++) roots.push(math.pow(math.complex(0.4, 0.9), i));
  const evalP = (x) => { let s = math.complex(0, 0); for (let i = 0; i <= n; i++) s = math.add(math.multiply(s, x), a[i]); return s; };
  for (let iter = 0; iter < 100; iter++) {
    let maxd = 0;
    const next = roots.map((ri, i) => {
      let denom = math.complex(1, 0);
      for (let j = 0; j < n; j++) if (j !== i) denom = math.multiply(denom, math.subtract(ri, roots[j]));
      const delta = math.divide(evalP(ri), denom);
      maxd = Math.max(maxd, math.abs(delta));
      return math.subtract(ri, delta);
    });
    roots = next;
    if (maxd < 1e-12) break;
  }
  return roots;
}
function fmtComplexRoot(z) {
  const re = z.re, im = z.im;
  const r = Math.abs(re) < 1e-9 ? 0 : re, i = Math.abs(im) < 1e-9 ? 0 : im;
  if (i === 0) return calcFormatPlain(r);
  return `${calcFormatPlain(r)} ${i < 0 ? '−' : '+'} ${calcFormatPlain(Math.abs(i))}i`;
}
function solveEqn() {
  const out = $('#eqn-out');
  try {
    if (eqnType === 'lin2' || eqnType === 'lin3') {
      const n = eqnType === 'lin2' ? 2 : 3;
      const A = [], b = [];
      for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(eqnVal(r, c)); A.push(row); b.push(eqnVal(r, n)); }
      const x = math.lusolve(A, b).map((v) => v[0]);
      const names = ['x', 'y', 'z'];
      out.innerHTML = '<div class="ct-ok">' + x.map((v, i) => `${names[i]} = ${calcFormatPlain(v)}`).join('<br>') + '</div>';
    } else {
      const labels = EQN_SPEC[eqnType].labels;
      const coeffs = labels.map((_, c) => eqnVal(0, c));
      const roots = polyRoots(coeffs);
      out.innerHTML = '<div class="ct-ok">' + roots.map((z, i) => `x<sub>${i + 1}</sub> = ${fmtComplexRoot(z)}`).join('<br>') + '</div>';
    }
  } catch (e) { out.innerHTML = '<div class="ct-err">No unique solution (check coefficients).</div>'; }
}

// ---- BASE-N mode -------------------------------------------------------------
function baseConvert() {
  const out = $('#base-out');
  const raw = ($('#base-in').value || '').trim().replace(/^0[xbo]/i, '');
  const from = Number($('#base-from').value || '10');
  const n = parseInt(raw, from);
  if (!Number.isFinite(n) || Number.isNaN(n)) { out.innerHTML = '<div class="ct-err">Invalid digits for that base.</div>'; return; }
  out.innerHTML = '<div class="ct-ok">' +
    `DEC = ${n}<br>BIN = ${(n >>> 0).toString(2)}<br>OCT = ${n.toString(8)}<br>HEX = ${n.toString(16).toUpperCase()}` +
    '</div>';
}
function calcScope() {
  const toRad = (x) => calcDeg ? x * Math.PI / 180 : x;
  const fromRad = (x) => calcDeg ? x * 180 / Math.PI : x;
  return {
    sin: (x) => Math.sin(toRad(x)), cos: (x) => Math.cos(toRad(x)), tan: (x) => Math.tan(toRad(x)),
    asin: (x) => fromRad(Math.asin(x)), acos: (x) => fromRad(Math.acos(x)), atan: (x) => fromRad(Math.atan(x)),
    Pol: (x, y) => math.matrix([[Math.hypot(x, y), fromRad(Math.atan2(y, x))]]),
    Rec: (r, t) => { const a = toRad(t); return math.matrix([[r * Math.cos(a), r * Math.sin(a)]]); },
    Ans: calcAns, ...calcVars,
  };
}
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = b; b = a % b; a = t; } return a || 1; }
function fracHtml(n, d) {
  if (!d) return String(n);
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d); n /= g; d /= g;
  if (d === 1) return String(n);
  return `<span class="c-frac"><span class="c-num">${n}</span><span class="c-bar"></span><span class="c-den">${d}</span></span>`;
}
function surdHtml(k, n) {
  const g = gcd(k, n); k /= g; n /= g;
  let out = '';
  if (k === -1) out = '−';
  else if (k !== 1 && k !== -1) out = String(k);
  if (n === 1) return out || '0';
  out += `<span class="c-surd"><span class="c-sqrt">√</span>${n > 1 ? n : ''}</span>`;
  return out;
}
function trySurdDecimal(x) {
  if (!isFinite(x) || x === 0) return null;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  for (let n = 2; n <= 500; n++) {
    const k = ax / Math.sqrt(n);
    if (Math.abs(k - Math.round(k)) < 1e-9) return surdHtml(sign * Math.round(k), n);
  }
  return null;
}
function calcFormatValue(val, mode) {
  if (val == null) return '0';
  const t = math.typeOf(val);
  if (t === 'Complex' || (val && val.re != null && val.im != null)) {
    const re = val.re ?? val, im = val.im ?? 0;
    if (Math.abs(im) < 1e-12) return calcFormatValue(re, mode);
    const rp = calcFormatValue(re, mode), ip = calcFormatValue(Math.abs(im), mode);
    const sign = im < 0 ? ' − ' : ' + ';
    const ii = Math.abs(im) === 1 ? 'i' : `${ip}i`;
    return `${rp}${sign}${ii}`;
  }
  if (t === 'Matrix' || (val && val.size)) {
    const s = val.size();
    const rows = [];
    for (let r = 0; r < s[0]; r++) {
      const row = [];
      for (let c = 0; c < s[1]; c++) row.push(calcFormatPlain(val.get([r, c])));
      rows.push(`[${row.join(', ')}]`);
    }
    return rows.join('\n');
  }
  if (mode === 1) {
    try {
      const f = mathFrac.fraction(val);
      if (f && Number.isFinite(f.n) && Number.isFinite(f.d)) return fracHtml(f.s * f.n, f.d);
    } catch (_) { /* decimal */ }
  }
  if (mode === 2) {
    if (typeof val === 'number') {
      const s = trySurdDecimal(val);
      if (s) return s;
    }
    try {
      const simp = math.simplify(math.parse(String(calcLastExpr || val)));
      const str = simp.toString();
      if (/sqrt|√/.test(str)) return str.replace(/sqrt\((\d+)\)/g, '<span class="c-surd"><span class="c-sqrt">√</span>$1</span>');
    } catch (_) { /* fall through */ }
  }
  return calcFormatPlain(val);
}
function calcFormatPlain(val) {
  if (typeof val === 'number' && isFinite(val)) {
    if (Math.abs(val) >= 1e10 || (Math.abs(val) > 0 && Math.abs(val) < 1e-4)) return val.toExponential(6).replace('+', '');
    return math.format(val, { precision: 10 });
  }
  return math.format(val, { precision: 10 });
}
function calcRenderResult() {
  const out = $('#calc-result'), ind = $('#calc-fmt-ind');
  if (!out) return;
  if (calcResultValue == null) { out.textContent = '0'; if (ind) ind.textContent = 'D'; return; }
  if (ind) ind.textContent = CALC_FMT[calcDisplayMode] || 'D';
  out.innerHTML = calcFormatValue(calcResultValue, calcDisplayMode);
}
function calcExprEl() { return $('#calc-expr'); }
// read one {..} group starting at s[i]==='{'; returns [content, indexAfterClosingBrace]
function readBraceGroup(s, i) {
  let depth = 0, j = i, out = '';
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '{') { depth++; if (depth === 1) continue; }
    else if (c === '}') { depth--; if (depth === 0) return [out, j + 1]; }
    out += c;
  }
  return [out, j];
}
// convert MathLive LaTeX into a mathjs-evaluable string (handles \frac, \sqrt, ^{}, etc.)
function latexToMath(src) {
  if (!src) return '';
  let s = src
    .replace(/\\left|\\right/g, '')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\pi/g, 'pi')
    .replace(/\\operatorname\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .replace(/\\placeholder\{\}|\\!|\\,|\\;|\\:|\\ /g, '')
    .replace(/\\%/g, '%');
  // read either a {group} or a single token (char or \command) for \frac / \sqrt args
  const readArg = (str, i) => {
    while (str[i] === ' ') i++;
    if (str[i] === '{') return readBraceGroup(str, i);
    if (str[i] === '\\') { let j = i + 1; while (j < str.length && /[a-zA-Z]/.test(str[j])) j++; return [str.slice(i, j), j]; }
    return [str[i] || '', i + 1];
  };
  const conv = (str) => {
    let out = '';
    for (let i = 0; i < str.length;) {
      if (str.startsWith('\\frac', i)) {
        i += 5;
        const [num, a] = readArg(str, i); i = a;
        const [den, b] = readArg(str, i); i = b;
        out += '((' + conv(num) + ')/(' + conv(den) + '))';
      } else if (str.startsWith('\\sqrt', i)) {
        i += 5;
        if (str[i] === '[') { const j = str.indexOf(']', i); const n = str.slice(i + 1, j); i = j + 1; const [g, a] = readArg(str, i); i = a; out += 'nthRoot((' + conv(g) + '),(' + conv(n) + '))'; }
        else { const [g, a] = readArg(str, i); i = a; out += 'sqrt(' + conv(g) + ')'; }
      } else if (str[i] === '^') {
        i++;
        if (str[i] === '{') { const [g, a] = readBraceGroup(str, i); i = a; out += '^(' + conv(g) + ')'; }
        else { out += '^' + (str[i] || ''); i++; }
      } else if (str[i] === '_') {
        i++;
        if (str[i] === '{') { const [, a] = readBraceGroup(str, i); i = a; } else i++;
      } else if (str[i] === '{') {
        const [g, a] = readBraceGroup(str, i); i = a; out += '(' + conv(g) + ')';
      } else if (str[i] === '\\') {
        // strip an unknown leading backslash but keep the command letters
        i++;
      } else { out += str[i]; i++; }
    }
    return out;
  };
  return conv(s).trim();
}
function calcGetExpr() {
  const el = calcExprEl();
  if (!el) return '';
  if (typeof el.getValue === 'function') {
    try { const tex = el.getValue('latex'); if (tex) return latexToMath(tex); } catch (_) { /* fall back */ }
    try { return (el.getValue() || '').trim(); } catch (_) { return (el.value || '').trim(); }
  }
  return (el.value || '').trim();
}
function calcSetExpr(v) {
  const el = calcExprEl();
  if (!el) return;
  if (typeof el.setValue === 'function') el.setValue(v);
  else el.value = v;
  el.focus?.();
}
function calcInsert(token) {
  const el = calcExprEl();
  if (!el) return;
  if (typeof el.executeCommand === 'function') { el.executeCommand('insert', token); el.focus(); return; }
  el.value = (el.value || '') + token;
  el.focus();
}
function calcEvaluate() {
  const hist = $('#calc-history');
  const expr = calcGetExpr();
  if (!expr) return;
  try {
    const res = math.evaluate(expr, calcScope());
    if (typeof res === 'function' || res === undefined) { $('#calc-result').textContent = 'Error'; return; }
    calcAns = res; calcLastExpr = expr; calcResultValue = res; calcDisplayMode = 0;
    if (hist) hist.textContent = `${expr} =`;
    calcRenderResult();
  } catch (e) { $('#calc-result').textContent = 'Error'; }
}
function calcToggleSD() {
  if (calcResultValue == null) return;
  calcDisplayMode = (calcDisplayMode + 1) % CALC_FMT.length;
  calcRenderResult();
}
function calcRecall() {
  if (!calcLastExpr) return;
  calcSetExpr(calcLastExpr);
}
function calcKey(k, el) {
  const inp = calcExprEl();
  if (k === 'shift') { calcShift = !calcShift; $('#calc-shift-ind').classList.toggle('on', calcShift); return; }
  if (k === 'alpha') { calcAlpha = !calcAlpha; $('#calc-alpha-ind')?.classList.toggle('on', calcAlpha); return; }
  const sh = calcShift;
  if (sh) { calcShift = false; $('#calc-shift-ind').classList.remove('on'); }
  const al = calcAlpha || rclAlpha;
  if (calcAlpha) { calcAlpha = false; }
  // control keys (work regardless of shift/alpha)
  if (k === 'on') { calcReset(); return; }
  if (k === 'ac') { if (sh) return; calcReset(); return; } // SHIFT+AC = OFF (ignored)
  if (k === 'mode') { toggleModeMenu(); return; }
  if (k === 'up') { calcRecall(); return; }
  if (k === 'down') { return; }
  if (k === 'left') { inp?.executeCommand?.('moveToPreviousChar'); inp?.focus?.(); return; }
  if (k === 'right') { inp?.executeCommand?.('moveToNextChar'); inp?.focus?.(); return; }
  if (k === 'del') {
    if (inp?.executeCommand) inp.executeCommand('deleteBackward');
    else if (inp) inp.value = inp.value.slice(0, -1);
    inp?.focus(); rclAlpha = false; $('#calc-alpha-ind')?.classList.remove('on'); return;
  }
  // ALPHA variable letters (A–F, X, Y, M, i, e) read from the key's red label
  const letter = el?.querySelector?.('.al')?.textContent?.trim();
  if (stoPending) {
    if (letter && /^[A-FXYM]$/.test(letter)) { calcVars[letter] = Number(calcAns) || 0; $('#calc-history').textContent = `${calcAns} → ${letter}`; }
    stoPending = false; return;
  }
  if (al && letter) { rclAlpha = false; $('#calc-alpha-ind')?.classList.remove('on'); calcInsert(letter); return; }
  rclAlpha = false; $('#calc-alpha-ind')?.classList.remove('on');
  // hyp prefix: hyp then sin/cos/tan -> sinh/cosh/tanh (SHIFT for inverse)
  if (hypPending && (k === 'sin(' || k === 'cos(' || k === 'tan(')) {
    hypPending = false;
    const base = k === 'sin(' ? 'sinh(' : k === 'cos(' ? 'cosh(' : 'tanh(';
    calcInsert(sh ? 'a' + base : base);
    return;
  }
  if (k === 'matrix') { showCalcView('matrix'); return; }
  if (k === 'table') { showCalcView('table'); return; }
  if (k === 'calc') { if (sh) { alert('SOLVE: use the Graph or Calculus tools to solve / find roots.'); return; } calcRecall(); return; }
  if (k === 'eq') { calcEvaluate(); return; }
  if (k === 'sd') { calcToggleSD(); return; }
  if (k === 'rcl') { if (sh) { stoPending = true; $('#calc-history').textContent = 'STO _'; } else { rclAlpha = true; $('#calc-alpha-ind')?.classList.add('on'); } return; }
  if (k === 'mplus') { const v = Number(calcResultValue) || 0; calcVars.M = (Number(calcVars.M) || 0) + (sh ? -v : v); $('#calc-history').textContent = `M = ${calcVars.M}`; return; }
  let token = (k === 'ans') ? 'Ans' : k;
  if (sh && SHIFT_MAP[k]) token = SHIFT_MAP[k];
  if (token === 'int') { openIntg('integral'); return; }
  if (token === 'diff') { openIntg('derivative'); return; }
  if (token === 'frac') {
    if (inp?.executeCommand) inp.executeCommand('insert', '\\frac{\\placeholder{}}{\\placeholder{}}');
    else calcInsert('()/()');
    inp?.focus?.(); return;
  }
  if (token === 'inv') { calcInsert('^(-1)'); return; }
  if (token === 'neg') { calcInsert('-'); return; }
  if (token === 'e10') { calcInsert('*10^('); return; }
  if (token === 'ran') { calcInsert('random()'); return; }
  if (token === 'ranint') { calcInsert('randomInt('); return; }
  if (token === 'mminus') { const v = Number(calcResultValue) || 0; calcVars.M = (Number(calcVars.M) || 0) - v; $('#calc-history').textContent = `M = ${calcVars.M}`; return; }
  if (token === 'hyp') { hypPending = true; $('#calc-history').textContent = 'hyp _ (sin/cos/tan)'; return; }
  if (token === 'pol') { calcInsert('Pol('); return; }
  if (token === 'rec') { calcInsert('Rec('); return; }
  // keys present on the faceplate but not yet wired to an engine action (visual fidelity)
  if (['dms', 'eng', 'sum', 'prod', 'drg', 'off'].includes(token)) return;
  calcInsert(token);
}
function calcGenTable() {
  const out = $('#ct-out');
  const fx = $('#ct-fx').value.trim();
  let start, end, step;
  try { start = Number(math.evaluate($('#ct-start').value || '0')); end = Number(math.evaluate($('#ct-end').value || '0')); step = Number(math.evaluate($('#ct-step').value || '1')); }
  catch (e) { out.innerHTML = '<div class="ct-err">Check start / end / step.</div>'; return; }
  if (!fx || !isFinite(start) || !isFinite(end) || !step || !isFinite(step)) { out.innerHTML = '<div class="ct-err">Enter f(x) and valid start / end / step.</div>'; return; }
  const dir = step > 0 ? 1 : -1;
  let rows = '<table class="ct-table"><tr><th>x</th><th>f(x)</th></tr>', n = 0;
  for (let x = start; dir > 0 ? x <= end + 1e-9 : x >= end - 1e-9; x += step) {
    let y;
    try { y = math.format(math.evaluate(fx, { ...calcScope(), x }), { precision: 8 }); } catch (e) { y = '—'; }
    rows += `<tr><td>${math.format(x, { precision: 8 })}</td><td>${y}</td></tr>`;
    if (++n > 250) break;
  }
  out.innerHTML = rows + '</table>';
}
function mxRead(id) { return Number($('#' + id).value || '0'); }
function mxMat2(prefix) {
  return math.matrix([[mxRead(prefix + '00'), mxRead(prefix + '01')], [mxRead(prefix + '10'), mxRead(prefix + '11')]]);
}
function mxShow(m) {
  const out = $('#mx-out');
  if (m == null) { out.innerHTML = '<div class="ct-err">Error</div>'; return; }
  if (Array.isArray(m)) {
    out.textContent = '(' + m.map((v) => calcFormatPlain(v)).join(', ') + ')';
    return;
  }
  if (m.size && typeof m.get === 'function') {
    const s = m.size();
    if (s.length === 2) {
      let html = '<div class="mx-mat">';
      for (let r = 0; r < s[0]; r++) {
        const row = [];
        for (let c = 0; c < s[1]; c++) row.push(calcFormatPlain(m.get([r, c])));
        html += row.join('  ') + '\n';
      }
      out.innerHTML = html + '</div>';
      return;
    }
  }
  out.textContent = calcFormatPlain(m);
}
function calcMatrixOp(op) {
  const A = mxMat2('ma'), B = mxMat2('mb');
  try {
    if (op === 'detA') mxShow(math.det(A));
    else if (op === 'invA') mxShow(math.inv(A));
    else if (op === 'tA') mxShow(math.transpose(A));
    else if (op === 'AB') mxShow(math.multiply(A, B));
    else if (op === 'ApB') mxShow(math.add(A, B));
  } catch (e) { $('#mx-out').innerHTML = '<div class="ct-err">Error</div>'; }
}
function calcVectorOp(op) {
  const u = math.matrix([mxRead('vu0'), mxRead('vu1'), mxRead('vu2')]);
  const v = math.matrix([mxRead('vv0'), mxRead('vv1'), mxRead('vv2')]);
  try {
    if (op === 'dot') mxShow(math.dot(u, v));
    else if (op === 'cross') mxShow(math.cross(u, v));
    else if (op === 'mag') mxShow(math.norm(u));
    else if (op === 'ang') {
      const d = math.dot(u, v), nu = math.norm(u), nv = math.norm(v);
      const ang = math.acos(d / (nu * nv)) * (calcDeg ? 180 / Math.PI : 1);
      mxShow(ang);
    }
  } catch (e) { $('#mx-out').innerHTML = '<div class="ct-err">Error</div>'; }
}
function setupCalculator() {
  if (!window.math) { $('#calc-toggle').style.display = 'none'; return; }
  mathFrac = math.create(math.all); mathFrac.config({ number: 'Fraction' });
  document.querySelectorAll('#calc [data-k]').forEach((b) => b.onclick = () => calcKey(b.dataset.k, b));
  $('#calc-toggle').onclick = () => { $('#calc').classList.toggle('hidden'); calcExprEl()?.focus(); };
  $('#calc-close').onclick = () => $('#calc').classList.add('hidden');
  $('#calc-mode').onclick = () => setCalcDeg(!calcDeg);
  const mf = calcExprEl();
  if (mf) {
    try { mf.smartMode = false; mf.smartFence = false; mf.mathVirtualKeyboardPolicy = 'manual'; } catch (_) {}
    if (mf.setOptions) { try { mf.setOptions({ smartMode: false, smartFence: false }); } catch (_) {} }
  }
  mf?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); calcEvaluate(); } });
  document.querySelectorAll('[data-cmode]').forEach((b) => b.onclick = () => setCalcMode(b.dataset.cmode));
  $('#intg-back').onclick = () => showCalcView('keys');
  $('#intg-go').onclick = calcComputeIntg;
  $('#intg-tab-int').onclick = () => openIntg('integral');
  $('#intg-tab-der').onclick = () => openIntg('derivative');
  document.querySelectorAll('[data-eqn]').forEach((b) => b.onclick = () => { eqnType = b.dataset.eqn; renderEqnFields(); });
  $('#eqn-back').onclick = () => showCalcView('keys');
  $('#eqn-go').onclick = solveEqn;
  $('#base-back').onclick = () => showCalcView('keys');
  $('#base-go').onclick = baseConvert;
  $('#ct-back').onclick = () => showCalcView('keys');
  $('#cm-back').onclick = () => showCalcView('keys');
  $('#ct-gen').onclick = calcGenTable;
  $('#mx-tab-mat').onclick = () => { $('#mx-tab-mat').classList.add('active'); $('#mx-tab-vec').classList.remove('active'); $('#mx-mat').classList.remove('hidden'); $('#mx-vec').classList.add('hidden'); };
  $('#mx-tab-vec').onclick = () => { $('#mx-tab-vec').classList.add('active'); $('#mx-tab-mat').classList.remove('active'); $('#mx-vec').classList.remove('hidden'); $('#mx-mat').classList.add('hidden'); };
  document.querySelectorAll('[data-mx]').forEach((b) => b.onclick = () => calcMatrixOp(b.dataset.mx));
  document.querySelectorAll('[data-vx]').forEach((b) => b.onclick = () => calcVectorOp(b.dataset.vx));
  makeDraggable($('#calc'), $('#calc-head'));
}
function makeDraggable(panel, handle) {
  let sx, sy, ox, oy, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.calc-x')) return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    panel.style.left = (ox + e.clientX - sx) + 'px';
    panel.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
  });
  handle.addEventListener('pointerup', () => { dragging = false; });
}

// ---- function grapher panel -------------------------------------------------
function renderGraphList() {
  const list = $('#gp-list'); list.innerHTML = '';
  fns().forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'gp-row' + (f.mode === 'param' ? ' gp-row-param' : '');
    const dot = document.createElement('span'); dot.className = 'gp-dot'; dot.style.background = f.color;
    const mode = document.createElement('select'); mode.className = 'gp-mode';
    mode.innerHTML = '<option value="y">y(x)</option><option value="param">param</option>';
    mode.value = f.mode === 'param' ? 'param' : 'y';
    mode.onchange = () => {
      f.mode = mode.value;
      if (f.mode === 'param' && !f.exprX) { f.exprX = 'cos(t)'; f.exprY = 'sin(t)'; f.tMin = 0; f.tMax = 6.283; }
      renderGraphList(); persist(); mark();
    };
    const del = document.createElement('button'); del.className = 'gp-del'; del.textContent = '×'; del.title = 'Remove';
    del.onclick = () => { beginAction(); fns().splice(i, 1); commitAction(); renderGraphList(); persist(); mark(); };
    row.append(dot, mode);
    if (f.mode === 'param') {
      const mkIn = (ph, val, key) => {
        const wrap = document.createElement('div'); wrap.className = 'gp-param-line';
        const lab = document.createElement('span'); lab.className = 'gp-eq'; lab.textContent = key;
        const inp = document.createElement('input'); inp.className = 'gp-in'; inp.placeholder = ph; inp.value = val || '';
        inp.oninput = () => { f[key] = inp.value; persist(); mark(); };
        wrap.append(lab, inp); return wrap;
      };
      row.append(mkIn('cos(t)', f.exprX, 'exprX'), mkIn('sin(t)', f.exprY, 'exprY'));
      const tr = document.createElement('div'); tr.className = 'gp-param-line';
      ['tMin', 'tMax'].forEach((k) => {
        const inp = document.createElement('input'); inp.className = 'gp-in'; inp.style.flex = '1';
        inp.value = f[k] ?? (k === 'tMin' ? 0 : 6.283);
        inp.oninput = () => { f[k] = +inp.value || 0; persist(); mark(); };
        tr.appendChild(inp);
      });
      row.append(tr);
    } else {
      const eq = document.createElement('span'); eq.className = 'gp-eq'; eq.textContent = 'y =';
      const inp = document.createElement('input'); inp.className = 'gp-in'; inp.type = 'text'; inp.value = f.expr || ''; inp.placeholder = 'sin(x)';
      inp.oninput = () => { f.expr = inp.value; persist(); mark(); };
      const ampWrap = document.createElement('div'); ampWrap.className = 'gp-param-line';
      const ampLab = document.createElement('span'); ampLab.className = 'gp-eq'; ampLab.textContent = 'A';
      const ampIn = document.createElement('input'); ampIn.className = 'gp-in'; ampIn.type = 'text'; ampIn.placeholder = '1'; ampIn.value = f.amp ?? '';
      ampIn.oninput = () => { f.amp = ampIn.value.trim(); applyGraphAmp(f); persist(); mark(); };
      const perLab = document.createElement('span'); perLab.className = 'gp-eq'; perLab.textContent = 'k';
      const perIn = document.createElement('input'); perIn.className = 'gp-in'; perIn.type = 'text'; perIn.placeholder = '1'; perIn.value = f.period ?? '';
      perIn.oninput = () => { f.period = perIn.value.trim(); applyGraphAmp(f); persist(); mark(); };
      ampWrap.append(ampLab, ampIn, perLab, perIn);
      row.append(eq, inp, ampWrap);
    }
    row.append(del); list.appendChild(row);
  });
}
function addFunction(expr, param) {
  if (param) {
    fns().push({ mode: 'param', exprX: 'cos(t)', exprY: 'sin(t)', tMin: 0, tMax: 6.283, color: COLORS[fns().length % COLORS.length] });
  } else {
    fns().push({ mode: 'y', expr: expr || '', color: COLORS[fns().length % COLORS.length] });
  }
  renderGraphList(); persist(); mark();
}
function openGraph() {
  if (!GRID_PAPERS.includes(page().paper)) { page().paper = 'axes'; updatePageLabel(); persist(); }
  $('#graph').classList.remove('hidden');
  if (!fns().length) addFunction('sin(x)'); else renderGraphList();
  const u = page().unitCircle;
  $('#gp-unit')?.classList.toggle('brand-toggle-active', !!(u && u.show));
  if (u && $('#gp-angle')) { $('#gp-angle').value = u.angleDeg || 45; $('#gp-angle-v').textContent = (u.angleDeg || 45) + '°'; }
  trigReadout();
  mark();
}
function setupGraph() {
  if (!window.math) { $('#graph-toggle').style.display = 'none'; return; }
  $('#graph-toggle').onclick = () => { $('#graph').classList.contains('hidden') ? openGraph() : $('#graph').classList.add('hidden'); };
  $('#graph-close').onclick = () => $('#graph').classList.add('hidden');
  $('#gp-add').onclick = () => addFunction('');
  $('#gp-point').onclick = () => addGraphPoint(0);
  $('#gp-tangent').onclick = () => addTangentAtSelection();
  $('#gp-intersect').onclick = () => markIntersections();
  document.querySelectorAll('.gp-quick').forEach((b) => {
    if (b.dataset.param) b.onclick = () => addFunction('', true);
    else b.onclick = () => addFunction(b.dataset.fn);
  });
  setupTrigControls();
  makeDraggable($('#graph'), $('#gp-head'));
}
function trigReadout() {
  const u = page().unitCircle || {};
  const th = (u.angleDeg || 0) * Math.PI / 180;
  const tn = Math.tan(th);
  const r = $('#gp-unit-read');
  if (r) r.textContent = u.show ? `sin ${Math.sin(th).toFixed(2)} · cos ${Math.cos(th).toFixed(2)} · tan ${Math.abs(tn) > 1e4 ? '∞' : tn.toFixed(2)}` : 'off';
}
function setupTrigControls() {
  const unitBtn = $('#gp-unit');
  if (!unitBtn) return;
  unitBtn.onclick = () => {
    const pg = page();
    if (!pg.unitCircle) pg.unitCircle = { show: false, angleDeg: +($('#gp-angle').value || 45) };
    pg.unitCircle.show = !pg.unitCircle.show;
    unitBtn.classList.toggle('brand-toggle-active', pg.unitCircle.show);
    trigReadout(); persist(); mark();
  };
  $('#gp-angle').oninput = (e) => {
    const pg = page();
    if (!pg.unitCircle) pg.unitCircle = { show: true, angleDeg: 0 };
    pg.unitCircle.angleDeg = +e.target.value;
    $('#gp-angle-v').textContent = e.target.value + '°';
    trigReadout(); persist(); mark();
  };
  const bindSlider = (id, valId, key, scale, suffix) => {
    const el = $(id); if (!el) return;
    el.oninput = () => {
      const v = +el.value / scale;
      const f = fns()[0];
      if (f) { f[key] = String(v); f.mode = f.mode === 'param' ? 'y' : f.mode; }
      $(valId).textContent = v + (suffix || '');
      persist(); mark();
    };
  };
  bindSlider('#gp-amp', '#gp-amp-v', 'amp', 100, '');
  bindSlider('#gp-per', '#gp-per-v', 'period', 100, '');
  bindSlider('#gp-pha', '#gp-pha-v', 'phase', 100, '');
  bindSlider('#gp-vsh', '#gp-vsh-v', 'vshift', 100, '');
}

// ---- statistics (simple-statistics + uPlot) ---------------------------------
let statsMode = 'one', statsPlot = null, statChartType = 'hist', lastStatData = null;
const statNums = (t) => t.split(/[\s,;]+/).map(Number).filter((n) => !isNaN(n));
const statPairs = (t) => t.split(/\n+/).map((l) => l.split(/[\s,;]+/).map(Number).filter((n) => !isNaN(n))).filter((a) => a.length >= 2).map((a) => [a[0], a[1]]);
function statClearChart() { if (statsPlot) { try { statsPlot.destroy(); } catch (e) {} statsPlot = null; } $('#stats-chart').innerHTML = ''; }
function statCell(k, v) { return `<div class="st"><b>${k}</b><span>${v}</span></div>`; }
function statRun() {
  const out = $('#stats-summary'); statClearChart();
  const txt = $('#stats-data').value;
  if (statsMode === 'one') {
    const d = statNums(txt);
    if (!d.length) { out.innerHTML = '<div class="stats-err">Enter some numbers.</div>'; return; }
    const sd = d.length > 1 ? ss.sampleStandardDeviation(d) : 0;
    const q1 = ss.quantile(d, 0.25), q3 = ss.quantile(d, 0.75);
    out.innerHTML = [
      statCell('n', d.length), statCell('Mean', ss.mean(d).toFixed(3)),
      statCell('Median', ss.median(d)), statCell('Mode', ss.mode(d)),
      statCell('Min', ss.min(d)), statCell('Max', ss.max(d)),
      statCell('Range', ss.max(d) - ss.min(d)), statCell('Std dev', sd.toFixed(3)),
      statCell('Q1', q1), statCell('Q3', q3), statCell('IQR', q3 - q1),
      statCell('Variance', (d.length > 1 ? ss.sampleVariance(d) : 0).toFixed(3)),
    ].join('');
    lastStatData = d;
    statDrawChart(d);
  } else {
    const pairs = statPairs(txt);
    if (pairs.length < 2) { out.innerHTML = '<div class="stats-err">Enter x, y pairs — one per line.</div>'; return; }
    const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1]);
    const reg = ss.linearRegression(pairs), r = ss.sampleCorrelation(xs, ys);
    out.innerHTML = [
      statCell('n', pairs.length), statCell('Slope m', reg.m.toFixed(4)),
      statCell('Intercept b', reg.b.toFixed(4)), statCell('r', r.toFixed(4)),
      statCell('r²', (r * r).toFixed(4)), statCell('Mean x', ss.mean(xs).toFixed(2)),
    ].join('') + `<div class="st" style="grid-column:span 2"><b>Least-squares line</b><span>y = ${reg.m.toFixed(3)}x ${reg.b >= 0 ? '+' : '−'} ${Math.abs(reg.b).toFixed(3)}</span></div>`;
    statScatter(xs, ys, reg);
  }
}
function statDrawChart(d) {
  statClearChart();
  if (statChartType === 'box') statBoxPlot(d);
  else if (statChartType === 'normal') statNormalCurve(d);
  else statHistogram(d);
}
function statBoxPlot(d) {
  const sorted = d.slice().sort((a, b) => a - b);
  const min = ss.min(sorted), max = ss.max(sorted);
  const q1 = ss.quantile(sorted, 0.25), med = ss.median(sorted), q3 = ss.quantile(sorted, 0.75);
  const iqr = q3 - q1, loF = q1 - 1.5 * iqr, hiF = q3 + 1.5 * iqr;
  const whiskLo = Math.min(...sorted.filter((v) => v >= loF)), whiskHi = Math.max(...sorted.filter((v) => v <= hiF));
  const cv = document.createElement('canvas'); cv.width = 316; cv.height = 150;
  $('#stats-chart').appendChild(cv);
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 28, y = 56, bh = 40;
  const lo = Math.min(min, whiskLo), hi = Math.max(max, whiskHi), span = (hi - lo) || 1;
  const X = (v) => pad + (v - lo) / span * (W - pad * 2);
  c.strokeStyle = '#9aa6b5'; c.fillStyle = 'rgba(37,102,200,0.25)'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(X(whiskLo), y + bh / 2); c.lineTo(X(q1), y + bh / 2); c.moveTo(X(q3), y + bh / 2); c.lineTo(X(whiskHi), y + bh / 2); c.stroke();
  [whiskLo, whiskHi].forEach((v) => { c.beginPath(); c.moveTo(X(v), y + 8); c.lineTo(X(v), y + bh - 8); c.stroke(); });
  c.fillRect(X(q1), y, X(q3) - X(q1), bh); c.strokeStyle = '#2566c8'; c.strokeRect(X(q1), y, X(q3) - X(q1), bh);
  c.strokeStyle = '#d23b3b'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(X(med), y); c.lineTo(X(med), y + bh); c.stroke();
  sorted.filter((v) => v < whiskLo || v > whiskHi).forEach((v) => { c.fillStyle = '#e0892a'; c.beginPath(); c.arc(X(v), y + bh / 2, 3.5, 0, Math.PI * 2); c.fill(); });
  c.fillStyle = '#9aa6b5'; c.font = '10px sans-serif'; c.textAlign = 'center';
  [['min', whiskLo], ['Q1', q1], ['med', med], ['Q3', q3], ['max', whiskHi]].forEach(([lab, v]) => {
    c.fillText(typeof v === 'number' ? (+v.toFixed(2)) : v, X(v), y - 8); c.fillText(lab, X(v), y + bh + 16);
  });
}
function statNormalCurve(d) {
  const m = ss.mean(d), sd = d.length > 1 ? ss.sampleStandardDeviation(d) : 1;
  const cv = document.createElement('canvas'); cv.width = 316; cv.height = 180;
  $('#stats-chart').appendChild(cv);
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 26;
  const lo = m - 4 * sd, hi = m + 4 * sd, span = (hi - lo) || 1;
  const X = (v) => pad + (v - lo) / span * (W - pad * 2);
  const pdf = (x) => Math.exp(-((x - m) ** 2) / (2 * sd * sd)) / (sd * Math.sqrt(2 * Math.PI));
  const peak = pdf(m), Y = (p) => H - pad - (p / peak) * (H - pad * 2);
  // shade within ±1 sd
  c.fillStyle = 'rgba(37,102,200,0.22)'; c.beginPath(); c.moveTo(X(m - sd), H - pad);
  for (let x = m - sd; x <= m + sd; x += span / 200) c.lineTo(X(x), Y(pdf(x)));
  c.lineTo(X(m + sd), H - pad); c.closePath(); c.fill();
  c.strokeStyle = '#2566c8'; c.lineWidth = 2.5; c.beginPath();
  for (let i = 0; i <= 240; i++) { const x = lo + span * i / 240; const px = X(x), py = Y(pdf(x)); i ? c.lineTo(px, py) : c.moveTo(px, py); }
  c.stroke();
  c.strokeStyle = '#9aa6b5'; c.lineWidth = 1; c.beginPath(); c.moveTo(pad, H - pad); c.lineTo(W - pad, H - pad); c.stroke();
  c.strokeStyle = '#d23b3b'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(X(m), Y(peak)); c.lineTo(X(m), H - pad); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#9aa6b5'; c.font = '10px sans-serif'; c.textAlign = 'center';
  [['μ−σ', m - sd], ['μ', m], ['μ+σ', m + sd]].forEach(([lab, v]) => c.fillText(lab, X(v), H - pad + 14));
  c.fillStyle = '#2566c8'; c.fillText('68% within ±1σ', W / 2, 16);
}
function statHistogram(d) {
  const min = ss.min(d), max = ss.max(d);
  const k = Math.min(12, Math.max(4, Math.ceil(Math.sqrt(d.length))));
  const bw = (max - min) / k || 1;
  const bins = new Array(k).fill(0);
  d.forEach((v) => { let i = Math.floor((v - min) / bw); if (i >= k) i = k - 1; if (i < 0) i = 0; bins[i]++; });
  const cv = document.createElement('canvas'); cv.width = 316; cv.height = 160;
  $('#stats-chart').appendChild(cv);
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 22, maxB = Math.max(...bins);
  const bwpx = (W - pad * 2) / k;
  c.fillStyle = '#2566c8';
  bins.forEach((b, i) => { const h = maxB ? (b / maxB) * (H - pad * 2) : 0; c.fillRect(pad + i * bwpx + 2, H - pad - h, bwpx - 4, h); });
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.moveTo(pad, H - pad); c.lineTo(W - pad, H - pad); c.stroke();
  c.fillStyle = '#9aa6b5'; c.font = '10px sans-serif'; c.textAlign = 'center';
  bins.forEach((b, i) => {
    c.fillText((min + i * bw).toFixed(1), pad + i * bwpx + bwpx / 2, H - pad + 12);
    if (b) c.fillText(b, pad + i * bwpx + bwpx / 2, H - pad - (maxB ? (b / maxB) * (H - pad * 2) : 0) - 4);
  });
}
function statScatter(xs, ys, reg) {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const sx = idx.map((i) => xs[i]), sy = idx.map((i) => ys[i]), line = sx.map((x) => reg.m * x + reg.b);
  statsPlot = new uPlot({
    width: 316, height: 200, legend: { show: false }, cursor: { show: false },
    scales: { x: { time: false } },
    series: [{},
      { label: 'data', stroke: 'transparent', points: { show: true, size: 7, fill: '#2566c8', stroke: '#2566c8' } },
      { label: 'fit', stroke: '#d23b3b', width: 2, points: { show: false } }],
    axes: [{ stroke: '#9aa6b5', grid: { stroke: 'rgba(255,255,255,0.08)' } }, { stroke: '#9aa6b5', grid: { stroke: 'rgba(255,255,255,0.08)' } }],
  }, [sx, sy, line], $('#stats-chart'));
}
function setupStats() {
  if (!window.ss || !window.uPlot) { $('#stats-toggle').style.display = 'none'; return; }
  $('#stats-toggle').onclick = () => $('#stats').classList.toggle('hidden');
  $('#stats-close').onclick = () => $('#stats').classList.add('hidden');
  $('#stats-run').onclick = statRun;
  $('#stats-place').onclick = () => placeImageFromCanvas($('#stats-chart canvas') || $('#stats-chart .u-wrap canvas'));
  document.querySelectorAll('.sm-btn').forEach((b) => b.onclick = () => {
    statsMode = b.dataset.smode;
    document.querySelectorAll('.sm-btn').forEach((x) => x.classList.toggle('active', x === b));
    $('#stats-hint').textContent = statsMode === 'one' ? 'Enter numbers separated by commas or new lines' : 'Enter x, y pairs — one per line, e.g. 1, 2.3';
    $('#stats-data').placeholder = statsMode === 'one' ? '12, 15, 15, 18, 20, 21, 24' : '1, 2.1\n2, 3.9\n3, 6.2\n4, 7.8';
    $('#stats-chart-types').style.display = statsMode === 'one' ? 'flex' : 'none';
    $('#stats-summary').innerHTML = ''; statClearChart();
  });
  document.querySelectorAll('.sc-btn').forEach((b) => b.onclick = () => {
    statChartType = b.dataset.chart;
    document.querySelectorAll('.sc-btn').forEach((x) => x.classList.toggle('active', x === b));
    if (lastStatData && statsMode === 'one') statDrawChart(lastStatData);
  });
  makeDraggable($('#stats'), $('#stats-head'));
}

function addComplexPoint(re, im, tag, omega) {
  const at = { x: PAGE_W / 2 + re * UNIT, y: PAGE_H / 2 - im * UNIT };
  objs().push({
    id: uid(), kind: 'complex', at: snapPt(at), color: S.color,
    ctag: tag || null, omega: omega ? { re: omega.re, im: omega.im } : null,
  });
  mark();
}

function setupPanelMenu() {
  const wrap = $('#panel-menu');
  const drop = $('#panel-drop');
  if (!wrap || !drop) return;
  wrap.onclick = (e) => { e.stopPropagation(); drop.classList.toggle('hidden'); };
  drop.querySelectorAll('[data-panel]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.panel;
      const el = $(id);
      if (el) el.classList.toggle('hidden');
      drop.classList.add('hidden');
    };
  });
  document.addEventListener('click', () => drop.classList.add('hidden'));
}

function setupSyncSettings() {
  const dlg = $('#sync-dialog');
  const urlIn = $('#sync-url');
  if (!dlg || !urlIn) return;
  urlIn.value = getSyncBaseUrl();
  $('#sync-settings')?.addEventListener('click', () => {
    urlIn.value = getSyncBaseUrl();
    dlg.classList.remove('hidden');
  });
  $('#sync-close')?.addEventListener('click', () => dlg.classList.add('hidden'));
  $('#sync-save')?.addEventListener('click', () => {
    setSyncBaseUrl(urlIn.value);
    dlg.classList.add('hidden');
    updateSyncStatus({ state: getSyncBaseUrl() ? 'configured' : 'saved', mode: getSyncBaseUrl() ? 'remote' : 'local' });
  });
  $('#sync-push')?.addEventListener('click', async () => {
    try {
      setSyncBaseUrl(urlIn.value);
      const n = await syncAllToRemote();
      alert(`Uploaded ${n} lesson(s) to cloud.`);
    } catch (e) { alert(e.message); }
  });
  $('#sync-pull')?.addEventListener('click', async () => {
    try {
      setSyncBaseUrl(urlIn.value);
      const n = await pullRemoteCatalog();
      renderLibrary();
      alert(`Pulled ${n} lesson(s) from cloud.`);
    } catch (e) { alert(e.message); }
  });
}

// ---- tool rail (classroom layout): pin/unpin + close-all panels ---------------
function setupRail() {
  const rail = $('#tool-rail');
  const collapse = (on) => rail?.classList.toggle('collapsed', on);
  const pin = $('#rail-pin');
  if (pin) pin.onclick = () => collapse(!rail.classList.contains('collapsed'));
  const reopen = $('#rail-reopen');
  if (reopen) reopen.onclick = () => collapse(false);
  const closeAll = $('#close-all');
  if (closeAll) closeAll.onclick = () => {
    ['#calc', '#stats', '#graph', '#mech', '#cplx', '#calculus'].forEach((id) => $(id)?.classList.add('hidden'));
    $('#panel-drop')?.classList.add('hidden');
    setMechPlacing(null);
    setCplxPlacing(null);
  };
}

// ---- live demo animation bar (Module 1) --------------------------------------
function syncDemoUI() {
  const s = $('#demo-slider'); if (s) s.value = Math.round(S.demoT * 1000);
  const v = $('#demo-val'); if (v) v.textContent = S.demoT.toFixed(2);
}
function demoPlay(on) {
  S.playing = on;
  S.demoLast = performance.now();
  const b = $('#demo-play');
  if (b) { b.textContent = on ? '❚❚ Pause' : '► Play'; b.classList.toggle('brand-toggle-active', on); }
  mark();
}
function demoReset() { demoPlay(false); S.demoT = 0; syncDemoUI(); mark(); }
function addTracer() {
  beginAction();
  const o = {
    id: uid(), kind: 'tracer',
    center: { x: PAGE_W / 2, y: PAGE_H / 2 },
    edge: { x: PAGE_W / 2 + 3 * UNIT, y: PAGE_H / 2 },
    color: S.color, label: 'P',
  };
  objs().push(o);
  commitAction();
  thumbCache.delete(page().id);
  S.selStrokes = []; S.selObj = o; S.tool = 'select';
  if (cv) cv.classList.add('cur-select');
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === 'select'));
  setTab('draw');
  $('#demo-bar')?.classList.remove('hidden');
  mark();
}
function selectNewObject(o) {
  thumbCache.delete(page().id);
  S.selStrokes = []; S.selObj = o; S.tool = 'select';
  if (cv) cv.classList.add('cur-select');
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === 'select'));
  setTab('draw');
  $('#demo-bar')?.classList.remove('hidden');
  mark();
}
function addForceVec() {
  beginAction();
  const o = { id: uid(), kind: 'forcevec', at: { x: PAGE_W / 2, y: PAGE_H / 2 }, mag: 5, angleDeg: 30, anim: true, color: S.color || '#d23b3b' };
  objs().push(o);
  commitAction();
  selectNewObject(o);
}
function addIncline() {
  beginAction();
  const o = { id: uid(), kind: 'incline', at: { x: PAGE_W / 2 - 150, y: PAGE_H / 2 + 130 }, base: 300, angleDeg: 30, mass: 2, mu: 0.2, anim: true };
  objs().push(o);
  commitAction();
  selectNewObject(o);
}
function setupDemo() {
  $('#demo-toggle')?.addEventListener('click', () => $('#demo-bar')?.classList.toggle('hidden'));
  $('#demo-close')?.addEventListener('click', () => { demoPlay(false); $('#demo-bar')?.classList.add('hidden'); });
  $('#demo-play')?.addEventListener('click', () => demoPlay(!S.playing));
  $('#demo-reset')?.addEventListener('click', demoReset);
  $('#demo-slider')?.addEventListener('input', (e) => { if (S.playing) demoPlay(false); S.demoT = (+e.target.value || 0) / 1000; syncDemoUI(); mark(); });
  $('#demo-add')?.addEventListener('click', addTracer);
  $('#demo-force')?.addEventListener('click', addForceVec);
  $('#demo-incline')?.addEventListener('click', addIncline);
  syncDemoUI();
}

// ---- collaboration gate (isolated; collab modules load only when ALL are true) ---------------
// True only when: (a) not on localhost (mirrors the sw/devHost check), (b) browser is online,
// and (c) a server URL is configured in config.js. When false, the Collaborate option is hidden
// and js/collab/* is never imported, so the offline solo app stays byte-for-byte unchanged.
function collabAvailable() {
  const devHost = ['localhost', '127.0.0.1'].includes(location.hostname);
  const url = ((window.MB_CONFIG && window.MB_CONFIG.collabServerUrl) || '').trim();
  return !devHost && navigator.onLine && !!url;
}
function setupCollabGate() {
  const cb = $('#collab-toggle');
  if (!cb) return;
  if (!collabAvailable()) { cb.classList.add('hidden'); return; }   // gate closed: never load collab
  cb.classList.remove('hidden');
  cb.onclick = async () => {
    cb.disabled = true;
    try {
      const m = await import('./collab/collab.js');   // dynamic import: only fetched on click
      m.startCollab({ notebook: () => S.notebook, page });
    } catch (e) {
      alert('Could not load collaboration: ' + e.message);
    } finally {
      cb.disabled = false;
    }
  };
}

// ---- boot --------------------------------------------------------------------
function init() {
  cv = $('#board');
  ctx = cv.getContext('2d');
  setupGeo({ page, snapPt, beginAction, commitAction, persist, mark, cancelAction: () => { S.actionBefore = null; }, setInstTool: () => setInstTool(null) });
  setupMech({ page, snapPt, beginAction, commitAction, persist, mark, setGeoTool: () => setGeoTool(null), setCplxPlacing: () => setCplxPlacing(null) });
  setupMechPanel();
  makeDraggable($('#mech'), $('#mech-head'));
  setupCplx({
    page, snapPt, beginAction, commitAction, persist, mark, unit: UNIT, pageW: PAGE_W, pageH: PAGE_H,
    setGeoTool: () => setGeoTool(null), setMechPlacing: () => setMechPlacing(null),
    selObj: () => S.selObj, addComplex: addComplexPoint,
  });
  setupInstruments({
    page, snapPt, beginAction, commitAction, persist, mark, unit: UNIT,
    setGeoTool: () => setGeoTool(null), setMechPlacing: () => setMechPlacing(null), setCplxPlacing: () => setCplxPlacing(null),
  });
  setupCplxPanel();
  makeDraggable($('#cplx'), $('#cplx-head'));
  onSyncStatus(updateSyncStatus);
  window.MathBoard = getPortalAPI();
  if (!window.JXG) document.querySelector('.geo-group')?.classList.add('hidden');
  bindEditor();
  bindCanvas();
  setupCalculator();
  setupGraph();
  setupStats();
  setupCalculus({
    page, beginAction, commitAction, persist, mark, unit: UNIT, pageW: PAGE_W, pageH: PAGE_H,
    ensureAxes: () => { if (!GRID_PAPERS.includes(page().paper)) { page().paper = 'axes'; updatePageLabel(); persist(); mark(); } },
  });
  setupCalculusPanel();
  makeDraggable($('#calculus'), $('#calculus-head'));
  setupText();
  setupPanelMenu();
  setupRail();
  setupDemo();
  setupCollabGate();
  setupSyncSettings();
  $('#new-nb').onclick = createNotebook;
  document.querySelectorAll('.lib-tab').forEach((b) => { b.onclick = () => setLibTab(b.dataset.lib); });
  setLibTab('lesson');
  $('#import-pdf-lib').onclick = () => $('#pdf-file-lib').click();
  $('#import-json-lib').onclick = () => $('#json-file-lib').click();
  $('#pdf-file-lib').onchange = (e) => { const f = e.target.files[0]; if (f) importPdfAsNotebook(f); e.target.value = ''; };
  $('#json-file-lib').onchange = (e) => { const f = e.target.files[0]; if (f) importJsonAsNotebook(f); e.target.value = ''; };
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
