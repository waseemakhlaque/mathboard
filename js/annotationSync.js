// annotationSync.js — two-way binding between lab readouts and page text labels.

import { simByTag } from './anim/ragRoutes.js';

/** Regex + formatters for common lab params (Greek + ASCII). */
const SYNC = {
  theta: {
    patterns: [/θ\s*=\s*([\d.]+)\s*°/gi, /theta\s*=\s*([\d.]+)\s*°?/gi],
    format: (v) => `θ = ${Math.round(Number(v))}°`,
    parse: (m) => Number(m[1]),
  },
  mu: {
    patterns: [/μ\s*=\s*([\d.]+)/gi, /mu\s*=\s*([\d.]+)/gi],
    format: (v) => `μ = ${Number(v).toFixed(2)}`,
    parse: (m) => Number(m[1]),
  },
  u: {
    patterns: [/u\s*=\s*([\d.]+)\s*(?:m\/s)?/gi],
    format: (v) => `u = ${Number(v).toFixed(1)} m/s`,
    parse: (m) => Number(m[1]),
  },
  a: {
    patterns: [/a\s*=\s*([-\d.]+)\s*(?:m\/s²|m\/s2)?/gi],
    format: (v) => `a = ${Number(v).toFixed(1)} m/s²`,
    parse: (m) => Number(m[1]),
  },
  m1: {
    patterns: [/m[₁1]\s*=\s*([\d.]+)\s*(?:kg)?/gi],
    format: (v) => `m₁ = ${Number(v).toFixed(1)} kg`,
    parse: (m) => Number(m[1]),
  },
  m2: {
    patterns: [/m[₂2]\s*=\s*([\d.]+)\s*(?:kg)?/gi],
    format: (v) => `m₂ = ${Number(v).toFixed(1)} kg`,
    parse: (m) => Number(m[1]),
  },
  g: {
    patterns: [/g\s*=\s*([\d.]+)\s*(?:m\/s²|m\/s2)?/gi],
    format: (v) => `g = ${Number(v).toFixed(1)} m/s²`,
    parse: (m) => Number(m[1]),
  },
};

const DEBOUNCE_MS = 80;

/** Read live values from a mounted lab element. */
export function readLabState(el, tag) {
  const sim = simByTag(tag);
  const out = {};
  for (const key of Object.keys(sim?.paramSchema || {})) {
    if (el[key] === undefined) continue;
    let v = el[key];
    if (key === 'theta' && typeof v === 'number' && Math.abs(v) <= Math.PI) v = v * 180 / Math.PI;
    out[key] = v;
  }
  return out;
}

/** Scan page text objects for param hints (e.g. "θ = 25°" → { theta: 25 }). */
export function parseLabelsFromObjects(objects) {
  const params = {};
  for (const o of objects || []) {
    if (o.kind !== 'text' || !o.text) continue;
    for (const [key, spec] of Object.entries(SYNC)) {
      if (params[key] !== undefined) continue;
      for (const re of spec.patterns) {
        re.lastIndex = 0;
        const m = re.exec(o.text);
        if (m) { params[key] = spec.parse(m); break; }
      }
    }
  }
  return params;
}

/** Collect text objects tied to a param key. */
function labelHits(objects, key) {
  const spec = SYNC[key];
  if (!spec) return [];
  const hits = [];
  for (const o of objects || []) {
    if (o.kind !== 'text' || !o.text) continue;
    for (const re of spec.patterns) {
      re.lastIndex = 0;
      const m = re.exec(o.text);
      if (m) { hits.push({ obj: o, match: m[0], re }); break; }
    }
  }
  return hits;
}

export class AnnotationSyncBridge {
  /**
   * @param {{ getObjs:()=>object[], mark:()=>void, persist:()=>void,
   *          beginAction:()=>void, commitAction:()=>void, uid:()=>string,
   *          onReadout?:(s:string)=>void }} hooks
   */
  constructor(hooks) {
    this.hooks = hooks;
    this._lab = null;
    this._tag = null;
    this._timer = 0;
    this._dirty = false;
    this._origRefresh = null;
  }

  /** Parse labels on the page → sim init params. */
  getLabels() {
    return parseLabelsFromObjects(this.hooks.getObjs());
  }

  /** Ensure at least one sync label exists (placed in annotation region). */
  ensureLabels(tag, params, box) {
    const sim = simByTag(tag);
    if (!sim) return;
    const objs = this.hooks.getObjs();
    let added = false;
    const x0 = box?.x ?? 80;
    const y0 = box?.y ?? 80;
    let row = 0;
    for (const key of Object.keys(sim.paramSchema || {})) {
      if (labelHits(objs, key).length) continue;
      const spec = SYNC[key];
      if (!spec) continue;
      const val = params[key] ?? sim.paramSchema[key].default;
      objs.push({
        id: this.hooks.uid(),
        kind: 'text',
        at: { x: x0, y: y0 + row * 42 },
        text: spec.format(val),
        color: '#2566c8',
        size: 28,
        _annotSim: key,
      });
      row++;
      added = true;
    }
    if (added) { this.hooks.mark(); this.hooks.persist(); }
  }

  /** Hook lab.refresh() → debounced label updates. */
  attach(labEl, tag) {
    this.detach();
    this._lab = labEl;
    this._tag = tag;
    this._origRefresh = labEl.refresh.bind(labEl);
    labEl.refresh = () => {
      this._origRefresh();
      this._scheduleSync();
      this.hooks.onReadout?.(labEl.readout?.() || '');
    };
    this._scheduleSync(true);
  }

  detach() {
    clearTimeout(this._timer);
    if (this._lab && this._origRefresh) this._lab.refresh = this._origRefresh;
    this._lab = null;
    this._tag = null;
    this._origRefresh = null;
    if (this._dirty) { this._dirty = false; this.hooks.commitAction?.(); }
  }

  _scheduleSync(immediate) {
    clearTimeout(this._timer);
    if (immediate) { this._pushToLabels(); return; }
    this._timer = setTimeout(() => this._pushToLabels(), DEBOUNCE_MS);
  }

  _pushToLabels() {
    if (!this._lab || !this._tag) return;
    const state = readLabState(this._lab, this._tag);
    const objs = this.hooks.getObjs();
    let changed = false;
    for (const [key, val] of Object.entries(state)) {
      const spec = SYNC[key];
      if (!spec) continue;
      const hits = labelHits(objs, key);
      const next = spec.format(val);
      if (!hits.length) continue;
      for (const { obj, re } of hits) {
        re.lastIndex = 0;
        const updated = obj.text.replace(re, next);
        if (updated !== obj.text) {
          if (!changed) { this.hooks.beginAction(); changed = true; this._dirty = true; }
          obj.text = updated;
        }
      }
    }
    if (changed) { this.hooks.mark(); this.hooks.persist(); }
  }
}
