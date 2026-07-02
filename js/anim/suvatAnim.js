// suvatAnim.js — <mb-suvat-anim params='{"u":20,"a":-9.8,"tMax":4}'>
// Left: particle on a vertical track at s = u·τ + ½a·τ². Right: v–t graph drawn
// progressively with the area under the line (displacement) shaded.

import { MbAnim, svgEl } from './mbAnim.js';

const W = 640, H = 360;
const TRACK = { x: 90, top: 40, bot: 320 };
const GRAPH = { x0: 200, y0: 300, x1: 600, y1: 40 };

export class MbSuvatAnim extends MbAnim {
  get viewBox() { return `0 0 ${W} ${H}`; }

  get steps() {
    const { u, a, tMax } = this._p();
    const out = [{ at: 0, label: `u = ${u} m/s, a = ${a} m/s² — v = u + at, s = ut + ½at²` }];
    if (a !== 0) {
      const tTurn = -u / a;
      if (tTurn > 0 && tTurn < tMax) out.push({ at: tTurn / tMax, label: `v = 0 at t = ${tTurn.toFixed(2)} s (turning point), s = ${this._s(tTurn).toFixed(2)} m` });
    }
    out.push({ at: 1, label: `t = ${tMax} s: v = ${(u + a * tMax).toFixed(2)} m/s, s = ${this._s(tMax).toFixed(2)} m` });
    return out;
  }

  _p() {
    const { u = 20, a = -9.8, tMax = 4 } = this.params;
    return { u, a, tMax };
  }
  _s(tau) {
    const { u, a } = this._p();
    return u * tau + 0.5 * a * tau * tau;
  }

  renderFrame(t) {
    const { u, a, tMax } = this._p();
    const tau = t * tMax;
    const svg = this.svg;
    svg.replaceChildren();

    // displacement range for scaling the track
    let sMin = 0, sMax = 0;
    for (let i = 0; i <= 100; i++) {
      const s = this._s((i / 100) * tMax);
      sMin = Math.min(sMin, s); sMax = Math.max(sMax, s);
    }
    const sSpan = sMax - sMin || 1;
    const yOfS = (s) => TRACK.bot - ((s - sMin) / sSpan) * (TRACK.bot - TRACK.top);

    // track + particle
    svg.append(svgEl('line', { x1: TRACK.x, y1: TRACK.top, x2: TRACK.x, y2: TRACK.bot, stroke: 'var(--text-3, #888)', 'stroke-width': 2 }));
    svg.append(svgEl('line', { x1: TRACK.x - 14, y1: yOfS(0), x2: TRACK.x + 14, y2: yOfS(0), stroke: 'var(--text-3, #888)', 'stroke-dasharray': '3 3' }));
    const s = this._s(tau);
    svg.append(svgEl('circle', { cx: TRACK.x, cy: yOfS(s), r: 9, fill: 'var(--accent, #4a7dff)' }));
    const sLabel = svgEl('text', { x: TRACK.x + 18, y: yOfS(s) + 4, 'font-size': 13, fill: 'var(--text, #ddd)' });
    sLabel.textContent = `s = ${s.toFixed(1)} m`;
    svg.append(sLabel);

    // v–t axes
    const vMax = Math.max(Math.abs(u), Math.abs(u + a * tMax)) || 1;
    const gx = (τ) => GRAPH.x0 + (τ / tMax) * (GRAPH.x1 - GRAPH.x0);
    const gyMid = (GRAPH.y0 + GRAPH.y1) / 2;
    const gy = (v) => gyMid - (v / vMax) * ((GRAPH.y0 - GRAPH.y1) / 2);
    svg.append(svgEl('line', { x1: GRAPH.x0, y1: gy(0), x2: GRAPH.x1, y2: gy(0), stroke: 'var(--text-3, #888)' }));
    svg.append(svgEl('line', { x1: GRAPH.x0, y1: GRAPH.y0, x2: GRAPH.x0, y2: GRAPH.y1, stroke: 'var(--text-3, #888)' }));
    const tAxis = svgEl('text', { x: GRAPH.x1 - 8, y: gy(0) + 16, 'font-size': 12, fill: 'var(--text-3, #888)' });
    tAxis.textContent = 't';
    const vAxis = svgEl('text', { x: GRAPH.x0 - 16, y: GRAPH.y1 + 10, 'font-size': 12, fill: 'var(--text-3, #888)' });
    vAxis.textContent = 'v';
    svg.append(tAxis, vAxis);

    // shaded area under v(t) up to τ (displacement), then the line itself
    if (tau > 0) {
      const pts = [`${gx(0)},${gy(0)}`];
      for (let i = 0; i <= 60; i++) {
        const τi = (i / 60) * tau;
        pts.push(`${gx(τi)},${gy(u + a * τi)}`);
      }
      pts.push(`${gx(tau)},${gy(0)}`);
      svg.append(svgEl('polygon', { points: pts.join(' '), fill: 'var(--accent, #4a7dff)', opacity: 0.18 }));
    }
    svg.append(svgEl('line', { x1: gx(0), y1: gy(u), x2: gx(tau), y2: gy(u + a * tau), stroke: 'var(--accent, #4a7dff)', 'stroke-width': 2.5 }));
    svg.append(svgEl('circle', { cx: gx(tau), cy: gy(u + a * tau), r: 5, fill: 'var(--accent, #4a7dff)' }));
    const vLabel = svgEl('text', { x: Math.min(gx(tau) + 8, GRAPH.x1 - 90), y: gy(u + a * tau) - 8, 'font-size': 13, fill: 'var(--text, #ddd)' });
    vLabel.textContent = `v = ${(u + a * tau).toFixed(1)} m/s`;
    svg.append(vLabel);
  }
}

customElements.define('mb-suvat-anim', MbSuvatAnim);
