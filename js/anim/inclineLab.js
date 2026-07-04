// inclineLab.js — <mb-incline-lab>: inclined plane with draggable angle, friction
// knob, and block. Covers forces diagrams, motion on a slope, and work & energy.
// Drag the apex handle to steepen the incline; when tan θ > μ the block slides
// with a = g(sinθ − μ cosθ). Force arrows and work/energy readouts update live.

import { MbLab, svgEl, drawArrow, clamp, G, applyParamSchema } from './mbLab.js';

const W = 640, H = 380;
const BASE_X = 60, BASE_Y = 300, BASE_LEN = 460; // incline base line
const MU_TRACK = { x: 60, y: 348, len: 200 };    // friction slider track
const MASS = 2;                                   // kg, fixed
const PX_PER_M = 40;                              // slope distance scale

export class MbInclineLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag the red apex handle (angle), the μ knob (friction), or the block itself. ▶ Run releases the block.'; }

  reset() {
    const p = applyParamSchema(this, {
      theta: { type: 'number', min: 5, max: 60, default: 25, unit: '°', label: 'Angle θ' },
      mu: { type: 'number', min: 0, max: 1, default: 0.3, unit: '', label: 'Coefficient μ' },
    });
    this.theta = p.theta * Math.PI / 180;
    this.mu = p.mu;
    this.s = 2.5;   // distance up the slope from the base corner (m)
    this.v = 0;
    this.s0 = this.s;
  }

  buildScene() {
    this.reset();
    const s = this.svg;
    this.gIncline = svgEl('g');
    this.gBlock = svgEl('g');
    this.gForces = svgEl('g');
    this.gMu = svgEl('g');
    this.apex = svgEl('circle', { r: 8, fill: '#e5735a' });
    this.muKnob = svgEl('circle', { r: 7, fill: 'var(--accent, #4a7dff)' });
    this.thetaLabel = svgEl('text', { 'font-size': 14, fill: 'var(--text, #ddd)', 'font-weight': 'bold' });
    s.append(this.gIncline, this.gForces, this.gBlock, this.gMu, this.apex, this.muKnob, this.thetaLabel);

    this.makeDraggable(this.apex, (p) => {
      const th = Math.atan2(BASE_Y - clamp(p.y, 40, BASE_Y - 10), BASE_LEN);
      this.theta = clamp(th, 5 * Math.PI / 180, 60 * Math.PI / 180);
      this.v = 0;
    });
    this.makeDraggable(this.muKnob, (p) => {
      this.mu = clamp((p.x - MU_TRACK.x) / MU_TRACK.len, 0, 1);
      this.v = 0;
    });
    this.makeDraggable(this.gBlock, (p) => {
      // project pointer onto the slope direction from the base corner
      const c = Math.cos(this.theta), sn = Math.sin(this.theta);
      const relX = p.x - (BASE_X + BASE_LEN), relY = BASE_Y - p.y;
      const sM = (-relX * c + relY * sn) / PX_PER_M; // distance up-slope
      this.s = clamp(sM, 0.4, this.maxS() - 0.2);
      this.s0 = this.s;
      this.v = 0;
    });
  }

  maxS() { return (BASE_LEN / Math.cos(this.theta)) / PX_PER_M; }

  // block centre in SVG coords: base corner is the right angle at (BASE_X+BASE_LEN, BASE_Y)
  blockPos() {
    const c = Math.cos(this.theta), sn = Math.sin(this.theta);
    const foot = { x: BASE_X + BASE_LEN, y: BASE_Y };
    return {
      x: foot.x - this.s * PX_PER_M * c,
      y: foot.y - this.s * PX_PER_M * sn,
      c, sn,
    };
  }

  sliding() { return Math.tan(this.theta) > this.mu; }
  accel() { return G * (Math.sin(this.theta) - this.mu * Math.cos(this.theta)); }

  tick(dt) {
    if (!this.sliding()) return false;
    const a = this.accel();
    this.v += a * dt;
    this.s -= this.v * dt;           // slides DOWN the slope
    if (this.s <= 0.4) { this.s = 0.4; return false; }
    return true;
  }

  renderScene() {
    const deg = this.theta * 180 / Math.PI;
    const top = { x: BASE_X, y: BASE_Y - Math.tan(this.theta) * BASE_LEN };

    this.gIncline.replaceChildren(
      svgEl('polygon', {
        points: `${BASE_X},${BASE_Y} ${BASE_X + BASE_LEN},${BASE_Y} ${top.x},${top.y}`,
        fill: 'var(--accent-light, rgba(74,125,255,.12))', stroke: 'var(--text-3, #888)', 'stroke-width': 1.5,
      }),
      svgEl('path', {
        d: `M ${BASE_X + BASE_LEN - 46} ${BASE_Y} A 46 46 0 0 0 ${BASE_X + BASE_LEN - 46 * Math.cos(this.theta)} ${BASE_Y - 46 * Math.sin(this.theta)}`,
        fill: 'none', stroke: 'var(--text-3, #888)',
      }),
    );
    this.apex.setAttribute('cx', top.x);
    this.apex.setAttribute('cy', top.y);
    this.thetaLabel.setAttribute('x', BASE_X + BASE_LEN - 100);
    this.thetaLabel.setAttribute('y', BASE_Y - 10);
    this.thetaLabel.textContent = `θ = ${deg.toFixed(0)}°`;

    // block (rotated square on the surface)
    const b = this.blockPos();
    const sz = 30;
    this.gBlock.replaceChildren(svgEl('rect', {
      x: -sz / 2, y: -sz, width: sz, height: sz, rx: 3,
      fill: 'var(--accent, #4a7dff)',
      transform: `translate(${b.x} ${b.y}) rotate(${-deg})`,
    }));

    // force arrows from block centre
    const cx = b.x + (sz / 2) * b.sn * 0, cy = b.y - (sz / 2);
    const mg = MASS * G;
    const scale = 3.2; // px per N
    this.gForces.replaceChildren();
    const gW = svgEl('g'), gN = svgEl('g'), gF = svgEl('g');
    this.gForces.append(gW, gN, gF);
    drawArrow(gW, cx, cy, cx, cy + mg * scale, '#e5735a', `W = ${mg.toFixed(1)} N`);
    const nMag = mg * b.c;
    drawArrow(gN, cx, cy, cx + nMag * scale * b.sn, cy - nMag * scale * b.c, '#3bb273', `N = ${nMag.toFixed(1)} N`);
    const fMag = this.sliding() ? this.mu * nMag : mg * b.sn; // kinetic vs static holding
    if (fMag > 0.2) {
      drawArrow(gF, cx, cy, cx - fMag * scale * b.c, cy - fMag * scale * b.sn, '#c78a2d', `F = ${fMag.toFixed(1)} N`);
    }

    // friction slider
    this.gMu.replaceChildren(
      svgEl('line', { x1: MU_TRACK.x, y1: MU_TRACK.y, x2: MU_TRACK.x + MU_TRACK.len, y2: MU_TRACK.y, stroke: 'var(--text-3, #888)', 'stroke-width': 3, 'stroke-linecap': 'round' }),
      (() => { const t = svgEl('text', { x: MU_TRACK.x + MU_TRACK.len + 10, y: MU_TRACK.y + 4, 'font-size': 13, fill: 'var(--text, #ddd)' }); t.textContent = `μ = ${this.mu.toFixed(2)}`; return t; })(),
    );
    this.muKnob.setAttribute('cx', MU_TRACK.x + this.mu * MU_TRACK.len);
    this.muKnob.setAttribute('cy', MU_TRACK.y);
  }

  readout() {
    const mg = MASS * G;
    const sinPart = (mg * Math.sin(this.theta)).toFixed(1);
    const limit = (this.mu * mg * Math.cos(this.theta)).toFixed(1);
    if (!this.sliding()) {
      return `m = ${MASS} kg · mg sinθ = ${sinPart} N ≤ μ mg cosθ = ${limit} N → in equilibrium (static)`;
    }
    const a = this.accel();
    const d = this.s0 - this.s;
    const work = (mg * Math.sin(this.theta) - this.mu * mg * Math.cos(this.theta)) * d;
    return `mg sinθ = ${sinPart} N > μ mg cosθ = ${limit} N → slides, a = ${a.toFixed(2)} m/s² · v = ${this.v.toFixed(2)} m/s · net work = ½mv² = ${work.toFixed(1)} J`;
  }
}

customElements.define('mb-incline-lab', MbInclineLab);
