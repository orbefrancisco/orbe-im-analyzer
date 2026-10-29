/**
 * Enumeración exhaustiva de vectores de coeficientes enteros.
 *
 * Para N frecuencias f_i (enteros en Hz) se recorren todos los vectores
 * m ∈ Z^N con
 *     minOrder ≤ Σ|m_i| ≤ maxOrder,   1 ≤ #{m_i ≠ 0} ≤ maxTones,
 * y se conserva f = |Σ m_i f_i| si cae en el intervalo de salida.
 *
 * Algoritmo: búsqueda en profundidad sobre los índices de los generadores
 * que intervienen (j1 < j2 < …), eligiendo para cada uno una magnitud y un
 * signo. El primer coeficiente no nulo se fija positivo, de modo que m y −m
 * (que dan la misma frecuencia) se generan una sola vez; después el vector se
 * normaliza para que Σ m_i f_i > 0.
 *
 * Poda: si quedan r unidades de orden y la mayor frecuencia restante es
 * F*, toda continuación modifica la suma parcial S en, como mucho, r·F*.
 * Si [S − r·F*, S + r·F*] no corta a ±[fmin, fmax], la rama se descarta sin
 * perder ningún vector válido (la poda es conservadora y, por tanto, exacta).
 */
export const MAX_ORDER_LIMIT = 99;
class StoreBuilder {
    constructor() {
        this.count = 0;
        this.termCount = 0;
        this.freqHz = new Float64Array(1024);
        this.order = new Uint8Array(1024);
        this.tones = new Uint8Array(1024);
        this.coefSum = new Int16Array(1024);
        this.termStart = new Uint32Array(1025);
        this.termIdx = new Uint32Array(4096);
        this.termCoef = new Int8Array(4096);
    }
    growCombos() {
        const n = this.freqHz.length * 2;
        const f = new Float64Array(n);
        f.set(this.freqHz);
        this.freqHz = f;
        const o = new Uint8Array(n);
        o.set(this.order);
        this.order = o;
        const t = new Uint8Array(n);
        t.set(this.tones);
        this.tones = t;
        const c = new Int16Array(n);
        c.set(this.coefSum);
        this.coefSum = c;
        const s = new Uint32Array(n + 1);
        s.set(this.termStart);
        this.termStart = s;
    }
    growTerms(min) {
        let n = this.termIdx.length * 2;
        while (n < min)
            n *= 2;
        const a = new Uint32Array(n);
        a.set(this.termIdx);
        this.termIdx = a;
        const b = new Int8Array(n);
        b.set(this.termCoef);
        this.termCoef = b;
    }
    push(freq, order, k, idx, coef, sign) {
        if (this.count + 1 >= this.freqHz.length)
            this.growCombos();
        if (this.termCount + k > this.termIdx.length)
            this.growTerms(this.termCount + k);
        const c = this.count;
        this.freqHz[c] = freq;
        this.order[c] = order;
        this.tones[c] = k;
        let cs = 0;
        const base = this.termCount;
        for (let i = 0; i < k; i++) {
            const v = coef[i] * sign;
            this.termIdx[base + i] = idx[i];
            this.termCoef[base + i] = v;
            cs += v;
        }
        this.coefSum[c] = cs;
        this.termCount += k;
        this.count = c + 1;
        this.termStart[this.count] = this.termCount;
    }
    finish() {
        const n = this.count;
        return {
            count: n,
            freqHz: this.freqHz.slice(0, n),
            order: this.order.slice(0, n),
            tones: this.tones.slice(0, n),
            coefSum: this.coefSum.slice(0, n),
            termStart: this.termStart.slice(0, n + 1),
            termIdx: this.termIdx.slice(0, this.termCount),
            termCoef: this.termCoef.slice(0, this.termCount),
            termCount: this.termCount,
        };
    }
}
export function validateParams(freqsHz, p) {
    const errs = [];
    if (freqsHz.length === 0)
        errs.push('No hay frecuencias de entrada.');
    for (const f of freqsHz) {
        if (!Number.isSafeInteger(f) || f <= 0)
            errs.push(`Frecuencia no entera o no positiva: ${f}`);
    }
    if (!Number.isInteger(p.maxOrder) || p.maxOrder < 2 || p.maxOrder > MAX_ORDER_LIMIT)
        errs.push(`El orden máximo debe ser un entero entre 2 y ${MAX_ORDER_LIMIT}.`);
    if (!Number.isInteger(p.maxTones) || p.maxTones < 1)
        errs.push('El número máximo de señales por combinación debe ser un entero ≥ 1.');
    const mo = p.minOrder ?? 2;
    if (!Number.isInteger(mo) || mo < 2 || mo > p.maxOrder)
        errs.push('El orden mínimo debe ser un entero entre 2 y el orden máximo.');
    if (p.outputRange && !(p.outputRange.minHz >= 0 && p.outputRange.maxHz > p.outputRange.minHz))
        errs.push('Intervalo de salida no válido.');
    const fmax = Math.max(0, ...freqsHz);
    if (!Number.isSafeInteger(fmax * p.maxOrder))
        errs.push('El producto orden × frecuencia excede la aritmética entera exacta.');
    return errs;
}
export function enumerateProducts(freqsHz, p, hooks = {}) {
    const errs = validateParams(freqsHz, p);
    if (errs.length)
        throw new Error(errs.join(' '));
    const t0 = Date.now();
    const N = freqsHz.length;
    const K = p.maxOrder;
    const T = Math.min(p.maxTones, N, K);
    const minOrder = p.minOrder ?? 2;
    const lo = p.outputRange ? p.outputRange.minHz : 1;
    const hi = p.outputRange ? p.outputRange.maxHz : Infinity;
    const ranged = p.outputRange !== null;
    const f = Float64Array.from(freqsHz);
    // sufMax[j] = máx f[j..N-1]
    const sufMax = new Float64Array(N + 1);
    for (let j = N - 1; j >= 0; j--)
        sufMax[j] = Math.max(f[j], sufMax[j + 1]);
    const out = new StoreBuilder();
    const idx = new Int32Array(T);
    const coef = new Int32Array(T);
    let visited = 0;
    let pruned = 0;
    let stop;
    const budget = p.workBudget;
    const maxCombos = p.maxCombos;
    const progressEvery = 1 << 17;
    let nextProgress = progressEvery;
    let topFraction = 0;
    const rec = (start, used, left, S, ord) => {
        for (let j = start; j < N; j++) {
            if (used === 0)
                topFraction = j / N;
            const fj = f[j];
            for (let a = 1; a <= left; a++) {
                for (let sgn = 1; sgn >= -1; sgn -= 2) {
                    if (used === 0 && sgn < 0)
                        continue;
                    if (stop)
                        return;
                    visited++;
                    if (visited > budget) {
                        stop = 'presupuesto_de_trabajo';
                        return;
                    }
                    if (visited >= nextProgress) {
                        nextProgress += progressEvery;
                        hooks.onProgress?.(visited, topFraction, out.count);
                    }
                    const S2 = S + sgn * a * fj;
                    const k = used + 1;
                    const o2 = ord + a;
                    idx[used] = j;
                    coef[used] = sgn * a;
                    if (o2 >= minOrder && S2 !== 0 && (k > 1 || p.includeHarmonics)) {
                        const F = S2 < 0 ? -S2 : S2;
                        if (F >= lo && F <= hi) {
                            if (out.count >= maxCombos) {
                                stop = 'limite_de_combinaciones';
                                return;
                            }
                            out.push(F, o2, k, idx, coef, S2 < 0 ? -1 : 1);
                        }
                    }
                    const r = left - a;
                    if (k < T && r > 0 && j + 1 < N) {
                        if (ranged) {
                            const R = r * sufMax[j + 1];
                            const a1 = S2 - R, b1 = S2 + R;
                            // ¿[a1,b1] corta a [lo,hi] o a [−hi,−lo]?
                            const hitsPos = b1 >= lo && a1 <= hi;
                            const hitsNeg = a1 <= -lo && b1 >= -hi;
                            if (!hitsPos && !hitsNeg) {
                                pruned++;
                                continue;
                            }
                        }
                        rec(j + 1, k, r, S2, o2);
                    }
                }
            }
        }
    };
    rec(0, 0, K, 0, 0);
    hooks.onProgress?.(visited, 1, out.count);
    return {
        store: out.finish(),
        complete: stop === undefined,
        stopReason: stop,
        visited,
        pruned,
        elapsedMs: Date.now() - t0,
    };
}
/** Términos de la combinación c como pares (índice, coeficiente). */
export function comboTerms(s, c) {
    const out = [];
    for (let t = s.termStart[c]; t < s.termStart[c + 1]; t++)
        out.push({ index: s.termIdx[t], coef: s.termCoef[t] });
    return out;
}
/** Clave canónica del vector (independiente del orden de enumeración). */
export function comboKeyByIndex(s, c) {
    return comboTerms(s, c).map((t) => `${t.index}:${t.coef}`).join('|');
}
