// auth.js — Supabase email/password sign-in for cloud sync (no supabase-js bundle)

const TOKEN_KEY = 'mb-access-token';
const REFRESH_KEY = 'mb-refresh-token';
const USER_KEY = 'mb-auth-user';

function cfg() {
  return window.MB_CONFIG || {};
}

export function getSupabaseUrl() {
  return (cfg().supabaseUrl || '').trim().replace(/\/$/, '');
}

export function getSupabaseAnonKey() {
  return (cfg().supabaseAnonKey || '').trim();
}

export function defaultSyncApiUrl() {
  const custom = (cfg().syncApiUrl || '').trim().replace(/\/$/, '');
  if (custom) return custom;
  const base = getSupabaseUrl();
  return base ? `${base}/functions/v1/mathboard` : '';
}

export function getAccessToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function getAuthUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function isSignedIn() {
  return !!getAccessToken();
}

/** Drop MathBoard session keys plus any leftover supabase-js auth tokens. */
export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    // Known project key (supabase-js default) — remove explicitly too.
    localStorage.removeItem('sb-mjiuhdcxdllurizffvik-auth-token');
    // Sweep any other sb-*-auth-token / supabase.auth.* leftovers.
    const drop = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      if ((k.startsWith('sb-') && k.includes('auth-token')) || k.startsWith('supabase.auth.')) {
        drop.push(k);
      }
    }
    for (const k of drop) localStorage.removeItem(k);
  } catch { /* ok */ }
}

/** Dispose any cached Supabase JS client so a stale session can't linger. */
function disposeSupabaseClient() {
  try {
    const c = window.__mbSupabase || window.supabase;
    if (c?.auth?.signOut) c.auth.signOut().catch(() => {});
    if (window.__mbSupabase) window.__mbSupabase = null;
  } catch { /* ok */ }
}

function saveSession(payload) {
  if (payload.access_token) localStorage.setItem(TOKEN_KEY, payload.access_token);
  if (payload.refresh_token) localStorage.setItem(REFRESH_KEY, payload.refresh_token);
  if (payload.user) localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
}

function tokenExpiresAt(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp ? payload.exp * 1000 : 0;
  } catch { return 0; }
}

/** Refresh JWT if near expiry; returns false when session is gone. */
export async function ensureValidToken() {
  const token = getAccessToken();
  if (!token) return false;
  const exp = tokenExpiresAt(token);
  if (exp && Date.now() < exp - 60_000) return true;
  return refreshAccessToken();
}

export async function refreshAccessToken() {
  let refresh = '';
  try { refresh = localStorage.getItem(REFRESH_KEY) || ''; } catch { /* ok */ }
  if (!refresh) { clearSession(); return false; }
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) return false;
  const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { clearSession(); return false; }
  saveSession(data);
  return true;
}

/** Headers for Supabase REST / Edge Function calls. */
export function authHeaders(extra = {}) {
  const h = { ...extra };
  const key = getSupabaseAnonKey();
  const token = getAccessToken();
  if (key) h.apikey = key;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function signInWithPassword(email, password) {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) throw new Error('Set supabaseUrl and supabaseAnonKey in config.js first.');
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Sign-in failed.');
  saveSession(data);
  return data;
}

/** Send a password-reset email. The link returns to this page. */
export async function requestPasswordReset(email) {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) throw new Error('Set supabaseUrl and supabaseAnonKey in config.js first.');
  const redirectTo = encodeURIComponent(location.origin + location.pathname);
  const res = await fetch(`${url}/auth/v1/recover?redirect_to=${redirectTo}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error_description || data.msg || data.message || 'Could not send reset email.');
  }
}

/** Set a new password for the currently signed-in session. */
export async function updatePassword(newPassword) {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  const token = getAccessToken();
  if (!token) throw new Error('Reset session expired. Request a new link.');
  const res = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Could not update password.');
  try { localStorage.setItem(USER_KEY, JSON.stringify(data)); } catch { /* ok */ }
  return data;
}

/**
 * Handle a Supabase auth redirect in the URL hash (recovery links, errors).
 * Consumes the hash so reloads don't re-trigger. Returns:
 *   null                              — no auth params in the URL
 *   { kind: 'error', description }   — expired/invalid link
 *   { kind: 'recovery' }             — valid recovery session (tokens saved)
 *   { kind: 'signin' }               — other token redirect (tokens saved)
 */
export function consumeAuthRedirect() {
  const hash = (location.hash || '').replace(/^#\/?/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const error = params.get('error');
  const accessToken = params.get('access_token');
  if (!error && !accessToken) return null;
  history.replaceState(null, '', location.pathname + location.search);
  if (error) {
    const desc = (params.get('error_description') || '').replace(/\+/g, ' ');
    return { kind: 'error', code: params.get('error_code') || error, description: desc };
  }
  saveSession({
    access_token: accessToken,
    refresh_token: params.get('refresh_token') || '',
  });
  return { kind: params.get('type') === 'recovery' ? 'recovery' : 'signin' };
}

/**
 * Revoke the server session (best-effort), then always clear local tokens.
 * Throws if the remote logout request fails — local session is still cleared.
 */
export async function signOut() {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  const token = getAccessToken();
  let remoteErr = null;
  if (url && key && token) {
    try {
      const res = await fetch(`${url}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        remoteErr = new Error(
          data.error_description || data.msg || data.message || `Logout failed (${res.status})`,
        );
      }
    } catch (e) {
      remoteErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  clearSession();
  disposeSupabaseClient();
  if (remoteErr) throw remoteErr;
}
