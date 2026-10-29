// Copia local de Orbe IM Analyzer para que funcione sin internet.
// ARCHIVO GENERADO por scripts/sw.mjs al compilar: no editar a mano.
// VERSION es la huella del contenido; cambia sola cuando cambia cualquier archivo.
const VERSION = 'orbe-im-457fa4ed4ad9';
const ARCHIVOS = ["./", "./icono-192.png", "./icono-512.png", "./icono-maskable-512.png", "./icono.svg", "./index.html", "./js/engine/analysis.js", "./js/engine/bytes.js", "./js/engine/classify.js", "./js/engine/combinatorics.js", "./js/engine/csv.js", "./js/engine/enumerate.js", "./js/engine/export.js", "./js/engine/freq.js", "./js/engine/importers.js", "./js/engine/index.js", "./js/engine/lab.js", "./js/engine/match.js", "./js/engine/model.js", "./js/engine/project.js", "./js/engine/results.js", "./js/engine/xlsx.js", "./js/engine/zip.js", "./js/ui/analyzer.js", "./js/ui/audit.js", "./js/ui/calculator.js", "./js/ui/compute.js", "./js/ui/dom.js", "./js/ui/lab.js", "./js/ui/main.js", "./js/ui/panel.js", "./js/ui/params.js", "./js/ui/pwa.js", "./js/ui/signals.js", "./js/ui/spectrum.js", "./js/ui/state.js", "./js/ui/table.js", "./js/ui/worker.js", "./manifest.json", "./styles.css"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('orbe-im-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Solo los archivos de esta app (otras apps pueden compartir el mismo dominio de GitHub Pages).
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  // Con internet, siempre la versión más reciente (y se actualiza la copia);
  // sin internet o si la red tarda más de 3 s, la copia guardada.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const red = fetch(e.request, { cache: 'no-cache' }).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    const guardada = await cache.match(e.request, { ignoreSearch: true });
    if (!guardada) return red;
    return Promise.race([red.catch(() => guardada), new Promise((r) => setTimeout(() => r(guardada), 3000))]);
  })());
});
