/** Sección «Espectro RF»: frecuencias del ámbito como marcadores y barridos importados con sus niveles reales. */
import { buildScopeInputs, stationsOfScope } from '../engine/index.js';
import { h, mount, select, toast } from './dom.js';
import { nat } from './natstore.js';
import { runScope, scopeSelect } from './scope.js';
import { Spectrum } from './spectrum.js';
export function spectrumView(root) {
    let scope = { kind: 'nacional' };
    let sweepId = '';
    const head = h('div');
    const box = h('div', { class: 'card' });
    const spec = new Spectrum(box, () => undefined);
    function render() {
        if (!nat.ready) {
            mount(root, h('p', { class: 'hint' }, 'Cargando la base nacional…'));
            return;
        }
        if (!root.contains(box))
            mount(root, h('div', { class: 'section-intro' }, h('h2', null, 'Espectro RF'), h('p', null, 'Si solo hay registros de frecuencia se muestran marcadores discretos (con su nivel, si se conoce); nunca se fabrica una traza continua. Los barridos importados se dibujan con sus niveles medidos.')), head, box);
        const db = nat.db;
        const inputs = buildScopeInputs(db, scope);
        const stIds = new Set(stationsOfScope(db, scope).map((s) => s.id));
        const sweeps = db.sweeps.filter((w) => stIds.has(w.stationId));
        if (sweepId && !sweeps.some((w) => w.id === sweepId))
            sweepId = '';
        const latest = nat.latest(scope);
        mount(head, h('div', { class: 'card' }, h('div', { class: 'inline wrap-gap' }, scopeSelect(scope, (s) => { scope = s; render(); }), h('label', { class: 'field inline-field' }, h('span', { class: 'field-label' }, 'Barrido'), select([{ value: '', label: sweeps.length ? '— ninguno (solo marcadores) —' : 'No hay barridos importados' }, ...sweeps.map((w) => ({ value: w.id, label: `${nat.stationName(w.stationId)}: ${w.name} (${w.points.length} puntos)` }))], sweepId, (v) => { sweepId = v; render(); }, { 'aria-label': 'Barrido' })), h('button', { type: 'button', onclick: async () => { try {
                await runScope(scope).promise;
            }
            catch (e) {
                toast(e.message, 'error');
            } } }, latest ? 'Recalcular productos' : 'Calcular productos (carriles teóricos)')), h('p', { class: 'hint' }, `${inputs.generators.length} generadoras (rombos) y ${inputs.observed.length} señales a explicar (círculos) en el ámbito.${inputs.includesSimulated ? ' Incluye datos SIMULADOS.' : ''} ${latest ? (latest.stale ? 'Productos desactualizados.' : `${latest.sa.run.result.groupCount} productos teóricos en los carriles.`) : 'Sin productos calculados.'}`), sweepId ? null : h('p', { class: 'hint' }, 'Sin barrido seleccionado: no se dibuja ninguna traza.')));
        const sw = sweeps.find((w) => w.id === sweepId);
        spec.setData({
            rs: latest?.sa.run.result ?? null,
            transmitters: inputs.generators,
            observed: inputs.observed,
            trace: sw ? sw.points : null,
            band: db.settings.params.band,
            groupClass: latest?.sa.audit.groupClass ?? null,
        });
    }
    return { render };
}
