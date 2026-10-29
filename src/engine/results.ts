/**
 * Agrupación y consulta de resultados.
 *
 * Dos combinaciones pertenecen al mismo grupo si su frecuencia es EXACTAMENTE
 * igual (enteros en Hz). La proximidad dentro de una tolerancia se trata
 * aparte (match.ts), porque coincidir a ±10 kHz no es lo mismo que ser la
 * misma frecuencia.
 */

import type { ComboStore } from './enumerate.js';
import { comboTerms } from './enumerate.js';
import type { Band, ProductKind, SignalRecord } from './model.js';
import { formatMHz } from './freq.js';

export interface ResultSet {
  store: ComboStore;
  generators: SignalRecord[];
  band: Band;
  /** Índices de combinación ordenados por (frecuencia, orden, tonos). */
  sorted: Uint32Array;
  /** Grupo g ocupa sorted[groupStart[g] .. groupStart[g+1]). */
  groupStart: Uint32Array;
  groupFreq: Float64Array;
  groupMinOrder: Uint8Array;
  groupCount: number;
  /** Grupo al que pertenece cada combinación. */
  comboGroup: Uint32Array;
}

export function buildResultSet(store: ComboStore, generators: SignalRecord[], band: Band): ResultSet {
  const n = store.count;
  const ids = new Uint32Array(n);
  for (let i = 0; i < n; i++) ids[i] = i;
  const F = store.freqHz, O = store.order, T = store.tones;
  const arr = Array.from(ids);
  arr.sort((a, b) => F[a] - F[b] || O[a] - O[b] || T[a] - T[b] || a - b);
  const sorted = Uint32Array.from(arr);
  const starts: number[] = [];
  const freqs: number[] = [];
  const mins: number[] = [];
  const comboGroup = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const c = sorted[i];
    if (i === 0 || F[c] !== F[sorted[i - 1]]) {
      starts.push(i);
      freqs.push(F[c]);
      mins.push(O[c]);
    }
    comboGroup[c] = starts.length - 1;
  }
  starts.push(n);
  return {
    store,
    generators,
    band,
    sorted,
    groupStart: Uint32Array.from(starts),
    groupFreq: Float64Array.from(freqs),
    groupMinOrder: Uint8Array.from(mins),
    groupCount: freqs.length,
    comboGroup,
  };
}

export function comboKind(s: ComboStore, c: number): ProductKind {
  if (s.tones[c] === 1) return 'armonico';
  for (let t = s.termStart[c]; t < s.termStart[c + 1]; t++) if (s.termCoef[t] < 0) return 'mixto';
  return 'suma';
}

export function orderLabel(s: ComboStore, c: number): string {
  return (s.tones[c] === 1 ? 'H' : 'IM') + s.order[c];
}

export function inBand(freqHz: number, band: Band): boolean {
  return freqHz >= band.minHz && freqHz <= band.maxHz;
}

export interface FormulaStyle {
  /** «−» tipográfico o «-» ASCII. */
  ascii?: boolean;
  /** Decimales mínimos de MHz. */
  minDecimals?: number;
}

function orderedTerms(s: ComboStore, c: number): { index: number; coef: number }[] {
  const t = comboTerms(s, c);
  // positivos primero, después negativos; dentro de cada grupo, por índice
  return t.sort((a, b) => (a.coef > 0 === b.coef > 0 ? a.index - b.index : a.coef > 0 ? -1 : 1));
}

function joinTerms(parts: { coef: number; text: string }[], ascii: boolean): string {
  const minus = ascii ? '-' : '−';
  let out = '';
  parts.forEach((p, i) => {
    const a = Math.abs(p.coef);
    const body = a === 1 ? p.text : `${a}${p.text.startsWith('(') ? '' : '·'}${p.text}`;
    if (i === 0) out += (p.coef < 0 ? minus : '') + body;
    else out += (p.coef < 0 ? ` ${minus} ` : ' + ') + body;
  });
  return out;
}

/** Fórmula numérica: «3(89.30) − 2(89.58)». */
export function formulaNumeric(rs: ResultSet, c: number, style: FormulaStyle = {}): string {
  const md = style.minDecimals ?? 2;
  return joinTerms(
    orderedTerms(rs.store, c).map((t) => {
      const v = formatMHz(rs.generators[t.index].freqHz, md);
      return { coef: t.coef, text: Math.abs(t.coef) === 1 ? v : `(${v})` };
    }),
    !!style.ascii,
  );
}

/** Fórmula simbólica: «3f1 − 2f2» (índices 1-based en la lista de generadores usada). */
export function formulaSymbolic(rs: ResultSet, c: number, style: FormulaStyle = {}): string {
  return joinTerms(
    orderedTerms(rs.store, c).map((t) => ({ coef: t.coef, text: `f${t.index + 1}` })),
    !!style.ascii,
  ).replace(/·f/g, 'f');
}

export function generatorsLabel(rs: ResultSet, c: number): string {
  return comboTerms(rs.store, c)
    .map((t) => {
      const g = rs.generators[t.index];
      return `f${t.index + 1}=${formatMHz(g.freqHz)}${g.label ? ` (${g.label})` : ''}`;
    })
    .join('; ');
}

/** Clave estable del vector basada en los identificadores de los generadores. */
export function hypothesisKey(rs: ResultSet, c: number): string {
  return comboTerms(rs.store, c)
    .map((t) => ({ id: rs.generators[t.index].id, coef: t.coef }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => `${t.id}:${t.coef > 0 ? '+' : ''}${t.coef}`)
    .join('|');
}

export interface ComboFilter {
  minHz?: number;
  maxHz?: number;
  /** Órdenes nominales admitidos (vacío o ausente = todos). */
  orders?: number[];
  /** Número de generadores (tonos) admitidos. */
  tones?: number[];
  kinds?: ProductKind[];
  band?: 'todas' | 'dentro' | 'fuera';
  /** Solo combinaciones en las que interviene este generador. */
  generatorIndex?: number;
  /** Solo combinaciones con Σ m_i igual a este valor. */
  coefSum?: number;
}

/** Combinaciones que pasan el filtro, en el orden de `sorted`. */
export function filterCombos(rs: ResultSet, flt: ComboFilter): Uint32Array {
  const s = rs.store;
  const orders = flt.orders && flt.orders.length ? new Set(flt.orders) : null;
  const tones = flt.tones && flt.tones.length ? new Set(flt.tones) : null;
  const kinds = flt.kinds && flt.kinds.length ? new Set(flt.kinds) : null;
  const lo = flt.minHz ?? -Infinity;
  const hi = flt.maxHz ?? Infinity;
  // búsqueda binaria del primer índice con f ≥ lo
  let a = 0, b = rs.sorted.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (s.freqHz[rs.sorted[m]] < lo) a = m + 1; else b = m;
  }
  const out: number[] = [];
  for (let i = a; i < rs.sorted.length; i++) {
    const c = rs.sorted[i];
    const f = s.freqHz[c];
    if (f > hi) break;
    if (orders && !orders.has(s.order[c])) continue;
    if (tones && !tones.has(s.tones[c])) continue;
    if (kinds && !kinds.has(comboKind(s, c))) continue;
    if (flt.band === 'dentro' && !inBand(f, rs.band)) continue;
    if (flt.band === 'fuera' && inBand(f, rs.band)) continue;
    if (flt.coefSum !== undefined && s.coefSum[c] !== flt.coefSum) continue;
    if (flt.generatorIndex !== undefined) {
      let has = false;
      for (let t = s.termStart[c]; t < s.termStart[c + 1]; t++) if (s.termIdx[t] === flt.generatorIndex) { has = true; break; }
      if (!has) continue;
    }
    out.push(c);
  }
  return Uint32Array.from(out);
}

/** Agrupa una lista filtrada (ordenada por frecuencia) en grupos de frecuencia idéntica. */
export function groupFiltered(rs: ResultSet, combos: Uint32Array): { group: number; combos: number[] }[] {
  const out: { group: number; combos: number[] }[] = [];
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    const g = rs.comboGroup[c];
    const last = out[out.length - 1];
    if (last && last.group === g) last.combos.push(c);
    else out.push({ group: g, combos: [c] });
  }
  return out;
}

/** Todas las combinaciones (sin filtrar) que producen exactamente la frecuencia del grupo g. */
export function groupCombos(rs: ResultSet, g: number): number[] {
  const out: number[] = [];
  for (let i = rs.groupStart[g]; i < rs.groupStart[g + 1]; i++) out.push(rs.sorted[i]);
  return out;
}

/** Índice del grupo con frecuencia exacta `hz`, o −1. */
export function findGroup(rs: ResultSet, hz: number): number {
  let a = 0, b = rs.groupCount - 1;
  while (a <= b) {
    const m = (a + b) >> 1;
    const v = rs.groupFreq[m];
    if (v === hz) return m;
    if (v < hz) a = m + 1; else b = m - 1;
  }
  return -1;
}

/** Grupos con frecuencia en [hz − tol, hz + tol]. */
export function groupsNear(rs: ResultSet, hz: number, tolHz: number): number[] {
  let a = 0, b = rs.groupCount;
  const lo = hz - tolHz;
  while (a < b) {
    const m = (a + b) >> 1;
    if (rs.groupFreq[m] < lo) a = m + 1; else b = m;
  }
  const out: number[] = [];
  for (let g = a; g < rs.groupCount && rs.groupFreq[g] <= hz + tolHz; g++) out.push(g);
  return out;
}

export interface ResultSummary {
  combos: number;
  groups: number;
  inBandGroups: number;
  byOrder: { order: number; combos: number; groups: number }[];
  coincidentGroups: number;
}

export function summarize(rs: ResultSet): ResultSummary {
  const s = rs.store;
  const byOrderCombos = new Map<number, number>();
  const byOrderGroups = new Map<number, number>();
  for (let c = 0; c < s.count; c++) byOrderCombos.set(s.order[c], (byOrderCombos.get(s.order[c]) ?? 0) + 1);
  let inBandGroups = 0, coincident = 0;
  for (let g = 0; g < rs.groupCount; g++) {
    byOrderGroups.set(rs.groupMinOrder[g], (byOrderGroups.get(rs.groupMinOrder[g]) ?? 0) + 1);
    if (inBand(rs.groupFreq[g], rs.band)) inBandGroups++;
    if (rs.groupStart[g + 1] - rs.groupStart[g] > 1) coincident++;
  }
  const orders = [...new Set([...byOrderCombos.keys()])].sort((a, b) => a - b);
  return {
    combos: s.count,
    groups: rs.groupCount,
    inBandGroups,
    byOrder: orders.map((o) => ({ order: o, combos: byOrderCombos.get(o) ?? 0, groups: byOrderGroups.get(o) ?? 0 })),
    coincidentGroups: coincident,
  };
}
