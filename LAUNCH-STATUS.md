# MathBoard Launch Status

**Date**: July 9, 2026  
**Version**: v112  
**Access model**: login-only (Supabase signed-in + `profiles.active_until`). No pricing UI.

---

## Done this pass

- Paywall / Upgrade / Stripe UI removed from `index.html`, `js/app.js`, `js/ragSearch.js`, `js/courseLibrary.js`, `css/app.css`.
- Corpus audited: 1558 papers OK; 7 books renamed; 13 coursebooks flagged `tooLarge` (>24 MiB) in `content/papers.json` / `content/CORPUS-AUDIT.md`.
- Cache bumped to `mathboard-v112`.

## Pending

- [ ] RAG ingest batches (`content/INGEST-PROGRESS.md`) — needs `INGEST_TOKEN`
- [ ] Cross-device QA checklist
- [ ] Deploy after owner / Claude Code review

See also: `docs/ADMIN-GUIDE.md`, `docs/PAYMENTS-LATER.md` (payments postponed).
