/** Sección «Auditoría espectral»: señales medidas frente a productos teóricos, con clasificación A–D. */
import { CLASS_LABEL, EVIDENCE_TYPE_LABEL, MIN_JUSTIFICATION_CHARS, findPeaks, formatKHz, formatMHz, formulaNumeric, generatorsLabel, importTrace, makeSignal, newId, orderLabel, } from '../engine/index.js';
import { field, h, mount, num, pickFile, select, toast } from './dom.js';
import { ResultsPanel } from './panel.js';
import { toleranceControl } from './params.js';
import { SignalList, readTableFile, sourceInfo } from './signals.js';
import { store } from './state.js';
import { classBadge } from './table.js';
const today = () => new Date().toISOString().slice(0, 10);
export function auditView(root, nav) {
    const list = new SignalList({
        title: 'Señales observadas',
        kind: 'observadas',
        get: () => store.project.observed,
        set: (l, src) => store.update((p) => { p.observed = l; if (src)
            p.sources.push(src); }),
        defaultClass: 'senal_observada',
        onSelect: (id) => { openObs = id; panel.selectedObservedId = id; render(); },
    });
    const status = h('div');
    const obsTable = h('div', { class: 'table-wrap' });
    const traceBox = h('div');
    const tolBox = h('div', { class: 'inline' });
    let openObs = null;
    let peaks = [];
    const panel = new ResultsPanel({
        getRun: () => store.run,
        getAudit: () => store.auditResult,
        getProject: () => store.project,
        getObserved: () => store.project.observed,
        getTransmitters: () => store.project.transmitters,
        getTrace: () => store.project.trace?.points ?? null,
        toleranceHz: () => store.project.params.toleranceHz,
        filePrefix: 'orbe-im-auditoria',
        isStale: () => store.isRunStale(),
    }, (s) => { if (s.kind === 'observada') {
        openObs = s.id;
        renderObsTable();
        obsTable.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } });
    async function importTraceFile() {
        const file = await pickFile('.csv,.tsv,.txt,.xlsx');
        if (!file)
            return;
        try {
            const f = await readTableFile(file);
            const t = importTrace(f.rows);
            if (t.errors.length && t.points.length < 2)
                throw new Error(t.errors.map((e) => (e.row ? `Fila ${e.row}: ` : '') + e.message).join(' '));
            store.update((p) => { p.trace = { name: f.name, points: t.points }; p.sources.push(sourceInfo(f, 'traza', t.points.length, t.errors.length)); }, { reaudit: false });
            toast(`Traza importada: ${t.points.length} puntos${t.errors.length ? `, ${t.errors.length} filas rechazadas` : ''} (unidad ${t.unit}).`, 'ok');
        }
        catch (e) {
            toast(e.message, 'error');
        }
    }
    function renderTrace() {
        const tr = store.project.trace;
        const thr = h('input', { type: 'text', inputmode: 'decimal', class: 'narrow', value: '-80', 'aria-label': 'Umbral (dBm)' });
        const sep = h('input', { type: 'text', inputmode: 'decimal', class: 'narrow', value: '50', 'aria-label': 'Separación mínima (kHz)' });
        mount(traceBox, h('div', { class: 'toolbar wrap' }, h('button', { type: 'button', onclick: () => importTraceFile() }, 'Importar traza de espectro (CSV / Excel)…'), tr ? h('span', null, `${tr.name}: ${tr.points.length} puntos, ${formatMHz(tr.points[0].hz, 3)}–${formatMHz(tr.points[tr.points.length - 1].hz, 3)} MHz`) : h('span', { class: 'hint' }, 'Sin traza: el espectro solo mostrará marcadores.'), tr ? h('button', { type: 'button', class: 'danger', onclick: () => { peaks = []; store.update((p) => { p.trace = null; }, { reaudit: false }); } }, 'Quitar traza') : null), tr ? h('div', { class: 'toolbar wrap' }, field('Umbral (dBm)', thr), field('Separación mínima (kHz)', sep), h('button', { type: 'button', onclick: () => { const t = num(thr.value), s = num(sep.value); if (t === null || s === null)
                return; peaks = findPeaks(tr.points, t, s * 1000); renderTrace(); } }, 'Proponer picos')) : null, peaks.length ? h('div', null, h('p', { class: 'hint' }, `${peaks.length} picos propuestos. Son candidatos: se añaden como «señal observada», nunca como portadoras.`), h('p', null, peaks.map((p) => `${formatMHz(p.hz, 3)} MHz (${p.dbm} dBm)`).join(' · ')), h('button', { type: 'button', onclick: () => {
                const add = peaks.map((p) => makeSignal(p.hz, { levelDbm: p.dbm, classification: 'senal_observada', source: `pico de ${tr?.name}`, label: 'pico detectado' }));
                peaks = [];
                store.update((p) => { p.observed = [...p.observed, ...add]; });
            } }, 'Añadir picos como señales observadas')) : null);
    }
    function evidenceForm(observedId, key) {
        let type = 'apagado_generador';
        let result = 'compatible';
        let scope = 'hipotesis';
        const desc = h('textarea', { rows: 3, placeholder: 'Describa la prueba, condiciones, registro o archivo de respaldo…', 'aria-label': 'Descripción' });
        const author = h('input', { type: 'text', placeholder: 'Autor', 'aria-label': 'Autor' });
        const date = h('input', { type: 'date', value: today(), 'aria-label': 'Fecha' });
        return h('details', { class: 'form-box' }, h('summary', null, 'Registrar evidencia experimental'), h('div', { class: 'grid' }, field('Tipo', select(Object.keys(EVIDENCE_TYPE_LABEL).filter((t) => t !== 'atenuacion').map((t) => ({ value: t, label: EVIDENCE_TYPE_LABEL[t] })), type, (v) => { type = v; })), field('Resultado', select([{ value: 'compatible', label: 'Compatible con la hipótesis' }, { value: 'incompatible', label: 'Incompatible' }, { value: 'no_concluyente', label: 'No concluyente' }], result, (v) => { result = v; })), field('Alcance', select([{ value: 'hipotesis', label: 'Solo esta hipótesis' }, { value: 'senal', label: 'Todas las hipótesis de la señal' }], scope, (v) => { scope = v; })), field('Autor', author), field('Fecha', date)), field('Descripción', desc), h('button', { type: 'button', onclick: () => {
                if (!desc.value.trim()) {
                    toast('Documente la evidencia con una descripción.', 'error');
                    return;
                }
                const e = { id: newId('e'), observedId, hypothesisKey: scope === 'hipotesis' ? key : null, type, result, description: desc.value.trim(), date: date.value, author: author.value.trim(), labTestId: null };
                store.update((p) => { p.evidence.push(e); });
                toast('Evidencia registrada.', 'ok');
            } }, 'Guardar evidencia'), h('p', { class: 'hint' }, 'Las pruebas de atenuación se registran desde el Laboratorio RF, que calcula su resultado.'));
    }
    function confirmForm(h0) {
        const existing = store.project.confirmations.find((c) => c.observedId === h0.observedId && c.hypothesisKey === h0.key);
        const just = h('textarea', { rows: 3, placeholder: `Justificación documentada (mín. ${MIN_JUSTIFICATION_CHARS} caracteres)`, 'aria-label': 'Justificación' }, existing?.justification ?? '');
        const author = h('input', { type: 'text', placeholder: 'Analista responsable', value: existing?.author ?? '', 'aria-label': 'Autor' });
        const date = h('input', { type: 'date', value: existing?.date || today(), 'aria-label': 'Fecha' });
        const canConfirm = h0.classification.cls === 'C' || h0.classification.cls === 'D';
        return h('details', { class: 'form-box' }, h('summary', null, existing ? 'Confirmación registrada (editar o retirar)' : 'Confirmar como producto de intermodulación'), !canConfirm ? h('p', { class: 'warn' }, 'Solo puede confirmarse un candidato experimental (clase C). Falta: ' + h0.classification.missing.join(' ')) : null, canConfirm ? h('div', null, field('Justificación', just), h('div', { class: 'grid' }, field('Analista', author), field('Fecha', date)), h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'primary', onclick: () => {
                const c = { observedId: h0.observedId, hypothesisKey: h0.key, justification: just.value.trim(), author: author.value.trim(), date: date.value };
                store.update((p) => { p.confirmations = p.confirmations.filter((x) => !(x.observedId === c.observedId && x.hypothesisKey === c.hypothesisKey)); p.confirmations.push(c); });
                const after = store.auditResult?.hypotheses.find((x) => x.observedId === c.observedId && x.key === c.hypothesisKey);
                toast(after?.classification.cls === 'D' ? 'Hipótesis confirmada (clase D).' : 'Confirmación guardada, pero aún no cumple los requisitos de la clase D: ' + (after?.classification.missing.join(' ') ?? ''), after?.classification.cls === 'D' ? 'ok' : 'error');
            } }, 'Guardar confirmación'), existing ? h('button', { type: 'button', class: 'danger', onclick: () => store.update((p) => { p.confirmations = p.confirmations.filter((x) => x !== existing); }) }, 'Retirar confirmación') : null), h('p', { class: 'hint' }, 'La confirmación de una hipótesis no excluye que otras combinaciones contribuyan a la misma frecuencia.')) : null);
    }
    function renderObsTable() {
        const au = store.auditResult;
        const run = store.run;
        if (!au || !run) {
            mount(obsTable);
            return;
        }
        const rs = run.result;
        const hypBy = new Map();
        for (const x of au.hypotheses) {
            const a = hypBy.get(x.observedId) ?? [];
            a.push(x);
            hypBy.set(x.observedId, a);
        }
        const rows = [];
        for (const m of [...au.matches].sort((a, b) => a.observed.freqHz - b.observed.freqHz)) {
            const o = m.observed;
            const hs = hypBy.get(o.id) ?? [];
            const cls = au.observedClass.get(o.id) ?? null;
            const open = openObs === o.id;
            rows.push(h('tr', { class: (open ? 'sel ' : '') + (hs.length ? 'hit' : ''), tabindex: '0', onclick: () => { openObs = open ? null : o.id; panel.selectedObservedId = openObs; renderObsTable(); panel.redrawSpectrum(); } }, h('td', { class: 'num' }, formatMHz(o.freqHz, 3)), h('td', null, o.label || '—'), h('td', { class: 'num' }, o.levelDbm ?? '—'), h('td', null, o.classification.replace('_', ' ')), h('td', null, cls ? classBadge(cls) : h('span', { class: 'badge none' }, 'sin coincidencia')), h('td', { class: 'num' }, String(hs.length)), h('td', { class: 'small' }, hs.length ? `Δ mín. ${formatKHz(Math.min(...hs.map((x) => Math.abs(x.diffHz))))} kHz` : m.nearest ? `más próximo ${formatMHz(m.nearest.freqHz, 3)} (Δ ${formatKHz(m.nearest.diffHz)} kHz)` : '—')));
            if (open) {
                const ev = store.project.evidence.filter((e) => e.observedId === o.id);
                rows.push(h('tr', { class: 'expand' }, h('td', { colspan: '7' }, hs.length ? h('div', null, h('p', null, `${hs.length} hipótesis compatible${hs.length > 1 ? 's' : ''} dentro de ±${formatKHz(au.toleranceHz)} kHz. Coincidir no es confirmar.`), ...hs.map((x) => h('div', { class: 'hyp' }, h('div', { class: 'hyp-head' }, classBadge(x.classification.cls), h('strong', null, ` ${orderLabel(rs.store, x.combo)} · ${formulaNumeric(rs, x.combo)} = ${formatMHz(x.calcHz, 3)} MHz`), h('span', null, ` · Δ ${formatKHz(x.diffHz)} kHz`)), h('div', { class: 'small' }, generatorsLabel(rs, x.combo)), h('ul', { class: 'small' }, ...x.classification.reasons.map((r) => h('li', null, r)), ...x.classification.missing.map((r) => h('li', { class: 'missing' }, 'Falta: ' + r))), h('div', { class: 'toolbar wrap' }, h('button', { type: 'button', onclick: () => nav.toLab(o.id, x.key) }, 'Prueba de atenuación…')), evidenceForm(o.id, x.key), confirmForm(x)))) : h('p', null, 'Ningún producto del alcance configurado cae dentro de la tolerancia. Esto no descarta intermodulación de orden superior, con otros generadores o fuera del intervalo calculado, ni otros mecanismos.'), ev.length ? h('div', null, h('h4', null, 'Evidencias registradas para esta señal'), h('ul', null, ...ev.map((e) => h('li', null, `${e.date} · ${e.author || '—'} · ${EVIDENCE_TYPE_LABEL[e.type]} · ${e.result} · ${e.hypothesisKey ? 'hipótesis ' + e.hypothesisKey : 'todas las hipótesis'} — ${e.description} `, h('button', { type: 'button', class: 'icon', 'aria-label': 'Eliminar evidencia', onclick: () => store.update((p) => { p.evidence = p.evidence.filter((x) => x.id !== e.id); }) }, '×'))))) : null)));
            }
        }
        mount(obsTable, h('table', { class: 'data' }, h('thead', null, h('tr', null, ...['Señal (MHz)', 'Identificación', 'Nivel (dBm)', 'Clasificación declarada', 'Mejor clase', 'Hipótesis', 'Diferencia'].map((t) => h('th', null, t)))), h('tbody', null, ...rows)));
    }
    function renderStatus() {
        const au = store.auditResult;
        const run = store.run;
        mount(tolBox, h('span', { class: 'field-label' }, 'Tolerancia de comparación: '), toleranceControl(store.project.params.toleranceHz, (hz) => store.update((p) => { p.params = { ...p.params, toleranceHz: hz }; })));
        if (!run) {
            mount(status, h('div', { class: 'banner warn' }, 'Aún no hay productos calculados. ', h('button', { type: 'button', onclick: nav.toAnalyzer }, 'Ir al Analizador de banda')));
            return;
        }
        if (!au) {
            mount(status);
            return;
        }
        const counts = { A: 0, B: 0, C: 0, D: 0 };
        for (let g = 0; g < run.result.groupCount; g++)
            counts[au.groupClass.get(g) ?? 'A']++;
        const cov = au.coverage.all;
        mount(status, !run.meta.complete ? h('div', { class: 'banner bad' }, '✖ El cálculo de productos es INCOMPLETO: una señal sin coincidencias podría tener explicación entre los productos no calculados.') : null, store.isRunStale() ? h('div', { class: 'banner warn' }, '⚠ Las emisoras o los parámetros cambiaron: recalcule en el Analizador de banda.') : null, h('div', { class: 'stats' }, ...['A', 'B', 'C', 'D'].map((c) => h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, String(counts[c])), h('div', { class: 'stat-l' }, classBadge(c)))), h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, `${(cov * 100).toFixed(2)} %`), h('div', { class: 'stat-l' }, 'Probabilidad de coincidencia fortuita')), h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, String(au.unmatched.length)), h('div', { class: 'stat-l' }, 'Señales sin coincidencia'))), h('p', { class: cov > 0.2 ? 'warn' : 'hint' }, `Con ±${formatKHz(au.toleranceHz)} kHz, las ventanas de los ${run.result.groupCount} productos cubren el ${(cov * 100).toFixed(2)} % de la banda: es la probabilidad de que una señal cualquiera, independiente, «coincida» por azar. `, cov > 0.2 ? 'Es alta: las coincidencias de frecuencia, por sí solas, aportan poca evidencia. Reduzca la tolerancia o el orden máximo, o aporte pruebas experimentales.' : '', au.coverage.byMaxOrder.length ? ' Por orden máximo: ' + au.coverage.byMaxOrder.map((c) => `≤${c.order}: ${(c.fraction * 100).toFixed(2)} %`).join(' · ') : ''));
    }
    function render() {
        list.render();
        renderTrace();
        renderStatus();
        renderObsTable();
        panel.refresh();
    }
    mount(root, h('div', { class: 'section-intro' }, h('h2', null, 'Auditoría espectral'), h('p', null, 'Importe las frecuencias medidas (exportación CSV/Excel de SCORPIO u otro analizador) y compárelas con todos los productos teóricos del Analizador de banda. '), h('ul', { class: 'classes' }, h('li', null, classBadge('A'), ' existe matemáticamente; no se ha observado.'), h('li', null, classBadge('B'), ' hay una señal medida dentro de la tolerancia (no es confirmación).'), h('li', null, classBadge('C'), ' además hay evidencia experimental documentada compatible y ninguna incompatible.'), h('li', null, classBadge('D'), ' solo con confirmación explícita, evidencia fuerte y generadores confirmados.'))), h('div', { class: 'card' }, h('h3', null, 'Señales medidas'), list.root), h('div', { class: 'card' }, h('h3', null, 'Traza de espectro (opcional)'), traceBox), h('div', { class: 'card' }, h('h3', null, 'Comparación'), tolBox, status, obsTable), panel.root);
    void CLASS_LABEL;
    return { render };
}
