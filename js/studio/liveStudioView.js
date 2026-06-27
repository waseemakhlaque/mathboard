// studio/liveStudioView.js — Presentation Window Mode overlay

import { initStudio, addObject, setChroma, clearAnnotations, teardownStudio } from './studioManager.js';

let open = false;
let mgr = null;

export function studioIsOpen() { return open; }

export async function openStudio() {
  const el = document.getElementById('studio');
  const btn = document.getElementById('studio-toggle');
  if (!el || open) return;
  el.classList.remove('hidden');
  open = true;
  btn?.classList.add('brand-toggle-active');
  try {
    await initStudio(el);
    mgr = true;
  } catch (_) {
    closeStudio();
    return;
  }
  const wrap = el.querySelector('.studio-wrap');
  wrap?.requestFullscreen?.().catch(() => {});
}

export function closeStudio() {
  const el = document.getElementById('studio');
  const btn = document.getElementById('studio-toggle');
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  teardownStudio();
  el?.classList.add('hidden');
  btn?.classList.remove('brand-toggle-active');
  open = false;
  mgr = null;
}

export function setupStudioUI() {
  document.getElementById('studio-toggle')?.addEventListener('click', () => {
    open ? closeStudio() : openStudio();
  });
  document.getElementById('studio-close')?.addEventListener('click', closeStudio);
  document.getElementById('studio-add')?.addEventListener('click', () => {
    const spec = document.getElementById('studio-spec')?.value?.trim() || 'helix r=1 turns=3';
    addObject(spec);
  });
  document.getElementById('studio-chroma')?.addEventListener('change', (e) => setChroma(e.target.checked));
  document.getElementById('studio-clear-ink')?.addEventListener('click', clearAnnotations);
  document.querySelectorAll('[data-3d]').forEach((b) => {
    b.addEventListener('click', () => addObject(b.dataset['3d']));
  });
}
