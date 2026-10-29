/** Formulario de parámetros de búsqueda con estimación de complejidad en vivo. */

import type { AnalysisParams } from '../engine/index.js';
import { estimateSearchSpace, formatBig, formatKHz, formatMHz, parseFrequency, parseTolerance, suggestReductions, MAX_ORDER_LIMIT } from '../engine/index.js';
import { field, h, mount, select, toast } from './dom.js';

export const ORDER_PRESETS = [3, 5, 7, 9, 11, 15, 21];
export const TOL_PRESETS = [5, 10, 20, 50];

export function orderControl(value: number, onChange: (n: number) => void): HTMLElement {
  const isPreset = ORDER_PRESETS.includes(value);
  const custom = h('input', { type: 'number', min: '2', max: String(MAX_ORDER_LIMIT), step: '1', value: String(value), class: 'narrow', 'aria-label': 'Orden personalizado', style: { display: isPreset ? 'none' : '' } });
  custom.addEventListener('change', () => {
    const n = parseInt(custom.value, 10);
    if (Number.isInteger(n) && n >= 2 && n <= MAX_ORDER_LIMIT) onChange(n);
    else toast(`El orden debe estar entre 2 y ${MAX_ORDER_LIMIT}.`, 'error');
  });
  const sel = select([...ORDER_PRESETS.map((o) => ({ value: String(o), label: String(o) })), { value: 'custom', label: 'Personalizado…' }], isPreset ? String(value) : 'custom', (v) => {
    if (v === 'custom') { custom.style.display = ''; custom.focus(); }
    else { custom.style.display = 'none'; onChange(Number(v)); }
  }, { 'aria-label': 'Orden máximo' });
  return h('span', { class: 'inline' }, sel, custom);
}

export function toleranceControl(valueHz: number, onChange: (hz: number) => void): HTMLElement {
  const kHz = valueHz / 1000;
  const isPreset = TOL_PRESETS.includes(kHz);
  const custom = h('input', { type: 'text', inputmode: 'decimal', value: formatKHz(valueHz).replace(/\.?0+$/, ''), class: 'narrow', 'aria-label': 'Tolerancia personalizada (kHz)', style: { display: isPreset ? 'none' : '' } });
  custom.addEventListener('change', () => {
    const r = parseTolerance(custom.value);
    if (r.ok) onChange(r.hz); else toast(r.error ?? 'Tolerancia no válida', 'error');
  });
  const sel = select([...TOL_PRESETS.map((t) => ({ value: String(t), label: `±${t} kHz` })), { value: 'custom', label: 'Personalizada…' }], isPreset ? String(kHz) : 'custom', (v) => {
    if (v === 'custom') { custom.style.display = ''; custom.focus(); }
    else { custom.style.display = 'none'; onChange(Number(v) * 1000); }
  }, { 'aria-label': 'Tolerancia de coincidencia' });
  return h('span', { class: 'inline' }, sel, custom, h('span', { class: 'hint' }, 'kHz'));
}

function freqInput(hz: number, onOk: (hz: number) => void, label: string): HTMLInputElement {
  const i = h('input', { type: 'text', inputmode: 'decimal', class: 'narrow', value: formatMHz(hz, 3), 'aria-label': label });
  i.addEventListener('change', () => {
    const r = parseFrequency(i.value);
    if (r.ok) onOk(r.hz); else { toast(r.error ?? 'Frecuencia no válida', 'error'); i.value = formatMHz(hz, 3); }
  });
  return i;
}

export interface ParamsFormOptions {
  get: () => AnalysisParams;
  set: (p: AnalysisParams) => void;
  nGenerators: () => number;
  showLimits?: boolean;
}

/** Devuelve el formulario y una función para actualizar la estimación. */
export function paramsForm(o: ParamsFormOptions): { root: HTMLElement; refresh: () => void; estimate: HTMLElement } {
  const root = h('div', { class: 'params' });
  const estimate = h('div', { class: 'estimate' });
  const refresh = () => {
    const p = o.get();
    const upd = (patch: Partial<AnalysisParams>) => o.set({ ...o.get(), ...patch });
    mount(root,
      h('div', { class: 'grid' },
        field('Orden máximo', orderControl(p.maxOrder, (n) => upd({ maxOrder: n, minOrder: Math.min(p.minOrder, n) }))),
        field('Orden mínimo', h('input', { type: 'number', min: '2', max: String(p.maxOrder), value: String(p.minOrder), class: 'narrow', onchange: (e: Event) => { const n = parseInt((e.target as HTMLInputElement).value, 10); if (n >= 2 && n <= p.maxOrder) upd({ minOrder: n }); } })),
        field('Máx. señales por combinación', h('input', { type: 'number', min: '1', max: '20', value: String(p.maxTones), class: 'narrow', onchange: (e: Event) => { const n = parseInt((e.target as HTMLInputElement).value, 10); if (n >= 1) upd({ maxTones: n }); } })),
        field('Armónicos puros', h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.includeHarmonics, onchange: (e: Event) => upd({ includeHarmonics: (e.target as HTMLInputElement).checked }) }), 'incluir (k·fᵢ)')),
        field('Banda de referencia (MHz)', h('span', { class: 'inline' },
          freqInput(p.band.minHz, (hz) => upd({ band: { ...p.band, minHz: hz } }), 'Banda desde'), '–',
          freqInput(p.band.maxHz, (hz) => upd({ band: { ...p.band, maxHz: hz } }), 'Banda hasta'),
          h('button', { type: 'button', class: 'link', onclick: () => upd({ band: { minHz: 88e6, maxHz: 108e6, name: 'FM 88–108 MHz' } }) }, 'FM'))),
        field('Productos a calcular', select([
          { value: 'banda', label: 'Solo dentro de la banda' },
          { value: 'personalizado', label: 'Intervalo personalizado' },
          { value: 'todo', label: 'Todas las frecuencias (incluye fuera de banda)' },
        ], p.outputMode, (v) => upd({ outputMode: v as AnalysisParams['outputMode'], customRange: p.customRange ?? { minHz: 1, maxHz: 1_000_000_000 } }))),
        p.outputMode === 'personalizado' ? field('Intervalo de salida (MHz)', h('span', { class: 'inline' },
          freqInput(p.customRange?.minHz ?? 1, (hz) => upd({ customRange: { minHz: hz, maxHz: p.customRange?.maxHz ?? 1e9 } }), 'Salida desde'), '–',
          freqInput(p.customRange?.maxHz ?? 1e9, (hz) => upd({ customRange: { minHz: p.customRange?.minHz ?? 1, maxHz: hz } }), 'Salida hasta'))) : null,
        field('Tolerancia de coincidencia', toleranceControl(p.toleranceHz, (hz) => upd({ toleranceHz: hz }))),
        o.showLimits ? field('Presupuesto de trabajo (nodos)', h('input', { type: 'number', min: '1000', step: '1000000', value: String(p.workBudget), class: 'mid', onchange: (e: Event) => { const n = Number((e.target as HTMLInputElement).value); if (n >= 1000) upd({ workBudget: Math.floor(n) }); } }), 'Si se agota, el resultado se marca INCOMPLETO.') : null,
        o.showLimits ? field('Límite de combinaciones', h('input', { type: 'number', min: '1000', step: '100000', value: String(p.maxCombos), class: 'mid', onchange: (e: Event) => { const n = Number((e.target as HTMLInputElement).value); if (n >= 1000) upd({ maxCombos: Math.floor(n) }); } })) : null,
      ),
    );
    renderEstimate(estimate, o);
  };
  return { root, refresh, estimate };
}

export function renderEstimate(box: HTMLElement, o: ParamsFormOptions): boolean {
  const p = o.get();
  const n = o.nGenerators();
  if (!n) { mount(box, h('p', { class: 'hint' }, 'Sin frecuencias seleccionadas.')); return false; }
  const sp = { nGenerators: n, maxOrder: p.maxOrder, maxTones: p.maxTones, minOrder: p.minOrder, includeHarmonics: p.includeHarmonics };
  const est = estimateSearchSpace(sp);
  const over = est.workBound > BigInt(p.workBudget);
  const hints = over ? suggestReductions(sp, p.workBudget) : [];
  mount(box,
    h('div', { class: 'estimate-line' },
      h('strong', null, 'Espacio de búsqueda: '),
      `${formatBig(est.candidates)} vectores candidatos · cota de nodos ${formatBig(est.workBound)} (presupuesto ${formatBig(BigInt(p.workBudget))})`,
    ),
    h('div', { class: 'hint' }, 'Por número de señales: ' + est.byTones.map((t) => `${t.tones}: ${formatBig(t.count)}`).join(' · ')),
    over ? h('div', { class: 'banner warn' },
      '⚠ La cota supera el presupuesto. La poda por banda suele reducir mucho el trabajo real, pero si el presupuesto se agota el resultado se declarará INCOMPLETO. Opciones: ',
      ...hints.map((x) => h('span', { class: 'hint-chip' }, `${x.description} (${formatBig(x.workBound)})`)),
      h('button', { type: 'button', onclick: () => o.set({ ...o.get(), workBudget: Number(est.workBound) + 1 }) }, `Ampliar el presupuesto a ${formatBig(est.workBound)}`),
    ) : null,
  );
  return over;
}
