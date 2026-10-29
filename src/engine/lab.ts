/**
 * Laboratorio RF: interpretación de pruebas de atenuación.
 *
 * Modelo de pequeña señal: si un producto con vector m se genera en una no
 * linealidad situada DESPUÉS del atenuador, y la potencia del generador i en
 * esa no linealidad baja ΔP_i dB, el producto baja
 *        ΔP_IM = Σ |m_i| · ΔP_i     (dB).
 * Con un atenuador de banda ancha (ΔP_i = A para todo i) esto da n·A, donde
 * n = Σ|m_i| es el orden nominal: 3 dB/dB para IM3, 5 para IM5, 7 para IM7.
 * Una señal que llega ya formada a la entrada (intermodulación externa, señal
 * independiente, fuga por selectividad, imagen) baja exactamente lo mismo que
 * la atenuación: pendiente 1 dB/dB.
 *
 * Hipótesis de validez (se advierten siempre): régimen de pequeña señal, sin
 * compresión ni AGC, niveles lineales, atenuador antes de la no linealidad y
 * producto dominado por el término de orden nominal (los órdenes n+2, n+4…
 * contribuyen a la misma frecuencia y alteran la pendiente cerca de la
 * compresión).
 */

export type TriState = 'si' | 'no' | 'desconocido';

export interface ReceiverConditions {
  agc: TriState;
  preamp: TriState;
  gainDb: number | null;
  /** Dónde se insertó el atenuador. */
  attenuatorPosition: 'entrada_receptor' | 'otra' | 'desconocida';
  /** Frecuencia intermedia del receptor, si se conoce (para imágenes y espurias). */
  ifHz: number | null;
  loSide: 'superior' | 'inferior' | 'desconocido';
  /** Nivel de entrada a partir del cual el receptor deja de ser lineal (P1dB de entrada), si se conoce. */
  inputP1dBdBm: number | null;
  notes: string;
}

export interface GeneratorLevel {
  label: string;
  freqHz: number | null;
  /** Coeficiente en la hipótesis evaluada (si se conoce). */
  coef: number | null;
  beforeDbm: number | null;
  afterDbm: number | null;
  /**
   * Atenuación que se aplicó a ESTE generador (atenuación selectiva, p. ej. con
   * un filtro de rechazo). null = la atenuación general de la prueba.
   */
  appliedDb?: number | null;
}

export interface AttenuationTest {
  id: string;
  date: string;
  operator: string;
  /** Señal observada a la que se refiere la prueba. */
  observedId: string | null;
  freqHz: number | null;
  /** Hipótesis concreta (clave del vector), si se evalúa una. */
  hypothesisKey: string | null;
  /** Orden nominal de la hipótesis, si no se dan coeficientes por generador. */
  hypothesisOrder: number | null;
  imBeforeDbm: number;
  imAfterDbm: number;
  attenuationDb: number;
  /** Atenuación sufrida por la propia señal sospechosa (por defecto = attenuationDb). */
  attenuationAtImDb: number | null;
  /** Incertidumbre típica de cada lectura de nivel (dB). */
  readingUncertaintyDb: number;
  /** Incertidumbre del valor del atenuador (dB). */
  attenuatorUncertaintyDb: number;
  noiseFloorDbm: number | null;
  generators: GeneratorLevel[];
  receiver: ReceiverConditions;
  notes: string;
}

export type MechanismId = 'im_interna' | 'im_externa' | 'saturacion' | 'selectividad' | 'espuria_imagen' | 'senal_independiente';

export const MECHANISM_LABEL: Record<MechanismId, string> = {
  im_interna: 'Intermodulación generada dentro del receptor',
  im_externa: 'Intermodulación externa (generada antes del receptor)',
  saturacion: 'Saturación / compresión del receptor',
  selectividad: 'Recepción fuera de canal por selectividad insuficiente',
  espuria_imagen: 'Respuesta espuria o frecuencia imagen',
  senal_independiente: 'Señal independiente coincidente',
};

export type MechanismStatus = 'compatible' | 'incompatible' | 'indicios' | 'sin_indicios' | 'no_evaluable';

export const MECHANISM_STATUS_LABEL: Record<MechanismStatus, string> = {
  compatible: 'Compatible',
  incompatible: 'Incompatible',
  indicios: 'Hay indicios',
  sin_indicios: 'Sin indicios',
  no_evaluable: 'No evaluable',
};

export interface MechanismAssessment {
  id: MechanismId;
  status: MechanismStatus;
  reasons: string[];
}

export interface TheoreticalSlope {
  order: number;
  expectedDropDb: number;
  residualDb: number;
  compatible: boolean;
}

export interface NearbyCarrier {
  label: string;
  freqHz: number;
  levelDbm: number | null;
}

export interface AttenuationContext {
  /** Portadoras conocidas (transmisores) para evaluar selectividad e imágenes. */
  carriers: NearbyCarrier[];
  /** Ventana (Hz) para considerar una portadora «adyacente». */
  adjacentWindowHz: number;
  /** Tolerancia (Hz) para coincidencias de imagen/espuria. */
  spurToleranceHz: number;
}

export interface AttenuationAnalysis {
  imDropDb: number;
  attenuationAtImDb: number;
  slopeVsAttenuation: number;
  generatorDrops: (number | null)[];
  meanGeneratorDrop: number | null;
  slopeVsGenerators: number | null;
  /** Caída esperada si la IM se genera dentro del receptor, con su incertidumbre (k=1). */
  expectedInternal: { dropDb: number; uncertaintyDb: number; order: number; basis: string } | null;
  expectedLinear: { dropDb: number; uncertaintyDb: number };
  observedUncertaintyDb: number;
  /** Factor de cobertura usado en las comparaciones. */
  coverageK: number;
  theoretical: TheoreticalSlope[];
  censored: boolean;
  discriminating: boolean | null;
  iipEstimateDbm: number | null;
  validity: string[];
  mechanisms: MechanismAssessment[];
  /** Resultado respecto a la hipótesis de intermodulación evaluada, para usar como evidencia. */
  evidenceResult: 'compatible' | 'incompatible' | 'no_concluyente';
  evidenceSummary: string;
}

const K = 2;

function fmt(x: number, d = 2): string {
  return (Math.round(x * 10 ** d) / 10 ** d).toFixed(d);
}

export function validateTest(t: AttenuationTest): string[] {
  const e: string[] = [];
  if (!Number.isFinite(t.imBeforeDbm)) e.push('Falta el nivel original de la señal (dBm).');
  if (!Number.isFinite(t.imAfterDbm)) e.push('Falta el nivel con atenuador (dBm).');
  if (!Number.isFinite(t.attenuationDb) || t.attenuationDb <= 0) e.push('La atenuación aplicada debe ser positiva (dB).');
  if (!(t.readingUncertaintyDb >= 0)) e.push('La incertidumbre de lectura debe ser ≥ 0 dB.');
  if (!(t.attenuatorUncertaintyDb >= 0)) e.push('La incertidumbre del atenuador debe ser ≥ 0 dB.');
  return e;
}

export function analyzeAttenuation(t: AttenuationTest, ctx: AttenuationContext = { carriers: [], adjacentWindowHz: 400_000, spurToleranceHz: 25_000 }): AttenuationAnalysis {
  const errs = validateTest(t);
  if (errs.length) throw new Error(errs.join(' '));
  const A = t.attenuationDb;
  const Aim = t.attenuationAtImDb ?? A;
  const uR = t.readingUncertaintyDb;
  const uA = t.attenuatorUncertaintyDb;
  const drop = t.imBeforeDbm - t.imAfterDbm;
  const uObs = Math.SQRT2 * uR;
  const validity: string[] = [
    'Las pendientes teóricas (n dB/dB) solo valen en pequeña señal, con niveles lineales, sin AGC ni compresión y con el atenuador ANTES de la no linealidad.',
  ];

  const gDrops = t.generators.map((g) => (g.beforeDbm !== null && g.afterDbm !== null && Number.isFinite(g.beforeDbm) && Number.isFinite(g.afterDbm) ? g.beforeDbm - g.afterDbm : null));
  const known = gDrops.filter((x): x is number => x !== null);
  const meanG = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;

  // --- caída esperada para IM interna ---
  let expectedInternal: AttenuationAnalysis['expectedInternal'] = null;
  const withCoef = t.generators.filter((g) => g.coef !== null && g.coef !== 0);
  if (withCoef.length) {
    let sum = 0, u2 = 0;
    let measured = true;
    let order = 0;
    t.generators.forEach((g, i) => {
      if (g.coef === null || g.coef === 0) return;
      const m = Math.abs(g.coef);
      order += m;
      const d = gDrops[i];
      if (d !== null) { sum += m * d; u2 += (m * Math.SQRT2 * uR) ** 2; }
      else { sum += m * (g.appliedDb ?? A); u2 += (m * uA) ** 2; measured = false; }
    });
    expectedInternal = { dropDb: sum, uncertaintyDb: Math.sqrt(u2), order, basis: measured ? 'Σ|m_i|·ΔP_i con caídas medidas de cada generador' : 'Σ|m_i|·ΔP_i (se supuso ΔP_i = A donde no hay medida)' };
  } else if (t.hypothesisOrder && t.hypothesisOrder >= 2) {
    const n = t.hypothesisOrder;
    if (meanG !== null) expectedInternal = { dropDb: n * meanG, uncertaintyDb: n * Math.SQRT2 * uR, order: n, basis: 'n·ΔP̄ con la caída media medida de los generadores' };
    else expectedInternal = { dropDb: n * A, uncertaintyDb: n * uA, order: n, basis: 'n·A (atenuación de banda ancha supuesta)' };
  }
  const expectedLinear = { dropDb: Aim, uncertaintyDb: uA };

  const tolFor = (u: number) => K * Math.sqrt(uObs ** 2 + u ** 2);
  const censored = t.noiseFloorDbm !== null && Number.isFinite(t.noiseFloorDbm) && t.imAfterDbm <= t.noiseFloorDbm + 3;
  if (censored) validity.push('El nivel con atenuador está a menos de 3 dB del ruido de fondo: la caída medida es solo una COTA INFERIOR de la caída real.');

  // ¿distingue la prueba entre comportamiento lineal y no lineal?
  let discriminating: boolean | null = null;
  if (expectedInternal) {
    const sep = Math.abs(expectedInternal.dropDb - expectedLinear.dropDb);
    const need = tolFor(expectedInternal.uncertaintyDb) + tolFor(expectedLinear.uncertaintyDb);
    discriminating = sep > need;
    if (!discriminating) validity.push(`La prueba no discrimina: las caídas esperadas (lineal ${fmt(expectedLinear.dropDb)} dB, interna ${fmt(expectedInternal.dropDb)} dB) están más cerca que sus intervalos de incertidumbre. Aumente la atenuación o reduzca la incertidumbre.`);
  }

  // Si la medida está censurada por el ruido, la caída real es ≥ la medida:
  // una hipótesis es compatible si su caída esperada no queda por debajo de la cota.
  const compatibleWith = (exp: number, u: number): boolean =>
    censored ? drop <= exp + tolFor(u) : Math.abs(drop - exp) <= tolFor(u);
  const internalOk = expectedInternal ? compatibleWith(expectedInternal.dropDb, expectedInternal.uncertaintyDb) : null;
  const linearOk = compatibleWith(expectedLinear.dropDb, expectedLinear.uncertaintyDb);

  // Comparación con las pendientes teóricas de IM3, IM5 e IM7 (atenuación uniforme).
  const theoretical: TheoreticalSlope[] = [3, 5, 7].map((n) => {
    const base = meanG ?? A;
    const ub = meanG !== null ? Math.SQRT2 * uR : uA;
    const exp = n * base;
    return { order: n, expectedDropDb: exp, residualDb: drop - exp, compatible: compatibleWith(exp, n * ub) };
  });

  // los generadores, ¿bajaron lo que marca el atenuador?
  const genTol = K * Math.sqrt((Math.SQRT2 * uR) ** 2 + uA ** 2);
  const genDeviation = known.length
    ? t.generators.some((g, i) => gDrops[i] !== null && Math.abs((gDrops[i] as number) - (g.appliedDb ?? A)) > genTol)
    : null;
  if (genDeviation) validity.push('Al menos un generador no bajó lo que indica el atenuador: posible compresión, AGC o atenuador no situado donde se cree. La pendiente pierde validez.');
  if (t.receiver.agc === 'si') validity.push('El AGC estaba activo: la ganancia del receptor pudo cambiar entre lecturas y las pendientes no son interpretables.');
  if (t.receiver.agc === 'desconocido') validity.push('Estado del AGC desconocido: si estaba activo, las pendientes no son interpretables.');
  if (t.receiver.attenuatorPosition !== 'entrada_receptor') validity.push('No consta que el atenuador estuviera en la entrada del receptor: la prueba solo discrimina no linealidades situadas después del atenuador.');
  if (t.receiver.preamp === 'si') validity.push('Preamplificador activo: aumenta la probabilidad de intermodulación interna; conviene repetir la prueba con el preamplificador desactivado.');

  const maxGen = t.generators.reduce<number | null>((m, g) => (g.beforeDbm !== null && Number.isFinite(g.beforeDbm) ? (m === null ? g.beforeDbm : Math.max(m, g.beforeDbm)) : m), null);
  const nearCompression = t.receiver.inputP1dBdBm !== null && maxGen !== null && maxGen > t.receiver.inputP1dBdBm - 10;

  // estimación orientativa del punto de intercepción de entrada
  let iip: number | null = null;
  if (expectedInternal && internalOk && meanG !== null) {
    const levels = t.generators.map((g) => g.beforeDbm).filter((x): x is number => x !== null && Number.isFinite(x));
    if (levels.length >= 2) {
      const pin = levels.reduce((a, b) => a + b, 0) / levels.length;
      const n = expectedInternal.order;
      iip = pin + (pin - t.imBeforeDbm) / (n - 1);
    }
  }

  const mech: MechanismAssessment[] = [];
  const unreliable = t.receiver.agc === 'si' || genDeviation === true;

  // 1. IM interna
  {
    const r: string[] = [];
    let st: MechanismStatus;
    if (!expectedInternal) { st = 'no_evaluable'; r.push('Indique la hipótesis (coeficientes u orden) para calcular la caída esperada.'); }
    else if (unreliable) { st = 'no_evaluable'; r.push('Condiciones del receptor (AGC o generadores que no siguen al atenuador) invalidan la comparación de pendientes.'); }
    else if (internalOk) { st = 'compatible'; r.push(`Caída observada ${fmt(drop)} dB frente a ${fmt(expectedInternal.dropDb)} ± ${fmt(tolFor(expectedInternal.uncertaintyDb))} dB esperados (${expectedInternal.basis}).`); if (discriminating === false) r.push('Pero la prueba no discrimina frente al comportamiento lineal.'); }
    else { st = 'incompatible'; r.push(`Caída observada ${fmt(drop)} dB, fuera de ${fmt(expectedInternal.dropDb)} ± ${fmt(tolFor(expectedInternal.uncertaintyDb))} dB esperados para IM${expectedInternal.order} interna.`); }
    mech.push({ id: 'im_interna', status: st, reasons: r });
  }
  // 2. IM externa
  {
    const r: string[] = [];
    let st: MechanismStatus;
    if (t.receiver.agc === 'si') { st = 'no_evaluable'; r.push('AGC activo.'); }
    else if (linearOk) { st = 'compatible'; r.push(`La señal bajó ${fmt(drop)} dB con ${fmt(Aim)} dB de atenuación (pendiente ≈ 1): llega ya formada a la entrada.`); r.push('La atenuación no distingue la IM externa de una señal independiente ni de una fuga por selectividad: se requieren pruebas adicionales (apagado de generadores, antena directiva, otro emplazamiento).'); }
    else { st = 'incompatible'; r.push(`La caída (${fmt(drop)} dB) no es compatible con una señal que ya existe a la entrada (${fmt(Aim)} ± ${fmt(tolFor(expectedLinear.uncertaintyDb))} dB).`); }
    mech.push({ id: 'im_externa', status: st, reasons: r });
  }
  // 3. Saturación
  {
    const r: string[] = [];
    let st: MechanismStatus = 'sin_indicios';
    if (genDeviation) { st = 'indicios'; r.push('Los generadores no bajaron lo que indica el atenuador.'); }
    if (nearCompression) { st = 'indicios'; r.push(`Nivel de entrada (${fmt(maxGen as number)} dBm) a menos de 10 dB del P1dB declarado.`); }
    const slope = drop / A;
    const nearInteger = [1, 3, 5, 7, 9].some((n) => Math.abs(drop - n * A) <= tolFor(n * uA));
    if (!nearInteger) { st = 'indicios'; r.push(`La pendiente ${fmt(slope)} dB/dB no se ajusta a ningún comportamiento de pequeña señal (1, 3, 5, 7, 9).`); }
    if (t.receiver.agc === 'si') { st = st === 'sin_indicios' ? 'no_evaluable' : st; r.push('Con AGC activo no puede separarse la compresión del control de ganancia.'); }
    if (st === 'sin_indicios') r.push('Generadores y pendiente se comportan como en régimen lineal.');
    mech.push({ id: 'saturacion', status: st, reasons: r });
  }
  // 4. Selectividad
  {
    const r: string[] = [];
    let st: MechanismStatus;
    const f = t.freqHz;
    if (f === null) { st = 'no_evaluable'; r.push('Falta la frecuencia de la señal.'); }
    else {
      const adj = ctx.carriers.filter((c) => c.freqHz !== f && Math.abs(c.freqHz - f) <= ctx.adjacentWindowHz);
      if (!adj.length) { st = 'sin_indicios'; r.push(`No hay portadoras conocidas a menos de ${ctx.adjacentWindowHz / 1000} kHz.`); }
      else if (!linearOk) { st = 'incompatible'; r.push('Hay portadoras adyacentes, pero la caída no es lineal (una fuga por selectividad bajaría lo mismo que el atenuador).'); }
      else { st = 'compatible'; r.push(`Portadoras próximas: ${adj.map((c) => `${c.label || 'sin nombre'} (${(c.freqHz / 1e6).toFixed(3)} MHz${c.levelDbm !== null ? `, ${c.levelDbm} dBm` : ''})`).join(', ')}. Compruebe con un filtro de canal más estrecho o con la máscara del receptor.`); }
    }
    mech.push({ id: 'selectividad', status: st, reasons: r });
  }
  // 5. Espurias / imagen
  {
    const r: string[] = [];
    let st: MechanismStatus;
    const f = t.freqHz;
    const IF = t.receiver.ifHz;
    if (f === null || IF === null || !(IF > 0)) { st = 'no_evaluable'; r.push('Se necesita la frecuencia intermedia del receptor (y el lado del oscilador local).'); }
    else {
      const sides = t.receiver.loSide === 'superior' ? [1] : t.receiver.loSide === 'inferior' ? [-1] : [1, -1];
      const cands: { what: string; hz: number }[] = [];
      for (const s of sides) {
        cands.push({ what: `imagen (OL ${s > 0 ? 'superior' : 'inferior'})`, hz: f + s * 2 * IF });
        cands.push({ what: `espuria de media FI (OL ${s > 0 ? 'superior' : 'inferior'})`, hz: f + s * IF / 2 });
      }
      const hits: string[] = [];
      for (const c of cands) for (const car of ctx.carriers) if (Math.abs(car.freqHz - c.hz) <= ctx.spurToleranceHz) hits.push(`${c.what}: ${(c.hz / 1e6).toFixed(3)} MHz ↔ ${car.label || 'portadora'} ${(car.freqHz / 1e6).toFixed(3)} MHz`);
      if (!hits.length) { st = 'sin_indicios'; r.push('Ninguna portadora conocida está en la frecuencia imagen ni en la de media FI.'); }
      else if (!linearOk && hits.every((h) => h.startsWith('imagen'))) { st = 'incompatible'; r.push(...hits, 'Una respuesta imagen es lineal en la señal y bajaría lo mismo que el atenuador.'); }
      else { st = 'compatible'; r.push(...hits); }
    }
    mech.push({ id: 'espuria_imagen', status: st, reasons: r });
  }
  // 6. Señal independiente
  {
    const r: string[] = [];
    let st: MechanismStatus;
    if (t.receiver.agc === 'si') { st = 'no_evaluable'; r.push('AGC activo.'); }
    else if (linearOk) { st = 'compatible'; r.push('Una señal independiente bajaría lo mismo que el atenuador; la coincidencia de frecuencia con un producto podría ser fortuita.'); }
    else { st = 'incompatible'; r.push('La caída no es lineal, lo que no corresponde a una señal recibida tal cual.'); }
    r.push('Nunca se atribuye una emisión a un transmisor solo por esta prueba.');
    mech.push({ id: 'senal_independiente', status: st, reasons: r });
  }

  let evidenceResult: AttenuationAnalysis['evidenceResult'] = 'no_concluyente';
  let evidenceSummary = '';
  const imInt = mech[0];
  if (imInt.status === 'compatible' && discriminating && !censored) { evidenceResult = 'compatible'; evidenceSummary = `Pendiente compatible con IM${expectedInternal?.order} interna y no con una señal lineal.`; }
  else if (imInt.status === 'incompatible' && !linearOk && !censored && !unreliable) { evidenceResult = 'incompatible'; evidenceSummary = 'La pendiente no corresponde ni al orden de la hipótesis ni a una señal lineal.'; }
  else if (linearOk && discriminating) { evidenceSummary = 'Comportamiento lineal: compatible con IM externa, señal independiente o fuga; no confirma ni descarta la hipótesis de IM.'; }
  else evidenceSummary = 'Prueba no concluyente respecto a la hipótesis de intermodulación.';

  return {
    imDropDb: drop,
    attenuationAtImDb: Aim,
    slopeVsAttenuation: drop / A,
    generatorDrops: gDrops,
    meanGeneratorDrop: meanG,
    slopeVsGenerators: meanG ? drop / meanG : null,
    expectedInternal,
    expectedLinear,
    observedUncertaintyDb: uObs,
    coverageK: K,
    theoretical,
    censored,
    discriminating,
    iipEstimateDbm: iip,
    validity,
    mechanisms: mech,
    evidenceResult,
    evidenceSummary,
  };
}
