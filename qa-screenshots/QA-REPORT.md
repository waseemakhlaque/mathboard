# Cross-device QA

Base: http://127.0.0.1:8790/
Date: 2026-07-09T11:33:31.009Z

| Case | Result | Notes | Screenshot |
|---|---|---|---|
| 01-chrome-1920x1080 | PASS | clean gate/shell | `01-chrome-1920x1080.png` |
| 02-firefox-1920x1080 | PASS | clean gate/shell | `02-firefox-1920x1080.png` |
| 03-ipad-pro11-landscape | PASS | clean gate/shell | `03-ipad-pro11-landscape.png` |
| 04-android-tablet-1280x800 | PASS | clean gate/shell | `04-android-tablet-1280x800.png` |
| 05-pc-1366x768 | PASS | clean gate/shell | `05-pc-1366x768.png` |
| 06-offline-reload | FAIL* | page.reload: net::ERR_INTERNET_DISCONNECTED
Call log:
  - waiting for navigation until "domcontentloaded"
 · python http.server has no SW; offline reload may FAIL locally — retest under wrangler/production PWA | `06-offline-reload.png` |

\* Offline under `python3 -m http.server` has no service worker (disabled on localhost by design). Retest on deployed Worker.

**Login / draw / papers / RAG:** not exercised — no test credentials in env. Structural note for Claude Code if needed.
