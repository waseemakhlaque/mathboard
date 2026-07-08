// quadraticLab.js — <mb-quadratic-lab>: y = ax²+bx+c with draggable vertex and one
// root handle; optional line y = mx + k. Readout: Δ, roots, vertex, intersections.

import { MbLab, svgEl, clamp, applyParamSchema } from './mbLab.js';

const W = 640, H = 380;
const AX = { x0: 60, y0: 300, x1: 580, y1: 40 };
const X_MIN = -4, X_MAX = 6, Y_MIN = -6, Y_MAX = 14;

const SCHEMA = {
  a: { type: 'number', min: -3, max: 3, default: 1, unit: '', label: 'Coefficient a' },
  b: { type: 'number', min: -10, max: 10, default: -2, unit: '', label: 'Coefficient b' },
  c: { type: 'number', min: -10, max: 10, default: -3, unit: '', label: 'Coefficient c' },
  lineM: { type: 'number', min: -5, max: 5, default: 1, unit: '', label: 'Line gradient m' },
  lineK: { type: 'number', min: -10, max: 10, default: 0, unit: '', label: 'Line intercept k' },
  showLine: { type: 'number', min: 0, max: 1, default: 1, unit: '', label: 'Show line (0/1)' },
};

const gx = (x) => AX.x0 + ((x - X_MIN) / (X_MAX - X_MIN)) * (AX.x1 - AX.x0);
const gy = (y) => AX.y0 - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * (AX.y0 - AX.y1);
const xOfGx = (px) => X_MIN + ((px - AX.x0) / (AX.x1 - AX.x0)) * (X_MAX - X_MIN);
const yOfGy = (py) => Y_MIN + ((AX.y0 - py) / (AX.y0 - AX.y1)) * (Y_MAX - Y_MIN);

export class MbQuadraticLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag the vertex (blue) and a root (orange). Toggle the line by setting showLine. Orange line handle sets y = mx + k.'; }

  reset() {
    const p = applyParamSchema(this, SCHEMA);
    this.a = Math.abs(p.a) < 0.05 ? 0.5 : p.a;
    this.b = p.b;
    this.c = p.c;
    this.lineM = p.lineM;
    this.lineK = p.lineK;
    this.showLine = p.showLine >= 0.5;
  }

  fx(x) { return this.a * x * x + this.b * x + this.c; }
  vertex() {
    const h = -this.b / (2 * this.a);
    return { h, k: this.fx(h) };
  }
  discriminant() { return this.b * this.b - 4 * this.a * this.c; }
  roots() {
    const D = this.discriminant();
    if (D < 0) return [];
    if (D < 1e-9) return [-this.b / (2 * this.a)];
    const s = Math.sqrt(D);
    return [(-this.b - s) / (2 * this.a), (-this.b + s) / (2 * this.a)];
  }
  lineY(x) { return this.lineM * x + this.lineK; }
  lineCurveIntersections() {
    // ax² + (b−m)x + (c−k) = 0
    const B = this.b - this.lineM, C = this.c - this.lineK;
    const D = B * B - 4 * this.a * C;
    if (D < 0) return [];
    if (D < 1e-9) return [-B / (2 * this.a)];
    const s = Math.sqrt(D);
    return [(-B - s) / (2 * this.a), (-B + s) / (2 * this.a)];
  }

  buildScene() {
    this.reset();
    this.gAxes = svgEl('g');
    this.gCurve = svgEl('g');
    this.gLine = svgEl('g');
    this.vertexHandle = svgEl('circle', { r: 9, fill: 'var(--accent, #4a7dff)' });
    this.rootHandle = svgEl('circle', { r: 9, fill: '#c78a2d' });
    this.lineHandle = svgEl('circle', { r: 8, fill: '#3bb273' });
    this.svg.append(this.gAxes, this.gCurve, this.gLine, this.vertexHandle, this.rootHandle, this.lineHandle);

    this.makeDraggable(this.vertexHandle, (pt) => {
      const h = clamp(xOfGx(pt.x), X_MIN + 0.5, X_MAX - 0.5);
      const k = clamp(yOfGy(pt.y), Y_MIN, Y_MAX);
      this.b = -2 * this.a * h;
      this.c = k + this.a * h * h;
    });
    this.makeDraggable(this.rootHandle, (pt) => {
      const r = clamp(xOfGx(pt.x), X_MIN, X_MAX);
      const rs = this.roots();
      const other = rs.length > 1 ? rs.find((x) => Math.abs(x - r) > 0.05) ?? rs[0] : 0;
      this.b = -this.a * (r + other);
      this.c = this.a * r * other;
    });
    this.makeDraggable(this.lineHandle, (pt) => {
      const x = clamp(xOfGx(pt.x), X_MIN, X_MAX);
      const y = clamp(yOfGy(pt.y), Y_MIN, Y_MAX);
      this.lineM = clamp((y - this.lineK) / (x || 0.1), -5, 5);
      this.lineK = y - this.lineM * x;
    });
  }

  curvePath() {
    let d = '';
    for (let i = 0; i <= 120; i++) {
      const x = X_MIN + (i / 120) * (X_MAX - X_MIN);
      const y = this.fx(x);
      if (y < Y_MIN - 2 || y > Y_MAX + 2) continue;
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
    const v = this.vertex();
    this.vertexHandle.setAttribute('cx', gx(v.h));
    this.vertexHandle.setAttribute('cy', gy(v.k));
    const rs = this.roots();
    const r0 = rs[0] ?? v.h;
    this.rootHandle.setAttribute('cx', gx(r0));
    this.rootHandle.setAttribute('cy', gy(0));

    this.gLine.replaceChildren();
    this.lineHandle.style.display = this.showLine ? '' : 'none';
    if (this.showLine) {
      const xA = X_MIN, xB = X_MAX;
      this.gLine.append(svgEl('line', {
        x1: gx(xA), y1: gy(this.lineY(xA)), x2: gx(xB), y2: gy(this.lineY(xB)),
        stroke: '#3bb273', 'stroke-width': 2,
      }));
      const xh = 2;
      this.lineHandle.setAttribute('cx', gx(xh));
      this.lineHandle.setAttribute('cy', gy(this.lineY(xh)));
    }
  }

  readout() {
    const D = this.discriminant();
    const v = this.vertex();
    const rs = this.roots();
    const rootTxt = rs.length === 0 ? 'no real roots'
      : rs.length === 1 ? `one root x = ${rs[0].toFixed(2)}`
        : `roots x = ${rs[0].toFixed(2)}, ${rs[1].toFixed(2)}`;
    let txt = `y = ${this.a.toFixed(1)}x² ${this.b >= 0 ? '+' : '−'} ${Math.abs(this.b).toFixed(1)}x ${this.c >= 0 ? '+' : '−'} ${Math.abs(this.c).toFixed(1)} · Δ = ${D.toFixed(2)} · ${rootTxt} · vertex (${v.h.toFixed(2)}, ${v.k.toFixed(2)})`;
    if (this.showLine) {
      const xs = this.lineCurveIntersections();
      const ix = xs.length ? xs.map((x) => x.toFixed(2)).join(', ') : 'none';
      txt += ` · line y = ${this.lineM.toFixed(1)}x ${this.lineK >= 0 ? '+' : '−'} ${Math.abs(this.lineK).toFixed(1)} ∩ curve: x = ${ix}`;
    }
    return txt;
  }

  tick() { return false; }
}

export { SCHEMA as QUADRATIC_SCHEMA };
customElements.define('mb-quadratic-lab', MbQuadraticLab);
