/** Sección «Estación»: ficha técnica, inventario radioeléctrico, importación, barridos y análisis de la estación. */
import { LOCATION_CONFIDENCE_LABEL, RECORD_STATUS_LABEL, addRecords, addSource, addSweep, findingsReport, formatKHz, formatMHz, importObservations, importTrace, isLocationUncertain, jsonToRows, parseFrequency, sha256Hex, snapshotOf, updateRecord, updateStation, voidRecord, CLASS_LABEL, observedKey, buildScopeInputs, formulaNumeric, orderLabel, } from '../engine/index.js';
import { details, download, field, h, mount, num, pickFile, select, stamp, toast } from './dom.js';
import { nat } from './natstore.js';
import { ResultsPanel } from './panel.js';
import { paramsForm } from './params.js';
import { openInClassic, runScope, scopeOptionsControls } from './scope.js';
import { readTableFile } from './signals.js';
import { classBadge } from './table.js';
const STATUS_OPTS = Object.keys(RECORD_STATUS_LABEL).map((s) => ({ value: s, label: RECORD_STATUS_LABEL[s] }));
const UNIT_OPTS = [{ value: '', label: '—' }, { value: 'dBm', label: 'dBm' }, { value: 'dBµV', label: 'dBµV' }, { value: 'dBµV/m', label: 'dBµV/m' }, { value: 'otra', label: 'otra' }];
export function stationView(root, nav) {
    let stationId = '01';
    let statusFilter = '';
    let showVoided = false;
    let search = '';
    let editing = null;
    let preview = null;
    let opts = {};
    let running = false;
    const scope = () => ({ kind: 'estacion', stationId });
    const head = h('div');
    const ficha = h('div', { class: 'card' });
    const inv = h('div', { class: 'card' });
    const imp = h('div', { class: 'card' });
    const sweeps = h('div', { class: 'card' });
    const anal = h('div', { class: 'card' });
    const coex = h('div');
    const form = paramsForm({
        get: () => nat.db.settings.params,
        set: (p) => nat.mutate((d) => { d.settings.params = p; }, [], true),
        nGenerators: () => buildScopeInputs(nat.db, scope(), opts).generators.length,
        showLimits: true,
    });
    const panel = new ResultsPanel({
        getRun: () => nat.latest(scope())?.sa.run ?? null,
        getAudit: () => nat.latest(scope())?.sa.audit ?? null,
        getProject: () => null,
        getObserved: () => nat.latest(scope())?.sa.inputs.observed ?? [],
        getTransmitters: () => nat.latest(scope())?.sa.inputs.generators ?? [],
        getTrace: () => { const w = nat.db.sweeps.filter((x) => x.stationId === stationId); return w.length ? w[w.length - 1].points : null; },
        toleranceHz: () => nat.db.settings.params.toleranceHz,
        filePrefix: `orbe-im-estacion-${stationId}`,
        isStale: () => !!nat.latest(scope())?.stale,
    });
    function renderHead() {
        mount(head, h('div', { class: 'section-intro' }, h('h2', null, 'Estación'), h('p', null, 'Inventario editable de frecuencias, niveles, historial y resultados de intermodulación de cada estación.')), h('div', { class: 'toolbar wrap station-picker', role: 'tablist', 'aria-label': 'Estaciones' }, ...nat.db.stations.map((s) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(s.id === stationId), class: 'chip' + (s.id === stationId ? ' on' : ''), onclick: () => { stationId = s.id; editing = null; preview = null; render(); } }, `${s.id} ${s.name}${isLocationUncertain(s) ? ' (?)' : ''}`))));
    }
    function renderFicha() {
        const s = nat.db.stations.find((x) => x.id === stationId);
        const l = s.location;
        const upd = (patch, reason = 'edición de la ficha') => { const e = nat.mutate((d) => updateStation(d, stationId, patch, reason), ['stations', 'regions']); if (e.length)
            toast(e[0], 'error'); };
        const vLat = h('input', { type: 'text', class: 'narrow', inputmode: 'decimal', placeholder: 'lat', 'aria-label': 'Latitud verificada' });
        const vLon = h('input', { type: 'text', class: 'narrow', inputmode: 'decimal', placeholder: 'lon', 'aria-label': 'Longitud verificada' });
        const vSrc = h('input', { type: 'text', placeholder: 'Fuente (p. ej. levantamiento GPS de campo)', 'aria-label': 'Fuente de la verificación' });
        const vMet = h('input', { type: 'text', class: 'narrow', placeholder: 'Método (GNSS…)', 'aria-label': 'Método' });
        const vDate = h('input', { type: 'date', 'aria-label': 'Fecha de verificación' });
        mount(ficha, h('h3', null, `Ficha técnica — ${s.operationalName}`), h('div', { class: 'grid' }, field('Identificador', h('input', { type: 'text', value: s.id, disabled: true })), field('Nombre operativo', h('input', { type: 'text', value: s.operationalName, onchange: (e) => upd({ operationalName: e.target.value }) })), field('Región de vigilancia', select(nat.db.regions.map((r) => ({ value: r.id, label: r.name })), s.regionId, (v) => upd({ regionId: v }, 'cambio de región de la estación'))), field('Emplazamiento histórico', h('input', { type: 'text', value: l.site, onchange: (e) => upd({ location: { ...l, site: e.target.value } }) })), field('Bandas vigiladas', h('input', { type: 'text', value: s.bands.join(', '), placeholder: 'p. ej. 88–108 MHz', onchange: (e) => upd({ bands: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }) }))), field('Características técnicas conocidas', h('textarea', { rows: 2, placeholder: 'Sin documentar', onchange: (e) => upd({ technical: e.target.value }) }, s.technical)), field('Fuentes documentales (una por línea)', h('textarea', { rows: 2, onchange: (e) => upd({ sources: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) }) }, s.sources.join('\n'))), field('Observaciones', h('textarea', { rows: 2, onchange: (e) => upd({ notes: e.target.value }) }, s.notes)), h('h4', null, 'Ubicación'), h('p', null, h('span', { class: isLocationUncertain(s) ? 'badge warnb' : 'badge none' }, LOCATION_CONFIDENCE_LABEL[l.confidence])), h('ul', { class: 'small' }, l.historic ? h('li', null, `Coordenada histórica: ${l.historic.lat}, ${l.historic.lon} — ${l.historic.source}. ${l.historic.note}`) : h('li', null, 'Sin coordenada histórica documentada.'), l.reference ? h('li', null, `Referencia aproximada: ${l.reference.lat}, ${l.reference.lon} (± ${l.reference.uncertaintyKm} km) — ${l.reference.note}`) : null, l.verified ? h('li', null, `Verificada: ${l.verified.lat}, ${l.verified.lon} — ${l.verified.method}, ${l.verified.date}, ${l.verified.source}`) : h('li', null, 'Sin verificación GPS.'), h('li', null, `Torre: municipio ${nat.municipalityName(l.municipalityId)}, provincia ${nat.provinceName(l.provinceId)}. ${l.locationBasis}`), h('li', null, `Última actualización de la ficha: ${s.updatedAt}`)), details('Registrar coordenada verificada', false, h('div', { class: 'inline wrap-gap' }, vLat, vLon, vMet, vDate, vSrc), h('button', { type: 'button', onclick: () => {
                const lat = num(vLat.value), lon = num(vLon.value);
                if (lat === null || lon === null) {
                    toast('Latitud y longitud numéricas.', 'error');
                    return;
                }
                upd({ location: { ...l, verified: { lat, lon, source: vSrc.value.trim(), note: '', date: vDate.value, method: vMet.value.trim() }, confidence: 'verificada' } }, 'verificación de coordenadas');
            } }, 'Guardar verificación'), h('p', { class: 'hint' }, 'Exige fuente y método. La coordenada histórica se conserva.')));
    }
    function recordForm(r, onSave) {
        const f = h('input', { type: 'text', class: 'narrow', inputmode: 'decimal', value: r ? formatMHz(r.freqHz, 3) : '', placeholder: '88.780', 'aria-label': 'Frecuencia (MHz)' });
        let status = r?.status ?? 'observada_sin_identificar';
        let unit = r?.levelUnit ?? 'dBm';
        let auth = r?.authorization.status ?? 'desconocida';
        let kind = r?.dataKind ?? 'real';
        let muni = r?.municipalityId ?? '';
        const dt = h('input', { type: 'text', value: r?.datetime ?? '', placeholder: 'AAAA-MM-DD hh:mm', 'aria-label': 'Fecha y hora' });
        const lv = h('input', { type: 'text', class: 'narrow', inputmode: 'decimal', value: r?.levelValue ?? '', 'aria-label': 'Nivel' });
        const bw = h('input', { type: 'text', class: 'narrow', inputmode: 'decimal', value: r?.bandwidthHz ? String(r.bandwidthHz / 1000) : '', 'aria-label': 'Ancho de banda (kHz)' });
        const sv = h('input', { type: 'text', value: r?.service ?? '', placeholder: 'Radiodifusión FM', 'aria-label': 'Servicio' });
        const em = h('input', { type: 'text', value: r?.emisora ?? '', 'aria-label': 'Emisora' });
        const loc = h('input', { type: 'text', value: r?.locality ?? '', 'aria-label': 'Localidad' });
        const ev = h('input', { type: 'text', value: r?.authorization.evidence ?? '', placeholder: 'Documento que lo acredita', 'aria-label': 'Evidencia de autorización' });
        const nt = h('input', { type: 'text', value: r?.notes ?? '', 'aria-label': 'Observaciones' });
        const reason = h('input', { type: 'text', placeholder: r ? 'Motivo del cambio (obligatorio)' : 'Fuente o motivo (opcional)', 'aria-label': 'Motivo' });
        const munis = (nat.carto?.municipios ?? []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
        return h('div', { class: 'form-box' }, h('div', { class: 'grid' }, field('Frecuencia (MHz)', f), field('Estado', select(STATUS_OPTS, status, (v) => { status = v; })), field('Fecha y hora', dt), field('Nivel', h('span', { class: 'inline' }, lv, select(UNIT_OPTS, unit, (v) => { unit = v; }, { 'aria-label': 'Unidad de nivel' }))), field('Ancho de banda (kHz)', bw), field('Servicio', sv), field('Emisora', em), field('Municipio', select([{ value: '', label: '—' }, ...munis.map((m) => ({ value: m.id, label: `${m.nombre} (${nat.provinceName(m.provincia)})` }))], muni, (v) => { muni = v; })), field('Localidad', loc), field('Autorización', select([{ value: 'desconocida', label: 'Desconocida' }, { value: 'autorizada', label: 'Autorizada (con evidencia)' }, { value: 'no_autorizada', label: 'No autorizada (con evidencia)' }], auth, (v) => { auth = v; })), field('Evidencia de autorización', ev), field('Tipo de dato', select([{ value: 'real', label: 'Real' }, { value: 'simulado', label: 'Simulado / ejemplo' }], kind, (v) => { kind = v; })), field('Observaciones', nt), field(r ? 'Motivo' : 'Fuente', reason)), h('button', { type: 'button', class: 'primary', onclick: () => {
                const fr = parseFrequency(f.value);
                if (!fr.ok) {
                    toast(fr.error ?? 'Frecuencia no válida', 'error');
                    return;
                }
                const bwk = bw.value.trim() ? parseFrequency(bw.value, 'kHz') : null;
                if (bwk && !bwk.ok) {
                    toast('Ancho de banda no válido', 'error');
                    return;
                }
                if (r && !reason.value.trim()) {
                    toast('Indique el motivo del cambio.', 'error');
                    return;
                }
                onSave({ stationId, freqHz: fr.hz, status, datetime: dt.value.trim(), levelValue: num(lv.value), levelUnit: lv.value.trim() ? unit : '', bandwidthHz: bwk ? bwk.hz : null, service: sv.value.trim(), emisora: em.value.trim(), municipalityId: muni || null, locality: loc.value.trim(), authorization: { status: auth, evidence: ev.value.trim() }, notes: nt.value.trim(), dataKind: kind }, reason.value.trim());
            } }, r ? 'Guardar cambios' : 'Añadir registro'));
    }
    function renderInventory() {
        const all = nat.db.records.filter((r) => r.stationId === stationId);
        const q = parseFrequency(search);
        const list = all.filter((r) => (showVoided || !r.voided) && (!statusFilter || r.status === statusFilter) && (!search.trim() || (q.ok && Math.abs(r.freqHz - q.hz) <= nat.db.settings.params.toleranceHz)))
            .sort((a, b) => a.freqHz - b.freqHz || (a.datetime < b.datetime ? 1 : -1));
        const searchInp = h('input', { type: 'search', value: search, placeholder: 'Buscar frecuencia (MHz)', 'aria-label': 'Buscar frecuencia', onchange: (e) => { search = e.target.value; renderInventory(); } });
        mount(inv, h('h3', null, `Inventario radioeléctrico — ${all.filter((r) => !r.voided).length} registros activos`), details('Añadir frecuencia', all.length === 0, recordForm(null, (inp, why) => {
            const rep = nat.mutate((d) => addRecords(d, [inp], why || 'alta manual'), ['records']);
            if (rep.rejected.length)
                toast(rep.rejected[0].errors.join(' '), 'error');
            else if (rep.duplicates.length)
                toast('Duplicado exacto de un registro existente: no se añadió.', 'error');
            else
                toast(`Registrado ${formatMHz(inp.freqHz, 3)} MHz.`, 'ok');
        })), h('div', { class: 'filter-row' }, searchInp, select([{ value: '', label: 'Todos los estados' }, ...STATUS_OPTS], statusFilter, (v) => { statusFilter = v; renderInventory(); }, { 'aria-label': 'Filtrar por estado' }), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showVoided, onchange: (e) => { showVoided = e.target.checked; renderInventory(); } }), 'mostrar anulados')), list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, ...['Frecuencia (MHz)', 'Hz', 'Estado', 'Fecha y hora', 'Nivel', 'Ancho (kHz)', 'Servicio / emisora', 'Autorización', 'Dato', 'Historial', ''].map((t) => h('th', null, t)))), h('tbody', null, ...list.flatMap((r) => {
            const row = h('tr', { class: r.voided ? 'voided' : '' }, h('td', { class: 'num' }, formatMHz(r.freqHz, 3)), h('td', { class: 'num small' }, String(r.freqHz)), h('td', null, RECORD_STATUS_LABEL[r.status]), h('td', null, r.datetime || '—'), h('td', { class: 'num' }, r.levelValue !== null ? `${r.levelValue} ${r.levelUnit}` : '—'), h('td', { class: 'num' }, r.bandwidthHz ? formatKHz(r.bandwidthHz).replace(/\.?0+$/, '') : '—'), h('td', null, [r.service, r.emisora].filter(Boolean).join(' · ') || '—'), h('td', { class: 'small' }, r.authorization.status === 'desconocida' ? '—' : `${r.authorization.status}: ${r.authorization.evidence}`), h('td', null, h('span', { class: r.dataKind === 'simulado' ? 'badge warnb' : 'badge none' }, r.dataKind)), h('td', { class: 'small' }, r.history.length ? `${r.history.length} cambio(s)` : '—', r.voided ? h('div', { class: 'error' }, `Anulado: ${r.voided.reason}`) : null), h('td', null, r.voided ? null : h('span', { class: 'inline' }, h('button', { type: 'button', onclick: () => { editing = editing === r.id ? null : r.id; renderInventory(); } }, editing === r.id ? 'Cerrar' : 'Editar'), h('button', { type: 'button', onclick: () => nav.toInvestigator(r.freqHz) }, 'Investigar'), h('button', { type: 'button', class: 'danger', onclick: () => { const why = prompt('Motivo de la anulación (el registro se conserva):', ''); if (!why)
                    return; const e = nat.mutate((d) => voidRecord(d, r.id, why), ['records']); if (e.length)
                    toast(e[0], 'error'); } }, 'Anular'))));
            const extra = [];
            if (editing === r.id)
                extra.push(h('tr', { class: 'expand' }, h('td', { colspan: '11' }, recordForm(r, (inp, why) => {
                    const e = nat.mutate((d) => updateRecord(d, r.id, inp, why), ['records']);
                    if (e.length)
                        toast(e[0], 'error');
                    else {
                        editing = null;
                        toast('Registro actualizado; el valor anterior queda en el historial.', 'ok');
                    }
                }), r.history.length ? h('ul', { class: 'small' }, ...r.history.map((x) => h('li', null, `${x.ts} — ${x.reason}: ${Object.entries(x.changes).map(([k, [a, b]]) => `${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`).join('; ')}`))) : null)));
            return [row, ...extra];
        })))) : h('p', { class: 'empty' }, 'Sin registros con estos filtros.'));
    }
    async function pickImport() {
        const file = await pickFile('.csv,.tsv,.txt,.xlsx,.json');
        if (!file)
            return;
        try {
            let rows;
            let fromXlsx = false;
            let bytes;
            if (/\.json$/i.test(file.name)) {
                const text = await file.text();
                bytes = new TextEncoder().encode(text);
                const j = jsonToRows(text);
                if (j.error)
                    throw new Error(j.error);
                rows = j.rows;
            }
            else {
                const f = await readTableFile(file);
                rows = f.rows;
                fromXlsx = f.fromXlsx;
                bytes = f.bytes;
            }
            const res = importObservations(rows, { stations: nat.db.stations, defaultStationId: stationId, dataKind: 'real', sourceId: null, fromXlsx });
            const byStation = new Map();
            res.inputs.forEach((i) => byStation.set(i.stationId, (byStation.get(i.stationId) ?? 0) + 1));
            const report = h('div', { class: 'import-report' }, h('p', null, `${file.name}: ${res.inputs.length} registros válidos de ${res.totalRows} filas; ${res.errors.length} rechazadas. Unidad ${res.freqUnit}. Columnas: ${Object.entries(res.columns).map(([k, v]) => `${k}→${v + 1}`).join(', ')}.`), h('p', null, 'Por estación: ' + [...byStation.entries()].map(([k, v]) => `${nat.stationName(k)}: ${v}`).join(' · ')), res.errors.length ? h('details', { open: true }, h('summary', null, `Filas rechazadas (${res.errors.length})`), h('ul', null, ...res.errors.slice(0, 200).map((e) => h('li', null, `Fila ${e.row}: ${e.message}`)))) : null, res.warnings.length ? h('details', null, h('summary', null, `Advertencias (${res.warnings.length})`), h('ul', null, ...res.warnings.slice(0, 200).map((e) => h('li', null, (e.row ? `Fila ${e.row}: ` : '') + e.message)))) : null);
            preview = { inputs: res.inputs, report, sourceName: file.name, sha: sha256Hex(bytes), bytes: bytes.length };
            renderImport();
        }
        catch (e) {
            toast(e.message, 'error');
        }
    }
    function renderImport() {
        mount(imp, h('h3', null, 'Importación masiva (CSV, Excel o JSON)'), h('p', { class: 'hint' }, 'Admite exportaciones de SCORPIO u otros analizadores. Si el archivo trae una columna «Estación», cada fila va a su estación; si no, a la estación seleccionada. Primero se muestra una vista previa; nada se guarda hasta confirmar.'), h('div', { class: 'toolbar' }, h('button', { type: 'button', onclick: () => pickImport() }, 'Elegir archivo…')), preview ? h('div', null, preview.report, h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'primary', disabled: !preview.inputs.length, onclick: () => {
                const pv = preview;
                const rep = nat.mutate((d) => {
                    const src = addSource(d, { name: pv.sourceName, kind: 'archivo', sha256: pv.sha, bytes: pv.bytes, importedAt: new Date().toISOString(), notes: '' });
                    return addRecords(d, pv.inputs.map((i) => ({ ...i, sourceId: src.id })), `importación de ${pv.sourceName}`);
                }, ['records', 'sources']);
                preview = null;
                toast(`Importados ${rep.added.length}; duplicados exactos omitidos ${rep.duplicates.length}; rechazados ${rep.rejected.length}; repetidos en otras fechas (conservados) ${rep.repeatedAcrossDates}.`, 'ok');
            } }, `Confirmar importación de ${preview.inputs.length} registros`), h('button', { type: 'button', onclick: () => { preview = null; renderImport(); } }, 'Descartar'))) : null);
    }
    function renderSweeps() {
        const ws = nat.db.sweeps.filter((w) => w.stationId === stationId);
        mount(sweeps, h('h3', null, 'Barridos espectrales'), h('p', { class: 'hint' }, 'Solo los barridos importados se dibujan como trazas con niveles reales; los registros de frecuencia se muestran como marcadores.'), h('div', { class: 'toolbar' }, h('button', { type: 'button', onclick: async () => {
                const file = await pickFile('.csv,.tsv,.txt,.xlsx');
                if (!file)
                    return;
                try {
                    const f = await readTableFile(file);
                    const t = importTrace(f.rows);
                    if (t.points.length < 2)
                        throw new Error(t.errors.map((e) => e.message).join(' ') || 'Traza vacía');
                    nat.mutate((d) => { const src = addSource(d, { name: f.name, kind: 'archivo', sha256: sha256Hex(f.bytes), bytes: f.bytes.length, importedAt: new Date().toISOString(), notes: 'barrido' }); addSweep(d, { stationId, datetime: new Date().toISOString(), name: f.name, points: t.points, sourceId: src.id, dataKind: 'real' }); }, ['sweeps', 'sources']);
                    toast(`Barrido importado: ${t.points.length} puntos.`, 'ok');
                }
                catch (e) {
                    toast(e.message, 'error');
                }
            } }, 'Importar barrido…')), ws.length ? h('ul', null, ...ws.map((w) => h('li', null, `${w.name}: ${w.points.length} puntos, ${formatMHz(w.points[0].hz, 3)}–${formatMHz(w.points[w.points.length - 1].hz, 3)} MHz (${w.datetime.slice(0, 16)})`))) : h('p', { class: 'empty' }, 'Sin barridos.'));
    }
    async function runAnalysis() {
        running = true;
        renderAnalysis();
        try {
            const sa = await runScope(scope(), nat.db.settings.params, opts).promise;
            panel.selectedGroup = null;
            toast(sa.run.meta.complete ? `Análisis exhaustivo: ${sa.audit.hypotheses.length} hipótesis con señal observada.` : 'Análisis INCOMPLETO: revise los límites.', sa.run.meta.complete ? 'ok' : 'error');
        }
        catch (e) {
            toast(e.message, 'error');
        }
        running = false;
        render();
    }
    function renderCoexistence(sa) {
        if (!sa) {
            mount(coex);
            return;
        }
        const rs = sa.run.result;
        mount(coex, h('h4', null, 'Hipótesis con señal observada'), sa.audit.hypotheses.length ? h('table', { class: 'data compact' }, h('thead', null, h('tr', null, ...['Señal (MHz)', 'Producto (MHz)', 'Δ (kHz)', 'Orden', 'Fórmula', 'Coexistencia documentada', 'Clase', ''].map((t) => h('th', null, t)))), h('tbody', null, ...sa.audit.hypotheses.map((x) => {
            const co = sa.coexist.get(`${x.observedId}|${x.key}`) ?? [];
            return h('tr', null, h('td', { class: 'num' }, formatMHz(x.observedHz, 3)), h('td', { class: 'num' }, formatMHz(x.calcHz, 3)), h('td', { class: 'num' }, formatKHz(x.diffHz)), h('td', null, orderLabel(rs.store, x.combo)), h('td', { class: 'formula' }, formulaNumeric(rs, x.combo)), h('td', null, co.length ? co.map((s) => nat.stationName(s)).join(', ') : 'ninguna'), h('td', null, classBadge(x.classification.cls)), h('td', null, h('button', { type: 'button', onclick: () => nav.toInvestigator(x.observedHz) }, 'Investigar')));
        }))) : h('p', { class: 'hint' }, 'Ninguna señal observada coincide con productos calculados.'), h('p', { class: 'hint' }, `Clases: A ${CLASS_LABEL.A}, B ${CLASS_LABEL.B}, C ${CLASS_LABEL.C}, D ${CLASS_LABEL.D}. Las evidencias se registran en «Auditoría espectral» (botón inferior) o en el «Laboratorio RF», y se guardan en la base nacional con la clave ${observedKey(stationId, 0).replace(/0$/, '<frecuencia>')}.`));
    }
    function renderAnalysis() {
        const latest = nat.latest(scope());
        form.refresh();
        mount(anal, h('h3', null, 'Intermodulación de la estación'), h('p', { class: 'hint' }, 'Generadoras: portadoras confirmadas de la estación (una por frecuencia). Señales a explicar: observadas sin identificar, sospechosas y reportadas.'), scopeOptionsControls(opts, (o) => { opts = o; renderAnalysis(); }), form.root, h('div', { class: 'toolbar wrap' }, h('button', { type: 'button', class: 'primary', disabled: running, onclick: () => runAnalysis() }, running ? 'Calculando…' : 'Recalcular productos'), latest ? h('button', { type: 'button', onclick: () => download(`orbe-im-hallazgos-${stationId}-${stamp()}.md`, findingsReport(nat.db, latest.sa), 'text/markdown;charset=utf-8') }, 'Informe de hallazgos (.md)') : null, latest ? h('button', { type: 'button', onclick: () => { nat.mutate((d) => { d.analyses.push(snapshotOf(latest.sa)); d.audit.push({ id: `a${Date.now().toString(36)}`, ts: new Date().toISOString(), action: 'análisis', entity: 'estacion', entityId: stationId, detail: 'instantánea guardada' }); }, ['analyses']); toast('Instantánea del análisis guardada en la base.', 'ok'); } }, 'Guardar instantánea') : null, latest ? h('button', { type: 'button', onclick: () => { openInClassic(latest.sa); nav.toClassic(); } }, 'Abrir en Auditoría espectral (evidencias A–D)') : null), latest?.sa.inputs.notes.length ? h('div', { class: 'banner warn' }, ...latest.sa.inputs.notes.map((n) => h('div', null, n))) : null, coex);
        renderCoexistence(latest?.sa ?? null);
    }
    function render() {
        if (!nat.ready) {
            mount(root, h('p', { class: 'hint' }, 'Cargando la base nacional…'));
            return;
        }
        if (!root.contains(head))
            mount(root, head, ficha, inv, imp, sweeps, anal, panel.root);
        renderHead();
        renderFicha();
        renderInventory();
        renderImport();
        renderSweeps();
        renderAnalysis();
        panel.refresh();
    }
    return { render, select: (id) => { stationId = id; editing = null; preview = null; } };
}
