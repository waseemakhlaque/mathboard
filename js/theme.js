// theme.js — light / dark / system theme with localStorage persistence

const STORAGE_KEY = 'mb-theme';
const MODES = ['system', 'light', 'dark'];

let mode = 'system';
let media;

function resolveTheme(m) {
  if (m === 'dark') return 'dark';
  if (m === 'light') return 'light';
  return media?.matches ? 'dark' : 'light';
}

function apply() {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0f1419' : '#f0f4f8';
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    const label = mode === 'system' ? 'System theme' : mode === 'dark' ? 'Dark theme' : 'Light theme';
    btn.title = `${label} — click to cycle`;
    btn.setAttribute('aria-label', label);
    btn.textContent = mode === 'dark' ? '☾' : mode === 'light' ? '☀' : '◐';
  });
}

export function getThemeMode() { return mode; }

export function getResolvedTheme() { return resolveTheme(mode); }

export function setThemeMode(next) {
  if (!MODES.includes(next)) return;
  mode = next;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ok */ }
  apply();
}

export function cycleTheme() {
  const i = MODES.indexOf(mode);
  setThemeMode(MODES[(i + 1) % MODES.length]);
}

export function initTheme() {
  media = window.matchMedia?.('(prefers-color-scheme: dark)');
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (MODES.includes(saved)) mode = saved;
  } catch { /* ok */ }
  media?.addEventListener?.('change', () => { if (mode === 'system') apply(); });
  apply();
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => cycleTheme());
  });
}
