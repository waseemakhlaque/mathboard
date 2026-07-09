# RAG ingest progress

Last updated: 2026-07-09

## Papers (2015–2025, components 1/3/4/5)

| Metric | Value |
|---|---|
| Progress file | `scripts/.rag-ingest-progress.json` |
| Keys recorded | 594 |
| Failures (`-1`) | 0 |
| Chunks upserted (sum) | 40 280 |
| Eligible on disk still remaining | **0** |

Papers batch is complete. Spot-check with a signed-in `POST /api/rag/query` for a topic from any ingested year.

## Books (`--books`)

Previously ingested from the owner’s Books folder under **original filenames** (18 keys in the progress file, including several that exceed the Worker 25 MiB asset limit and are listed in `papers.json` → `tooLarge`).

`content/books/` now uses clean names (`P1-Hodder.pdf`, etc.). Re-running
`INGEST_TOKEN=… node rag-ingest.mjs --books --root content/books` would re-chunk
those seven kept files under the new basenames. **Not run this session** — no
`INGEST_TOKEN` in the environment. Resume when the owner provides the token
(Workers AI free quota resets 05:00 PKT).

## Blocked

- Cannot call `/api/rag/upsert` without `INGEST_TOKEN` (Worker secret).
- Do not hammer retries on quota errors.
