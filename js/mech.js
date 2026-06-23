// mech.js — A-level mechanics diagrams (forces, incline, projectile, v–t / s–t)
// Page units: x right, y down (matches canvas). Angles in degrees: 0° = +x, 90° = up (−y).

const MECH_SCALE = 28;   // page units per metre
const FORCE_COLORS = ['#d23b3b', '#2566c8', '#1f9d57', '#e0892a', '#8a4fd0'];

let hooks = {};
let placeKind = null;
let draft = {
  forces: [{ label: 'F', mag: 5, angleDeg: 30 }, { label: 'mg', mag: 9.8, angleDeg: -90 }],
  showResultant: true,
  incline: { angleDeg: 30, mass: 2, mu: 0, showComponents: true },
  projectile: { u: 12, thetaDeg: 40, g: 9.8, showVel: true },
  motion: { graph: 'vt', u: 5, a: -2, tMax: 6 },
};

export function setupMech(h) { hooks = h; }

export function mechPlacing() { return placeKind; }

export function setMechPlacing(kind) {
  placeKind = kind || null;
  if (placeKind) {
    hooks.setGeoTool?.(null);
    hooks.setCplxPlacing?.(null);
  }
  document.querySelectorAll('[data-mplace]').forEach((b) => b.classList.toggle('active', b.dataset.mplace === placeKind));
  const cv = document.getElementById('board');
  if (cv) cv.classList.toggle('cur-mech', !!placeKind);
}

export function handleMechClick(p) {
  if (!placeKind) return false;
  const pg = hooks.page?.();
  if (!pg) return false;
  if (!pg.mechItems) pg.mechItems = [];
  hooks.beginAction?.();
  pg.mechItems.push(buildItem(placeKind, hooks.snapPt ? hooks.snapPt(p) : p));
  hooks.commitAction?.();
  setMechPlacing(null);
  hooks.mark?.();
  return true;
}

export function clearMechPage() {
  const pg = hooks.page?.();
  if (!pg?.mechItems?.length) return;
  hooks.beginAction?.();
  pg.mechItems = [];
  hooks.commitAction?.();
  hooks.mark?.();
}

function page() { return hooks.page?.(); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function buildItem(kind, at) {
  const id = uid();
  if (kind === 'forces') {
    return {
      id, kind, at,
      forces: draft.forces.map((f, i) => ({ ...f, color: FORCE_COLORS[i % FORCE_COLORS.length] })),
      showResultant: !!draft.showResultant,
    };
  }
  if (kind === 'incline') {
    return { id, kind, at, ...draft.incline, g: 9.8 };
  }
  if (kind === 'projectile') {
    return { id, kind, at, ...draft.projectile, scale: MECH_SCALE };
  }
  if (kind === 'motion') {
    return { id, kind, at, ...draft.motion, w: 300, h: 180 };
  }
  return { id, kind, at };
}

function rad(d) { return d * Math.PI / 180; }
function fmt(n) { return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1); }

function forceEnd(at, mag, angleDeg, scale) {
  const r = rad(angleDeg);
  const len = mag * scale * 0.55;
  return { x: at.x + Math.cos(r) * len, y: at.y - Math.sin(r) * len };
}

function drawArrow(c, a, b, col, dashed, lw = 3.5) {
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round';
  if (dashed) c.setLineDash([12, 8]); else c.setLineDash([]);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  c.setLineDash([]);
  const ang = Math.atan2(b.y - a.y, b.x - a.x), h = 18;
  if (Math.hypot(b.x - a.x, b.y - a.y) < 4) return;
  c.beginPath(); c.moveTo(b.x, b.y);
  c.lineTo(b.x - h * Math.cos(ang - 0.4), b.y - h * Math.sin(ang - 0.4));
  c.lineTo(b.x - h * Math.cos(ang + 0.4), b.y - h * Math.sin(ang + 0.4));
  c.closePath(); c.fill();
}

function drawForceDiagram(c, item) {
  const at = item.at;
  const sc = MECH_SCALE * 0.12;
  c.fillStyle = '#1b1b1b';
  c.beginPath(); c.arc(at.x, at.y, 6, 0, Math.PI * 2); c.fill();
  let rx = 0, ry = 0;
  for (const f of item.forces || []) {
    const to = forceEnd(at, f.mag, f.angleDeg, sc / 0.12);
    drawArrow(c, at, to, f.color || '#d23b3b', false);
    const mx = (at.x + to.x) / 2, my = (at.y + to.y) / 2;
    c.fillStyle = f.color || '#d23b3b';
    c.font = '600 18px sans-serif';
    c.fillText(f.label || 'F', mx + 6, my - 4);
    const r = rad(f.angleDeg);
    rx += f.mag * Math.cos(r);
    ry += f.mag * Math.sin(r);
  }
  if (item.showResultant && (item.forces || []).length > 1) {
    const rto = forceEnd(at, Math.hypot(rx, ry), Math.atan2(ry, rx) * 180 / Math.PI, sc / 0.12);
    drawArrow(c, at, rto, '#8a4fd0', true, 3);
    c.fillStyle = '#8a4fd0'; c.font = '600 17px sans-serif';
    c.fillText('R', (at.x + rto.x) / 2 + 6, (at.y + rto.y) / 2 - 4);
  }
}

function drawIncline(c, item) {
  const a = item.at;
  const alpha = rad(item.angleDeg || 30);
  const base = item.len || 280;
  const h = base * Math.tan(alpha);
  const b = { x: a.x + base, y: a.y };
  const top = { x: a.x + base, y: a.y - h };
  c.fillStyle = 'rgba(200,210,220,0.35)';
  c.strokeStyle = '#5a6570'; c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(top.x, top.y); c.closePath();
  c.fill(); c.stroke();
  c.strokeStyle = '#88929c'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(a.x - 40, a.y); c.lineTo(b.x + 50, b.y); c.stroke();
  const mid = { x: a.x + base * 0.55, y: a.y - h * 0.55 };
  const bw = 44, bh = 30;
  c.save();
  c.translate(mid.x, mid.y);
  c.rotate(-alpha);
  c.fillStyle = '#c8d4e0'; c.strokeStyle = '#4a5560'; c.lineWidth = 2;
  c.fillRect(-bw / 2, -bh, bw, bh); c.strokeRect(-bw / 2, -bh, bw, bh);
  c.restore();
  const m = item.mass || 1, g = item.g || 9.8, mg = m * g;
  const sc = MECH_SCALE * 0.1;
  const cx = mid.x, cy = mid.y - 8;
  const pAng = 90 - item.angleDeg;
  const nAng = 90 + item.angleDeg;
  drawArrow(c, { x: cx, y: cy }, forceEnd({ x: cx, y: cy }, mg, -90, sc / 0.12), '#1f9d57', false);
  c.fillStyle = '#1f9d57'; c.font = '600 17px sans-serif'; c.fillText('mg', cx + 8, cy + 50);
  drawArrow(c, { x: cx, y: cy }, forceEnd({ x: cx, y: cy }, mg * Math.cos(alpha), nAng, sc / 0.12), '#2566c8', false);
  c.fillStyle = '#2566c8'; c.fillText('N', cx - 36, cy - 28);
  if (item.showComponents) {
    drawArrow(c, { x: cx, y: cy }, forceEnd({ x: cx, y: cy }, mg * Math.sin(alpha), pAng, sc / 0.12), '#e0892a', true, 2.5);
    c.fillStyle = '#e0892a'; c.font = '600 15px sans-serif';
    c.fillText('mg sinα', cx + 42, cy + 6);
    drawArrow(c, { x: cx, y: cy }, forceEnd({ x: cx, y: cy }, mg * Math.cos(alpha), nAng, sc / 0.12), '#8a4fd0', true, 2.5);
    c.fillText('mg cosα', cx - 52, cy - 14);
  }
  c.fillStyle = '#4a5560'; c.font = '600 16px sans-serif';
  c.fillText(`α = ${item.angleDeg}°`, a.x + 12, a.y - 12);
  if (item.mu > 0) {
    drawArrow(c, { x: cx, y: cy }, forceEnd({ x: cx, y: cy }, item.mu * mg * Math.cos(alpha), pAng + 180, sc / 0.12), '#d23b3b', false, 2.5);
    c.fillStyle = '#d23b3b'; c.fillText('f', cx - 50, cy + 20);
  }
}

function drawProjectile(c, item) {
  const u = item.u || 10, th = rad(item.thetaDeg || 40), g = item.g || 9.8;
  const sc = item.scale || MECH_SCALE;
  const ux = u * Math.cos(th), uy = u * Math.sin(th);
  const tFlight = 2 * uy / g;
  const pts = [];
  for (let t = 0; t <= tFlight + 0.02; t += tFlight / 80) {
    const xm = ux * t, ym = uy * t - 0.5 * g * t * t;
    if (ym < -0.05) break;
    pts.push({ x: item.at.x + xm * sc, y: item.at.y - ym * sc, t });
  }
  if (pts.length < 2) return;
  c.strokeStyle = '#d23b3b'; c.lineWidth = 3; c.setLineDash([]);
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  c.stroke();
  c.fillStyle = '#1b1b1b';
  c.beginPath(); c.arc(item.at.x, item.at.y, 6, 0, Math.PI * 2); c.fill();
  if (item.showVel) {
    for (let t = 0; t <= tFlight; t += Math.max(0.4, tFlight / 5)) {
      const xm = ux * t, ym = uy * t - 0.5 * g * t * t;
      if (ym < 0) break;
      const px = item.at.x + xm * sc, py = item.at.y - ym * sc;
      const vx = ux, vy = uy - g * t;
      const vsc = 12;
      const vto = { x: px + vx * vsc, y: py - vy * vsc };
      drawArrow(c, { x: px, y: py }, vto, '#2566c8', false, 2);
    }
  }
  c.fillStyle = '#4a5560'; c.font = '600 16px sans-serif';
  c.fillText(`u=${u} m/s  θ=${item.thetaDeg}°`, item.at.x, item.at.y + 28);
  const range = ux * tFlight;
  c.fillText(`R ≈ ${fmt(range)} m`, item.at.x + range * sc * 0.45, item.at.y + 48);
}

function drawMotionGraph(c, item) {
  const x0 = item.at.x, y0 = item.at.y, w = item.w || 300, h = item.h || 180;
  const u = +item.u || 0, a = +item.a || 0, tMax = Math.max(1, +item.tMax || 5);
  const isVt = item.graph !== 'st';
  c.fillStyle = 'rgba(255,255,255,0.92)'; c.strokeStyle = '#88929c'; c.lineWidth = 2;
  c.fillRect(x0, y0 - h, w, h); c.strokeRect(x0, y0 - h, w, h);
  const ox = x0 + 36, oy = y0 - 24;
  const gw = w - 48, gh = h - 48;
  c.strokeStyle = '#1b1b1b'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox, oy - gh); c.lineTo(ox + gw, oy - gh); c.stroke();
  c.font = '600 14px sans-serif'; c.fillStyle = '#4a5560';
  c.fillText(isVt ? 'v' : 's', ox - 22, oy - gh + 4);
  c.fillText('t', ox + gw - 4, oy + 16);
  c.fillText(isVt ? 'v–t' : 's–t', x0 + 8, y0 - h + 16);
  let ymin = 0, ymax = 0;
  const samples = [];
  for (let i = 0; i <= 40; i++) {
    const t = tMax * i / 40;
    const val = isVt ? u + a * t : u * t + 0.5 * a * t * t;
    samples.push({ t, val });
    ymin = Math.min(ymin, val); ymax = Math.max(ymax, val);
  }
  const pad = (ymax - ymin) * 0.12 || 1;
  ymin -= pad; ymax += pad;
  const mapX = (t) => ox + (t / tMax) * gw;
  const mapY = (v) => oy - ((v - ymin) / (ymax - ymin)) * gh;
  c.strokeStyle = '#2566c8'; c.lineWidth = 2.5; c.beginPath();
  samples.forEach((s, i) => {
    const px = mapX(s.t), py = mapY(s.val);
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  });
  c.stroke();
  c.fillStyle = '#2566c8'; c.font = '14px sans-serif';
  const eq = isVt ? `v = ${fmt(u)}${a >= 0 ? '+' : ''}${fmt(a)}t` : `s = ${fmt(u)}t${a >= 0 ? '+' : ''}${fmt(0.5 * a)}t²`;
  c.fillText(eq, ox + 8, oy - gh + 18);
}

export function drawMechItems(c, pg) {
  for (const item of pg.mechItems || []) {
    if (item.kind === 'forces') drawForceDiagram(c, item);
    else if (item.kind === 'incline') drawIncline(c, item);
    else if (item.kind === 'projectile') drawProjectile(c, item);
    else if (item.kind === 'motion') drawMotionGraph(c, item);
  }
}

function renderForceDraft() {
  const list = document.getElementById('mf-list');
  if (!list) return;
  list.innerHTML = '';
  draft.forces.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'mech-row';
    const mk = (ph, val, key, w) => {
      const inp = document.createElement('input');
      inp.className = 'mech-in'; inp.placeholder = ph; inp.value = val;
      if (w) inp.style.width = w;
      inp.oninput = () => { f[key] = key === 'label' ? inp.value : +inp.value || 0; };
      return inp;
    };
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'mech-del'; del.textContent = '×';
    del.onclick = () => { if (draft.forces.length > 1) { draft.forces.splice(i, 1); renderForceDraft(); } };
    row.append(mk('F', f.label, 'label', '42px'), mk('mag', f.mag, 'mag'), mk('°', f.angleDeg, 'angleDeg'), del);
    list.appendChild(row);
  });
}

function bindDraft() {
  const rr = document.getElementById('mf-resultant');
  if (rr) rr.onchange = () => { draft.showResultant = rr.checked; };
  document.getElementById('mf-add')?.addEventListener('click', () => {
    draft.forces.push({ label: 'F', mag: 3, angleDeg: 0 });
    renderForceDraft();
  });
  const bind3 = (ids, obj, keys) => {
    ids.forEach((id, i) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.oninput = () => { obj[keys[i]] = keys[i] === 'showComponents' || keys[i] === 'showVel' ? el.checked : +el.value || 0; };
      if (el.type === 'checkbox') el.onchange = el.oninput;
    });
  };
  bind3(['mi-angle', 'mi-mass', 'mi-mu'], draft.incline, ['angleDeg', 'mass', 'mu']);
  const mic = document.getElementById('mi-comp');
  if (mic) mic.onchange = () => { draft.incline.showComponents = mic.checked; };
  bind3(['mp-u', 'mp-theta', 'mp-g'], draft.projectile, ['u', 'thetaDeg', 'g']);
  const mpv = document.getElementById('mp-vel');
  if (mpv) mpv.onchange = () => { draft.projectile.showVel = mpv.checked; };
  bind3(['mm-u', 'mm-a', 'mm-t'], draft.motion, ['u', 'a', 'tMax']);
  document.querySelectorAll('[data-mgraph]').forEach((b) => {
    b.onclick = () => {
      draft.motion.graph = b.dataset.mgraph;
      document.querySelectorAll('[data-mgraph]').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
}

function showMechPane(name) {
  document.querySelectorAll('.mech-pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'mech-' + name));
  document.querySelectorAll('[data-mtab]').forEach((b) => b.classList.toggle('active', b.dataset.mtab === name));
}

export function setupMechPanel() {
  renderForceDraft();
  bindDraft();
  document.querySelectorAll('[data-mtab]').forEach((b) => b.onclick = () => showMechPane(b.dataset.mtab));
  document.querySelectorAll('[data-mplace]').forEach((b) => {
    b.onclick = () => setMechPlacing(placeKind === b.dataset.mplace ? null : b.dataset.mplace);
  });
  document.getElementById('mech-clear')?.addEventListener('click', clearMechPage);
  document.getElementById('mech-toggle')?.addEventListener('click', () => {
    document.getElementById('mech')?.classList.toggle('hidden');
  });
  document.getElementById('mech-close')?.addEventListener('click', () => {
    document.getElementById('mech')?.classList.add('hidden');
    setMechPlacing(null);
  });
  const mic = document.getElementById('mi-comp');
  if (mic) mic.checked = draft.incline.showComponents;
  const mpv = document.getElementById('mp-vel');
  if (mpv) mpv.checked = draft.projectile.showVel;
  const rr = document.getElementById('mf-resultant');
  if (rr) rr.checked = draft.showResultant;
}
