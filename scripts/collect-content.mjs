#!/usr/bin/env node
// collect-content.mjs — copy the 9709 corpus into content/ and build content/papers.json.
// Papers/books/extras are served ONLY through the JWT-gated /content/* Worker route.
// Files > 24 MiB are skipped (Workers static-asset limit is 25 MiB) and listed in
// the manifest so the UI can say "ask your teacher" — enable R2 later to lift this.
//
// Usage: node scripts/collect-content.mjs [--papers <dir>] [--books <dir>] [--dry-run]
// Re-runnable: skips files already copied with the same size.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const DRY = args.includes('--dry-run');

const PAPERS_SRC = argVal('--papers', "/Users/waseemakhlaque/Documents/BSS/AS & A level Mathematics/Past Papers' Folder");
const BOOKS_SRC = argVal('--books', '/Users/waseemakhlaque/Documents/BSS/AS & A level Mathematics/Books and PDFs');

const OUT_PAPERS = path.join(ROOT, 'content', 'papers');
const OUT_BOOKS = path.join(ROOT, 'content', 'books');
const OUT_EXTRAS = path.join(ROOT, 'content', 'extras');
const MANIFEST = path.join(ROOT, 'content', 'papers.json');

const MAX_BYTES = 24 * 1024 * 1024; // stay under the 25 MiB Workers asset limit
const PAPER_RE = /^9709_([msw])(\d{2})_(qp|ms)_([1-7])(\d)?\.pdf$/i;
const SYLLABUS_RE = /^9709_y\d{2}(-\d{2})?_sy\.pdf$/i;

const COMPONENTS = {
  1: 'Pure Mathematics 1', 2: 'Pure Mathematics 2', 3: 'Pure Mathematics 3',
  4: 'Mechanics', 5: 'Probability & Statistics 1', 6: 'Probability & Statistics 2',
  7: 'Mechanics 2',
};

const BOOK_COMPONENT = [
  [/^p1\b|pure mathematics 1/i, 'P1'],
  [/^p3\b|pure mathematics 3/i, 'P3'],
  [/^m1\b|mechanics/i, 'M'],
  [/^s1 and 2|^s[12]\b|statistics/i, 'S'],
  [/calculus|essential pure/i, 'P3'],
];

const slug = (name) => name.toLowerCase()
  .replace(/\.pdf$/i, '')
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') + '.pdf';

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

function copyIfNeeded(src, dest) {
  const size = fs.statSync(src).size;
  if (fs.existsSync(dest) && fs.statSync(dest).size === size) return 'kept';
  if (!DRY) fs.copyFileSync(src, dest);
  return 'copied';
}

for (const d of [OUT_PAPERS, OUT_BOOKS, OUT_EXTRAS]) fs.mkdirSync(d, { recursive: true });

const papers = [];
const extras = [];
const books = [];
const tooLarge = [];
const skipped = [];
const seen = new Set();
let copied = 0;

// ---- papers + syllabus ----
for (const src of walk(PAPERS_SRC)) {
  const base = path.basename(src);
  if (!/\.pdf$/i.test(base)) continue;
  const size = fs.statSync(src).size;
  const m = base.match(PAPER_RE);
  if (m) {
    const name = base.toLowerCase();
    if (seen.has(name)) { skipped.push(`dup: ${src}`); continue; }
    seen.add(name);
    if (size > MAX_BYTES) { tooLarge.push({ title: base, mb: +(size / 1e6).toFixed(1) }); continue; }
    if (copyIfNeeded(src, path.join(OUT_PAPERS, name)) === 'copied') copied++;
    const [, session, yy, type, comp, variant] = m;
    papers.push({
      f: name, y: 2000 + Number(yy), s: session.toLowerCase(),
      t: type.toLowerCase(), c: comp, v: variant || '',
    });
    continue;
  }
  if (SYLLABUS_RE.test(base) || /formulae|formula/i.test(base)) {
    const name = slug(base);
    if (seen.has(name) || size > MAX_BYTES) continue;
    seen.add(name);
    if (copyIfNeeded(src, path.join(OUT_EXTRAS, name)) === 'copied') copied++;
    extras.push({ f: name, title: base.replace(/\.pdf$/i, '') });
    continue;
  }
  skipped.push(`unrecognised: ${base}`);
}

// ---- books ----
for (const src of walk(BOOKS_SRC)) {
  const base = path.basename(src);
  if (!/\.pdf$/i.test(base)) continue;
  const size = fs.statSync(src).size;
  const title = base.replace(/\.pdf$/i, '');
  if (size > MAX_BYTES) { tooLarge.push({ title, mb: +(size / 1e6).toFixed(1) }); continue; }
  const name = slug(base);
  if (seen.has(name)) { skipped.push(`dup book: ${base}`); continue; }
  seen.add(name);
  if (copyIfNeeded(src, path.join(OUT_BOOKS, name)) === 'copied') copied++;
  const comp = (BOOK_COMPONENT.find(([re]) => re.test(base)) || [null, 'General'])[1];
  books.push({ f: name, title, comp, mb: +(size / 1e6).toFixed(1) });
}

papers.sort((a, b) => b.y - a.y || a.c.localeCompare(b.c) || a.f.localeCompare(b.f));
books.sort((a, b) => a.comp.localeCompare(b.comp) || a.title.localeCompare(b.title));

const manifest = {
  version: 1,
  generated: new Date().toISOString(),
  components: COMPONENTS,
  papers, books, extras, tooLarge,
};
if (!DRY) fs.writeFileSync(MANIFEST, JSON.stringify(manifest));

console.log(`papers: ${papers.length}  books: ${books.length}  extras: ${extras.length}`);
console.log(`copied ${copied} new files; tooLarge: ${tooLarge.length}; skipped: ${skipped.length}`);
for (const t of tooLarge) console.log(`  >24MB: ${t.title} (${t.mb} MB)`);
if (skipped.length) console.log(skipped.slice(0, 20).map((s) => `  skip ${s}`).join('\n'));
