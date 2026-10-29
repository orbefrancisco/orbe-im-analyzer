/**
 * Comparación entre señales medidas y productos teóricos.
 *
 * Una señal medida f_obs «coincide» con un grupo de frecuencia f_calc si
 * |f_obs − f_calc| ≤ tolerancia (comparación entera e inclusiva, en Hz).
 * Una misma señal puede coincidir con varios grupos y cada grupo puede tener
 * varias combinaciones: TODAS se conservan como hipótesis compatibles.
 *
 * Coincidir no es confirmar: el módulo también estima la fracción de la banda
 * que queda «cubierta» por las ventanas ±tolerancia de todos los productos,
 * que es la probabilidad de que una frecuencia arbitraria (p. ej. una señal
 * independiente) coincida por azar con algún producto.
 */

import type { ResultSet } from './results.js';
import { groupCombos, groupsNear, hypothesisKey, inBand } from './results.js';
import type { Band, SignalRecord } from './model.js';

export interface GroupMatch {
  group: number;
  freqHz: number;
  /** f_obs − f_calc en Hz (con signo). */
  diffHz: number;
  combos: number[];
}

export interface ObservedMatch {
  observed: SignalRecord;
  matches: GroupMatch[];
  /** Grupo más próximo aunque esté fuera de tolerancia (diagnóstico), o null si no hay productos. */
  nearest: { group: number; freqHz: number; diffHz: number } | null;
}

export function nearestGroup(rs: ResultSet, hz: number): { group: number; freqHz: number; diffHz: number } | null {
  if (rs.groupCount === 0) return null;
  let a = 0, b = rs.groupCount;
  while (a < b) {
    const m = (a + b) >> 1;
    if (rs.groupFreq[m] < hz) a = m + 1; else b = m;
  }
  const cands = [a - 1, a].filter((g) => g >= 0 && g < rs.groupCount);
  let best = cands[0];
  for (const g of cands) if (Math.abs(rs.groupFreq[g] - hz) < Math.abs(rs.groupFreq[best] - hz)) best = g;
  return { group: best, freqHz: rs.groupFreq[best], diffHz: hz - rs.groupFreq[best] };
}

export function matchObserved(rs: ResultSet, observed: SignalRecord[], tolHz: number): ObservedMatch[] {
  if (!Number.isSafeInteger(tolHz) || tolHz < 0) throw new Error('La tolerancia debe ser un entero de hercios ≥ 0.');
  return observed.map((o) => ({
    observed: o,
    matches: groupsNear(rs, o.freqHz, tolHz)
      .map((g) => ({ group: g, freqHz: rs.groupFreq[g], diffHz: o.freqHz - rs.groupFreq[g], combos: groupCombos(rs, g) }))
      .sort((x, y) => Math.abs(x.diffHz) - Math.abs(y.diffHz) || x.freqHz - y.freqHz),
    nearest: nearestGroup(rs, o.freqHz),
  }));
}

/** Para cada grupo, las señales observadas que caen dentro de tolerancia. */
export function observedByGroup(matches: ObservedMatch[]): Map<number, { observed: SignalRecord; diffHz: number }[]> {
  const m = new Map<number, { observed: SignalRecord; diffHz: number }[]>();
  for (const om of matches) {
    for (const gm of om.matches) {
      const arr = m.get(gm.group) ?? [];
      arr.push({ observed: om.observed, diffHz: gm.diffHz });
      m.set(gm.group, arr);
    }
  }
  return m;
}

/** Grupos que coinciden (dentro de tolerancia) con alguna frecuencia de la lista de transmisores. */
export function coChannelWithTransmitters(rs: ResultSet, transmitters: SignalRecord[], tolHz: number): Map<number, { transmitter: SignalRecord; diffHz: number }[]> {
  const m = new Map<number, { transmitter: SignalRecord; diffHz: number }[]>();
  for (const t of transmitters) {
    for (const g of groupsNear(rs, t.freqHz, tolHz)) {
      const arr = m.get(g) ?? [];
      arr.push({ transmitter: t, diffHz: t.freqHz - rs.groupFreq[g] });
      m.set(g, arr);
    }
  }
  return m;
}

/**
 * Fracción de la banda cubierta por la unión de los intervalos
 * [f − tol, f + tol] de los grupos (opcionalmente solo los de orden mínimo ≤ maxOrder).
 * Es la probabilidad de coincidencia fortuita para una frecuencia uniforme en la banda.
 */
export function coverageFraction(rs: ResultSet, tolHz: number, band: Band, maxOrder = Infinity): number {
  const width = band.maxHz - band.minHz;
  if (width <= 0) return NaN;
  let covered = 0;
  let curA = -Infinity, curB = -Infinity;
  for (let g = 0; g < rs.groupCount; g++) {
    if (rs.groupMinOrder[g] > maxOrder) continue;
    const f = rs.groupFreq[g];
    const a = Math.max(band.minHz, f - tolHz);
    const b = Math.min(band.maxHz, f + tolHz);
    if (b < a) continue;
    if (a > curB) {
      if (curB > curA) covered += curB - curA;
      curA = a; curB = b;
    } else if (b > curB) curB = b;
  }
  if (curB > curA) covered += curB - curA;
  return covered / width;
}

export interface Hypothesis {
  observedId: string;
  observedHz: number;
  group: number;
  combo: number;
  key: string;
  calcHz: number;
  diffHz: number;
  inBand: boolean;
}

/** Aplana las coincidencias en una lista de hipótesis (una por combinación compatible). */
export function hypotheses(rs: ResultSet, matches: ObservedMatch[]): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (const om of matches) {
    for (const gm of om.matches) {
      for (const c of gm.combos) {
        out.push({
          observedId: om.observed.id,
          observedHz: om.observed.freqHz,
          group: gm.group,
          combo: c,
          key: hypothesisKey(rs, c),
          calcHz: gm.freqHz,
          diffHz: gm.diffHz,
          inBand: inBand(gm.freqHz, rs.band),
        });
      }
    }
  }
  return out;
}
