/* Events S7 offline kit desk service worker (spec docs/design/events-s7-hardening-and-pilot.md §3.14).
 * Scope: /organizer/kit-desk/ only. The rest of the portal never sees this worker.
 * - The desk page (any query string) and /_next/static/* chunks: cache first, so the page opens with no network.
 *   The page itself is refreshed in the background (stale while revalidate) so a deploy is picked up on the next open.
 * - Other same-origin GETs: network first, falling back to the cache. Cross-origin requests (the API) are never touched, never cached.
 * - An updated worker waits; the page applies it only when no scan is being saved and nothing is sending (message "skip-waiting").
 * No ticket data, token or API response ever passes through this file. */
const VERSION = 'kit-desk-v1';
const CACHE = VERSION + '-shell';
const PAGE = '/organizer/kit-desk/';

self.addEventListener('install', () => {
  // No skipWaiting() here: the first install activates by itself (no active worker), an update waits for the page's message.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('kit-desk-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function putSafe(cache, request, response) {
  try { if (response && response.ok) await cache.put(request, response.clone()); } catch (e) { /* quota or opaque: ignore */ }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' && url.pathname.startsWith(PAGE)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(PAGE);
      const refresh = fetch(PAGE, { cache: 'no-cache' }).then(res => { putSafe(cache, PAGE, res); return res; }).catch(() => null);
      if (cached) { event.waitUntil(refresh); return cached; }
      const res = await refresh;
      if (res) return res;
      return new Response('Hakuna intaneti / No internet connection', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      // ignoreSearch: production chunks are content-hashed, so the file name alone identifies them; `next dev` adds a changing ?v= that must not defeat the cache.
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      putSafe(cache, req, res);
      return res;
    })());
    return;
  }

  // Network first for everything else on this origin (fonts, icons, the manifest); the cache is only a fallback.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try { const res = await fetch(req); putSafe(cache, req, res); return res; }
    catch (e) { const hit = await cache.match(req); if (hit) return hit; throw e; }
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];
  if (data.type === 'skip-waiting') { self.skipWaiting(); return; }
  if (data.type === 'precache') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const urls = Array.isArray(data.urls) ? data.urls : [];
      let ok = 0;
      for (const u of urls) {
        try {
          const abs = new URL(u, self.location.origin);
          if (abs.origin !== self.location.origin) continue;
          if (!(abs.pathname.startsWith('/_next/static/') || abs.pathname === PAGE)) continue;
          if (await cache.match(abs.pathname === PAGE ? PAGE : abs.href, { ignoreSearch: true })) { ok++; continue; }
          const res = await fetch(abs.pathname === PAGE ? PAGE : abs.href, { cache: 'reload' });
          if (res.ok) { await cache.put(abs.pathname === PAGE ? PAGE : abs.href, res); ok++; }
        } catch (e) { /* skip this one */ }
      }
      const pageCached = !!(await cache.match(PAGE));
      const reply = { type: 'shell-status', cached: pageCached, files: ok };
      if (port) port.postMessage(reply);
      else if (event.source) event.source.postMessage(reply);
    })());
    return;
  }
  if (data.type === 'refresh-shell') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      try { const res = await fetch(PAGE, { cache: 'reload' }); await putSafe(cache, PAGE, res); } catch (e) { /* offline: keep what we have */ }
      const reply = { type: 'shell-refreshed' };
      if (port) port.postMessage(reply); else if (event.source) event.source.postMessage(reply);
    })());
  }
});
