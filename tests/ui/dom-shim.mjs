// DOM mínimo para ejecutar la interfaz compilada (web/js/ui) en Node sin navegador.
// Implementa solo lo que usa la aplicación; no pretende ser un DOM completo.

class FakeNode {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get children() { return this.childNodes.filter((c) => c instanceof FakeElement); }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) { while (this.firstChild) this.removeChild(this.firstChild); nodes.forEach((n) => this.appendChild(typeof n === 'string' ? new FakeText(n) : n)); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new FakeText(String(v))); }
}

class FakeText extends FakeNode {
  constructor(data) { super(); this.data = data; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.style = {};
    this.className = '';
    this.hidden = false;
    this.checked = false;
    this.selected = false;
    this.disabled = false;
    this.listeners = new Map();
    this._value = undefined;
    this.width = 0; this.height = 0;
  }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'TEXTAREA') return this.textContent;
    if (this.tagName === 'SELECT') {
      const opts = this.children.filter((c) => c.tagName === 'OPTION');
      const s = opts.find((o) => o.selected) ?? opts[0];
      return s ? s.value : '';
    }
    if (this.tagName === 'OPTION') return this.attrs.get('value') ?? this.textContent;
    return '';
  }
  set value(v) { this._value = String(v); }
  get id() { return this.attrs.get('id') ?? ''; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'disabled') this.disabled = true; if (k === 'hidden') this.hidden = true; }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(t, fn) { const a = this.listeners.get(t) ?? []; a.push(fn); this.listeners.set(t, a); }
  removeEventListener(t, fn) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter((f) => f !== fn)); }
  dispatch(type, extra = {}) {
    const ev = { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, key: '', offsetX: 0, offsetY: 0, ...extra };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    // burbujeo simple (los <tr> reciben clics de sus celdas)
    if (extra._noBubble !== true) {
      let p = this.parentNode;
      while (p instanceof FakeElement) { for (const fn of p.listeners.get(type) ?? []) fn({ ...ev, currentTarget: p }); p = p.parentNode; }
    }
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() {}
  scrollIntoView() {}
  setPointerCapture() {}
  getContext() {
    // contexto 2D que acepta cualquier llamada y cuenta las operaciones de dibujo
    if (!this._ctx) {
      const calls = { count: 0 };
      this._ctx = new Proxy({ calls }, {
        get: (t, k) => (k in t ? t[k] : (...args) => { calls.count++; void args; }),
        set: (t, k, v) => { t[k] = v; return true; },
      });
    }
    return this._ctx;
  }
  get clientWidth() { return 900; }
  get files() { return null; }
  get classList() { const self = this; return { contains: (c) => self.className.split(/\s+/).includes(c) }; }
  matches(sel) {
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return this.className.split(/\s+/).includes(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

export function installDom() {
  const documentElement = new FakeElement('html');
  const body = new FakeElement('body');
  documentElement.appendChild(body);
  const document = {
    readyState: 'complete',
    documentElement,
    body,
    createElement: (t) => new FakeElement(t),
    createTextNode: (t) => new FakeText(t),
    getElementById: (id) => documentElement.querySelector('#' + id),
    querySelector: (s) => documentElement.querySelector(s),
    addEventListener() {},
  };
  const store = new Map();
  const g = globalThis;
  g.document = document;
  g.window = g;
  g.devicePixelRatio = 1;
  g.location = { hash: '' };
  g.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  g.matchMedia = () => ({ matches: false, addEventListener() {} });
  g.ResizeObserver = class { observe() {} disconnect() {} };
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  g.confirm = () => true;
  g.alert = () => {};
  g.addEventListener = () => {};
  g.HTMLElement = FakeElement;
  const downloads = [];
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:fake/' + downloads.length; };
  URL.revokeObjectURL = () => {};
  void origCreate;
  return { document, body, downloads, FakeElement };
}

/** Busca elementos por etiqueta y texto contenido. */
export function findAll(root, tag, text) {
  return root.querySelectorAll(tag).filter((e) => (text === undefined ? true : e.textContent.includes(text)));
}
export function find(root, tag, text) {
  const r = findAll(root, tag, text);
  if (!r.length) throw new Error(`No se encontró <${tag}> con «${text}»`);
  return r[0];
}
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
