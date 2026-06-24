// calculus.js — A-level calculus visual tools, drawn on the page grid (origin = page centre).
// Kinds: deriv (f′ curve + stationary points), integral (∫ area under a curve),
// between (area between two curves), riemann (rectangle/trapezium sums), tangent (+ normal).
// Self-contained: evaluates expressions with window.math; maps to page units via hooks.

let hooks = {};

const COL = {
  deriv: '#e0892a', integral: '#2566c8', between: '#1f9d57',
  riemann: '#8a4fd0', tangent: '#d23b3b', stationary: '#d23b3b',
};

const draft = {
  deriv: { expr: 'x^2 - 3', showStationary: true },
  integral: { expr: 'x^2', a: -1, b: 2 },
  between: { expr1: 'x + 2', expr2: 'x^2', a: -1, b: 2 },
  riemann: { expr: 'x^2', a: 0, b: 2, n: 8, rule: 'mid' },
  tangent: { expr: 'x^3 - 3*x', x0: 1, normal: false },
};

export function setupCalculus(h) { hooks = h; }

function page() { return hooks.page?.(); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function unit() { return hooks.unit || 50; }
function W() { return hooks.pageW || 1000; }
function H() { return hooks.pageH || 1414; }
function mathToPage(x, y) { return { x: W() / 2 + x * unit(), y: H() / 2 - y * unit() }; }
function xMinMax() { const r = (W() / 2) / unit(); return [-r, r]; }
function fmt(n) {
  if (!isFinite(n)) return '—';
  return Math.abs(n - Math.round(n)) < 1e-3 ? String(Math.round(n)) : n.toFixed(3);
}

const _calcCompileCache = new Map();
function compile(expr) {
  if (_calcCompileCache.has(expr)) return _calcCompileCache.get(expr);
  let node = null;
  try { node = window.math.compile(expr); } catch (_) { node = null; }
  if (_calcCompileCache.size > 200) _calcCompileCache.clear();
  _calcCompileCache.set(expr, node);
  return node;
}
function evalAt(node, x) {
  if (!node) return NaN;
  try { const y = node.evaluate({ x }); return typeof y === 'number' ? y : NaN; } catch (_) { return NaN; }
}
function deriv1(node, x, h = 1e-4) { return (evalAt(node, x + h) - evalAt(node, x - h)) / (2 * h); }
function deriv2(node, x, h = 1e-3) { return (evalAt(node, x + h) - 2 * evalAt(node, x) + evalAt(node, x - h)) / (h * h); }

// Composite Simpson's rule (n forced even).
function simpson(node, a, b, n = 200) {
  if (a === b) return 0;
  if (n % 2) n++;
  const hstep = (b - a) / n;
  let s = evalAt(node, a) + evalAt(node, b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * evalAt(node, a + i * hstep);
  return (hstep / 3) * s;
}

function ensure(pg) { if (!pg.calcItems) pg.calcItems = []; }

export function addCalcItem(kind) {
  const pg = page();
  if (!pg) return;
  ensure(pg);
  const d = draft[kind];
  hooks.beginAction?.();
  pg.calcItems.push({ id: uid(), kind, ...JSON.parse(JSON.stringify(d)), color: COL[kind] });
  hooks.commitAction?.();
  hooks.mark?.();
}

export function clearCalcPage() {
  const pg = page();
  if (!pg?.calcItems?.length) return;
  hooks.beginAction?.();
  pg.calcItems = [];
  hooks.commitAction?.();
  hooks.mark?.();
}

// ---- drawing -----------------------------------------------------------------
export function drawCalcItems(c, pg) {
  if (!window.math) return;
  for (const item of pg.calcItems || []) {
    if (item.kind === 'deriv') drawDeriv(c, item);
    else if (item.kind === 'integral') drawIntegral(c, item);
    else if (item.kind === 'between') drawBetween(c, item);
    else if (item.kind === 'riemann') drawRiemann(c, item);
    else if (item.kind === 'tangent') drawTangent(c, item);
  }
}

function label(c, text, x, y, col) {
  c.font = '600 18px sans-serif';
  const w = c.measureText(text).width;
  c.fillStyle = 'rgba(255,255,255,0.82)';
  c.fillRect(x - 4, y - 16, w + 8, 22);
  c.fillStyle = col;
  c.fillText(text, x, y);
}

function drawCurvePath(c, node, col, dash) {
  c.strokeStyle = col; c.lineWidth = 2.6; c.lineJoin = 'round'; c.lineCap = 'round';
  c.setLineDash(dash || []);
  c.beginPath();
  let pen = false, lastPy = null;
  for (let px = 0; px <= W(); px += 2) {
    const x = (px - W() / 2) / unit();
    const y = evalAt(node, x);
    if (!isFinite(y)) { pen = false; continue; }
    const py = H() / 2 - y * unit();
    if (pen && lastPy != null && Math.abs(py - lastPy) > H() * 1.5) pen = false;
    if (!pen) { c.moveTo(px, py); pen = true; } else c.lineTo(px, py);
    lastPy = py;
  }
  c.stroke();
  c.setLineDash([]);
}

function drawDeriv(c, item) {
  const f = compile(item.expr);
  if (!f) return;
  // f'(x) sampled numerically, drawn dashed
  const dnode = { evaluate: ({ x }) => deriv1(f, x) };
  drawCurvePath(c, dnode, item.color, [12, 8]);
  const [xmin, xmax] = xMinMax();
  const mid = mathToPage(xmin + (xmax - xmin) * 0.18, deriv1(f, xmin + (xmax - xmin) * 0.18));
  label(c, `y = ${item.expr}′`, 16, 30, item.color);
  if (item.showStationary !== false) {
    let prev = null;
    for (let x = xmin; x <= xmax; x += 0.02) {
      const d = deriv1(f, x);
      if (prev && isFinite(d) && isFinite(prev.d) && prev.d * d < 0) {
        let a = prev.x, b = x;
        for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (prev.d * deriv1(f, m) <= 0) b = m; else a = m; }
        const xs = (a + b) / 2, ys = evalAt(f, xs);
        if (isFinite(ys)) {
          const p = mathToPage(xs, ys);
          c.fillStyle = COL.stationary;
          c.beginPath(); c.arc(p.x, p.y, 6, 0, Math.PI * 2); c.fill();
          const kind = deriv2(f, xs) > 0 ? 'min' : (deriv2(f, xs) < 0 ? 'max' : 'infl');
          label(c, `${kind} (${fmt(xs)}, ${fmt(ys)})`, p.x + 10, p.y - 8, COL.stationary);
        }
      }
      prev = { x, d };
    }
  }
}

function fillUnderCurve(c, node, a, b, col, alpha) {
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = col;
  c.beginPath();
  const start = mathToPage(a, 0);
  c.moveTo(start.x, start.y);
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const x = a + (b - a) * i / steps;
    const y = evalAt(node, x);
    const p = mathToPage(x, isFinite(y) ? y : 0);
    c.lineTo(p.x, p.y);
  }
  const end = mathToPage(b, 0);
  c.lineTo(end.x, end.y);
  c.closePath();
  c.fill();
  c.restore();
}

function drawIntegral(c, item) {
  const f = compile(item.expr);
  if (!f) return;
  const a = +item.a, b = +item.b;
  drawCurvePath(c, f, item.color, []);
  fillUnderCurve(c, f, Math.min(a, b), Math.max(a, b), item.color, 0.22);
  // a, b boundary lines
  c.strokeStyle = item.color; c.lineWidth = 1.6; c.setLineDash([6, 6]);
  for (const xb of [a, b]) {
    const top = mathToPage(xb, evalAt(f, xb)), base = mathToPage(xb, 0);
    c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(top.x, top.y); c.stroke();
  }
  c.setLineDash([]);
  const val = simpson(f, a, b);
  const mp = mathToPage((a + b) / 2, 0);
  label(c, `∫ from ${fmt(a)} to ${fmt(b)} (${item.expr}) dx = ${fmt(val)}`, 16, H() - 24, item.color);
  c.fillStyle = item.color;
  for (const xb of [a, b]) { const base = mathToPage(xb, 0); label(c, xb === a ? 'a' : 'b', base.x - 4, base.y + 22, item.color); }
}

function drawBetween(c, item) {
  const f1 = compile(item.expr1), f2 = compile(item.expr2);
  if (!f1 || !f2) return;
  const a = Math.min(+item.a, +item.b), b = Math.max(+item.a, +item.b);
  drawCurvePath(c, f1, item.color, []);
  drawCurvePath(c, f2, '#2566c8', [10, 6]);
  // shaded region between the two curves
  c.save(); c.globalAlpha = 0.22; c.fillStyle = item.color;
  c.beginPath();
  const steps = 160;
  let started = false;
  for (let i = 0; i <= steps; i++) {
    const x = a + (b - a) * i / steps, y = evalAt(f1, x);
    const p = mathToPage(x, isFinite(y) ? y : 0);
    if (!started) { c.moveTo(p.x, p.y); started = true; } else c.lineTo(p.x, p.y);
  }
  for (let i = steps; i >= 0; i--) {
    const x = a + (b - a) * i / steps, y = evalAt(f2, x);
    const p = mathToPage(x, isFinite(y) ? y : 0);
    c.lineTo(p.x, p.y);
  }
  c.closePath(); c.fill(); c.restore();
  const diff = { evaluate: ({ x }) => evalAt(f1, x) - evalAt(f2, x) };
  const val = simpson(diff, a, b);
  label(c, `area between = ∫(${item.expr1} − ${item.expr2}) = ${fmt(val)}`, 16, H() - 24, item.color);
}

function drawRiemann(c, item) {
  const f = compile(item.expr);
  if (!f) return;
  const a = +item.a, b = +item.b, n = Math.max(1, Math.min(200, Math.round(+item.n || 8)));
  const rule = item.rule || 'mid';
  drawCurvePath(c, f, item.color, []);
  const dx = (b - a) / n;
  let sum = 0;
  c.lineWidth = 1.4;
  for (let i = 0; i < n; i++) {
    const xl = a + i * dx, xr = xl + dx;
    if (rule === 'trap') {
      const yl = evalAt(f, xl), yr = evalAt(f, xr);
      sum += (yl + yr) / 2 * dx;
      const pl = mathToPage(xl, yl), pr = mathToPage(xr, yr);
      const bl = mathToPage(xl, 0), br = mathToPage(xr, 0);
      c.save(); c.globalAlpha = 0.18; c.fillStyle = item.color;
      c.beginPath(); c.moveTo(bl.x, bl.y); c.lineTo(pl.x, pl.y); c.lineTo(pr.x, pr.y); c.lineTo(br.x, br.y); c.closePath(); c.fill(); c.restore();
      c.strokeStyle = item.color; c.beginPath(); c.moveTo(bl.x, bl.y); c.lineTo(pl.x, pl.y); c.lineTo(pr.x, pr.y); c.lineTo(br.x, br.y); c.closePath(); c.stroke();
    } else {
      const xs = rule === 'left' ? xl : rule === 'right' ? xr : (xl + xr) / 2;
      const h = evalAt(f, xs);
      sum += h * dx;
      const top = mathToPage(xl, h), base = mathToPage(xr, 0);
      const x0 = Math.min(top.x, base.x), y0 = Math.min(top.y, base.y);
      const w = Math.abs(base.x - top.x), hh = Math.abs(base.y - top.y);
      c.save(); c.globalAlpha = 0.18; c.fillStyle = item.color; c.fillRect(x0, y0, w, hh); c.restore();
      c.strokeStyle = item.color; c.strokeRect(x0, y0, w, hh);
    }
  }
  const exact = simpson(f, a, b);
  const ruleName = rule === 'left' ? 'left' : rule === 'right' ? 'right' : rule === 'trap' ? 'trapezium' : 'midpoint';
  label(c, `${ruleName} n=${n}: ≈ ${fmt(sum)}  (exact ${fmt(exact)})`, 16, H() - 24, item.color);
}

function lineAcrossPage(c, x0, y0, m, col, dash) {
  const [xmin, xmax] = xMinMax();
  const p1 = mathToPage(xmin, y0 + m * (xmin - x0));
  const p2 = mathToPage(xmax, y0 + m * (xmax - x0));
  c.strokeStyle = col; c.lineWidth = 2.4; c.setLineDash(dash || []);
  c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke();
  c.setLineDash([]);
}

function drawTangent(c, item) {
  const f = compile(item.expr);
  if (!f) return;
  const x0 = +item.x0, y0 = evalAt(f, x0);
  if (!isFinite(y0)) return;
  drawCurvePath(c, f, '#5a6570', []);
  const m = deriv1(f, x0);
  lineAcrossPage(c, x0, y0, m, item.color, []);
  if (item.normal) {
    const mn = Math.abs(m) < 1e-9 ? 1e9 : -1 / m;
    lineAcrossPage(c, x0, y0, mn, '#1f9d57', [10, 6]);
  }
  const p = mathToPage(x0, y0);
  c.fillStyle = item.color;
  c.beginPath(); c.arc(p.x, p.y, 6, 0, Math.PI * 2); c.fill();
  label(c, `tangent at x=${fmt(x0)}: m = ${fmt(m)}`, p.x + 10, p.y - 10, item.color);
}

// ---- panel -------------------------------------------------------------------
function showPane(name) {
  document.querySelectorAll('.cal-pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'cal-' + name));
  document.querySelectorAll('[data-caltab]').forEach((b) => b.classList.toggle('active', b.dataset.caltab === name));
}

function bindField(id, obj, key, isNum) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') {
    el.checked = !!obj[key];
    el.onchange = () => { obj[key] = el.checked; };
  } else {
    el.value = obj[key];
    el.oninput = () => { obj[key] = isNum ? (+el.value || 0) : el.value; };
  }
}

export function setupCalculusPanel() {
  if (!window.math) { const t = document.getElementById('calculus-toggle'); if (t) t.style.display = 'none'; return; }
  document.querySelectorAll('[data-caltab]').forEach((b) => b.onclick = () => showPane(b.dataset.caltab));
  bindField('cal-d-expr', draft.deriv, 'expr');
  bindField('cal-d-stat', draft.deriv, 'showStationary');
  bindField('cal-i-expr', draft.integral, 'expr');
  bindField('cal-i-a', draft.integral, 'a', true);
  bindField('cal-i-b', draft.integral, 'b', true);
  bindField('cal-b-e1', draft.between, 'expr1');
  bindField('cal-b-e2', draft.between, 'expr2');
  bindField('cal-b-a', draft.between, 'a', true);
  bindField('cal-b-b', draft.between, 'b', true);
  bindField('cal-r-expr', draft.riemann, 'expr');
  bindField('cal-r-a', draft.riemann, 'a', true);
  bindField('cal-r-b', draft.riemann, 'b', true);
  bindField('cal-r-n', draft.riemann, 'n', true);
  bindField('cal-t-expr', draft.tangent, 'expr');
  bindField('cal-t-x0', draft.tangent, 'x0', true);
  bindField('cal-t-normal', draft.tangent, 'normal');
  const rr = document.getElementById('cal-r-rule');
  if (rr) { rr.value = draft.riemann.rule; rr.onchange = () => { draft.riemann.rule = rr.value; }; }

  document.querySelectorAll('[data-cadd]').forEach((b) => b.onclick = () => addCalcItem(b.dataset.cadd));
  document.getElementById('calculus-clear')?.addEventListener('click', clearCalcPage);

  const toggle = () => {
    const el = document.getElementById('calculus');
    if (!el) return;
    if (el.classList.contains('hidden') && hooks.ensureAxes) hooks.ensureAxes();
    el.classList.toggle('hidden');
  };
  document.getElementById('calculus-toggle')?.addEventListener('click', toggle);
  document.getElementById('calculus-close')?.addEventListener('click', () => document.getElementById('calculus')?.classList.add('hidden'));
}
