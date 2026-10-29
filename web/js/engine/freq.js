/**
 * Representación exacta de frecuencias.
 *
 * Todas las frecuencias se guardan como ENTEROS en hercios (resolución 1 Hz).
 * El texto de entrada («89.30 MHz», «89,3», «89300 kHz», «8.93E+07») se
 * convierte con aritmética decimal entera (BigInt), nunca con
 * `parseFloat(x) * 1e6`, de modo que 89.30 MHz es exactamente 89 300 000 Hz.
 *
 * Con frecuencias de hasta 1 THz y órdenes de hasta 99, toda suma
 * Σ m_i f_i cabe holgadamente en el rango de enteros exactos de IEEE-754
 * (2^53 ≈ 9.0e15 > 99 · 1e12), así que las combinaciones también son exactas.
 */
export const RESOLUTION_HZ = 1;
export const MAX_FREQUENCY_HZ = 1e12;
const UNIT_EXP = { Hz: 0, kHz: 3, MHz: 6, GHz: 9 };
/**
 * Analiza un número decimal escrito como texto, sin pasar por coma flotante.
 * Acepta separador decimal «.» o «,»; si aparecen ambos, el último es el
 * decimal y el otro se toma como separador de miles. Acepta notación
 * científica (1.2E+3).
 */
export function parseDecimal(raw) {
    let s = raw.trim().replace(/[   ]/g, '').replace(/−/g, '-');
    if (s === '')
        return null;
    let exp = 0;
    const em = /^(.*?)[eE]([+-]?\d{1,3})$/.exec(s);
    if (em) {
        s = em[1];
        exp = parseInt(em[2], 10);
    }
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
        const decSep = lastDot > lastComma ? '.' : ',';
        const thouSep = decSep === '.' ? ',' : '.';
        s = s.split(thouSep).join('');
        if (decSep === ',')
            s = s.replace(',', '.');
    }
    else if (lastComma >= 0) {
        if (s.indexOf(',') !== lastComma)
            return null; // «1,2,3» no es un número
        s = s.replace(',', '.');
    }
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m)
        return null;
    const intPart = m[2] ?? '';
    const fracPart = m[3] ?? '';
    if (intPart === '' && fracPart === '')
        return null;
    const digits = BigInt((intPart + fracPart).replace(/^0+(?=\d)/, '') || '0');
    return { negative: m[1] === '-', digits, exp10: exp - fracPart.length };
}
/** Escala un decimal exacto por 10^shift y redondea al entero más próximo (mitades hacia fuera). */
export function decimalToRoundedInteger(d, shift) {
    const e = d.exp10 + shift;
    if (e >= 0) {
        const v = d.digits * 10n ** BigInt(e);
        return { value: d.negative ? -v : v, exact: true, residualFraction: 0 };
    }
    const div = 10n ** BigInt(-e);
    let q = d.digits / div;
    const r = d.digits % div;
    if (r * 2n >= div)
        q += 1n;
    // fracción residual en [0,1): distancia relativa al entero inferior
    const residualFraction = Number((r * 1000000n) / div) / 1e6;
    return { value: d.negative ? -q : q, exact: r === 0n, residualFraction };
}
const UNIT_RE = /\s*(ghz|mhz|khz|hz)\s*$/i;
export function normalizeUnit(u) {
    const l = u.toLowerCase();
    if (l === 'hz')
        return 'Hz';
    if (l === 'khz')
        return 'kHz';
    if (l === 'mhz')
        return 'MHz';
    if (l === 'ghz')
        return 'GHz';
    return null;
}
/**
 * Convierte un texto de frecuencia a hercios enteros.
 * La unidad escrita en el texto tiene prioridad sobre `defaultUnit`.
 */
export function parseFrequency(text, defaultUnit = 'MHz') {
    const t = String(text ?? '').trim();
    if (t === '')
        return { ok: false, hz: NaN, error: 'frecuencia vacía' };
    let unit = defaultUnit;
    let num = t;
    const um = UNIT_RE.exec(t);
    if (um) {
        unit = normalizeUnit(um[1]);
        num = t.slice(0, um.index);
    }
    const d = parseDecimal(num);
    if (!d)
        return { ok: false, hz: NaN, error: `no es un número válido: «${t}»` };
    if (d.negative)
        return { ok: false, hz: NaN, error: `frecuencia negativa: «${t}»` };
    const r = decimalToRoundedInteger(d, UNIT_EXP[unit]);
    if (r.value <= 0n)
        return { ok: false, hz: NaN, error: `frecuencia nula o inferior a la resolución de 1 Hz: «${t}»` };
    if (r.value > BigInt(MAX_FREQUENCY_HZ))
        return { ok: false, hz: NaN, error: `frecuencia fuera del rango admitido (≤ 1 THz): «${t}»` };
    const res = { ok: true, hz: Number(r.value), unit };
    // Los restos minúsculos (< 0.001 Hz) provienen de artefactos binarios (89.299999999999997);
    // un resto mayor indica que el dato tiene más precisión que la resolución de 1 Hz.
    if (!r.exact && r.residualFraction > 0.001 && r.residualFraction < 0.999) {
        res.warning = `«${t}» tiene precisión inferior a 1 Hz; se redondeó a ${formatHz(res.hz)} Hz`;
    }
    return res;
}
/** Convierte una tolerancia (por defecto en kHz) a hercios enteros; admite 0. */
export function parseTolerance(text, defaultUnit = 'kHz') {
    const t = String(text ?? '').trim().replace(/^±/, '');
    if (t === '')
        return { ok: false, hz: NaN, error: 'tolerancia vacía' };
    let unit = defaultUnit;
    let num = t;
    const um = UNIT_RE.exec(t);
    if (um) {
        unit = normalizeUnit(um[1]);
        num = t.slice(0, um.index);
    }
    const d = parseDecimal(num);
    if (!d || d.negative)
        return { ok: false, hz: NaN, error: `tolerancia no válida: «${t}»` };
    const r = decimalToRoundedInteger(d, UNIT_EXP[unit]);
    return { ok: true, hz: Number(r.value), unit };
}
function padFrac(n, width) {
    return String(n).padStart(width, '0');
}
/**
 * Formato exacto en MHz a partir de hercios enteros: siempre muestra al menos
 * `minDecimals` decimales y, si hace falta, hasta 6 (resolución de 1 Hz).
 */
export function formatMHz(hz, minDecimals = 2) {
    if (!Number.isFinite(hz))
        return '';
    const neg = hz < 0;
    const a = Math.abs(Math.round(hz));
    const ip = Math.floor(a / 1e6);
    let frac = padFrac(a % 1e6, 6);
    while (frac.length > minDecimals && frac.endsWith('0'))
        frac = frac.slice(0, -1);
    return (neg ? '-' : '') + ip + (frac.length ? '.' + frac : '');
}
/** Diferencia en kHz con 3 decimales exactos (resolución 1 Hz). */
export function formatKHz(hz, decimals = 3) {
    if (!Number.isFinite(hz))
        return '';
    const neg = hz < 0;
    const a = Math.abs(Math.round(hz));
    const ip = Math.floor(a / 1000);
    let frac = padFrac(a % 1000, 3).slice(0, Math.max(0, Math.min(3, decimals)));
    const s = ip + (frac.length ? '.' + frac : '');
    return (neg && a !== 0 ? '-' : '') + s;
}
export function formatHz(hz) {
    return String(Math.round(hz));
}
/** MHz como número de coma flotante, SOLO para dibujar o exportar a hojas de cálculo. */
export function hzToMHzFloat(hz) {
    return hz / 1e6;
}
