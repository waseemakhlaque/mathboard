# Prompt for Cline — Fix Calculator (991 ES) + Geometry Tool + PDF Upload Glitches

Paste this into Cline as-is.

---

Read `CLAUDE.md` in full before doing anything else — it has hard constraints (vanilla JS only, don't touch the ink hot path, version-bump protocol) that override default behavior. Also read `CLINE-QA-REMAINING.md`, which is the authoritative current bug list and may already cover some of this.

## Task

Three areas are broken in real classroom use and need a full audit + fix pass, not spot patches:

**1. Calculator (991 ES emulator, `js/app.js` calculator section)**
It is not behaving like a real Casio fx-991ES. Specifically investigate and fix:
- Display mode switching: 0=Decimal, 1=Fraction, 2=mixed a b/c, 3=√(surd) — confirm each mode computes and renders correctly, and that SHIFT+S toggles mixed⇔improper fraction correctly.
- Keypad input via `calcQuietFocus` — confirm programmatic focus never opens the MathLive virtual keyboard (known past bug).
- `.calc-vk-active` must not hide `.calc-sub` — check this interaction still holds.
- Check core arithmetic precedence, fraction simplification, surd simplification, and any scientific functions (trig, powers, roots, memory) users report as wrong — reproduce with a set of known-answer test inputs (e.g. `1/3 + 1/6` should give `1/2`, `√12` should simplify to `2√3`, etc.) and fix any that don't match a real fx-991ES.
- Note in `CLAUDE.md`: this has had lock-out bugs before — check `entitlement.js` / `gate.js` interactions aren't blocking calc state.

**2. Geometry tools (`js/geo.js`, `js/instruments.js`)**
Users can't use ruler/protractor/compass/JSXGraph geometry reliably. Investigate and fix:
- `js/instruments.js` is mid-rewrite (OpenBoard-style, schema `{x,y,length/radius,rotation}`) per `CLAUDE.md` "Current state" — check `git status`/`git log` first to see what's actually committed vs. still dirty in the working tree, and finish/stabilize this rewrite per the acceptance criteria in `CLINE-QA-REMAINING.md` (toolbar toggle, stale hints, legacy-schema migration on load, `syncInstButtonState` wiring).
- Known do-not-reintroduce bugs to verify are still fixed: instrument gate (`isDrawPointer()` must be false while an instrument is armed — onDown early-return needs `&& !instToolActive()`), and `objHit` must dispatch by object kind (treating `equation` like a line via `o.from/o.to` caused a production crash before).
- Test drag, rotate, and resize handles on all three instruments; test compass committing ink arcs correctly.
- Test JSXGraph perpendicular/parallel line construction — confirm parent ids persist correctly as strings across save/reload, and `boardPageId` matches the current page id before `dumpGeoItems()` (cross-page contamination bug, fixed in v120 — verify it stays fixed).
- Run `sanitizeGeoItems` against a notebook that has old/corrupt geo data and confirm it skips-and-continues rather than throwing.

**3. Large PDF upload/open fails (`js/pdfPages.js`, `js/storage.js`)**
On the live iPad app, opening/adding a large PDF as a page background throws `Unexpected error: The PDF file is empty, i.e. its size is zero bytes. (pdf.min.js:22)` — screenshot shows this on waseemonline.com, PDF pages panel at the bottom with a stuck/empty page 28. Investigate and fix:
- Reproduce with a genuinely large PDF (tens of MB) on iPad Safari — this smells like the Safari blob-eviction issue `CLAUDE.md` already flags as in-progress self-heal work in `pdfPages.js`/`storage.js`. Check whether the self-heal logic is actually catching this case or whether the blob is getting evicted/truncated before the self-heal reads it back.
- Check whether the PDF is being read from IndexedDB (`storage.js` blobs store) vs. still in-flight from the original file input/fetch — a zero-byte read strongly suggests the Blob reference is stale or the write hadn't flushed before the read (note `persist()` is idle-deferred with an 800ms debounce elsewhere in the app; check if something analogous applies to blob writes here).
- Check the /content/* size ceiling noted in `CLAUDE.md` (Workers asset size limit, currently mitigated by ghostscript-compressing books below 24MiB, R2 not enabled) — confirm whether this specific failure is a *user-uploaded* PDF going through `storage.js`/IndexedDB (separate path, no 24MiB Workers ceiling) or is actually hitting `/content/*`. Don't conflate the two paths; fix the one that's actually broken.
- Confirm the fix handles both: (a) first-time upload of a large PDF, and (b) reopening a notebook later where the large-PDF blob may have been evicted by Safari's storage pressure — both need to either load correctly or fail with a clear, non-crashing message (per constraint #4: corrupt/missing data must skip-and-continue, never throw an unhandled error into `#boot-error` without a clear explanation).
- Test on Playwright WebKit iPad emulation with `launchPersistentContext` (required — ephemeral contexts can't persist Blobs to IndexedDB, per `CLAUDE.md`).

## Method (follow `CLAUDE.md`'s debugging playbook)

1. Reproduce first. Use Playwright WebKit with `devices['iPad Pro 11 landscape']` — desktop Chrome often does not reproduce iPad bugs. Use `launchPersistentContext` (ephemeral contexts can't persist Blobs to IndexedDB).
2. For any crash, get the exact `(file:line)` from the `#boot-error` banner stack frame — don't guess at root cause.
3. Prefer minimal targeted fixes over refactors. Do not propose a rewrite of instruments.js beyond finishing the in-progress OpenBoard-style schema — that architecture decision is locked in.
4. Harden the data path: assume existing IndexedDB notebooks carry pre-fix corrupt geo/instrument data — add idempotent migration in `normalizePage`, not just in the new writer.
5. Do NOT touch the ink hot path (`onDown`/`onMove`, `pointerrawupdate`, `appendInkPoints`, `drawStrokePreview`, ink snapshot blit) — none of this task should require it. If you think it does, stop and explain why before changing it.
6. All mutating gestures (instrument drag/resize/rotate, calc state changes) must go through `beginAction()`/`commitAction()` for undo/redo — except ink strokes, which are excluded per constraint #2.
7. When done, bump all four version markers together (`APP_VERSION` in app.js, `?v=N` in index.html ×4 spots, `CACHE` in sw.js) per the version-bump protocol.
8. Verify: local browser test, then Playwright WebKit iPad test, then report a clear before/after summary in plain language (the project owner is non-technical) — do not just say "fixed," show what specific input/action now produces the correct result.
9. Do not deploy. Leave the working tree ready for review; the owner will ask for deploy separately.

## Deliverable

A list of every distinct bug found (calculator, geometry, and PDF upload — separately), the root cause of each, the fix applied, and how it was verified — in plain language, no jargon dump. Update `CLINE-QA-REMAINING.md` to reflect what's now resolved vs. still open.
