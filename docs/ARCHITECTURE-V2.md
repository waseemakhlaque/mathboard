# MathBoard — Redesigned Architecture (v2)

> Companion to [`ASSESSMENT.md`](./ASSESSMENT.md) (the gap analysis) and
> [`ROADMAP-V2.md`](./ROADMAP-V2.md) (the build + hosting plan).
>
> Goal of this redesign: keep everything that already works well (the offline, pencil‑first
> notebook), make every topic a **true plug‑in module**, reach **pixel‑fidelity** where you asked
> for it (the fx‑991ES PLUS, the BrainCert classroom shell), and add a **clean seam** so the same
> board can run **solo‑offline on your Mac/iPad** *and* **live, multi‑user, on a hosted domain**.

---

## 1. Design goals (what drives every decision below)

1. **Don't throw away v1.** The canvas engine, document model, modules, and offline PWA are good.
   We **refactor into a core + plugins**, not a rewrite.
2. **One document model, three runtimes:** the *same* notebook JSON powers
   (a) **solo offline**, (b) **single‑user cloud sync**, (c) **live collaborative room**.
3. **Two front‑end "shells", one engine:** a **Notebook shell** (GoodNotes/OneNote feel, your
   daily prep) and a **Classroom shell** (BrainCert feel, live teaching). Both mount the *same*
   board engine and tools.
4. **Fidelity where it matters.** The **fx‑991ES PLUS** and the **classroom UI** are skinned to
   match references; internal modules stay pragmatic.
5. **Offline‑first stays sacred** for solo mode. The live portal is **additive**, never a
   requirement to teach from a single device.
6. **Introduce a build step deliberately and only when it pays for itself** (collaboration, auth,
   bundling many modules). Solo mode can still ship as static files.

---

## 2. The big architectural decision: vanilla‑static vs. build‑step

Today's golden rule is "vanilla only, no build, no backend." That is perfect for a solo offline
notebook but **cannot deliver** real‑time multi‑user video classes. The redesign resolves this
with a **split**:

| Mode | Front end | Backend | Build |
|---|---|---|---|
| **Solo / offline** (Mac, iPad) | Static PWA (today's app, refactored) | none (IndexedDB) | optional |
| **Cloud sync** (your boards on any device) | Same PWA | thin API + DB + object storage | yes (shared) |
| **Live classroom** (teach students online) | Classroom shell | API + **realtime** + **media (WebRTC)** + auth | yes |

**Recommendation:** adopt **Vite** as a zero‑config bundler and **TypeScript (optional, gradual)**
so we can pull in collaboration libraries (Yjs) and share code across shells — **while still being
able to output a static build** for solo/offline. This keeps the "serve it from anywhere" spirit
and unlocks the portal. (If you want to stay 100% no‑build for solo mode, we keep `index.html` as
a no‑bundle entry and only the portal uses the bundler — documented as a fallback.)

---

## 3. Target system diagram

```
                         ┌──────────────────────────────────────────────────────────┐
                         │                       CLIENTS                              │
                         │                                                            │
   Solo (offline)        │   Notebook shell (PWA)         Classroom shell (PWA)       │
   Mac / iPad  ◀────────▶│   ┌───────────────────────────────────────────────────┐  │
                         │   │             BOARD ENGINE (shared core)              │  │
                         │   │  viewport · render loop · input/pencil · doc model  │  │
                         │   │  tools registry · undo/redo · export                │  │
                         │   ├───────────────────────────────────────────────────┤  │
                         │   │  PLUG-IN MODULES (lazy-loaded)                      │  │
                         │   │  pen geometry instruments vectors complex calculus  │  │
                         │   │  graphing trig stats mechanics calculator(fx-991)   │  │
                         │   ├───────────────────────────────────────────────────┤  │
                         │   │  PERSISTENCE ADAPTER (one interface, 3 backends)    │  │
                         │   │   IndexedDB  │  REST sync  │  Realtime (Yjs/CRDT)   │  │
                         │   └───────┬───────────────┬───────────────────┬────────┘  │
                         └───────────┼───────────────┼───────────────────┼───────────┘
                                     │ offline        │ https             │ wss / webrtc
                                     ▼                ▼                   ▼
                              (local only)   ┌───────────────────────────────────────┐
                                             │              BACKEND                    │
                                             │  API (REST/GraphQL)   Auth (JWT/OAuth)  │
                                             │  Realtime hub (WebSocket / Yjs server)  │
                                             │  Media SFU (WebRTC) + TURN              │
                                             │  Postgres (notebooks, users, rooms)     │
                                             │  Object storage (PDFs, images, recordings)│
                                             └───────────────────────────────────────┘
```

---

## 4. Front‑end architecture (refactor of today's `js/app.js`)

### 4.1 Problem with v1 structure
`js/app.js` is ~2,700 lines holding state, rendering, every tool, all panels, calculator, stats,
grapher, and UI wiring. It works, but it's hard to extend to two shells and a plugin system.

### 4.2 Target module layout

```
src/
├── core/
│   ├── engine.ts            # board lifecycle, render loop (rAF), layered canvases
│   ├── viewport.ts          # world↔screen, pan/zoom, A4 page + (new) 16:9 board mode
│   ├── input.ts             # pointer events, pencil/palm rejection, gestures
│   ├── document.ts          # notebook/section/page model (from js/model.js) + migrations
│   ├── history.ts           # undo/redo (snapshot + future: CRDT-aware)
│   ├── tools.ts             # Tool registry + ToolContext (plug-ins register here)
│   └── export.ts            # PNG / PDF / JSON
├── persistence/
│   ├── adapter.ts           # interface: load/save/list/subscribe
│   ├── indexeddb.ts         # solo offline (from js/storage.js)
│   ├── rest.ts              # cloud sync (from js/share.js provider)
│   └── realtime.ts          # Yjs doc <-> page model binding (live rooms)
├── modules/                 # each is a self-contained plug-in (register() on load)
│   ├── pen/   eraser/  shapes/  text/  equation/
│   ├── instruments/         # ruler, protractor, compass — upgraded to DRAGGABLE tools
│   ├── geometry/            # JSXGraph wrapper + transformations
│   ├── vectors/  complex/   # (today's strong modules)
│   ├── graphing/            # GeoGebra-style view + trig (unit circle, sliders)
│   ├── calculus/            # NEW: derivative, integral+area, Riemann, stationary pts
│   ├── statistics/          # + box plot, normal curve
│   ├── mechanics/
│   └── calculator/          # fx-991ES PLUS skin + modes (its own folder, see §6)
├── shells/
│   ├── notebook/            # GoodNotes/OneNote-style UI (today's editor, restyled)
│   └── classroom/           # BrainCert-style UI (left rail, presence, video) — see §7
├── collab/
│   ├── awareness.ts         # cursors, names, selection presence
│   └── room.ts              # join/leave, roles (host/student), permissions
├── branding/                # logo asset + overlay (configurable)
└── main.ts                  # boots the right shell based on route (/ vs /room/:id)
```

### 4.3 The plug‑in contract (so modules stop bloating one file)

Every module exports a `register(ctx)` and is **lazy‑loaded** when its tab/tool is first used:

```ts
export interface ToolContext {
  page(): Page;                        // current page model
  beginAction(): void;                 // undo snapshot start
  commitAction(): void;                // commit + persist (debounced)
  toPage(x: number, y: number): Pt;    // screen → page units
  snapPt(p: Pt): Pt;                   // grid snap
  requestRender(): void;
  registerTool(tool: Tool): void;      // adds a toolbar entry + pointer handlers
  registerLayer(draw: (c, page) => void): void; // adds to the render loop
}
```

This formalises the ad‑hoc `hooks = {}` pattern already used in `geo.js`, `mech.js`, `cplx.js`,
`instruments.js` — so the refactor is **mechanical, low‑risk**, and each existing module slots in
with minimal changes.

### 4.4 Rendering: add a 16:9 "board" page type
Keep A4 pages for the notebook. Add a **16:9 board** page type for the classroom shell (BrainCert
is a 16:9 fluid board so content lands on the same pixel across devices). Both share the same
viewport/world‑coordinate math; only the page bounds + default paper differ.

---

## 5. Document model & persistence (one model, three backends)

### 5.1 Model (evolve `js/model.js`)
Keep the portable schema: `notebook → sections[] → pages[]`, each page carrying
`strokes, objects, functions, geoItems, mechItems, cplxLoci, instruments` (+ new `calculusItems`,
`statItems`, `mediaRefs`). Bump `FORMAT_VERSION` with a migration (the code already has the
migration pattern). **Change:** large media (PDF page rasters, images) move **out of the JSON**
into a `blobs` store keyed by id (`mediaRefs: [{id, kind, w, h}]`) — fixes the large‑PDF bloat
flagged in the assessment.

### 5.2 Persistence adapter (single interface)
```ts
interface Persistence {
  list(): Promise<NotebookMeta[]>;
  load(id): Promise<Notebook>;
  save(nb): Promise<void>;
  loadBlob(id): Promise<Blob>;  saveBlob(id, blob): Promise<void>;
  subscribe?(id, onChange): Unsubscribe;   // realtime only
}
```
- **IndexedDB** (solo): today's `storage.js`, extended with a `blobs` store.
- **REST** (cloud sync): today's `share.js` provider, fronted by the new API.
- **Realtime** (live room): a **Yjs** document mirrors the page model; the SFU/relay broadcasts
  ops; awareness carries cursors/selection. Undo/redo becomes Yjs `UndoManager` in rooms.

**Why Yjs (CRDT) over naive op‑broadcast:** conflict‑free multi‑writer editing, offline‑then‑merge,
and built‑in awareness — exactly the BrainCert "multiple people draw at once" behaviour, without a
custom OT server.

---

## 6. The fx‑991ES PLUS calculator (fidelity sub‑architecture)

Make it a self‑contained module `modules/calculator/` with:

```
calculator/
├── faceplate.html/.css      # pixel-faithful Casio fx-991ES PLUS skin:
│                            #  - body + solar strip + "CASIO / fx-991ES PLUS / NATURAL-V.P.A.M."
│                            #  - ROUND REPLAY directional pad
│                            #  - SHIFT (yellow) / ALPHA (red) colour-coded secondary labels above keys
│                            #  - full key grid: MODE/SETUP, ON, CALC, ∫dx, x³, √▮, x⁻¹, logₐ▯,
│                            #    hyp, ENG, (−), °’’’, RCL/STO, M+, ×10ˣ, Pol/Rec, Ran#, DRG►, S⇔D…
├── display.ts               # Natural textbook display (MathLive) incl. ∫, Σ, fractions, surds
├── engine.ts                # mathjs wrapper
├── modes.ts                 # MODE menu state machine:
│                            #  COMP · CMPLX · STAT · BASE-N · EQN · MATRIX · TABLE · VECTOR
└── keymap.ts                # maps every physical key (+ SHIFT/ALPHA layer) to an action
```

Key points:
- **Skin first, then wire modes.** The faceplate is HTML/CSS positioned to match the photo; each
  printed key has a primary + colour‑coded secondary label.
- **MODE menu** drives a state machine mirroring the real calculator (the manual confirms the 8
  modes: COMP, CMPLX, STAT, BASE‑N, EQN, MATRIX, TABLE, VECTOR).
- **New engine features to reach parity:** definite/indefinite ∫ and d/dx (numeric + mathjs
  `derivative`), EQN (simultaneous 2/3‑unknown, quadratic/cubic), BASE‑N, DMS (°’’’), Pol/Rec,
  Ran#/RanInt, constants/conversions, STAT mode reusing the statistics module's math.
- Reuse today's working bits: MathLive display, S⇔D fraction/surd, table mode, matrix/vector.

---

## 7. The BrainCert‑style classroom shell (UI sub‑architecture)

`shells/classroom/` renders the live layout (verified against BrainCert's current design):

- **Left vertical tool rail**, **pin/unpin**, and a **"Close All"** that hides panels but keeps the
  rail. Tools: select, pencil, highlighter, shapes/lines, text, eraser, LaTeX, and our maths tools.
- **16:9 responsive board** so content appears at the same position/pixel on phone/web/tablet.
- **Bottom**: page/slide tabs; **bottom‑right group**: image tool, document reader (PDF/PPT/etc.),
  media player, polls.
- **Top‑right**: video settings; **bottom‑right**: attendee settings (host can toggle each
  student's mic/cam/screen‑share/whiteboard access).
- **Presence overlay**: live cursors with names (from `collab/awareness.ts`).
- **Video**: instructor + students via WebRTC SFU; option to keep video strip **below** the board.
- **Right/side panel**: chat, participants, raise‑hand, breakout rooms (later).

The classroom shell **mounts the same board engine + modules** as the notebook shell — so a lesson
you prepared offline opens identically in a live room, and every maths tool works live.

---

## 8. Backend architecture (for cloud sync + live portal)

Keep it boring and managed where possible:

| Concern | Recommended | Alternatives |
|---|---|---|
| API + Auth + DB + storage | **Supabase** (Postgres + Auth + Storage + Row‑Level Security + Realtime) | Firebase; or custom Node (Fastify) + Postgres (Neon) + S3/R2 |
| Realtime doc sync | **Yjs** + `y-websocket` server (or Supabase Realtime / Liveblocks / PartyKit) | Custom WS hub |
| Live A/V + screen share | **WebRTC SFU**: LiveKit (self‑host or cloud), Daily, or Agora; **TURN** via coturn/managed | Jitsi |
| Recording | SFU‑side recording → object storage | client MediaRecorder (basic) |
| Front‑end hosting | **Vercel / Cloudflare Pages** (static build of the PWA) | Netlify |
| Domain + TLS | Your domain on the host's DNS + automatic TLS | Cloudflare proxy |

Data model (Postgres): `users`, `notebooks`(owner, json/blob refs, updated_at), `blobs`(object‑store
keys), `rooms`(host, notebook_id, schedule, state), `room_participants`(role, permissions),
`recordings`. RLS so a teacher only sees their own boards; room tokens grant scoped access to
students.

**Security:** JWT/short‑lived room tokens; per‑room permissions (who can draw); signed URLs for
blob access; rate limits on sync; never trust client‑sent roles.

---

## 9. How the three runtimes share code (the key payoff)

```
        ┌─────────────── same Board Engine + Modules ───────────────┐
Solo →  │  Notebook shell  + IndexedDB adapter                       │  (offline, no server)
Sync →  │  Notebook shell  + REST adapter (Supabase)                 │  (your boards anywhere)
Live →  │  Classroom shell + Realtime(Yjs) adapter + WebRTC + Auth   │  (teach students online)
        └────────────────────────────────────────────────────────────┘
```

A page's `draw()` and a tool's pointer handlers **never know** which adapter is underneath. That is
what lets you build once and ship solo today, sync next, and live‑teach last — without rewrites.

---

## 10. Migration path (low‑risk, incremental — no big‑bang rewrite)

1. **Introduce Vite** alongside the current static entry; app still runs unbundled for solo.
2. **Extract `core/`** from `app.js` (engine, viewport, input, history, document, export) behind the
   `ToolContext` interface — existing modules already use a `hooks` object, so this is mechanical.
3. **Convert each existing module** (`pen`, `geo`, `cplx`, `mech`, `instruments`, grapher, stats,
   calculator) to `register(ctx)` plug‑ins. No behaviour change.
4. **Persistence adapter**: wrap `storage.js`/`share.js`; add a `blobs` store and move PDF/image
   rasters out of the JSON.
5. **Build the four big rocks** (calculus module, fx‑991ES PLUS skin+modes, classroom shell,
   backend+realtime+media) per [`ROADMAP-V2.md`](./ROADMAP-V2.md).
6. **Keep the offline PWA working at every step** (it's your daily teaching tool).

Each step ends with a working app; nothing is removed until its replacement is verified.
