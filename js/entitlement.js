// entitlement.js — access model: signed in + (admin OR active_until in the future).
// Freemium / Stripe checkout removed. The Worker enforces this server-side for
// content and APIs; this module mirrors it client-side so gate.js can decide
// which screen to show. Feature gates below stay "always true" — an inactive
// user never gets past the gate, so per-feature limits are pointless.

import {
  isSignedIn, getAuthUser, getSupabaseUrl, getSupabaseAnonKey, authHeaders, ensureValidToken,
} from './auth.js';

const PROFILE_CACHE_KEY = 'mb-profile';   // { profile, at } — offline grace
const OFFLINE_GRACE_MS = 7 * 864e5;       // offline iPad keeps working up to a week
const REFRESH_MS = 60_000;

let profile = null;
let fetchedAt = 0;

export function getProfile() { return profile; }

export function isAdmin() { return profile?.role === 'admin'; }

export function isActive() {
  if (!isSignedIn() || !profile) return false;
  if (profile.role === 'admin') return true;
  return !!(profile.active_until && Date.parse(profile.active_until) > Date.now());
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null'); } catch { return null; }
}

function writeCache() {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ profile, at: fetchedAt })); } catch { /* ok */ }
}

export function clearProfile() {
  profile = null;
  fetchedAt = 0;
  try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ok */ }
}

/** Load the caller's profiles row (RLS: own row only). Cached in memory + localStorage. */
export async function fetchProfile({ force = false } = {}) {
  if (!isSignedIn()) { profile = null; return null; }
  if (profile && !force && Date.now() - fetchedAt < REFRESH_MS) return profile;
  const base = getSupabaseUrl();
  const uid = getAuthUser()?.id;
  if (!base || !uid || !getSupabaseAnonKey()) return profile;
  try {
    await ensureValidToken();
    const res = await fetch(
      `${base}/rest/v1/profiles?select=role,full_name,phone,active_until&user_id=eq.${encodeURIComponent(uid)}`,
      { headers: authHeaders() },
    );
    if (!res.ok) throw new Error(`profiles HTTP ${res.status}`);
    const rows = await res.json();
    // Signed in but never registered by the teacher → role 'none', no access.
    profile = rows[0] || { role: 'none', full_name: '', phone: '', active_until: null };
    fetchedAt = Date.now();
    writeCache();
  } catch {
    const cached = readCache();
    if (cached?.profile && Date.now() - (cached.at || 0) < OFFLINE_GRACE_MS) {
      profile = cached.profile;
      fetchedAt = cached.at;
    }
  }
  return profile;
}

// ---- legacy feature gates (kept for call-site compatibility; always true) ----

/** @deprecated the gate blocks inactive users before these matter. */
export function hasPro() { return true; }

export function getPlan() { return 'full'; }

export function canCreateLesson() { return true; }

export function canUseCloudSync() { return true; }

export function canOpenCourseExample() { return true; }

export function initEntitlement() {
  /* profile is loaded by gate.js (ensureAccess) before the app boots */
}
