// cplx.js — Further Pure: ω·z transform, loci |z−a|=|z−b|, arg(z−a)=θ

let hooks = {};
let placeMode = null;   // 'bisect' | 'arg' | 'omega'
let bisectA = null;
let draft = {
  omega: { re: 0, im: 1 },   // default ×i (90° rotation)
  omegaPolar: false,
  omegaR: 1, omegaTheta: 90,
  argDeg: 45,
};

export function setupCplx(h) { hooks = h; }

export function setCplxPlacing(mode) {
  placeMode = mode || null;
  bisectA = null;
  if (placeMode) {
    hooks.setGeoTool?.(null);
    hooks.setMechPlacing?.(null);
  }
  document.querySelectorAll('[data-cplace]').forEach((b) => b.classList.toggle('active', b.dataset.cplace === placeMode));
  const cv = document.getElementById('board');
  if (cv) cv.classList.toggle('cur-mech', !!placeMode);
}

function page() { return hooks.page?.(); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function unit() { return hooks.unit || 50; }
function W() { return hooks.pageW || 1000; }
function H() { return hooks.pageH || 1414; }

function cToPage(re, im) {
  return { x: W() / 2 + re * unit(), y: H() / 2 - im * unit() };
}
function pageToC(p) {
  return { re: (p.x - W() / 2) / unit(), im: (H() / 2 - p.y) / unit() };
}
function fmt(n) { return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1); }
function rad(d) { return d * Math.PI / 180; }

function getOmega() {
  if (draft.omegaPolar) {
    const r = +draft.omegaR || 1, t = rad(+draft.omegaTheta || 0);
    return { re: r * Math.cos(t), im: r * Math.sin(t) };
  }
  return { re: +draft.omega.re || 0, im: +draft.omega.im || 0 };
}

function mulOmega(z, w) {
  return { re: w.re * z.re - w.im * z.im, im: w.re * z.im + w.im * z.re };
}

function clipRay(px, py, dx, dy) {
  const pts = [];
  const eps = 1e-9;
  if (Math.abs(dx) > eps) {
    for (const x of [0, W()]) {
      const t = (x - px) / dx;
      const y = py + t * dy;
      if (y >= -2 && y <= H() + 2) pts.push({ x, y });
    }
  }
  if (Math.abs(dy) > eps) {
    for (const y of [0, H()]) {
      const t = (y - py) / dy;
      const x = px + t * dx;
      if (x >= -2 && x <= W() + 2) pts.push({ x, y });
    }
  }
  if (pts.length < 2) return null;
  let far = pts[0], dmax = -1;
  for (const p of pts) {
    const d = (p.x - px) ** 2 + (p.y - py) ** 2;
    if (d > dmax) { dmax = d; far = p; }
  }
  return [{ x: px, y: py }, far];
}

function drawInfiniteLine(c, px, py, dx, dy, col, dashed) {
  const seg = clipRay(px, py, dx, dy);
  if (!seg) return;
  c.strokeStyle = col; c.lineWidth = 2.5; c.setLineDash(dashed ? [14, 10] : []);
  c.beginPath(); c.moveTo(seg[0].x, seg[0].y); c.lineTo(seg[1].x, seg[1].y); c.stroke();
  c.setLineDash([]);
}

function ensureLoci(pg) { if (!pg.cplxLoci) pg.cplxLoci = []; }

export function drawCplxLoci(c, pg) {
  for (const item of pg.cplxLoci || []) {
    if (item.kind === 'bisect') drawBisect(c, item);
    else if (item.kind === 'arg') drawArgLocus(c, item);
  }
}

function drawBisect(c, item) {
  const ap = cToPage(item.a.re, item.a.im), bp = cToPage(item.b.re, item.b.im);
  const mx = (ap.x + bp.x) / 2, my = (ap.y + bp.y) / 2;
  const dx = bp.x - ap.x, dy = bp.y - ap.y;
  if (Math.hypot(dx, dy) < 4) return;
  drawInfiniteLine(c, mx, my, -dy, dx, item.color || '#8a4fd0', true);
  for (const [pt, lab] of [[ap, 'a'], [bp, 'b']]) {
    c.fillStyle = item.color || '#8a4fd0';
    c.beginPath(); c.arc(pt.x, pt.y, 5, 0, Math.PI * 2); c.fill();
    c.font = '600 17px sans-serif'; c.fillText(lab, pt.x + 8, pt.y - 6);
  }
  c.font = '600 16px sans-serif';
  c.fillText('|z−a| = |z−b|', mx + 8, my - 10);
}

function drawArgLocus(c, item) {
  const ap = cToPage(item.a.re, item.a.im);
  const th = rad(item.angleDeg || 0);
  const dx = Math.cos(th), dy = -Math.sin(th);
  drawInfiniteLine(c, ap.x, ap.y, dx, dy, item.color || '#e0892a', false);
  c.fillStyle = item.color || '#e0892a';
  c.beginPath(); c.arc(ap.x, ap.y, 5, 0, Math.PI * 2); c.fill();
  c.font = '600 16px sans-serif';
  c.fillText(`arg(z−a) = ${item.angleDeg}°`, ap.x + 10, ap.y - 8);
}

export function handleCplxClick(p) {
  if (!placeMode) return false;
  const pg = page();
  if (!pg) return false;
  const sp = hooks.snapPt ? hooks.snapPt(p) : p;
  const c = pageToC(sp);

  if (placeMode === 'bisect') {
    if (!bisectA) { bisectA = c; return true; }
    ensureLoci(pg);
    hooks.beginAction?.();
    pg.cplxLoci.push({ id: uid(), kind: 'bisect', a: bisectA, b: c, color: '#8a4fd0' });
    hooks.commitAction?.();
    bisectA = null;
    setCplxPlacing(null);
    hooks.mark?.();
    return true;
  }
  if (placeMode === 'arg') {
    ensureLoci(pg);
    hooks.beginAction?.();
    pg.cplxLoci.push({ id: uid(), kind: 'arg', a: c, angleDeg: +draft.argDeg || 0, color: '#e0892a' });
    hooks.commitAction?.();
    setCplxPlacing(null);
    hooks.mark?.();
    return true;
  }
  if (placeMode === 'omega') {
    hooks.beginAction?.();
    applyOmegaAt(c);
    hooks.commitAction?.();
    setCplxPlacing(null);
    return true;
  }
  return false;
}

function applyOmegaAt(z) {
  const w = getOmega();
  const nz = mulOmega(z, w);
  hooks.addComplex?.(nz.re, nz.im, 'ωz', w);
}

export function applyOmegaSelected() {
  const sel = hooks.selObj?.();
  if (!sel || sel.kind !== 'complex') {
    alert('Select a plotted z with the Select tool first, or use “Pick z on page”.');
    return;
  }
  hooks.beginAction?.();
  applyOmegaAt(pageToC(sel.at));
  hooks.commitAction?.();
}

export function clearCplxPage() {
  const pg = page();
  if (!pg?.cplxLoci?.length) return;
  hooks.beginAction?.();
  pg.cplxLoci = [];
  hooks.commitAction?.();
  hooks.mark?.();
}

function showPane(name) {
  document.querySelectorAll('.cplx-pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'cplx-' + name));
  document.querySelectorAll('[data-ctab]').forEach((b) => b.classList.toggle('active', b.dataset.ctab === name));
}

function bindOmegaPresets() {
  document.querySelectorAll('[data-omega]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.omega;
      draft.omegaPolar = false;
      if (k === 'i') draft.omega = { re: 0, im: 1 };
      else if (k === 'neg') draft.omega = { re: -1, im: 0 };
      else if (k === '2') draft.omega = { re: 2, im: 0 };
      else if (k === 'half') draft.omega = { re: 0.5, im: 0 };
      syncOmegaInputs();
    };
  });
}

function syncOmegaInputs() {
  const w = getOmega();
  const wr = document.getElementById('cw-re');
  const wi = document.getElementById('cw-im');
  if (wr) wr.value = fmt(w.re);
  if (wi) wi.value = fmt(w.im);
}

export function setupCplxPanel() {
  document.querySelectorAll('[data-ctab]').forEach((b) => b.onclick = () => showPane(b.dataset.ctab));
  bindOmegaPresets();

  const wr = document.getElementById('cw-re');
  const wi = document.getElementById('cw-im');
  const wR = document.getElementById('cw-r');
  const wT = document.getElementById('cw-theta');
  const wPol = document.getElementById('cw-polar');
  if (wr) wr.oninput = () => { draft.omega.re = +wr.value || 0; draft.omegaPolar = false; };
  if (wi) wi.oninput = () => { draft.omega.im = +wi.value || 0; draft.omegaPolar = false; };
  if (wR) wR.oninput = () => { draft.omegaR = +wR.value || 0; draft.omegaPolar = true; syncOmegaInputs(); };
  if (wT) wT.oninput = () => { draft.omegaTheta = +wT.value || 0; draft.omegaPolar = true; syncOmegaInputs(); };
  if (wPol) wPol.onchange = () => {
    document.getElementById('cw-cart')?.classList.toggle('hidden', wPol.checked);
    document.getElementById('cw-pol')?.classList.toggle('hidden', !wPol.checked);
    draft.omegaPolar = wPol.checked;
    syncOmegaInputs();
  };

  document.getElementById('ca-angle')?.addEventListener('input', (e) => { draft.argDeg = +e.target.value || 0; });

  document.getElementById('cplx-omega-sel')?.addEventListener('click', applyOmegaSelected);
  document.querySelectorAll('[data-cplace]').forEach((b) => {
    b.onclick = () => setCplxPlacing(placeMode === b.dataset.cplace ? null : b.dataset.cplace);
  });
  document.getElementById('cplx-clear')?.addEventListener('click', clearCplxPage);
  document.getElementById('cplx-toggle')?.addEventListener('click', () => {
    document.getElementById('cplx')?.classList.toggle('hidden');
  });
  document.getElementById('cplx-close')?.addEventListener('click', () => {
    document.getElementById('cplx')?.classList.add('hidden');
    setCplxPlacing(null);
  });

  syncOmegaInputs();
}
