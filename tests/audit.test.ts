import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Confirmation, Evidence, SignalRecord } from '../src/engine/index.js';
import {
  audit, classifyHypothesis, coverageFraction, findGroup, formatKHz, formatMHz, hypothesisKey, groupCombos,
  makeSignal, matchObserved, parseFrequency, parseTolerance, runAnalysis, formatHz, parseDecimal,
} from '../src/engine/index.js';
import { gens, hz, params } from './helpers.js';

// ------------------------------------------------------------------ frecuencias exactas

test('parseFrequency: unidades, coma decimal, notación científica y exactitud', () => {
  assert.equal(parseFrequency('89.30 MHz').hz, 89_300_000);
  assert.equal(parseFrequency('89,30').hz, 89_300_000);
  assert.equal(parseFrequency('89300 kHz').hz, 89_300_000);
  assert.equal(parseFrequency('89300000 Hz').hz, 89_300_000);
  assert.equal(parseFrequency('0.0893 GHz').hz, 89_300_000);
  assert.equal(parseFrequency('8.93E+07', 'Hz').hz, 89_300_000);
  assert.equal(parseFrequency('89.299999999999997').hz, 89_300_000);
  assert.equal(parseFrequency('89.299999999999997').warning, undefined, 'un artefacto binario no merece advertencia');
  const r = parseFrequency('89.3000004');
  assert.equal(r.hz, 89_300_000);
  assert.match(r.warning ?? '', /precisión inferior a 1 Hz/);
  assert.equal(parseFrequency('1.234,5', 'kHz').hz, 1_234_500);
  for (const bad of ['', 'abc', '-89.3', '0', '89.3.1', '1,2,3', '2000 GHz']) assert.equal(parseFrequency(bad).ok, false, `«${bad}» debe rechazarse`);
  assert.equal(parseTolerance('10').hz, 10_000);
  assert.equal(parseTolerance('±9.999').hz, 9_999);
  assert.equal(parseTolerance('0').hz, 0);
  assert.equal(parseTolerance('50 kHz').hz, 50_000);
  assert.equal(parseDecimal('1e3')?.exp10, 3);
});

test('formatos exactos de MHz y kHz', () => {
  assert.equal(formatMHz(89_300_000), '89.30');
  assert.equal(formatMHz(88_740_000, 3), '88.740');
  assert.equal(formatMHz(89_301_234), '89.301234');
  assert.equal(formatMHz(100_000_000), '100.00');
  assert.equal(formatKHz(-10_000), '-10.000');
  assert.equal(formatKHz(0), '0.000');
  assert.equal(formatKHz(1), '0.001');
  assert.equal(formatHz(89_300_000), '89300000');
});

// ------------------------------------------------------------------ coincidencias

function caseRun() {
  return runAnalysis(gens(['89.30', '89.58']), params({ maxOrder: 9, maxTones: 2 }));
}

test('89.85 MHz observada se vincula con 89.86 (IM3) con tolerancia ≥ 10 kHz, no con menos', () => {
  const run = caseRun();
  const obs = [makeSignal(hz('89.85'), { id: 'o1' })];
  const m10 = matchObserved(run.result, obs, parseTolerance('10').hz);
  assert.equal(m10[0].matches.length, 1);
  assert.equal(formatMHz(m10[0].matches[0].freqHz), '89.86');
  assert.equal(m10[0].matches[0].diffHz, -10_000);
  assert.equal(formatKHz(m10[0].matches[0].diffHz), '-10.000');
  const m20 = matchObserved(run.result, obs, 20_000);
  assert.equal(m20[0].matches.length, 1);
  const m9 = matchObserved(run.result, obs, parseTolerance('9.999').hz);
  assert.equal(m9[0].matches.length, 0, 'a ±9.999 kHz no hay coincidencia');
  assert.equal(m9[0].nearest?.diffHz, -10_000);
  const m5 = matchObserved(run.result, obs, 5_000);
  assert.equal(m5[0].matches.length, 0);
});

test('88.74 MHz observada coincide con el IM5 con diferencia exactamente cero', () => {
  const run = caseRun();
  const m = matchObserved(run.result, [makeSignal(hz('88.74'), { id: 'o2' })], 0);
  assert.equal(m[0].matches.length, 1);
  assert.equal(m[0].matches[0].diffHz, 0);
  const c = m[0].matches[0].combos[0];
  assert.equal(run.result.store.order[c], 5);
});

test('una señal compatible con varias combinaciones muestra todas las hipótesis', () => {
  const g = gens(['88.10', '88.30', '88.50', '89.10']);
  const run = runAnalysis(g, params({ maxOrder: 5, maxTones: 3 }));
  const obs = [makeSignal(hz('88.70'), { id: 'o' })];
  const au = audit(run, obs, 0, [], []);
  // 88.70 = 2·88.50 − 88.30 = 88.30 + 88.50 − 88.10 = …
  const keys = au.hypotheses.map((h) => h.key);
  assert.ok(keys.length >= 2, `hipótesis: ${keys.join(', ')}`);
  assert.ok(keys.includes('g2:-1|g3:+2'));
  assert.ok(keys.includes('g1:-1|g2:+1|g3:+1'));
  for (const h of au.hypotheses) assert.equal(h.classification.cls, 'B');
});

test('probabilidad de coincidencia fortuita (fracción de banda cubierta)', () => {
  const run = caseRun();
  // 8 productos separados ≥ 280 kHz, ventanas de ±10 kHz → 8·20 kHz / 20 MHz = 0.8 %
  assert.equal(coverageFraction(run.result, 10_000, run.params.band), (8 * 20_000) / 20_000_000);
  // ventanas solapadas se cuentan una sola vez: ±200 kHz con separación 280 kHz
  const f = coverageFraction(run.result, 200_000, run.params.band);
  assert.ok(f < (8 * 400_000) / 20_000_000);
  assert.equal(coverageFraction(run.result, 10_000, run.params.band, 3), (2 * 20_000) / 20_000_000);
});

test('auditoría completa del caso obligatorio: clases A y B, señales sin explicación', () => {
  const run = caseRun();
  const obs = [makeSignal(hz('89.85'), { id: 'a' }), makeSignal(hz('88.74'), { id: 'b' }), makeSignal(hz('95.00'), { id: 'c' })];
  const au = audit(run, obs, 10_000, [], []);
  assert.equal(au.observedClass.get('a'), 'B');
  assert.equal(au.observedClass.get('b'), 'B');
  assert.equal(au.observedClass.get('c'), null);
  assert.equal(au.unmatched.length, 1);
  assert.equal(au.unmatched[0].observed.id, 'c');
  const g8986 = findGroup(run.result, hz('89.86'));
  const g9014 = findGroup(run.result, hz('90.14'));
  assert.equal(au.groupClass.get(g8986), 'B');
  assert.equal(au.groupClass.get(g9014) ?? 'A', 'A');
});

// ------------------------------------------------------------------ clasificación A/B/C/D

function setup() {
  const g = gens(['89.30', '89.58'], 'portadora_confirmada');
  const run = runAnalysis(g, params({ maxOrder: 9, maxTones: 2 }));
  const c = groupCombos(run.result, findGroup(run.result, hz('89.86')))[0];
  const key = hypothesisKey(run.result, c);
  const obs: SignalRecord = makeSignal(hz('89.85'), { id: 'obs1' });
  return { g, run, key, obs };
}

const ev = (over: Partial<Evidence>): Evidence => ({ id: 'e' + Math.random(), observedId: 'obs1', hypothesisKey: null, type: 'atenuacion', result: 'compatible', description: 'Prueba documentada', date: '2026-10-29', author: 'F. Orbe', labTestId: null, ...over });
const conf = (key: string, over: Partial<Confirmation> = {}): Confirmation => ({ observedId: 'obs1', hypothesisKey: key, justification: 'La señal desaparece al apagar 89.58 y reaparece al encenderlo; registro adjunto.', author: 'F. Orbe', date: '2026-10-29', ...over });

test('A sin señal; B con coincidencia sin evidencia', () => {
  const { g, key } = setup();
  assert.equal(classifyHypothesis({ matched: false, observedId: null, hypothesisKey: key, generators: g, evidence: [], confirmations: [] }).cls, 'A');
  const b = classifyHypothesis({ matched: true, observedId: 'obs1', hypothesisKey: key, generators: g, evidence: [], confirmations: [] });
  assert.equal(b.cls, 'B');
  assert.ok(b.missing.length > 0);
});

test('C requiere evidencia compatible y ninguna incompatible', () => {
  const { g, key } = setup();
  const base = { matched: true, observedId: 'obs1', hypothesisKey: key, generators: g, confirmations: [] };
  assert.equal(classifyHypothesis({ ...base, evidence: [ev({})] }).cls, 'C');
  assert.equal(classifyHypothesis({ ...base, evidence: [ev({ result: 'no_concluyente' })] }).cls, 'B');
  assert.equal(classifyHypothesis({ ...base, evidence: [ev({}), ev({ result: 'incompatible', type: 'apagado_generador' })] }).cls, 'B');
  // evidencia de otra hipótesis u otra señal no cuenta
  assert.equal(classifyHypothesis({ ...base, evidence: [ev({ hypothesisKey: 'g1:+3|g2:-2' })] }).cls, 'B');
  assert.equal(classifyHypothesis({ ...base, evidence: [ev({ observedId: 'otra' })] }).cls, 'B');
});

test('D solo con confirmación justificada, evidencia fuerte y portadoras confirmadas', () => {
  const { g, key } = setup();
  const base = { matched: true, observedId: 'obs1', hypothesisKey: key, generators: g };
  // evidencia débil única + confirmación → sigue C
  let r = classifyHypothesis({ ...base, evidence: [ev({})], confirmations: [conf(key)] });
  assert.equal(r.cls, 'C');
  assert.ok(r.missing.some((m) => /Evidencia fuerte/.test(m)));
  // evidencia fuerte sin confirmación → C
  r = classifyHypothesis({ ...base, evidence: [ev({ type: 'apagado_generador' })], confirmations: [] });
  assert.equal(r.cls, 'C');
  // confirmación con justificación pobre → C
  r = classifyHypothesis({ ...base, evidence: [ev({ type: 'apagado_generador' })], confirmations: [conf(key, { justification: 'sí' })] });
  assert.equal(r.cls, 'C');
  // todo en regla → D
  r = classifyHypothesis({ ...base, evidence: [ev({ type: 'apagado_generador' })], confirmations: [conf(key)] });
  assert.equal(r.cls, 'D');
  // dos evidencias de tipos distintos también bastan
  r = classifyHypothesis({ ...base, evidence: [ev({}), ev({ type: 'variacion_conjunta' })], confirmations: [conf(key)] });
  assert.equal(r.cls, 'D');
  // un generador solo «sospechoso» impide D (y no se reclasifica)
  const g2 = [g[0], { ...g[1], classification: 'sospechosa' as const }];
  r = classifyHypothesis({ ...base, generators: g2, evidence: [ev({ type: 'apagado_generador' })], confirmations: [conf(key)] });
  assert.equal(r.cls, 'C');
  assert.equal(g2[1].classification, 'sospechosa');
  // la confirmación de otra hipótesis no sirve
  r = classifyHypothesis({ ...base, evidence: [ev({ type: 'apagado_generador' })], confirmations: [conf('g1:+3|g2:-2')] });
  assert.equal(r.cls, 'C');
});

test('la auditoría propaga la mejor clase al grupo y a la señal', () => {
  const { run, key, obs } = setup();
  const au = audit(run, [obs], 10_000, [ev({ type: 'apagado_generador' })], [conf(key)]);
  assert.equal(au.observedClass.get('obs1'), 'D');
  assert.equal(au.groupClass.get(findGroup(run.result, hz('89.86'))), 'D');
});
