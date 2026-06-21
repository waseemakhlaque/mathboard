# MathBoard

**A free, pencil-first notebook whiteboard for teaching A-level mathematics** — built for
vectors, complex numbers, and live class / YouTube demonstrations.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![PWA](https://img.shields.io/badge/PWA-installable-success)
![No build step](https://img.shields.io/badge/build-none-lightgrey)

> Created by **Waseem Akhlaque**, A-Level Mathematics Teacher — © 2026. Free for everyone under the MIT License.

MathBoard is a single static web app (HTML/CSS/JS, no build step). It runs in any modern browser on
Mac, Windows, iPad, or Android, installs to the home screen as an app, and works fully offline.

---

## Features
- **Paginated notebooks** (GoodNotes-style) — A4 pages, paper templates: plain, squared, graph,
  Cornell, Argand plane, vector grid.
- **Pencil-first drawing** — pressure pen, highlighter, eraser, lasso (select + drag), 6 colours,
  size control. Apple Pencil pressure + palm rejection (fingers pan/zoom, pencil draws).
- **Import past papers (PDF)** — open a PDF and annotate/solve directly over each page.
- **Undo / redo**, pinch-zoom, two-finger pan.
- **Export** — page → PNG, whole notebook → multi-page PDF.
- **Branding overlay** — teacher photo + name + title for live class and recordings (toggleable).
- **Offline PWA** — all libraries bundled locally; no internet needed after first load.

## Try it
- **Live:** _enable GitHub Pages and put the URL here_ (e.g. `https://<username>.github.io/mathboard/`)
- **Locally:**
  ```bash
  git clone https://github.com/<username>/mathboard.git
  cd mathboard
  python3 -m http.server 5173
  ```
  Open <http://localhost:5173>.

## Use on an iPad (same Wi-Fi)
1. Run the server on your computer (command above).
2. Find your computer's LAN IP (e.g. `192.168.1.24`).
3. On the iPad, open Safari → `http://192.168.1.24:5173`.
4. Share → **Add to Home Screen** to install it as a full-screen app, then draw with the Apple Pencil.

## Live class / YouTube
Use macOS **Sidecar** to push the MathBoard browser window to the iPad and draw on it with the
Pencil — the tab stays on the Mac, so you can screen-share or record it directly. AirPlay or QuickTime
mirroring also work.

## Tech
Vanilla JavaScript + HTML5 Canvas. [jsPDF](https://github.com/parallax/jsPDF) for PDF export and
[Mozilla PDF.js](https://github.com/mozilla/pdf.js) for PDF import (both bundled in `vendor/`).
No frameworks, no build tooling.

## Roadmap
Planned modules (each plugs onto the notebook core): Vectors → Complex/Argand → Geometry →
Trigonometry → Statistics → Mechanics, plus a free fx-991-equivalent scientific calculator.
See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Deploy to the web (Vercel)
MathBoard is a static site, so hosting is trivial and free:
- **Vercel:** push this folder to a GitHub repo, then "Import Project" on vercel.com (no build step —
  it's detected as static). Or run `npx vercel` from this folder. `vercel.json` is already included.
- **GitHub Pages / Netlify / Cloudflare Pages:** also work with zero config.
No backend, no n8n, no server code — it's just files.

## License
[MIT](LICENSE) © 2026 Waseem Akhlaque. Free to use, modify, and share — please keep the copyright
notice. Bundled libraries keep their own licenses — see [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).

## Author
**Waseem Akhlaque** — A-Level Mathematics Teacher (Cambridge 9709).
Contributions and suggestions from fellow teachers are welcome.
