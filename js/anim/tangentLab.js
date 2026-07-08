// tangentLab.js — <mb-tangent-lab>: cubic curve with draggable point P; tangent +
// normal drawn live. Readout: f'(x), tangent equation, stationary points.

import { MbLab, svgEl, clamp, applyParamSchema } from './mbLab.js';

const W = 640, H = 380;
const AX = { x0: 60, y0: 300, x1: 580, y1: 40 };
const X_MIN = -3, X_MAX = 3, Y_MIN = -8, Y_MAX = 8;

const SCHEMA = {
  a: { type: 'number', min: -2, max: 2, default: 1, unit: '', label: 'x³ coeff' },
  b: { type: 'number', min: -5, max: 5, default: 0, unit: '', label: 'x² coeff' },
  c: { type: 'number', min: -5, max: 5, default: -3, unit: '', label: 'x coeff' },
  d: { type: 'number', min: -5, max: 5, default: 0, unit: '', label: 'constant' },
  x0: { type: 'number', min: X_MIN, max: X_MAX, default: 1, unit: '', label: 'Point x' },
};

const gx = (x) => AX.x0 + ((x - X_MIN) / (X_MAX - X_MIN)) * (AX.x1 - AX.x0);
const gy = (y) => AX.y0 - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * (AX.y0 - AX.y1);
const xOfGx = (px) => X_MIN + ((px - AX.x0) / (AX.x1 - AX.x0)) * (X_MAX - X_MIN);

export class MbTangentLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag the red point along the curve. Tangent and normal update live; stationary points marked.'; }

  reset() {
    const p = applyParamSchema(this, SCHEMA);
    this.a = Math.abs(p.a) < 0.05 ? 0.5 : p.a;
    this.b = p.b;
    this.c = p.c;
    this.d = p.d;
    this.x0 = p.x0;
  }

  fx(x) { return this.a * x ** 3 + this.b * x ** 2 + this.c * x + this.d; }
  dfx(x) { return 3 * this.a * x ** 2 + 2 * this.b * x + this.c; }
  ddfx(x) { return 6 * this.a * x + 2 * this.b; }

  stationaryPoints() {
    const A = 3 * this.a, B = 2 * this.b, C = this.c;
    if (Math.abs(A) < 1e-9) {
      if (Math.abs(B) < 1e-9) return [];
      const x = -C / B;
      return x >= X_MIN && x <= X_MAX ? [x] : [];
    }
    const D = B * B - 4 * A * C;
    if (D < 0) return [];
    const s = Math.sqrt(D);
    return [(-B - s) / (2 * A), (-B + s) / (2 * A)].filter((x) => x >= X_MIN && x <= X_MAX);
  }

  buildScene() {
    this.reset();
    this.gAxes = svgEl('g');
    this.gCurve = svgEl('g');
    this.gTan = svgEl('g');
    this.gStat = svgEl('g');
    this.pHandle = svgEl('circle', { r: 9, fill: '#e5735a' });
    this.svg.append(this.gAxes, this.gCurve, this.gTan, this.gStat, this.pHandle);
    this.makeDraggable(this.pHandle, (pt) => {
      this.x0 = clamp(xOfGx(pt.x), X_MIN, X_MAX);
    });
  }

  curvePath() {
    let d = '';
    for (let i = 0; i <= 120; i++) {
      const x = X_MIN + (i / 120) * (X_MAX - X_MIN);
      const y = this.fx(x);
      d += `${d ? 'L' : 'M'} ${gx(x).toFixed(1)} ${gy(y).toFixed(1)} `;
    }
    return d;
  }

  renderScene() {
    this.gAxes.replaceChildren(
      svgEl('line', { x1: gx(0), y1: AX.y0, x2: gx(0), y2: AX.y1, stroke: 'var(--text-3, #888)' }),
      svgEl('line', { x1: AX.x0, y1: gy(0), x2: AX.x1, y2: gy(0), stroke: 'var(--text-3, #888)' }),
    );
    this.gCurve.replaceChildren(
      svgEl('path', { d: this.curvePath(), fill: 'none', stroke: 'var(--accent, #4a7dff)', 'stroke-width': 2.5 }),
    );

    const x = this.x0, y = this.fx(x), m = this.dfx(x);
    const px = gx(x), py = gy(y);
    this.pHandle.setAttribute('cx', px);
    this.pHandle.setAttribute('cy', py);

    const span = 1.8;
    const x1 = x - span, x2 = x + span;
    const tanPts = [[gx(x1), gy(y + m * (x1 - x))], [gx(x2), gy(y + m * (x2 - x))]];
    const nLen = 1.2;
    const nx = -m, ny = 1;
    const nrm = Math.hypot(nx, ny) || 1;
    const normPts = [[px, py], [px + (nx / nrm) * nLen * 40, py - (ny / nrm) * nLen * 40]];

    this.gTan.replaceChildren(
      svgEl('line', { x1: tanPts[0][0], y1: tanPts[0][1], x2: tanPts[1][0], y2: tanPts[1][1], stroke: '#c78a2d', 'stroke-width': 2 }),
      svgEl('line', { x1: normPts[0][0], y1: normPts[0][1], x2: normPts[1][0], y2: normPts[1][1], stroke: '#3bb273', 'stroke-width': 2, 'stroke-dasharray': '6 4' }),
    );

    this.gStat.replaceChildren();
    for (const sx of this.stationaryPoints()) {
      this.gStat.append(svgEl('circle', { cx: gx(sx), cy: gy(this.fx(sx)), r: 5, fill: 'none', stroke: 'var(--text-3, #888)', 'stroke-width': 2 }));
    }
  }

  readout() {
    const x = this.x0, y = this.fx(x), m = this.dfx(x);
    const c = y - m * x;
    const stats = this.stationaryPoints();
    const statTxt = stats.length
      ? stats.map((s) => `(${s.toFixed(2)}, ${this.fx(s).toFixed(2)})`).join(', ')
      : 'none in range';
    return `f'(${x.toFixed(2)}) = ${m.toFixed(2)} · tangent: y = ${m.toFixed(2)}x ${c >= 0 ? '+' : '−'} ${Math.abs(c).toFixed(2)} · stationary: ${statTxt}`;
  }

  tick() { return false; }
}

export { SCHEMA as TANGENT_SCHEMA };
customElements.define('mb-tangent-lab', MbTangentLab);
