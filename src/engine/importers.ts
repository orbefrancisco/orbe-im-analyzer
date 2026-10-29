/**
 * Importación de listas de frecuencias (emisoras, mediciones de SCORPIO u
 * otros analizadores exportadas a CSV/XLSX) y de trazas de espectro.
 *
 * No se conoce un formato nativo público de SCORPIO; se admite cualquier
 * tabla con una columna de frecuencia, detectando las columnas por el nombre
 * de la cabecera. Toda fila rechazada se informa con su número: nunca se
 * descartan datos en silencio.
 */

import type { FreqUnit } from './freq.js';
import { normalizeUnit, parseDecimal, parseFrequency } from './freq.js';
import type { SignalClass, SignalRecord } from './model.js';
import { makeSignal } from './model.js';
import { excelSerialToISO } from './xlsx.js';

export type ColumnRole = 'freq' | 'level' | 'label' | 'datetime' | 'date' | 'time' | 'equipment' | 'notes' | 'classification';

const PATTERNS: [ColumnRole, RegExp][] = [
  ['classification', /^(clasif|classif|class\b|clase|estado|status|categor)/i],
  ['freq', /(^f$|^fc$|freq|frec|frequency|frecuencia|center|centro|portadora|carrier)/i],
  ['level', /(nivel|level|power|potencia|dbm|dbµv|dbuv|dbµv|amplitud|amplitude|rssi|intensidad|field|campo)/i],
  ['datetime', /(timestamp|fecha.?hora|date.?time|fecha y hora)/i],
  ['date', /^(fecha|date|día|dia)$/i],
  ['time', /^(hora|time)$/i],
  ['equipment', /(equipo|device|receiver|receptor|instrument|analizador|analyzer|equipment|estaci[oó]n de monitoreo|sensor)/i],
  ['notes', /(observ|notes|nota|comment|coment|remark)/i],
  ['label', /(emisora|station|nombre|name|identif|call|indicativo|servicio|titular|^id$|etiqueta|label)/i],
];

export interface ColumnMapping {
  hasHeader: boolean;
  columns: Partial<Record<ColumnRole, number>>;
  freqUnit: FreqUnit;
  freqUnitSource: 'cabecera' | 'usuario' | 'inferida';
  /** 'otra' = kW, W, dBW, dBµV/m…: no convertible a dBm en la entrada del receptor; se guarda como texto. */
  levelUnit: 'dBm' | 'dBµV' | 'otra' | 'desconocida';
}

export interface ImportIssue {
  row: number;
  message: string;
}

export interface SignalImportResult {
  signals: SignalRecord[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  mapping: ColumnMapping;
  totalRows: number;
}

function isNumeric(s: string): boolean {
  return parseDecimal(String(s).replace(UNIT_TAIL, '')) !== null;
}

const UNIT_TAIL = /\s*(ghz|mhz|khz|hz)\s*$/i;

export function detectColumns(rows: string[][]): { hasHeader: boolean; columns: Partial<Record<ColumnRole, number>>; headerUnit: FreqUnit | null; levelUnit: ColumnMapping['levelUnit'] } {
  const first = rows[0] ?? [];
  const nonEmpty = first.filter((c) => String(c).trim() !== '');
  const hasHeader = nonEmpty.length > 0 && nonEmpty.some((c) => !isNumeric(c));
  const columns: Partial<Record<ColumnRole, number>> = {};
  let headerUnit: FreqUnit | null = null;
  let levelUnit: ColumnMapping['levelUnit'] = 'desconocida';
  if (hasHeader) {
    first.forEach((h, i) => {
      const name = String(h).trim();
      if (!name) return;
      for (const [role, re] of PATTERNS) {
        if (columns[role] === undefined && re.test(name)) {
          // «Nivel» no debe confundirse con «frecuencia»; el primer patrón que encaja gana
          columns[role] = i;
          if (role === 'freq') {
            const um = /(ghz|mhz|khz|hz)/i.exec(name);
            if (um) headerUnit = normalizeUnit(um[1]);
          }
          if (role === 'level') {
            if (/\/m|kw|\bw\b|\(w\)|dbw|\berp\b|\bpra\b/i.test(name)) levelUnit = 'otra';
            else if (/db\s*[µu]v/i.test(name)) levelUnit = 'dBµV';
            else if (/dbm/i.test(name)) levelUnit = 'dBm';
          }
          break;
        }
      }
    });
  } else {
    // sin cabecera: 1.ª columna = frecuencia; 2.ª = nivel si es numérica; 3.ª = etiqueta
    columns.freq = 0;
    if (first.length > 1 && isNumeric(first[1])) { columns.level = 1; if (first.length > 2) columns.label = 2; }
    else if (first.length > 1) columns.label = 1;
  }
  return { hasHeader, columns, headerUnit, levelUnit };
}

/** Infiere la unidad a partir de la magnitud de los valores (solo si no hay unidad en la cabecera ni la elige el usuario). */
export function inferUnit(values: string[]): FreqUnit {
  const nums = values
    .map((v) => parseDecimal(v))
    .filter((d): d is NonNullable<typeof d> => d !== null && !d.negative)
    .map((d) => Number(d.digits) * 10 ** d.exp10)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  if (!nums.length) return 'MHz';
  const median = nums[Math.floor(nums.length / 2)];
  if (median >= 1e6) return 'Hz';
  if (median >= 1e4) return 'kHz';
  return 'MHz';
}

const CLASS_MAP: [RegExp, SignalClass][] = [
  [/confirm/i, 'portadora_confirmada'],
  [/sospech|suspect/i, 'sospechosa'],
  [/observ/i, 'senal_observada'],
];

export function parseClassification(s: string): SignalClass {
  const t = String(s ?? '').trim();
  for (const [re, c] of CLASS_MAP) if (re.test(t)) return c;
  return 'desconocida';
}

export interface SignalImportOptions {
  /** Unidad elegida por el usuario; 'auto' usa la cabecera o la infiere. */
  unit?: FreqUnit | 'auto';
  source: string;
  defaultClassification?: SignalClass;
  /** Columnas forzadas por el usuario. */
  columns?: Partial<Record<ColumnRole, number>>;
  /** Las columnas de fecha procedentes de .xlsx pueden ser números seriales. */
  fromXlsx?: boolean;
}

export function importSignals(rows: string[][], opt: SignalImportOptions): SignalImportResult {
  const det = detectColumns(rows);
  const columns = { ...det.columns, ...(opt.columns ?? {}) };
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const start = det.hasHeader ? 1 : 0;
  const body = rows.slice(start);
  if (columns.freq === undefined) {
    errors.push({ row: 1, message: 'No se encontró ninguna columna de frecuencia (cabeceras aceptadas: Frecuencia, Freq, Frequency, f, MHz…).' });
    return { signals: [], errors, warnings, mapping: { hasHeader: det.hasHeader, columns, freqUnit: 'MHz', freqUnitSource: 'inferida', levelUnit: det.levelUnit }, totalRows: body.length };
  }
  let unit: FreqUnit;
  let src: ColumnMapping['freqUnitSource'];
  if (opt.unit && opt.unit !== 'auto') { unit = opt.unit; src = 'usuario'; }
  else if (det.headerUnit) { unit = det.headerUnit; src = 'cabecera'; }
  else {
    unit = inferUnit(body.map((r) => String(r[columns.freq as number] ?? '').replace(UNIT_TAIL, '')));
    src = 'inferida';
    warnings.push({ row: 0, message: `Unidad de frecuencia inferida por la magnitud de los valores: ${unit}. Compruébela.` });
  }
  const mapping: ColumnMapping = { hasHeader: det.hasHeader, columns, freqUnit: unit, freqUnitSource: src, levelUnit: det.levelUnit };
  if (det.levelUnit === 'desconocida' && columns.level !== undefined) warnings.push({ row: 0, message: 'La cabecera del nivel no indica unidad: se supone dBm.' });
  if (det.levelUnit === 'otra') warnings.push({ row: 0, message: 'El nivel no está en dBm ni dBµV (p. ej. kW, dBµV/m): se conserva como texto y no se usa en cálculos.' });
  if (det.levelUnit === 'dBµV') warnings.push({ row: 0, message: 'Niveles en dBµV convertidos a dBm suponiendo 50 Ω (dBm = dBµV − 107).' });
  const cell = (r: string[], role: ColumnRole) => (columns[role] !== undefined ? String(r[columns[role] as number] ?? '').trim() : '');
  const signals: SignalRecord[] = [];
  const seen = new Map<number, number>();
  body.forEach((r, i) => {
    const rowNo = i + start + 1;
    if (r.every((c) => String(c ?? '').trim() === '')) return;
    const fr = parseFrequency(cell(r, 'freq'), unit);
    if (!fr.ok) { errors.push({ row: rowNo, message: fr.error ?? 'frecuencia no válida' }); return; }
    if (fr.warning) warnings.push({ row: rowNo, message: fr.warning });
    let levelDbm: number | null = null;
    let levelRaw: string | undefined;
    const lv = cell(r, 'level');
    if (lv) {
      const d = parseDecimal(lv.replace(/\s*(dbm|dbµv|dbuv)\s*$/i, ''));
      if (!d) { warnings.push({ row: rowNo, message: `Nivel no numérico «${lv}»: se conserva como texto.` }); levelRaw = lv; }
      else {
        const v = (d.negative ? -1 : 1) * Number(d.digits) * 10 ** d.exp10;
        if (det.levelUnit === 'dBµV') levelDbm = Math.round((v - 107) * 1000) / 1000;
        else if (det.levelUnit === 'otra') levelRaw = lv;
        else levelDbm = v;
        if (det.levelUnit === 'desconocida') levelRaw = lv;
      }
    }
    let dt = cell(r, 'datetime');
    if (!dt && (cell(r, 'date') || cell(r, 'time'))) dt = [cell(r, 'date'), cell(r, 'time')].filter(Boolean).join(' ');
    if (opt.fromXlsx && dt && /^\d+(\.\d+)?$/.test(dt) && parseFloat(dt) > 20000 && parseFloat(dt) < 80000) dt = excelSerialToISO(parseFloat(dt));
    const cls = columns.classification !== undefined ? parseClassification(cell(r, 'classification')) : opt.defaultClassification ?? 'desconocida';
    const s = makeSignal(fr.hz, {
      label: cell(r, 'label'),
      levelDbm,
      levelRaw,
      datetime: dt,
      equipment: cell(r, 'equipment'),
      notes: cell(r, 'notes'),
      classification: cls,
      source: opt.source,
    });
    if (seen.has(fr.hz)) warnings.push({ row: rowNo, message: `Frecuencia repetida (también en la fila ${seen.get(fr.hz)}).` });
    else seen.set(fr.hz, rowNo);
    signals.push(s);
  });
  if (!signals.length && !errors.length) errors.push({ row: 0, message: 'El archivo no contiene filas de datos.' });
  return { signals, errors, warnings, mapping, totalRows: body.length };
}

/** Lista escrita a mano: una frecuencia por línea, con texto opcional después («89.30 MHz Emisora X»). */
export function parseManualList(text: string, source = 'manual'): SignalImportResult {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const signals: SignalRecord[] = [];
  const seen = new Map<number, number>();
  text.split(/\r?\n/).forEach((line, i) => {
    const raw = line.replace(/#.*$/, '').trim();
    if (!raw) return;
    const m = /^([0-9.,eE+]+)\s*(ghz|mhz|khz|hz)?\s*[,;\t]?\s*(.*)$/i.exec(raw.replace(/^f\d*\s*=\s*/i, ''));
    if (!m) { errors.push({ row: i + 1, message: `No se reconoce una frecuencia en «${raw}».` }); return; }
    const fr = parseFrequency(m[1] + (m[2] ? ' ' + m[2] : ''), 'MHz');
    if (!fr.ok) { errors.push({ row: i + 1, message: fr.error ?? 'frecuencia no válida' }); return; }
    if (fr.warning) warnings.push({ row: i + 1, message: fr.warning });
    if (seen.has(fr.hz)) warnings.push({ row: i + 1, message: `Frecuencia repetida (también en la línea ${seen.get(fr.hz)}).` });
    else seen.set(fr.hz, i + 1);
    signals.push(makeSignal(fr.hz, { label: m[3].trim(), source }));
  });
  return { signals, errors, warnings, mapping: { hasHeader: false, columns: { freq: 0 }, freqUnit: 'MHz', freqUnitSource: 'usuario', levelUnit: 'desconocida' }, totalRows: text.split(/\r?\n/).length };
}

// ---------------------------------------------------------------- trazas de espectro

export interface TracePoint {
  hz: number;
  dbm: number;
}

export interface TraceImportResult {
  points: TracePoint[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  unit: FreqUnit;
}

export function importTrace(rows: string[][], unitOpt: FreqUnit | 'auto' = 'auto'): TraceImportResult {
  const det = detectColumns(rows);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const start = det.hasHeader ? 1 : 0;
  const fc = det.columns.freq ?? 0;
  const lc = det.columns.level ?? (fc === 0 ? 1 : 0);
  const body = rows.slice(start);
  const unit: FreqUnit = unitOpt !== 'auto' ? unitOpt : det.headerUnit ?? inferUnit(body.map((r) => String(r[fc] ?? '')));
  if (unitOpt === 'auto' && !det.headerUnit) warnings.push({ row: 0, message: `Unidad de frecuencia de la traza inferida: ${unit}.` });
  const pts: TracePoint[] = [];
  body.forEach((r, i) => {
    if (r.every((c) => String(c ?? '').trim() === '')) return;
    const fr = parseFrequency(String(r[fc] ?? ''), unit);
    const d = parseDecimal(String(r[lc] ?? ''));
    if (!fr.ok || !d) { errors.push({ row: i + start + 1, message: 'Fila de traza sin frecuencia o nivel numérico.' }); return; }
    pts.push({ hz: fr.hz, dbm: (d.negative ? -1 : 1) * Number(d.digits) * 10 ** d.exp10 });
  });
  pts.sort((a, b) => a.hz - b.hz);
  if (pts.length < 2) errors.push({ row: 0, message: 'Una traza necesita al menos dos puntos.' });
  return { points: pts, errors, warnings, unit };
}

/**
 * Picos locales de una traza por encima de un umbral. Los picos se proponen
 * como «señal observada»; el usuario decide si los incorpora.
 */
export function findPeaks(points: TracePoint[], thresholdDbm: number, minSeparationHz: number): TracePoint[] {
  const cands: TracePoint[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (p.dbm >= thresholdDbm && p.dbm >= points[i - 1].dbm && p.dbm > points[i + 1].dbm) cands.push(p);
  }
  cands.sort((a, b) => b.dbm - a.dbm);
  const kept: TracePoint[] = [];
  for (const c of cands) if (kept.every((k) => Math.abs(k.hz - c.hz) >= minSeparationHz)) kept.push(c);
  return kept.sort((a, b) => a.hz - b.hz);
}
