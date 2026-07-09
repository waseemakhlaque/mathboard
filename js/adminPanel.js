// adminPanel.js — teacher-only student management (register / extend / deactivate).
// Talks to the Supabase edge function `admin` (service-role key stays server-side).
// No payment fields — payments are recorded outside the app for now; a future
// gateway only needs to extend profiles.active_until (docs/PAYMENTS-LATER.md).

import { getSupabaseUrl, authHeaders, ensureValidToken } from './auth.js';
import { isAdmin } from './entitlement.js';

const MONTH_MS = 30 * 86400000; // "1 month" = 30 days, same rule as the server

const STYLE = `
#admin-dialog .sync-box { max-width: 720px; width: min(720px, 94vw); max-height: 86vh; overflow: auto; }
#admin-dialog table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
#admin-dialog th, #admin-dialog td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(128,128,128,.25); }
#admin-dialog td.adm-expired { color: #d23b3b; font-weight: 600; }
#admin-dialog td.adm-active { color: #1f9d57; font-weight: 600; }
#admin-dialog .adm-row-btns { display: flex; gap: 4px; flex-wrap: wrap; }
#admin-dialog .adm-row-btns button { font-size: 12px; padding: 3px 8px; }
#admin-dialog form.adm-new { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
#admin-dialog form.adm-new .adm-full { grid-column: 1 / -1; }
#admin-dialog form.adm-new input, #admin-dialog form.adm-new select { width: 100%; box-sizing: border-box; }
#admin-dialog .adm-msg { font-size: 13px; min-height: 18px; margin-top: 8px; }
#admin-dialog .adm-msg.err { color: #d23b3b; }
#admin-dialog .adm-msg.ok { color: #1f9d57; }
#admin-dialog h3 { margin: 18px 0 4px; font-size: 14px; }
`;

async function api(action, fields = {}) {
  await ensureValidToken();
  const res = await fetch(`${getSupabaseUrl()}/functions/v1/admin`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action, ...fields }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function ensureDialog() {
  let dlg = document.getElementById('admin-dialog');
  if (dlg) return dlg;
  const st = document.createElement('style');
  st.textContent = STYLE;
  document.head.appendChild(st);
  dlg = document.createElement('div');
  dlg.id = 'admin-dialog';
  dlg.className = 'sync-dialog hidden';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.innerHTML = `
    <div class="sync-box">
      <h2>Students</h2>
      <p class="muted" style="font-size:13px">Register a student, then share the email + password with them.
        Access runs for the months you choose (1 month = 30 days). Extend or stop it any time.</p>
      <h3>Register new student</h3>
      <form class="adm-new">
        <input class="ct-in" id="adm-name" placeholder="Full name" autocomplete="off" />
        <input class="ct-in" id="adm-phone" placeholder="Phone (03xx…)" autocomplete="off" />
        <input class="ct-in" id="adm-email" type="email" placeholder="Email (their login)" autocomplete="off" required />
        <input class="ct-in" id="adm-pass" placeholder="Temp password (min 6)" autocomplete="off" required />
        <select class="ct-in" id="adm-months">
          <option value="1">1 month access</option>
          <option value="3" selected>3 months access</option>
          <option value="6">6 months access</option>
          <option value="12">12 months access</option>
        </select>
        <button type="submit" class="primary" id="adm-create">Register</button>
      </form>
      <div class="adm-msg" id="adm-msg"></div>
      <h3>All accounts</h3>
      <div id="adm-list"><p class="muted">Loading…</p></div>
      <div class="sync-btns"><button type="button" class="ghost" id="adm-close">Close</button></div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.classList.add('hidden'); });
  dlg.querySelector('#adm-close').addEventListener('click', () => dlg.classList.add('hidden'));

  dlg.querySelector('form.adm-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = dlg.querySelector('#adm-msg');
    const btn = dlg.querySelector('#adm-create');
    msg.className = 'adm-msg';
    msg.textContent = '';
    btn.disabled = true;
    try {
      const r = await api('create-user', {
        full_name: dlg.querySelector('#adm-name').value.trim(),
        phone: dlg.querySelector('#adm-phone').value.trim(),
        email: dlg.querySelector('#adm-email').value.trim(),
        password: dlg.querySelector('#adm-pass').value,
        months: Number(dlg.querySelector('#adm-months').value),
      });
      msg.className = 'adm-msg ok';
      msg.textContent = `Registered — access until ${fmtDate(r.active_until)}. Share the email + password with the student.`;
      e.target.reset();
      renderUsers(dlg);
    } catch (err) {
      msg.className = 'adm-msg err';
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
  return dlg;
}

async function renderUsers(dlg) {
  const list = dlg.querySelector('#adm-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  let users;
  try {
    ({ users } = await api('list-users'));
  } catch (err) {
    list.innerHTML = `<p class="adm-msg err">Could not load users: ${esc(err.message)}</p>`;
    return;
  }
  const rows = users.map((u) => {
    const active = u.role === 'admin' || (u.active_until && Date.parse(u.active_until) > Date.now());
    const until = u.role === 'admin' ? 'Teacher (admin)' : fmtDate(u.active_until);
    const cls = u.role === 'admin' || active ? 'adm-active' : 'adm-expired';
    const btns = u.role === 'admin' ? '' : `
      <div class="adm-row-btns">
        <button type="button" data-act="extend" data-id="${u.user_id}" data-months="1">+1 mo</button>
        <button type="button" data-act="extend" data-id="${u.user_id}" data-months="3">+3 mo</button>
        <button type="button" class="ghost" data-act="stop" data-id="${u.user_id}">Stop</button>
      </div>`;
    return `<tr data-until="${u.active_until || ''}">
      <td>${esc(u.full_name) || '<span class="muted">—</span>'}</td>
      <td>${esc(u.email)}</td>
      <td>${esc(u.phone)}</td>
      <td class="${cls}">${until}</td>
      <td>${btns}</td></tr>`;
  }).join('');
  list.innerHTML = `<table>
    <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Access until</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;

  list.querySelectorAll('button[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.dataset.id;
      const msg = dlg.querySelector('#adm-msg');
      msg.className = 'adm-msg';
      msg.textContent = 'Working…';
      try {
        if (b.dataset.act === 'stop') {
          await api('deactivate', { user_id: id });
        } else {
          const row = b.closest('tr');
          const current = Date.parse(row?.dataset.until || '') || 0;
          const base = Math.max(Date.now(), current);
          await api('set-expiry', {
            user_id: id,
            active_until: new Date(base + Number(b.dataset.months) * MONTH_MS).toISOString(),
          });
        }
        msg.className = 'adm-msg ok';
        msg.textContent = 'Updated.';
        renderUsers(dlg);
      } catch (err) {
        msg.className = 'adm-msg err';
        msg.textContent = err.message;
      }
    });
  });
}

/** Adds the "Students" button to the library header — admin accounts only. */
export function setupAdminPanel() {
  if (!isAdmin()) return;
  const util = document.querySelector('.lib-actions .lib-util');
  if (!util || document.getElementById('admin-open')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'admin-open';
  btn.className = 'ghost';
  btn.title = 'Manage student accounts';
  btn.textContent = 'Students';
  btn.addEventListener('click', () => {
    const dlg = ensureDialog();
    dlg.classList.remove('hidden');
    renderUsers(dlg);
  });
  util.appendChild(btn);
}
