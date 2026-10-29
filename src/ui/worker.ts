/**
 * Web Worker de cálculo: ejecuta la enumeración fuera del hilo de la
 * interfaz y devuelve el almacén de combinaciones como búferes transferibles.
 * La cancelación se hace terminando el worker: un cálculo cancelado se
 * descarta entero y nunca se presenta.
 */

import type { EnumerationParams } from '../engine/enumerate.js';
import { enumerateProducts } from '../engine/enumerate.js';

interface Req { id: number; freqs: number[]; params: EnumerationParams }

const ctx = self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void; onmessage: ((e: MessageEvent<Req>) => void) | null };

ctx.onmessage = (e: MessageEvent<Req>) => {
  const { id, freqs, params } = e.data;
  try {
    const r = enumerateProducts(freqs, params, {
      onProgress: (visited, fraction, combos) => ctx.postMessage({ id, type: 'progress', visited, fraction, combos }),
    });
    const s = r.store;
    ctx.postMessage(
      { id, type: 'done', result: { ...r } },
      [s.freqHz.buffer, s.order.buffer, s.tones.buffer, s.coefSum.buffer, s.termStart.buffer, s.termIdx.buffer, s.termCoef.buffer],
    );
  } catch (err) {
    ctx.postMessage({ id, type: 'error', message: (err as Error).message });
  }
};
