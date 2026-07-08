// graphView.js — dedicated pannable/zoomable graphing viewport (GeoGebra-style)

import { pageW, pageH } from './pageLayout.js';

let hooks = {};
let open = false;
let cam = { scale: 1.8, ox: 0, oy: 0 };
let dragging = false;
let lastPt = null;
let cv = null;
let ctx = null;

export function setupGraphView(h) { hooks = h; }

export function graphViewOpen() { return open; }

function PW() { const pg = page(); return pg ? pageW(pg) : 1000; }
function PH() { const pg = page(); return pg ? pageH(pg) : 1414; }
function origin() {
  const pw = PW(), ph = PH();
  return { x: pw / 2, y: ph / 2 + (ph > pw ? 80 : 0) };
}

function toGraph(cssX, cssY) {
  const r = cv.getBoundingClientRect();
  const x = (cssX - r.left - cam.ox) / cam.scale;
  const y = (cssY - r.top - cam.oy) / cam.scale;
  return { x, y };
}

function page() { return hooks.page?.(); }
function fns() { return page()?.functions || []; }

function pageFromGraph(gx, gy) {
  const o = origin();
  return { x: o.x + gx, y: o.y - gy };
}

function graphFromPage(px, py) {
  const o = origin();
  return { x: px - o.x, y: o.y - py };
}

function evalY(f, xGraph) {
  if (!window.math) return null;
  try {
    const deg = hooks.trigDegAxis?.();
    const xRad = deg ? xGraph * Math.PI / 180 : xGraph;
    const pnum = (v, d) => {
      if (v == null || v === '') return d;
      try {
        const n = Number(math.evaluate(String(v), hooks.calcScope?.() || {}));
        return isFinite(n) ? n : d;
      } catch (_) { return d; }
    };
    const A = pnum(f.amp, 1), k = pnum(f.period, 1), ph = pnum(f.phase, 0), vs = pnum(f.vshift, 0);
    const v = math.evaluate(f.expr, { x: k * xRad + ph });
    const y = A * v + vs;
    return typeof y === 'number' && isFinite(y) ? y : null;
  } catch (_) { return null; }
}

function drawGrid(c) {
  const pw = PW(), ph = PH(), o = origin();
  const step = hooks.unit?.() || 50;
  c.strokeStyle = '#dfe6ef'; c.lineWidth = 1;
  const left = -o.x / step - 2, right = (pw - o.x) / step + 2;
  const top = -o.y / step - 2, bottom = (ph - o.y) / step + 2;
  for (let i = Math.floor(left); i <= Math.ceil(right); i++) {
    const px = o.x + i * step;
    c.beginPath(); c.moveTo(px, 0); c.lineTo(px, ph); c.stroke();
  }
  for (let j = Math.floor(top); j <= Math.ceil(bottom); j++) {
    const py = o.y - j * step;
    c.beginPath(); c.moveTo(0, py); c.lineTo(pw, py); c.stroke();
  }
  c.strokeStyle = '#7d8aa0'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, o.y); c.lineTo(pw, o.y); c.stroke();
  c.beginPath(); c.moveTo(o.x, 0); c.lineTo(o.x, ph); c.stroke();
  c.fillStyle = '#5a6570'; c.font = '14px sans-serif';
  c.fillText('O', o.x + 6, o.y + 16);
  if (hooks.trigDegAxis?.()) {
    c.fillStyle = '#8a949e';
    c.fillText('x (°)', o.x + pw - 48, o.y + 16);
  }
}

function drawCurves(c) {
  const pw = PW(), o = origin();
  const fnsList = fns().filter((f) => f.mode !== 'param' && f.expr);
  for (const f of fnsList) {
    c.strokeStyle = f.color || '#2566c8'; c.lineWidth = 2.5;
    c.beginPath();
    let started = false;
    for (let px = 0; px <= pw; px += 3) {
      const gx = (px - o.x) / (hooks.unit?.() || 50);
      const y = evalY(f, gx);
      if (y == null) { started = false; continue; }
      const py = o.y - y * (hooks.unit?.() || 50);
      if (!started) { c.moveTo(px, py); started = true; } else c.lineTo(px, py);
    }
    c.stroke();
  }
}

function markRootsExtrema(c) {
  const pw = PW(), o = origin();
  const f = fns().find((x) => x.mode !== 'param' && x.expr);
  if (!f || !window.math) return;
  const u = hooks.unit?.() || 50;
  const roots = [], extrema = [];
  let prevY = null, prevDy = null;
  for (let px = 0; px <= pw; px += 2) {
    const gx = (px - o.x) / u;
    const y = evalY(f, gx);
    if (y == null) { prevY = null; continue; }
    if (prevY != null) {
      if (prevY * y <= 0 && Math.abs(y - prevY) > 0.001) roots.push(px);
      const dy = y - prevY;
      if (prevDy != null && prevDy * dy < 0) extrema.push(px);
      prevDy = dy;
    }
    prevY = y;
  }
  c.fillStyle = '#d23b3b';
  for (const px of roots.slice(0, 12)) {
    const gx = (px - o.x) / u;
    const y = evalY(f, gx);
    if (y == null) continue;
    c.beginPath(); c.arc(px, o.y - y * u, 5, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#1f9d57';
  for (const px of extrema.slice(0, 12)) {
    const gx = (px - o.x) / u;
    const y = evalY(f, gx);
    if (y == null) continue;
    c.beginPath(); c.arc(px, o.y - y * u, 5, 0, Math.PI * 2); c.fill();
  }
}

function renderGraphView() {
  if (!open || !cv || !ctx) return;
  const r = cv.getBoundingClientRect();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.setTransform(cam.scale, 0, 0, cam.scale, cam.ox, cam.oy);
  drawGrid(ctx);
  drawCurves(ctx);
  markRootsExtrema(ctx);
  ctx.restore();
}

function fitGraphView() {
  if (!cv) return;
  const pw = PW(), ph = PH();
  const r = cv.getBoundingClientRect();
  cam.scale = Math.min(r.width / pw, r.height / ph) * 0.92;
  cam.ox = (r.width - pw * cam.scale) / 2;
  cam.oy = (r.height - ph * cam.scale) / 2;
  renderGraphView();
}

export function openGraphView() {
  const el = document.getElementById('graph-view');
  if (!el) return;
  hooks.ensureAxes?.();
  el.classList.remove('hidden');
  open = true;
  cv = document.getElementById('gv-canvas');
  if (cv) {
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fitGraphView();
}

export function closeGraphView() {
  document.getElementById('graph-view')?.classList.add('hidden');
  open = false;
}

export function setupGraphViewPanel() {
  document.getElementById('gv-close')?.addEventListener('click', closeGraphView);
  document.getElementById('gv-fit')?.addEventListener('click', fitGraphView);
  document.getElementById('gp-view')?.addEventListener('click', openGraphView);
  const wrap = document.getElementById('graph-view');
  cv = document.getElementById('gv-canvas');
  if (!wrap || !cv) return;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    lastPt = { x: e.clientX, y: e.clientY };
    try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!dragging || !lastPt) return;
    cam.ox += e.clientX - lastPt.x;
    cam.oy += e.clientY - lastPt.y;
    lastPt = { x: e.clientX, y: e.clientY };
    renderGraphView();
  });
  wrap.addEventListener('pointerup', () => { dragging = false; lastPt = null; });
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    cam.ox = mx - (mx - cam.ox) * f;
    cam.oy = my - (my - cam.oy) * f;
    cam.scale *= f;
    renderGraphView();
  }, { passive: false });
}

export function refreshGraphView() {
  if (open) renderGraphView();
}
