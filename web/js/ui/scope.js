/** Utilidades compartidas por las vistas nacionales: ámbito, análisis asíncrono y puente con las secciones existentes. */
import { auditScope, buildScopeInputs, emptyProject, estimateSearchSpace, formatBig, scopeLabel } from '../engine/index.js';
import { computeAsync } from './compute.js';
import { h, select } from './dom.js';
import { nat } from './natstore.js';
import { store } from './state.js';
export function scopeValue(s) {
    return s.kind === 'estacion' ? `e:${s.stationId}` : s.kind === 'region' ? `r:${s.regionId}` : s.kind === 'estaciones' ? `m:${s.stationIds.join(',')}` : 'n';
}
export function parseScopeValue(v) {
    if (v.startsWith('e:'))
        return { kind: 'estacion', stationId: v.slice(2) };
    if (v.startsWith('r:'))
        return { kind: 'region', regionId: v.slice(2) };
    if (v.startsWith('m:'))
        return { kind: 'estaciones', stationIds: v.slice(2).split(',') };
    return { kind: 'nacional' };
}
export function scopeSelect(value, onChange, label = 'Ámbito') {
    const db = nat.db;
    return h('label', { class: 'field inline-field' }, h('span', { class: 'field-label' }, label), select([
        { value: 'n', label: 'Nacional (todas las estaciones)' },
        ...db.regions.map((r) => ({ value: `r:${r.id}`, label: `Región: ${r.name}` })),
        ...db.stations.map((s) => ({ value: `e:${s.id}`, label: `Estación ${s.id}: ${s.operationalName}` })),
    ], scopeValue(value), (v) => onChange(parseScopeValue(v)), { 'aria-label': label }));
}
export function scopeOptionsControls(o, onChange) {
    const db = nat.db;
    const cur = { includeSimulated: o.includeSimulated ?? db.settings.includeSimulated, unidentifiedAsGenerators: o.unidentifiedAsGenerators ?? db.settings.unidentifiedAsGenerators, includeAssignedAsGenerators: o.includeAssignedAsGenerators ?? db.settings.includeAssignedAsGenerators };
    const box = (k, text) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!cur[k], onchange: (e) => onChange({ ...cur, [k]: e.target.checked }) }), text);
    return h('div', { class: 'inline wrap-gap' }, box('includeSimulated', 'incluir datos simulados'), box('unidentifiedAsGenerators', 'usar señales no identificadas como generadoras'), box('includeAssignedAsGenerators', 'usar frecuencias asignadas (no observadas) como generadoras'));
}
/** Calcula el análisis de un ámbito en el Web Worker y lo audita (coexistencia incluida). */
export function runScope(scope, params = nat.db.settings.params, o = {}, onProgress) {
    const inputs = buildScopeInputs(nat.db, scope, o);
    const est = estimateSearchSpace({ nGenerators: inputs.generators.length, maxOrder: params.maxOrder, maxTones: params.maxTones, minOrder: params.minOrder, includeHarmonics: params.includeHarmonics });
    if (!inputs.generators.length) {
        return { promise: Promise.reject(new Error(`No hay generadoras en «${scopeLabel(nat.db, scope)}»: registre portadoras confirmadas o active otras opciones.`)), cancel: () => undefined, estimate: '0' };
    }
    const version = nat.version;
    const job = computeAsync(inputs.generators, params, (p) => onProgress?.(`Nodos: ${formatBig(BigInt(p.visited))} · combinaciones: ${formatBig(BigInt(p.combos))}`));
    const promise = job.promise.then((run) => {
        const sa = auditScope(nat.db, inputs, run, params.toleranceHz);
        if (version === nat.version)
            nat.remember(scope, sa);
        return sa;
    });
    return { promise, cancel: job.cancel, estimate: formatBig(est.workBound) };
}
// ------------------------------------------------------------------ puente con Auditoría espectral / Laboratorio RF
let linked = false;
/** Carga un análisis nacional en las secciones clásicas (Auditoría espectral, Laboratorio RF). */
export function openInClassic(sa) {
    const p = emptyProject(`Base nacional — ${sa.inputs.label}`);
    p.transmitters = sa.inputs.generators;
    p.selectedIds = sa.inputs.generators.map((g) => g.id);
    p.observed = sa.inputs.observed;
    p.params = sa.run.params;
    p.evidence = [...nat.db.evidence];
    p.confirmations = [...nat.db.confirmations];
    p.labTests = [...nat.db.labTests];
    linked = true;
    store.replaceProject(p);
    store.setRun(sa.run);
}
/** Sincroniza hacia la base nacional las evidencias, confirmaciones y pruebas creadas en las secciones clásicas. */
export function installClassicSync() {
    store.on(() => {
        if (!linked || !store.project.name.startsWith('Base nacional'))
            return;
        const p = store.project;
        const db = nat.db;
        const evIds = new Set(db.evidence.map((e) => e.id));
        const newEv = p.evidence.filter((e) => !evIds.has(e.id));
        const confKey = (c) => `${c.observedId}|${c.hypothesisKey}`;
        const dbConf = new Map(db.confirmations.map((c) => [confKey(c), JSON.stringify(c)]));
        const confChanged = p.confirmations.length !== db.confirmations.length || p.confirmations.some((c) => dbConf.get(confKey(c)) !== JSON.stringify(c));
        const labIds = new Map(db.labTests.map((t) => [t.id, JSON.stringify(t)]));
        const labChanged = p.labTests.length !== db.labTests.length || p.labTests.some((t) => labIds.get(t.id) !== JSON.stringify(t));
        const evRemoved = db.evidence.some((e) => !p.evidence.some((x) => x.id === e.id));
        if (!newEv.length && !confChanged && !labChanged && !evRemoved)
            return;
        nat.mutate((d) => {
            d.evidence = [...p.evidence];
            d.confirmations = [...p.confirmations];
            d.labTests = [...p.labTests];
            d.audit.push({ id: `a${Date.now().toString(36)}`, ts: new Date().toISOString(), action: 'sincronización', entity: 'evidencias', entityId: p.name, detail: `${newEv.length} evidencias nuevas desde Auditoría espectral / Laboratorio RF` });
        }, ['evidence', 'confirmations', 'labTests']);
    });
}
