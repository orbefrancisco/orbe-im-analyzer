// IndexedDB mínimo en memoria, limitado a lo que usa src/ui/natstore.ts:
// open (con onupgradeneeded), transacciones con oncomplete/onabort y almacenes con
// put/get/getAll/clear. Las escrituras se aplican al terminar la transacción (todo o nada)
// y los valores se guardan como copia estructurada, igual que en el navegador.
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

class Req {
  constructor() { this.result = undefined; this.error = null; this.onsuccess = null; this.onerror = null; }
}

class Store {
  constructor(tx, data) { this.tx = tx; this.data = data; }
  _req(fn) {
    const r = new Req();
    this.tx._pending++;
    queueMicrotask(() => {
      try { r.result = fn(); r.onsuccess?.({ target: r }); }
      catch (e) { r.error = e; r.onerror?.({ target: r }); this.tx._aborted = true; this.tx.error = e; }
      this.tx._settle(true);
    });
    return r;
  }
  _write(op) {
    if (this.tx.mode !== 'readwrite') throw new Error('ReadOnlyError');
    const data = this.data;
    this.tx._writes.push({ data, op });
  }
  put(v, k) { const val = clone(v); this._write((m) => m.set(k, val)); return this._req(() => k); }
  clear() { this._write((m) => m.clear()); return this._req(() => undefined); }
  get(k) { return this._req(() => clone(this.tx._view(this.data).get(k))); }
  getAll() { return this._req(() => [...this.tx._view(this.data).values()].map(clone)); }
}

class Tx {
  constructor(db, names, mode) {
    Object.assign(this, { db, names, mode, _pending: 0, _writes: [], _finished: false, _aborted: false, error: null, oncomplete: null, onerror: null, onabort: null });
    queueMicrotask(() => this._settle());
  }
  objectStore(n) {
    if (!this.names.includes(n)) throw new Error('NotFoundError: ' + n);
    return new Store(this, this.db.stores.get(n));
  }
  /** Vista del almacén con las escrituras pendientes de esta transacción. */
  _view(data) {
    const m = new Map(data);
    for (const w of this._writes) if (w.data === data) w.op(m);
    return m;
  }
  _settle(fromRequest = false) {
    if (fromRequest) this._pending--;
    if (this._pending > 0 || this._finished) return;
    setTimeout(() => {
      if (this._pending > 0 || this._finished) return;
      this._finished = true;
      if (this._aborted) { this.onabort?.(); return; }
      for (const w of this._writes) w.op(w.data);
      this.oncomplete?.();
    }, 0);
  }
}

class DB {
  constructor(name) { this.name = name; this.stores = new Map(); this.version = 0; }
  get objectStoreNames() { const s = this.stores; return { contains: (n) => s.has(n), length: s.size }; }
  createObjectStore(n) { this.stores.set(n, new Map()); return {}; }
  transaction(names, mode = 'readonly') { return new Tx(this, Array.isArray(names) ? names : [names], mode); }
}

export function installFakeIndexedDB() {
  const dbs = new Map();
  globalThis.indexedDB = {
    open(name, version) {
      const r = new Req();
      r.onupgradeneeded = null;
      r.onblocked = null;
      setTimeout(() => {
        let db = dbs.get(name);
        if (!db) { db = new DB(name); dbs.set(name, db); }
        r.result = db;
        if (version > db.version) { db.version = version; r.onupgradeneeded?.({ target: r }); }
        r.onsuccess?.({ target: r });
      }, 0);
      return r;
    },
  };
  return dbs;
}
