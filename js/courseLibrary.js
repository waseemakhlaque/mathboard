// courseLibrary.js — Course Library: browse animated worked-example lessons grouped
// as Course → Topic → Exercise → Example. An "example" is just a notebook tagged with
// nb.catalog = { course, topic, exercise }. Taxonomy (the empty shelves) comes from
// content/catalog.json, with an embedded fallback so it works fully offline.

// Minimal embedded fallback — used only if content/catalog.json can't be fetched.
const FALLBACK_TAXONOMY = {
  version: 1,
  courses: [
    { name: 'Pure Mathematics 3', topics: [
      { name: 'Vectors', exercises: ['Lines in 3D', 'Scalar product & angles'] },
      { name: 'Complex numbers', exercises: ['Argand diagram', 'Loci'] },
      { name: 'Integration', exercises: ['By substitution', 'By parts'] },
    ] },
    { name: 'Mechanics', topics: [
      { name: 'Kinematics', exercises: ['Constant acceleration (suvat)', 'Velocity-time graphs'] },
      { name: 'Motion on a slope', exercises: ['Rough inclines with friction'] },
      { name: 'Projectiles', exercises: ['Projection at an angle'] },
    ] },
    { name: 'Statistics', topics: [
      { name: 'The normal distribution', exercises: ['Finding probabilities'] },
      { name: 'Probability', exercises: ['Tree diagrams'] },
    ] },
    { name: 'O Level — Transformation', topics: [
      { name: 'Reflection', exercises: ['Reflection in y = x and y = -x'] },
      { name: 'Rotation', exercises: ['Rotation about a point'] },
      { name: 'Enlargement', exercises: ['Finding centre & scale factor'] },
    ] },
  ],
};

let cachedTaxonomy = null;

/** Load the course taxonomy (network-first via SW cache, embedded fallback). */
export async function loadTaxonomy() {
  if (cachedTaxonomy) return cachedTaxonomy;
  try {
    const res = await fetch('./content/catalog.json', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.courses)) {
        cachedTaxonomy = data;
        return cachedTaxonomy;
      }
    }
  } catch (_) { /* offline or missing — fall through */ }
  cachedTaxonomy = FALLBACK_TAXONOMY;
  return cachedTaxonomy;
}

/** Flat list of {name} courses from taxonomy (for the tag picker). */
export function taxonomyCourses(tax) {
  return (tax?.courses || []).map((c) => c.name);
}
export function taxonomyTopics(tax, course) {
  return (tax?.courses || []).find((c) => c.name === course)?.topics?.map((t) => t.name) || [];
}
export function taxonomyExercises(tax, course, topic) {
  const c = (tax?.courses || []).find((x) => x.name === course);
  return c?.topics?.find((t) => t.name === topic)?.exercises || [];
}

/** Read & lightly normalize a notebook's catalog tag. */
export function notebookCatalog(nb) {
  const c = nb?.catalog;
  const course = String(c?.course ?? '').trim();
  if (!c || !course) return null;
  return {
    course,
    topic: String(c.topic || 'General').trim() || 'General',
    exercise: String(c.exercise || 'Examples').trim() || 'Examples',
    order: Number.isFinite(c.order) ? c.order : 0,
  };
}

/** Is this notebook filed in the Course Library? */
export function isCatalogued(nb) { return !!notebookCatalog(nb); }

/**
 * Build an ordered tree: taxonomy provides the shelves (so empty exercises still show),
 * and tagged notebooks are slotted in. Courses/topics/exercises present only in notebooks
 * (not in the taxonomy) are appended so nothing is ever hidden.
 */
export function buildCourseTree(notebooks, tax) {
  const courses = new Map(); // name -> { name, topics: Map }

  const ensureCourse = (name) => {
    if (!courses.has(name)) courses.set(name, { name, topics: new Map() });
    return courses.get(name);
  };
  const ensureTopic = (course, name) => {
    if (!course.topics.has(name)) course.topics.set(name, { name, exercises: new Map() });
    return course.topics.get(name);
  };
  const ensureExercise = (topic, name) => {
    if (!topic.exercises.has(name)) topic.exercises.set(name, { name, examples: [] });
    return topic.exercises.get(name);
  };

  // 1) seed the shelves from taxonomy (in declared order)
  for (const c of tax?.courses || []) {
    const cName = String(c?.name ?? '').trim();
    if (!cName) continue;
    const course = ensureCourse(cName);
    for (const t of c.topics || []) {
      const tName = String(t?.name ?? '').trim();
      if (!tName) continue;
      const topic = ensureTopic(course, tName);
      for (const exName of t.exercises || []) {
        const eName = String(exName ?? '').trim();
        if (eName) ensureExercise(topic, eName);
      }
    }
  }

  // 2) slot the actual tagged notebooks (creating any missing shelves)
  for (const nb of notebooks || []) {
    const cat = notebookCatalog(nb);
    if (!cat) continue;
    const course = ensureCourse(cat.course);
    const topic = ensureTopic(course, cat.topic);
    const exercise = ensureExercise(topic, cat.exercise);
    if (exercise.examples.some((x) => x.nb.id === nb.id)) continue;
    exercise.examples.push({ nb, order: cat.order });
  }

  // 3) materialize to arrays, sorting examples by order then title
  const out = [];
  for (const c of courses.values()) {
    const topics = [];
    for (const t of c.topics.values()) {
      const exercises = [];
      for (const ex of t.exercises.values()) {
        ex.examples.sort((a, b) => (a.order - b.order) || a.nb.title.localeCompare(b.nb.title));
        exercises.push(ex);
      }
      topics.push({ name: t.name, exercises });
    }
    const count = topics.reduce((n, t) => n + t.exercises.reduce((m, e) => m + e.examples.length, 0), 0);
    out.push({ name: c.name, topics, count });
  }
  return out;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const COURSE_ICONS = ['📐', '⚙️', '📊', '🔄', '∫', '△', '∞'];

function courseIcon(name, i) {
  const n = (name || '').toLowerCase();
  if (n.includes('mechanic')) return '⚙️';
  if (n.includes('stat')) return '📊';
  if (n.includes('pure')) return '∫';
  if (n.includes('level')) return '🔄';
  return COURSE_ICONS[i % COURSE_ICONS.length];
}

function isRecent(nb) {
  const week = 7 * 864e5;
  return nb?.updated && (Date.now() - nb.updated) < week;
}

/**
 * Render the course tree into `container`.
 * opts: { notebooks, taxonomy, onOpen(id), thumb(nb)->html, search }
 */
export function renderCourseLibrary(container, opts = {}) {
  const { notebooks = [], taxonomy, onOpen, thumb, search = '' } = opts;
  const tree = buildCourseTree(notebooks, taxonomy);
  const q = search.trim().toLowerCase();
  container.innerHTML = '';

  const totalExamples = tree.reduce((n, c) => n + c.count, 0);
  if (totalExamples === 0 && !q) {
    container.innerHTML = `<div class="course-empty lib-empty-state">
      <div class="lib-empty-icon">★</div>
      <h2>Course Library</h2>
      <p class="muted">Build animated worked examples, then file them here for one-tap classroom playback.</p>
      <p class="muted">Open a lesson → Scene bar → <b>Add to Course Library</b>.</p>
    </div>`;
    return;
  }

  let courseIdx = 0;

  const matches = (nb) => !q || (nb.title || '').toLowerCase().includes(q);

  for (const course of tree) {
    const courseMatchCount = course.topics.reduce(
      (n, t) => n + t.exercises.reduce((m, e) => m + e.examples.filter((x) => matches(x.nb)).length, 0), 0,
    );
    if (q && courseMatchCount === 0) continue;

    const cDet = document.createElement('details');
    cDet.className = 'course-node';
    cDet.open = true;
    const cCount = q ? courseMatchCount : course.count;
    cDet.innerHTML = `<summary class="course-sum">
        <span class="course-cover" aria-hidden="true">${courseIcon(course.name, courseIdx++)}</span>
        <span class="course-name">${esc(course.name)}</span>
        <span class="course-count">${cCount} example${cCount === 1 ? '' : 's'}</span>
      </summary>`;
    const cBody = document.createElement('div');
    cBody.className = 'course-body';

    for (const topic of course.topics) {
      const tCount = topic.exercises.reduce(
        (m, e) => m + e.examples.filter((x) => matches(x.nb)).length, 0,
      );
      if (q && tCount === 0) continue;

      const tDet = document.createElement('details');
      tDet.className = 'topic-node';
      tDet.open = !!q || tCount > 0;
      tDet.innerHTML = `<summary class="topic-sum">
          <span class="topic-name">${esc(topic.name)}</span>
          <span class="topic-count">${tCount}</span>
        </summary>`;
      const tBody = document.createElement('div');
      tBody.className = 'topic-body';

      for (const ex of topic.exercises) {
        const exMatches = ex.examples.filter((x) => matches(x.nb));
        if (q && exMatches.length === 0) continue;
        const exWrap = document.createElement('div');
        exWrap.className = 'exercise-node';
        exWrap.innerHTML = `<div class="exercise-name">${esc(ex.name)}</div>`;
        const grid = document.createElement('div');
        grid.className = 'example-grid';

        if (exMatches.length === 0) {
          grid.innerHTML = `<div class="example-empty muted">No examples yet</div>`;
        } else {
          exMatches.forEach(({ nb }) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'example-card';
            card.title = `Play “${(nb.title || 'Untitled').replace(/"/g, '\u201d')}”`;
            const thumbHtml = thumb ? thumb(nb) : '<div class="example-thumb"></div>';
            const newBadge = isRecent(nb) ? '<span class="badge-new">New</span>' : '';
            const doneBadge = nb.viewed ? '<span class="badge-done" title="Viewed">✓</span>' : '';
            card.innerHTML = `${thumbHtml}${newBadge}${doneBadge}
              <div class="example-meta">
                <div class="example-title">${esc(nb.title)}</div>
                <div class="example-play">▶ Play animated solution</div>
              </div>`;
            card.addEventListener('click', () => onOpen?.(nb.id));
            grid.appendChild(card);
          });
        }
        exWrap.appendChild(grid);
        tBody.appendChild(exWrap);
      }
      tDet.appendChild(tBody);
      cBody.appendChild(tDet);
    }
    cDet.appendChild(cBody);
    container.appendChild(cDet);
  }

  if (!container.children.length) {
    container.innerHTML = `<p class="muted course-empty">No examples match your search.</p>`;
  }
}

/** Deep link from RAG search: open the course + topic shelves and scroll there. */
export function expandCoursePath(container, course, topic) {
  for (const cDet of container.querySelectorAll('details.course-node')) {
    if (cDet.querySelector('.course-name')?.textContent !== course) continue;
    cDet.open = true;
    for (const tDet of cDet.querySelectorAll('details.topic-node')) {
      if (tDet.querySelector('.topic-name')?.textContent !== topic) continue;
      tDet.open = true;
      tDet.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    cDet.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
}
