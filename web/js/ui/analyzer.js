/** Sección «Analizador de banda»: lista de emisoras, parámetros, cálculo exhaustivo y resultados. */
import { formatBig, selectedGenerators, validateParams, enumerationParamsOf } from '../engine/index.js';
import { h, mount, toast } from './dom.js';
import { computeAsync } from './compute.js';
import { ResultsPanel } from './panel.js';
import { paramsForm } from './params.js';
import { SignalList } from './signals.js';
import { store } from './state.js';
export function analyzerView(root) {
    let job = null;
    const progress = h('div', { class: 'progress', hidden: true });
    const list = new SignalList({
        title: 'Emisoras',
        kind: 'transmisores',
        get: () => store.project.transmitters,
        set: (l, src) => store.update((p) => { p.transmitters = l; const ids = new Set(l.map((x) => x.id)); p.selectedIds = p.selectedIds.filter((i) => ids.has(i)); if (src)
            p.sources.push(src); }),
        selected: { get: () => new Set(store.project.selectedIds), set: (ids) => store.update((p) => { p.selectedIds = [...ids]; }) },
        defaultClass: 'portadora_confirmada',
    });
    const form = paramsForm({
        get: () => store.project.params,
        set: (pp) => store.update((p) => { p.params = pp; }),
        nGenerators: () => store.project.selectedIds.length,
        showLimits: true,
    });
    const runBtn = h('button', { type: 'button', class: 'primary', onclick: () => start() }, 'Calcular todas las combinaciones');
    const cancelBtn = h('button', { type: 'button', class: 'danger', hidden: true, onclick: () => job?.cancel() }, 'Cancelar');
    const panel = new ResultsPanel({
        getRun: () => store.run,
        getAudit: () => store.auditResult,
        getProject: () => store.project,
        getObserved: () => store.project.observed,
        getTransmitters: () => store.project.transmitters,
        getTrace: () => store.project.trace?.points ?? null,
        toleranceHz: () => store.project.params.toleranceHz,
        filePrefix: 'orbe-im-banda',
        isStale: () => store.isRunStale(),
    });
    const selInfo = h('span', { class: 'hint' });
    async function start() {
        const gens = selectedGenerators(store.project);
        const p = store.project.params;
        const errs = validateParams(gens.map((g) => g.freqHz), enumerationParamsOf(p));
        if (errs.length) {
            toast(errs[0], 'error');
            return;
        }
        runBtn.disabled = true;
        cancelBtn.hidden = false;
        progress.hidden = false;
        mount(progress, h('div', { class: 'bar' }, h('div', { class: 'fill', style: { width: '0%' } })), h('span', null, 'Calculando…'));
        job = computeAsync(gens, p, (pr) => {
            const fill = progress.querySelector('.fill');
            fill.style.width = `${Math.round(pr.fraction * 100)}%`;
            progress.querySelector('span').textContent = `Nodos recorridos: ${formatBig(BigInt(pr.visited))} · combinaciones: ${formatBig(BigInt(pr.combos))}`;
        });
        try {
            const run = await job.promise;
            store.setRun(run);
            panel.selectedGroup = null;
            panel.refresh(true);
            panel.redrawSpectrum(false);
            toast(run.meta.complete ? `Cálculo exhaustivo: ${run.result.groupCount} frecuencias distintas.` : 'Cálculo INCOMPLETO: revise los límites.', run.meta.complete ? 'ok' : 'error');
        }
        catch (e) {
            toast(e.message, 'error');
        }
        finally {
            job = null;
            runBtn.disabled = false;
            cancelBtn.hidden = true;
            progress.hidden = true;
        }
    }
    mount(root, h('div', { class: 'section-intro' }, h('h2', null, 'Analizador de banda'), h('p', null, 'Cargue la lista completa de emisoras (manual, CSV o Excel), elija cuáles intervienen y genere todas las combinaciones de coeficientes enteros dentro del alcance configurado. El motor informa el tamaño exacto del espacio de búsqueda antes de calcular y declara explícitamente si el resultado es exhaustivo.')), h('div', { class: 'card' }, h('h3', null, 'Emisoras y frecuencias generadoras'), list.root, selInfo), h('div', { class: 'card' }, h('h3', null, 'Alcance del análisis'), form.root, form.estimate, h('div', { class: 'toolbar' }, runBtn, cancelBtn), progress), panel.root);
    return {
        render: () => {
            list.render();
            form.refresh();
            const n = store.project.selectedIds.length;
            selInfo.textContent = `${n} de ${store.project.transmitters.length} frecuencias incluidas en el análisis.`;
            panel.refresh();
        },
    };
}
