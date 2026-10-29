/** Sección «Base de datos»: estado, copia de seguridad y restauración, datos de ejemplo, ajustes y registro de auditoría. */

import { COLLECTIONS, dbChecksum, exportBackup, loadExampleData, parseBackup, voidRecord, emptyNationalDB } from '../engine/index.js';
import { download, h, mount, pickFile, stamp, toast } from './dom.js';
import { nat } from './natstore.js';

const LABEL: Record<string, string> = {
  stations: 'Estaciones', regions: 'Regiones', transmitters: 'Transmisores identificados', records: 'Registros de frecuencia', sweeps: 'Barridos espectrales',
  analyses: 'Análisis guardados (productos IM e hipótesis)', evidence: 'Evidencias', confirmations: 'Confirmaciones', labTests: 'Pruebas de laboratorio', sources: 'Fuentes documentales', audit: 'Auditoría',
};

export function databaseView(root: HTMLElement): { render: () => void } {
  let auditFilter = '';
  function render(): void {
    if (!nat.ready) { mount(root, h('p', { class: 'hint' }, 'Cargando la base nacional…')); return; }
    const db = nat.db;
    const sim = db.records.filter((r) => r.dataKind === 'simulado' && !r.voided).length;
    const audits = [...db.audit].reverse().filter((a) => !auditFilter || `${a.action} ${a.entity} ${a.entityId} ${a.detail}`.toLowerCase().includes(auditFilter.toLowerCase())).slice(0, 300);
    mount(root,
      h('div', { class: 'section-intro' }, h('h2', null, 'Base de datos y trazabilidad'), h('p', null, 'Todo se guarda en este navegador (IndexedDB), sin servidores. Exporte copias de seguridad con regularidad.')),
      h('div', { class: 'card' }, h('h3', null, 'Estado'),
        h('p', null, `Almacenamiento: ${nat.backendKind === 'indexeddb' ? 'IndexedDB (persistente)' : 'memoria (NO persistente)'}. Creada: ${db.createdAt}. Huella SHA-256 actual: `, h('code', null, dbChecksum(db).slice(0, 16) + '…')),
        nat.saveError ? h('p', { class: 'error' }, nat.saveError) : null,
        h('table', { class: 'data compact' }, h('tbody', null, ...COLLECTIONS.map((c) => h('tr', null, h('td', null, LABEL[c]), h('td', { class: 'num' }, String((db[c] as unknown[]).length)))),
          h('tr', null, h('td', null, 'Asignaciones territoriales (provincias / excepciones municipales / cambios)'), h('td', { class: 'num' }, `${Object.keys(db.provinceRegion).length} / ${Object.keys(db.municipalityRegion).length} / ${db.assignmentHistory.length}`)))),
      ),
      h('div', { class: 'card' }, h('h3', null, 'Copia de seguridad'),
        h('div', { class: 'toolbar wrap' },
          h('button', { type: 'button', class: 'primary', onclick: () => download(`orbe-im-copia-${stamp()}.json`, exportBackup(db), 'application/json') }, 'Exportar copia completa'),
          h('button', { type: 'button', onclick: async () => {
            const f = await pickFile('.json');
            if (!f) return;
            const r = parseBackup(await f.text());
            if (!r.db) { toast('Copia rechazada: ' + r.errors.slice(0, 3).join(' '), 'error'); return; }
            if (!confirm(`¿Restaurar la copia «${f.name}»? Sustituye TODA la base actual (${db.records.length} registros) por la de la copia (${r.db.records.length} registros). Exporte antes una copia de la base actual si la necesita.`)) return;
            r.db.audit.push({ id: `a${Date.now().toString(36)}`, ts: new Date().toISOString(), action: 'restauración', entity: 'base', entityId: f.name, detail: `copia verificada (SHA-256 correcta)` });
            await nat.replaceAll(r.db);
            toast('Base restaurada y verificada.', 'ok');
          } }, 'Restaurar copia…'),
        ),
        h('p', { class: 'hint' }, 'La copia incluye estaciones, regiones, asignaciones, transmisores, registros (con su historial y anulaciones), barridos, análisis, evidencias, pruebas, fuentes y auditoría, con una suma SHA-256 que se comprueba al restaurar. Una copia dañada o modificada se rechaza entera.'),
      ),
      h('div', { class: 'card' }, h('h3', null, 'Ajustes de análisis y datos de ejemplo'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: db.settings.includeSimulated, onchange: (e: Event) => nat.mutate((d) => { d.settings.includeSimulated = (e.target as HTMLInputElement).checked; }, [], true) }), 'Incluir datos simulados en recuentos y análisis'),
        h('p', { class: sim ? 'warn' : 'hint' }, `${sim} registros simulados activos. Los datos simulados nunca se mezclan con los reales sin aviso.`),
        h('div', { class: 'toolbar wrap' },
          h('button', { type: 'button', onclick: () => {
            if (!confirm('¿Cargar los datos de ejemplo? Son valores matemáticos SIMULADOS (Barahona 89.30, 89.58, 90.10 y 88.78 MHz, entre otros); no son mediciones reales.')) return;
            const rep = nat.mutate((d) => { const r = loadExampleData(d); d.settings.includeSimulated = true; return r; }, ['records', 'sources'], true);
            toast(`Ejemplo cargado: ${rep.added.length} registros simulados (${rep.duplicates.length} ya existían).`, 'ok');
          } }, 'Cargar datos de ejemplo (simulados)'),
          sim ? h('button', { type: 'button', class: 'danger', onclick: () => {
            if (!confirm(`¿Anular los ${sim} registros simulados? Se conservan en la base como anulados.`)) return;
            nat.mutate((d) => { for (const r of d.records) if (r.dataKind === 'simulado' && !r.voided) voidRecord(d, r.id, 'retirada de datos de ejemplo'); }, ['records']);
          } }, 'Anular datos simulados') : null,
          h('button', { type: 'button', class: 'danger', onclick: async () => {
            if (!confirm('¿Reiniciar la base nacional? Se borran TODOS los datos locales y se recrean las ocho estaciones. Exporte antes una copia.')) return;
            if (!confirm('Confirme de nuevo: esta acción no se puede deshacer sin una copia de seguridad.')) return;
            await nat.replaceAll(emptyNationalDB());
            toast('Base reiniciada.', 'ok');
          } }, 'Reiniciar base'),
        ),
      ),
      h('div', { class: 'card' }, h('h3', null, `Fuentes documentales (${db.sources.length})`),
        db.sources.length ? h('table', { class: 'data compact' }, h('thead', null, h('tr', null, ...['Nombre', 'Tipo', 'SHA-256', 'Bytes', 'Fecha', 'Notas'].map((t) => h('th', null, t)))),
          h('tbody', null, ...db.sources.map((s) => h('tr', null, h('td', null, s.name), h('td', null, s.kind), h('td', { class: 'small' }, s.sha256 ? s.sha256.slice(0, 16) + '…' : '—'), h('td', { class: 'num' }, String(s.bytes)), h('td', null, s.importedAt.slice(0, 16)), h('td', { class: 'small' }, s.notes))))) : h('p', { class: 'empty' }, 'Sin fuentes registradas.'),
        nat.carto ? h('p', { class: 'small' }, 'Cartografía: ', nat.carto.fuentes.map((f) => `${f.nivel}: ${f.fuenteOriginal}, ${f.licencia}, SHA-256 ${f.sha256.slice(0, 12)}…`).join(' · ')) : null,
      ),
      h('div', { class: 'card' }, h('h3', null, 'Historial de modificaciones'),
        h('input', { type: 'search', placeholder: 'Filtrar', value: auditFilter, 'aria-label': 'Filtrar auditoría', onchange: (e: Event) => { auditFilter = (e.target as HTMLInputElement).value; render(); } }),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' }, h('thead', null, h('tr', null, ...['Fecha', 'Acción', 'Entidad', 'Id', 'Detalle'].map((t) => h('th', null, t)))),
          h('tbody', null, ...audits.map((a) => h('tr', null, h('td', null, a.ts.replace('T', ' ').slice(0, 19)), h('td', null, a.action), h('td', null, a.entity), h('td', { class: 'small' }, a.entityId), h('td', { class: 'small' }, a.detail)))))),
        db.assignmentHistory.length ? h('details', null, h('summary', null, `Reasignaciones territoriales (${db.assignmentHistory.length})`), h('ul', { class: 'small' }, ...db.assignmentHistory.map((x) => h('li', null, `${x.ts.slice(0, 16)} · ${x.level} ${x.level === 'provincia' ? nat.provinceName(x.unitId) : nat.municipalityName(x.unitId)}: ${x.from ?? '—'} → ${x.to ?? 'hereda'} (${x.reason})`)))) : null,
      ),
    );
  }
  return { render };
}
