// MathBoard — a pencil-first notebook whiteboard for A-level maths.
// Copyright © 2026 Waseem Akhlaque. All rights reserved. Proprietary License (see LICENSE).
//
// app.js — paginated notebook whiteboard.
// Vanilla JS, Canvas 2D. Strokes are stored in page units (PAGE_W x PAGE_H) so
// pan/zoom never distorts saved ink. One page is shown at a time.

import { notebookKind, normalizeNotebook, allPages } from './model.js';
import {
  downloadBlob, exportNotebookJSON, importNotebookFromFile, shareNotebook,
  onSyncStatus, getPortalAPI, sync, getSyncBaseUrl, setSyncBaseUrl,
  syncAllToRemote, mergeSync, retryPendingSync,
} from './share.js';
import {
  signInWithPassword, signOut, isSignedIn, getAuthUser, defaultSyncApiUrl,
  getSupabaseUrl, getSupabaseAnonKey,
} from './auth.js';
import { initTheme } from './theme.js';
import {
  canCreateLesson, initEntitlement,
} from './entitlement.js';
import { ensureAccess } from './gate.js';
import { setupAdminPanel } from './adminPanel.js';
import { setupPapersLibrary, openPaperFile } from './papersLibrary.js';
import { initOnboarding } from './onboarding.js';
import { setupInstallBanner } from './installBanner.js';
import {
  setupGeo, setGeoTool, syncGeoLayer, loadGeoPage, teardownGeo, clearGeoPage,
  restoreGeoItems, drawGeoSvgToCanvas, geoToolActive, flushGeo, cancelGeoDraft,
} from './geo.js';
import {
  setupMech, setupMechPanel, drawMechItems, handleMechClick, setMechPlacing,
  hitMech, moveMechItem, setSelectedMech, selectedMechItem, mechBBox, mechHandles,
  mechHandleAt, applyMechHandle, syncPanelFromItem, deleteMechItem, openMechPanel,
} from './mech.js';
import {
  setupCplx, setupCplxPanel, drawCplxLoci, handleCplxClick, setCplxPlacing,
} from './cplx.js';
import {
  setupInstruments, setInstTool, instToolActive, handleInstClick, drawInstruments,
  snapToRuler, hitInstrument, beginInstMove, moveInst, endInstMove, clearInstSelection,
} from './instruments.js';
import {
  storeDataUrl, resolveMediaUrl, migrateNotebookMedia, cachedMediaUrl, setCachedUrl,
} from './blobs.js';
import {
  buildLazyPdfPages, isPdfPageBg, isImportedPageBg, loadPdfPageImage,
  pdfImportNeedsConfirm, assertPdfImportSize, renderPdfPageDataUrl,
} from './pdfPages.js';
import { setupLayers, setupLayersPanel, renderLayersPanel, visibleStrokes, visibleObjects } from './layers.js';
import { setupGraphView, setupGraphViewPanel, refreshGraphView } from './graphView.js';
import { setupStudioUI } from './studio/liveStudioView.js';
import {
  setupCalculus, setupCalculusPanel, drawCalcItems, clearCalcPage,
} from './calculus.js';
import { setupSymbolic, setupSymbolicPanel, nerdamerDiff } from './symbolic.js';
import { setupAlgebra, setupAlgebraPanel, mathjsDerivative } from './algebra.js';
import { setupRationals, setupRationalsPanel } from './rationals.js';
import { filterNotebooksBySearch } from './librarySearch.js';
import {
  setupScene, tick as sceneTick, sceneTime, sceneNormalized, onPageChange as scenePageChange,
  objAlpha, objPopScale, objDrawProgress, strokeReveal, hasTargetTracks,
  recordStroke, recordObject, ensureScene, reset as sceneReset, nextStep as sceneNextStep,
  prevStep as scenePrevStep, getClock,
} from './scene.js';
import {
  loadTaxonomy, renderCourseLibrary, isCatalogued, notebookCatalog,
  taxonomyCourses, taxonomyTopics, taxonomyExercises, expandCoursePath,
} from './courseLibrary.js';
import { setupRagSearch, openLabPicker } from './ragSearch.js';
import { setupAnnotatedSim, onAnnotSimPageChange } from './annotatedSim.js';
import { pageW, pageH, thumbDims, A4_W, A4_H } from './pageLayout.js';
import { getAllNotebooks, getNotebook, storageReady } from './storage.js';
import getStroke from '../vendor/perfect-freehand.mjs';

// ---- constants ---------------------------------------------------------------
const PAGE_W = A4_W;          // default A4 width (legacy alias)
const PAGE_H = A4_H;          // default A4 height
const pgW = () => pageW(page());
const pgH = () => pageH(page());
const gridCx = () => pgW() / 2;
const gridCy = () => pgH() / 2;
const PAPERS = ['plain', 'squared', 'graph', 'dotted', 'lined', 'cornell', 'argand', 'vectorgrid', 'axes'];
const DEFAULT_PAPER_KEY = 'mb-default-paper';

function getDefaultPaper() {
  try {
    const v = localStorage.getItem(DEFAULT_PAPER_KEY);
    return PAPERS.includes(v) ? v : 'graph';
  } catch { return 'graph'; }
}
function setDefaultPaper(v) {
  if (!PAPERS.includes(v)) return;
  try { localStorage.setItem(DEFAULT_PAPER_KEY, v); } catch (_) { /* quota */ }
}
function setPaperLayout(paper) {
  if (!page() || pageIsPdf(page()) || !PAPERS.includes(paper)) return;
  page().paper = paper;
  setDefaultPaper(paper);
  const sel = $('#paper'); if (sel) sel.value = paper;
  syncPaperToggleUI(paper);
  thumbCache.delete(page().id);
  persist();
  mark();
}
function syncPaperToggleUI(paper = page()?.paper) {
  const lined = $('#paper-lined');
  const graph = $('#paper-graph');
  if (!lined || !graph) return;
  const p = paper || getDefaultPaper();
  lined.classList.toggle('active', p === 'lined');
  graph.classList.toggle('active', p === 'graph');
}
const COLORS = ['#1b1b1b', '#2566c8', '#d23b3b', '#1f9d57', '#e0892a', '#8a4fd0'];
const PEN_WIDTHS = { fine: 4, marker: 10, calligraphy: 6 };
const UNDO_CAP = 60;
const UNIT = 50;              // page units per "1" on the grid — vectors snap to this
const FORCE_SCALE = 32;       // page units (px) per 1 N for the live force-vector primitive
const GRID_PAPERS = ['argand', 'vectorgrid', 'axes'];   // papers where vectors snap to integer points
const APP_VERSION = 119;   // bump with index.html ?v= and sw.js CACHE

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
  sketchy: false,           // hand-drawn shapes via rough.js
  editingId: null,          // id of text object currently being edited (hidden on canvas)
  annotSimLocked: false,    // true while docked sim is active — canvas ink read-only
  actionBefore: null,       // page snapshot taken at action start (for undo)
  undo: [], redo: [],
  lassoPath: null,          // points (page units) of in-progress lasso
  selection: null,          // { strokes:[refs], bbox:{x,y,w,h} }
  moving: null,             // { lastX, lastY }
  selObj: null,             // selected math object/shape/text (Select tool)
  selStrokes: [],           // ink strokes selected by Select tool
  objMove: null,            // { lastX, lastY } — dragging selection body
  objResize: null,          // handle name — dragging a selected object's handle
  mechMove: null,           // dragging a placed mechanics diagram
  mechResize: null,         // resizing a mech item handle
  instDrag: null,           // dragging a physical instrument
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
  if (!S.notebook) return [];
  if (!S.notebook.sections?.length) S.notebook = normalizeNotebook(S.notebook);
  return S.notebook.sections;
}
function pages() {
  const secs = sections();
  if (!secs.length) return [];
  const si = Math.min(S.sectionIndex, secs.length - 1);
  return secs[si]?.pages || [];
}
const page = () => {
  const pgs = pages();
  if (!pgs.length) return null;
  const pi = Math.min(S.pageIndex, pgs.length - 1);
  return pgs[pi] || null;
};
const objs = () => { const p = page(); if (!p) return []; if (!p.objects) p.objects = []; return p.objects; };
const fns = () => { const p = page(); if (!p) return []; if (!p.functions) p.functions = []; return p.functions; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const $ = (sel) => document.querySelector(sel);

function toPage(cssX, cssY) {
  return { x: (cssX - S.offsetX) / S.scale, y: (cssY - S.offsetY) / S.scale };
}

function newPage(paper = getDefaultPaper(), format) {
  // Inherit the current page's format only when a notebook is actually open;
  // page() throws when S.notebook is null (e.g. creating the very first lesson).
  const inheritFormat = S.notebook?.sections?.length ? page()?.format : null;
  // P1: Default new lessons to 16:9 wide format for classroom use
  const defaultFormat = S._autoPresent ? 'wide' : 'a4';
  return { id: uid(), paper, format: format || inheritFormat || defaultFormat, strokes: [], objects: [], instruments: [] };
}

function newNotebook(title, kind = 'lesson') {
  const t = Date.now();
  return {
    id: uid(), title: title || 'Untitled lesson', kind, created: t, updated: t,
    sections: [{ id: uid(), title: 'Section 1', pages: [newPage()] }],
  };
}
function pageIsPdf(pg) {
  return !!(pg.background && isImportedPageBg(pg.background));
}

// ---- persistence (debounced) -------------------------------------------------
// The notebook clone is the most expensive main-thread hit outside rendering,
// so while the teacher writes continuously it is deferred to an idle gap — but
// never longer than 8 s from the first unsaved change.
let saveTimer = null, savePendingSince = 0;
function flushPersist() {
  clearTimeout(saveTimer);
  if (!savePendingSince || !S.notebook) return;
  savePendingSince = 0;
  sync.push(typeof structuredClone === 'function' ? structuredClone(S.notebook) : clone(S.notebook));
}
function persist() {
  if (!S.notebook) return;
  S.notebook.updated = Date.now();
  if (!savePendingSince) savePendingSince = Date.now();
  clearTimeout(saveTimer);
  if (Date.now() - savePendingSince > 8000) { flushPersist(); return; }
  saveTimer = setTimeout(() => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(flushPersist, { timeout: 3000 });
    else flushPersist();
  }, 800);
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
    format: p.format || 'a4',
    background: p.background ? clone(p.background) : null,
    geoItems: clone(p.geoItems || []),
    geoConstructs: clone(p.geoConstructs || []),
    geoLabelN: p.geoLabelN || 0,
    mechItems: clone(p.mechItems || []),
    cplxLoci: clone(p.cplxLoci || []),
    calcItems: clone(p.calcItems || []),
    instruments: clone(p.instruments || []),
    scene: p.scene ? clone(p.scene) : null,
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
  const fmtBefore = p.format || 'a4';
  p.format = s.format || 'a4';
  const fmtChanged = fmtBefore !== p.format;
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
  if (s.scene) p.scene = clone(s.scene);
  else delete p.scene;
  scenePageChange();
  restoreGeoItems(p.geoItems);
  if (fmtChanged) { teardownGeo(); loadGeoPage(p); fitPage(); }
  updatePageLabel();
  if (!$('#graph').classList.contains('hidden')) renderGraphList();
}
function beginAction() {
  S.actionBefore = snapshotPage();
  // P0: Pause collab sync during drawing to reduce lag
  if (typeof S.collabPause === 'function') S.collabPause();
}
// Pen strokes and erases are far too frequent for snapshotPage()'s full-page
// JSON clone (it caused a visible hitch on every pen-down on written pages).
// They use cheap typed undo entries instead — see applyTypedUndo.
function beginInkAction() {
  if (typeof S.collabPause === 'function') S.collabPause();
}
let eraseDidChange = false;
function beginEraseAction() {
  eraseDidChange = false;
  // eraseAt replaces the arrays and never mutates surviving strokes, so undo
  // can simply keep the old array references — no clone
  S.eraseBefore = { strokes: page().strokes, objects: page().objects };
  if (typeof S.collabPause === 'function') S.collabPause();
}
function commitAction() {
  if (!S.actionBefore) return;
  if (JSON.stringify(S.actionBefore) !== JSON.stringify(snapshotPage())) {
    S.undo.push(S.actionBefore);
    if (S.undo.length > UNDO_CAP) S.undo.shift();
    S.redo = [];
    thumbCache.delete(page().id);
    persist();
    collabNotifyEdit();
  }
  S.actionBefore = null;
  // P0: Resume collab sync and push changes after drawing completes
  if (typeof S.collabResume === 'function') S.collabResume();
}
function collabNotifyEdit() {
  if (typeof S.collabPush === 'function') S.collabPush();
}
// Undo entries are either full page snapshots (legacy, for object/graph edits)
// or cheap typed entries: {kind:'stroke', id} for a committed pen stroke and
// {kind:'arrays', strokes, objects} holding pre-erase array references (eraseAt
// always builds new arrays, so the old ones can be kept without cloning).
function applyTypedUndo(entry, from) {
  if (entry.kind === 'stroke') {
    if (from === 'undo') {
      const i = page().strokes.findIndex((s) => s.id === entry.id);
      const stroke = i >= 0 ? page().strokes.splice(i, 1)[0] : null;
      return { kind: 'stroke', id: entry.id, stroke };
    }
    if (entry.stroke) page().strokes.push(entry.stroke);
    return { kind: 'stroke', id: entry.id };
  }
  // kind === 'arrays'
  const inverse = { kind: 'arrays', strokes: page().strokes, objects: page().objects };
  page().strokes = entry.strokes;
  page().objects = entry.objects;
  return inverse;
}
function doUndo() {
  if (!S.undo.length) return;
  const entry = S.undo.pop();
  if (entry.kind) S.redo.push(applyTypedUndo(entry, 'undo'));
  else {
    S.redo.push(snapshotPage());
    restorePage(entry);
  }
  thumbCache.delete(page().id);
  clearSelection(); mark(); persist();
}
function doRedo() {
  if (!S.redo.length) return;
  const entry = S.redo.pop();
  if (entry.kind) S.undo.push(applyTypedUndo(entry, 'redo'));
  else {
    S.undo.push(snapshotPage());
    restorePage(entry);
  }
  thumbCache.delete(page().id);
  clearSelection(); mark(); persist();
}

// ---- geometry helpers --------------------------------------------------------
function strokeBBox(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const p of (s?.points || [])) {
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
// Warm bitmap of all committed page content (see captureInkSnapshot). Content
// stays valid until anything other than live ink repaints — mark() invalidates,
// markInk() (ink-only changes already reflected in the snapshot) does not.
let inkSnapCanvas = null;
let inkSnapState = null;
let inkSnapContent = false;
function mark() { S.dirty = true; inkSnapContent = false; }
function markInk() { S.dirty = true; }

function resizeCanvas() {
  const r = cv.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;   // ignore transient zero-size during layout
  dpr = window.devicePixelRatio || 1;
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  // Assigning canvas width/height always wipes the bitmap and refitting resets
  // the user's zoom — skip no-op calls. The iPad on-screen keyboard fires
  // visualViewport resize/scroll without changing the canvas layout box, and
  // refitting mid-edit misaligned the open text editor.
  if (w === cv.width && h === cv.height) return;
  cv.width = w;
  cv.height = h;
  // keep the page fitted & centred so it can never drift off-screen on resize
  if (S.notebook && !$('#editor').classList.contains('hidden')) fitPage();
  else mark();
}

function fitPage() {
  const r = cv.getBoundingClientRect();
  const present = $('#editor')?.classList.contains('present-mode');
  const m = present ? 12 : 24;
  const bottom = present ? 72 : 0;
  const pw = pgW(), ph = pgH();
  const fitAll = Math.min((r.width - m * 2) / pw, (r.height - m - bottom) / ph);
  const fitW = (r.width - m * 2) / pw;
  // Present mode: portrait pages fill the width and scroll vertically, so
  // handwriting is legible on a shared screen without manual zooming.
  if (present && fitW > fitAll * 1.02) {
    S.scale = fitW;
    S.offsetX = (r.width - pw * S.scale) / 2;
    S.offsetY = m;
    mark();
    return;
  }
  S.scale = fitAll;
  S.offsetX = (r.width - pw * S.scale) / 2;
  S.offsetY = (r.height - bottom - ph * S.scale) / 2;
  mark();
}

// Present-mode camera rail: the page rides a vertical track. Bounds collapse to
// the centred position on any axis where the page fits inside the viewport.
function presentCamBounds() {
  const r = cv.getBoundingClientRect();
  const m = 12, bottom = 72;
  const pw = pgW() * S.scale, ph = pgH() * S.scale;
  const cx = (r.width - pw) / 2;
  const cy = (r.height - bottom - ph) / 2;
  return {
    minX: Math.min(cx, r.width - m - pw), maxX: Math.max(cx, m),
    minY: Math.min(cy, r.height - bottom - m - ph), maxY: Math.max(cy, m),
  };
}

// Scroll within the page; overscroll past an edge accumulates and flips to the
// adjacent page (GoodNotes-style continuous scrolling). The cooldown swallows
// trackpad momentum so one fling turns one page.
const FLIP_PX = 160, FLIP_COOLDOWN_MS = 450, FLIP_STALE_MS = 300;
let flipAcc = 0, flipCooldownUntil = 0, flipLastT = 0;
function presentScrollBy(dx, dy) {
  const b = presentCamBounds();
  S.offsetX = Math.max(b.minX, Math.min(b.maxX, S.offsetX - dx));
  const now = performance.now();
  if (now < flipCooldownUntil) { flipAcc = 0; mark(); return; }
  if (now - flipLastT > FLIP_STALE_MS) flipAcc = 0;
  const ny = S.offsetY - dy;
  if (ny < b.minY) {
    S.offsetY = b.minY;
    flipAcc = Math.max(0, flipAcc) + (b.minY - ny);
    flipLastT = now;
    if (flipAcc > FLIP_PX && S.pageIndex < pages().length - 1) {
      flipAcc = 0; flipCooldownUntil = now + FLIP_COOLDOWN_MS;
      goToPage(S.pageIndex + 1, { align: 'top', instant: true });
    } else if (flipAcc > FLIP_PX * 2 && S.pageIndex === pages().length - 1) {
      // keep scrolling past the end — add a fresh page and land on it
      flipAcc = 0; flipCooldownUntil = now + FLIP_COOLDOWN_MS;
      addPagesAfterCurrent(newPage(page().paper, page().format));
      const nb = presentCamBounds();
      S.offsetX = Math.max(nb.minX, Math.min(nb.maxX, S.offsetX));
      S.offsetY = nb.maxY;
    }
  } else if (ny > b.maxY) {
    S.offsetY = b.maxY;
    flipAcc = Math.min(0, flipAcc) - (ny - b.maxY);
    flipLastT = now;
    if (flipAcc < -FLIP_PX && S.pageIndex > 0) {
      flipAcc = 0; flipCooldownUntil = now + FLIP_COOLDOWN_MS;
      goToPage(S.pageIndex - 1, { align: 'bottom', instant: true });
    }
  } else {
    S.offsetY = ny;
    flipAcc = 0;
  }
  mark();
}

// page strip thumbnails (blank pages rendered; PDF pages use background JPEG)
const thumbCache = new Map(); // pageId -> data URL
const THUMB_W = 56, THUMB_H = 79;
function makePageThumbUrl(pg) {
  let url = thumbCache.get(pg.id);
  if (url) return url;
  // 280px wide: library covers render at ~270 CSS px on 2x screens — the
  // default 56px base made them blurry on iPad
  const { w: TW, h: TH } = thumbDims(pg, 280);
  const oc = document.createElement('canvas');
  oc.width = TW; oc.height = TH;
  const c = oc.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, TW, TH);
  const sf = TW / pageW(pg);
  c.scale(sf, sf);
  drawTemplate(c, pg.paper, pageW(pg), pageH(pg));
  for (const s of pg.strokes) drawStroke(c, s);
  url = oc.toDataURL('image/jpeg', 0.72);
  thumbCache.set(pg.id, url);
  return url;
}

// page background images (imported PDF/photo pages), cached + lazily decoded
const imgCache = new Map(); // pageId -> { img, loaded }
function pageImage(pg) {
  if (!pg.background) return null;
  if (isPdfPageBg(pg.background)) {
    let e = imgCache.get(pg.id);
    if (!e) {
      const img = new Image();
      e = { img, loaded: false };
      imgCache.set(pg.id, e);
      img.onload = () => { e.loaded = true; mark(); };
      img.onerror = () => { e.loaded = true; mark(); };
      loadPdfPageImage(pg.background).then((loaded) => {
        if (loaded) { e.img = loaded; e.loaded = true; mark(); }
        else { e.loaded = true; mark(); }
      });
    }
    return e.loaded ? e.img : null;
  }
  if (pg.background.type !== 'image' && pg.background.type !== 'blob' && !pg.background.blobId) return null;
  let e = imgCache.get(pg.id);
  if (!e) {
    const img = new Image();
    e = { img, loaded: false };
    imgCache.set(pg.id, e);
    img.onload = () => { e.loaded = true; mark(); };
    img.onerror = () => { e.loaded = true; mark(); };
    const blobId = pg.background.blobId;
    const cached = blobId ? cachedMediaUrl(blobId) : null;
    if (cached) img.src = cached;
    else if (pg.background.data) img.src = pg.background.data;
    else if (blobId) {
      resolveMediaUrl(pg.background).then((url) => {
        if (url) { img.src = url; setCachedUrl(blobId, url); }
      });
    }
  }
  return e.loaded ? e.img : null;
}
// inserted diagram/photo objects (movable, not page background)
const objImgCache = new Map(); // object id -> { img, loaded }
function objImage(o) {
  if (o.kind !== 'image' || (!o.data && !o.blobId)) return null;
  let e = objImgCache.get(o.id);
  if (!e) {
    const img = new Image();
    e = { img, loaded: false };
    objImgCache.set(o.id, e);
    img.onload = () => { e.loaded = true; mark(); };
    img.onerror = () => { e.loaded = true; mark(); };
    const cached = o.blobId ? cachedMediaUrl(o.blobId) : null;
    if (cached) img.src = cached;
    else if (o.data) img.src = o.data;
    else if (o.blobId) {
      resolveMediaUrl({ type: 'blob', blobId: o.blobId }).then((url) => {
        if (url) { img.src = url; setCachedUrl(o.blobId, url); }
      });
    }
  }
  return e.loaded ? e.img : null;
}
function purgeObjImage(id) { objImgCache.delete(id); }
function ensureObjImagesLoaded() {
  const list = [];
  if (!S.notebook) return Promise.resolve();
  for (const pg of allPages(S.notebook)) {
    for (const o of (pg.objects || [])) if (o.kind === 'image' && (o.data || o.blobId)) list.push(o);
  }
  return Promise.all(list.map((o) => new Promise((res) => {
    const e = objImgCache.get(o.id);
    if (e && e.loaded) return res();
    const img = new Image();
    img.onload = () => { objImgCache.set(o.id, { img, loaded: true }); res(); };
    img.onerror = () => res();
    const cached = o.blobId ? cachedMediaUrl(o.blobId) : null;
    if (cached) img.src = cached;
    else if (o.data) img.src = o.data;
    else if (o.blobId) resolveMediaUrl({ type: 'blob', blobId: o.blobId }).then((url) => { if (url) img.src = url; }).finally(res);
    else res();
  })));
}
function drawContain(c, img, pw, ph) {
  const s = Math.min(pw / img.width, ph / img.height);
  const w = img.width * s, h = img.height * s;
  c.drawImage(img, (pw - w) / 2, (ph - h) / 2, w, h);
}
// dispatch: imported image background, else paper template
function drawBackground(c, pg, img) {
  const pw = pageW(pg), ph = pageH(pg);
  if (pg.background && (pg.background.type === 'image' || pg.background.blobId || pg.background.type === 'blob' || isPdfPageBg(pg.background))) {
    if (img) drawContain(c, img, pw, ph);
  } else {
    drawTemplate(c, pg.paper, pw, ph);
  }
}
// ensure all imported page images are decoded before export
function ensureImagesLoaded() {
  const pend = allPages(S.notebook).filter((p) => p.background && isImportedPageBg(p.background));
  return Promise.all(pend.map((p) => new Promise((res) => {
    const e = imgCache.get(p.id);
    if (e && e.loaded) return res();
    if (isPdfPageBg(p.background)) {
      loadPdfPageImage(p.background).then((img) => {
        if (img) imgCache.set(p.id, { img, loaded: true });
        res();
      }).catch(() => res());
      return;
    }
    const img = new Image();
    img.onload = () => { imgCache.set(p.id, { img, loaded: true }); res(); };
    img.onerror = () => res();
    const blobId = p.background.blobId;
    const cached = blobId ? cachedMediaUrl(blobId) : null;
    if (cached) img.src = cached;
    else if (p.background.data) img.src = p.background.data;
    else resolveMediaUrl(p.background).then((url) => { if (url) img.src = url; }).finally(() => res());
  })));
}

function drawTemplate(c, paper, pw = A4_W, ph = A4_H) {
  c.lineWidth = 1;
  const line = (x1, y1, x2, y2, col, w) => {
    c.strokeStyle = col; c.lineWidth = w; c.beginPath();
    c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  };
  const grid = (step, col) => {
    for (let x = step; x < pw; x += step) line(x, 0, x, ph, col, 1);
    for (let y = step; y < ph; y += step) line(0, y, pw, y, col, 1);
  };
  const faint = '#dfe6ef', mid = '#c2d0e0', axis = '#7d8aa0';
  if (paper === 'squared') grid(40, faint);
  else if (paper === 'graph') { grid(20, faint); grid(100, mid); }
  else if (paper === 'dotted') {
    c.fillStyle = mid;
    for (let x = 40; x < pw; x += 40) for (let y = 40; y < ph; y += 40) { c.beginPath(); c.arc(x, y, 1.7, 0, Math.PI * 2); c.fill(); }
  } else if (paper === 'lined') {
    for (let y = 64; y < ph; y += 48) line(0, y, pw, y, faint, 1);
    line(86, 0, 86, ph, '#edc1c1', 1.5);
  } else if (paper === 'cornell') {
    for (let y = 80; y < ph; y += 56) line(0, y, pw, y, faint, 1);
    line(240, 0, 240, ph, mid, 1.5);
  } else if (paper === 'argand' || paper === 'vectorgrid' || paper === 'axes') {
    const cx = pw / 2, cy = ph / 2, g = UNIT;
    for (let x = cx % g; x < pw; x += g) line(x, 0, x, ph, faint, 1);
    for (let y = cy % g; y < ph; y += g) line(0, y, pw, y, faint, 1);
    line(0, cy, pw, cy, axis, 2);
    line(cx, 0, cx, ph, axis, 2);
    if (paper === 'argand') {
      c.fillStyle = axis; c.font = '24px sans-serif';
      c.fillText('Re', pw - 56, cy - 12);
      c.fillText('Im', cx + 12, 32);
    } else if (paper === 'axes') {
      c.fillStyle = axis; c.font = '16px sans-serif'; c.textAlign = 'center';
      for (let n = 1; cx + n * g < pw; n++) c.fillText(String(n), cx + n * g, cy + 18);
      for (let n = 1; cx - n * g > 0; n++) c.fillText(String(-n), cx - n * g, cy + 18);
      for (let n = 1; cy + n * g < ph; n++) c.fillText(String(-n), cx - 16, cy + n * g + 5);
      for (let n = 1; cy - n * g > 0; n++) c.fillText(String(n), cx - 16, cy - n * g + 5);
      c.textAlign = 'start'; c.font = '22px sans-serif';
      c.fillText('x', pw - 22, cy - 10); c.fillText('y', cx + 10, 26);
    }
  }
}

// perfect-freehand options per tool — size ≈ max ink diameter in page units.
// Higher smoothing/streamline ≈ GoodNotes-class curves (less jitter, rounder joins).
function strokeOpts(s) {
  const w = s.width || 4;
  if (s.tool === 'highlighter') {
    return { size: w * 2.2, thinning: 0, smoothing: 0.55, streamline: 0.52, simulatePressure: false };
  }
  if (s.penType === 'marker') {
    return { size: w * 2.2, thinning: 0.12, smoothing: 0.62, streamline: 0.58, simulatePressure: true };
  }
  if (s.penType === 'calligraphy') {
    return { size: w * 2.4, thinning: 0.72, smoothing: 0.65, streamline: 0.52, simulatePressure: true };
  }
  return { size: w * 1.9, thinning: 0.52, smoothing: 0.65, streamline: 0.6, simulatePressure: true };
}

function sliceStrokePoints(pts, progress) {
  if (progress >= 1 || !pts?.length) return pts;
  if (progress <= 0) return [pts[0]];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  if (total < 0.5) return pts.slice(0, 1);
  const target = total * progress;
  let acc = 0;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + seg >= target) {
      const f = seg > 0 ? (target - acc) / seg : 0;
      out.push({
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
        p: pts[i].p ?? pts[i - 1].p ?? 0.5,
      });
      break;
    }
    acc += seg;
    out.push(pts[i]);
  }
  return out.length >= 2 ? out : [pts[0], pts[Math.min(1, pts.length - 1)]];
}

// Committed strokes never change their points, so the perfect-freehand outline
// is computed once and cached as a Path2D. The fingerprint (length + endpoints)
// catches in-place mutation from lasso/selection moves, which shift every point.
const inkPathCache = new WeakMap();
function strokeFingerprint(s) {
  const pts = s.points, n = pts.length;
  const a = pts[0], b = pts[n - 1];
  return `${n}|${a.x},${a.y}|${b.x},${b.y}|${s.width}|${s.tool}|${s.penType || ''}`;
}
function strokeOutline(s) {
  const fp = strokeFingerprint(s);
  const hit = inkPathCache.get(s);
  if (hit && hit.fp === fp) return hit;
  const input = s.points.map((pt) => [pt.x, pt.y, pt.p ?? 0.5]);
  const outline = getStroke(input, { ...strokeOpts(s), last: true });
  const path = new Path2D();
  if (outline.length >= 2) {
    path.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) path.lineTo(outline[i][0], outline[i][1]);
    path.closePath();
  }
  const entry = { fp, path, n: outline.length };
  inkPathCache.set(s, entry);
  return entry;
}

function drawStroke(c, s, progress = 1) {
  // Defensive: a malformed/partial stroke (no points array) must never crash the
  // render loop — it would throw every frame and flood the global error banner.
  const ptsRaw = s?.points;
  if (!ptsRaw || !ptsRaw.length) return;
  const hl = s.tool === 'highlighter';
  c.fillStyle = s.color;
  c.globalAlpha = hl ? 0.3 : 1;
  if (progress >= 1) {
    const entry = strokeOutline(s);
    if (entry.n < 2) {
      const r = Math.max(strokeOpts(s).size / 2, 0.6);
      c.beginPath();
      c.arc(ptsRaw[0].x, ptsRaw[0].y, r, 0, Math.PI * 2);
      c.fill();
    } else c.fill(entry.path);
    c.globalAlpha = 1;
    return;
  }
  // partial reveal during scene playback — transient, so computed live
  const pts = sliceStrokePoints(ptsRaw, progress);
  const input = pts.map((pt) => [pt.x, pt.y, pt.p ?? 0.5]);
  const outline = getStroke(input, { ...strokeOpts(s), last: true });
  if (outline.length < 2) {
    const r = Math.max(strokeOpts(s).size / 2, 0.6);
    c.beginPath();
    c.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    return;
  }
  c.beginPath();
  c.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) c.lineTo(outline[i][0], outline[i][1]);
  c.closePath();
  c.fill();
  c.globalAlpha = 1;
}

// Live ink while the Pencil is down — same perfect-freehand outline as committed
// strokes so the preview doesn't "pop" on pen-up. inkPredicted holds Safari's
// predicted samples as an ephemeral tail (never committed).
let inkPredicted = [];
function drawStrokePreview(c, s) {
  const pts = s?.points;
  if (!pts || !pts.length) return;
  const hl = s.tool === 'highlighter';
  c.save();
  c.fillStyle = s.color;
  c.globalAlpha = hl ? 0.3 : 1;
  const tailP = pts[pts.length - 1]?.p ?? 0.5;
  const input = pts.map((pt) => [pt.x, pt.y, pt.p ?? 0.5]);
  for (const q of inkPredicted) input.push([q.x, q.y, tailP]);
  if (input.length === 1) {
    const r = Math.max(strokeOpts(s).size / 2, 0.6);
    c.beginPath();
    c.arc(input[0][0], input[0][1], r, 0, Math.PI * 2);
    c.fill();
    c.restore();
    return;
  }
  const outline = getStroke(input, { ...strokeOpts(s), last: !inkPredicted.length });
  if (outline.length < 2) {
    const r = Math.max(strokeOpts(s).size / 2, 0.6);
    c.beginPath();
    c.arc(input[0][0], input[0][1], r, 0, Math.PI * 2);
    c.fill();
    c.restore();
    return;
  }
  c.beginPath();
  c.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) c.lineTo(outline[i][0], outline[i][1]);
  c.closePath();
  c.fill();
  c.restore();
}

// ---- math objects: vectors & lines ------------------------------------------
const fmt = (n) => Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
const formatAngle = (rad) => S.radians ? `${rad.toFixed(2)} rad` : `${Math.round(rad * 180 / Math.PI)}°`;
function vecInfo(o) {
  const dx = (o.to.x - o.from.x) / UNIT, dy = (o.from.y - o.to.y) / UNIT;   // y up = positive
  return { dx, dy, mag: Math.hypot(dx, dy), angRad: Math.atan2(dy, dx) };
}
function complexInfo(o) {                          // a + bi from page point, origin at page centre
  const a = (o.at.x - gridCx()) / UNIT, b = (gridCy() - o.at.y) / UNIT;
  return { a, b, mod: Math.hypot(a, b), argRad: Math.atan2(b, a) };
}
function drawArrow(c, a, b, col, dashed, progress = 1) {
  const tx = a.x + (b.x - a.x) * progress;
  const ty = a.y + (b.y - a.y) * progress;
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 3.5; c.lineCap = 'round'; c.lineJoin = 'round';
  if (dashed) c.setLineDash([14, 10]);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(tx, ty); c.stroke();
  c.setLineDash([]);
  const ang = Math.atan2(ty - a.y, tx - a.x), h = 22;
  if (Math.hypot(tx - a.x, ty - a.y) < 4) return;
  if (progress < 1) return;
  c.beginPath(); c.moveTo(tx, ty);
  c.lineTo(tx - h * Math.cos(ang - 0.4), ty - h * Math.sin(ang - 0.4));
  c.lineTo(tx - h * Math.cos(ang + 0.4), ty - h * Math.sin(ang + 0.4));
  c.closePath(); c.fill();
}
function drawComplex(c, o, col) {
  const cx = gridCx(), cy = gridCy(), z = complexInfo(o);
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
  const ang = (o.anim && !hasTargetTracks(page(), o.id) ? S.demoT : 0) * Math.PI * 2;
  const px = o.center.x + Math.cos(ang) * r, py = o.center.y - Math.sin(ang) * r;
  c.strokeStyle = col; c.lineWidth = 2;
  c.beginPath(); c.moveTo(o.center.x, o.center.y); c.lineTo(px, py); c.stroke();
  c.fillStyle = col; c.beginPath(); c.arc(px, py, 7, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
  if (o.label) { c.fillStyle = col; c.font = '600 18px sans-serif'; c.fillText(o.label, px + 10, py - 8); }
}
// live force vector with auto-resolved horizontal/vertical components (Module 2).
// liveAngle = base angleDeg (+ demoT sweep when o.anim) so it can be dragged AND animated.
function forceLiveAngle(o) { return (o.angleDeg || 0) + (o.anim && !hasTargetTracks(page(), o.id) ? S.demoT * 360 : 0); }
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
// Vector Arrow Engine: one 'forcevec' kind covers Force/Velocity/Acceleration — vtype only
// changes the default colour + label prefix/unit, geometry & dragging are shared.
const VTYPE_META = {
  force: { color: '#d23b3b', prefix: 'F', unit: 'N' },
  velocity: { color: '#2566c8', prefix: 'v', unit: 'm/s' },
  acceleration: { color: '#1f9d57', prefix: 'a', unit: 'm/s²' },
};
function forceTip(o) {
  const th = forceLiveAngle(o) * Math.PI / 180;
  return { x: o.at.x + o.mag * Math.cos(th) * FORCE_SCALE, y: o.at.y - o.mag * Math.sin(th) * FORCE_SCALE };
}
function drawForceVec(c, o, drawProgress = 1) {
  const meta = VTYPE_META[o.vtype] || VTYPE_META.force;
  const col = o.color || meta.color;
  const th = forceLiveAngle(o) * Math.PI / 180;
  const Fx = o.mag * Math.cos(th), Fy = o.mag * Math.sin(th);
  const tip = forceTip(o), corner = { x: tip.x, y: o.at.y };
  if (drawProgress >= 1) {
    compArrow(c, o.at, corner, '#1f9d57');         // horizontal component
    compArrow(c, corner, tip, '#2566c8');          // vertical component
    // right-angle marker at the corner
    if (Math.abs(Fx) > 0.05 && Math.abs(Fy) > 0.05) {
      const dx = Math.sign(o.at.x - corner.x) * 12, dy = Math.sign(tip.y - corner.y) * 12;
      c.strokeStyle = '#88929c'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(corner.x + dx, corner.y); c.lineTo(corner.x + dx, corner.y + dy); c.lineTo(corner.x, corner.y + dy); c.stroke();
    }
  }
  drawArrow(c, o.at, tip, col, false, drawProgress);            // the vector itself
  c.fillStyle = '#1b1b1b'; c.beginPath(); c.arc(o.at.x, o.at.y, 4, 0, Math.PI * 2); c.fill();
  const degs = Math.round((forceLiveAngle(o) % 360 + 360) % 360);
  c.font = '600 17px sans-serif'; c.fillStyle = col;
  c.fillText(`${meta.prefix} = ${fmt(o.mag)} ${meta.unit}  @ ${degs}°`, tip.x + 10, tip.y - 6);
  c.font = '14px sans-serif';
  c.fillStyle = '#1f9d57'; c.fillText(`${meta.prefix}x = ${fmt(Fx)}`, (o.at.x + corner.x) / 2 - 24, o.at.y + (Fy >= 0 ? 20 : -8));
  c.fillStyle = '#2566c8'; c.fillText(`${meta.prefix}y = ${fmt(Fy)}`, corner.x + 8, (corner.y + tip.y) / 2);
}
// labelled arrow used by the live mechanics primitives — `scale` grows line/arrowhead/label
// together so a diagram enlarged for classroom visibility stays legible, not just wireframe-bigger.
function labeledArrow(c, a, b, col, dashed, lab, scale = 1) {
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = (dashed ? 2 : 3) * scale; c.setLineDash(dashed ? [8, 6] : []);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
  if (Math.hypot(b.x - a.x, b.y - a.y) > 4) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x), h = 13 * scale;
    c.beginPath(); c.moveTo(b.x, b.y);
    c.lineTo(b.x - h * Math.cos(ang - 0.4), b.y - h * Math.sin(ang - 0.4));
    c.lineTo(b.x - h * Math.cos(ang + 0.4), b.y - h * Math.sin(ang + 0.4));
    c.closePath(); c.fill();
  }
  if (lab) { c.font = `600 ${Math.round(14 * scale)}px sans-serif`; c.fillStyle = col; c.fillText(lab, b.x + 5, b.y - 4); }
}
// inclined-plane block (Module 3): drag/animate the slope angle; weight, normal, friction +
// along/perpendicular components all update live.
function inclineLiveAngle(o) {
  const base = o.anim && !hasTargetTracks(page(), o.id) ? (5 + S.demoT * 80) : (o.angleDeg || 30);
  return Math.max(5, Math.min(85, base));
}
function inclineGeom(o) {
  const a = o.at, B = o.base || 300, ang = inclineLiveAngle(o) * Math.PI / 180;
  const h = B * Math.tan(ang);
  return { a, B, ang, h, b: { x: a.x + B, y: a.y }, top: { x: a.x + B, y: a.y - h } };
}
// Point where the sliding block/mass sits on the slope surface — shared by the incline's own
// force-diagram draw AND the Vector Arrow Engine's snap-to-object logic (drag a force/velocity/
// acceleration arrow's tail near this point and it locks onto the mass).
function inclineBlockAnchor(o) {
  const { a, b, top } = inclineGeom(o);
  const hx = top.x - a.x, hy = top.y - a.y, len = Math.hypot(hx, hy) || 1;
  const ux = hx / len, uy = hy / len;
  let outx = uy, outy = -ux;
  const mid = { x: a.x + hx * 0.5, y: a.y + hy * 0.5 };
  if ((b.x - mid.x) * outx + (b.y - mid.y) * outy > 0) { outx = -outx; outy = -outy; }
  const bh = 30 * (o.scale || 1);
  return { x: mid.x + outx * (bh / 2 + 2), y: mid.y + outy * (bh / 2 + 2) };
}
function nearestInclineAnchor(p, tol) {
  let best = null, bestD = tol * tol;
  for (const o of objs()) {
    if (o.kind !== 'incline') continue;
    const anchor = inclineBlockAnchor(o);
    const d = (p.x - anchor.x) ** 2 + (p.y - anchor.y) ** 2;
    if (d < bestD) { bestD = d; best = anchor; }
  }
  return best;
}
function drawInclineObj(c, o) {
  const { a, ang, b, top } = inclineGeom(o);
  const SC = o.scale || 1;                          // whole-diagram size — drag the ⤢ handle or "Diagram size"
  c.fillStyle = 'rgba(200,210,220,0.35)'; c.strokeStyle = '#5a6570'; c.lineWidth = 2.5 * SC; c.setLineDash([]);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(top.x, top.y); c.closePath(); c.fill(); c.stroke();
  c.strokeStyle = '#88929c'; c.lineWidth = 2 * SC;
  c.beginPath(); c.moveTo(a.x - 50 * SC, a.y); c.lineTo(b.x + 40 * SC, b.y); c.stroke();
  // up-slope unit (a -> top) and outward normal (away from interior corner b)
  const hx = top.x - a.x, hy = top.y - a.y, len = Math.hypot(hx, hy) || 1;
  const ux = hx / len, uy = hy / len;
  let outx = uy, outy = -ux;                       // a perpendicular
  const mid = { x: a.x + hx * 0.5, y: a.y + hy * 0.5 };
  if ((b.x - mid.x) * outx + (b.y - mid.y) * outy > 0) { outx = -outx; outy = -outy; }
  // block on the slope
  const bw = 46 * SC, bh = 30 * SC;
  c.save(); c.translate(mid.x, mid.y); c.rotate(Math.atan2(uy, ux));
  c.fillStyle = '#c8d4e0'; c.strokeStyle = '#4a5560'; c.lineWidth = 2 * SC;
  c.fillRect(-bw / 2, -bh, bw, bh); c.strokeRect(-bw / 2, -bh, bw, bh);
  c.restore();
  const C = { x: mid.x + outx * (bh / 2 + 2), y: mid.y + outy * (bh / 2 + 2) };
  const m = o.mass || 2, g = 9.8, mg = m * g, mu = o.mu || 0, FS = 4 * SC;
  const N = mg * Math.cos(ang);
  labeledArrow(c, C, { x: C.x, y: C.y + mg * FS }, '#1f9d57', false, 'mg', SC);
  labeledArrow(c, C, { x: C.x + outx * N * FS, y: C.y + outy * N * FS }, '#2566c8', false, 'N', SC);
  if (o.showComponents !== false) {
    labeledArrow(c, C, { x: C.x - ux * mg * Math.sin(ang) * FS, y: C.y - uy * mg * Math.sin(ang) * FS }, '#e0892a', true, 'mg sinα', SC);
    labeledArrow(c, C, { x: C.x - outx * mg * Math.cos(ang) * FS, y: C.y - outy * mg * Math.cos(ang) * FS }, '#8a4fd0', true, 'mg cosα', SC);
  }
  if (mu > 0) { const f = mu * N; labeledArrow(c, C, { x: C.x + ux * f * FS, y: C.y + uy * f * FS }, '#d23b3b', false, 'f', SC); }
  c.fillStyle = '#4a5560'; c.font = `600 ${Math.round(16 * SC)}px sans-serif`;
  c.fillText(`α = ${Math.round(inclineLiveAngle(o))}°   m = ${fmt(m)} kg   μ = ${fmt(mu)}`, a.x + 6, a.y - 12 * SC);
}
// Interactive trig triangle: drag any of the 3 vertices (p1/p2/p3, via the Select tool's generic
// handle system) and side lengths (page units / UNIT) + interior angles recompute every frame.
// When one vertex sits within ~3° of 90° it's treated as the right angle, and the two legs get
// opp/adj labels relative to whichever of the other two vertices is p1 (falls back to p2 if p1
// IS the right angle) — otherwise (dragged into a non-right shape) we just show plain side/angle values.
function angleAtVertex(v, p, q) {           // interior angle at v, radians, between rays v->p and v->q
  const v1x = p.x - v.x, v1y = p.y - v.y, v2x = q.x - v.x, v2y = q.y - v.y;
  const m1 = Math.hypot(v1x, v1y) || 1, m2 = Math.hypot(v2x, v2y) || 1;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return Math.acos(cos);
}
function triangleInfo(o) {
  const { p1, p2, p3 } = o;
  const angs = { p1: angleAtVertex(p1, p2, p3), p2: angleAtVertex(p2, p1, p3), p3: angleAtVertex(p3, p1, p2) };
  const rightKey = Object.keys(angs).find((k) => Math.abs(angs[k] - Math.PI / 2) < 0.052); // ~3°
  let refKey = null;
  if (rightKey) refKey = rightKey === 'p1' ? 'p2' : 'p1';
  return { angs, rightKey, refKey };
}
function drawTriangleObj(c, o) {
  const col = o.color || '#2566c8';
  const { p1, p2, p3 } = o;
  const { angs, rightKey, refKey } = triangleInfo(o);
  c.fillStyle = col + '22'; c.strokeStyle = col; c.lineWidth = 3; c.lineJoin = 'round'; c.setLineDash([]);
  c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.lineTo(p3.x, p3.y); c.closePath();
  c.fill(); c.stroke();
  const V = { p1, p2, p3 };
  if (rightKey) {                            // small square marker at the right angle
    const R = V[rightKey];
    const others = Object.keys(V).filter((k) => k !== rightKey).map((k) => V[k]);
    const u1x = others[0].x - R.x, u1y = others[0].y - R.y, l1 = Math.hypot(u1x, u1y) || 1;
    const u2x = others[1].x - R.x, u2y = others[1].y - R.y, l2 = Math.hypot(u2x, u2y) || 1;
    const s = 14, ax = u1x / l1 * s, ay = u1y / l1 * s, bx = u2x / l2 * s, by = u2y / l2 * s;
    c.strokeStyle = '#4a5560'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(R.x + ax, R.y + ay); c.lineTo(R.x + ax + bx, R.y + ay + by); c.lineTo(R.x + bx, R.y + by); c.stroke();
  }
  // side lengths (math units) at each edge midpoint, opp/adj/hyp tagged when right-angled
  const sideDefs = [
    { a: p2, b: p3, oppOf: 'p1' }, { a: p1, b: p3, oppOf: 'p2' }, { a: p1, b: p2, oppOf: 'p3' },
  ];
  c.font = '600 15px sans-serif'; c.fillStyle = col;
  for (const s of sideDefs) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) / UNIT;
    const mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2;
    let tag = '';
    if (refKey) {
      if (s.oppOf === rightKey) tag = 'hyp = ';
      else if (s.oppOf === refKey) tag = 'opp = ';
      else tag = 'adj = ';
    }
    c.fillText(`${tag}${len.toFixed(2)}`, mx + 6, my - 6);
  }
  // angle labels at each vertex; the reference angle (θ) is called out when right-angled
  c.font = '600 16px sans-serif';
  for (const k of ['p1', 'p2', 'p3']) {
    const v = V[k], lab = refKey === k ? `θ = ${formatAngle(angs[k])}` : formatAngle(angs[k]);
    c.fillStyle = k === refKey ? '#d23b3b' : '#4a5560';
    c.fillText(lab, v.x + 8, v.y + (v.y > (p1.y + p2.y + p3.y) / 3 ? 18 : -8));
  }
}
function addTriangle() {
  beginAction();
  const cx = gridCx(), cy = gridCy();
  const o = {
    id: uid(), kind: 'triangle', color: S.color || '#2566c8',
    p1: { x: cx, y: cy - 3 * UNIT },        // default 3-4-5 right triangle, right angle at p2
    p2: { x: cx, y: cy },
    p3: { x: cx + 4 * UNIT, y: cy },
  };
  objs().push(o);
  recordObject(o);
  commitAction();
  selectNewObject(o);
}
function drawCircle(c, o, col) {
  const r = Math.hypot(o.edge.x - o.center.x, o.edge.y - o.center.y);
  if (o.sketchy && drawRoughShape(c, o, col)) { /* rough ring */ }
  else {
    c.strokeStyle = col; c.lineWidth = 3; c.setLineDash([]);
    c.beginPath(); c.arc(o.center.x, o.center.y, r, 0, Math.PI * 2); c.stroke();
  }
  c.fillStyle = col; c.beginPath(); c.arc(o.center.x, o.center.y, 4, 0, Math.PI * 2); c.fill();
  const a = (o.center.x - gridCx()) / UNIT, b = (gridCy() - o.center.y) / UNIT;
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

// ---- equation objects (LaTeX edit via MathLive, canvas render via KaTeX) ----
// Stored as { kind:'equation', at:{x,y}, latex:'...', color, size }.
let eqRenderCache = new Map(); // latex|size|color -> { img, w, h, ready? }
let katexSvgCssPromise = null;

// KaTeX @font-face list — matches vendor/katex.min.css; woff2 files live in vendor/fonts/.
const KATEX_FONT_FILES = [
  ['KaTeX_AMS', 'normal', 400, 'KaTeX_AMS-Regular.woff2'],
  ['KaTeX_Caligraphic', 'normal', 700, 'KaTeX_Caligraphic-Bold.woff2'],
  ['KaTeX_Caligraphic', 'normal', 400, 'KaTeX_Caligraphic-Regular.woff2'],
  ['KaTeX_Fraktur', 'normal', 700, 'KaTeX_Fraktur-Bold.woff2'],
  ['KaTeX_Fraktur', 'normal', 400, 'KaTeX_Fraktur-Regular.woff2'],
  ['KaTeX_Main', 'normal', 700, 'KaTeX_Main-Bold.woff2'],
  ['KaTeX_Main', 'italic', 700, 'KaTeX_Main-BoldItalic.woff2'],
  ['KaTeX_Main', 'italic', 400, 'KaTeX_Main-Italic.woff2'],
  ['KaTeX_Main', 'normal', 400, 'KaTeX_Main-Regular.woff2'],
  ['KaTeX_Math', 'italic', 700, 'KaTeX_Math-BoldItalic.woff2'],
  ['KaTeX_Math', 'italic', 400, 'KaTeX_Math-Italic.woff2'],
  ['KaTeX_SansSerif', 'normal', 700, 'KaTeX_SansSerif-Bold.woff2'],
  ['KaTeX_SansSerif', 'italic', 400, 'KaTeX_SansSerif-Italic.woff2'],
  ['KaTeX_SansSerif', 'normal', 400, 'KaTeX_SansSerif-Regular.woff2'],
  ['KaTeX_Script', 'normal', 400, 'KaTeX_Script-Regular.woff2'],
  ['KaTeX_Size1', 'normal', 400, 'KaTeX_Size1-Regular.woff2'],
  ['KaTeX_Size2', 'normal', 400, 'KaTeX_Size2-Regular.woff2'],
  ['KaTeX_Size3', 'normal', 400, 'KaTeX_Size3-Regular.woff2'],
  ['KaTeX_Size4', 'normal', 400, 'KaTeX_Size4-Regular.woff2'],
  ['KaTeX_Typewriter', 'normal', 400, 'KaTeX_Typewriter-Regular.woff2'],
];

function bytesToB64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function ensureKatexSvgCss() {
  if (katexSvgCssPromise) return katexSvgCssPromise;
  katexSvgCssPromise = (async () => {
    let faces = '';
    for (const [fam, style, weight, file] of KATEX_FONT_FILES) {
      const resp = await fetch(`./vendor/fonts/${file}`);
      const b64 = bytesToB64(await resp.arrayBuffer());
      faces += `@font-face{font-family:${fam};font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
    }
    let layout = await (await fetch('./vendor/katex.min.css')).text();
    layout = layout.replace(/@font-face\{[^}]+\}/g, '');
    return faces + layout;
  })();
  return katexSvgCssPromise;
}

function eqTextFallback(latex, size, color) {
  const oc = document.createElement('canvas');
  const text = (latex || '').replace(/[\\{}]/g, '');
  oc.width = Math.max(40, text.length * size * 0.35);
  oc.height = Math.ceil(size * 1.4);
  const cx = oc.getContext('2d');
  cx.fillStyle = color || '#1b1b1b';
  cx.font = `${size}px serif`;
  cx.fillText(text, 0, size);
  return { img: oc, w: oc.width, h: oc.height, ready: true };
}

function katexMeasureHtml(src, size, color) {
  const div = document.createElement('div');
  div.className = 'katex-eq-raster';
  div.style.fontSize = `${size}px`;
  div.style.color = color;
  try {
    window.katex.render(src, div, { throwOnError: false, displayMode: false, strict: 'ignore' });
  } catch (_) { return null; }
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none';
  probe.appendChild(div);
  document.body.appendChild(probe);
  const w = Math.max(1, Math.ceil(div.scrollWidth || div.offsetWidth || div.getBoundingClientRect().width) + 2);
  const h = Math.max(1, Math.ceil(div.scrollHeight || div.offsetHeight || div.getBoundingClientRect().height) + 2);
  const inner = div.innerHTML;
  document.body.removeChild(probe);
  return { w, h, inner };
}

function rasterizeKatexSvg(src, size, color, svgCss, entry, key) {
  const measured = katexMeasureHtml(src, size, color);
  if (!measured) {
    eqRenderCache.set(key, eqTextFallback(src, size, color));
    entry.ready = true;
    mark();
    return;
  }
  const { w, h, inner } = measured;
  entry.w = w;
  entry.h = h;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><style>${svgCss}</style></defs>
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" class="katex-eq-raster" style="font-size:${size}px;color:${color}">${inner}</div>
  </foreignObject>
</svg>`;
  const img = new Image();
  img.onload = () => {
    entry.img.width = w;
    entry.img.height = h;
    entry.img.getContext('2d').drawImage(img, 0, 0);
    entry.ready = true;
    mark();
  };
  img.onerror = () => {
    eqRenderCache.set(key, eqTextFallback(src, size, color));
    entry.ready = true;
    mark();
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function renderEquationToImage(latex, size, color = '#1b1b1b') {
  const key = `${latex}|${size}|${color}`;
  const hit = eqRenderCache.get(key);
  if (hit) return hit;

  const src = (latex || '').trim() || '\\text{ }';
  if (!window.katex?.render) return eqTextFallback(src, size, color);

  const measured = katexMeasureHtml(src, size, color);
  if (!measured) return eqTextFallback(src, size, color);

  const canvas = document.createElement('canvas');
  canvas.width = measured.w;
  canvas.height = measured.h;
  const entry = { img: canvas, w: measured.w, h: measured.h, ready: false };
  eqRenderCache.set(key, entry);

  ensureKatexSvgCss().then(
    (css) => rasterizeKatexSvg(src, size, color, css, entry, key),
    () => {
      eqRenderCache.set(key, eqTextFallback(src, size, color));
      entry.ready = true;
      mark();
    },
  );
  return entry;
}

function drawEquation(c, o) {
  if (S.editingId === o.id) return;
  const col = o.color || '#1b1b1b';
  const r = renderEquationToImage(o.latex || '\\text{ }', o.size || 34, col);
  if (r.ready && r.img) {
    try { c.drawImage(r.img, o.at.x, o.at.y, r.w, r.h); } catch (_) {}
  }
}
function equationBox(o) {
  const r = renderEquationToImage(o.latex || '\\text{ }', o.size || 34, o.color || '#1b1b1b');
  return { w: r.w + 8, h: r.h + 8 };
}
function pointInEquation(o, p) {
  const b = equationBox(o);
  return p.x >= o.at.x - 4 && p.x <= o.at.x + b.w + 4 && p.y >= o.at.y - 4 && p.y <= o.at.y + b.h + 4;
}

// ---- rough.js hand-drawn shapes (line / rect / oval / circle) ---------------
let roughCanvas = null;

function getRoughCanvas() {
  if (!window.rough || !cv) return null;
  if (!roughCanvas) roughCanvas = window.rough.canvas(cv);
  return roughCanvas;
}

function roughStroke(col, seed) {
  return { stroke: col, strokeWidth: 2.5, roughness: 1.15, bowing: 1.1, seed: seed || 1 };
}

function drawRoughShape(c, o, col) {
  const rc = getRoughCanvas();
  if (!rc) return false;
  const seed = o.id ? [...o.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 997 : 1;
  const opt = roughStroke(col, seed);
  if (o.kind === 'line') {
    rc.line(o.from.x, o.from.y, o.to.x, o.to.y, opt);
    return true;
  }
  if (o.kind === 'rect') {
    const x = Math.min(o.from.x, o.to.x), y = Math.min(o.from.y, o.to.y);
    const w = Math.abs(o.to.x - o.from.x), h = Math.abs(o.to.y - o.from.y);
    if (w < 1 || h < 1) return false;
    rc.rectangle(x, y, w, h, opt);
    return true;
  }
  if (o.kind === 'ellipse') {
    const cx = (o.from.x + o.to.x) / 2, cy = (o.from.y + o.to.y) / 2;
    const rw = Math.abs(o.to.x - o.from.x), rh = Math.abs(o.to.y - o.from.y);
    if (rw < 2 || rh < 2) return false;
    rc.ellipse(cx, cy, rw, rh, opt);
    return true;
  }
  if (o.kind === 'circle') {
    const r = Math.hypot(o.edge.x - o.center.x, o.edge.y - o.center.y);
    if (r < 3) return false;
    rc.circle(o.center.x, o.center.y, r * 2, opt);
    return true;
  }
  return false;
}

function shapeExtras() {
  return S.sketchy ? { sketchy: true } : {};
}

function drawObject(c, o, drawProgress = 1) {
  const col = o.color || '#1b1b1b';
  if (o.sketchy && ['line', 'rect', 'ellipse'].includes(o.kind) && drawRoughShape(c, o, col)) return;
  if (o.kind === 'line') {
    c.strokeStyle = col; c.lineWidth = 3; c.lineCap = 'round'; c.setLineDash([]);
    const tx = o.from.x + (o.to.x - o.from.x) * drawProgress;
    const ty = o.from.y + (o.to.y - o.from.y) * drawProgress;
    c.beginPath(); c.moveTo(o.from.x, o.from.y); c.lineTo(tx, ty); c.stroke();
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
  if (o.kind === 'forcevec') { drawForceVec(c, o, drawProgress); return; }
  if (o.kind === 'incline') { drawInclineObj(c, o); return; }
  if (o.kind === 'triangle') { drawTriangleObj(c, o); return; }
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
  drawArrow(c, o.from, o.to, col, o.kind === 'resultant', drawProgress);
  if (drawProgress < 1) return;
  const v = vecInfo(o);
  const lx = o.to.x + 12, ly = o.to.y - 10;
  c.fillStyle = col; c.font = '600 24px sans-serif';
  c.fillText(`(${fmt(v.dx)}, ${fmt(v.dy)})`, lx, ly);
  c.font = '18px sans-serif';
  c.fillText(`|v| = ${v.mag.toFixed(2)}   ${formatAngle(v.angRad)}`, lx, ly + 24);
}
function drawObjects(c, pg, t = 0) {
  refreshGraphObjects();
  for (const o of visibleObjects(pg)) {
    const tracked = hasTargetTracks(pg, o.id);
    const alpha = objAlpha(pg, o.id, t);
    const scale = objPopScale(pg, o.id, t);
    const drawProgress = objDrawProgress(pg, o.id, t);
    if (tracked && alpha <= 0 && drawProgress <= 0) continue;
    c.save();
    if (alpha < 1) c.globalAlpha *= alpha;
    if (scale !== 1 && tracked) {
      const b = objBBox(o);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      c.translate(cx, cy);
      c.scale(scale, scale);
      c.translate(-cx, -cy);
    }
    drawObject(c, o, drawProgress);
    c.restore();
  }
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
      const cx = gridCx(), cy = gridCy();
      drawObject(c, { kind: 'resultant', from: { x: cx, y: cy }, to: { x: cx + sx, y: cy + sy }, color: '#8a4fd0' });
    }
  }
}
function snapPt(p) {
  const pg = page();
  if (!S.snap || !pg || !GRID_PAPERS.includes(pg.paper)) return p;
  const g = UNIT, cx = gridCx(), cy = gridCy();
  return { x: cx + Math.round((p.x - cx) / g) * g, y: cy + Math.round((p.y - cy) / g) * g };
}
function pointSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ---- graphing: y(x), parametric, probe points, tangents, intersections ----------
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
  const pw = pageW(pg), pHt = pageH(pg);
  const gcx = pw / 2, gcy = pHt / 2;
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
        if (pen && lastPy != null && Math.abs(pt.y - lastPy) > pHt * 0.8) pen = false;
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
    const degAxis = !!pg.trigDegAxis;
    c.strokeStyle = f.color; c.lineWidth = 3; c.lineJoin = 'round'; c.lineCap = 'round'; c.setLineDash([]);
    c.beginPath();
    let pen = false, lastPy = null;
    for (let px = 0; px <= pw; px += 2) {
      const xVal = (px - gcx) / UNIT;
      const xRad = degAxis ? xVal * Math.PI / 180 : xVal;
      let y;
      try { y = A * node.evaluate({ x: k * xRad + ph }) + vs; } catch (_) { pen = false; continue; }
      if (typeof y !== 'number' || !isFinite(y)) { pen = false; continue; }
      const py = gcy - y * UNIT;
      if (pen && lastPy != null && Math.abs(py - lastPy) > pHt * 1.5) pen = false;
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
  const pw = pageW(pg), ph = pageH(pg);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, pw, ph);
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

// Bitmap of all committed page content, kept warm across strokes: while inking,
// each frame just blits it and draws the live stroke; at pen-down and pen-up no
// full-page redraw happens at all. Invalidated by mark() (any non-ink change)
// or a camera/size mismatch. Canvas-to-canvas drawImage stays on the GPU, so
// capturing is cheap.
function inkSnapValid() {
  return inkSnapContent && inkSnapState &&
    inkSnapState.w === cv.width && inkSnapState.h === cv.height &&
    inkSnapState.scale === S.scale && inkSnapState.ox === S.offsetX && inkSnapState.oy === S.offsetY;
}
function captureInkSnapshot() {
  if (!inkSnapCanvas) inkSnapCanvas = document.createElement('canvas');
  if (inkSnapCanvas.width !== cv.width || inkSnapCanvas.height !== cv.height) {
    inkSnapCanvas.width = cv.width;
    inkSnapCanvas.height = cv.height;
  }
  const c = inkSnapCanvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, inkSnapCanvas.width, inkSnapCanvas.height);
  c.drawImage(cv, 0, 0);
  inkSnapState = { w: cv.width, h: cv.height, scale: S.scale, ox: S.offsetX, oy: S.offsetY };
  inkSnapContent = true;
}
// Stamp a just-committed stroke into the warm snapshot so the next pen-down
// starts from a fast blit instead of a full-page redraw.
function stampStrokeIntoSnapshot(stroke) {
  if (!inkSnapValid()) return;
  const c = inkSnapCanvas.getContext('2d');
  c.setTransform(dpr * S.scale, 0, 0, dpr * S.scale, dpr * S.offsetX, dpr * S.offsetY);
  c.save();
  c.beginPath();
  c.rect(0, 0, pgW(), pgH());
  c.clip();
  drawStroke(c, stroke);
  c.restore();
  c.setTransform(1, 0, 0, 1, 0, 0);
}

function render() {
  const now = performance.now();
  const pg = page();
  const hasScene = !!(pg?.scene?.steps?.length);
  if (hasScene && S.notebook && !$('#editor').classList.contains('hidden')) {
    if (sceneTick(now)) mark();   // animating content — snapshot must not be reused
    S.demoT = sceneNormalized();
    syncDemoUI();
  } else if (S.playing && S.notebook && !$('#editor').classList.contains('hidden')) {
    // legacy live demo: advance the parameter while playing
    const dt = (now - S.demoLast) / 1000; S.demoLast = now;
    S.demoT += dt / Math.max(0.5, S.demoPeriod);
    if (S.demoT > 1) S.demoT -= 1;
    syncDemoUI();
    mark();
  }
  if (S.dirty && S.notebook && !$('#editor').classList.contains('hidden')) {
    // Fast path: committed content is warm in the snapshot — blit it and draw
    // only the live stroke (if any). This covers every frame of a pen stroke
    // AND the pen-down/pen-up frames between letters, so writing never pays
    // for a full-page redraw.
    if (inkSnapValid() && !(S.drawing && S.drawing.eraser)) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(inkSnapCanvas, 0, 0);
      if (S.drawing) {
        ctx.setTransform(dpr * S.scale, 0, 0, dpr * S.scale, dpr * S.offsetX, dpr * S.offsetY);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, pgW(), pgH());
        ctx.clip();
        drawStrokePreview(ctx, S.drawing);
        ctx.restore();
        perfFrame();
      }
      S.dirty = false;
      requestAnimationFrame(render);
      return;
    }
    const sceneT = hasScene ? sceneTime() : 0;
    if (hasScene) S.demoT = sceneNormalized();
    const r = cv.getBoundingClientRect();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const present = $('#editor')?.classList.contains('present-mode');
    // app background — cinematic dark letterbox in Present mode
    ctx.fillStyle = present ? '#0b1120' : '#eef1f6';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // camera transform (page units -> device px)
    ctx.setTransform(dpr * S.scale, 0, 0, dpr * S.scale, dpr * S.offsetX, dpr * S.offsetY);
    // page shadow + sheet
    ctx.save();
    ctx.shadowColor = present ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = (present ? 28 : 14) / S.scale;
    ctx.shadowOffsetY = (present ? 10 : 6) / S.scale;
    const pw = pgW(), ph = pgH();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pw, ph);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, pw, ph);
    ctx.clip();
    drawBackground(ctx, page(), pageImage(page()));
    drawFunctions(ctx, page());
    drawTrig(ctx, page());
    drawCalcItems(ctx, page());
    drawObjects(ctx, page(), sceneT);
    drawMechItems(ctx, page());
    drawCplxLoci(ctx, page());
    drawInstruments(ctx, page());
    if (S.creating) drawObject(ctx, S.creating);
    for (const s of visibleStrokes(page())) {
      const prog = strokeReveal(page(), s.id, sceneT);
      if (hasTargetTracks(page(), s.id) && prog <= 0) continue;
      drawStroke(ctx, s, prog);
    }
    const inking = !!(S.drawing && !S.drawing.eraser);
    // Static content is now fully painted (live ink, chrome and laser come
    // after) — snapshot it so following frames can blit. Also capture at rest
    // so the NEXT pen-down starts warm; skip while erasing or mid-gesture.
    if (inking || (!S.drawing && S.touch.size === 0)) captureInkSnapshot();
    if (inking) { drawStrokePreview(ctx, S.drawing); perfFrame(); }
    // selection highlight (hidden while inking so blitted frames match)
    if (S.selection && !inking) {
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
    if (inking) { /* no selection chrome while a stroke is in progress */ }
    else if (S.selObj && objs().includes(S.selObj)) drawSelBox(ctx, objBBox(S.selObj), objHandles(S.selObj));
    else if (selectedMechItem()) {
      const m = selectedMechItem();
      drawSelBox(ctx, mechBBox(m), mechHandles(m));
    }
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
    if (!S.drawing) {
      syncGeoLayer(S.offsetX, S.offsetY, S.scale);
      refreshGraphView();
    }
    // P1: Laser pointer overlay (device-space, unaffected by camera)
    if (S.tool === 'laser' && S.laserPos) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const lx = S.laserPos.x * dpr, ly = S.laserPos.y * dpr;
      // Outer glow ring
      const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, 40 * dpr);
      glow.addColorStop(0, 'rgba(255, 50, 50, 0.4)');
      glow.addColorStop(0.4, 'rgba(255, 50, 50, 0.15)');
      glow.addColorStop(1, 'rgba(255, 50, 50, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(lx, ly, 40 * dpr, 0, Math.PI * 2);
      ctx.fill();
      // Bright inner dot
      ctx.fillStyle = 'rgba(255, 40, 40, 0.95)';
      ctx.beginPath();
      ctx.arc(lx, ly, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
      // White center highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(lx, ly, 1.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    updateDeleteSelBtn();
    if (S.selObj?.kind === 'incline' && S.selObj.anim) {
      const el = $('#mi-angle');
      if (el && document.activeElement !== el) el.value = Math.round(inclineLiveAngle(S.selObj));
    }
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
function clearSelection() {
  S.selection = null; S.lassoPath = null; S.selObj = null; S.selStrokes = [];
  setSelectedMech(null); clearInstSelection(); mark();
}

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
  if (o.kind === 'triangle') return [o.p1, o.p2, o.p3];
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
    const g = inclineGeom(o), SC = o.scale || 1;
    const padL = 70 * SC + 30, padR = 110 * SC, padT = 70 * SC, padB = 60 * SC + 50;
    return { x: g.a.x - padL, y: g.top.y - padT, w: g.B + padL + padR, h: (g.a.y - g.top.y) + padB };
  }
  if (o.kind === 'triangle') {
    const xs = [o.p1.x, o.p2.x, o.p3.x], ys = [o.p1.y, o.p2.y, o.p3.y];
    const x0 = Math.min(...xs) - 60, y0 = Math.min(...ys) - 40;
    return { x: x0, y: y0, w: Math.max(...xs) - x0 + 60, h: Math.max(...ys) - y0 + 60 };
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
    const g = inclineGeom(o), SC = o.scale || 1;
    return [
      { name: 'at', x: g.a.x, y: g.a.y },
      { name: 'apex', x: g.top.x, y: g.top.y },
      { name: 'base', x: g.b.x, y: g.b.y },
      { name: 'scale', x: g.a.x - 70 * SC, y: g.a.y + 50 * SC },   // drag to enlarge the whole diagram
    ];
  }
  if (o.kind === 'triangle')
    return [{ name: 'p1', x: o.p1.x, y: o.p1.y }, { name: 'p2', x: o.p2.x, y: o.p2.y }, { name: 'p3', x: o.p3.x, y: o.p3.y }];
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
    o.anim = false;
    const h = Math.max(20, o.at.y - p.y);
    o.angleDeg = Math.max(5, Math.min(85, Math.atan(h / (o.base || 300)) * 180 / Math.PI));
  }
  else if (name === 'base') {
    o.anim = false;
    o.base = Math.max(120, Math.min(520, p.x - o.at.x));
  }
  else if (name === 'scale') {
    const d = Math.hypot(o.at.x - p.x, p.y - o.at.y);
    o.scale = Math.max(0.5, Math.min(3, d / Math.hypot(70, 50)));
  }
  else if (name === 'p1' || name === 'p2' || name === 'p3') o[name] = sp;
  else if (name === 'at') {
    o.at = o.kind === 'forcevec' ? (nearestInclineAnchor(p, 26 / S.scale) || sp) : sp;
  }
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
    if (!s.points?.length) continue;
    for (let j = 0; j < s.points.length; j++) {
      if (Math.hypot(p.x - s.points[j].x, p.y - s.points[j].y) < hitR) return s;
      if (j > 0 && pointSegDist(p, s.points[j - 1], s.points[j]) < hitR) return s;
    }
  }
  return null;
}
function hasDeletableSelection() {
  return !!(S.selObj || S.selStrokes.length || selectedMechItem() || S.selection?.strokes?.length || S.selection?.objects?.length);
}

function updateDeleteSelBtn() {
  const canDelete = hasDeletableSelection();
  const btn = $('#delete-selection');
  if (btn) btn.classList.toggle('hidden', !canDelete);
  // Floating pill in the canvas — the rail button only exists on the Page tab
  // and iPads have no Delete key, so this is the reachable path on touch.
  const fb = $('#float-delete');
  if (!fb) return;
  fb.classList.toggle('hidden', !canDelete);
  if (!canDelete) return;
  const wrap = fb.parentElement;
  const ww = wrap?.clientWidth || 0, wh = wrap?.clientHeight || 0;
  const bw = fb.offsetWidth || 110, bh = fb.offsetHeight || 44;
  let b = null;
  if (S.selection?.strokes?.length || S.selection?.objects?.length) b = S.selection.bbox;
  else if (S.selObj) b = objBBox(S.selObj);
  else if (S.selStrokes.length) b = strokeBBox(S.selStrokes);
  let x = ww / 2 - bw / 2, y = 14;   // fallback: top-centre (mech selections)
  if (b) {
    const sx = b.x * S.scale + S.offsetX, sy = b.y * S.scale + S.offsetY;
    const sw = b.w * S.scale, sh = b.h * S.scale;
    x = sx + sw / 2 - bw / 2;
    y = sy - bh - 12;
    if (y < 8) y = sy + sh + 12;     // selection touches the top edge → below it
  }
  fb.style.left = `${Math.max(8, Math.min(ww - bw - 8, x))}px`;
  fb.style.top = `${Math.max(8, Math.min(wh - bh - 8, y))}px`;
}

function deleteSelection() {
  if (S.selection?.strokes?.length || S.selection?.objects?.length) {
    beginAction();
    const strokeSet = new Set(S.selection.strokes || []);
    page().strokes = page().strokes.filter((s) => !strokeSet.has(s));
    for (const o of S.selection.objects || []) {
      const i = objs().indexOf(o);
      if (i >= 0) objs().splice(i, 1);
      if (o.kind === 'image') purgeObjImage(o.id);
      if (o.kind === 'graphpt') {
        const pid = o.id;
        page().objects = objs().filter((x) => !(x.kind === 'tangent' && x.ptId === pid));
      }
    }
    clearSelection();
    commitAction();
    mark();
    return;
  }
  if (!S.selObj && !S.selStrokes.length && !selectedMechItem()) return;
  beginAction();
  const mech = selectedMechItem();
  if (mech) {
    deleteMechItem(mech);
    setSelectedMech(null);
    commitAction(); mark();
    return;
  }
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
  const hits = page().strokes.filter((s) => (s.points || []).some((p) => pointInPoly(p, poly)));
  const objHits = page().objects.filter((o) => objectInLasso(o, poly));
  if (hits.length || objHits.length) S.selection = { strokes: hits, objects: objHits, bbox: selectionBBox({ strokes: hits, objects: objHits }) };
  else S.selection = null;
  mark();
}

// ---- on-device ink perf monitor (?perf=1) --------------------------------------
// Overlay showing where pen latency goes, measurable on the iPad itself:
// "deliver" = how long iPadOS/Safari sat on the event before JS saw it (system
// side, not fixable from the app); "down→ink" = our handler-to-paint time.
const perfOn = /[?&]perf/.test(location.search) || localStorage.getItem('mb-perf') === '1';
const perf = { el: null, downDeliver: 0, downPaint: -1, downAt: 0, pendingDown: false,
  moveDeliverMax: 0, gapMax: 0, lastMoveAt: 0, coalSum: 0, coalN: 0,
  frameSum: 0, frameN: 0, frameMax: 0, lastFrameAt: 0 };
function perfHud() {
  if (perf.el) return perf.el;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:70px;right:8px;z-index:99999;background:rgba(0,0,0,0.78);color:#4ade80;font:12px/1.6 ui-monospace,monospace;padding:8px 10px;border-radius:8px;pointer-events:none;white-space:pre';
  document.body.appendChild(d);
  perf.el = d;
  return d;
}
function perfDown(e) {
  if (!perfOn) return;
  const now = performance.now();
  perf.downDeliver = now - e.timeStamp;
  perf.downAt = now; perf.pendingDown = true; perf.downPaint = -1;
  perf.moveDeliverMax = 0; perf.gapMax = 0; perf.lastMoveAt = 0;
  perf.coalSum = 0; perf.coalN = 0;
  perf.frameSum = 0; perf.frameN = 0; perf.frameMax = 0; perf.lastFrameAt = 0;
}
function perfMove(e, nPts) {
  if (!perfOn) return;
  const now = performance.now();
  perf.moveDeliverMax = Math.max(perf.moveDeliverMax, now - e.timeStamp);
  if (perf.lastMoveAt) perf.gapMax = Math.max(perf.gapMax, now - perf.lastMoveAt);
  perf.lastMoveAt = now;
  perf.coalSum += nPts; perf.coalN++;
}
function perfFrame() {
  if (!perfOn) return;
  const now = performance.now();
  if (perf.pendingDown) { perf.downPaint = now - perf.downAt; perf.pendingDown = false; }
  if (perf.lastFrameAt) {
    const dt = now - perf.lastFrameAt;
    perf.frameSum += dt; perf.frameN++;
    if (dt > perf.frameMax) perf.frameMax = dt;
  }
  perf.lastFrameAt = now;
}
function perfReport() {
  if (!perfOn) return;
  perfHud().textContent =
    `deliver: down ${perf.downDeliver.toFixed(0)}ms · move ≤${perf.moveDeliverMax.toFixed(0)}ms\n` +
    `down→ink paint: ${perf.downPaint < 0 ? '—' : perf.downPaint.toFixed(0) + 'ms'}\n` +
    `ink frames: avg ${(perf.frameN ? perf.frameSum / perf.frameN : 0).toFixed(1)} · max ${perf.frameMax.toFixed(1)}ms\n` +
    `move gap ≤${perf.gapMax.toFixed(0)}ms · pts/evt ${(perf.coalN ? perf.coalSum / perf.coalN : 0).toFixed(1)}\n` +
    `dpr ${dpr} · ${cv.width}×${cv.height}`;
}

// ---- pointer input -----------------------------------------------------------
function pressureOf(e) {
  if (e.pointerType === 'pen' && e.pressure > 0) return e.pressure;
  return 0.5;
}

function coalescedPagePoints(e) {
  // getCoalescedEvents can legitimately return an empty list (untrusted events,
  // some browser states) — fall back to the event itself so no sample is lost
  const co = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  const evs = co.length ? co : [e];
  return evs.map((ev) => ({ p: toPage(...cssArr(ev)), pr: pressureOf(ev) }));
}

function appendInkPoints(stroke, points) {
  for (const { p, pr } of points) {
    let pt = p;
    if (['pen', 'highlighter'].includes(stroke.tool)) pt = snapToRuler(pt);
    stroke.points.push({ x: pt.x, y: pt.y, p: pr });
  }
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
  if (S.eraseBefore) {
    page().strokes = S.eraseBefore.strokes;
    page().objects = S.eraseBefore.objects;
    S.eraseBefore = null;
  }
  S.creating = null; S.drawing = null; S.lassoPath = null;
  S.moving = null; S.objMove = null; S.objResize = null;
  S.mechMove = null; S.mechResize = null; S.instDrag = null;
  S.actionBefore = null;
  inkPredicted = [];
  if (typeof S.collabResume === 'function') S.collabResume();
  mark();
}

function onDown(e) {
  if (eqDockOpen()) return;
  // keep iPadOS from running its own gesture recognition on pen input
  if (e.pointerType === 'pen' && e.cancelable) e.preventDefault();
  try { cv.setPointerCapture(e.pointerId); } catch (_) { /* non-fatal */ }
  if (e.pointerType === 'touch') {
    S.touch.set(e.pointerId, cssPt(e));
    setGestureRef();
    if (S.touch.size >= 2) { abortGesture(); return; }  // 2+ fingers = pan/zoom only; cancel any tool action
  }
  // Annotate-to-Animate: ink read-only while docked sim is live (two-finger pan still OK above)
  if (S.annotSimLocked) { mark(); return; }
  // Armed instruments (ruler/protractor/compass) place via canvas taps, but
  // isDrawPointer() is false while one is armed — without the extra clause the
  // early return ate every tap and the tools looked dead on iPad and desktop.
  if (!isDrawPointer(e) && !(e.pointerType === 'touch' && touchToolCanInteract()) && !instToolActive()) { mark(); return; }
  const p = toPage(...cssArr(e));

  if (handleInstClick(p)) return;
  if (handleCplxClick(p)) return;
  if (handleMechClick(p)) return;

  // Apple Pencil eraser end — always erase, any selected tool
  if (e.pointerType === 'eraser') {
    beginEraseAction();
    eraseAt(p);
    S.drawing = { eraser: true };
    return;
  }

  if (S.tool === 'select') {
    const tol = 14 / S.scale;
    setSelectedMech(null);
    clearInstSelection();
    const mech = hitMech(p, tol);
    if (mech) {
      S.selObj = null; S.selStrokes = [];
      setSelectedMech(mech);
      syncPanelFromItem(mech);
      const mh = mechHandleAt(mech, p, tol);
      if (mh) { beginAction(); S.mechResize = mh; mark(); return; }
      beginAction();
      S.mechMove = { lastX: p.x, lastY: p.y };
      mark();
      return;
    }
    if (beginInstMove(p)) {
      S.selObj = null; S.selStrokes = [];
      S.instDrag = true;
      mark();
      return;
    }
    if (S.selObj) {
      const h = handleAt(S.selObj, p);
      if (h) { beginAction(); S.objResize = h; return; }
    }
    const hit = hitObject(p);
    if (hit) {
      S.selStrokes = [];
      setSelectedMech(null);
      S.selObj = hit; beginAction();
      if (hit.kind === 'incline') syncInclineObjectPanel(hit);
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
    S.creating = { kind: S.tool, from: sp, to: sp, color: S.color, ...shapeExtras() };
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
    S.creating = { kind: 'circle', center: sp, edge: sp, color: S.color, ...shapeExtras() };
    mark();
    return;
  }
  if (S.tool === 'eraser') {
    beginEraseAction();
    eraseAt(p);
    S.drawing = { eraser: true };  // flag active erase
    return;
  }
  // pen / highlighter
  beginInkAction();
  perfDown(e);
  const stroke = { id: uid(), tool: S.tool, color: S.color, width: S.width, points: [{ x: p.x, y: p.y, p: pressureOf(e) }] };
  if (S.tool === 'pen') stroke.penType = S.penType;
  S.drawing = stroke;
  markInk();
}

// Safari's predicted Pencil samples for the live stroke tail. Read them
// synchronously in the handler (stale events may return nothing) and cap the
// tail so mispredictions can't visibly overshoot.
function predictedPagePoints(e) {
  if (typeof e.getPredictedEvents !== 'function') return [];
  return e.getPredictedEvents().slice(0, 3).map((ev) => {
    const pt = toPage(...cssArr(ev));
    return ['pen', 'highlighter'].includes(S.drawing?.tool) ? snapToRuler(pt) : pt;
  });
}

// Where pointerrawupdate is supported, the paired pointermove re-delivers the
// same samples through getCoalescedEvents — ink/erase must consume exactly one
// of the two streams or every point lands twice in the stroke.
const HAS_RAW_UPDATE = 'onpointerrawupdate' in window;

// Ink points are appended synchronously in the pointermove handler — deferring
// to rAF both lost coalesced 240 Hz samples (events overwrote each other) and
// added a frame of latency before render() picked the points up.
function processDrawMove(e) {
  if (S.drawing && S.drawing.eraser) {
    for (const { p } of coalescedPagePoints(e)) eraseAt(p);
    return;
  }
  if (S.drawing) {
    const pts = coalescedPagePoints(e);
    appendInkPoints(S.drawing, pts);
    inkPredicted = predictedPagePoints(e);
    perfMove(e, pts.length);
    markInk();
  }
}

function onMove(e) {
  if (e.pointerType === 'touch') {
    if (S.touch.has(e.pointerId)) S.touch.set(e.pointerId, cssPt(e));
    if (S.touch.size > 1) { handleGesture(); return; }
    // Present mode: one finger scrolls the page (GoodNotes-style) whenever the
    // finger isn't mid-interaction — the Pencil stays the writing instrument
    if (S.touch.size === 1 && !S.drawing && !S.moving && !S.objMove && !S.objResize &&
        !S.mechMove && !S.mechResize && !S.instDrag && !S.creating && !S.lassoPath &&
        $('#editor')?.classList.contains('present-mode')) {
      handleGesture();
      return;
    }
    if (!S.fingerDraw && !touchToolCanInteract()) return;
  }
  if (S.objResize) { applyHandle(S.selObj, S.objResize, toPage(...cssArr(e))); mark(); return; }
  if (S.mechResize && selectedMechItem()) {
    applyMechHandle(selectedMechItem(), S.mechResize, toPage(...cssArr(e)));
    mark(); return;
  }
  if (S.mechMove && selectedMechItem()) {
    const p = toPage(...cssArr(e));
    moveMechItem(selectedMechItem(), p.x - S.mechMove.lastX, p.y - S.mechMove.lastY);
    S.mechMove.lastX = p.x; S.mechMove.lastY = p.y;
    mark(); return;
  }
  if (S.instDrag) {
    moveInst(toPage(...cssArr(e)));
    mark(); return;
  }
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
  // P1: Laser pointer — track position in device coordinates
  if (S.tool === 'laser') {
    S.laserPos = cssPt(e);
    mark();
    return;
  }
  if (S.drawing) {
    if (HAS_RAW_UPDATE && e.type === 'pointermove') return;   // rawupdate already appended these samples
    processDrawMove(e);
    return;
  }
}

function onUp(e) {
  if (e.pointerType === 'touch') {
    S.touch.delete(e.pointerId);
    setGestureRef();
  }
  if (S.objResize) {
    S.objResize = null;
    if (S.selObj?.kind === 'incline') syncInclineObjectPanel(S.selObj);
    commitAction(); mark(); return;
  }
  if (S.mechResize) { S.mechResize = null; commitAction(); mark(); return; }
  if (S.mechMove) { S.mechMove = null; commitAction(); mark(); return; }
  if (S.instDrag) { endInstMove(); S.instDrag = null; mark(); return; }
  if (S.objMove) { S.objMove = null; commitAction(); mark(); return; }
  if (S.moving) { S.moving = null; commitAction(); return; }
  if (S.lassoPath) { finishLasso(); return; }
  if (S.creating) {
    const o = S.creating;
    let ok = true;
    if (o.kind === 'circle') ok = Math.hypot(o.edge.x - o.center.x, o.edge.y - o.center.y) > 6;
    else if (o.from && o.to) ok = Math.hypot(o.to.x - o.from.x, o.to.y - o.from.y) > 4;   // vector/line/rect/ellipse
    // complex (a single point) always commits
    if (ok) { objs().push(o); recordObject(o); }
    S.creating = null; commitAction(); mark(); return;
  }
  if (S.drawing && S.drawing.eraser) {
    S.drawing = null;
    const before = S.eraseBefore;
    S.eraseBefore = null;
    if (before && eraseDidChange) {
      S.undo.push({ kind: 'arrays', strokes: before.strokes, objects: before.objects });
      if (S.undo.length > UNDO_CAP) S.undo.shift();
      S.redo = [];
      thumbCache.delete(page().id);
      persist();
      collabNotifyEdit();
    }
    if (typeof S.collabResume === 'function') S.collabResume();
    return;
  }
  if (S.drawing) {
    const stroke = S.drawing;
    S.drawing = null;
    inkPredicted = [];
    if (stroke.points.length) {
      page().strokes.push(stroke);
      recordStroke(stroke);
      S.undo.push({ kind: 'stroke', id: stroke.id });
      if (S.undo.length > UNDO_CAP) S.undo.shift();
      S.redo = [];
      thumbCache.delete(page().id);
      // final perfect-freehand ink goes straight into the warm snapshot, so
      // the repaint (and the next pen-down) is a blit, not a full redraw
      stampStrokeIntoSnapshot(stroke);
      persist();
      collabNotifyEdit();
    }
    if (typeof S.collabResume === 'function') S.collabResume();
    perfReport();
    markInk();
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
    .map((pts) => ({ id: s.id, tool: s.tool, penType: s.penType, color: s.color, width: s.width, points: pts }));
}
function eraseAt(p) {
  const r = (S.width + 14);
  const next = [];
  let changed = false;
  for (const s of page().strokes) {
    if (!strokeEraseHit(s, p, r)) next.push(s);
    else { changed = true; next.push(...splitStrokeAtErase(s, r, p)); }
  }
  if (changed) page().strokes = next;
  const objBefore = objs().length;
  const nextObjs = objs().filter((o) => {
    if (!objHit(o, p, r)) return true;
    if (o.kind === 'image') purgeObjImage(o.id);
    return false;
  });
  if (nextObjs.length !== objBefore) { page().objects = nextObjs; changed = true; }
  if (changed) { eraseDidChange = true; mark(); }
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
  if (o.kind === 'triangle') {
    return pointSegDist(p, o.p1, o.p2) < r + 4 || pointSegDist(p, o.p2, o.p3) < r + 4 || pointSegDist(p, o.p3, o.p1) < r + 4;
  }
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
  // Release focus explicitly — a hidden-but-focused textarea keeps the iPad
  // system keyboard on screen. Re-entry via the blur listener is safe:
  // textTarget is already null. (No-op when the commit came from blur itself.)
  ta.blur();
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
let eqField = null;
let eqSymbolsBuilt = false;

const EQ_SYMBOL_GROUPS = [
  { label: 'Basic', items: [
    ['\\frac{#@}{#0}', 'a/b'], ['\\sqrt{#0}', '√'], ['#@^{#?}', 'xⁿ'], ['#@_{#?}', 'xₙ'],
    ['\\left(#0\\right)', '( )'], ['\\left|#0\\right|', '|x|'], ['\\pm', '±'], ['\\cdot', '·'],
    ['\\times', '×'], ['\\div', '÷'], ['=', '='],
  ]},
  { label: 'Calculus', items: [
    ['\\int', '∫'], ['\\int_{#?}^{#?}', '∫ₐᵇ'], ['\\frac{d}{dx}', 'd/dx'],
    ['\\frac{\\partial}{\\partial x}', '∂/∂x'], ['\\lim_{#?}', 'lim'], ['\\sum_{#?}^{#?}', 'Σ'],
    ['\\infty', '∞'], ['\\Delta', 'Δ'], ['\\delta', 'δ'],
  ]},
  { label: 'Trig', items: [
    ['\\sin', 'sin'], ['\\cos', 'cos'], ['\\tan', 'tan'], ['\\cot', 'cot'],
    ['\\sec', 'sec'], ['\\csc', 'csc'], ['\\sin^{-1}', 'sin⁻¹'], ['\\cos^{-1}', 'cos⁻¹'],
    ['\\tan^{-1}', 'tan⁻¹'], ['\\theta', 'θ'], ['\\pi', 'π'],
  ]},
  { label: 'Relations', items: [
    ['\\leq', '≤'], ['\\geq', '≥'], ['\\neq', '≠'], ['\\approx', '≈'],
    ['\\equiv', '≡'], ['\\Rightarrow', '⇒'], ['\\Leftrightarrow', '⇔'], ['\\therefore', '∴'],
  ]},
  { label: 'Sets & logic', items: [
    ['\\in', '∈'], ['\\notin', '∉'], ['\\subset', '⊂'], ['\\subseteq', '⊆'],
    ['\\cup', '∪'], ['\\cap', '∩'], ['\\emptyset', '∅'], ['\\forall', '∀'], ['\\exists', '∃'],
    ['\\mathbb{R}', 'ℝ'], ['\\mathbb{N}', 'ℕ'], ['\\mathbb{Z}', 'ℤ'], ['\\mathbb{Q}', 'ℚ'],
  ]},
  { label: 'Greek', items: [
    ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\lambda', 'λ'], ['\\mu', 'μ'],
    ['\\sigma', 'σ'], ['\\phi', 'φ'], ['\\omega', 'ω'], ['\\epsilon', 'ε'], ['\\rho', 'ρ'],
  ]},
  { label: 'Structures', items: [
    ['\\begin{pmatrix}#0 & #1 \\\\ #2 & #3\\end{pmatrix}', '2×2'],
    ['\\begin{cases}#0 \\\\ #1\\end{cases}', 'cases'],
    ['\\vec{#0}', 'vector'], ['\\overline{#0}', 'x̄'], ['\\hat{#0}', 'x̂'],
    ['\\log', 'log'], ['\\ln', 'ln'], ['e^{#0}', 'eˣ'],
  ]},
];

function eqDockOpen() { return !$('#eq-dock')?.classList.contains('hidden'); }

function mathVirtualKeyboard() { return window.mathVirtualKeyboard; }

const coarsePointer = () => window.matchMedia?.('(pointer: coarse)')?.matches ?? false;

function mathKeyboardEl() {
  const vk = mathVirtualKeyboard();
  const container = document.querySelector('body > .ML__keyboard') || document.querySelector('.ML__keyboard');
  if (!container) return null;
  if (!(vk?.visible || container.classList.contains('is-visible'))) return null;
  // The .ML__keyboard container is a full-viewport fixed layer (top 0, height
  // 100%); the visible keys live in .MLK__backdrop. Measuring the container
  // put the Done/Hide dock at the top of the screen and squashed the calc.
  return container.querySelector('.MLK__backdrop') || container;
}

function showMathKeyboard() {
  const vk = mathVirtualKeyboard();
  if (!vk) return;
  try {
    vk.layouts = ['numeric', 'symbols', 'alphabetic', 'greek'];
    vk.show({ animate: true });
  } catch (_) {
    try { eqField?.executeCommand?.('showVirtualKeyboard'); } catch (e2) { /* non-fatal */ }
  }
  scheduleCalcKeyboardSync();
}

function hideMathKeyboard() {
  // MathLive silently ignores hide() while a math-field still has focus, which
  // left the keyboard (and the calculator's compact vk mode) stuck open — blur first.
  const ae = document.activeElement;
  if (ae?.tagName === 'MATH-FIELD') { try { ae.blur(); } catch (_) {} }
  try { mathVirtualKeyboard()?.hide?.({ animate: true }); } catch (_) {}
  setTimeout(() => {
    const vk = mathVirtualKeyboard();
    if (vk?.visible) {
      const ae2 = document.activeElement;
      if (ae2?.tagName === 'MATH-FIELD') { try { ae2.blur(); } catch (_) {} }
      try { vk.hide({ animate: false }); } catch (_) {}
    }
    scheduleCalcKeyboardSync();
  }, 250);
  scheduleCalcKeyboardSync();
}

// iPad: focusing a math-field makes iOS pan the page toward its hidden input;
// every fixed layer (MathLive keyboard, docks, calc) then draws lower than its
// touch targets and taps land one key row off. The editor never scrolls, so
// pin the page back whenever the math keyboard is up.
function pinViewportForMathKeyboard() {
  if (!mathKeyboardEl()) return;
  if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
}
window.visualViewport?.addEventListener('scroll', pinViewportForMathKeyboard);
window.visualViewport?.addEventListener('resize', pinViewportForMathKeyboard);
window.addEventListener('scroll', pinViewportForMathKeyboard, { passive: true });

// Lift calculator + pin a fixed Done bar directly above the MathLive keyboard.
let calcKbdSyncT = 0;
let calcKbdPoll = 0;
function scheduleCalcKeyboardSync() {
  clearTimeout(calcKbdSyncT);
  requestAnimationFrame(syncCalcAboveKeyboard);
  calcKbdSyncT = setTimeout(syncCalcAboveKeyboard, 80);
  setTimeout(syncCalcAboveKeyboard, 200);
  setTimeout(syncCalcAboveKeyboard, 450);
  setTimeout(syncCalcAboveKeyboard, 700);
}
function startCalcKbdPoll() {
  stopCalcKbdPoll();
  calcKbdPoll = setInterval(syncCalcAboveKeyboard, 250);
}
function stopCalcKbdPoll() {
  clearInterval(calcKbdPoll);
  calcKbdPoll = 0;
}
// The equation dock is pinned to bottom:0 but the MathLive keyboard plate
// (z-index 10050) slides over it — the math-field was fully covered and you
// typed blind. Ride the dock on top of the keyboard instead.
function syncEqDockAboveKeyboard() {
  const dock = $('#eq-dock');
  if (!dock) return;
  const kbd = !dock.classList.contains('hidden') && mathKeyboardEl();
  if (kbd) {
    const kr = kbd.getBoundingClientRect();
    const kbdTop = Math.max(120, Math.min(kr.top, window.innerHeight));
    dock.style.bottom = `${Math.max(0, Math.ceil(window.innerHeight - kbdTop))}px`;
    dock.classList.add('eq-kbd-open');
  } else {
    dock.style.bottom = '';
    dock.classList.remove('eq-kbd-open');
  }
}
function syncCalcAboveKeyboard() {
  pinViewportForMathKeyboard();
  syncEqDockAboveKeyboard();
  const calc = $('#calc');
  const dock = $('#calc-vk-dock');
  const calcOpen = calc && !calc.classList.contains('hidden');
  const kbd = mathKeyboardEl();
  if (calcOpen && kbd) {
    const kr = kbd.getBoundingClientRect();
    // Clamp: never let the dock ride above the status bar or below the screen
    // (the plate animates in from the bottom, so early reads can be odd).
    const kbdTop = Math.max(120, Math.min(kr.top, window.innerHeight));
    const dockH = dock?.offsetHeight || 64;
    calc.classList.add('calc-vk-active', 'calc-kbd-open');
    calc.style.position = 'fixed';
    calc.style.left = 'auto';
    calc.style.right = 'max(8px, env(safe-area-inset-right))';
    calc.style.top = 'max(56px, env(safe-area-inset-top))';
    calc.style.bottom = 'auto';
    const maxH = Math.max(160, kbdTop - dockH - 20 - parseFloat(getComputedStyle(calc).top || 56));
    calc.style.maxHeight = `${maxH}px`;
    if (dock) {
      dock.classList.remove('hidden');
      dock.style.bottom = `${Math.ceil(window.innerHeight - kbdTop)}px`;
    }
    return;
  }
  calc?.classList.remove('calc-vk-active', 'calc-kbd-open');
  calc?.style.removeProperty('max-height');
  dock?.classList.add('hidden');
  if (calc && !calc.dataset.dragged) applyCalcDefaultPosition();
}
function applyCalcDefaultPosition() {
  const calc = $('#calc');
  if (!calc || calc.dataset.dragged) return;
  const present = $('#editor')?.classList.contains('present-mode');
  calc.style.position = 'fixed';
  calc.style.left = 'auto';
  calc.style.right = present ? 'max(12px, env(safe-area-inset-right))' : '20px';
  if (present) {
    calc.style.top = 'max(72px, env(safe-area-inset-top))';
    calc.style.bottom = 'auto';
  } else {
    calc.style.top = 'auto';
    calc.style.bottom = '20px';
  }
}
function calcVkDone() {
  calcEvaluate();
  hideMathKeyboard();
  calcExprEl()?.blur?.();
}

function configureMathLive() {
  const MF = window.MathfieldElement;
  if (!MF) return;
  try { MF.fontsDirectory = './vendor/fonts/'; } catch (_) {}
}

function buildEqSymbols() {
  if (eqSymbolsBuilt) return;
  const wrap = $('#eq-symbols');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const grp of EQ_SYMBOL_GROUPS) {
    const g = document.createElement('div');
    g.className = 'eq-sym-group';
    const lab = document.createElement('div');
    lab.className = 'eq-sym-label';
    lab.textContent = grp.label;
    g.appendChild(lab);
    const row = document.createElement('div');
    row.className = 'eq-sym-row';
    for (const [latex, label] of grp.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'eq-snippet';
      b.textContent = label;
      b.title = latex;
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => insertEqSnippet(latex);
      row.appendChild(b);
    }
    g.appendChild(row);
    wrap.appendChild(g);
  }
  eqSymbolsBuilt = true;
}

function setupEqEditor() {
  configureMathLive();
  buildEqSymbols();
  eqField = $('#eq-editor-field');
  if (!eqField) return;
  try {
    eqField.smartMode = false;
    eqField.smartFence = true;
    eqField.mathVirtualKeyboardPolicy = 'manual';
  } catch (_) {}
  eqField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEquationEditor(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEquationEditor(); }
    e.stopPropagation();
  });
  // Do not commit on blur — iPad taps the virtual keyboard and would close the editor.
  eqField.addEventListener('focusin', () => showMathKeyboard());
  // Track keyboard plate height changes (layer switches, rotation) so the dock
  // stays glued above it; older MathLive builds without the event fall back to
  // the interval poll started in openEquationEditor.
  try { mathVirtualKeyboard()?.addEventListener?.('geometrychange', scheduleCalcKeyboardSync); } catch (_) {}
  window.addEventListener('orientationchange', scheduleCalcKeyboardSync);
  $('#eq-done')?.addEventListener('click', commitEquationEditor);
  $('#eq-cancel')?.addEventListener('click', cancelEquationEditor);
  $('#eq-kbd-toggle')?.addEventListener('click', () => {
    eqField?.focus({ preventScroll: true });
    const vk = mathVirtualKeyboard();
    if (vk?.visible) vk.hide({ animate: true });
    else showMathKeyboard();
  });
}

function insertEqSnippet(latex) {
  if (!eqField) return;
  try {
    if (typeof eqField.executeCommand === 'function') eqField.executeCommand(['insert', latex]);
    else eqField.value = (eqField.value || '') + latex;
  } catch (_) { eqField.value = (eqField.value || '') + latex; }
  eqField.focus({ preventScroll: true });
  showMathKeyboard();
}

function openEquationEditor(o) {
  if (!eqField) setupEqEditor();
  eqTarget = o;
  S.editingId = o.id;
  $('#eq-dock')?.classList.remove('hidden');
  startCalcKbdPoll();
  eqField.value = o.latex || '';
  mark();
  requestAnimationFrame(() => {
    eqField?.setValue?.(o.latex || '');
    eqField?.focus({ preventScroll: true });
    showMathKeyboard();
  });
}

function eqDockClosed() {
  // The poll is shared with the calculator — keep it if the calc is still open.
  if ($('#calc')?.classList.contains('hidden') !== false) stopCalcKbdPoll();
}
function commitEquationEditor() {
  if (!eqTarget || !eqField) return;
  hideMathKeyboard();
  eqDockClosed();
  const latex = eqField.value || '';
  eqTarget.latex = latex;
  if (!latex.trim()) {
    const i = objs().indexOf(eqTarget);
    if (i >= 0) objs().splice(i, 1);
  }
  S.editingId = null;
  eqTarget = null;
  $('#eq-dock')?.classList.add('hidden');
  eqRenderCache = new Map();
  commitAction();
  persist();
  mark();
}

function cancelEquationEditor() {
  if (!eqTarget) return;
  hideMathKeyboard();
  eqDockClosed();
  if (!eqTarget.latex || !eqTarget.latex.trim()) {
    const i = objs().indexOf(eqTarget);
    if (i >= 0) objs().splice(i, 1);
  }
  S.editingId = null;
  eqTarget = null;
  $('#eq-dock')?.classList.add('hidden');
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
    if ($('#editor')?.classList.contains('present-mode')) {
      const b = presentCamBounds();
      S.offsetX = Math.max(b.minX, Math.min(b.maxX, S.offsetX));
      S.offsetY = Math.max(b.minY, Math.min(b.maxY, S.offsetY));
    }
    mark();
  } else if (S.gref.mode === 1 && pts.length === 1) {
    if ($('#editor')?.classList.contains('present-mode')) {
      const last = S.gref.last || S.gref.start;
      presentScrollBy(last.x - pts[0].x, last.y - pts[0].y);
      S.gref.last = { ...pts[0] };
    } else {
      S.offsetX = S.gref.offX + (pts[0].x - S.gref.start.x);
      S.offsetY = S.gref.offY + (pts[0].y - S.gref.start.y);
    }
    mark();
  }
}

// trackpad / wheel zoom on desktop
function onWheel(e) {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  const pageX = (cx - S.offsetX) / S.scale, pageY = (cy - S.offsetY) / S.scale;
  const present = $('#editor')?.classList.contains('present-mode');
  if (e.ctrlKey || e.metaKey) {
    const ns = Math.max(0.08, Math.min(8, S.scale * (1 - e.deltaY * 0.01)));
    S.scale = ns;
    S.offsetX = cx - pageX * ns; S.offsetY = cy - pageY * ns;
    if (present) {
      const b = presentCamBounds();
      S.offsetX = Math.max(b.minX, Math.min(b.maxX, S.offsetX));
      S.offsetY = Math.max(b.minY, Math.min(b.maxY, S.offsetY));
    }
  } else if (present) {
    presentScrollBy(e.deltaX, e.deltaY);
    return;
  } else {
    S.offsetX -= e.deltaX; S.offsetY -= e.deltaY;
  }
  mark();
}

// ---- export ------------------------------------------------------------------
function renderPageToCanvas(pg, sf = 2) {
  const pw = pageW(pg), ph = pageH(pg);
  const oc = document.createElement('canvas');
  oc.width = pw * sf; oc.height = ph * sf;
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
    if (i > 0) pdf.addPage(pageW(pg) > pageH(pg) ? 'landscape' : 'portrait', 'pt', 'a4');
    // JPEG (not PNG): gridded/paper pages compress ~50x smaller as JPEG with no
    // visible loss of ink crispness at 2x. Pages already paint a white background
    // in drawPageContent, so JPEG won't turn transparent areas black.
    pdf.addImage(oc.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H);
  }
  pdf.save(`${S.notebook.title}.pdf`);
}
async function importJsonAsNotebook(file) {
  try {
    busy(true, 'Importing lesson…');
    const nb = await importNotebookFromFile(file);
    setLibTab(notebookKind(nb));
    const ok = await openNotebook(nb.id);
    if (!ok) throw new Error('Imported lesson could not be opened.');
    renderLibrary();
  } catch (e) { alert('Could not import lesson: ' + (e?.message || e)); }
  finally { busy(false); }
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
    img.onload = async () => {
      try {
        const usePng = file.type === 'image/png' || file.type === 'image/gif';
        const data = imageDataUrl(img, usePng);
        const blobId = await storeDataUrl(data);
        const maxW = 480, maxH = 400;
        let w = img.width, h = img.height;
        const fit = Math.min(maxW / w, maxH / h, 1);
        w = Math.round(w * fit); h = Math.round(h * fit);
        const x = (pgW() - w) / 2, y = (pgH() - h) / 2;
        beginAction();
        const o = { id: uid(), kind: 'image', from: { x, y }, to: { x: x + w, y: y + h }, blobId };
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
async function placeImageFromCanvas(canvas) {
  if (!canvas) { alert('Run an analysis first to create a chart.'); return; }
  let data;
  try { data = canvas.toDataURL('image/png'); } catch (_) { alert('Could not capture the chart.'); return; }
  const blobId = await storeDataUrl(data);
  const w = Math.min(420, canvas.width || 320);
  const h = Math.round(w * (canvas.height || 200) / (canvas.width || 320));
  const x = (pgW() - w) / 2, y = (pgH() - h) / 2;
  beginAction();
  const o = { id: uid(), kind: 'image', from: { x, y }, to: { x: x + w, y: y + h }, blobId };
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

// ---- in-app dialogs ---------------------------------------------------------
// iOS Home-Screen PWAs suppress native alert()/confirm()/prompt(), so on iPad
// those calls silently no-op — which is why Delete/Rename appeared "disabled".
// These touch-friendly modals replace them and work everywhere.
function mbModal({ title, message, fields = [], okText = 'OK', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'sync-dialog mb-modal';
    const inputs = fields.map((f, i) =>
      `<input class="ct-in mb-modal-input" data-i="${i}" type="text" value="${escapeHtml(f.value || '')}" placeholder="${escapeHtml(f.placeholder || '')}" />`
    ).join('');
    back.innerHTML = `<div class="sync-box" role="dialog" aria-modal="true">
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      ${message ? `<p class="mb-modal-msg">${escapeHtml(message)}</p>` : ''}
      ${inputs}
      <div class="sync-btns">
        <button type="button" class="${danger ? 'danger' : 'primary'} mb-ok">${escapeHtml(okText)}</button>
        ${cancelText ? `<button type="button" class="ghost mb-cancel">${escapeHtml(cancelText)}</button>` : ''}
      </div>
    </div>`;
    document.body.appendChild(back);
    const close = (val) => { back.remove(); resolve(val); };
    const inEls = [...back.querySelectorAll('.mb-modal-input')];
    back.querySelector('.mb-ok').onclick = () =>
      close(fields.length ? inEls.map((el) => el.value) : true);
    back.querySelector('.mb-cancel')?.addEventListener('click', () => close(fields.length ? null : false));
    back.addEventListener('click', (e) => { if (e.target === back) close(fields.length ? null : false); });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (fields.length <= 1)) back.querySelector('.mb-ok').click();
      if (e.key === 'Escape') back.querySelector('.mb-cancel')?.click();
    });
    (inEls[0] || back.querySelector('.mb-ok')).focus();
    inEls[0]?.select?.();
  });
}
async function mbConfirm(message, { okText = 'OK', danger = false, title = '' } = {}) {
  return mbModal({ title, message, okText, danger });
}
async function mbPrompt(message, value = '', { okText = 'Save', title = '' } = {}) {
  const r = await mbModal({ title, message, fields: [{ value }], okText });
  return r ? r[0].trim() : null;
}
let toastTimer = null;
function mbToast(message) {
  let el = $('#mb-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mb-toast';
    el.className = 'mb-toast';
    document.body.appendChild(el);
  }
  el.textContent = String(message);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
}
// Route native alert() through the toast so error feedback is visible on iPad.
window.alert = (m) => mbToast(m);
function withTimeout(promise, ms, label) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + ' timed out')), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}
function ensurePdfJs(maxMs = 8000) {
  if (window.pdfjsLib) {
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
    }
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (window.pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
        resolve();
        return;
      }
      if (Date.now() - t0 > maxMs) {
        reject(new Error('PDF engine not loaded — hard refresh the page (Cmd+Shift+R).'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
async function renderPdfToPages(arrayBuffer) {
  await ensurePdfJs();
  if (!window.pdfjsLib) throw new Error('PDF engine not loaded — hard refresh and try again.');
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  }
  assertPdfImportSize(arrayBuffer.byteLength);
  const pdf = await withTimeout(pdfjsLib.getDocument({ data: arrayBuffer }).promise, 20000, 'Opening PDF');
  const n = pdf.numPages;
  if (pdfImportNeedsConfirm(arrayBuffer.byteLength, n)) {
    const mb = (arrayBuffer.byteLength / 1e6).toFixed(1);
    if (!await mbConfirm(`This PDF is ${mb} MB with ${n} pages. Pages render as you view them (notebook stays small). Continue?`, { okText: 'Continue', title: 'Import PDF' })) {
      throw new Error('Import cancelled.');
    }
  }
  return buildLazyPdfPages(arrayBuffer, pdf, (i, total) => {
    busy(true, `Preparing PDF — page ${i} of ${total}…`);
  });
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
    await sync.push(nb);
    busy(false);
    setLibTab('paper');
    await openNotebookData(nb);
    renderLibrary();
  } catch (e) { busy(false); alert('Could not import PDF: ' + e.message); }
}

// ---- UI: library <-> editor --------------------------------------------------
let libTab = 'lesson';
let libSearch = '';

function updateSyncStatus(s) {
  const el = $('#sync-status');
  if (!el) return;
  const labels = {
    saved: '● Saved', exported: '● Exported', imported: '● Imported', shared: '● Shared',
    synced: '● Synced', 'synced-all': '● Synced all', pulled: '● Pulled', merged: '● Synced',
    configured: '● Cloud ready', 'sync-error': '● Sync failed',
  };
  el.textContent = labels[s.state] || (getSyncBaseUrl() && isSignedIn() ? '● Cloud' : (getSupabaseUrl() ? '● Cloud ready' : '● Local'));
  el.title = s.error || (getSyncBaseUrl() ? `Cloud: ${getSyncBaseUrl()} · click to open` : 'Offline · saved on this device · click to sync');
  el.style.cursor = 'pointer';
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
  head.classList.toggle('lib-course', t === 'course');
  const search = $('#lib-search');
  if (search) search.placeholder = t === 'course'
    ? 'Search course examples…' : 'Search lessons and text…';
  document.querySelectorAll('.lib-tab').forEach((b) => b.classList.toggle('active', b.dataset.lib === t));
  renderLibrary();
}

function notebookCardThumb(nb) {
  const pg = allPages(nb)[0];
  if (!pg) return '<div class="nb-thumb"></div>';
  if (pageIsPdf(pg)) {
    const src = pg.background.data || cachedMediaUrl(pg.background.blobId) || '';
    return `<div class="nb-thumb">${src ? `<img src="${src}" alt="" />` : '<span class="nb-pdf-tag">PDF</span>'}</div>`;
  }
  return `<div class="nb-thumb"><img class="nb-thumb-blank" src="${makePageThumbUrl(pg)}" alt="" /></div>`;
}

let libRenderSeq = 0;
async function renderLibrary() {
  const seq = ++libRenderSeq;
  const list = $('#nb-list');
  $('#rag-search')?.classList.toggle('hidden', libTab !== 'course');
  if (libTab === 'course') { await renderCourseTab(list); return; }
  const nbs = filterNotebooksBySearch(
    (await getAllNotebooks()).filter((nb) => notebookKind(nb) === libTab),
    libSearch,
  ).sort((a, b) => b.updated - a.updated);
  // Overlapping renders (startup + cloud merge) must not append twice —
  // duplicate cards of the same lesson made Delete look like it removed two.
  if (seq !== libRenderSeq) return;
  list.innerHTML = '';
  if (!nbs.length) {
    const msg = libSearch
      ? 'No notebooks match your search.'
      : libTab === 'paper'
        ? 'Import a PDF past paper to annotate exam questions with pen, highlights, and vectors.'
        : 'Create your first blank lesson — draw, animate scenes, and present in class.';
    const cta = libSearch ? '' : libTab === 'paper'
      ? '<button type="button" class="primary" id="lib-empty-import">Import PDF</button>'
      : '<button type="button" class="primary" id="lib-empty-new">+ New lesson</button>';
    list.innerHTML = `<div class="lib-empty-state"><div class="lib-empty-icon">${libTab === 'paper' ? '📄' : '📝'}</div><h2>${libSearch ? 'No results' : libTab === 'paper' ? 'Past papers' : 'Your lessons'}</h2><p class="muted">${msg}</p>${cta}</div>`;
    $('#lib-empty-new')?.addEventListener('click', () => createNotebook());
    $('#lib-empty-import')?.addEventListener('click', () => $('#pdf-file-lib')?.click());
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
          <button class="cat">${isCatalogued(nb) ? '★ Catalogued' : '☆ Add to Course'}</button>
          <button class="exp">Export</button>
          <button class="ren">Rename</button>
          <button class="del danger">Delete</button>
        </div>
      </div>`;
    card.querySelector('.open').onclick = () => openNotebook(nb.id);
    // Tapping the cover/title opens the lesson too (GoodNotes-style) — on iPad
    // users tap the notebook, not the small button.
    card.querySelector('.nb-thumb')?.addEventListener('click', () => openNotebook(nb.id));
    card.querySelector('.nb-title')?.addEventListener('click', () => openNotebook(nb.id));
    card.querySelector('.cat').onclick = () => catalogNotebook(nb);
    card.querySelector('.exp').onclick = () => exportNotebookJSON(nb).catch((e) => alert(e.message));
    card.querySelector('.ren').onclick = async () => {
      const t = await mbPrompt('Rename lesson', nb.title, { title: 'Rename' });
      if (t) { nb.title = t; nb.updated = Date.now(); await sync.push(nb); renderLibrary(); }
    };
    card.querySelector('.del').onclick = async () => {
      if (await mbConfirm(`Delete "${nb.title}"? This cannot be undone.`, { okText: 'Delete', danger: true, title: 'Delete lesson' })) {
        await sync.remove(nb.id); renderLibrary();
      }
    };
    list.appendChild(card);
  }
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- Course Library tab ------------------------------------------------------
let courseTaxonomy = null;
async function ensureTaxonomy() {
  if (!courseTaxonomy) courseTaxonomy = await loadTaxonomy();
  return courseTaxonomy;
}

let ragSearchReady = false;
async function renderCourseTab(list) {
  if (!ragSearchReady) {
    ragSearchReady = true;
    setupRagSearch($('#rag-search'), {
      onOpenShelf: (course, topic) => expandCoursePath(list, course, topic),
      onOpenPaper: (file) => openPaperFile(file),
    });
  }
  list.innerHTML = '<div class="lib-skeleton"><div class="skel-card"></div><div class="skel-card"></div><div class="skel-card"></div></div>';
  const tax = await ensureTaxonomy();
  const notebooks = await getAllNotebooks();
  renderCourseLibrary(list, {
    notebooks,
    taxonomy: tax,
    search: libSearch,
    thumb: (nb) => `<div class="example-thumb">${notebookCardThumb(nb)}</div>`,
    onOpen: (id) => openNotebook(id, { present: true, play: true }),
  });
}

// File a notebook into Course → Topic → Exercise (with simple datalist autocomplete).
async function catalogNotebook(nb) {
  const tax = await ensureTaxonomy();
  const existing = notebookCatalog(nb) || {};
  const courses = taxonomyCourses(tax);
  const r = await mbCatalogDialog({
    course: existing.course || courses[0] || '',
    topic: existing.topic || '',
    exercise: existing.exercise || '',
    courses,
    tax,
  });
  if (!r) return;
  const course = r.course.trim();
  if (!course) { mbToast('Course name is required'); return; }
  nb.catalog = {
    course,
    topic: r.topic.trim() || 'General',
    exercise: r.exercise.trim() || 'Examples',
    order: Number.isFinite(nb.catalog?.order) ? nb.catalog.order : Date.now(),
  };
  nb.updated = Date.now();
  await sync.push(nb);
  mbToast(`Filed under ${nb.catalog.course} › ${nb.catalog.topic}`);
  renderLibrary();
}

// Catalog dialog: 3 linked inputs with <datalist> suggestions from the taxonomy.
function mbCatalogDialog({ course, topic, exercise, courses, tax }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'sync-dialog mb-modal';
    // iOS Safari ignores <datalist> — plain text inputs still work on touch.
    const useList = !window.matchMedia?.('(pointer: coarse)').matches;
    const list = (id) => (useList ? ` list="${id}"` : '');
    const opts = (arr) => arr.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('');
    back.innerHTML = `<div class="sync-box cat-box" role="dialog" aria-modal="true">
      <h3>Add to Course Library</h3>
      <p class="mb-modal-msg">File this animated example so students can find it by course, topic and exercise.</p>
      <label class="cat-lbl">Course
        <input class="ct-in cat-course"${list('cat-courses')} value="${escapeHtml(course)}" placeholder="e.g. Mechanics" maxlength="120" />
      </label>
      ${useList ? `<datalist id="cat-courses">${opts(courses)}</datalist>` : ''}
      <label class="cat-lbl">Topic
        <input class="ct-in cat-topic"${list('cat-topics')} value="${escapeHtml(topic)}" placeholder="e.g. Projectiles" maxlength="120" />
      </label>
      ${useList ? '<datalist id="cat-topics"></datalist>' : ''}
      <label class="cat-lbl">Exercise
        <input class="ct-in cat-exercise"${list('cat-exercises')} value="${escapeHtml(exercise)}" placeholder="e.g. Projection at an angle" maxlength="160" />
      </label>
      ${useList ? '<datalist id="cat-exercises"></datalist>' : ''}
      <div class="sync-btns">
        <button type="button" class="primary mb-ok">Save</button>
        <button type="button" class="ghost mb-cancel">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(back);
    const cIn = back.querySelector('.cat-course');
    const tIn = back.querySelector('.cat-topic');
    const eIn = back.querySelector('.cat-exercise');
    const tList = back.querySelector('#cat-topics');
    const eList = back.querySelector('#cat-exercises');
    const fillTopics = () => {
      if (!tList) return;
      tList.innerHTML = taxonomyTopics(tax, cIn.value.trim()).map((v) => `<option value="${escapeHtml(v)}"></option>`).join('');
    };
    const fillExercises = () => {
      if (!eList) return;
      eList.innerHTML = taxonomyExercises(tax, cIn.value.trim(), tIn.value.trim()).map((v) => `<option value="${escapeHtml(v)}"></option>`).join('');
    };
    cIn.addEventListener('input', () => { fillTopics(); fillExercises(); });
    tIn.addEventListener('input', fillExercises);
    fillTopics(); fillExercises();
    const close = (val) => { back.remove(); resolve(val); };
    back.querySelector('.mb-ok').onclick = () => {
      if (!cIn.value.trim()) { mbToast('Course name is required'); cIn.focus(); return; }
      close({ course: cIn.value, topic: tIn.value, exercise: eIn.value });
    };
    back.querySelector('.mb-cancel').onclick = () => close(null);
    back.addEventListener('click', (e) => { if (e.target === back) close(null); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
    cIn.focus(); cIn.select();
  });
}

async function openNotebook(id, opts = {}) {
  const raw = await getNotebook(id);
  if (!raw) {
    alert('Could not open lesson — it may have been deleted or storage is blocked.');
    return false;
  }
  return openNotebookData(raw, opts);
}

async function openNotebookData(raw, opts = {}) {
  if (!raw) return false;
  S.notebook = normalizeNotebook(clone(raw));
  await migrateNotebookMedia(S.notebook);
  if (!S.notebook.kind) { S.notebook.kind = notebookKind(S.notebook); persist(); }
  S.sectionIndex = 0; S.pageIndex = 0; S.undo = []; S.redo = []; clearSelection();
  setPresentMode(false);
  closeLibraryDialogs();
  show('editor');
  scenePageChange();
  ensureKatexSvgCss().catch(() => {});
  // Auto-enter present mode (URL ?present=1, or opening from Course Library).
  if (S._autoPresent || opts.present) {
    S._autoPresent = false;
    requestAnimationFrame(() => setPresentMode(true));
  }
  requestAnimationFrame(() => {
    resizeCanvas(); fitPage(); updatePageLabel(); updateTitle(); updatePresentTitle();
    renderSectionStrip(); loadGeoPage(page());
    // Course Library "Play": step 1 after layout; no-op cleanly when scene has no steps.
    if (opts.play) {
      const steps = page()?.scene?.steps;
      if (steps?.length) { sceneReset(); sceneNextStep(); }
    }
  });
  return true;
}

function closeLibraryDialogs() {
  $('#sync-dialog')?.classList.add('hidden');
  $('#new-lesson-dialog')?.classList.add('hidden');
  if (newLessonResolve) {
    const fn = newLessonResolve;
    newLessonResolve = null;
    fn(null);
  }
}

let newLessonResolve = null;

function setupNewLessonDialog() {
  const dlg = $('#new-lesson-dialog');
  const input = $('#new-lesson-title');
  if (!dlg || !input) return;

  const finish = (val) => {
    dlg.classList.add('hidden');
    const fn = newLessonResolve;
    newLessonResolve = null;
    fn?.(val);
  };

  $('#new-lesson-create')?.addEventListener('click', () => finish(input.value));
  $('#new-lesson-cancel')?.addEventListener('click', () => finish(null));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
    if (e.key === 'Escape') { e.preventDefault(); finish(null); }
  });
}

function askNewLessonName(defaultTitle = 'Vectors — Lesson 1') {
  const dlg = $('#new-lesson-dialog');
  const input = $('#new-lesson-title');
  if (!dlg || !input) {
    const t = window.prompt?.('New lesson name', defaultTitle);
    return Promise.resolve(t === null ? null : t);
  }
  $('#sync-dialog')?.classList.add('hidden');
  if (newLessonResolve) {
    const fn = newLessonResolve;
    newLessonResolve = null;
    fn(null);
  }
  input.value = defaultTitle;
  dlg.classList.remove('hidden');
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return new Promise((resolve) => { newLessonResolve = resolve; });
}

async function createNotebook() {
  if (!(await storageReady())) {
    alert('Local storage is blocked. In Safari: turn off Private Browsing, or Settings → Safari → allow site data.');
    return;
  }
  const all = await getAllNotebooks();
  const lessonCount = all.filter((nb) => notebookKind(nb) === 'lesson').length;
  if (!canCreateLesson(lessonCount)) {
    mbToast('Could not create lesson.');
    return;
  }
  const t = await askNewLessonName();
  if (t === null) return;
  try {
    const nb = newNotebook(t.trim() || 'Untitled lesson', 'lesson');
    await sync.push(nb);
    await openNotebookData(nb);
    renderLibrary();
  } catch (e) {
    alert('Could not create lesson: ' + (e?.message || e));
  }
}

async function clearPage() {
  if (!await mbConfirm('Clear everything on this page? You can undo with ⌘Z.', { okText: 'Clear', danger: true, title: 'Clear page' })) return;
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

function goToPage(i, opts = {}) {
  if (!S.notebook || i < 0 || i >= pages().length || i === S.pageIndex) return;
  // Commit open text/equation editors BEFORE the page index changes: their
  // targets live on the current page, and committing later would splice objs()
  // of the new page — leaving ghost empties behind and the eq dock (plus the
  // MathLive keyboard) floating over a page it doesn't belong to.
  commitTextEditor();
  commitEquationEditor();
  flushGeo();
  const isPresent = $('#editor')?.classList.contains('present-mode');
  // Present mode keeps the teacher's zoom & horizontal position across page
  // turns (same-width pages only); land at the top, or bottom when scrolling up.
  const keepCam = isPresent && pageW(pages()[i]) === pgW();
  S.pageIndex = i;
  S.undo = []; S.redo = [];
  clearSelection();
  setGeoTool(null); setInstTool(null);
  // P1: Page transition — add fade class for present mode
  const cvEl = $('#board');
  if (isPresent && cvEl) cvEl.classList.remove('present-mode-fade');
  loadGeoPage(page());
  if (keepCam) {
    const b = presentCamBounds();
    S.offsetX = Math.max(b.minX, Math.min(b.maxX, S.offsetX));
    S.offsetY = opts.align === 'bottom' ? b.minY : b.maxY;
  } else fitPage();
  if (typeof S.collabPageChange === 'function') S.collabPageChange();
  onAnnotSimPageChange();
  scenePageChange();
  updatePageLabel();
  mark();
  if (isPresent && cvEl && !opts.instant) {
    // Trigger reflow then add fade animation
    void cvEl.offsetWidth;
    cvEl.classList.add('present-mode-fade');
  }
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
async function deletePage(i) {
  if (pages().length <= 1) { alert('A notebook needs at least one page.'); return; }
  if (!await mbConfirm(`Delete page ${i + 1}? This cannot be undone.`, { okText: 'Delete', danger: true, title: 'Delete page' })) return;
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
async function deleteSection(i) {
  if (sections().length <= 1) { alert('A notebook needs at least one section.'); return; }
  const sec = sections()[i];
  if (!await mbConfirm(`Delete section "${sec.title}" and its ${sec.pages.length} page(s)?`, { okText: 'Delete', danger: true, title: 'Delete section' })) return;
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
  onAnnotSimPageChange();
  updatePageLabel();
  renderSectionStrip();
  mark();
}

async function addSection() {
  const t = await mbPrompt('Section name', `Section ${sections().length + 1}`, { okText: 'Add', title: 'New section' });
  if (t === null) return;
  beginAction();
  sections().push({ id: uid(), title: t || `Section ${sections().length + 1}`, pages: [newPage(page().paper)] });
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
    btn.oncontextmenu = async (e) => {
      e.preventDefault();
      const t = await mbPrompt('Rename section', sec.title, { title: 'Rename section' });
      if (t) { sec.title = t; renderSectionStrip(); persist(); }
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
    if (pageIsPdf(pg)) {
      if (isPdfPageBg(pg.background)) {
        renderPdfPageDataUrl(pg.background).then((url) => { if (url) img.src = url; });
      } else {
        const src = pg.background.data || cachedMediaUrl(pg.background.blobId);
        if (src) img.src = src;
        else resolveMediaUrl(pg.background).then((url) => { if (url) img.src = url; });
      }
    } else {
      img.src = makePageThumbUrl(pg);
    }
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

function presentNavNext() {
  const steps = page()?.scene?.steps;
  if (steps?.length) {
    const { stepIndex } = getClock();
    if (stepIndex < steps.length - 1) { sceneNextStep(); return; }
  }
  goToPage(S.pageIndex + 1, { align: 'top' });
}

function presentNavPrev() {
  const steps = page()?.scene?.steps;
  if (steps?.length) {
    const { stepIndex } = getClock();
    if (stepIndex > 0) { scenePrevStep(); return; }
  }
  goToPage(S.pageIndex - 1, { align: 'bottom' });
}

function updatePresentHud() {
  const pgEl = $('#present-page-label');
  const secEl = $('#present-section-label');
  const hud = $('#present-hud');
  const dotsEl = $('#present-step-dots');
  if (!pgEl || !S.notebook) return;
  pgEl.textContent = `${S.pageIndex + 1} / ${pages().length}`;
  const sec = sections()[S.sectionIndex];
  if (secEl) {
    secEl.textContent = sections().length > 1 ? (sec?.title || '') : '';
  }
  const steps = page()?.scene?.steps || [];
  if (dotsEl) {
    dotsEl.innerHTML = '';
    if (steps.length > 1) {
      dotsEl.setAttribute('aria-hidden', 'false');
      const cur = Math.min(Math.floor(sceneNormalized() * steps.length), steps.length - 1);
      steps.forEach((_, i) => {
        const d = document.createElement('span');
        d.className = 'present-step-dot' + (i === cur ? ' active' : '');
        dotsEl.appendChild(d);
      });
    } else {
      dotsEl.setAttribute('aria-hidden', 'true');
    }
  }
  if (hud) hud.setAttribute('aria-hidden', $('#editor')?.classList.contains('present-mode') ? 'false' : 'true');
}

// P1: Idle timer for auto-hide in present mode
let presentIdleTimer = null;
const PRESENT_IDLE_MS = 3000;

function resetPresentIdle() {
  const ed = $('#editor');
  if (!ed?.classList.contains('present-mode')) return;
  ed.classList.add('present-idle-active');
  clearTimeout(presentIdleTimer);
  presentIdleTimer = setTimeout(() => {
    ed.classList.remove('present-idle-active');
  }, PRESENT_IDLE_MS);
}

function syncPresentRailToggle(open) {
  const t = $('#present-rail-toggle');
  if (!t) return;
  t.textContent = open ? '✕' : '✎';
  t.title = open ? 'Hide drawing tools' : 'Show drawing tools';
}

function setPresentMode(on) {
  const ed = $('#editor');
  const rail = $('#tool-rail');
  ed.classList.toggle('present-mode', on);
  syncPresentRailToggle(false); // rail always starts collapsed in present mode
  const btn = $('#present-toggle');
  btn.classList.toggle('brand-toggle-active', on);
  btn.textContent = on ? 'Exit' : 'Present';
  btn.title = on ? 'Exit present mode (Esc)' : 'Present mode — clean layout for screen share (F)';
  const hotspot = $('#scene-next-hotspot');
  const hasScene = !!(page()?.scene?.steps?.length);
  if (hotspot) hotspot.classList.toggle('hidden', !on || !hasScene);
  if (on) {
    S._railWasOpen = !rail?.classList.contains('collapsed');
    rail?.classList.add('collapsed');
    ed.classList.remove('present-rail-open');
    if (TOOL_TAB[S.tool] === 'maths') setTool('pen');
    else setTab('draw');
    if ($('#brand')?.classList.contains('hidden')) {
      $('#brand').classList.remove('hidden');
      $('#brand-toggle')?.classList.add('brand-toggle-active');
    }
    fitPage();
    // P1: Start idle timer; show chrome on any interaction
    ed.classList.add('present-idle-active');
    resetPresentIdle();
  } else {
    if (S._railWasOpen) rail?.classList.remove('collapsed');
    ed.classList.remove('present-rail-open');
    ed.classList.remove('present-idle-active');
    clearTimeout(presentIdleTimer);
    fitPage();
  }
  updatePresentTitle();
  updatePresentHud();
  applyCalcDefaultPosition();
  scheduleCalcKeyboardSync();
  requestAnimationFrame(resizeCanvas);
}

// ---- editor controls ---------------------------------------------------------
function updatePageLabel() {
  const pg = page();
  if (!S.notebook || !pg) {
    $('#page-label').textContent = '';
    return;
  }
  $('#page-label').textContent = `${S.pageIndex + 1} / ${pages().length}`;
  updatePresentHud();
  const sel = $('#paper'); if (sel) sel.value = pg.paper || getDefaultPaper();
  syncPaperToggleUI(pg.paper);
  const fmt = $('#page-format'); if (fmt) fmt.value = pg.format === 'wide' ? 'wide' : 'a4';
  const rb = $('#resultant'); if (rb) rb.classList.toggle('brand-toggle-active', !!pg.showResultant);
  const pb = $('#parallelogram'); if (pb) pb.classList.toggle('brand-toggle-active', !!pg.showParallelogram);
  const cb = $('#conjugate'); if (cb) cb.classList.toggle('brand-toggle-active', !!pg.showConjugate);
  renderPageStrip();
  renderSectionStrip();
  if (!$('#layers')?.classList.contains('hidden')) renderLayersPanel();
}
function updateTitle() { $('#nb-name').value = S.notebook.title; updatePresentTitle(); }

const TOOL_TAB = {
  pen: 'draw', highlighter: 'draw', eraser: 'draw', lasso: 'draw', select: 'draw', text: 'draw', equation: 'draw', line: 'draw', rect: 'draw', ellipse: 'draw',
  vector: 'maths', plotz: 'maths', circle: 'maths', laser: 'draw',
};
function setTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tbar-tools .group').forEach((g) => {
    g.classList.toggle('show', (g.dataset.tabs || '').split(' ').includes(name));
  });
}
function setTool(t) {
  // The equation dock never commits on blur (iPad virtual-keyboard taps would
  // close it), so switching tools must commit it explicitly — while it is open
  // every onDown returns early and the pen appears dead.
  commitEquationEditor();
  commitTextEditor();
  setGeoTool(null);
  setInstTool(null);
  setMechPlacing(null);
  setCplxPlacing(null);
  S.tool = t;
  if (t !== 'lasso') clearSelection();
  if (cv) cv.classList.toggle('cur-select', t === 'select');
  if (cv) cv.classList.toggle('cur-laser', t === 'laser');
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  if (TOOL_TAB[t]) setTab(TOOL_TAB[t]);
  // P1: Clear laser dot when switching away
  if (t !== 'laser') S.laserPos = null;
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
let colorPickr = null;

function applyPickedColor(hex, fromPickr) {
  const c = hex.toLowerCase();
  saveCustomColor(c);
  buildSwatches();
  const el = [...$('#swatches').querySelectorAll('.swatch')].find((s) => s.title === c);
  pickColor(c, el, fromPickr);
}

function setupPickrColor() {
  const btn = $('#color-more');
  if (!btn || colorPickr) return;
  const init = () => {
    if (!window.Pickr?.create) return;
    colorPickr = window.Pickr.create({
      el: btn,
      useAsButton: true,
      theme: 'nano',
      default: S.color,
      swatches: COLORS,
      lockOpacity: true,
      comparison: false,
      position: 'bottom-start',
      components: {
        preview: true,
        opacity: false,
        hue: true,
        interaction: { hex: true, input: true, save: true },
      },
    });
    colorPickr.on('change', (color) => {
      applyPickedColor(color.toHEXA().toString().slice(0, 7), true);
    });
    colorPickr.on('save', () => colorPickr.hide());
  };
  if (window.Pickr?.create) init();
  else {
    const s = document.createElement('script');
    s.src = './vendor/pickr.min.js';
    s.onload = init;
    document.head.appendChild(s);
  }
}

function pickColor(c, el, skipPickr) {
  S.color = c;
  document.querySelectorAll('#swatches .swatch').forEach((x) => x.classList.remove('active'));
  if (el) el.classList.add('active');
  if (!skipPickr && colorPickr) {
    try { colorPickr.setColor(c); } catch (_) { /* ok */ }
  }
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
  setupEqEditor();
  // Laser is a toggle: tapping it while active returns to the pen, so the
  // pointer can be dismissed without hunting for another tool mid-presentation.
  document.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () =>
    setTool(b.dataset.tool === 'laser' && S.tool === 'laser' ? 'pen' : b.dataset.tool));
  document.querySelectorAll('.tab-btn').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
  setTab('draw');
  buildSwatches();
  setupPickrColor();
  S.sketchy = localStorage.getItem('mb-sketchy') === '1';
  const sketchEl = $('#sketchy');
  if (sketchEl) {
    sketchEl.checked = S.sketchy;
    sketchEl.onchange = (e) => {
      S.sketchy = e.target.checked;
      localStorage.setItem('mb-sketchy', S.sketchy ? '1' : '0');
    };
  }
  document.querySelectorAll('.pen-btn').forEach((b) => { b.onclick = () => setPenType(b.dataset.pen); });

  $('#width').oninput = (e) => { S.width = +e.target.value; $('#width-val').textContent = e.target.value; };
  $('#undo').onclick = doUndo;
  $('#redo').onclick = doRedo;
  $('#fit').onclick = fitPage;
  $('#present-toggle').onclick = () => setPresentMode(!$('#editor').classList.contains('present-mode'));
  $('#present-prev')?.addEventListener('click', () => presentNavPrev());
  $('#present-next')?.addEventListener('click', () => presentNavNext());
  $('#present-add-page')?.addEventListener('click', () => {
    const paper = pageIsPdf(page()) ? 'plain' : (page().paper || 'graph');
    addPagesAfterCurrent(newPage(paper, page().format));
    resetPresentIdle();
  });
  // don't lose up to 8 s of debounced work when the app is backgrounded
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersist();
  });
  $('#present-rail-toggle')?.addEventListener('click', () => {
    const rail = $('#tool-rail');
    if (!rail) return;
    const opening = rail.classList.contains('collapsed');
    rail.classList.toggle('collapsed', !opening);
    $('#editor')?.classList.toggle('present-rail-open', opening);
    syncPresentRailToggle(opening);
    resetPresentIdle();
  });
  $('#finger').onchange = (e) => { S.fingerDraw = e.target.checked; };

  $('#prev').onclick = () => goToPage(S.pageIndex - 1);
  $('#next').onclick = () => goToPage(S.pageIndex + 1);
  $('#strip-add').onclick = () => {
    const paper = pageIsPdf(page()) ? 'plain' : (page().paper || $('#paper').value || 'graph');
    addPagesAfterCurrent(newPage(paper));
  };
  $('#addpage').onclick = () => addPagesAfterCurrent(newPage($('#paper').value));
  $('#section-add')?.addEventListener('click', addSection);
  $('#paper').onchange = (e) => setPaperLayout(e.target.value);
  $('#paper-lined')?.addEventListener('click', () => setPaperLayout('lined'));
  $('#paper-graph')?.addEventListener('click', () => setPaperLayout('graph'));
  $('#page-format')?.addEventListener('change', (e) => {
    page().format = e.target.value === 'wide' ? 'wide' : 'a4';
    thumbCache.delete(page().id);
    teardownGeo(); loadGeoPage(page());
    fitPage(); persist(); mark();
  });
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
  $('#export-json').onclick = () => { if (S.notebook) exportNotebookJSON(S.notebook).catch((e) => alert(e.message)); };
  $('#share-lesson').onclick = async () => {
    if (!S.notebook) return;
    const r = await shareNotebook(S.notebook);
    if (r === 'downloaded') { /* fallback export already ran */ }
  };
  $('#insert-pdf').onclick = () => $('#pdf-file').click();
  $('#insert-img').onclick = () => $('#img-file').click();
  $('#clear-page').onclick = clearPage;
  $('#delete-selection')?.addEventListener('click', () => deleteSelection());
  $('#float-delete')?.addEventListener('click', () => deleteSelection());
  $('#pdf-file').onchange = (e) => { const f = e.target.files[0]; if (f) insertPdfIntoNotebook(f); e.target.value = ''; };
  $('#img-file').onchange = (e) => { const f = e.target.files[0]; if (f) insertImageFile(f); e.target.value = ''; };
  document.querySelectorAll('[data-geo]').forEach((b) => {
    if (!b.dataset.geo) return;
    b.onclick = () => { setInstTool(null); setGeoTool(b.dataset.geo); setTab('maths'); };
  });
  // Arming an instrument gives no visible feedback until the page is tapped —
  // say what to tap so the tools don't feel broken on first use.
  const INST_HINTS = {
    ruler: 'Ruler: tap the two end points on the page',
    protractor: 'Protractor: tap the vertex, then one point on each arm',
    compass: 'Compass: tap the centre, then a point on the rim',
  };
  document.querySelectorAll('[data-inst]').forEach((b) => {
    b.onclick = () => {
      setGeoTool(null); setInstTool(b.dataset.inst); setTab('maths');
      if (INST_HINTS[b.dataset.inst]) mbToast(INST_HINTS[b.dataset.inst]);
    };
  });
  $('#geo-clear').onclick = async () => {
    if (await mbConfirm('Clear all geometry on this page?', { okText: 'Clear', danger: true, title: 'Clear geometry' })) clearGeoPage();
  };
  $('#back').onclick = () => {
    // Close editors first: #eq-dock is position:fixed and the MathLive virtual
    // keyboard lives on <body>, so both would stay visible over the library.
    commitTextEditor();
    commitEquationEditor();
    S.playing = false; setPresentMode(false); setGeoTool(null); setInstTool(null); teardownGeo(); show('library'); renderLibrary();
  };

  $('#nb-name').onchange = (e) => { S.notebook.title = e.target.value.trim() || 'Untitled lesson'; persist(); };

  // keyboard shortcuts (desktop)
  window.addEventListener('keydown', (e) => {
    if ($('#editor').classList.contains('hidden')) return;
    if (eqDockOpen()) return;
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
    else if (e.key === 'Escape' && geoToolActive()) { cancelGeoDraft(); mark(); }
    else if (e.key === 'Escape' && $('#editor')?.classList.contains('present-mode')) { e.preventDefault(); setPresentMode(false); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setPresentMode(!$('#editor').classList.contains('present-mode')); }
    else if ($('#editor')?.classList.contains('present-mode') && (e.key === 'ArrowLeft' || e.key === 'PageUp')) {
      e.preventDefault();
      presentNavPrev();
    }
    else if ($('#editor')?.classList.contains('present-mode') && (e.key === 'PageDown' || e.key === ' ')) {
      // presenter clickers send PageUp/PageDown; space = next, like slide apps
      e.preventDefault();
      presentNavNext();
    }
    else if ($('#editor')?.classList.contains('present-mode') && e.key === 'ArrowRight') {
      e.preventDefault();
      presentNavNext();
    }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && hasDeletableSelection()) { e.preventDefault(); deleteSelection(); }
  });
}

function bindCanvas() {
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  // P0: Use pointerrawupdate for iPad Apple Pencil if available (higher frequency,
  // lower latency). When active, onMove ignores pointermove for ink so the same
  // samples are never appended twice (see HAS_RAW_UPDATE).
  if (HAS_RAW_UPDATE) {
    cv.addEventListener('pointerrawupdate', onMove, { passive: true });
  }
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
  // P1: Present-mode idle — any interaction resets the auto-hide timer.
  // Toolbar/rail get their own listeners so menus don't fade out mid-use.
  cv.addEventListener('pointermove', resetPresentIdle);
  cv.addEventListener('pointerdown', resetPresentIdle);
  document.querySelector('#editor .toolbar')?.addEventListener('pointermove', resetPresentIdle);
  document.querySelector('#editor .toolbar')?.addEventListener('pointerdown', resetPresentIdle);
  $('#tool-rail')?.addEventListener('pointermove', resetPresentIdle);
  $('#tool-rail')?.addEventListener('pointerdown', resetPresentIdle);
  document.addEventListener('keydown', resetPresentIdle);
  window.addEventListener('resize', resizeCanvas);
  window.visualViewport?.addEventListener('resize', () => resizeCanvas());
  window.visualViewport?.addEventListener('scroll', () => resizeCanvas());
}

// ---- fx-991-equivalent scientific calculator --------------------------------
let calcDeg = true, calcAns = 0, mathFrac = null, calcShift = false, calcAlpha = false;
let calcLastExpr = null, calcResultValue = null, calcDisplayMode = 0; // 0=D 1=frac 2=mixed 3=surd
let intgMode = 'integral';
const calcVars = {};            // STO/RCL/ALPHA variables A–F, X, Y, M
let stoPending = false, rclAlpha = false, hypPending = false;
const SHIFT_MAP = {
  'sin(': 'asin(', 'cos(': 'acos(', 'tan(': 'atan(', 'log(': 'e^(', 'log10(': '10^(',
  '^': 'nthRoot(', 'sqrt(': 'cbrt(', '^2': '^3', 'inv': '!', 'e10': 'pi', 'int': 'diff',
  'hyp': 'abs(', '*': 'permutations(', '/': 'combinations(', 'rcl': 'sto', 'mplus': 'mminus',
  'ran': 'ranint', 'ac': 'off', 'pol': 'rec', 'sum': 'prod',
};
const CALC_FMT = ['D', 'F', 'ab/c', '√'];

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
  calcExprEl()?.focus({ preventScroll: true });
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
      let sym = nerdamerDiff(fx, 'x');
      if (!sym) sym = mathjsDerivative(fx);
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
// fx-991 "a b/c": improper fraction rendered as whole + proper part (7/3 → 2 1/3)
function mixedHtml(n, d) {
  if (!d) return String(n);
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d); n /= g; d /= g;
  if (d === 1) return String(n);
  const sign = n < 0 ? '−' : '';
  const an = Math.abs(n);
  const whole = Math.floor(an / d), rem = an % d;
  if (!whole) return fracHtml(n, d);
  return `${sign}${whole}&hairsp;${fracHtml(rem, d)}`;
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
  if (mode === 1 || mode === 2) {
    try {
      const f = mathFrac.fraction(val);
      if (f && Number.isFinite(f.n) && Number.isFinite(f.d)) {
        return mode === 1 ? fracHtml(f.s * f.n, f.d) : mixedHtml(f.s * f.n, f.d);
      }
    } catch (_) { /* decimal */ }
  }
  if (mode === 3) {
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
function calcToggleSD(shift) {
  if (calcResultValue == null) return;
  // SHIFT+S⇔D on the real fx-991 is a b/c ⇔ d/c: jump between mixed and improper.
  if (shift) calcDisplayMode = calcDisplayMode === 2 ? 1 : 2;
  else calcDisplayMode = (calcDisplayMode + 1) % CALC_FMT.length;
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
  if (k === 'sd') { calcToggleSD(sh); return; }
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
  $('#calc-toggle').onclick = () => {
    const open = $('#calc').classList.toggle('hidden') === false;
    if (open) {
      applyCalcDefaultPosition();
      startCalcKbdPoll();
      const mf = calcExprEl();
      // iPad: don't auto-open the math keyboard — faceplate keys work; tap expr or ⌨ to open.
      if (!coarsePointer()) {
        mf?.focus({ preventScroll: true });
        setTimeout(() => showMathKeyboard(), 80);
      }
    } else {
      hideMathKeyboard();
      stopCalcKbdPoll();
      $('#calc-vk-dock')?.classList.add('hidden');
    }
  };
  $('#calc-close').onclick = () => {
    hideMathKeyboard();
    stopCalcKbdPoll();
    $('#calc-vk-dock')?.classList.add('hidden');
    $('#calc').classList.add('hidden');
    $('#calc').classList.remove('calc-kbd-open', 'calc-vk-active');
  };
  $('#calc-done')?.addEventListener('click', calcVkDone);
  $('#calc-vk-done')?.addEventListener('click', calcVkDone);
  $('#calc-vk-hide')?.addEventListener('click', () => {
    hideMathKeyboard();
    calcExprEl()?.blur?.();
  });
  $('#calc-kbd-toggle')?.addEventListener('click', () => {
    // Only focus when opening — focusing before hide makes MathLive ignore hide().
    const vk = mathVirtualKeyboard();
    if (vk?.visible) {
      hideMathKeyboard();
    } else {
      calcExprEl()?.focus({ preventScroll: true });
      showMathKeyboard();
    }
  });
  $('#calc-mode').onclick = () => setCalcDeg(!calcDeg);
  const mf = calcExprEl();
  if (mf) {
    try { mf.smartMode = false; mf.smartFence = false; mf.mathVirtualKeyboardPolicy = 'manual'; } catch (_) {}
    mf.addEventListener('focusin', () => {
      showMathKeyboard();
      startCalcKbdPoll();
    });
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
  window.addEventListener('resize', scheduleCalcKeyboardSync);
}
function makeDraggable(panel, handle) {
  let sx, sy, ox, oy, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.calc-x')) return;
    dragging = true;
    if (panel.id === 'calc') panel.dataset.dragged = '1';
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
  refreshGraphView();
}
function addFunction(expr, param) {
  if (param) {
    fns().push({ mode: 'param', exprX: 'cos(t)', exprY: 'sin(t)', tMin: 0, tMax: 6.283, color: COLORS[fns().length % COLORS.length] });
  } else {
    fns().push({ mode: 'y', expr: expr || '', color: COLORS[fns().length % COLORS.length] });
  }
  renderGraphList(); persist(); mark();
}
function ensureAxesPaper() {
  const pg = page();
  if (!pg || GRID_PAPERS.includes(pg.paper)) return;
  pg.paper = 'axes';
  updatePageLabel();
  persist();
  mark();
}
function openGraph() {
  const pg = page();
  if (!pg) return;
  if (!GRID_PAPERS.includes(pg.paper)) { pg.paper = 'axes'; updatePageLabel(); persist(); }
  $('#graph').classList.remove('hidden');
  if (!fns().length) addFunction('sin(x)'); else renderGraphList();
  const u = pg.unitCircle;
  $('#gp-unit')?.classList.toggle('brand-toggle-active', !!(u && u.show));
  $('#gp-deg')?.classList.toggle('brand-toggle-active', !!pg.trigDegAxis);
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
  const pg = page();
  if (!pg) return;
  const u = pg.unitCircle || {};
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
  const degBtn = $('#gp-deg');
  if (degBtn) {
    degBtn.onclick = () => {
      const pg = page();
      pg.trigDegAxis = !pg.trigDegAxis;
      degBtn.classList.toggle('brand-toggle-active', pg.trigDegAxis);
      const hint = document.querySelector('#graph .gp-hint');
      if (hint) hint.textContent = pg.trigDegAxis
        ? 'y(x) · x-axis in degrees · drag points with Select'
        : 'y(x) or parametric x(t), y(t) · drag points with Select · radians';
      persist(); mark(); refreshGraphView();
    };
  }
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
  const at = { x: gridCx() + re * UNIT, y: gridCy() - im * UNIT };
  objs().push({
    id: uid(), kind: 'complex', at: snapPt(at), color: S.color,
    ctag: tag || null, omega: omega ? { re: omega.re, im: omega.im } : null,
  });
  mark();
}

function setupProductUI() {
  initEntitlement();
  initTheme();

  const about = $('#about-dialog');
  $('#about-btn')?.addEventListener('click', () => about?.classList.remove('hidden'));
  $('#about-close')?.addEventListener('click', () => about?.classList.add('hidden'));
  about?.addEventListener('click', (e) => { if (e.target === about) about.classList.add('hidden'); });

  // Editor "More" overflow menu
  const moreBtn = $('#tbar-more');
  const moreDrop = $('#tbar-more-drop');
  if (moreBtn && moreDrop) {
    moreBtn.onclick = (e) => { e.stopPropagation(); moreDrop.classList.toggle('hidden'); };
    document.addEventListener('click', () => moreDrop.classList.add('hidden'));
    $('#share-lesson-more')?.addEventListener('click', () => { moreDrop.classList.add('hidden'); $('#share-lesson')?.click(); });
    $('#sync-settings-editor-more')?.addEventListener('click', () => { moreDrop.classList.add('hidden'); $('#sync-settings-editor')?.click(); });
    $('#export-json-more')?.addEventListener('click', () => { moreDrop.classList.add('hidden'); $('#export-json')?.click(); });
    $('#export-pdf-more')?.addEventListener('click', () => { moreDrop.classList.add('hidden'); $('#export-pdf')?.click(); });
  }

  initOnboarding();
  setupInstallBanner();
  syncPaperToggleUI(getDefaultPaper());
}

function setupPanelMenu() {
  const wrap = $('#panel-menu');
  const drop = $('#panel-drop');
  if (!wrap || !drop) return;
  $('#open-labs')?.addEventListener('click', () => { drop.classList.add('hidden'); openLabPicker(); });
  wrap.onclick = (e) => {
    e.stopPropagation();
    drop.classList.toggle('hidden');
  };
  drop.querySelectorAll('[data-panel]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.panel;
      const el = $(id);
      if (el) {
        el.classList.toggle('hidden');
        if (id === '#layers' && !el.classList.contains('hidden')) renderLayersPanel();
      }
      drop.classList.add('hidden');
    };
  });
  document.addEventListener('click', () => drop.classList.add('hidden'));
}

function setupSyncSettings() {
  const dlg = $('#sync-dialog');
  const urlIn = $('#sync-url');
  if (!dlg || !urlIn) return;

  function refreshSyncAuthUI() {
    const user = getAuthUser();
    const signed = isSignedIn();
    const configured = !!(getSupabaseUrl() && getSupabaseAnonKey());
    $('#sync-config-hint')?.classList.toggle('hidden', configured);
    $('#sync-user').textContent = signed && user?.email ? `Signed in as ${user.email}` : 'Not signed in';
    $('#sync-signin')?.classList.toggle('hidden', signed);
    $('#sync-signout')?.classList.toggle('hidden', !signed);
    if ($('#sync-email')) $('#sync-email').disabled = signed;
    if ($('#sync-password')) $('#sync-password').disabled = signed;
  }

  function openSyncDialog() {
    urlIn.value = getSyncBaseUrl() || defaultSyncApiUrl();
    refreshSyncAuthUI();
    dlg.classList.remove('hidden');
  }

  // Auto-apply config.local.js Supabase settings on first load.
  if (getSupabaseUrl() && getSupabaseAnonKey() && defaultSyncApiUrl()) {
    if (!getSyncBaseUrl()) setSyncBaseUrl(defaultSyncApiUrl());
    updateSyncStatus({ state: isSignedIn() ? 'configured' : 'configured', mode: 'remote' });
  }

  urlIn.value = getSyncBaseUrl() || defaultSyncApiUrl();
  refreshSyncAuthUI();

  $('#sync-settings')?.addEventListener('click', openSyncDialog);
  $('#sync-settings-editor')?.addEventListener('click', openSyncDialog);
  $('#sync-settings-foot')?.addEventListener('click', openSyncDialog);
  $('#sync-status')?.addEventListener('click', openSyncDialog);
  $('#sync-close')?.addEventListener('click', () => dlg.classList.add('hidden'));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.classList.add('hidden'); });
  $('#sync-signin')?.addEventListener('click', async () => {
    try {
      await signInWithPassword($('#sync-email')?.value?.trim(), $('#sync-password')?.value);
      if (urlIn.value.trim()) setSyncBaseUrl(urlIn.value);
      else if (defaultSyncApiUrl()) setSyncBaseUrl(defaultSyncApiUrl());
      refreshSyncAuthUI();
      updateSyncStatus({ state: 'configured', mode: 'remote' });
      if (canMerge()) {
        const { pulled, pushed } = await mergeSync();
        renderLibrary();
        dlg.classList.add('hidden');
        alert(`Signed in. Synced: ${pulled} pulled, ${pushed} pushed.`);
      }
    } catch (e) { alert(e.message); }
  });
  function canMerge() {
    return isSignedIn() && getSyncBaseUrl() && getSupabaseAnonKey();
  }
  $('#sync-signout')?.addEventListener('click', async () => {
    await signOut();
    refreshSyncAuthUI();
    updateSyncStatus({ state: 'saved', mode: 'local' });
  });
  $('#sync-save')?.addEventListener('click', () => {
    setSyncBaseUrl(urlIn.value);
    dlg.classList.add('hidden');
    updateSyncStatus({ state: getSyncBaseUrl() ? 'configured' : 'saved', mode: getSyncBaseUrl() ? 'remote' : 'local' });
  });
  $('#sync-push')?.addEventListener('click', async () => {
    try {
      setSyncBaseUrl(urlIn.value);
      if (!isSignedIn()) throw new Error('Sign in first.');
      const n = await syncAllToRemote();
      alert(`Uploaded ${n} lesson(s) to cloud.`);
    } catch (e) { alert(e.message); }
  });
  $('#sync-pull')?.addEventListener('click', async () => {
    try {
      setSyncBaseUrl(urlIn.value);
      if (!isSignedIn()) throw new Error('Sign in first.');
      const { pulled, pushed } = await mergeSync();
      renderLibrary();
      alert(`Sync complete: ${pulled} pulled, ${pushed} pushed.`);
    } catch (e) { alert(e.message); }
  });

  // Background merge when already signed in (multi-device).
  if (canMerge()) {
    mergeSync().then(() => renderLibrary()).catch(() => {});
  }
}

// ---- tool rail (classroom layout): pin/unpin + close-all panels ---------------
function setupRail() {
  const rail = $('#tool-rail');
  const collapse = (on) => {
    rail?.classList.toggle('collapsed', on);
  };
  const pin = $('#rail-pin');
  if (pin) pin.onclick = () => collapse(!rail.classList.contains('collapsed'));
  const reopen = $('#rail-reopen');
  if (reopen) reopen.onclick = () => collapse(false);
  const closeAll = $('#close-all');
  if (closeAll) closeAll.onclick = () => {
    ['#calc', '#stats', '#graph', '#mech', '#cplx', '#calculus', '#symbolic'].forEach((id) => $(id)?.classList.add('hidden'));
    $('#panel-drop')?.classList.add('hidden');
    setMechPlacing(null);
    setCplxPlacing(null);
  };
}

// ---- live demo animation bar (Module 1) --------------------------------------
function syncDemoUI() {
  const s = $('#scene-slider') || $('#demo-slider'); if (s) s.value = Math.round(S.demoT * 1000);
  const v = $('#scene-val') || $('#demo-val'); if (v) v.textContent = page()?.scene?.steps?.length ? `${sceneTime().toFixed(1)}s` : S.demoT.toFixed(2);
  if ($('#editor')?.classList.contains('present-mode')) updatePresentHud();
}
function demoPlay(on) {
  S.playing = on;
  S.demoLast = performance.now();
  const b = $('#scene-play') || $('#demo-play');
  if (b) { b.textContent = on ? '❚❚' : '▶'; b.classList.toggle('brand-toggle-active', on); }
  mark();
}
function demoReset() { demoPlay(false); S.demoT = 0; syncDemoUI(); mark(); }
function addTracer() {
  beginAction();
  const o = {
    id: uid(), kind: 'tracer',
    center: { x: gridCx(), y: gridCy() },
    edge: { x: gridCx() + 3 * UNIT, y: gridCy() },
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
function addForceVec(vtype = 'force') {
  beginAction();
  const meta = VTYPE_META[vtype] || VTYPE_META.force;
  const o = { id: uid(), kind: 'forcevec', vtype, at: { x: gridCx(), y: gridCy() }, mag: 5, angleDeg: 30, anim: true, color: meta.color };
  objs().push(o);
  recordObject(o);
  commitAction();
  selectNewObject(o);
}
function syncInclineObjectPanel(o) {
  if (!o || o.kind !== 'incline') return;
  openMechPanel('incline');
  $('#mech')?.classList.remove('hidden');
  $('#mi-angle').value = Math.round(o.anim ? inclineLiveAngle(o) : (o.angleDeg ?? 30));
  $('#mi-mass').value = o.mass ?? 2;
  $('#mi-mu').value = o.mu ?? 0;
  $('#mi-base').value = o.base ?? 300;
  $('#mi-scale').value = o.scale ?? 1;
  $('#mi-comp').checked = o.showComponents !== false;
  $('#mi-anim').checked = !!o.anim;
  if (o.anim) $('#demo-bar')?.classList.remove('hidden');
}

function applyInclinePanel(o) {
  if (!o || o.kind !== 'incline') return;
  const anim = !!$('#mi-anim')?.checked;
  o.anim = anim;
  if (!anim) o.angleDeg = Math.max(5, Math.min(85, +$('#mi-angle')?.value || 30));
  o.mass = +$('#mi-mass')?.value || 2;
  o.mu = +$('#mi-mu')?.value || 0;
  o.base = Math.max(120, +$('#mi-base')?.value || 300);
  o.scale = Math.max(0.5, Math.min(3, +$('#mi-scale')?.value || 1));
  o.showComponents = !!$('#mi-comp')?.checked;
  if (anim) $('#demo-bar')?.classList.remove('hidden');
  persist();
}

function placeInclineObject(at, props) {
  beginAction();
  const o = {
    id: uid(), kind: 'incline', at,
    base: Math.max(120, props.base ?? props.len ?? 280),
    angleDeg: props.angleDeg ?? 30,
    mass: props.mass ?? 2,
    mu: props.mu ?? 0,
    scale: props.scale ?? 1,
    showComponents: props.showComponents !== false,
    anim: false,
  };
  objs().push(o);
  commitAction();
  setSelectedMech(null);
  selectNewObject(o);
  syncInclineObjectPanel(o);
}

function addIncline() {
  beginAction();
  const o = {
    id: uid(), kind: 'incline',
    at: { x: gridCx() - 150, y: gridCy() + 130 },
    base: 300, angleDeg: 30, mass: 2, mu: 0.2, scale: 1,
    showComponents: true, anim: true,
  };
  objs().push(o);
  commitAction();
  selectNewObject(o);
  syncInclineObjectPanel(o);
}
function setupDemo() {
  $('#demo-toggle')?.addEventListener('click', () => {
    ensureScene(page());
    $('#demo-bar')?.classList.toggle('hidden');
  });
  $('#demo-close')?.addEventListener('click', () => { demoPlay(false); sceneReset(); $('#demo-bar')?.classList.add('hidden'); });
  $('#scene-catalog')?.addEventListener('click', () => {
    if (!S.notebook) { mbToast('Open a lesson first'); return; }
    catalogNotebook(S.notebook);
  });
  $('#demo-add')?.addEventListener('click', addTracer);
  $('#demo-force')?.addEventListener('click', () => addForceVec('force'));
  $('#demo-velocity')?.addEventListener('click', () => addForceVec('velocity'));
  $('#demo-accel')?.addEventListener('click', () => addForceVec('acceleration'));
  $('#demo-incline')?.addEventListener('click', addIncline);
  $('#demo-triangle')?.addEventListener('click', addTriangle);
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
  if (!collabAvailable()) { cb.classList.add('hidden'); return; }
  cb.classList.remove('hidden');
  cb.onclick = async () => {
    cb.disabled = true;
    try {
      const m = await import('./collab/collab.js');
      if (m.collabActive()) {
        m.stopCollab();
        S.collabPush = null;
        S.collabPageChange = null;
        S.collabPause = null;
        S.collabResume = null;
        cb.textContent = 'Collaborate';
        return;
      }
      const r = m.startCollab({
        notebook: () => S.notebook,
        page,
        mark,
        userName: () => getAuthUser()?.email?.split('@')[0] || 'Guest',
      });
      if (!r.connected) return;
      S.collabPush = () => m.collabPushPage();
      S.collabPageChange = () => m.onCollabPageSwitch();
      // P0: Wire up pause/resume functions for drawing lag reduction
      S.collabPause = () => m.pauseCollabSync();
      S.collabResume = () => m.resumeCollabSync();
      cb.textContent = 'Leave room';
    } catch (e) {
      alert('Could not load collaboration: ' + e.message);
    } finally {
      cb.disabled = false;
    }
  };
}

// ---- boot --------------------------------------------------------------------
function showBootError(msg) {
  const el = $('#boot-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function surfaceUnexpectedError(prefix, err) {
  const detail = err?.message || String(err || 'Unknown error');
  const msg = prefix ? `${prefix}: ${detail}` : detail;
  console.error(msg, err);
  showBootError(msg);
}

window.addEventListener('unhandledrejection', (e) => {
  surfaceUnexpectedError('Unexpected error', e.reason);
  e.preventDefault?.();
});
window.addEventListener('error', (e) => {
  // Ignore failed script/stylesheet loads (e.g. missing optional config.local.js).
  if (e.target && e.target !== window && e.target.tagName) return;
  if (e.message) surfaceUnexpectedError('Unexpected error', e.error || e.message);
});

function bindLibrary() {
  setupNewLessonDialog();
  $('#new-nb')?.addEventListener('click', () => { createNotebook(); });
  document.querySelectorAll('.lib-tab').forEach((b) => {
    b.addEventListener('click', () => setLibTab(b.dataset.lib));
  });
  setLibTab('lesson');
  $('#lib-search')?.addEventListener('input', (e) => { libSearch = e.target.value; renderLibrary(); });
  $('#pdf-file-lib')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importPdfAsNotebook(f);
    e.target.value = '';
  });
  $('#json-file-lib')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importJsonAsNotebook(f);
    e.target.value = '';
  });
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  }
}

async function init() {
  // Access gate: sign-in / access-ended screens render instead of the app.
  // Server-side enforcement lives in the Worker; this decides the UI only.
  if (!(await ensureAccess())) return;
  bindLibrary();
  try {
  cv = $('#board');
  ctx = cv.getContext('2d', { alpha: false, desynchronized: true });
  setupGeo({ page, snapPt, beginAction, commitAction, persist, mark, cancelAction: () => { S.actionBefore = null; }, setInstTool: () => setInstTool(null), unit: UNIT, pageW: () => pageW(page()), pageH: () => pageH(page()) });
  setupMech({
    page, snapPt, beginAction, commitAction, persist, mark,
    setGeoTool: () => setGeoTool(null), setCplxPlacing: () => setCplxPlacing(null),
    placeInclineObject, getSelectedIncline: () => (S.selObj?.kind === 'incline' ? S.selObj : null),
    applyInclinePanel,
  });
  setupMechPanel();
  makeDraggable($('#mech'), $('#mech-head'));
  setupCplx({
    page, snapPt, beginAction, commitAction, persist, mark, unit: UNIT, pageW: () => pageW(page()), pageH: () => pageH(page()),
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
    page, beginAction, commitAction, persist, mark, unit: UNIT, pageW: () => pageW(page()), pageH: () => pageH(page()),
    ensureAxes: ensureAxesPaper,
  });
  setupCalculusPanel();
  makeDraggable($('#calculus'), $('#calculus-head'));
  setupSymbolic({
    pageW: () => pageW(page()),
    pageH: () => pageH(page()),
    color: () => S.color,
    beginAction,
    commitAction,
    persist,
    mark,
    addEquation: ({ latex, at, color, size }) => {
      objs().push({ id: uid(), kind: 'equation', at, latex, color, size: size || 34 });
      eqRenderCache = new Map();
    },
  });
  setupSymbolicPanel();
  makeDraggable($('#symbolic'), $('#symbolic-head'));
  setupAlgebra({
    pageW: () => pageW(page()),
    pageH: () => pageH(page()),
    color: () => S.color,
    beginAction,
    commitAction,
    persist,
    mark,
    addEquation: ({ latex, at, color, size }) => {
      objs().push({ id: uid(), kind: 'equation', at, latex, color, size: size || 34 });
      eqRenderCache = new Map();
    },
  });
  setupAlgebraPanel();
  makeDraggable($('#algebra'), $('#algebra-head'));
  setupRationals({
    pageW: () => pageW(page()),
    pageH: () => pageH(page()),
    color: () => S.color,
    beginAction,
    commitAction,
    persist,
    mark,
    addEquation: ({ latex, at, color, size }) => {
      objs().push({ id: uid(), kind: 'equation', at, latex, color, size: size || 34 });
      eqRenderCache = new Map();
    },
  });
  setupRationalsPanel();
  makeDraggable($('#rationals'), $('#rationals-head'));
  setupText();
  setupAnnotatedSim({
    getPage: () => page(),
    getObjs: () => objs(),
    getNotebook: () => S.notebook,
    getSectionText: () => sections()[S.sectionIndex]?.title || '',
    getNotebookTitle: () => S.notebook?.title || '',
    strokeBBox,
    textBox,
    mark,
    persist,
    beginAction,
    commitAction,
    uid,
    onLockedChange: (locked) => { S.annotSimLocked = locked; },
  });
  setupPanelMenu();
  setupRail();
  setupDemo();
  setupScene({ page, objs, beginAction, commitAction, mark, persist });
  setupLayers({ page, beginAction, commitAction, persist, mark });
  setupLayersPanel();
  makeDraggable($('#layers'), $('#layers-head'));
  setupGraphView({
    page, unit: () => UNIT, calcScope,
    trigDegAxis: () => !!page()?.trigDegAxis,
    ensureAxes: ensureAxesPaper,
  });
  setupGraphViewPanel();
  setupStudioUI();
  setupProductUI();
  setupCollabGate();
  setupSyncSettings();
  show('library');
  renderLibrary();
  requestAnimationFrame(render);

  // P1: URL param ?present=1 — auto-enter present mode when lesson opens
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('present') === '1') {
    S._autoPresent = true;
    // Defer to after first notebook loads
  }

  storageReady().then((ok) => {
    if (!ok) {
      showBootError('Local storage blocked — lessons cannot save. Turn off Safari Private Browsing or allow site data.');
    }
  });

  // Post-gate UI: teacher's admin panel + the gated papers/books browser.
  setupAdminPanel();
  setupPapersLibrary({ importPdf: importPdfAsNotebook });

  // Service worker (offline PWA). Disabled on localhost to avoid stale-cache
  // surprises during development; enabled when served from a real host/LAN IP.
  const devHost = ['localhost', '127.0.0.1'].includes(location.hostname);
  setupServiceWorker(devHost);
  const verEl = $('#mb-version');
  if (verEl) verEl.textContent = `v${APP_VERSION}`;
  } catch (e) {
    showBootError('MathBoard failed to start: ' + e.message + ' — try a hard refresh (Cmd+Shift+R).');
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', init);

// Register SW with a versioned URL so iPad Safari actually fetches new sw.js.
function setupServiceWorker(devHost) {
  if (!('serviceWorker' in navigator) || devHost) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`).then((reg) => {
    reg.update();
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) nw.postMessage({ type: 'SKIP_WAITING' });
      });
    });
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  }).catch(() => {});
}
