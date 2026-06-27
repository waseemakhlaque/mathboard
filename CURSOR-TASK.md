# Cursor task — fix remaining bugs and finish MathBoard

You are working on **MathBoard**, a single static PWA (no build step) for teaching A-level
maths: vanilla ES-module JS + HTML5 Canvas, all libraries vendored locally in `vendor/` for
offline use. Entry points: `index.html`, `js/app.js` (main), plus per-module files in `js/`.
State lives in IndexedDB via `js/storage.js`; the portable notebook schema is `js/model.js`.

**Run it:** `python3 -m http.server 5173` then open `http://localhost:5173`. The service
worker is disabled on localhost; on real devices it caches by name. **Cache-bust convention:**
every time you edit `js/app.js` or `css/app.css`, bump the `?v=NN` query in `index.html`, and
bump `const CACHE = 'mathboard-vNN'` in `sw.js` by the same number. Hard-refresh (Cmd+Shift+R)
when testing.

**Hard rules:**
- Keep it offline-first and build-step-free. Do NOT add npm bundling to the static app.
- Do NOT introduce CDN runtime dependencies — vendor any new library into `vendor/`.
- Never commit secrets. `config.local.js` is gitignored and must stay that way.
- Preserve the existing JSON schema + migrations in `js/model.js` (format v2); add migrations,
  never break old saved notebooks.
- After each change, verify in the browser with DevTools console open — there must be **zero
  uncaught errors** for the flow you touched.

---

## PART A — Bug fixes (do these first; verify each before moving on)

### A1. (ALREADY FIXED — verify only) First-lesson creation crash
`newPage()` called `page()` to inherit the page format, but `page()` throws `"Invalid
notebook."` when `S.notebook` is null (the state for any brand-new user). Result: clicking
"+ New lesson" did nothing — silently. The fix is already applied in `js/app.js`:
```js
function newPage(paper = 'graph', format) {
  const inheritFormat = S.notebook?.sections?.length ? page()?.format : null;
  return { id: uid(), paper, format: format || inheritFormat || 'a4', strokes: [], objects: [], instruments: [] };
}
```
**Verify:** clear site data → "+ New lesson" → enter a name → Create → editor opens and the
notebook persists to IndexedDB (`mathboard › notebooks`). No `"Invalid notebook."` in console.

### A2. Make notebook creation fail loudly, never silently
In `createNotebook()` (`js/app.js`, ~line 2430) the line `const nb = newNotebook(...)` is
OUTSIDE the try/catch, so any throw there becomes an unhandled rejection with no UI feedback.
Move `newNotebook(...)` inside the `try`, and make the `catch` show a real message. Audit the
other call sites of `newNotebook` / `openNotebookData` (`createNotebook`, PDF import ~line 2248,
import-JSON path) for the same pattern. Add a single global `window.addEventListener(
'unhandledrejection', …)` and `'error'` handler that surfaces unexpected failures into the
existing `#boot-error` banner (or a toast) instead of dying silently.

### A3. Harden `sections()` so it actually repairs and never throws on null
`sections()` (`js/app.js` ~line 112) currently does
`if (!S.notebook?.sections?.length) normalizeNotebook(S.notebook);` — it **discards the return
value** (so it doesn't repair anything) and throws if `S.notebook` is null. Fix it to assign the
normalized result back and guard the null case, e.g.:
```js
function sections() {
  if (!S.notebook) return [];
  if (!S.notebook.sections?.length) S.notebook = normalizeNotebook(S.notebook);
  return S.notebook.sections;
}
```
Then make `pages()`/`page()` tolerate an empty list (return `null`/`[]`) so nothing down-chain
dereferences `undefined`. Confirm no regression opening/creating/importing notebooks.

### A4. AR Studio camera: add a timeout + clean teardown
`initStudio()` in `js/studio/studioManager.js` (~line 33) awaits
`navigator.mediaDevices.getUserMedia(...)` with no timeout — if the permission prompt is never
answered it hangs forever, leaving the Studio panel half-open. Wrap the call in a
`Promise.race` with a ~10s timeout (and handle `navigator.mediaDevices` being undefined on
insecure origins). On timeout/denial: call `showErr(...)`, fully tear down (stop any tracks,
dispose renderer, close the panel), and reset the toggle button state.

### A5. Clear the deprecation warnings (longevity, not fatal)
- MathLive: replace `mf.setOptions({ smartMode:false, smartFence:false })` (`js/app.js` ~3435)
  with direct property assignment: `mf.smartMode = false; mf.smartFence = false;` (guard for
  older builds). Remove other `setOptions` usages the console flags.
- three.js: the console warns `build/three.min.js` is deprecated (r150+). Either pin to an
  `r1xx` build that doesn't warn, or vendor the ESM build and import it in `js/studio/*` via the
  existing importmap. Don't break AR Studio.

### A6. Fix the contradictory assessment doc
`docs/ASSESSMENT.md` §2 feature tables and §3 scorecard disagree (e.g. calculus, logo, portal
UI marked both "Missing" and "Built"). Reconcile them against the **actual current code** —
verify each claim by reading the relevant `js/*.js` before marking it ✅/🟡/❌ — so the doc is a
trustworthy single source of truth.

**Acceptance for Part A:** fresh-profile load → create lesson, draw, add an equation, open every
module panel (Layers, f(x), Calculus, Symbolic, Algebra, Fractions, Stats, Calculator,
Mechanics, Complex, AR Studio), export PDF, reload → all with **zero uncaught console errors**,
and every failure path shows a user-visible message.

---

## PART B — Finish the project (prioritized; one module per PR, with acceptance criteria)

Pick up in this order. For each, work in the existing module file, persist new state through the
`js/model.js` schema (+ migration), include it in undo/redo, and make it render in PNG/PDF export.

### B1. Large-media handling (correctness + performance) — `js/blobs.js`, `js/app.js`
PDF/image import currently rasterizes pages to JPEG dataURLs stored *inside* the notebook JSON,
bloating IndexedDB and exports. `migrateNotebookMedia()` and a blob object-store already exist —
finish wiring it: store imported page/image bytes as **blobs** (separate store), keep only blob
refs in the notebook JSON, render via object URLs, and lazy-render PDF pages on demand. Add a
size budget + a visible warning for very large imports.
**Done when:** a 20-page PDF imports without freezing, the notebook JSON stays small, and
annotate-over-PDF + export still work.

### B2. Draggable OpenBoard instruments — `js/instruments.js`
Ruler / protractor / compass are currently two-click measurement annotations. Make them
**physical draggable instruments**: a ruler you position/rotate and trace ink along (snap ink to
its edge), a semicircular protractor you align and read angles off, a compass you set a radius
and sweep an arc with. Keep the existing measurement read-outs.
**Done when:** each instrument can be dragged/rotated, drives ink/where relevant, and persists.

### B3. GeoGebra-grade trig graphing — `js/graphView.js` / grapher panel
Add the trig teaching aids called out in `docs/ASSESSMENT.md` §2.4: an interactive **unit
circle** widget, **amplitude / period / phase sliders**, a degrees-axis option, and roots/extrema
markers + area shading on plotted functions. (Some sliders may already be partly present — verify
and complete.)
**Done when:** a teacher can drag a slider and watch `a·sin(bx+c)` update live with labeled axes.

### B4. fx-991ES PLUS calculator fidelity — `js/app.js` calculator section
Bring the calculator closer to the real device: MODE menu flow (COMP/CMPLX/STAT/BASE-N/EQN/
MATRIX/TABLE/VECTOR), dedicated `∫dx` and `d/dx` keys wired to the existing numeric engine,
EQN solver (simultaneous + quadratic/cubic), BASE-N, and Pol/Rec. Match the faceplate layout to
the reference photos (REPLAY pad, colour-coded SHIFT/ALPHA secondary labels, natural V.P.A.M.
display).
**Done when:** the documented MODE flows work and `∫`/`d/dx` keys compute correctly.

### B5. Live teaching portal (largest; backend) — `collab-server/`, `supabase/`, `js/collab/`
The realtime/multi-user portal is scaffolded but not integrated: `collab-server/` wraps
`y-websocket`, `supabase/` has an edge function + migration, `js/collab/collab.js` connects via
Yjs. Wire and verify end-to-end: two browsers in the same room see each other's strokes live;
presence indicator; graceful "connecting/offline" states (today an unreachable server shows
"Connecting…" forever). Keep collab **strictly opt-in** and lazy-loaded so the offline solo app
never fetches it. Document setup in `docs/SUPABASE-SETUP.md`.
**Done when:** two devices on the same room URL collaborate in real time, and the solo offline
app is completely unaffected when collab is off.

---

## Working agreement
- Smallest change that fixes the issue; match the surrounding code style.
- After each item: run the app, exercise the exact flow, confirm zero console errors, then bump
  the `?v=` / `sw` cache versions.
- Don't refactor unrelated areas. Don't add a build step. Don't add CDN runtime deps.
