#!/usr/bin/env node
// rag-ingest.mjs — ingest Cambridge 9709 past papers into the MathBoard RAG index.
// Scope: 2015–2025, papers 1x/3x/4x/5x (P1, P3, M1, S1), question papers + mark schemes.
// Chunks are POSTed to the deployed Worker /api/rag/upsert (embeds + upserts to Vectorize).
//
// Usage:
//   cd scripts && npm install
//   node rag-ingest.mjs --dry-run
//   INGEST_TOKEN=... node rag-ingest.mjs
// Flags: --root <dir>  --api <url>  --dry-run
// Resumable: .rag-ingest-progress.json records finished files; delete it to re-ingest.

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_CORPUS = "/Users/waseemakhlaque/Documents/BSS/AS & A level Mathematics/Past Papers' Folder";
const DEFAULT_API = 'https://mathboard.waseemonline.workers.dev';
const PROGRESS_FILE = path.join(__dirname, '.rag-ingest-progress.json');

const FILE_RE = /^9709_([smw])(\d{2})_(qp|ms)_([1345])(\d)?\.pdf$/;
const YEAR_MIN = 15, YEAR_MAX = 25;
const CHUNK_CHARS = 1500;
const OVERLAP_CHARS = 200;
const MIN_BLOCK_CHARS = 60;
const BATCH_SIZE = 50;

const COURSE = { 1: 'Pure Mathematics 1', 3: 'Pure Mathematics 3', 4: 'Mechanics', 5: 'Statistics' };
const SESSION = { s: 'May-June', w: 'Oct-Nov', m: 'Feb-March' };

// Textbook mode (--books): course inferred from filename; unmatched files are skipped.
const BOOKS_DIR = '/Users/waseemakhlaque/Documents/BSS/AS & A level Mathematics/Books and PDFs';
const BOOK_COURSE = [
  [/^p1\b|pure mathematics 1/i, 'Pure Mathematics 1'],
  [/^p3\b|pure mathematics 3/i, 'Pure Mathematics 3'],
  [/^m1\b|mechanics/i, 'Mechanics'],
  [/^s1\b|^s2\b|statistics/i, 'Statistics'],
  [/calculus|essential pure/i, 'Pure Mathematics 3'],
];

// Deterministic topic keyword tables — keys are EXACT content/catalog.json topic names.
// Lowercase substring matches; best hit-count wins, ties resolve to first entry, no hit → ''.
const PURE_TOPICS = {
  'Algebra': ['modulus', 'inequal', 'polynomial', 'remainder', 'factor theorem', 'partial fraction', 'binomial expansion'],
  'Logarithmic & exponential functions': ['logarithm', ' ln ', 'exponential', 'e^'],
  'Trigonometry': ['trigonometr', ' sin ', ' cos ', ' tan ', 'sec ', 'cot ', 'double angle', 'compound angle'],
  'Differentiation': ['differentiate', 'derivative', 'stationary point', 'tangent', 'normal to the curve', 'rate of change', 'implicit', 'parametric'],
  'Integration': ['integral', 'integrat', 'area under', 'trapezium', '∫', 'by parts', 'substitution'],
  'Numerical solution of equations': ['iterat', 'converges', 'root of the equation'],
  'Vectors': ['vector', 'scalar product', 'position vector', 'the plane', 'perpendicular distance', 'the line l'],
  'Differential equations': ['differential equation', 'separat'],
  'Complex numbers': ['complex number', 'argand', 'argument', 'conjugate', 'loci', 'modulus-argument'],
};
const TOPIC_KEYWORDS = {
  'Pure Mathematics 1': PURE_TOPICS,
  'Pure Mathematics 3': PURE_TOPICS,
  'Mechanics': {
    'Forces & equilibrium': ['equilibrium', 'tension', 'friction', 'coefficient of friction', 'resolve', 'forces act'],
    'Kinematics': ['velocity-time', 'acceleration', 'deceleration', 'displacement', 'comes to rest', 'constant velocity'],
    "Newton's laws": ['newton', 'pulley', 'connected', 'string passes', 'light inextensible'],
    'Motion on a slope': ['inclined', 'incline', 'slope'],
    'Momentum': ['momentum', 'impulse', 'collide', 'collision', 'coalesce'],
    'Work, energy & power': ['work done', 'kinetic energy', 'potential energy', 'power of', 'driving force'],
    'Projectiles': ['projectile', 'projected', 'trajectory'],
  },
  'Statistics': {
    'Representation of data': ['histogram', 'stem-and-leaf', 'box-and-whisker', 'cumulative frequency', 'frequency table'],
    'Measures of location & spread': ['mean', 'median', 'standard deviation', 'variance', 'interquartile', 'coded'],
    'Permutations & combinations': ['arrange', 'permutation', 'combination', 'how many different'],
    'Probability': ['probability', 'conditional', 'tree diagram', 'independent events', 'mutually exclusive'],
    'Discrete random variables': ['random variable', 'probability distribution', 'e(x)', 'var(x)', 'expectation'],
    'The binomial & geometric distributions': ['binomial', 'geometric distribution', 'trials'],
    'The normal distribution': ['normal distribution', 'normally distributed', 'standard normal'],
  },
};

function parseArgs(argv) {
  const opts = { root: '', api: DEFAULT_API, dryRun: false, books: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--books') opts.books = true;
    else if (a === '--root' && argv[i + 1]) opts.root = path.resolve(argv[++i]);
    else if (a === '--api' && argv[i + 1]) opts.api = argv[++i].replace(/\/$/, '');
  }
  if (!opts.root) opts.root = opts.books ? BOOKS_DIR : DEFAULT_CORPUS;
  opts.token = process.env.INGEST_TOKEN || process.env.INGEST_SECRET || '';
  return opts;
}

function bookMeta(basename) {
  if (!/\.pdf$/i.test(basename)) return null;
  for (const [re, course] of BOOK_COURSE) {
    if (re.test(basename)) return { course };
  }
  return null;
}

// Books have no question numbers: fixed-size chunks split at line boundaries.
function chunkBookText(text) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + CHUNK_CHARS);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > i + CHUNK_CHARS / 2) end = nl;
    }
    const body = text.slice(i, end).trim();
    if (body.length >= MIN_BLOCK_CHARS) chunks.push({ text: body, q: null });
    if (end >= text.length) break;
    i = end - OVERLAP_CHARS;
  }
  return chunks;
}

function loadCatalog() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'content/catalog.json'), 'utf8'));
}

function walkPdfs(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkPdfs(p, out);
    else if (FILE_RE.test(ent.name)) out.push(p);
  }
  return out;
}

function fileMeta(basename) {
  const m = basename.match(FILE_RE);
  const [, sess, yy, kind, paperDigit, variant] = m;
  const year = 2000 + Number(yy);
  if (Number(yy) < YEAR_MIN || Number(yy) > YEAR_MAX) return null;
  return {
    course: COURSE[Number(paperDigit)],
    year,
    session: SESSION[sess],
    sess,
    yy,
    kind,
    paper: paperDigit + (variant || ''),
  };
}

function classify(table, text) {
  const lower = text.toLowerCase();
  let best = '', bestScore = 0;
  for (const [name, keywords] of Object.entries(table)) {
    let score = 0;
    for (const kw of keywords) if (lower.includes(kw)) score++;
    if (score > bestScore) { best = name; bestScore = score; }
  }
  return best;
}

function classifyExercise(catalog, course, topic, text) {
  const c = (catalog.courses || []).find((x) => x.name === course);
  const t = c?.topics?.find((x) => x.name === topic);
  if (!t?.exercises?.length) return '';
  const table = {};
  for (const ex of t.exercises) {
    table[ex] = ex.toLowerCase().split(/[^\w]+/).filter((w) => w.length > 3);
  }
  return classify(table, text);
}

// Split page-joined text into question blocks: question numbers start a line.
function chunkPdfText(text) {
  const blocks = [];
  for (const part of text.split(/(?=\n\s*\d{1,2}[.\s)])/)) {
    const body = part.trim();
    if (body.length < MIN_BLOCK_CHARS) continue;
    const m = body.match(/^(\d{1,2})[.\s)]/);
    blocks.push({ text: body, q: m ? Number(m[1]) : null });
  }
  const chunks = [];
  for (const b of blocks) {
    if (b.text.length <= CHUNK_CHARS) { chunks.push(b); continue; }
    let i = 0;
    while (i < b.text.length) {
      const end = Math.min(b.text.length, i + CHUNK_CHARS);
      chunks.push({ text: b.text.slice(i, end).trim(), q: b.q });
      if (end >= b.text.length) break;
      i = end - OVERLAP_CHARS;
    }
  }
  return chunks;
}

async function loadPdfJs() {
  try {
    return await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (_) {
    const local = path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    if (fs.existsSync(local)) return import(pathToFileURL(local).href);
    throw new Error('Run: cd scripts && npm install');
  }
}

// Extract text preserving line breaks (y-coordinate changes), so question
// numbers appear at line starts for chunkPdfText().
async function extractPdfText(pdfjs, pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let out = '', lastY = null;
    for (const it of content.items) {
      const y = it.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) out += '\n';
      out += it.str + ' ';
      if (y !== undefined) lastY = y;
    }
    pages.push(out);
  }
  await doc.destroy();
  return pages.join('\n');
}

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 1));
}

async function postBatch(api, token, vectors) {
  const res = await fetch(`${api}/api/rag/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ vectors }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = res.status === 404
      ? ' — RAG API not deployed. Run: cd ~/Downloads/mathboard-fresh && bash scripts/deploy-mathboard.sh'
      : '';
    throw new Error((body.error || `upsert HTTP ${res.status}`) + hint);
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const catalog = loadCatalog();
  if (!opts.dryRun && !opts.token) {
    console.error('Set INGEST_TOKEN (or INGEST_SECRET) before uploading.');
    console.error('  cd ~/Downloads/mathboard-fresh && npx wrangler secret put INGEST_TOKEN');
    console.error('  export INGEST_TOKEN=\'your-token-here\'');
    process.exit(1);
  }
  if (!fs.existsSync(opts.root)) { console.error(`Not found: ${opts.root}`); process.exit(1); }

  const metaFor = opts.books ? bookMeta : fileMeta;
  const pdfs = opts.books
    ? fs.readdirSync(opts.root).filter((f) => bookMeta(f)).map((f) => path.join(opts.root, f)).sort()
    : walkPdfs(opts.root).filter((p) => fileMeta(path.basename(p))).sort();
  const progress = loadProgress();
  const todo = pdfs.filter((p) => !(path.basename(p) in progress));
  console.log(`In scope: ${pdfs.length} PDFs (${pdfs.length - todo.length} already done)`);

  const pdfjs = await loadPdfJs();
  let total = 0, failed = 0;
  for (const [i, pdfPath] of todo.entries()) {
    const basename = path.basename(pdfPath);
    const stem = opts.books
      ? basename.replace(/\.pdf$/i, '').replace(/[^\w-]+/g, '_').slice(0, 56)
      : basename.replace(/\.pdf$/, '');
    const meta = metaFor(basename);
    let text;
    try {
      text = await extractPdfText(pdfjs, pdfPath);
    } catch (e) {
      console.error(`  SKIP ${basename}: ${e.message}`);
      progress[basename] = -1;
      if (!opts.dryRun) saveProgress(progress);
      failed++;
      continue;
    }
    const chunks = opts.books ? chunkBookText(text) : chunkPdfText(text);
    const table = TOPIC_KEYWORDS[meta.course];
    const vectors = chunks.map((c, seq) => {
      const topic = classify(table, c.text);
      return {
        id: `${stem}#${String(seq).padStart(4, '0')}`,
        text: c.text,
        metadata: {
          course: meta.course,
          topic,
          exercise: topic ? classifyExercise(catalog, meta.course, topic, c.text) : '',
          year: opts.books ? 0 : meta.year,
          session: opts.books ? '' : meta.session,
          paper: opts.books ? '' : meta.paper,
          kind: opts.books ? 'book' : meta.kind,
          ref: opts.books
            ? `${basename.replace(/\.pdf$/i, '')} §${seq + 1}`
            : `9709 ${meta.sess}${meta.yy} ${meta.kind.toUpperCase()} ${meta.paper}${c.q ? ` Q${c.q}` : ''}`,
        },
      };
    });
    if (!opts.dryRun) {
      for (let b = 0; b < vectors.length; b += BATCH_SIZE) {
        await postBatch(opts.api, opts.token, vectors.slice(b, b + BATCH_SIZE));
      }
      progress[basename] = vectors.length;
      saveProgress(progress);
    }
    total += vectors.length;
    console.log(`[${i + 1}/${todo.length}] ${basename} → ${vectors.length} chunks`);
  }
  console.log(`\nDone. ${total} chunks${opts.dryRun ? ' (dry run)' : ' ingested'}, ${failed} files skipped.`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
