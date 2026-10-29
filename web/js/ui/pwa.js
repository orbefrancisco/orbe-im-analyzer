/**
 * PWA: registro del service worker (copia local para trabajar sin conexión),
 * aviso de versión nueva y botón de instalación.
 * Cuando llega una versión nueva NO se recarga sola: un análisis en curso se
 * perdería. Se ofrece un botón y el usuario decide.
 */
import { h, mount } from './dom.js';
export function setupPwa(box) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol))
        return;
    const sw = navigator.serviceWorker;
    const hadController = !!sw.controller;
    let deferred = null;
    let updateReady = false;
    const render = () => mount(box, updateReady ? h('button', { type: 'button', class: 'primary', title: 'Hay una versión nueva de la aplicación', onclick: () => location.reload() }, 'Versión nueva: recargar') : null, deferred ? h('button', { type: 'button', onclick: async () => { const d = deferred; deferred = null; render(); await d?.prompt(); } }, 'Instalar aplicación') : null, !navigator.onLine ? h('span', { class: 'badge none', title: 'Funciona con la copia guardada en este dispositivo' }, 'sin conexión') : null);
    sw.addEventListener('controllerchange', () => { if (hadController) {
        updateReady = true;
        render();
    } });
    sw.register('sw.js').then((reg) => {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible')
            reg.update().catch(() => undefined); });
    }).catch(() => undefined);
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; render(); });
    window.addEventListener('appinstalled', () => { deferred = null; render(); });
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    render();
}
