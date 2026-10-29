/** Lista editable de señales (transmisores u observadas) con importación de archivos. */

import type { FreqUnit, SignalClass, SignalImportResult, SignalRecord, SourceInfo } from '../engine/index.js';
import { SIGNAL_CLASS_LABEL, formatMHz, importSignals, makeSignal, parseCSV, parseFrequency, parseManualList, readXlsx, sha256Hex } from '../engine/index.js';
import { h, inflateRawBrowser, mount, num, pickFile, select, toast } from './dom.js';

export const CLASS_OPTIONS = (Object.keys(SIGNAL_CLASS_LABEL) as SignalClass[]).map((c) => ({ value: c, label: SIGNAL_CLASS_LABEL[c] }));

export interface FileRows { rows: string[][]; name: string; bytes: Uint8Array; fromXlsx: boolean; sheet?: string }

/** Lee un CSV/TSV/TXT o la primera hoja con datos de un .xlsx. */
export async function readTableFile(file: File): Promise<FileRows> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.xlsx$/i.test(file.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const sheets = await readXlsx(bytes, inflateRawBrowser);
    const s = sheets.find((x) => x.rows.some((r) => r.some((c) => c.trim() !== ''))) ?? sheets[0];
    if (!s) throw new Error('El libro no contiene hojas.');
    return { rows: s.rows, name: file.name, bytes, fromXlsx: true, sheet: s.name };
  }
  if (/\.xls$/i.test(file.name)) throw new Error('El formato .xls (Excel 97-2003) no está admitido: guárdelo como .xlsx o .csv.');
  const text = new TextDecoder('utf-8').decode(bytes);
  const r = parseCSV(text);
  if (r.errors.length) throw new Error(r.errors.join(' '));
  return { rows: r.rows, name: file.name, bytes, fromXlsx: false };
}

export function sourceInfo(f: FileRows, kind: SourceInfo['kind'], accepted: number, rejected: number): SourceInfo {
  return { name: f.name + (f.sheet ? ` [${f.sheet}]` : ''), kind, sha256: sha256Hex(f.bytes), bytes: f.bytes.length, importedAt: new Date().toISOString(), rowsAccepted: accepted, rowsRejected: rejected };
}

export function importReport(r: SignalImportResult): HTMLElement {
  const m = r.mapping;
  const cols = Object.entries(m.columns).map(([k, v]) => `${k}→col ${(v as number) + 1}`).join(', ');
  return h('div', { class: 'import-report' },
    h('p', null, `${r.signals.length} señales aceptadas de ${r.totalRows} filas; ${r.errors.length} rechazadas. Unidad: ${m.freqUnit} (${m.freqUnitSource}). Columnas: ${cols}.`),
    r.errors.length ? h('details', { open: true }, h('summary', null, `Filas rechazadas (${r.errors.length})`), h('ul', null, ...r.errors.slice(0, 200).map((e) => h('li', null, `Fila ${e.row}: ${e.message}`)))) : null,
    r.warnings.length ? h('details', null, h('summary', null, `Advertencias (${r.warnings.length})`), h('ul', null, ...r.warnings.slice(0, 200).map((e) => h('li', null, (e.row ? `Fila ${e.row}: ` : '') + e.message)))) : null,
  );
}

export interface SignalListOptions {
  title: string;
  kind: 'transmisores' | 'observadas';
  get: () => SignalRecord[];
  set: (list: SignalRecord[], source?: SourceInfo) => void;
  /** Para transmisores: casillas de inclusión en el análisis. */
  selected?: { get: () => Set<string>; set: (ids: Set<string>) => void };
  defaultClass: SignalClass;
  onSelect?: (id: string) => void;
  extraColumns?: (s: SignalRecord) => HTMLElement[];
  extraHeaders?: string[];
}

export class SignalList {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private report: HTMLElement;
  private unit: FreqUnit | 'auto' = 'auto';
  selectedId: string | null = null;

  constructor(private o: SignalListOptions) {
    this.body = h('div', { class: 'table-wrap' });
    this.report = h('div');
    const add = h('input', { type: 'text', placeholder: 'Añadir: 89.30 MHz Emisora', 'aria-label': 'Añadir frecuencia' });
    const doAdd = () => {
      const r = parseManualList(add.value, 'manual');
      if (r.errors.length) { toast(r.errors[0].message, 'error'); return; }
      const list = [...this.o.get(), ...r.signals.map((s) => ({ ...s, classification: this.o.defaultClass }))];
      this.o.set(list);
      if (this.o.selected) { const ids = this.o.selected.get(); r.signals.forEach((s) => ids.add(s.id)); this.o.selected.set(ids); }
      add.value = '';
    };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
    this.root = h('div', { class: 'signal-list' },
      h('div', { class: 'toolbar' },
        add, h('button', { type: 'button', onclick: doAdd }, 'Añadir'),
        h('button', { type: 'button', onclick: () => this.importFile() }, 'Importar CSV / Excel…'),
        select([{ value: 'auto', label: 'Unidad: automática' }, { value: 'MHz', label: 'MHz' }, { value: 'kHz', label: 'kHz' }, { value: 'Hz', label: 'Hz' }, { value: 'GHz', label: 'GHz' }], this.unit, (v) => { this.unit = v as FreqUnit; }, { 'aria-label': 'Unidad de frecuencia del archivo' }),
        h('button', { type: 'button', class: 'danger', onclick: () => { if (this.o.get().length && confirm(`¿Vaciar la lista de ${this.o.title.toLowerCase()}?`)) this.o.set([]); } }, 'Vaciar'),
      ),
      this.report,
      this.body,
    );
  }

  async importFile(): Promise<void> {
    const file = await pickFile('.csv,.tsv,.txt,.xlsx');
    if (!file) return;
    try {
      const f = await readTableFile(file);
      const r = importSignals(f.rows, { unit: this.unit, source: f.name, defaultClassification: this.o.defaultClass, fromXlsx: f.fromXlsx });
      mount(this.report, importReport(r));
      if (!r.signals.length) { toast('No se importó ninguna señal.', 'error'); return; }
      const src = sourceInfo(f, this.o.kind, r.signals.length, r.errors.length);
      const replace = this.o.get().length > 0 && confirm(`Se leyeron ${r.signals.length} señales. ¿Reemplazar la lista actual? (Cancelar = añadirlas)`);
      const list = replace ? r.signals : [...this.o.get(), ...r.signals];
      this.o.set(list, src);
      if (this.o.selected) { const ids = replace ? new Set<string>() : this.o.selected.get(); r.signals.forEach((s) => ids.add(s.id)); this.o.selected.set(ids); }
      toast(`Importadas ${r.signals.length} señales de ${f.name}`, 'ok');
    } catch (e) {
      toast((e as Error).message, 'error');
      mount(this.report, h('p', { class: 'error' }, (e as Error).message));
    }
  }

  render(): void {
    const list = [...this.o.get()].sort((a, b) => a.freqHz - b.freqHz);
    const sel = this.o.selected?.get();
    if (!list.length) { mount(this.body, h('p', { class: 'empty' }, 'Lista vacía.')); return; }
    const upd = (id: string, patch: Partial<SignalRecord>) => this.o.set(this.o.get().map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const head = [...(sel ? ['Incluir'] : []), 'Frecuencia (MHz)', 'Identificación', 'Nivel (dBm)', 'Fecha y hora', 'Equipo', 'Clasificación', 'Observaciones', ...(this.o.extraHeaders ?? []), ''];
    mount(this.body, h('table', { class: 'data editable' },
      h('thead', null, h('tr', null, ...head.map((t) => h('th', null, t)))),
      h('tbody', null, ...list.map((s) => h('tr', { class: s.id === this.selectedId ? 'sel' : '', onclick: (e: Event) => { if ((e.target as HTMLElement).tagName === 'TD') { this.selectedId = s.id; this.o.onSelect?.(s.id); } } },
        sel ? h('td', null, h('input', { type: 'checkbox', checked: sel.has(s.id), 'aria-label': 'Incluir en el análisis', onchange: (e: Event) => { const ids = new Set(sel); if ((e.target as HTMLInputElement).checked) ids.add(s.id); else ids.delete(s.id); this.o.selected!.set(ids); } })) : null,
        h('td', null, h('input', { type: 'text', class: 'num narrow', value: formatMHz(s.freqHz, 3), 'aria-label': 'Frecuencia', onchange: (e: Event) => { const r = parseFrequency((e.target as HTMLInputElement).value); if (r.ok) upd(s.id, { freqHz: r.hz }); else { toast(r.error ?? 'Frecuencia no válida', 'error'); (e.target as HTMLInputElement).value = formatMHz(s.freqHz, 3); } } })),
        h('td', null, h('input', { type: 'text', value: s.label, 'aria-label': 'Identificación', onchange: (e: Event) => upd(s.id, { label: (e.target as HTMLInputElement).value }) })),
        h('td', null, h('input', { type: 'text', class: 'num narrow', value: s.levelDbm ?? '', placeholder: s.levelRaw ?? '', 'aria-label': 'Nivel dBm', onchange: (e: Event) => upd(s.id, { levelDbm: num((e.target as HTMLInputElement).value) }) })),
        h('td', null, h('input', { type: 'text', value: s.datetime, 'aria-label': 'Fecha y hora', onchange: (e: Event) => upd(s.id, { datetime: (e.target as HTMLInputElement).value }) })),
        h('td', null, h('input', { type: 'text', class: 'narrow', value: s.equipment, 'aria-label': 'Equipo', onchange: (e: Event) => upd(s.id, { equipment: (e.target as HTMLInputElement).value }) })),
        h('td', null, select(CLASS_OPTIONS, s.classification, (v) => upd(s.id, { classification: v as SignalClass }), { 'aria-label': 'Clasificación' })),
        h('td', null, h('input', { type: 'text', value: s.notes, 'aria-label': 'Observaciones', onchange: (e: Event) => upd(s.id, { notes: (e.target as HTMLInputElement).value }) })),
        ...(this.o.extraColumns ? this.o.extraColumns(s) : []),
        h('td', null, h('button', { type: 'button', class: 'icon', title: 'Eliminar', 'aria-label': 'Eliminar', onclick: () => this.o.set(this.o.get().filter((x) => x.id !== s.id)) }, '×')),
      ))),
    ));
  }
}

export function signalsFromText(text: string, cls: SignalClass): { signals: SignalRecord[]; errors: string[] } {
  const r = parseManualList(text);
  return { signals: r.signals.map((s) => makeSignal(s.freqHz, { ...s, classification: cls })), errors: r.errors.map((e) => `Línea ${e.row}: ${e.message}`) };
}
