/**
 * Análisis por ámbito (estación, región, nacional, varias estaciones) sobre
 * el motor de vectores enteros existente, sin modificarlo.
 *
 * Plausibilidad física: una combinación es matemáticamente posible con
 * cualquier conjunto de frecuencias, pero solo es físicamente plausible que
 * se forme en un receptor (o en un mismo sistema no lineal) si las señales
 * generadoras coexisten allí. El programa indica en qué estaciones se
 * registraron TODAS las generadoras de cada combinación («coexistencia
 * documentada»). Sin coexistencia documentada, la hipótesis es exploratoria.
 * La ausencia de un registro no prueba la ausencia de la señal.
 */
import { audit, completenessStatement, runAnalysis } from './analysis.js';
import { CLASS_LABEL } from './classify.js';
import { comboTerms } from './enumerate.js';
import { formatKHz, formatMHz } from './freq.js';
import { makeSignal, newId } from './model.js';
import { RECORD_STATUS_LABEL, activeRecords, isObservation, recordsOfScope, scopeLabel, stationsOfScope } from './national.js';
import { formulaNumeric, formulaSymbolic, groupCombos, groupsNear, orderLabel } from './results.js';
import { LIMITATIONS } from './export.js';
export function levelToDbm(value, unit) {
    if (value === null || !Number.isFinite(value))
        return null;
    if (unit === 'dBm' || unit === '')
        return unit === '' ? null : value;
    if (unit === 'dBµV')
        return Math.round((value - 107) * 1000) / 1000;
    return null;
}
/** Identificador estable de una señal observada: estación + frecuencia. */
export function observedKey(stationId, freqHz) {
    return `O${stationId}:${freqHz}`;
}
export function stationOfObservedKey(key) {
    const m = /^O([^:]+):\d+$/.exec(key);
    return m ? m[1] : null;
}
export function generatorKey(freqHz) {
    return `F${freqHz}`;
}
export function buildScopeInputs(db, scope, o = {}) {
    const includeSimulated = o.includeSimulated ?? db.settings.includeSimulated;
    const unid = o.unidentifiedAsGenerators ?? db.settings.unidentifiedAsGenerators;
    const assigned = o.includeAssignedAsGenerators ?? db.settings.includeAssignedAsGenerators;
    const recs = recordsOfScope(db, scope, { includeSimulated });
    const freqStations = new Map();
    for (const r of recs)
        if (isObservation(r.status)) {
            const s = freqStations.get(r.freqHz) ?? new Set();
            s.add(r.stationId);
            freqStations.set(r.freqHz, s);
        }
    const recordsOf = new Map();
    const push = (k, r) => { const a = recordsOf.get(k) ?? []; a.push(r); recordsOf.set(k, a); };
    // generadoras: una por frecuencia
    const genByFreq = new Map();
    for (const r of recs) {
        const isGen = r.status === 'portadora_confirmada' || (unid && r.status === 'observada_sin_identificar') || (assigned && r.status === 'asignada_oficialmente');
        if (!isGen)
            continue;
        const a = genByFreq.get(r.freqHz) ?? [];
        a.push(r);
        genByFreq.set(r.freqHz, a);
    }
    const stationName = (id) => db.stations.find((s) => s.id === id)?.name ?? id;
    const generators = [...genByFreq.entries()].sort((a, b) => a[0] - b[0]).map(([f, rs]) => {
        const k = generatorKey(f);
        rs.forEach((r) => push(k, r));
        const cls = rs.some((r) => r.status === 'portadora_confirmada') ? 'portadora_confirmada' : rs.some((r) => r.status === 'observada_sin_identificar') ? 'senal_observada' : 'desconocida';
        const names = [...new Set(rs.map((r) => r.emisora).filter(Boolean))].join(' / ');
        const sts = [...new Set(rs.map((r) => stationName(r.stationId)))].join(', ');
        const onlyAssigned = rs.every((r) => r.status === 'asignada_oficialmente');
        const lv = rs.map((r) => levelToDbm(r.levelValue, r.levelUnit)).filter((x) => x !== null);
        return makeSignal(f, { id: k, label: `${names || 'sin identificar'}${onlyAssigned ? ' [asignada, no observada]' : ''} · ${sts}`, classification: cls, levelDbm: lv.length ? Math.max(...lv) : null, source: 'base nacional' });
    });
    // señales a explicar: una por estación y frecuencia
    const obsBy = new Map();
    for (const r of recs) {
        if (!(r.status === 'observada_sin_identificar' || r.status === 'sospechosa_im' || r.status === 'reportada_pendiente'))
            continue;
        const k = observedKey(r.stationId, r.freqHz);
        const a = obsBy.get(k) ?? [];
        a.push(r);
        obsBy.set(k, a);
    }
    const observed = [...obsBy.entries()].map(([k, rs]) => {
        rs.forEach((r) => push(k, r));
        rs.sort((a, b) => (a.datetime < b.datetime ? 1 : -1));
        const last = rs[0];
        const reported = rs.every((r) => r.status === 'reportada_pendiente');
        const cls = rs.some((r) => r.status === 'sospechosa_im') ? 'sospechosa' : reported ? 'desconocida' : 'senal_observada';
        return makeSignal(last.freqHz, {
            id: k, label: `${stationName(last.stationId)}${reported ? ' [reportada, sin verificar]' : ''}${rs.length > 1 ? ` · ${rs.length} registros` : ''}`,
            classification: cls, levelDbm: levelToDbm(last.levelValue, last.levelUnit), datetime: last.datetime, equipment: `Estación ${last.stationId}`, source: 'base nacional',
        });
    }).sort((a, b) => a.freqHz - b.freqHz || (a.id < b.id ? -1 : 1));
    const notes = [];
    const st = stationsOfScope(db, scope);
    if (st.length > 1)
        notes.push('Ámbito con varias estaciones: las combinaciones entre señales registradas en estaciones distintas son matemáticamente posibles, pero no necesariamente plausibles físicamente. Se indica la coexistencia documentada de cada hipótesis. El análisis es exploratorio.');
    const includesSimulated = recs.some((r) => r.dataKind === 'simulado');
    if (includesSimulated)
        notes.push('ATENCIÓN: el análisis incluye datos SIMULADOS (ejemplos), que no son mediciones reales.');
    if (assigned)
        notes.push('Se incluyen frecuencias asignadas oficialmente como generadoras hipotéticas: una asignación no prueba que la señal se reciba.');
    if (unid)
        notes.push('Se incluyen señales no identificadas como posibles generadoras.');
    return { scope, label: scopeLabel(db, scope), generators, observed, freqStations, recordsOf, includesSimulated, notes };
}
/** Estaciones en las que se registraron TODAS las generadoras de la combinación. */
export function coexistence(inputs, run, combo) {
    const terms = comboTerms(run.result.store, combo);
    let inter = null;
    for (const t of terms) {
        const s = inputs.freqStations.get(run.generators[t.index].freqHz) ?? new Set();
        inter = inter === null ? [...s] : inter.filter((x) => s.has(x));
    }
    return inter ? [...inter].sort() : [];
}
export function generatorStations(inputs, run, combo) {
    return comboTerms(run.result.store, combo).map((t) => {
        const f = run.generators[t.index].freqHz;
        return { freqHz: f, coef: t.coef, stations: [...(inputs.freqStations.get(f) ?? [])].sort() };
    });
}
export function auditScope(db, inputs, run, tolHz) {
    const au = audit(run, inputs.observed, tolHz, db.evidence, db.confirmations, inputs.generators);
    const coexist = new Map();
    for (const h of au.hypotheses)
        coexist.set(`${h.observedId}|${h.key}`, coexistence(inputs, run, h.combo));
    return { inputs, run, audit: au, coexist };
}
export function analyzeScope(db, scope, params = db.settings.params, o = {}) {
    const inputs = buildScopeInputs(db, scope, o);
    if (!inputs.generators.length)
        throw new Error(`No hay generadoras en el ámbito «${inputs.label}» (se necesitan portadoras confirmadas o activar otras opciones).`);
    const run = runAnalysis(inputs.generators, params);
    return auditScope(db, inputs, run, params.toleranceHz);
}
export function snapshotOf(sa) {
    return {
        id: newId('an'),
        ts: sa.run.meta.analysisDate,
        scope: sa.inputs.scope,
        params: sa.run.params,
        complete: sa.run.meta.complete,
        statement: completenessStatement(sa.run.meta),
        generators: sa.run.generators.length,
        products: sa.run.result.groupCount,
        combos: sa.run.result.store.count,
        includesSimulated: sa.inputs.includesSimulated,
        hypotheses: sa.audit.hypotheses.map((h) => ({ observedId: h.observedId, key: h.key, calcHz: h.calcHz, diffHz: h.diffHz, cls: h.classification.cls, coexist: sa.coexist.get(`${h.observedId}|${h.key}`) ?? [] })),
    };
}
export const MECHANISM_HINT_LABEL = {
    im_transmisor: 'Intermodulación en el transmisor',
    im_receptor: 'Intermodulación en el receptor de la estación',
    pim: 'Intermodulación pasiva (PIM)',
    armonico: 'Armónico',
    sistemas_compartidos: 'Mezcla en sistemas compartidos (combinadores, antenas o estructuras comunes)',
    espuria: 'Otra respuesta espuria (imagen, frecuencia intermedia, oscilador local)',
    independiente: 'Señal independiente que coincide por azar',
};
export function mechanismHints(run, combo, coexist, observingStation) {
    const s = run.result.store;
    const tones = s.tones[combo];
    const out = [];
    if (tones === 1) {
        out.push({ id: 'armonico', status: 'compatible', why: `Producto de un solo generador (${orderLabel(s, combo)}).`, measurements: ['Medir cerca del transmisor y verificar su filtro de armónicos.', 'Prueba de atenuación en la estación (un armónico generado en el receptor baja n dB por dB).'] });
    }
    else {
        out.push({ id: 'armonico', status: 'no_aplica', why: 'Intervienen varios generadores.', measurements: [] });
        const atObs = observingStation !== null && coexist.includes(observingStation);
        out.push({
            id: 'im_receptor',
            status: atObs ? 'compatible' : 'requiere_datos',
            why: atObs ? 'Todas las generadoras se registraron en la estación que observó la señal.' : 'No consta que todas las generadoras se reciban en la estación que observó la señal (la falta de registro no prueba su ausencia).',
            measurements: ['Prueba de atenuación en el Laboratorio RF (pendiente Σ|mᵢ| frente a 1 dB/dB).', 'Repetir con el preamplificador desactivado o con un filtro de banda.', 'Registrar las generadoras en esa estación con niveles y fecha.'],
        });
        out.push({ id: 'im_transmisor', status: 'requiere_datos', why: 'Exige que los transmisores generadores compartan emplazamiento o estén acoplados; la base no contiene sus ubicaciones verificadas.', measurements: ['Verificar si los transmisores comparten sitio, torre o combinador.', 'Medir en las proximidades del emplazamiento de los transmisores.', 'Coordinar el apagado breve de un generador y comprobar si el producto desaparece.'] });
        out.push({ id: 'pim', status: 'requiere_datos', why: 'Requiere estructuras metálicas, conectores o antenas con no linealidad y señales de potencia suficiente en el mismo lugar.', measurements: ['Radiogoniometría (dirección de llegada) de la señal.', 'Comprobar variación con viento, lluvia o temperatura.', 'Inspección de conectores y estructuras del sitio sospechoso.'] });
        out.push({ id: 'sistemas_compartidos', status: 'requiere_datos', why: 'Posible si los generadores comparten combinador, multiplexor o antena.', measurements: ['Inventario de sistemas coubicados.', 'Revisar aisladores y combinadores; medir a la salida del sistema compartido.'] });
    }
    out.push({ id: 'espuria', status: 'requiere_datos', why: 'Una imagen u otra respuesta del receptor puede aparecer en la misma frecuencia.', measurements: ['Indicar la frecuencia intermedia del receptor en el Laboratorio RF para evaluar imagen y media FI.', 'Medir la misma frecuencia desde otra estación o con otro receptor.'] });
    out.push({ id: 'independiente', status: 'compatible', why: 'Siempre posible mientras no se identifique la emisión.', measurements: ['Demodular e identificar el contenido (audio, RDS, indicativo).', 'Correlacionar la modulación con la de las generadoras.', 'Radiogoniometría desde dos estaciones.'] });
    return out;
}
/**
 * Investiga una frecuencia a partir de un cálculo cuyo intervalo de salida es
 * [f − tol, f + tol] (rápido gracias a la poda del motor).
 */
export function investigationFromRun(db, inputs, run, freqHz, tolHz) {
    const stationName = (id) => db.stations.find((s) => s.id === id)?.name ?? id;
    const observations = activeRecords(db).filter((r) => Math.abs(r.freqHz - freqHz) <= tolHz).map((r) => ({ record: r, diffHz: r.freqHz - freqHz, stationName: stationName(r.stationId) }))
        .sort((a, b) => Math.abs(a.diffHz) - Math.abs(b.diffHz));
    const observingStations = [...new Set(observations.filter((o) => isObservation(o.record.status)).map((o) => o.record.stationId))];
    const rs = run.result;
    const au = audit(run, inputs.observed.filter((o) => Math.abs(o.freqHz - freqHz) <= tolHz), tolHz, db.evidence, db.confirmations, inputs.generators);
    const hyps = [];
    for (const g of groupsNear(rs, freqHz, tolHz)) {
        for (const c of groupCombos(rs, g)) {
            const coex = coexistence(inputs, run, c);
            const obsCo = observingStations.filter((s) => coex.includes(s));
            hyps.push({
                combo: c, calcHz: rs.groupFreq[g], diffHz: freqHz - rs.groupFreq[g], order: orderLabel(rs.store, c), formula: formulaNumeric(rs, c), symbolic: formulaSymbolic(rs, c), tones: rs.store.tones[c],
                generators: generatorStations(inputs, run, c), coexist: coex, observingStationsWithCoexistence: obsCo,
                mechanisms: mechanismHints(run, c, coex, obsCo[0] ?? observingStations[0] ?? null),
                classes: au.hypotheses.filter((h) => h.combo === c).map((h) => ({ observedId: h.observedId, cls: h.classification.cls })),
            });
        }
    }
    hyps.sort((a, b) => b.observingStationsWithCoexistence.length - a.observingStationsWithCoexistence.length || rs.store.order[a.combo] - rs.store.order[b.combo] || Math.abs(a.diffHz) - Math.abs(b.diffHz));
    const needed = new Set();
    if (!observations.length)
        needed.add('Registrar si la frecuencia se observa realmente en alguna estación (fecha, nivel, ancho de banda).');
    if (hyps.length > 1)
        needed.add(`Hay ${hyps.length} combinaciones compatibles: para distinguirlas, apagar o atenuar selectivamente un generador y ver qué producto desaparece, o comparar la pendiente de atenuación (depende de Σ|mᵢ| y de qué generador se atenúa).`);
    if (hyps.some((h) => !h.coexist.length))
        needed.add('Varias hipótesis no tienen coexistencia documentada de sus generadoras: registrar esas frecuencias en la estación que observa la señal.');
    for (const h of hyps.slice(0, 5))
        for (const m of h.mechanisms)
            if (m.status !== 'no_aplica')
                m.measurements.slice(0, 1).forEach((x) => needed.add(x));
    const notes = [...inputs.notes, 'Una coincidencia numérica no es una atribución causal: la clasificación A/B/C/D se mantiene y la confirmación exige evidencia experimental documentada.'];
    if (!run.meta.complete)
        notes.unshift('BÚSQUEDA INCOMPLETA — NO EXHAUSTIVA: pueden faltar combinaciones.');
    return { freqHz, tolHz, scopeLabel: inputs.label, complete: run.meta.complete, statement: completenessStatement(run.meta), observations, hypotheses: hyps, neededMeasurements: [...needed], notes };
}
export function investigationParams(base, freqHz, tolHz) {
    return { ...base, outputMode: 'personalizado', customRange: { minHz: Math.max(1, freqHz - tolHz), maxHz: freqHz + tolHz }, toleranceHz: tolHz };
}
export function investigateFrequency(db, freqHz, tolHz, scope = { kind: 'nacional' }, params = db.settings.params, o = {}) {
    const inputs = buildScopeInputs(db, scope, o);
    if (!inputs.generators.length)
        throw new Error('No hay generadoras en el ámbito seleccionado.');
    const run = runAnalysis(inputs.generators, investigationParams(params, freqHz, tolHz));
    return investigationFromRun(db, inputs, run, freqHz, tolHz);
}
/** Matriz de presencia: frecuencias (agrupadas dentro de ±tol) frente a estaciones. */
export function compareStations(db, stationIds, tolHz, o = {}) {
    var _a, _b;
    const recs = activeRecords(db, { includeSimulated: o.includeSimulated }).filter((r) => stationIds.includes(r.stationId) && isObservation(r.status)).sort((a, b) => a.freqHz - b.freqHz);
    const rows = [];
    for (const r of recs) {
        let row = rows[rows.length - 1];
        if (!row || r.freqHz - row.freqHz > tolHz) {
            row = { freqHz: r.freqHz, perStation: {}, stations: 0 };
            rows.push(row);
        }
        ((_a = row.perStation)[_b = r.stationId] ?? (_a[_b] = [])).push(r);
    }
    for (const row of rows)
        row.stations = Object.keys(row.perStation).length;
    return rows;
}
// ------------------------------------------------------------------ informe de hallazgos
export function findingsReport(db, sa, now = new Date()) {
    const { inputs, run, audit: au } = sa;
    const rs = run.result;
    const stationName = (id) => db.stations.find((s) => s.id === id)?.name ?? id;
    const L = [];
    L.push(`# Informe de hallazgos — ${inputs.label}`, '');
    L.push(`- Fecha del informe: ${now.toISOString()}`, `- Fecha del cálculo: ${run.meta.analysisDate}`, `- Versión del algoritmo: ${run.meta.algorithmVersion}`);
    L.push(`- Datos: ${inputs.includesSimulated ? '**INCLUYE DATOS SIMULADOS (no son mediciones reales)**' : 'solo registros marcados como reales'}`);
    L.push(`- Parámetros: orden ≤ ${run.params.maxOrder}, ≤ ${run.params.maxTones} generadoras por combinación, tolerancia ±${formatKHz(au.toleranceHz)} kHz, banda ${formatMHz(run.params.band.minHz)}–${formatMHz(run.params.band.maxHz)} MHz`);
    L.push(`- Completitud: **${completenessStatement(run.meta)}**`, '');
    for (const n of inputs.notes)
        L.push(`> ${n}`);
    L.push('', '## Generadoras usadas', '');
    for (const g of inputs.generators)
        L.push(`- ${formatMHz(g.freqHz, 3)} MHz — ${g.label}`);
    L.push('', '## Coincidencias (hipótesis)', '', `Probabilidad de coincidencia fortuita en la banda: ${(au.coverage.all * 100).toFixed(2)} %.`, '');
    L.push('| Señal | Estación | Producto (MHz) | Δ (kHz) | Orden | Fórmula | Coexistencia documentada | Clase |', '|---|---|---|---|---|---|---|---|');
    const byObs = new Map(au.matches.map((m) => [m.observed.id, m.observed]));
    const sorted = [...au.hypotheses].sort((a, b) => a.observedHz - b.observedHz);
    for (const h of sorted) {
        const o = byObs.get(h.observedId);
        const co = sa.coexist.get(`${h.observedId}|${h.key}`) ?? [];
        L.push(`| ${formatMHz(o.freqHz, 3)} | ${stationName(stationOfObservedKey(h.observedId) ?? '')} | ${formatMHz(h.calcHz, 3)} | ${formatKHz(h.diffHz)} | ${orderLabel(rs.store, h.combo)} | ${formulaNumeric(rs, h.combo)} | ${co.length ? co.map(stationName).join(', ') : 'ninguna (exploratoria)'} | ${h.classification.cls} · ${CLASS_LABEL[h.classification.cls]} |`);
    }
    if (!sorted.length)
        L.push('| — | — | — | — | — | — | — | — |');
    L.push('', '## Señales sin explicación dentro del alcance', '');
    for (const u of au.unmatched) {
        const recs = inputs.recordsOf.get(u.observed.id) ?? [];
        L.push(`- ${formatMHz(u.observed.freqHz, 3)} MHz (${stationName(stationOfObservedKey(u.observed.id) ?? '')}; ${recs.map((r) => RECORD_STATUS_LABEL[r.status]).filter((v, i, a) => a.indexOf(v) === i).join(', ')})${u.nearest ? ` — producto más próximo ${formatMHz(u.nearest.freqHz, 3)} MHz (Δ ${formatKHz(u.nearest.diffHz)} kHz)` : ''}`);
    }
    if (!au.unmatched.length)
        L.push('- Ninguna.');
    L.push('', '## Pruebas recomendadas para confirmar o descartar', '');
    const seen = new Set();
    for (const h of sorted.slice(0, 20)) {
        const co = sa.coexist.get(`${h.observedId}|${h.key}`) ?? [];
        const obsSt = stationOfObservedKey(h.observedId);
        for (const m of mechanismHints(run, h.combo, co, obsSt))
            for (const x of m.measurements)
                if (m.status !== 'no_aplica' && !seen.has(x)) {
                    seen.add(x);
                    L.push(`- ${x} (${MECHANISM_HINT_LABEL[m.id]})`);
                }
    }
    if (!seen.size)
        L.push('- No hay hipótesis que verificar.');
    L.push('', '## Limitaciones', '');
    LIMITATIONS.forEach((l, i) => L.push(`${i + 1}. ${l}`));
    L.push(`${LIMITATIONS.length + 1}. La plausibilidad geográfica se basa solo en los registros de la base: que una frecuencia no esté registrada en una estación no prueba que no se reciba allí.`);
    L.push('', 'Criterio: producto matemáticamente posible ≠ señal observada ≠ producto de intermodulación experimentalmente confirmado.');
    return L.join('\n') + '\n';
}
