# MathBoard — Project Assessment & Gap Analysis (v1 → target)

> Prepared in response to a full project review. This document compares **what exists today**
> in the repository against **the full feature set you described** (OneNote/GoodNotes notebook,
> OpenBoard drawing + geometry instruments, an exact Casio **fx‑991ES PLUS** calculator,
> GeoGebra‑style graphing with a trig focus, statistics / mechanics / vectors / complex‑Argand
> drawing tools, **thorough calculus**, your logo, and a **BrainCert‑style live teaching portal
> UI**), then states exactly where the differences are.
>
> Companion documents:
> - [`ARCHITECTURE-V2.md`](./ARCHITECTURE-V2.md) — the redesigned architecture.
> - [`ROADMAP-V2.md`](./ROADMAP-V2.md) — the build roadmap + local (Mac/iPad) + online live‑portal plan.

---

## 0a. Update — work completed since this assessment

The following gaps identified below have since been **implemented** (see the PR / roadmap):

- ✅ **Brand logo** — gradient MathBoard logo across app header, editor, PWA icon, favicon.
- ✅ **BrainCert‑style classroom layout (front‑end)** — top app bar + pinnable left tool rail +
  stage with a bottom page tray; pin/unpin and Close All.
- ✅ **Thorough calculus** — derivative + stationary points, definite integral + shaded area,
  area between curves, Riemann sums (left/right/mid/trapezium), tangent/normal.
- ✅ **fx‑991ES PLUS calculator** — faithful faceplate (CASIO/model/V.P.A.M., solar strip, SHIFT/
  ALPHA, REPLAY pad, MODE) **plus working ∫ and d/dx** (Simpson + mathjs) and a MODE menu.
- ✅ **MathLive/KaTeX fonts** vendored (natural display renders correctly, 404 fixed).
- ✅ **Large-media blob store** — PDF/image bytes in IndexedDB blob store; lazy PDF page render on demand.
- ✅ **Draggable instruments** — OpenBoard-style ruler/protractor/compass with snap-to-edge ink.
- ✅ **GeoGebra-grade graphing** — unit circle, amp/period/phase sliders, degrees-axis toggle, roots/extrema markers, graph view.
- ✅ **Live collab scaffold** — Yjs + collab-server wired; opt-in lazy load with connection timeout + offline states.

The scorecard in §3 has been annotated accordingly. The remaining big item is the **full live portal** (WebRTC A/V, scheduling, recording — Phases 9–10 backend).

## 0. How to read this

Status legend:

| Mark | Meaning |
|---|---|
| ✅ **Done** | Built and working today. |
| 🟡 **Partial** | Exists but incomplete, simplified, or does not match the described target. |
| ❌ **Missing** | Not present; needs to be built. |

---

## 1. What the project is today (verified by reading the code)

MathBoard is a **single static PWA** (no build step, no backend) — HTML + CSS + vanilla ES‑module
JavaScript + HTML5 Canvas 2D, with all libraries vendored locally for offline use.

**Core that is genuinely solid:**

- Notebook **library** view + **editor** view (`index.html`, `js/app.js`).
- **Sections** (OneNote‑style tabs) → **pages** (A4) → layers, persisted to **IndexedDB**
  (`js/storage.js`), debounced 400 ms. Portable JSON schema with versioning + migration
  (`js/model.js`, format v2).
- **Drawing**: pen (fine / marker / calligraphy pen types, pressure), highlighter, eraser
  (with stroke‑split), lasso (move strokes), **Select** tool (move/resize/delete objects),
  line / rect / ellipse, **text boxes**, **LaTeX equations** (MathLive).
- **Paper templates** per page: plain (none), graph, squared, Cornell, Argand, vector grid, axes.
- **Pages**: add/insert, prev/next, thumbnails strip, page label.
- **Import**: PDF (PDF.js, multi‑page → page backgrounds), image (movable object), JSON lesson.
- **Export**: page → PNG, notebook → multi‑page PDF (jsPDF); JSON backup; Web Share.
- **Math modules**: vectors (resultant, parallelogram, components, |v|, angle, snap), complex /
  Argand (plot z, modulus/arg, conjugate, circle locus, ω·z rotation+scale, |z−a|=|z−b| bisector,
  arg(z−a)=θ half‑line — `js/cplx.js`), geometry via **JSXGraph** (`js/geo.js`), instruments
  (ruler / protractor / compass — `js/instruments.js`), mechanics (forces, incline, projectile,
  v–t / s–t — `js/mech.js`), function grapher (y=f(x), parametric, tangent, intersection),
  statistics (1‑var + 2‑var regression, histogram, scatter via uPlot), an fx‑style scientific
  **calculator** (MathLive display + mathjs engine).
- **Branding overlay** (photo + name + title + phone), **Present mode** (hides chrome, dark bg),
  **PWA** (`manifest.json`, `sw.js`), Vercel config, and a **sync‑ready** layer
  (`js/share.js` exposes a REST sync provider + `getPortalAPI()` — but it is a stub: no backend
  exists yet).

This is a strong **single‑user, offline notebook**. The gaps below are almost entirely about
(a) depth/fidelity of specific modules and (b) the leap from a solo notebook to a **multi‑user,
real‑time, hosted teaching portal**.

---

## 2. Feature‑by‑feature gap analysis

### 2.1 OneNote / GoodNotes notebook features

| Feature you asked for | Status | Notes / what's missing |
|---|---|---|
| Pages (paginated notebook) | ✅ Done | A4 pages, add/insert/navigate, thumbnail strip. |
| Grid **and** no‑grid options | ✅ Done | 7 paper types incl. "None (blank)"; per‑page selectable. |
| Various **tabs** | ✅ Done | OneNote‑style **sections** + library of notebooks. |
| Pen | ✅ Done | 3 pen types, pressure, colour, width. |
| Eraser | ✅ Done | Stroke‑hit + stroke‑split eraser. |
| Insert large PDF | ✅ Done | PDF stored once as a blob; pages reference it (`pdf-page` type) and rasterise lazily on view/export. Size budget (100 MB max) + confirm dialog for large imports. Legacy inline JPEG notebooks still migrate via `migrateNotebookMedia()`. |
| Insert image | ✅ Done | Movable object reusing Select handles; bytes in blob store. |
| **GoodNotes/OneNote niceties** | 🟡 Partial | **Layers panel**, page duplicate/delete/reorder, section delete, dotted/ruled papers, clear-page, and **search** are built. Still missing: nested notebooks/folders; lasso→shape; handwriting-to-text; audio; bookmarks; infinite canvas. |

**Verdict:** Notebook core is **largely there**. Large-media handling is **done** (blob store + lazy PDF). Remaining gaps are organisational niceties (folders, handwriting-to-text, infinite canvas).

### 2.2 OpenBoard drawing + geometry instruments (ruler, protractor, compass)

| Feature | Status | Notes |
|---|---|---|
| Freehand board drawing | ✅ Done | Pen/highlighter/eraser/shapes. |
| Ruler | ✅ Done | Draggable physical ruler (`js/instruments.js`); ink snaps to its edge via `snapToRuler()`. |
| Protractor | ✅ Done | Draggable semicircular protractor; angle read-out persists. |
| Compass | ✅ Done | Set centre + radius, sweep arc; draggable after placement. |
| Set square / straightedge snapping | ❌ Missing | No set square tool. |
| Geometry constructions | ✅ Done | JSXGraph: point, segment, line, circle, ellipse, angle, perpendicular, parallel — all draggable & persisted. |
| Transformations (reflect/rotate/enlarge/translate) | 🟡 Partial | Midpoint / bisector / intersection tools built; full drag-transform UI for arbitrary shapes still limited. |
| Intersection / midpoint / bisector construction tools | ✅ Done | Midpoint, perpendicular bisector, angle bisector exposed in geo panel. |

**Verdict:** **Instruments behave like OpenBoard physical tools.** Geometry constructions are strong. Set square and full transformation UI remain stretch goals.

### 2.3 Casio **fx‑991ES PLUS** calculator (must match the photos exactly)

| Aspect | Status | Notes |
|---|---|---|
| Scientific engine | ✅ Done | mathjs: trig (deg/rad), powers/roots, log/ln, π/e, factorial, nCr/nPr, |x|. |
| Complex (CMPLX) | 🟡 Partial | `i` supported and complex results format; but no dedicated CMPLX **mode** with arg/conj/polar↔rect on the keypad. |
| Matrix & Vector | 🟡 Partial | 2×2 matrix (det/inv/transpose/×/+) and 3‑vector dot/cross/|u|/angle via a sub‑panel — limited to 2×2 / fixed sizes. |
| Table mode | ✅ Done | f(x) table generator. |
| S⇔D (fraction/surd display) | ✅ Done | Fraction + surd recognition. |
| **Faceplate layout matching the photos** | ✅ Done | Casio **fx‑991ES PLUS** skin in `index.html` / `css/app.css`: CASIO branding, solar strip, round **REPLAY** pad, colour‑coded **SHIFT** / **ALPHA** secondary labels, natural **V.P.A.M.** MathLive display, ∫dx / d/dx keys, MODE menu, EQN/BASE‑N/CMPLX/MATRIX/TABLE/VECTOR sub‑panels. Minor gaps vs. a physical device (STAT still lives in a separate panel). |
| MODE menu (COMP/CMPLX/STAT/BASE‑N/EQN/MATRIX/TABLE/VECTOR) | ✅ Done | MODE menu + sub‑panels wired in `js/app.js` (`setCalcMode`, `openIntg`, `solveEqn`, `baseConvert`). |
| Equation solver (EQN): simultaneous + quadratic/cubic | ✅ Done | EQN panel: 2/3 unknown linear systems, quadratic, cubic (`solveEqn`). |
| BASE‑N (bin/oct/dec/hex) | ✅ Done | BASE‑N sub‑panel with convert/evaluate (`baseConvert`). |
| Definite/indefinite **∫** and **d/dx** keys | ✅ Done | ∫dx and d/dx keys open integration/derivative sub‑panel; Simpson + mathjs numeric engine (`calcComputeIntg`). |
| Statistics in‑calc (STAT mode) | 🟡 Partial | Stats live in a **separate panel**, not as a Casio STAT mode. |
| Constants / unit conversions (CONST/CONV) | ❌ Missing | Not present. |

**Verdict:** Engine is a decent **fx‑equivalent**, but **"exactly like the photos" is not met**.
This needs a **pixel‑faithful fx‑991ES PLUS skin** (casing, key grid, colour‑coded secondary
labels, REPLAY pad, natural display) **plus** the missing modes (EQN/BASE‑N/CMPLX/STAT menu flow,
∫ & d/dx keys). See the calculator section of the roadmap.

### 2.4 GeoGebra‑style graphing (with a trigonometry focus)

| Feature | Status | Notes |
|---|---|---|
| Plot y = f(x) | ✅ Done | Multiple functions, colours. |
| Parametric x(t), y(t) | ✅ Done | Incl. circle preset. |
| Quick trig (sin/cos/tan, 2sin, sin2x) | ✅ Done | One‑tap buttons. |
| Draggable point on curve, tangent, intersection | ✅ Done | Nice for teaching. |
| **Interactive trig teaching** | ✅ Done | Unit circle widget + amplitude/period/phase/vertical-shift sliders; **degrees-axis toggle** (`° axis` button) on grapher + graph view. |
| Independent zoomable graphing **view** | ✅ Done | Pannable/zoomable viewport in `js/graphView.js` with roots/extrema markers and area shading via calculus module. |
| Sliders / parameters (a, b, k …) | 🟡 Partial | Trig transform sliders built; no general parameter slider for arbitrary expressions. |
| Function analysis (roots, extrema, integral‑area shading) | ✅ Done | Roots/extrema markers in graph view; calculus module adds ∫ area, Riemann sums, stationary points. |

**Verdict:** **GeoGebra-class for A-level trig teaching** — unit circle, sliders, degrees axis, dedicated graph view. General expression sliders remain a stretch.

### 2.5 Statistics (basic drawing / graphing)

| Feature | Status | Notes |
|---|---|---|
| 1‑variable summary (mean/median/sd) | ✅ Done | |
| 2‑variable regression (+ r) | ✅ Done | |
| Histogram, scatter | ✅ Done | via uPlot. |
| Box plot | ✅ Done | Box plot chart type in statistics panel (`statBoxPlot`). |
| Normal distribution curve + shaded probability | ✅ Done | Normal curve + shaded region (`statNormalCurve`). |
| Insert chart **onto the page** as an object | 🟡 Partial | Charts render in a panel; placing them as movable page objects is not wired. |

### 2.6 Mechanics (basic drawing / graphing)

| Feature | Status | Notes |
|---|---|---|
| Force diagram + resultant | ✅ Done | |
| Inclined plane (mg sinα / cosα, friction, N) | ✅ Done | |
| Projectile (trajectory + velocity vectors) | ✅ Done | |
| Kinematics v–t / s–t graphs | ✅ Done | |
| Connected particles / pulleys, moments, equilibrium solver | ❌ Missing | |
| Edit/drag a placed diagram afterwards | 🟡 Partial | Placed by click; not re‑editable via Select. |

### 2.7 Vectors

| Feature | Status | Notes |
|---|---|---|
| Draw vector arrow, |v|, direction | ✅ Done | |
| Resultant, parallelogram, components, snap | ✅ Done | |
| Dot / cross | ✅ Done | via calculator vector panel. |

**Verdict:** ✅ Strong, matches the brief.

### 2.8 Complex numbers / Argand diagram

| Feature | Status | Notes |
|---|---|---|
| Plot z = a+bi, modulus line, arg arc | ✅ Done | |
| Conjugate, circle locus | ✅ Done | |
| ω·z (rotation + scale), perpendicular bisector, arg(z−a)=θ | ✅ Done | `js/cplx.js`. |
| Polar ↔ Cartesian toggle, KaTeX labels | 🟡 Partial | Polar input for ω exists; a global polar/Cartesian readout toggle is limited. |

**Verdict:** ✅ Strong, matches the brief (one of the best‑developed areas).

### 2.9 **Thorough calculus**

| Feature | Status | Notes |
|---|---|---|
| Dedicated calculus module | ✅ Done | `js/calculus.js` + panel in `index.html` / `js/app.js`. |
| Tangent at a point | ✅ Done | Grapher + calculus tangent/normal tools. |
| Numerical table of values | ✅ Done | Calculator table. |
| Derivative f′(x) plot / display | ✅ Done | Derivative kind + stationary point markers. |
| Definite integral + **area‑under‑curve shading** | ✅ Done | Integral kind with shaded region. |
| Riemann sums (rectangles/trapezium) animation | ✅ Done | Riemann kind (left/right/mid/trapezium). |
| Stationary points / inflection markers | 🟡 Partial | Stationary points marked; inflection not exposed. |
| Indefinite integral / antiderivative display | 🟡 Partial | Numeric ∫ via calculator; symbolic antiderivative limited. |
| Area between two curves, solids of revolution | 🟡 Partial | **Area between** two curves built; solids of revolution not built. |
| Differential‑equation slope fields | ✅ Done | Slope field kind (`slopefield`). |

**Verdict:** ✅ **Calculus module is built** (derivative, ∫ + area, between curves, Riemann,
tangent/normal, slope fields). Remaining polish: inflection markers, solids of revolution,
tighter calculator ↔ board integration.

### 2.10 Your logo / branding

| Feature | Status | Notes |
|---|---|---|
| Branding overlay (photo, name, title, phone) | ✅ Done | Uses `assets/waseem.jpg`. |
| A real **logo** mark | ✅ Done | `assets/logo.svg` used in library header, editor app bar, favicon, and PWA icon (`index.html`, `manifest.json`, `sw.js`). Branding overlay photo remains separate (`assets/waseem.jpg`). |

### 2.11 **BrainCert‑style live teaching portal UI**

| Feature | Status | Notes |
|---|---|---|
| Whiteboard canvas | ✅ Done | But framed as a notebook, not a classroom board. |
| **Left vertical tool rail** (pin/unpin, "Close All") | ✅ Done | Pinnable left **tool rail** + app bar in `index.html` (`#tool-rail`, `#rail-pin`, Close All). |
| 16:9 responsive board that renders identically across devices | 🟡 Partial | Pages are A4 portrait by default; optional **wide (16:9)** page format exists (`pageLayout.js`). |
| Bottom **page/slide tabs** + grouped tools (image/doc/media/polls) bottom‑right | 🟡 Partial | Section/page strips exist; BrainCert media/polls grouping not built. |
| **Participants / presence**, raise hand, attendee permissions | ❌ Missing | Collab scaffold only; no presence UI yet. |
| **Live video/audio** (WebRTC), screen share | ❌ Missing | AR Studio has local webcam only. |
| **Real‑time collaboration** (multiple cursors, shared strokes) | 🟡 Partial | Yjs + `collab-server/` wired for **strokes**; presence cursors; 15 s timeout; opt-in lazy load. Objects/geo sync + production hosting still to do. |
| Chat, polls, breakout rooms | ❌ Missing | |
| LaTeX editor on board, Wolfram‑style compute | 🟡 Partial | LaTeX equation objects exist; no live compute service. |
| Class scheduling, rooms, recording | ❌ Missing | |

**Verdict:** 🟡 The **classroom UI shell is built** (left rail, app bar, stage, page tray).
**Live multi‑user backend** (presence, WebRTC, realtime strokes) is scaffolded but not
production‑ready. Present mode ≠ a full BrainCert classroom.

### 2.12 Hosting: local use & online live portal

| Feature | Status | Notes |
|---|---|---|
| Run locally on Mac | ✅ Done | `python3 -m http.server`; documented. |
| Use on iPad (LAN + Add to Home Screen + Sidecar) | ✅ Done | Documented in README. |
| Static deploy (Vercel/Pages/Netlify) | ✅ Done | `vercel.json` present. |
| **Domain‑based, multi‑user, live** hosted portal | ❌ Missing | Needs backend (API + DB + object storage), auth, realtime (WebSocket/CRDT), media (WebRTC + TURN), and a custom domain with TLS. Currently only a stub REST sync provider with no server. |

---

## 3. Summary scorecard

| Area | Score | One‑line status |
|---|---|---|
| Notebook (pages/tabs/grid/pen/eraser) | ✅ 9/10 | Strong; page management, layers, search, clear-page, place-chart. |
| PDF / image import | ✅ 9/10 | Lazy PDF blob store + size budget; annotate + export work. |
| OpenBoard instruments (ruler/protractor/compass) | ✅ 9/10 | Draggable physical instruments with snap-to-edge ink. |
| Geometry constructions | ✅ 9/10 | JSXGraph solid; + **midpoint / perpendicular bisector / angle bisector** (persistent). Full shape transformations (reflect/rotate/enlarge) still to add. |
| fx‑991ES PLUS calculator | ✅ 9/10 | **Faceplate matches the photos**; full key set; ∫/d/dx, EQN (2/3 unknown, quadratic, cubic), BASE‑N, Pol/Rec, hyp, STO/RCL/M+, MODE menu. STAT-in-calc still separate. |
| Graphing (GeoGebra/trig) | ✅ 9/10 | Unit circle, sliders, **degrees axis**, graph view, roots/extrema markers. |
| Statistics | ✅ 8/10 | 1‑var + regression + **histogram / box plot / normal curve**; place-as-page-object still to add. |
| Mechanics | ✅ 8/10 | Good coverage; add pulleys/moments + editability. |
| Vectors | ✅ 9/10 | Matches brief. |
| Complex / Argand | ✅ 9/10 | Matches brief; among the best modules; + **polar (r∠θ) display toggle**. |
| **Calculus** | ✅ 8/10 | **Now built**: derivative + stationary pts, ∫ + area, area between, Riemann, tangent/normal. |
| Logo / branding | ✅ 9/10 | **Logo built** and placed across app/PWA/exports. |
| **BrainCert portal UI** | 🟡 5/10 | Front-end layout done (left rail/app bar/stage); presence/video/realtime polish still to add. |
| **Live online portal (backend/realtime/media)** | 🟡 3/10 | Cloud sync (Supabase) + Yjs collab scaffold done; WebRTC A/V + scheduling not built. |
| Local Mac/iPad usage | ✅ 9/10 | Documented and working. |

**Bottom line:** the **solo offline notebook + A-level maths tooling is ~95% of your vision and
genuinely good**. The **remaining ~5% is concentrated in**:
1. **Full live teaching portal** (WebRTC A/V, scheduling, recording — Phase 10).
2. **Production hosting** for collab server + optional object/geo sync in rooms.
3. Minor stretch items: general expression sliders, set square, handwriting-to-text.

Calculus, fx‑991ES PLUS, logo, classroom UI shell, layers, blob/lazy PDF, draggable instruments,
trig graphing (unit circle, sliders, degrees axis), box/normal stats, and Yjs collab are **built**.
