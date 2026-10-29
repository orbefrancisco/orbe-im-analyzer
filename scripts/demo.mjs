// Demostración en consola del motor compilado: caso obligatorio, tres tonos y auditoría.
// Uso: node scripts/demo.mjs   (después de compilar con «npm run build»)
import * as E from '../web/js/engine/index.js';

const sig = (list) => list.map((f, i) => E.makeSignal(E.parseFrequency(f).hz, { id: `g${i + 1}`, classification: 'portadora_confirmada' }));
const P = (o) => ({ ...E.DEFAULT_PARAMS, ...o });

console.log('== Caso obligatorio: f1 = 89.30 MHz, f2 = 89.58 MHz (banda 88–108 MHz, orden ≤ 9) ==');
const run = E.runAnalysis(sig(['89.30', '89.58']), P({ maxOrder: 9, maxTones: 2 }));
console.log(E.completenessStatement(run.meta));
console.log('Orden | Inferior | Superior');
for (let n = 3; n <= 9; n += 2) {
  const k = (n - 1) / 2;
  const lo = (k + 1) * 89_300_000 - k * 89_580_000;
  const hi = (k + 1) * 89_580_000 - k * 89_300_000;
  const ok = E.findGroup(run.result, lo) >= 0 && E.findGroup(run.result, hi) >= 0;
  console.log(`IM${n}  | ${E.formatMHz(lo)}    | ${E.formatMHz(hi)}   ${ok ? '✔ calculado por el motor general' : '✖'}`);
}
const c = E.groupCombos(run.result, E.findGroup(run.result, 88_740_000))[0];
console.log(`Ejemplo: ${E.formulaNumeric(run.result, c)} = ${E.formatMHz(run.result.store.freqHz[c], 3)} MHz (${E.orderLabel(run.result.store, c)})`);

const obs = [E.makeSignal(89_850_000, { id: 'o1', label: 'medida 89.85' }), E.makeSignal(88_740_000, { id: 'o2', label: 'medida 88.74' })];
for (const tol of [5_000, 10_000]) {
  const au = E.audit(run, obs, tol, [], []);
  console.log(`\nTolerancia ±${tol / 1000} kHz (probabilidad de coincidencia fortuita ${(au.coverage.all * 100).toFixed(2)} %):`);
  for (const m of au.matches) {
    if (!m.matches.length) console.log(`  ${E.formatMHz(m.observed.freqHz, 3)} MHz → sin coincidencia (más próximo ${E.formatMHz(m.nearest.freqHz, 3)}, Δ ${E.formatKHz(m.nearest.diffHz)} kHz)`);
    for (const g of m.matches) console.log(`  ${E.formatMHz(m.observed.freqHz, 3)} MHz → ${E.formatMHz(g.freqHz, 3)} MHz, Δ ${E.formatKHz(g.diffHz)} kHz, ${g.combos.map((x) => E.orderLabel(run.result.store, x) + ' ' + E.formulaNumeric(run.result, x)).join(' | ')} → clase ${au.observedClass.get(m.observed.id)}`);
  }
}

console.log('\n== Tres tonos: 89.30, 89.58, 90.10 MHz ==');
const r3 = E.runAnalysis(sig(['89.30', '89.58', '90.10']), P({ maxOrder: 3, maxTones: 3 }));
for (const x of E.groupCombos(r3.result, E.findGroup(r3.result, 88_780_000))) console.log(`${E.formulaNumeric(r3.result, x)} = ${E.formatMHz(r3.result.store.freqHz[x], 3)} MHz (${E.orderLabel(r3.result.store, x)}, ${r3.result.store.tones[x]} tonos)`);
