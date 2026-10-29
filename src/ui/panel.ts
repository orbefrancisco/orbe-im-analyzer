/** Panel de resultados reutilizable: completitud, resumen, espectro, tabla y exportación. */

import type { AnalysisRun, AttenuationAnalysis, AuditResult, Project, SignalRecord, TracePoint } from '../engine/index.js';
import {
  analysisJson, analyzeAttenuation, auditReport, combosRows, completenessStatement, formatBig, matchesRows, productsRows, summarize, toCSV, workbookSheets, writeXlsx,
} from '../engine/index.js';
import { download, h, mount, stamp } from './dom.js';
import { Spectrum, type SpectrumSelection } from './spectrum.js';
import { ResultsTable } from './table.js';

export interface PanelSource {
  getRun: () => AnalysisRun | null;
  getAudit: () => AuditResult | null;
  getProject: () => Project | null;
  getObserved: () => SignalRecord[];
  getTransmitters: () => SignalRecord[];
  getTrace: () => TracePoint[] | null;
  toleranceHz: () => number;
  filePrefix: string;
  isStale?: () => boolean;
}

export function labAnalyses(p: Project | null): Map<string, AttenuationAnalysis> {
  const m = new Map<string, AttenuationAnalysis>();
  if (!p) return m;
  const carriers = p.transmitters.map((t) => ({ label: t.label, freqHz: t.freqHz, levelDbm: t.levelDbm }));
  for (const t of p.labTests) {
    try { m.set(t.id, analyzeAttenuation(t, { carriers, adjacentWindowHz: 400_000, spurToleranceHz: Math.max(p.params.toleranceHz, 1000) })); } catch { /* prueba incompleta */ }
  }
  return m;
}

export class ResultsPanel {
  readonly root: HTMLElement;
  readonly table: ResultsTable;
  readonly spectrum: Spectrum;
  private summary: HTMLElement;
  private exportsBox: HTMLElement;
  selectedGroup: number | null = null;
  selectedObservedId: string | null = null;

  constructor(private src: PanelSource, private onSpectrumSelect?: (s: SpectrumSelection) => void) {
    this.summary = h('div', { class: 'summary' });
    this.exportsBox = h('div', { class: 'exports' });
    const specBox = h('div', { class: 'card' });
    this.table = new ResultsTable({
      getRun: src.getRun,
      getAudit: src.getAudit,
      toleranceHz: src.toleranceHz,
      onSelectGroup: (g) => this.select(g),
    });
    this.root = h('div', { class: 'panel' }, this.summary, specBox, h('div', { class: 'card' }, h('h3', null, 'Tabla de resultados'), this.table.root), this.exportsBox);
    this.spectrum = new Spectrum(specBox, (s) => {
      if (s.kind === 'producto') this.select(s.group, false);
      else if (s.kind === 'observada') { this.selectedObservedId = s.id; this.redrawSpectrum(); }
      this.onSpectrumSelect?.(s);
    });
  }

  select(g: number | null, center = true): void {
    this.selectedGroup = g;
    this.table.selectGroup(g);
    const run = this.src.getRun();
    if (run && g !== null && center) this.spectrum.centerOn(run.result.groupFreq[g]);
    this.redrawSpectrum();
  }

  redrawSpectrum(keepView = true): void {
    const run = this.src.getRun();
    const p = this.src.getProject();
    this.spectrum.setData({
      rs: run?.result ?? null,
      transmitters: this.src.getTransmitters(),
      observed: this.src.getObserved(),
      trace: this.src.getTrace(),
      band: run?.params.band ?? p?.params.band ?? { minHz: 88e6, maxHz: 108e6, name: 'FM' },
      groupClass: this.src.getAudit()?.groupClass ?? null,
      selectedGroup: this.selectedGroup,
      selectedObservedId: this.selectedObservedId,
    }, keepView);
  }

  refresh(resetPage = false): void {
    const run = this.src.getRun();
    if (run && this.selectedGroup !== null && this.selectedGroup >= run.result.groupCount) this.selectedGroup = null;
    this.table.selected = this.selectedGroup;
    this.renderSummary();
    this.table.refresh(resetPage);
    this.redrawSpectrum();
    this.renderExports();
  }

  private renderSummary(): void {
    const run = this.src.getRun();
    if (!run) { mount(this.summary); return; }
    const s = summarize(run.result);
    const m = run.meta;
    mount(this.summary,
      h('div', { class: 'banner ' + (m.complete ? 'ok' : 'bad'), role: 'status' }, m.complete ? '✔ ' : '✖ ', completenessStatement(m)),
      this.src.isStale?.() ? h('div', { class: 'banner warn' }, '⚠ Los datos o parámetros cambiaron después de este cálculo: los resultados mostrados corresponden al cálculo anterior. Vuelva a calcular.') : null,
      h('div', { class: 'stats' },
        stat('Frecuencias distintas', String(s.groups)),
        stat('Combinaciones', String(s.combos)),
        stat('Dentro de la banda', String(s.inBandGroups)),
        stat('Frecuencias con varias combinaciones', String(s.coincidentGroups)),
        stat('Generadores', String(run.generators.length)),
        stat('Tiempo', `${m.elapsedMs} ms`),
      ),
      h('details', null, h('summary', null, 'Desglose por orden nominal y espacio de búsqueda'),
        h('table', { class: 'data compact' },
          h('thead', null, h('tr', null, h('th', null, 'Orden'), h('th', null, 'Combinaciones'), h('th', null, 'Frecuencias (orden mínimo)'))),
          h('tbody', null, ...s.byOrder.map((r) => h('tr', null, h('td', null, String(r.order)), h('td', { class: 'num' }, String(r.combos)), h('td', { class: 'num' }, String(r.groups))))),
        ),
        h('p', { class: 'hint' }, `Vectores candidatos: ${formatBig(BigInt(m.candidates))} · cota de nodos: ${formatBig(BigInt(m.workBound))} · recorridos: ${formatBig(BigInt(m.visited))} · ramas podadas: ${formatBig(BigInt(m.pruned))} · versión del algoritmo ${m.algorithmVersion} · ${m.analysisDate}`),
      ),
    );
  }

  private renderExports(): void {
    const run = this.src.getRun();
    if (!run) { mount(this.exportsBox); return; }
    const pre = `${this.src.filePrefix}-${stamp()}`;
    const au = this.src.getAudit();
    const p = this.src.getProject();
    const big = run.result.store.count > 300_000;
    mount(this.exportsBox, h('div', { class: 'card' },
      h('h3', null, 'Exportación científica'),
      big ? h('p', { class: 'warn' }, `⚠ ${run.result.store.count} combinaciones: los archivos de combinaciones, Excel y JSON pueden ser muy grandes.`) : null,
      h('div', { class: 'toolbar wrap' },
        h('button', { type: 'button', onclick: () => download(`${pre}-productos.csv`, toCSV(productsRows(run, au)), 'text/csv;charset=utf-8') }, 'CSV · productos'),
        h('button', { type: 'button', onclick: () => download(`${pre}-combinaciones.csv`, toCSV(combosRows(run)), 'text/csv;charset=utf-8') }, 'CSV · todas las combinaciones'),
        h('button', { type: 'button', disabled: !au, onclick: () => au && download(`${pre}-coincidencias.csv`, toCSV(matchesRows(run, au)), 'text/csv;charset=utf-8') }, 'CSV · coincidencias observadas'),
        h('button', { type: 'button', onclick: () => download(`${pre}.xlsx`, writeXlsx(workbookSheets(run, p, au, labAnalyses(p))), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') }, 'Excel (hojas separadas)'),
        h('button', { type: 'button', onclick: () => download(`${pre}.json`, JSON.stringify(analysisJson(run, p, au, labAnalyses(p)), null, 1), 'application/json') }, 'JSON trazable'),
        h('button', { type: 'button', onclick: () => download(`${pre}-auditoria.md`, auditReport(run, p, au, labAnalyses(p)), 'text/markdown;charset=utf-8') }, 'Informe de auditoría (.md)'),
      ),
    ));
  }
}

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, value), h('div', { class: 'stat-l' }, label));
}
