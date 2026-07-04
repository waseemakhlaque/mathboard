// mbLab.js — base class for interactive physics labs (drag-to-explore).
// Unlike MbAnim's 0→1 timeline, labs run a continuous sim loop and expose
// draggable SVG handles that change parameters live.
// Subclass API: buildScene() once, renderScene() every change, tick(dt) while
// running (return false to stop), readout() → string for the values bar.

import { svgEl } from './mbAnim.js';

export { svgEl };

export const G = 9.8;

export class MbLab extends HTMLElement {
  connectedCallback() {
    this.running = false;
    this._raf = 0;
    this._last = 0;

    this.classList.add('mb-anim', 'mb-lab');
    this.svg = svgEl('svg', { viewBox: this.viewBox, class: 'mb-anim-svg' });
    const controls = document.createElement('div');
    controls.className = 'mb-anim-controls';
    this._runBtn = document.createElement('button');
    this._runBtn.type = 'button';
    this._runBtn.textContent = '▶ Run';
    this._runBtn.style.width = 'auto';
    this._runBtn.addEventListener('click', () => (this.running ? this.stop() : this.run()));
    this._resetBtn = document.createElement('button');
    this._resetBtn.type = 'button';
    this._resetBtn.textContent = '↺ Reset';
    this._resetBtn.style.width = 'auto';
    this._resetBtn.addEventListener('click', () => { this.stop(); this.reset(); this.refresh(); });
    controls.append(this._runBtn, this._resetBtn);
    this._readout = document.createElement('div');
    this._readout.className = 'mb-lab-readout';
    this._hint = document.createElement('div');
    this._hint.className = 'mb-anim-caption';
    this._hint.textContent = this.hint;
    this.replaceChildren(this.svg, controls, this._readout, this._hint);
    this.buildScene();
    this.refresh();
  }

  disconnectedCallback() { this.stop(); }

  get viewBox() { return '0 0 640 380'; }
  get hint() { return ''; }
  buildScene() {}
  renderScene() {}
  tick(_dt) { return false; }
  reset() {}
  readout() { return ''; }

  refresh() {
    this.renderScene();
    this._readout.textContent = this.readout();
  }

  run() {
    this.running = true;
    this._runBtn.textContent = '⏸ Stop';
    this._last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      const alive = this.tick(dt);
      this.refresh();
      if (alive && this.running) this._raf = requestAnimationFrame(loop);
      else this.stop();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._runBtn) this._runBtn.textContent = '▶ Run';
  }

  /** Convert a pointer event to SVG user coordinates. */
  svgPoint(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  /** Make an SVG element draggable; onMove receives ({x, y}) in SVG coords. */
  makeDraggable(el, onMove) {
    el.classList.add('mb-drag-handle');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stop();
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
      el.classList.add('is-dragging');
      const move = (ev) => { onMove(this.svgPoint(ev)); this.refresh(); };
      const up = () => {
        el.classList.remove('is-dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Parse `params` attribute against a registry paramSchema object. */
export function applyParamSchema(el, schema) {
  let raw = {};
  try { raw = JSON.parse(el.getAttribute('params') || '{}'); } catch (_) { /* bad JSON */ }
  const out = {};
  for (const [k, spec] of Object.entries(schema)) {
    let v = raw[k] ?? spec.default;
    if (spec.type === 'number') {
      v = Number(v);
      if (Number.isNaN(v)) v = spec.default;
      out[k] = clamp(v, spec.min, spec.max);
    } else out[k] = v;
  }
  return out;
}

/** Arrow with head, updated in place: pass a <g>, start, end, color, label. */
export function drawArrow(g, x1, y1, x2, y2, color, label) {
  g.replaceChildren();
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const ux = dx / len, uy = dy / len;
  const hx = x2 - ux * 10, hy = y2 - uy * 10;
  g.append(svgEl('line', { x1, y1, x2: hx, y2: hy, stroke: color, 'stroke-width': 2.5 }));
  g.append(svgEl('polygon', {
    points: `${x2},${y2} ${hx - uy * 5},${hy + ux * 5} ${hx + uy * 5},${hy - ux * 5}`,
    fill: color,
  }));
  if (label) {
    const t = svgEl('text', { x: x2 + ux * 8 + 4, y: y2 + uy * 8, 'font-size': 12, fill: color });
    t.textContent = label;
    g.append(t);
  }
}
