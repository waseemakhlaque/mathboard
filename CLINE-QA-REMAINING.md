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

### v129 — CASIO branding, TABLE fix, faceplate-only entry in every sub-view, real compacting

Waseem's follow-up round on top of v128: (1) remove the "CASIO" brand text, keep only
"fx-991ES PLUS", (2) TABLE's Generate button was still failing with "Enter f(x) and valid
start/end/step" even with correct-looking values filled in, (3) wants the calculator genuinely
compact (not just scrollable), (4) wants NO keyboard — neither the native OS one nor MathLive's
— popping in the TABLE or MATRIX sub-views either, entry should work "just like an emulator."

- [x] **CASIO branding removed.** Deleted `<span class="casio-logo">CASIO</span>` from the
      calculator header (`index.html`); `fx-991ES PLUS` is now the only brand text. Adjusted
      `.casio-model` CSS (was relying on `.casio-logo`'s margin for spacing) to stand alone.
- [x] **TABLE Generate bug + the "keyboard shouldn't pop" complaint — same root cause.**
      `calcGenTable()`'s validation logic itself was verified correct by script (mathjs parses
      `"x^2 - 3"`, `"-3"`, `"3"`, `"1"` with no error, so the `!fx || !isFinite(...)` guard should
      pass). `#ct-fx`/`#ct-start`/`#ct-end`/`#ct-step` are plain `<input>`s, not the MathLive
      field, and `showCalcView()` was hiding the *entire physical faceplate* (`#calc-keys`,
      `.calc-ctl`, `.calc-funcs`) whenever a sub-view (TABLE/MATRIX/BASE/EQN/∫dx) was open — so
      the only way to fill those fields in at all was the browser's native on-screen keyboard,
      which is exactly what task (4) says shouldn't appear. The most likely explanation for "still
      not working" is that field never actually received the typed value (native keyboard
      dismissed/obscured mid-entry, viewport reflow on focus, etc.) — but regardless of the exact
      failure mode, relying on a native keyboard for these fields was always the wrong design once
      "emulator-only entry" was the explicit requirement. **Fixed by redesigning entry for every
      sub-view to go through the physical faceplate, like a real fx-991ES's TABLE/MATRIX/EQN/BASE-N
      prompts:**
      - `showCalcView()` no longer hides `#calc-keys`/`.calc-ctl`/`.calc-funcs` — the faceplate now
        stays live in every mode (only the MathLive keyboard toggle bar is hidden outside COMP,
        since it's meaningless there).
      - Added `calcActiveField` (tracks the currently "armed" TABLE/MATRIX/BASE/EQN/∫dx `<input>`,
        set on focus and auto-armed to the first field when a sub-view opens) and
        `calcFieldTarget()`/`calcInsertPlain()`/`calcDeletePlain()`/`calcPlainToken()` in `app.js`.
      - `calcKey()` now routes digit/operator/function keys into the armed field when one is
        active: DEL backspaces it, ◄► move its caret, ▲▼ cycle between sibling prompts in the same
        sub-view (f(x) → Start → End → Step, matching the real device), AC clears it, and `=`
        triggers that view's action button (`#ct-gen` / `#intg-go` / `#eqn-go` / `#base-go`).
      - `#ct-fx`, `#ct-start/end/step`, the matrix/vector cells, `#base-in`, `#intg-fx/a/b/x0`, and
        the dynamically-created `#eqn-r-c` fields all got `inputmode="none"` so tapping them to
        arm them for faceplate entry never pops the native OS keyboard either.
      - Added a `:focus` highlight (`box-shadow` in the accent colour) on these fields since
        there's no OS caret+keyboard to show which one is armed.
      - **Not yet on-device verified** (no browser session available this round) — code-reviewed,
        `node --check`-clean, and mirrors the already-shipped `calcQuietFocus` pattern from v128.
- [x] **Calculator made genuinely more compact**, not just scroll-safe, since the faceplate is now
      always visible (adding height in every sub-view) and the user explicitly doesn't want to
      scroll: shrank `.calc.casio` width 366→336px, header padding, `.calc-screen` margins, the
      expr/result font sizes, `.ck` key padding/font-size (`.calc-keys` gap 6→4px, `.calc.casio
      .ck` padding 13px0 6px→8px0 5px), `.calc-ctl` replay-pad size, `.ct-in`/`.mx-in` padding and
      font-size, `.calc-sub` padding, `.ct-out` max-height 220→140px, and hid the MathLive
      keyboard-toggle bar (`#calc-kbd-bar`) outside COMP mode entirely (it's meaningless once
      sub-view fields are faceplate-driven). The `max-height: calc(100vh - 40px); overflow-y:
      auto;` safety net from v128 is left in place as a fallback for extreme window sizes, but the
      calculator should no longer need it in normal use.

**Not yet re-deployed or on-device tested** — same caveat as v127/v128: code-reviewed and
`node --check`/brace-balance-clean, but needs a real deploy + hands-on iPad/browser check before
calling it done.

### v128 — calculator UI/UX (fits window + emulator-only entry, no code-required popup keyboard)

Waseem's follow-up feedback: (1) inserting a fraction pops the on-screen math keyboard instead
of staying on the physical emulator, (2) the calculator doesn't fit within the browser window
when resized, especially in present mode, and its layout can go off-screen.

- [x] **Calculator doesn't fit the window / present mode.** Confirmed live: in present mode the
      calculator is repositioned to `top: 72px; bottom: auto` with no height limit, so on a
      650px-tall window its bottom keypad rows (1-2-3-0, "=", TABLE/MATRIX) render past the
      bottom edge with no way to scroll to them — page-level scroll doesn't help since the panel
      is `position: fixed`. The base (non-present) rule also had no height cap at all — only
      the narrow `#calc.calc-vk-active` state (keyboard open) capped height, so a short/resized
      window could overflow any time, not just in present mode. Fixed: added
      `max-height: calc(100vh - 40px); overflow-y: auto;` to the base `.calc` rule, and a
      matching present-mode-specific cap measured from its actual `top` offset
      (`calc(100vh - max(72px, safe-area-inset-top) - 16px)`). Uses `vh` units so it reflows
      automatically as the browser window is resized — no JS resize listener needed. Not
      re-tested live (can't deploy from this session) but follows the exact pattern already
      proven working for the keyboard-open state.
- [x] **a-b/c key popped the on-screen keyboard.** Root cause: `calcInsert()` and the frac
      handler in `calcKey()` called `executeCommand('insert', …)` and only wrapped the
      *subsequent* re-focus call in the `calcQuietFocus` guard — too late, because inserting a
      placeholder structure (a fraction) moves MathLive's caret into the new placeholder, which
      fires its own `focusin` event *during* the insert, before the guard was set. Plain
      single-character inserts (digits, operators) don't create a placeholder to focus into, so
      they were never affected — only the fraction key was. Fixed: the `calcQuietFocus` guard
      now wraps the `executeCommand` call itself, in both `calcInsert()` (covers `inv`, `neg`,
      `e10`, `ran`, `ranint`, etc.) and the frac-specific handler.
- [x] **No physical way to reach a fraction's denominator without the popup keyboard.** Found
      while fixing the above: suppressing the keyboard alone would have made things *worse*,
      because the d-pad's Down key was a literal no-op (`{ return; }`) and Up always triggered
      Recall — meaning the popup keyboard's own arrow keys were the *only* way to move from
      numerator to denominator. Wired Down to MathLive's `moveDown` command and Up to `moveUp`
      (both confirmed to exist in the vendored `mathlive.min.js`), so the physical d-pad now
      navigates within a fraction like the real device. Up still triggers Recall, but only when
      the expression field is empty (nothing to navigate into) — matches how replay works on a
      fresh entry on the physical calculator, without breaking mid-expression navigation.

**Not yet re-deployed or on-device tested** — code-reviewed and follows already-proven CSS/JS
patterns elsewhere in the file, but this needs a real deploy + hands-on iPad/browser check
before calling it done, same as v127's fixes.

### v127 — CRITICAL calculator bug found + fixed via live browser reproduction (v126 was already deployed)

Waseem reported (screenshot) that on the live site, entering a mixed number via the `a b/c` key
and subtracting another fraction gave a wrong result, the MODE menu "wasn't showing options",
and "log wasn't working". Reproduced live on waseemonline.com (v126, signed in as the teacher
account) via browser automation rather than guessing from code:

- [x] **MODE menu: not a bug.** Opened correctly with all 10 options (1:COMP … 8:BASE-N, DEG,
      RAD) visible. Whatever Waseem saw was very likely a stale Safari/PWA cache showing
      pre-v120 code — not present in the current build.
- [x] **CRITICAL — mixed-number entry silently gave wrong answers.** This is the real bug behind
      the screenshot. Typing "2⅓ − ⅔" via the `a b/c` key produces LaTeX `2\frac{1}{3}-\frac{2}{3}`.
      `latexToMath()` converted the adjacency `2\frac{1}{3}` into the bare-juxtaposition string
      `2((1)/(3))` — which mathjs reads as **multiplication** (2 × ⅓), not addition. So
      "2⅓ − ⅔" silently computed as (2×⅓) − ⅔ = **0** instead of the correct 5/3 ≈ 1.667. No
      error shown — just a wrong number, on one of the most basic, everyday operations on this
      calculator. Root-caused and reproduced with the exact screenshot expression before fixing.
      Fix: in `latexToMath()`'s `conv()`, when a `\frac` is immediately preceded by a bare digit
      run (no operator between — the a-b/c key's signature, since no other input path produces
      that adjacency), insert `+` (or `-` if the digit run is itself negated, e.g. `-2\frac{1}{3}`
      → `-2-((1)/(3))`, correctly giving -(2+1/3) not -2+1/3). Verified against the real function
      extracted from the file: 9/9 cases pass — the screenshot case, negative mixed numbers,
      chained subtraction (`5-2⅓`), two-digit whole parts, explicit-multiplication-preserved
      (`3×⅓` still multiplies), bare fractions, and a sqrt regression check.
- [x] **Log: not a distinct bug, but a related one found alongside it.** `log10(100)` with the
      closing paren typed computes correctly (=2). But `log10(100` **without** the closing paren
      — completely normal muscle memory from a real fx-991ES, which auto-closes brackets on "="
      — gave a bare "Error". Fixed: `calcEvaluate()` now auto-closes unbalanced `(` before
      calling `math.evaluate()`, matching real-device behavior. Verified 5/5 cases (unclosed
      log, unclosed trig, nested unclosed parens, already-balanced expressions unaffected,
      double-nested unclosed).

**Not yet re-deployed** — v126 was already live when this was found; this fix is v127,
uncommitted, needs a fresh deploy before Waseem can retest.

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
