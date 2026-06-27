# Cline task — debug, polish, and launch MathBoard

Paste this entire file into **Cline** (VS Code) as your task prompt. Work in the repo root:
`~/Downloads/outputs/mathboard` (or your clone path).

---

## What MathBoard is

A **single static PWA** for teaching A-level maths: vanilla ES-module JS + HTML5 Canvas, **no build
step**, all libraries vendored in `vendor/`. Entry: `index.html`, main logic `js/app.js`. State in
IndexedDB (`js/storage.js`), schema `js/model.js` (format v2).

**Run locally:**
```bash
cd mathboard
# if port busy: lsof -i :8080 && kill <PID>
python3 -m http.server 8080
```
Open **http://127.0.0.1:8080** — hard refresh **Cmd+Shift+R** after edits.

**Hard rules (do NOT break):**
- Vanilla JS only — no React/Vue, no TypeScript, no bundler for the static app.
- No runtime CDN `<script>` tags — vendor libs into `vendor/`.
- Never commit secrets — `config.local.js` is gitignored.
- Preserve notebook schema + migrations in `js/model.js`; never break old saves.
- Wrap mutating gestures in `beginAction()` / `commitAction()` for undo/redo.
- After editing `css/app.css` or `js/app.js`: bump `?v=N` in `index.html` **and**
  `CACHE = 'mathboard-vN'` in `sw.js`; add new JS files to `sw.js` ASSETS list.
- Test in a real browser with DevTools open — **zero uncaught errors** on flows you touch.

Read first: `CURSOR-TASK.md`, `docs/ASSESSMENT.md`, `docs/ROADMAP-V2.md`.

---

## Already done (verify only — do not re-implement)

- ✅ Notebook create/open/import with loud error handling + global `unhandledrejection` handler
- ✅ `sections()` null-safe + `pages()`/`page()` tolerate empty
- ✅ AR Studio camera 10 s timeout + teardown (`js/studio/studioManager.js`)
- ✅ MathLive: direct `mf.smartMode` / `mf.smartFence` (no `setOptions`)
- ✅ Three.js pinned to r149 (`vendor/three.min.js`) — no deprecation warning
- ✅ Lazy PDF import (`js/pdfPages.js`) — one PDF blob, pages render on demand
- ✅ Draggable instruments + snap-to-ruler ink (`js/instruments.js`)
- ✅ Trig: unit circle, amp/period/phase sliders, **° axis** toggle, graph view roots/extrema
- ✅ fx-991ES calculator faceplate + MODE / ∫ / d/dx / EQN / BASE-N
- ✅ Calculus module, layers, blob store, Supabase sync client, Yjs collab scaffold
- ✅ `docs/ASSESSMENT.md` reconciled with code
- ✅ **(2026-06-27 verify pass, app at v74)** Live-verified A1–A5 above + all 10 module panels open
  with zero console errors. Fixed two more: **exportPDF** now writes JPEG q0.92 (was lossless PNG →
  22 MB for a single page; now ~250 KB) and **drawStroke/strokeBBox/hitStroke/finishLasso** guard
  against strokes with no `points` array (a malformed in-memory stroke threw every render frame and
  flooded the error banner). Don't redo these. Current cache version is **v74**.

---

## Your job — fix remaining bugs, polish, launch-ready

Work in priority order. **One focused change-set per item**, verify in browser, bump cache version.

### P0 — Launch blockers (must pass before deploy)

1. **Fresh-profile smoke test**  
   Clear site data → load app → **+ New lesson** → draw → add equation → open every panel
   (Layers, f(x), Calculus, Symbolic, Algebra, Fractions, Stats, Calculator, Mechanics,
   Complex, Instruments, AR Studio) → export PNG + PDF → reload. **Zero console errors.**

2. **PDF import/export round-trip**  
   Import a 10–20 page PDF → confirm notebook JSON stays small (blob refs, not inline JPEG) →
   annotate on page 1 and last page → export PDF → pages render correctly.

3. **Optional `config.local.js`**  
   On a clone without `config.local.js`, confirm **no red boot banner** and no spurious errors
   (404 on optional script is OK). Document: `cp config.example.js config.local.js` for cloud sync.

4. **Service worker / PWA offline**  
   Serve from LAN IP (not localhost) → install to home screen → airplane mode → app still opens.
   Confirm `sw.js` ASSETS includes every `js/*.js` module the app imports.

5. **Deploy checklist**  
   - GitHub Pages / Vercel: static root, no build command  
   - `manifest.json` icons resolve  
   - `config.js` has empty URLs (solo mode safe)  
   - Write or update `docs/LAUNCH.md` with pre-flight steps

### P1 — Known polish gaps

6. **Google Fonts offline** — `index.html` loads Inter from fonts.googleapis.com; either vendor
   woff2 into `vendor/fonts/` or accept online-only for first load and document it.

7. **Statistics charts on page** — box plot / normal curve render in panel but **place-as-page-object**
   not fully wired (`docs/ASSESSMENT.md` §2.5).

8. **Collab end-to-end** — with `collab-server` running and `collabServerUrl` set (non-localhost):
   two browsers same `?room=test` → strokes sync live; presence cursors; timeout shows Offline
   not infinite Connecting. See `docs/SUPABASE-SETUP.md` § Live collaboration.

9. **Collab scope** — today only **strokes** sync; extend Yjs map for `objects` / geo items (stretch).

10. **Calculator STAT-in-device** — stats live in separate panel, not true Casio STAT mode (minor).

11. **README / docs** — keep port numbers consistent (8080 default); link `CLINE-TASK.md` and
    `docs/SUPABASE-SETUP.md`.

### P2 — Post-launch (Phase 10 — do NOT block v1 launch)

- WebRTC A/V classroom (LiveKit + TURN)
- Room scheduling, recording, chat, polls
- Cloud blob upload for PDFs (Supabase Storage)
- General expression sliders (beyond trig transforms)
- Handwriting-to-text, infinite canvas

---

## Debugging workflow for Cline

1. Start server from **project folder** (not `~`):
   ```bash
   cd ~/Downloads/outputs/mathboard && python3 -m http.server 8080
   ```
2. If `Address already in use`: `lsof -i :8080` then `kill <PID>` or use port `8081`.
3. Use Chrome DevTools → Console + Application → IndexedDB `mathboard`.
4. After each fix: hard refresh, re-run the smoke test for that flow.
5. Match existing code style: small helpers, terse comments, `const`-first.

---

## Acceptance — project is “launch ready” when

- [ ] P0 smoke test passes on Chrome + Safari (Mac)
- [ ] iPad LAN install works (Add to Home Screen, Pencil draws)
- [ ] GitHub Pages or Vercel deploy succeeds with zero console errors on first load
- [ ] `docs/LAUNCH.md` exists with copy-paste deploy steps
- [ ] No secrets in git; `config.local.js` remains gitignored

When done, summarize: files changed, cache version, what you verified, and any P1/P2 items left.
