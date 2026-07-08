// projectileLab.js — <mb-projectile-lab>: drag launch-velocity arrow; ▶ Run traces
// the parabola. Closed-form range, max height, time of flight (u, θ, g=9.8).

import { MbLab, svgEl, drawArrow, clamp, applyParamSchema, G } from './mbLab.js';

const W = 640, H = 380;
const ORIGIN = { x: 80, y: 280 };
const GROUND_Y = 280;
const PX_PER_M = 12;
const T_MARKS = 5;

const SCHEMA = {
  u: { type: 'number', min: 5, max: 50, default: 20, unit: 'm/s', label: 'Launch speed u' },
  theta: { type: 'number', min: 5, max: 85, default: 45, unit: '°', label: 'Launch angle θ' },
  g: { type: 'number', min: 9, max: 10, default: 9.8, unit: 'm/s²', label: 'Gravity g' },
};

export class MbProjectileLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag the green arrow head to set u and θ, then ▶ Run to trace the trajectory.'; }

  reset() {
    const p = applyParamSchema(this, SCHEMA);
    this.u = p.u;
    this.theta = p.theta * Math.PI / 180;
    this.g = p.g;
    this.t = 0;
  }

  rad() { return this.theta; }
  tFlight() { return 2 * this.u * Math.sin(this.rad()) / this.g; }
  range() { return this.u * this.u * Math.sin(2 * this.rad()) / this.g; }
  maxH() { return this.u * this.u * Math.sin(this.rad()) ** 2 / (2 * this.g); }

  posAt(tau) {
    const c = Math.cos(this.rad()), s = Math.sin(this.rad());
    return {
      x: this.u * c * tau,
      y: this.u * s * tau - 0.5 * this.g * tau * tau,
    };
  }

  toSvg(m) {
    return { x: ORIGIN.x + m.x * PX_PER_M, y: ORIGIN.y - m.y * PX_PER_M };
  }

  buildScene() {
    this.reset();
    this.gGround = svgEl('g');
    this.gPath = svgEl('g');
    this.gMarks = svgEl('g');
    this.gArrow = svgEl('g');
    this.uHandle = svgEl('circle', { r: 10, fill: '#3bb273' });
    this.svg.append(this.gGround, this.gPath, this.gMarks, this.gArrow, this.uHandle);
    this.makeDraggable(this.uHandle, (pt) => {
      const dx = pt.x - ORIGIN.x, dy = ORIGIN.y - pt.y;
      this.u = clamp(Math.hypot(dx, dy) / (PX_PER_M * 0.55), 5, 50);
      this.theta = clamp(Math.atan2(dy, dx), 5 * Math.PI / 180, 85 * Math.PI / 180);
      this.t = 0;
    });
  }

  tick(dt) {
    const tf = this.tFlight();
    this.t = Math.min(tf, this.t + dt);
    return this.t < tf - 1e-6;
  }

  renderScene() {
    this.gGround.replaceChildren(
      svgEl('line', { x1: 30, y1: GROUND_Y, x2: W - 30, y2: GROUND_Y, stroke: 'var(--text-3, #888)', 'stroke-width': 2 }),
      svgEl('circle', { cx: ORIGIN.x, cy: ORIGIN.y, r: 6, fill: 'var(--accent, #4a7dff)' }),
    );
    const uLen = this.u * PX_PER_M * 0.55;
    const ex = ORIGIN.x + uLen * Math.cos(this.theta);
    const ey = ORIGIN.y - uLen * Math.sin(this.theta);
    drawArrow(this.gArrow, ORIGIN.x, ORIGIN.y, ex, ey, '#3bb273', `u = ${this.u.toFixed(1)} m/s`);
    this.uHandle.setAttribute('cx', ex);
    this.uHandle.setAttribute('cy', ey);

    const tf = this.tFlight();
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const tau = (i / 80) * tf;
      const m = this.posAt(tau);
      if (m.y < -0.05) break;
      pts.push(this.toSvg(m));
    }
    const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    this.gPath.replaceChildren(
      svgEl('path', { d, fill: 'none', stroke: 'var(--text-3, #888)', 'stroke-dasharray': '5 4', 'stroke-width': 1.5 }),
    );

    this.gMarks.replaceChildren();
    if (this.running || this.t > 0) {
      const prog = Math.min(this.t, tf);
      const trail = [];
      for (let i = 0; i <= 60; i++) {
        const tau = (i / 60) * prog;
        trail.push(this.toSvg(this.posAt(tau)));
      }
      const td = trail.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      this.gPath.append(svgEl('path', { d: td, fill: 'none', stroke: 'var(--accent, #4a7dff)', 'stroke-width': 2.5 }));
      const cur = this.toSvg(this.posAt(prog));
      this.gMarks.append(svgEl('circle', { cx: cur.x, cy: cur.y, r: 7, fill: '#e5735a' }));
      for (let i = 1; i <= T_MARKS; i++) {
        const tau = (i / T_MARKS) * tf;
        if (tau > prog) break;
        const m = this.toSvg(this.posAt(tau));
        this.gMarks.append(svgEl('circle', { cx: m.x, cy: m.y, r: 3, fill: 'var(--text-3, #888)' }));
      }
    }
  }

  readout() {
    const deg = this.theta * 180 / Math.PI;
    const R = this.range(), H = this.maxH(), T = this.tFlight();
    return `u = ${this.u.toFixed(1)} m/s, θ = ${deg.toFixed(0)}°, g = ${this.g.toFixed(1)} · R = u²sin2θ/g = ${R.toFixed(2)} m · H = u²sin²θ/(2g) = ${H.toFixed(2)} m · T = 2u sinθ/g = ${T.toFixed(2)} s`;
  }
}

export { SCHEMA as PROJECTILE_SCHEMA };
customElements.define('mb-projectile-lab', MbProjectileLab);
