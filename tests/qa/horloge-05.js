// AXE « horloge » — 05 : le cas dégénéré, deux saisies dans la MÊME
// milliseconde sur deux appareils, sur la même cellule.
//
// On ne peut pas espérer que deux vraies horloges tombent sur la même ms : on
// gèle donc `Date.now` dans la page le temps de la saisie, ce qui est
// exactement ce que l'application verrait de deux horloges d'accord à la ms.
// Puis on synchronise dans les DEUX SENS et on compare : la valeur retenue
// est-elle la même, et les deux appareils convergent-ils ?
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, lireTout, lireStamps, stamps,
  synchroniser, bilan, isoler, dormir,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

// Saisit AVEC une horloge gelée sur `ts` : setProgress, save() et le bump de
// syncTimestamp voient tous la même milliseconde.
const saisirAms = (page, ts, cellules) => page.evaluate(([t, cells]) => {
  const vrai = Date.now;
  try {
    Date.now = () => t;
    for (const [z, tk, v] of cells) setProgress(z, tk, v);
  } finally { Date.now = vrai; }
  return { syncTimestamp: state.syncTimestamp, at: JSON.parse(JSON.stringify(state.taskProgressAt)) };
}, [ts, cellules]);

async function duel(nav, b, nom, premier, T) {
  console.log(`\n--- ${nom} : ${premier} pousse en premier ---`);
  const srv = nouveauServeur();
  const a = await ouvrirAppareil(nav, srv, 'A', { seed: SEED, deviceId: 'A' });
  const c = await ouvrirAppareil(nav, srv, 'C', { seed: SEED, deviceId: 'C' });
  await isoler(a.page); await isoler(c.page);

  // Même cellule, même milliseconde, valeurs différentes. Chacun relève aussi
  // une zone qui n'intéresse que lui, pour voir ce qui circule.
  const ra = await saisirAms(a.page, T, [['z11', 'tOss', 80], ['z22', 'mPose', 50]]);
  const rc = await saisirAms(c.page, T, [['z11', 'tOss', 35], ['z23', 'mFin', 15]]);
  console.log('   A : stamp cellule =', ra.at.z11.tOss, '| syncTimestamp =', ra.syncTimestamp);
  console.log('   C : stamp cellule =', rc.at.z11.tOss, '| syncTimestamp =', rc.syncTimestamp);
  b.chk(`[${nom}] les deux appareils ont bien horodaté la cellule à la même ms`,
    ra.at.z11.tOss === rc.at.z11.tOss, [ra.at.z11.tOss, rc.at.z11.tOss]);

  const [p, s] = premier === 'A' ? [a, c] : [c, a];
  await synchroniser(p.page);
  const updated1 = srv.ligne.updated_at;
  await synchroniser(s.page);
  const updated2 = srv.ligne.updated_at;
  await synchroniser(p.page);
  await synchroniser(s.page);

  const ta = await lireTout(a.page), tc = await lireTout(c.page);
  console.log('   updated_at après 1er push :', updated1, '| après 2e push :', updated2);
  console.log('   A voit z11.tOss =', (ta.z11 || {}).tOss, '| C voit z11.tOss =', (tc.z11 || {}).tOss);
  console.log('   A voit z23.mFin =', (ta.z23 || {}).mFin, '| C voit z22.mPose =', (tc.z22 || {}).mPose);
  b.chk(`[${nom}] les deux appareils convergent sur la cellule disputée`,
    (ta.z11 || {}).tOss === (tc.z11 || {}).tOss,
    { A: (ta.z11 || {}).tOss, C: (tc.z11 || {}).tOss });
  b.chk(`[${nom}] la saisie de zone propre à A parvient à C`,
    (tc.z22 || {}).mPose === 50, tc.z22 || null);
  b.chk(`[${nom}] la saisie de zone propre à C parvient à A`,
    (ta.z23 || {}).mFin === 15, ta.z23 || null);
  b.chk(`[${nom}] le serveur porte les deux relevés`,
    ((srv.ligne.state.taskProgress.z22) || {}).mPose === 50
    && ((srv.ligne.state.taskProgress.z23) || {}).mFin === 15,
    { z22: srv.ligne.state.taskProgress.z22, z23: srv.ligne.state.taskProgress.z23 });

  const errs = [...a.errs, ...c.errs];
  const retenu = (ta.z11 || {}).tOss;
  await a.ctx.close(); await c.ctx.close();
  return { retenu, errs };
}

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const T = Date.now() - 5000;   // une milliseconde commune, dans le passé proche

  console.log('=== A. Même cellule, même milliseconde, les deux ordres de synchro ===');
  const r1 = await duel(nav, b, 'A d\'abord', 'A', T);
  const r2 = await duel(nav, b, 'C d\'abord', 'C', T);
  errs.push(...r1.errs, ...r2.errs);
  console.log('\n   valeur retenue selon l\'ordre de synchro : A d\'abord ->', r1.retenu,
    '| C d\'abord ->', r2.retenu);
  b.chk('la valeur retenue ne dépend PAS de l\'ordre des synchros',
    r1.retenu === r2.retenu, { AdAbord: r1.retenu, CdAbord: r2.retenu });

  // ---------------------------------------------------------------------
  console.log('\n=== B. Égalité stricte : pierre tombale contre valeur ===');
  {
    const srv = nouveauServeur();
    const a = await ouvrirAppareil(nav, srv, 'A', { seed: SEED, deviceId: 'A' });
    const c = await ouvrirAppareil(nav, srv, 'C', { seed: SEED, deviceId: 'C' });
    await isoler(a.page); await isoler(c.page);
    await saisirAms(a.page, T, [['z11', 'tOss', 0]]);       // remise à zéro
    await saisirAms(c.page, T, [['z11', 'tOss', 65]]);      // valeur
    await synchroniser(a.page);
    await synchroniser(c.page);
    await synchroniser(a.page);
    const ta = await lireTout(a.page), tc = await lireTout(c.page);
    console.log('   A (qui a remis à zéro) voit :', JSON.stringify(ta.z11),
      '| C voit :', JSON.stringify(tc.z11));
    b.chk('la remise à zéro et la valeur convergent (pas de divergence permanente)',
      JSON.stringify(ta.z11) === JSON.stringify(tc.z11), { A: ta.z11, C: tc.z11 });
    // Contrôle de mon propre test : la RÈGLE de fusion, elle, est-elle bien
    // « à égalité, la valeur présente l'emporte sur l'absence » ? (Si oui, la
    // divergence ci-dessus vient du fait qu'un des deux appareils ne fusionne
    // jamais, pas de la règle d'arbitrage.)
    const regle = await c.page.evaluate((t) => {
      const tombe = { progress: {}, at: { z11: { tOss: t } }, zoneUpdated: {}, repli: 0 };
      const val = { progress: { z11: { tOss: 65 } }, at: { z11: { tOss: t } }, zoneUpdated: {}, repli: 0 };
      return {
        valLocal: (mergeProgressByCell(val, tombe).valeurs.z11 || {}).tOss,
        valDistant: (mergeProgressByCell(tombe, val).valeurs.z11 || {}).tOss,
      };
    }, T);
    console.log('   règle d\'arbitrage à égalité (appel direct) :', JSON.stringify(regle));
    b.chk('la RÈGLE de fusion à égalité garde bien la valeur présente (dans les 2 sens)',
      regle.valLocal === 65 && regle.valDistant === 65, regle);
    b.chk('après synchro, l\'appareil qui a remis à zéro voit la valeur présente',
      (ta.z11 || {}).tOss === 65, ta.z11);
    errs.push(...a.errs, ...c.errs);
    await a.ctx.close(); await c.ctx.close();
  }

  // ---------------------------------------------------------------------
  console.log('\n=== C. Même ms → même updated_at : le second push est-il visible ? ===');
  {
    const srv = nouveauServeur();
    const a = await ouvrirAppareil(nav, srv, 'A', { seed: SEED, deviceId: 'A' });
    const c = await ouvrirAppareil(nav, srv, 'C', { seed: SEED, deviceId: 'C' });
    await isoler(a.page); await isoler(c.page);
    await saisirAms(a.page, T, [['z22', 'mPose', 50]]);
    await saisirAms(c.page, T, [['z23', 'mFin', 15]]);
    await synchroniser(a.page);
    const u1 = srv.ligne.updated_at;
    await synchroniser(c.page);
    const u2 = srv.ligne.updated_at;
    console.log('   updated_at : après A =', u1, '| après C =', u2);
    b.chk('deux appareils à la même ms écrivent le MÊME updated_at',
      u1 === u2, { u1, u2 });
    const lect = srv.lectures;
    await a.page.evaluate(() => doSyncPull());
    await dormir(200);
    const ta = await lireTout(a.page);
    console.log('   lectures consommées par le pull de A :', srv.lectures - lect,
      '| A voit z23 =', JSON.stringify(ta.z23 || null));
    b.chk('A intègre le relevé de C malgré l\'updated_at identique',
      (ta.z23 || {}).mFin === 15, ta.z23 || null);
    errs.push(...a.errs, ...c.errs);
    await a.ctx.close(); await c.ctx.close();
  }

  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
