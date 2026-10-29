import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AttenuationTest, MechanismId } from '../src/engine/index.js';
import { analyzeAttenuation } from '../src/engine/index.js';

function base(over: Partial<AttenuationTest> = {}): AttenuationTest {
  return {
    id: 't1', date: '2026-10-29', operator: 'FO', observedId: 'o1', freqHz: 89_860_000, hypothesisKey: 'g1:-1|g2:+2', hypothesisOrder: null,
    imBeforeDbm: -60, imAfterDbm: -90, attenuationDb: 10, attenuationAtImDb: null, readingUncertaintyDb: 0.5, attenuatorUncertaintyDb: 0.3, noiseFloorDbm: -110,
    generators: [
      { label: '89.30', freqHz: 89_300_000, coef: -1, beforeDbm: -20, afterDbm: -30 },
      { label: '89.58', freqHz: 89_580_000, coef: 2, beforeDbm: -22, afterDbm: -32 },
    ],
    receiver: { agc: 'no', preamp: 'no', gainDb: null, attenuatorPosition: 'entrada_receptor', ifHz: null, loSide: 'desconocido', inputP1dBdBm: null, notes: '' },
    notes: '',
    ...over,
  };
}

const st = (a: ReturnType<typeof analyzeAttenuation>, id: MechanismId) => a.mechanisms.find((m) => m.id === id)?.status;

test('IM3 interna: 10 dB de atenuación → 30 dB de caída (pendiente 3)', () => {
  const a = analyzeAttenuation(base());
  assert.equal(a.imDropDb, 30);
  assert.equal(a.slopeVsAttenuation, 3);
  assert.equal(a.expectedInternal?.dropDb, 30);
  assert.equal(a.expectedInternal?.order, 3);
  assert.equal(a.discriminating, true);
  assert.equal(st(a, 'im_interna'), 'compatible');
  assert.equal(st(a, 'im_externa'), 'incompatible');
  assert.equal(st(a, 'senal_independiente'), 'incompatible');
  assert.equal(st(a, 'saturacion'), 'sin_indicios');
  assert.equal(a.evidenceResult, 'compatible');
  assert.deepEqual(a.theoretical.map((t) => t.compatible), [true, false, false]);
  assert.ok(a.iipEstimateDbm !== null);
  // IIP3 ≈ Pin + (Pin − PIM)/2 = −21 + (−21 + 60)/2 = −1.5 dBm
  assert.ok(Math.abs((a.iipEstimateDbm as number) - -1.5) < 1e-9);
});

test('señal lineal (externa o independiente): caída igual a la atenuación', () => {
  const a = analyzeAttenuation(base({ imAfterDbm: -70 }));
  assert.equal(a.slopeVsAttenuation, 1);
  assert.equal(st(a, 'im_interna'), 'incompatible');
  assert.equal(st(a, 'im_externa'), 'compatible');
  assert.equal(st(a, 'senal_independiente'), 'compatible');
  assert.equal(a.evidenceResult, 'no_concluyente', 'lo lineal no confirma ni descarta la IM');
});

test('IM5 con pendiente 5 es compatible; la misma caída es incompatible con IM3', () => {
  const g5 = [
    { label: 'f1', freqHz: 89_300_000, coef: 3, beforeDbm: -20, afterDbm: -26 },
    { label: 'f2', freqHz: 89_580_000, coef: -2, beforeDbm: -20, afterDbm: -26 },
  ];
  const a = analyzeAttenuation(base({ attenuationDb: 6, imBeforeDbm: -70, imAfterDbm: -100, generators: g5 }));
  assert.equal(a.expectedInternal?.order, 5);
  assert.equal(a.expectedInternal?.dropDb, 30);
  assert.equal(st(a, 'im_interna'), 'compatible');
  assert.deepEqual(a.theoretical.map((t) => t.compatible), [false, true, false]);
});

test('atenuación selectiva sobre un solo generador: ΔP_IM = Σ|m_i|ΔP_i', () => {
  const g = [
    { label: 'f1', freqHz: 89_300_000, coef: 2, beforeDbm: -20, afterDbm: -26 }, // atenuado 6 dB
    { label: 'f2', freqHz: 89_580_000, coef: -1, beforeDbm: -20, afterDbm: -20, appliedDb: 0 }, // sin cambio
  ];
  const a = analyzeAttenuation(base({ attenuationDb: 6, attenuationAtImDb: 0, imBeforeDbm: -60, imAfterDbm: -72, generators: g }));
  assert.equal(a.expectedInternal?.dropDb, 12);
  assert.equal(st(a, 'im_interna'), 'compatible');
});

test('advertencias: AGC activo, generadores que no siguen al atenuador, prueba no discriminante, medida censurada', () => {
  const agc = analyzeAttenuation(base({ receiver: { ...base().receiver, agc: 'si' } }));
  assert.equal(st(agc, 'im_interna'), 'no_evaluable');
  assert.ok(agc.validity.some((v) => /AGC/.test(v)));
  const comp = analyzeAttenuation(base({ generators: base().generators.map((g) => ({ ...g, afterDbm: (g.beforeDbm as number) - 4 })) }));
  assert.equal(st(comp, 'saturacion'), 'indicios');
  assert.equal(st(comp, 'im_interna'), 'no_evaluable');
  const weak = analyzeAttenuation(base({ attenuationDb: 1, imAfterDbm: -63, readingUncertaintyDb: 1, generators: base().generators.map((g) => ({ ...g, afterDbm: (g.beforeDbm as number) - 1 })) }));
  assert.equal(weak.discriminating, false);
  assert.equal(weak.evidenceResult, 'no_concluyente');
  const cens = analyzeAttenuation(base({ imAfterDbm: -108, noiseFloorDbm: -110 }));
  assert.equal(cens.censored, true);
  assert.ok(cens.validity.some((v) => /COTA INFERIOR/.test(v)));
  assert.equal(cens.evidenceResult, 'no_concluyente');
});

test('imagen y selectividad con portadoras conocidas', () => {
  const ctx = { carriers: [{ label: 'Emisora imagen', freqHz: 89_860_000 + 2 * 10_700_000, levelDbm: -30 }, { label: 'Adyacente', freqHz: 90_060_000, levelDbm: -25 }], adjacentWindowHz: 400_000, spurToleranceHz: 25_000 };
  const a = analyzeAttenuation(base({ imAfterDbm: -70, receiver: { ...base().receiver, ifHz: 10_700_000, loSide: 'superior' } }), ctx);
  assert.equal(st(a, 'espuria_imagen'), 'compatible');
  assert.equal(st(a, 'selectividad'), 'compatible');
  const b = analyzeAttenuation(base({ receiver: { ...base().receiver, ifHz: 10_700_000, loSide: 'superior' } }), ctx);
  assert.equal(st(b, 'espuria_imagen'), 'incompatible', 'la imagen es lineal; una pendiente 3 no la explica');
  assert.equal(st(b, 'selectividad'), 'incompatible');
});

test('datos de laboratorio no válidos se rechazan', () => {
  assert.throws(() => analyzeAttenuation(base({ attenuationDb: 0 })), /atenuación/);
  assert.throws(() => analyzeAttenuation(base({ imBeforeDbm: NaN })), /nivel original/);
});
