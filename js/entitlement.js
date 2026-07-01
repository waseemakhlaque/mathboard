// entitlement.js — lightweight plan / paywall layer (no card data in client)

const PLAN_KEY = 'mb-plan';
const PRO_UNTIL_KEY = 'mb-pro-until';

/** Free tier limits — adjust gates via hasPro() only. */
export const FREE_LESSON_LIMIT = 5;
export const FREE_COURSE_PREVIEW = 3;

let plan = 'free';
let proUntil = 0;

function readPlan() {
  try {
    plan = localStorage.getItem(PLAN_KEY) || 'free';
    proUntil = Number(localStorage.getItem(PRO_UNTIL_KEY) || 0);
  } catch { plan = 'free'; proUntil = 0; }
  // Dev / QA: ?pro=1 activates Pro locally (never use in production marketing).
  if (new URLSearchParams(location.search).get('pro') === '1') plan = 'pro';
  if (proUntil && Date.now() > proUntil) {
    plan = 'free';
    try {
      localStorage.setItem(PLAN_KEY, 'free');
      localStorage.removeItem(PRO_UNTIL_KEY);
    } catch { /* ok */ }
  }
}

/** Single gate — move feature checks here. */
export function hasPro() {
  readPlan();
  return plan === 'pro';
}

export function getPlan() {
  readPlan();
  return plan;
}

export function setPlan(next) {
  plan = next === 'pro' ? 'pro' : 'free';
  try { localStorage.setItem(PLAN_KEY, plan); } catch { /* ok */ }
}

/** Called after successful hosted checkout redirect (?checkout=success). */
export function activatePro(untilMs = 0) {
  setPlan('pro');
  if (untilMs > Date.now()) {
    proUntil = untilMs;
    try { localStorage.setItem(PRO_UNTIL_KEY, String(untilMs)); } catch { /* ok */ }
  }
}

export function canCreateLesson(notebookCount) {
  return hasPro() || notebookCount < FREE_LESSON_LIMIT;
}

export function canUseCloudSync() {
  return hasPro();
}

export function canOpenCourseExample(indexInExercise) {
  return hasPro() || indexInExercise < FREE_COURSE_PREVIEW;
}

/** Billing API base — public URL only; secrets live in billing-worker env. */
export function billingApiUrl() {
  const cfg = window.MB_CONFIG || {};
  return (cfg.billingApiUrl || '').trim().replace(/\/$/, '');
}

/** Redirect to hosted Stripe Checkout (Worker creates session server-side). */
export async function startCheckout() {
  const base = billingApiUrl();
  if (!base) {
    throw new Error('Billing is not configured yet. Set billingApiUrl in config.js when the Worker is deployed.');
  }
  const res = await fetch(`${base}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnUrl: location.origin + location.pathname }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not start checkout.');
  if (data.url) location.href = data.url;
  else throw new Error('Checkout URL missing from server response.');
}

export function handleCheckoutReturn() {
  const p = new URLSearchParams(location.search);
  if (p.get('checkout') === 'success') {
    activatePro(Date.now() + 365 * 864e5);
    p.delete('checkout');
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    return true;
  }
  return false;
}

export function initEntitlement() {
  readPlan();
  handleCheckoutReturn();
}
