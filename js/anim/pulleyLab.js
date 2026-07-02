// pulleyLab.js — <mb-pulley-lab>: Atwood machine. Drag either mass vertically and
// the rope constraint moves the other one oppositely; ± buttons change the masses.
// ▶ Run releases the system: a = (m₂−m₁)g/(m₁+m₂), T = 2m₁m₂g/(m₁+m₂).

import { MbLab, svgEl, clamp, G } from './mbLab.js';

const W = 640, H = 380;
const PULLEY = { x: 320, y: 70, r: 34 };
const FLOOR_Y = 340;
const Y_MIN = PULLEY.y + PULLEY.r + 30;  // highest a mass centre can go
const Y_MAX = FLOOR_Y - 22;              // lowest (resting near floor)
const PX_PER_M = 60;

export class MbPulleyLab extends MbLab {
  get viewBox() { return `0 0 ${W} ${H}`; }
  get hint() { return 'Drag either mass up or down — the rope moves the other. Use ±  to change masses, then ▶ Run to release.'; }

  reset() {
    this.m1 = 3; this.m2 = 5;
    this.y1 = 200; this.y2 = 240;   // SVG y of each mass centre; y1 + y2 stays constant
    this.v = 0;                      // velocity of m2 downward (m/s)
  }

  get ropeSum() { return this.y1 + this.y2; }

  buildScene() {
    this.reset();
    const s = this.svg;
    this.gStatic = svgEl('g');
    this.gRope = svgEl('g');
    this.gM1 = svgEl('g');
    this.gM2 = svgEl('g');
    s.append(this.gStatic, this.gRope, this.gM1, this.gM2);

    // static: ceiling mount, pulley wheel, floor
    this.gStatic.append(
      svgEl('line', { x1: PULLEY.x - 60, y1: 18, x2: PULLEY.x + 60, y2: 18, stroke: 'var(--text-3, #888)', 'stroke-width': 4 }),
      svgEl('line', { x1: PULLEY.x, y1: 18, x2: PULLEY.x, y2: PULLEY.y, stroke: 'var(--text-3, #888)', 'stroke-width': 3 }),
      svgEl('circle', { cx: PULLEY.x, cy: PULLEY.y, r: PULLEY.r, fill: 'var(--surface-2, #333)', stroke: 'var(--text-3, #888)', 'stroke-width': 2 }),
      svgEl('circle', { cx: PULLEY.x, cy: PULLEY.y, r: 4, fill: 'var(--text-3, #888)' }),
      svgEl('line', { x1: 40, y1: FLOOR_Y, x2: W - 40, y2: FLOOR_Y, stroke: 'var(--text-3, #888)', 'stroke-dasharray': '5 4' }),
    );

    const sumRef = () => this.ropeSum;
    this.makeDraggable(this.gM1, (p) => {
      const sum = this._sum ?? (this._sum = sumRef());
      this.y1 = clamp(p.y, Y_MIN, Y_MAX);
      this.y2 = clamp(sum - this.y1, Y_MIN, Y_MAX);
      this.y1 = sum - this.y2;
      this.v = 0;
    });
    this.makeDraggable(this.gM2, (p) => {
      const sum = this._sum ?? (this._sum = sumRef());
      this.y2 = clamp(p.y, Y_MIN, Y_MAX);
      this.y1 = clamp(sum - this.y2, Y_MIN, Y_MAX);
      this.y2 = sum - this.y1;
      this.v = 0;
    });
    // one fixed rope length for the whole session
    this._sum = this.ropeSum;

    // ± mass buttons (HTML, under the svg)
    const row = document.createElement('div');
    row.className = 'mb-lab-massrow';
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.addEventListener('click', () => { this.stop(); fn(); this.v = 0; this.refresh(); });
      return b;
    };
    const lbl1 = document.createElement('span'); lbl1.className = 'mb-lab-masslbl';
    const lbl2 = document.createElement('span'); lbl2.className = 'mb-lab-masslbl';
    this._lbl1 = lbl1; this._lbl2 = lbl2;
    row.append(
      mk('−', () => { this.m1 = clamp(this.m1 - 1, 1, 10); }), lbl1, mk('+', () => { this.m1 = clamp(this.m1 + 1, 1, 10); }),
      document.createTextNode('   '),
      mk('−', () => { this.m2 = clamp(this.m2 - 1, 1, 10); }), lbl2, mk('+', () => { this.m2 = clamp(this.m2 + 1, 1, 10); }),
    );
    this.appendChild(row);
  }

  accel() { return (this.m2 - this.m1) * G / (this.m1 + this.m2); } // m2 down positive
  tension() { return 2 * this.m1 * this.m2 * G / (this.m1 + this.m2); }

  tick(dt) {
    const a = this.accel();
    if (Math.abs(a) < 1e-9) return false;
    this.v += a * dt;
    const dy = this.v * dt * PX_PER_M;
    const y2n = this.y2 + dy, y1n = this._sum - y2n;
    if (y2n > Y_MAX || y2n < Y_MIN || y1n > Y_MAX || y1n < Y_MIN) return false;
    this.y2 = y2n; this.y1 = y1n;
    return true;
  }

  renderScene() {
    const x1 = PULLEY.x - PULLEY.r, x2 = PULLEY.x + PULLEY.r;
    this.gRope.replaceChildren(
      svgEl('path', {
        d: `M ${x1} ${this.y1 - 20} L ${x1} ${PULLEY.y} A ${PULLEY.r} ${PULLEY.r} 0 0 1 ${x2} ${PULLEY.y} L ${x2} ${this.y2 - 20}`,
        fill: 'none', stroke: '#c78a2d', 'stroke-width': 2.5,
      }),
    );
    const sz1 = 26 + this.m1 * 3, sz2 = 26 + this.m2 * 3;
    const box = (g, x, y, sz, m, color) => {
      g.replaceChildren(
        svgEl('rect', { x: x - sz / 2, y: y - 20, width: sz, height: sz, rx: 4, fill: color }),
        (() => { const t = svgEl('text', { x, y: y - 20 + sz / 2 + 5, 'font-size': 14, fill: '#fff', 'text-anchor': 'middle', 'font-weight': 'bold' }); t.textContent = `${m} kg`; return t; })(),
      );
    };
    box(this.gM1, x1, this.y1, sz1, this.m1, 'var(--accent, #4a7dff)');
    box(this.gM2, x2, this.y2, sz2, this.m2, '#e5735a');
    if (this._lbl1) this._lbl1.textContent = ` m₁ = ${this.m1} kg `;
    if (this._lbl2) this._lbl2.textContent = ` m₂ = ${this.m2} kg `;
  }

  readout() {
    const a = this.accel(), T = this.tension();
    const dir = a > 0 ? 'm₂ ↓, m₁ ↑' : a < 0 ? 'm₁ ↓, m₂ ↑' : 'balanced';
    return `a = (m₂−m₁)g/(m₁+m₂) = ${a.toFixed(2)} m/s² (${dir}) · T = 2m₁m₂g/(m₁+m₂) = ${T.toFixed(1)} N · v = ${Math.abs(this.v).toFixed(2)} m/s`;
  }
}

customElements.define('mb-pulley-lab', MbPulleyLab);
