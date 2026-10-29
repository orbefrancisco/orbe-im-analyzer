// Genera web/sw.js: lista ARCHIVOS con todo lo que hay en web/ y fija VERSION
// a partir de la huella SHA-256 del contenido. Así, cualquier cambio en la app
// produce una versión nueva y los dispositivos instalados se actualizan.
// Se ejecuta en «npm run build», después de compilar.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const EXCLUIR = new Set(['sw.js']);

function listar(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n.startsWith('.')) return [];
    return statSync(p).isDirectory() ? listar(p) : [p];
  });
}

const archivos = listar(WEB).map((p) => relative(WEB, p).split(sep).join('/')).filter((r) => !EXCLUIR.has(r)).sort();
const h = createHash('sha256');
for (const r of archivos) { h.update(r); h.update(readFileSync(join(WEB, r))); }
const version = 'orbe-im-' + h.digest('hex').slice(0, 12);
const lista = ['./', ...archivos.map((r) => './' + r)];

const sw = `// Copia local de Orbe IM Analyzer para que funcione sin internet.
// ARCHIVO GENERADO por scripts/sw.mjs al compilar: no editar a mano.
// VERSION es la huella del contenido; cambia sola cuando cambia cualquier archivo.
const VERSION = '${version}';
const ARCHIVOS = ${JSON.stringify(lista, null, 0).replace(/","/g, '", "')};

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
`;
writeFileSync(join(WEB, 'sw.js'), sw);
console.log(`sw.js: ${version}, ${lista.length} archivos`);
