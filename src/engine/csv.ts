/**
 * CSV conforme a RFC 4180 (comillas, comillas dobladas, saltos de línea
 * dentro de campos), con detección del separador (, ; tabulador |) y
 * eliminación del BOM.
 */

export type Cell = string | number | boolean | null | undefined;

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 20);
  const cands = [',', ';', '\t', '|'];
  let best = ',', bestScore = -1;
  for (const d of cands) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    if (!counts.length || counts[0] === 0) continue;
    const same = counts.filter((c) => c === counts[0]).length;
    const score = same * 100 + counts[0];
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0, q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

export interface CsvParseResult {
  rows: string[][];
  delimiter: string;
  errors: string[];
}

export function parseCSV(input: string, delimiter?: string): CsvParseResult {
  const text = input.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  const errors: string[] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  let i = 0;
  let line = 1;
  let quoteStartLine = 0;
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      if (ch === '\n') line++;
      field += ch; i++; continue;
    }
    if (ch === '"') {
      if (field.trim() === '') { field = ''; q = true; quoteStartLine = line; i++; continue; }
      field += ch; i++; continue; // comilla suelta dentro de un campo sin comillas
    }
    if (ch === d) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++; line++;
      continue;
    }
    field += ch; i++;
  }
  if (q) errors.push(`Comillas sin cerrar desde la línea ${quoteStartLine}.`);
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // descarta filas completamente vacías al final
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return { rows, delimiter: d, errors };
}

function quote(v: Cell, d: string): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  if (s.includes(d) || s.includes('"') || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Serializa filas a CSV (CRLF, UTF-8 con BOM opcional para hojas de cálculo). */
export function toCSV(rows: Cell[][], delimiter = ',', bom = true): string {
  return (bom ? '﻿' : '') + rows.map((r) => r.map((c) => quote(c, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}
