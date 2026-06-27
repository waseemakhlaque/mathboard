// Supabase Edge Function — REST API matching js/share.js remote provider.
// Deploy: supabase functions deploy mathboard
// App sync base URL: https://<project>.supabase.co/functions/v1/mathboard

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function err(msg: string, status = 400) {
  return json({ error: msg }, status);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return err('Server misconfigured.', 500);

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return err('Missing Authorization bearer token.', 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !user) return err('Invalid or expired session.', 401);

  const url = new URL(req.url);
  // Path after /functions/v1/mathboard → /notebooks or /notebooks/:id
  const prefix = '/mathboard';
  let path = url.pathname;
  if (path.startsWith(prefix)) path = path.slice(prefix.length) || '/';

  const listMatch = path === '/notebooks' || path === '/notebooks/';
  const itemMatch = path.match(/^\/notebooks\/([^/]+)$/);
  const id = itemMatch?.[1] ? decodeURIComponent(itemMatch[1]) : null;

  if (req.method === 'GET' && listMatch) {
    const { data, error } = await userClient
      .from('notebooks')
      .select('id, updated_at, json')
      .order('updated_at', { ascending: false });
    if (error) return err(error.message, 500);
    const out = (data || []).map((row) => ({
      id: row.id,
      updated: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
      title: row.json?.notebook?.title || row.json?.title || 'Untitled',
    }));
    return json(out);
  }

  if (req.method === 'GET' && id) {
    const { data, error } = await userClient.from('notebooks').select('json').eq('id', id).maybeSingle();
    if (error) return err(error.message, 500);
    if (!data) return err('Not found.', 404);
    return json(data.json);
  }

  if (req.method === 'PUT' && id) {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return err('Invalid JSON body.'); }
    const { error } = await userClient.from('notebooks').upsert({
      id,
      owner_id: user.id,
      json: body,
      updated_at: new Date().toISOString(),
    });
    if (error) return err(error.message, 500);
    return json({ ok: true });
  }

  if (req.method === 'DELETE' && id) {
    const { error } = await userClient.from('notebooks').delete().eq('id', id);
    if (error) return err(error.message, 500);
    return json({ ok: true });
  }

  return err('Not found.', 404);
});
