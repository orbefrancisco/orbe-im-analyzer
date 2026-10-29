/** Arranque de la interfaz: pestañas, barra de proyecto y almacenamiento local. */
import { ALGORITHM_VERSION, RESOLUTION_HZ, emptyProject, makeSignal, parseProject, sha256Hex, utf8Encode } from '../engine/index.js';
import { analyzerView } from './analyzer.js';
import { auditView } from './audit.js';
import { calculatorView } from './calculator.js';
import { $, download, h, mount, pickFile, select, stamp, toast } from './dom.js';
import { labView } from './lab.js';
import { setupPwa } from './pwa.js';
import { databaseView } from './database.js';
import { investigatorView } from './investigator.js';
import { nat } from './natstore.js';
import { nationalView } from './national.js';
import { installClassicSync } from './scope.js';
import { spectrumView } from './spectrumrf.js';
import { stationView } from './station.js';
import { store } from './state.js';
const TABS = [
    { id: 'nacional', label: 'Panel nacional' },
    { id: 'estacion', label: 'Estación' },
    { id: 'investigador', label: 'Investigador IM' },
    { id: 'espectro', label: 'Espectro RF' },
    { id: 'calculadora', label: 'Calculadora' },
    { id: 'analizador', label: 'Analizador de banda' },
    { id: 'auditoria', label: 'Auditoría espectral' },
    { id: 'laboratorio', label: 'Laboratorio RF' },
    { id: 'basedatos', label: 'Base de datos' },
    { id: 'metodo', label: 'Método y limitaciones' },
];
function exampleProject() {
    const p = emptyProject('Ejemplo FM 89.30 / 89.58');
    const mhz = (x) => Math.round(x * 1e6);
    p.transmitters = [
        makeSignal(mhz(89.3), { label: 'Emisora A', classification: 'portadora_confirmada', levelDbm: -28 }),
        makeSignal(mhz(89.58), { label: 'Emisora B', classification: 'portadora_confirmada', levelDbm: -31 }),
        makeSignal(mhz(90.1), { label: 'Emisora C', classification: 'portadora_confirmada', levelDbm: -40 }),
        makeSignal(mhz(93.7), { label: 'Emisora D', classification: 'portadora_confirmada', levelDbm: -45 }),
        makeSignal(mhz(95.9), { label: 'Emisora E', classification: 'portadora_confirmada', levelDbm: -38 }),
    ];
    p.selectedIds = p.transmitters.map((t) => t.id);
    p.observed = [
        makeSignal(mhz(89.85), { label: 'Señal medida', classification: 'senal_observada', levelDbm: -78, equipment: 'SCORPIO' }),
        makeSignal(mhz(88.74), { label: 'Señal medida', classification: 'senal_observada', levelDbm: -86, equipment: 'SCORPIO' }),
        makeSignal(mhz(88.78), { label: 'Señal medida', classification: 'sospechosa', levelDbm: -90, equipment: 'SCORPIO' }),
    ];
    p.params = { ...p.params, maxOrder: 9, maxTones: 3, toleranceHz: 10000 };
    return p;
}
function boot() {
    store.loadCurrent();
    let active = location.hash.slice(1) || 'nacional';
    if (!TABS.some((t) => t.id === active))
        active = 'nacional';
    const nav = $('#tabs');
    const sections = {
        nacional: $('#sec-nacional'),
        estacion: $('#sec-estacion'),
        investigador: $('#sec-investigador'),
        espectro: $('#sec-espectro'),
        basedatos: $('#sec-basedatos'),
        calculadora: $('#sec-calculadora'),
        analizador: $('#sec-analizador'),
        auditoria: $('#sec-auditoria'),
        laboratorio: $('#sec-laboratorio'),
        metodo: $('#sec-metodo'),
    };
    const go = (t) => { active = t; location.hash = t; show(); };
    const calc = calculatorView(sections.calculadora, () => go('analizador'));
    const ana = analyzerView(sections.analizador);
    const lab = labView(sections.laboratorio);
    const aud = auditView(sections.auditoria, { toAnalyzer: () => go('analizador'), toLab: (o, k) => { lab.prefill(o, k); go('laboratorio'); } });
    const inv = investigatorView(sections.investigador, { toClassic: () => go('auditoria') });
    const sta = stationView(sections.estacion, { toClassic: () => go('auditoria'), toInvestigator: (f) => { go('investigador'); if (f)
            inv.investigate(f); } });
    const nac = nationalView(sections.nacional, { toStation: (id) => { sta.select(id); go('estacion'); }, toInvestigator: (f) => { go('investigador'); if (f)
            inv.investigate(f); } });
    const esp = spectrumView(sections.espectro);
    const bdd = databaseView(sections.basedatos);
    const views = { nacional: nac, estacion: sta, investigador: inv, espectro: esp, basedatos: bdd, calculadora: calc, analizador: ana, auditoria: aud, laboratorio: lab };
    const nationalTabs = ['nacional', 'estacion', 'investigador', 'espectro', 'basedatos'];
    nat.on(() => { if (nationalTabs.includes(active))
        views[active]?.render(); });
    installClassicSync();
    void nat.init();
    function show() {
        mount(nav, ...TABS.map((t) => h('button', { type: 'button', role: 'tab', class: 'tab' + (t.id === active ? ' on' : ''), 'aria-selected': String(t.id === active), onclick: () => go(t.id) }, t.label)));
        for (const t of TABS)
            sections[t.id].hidden = t.id !== active;
        views[active]?.render();
    }
    store.on(() => { views[active]?.render(); renderProjectBar(); });
    const bar = $('#project-bar');
    function renderProjectBar() {
        const saved = store.savedIndex();
        const name = h('input', { type: 'text', value: store.project.name, 'aria-label': 'Nombre del proyecto', class: 'mid', onchange: (e) => store.update((p) => { p.name = e.target.value || 'Proyecto sin nombre'; }, { reaudit: false }) });
        mount(bar, h('span', { class: 'field-label' }, 'Proyecto'), name, h('button', { type: 'button', onclick: () => { store.saveAs(store.project.name); toast(`Guardado en este navegador como «${store.project.name}».`, 'ok'); } }, 'Guardar'), saved.length ? select([{ value: '', label: `Abrir guardado (${saved.length})…` }, ...saved.map((s) => ({ value: s.name, label: `${s.name} · ${s.modified.slice(0, 16).replace('T', ' ')}` }))], '', (v) => {
            if (!v)
                return;
            const errs = store.openSaved(v);
            toast(errs.length ? 'Abierto con advertencias: ' + errs.join(' ') : `Proyecto «${v}» abierto. Recalcule en el Analizador de banda.`, errs.length ? 'error' : 'ok');
        }, { 'aria-label': 'Abrir proyecto guardado' }) : null, h('button', { type: 'button', onclick: () => download(`orbe-im-proyecto-${stamp()}.json`, JSON.stringify(store.project, null, 1), 'application/json') }, 'Exportar proyecto'), h('button', { type: 'button', onclick: async () => {
                const f = await pickFile('.json');
                if (!f)
                    return;
                const text = await f.text();
                const r = parseProject(text);
                if (!r.project) {
                    toast(r.errors.join(' '), 'error');
                    return;
                }
                r.project.sources.push({ name: f.name, kind: 'proyecto', sha256: sha256Hex(utf8Encode(text)), bytes: f.size, importedAt: new Date().toISOString(), rowsAccepted: r.project.transmitters.length + r.project.observed.length, rowsRejected: r.errors.length });
                store.replaceProject(r.project);
                toast((r.isAnalysisExport ? 'Análisis importado: se recuperaron los datos de entrada; recalcule para reproducirlo. ' : 'Proyecto importado. ') + (r.errors.length ? 'Advertencias: ' + r.errors.join(' ') : ''), r.errors.length ? 'error' : 'ok');
            } }, 'Importar proyecto / análisis JSON'), h('button', { type: 'button', onclick: () => { if (confirm('¿Cargar el proyecto de ejemplo? El proyecto actual se sustituye (guárdelo antes si lo necesita).')) {
                store.replaceProject(exampleProject());
                go('analizador');
            } } }, 'Cargar ejemplo'), h('button', { type: 'button', class: 'danger', onclick: () => { if (confirm('¿Empezar un proyecto nuevo? El actual se sustituye (guárdelo antes si lo necesita).'))
                store.replaceProject(emptyProject()); } }, 'Nuevo'));
    }
    $('#version').textContent = `motor ${ALGORITHM_VERSION} · resolución ${RESOLUTION_HZ} Hz · todo se procesa en este navegador`;
    window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.some((x) => x.id === t) && t !== active) {
        active = t;
        show();
    } });
    renderProjectBar();
    show();
    setupPwa($('#pwa'));
}
if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
else
    boot();
