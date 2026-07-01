# Security Policy

MathBoard is proprietary software. Copyright © 2026 Waseem Akhlaque. All rights
reserved. See [LICENSE](./LICENSE).

## Reporting a vulnerability

If you discover a security issue, please report it **privately** — do not open a
public GitHub issue.

- Email: **asmamemon85@gmail.com** (subject: `MathBoard security`)
- Please include: a description, steps to reproduce, and the affected URL/version
  (the version is shown in the library footer, e.g. `v90`).

You will get an acknowledgement as soon as possible. Please give a reasonable
window to remediate before any public disclosure.

## Supported versions

Only the latest version deployed at
`https://mathboard.waseemakhlaque85.workers.dev/` is supported. Older cached
builds should be refreshed (hard reload / reinstall the PWA).

## What is and isn't a secret in this repo

MathBoard is a **client-side** app; the browser can read all shipped code. The
following values in `config.js` are **public by design** and are safe to ship:

- **Supabase anon key** — a public, RLS-gated key. Data protection depends on
  **Row Level Security** being enabled on every Supabase table/policy. It is
  *not* a service-role key and grants no privileged access on its own.
- **Cloudflare Web Analytics beacon token** — a public, write-only telemetry
  token with no read access.

**Never** commit service-role keys, database passwords, or private API keys.
Real secrets belong in `config.local.js` (git-ignored) or Cloudflare/Supabase
environment variables — never in the tracked source.

## Hardening in place

- **HTTP security headers** via [`_headers`](./_headers): Content-Security-Policy,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS.
- **Offline-first**: all runtime libraries are vendored locally (no third-party
  CDN at runtime), which removes a class of supply-chain risks.
- **User data is local by default** (IndexedDB, per-device). Cloud sync/collab is
  opt-in and only active when the user configures a backend URL.
- **User-supplied text** (lesson titles, course/topic/exercise tags) is HTML-escaped
  before rendering to prevent stored XSS.

## Recommendations for operators

- Enable and audit **Row Level Security** on all Supabase tables before using
  cloud sync with real student data.
- Serve only over HTTPS (enforced by HSTS + `upgrade-insecure-requests`).
- Rotate the Supabase anon key if you ever suspect the project ref was misused,
  and keep the service-role key out of any client or repo.
