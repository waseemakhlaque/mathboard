# MathBoard — Build Roadmap v2 + Hosting Guide (local → live portal)

> Companion to [`ASSESSMENT.md`](./ASSESSMENT.md) (what's missing) and
> [`ARCHITECTURE-V2.md`](./ARCHITECTURE-V2.md) (the redesign that makes this roadmap possible).
>
> This is the **whole roadmap**: (A) the phased build plan to close every gap, (B) how to run it
> **locally on your Mac and iPad**, and (C) how to turn it into an **online, domain‑based, live
> teaching portal**.
>
> Note on timing: phases are sequenced by **dependency and risk**, not calendar dates. Each phase
> ends with a working, shippable app.

---

## Part A — Phased build roadmap

The order is chosen so the **offline notebook never breaks**, the **highest‑value teaching gaps**
land early, and the **portal** is built on a stable base.

> **Progress so far (implemented):**
> - ✅ **Phase 2 — Brand & logo** (gradient MathBoard logo across app/PWA/exports).
> - ✅ **Phase 8 (front‑end) — BrainCert‑style classroom layout** (top app bar + pinnable left
>   tool rail + stage with bottom page tray; pin/unpin + Close All).
> - ✅ **Phase 3 — Thorough calculus module** (f′(x) + stationary points, definite integral +
>   area, area between curves, Riemann sums, tangent/normal).
> - ✅ **Phase 5 — fx‑991ES PLUS calculator** — faithful faceplate + full key set + ∫/d/dx, EQN
>   (2/3 unknown, quadratic, cubic), BASE‑N, Pol/Rec, hyp, STO/RCL/M+, MODE menu.
> - ✅ **Phase 4 (trig part)** — interactive unit circle + amplitude/period/phase/shift sliders.
> - ✅ **Statistics** — box plot + shaded normal‑distribution curve added.
> - ✅ **Font fix** — vendored KaTeX woff2 fonts so MathLive natural display renders correctly.
> - ✅ **Phase 1 polish** — layers panel, large-media blob store, notebook search, page management.
> - ✅ **Phase 4 graphing** — dedicated graph view + trig sliders + unit circle.
> - ✅ **Phase 6** — draggable instruments, geometry transforms + intersection, editable mechanics
>   (pulleys, moments).
> - ✅ **Phase 6.5 — Live AR Studio** — webcam + Three.js + 2D ink (`js/studio/*`).
>
> Still to do below: **online portal** (cloud backend → realtime collab → live A/V).

### Phase 0 — Refactor to core + plug‑ins (foundation)
*Enables everything else; no new features for the user.*
- Add **Vite** (keep an unbundled fallback for solo/offline).
- Extract `core/` (engine, viewport, input, history, document, export) behind the `ToolContext`
  interface (see architecture §4.3).
- Convert existing modules (`geo`, `cplx`, `mech`, `instruments`, grapher, stats, calculator) to
  `register(ctx)` plug‑ins (they already use a `hooks` object → mechanical).
- **Persistence adapter** + a `blobs` store; move PDF/image rasters out of the notebook JSON.
- **Done when:** the current app behaves identically but is modular, and large PDFs import without
  bloating IndexedDB/exports.

### Phase 1 — Notebook polish (close GoodNotes/OneNote gaps) ✅ done
*Done: page duplicate/delete/reorder, section delete, dotted/ruled papers, clear-page (undoable),
place-chart-on-page, layers panel, large-media blob store, search.*
- **Layers** panel + object reordering; **page management** (reorder/duplicate/delete) UI.
- Larger **paper library** (lined/dotted/music/cover) + per‑page grid on/off already exists.
- **Large‑media** handling: lazy PDF page render, size budget, blob storage (from Phase 0).
- Optional: **search** across notes; outline/bookmarks.
- **Done when:** day‑to‑day prep matches GoodNotes feel; big past papers are smooth.

### Phase 2 — Your **logo** + brand system ✅ done
- Add a real **logo** asset (SVG) → app header, PWA icons, launch screen, export footer, and the
  future portal. Make the branding overlay logo‑aware (logo + name + title + phone).
- **Done when:** the logo appears consistently across app, exports, and installable icons.

### Phase 3 — **Thorough calculus** module (biggest content gap) ✅ done
- **Differentiation:** f′(x) plot + value at a point; tangent/normal (extend existing tangent);
  stationary points & inflections marked automatically (mathjs `derivative` + numeric roots).
- **Integration:** definite integral with **shaded area under the curve**; area **between two
  curves**; indefinite/antiderivative display.
- **Riemann sums** (left/right/midpoint/trapezium) with an animated rectangle count slider.
- **Solids of revolution** (visual) and **slope fields** for first‑order ODEs (stretch).
- Wire ∫ and d/dx as first‑class actions (and into the calculator in Phase 5).
- **Done when:** you can teach differentiation + integration visually on a page, with area shading.

### Phase 4 — **GeoGebra‑grade graphing** + trigonometry teaching ✅ done
- A dedicated **graphing view** with auto axis scaling, gridlines/labels, pan/zoom.
- **Sliders / parameters** (a, b, k…) that live‑update curves.
- **Unit‑circle** widget (angle → sin/cos/tan), and **amplitude/period/phase** sliders for trig.
- Degrees‑axis option; roots/extrema markers; (stretch) implicit/inequality/polar/piecewise.
- **Done when:** trig and transformations can be taught interactively, GeoGebra‑style.

### Phase 5 — **Casio fx‑991ES PLUS** calculator (pixel‑exact) ✅ done
- Build the **faceplate skin** to match the photos: casing, solar strip, `CASIO / fx‑991ES PLUS /
  NATURAL‑V.P.A.M.`, round **REPLAY** pad, colour‑coded **SHIFT (yellow) / ALPHA (red)** secondary
  labels above each key, full key grid (`MODE/SETUP, ON, CALC, ∫dx, x³, √▮, x⁻¹, logₐ▯, hyp, ENG,
  (−), °’’’, RCL/STO, M+, ×10ˣ, Pol/Rec, Ran#, DRG►, S⇔D`, …).
- **MODE menu** state machine: COMP · CMPLX · STAT · BASE‑N · EQN · MATRIX · TABLE · VECTOR.
- New engine parity: ∫ & d/dx, EQN (simultaneous + quadratic/cubic), BASE‑N, DMS, Pol/Rec, Ran#,
  constants/conversions; reuse existing MathLive display, S⇔D, table, matrix/vector.
- **Done when:** it looks like the photos and behaves like the device for A‑level use.

### Phase 6 — Instruments + geometry + stats/mechanics finish ✅ done
- **Draggable physical instruments** (OpenBoard‑style ruler/protractor/compass you align and trace
  along, with snap‑to‑edge ink).
- Geometry **transformations** (translate/rotate/reflect/enlarge) + midpoint/intersection/bisector.
- Statistics: **box plot** + **normal‑distribution curve with shaded probability**; place charts as
  page objects.
- Mechanics: make placed diagrams **editable**; add connected particles/pulleys & moments (stretch).
- **Done when:** instruments feel physical and the remaining stats/mechanics items are covered.

### Phase 6.5 — **Live AR Studio Layout** ✅ done
Build the webcam + 3D/AR + annotation compositing studio per **[`AR-STUDIO.md`](./AR-STUDIO.md)**:
single full‑screen `<canvas>` (60 fps) blending getUserMedia video, optional MediaPipe Selfie
Segmentation (chroma/transparent toggle), a vendored **Three.js** scene driven by a
`MathObjectFactory` (helix / 3D vectors / parametric surfaces / rotating solids / grid), and 2D pen
annotations — in a distraction‑free Presentation Window Mode for clean Zoom/Meet screen‑share.
Implemented as vanilla ES modules (`js/studio/*`) to honour the no‑build rule. Requested explicitly
to be delivered **after offline polish and before the online portal**.

### Phase 7 — **Cloud sync** (single‑user, multi‑device) ✅ client done
- Stand up the backend (Supabase recommended): Auth + Postgres + Storage + RLS.
- Implement the **REST persistence adapter** (the stub in `share.js` already targets this shape):
  your notebooks sync across Mac/iPad; blobs go to object storage.
- **Done when:** you log in on any device and see your boards; offline still works and merges on
  reconnect.
- **Implemented:** hybrid local-first sync (`js/share.js` + `js/auth.js`), Edge Function +
  migration SQL, Sync UI with sign-in / merge / background push. Deploy Supabase per
  [`SUPABASE-SETUP.md`](./SUPABASE-SETUP.md).

### Phase 8 — **Classroom shell** (BrainCert‑style UI, single presenter) 🟡 front‑end done
- Build `shells/classroom/`: left pinnable tool rail + "Close All", 16:9 board, bottom page tabs,
  bottom‑right tool group (image/doc/media/polls), top‑right video settings.
- Reuse the **same engine + modules**; add a **board page type** (16:9).
- Still single‑presenter (no students yet) — proves the layout with your real tools.
- **Done when:** you can run a class from the classroom layout (even solo‑recording for YouTube).

### Phase 9 — **Live multi‑user** (real‑time collaboration)
- **Yjs** document bound to the page model + `y-websocket` (or Supabase Realtime/PartyKit/Liveblocks).
- **Awareness**: live cursors with names; shared strokes/objects; Yjs `UndoManager` in rooms.
- **Rooms & roles**: host/student, permissions (who can draw), join links/tokens.
- **Done when:** multiple people see and (if allowed) draw on the same board in real time.

### Phase 10 — **Live A/V classroom** (the full portal)
- **WebRTC SFU** (LiveKit recommended) + **TURN**: instructor + student video/audio, screen share,
  option to keep video strip below the board.
- Attendee settings (host toggles each student's mic/cam/share/whiteboard access), raise‑hand, chat.
- **Recording** to object storage; scheduling/rooms; (later) polls, breakout rooms.
- **Done when:** you schedule a class, students join by link, and you teach live with video + board.

### Phase 11 — Polish & scale
- White‑label branding (your domain + logo), analytics, performance passes, mobile layouts,
  accessibility, and load testing for class sizes.

---

## Part B — Run it **locally on your Mac and iPad** (works today; unchanged by the roadmap)

The current app already runs locally with **no install and no backend**. This is your everyday
teaching/prep setup.

### B.1 On your Mac
```bash
# from the project folder
python3 -m http.server 8080
# then open:
open http://localhost:8080
```
Notes:
- The service worker is **disabled on localhost** (avoids stale‑cache pain in dev) and enabled on a
  LAN IP, so the PWA is offline‑capable on the iPad.
- After the Phase‑0 refactor you'll also be able to run `npm run dev` (Vite) for hot reload and
  `npm run build` to produce the static `dist/` you deploy.

### B.2 On your iPad (same Wi‑Fi as the Mac)
1. Keep the server running on the Mac (command above).
2. Find the Mac's LAN IP: **System Settings → Wi‑Fi → Details → IP address** (e.g. `192.168.1.24`).
3. On the iPad in **Safari**, open `http://192.168.1.24:8080`.
4. **Share → Add to Home Screen** → launch it full‑screen like a native app (offline‑capable).
5. Draw with the **Apple Pencil** (pressure + palm rejection; fingers pan/zoom, Pencil draws).

### B.3 For live class / YouTube from one device
- **macOS Sidecar**: push the MathBoard browser window to the iPad, draw with the Pencil; the tab
  stays on the Mac so you can screen‑share/record it.
- Or **AirPlay / QuickTime** mirroring.
- The **Present mode** (and later the **Classroom shell**) gives a clean, high‑contrast board for
  projector/recording.

### B.4 Fully offline
After the first load on a LAN IP (or once deployed), everything is cached — no internet needed to
teach from a single device. Your boards live in **IndexedDB** on each device; use **Backup/Export
JSON** to move a lesson between devices until cloud sync (Phase 7) lands.

---

## Part C — Convert it into an **online, domain‑based, live portal**

Three increasing levels. You can stop at any level; each is independently useful.

### Level 1 — Static site on your own domain (no backend) — *available now*
Goal: anyone can open MathBoard at `https://yourdomain.com`; still single‑user, local storage.
1. Push this repo to GitHub.
2. Import it on **Vercel** (or Cloudflare Pages / Netlify) — it's detected as a static site
   (`vercel.json` is already included; no build step pre‑refactor, `npm run build` after Phase 0).
3. In the host's dashboard, add your **custom domain** and let it issue **TLS** automatically.
4. Result: a public, installable PWA on your domain. Good for "open the board anywhere" and sharing
   read‑only exports. **No accounts, no live class yet.**

### Level 2 — Accounts + cloud sync (your boards on any device) — *Phase 7*
Goal: log in anywhere and see your notebooks; multi‑device, still single‑user editing.
1. Create a **Supabase** project (Postgres + Auth + Storage + Row‑Level Security).
2. Define tables: `users`, `notebooks` (owner_id, json, updated_at), `blobs` (storage keys),
   later `rooms`. Enable **RLS** so each teacher sees only their own data.
3. Implement the **REST persistence adapter** (the `share.js` provider already targets this shape):
   sign in → boards sync; PDFs/images go to Supabase Storage with signed URLs.
4. Set the API base URL in the app's **Sync settings** (already in the UI).
5. Result: `https://yourdomain.com` with login + your boards everywhere; offline edits merge on
   reconnect.

### Level 3 — **Live teaching portal** (students join, real‑time + video) — *Phases 8–10*
Goal: schedule a class, students open a link, you teach live with a shared board + video.
1. **Realtime collaboration:** add **Yjs** + a sync server (`y-websocket`, or Supabase Realtime /
   PartyKit / Liveblocks). Bind the Yjs doc to the page model; add **awareness** (live cursors,
   names) and room **roles/permissions**.
2. **Rooms & auth:** `rooms` table (host, notebook, schedule, state) + `room_participants`
   (role, permissions). Generate **short‑lived room tokens**; join via `https://yourdomain.com/room/<id>`.
3. **Live A/V:** deploy a **WebRTC SFU** (**LiveKit** self‑host or cloud) + a **TURN** server
   (coturn or managed) for reliable connectivity behind firewalls. Instructor + student
   video/audio, screen share, recording → object storage.
4. **Classroom shell** (Phase 8) becomes the room UI: left rail, 16:9 board, participants/chat,
   attendee mic/cam/share/whiteboard toggles, raise‑hand; video strip optionally below the board.
5. Result: a BrainCert‑class portal on **your** domain, built on the same board engine you use
   offline.

### Suggested hosting stack (managed, low‑ops)
| Layer | Service | Notes |
|---|---|---|
| Front end (PWA build) | **Vercel** or **Cloudflare Pages** | static `dist/`, custom domain + TLS |
| Auth + DB + Storage | **Supabase** | Postgres + Auth + Storage + RLS + Realtime |
| Realtime doc | **Yjs** (`y-websocket`) or Supabase Realtime / PartyKit / Liveblocks | CRDT multi‑writer |
| Live A/V SFU | **LiveKit** (cloud or self‑host) + **coturn** TURN | screen share + recording |
| Domain / DNS / CDN | **Cloudflare** (proxy) | TLS, caching, DDoS protection |

### Cost & ops reality (no time estimates, just scope)
- **Level 1** is effectively free and low‑maintenance.
- **Level 2** adds a managed DB/auth/storage bill that scales with usage; minimal ops with Supabase.
- **Level 3** adds the biggest cost/complexity: **media bandwidth** (SFU + TURN) scales with
  concurrent students, plus recording storage. This is the part that turns a "site" into a
  "platform" — budget for managed LiveKit/TURN or expect real DevOps if self‑hosting.

---

## Part D — Recommended next concrete steps

1. **Approve** this assessment + architecture + roadmap (or tell me what to reprioritise).
2. **Phase 0 + Phase 2** first (modular refactor + your logo) — low risk, unblocks everything and
   gives an immediate visible win.
3. Then pick the highest‑value teaching gap: **Phase 3 (calculus)** or **Phase 5 (fx‑991ES PLUS)**.
4. Go online incrementally: **Level 1 (domain)** now, **Level 2 (sync)** with Phase 7, **Level 3
   (live portal)** with Phases 8–10.

Every phase keeps the **offline Mac/iPad notebook working**, so you can keep teaching while the
portal is built up around it.
