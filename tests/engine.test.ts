import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResultSet, comboKeyByIndex, comboTerms, enumerateProducts, estimateSearchSpace, filterCombos, findGroup, formatMHz,
  formulaNumeric, formulaSymbolic, groupCombos, orderLabel, runAnalysis, suggestReductions, summarize, comboKind,
} from '../src/engine/index.js';
import { gens, hz, naiveProducts, params } from './helpers.js';

// ------------------------------------------------------------------ caso obligatorio

test('caso obligatorio 89.30 / 89.58 MHz: IM3, IM5, IM7 e IM9 exactos', () => {
  const g = gens(['89.30', '89.58']);
  const run = runAnalysis(g, params({ maxOrder: 9, maxTones: 2 }));
  const rs = run.result;
  assert.equal(run.meta.complete, true);
  const expected: [string, string, string][] = [
    ['IM3', '89.02', '89.86'],
    ['IM5', '88.74', '90.14'],
    ['IM7', '88.46', '90.42'],
    ['IM9', '88.18', '90.70'],
  ];
  for (const [label, lo, hi] of expected) {
    for (const f of [lo, hi]) {
      const gi = findGroup(rs, hz(f));
      assert.ok(gi >= 0, `falta ${f} MHz`);
      const cs = groupCombos(rs, gi);
      assert.equal(cs.length, 1, `${f} MHz debe tener una sola combinación`);
      assert.equal(orderLabel(rs.store, cs[0]), label, `${f} MHz debe ser ${label}`);
      assert.equal(formatMHz(rs.groupFreq[gi]), f);
    }
  }
  // En la banda 88–108 con dos tonos solo caben productos con Σm_i = 1: exactamente los 8 anteriores.
  assert.equal(rs.groupCount, 8);
  assert.deepEqual(Array.from(rs.groupFreq).map((x) => formatMHz(x)), ['88.18', '88.46', '88.74', '89.02', '89.86', '90.14', '90.42', '90.70']);
});

test('fórmulas del caso obligatorio: 3(89.30) − 2(89.58) = 88.740 MHz', () => {
  const g = gens(['89.30', '89.58']);
  const rs = runAnalysis(g, params({ maxOrder: 9, maxTones: 2 })).result;
  const c = groupCombos(rs, findGroup(rs, hz('88.74')))[0];
  assert.equal(formulaNumeric(rs, c), '3(89.30) − 2(89.58)');
  assert.equal(formulaNumeric(rs, c, { ascii: true }), '3(89.30) - 2(89.58)');
  assert.equal(formulaSymbolic(rs, c), '3f1 − 2f2');
  assert.equal(formatMHz(rs.store.freqHz[c], 3), '88.740');
  assert.equal(rs.store.coefSum[c], 1);
  const up = groupCombos(rs, findGroup(rs, hz('89.86')))[0];
  assert.equal(formulaSymbolic(rs, up), '2f2 − f1');
  assert.equal(comboKind(rs.store, up), 'mixto');
});

test('dos tonos sin restricción de banda: armónicos, sumas y diferencias bien clasificados', () => {
  const g = gens(['89.30', '89.58']);
  const rs = runAnalysis(g, params({ maxOrder: 3, maxTones: 2, outputMode: 'todo' })).result;
  const get = (f: string) => groupCombos(rs, findGroup(rs, hz(f)));
  assert.equal(orderLabel(rs.store, get('178.60')[0]), 'H2');
  assert.equal(comboKind(rs.store, get('178.60')[0]), 'armonico');
  assert.equal(orderLabel(rs.store, get('178.88')[0]), 'IM2');
  assert.equal(comboKind(rs.store, get('178.88')[0]), 'suma');
  assert.equal(orderLabel(rs.store, get('0.28')[0]), 'IM2');
  assert.equal(comboKind(rs.store, get('0.28')[0]), 'mixto');
  assert.ok(findGroup(rs, hz('267.90')) >= 0, '3f1');
  assert.ok(findGroup(rs, hz('268.18')) >= 0, '2f1+f2');
  // sin armónicos
  const rs2 = runAnalysis(g, params({ maxOrder: 3, maxTones: 2, outputMode: 'todo', includeHarmonics: false })).result;
  assert.equal(findGroup(rs2, hz('178.60')), -1);
  assert.ok(findGroup(rs2, hz('178.88')) >= 0);
  for (let c = 0; c < rs2.store.count; c++) assert.notEqual(rs2.store.tones[c], 1);
});

// ------------------------------------------------------------------ tres y cuatro tonos

test('tres tonos: f1 + f2 − f3 = 88.78 MHz (orden 3)', () => {
  const g = gens(['89.30', '89.58', '90.10']);
  const rs = runAnalysis(g, params({ maxOrder: 3, maxTones: 3 })).result;
  const gi = findGroup(rs, hz('88.78'));
  assert.ok(gi >= 0);
  const cs = groupCombos(rs, gi);
  const three = cs.find((c) => rs.store.tones[c] === 3);
  assert.ok(three !== undefined);
  assert.deepEqual(comboTerms(rs.store, three as number), [{ index: 0, coef: 1 }, { index: 1, coef: 1 }, { index: 2, coef: -1 }]);
  assert.equal(formulaNumeric(rs, three as number), '89.30 + 89.58 − 90.10');
  assert.equal(orderLabel(rs.store, three as number), 'IM3');
});

test('cuatro tonos: 2f1 + f2 − f3 − f4 (IM5) y f1 + f2 + f3 − f4 fuera de banda', () => {
  const g = gens(['89.30', '89.58', '90.10', '93.70']);
  const exp = 2 * hz('89.30') + hz('89.58') - hz('90.10') - hz('93.70'); // 84.38 MHz
  assert.equal(formatMHz(exp), '84.38');
  const rsAll = runAnalysis(g, params({ maxOrder: 5, maxTones: 4, outputMode: 'todo' })).result;
  const gi = findGroup(rsAll, exp);
  assert.ok(gi >= 0);
  assert.ok(groupCombos(rsAll, gi).some((c) => comboKeyByIndex(rsAll.store, c) === '0:2|1:1|2:-1|3:-1'));
  const s2 = hz('89.30') + hz('89.58') + hz('90.10') - hz('93.70'); // 175.28 MHz
  const gj = findGroup(rsAll, s2);
  assert.ok(gj >= 0);
  assert.ok(groupCombos(rsAll, gj).some((c) => comboKeyByIndex(rsAll.store, c) === '0:1|1:1|2:1|3:-1'));
  // con banda FM, 84.38 y 175.28 quedan fuera
  const rsBand = runAnalysis(g, params({ maxOrder: 5, maxTones: 4 })).result;
  assert.equal(findGroup(rsBand, exp), -1);
  assert.equal(findGroup(rsBand, s2), -1);
});

// ------------------------------------------------------------------ exhaustividad frente a un enumerador independiente

test('la enumeración con poda coincide con el producto cartesiano completo (casos pequeños)', () => {
  const cases: { f: string[]; K: number; T: number; harm: boolean; mode: 'banda' | 'todo' }[] = [
    { f: ['89.30', '89.58'], K: 9, T: 2, harm: true, mode: 'banda' },
    { f: ['89.30', '89.58', '90.10'], K: 7, T: 3, harm: true, mode: 'banda' },
    { f: ['89.30', '89.58', '90.10'], K: 5, T: 2, harm: false, mode: 'todo' },
    { f: ['89.30', '89.58', '90.10', '93.70'], K: 5, T: 4, harm: true, mode: 'banda' },
    { f: ['89.30', '89.58', '90.10', '93.70'], K: 4, T: 3, harm: true, mode: 'todo' },
    { f: ['88.10', '88.30', '88.50', '107.90'], K: 5, T: 4, harm: true, mode: 'banda' }, // frecuencias equiespaciadas
  ];
  for (const k of cases) {
    const g = gens(k.f);
    const p = params({ maxOrder: k.K, maxTones: k.T, includeHarmonics: k.harm, outputMode: k.mode });
    const e = enumerateProducts(g.map((x) => x.freqHz), { maxOrder: p.maxOrder, maxTones: p.maxTones, minOrder: 2, includeHarmonics: p.includeHarmonics, outputRange: k.mode === 'banda' ? { minHz: p.band.minHz, maxHz: p.band.maxHz } : null, workBudget: 1e9, maxCombos: 1e7 });
    const got: string[] = [];
    for (let c = 0; c < e.store.count; c++) got.push(`${e.store.freqHz[c]}@${comboKeyByIndex(e.store, c)}`);
    got.sort();
    const lo = k.mode === 'banda' ? p.band.minHz : 1;
    const hi = k.mode === 'banda' ? p.band.maxHz : Infinity;
    const ref = naiveProducts(g.map((x) => x.freqHz), k.K, k.T, k.harm, lo, hi);
    assert.deepEqual(got, ref, `caso ${JSON.stringify(k)}`);
    assert.equal(new Set(got).size, got.length, 'sin vectores repetidos');
  }
});

test('el número de nodos recorridos sin banda coincide con la cota combinatoria exacta', () => {
  for (const [N, K, T] of [[2, 9, 2], [3, 7, 3], [5, 5, 3], [6, 4, 4]]) {
    const freqs = Array.from({ length: N }, (_, i) => 88_100_000 + i * 200_000);
    const e = enumerateProducts(freqs, { maxOrder: K, maxTones: T, includeHarmonics: true, outputRange: null, workBudget: 1e9, maxCombos: 1e8 });
    const est = estimateSearchSpace({ nGenerators: N, maxOrder: K, maxTones: T, includeHarmonics: true });
    assert.equal(BigInt(e.visited), est.workBound, `N=${N} K=${K} T=${T}`);
    // sin banda y con frecuencias distintas, toda combinación de orden ≥ 2 con Σ≠0 se almacena
    let zero = 0;
    const naive = naiveProducts(freqs, K, T, true, 1, Infinity);
    zero = Number(est.candidates) - naive.length;
    assert.equal(e.store.count, naive.length);
    assert.ok(zero >= 0);
  }
});

// ------------------------------------------------------------------ duplicados y agrupación

test('combinaciones distintas con la misma frecuencia se agrupan sin perder ninguna', () => {
  // equiespaciadas: f1 + f3 = 2 f2 exactamente
  const g = gens(['88.10', '88.30', '88.50']);
  const rs = runAnalysis(g, params({ maxOrder: 3, maxTones: 3, outputMode: 'todo' })).result;
  const gi = findGroup(rs, hz('176.60'));
  const keys = groupCombos(rs, gi).map((c) => comboKeyByIndex(rs.store, c)).sort();
  assert.deepEqual(keys, ['0:1|2:1', '1:2']);
  // en banda: 2f1 − f2 = 87.90 (fuera), 2f2 − f1 = 88.50 = f3 (coincide con un transmisor)
  const rsb = runAnalysis(g, params({ maxOrder: 3, maxTones: 3 })).result;
  const g2 = findGroup(rsb, hz('88.50'));
  assert.ok(g2 >= 0);
  assert.ok(groupCombos(rsb, g2).some((c) => comboKeyByIndex(rsb.store, c) === '0:-1|1:2'));
  const sum = summarize(rs);
  assert.ok(sum.coincidentGroups >= 1);
  // cada combinación pertenece exactamente a un grupo y los grupos están ordenados sin repeticiones
  for (let i = 1; i < rs.groupCount; i++) assert.ok(rs.groupFreq[i] > rs.groupFreq[i - 1]);
  let total = 0;
  for (let gg = 0; gg < rs.groupCount; gg++) total += groupCombos(rs, gg).length;
  assert.equal(total, rs.store.count);
});

test('precisión: frecuencias con decimales binariamente inexactos no generan falsos duplicados ni pierden coincidencias', () => {
  // 0.1 + 0.2 ≠ 0.3 en coma flotante; en hercios enteros sí es exacto
  const g = gens(['100.1', '100.2', '100.3']);
  const rs = runAnalysis(g, params({ maxOrder: 3, maxTones: 3, outputMode: 'todo' })).result;
  const gi = findGroup(rs, hz('200.4'));
  const keys = groupCombos(rs, gi).map((c) => comboKeyByIndex(rs.store, c)).sort();
  assert.deepEqual(keys, ['0:1|2:1', '1:2'], '100.1+100.3 y 2·100.2 son la MISMA frecuencia');
  for (let c = 0; c < rs.store.count; c++) assert.ok(Number.isInteger(rs.store.freqHz[c]));
  // la misma lista escrita con artefactos binarios se cuantiza igual
  const g2 = gens(['100.09999999999999', '100.2', '100.30000000000001']);
  assert.deepEqual(g2.map((x) => x.freqHz), g.map((x) => x.freqHz));
});

// ------------------------------------------------------------------ límites de banda

test('productos exactamente en los bordes de la banda se incluyen; 1 Hz fuera se excluye', () => {
  // 2·98 − 88 = 108 MHz exacto (borde superior); 2·89 − 90 = 88 MHz exacto (borde inferior)
  const rs = runAnalysis(gens(['88', '98']), params({ maxOrder: 3, maxTones: 2 })).result;
  assert.ok(findGroup(rs, 108_000_000) >= 0, 'borde superior incluido');
  const rs2 = runAnalysis(gens(['89', '90']), params({ maxOrder: 3, maxTones: 2 })).result;
  assert.ok(findGroup(rs2, 88_000_000) >= 0, 'borde inferior incluido');
  const rs3 = runAnalysis(gens(['88.000001', '98']), params({ maxOrder: 3, maxTones: 2 })).result;
  assert.ok(findGroup(rs3, 107_999_999) >= 0, '1 Hz por debajo del borde superior queda dentro');
  const rs4 = runAnalysis(gens(['87.999999', '98']), params({ maxOrder: 3, maxTones: 2 })).result;
  assert.equal(findGroup(rs4, 108_000_001), -1, '1 Hz por encima del borde queda fuera');
  // filtro dentro/fuera de banda
  const rsAll = runAnalysis(gens(['89.30', '89.58']), params({ maxOrder: 5, maxTones: 2, outputMode: 'todo' })).result;
  const inB = filterCombos(rsAll, { band: 'dentro' });
  const outB = filterCombos(rsAll, { band: 'fuera' });
  assert.equal(inB.length + outB.length, rsAll.store.count);
  for (const c of inB) assert.ok(rsAll.store.freqHz[c] >= 88e6 && rsAll.store.freqHz[c] <= 108e6);
});

test('filtros por orden, número de emisoras, tipo y generador', () => {
  const g = gens(['89.30', '89.58', '90.10']);
  const rs = runAnalysis(g, params({ maxOrder: 7, maxTones: 3 })).result;
  const im5 = filterCombos(rs, { orders: [5] });
  assert.ok(im5.length > 0);
  for (const c of im5) assert.equal(rs.store.order[c], 5);
  const t3 = filterCombos(rs, { tones: [3] });
  for (const c of t3) assert.equal(rs.store.tones[c], 3);
  const withF3 = filterCombos(rs, { generatorIndex: 2 });
  for (const c of withF3) assert.ok(comboTerms(rs.store, c).some((t) => t.index === 2));
  const rng = filterCombos(rs, { minHz: hz('88.7'), maxHz: hz('88.8') });
  for (const c of rng) assert.ok(rs.store.freqHz[c] >= hz('88.7') && rs.store.freqHz[c] <= hz('88.8'));
  assert.ok(Array.from(rng).some((c) => rs.store.freqHz[c] === hz('88.74')));
  assert.ok(Array.from(rng).some((c) => rs.store.freqHz[c] === hz('88.78')));
});

// ------------------------------------------------------------------ complejidad

test('control de complejidad: estimación exacta, sugerencias y parada marcada como NO exhaustiva', () => {
  const est = estimateSearchSpace({ nGenerators: 40, maxOrder: 15, maxTones: 4, includeHarmonics: true });
  // C(40,4)·2^3·C(15,4) + … calculado a mano para el término dominante
  assert.ok(est.candidates > 91390n * 8n * 1365n);
  const hints = suggestReductions({ nGenerators: 40, maxOrder: 15, maxTones: 4, includeHarmonics: true }, 5e6);
  assert.ok(hints.length > 0);
  for (const h of hints) assert.ok(h.workBound <= 5_000_000n);
  // presupuesto insuficiente → incompleto, nunca presentado como exhaustivo
  const freqs = Array.from({ length: 12 }, (_, i) => 88_100_000 + i * 1_700_000);
  const e = enumerateProducts(freqs, { maxOrder: 9, maxTones: 3, includeHarmonics: true, outputRange: { minHz: 88e6, maxHz: 108e6 }, workBudget: 10_000, maxCombos: 1e7 });
  assert.equal(e.complete, false);
  assert.equal(e.stopReason, 'presupuesto_de_trabajo');
  const e2 = enumerateProducts(freqs, { maxOrder: 9, maxTones: 3, includeHarmonics: true, outputRange: { minHz: 88e6, maxHz: 108e6 }, workBudget: 1e9, maxCombos: 50 });
  assert.equal(e2.complete, false);
  assert.equal(e2.stopReason, 'limite_de_combinaciones');
  assert.equal(e2.store.count, 50);
  const full = enumerateProducts(freqs, { maxOrder: 9, maxTones: 3, includeHarmonics: true, outputRange: { minHz: 88e6, maxHz: 108e6 }, workBudget: 1e9, maxCombos: 1e7 });
  assert.equal(full.complete, true);
  assert.ok(full.pruned > 0, 'la poda debe actuar con banda');
  assert.ok(BigInt(full.visited) < estimateSearchSpace({ nGenerators: 12, maxOrder: 9, maxTones: 3, includeHarmonics: true }).workBound);
});

test('parámetros no válidos se rechazan', () => {
  assert.throws(() => enumerateProducts([], { maxOrder: 3, maxTones: 2, includeHarmonics: true, outputRange: null, workBudget: 1e6, maxCombos: 1e6 }), /No hay frecuencias/);
  assert.throws(() => enumerateProducts([89.3], { maxOrder: 3, maxTones: 2, includeHarmonics: true, outputRange: null, workBudget: 1e6, maxCombos: 1e6 }), /no entera/);
  assert.throws(() => enumerateProducts([89_300_000], { maxOrder: 1, maxTones: 2, includeHarmonics: true, outputRange: null, workBudget: 1e6, maxCombos: 1e6 }), /orden máximo/);
  assert.throws(() => enumerateProducts([89_300_000], { maxOrder: 120, maxTones: 2, includeHarmonics: true, outputRange: null, workBudget: 1e6, maxCombos: 1e6 }), /orden máximo/);
});

test('rendimiento: 30 emisoras FM, orden 7, 3 tonos, completo en tiempo razonable', () => {
  const freqs = Array.from({ length: 30 }, (_, i) => 88_100_000 + i * 600_000 + (i % 3) * 200_000);
  const g = freqs.map((f, i) => ({ ...gens(['100'])[0], id: 'x' + i, freqHz: f }));
  const run = runAnalysis(g, params({ maxOrder: 7, maxTones: 3 }));
  assert.equal(run.meta.complete, true);
  assert.ok(run.meta.elapsedMs < 20000, `tardó ${run.meta.elapsedMs} ms`);
  const rs = buildResultSet(run.result.store, g, run.params.band);
  assert.equal(rs.groupCount, run.result.groupCount);
});
