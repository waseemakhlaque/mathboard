// librarySearch.js — fuzzy lesson search via Fuse.js (title + page text/equations).

/** All searchable plain text from a notebook (for indexing). */
export function notebookSearchBlob(nb) {
  const parts = [nb.title || ''];
  for (const sec of nb.sections || []) {
    if (sec.title) parts.push(sec.title);
    for (const pg of sec.pages || []) {
      for (const o of pg.objects || []) {
        if (o.kind === 'text' && o.text) parts.push(o.text);
        if (o.kind === 'equation' && o.latex) parts.push(o.latex.replace(/\\/g, ' '));
      }
    }
  }
  return parts.join('\n');
}

function plainMatch(nb, q) {
  const lower = q.toLowerCase();
  if ((nb.title || '').toLowerCase().includes(lower)) return true;
  return notebookSearchBlob(nb).toLowerCase().includes(lower);
}

/** Filter notebooks by query — Fuse when loaded, substring fallback offline-safe. */
export function filterNotebooksBySearch(notebooks, q) {
  const query = (q || '').trim();
  if (!query) return notebooks;
  if (typeof window.Fuse !== 'function') return notebooks.filter((nb) => plainMatch(nb, query));

  const rows = notebooks.map((nb) => ({ nb, title: nb.title || '', text: notebookSearchBlob(nb) }));
  const fuse = new window.Fuse(rows, {
    keys: [{ name: 'title', weight: 0.45 }, { name: 'text', weight: 0.55 }],
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2,
    distance: 120,
  });
  return fuse.search(query).map((r) => r.item.nb);
}
