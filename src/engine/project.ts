/**
 * Proyecto: todo lo que introduce el usuario (no los productos, que se
 * recalculan). Se guarda en el almacenamiento local del navegador y se
 * exporta/importa como JSON.
 */

import type { Band, SignalClass, SignalRecord } from './model.js';
import { FM_BAND } from './model.js';
import type { AnalysisParams } from './analysis.js';
import { DEFAULT_PARAMS } from './analysis.js';
import type { Confirmation, Evidence } from './classify.js';
import type { AttenuationTest } from './lab.js';
import type { TracePoint } from './importers.js';

export const PROJECT_SCHEMA = 'orbe-im-analyzer/proyecto@1';

export interface SourceInfo {
  name: string;
  kind: 'transmisores' | 'observadas' | 'traza' | 'proyecto';
  sha256: string;
  bytes: number;
  importedAt: string;
  rowsAccepted: number;
  rowsRejected: number;
}

export interface Project {
  schema: typeof PROJECT_SCHEMA;
  name: string;
  created: string;
  modified: string;
  transmitters: SignalRecord[];
  /** Identificadores de los transmisores incluidos en el análisis. */
  selectedIds: string[];
  observed: SignalRecord[];
  trace: { name: string; points: TracePoint[] } | null;
  params: AnalysisParams;
  evidence: Evidence[];
  confirmations: Confirmation[];
  labTests: AttenuationTest[];
  sources: SourceInfo[];
}

export function emptyProject(name = 'Proyecto sin nombre', now = new Date()): Project {
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

const CLASSES: SignalClass[] = ['portadora_confirmada', 'senal_observada', 'sospechosa', 'desconocida'];

function checkSignal(s: unknown, where: string, errs: string[]): s is SignalRecord {
  const o = s as Record<string, unknown>;
  if (!o || typeof o !== 'object') { errs.push(`${where}: no es un objeto.`); return false; }
  if (typeof o.id !== 'string' || !o.id) { errs.push(`${where}: falta «id».`); return false; }
  if (!Number.isSafeInteger(o.freqHz) || (o.freqHz as number) <= 0) { errs.push(`${where}: «freqHz» debe ser un entero positivo (Hz).`); return false; }
  if (o.classification !== undefined && !CLASSES.includes(o.classification as SignalClass)) { errs.push(`${where}: clasificación desconocida «${String(o.classification)}».`); return false; }
  return true;
}

function normSignal(o: SignalRecord): SignalRecord {
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

function checkBand(b: unknown): b is Band {
  const o = b as Band;
  return !!o && Number.isSafeInteger(o.minHz) && Number.isSafeInteger(o.maxHz) && o.maxHz > o.minHz;
}

/**
 * Valida y normaliza un proyecto procedente de JSON (admite también el JSON
 * de análisis exportado, que contiene el proyecto en la clave «proyecto»).
 */
export function parseProject(text: string): { project: Project | null; errors: string[]; isAnalysisExport: boolean; embedded: unknown } {
  const errs: string[] = [];
  let data: unknown;
  try { data = JSON.parse(text); } catch (e) { return { project: null, errors: ['JSON mal formado: ' + (e as Error).message], isAnalysisExport: false, embedded: null }; }
  let obj = data as Record<string, unknown>;
  let isAnalysisExport = false;
  if (obj && typeof obj === 'object' && obj.schema === 'orbe-im-analyzer/analisis@1' && obj.proyecto) { obj = obj.proyecto as Record<string, unknown>; isAnalysisExport = true; }
  if (!obj || typeof obj !== 'object' || obj.schema !== PROJECT_SCHEMA) return { project: null, errors: ['No es un proyecto de Orbe IM Analyzer (falta «schema»: «' + PROJECT_SCHEMA + '»).'], isAnalysisExport, embedded: data };
  const tx = Array.isArray(obj.transmitters) ? obj.transmitters : (errs.push('Falta la lista «transmitters».'), []);
  const ob = Array.isArray(obj.observed) ? obj.observed : [];
  const transmitters = (tx as unknown[]).filter((s, i) => checkSignal(s, `transmitters[${i}]`, errs)).map((s) => normSignal(s as SignalRecord));
  const observed = (ob as unknown[]).filter((s, i) => checkSignal(s, `observed[${i}]`, errs)).map((s) => normSignal(s as SignalRecord));
  const p = { ...DEFAULT_PARAMS, ...((obj.params as object) ?? {}) } as AnalysisParams;
  if (!checkBand(p.band)) { errs.push('Banda no válida en «params.band».'); p.band = { ...FM_BAND }; }
  if (!Number.isInteger(p.maxOrder) || p.maxOrder < 2 || p.maxOrder > 99) { errs.push('«params.maxOrder» no válido.'); p.maxOrder = DEFAULT_PARAMS.maxOrder; }
  if (!Number.isInteger(p.maxTones) || p.maxTones < 1) { errs.push('«params.maxTones» no válido.'); p.maxTones = DEFAULT_PARAMS.maxTones; }
  if (!Number.isSafeInteger(p.toleranceHz) || p.toleranceHz < 0) { errs.push('«params.toleranceHz» no válido.'); p.toleranceHz = DEFAULT_PARAMS.toleranceHz; }
  const ids = new Set(transmitters.map((t) => t.id));
  if (ids.size !== transmitters.length) errs.push('Hay identificadores de transmisor repetidos.');
  const project: Project = {
    schema: PROJECT_SCHEMA,
    name: String(obj.name ?? 'Proyecto importado'),
    created: String(obj.created ?? new Date().toISOString()),
    modified: String(obj.modified ?? new Date().toISOString()),
    transmitters,
    selectedIds: Array.isArray(obj.selectedIds) ? (obj.selectedIds as string[]).filter((i) => ids.has(i)) : transmitters.map((t) => t.id),
    observed,
    trace: (obj.trace as Project['trace']) ?? null,
    params: p,
    evidence: Array.isArray(obj.evidence) ? (obj.evidence as Evidence[]) : [],
    confirmations: Array.isArray(obj.confirmations) ? (obj.confirmations as Confirmation[]) : [],
    labTests: Array.isArray(obj.labTests) ? (obj.labTests as AttenuationTest[]) : [],
    sources: Array.isArray(obj.sources) ? (obj.sources as SourceInfo[]) : [],
  };
  return { project, errors: errs, isAnalysisExport, embedded: data };
}

export function selectedGenerators(p: Project): SignalRecord[] {
  const sel = new Set(p.selectedIds);
  return p.transmitters.filter((t) => sel.has(t.id)).sort((a, b) => a.freqHz - b.freqHz || (a.id < b.id ? -1 : 1));
}
