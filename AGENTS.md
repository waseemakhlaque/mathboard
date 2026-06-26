# AGENTS.md

## Cursor Cloud specific instructions

MathBoard is a **single static web app** (vanilla HTML/CSS/JS, ES modules, no framework,
no build step, no backend). All third-party libraries are vendored locally in `vendor/`, and
persistence is IndexedDB only. There is **no `package.json`, no bundler, and no automated
test/lint suite** — so there is nothing to compile and no `npm`/`pnpm` install step.

### Running the app (development)
- Serve the repo root with a static server and open it in a real browser:
  `python3 -m http.server 8080` → http://localhost:8080
- `python3` is already on the VM; no dependency install is needed to run the app.
- See `README.md` and `COPILOT-INSTRUCTIONS.md` for the full project rules and file map.

### Non-obvious gotchas
- The **service worker is intentionally disabled on `localhost`/`127.0.0.1`** and only enabled on a
  LAN IP. This avoids stale-cache pain in dev, so on localhost you get fresh assets each load.
- After editing `css/app.css` or any `js/*.js`, bump the `?v=N` query on the `<link>`/`<script>`
  tags in `index.html` **and** the `CACHE = 'mathboard-vN'` constant in `sw.js` (details in
  `COPILOT-INSTRUCTIONS.md`). Then hard-refresh the browser.
- IndexedDB writes are **debounced ~400 ms** — wait before reading state back in a test.
- **Verify in a real, visible browser**, not a headless/non-painting tab: PDF import uses PDF.js,
  which yields via `requestAnimationFrame` and stalls when the tab isn't painting.
- Google Fonts (Inter) is the only external network reference; it is non-critical and the app
  works offline without it.
