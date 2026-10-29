/** Sección «Panel nacional»: mapa, ficha de estación/provincia/región, resumen y frecuencias bajo investigación. */

import type { Scope } from '../engine/index.js';
import {
  CLASS_LABEL, LOCATION_CONFIDENCE_LABEL, RECORD_STATUS_LABEL, activeRecords, displayCoord, formatKHz, formatMHz, isLocationUncertain, isObservation,
  lastMeasurement, provincesOfRegion, reassignMunicipality, reassignProvince, stationOfObservedKey,
} from '../engine/index.js';
import { h, mount, select, toast } from './dom.js';
import { NationalMap, mapLegend, type MapMode } from './map.js';
import { nat } from './natstore.js';
import { runScope } from './scope.js';
import { classBadge } from './table.js';

type Sel = { kind: 'estacion'; id: string } | { kind: 'provincia'; id: string } | { kind: 'region'; id: string } | null;

export function nationalView(root: HTMLElement, nav: { toStation: (id: string) => void; toInvestigator: (freqHz?: number) => void }): { render: () => void } {
  let mode: MapMode = 'regiones';
  let sel: Sel = null;
  const map = new NationalMap({
    onProvince: (id) => { sel = { kind: 'provincia', id }; render(); },
    onStation: (id) => { sel = { kind: 'estacion', id }; render(); },
  });
  const toolbar = h('div', { class: 'toolbar wrap' });
  const legendBox = h('div');
  const side = h('div', { class: 'side-panel card' });
  const summary = h('div', { class: 'card' });
  const investigating = h('div', { class: 'card' });
  const status = h('div');
  let running = false;

  const stationAnalysis = (id: string) => nat.latest({ kind: 'estacion', stationId: id });

  async function analyzeAllStations(): Promise<void> {
    if (running) return;
    running = true;
    render();
    const fails: string[] = [];
    for (const s of nat.db.stations) {
      const scope: Scope = { kind: 'estacion', stationId: s.id };
      try { await runScope(scope).promise; } catch (e) { fails.push(`${s.name}: ${(e as Error).message}`); }
    }
    running = false;
    render();
    toast(fails.length ? `Análisis por estación completado; ${fails.length} sin generadoras.` : 'Análisis por estación completado.', 'ok');
  }

  function regionValues(): Map<string, number | null> {
    const m = new Map<string, number | null>();
    const recs = activeRecords(nat.db);
    for (const r of nat.db.regions) {
      if (mode === 'datos') m.set(r.id, recs.filter((x) => r.stationIds.includes(x.stationId) && isObservation(x.status)).length);
      else if (mode === 'im') {
        let total: number | null = null;
        for (const sid of r.stationIds) {
          const a = stationAnalysis(sid);
          if (a) total = (total ?? 0) + a.sa.audit.hypotheses.length;
        }
        m.set(r.id, total);
      }
    }
    return m;
  }

  function badges(): Map<string, string> {
    const m = new Map<string, string>();
    const recs = activeRecords(nat.db);
    for (const s of nat.db.stations) {
      const mine = recs.filter((r) => r.stationId === s.id);
      const obs = mine.filter((r) => isObservation(r.status)).length;
      const unid = mine.filter((r) => r.status === 'observada_sin_identificar' || r.status === 'sospechosa_im').length;
      const a = stationAnalysis(s.id);
      m.set(s.id, `${obs} obs. · ${unid} sin id.${a ? ` · ${a.sa.audit.hypotheses.length} IM` : ''}`);
    }
    return m;
  }

  function stationPanel(id: string): HTMLElement[] {
    const db = nat.db;
    const s = db.stations.find((x) => x.id === id)!;
    const region = db.regions.find((r) => r.id === s.regionId);
    const recs = activeRecords(db).filter((r) => r.stationId === id);
    const allRecs = db.records.filter((r) => r.stationId === id);
    const unid = recs.filter((r) => r.status === 'observada_sin_identificar' || r.status === 'sospechosa_im');
    const c = displayCoord(s);
    const a = stationAnalysis(id);
    const l = s.location;
    const sim = allRecs.filter((r) => r.dataKind === 'simulado' && !r.voided).length;
    return [
      h('h3', null, `${s.id} · ${s.operationalName}`),
      h('dl', { class: 'facts' },
        h('dt', null, '1. Nombre y ubicación'),
        h('dd', null, `${s.name} — ${l.site}. `, h('br'),
          c ? `${c.kind === 'aproximada' ? 'Referencia aproximada' : c.kind === 'verificada' ? 'Coordenada verificada' : 'Coordenada histórica'}: ${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}${c.uncertaintyKm ? ` (± ${c.uncertaintyKm} km)` : ''}` : 'Sin coordenada',
          h('br'), h('span', { class: isLocationUncertain(s) ? 'warn' : 'hint' }, LOCATION_CONFIDENCE_LABEL[l.confidence]),
          l.historic && l.confidence !== 'historica_documentada' ? h('div', { class: 'small' }, `Coordenada del documento histórico: ${l.historic.lat}, ${l.historic.lon}. ${l.historic.note}`) : null,
          l.reference ? h('div', { class: 'small' }, l.reference.note) : null,
          h('div', { class: 'small' }, `Torre: municipio ${nat.municipalityName(l.municipalityId)}, provincia ${nat.provinceName(l.provinceId)}. ${l.locationBasis}`)),
        h('dt', null, '2. Región de vigilancia'), h('dd', null, region ? region.name : '—'),
        h('dt', null, '3. Provincias asignadas'), h('dd', null, region ? provincesOfRegion(db, region.id).map((p) => nat.provinceName(p)).join(', ') : '—'),
        h('dt', null, '4. Frecuencias registradas'), h('dd', null, `${recs.length} registros activos (${[...new Set(recs.map((r) => r.freqHz))].length} frecuencias distintas)`,
          h('div', { class: 'small' }, (Object.keys(RECORD_STATUS_LABEL) as (keyof typeof RECORD_STATUS_LABEL)[]).map((k) => `${RECORD_STATUS_LABEL[k].split(' (')[0]}: ${recs.filter((r) => r.status === k).length}`).join(' · '))),
        h('dt', null, '5. Señales sin identificar'), h('dd', null, unid.length ? unid.slice(0, 12).map((r) => `${formatMHz(r.freqHz, 3)}${r.status === 'sospechosa_im' ? ' (sospechosa IM)' : ''}`).join(', ') + (unid.length > 12 ? '…' : '') : 'Ninguna registrada'),
        h('dt', null, '6. Posibles productos de intermodulación'), h('dd', null,
          a ? h('div', null,
            a.stale ? h('div', { class: 'warn' }, 'Análisis desactualizado: los datos cambiaron.') : null,
            a.sa.run.meta.complete ? null : h('div', { class: 'error' }, 'Análisis INCOMPLETO — no exhaustivo.'),
            a.sa.audit.hypotheses.length ? h('ul', { class: 'small' }, ...a.sa.audit.hypotheses.slice(0, 8).map((x) => h('li', null, `${formatMHz(x.observedHz, 3)} ↔ ${formatMHz(x.calcHz, 3)} (Δ ${formatKHz(x.diffHz)} kHz) `, classBadge(x.classification.cls)))) : 'Ninguna coincidencia con señales observadas.',
          ) : h('button', { type: 'button', onclick: async () => { try { await runScope({ kind: 'estacion', stationId: id }).promise; } catch (e) { toast((e as Error).message, 'error'); } } }, 'Calcular productos de esta estación')),
        h('dt', null, '7. Última medición'), h('dd', null, lastMeasurement(db, id) || 'Sin mediciones con fecha'),
        h('dt', null, '8. Estado de validación'), h('dd', null,
          `Ubicación: ${LOCATION_CONFIDENCE_LABEL[l.confidence]}. `,
          `Portadoras confirmadas: ${recs.filter((r) => r.status === 'portadora_confirmada').length}; pendientes de verificación: ${recs.filter((r) => r.status === 'reportada_pendiente').length}. `,
          sim ? h('span', { class: 'warn' }, `${sim} registros SIMULADOS (ejemplo). `) : null,
          `Fuentes: ${s.sources.length}.`),
      ),
      h('div', { class: 'toolbar wrap' },
        h('button', { type: 'button', class: 'primary', onclick: () => nav.toStation(id) }, 'Abrir estación (inventario y análisis)'),
        h('button', { type: 'button', onclick: () => map.focusStation(s) }, 'Centrar en el mapa'),
      ),
    ];
  }

  function provincePanel(id: string): (HTMLElement | null)[] {
    const db = nat.db;
    const c = nat.carto;
    const reg = db.provinceRegion[id];
    const munis = c ? c.municipios.filter((m) => m.provincia === id) : [];
    const here = db.stations.filter((s) => s.location.provinceId === id);
    const recsHere = activeRecords(db).filter((r) => r.municipalityId && munis.some((m) => m.id === r.municipalityId));
    return [
      h('h3', null, `${nat.provinceName(id)} (${id})`),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Región de vigilancia'),
        select(db.regions.map((r) => ({ value: r.id, label: r.name })), reg, (v) => {
          const reason = prompt('Motivo de la reasignación (queda en el historial):', '') ?? '';
          const e = nat.mutate((d) => reassignProvince(d, id, v, reason || 'sin motivo'), [], true);
          if (e.length) toast(e[0], 'error'); else toast('Provincia reasignada. Los registros históricos no cambian.', 'ok');
        }, { 'aria-label': 'Región de la provincia' })),
      h('p', { class: 'small' }, here.length ? `Torres situadas en esta provincia: ${here.map((s) => s.operationalName).join(', ')}.` : 'Ninguna torre de monitoreo situada en esta provincia.'),
      h('p', { class: 'small' }, `Registros con municipio de esta provincia: ${recsHere.length}.`),
      munis.length ? h('details', null, h('summary', null, `Municipios (${munis.length}) — excepciones de región`),
        h('table', { class: 'data compact' }, h('tbody', null, ...munis.map((m) => h('tr', null, h('td', null, m.nombre),
          h('td', null, select([{ value: '', label: 'Hereda de la provincia' }, ...db.regions.map((r) => ({ value: r.id, label: r.name }))], db.municipalityRegion[m.id] ?? '', (v) => {
            const reason = prompt('Motivo:', '') ?? '';
            const e = nat.mutate((d) => reassignMunicipality(d, m.id, v || null, reason || 'sin motivo'), [], true);
            if (e.length) toast(e[0], 'error');
          }, { 'aria-label': `Región de ${m.nombre}` }))))))) : null,
      h('p', { class: 'hint' }, 'Las regiones son administrativas y configurables; no describen cobertura radioeléctrica.'),
    ];
  }

  function regionPanel(id: string): HTMLElement[] {
    const db = nat.db;
    const r = db.regions.find((x) => x.id === id)!;
    const recs = activeRecords(db).filter((x) => r.stationIds.includes(x.stationId));
    return [
      h('h3', null, `Región ${r.name}`),
      h('p', null, `Estaciones: ${r.stationIds.map((s) => nat.stationName(s)).join(', ') || 'ninguna'}.`),
      h('p', null, `Provincias: ${provincesOfRegion(db, id).map((p) => nat.provinceName(p)).join(', ')}.`),
      h('p', null, `Registros activos: ${recs.length}.`),
      h('p', { class: 'hint' }, r.description),
    ];
  }

  function renderSide(): void {
    if (!sel) { mount(side, h('h3', null, 'Seleccione una estación o una provincia'), h('p', { class: 'hint' }, 'Toque una estación (círculo) o una provincia del mapa. Use el selector de región para resaltar una región completa.')); return; }
    mount(side, ...(sel.kind === 'estacion' ? stationPanel(sel.id) : sel.kind === 'provincia' ? provincePanel(sel.id) : regionPanel(sel.id)));
  }

  function renderSummary(): void {
    const db = nat.db;
    const recs = activeRecords(db);
    mount(summary, h('h3', null, 'Resumen nacional'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, ...['Estación', 'Región', 'Ubicación', 'Registros', 'Confirmadas', 'Sin identificar', 'Sospechosas IM', 'Asignadas', 'Última medición', 'Coincidencias IM'].map((t) => h('th', null, t)))),
        h('tbody', null, ...db.stations.map((s) => {
          const mine = recs.filter((r) => r.stationId === s.id);
          const a = stationAnalysis(s.id);
          return h('tr', { tabindex: '0', class: sel?.kind === 'estacion' && sel.id === s.id ? 'sel' : '', onclick: () => { sel = { kind: 'estacion', id: s.id }; render(); } },
            h('td', null, `${s.id} ${s.operationalName}`), h('td', null, db.regions.find((r) => r.id === s.regionId)?.name ?? '—'),
            h('td', null, h('span', { class: isLocationUncertain(s) ? 'badge warnb' : 'badge none' }, isLocationUncertain(s) ? 'sin confirmar' : 'histórica')),
            h('td', { class: 'num' }, String(mine.length)),
            h('td', { class: 'num' }, String(mine.filter((r) => r.status === 'portadora_confirmada').length)),
            h('td', { class: 'num' }, String(mine.filter((r) => r.status === 'observada_sin_identificar').length)),
            h('td', { class: 'num' }, String(mine.filter((r) => r.status === 'sospechosa_im').length)),
            h('td', { class: 'num' }, String(mine.filter((r) => r.status === 'asignada_oficialmente').length)),
            h('td', null, lastMeasurement(db, s.id) || '—'),
            h('td', { class: 'num' }, a ? `${a.sa.audit.hypotheses.length}${a.stale ? ' (desact.)' : ''}` : '—'),
          );
        })))),
      db.settings.includeSimulated ? h('p', { class: 'warn' }, 'Se están incluyendo datos SIMULADOS en los recuentos y análisis.') : h('p', { class: 'hint' }, `${db.records.filter((r) => r.dataKind === 'simulado').length} registros simulados excluidos (actívelos en «Base de datos»).`),
    );
  }

  function renderInvestigating(): void {
    const db = nat.db;
    const recs = activeRecords(db).filter((r) => r.status === 'sospechosa_im' || r.status === 'reportada_pendiente');
    const hyps: { st: string; obs: number; calc: number; cls: string }[] = [];
    for (const s of db.stations) {
      const a = stationAnalysis(s.id);
      if (a) for (const x of a.sa.audit.hypotheses) hyps.push({ st: stationOfObservedKey(x.observedId) ?? s.id, obs: x.observedHz, calc: x.calcHz, cls: x.classification.cls });
    }
    mount(investigating, h('h3', null, 'Frecuencias bajo investigación'),
      recs.length || hyps.length ? h('table', { class: 'data compact' },
        h('thead', null, h('tr', null, ...['Frecuencia (MHz)', 'Estación', 'Motivo', ''].map((t) => h('th', null, t)))),
        h('tbody', null,
          ...recs.map((r) => h('tr', null, h('td', { class: 'num' }, formatMHz(r.freqHz, 3)), h('td', null, nat.stationName(r.stationId)), h('td', null, RECORD_STATUS_LABEL[r.status]), h('td', null, h('button', { type: 'button', onclick: () => nav.toInvestigator(r.freqHz) }, 'Investigar')))),
          ...hyps.map((x) => h('tr', null, h('td', { class: 'num' }, formatMHz(x.obs, 3)), h('td', null, nat.stationName(x.st)), h('td', null, `coincide con el producto ${formatMHz(x.calc, 3)} MHz — clase ${x.cls} · ${CLASS_LABEL[x.cls as 'A']}`), h('td', null, h('button', { type: 'button', onclick: () => nav.toInvestigator(x.obs) }, 'Investigar')))),
        )) : h('p', { class: 'hint' }, 'No hay frecuencias sospechosas ni coincidencias calculadas. Registre frecuencias en las estaciones y pulse «Calcular análisis por estación».'));
  }

  function render(): void {
    if (!nat.ready) { mount(root, h('p', { class: 'hint' }, 'Cargando la base nacional…')); return; }
    if (!root.contains(map.root)) {
      mount(root,
        h('div', { class: 'section-intro' }, h('h2', null, 'Panel nacional'), h('p', null, 'Mapa de República Dominicana con las 32 divisiones territoriales, las ocho estaciones fijas de monitoreo y las ocho regiones operativas. Ninguna cobertura radioeléctrica se dibuja: las regiones son administrativas.')),
        status, toolbar,
        h('div', { class: 'map-layout' }, h('div', { class: 'card map-card' }, map.root, legendBox), side),
        summary, investigating,
      );
    }
    const db = nat.db;
    mount(status,
      nat.cartoError ? h('div', { class: 'banner bad' }, `No se pudo cargar la cartografía: ${nat.cartoError}`) : null,
      nat.backendKind === 'memoria' ? h('div', { class: 'banner warn' }, 'Este navegador no ofrece IndexedDB: los datos nacionales solo viven en memoria. Exporte una copia de seguridad antes de cerrar.') : null,
      nat.saveError ? h('div', { class: 'banner bad' }, nat.saveError) : null,
    );
    mount(toolbar,
      h('label', { class: 'field inline-field' }, h('span', { class: 'field-label' }, 'Vista del mapa'),
        select([{ value: 'regiones', label: 'Regiones de vigilancia' }, { value: 'datos', label: 'Señales registradas por región' }, { value: 'im', label: 'Coincidencias con productos IM' }], mode, (v) => { mode = v as MapMode; render(); }, { 'aria-label': 'Vista del mapa' })),
      h('label', { class: 'field inline-field' }, h('span', { class: 'field-label' }, 'Resaltar región'),
        select([{ value: '', label: '— ninguna —' }, ...db.regions.map((r) => ({ value: r.id, label: r.name }))], sel?.kind === 'region' ? sel.id : '', (v) => { sel = v ? { kind: 'region', id: v } : null; render(); }, { 'aria-label': 'Resaltar región' })),
      h('button', { type: 'button', disabled: running, onclick: () => analyzeAllStations() }, running ? 'Calculando…' : 'Calcular análisis por estación'),
    );
    if (nat.carto) {
      const md = { db, carto: nat.carto, mode, selectedProvince: sel?.kind === 'provincia' ? sel.id : null, selectedStation: sel?.kind === 'estacion' ? sel.id : null, selectedRegion: sel?.kind === 'region' ? sel.id : null, regionValue: regionValues(), stationBadge: badges() };
      map.setData(md);
      mount(legendBox, mapLegend(md), h('p', { class: 'hint small' }, `${nat.carto.atribucion} ${nat.carto.advertencia}`));
    }
    renderSide();
    renderSummary();
    renderInvestigating();
  }

  return { render };
}
