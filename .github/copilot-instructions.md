# MathBoard — Copilot project instructions

You are continuing **MathBoard**, a pencil-first, offline PWA whiteboard for teaching
A-level Mathematics (Cambridge 9709) on iPad + Mac. Author/owner: **Waseem Akhlaque**,
A Level Mathematics Teacher. MIT licensed © 2026 Waseem Akhlaque.

## Golden rules (do NOT break these)
- **Vanilla only.** Plain JavaScript (ES modules) + HTML5 Canvas 2D + CSS. **NO build step,
  NO framework** (no React, Vue, Svelte, TypeScript-compile, bundler, npm runtime deps).
  It must stay a static site you can serve with `python3 -m http.server`.
- **No backend.** No n8n, no server. Persistence is IndexedDB only. It must work fully offline.
- **All third-party libs are vendored locally** in `vendor/` (jspdf, pdf.js + worker, mathjs,
  simple-statistics, uPlot). Never add a runtime CDN `<script>`. To add a lib, download it into
  `vendor/` and reference the local file.
- **Match the existing code style**: small helper functions, terse comments explaining *why*,
  `const`-first, no semicolize-churn. Read neighbouring code before adding to a section.
- **After ANY change to css/app.css or js/app.js you MUST bump the cache version**: increment
  `?v=N` on BOTH `<link ... app.css?v=N>` and `<script ... app.js?v=N>` in `index.html`, and
  bump the `CACHE = 'mathboard-vN'` constant in `sw.js`. On localhost the browser serves stale
  CSS/JS otherwise. Tell the user to hard-refresh (Cmd+Shift+R).

## How to run / test
- Serve: `python3 -m http.server 8080` inside this folder, open http://localhost:8080
- iPad: open `http://<mac-LAN-ip>:8080` → Add to Home Screen.
- Service worker is **disabled on localhost/127.0.0.1**, enabled on a LAN IP (avoids stale-cache
  pain in dev while keeping the PWA offline on iPad).
- IndexedDB writes are **debounced 400 ms** — wait before reading back in any test.
- Verify in a REAL visible browser. A headless tab cannot rasterize PDF (PDF.js yields via
  requestAnimationFrame, which stalls in a non-painting tab).

## File map
- `index.html` — single page; both views (library + editor) + all floating panels. Bump `?v=N` here.
- `css/app.css` — all styles.
- `js/app.js` (~1300 lines) — the whole app: state, rendering loop, tools, panels.
- `js/storage.js` — IndexedDB wrapper (DB `mathboard`, store `notebooks`, keyPath `id`).
- `sw.js` — service worker (offline). Bump `CACHE` const on asset changes.
- `manifest.json`, `vercel.json`, `assets/` (waseem.jpg, icon.svg), `vendor/` (offline libs),
  `README.md`, `docs/ROADMAP.md`, `LICENSE`, `THIRD-PARTY-LICENSES.md`.

## Architecture & conventions (read before editing app.js)
- **Data model:** notebook `{id,title,pages[]}` → page `{id, paper, strokes[], objects[],
  background?, functions?, showResultant, showConjugate}`. Persisted to IndexedDB, debounced 400 ms
  via `persist()`.
- **Coordinates:** page units `PAGE_W=1000 × PAGE_H=1414` (A4). Camera `{scale, offsetX, offsetY}`.
  Everything (strokes + objects) is stored in **page units** so pan/zoom never distorts saved work.
  `UNIT=50` page units = "1" on the grid. `toPage(cssX,cssY)` converts screen→page.
  `snapPt()` snaps to the integer grid only on grid papers (argand/vectorgrid/axes).
- **Strokes:** `{tool, color, width, points:[{x,y,p}]}` with midpoint-quadratic smoothing.
- **Objects** (`page.objects[]`), `o.kind` ∈ vector | line | rect | ellipse | complex | circle | text.
  `drawObject()` dispatches by kind; `objHit()` is used by the eraser and selection.
- **Tools** (`S.tool`): pen, highlighter, eraser, lasso (moves STROKES only), **select** (moves/
  resizes OBJECTS — see below), line, rect, ellipse, vector, plotz, circle, text. `setTool()` calls
  `setTab()` via the `TOOL_TAB` map.
- **Select tool (object move/resize):** helpers `objPoints / objBBox / objHandles / applyHandle /
  moveObject / hitObject / handleAt / deleteSelectedObject`; state `S.selObj / S.objMove /
  S.objResize`. Click to select (dashed bbox + white square handles), drag body to move, drag a
  handle to reshape, Delete/Backspace to remove. Lasso (strokes) and Select (objects) are separate.
- **Undo/redo:** `beginAction()` snapshots the page (strokes+objects) at gesture start;
  `commitAction()` pushes to `S.undo` if it changed. Wrap every mutating gesture in this pair.
- **Tabbed toolbar:** tabs Draw/Maths/Page; groups tagged `data-tabs="draw maths page"`; `setTab()`
  toggles `.show`; CSS `.tbar-tools .group:not(.show){display:none}` (specificity matters).
- **Floating panels** (position:fixed, draggable via `makeDraggable`): `#calc` (fx-991-style
  calculator, engine = `window.math`/mathjs), `#stats` (window.ss + window.uPlot), `#graph`
  (function grapher). `#text-editor` = textarea overlay for text boxes. `#brand` = branding overlay.
- **PDF import:** PDF.js renders each page to an offscreen canvas that **must be filled white first**
  (transparent→JPEG = black/blank bug), saved as a JPEG dataURL = `page.background {type:'image'}`.

## Already BUILT & working
Notebook library + paginated A4 pages; paper templates; pen/highlighter/eraser/lasso; undo/redo;
pinch-zoom/pan + palm rejection; PDF import + annotate; PNG + multi-page PDF export; Vectors
(components, |v|, angle, resultant, snap); Complex/Argand (plot z, modulus/arg, conjugate, circle
locus); function grapher y=f(x); Statistics (1-var + 2-var regression); fx-991 calculator; Shapes
(rect/ellipse); Text boxes; **Select tool (object move/resize/delete)**; tabbed toolbar; branding
overlay; offline PWA; Vercel-ready.

## Remaining tasks (priority order — do ONE solid, verified module per round)
1. Geometry module using **JSXGraph** (vendor it locally) — angle measure, constructions,
   transformations, conics. Vanilla, fits perfectly.
2. Insert image onto a page (as a movable object — reuse the Select-tool handles).
3. Custom colour picker + more pen types.
4. Mechanics module (force diagrams/resultant, projectiles, inclined plane, kinematics graphs).
5. Complex extras: multiply/rotate by w (show rotation+scaling), loci |z−a|=|z−b| (perp bisector)
   and arg(z−a)=θ (half-line).
6. Calculator natural/stacked fraction + surd display (cosmetic; currently linear).
7. Optional: stroke-replay/animate mode for YouTube; cloud sync.

## Workflow expected of you
1. Pick the next unbuilt task (or whatever the user asks).
2. Implement it in vanilla JS, matching existing style; wrap mutations in beginAction/commitAction.
3. Bump `?v=N` (index.html ×2) and `CACHE` (sw.js).
4. Tell the user exactly what changed and to hard-refresh `http://localhost:8080`.
5. Keep each round to ONE module that is solid and verified before moving on.
