# CURSOR PROMPT — Snip-to-Sim: one-click interactive diagrams (M1/P1/P3)

Copy everything below the line into Cursor's agent chat with this repo
(`~/Downloads/mathboard-fresh`) open. Full context: `docs/SIM-ARCHITECTURE.md`.

---

Implement "Snip-to-Sim" in this repo: select any diagram on a PDF page (coursebook or
past paper) inside MathBoard and one click converts it into a live draggable simulation
pre-filled with the diagram's values. Work file-by-file, phase-by-phase. After every step
append 2 lines to `.claude-state`: (1) exact files modified, (2) next atomic task.

## HARD CONSTRAINTS
- Vanilla JS ES modules, NO build step, no frameworks, no npm deps in the frontend.
- Follow the existing lab pattern EXACTLY: read `js/anim/mbLab.js` (MbLab base:
  pointer-capture drag via getScreenCTM().inverse(), continuous sim loop, readout bar,
  Run/Reset) and `js/anim/inclineLab.js` + `js/anim/pulleyLab.js` as reference
  implementations before writing any lab.
- DO NOT modify the ink/stroke render path in `js/app.js` (snapshot-blit + Path2D cache —
  pencil latency is the product's #1 acceptance criterion). The snip tool must be a
  separate overlay layer, active only while snipping.
- Deterministic maths only inside labs (closed-form formulae per frame, no physics engine).
- Backend: EXTEND `worker/index.js` (root Worker, routes under /api/). No new workers, no D1.
- Secrets stay in Worker env (`ANTHROPIC_API_KEY` via wrangler secret). Never client-side.
- Every frontend change: bump `CACHE` in `sw.js` (currently mathboard-v10x), add new js
  files to its ASSETS precache list, and bump `?v=` cache-busters + `#mb-version` in
  `index.html`.
- Reuse: `svgEl` helper (js/anim/mbAnim.js), login gate (`js/entitlement.js`), the
  `#anim-dialog` / `#anim-host` modal (index.html + js/ragSearch.js mountTool()),
  `esc()` string-escaping pattern, CSS tokens (--radius-md, --accent-light, --surface-2).

## PHASE 1 — Registry + four new labs
1. `js/anim/simRegistry.js`: export `SIM_REGISTRY` = array of
   `{ tag, title, icon, topics: [exact content/catalog.json topic names],
      paramSchema: { <param>: { type:'number', min, max, default, unit, label } } }`
   covering ALL archetypes in docs/SIM-ARCHITECTURE.md §registry (including the three
   already-built labs). Import every lab module here (side-effect element registration)
   and re-export `animForTopic(topic)`; refactor `js/anim/ragRoutes.js` to re-export from
   simRegistry so nothing else breaks.
2. New labs, one file each, each extending MbLab, each accepting `params` JSON attribute
   validated against its paramSchema:
   - `js/anim/forcesParticleLab.js` `<mb-forces-particle-lab>` — particle at origin, 2–4
     force arrows with draggable heads (magnitude+direction); live resultant vector,
     equilibrium indicator, Lami/triangle-of-forces readout.
   - `js/anim/projectileLab.js` `<mb-projectile-lab>` — draggable launch-velocity arrow
     (speed+angle), ground line; Run traces the parabola with time markers; readout: range,
     max height, time of flight (u, θ, g=9.8 closed-form).
   - `js/anim/quadraticLab.js` `<mb-quadratic-lab>` — y=ax²+bx+c with draggable vertex and
     a root handle (or a/b/c sliders); optional draggable straight line; readout:
     discriminant, roots, vertex, line∩curve solutions.
   - `js/anim/tangentLab.js` `<mb-tangent-lab>` — cubic/param curve, draggable point P;
     tangent + normal drawn live; readout: f'(x), tangent equation, stationary points.
3. Add the four labs to the picker: extend `LABS` (now in simRegistry) so the existing
   `openLabPicker()` in js/ragSearch.js shows all chips grouped M1 / P1 / P3.
4. Verify: `node --check` each file; in browser (npx wrangler dev --port 5191, config in
   .claude/launch.json) open panel menu → Physics Labs → every chip mounts, drags, Runs.

## PHASE 2 — Snip tool (works with NO AI)
5. `js/snipSim.js`: export `setupSnipSim({ getPageCanvas, onLocked })`.
   - Toolbar button `⚡` (id `snip-sim`) added next to the existing page tools in
     index.html; visible only when the current page has a PDF background
     (see js/pdfPages.js for how backgrounds render).
   - Click → overlay `<div id="snip-overlay">` over the canvas, crosshair cursor,
     pointer-drag draws a dashed rect; on release: crop that region from the page canvas
     (drawImage into an offscreen canvas, downscale longest side to 1024px),
     `toDataURL('image/png')`.
   - With the crop: call `resolveSim(dataURL)` (Phase 3). Until Phase 3 lands, skip
     straight to `openSimPicker(dataURL)`: the #anim-dialog shows the cropped image
     thumbnail + all registry chips; choosing one mounts the lab with schema defaults.
   - Esc or click-outside cancels. Overlay must be fully removed after use (zero impact
     on drawing latency).
6. CSS in css/app.css: `.snip-overlay`, `.snip-rect`, `.sim-picker-grid`, `.sim-thumb`.
7. Verify: import a past-paper PDF → snip a diagram → picker shows crop → lab mounts.

## PHASE 3 — resolver (FREE by default: Workers AI vision, no new accounts)
8. `worker/index.js`: add `POST /api/sim/resolve` `{image: dataURL, hint?: string}`:
   - Rate-limited (Map of IP → timestamps, 10/min); rejects images >1.5MB.
   - Build a compact archetype list from a shared `worker/simSchema.js` (generate it in
     Phase 1 as a plain-data mirror of SIM_REGISTRY — tag, description, paramSchema; keep
     the two in sync via a comment header, no build step).
   - Default (free): `env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', { image:
     [...bytes], prompt })` where prompt = archetype list + "Classify this A-level
     maths/mechanics diagram into exactly one archetype tag and extract every labelled
     value. hint: <topic>. Reply with ONLY minified JSON
     {archetype, params, labels, confidence}". Parse defensively (strip fences, JSON.parse
     in try/catch; on parse failure retry once with 'Reply with only JSON').
   - Optional higher-accuracy path: if `env.ANTHROPIC_API_KEY` is set, use the Anthropic
     Messages API (`claude-haiku-4-5`, tool_choice-forced `emit_sim` tool with the same
     schema) instead. Selected purely by presence of the secret.
   - On any upstream error return `{archetype:null, confidence:0}` (client falls back to
     picker) — never 500.
   - Client-side free fallback: vendor `tesseract.js` (vendor/tesseract/) and, when
     /api/sim/resolve is unreachable or returns null, OCR the crop locally and pre-fill
     any recognized numbers into the manual picker inputs.
9. `js/snipSim.js` `resolveSim()`: POST the crop; if `confidence >= 0.7` mount the
   archetype immediately with returned params (clamped to schema min/max); else open the
   picker with the returned params pre-filled on the suggested chip (highlighted first).
   Access is login-gated (signed-in + active_until); do not add a client paywall.
10. Verify with wrangler dev + a real snip of: a pulley diagram (M1 ch5), an incline
    (M1 ch4), a quadratic sketch (P1 ch1). Assert returned archetype tags match.

## PHASE 4 — Params editor + persistence + Present Sim mode
11. In the #anim-dialog, render a collapsible side panel from the mounted lab's
    paramSchema: one labelled number input + range slider per param; input → update
    `el.params`, call `el.reset(); el.refresh()`. Add "📌 Pin to page": push
    `{tag, params}` into the current page's `pg.sims` array (extend the page object in
    js/model.js normalization; default []), mark notebook dirty via the existing
    persist/mark hooks; render pinned sims as small ⚡ badges on the page margin
    (DOM overlay, not canvas) that reopen the dialog on tap.
12. "⛶ Present Sim" button in the #anim-dialog header: requestFullscreen() on the dialog,
    lab svg scales to viewport (CSS :fullscreen rules), readout bar font-size doubles —
    designed for smart interactive panels and Google Meet screen-share. Esc restores.
13. Verify: pin a sim, reload, badge persists and reopens with saved params; fullscreen
    drag works with touch (pointer events already handle it).

## PHASE 5 — Remaining labs (batches, same pattern)
13. Batch A (M1): motionGraphLab (draggable multi-stage v–t vertices → live s/a),
    momentumLab (two carts, draggable u arrows/masses, collide/coalesce),
    energyLab (slope + block: work/KE/PE/power bars), connectedLab (tow-bar/lift).
14. Batch B (P1): functionLab (transformations), coordLab (line+circle), trigLab
    (unit circle ↔ graphs), areaLab (integration strips/trapezium).
15. Batch C (P3): iterationLab (cobweb), argandLab (loci), slopeFieldLab (DEs);
    upgrade vectorLinesAnim with draggable λ/μ points.
16. Register each in simRegistry + sw.js precache as you go. Verify each in browser.

## ACCEPTANCE (end-to-end)
- Import `9709_s23_qp_42.pdf`, snip the pulley diagram → ≤3s → draggable Atwood machine
  with the paper's masses pre-filled; drag one mass, the other mirrors; Run animates.
- Open P1 coursebook ch1 page, snip a parabola sketch → quadratic lab with matching
  roots/vertex; drag vertex, equation readout updates.
- Airplane-mode: snip still works via manual picker.
- Writing with pencil after a snip session is exactly as fast as before (no overlay left).
- All new files precached; site works offline except /api/* calls.

## DEPLOY
`npx wrangler deploy` from repo root (single Worker: assets + api). Then
`npx wrangler secret put ANTHROPIC_API_KEY` once. Commit per phase, conventional style,
e.g. `feat(sim): snip-to-sim resolver + forces/projectile/quadratic/tangent labs`.
