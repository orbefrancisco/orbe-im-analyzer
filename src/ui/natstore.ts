/**
 * Almacén de la base nacional en el navegador.
 *
 * Persistencia: IndexedDB, con un almacén de objetos por entidad (estaciones,
 * regiones, transmisores, registros, barridos, análisis, evidencias,
 * confirmaciones, pruebas, fuentes, auditoría) y un almacén «meta» para las
 * asignaciones territoriales y los ajustes. Cada operación escribe sus
 * colecciones en UNA transacción (todo o nada). Si IndexedDB no está
 * disponible, los datos viven en memoria y se avisa de que no persisten.
 */

import type { Cartography, Collection, NationalDB, Scope, ScopeAnalysis } from '../engine/index.js';
import { COLLECTIONS, NATIONAL_SCHEMA, emptyNationalDB, validateCartography } from '../engine/index.js';

const DB_NAME = 'orbe-im-nacional';
const DB_VERSION = 1;
const META_KEYS = ['provinceRegion', 'municipalityRegion', 'assignmentHistory', 'extraMunicipalities', 'settings', 'header'] as const;

type Item = Record<string, unknown>;

function keyOf(coll: Collection, it: Item, i: number): string {
  if (coll === 'confirmations') return `${String(it.observedId)}|${String(it.hypothesisKey)}`;
  return typeof it.id === 'string' && it.id ? it.id : `${coll}-${i}`;
}

interface Backend {
  kind: 'indexeddb' | 'memoria';
  load(): Promise<NationalDB | null>;
  write(db: NationalDB, colls: Collection[], meta: boolean): Promise<void>;
}

class MemoryBackend implements Backend {
  kind = 'memoria' as const;
  private copy: string | null = null;
  async load(): Promise<NationalDB | null> { return this.copy ? JSON.parse(this.copy) : null; }
  async write(db: NationalDB): Promise<void> { this.copy = JSON.stringify(db); }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

class IdbBackend implements Backend {
  kind = 'indexeddb' as const;
  private dbp: Promise<IDBDatabase>;
  constructor(idb: IDBFactory) {
    this.dbp = new Promise((resolve, reject) => {
      const r = idb.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const c of [...COLLECTIONS, 'meta']) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('La base local está bloqueada por otra pestaña.'));
    });
  }
  async load(): Promise<NationalDB | null> {
    const d = await this.dbp;
    const tx = d.transaction([...COLLECTIONS, 'meta'], 'readonly');
    const header = await req(tx.objectStore('meta').get('header')) as { schema: string; createdAt: string } | undefined;
    if (!header) return null;
    const out = emptyNationalDB();
    out.createdAt = header.createdAt;
    for (const c of COLLECTIONS) (out as unknown as Record<string, unknown>)[c] = await req(tx.objectStore(c).getAll());
    for (const k of META_KEYS) {
      if (k === 'header') continue;
      const v = await req(tx.objectStore('meta').get(k));
      if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
    }
    return out;
  }
  async write(db: NationalDB, colls: Collection[], meta: boolean): Promise<void> {
    const d = await this.dbp;
    const stores = [...colls, ...(meta ? ['meta'] : [])];
    if (!stores.length) return;
    const tx = d.transaction(stores, 'readwrite');
    for (const c of colls) {
      const os = tx.objectStore(c);
      os.clear();
      (db[c] as unknown as Item[]).forEach((it, i) => os.put(it, keyOf(c, it, i)));
    }
    if (meta) {
      const os = tx.objectStore('meta');
      os.put({ schema: NATIONAL_SCHEMA, createdAt: db.createdAt }, 'header');
      for (const k of META_KEYS) if (k !== 'header') os.put((db as unknown as Record<string, unknown>)[k], k);
    }
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('Transacción abortada')); });
  }
}

type Listener = () => void;

export class NationalStore {
  db: NationalDB = emptyNationalDB();
  carto: Cartography | null = null;
  cartoError = '';
  ready = false;
  backendKind: 'indexeddb' | 'memoria' = 'memoria';
  saveError = '';
  /** Ámbito activo en las vistas nacionales. */
  scope: Scope = { kind: 'nacional' };
  /** Versión de los datos: invalida los análisis en caché. */
  version = 0;
  analyses = new Map<string, { version: number; sa: ScopeAnalysis }>();
  private backend: Backend = new MemoryBackend();
  private listeners = new Set<Listener>();
  private writing: Promise<void> = Promise.resolve();

  on(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  emit(): void { for (const l of this.listeners) l(); }

  async init(): Promise<void> {
    const idb = (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
    if (idb) {
      try { this.backend = new IdbBackend(idb); } catch { this.backend = new MemoryBackend(); }
    }
    this.backendKind = this.backend.kind;
    try {
      const loaded = await this.backend.load();
      if (loaded) this.db = loaded;
      else await this.backend.write(this.db, COLLECTIONS, true);
    } catch (e) {
      this.saveError = `No se pudo abrir la base local (${(e as Error).message}); los datos se guardan solo en memoria.`;
      this.backend = new MemoryBackend();
      this.backendKind = 'memoria';
    }
    await this.loadCartography();
    this.ready = true;
    this.emit();
  }

  async loadCartography(): Promise<void> {
    try {
      const [p, m] = await Promise.all([fetch('data/rd-provincias.json'), fetch('data/rd-municipios.json')]);
      if (!p.ok || !m.ok) throw new Error('no se pudo descargar la cartografía local');
      const pj = await p.json();
      const mj = await m.json();
      const c: Cartography = { provincias: pj.provincias, municipios: mj.municipios, fuentes: pj.fuentes, atribucion: pj.atribucion, advertencia: pj.advertencia };
      const errs = validateCartography(c);
      if (errs.length) throw new Error(errs[0]);
      this.carto = c;
    } catch (e) {
      this.cartoError = (e as Error).message;
    }
  }

  /**
   * Ejecuta una operación sobre la base y guarda las colecciones afectadas.
   * La auditoría se guarda siempre.
   */
  mutate<T>(fn: (db: NationalDB) => T, colls: Collection[] | 'todo', meta = false): T {
    const r = fn(this.db);
    const list: Collection[] = colls === 'todo' ? COLLECTIONS : [...new Set([...colls, 'audit' as Collection])];
    this.version++;
    this.writing = this.writing.then(() => this.backend.write(this.db, list, meta || colls === 'todo')).then(() => { this.saveError = ''; }).catch((e) => { this.saveError = `Error al guardar: ${(e as Error).message}`; this.emit(); });
    this.emit();
    return r;
  }

  /** Espera a que terminen las escrituras pendientes. */
  flush(): Promise<void> { return this.writing; }

  replaceAll(db: NationalDB): Promise<void> {
    this.db = db;
    this.version++;
    this.analyses.clear();
    this.writing = this.writing.then(() => this.backend.write(this.db, COLLECTIONS, true));
    this.emit();
    return this.writing;
  }

  setScope(s: Scope): void { this.scope = s; this.emit(); }

  scopeKey(s: Scope): string { return JSON.stringify(s); }

  cached(s: Scope): ScopeAnalysis | null {
    const c = this.analyses.get(this.scopeKey(s));
    return c && c.version === this.version ? c.sa : null;
  }

  /** Último análisis aunque esté desactualizado (con indicación). */
  latest(s: Scope): { sa: ScopeAnalysis; stale: boolean } | null {
    const c = this.analyses.get(this.scopeKey(s));
    return c ? { sa: c.sa, stale: c.version !== this.version } : null;
  }

  remember(s: Scope, sa: ScopeAnalysis): void {
    this.analyses.set(this.scopeKey(s), { version: this.version, sa });
    this.emit();
  }

  stationName(id: string): string { return this.db.stations.find((s) => s.id === id)?.name ?? id; }
  provinceName(id: string | null): string { return id ? this.carto?.provincias.find((p) => p.id === id)?.nombre ?? id : '—'; }
  municipalityName(id: string | null): string {
    if (!id) return '—';
    return this.carto?.municipios.find((m) => m.id === id)?.nombre ?? this.db.extraMunicipalities.find((m) => m.id === id)?.nombre ?? id;
  }
}

export const nat = new NationalStore();
