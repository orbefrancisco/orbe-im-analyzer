import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { Cartography, Evidence, NationalDB } from '../src/engine/index.js';
import {
  addEvidence, addRecords, analyzeScope, buildScopeInputs, compareStations, coexistence, dbChecksum, displayCoord, emptyNationalDB, exportBackup,
  findingsReport, haversineKm, importObservations, investigateFrequency, isLocationUncertain, jsonToRows, loadExampleData, locate, observedKey,
  parseBackup, parseCSV, provincesOfRegion, reassignMunicipality, reassignProvince, recordsOfScope, resolveStation, sanitize, setConfirmation,
  stableStringify, stationsOfScope, updateRecord, updateStation, validateCartography, voidRecord, findGroup, groupCombos, comboKeyByIndex, activeRecords,
} from '../src/engine/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const carto: Cartography = {
  ...JSON.parse(readFileSync(join(root, 'web', 'data', 'rd-provincias.json'), 'utf-8')),
  municipios: JSON.parse(readFileSync(join(root, 'web', 'data', 'rd-municipios.json'), 'utf-8')).municipios,
};
const MHZ = (x: number) => Math.round(x * 1e6);

function exampleDb(): NationalDB {
  const db = emptyNationalDB(new Date('2026-10-29T12:00:00Z'));
  loadExampleData(db);
  db.settings.includeSimulated = true;
  return db;
}

// 1 ------------------------------------------------------------------ estaciones
test('las ocho estaciones iniciales con sus coordenadas históricas exactas', () => {
  const db = emptyNationalDB();
  assert.deepEqual(db.stations.map((s) => [s.id, s.name]), [['01', 'Jacobo'], ['02', 'Santiago'], ['03', 'Puerto Plata'], ['04', 'Salcedo'], ['05', 'Dajabón'], ['06', 'San Juan'], ['07', 'Barahona'], ['08', 'Higüey']]);
  const h = (id: string) => db.stations.find((s) => s.id === id)!.location.historic;
  assert.deepEqual([h('01')!.lat, h('01')!.lon], [18.550556, -69.939944]);
  assert.deepEqual([h('02')!.lat, h('02')!.lon], [19.480833, -70.7025]);
  assert.deepEqual([h('04')!.lat, h('04')!.lon], [19.442778, -70.376944]);
  assert.deepEqual([h('05')!.lat, h('05')!.lon], [19.3825, -71.675556]);
  assert.deepEqual([h('06')!.lat, h('06')!.lon], [18.750472, -71.198278]);
  // históricas discrepantes conservadas, no usadas como posición
  assert.deepEqual([h('03')!.lat, h('03')!.lon], [19.755222, -70.646833]);
  assert.deepEqual([h('07')!.lat, h('07')!.lon], [18.257778, -71.512778]);
  assert.equal(h('08'), null, 'Higüey: sin coordenada conocida');
  const jac = db.stations[0];
  assert.equal(jac.operationalName, 'Jacobo — Distrito Nacional');
  assert.equal(jac.regionId, 'R01');
  for (const s of db.stations) {
    assert.equal(s.location.verified, null, 'ninguna se declara verificada por GPS');
    assert.ok(s.sources.length > 0);
    assert.equal(s.technical, '', 'campos no documentados vacíos');
    assert.deepEqual(s.bands, []);
  }
});

test('coordenadas inciertas: referencia aproximada con radio, nunca presentada como exacta', () => {
  const db = emptyNationalDB();
  const by = (id: string) => db.stations.find((s) => s.id === id)!;
  for (const id of ['03', '07', '08']) {
    const s = by(id);
    assert.equal(isLocationUncertain(s), true, id);
    const d = displayCoord(s)!;
    assert.equal(d.kind, 'aproximada');
    assert.ok(d.uncertaintyKm > 5, `${id} con radio de incertidumbre`);
    assert.match(s.location.reference!.note, /NO es la posición|no la coordenada|se desconoce/);
  }
  for (const id of ['01', '02', '04', '05', '06']) {
    assert.equal(isLocationUncertain(by(id)), false);
    assert.equal(displayCoord(by(id))!.kind, 'historica');
    assert.equal(by(id).location.confidence, 'historica_documentada');
  }
  // verificar exige fuente y método; después pasa a «verificada»
  assert.ok(updateStation(db, '08', { location: { ...by('08').location, verified: { lat: 18.7, lon: -68.6, source: '', note: '', date: '2026-11-01', method: '' } } }, 'gps').length > 0);
  assert.deepEqual(updateStation(db, '08', { location: { ...by('08').location, verified: { lat: 18.7, lon: -68.6, source: 'Medición GPS de campo', note: '', date: '2026-11-01', method: 'GNSS' }, confidence: 'verificada' } }, 'gps'), []);
  assert.equal(displayCoord(by('08'))!.kind, 'verificada');
  assert.equal(isLocationUncertain(by('08')), false);
  assert.ok(updateStation(db, '08', { id: '09' }, 'x').length > 0, 'el id no cambia');
});

test('geometría: municipio y provincia físicos coinciden con la cartografía; referencias derivadas de los datos', () => {
  const db = emptyNationalDB();
  for (const s of db.stations.filter((x) => x.location.confidence === 'historica_documentada')) {
    const l = locate(carto, s.location.historic!.lat, s.location.historic!.lon);
    assert.equal(l.method, 'municipio');
    assert.equal(l.municipalityId, s.location.municipalityId, s.name);
    assert.equal(l.provinceId, s.location.provinceId, s.name);
  }
  // Jacobo: responsabilidad «Distrito Nacional», torre en Santo Domingo Norte (provincia Santo Domingo)
  const jac = locate(carto, 18.550556, -69.939944);
  assert.equal(jac.provinceId, 'DO-32');
  assert.equal(carto.municipios.find((m) => m.id === jac.municipalityId)!.nombre, 'Santo Domingo Norte');
  // discrepancias documentadas
  assert.notEqual(locate(carto, 19.755222, -70.646833).municipalityId, 'M100', 'Puerto Plata histórica no cae en Sosúa');
  assert.equal(locate(carto, 18.257778, -71.512778).provinceId, 'DO-10', 'Barahona histórica cae en Independencia');
  // referencias = centroide municipal; radio = distancia máxima al contorno
  for (const id of ['03', '07', '08']) {
    const s = db.stations.find((x) => x.id === id)!;
    const m = carto.municipios.find((x) => x.id === s.location.municipalityId)!;
    assert.deepEqual([s.location.reference!.lon, s.location.reference!.lat], m.centroide);
    let mx = 0;
    for (const p of m.poligonos) for (const [lo, la] of p[0]) mx = Math.max(mx, haversineKm(m.centroide[1], m.centroide[0], la, lo));
    assert.ok(Math.abs(mx - s.location.reference!.uncertaintyKm) < 0.1, `${id}: radio ${mx}`);
  }
});

// 2 ------------------------------------------------------------------ divisiones territoriales y regiones
test('las 32 divisiones territoriales y ocho regiones configurables', () => {
  assert.deepEqual(validateCartography(carto), []);
  const ids = carto.provincias.map((p) => p.id).sort();
  assert.deepEqual(ids, Array.from({ length: 32 }, (_, i) => `DO-${String(i + 1).padStart(2, '0')}`));
  assert.equal(carto.provincias.find((p) => p.id === 'DO-01')!.nombre, 'Distrito Nacional');
  assert.equal(carto.provincias.find((p) => p.id === 'DO-07')!.nombre, 'Elías Piña');
  assert.equal(carto.municipios.length, 155);
  const db = emptyNationalDB();
  assert.equal(db.regions.length, 8);
  assert.deepEqual(db.regions.map((r) => r.colorSlot).sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(Object.keys(db.provinceRegion).length, 32);
  for (const p of ids) assert.ok(db.regions.some((r) => r.id === db.provinceRegion[p]), `${p} asignada`);
  for (const r of db.regions) assert.ok(provincesOfRegion(db, r.id).length >= 1);
  assert.deepEqual(provincesOfRegion(db, 'R07'), ['DO-03', 'DO-04', 'DO-10', 'DO-16']);
  // cada estación está físicamente en una provincia de su región (en la propuesta inicial)… salvo Jacobo, cuya torre está en Santo Domingo
  for (const s of db.stations) assert.equal(db.provinceRegion[s.location.provinceId!], s.regionId, s.name);
});

test('selección y reasignación de provincias y municipios sin perder registros', () => {
  const db = exampleDb();
  const before = db.records.length;
  assert.deepEqual(stationsOfScope(db, { kind: 'region', regionId: 'R07' }).map((s) => s.id), ['07']);
  assert.deepEqual(reassignProvince(db, 'DO-16', 'R06', 'prueba'), []);
  assert.equal(db.provinceRegion['DO-16'], 'R06');
  assert.equal(db.assignmentHistory[db.assignmentHistory.length - 1].from, 'R07');
  assert.equal(db.records.length, before, 'los registros no cambian');
  assert.ok(reassignProvince(db, 'DO-99', 'R01', 'x').length > 0);
  assert.ok(reassignProvince(db, 'DO-16', 'R99', 'x').length > 0);
  assert.deepEqual(reassignMunicipality(db, 'M100', 'R02', 'excepción'), []);
  assert.equal(db.municipalityRegion['M100'], 'R02');
  assert.deepEqual(reassignMunicipality(db, 'M100', null, 'hereda'), []);
  assert.equal(db.municipalityRegion['M100'], undefined);
  assert.equal(db.assignmentHistory.length, 3);
  assert.ok(db.audit.some((a) => a.action === 'reasignación'));
});

// 4-6 ------------------------------------------------------------------ registros
test('persistencia exacta, historial, anulación sin borrado y autorización con evidencia', () => {
  const db = emptyNationalDB();
  const r = addRecords(db, [{ stationId: '07', freqHz: 88_780_000, status: 'sospechosa_im', levelValue: -88, levelUnit: 'dBm', datetime: '2026-10-29 10:00', bandwidthHz: 200_000, service: 'Radiodifusión FM' }]);
  const rec = r.added[0];
  assert.equal(rec.freqHz, 88_780_000);
  assert.deepEqual(updateRecord(db, rec.id, { status: 'observada_sin_identificar', emisora: 'X' }, 'reclasificación tras escucha'), []);
  assert.equal(rec.history.length, 1);
  assert.deepEqual(rec.history[0].changes.status, ['sospechosa_im', 'observada_sin_identificar']);
  assert.ok(updateRecord(db, rec.id, { authorization: { status: 'autorizada', evidence: '' } }, 'x').length > 0, 'autorización sin evidencia rechazada');
  assert.deepEqual(updateRecord(db, rec.id, { authorization: { status: 'autorizada', evidence: 'Resolución INDOTEL n.º …' } }, 'documento'), []);
  assert.ok(voidRecord(db, rec.id, '').length > 0, 'anular exige motivo');
  assert.deepEqual(voidRecord(db, rec.id, 'registro erróneo'), []);
  assert.equal(db.records.length, 1, 'el registro anulado se conserva');
  assert.equal(activeRecords(db).length, 0);
  assert.ok(updateRecord(db, rec.id, { notes: 'x' }, 'x').length > 0, 'no se edita un registro anulado');
  assert.ok(addRecords(db, [{ stationId: '99', freqHz: 1 }]).rejected.length === 1);
  assert.ok(addRecords(db, [{ stationId: '01', freqHz: 89.3 as unknown as number }]).rejected.length === 1, 'Hz no enteros rechazados');
});

test('duplicados: exactos se omiten; otra fecha u otra estación se conservan', () => {
  const db = emptyNationalDB();
  const base = { stationId: '02', freqHz: MHZ(95.9), datetime: '2026-10-01 08:00', levelValue: -60, status: 'portadora_confirmada' as const };
  assert.equal(addRecords(db, [base]).added.length, 1);
  const r2 = addRecords(db, [base, { ...base, datetime: '2026-10-02 08:00' }, { ...base, stationId: '03' }, { ...base, levelValue: -61 }]);
  assert.equal(r2.duplicates.length, 1);
  assert.equal(r2.added.length, 3);
  assert.equal(r2.repeatedAcrossDates, 2);
  assert.equal(db.records.length, 4);
});

// 7 ------------------------------------------------------------------ productos multitono y ámbitos
test('modo estación: 89.30 + 89.58 − 90.10 = 88.780 MHz en Barahona (datos simulados)', () => {
  const db = exampleDb();
  const sa = analyzeScope(db, { kind: 'estacion', stationId: '07' });
  assert.equal(sa.run.meta.complete, true);
  const g = findGroup(sa.run.result, MHZ(88.78));
  assert.ok(g >= 0);
  const keys = groupCombos(sa.run.result, g).map((c) => comboKeyByIndex(sa.run.result.store, c));
  assert.ok(keys.includes('0:1|1:1|2:-1'));
  const h = sa.audit.hypotheses.find((x) => x.observedId === observedKey('07', MHZ(88.78)))!;
  assert.equal(h.diffHz, 0);
  assert.equal(sa.run.result.store.tones[h.combo], 3);
  assert.deepEqual(sa.coexist.get(`${h.observedId}|${h.key}`), ['07']);
  assert.ok(sa.inputs.includesSimulated);
  assert.ok(sa.inputs.notes.some((n) => /SIMULADOS/.test(n)));
});

test('modo nacional y regional: plausibilidad por coexistencia documentada', () => {
  const db = exampleDb();
  const sa = analyzeScope(db, { kind: 'nacional' });
  // 88.74 observada en Santiago (02) = 3·89.30 − 2·89.58, generadoras registradas solo en 01 y 07
  const h = sa.audit.hypotheses.find((x) => x.observedId === observedKey('02', MHZ(88.74)))!;
  assert.ok(h);
  const co = coexistence(sa.inputs, sa.run, h.combo);
  assert.deepEqual(co, ['01', '07']);
  assert.ok(!co.includes('02'), 'no consta que las generadoras se reciban en Santiago');
  assert.ok(sa.inputs.notes.some((n) => /exploratorio/.test(n)));
  const reg = buildScopeInputs(db, { kind: 'region', regionId: 'R07' });
  assert.deepEqual([...new Set(reg.observed.map((o) => o.id))], [observedKey('07', MHZ(88.78))]);
});

test('investigador: 88.78 MHz — observaciones, combinaciones, estaciones y mediciones necesarias', () => {
  const db = exampleDb();
  const inv = investigateFrequency(db, MHZ(88.78), 10_000);
  assert.equal(inv.complete, true);
  assert.equal(inv.observations.length, 1);
  assert.equal(inv.observations[0].record.stationId, '07');
  const h = inv.hypotheses.find((x) => x.symbolic === 'f1 + f2 − f3')!;
  assert.ok(h, inv.hypotheses.map((x) => x.symbolic).join(', '));
  assert.equal(h.order, 'IM3');
  assert.equal(h.diffHz, 0);
  assert.deepEqual(h.observingStationsWithCoexistence, ['07']);
  assert.deepEqual(h.generators.map((g) => [g.freqHz, g.coef, g.stations]), [[MHZ(89.3), 1, ['01', '07']], [MHZ(89.58), 1, ['01', '07']], [MHZ(90.1), -1, ['02', '07']]]);
  assert.equal(h.mechanisms.find((m) => m.id === 'im_receptor')!.status, 'compatible');
  assert.ok(h.mechanisms.some((m) => m.id === 'pim') && h.mechanisms.some((m) => m.id === 'im_transmisor') && h.mechanisms.some((m) => m.id === 'sistemas_compartidos'));
  assert.ok(inv.neededMeasurements.length > 0);
  assert.ok(inv.notes.some((n) => /no es una atribución causal/.test(n)));
  // frecuencia sin observaciones
  const inv2 = investigateFrequency(db, MHZ(90.42), 10_000);
  assert.equal(inv2.observations.length, 0);
  assert.ok(inv2.neededMeasurements.some((m) => /Registrar si la frecuencia se observa/.test(m)));
});

// 8 ------------------------------------------------------------------ comparación
test('comparación entre estaciones: matriz de presencia', () => {
  const db = exampleDb();
  const rows = compareStations(db, ['01', '07', '02'], 10_000, { includeSimulated: true });
  const r893 = rows.find((r) => r.freqHz === MHZ(89.3))!;
  assert.deepEqual(Object.keys(r893.perStation).sort(), ['01', '07']);
  const r901 = rows.find((r) => r.freqHz === MHZ(90.1))!;
  assert.equal(r901.stations, 2);
  assert.ok(rows.every((r) => Object.values(r.perStation).flat().every((x) => x.status !== 'asignada_oficialmente')), 'las asignaciones no cuentan como recepción');
});

// 11 ------------------------------------------------------------------ clasificación A/B/C/D
test('clasificación A/B/C/D sobre la base nacional', () => {
  const db = exampleDb();
  const obs = observedKey('07', MHZ(88.78));
  let sa = analyzeScope(db, { kind: 'estacion', stationId: '07' });
  let h = sa.audit.hypotheses.find((x) => x.observedId === obs && sa.run.result.store.tones[x.combo] === 3)!;
  assert.equal(h.classification.cls, 'B');
  const ev: Evidence = { id: 'e1', observedId: obs, hypothesisKey: h.key, type: 'apagado_generador', result: 'compatible', description: 'Desaparece al apagar 90.10 (coordinado).', date: '2026-10-30', author: 'FO', labTestId: null };
  addEvidence(db, ev);
  sa = analyzeScope(db, { kind: 'estacion', stationId: '07' });
  h = sa.audit.hypotheses.find((x) => x.observedId === obs && x.key === h.key)!;
  assert.equal(h.classification.cls, 'C');
  setConfirmation(db, { observedId: obs, hypothesisKey: h.key, justification: 'Apagado coordinado del generador 90.10: el producto desaparece y reaparece.', author: 'FO', date: '2026-10-30' });
  sa = analyzeScope(db, { kind: 'estacion', stationId: '07' });
  assert.equal(sa.audit.hypotheses.find((x) => x.observedId === obs && x.key === h.key)!.classification.cls, 'D');
  const g = findGroup(sa.run.result, MHZ(90.42));
  assert.equal(sa.audit.groupClass.get(g) ?? 'A', 'A');
});

// 12 ------------------------------------------------------------------ datos reales y simulados
test('separación de datos reales y simulados', () => {
  const db = emptyNationalDB();
  loadExampleData(db);
  addRecords(db, [{ stationId: '07', freqHz: MHZ(101.1), status: 'portadora_confirmada' }]);
  assert.equal(db.settings.includeSimulated, false);
  assert.deepEqual(activeRecords(db).map((r) => r.dataKind), ['real']);
  assert.equal(recordsOfScope(db, { kind: 'estacion', stationId: '07' }).length, 1);
  assert.equal(recordsOfScope(db, { kind: 'estacion', stationId: '07' }, { includeSimulated: true }).length, 5);
  assert.ok(db.records.filter((r) => r.dataKind === 'simulado').every((r) => /no es una medición real/.test(r.notes)));
  db.settings.includeSimulated = true;
  const sa = analyzeScope(db, { kind: 'estacion', stationId: '07' });
  assert.match(findingsReport(db, sa), /INCLUYE DATOS SIMULADOS/);
  db.settings.includeSimulated = false;
  const sa2 = analyzeScope(db, { kind: 'estacion', stationId: '07' });
  assert.match(findingsReport(db, sa2), /solo registros marcados como reales/);
});

// 9 ------------------------------------------------------------------ importación
test('importación masiva con columna de estación, estados, unidades y errores por fila', () => {
  const db = emptyNationalDB();
  const csv = [
    'Estación;Frecuencia (MHz);Nivel (dBµV);Ancho de banda (kHz);Servicio;Emisora;Estado;Fecha;Hora;Autorización',
    'Barahona;89,30;45;200;Radiodifusión FM;Radio A;confirmada;2026-10-20;10:00;',
    '07;88,78;20;;;;sospechosa de IM;2026-10-20;10:05;',
    '1;95,90;;;;;asignada;;;Autorizada (Resolución 123)',
    'Estación X;90,10;;;;;;;;',
    'Higüey;abc;;;;;;;;',
    'jacobo — distrito nacional;89,58;-50;;;;observada;2026-10-21;;',
  ].join('\n');
  const im = importObservations(parseCSV(csv).rows, { stations: db.stations, defaultStationId: null, dataKind: 'real', sourceId: null });
  assert.equal(im.inputs.length, 4);
  assert.deepEqual(im.errors.map((e) => e.row), [5, 6]);
  const [a, b, c, d] = im.inputs;
  assert.deepEqual([a.stationId, a.freqHz, a.status, a.levelValue, a.levelUnit, a.bandwidthHz, a.emisora, a.datetime], ['07', MHZ(89.3), 'portadora_confirmada', 45, 'dBµV', 200_000, 'Radio A', '2026-10-20 10:00']);
  assert.equal(b.status, 'sospechosa_im');
  assert.equal(c.status, 'asignada_oficialmente');
  assert.equal(c.stationId, '01');
  assert.equal(c.authorization!.status, 'autorizada');
  assert.match(c.authorization!.evidence, /Resolución 123/);
  assert.equal(d.stationId, '01');
  const rep = addRecords(db, im.inputs, 'importación');
  assert.equal(rep.added.length, 4);
  // sin columna de estación: exige estación de destino
  assert.equal(importObservations([['Frecuencia'], ['89.3']], { stations: db.stations, defaultStationId: null, dataKind: 'real', sourceId: null }).errors.length, 1);
  assert.equal(importObservations([['Frecuencia'], ['89.3']], { stations: db.stations, defaultStationId: '05', dataKind: 'real', sourceId: null }).inputs[0].stationId, '05');
  // JSON
  const j = jsonToRows(JSON.stringify([{ estacion: 'Santiago', frecuencia: '90.1', estado: 'confirmada', __proto__x: 1 }]));
  const ij = importObservations(j.rows, { stations: db.stations, defaultStationId: null, dataKind: 'real', sourceId: null });
  assert.equal(ij.inputs[0].stationId, '02');
  assert.equal(jsonToRows('{mal').error?.startsWith('JSON mal formado'), true);
  assert.equal(resolveStation(db.stations, 'Dajabon')!.id, '05');
  assert.equal(resolveStation(db.stations, 'San'), null, 'ambiguo no se adivina');
});

test('miles de registros en una operación (rendimiento y duplicados)', () => {
  const db = emptyNationalDB();
  const inputs = Array.from({ length: 5000 }, (_, i) => ({ stationId: String((i % 8) + 1).padStart(2, '0'), freqHz: 88_100_000 + (i % 100) * 200_000, datetime: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, status: 'observada_sin_identificar' as const }));
  const t0 = Date.now();
  const rep = addRecords(db, [...inputs, ...inputs.slice(0, 500)]);
  assert.ok(Date.now() - t0 < 3000);
  // (estación, frecuencia, fecha) se repite con periodo mcm(8, 100, 28) = 1400 → 1400 registros distintos
  assert.equal(rep.added.length, 1400);
  assert.equal(rep.duplicates.length, 5500 - 1400);
});

test('importación masiva: 5000 filas CSV analizadas e insertadas en una operación', () => {
  const db = emptyNationalDB();
  const lines = ['Estación,Frecuencia (MHz),Nivel (dBm),Fecha,Estado'];
  for (let i = 0; i < 5000; i++) lines.push(`${(i % 8) + 1},${(88.1 + (i % 100) * 0.2).toFixed(1)},${-40 - (i % 50)},2026-10-${String((i % 28) + 1).padStart(2, '0')},observada`);
  const t0 = Date.now();
  const im = importObservations(parseCSV(lines.join('\n')).rows, { stations: db.stations, defaultStationId: null, dataKind: 'real', sourceId: null });
  const rep = addRecords(db, im.inputs);
  const ms = Date.now() - t0;
  assert.equal(im.errors.length, 0);
  assert.equal(im.inputs.length, 5000);
  assert.equal(rep.added.length + rep.duplicates.length, 5000);
  assert.ok(ms < 3000, `tardó ${ms} ms`);
});

// 13 ------------------------------------------------------------------ copia de seguridad
test('copia de seguridad: restauración íntegra, suma SHA-256 y rechazo atómico', () => {
  const db = exampleDb();
  reassignProvince(db, 'DO-16', 'R06', 'prueba');
  addEvidence(db, { id: 'e1', observedId: observedKey('07', MHZ(88.78)), hypothesisKey: null, type: 'otra', result: 'no_concluyente', description: '<script>alert(1)</script>', date: '2026-10-30', author: 'FO', labTestId: null });
  const txt = exportBackup(db, new Date('2026-10-30T00:00:00Z'));
  const r = parseBackup(txt);
  assert.deepEqual(r.errors, []);
  assert.equal(stableStringify(r.db), stableStringify(db), 'restauración idéntica');
  assert.equal(dbChecksum(r.db!), dbChecksum(db));
  assert.equal(r.db!.evidence[0].description, '<script>alert(1)</script>', 'el texto se conserva como texto');
  // manipulación → rechazo completo
  const tampered = JSON.parse(txt);
  tampered.data.records[0].freqHz = 1;
  const rt = parseBackup(JSON.stringify(tampered));
  assert.equal(rt.db, null);
  assert.ok(rt.errors.some((e) => /SHA-256/.test(e)));
  assert.equal(parseBackup('{"schema":"otra"}').db, null);
  assert.equal(parseBackup('no json').db, null);
  const missing = JSON.parse(txt); delete missing.data.records;
  assert.ok(parseBackup(JSON.stringify(missing)).errors.some((e) => /records/.test(e)));
});

test('seguridad: sin contaminación de prototipos ni ejecución de contenido importado', () => {
  const evil = '{"__proto__":{"contaminado":true},"a":{"constructor":{"prototype":{"x":1}}},"b":"<img src=x onerror=alert(1)>"}';
  const s = sanitize(JSON.parse(evil)) as Record<string, unknown>;
  assert.equal(({} as Record<string, unknown>).contaminado, undefined);
  assert.equal(Object.getPrototypeOf(s), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(s, '__proto__'), false);
  assert.deepEqual(s.a, {});
  assert.equal(s.b, '<img src=x onerror=alert(1)>');
  const db = emptyNationalDB();
  const bk = JSON.parse(exportBackup(db));
  bk.data.records = [{ __proto__: { polluted: 1 } }];
  assert.equal(parseBackup(JSON.stringify(bk)).db, null);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
