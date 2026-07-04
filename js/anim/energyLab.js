// energyLab.js — <mb-energy-lab>: work, kinetic/potential energy, power.
// Drag a mass vertically or on a slope; see work done, KE, PE, and power.

import { MbLab, svgEl, clamp, G } from './mbLab.js';

const W = 640, H = 380;

export class MbEnergyLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag the mass up/down or along the slope. ▶ Run shows energy change.'; }

  reset() {
    this.m = 2;
    this.h = 200; // height in pixels
    this.theta = 30;
    this.v = 0;
  }

  buildScene() {
    this.reset();
    const s = this.svg;
    this.gSlope = svgEl('g');
    this.gMass = svgEl('g');
    this.gBars = svgEl('g');
    s.append(this.gSlope, this.gMass, this.gBars);

    this.makeDraggable(this.gMass, (p) => {
      this.h = clamp(300 - p.y, 0, 280);
      this.v = 0;
    });
  }

  tick(dt) {
    const a = G * Math.sin(this.theta * Math.PI / 180);
    this.v += a * dt;
    const dh = -this.v * dt * 50;
    if (this.h + dh > 0) this.h += dh;
    else { this.h = 0; this.v = 0; }
    return this.v > 0.1;
  }

  renderScene() {
    const mPx = Math.cos(this.theta * Math.PI / 180) * this.h;
    const yPx = 300 - this.h;
    this.gMass.replaceChildren(
      svgEl('circle', { cx: 150 + mPx, cy: yPx, r: 12, fill: '#4a7dff', class: 'mb-drag-handle' }),
      svgEl('text', { x: 150 + mPx, y: yPx + 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#fff', textContent: 'm' }),
    );

    // Slope guide line
    this.gSlope.replaceChildren(
      svgEl('line', { x1: 100, y1: 300, x2: 500, y2: 300 - 300 * Math.tan(this.theta * Math.PI / 180), stroke: '#ddd', 'stroke-dasharray': '4 2' }),
    );

    // Energy bars at the top
    const PE = this.m * G * (this.h / 300);
    const KE = 0.5 * this.m * this.v * this.v;
    const barW = 60;
    this.gBars.replaceChildren(
      svgEl('rect', { x: 350, y: 80 - PE * 10, width: barW, height: PE * 10, fill: '#f59e0b' }),
      svgEl('text', { x: 350 + barW / 2, y: 95, 'text-anchor': 'middle', 'font-size': 11, textContent: `PE=${PE.toFixed(1)}` }),
      svgEl('rect', { x: 440, y: 80 - KE * 10, width: barW, height: KE * 10, fill: '#10b981' }),
      svgEl('text', { x: 440 + barW / 2, y: 95, 'text-anchor': 'middle', 'font-size': 11, textContent: `KE=${KE.toFixed(1)}` }),
    );
  }

  readout() {
    const PE = this.m * G * (this.h / 300);
    const KE = 0.5 * this.m * this.v * this.v;
    const E = PE + KE;
    return `m = ${this.m} kg · h = ${(this.h / 300).toFixed(2)} m · PE = ${PE.toFixed(2)} J · KE = ${KE.toFixed(2)} J · E_total = ${E.toFixed(2)} J`;
  }
}

customElements.define('mb-energy-lab', MbEnergyLab);
