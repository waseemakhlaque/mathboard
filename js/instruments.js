// instruments.js — ruler, protractor, compass (canvas overlays, page units)

let hooks = {};
let instTool = null;
let pend = [];

export function setupInstruments(h) { hooks = h; }

export function instToolActive() { return !!instTool; }

export function setInstTool(tool) {
  pend = [];
  instTool = tool || null;
  document.querySelectorAll('[data-inst]').forEach((b) => {
    b.classList.toggle('active', b.dataset.inst === tool);
  });
  if (tool) {
    hooks.setGeoTool?.(null);
    hooks.setMechPlacing?.(null);
    hooks.setCplxPlacing?.(null);
  }
}

function page() { return hooks.page?.(); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function snap(p) { return hooks.snapPt ? hooks.snapPt(p) : p; }
function unit() { return hooks.unit || 50; }

function ensure(pg) { if (!pg.instruments) pg.instruments = []; }

export function handleInstClick(p) {
  if (!instTool) return false;
  const pg = page();
  if (!pg) return false;
  const sp = snap(p);
  if (instTool === 'ruler') {
    if (!pend.length) { pend.push(sp); return true; }
    ensure(pg);
    hooks.beginAction?.();
    pg.instruments.push({ id: uid(), kind: 'ruler', a: pend[0], b: sp, color: '#2566c8' });
    hooks.commitAction?.();
    pend = []; setInstTool(null);
    hooks.mark?.();
    return true;
  }
  if (instTool === 'protractor') {
    if (pend.length < 2) { pend.push(sp); return true; }
    ensure(pg);
    const v = pend[0], a1 = pend[1], a2 = sp;
    const ang = angleDeg(a1, v, a2);
    hooks.beginAction?.();
    pg.instruments.push({ id: uid(), kind: 'protractor', vertex: v, arm1: a1, arm2: a2, deg: ang, color: '#e0892a' });
    hooks.commitAction?.();
    pend = []; setInstTool(null);
    hooks.mark?.();
    return true;
  }
  if (instTool === 'compass') {
    if (!pend.length) { pend.push(sp); return true; }
    ensure(pg);
    const r = Math.hypot(sp.x - pend[0].x, sp.y - pend[0].y);
    hooks.beginAction?.();
    pg.instruments.push({ id: uid(), kind: 'compass', center: pend[0], r, color: '#1f9d57' });
    hooks.commitAction?.();
    pend = []; setInstTool(null);
    hooks.mark?.();
    return true;
  }
  return false;
}

function angleDeg(a, v, b) {
  const a1 = Math.atan2(a.y - v.y, a.x - v.x);
  const a2 = Math.atan2(b.y - v.y, b.x - v.x);
  let d = (a2 - a1) * 180 / Math.PI;
  if (d < 0) d += 360;
  return Math.round(d);
}

export function drawInstruments(c, pg) {
  for (const it of pg.instruments || []) {
    if (it.kind === 'ruler') drawRuler(c, it);
    else if (it.kind === 'protractor') drawProtractor(c, it);
    else if (it.kind === 'compass') drawCompass(c, it);
  }
  if (instTool && pend.length) drawPreview(c);
}

function drawPreview(c) {
  c.save();
  c.strokeStyle = '#2566c8'; c.lineWidth = 2; c.setLineDash([8, 6]);
  if (instTool === 'ruler' && pend.length === 1) {
    c.beginPath(); c.arc(pend[0].x, pend[0].y, 5, 0, Math.PI * 2); c.stroke();
  }
  if (instTool === 'protractor') {
    for (const p of pend) { c.beginPath(); c.arc(p.x, p.y, 5, 0, Math.PI * 2); c.stroke(); }
  }
  if (instTool === 'compass' && pend.length === 1) {
    c.beginPath(); c.arc(pend[0].x, pend[0].y, 5, 0, Math.PI * 2); c.stroke();
  }
  c.setLineDash([]); c.restore();
}

function drawRuler(c, it) {
  const len = Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y);
  const units = len / unit();
  c.strokeStyle = it.color || '#2566c8'; c.lineWidth = 3; c.lineCap = 'round';
  c.beginPath(); c.moveTo(it.a.x, it.a.y); c.lineTo(it.b.x, it.b.y); c.stroke();
  for (let t = 0; t <= 1; t += 0.1) {
    const x = it.a.x + (it.b.x - it.a.x) * t, y = it.a.y + (it.b.y - it.a.y) * t;
    const nx = -(it.b.y - it.a.y) / len * 8, ny = (it.b.x - it.a.x) / len * 8;
    c.beginPath(); c.moveTo(x - nx, y - ny); c.lineTo(x + nx, y + ny); c.stroke();
  }
  const mx = (it.a.x + it.b.x) / 2, my = (it.a.y + it.b.y) / 2;
  c.font = '600 16px sans-serif'; c.fillStyle = it.color || '#2566c8';
  c.fillText(`${units.toFixed(2)} u`, mx + 6, my - 8);
}

function drawProtractor(c, it) {
  const { vertex: v, arm1: a1, arm2: a2, deg } = it;
  const r = 36;
  c.strokeStyle = it.color || '#e0892a'; c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(v.x, v.y); c.lineTo(a1.x, a1.y); c.stroke();
  c.beginPath(); c.moveTo(v.x, v.y); c.lineTo(a2.x, a2.y); c.stroke();
  const start = Math.atan2(a1.y - v.y, a1.x - v.x);
  const end = Math.atan2(a2.y - v.y, a2.x - v.x);
  c.beginPath(); c.arc(v.x, v.y, r, start, end); c.stroke();
  c.font = '600 17px sans-serif'; c.fillStyle = it.color || '#e0892a';
  c.fillText(`${deg}°`, v.x + r + 6, v.y - 4);
}

function drawCompass(c, it) {
  c.strokeStyle = it.color || '#1f9d57'; c.lineWidth = 2.5;
  c.beginPath(); c.arc(it.center.x, it.center.y, it.r, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(it.center.x, it.center.y);
  c.lineTo(it.center.x + it.r, it.center.y); c.stroke();
  const rad = it.r / unit();
  c.font = '600 16px sans-serif'; c.fillStyle = it.color || '#1f9d57';
  c.fillText(`r = ${rad.toFixed(2)}`, it.center.x + 8, it.center.y - it.r - 6);
}

export function clearInstrumentsPage() {
  const pg = page();
  if (!pg?.instruments?.length) return;
  hooks.beginAction?.();
  pg.instruments = [];
  hooks.commitAction?.();
  hooks.mark?.();
}
