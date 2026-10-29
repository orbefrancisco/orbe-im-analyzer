/** Tabla científica de resultados con filtros, agrupación, paginación y detalle. */
import { CLASS_LABEL, PRODUCT_KIND_LABEL, comboKind, filterCombos, formatKHz, formatMHz, formulaNumeric, formulaSymbolic, generatorsLabel, groupCombos, groupFiltered, inBand, orderLabel, parseFrequency, observedByGroup, } from '../engine/index.js';
import { h, mount, select } from './dom.js';
const PAGE = 100;
export function classBadge(c) {
    if (!c)
        return h('span', { class: 'badge none' }, '—');
    return h('span', { class: `badge cls-${c}`, title: CLASS_LABEL[c] }, `${c} · ${CLASS_LABEL[c]}`);
}
export class ResultsTable {
    constructor(opt) {
        this.opt = opt;
        this.search = '';
        this.orders = new Set();
        this.tones = '';
        this.kind = '';
        this.band = 'todas';
        this.cls = '';
        this.view = 'grupos';
        this.sort = 'f+';
        this.page = 0;
        this.selected = null;
        this.controls = h('div', { class: 'filters' });
        this.body = h('div', { class: 'table-wrap' });
        this.detail = h('div', { class: 'detail' });
        this.root = h('div', { class: 'results' }, this.controls, this.body, this.detail);
    }
    refresh(resetPage = false) {
        if (resetPage)
            this.page = 0;
        const run = this.opt.getRun();
        if (!run) {
            mount(this.controls);
            mount(this.body, h('p', { class: 'empty' }, 'Sin resultados. Introduzca frecuencias y pulse «Calcular».'));
            mount(this.detail);
            return;
        }
        this.renderControls(run);
        this.renderBody(run);
        this.renderDetail(run);
    }
    selectGroup(g) {
        this.selected = g;
        const run = this.opt.getRun();
        if (run) {
            this.renderBody(run);
            this.renderDetail(run);
        }
    }
    renderControls(run) {
        const rs = run.result;
        const present = [...new Set(Array.from(rs.store.order))].sort((a, b) => a - b);
        const tonesPresent = [...new Set(Array.from(rs.store.tones))].sort((a, b) => a - b);
        const au = this.opt.getAudit();
        const searchInp = h('input', {
            type: 'search', value: this.search, placeholder: 'Frecuencia: 88.74 · 88.7-88.9 · 89.85±0.02',
            'aria-label': 'Buscar por frecuencia',
            oninput: (e) => { this.search = e.target.value; this.page = 0; this.renderBody(run); },
        });
        mount(this.controls, h('div', { class: 'filter-row' }, searchInp, select([{ value: 'grupos', label: 'Agrupar por frecuencia' }, { value: 'combinaciones', label: 'Todas las combinaciones' }], this.view, (v) => { this.view = v; this.page = 0; this.renderBody(run); }, { 'aria-label': 'Vista' }), select([{ value: 'f+', label: 'Frecuencia ↑' }, { value: 'f-', label: 'Frecuencia ↓' }, { value: 'orden', label: 'Orden, luego frecuencia' }], this.sort, (v) => { this.sort = v; this.page = 0; this.renderBody(run); }, { 'aria-label': 'Orden de la tabla' }), select([{ value: '', label: 'Emisoras: todas' }, ...tonesPresent.map((t) => ({ value: String(t), label: `${t} emisora${t > 1 ? 's' : ''}` }))], this.tones, (v) => { this.tones = v; this.page = 0; this.renderBody(run); }, { 'aria-label': 'Número de emisoras' }), select([{ value: '', label: 'Tipo: todos' }, ...['armonico', 'suma', 'mixto'].map((k) => ({ value: k, label: PRODUCT_KIND_LABEL[k] }))], this.kind, (v) => { this.kind = v; this.page = 0; this.renderBody(run); }, { 'aria-label': 'Tipo de producto' }), select([{ value: 'todas', label: 'Dentro y fuera de banda' }, { value: 'dentro', label: 'Solo dentro de banda' }, { value: 'fuera', label: 'Solo fuera de banda' }], this.band, (v) => { this.band = v; this.page = 0; this.renderBody(run); }, { 'aria-label': 'Banda' }), au ? select([{ value: '', label: 'Clase: todas' }, ...['A', 'B', 'C', 'D'].map((c) => ({ value: c, label: `${c} · ${CLASS_LABEL[c]}` })), { value: 'BCD', label: 'Con señal observada (B–D)' }], this.cls, (v) => { this.cls = v; this.page = 0; this.renderBody(run); }, { 'aria-label': 'Clase' }) : null), h('div', { class: 'filter-row chips', role: 'group', 'aria-label': 'Filtrar por orden' }, h('span', { class: 'hint' }, 'Orden:'), ...present.map((o) => h('button', {
            type: 'button', class: 'chip' + (this.orders.has(o) ? ' on' : ''), 'aria-pressed': String(this.orders.has(o)),
            onclick: () => { if (this.orders.has(o))
                this.orders.delete(o);
            else
                this.orders.add(o); this.page = 0; this.renderControls(run); this.renderBody(run); },
        }, String(o))), this.orders.size ? h('button', { type: 'button', class: 'chip link', onclick: () => { this.orders.clear(); this.renderControls(run); this.renderBody(run); } }, 'todos') : null));
    }
    filter(run) {
        const f = { band: this.band };
        if (this.orders.size)
            f.orders = [...this.orders];
        if (this.tones)
            f.tones = [Number(this.tones)];
        if (this.kind)
            f.kinds = [this.kind];
        const q = this.search.trim();
        if (q) {
            const range = /^\s*([\d.,]+)\s*[-–]\s*([\d.,]+)\s*$/.exec(q);
            const pm = /^\s*([\d.,]+)\s*±\s*([\d.,]+)\s*$/.exec(q);
            if (range) {
                const a = parseFrequency(range[1]), b = parseFrequency(range[2]);
                if (a.ok && b.ok) {
                    f.minHz = Math.min(a.hz, b.hz);
                    f.maxHz = Math.max(a.hz, b.hz);
                }
            }
            else if (pm) {
                const a = parseFrequency(pm[1]), t = parseFrequency(pm[2]);
                if (a.ok && t.ok) {
                    f.minHz = a.hz - t.hz;
                    f.maxHz = a.hz + t.hz;
                }
            }
            else {
                const a = parseFrequency(q);
                if (a.ok) {
                    const t = this.opt.toleranceHz();
                    f.minHz = a.hz - t;
                    f.maxHz = a.hz + t;
                }
            }
        }
        return filterCombos(run.result, f);
    }
    renderBody(run) {
        const rs = run.result;
        const au = this.opt.getAudit();
        const obsBy = au ? observedByGroup(au.matches) : new Map();
        const combos = this.filter(run);
        let groups = groupFiltered(rs, combos);
        if (this.cls && au)
            groups = groups.filter((x) => { const c = au.groupClass.get(x.group) ?? 'A'; return this.cls === 'BCD' ? c !== 'A' : c === this.cls; });
        const allowedGroups = new Set(groups.map((x) => x.group));
        let rows;
        if (this.view === 'grupos')
            rows = groups.map((x) => ({ group: x.group, combo: x.combos[0], count: x.combos.length }));
        else
            rows = Array.from(combos).filter((c) => allowedGroups.has(rs.comboGroup[c])).map((c) => ({ group: rs.comboGroup[c], combo: c, count: 1 }));
        if (this.sort === 'f-')
            rows.reverse();
        else if (this.sort === 'orden')
            rows.sort((a, b) => rs.store.order[a.combo] - rs.store.order[b.combo] || rs.store.freqHz[a.combo] - rs.store.freqHz[b.combo]);
        const pages = Math.max(1, Math.ceil(rows.length / PAGE));
        if (this.page >= pages)
            this.page = pages - 1;
        const slice = rows.slice(this.page * PAGE, this.page * PAGE + PAGE);
        const head = this.view === 'grupos'
            ? ['Frecuencia calculada (MHz)', 'Orden', 'Fórmula', 'Generadores', 'Combinaciones', 'Coincidencia observada', 'Diferencia (kHz)', ...(au ? ['Clase'] : []), 'Banda']
            : ['Frecuencia (MHz)', 'Orden', 'Fórmula', 'Simbólica', 'Generadores', 'Σm', 'Tipo', 'Coincidencia observada', 'Diferencia (kHz)', ...(au ? ['Clase'] : [])];
        const table = h('table', { class: 'data' }, h('thead', null, h('tr', null, ...head.map((t) => h('th', { scope: 'col' }, t)))), h('tbody', null, ...slice.map((r) => {
            const obs = obsBy.get(r.group) ?? [];
            const total = rs.groupStart[r.group + 1] - rs.groupStart[r.group];
            const f = rs.groupFreq[r.group];
            const cells = this.view === 'grupos'
                ? [
                    h('td', { class: 'num' }, formatMHz(f, 3)),
                    h('td', null, orderLabel(rs.store, r.combo)),
                    h('td', { class: 'formula' }, formulaNumeric(rs, r.combo)),
                    h('td', { class: 'small' }, generatorsLabel(rs, r.combo)),
                    h('td', { class: 'num' }, r.count === total ? String(total) : `${r.count} de ${total}`),
                    h('td', { class: 'num' }, obs.map((o) => formatMHz(o.observed.freqHz, 3)).join(', ') || '—'),
                    h('td', { class: 'num' }, obs.map((o) => formatKHz(o.diffHz)).join(', ') || '—'),
                    ...(au ? [h('td', null, classBadge(au.groupClass.get(r.group) ?? 'A'))] : []),
                    h('td', null, inBand(f, rs.band) ? 'dentro' : 'fuera'),
                ]
                : [
                    h('td', { class: 'num' }, formatMHz(f, 3)),
                    h('td', null, orderLabel(rs.store, r.combo)),
                    h('td', { class: 'formula' }, formulaNumeric(rs, r.combo)),
                    h('td', { class: 'formula' }, formulaSymbolic(rs, r.combo)),
                    h('td', { class: 'small' }, generatorsLabel(rs, r.combo)),
                    h('td', { class: 'num' }, String(rs.store.coefSum[r.combo])),
                    h('td', null, PRODUCT_KIND_LABEL[comboKind(rs.store, r.combo)]),
                    h('td', { class: 'num' }, obs.map((o) => formatMHz(o.observed.freqHz, 3)).join(', ') || '—'),
                    h('td', { class: 'num' }, obs.map((o) => formatKHz(o.diffHz)).join(', ') || '—'),
                    ...(au ? [h('td', null, classBadge(au.groupClass.get(r.group) ?? 'A'))] : []),
                ];
            return h('tr', {
                class: (r.group === this.selected ? 'sel ' : '') + (obs.length ? 'hit' : ''),
                tabindex: '0',
                onclick: () => this.opt.onSelectGroup(r.group),
                onkeydown: (e) => { if (e.key === 'Enter')
                    this.opt.onSelectGroup(r.group); },
            }, ...cells);
        })));
        const pager = h('div', { class: 'pager' }, h('span', null, `${rows.length} fila${rows.length === 1 ? '' : 's'} (${groups.length} frecuencias, ${combos.length} combinaciones filtradas de ${rs.store.count})`), h('button', { type: 'button', disabled: this.page === 0, onclick: () => { this.page--; this.renderBody(run); } }, '‹ Anterior'), h('span', null, `Página ${this.page + 1} de ${pages}`), h('button', { type: 'button', disabled: this.page >= pages - 1, onclick: () => { this.page++; this.renderBody(run); } }, 'Siguiente ›'));
        mount(this.body, pager, rows.length ? table : h('p', { class: 'empty' }, 'Ningún producto cumple los filtros.'));
    }
    renderDetail(run) {
        const g = this.selected;
        const rs = run.result;
        if (g === null || g >= rs.groupCount) {
            mount(this.detail);
            return;
        }
        const au = this.opt.getAudit();
        const cs = groupCombos(rs, g);
        const obs = au ? observedByGroup(au.matches).get(g) ?? [] : [];
        const co = au?.coChannel.get(g) ?? [];
        mount(this.detail, h('h4', null, `${formatMHz(rs.groupFreq[g], 3)} MHz — ${cs.length} combinación${cs.length > 1 ? 'es' : ''} capaz${cs.length > 1 ? 'es' : ''} de producir esta frecuencia`), h('table', { class: 'data compact' }, h('thead', null, h('tr', null, ...['Orden nominal', 'Fórmula', 'Simbólica', 'Tonos', 'Σm', 'Tipo', 'Generadores'].map((t) => h('th', null, t)))), h('tbody', null, ...cs.map((c) => h('tr', null, h('td', null, orderLabel(rs.store, c)), h('td', { class: 'formula' }, formulaNumeric(rs, c)), h('td', { class: 'formula' }, formulaSymbolic(rs, c)), h('td', { class: 'num' }, String(rs.store.tones[c])), h('td', { class: 'num' }, String(rs.store.coefSum[c])), h('td', null, PRODUCT_KIND_LABEL[comboKind(rs.store, c)]), h('td', { class: 'small' }, generatorsLabel(rs, c)))))), obs.length ? h('p', null, h('strong', null, 'Señales observadas dentro de tolerancia: '), obs.map((o) => `${formatMHz(o.observed.freqHz, 3)} MHz (Δ ${formatKHz(o.diffHz)} kHz${o.observed.levelDbm !== null ? `, ${o.observed.levelDbm} dBm` : ''})`).join('; ')) : h('p', { class: 'hint' }, 'Ninguna señal observada dentro de la tolerancia: producto teórico (clase A).'), co.length ? h('p', { class: 'warn' }, '⚠ Coincide con la frecuencia de un transmisor de la lista: ', co.map((x) => `${formatMHz(x.transmitter.freqHz, 3)} MHz${x.transmitter.label ? ' ' + x.transmitter.label : ''} (Δ ${formatKHz(x.diffHz)} kHz)`).join('; ')) : null, h('p', { class: 'hint' }, 'El orden es nominal (Σ|mᵢ|). La misma frecuencia recibe también contribuciones de órdenes superiores (n+2, n+4…) por términos que se cancelan algebraicamente. Que el producto sea calculable no implica que sea detectable.'));
    }
}
