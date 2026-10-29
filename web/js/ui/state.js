/**
 * Estado de la aplicación y almacenamiento local (localStorage).
 * Ningún dato sale del navegador.
 */
import { audit, emptyProject, parseProject } from '../engine/index.js';
const KEY_CURRENT = 'orbe-im/actual';
const KEY_INDEX = 'orbe-im/indice';
const KEY_PREFIX = 'orbe-im/proyecto/';
class Store {
    constructor() {
        this.project = emptyProject();
        this.run = null;
        this.auditResult = null;
        /** Huella de los datos con que se calculó `run`, para avisar si quedó obsoleto. */
        this.runFingerprint = '';
        this.listeners = new Set();
    }
    on(l) {
        this.listeners.add(l);
        return () => this.listeners.delete(l);
    }
    emit() {
        for (const l of this.listeners)
            l();
    }
    /** Modifica el proyecto, recalcula la auditoría si procede y guarda. */
    update(fn, opts = {}) {
        fn(this.project);
        this.project.modified = new Date().toISOString();
        if (opts.reaudit !== false)
            this.reaudit();
        this.scheduleSave();
        this.emit();
    }
    reaudit() {
        if (!this.run) {
            this.auditResult = null;
            return;
        }
        this.auditResult = audit(this.run, this.project.observed, this.project.params.toleranceHz, this.project.evidence, this.project.confirmations, this.project.transmitters);
    }
    setRun(run) {
        this.run = run;
        this.runFingerprint = run ? this.fingerprint() : '';
        this.reaudit();
        this.emit();
    }
    /** Datos que determinan el resultado del cálculo (no la auditoría). */
    fingerprint() {
        const p = this.project;
        const sel = new Set(p.selectedIds);
        const { toleranceHz: _t, ...rest } = p.params;
        void _t;
        return JSON.stringify([p.transmitters.filter((t) => sel.has(t.id)).map((t) => [t.id, t.freqHz]), rest]);
    }
    isRunStale() {
        return !!this.run && this.runFingerprint !== this.fingerprint();
    }
    scheduleSave() {
        if (this.saveTimer)
            clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => this.saveCurrent(), 400);
    }
    saveCurrent() {
        try {
            localStorage.setItem(KEY_CURRENT, JSON.stringify(this.project));
        }
        catch (e) {
            console.warn('No se pudo guardar en el almacenamiento local', e);
        }
    }
    loadCurrent() {
        const t = localStorage.getItem(KEY_CURRENT);
        if (!t)
            return;
        const r = parseProject(t);
        if (r.project)
            this.project = r.project;
    }
    replaceProject(p) {
        this.project = p;
        this.run = null;
        this.auditResult = null;
        this.runFingerprint = '';
        this.saveCurrent();
        this.emit();
    }
    // ---- proyectos guardados con nombre
    savedIndex() {
        try {
            return JSON.parse(localStorage.getItem(KEY_INDEX) ?? '[]');
        }
        catch {
            return [];
        }
    }
    saveAs(name) {
        this.project.name = name;
        this.project.modified = new Date().toISOString();
        localStorage.setItem(KEY_PREFIX + name, JSON.stringify(this.project));
        const idx = this.savedIndex().filter((x) => x.name !== name);
        idx.push({ name, modified: this.project.modified });
        idx.sort((a, b) => a.name.localeCompare(b.name));
        localStorage.setItem(KEY_INDEX, JSON.stringify(idx));
        this.saveCurrent();
        this.emit();
    }
    openSaved(name) {
        const t = localStorage.getItem(KEY_PREFIX + name);
        if (!t)
            return ['No existe el proyecto guardado.'];
        const r = parseProject(t);
        if (r.project)
            this.replaceProject(r.project);
        return r.errors;
    }
    deleteSaved(name) {
        localStorage.removeItem(KEY_PREFIX + name);
        localStorage.setItem(KEY_INDEX, JSON.stringify(this.savedIndex().filter((x) => x.name !== name)));
        this.emit();
    }
}
export const store = new Store();
