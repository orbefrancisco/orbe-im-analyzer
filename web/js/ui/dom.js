/** Utilidades mínimas de DOM (sin frameworks). */
export function h(tag, attrs = null, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false)
                continue;
            if (k === 'class')
                el.className = String(v);
            else if (k === 'style' && typeof v === 'object')
                Object.assign(el.style, v);
            else if (k.startsWith('on') && typeof v === 'function')
                el.addEventListener(k.slice(2).toLowerCase(), v);
            else if (k === 'value' && 'value' in el)
                el.value = String(v);
            else if (k === 'checked' && 'checked' in el)
                el.checked = !!v;
            else if (k === 'selected' && 'selected' in el)
                el.selected = !!v;
            else if (v === true)
                el.setAttribute(k, '');
            else
                el.setAttribute(k, String(v));
        }
    }
    append(el, children);
    return el;
}
/** Elemento SVG (los textos se insertan siempre como nodos de texto, nunca como HTML). */
export function svg(tag, attrs = {}, ...children) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs))
        if (v !== undefined && v !== null)
            el.setAttribute(k, String(v));
    append(el, children);
    return el;
}
function append(el, children) {
    for (const c of children) {
        if (c === null || c === undefined || c === false)
            continue;
        if (Array.isArray(c))
            append(el, c);
        else
            el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
}
export function clear(el) {
    while (el.firstChild)
        el.removeChild(el.firstChild);
}
export function mount(el, ...children) {
    clear(el);
    append(el, children);
}
export function $(sel, root = document) {
    const e = root.querySelector(sel);
    if (!e)
        throw new Error('No existe ' + sel);
    return e;
}
export function select(options, value, onChange, attrs = {}) {
    return h('select', { ...attrs, onchange: (e) => onChange(e.target.value) }, ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
}
export function field(label, control, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}
export function download(name, data, mime) {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
export async function inflateRawBrowser(data) {
    const DS = globalThis.DecompressionStream;
    if (!DS)
        throw new Error('Este navegador no puede descomprimir archivos .xlsx (falta DecompressionStream). Exporte a CSV.');
    const stream = new Blob([data]).stream().pipeThrough(new DS('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
export function pickFile(accept) {
    return new Promise((resolve) => {
        const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
        inp.addEventListener('change', () => { resolve(inp.files && inp.files[0] ? inp.files[0] : null); inp.remove(); });
        document.body.appendChild(inp);
        inp.click();
    });
}
let toastTimer;
export function toast(msg, kind = 'info') {
    let t = document.getElementById('toast');
    if (!t) {
        t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'toast show ' + kind;
    if (toastTimer)
        clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { t.className = 'toast'; }, 4500);
}
export function stamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
export function num(v) {
    const t = v.trim().replace(',', '.').replace('−', '-');
    if (t === '')
        return null;
    const x = Number(t);
    return Number.isFinite(x) ? x : null;
}
export function details(summary, open, ...children) {
    const d = h('details', { open }, h('summary', null, summary), ...children);
    return d;
}
