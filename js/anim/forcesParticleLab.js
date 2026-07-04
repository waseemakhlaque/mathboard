// forcesParticleLab.js — <mb-forces-particle-lab>: particle at origin with 2–4 force
// arrows; drag heads to set magnitude+direction. Resultant, equilibrium, Lami readout.

import { MbLab, svgEl, drawArrow, clamp, applyParamSchema } from './mbLab.js';

const W = 640, H = 380;
const ORIGIN = { x: 320, y: 200 };
const PX_PER_N = 8;
const COLORS = ['#e5735a', '#3bb273', '#c78a2d', '#9b7bd4'];

const SCHEMA = {
  nForces: { type: 'number', min: 2, max: 4, default: 3, unit: '', label: 'Number of forces' },
  f1: { type: 'number', min: 0, max: 25, default: 8, unit: 'N', label: 'F₁ magnitude' },
  f2: { type: 'number', min: 0, max: 25, default: 6, unit: 'N', label: 'F₂ magnitude' },
  f3: { type: 'number', min: 0, max: 25, default: 5, unit: 'N', label: 'F₃ magnitude' },
  f4: { type: 'number', min: 0, max: 25, default: 4, unit: 'N', label: 'F₄ magnitude' },
  a1: { type: 'number', min: 0, max: 360, default: 0, unit: '°', label: 'F₁ angle' },
  a2: { type: 'number', min: 0, max: 360, default: 120, unit: '°', label: 'F₂ angle' },
  a3: { type: 'number', min: 0, max: 360, default: 240, unit: '°', label: 'F₃ angle' },
  a4: { type: 'number', min: 0, max: 360, default: 300, unit: '°', label: 'F₄ angle' },
};

export class MbForcesParticleLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag each coloured arrow head to change magnitude and direction. Equilibrium when the resultant is zero.'; }

  reset() {
    const p = applyParamSchema(this, SCHEMA);
    this.nForces = Math.round(p.nForces);
    this.forces = [];
    for (let i = 0; i < 4; i++) {
      this.forces.push({
        mag: p[`f${i + 1}`],
        ang: p[`a${i + 1}`] * Math.PI / 180,
      });
    }
  }

  comp(f) {
    return { x: f.mag * Math.cos(f.ang), y: -f.mag * Math.sin(f.ang) };
  }

  resultant() {
    let rx = 0, ry = 0;
    for (let i = 0; i < this.nForces; i++) {
      const c = this.comp(this.forces[i]);
      rx += c.x; ry += c.y;
    }
    return { x: rx, y: ry, mag: Math.hypot(rx, ry) };
  }

  buildScene() {
    this.reset();
    this.gGrid = svgEl('g');
    this.gForces = svgEl('g');
    this.gResult = svgEl('g');
    this.handles = [];
    for (let i = 0; i < 4; i++) {
      const h = svgEl('circle', { r: 9, fill: COLORS[i] });
      this.handles.push(h);
      this.makeDraggable(h, (pt) => {
        if (i >= this.nForces) return;
        const dx = pt.x - ORIGIN.x, dy = pt.y - ORIGIN.y;
        this.forces[i].mag = clamp(Math.hypot(dx, dy) / PX_PER_N, 0, 25);
        this.forces[i].ang = Math.atan2(-dy, dx);
      });
    }
    this.particle = svgEl('circle', { cx: ORIGIN.x, cy: ORIGIN.y, r: 10, fill: 'var(--accent, #4a7dff)' });
    this.svg.append(this.gGrid, this.gForces, this.gResult, this.particle, ...this.handles);
  }

  renderScene() {
    this.gGrid.replaceChildren(
      svgEl('line', { x1: 40, y1: ORIGIN.y, x2: W - 40, y2: ORIGIN.y, stroke: 'var(--text-3, #888)', 'stroke-dasharray': '4 4' }),
      svgEl('line', { x1: ORIGIN.x, y1: 40, x2: ORIGIN.x, y2: H - 40, stroke: 'var(--text-3, #888)', 'stroke-dasharray': '4 4' }),
    );
    this.gForces.replaceChildren();
    for (let i = 0; i < this.nForces; i++) {
      const f = this.forces[i];
      const c = this.comp(f);
      const ex = ORIGIN.x + c.x * PX_PER_N, ey = ORIGIN.y + c.y * PX_PER_N;
      const g = svgEl('g');
      drawArrow(g, ORIGIN.x, ORIGIN.y, ex, ey, COLORS[i], `F${i + 1} = ${f.mag.toFixed(1)} N`);
      this.gForces.append(g);
      this.handles[i].setAttribute('cx', ex);
      this.handles[i].setAttribute('cy', ey);
      this.handles[i].style.display = '';
    }
    for (let i = this.nForces; i < 4; i++) this.handles[i].style.display = 'none';

    const R = this.resultant();
    this.gResult.replaceChildren();
    if (R.mag > 0.15) {
      const gR = svgEl('g');
      drawArrow(gR, ORIGIN.x, ORIGIN.y, ORIGIN.x + R.x * PX_PER_N, ORIGIN.y + R.y * PX_PER_N, '#888', `R = ${R.mag.toFixed(1)} N`);
      this.gResult.append(gR);
    }
  }

  readout() {
    const R = this.resultant();
    const eq = R.mag < 0.3;
    const ang = (f) => ((f.ang * 180 / Math.PI) % 360 + 360) % 360;
    if (eq && this.nForces === 3) {
      const [f1, f2, f3] = this.forces;
      const s1 = f1.mag, s2 = f2.mag, s3 = f3.mag;
      const lami = `F₁/sin(${ang(f2).toFixed(0)}°−${ang(f3).toFixed(0)}°) = F₂/sin(${ang(f3).toFixed(0)}°−${ang(f1).toFixed(0)}°) = F₃/sin(${ang(f1).toFixed(0)}°−${ang(f2).toFixed(0)}°)`;
      return `Equilibrium ✓ · triangle of forces closes · Lami: ${lami}`;
    }
    if (eq) return `Equilibrium ✓ · ΣF = 0 (resultant < 0.3 N)`;
    const rAng = Math.atan2(-R.y, R.x) * 180 / Math.PI;
    return `ΣF → R = ${R.mag.toFixed(2)} N at ${(((rAng % 360) + 360) % 360).toFixed(0)}° · not in equilibrium`;
  }

  tick() { return false; }
}

export { SCHEMA as FORCES_PARTICLE_SCHEMA };
customElements.define('mb-forces-particle-lab', MbForcesParticleLab);
