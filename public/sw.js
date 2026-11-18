// Offline support.
// - Static assets: cache first, refreshed in background (new CSS/JS shows on the next load).
// - Priority pages (/priority/CODE, saved answers are inside): network-first, last good copy kept for offline.
//   Pages post {sync: [urls]} on load (see SW_SCRIPT in views.tsx); refreshed at most every 10 min,
//   and right after any edit (any non-GET request resets the timer).
// - Answer figures (/fig/*.svg): cache-first; every figure a saved priority page uses is fetched with it.
// - Other pages offline → list of saved pages.
// Nothing else is cached: data stays fresh online, and /logout sends Clear-Site-Data to wipe these copies.
const STATIC = 'pyq-static-v10';
const PAGES = 'pyq-pages-v2';
const FIGS = 'pyq-fig-v1';
const ASSETS = ['/app.css', '/htmx.min.js', '/upload.js', '/search.js', '/shell.js', '/cards.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png',
  '/fonts/KevinSans-Regular.woff2', '/fonts/KevinSans-Bold.woff2'];
const SAVED = /^\/(priority|cards)\/[A-Za-z0-9]+$/;
const SYNCED = '/__synced';
const SYNC_EVERY = 10 * 60 * 1000;

self.addEventListener('install', (e) => { e.waitUntil(caches.open(STATIC).then((c) => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== STATIC && k !== PAGES && k !== FIGS).map((k) => caches.delete(k)))));
  self.clients.claim();
});

async function store(path, res) {
  if (!res.ok || res.redirected || res.type !== 'basic') return;
  const html = await res.clone().text();
  await (await caches.open(PAGES)).put(path, res);
  const figs = await caches.open(FIGS);
  const urls = [...new Set(html.match(/\/fig\/[a-z0-9-]+\.svg/g) || [])];
  await Promise.all(urls.map(async (f) => { if (!(await figs.match(f))) await figs.add(f).catch(() => {}); }));
}

self.addEventListener('message', (e) => {
  const urls = e.data && e.data.sync;
  if (!Array.isArray(urls)) return;
  e.waitUntil((async () => {
    const c = await caches.open(PAGES);
    const t = await c.match(SYNCED);
    if (t && Date.now() - Number(await t.text()) < SYNC_EVERY) return;
    await c.put(SYNCED, new Response(String(Date.now())));
    await Promise.all(urls.filter((u) => SAVED.test(u)).map((u) => fetch(u).then((r) => store(u, r)).catch(() => {})));
  })());
});

function offlinePage(msg, paths) {
  const links = paths.map((p) => `<li><a href="${p}">${(p.startsWith('/cards') ? 'Cards · ' : 'Priority · ') + p.split('/')[2]}</a></li>`).join('');
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · PYQ Brain</title>` +
      `<link rel="stylesheet" href="/app.css"><nav><strong>PYQ Brain</strong></nav><main><h1>Offline</h1><p>${msg}</p>` +
      (links ? `<h2>Saved on this phone</h2><ul>${links}</ul>` : '<p class="muted">Nothing saved yet. Open the app once while online.</p>') +
      `</main>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

async function savedPaths() {
  const keys = await (await caches.open(PAGES)).keys();
  return keys.map((k) => new URL(k.url).pathname).filter((p) => SAVED.test(p)).sort();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  if (req.method !== 'GET') {
    e.waitUntil(caches.open(PAGES).then((c) => c.delete(SYNCED))); // data changed → next page load re-syncs
    return;
  }
  if (ASSETS.includes(u.pathname)) {
    const fresh = fetch(req).then(async (r) => { if (r.ok) await (await caches.open(STATIC)).put(req, r.clone()); return r; });
    e.waitUntil(fresh.catch(() => {}));
    e.respondWith(caches.match(req).then((r) => r || fresh));
  } else if (u.pathname.startsWith('/fig/')) {
    e.respondWith(caches.open(FIGS).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
  } else if (SAVED.test(u.pathname)) {
    e.respondWith(
      fetch(req)
        .then((r) => { e.waitUntil(store(u.pathname, r.clone())); return r; })
        .catch(async () => (await caches.match(u.pathname, { cacheName: PAGES })) || offlinePage('This page is not saved yet.', await savedPaths())),
    );
  } else if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => offlinePage('No internet.', await savedPaths())));
  }
});
