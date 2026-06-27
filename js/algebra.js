// algebra.js — mathjs simplify / expand / rationalize / d/dx (complements Nerdamer CAS).

let hooks = {};
let mode = 'simp';   // simp | expand | rat | diff
let last = { text: '', latex: '' };

const TRIG_RULES = [
  { l: 'sin(n)^2+cos(n)^2', r: '1' },
  { l: 'cos(n)^2+sin(n)^2', r: '1' },
  { l: 'tan(n)', r: 'sin(n)/cos(n)' },
];
const EXPAND_RULES = [
  { l: '(n1+n2)*n3', r: 'n1*n3+n2*n3' },
  { l: 'n1*(n2+n3)', r: 'n1*n2+n1*n3' },
  { l: '(n1+n2)^2', r: 'n1^2+2*n1*n2+n2^2' },
];

export function setupAlgebra(h) { hooks = h; }

function $(id) { return document.getElementById(id); }
function algReady() { return typeof window.math?.simplify === 'function'; }

function exprToLatex(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const toL = window.MathLive?.convertAsciiMathToLatex;
  if (toL) {
    try { return toL(raw.replace(/\*\*/g, '^')); } catch (_) { /* fall through */ }
  }
  return raw.replace(/\^([a-zA-Z0-9]+)/g, '^{\$1}').replace(/\^(\([^)]+\))/g, '^{\$1}');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function showOut(html) {
  const out = $('alg-out');
  if (out) out.innerHTML = html;
}

/** Symbolic d/dx via mathjs — used by calculus labels too. */
export function mathjsDerivative(expr, v = 'x') {
  if (!algReady()) return '';
  try {
    return window.math.simplify(window.math.derivative(String(expr).trim(), v)).toString();
  } catch (_) { return ''; }
}

function runAlgebra() {
  const expr = $('alg-expr')?.value?.trim();
  const v = $('alg-var')?.value?.trim() || 'x';
  if (!expr) { showOut('<div class="ct-err">Enter an expression.</div>'); return; }
  if (!algReady()) {
    showOut('<div class="ct-err">mathjs not loaded.</div>');
    return;
  }
  const m = window.math;
  try {
    let text = '';
    let label = exprToLatex(expr);
    if (mode === 'simp') {
      text = m.simplify(expr, TRIG_RULES).toString();
    } else if (mode === 'expand') {
      text = m.simplify(expr, EXPAND_RULES).toString();
    } else if (mode === 'rat') {
      text = m.rationalize(expr).toString();
    } else {
      text = mathjsDerivative(expr, v);
      label = `\\frac{d}{d${v}}\\left(${exprToLatex(expr)}\\right)`;
    }
    last = { text, latex: mode === 'diff' ? `${label} = ${exprToLatex(text)}` : `${label} = ${exprToLatex(text)}` };
    showOut(`<div class="ct-ok">${escapeHtml(text)}</div>`);
  } catch (e) {
    last = { text: '', latex: '' };
    showOut(`<div class="ct-err">${escapeHtml(e.message || 'Could not simplify.')}</div>`);
  }
}

function placeOnPage() {
  if (!last.latex) { runAlgebra(); if (!last.latex) return; }
  hooks.beginAction?.();
  hooks.addEquation?.({
    latex: last.latex,
    at: { x: (hooks.pageW?.() || 1000) / 2 - 120, y: (hooks.pageH?.() || 1414) / 2 - 40 },
    color: hooks.color?.() || '#1b1b1b',
    size: 34,
  });
  hooks.commitAction?.();
  hooks.persist?.();
  hooks.mark?.();
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('[data-algtab]').forEach((b) => b.classList.toggle('active', b.dataset.algtab === m));
  $('alg-var-row')?.classList.toggle('hidden', m !== 'diff');
}

export function setupAlgebraPanel() {
  if (!algReady()) {
    $('algebra-toggle')?.classList.add('hidden');
    return;
  }
  document.querySelectorAll('[data-algtab]').forEach((b) => {
    b.onclick = () => setMode(b.dataset.algtab);
  });
  $('alg-go')?.addEventListener('click', runAlgebra);
  $('alg-place')?.addEventListener('click', placeOnPage);
  $('alg-expr')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runAlgebra(); }
  });

  const toggle = () => $('algebra')?.classList.toggle('hidden');
  $('algebra-toggle')?.addEventListener('click', toggle);
  $('algebra-close')?.addEventListener('click', () => $('algebra')?.classList.add('hidden'));
  setMode('simp');
}
