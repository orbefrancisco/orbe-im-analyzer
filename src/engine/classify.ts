/**
 * Clasificación de hipótesis de intermodulación.
 *
 *   A · Producto teórico       existe matemáticamente; no hay señal medida dentro de tolerancia.
 *   B · Coincidencia observada  hay una señal medida a |Δf| ≤ tolerancia.
 *   C · Candidato experimental  B + al menos una evidencia documentada COMPATIBLE con la
 *                               hipótesis y ninguna INCOMPATIBLE.
 *   D · Producto confirmado     C + confirmación explícita y justificada del usuario +
 *                               evidencia fuerte (apagado de un generador o correlación de
 *                               modulación) o dos evidencias compatibles de tipos distintos +
 *                               todos los generadores declarados «portadora confirmada».
 *
 * El motor NUNCA asciende una hipótesis a D por sí solo, ni reclasifica señales.
 * La coincidencia matemática (B) jamás se trata como confirmación física.
 */

import type { SignalRecord } from './model.js';

export type HypothesisClass = 'A' | 'B' | 'C' | 'D';

export const CLASS_LABEL: Record<HypothesisClass, string> = {
  A: 'Producto teórico',
  B: 'Coincidencia observada',
  C: 'Candidato experimental',
  D: 'Producto confirmado',
};

export type EvidenceType = 'atenuacion' | 'apagado_generador' | 'correlacion_modulacion' | 'variacion_conjunta' | 'otra';

export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = {
  atenuacion: 'Prueba de atenuación',
  apagado_generador: 'Desaparece al apagar/atenuar un generador',
  correlacion_modulacion: 'Contiene la modulación de los generadores',
  variacion_conjunta: 'Varía en el tiempo junto con los generadores',
  otra: 'Otra evidencia documentada',
};

export const STRONG_EVIDENCE: EvidenceType[] = ['apagado_generador', 'correlacion_modulacion'];

export type EvidenceResult = 'compatible' | 'incompatible' | 'no_concluyente';

export interface Evidence {
  id: string;
  observedId: string;
  /** null = aplica a todas las hipótesis de esa señal. */
  hypothesisKey: string | null;
  type: EvidenceType;
  result: EvidenceResult;
  description: string;
  date: string;
  author: string;
  /** Prueba de laboratorio de la que procede, si existe. */
  labTestId: string | null;
}

export interface Confirmation {
  observedId: string;
  hypothesisKey: string;
  justification: string;
  author: string;
  date: string;
}

export const MIN_JUSTIFICATION_CHARS = 30;

export interface ClassificationInput {
  matched: boolean;
  observedId: string | null;
  hypothesisKey: string;
  /** Generadores que intervienen en la hipótesis. */
  generators: SignalRecord[];
  evidence: Evidence[];
  confirmations: Confirmation[];
}

export interface Classification {
  cls: HypothesisClass;
  reasons: string[];
  /** Qué falta para el siguiente nivel. */
  missing: string[];
  applicableEvidence: Evidence[];
}

export function applicableEvidence(evidence: Evidence[], observedId: string, key: string): Evidence[] {
  return evidence.filter((e) => e.observedId === observedId && (e.hypothesisKey === null || e.hypothesisKey === key));
}

export function classifyHypothesis(inp: ClassificationInput): Classification {
  if (!inp.matched || inp.observedId === null) {
    return { cls: 'A', reasons: ['No hay ninguna señal medida dentro de la tolerancia.'], missing: ['Una señal medida dentro de la tolerancia.'], applicableEvidence: [] };
  }
  const ev = applicableEvidence(inp.evidence, inp.observedId, inp.hypothesisKey);
  const comp = ev.filter((e) => e.result === 'compatible');
  const incomp = ev.filter((e) => e.result === 'incompatible');
  const reasons = ['Existe una señal medida dentro de la tolerancia (coincidencia de frecuencia, no confirmación física).'];
  if (incomp.length) {
    return {
      cls: 'B',
      reasons: [...reasons, `Hay ${incomp.length} evidencia(s) incompatible(s) con esta hipótesis: ${incomp.map((e) => EVIDENCE_TYPE_LABEL[e.type]).join(', ')}.`],
      missing: ['Resolver o documentar las evidencias incompatibles.'],
      applicableEvidence: ev,
    };
  }
  if (!comp.length) {
    return { cls: 'B', reasons, missing: ['Al menos una evidencia experimental documentada y compatible (p. ej. prueba de atenuación concluyente).'], applicableEvidence: ev };
  }
  reasons.push(`Evidencia compatible: ${comp.map((e) => EVIDENCE_TYPE_LABEL[e.type]).join(', ')}.`);
  const missing: string[] = [];
  const conf = inp.confirmations.find((c) => c.observedId === inp.observedId && c.hypothesisKey === inp.hypothesisKey);
  if (!conf) missing.push('Confirmación explícita del analista.');
  else {
    if (conf.justification.trim().length < MIN_JUSTIFICATION_CHARS) missing.push(`Justificación documentada de al menos ${MIN_JUSTIFICATION_CHARS} caracteres.`);
    if (!conf.author.trim()) missing.push('Autor de la confirmación.');
    if (!conf.date.trim()) missing.push('Fecha de la confirmación.');
  }
  const strong = comp.some((e) => STRONG_EVIDENCE.includes(e.type));
  const types = new Set(comp.map((e) => e.type));
  if (!strong && types.size < 2) missing.push('Evidencia fuerte (apagado de un generador o correlación de modulación) o dos evidencias compatibles de tipos distintos.');
  const unconfirmed = inp.generators.filter((g) => g.classification !== 'portadora_confirmada');
  if (unconfirmed.length) missing.push(`Generadores no declarados como portadora confirmada: ${unconfirmed.map((g) => (g.freqHz / 1e6).toFixed(3) + ' MHz' + (g.label ? ` (${g.label})` : '')).join(', ')}.`);
  for (const e of comp) if (!e.description.trim()) missing.push(`La evidencia «${EVIDENCE_TYPE_LABEL[e.type]}» no tiene descripción.`);
  if (missing.length) return { cls: 'C', reasons, missing, applicableEvidence: ev };
  return {
    cls: 'D',
    reasons: [...reasons, `Confirmado por ${conf!.author} el ${conf!.date}: ${conf!.justification.trim()}`],
    missing: [],
    applicableEvidence: ev,
  };
}
