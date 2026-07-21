// sw.js — offline support.
// Same-origin app files: network-first (always get the latest, fall back to cache offline).
// Cross-origin CDN (jsPDF): cache-first (immutable, fine to pin).
const CACHE = 'mathboard-v148';
// NOTE: js/collab/* is intentionally NOT precached — collaboration is loaded only via dynamic
// import() when collabAvailable() is true, so the offline solo app never fetches it.
const ASSETS = [
  './index.html',
  './config.js',
  './css/app.css',
  './css/annotatedSim.css',
  './js/app.js',
  './js/blobs.js',
  './js/pdfPages.js',
  './js/layers.js',
  './js/scene.js',
  './js/graphView.js',
  './js/geo.js',
  './js/mech.js',
  './js/cplx.js',
  './js/calculus.js',
  './js/symbolic.js',
  './js/algebra.js',
  './js/rationals.js',
  './js/librarySearch.js',
  './js/courseLibrary.js',
  './js/ragSearch.js',
  './js/snipSim.js',
  './js/annotatedSim.js',
  './js/annotationSync.js',
  './js/anim/mbAnim.js',
  './js/anim/suvatAnim.js',
  './js/anim/vectorLinesAnim.js',
  './js/anim/mbLab.js',
  './js/anim/inclineLab.js',
  './js/anim/pulleyLab.js',
  './js/anim/suvatLab.js',
  './js/anim/forcesParticleLab.js',
  './js/anim/projectileLab.js',
  './js/anim/quadraticLab.js',
  './js/anim/tangentLab.js',
  './js/anim/motionGraphLab.js',
  './js/anim/connectedLab.js',
  './js/anim/momentumLab.js',
  './js/anim/energyLab.js',
  './js/anim/simRegistry.js',
  './js/anim/ragRoutes.js',
  './content/catalog.json',
  './js/pageLayout.js',
  './vendor/fuse.min.js',
  './vendor/fraction.min.js',
  './js/instruments.js',
  './js/model.js',
  './js/share.js',
  './js/auth.js',
  './js/users.js',
  './js/theme.js',
  './js/entitlement.js',
  './js/gate.js',
  './js/adminPanel.js',
  './js/papersLibrary.js',
  './js/onboarding.js',
  './js/installBanner.js',
  './js/storage.js',
  './js/studio/studioManager.js',
  './js/studio/mathObjectFactory.js',
  './js/studio/liveStudioView.js',
  './manifest.json',
  './assets/icon.svg',
  './assets/logo.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/waseem.jpg',
  './vendor/jspdf.umd.min.js',
  './vendor/jsxgraphcore.js',
  './vendor/jsxgraph.css',
  './vendor/mathlive.min.js',
  './vendor/mathlive.css',
  './vendor/katex.min.js',
  './vendor/katex.min.css',
  './vendor/nerdamer.core.js',
  './vendor/nerdamer.Algebra.js',
  './vendor/nerdamer.Calculus.js',
  './vendor/nerdamer.Solve.js',
  './vendor/pickr.min.js',
  './vendor/pickr.nano.min.css',
  './vendor/rough.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/math.min.js',
  './vendor/simple-statistics.min.js',
  './vendor/uPlot.iife.min.js',
  './vendor/uPlot.min.css',
  './vendor/three.min.js',
  './vendor/perfect-freehand.mjs',
  './vendor/fonts/inter/inter-400.woff2',
  './vendor/fonts/inter/inter-500.woff2',
  './vendor/fonts/inter/inter-600.woff2',
  './vendor/fonts/inter/inter-700.woff2',
  './vendor/fonts/KaTeX_AMS-Regular.woff2',
  './vendor/fonts/KaTeX_Caligraphic-Bold.woff2',
  './vendor/fonts/KaTeX_Caligraphic-Regular.woff2',
  './vendor/fonts/KaTeX_Fraktur-Bold.woff2',
  './vendor/fonts/KaTeX_Fraktur-Regular.woff2',
  './vendor/fonts/KaTeX_Main-Bold.woff2',
  './vendor/fonts/KaTeX_Main-BoldItalic.woff2',
  './vendor/fonts/KaTeX_Main-Italic.woff2',
  './vendor/fonts/KaTeX_Main-Regular.woff2',
  './vendor/fonts/KaTeX_Math-BoldItalic.woff2',
  './vendor/fonts/KaTeX_Math-Italic.woff2',
  './vendor/fonts/KaTeX_SansSerif-Bold.woff2',
  './vendor/fonts/KaTeX_SansSerif-Italic.woff2',
  './vendor/fonts/KaTeX_SansSerif-Regular.woff2',
  './vendor/fonts/KaTeX_Script-Regular.woff2',
  './vendor/fonts/KaTeX_Size1-Regular.woff2',
  './vendor/fonts/KaTeX_Size2-Regular.woff2',
  './vendor/fonts/KaTeX_Size3-Regular.woff2',
  './vendor/fonts/KaTeX_Size4-Regular.woff2',
  './vendor/fonts/KaTeX_Typewriter-Regular.woff2',
];

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (e) => {
  // Promise.allSettled: one bad URL must not abort the whole SW (Cloudflare rejects './').
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(ASSETS.map((url) => c.add(url))).then(() => self.skipWaiting())
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return; // RAG API: network-only, never cached
  // Gated corpus (papers/books): session-checked at the Worker, PDFs stay out of
  // the SW cache. catalog.json is public app data and keeps its offline copy.
  if (url.pathname.startsWith('/content/') && url.pathname !== '/content/catalog.json') return;
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req))
    );
  } else {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
  }
});
