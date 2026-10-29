/**
 * Comparación con un cálculo independiente en Python (fracciones exactas,
 * producto cartesiano completo, sin poda): tests/reference/brute_force.py.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { enumerateProducts, parseFrequency } from '../src/engine/index.js';

const here = dirname(fileURLToPath(import.meta.url)); // .build-test/tests
const root = resolve(here, '..', '..');

const CASES = [
  { name: 'dos tonos, orden 9, banda FM', freqs: ['89.30', '89.58'], maxOrder: 9, maxTones: 2, harmonics: true, range: ['88', '108'] },
  { name: 'tres tonos, orden 7, banda FM', freqs: ['89.30', '89.58', '90.10'], maxOrder: 7, maxTones: 3, harmonics: true, range: ['88', '108'] },
  { name: 'cuatro tonos, orden 5, banda FM', freqs: ['89.30', '89.58', '90.10', '93.70'], maxOrder: 5, maxTones: 4, harmonics: true, range: ['88', '108'] },
  { name: 'cinco emisoras, orden 5, 3 tonos, sin armónicos, 0–600 MHz', freqs: ['89.30', '89.58', '90.10', '93.70', '95.90'], maxOrder: 5, maxTones: 3, harmonics: false, range: ['0.000001', '600'] },
  { name: 'equiespaciadas con decimales difíciles', freqs: ['100.1', '100.2', '100.3', '107.123457'], maxOrder: 6, maxTones: 4, harmonics: true, range: ['50', '250'] },
];

test('el motor TypeScript coincide exactamente con la referencia independiente en Python', () => {
  const out = CASES.map((c) => {
    const f = c.freqs.map((x) => parseFrequency(x).hz);
    const lo = parseFrequency(c.range[0]).hz, hi = parseFrequency(c.range[1]).hz;
    const e = enumerateProducts(f, { maxOrder: c.maxOrder, maxTones: c.maxTones, includeHarmonics: c.harmonics, outputRange: { minHz: lo, maxHz: hi }, workBudget: 1e9, maxCombos: 1e7 });
    assert.equal(e.complete, true);
    const products: [number, number[]][] = [];
    for (let k = 0; k < e.store.count; k++) {
      const v = new Array(f.length).fill(0);
      for (let t = e.store.termStart[k]; t < e.store.termStart[k + 1]; t++) v[e.store.termIdx[t]] = e.store.termCoef[t];
      products.push([e.store.freqHz[k], v]);
    }
    return { ...c, products };
  });
  const file = join(root, '.build-test', 'reference_cases.json');
  writeFileSync(file, JSON.stringify(out));
  const py = execFileSync('python3', ['-I', join(root, 'tests', 'reference', 'brute_force.py'), '--check', file], { encoding: 'utf-8' });
  assert.match(py, /TODOS LOS CASOS COINCIDEN/);
});
