# RAG ingestion — Cambridge 9709 past papers

Retrieval-only pipeline: local PDFs → chunks → `/api/rag/upsert` (Worker embeds with
`@cf/baai/bge-base-en-v1.5` and upserts to Vectorize index `mathboard-rag`).

## Scope (first pass)
- Corpus: `~/Documents/BSS/AS & A level Mathematics/Past Papers' Folder`
- Files: `9709_[smw]yy_[qp|ms]_[1345]N.pdf`, 2015–2025 → 576 PDFs (~33k chunks)
- Paper → course: 1x = Pure Mathematics 1, 3x = Pure Mathematics 3, 4x = Mechanics, 5x = Statistics
- Topic/exercise tagged deterministically from keyword tables keyed on catalog.json names

## One-time provisioning (already done)
```
npx wrangler vectorize create mathboard-rag --dimensions=768 --metric=cosine
npx wrangler vectorize create-metadata-index mathboard-rag --property-name=course --type=string
# … same for topic(string), year(number), paper(string), kind(string)
npx wrangler deploy
npx wrangler secret put INGEST_TOKEN
```

## Run
```
cd scripts && npm install
node rag-ingest.mjs --dry-run          # counts only, no upload
INGEST_TOKEN=... node rag-ingest.mjs   # uploads; resumable
INGEST_TOKEN=... node rag-ingest.mjs --books   # textbooks (kind:"book", ~7.4k chunks)
```
Flags: `--books` `--root <dir>` `--api <url>` (default https://mathboard.waseemakhlaque85.workers.dev).
Textbook course is inferred from the filename (P1/P3/M1/S1/…); AQA and teacher-resource
PDFs don't match and are excluded.

Re-runs skip files listed in `scripts/.rag-ingest-progress.json` (extraction failures
recorded as `-1`); delete the file to re-ingest everything.

## Query
```
curl -s -X POST https://mathboard.waseemakhlaque85.workers.dev/api/rag/query \
  -H 'Content-Type: application/json' \
  -d '{"q":"angle between line and plane","topK":5,"filter":{"course":"Pure Mathematics 3"}}'
```
Filter keys: `course`, `topic`, `year`, `paper`, `kind` (`qp`|`ms`).
