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
const UNIT = 50;              // page units per "1" on the grid — vectors snap to this
const GRID_PAPERS = ['argand', 'vectorgrid', 'axes'];   // papers where vectors snap to integer points

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
  creating: null,           // active math object (vector / line) being drawn
  snap: true,               // snap vector endpoints to grid
  radians: false,           // angle display: radians vs degrees
  editingId: null,          // id of text object currently being edited (hidden on canvas)
  actionBefore: null,       // page snapshot taken at action start (for undo)
  undo: [], redo: [],
  lassoPath: null,          // points (page units) of in-progress lasso
  selection: null,          // { strokes:[refs], bbox:{x,y,w,h} }
  moving: null,             // { lastX, lastY }
  selObj: null,             // selected math object/shape/text (Select tool)
  objMove: null,            // { lastX, lastY } — dragging a selected object's body
  objResize: null,          // handle name — dragging a selected object's handle
  // multi-touch gesture
  touch: new Map(),         // pointerId -> {x,y} css
  gref: null,
  dirty: true,
};

let cv, ctx, dpr = 1;

// ---- helpers -----------------------------------------------------------------
const page = () => S.notebook.pages[S.pageIndex];
const objs = () => { const p = page(); if (!p.objects) p.objects = []; return p.objects; };  // math objects (vectors/lines)
const fns = () => { const p = page(); if (!p.functions) p.functions = []; return p.functions; };  // graphed y=f(x)
const clone = (o) => JSON.parse(JSON.stringify(o));
const $ = (sel) => document.querySelector(sel);

function toPage(cssX, cssY) {
  return { x: (cssX - S.offsetX) / S.scale, y: (cssY - S.offsetY) / S.scale };
}

function newPage(paper = 'graph') {
  return { id: uid(), paper, strokes: [], objects: [] };
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
function snapshotPage() { return { strokes: clone(page().strokes), objects: clone(objs()) }; }
function restorePage(s) { page().strokes = clone(s.strokes); page().objects = clone(s.objects); }
function beginAction() { S.actionBefore = snapshotPage(); }
function commitAction() {
  if (!S.actionBefore) return;
  if (JSON.stringify(S.actionBefore) !== JSON.stringify(snapshotPage())) {
    S.undo.push(S.actionBefore);
    if (S.undo.length > UNDO_CAP) S.undo.shift();
    S.redo = [];
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
    c.arc(pts[0].x, pts[0].y, Math.max(s.width / 2, 0.6), 0, Math.PI * 2);
    c.fill();
  } else if (pts.length === 2) {
    c.lineWidth = s.width;
    c.beginPath(); c.moveTo(pts[0].x, pts[0].y); c.lineTo(pts[1].x, pts[1].y); c.stroke();
  } else {
    // smooth: quadratic curves through the midpoints of consecutive samples
    for (let i = 1; i < pts.length - 1; i++) {
      const p1 = pts[i], p0 = pts[i - 1], p2 = pts[i + 1];
      const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      c.lineWidth = hl ? s.width : s.width * (0.45 + 0.9 * (p1.p ?? 0.5));
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
  c.fillStyle = col; c.font = '600 24px sans-serif';
  c.fillText(`z = ${fmt(z.a)} ${z.b < 0 ? '−' : '+'} ${fmt(Math.abs(z.b))}i`, lx, ly);
  c.font = '18px sans-serif';
  c.fillText(`|z| = ${z.mod.toFixed(2)}   arg ${formatAngle(z.argRad)}`, lx, ly + 24);
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
function drawObject(c, o) {
  const col = o.color || '#1b1b1b';
  if (o.kind === 'line') {
    c.strokeStyle = col; c.lineWidth = 3; c.lineCap = 'round'; c.setLineDash([]);
    c.beginPath(); c.moveTo(o.from.x, o.from.y); c.lineTo(o.to.x, o.to.y); c.stroke();
    return;
  }
  if (o.kind === 'text') { drawText(c, o); return; }
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
  drawArrow(c, o.from, o.to, col, o.kind === 'resultant');
  const v = vecInfo(o);
  const lx = o.to.x + 12, ly = o.to.y - 10;
  c.fillStyle = col; c.font = '600 24px sans-serif';
  c.fillText(`(${fmt(v.dx)}, ${fmt(v.dy)})`, lx, ly);
  c.font = '18px sans-serif';
  c.fillText(`|v| = ${v.mag.toFixed(2)}   ${formatAngle(v.angRad)}`, lx, ly + 24);
}
function drawObjects(c, pg) {
  for (const o of (pg.objects || [])) drawObject(c, o);
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

// graphed functions y = f(x), origin at page centre, UNIT page-units = 1
function drawFunctions(c, pg) {
  const list = pg.functions || [];
  if (!list.length || !window.math) return;
  const cx = PAGE_W / 2, cy = PAGE_H / 2;
  c.textAlign = 'start';
  let labelY = 30;
  for (const f of list) {
    if (!f.expr || !f.expr.trim()) continue;
    let node;
    try { node = math.compile(f.expr); } catch (e) { continue; }
    c.strokeStyle = f.color; c.lineWidth = 3; c.lineJoin = 'round'; c.lineCap = 'round'; c.setLineDash([]);
    c.beginPath();
    let pen = false, lastPy = null;
    for (let px = 0; px <= PAGE_W; px += 2) {
      const x = (px - cx) / UNIT;
      let y;
      try { y = node.evaluate({ x }); } catch (e) { pen = false; continue; }
      if (typeof y !== 'number' || !isFinite(y)) { pen = false; continue; }
      const py = cy - y * UNIT;
      if (pen && lastPy != null && Math.abs(py - lastPy) > PAGE_H * 1.5) pen = false;  // skip asymptote jumps
      if (!pen) { c.moveTo(px, py); pen = true; } else c.lineTo(px, py);
      lastPy = py;
    }
    c.stroke();
    c.fillStyle = f.color; c.font = '600 22px sans-serif';
    c.fillText('y = ' + f.expr, 16, labelY); labelY += 28;
  }
}

// draws one page's full content into a context already scaled to page units
function drawPageContent(c, pg) {
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, PAGE_W, PAGE_H);
  const e = imgCache.get(pg.id);
  drawBackground(c, pg, e && e.loaded ? e.img : null);
  drawFunctions(c, pg);
  drawObjects(c, pg);
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
    drawFunctions(ctx, page());
    drawObjects(ctx, page());
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
    // selected object: dashed bbox + square drag handles
    if (S.selObj && objs().includes(S.selObj)) {
      const b = objBBox(S.selObj);
      ctx.strokeStyle = '#2566c8'; ctx.lineWidth = 1.5 / S.scale;
      ctx.setLineDash([7 / S.scale, 5 / S.scale]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      const hs = 6 / S.scale;
      ctx.fillStyle = '#ffffff';
      for (const h of objHandles(S.selObj)) {
        ctx.beginPath(); ctx.rect(h.x - hs, h.y - hs, hs * 2, hs * 2);
        ctx.fill(); ctx.stroke();
      }
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
function clearSelection() { S.selection = null; S.lassoPath = null; S.selObj = null; mark(); }

function touchToolCanInteract() {
  return ['select','lasso','text','plotz','circle','line','rect','ellipse','vector','eraser'].includes(S.tool);
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
  if (o.kind === 'text' || o.kind === 'complex') return [o.at];
  if (o.kind === 'circle') return [o.center, o.edge];
  return [o.from, o.to];               // vector / line / rect / ellipse
}
function objBBox(o) {
  if (o.kind === 'circle') {
    const r = Math.hypot(o.edge.x - o.center.x, o.edge.y - o.center.y);
    return { x: o.center.x - r, y: o.center.y - r, w: 2 * r, h: 2 * r };
  }
  if (o.kind === 'text') { const b = textBox(o); return { x: o.at.x, y: o.at.y, w: b.w, h: b.h }; }
  if (o.kind === 'complex') return { x: o.at.x - 10, y: o.at.y - 10, w: 20, h: 20 };
  const x0 = Math.min(o.from.x, o.to.x), y0 = Math.min(o.from.y, o.to.y);
  return { x: x0, y: y0, w: Math.abs(o.to.x - o.from.x), h: Math.abs(o.to.y - o.from.y) };
}
function objHandles(o) {                 // named drag handles, in page units
  if (o.kind === 'vector' || o.kind === 'line')
    return [{ name: 'from', x: o.from.x, y: o.from.y }, { name: 'to', x: o.to.x, y: o.to.y }];
  if (o.kind === 'circle')
    return [{ name: 'center', x: o.center.x, y: o.center.y }, { name: 'edge', x: o.edge.x, y: o.edge.y }];
  if (o.kind === 'complex')
    return [{ name: 'at', x: o.at.x, y: o.at.y }];
  if (o.kind === 'rect' || o.kind === 'ellipse') {
    const x0 = Math.min(o.from.x, o.to.x), y0 = Math.min(o.from.y, o.to.y),
          x1 = Math.max(o.from.x, o.to.x), y1 = Math.max(o.from.y, o.to.y);
    return [{ name: 'nw', x: x0, y: y0 }, { name: 'ne', x: x1, y: y0 },
            { name: 'sw', x: x0, y: y1 }, { name: 'se', x: x1, y: y1 }];
  }
  if (o.kind === 'text') { const b = textBox(o); return [{ name: 'size', x: o.at.x + b.w, y: o.at.y + b.h }]; }
  return [];
}
function applyHandle(o, name, p) {        // drag a handle to point p (snapped on grid papers)
  const sp = snapPt(p);
  if (name === 'from') o.from = sp;
  else if (name === 'to') o.to = sp;
  else if (name === 'at') o.at = sp;
  else if (name === 'edge') o.edge = sp;
  else if (name === 'center') { const dx = sp.x - o.center.x, dy = sp.y - o.center.y; o.center = sp; o.edge = { x: o.edge.x + dx, y: o.edge.y + dy }; }
  else if (name === 'size') { const b = textBox(o); o.size = Math.max(10, Math.min(220, o.size * Math.max(20, p.x - o.at.x) / (b.w || 1))); }
  else {                                  // rect / ellipse corner
    let x0 = Math.min(o.from.x, o.to.x), y0 = Math.min(o.from.y, o.to.y),
        x1 = Math.max(o.from.x, o.to.x), y1 = Math.max(o.from.y, o.to.y);
    if (name.includes('n')) y0 = sp.y; else y1 = sp.y;
    if (name.includes('w')) x0 = sp.x; else x1 = sp.x;
    o.from = { x: x0, y: y0 }; o.to = { x: x1, y: y1 };
  }
}
function moveObject(o, dx, dy) { for (const pt of objPoints(o)) { pt.x += dx; pt.y += dy; } }
function hitObject(p) {                   // topmost object under p (or null)
  const tol = 10 / S.scale, list = objs();
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (objHit(o, p, tol)) return o;
    const b = objBBox(o);
    if (['rect', 'ellipse', 'text', 'complex', 'circle'].includes(o.kind) &&
        p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return o;
  }
  return null;
}
function handleAt(o, p) {                  // name of the handle near p (or null)
  const tol = 13 / S.scale;
  for (const h of objHandles(o)) if (Math.abs(p.x - h.x) < tol && Math.abs(p.y - h.y) < tol) return h.name;
  return null;
}
function deleteSelectedObject() {
  if (!S.selObj) return;
  beginAction();
  const i = objs().indexOf(S.selObj);
  if (i >= 0) objs().splice(i, 1);
  S.selObj = null; commitAction(); mark();
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
  if (e.pointerType === 'pen' || e.pointerType === 'mouse') return true;
  if (e.pointerType === 'touch') return S.fingerDraw && S.touch.size === 1 && ['pen', 'highlighter'].includes(S.tool);
  return false;
}

function onDown(e) {
  try { cv.setPointerCapture(e.pointerId); } catch (_) { /* non-fatal */ }
  if (e.pointerType === 'touch') {
    S.touch.set(e.pointerId, cssPt(e));
    setGestureRef();
    // a touch ends any pen drawing safety
  }
  if (!isDrawPointer(e) && !(e.pointerType === 'touch' && touchToolCanInteract())) { mark(); return; }
  const p = toPage(...cssArr(e));

  if (S.tool === 'select') {
    // grab a handle of the current selection, else pick the object under the cursor
    if (S.selObj) {
      const h = handleAt(S.selObj, p);
      if (h) { beginAction(); S.objResize = h; return; }
    }
    const hit = hitObject(p);
    if (hit) {
      S.selObj = hit; beginAction();
      S.objMove = { lastX: p.x, lastY: p.y };
    } else { S.selObj = null; }
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
  S.drawing = { tool: S.tool, color: S.color, width: S.width, points: [{ x: p.x, y: p.y, p: pressureOf(e) }] };
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
    moveObject(S.selObj, p.x - S.objMove.lastX, p.y - S.objMove.lastY);
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

function eraseAt(p) {
  const r = (S.width + 14);
  const r2 = r * r;
  const before = page().strokes.length;
  page().strokes = page().strokes.filter((s) => !s.points.some((q) => dist2(q, p) < r2));
  const objBefore = objs().length;
  page().objects = objs().filter((o) => !objHit(o, p, r));
  if (page().strokes.length !== before || page().objects.length !== objBefore) mark();
}
function pointInText(o, p) {
  const b = textBox(o);
  return p.x >= o.at.x - 8 && p.x <= o.at.x + b.w + 8 && p.y >= o.at.y - 8 && p.y <= o.at.y + b.h + 8;
}
function objHit(o, p, r) {
  if (o.kind === 'text') return pointInText(o, p);
  if (o.kind === 'complex') return Math.hypot(p.x - o.at.x, p.y - o.at.y) < r + 8;
  if (o.kind === 'circle') {
    const rad = Math.hypot(o.edge.x - o.center.x, o.edge.y - o.center.y);
    const d = Math.hypot(p.x - o.center.x, p.y - o.center.y);
    return Math.abs(d - rad) < r || d < r;
  }
  if (o.kind === 'rect') {
    const x0 = Math.min(o.from.x, o.to.x), y0 = Math.min(o.from.y, o.to.y), x1 = Math.max(o.from.x, o.to.x), y1 = Math.max(o.from.y, o.to.y);
    const nearV = (Math.abs(p.x - x0) < r || Math.abs(p.x - x1) < r) && p.y > y0 - r && p.y < y1 + r;
    const nearH = (Math.abs(p.y - y0) < r || Math.abs(p.y - y1) < r) && p.x > x0 - r && p.x < x1 + r;
    return nearV || nearH;
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
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';   // ensure worker set even if init timing missed it
  }
  const pdf = await withTimeout(pdfjsLib.getDocument({ data: arrayBuffer }).promise, 20000, 'Opening PDF');
  const pages = [];
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
    pages.push({ id: uid(), paper: 'plain', background: { type: 'image', data: oc.toDataURL('image/jpeg', 0.92) }, strokes: [], objects: [] });
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
function updatePageLabel() {
  $('#page-label').textContent = `${S.pageIndex + 1} / ${S.notebook.pages.length}`;
  const sel = $('#paper'); if (sel) sel.value = page().paper;   // grid selector follows current page
  const rb = $('#resultant'); if (rb) rb.classList.toggle('brand-toggle-active', !!page().showResultant);
  const cb = $('#conjugate'); if (cb) cb.classList.toggle('brand-toggle-active', !!page().showConjugate);
}
function updateTitle() { $('#nb-name').value = S.notebook.title; }

const TOOL_TAB = {
  pen: 'draw', highlighter: 'draw', eraser: 'draw', lasso: 'draw', select: 'draw', text: 'draw', line: 'draw', rect: 'draw', ellipse: 'draw',
  vector: 'maths', plotz: 'maths', circle: 'maths',
};
function setTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tbar-tools .group').forEach((g) => {
    g.classList.toggle('show', (g.dataset.tabs || '').split(' ').includes(name));
  });
}
function setTool(t) {
  S.tool = t;
  if (t !== 'lasso') clearSelection();
  if (cv) cv.classList.toggle('cur-select', t === 'select');
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  if (TOOL_TAB[t]) setTab(TOOL_TAB[t]);
}

function bindEditor() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  document.querySelectorAll('.tab-btn').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
  setTab('draw');

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
  $('#resultant').onclick = () => { page().showResultant = !page().showResultant; updatePageLabel(); persist(); mark(); };
  $('#conjugate').onclick = () => { page().showConjugate = !page().showConjugate; updatePageLabel(); persist(); mark(); };
  $('#snap').onchange = (e) => { S.snap = e.target.checked; };
  $('#radians').onchange = (e) => { S.radians = e.target.checked; mark(); };

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
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;   // don't hijack typing in fields
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
    else if ((e.key === 'Delete' || e.key === 'Backspace') && S.selObj) { e.preventDefault(); deleteSelectedObject(); }
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
let calcDeg = true, calcAns = 0, mathFrac = null, calcShift = false;
let calcLastExpr = null, calcResultValue = null, calcShowFrac = false;
const SHIFT_MAP = { 'sin(': 'asin(', 'cos(': 'acos(', 'tan(': 'atan(', 'log(': 'e^(', 'log10(': '10^(' };
function showCalcTable(on) { $('#calc-table').classList.toggle('hidden', !on); $('#calc-keys').classList.toggle('hidden', on); }
function calcScope() {
  const toRad = (x) => calcDeg ? x * Math.PI / 180 : x;
  const fromRad = (x) => calcDeg ? x * 180 / Math.PI : x;
  return {
    sin: (x) => Math.sin(toRad(x)), cos: (x) => Math.cos(toRad(x)), tan: (x) => Math.tan(toRad(x)),
    asin: (x) => fromRad(Math.asin(x)), acos: (x) => fromRad(Math.acos(x)), atan: (x) => fromRad(Math.atan(x)),
    Ans: calcAns,
  };
}
function calcEvaluate() {
  const inp = $('#calc-expr'), out = $('#calc-result');
  const expr = inp.value.trim();
  if (!expr) return;
  try {
    const res = math.evaluate(expr, calcScope());
    if (typeof res === 'function' || res === undefined) { out.textContent = 'Error'; return; }
    calcAns = res; calcLastExpr = expr; calcResultValue = res; calcShowFrac = false;
    out.textContent = math.format(res, { precision: 10 });
  } catch (e) { out.textContent = 'Error'; }
}
function calcToggleSD() {                          // S⇔D: toggle result between decimal and exact fraction
  if (calcLastExpr == null) return;
  const out = $('#calc-result');
  calcShowFrac = !calcShowFrac;
  if (calcShowFrac) {
    try {
      const f = mathFrac.evaluate(calcLastExpr, calcScope());
      if (mathFrac.typeOf(f) === 'Fraction') { out.textContent = mathFrac.format(f, { fraction: 'ratio' }); return; }
    } catch (e) { /* fall through to decimal */ }
    calcShowFrac = false;   // no nice fraction — stay decimal
  }
  out.textContent = math.format(calcResultValue, { precision: 10 });
}
function calcKey(k) {
  const inp = $('#calc-expr');
  if (k === 'shift') { calcShift = !calcShift; $('#calc-shift-ind').classList.toggle('on', calcShift); return; }
  const sh = calcShift;
  if (sh) { calcShift = false; $('#calc-shift-ind').classList.remove('on'); }
  if (k === 'ac') { inp.value = ''; $('#calc-result').textContent = '0'; inp.focus(); return; }
  if (k === 'del') { inp.value = inp.value.slice(0, -1); inp.focus(); return; }
  if (k === 'table') { showCalcTable($('#calc-table').classList.contains('hidden')); return; }
  if (k === 'eq') { calcEvaluate(); return; }
  if (k === 'sd') { calcToggleSD(); return; }
  let token = (k === 'ans') ? 'Ans' : (k === 'frac') ? '/' : k;
  if (sh && SHIFT_MAP[k]) token = SHIFT_MAP[k];
  inp.value += token;
  inp.focus();
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
function setupCalculator() {
  if (!window.math) { $('#calc-toggle').style.display = 'none'; return; }
  mathFrac = math.create(math.all); mathFrac.config({ number: 'Fraction' });   // exact-fraction engine for S⇔D
  document.querySelectorAll('#calc-keys .ck').forEach((b) => b.onclick = () => calcKey(b.dataset.k));
  $('#calc-toggle').onclick = () => { $('#calc').classList.toggle('hidden'); $('#calc-expr').focus(); };
  $('#calc-close').onclick = () => $('#calc').classList.add('hidden');
  $('#calc-mode').onclick = () => { calcDeg = !calcDeg; $('#calc-mode').textContent = calcDeg ? 'DEG' : 'RAD'; };
  $('#calc-expr').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); calcEvaluate(); } });
  $('#ct-back').onclick = () => showCalcTable(false);
  $('#ct-gen').onclick = calcGenTable;
  makeDraggable($('#calc'), $('#calc-head'));
}

// ---- function grapher panel -------------------------------------------------
function renderGraphList() {
  const list = $('#gp-list'); list.innerHTML = '';
  fns().forEach((f, i) => {
    const row = document.createElement('div'); row.className = 'gp-row';
    const dot = document.createElement('span'); dot.className = 'gp-dot'; dot.style.background = f.color;
    const eq = document.createElement('span'); eq.className = 'gp-eq'; eq.textContent = 'y =';
    const inp = document.createElement('input'); inp.className = 'gp-in'; inp.type = 'text'; inp.value = f.expr; inp.placeholder = 'sin(x)';
    inp.oninput = () => { f.expr = inp.value; persist(); mark(); };
    const del = document.createElement('button'); del.className = 'gp-del'; del.textContent = '×'; del.title = 'Remove';
    del.onclick = () => { fns().splice(i, 1); renderGraphList(); persist(); mark(); };
    row.append(dot, eq, inp, del); list.appendChild(row);
  });
}
function addFunction(expr) {
  fns().push({ expr: expr || '', color: COLORS[fns().length % COLORS.length] });
  renderGraphList(); persist(); mark();
}
function openGraph() {
  if (!GRID_PAPERS.includes(page().paper)) { page().paper = 'axes'; updatePageLabel(); persist(); }  // ensure visible axes
  $('#graph').classList.remove('hidden');
  if (!fns().length) addFunction('sin(x)'); else renderGraphList();
  mark();
}
function setupGraph() {
  if (!window.math) { $('#graph-toggle').style.display = 'none'; return; }
  $('#graph-toggle').onclick = () => { $('#graph').classList.contains('hidden') ? openGraph() : $('#graph').classList.add('hidden'); };
  $('#graph-close').onclick = () => $('#graph').classList.add('hidden');
  $('#gp-add').onclick = () => addFunction('');
  document.querySelectorAll('.gp-quick').forEach((b) => b.onclick = () => addFunction(b.dataset.fn));
  makeDraggable($('#graph'), $('#gp-head'));
}

// ---- statistics (simple-statistics + uPlot) ---------------------------------
let statsMode = 'one', statsPlot = null;
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
    statHistogram(d);
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
  document.querySelectorAll('.sm-btn').forEach((b) => b.onclick = () => {
    statsMode = b.dataset.smode;
    document.querySelectorAll('.sm-btn').forEach((x) => x.classList.toggle('active', x === b));
    $('#stats-hint').textContent = statsMode === 'one' ? 'Enter numbers separated by commas or new lines' : 'Enter x, y pairs — one per line, e.g. 1, 2.3';
    $('#stats-data').placeholder = statsMode === 'one' ? '12, 15, 15, 18, 20, 21, 24' : '1, 2.1\n2, 3.9\n3, 6.2\n4, 7.8';
    $('#stats-summary').innerHTML = ''; statClearChart();
  });
  makeDraggable($('#stats'), $('#stats-head'));
}

// ---- boot --------------------------------------------------------------------
function init() {
  cv = $('#board');
  ctx = cv.getContext('2d');
  bindEditor();
  bindCanvas();
  setupCalculator();
  setupGraph();
  setupStats();
  setupText();
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
