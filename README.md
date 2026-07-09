# MathBoard

**A pencil-first notebook whiteboard for teaching A-level mathematics** — built for
vectors, complex numbers, and live class / YouTube demonstrations.

![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)
![PWA](https://img.shields.io/badge/PWA-installable-success)
![No build step](https://img.shields.io/badge/build-none-lightgrey)

> Created by **Waseem Akhlaque**, A-Level Mathematics Teacher — © 2026. All rights reserved.
> Access is login-based (signed-in account with an active entitlement). There is no
> freemium tier, upgrade screen, or in-app checkout.

MathBoard is a single static web app (HTML/CSS/JS, no build step). It runs in any modern browser on
Mac, Windows, iPad, or Android, installs to the home screen as an app, and works offline for
drawing once loaded (past papers and RAG search need network + sign-in).

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
- **Live:** [https://mathboard.waseemakhlaque85.workers.dev/](https://mathboard.waseemakhlaque85.workers.dev/)
- **Locally:**
  ```bash
  git clone https://github.com/waseemakhlaque/mathboard.git
  cd mathboard
  python3 -m http.server 8080
  ```
  Open <http://localhost:8080> (or any free port, e.g. `5173` if `8080` is taken).

## Use on an iPad (same Wi-Fi)
1. Run the server on your computer (command above).
2. Find your computer's LAN IP (e.g. `192.168.1.24`).
3. On the iPad, open Safari → `http://192.168.1.24:8080` (same port as on the Mac).
4. Share → **Add to Home Screen** to install it as a full-screen app, then draw with the Apple Pencil.

## Live class / YouTube
Use macOS **Sidecar** to push the MathBoard browser window to the iPad and draw on it with the
Pencil — the tab stays on the Mac, so you can screen-share or record it directly. AirPlay or QuickTime
mirroring also work.

## Tech
Vanilla JavaScript + HTML5 Canvas. [jsPDF](https://github.com/parallax/jsPDF) for PDF export and
[Mozilla PDF.js](https://github.com/mozilla/pdf.js) for PDF import (both bundled in `vendor/`).
No frameworks, no build tooling.

## Roadmap & project review
A full project assessment, a redesigned architecture, and the build + hosting plan (local Mac/iPad
→ online live teaching portal) are in `docs/`:
- [`docs/ASSESSMENT.md`](docs/ASSESSMENT.md) — feature‑by‑feature gap analysis (what's done / partial / missing).
- [`docs/ARCHITECTURE-V2.md`](docs/ARCHITECTURE-V2.md) — the redesigned architecture (core + plug‑ins, two shells, three runtimes).
- [`docs/ROADMAP-V2.md`](docs/ROADMAP-V2.md) — phased roadmap + how to run locally and how to go live online.

Original phased plan (still valid for the notebook core): [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Deploy to the web
MathBoard is a static site with **no build step** — just serve the files.

### GitHub Pages (recommended)
1. Push to `main` — the included [`.github/workflows/pages.yml`](.github/workflows/pages.yml) deploys automatically.
2. In the repo **Settings → Pages**, set **Source** to **GitHub Actions** (if not already).
3. The app is live at **https://waseemakhlaque.github.io/mathboard/** after the first workflow run.

### Vercel / Netlify / Cloudflare Pages
- **Vercel:** import the GitHub repo on vercel.com (no build command; output directory = `.`). `vercel.json` is included.
- **Netlify / Cloudflare Pages:** also work with zero config — publish the repo root as a static site.

No backend, no server code — it's just files.

## Documentation & setup guides

For contributors, developers, and advanced configuration:
- [`CLINE-TASK.md`](CLINE-TASK.md) — Development task list and debugging workflow
- [`docs/LAUNCH.md`](docs/LAUNCH.md) — Pre-deployment checklist and smoke testing
- [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md) — Cloud sync setup (optional, free tier)
- [`docs/ASSESSMENT.md`](docs/ASSESSMENT.md) — Feature-by-feature gap analysis
- [`docs/ROADMAP-V2.md`](docs/ROADMAP-V2.md) — Development roadmap and architecture

### Notes on offline capability
All JavaScript libraries, math engines, and fonts (KaTeX) are bundled locally. The app loads the **Inter** font family from Google Fonts CDN for optimal typography on first visit; after that initial load, the app works fully offline. If offline on first visit, it falls back to system fonts.

### Privacy
MathBoard stores all your notebooks **locally on your device** (IndexedDB) — they are never uploaded unless you explicitly enable Cloud Sync. If the operator has configured a `cfAnalyticsToken`, the app loads **Cloudflare Web Analytics** to count anonymous, aggregate usage (page views, approximate region) with **no cookies and no personal data**; it is disabled by default and only runs when online.

## License
**Proprietary — [© 2026 Waseem Akhlaque, all rights reserved](LICENSE).** You may download, install,
and use MathBoard freely for personal and classroom use. You may **not** modify, redistribute, rehost,
or create derivative works without written permission from the author. Bundled libraries keep their own
licenses — see [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).

## Author
**Waseem Akhlaque** — A-Level Mathematics Teacher (Cambridge 9709).
Contributions and suggestions from fellow teachers are welcome.
