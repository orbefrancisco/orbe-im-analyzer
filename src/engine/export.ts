/**
 * Exportación científica: CSV, XLSX, JSON trazable e informe de auditoría.
 */

import type { AnalysisRun, AuditResult } from './analysis.js';
import { ALGORITHM_VERSION, ENGINE_NAME, completenessStatement } from './analysis.js';
import { CLASS_LABEL, EVIDENCE_TYPE_LABEL } from './classify.js';
import { comboTerms } from './enumerate.js';
import { formatHz, formatKHz, formatMHz, RESOLUTION_HZ } from './freq.js';
import type { AttenuationAnalysis } from './lab.js';
import { MECHANISM_LABEL, MECHANISM_STATUS_LABEL } from './lab.js';
import { PRODUCT_KIND_LABEL, SIGNAL_CLASS_LABEL } from './model.js';
import type { SignalRecord } from './model.js';
import type { Project } from './project.js';
import { comboKind, formulaNumeric, formulaSymbolic, generatorsLabel, groupCombos, hypothesisKey, inBand, orderLabel } from './results.js';
import type { Cell } from './csv.js';
import type { Sheet } from './xlsx.js';
import { formatBig } from './combinatorics.js';

export const LIMITATIONS: string[] = [
  'El orden indicado es el orden algebraico nominal n = Σ|m_i| del vector de coeficientes. En un dispositivo real, la misma frecuencia recibe también contribuciones de órdenes n+2, n+4… (términos que se cancelan algebraicamente, p. ej. 2f1−f2 aparece en la expansión de 5.º orden como f1+f1−f2+f1−f1). Un producto «IM5» no es necesariamente de origen físico exclusivamente de 5.º orden.',
  'Distintos vectores de coeficientes pueden producir exactamente la misma frecuencia (p. ej. con frecuencias equiespaciadas, f1+f3 = 2f2). Todos se conservan y se listan; ninguno se descarta como duplicado.',
  'Que un producto sea calculable no implica que tenga potencia suficiente para ser detectable: el nivel depende de las potencias de los generadores, de los coeficientes de la no linealidad y de la geometría. El programa no estima potencias de productos.',
  'Una coincidencia de frecuencia dentro de la tolerancia NO es una confirmación física. Con muchos productos, la fracción de la banda cubierta por las ventanas ±tolerancia puede ser grande y las coincidencias fortuitas, probables (véase la probabilidad de coincidencia fortuita).',
  'La clase D (producto confirmado) solo se asigna con confirmación explícita del analista, evidencia experimental documentada y generadores declarados como portadoras confirmadas. El programa nunca reclasifica por su cuenta una frecuencia sospechosa como portadora real.',
  'Las pendientes de las pruebas de atenuación (1, 3, 5, 7 dB/dB) solo valen en pequeña señal, con niveles lineales, sin AGC ni compresión y con el atenuador antes de la no linealidad. Cerca de la compresión los órdenes superiores modifican la pendiente.',
  'Las frecuencias se representan como enteros en hercios (resolución 1 Hz). Los datos con más precisión se redondean al hercio más próximo y se advierte de ello.',
  'Fuera del espacio de búsqueda configurado (orden máximo, número de generadores, intervalo de salida) puede haber otros productos que expliquen una señal: una señal sin coincidencias no queda descartada como producto de intermodulación.',
  'El formato nativo de SCORPIO no es público: se importan exportaciones CSV/XLSX con columnas identificables. Verifique siempre el mapeo de columnas y las unidades.',
];

function mhz(hz: number): string {
  return formatMHz(hz, 3);
}

// ---------------------------------------------------------------- tablas

export function productsRows(run: AnalysisRun, au: AuditResult | null): Cell[][] {
  const rs = run.result;
  const obsBy = new Map<number, { o: SignalRecord; d: number }[]>();
  if (au) for (const om of au.matches) for (const gm of om.matches) {
    const a = obsBy.get(gm.group) ?? [];
    a.push({ o: om.observed, d: gm.diffHz });
    obsBy.set(gm.group, a);
  }
  const rows: Cell[][] = [[
    'Frecuencia calculada (MHz)', 'Frecuencia (Hz)', 'Orden nominal mínimo', 'Fórmula (orden mínimo)', 'Fórmula simbólica', 'Generadores',
    'N.º de combinaciones', 'Todas las combinaciones', 'En banda', 'Coincidencia observada (MHz)', 'Diferencia (kHz)', 'Coincide con transmisor', 'Clase',
  ]];
  for (let g = 0; g < rs.groupCount; g++) {
    const cs = groupCombos(rs, g);
    const c0 = cs[0];
    const obs = obsBy.get(g) ?? [];
    const co = au?.coChannel.get(g) ?? [];
    rows.push([
      mhz(rs.groupFreq[g]),
      formatHz(rs.groupFreq[g]),
      orderLabel(rs.store, c0),
      formulaNumeric(rs, c0, { ascii: true }),
      formulaSymbolic(rs, c0, { ascii: true }),
      generatorsLabel(rs, c0),
      cs.length,
      cs.map((c) => `${orderLabel(rs.store, c)}: ${formulaSymbolic(rs, c, { ascii: true })}`).join(' | '),
      inBand(rs.groupFreq[g], rs.band) ? 'sí' : 'no',
      obs.map((x) => mhz(x.o.freqHz)).join(' | '),
      obs.map((x) => formatKHz(x.d)).join(' | '),
      co.map((x) => `${mhz(x.transmitter.freqHz)}${x.transmitter.label ? ' ' + x.transmitter.label : ''} (${formatKHz(x.diffHz)} kHz)`).join(' | '),
      au ? `${au.groupClass.get(g) ?? 'A'} · ${CLASS_LABEL[au.groupClass.get(g) ?? 'A']}` : '',
    ]);
  }
  return rows;
}

export function combosRows(run: AnalysisRun): Cell[][] {
  const rs = run.result;
  const s = rs.store;
  const rows: Cell[][] = [[
    'Frecuencia (MHz)', 'Frecuencia (Hz)', 'Orden nominal', 'Etiqueta', 'Tonos', 'Σ m_i', 'Tipo', 'Fórmula simbólica', 'Fórmula numérica', 'Coeficientes (id:m)', 'Generadores', 'En banda', 'Grupo (frecuencia idéntica)', 'Combinaciones en el grupo',
  ]];
  for (let i = 0; i < rs.sorted.length; i++) {
    const c = rs.sorted[i];
    const g = rs.comboGroup[c];
    rows.push([
      mhz(s.freqHz[c]), formatHz(s.freqHz[c]), s.order[c], orderLabel(s, c), s.tones[c], s.coefSum[c], PRODUCT_KIND_LABEL[comboKind(s, c)],
      formulaSymbolic(rs, c, { ascii: true }), formulaNumeric(rs, c, { ascii: true }), hypothesisKey(rs, c), generatorsLabel(rs, c),
      inBand(s.freqHz[c], rs.band) ? 'sí' : 'no', g + 1, rs.groupStart[g + 1] - rs.groupStart[g],
    ]);
  }
  return rows;
}

export function matchesRows(run: AnalysisRun, au: AuditResult): Cell[][] {
  const rs = run.result;
  const rows: Cell[][] = [[
    'Señal observada (MHz)', 'Observada (Hz)', 'Etiqueta', 'Nivel (dBm)', 'Fecha/hora', 'Equipo', 'Clasificación declarada',
    'Producto calculado (MHz)', 'Diferencia (kHz)', 'Orden', 'Fórmula simbólica', 'Fórmula numérica', 'Clave de hipótesis', 'Clase', 'Motivos', 'Falta para el siguiente nivel',
  ]];
  const obsById = new Map(au.matches.map((m) => [m.observed.id, m.observed]));
  for (const h of au.hypotheses) {
    const o = obsById.get(h.observedId) as SignalRecord;
    rows.push([
      mhz(o.freqHz), formatHz(o.freqHz), o.label, o.levelDbm, o.datetime, o.equipment, SIGNAL_CLASS_LABEL[o.classification],
      mhz(h.calcHz), formatKHz(h.diffHz), orderLabel(rs.store, h.combo), formulaSymbolic(rs, h.combo, { ascii: true }), formulaNumeric(rs, h.combo, { ascii: true }), h.key,
      `${h.classification.cls} · ${CLASS_LABEL[h.classification.cls]}`, h.classification.reasons.join(' '), h.classification.missing.join(' '),
    ]);
  }
  for (const u of au.unmatched) {
    const o = u.observed;
    rows.push([
      mhz(o.freqHz), formatHz(o.freqHz), o.label, o.levelDbm, o.datetime, o.equipment, SIGNAL_CLASS_LABEL[o.classification],
      '', u.nearest ? `más próximo: ${mhz(u.nearest.freqHz)} (${formatKHz(u.nearest.diffHz)} kHz)` : '', '', '', '', '', 'sin coincidencia', 'Ningún producto del alcance configurado dentro de la tolerancia (no descarta otros mecanismos ni órdenes superiores).', '',
    ]);
  }
  return rows;
}

export function signalsRows(list: SignalRecord[]): Cell[][] {
  return [
    ['Id', 'Frecuencia (MHz)', 'Frecuencia (Hz)', 'Etiqueta', 'Nivel (dBm)', 'Nivel original', 'Fecha/hora', 'Equipo', 'Clasificación', 'Observaciones', 'Origen'],
    ...list.map((s) => [s.id, mhz(s.freqHz), formatHz(s.freqHz), s.label, s.levelDbm, s.levelRaw ?? '', s.datetime, s.equipment, SIGNAL_CLASS_LABEL[s.classification], s.notes, s.source]),
  ];
}

export function parametersRows(run: AnalysisRun, project: Project | null, au: AuditResult | null): Cell[][] {
  const p = run.params;
  const range = p.outputMode === 'banda' ? `banda ${mhz(p.band.minHz)}–${mhz(p.band.maxHz)} MHz` : p.outputMode === 'personalizado' && p.customRange ? `${mhz(p.customRange.minHz)}–${mhz(p.customRange.maxHz)} MHz` : 'todas las frecuencias positivas';
  const rows: Cell[][] = [
    ['Parámetro', 'Valor'],
    ['Programa', ENGINE_NAME],
    ['Versión del algoritmo', ALGORITHM_VERSION],
    ['Fecha del análisis', run.meta.analysisDate],
    ['Proyecto', project?.name ?? ''],
    ['Resolución de frecuencia', `${RESOLUTION_HZ} Hz (enteros exactos)`],
    ['Banda de referencia', `${p.band.name}: ${mhz(p.band.minHz)}–${mhz(p.band.maxHz)} MHz`],
    ['Intervalo de salida', range],
    ['Orden máximo', p.maxOrder],
    ['Orden mínimo', p.minOrder],
    ['Máx. generadores por combinación', p.maxTones],
    ['Armónicos puros', p.includeHarmonics ? 'incluidos' : 'excluidos'],
    ['Tolerancia de coincidencia', `±${formatKHz(au?.toleranceHz ?? p.toleranceHz)} kHz`],
    ['Generadores usados', run.generators.length],
    ['Vectores candidatos (antes de la banda)', formatBig(BigInt(run.meta.candidates))],
    ['Cota de nodos de búsqueda', formatBig(BigInt(run.meta.workBound))],
    ['Nodos recorridos', run.meta.visited],
    ['Ramas podadas', run.meta.pruned],
    ['Tiempo (ms)', run.meta.elapsedMs],
    ['Completitud', completenessStatement(run.meta)],
    ['Combinaciones', run.result.store.count],
    ['Frecuencias distintas', run.result.groupCount],
  ];
  if (au) {
    rows.push(['Probabilidad de coincidencia fortuita (banda)', `${(au.coverage.all * 100).toFixed(2)} %`]);
  }
  for (const s of project?.sources ?? []) rows.push([`Fuente (${s.kind})`, `${s.name} · SHA-256 ${s.sha256} · ${s.bytes} B · ${s.importedAt} · ${s.rowsAccepted} filas aceptadas, ${s.rowsRejected} rechazadas`]);
  return rows;
}

export function labRows(project: Project, analyses: Map<string, AttenuationAnalysis>): Cell[][] {
  const rows: Cell[][] = [['Id', 'Fecha', 'Frecuencia (MHz)', 'Antes (dBm)', 'Después (dBm)', 'Atenuación (dB)', 'Caída (dB)', 'Pendiente (dB/dB)', 'Caída esperada IM interna (dB)', 'Resultado como evidencia', ...Object.values(MECHANISM_LABEL), 'Advertencias']];
  for (const t of project.labTests) {
    const a = analyses.get(t.id);
    rows.push([
      t.id, t.date, t.freqHz ? mhz(t.freqHz) : '', t.imBeforeDbm, t.imAfterDbm, t.attenuationDb,
      a ? Number(a.imDropDb.toFixed(2)) : '', a ? Number(a.slopeVsAttenuation.toFixed(3)) : '', a?.expectedInternal ? Number(a.expectedInternal.dropDb.toFixed(2)) : '', a ? a.evidenceResult : '',
      ...(a ? a.mechanisms.map((m) => MECHANISM_STATUS_LABEL[m.status]) : Object.keys(MECHANISM_LABEL).map(() => '')),
      a ? a.validity.join(' ') : '',
    ]);
  }
  return rows;
}

export function workbookSheets(run: AnalysisRun, project: Project | null, au: AuditResult | null, lab: Map<string, AttenuationAnalysis> = new Map()): Sheet[] {
  const sheets: Sheet[] = [
    { name: 'Parámetros', rows: parametersRows(run, project, au) },
    { name: 'Generadores', rows: signalsRows(run.generators) },
    { name: 'Productos', rows: productsRows(run, au) },
    { name: 'Combinaciones', rows: combosRows(run) },
  ];
  if (au) {
    sheets.push({ name: 'Observadas', rows: signalsRows(au.matches.map((m) => m.observed)) });
    sheets.push({ name: 'Coincidencias', rows: matchesRows(run, au) });
  }
  if (project && project.labTests.length) sheets.push({ name: 'Laboratorio', rows: labRows(project, lab) });
  sheets.push({ name: 'Limitaciones', rows: [['Limitaciones matemáticas y experimentales'], ...LIMITATIONS.map((l) => [l])] });
  return sheets;
}

// ---------------------------------------------------------------- JSON

export function analysisJson(run: AnalysisRun, project: Project | null, au: AuditResult | null, lab: Map<string, AttenuationAnalysis> = new Map()): object {
  const rs = run.result;
  const s = rs.store;
  const products = [];
  for (let g = 0; g < rs.groupCount; g++) {
    const f = rs.groupFreq[g];
    products.push({
      freqHz: f,
      freqMHz: formatMHz(f, 6),
      inBand: inBand(f, rs.band),
      minOrder: rs.groupMinOrder[g],
      class: au ? au.groupClass.get(g) ?? 'A' : null,
      combinations: groupCombos(rs, g).map((c) => ({
        order: s.order[c],
        label: orderLabel(s, c),
        tones: s.tones[c],
        coefSum: s.coefSum[c],
        kind: comboKind(s, c),
        key: hypothesisKey(rs, c),
        formula: formulaSymbolic(rs, c, { ascii: true }),
        formulaNumeric: formulaNumeric(rs, c, { ascii: true, minDecimals: 6 }),
        terms: comboTerms(s, c).map((t) => ({ generatorId: rs.generators[t.index].id, position: t.index + 1, coef: t.coef, freqHz: rs.generators[t.index].freqHz })),
      })),
    });
  }
  return {
    schema: 'orbe-im-analyzer/analisis@1',
    engine: ENGINE_NAME,
    algorithmVersion: ALGORITHM_VERSION,
    analysisDate: run.meta.analysisDate,
    frequencyRepresentation: { unit: 'Hz', type: 'entero exacto', resolutionHz: RESOLUTION_HZ },
    parameters: run.params,
    completeness: { ...run.meta, statement: completenessStatement(run.meta) },
    sources: project?.sources ?? [],
    generators: run.generators,
    products,
    audit: au
      ? {
          toleranceHz: au.toleranceHz,
          chanceCoincidenceProbability: au.coverage,
          observed: au.matches.map((m) => ({
            signal: m.observed,
            class: au.observedClass.get(m.observed.id) ?? null,
            nearestProduct: m.nearest,
            hypotheses: au.hypotheses.filter((h) => h.observedId === m.observed.id).map((h) => ({
              calcHz: h.calcHz,
              diffHz: h.diffHz,
              key: h.key,
              order: s.order[h.combo],
              formula: formulaSymbolic(rs, h.combo, { ascii: true }),
              class: h.classification.cls,
              reasons: h.classification.reasons,
              missing: h.classification.missing,
            })),
          })),
        }
      : null,
    labAnalyses: project ? project.labTests.map((t) => ({ test: t, analysis: lab.get(t.id) ?? null })) : [],
    evidence: project?.evidence ?? [],
    confirmations: project?.confirmations ?? [],
    limitations: LIMITATIONS,
    proyecto: project,
  };
}

// ---------------------------------------------------------------- informe

export function auditReport(run: AnalysisRun, project: Project | null, au: AuditResult | null, lab: Map<string, AttenuationAnalysis> = new Map()): string {
  const rs = run.result;
  const L: string[] = [];
  L.push(`# Informe de auditoría — Orbe IM Analyzer`, '');
  L.push(`- Proyecto: ${project?.name ?? '—'}`);
  L.push(`- Fecha del análisis: ${run.meta.analysisDate}`);
  L.push(`- Motor: ${ENGINE_NAME}, versión ${ALGORITHM_VERSION}`);
  L.push(`- Resolución: ${RESOLUTION_HZ} Hz (frecuencias como enteros exactos)`, '');
  L.push('## 1. Parámetros', '');
  for (const r of parametersRows(run, project, au).slice(1)) L.push(`- **${r[0]}**: ${r[1]}`);
  L.push('', '## 2. Completitud', '', `**${completenessStatement(run.meta)}**`, '');
  L.push('## 3. Generadores', '', '| # | Frecuencia (MHz) | Etiqueta | Nivel (dBm) | Clasificación |', '|---|---|---|---|---|');
  run.generators.forEach((g, i) => L.push(`| f${i + 1} | ${mhz(g.freqHz)} | ${g.label || '—'} | ${g.levelDbm ?? '—'} | ${SIGNAL_CLASS_LABEL[g.classification]} |`));
  L.push('', '## 4. Resumen de productos', '');
  const byOrder = new Map<number, number>();
  for (let g = 0; g < rs.groupCount; g++) byOrder.set(rs.groupMinOrder[g], (byOrder.get(rs.groupMinOrder[g]) ?? 0) + 1);
  L.push(`- Combinaciones: ${rs.store.count}; frecuencias distintas: ${rs.groupCount}.`);
  L.push(`- Frecuencias distintas por orden nominal mínimo: ${[...byOrder.entries()].sort((a, b) => a[0] - b[0]).map(([o, n]) => `orden ${o}: ${n}`).join('; ') || '—'}.`);
  let multi = 0;
  for (let g = 0; g < rs.groupCount; g++) if (rs.groupStart[g + 1] - rs.groupStart[g] > 1) multi++;
  L.push(`- Frecuencias producidas por más de una combinación: ${multi}.`, '');
  if (au) {
    L.push('## 5. Auditoría espectral', '');
    L.push(`- Tolerancia: ±${formatKHz(au.toleranceHz)} kHz.`);
    L.push(`- Probabilidad de coincidencia fortuita para una frecuencia arbitraria en la banda: **${(au.coverage.all * 100).toFixed(2)} %**.`);
    for (const c of au.coverage.byMaxOrder) L.push(`  - solo productos de orden ≤ ${c.order}: ${(c.fraction * 100).toFixed(2)} %`);
    const counts = { A: 0, B: 0, C: 0, D: 0 } as Record<string, number>;
    for (let g = 0; g < rs.groupCount; g++) counts[au.groupClass.get(g) ?? 'A']++;
    L.push(`- Frecuencias calculadas por clase: A ${counts.A} · B ${counts.B} · C ${counts.C} · D ${counts.D}.`, '');
    L.push('| Señal (MHz) | Nivel (dBm) | Producto (MHz) | Δ (kHz) | Orden | Fórmula | Clase |', '|---|---|---|---|---|---|---|');
    const obsById = new Map(au.matches.map((m) => [m.observed.id, m.observed]));
    for (const h of au.hypotheses) {
      const o = obsById.get(h.observedId) as SignalRecord;
      L.push(`| ${mhz(o.freqHz)} | ${o.levelDbm ?? '—'} | ${mhz(h.calcHz)} | ${formatKHz(h.diffHz)} | ${orderLabel(rs.store, h.combo)} | ${formulaNumeric(rs, h.combo)} | ${h.classification.cls} · ${CLASS_LABEL[h.classification.cls]} |`);
    }
    for (const u of au.unmatched) L.push(`| ${mhz(u.observed.freqHz)} | ${u.observed.levelDbm ?? '—'} | — | ${u.nearest ? `más próximo ${mhz(u.nearest.freqHz)} (${formatKHz(u.nearest.diffHz)})` : '—'} | — | — | sin coincidencia |`);
    L.push('');
    const ev = project?.evidence ?? [];
    if (ev.length) {
      L.push('### Evidencias registradas', '');
      for (const e of ev) L.push(`- ${e.date} · ${e.author || '—'} · ${EVIDENCE_TYPE_LABEL[e.type]} · **${e.result}** · ${e.hypothesisKey ?? 'todas las hipótesis'}: ${e.description}`);
      L.push('');
    }
  }
  if (project && project.labTests.length) {
    L.push('## 6. Laboratorio RF', '');
    for (const t of project.labTests) {
      const a = lab.get(t.id);
      L.push(`### Prueba ${t.id} (${t.date})`, '');
      L.push(`- Señal: ${t.freqHz ? mhz(t.freqHz) + ' MHz' : '—'}; antes ${t.imBeforeDbm} dBm, después ${t.imAfterDbm} dBm, atenuación ${t.attenuationDb} dB.`);
      if (a) {
        L.push(`- Caída ${a.imDropDb.toFixed(2)} dB; pendiente ${a.slopeVsAttenuation.toFixed(2)} dB/dB. ${a.evidenceSummary}`);
        for (const m of a.mechanisms) L.push(`  - ${MECHANISM_LABEL[m.id]}: **${MECHANISM_STATUS_LABEL[m.status]}** — ${m.reasons.join(' ')}`);
        for (const v of a.validity) L.push(`  - ⚠ ${v}`);
      }
      L.push('');
    }
  }
  L.push('## Limitaciones matemáticas y experimentales', '');
  LIMITATIONS.forEach((l, i) => L.push(`${i + 1}. ${l}`));
  L.push('', '---', 'Criterio: producto matemáticamente posible ≠ señal observada ≠ producto de intermodulación experimentalmente confirmado.');
  return L.join('\n') + '\n';
}
