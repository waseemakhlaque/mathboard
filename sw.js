// sw.js — offline support.
// Same-origin app files: network-first (always get the latest, fall back to cache offline).
// Cross-origin CDN (jsPDF): cache-first (immutable, fine to pin).
const CACHE = 'mathboard-v31';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/geo.js',
  './js/mech.js',
  './js/cplx.js',
  './js/instruments.js',
  './js/model.js',
  './js/share.js',
  './js/storage.js',
  './manifest.json',
  './assets/icon.svg',
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
