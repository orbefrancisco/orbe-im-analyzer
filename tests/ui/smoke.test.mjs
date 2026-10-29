// Prueba de humo de la interfaz compilada (web/js) sobre un DOM mínimo en Node.
// Recorre las cuatro secciones con el caso obligatorio y verifica textos, flujos y exportaciones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, find, findAll, tick, SECTION_IDS } from './dom-shim.mjs';

const { document, body, downloads, FakeElement } = installDom();
location.hash = '#calculadora'; // desde la v2 la pestaña inicial es el Panel nacional
for (const id of SECTION_IDS) {
  const el = new FakeElement(id === 'tabs' ? 'nav' : 'section');
  el.setAttribute('id', id);
  body.appendChild(el);
}
const sec = (id) => document.getElementById(id);
const setInput = (el, v) => { el.value = v; el.dispatch('change'); el.dispatch('input'); };
const byLabel = (root, label) => root.querySelectorAll('input').concat(root.querySelectorAll('select'), root.querySelectorAll('textarea')).find((e) => e.getAttribute('aria-label') === label);

await import('../../web/js/ui/main.js');
await tick(30);

test('Calculadora: caso 89.30 / 89.58 MHz con observadas 89.85 y 88.74', async () => {
  const c = sec('sec-calculadora');
  assert.equal(c.hidden, false);
  const txt = c.textContent;
  for (const s of ['89.02', '89.86', '88.74', '90.14', '88.46', '90.42', '88.18', '90.70']) assert.ok(txt.includes(s), `falta ${s}`);
  assert.ok(txt.includes('EXHAUSTIVO dentro de los límites'));
  assert.ok(txt.includes('3(89.30) − 2(89.58)'), 'fórmula IM5');
  // fila de 89.860 con la observada 89.850 y Δ −10 kHz
  const row = findAll(c, 'tr', '89.860').find((r) => r.textContent.includes('89.850'));
  assert.ok(row, 'la observada 89.850 se vincula a 89.860');
  assert.ok(row.textContent.includes('-10.000'));
  const row8874 = findAll(c, 'tr', '88.740').find((r) => r.textContent.includes('IM5'));
  assert.ok(row8874.textContent.includes('0.000'), '88.74 con diferencia cero');
  // tolerancia 5 kHz: 89.85 deja de coincidir
  const tolSel = byLabel(c, 'Tolerancia de coincidencia');
  setInput(tolSel, '5');
  await tick();
  const row2 = findAll(c, 'tr', '89.860').find((r) => r.textContent.includes('89.850'));
  assert.equal(row2, undefined, 'a ±5 kHz no hay coincidencia');
  setInput(tolSel, '10');
});

test('Calculadora: tres frecuencias, f1 + f2 − f3 = 88.78 MHz', async () => {
  const c = sec('sec-calculadora');
  const ta = byLabel(c, 'Frecuencias transmisoras');
  ta.value = '89.30\n89.58\n90.10';
  find(c, 'button', 'Calcular').click();
  await tick(10);
  const row = findAll(c, 'tr', '88.780');
  assert.ok(row.length > 0);
  assert.ok(c.textContent.includes('89.30 + 89.58 − 90.10'));
  // detalle: todas las combinaciones de una frecuencia
  row[0].click();
  assert.ok(c.textContent.includes('capaz'), 'panel de detalle');
});

test('Espectro: dibujo, rueda, selección por clic y tooltip sin errores', async () => {
  const c = sec('sec-calculadora');
  const canvas = c.querySelectorAll('canvas')[0];
  assert.ok(canvas, 'hay lienzo');
  const ctx = canvas.getContext('2d');
  const before = ctx.calls.count;
  find(c, 'button', 'Banda').click();
  assert.ok(ctx.calls.count > before, 'se dibuja');
  // 88.78 MHz en el carril IM3 (primer carril): x según la vista 87.6–108.4 MHz y ancho útil 900−64−12
  const x = 64 + ((88_780_000 - 87_600_000) / (108_400_000 - 87_600_000)) * (900 - 64 - 12);
  const yLane = 230 + 8 + 9;
  canvas.dispatch('pointermove', { offsetX: x, offsetY: yLane, _noBubble: true });
  canvas.dispatch('wheel', { offsetX: x, offsetY: 50, deltaY: -100, _noBubble: true });
  canvas.dispatch('wheel', { offsetX: x, offsetY: 50, deltaY: 100, _noBubble: true });
  find(c, 'button', 'Banda').click();
  canvas.dispatch('pointerdown', { offsetX: x, offsetY: yLane, pointerId: 1, _noBubble: true });
  canvas.dispatch('pointerup', { offsetX: x, offsetY: yLane, pointerId: 1, _noBubble: true });
  assert.ok(c.textContent.includes('88.780 MHz —'), 'el clic en el marcador abre el detalle de 88.78');
  // arrastre (desplazamiento) y tooltip sobre una señal observada
  canvas.dispatch('pointerdown', { offsetX: 300, offsetY: 100, pointerId: 1, _noBubble: true });
  canvas.dispatch('pointermove', { offsetX: 340, offsetY: 100, _noBubble: true });
  canvas.dispatch('pointerup', { offsetX: 340, offsetY: 100, pointerId: 1, _noBubble: true });
  const tip = c.querySelectorAll('div').find((d) => d.className === 'spectrum-tip');
  assert.ok(tip);
});

test('Analizador: ejemplo, estimación y cálculo exhaustivo', async () => {
  find(sec('project-bar'), 'button', 'Cargar ejemplo').click();
  await tick();
  const a = sec('sec-analizador');
  assert.equal(a.hidden, false);
  assert.ok(a.textContent.includes('Espacio de búsqueda'));
  assert.ok(a.textContent.includes('5 de 5 frecuencias incluidas'));
  find(a, 'button', 'Calcular todas las combinaciones').click();
  await tick(80);
  assert.ok(a.textContent.includes('EXHAUSTIVO dentro de los límites'), a.textContent.slice(0, 400));
  assert.ok(findAll(a, 'tr', '88.780').length > 0);
  // filtro por orden
  const chip5 = findAll(a, 'button').find((b) => b.className.includes('chip') && b.textContent === '5');
  chip5.click();
  const rows = findAll(a, 'tbody').flatMap((tb) => tb.children).filter((r) => r.textContent.includes('IM'));
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => !/IM3\b|IM7\b|IM9\b/.test(r.children[1]?.textContent ?? '')), 'solo IM5 tras filtrar');
});

test('Auditoría: clases, probabilidad fortuita, hipótesis y exportaciones', async () => {
  find(sec('tabs'), 'button', 'Auditoría espectral').click();
  await tick();
  const s = sec('sec-auditoria');
  assert.equal(s.hidden, false);
  const t = s.textContent;
  assert.ok(t.includes('Probabilidad de coincidencia fortuita'));
  assert.ok(t.includes('B · Coincidencia observada'));
  const obsRow = findAll(s, 'tr', '89.850').find((r) => r.getAttribute('tabindex') === '0');
  obsRow.click();
  assert.ok(s.textContent.includes('2(89.58) − 89.30'), 'hipótesis IM3 para 89.85');
  // 88.78 (declarada «sospechosa»): única hipótesis f1 + f2 − f3 a ±10 kHz (comprobado con el motor);
  // su clasificación declarada no cambia.
  const r8878 = findAll(s, 'tr', '88.780').find((r) => r.getAttribute('tabindex') === '0');
  assert.equal(r8878.children[5].textContent, '1');
  assert.ok(r8878.children[3].textContent.includes('sospechosa'));
  const n0 = downloads.length;
  find(s, 'button', 'CSV · coincidencias observadas').click();
  find(s, 'button', 'Excel (hojas separadas)').click();
  find(s, 'button', 'JSON trazable').click();
  find(s, 'button', 'Informe de auditoría').click();
  assert.equal(downloads.length, n0 + 4);
  const csv = await downloads[n0].text();
  assert.ok(csv.includes('89.850') && csv.includes('89.860') && csv.includes('-10.000'));
  const json = JSON.parse(await downloads[n0 + 2].text());
  assert.equal(json.schema, 'orbe-im-analyzer/analisis@1');
  const rep = await downloads[n0 + 3].text();
  assert.match(rep, /Limitaciones matemáticas y experimentales/);
  const xlsx = new Uint8Array(await downloads[n0 + 1].arrayBuffer());
  assert.equal(xlsx[0], 0x50); assert.equal(xlsx[1], 0x4b);
});

test('Laboratorio: prueba de atenuación vinculada a la hipótesis IM3 y registro como evidencia → clase C', async () => {
  const s = sec('sec-auditoria');
  const obsRow = findAll(s, 'tr', '89.850').find((r) => r.getAttribute('tabindex') === '0');
  if (!s.textContent.includes('Prueba de atenuación…')) obsRow.click();
  const hyp = findAll(s, 'div').filter((d) => d.className === 'hyp').find((d) => d.textContent.includes('IM3'));
  find(hyp, 'button', 'Prueba de atenuación').click();
  await tick();
  const l = sec('sec-laboratorio');
  assert.equal(l.hidden, false);
  setInput(byLabel(l, 'Nivel original'), '-78');
  setInput(byLabel(l, 'Nivel con atenuador'), '-108');
  setInput(byLabel(l, 'Atenuación'), '10');
  // niveles de generadores después (antes vienen del proyecto: −28 y −31)
  const afters = l.querySelectorAll('input').filter((i) => i.getAttribute('aria-label') === 'Después (dBm)');
  assert.equal(afters.length, 2);
  setInput(afters[0], '-38');
  setInput(afters[1], '-41');
  find(l, 'button', 'Analizar').click();
  assert.ok(l.textContent.includes('Mecanismos posibles'));
  assert.ok(l.textContent.includes('3.00 dB/dB'));
  find(l, 'button', 'Guardar y registrar como evidencia').click();
  await tick();
  find(sec('tabs'), 'button', 'Auditoría espectral').click();
  await tick();
  assert.ok(sec('sec-auditoria').textContent.includes('C · Candidato experimental'));
});

test('Proyecto: guardado local y método', async () => {
  find(sec('project-bar'), 'button', 'Guardar').click();
  assert.ok(localStorage.getItem('orbe-im/indice').includes('Ejemplo FM'));
  find(sec('tabs'), 'button', 'Método y limitaciones').click();
  assert.equal(sec('sec-metodo').hidden, false);
});
