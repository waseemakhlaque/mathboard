// rationals.js — exact fraction arithmetic via Fraction.js (A-level number work).

let hooks = {};
let op = 'add';   // add | sub | mul | div | simp
let last = { text: '', latex: '' };

const OP_SYM = { add: '+', sub: '−', mul: '×', div: '÷' };

export function setupRationals(h) { hooks = h; }

function $(id) { return document.getElementById(id); }
function fracReady() { return typeof window.Fraction === 'function'; }

function parseFrac(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try { return new window.Fraction(s); } catch (_) { return null; }
}

function fracToLatex(f) {
  const n = Number(f.n) * Number(f.s);
  const d = Number(f.d);
  if (d === 1) return String(n);
  return `\\frac{${n}}{${d}}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function showOut(html) {
  const out = $('rat-out');
  if (out) out.innerHTML = html;
}

function runRationals() {
  const aRaw = $('rat-a')?.value;
  const bRaw = $('rat-b')?.value;
  if (!fracReady()) {
    showOut('<div class="ct-err">Fraction.js not loaded.</div>');
    return;
  }
  const a = parseFrac(aRaw);
  if (!a) { showOut('<div class="ct-err">Check first value (e.g. 3/4, 1.5, −2).</div>'); return; }
  try {
    let result;
    let latex;
    if (op === 'simp') {
      result = a;
      latex = fracToLatex(result);
      last = { text: result.toFraction(true), latex };
      showOut(`<div class="ct-ok">${escapeHtml(last.text)}</div>`);
      return;
    }
    const b = parseFrac(bRaw);
    if (!b) { showOut('<div class="ct-err">Check second value.</div>'); return; }
    if (op === 'add') result = a.add(b);
    else if (op === 'sub') result = a.sub(b);
    else if (op === 'mul') result = a.mul(b);
    else {
      if (Number(b.n) === 0) { showOut('<div class="ct-err">Cannot divide by zero.</div>'); return; }
      result = a.div(b);
    }
    const sym = OP_SYM[op];
    latex = `${fracToLatex(a)} ${sym} ${fracToLatex(b)} = ${fracToLatex(result)}`;
    last = { text: result.toFraction(true), latex };
    showOut(`<div class="ct-ok">${escapeHtml(last.text)}</div>`);
  } catch (e) {
    last = { text: '', latex: '' };
    showOut(`<div class="ct-err">${escapeHtml(e.message || 'Could not compute.')}</div>`);
  }
}

function placeOnPage() {
  if (!last.latex) { runRationals(); if (!last.latex) return; }
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

function setOp(m) {
  op = m;
  document.querySelectorAll('[data-ratop]').forEach((b) => b.classList.toggle('active', b.dataset.ratop === m));
  $('rat-b-row')?.classList.toggle('hidden', m === 'simp');
}

export function setupRationalsPanel() {
  if (!fracReady()) {
    $('rationals-toggle')?.classList.add('hidden');
    return;
  }
  document.querySelectorAll('[data-ratop]').forEach((b) => {
    b.onclick = () => setOp(b.dataset.ratop);
  });
  $('rat-go')?.addEventListener('click', runRationals);
  $('rat-place')?.addEventListener('click', placeOnPage);
  $('rat-a')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runRationals(); }
  });
  $('rat-b')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runRationals(); }
  });

  const toggle = () => $('rationals')?.classList.toggle('hidden');
  $('rationals-toggle')?.addEventListener('click', toggle);
  $('rationals-close')?.addEventListener('click', () => $('rationals')?.classList.add('hidden'));
  setOp('add');
}
