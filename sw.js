// sw.js — offline support.
// Same-origin app files: network-first (always get the latest, fall back to cache offline).
// Cross-origin CDN (jsPDF): cache-first (immutable, fine to pin).
const CACHE = 'mathboard-v47';
// NOTE: js/collab/* is intentionally NOT precached — collaboration is loaded only via dynamic
// import() when collabAvailable() is true, so the offline solo app never fetches it.
const ASSETS = [
  './',
  './index.html',
  './config.js',
  './css/app.css',
  './js/app.js',
  './js/geo.js',
  './js/mech.js',
  './js/cplx.js',
  './js/calculus.js',
  './js/instruments.js',
  './js/model.js',
  './js/share.js',
  './js/storage.js',
  './manifest.json',
  './assets/icon.svg',
  './assets/logo.svg',
  './assets/waseem.jpg',
  './vendor/jspdf.umd.min.js',
  './vendor/jsxgraphcore.js',
  './vendor/jsxgraph.css',
  './vendor/mathlive.min.js',
  './vendor/mathlive.css',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/math.min.js',
  './vendor/simple-statistics.min.js',
  './vendor/uPlot.iife.min.js',
  './vendor/uPlot.min.css',
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

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
  const sameOrigin = new URL(req.url).origin === self.location.origin;

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
