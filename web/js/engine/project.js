/**
 * Proyecto: todo lo que introduce el usuario (no los productos, que se
 * recalculan). Se guarda en el almacenamiento local del navegador y se
 * exporta/importa como JSON.
 */
import { FM_BAND } from './model.js';
import { DEFAULT_PARAMS } from './analysis.js';
export const PROJECT_SCHEMA = 'orbe-im-analyzer/proyecto@1';
export function emptyProject(name = 'Proyecto sin nombre', now = new Date()) {
    return {
        schema: PROJECT_SCHEMA,
        name,
        created: now.toISOString(),
        modified: now.toISOString(),
        transmitters: [],
        selectedIds: [],
        observed: [],
        trace: null,
        params: { ...DEFAULT_PARAMS, band: { ...FM_BAND } },
        evidence: [],
        confirmations: [],
        labTests: [],
        sources: [],
    };
}
const CLASSES = ['portadora_confirmada', 'senal_observada', 'sospechosa', 'desconocida'];
function checkSignal(s, where, errs) {
    const o = s;
    if (!o || typeof o !== 'object') {
        errs.push(`${where}: no es un objeto.`);
        return false;
    }
    if (typeof o.id !== 'string' || !o.id) {
        errs.push(`${where}: falta «id».`);
        return false;
    }
    if (!Number.isSafeInteger(o.freqHz) || o.freqHz <= 0) {
        errs.push(`${where}: «freqHz» debe ser un entero positivo (Hz).`);
        return false;
    }
    if (o.classification !== undefined && !CLASSES.includes(o.classification)) {
        errs.push(`${where}: clasificación desconocida «${String(o.classification)}».`);
        return false;
    }
    return true;
}
function normSignal(o) {
    return {
        id: o.id,
        freqHz: o.freqHz,
        label: String(o.label ?? ''),
        levelDbm: typeof o.levelDbm === 'number' && Number.isFinite(o.levelDbm) ? o.levelDbm : null,
        levelRaw: o.levelRaw,
        datetime: String(o.datetime ?? ''),
        equipment: String(o.equipment ?? ''),
        notes: String(o.notes ?? ''),
        classification: o.classification ?? 'desconocida',
        source: String(o.source ?? 'proyecto'),
    };
}
function checkBand(b) {
    const o = b;
    return !!o && Number.isSafeInteger(o.minHz) && Number.isSafeInteger(o.maxHz) && o.maxHz > o.minHz;
}
/**
 * Valida y normaliza un proyecto procedente de JSON (admite también el JSON
 * de análisis exportado, que contiene el proyecto en la clave «proyecto»).
 */
export function parseProject(text) {
    const errs = [];
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (e) {
        return { project: null, errors: ['JSON mal formado: ' + e.message], isAnalysisExport: false, embedded: null };
    }
    let obj = data;
    let isAnalysisExport = false;
    if (obj && typeof obj === 'object' && obj.schema === 'orbe-im-analyzer/analisis@1' && obj.proyecto) {
        obj = obj.proyecto;
        isAnalysisExport = true;
    }
    if (!obj || typeof obj !== 'object' || obj.schema !== PROJECT_SCHEMA)
        return { project: null, errors: ['No es un proyecto de Orbe IM Analyzer (falta «schema»: «' + PROJECT_SCHEMA + '»).'], isAnalysisExport, embedded: data };
    const tx = Array.isArray(obj.transmitters) ? obj.transmitters : (errs.push('Falta la lista «transmitters».'), []);
    const ob = Array.isArray(obj.observed) ? obj.observed : [];
    const transmitters = tx.filter((s, i) => checkSignal(s, `transmitters[${i}]`, errs)).map((s) => normSignal(s));
    const observed = ob.filter((s, i) => checkSignal(s, `observed[${i}]`, errs)).map((s) => normSignal(s));
    const p = { ...DEFAULT_PARAMS, ...(obj.params ?? {}) };
    if (!checkBand(p.band)) {
        errs.push('Banda no válida en «params.band».');
        p.band = { ...FM_BAND };
    }
    if (!Number.isInteger(p.maxOrder) || p.maxOrder < 2 || p.maxOrder > 99) {
        errs.push('«params.maxOrder» no válido.');
        p.maxOrder = DEFAULT_PARAMS.maxOrder;
    }
    if (!Number.isInteger(p.maxTones) || p.maxTones < 1) {
        errs.push('«params.maxTones» no válido.');
        p.maxTones = DEFAULT_PARAMS.maxTones;
    }
    if (!Number.isSafeInteger(p.toleranceHz) || p.toleranceHz < 0) {
        errs.push('«params.toleranceHz» no válido.');
        p.toleranceHz = DEFAULT_PARAMS.toleranceHz;
    }
    const ids = new Set(transmitters.map((t) => t.id));
    if (ids.size !== transmitters.length)
        errs.push('Hay identificadores de transmisor repetidos.');
    const project = {
        schema: PROJECT_SCHEMA,
        name: String(obj.name ?? 'Proyecto importado'),
        created: String(obj.created ?? new Date().toISOString()),
        modified: String(obj.modified ?? new Date().toISOString()),
        transmitters,
        selectedIds: Array.isArray(obj.selectedIds) ? obj.selectedIds.filter((i) => ids.has(i)) : transmitters.map((t) => t.id),
        observed,
        trace: obj.trace ?? null,
        params: p,
        evidence: Array.isArray(obj.evidence) ? obj.evidence : [],
        confirmations: Array.isArray(obj.confirmations) ? obj.confirmations : [],
        labTests: Array.isArray(obj.labTests) ? obj.labTests : [],
        sources: Array.isArray(obj.sources) ? obj.sources : [],
    };
    return { project, errors: errs, isAnalysisExport, embedded: data };
}
export function selectedGenerators(p) {
    const sel = new Set(p.selectedIds);
    return p.transmitters.filter((t) => sel.has(t.id)).sort((a, b) => a.freqHz - b.freqHz || (a.id < b.id ? -1 : 1));
}
