# MathBoard — Copilot project instructions

You are continuing **MathBoard**, a pencil-first, offline PWA whiteboard for teaching
A-level Mathematics (Cambridge 9709) on iPad + Mac. Author/owner: **Waseem Akhlaque**,
A Level Mathematics Teacher. Proprietary — © 2026 Waseem Akhlaque, all rights reserved.

## Golden rules (do NOT break these)
- **Vanilla only.** Plain JavaScript (ES modules) + HTML5 Canvas 2D + CSS. **NO build step,
  NO framework** (no React, Vue, Svelte, TypeScript-compile, bundler, npm runtime deps).
  It must stay a static site you can serve with `python3 -m http.server`.
- **No backend.** No n8n, no server. Persistence is IndexedDB only. It must work fully offline.
- **All third-party libs are vendored locally** in `vendor/` (jspdf, pdf.js + worker, mathjs,
  simple-statistics, uPlot, mathlive, jsxgraph, KaTeX woff2 fonts). Never add a runtime CDN
  `<script>`. To add a lib, download it into `vendor/` and reference the local file.
- **Match the existing code style**: small helper functions, terse comments explaining *why*,
  `const`-first, no semicolize-churn. Read neighbouring code before adding to a section.
- **After ANY change to css/app.css or js/app.js you MUST bump the cache version**: increment
  `?v=N` on BOTH `<link ... app.css?v=N>` and `<script ... app.js?v=N>` in `index.html`, and
  bump the `CACHE = 'mathboard-vN'` constant in `sw.js`. Add new assets to the `sw.js` ASSETS
  list. On localhost the browser serves stale CSS/JS otherwise. Tell the user to hard-refresh
  (Cmd+Shift+R).

## How to run / test
- Serve: `python3 -m http.server 8080` inside this folder, open http://localhost:8080
- iPad: open `http://<mac-LAN-ip>:8080` → Add to Home Screen.
- Service worker is **disabled on localhost/127.0.0.1**, enabled on a LAN IP (avoids stale-cache
  pain in dev while keeping the PWA offline on iPad).
- IndexedDB writes are **debounced 400 ms** — wait before reading back in any test.
- Verify in a REAL visible browser. A headless tab cannot rasterize PDF (PDF.js yields via
  requestAnimationFrame, which stalls in a non-painting tab).

## File map
- `index.html` — single page; library + editor + classroom shell + floating panels. Bump `?v=N` here.
- `config.js` — runtime config (`window.MB_CONFIG`); set `collabServerUrl` only on deployed hosts.
- `css/app.css` — all styles.
- `js/app.js` — main app: state, rendering loop, tools, panels, classroom shell, demo bar.
- `js/calculus.js` — differentiation/integration module (area shading, Riemann, tangent/normal).
- `js/geo.js` — JSXGraph geometry layer (constructions, angles, conics).
- `js/cplx.js` — complex/Argand extras (ω·z, bisector, arg loci).
- `js/mech.js` — mechanics diagrams (forces, incline, projectile, v–t / s–t).
- `js/instruments.js` — ruler, protractor, compass overlays.
- `js/collab/collab.js` — gated collab stub (dynamic import only when `collabServerUrl` is set).
- `js/storage.js` — IndexedDB wrapper (DB `mathboard`, store `notebooks`, keyPath `id`).
- `sw.js` — service worker (offline). Bump `CACHE` const on asset changes.
- `manifest.json`, `vercel.json`, `assets/` (logo.svg, waseem.jpg), `vendor/`, `docs/`.

## Architecture & conventions (read before editing app.js)
- **Data model:** notebook `{id,title,sections[]}` → section `{id,title,pages[]}` → page
  `{id, paper, strokes[], objects[], geoItems?, mechItems?, instruments?, background?, functions?}`.
  Persisted to IndexedDB, debounced 400 ms via `persist()`.
- **Coordinates:** page units `PAGE_W=1000 × PAGE_H=1414` (A4). Camera `{scale, offsetX, offsetY}`.
  Everything stored in **page units**. `UNIT=50` = "1" on the grid.
- **Tools:** pen/highlighter/eraser/lasso/select + shapes + vector/plotz/circle + geo tools +
  instruments + mechanics placement + calculus overlays.
- **Undo/redo:** `beginAction()` / `commitAction()` around every mutating gesture.
- **Classroom shell:** left pinnable tool rail + top app bar + bottom page tray (BrainCert-style).
- **Live demo bar:** `S.demoT` parameter drives animated objects (tracer, force vector, incline).
- **PDF import:** fill offscreen canvas white before JPEG encode (transparent → black bug).

## Already BUILT & working
Notebook library + sections + paginated A4 pages; paper templates; pen/highlighter/eraser/lasso;
undo/redo; pinch-zoom/pan + palm rejection; PDF import + annotate (blob store); image insert;
PNG + multi-page PDF export; Vectors; Complex/Argand + loci; JSXGraph geometry + transformations
(translate/rotate/reflect/enlarge) + intersection; draggable instruments; Mechanics (editable diagrams,
pulleys, moments); Calculus; function grapher + dedicated graph view + unit circle + trig sliders;
Statistics; fx-991ES PLUS calculator; Select tool; Layers panel; notebook search; classroom shell;
branding + logo; live demo animation bar; Live AR Studio (webcam + Three.js); offline PWA;
GitHub Pages + Vercel deploy; cloud sync client (REST adapter — needs backend).

## Remaining tasks (priority order — do ONE solid, verified module per round)
1. **Online portal backend** — Supabase (Auth + Postgres + Storage) + REST endpoints for `share.js`.
2. **Live multi-user** — Yjs + websocket; awareness cursors; rooms/roles (`js/collab/collab.js` stub).
3. **Live A/V classroom** — WebRTC SFU (LiveKit) + TURN; recording.
4. **Stretch:** solids of revolution, slope fields, MediaPipe segmentation in AR Studio, infinite canvas.

See [`docs/ROADMAP-V2.md`](docs/ROADMAP-V2.md) for the full phased plan and hosting guide.

## Workflow expected of you
1. Pick the next unbuilt task (or whatever the user asks).
2. Implement it in vanilla JS, matching existing style; wrap mutations in beginAction/commitAction.
3. Bump `?v=N` (index.html ×2) and `CACHE` (sw.js); add new assets to ASSETS.
4. Tell the user exactly what changed and to hard-refresh `http://localhost:8080`.
5. Keep each round to ONE module that is solid and verified before moving on.
