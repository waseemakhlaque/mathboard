// ragSearch.js — "Ask the syllabus" panel on the Course Library tab.
// Retrieval-only: POST /api/rag/query → snippet cards from the ingested 9709
// corpus, deep-linking into Course Library shelves and animated tools.

import { hasPro } from './entitlement.js';
import { animForTopic, LABS } from './anim/ragRoutes.js';

const FREE_RAG_RESULTS = 3;
const PRO_RAG_RESULTS = 10;
const COURSES = ['Pure Mathematics 3', 'Mechanics', 'Statistics', 'Pure Mathematics 1'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mountTool(tag, title, defaults) {
  const dlg = document.querySelector('#anim-dialog');
  const host = document.querySelector('#anim-host');
  document.querySelector('#anim-title').textContent = title;
  host.replaceChildren();
  const el = document.createElement(tag);
  if (defaults) el.setAttribute('params', JSON.stringify(defaults));
  host.appendChild(el);
  dlg.classList.remove('hidden');
  if (el instanceof HTMLElement && typeof el.play === 'function') el.play();
}

export function openAnimDialog(topic) {
  const route = animForTopic(topic);
  if (!route) return;
  mountTool(route.tag, route.title, route.defaults);
}

/** Interactive physics-lab picker inside the anim dialog. */
export function openLabPicker() {
  const dlg = document.querySelector('#anim-dialog');
  const host = document.querySelector('#anim-host');
  document.querySelector('#anim-title').textContent = 'Physics Labs — drag to explore';
  host.replaceChildren();
  const row = document.createElement('div');
  row.className = 'mb-lab-picker';
  for (const lab of LABS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mb-lab-chip';
    chip.textContent = `${lab.icon} ${lab.title}`;
    chip.addEventListener('click', () => mountTool(lab.tag, lab.title));
    row.appendChild(chip);
  }
  host.appendChild(row);
  dlg.classList.remove('hidden');
}

function closeAnimDialog() {
  document.querySelector('#anim-dialog').classList.add('hidden');
  document.querySelector('#anim-host').replaceChildren(); // disconnect stops rAF
}

export function setupRagSearch(host, hooks = {}) {
  host.innerHTML = `
    <form class="rag-form">
      <input type="search" id="rag-q" placeholder="Ask the syllabus — e.g. angle between line and plane" autocomplete="off" />
      <select id="rag-course" aria-label="Course filter">
        <option value="">All courses</option>
        ${COURSES.map((c) => `<option>${esc(c)}</option>`).join('')}
      </select>
      <button type="submit" class="primary">Search</button>
      <button type="button" class="rag-labs-btn" title="Interactive physics labs">🧪 Labs</button>
    </form>
    <div class="rag-results"></div>`;
  const results = host.querySelector('.rag-results');
  const form = host.querySelector('.rag-form');
  host.querySelector('.rag-labs-btn').addEventListener('click', () => openLabPicker());

  document.querySelector('#anim-close')?.addEventListener('click', closeAnimDialog);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = host.querySelector('#rag-q').value.trim();
    if (!q) return;
    const course = host.querySelector('#rag-course').value;
    results.innerHTML = '<p class="muted rag-msg">Searching…</p>';
    let data;
    try {
      const res = await fetch('/api/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, topK: PRO_RAG_RESULTS, filter: course ? { course } : undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (_) {
      results.innerHTML = '<p class="muted rag-msg">Search unavailable offline.</p>';
      return;
    }
    renderResults(results, data.results || [], hooks);
  });
}

function renderResults(container, all, hooks) {
  container.innerHTML = '';
  if (!all.length) {
    container.innerHTML = '<p class="muted rag-msg">No matches in the ingested papers.</p>';
    return;
  }
  const limit = hasPro() ? PRO_RAG_RESULTS : FREE_RAG_RESULTS;
  for (const r of all.slice(0, limit)) {
    const card = document.createElement('div');
    card.className = 'rag-card';
    const canShelf = r.course && r.topic && r.course !== 'Pure Mathematics 1';
    const canAnim = !!animForTopic(r.topic);
    card.innerHTML = `
      <header>${esc(r.ref || r.id)}${r.topic ? ` · ${esc(r.topic)}` : ''}</header>
      <p>${esc((r.text || '').slice(0, 220))}…</p>
      <div class="rag-card-actions">
        ${canShelf ? '<button type="button" class="rag-shelf">Open shelf</button>' : ''}
        ${canAnim ? '<button type="button" class="rag-anim">▶ Animate</button>' : ''}
      </div>`;
    card.querySelector('.rag-shelf')?.addEventListener('click', () => hooks.onOpenShelf?.(r.course, r.topic, r.exercise));
    card.querySelector('.rag-anim')?.addEventListener('click', () => openAnimDialog(r.topic));
    container.appendChild(card);
  }
  if (!hasPro() && all.length > FREE_RAG_RESULTS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'rag-locked-row';
    row.textContent = `🔒 ${all.length - FREE_RAG_RESULTS} more results — upgrade to Pro`;
    row.addEventListener('click', () => hooks.onLocked?.());
    container.appendChild(row);
  }
}
