/* Service worker — « réseau d'abord » en ligne, repli sur le cache hors-ligne */
/* Convention de version : le suffixe vN du cache suit APP_VERSION dans
   app.js (ex. '1.00' → 'chantier-v100'). Bumper les deux ensemble. */
const CACHE = 'chantier-v176';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* « Réseau d'abord » ne suffit pas : fetch() passe par le cache HTTP du
   navigateur, et l'hébergeur sert nos fichiers avec un max-age. Le service
   worker pouvait donc se faire servir une copie périmée, la ranger dans son
   propre cache, et l'application restait bloquée sur l'ancienne version
   malgré un rechargement forcé. On force donc le contournement du cache
   HTTP pour NOS fichiers — les ressources tierces gardent le comportement
   normal. */
const freshRequest = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS.map(freshRequest)))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Purge complète déclenchée depuis la page (bouton « Forcer la mise à
   jour ») : on vide tous les caches puis on se retire. */
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'PURGE') return;
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let sameOrigin = false;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (e) { /* URL exotique */ }
  // Les navigations gardent la requête d'origine (mode et redirections
  // intactes) ; les fichiers de l'app sont rechargés en ignorant le cache
  // HTTP, seul moyen fiable de récupérer la dernière version publiée.
  const netReq = (sameOrigin && req.mode !== 'navigate') ? freshRequest(req.url) : req;
  event.respondWith(
    fetch(netReq)
      .then((res) => {
        if (sameOrigin && res && res.ok && res.type !== 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
