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
import { COLLECTIONS, NATIONAL_SCHEMA, emptyNationalDB, validateCartography } from '../engine/index.js';
const DB_NAME = 'orbe-im-nacional';
const DB_VERSION = 1;
const META_KEYS = ['provinceRegion', 'municipalityRegion', 'assignmentHistory', 'extraMunicipalities', 'settings', 'header'];
function keyOf(coll, it, i) {
    if (coll === 'confirmations')
        return `${String(it.observedId)}|${String(it.hypothesisKey)}`;
    return typeof it.id === 'string' && it.id ? it.id : `${coll}-${i}`;
}
class MemoryBackend {
    constructor() {
        this.kind = 'memoria';
        this.copy = null;
    }
    async load() { return this.copy ? JSON.parse(this.copy) : null; }
    async write(db) { this.copy = JSON.stringify(db); }
}
function req(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
class IdbBackend {
    constructor(idb) {
        this.kind = 'indexeddb';
        this.dbp = new Promise((resolve, reject) => {
            const r = idb.open(DB_NAME, DB_VERSION);
            r.onupgradeneeded = () => {
                const d = r.result;
                for (const c of [...COLLECTIONS, 'meta'])
                    if (!d.objectStoreNames.contains(c))
                        d.createObjectStore(c);
            };
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
            r.onblocked = () => reject(new Error('La base local está bloqueada por otra pestaña.'));
        });
    }
    async load() {
        const d = await this.dbp;
        const tx = d.transaction([...COLLECTIONS, 'meta'], 'readonly');
        const header = await req(tx.objectStore('meta').get('header'));
        if (!header)
            return null;
        const out = emptyNationalDB();
        out.createdAt = header.createdAt;
        for (const c of COLLECTIONS)
            out[c] = await req(tx.objectStore(c).getAll());
        for (const k of META_KEYS) {
            if (k === 'header')
                continue;
            const v = await req(tx.objectStore('meta').get(k));
            if (v !== undefined)
                out[k] = v;
        }
        return out;
    }
    async write(db, colls, meta) {
        const d = await this.dbp;
        const stores = [...colls, ...(meta ? ['meta'] : [])];
        if (!stores.length)
            return;
        const tx = d.transaction(stores, 'readwrite');
        for (const c of colls) {
            const os = tx.objectStore(c);
            os.clear();
            db[c].forEach((it, i) => os.put(it, keyOf(c, it, i)));
        }
        if (meta) {
            const os = tx.objectStore('meta');
            os.put({ schema: NATIONAL_SCHEMA, createdAt: db.createdAt }, 'header');
            for (const k of META_KEYS)
                if (k !== 'header')
                    os.put(db[k], k);
        }
        await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('Transacción abortada')); });
    }
}
export class NationalStore {
    constructor() {
        this.db = emptyNationalDB();
        this.carto = null;
        this.cartoError = '';
        this.ready = false;
        this.backendKind = 'memoria';
        this.saveError = '';
        /** Ámbito activo en las vistas nacionales. */
        this.scope = { kind: 'nacional' };
        /** Versión de los datos: invalida los análisis en caché. */
        this.version = 0;
        this.analyses = new Map();
        this.backend = new MemoryBackend();
        this.listeners = new Set();
        this.writing = Promise.resolve();
    }
    on(l) { this.listeners.add(l); return () => this.listeners.delete(l); }
    emit() { for (const l of this.listeners)
        l(); }
    async init() {
        const idb = globalThis.indexedDB;
        if (idb) {
            try {
                this.backend = new IdbBackend(idb);
            }
            catch {
                this.backend = new MemoryBackend();
            }
        }
        this.backendKind = this.backend.kind;
        try {
            const loaded = await this.backend.load();
            if (loaded)
                this.db = loaded;
            else
                await this.backend.write(this.db, COLLECTIONS, true);
        }
        catch (e) {
            this.saveError = `No se pudo abrir la base local (${e.message}); los datos se guardan solo en memoria.`;
            this.backend = new MemoryBackend();
            this.backendKind = 'memoria';
        }
        await this.loadCartography();
        this.ready = true;
        this.emit();
    }
    async loadCartography() {
        try {
            const [p, m] = await Promise.all([fetch('data/rd-provincias.json'), fetch('data/rd-municipios.json')]);
            if (!p.ok || !m.ok)
                throw new Error('no se pudo descargar la cartografía local');
            const pj = await p.json();
            const mj = await m.json();
            const c = { provincias: pj.provincias, municipios: mj.municipios, fuentes: pj.fuentes, atribucion: pj.atribucion, advertencia: pj.advertencia };
            const errs = validateCartography(c);
            if (errs.length)
                throw new Error(errs[0]);
            this.carto = c;
        }
        catch (e) {
            this.cartoError = e.message;
        }
    }
    /**
     * Ejecuta una operación sobre la base y guarda las colecciones afectadas.
     * La auditoría se guarda siempre.
     */
    mutate(fn, colls, meta = false) {
        const r = fn(this.db);
        const list = colls === 'todo' ? COLLECTIONS : [...new Set([...colls, 'audit'])];
        this.version++;
        this.writing = this.writing.then(() => this.backend.write(this.db, list, meta || colls === 'todo')).then(() => { this.saveError = ''; }).catch((e) => { this.saveError = `Error al guardar: ${e.message}`; this.emit(); });
        this.emit();
        return r;
    }
    /** Espera a que terminen las escrituras pendientes. */
    flush() { return this.writing; }
    replaceAll(db) {
        this.db = db;
        this.version++;
        this.analyses.clear();
        this.writing = this.writing.then(() => this.backend.write(this.db, COLLECTIONS, true));
        this.emit();
        return this.writing;
    }
    setScope(s) { this.scope = s; this.emit(); }
    scopeKey(s) { return JSON.stringify(s); }
    cached(s) {
        const c = this.analyses.get(this.scopeKey(s));
        return c && c.version === this.version ? c.sa : null;
    }
    /** Último análisis aunque esté desactualizado (con indicación). */
    latest(s) {
        const c = this.analyses.get(this.scopeKey(s));
        return c ? { sa: c.sa, stale: c.version !== this.version } : null;
    }
    remember(s, sa) {
        this.analyses.set(this.scopeKey(s), { version: this.version, sa });
        this.emit();
    }
    stationName(id) { return this.db.stations.find((s) => s.id === id)?.name ?? id; }
    provinceName(id) { return id ? this.carto?.provincias.find((p) => p.id === id)?.nombre ?? id : '—'; }
    municipalityName(id) {
        if (!id)
            return '—';
        return this.carto?.municipios.find((m) => m.id === id)?.nombre ?? this.db.extraMunicipalities.find((m) => m.id === id)?.nombre ?? id;
    }
}
export const nat = new NationalStore();
