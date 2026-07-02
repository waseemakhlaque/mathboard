// MathBoard RAG Worker — retrieval-only search over the Cambridge 9709 corpus.
// Routes (all under /api/, everything else falls through to static assets):
//   GET  /api/rag/health
//   POST /api/rag/query   {q, topK?, filter?}                  → {results:[{id,score,...metadata}]}
//   POST /api/rag/upsert  Bearer INGEST_TOKEN, {vectors:[...]} → {ok,upserted}

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/rag/health') return json({ ok: true });
    if (url.pathname === '/api/rag/query' && request.method === 'POST') {
      return handleQuery(env, await request.json());
    }
    if (url.pathname === '/api/rag/upsert' && request.method === 'POST') {
      return handleUpsert(env, request, await request.json());
    }
    return json({ error: 'not found' }, 404);
  },
};
