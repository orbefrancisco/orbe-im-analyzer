/**
 * E/S de la base nacional:
 *  · importación masiva de registros de frecuencia (CSV, XLSX o JSON) con
 *    columna de estación opcional, detección de duplicados e informe por fila;
 *  · copia de seguridad completa con suma SHA-256 y restauración atómica.
 *
 * Seguridad: los datos importados son SOLO datos. Se reconstruyen campo a
 * campo con tipos comprobados, se descartan claves peligrosas (__proto__,
 * constructor, prototype) y nunca se interpretan como HTML ni como código.
 */
import { sha256Hex, utf8Encode } from './bytes.js';
import { parseDecimal, parseFrequency } from './freq.js';
import { detectColumns, inferUnit } from './importers.js';
import { excelSerialToISO } from './xlsx.js';
import { COLLECTIONS, NATIONAL_SCHEMA, RECORD_STATUS_LABEL, emptyNationalDB, isProvinceId } from './national.js';
import { ALGORITHM_VERSION } from './analysis.js';
// ------------------------------------------------------------------ importación de registros
export function normalizeText(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
/** Resuelve «01», «1», «Barahona», «estación barahona», «Jacobo — Distrito Nacional»… */
export function resolveStation(stations, text) {
    const t = normalizeText(text);
    if (!t)
        return null;
    const num = /^(?:estacion |est )?0*(\d{1,2})$/.exec(t);
    if (num)
        return stations.find((s) => Number(s.id) === Number(num[1])) ?? null;
    const exact = stations.find((s) => normalizeText(s.name) === t || normalizeText(s.operationalName) === t);
    if (exact)
        return exact;
    const hits = stations.filter((s) => t.includes(normalizeText(s.name)));
    return hits.length === 1 ? hits[0] : null;
}
export function parseRecordStatus(s, fallback) {
    const t = normalizeText(s);
    if (!t)
        return fallback;
    if (Object.keys(RECORD_STATUS_LABEL).includes(s.trim()))
        return s.trim();
    if (/sospech|intermod|\bim\b/.test(t))
        return 'sospechosa_im';
    if (/asignad|autorizad|licencia/.test(t))
        return 'asignada_oficialmente';
    if (/report|pendiente|denuncia/.test(t))
        return 'reportada_pendiente';
    if (/confirm/.test(t))
        return 'portadora_confirmada';
    return 'observada_sin_identificar';
}
const EXTRA = [
    ['station', /^(estaci[oó]n|station|sitio de monitoreo|site|sensor|est\.?)$|^(estaci[oó]n|station)\b/i],
    ['service', /(servicio|service)/i],
    ['bandwidth', /(ancho|bandwidth|\bbw\b|anchura)/i],
    ['transmitter', /(transmisor|transmitter|indicativo|callsign|id transmisor)/i],
    ['authorization', /(autoriz|licencia|authori[sz])/i],
    ['locality', /(municipio|localidad|locality|lugar|ciudad)/i],
    ['emisora', /(emisora|nombre|name|station name|programa)/i],
    ['status', /^(estado|status|clasificaci[oó]n|classification|clase)$/i],
    ['levelUnit', /^(unidad|unit|unidad nivel|level unit)$/i],
    ['dataKind', /^(tipo de dato|data kind|origen del dato|simulado)$/i],
];
function num(s) {
    const d = parseDecimal(s);
    if (!d)
        return null;
    return (d.negative ? -1 : 1) * Number(d.digits) * 10 ** d.exp10;
}
function levelUnitOf(header, cell) {
    const t = `${header} ${cell}`.toLowerCase();
    if (/db\s*[µu]v\s*\/\s*m/.test(t))
        return 'dBµV/m';
    if (/db\s*[µu]v/.test(t))
        return 'dBµV';
    if (/dbm/.test(t))
        return 'dBm';
    if (/kw|\bw\b|dbw/.test(t))
        return 'otra';
    return '';
}
export function importObservations(rows, o) {
    const det = detectColumns(rows);
    const cols = {};
    for (const [k, v] of Object.entries(det.columns))
        cols[k] = v;
    const header = det.hasHeader ? rows[0].map((x) => String(x).trim()) : [];
    if (det.hasHeader) {
        header.forEach((hd, i) => {
            for (const [role, re] of EXTRA)
                if (cols[role] === undefined && re.test(hd) && i !== cols.freq) {
                    cols[role] = i;
                    break;
                }
        });
        if (cols.station !== undefined && cols.equipment === cols.station)
            delete cols.equipment;
        if (cols.emisora !== undefined && cols.label === cols.emisora)
            delete cols.label;
        if (cols.status !== undefined && cols.classification === cols.status)
            delete cols.classification;
        if (cols.status === undefined && cols.classification !== undefined)
            cols.status = cols.classification;
    }
    const errors = [];
    const warnings = [];
    const start = det.hasHeader ? 1 : 0;
    const body = rows.slice(start);
    if (cols.freq === undefined) {
        errors.push({ row: 1, message: 'No se encontró ninguna columna de frecuencia.' });
        return { inputs: [], errors, warnings, columns: cols, freqUnit: 'MHz', totalRows: body.length };
    }
    let unit;
    if (o.unit && o.unit !== 'auto')
        unit = o.unit;
    else if (det.headerUnit)
        unit = det.headerUnit;
    else {
        unit = inferUnit(body.map((r) => String(r[cols.freq] ?? '')));
        warnings.push({ row: 0, message: `Unidad de frecuencia inferida: ${unit}. Compruébela.` });
    }
    if (cols.station === undefined && !o.defaultStationId) {
        errors.push({ row: 1, message: 'El archivo no tiene columna de estación y no se eligió una estación de destino.' });
        return { inputs: [], errors, warnings, columns: cols, freqUnit: unit, totalRows: body.length };
    }
    const bwHeader = cols.bandwidth !== undefined ? header[cols.bandwidth] ?? '' : '';
    const bwUnit = /mhz/i.test(bwHeader) ? 'MHz' : /\bhz\b/i.test(bwHeader) && !/khz/i.test(bwHeader) ? 'Hz' : 'kHz';
    const cell = (r, k) => (cols[k] !== undefined ? String(r[cols[k]] ?? '').trim() : '');
    const inputs = [];
    body.forEach((r, i) => {
        const rowNo = i + start + 1;
        if (r.every((c) => String(c ?? '').trim() === ''))
            return;
        const fr = parseFrequency(cell(r, 'freq'), unit);
        if (!fr.ok) {
            errors.push({ row: rowNo, message: fr.error ?? 'frecuencia no válida' });
            return;
        }
        if (fr.warning)
            warnings.push({ row: rowNo, message: fr.warning });
        let stationId = o.defaultStationId;
        if (cols.station !== undefined) {
            const s = resolveStation(o.stations, cell(r, 'station'));
            if (!s) {
                errors.push({ row: rowNo, message: `Estación no reconocida: «${cell(r, 'station')}».` });
                return;
            }
            stationId = s.id;
        }
        let levelValue = null;
        let levelUnit = '';
        const lv = cell(r, 'level');
        if (lv) {
            levelValue = num(lv.replace(/\s*(dbm|db\s*[µu]v(\s*\/\s*m)?|dbw|kw|w)\s*$/i, ''));
            if (levelValue === null)
                warnings.push({ row: rowNo, message: `Nivel no numérico «${lv}»: se omite.` });
            levelUnit = (cell(r, 'levelUnit') ? levelUnitOf(cell(r, 'levelUnit'), '') : '') || levelUnitOf(cols.level !== undefined ? header[cols.level] ?? '' : '', lv);
            if (levelValue !== null && !levelUnit) {
                levelUnit = 'dBm';
                warnings.push({ row: rowNo, message: 'Nivel sin unidad: se supone dBm.' });
            }
        }
        let bandwidthHz = null;
        const bw = cell(r, 'bandwidth');
        if (bw) {
            const b = parseFrequency(bw, bwUnit);
            if (b.ok)
                bandwidthHz = b.hz;
            else
                warnings.push({ row: rowNo, message: `Ancho de banda no válido «${bw}».` });
        }
        let dt = cell(r, 'datetime');
        if (!dt && (cell(r, 'date') || cell(r, 'time')))
            dt = [cell(r, 'date'), cell(r, 'time')].filter(Boolean).join(' ');
        if (o.fromXlsx && /^\d+(\.\d+)?$/.test(dt) && parseFloat(dt) > 20000 && parseFloat(dt) < 80000)
            dt = excelSerialToISO(parseFloat(dt));
        const status = parseRecordStatus(cell(r, 'status'), o.defaultStatus ?? 'observada_sin_identificar');
        const auth = cell(r, 'authorization');
        const authStatus = /no\s*autoriz|ilegal|sin licencia/i.test(auth) ? 'no_autorizada' : /autoriz|licencia|s[ií]/i.test(auth) ? 'autorizada' : 'desconocida';
        if (authStatus !== 'desconocida')
            warnings.push({ row: rowNo, message: 'Estado de autorización importado: verifique que exista evidencia documental (se registra el texto del archivo como evidencia).' });
        const kind = cell(r, 'dataKind');
        inputs.push({
            stationId: stationId,
            freqHz: fr.hz,
            status,
            datetime: dt,
            levelValue,
            levelUnit,
            bandwidthHz,
            service: cell(r, 'service'),
            emisora: cell(r, 'emisora') || cell(r, 'label'),
            transmitterId: null,
            transmitterConfirmed: false,
            authorization: { status: authStatus, evidence: authStatus === 'desconocida' ? '' : `Según archivo importado: «${auth}»` },
            locality: cell(r, 'locality'),
            notes: [cell(r, 'notes'), cell(r, 'transmitter') ? `Transmisor indicado en el archivo: ${cell(r, 'transmitter')}` : '', cell(r, 'equipment') ? `Equipo: ${cell(r, 'equipment')}` : ''].filter(Boolean).join(' · '),
            sourceId: o.sourceId,
            dataKind: /simul|ejemplo/i.test(kind) ? 'simulado' : o.dataKind,
        });
    });
    return { inputs, errors, warnings, columns: cols, freqUnit: unit, totalRows: body.length };
}
/** Convierte un JSON (lista de objetos) en filas tabulares para el mismo importador. */
export function jsonToRows(text) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (e) {
        return { rows: [], error: 'JSON mal formado: ' + e.message };
    }
    const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray(data.registros) ? data.registros : null;
    if (!list)
        return { rows: [], error: 'Se esperaba una lista de registros (o un objeto con la clave «registros»).' };
    const keys = [];
    for (const it of list)
        if (it && typeof it === 'object' && !Array.isArray(it))
            for (const k of Object.keys(it))
                if (!keys.includes(k) && !DANGEROUS.has(k))
                    keys.push(k);
    const rows = [keys, ...list.map((it) => keys.map((k) => { const v = it && typeof it === 'object' ? it[k] : ''; return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }))];
    return { rows };
}
// ------------------------------------------------------------------ copia de seguridad
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_STRING = 200000;
/** Copia profunda de datos JSON: solo primitivos, arrays y objetos planos; sin claves peligrosas. */
export function sanitize(v, depth = 0) {
    if (depth > 40)
        throw new Error('Estructura demasiado anidada.');
    if (v === null || typeof v === 'boolean')
        return v;
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (typeof v === 'string')
        return v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v;
    if (Array.isArray(v))
        return v.map((x) => sanitize(x, depth + 1));
    if (typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v)) {
            if (DANGEROUS.has(k))
                continue;
            Object.defineProperty(out, k, { value: sanitize(v[k], depth + 1), enumerable: true, writable: true, configurable: true });
        }
        return out;
    }
    return null;
}
/** JSON con claves ordenadas (forma canónica para la suma de verificación). */
export function stableStringify(v) {
    if (v === null || typeof v !== 'object')
        return JSON.stringify(v);
    if (Array.isArray(v))
        return '[' + v.map(stableStringify).join(',') + ']';
    const o = v;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}
export function dbChecksum(db) {
    return sha256Hex(utf8Encode(stableStringify(db)));
}
export function exportBackup(db, now = new Date()) {
    const counts = {};
    for (const c of COLLECTIONS)
        counts[c] = db[c].length;
    const b = { schema: 'orbe-im-analyzer/copia@1', createdAt: now.toISOString(), algorithmVersion: ALGORITHM_VERSION, counts, sha256: dbChecksum(db), data: db };
    return JSON.stringify(b);
}
const STATUSES = Object.keys(RECORD_STATUS_LABEL);
function isStr(x) { return typeof x === 'string'; }
function checkRecord(r, stations, i, e) {
    const w = `records[${i}]`;
    if (!isStr(r.id) || !r.id)
        e.push(`${w}: falta id.`);
    if (!stations.has(r.stationId))
        e.push(`${w}: estación desconocida «${String(r.stationId)}».`);
    if (!Number.isSafeInteger(r.freqHz) || r.freqHz <= 0)
        e.push(`${w}: freqHz no es un entero positivo.`);
    if (!STATUSES.includes(r.status))
        e.push(`${w}: estado desconocido.`);
    if (r.dataKind !== 'real' && r.dataKind !== 'simulado')
        e.push(`${w}: dataKind debe ser «real» o «simulado».`);
    if (!Array.isArray(r.history))
        e.push(`${w}: falta el historial.`);
    if (r.levelValue !== null && typeof r.levelValue !== 'number')
        e.push(`${w}: nivel no numérico.`);
    if (r.authorization && r.authorization.status !== 'desconocida' && !isStr(r.authorization.evidence))
        e.push(`${w}: autorización sin evidencia.`);
}
/**
 * Valida una copia de seguridad. Si hay cualquier error, NO se devuelve base:
 * la restauración es todo o nada.
 */
export function parseBackup(text) {
    const errors = [];
    const warnings = [];
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (e) {
        return { db: null, errors: ['JSON mal formado: ' + e.message], warnings };
    }
    const b = sanitize(raw);
    if (!b || b.schema !== 'orbe-im-analyzer/copia@1')
        return { db: null, errors: ['No es una copia de seguridad de Orbe IM Analyzer.'], warnings };
    const d = b.data;
    if (!d || d.schema !== NATIONAL_SCHEMA)
        return { db: null, errors: ['La copia no contiene una base nacional válida.'], warnings };
    const base = emptyNationalDB();
    for (const c of COLLECTIONS)
        if (!Array.isArray(d[c]))
            errors.push(`Falta la colección «${c}».`);
    if (errors.length)
        return { db: null, errors, warnings };
    if (dbChecksum(d) !== b.sha256)
        errors.push('La suma SHA-256 no coincide: la copia está dañada o fue modificada.');
    for (const c of COLLECTIONS)
        if (b.counts && b.counts[c] !== d[c].length)
            errors.push(`El recuento de «${c}» no coincide con el declarado.`);
    const stationIds = new Set(d.stations.map((s) => s.id));
    if (stationIds.size !== d.stations.length)
        errors.push('Identificadores de estación repetidos.');
    for (const s of d.stations)
        if (!isStr(s.id) || !isStr(s.name) || !s.location)
            errors.push(`Estación mal formada: ${String(s.id)}`);
    const regionIds = new Set(d.regions.map((r) => r.id));
    for (const [p, r] of Object.entries(d.provinceRegion ?? {})) {
        if (!isProvinceId(p))
            errors.push(`Provincia no válida en la asignación: ${p}`);
        if (!regionIds.has(r))
            errors.push(`Región desconocida en la asignación de ${p}: ${r}`);
    }
    for (const s of d.stations)
        if (!regionIds.has(s.regionId))
            errors.push(`La estación ${s.id} apunta a una región inexistente.`);
    d.records.forEach((r, i) => checkRecord(r, stationIds, i, errors));
    const ids = new Set();
    for (const r of d.records) {
        if (ids.has(r.id))
            errors.push(`Registro repetido: ${r.id}`);
        ids.add(r.id);
    }
    if (errors.length)
        return { db: null, errors: errors.slice(0, 50), warnings };
    const db = {
        ...base,
        ...d,
        municipalityRegion: d.municipalityRegion ?? {},
        assignmentHistory: d.assignmentHistory ?? [],
        extraMunicipalities: d.extraMunicipalities ?? [],
        settings: { ...base.settings, ...(d.settings ?? {}) },
    };
    return { db, errors, warnings };
}
