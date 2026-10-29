/** Sección «Investigador IM»: investigar una frecuencia y análisis por estación, región, nacional o comparativo. */
import { CLASS_LABEL, MECHANISM_HINT_LABEL, RECORD_STATUS_LABEL, buildScopeInputs, compareStations, estimateSearchSpace, findingsReport, formatBig, formatHz, formatKHz, formatMHz, formulaNumeric, investigationFromRun, investigationParams, orderLabel, parseFrequency, scopeLabel, snapshotOf, stationOfObservedKey, } from '../engine/index.js';
import { computeAsync } from './compute.js';
import { download, field, h, mount, stamp, toast } from './dom.js';
import { nat } from './natstore.js';
import { ResultsPanel } from './panel.js';
import { orderControl, toleranceControl } from './params.js';
import { openInClassic, runScope, scopeOptionsControls, scopeSelect } from './scope.js';
import { classBadge } from './table.js';
export function investigatorView(root, nav) {
    let mode = 'frecuencia';
    let freqText = '88.78';
    let tolHz = 10000;
    let invScope = { kind: 'nacional' };
    let anaScope = { kind: 'nacional' };
    let opts = {};
    let maxOrder = nat.db.settings.params.maxOrder;
    let maxTones = nat.db.settings.params.maxTones;
    let result = null;
    let busy = '';
    let compareIds = new Set(['01', '07']);
    let onlyCoexist = false;
    const body = h('div');
    const panel = new ResultsPanel({
        getRun: () => nat.latest(anaScope)?.sa.run ?? null,
        getAudit: () => nat.latest(anaScope)?.sa.audit ?? null,
        getProject: () => null,
        getObserved: () => nat.latest(anaScope)?.sa.inputs.observed ?? [],
        getTransmitters: () => nat.latest(anaScope)?.sa.inputs.generators ?? [],
        getTrace: () => null,
        toleranceHz: () => nat.db.settings.params.toleranceHz,
        filePrefix: 'orbe-im-ambito',
        isStale: () => !!nat.latest(anaScope)?.stale,
    });
    async function investigate() {
        const f = parseFrequency(freqText);
        if (!f.ok) {
            toast(f.error ?? 'Frecuencia no válida', 'error');
            return;
        }
        const inputs = buildScopeInputs(nat.db, invScope, opts);
        if (!inputs.generators.length) {
            toast('No hay generadoras en el ámbito: registre portadoras confirmadas o active otras opciones.', 'error');
            return;
        }
        const params = investigationParams({ ...nat.db.settings.params, maxOrder, maxTones }, f.hz, tolHz);
        busy = 'Buscando combinaciones…';
        render();
        try {
            const run = await computeAsync(inputs.generators, params, (p) => { busy = `Nodos recorridos: ${formatBig(BigInt(p.visited))}`; }).promise;
            result = investigationFromRun(nat.db, inputs, run, f.hz, tolHz);
        }
        catch (e) {
            toast(e.message, 'error');
        }
        busy = '';
        render();
    }
    function renderInvestigation() {
        const inputs = buildScopeInputs(nat.db, invScope, opts);
        const est = estimateSearchSpace({ nGenerators: inputs.generators.length, maxOrder, maxTones, includeHarmonics: true });
        const fi = h('input', { type: 'text', inputmode: 'decimal', value: freqText, class: 'mid', 'aria-label': 'Frecuencia a investigar (MHz)', onchange: (e) => { freqText = e.target.value; } });
        fi.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
            freqText = fi.value;
            investigate();
        } });
        const r = result;
        return h('div', null, h('div', { class: 'card' }, h('h3', null, 'INVESTIGAR FRECUENCIA'), h('div', { class: 'grid' }, field('Frecuencia (MHz)', fi), field('Tolerancia', toleranceControl(tolHz, (hz) => { tolHz = hz; })), scopeSelect(invScope, (s) => { invScope = s; render(); }, 'Generadoras de'), field('Orden máximo', orderControl(maxOrder, (n) => { maxOrder = n; render(); })), field('Máx. generadoras por combinación', h('input', { type: 'number', min: '1', max: '8', value: String(maxTones), class: 'narrow', onchange: (e) => { const n = parseInt(e.target.value, 10); if (n >= 1) {
                maxTones = n;
                render();
            } } }))), scopeOptionsControls(opts, (o) => { opts = o; render(); }), h('p', { class: 'hint' }, `${inputs.generators.length} generadoras en «${inputs.label}». Cota de búsqueda: ${formatBig(est.workBound)} nodos (la salida se restringe a f ± tolerancia).`), h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'primary', disabled: !!busy, onclick: () => { freqText = fi.value; investigate(); } }, busy || 'Investigar'))), r ? h('div', null, h('div', { class: 'banner ' + (r.complete ? 'ok' : 'bad') }, (r.complete ? '✔ ' : '✖ ') + r.statement), ...r.notes.map((n) => h('div', { class: 'banner warn' }, n)), h('div', { class: 'card' }, h('h3', null, `1. ¿Se observó ${formatMHz(r.freqHz, 3)} MHz?`), r.observations.length ? h('table', { class: 'data compact' }, h('thead', null, h('tr', null, ...['Estación', 'Frecuencia (MHz)', 'Δ (Hz)', 'Δ (kHz)', 'Estado', 'Fecha', 'Nivel', 'Dato'].map((t) => h('th', null, t)))), h('tbody', null, ...r.observations.map((o) => h('tr', null, h('td', null, o.stationName), h('td', { class: 'num' }, formatMHz(o.record.freqHz, 3)), h('td', { class: 'num' }, formatHz(o.diffHz)), h('td', { class: 'num' }, formatKHz(o.diffHz)), h('td', null, RECORD_STATUS_LABEL[o.record.status]), h('td', null, o.record.datetime || '—'), h('td', { class: 'num' }, o.record.levelValue !== null ? `${o.record.levelValue} ${o.record.levelUnit}` : '—'), h('td', null, o.record.dataKind))))) : h('p', null, 'No hay registros de esta frecuencia (± tolerancia) en ninguna estación.')), h('div', { class: 'card' }, h('h3', null, `2–7. Combinaciones generadoras (${r.hypotheses.length})`), !r.hypotheses.length ? h('p', null, 'Ninguna combinación del alcance configurado produce esta frecuencia. No descarta órdenes superiores, otros generadores ni otros mecanismos.') : null, ...r.hypotheses.slice(0, 60).map((x) => h('div', { class: 'hyp' }, h('div', { class: 'hyp-head' }, h('strong', null, `${x.order} · ${x.formula} = ${formatMHz(x.calcHz, 3)} MHz`), h('span', null, ` · Δ ${formatHz(x.diffHz)} Hz (${formatKHz(x.diffHz)} kHz) · ${x.tones} generadora${x.tones > 1 ? 's' : ''}`), ...x.classes.map((c) => classBadge(c.cls))), h('div', { class: 'small' }, 'Generadoras: ', x.generators.map((g) => `${g.coef > 0 ? '+' : ''}${g.coef}×${formatMHz(g.freqHz, 3)} (registrada en ${g.stations.length ? g.stations.map((s) => nat.stationName(s)).join(', ') : 'ninguna estación: solo asignada'})`).join(' · ')), h('div', { class: 'small' }, h('strong', null, 'Coexistencia documentada: '), x.coexist.length ? x.coexist.map((s) => nat.stationName(s)).join(', ') : 'ninguna — hipótesis exploratoria', x.observingStationsWithCoexistence.length ? ` · incluye la(s) estación(es) que observaron la señal: ${x.observingStationsWithCoexistence.map((s) => nat.stationName(s)).join(', ')}` : ''), h('details', null, h('summary', null, 'Mecanismos físicos posibles y mediciones para distinguirlos'), h('table', { class: 'data compact' }, h('tbody', null, ...x.mechanisms.filter((m) => m.status !== 'no_aplica').map((m) => h('tr', null, h('td', null, MECHANISM_HINT_LABEL[m.id]), h('td', null, h('span', { class: `mstat ${m.status === 'compatible' ? 'compatible' : 'no_evaluable'}` }, m.status === 'compatible' ? 'Compatible' : 'Requiere datos')), h('td', { class: 'small' }, m.why, h('ul', null, ...m.measurements.map((t) => h('li', null, t))))))))))), r.hypotheses.length > 60 ? h('p', { class: 'hint' }, `… y ${r.hypotheses.length - 60} más (reduzca el orden o la tolerancia).`) : null), h('div', { class: 'card' }, h('h3', null, '8. Mediciones que faltan para distinguir las hipótesis'), h('ul', null, ...r.neededMeasurements.map((m) => h('li', null, m))))) : null);
    }
    async function analyzeScope() {
        busy = 'Calculando…';
        render();
        try {
            await runScope(anaScope, nat.db.settings.params, opts, (t) => { busy = t; }).promise;
            panel.selectedGroup = null;
        }
        catch (e) {
            toast(e.message, 'error');
        }
        busy = '';
        render();
    }
    function renderScopeAnalysis() {
        const latest = nat.latest(anaScope);
        const sa = latest?.sa;
        const hyps = sa ? sa.audit.hypotheses.filter((x) => !onlyCoexist || (sa.coexist.get(`${x.observedId}|${x.key}`) ?? []).includes(stationOfObservedKey(x.observedId) ?? '')) : [];
        const inputs = buildScopeInputs(nat.db, anaScope, opts);
        const p = nat.db.settings.params;
        const est = estimateSearchSpace({ nGenerators: inputs.generators.length, maxOrder: p.maxOrder, maxTones: p.maxTones, minOrder: p.minOrder, includeHarmonics: p.includeHarmonics });
        return h('div', null, h('div', { class: 'card' }, h('h3', null, 'Análisis por ámbito'), h('div', { class: 'inline wrap-gap' }, scopeSelect(anaScope, (s) => { anaScope = s; render(); })), scopeOptionsControls(opts, (o) => { opts = o; render(); }), h('p', { class: 'hint' }, `${inputs.generators.length} generadoras, ${inputs.observed.length} señales a explicar. Orden ≤ ${p.maxOrder}, ≤ ${p.maxTones} generadoras, ±${formatKHz(p.toleranceHz)} kHz (se cambian en la vista Estación o en el Analizador). Cota: ${formatBig(est.workBound)} nodos; presupuesto ${formatBig(BigInt(p.workBudget))}.`), est.workBound > BigInt(p.workBudget) ? h('p', { class: 'warn' }, 'La cota supera el presupuesto: si se agota, el resultado se marcará INCOMPLETO.') : null, ...inputs.notes.map((n) => h('div', { class: 'banner warn' }, n)), h('div', { class: 'toolbar wrap' }, h('button', { type: 'button', class: 'primary', disabled: !!busy, onclick: () => analyzeScope() }, busy || `Analizar ${scopeLabel(nat.db, anaScope)}`), sa ? h('button', { type: 'button', onclick: () => download(`orbe-im-hallazgos-${stamp()}.md`, findingsReport(nat.db, sa), 'text/markdown;charset=utf-8') }, 'Informe de hallazgos (.md)') : null, sa ? h('button', { type: 'button', onclick: () => { nat.mutate((d) => { d.analyses.push(snapshotOf(sa)); }, ['analyses']); toast('Instantánea guardada.', 'ok'); } }, 'Guardar instantánea') : null, sa ? h('button', { type: 'button', onclick: () => { openInClassic(sa); nav.toClassic(); } }, 'Abrir en Auditoría espectral') : null)), sa ? h('div', { class: 'card' }, h('h3', null, `Hipótesis con señal observada (${hyps.length})`), latest?.stale ? h('p', { class: 'warn' }, 'Los datos cambiaron después de este análisis: recalcule.') : null, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: onlyCoexist, onchange: (e) => { onlyCoexist = e.target.checked; render(); } }), 'solo físicamente plausibles (generadoras registradas en la estación que observa la señal)'), h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' }, h('thead', null, h('tr', null, ...['Señal (MHz)', 'Estación', 'Producto (MHz)', 'Δ (kHz)', 'Orden', 'Fórmula', 'Coexistencia documentada', 'Clase'].map((t) => h('th', null, t)))), h('tbody', null, ...hyps.slice(0, 500).map((x) => {
            const co = sa.coexist.get(`${x.observedId}|${x.key}`) ?? [];
            return h('tr', null, h('td', { class: 'num' }, formatMHz(x.observedHz, 3)), h('td', null, nat.stationName(stationOfObservedKey(x.observedId) ?? '')), h('td', { class: 'num' }, formatMHz(x.calcHz, 3)), h('td', { class: 'num' }, formatKHz(x.diffHz)), h('td', null, orderLabel(sa.run.result.store, x.combo)), h('td', { class: 'formula' }, formulaNumeric(sa.run.result, x.combo)), h('td', null, co.length ? co.map((s) => nat.stationName(s)).join(', ') : 'ninguna (exploratoria)'), h('td', null, classBadge(x.classification.cls)));
        })))), h('p', { class: 'hint' }, `Clases: ${Object.entries(CLASS_LABEL).map(([k, v]) => `${k} ${v}`).join(' · ')}.`)) : null);
    }
    function renderComparative() {
        const db = nat.db;
        const ids = [...compareIds].sort();
        const rows = ids.length >= 2 ? compareStations(db, ids, tolHz, opts) : [];
        const shared = rows.filter((r) => r.stations >= 2);
        return h('div', { class: 'card' }, h('h3', null, 'Modo comparativo'), h('div', { class: 'inline wrap-gap' }, ...db.stations.map((s) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: compareIds.has(s.id), onchange: (e) => { if (e.target.checked)
                compareIds.add(s.id);
            else
                compareIds.delete(s.id); compareIds = new Set(compareIds); render(); } }), `${s.id} ${s.name}`))), h('div', { class: 'inline wrap-gap' }, field('Agrupar frecuencias a ±', toleranceControl(tolHz, (hz) => { tolHz = hz; render(); })), scopeOptionsControls(opts, (o) => { opts = o; render(); })), ids.length < 2 ? h('p', { class: 'hint' }, 'Seleccione al menos dos estaciones.') : h('div', null, h('p', null, `${rows.length} frecuencias observadas; ${shared.length} registradas en dos o más de las estaciones seleccionadas.`), h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' }, h('thead', null, h('tr', null, h('th', null, 'Frecuencia (MHz)'), ...ids.map((i) => h('th', null, nat.stationName(i))), h('th', null, 'Estaciones'))), h('tbody', null, ...rows.slice(0, 1000).map((r) => h('tr', { class: r.stations >= 2 ? 'hit' : '' }, h('td', { class: 'num' }, formatMHz(r.freqHz, 3)), ...ids.map((i) => { const rs = r.perStation[i]; return h('td', { class: 'small' }, rs ? rs.map((x) => `${x.status === 'portadora_confirmada' ? '●' : '○'}${x.levelValue !== null ? ` ${x.levelValue} ${x.levelUnit}` : ''}`).join(' ') : '—'); }), h('td', { class: 'num' }, String(r.stations))))))), h('h4', null, 'Coincidencias IM por estación (último análisis de cada una)'), h('table', { class: 'data compact' }, h('thead', null, h('tr', null, ...['Estación', 'Generadoras', 'Señales a explicar', 'Hipótesis B–D', 'Estado'].map((t) => h('th', null, t)))), h('tbody', null, ...ids.map((i) => { const a = nat.latest({ kind: 'estacion', stationId: i }); return h('tr', null, h('td', null, nat.stationName(i)), h('td', { class: 'num' }, a ? String(a.sa.inputs.generators.length) : '—'), h('td', { class: 'num' }, a ? String(a.sa.inputs.observed.length) : '—'), h('td', { class: 'num' }, a ? String(a.sa.audit.hypotheses.length) : '—'), h('td', null, a ? (a.stale ? 'desactualizado' : a.sa.run.meta.complete ? 'exhaustivo' : 'INCOMPLETO') : h('button', { type: 'button', onclick: async () => { try {
                await runScope({ kind: 'estacion', stationId: i }, nat.db.settings.params, opts).promise;
            }
            catch (e) {
                toast(e.message, 'error');
            } } }, 'Calcular'))); }))), h('p', { class: 'hint' }, '● portadora confirmada · ○ señal observada o sospechosa. Las asignaciones no cuentan como recepción.')));
    }
    function render() {
        if (!nat.ready) {
            mount(root, h('p', { class: 'hint' }, 'Cargando la base nacional…'));
            return;
        }
        if (!root.contains(body))
            mount(root, h('div', { class: 'section-intro' }, h('h2', null, 'Investigador IM'), h('p', null, 'Combinaciones de coeficientes enteros con 2, 3, 4 o más generadoras (IM2…IM9 y órdenes superiores). Una coincidencia numérica nunca es una atribución causal; las combinaciones entre estaciones distintas son exploratorias salvo que conste la coexistencia de las señales.')), body, panel.root);
        mount(body, h('div', { class: 'toolbar wrap', role: 'tablist' }, ...[['frecuencia', 'Investigar frecuencia'], ['ambito', 'Estación / región / nacional'], ['comparativo', 'Comparativo']].map(([m, t]) => h('button', { type: 'button', role: 'tab', class: 'chip' + (mode === m ? ' on' : ''), 'aria-selected': String(mode === m), onclick: () => { mode = m; render(); } }, t))), mode === 'frecuencia' ? renderInvestigation() : mode === 'ambito' ? renderScopeAnalysis() : renderComparative());
        panel.root.hidden = mode !== 'ambito';
        if (mode === 'ambito')
            panel.refresh();
    }
    return { render, investigate: (f) => { mode = 'frecuencia'; freqText = formatMHz(f, 3); result = null; render(); void investigate(); } };
}
