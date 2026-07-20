// users.js — local (device) multi-user roles + permission helpers.
// Separate from Supabase cloud auth (auth.js / entitlement.js). Offline-first;
// persists in localStorage. Corrupt data skip-and-continue, never throw on read.

export const ROLES = {
  OWNER: 'owner',       // Full access (Waseem)
  TEACHER: 'teacher',   // Can create/edit lessons, manage students
  STUDENT: 'student',   // View, draw, export — NOT edit/create lessons
  VIEWER: 'viewer',     // View and navigate only
};

const USERS_KEY = 'mb-local-users';
const CURRENT_KEY = 'mb-local-user-id';

const ROLE_RANK = {
  [ROLES.VIEWER]: 1,
  [ROLES.STUDENT]: 2,
  [ROLES.TEACHER]: 3,
  [ROLES.OWNER]: 4,
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function isRole(r) {
  return Object.values(ROLES).includes(r);
}

function normalizeUser(u) {
  if (!u || typeof u !== 'object') return null;
  const id = typeof u.id === 'string' && u.id ? u.id : null;
  if (!id) return null;
  const role = isRole(u.role) ? u.role : ROLES.VIEWER;
  return {
    id,
    name: String(u.name || '').trim() || 'User',
    email: String(u.email || '').trim().toLowerCase(),
    role,
    active: u.active !== false,
    created: Number(u.created) || Date.now(),
    updated: Number(u.updated) || Number(u.created) || Date.now(),
  };
}

function readUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizeUser).filter(Boolean);
  } catch {
    return [];
  }
}

function writeUsers(list) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  } catch { /* quota / private mode — ignore */ }
}

/** Seed a default owner once so a fresh device always has a full-access user. */
export function ensureDefaultOwner() {
  const list = readUsers();
  if (list.some((u) => u.role === ROLES.OWNER)) return list;
  const owner = normalizeUser({
    id: uid(),
    name: 'Waseem',
    email: 'waseemakhlaque85@gmail.com',
    role: ROLES.OWNER,
    active: true,
    created: Date.now(),
  });
  const next = [...list, owner];
  writeUsers(next);
  if (!getCurrentUserId()) setCurrentUserId(owner.id);
  return next;
}

export function listUsers() {
  return ensureDefaultOwner().slice();
}

export function getUser(id) {
  if (!id) return null;
  return listUsers().find((u) => u.id === id) || null;
}

export function getCurrentUserId() {
  try { return localStorage.getItem(CURRENT_KEY) || ''; } catch { return ''; }
}

export function setCurrentUserId(id) {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch { /* ok */ }
}

export function getCurrentUser() {
  const list = ensureDefaultOwner();
  const id = getCurrentUserId();
  const cur = id ? list.find((u) => u.id === id && u.active) : null;
  if (cur) return cur;
  // Fall back to first active owner, then any active user.
  const owner = list.find((u) => u.role === ROLES.OWNER && u.active);
  const any = list.find((u) => u.active);
  const pick = owner || any || null;
  if (pick && pick.id !== id) setCurrentUserId(pick.id);
  return pick;
}

export function clearCurrentUser() {
  setCurrentUserId('');
}

export function getRole() {
  return getCurrentUser()?.role || ROLES.VIEWER;
}

export function hasMinRole(minRole) {
  const need = ROLE_RANK[minRole] || 0;
  const have = ROLE_RANK[getRole()] || 0;
  return have >= need;
}

export function hasRole(...roles) {
  const r = getRole();
  return roles.includes(r);
}

// ---- permission helpers (from role comments) --------------------------------

/** Create / rename / delete / restructure lessons & sections. */
export function canEditLessons() {
  return hasRole(ROLES.OWNER, ROLES.TEACHER);
}

/** Alias for call-sites that mirror entitlement.canCreateLesson naming. */
export function canCreateLesson() {
  return canEditLessons();
}

/** Register / edit / deactivate students (not promote to owner). */
export function canManageStudents() {
  return hasRole(ROLES.OWNER, ROLES.TEACHER);
}

/** Change roles, delete teachers, full user admin. */
export function canManageUsers() {
  return hasRole(ROLES.OWNER);
}

/** Ink / draw on the page (students practice; viewers cannot). */
export function canDraw() {
  return hasRole(ROLES.OWNER, ROLES.TEACHER, ROLES.STUDENT);
}

/** Export PDF / JSON / share files. */
export function canExport() {
  return hasRole(ROLES.OWNER, ROLES.TEACHER, ROLES.STUDENT);
}

/** Open lessons and navigate pages (everyone with a local account). */
export function canView() {
  return !!getCurrentUser()?.active;
}

/** True when the user must not mutate lesson structure. */
export function isReadOnlyLessons() {
  return !canEditLessons();
}

/** True when the user cannot draw (viewer). */
export function isViewOnly() {
  return hasRole(ROLES.VIEWER);
}

// ---- CRUD (guards: only owner/teacher may mutate; owner-only for elevating) -

function assertCanManage(targetRole) {
  const me = getCurrentUser();
  if (!me?.active) throw new Error('Not signed in locally.');
  if (me.role === ROLES.OWNER) return me;
  if (me.role === ROLES.TEACHER) {
    if (targetRole === ROLES.OWNER || targetRole === ROLES.TEACHER) {
      throw new Error('Teachers can only manage student/viewer accounts.');
    }
    return me;
  }
  throw new Error('Only owners and teachers can manage users.');
}

/**
 * @param {{ name: string, email?: string, role?: string }} fields
 * @returns {object} created user
 */
export function addUser(fields = {}) {
  const role = isRole(fields.role) ? fields.role : ROLES.STUDENT;
  assertCanManage(role);
  if (role === ROLES.OWNER && getRole() !== ROLES.OWNER) {
    throw new Error('Only the owner can create another owner.');
  }
  const list = listUsers();
  const email = String(fields.email || '').trim().toLowerCase();
  if (email && list.some((u) => u.email && u.email === email)) {
    throw new Error('A user with that email already exists.');
  }
  const user = normalizeUser({
    id: uid(),
    name: fields.name,
    email,
    role,
    active: true,
    created: Date.now(),
  });
  writeUsers([...list, user]);
  return user;
}

/**
 * @param {string} id
 * @param {{ name?: string, email?: string, role?: string, active?: boolean }} patch
 */
export function updateUser(id, patch = {}) {
  const list = listUsers();
  const idx = list.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error('User not found.');
  const prev = list[idx];
  const nextRole = patch.role !== undefined
    ? (isRole(patch.role) ? patch.role : prev.role)
    : prev.role;
  assertCanManage(prev.role);
  assertCanManage(nextRole);
  if (prev.role === ROLES.OWNER && getRole() !== ROLES.OWNER) {
    throw new Error('Cannot modify the owner account.');
  }
  if (nextRole === ROLES.OWNER && getRole() !== ROLES.OWNER) {
    throw new Error('Only the owner can grant owner role.');
  }
  // Never leave the device with zero owners.
  if (prev.role === ROLES.OWNER && nextRole !== ROLES.OWNER) {
    const owners = list.filter((u) => u.role === ROLES.OWNER && u.id !== id);
    if (!owners.length) throw new Error('Cannot demote the only owner.');
  }
  if (prev.role === ROLES.OWNER && patch.active === false) {
    const owners = list.filter((u) => u.role === ROLES.OWNER && u.active && u.id !== id);
    if (!owners.length) throw new Error('Cannot deactivate the only active owner.');
  }
  const email = patch.email !== undefined
    ? String(patch.email || '').trim().toLowerCase()
    : prev.email;
  if (email && list.some((u) => u.id !== id && u.email === email)) {
    throw new Error('A user with that email already exists.');
  }
  const updated = normalizeUser({
    ...prev,
    name: patch.name !== undefined ? patch.name : prev.name,
    email,
    role: nextRole,
    active: patch.active !== undefined ? !!patch.active : prev.active,
    updated: Date.now(),
  });
  const next = list.slice();
  next[idx] = updated;
  writeUsers(next);
  return updated;
}

export function removeUser(id) {
  const list = listUsers();
  const target = list.find((u) => u.id === id);
  if (!target) throw new Error('User not found.');
  assertCanManage(target.role);
  if (target.role === ROLES.OWNER) {
    if (getRole() !== ROLES.OWNER) throw new Error('Cannot remove the owner.');
    const owners = list.filter((u) => u.role === ROLES.OWNER && u.id !== id);
    if (!owners.length) throw new Error('Cannot remove the only owner.');
  }
  writeUsers(list.filter((u) => u.id !== id));
  if (getCurrentUserId() === id) {
    setCurrentUserId('');
    getCurrentUser(); // re-pick fallback
  }
}

/** Switch the active local user (any known active account). */
export function switchUser(id) {
  const u = getUser(id);
  if (!u || !u.active) throw new Error('User not found or inactive.');
  setCurrentUserId(u.id);
  return u;
}

/** Snapshot for UI / debugging — never includes secrets (there are none). */
export function usersDebugInfo() {
  const cur = getCurrentUser();
  return {
    currentId: cur?.id || null,
    currentRole: cur?.role || null,
    count: listUsers().length,
    canEditLessons: canEditLessons(),
    canManageStudents: canManageStudents(),
    canDraw: canDraw(),
    canExport: canExport(),
  };
}
