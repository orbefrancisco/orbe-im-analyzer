/**
 * Tipos de datos compartidos por el motor. Ninguno depende del DOM.
 */

/** Clasificación declarada por el usuario. El motor NUNCA la modifica por su cuenta. */
export type SignalClass = 'portadora_confirmada' | 'senal_observada' | 'sospechosa' | 'desconocida';

export const SIGNAL_CLASS_LABEL: Record<SignalClass, string> = {
  portadora_confirmada: 'Portadora confirmada',
  senal_observada: 'Señal observada',
  sospechosa: 'Frecuencia sospechosa',
  desconocida: 'Desconocida',
};

export interface SignalRecord {
  /** Identificador estable (no depende del orden en la lista). */
  id: string;
  freqHz: number;
  label: string;
  /** Nivel en dBm, si se conoce. */
  levelDbm: number | null;
  /** Nivel tal como venía en el archivo, si no era convertible a dBm (p. ej. dBµV/m). */
  levelRaw?: string;
  datetime: string;
  equipment: string;
  notes: string;
  classification: SignalClass;
  /** Origen del dato: «manual», nombre de archivo, etc. */
  source: string;
}

export interface Band {
  minHz: number;
  maxHz: number;
  name: string;
}

export const FM_BAND: Band = { minHz: 88_000_000, maxHz: 108_000_000, name: 'FM 88–108 MHz' };

/** Tipo de producto según los signos de sus coeficientes. */
export type ProductKind = 'armonico' | 'suma' | 'mixto';

export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = {
  armonico: 'Armónico puro',
  suma: 'IM de suma',
  mixto: 'IM de diferencia',
};

export interface Term {
  /** Índice del generador dentro de la lista usada en el cálculo. */
  index: number;
  coef: number;
}

let idCounter = 0;
export function newId(prefix = 's'): string {
  idCounter = (idCounter + 1) % 1e6;
  return prefix + Date.now().toString(36) + idCounter.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

export function makeSignal(freqHz: number, partial: Partial<SignalRecord> = {}): SignalRecord {
  return {
    id: partial.id ?? newId(),
    freqHz,
    label: partial.label ?? '',
    levelDbm: partial.levelDbm ?? null,
    levelRaw: partial.levelRaw,
    datetime: partial.datetime ?? '',
    equipment: partial.equipment ?? '',
    notes: partial.notes ?? '',
    classification: partial.classification ?? 'desconocida',
    source: partial.source ?? 'manual',
  };
}
