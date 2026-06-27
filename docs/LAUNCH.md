# MathBoard — launch checklist

Use this before sharing the app with students or deploying to production.

## 1. Local smoke test

```bash
cd mathboard   # project root — NOT your home folder
python3 -m http.server 8080
```

Open **http://127.0.0.1:8080** (hard refresh: **Cmd+Shift+R**).

| Step | Pass? |
|------|-------|
| Library loads, no red boot banner | |
| **+ New lesson** → Create → editor opens | |
| Draw pen stroke, undo/redo | |
| Add LaTeX equation | |
| Open all panels (Layers, f(x), Calculus, Symbolic, Algebra, Fractions, Stats, Calculator, Mechanics, Complex, Instruments, AR Studio) | |
| Test Stats: generate chart (box plot/normal curve) + "Place" button | |
| Export page PNG + notebook PDF | |
| Reload — lesson still there | |
| DevTools Console: **zero uncaught errors** | |

**Port in use?** `lsof -i :8080` → `kill <PID>` or use `8081`.

## 2. Optional cloud sync

```bash
cp config.example.js config.local.js
# edit with Supabase URL + anon key — see docs/SUPABASE-SETUP.md
```

Hard refresh → **Sync** → sign in → **Sync now**.

## 3. Optional live collab

```bash
cd collab-server && npm install && npm start
```

Set `collabServerUrl` in `config.local.js`. Open app from **LAN IP** (not localhost).
Join same room on two devices: `?room=lesson-1`.

## 4. Deploy (static — no build step)

**Recommended host: Cloudflare Pages** — free, unlimited bandwidth, commercial use allowed on the
free tier (so you never have to migrate if you start charging). The repo ships `_headers`
(caching rules, mirrors `vercel.json`) and `.assetsignore` (keeps internal source out of uploads).

### Cloudflare Pages — Option A: direct upload (fastest, no GitHub needed)

```bash
cd mathboard                          # project root
npm install -g wrangler               # one-time (or use: npx wrangler ...)
wrangler login                        # opens browser, authorise once
wrangler pages deploy . --project-name mathboard
```

First run creates the project and prints a live URL like `https://mathboard.pages.dev`.
Re-run the last command any time to publish updates. `.git`, `node_modules`, and everything in
`.assetsignore` are skipped automatically.

### Cloudflare Pages — Option B: Git auto-deploy (best for ongoing updates)

1. Push the repo to GitHub (see §6).
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick the repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
4. **Save and Deploy.** Every push to `main` now auto-publishes. `.gitignore` keeps `config.local.js` out.

### Vercel (alternative — `vercel.json` already included)

```bash
npm install -g vercel
cd mathboard
vercel            # first run: link/create project
vercel --prod     # publish to production
```

Or via dashboard: Import repo → Framework preset **Other** → build command **empty** → output dir **`.`**.

### GitHub Pages (free, simplest if repo is already on GitHub)
Push to `main`; **Settings → Pages → Deploy from branch → `main` / root**. `.nojekyll` is included.
Note: caching headers (`_headers`/`vercel.json`) are ignored by GitHub Pages — fine for personal use.

### After deploy
- [ ] Custom domain + HTTPS (Cloudflare: Pages project → Custom domains)
- [ ] PWA installs on iPad from the deployed URL (Share → Add to Home Screen)
- [ ] Service worker registers (it runs on the deployed host, not on localhost)
- [ ] `config.js` on the host has **empty** secrets unless you intend cloud sync
- [ ] No `config.local.js` is published (it stays local / gitignored; a 404 is handled gracefully)

## 5. iPad (same Wi-Fi)

1. Server running on Mac: `python3 -m http.server 8080`
2. Mac LAN IP: System Settings → Wi-Fi → Details
3. iPad Safari: `http://<LAN-IP>:8080`
4. Share → **Add to Home Screen**

## 6. Push to GitHub (needed for Git auto-deploy)

The folder is already a git repo. To publish it (replace `YOUR-USER`):

```bash
cd mathboard
gh repo create mathboard --public --source=. --remote=origin --push   # needs: gh auth login
# — or, without the gh CLI: create an empty repo on github.com, then —
git remote add origin https://github.com/YOUR-USER/mathboard.git
git add -A && git commit -m "Deploy-ready: Cloudflare Pages config"
git branch -M main && git push -u origin main
```

`config.local.js` and `.claude/` stay out of the push (already in `.gitignore`).

## Version / cache

After code changes, verify `index.html` `?v=N` matches `sw.js` `mathboard-vN` and footer `vN`.
