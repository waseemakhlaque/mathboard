// gate.js — full-screen access gate shown before the app boots.
// Screens: sign-in (email/password) and "no access / access ended".
// Real enforcement is server-side (Worker JWT checks + Supabase RLS);
// this module only decides which screen the visitor sees.

import {
  isSignedIn, signInWithPassword, signOut, getAuthUser, getSupabaseUrl,
  requestPasswordReset, updatePassword, consumeAuthRedirect,
} from './auth.js';
import { fetchProfile, isActive, getProfile, clearProfile } from './entitlement.js';

const cfg = () => window.MB_CONFIG || {};

const STYLE = `
#mb-gate { position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center;
  justify-content: center; background: linear-gradient(160deg, #0f172a, #1e2a4a); padding: 20px; }
#mb-gate .gate-card { background: #fff; color: #1b1b1b; border-radius: 16px; padding: 32px 28px;
  width: 100%; max-width: 380px; box-shadow: 0 24px 60px rgba(0,0,0,.45); text-align: center;
  font-family: Inter, system-ui, sans-serif; }
#mb-gate .gate-brand { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 6px; }
#mb-gate .gate-brand img { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; }
#mb-gate h1 { font-size: 22px; margin: 0; }
#mb-gate .gate-sub { color: #64748b; font-size: 13px; margin: 4px 0 20px; }
#mb-gate label { display: block; text-align: left; font-size: 12px; font-weight: 600;
  color: #475569; margin: 12px 0 4px; }
#mb-gate input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 15px;
  border: 1px solid #cbd5e1; border-radius: 8px; }
#mb-gate button.gate-primary { width: 100%; margin-top: 18px; padding: 11px; font-size: 15px;
  font-weight: 600; color: #fff; background: #2566c8; border: 0; border-radius: 8px; cursor: pointer; }
#mb-gate button.gate-primary:disabled { opacity: .6; }
#mb-gate button.gate-ghost { margin-top: 10px; padding: 8px; font-size: 13px; color: #475569;
  background: none; border: 0; cursor: pointer; text-decoration: underline; }
#mb-gate .gate-err { color: #d23b3b; font-size: 13px; min-height: 18px; margin-top: 10px; }
#mb-gate .gate-notice { background: #fef3c7; color: #92400e; border-radius: 8px; padding: 10px 12px;
  font-size: 13px; margin-bottom: 8px; text-align: left; line-height: 1.4; }
#mb-gate .gate-ok { background: #dcfce7; color: #166534; border-radius: 8px; padding: 10px 12px;
  font-size: 13px; margin-top: 12px; text-align: left; line-height: 1.4; }
#mb-gate .gate-contact { background: #f1f5f9; border-radius: 10px; padding: 12px; font-size: 14px;
  margin-top: 16px; line-height: 1.5; }
`;

let gateEl = null;

function mount(innerHtml) {
  if (!document.getElementById('mb-gate-style')) {
    const st = document.createElement('style');
    st.id = 'mb-gate-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  if (!gateEl) {
    gateEl = document.createElement('div');
    gateEl.id = 'mb-gate';
    document.body.appendChild(gateEl);
  }
  gateEl.innerHTML = `<div class="gate-card">${innerHtml}</div>`;
  return gateEl;
}

function removeGate() {
  gateEl?.remove();
  gateEl = null;
}

function brandHeader() {
  const c = cfg();
  const img = c.brandImage ? `<img src="${c.brandImage}" alt="" />` : '';
  return `<div class="gate-brand">${img}<h1>${c.brandName || 'MathBoard'}</h1></div>
    <p class="gate-sub">${c.brandTeacher || ''}${c.brandTitle ? ' — ' + c.brandTitle : ''}</p>`;
}

function teacherContact() {
  const c = cfg();
  const phone = c.brandPhone ? `<br><b>${c.brandPhone}</b>` : '';
  return `<div class="gate-contact">Contact ${c.brandTeacher || 'your teacher'} to activate your account.${phone}</div>`;
}

function renderSignIn(notice = '') {
  const el = mount(`
    ${brandHeader()}
    ${notice ? `<div class="gate-notice">${notice}</div>` : ''}
    <form id="gate-form">
      <label for="gate-email">Email</label>
      <input id="gate-email" type="email" autocomplete="username" required />
      <label for="gate-password">Password</label>
      <input id="gate-password" type="password" autocomplete="current-password" required />
      <div class="gate-err" id="gate-err" role="alert"></div>
      <button type="submit" class="gate-primary" id="gate-submit">Sign in</button>
      <button type="button" class="gate-ghost" id="gate-forgot">Forgot password?</button>
    </form>`);
  const form = el.querySelector('#gate-form');
  const errEl = el.querySelector('#gate-err');
  const btn = el.querySelector('#gate-submit');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      if (!getSupabaseUrl()) throw new Error('Sign-in is not configured on this deployment.');
      await signInWithPassword(
        el.querySelector('#gate-email').value.trim(),
        el.querySelector('#gate-password').value,
      );
      location.reload(); // clean boot with the new session
    } catch (err) {
      errEl.textContent = err.message || 'Sign-in failed.';
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
  el.querySelector('#gate-forgot').addEventListener('click', () => renderForgotPassword());
  setTimeout(() => el.querySelector('#gate-email')?.focus(), 50);
}

function renderForgotPassword() {
  const el = mount(`
    ${brandHeader()}
    <form id="gate-form">
      <p class="gate-sub" style="margin-top:0">Enter your email and we'll send you a link to set a new password.</p>
      <label for="gate-email">Email</label>
      <input id="gate-email" type="email" autocomplete="username" required />
      <div class="gate-err" id="gate-err" role="alert"></div>
      <button type="submit" class="gate-primary" id="gate-submit">Send reset link</button>
      <button type="button" class="gate-ghost" id="gate-back">Back to sign in</button>
    </form>`);
  const form = el.querySelector('#gate-form');
  const errEl = el.querySelector('#gate-err');
  const btn = el.querySelector('#gate-submit');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await requestPasswordReset(el.querySelector('#gate-email').value.trim());
      form.innerHTML = `<div class="gate-ok">Reset link sent. Open the email on <b>this device</b> and
        click the link right away — it expires quickly and only works once.</div>
        <button type="button" class="gate-ghost" id="gate-back">Back to sign in</button>`;
      form.querySelector('#gate-back').addEventListener('click', () => renderSignIn());
    } catch (err) {
      errEl.textContent = err.message || 'Could not send reset email.';
      btn.disabled = false;
      btn.textContent = 'Send reset link';
    }
  });
  el.querySelector('#gate-back')?.addEventListener('click', () => renderSignIn());
  setTimeout(() => el.querySelector('#gate-email')?.focus(), 50);
}

function renderSetPassword() {
  const el = mount(`
    ${brandHeader()}
    <form id="gate-form">
      <p class="gate-sub" style="margin-top:0">Choose a new password for your account.</p>
      <label for="gate-pass1">New password</label>
      <input id="gate-pass1" type="password" autocomplete="new-password" minlength="6" required />
      <label for="gate-pass2">Confirm new password</label>
      <input id="gate-pass2" type="password" autocomplete="new-password" minlength="6" required />
      <div class="gate-err" id="gate-err" role="alert"></div>
      <button type="submit" class="gate-primary" id="gate-submit">Set new password</button>
    </form>`);
  const form = el.querySelector('#gate-form');
  const errEl = el.querySelector('#gate-err');
  const btn = el.querySelector('#gate-submit');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const p1 = el.querySelector('#gate-pass1').value;
    const p2 = el.querySelector('#gate-pass2').value;
    if (p1 !== p2) { errEl.textContent = 'Passwords do not match.'; return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await updatePassword(p1);
      location.reload(); // clean boot with the new session
    } catch (err) {
      errEl.textContent = err.message || 'Could not update password.';
      btn.disabled = false;
      btn.textContent = 'Set new password';
    }
  });
  setTimeout(() => el.querySelector('#gate-pass1')?.focus(), 50);
}

function renderNoAccess() {
  const p = getProfile();
  const email = getAuthUser()?.email || '';
  const ended = p?.active_until && Date.parse(p.active_until) <= Date.now();
  const headline = ended ? 'Your access has ended' : 'Account not activated yet';
  const detail = ended
    ? 'Your MathBoard access period is over.'
    : 'This account is signed in but has not been given access yet.';
  const el = mount(`
    ${brandHeader()}
    <h1 style="font-size:18px">${headline}</h1>
    <p class="gate-sub">${detail}<br>${email ? `Signed in as <b>${email}</b>` : ''}</p>
    ${teacherContact()}
    <button type="button" class="gate-primary" id="gate-retry">Check again</button>
    <button type="button" class="gate-ghost" id="gate-signout">Sign out</button>`);
  el.querySelector('#gate-retry').addEventListener('click', () => location.reload());
  el.querySelector('#gate-signout').addEventListener('click', async () => {
    try { await signOut(); } catch { /* local session already cleared in auth.signOut */ }
    clearProfile();
    location.reload();
  });
}

/**
 * Boot gate. Returns true when the app may start; otherwise a gate screen
 * is showing and the caller must NOT initialise the app.
 */
export async function ensureAccess() {
  if (!getSupabaseUrl()) {
    // Local dev without config: let the developer in, loudly.
    console.warn('gate: supabaseUrl missing — access gate disabled.');
    return true;
  }
  const redirect = consumeAuthRedirect();
  if (redirect?.kind === 'error' && !isSignedIn()) {
    renderSignIn('That link has expired or was already used. Sign in below, or tap '
      + '"Forgot password?" to get a fresh link — then open it right away.');
    return false;
  }
  if (redirect?.kind === 'recovery') {
    renderSetPassword();
    return false;
  }
  if (!isSignedIn()) {
    renderSignIn();
    return false;
  }
  await fetchProfile({ force: true });
  if (isActive()) {
    removeGate();
    return true;
  }
  renderNoAccess();
  return false;
}
