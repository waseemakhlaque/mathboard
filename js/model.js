// model.js — portable notebook document schema (portal / sync ready)

export const FORMAT_VERSION = 2;
export const APP_NAME = 'mathboard';

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Normalize one page — ensures all module fields exist. */
export function normalizePage(p) {
  if (!p || typeof p !== 'object') return { id: genId(), paper: 'graph', strokes: [], objects: [] };
  if (!p.id) p.id = genId();
  if (!p.paper) p.paper = 'graph';
  if (p.format !== 'wide') p.format = 'a4';
  if (!Array.isArray(p.strokes)) p.strokes = [];
  if (!Array.isArray(p.objects)) p.objects = [];
  if (!Array.isArray(p.functions)) p.functions = [];
  if (!Array.isArray(p.geoItems)) p.geoItems = [];
  if (!Array.isArray(p.geoConstructs)) p.geoConstructs = [];
  if (!Array.isArray(p.mechItems)) p.mechItems = [];
  if (!Array.isArray(p.cplxLoci)) p.cplxLoci = [];
  if (!Array.isArray(p.calcItems)) p.calcItems = [];
  if (!Array.isArray(p.instruments)) p.instruments = [];
  if (typeof p.geoLabelN !== 'number') p.geoLabelN = 0;
  // Legacy incline diagrams lived in mechItems — promote to selectable page objects.
  if (Array.isArray(p.mechItems)) {
    for (const m of p.mechItems) {
      if (m.kind !== 'incline') continue;
      p.objects.push({
        id: m.id || genId(),
        kind: 'incline',
        at: m.at || { x: 200, y: 400 },
        base: m.len || m.base || 280,
        angleDeg: m.angleDeg ?? 30,
        mass: m.mass ?? 2,
        mu: m.mu ?? 0,
        showComponents: m.showComponents !== false,
        anim: false,
      });
    }
    p.mechItems = p.mechItems.filter((m) => m.kind !== 'incline');
  }
  return p;
}

/** Normalize a section (OneNote-style tab within a notebook). */
export function normalizeSection(s, fallbackTitle = 'Section 1') {
  if (!s || typeof s !== 'object') s = {};
  if (!s.id) s.id = genId();
  if (!s.title) s.title = fallbackTitle;
  if (!Array.isArray(s.pages) || !s.pages.length) {
    s.pages = [normalizePage({ id: genId(), paper: 'graph', strokes: [], objects: [] })];
  } else {
    s.pages = s.pages.map(normalizePage);
  }
  return s;
}

/** Migrate legacy flat pages[] → sections[]. */
export function ensureSections(nb) {
  if (Array.isArray(nb.sections) && nb.sections.length) {
    nb.sections = nb.sections.map((s, i) => normalizeSection(s, s.title || `Section ${i + 1}`));
    return nb;
  }
  const pages = Array.isArray(nb.pages) && nb.pages.length
    ? nb.pages.map(normalizePage)
    : [normalizePage({ id: genId(), paper: 'graph', strokes: [], objects: [] })];
  nb.sections = [{ id: genId(), title: 'Section 1', pages }];
  delete nb.pages;
  return nb;
}

/** Flat page list (all sections) — for export thumbnails etc. */
export function allPages(nb) {
  ensureSections(nb);
  return nb.sections.flatMap((s) => s.pages);
}

/** Infer lesson vs past-paper notebook kind. */
export function notebookKind(nb) {
  if (nb.kind === 'paper' || nb.kind === 'lesson') return nb.kind;
  return allPages(nb).some((p) => p.background?.type === 'image' || p.background?.type === 'pdf-page' || p.background?.blobId)
    ? 'paper' : 'lesson';
}

/** Normalize full notebook for storage, export, or sync. */
export function normalizeNotebook(nb) {
  if (!nb || typeof nb !== 'object') throw new Error('Invalid notebook.');
  const out = clone(nb);
  if (!out.id) out.id = genId();
  if (!out.title) out.title = 'Untitled lesson';
  if (!out.created) out.created = Date.now();
  if (!out.updated) out.updated = out.created;
  ensureSections(out);
  if (!out.kind) out.kind = notebookKind(out);
  return out;
}

/** Wrap notebook for file export / API upload. */
export function packageNotebook(nb) {
  return {
    format: FORMAT_VERSION,
    app: APP_NAME,
    exportedAt: new Date().toISOString(),
    notebook: normalizeNotebook(nb),
  };
}

/** Parse exported package; accepts legacy raw notebook JSON too. */
export function unpackNotebook(pkg) {
  if (!pkg || typeof pkg !== 'object') throw new Error('Invalid lesson file.');
  if (pkg.app && pkg.app !== APP_NAME) throw new Error('Not a MathBoard lesson file.');
  if (pkg.format && pkg.format > FORMAT_VERSION) {
    throw new Error('This file needs a newer version of MathBoard.');
  }
  const raw = pkg.notebook || pkg;
  if (!raw.pages && !raw.sections) throw new Error('Lesson file has no pages.');
  return normalizeNotebook(raw);
}

export function notebookFilename(nb, ext = 'mathboard.json') {
  const safe = (nb.title || 'lesson').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'lesson';
  return `${safe}.${ext}`;
}

export function freshId() { return genId(); }
