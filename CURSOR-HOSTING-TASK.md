# Cursor task — generate the production hosting files for MathBoard

Copy this whole file into Cursor as the task prompt.

You are working on **MathBoard**, a single static PWA (no build step) for teaching
A-level maths: vanilla ES-module JS + HTML5 Canvas, all libraries vendored locally
in `vendor/`. It deploys to **Cloudflare Workers** (`wrangler.jsonc` serves the repo
root as static assets; `worker/index.js` gates `/api/*` and `/content/*` behind
Supabase auth). A second Worker in `collab-worker/` runs Yjs collaboration on
Durable Objects. Auth/profiles live in Supabase.

**Your job:** generate/modify the technical files below so the app can go live on a
custom domain, on the $5/month Cloudflare Workers Paid plan, with health monitoring
and a Supabase free-tier keep-alive. The full plan is in `docs/HOSTING-ROADMAP.md`
— read it first.

**Run it locally:** `python3 -m http.server 5173` → `http://localhost:5173`.
**Cache-bust convention:** any edit to `js/app.js` or `css/app.css` requires bumping
the `?v=NN` query in `index.html` AND `const CACHE = 'mathboard-vNN'` in `sw.js` by
the same number.

**Hard rules (violating any of these fails the task):**
- Keep it offline-first and build-step-free. Do NOT add npm bundling, frameworks,
  or a build pipeline to the static app.
- Do NOT introduce CDN runtime dependencies — vendor any new library into `vendor/`.
- Never commit secrets. Secrets go in via `npx wrangler secret put NAME`, never into
  `wrangler.jsonc` `vars`, `config.js`, or any tracked file. `config.local.js` is
  gitignored and must stay that way.
- Do NOT touch the ink pipeline in `js/app.js` (snapshot-blit + Path2D cache) —
  pencil latency is the #1 acceptance criterion.
- Preserve the notebook JSON schema + migrations in `js/model.js`.
- Use the placeholder `MATHBOARD_DOMAIN` (e.g. `mathboard.example`) everywhere the
  real domain would appear, and list every such location in your final summary so
  the owner can find-and-replace once the domain is purchased.
- After each change, verify with DevTools console open — zero uncaught errors.

---

## TASK 1 — Custom-domain routing in `wrangler.jsonc`

Add to the root `wrangler.jsonc`:
- `"routes": [{ "pattern": "MATHBOARD_DOMAIN", "custom_domain": true }, { "pattern": "www.MATHBOARD_DOMAIN", "custom_domain": true }]`
- `"workers_dev": false` — but add it **commented out** with a note: enable only
  after the custom domain is confirmed working, otherwise the site goes dark.
- Add a scheduled trigger for Task 3: `"triggers": { "crons": ["0 3 * * 1,4"] }`
  (twice weekly, keeps free-tier Supabase from pausing).

Do the same custom-domain route in `collab-worker/wrangler.jsonc` with pattern
`collab.MATHBOARD_DOMAIN` (no cron there).

## TASK 2 — Health endpoint in `worker/index.js`

There is already a `GET /api/rag/health`. Add a lightweight `GET /api/health` that
returns `{ ok: true, version: <cache version> }` **without** touching Supabase, AI,
or Vectorize bindings (it must stay in the free CPU budget and never wake anything).
Read the version from a small constant near the top of the file with a comment
telling the maintainer to bump it alongside `sw.js`. This endpoint must be reachable
unauthenticated — check how `/api/*` gating works in `worker/index.js` and exempt it
explicitly.

## TASK 3 — Supabase keep-alive (`scheduled` handler in `worker/index.js`)

Add an `async scheduled(event, env, ctx)` export next to `fetch`. It performs one
cheap authenticated-anon request to Supabase (e.g. `GET {SUPABASE_URL}/rest/v1/`
with the `apikey` header from `env.SUPABASE_ANON_KEY`) and logs the status. Purpose:
free-tier Supabase projects pause after ~1 week of inactivity; this guarantees the
login flow never hits a paused database. Wrap in try/catch — a failed ping must
never throw.

## TASK 4 — Preflight script `scripts/go-live-check.mjs`

A Node script (plain `node`, no new dependencies) that exits non-zero with a clear
message if any check fails:
1. The `?v=NN` version on `js/app.js` and `css/app.css` in `index.html` matches the
   `mathboard-vNN` cache name in `sw.js`.
2. No obvious secret patterns (`service_role`, `sk_live`, `SUPABASE_JWT_SECRET=`,
   `INGEST_TOKEN=`) appear in tracked files (`git ls-files` + grep).
3. `config.local.js` is listed in `.gitignore` and not tracked by git.
4. `wrangler.jsonc` still contains the `run_worker_first` gating for `/api/*` and
   `/content/*` (protects the paid corpus).
5. Every file referenced by `sw.js`'s precache list exists on disk (skip this check
   gracefully if the list isn't statically parseable).
Print a ✅/❌ line per check. Then wire it into `scripts/deploy-mathboard.sh` as the
first step, aborting the deploy on failure (keep the rest of that script unchanged).

## TASK 5 — Domain setup guide `docs/DOMAIN-SETUP.md`

Write a short, non-technical, click-by-click guide for the owner:
1. Buying the domain in the Cloudflare dashboard (Domain Registration → Register,
   ~$11/yr at cost, WHOIS privacy included — no other portal needed).
2. Attaching it: Workers & Pages → mathboard → Settings → Domains & Routes → Add
   custom domain (apex + www), and `collab.MATHBOARD_DOMAIN` on mathboard-collab.
3. Replacing `MATHBOARD_DOMAIN` placeholders (list the exact files from Task 1 and
   the collab URL in `config.js` if one exists — verify first).
4. Setting secrets: `npx wrangler secret put SUPABASE_JWT_SECRET` and
   `npx wrangler secret put INGEST_TOKEN`.
5. Free uptime monitoring: create an UptimeRobot (free plan) HTTPS monitor on
   `https://MATHBOARD_DOMAIN/api/health`, 5-minute interval, email alert.
6. A "first deploy on the domain" checklist: run `scripts/go-live-check.mjs`,
   deploy, then on a phone: install the PWA, draw with a stylus, go offline and
   reopen, log in, open one past paper.

## Verify before finishing

- `node scripts/go-live-check.mjs` passes on the current tree.
- `npx wrangler deploy --dry-run` succeeds for both Workers (routes with a
  placeholder domain will not validate against a real zone — if the dry run rejects
  the placeholder, note it in the summary rather than removing the routes).
- `python3 -m http.server 5173` → app loads with zero console errors; `/api/health`
  is exempt from auth gating in the Worker code path (trace it by reading the code).
- Final summary must list: every file created/changed, every `MATHBOARD_DOMAIN`
  occurrence, and any check you could not run.
