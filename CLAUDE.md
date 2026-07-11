# MathBoard — Project Guide for AI Assistants

> **Read this whole file before touching code.** It is the distilled knowledge of every
> debugging/launch session to date (through v123, 2026-07-12). The architecture is settled —
> do NOT propose rewrites, frameworks, or new backends. Extend what exists.

## What this is

A **pencil-first notebook whiteboard PWA** for teaching A-level (CIE 9709) mathematics, built
and used daily by Waseem Akhlaque (teacher, non-programmer — he tests on a real iPad and
reports bugs in plain language; he cannot use the terminal, so you deploy for him when asked).

- **Live:** https://waseemonline.com (+ www, + mathboard.waseemonline.workers.dev)
- **Repo:** this directory (`mathboard-fresh`) is the ONLY real repo; GitHub `waseemakhlaque/mathboard`
- **Launched** 2026-07-11 (v121). Login-gated, no self-signup, no payments (postponed ~Oct/Nov 2026).

## Architecture mindmap

```
MathBoard (vanilla JS PWA — NO build step, NO frameworks, NO TypeScript, all libs vendored)
│
├── FRONTEND (static, served as Cloudflare Worker assets from repo root)
│   ├── index.html            single page; loads everything with ?v=N cache-busting
│   ├── css/app.css           (+ annotatedSim.css)
│   ├── sw.js                 PWA cache `mathboard-vN`; DISABLED on localhost; bypasses /content/*
│   ├── config.js             Supabase URL + anon key (public); config.local.js (gitignored)
│   │                         with supabaseUrl:'' disables the login gate for local QA
│   ├── vendor/               mathlive, jsxgraph, katex, mathjs, pdf.js, jspdf,
│   │                         perfect-freehand, yjs, supabase-js … NEVER load from CDN
│   └── js/
│       ├── app.js (~6000 ln) boot/init, global state `S`, single-rAF render loop,
│       │                     pointer + INK HOT PATH (see constraints), objects
│       │                     (equations/text/images, drawObject by o.kind), calculator,
│       │                     toolbar binding, present mode, undo/redo
│       ├── model.js          notebook schema, normalizeNotebook/normalizePage,
│       │                     sanitizeGeoItems (cleans corrupt geo on load)
│       ├── storage.js        IndexedDB db "mathboard": notebooks + blobs stores
│       ├── geo.js            JSXGraph board in #geo-layer; dumpGeoItems/rebuildGeo/loadGeoPage
│       ├── instruments.js    ruler/protractor/compass widgets (v122+ OpenBoard-style:
│       │                     one per kind per page, {x,y,length/radius,rotation} schema,
│       │                     drag/rotate/resize handles, compass commits ink arcs)
│       ├── pdfPages.js       lazy PDF page backgrounds + Safari blob-eviction self-heal
│       ├── pageLayout.js     A4 page = 1000×1414 page units, UNIT=50
│       ├── gate.js           login gate — runs FIRST in app.js init()
│       ├── auth.js           Supabase auth, authHeaders(), password reset flows
│       ├── entitlement.js    profile fetch, 7-day offline grace (localStorage)
│       ├── adminPanel.js     "Students" panel → supabase/functions/admin edge function
│       ├── ragSearch.js      AI search dialog + tool launchers
│       ├── anim/             MbAnim timeline players + MbLab drag labs
│       │                     (mb-incline-lab, mb-pulley-lab, mb-suvat-lab);
│       │                     topic→tool map in anim/ragRoutes.js — extend HERE for new tools
│       ├── papersLibrary.js / courseLibrary.js   past-paper & book browsers (gated /content/*)
│       ├── scene.js, layers.js, mech.js, cplx.js, calculus.js, graphView.js,
│       │   share.js, theme.js, onboarding.js, fullscreen.js …
│       └── collab/ + annotationSync.js           yjs live-collab (collab-worker)
│
├── BACKEND (Cloudflare)
│   ├── worker/index.js       THE worker (wrangler.jsonc, name "mathboard")
│   │   ├── serves repo root as assets (.assetsignore excludes source/docs/*.md)
│   │   ├── run_worker_first: ["/api/*", "/content/*"]
│   │   ├── JWT-gates /content/* (papers/books; Supabase token via Authorization or ?token=)
│   │   │   … /content/catalog.json stays public (taxonomy only)
│   │   └── /api/rag/query|upsert|health → Workers AI embeddings
│   │       (@cf/baai/bge-base-en-v1.5, 768-dim) + Vectorize index "mathboard-rag"
│   ├── collab-worker/        separate worker → collab.waseemonline.com (yjs relay)
│   └── content/ (gitignored, deployed as assets)
│       ├── papers/  1,558 canonical 9709 PDFs
│       ├── books/   5 CIE coursebooks + formulae list (ghostscript-compressed <24MiB each —
│       │            Workers asset size limit; R2 NOT enabled on this account, error 10042)
│       └── rebuilt by scripts/collect-content.mjs from ~/Documents/BSS/AS & A level Mathematics/
│
├── AUTH/DB (Supabase project mjiuhdcxdllurizffvik — FREE tier, auto-pauses after ~1wk idle!)
│   ├── public.profiles       access = signed-in AND (role='admin' OR active_until > now())
│   ├── RLS: own-row select; admin writes via security-definer is_admin()
│   ├── admins: asmamemon85@gmail.com, waseemakhlaque85@gmail.com (same owner)
│   ├── edge function supabase/functions/admin (service-role; teacher registers students)
│   └── restore when paused: POST https://api.supabase.com/v1/projects/mjiuhdcxdllurizffvik/restore
│       (token: `security find-generic-password -s "Supabase CLI" -w`)
│
├── RAG PIPELINE (ingestion is LOCAL, not in-worker)
│   ├── scripts/rag-ingest.mjs  (papers by 9709 filename; --books for textbooks;
│   │                            deterministic keyword topic-tagging via content/catalog.json)
│   ├── Workers AI FREE tier = 10,000 neurons/day — exhausting it kills LIVE SEARCH too
│   │   (rolling ~24h window, ~19k chunks ≈ 10k neurons). Paid plan ($5/mo) recommended.
│   └── PENDING: corpus still holds embeddings of REMOVED old books; re-ingest for new coursebooks
│
└── DOCS  docs/ (ASSESSMENT, LAUNCH, SUPABASE-SETUP, PAYMENTS-LATER, RAG-INGEST, SIM-ARCHITECTURE…)
          CLINE-QA-REMAINING.md = current bug/QA task list with acceptance criteria
```

## HARD CONSTRAINTS — never break

1. **Vanilla only.** Plain ES modules + Canvas 2D + CSS. No React/Vue/Svelte, no TypeScript,
   no bundler, no new runtime npm deps, no CDN scripts. Must run under `python3 -m http.server`.
2. **Do NOT touch the pencil-ink hot path** in js/app.js unless the task is explicitly about it.
   Pen latency is the #1 acceptance criterion (GoodNotes is the bar; verified ~8ms pen-to-paint):
   - `onDown`/`onMove`, `pointerrawupdate`, coalesced/predicted events, `appendInkPoints`,
     `drawStrokePreview`, ink snapshot blit (`inkSnapCanvas`).
   - `mark()` invalidates the ink snapshot; `markInk()` does not — ink events MUST use `markInk()`.
   - **Never reintroduce `beginAction()` (full JSON `snapshotPage()` clone) into the ink/erase
     path** — pen strokes use typed undo `{kind:'stroke',id}`, erases `{kind:'arrays',…}`.
   - `HAS_RAW_UPDATE` gates onMove so rawupdate+pointermove never BOTH feed `processDrawMove`
     (double-feeding degrades perfect-freehand outlines).
   - `persist()` is idle-deferred (800ms debounce, flush on visibilitychange) — keep it that way.
3. **All other mutating gestures** wrap in `beginAction()`/`commitAction()` for undo/redo.
4. **Corrupt data must skip-and-continue, never throw.** `objGeomOk` guards draw/hit/bbox;
   `sanitizeGeoItems` cleans on load; error banner (`surfaceUnexpectedError` → `#boot-error`)
   includes top stack frame `(file:line)` — keep that, it's how field bugs get located.
5. **Version-bump protocol** — on EVERY shipped frontend change, bump ALL FOUR together:
   `APP_VERSION` in js/app.js · `?v=N` in index.html (app.css, annotatedSim.css, app.js ×3 +
   footer `vN`) · `const CACHE = 'mathboard-vN'` in sw.js. They have drifted before; check all.
6. **Never expose /content/* without the JWT check**; new gated fetches send `authHeaders()`.
7. Never commit `config.local.js`. Match existing style: small helpers, terse "why" comments,
   `const`-first.

## Coordinate / object model

- Page units: A4 `1000×1414`, `UNIT=50`. Camera `{scale, offsetX, offsetY}`; `toPage()`
  screen→page; `snapPt()` on grid papers.
- Document: `notebook.sections[].pages[]`; each page: `strokes[]`, `objects[]`, `geoItems[]`,
  `instruments[]`, `functions[]`…  Persisted in IndexedDB db **`mathboard`**, store `notebooks`.
- Render: single `requestAnimationFrame(render)` + dirty flag `S.dirty` via `mark()`/`markInk()`.
- Geometry: JSXGraph. `boardPageId` must equal the page id before `dumpGeoItems()` (v120 —
  prevents cross-page contamination). Perp/parallel persist parent ids as strings + line ids.

## Deploy & operate

- **Deploy:** `npx wrangler deploy` from repo root (owner can't — do it when he asks).
  `scripts/deploy-mathboard.sh` exists and **auto-stashes uncommitted work** — if a deploy is
  running, wait for it to exit before touching the tree.
- **Verify live after deploy:** `curl -s https://waseemonline.com | grep -o '?v=[0-9]*'` and
  spot-check the served JS actually contains the fix.
- **Content-only swaps** (content/papers, content/books) need NO version bump — sw.js bypasses
  /content/*. Use the stash-around-deploy pattern if the tree is dirty.
- **Multiple AI sessions/tools work this repo concurrently** (Claude, Cursor, Cline). ALWAYS
  check `git log` + `git status` first; never sweep foreign uncommitted work into your commit.
- Collab worker deploys separately: `scripts/deploy-collab-worker.sh` → collab.waseemonline.com.

## Local dev & QA (the workflow that actually finds the bugs)

1. `python3 -m http.server 5231` in repo root → http://127.0.0.1:5231 (SW disabled on localhost).
2. Gate bypass: gitignored `config.local.js` with `supabaseUrl:''` disables login locally
   (alternative used before: `mv config.js config.js.mb-test-bak`, restore after).
3. **iPad bugs usually do NOT reproduce in desktop Chrome.** Use Playwright WebKit with
   `devices['iPad Pro 11 landscape']` — this reproduced the clipped Delete button, instrument
   gate bug, etc. Playwright needs `launchPersistentContext` (ephemeral contexts can't put
   Blobs in IndexedDB) and `_headers` `upgrade-insecure-requests` stripped locally (restore
   before deploy).
4. Inspect persistence directly: DevTools → IndexedDB `mathboard` → `notebooks` →
   `pages[].geoItems / instruments / objects`.
5. Latency triage: `?perf=1` HUD and `/inktest.html`. "deliver" metric = system share,
   "down→ink" = app share. (Historical: residual iPad lag was iPadOS Apple Pencil gesture
   settings, NOT app code — check Settings → Apple Pencil before hunting in code.)
6. Hard-refresh Cmd+Shift+R when testing; on iPad, the SW cache means a stale version is the
   FIRST suspect for "fix didn't work" reports — verify footer version number on device.

## Debugging approach that has worked (follow it)

1. **Reproduce first** — live site or Playwright iPad emulation; don't fix blind.
2. Get the exact error via the `#boot-error` banner's `(file:line)` stack frame.
3. Trace to root cause; prefer the minimal targeted fix over refactors. One verified
   change-set per round.
4. Harden the data path too: assume old lessons in IndexedDB carry pre-fix corrupt data —
   add idempotent migration/sanitization in `normalizePage`, not just the new writer.
5. Verify: local browser + Playwright WebKit iPad + (after deploy) curl the live JS.
6. Bump versions (protocol above), commit with a `(vN)` message, deploy on request, then
   confirm live version + behavior.

## Known do-not-reintroduce bugs (each cost a debugging session)

- Instrument gate: `isDrawPointer()` is false while ruler/protractor/compass is armed — the
  onDown early-return needs `&& !instToolActive()`.
- Present-mode CSS: `#editor.present-mode .tbar-top button` recolors ALL toolbar buttons light;
  every new dropdown/pill surface inside the toolbar needs its own dark override or it renders
  light-on-light (`.panel-drop`, `.rail-head .tabs` pattern).
- Calculator: programmatic focus must use `calcQuietFocus` (never open MathLive VK from
  faceplate keys); `.calc-vk-active` must not hide `.calc-sub`. Display modes 0=D 1=F
  2=ab/c 3=√; SHIFT+S⇔D toggles mixed⇔improper.
- Eq dock rides above the MathLive keyboard via `syncEqDockAboveKeyboard()`;
  `.eq-kbd-open` hides the symbol palette.
- `#float-delete` pill (updateDeleteSelBtn) is the ONLY touch path for deleting selections —
  the rail `#delete-selection` exists only on the Page tab.
- `objHit` must dispatch by kind — treating `equation` like a line (`o.from/o.to`) caused the
  production `.x` crash (v121).
- Old workers.dev URL `waseemakhlaque85.workers.dev` is DEAD; account subdomain is
  `waseemonline.workers.dev`. Supabase auth site_url/uri_allow_list point at prod — reset
  emails broke when this was wrong.

## Current state (as of 2026-07-12)

- **Live:** v121 (commit e2fb128) on waseemonline.com — geometry sanitizer, calc lock-out fix,
  error banners with stack frames. Project is launched; teacher uses it in real classes.
- **Working tree:** DIRTY, at **v123 uncommitted** — OpenBoard-style instruments.js rewrite
  (new schema `{x,y,length,rotation}` etc.), PDF Safari blob self-heal in pdfPages.js/storage.js,
  `navigator.storage.persist()`. **CLINE-QA-REMAINING.md is the authoritative task list** with
  integration bugs to fix first (toolbar toggle, stale hints, legacy-schema migration on load,
  syncInstButtonState wiring) and per-item acceptance criteria. Finish + verify before commit.
- **Unresolved mysteries:** the original draw-mode `.x` banner trigger was never reproduced
  (hardened, not root-caused); "reading x" may still lurk in pre-v120 lessons.
- **Pending ops:** re-ingest RAG corpus for the new coursebooks; consider Workers Paid ($5/mo)
  so classroom AI search never dies mid-day; R2 still not enabled (blocks >24MiB books).

## Where knowledge lives

- This file (architecture + constraints + playbook) — keep it updated when decisions change.
- `CLINE-QA-REMAINING.md` — current bug round w/ acceptance criteria.
- `docs/` — deeper one-topic docs (SUPABASE-SETUP, RAG-INGEST, PAYMENTS-LATER, LAUNCH…).
- Claude Code auto-memory (Claude-only): `~/.claude/projects/-Users-waseemakhlaque-Downloads-mathboard-fresh/memory/`.
- `.claude-state` — terse per-step handoff file the owner likes appended during long tasks.

## Working with the owner

- He is a teacher, not a developer: explain findings in plain language, keep output terse,
  one verified fix-set at a time, and never ask him to run terminal commands — run them.
- His bug reports come from real iPad classroom use; trust them even when desktop can't repro.
- Decisions he has locked in (don't re-litigate): vanilla JS, Vectorize in the root worker,
  no D1/Fable, js/anim/ tool pattern, login-gated access with `active_until` as the single
  future payment-gateway integration point.
