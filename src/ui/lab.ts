/** Sección «Laboratorio RF»: pruebas de atenuación y análisis de mecanismos. */

import type { AttenuationAnalysis, AttenuationTest, Evidence, GeneratorLevel, ReceiverConditions, TriState } from '../engine/index.js';
import {
  MECHANISM_LABEL, MECHANISM_STATUS_LABEL, analyzeAttenuation, comboTerms, formatMHz, formulaNumeric, newId, orderLabel, parseFrequency,
} from '../engine/index.js';
import { field, h, mount, num, select, toast } from './dom.js';
import { labAnalyses } from './panel.js';
import { store } from './state.js';

const today = () => new Date().toISOString().slice(0, 10);

function blankTest(): AttenuationTest {
  return {
    id: newId('t'), date: today(), operator: '', observedId: null, freqHz: null, hypothesisKey: null, hypothesisOrder: 3,
    imBeforeDbm: NaN, imAfterDbm: NaN, attenuationDb: 10, attenuationAtImDb: null, readingUncertaintyDb: 0.5, attenuatorUncertaintyDb: 0.3, noiseFloorDbm: null,
    generators: [],
    receiver: { agc: 'desconocido', preamp: 'desconocido', gainDb: null, attenuatorPosition: 'entrada_receptor', ifHz: null, loSide: 'desconocido', inputP1dBdBm: null, notes: '' },
    notes: '',
  };
}

const TRI = [{ value: 'no', label: 'Desactivado' }, { value: 'si', label: 'Activado' }, { value: 'desconocido', label: 'Desconocido' }];

export function labView(root: HTMLElement): { render: () => void; prefill: (observedId: string, key: string | null) => void } {
  let t: AttenuationTest = blankTest();
  let result: AttenuationAnalysis | null = null;
  let error = '';
  const form = h('div');
  const out = h('div');
  const saved = h('div');

  const carriers = () => store.project.transmitters.map((x) => ({ label: x.label, freqHz: x.freqHz, levelDbm: x.levelDbm }));

  function analyze(): void {
    try {
      result = analyzeAttenuation(t, { carriers: carriers(), adjacentWindowHz: 400_000, spurToleranceHz: Math.max(store.project.params.toleranceHz, 1000) });
      error = '';
    } catch (e) { result = null; error = (e as Error).message; }
    renderOut();
  }

  function prefill(observedId: string, key: string | null): void {
    t = blankTest();
    const o = store.project.observed.find((x) => x.id === observedId);
    t.observedId = observedId;
    t.freqHz = o?.freqHz ?? null;
    if (o?.levelDbm !== null && o?.levelDbm !== undefined) t.imBeforeDbm = o.levelDbm;
    t.hypothesisKey = key;
    const hyp = store.auditResult?.hypotheses.find((x) => x.observedId === observedId && x.key === key);
    if (hyp && store.run) {
      const rs = store.run.result;
      t.hypothesisOrder = rs.store.order[hyp.combo];
      t.generators = comboTerms(rs.store, hyp.combo).map((term) => {
        const g = rs.generators[term.index];
        return { label: g.label || formatMHz(g.freqHz), freqHz: g.freqHz, coef: term.coef, beforeDbm: g.levelDbm, afterDbm: null };
      });
    }
    result = null;
    render();
  }

  function renderForm(): void {
    const set = (patch: Partial<AttenuationTest>) => { t = { ...t, ...patch }; };
    const setR = (patch: Partial<ReceiverConditions>) => { t = { ...t, receiver: { ...t.receiver, ...patch } }; };
    const numIn = (v: number | null, onv: (x: number | null) => void, label: string, cls = 'narrow') =>
      h('input', { type: 'text', inputmode: 'decimal', class: cls, value: v === null || Number.isNaN(v) ? '' : String(v), 'aria-label': label, onchange: (e: Event) => onv(num((e.target as HTMLInputElement).value)) });
    const obsOptions = [{ value: '', label: '— sin vincular —' }, ...store.project.observed.map((o) => ({ value: o.id, label: `${formatMHz(o.freqHz, 3)} MHz ${o.label}` }))];
    const hyps = (store.auditResult?.hypotheses ?? []).filter((x) => x.observedId === t.observedId);
    const rs = store.run?.result;
    const hypOptions = [{ value: '', label: '— indicar orden manualmente —' }, ...hyps.map((x) => ({ value: x.key, label: rs ? `${orderLabel(rs.store, x.combo)} · ${formulaNumeric(rs, x.combo)}` : x.key }))];
    const genRows = t.generators.map((g, i) => {
      const upd = (patch: Partial<GeneratorLevel>) => { const gs = [...t.generators]; gs[i] = { ...gs[i], ...patch }; set({ generators: gs }); };
      return h('tr', null,
        h('td', null, h('input', { type: 'text', value: g.label, 'aria-label': 'Generador', onchange: (e: Event) => upd({ label: (e.target as HTMLInputElement).value }) })),
        h('td', null, numIn(g.coef, (x) => upd({ coef: x === null ? null : Math.round(x) }), 'Coeficiente')),
        h('td', null, numIn(g.beforeDbm, (x) => upd({ beforeDbm: x }), 'Antes (dBm)')),
        h('td', null, numIn(g.afterDbm, (x) => upd({ afterDbm: x }), 'Después (dBm)')),
        h('td', null, numIn(g.appliedDb ?? null, (x) => upd({ appliedDb: x }), 'Atenuación aplicada a este generador (dB)')),
        h('td', null, h('button', { type: 'button', class: 'icon', 'aria-label': 'Quitar', onclick: () => { set({ generators: t.generators.filter((_, j) => j !== i) }); renderForm(); } }, '×')),
      );
    });
    mount(form,
      h('div', { class: 'grid' },
        field('Señal observada', select(obsOptions, t.observedId ?? '', (v) => { if (v) prefill(v, null); else { set({ observedId: null }); renderForm(); } })),
        field('Hipótesis', select(hypOptions, t.hypothesisKey ?? '', (v) => { if (t.observedId) prefill(t.observedId, v || null); })),
        field('Frecuencia de la señal (MHz)', h('input', { type: 'text', class: 'narrow', value: t.freqHz ? formatMHz(t.freqHz, 3) : '', onchange: (e: Event) => { const r = parseFrequency((e.target as HTMLInputElement).value); set({ freqHz: r.ok ? r.hz : null }); } })),
        field('Orden nominal (si no hay coeficientes)', numIn(t.hypothesisOrder, (x) => set({ hypothesisOrder: x === null ? null : Math.round(x) }), 'Orden')),
        field('Fecha', h('input', { type: 'date', value: t.date, onchange: (e: Event) => set({ date: (e.target as HTMLInputElement).value }) })),
        field('Operador', h('input', { type: 'text', value: t.operator, onchange: (e: Event) => set({ operator: (e.target as HTMLInputElement).value }) })),
      ),
      h('h4', null, 'Niveles de la señal sospechosa'),
      h('div', { class: 'grid' },
        field('Nivel original (dBm)', numIn(t.imBeforeDbm, (x) => set({ imBeforeDbm: x ?? NaN }), 'Nivel original')),
        field('Nivel con atenuador (dBm)', numIn(t.imAfterDbm, (x) => set({ imAfterDbm: x ?? NaN }), 'Nivel con atenuador')),
        field('Atenuación aplicada (dB)', numIn(t.attenuationDb, (x) => set({ attenuationDb: x ?? NaN }), 'Atenuación')),
        field('Atenuación a la frecuencia de la señal (dB)', numIn(t.attenuationAtImDb, (x) => set({ attenuationAtImDb: x }), 'Atenuación en la señal'), 'Vacío = igual a la aplicada (atenuador de banda ancha).'),
        field('Incertidumbre por lectura (dB)', numIn(t.readingUncertaintyDb, (x) => set({ readingUncertaintyDb: x ?? 0 }), 'Incertidumbre de lectura')),
        field('Incertidumbre del atenuador (dB)', numIn(t.attenuatorUncertaintyDb, (x) => set({ attenuatorUncertaintyDb: x ?? 0 }), 'Incertidumbre del atenuador')),
        field('Ruido de fondo (dBm)', numIn(t.noiseFloorDbm, (x) => set({ noiseFloorDbm: x }), 'Ruido de fondo')),
      ),
      h('h4', null, 'Señales generadoras (antes y después)'),
      h('table', { class: 'data compact editable' },
        h('thead', null, h('tr', null, ...['Generador', 'Coeficiente mᵢ', 'Antes (dBm)', 'Después (dBm)', 'Atenuación propia (dB)', ''].map((x) => h('th', null, x)))),
        h('tbody', null, ...genRows)),
      h('button', { type: 'button', onclick: () => { set({ generators: [...t.generators, { label: `G${t.generators.length + 1}`, freqHz: null, coef: null, beforeDbm: null, afterDbm: null }] }); renderForm(); } }, 'Añadir generador'),
      h('h4', null, 'Condiciones del receptor'),
      h('div', { class: 'grid' },
        field('AGC', select(TRI, t.receiver.agc, (v) => setR({ agc: v as TriState }))),
        field('Preamplificador', select(TRI, t.receiver.preamp, (v) => setR({ preamp: v as TriState }))),
        field('Ganancia (dB)', numIn(t.receiver.gainDb, (x) => setR({ gainDb: x }), 'Ganancia')),
        field('Posición del atenuador', select([{ value: 'entrada_receptor', label: 'Entrada del receptor' }, { value: 'otra', label: 'Otra' }, { value: 'desconocida', label: 'Desconocida' }], t.receiver.attenuatorPosition, (v) => setR({ attenuatorPosition: v as ReceiverConditions['attenuatorPosition'] }))),
        field('Frecuencia intermedia (MHz)', h('input', { type: 'text', class: 'narrow', value: t.receiver.ifHz ? formatMHz(t.receiver.ifHz, 3) : '', onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; const r = parseFrequency(v); setR({ ifHz: v.trim() && r.ok ? r.hz : null }); } }), 'Para evaluar imagen y media FI (p. ej. 10.7).'),
        field('Oscilador local', select([{ value: 'superior', label: 'Superior' }, { value: 'inferior', label: 'Inferior' }, { value: 'desconocido', label: 'Desconocido' }], t.receiver.loSide, (v) => setR({ loSide: v as ReceiverConditions['loSide'] }))),
        field('P1dB de entrada (dBm)', numIn(t.receiver.inputP1dBdBm, (x) => setR({ inputP1dBdBm: x }), 'P1dB')),
      ),
      field('Notas', h('textarea', { rows: 2, onchange: (e: Event) => set({ notes: (e.target as HTMLTextAreaElement).value }) }, t.notes)),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'primary', onclick: () => analyze() }, 'Analizar'),
        h('button', { type: 'button', onclick: () => {
          analyze();
          if (!result) { toast('Complete los datos obligatorios antes de guardar.', 'error'); return; }
          const tt = t;
          store.update((p) => { p.labTests = [...p.labTests.filter((x) => x.id !== tt.id), tt]; });
          toast('Prueba guardada en el proyecto.', 'ok');
        } }, 'Guardar prueba'),
        h('button', { type: 'button', onclick: () => {
          analyze();
          if (!result) return;
          if (!t.observedId) { toast('Vincule la prueba a una señal observada para usarla como evidencia.', 'error'); return; }
          const r = result;
          const tt = t;
          const e: Evidence = { id: newId('e'), observedId: tt.observedId!, hypothesisKey: tt.hypothesisKey, type: 'atenuacion', result: r.evidenceResult, description: `Prueba ${tt.id}: caída ${r.imDropDb.toFixed(2)} dB con ${tt.attenuationDb} dB (pendiente ${r.slopeVsAttenuation.toFixed(2)} dB/dB). ${r.evidenceSummary}`, date: tt.date, author: tt.operator, labTestId: tt.id };
          store.update((p) => { p.labTests = [...p.labTests.filter((x) => x.id !== tt.id), tt]; p.evidence.push(e); });
          toast(`Registrada como evidencia «${r.evidenceResult}».`, 'ok');
        } }, 'Guardar y registrar como evidencia'),
        h('button', { type: 'button', onclick: () => { t = blankTest(); result = null; render(); } }, 'Nueva prueba'),
      ),
    );
  }

  function renderOut(): void {
    if (error) { mount(out, h('p', { class: 'error' }, error)); return; }
    const a = result;
    if (!a) { mount(out, h('p', { class: 'hint' }, 'Introduzca los niveles y pulse «Analizar».')); return; }
    const f2 = (x: number) => x.toFixed(2);
    mount(out,
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, `${f2(a.imDropDb)} dB`), h('div', { class: 'stat-l' }, 'Variación observada')),
        h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, `${f2(a.slopeVsAttenuation)} dB/dB`), h('div', { class: 'stat-l' }, 'Pendiente frente a la atenuación')),
        a.slopeVsGenerators !== null ? h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, `${f2(a.slopeVsGenerators)} dB/dB`), h('div', { class: 'stat-l' }, 'Pendiente frente a la caída media de los generadores')) : null,
        a.iipEstimateDbm !== null ? h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, `${f2(a.iipEstimateDbm)} dBm`), h('div', { class: 'stat-l' }, 'IIP estimado (orientativo, tonos de igual nivel)')) : null,
      ),
      h('table', { class: 'data compact' },
        h('thead', null, h('tr', null, ...['Hipótesis', 'Caída esperada (dB)', 'Residuo (dB)', 'Compatible (k = 2)'].map((x) => h('th', null, x)))),
        h('tbody', null,
          h('tr', null, h('td', null, 'Señal lineal (pendiente 1)'), h('td', { class: 'num' }, `${f2(a.expectedLinear.dropDb)} ± ${f2(2 * Math.hypot(a.observedUncertaintyDb, a.expectedLinear.uncertaintyDb))}`), h('td', { class: 'num' }, f2(a.imDropDb - a.expectedLinear.dropDb)), h('td', null, Math.abs(a.imDropDb - a.expectedLinear.dropDb) <= 2 * Math.hypot(a.observedUncertaintyDb, a.expectedLinear.uncertaintyDb) ? 'sí' : 'no')),
          a.expectedInternal ? h('tr', null, h('td', null, `IM${a.expectedInternal.order} interna (hipótesis): ${a.expectedInternal.basis}`), h('td', { class: 'num' }, `${f2(a.expectedInternal.dropDb)} ± ${f2(2 * Math.hypot(a.observedUncertaintyDb, a.expectedInternal.uncertaintyDb))}`), h('td', { class: 'num' }, f2(a.imDropDb - a.expectedInternal.dropDb)), h('td', null, a.mechanisms[0].status === 'compatible' ? 'sí' : a.mechanisms[0].status === 'no_evaluable' ? 'no evaluable' : 'no')) : null,
          ...a.theoretical.map((x) => h('tr', null, h('td', null, `IM${x.order} teórica (${x.order} dB/dB)`), h('td', { class: 'num' }, f2(x.expectedDropDb)), h('td', { class: 'num' }, f2(x.residualDb)), h('td', null, x.compatible ? 'sí' : 'no'))),
        )),
      h('h4', null, 'Mecanismos posibles'),
      h('table', { class: 'data compact' },
        h('thead', null, h('tr', null, h('th', null, 'Mecanismo'), h('th', null, 'Estado'), h('th', null, 'Fundamento'))),
        h('tbody', null, ...a.mechanisms.map((m) => h('tr', null, h('td', null, MECHANISM_LABEL[m.id]), h('td', null, h('span', { class: `mstat ${m.status}` }, MECHANISM_STATUS_LABEL[m.status])), h('td', { class: 'small' }, m.reasons.join(' ')))))),
      h('p', null, h('strong', null, 'Como evidencia para la hipótesis: '), a.evidenceResult.replace('_', ' '), ' — ', a.evidenceSummary),
      h('div', { class: 'banner warn' }, h('strong', null, 'Validez: '), h('ul', null, ...a.validity.map((v) => h('li', null, v)))),
      h('p', { class: 'hint' }, 'El programa no atribuye la emisión a ningún transmisor: los estados indican compatibilidad con los datos, no diagnóstico.'),
    );
  }

  function renderSaved(): void {
    const tests = store.project.labTests;
    if (!tests.length) { mount(saved, h('p', { class: 'hint' }, 'No hay pruebas guardadas.')); return; }
    const an = labAnalyses(store.project);
    mount(saved, h('table', { class: 'data compact' },
      h('thead', null, h('tr', null, ...['Fecha', 'Señal (MHz)', 'Antes → después (dBm)', 'Atenuación (dB)', 'Pendiente', 'Resultado', ''].map((x) => h('th', null, x)))),
      h('tbody', null, ...tests.map((x) => {
        const a = an.get(x.id);
        return h('tr', null,
          h('td', null, x.date), h('td', { class: 'num' }, x.freqHz ? formatMHz(x.freqHz, 3) : '—'), h('td', { class: 'num' }, `${x.imBeforeDbm} → ${x.imAfterDbm}`), h('td', { class: 'num' }, String(x.attenuationDb)),
          h('td', { class: 'num' }, a ? a.slopeVsAttenuation.toFixed(2) : '—'), h('td', null, a ? a.evidenceResult.replace('_', ' ') : 'datos incompletos'),
          h('td', null,
            h('button', { type: 'button', onclick: () => { t = JSON.parse(JSON.stringify(x)); analyze(); renderForm(); } }, 'Abrir'),
            h('button', { type: 'button', class: 'icon', 'aria-label': 'Eliminar prueba', onclick: () => { if (confirm('¿Eliminar la prueba? Las evidencias derivadas se conservan.')) store.update((p) => { p.labTests = p.labTests.filter((y) => y.id !== x.id); }); } }, '×')),
        );
      }))));
  }

  function render(): void { renderForm(); renderOut(); renderSaved(); }

  mount(root,
    h('div', { class: 'section-intro' },
      h('h2', null, 'Laboratorio RF'),
      h('p', null, 'Registre pruebas con atenuación RF para discriminar la intermodulación generada en el receptor de la que llega ya formada. En pequeña señal, un producto generado tras el atenuador baja Σ|mᵢ|·ΔPᵢ dB (n·A con atenuación uniforme: 3 dB/dB para IM3, 5 para IM5, 7 para IM7); una señal recibida tal cual baja A dB.'),
    ),
    h('div', { class: 'card' }, h('h3', null, 'Prueba de atenuación'), form),
    h('div', { class: 'card' }, h('h3', null, 'Resultado'), out),
    h('div', { class: 'card' }, h('h3', null, 'Pruebas guardadas'), saved),
  );
  return { render, prefill };
}
