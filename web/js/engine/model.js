/**
 * Tipos de datos compartidos por el motor. Ninguno depende del DOM.
 */
export const SIGNAL_CLASS_LABEL = {
    portadora_confirmada: 'Portadora confirmada',
    senal_observada: 'Señal observada',
    sospechosa: 'Frecuencia sospechosa',
    desconocida: 'Desconocida',
};
export const FM_BAND = { minHz: 88000000, maxHz: 108000000, name: 'FM 88–108 MHz' };
export const PRODUCT_KIND_LABEL = {
    armonico: 'Armónico puro',
    suma: 'IM de suma',
    mixto: 'IM de diferencia',
};
let idCounter = 0;
export function newId(prefix = 's') {
    idCounter = (idCounter + 1) % 1e6;
    return prefix + Date.now().toString(36) + idCounter.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}
export function makeSignal(freqHz, partial = {}) {
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
