// MathBoard RAG + Sim Resolver Worker.
// Routes (all under /api/, everything else falls through to static assets):
//   GET  /api/rag/health
//   POST /api/rag/query   {q, topK?, filter?}                  → {results:[{id,score,...metadata}]}
//   POST /api/rag/upsert  Bearer INGEST_TOKEN, {vectors:[...]} → {ok,upserted}
//   POST /api/sim/resolve {image: dataURL, hint?}              → {archetype, params, labels, confidence}

import { SIM_SCHEMA } from './simSchema.js';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const CHUNK_CHARS = 1500;
const FILTER_KEYS = ['course', 'topic', 'year', 'paper', 'kind'];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

async function embed(env, texts) {
  const res = await env.AI.run(EMBED_MODEL, { text: texts });
  return res.data; // number[768][]
}

async function handleQuery(env, body) {
  const q = String(body?.q ?? '').trim();
  if (!q) return json({ error: 'q required' }, 400);
  const topK = Math.min(Math.max(1, Number(body?.topK) || 10), 20);
  const filter = {};
  for (const k of FILTER_KEYS) {
    if (body?.filter?.[k] !== undefined) filter[k] = body.filter[k];
  }
  const [vec] = await embed(env, [q]);
  const out = await env.VECTORIZE.query(vec, {
    topK,
    returnMetadata: 'all',
    filter: Object.keys(filter).length ? filter : undefined,
  });
  return json({ results: out.matches.map((m) => ({ id: m.id, score: m.score, ...m.metadata })) });
}

async function handleUpsert(env, request, body) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.INGEST_TOKEN || auth !== `Bearer ${env.INGEST_TOKEN}`) return json({ error: 'unauthorized' }, 401);
  const rows = body?.vectors;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 50) return json({ error: 'vectors: 1-50 required' }, 400);
  const texts = rows.map((r) => String(r.text || '').slice(0, CHUNK_CHARS));
  const embs = await embed(env, texts);
  await env.VECTORIZE.upsert(rows.map((r, i) => ({
    id: String(r.id).slice(0, 64),
    values: embs[i],
    metadata: { ...r.metadata, text: texts[i] },
  })));
  return json({ ok: true, upserted: rows.length });
}

// Rate limiter: simple in-memory IP+bucket → count + timestamp.
const rateLimits = new Map();
function checkRateLimit(ip, bucket = 'default', max = 10) {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = rateLimits.get(key) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) return rateLimits.set(key, { count: 1, reset: now + 60000 }), true;
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

// ---- Supabase session verification -------------------------------------------
// Accepts the JWT from Authorization: Bearer or ?token= (new-tab PDF links).
// Fast path: HMAC-SHA256 verify with SUPABASE_JWT_SECRET (wrangler secret).
// Fallback: GET /auth/v1/user once per token, cached in-memory until expiry.
const sessionCache = new Map(); // token -> verified-until (ms)

function b64urlToBytes(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function jwtPayload(token) {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(token.split('.')[1])));
  } catch { return null; }
}

async function hmacVerify(secret, token) {
  const [head, body, sig] = token.split('.');
  if (!head || !body || !sig) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), new TextEncoder().encode(`${head}.${body}`));
}

async function verifySession(env, request, url) {
  let token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) token = url.searchParams.get('token') || '';
  if (!token || token.split('.').length !== 3) return false;

  const payload = jwtPayload(token);
  const expMs = (payload?.exp || 0) * 1000;
  if (!expMs || expMs < Date.now()) return false;
  if (payload.role !== 'authenticated') return false; // anon key is NOT a session

  const cached = sessionCache.get(token);
  if (cached && cached > Date.now()) return true;

  let ok = false;
  if (env.SUPABASE_JWT_SECRET) {
    ok = await hmacVerify(env.SUPABASE_JWT_SECRET, token);
  } else if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    ok = res.ok;
  }
  if (ok) {
    if (sessionCache.size > 500) sessionCache.clear();
    sessionCache.set(token, Math.min(expMs, Date.now() + 10 * 60000));
  }
  return ok;
}

// Gated static content (past papers / books) — copyrighted, session required.
async function handleContent(env, request, url) {
  if (request.method !== 'GET') return json({ error: 'GET only' }, 405);
  // The Course Library taxonomy is app data, not copyrighted content.
  if (url.pathname === '/content/catalog.json') return env.ASSETS.fetch(request);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip, 'content', 120)) return json({ error: 'rate limited' }, 429);
  if (!(await verifySession(env, request, url))) return json({ error: 'sign in required' }, 401);

  // Strip the token before hitting the asset layer.
  const assetUrl = new URL(url.origin + url.pathname);
  const res = await env.ASSETS.fetch(new Request(assetUrl, { method: 'GET' }));
  if (!res.ok) return res;
  const h = new Headers(res.headers);
  h.set('Cache-Control', 'private, max-age=3600');
  h.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(res.body, { status: res.status, headers: h });
}

async function handleSimResolve(env, request, body) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip)) return json({ error: 'rate limited' }, 429);

  const imageData = body?.image;
  if (!imageData || typeof imageData !== 'string') return json({ error: 'image required' }, 400);
  if (imageData.length > 1.5 * 1024 * 1024) return json({ error: 'image too large' }, 413);

  const hint = String(body?.hint || '').slice(0, 100);
  const archList = SIM_SCHEMA.map((s) => `${s.tag}: ${s.description}`).join('\n');
  const prompt = `Classify this A-level mathematics diagram into exactly one archetype and extract every labelled value (masses kg, angles °, coefficients, equations, speeds m/s, etc.).
Archetypes:
${archList}

${hint ? `Hint (topic): ${hint}` : ''}

Reply with ONLY minified JSON: {"archetype":"mb-tag-name","params":{key:value,...},"labels":["text1","text2",...],"confidence":0.0-1.0}`;

  try {
    const res = await env.AI.run(VISION_MODEL, {
      image: [{ url: imageData }],
      prompt,
      max_tokens: 512,
    });

    const text = res.response || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON in vision response:', text.slice(0, 200));
      return json({ archetype: null, confidence: 0 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const archetype = String(parsed.archetype || '');
    const scheme = SIM_SCHEMA.find((s) => s.tag === archetype);
    if (!scheme) {
      console.warn('Unknown archetype:', archetype);
      return json({ archetype: null, confidence: 0 });
    }

    // Clamp extracted params to schema bounds.
    const params = {};
    for (const [k, spec] of Object.entries(scheme.paramSchema)) {
      let v = parsed.params?.[k] ?? spec.default;
      if (spec.type === 'number') {
        v = Number(v);
        if (Number.isNaN(v)) v = spec.default;
        params[k] = Math.min(spec.max, Math.max(spec.min, v));
      } else params[k] = v;
    }

    const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));
    return json({ archetype, params, labels: parsed.labels || [], confidence });
  } catch (err) {
    console.error('Vision error:', err.message);
    return json({ archetype: null, confidence: 0 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/content/')) return handleContent(env, request, url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/rag/health') return json({ ok: true });
    if (url.pathname === '/api/rag/query' && request.method === 'POST') {
      // Corpus chunks contain copyrighted paper text — session required.
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      if (!checkRateLimit(ip, 'query', 30)) return json({ error: 'rate limited' }, 429);
      if (!(await verifySession(env, request, url))) return json({ error: 'sign in required' }, 401);
      return handleQuery(env, await request.json());
    }
    if (url.pathname === '/api/rag/upsert' && request.method === 'POST') {
      return handleUpsert(env, request, await request.json());
    }
    if (url.pathname === '/api/sim/resolve' && request.method === 'POST') {
      if (!(await verifySession(env, request, url))) return json({ error: 'sign in required' }, 401);
      return handleSimResolve(env, request, await request.json().catch(() => ({})));
    }
    return json({ error: 'not found' }, 404);
  },
};
