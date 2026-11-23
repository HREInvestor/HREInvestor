/* REPS Log service worker: offline app shell + Web Push. */
const CACHE = 'reps-shell-v2';
const SHELL = [
  './', './index.html', './app.css?v=2', './app.js?v=2', './manifest.webmanifest',
  './vendor/supabase-2.119.2.js', './vendor/jszip-3.10.1.min.js', './vendor/jspdf-2.5.2.umd.min.js', './vendor/jspdf-autotable-3.8.4.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('reps-shell-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith('/reps/')) return; // never cache Supabase/API traffic
  if (req.mode === 'navigate') {
    // network-first for the page so updates arrive; fall back to cache offline
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // stale-while-revalidate for static assets
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'REPS Log';
  const tell = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'reps-push', title, body: d.body || '' })));
  e.waitUntil(Promise.all([tell, self.registration.showNotification(title, {
    body: d.body || 'Time to log your real estate hours.',
    icon: '/reps/icons/icon-192.png', badge: '/reps/icons/icon-192.png',
    tag: d.tag || 'reps', renotify: true, data: { url: d.url || '/reps/#log' }
  })]));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/reps/#log', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes('/reps/')) { c.navigate(target).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
