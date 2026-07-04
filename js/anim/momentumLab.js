// momentumLab.js — <mb-momentum-lab>: two carts colliding, conservation of momentum.
// Drag initial velocities; choose elastic/inelastic; watch momentum conserve.

import { MbLab, svgEl, clamp } from './mbLab.js';

const W = 640, H = 380;

export class MbMomentumLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag the cart arrows for u₁ & u₂. Choose collision type. ▶ Run to collide.'; }

  reset() {
    this.m1 = 2; this.m2 = 3;
    this.u1 = 8; this.u2 = -2;
    this.elastic = true;
    this.phase = 'before'; // before, during, after
    this.x1 = 100; this.x2 = 480;
    this.time = 0;
  }

  buildScene() {
    this.reset();
    const s = this.svg;
    this.gScene = svgEl('g');
    this.gUarrows = svgEl('g');
    s.append(this.gScene, this.gUarrows);

    this.makeDraggable(this.gUarrows, (p) => {
      if (p.x < 320) this.u1 = clamp(p.x / 30 - 3, -15, 15);
      else this.u2 = clamp((p.x - 350) / 30 - 3, -15, 15);
      this.reset();
    });
  }

  tick(dt) {
    this.time += dt;
    if (this.time < 1) {
      this.x1 += this.u1 * dt * 40;
      this.x2 += this.u2 * dt * 40;
      if (this.x1 + 25 >= this.x2 - 25) this.phase = 'during';
    } else if (this.phase === 'during') {
      if (this.elastic) {
        const v1 = ((this.m1 - this.m2) * this.u1 + 2 * this.m2 * this.u2) / (this.m1 + this.m2);
        const v2 = ((this.m2 - this.m1) * this.u2 + 2 * this.m1 * this.u1) / (this.m1 + this.m2);
        this.u1 = v1; this.u2 = v2;
      } else {
        const vCommon = (this.m1 * this.u1 + this.m2 * this.u2) / (this.m1 + this.m2);
        this.u1 = vCommon; this.u2 = vCommon;
      }
      this.phase = 'after';
    }
    if (this.phase === 'after') {
      this.x1 += this.u1 * dt * 40;
      this.x2 += this.u2 * dt * 40;
      return this.time < 4;
    }
    return this.time < 3;
  }

  renderScene() {
    const [y, sz] = [280, 40];
    this.gScene.replaceChildren(
      svgEl('rect', { x: this.x1 - sz / 2, y, width: sz, height: sz, rx: 4, fill: '#4a7dff' }),
      svgEl('text', { x: this.x1, y: y + 20, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', textContent: `${this.m1}` }),
      svgEl('rect', { x: this.x2 - sz / 2, y, width: sz, height: sz, rx: 4, fill: '#e5735a' }),
      svgEl('text', { x: this.x2, y: y + 20, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', textContent: `${this.m2}` }),
    );
    this.gUarrows.replaceChildren(
      svgEl('line', { x1: 100, y1: 140, x2: 100 + this.u1 * 15, y2: 140, stroke: '#4a7dff', 'stroke-width': 3 }),
      svgEl('text', { x: 100 + this.u1 * 8, y: 130, 'font-size': 11, fill: '#4a7dff', textContent: `u₁` }),
      svgEl('line', { x1: 480, y1: 140, x2: 480 + this.u2 * 15, y2: 140, stroke: '#e5735a', 'stroke-width': 3 }),
      svgEl('text', { x: 480 + this.u2 * 8, y: 130, 'font-size': 11, fill: '#e5735a', textContent: `u₂` }),
    );
  }

  readout() {
    const pBefore = this.m1 * this.u1 + this.m2 * this.u2;
    const pAfter = this.m1 * (this.phase === 'after' ? (this.elastic ? ((this.m1 - this.m2) * this.u1 + 2 * this.m2 * this.u2) / (this.m1 + this.m2) : (this.m1 * this.u1 + this.m2 * this.u2) / (this.m1 + this.m2)) : this.u1) +
                   this.m2 * (this.phase === 'after' ? (this.elastic ? ((this.m2 - this.m1) * this.u2 + 2 * this.m1 * this.u1) / (this.m1 + this.m2) : (this.m1 * this.u1 + this.m2 * this.u2) / (this.m1 + this.m2)) : this.u2);
    return `p = m₁u₁ + m₂u₂ = ${pBefore.toFixed(1)} kg·m/s (${this.elastic ? 'elastic' : 'inelastic'}) · phase: ${this.phase}`;
  }
}

customElements.define('mb-momentum-lab', MbMomentumLab);
