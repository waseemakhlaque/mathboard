# MathBoard Yjs collab server (Phase 9)

Separate from the static PWA — run on a machine with Node.js when you want live multi-user boards.

## Local / LAN (free)

```bash
cd collab-server
npm install
npm start
```

Server listens on `ws://0.0.0.0:1234`.

In `config.local.js` on devices that are **not** localhost (e.g. iPad on your Wi‑Fi):

```javascript
collabServerUrl: 'ws://192.168.1.XX:1234',
```

Open MathBoard from your Mac’s LAN IP (not `localhost`) so the Collaborate button appears.

Join the same room name on each device (`?room=lesson-1` in the URL or type when prompted).

## Notes

- Syncs **strokes on the current page** via Yjs (objects/geo coming later).
- Cloud lesson sync (Phase 7) uses Supabase; collab uses this websocket server.
- For HTTPS sites use `wss://` behind a TLS proxy (Fly.io, Railway free tier, etc.).
