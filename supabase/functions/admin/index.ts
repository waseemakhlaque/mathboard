// Admin user management — callable only by a signed-in profiles.role='admin'.
// Deploy: supabase functions deploy admin
// POST { action, ...fields } with the caller's Supabase JWT as Bearer token.
// Actions:
//   create-user  { email, password, full_name?, phone?, months? } → { ok, user_id }
//   list-users   {}                                               → { users: [...] }
//   set-expiry   { user_id, active_until }  (ISO timestamp)       → { ok }
//   deactivate   { user_id }                                      → { ok }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const err = (msg: string, status = 400) => json({ error: msg }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return err('POST only.', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return err('Server misconfigured.', 500);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return err('Missing Authorization bearer token.', 401);

  // Service-role client: verifies the caller, then acts with admin powers.
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return err('Invalid or expired session.', 401);

  const { data: callerProfile } = await admin
    .from('profiles').select('role').eq('user_id', user.id).maybeSingle();
  if (callerProfile?.role !== 'admin') return err('Admin access required.', 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err('Invalid JSON body.'); }

  const action = String(body.action || '');

  if (action === 'create-user') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Valid email required.');
    if (password.length < 6) return err('Password must be at least 6 characters.');
    const months = Math.max(0, Math.min(36, Number(body.months) || 0));
    const activeUntil = months > 0
      ? new Date(Date.now() + months * 30 * 86400000).toISOString()
      : null;

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr) return err(createErr.message, 400);

    const { error: profErr } = await admin.from('profiles').upsert({
      user_id: created.user.id,
      role: 'student',
      full_name: String(body.full_name || '').slice(0, 120),
      phone: String(body.phone || '').slice(0, 40),
      active_until: activeUntil,
    });
    if (profErr) return err(profErr.message, 500);
    return json({ ok: true, user_id: created.user.id, active_until: activeUntil });
  }

  if (action === 'list-users') {
    const { data: page, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
    if (listErr) return err(listErr.message, 500);
    const { data: profiles, error: profErr } = await admin
      .from('profiles').select('user_id, role, full_name, phone, active_until, notes, created_at');
    if (profErr) return err(profErr.message, 500);
    const byId = new Map((profiles || []).map((p) => [p.user_id, p]));
    const users = page.users.map((u) => {
      const p = byId.get(u.id);
      return {
        user_id: u.id,
        email: u.email,
        last_sign_in_at: u.last_sign_in_at,
        role: p?.role || null,
        full_name: p?.full_name || '',
        phone: p?.phone || '',
        active_until: p?.active_until || null,
        notes: p?.notes || '',
      };
    });
    return json({ users });
  }

  // Upsert (not update): legacy auth users may have no profiles row yet.
  if (action === 'set-expiry') {
    const userId = String(body.user_id || '');
    const activeUntil = String(body.active_until || '');
    if (!userId || Number.isNaN(Date.parse(activeUntil))) return err('user_id and valid active_until required.');
    const { error: upErr } = await admin.from('profiles')
      .upsert({ user_id: userId, active_until: new Date(activeUntil).toISOString() }, { onConflict: 'user_id' });
    if (upErr) return err(upErr.message, 500);
    return json({ ok: true });
  }

  if (action === 'deactivate') {
    const userId = String(body.user_id || '');
    if (!userId) return err('user_id required.');
    const { error: upErr } = await admin.from('profiles')
      .upsert({ user_id: userId, active_until: new Date().toISOString() }, { onConflict: 'user_id' });
    if (upErr) return err(upErr.message, 500);
    return json({ ok: true });
  }

  return err(`Unknown action: ${action}`);
});
