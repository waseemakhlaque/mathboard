// motionGraphLab.js — <mb-motion-graph-lab>: multi-stage v–t graph builder.
// Draggable vertices on the graph to create custom multi-stage motion profiles.

import { MbLab, svgEl, clamp } from './mbLab.js';

const W = 640, H = 380;
const GRAPH = { x0: 80, y0: 320, x1: 600, y1: 60 };
const T_MAX = 10, V_MAX = 25;

export class MbMotionGraphLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag the vertices to reshape the v–t graph. ▶ Run animates the motion.'; }

  reset() {
    this.points = [
      { t: 0, v: 0 },
      { t: 3, v: 15 },
      { t: 5, v: 15 },
      { t: 8, v: 0 },
    ];
    this.tau = 0;
  }

  buildScene() {
    this.reset();
    const s = this.svg;
    this.gAxes = svgEl('g');
    this.gLine = svgEl('g');
    this.gDots = svgEl('g');
    s.append(this.gAxes, this.gLine, this.gDots);

    this.makeDraggable(this.gDots, (p) => {
      const t = clamp((p.x - GRAPH.x0) / (GRAPH.x1 - GRAPH.x0) * T_MAX, 0, T_MAX);
      const v = clamp((GRAPH.y0 - p.y) / (GRAPH.y0 - GRAPH.y1) * V_MAX, 0, V_MAX);
      const nearest = this.points.reduce((a, b, i, arr) =>
        Math.hypot(t - a.t, v - a.v) < Math.hypot(t - b.t, v - b.v) ? a : b
      );
      nearest.t = t; nearest.v = v;
      this.points.sort((a, b) => a.t - b.t);
      this.tau = 0;
    });
  }

  gx(t) { return GRAPH.x0 + (t / T_MAX) * (GRAPH.x1 - GRAPH.x0); }
  gy(v) { return GRAPH.y0 - (v / V_MAX) * (GRAPH.y0 - GRAPH.y1); }

  vAt(t) {
    const i = this.points.findIndex((p) => p.t >= t);
    if (i === 0) return this.points[0].v;
    if (i === -1) return this.points[this.points.length - 1].v;
    const p0 = this.points[i - 1], p1 = this.points[i];
    const frac = (t - p0.t) / (p1.t - p0.t);
    return p0.v + (p1.v - p0.v) * frac;
  }

  tick(dt) {
    this.tau = Math.min(T_MAX, this.tau + dt);
    return this.tau < T_MAX;
  }

  renderScene() {
    // Axes
    this.gAxes.replaceChildren(
      svgEl('line', { x1: GRAPH.x0, y1: GRAPH.y0, x2: GRAPH.x1, y2: GRAPH.y0, stroke: 'var(--text-3)', 'stroke-width': 1 }),
      svgEl('line', { x1: GRAPH.x0, y1: GRAPH.y0, x2: GRAPH.x0, y2: GRAPH.y1, stroke: 'var(--text-3)', 'stroke-width': 1 }),
      svgEl('text', { x: GRAPH.x1 + 4, y: GRAPH.y0 + 4, 'font-size': 11, fill: 'var(--text-3)' }).appendChild(
        document.createTextNode('t (s)')
      ) || svgEl('text', { x: GRAPH.x1 + 4, y: GRAPH.y0 + 4, 'font-size': 11, fill: 'var(--text-3)', textContent: 't (s)' }),
      svgEl('text', { x: GRAPH.x0 - 16, y: GRAPH.y1 - 4, 'font-size': 11, fill: 'var(--text-3)', textContent: 'v (m/s)' }),
    );

    // Dotted line (full range)
    const linePath = this.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${this.gx(p.t)} ${this.gy(p.v)}`).join(' ');
    this.gLine.replaceChildren(
      svgEl('path', { d: linePath, fill: 'none', stroke: 'var(--text-3)', 'stroke-dasharray': '4 2' }),
      svgEl('path', {
        d: this.points.filter((_, i) => {
          const end = this.points.findIndex((p) => p.t >= this.tau);
          return end === -1 ? i < this.points.length : i <= end;
        }).map((p, i, arr) => `${i === 0 ? 'M' : 'L'} ${this.gx(p.t)} ${this.gy(p.v)}`).join(' '),
        fill: 'none',
        stroke: 'var(--accent)',
        'stroke-width': 2,
      }),
    );

    // Draggable dots
    this.gDots.replaceChildren();
    for (const p of this.points) {
      this.gDots.append(svgEl('circle', { cx: this.gx(p.t), cy: this.gy(p.v), r: 5, fill: 'var(--accent)', class: 'mb-drag-handle' }));
    }
  }

  readout() {
    const v = this.vAt(this.tau);
    const i = this.points.findIndex((p) => p.t >= this.tau);
    const stage = i === -1 ? this.points.length : i + 1;
    return `t = ${this.tau.toFixed(2)} s · v = ${v.toFixed(2)} m/s · stage ${stage}/${this.points.length}`;
  }
}

customElements.define('mb-motion-graph-lab', MbMotionGraphLab);
