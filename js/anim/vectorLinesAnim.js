// vectorLinesAnim.js — <mb-vector-lines-anim params='{"r1":{"p":[1,2,0],"d":[1,0,1]},"r2":{"p":[0,1,3],"d":[2,1,-1]}}'>
// P3 Vectors: two lines r = p + λd in 3D (oblique projection). Phases: draw lines →
// traverse points → solve the 2×2 system from x/y components and check z:
// consistent → intersection point; inconsistent → skew; parallel directions → parallel.

import { MbAnim, svgEl } from './mbAnim.js';

const W = 640, H = 360;
const SCALE = 34, OX = 300, OY = 220, OBL = 0.42;
const EPS = 1e-9;

const proj = ([x, y, z]) => [OX + (x + OBL * z) * SCALE, OY - (y + OBL * z * 0.5) * SCALE];
const at = (l, k) => [l.p[0] + k * l.d[0], l.p[1] + k * l.d[1], l.p[2] + k * l.d[2]];

// Solve p1 + λd1 = p2 + μd2 from x/y rows, verify z row.
function solve(r1, r2) {
  const [d1, d2, p1, p2] = [r1.d, r2.d, r1.p, r2.p];
  const cross = [
    d1[1] * d2[2] - d1[2] * d2[1],
    d1[2] * d2[0] - d1[0] * d2[2],
    d1[0] * d2[1] - d1[1] * d2[0],
  ];
  if (cross.every((c) => Math.abs(c) < EPS)) return { kind: 'parallel' };
  // rows: d1[i]·λ − d2[i]·μ = p2[i] − p1[i]; pick two rows with non-zero determinant
  const rows = [0, 1, 2].map((i) => [d1[i], -d2[i], p2[i] - p1[i]]);
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const det = rows[i][0] * rows[j][1] - rows[i][1] * rows[j][0];
    if (Math.abs(det) < EPS) continue;
    const lam = (rows[i][2] * rows[j][1] - rows[i][1] * rows[j][2]) / det;
    const mu = (rows[i][0] * rows[j][2] - rows[i][2] * rows[j][0]) / det;
    const k = 3 - i - j; // remaining row index
    const ok = Math.abs(rows[k][0] * lam + rows[k][1] * mu - rows[k][2]) < 1e-6;
    return ok ? { kind: 'intersect', lam, mu, point: at({ p: p1, d: d1 }, lam) } : { kind: 'skew', lam, mu };
  }
  return { kind: 'parallel' };
}

export class MbVectorLinesAnim extends MbAnim {
  get viewBox() { return `0 0 ${W} ${H}`; }

  _lines() {
    const { r1 = { p: [1, 2, 0], d: [1, 0, 1] }, r2 = { p: [0, 1, 3], d: [2, 1, -1] } } = this.params;
    return { r1, r2, sol: solve(r1, r2) };
  }

  get steps() {
    const { r1, r2, sol } = this._lines();
    const v = (a) => `(${a.join(', ')})`;
    const out = [
      { at: 0, label: `l₁: r = ${v(r1.p)} + λ${v(r1.d)},  l₂: r = ${v(r2.p)} + μ${v(r2.d)}` },
      { at: 0.34, label: 'Set r₁ = r₂: solve the x and y equations for λ and μ' },
    ];
    if (sol.kind === 'parallel') out.push({ at: 0.7, label: 'd₁ × d₂ = 0 — the lines are parallel' });
    else if (sol.kind === 'skew') out.push({ at: 0.7, label: `λ = ${sol.lam.toFixed(2)}, μ = ${sol.mu.toFixed(2)} — z equation fails: lines are skew` });
    else out.push({ at: 0.7, label: `λ = ${sol.lam.toFixed(2)}, μ = ${sol.mu.toFixed(2)} — z checks: intersect at (${sol.point.map((c) => +c.toFixed(2)).join(', ')})` });
    return out;
  }

  renderFrame(t) {
    const { r1, r2, sol } = this._lines();
    const svg = this.svg;
    svg.replaceChildren();

    // axes
    const axes = [[[0, 0, 0], [4.5, 0, 0], 'x'], [[0, 0, 0], [0, 4, 0], 'y'], [[0, 0, 0], [0, 0, 4.5], 'z']];
    for (const [a, b, name] of axes) {
      const [x1, y1] = proj(a), [x2, y2] = proj(b);
      svg.append(svgEl('line', { x1, y1, x2, y2, stroke: 'var(--text-3, #888)', 'stroke-width': 1 }));
      const lb = svgEl('text', { x: x2 + 4, y: y2, 'font-size': 12, fill: 'var(--text-3, #888)' });
      lb.textContent = name;
      svg.append(lb);
    }

    // phase 1 (t 0→0.34): lines grow from k=-3 to k = -3 + 6·progress
    const drawT = Math.min(1, t / 0.34);
    const kEnd = -3 + 6 * drawT;
    for (const [line, color] of [[r1, 'var(--accent, #4a7dff)'], [r2, '#e5735a']]) {
      const [x1, y1] = proj(at(line, -3));
      const [x2, y2] = proj(at(line, kEnd));
      svg.append(svgEl('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': 2.5 }));
    }

    // phase 2 (0.34→0.7): points traverse toward λ/μ solution (or 0 for parallel)
    if (t > 0.34) {
      const travT = Math.min(1, (t - 0.34) / 0.36);
      const lamTarget = sol.lam ?? 0, muTarget = sol.mu ?? 0;
      const pts = [[r1, -3 + (lamTarget + 3) * travT, 'var(--accent, #4a7dff)'], [r2, -3 + (muTarget + 3) * travT, '#e5735a']];
      for (const [line, k, color] of pts) {
        const [cx, cy] = proj(at(line, k));
        svg.append(svgEl('circle', { cx, cy, r: 6, fill: color }));
      }
    }

    // phase 3 (t ≥ 0.7): verdict
    if (t >= 0.7) {
      if (sol.kind === 'intersect') {
        const [cx, cy] = proj(sol.point);
        svg.append(svgEl('circle', { cx, cy, r: 9, fill: 'none', stroke: 'var(--text, #ddd)', 'stroke-width': 2 }));
        const lb = svgEl('text', { x: cx + 12, y: cy - 10, 'font-size': 13, fill: 'var(--text, #ddd)' });
        lb.textContent = `(${sol.point.map((c) => +c.toFixed(2)).join(', ')})`;
        svg.append(lb);
      } else {
        const lb = svgEl('text', { x: 20, y: 30, 'font-size': 15, fill: 'var(--text, #ddd)' });
        lb.textContent = sol.kind === 'skew' ? 'Skew lines — no intersection' : 'Parallel lines';
        svg.append(lb);
      }
    }
  }
}

customElements.define('mb-vector-lines-anim', MbVectorLinesAnim);
