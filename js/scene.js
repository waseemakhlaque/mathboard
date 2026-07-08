// scene.js — per-page Scene Timeline (Phase 1): timed steps, penReplay, fade/drawOn

const PEN_REPLAY_PX_PER_SEC = 1200;

let hooks = {};
let recording = false;

const clock = {
  t: 0,
  playing: false,
  mode: 'manual',
  stepIndex: -1,
  _last: 0,
  _stepEnd: null, // manual: stop playback at this t
};

// ---- easing ------------------------------------------------------------------
export const EASES = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  back: (t) => {
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
  elastic: (t) => {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3));
  },
};

function easeFn(name) { return EASES[name] || EASES.easeOut; }

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// ---- scene schema ------------------------------------------------------------
export function ensureScene(page) {
  if (!page) return null;
  if (!page.scene) {
    page.scene = { duration: 6, mode: 'manual', steps: [] };
  }
  if (!Array.isArray(page.scene.steps)) page.scene.steps = [];
  if (!page.scene.mode) page.scene.mode = 'manual';
  return page.scene;
}

function stepEndTime(step) {
  let end = 0;
  for (const tr of step.tracks || []) end = Math.max(end, (tr.at || 0) + (tr.dur || 0));
  return end;
}

function recomputeStepStarts(scene) {
  let at = 0;
  for (const st of scene.steps) {
    st.at = at;
    at += stepEndTime(st);
  }
  scene.duration = Math.max(at, scene.duration || 6);
}

export function sceneDuration(page) {
  const sc = page?.scene;
  if (!sc?.steps?.length) return sc?.duration || 6;
  let max = 0;
  for (const st of sc.steps) {
    const base = st.at || 0;
    for (const tr of st.tracks || []) {
      max = Math.max(max, base + (tr.at || 0) + (tr.dur || 0));
    }
    max = Math.max(max, base + stepEndTime(st));
  }
  return max || sc.duration || 6;
}

function tracksForTarget(page, targetId) {
  const sc = page?.scene;
  if (!sc?.steps?.length || !targetId) return [];
  const out = [];
  for (const st of sc.steps) {
    const base = st.at || 0;
    for (const tr of st.tracks || []) {
      if (tr.target === targetId) out.push({ tr, base });
    }
  }
  return out;
}

export function hasTargetTracks(page, targetId) {
  return tracksForTarget(page, targetId).length > 0;
}

function trackLocalT(tr, base, t) {
  const start = base + (tr.at || 0);
  if (t < start) return null;
  const dur = tr.dur || 0.001;
  return clamp01((t - start) / dur);
}

export function evalTrack(track, t, base = 0) {
  const lt = trackLocalT(track, base, t);
  if (lt === null) return null;
  const e = easeFn(track.ease || 'easeOut')(lt);
  if (track.prop) {
    const from = track.from ?? 0;
    const to = track.to ?? 1;
    return from + (to - from) * e;
  }
  if (track.effect === 'fadeIn' || track.effect === 'fadeOut' || track.effect === 'pop') return e;
  if (track.effect === 'drawOn' || track.effect === 'penReplay') return e;
  return e;
}

export function objAlpha(page, objId, t) {
  if (!hasTargetTracks(page, objId)) return 1;
  const tracks = tracksForTarget(page, objId);
  let alpha = 1;
  let hideUntilStart = false;
  for (const { tr, base } of tracks) {
    const start = base + (tr.at || 0);
    const end = start + (tr.dur || 0);
    if (tr.effect === 'fadeIn' || tr.effect === 'pop') {
      hideUntilStart = true;
      if (t < start) alpha = 0;
      else if (t >= end) alpha = Math.max(alpha, 1);
      else alpha = Math.max(alpha, evalTrack(tr, t, base));
    } else if (tr.effect === 'fadeOut') {
      if (t < start) alpha = Math.min(alpha, 1);
      else if (t >= end) alpha = 0;
      else alpha = Math.min(alpha, 1 - evalTrack(tr, t, base));
    } else if (tr.effect === 'drawOn' || tr.prop) {
      hideUntilStart = true;
      if (t < start) alpha = Math.min(alpha, 0);
      else alpha = Math.max(alpha, 1);
    }
  }
  if (hideUntilStart && t === 0 && clock.stepIndex < 0) return 0;
  return alpha;
}

export function objPopScale(page, objId, t) {
  if (!hasTargetTracks(page, objId)) return 1;
  for (const { tr, base } of tracksForTarget(page, objId)) {
    if (tr.effect !== 'pop') continue;
    const start = base + (tr.at || 0);
    const end = start + (tr.dur || 0);
    if (t < start) return 0.6;
    if (t >= end) return 1;
    const e = evalTrack(tr, t, base);
    return 0.6 + 0.5 * e - 0.1 * Math.sin(e * Math.PI); // slight overshoot
  }
  return 1;
}

export function objDrawProgress(page, objId, t) {
  if (!hasTargetTracks(page, objId)) return 1;
  let prog = 0;
  let hasDraw = false;
  for (const { tr, base } of tracksForTarget(page, objId)) {
    if (tr.effect !== 'drawOn') continue;
    hasDraw = true;
    const start = base + (tr.at || 0);
    const end = start + (tr.dur || 0);
    if (t >= end) prog = Math.max(prog, 1);
    else if (t >= start) prog = Math.max(prog, evalTrack(tr, t, base));
  }
  return hasDraw ? prog : 1;
}

export function strokeReveal(page, strokeId, t) {
  if (!hasTargetTracks(page, strokeId)) return 1;
  let prog = 0;
  for (const { tr, base } of tracksForTarget(page, strokeId)) {
    if (tr.effect !== 'penReplay' && tr.effect !== 'drawOn') continue;
    const start = base + (tr.at || 0);
    const end = start + (tr.dur || 0);
    if (t >= end) prog = Math.max(prog, 1);
    else if (t >= start) prog = Math.max(prog, evalTrack(tr, t, base));
  }
  return prog;
}

export function getClock() { return clock; }

export function play(on) {
  clock.playing = !!on;
  clock._last = performance.now();
  if (on && clock.mode === 'manual' && clock._stepEnd == null) {
    nextStep();
    return;
  }
  syncTransportUI();
  hooks.mark?.();
}

export function seek(t) {
  clock.t = Math.max(0, Math.min(sceneDuration(hooks.page?.()), t));
  clock._stepEnd = null;
  syncTransportUI();
  hooks.mark?.();
}

export function reset() {
  clock.playing = false;
  clock.t = 0;
  clock.stepIndex = -1;
  clock._stepEnd = null;
  syncTransportUI();
  hooks.mark?.();
}

function stepByIndex(page, i) {
  const sc = ensureScene(page);
  return sc.steps[i] || null;
}

function stepGlobalEnd(st) {
  return (st.at || 0) + stepEndTime(st);
}

export function nextStep() {
  const pg = hooks.page?.();
  if (!pg) return;
  const sc = ensureScene(pg);
  if (!sc.steps.length) return;
  clock.stepIndex = Math.min(clock.stepIndex + 1, sc.steps.length - 1);
  const st = sc.steps[clock.stepIndex];
  clock.t = st.at || 0;
  clock._stepEnd = stepGlobalEnd(st);
  clock.playing = true;
  clock._last = performance.now();
  syncTransportUI();
  hooks.mark?.();
}

export function prevStep() {
  const pg = hooks.page?.();
  if (!pg) return;
  const sc = ensureScene(pg);
  if (!sc.steps.length) return;
  clock.stepIndex = Math.max(clock.stepIndex - 1, 0);
  const st = sc.steps[clock.stepIndex];
  clock.t = st.at || 0;
  clock._stepEnd = stepGlobalEnd(st);
  clock.playing = false;
  syncTransportUI();
  hooks.mark?.();
}

export function tick(now) {
  const pg = hooks.page?.();
  if (!pg?.scene?.steps?.length) return false;
  ensureScene(pg);
  clock.mode = pg.scene.mode || 'manual';
  if (!clock.playing) return false;
  const dt = (now - (clock._last || now)) / 1000;
  clock._last = now;
  const dur = sceneDuration(pg);
  if (clock.mode === 'auto') {
    clock.t += dt;
    if (clock.t >= dur) {
      clock.t = dur;
      clock.playing = false;
    }
  } else {
    clock.t += dt;
    if (clock._stepEnd != null && clock.t >= clock._stepEnd) {
      clock.t = clock._stepEnd;
      clock.playing = false;
      clock._stepEnd = null;
    }
  }
  syncTransportUI();
  return true;
}

export function sceneTime() {
  const pg = hooks.page?.();
  if (!pg?.scene?.steps?.length) return 0;
  return clock.t;
}

export function sceneNormalized() {
  const pg = hooks.page?.();
  const dur = sceneDuration(pg);
  if (!dur) return 0;
  return clock.t / dur;
}

export function onPageChange() {
  clock.t = 0;
  clock.playing = false;
  clock.stepIndex = -1;
  clock._stepEnd = null;
  clock._last = performance.now();
  const pg = hooks.page?.();
  if (pg?.scene) clock.mode = pg.scene.mode || 'manual';
  syncTransportUI();
  renderStepChips();
}

// ---- penReplay duration from stroke path length ------------------------------
export function strokePathLength(stroke) {
  const pts = stroke?.points;
  if (!pts || pts.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

export function penReplayDuration(stroke) {
  const len = strokePathLength(stroke);
  return Math.max(0.25, len / PEN_REPLAY_PX_PER_SEC);
}

// ---- record mode -------------------------------------------------------------
function currentStep(page) {
  const sc = ensureScene(page);
  if (!sc.steps.length) {
    const st = { id: genId(), label: 'Step 1', tracks: [] };
    sc.steps.push(st);
    recomputeStepStarts(sc);
  }
  const idx = Math.max(0, Math.min(clock.stepIndex >= 0 ? clock.stepIndex : sc.steps.length - 1, sc.steps.length - 1));
  return sc.steps[idx];
}

export function recordStroke(stroke) {
  if (!recording || !stroke?.id) return;
  const pg = hooks.page?.();
  if (!pg) return;
  const sc = ensureScene(pg);
  const st = currentStep(pg);
  st.tracks.push({
    target: stroke.id,
    effect: 'penReplay',
    at: stepEndTime(st),
    dur: penReplayDuration(stroke),
    ease: 'linear',
  });
  recomputeStepStarts(sc);
  renderStepChips();
  syncTransportUI();
}

export function recordObject(obj) {
  if (!recording || !obj?.id) return;
  const pg = hooks.page?.();
  if (!pg) return;
  const sc = ensureScene(pg);
  const st = currentStep(pg);
  const at = stepEndTime(st);
  st.tracks.push(
    { target: obj.id, effect: 'fadeIn', at, dur: 0.45, ease: 'easeOut' },
    { target: obj.id, effect: 'drawOn', at: at + 0.05, dur: 0.85, ease: 'easeOut' },
  );
  recomputeStepStarts(sc);
  renderStepChips();
  syncTransportUI();
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function addStep() {
  const pg = hooks.page?.();
  if (!pg) return;
  hooks.beginAction?.();
  const sc = ensureScene(pg);
  const n = sc.steps.length + 1;
  sc.steps.push({ id: genId(), label: `Step ${n}`, tracks: [] });
  recomputeStepStarts(sc);
  clock.stepIndex = sc.steps.length - 1;
  hooks.commitAction?.();
  renderStepChips();
  syncTransportUI();
  hooks.mark?.();
  showSceneBar();
}

function seekToStep(i) {
  const pg = hooks.page?.();
  if (!pg) return;
  const sc = ensureScene(pg);
  if (i < 0 || i >= sc.steps.length) return;
  clock.stepIndex = i;
  clock.t = stepGlobalEnd(sc.steps[i]);
  clock.playing = false;
  clock._stepEnd = null;
  syncTransportUI();
  hooks.mark?.();
}

function toggleMode() {
  const pg = hooks.page?.();
  if (!pg) return;
  hooks.beginAction?.();
  const sc = ensureScene(pg);
  sc.mode = sc.mode === 'auto' ? 'manual' : 'auto';
  clock.mode = sc.mode;
  hooks.commitAction?.();
  syncTransportUI();
}

// ---- UI ----------------------------------------------------------------------
function showSceneBar() {
  document.getElementById('demo-bar')?.classList.remove('hidden');
}

function syncTransportUI() {
  const pg = hooks.page?.();
  const dur = sceneDuration(pg);
  const slider = document.getElementById('scene-slider') || document.getElementById('demo-slider');
  const val = document.getElementById('scene-val') || document.getElementById('demo-val');
  if (slider) slider.value = dur ? Math.round((clock.t / dur) * 1000) : 0;
  if (val) val.textContent = `${clock.t.toFixed(1)}s`;
  const playBtn = document.getElementById('scene-play') || document.getElementById('demo-play');
  if (playBtn) {
    playBtn.textContent = clock.playing ? '❚❚' : '▶';
    playBtn.classList.toggle('brand-toggle-active', clock.playing);
  }
  const modeBtn = document.getElementById('scene-mode');
  if (modeBtn && pg?.scene) modeBtn.textContent = pg.scene.mode === 'auto' ? 'Auto' : 'Manual';
  const recBtn = document.getElementById('scene-record');
  if (recBtn) recBtn.classList.toggle('brand-toggle-active', recording);
  renderStepChips();
}

function renderStepChips() {
  const strip = document.getElementById('scene-steps');
  if (!strip) return;
  const pg = hooks.page?.();
  const sc = pg?.scene;
  strip.innerHTML = '';
  if (!sc?.steps?.length) return;
  sc.steps.forEach((st, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'scene-chip' + (i === clock.stepIndex ? ' active' : '');
    chip.textContent = st.label || `Step ${i + 1}`;
    chip.title = `Seek to end of ${st.label || `step ${i + 1}`}`;
    chip.onclick = () => seekToStep(i);
    strip.appendChild(chip);
  });
}

export function setupScene(h) {
  hooks = h;

  document.getElementById('scene-prev')?.addEventListener('click', prevStep);
  document.getElementById('scene-next')?.addEventListener('click', nextStep);
  document.getElementById('scene-play')?.addEventListener('click', () => {
    const pg = hooks.page?.();
    if (pg?.scene?.mode === 'manual' && !clock.playing) nextStep();
    else play(!clock.playing);
  });
  document.getElementById('scene-reset')?.addEventListener('click', reset);
  document.getElementById('scene-add-step')?.addEventListener('click', addStep);
  document.getElementById('scene-mode')?.addEventListener('click', toggleMode);
  document.getElementById('scene-record')?.addEventListener('click', () => {
    recording = !recording;
    if (recording) {
      const pg = hooks.page?.();
      ensureScene(pg);
      showSceneBar();
    }
    syncTransportUI();
  });
  document.getElementById('scene-slider')?.addEventListener('input', (e) => {
    if (clock.playing) play(false);
    const dur = sceneDuration(hooks.page?.());
    seek((+e.target.value || 0) / 1000 * dur);
  });
  document.getElementById('scene-next-hotspot')?.addEventListener('click', nextStep);

  window.addEventListener('keydown', (e) => {
    if (document.getElementById('editor')?.classList.contains('hidden')) return;
    if (/^(INPUT|TEXTAREA|SELECT|MATH-FIELD)$/.test(e.target?.tagName)) return;
    const pg = hooks.page?.();
    if (!pg?.scene?.steps?.length) return;
    if (e.key === ' ' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      nextStep();
    } else if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey && !document.getElementById('editor')?.classList.contains('present-mode')) {
      e.preventDefault();
      nextStep();
    }
  });

  syncTransportUI();
}

export function isRecording() { return recording; }
