# MathBoard — Technical Spec & Build Roadmap

A fast, pencil-first teaching whiteboard specialised for **A-level vectors and complex numbers**.
Runs in the browser on Mac (M3) and iPad, installs as a PWA, works offline, projects and
screen-records cleanly for YouTube.

> Author context: Waseem Akhlaque — A-level Maths teacher. Pain point: GeoGebra / OneNote /
> GoodNotes / OpenBoard are powerful but too slow to drive live in class for these two topics.
> Goal: one tool where every gesture is tuned for vectors + complex numbers, with proper
> Apple-Pencil annotation on top.

---

## 1. Design principles

1. **Specialised gestures, broad coverage.** It grows into a full A-level maths suite (vectors,
   complex, geometry, trig, stats, mechanics + a scientific calculator), but each topic is a
   self-contained **module** whose gestures are tuned to be *faster than GeoGebra* for that topic.
   We add modules one at a time; we never build a feature until its gestures feel quick in class.
2. **Pencil-first.** Every core action is reachable with the Pencil in hand — no deep menus.
   Target ≤1 tap to switch between pen and the active math tool.
3. **One codebase, two devices.** Web/PWA so the *identical* app runs in Safari on iPad and Mac.
4. **Offline & local.** No server required to teach. Boards saved locally; cloud sync optional later.
5. **Projector & recording friendly.** High-contrast, large hit targets, no tiny UI chrome.

---

## 2. Platform & stack decision

| Layer | Choice | Why |
|---|---|---|
| Delivery | **PWA (installable web app)** | One codebase, iPad + Mac, no App Store, no $99 fee, offline via service worker |
| Language | **Vanilla JS + ES modules** (option to move to **Svelte** later) | Zero build step to start; easy to reason about; fast |
| Drawing surface | **HTML5 Canvas 2D** (two layers) | Simple, fast enough for class; `requestAnimationFrame` redraw |
| Pencil strokes | **perfect-freehand** | Pressure + velocity → natural ink; tiny (~4kb) |
| Input | **Pointer Events** (`pointerType`, `pressure`, `tiltX/Y`) | Unifies pencil/touch/mouse; gives palm-rejection signal |
| PDF import | **PDF.js** | Render exam questions to canvas, annotate over them |
| Math typesetting | **KaTeX** | Crisp `z = 3 + 4i`, `|v|`, arg labels |
| Calculator input | **MathLive** | Natural "textbook" display + on-screen keypad (fx-991-style) |
| Calculator engine | **mathjs** (+ simple-statistics) | All fx-991 maths: trig, complex, matrices, solver, ∫/d, stats/regression |
| Storage | **IndexedDB** (via `idb`) | Boards, imported PDFs, undo history persist offline |
| Packaging | **manifest.json + service worker** | Home-screen install, offline cache |

**Explicitly rejected:** n8n (backend automation, no canvas), Python/Kivy/Tkinter (poor
touch/pencil on iPad), native Swift/PencilKit for v1 (best latency but single-device, needs Xcode
+ developer account — revisit only if pencil latency in Safari proves unacceptable).

**On the Casio fx-991 emulator:** a *real* Casio emulator is **not free or legally embeddable** —
Casio's ClassWiz Emulator is a paid, licensed desktop product and they own the firmware + branding.
Instead we build a **free, legal fx-991-equivalent** scientific calculator: same key groupings,
natural textbook display (MathLive), and every mode (trig, complex/CMPLX, matrices & vectors,
equation solver, numeric ∫ and d/dx, statistics & regression, base-N, DMS, deg/rad/grad) powered by
mathjs. Functionally indistinguishable to students; just not Casio's name/skin.

Hardware: Mac M3 / 18 GB is *vastly* more than enough — this is a browser tab.

---

## 3. Architecture

```
┌─────────────────────────────────────────────┐
│  UI shell (toolbar, color, tool state)        │
├─────────────────────────────────────────────┤
│  Tool controller  (pen / vector / plot / …)   │
├──────────────┬──────────────┬────────────────┤
│  Ink layer   │  Math layer  │  Background     │
│  (freehand)  │ (vectors,    │  (grid / PDF /  │
│              │  points,     │  image)         │
│              │  loci)       │                 │
├──────────────┴──────────────┴────────────────┤
│  Viewport (pan / zoom / world↔screen coords)  │
├─────────────────────────────────────────────┤
│  Document model (JSON) + IndexedDB persistence │
└─────────────────────────────────────────────┘
```

**Layered canvases (key idea):** keep a *background* canvas (grid or imported PDF — redrawn only
on pan/zoom), a *math* canvas (vector/point objects — redrawn on edit), and an *ink* canvas
(freehand — only the active stroke redraws while drawing). This keeps pencil latency low because we
never re-rasterise the PDF on every pointer move.

**Coordinate system:** a single `Viewport {ox, oy, scale}` with `world↔screen` transforms. All
objects stored in *world* (math) coordinates so pan/zoom never distorts saved data.

**Document model — paginated notebooks (GoodNotes-style, serialisable JSON):**
A *notebook* is an ordered list of *pages*; each page is a fixed sheet with a paper template and its
own layers. You flip/scroll between pages and add new ones; export = multi-page PDF.
```jsonc
{
  "version": 1,
  "notebook": { "id": "…", "title": "Vectors — Lesson 3", "cover": "…" },
  "pages": [
    {
      "id": "p1",
      "paper": "graph" | "plain" | "squared" | "cornell" | "argand" | "vectorgrid",
      "size": "A4" | "letter" | "wide",
      "background": { "type": "template" | "pdf" | "image", "ref": "<id>" },
      "layers": {
        "ink":  [ { "color": "#378ADD", "width": 2.5, "pts": [{x,y,pressure}, …] } ],
        "math": [ { "kind": "vector", "from":[0,0], "to":[3,4], "color": "…" },
                  { "kind": "point",  "at":[3,4], "label": "z" } ]
      }
    }
  ]
}
```
**Within a page** there is still a `Viewport {ox, oy, scale}` so you can pinch-zoom into a region,
but the *sheet* is bounded (not endless) — you reach its edge and add the next page, like GoodNotes.
A separate **notebook library** view lists all notebooks/lessons.

---

## 4. File layout

```
mathboard/
├── index.html
├── manifest.json            # PWA install
├── sw.js                    # service worker (offline cache)
├── css/
│   └── app.css
├── js/
│   ├── main.js              # bootstrap, wire UI ↔ controller
│   ├── viewport.js          # pan/zoom + coordinate transforms
│   ├── render.js            # layered canvas draw loop
│   ├── input.js             # pointer events, palm rejection
│   ├── notebook.js          # notebook + pages model, page nav, paper templates
│   ├── tools/
│   │   ├── pen.js           # pen / highlighter
│   │   ├── eraser.js
│   │   ├── lasso.js         # select / move / resize strokes (GoodNotes-style)
│   │   └── select.js
│   ├── model.js             # page model + undo/redo stack
│   ├── storage.js           # IndexedDB: notebooks, pages, imported PDFs
│   ├── pdf.js               # PDF.js import (Phase 2)
│   ├── calculator/          # fx-991-equivalent (later phase)
│   │   ├── keypad.js        # MathLive input + button layout
│   │   └── engine.js        # mathjs eval, modes (cmplx, matrix, stat, solver)
│   └── modules/             # topic tools, one folder each, plug into controller
│       ├── vectors.js       # add, resultant, scalar mult, dot/cross, components
│       ├── complex.js       # modulus, arg, conjugate, multiply/rotate, loci
│       ├── geometry.js      # points/lines/circles, angles, constructions, transforms
│       ├── trig.js          # unit circle, sin/cos/tan graphs, triangle solver
│       ├── stats.js         # data table → histogram/box/scatter + regression, normal curve
│       └── mechanics.js     # force diagrams, resultants, projectile, inclined plane, kinematics
└── assets/icons/
```

---

## 5. Phased roadmap

### Phase 1 — Pen + paginated notebook whiteboard  ← **v1, your priority** ✅
*Goal: the best GoodNotes-style notebook you've used, with rock-solid pencil.*
- [x] Project scaffold, layered canvases, render loop
- [x] Pointer-event input with **palm rejection** (ignore `pointerType:"touch"` while a pencil is
      active; prefer `pointerType:"pen"`)
- [x] **Pen** with pressure → width, **highlighter** (alpha), **eraser**
      (stroke-hit removal), **lasso** select/move
- [x] **Paginated notebook model**: fixed A4 pages with **paper templates** (plain / squared /
      graph / Cornell / Argand / vector grid); add page, flip/scroll pages, page thumbnails
- [x] Pinch-zoom *into* a page; two-finger pan; pencil always draws (never pans)
- [x] Colour palette + width picker; **undo / redo**
- [x] **Notebook library** view (create/rename/open lessons); save to IndexedDB
- [x] **PWA install** + offline; export notebook → multi-page **PDF** / page → PNG
- [x] Test on iPad over local network (`python -m http.server` + your Mac's LAN IP)

**Definition of done:** you can pick up the iPad, create a "Vectors — Lesson 3" notebook, write
across graph-paper pages with the Pencil palm-down, switch colours, lasso-move, undo, add pages,
and export the lesson as a PDF — with no lag and no accidental panning.

### Phase 2 — PDF / image import ✅
- [x] Drag-drop or file-pick a PDF/screenshot of an exam question → becomes a page background
- [x] PDF.js renders page; multi-page import; fit-to-width
- [x] Annotate freely over it; export annotated pages → PDF/PNG
- [ ] Paste image from clipboard (⌘V) — fast for "copied questions"

### Phase 3 — Vectors module ✅
- [x] **Vector tool**: drag to draw arrow; live |v| and direction
- [x] Tip-to-tail **addition** + **resultant**; **scalar multiply** by drag
- [x] **Components** (i/j or column vector) display + toggle
- [x] **Dot / cross** product readout between two selected vectors
- [x] Snap-to-grid + snap-to-integer toggle; angle readout

### Phase 4 — Complex / Argand module ✅
- [x] **Plot z** = a+bi; modulus line, **arg** arc with degrees/radians toggle
- [x] **Conjugate**, **negation**, **multiply by w** (show rotation + scaling visually)
- [x] **Loci**: |z−a|=r circles, |z−a|=|z−b| perpendicular bisector, arg(z−a)=θ half-lines
- [x] Polar ↔ Cartesian toggle; KaTeX labels

### Phase 5 — Geometry module ✅ (transformations still stretch)
- [x] Points / lines / segments / circles / polygons; drag to edit
- [x] Measure **angle** and **length**; parallel/perpendicular helpers
- [x] Constructions (midpoint, bisector, intersection); transformations (translate/rotate/
      reflect/enlarge) — midpoint/bisectors done; full shape transforms still to add

### Phase 6 — Trigonometry module ✅
- [x] Interactive **unit circle** (angle → sin/cos/tan readout)
- [x] Graph **sin/cos/tan** with amplitude/period/phase sliders
- [ ] **Triangle solver** (SSS/SAS/ASA, sine & cosine rule)

### Phase 7 — Statistics module ✅
- [x] Data **table** entry; **histogram / box plot / scatter**
- [x] **Regression** line + r; mean/median/sd readouts
- [x] **Normal distribution** curve with shaded probability

### Phase 8 — Mechanics module ✅ (editability stretch)
- [x] **Force diagrams** + resultant / equilibrium
- [x] **Projectile** motion (launch angle/speed → trajectory)
- [x] **Inclined plane**, friction; **kinematics** graphs (s-t, v-t, a-t)

### Phase 9 — fx-991-equivalent calculator ✅
- [x] Dockable scientific calculator with **natural display** (MathLive) + fx-991-style keypad
- [x] Modes: standard, **complex (CMPLX)**, **matrix/vector**, **equation solver**, numeric
      **∫ and d/dx**, **statistics/regression**, **base-N**, DMS, deg/rad/grad
- [x] History tape; insert result onto the current page

### Phase 10 — Polish & sharing 🟡
- [x] Lesson notebook templates; quick screen-record helper notes for YouTube
- [x] Stroke-replay / animate mode for YouTube explainers (live demo bar)
- [ ] Optional cloud sync (Supabase/Firebase) for boards across devices

---

## 6. Apple Pencil specifics (the make-or-break detail)

- Use **Pointer Events**, not Touch Events. `e.pointerType === "pen"` identifies the Pencil;
  `e.pressure` (0–1) drives stroke width; `e.tiltX/tiltY` optional for shading.
- **Palm rejection:** when a `pen` pointer is down, ignore all `touch` pointers for drawing; route
  two-finger `touch` gestures to pan/zoom only.
- Set `touch-action: none` on the canvas and `e.preventDefault()` so Safari doesn't scroll/zoom the
  page under you.
- Use `requestAnimationFrame` and only redraw the **ink** layer mid-stroke (cache background + math
  layers as bitmaps) to keep latency low.
- Apple Pencil hover (Pencil Pro / M-series iPad) can preview cursor — nice-to-have, not v1.

---

## 7. How we'll test on your iPad

1. Run a dev server on the Mac: `python3 -m http.server 5173` (or `vite`) inside `mathboard/`.
2. Find the Mac's LAN IP (System Settings → Wi-Fi → Details).
3. On the iPad Safari: `http://<mac-ip>:5173` — same Wi-Fi network.
4. Share → **Add to Home Screen** to install as a PWA and test full-screen, offline, pencil.
5. Iterate: edit on Mac, refresh iPad.

For class/projector: open the installed PWA full-screen; AirPlay or cable to projector; QuickTime
or iPad screen-record for YouTube.

---

## 8. Open questions for later

- Cloud sync & multi-device board library — needed, or local-only is fine?
- Shareable read-only board links for students?
- Handwriting → typed-equation recognition (big feature; probably not worth it).
- Do you want a "replay/animate strokes" mode for YouTube explainers?

---

## 9. Immediate next action

Phases 1–9 of the original notebook roadmap are **complete**. Continue with
[`ROADMAP-V2.md`](./ROADMAP-V2.md) for the next priorities: large-media handling, draggable
instruments, live AR studio, and the online teaching portal (cloud sync → realtime → live A/V).
Deploy the static site via GitHub Pages (`.github/workflows/pages.yml`) or Vercel.
