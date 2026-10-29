/**
 * Estado de la aplicación y almacenamiento local (localStorage).
 * Ningún dato sale del navegador.
 */

import type { AnalysisRun, AuditResult, Project } from '../engine/index.js';
import { audit, emptyProject, parseProject } from '../engine/index.js';

const KEY_CURRENT = 'orbe-im/actual';
const KEY_INDEX = 'orbe-im/indice';
const KEY_PREFIX = 'orbe-im/proyecto/';

type Listener = () => void;

class Store {
  project: Project = emptyProject();
  run: AnalysisRun | null = null;
  auditResult: AuditResult | null = null;
  /** Huella de los datos con que se calculó `run`, para avisar si quedó obsoleto. */
  runFingerprint = '';
  private listeners = new Set<Listener>();
  private saveTimer: number | undefined;

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit(): void {
    for (const l of this.listeners) l();
  }

  /** Modifica el proyecto, recalcula la auditoría si procede y guarda. */
  update(fn: (p: Project) => void, opts: { reaudit?: boolean } = {}): void {
    fn(this.project);
    this.project.modified = new Date().toISOString();
    if (opts.reaudit !== false) this.reaudit();
    this.scheduleSave();
    this.emit();
  }

  reaudit(): void {
    if (!this.run) { this.auditResult = null; return; }
    this.auditResult = audit(this.run, this.project.observed, this.project.params.toleranceHz, this.project.evidence, this.project.confirmations, this.project.transmitters);
  }

  setRun(run: AnalysisRun | null): void {
    this.run = run;
    this.runFingerprint = run ? this.fingerprint() : '';
    this.reaudit();
    this.emit();
  }

  /** Datos que determinan el resultado del cálculo (no la auditoría). */
  fingerprint(): string {
    const p = this.project;
    const sel = new Set(p.selectedIds);
    const { toleranceHz: _t, ...rest } = p.params;
    void _t;
    return JSON.stringify([p.transmitters.filter((t) => sel.has(t.id)).map((t) => [t.id, t.freqHz]), rest]);
  }

  isRunStale(): boolean {
    return !!this.run && this.runFingerprint !== this.fingerprint();
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveCurrent(), 400);
  }

  saveCurrent(): void {
    try {
      localStorage.setItem(KEY_CURRENT, JSON.stringify(this.project));
    } catch (e) {
      console.warn('No se pudo guardar en el almacenamiento local', e);
    }
  }

  loadCurrent(): void {
    const t = localStorage.getItem(KEY_CURRENT);
    if (!t) return;
    const r = parseProject(t);
    if (r.project) this.project = r.project;
  }

  replaceProject(p: Project): void {
    this.project = p;
    this.run = null;
    this.auditResult = null;
    this.runFingerprint = '';
    this.saveCurrent();
    this.emit();
  }

  // ---- proyectos guardados con nombre
  savedIndex(): { name: string; modified: string }[] {
    try { return JSON.parse(localStorage.getItem(KEY_INDEX) ?? '[]'); } catch { return []; }
  }

  saveAs(name: string): void {
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

  openSaved(name: string): string[] {
    const t = localStorage.getItem(KEY_PREFIX + name);
    if (!t) return ['No existe el proyecto guardado.'];
    const r = parseProject(t);
    if (r.project) this.replaceProject(r.project);
    return r.errors;
  }

  deleteSaved(name: string): void {
    localStorage.removeItem(KEY_PREFIX + name);
    localStorage.setItem(KEY_INDEX, JSON.stringify(this.savedIndex().filter((x) => x.name !== name)));
    this.emit();
  }
}

export const store = new Store();
