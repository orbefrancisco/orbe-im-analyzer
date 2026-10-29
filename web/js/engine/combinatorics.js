/**
 * Tamaño exacto del espacio de búsqueda, calculado con BigInt antes de enumerar.
 *
 * Un vector de coeficientes m ∈ Z^N con k componentes no nulas y orden
 * nominal s = Σ|m_i| se elige así:
 *   · C(N, k) maneras de escoger qué generadores intervienen;
 *   · C(s−1, k−1) maneras de repartir s en k magnitudes positivas;
 *   · 2^k combinaciones de signo, de las que solo se cuenta la mitad porque
 *     m y −m producen la misma |Σ m_i f_i| (se conserva un representante).
 */
export function binom(n, k) {
    if (k < 0 || n < 0 || k > n)
        return 0n;
    k = Math.min(k, n - k);
    let r = 1n;
    for (let i = 1; i <= k; i++) {
        r = (r * BigInt(n - k + i)) / BigInt(i);
    }
    return r;
}
function countVectors(N, K, T, minOrder, harmonics, byOrder, byTones) {
    let total = 0n;
    const kMax = Math.min(T, N, K);
    for (let k = harmonics ? 1 : 2; k <= kMax; k++) {
        const choose = binom(N, k) * (1n << BigInt(k - 1));
        let sumK = 0n;
        for (let s = Math.max(k, minOrder); s <= K; s++) {
            const c = choose * binom(s - 1, k - 1);
            sumK += c;
            if (byOrder)
                byOrder.set(s, (byOrder.get(s) ?? 0n) + c);
        }
        if (byTones)
            byTones.set(k, sumK);
        total += sumK;
    }
    return total;
}
export function estimateSearchSpace(p) {
    const minOrder = p.minOrder ?? 2;
    const bo = new Map();
    const bt = new Map();
    const candidates = countVectors(p.nGenerators, p.maxOrder, p.maxTones, minOrder, p.includeHarmonics, bo, bt);
    const workBound = countVectors(p.nGenerators, p.maxOrder, p.maxTones, 1, true);
    return {
        candidates,
        workBound,
        byOrder: [...bo.entries()].sort((a, b) => a[0] - b[0]).map(([order, count]) => ({ order, count })),
        byTones: [...bt.entries()].sort((a, b) => a[0] - b[0]).map(([tones, count]) => ({ tones, count })),
    };
}
/** Formato legible de un BigInt grande (separador de miles fino). */
export function formatBig(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
/** Propone reducciones del espacio de búsqueda que caben dentro del presupuesto. */
export function suggestReductions(p, budget) {
    const out = [];
    const B = BigInt(Math.floor(budget));
    for (let t = p.maxTones - 1; t >= 2; t--) {
        const w = estimateSearchSpace({ ...p, maxTones: t }).workBound;
        if (w <= B) {
            out.push({ description: `Limitar a ${t} señales generadoras por combinación`, workBound: w });
            break;
        }
    }
    for (let k = p.maxOrder - 1; k >= 3; k--) {
        const w = estimateSearchSpace({ ...p, maxOrder: k }).workBound;
        if (w <= B) {
            out.push({ description: `Reducir el orden máximo a ${k}`, workBound: w });
            break;
        }
    }
    for (let n = p.nGenerators - 1; n >= 2; n--) {
        const w = estimateSearchSpace({ ...p, nGenerators: n }).workBound;
        if (w <= B) {
            out.push({ description: `Seleccionar como máximo ${n} frecuencias de entrada`, workBound: w });
            break;
        }
    }
    return out;
}
