// annotatedSim.js — docked sim panel coordinated with page ink + text labels.

import { LABS, defaultParams, simByTag, detectLabFromSection } from './anim/ragRoutes.js';
import { AnnotationSyncBridge, readLabState, parseLabelsFromObjects } from './annotationSync.js';
import { toggleFullscreen, isFullscreen, onFullscreenChange } from './fullscreen.js';

const PANEL_MIN_W = 280;
const PANEL_MAX_W = 520;
const LS_PREFIX = 'mb-annot-sim-';

let hooks = null;
let bridge = null;
let activeLab = null;
let currentLabTag = null;
let panelEl = null;
let hostEl = null;
let readoutEl = null;
let expanded = false;
let panelW = 340;

/** Bounding box of ink + text on the current page (page units). */
export function detectAnnotationBounds(pg, strokeBBox, textBox) {
  const boxes = [];
  if (pg?.strokes?.length) {
    const b = strokeBBox(pg.strokes);
    if (Number.isFinite(b.x)) boxes.push(b);
  }
  for (const o of pg?.objects || []) {
    if (o.kind === 'text') {
      const tb = textBox(o);
      boxes.push({ x: o.at.x, y: o.at.y, w: tb.w, h: tb.h });
    }
  }
  if (!boxes.length) return { x: 60, y: 60, w: 200, h: 120 };
  return boxes.slice(1).reduce((acc, b) => {
    const x0 = Math.min(acc.x, b.x), y0 = Math.min(acc.y, b.y);
    const x1 = Math.max(acc.x + acc.w, b.x + b.w), y1 = Math.max(acc.y + acc.h, b.y + b.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, boxes[0]);
}

function lsKey() {
  const nb = hooks?.getNotebook?.();
  const pg = hooks?.getPage?.();
  return `${LS_PREFIX}${nb?.id || 'nb'}-${pg?.id || 'pg'}`;
}

function saveState(labTag, params) {
  const pg = hooks?.getPage?.();
  if (!pg) return;
  pg.annotSim = { labTag, params, panelW, expanded };
  try {
    localStorage.setItem(lsKey(), JSON.stringify(pg.annotSim));
  } catch (_) { /* quota */ }
  hooks?.persist?.();
}

function loadSavedState() {
  const pg = hooks?.getPage?.();
  if (pg?.annotSim) return pg.annotSim;
  try {
    const raw = localStorage.getItem(lsKey());
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function sectionContext() {
  const parts = [
    hooks?.getSectionText?.() || '',
    hooks?.getNotebookTitle?.() || '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function openPicker(onPick) {
  hostEl.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'mb-lab-picker annot-sim-picker';
  wrap.innerHTML = '<p class="muted">Pick a lab for this page section:</p>';
  const row = document.createElement('div');
  row.className = 'mb-lab-picker-row';
  for (const lab of LABS.filter((l) => l.built !== false)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mb-lab-chip';
    chip.textContent = `${lab.icon} ${lab.title}`;
    chip.addEventListener('click', () => onPick(lab.tag));
    row.appendChild(chip);
  }
  wrap.appendChild(row);
  hostEl.appendChild(wrap);
}

function applyPanelLayout() {
  if (!panelEl) return;
  panelEl.style.setProperty('--annot-sim-w', `${panelW}px`);
  panelEl.classList.toggle('expanded', expanded);
  document.querySelector('.editor-main')?.classList.toggle('annot-sim-open', !panelEl.classList.contains('hidden'));
}

function setLocked(on) {
  hooks?.onLockedChange?.(!!on);
  panelEl?.classList.toggle('sim-active', !!on);
}

/** Mount lab in docked panel and wire sync bridge. */
export function launchAnnotatedSim(labTag, params = {}, annotationBox) {
  if (!panelEl || !hostEl) return;
  const sim = simByTag(labTag);
  if (!sim) return;

  dismissLab(false);
  setLocked(true);
  panelEl.classList.remove('hidden');
  applyPanelLayout();

  const titleEl = panelEl.querySelector('.annot-sim-title');
  if (titleEl) titleEl.textContent = sim.title;

  hostEl.replaceChildren();
  const el = document.createElement(labTag);
  const merged = { ...defaultParams(sim), ...parseLabelsFromObjects(hooks.getObjs()), ...params };
  el.setAttribute('params', JSON.stringify(merged));
  hostEl.appendChild(el);
  activeLab = el;
  currentLabTag = labTag;

  if (annotationBox) bridge.ensureLabels(labTag, merged, annotationBox);
  bridge.attach(el, labTag);
  if (readoutEl) readoutEl.textContent = el.readout?.() || '';

  saveState(labTag, merged);
  hooks?.onSelect?.({ labTag, params: merged, box: annotationBox });
}

function dismissLab(unlock = true) {
  bridge?.detach();
  if (activeLab && currentLabTag) {
    saveState(currentLabTag, readLabState(activeLab, currentLabTag));
  }
  activeLab = null;
  currentLabTag = null;
  hostEl?.replaceChildren();
  if (unlock) setLocked(false);
}

function closePanel() {
  dismissLab(true);
  panelEl?.classList.add('hidden');
  applyPanelLayout();
  hooks?.onDismiss?.();
}

function inferLabFromLabels(objects) {
  const labels = parseLabelsFromObjects(objects);
  if (labels.theta !== undefined || labels.mu !== undefined) return 'mb-incline-lab';
  if (labels.m1 !== undefined && labels.m2 !== undefined) return 'mb-pulley-lab';
  if (labels.u !== undefined && labels.a !== undefined) return 'mb-suvat-lab';
  if (labels.u !== undefined && labels.theta !== undefined) return 'mb-projectile-lab';
  return null;
}

function launchFromPage() {
  const pg = hooks.getPage();
  const box = detectAnnotationBounds(pg, hooks.strokeBBox, hooks.textBox);
  const ctx = sectionContext();
  let tag = detectLabFromSection(ctx) || inferLabFromLabels(hooks.getObjs());
  const saved = loadSavedState();
  const params = saved?.params || {};

  if (!tag) {
    panelEl.classList.remove('hidden');
    applyPanelLayout();
    setLocked(true);
    openPicker((picked) => launchAnnotatedSim(picked, params, box));
    return;
  }
  launchAnnotatedSim(tag, params, box);
}

/** Wire panel UI + toolbar button. */
export function setupAnnotatedSim(h) {
  hooks = h;
  panelEl = document.querySelector('#annotated-sim-panel');
  hostEl = document.querySelector('#annotated-sim-host');
  readoutEl = document.querySelector('#annot-sim-readout');
  if (!panelEl) return;

  bridge = new AnnotationSyncBridge({
    getObjs: h.getObjs,
    mark: h.mark,
    persist: h.persist,
    beginAction: h.beginAction,
    commitAction: h.commitAction,
    uid: h.uid,
    onReadout: (s) => { if (readoutEl) readoutEl.textContent = s; },
  });

  panelEl.querySelector('#annot-sim-close')?.addEventListener('click', closePanel);
  panelEl.querySelector('#annot-sim-expand')?.addEventListener('click', () => {
    expanded = !expanded;
    panelW = expanded ? PANEL_MAX_W : 340;
    applyPanelLayout();
    saveState(currentLabTag, readLabState(activeLab, currentLabTag));
  });
  panelEl.querySelector('#annot-sim-fullscreen')?.addEventListener('click', () => {
    panelEl.classList.toggle('is-fullscreen', toggleFullscreen(panelEl));
  });
  onFullscreenChange(() => {
    panelEl?.classList.toggle('is-fullscreen', isFullscreen(panelEl));
  });

  // Resize handle (desktop: width; narrow: height via CSS class)
  const handle = panelEl.querySelector('.annot-sim-resize');
  handle?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = panelW;
    const move = (ev) => {
      const dx = startX - ev.clientX;
      panelW = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, startW + dx));
      applyPanelLayout();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      saveState(currentLabTag, readLabState(activeLab, currentLabTag));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });

  document.querySelector('#annotate-sim')?.addEventListener('click', launchFromPage);
}

/** Close docked sim when navigating away from the page. */
export function onAnnotSimPageChange() {
  if (!panelEl?.classList.contains('hidden')) closePanel();
}

export { closePanel as dismissAnnotatedSim };
