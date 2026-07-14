// instruments.js — OpenBoard-style draggable ruler / protractor / compass widgets
// One instance per kind per page (toggle on/off from toolbar).
// Rendered as canvas overlays in drawInstruments; hit-tested with 44px-equiv touch targets.
// Rotate/resize handles + close button on each widget.
// Compass draws real arcs committed as ink strokes.

let hooks = {};
let selInst = null;       // currently selected instrument (Select tool)
let instMove = null;      // { lastX, lastY, handle, ... } for active drag gesture
const HANDLE_R = 9;       // handle radius in page units (visual)
const CLOSE_R = 8;        // close button radius
const TOL_HANDLE = 18;    // hit tolerance for handles (page units)
const TOL_BODY = 22;      // hit tolerance for body (generous for touch)

// ── helpers ─────────────────────────────────────────────────────────────────
function page() { return hooks.page?.(); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function unit() { return hooks.unit || 50; }
function getScale() { return hooks.getScale?.() ?? 1; }
function ensure(pg) { if (!pg.instruments) pg.instruments = []; }

// Convert screen px tolerance to page units (zoom-independent touch target)
function tolPx(px) { return px / getScale(); }

// ── widget creation (dropped at page centre) ────────────────────────────────
function pageCentre() {
  const pg = page();
  if (!pg) return { x: 500, y: 707 };
  const w = hooks.pageW?.() ?? 1000;
  const h = hooks.pageH?.() ?? 1414;
  return { x: w / 2, y: h / 2 };
}

function createRuler() {
  const c = pageCentre();
  return {
    id: uid(), kind: 'ruler',
    x: c.x - 150, y: c.y - 60,
    length: 400,
    rotation: 0,       // radians; 0 = horizontal, drawing edge at bottom
    width: 14,
  };
}

function createProtractor() {
  const c = pageCentre();
  return {
    id: uid(), kind: 'protractor',
    x: c.x, y: c.y,
    radius: 120,
    rotation: 0,
  };
}

function createCompass() {
  const c = pageCentre();
  const r0 = 100;
  return {
    id: uid(), kind: 'compass',
    pivot: { x: c.x, y: c.y },
    pencil: { x: c.x + r0, y: c.y },
    radius: r0,
  };
}

function createWidget(kind) {
  if (kind === 'ruler') return createRuler();
  if (kind === 'protractor') return createProtractor();
  if (kind === 'compass') return createCompass();
  return null;
}

// ── instrument bbox (for selection chrome / hit-test fast path) ────────────
function instBBox(it) {
  if (it.kind === 'ruler') {
    const hw = it.length / 2, hh = it.width / 2 + 2;
    const p = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }]
      .map(pt => rotPt(pt, it.rotation));
    const xs = p.map(pt => it.x + pt.x), ys = p.map(pt => it.y + pt.y);
    const pad = 28;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  if (it.kind === 'protractor') {
    const r = it.radius + 10;
    return { x: it.x - r, y: it.y - r, w: r * 2, h: r * 2 };
  }
  if (it.kind === 'compass') {
    const r = it.radius + 20;
    const cx = (it.pivot.x + it.pencil.x) / 2;
    const cy = (it.pivot.y + it.pencil.y) / 2;
    return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

// ── malformed-data guard (mirrors app.js's objGeomOk for page objects) ──────
// A corrupt/partial instrument (e.g. an interrupted save, or a future schema
// this build doesn't know) must be skipped in draw/hit, never thrown — a single
// bad widget should not take down the whole page with an error banner.
function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
function instGeomOk(it) {
  if (!it || typeof it !== 'object') return false;
  if (it.kind === 'ruler') return isFiniteNum(it.x) && isFiniteNum(it.y) && isFiniteNum(it.length) && isFiniteNum(it.rotation);
  if (it.kind === 'protractor') return isFiniteNum(it.x) && isFiniteNum(it.y) && isFiniteNum(it.radius) && isFiniteNum(it.rotation);
  if (it.kind === 'compass') {
    return isFiniteNum(it.radius) && it.pivot && it.pencil
      && isFiniteNum(it.pivot.x) && isFiniteNum(it.pivot.y) && isFiniteNum(it.pencil.x) && isFiniteNum(it.pencil.y);
  }
  return false; // unknown kind
}

// ── geometry helpers ────────────────────────────────────────────────────────
function rotPt(pt, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: pt.x * c - pt.y * s, y: pt.x * s + pt.y * c };
}

// Ruler drawing edge segment (the edge ink snaps to)
function rulerEdge(it) {
  const hw = it.length / 2, hw2 = it.width / 2;
  const ux = Math.cos(it.rotation), uy = Math.sin(it.rotation);
  const px = -uy, py = ux;  // perpendicular pointing "down" (drawing edge side)
  return {
    a: { x: it.x - ux * hw + px * hw2, y: it.y - uy * hw + py * hw2 },
    b: { x: it.x + ux * hw + px * hw2, y: it.y + uy * hw + py * hw2 },
  };
}

function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

function projSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return { ...a };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// ── drawing ─────────────────────────────────────────────────────────────────
export function drawInstruments(c, pg) {
  const list = pg.instruments || [];
  for (const it of list) {
    if (!instGeomOk(it)) continue; // corrupt/partial widget — skip, don't throw
    if (it.kind === 'ruler') drawRuler(c, it, it === selInst);
    else if (it.kind === 'protractor') drawProtractor(c, it, it === selInst);
    else if (it.kind === 'compass') drawCompass(c, it, it === selInst);
  }
  // Arc preview while dragging compass pencil
  if (instMove?.handle === 'pencil' && instMove.arcPoints?.length >= 2) {
    drawArcPreview(c, instMove.arcPoints);
  }
}

function drawArcPreview(c, pts) {
  if (pts.length < 2) return;
  c.save();
  c.strokeStyle = '#1b1b1b'; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round';
  c.globalAlpha = 0.6;
  c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  c.stroke();
  c.restore();
}

function drawRuler(c, it, sel) {
  const { x, y, length: L, rotation: rot, width: W } = it;
  const cxt = Math.cos(rot), s = Math.sin(rot);
  const px = -s, py = cxt; // unit perpendicular
  const hw = L / 2, hh = W / 2;
  const u = unit();

  // Four corners of the strip (local coords, then rotated)
  const corners = [
    { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
  ].map(pt => rotPt(pt, rot)).map(pt => ({ x: x + pt.x, y: y + pt.y }));

  c.save();
  // Fill strip (semi-transparent)
  c.fillStyle = 'rgba(37, 102, 200, 0.10)';
  c.strokeStyle = sel ? '#d23b3b' : 'rgba(37, 102, 200, 0.5)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) c.lineTo(corners[i].x, corners[i].y);
  c.closePath(); c.fill(); c.stroke();

  // Drawing edge (bottom edge = the hh-positive side)
  const edgeA = corners[3], edgeB = corners[2];
  c.strokeStyle = sel ? '#d23b3b' : '#2566c8';
  c.lineWidth = sel ? 3 : 2;
  c.beginPath(); c.moveTo(edgeA.x, edgeA.y); c.lineTo(edgeB.x, edgeB.y); c.stroke();

  // Tick marks (every 0.5 units = 25 page units, bold every unit)
  const tickDir = { x: -px, y: -py }; // ticks go "up" from drawing edge
  c.strokeStyle = sel ? '#d23b3b' : '#2566c8';
  c.font = sel ? 'bold 9px sans-serif' : '9px sans-serif';
  c.fillStyle = sel ? '#d23b3b' : '#2566c8';
  c.textAlign = 'center';
  c.textBaseline = 'bottom';

  const step = 25; // half-unit ticks (50 page units = 1 unit)
  const nTicks = Math.floor(L / step);
  for (let i = 0; i <= nTicks; i++) {
    const t = i / nTicks;
    const px2 = lerp(edgeA, edgeB, t);
    const isMajor = i % 2 === 0;
    const tickLen = isMajor ? 10 : 5;
    c.lineWidth = isMajor ? 1.5 : 0.8;
    c.beginPath();
    c.moveTo(px2.x, px2.y);
    c.lineTo(px2.x + tickDir.x * tickLen, px2.y + tickDir.y * tickLen);
    c.stroke();
    // Label every full unit
    if (isMajor) {
      const label = '' + (i / 2);
      const lx = px2.x + tickDir.x * (tickLen + 2);
      const ly = px2.y + tickDir.y * (tickLen + 2);
      c.fillText(label, lx, ly);
    }
  }

  // Rotation handle (circle at one end of the strip)
  const rotH = { x: x - ux(cxt, s, hw), y: y - uy(cxt, s, hw) };
  c.fillStyle = '#ffffff'; c.strokeStyle = sel ? '#d23b3b' : '#2566c8'; c.lineWidth = 2;
  c.beginPath(); c.arc(rotH.x, rotH.y, HANDLE_R, 0, Math.PI * 2); c.fill(); c.stroke();

  // Resize handle at other end
  const resH = { x: x + ux(cxt, s, hw), y: y + uy(cxt, s, hw) };
  c.fillStyle = '#ffffff';
  c.beginPath(); c.arc(resH.x, resH.y, HANDLE_R, 0, Math.PI * 2); c.fill(); c.stroke();

  // Rotate indicator: small angle readout near rotation handle
  if (sel && Math.abs(it.rotation) > 0.01) {
    const deg = Math.round(it.rotation * 180 / Math.PI);
    c.font = '10px sans-serif'; c.fillStyle = '#d23b3b';
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(`${deg}°`, rotH.x - 18, rotH.y - 12);
  }

  // Close button (top-right corner of strip)
  const closePt = corners[1];
  c.fillStyle = 'rgba(220, 60, 60, 0.85)';
  c.beginPath(); c.arc(closePt.x, closePt.y, CLOSE_R, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fff'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('✕', closePt.x, closePt.y);

  c.restore();
}

function ux(c, s, hw) { return c * hw; }
function uy(c, s, hw) { return s * hw; }

function drawProtractor(c, it, sel) {
  const { x, y, radius: R, rotation: rot } = it;
  c.save();

  // Semi-transparent half-disc
  c.beginPath();
  c.arc(x, y, R, rot - Math.PI, rot, false);
  c.closePath();
  c.fillStyle = 'rgba(224, 137, 42, 0.10)';
  c.fill();
  c.strokeStyle = sel ? '#d23b3b' : 'rgba(224, 137, 42, 0.5)';
  c.lineWidth = 1.5;
  c.stroke();

  // Baseline (diameter line)
  c.strokeStyle = sel ? '#d23b3b' : 'rgba(224, 137, 42, 0.6)';
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(x - Math.cos(rot) * R, y - Math.sin(rot) * R);
  c.lineTo(x + Math.cos(rot) * R, y + Math.sin(rot) * R);
  c.stroke();

  // Degree marks (every 1°, labels every 10°)
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '8px sans-serif'; c.fillStyle = sel ? '#d23b3b' : '#b0722a';
  c.strokeStyle = sel ? '#d23b3b' : '#b0722a';
  for (let deg = 0; deg <= 180; deg++) {
    const a = rot - Math.PI + deg * Math.PI / 180;
    const inner = R - 8, outer = R - 3;
    const major = deg % 10 === 0;
    const tickR = major ? inner - 5 : inner;
    const isEdge = deg === 0 || deg === 180;
    if (!isEdge || sel) {
      c.lineWidth = major ? 1.2 : 0.5;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * tickR, y + Math.sin(a) * tickR);
      c.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
      c.stroke();
    }
    // Label every 10°
    if (major && deg > 0 && deg < 180) {
      const lx = x + Math.cos(a) * (inner - 8);
      const ly = y + Math.sin(a) * (inner - 8);
      c.fillStyle = sel ? '#d23b3b' : '#8a6520';
      c.fillText('' + deg, lx, ly);
    }
  }

  // Rotation handle on rim at baseline-end
  const rotX = x + Math.cos(rot) * R, rotY = y + Math.sin(rot) * R;
  c.fillStyle = '#ffffff'; c.strokeStyle = sel ? '#d23b3b' : '#e0892a'; c.lineWidth = 2;
  c.beginPath(); c.arc(rotX, rotY, HANDLE_R, 0, Math.PI * 2); c.fill(); c.stroke();

  // Needle (follows pointer when hovering/dragging over the protractor)
  if (instMove?.handle === 'needle' && instMove.needleAngle != null) {
    const na = instMove.needleAngle;
    const nx = x + Math.cos(na) * (R - 10), ny = y + Math.sin(na) * (R - 10);
    c.strokeStyle = '#d23b3b'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x, y); c.lineTo(nx, ny); c.stroke();
    const deg = Math.round(((na - rot + Math.PI * 2) % (Math.PI * 2)) * 180 / Math.PI);
    c.fillStyle = '#d23b3b'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(`${deg}°`, nx, ny - 8);
  } else if (sel) {
    // Show a default angle readout at 30°
    const demoDeg = 30;
    const da = rot - Math.PI + demoDeg * Math.PI / 180;
    const dx = x + Math.cos(da) * (R - 10), dy = y + Math.sin(da) * (R - 10);
    c.strokeStyle = '#b0722a'; c.lineWidth = 1.5; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(x, y); c.lineTo(dx, dy); c.stroke(); c.setLineDash([]);
    c.fillStyle = sel ? '#d23b3b' : '#b0722a';
    c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(`${demoDeg}°`, dx, dy - 8);
  }

  // Close button (top of the disc, rotated frame)
  const closeAng = rot - Math.PI / 2;
  const closePt = { x: x + Math.cos(closeAng) * (R - 12), y: y + Math.sin(closeAng) * (R - 12) };
  c.fillStyle = 'rgba(220, 60, 60, 0.85)';
  c.beginPath(); c.arc(closePt.x, closePt.y, CLOSE_R, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fff'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('✕', closePt.x, closePt.y);

  c.restore();
}

function drawCompass(c, it, sel) {
  const { pivot, pencil, radius: R } = it;
  c.save();

  // Pivot point (needle)
  c.fillStyle = '#1f9d57'; c.strokeStyle = sel ? '#d23b3b' : '#1f9d57'; c.lineWidth = 2;
  c.beginPath(); c.arc(pivot.x, pivot.y, 5, 0, Math.PI * 2); c.fill(); c.stroke();
  // Small inner dot
  c.fillStyle = '#0f5d2f';
  c.beginPath(); c.arc(pivot.x, pivot.y, 2, 0, Math.PI * 2); c.fill();

  // Pencil tip
  c.fillStyle = '#ffffff';
  c.beginPath(); c.arc(pencil.x, pencil.y, 5, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = '#1f9d57';
  c.beginPath(); c.arc(pencil.x, pencil.y, 2.5, 0, Math.PI * 2); c.fill();

  // Dashed radius line
  c.strokeStyle = 'rgba(31, 157, 87, 0.4)'; c.lineWidth = 1; c.setLineDash([4, 4]);
  c.beginPath(); c.moveTo(pivot.x, pivot.y); c.lineTo(pencil.x, pencil.y); c.stroke(); c.setLineDash([]);

  // Arc preview (the faint circle showing the path the pencil will trace)
  c.strokeStyle = 'rgba(31, 157, 87, 0.2)'; c.lineWidth = 1;
  c.beginPath(); c.arc(pivot.x, pivot.y, R, 0, Math.PI * 2); c.stroke();

  // Radius label
  const radUnits = R / unit();
  c.font = '10px sans-serif'; c.fillStyle = sel ? '#d23b3b' : '#1f9d57';
  c.textAlign = 'center'; c.textBaseline = 'bottom';
  c.fillText(`r = ${radUnits.toFixed(1)} u`, pivot.x, pivot.y - R - 6);

  // Close button
  const dx = pencil.x - pivot.x, dy = pencil.y - pivot.y;
  const d = Math.hypot(dx, dy) || 1;
  const closePt = { x: pivot.x + dx / d * (R + 16), y: pivot.y + dy / d * (R + 16) };
  c.fillStyle = 'rgba(220, 60, 60, 0.85)';
  c.beginPath(); c.arc(closePt.x, closePt.y, CLOSE_R, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fff'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('✕', closePt.x, closePt.y);

  c.restore();
}

// ── hit testing (returns the instrument and handle name) ────────────────────
/** Determine which handle of `it` is near `p`, or 'body' / 'close' / null. */
function handleAt(it, p) {
  const tol = tolPx(TOL_HANDLE);

  if (it.kind === 'ruler') {
    const { x, y, length: L, rotation: rot, width: W } = it;
    const cxt = Math.cos(rot), s = Math.sin(rot);
    const hw = L / 2;
    // Close button at top-right corner of strip
    const closePt = { x: x + cxt * hw - s * (-W / 2), y: y + s * hw + cxt * (-W / 2) };
    if (dist(p, closePt) < tol + CLOSE_R) return 'close';
    // Rotation handle at left end
    const rotH = { x: x - cxt * hw, y: y - s * hw };
    if (dist(p, rotH) < tol + HANDLE_R) return 'rotate';
    // Resize handle at right end
    const resH = { x: x + cxt * hw, y: y + s * hw };
    if (dist(p, resH) < tol + HANDLE_R) return 'resize';
    // Body: check if p is within the strip rectangle (with generous tolerance)
    const local = { x: (p.x - x) * cxt + (p.y - y) * s, y: -(p.x - x) * s + (p.y - y) * cxt };
    const hwBody = hw + tol, hh = W / 2 + tol;
    if (local.x >= -hwBody && local.x <= hwBody && local.y >= -hh && local.y <= hh) return 'body';
    return null;
  }

  if (it.kind === 'protractor') {
    const { x, y, radius: R, rotation: rot } = it;
    // Close button at top of disc
    const closeAng = rot - Math.PI / 2;
    const closePt = { x: x + Math.cos(closeAng) * (R - 12), y: y + Math.sin(closeAng) * (R - 12) };
    if (dist(p, closePt) < tol + CLOSE_R) return 'close';
    // Rotation handle at baseline end
    const rotH = { x: x + Math.cos(rot) * R, y: y + Math.sin(rot) * R };
    if (dist(p, rotH) < tol + HANDLE_R) return 'rotate';
    // Needle area: inside the half-disc
    const d = dist(p, { x, y });
    if (d < R + tol) {
      // Check if point is in the half-disc area (angled between rot-PI and rot)
      const a = Math.atan2(p.y - y, p.x - x);
      let da = ((a - (rot - Math.PI)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (da <= Math.PI + 0.1) return 'needle';
    }
    return null;
  }

  if (it.kind === 'compass') {
    const { pivot, pencil, radius: R } = it;
    // Close button beyond pencil tip
    const dx = pencil.x - pivot.x, dy = pencil.y - pivot.y;
    const d = Math.hypot(dx, dy) || 1;
    const closePt = { x: pivot.x + dx / d * (R + 16), y: pivot.y + dy / d * (R + 16) };
    if (dist(p, closePt) < tol + CLOSE_R) return 'close';
    // Pencil tip handle
    if (dist(p, pencil) < tol + 8) return 'pencil';
    // Pivot (body drag)
    if (dist(p, pivot) < TOL_BODY + 10) return 'body';
    // Body: near the line between pivot and pencil
    const proj = projSeg(p, pivot, pencil);
    if (dist(p, proj) < TOL_BODY && dist(proj, pivot) <= R && dist(proj, { x: pivot.x + dx / d * R, y: pivot.y + dy / d * R }) <= R) return 'body';
    return null;
  }

  return null;
}

export function hitInstrument(p, tol) {
  const pg = page();
  if (!pg?.instruments?.length) return null;
  const t = tol || tolPx(TOL_BODY);
  // Check from top (last) to bottom (first) for visual stacking
  for (let i = pg.instruments.length - 1; i >= 0; i--) {
    const it = pg.instruments[i];
    if (!instGeomOk(it)) continue; // corrupt/partial widget — never hit-testable
    const h = handleAt(it, p);
    if (h === 'close' || h === 'body' || h === 'needle' || h === 'pencil' || h === 'rotate' || h === 'resize') return it;
  }
  return null;
}

// ── select / move / rotate / resize ─────────────────────────────────────────
export function beginInstMove(p) {
  const pg = page();
  if (!pg?.instruments?.length) { selInst = null; return false; }
  // Hit test from top down
  for (let i = pg.instruments.length - 1; i >= 0; i--) {
    const it = pg.instruments[i];
    if (!instGeomOk(it)) continue; // corrupt/partial widget — skip, don't throw
    const handle = handleAt(it, p);
    if (!handle) continue;

    selInst = it;

    // Close button → delete immediately
    if (handle === 'close') {
      hooks.beginAction?.();
      pg.instruments.splice(i, 1);
      selInst = null;
      hooks.commitAction?.();
      hooks.mark?.();
      syncInstButtons();
      return false; // no drag gesture
    }

    hooks.beginAction?.();

    if (handle === 'rotate') {
      const c = instCenter(it);
      instMove = { lastX: p.x, lastY: p.y, handle: 'rotate', centerX: c.x, centerY: c.y, startRotation: getRotation(it) };
      return true;
    }
    if (handle === 'resize') {
      instMove = { lastX: p.x, lastY: p.y, handle: 'resize', startLength: it.length ?? it.radius, pivot: it.kind === 'compass' ? { ...it.pivot } : null };
      return true;
    }
    if (handle === 'pencil' && it.kind === 'compass') {
      // Start compass arc drawing
      instMove = { lastX: p.x, lastY: p.y, handle: 'pencil', arcPoints: [] };
      return true;
    }
    if (handle === 'needle' && it.kind === 'protractor') {
      instMove = { lastX: p.x, lastY: p.y, handle: 'needle', needleAngle: Math.atan2(p.y - it.y, p.x - it.x) };
      return true;
    }
    // Body drag
    instMove = { lastX: p.x, lastY: p.y, handle: 'body' };
    return true;
  }
  selInst = null;
  return false;
}

function instCenter(it) {
  if (it.kind === 'ruler') return { x: it.x, y: it.y };
  if (it.kind === 'protractor') return { x: it.x, y: it.y };
  if (it.kind === 'compass') return { x: (it.pivot.x + it.pencil.x) / 2, y: (it.pivot.y + it.pencil.y) / 2 };
  return { x: 0, y: 0 };
}

function getRotation(it) {
  if (it.kind === 'ruler') return it.rotation;
  if (it.kind === 'protractor') return it.rotation;
  return 0;
}

function setRotation(it, angle) {
  if (it.kind === 'ruler') it.rotation = angle;
  if (it.kind === 'protractor') it.rotation = angle;
}

export function moveInst(p) {
  if (!selInst || !instMove) return false;
  const dx = p.x - instMove.lastX, dy = p.y - instMove.lastY;

  if (instMove.handle === 'body') {
    if (selInst.kind === 'ruler') { selInst.x += dx; selInst.y += dy; }
    else if (selInst.kind === 'protractor') { selInst.x += dx; selInst.y += dy; }
    else if (selInst.kind === 'compass') { selInst.pivot.x += dx; selInst.pivot.y += dy; selInst.pencil.x += dx; selInst.pencil.y += dy; }
    instMove.lastX = p.x; instMove.lastY = p.y;
    hooks.mark?.();
    return true;
  }

  if (instMove.handle === 'rotate') {
    const ang = Math.atan2(p.y - instMove.centerY, p.x - instMove.centerX);
    setRotation(selInst, ang);
    // For protractor, also show needle along rotation handle
    if (selInst.kind === 'protractor') {
      const deg = Math.round(((ang - instMove.startRotation + Math.PI * 2) % (Math.PI * 2)) * 180 / Math.PI);
      instMove.needleAngle = ang; // show angle readout
    }
    instMove.lastX = p.x; instMove.lastY = p.y;
    hooks.mark?.();
    return true;
  }

  if (instMove.handle === 'resize') {
    if (selInst.kind === 'ruler') {
      const c = instCenter(selInst);
      const newLen = Math.max(80, dist(c, p) * 2);
      selInst.length = newLen;
    } else if (selInst.kind === 'compass') {
      const d = dist(selInst.pivot, p);
      selInst.radius = Math.max(20, d);
      // Move pencil to the new radius along current direction
      const dx2 = selInst.pencil.x - selInst.pivot.x, dy2 = selInst.pencil.y - selInst.pivot.y;
      const dd = Math.hypot(dx2, dy2) || 1;
      selInst.pencil.x = selInst.pivot.x + dx2 / dd * selInst.radius;
      selInst.pencil.y = selInst.pivot.y + dy2 / dd * selInst.radius;
    }
    instMove.lastX = p.x; instMove.lastY = p.y;
    hooks.mark?.();
    return true;
  }

  if (instMove.handle === 'pencil' && selInst.kind === 'compass') {
    // Move the pencil tip to follow cursor, constrained to radius
    const dx2 = p.x - selInst.pivot.x, dy2 = p.y - selInst.pivot.y;
    const d = Math.hypot(dx2, dy2) || 1;
    selInst.pencil.x = selInst.pivot.x + dx2 / d * selInst.radius;
    selInst.pencil.y = selInst.pivot.y + dy2 / d * selInst.radius;

    // Sample arc points: only record if moving along the arc (angular change)
    const ang = Math.atan2(dy2, dx2);
    const last = instMove.arcPoints[instMove.arcPoints.length - 1];
    if (last) {
      const lastAng = Math.atan2(last.y - selInst.pivot.y, last.x - selInst.pivot.x);
      const aDiff = Math.abs(normalizeAngle(ang - lastAng));
      // Sample every ~2 degrees or 3px movement
      if (aDiff > 0.035 || dist(p, instMove.arcPoints[instMove.arcPoints.length - 1]) > 3) {
        instMove.arcPoints.push({ x: selInst.pencil.x, y: selInst.pencil.y, p: 0.5 });
      }
    } else {
      // First point: also add the starting position
      const startPt = instMove.arcPoints[0] || { x: instMove.lastX, y: instMove.lastY, p: 0.5 };
      if (instMove.arcPoints.length === 0) {
        // Project start onto arc
        const sdx = instMove.lastX - selInst.pivot.x, sdy = instMove.lastY - selInst.pivot.y;
        const sd = Math.hypot(sdx, sdy) || 1;
        instMove.arcPoints.push({ x: selInst.pivot.x + sdx / sd * selInst.radius, y: selInst.pivot.y + sdy / sd * selInst.radius, p: 0.5 });
      }
      instMove.arcPoints.push({ x: selInst.pencil.x, y: selInst.pencil.y, p: 0.5 });
    }
    instMove.lastX = p.x; instMove.lastY = p.y;
    hooks.mark?.();
    return true;
  }

  if (instMove.handle === 'needle' && selInst.kind === 'protractor') {
    instMove.needleAngle = Math.atan2(p.y - selInst.y, p.x - selInst.x);
    instMove.lastX = p.x; instMove.lastY = p.y;
    hooks.mark?.();
    return true;
  }

  return false;
}

function normalizeAngle(a) {
  while (a < 0) a += Math.PI * 2;
  while (a >= Math.PI * 2) a -= Math.PI * 2;
  return a;
}

export function endInstMove() {
  if (selInst && instMove) {
    // Compass arc: commit as ink stroke
    if (instMove.handle === 'pencil' && instMove.arcPoints?.length >= 3) {
      const pg = hooks.page();
      if (pg) {
        const stroke = {
          id: uid(),
          tool: 'pen',
          color: '#1b1b1b',
          width: 4,
          penType: 'fine',
          points: instMove.arcPoints.map(p => ({ x: p.x, y: p.y, p: p.p ?? 0.5 })),
        };
        pg.strokes.push(stroke);
      }
    }
    hooks.commitAction?.();
  }
  instMove = null;
}

// ── snap ink to ruler edge ──────────────────────────────────────────────────
export function snapToRuler(p, tol) {
  const pg = page();
  if (!pg?.instruments?.length) return p;
  const t = tol || 12;
  let best = null, bestD = t * t;
  for (const it of pg.instruments) {
    if (it.kind !== 'ruler') continue;
    const edge = rulerEdge(it);
    const q = projSeg(p, edge.a, edge.b);
    const d = dist2(p, q);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best || p;
}

// ── selection API (used by app.js Select tool) ──────────────────────────────
export function selectedInstrument() { return selInst; }

export function clearInstSelection() { selInst = null; instMove = null; }

export function selectedInstBBox() {
  return selInst ? instBBox(selInst) : null;
}

export function deleteSelectedInstrument() {
  const pg = page();
  if (!selInst || !pg?.instruments?.length) return false;
  const i = pg.instruments.indexOf(selInst);
  if (i < 0) { clearInstSelection(); return false; }
  hooks.beginAction?.();
  pg.instruments.splice(i, 1);
  clearInstSelection();
  hooks.commitAction?.();
  hooks.mark?.();
  syncInstButtons();
  return true;
}

// ── tool API ────────────────────────────────────────────────────────────────
export function setupInstruments(h) {
  hooks = h;
}

export function setInstTool(tool) {
  if (!tool) {
    // Clear any active armed state (not used in new model, but keep for compat)
    instTool = null;
    syncInstButtons();
    return;
  }

  const pg = page();
  if (!pg) return;
  ensure(pg);

  // Toggle: if this kind exists, remove it; otherwise add it
  const existing = pg.instruments.find(i => i.kind === tool);
  if (existing) {
    hooks.beginAction?.();
    pg.instruments = pg.instruments.filter(i => i !== existing);
    if (selInst === existing) clearInstSelection();
    hooks.commitAction?.();
    hooks.mark?.();
  } else {
    hooks.beginAction?.();
    const widget = createWidget(tool);
    pg.instruments.push(widget);
    selInst = widget; // auto-select
    hooks.commitAction?.();
    hooks.mark?.();
  }
  syncInstButtons();
}

let instTool = null; // armed tool (no longer used for placement, kept for API compat)

export function instToolActive() { return false; } // no persistent armed state

export function handleInstClick(p) { return false; } // no-op: placement is immediate

// Sync [data-inst] button active states to match page content
function syncInstButtons() {
  const pg = page();
  const kinds = new Set((pg?.instruments || []).map(i => i.kind));
  document.querySelectorAll('[data-inst]').forEach((b) => {
    b.classList.toggle('active', kinds.has(b.dataset.inst));
  });
}

/** Synchronise button states from outside (e.g. on page change). */
export function syncInstButtonState() {
  syncInstButtons();
}

export function clearInstrumentsPage() {
  const pg = page();
  if (!pg?.instruments?.length) return;
  hooks.beginAction?.();
  pg.instruments = [];
  clearInstSelection();
  hooks.commitAction?.();
  hooks.mark?.();
  syncInstButtons();
}