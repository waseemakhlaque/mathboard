// connectedLab.js — <mb-connected-lab>: tow-bar or lift with acceleration indicator.
// Two blocks connected; drag the tow force and watch the system accelerate.

import { MbLab, svgEl, drawArrow, clamp, G } from './mbLab.js';

const W = 640, H = 380;

export class MbConnectedLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag the force arrow to accelerate the connected system. ▶ Run animates the motion.'; }

  reset() {
    this.m1 = 2; this.m2 = 3; this.F = 10;
    this.v = 0; this.x = 100;
  }

  buildScene() {
    this.reset();
    const s = this.svg;
    this.gBlocks = svgEl('g');
    this.gForce = svgEl('g');
    s.append(this.gBlocks, this.gForce);

    this.makeDraggable(this.gForce, (p) => {
      this.F = clamp(p.x / 20, 0, 30);
      this.v = 0; this.x = 100;
    });
  }

  tick(dt) {
    const a = this.F / (this.m1 + this.m2);
    this.v += a * dt;
    this.x += this.v * dt * 40;
    return this.x < 500;
  }

  renderScene() {
    const a = this.F / (this.m1 + this.m2);
    const tension = this.F * this.m2 / (this.m1 + this.m2);

    this.gBlocks.replaceChildren(
      svgEl('rect', { x: this.x - 20, y: 280, width: 40, height: 40, fill: '#4a7dff' }),
      svgEl('text', { x: this.x, y: 305, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', textContent: `${this.m1}` }),
      svgEl('rect', { x: this.x + 45, y: 280, width: 40, height: 40, fill: '#e5735a' }),
      svgEl('text', { x: this.x + 65, y: 305, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', textContent: `${this.m2}` }),
      svgEl('line', { x1: this.x + 20, y1: 300, x2: this.x + 45, y2: 300, stroke: '#333', 'stroke-width': 2 }),
    );

    drawArrow(this.gForce, 80, 120, 80 + this.F * 10, 120, '#f59e0b', `F = ${this.F.toFixed(1)} N`);
  }

  readout() {
    const a = this.F / (this.m1 + this.m2);
    const tension = this.F * this.m2 / (this.m1 + this.m2);
    return `F = ${this.F.toFixed(1)} N · a = ${a.toFixed(2)} m/s² · T (between) = ${tension.toFixed(1)} N · v = ${this.v.toFixed(2)} m/s`;
  }
}

customElements.define('mb-connected-lab', MbConnectedLab);
