// papersLibrary.js — Past Papers & Books browser over the gated /content/ route.
// The manifest (content/papers.json) and every PDF require a signed-in session:
// fetches carry the Supabase JWT; "new tab" links carry it as ?token= (the
// Worker validates either). Nothing here is reachable logged-out.

import { authHeaders, getAccessToken, ensureValidToken } from './auth.js';

const SESSIONS = { s: 'May–June', m: 'Feb–March', w: 'Oct–Nov' };

const STYLE = `
#papers-dialog .sync-box { max-width: 640px; width: min(640px, 94vw); max-height: 86vh; overflow: auto; }
#papers-dialog .pl-tabs { display: flex; gap: 6px; margin: 10px 0; }
#papers-dialog .pl-tabs button.active { background: var(--accent, #2566c8); color: #fff; }
#papers-dialog .pl-filters { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
#papers-dialog .pl-filters select { flex: 1; min-width: 130px; }
#papers-dialog .pl-list { display: flex; flex-direction: column; gap: 4px; }
#papers-dialog .pl-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border: 1px solid rgba(128,128,128,.25); border-radius: 8px; font-size: 13px; }
#papers-dialog .pl-row .pl-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#papers-dialog .pl-row button { font-size: 12px; padding: 4px 10px; flex: none; }
#papers-dialog .pl-row.pl-dim { opacity: .55; }
#papers-dialog .pl-msg { font-size: 13px; min-height: 18px; margin-top: 8px; }
#papers-dialog .pl-msg.err { color: #d23b3b; }
#papers-dialog .pl-badge { font-size: 11px; color: #64748b; flex: none; }
`;

let importPdf = null;     // app.js importPdfAsNotebook
let manifest = null;
let tab = 'papers';

async function loadManifest() {
  if (manifest) return manifest;
  await ensureValidToken();
  const res = await fetch('./content/papers.json', { headers: authHeaders(), cache: 'no-cache' });
  if (!res.ok) throw new Error(res.status === 401 ? 'Sign in to browse papers.' : `Papers list unavailable (HTTP ${res.status}).`);
  manifest = await res.json();
  return manifest;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function openOnBoard(dir, file, msgEl) {
  if (msgEl) { msgEl.className = 'pl-msg'; msgEl.textContent = 'Loading PDF…'; }
  await ensureValidToken();
  const res = await fetch(`./content/${dir}/${encodeURIComponent(file)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Could not load PDF (HTTP ${res.status}).`);
  const blob = await res.blob();
  if (msgEl) msgEl.textContent = '';
  document.getElementById('papers-dialog')?.classList.add('hidden');
  await importPdf(new File([blob], file, { type: 'application/pdf' }));
}

function openInTab(dir, file) {
  const token = getAccessToken();
  window.open(`./content/${dir}/${encodeURIComponent(file)}?token=${encodeURIComponent(token)}`, '_blank', 'noopener');
}

/** Open a specific past-paper file (used by RAG search result cards). */
export async function openPaperFile(file) {
  if (!importPdf) return;
  try {
    await openOnBoard('papers', file, null);
  } catch (e) {
    alert(e.message || 'Could not open the paper.');
  }
}

function row(title, badge, dir, file, msgEl, { dim = false, note = '' } = {}) {
  const div = document.createElement('div');
  div.className = `pl-row${dim ? ' pl-dim' : ''}`;
  div.innerHTML = `<span class="pl-title">${esc(title)}</span><span class="pl-badge">${esc(badge)}</span>`;
  if (dim) {
    div.innerHTML += `<span class="pl-badge">${esc(note)}</span>`;
    return div;
  }
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'primary';
  openBtn.textContent = 'Open on board';
  openBtn.addEventListener('click', () => openOnBoard(dir, file, msgEl).catch((e) => {
    msgEl.className = 'pl-msg err';
    msgEl.textContent = e.message;
  }));
  const tabBtn = document.createElement('button');
  tabBtn.type = 'button';
  tabBtn.className = 'ghost';
  tabBtn.textContent = '↗';
  tabBtn.title = 'Open in a new tab';
  tabBtn.addEventListener('click', () => openInTab(dir, file));
  div.append(openBtn, tabBtn);
  return div;
}

function renderPapersTab(body, msgEl) {
  const m = { components: {}, papers: [], ...manifest };
  const comps = Object.keys(m.components).filter((c) => m.papers.some((p) => p.c === c));
  const years = [...new Set(m.papers.map((p) => p.y))].sort((a, b) => b - a);
  body.innerHTML = `
    <div class="pl-filters">
      <select class="ct-in" id="pl-comp">${comps.map((c) =>
        `<option value="${c}">${esc(m.components[c])} (paper ${c})</option>`).join('')}</select>
      <select class="ct-in" id="pl-year">${years.map((y) => `<option>${y}</option>`).join('')}</select>
    </div>
    <div class="pl-list" id="pl-list"></div>`;
  const list = body.querySelector('#pl-list');
  const render = () => {
    const c = body.querySelector('#pl-comp').value;
    const y = Number(body.querySelector('#pl-year').value);
    list.replaceChildren();
    const items = m.papers
      .filter((p) => p.c === c && p.y === y)
      .sort((a, b) => a.s.localeCompare(b.s) || a.v.localeCompare(b.v) || b.t.localeCompare(a.t));
    if (!items.length) {
      list.innerHTML = '<p class="muted">No papers for this component/year.</p>';
      return;
    }
    for (const p of items) {
      const title = `${SESSIONS[p.s] || p.s} ${p.y} — ${p.t === 'qp' ? 'Question paper' : 'Mark scheme'} ${p.c}${p.v}`;
      list.appendChild(row(title, p.f, 'papers', p.f, msgEl));
    }
  };
  body.querySelector('#pl-comp').addEventListener('change', render);
  body.querySelector('#pl-year').addEventListener('change', render);
  render();
}

function renderBooksTab(body, msgEl) {
  const m = manifest;
  body.innerHTML = '<div class="pl-list" id="pl-list"></div>';
  const list = body.querySelector('#pl-list');
  for (const b of m.books || []) {
    list.appendChild(row(`${b.title}`, `${b.comp} · ${b.mb} MB`, 'books', b.f, msgEl));
  }
  for (const x of m.extras || []) {
    list.appendChild(row(x.title, 'syllabus / formulae', 'extras', x.f, msgEl));
  }
  for (const t of m.tooLarge || []) {
    list.appendChild(row(t.title, `${t.mb} MB`, '', '', msgEl, { dim: true, note: 'too large — ask your teacher' }));
  }
}

function ensureDialog() {
  let dlg = document.getElementById('papers-dialog');
  if (dlg) return dlg;
  const st = document.createElement('style');
  st.textContent = STYLE;
  document.head.appendChild(st);
  dlg = document.createElement('div');
  dlg.id = 'papers-dialog';
  dlg.className = 'sync-dialog hidden';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.innerHTML = `
    <div class="sync-box">
      <h2>Past papers &amp; books</h2>
      <p class="muted" style="font-size:13px">Cambridge 9709 — opens straight onto the board so you can write on it.</p>
      <div class="pl-tabs">
        <button type="button" data-tab="papers" class="active">Past papers</button>
        <button type="button" data-tab="books" class="ghost">Books &amp; formulae</button>
      </div>
      <div id="pl-body"><p class="muted">Loading…</p></div>
      <div class="pl-msg" id="pl-msg"></div>
      <div class="sync-btns"><button type="button" class="ghost" id="pl-close">Close</button></div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.classList.add('hidden'); });
  dlg.querySelector('#pl-close').addEventListener('click', () => dlg.classList.add('hidden'));
  dlg.querySelectorAll('.pl-tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      dlg.querySelectorAll('.pl-tabs button').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.classList.toggle('ghost', x !== b);
      });
      renderBody(dlg);
    });
  });
  return dlg;
}

async function renderBody(dlg) {
  const body = dlg.querySelector('#pl-body');
  const msgEl = dlg.querySelector('#pl-msg');
  msgEl.textContent = '';
  try {
    // Tab clicks land here too — if the first manifest fetch failed, retry it
    // instead of dereferencing null (the "m.books" crash).
    if (!manifest) {
      body.innerHTML = '<p class="muted">Loading…</p>';
      await loadManifest();
    }
    if (tab === 'papers') renderPapersTab(body, msgEl);
    else renderBooksTab(body, msgEl);
  } catch (e) {
    body.innerHTML = `<p class="pl-msg err">${esc(e.message)}</p>`;
  }
}

async function openDialog() {
  const dlg = ensureDialog();
  dlg.classList.remove('hidden');
  renderBody(dlg);
}

/** Adds the "Past papers" button to the library header. */
export function setupPapersLibrary(opts = {}) {
  importPdf = opts.importPdf || null;
  const actions = document.querySelector('.lib-actions');
  if (!actions || document.getElementById('papers-open')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'papers-open';
  btn.title = 'Cambridge 9709 past papers and books';
  btn.textContent = 'Past papers';
  btn.addEventListener('click', openDialog);
  const anchor = document.getElementById('import-pdf-lib');
  actions.insertBefore(btn, anchor || actions.firstChild);
}
