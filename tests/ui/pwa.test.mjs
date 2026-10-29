// Coherencia de la PWA: manifiesto, iconos y lista de archivos del service worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const listar = (d) => readdirSync(d).flatMap((n) => (n.startsWith('.') ? [] : statSync(join(d, n)).isDirectory() ? listar(join(d, n)) : [join(d, n)]));
const archivos = listar(WEB).map((p) => relative(WEB, p).split(sep).join('/')).filter((r) => r !== 'sw.js').sort();
const sw = readFileSync(join(WEB, 'sw.js'), 'utf-8');

test('sw.js lista exactamente los archivos de web/ (sin olvidos ni sobrantes)', () => {
  const lista = JSON.parse(/const ARCHIVOS = (\[.*?\]);/s.exec(sw)[1]);
  assert.deepEqual(lista, ['./', ...archivos.map((r) => './' + r)], 'ejecute «node scripts/sw.mjs» tras compilar');
});

test('VERSION de sw.js es la huella del contenido actual', () => {
  const h = createHash('sha256');
  for (const r of archivos) { h.update(r); h.update(readFileSync(join(WEB, r))); }
  assert.match(sw, new RegExp(`const VERSION = 'orbe-im-${h.digest('hex').slice(0, 12)}'`), 'la versión no corresponde al contenido: ejecute «node scripts/sw.mjs»');
});

test('manifiesto e iconos válidos', () => {
  const m = JSON.parse(readFileSync(join(WEB, 'manifest.json'), 'utf-8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './index.html');
  assert.equal(m.scope, './');
  for (const ic of m.icons) {
    const b = readFileSync(join(WEB, ic.src));
    if (ic.type === 'image/png') {
      assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ic.src);
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
      assert.equal(`${w}x${h}`, ic.sizes, ic.src);
    }
  }
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512') && m.icons.some((i) => i.purpose === 'maskable'));
  const html = readFileSync(join(WEB, 'index.html'), 'utf-8');
  assert.match(html, /rel="manifest" href="manifest.json"/);
  assert.ok(!/(src|href)="\//.test(html), 'rutas relativas (GitHub Pages sirve en un subdirectorio)');
});
