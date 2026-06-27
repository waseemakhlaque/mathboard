// symbolic.js — Nerdamer symbolic CAS panel (d/dx, ∫, simplify, solve).

let hooks = {};
let mode = 'diff';   // diff | int | simp | solve
let last = { text: '', latex: '' };

export function setupSymbolic(h) { hooks = h; }

function $(id) { return document.getElementById(id); }
function symReady() { return typeof window.nerdamer === 'function' && window.nerdamer.diff; }

function symToLatex(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const ascii = raw.replace(/\*\*/g, '^').replace(/sqrt\(/g, 'sqrt(');
  const toL = window.MathLive?.convertAsciiMathToLatex;
  if (toL) {
    try { return toL(ascii); } catch (_) { /* fall through */ }
  }
  return ascii.replace(/\^([a-zA-Z0-9]+)/g, '^{\$1}').replace(/\^(\([^)]+\))/g, '^{\$1}');
}

function showOut(html) {
  const out = $('sym-out');
  if (out) out.innerHTML = html;
}

function runSymbolic() {
  const expr = $('sym-expr')?.value?.trim();
  const v = $('sym-var')?.value?.trim() || 'x';
  if (!expr) { showOut('<div class="ct-err">Enter an expression.</div>'); return; }
  if (!symReady()) {
    showOut('<div class="ct-err">Symbolic engine not loaded.</div>');
    return;
  }
  const n = window.nerdamer;
  try {
    let text = '';
    let label = '';
    if (mode === 'diff') {
      text = n.diff(expr, v).text();
      label = `\\frac{d}{d${v}}\\left(${symToLatex(expr)}\\right)`;
    } else if (mode === 'int') {
      text = n.integrate(expr, v).text();
      label = `\\int ${symToLatex(expr)}\\,d${v}`;
    } else if (mode === 'simp') {
      text = n(expr).expand().text();
      label = symToLatex(expr);
    } else {
      const eq = expr.includes('=') ? expr : `${expr}=0`;
      const sol = n.solveEquations(eq, v);
      text = typeof sol.text === 'function' ? sol.text() : String(sol);
      label = symToLatex(eq.replace(/=/g, ' = '));
    }
    last = { text, latex: `${label} = ${symToLatex(text)}` };
    showOut(`<div class="ct-ok"><strong>${mode === 'solve' ? v + ' =' : ''}</strong> ${escapeHtml(text)}</div>`);
  } catch (e) {
    last = { text: '', latex: '' };
    showOut(`<div class="ct-err">${escapeHtml(e.message || 'Could not compute symbolically.')}</div>`);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function placeOnPage() {
  if (!last.latex) { runSymbolic(); if (!last.latex) return; }
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
  document.querySelectorAll('[data-symtab]').forEach((b) => b.classList.toggle('active', b.dataset.symtab === m));
  $('sym-solve-hint')?.classList.toggle('hidden', m !== 'solve');
  $('sym-expr-hint')?.classList.toggle('hidden', m === 'solve');
}

export function setupSymbolicPanel() {
  if (!symReady()) {
    $('symbolic-toggle')?.classList.add('hidden');
    return;
  }
  document.querySelectorAll('[data-symtab]').forEach((b) => {
    b.onclick = () => setMode(b.dataset.symtab);
  });
  $('sym-go')?.addEventListener('click', runSymbolic);
  $('sym-place')?.addEventListener('click', placeOnPage);
  $('sym-expr')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSymbolic(); }
  });

  const toggle = () => $('symbolic')?.classList.toggle('hidden');
  $('symbolic-toggle')?.addEventListener('click', toggle);
  $('symbolic-close')?.addEventListener('click', () => $('symbolic')?.classList.add('hidden'));
}

/** Symbolic d/dx for calculator ∫ panel — returns '' on failure. */
export function nerdamerDiff(expr, v = 'x') {
  if (!symReady()) return '';
  try { return window.nerdamer.diff(expr, v).text(); } catch (_) { return ''; }
}
