# Inbox

Drop raw Cambridge 9709 PDFs here. Run `node scripts/collect-content.mjs --papers content/inbox --books content/inbox` to classify into `papers/` / `books/` / `extras/` and refresh `papers.json`.

Naming for papers (required by `scripts/rag-ingest.mjs`):
`9709_<s|w|m><yy>_<qp|ms>_<component>[variant].pdf`
e.g. `9709_s19_qp_12.pdf`, `9709_w21_ms_42.pdf`.
