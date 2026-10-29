/**
 * Modelo de datos nacional: estaciones, regiones, asignación territorial,
 * registros de frecuencia, transmisores, barridos, análisis, evidencias,
 * fuentes y registro de auditoría.
 *
 * Principios:
 *  · Los registros observacionales nunca se borran: se anulan con motivo y
 *    sus cambios quedan en un historial.
 *  · La región de una estación es su zona de responsabilidad; su ubicación
 *    física (municipio/provincia de la torre) es un dato distinto.
 *  · Frecuencia asignada (autorización) ≠ señal recibida.
 *  · Los datos de ejemplo se marcan como «simulado» y se excluyen por defecto.
 */
import { DEFAULT_PARAMS } from './analysis.js';
import { FM_BAND, newId } from './model.js';
export const NATIONAL_SCHEMA = 'orbe-im-analyzer/base@1';
export const LOCATION_CONFIDENCE_LABEL = {
    verificada: 'Verificada (GPS)',
    historica_documentada: 'Histórica documentada (no verificada por GPS)',
    historica_discrepante: 'Histórica discrepante: pendiente de confirmar',
    aproximada: 'Aproximada: emplazamiento no confirmado',
    desconocida: 'Desconocida',
};
export const RECORD_STATUS_LABEL = {
    portadora_confirmada: 'Portadora confirmada',
    observada_sin_identificar: 'Señal observada sin identificar',
    asignada_oficialmente: 'Frecuencia asignada oficialmente (no necesariamente observada)',
    reportada_pendiente: 'Emisión reportada pendiente de verificación',
    sospechosa_im: 'Frecuencia sospechosa de intermodulación',
};
/** ¿El estado corresponde a una señal efectivamente recibida en la estación? */
export function isObservation(s) {
    return s === 'portadora_confirmada' || s === 'observada_sin_identificar' || s === 'sospechosa_im';
}
export const COLLECTIONS = ['stations', 'regions', 'transmitters', 'records', 'sweeps', 'analyses', 'evidence', 'confirmations', 'labTests', 'sources', 'audit'];
/** Documentos únicos (no colecciones). */
export const SINGLETONS = ['provinceRegion', 'municipalityRegion', 'assignmentHistory', 'extraMunicipalities', 'settings', 'meta'];
// ------------------------------------------------------------------ semillas
const DOC_HIST = 'Documento histórico de emplazamientos de estaciones de monitoreo (aportado por el usuario el 2026-10-29)';
const CARTO = 'Cartografía geoBoundaries ADM2 (Caribbean GeoPortal, CC BY 4.0), web/data/rd-municipios.json';
function st(id, name, regionId, site, loc) {
    return {
        id, name, operationalName: name, regionId,
        location: { site, historic: null, reference: null, verified: null, confidence: 'desconocida', provinceId: null, municipalityId: null, locationBasis: '', ...loc },
        bands: [], technical: '', sources: [DOC_HIST], notes: '', updatedAt: '2026-10-29',
    };
}
/** Las ocho estaciones fijas, con coordenadas históricas y su nivel de confianza. */
export function initialStations() {
    const hist = (lat, lon, note = '') => ({ lat, lon, source: DOC_HIST, note });
    const geo = 'Por geometría: la coordenada histórica cae en este municipio (cartografía geoBoundaries).';
    return [
        { ...st('01', 'Jacobo', 'R01', 'Avenida Jacobo Majluta, detrás de Ciudad Modelo', {
                historic: hist(18.550556, -69.939944), confidence: 'historica_documentada',
                provinceId: 'DO-32', municipalityId: 'M151', locationBasis: geo,
            }), operationalName: 'Jacobo — Distrito Nacional', notes: 'Denominación operativa «Jacobo — Distrito Nacional». La torre se sitúa en el entorno de Ciudad Modelo (Santo Domingo Norte, provincia Santo Domingo): jurisdicción, zona de vigilancia y ubicación física son datos distintos.' },
        st('02', 'Santiago', 'R02', 'Urbanización Cerro Alto', {
            historic: hist(19.480833, -70.7025), confidence: 'historica_documentada', provinceId: 'DO-25', municipalityId: 'M142', locationBasis: geo,
        }),
        st('03', 'Puerto Plata', 'R03', 'Aeropuerto Gregorio Luperón, Sosúa', {
            historic: hist(19.755222, -70.646833, 'Discrepante: la coordenada cae en el municipio San Felipe de Puerto Plata, a 18.6 km del centroide de Sosúa, no junto al aeropuerto indicado.'),
            reference: { lat: 19.69809, lon: -70.4798, uncertaintyKm: 17.6, source: CARTO, note: 'Referencia aproximada: centroide del municipio de Sosúa (M100); radio = distancia máxima del centroide al contorno municipal. NO es la posición de la torre.' },
            confidence: 'historica_discrepante', provinceId: 'DO-18', municipalityId: 'M100', locationBasis: 'Según la descripción del emplazamiento (Sosúa, provincia Puerto Plata); posición exacta sin confirmar.',
        }),
        st('04', 'Salcedo', 'R04', 'Loma Los Azules', {
            historic: hist(19.442778, -70.376944), confidence: 'historica_documentada', provinceId: 'DO-19', municipalityId: 'M105', locationBasis: geo,
        }),
        st('05', 'Dajabón', 'R05', 'Loma Alto de la Paloma', {
            historic: hist(19.3825, -71.675556), confidence: 'historica_documentada', provinceId: 'DO-05', municipalityId: 'M029', locationBasis: geo,
        }),
        st('06', 'San Juan', 'R06', 'Paraje El Rosario', {
            historic: hist(18.750472, -71.198278), confidence: 'historica_documentada', provinceId: 'DO-22', municipalityId: 'M126', locationBasis: geo,
        }),
        st('07', 'Barahona', 'R07', 'Loma La Guázara', {
            historic: hist(18.257778, -71.512778, 'Discrepante: la coordenada cae en el municipio de Duvergé (provincia Independencia), a 40.2 km del centroide de Santa Cruz de Barahona; no coincide con la referencia de La Guázara.'),
            reference: { lat: 18.18137, lon: -71.141, uncertaintyKm: 10.1, source: CARTO, note: 'Referencia provisional: centroide del municipio Santa Cruz de Barahona (M025), suponiendo que Loma La Guázara está en ese municipio; se desconoce su posición exacta.' },
            confidence: 'historica_discrepante', provinceId: 'DO-04', municipalityId: 'M025', locationBasis: 'Supuesto: municipio Santa Cruz de Barahona (por el nombre de la estación); sin confirmar.',
        }),
        st('08', 'Higüey', 'R08', 'Loma Los Jobitos, Sanate Abajo', {
            reference: { lat: 18.64207, lon: -68.62943, uncertaintyKm: 32.7, source: CARTO, note: 'Referencia aproximada: centroide del municipio Salvaleón de Higüey (M056). Se conoce el paraje (Loma Los Jobitos, Sanate Abajo), pero no la coordenada de la torre.' },
            confidence: 'aproximada', provinceId: 'DO-11', municipalityId: 'M056', locationBasis: 'Según la descripción del emplazamiento (Higüey, La Altagracia); posición exacta sin confirmar.',
        }),
    ];
}
/**
 * Propuesta inicial de ocho regiones administrativas (una por estación),
 * agrupando provincias según las regiones de desarrollo. NO representa
 * cobertura radioeléctrica y es totalmente reasignable.
 */
export function initialRegions() {
    const regions = [
        { id: 'R01', name: 'Metropolitana y Valdesia', colorSlot: 1, stationIds: ['01'], description: '' },
        { id: 'R02', name: 'Cibao Norte y Sur', colorSlot: 2, stationIds: ['02'], description: '' },
        { id: 'R03', name: 'Atlántica', colorSlot: 3, stationIds: ['03'], description: '' },
        { id: 'R04', name: 'Cibao Nordeste', colorSlot: 4, stationIds: ['04'], description: '' },
        { id: 'R05', name: 'Noroeste', colorSlot: 5, stationIds: ['05'], description: '' },
        { id: 'R06', name: 'El Valle y Azua', colorSlot: 6, stationIds: ['06'], description: '' },
        { id: 'R07', name: 'Enriquillo', colorSlot: 7, stationIds: ['07'], description: '' },
        { id: 'R08', name: 'Este', colorSlot: 8, stationIds: ['08'], description: '' },
    ];
    for (const r of regions)
        r.description = 'Región administrativa inicial (propuesta configurable); no describe cobertura radioeléctrica.';
    const m = {
        R01: ['DO-01', 'DO-32', 'DO-21', 'DO-17', 'DO-31'],
        R02: ['DO-25', 'DO-13', 'DO-28', 'DO-24'],
        R03: ['DO-18', 'DO-09'],
        R04: ['DO-19', 'DO-06', 'DO-14', 'DO-20'],
        R05: ['DO-05', 'DO-15', 'DO-26', 'DO-27'],
        R06: ['DO-22', 'DO-07', 'DO-02'],
        R07: ['DO-04', 'DO-03', 'DO-10', 'DO-16'],
        R08: ['DO-11', 'DO-12', 'DO-08', 'DO-30', 'DO-23', 'DO-29'],
    };
    const provinceRegion = {};
    for (const [r, ps] of Object.entries(m))
        for (const p of ps)
            provinceRegion[p] = r;
    return { regions, provinceRegion };
}
export function emptyNationalDB(now = new Date()) {
    const { regions, provinceRegion } = initialRegions();
    return {
        schema: NATIONAL_SCHEMA,
        createdAt: now.toISOString(),
        stations: initialStations(),
        regions,
        provinceRegion,
        municipalityRegion: {},
        assignmentHistory: [],
        extraMunicipalities: [],
        transmitters: [],
        records: [],
        sweeps: [],
        analyses: [],
        evidence: [],
        confirmations: [],
        labTests: [],
        sources: [],
        audit: [],
        settings: { params: { ...DEFAULT_PARAMS, band: { ...FM_BAND } }, includeSimulated: false, unidentifiedAsGenerators: false, includeAssignedAsGenerators: false },
    };
}
// ------------------------------------------------------------------ consultas
export function displayCoord(s) {
    const l = s.location;
    if (l.verified)
        return { lat: l.verified.lat, lon: l.verified.lon, uncertaintyKm: 0, kind: 'verificada' };
    if (l.historic && l.confidence === 'historica_documentada')
        return { lat: l.historic.lat, lon: l.historic.lon, uncertaintyKm: 0, kind: 'historica' };
    if (l.reference)
        return { lat: l.reference.lat, lon: l.reference.lon, uncertaintyKm: l.reference.uncertaintyKm, kind: 'aproximada' };
    return null;
}
export function isLocationUncertain(s) {
    return !s.location.verified && s.location.confidence !== 'historica_documentada';
}
/** Códigos ISO 3166-2 de las 32 divisiones (DO-01 Distrito Nacional … DO-32 Santo Domingo). */
export function isProvinceId(id) {
    const m = /^DO-(\d{2})$/.exec(id);
    return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 32;
}
export function regionOfProvince(db, provinceId) {
    return db.regions.find((r) => r.id === db.provinceRegion[provinceId]);
}
export function regionOfMunicipality(db, municipalityId, provinceId) {
    const r = db.municipalityRegion[municipalityId] ?? db.provinceRegion[provinceId];
    return db.regions.find((x) => x.id === r);
}
export function provincesOfRegion(db, regionId) {
    return Object.entries(db.provinceRegion).filter(([, r]) => r === regionId).map(([p]) => p).sort();
}
export function stationsOfScope(db, scope) {
    switch (scope.kind) {
        case 'estacion': return db.stations.filter((s) => s.id === scope.stationId);
        case 'region': return db.stations.filter((s) => s.regionId === scope.regionId);
        case 'estaciones': return db.stations.filter((s) => scope.stationIds.includes(s.id));
        default: return [...db.stations];
    }
}
export function scopeLabel(db, scope) {
    switch (scope.kind) {
        case 'estacion': {
            const s = db.stations.find((x) => x.id === scope.stationId);
            return `Estación ${s?.operationalName ?? scope.stationId}`;
        }
        case 'region': {
            const r = db.regions.find((x) => x.id === scope.regionId);
            return `Región ${r?.name ?? scope.regionId}`;
        }
        case 'estaciones': return `Estaciones ${scope.stationIds.join(', ')}`;
        default: return 'Nacional (todas las estaciones)';
    }
}
export function activeRecords(db, opts = {}) {
    const sim = opts.includeSimulated ?? db.settings.includeSimulated;
    return db.records.filter((r) => !r.voided && (sim || r.dataKind === 'real'));
}
export function recordsOfScope(db, scope, opts = {}) {
    const ids = new Set(stationsOfScope(db, scope).map((s) => s.id));
    return activeRecords(db, opts).filter((r) => ids.has(r.stationId));
}
export function lastMeasurement(db, stationId) {
    let last = '';
    for (const r of db.records)
        if (r.stationId === stationId && !r.voided && isObservation(r.status) && r.datetime > last)
            last = r.datetime;
    return last;
}
// ------------------------------------------------------------------ operaciones (con auditoría)
function audit(db, action, entity, entityId, detail, ts = new Date().toISOString()) {
    const e = { id: newId('a'), ts, action, entity, entityId, detail };
    db.audit.push(e);
    return e;
}
export function validateRecordInput(db, r) {
    const e = [];
    if (!db.stations.some((s) => s.id === r.stationId))
        e.push(`Estación desconocida «${r.stationId}».`);
    if (!Number.isSafeInteger(r.freqHz) || r.freqHz <= 0)
        e.push('La frecuencia debe ser un entero positivo en Hz.');
    if (r.status && !(r.status in RECORD_STATUS_LABEL))
        e.push(`Estado desconocido «${r.status}».`);
    if (r.authorization && r.authorization.status !== 'desconocida' && !r.authorization.evidence.trim())
        e.push('El estado de autorización solo puede indicarse con evidencia documental.');
    if (r.levelValue !== undefined && r.levelValue !== null && !Number.isFinite(r.levelValue))
        e.push('Nivel no numérico.');
    if (r.bandwidthHz !== undefined && r.bandwidthHz !== null && !(Number.isFinite(r.bandwidthHz) && r.bandwidthHz > 0))
        e.push('Ancho de banda no válido.');
    return e;
}
/** Clave de duplicado exacto: misma estación, frecuencia, fecha y hora, nivel y estado. */
export function duplicateKey(r) {
    return [r.stationId, r.freqHz, r.datetime.trim(), r.levelValue ?? '', r.status].join('|');
}
/**
 * Añade registros. Un duplicado EXACTO (misma estación, frecuencia, fecha,
 * nivel y estado) no se vuelve a insertar; la misma frecuencia en otra
 * fecha u otra estación es otra observación y se conserva.
 */
export function addRecords(db, inputs, why = 'alta manual', now = new Date()) {
    const ts = now.toISOString();
    const keys = new Map();
    const byStationFreq = new Set();
    for (const r of db.records) {
        if (!r.voided)
            keys.set(duplicateKey(r), r.id);
        byStationFreq.add(`${r.stationId}|${r.freqHz}`);
    }
    const rep = { added: [], duplicates: [], rejected: [], repeatedAcrossDates: 0 };
    for (const inp of inputs) {
        const errs = validateRecordInput(db, inp);
        if (errs.length) {
            rep.rejected.push({ input: inp, errors: errs });
            continue;
        }
        const rec = {
            id: newId('f'),
            stationId: inp.stationId,
            freqHz: inp.freqHz,
            status: inp.status ?? 'observada_sin_identificar',
            datetime: (inp.datetime ?? '').trim(),
            levelValue: inp.levelValue ?? null,
            levelUnit: inp.levelUnit ?? (inp.levelValue !== undefined && inp.levelValue !== null ? 'dBm' : ''),
            bandwidthHz: inp.bandwidthHz ?? null,
            service: inp.service ?? '',
            emisora: inp.emisora ?? '',
            transmitterId: inp.transmitterId ?? null,
            transmitterConfirmed: !!inp.transmitterConfirmed,
            authorization: inp.authorization ?? { status: 'desconocida', evidence: '' },
            municipalityId: inp.municipalityId ?? null,
            locality: inp.locality ?? '',
            notes: inp.notes ?? '',
            sourceId: inp.sourceId ?? null,
            files: inp.files ?? [],
            dataKind: inp.dataKind ?? 'real',
            createdAt: ts,
            updatedAt: ts,
            history: [],
            voided: null,
        };
        const k = duplicateKey(rec);
        const ex = keys.get(k);
        if (ex) {
            rep.duplicates.push({ input: inp, existingId: ex });
            continue;
        }
        if (byStationFreq.has(`${rec.stationId}|${rec.freqHz}`))
            rep.repeatedAcrossDates++;
        keys.set(k, rec.id);
        byStationFreq.add(`${rec.stationId}|${rec.freqHz}`);
        db.records.push(rec);
        rep.added.push(rec);
    }
    if (rep.added.length)
        audit(db, 'alta', 'registros', rep.added.length === 1 ? rep.added[0].id : `${rep.added.length} registros`, `${why}: ${rep.added.length} añadidos, ${rep.duplicates.length} duplicados exactos omitidos, ${rep.rejected.length} rechazados`, ts);
    return rep;
}
const EDITABLE = ['freqHz', 'status', 'datetime', 'levelValue', 'levelUnit', 'bandwidthHz', 'service', 'emisora', 'transmitterId', 'transmitterConfirmed', 'authorization', 'municipalityId', 'locality', 'notes', 'files', 'dataKind', 'stationId'];
/** Modifica un registro conservando el valor anterior en su historial. */
export function updateRecord(db, id, patch, reason, now = new Date()) {
    const r = db.records.find((x) => x.id === id);
    if (!r)
        return ['Registro inexistente.'];
    if (r.voided)
        return ['El registro está anulado; no se modifica.'];
    const merged = { ...r, ...patch };
    const errs = validateRecordInput(db, merged);
    if (errs.length)
        return errs;
    const changes = {};
    for (const k of EDITABLE) {
        if (!(k in patch))
            continue;
        const a = JSON.stringify(r[k]), b = JSON.stringify(merged[k]);
        if (a !== b)
            changes[k] = [r[k], merged[k]];
    }
    if (!Object.keys(changes).length)
        return [];
    const ts = now.toISOString();
    for (const k of Object.keys(changes))
        r[k] = merged[k];
    r.updatedAt = ts;
    r.history.push({ ts, reason: reason || 'edición', changes });
    audit(db, 'edición', 'registros', id, `${Object.keys(changes).join(', ')} — ${reason || 'sin motivo'}`, ts);
    return [];
}
/** Anula (no borra) un registro. */
export function voidRecord(db, id, reason, now = new Date()) {
    const r = db.records.find((x) => x.id === id);
    if (!r)
        return ['Registro inexistente.'];
    if (!reason.trim())
        return ['Indique el motivo de la anulación.'];
    if (r.voided)
        return ['Ya estaba anulado.'];
    const ts = now.toISOString();
    r.voided = { ts, reason: reason.trim() };
    audit(db, 'anulación', 'registros', id, reason.trim(), ts);
    return [];
}
export function reassignProvince(db, provinceId, regionId, reason, now = new Date()) {
    if (!isProvinceId(provinceId))
        return ['Provincia no válida.'];
    if (!db.regions.some((r) => r.id === regionId))
        return ['Región desconocida.'];
    const from = db.provinceRegion[provinceId] ?? null;
    if (from === regionId)
        return [];
    const ts = now.toISOString();
    db.provinceRegion[provinceId] = regionId;
    db.assignmentHistory.push({ ts, level: 'provincia', unitId: provinceId, from, to: regionId, reason });
    audit(db, 'reasignación', 'provincia', provinceId, `${from ?? '—'} → ${regionId}: ${reason}`, ts);
    return [];
}
/** Excepción de región para un municipio (null = hereda la de su provincia). */
export function reassignMunicipality(db, municipalityId, regionId, reason, now = new Date()) {
    if (regionId !== null && !db.regions.some((r) => r.id === regionId))
        return ['Región desconocida.'];
    const from = db.municipalityRegion[municipalityId] ?? null;
    if (from === regionId)
        return [];
    const ts = now.toISOString();
    if (regionId === null)
        delete db.municipalityRegion[municipalityId];
    else
        db.municipalityRegion[municipalityId] = regionId;
    db.assignmentHistory.push({ ts, level: 'municipio', unitId: municipalityId, from, to: regionId, reason });
    audit(db, 'reasignación', 'municipio', municipalityId, `${from ?? 'hereda'} → ${regionId ?? 'hereda'}: ${reason}`, ts);
    return [];
}
export function updateStation(db, id, patch, reason, now = new Date()) {
    const s = db.stations.find((x) => x.id === id);
    if (!s)
        return ['Estación inexistente.'];
    if (patch.id && patch.id !== id)
        return ['El identificador de la estación no se puede cambiar.'];
    if (patch.regionId && !db.regions.some((r) => r.id === patch.regionId))
        return ['Región desconocida.'];
    const loc = patch.location;
    if (loc?.verified && !(Math.abs(loc.verified.lat) <= 90 && Math.abs(loc.verified.lon) <= 180 && loc.verified.source.trim() && loc.verified.method.trim()))
        return ['Una coordenada verificada exige latitud y longitud válidas, fuente y método.'];
    const ts = now.toISOString();
    const keys = Object.keys(patch).filter((k) => JSON.stringify(s[k]) !== JSON.stringify(patch[k]));
    if (!keys.length)
        return [];
    if (patch.regionId && patch.regionId !== s.regionId) {
        const old = db.regions.find((r) => r.id === s.regionId);
        if (old)
            old.stationIds = old.stationIds.filter((x) => x !== id);
        const nw = db.regions.find((r) => r.id === patch.regionId);
        if (!nw.stationIds.includes(id))
            nw.stationIds.push(id);
    }
    Object.assign(s, patch, { updatedAt: ts.slice(0, 10) });
    audit(db, 'edición', 'estacion', id, `${keys.join(', ')} — ${reason || 'sin motivo'}`, ts);
    return [];
}
export function addTransmitter(db, t, now = new Date()) {
    const tx = { ...t, id: newId('t'), createdAt: now.toISOString(), history: [] };
    db.transmitters.push(tx);
    audit(db, 'alta', 'transmisor', tx.id, `${tx.name} ${tx.freqHz} Hz`);
    return tx;
}
export function addSource(db, s) {
    const d = { ...s, id: newId('src') };
    db.sources.push(d);
    return d;
}
export function addSweep(db, s) {
    const w = { ...s, id: newId('w') };
    db.sweeps.push(w);
    audit(db, 'alta', 'barrido', w.id, `${s.name}: ${s.points.length} puntos, estación ${s.stationId}`);
    return w;
}
export function addEvidence(db, e) {
    db.evidence.push(e);
    audit(db, 'evidencia', 'registros', e.observedId, `${e.type} · ${e.result} · ${e.hypothesisKey ?? 'todas las hipótesis'}`);
}
export function setConfirmation(db, c) {
    db.confirmations = db.confirmations.filter((x) => !(x.observedId === c.observedId && x.hypothesisKey === c.hypothesisKey));
    db.confirmations.push(c);
    audit(db, 'confirmación', 'registros', c.observedId, `${c.hypothesisKey} por ${c.author}`);
}
/** Datos de ejemplo (simulados, nunca reales): las frecuencias matemáticas de la especificación en Barahona. */
export function loadExampleData(db) {
    const src = addSource(db, { name: 'Ejemplo matemático (datos simulados)', kind: 'ejemplo', sha256: '', bytes: 0, importedAt: new Date().toISOString(), notes: 'Valores de la especificación; NO son mediciones reales de Barahona.' });
    const mk = (stationId, mhz, status, level, emisora = '') => ({
        stationId, freqHz: Math.round(mhz * 1e6), status, levelValue: level, levelUnit: level === null ? '' : 'dBm', emisora, datetime: '2026-10-29T10:00', dataKind: 'simulado', sourceId: src.id, notes: 'Ejemplo matemático, no es una medición real.',
    });
    return addRecords(db, [
        mk('07', 89.3, 'portadora_confirmada', -45, 'Ejemplo A'),
        mk('07', 89.58, 'portadora_confirmada', -48, 'Ejemplo B'),
        mk('07', 90.1, 'portadora_confirmada', -52, 'Ejemplo C'),
        mk('07', 88.78, 'sospechosa_im', -88),
        mk('01', 89.3, 'portadora_confirmada', -40, 'Ejemplo A'),
        mk('01', 89.58, 'portadora_confirmada', -42, 'Ejemplo B'),
        mk('01', 89.85, 'observada_sin_identificar', -80),
        mk('02', 90.1, 'portadora_confirmada', -50, 'Ejemplo C'),
        mk('02', 88.74, 'observada_sin_identificar', -86),
    ], 'datos de ejemplo (simulados)');
}
