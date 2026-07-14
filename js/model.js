// model.js — portable notebook document schema (portal / sync ready)

export const FORMAT_VERSION = 2;
export const APP_NAME = 'mathboard';

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Drop broken geoItems from pre-v120 saves (orphan refs / stray unnamed points).
 *  Idempotent: valid data passes through unchanged. */
export function sanitizeGeoItems(items) {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : [];
  const points = new Map();
  for (const it of items) {
    if (it?.t === 'point' && it.id != null) points.set(String(it.id), it);
  }
  const hasPt = (id) => id != null && points.has(String(id));
  const referenced = new Set();
  const mark = (...ids) => { for (const id of ids) if (id != null) referenced.add(String(id)); };

  const structures = [];
  for (const it of items) {
    if (!it || !it.t || it.t === 'point') continue;
    if (it.t === 'segment' || it.t === 'line') {
      if (!hasPt(it.p1) || !hasPt(it.p2)) continue;
      mark(it.p1, it.p2);
      structures.push(it);
    } else if (it.t === 'circle') {
      if (!hasPt(it.c) || !hasPt(it.r)) continue;
      mark(it.c, it.r);
      structures.push(it);
    } else if (it.t === 'ellipse' || it.t === 'angle') {
      if (!hasPt(it.p1) || !hasPt(it.p2) || !hasPt(it.p3)) continue;
      mark(it.p1, it.p2, it.p3);
      structures.push(it);
    } else if (it.t === 'polygon') {
      if (!Array.isArray(it.verts) || it.verts.length < 3 || !it.verts.every(hasPt)) continue;
      mark(...it.verts);
      structures.push(it);
    } else if (it.t === 'perp' || it.t === 'parallel') {
      // Defer — need line ids from surviving line/segment items first.
      if (it.line == null || !hasPt(it.pt)) continue;
      structures.push(it);
    } else {
      structures.push(it);
    }
  }

  // Perp/parallel need a resolvable line/segment id on the same page.
  const lineIds = new Set();
  for (const it of structures) {
    if ((it.t === 'line' || it.t === 'segment') && it.id != null) lineIds.add(String(it.id));
  }
  const keptStruct = [];
  for (const it of structures) {
    if (it.t === 'perp' || it.t === 'parallel') {
      if (!lineIds.has(String(it.line))) continue;
      mark(it.pt);
    }
    keptStruct.push(it);
  }

  // Named points always keep; unnamed (composite helpers) only if referenced.
  const keptPoints = [];
  for (const [id, pt] of points) {
    if (pt.name) keptPoints.push(pt);
    else if (referenced.has(id)) keptPoints.push(pt);
  }
  return [...keptPoints, ...keptStruct];
}

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
  else p.geoItems = sanitizeGeoItems(p.geoItems);
  if (!Array.isArray(p.geoConstructs)) p.geoConstructs = [];
  if (!Array.isArray(p.mechItems)) p.mechItems = [];
  if (!Array.isArray(p.cplxLoci)) p.cplxLoci = [];
  if (!Array.isArray(p.calcItems)) p.calcItems = [];
  if (!Array.isArray(p.instruments)) p.instruments = [];
  else {
    // Migrate pre-v122 legacy instrument schema to new widget model
    // old ruler: {kind:'ruler', a, b} → new: {kind:'ruler', x, y, length, rotation}
    // old protractor: {kind:'protractor', vertex, arm1, arm2} → new: {kind:'protractor', x, y, radius, rotation}
    // old compass: {kind:'compass', center, r} → new: {kind:'compass', pivot, pencil, radius}
    // pt() guards every field read in the migration below — old lessons can have
    // partially-corrupt instrument records (e.g. a ruler with `a` but no `b`), and
    // per the skip-and-continue rule this must drop the one bad item, never throw.
    const pt = (v) => (v && typeof v.x === 'number' && typeof v.y === 'number') ? v : null;
    p.instruments = p.instruments.map((it) => {
      if (!it || !it.kind) return null;
      try {
        if (it.kind === 'ruler' && it.a != null && it.x == null) {
          const a = pt(it.a), b = pt(it.b);
          if (!a || !b) return null; // malformed legacy ruler — drop rather than crash
          const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          const dx = b.x - a.x, dy = b.y - a.y;
          return { id: it.id || genId(), kind: 'ruler', x: cx, y: cy, length: Math.hypot(dx, dy), rotation: Math.atan2(dy, dx), width: 14 };
        }
        if (it.kind === 'protractor' && it.vertex != null && it.x == null) {
          const vertex = pt(it.vertex), arm1 = pt(it.arm1), arm2 = pt(it.arm2);
          if (!vertex || !arm1 || !arm2) return null; // malformed legacy protractor — drop
          const arm1x = arm1.x - vertex.x, arm1y = arm1.y - vertex.y;
          const arm2x = arm2.x - vertex.x, arm2y = arm2.y - vertex.y;
          const r = Math.max(Math.hypot(arm1x, arm1y), Math.hypot(arm2x, arm2y));
          const rot = Math.atan2(arm1y, arm1x);
          return { id: it.id || genId(), kind: 'protractor', x: vertex.x, y: vertex.y, radius: r, rotation: rot };
        }
        if (it.kind === 'compass' && it.center != null && it.x == null) {
          const center = pt(it.center);
          if (!center) return null; // malformed legacy compass — drop
          const r0 = it.r || 80;
          return { id: it.id || genId(), kind: 'compass', pivot: { x: center.x, y: center.y }, pencil: { x: center.x + r0, y: center.y }, radius: r0 };
        }
      } catch (_) { return null; } // any unexpected shape — skip, never throw into #boot-error
      return it;
    }).filter(Boolean);
  }
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
