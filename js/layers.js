// layers.js — page layers panel: reorder + visibility for strokes and objects

let hooks = {};

export function setupLayers(h) { hooks = h; }

function page() { return hooks.page?.(); }

function layerItems(pg) {
  const items = [];
  (pg.strokes || []).forEach((s, i) => {
    if (s.hidden) return;
    items.push({ kind: 'stroke', ref: s, idx: i, label: `${s.tool || 'ink'} stroke`, hidden: !!s.hidden });
  });
  (pg.objects || []).forEach((o, i) => {
    items.push({ kind: 'object', ref: o, idx: i, label: o.kind || 'object', hidden: !!o.hidden });
  });
  return items;
}

function allLayerEntries(pg) {
  const strokes = (pg.strokes || []).map((s, i) => ({ kind: 'stroke', ref: s, idx: i, label: `${s.tool || 'ink'}`, hidden: !!s.hidden }));
  const objects = (pg.objects || []).map((o, i) => ({ kind: 'object', ref: o, idx: i, label: o.kind || 'obj', hidden: !!o.hidden }));
  return [...strokes, ...objects];
}

function moveInArray(arr, from, to) {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return;
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
}

export function renderLayersPanel() {
  const list = document.getElementById('layers-list');
  if (!list) return;
  const pg = page();
  if (!pg) { list.innerHTML = '<p class="muted">No page</p>'; return; }
  list.innerHTML = '';
  const entries = allLayerEntries(pg).reverse(); // top layer first in UI
  if (!entries.length) {
    list.innerHTML = '<p class="muted">Empty page</p>';
    return;
  }
  entries.forEach((ent, ui) => {
    const row = document.createElement('div');
    row.className = 'layer-row' + (ent.hidden ? ' layer-hidden' : '');
    const lab = document.createElement('span');
    lab.className = 'layer-label';
    lab.textContent = ent.kind === 'stroke' ? `✎ ${ent.label}` : `◆ ${ent.label}`;
    const vis = document.createElement('button');
    vis.type = 'button'; vis.className = 'layer-btn'; vis.title = ent.hidden ? 'Show' : 'Hide';
    vis.textContent = ent.hidden ? '👁‍🗨' : '👁';
    vis.onclick = () => {
      hooks.beginAction?.();
      ent.ref.hidden = !ent.ref.hidden;
      hooks.commitAction?.();
      hooks.persist?.();
      hooks.mark?.();
      renderLayersPanel();
    };
    const up = document.createElement('button');
    up.type = 'button'; up.className = 'layer-btn'; up.textContent = '↑'; up.title = 'Move up';
    up.disabled = ui === 0;
    up.onclick = () => {
      const arr = ent.kind === 'stroke' ? pg.strokes : pg.objects;
      const realIdx = arr.indexOf(ent.ref);
      if (realIdx < 0 || realIdx >= arr.length - 1) return;
      hooks.beginAction?.();
      moveInArray(arr, realIdx, realIdx + 1);
      hooks.commitAction?.();
      hooks.persist?.();
      hooks.mark?.();
      renderLayersPanel();
    };
    const down = document.createElement('button');
    down.type = 'button'; down.className = 'layer-btn'; down.textContent = '↓'; down.title = 'Move down';
    down.disabled = ui === entries.length - 1;
    down.onclick = () => {
      const arr = ent.kind === 'stroke' ? pg.strokes : pg.objects;
      const realIdx = arr.indexOf(ent.ref);
      if (realIdx <= 0) return;
      hooks.beginAction?.();
      moveInArray(arr, realIdx, realIdx - 1);
      hooks.commitAction?.();
      hooks.persist?.();
      hooks.mark?.();
      renderLayersPanel();
    };
    row.append(lab, vis, up, down);
    list.appendChild(row);
  });
}

export function setupLayersPanel() {
  document.getElementById('layers-close')?.addEventListener('click', () => {
    document.getElementById('layers')?.classList.add('hidden');
  });
  document.getElementById('layers-toggle')?.addEventListener('click', () => {
    const p = document.getElementById('layers');
    p?.classList.toggle('hidden');
    if (p && !p.classList.contains('hidden')) renderLayersPanel();
  });
}

/** Skip hidden layers when drawing. */
export function visibleStrokes(pg) {
  return (pg.strokes || []).filter((s) => !s.hidden);
}

export function visibleObjects(pg) {
  return (pg.objects || []).filter((o) => !o.hidden);
}
