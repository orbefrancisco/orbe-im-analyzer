/**
 * Orquestación: parámetros → enumeración → conjunto de resultados → auditoría.
 * Todo es puro y síncrono; la interfaz lo ejecuta en un Web Worker.
 */

import type { Band, SignalRecord } from './model.js';
import { FM_BAND } from './model.js';
import type { EnumerationParams, EnumerationResult, OutputRange, StopReason } from './enumerate.js';
import { enumerateProducts } from './enumerate.js';
import type { ResultSet } from './results.js';
import { buildResultSet, hypothesisKey } from './results.js';
import { estimateSearchSpace, formatBig } from './combinatorics.js';
import type { ObservedMatch } from './match.js';
import { coChannelWithTransmitters, coverageFraction, matchObserved } from './match.js';
import type { Classification, Confirmation, Evidence, HypothesisClass } from './classify.js';
import { classifyHypothesis } from './classify.js';
import { comboTerms } from './enumerate.js';

export const ALGORITHM_VERSION = '1.0.0';
export const ENGINE_NAME = 'Orbe IM Analyzer — motor de vectores enteros';

export type OutputMode = 'banda' | 'personalizado' | 'todo';

export interface AnalysisParams {
  band: Band;
  outputMode: OutputMode;
  customRange: OutputRange | null;
  maxOrder: number;
  maxTones: number;
  minOrder: number;
  includeHarmonics: boolean;
  toleranceHz: number;
  workBudget: number;
  maxCombos: number;
}

export const DEFAULT_PARAMS: AnalysisParams = {
  band: FM_BAND,
  outputMode: 'banda',
  customRange: null,
  maxOrder: 9,
  maxTones: 3,
  minOrder: 2,
  includeHarmonics: true,
  toleranceHz: 10_000,
  workBudget: 200_000_000,
  maxCombos: 3_000_000,
};

export function outputRangeOf(p: AnalysisParams): OutputRange | null {
  if (p.outputMode === 'banda') return { minHz: p.band.minHz, maxHz: p.band.maxHz };
  if (p.outputMode === 'personalizado') return p.customRange;
  return null;
}

export function enumerationParamsOf(p: AnalysisParams): EnumerationParams {
  return {
    maxOrder: p.maxOrder,
    maxTones: p.maxTones,
    minOrder: p.minOrder,
    includeHarmonics: p.includeHarmonics,
    outputRange: outputRangeOf(p),
    workBudget: p.workBudget,
    maxCombos: p.maxCombos,
  };
}

export interface RunMeta {
  analysisDate: string;
  algorithmVersion: string;
  complete: boolean;
  stopReason: StopReason | null;
  visited: number;
  pruned: number;
  elapsedMs: number;
  candidates: string;
  workBound: string;
}

export interface AnalysisRun {
  params: AnalysisParams;
  generators: SignalRecord[];
  result: ResultSet;
  meta: RunMeta;
}

export function metaFromEnumeration(p: AnalysisParams, nGen: number, e: Pick<EnumerationResult, 'complete' | 'stopReason' | 'visited' | 'pruned' | 'elapsedMs'>, date = new Date()): RunMeta {
  const est = estimateSearchSpace({ nGenerators: nGen, maxOrder: p.maxOrder, maxTones: p.maxTones, minOrder: p.minOrder, includeHarmonics: p.includeHarmonics });
  return {
    analysisDate: date.toISOString(),
    algorithmVersion: ALGORITHM_VERSION,
    complete: e.complete,
    stopReason: e.stopReason ?? null,
    visited: e.visited,
    pruned: e.pruned,
    elapsedMs: e.elapsedMs,
    candidates: est.candidates.toString(),
    workBound: est.workBound.toString(),
  };
}

export function runAnalysis(generators: SignalRecord[], p: AnalysisParams, date = new Date()): AnalysisRun {
  const e = enumerateProducts(generators.map((g) => g.freqHz), enumerationParamsOf(p));
  return {
    params: p,
    generators,
    result: buildResultSet(e.store, generators, p.band),
    meta: metaFromEnumeration(p, generators.length, e, date),
  };
}

export function completenessStatement(m: RunMeta): string {
  if (m.complete) return `EXHAUSTIVO dentro de los límites: se recorrieron ${formatBig(BigInt(m.visited))} nodos del espacio de búsqueda (cota ${formatBig(BigInt(m.workBound))}; las ramas podadas no pueden contener productos en el intervalo de salida).`;
  const why = m.stopReason === 'limite_de_combinaciones' ? 'se alcanzó el límite de combinaciones almacenadas' : 'se agotó el presupuesto de trabajo';
  return `INCOMPLETO — NO EXHAUSTIVO: ${why} tras ${formatBig(BigInt(m.visited))} nodos. Faltan productos; reduzca el espacio de búsqueda o amplíe los límites.`;
}

// ---------------------------------------------------------------- auditoría

export interface ClassifiedHypothesis {
  observedId: string;
  observedHz: number;
  group: number;
  combo: number;
  key: string;
  calcHz: number;
  diffHz: number;
  classification: Classification;
}

export interface AuditResult {
  toleranceHz: number;
  matches: ObservedMatch[];
  hypotheses: ClassifiedHypothesis[];
  /** Mejor clase por grupo (A si ninguna señal coincide). */
  groupClass: Map<number, HypothesisClass>;
  /** Mejor clase por señal observada (null si no coincide con ningún producto). */
  observedClass: Map<string, HypothesisClass | null>;
  unmatched: ObservedMatch[];
  /** Probabilidad de coincidencia fortuita en la banda (fracción cubierta). */
  coverage: { all: number; byMaxOrder: { order: number; fraction: number }[] };
  coChannel: Map<number, { transmitter: SignalRecord; diffHz: number }[]>;
}

const RANK: Record<HypothesisClass, number> = { A: 0, B: 1, C: 2, D: 3 };

export function bestClass(a: HypothesisClass | null | undefined, b: HypothesisClass): HypothesisClass {
  return !a || RANK[b] > RANK[a] ? b : a;
}

export function audit(run: AnalysisRun, observed: SignalRecord[], toleranceHz: number, evidence: Evidence[], confirmations: Confirmation[], transmitters: SignalRecord[] = run.generators): AuditResult {
  const rs = run.result;
  const matches = matchObserved(rs, observed, toleranceHz);
  const hyps: ClassifiedHypothesis[] = [];
  const groupClass = new Map<number, HypothesisClass>();
  const observedClass = new Map<string, HypothesisClass | null>();
  for (const om of matches) {
    observedClass.set(om.observed.id, null);
    for (const gm of om.matches) {
      for (const c of gm.combos) {
        const key = hypothesisKey(rs, c);
        const gens = comboTerms(rs.store, c).map((t) => rs.generators[t.index]);
        const cl = classifyHypothesis({ matched: true, observedId: om.observed.id, hypothesisKey: key, generators: gens, evidence, confirmations });
        hyps.push({ observedId: om.observed.id, observedHz: om.observed.freqHz, group: gm.group, combo: c, key, calcHz: gm.freqHz, diffHz: gm.diffHz, classification: cl });
        groupClass.set(gm.group, bestClass(groupClass.get(gm.group), cl.cls));
        observedClass.set(om.observed.id, bestClass(observedClass.get(om.observed.id), cl.cls));
      }
    }
  }
  const orders = [...new Set(Array.from(rs.groupMinOrder))].sort((a, b) => a - b);
  return {
    toleranceHz,
    matches,
    hypotheses: hyps,
    groupClass,
    observedClass,
    unmatched: matches.filter((m) => m.matches.length === 0),
    coverage: {
      all: coverageFraction(rs, toleranceHz, run.params.band),
      byMaxOrder: orders.map((o) => ({ order: o, fraction: coverageFraction(rs, toleranceHz, run.params.band, o) })),
    },
    coChannel: coChannelWithTransmitters(rs, transmitters, toleranceHz),
  };
}
