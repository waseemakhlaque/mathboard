// ragSearch.js — "Ask the syllabus" panel on the Course Library tab.
// Retrieval-only: POST /api/rag/query → snippet cards from the ingested 9709
// corpus, deep-linking into Course Library shelves and animated tools.

import { animForTopic, LABS, defaultParams, simByTag } from './anim/ragRoutes.js';
import { authHeaders } from './auth.js';

const RAG_RESULTS = 10;
const COURSES = ['Pure Mathematics 3', 'Mechanics', 'Statistics', 'Pure Mathematics 1'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function buildParamsEditor(el, sim) {
  const panel = document.querySelector('#anim-params');
  const schema = sim?.paramSchema || {};
  if (!Object.keys(schema).length) {
    panel.classList.add('hidden');
    return;
  }

  panel.replaceChildren();
  panel.classList.remove('hidden');
  for (const [name, spec] of Object.entries(schema)) {
    const group = document.createElement('div');
    group.className = 'anim-param-group';
    const label = document.createElement('label');
    label.textContent = spec.label || name;
    group.appendChild(label);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = spec.min;
    input.max = spec.max;
    input.step = spec.step || ((spec.max - spec.min) <= 1 ? 0.01 : 1);
    input.value = el.params?.[name] ?? spec.default ?? 0;
    input.addEventListener('change', () => {
      const v = Math.min(spec.max, Math.max(spec.min, Number(input.value) || spec.default));
      input.value = v;
      if (!el.params) el.params = {};
      el.params[name] = v;
      el.setAttribute('params', JSON.stringify(el.params));
      if (typeof el.reset === 'function') el.reset();
      if (typeof el.refresh === 'function') el.refresh();
    });
    group.appendChild(input);

    const unit = spec.unit ? ` ${spec.unit}` : '';
    const display = document.createElement('div');
    display.className = 'anim-param-value';
    display.textContent = `${input.value}${unit}`;
    input.addEventListener('input', () => {
      display.textContent = `${input.value}${unit}`;
    });
    group.appendChild(display);
    panel.appendChild(group);
  }
}

export function mountAnimTool(tag, title, defaults) {
  const dlg = document.querySelector('#anim-dialog');
  const host = document.querySelector('#anim-host');
  const paramsPanel = document.querySelector('#anim-params');
  const pinBtn = document.querySelector('#anim-pin');
  const fullscreenBtn = document.querySelector('#anim-fullscreen');

  document.querySelector('#anim-title').textContent = title;
  host.replaceChildren();
  paramsPanel.replaceChildren();

  const el = document.createElement(tag);
  if (defaults) {
    el.params = defaults;
    el.setAttribute('params', JSON.stringify(defaults));
  }
  host.appendChild(el);

  // Build params editor
  const sim = simByTag(tag);
  buildParamsEditor(el, sim);

  // Setup dialog buttons
  pinBtn?.classList.add('hidden'); // Phase 4 enables this
  fullscreenBtn?.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      dlg.requestFullscreen().catch(() => {});
    }
  });

  dlg.classList.remove('hidden');
  if (el instanceof HTMLElement && typeof el.play === 'function') el.play();
}

function mountTool(tag, title, defaults) {
  mountAnimTool(tag, title, defaults);
}

export function openAnimDialog(topic) {
  const route = animForTopic(topic);
  if (!route) return;
  mountTool(route.tag, route.title, route.defaults);
}

/** Interactive lab picker inside the anim dialog (grouped M1 / P1 / P3). */
export function openLabPicker() {
  const dlg = document.querySelector('#anim-dialog');
  const host = document.querySelector('#anim-host');
  document.querySelector('#anim-title').textContent = 'Interactive Labs — drag to explore';
  host.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'mb-lab-picker';
  const GROUP_LABELS = { M1: 'Mechanics (M1)', P1: 'Pure 1 (P1)', P3: 'Pure 3 (P3)' };
  for (const group of ['M1', 'P1', 'P3']) {
    const labs = LABS.filter((lab) => lab.group === group);
    if (!labs.length) continue;
    const heading = document.createElement('div');
    heading.className = 'mb-lab-picker-heading';
    heading.textContent = GROUP_LABELS[group];
    wrap.appendChild(heading);
    const row = document.createElement('div');
    row.className = 'mb-lab-picker-row';
    for (const lab of labs) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mb-lab-chip';
      chip.textContent = `${lab.icon} ${lab.title}`;
      chip.addEventListener('click', () => {
        const params = Object.keys(lab.paramSchema || {}).length ? defaultParams(lab) : undefined;
        mountTool(lab.tag, lab.title, params);
      });
      row.appendChild(chip);
    }
    wrap.appendChild(row);
  }
  host.appendChild(wrap);
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
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ q, topK: RAG_RESULTS, filter: course ? { course } : undefined }),
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

// "9709 s19 QP 12 Q3" → "9709_s19_qp_12.pdf" (matches content/papers/ keys).
function paperFileFromRef(ref) {
  const m = String(ref || '').match(/^9709 ([smw])(\d{2}) (QP|MS) (\d{1,2})/);
  return m ? `9709_${m[1]}${m[2]}_${m[3].toLowerCase()}_${m[4]}.pdf` : null;
}

function renderResults(container, all, hooks) {
  container.innerHTML = '';
  if (!all.length) {
    container.innerHTML = '<p class="muted rag-msg">No matches in the ingested papers.</p>';
    return;
  }
  for (const r of all.slice(0, RAG_RESULTS)) {
    const card = document.createElement('div');
    card.className = 'rag-card';
    const canShelf = r.course && r.topic && r.course !== 'Pure Mathematics 1';
    const canAnim = !!animForTopic(r.topic);
    const paperFile = r.kind === 'book' ? null : paperFileFromRef(r.ref);
    card.innerHTML = `
      <header>${esc(r.ref || r.id)}${r.topic ? ` · ${esc(r.topic)}` : ''}</header>
      <p>${esc((r.text || '').slice(0, 220))}…</p>
      <div class="rag-card-actions">
        ${paperFile ? '<button type="button" class="rag-paper">📄 Open paper</button>' : ''}
        ${canShelf ? '<button type="button" class="rag-shelf">Open shelf</button>' : ''}
        ${canAnim ? '<button type="button" class="rag-anim">▶ Animate</button>' : ''}
      </div>`;
    card.querySelector('.rag-paper')?.addEventListener('click', () => hooks.onOpenPaper?.(paperFile));
    card.querySelector('.rag-shelf')?.addEventListener('click', () => hooks.onOpenShelf?.(r.course, r.topic, r.exercise));
    card.querySelector('.rag-anim')?.addEventListener('click', () => openAnimDialog(r.topic));
    container.appendChild(card);
  }
}
