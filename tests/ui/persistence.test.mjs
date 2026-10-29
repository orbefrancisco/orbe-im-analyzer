// Persistencia de la base nacional en IndexedDB (con un IndexedDB en memoria que imita la API):
// se escriben registros con una instancia del almacén y se leen con otra, como al recargar la página.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom-shim.mjs';
import { installFakeIndexedDB } from './fake-idb.mjs';

installDom();
const dbs = installFakeIndexedDB();
const { NationalStore } = await import('../../web/js/ui/natstore.js');
const E = await import('../../web/js/engine/index.js');

test('IndexedDB: un almacén por entidad, escritura y recarga íntegras', async () => {
  const a = new NationalStore();
  await a.init();
  assert.equal(a.backendKind, 'indexeddb');
  assert.equal(a.cartoError, '');
  const stores = [...dbs.get('orbe-im-nacional').stores.keys()].sort();
  assert.deepEqual(stores, [...E.COLLECTIONS, 'meta'].sort());
  // primera apertura: siembra de las 8 estaciones
  assert.equal(dbs.get('orbe-im-nacional').stores.get('stations').size, 8);
  a.mutate((d) => E.addRecords(d, [
    { stationId: '07', freqHz: 88_780_000, status: 'sospechosa_im', levelValue: -88, levelUnit: 'dBm', datetime: '2026-10-29 10:00' },
    { stationId: '02', freqHz: 95_900_000, status: 'portadora_confirmada', emisora: 'Prueba' },
  ]), ['records']);
  a.mutate((d) => E.reassignProvince(d, 'DO-16', 'R06', 'prueba de persistencia'), [], true);
  a.mutate((d) => { d.settings.includeSimulated = true; }, [], true);
  await a.flush();
  assert.equal(a.saveError, '');
  const b = new NationalStore();
  await b.init();
  assert.equal(b.db.records.length, 2);
  assert.equal(b.db.records.find((r) => r.freqHz === 88_780_000).levelValue, -88);
  assert.equal(b.db.provinceRegion['DO-16'], 'R06');
  assert.equal(b.db.assignmentHistory.length, 1);
  assert.equal(b.db.settings.includeSimulated, true);
  assert.equal(b.db.stations.length, 8);
  assert.ok(b.db.audit.length >= 2);
  assert.equal(E.stableStringify(b.db), E.stableStringify(a.db), 'lo recargado es idéntico a lo guardado');
});

test('IndexedDB: restauración completa sustituye todas las colecciones', async () => {
  const a = new NationalStore();
  await a.init();
  const fresh = E.emptyNationalDB();
  E.loadExampleData(fresh);
  await a.replaceAll(fresh);
  const b = new NationalStore();
  await b.init();
  assert.equal(b.db.records.length, 9);
  assert.equal(b.db.provinceRegion['DO-16'], 'R07', 'la asignación vuelve a la de la copia');
  assert.equal(E.dbChecksum(b.db), E.dbChecksum(fresh));
});
