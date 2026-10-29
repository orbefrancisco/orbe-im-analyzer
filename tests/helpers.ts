import type { AnalysisParams, SignalRecord } from '../src/engine/index.js';
import { DEFAULT_PARAMS, FM_BAND, makeSignal, parseFrequency } from '../src/engine/index.js';

export function hz(mhzText: string): number {
  const r = parseFrequency(mhzText, 'MHz');
  if (!r.ok) throw new Error(r.error);
  return r.hz;
}

export function gens(list: string[], cls: SignalRecord['classification'] = 'desconocida'): SignalRecord[] {
  return list.map((f, i) => makeSignal(hz(f), { id: `g${i + 1}`, label: `TX${i + 1}`, classification: cls }));
}

export function params(over: Partial<AnalysisParams> = {}): AnalysisParams {
  return { ...DEFAULT_PARAMS, band: { ...FM_BAND }, ...over };
}

/** Enumerador ingenuo e independiente: producto cartesiano completo de coeficientes en [−K, K]^N. */
export function naiveProducts(freqs: number[], K: number, T: number, harmonics: boolean, lo: number, hi: number, minOrder = 2): string[] {
  const N = freqs.length;
  const out: string[] = [];
  const m = new Array(N).fill(-K);
  const total = (2 * K + 1) ** N;
  for (let it = 0; it < total; it++) {
    let x = it;
    for (let i = 0; i < N; i++) { m[i] = (x % (2 * K + 1)) - K; x = Math.floor(x / (2 * K + 1)); }
    let order = 0, tones = 0, S = 0;
    for (let i = 0; i < N; i++) { order += Math.abs(m[i]); if (m[i]) tones++; S += m[i] * freqs[i]; }
    if (order < minOrder || order > K || tones === 0 || tones > T) continue;
    if (!harmonics && tones === 1) continue;
    if (S <= 0) continue; // representante con suma positiva (excluye −m y la componente continua)
    if (S < lo || S > hi) continue;
    out.push(`${S}@${m.map((v, i) => (v ? `${i}:${v}` : '')).filter(Boolean).join('|')}`);
  }
  return out.sort();
}
