/** Sección «Calculadora»: frecuencias escritas a mano, cálculo inmediato y tabla clásica de dos tonos. */

import type { AnalysisParams, AnalysisRun, AuditResult, SignalRecord } from '../engine/index.js';
import { DEFAULT_PARAMS, FM_BAND, audit, estimateSearchSpace, findGroup, formatMHz, inBand, parseManualList, runAnalysis, makeSignal } from '../engine/index.js';
import { field, h, mount, toast } from './dom.js';
import { computeAsync } from './compute.js';
import { ResultsPanel } from './panel.js';
import { orderControl, toleranceControl } from './params.js';
import { store } from './state.js';

const KEY = 'orbe-im/calculadora';

interface CalcState { freqs: string; observed: string; params: AnalysisParams }

function load(): CalcState {
  const def: CalcState = {
    freqs: '89.30 MHz\n89.58 MHz',
    observed: '89.85 MHz\n88.74 MHz',
    params: { ...DEFAULT_PARAMS, band: { ...FM_BAND }, maxOrder: 9, maxTones: 3, toleranceHz: 10_000 },
  };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s.freqs === 'string') return { ...def, ...s, params: { ...def.params, ...s.params } };
  } catch { /* valores por defecto */ }
  return def;
}

export function calculatorView(root: HTMLElement, goToAnalyzer: () => void): { render: () => void } {
  const st = load();
  let run: AnalysisRun | null = null;
  let au: AuditResult | null = null;
  let gens: SignalRecord[] = [];
  let obs: SignalRecord[] = [];
  const save = () => localStorage.setItem(KEY, JSON.stringify(st));
  const freqTa = h('textarea', { rows: 7, spellcheck: 'false', 'aria-label': 'Frecuencias transmisoras' }, st.freqs);
  const obsTa = h('textarea', { rows: 4, spellcheck: 'false', 'aria-label': 'Señales observadas' }, st.observed);
  const msg = h('div', { class: 'messages' });
  const classic = h('div');
  const controls = h('div', { class: 'grid' });
  const panel = new ResultsPanel({
    getRun: () => run,
    getAudit: () => au,
    getProject: () => null,
    getObserved: () => obs,
    getTransmitters: () => gens,
    getTrace: () => null,
    toleranceHz: () => st.params.toleranceHz,
    filePrefix: 'orbe-im-calculadora',
  });

  const renderControls = () => {
    const p = st.params;
    const upd = (patch: Partial<AnalysisParams>) => { st.params = { ...st.params, ...patch }; save(); renderControls(); };
    mount(controls,
      field('Orden máximo', orderControl(p.maxOrder, (n) => upd({ maxOrder: n }))),
      field('Máx. señales por combinación', h('input', { type: 'number', min: '1', max: '12', value: String(p.maxTones), class: 'narrow', onchange: (e: Event) => { const n = parseInt((e.target as HTMLInputElement).value, 10); if (n >= 1) upd({ maxTones: n }); } })),
      field('Productos', h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.outputMode === 'todo', onchange: (e: Event) => upd({ outputMode: (e.target as HTMLInputElement).checked ? 'todo' : 'banda' }) }), 'incluir fuera de la banda 88–108 MHz')),
      field('Armónicos puros', h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.includeHarmonics, onchange: (e: Event) => upd({ includeHarmonics: (e.target as HTMLInputElement).checked }) }), 'incluir')),
      field('Tolerancia', toleranceControl(p.toleranceHz, (hz) => { upd({ toleranceHz: hz }); if (run) { au = audit(run, obs, hz, [], []); panel.refresh(); } })),
    );
  };

  const calc = async () => {
    st.freqs = freqTa.value;
    st.observed = obsTa.value;
    save();
    const g = parseManualList(st.freqs, 'calculadora');
    const o = parseManualList(st.observed, 'calculadora');
    const errs = [...g.errors.map((e) => `Frecuencias, línea ${e.row}: ${e.message}`), ...o.errors.map((e) => `Observadas, línea ${e.row}: ${e.message}`)];
    const warns = [...g.warnings, ...o.warnings].map((w) => `Línea ${w.row}: ${w.message}`);
    mount(msg, ...errs.map((e) => h('p', { class: 'error' }, e)), ...warns.map((w) => h('p', { class: 'warn' }, w)));
    if (!g.signals.length) { toast('Introduzca al menos una frecuencia.', 'error'); return; }
    gens = g.signals.map((s, i) => ({ ...s, id: `c${i + 1}` })).sort((a, b) => a.freqHz - b.freqHz);
    obs = o.signals.map((s, i) => makeSignal(s.freqHz, { ...s, id: `o${i + 1}`, classification: 'senal_observada' }));
    const est = estimateSearchSpace({ nGenerators: gens.length, maxOrder: st.params.maxOrder, maxTones: st.params.maxTones, includeHarmonics: st.params.includeHarmonics });
    try {
      if (est.workBound < 2_000_000n) run = runAnalysis(gens, st.params);
      else {
        mount(classic, h('p', { class: 'hint' }, 'Calculando en segundo plano…'));
        run = await computeAsync(gens, st.params, () => undefined).promise;
      }
    } catch (e) { toast((e as Error).message, 'error'); return; }
    au = audit(run, obs, st.params.toleranceHz, [], []);
    renderClassic();
    panel.selectedGroup = null;
    panel.refresh(true);
    panel.redrawSpectrum(false);
  };

  const renderClassic = () => {
    if (!run || gens.length !== 2) { mount(classic); return; }
    const [f1, f2] = gens.map((g) => g.freqHz);
    const rows: HTMLElement[] = [];
    for (let n = 3; n <= st.params.maxOrder; n += 2) {
      const k = (n - 1) / 2;
      const lo = (k + 1) * f1 - k * f2;
      const hi = (k + 1) * f2 - k * f1;
      const cell = (f: number) => {
        const present = run && findGroup(run.result, f) >= 0;
        return h('td', { class: 'num' }, f > 0 ? formatMHz(f) : '—', present ? '' : h('span', { class: 'hint' }, inBand(f, run!.params.band) ? ' (no calculado)' : ' (fuera de banda)'));
      };
      rows.push(h('tr', null, h('td', null, `IM${n}`), h('td', { class: 'formula' }, `${k + 1}f1 − ${k}f2`), cell(lo), h('td', { class: 'formula' }, `${k + 1}f2 − ${k}f1`), cell(hi)));
    }
    mount(classic, h('div', { class: 'card' },
      h('h3', null, `Productos de dos tonos con Σmᵢ = 1 (f1 = ${formatMHz(f1)} MHz, f2 = ${formatMHz(f2)} MHz)`),
      h('table', { class: 'data compact' },
        h('thead', null, h('tr', null, ...['Orden', 'Fórmula', 'Frecuencia inferior (MHz)', 'Fórmula', 'Frecuencia superior (MHz)'].map((t) => h('th', null, t)))),
        h('tbody', null, ...rows)),
      h('p', { class: 'hint' }, 'Separación Δ = f2 − f1; los productos impares cercanos son f1 − kΔ y f2 + kΔ. Esta tabla es un resumen: la tabla completa de abajo enumera TODOS los vectores de coeficientes dentro del alcance.'),
    ));
  };

  mount(root,
    h('div', { class: 'section-intro' },
      h('h2', null, 'Calculadora'),
      h('p', null, 'Escriba una frecuencia por línea (MHz por defecto; admite kHz, Hz y GHz, coma o punto decimal). Opcionalmente, añada señales observadas para compararlas con los productos.'),
    ),
    h('div', { class: 'card two-col' },
      h('div', null, field('Frecuencias transmisoras', freqTa, 'Ej.: 89.30 MHz · 89,58 · 90100 kHz · texto opcional tras la frecuencia')),
      h('div', null, field('Señales observadas (opcional)', obsTa, 'Se comparan con la tolerancia seleccionada.')),
    ),
    h('div', { class: 'card' }, controls, h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'primary', onclick: () => calc() }, 'Calcular'),
      h('button', { type: 'button', onclick: () => {
        const g = parseManualList(freqTa.value, 'calculadora');
        if (!g.signals.length) { toast('No hay frecuencias válidas.', 'error'); return; }
        store.update((p) => {
          const items = g.signals.map((s) => ({ ...s, classification: 'desconocida' as const }));
          p.transmitters = [...p.transmitters, ...items];
          p.selectedIds = [...p.selectedIds, ...items.map((s) => s.id)];
          const o = parseManualList(obsTa.value, 'calculadora').signals.map((s) => ({ ...s, classification: 'senal_observada' as const }));
          p.observed = [...p.observed, ...o];
        });
        toast(`${g.signals.length} frecuencias enviadas al analizador (clasificación «desconocida»: revísela).`, 'ok');
        goToAnalyzer();
      } }, 'Enviar al analizador de banda'),
    ), msg),
    classic,
    panel.root,
  );
  renderControls();

  return {
    render: () => { if (!run) calc(); },
  };
}
