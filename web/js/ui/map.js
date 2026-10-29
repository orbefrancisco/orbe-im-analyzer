/**
 * Mapa nacional (SVG). Proyección equirrectangular centrada en la isla
 * (x ∝ λ·cos φ₀, y ∝ −φ), suficiente a esta escala. Las regiones tienen un
 * color categórico fijo por región; el modo «datos» usa una rampa secuencial
 * de un solo tono y un rayado para las zonas sin datos.
 */
import { LOCATION_CONFIDENCE_LABEL, displayCoord, isLocationUncertain } from '../engine/index.js';
import { h, svg } from './dom.js';
const LAT0 = 18.8;
const K = 100; // unidades SVG por grado de latitud
const COSL = Math.cos((LAT0 * Math.PI) / 180);
const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
export function project(lon, lat) {
    return [(lon + 72.1) * COSL * K, (20.0 - lat) * K];
}
function pathOf(polys) {
    let d = '';
    for (const poly of polys)
        for (const ring of poly) {
            ring.forEach(([lo, la], i) => { const [x, y] = project(lo, la); d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2); });
            d += 'Z';
        }
    return d;
}
export class NationalMap {
    constructor(ev) {
        this.ev = ev;
        this.full = { x: 0, y: 0, w: 360, h: 260 };
        this.view = { x: 0, y: 0, w: 360, h: 260 };
        this.paths = new Map();
        this.drag = null;
        this.data = null;
        this.built = false;
        this.svgEl = svg('svg', { class: 'map-svg', role: 'group', 'aria-label': 'Mapa de República Dominicana: provincias y estaciones de monitoreo', preserveAspectRatio: 'xMidYMid meet' });
        const defs = svg('defs', {}, svg('pattern', { id: 'sin-datos', patternUnits: 'userSpaceOnUse', width: 4, height: 4, patternTransform: 'rotate(45)' }, svg('rect', { width: 4, height: 4, class: 'hatch-bg' }), svg('line', { x1: 0, y1: 0, x2: 0, y2: 4, class: 'hatch-line' })));
        this.gProv = svg('g', { class: 'provinces' });
        this.gSt = svg('g', { class: 'stations' });
        this.svgEl.appendChild(defs);
        this.svgEl.appendChild(this.gProv);
        this.svgEl.appendChild(this.gSt);
        const tools = h('div', { class: 'map-tools' }, h('button', { type: 'button', 'aria-label': 'Ampliar', onclick: () => this.zoom(0.7) }, '+'), h('button', { type: 'button', 'aria-label': 'Reducir', onclick: () => this.zoom(1 / 0.7) }, '−'), h('button', { type: 'button', onclick: () => this.reset() }, 'Ver todo'));
        this.root = h('div', { class: 'map-wrap' }, this.svgEl, tools);
        this.svgEl.addEventListener('wheel', (e) => { const w = e; w.preventDefault(); this.zoom(w.deltaY > 0 ? 1.2 : 1 / 1.2); }, { passive: false });
        this.svgEl.addEventListener('pointerdown', (e) => { const p = e; this.drag = { x: p.clientX, y: p.clientY, vx: this.view.x, vy: this.view.y, moved: false }; });
        this.svgEl.addEventListener('pointermove', (e) => {
            const p = e;
            if (!this.drag)
                return;
            const dx = p.clientX - this.drag.x, dy = p.clientY - this.drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 4)
                this.drag.moved = true;
            if (!this.drag.moved)
                return;
            const scale = this.view.w / Math.max(1, this.svgEl.clientWidth || 800);
            this.view.x = this.drag.vx - dx * scale;
            this.view.y = this.drag.vy - dy * scale;
            this.applyView();
        });
        const end = () => { setTimeout(() => { this.drag = null; }, 0); };
        this.svgEl.addEventListener('pointerup', end);
        this.svgEl.addEventListener('pointerleave', end);
    }
    moved() { return !!this.drag?.moved; }
    applyView() {
        const v = this.view;
        this.svgEl.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
        this.drawStations();
    }
    zoom(f) {
        const cx = this.view.x + this.view.w / 2, cy = this.view.y + this.view.h / 2;
        const w = Math.min(this.full.w * 1.5, Math.max(this.full.w / 12, this.view.w * f));
        const hh = (w * this.full.h) / this.full.w;
        this.view = { x: cx - w / 2, y: cy - hh / 2, w, h: hh };
        this.applyView();
    }
    reset() { this.view = { ...this.full }; this.applyView(); }
    focusStation(st) {
        const c = displayCoord(st);
        if (!c)
            return;
        const [x, y] = project(c.lon, c.lat);
        const w = this.full.w / 3, hh = this.full.h / 3;
        this.view = { x: x - w / 2, y: y - hh / 2, w, h: hh };
        this.applyView();
    }
    build(c) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of c.provincias)
            for (const poly of p.poligonos)
                for (const [lo, la] of poly[0]) {
                    const [x, y] = project(lo, la);
                    x0 = Math.min(x0, x);
                    y0 = Math.min(y0, y);
                    x1 = Math.max(x1, x);
                    y1 = Math.max(y1, y);
                }
        const pad = 6;
        this.full = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
        this.view = { ...this.full };
        for (const p of c.provincias) {
            const el = svg('path', { d: pathOf(p.poligonos), class: 'prov', tabindex: '0', role: 'button', 'data-id': p.id, 'aria-label': `Provincia ${p.nombre}` }, svg('title', {}, p.nombre));
            el.addEventListener('click', () => { if (!this.moved())
                this.ev.onProvince(p.id); });
            el.addEventListener('keydown', (e) => { if (e.key === 'Enter')
                this.ev.onProvince(p.id); });
            this.paths.set(p.id, el);
            this.gProv.appendChild(el);
        }
        this.built = true;
        this.applyView();
    }
    setData(d) {
        this.data = d;
        if (!this.built)
            this.build(d.carto);
        const max = Math.max(1, ...[...d.regionValue.values()].map((v) => v ?? 0));
        for (const p of d.carto.provincias) {
            const el = this.paths.get(p.id);
            const regionId = d.db.provinceRegion[p.id];
            const region = d.db.regions.find((r) => r.id === regionId);
            let fill;
            if (d.mode === 'regiones')
                fill = region ? `var(--series-${region.colorSlot})` : 'var(--grid)';
            else {
                const v = regionId ? d.regionValue.get(regionId) ?? null : null;
                fill = v === null || v === 0 ? 'url(#sin-datos)' : SEQ[Math.min(SEQ.length - 1, 1 + Math.floor(((v - 1) / Math.max(1, max - 1)) * (SEQ.length - 2)))];
            }
            el.setAttribute('fill', fill);
            const cls = ['prov'];
            if (p.id === d.selectedProvince)
                cls.push('sel');
            if (d.selectedRegion && regionId === d.selectedRegion)
                cls.push('in-region');
            el.setAttribute('class', cls.join(' '));
            const t = el.firstChild;
            const v = regionId ? d.regionValue.get(regionId) : null;
            if (t)
                t.textContent = `${p.nombre} · región ${region?.name ?? '—'}${d.mode !== 'regiones' ? ` · ${v === null || v === undefined ? 'sin datos' : v}` : ''}`;
        }
        this.drawStations();
    }
    drawStations() {
        const d = this.data;
        if (!d)
            return;
        while (this.gSt.firstChild)
            this.gSt.removeChild(this.gSt.firstChild);
        const s = this.view.w / this.full.w; // factor de escala para mantener tamaños en pantalla
        for (const st of d.db.stations) {
            const c = displayCoord(st);
            if (!c)
                continue;
            const [x, y] = project(c.lon, c.lat);
            const unc = isLocationUncertain(st);
            const g = svg('g', { class: 'st' + (st.id === d.selectedStation ? ' sel' : '') + (unc ? ' unc' : ''), tabindex: '0', role: 'button', 'aria-label': `Estación ${st.operationalName}: ${LOCATION_CONFIDENCE_LABEL[st.location.confidence]}` });
            if (unc && c.uncertaintyKm > 0) {
                const r = (c.uncertaintyKm / 111.32) * K;
                g.appendChild(svg('circle', { cx: x, cy: y, r, class: 'unc-circle' }));
            }
            if (unc && st.location.historic) {
                const [hx, hy] = project(st.location.historic.lon, st.location.historic.lat);
                g.appendChild(svg('line', { x1: x, y1: y, x2: hx, y2: hy, class: 'hist-link' }));
                g.appendChild(svg('rect', { x: hx - 2.2 * s, y: hy - 2.2 * s, width: 4.4 * s, height: 4.4 * s, class: 'hist-mark', transform: `rotate(45 ${hx} ${hy})` }, svg('title', {}, `${st.name}: coordenada histórica discrepante (${st.location.historic.lat}, ${st.location.historic.lon})`)));
            }
            g.appendChild(svg('circle', { cx: x, cy: y, r: 4.2 * s, class: 'st-dot' }));
            g.appendChild(svg('text', { x: x + 6 * s, y: y - 5 * s, class: 'st-label', 'font-size': (9 * s).toFixed(2) }, `${st.id} ${st.name}${unc ? ' (?)' : ''}`));
            const badge = d.stationBadge.get(st.id);
            if (badge)
                g.appendChild(svg('text', { x: x + 6 * s, y: y + 6 * s, class: 'st-badge', 'font-size': (7 * s).toFixed(2) }, badge));
            g.appendChild(svg('title', {}, `${st.operationalName} — ${LOCATION_CONFIDENCE_LABEL[st.location.confidence]}${unc ? ` (radio de incertidumbre ${c.uncertaintyKm} km)` : ''}`));
            g.addEventListener('click', (e) => { e.stopPropagation(); if (!this.moved())
                this.ev.onStation(st.id); });
            g.addEventListener('keydown', (e) => { if (e.key === 'Enter')
                this.ev.onStation(st.id); });
            this.gSt.appendChild(g);
        }
    }
}
export function mapLegend(d) {
    if (d.mode === 'regiones') {
        return h('div', { class: 'legend' }, ...d.db.regions.map((r) => h('span', { class: 'lg' }, h('i', { class: 'lg-sw', style: { background: `var(--series-${r.colorSlot})` } }), `${r.name} (${r.stationIds.map((s) => d.db.stations.find((x) => x.id === s)?.name ?? s).join(', ') || 'sin estación'})`)), h('span', { class: 'lg' }, h('i', { class: 'lg-dot' }), 'Estación (coordenada histórica documentada)'), h('span', { class: 'lg' }, h('i', { class: 'lg-unc' }), 'Ubicación incierta: referencia aproximada y radio'), h('span', { class: 'lg' }, h('i', { class: 'lg-hist' }), 'Coordenada histórica discrepante'));
    }
    return h('div', { class: 'legend' }, h('span', { class: 'lg' }, h('i', { class: 'lg-sw', style: { background: SEQ[1] } }), 'pocos'), h('span', { class: 'lg' }, h('i', { class: 'lg-sw', style: { background: SEQ[SEQ.length - 1] } }), 'muchos'), h('span', { class: 'lg' }, h('i', { class: 'lg-sw hatch' }), d.mode === 'datos' ? 'Sin datos registrados' : 'Sin coincidencias o sin análisis'), h('span', { class: 'lg hint' }, d.mode === 'datos' ? 'Registros de las estaciones de cada región (no la ubicación de los transmisores).' : 'Hipótesis con señal observada (clases B–D) en el último análisis por estación de cada región.'));
}
