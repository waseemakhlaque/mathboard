# MathBoard — Supabase cloud sync setup (Phase 7)

## Cost: $0 (Free tier)

Supabase’s **Free plan** is enough for MathBoard cloud sync:

- No credit card required to create an account
- 2 free projects, Postgres + Auth + Edge Functions included
- Fine for one teacher syncing lessons across Mac/iPad

You only pay if you later exceed free limits (large classes, heavy storage). Phase 7 sync does **not** need a paid plan.

---

## Quick deploy (≈5 minutes)

### 1. Free Supabase account

1. Go to [supabase.com](https://supabase.com) → **Start your project** (sign up with GitHub/Google/email).
2. **New project** → pick a name, database password (save it), region → **Create** (free).

### 2. Log in on your Mac (one time)

```bash
supabase login
```

Opens the browser; confirm login. No token to copy manually.

### 3. Run the deploy script

From the MathBoard repo root:

```bash
chmod +x scripts/deploy-supabase.sh
./scripts/deploy-supabase.sh
```

Paste your **project ref** when asked (from the dashboard URL:
`https://supabase.com/dashboard/project/<REF>`).

The script runs:

- `supabase link`
- `supabase db push` (notebooks table + RLS)
- `supabase functions deploy mathboard`
- prints your **anon key**

### 4. Configure the app

```bash
cp config.example.js config.local.js
```

Edit `config.local.js` with your project URL and anon key (from script output).

Hard-refresh MathBoard → **Sync** → sign in with a user you create in
**Authentication → Users → Add user** in the Supabase dashboard.

---

## Manual setup (alternative)

1. [supabase.com](https://supabase.com) → New project.
2. **Authentication → Providers → Email** — enable email/password (or magic link later).
3. Create a teacher account: **Authentication → Users → Add user**.

## 2. Run the migration

In **SQL Editor**, paste and run:

`supabase/migrations/20250626000000_notebooks.sql`

Or with CLI from repo root:

```bash
supabase link --project-ref YOUR_REF
supabase db push
```

**Note:** Notebook `id` is `text` (MathBoard’s string ids), not UUID.

## 3. Deploy the Edge Function

```bash
supabase functions deploy mathboard
```

Secrets are injected automatically (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).

Sync API base URL:

```text
https://YOUR_PROJECT.supabase.co/functions/v1/mathboard
```

## 4. Configure the app

Edit `config.js` on your deployed host:

```javascript
window.MB_CONFIG = {
  collabServerUrl: '',
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_ANON_KEY',
  syncApiUrl: '',  // optional; defaults to .../functions/v1/mathboard
};
```

## 5. Test sync

1. Open MathBoard → **Sync**.
2. Sign in with your Supabase user email/password (auto-merges on sign-in).
3. **Save URL** (auto-filled from config when Supabase is set).
4. Edits save locally first, then upload to cloud in the background (~1 s debounce).
5. **Sync now** — two-way merge (newer copy wins by `updated` timestamp).
6. On another device: sign in → lessons appear automatically.

**Offline:** keep teaching — IndexedDB holds everything. Reconnect (or tap Sync now) to flush pending uploads.

## API contract (matches `js/share.js`)

| Method | Path | Body |
|--------|------|------|
| GET | `/notebooks` | — → `[{ id, title, updated }]` |
| GET | `/notebooks/:id` | — → packaged lesson JSON |
| PUT | `/notebooks/:id` | `packageNotebook(nb)` |
| DELETE | `/notebooks/:id` | — |

## Next (optional)

- **Blobs table** + Storage bucket for PDF page rasters (large media) — client-side blob store already handles this locally; cloud blob upload is a stretch.
- **Live collab** — see below.
- **LiveKit** token function for A/V (Phase 10).

---

## Live collaboration (Phase 9)

Realtime multi-user **stroke sync** uses Yjs + a separate websocket server (not Supabase Realtime).

### 1. Run the collab server

```bash
cd collab-server
npm install
npm start
```

Listens on `ws://0.0.0.0:1234` by default.

### 2. Configure the app

In `config.local.js` (or deployed `config.js`):

```javascript
window.MB_CONFIG = {
  // ... supabaseUrl / syncApiUrl as above ...
  collabServerUrl: 'ws://YOUR_LAN_IP:1234',  // or wss:// behind TLS
};
```

**Important:** the **Collaborate** button only appears when:
- the app is **not** opened on `localhost` (use your Mac's LAN IP on iPad/other devices),
- the browser is **online**, and
- `collabServerUrl` is set.

Collab modules load via **dynamic import** only when you click Collaborate — the offline solo app never fetches them.

### 3. Join a room

Open the same room on each device:
- Add `?room=lesson-1` to the URL, or
- Enter the room name when prompted.

Status bar shows **Connecting…** → **Live**, or **Offline** if the server is unreachable (15 s timeout).

### 4. Deploy collab for HTTPS sites

For a production PWA on `https://yourdomain.com`, run `collab-server` behind a TLS proxy (Fly.io, Railway, etc.) and set:

```javascript
collabServerUrl: 'wss://collab.yourdomain.com',
```

See `collab-server/README.md` for details.
