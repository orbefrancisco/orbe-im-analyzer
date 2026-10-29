/**
 * Espectro interactivo (canvas).
 *
 * Panel superior: eje de potencia (dBm) SOLO con datos medidos — traza
 * importada, señales observadas y transmisores con nivel conocido.
 * Carriles inferiores: productos teóricos como MARCADORES sin potencia, un
 * carril por orden nominal; nunca se dibujan picos de potencia inventados.
 */
import { formatMHz, groupCombos, formulaNumeric, orderLabel, CLASS_LABEL } from '../engine/index.js';
import { h } from './dom.js';
export const LANES = [
    { id: 'IM3', label: 'IM3', color: '--series-1', shape: 'tick' },
    { id: 'IM5', label: 'IM5', color: '--series-2', shape: 'tri' },
    { id: 'IM7', label: 'IM7', color: '--series-3', shape: 'sq' },
    { id: 'IM9', label: 'IM9', color: '--series-4', shape: 'dia' },
    { id: 'IM11+', label: 'IM≥11 impar', color: '--series-7', shape: 'x' },
    { id: 'PAR', label: 'Orden par', color: '--series-5', shape: 'circ' },
    { id: 'H', label: 'Armónicos', color: '--series-6', shape: 'bar' },
];
export function laneOf(rs, combo) {
    const s = rs.store;
    if (s.tones[combo] === 1)
        return 'H';
    const o = s.order[combo];
    if (o % 2 === 0)
        return 'PAR';
    if (o === 3)
        return 'IM3';
    if (o === 5)
        return 'IM5';
    if (o === 7)
        return 'IM7';
    if (o === 9)
        return 'IM9';
    return 'IM11+';
}
const CLASS_COLOR = { A: '#86b6ef', B: '#3987e5', C: '#256abf', D: '#104281' };
export class Spectrum {
    constructor(container, onSelect) {
        this.onSelect = onSelect;
        this.data = null;
        this.view = { min: 87500000, max: 108500000 };
        this.laneGroups = new Map();
        this.lanesShown = [];
        this.groupLane = [];
        this.geom = { w: 0, h: 0, left: 64, right: 12, topH: 0, laneH: 18, laneTop: 0, axisH: 26 };
        this.drag = null;
        this.canvas = h('canvas', { class: 'spectrum-canvas', role: 'img', 'aria-label': 'Espectro: señales medidas arriba, productos teóricos (sin potencia) en carriles abajo' });
        this.tip = h('div', { class: 'spectrum-tip', role: 'tooltip' });
        this.fromInp = h('input', { type: 'text', inputmode: 'decimal', class: 'narrow', 'aria-label': 'Desde (MHz)' });
        this.toInp = h('input', { type: 'text', inputmode: 'decimal', class: 'narrow', 'aria-label': 'Hasta (MHz)' });
        const apply = () => {
            const a = parseFloat(this.fromInp.value.replace(',', '.'));
            const b = parseFloat(this.toInp.value.replace(',', '.'));
            if (Number.isFinite(a) && Number.isFinite(b) && b > a)
                this.setView(Math.round(a * 1e6), Math.round(b * 1e6));
        };
        this.fromInp.addEventListener('change', apply);
        this.toInp.addEventListener('change', apply);
        const toolbar = h('div', { class: 'spectrum-toolbar' }, h('button', { type: 'button', onclick: () => this.fitBand() }, 'Banda'), h('button', { type: 'button', onclick: () => this.fitAll() }, 'Todo'), h('button', { type: 'button', onclick: () => this.zoom(1 / 1.6), 'aria-label': 'Ampliar' }, '+'), h('button', { type: 'button', onclick: () => this.zoom(1.6), 'aria-label': 'Reducir' }, '−'), h('span', { class: 'hint' }, 'MHz:'), this.fromInp, h('span', null, '–'), this.toInp, h('span', { class: 'hint grow' }, 'Rueda: ampliar · arrastrar: desplazar · clic: seleccionar'));
        this.root = h('div', { class: 'spectrum' }, toolbar, h('div', { class: 'spectrum-wrap' }, this.canvas, this.tip), this.legend());
        container.appendChild(this.root);
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const f = this.xToHz(e.offsetX);
            this.zoom(e.deltaY > 0 ? 1.25 : 0.8, f);
        }, { passive: false });
        this.canvas.addEventListener('pointerdown', (e) => {
            this.canvas.setPointerCapture(e.pointerId);
            this.drag = { x: e.offsetX, min: this.view.min, max: this.view.max, moved: false };
        });
        this.canvas.addEventListener('pointermove', (e) => {
            if (this.drag) {
                const dx = e.offsetX - this.drag.x;
                if (Math.abs(dx) > 3)
                    this.drag.moved = true;
                if (this.drag.moved) {
                    const span = this.drag.max - this.drag.min;
                    const dHz = (-dx / (this.geom.w - this.geom.left - this.geom.right)) * span;
                    this.view = { min: this.drag.min + dHz, max: this.drag.max + dHz };
                    this.draw();
                }
                return;
            }
            this.hover(e.offsetX, e.offsetY);
        });
        this.canvas.addEventListener('pointerup', (e) => {
            const d = this.drag;
            this.drag = null;
            if (d && !d.moved) {
                const hit = this.hit(e.offsetX, e.offsetY);
                if (hit)
                    this.onSelect(hit);
            }
        });
        this.canvas.addEventListener('pointerleave', () => { this.tip.style.display = 'none'; });
        let lastW = 0;
        new ResizeObserver(() => {
            const w = this.canvas.clientWidth;
            if (w !== lastW) {
                lastW = w;
                this.draw();
            }
        }).observe(this.canvas);
        window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.draw());
    }
    legend() {
        return h('div', { class: 'legend' }, h('span', { class: 'lg' }, h('i', { class: 'lg-tx' }), 'Transmisor (generador)'), h('span', { class: 'lg' }, h('i', { class: 'lg-obs' }), 'Señal observada'), h('span', { class: 'lg' }, h('i', { class: 'lg-trace' }), 'Traza medida'), ...LANES.map((l) => h('span', { class: 'lg' }, h('i', { class: 'lg-sw', style: { background: `var(${l.color})` } }), l.label)), h('span', { class: 'lg hint' }, 'Los carriles inferiores son marcadores teóricos sin potencia. Anillo = coincide con una señal (color = clase A–D).'));
    }
    setData(d, keepView = true) {
        const first = this.data === null;
        this.data = d;
        this.laneGroups.clear();
        this.groupLane = [];
        if (d.rs) {
            for (let g = 0; g < d.rs.groupCount; g++) {
                const l = laneOf(d.rs, groupCombos(d.rs, g)[0]);
                this.groupLane[g] = l;
                this.laneGroups.set(l, (this.laneGroups.get(l) ?? 0) + 1);
            }
        }
        this.lanesShown = LANES.map((l) => l.id).filter((l) => (this.laneGroups.get(l) ?? 0) > 0);
        if (first || !keepView)
            this.fitBand();
        else
            this.draw();
    }
    setView(min, max) {
        if (max - min < 1000) {
            const c = (min + max) / 2;
            min = c - 500;
            max = c + 500;
        }
        this.view = { min, max };
        this.draw();
    }
    centerOn(hz) {
        const span = this.view.max - this.view.min;
        if (hz < this.view.min || hz > this.view.max)
            this.setView(hz - span / 2, hz + span / 2);
        else
            this.draw();
    }
    fitBand() {
        const b = this.data?.band ?? { minHz: 88e6, maxHz: 108e6 };
        const pad = (b.maxHz - b.minHz) * 0.02;
        this.setView(b.minHz - pad, b.maxHz + pad);
    }
    fitAll() {
        const d = this.data;
        if (!d)
            return;
        let lo = d.band.minHz, hi = d.band.maxHz;
        const upd = (f) => { if (f < lo)
            lo = f; if (f > hi)
            hi = f; };
        if (d.rs && d.rs.groupCount) {
            upd(d.rs.groupFreq[0]);
            upd(d.rs.groupFreq[d.rs.groupCount - 1]);
        }
        d.transmitters.forEach((t) => upd(t.freqHz));
        d.observed.forEach((t) => upd(t.freqHz));
        if (d.trace && d.trace.length) {
            upd(d.trace[0].hz);
            upd(d.trace[d.trace.length - 1].hz);
        }
        const pad = (hi - lo) * 0.02 || 1e5;
        this.setView(lo - pad, hi + pad);
    }
    zoom(factor, around) {
        const c = around ?? (this.view.min + this.view.max) / 2;
        this.setView(c - (c - this.view.min) * factor, c + (this.view.max - c) * factor);
    }
    xToHz(x) {
        const g = this.geom;
        return this.view.min + ((x - g.left) / (g.w - g.left - g.right)) * (this.view.max - this.view.min);
    }
    hzToX(f) {
        const g = this.geom;
        return g.left + ((f - this.view.min) / (this.view.max - this.view.min)) * (g.w - g.left - g.right);
    }
    levelRange() {
        const d = this.data;
        const vals = [];
        if (d) {
            d.transmitters.forEach((t) => t.levelDbm !== null && vals.push(t.levelDbm));
            d.observed.forEach((t) => t.levelDbm !== null && vals.push(t.levelDbm));
            if (d.trace)
                for (const p of d.trace)
                    vals.push(p.dbm);
        }
        if (!vals.length)
            return [-120, 0];
        let lo = Math.min(...vals), hi = Math.max(...vals);
        if (hi - lo < 10) {
            lo -= 5;
            hi += 5;
        }
        const pad = (hi - lo) * 0.08;
        return [Math.floor((lo - pad) / 10) * 10, Math.ceil((hi + pad) / 10) * 10];
    }
    draw() {
        const cv = this.canvas;
        const dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth || 800;
        const g = this.geom;
        const nL = Math.max(1, this.lanesShown.length);
        g.w = w;
        g.topH = 230;
        g.laneTop = g.topH + 8;
        g.h = g.laneTop + nL * g.laneH + g.axisH + 8;
        cv.style.height = g.h + 'px';
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(g.h * dpr);
        const c = cv.getContext('2d');
        if (!c)
            return;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const css = getComputedStyle(this.root);
        const v = (n, fb) => css.getPropertyValue(n).trim() || fb;
        const ink = v('--text-primary', '#0b0b0b');
        const ink2 = v('--text-secondary', '#52514e');
        const muted = v('--text-muted', '#898781');
        const grid = v('--grid', '#e1e0d9');
        const surface = v('--surface-1', '#fcfcfb');
        const bandFill = v('--band-fill', 'rgba(42,120,214,0.06)');
        const obsColor = v('--series-8', '#e34948');
        c.fillStyle = surface;
        c.fillRect(0, 0, w, g.h);
        const d = this.data;
        if (!d)
            return;
        this.fromInp.value = (this.view.min / 1e6).toFixed(3);
        this.toInp.value = (this.view.max / 1e6).toFixed(3);
        const x0 = g.left, x1 = w - g.right;
        // banda
        const bx0 = Math.max(x0, this.hzToX(d.band.minHz)), bx1 = Math.min(x1, this.hzToX(d.band.maxHz));
        if (bx1 > bx0) {
            c.fillStyle = bandFill;
            c.fillRect(bx0, 0, bx1 - bx0, g.laneTop + nL * g.laneH);
        }
        // eje de frecuencia: ticks
        const span = this.view.max - this.view.min;
        const target = span / Math.max(4, Math.floor((x1 - x0) / 90));
        const steps = [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2e8, 5e8, 1e9];
        const step = steps.find((s) => s >= target) ?? 1e9;
        const dec = step >= 1e6 ? 0 : step >= 1e5 ? 1 : step >= 1e4 ? 2 : 3;
        c.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'top';
        const axisY = g.laneTop + nL * g.laneH + 4;
        for (let f = Math.ceil(this.view.min / step) * step; f <= this.view.max; f += step) {
            const x = Math.round(this.hzToX(f)) + 0.5;
            c.strokeStyle = grid;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(x, 0);
            c.lineTo(x, axisY - 2);
            c.stroke();
            c.fillStyle = muted;
            c.fillText((f / 1e6).toFixed(dec), x, axisY + 2);
        }
        c.textAlign = 'right';
        c.fillText('MHz', x0 - 6, axisY + 2);
        // eje de potencia
        const [lo, hi] = this.levelRange();
        const yOf = (dbm) => 10 + ((hi - dbm) / (hi - lo)) * (g.topH - 20);
        c.textBaseline = 'middle';
        for (let L = lo; L <= hi; L += (hi - lo) > 60 ? 20 : 10) {
            const y = Math.round(yOf(L)) + 0.5;
            c.strokeStyle = grid;
            c.beginPath();
            c.moveTo(x0, y);
            c.lineTo(x1, y);
            c.stroke();
            c.fillStyle = muted;
            c.fillText(`${L}`, x0 - 6, y);
        }
        c.save();
        c.translate(12, g.topH / 2);
        c.rotate(-Math.PI / 2);
        c.textAlign = 'center';
        c.fillText('Nivel medido (dBm)', 0, 0);
        c.restore();
        c.save();
        c.beginPath();
        c.rect(x0, 0, x1 - x0, g.h);
        c.clip();
        // traza
        if (d.trace && d.trace.length > 1) {
            c.strokeStyle = ink2;
            c.lineWidth = 1.5;
            c.beginPath();
            let started = false;
            // reducción por píxel: mínimo y máximo de cada columna
            let col = -1, cmin = 0, cmax = 0;
            const flush = () => { if (col < 0)
                return; const ya = yOf(cmax), yb = yOf(cmin); if (!started) {
                c.moveTo(col, ya);
                started = true;
            }
            else
                c.lineTo(col, ya); c.lineTo(col, yb); };
            for (const p of d.trace) {
                if (p.hz < this.view.min - span * 0.01 || p.hz > this.view.max + span * 0.01)
                    continue;
                const x = Math.round(this.hzToX(p.hz));
                if (x !== col) {
                    flush();
                    col = x;
                    cmin = cmax = p.dbm;
                }
                else {
                    if (p.dbm < cmin)
                        cmin = p.dbm;
                    if (p.dbm > cmax)
                        cmax = p.dbm;
                }
            }
            flush();
            c.stroke();
        }
        const selGens = new Set();
        if (d.rs && d.selectedGroup !== null && d.selectedGroup !== undefined && d.selectedGroup < d.rs.groupCount) {
            for (const cmb of groupCombos(d.rs, d.selectedGroup))
                for (let t = d.rs.store.termStart[cmb]; t < d.rs.store.termStart[cmb + 1]; t++)
                    selGens.add(d.rs.store.termIdx[t]);
        }
        const selFreqs = new Set([...selGens].map((i) => d.rs.generators[i].freqHz));
        // transmisores
        for (const t of d.transmitters) {
            const x = this.hzToX(t.freqHz);
            if (x < x0 - 10 || x > x1 + 10)
                continue;
            const known = t.levelDbm !== null;
            const y = known ? yOf(t.levelDbm) : 18;
            c.strokeStyle = ink;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(x, g.topH - 4);
            c.lineTo(x, y);
            c.stroke();
            diamond(c, x, y, 5, known ? ink : surface, ink);
            if (selFreqs.has(t.freqHz)) {
                c.strokeStyle = v('--accent', '#2a78d6');
                c.lineWidth = 2.5;
                c.beginPath();
                c.arc(x, y, 9, 0, Math.PI * 2);
                c.stroke();
            }
        }
        // observadas
        for (const o of d.observed) {
            const x = this.hzToX(o.freqHz);
            if (x < x0 - 10 || x > x1 + 10)
                continue;
            c.strokeStyle = obsColor;
            c.lineWidth = 1.5;
            if (o.levelDbm !== null) {
                const y = yOf(o.levelDbm);
                c.beginPath();
                c.moveTo(x, g.topH - 4);
                c.lineTo(x, y);
                c.stroke();
                circle(c, x, y, 4.5, obsColor, surface);
            }
            else {
                c.setLineDash([4, 3]);
                c.beginPath();
                c.moveTo(x, 10);
                c.lineTo(x, g.topH - 4);
                c.stroke();
                c.setLineDash([]);
                circle(c, x, 10, 4, surface, obsColor);
            }
            if (d.selectedObservedId === o.id) {
                c.strokeStyle = v('--accent', '#2a78d6');
                c.lineWidth = 2.5;
                c.beginPath();
                c.arc(x, o.levelDbm !== null ? yOf(o.levelDbm) : 10, 9, 0, Math.PI * 2);
                c.stroke();
            }
        }
        // carriles de productos teóricos
        c.restore();
        c.textAlign = 'right';
        c.textBaseline = 'middle';
        this.lanesShown.forEach((lane, i) => {
            const y = g.laneTop + i * g.laneH;
            c.fillStyle = muted;
            c.fillText(`${LANES.find((l) => l.id === lane).label}`, x0 - 6, y + g.laneH / 2);
            c.strokeStyle = grid;
            c.beginPath();
            c.moveTo(x0, y + g.laneH - 0.5);
            c.lineTo(x1, y + g.laneH - 0.5);
            c.stroke();
        });
        if (!d.rs) {
            c.fillStyle = muted;
            c.textAlign = 'left';
            c.fillText('Sin productos calculados', x0 + 8, g.laneTop + g.laneH / 2);
            return;
        }
        const rs = d.rs;
        c.save();
        c.beginPath();
        c.rect(x0, 0, x1 - x0, g.h);
        c.clip();
        const a = lowerBound(rs.groupFreq, rs.groupCount, this.view.min);
        const laneIdx = new Map(this.lanesShown.map((l, i) => [l, i]));
        const lastX = new Map();
        for (let gi = a; gi < rs.groupCount && rs.groupFreq[gi] <= this.view.max; gi++) {
            const lane = this.groupLane[gi];
            const li = laneIdx.get(lane);
            const x = Math.round(this.hzToX(rs.groupFreq[gi])) + 0.5;
            const cls = d.groupClass?.get(gi);
            const y = g.laneTop + li * g.laneH;
            const def = LANES.find((l) => l.id === lane);
            const col = v(def.color, '#2a78d6');
            if (lastX.get(lane) !== x || cls) {
                marker(c, def.shape, x, y + g.laneH / 2, col);
                lastX.set(lane, x);
            }
            if (cls && cls !== 'A') {
                c.strokeStyle = CLASS_COLOR[cls];
                c.lineWidth = 2;
                c.beginPath();
                c.arc(x, y + g.laneH / 2, 7, 0, Math.PI * 2);
                c.stroke();
            }
            if (gi === d.selectedGroup) {
                c.strokeStyle = v('--accent', '#2a78d6');
                c.lineWidth = 1;
                c.setLineDash([3, 3]);
                c.beginPath();
                c.moveTo(x, 0);
                c.lineTo(x, axisY - 2);
                c.stroke();
                c.setLineDash([]);
            }
        }
        c.restore();
        c.strokeStyle = v('--axis', '#c3c2b7');
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x0, g.topH + 0.5);
        c.lineTo(x1, g.topH + 0.5);
        c.stroke();
        c.fillStyle = muted;
        c.textAlign = 'left';
        c.textBaseline = 'top';
        c.fillText('Productos teóricos — marcadores sin potencia', x0 + 4, g.topH + 1);
    }
    hit(x, y) {
        const d = this.data;
        if (!d)
            return null;
        const g = this.geom;
        const tol = 8;
        if (y < g.topH) {
            let best = null, bd = tol;
            for (const o of d.observed) {
                const dx = Math.abs(this.hzToX(o.freqHz) - x);
                if (dx <= bd) {
                    bd = dx;
                    best = { kind: 'observada', id: o.id };
                }
            }
            for (const t of d.transmitters) {
                const dx = Math.abs(this.hzToX(t.freqHz) - x);
                if (dx < bd) {
                    bd = dx;
                    best = { kind: 'transmisor', id: t.id };
                }
            }
            return best;
        }
        const li = Math.floor((y - g.laneTop) / g.laneH);
        if (!d.rs || li < 0 || li >= this.lanesShown.length)
            return null;
        const lane = this.lanesShown[li];
        const f = this.xToHz(x);
        const hzTol = (tol / (g.w - g.left - g.right)) * (this.view.max - this.view.min);
        let best = -1, bd = Infinity;
        for (let gi = lowerBound(d.rs.groupFreq, d.rs.groupCount, f - hzTol); gi < d.rs.groupCount && d.rs.groupFreq[gi] <= f + hzTol; gi++) {
            if (this.groupLane[gi] !== lane)
                continue;
            const dd = Math.abs(d.rs.groupFreq[gi] - f);
            if (dd < bd) {
                bd = dd;
                best = gi;
            }
        }
        return best >= 0 ? { kind: 'producto', group: best } : null;
    }
    hover(x, y) {
        const hit = this.hit(x, y);
        const d = this.data;
        if (!hit || !d) {
            this.tip.style.display = 'none';
            return;
        }
        let html = h('div');
        if (hit.kind === 'producto' && d.rs) {
            const cs = groupCombos(d.rs, hit.group);
            const cls = d.groupClass?.get(hit.group);
            html = h('div', null, h('strong', null, `${formatMHz(d.rs.groupFreq[hit.group], 3)} MHz`), ' · producto teórico', ...cs.slice(0, 6).map((cmb) => h('div', null, `${orderLabel(d.rs.store, cmb)}: ${formulaNumeric(d.rs, cmb)}`)), cs.length > 6 ? h('div', { class: 'hint' }, `… y ${cs.length - 6} combinaciones más`) : null, cls ? h('div', null, `Clase ${cls}: ${CLASS_LABEL[cls]}`) : null);
        }
        else if (hit.kind !== 'producto') {
            const list = hit.kind === 'observada' ? d.observed : d.transmitters;
            const s = list.find((o) => o.id === hit.id);
            html = h('div', null, h('strong', null, `${formatMHz(s.freqHz, 3)} MHz`), hit.kind === 'observada' ? ' · señal observada' : ' · transmisor', s.label ? h('div', null, s.label) : null, h('div', null, s.levelDbm !== null ? `${s.levelDbm} dBm` : 'nivel desconocido'));
        }
        this.tip.replaceChildren(html);
        this.tip.style.display = 'block';
        const left = Math.min(x + 14, this.geom.w - 260);
        this.tip.style.left = left + 'px';
        this.tip.style.top = Math.max(0, y - 10) + 'px';
    }
}
function lowerBound(arr, n, v) {
    let a = 0, b = n;
    while (a < b) {
        const m = (a + b) >> 1;
        if (arr[m] < v)
            a = m + 1;
        else
            b = m;
    }
    return a;
}
function diamond(c, x, y, r, fill, stroke) {
    c.beginPath();
    c.moveTo(x, y - r);
    c.lineTo(x + r, y);
    c.lineTo(x, y + r);
    c.lineTo(x - r, y);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    c.strokeStyle = stroke;
    c.lineWidth = 1.5;
    c.stroke();
}
function circle(c, x, y, r, fill, stroke) {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    c.strokeStyle = stroke;
    c.lineWidth = 2;
    c.stroke();
}
function marker(c, shape, x, y, col) {
    c.fillStyle = col;
    c.strokeStyle = col;
    c.lineWidth = 2;
    const r = 4;
    c.beginPath();
    switch (shape) {
        case 'tick':
            c.moveTo(x, y - 6);
            c.lineTo(x, y + 6);
            c.stroke();
            return;
        case 'tri':
            c.moveTo(x, y - r - 1);
            c.lineTo(x + r + 1, y + r);
            c.lineTo(x - r - 1, y + r);
            c.closePath();
            c.fill();
            return;
        case 'sq':
            c.rect(x - r + 0.5, y - r + 0.5, 2 * r - 1, 2 * r - 1);
            c.fill();
            return;
        case 'dia':
            c.moveTo(x, y - r - 1);
            c.lineTo(x + r + 1, y);
            c.lineTo(x, y + r + 1);
            c.lineTo(x - r - 1, y);
            c.closePath();
            c.fill();
            return;
        case 'circ':
            c.arc(x, y, r, 0, Math.PI * 2);
            c.fill();
            return;
        case 'x':
            c.moveTo(x - r, y - r);
            c.lineTo(x + r, y + r);
            c.moveTo(x + r, y - r);
            c.lineTo(x - r, y + r);
            c.stroke();
            return;
        default:
            c.rect(x - 1, y - 6, 2, 12);
            c.fill();
    }
}
