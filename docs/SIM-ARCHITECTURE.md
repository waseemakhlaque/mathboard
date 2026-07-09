# Snip-to-Sim: one-click interactive diagrams for M1 / P1 / P3

## Goal
While viewing a coursebook page or past paper (PDF) in MathBoard, select any diagram and
one click turns it into a **live, draggable simulation** pre-filled with the diagram's own
values (masses, angles, coefficients, equations) — the same drag-to-explore experience as
the existing physics labs (`mb-incline-lab`, `mb-pulley-lab`, `mb-suvat-lab`).

## Feasibility (honest version)
"Any diagram" is achievable because A-level diagrams are not arbitrary: they repeat ~18
archetypes. The pipeline is:

```
[PDF page in MathBoard]
      │  drag-select region ("⚡ Make interactive" tool)
      ▼
[PNG crop of the diagram]  ──►  POST /api/sim/resolve  (root Worker)
                                      │  Anthropic vision (claude-haiku-4-5,
                                      │  tool-use forced to a JSON schema)
                                      ▼
                     { archetype: "pulley", params: {m1:3, m2:5},
                       extracted_labels: [...], confidence: 0.93 }
      ▼
confidence ≥ 0.7 → mount the matching <mb-*-lab> pre-filled, params editable
confidence < 0.7 → archetype picker (18 chips) with extracted values pre-typed
      ▼
[Interactive lab in #anim-dialog] → optionally saved into the notebook page
and tagged nb.catalog → appears in Course Library
```

- **Deterministic where it matters**: all physics/maths rendering is closed-form JS in the
  Web Components (existing `MbLab` pattern). The LLM only *reads* the diagram (classify +
  extract numbers) and returns strict JSON. Wrong extraction is a two-second manual fix in
  the params editor, never a wrong simulation.
- **Fallback always works**: even with no AI (offline / no key), the snip tool opens the
  archetype picker and the teacher types 2–3 numbers. One extra click instead of zero.

## Archetype registry v1 (grounded in the actual books)

| # | Archetype (tag) | Source chapters | Draggables |
|---|---|---|---|
| 1 | `mb-suvat-lab` ✅ built | M1 ch1 (v–t, s–t, multi-stage) | u-arrow, a-handle |
| 2 | `mb-motion-graph-lab` | M1 ch1.4–1.6 (multi-stage/discontinuous graphs) | graph vertices |
| 3 | `mb-forces-particle-lab` | M1 ch3 (resolving, triangle of forces, Lami) | force arrow heads |
| 4 | `mb-incline-lab` ✅ built | M1 ch4 (friction, angle of friction) | apex, μ knob, block |
| 5 | `mb-pulley-lab` ✅ built | M1 ch5 (strings, pulleys) | either mass, ± kg |
| 6 | `mb-connected-lab` | M1 ch5 (rods/tow-bar, lifts) | tow force, masses |
| 7 | `mb-momentum-lab` | M1 ch7 (collisions, coalescence) | u₁/u₂ arrows, masses |
| 8 | `mb-energy-lab` | M1 ch8–9 (work, KE/PE, power) | height/slope/force |
| 9 | `mb-projectile-lab` | past papers (paper 4) | launch angle + speed vector |
| 10 | `mb-quadratic-lab` | P1 ch1 (roots, vertex, discriminant, line∩curve) | a/b/c handles, line |
| 11 | `mb-function-lab` | P1 ch2 (transformations: translate/reflect/stretch) | transform handles |
| 12 | `mb-coord-lab` | P1 ch3 (lines, circles, intersections) | centre, radius, line pts |
| 13 | `mb-trig-lab` | P1 (unit circle ↔ sin/cos graphs, radians) | angle point on circle |
| 14 | `mb-tangent-lab` | P1/P3 differentiation (tangent/normal, stationary pts) | point on curve |
| 15 | `mb-area-lab` | P1/P3 integration (area under curve, trapezium) | limits a/b, strip count |
| 16 | `mb-iteration-lab` | P3 numerical (cobweb/staircase xₙ₊₁=F(xₙ)) | x₀ handle |
| 17 | `mb-vector-lines-anim` ✅ built | P3 vectors (lines in 3D) | (upgrade to draggable λ/μ) |
| 18 | `mb-argand-lab` | P3 complex (loci: \|z−a\|=r, arg) | centre, radius, z point |
| 19 | `mb-slopefield-lab` | P3 differential equations | initial-condition point |

Single source of truth: `js/anim/simRegistry.js` — array of
`{ tag, title, icon, topics: [catalog names], paramSchema: {name: {type, min, max, default, unit}} }`.
The Worker embeds the same registry (imported at build-less runtime via a shared module) in
the vision prompt, so the LLM can only ever answer inside the schema.

## Components (all inside mathboard-fresh — NOT a new app)

1. **Labs** — `js/anim/*.js`, one file per archetype, extending `MbLab`
   (js/anim/mbLab.js: pointer-capture drag via `getScreenCTM().inverse()`, sim loop,
   readout bar). Registered side-effect via `simRegistry.js` imports.
2. **Snip tool** — `js/snipSim.js`. Active on any notebook page with a PDF background
   (js/pdfPages.js already renders pages to canvas): button in the page toolbar → crosshair
   drag → crop the page canvas region to a ≤1024px PNG dataURL → resolver → mount.
   Must NOT touch the ink render loop in js/app.js (pencil latency is the #1 acceptance
   criterion — see docs/ARCHITECTURE-V2 and the v99+ snapshot-blit ink path).
3. **Resolver route** — extend `worker/index.js`: `POST /api/sim/resolve`
   `{image, hint?}` → Anthropic Messages API, model `claude-haiku-4-5` (vision, cheap,
   ~1–2s; config flag to switch to `claude-fable-5` for hard diagrams), `tools:[{...}]`
   with `input_schema` = registry → forced tool_choice → returns the tool_use JSON verbatim.
   `ANTHROPIC_API_KEY` is a Worker secret (`npx wrangler secret put ANTHROPIC_API_KEY`);
   never ships to the client. Rate-limit: 10/min/IP via a simple in-memory token map.
   Access is login-gated (signed-in + active_until); no client paywall.
4. **Mount/edit UI** — extend `js/ragSearch.js` dialog: params side-panel generated from
   `paramSchema` (number inputs + sliders), Apply re-renders the lab live; "Pin to page"
   serializes `{tag, params}` into the notebook page (new `pg.sims: []` array) so the sim
   reopens with the lesson and appears in Course Library via nb.catalog tagging.
5. **RAG cross-link** (already live): search results and topic shelves route to the same
   labs via `js/anim/ragRoutes.js` — Snip-to-Sim and RAG share the registry.

## Free mode (default) — no paid API anywhere
Resolver ladder, tried in order:
1. **Workers AI vision** (`@cf/meta/llama-3.2-11b-vision-instruct`, free tier, existing
   `env.AI` binding — no new accounts). JSON-constrained prompt, same registry schema.
2. **Tesseract.js** (vendored, browser-side, offline): OCR the crop → pre-fill numbers in
   the manual picker. Runs when the Worker call fails/offline.
3. **Manual picker** — always available, archetype chips + typed params.
Optional later: swap stage 1 to Anthropic claude-haiku via env flag.

Free building blocks to lean on:
- **JSXGraph** (already in vendor/) — build the P1/P3 graph-type labs on it.
- **Three.js** (already in vendor/) — 3D vector/projectile scenes for the "VR feel"
  on smart panels (orbit/pinch drag), WebXR-ready later.
- **PhET sims** (open source, phet.colorado.edu) — optional registry entries whose
  "mount" opens the matching PhET HTML5 sim for archetypes we haven't built yet.

## Present Sim mode (smart panel / Google Meet)
`#anim-dialog` gets a ⛶ button → fullscreen (Fullscreen API): lab scales to viewport,
readout bar doubles in size, background dimmed — designed to be screen-shared or driven
by touch on an interactive flat panel. Exiting restores the dialog.

## Cost & limits
- Haiku vision resolve ≈ $0.001–0.005 per snip; negligible at classroom scale.
- Workers AI free tier does NOT cover the Anthropic call (separate API key/billing);
  the existing 10k-neuron/day quota only affects RAG *search* embeddings, not snips.
- Vision extraction accuracy: expect ~90% on printed diagrams; params editor covers the rest.

## Build order (maps to the Cursor prompt phases)
1. `simRegistry.js` + 4 highest-value new labs (forces-particle, projectile, quadratic, tangent)
2. Snip tool (region select + crop) with manual archetype picker (no AI yet — already useful)
3. `/api/sim/resolve` + wire confidence flow
4. Params editor + "Pin to page" persistence
5. Remaining labs in batches (motion-graph, momentum, energy, connected, coord, trig, area, iteration, argand, slopefield)
