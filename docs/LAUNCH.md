# MathBoard — live-class production runbook

Production URL: **https://mathboard.waseemakhlaque85.workers.dev/**

Use this checklist before teaching live or sharing with students.

---

## 1. Local smoke test (P0)

```bash
cd mathboard
python3 -m http.server 8080
```

Open **http://127.0.0.1:8080** (hard refresh: **Cmd+Shift+R**).

| Step | Pass? |
|------|-------|
| Library loads, no red `#boot-error` banner | |
| **+ New lesson** → Create → editor opens | |
| Draw pen stroke, undo/redo | |
| Add LaTeX equation | |
| Open all panels (Layers, f(x), Calculus, Sym, Alg, Rat, Stats, Calc, Mech, Complex, AR Studio) — **only after opening a lesson** | |
| Export page PNG + notebook PDF | |
| Reload — lesson still there | |
| DevTools Console: **zero uncaught errors** | |

**Port in use?** `lsof -i :8080` → `kill <PID>`.

---

## 2. Deploy static PWA (HTTPS)

### Live (Cloudflare Workers static assets)

Repo root [`wrangler.jsonc`](../wrangler.jsonc) — Git push to `main` auto-deploys when Cloudflare is connected to GitHub.

Manual deploy:

```bash
npx wrangler login    # once
npx wrangler deploy   # from repo root
```

### After deploy

- [ ] **https://mathboard.waseemakhlaque85.workers.dev/** loads, footer shows current version (e.g. **v78**)
- [ ] Service worker **activated** (DevTools → Application; SW disabled on localhost only)
- [ ] Hard refresh once after each deploy (**Cmd+Shift+R**)

---

## 3. Supabase cloud sync

Backend: [`scripts/deploy-supabase.sh`](../scripts/deploy-supabase.sh) — see [`SUPABASE-SETUP.md`](SUPABASE-SETUP.md).

```bash
supabase login
./scripts/deploy-supabase.sh   # paste project ref
```

Dashboard: **Authentication → Users → Add user** (teacher account).

Production config is in [`config.js`](../config.js) (anon key is public client-side).

### Verify sync

- [ ] Open live URL → **Sync** → sign in
- [ ] Create/edit lesson → **Sync now**
- [ ] Second device/browser: sign in → lesson appears
- [ ] Offline: edit lesson → reconnect → **Sync now** merges

---

## 4. Live collab (Yjs + wss)

Production uses a **separate Cloudflare Worker** with Durable Objects ([`collab-worker/`](../collab-worker/)).

```bash
./scripts/deploy-collab-worker.sh
# or: cd collab-worker && npm install && npx wrangler deploy
```

Set in [`config.js`](../config.js):

```javascript
collabServerUrl: 'wss://mathboard-collab.waseemakhlaque85.workers.dev',
```

**Collaborate** button appears only when: HTTPS (not localhost), online, `collabServerUrl` set.

### Verify collab

- [ ] Two browsers: `https://mathboard.waseemakhlaque85.workers.dev/?room=test`
- [ ] Open same lesson → **Collaborate** → status **Live**
- [ ] Strokes sync within ~1 s (current page only)
- [ ] Stop collab worker → **Offline** within 15 s (not infinite Connecting)

LAN fallback (dev): [`scripts/start-collab.sh`](../scripts/start-collab.sh) + `ws://LAN-IP:1234` in `config.local.js`.

---

## 5. iPad / classroom

1. iPad Safari → **https://mathboard.waseemakhlaque85.workers.dev/**
2. **Share → Add to Home Screen** (PWA)
3. Apple Pencil: fingers pan/zoom, Pencil draws
4. **Not** Safari Private Browsing (blocks IndexedDB saves)
5. Mac **Sidecar** / AirPlay for screen-share while students use `?room=` URL

### iPad checklist

- [ ] PWA installs full-screen from deployed HTTPS URL
- [ ] Create lesson, draw, force-quit app, reopen — lesson persists
- [ ] Pencil pressure works; palm rejection (fingers pan)

---

## 6. Post-deploy verification (production URL)

- [ ] Library loads, no boot banner
- [ ] Create lesson, draw, reload — persists
- [ ] Sync sign-in + two-device merge
- [ ] Collab two-browser stroke sync
- [ ] PDF import + export round-trip
- [ ] `index.html` `?v=N` = `sw.js` `mathboard-vN` = footer **vN**

---

## Common glitches

| Symptom | Fix |
|---------|-----|
| Collaborate button missing | Use HTTPS URL, not localhost; set `collabServerUrl` |
| Collab stuck Connecting | Deploy collab worker; use `wss://` not `ws://` on HTTPS |
| Old UI after deploy | Hard refresh; bump cache version in `index.html` + `sw.js` |
| Lessons won't save (iPad) | Turn off Private Browsing |
| Sync fails | Create Supabase user; use legacy anon JWT in `config.js` |
| Panel crash from library | Open a lesson first — panels need an active page |
| `config.local.js` 404 | Expected in production (optional override) |

---

## Version / cache

After editing `js/app.js` or `css/app.css`: bump `?v=N` in `index.html`, `CACHE = 'mathboard-vN'` in `sw.js`, footer `vN`. Add new JS modules to `sw.js` ASSETS.

---

## GitHub Actions (optional)

Add repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`:

- `.github/workflows/cloudflare-deploy.yml` — static PWA (if not using dashboard Git connect)
- `.github/workflows/cloudflare-collab-deploy.yml` — collab Worker (paths: `collab-worker/**`)

Do **not** run both dashboard Git connect and Actions deploy for the same project.
