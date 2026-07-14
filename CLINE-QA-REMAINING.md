# Cline task — finish remaining MathBoard QA bugs (v122+)

Paste this **entire file** into Cline as the task prompt. Work in the repo root:
`/Users/waseemakhlaque/Downloads/mathboard-fresh` (or your clone).

---

## What MathBoard is (architecture — do not redesign)

A **vanilla static PWA** for teaching A-level maths. Deployed to **waseemonline.com** via a
Cloudflare Worker (`wrangler.jsonc` serves the repo root as assets; `.assetsignore` excludes
non-runtime files). Owner deploys manually — **do not** run `wrangler deploy` unless asked.

```
index.html
  ├─ css/app.css (+ annotatedSim.css)
  ├─ vendor/*          (mathlive, jsxgraph, katex, mathjs, pdf.js, perfect-freehand, …)
  ├─ sw.js             (PWA cache; DISABLED on localhost)
  └─ js/app.js         (boot, S state, render loop, pointer/ink, objects, calc, UI bind)
       ├─ model.js     (notebook schema, normalizeNotebook, sanitizeGeoItems)
       ├─ storage.js   (IndexedDB db "mathboard", stores notebooks + blobs)
       ├─ geo.js       (JSXGraph board; dumpGeoItems / rebuildGeo / loadGeoPage)
       ├─ instruments.js  (ruler / protractor / compass widgets — WIP rewrite in working tree)
       ├─ pdfPages.js  (lazy PDF backgrounds + Safari blob self-heal — WIP)
       ├─ scene.js, layers.js, mech.js, cplx.js, share.js, auth.js, …
       └─ anim/*       (labs / annotated sims)
```

### Hard constraints (NEVER break)

- **Vanilla only.** Plain ES modules + Canvas 2D + CSS. NO React/Vue/Svelte, NO TypeScript,
  NO bundler, NO new npm runtime deps. Servable with `python3 -m http.server`.
- **No backend required** for core. Persistence = IndexedDB. Optional cloud/RAG when config set.
- **All libs vendored** in `vendor/`. Never add a runtime CDN `<script>`.
- **Do NOT touch the pencil-ink hot path** in `js/app.js`:
  `onDown` / `onMove` / `pointerrawupdate` / coalesced / predicted events / `appendInkPoints` /
  `drawStrokePreview` / ink snapshot blit. Pen latency is the #1 acceptance criterion.
- Wrap every mutating gesture in `beginAction()` / `commitAction()` (undo/redo).
- **Version bump protocol** after any shipped change:
  - `APP_VERSION` in `js/app.js`
  - `?v=N` on `app.css`, `annotatedSim.css`, `app.js` in `index.html` (footer `vN` too)
  - `const CACHE = 'mathboard-vN'` in `sw.js`
  All three must match. Working tree is already at **122** (uncommitted). Bump to **123** on
  your first complete verified fix-set if 122 ships incomplete, or finish + commit as 122.
- Never commit `config.local.js` (gitignored; `supabaseUrl:''` disables login gate locally).
- Match style: small helpers, terse "why" comments, `const`-first.
- One solid, verified change-set per round. Test in a real browser; hard-refresh Cmd+Shift+R.

### Coordinate / object model (design you must respect)

- Page units: A4 `1000×1414` (`js/pageLayout.js`), `UNIT=50`.
- Camera: `{ scale, offsetX, offsetY }`. `toPage()` screen→page; `snapPt()` on grid papers.
- Document: `notebook.sections[].pages[]`. Each page has `strokes[]`, `objects[]`, `geoItems[]`,
  `instruments[]`, `functions[]`, …
- Objects: `page.objects[]`, dispatched by `o.kind` in `drawObject()`. Selection via Select tool
  (`objPoints` / `objBBox` / `objHandles` / `applyHandle` / `objHit`). Corrupt geometry must
  **skip-and-continue**, never throw (`objGeomOk` in app.js).
- Render: single `requestAnimationFrame(render)`; dirty flag `S.dirty` via `mark()` / `markInk()`.
- Geometry: JSXGraph in `#geo-layer`. Persist via `dumpGeoItems()` → `page.geoItems`; rebuild on
  `loadGeoPage()`. `boardPageId` must match page id before dump (v120).
- Errors: `#boot-error` via `surfaceUnexpectedError` — banners now include top stack frame
  `(file:line)` (v121). Keep that.

### How to run locally

```bash
cd /Users/waseemakhlaque/Downloads/mathboard-fresh
python3 -m http.server 5231
# open http://127.0.0.1:5231  (SW disabled on localhost)
```

Inspect persistence: IndexedDB db **`mathboard`**, store **`notebooks`** →
`pages[].geoItems` / `pages[].instruments` / `pages[].objects`.

---

## Already shipped on main (verify; do not re-implement)

### v120 — `f71aa99`
- Geometry: dump refuses wrong page; perp/parallel parent ids + line ids; teardown clears `pend`;
  move commits; rotate uses `.X()/.Y()`; Escape / second-tap disarm.
- Calculator: `calcQuietFocus` so faceplate keys don't open MathLive VK; compact CSS keeps
  TABLE/MATRIX/EQN/∫dx + MODE menu visible.
- Instruments (old model): Select + `#float-delete`; draw/hit skip malformed items.
- Guard `S.moving` when selection cleared mid-drag.

### v121 — `e2fb128` (pushed)
- `surfaceUnexpectedError` appends top stack frame.
- **Root cause of production `.x` crash:** `objHit` treated `equation` like a line
  (`pointSegDist(o.from, o.to)`). Fixed → `pointInEquation`; `objGeomOk` guards draw/hit/bbox.
- `sanitizeGeoItems` in `normalizePage` (orphan refs, broken perp/parallel, unnamed unreferenced
  points). Open persists when geo count shrinks so IndexedDB is cleaned once.

---

## Current working tree (UNCOMMITTED — your starting point)

Status: **dirty**, version strings already **122**, not committed.

| File | Intent |
|------|--------|
| `js/instruments.js` | **Large rewrite** → OpenBoard-style widgets: one ruler/protractor/compass per page, drop at centre, rotate/resize handles, close button, compass draws ink arcs. Schema changed from `{a,b}` / `{vertex,arm1,arm2}` / `{center,r}` to `{x,y,length,rotation}` / `{x,y,radius,rotation}` / `{pivot,pencil,radius}`. |
| `js/app.js` | Partial: PDF toast hook, `navigator.storage.persist()`, destroy PDF docs on back-to-library. **Instrument toolbar still uses OLD two-tap placement hints and buggy toggle.** |
| `js/pdfPages.js` | Safari blob eviction self-heal: re-fetch `bg.src`, `putBlob` same id, toast on failure. |
| `js/storage.js` | Supporting blob put / persistence helpers for self-heal. |
| `index.html` / `sw.js` | `?v=122` / `mathboard-v122`. |

**Critical integration bugs (status as of v125):**

1. ~~**Toolbar toggle is wrong.**~~ **FIXED (already in tree, verified v125):** `bindEditor()`
   calls `setInstTool(b.dataset.inst)` unconditionally — true per-kind toggle, not the old
   `null`-clears-armed-flag pattern this doc originally flagged. Toast text also already
   reflects the new UX ("tap again to remove · drag to move · handles to rotate/resize").

2. ~~**Stale INST_HINTS.**~~ **FIXED (already in tree, verified v125):** current toast copy
   matches the drop-at-centre / drag-handle UX, not the old two-tap placement hints.

3. **Legacy instruments in IndexedDB.** **FIXED + hardened (v125).** `normalizePage()` in
   `model.js` migrates `{a,b}` / `{vertex,arm1,arm2}` / `{center,r}` → the new schema, and new-
   schema items pass through untouched. Hardened this session: each field is now checked with a
   `pt()` guard before use, and the whole migration is wrapped in try/catch — a malformed legacy
   item (missing `b`, `arm1`, non-numeric coords, etc.) is dropped silently instead of throwing.
   Verified with a script covering well-formed migration + 4 malformed-input cases (no throw).

4. ~~**`syncInstButtonState()`**~~ **FIXED (v125).** Was already wired into `goToPage` and
   `openNotebookData`, but **not** into `doUndo`/`doRedo` — undoing an instrument add/remove
   left the toolbar button showing the wrong active state (e.g. ruler icon lit up with no ruler
   on the page). Added `syncInstButtonState()` to the end of both undo and redo.

5. **Select + float-delete + undo** for the new widgets — code path looks correct
   (`beginInstMove` / handles / `deleteSelectedInstrument` / close button all wired, compass
   commits a real ink stroke via `beginAction`/`commitAction`) but **not yet on-device tested**.

6. **PDF self-heal** — untouched this session, still open (see P1 below).

7. **New: malformed-instrument draw/hit guard.** Added `instGeomOk()` in `instruments.js`
   (mirrors `objGeomOk` for page objects) and wired it into `drawInstruments`, `hitInstrument`,
   and `beginInstMove` — a corrupt/partial widget (bad schema, non-numeric fields) is now
   skipped in draw and hit-test instead of risking a NaN-geometry throw. Not yet on an
   acceptance-criteria checklist before this session; added because it's required by CLAUDE.md's
   hard constraint #4 (corrupt data must skip-and-continue, never throw) and there was no
   equivalent guard for instruments yet.

---

## Remaining bugs / verification (priority order)

### P0 — Finish & harden the instruments rewrite (desktop + iPad)

Acceptance:
- [ ] Toolbar button places widget at centre (no two-tap place).
- [ ] Second tap on same toolbar button **removes** that kind from the page.
- [ ] Drag body moves; rotate/resize handles work; close button deletes with undo.
- [ ] Select tool shows red highlight + `#float-delete`; Delete/Backspace works; undo restores.
- [ ] Pen snaps to ruler drawing edge (`snapToRuler`).
- [ ] Compass pencil drag previews arc; pointer-up commits ink stroke; undo removes stroke.
- [ ] Page switch / reload preserves widgets (IDB round-trip). Inspect `pages[].instruments`.
- [ ] Opening a **pre-v122** lesson with old instrument schema migrates cleanly (no crash, visible widgets).
- [ ] Malformed instruments still skip-and-continue in draw/hit (never throw into `#boot-error`).

### v124 — fixed this session (verified by script against vendor/math.min.js, not yet iPad-tested)

- [x] **Calculator surd mode (√):** `surdHtml()` was gcd-reducing the coefficient/radicand pair
      like a fraction, which is mathematically invalid (`k·√n ≠ (k/g)·√(n/g)`). Broke common
      A-level results: √8 showed "0" (should be 2√2), √32 showed "2" (should be 4√2), √72
      showed "3" (should be 6√2), √27 showed "0" (should be 3√3). Removed the erroneous
      reduction. Also fixed `trySurdDecimal()` not recognizing perfect squares as whole numbers
      (√100 showed "5√4", √121 showed "√121" — both now show clean 10 / 11). Swept all n=2..225
      by script — all now match hand-checked correct simplified surd form. **Still needs
      on-device confirmation that the rendered `<span class="c-surd">` HTML displays correctly.**

### v126 — calculator computation further verified this session (script, not device)

Ran `calcScope()`'s trig/inverse-trig/power/root/memory logic through mathjs directly (same
approach as the surd-mode fix) to check the remaining "users report as wrong" items from
`CLINE-PROMPT-calc-geo-fixes.md`: 18/18 checks passed — DEG/RAD trig and inverse trig, `2^10`,
cube/nth roots, `STO`/recall variable resolution through `calcScope()`'s `...calcVars` spread,
`M+`/`M-` accumulation, `Ans` chaining, and `Pol`/`Rec` (polar↔rectangular). Decimal display
(`calcFormatPlain`) also confirmed to clean up floating-point noise correctly (e.g.
`0.49999999999999994` → shows "0.5"). **This verifies the math is correct; it does not verify
the on-screen keypad/touch behavior** — faceplate-key focus handling, SHIFT/ALPHA sequencing on
a real keypad tap, and the MathLive VK interaction below are unverified by this pass.

### P0 — On-device / touch QA (iPad Safari) for prior fixes

These were only partially verified on desktop automation:

- [ ] **Calculator:** faceplate keys never open MathLive VK / never collapse keypad;
      MODE → TABLE/EQN/MATRIX usable while VK open (`calc-vk-active` CSS).
- [ ] **Geometry:** draw line + perp (and parallel); switch pages; full reload; items survive
      in `geoItems` with resolvable `line` + `pt` ids. Second tap on geo tool disarms.
- [ ] **Equation + Draw:** page with equation object; Pencil stroke does **not** show
      `Cannot read properties of undefined (reading 'x')`. If banner appears, it must include
      `(file:line)` — use that to fix remaining unguarded `.x` (skip-and-continue).
- [ ] **sanitizeGeoItems:** open a lesson with injected orphans / undefined perp → cleaned in
      memory and written back to IDB after open (geo count shrink → persist).

### v126 — root cause found + fixed this session (script/code-verified, not yet iPad-tested)

Reproduced the exact reported error via code trace (not device — no iPad in this environment):
"Unexpected error: The PDF file is empty, i.e. its size is zero bytes" with a stuck/empty
thumbnail on a specific page deep into a large paper. Root cause was **not** the self-heal
logic itself (which was already correctly written) — it was two separate gaps:

- [x] **Unhandled rejection on a single corrupt page.** `renderPageStrip()` in app.js builds
      the "PDF pages panel" thumbnail strip and called `renderPdfPageDataUrl()` with no
      `.catch()`; inside `pdfPages.js`, `pdf.getPage()`/`.render()` had no try/catch either. A
      PDF can parse fine overall while one specific page's content stream is corrupt (plausible
      after Safari storage pressure partially damages a large file) — that one page's render
      threw an unhandled rejection straight into the `#boot-error` banner with the raw pdf.js
      text, and its thumbnail stayed permanently blank. **Fixed:** wrapped the render sequence
      in `renderPdfPageDataUrl()` itself in try/catch so it always resolves (null on failure) —
      protects every current and future caller, not just the one that was missing `.catch()`.
- [x] **Self-heal was dead code.** `buildLazyPdfPages(..., sourceUrl)` takes a `sourceUrl` to
      set `bg.src` for later re-fetch, but **no caller anywhere in the codebase ever passed
      it** — including `papersLibrary.js`'s `openOnBoard()`, which fetches the gated past-paper
      URL then discards it before handing the file to `importPdfAsNotebook()`. So `bg.src` was
      always unset, and the self-heal path in `loadPdfDoc()` could never engage for ANY PDF,
      past-paper or local import. **Fixed:** threaded the URL through
      `openOnBoard → importPdfAsNotebook → renderPdfToPages → buildLazyPdfPages` so past-paper
      opens now set `bg.src` and self-heal is actually reachable. Local file-picker imports
      still correctly get no `src` (nothing to re-fetch from — by design).
- [x] **Misleading recovery message.** The "data was cleared by Safari" toast always said
      "reopen it from Past papers to restore it" — wrong advice for a locally-imported PDF with
      no library copy to reopen. Now branches on whether `bg.src` exists. Also added the same
      toast to the pdf.js parse-failure path, which previously only logged to console — the
      user got a silently blank page with no explanation.

**Still needs on-device iPad confirmation** — this was root-caused and fixed by tracing the
code, not by reproducing the crash on a physical device. The three items below (blob eviction
recovery, PDFDocumentProxy cleanup, storage.persist()) haven't been touched this session:

- [ ] Open a past paper from library (has `bg.src`) → clear blob in DevTools Application →
      reload page → toast "Restoring…" → paper reappears OR clear recovery message.
- [ ] Local PDF file import (no `src`) → missing blob shows recovery toast, no uncaught throw.
- [ ] Leaving editor destroys unused `PDFDocumentProxy` cache (no leak / no crash on reopen).
- [ ] `navigator.storage.persist()` requested once at boot (ignore rejection).

### P2 — MathLive virtual keyboard empty plate (deprioritize if desktop-only)

**Checked this session — the suspected cause doesn't hold up:**
- `configureMathLive()` sets `MathfieldElement.fontsDirectory = './vendor/fonts/'` at boot
  (`bindEditor()` → `setupEqEditor()` → `configureMathLive()`), before any `<math-field>`
  (calculator or equation editor) is first connected/shown. Order is correct.
- Grepped `vendor/mathlive.min.js` for every font filename it references (`KaTeX_*.woff2`,
  20 files) against what's actually in `vendor/fonts/` — **exact match, nothing missing.**
  MathLive vendors the same KaTeX font family internally, so the "MathLive may expect its own
  font set" concern in the original note doesn't apply here — there is no 404 risk from a
  filename mismatch.
- Conclusion: if the empty-plate bug is still reproducible, it isn't a missing/mismatched font
  file. Would need an actual repro (device or desktop browser) to find the real cause — nothing
  further to check from reading the code alone. No environment available this session to
  reproduce it. Leaving as P2 / deprioritized per the original note.

### P2 — Regression smoke

- [ ] Fresh lesson: pen, equation, geo line, calc evaluate, export PNG — zero console errors.
- [ ] `config.local.js` absent → no red boot banner (404 on optional script is OK).

---

## Design notes for the instruments rewrite (implement to this design)

```
Toolbar [data-inst=ruler|protractor|compass]
    │
    ▼
setInstTool(kind)
    ├─ if page already has that kind → remove (begin/commit) + clear selection
    └─ else createWidget(kind) at page centre → push → select → begin/commit
    └─ syncInstButtons()  // active iff kind present on current page

Pointer (Select tool or direct hit when not inking):
    beginInstMove(p)
      ├─ hit close → delete
      ├─ hit rotate/resize/pencil handle → instMove.handle = …
      └─ hit body → translate
    moveInst / endInstMove  (commit on up; compass may append stroke)

Draw: drawInstruments(ctx, page) each rAF (already called from render)
Snap: appendInkPoints → snapToRuler(pt) using rulerEdge(it)
```

Keep exports that `app.js` already imports:
`setupInstruments, setInstTool, instToolActive, handleInstClick, drawInstruments,
snapToRuler, hitInstrument, beginInstMove, moveInst, endInstMove, clearInstSelection,
selectedInstrument, selectedInstBBox, deleteSelectedInstrument`
(`instToolActive` / `handleInstClick` may stay no-ops if placement is immediate).

---

## Out of scope

- Do not introduce Vite/React/TypeScript (ignore aspirational `docs/ARCHITECTURE-V2.md` build split).
- Do not deploy (`wrangler deploy`).
- Do not rewrite ink, collab, or RAG unless a bug you touch forces a one-line fix.
- Do not commit secrets / `config.local.js`.

---

## Done criteria

1. Instruments rewrite fully wired + legacy migration + iPad-verified.
2. PDF self-heal verified for URL-backed papers; safe for local imports.
3. Prior v120/v121 behaviours still green on iPad (calc, geo perp/parallel, equation+pen).
4. Cache version consistent; detailed commit message; leave deploy to owner.

When finished, reply with: files changed, migration behaviour, test checklist results, commit hash.
