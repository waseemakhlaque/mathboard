// onboarding.js — first-run welcome + 60-second interactive tour

const STORAGE_KEY = 'mb-onboarded-v1';

const STEPS = [
  {
    target: '#new-nb',
    title: 'Create a lesson',
    body: 'Start with a blank notebook — draw vectors, equations, and worked solutions on paginated pages.',
    view: 'library',
  },
  {
    target: '[data-tool="pen"]',
    title: 'Draw on the canvas',
    body: 'Use the pen, highlighter, and shapes. Pressure-sensitive on iPad with Apple Pencil.',
    view: 'editor',
    demo: true,
  },
  {
    target: '#demo-toggle',
    title: 'Animate with Scene',
    body: 'Build step-by-step animations — perfect for teaching mechanics, graphs, and proofs.',
    view: 'editor',
  },
  {
    target: '.lib-tab[data-lib="course"]',
    title: 'Course Library',
    body: 'File animated examples under Course → Topic → Exercise, then present them in class.',
    view: 'library',
  },
  {
    target: '#present-toggle',
    title: 'Present mode',
    body: 'Clean projector layout with laser pointer, page controls, and auto-hiding chrome.',
    view: 'editor',
  },
];

let step = 0;
let overlay = null;
let spotlight = null;
let card = null;

function $(sel) { return document.querySelector(sel); }

function showView(name) {
  $('#library')?.classList.toggle('hidden', name !== 'library');
  $('#editor')?.classList.toggle('hidden', name !== 'editor');
}

function placeSpotlight(el) {
  if (!el || !spotlight) { spotlight?.classList.add('hidden'); return; }
  const r = el.getBoundingClientRect();
  const pad = 8;
  spotlight.classList.remove('hidden');
  spotlight.style.top = `${Math.max(8, r.top - pad)}px`;
  spotlight.style.left = `${Math.max(8, r.left - pad)}px`;
  spotlight.style.width = `${r.width + pad * 2}px`;
  spotlight.style.height = `${r.height + pad * 2}px`;
  el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

function renderStep() {
  const s = STEPS[step];
  if (!s) return finish();
  showView(s.view);
  if (s.demo && s.view === 'editor') {
    $('#demo-bar')?.classList.remove('hidden');
  }
  const el = $(s.target);
  placeSpotlight(el);
  card.querySelector('.onboard-title').textContent = s.title;
  card.querySelector('.onboard-body').textContent = s.body;
  card.querySelector('.onboard-step').textContent = `${step + 1} / ${STEPS.length}`;
  card.querySelector('#onboard-back').disabled = step === 0;
  card.querySelector('#onboard-next').textContent = step === STEPS.length - 1 ? 'Done' : 'Next';
}

function finish() {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ok */ }
  overlay?.classList.add('hidden');
  overlay?.setAttribute('aria-hidden', 'true');
  showView('library');
}

function skip() { finish(); }

function next() {
  if (step >= STEPS.length - 1) finish();
  else { step += 1; renderStep(); }
}

function back() {
  if (step > 0) { step -= 1; renderStep(); }
}

export function maybeStartOnboarding(force = false) {
  try {
    if (!force && localStorage.getItem(STORAGE_KEY)) return;
  } catch { /* ok */ }
  if (!overlay) {
    overlay = document.getElementById('onboard-overlay');
    spotlight = document.getElementById('onboard-spot');
    card = document.getElementById('onboard-card');
    if (!overlay) return;
    $('#onboard-skip')?.addEventListener('click', skip);
    $('#onboard-back')?.addEventListener('click', back);
    $('#onboard-next')?.addEventListener('click', next);
    $('#onboard-welcome-start')?.addEventListener('click', () => {
      document.getElementById('onboard-welcome')?.classList.add('hidden');
      card?.classList.remove('hidden');
      step = 0;
      renderStep();
    });
    $('#onboard-welcome-skip')?.addEventListener('click', skip);
  }
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  document.getElementById('onboard-welcome')?.classList.remove('hidden');
  card?.classList.add('hidden');
}

export function startTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
  maybeStartOnboarding(true);
  document.getElementById('onboard-welcome')?.classList.add('hidden');
  card?.classList.remove('hidden');
  step = 0;
  renderStep();
}

export function initOnboarding() {
  document.getElementById('help-tour')?.addEventListener('click', startTour);
  window.addEventListener('resize', () => {
    if (overlay && !overlay.classList.contains('hidden')) renderStep();
  });
  maybeStartOnboarding(false);
}
