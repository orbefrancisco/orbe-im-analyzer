/** Lanza cálculos en el Web Worker (o en el hilo principal si no hay workers). */

import type { AnalysisParams, AnalysisRun, EnumerationResult, SignalRecord } from '../engine/index.js';
import { buildResultSet, enumerateProducts, enumerationParamsOf, metaFromEnumeration } from '../engine/index.js';

export interface Progress { visited: number; fraction: number; combos: number }

export interface Job {
  promise: Promise<AnalysisRun>;
  cancel: () => void;
}

let seq = 0;

export function computeAsync(generators: SignalRecord[], params: AnalysisParams, onProgress: (p: Progress) => void): Job {
  const freqs = generators.map((g) => g.freqHz);
  const ep = enumerationParamsOf(params);
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  const date = new Date();
  if (!worker) {
    // reserva: cálculo síncrono (bloquea la interfaz, pero es correcto)
    const p = new Promise<AnalysisRun>((resolve, reject) => {
      setTimeout(() => {
        try {
          const e = enumerateProducts(freqs, ep);
          resolve({ params, generators, result: buildResultSet(e.store, generators, params.band), meta: metaFromEnumeration(params, generators.length, e, date) });
        } catch (err) { reject(err); }
      }, 20);
    });
    return { promise: p, cancel: () => undefined };
  }
  const id = ++seq;
  let rejectFn: (e: Error) => void = () => undefined;
  const w = worker;
  const promise = new Promise<AnalysisRun>((resolve, reject) => {
    rejectFn = reject;
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress(m);
      else if (m.type === 'done') {
        const e = m.result as EnumerationResult;
        w.terminate();
        resolve({ params, generators, result: buildResultSet(e.store, generators, params.band), meta: metaFromEnumeration(params, generators.length, e, date) });
      } else if (m.type === 'error') {
        w.terminate();
        reject(new Error(m.message));
      }
    };
    w.onerror = (ev) => { w.terminate(); reject(new Error(ev.message || 'Error en el worker de cálculo (¿se abrió el archivo sin servidor local?).')); };
    w.postMessage({ id, freqs, params: ep });
  });
  return {
    promise,
    cancel: () => { w.terminate(); rejectFn(new Error('Cálculo cancelado por el usuario; no se muestran resultados parciales.')); },
  };
}
