// snipSim.js — drag-select a PDF diagram region → crop → manual sim picker (Phase 2).
// Overlay is a separate DOM layer; never touches the ink render path in app.js.

import { LABS, defaultParams } from './anim/ragRoutes.js';
import { mountAnimTool } from './ragSearch.js';
import { authHeaders } from './auth.js';

const MIN_SNIP_PX = 12;
const MAX_SIDE = 1024;

let overlay = null;
let rectEl = null;
let active = false;
let drag = null;
let onEsc = null;
let onOutside = null;

function normRect(x0, y0, x1, y1) {
  const x = Math.min(x0, x1), y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

function clientToCanvas(clientX, clientY, canvas) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width, sy = canvas.height / r.height;
  return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
}

function downscaleCanvas(src) {
  const w = src.width, h = src.height;
  if (Math.max(w, h) <= MAX_SIDE) return src;
  const s = MAX_SIDE / Math.max(w, h);
  const oc = document.createElement('canvas');
  oc.width = Math.max(1, Math.round(w * s));
  oc.height = Math.max(1, Math.round(h * s));
  oc.getContext('2d').drawImage(src, 0, 0, oc.width, oc.height);
  return oc;
}

function cropPageCanvas(canvas, sel) {
  const p0 = clientToCanvas(sel.x0, sel.y0, canvas);
  const p1 = clientToCanvas(sel.x1, sel.y1, canvas);
  const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
  const oc = document.createElement('canvas');
  oc.width = Math.max(1, Math.round(w));
  oc.height = Math.max(1, Math.round(h));
  oc.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, oc.width, oc.height);
  return downscaleCanvas(oc);
}

function teardownOverlay() {
  active = false;
  drag = null;
  if (onEsc) { document.removeEventListener('keydown', onEsc); onEsc = null; }
  if (onOutside) { document.removeEventListener('pointerdown', onOutside, true); onOutside = null; }
  overlay?.remove();
  overlay = null;
  rectEl = null;
}

/** Show cropped diagram + registry chips; mounts lab with schema defaults. */
export function openSimPicker(dataURL, prefill) {
  const dlg = document.querySelector('#anim-dialog');
  const host = document.querySelector('#anim-host');
  document.querySelector('#anim-title').textContent = 'Make diagram interactive';
  host.replaceChildren();

  const wrap = document.createElement('div');
  wrap.className = 'sim-picker';

  const thumb = document.createElement('img');
  thumb.className = 'sim-thumb';
  thumb.src = dataURL;
  thumb.alt = 'Snipped diagram';
  wrap.appendChild(thumb);

  const hint = document.createElement('p');
  hint.className = 'muted sim-picker-hint';
  hint.textContent = 'Choose a lab archetype — values can be edited after mounting.';
  wrap.appendChild(hint);

  const grid = document.createElement('div');
  grid.className = 'sim-picker-grid';
  const GROUP_LABELS = { M1: 'Mechanics (M1)', P1: 'Pure 1 (P1)', P3: 'Pure 3 (P3)' };
  for (const group of ['M1', 'P1', 'P3']) {
    const labs = LABS.filter((lab) => lab.group === group);
    if (!labs.length) continue;
    const heading = document.createElement('div');
    heading.className = 'mb-lab-picker-heading';
    heading.textContent = GROUP_LABELS[group];
    grid.appendChild(heading);
    for (const lab of labs) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mb-lab-chip';
      if (prefill?.tag === lab.tag) chip.classList.add('sim-chip-suggested');
      chip.textContent = `${lab.icon} ${lab.title}`;
      chip.addEventListener('click', () => {
        const params = { ...defaultParams(lab), ...(prefill?.tag === lab.tag ? prefill.params : {}) };
        mountAnimTool(lab.tag, lab.title, Object.keys(params).length ? params : undefined);
      });
      grid.appendChild(chip);
    }
  }
  wrap.appendChild(grid);
  host.appendChild(wrap);
  dlg.classList.remove('hidden');
}

/** Phase 3: POST crop to /api/sim/resolve with vision + confidence. */
export async function resolveSim(dataURL, hint) {
  try {
    const res = await fetch('/api/sim/resolve', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ image: dataURL, hint }),
    });
    const data = await res.json();

    if (data.confidence >= 0.7 && data.archetype) {
      // High confidence: mount directly with extracted params.
      const lab = LABS.find((l) => l.tag === data.archetype);
      if (lab) {
        const params = { ...defaultParams(lab), ...data.params };
        mountAnimTool(lab.tag, lab.title, Object.keys(params).length ? params : undefined);
        return;
      }
    }

    // Low confidence or error: picker with suggestion.
    openSimPicker(dataURL, data.archetype ? { tag: data.archetype, params: data.params || {} } : null);
  } catch (err) {
    console.error('resolveSim:', err);
    openSimPicker(dataURL);
  }
}

function finishSnip(getPageCanvas, sel) {
  const canvas = getPageCanvas();
  if (!canvas) { teardownOverlay(); return; }
  const dataURL = cropPageCanvas(canvas, sel).toDataURL('image/png');
  teardownOverlay();
  resolveSim(dataURL);
}

function startSnip(getPageCanvas) {
  if (active) return;
  const wrap = document.querySelector('.canvas-wrap');
  const canvas = getPageCanvas();
  if (!wrap || !canvas) return;

  active = true;
  overlay = document.createElement('div');
  overlay.id = 'snip-overlay';
  overlay.className = 'snip-overlay';
  rectEl = document.createElement('div');
  rectEl.className = 'snip-rect hidden';
  overlay.appendChild(rectEl);
  wrap.appendChild(overlay);

  onEsc = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); teardownOverlay(); }
  };
  document.addEventListener('keydown', onEsc);

  onOutside = (e) => {
    if (!overlay || overlay.contains(e.target)) return;
    teardownOverlay();
  };
  document.addEventListener('pointerdown', onOutside, true);

  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    const r = overlay.getBoundingClientRect();
    drag = { cx0: e.clientX, cy0: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top };
    rectEl.classList.remove('hidden');
    rectEl.style.left = `${drag.ox}px`;
    rectEl.style.top = `${drag.oy}px`;
    rectEl.style.width = '0';
    rectEl.style.height = '0';
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = overlay.getBoundingClientRect();
    const box = normRect(drag.ox, drag.oy, e.clientX - r.left, e.clientY - r.top);
    rectEl.style.left = `${box.x}px`;
    rectEl.style.top = `${box.y}px`;
    rectEl.style.width = `${box.w}px`;
    rectEl.style.height = `${box.h}px`;
  });

  overlay.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const r = overlay.getBoundingClientRect();
    const box = normRect(drag.ox, drag.oy, e.clientX - r.left, e.clientY - r.top);
    const sel = { x0: drag.cx0, y0: drag.cy0, x1: e.clientX, y1: e.clientY };
    drag = null;
    if (box.w < MIN_SNIP_PX || box.h < MIN_SNIP_PX) { teardownOverlay(); return; }
    finishSnip(getPageCanvas, sel);
  });

  overlay.addEventListener('pointercancel', () => { drag = null; teardownOverlay(); });
}

export function setupSnipSim({ getPageCanvas, onLocked, pageHasPdfBg }) {
  const btn = document.getElementById('snip-sim');
  if (!btn) return;

  const syncBtn = () => {
    btn.classList.toggle('hidden', !pageHasPdfBg?.());
  };
  syncBtn();

  btn.addEventListener('click', () => {
    if (!pageHasPdfBg?.()) return;
    startSnip(getPageCanvas);
  });

  return { syncBtn, cancelSnip: teardownOverlay };
}
