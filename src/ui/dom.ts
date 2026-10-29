/** Utilidades mínimas de DOM (sin frameworks). */

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'value' && 'value' in el) (el as unknown as HTMLInputElement).value = String(v);
      else if (k === 'checked' && 'checked' in el) (el as unknown as HTMLInputElement).checked = !!v;
      else if (k === 'selected' && 'selected' in el) (el as unknown as HTMLOptionElement).selected = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function mount(el: Element, ...children: Child[]): void {
  clear(el);
  append(el, children);
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const e = root.querySelector(sel);
  if (!e) throw new Error('No existe ' + sel);
  return e as HTMLElement;
}

export function select(options: { value: string; label: string }[], value: string, onChange: (v: string) => void, attrs: Attrs = {}): HTMLSelectElement {
  return h('select', { ...attrs, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
}

export function field(label: string, control: Node, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function download(name: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

export async function inflateRawBrowser(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream?: new (f: string) => TransformStream }).DecompressionStream;
  if (!DS) throw new Error('Este navegador no puede descomprimir archivos .xlsx (falta DecompressionStream). Exporte a CSV.');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve(inp.files && inp.files[0] ? inp.files[0] : null); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

let toastTimer: number | undefined;
export function toast(msg: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t!.className = 'toast'; }, 4500);
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function num(v: string): number | null {
  const t = v.trim().replace(',', '.').replace('−', '-');
  if (t === '') return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

export function details(summary: Child, open: boolean, ...children: Child[]): HTMLDetailsElement {
  const d = h('details', { open }, h('summary', null, summary), ...children);
  return d;
}
