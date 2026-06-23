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

The scorecard in §3 has been annotated accordingly. The remaining big items are: GeoGebra‑grade
graphing (unit circle/sliders), draggable instruments, stats (box/normal), and the **online live
portal** (backend + realtime + media).

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
| Insert large PDF | 🟡 Partial | Works, but every PDF page is rasterised to a JPEG dataURL held in memory and stored inside the notebook JSON. **Large** past papers will be slow to import and bloat IndexedDB / exports. Needs: store PDF/image blobs separately (object store / server), lazy page rendering, and a size budget. |
| Insert image | ✅ Done | Movable object reusing Select handles. |
| **Missing GoodNotes/OneNote niceties** | ❌ Missing | Layers panel; per‑object reordering; folders / nested notebooks; richer paper library (lined/dotted/music/cover); page reorder/duplicate/delete UI; lasso → convert to shape/text; handwriting‑to‑text; audio recording; bookmarks/outline; search across notes; **infinite/scrolling canvas** option (today pages are bounded A4 only). |

**Verdict:** Notebook core is **largely there**. Main real gaps: large‑media handling and a
handful of organisational tools (layers, page management UI, search).

### 2.2 OpenBoard drawing + geometry instruments (ruler, protractor, compass)

| Feature | Status | Notes |
|---|---|---|
| Freehand board drawing | ✅ Done | Pen/highlighter/eraser/shapes. |
| Ruler | 🟡 Partial | Exists as a **two‑click measurement annotation** (draws a line + reads length in grid units). It is **not** a draggable physical ruler with an edge you trace ink along (the OpenBoard/GoodNotes behaviour). |
| Protractor | 🟡 Partial | Two‑arm angle annotation with a degree read‑out; not a draggable semicircular protractor you align and read off. |
| Compass | 🟡 Partial | Click‑centre + click‑radius draws a circle annotation; not an interactive compass you set and sweep an arc with. |
| Set square / straightedge snapping | ❌ Missing | No set square; no "snap ink to ruler edge". |
| Geometry constructions | ✅ Done | JSXGraph: point, segment, line, circle, ellipse, angle, perpendicular, parallel — all draggable & persisted. |
| Transformations (reflect/rotate/enlarge/translate) | ❌ Missing | Roadmap item; not exposed. |
| Intersection / midpoint / bisector construction tools | 🟡 Partial | Perp/parallel exist; midpoint, intersection point, angle bisector not exposed as tools. |

**Verdict:** Geometry **constructions** are good (JSXGraph). The **instruments** are functional
measurement helpers but **do not behave like real OpenBoard draggable instruments** — this is a
UX‑fidelity gap to close.

### 2.3 Casio **fx‑991ES PLUS** calculator (must match the photos exactly)

| Aspect | Status | Notes |
|---|---|---|
| Scientific engine | ✅ Done | mathjs: trig (deg/rad), powers/roots, log/ln, π/e, factorial, nCr/nPr, |x|. |
| Complex (CMPLX) | 🟡 Partial | `i` supported and complex results format; but no dedicated CMPLX **mode** with arg/conj/polar↔rect on the keypad. |
| Matrix & Vector | 🟡 Partial | 2×2 matrix (det/inv/transpose/×/+) and 3‑vector dot/cross/|u|/angle via a sub‑panel — limited to 2×2 / fixed sizes. |
| Table mode | ✅ Done | f(x) table generator. |
| S⇔D (fraction/surd display) | ✅ Done | Fraction + surd recognition. |
| **Faceplate layout matching the photos** | ❌ **Missing** | The current keypad is a clean **5‑column generic grid**. The photos are a Casio **fx‑991ES PLUS** with: a round **REPLAY** directional pad; colour‑coded **SHIFT** (yellow) / **ALPHA** (red) secondary labels printed *above* each key; **MODE/SETUP**, **ON**, **CALC**, **∫dx**, **x³**, **√▮**, **x⁻¹**, **logₐ▯**, **hyp**, **ENG**, **(−)**, **°’’’**, **RCL/STO**, **M+**, **×10ˣ**, **Pol/Rec**, **Ran#/RanInt**, **DRG►**, **S⇔D**, etc.; the **natural‑V.P.A.M.** textbook display (the photos literally show ∫ from 0 to π/3 of sin(x) dx = ½). None of this exact geometry/skin exists. |
| MODE menu (COMP/CMPLX/STAT/BASE‑N/EQN/MATRIX/TABLE/VECTOR) | ❌ Missing | No MODE menu; modes are separate sub‑panels, not the Casio menu flow. |
| Equation solver (EQN): simultaneous + quadratic/cubic | ❌ Missing | No SOLVE/EQN. |
| BASE‑N (bin/oct/dec/hex) | ❌ Missing | Not present. |
| Definite/indefinite **∫** and **d/dx** keys | ❌ Missing | The photos show ∫; not wired to a key (engine can do it numerically). |
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
| **Interactive trig teaching** | 🟡 Partial | No **unit‑circle** widget; no **amplitude / period / phase sliders** (roadmap item, not built); no degrees‑axis option for trig graphs. |
| Independent zoomable graphing **view** (GeoGebra‑like) | 🟡 Partial | Functions are drawn onto the page grid (page units), not a dedicated pannable/zoomable graphing surface with auto axis scaling, gridlines, and labels like GeoGebra. |
| Sliders / parameters (a, b, k …) | ❌ Missing | No general slider mechanism. |
| Implicit curves, inequalities, polar, piecewise, domain restriction | ❌ Missing | Not supported. |
| Function analysis (roots, extrema, integral‑area shading) | 🟡 Partial | Tangent + intersection only; no roots/extrema markers or area shading. |

**Verdict:** Good lightweight grapher; **not yet GeoGebra‑class**, and the **trig‑specific**
teaching aids you emphasised (unit circle, sliders) are **missing**.

### 2.5 Statistics (basic drawing / graphing)

| Feature | Status | Notes |
|---|---|---|
| 1‑variable summary (mean/median/sd) | ✅ Done | |
| 2‑variable regression (+ r) | ✅ Done | |
| Histogram, scatter | ✅ Done | via uPlot. |
| Box plot | ❌ Missing | |
| Normal distribution curve + shaded probability | ❌ Missing | Roadmap item. |
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
| Dedicated calculus module | ❌ **Missing** | The single biggest content gap vs. your brief. |
| Tangent at a point | 🟡 Partial | Exists in the grapher. |
| Numerical table of values | ✅ Done | Calculator table. |
| Derivative f′(x) plot / display | ❌ Missing | mathjs can `derivative()` symbolically; not exposed. |
| Definite integral + **area‑under‑curve shading** | ❌ Missing | The fx photo shows ∫; not implemented on board. |
| Riemann sums (rectangles/trapezium) animation | ❌ Missing | |
| Stationary points / inflection markers | ❌ Missing | |
| Indefinite integral / antiderivative display | ❌ Missing | |
| Area between two curves, solids of revolution | ❌ Missing | |
| Differential‑equation slope fields | ❌ Missing | |

**Verdict:** ❌ **"Thorough calculus" is essentially unbuilt.** This deserves its own module
(symbolic via mathjs + visual area/tangent/Riemann tools + calculator ∫ & d/dx keys).

### 2.10 Your logo / branding

| Feature | Status | Notes |
|---|---|---|
| Branding overlay (photo, name, title, phone) | ✅ Done | Uses `assets/waseem.jpg`. |
| A real **logo** mark | 🟡 Partial | `assets/icon.svg` is a generic icon; there is no dedicated brand **logo** used in the app header, launch screen, exports, and (future) portal. Needs a proper logo asset + placement. |

### 2.11 **BrainCert‑style live teaching portal UI**

| Feature | Status | Notes |
|---|---|---|
| Whiteboard canvas | ✅ Done | But framed as a notebook, not a classroom board. |
| **Left vertical tool rail** (pin/unpin, "Close All") | ❌ Missing | Current UI is a **top tabbed toolbar** (Draw/Maths/Page). BrainCert uses a pinnable **left rail**. |
| 16:9 responsive board that renders identically across devices | 🟡 Partial | Pages are A4 portrait; BrainCert is a 16:9 fluid board. |
| Bottom **page/slide tabs** + grouped tools (image/doc/media/polls) bottom‑right | 🟡 Partial | Section/page strips exist but not the BrainCert grouping/placement. |
| **Participants / presence**, raise hand, attendee permissions | ❌ Missing | No multi‑user concept at all. |
| **Live video/audio** (WebRTC), screen share | ❌ Missing | |
| **Real‑time collaboration** (multiple cursors, shared strokes) | ❌ Missing | Single‑user only. |
| Chat, polls, breakout rooms | ❌ Missing | |
| LaTeX editor on board, Wolfram‑style compute | 🟡 Partial | LaTeX equation objects exist; no live compute service. |
| Class scheduling, rooms, recording | ❌ Missing | |

**Verdict:** ❌ The **portal/classroom layer does not exist**. Present mode ≠ a BrainCert
classroom. This is the largest architectural addition (UI shell **and** a backend + realtime +
media stack).

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
| Notebook (pages/tabs/grid/pen/eraser) | ✅ 9/10 | Strong; needs layers, page mgmt UI, large‑media handling. |
| PDF / image import | 🟡 7/10 | Works; large‑media performance + blob storage needed. |
| OpenBoard instruments (ruler/protractor/compass) | 🟡 5/10 | Present as annotations; not draggable physical instruments. |
| Geometry constructions | ✅ 8/10 | JSXGraph solid; add transformations + more constructions. |
| fx‑991ES PLUS calculator | ✅ 8/10 | **Faceplate now matches the photos** + working ∫ / d/dx + MODE menu; full EQN/BASE‑N/STAT mode flow still to add. |
| Graphing (GeoGebra/trig) | 🟡 6/10 | Good basic grapher; no unit circle / sliders / GeoGebra view. |
| Statistics | 🟡 6/10 | Core there; box plot + normal curve missing. |
| Mechanics | ✅ 8/10 | Good coverage; add pulleys/moments + editability. |
| Vectors | ✅ 9/10 | Matches brief. |
| Complex / Argand | ✅ 9/10 | Matches brief; among the best modules. |
| **Calculus** | ✅ 8/10 | **Now built**: derivative + stationary pts, ∫ + area, area between, Riemann, tangent/normal. |
| Logo / branding | ✅ 9/10 | **Logo built** and placed across app/PWA/exports. |
| **BrainCert portal UI** | 🟡 5/10 | **Front‑end layout done** (left rail/app bar/stage); presence/video/realtime still to add. |
| **Live online portal (backend/realtime/media)** | ❌ 1/10 | **Not started**; only a sync stub. |
| Local Mac/iPad usage | ✅ 9/10 | Documented and working. |

**Bottom line:** the **solo offline notebook + A‑level maths tooling is ~70% of your vision and
genuinely good**. The **missing 30% is concentrated in four big rocks**:
1. **Thorough calculus** module.
2. **Pixel‑exact fx‑991ES PLUS** calculator (skin + modes).
3. **BrainCert‑style classroom UI shell**.
4. **The live, multi‑user, hosted portal** (backend + realtime + media + auth + domain).

Plus polish items: real **logo**, OpenBoard **draggable instruments**, **GeoGebra‑grade graphing**
(unit circle/sliders), stats (box/normal), and **large‑media** handling.

These four rocks + polish are what [`ROADMAP-V2.md`](./ROADMAP-V2.md) sequences, on top of the
[`ARCHITECTURE-V2.md`](./ARCHITECTURE-V2.md) redesign.
