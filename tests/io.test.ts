import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  analysisJson, audit, auditReport, combosRows, crc32, emptyProject, findPeaks, importSignals, importTrace, makeSignal, matchesRows,
  parseCSV, parseManualList, parseProject, productsRows, readXlsx, readZip, runAnalysis, sha256Hex, toCSV, utf8Decode, utf8Encode,
  workbookSheets, writeXlsx, writeZip, selectedGenerators, formatMHz, findGroup,
} from '../src/engine/index.js';
import { gens, hz, params } from './helpers.js';

const inflate = async (b: Uint8Array) => new Uint8Array(inflateRawSync(b));

test('UTF-8, CRC-32 y SHA-256 con vectores conocidos', () => {
  assert.equal(utf8Decode(utf8Encode('Señal ±10 kHz — µV 📡')), 'Señal ±10 kHz — µV 📡');
  assert.equal(crc32(utf8Encode('123456789')).toString(16), 'cbf43926');
  assert.equal(sha256Hex(utf8Encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex(utf8Encode('a'.repeat(1000))), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
});

test('CSV: comillas, separadores, BOM, punto y coma con coma decimal', () => {
  const r = parseCSV('﻿Frecuencia;Nivel (dBm);Emisora\r\n89,30;-45,5;"Radio ""Uno""; FM"\r\n89,58;-50;Dos\r\n');
  assert.equal(r.delimiter, ';');
  assert.deepEqual(r.rows[1], ['89,30', '-45,5', 'Radio "Uno"; FM']);
  const back = parseCSV(toCSV([['a', 'b,c', 'd"e'], [1, 2.5, null]]));
  assert.deepEqual(back.rows, [['a', 'b,c', 'd"e'], ['1', '2.5', '']]);
  assert.equal(parseCSV('a,"b\nc').errors.length, 1, 'comillas sin cerrar se informan');
});

test('importación de mediciones (SCORPIO exportado a CSV) con detección de columnas', () => {
  const csv = 'Frequency [MHz];Level [dBm];Date;Time;Device;Remarks;Class\n89,850;-72,3;2026-10-20;10:15:00;SCORPIO-1;pico débil;observada\n88,740;-80;2026-10-20;10:16:00;SCORPIO-1;;sospechosa\n';
  const res = importSignals(parseCSV(csv).rows, { source: 'medicion.csv' });
  assert.equal(res.errors.length, 0);
  assert.equal(res.signals.length, 2);
  assert.equal(res.mapping.freqUnit, 'MHz');
  assert.equal(res.mapping.freqUnitSource, 'cabecera');
  const s = res.signals[0];
  assert.equal(s.freqHz, 89_850_000);
  assert.equal(s.levelDbm, -72.3);
  assert.equal(s.datetime, '2026-10-20 10:15:00');
  assert.equal(s.equipment, 'SCORPIO-1');
  assert.equal(s.notes, 'pico débil');
  assert.equal(s.classification, 'senal_observada');
  assert.equal(res.signals[1].classification, 'sospechosa', 'una sospechosa sigue siendo sospechosa');
});

test('importación con dBµV, Hz sin cabecera de unidad y filas malformadas', () => {
  const csv = 'freq,nivel dBuV,nombre\n89300000,40,A\nabc,30,B\n,,\n89580000,,C\n-5,1,D\n89580000,35,E\n';
  const res = importSignals(parseCSV(csv).rows, { source: 'x.csv' });
  assert.equal(res.mapping.freqUnit, 'Hz');
  assert.equal(res.signals.length, 3);
  assert.equal(res.signals[0].levelDbm, -67);
  assert.deepEqual(res.errors.map((e) => e.row), [3, 6], 'filas rechazadas con su número');
  assert.ok(res.warnings.some((w) => /repetida/.test(w.message)));
  assert.ok(res.warnings.some((w) => /inferida/.test(w.message)));
  const none = importSignals(parseCSV('nivel,nombre\n-40,A\n').rows, { source: 'y.csv' });
  assert.equal(none.signals.length, 0);
  assert.match(none.errors[0].message, /columna de frecuencia/);
  const kw = importSignals(parseCSV('Frecuencia,Potencia (kW)\n89.3,5\n').rows, { source: 'z.csv' });
  assert.equal(kw.signals[0].levelDbm, null, 'kW no se interpreta como dBm');
  assert.equal(kw.signals[0].levelRaw, '5');
});

test('lista manual', () => {
  const r = parseManualList('89.30 MHz\n89.58 MHz  Radio Dos\n90.10\n# comentario\n93,70 MHz\nfoo\n95.90 MHz');
  assert.deepEqual(r.signals.map((s) => s.freqHz), [89_300_000, 89_580_000, 90_100_000, 93_700_000, 95_900_000]);
  assert.equal(r.signals[1].label, 'Radio Dos');
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].row, 6);
});

test('traza de espectro y detección de picos', () => {
  const rows = [['Frequency (Hz)', 'Level (dBm)']];
  for (let i = 0; i <= 200; i++) {
    const f = 88_000_000 + i * 10_000;
    let lvl = -100;
    if (f === 88_740_000) lvl = -70;
    if (f === 89_300_000) lvl = -30;
    rows.push([String(f), String(lvl)]);
  }
  const t = importTrace(rows);
  assert.equal(t.errors.length, 0);
  assert.equal(t.points.length, 201);
  const pk = findPeaks(t.points, -80, 50_000);
  assert.deepEqual(pk.map((p) => p.hz), [88_740_000, 89_300_000]);
});

test('ZIP: escritura almacenada y lectura de deflate', async () => {
  const z = writeZip([{ name: 'a.txt', data: utf8Encode('hola') }, { name: 'ñ/b.xml', data: utf8Encode('<x/>') }]);
  const m = await readZip(z);
  assert.equal(utf8Decode(m.get('a.txt') as Uint8Array), 'hola');
  assert.equal(utf8Decode(m.get('ñ/b.xml') as Uint8Array), '<x/>');
  // construimos a mano un ZIP con deflate (método 8) para verificar la lectura
  const raw = utf8Encode('contenido comprimido '.repeat(50));
  const comp = new Uint8Array(deflateRawSync(raw));
  const stored = writeZip([{ name: 'c.txt', data: comp }]);
  const v = new DataView(stored.buffer);
  v.setUint16(8, 8, true); // método en cabecera local
  const cd = stored.length - 22 - (46 + 5);
  v.setUint16(cd + 10, 8, true);
  v.setUint32(cd + 16, crc32(raw), true);
  v.setUint32(cd + 24, raw.length, true);
  const m2 = await readZip(stored, inflate);
  assert.equal(utf8Decode(m2.get('c.txt') as Uint8Array), 'contenido comprimido '.repeat(50));
  await assert.rejects(readZip(utf8Encode('no es zip')), /ZIP/);
  const bad = z.slice(); bad[35] ^= 0xff;
  await assert.rejects(readZip(bad), /CRC/);
});

test('XLSX: ida y vuelta con varias hojas, números, texto y caracteres especiales', async () => {
  const x = writeXlsx([
    { name: 'Emisoras', rows: [['Frecuencia (MHz)', 'Emisora', 'Nivel (dBm)'], [89.3, 'Radio <Uno> & "Dos"', -45.5], [89.58, 'Señal µ', null]] },
    { name: 'Otra/Hoja:*', rows: [['x'], [true]] },
  ]);
  const sheets = await readXlsx(x, inflate);
  assert.deepEqual(sheets.map((s) => s.name), ['Emisoras', 'Otra Hoja']);
  assert.deepEqual(sheets[0].rows[1], ['89.3', 'Radio <Uno> & "Dos"', '-45.5']);
  assert.equal(sheets[0].rows[2][1], 'Señal µ');
  assert.equal(sheets[1].rows[1][0], 'TRUE');
  const imp = importSignals(sheets[0].rows, { source: 'emisoras.xlsx', fromXlsx: true });
  assert.deepEqual(imp.signals.map((s) => s.freqHz), [89_300_000, 89_580_000]);
});

test('XLSX con cadenas compartidas y celdas dispersas (como las escribe Excel)', async () => {
  const enc = (s: string) => utf8Encode(s);
  const files = [
    { name: '[Content_Types].xml', data: enc('<Types/>') },
    { name: 'xl/workbook.xml', data: enc('<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Medidas" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/sharedStrings.xml', data: enc('<sst><si><t>Frecuencia MHz</t></si><si><r><t>Ni</t></r><r><t>vel</t></r></si><si><t>Fecha</t></si></sst>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row><row r="3"><c r="A3"><v>89.299999999999997</v></c><c r="C3"><v>-70.25</v></c><c r="D3"><v>46315.5</v></c></row></sheetData></worksheet>') },
  ];
  const sheets = await readXlsx(writeZip(files));
  assert.deepEqual(sheets[0].rows[0], ['Frecuencia MHz', '', 'Nivel', 'Fecha']);
  const imp = importSignals(sheets[0].rows, { source: 'm.xlsx', fromXlsx: true });
  assert.equal(imp.signals.length, 1);
  assert.equal(imp.signals[0].freqHz, 89_300_000, 'artefacto binario de Excel cuantizado correctamente');
  assert.equal(imp.signals[0].levelDbm, -70.25);
  // 46315.5 = 2026-10-20 12:00 (comprobado con datetime de Python: 1899-12-30 + 46315 días)
  assert.equal(imp.signals[0].datetime, '2026-10-20T12:00:00Z');
});

function fullCase() {
  const p = emptyProject('Caso 89.30/89.58');
  p.transmitters = gens(['89.30', '89.58'], 'portadora_confirmada');
  p.selectedIds = p.transmitters.map((t) => t.id);
  p.observed = [makeSignal(hz('89.85'), { id: 'o1', levelDbm: -72 }), makeSignal(hz('88.74'), { id: 'o2', levelDbm: -80 }), makeSignal(hz('95.00'), { id: 'o3' })];
  p.params = params({ maxOrder: 9, maxTones: 2, toleranceHz: 10_000 });
  p.sources.push({ name: 'demo', kind: 'observadas', sha256: sha256Hex(utf8Encode('demo')), bytes: 4, importedAt: '2026-10-29T00:00:00Z', rowsAccepted: 3, rowsRejected: 0 });
  const run = runAnalysis(selectedGenerators(p), p.params, new Date('2026-10-29T12:00:00Z'));
  const au = audit(run, p.observed, p.params.toleranceHz, p.evidence, p.confirmations);
  return { p, run, au };
}

test('exportación CSV de productos, combinaciones y coincidencias', () => {
  const { run, au } = fullCase();
  const prod = productsRows(run, au);
  assert.equal(prod.length, 1 + 8);
  const row8986 = prod.find((r) => r[0] === '89.860') as unknown[];
  assert.equal(row8986[2], 'IM3');
  assert.equal(row8986[3], '2(89.58) - 89.30');
  assert.equal(row8986[9], '89.850');
  assert.equal(row8986[10], '-10.000');
  assert.match(String(row8986[12]), /^B/);
  const row8874 = prod.find((r) => r[0] === '88.740') as unknown[];
  assert.equal(row8874[3], '3(89.30) - 2(89.58)');
  assert.equal(row8874[10], '0.000');
  const csv = toCSV(prod);
  const back = parseCSV(csv).rows;
  assert.equal(back.length, prod.length);
  assert.equal(back[0][0], 'Frecuencia calculada (MHz)');
  assert.equal(combosRows(run).length, 1 + run.result.store.count);
  const mr = matchesRows(run, au);
  assert.equal(mr.length, 1 + 2 + 1, 'dos hipótesis y una señal sin coincidencia');
});

test('JSON trazable: reimportación y reproducibilidad del análisis', () => {
  const { p, run, au } = fullCase();
  const json = JSON.stringify(analysisJson(run, p, au));
  const data = JSON.parse(json);
  assert.equal(data.schema, 'orbe-im-analyzer/analisis@1');
  assert.equal(data.algorithmVersion, '1.0.0');
  assert.equal(data.analysisDate, '2026-10-29T12:00:00.000Z');
  assert.equal(data.parameters.toleranceHz, 10_000);
  assert.equal(data.completeness.complete, true);
  assert.equal(data.sources[0].sha256.length, 64);
  const prod = data.products.find((x: { freqHz: number }) => x.freqHz === 88_740_000);
  assert.deepEqual(prod.combinations[0].terms.map((t: { generatorId: string; coef: number }) => [t.generatorId, t.coef]), [['g1', 3], ['g2', -2]]);
  assert.equal(prod.combinations[0].formulaNumeric, '3(89.300000) - 2(89.580000)');
  const o1 = data.audit.observed.find((o: { signal: { id: string } }) => o.signal.id === 'o1');
  assert.equal(o1.hypotheses[0].diffHz, -10_000);
  // reimportar → recalcular → mismos productos
  const imp = parseProject(json);
  assert.equal(imp.errors.length, 0);
  assert.equal(imp.isAnalysisExport, true);
  const pr = imp.project!;
  const run2 = runAnalysis(selectedGenerators(pr), pr.params);
  assert.deepEqual(Array.from(run2.result.groupFreq), data.products.map((x: { freqHz: number }) => x.freqHz));
  assert.equal(formatMHz(run2.result.groupFreq[findGroup(run2.result, 89_860_000)]), '89.86');
});

test('importaciones de proyecto malformadas se rechazan con mensajes claros', () => {
  assert.match(parseProject('{no json').errors[0], /JSON mal formado/);
  assert.match(parseProject('{"a":1}').errors[0], /No es un proyecto/);
  const bad = JSON.stringify({ ...emptyProject(), transmitters: [{ id: 'x', freqHz: 89.3 }, { id: 'y', freqHz: 89_300_000, classification: 'portadora_real' }, { id: 'z', freqHz: 90_000_000 }] });
  const r = parseProject(bad);
  assert.equal(r.project?.transmitters.length, 1);
  assert.equal(r.errors.length, 2);
});

test('libro Excel completo e informe de auditoría', async () => {
  const { p, run, au } = fullCase();
  const x = writeXlsx(workbookSheets(run, p, au));
  const sheets = await readXlsx(x, inflate);
  assert.deepEqual(sheets.map((s) => s.name), ['Parámetros', 'Generadores', 'Productos', 'Combinaciones', 'Observadas', 'Coincidencias', 'Limitaciones']);
  assert.equal(sheets[2].rows.length, 9);
  const rep = auditReport(run, p, au);
  assert.match(rep, /EXHAUSTIVO dentro de los límites/);
  assert.match(rep, /Probabilidad de coincidencia fortuita/);
  assert.match(rep, /\| 89\.850 \| -72 \| 89\.860 \| -10\.000 \| IM3 \|/);
  assert.match(rep, /\| 88\.740 \| -80 \| 88\.740 \| 0\.000 \| IM5 \|/);
  assert.match(rep, /Limitaciones matemáticas y experimentales/);
  assert.match(rep, /sin coincidencia/);
});
