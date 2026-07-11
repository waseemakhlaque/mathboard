// geo.js — JSXGraph geometry layer (points, constructions, angles, conics)
// Coordinates match page units: origin top-left, y increases downward (like the canvas).

import { pageW, pageH } from './pageLayout.js';
let board = null;
let boardPageId = null;
let geoTool = null;
let pend = [];       // JSXGraph point elements in progress
let hooks = {};
let geoEditing = false;
let previewLine = null;

function PW() { return (typeof hooks.pageW === 'function' ? hooks.pageW() : hooks.pageW) || 1000; }
function PH() { return (typeof hooks.pageH === 'function' ? hooks.pageH() : hooks.pageH) || 1414; }

const geoAttr = { strokeColor: '#2566c8', strokeWidth: 2.5, highlightStrokeColor: '#d23b3b' };
const ptAttr = { size: 5, fillColor: '#2566c8', strokeColor: '#1f2733', strokeWidth: 1.5, withLabel: true, name: '' };

export function setupGeo(h) { hooks = h; }

export function flushGeo() { if (board) dumpGeoItems(); }

export function geoToolActive() { return !!geoTool; }

/** Cancel in-progress clicks (e.g. polygon vertices) without committing. */
export function cancelGeoDraft() {
  if (!pend.length) return;
  if (geoEditing) {
    geoEditing = false;
    hooks.cancelAction?.();
  }
  if (previewLine) { try { board.removeObject(previewLine); } catch (_) { /* ok */ } previewLine = null; }
  pend = [];
  board?.update();
}

export function setGeoTool(tool) {
  cancelGeoDraft();
  pend = [];
  if (geoEditing) { geoEditing = false; hooks.cancelAction?.(); }
  geoTool = tool;
  if (tool) hooks.setInstTool?.(null);
  const layer = document.getElementById('geo-layer');
  if (layer) layer.classList.toggle('active', !!tool);
  document.querySelectorAll('[data-geo]').forEach((b) => {
    if (b.id === 'geo-clear') return;
    b.classList.toggle('active', b.dataset.geo === tool);
  });
  if (tool) document.querySelectorAll('[data-tool]').forEach((b) => b.classList.remove('active'));
}

export function syncGeoLayer(ox, oy, scale) {
  const layer = document.getElementById('geo-layer');
  if (!layer) return;
  layer.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
}

export function teardownGeo() {
  if (board && window.JXG) {
    try { JXG.JSXGraph.freeBoard(board); } catch (_) { /* ok */ }
  }
  board = null;
  boardPageId = null;
  // Drop any in-progress construction: its points belong to the freed board,
  // and feeding them to board.create() on the next board throws
  // "Can't create line with parent types 'object' and 'object'".
  pend = [];
  previewLine = null;
  geoEditing = false;
  const inner = document.getElementById('geo-inner');
  if (inner) inner.innerHTML = '';
}

function page() { return hooks.page?.(); }

function snapPt(p) { return hooks.snapPt ? hooks.snapPt(p) : p; }

function unit() { return hooks.unit || 50; }

function polyPerimeter(poly) {
  const v = poly.vertices;
  if (!v?.length) return 0;
  let p = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    p += Math.hypot(a.X() - b.X(), a.Y() - b.Y());
  }
  return p;
}

function polyMeasureText(poly) {
  const u = unit();
  const a = poly.Area() / (u * u);
  const p = polyPerimeter(poly) / u;
  const fa = Math.abs(a - Math.round(a)) < 0.05 ? String(Math.round(a)) : a.toFixed(1);
  const fp = Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1);
  return `A=${fa}  P=${fp}`;
}

function addPolyMeasure(poly) {
  const lbl = board.create('text', [
    () => { const b = poly.bounds(); return (b[0] + b[2]) / 2; },
    () => { const b = poly.bounds(); return (b[1] + b[3]) / 2; },
  ], {
    anchorX: 'middle', anchorY: 'middle', parse: false, fontSize: 14,
    strokeColor: '#1b1b1b', fillColor: '#1b1b1b', fixed: true, highlight: false,
    text: () => polyMeasureText(poly),
  });
  lbl.mbConstruct = true;
}

function finalizePolygon(verts) {
  if (verts.length < 3) return;
  const poly = board.create('polygon', verts, {
    ...geoAttr,
    fillColor: '#2566c8',
    fillOpacity: 0.12,
    borders: { strokeWidth: 2.5, strokeColor: '#2566c8' },
  });
  addPolyMeasure(poly);
}

function updatePolyPreview() {
  if (!board || geoTool !== 'polygon' || pend.length < 1) return;
  if (previewLine) { try { board.removeObject(previewLine); } catch (_) { /* ok */ } previewLine = null; }
  if (pend.length >= 2) {
    previewLine = board.create('polygon', pend, {
      fillColor: '#2566c8', fillOpacity: 0.06, borders: { strokeWidth: 1.5, strokeColor: '#2566c8', dash: 2 },
    });
    previewLine.mbConstruct = true;
  }
}

function labelName() {
  const n = (page().geoLabelN || 0) + 1;
  page().geoLabelN = n;
  return String.fromCharCode(64 + ((n - 1) % 26) + 1);
}

function mkPoint(x, y, name) {
  return board.create('point', [x, y], { ...ptAttr, name: name || labelName() });
}

function startGeoEdit() {
  if (geoEditing || !hooks.beginAction) return;
  geoEditing = true;
  hooks.beginAction();
}

function finishGeoEdit() {
  if (!geoEditing) return;
  geoEditing = false;
  dumpGeoItems();
  hooks.commitAction?.();
  hooks.persist?.();
  hooks.mark?.();
}

// el.parents entries are id strings in current JSXGraph, but tolerate objects too.
function parentId(p) { return typeof p === 'string' ? p : p?.id; }

function dumpGeoItems() {
  const pg = page();
  if (!pg || !board) return;
  // Never write this board's contents into a different page: after structural
  // page changes the current page can briefly diverge from the mounted board,
  // and dumping then copied one page's geometry into another.
  if (boardPageId !== pg.id) return;
  const items = [];
  const seen = new Set();
  for (const el of Object.values(board.objects)) {
    if (!el || el.mbConstruct) continue;
    if (el.isDraggable === false && el.elementClass !== 1) continue;
    const t = el.elType;
    if (t === 'point' && el.X && !seen.has(el.id)) {
      // Unnamed points are composite internals (e.g. a perpendicular's defining
      // points) — user-created points always get a letter name.
      if (!el.name) continue;
      seen.add(el.id);
      items.push({ t: 'point', id: el.id, x: el.X(), y: el.Y(), name: el.name || '' });
    }
  }
  // lines, circles, etc. — store by parent point ids
  for (const el of Object.values(board.objects)) {
    if (!el || !el.elType || el.mbConstruct) continue;
    const hidden = el.visProp && el.visProp.visible === false ? true : undefined;
    const dash = el.visProp && el.visProp.dash ? el.visProp.dash : undefined;
    if (el.elType === 'segment' && el.point1 && el.point2) {
      items.push({ t: 'segment', id: el.id, p1: el.point1.id, p2: el.point2.id, hidden, dash });
    } else if (el.elType === 'line' && el.point1 && el.point2) {
      items.push({ t: 'line', id: el.id, p1: el.point1.id, p2: el.point2.id, hidden, dash });
    } else if (el.elType === 'circle' && el.center && el.point2) {
      items.push({ t: 'circle', c: el.center.id, r: el.point2.id });
    } else if (el.elType === 'ellipse' && el.parents?.length >= 3) {
      items.push({ t: 'ellipse', p1: parentId(el.parents[0]), p2: parentId(el.parents[1]), p3: parentId(el.parents[2]) });
    } else if (el.elType === 'polygon' && el.vertices?.length >= 3) {
      items.push({ t: 'polygon', verts: el.vertices.map((v) => v.id) });
    } else if (el.elType === 'angle' && el.point1 && el.point2 && el.point3) {
      items.push({ t: 'angle', p1: el.point1.id, p2: el.point2.id, p3: el.point3.id });
    } else if (el.elType === 'perpendicular' && el.parents?.length >= 2) {
      items.push({ t: 'perp', line: parentId(el.parents[0]), pt: parentId(el.parents[1]) });
    } else if (el.elType === 'parallel' && el.parents?.length >= 2) {
      items.push({ t: 'parallel', line: parentId(el.parents[0]), pt: parentId(el.parents[1]) });
    }
  }
  pg.geoItems = items;
}

function rebuildGeo(pg) {
  if (!board || !pg.geoItems?.length) return;
  const map = {};
  board.suspendUpdate();
  for (const it of pg.geoItems) {
    if (it.t === 'point') {
      map[it.id] = board.create('point', [it.x, it.y], { ...ptAttr, name: it.name || '', id: it.id });
    }
  }
  const lineAttr = (it) => ({
    ...geoAttr,
    ...(it.id ? { id: it.id } : {}),
    ...(it.hidden ? { visible: false } : {}),
    ...(it.dash ? { dash: it.dash, strokeOpacity: 0.55 } : {}),
  });
  for (const it of pg.geoItems) {
    if (it.t === 'segment' && map[it.p1] && map[it.p2]) {
      const s = board.create('segment', [map[it.p1], map[it.p2]], lineAttr(it));
      if (it.id) map[it.id] = s;
    }
    else if (it.t === 'line' && map[it.p1] && map[it.p2]) {
      const l = board.create('line', [map[it.p1], map[it.p2]], lineAttr(it));
      if (it.id) map[it.id] = l;
    }
    else if (it.t === 'circle' && map[it.c] && map[it.r]) board.create('circle', [map[it.c], map[it.r]], geoAttr);
    else if (it.t === 'ellipse' && map[it.p1] && map[it.p2] && map[it.p3]) board.create('ellipse', [map[it.p1], map[it.p2], map[it.p3]], geoAttr);
    else if (it.t === 'polygon' && it.verts?.length >= 3 && it.verts.every((id) => map[id])) {
      const poly = board.create('polygon', it.verts.map((id) => map[id]), {
        ...geoAttr, fillColor: '#2566c8', fillOpacity: 0.12,
        borders: { strokeWidth: 2.5, strokeColor: '#2566c8' },
      });
      addPolyMeasure(poly);
    }
    else if (it.t === 'angle' && map[it.p1] && map[it.p2] && map[it.p3]) {
      board.create('angle', [map[it.p1], map[it.p2], map[it.p3]], { ...geoAttr, radius: 1.8, withLabel: true, name: '' });
    } else if (it.t === 'perp') {
      const line = map[it.line] || board.objects[it.line];
      const pt = map[it.pt];
      if (line && pt) board.create('perpendicular', [line, pt], geoAttr);
    } else if (it.t === 'parallel') {
      const line = map[it.line] || board.objects[it.line];
      const pt = map[it.pt];
      if (line && pt) board.create('parallel', [line, pt], geoAttr);
    }
  }
  for (const cst of pg.geoConstructs || []) {
    if (cst.t === 'midpoint' && map[cst.p1] && map[cst.p2]) {
      const m = board.create('midpoint', [map[cst.p1], map[cst.p2]], { ...ptAttr, name: cst.name || '' }); m.mbConstruct = true;
    } else if (cst.t === 'perpbisect' && map[cst.p1] && map[cst.p2]) {
      buildPerpBisect(map[cst.p1], map[cst.p2]);
    } else if (cst.t === 'anglebisect' && map[cst.p1] && map[cst.p2] && map[cst.p3]) {
      const bz = board.create('bisector', [map[cst.p1], map[cst.p2], map[cst.p3]], geoAttr); bz.mbConstruct = true;
    }
  }
  board.unsuspendUpdate();
}

function pushConstruct(rec) {
  const pg = page();
  if (!pg.geoConstructs) pg.geoConstructs = [];
  pg.geoConstructs.push(rec);
}

function buildPerpBisect(a, b) {
  const mid = board.create('midpoint', [a, b], { visible: false }); mid.mbConstruct = true;
  const ln = board.create('line', [a, b], { visible: false }); ln.mbConstruct = true;
  const pb = board.create('perpendicular', [ln, mid], geoAttr); pb.mbConstruct = true;
  return pb;
}

export function loadGeoPage(pg) {
  if (!window.JXG) return;
  if (board && boardPageId === pg.id) return;
  teardownGeo();
  boardPageId = pg.id;
  const inner = document.getElementById('geo-inner');
  if (!inner) return;
  const pw = PW(), ph = PH();
  inner.style.width = pw + 'px';
  inner.style.height = ph + 'px';
  board = JXG.JSXGraph.initBoard('geo-inner', {
    boundingbox: [0, 0, pw, ph],
    axis: false,
    showNavigation: false,
    showCopyright: false,
    pan: { enabled: false },
    zoom: { wheel: false },
    keepAspectRatio: false,
    renderer: 'svg',
  });
  rebuildGeo(pg);
  board.on('up', () => {
    // 'move' drags points around — commit those edits like tool-less drags,
    // otherwise they were silently lost on the next page switch.
    if (geoTool && geoTool !== 'move') return;
    startGeoEdit();
    dumpGeoItems();
    finishGeoEdit();
  });
  board.on('down', (e) => {
    if (!geoTool || e.target?.classList?.contains('JXG_navigation_button')) return;
    handleGeoClick(e);
  });
}

function clickCoords(e) {
  const c = board.getUsrCoordsOfMouse(e);
  return snapPt({ x: c[0], y: c[1] });
}

function handleGeoClick(e) {
  const t = geoTool;
  // Move mode: JSXGraph's own drag handling moves the points; the 'up' handler
  // commits. Starting an edit here left geoEditing dangling forever.
  if (t === 'move') return;
  const p = clickCoords(e);
  if (!pend.length) startGeoEdit();
  if (t === 'point') {
    mkPoint(p.x, p.y);
    finishGeoEdit();
    return;
  }
  if (t === 'segment' || t === 'line') {
    if (!pend.length) { pend.push(mkPoint(p.x, p.y)); return; }
    const b = mkPoint(p.x, p.y);
    board.create(t === 'segment' ? 'segment' : 'line', [pend[0], b], geoAttr);
    pend = [];
    finishGeoEdit();
    return;
  }
  if (t === 'circle') {
    if (!pend.length) { pend.push(mkPoint(p.x, p.y)); return; }
    const rim = mkPoint(p.x, p.y);
    board.create('circle', [pend[0], rim], geoAttr);
    pend = [];
    finishGeoEdit();
    return;
  }
  if (t === 'ellipse') {
    if (pend.length < 2) { pend.push(mkPoint(p.x, p.y)); return; }
    const p3 = mkPoint(p.x, p.y);
    board.create('ellipse', [pend[0], pend[1], p3], geoAttr);
    pend = [];
    finishGeoEdit();
    return;
  }
  if (t === 'polygon') {
    const close = pend.length >= 3 && Math.hypot(p.x - pend[0].X(), p.y - pend[0].Y()) < 22;
    if (close) {
      if (previewLine) { try { board.removeObject(previewLine); } catch (_) { /* ok */ } previewLine = null; }
      finalizePolygon(pend);
      pend = [];
      finishGeoEdit();
      return;
    }
    pend.push(mkPoint(p.x, p.y));
    updatePolyPreview();
    return;
  }
  if (t === 'angle') {
    if (pend.length < 2) { pend.push(mkPoint(p.x, p.y)); return; }
    const p3 = mkPoint(p.x, p.y);
    board.create('angle', [pend[0], pend[1], p3], { ...geoAttr, radius: 1.8, withLabel: true });
    pend = [];
    finishGeoEdit();
    return;
  }
  if (t === 'midpoint') {
    if (!pend.length) { pend.push(mkPoint(p.x, p.y)); return; }
    const b = mkPoint(p.x, p.y);
    const m = board.create('midpoint', [pend[0], b], { ...ptAttr, name: labelName() }); m.mbConstruct = true;
    pushConstruct({ t: 'midpoint', p1: pend[0].id, p2: b.id, name: m.name });
    pend = []; finishGeoEdit();
    return;
  }
  if (t === 'perpbisect') {
    if (!pend.length) { pend.push(mkPoint(p.x, p.y)); return; }
    const b = mkPoint(p.x, p.y);
    buildPerpBisect(pend[0], b);
    pushConstruct({ t: 'perpbisect', p1: pend[0].id, p2: b.id });
    pend = []; finishGeoEdit();
    return;
  }
  if (t === 'anglebisect') {
    if (pend.length < 2) { pend.push(mkPoint(p.x, p.y)); return; }
    const c2 = mkPoint(p.x, p.y);
    const bz = board.create('bisector', [pend[0], pend[1], c2], geoAttr); bz.mbConstruct = true;
    pushConstruct({ t: 'anglebisect', p1: pend[0].id, p2: pend[1].id, p3: c2.id });
    pend = []; finishGeoEdit();
    return;
  }
  if (t === 'perp' || t === 'parallel') {
    if (!pend.length) {
      pend.push(mkPoint(p.x, p.y));
      return;
    }
    if (pend.length === 1) {
      pend.push(mkPoint(p.x, p.y));
      // Keep the base line visible (dashed): an invisible line made the tool
      // look dead after two clicks, and it reappeared solid after a reload.
      const line = board.create('line', [pend[0], pend[1]], { ...geoAttr, dash: 2, strokeOpacity: 0.55 });
      pend.push(line);
      return;
    }
    const pt = mkPoint(p.x, p.y);
    const line = pend[2];
    board.create(t === 'perp' ? 'perpendicular' : 'parallel', [line, pt], geoAttr);
    pend = [];
    finishGeoEdit();
    return;
  }
  if (t === 'intersect') {
    if (pend.length < 4) { pend.push(mkPoint(p.x, p.y)); return; }
    const ln1 = board.create('line', [pend[0], pend[1]], geoAttr);
    const ln2 = board.create('line', [pend[2], pend[3]], geoAttr);
    const ix = board.create('intersection', [ln1, ln2], { ...ptAttr, name: 'I' });
    ix.mbConstruct = true;
    pend = [];
    finishGeoEdit();
    return;
  }
  if (t === 'reflect') {
    if (!pend.length) { pend.push(mkPoint(p.x, p.y)); return; }
    if (pend.length === 1) {
      const b = mkPoint(p.x, p.y);
      const ln = board.create('line', [pend[0], b], geoAttr);
      pend = [ln];
      return;
    }
    const pt = mkPoint(p.x, p.y);
    const ref = board.create('reflection', [pt, pend[0]], { ...ptAttr, name: labelName() });
    ref.mbConstruct = true;
    pend = [];
    finishGeoEdit();
    return;
  }
  if (t === 'translate') {
    if (pend.length < 2) { pend.push(mkPoint(p.x, p.y)); return; }
    const pt = mkPoint(p.x, p.y);
    const dx = pend[1].X() - pend[0].X(), dy = pend[1].Y() - pend[0].Y();
    const tr = board.create('point', [() => pt.X() + dx, () => pt.Y() + dy], { ...ptAttr, name: labelName() });
    tr.mbConstruct = true;
    pend = [];
    finishGeoEdit();
    return;
  }
  if (t === 'rotate') {
    if (pend.length < 2) { pend.push(mkPoint(p.x, p.y)); return; }
    const center = pend[0], anglePt = pend[1], target = mkPoint(p.x, p.y);
    const ang = Math.atan2(anglePt.Y() - center.Y(), anglePt.X() - center.X());
    const rot = board.create('rotation', [target, center, ang], { ...ptAttr, name: labelName() });
    rot.mbConstruct = true;
    pend = [];
    finishGeoEdit();
    return;
  }
  if (t === 'enlarge') {
    if (pend.length < 2) { pend.push(mkPoint(p.x, p.y)); return; }
    const center = pend[0];
    const factorPt = pend[1];
    const sx = (factorPt.X() - center.X()) / 50 || 1;
    const target = mkPoint(p.x, p.y);
    const hom = board.create('homothety', [target, center, sx], { ...ptAttr, name: labelName() });
    hom.mbConstruct = true;
    pend = [];
    finishGeoEdit();
  }
}

export function clearGeoPage() {
  const pg = page();
  if (!pg) return;
  startGeoEdit();
  pg.geoItems = [];
  pg.geoConstructs = [];
  pg.geoLabelN = 0;
  teardownGeo();
  loadGeoPage(pg);
  finishGeoEdit();
}

export function restoreGeoItems(items) {
  const pg = page();
  if (!pg) return;
  pg.geoItems = items ? JSON.parse(JSON.stringify(items)) : [];
  if (board && boardPageId === pg.id) {
    teardownGeo();
    loadGeoPage(pg);
  }
}

// Rasterise live SVG (current page) onto a canvas 2D context for export.
export function drawGeoSvgToCanvas(c, pg) {
  if (!pg.geoItems?.length) return Promise.resolve();
  if (board && boardPageId === pg.id) {
    const svg = document.querySelector('#geo-layer svg');
    if (svg) return svgToCanvas(c, svg, pg);
  }
  return renderGeoOffscreen(c, pg);
}

function svgToCanvas(c, svg, pg) {
  const pw = pageW(pg), ph = pageH(pg);
  return new Promise((res) => {
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => { c.drawImage(img, 0, 0, pw, ph); res(); };
    img.onerror = () => res();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  });
}

function renderGeoOffscreen(c, pg) {
  if (!window.JXG || !pg.geoItems?.length) return Promise.resolve();
  const pw = pageW(pg), ph = pageH(pg);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden';
  const id = 'geo-exp-' + pg.id;
  wrap.innerHTML = `<div id="${id}" style="width:${pw}px;height:${ph}px"></div>`;
  document.body.appendChild(wrap);
  const b = JXG.JSXGraph.initBoard(id, {
    boundingbox: [0, 0, pw, ph], axis: false, showNavigation: false, showCopyright: false, renderer: 'svg',
  });
  const saved = board;
  const savedId = boardPageId;
  board = b;
  boardPageId = pg.id;
  rebuildGeo(pg);
  board = saved;
  boardPageId = savedId;
  const svg = wrap.querySelector('svg');
  return svgToCanvas(c, svg).finally(() => {
    try { JXG.JSXGraph.freeBoard(b); } catch (_) {}
    wrap.remove();
  });
}
