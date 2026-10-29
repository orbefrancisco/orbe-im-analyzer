// Prueba de humo de las vistas nacionales (mapa, estación, investigador, comparativo, espectro, base de datos)
// sobre la interfaz compilada (web/js) y un DOM mínimo en Node. IndexedDB no existe en Node:
// la aplicación usa su reserva en memoria y lo advierte; la capa IndexedDB se verifica en el navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, find, findAll, tick, fakeFile, answerFilePicker, SECTION_IDS } from './dom-shim.mjs';

const { document, body, downloads, FakeElement } = installDom();
for (const id of SECTION_IDS) { const el = new FakeElement('section'); el.setAttribute('id', id); body.appendChild(el); }
const sec = (id) => document.getElementById(id);
const setInput = (el, v) => { el.value = v; el.dispatch('change', { _noBubble: true }); };
const byLabel = (root, label) => [...root.querySelectorAll('input'), ...root.querySelectorAll('select'), ...root.querySelectorAll('textarea')].find((e) => e.getAttribute('aria-label') === label);
const tab = (t) => find(sec('tabs'), 'button', t).click();

await import('../../web/js/ui/main.js');
const { nat } = await import('../../web/js/ui/natstore.js');
for (let i = 0; i < 100 && !nat.ready; i++) await tick(10);

async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await tick(10); }
  return false;
}

test('arranque: base nacional en memoria (sin IndexedDB en Node), cartografía real cargada', () => {
  assert.equal(nat.ready, true);
  assert.equal(nat.cartoError, '');
  assert.equal(nat.carto.provincias.length, 32);
  assert.equal(nat.backendKind, 'memoria');
  const s = sec('sec-nacional');
  assert.equal(s.hidden, false, 'el Panel nacional es la pestaña inicial');
  assert.ok(s.textContent.includes('IndexedDB'), 'se advierte de la falta de persistencia');
});

test('mapa: 32 provincias seleccionables y 8 estaciones, 3 con incertidumbre visible', () => {
  const s = sec('sec-nacional');
  const provs = s.querySelectorAll('path').filter((p) => (p.getAttribute('class') ?? '').includes('prov'));
  assert.equal(provs.length, 32);
  assert.ok(provs.every((p) => p.getAttribute('tabindex') === '0' && p.getAttribute('role') === 'button'));
  const sts = s.querySelectorAll('g').filter((g) => /^st\b/.test(g.getAttribute('class') ?? ''));
  assert.equal(sts.length, 8);
  assert.equal(sts.filter((g) => g.getAttribute('class').includes('unc')).length, 3);
  assert.equal(s.querySelectorAll('circle').filter((c) => c.getAttribute('class') === 'unc-circle').length, 3);
  assert.equal(s.querySelectorAll('rect').filter((c) => c.getAttribute('class') === 'hist-mark').length, 2, 'históricas discrepantes de Puerto Plata y Barahona');
  // colores de región en modo «regiones»
  const fills = new Set(provs.map((p) => p.getAttribute('fill')));
  assert.equal(fills.size, 8);
});

test('seleccionar provincia y reasignarla de región (con motivo y sin perder datos)', async () => {
  const s = sec('sec-nacional');
  const ped = s.querySelectorAll('path').find((p) => p.getAttribute('data-id') === 'DO-16');
  ped.dispatch('click', { _noBubble: true });
  assert.ok(s.textContent.includes('Pedernales (DO-16)'));
  setInput(byLabel(s, 'Región de la provincia'), 'R06');
  assert.equal(nat.db.provinceRegion['DO-16'], 'R06');
  assert.equal(nat.db.assignmentHistory.at(-1).reason, 'motivo de prueba');
  setInput(byLabel(s, 'Región de la provincia'), 'R07');
  assert.equal(nat.db.provinceRegion['DO-16'], 'R07');
});

test('seleccionar estación: ficha con los ocho apartados y coordenada discrepante', () => {
  const s = sec('sec-nacional');
  const g = s.querySelectorAll('g').find((x) => (x.getAttribute('aria-label') ?? '').startsWith('Estación Barahona'));
  g.dispatch('click', { _noBubble: true });
  const t = s.textContent;
  for (const k of ['1. Nombre y ubicación', '2. Región de vigilancia', '3. Provincias asignadas', '4. Frecuencias registradas', '5. Señales sin identificar', '6. Posibles productos de intermodulación', '7. Última medición', '8. Estado de validación']) assert.ok(t.includes(k), k);
  assert.ok(t.includes('Histórica discrepante'));
  assert.ok(t.includes('Duvergé'), 'nota de la coordenada histórica en Duvergé');
  assert.ok(t.includes('Enriquillo'));
  const jac = s.querySelectorAll('g').find((x) => (x.getAttribute('aria-label') ?? '').startsWith('Estación Jacobo'));
  jac.dispatch('click', { _noBubble: true });
  assert.ok(s.textContent.includes('Santo Domingo Norte'), 'Jacobo: torre en Santo Domingo Norte');
  assert.ok(s.textContent.includes('Jacobo — Distrito Nacional'));
});

test('datos de ejemplo simulados y separación de los reales', async () => {
  tab('Base de datos');
  const s = sec('sec-basedatos');
  find(s, 'button', 'Cargar datos de ejemplo').click();
  await nat.flush();
  assert.equal(nat.db.records.filter((r) => r.dataKind === 'simulado').length, 9);
  assert.equal(nat.db.settings.includeSimulated, true);
  assert.ok(sec('sec-basedatos').textContent.includes('9 registros simulados activos'));
});

test('estación: inventario, alta, duplicado, edición con motivo, anulación y análisis', async () => {
  tab('Estación');
  const s = sec('sec-estacion');
  find(s, 'button', '07 Barahona').click();
  assert.ok(s.textContent.includes('88.780'));
  // alta manual
  const form = findAll(s, 'div').find((d) => d.className === 'form-box');
  setInput(byLabel(form, 'Frecuencia (MHz)'), '91.30');
  setInput(byLabel(form, 'Fecha y hora'), '2026-10-29 11:00');
  find(form, 'button', 'Añadir registro').click();
  await nat.flush();
  assert.ok(nat.db.records.some((r) => r.stationId === '07' && r.freqHz === 91_300_000 && r.dataKind === 'real'));
  const n = nat.db.records.length;
  const form2 = findAll(sec('sec-estacion'), 'div').find((d) => d.className === 'form-box');
  setInput(byLabel(form2, 'Frecuencia (MHz)'), '91.30');
  setInput(byLabel(form2, 'Fecha y hora'), '2026-10-29 11:00');
  find(form2, 'button', 'Añadir registro').click();
  assert.equal(nat.db.records.length, n, 'el duplicado exacto no se añade');
  // edición
  const rec = nat.db.records.find((r) => r.freqHz === 91_300_000);
  const row = findAll(sec('sec-estacion'), 'tr', '91.300').find((r) => r.textContent.includes('Editar'));
  find(row, 'button', 'Editar').click();
  const edit = findAll(sec('sec-estacion'), 'tr').find((r) => r.className === 'expand');
  setInput(byLabel(edit, 'Emisora'), 'Radio prueba');
  find(edit, 'button', 'Guardar cambios').click();
  assert.equal(rec.emisora, '', 'sin motivo no se guarda');
  setInput(byLabel(edit, 'Motivo'), 'identificación por escucha');
  find(edit, 'button', 'Guardar cambios').click();
  assert.equal(rec.emisora, 'Radio prueba');
  assert.equal(rec.history.length, 1);
  // anulación (prompt devuelve el motivo)
  const row2 = findAll(sec('sec-estacion'), 'tr', '91.300').find((r) => r.textContent.includes('Anular'));
  find(row2, 'button', 'Anular').click();
  assert.equal(rec.voided.reason, 'motivo de prueba');
  assert.ok(nat.db.records.includes(rec), 'no se borra');
  // análisis de la estación
  find(sec('sec-estacion'), 'button', 'Recalcular productos').click();
  assert.ok(await waitFor(() => sec('sec-estacion').textContent.includes('89.30 + 89.58 − 90.10')), 'hipótesis 88.78 = f1 + f2 − f3');
  const t = sec('sec-estacion').textContent;
  assert.ok(t.includes('EXHAUSTIVO dentro de los límites'));
  assert.ok(t.includes('SIMULADOS'));
  const n0 = downloads.length;
  find(sec('sec-estacion'), 'button', 'Informe de hallazgos').click();
  const rep = await downloads[n0].text();
  assert.match(rep, /Informe de hallazgos — Estación Barahona/);
  assert.match(rep, /INCLUYE DATOS SIMULADOS/);
  assert.match(rep, /Pruebas recomendadas/);
});

test('importación con vista previa: nada se guarda sin confirmar; el HTML importado no se ejecuta', async () => {
  const s = sec('sec-estacion');
  const n = nat.db.records.length;
  const csv = 'Estación;Frecuencia (MHz);Emisora;Estado\nBarahona;92,50;<img src=x onerror=alert(1)>;observada\nDajabón;93,10;Radio Norte;confirmada\nDesconocida;94,00;;\n';
  find(s, 'button', 'Elegir archivo').click();
  await answerFilePicker(body, fakeFile('scorpio.csv', csv));
  assert.ok(await waitFor(() => sec('sec-estacion').textContent.includes('Confirmar importación de 2 registros')));
  assert.equal(nat.db.records.length, n, 'vista previa: aún no se guarda nada');
  assert.ok(sec('sec-estacion').textContent.includes('Estación no reconocida'));
  find(sec('sec-estacion'), 'button', 'Confirmar importación').click();
  await nat.flush();
  assert.equal(nat.db.records.length, n + 2);
  const r = nat.db.records.find((x) => x.freqHz === 92_500_000);
  assert.equal(r.emisora, '<img src=x onerror=alert(1)>');
  assert.equal(nat.db.records.find((x) => x.freqHz === 93_100_000).stationId, '05');
  assert.ok(nat.db.sources.some((x) => x.name === 'scorpio.csv' && x.sha256.length === 64));
  assert.equal(body.querySelectorAll('img').length, 0, 'ningún <img> creado a partir de datos importados');
  assert.ok(sec('sec-estacion').textContent.includes('<img src=x onerror=alert(1)>'), 'se muestra como texto');
});

test('investigador: 88.78 MHz con estaciones, coexistencia, mecanismos y mediciones', async () => {
  const s = sec('sec-estacion');
  const row = findAll(s, 'tr', '88.780').find((x) => x.textContent.includes('Investigar'));
  find(row, 'button', 'Investigar').click();
  const iv = sec('sec-investigador');
  assert.equal(iv.hidden, false);
  assert.ok(await waitFor(() => iv.textContent.includes('Combinaciones generadoras')), iv.textContent.slice(0, 300));
  const t = iv.textContent;
  assert.ok(t.includes('INVESTIGAR FRECUENCIA'));
  assert.ok(t.includes('89.30 + 89.58 − 90.10 = 88.780 MHz'));
  assert.ok(t.includes('Coexistencia documentada'));
  assert.ok(t.includes('Intermodulación pasiva (PIM)'));
  assert.ok(t.includes('Intermodulación en el transmisor'));
  assert.ok(t.includes('Mediciones que faltan'));
  assert.ok(t.includes('no es una atribución causal'));
});

test('investigador: análisis nacional (exploratorio) y modo comparativo', async () => {
  const iv = sec('sec-investigador');
  find(iv, 'button', 'Estación / región / nacional').click();
  find(sec('sec-investigador'), 'button', 'Analizar Nacional').click();
  assert.ok(await waitFor(() => sec('sec-investigador').textContent.includes('Hipótesis con señal observada')));
  assert.ok(sec('sec-investigador').textContent.includes('exploratorio'));
  find(sec('sec-investigador'), 'button', 'Comparativo').click();
  const t = sec('sec-investigador').textContent;
  assert.ok(t.includes('registradas en dos o más'));
  const row = findAll(sec('sec-investigador'), 'tr', '89.300').find((r) => r.className === 'hit');
  assert.ok(row, '89.30 presente en Jacobo y Barahona');
});

test('espectro RF: marcadores sin traza fabricada; barrido importado con niveles', async () => {
  tab('Espectro RF');
  const s = sec('sec-espectro');
  assert.ok(s.textContent.includes('no se dibuja ninguna traza'));
  assert.ok(s.querySelectorAll('canvas').length === 1);
  tab('Estación');
  const pts = ['Frequency (MHz),Level (dBm)', ...Array.from({ length: 50 }, (_, i) => `${(88 + i * 0.1).toFixed(1)},${i === 7 ? -40 : -95}`)].join('\n');
  find(sec('sec-estacion'), 'button', 'Importar barrido').click();
  await answerFilePicker(body, fakeFile('barrido.csv', pts));
  assert.ok(await waitFor(() => nat.db.sweeps.length === 1));
  tab('Espectro RF');
  const sel = byLabel(sec('sec-espectro'), 'Barrido');
  setInput(sel, nat.db.sweeps[0].id);
  assert.ok(!sec('sec-espectro').textContent.includes('no se dibuja ninguna traza'));
});

test('copia de seguridad: exportar y restaurar íntegramente', async () => {
  tab('Base de datos');
  const s = sec('sec-basedatos');
  const n0 = downloads.length;
  find(s, 'button', 'Exportar copia completa').click();
  const txt = await downloads[n0].text();
  const before = JSON.stringify(nat.db.records);
  const { parseBackup } = await import('../../web/js/engine/index.js');
  assert.deepEqual(parseBackup(txt).errors, []);
  // se modifica la base y luego se restaura la copia
  nat.mutate((d) => { d.records = []; }, ['records']);
  assert.equal(nat.db.records.length, 0);
  find(sec('sec-basedatos'), 'button', 'Restaurar copia').click();
  await answerFilePicker(body, fakeFile('copia.json', txt));
  assert.ok(await waitFor(() => nat.db.records.length > 0));
  assert.equal(JSON.stringify(nat.db.records), before);
  assert.ok(nat.db.audit.some((a) => a.action === 'restauración'));
  // una copia manipulada se rechaza sin tocar la base
  const bad = JSON.parse(txt); bad.data.records[0].freqHz = 5;
  find(sec('sec-basedatos'), 'button', 'Restaurar copia').click();
  await answerFilePicker(body, fakeFile('mala.json', JSON.stringify(bad)));
  await tick(50);
  assert.equal(JSON.stringify(nat.db.records), before);
});
