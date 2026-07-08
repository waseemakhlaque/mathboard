// suvatLab.js — <mb-suvat-lab>: drag the green u-arrow head to set initial
// velocity, drag the orange slope handle on the v–t graph to set acceleration.
// ▶ Run animates the particle and traces v = u + at with shaded displacement.

import { MbLab, svgEl, drawArrow, clamp, G, applyParamSchema } from './mbLab.js';

const W = 640, H = 380;
const TRACK = { x: 90, top: 40, bot: 320 };
const GRAPH = { x0: 210, y0: 300, x1: 600, y1: 40 };
const T_MAX = 4;      // seconds simulated
const V_MAX = 30;     // m/s axis range

export class MbSuvatLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag the green arrow (u) and the orange handle (a), then ▶ Run. Try u = 20, a = −9.8 for vertical throw.'; }

  reset() {
    const p = applyParamSchema(this, {
      u: { type: 'number', min: -30, max: 30, default: 20, unit: 'm/s', label: 'Initial velocity u' },
      a: { type: 'number', min: -20, max: 20, default: -G, unit: 'm/s²', label: 'Acceleration a' },
    });
    this.u = p.u; this.a = p.a;
    this.tau = 0;
  }

  buildScene() {
    this.reset();
    const s = this.svg;
    this.gAxes = svgEl('g');
    this.gArea = svgEl('g');
    this.gLine = svgEl('g');
    this.gTrack = svgEl('g');
    this.gUArrow = svgEl('g');
    this.uHandle = svgEl('circle', { r: 9, fill: '#3bb273' });
    this.aHandle = svgEl('circle', { r: 9, fill: '#c78a2d' });
    s.append(this.gAxes, this.gArea, this.gLine, this.gTrack, this.gUArrow, this.uHandle, this.aHandle);

    this.makeDraggable(this.uHandle, (p) => {
      this.u = clamp(Math.round((this.gy2v(p.y)) * 2) / 2, -V_MAX, V_MAX);
      this.tau = 0;
    });
    this.makeDraggable(this.aHandle, (p) => {
      const vEnd = clamp(this.gy2v(p.y), -V_MAX, V_MAX);
      this.a = Math.round(((vEnd - this.u) / T_MAX) * 10) / 10;
      this.tau = 0;
    });
  }

  gx(t) { return GRAPH.x0 + (t / T_MAX) * (GRAPH.x1 - GRAPH.x0); }
  gy(v) { return (GRAPH.y0 + GRAPH.y1) / 2 - (v / V_MAX) * ((GRAPH.y0 - GRAPH.y1) / 2); }
  gy2v(y) { return (((GRAPH.y0 + GRAPH.y1) / 2 - y) / ((GRAPH.y0 - GRAPH.y1) / 2)) * V_MAX; }

  sAt(t) { return this.u * t + 0.5 * this.a * t * t; }
  vAt(t) { return this.u + this.a * t; }

  tick(dt) {
    this.tau = Math.min(T_MAX, this.tau + dt);
    return this.tau < T_MAX;
  }

  renderScene() {
    // axes
    this.gAxes.replaceChildren(
      svgEl('line', { x1: GRAPH.x0, y1: this.gy(0), x2: GRAPH.x1, y2: this.gy(0), stroke: 'var(--text-3, #888)' }),
      svgEl('line', { x1: GRAPH.x0, y1: GRAPH.y0, x2: GRAPH.x0, y2: GRAPH.y1, stroke: 'var(--text-3, #888)' }),
      svgEl('line', { x1: TRACK.x, y1: TRACK.top, x2: TRACK.x, y2: TRACK.bot, stroke: 'var(--text-3, #888)', 'stroke-width': 2 }),
      ...['t', 'v'].map((n, i) => {
        const t = svgEl('text', { x: i ? GRAPH.x0 - 16 : GRAPH.x1 - 8, y: i ? GRAPH.y1 + 10 : this.gy(0) + 16, 'font-size': 12, fill: 'var(--text-3, #888)' });
        t.textContent = n; return t;
      }),
    );

    // displacement scale on the track
    let sMin = 0, sMax = 0;
    for (let i = 0; i <= 100; i++) {
      const s = this.sAt((i / 100) * T_MAX);
      sMin = Math.min(sMin, s); sMax = Math.max(sMax, s);
    }
    const span = sMax - sMin || 1;
    const yOfS = (s) => TRACK.bot - ((s - sMin) / span) * (TRACK.bot - TRACK.top);

    // particle + u arrow (u arrow always drawn from the start position)
    const y0 = yOfS(0);
    const s = this.sAt(this.tau);
    this.gTrack.replaceChildren(
      svgEl('line', { x1: TRACK.x - 12, y1: y0, x2: TRACK.x + 12, y2: y0, stroke: 'var(--text-3, #888)', 'stroke-dasharray': '3 3' }),
      svgEl('circle', { cx: TRACK.x, cy: yOfS(s), r: 9, fill: 'var(--accent, #4a7dff)' }),
    );
    const uLen = (this.u / V_MAX) * 90;
    drawArrow(this.gUArrow, TRACK.x, y0, TRACK.x, y0 - uLen, '#3bb273', `u = ${this.u} m/s`);
    this.uHandle.setAttribute('cx', TRACK.x);
    this.uHandle.setAttribute('cy', this.gy(this.u));
    // u handle actually lives on the graph's v-intercept for precise dragging:
    // (drawn above at gy(u)); a handle sits at the line's end
    this.aHandle.setAttribute('cx', this.gx(T_MAX));
    this.aHandle.setAttribute('cy', this.gy(this.vAt(T_MAX)));

    // shaded area up to tau + full faint line + progress line
    const shade = [`${this.gx(0)},${this.gy(0)}`];
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * this.tau;
      shade.push(`${this.gx(t)},${this.gy(this.vAt(t))}`);
    }
    shade.push(`${this.gx(this.tau)},${this.gy(0)}`);
    this.gArea.replaceChildren(svgEl('polygon', { points: shade.join(' '), fill: 'var(--accent, #4a7dff)', opacity: 0.18 }));
    this.gLine.replaceChildren(
      svgEl('line', { x1: this.gx(0), y1: this.gy(this.u), x2: this.gx(T_MAX), y2: this.gy(this.vAt(T_MAX)), stroke: 'var(--text-3, #888)', 'stroke-dasharray': '4 4' }),
      svgEl('line', { x1: this.gx(0), y1: this.gy(this.u), x2: this.gx(this.tau), y2: this.gy(this.vAt(this.tau)), stroke: 'var(--accent, #4a7dff)', 'stroke-width': 2.5 }),
      svgEl('circle', { cx: this.gx(this.tau), cy: this.gy(this.vAt(this.tau)), r: 5, fill: 'var(--accent, #4a7dff)' }),
    );
  }

  readout() {
    const t = this.tau, v = this.vAt(t), s = this.sAt(t);
    const turn = this.a !== 0 ? -this.u / this.a : NaN;
    const turnTxt = turn > 0 && turn < T_MAX ? ` · v = 0 at t = ${turn.toFixed(2)} s` : '';
    return `u = ${this.u} m/s, a = ${this.a} m/s² · t = ${t.toFixed(2)} s → v = u+at = ${v.toFixed(2)} m/s, s = ut+½at² = ${s.toFixed(2)} m${turnTxt}`;
  }
}

customElements.define('mb-suvat-lab', MbSuvatLab);
