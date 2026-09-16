// AXE « horloge » — 06 : le repli par zone (`zoneUpdated`) est lui aussi écrit
// avec l'horloge locale. Aggrave-t-il ou atténue-t-il le décalage ?
// Et que voit l'utilisateur d'un horodatage dans le futur ?
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, redemarrer, lireTout, lireStamps,
  saisir, synchroniser, bilan, isoler,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const JOUR = 86400000;

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];

  // ---------------------------------------------------------------------
  console.log('=== A. zoneUpdated futur : propagation et rayon d\'action ===');
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'tel', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 }, decalageMs: +JOUR,
  });
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await isoler(tel.page); await isoler(pc.page);

  await saisir(tel.page, 'z11', 'tOss', 100);          // le téléphone ne touche QUE z11
  await synchroniser(tel.page);
  await synchroniser(pc.page);
  const zu = await pc.page.evaluate(() => JSON.parse(JSON.stringify(state.zoneUpdated)));
  console.log('   zoneUpdated reçu par l\'ordinateur :', JSON.stringify(zu));
  b.chk('le zoneUpdated FUTUR du téléphone se propage à l\'ordinateur',
    zu.z11 > Date.now() + 60000, { z11: zu.z11, maintenant: Date.now() });
  b.chk('les zones NON touchées par le téléphone gardent une date réelle (rayon limité)',
    zu.z12 <= Date.now(), { z12: zu.z12 });

  // Ce que l'utilisateur voit dans la fiche de la zone.
  const affiche = await pc.page.evaluate(() => {
    state.avancementZoneId = 'z11';
    renderFicheHeader();
    const el = document.getElementById('ficheupdated');
    return { texte: el ? el.textContent : null, cache: el ? el.hidden : null,
             aujourdhui: new Date().toLocaleDateString('fr-FR') };
  });
  console.log('   fiche de zone affichée :', JSON.stringify(affiche));
  b.chk('la fiche n\'annonce pas une mise à jour à une date FUTURE sans le signaler',
    !/\d\d\/\d\d\/\d{4}/.test(affiche.texte || '')
    || new Date(affiche.texte.replace(/.*(\d\d)\/(\d\d)\/(\d{4}).*/, '$3-$2-$1')).getTime() <= Date.now(),
    affiche);

  // Détection « avancement en retard » : un zoneUpdated futur donne un âge
  // négatif. La zone peut-elle encore être signalée comme non mise à jour ?
  const stale = await pc.page.evaluate(() => {
    const m = computeAvancementModel('bLISS');
    const z = m.zones.find(x => x.id === 'z11');
    return { updatedAt: z.updatedAt, joursCalcules: Math.floor((Date.now() - z.updatedAt) / 86400000),
             signalee: m.issues.stale.some(s => s.zoneId === 'z11') };
  });
  console.log('   âge calculé de la zone z11 :', stale.joursCalcules, 'jour(s) — signalée en retard ?', stale.signalee);
  b.chk('l\'âge d\'une zone n\'est jamais négatif dans le récapitulatif',
    stale.joursCalcules >= 0, stale);

  // ---------------------------------------------------------------------
  console.log('\n=== B. Le repli par zone AGGRAVE-t-il la perte ? (appel direct, 2 zones) ===');
  // Appareil périmé (aucun horodatage de cellule), horloge +1 jour : son
  // horodatage de clé (repli global) ET son zoneUpdated sont dans le futur.
  // On regarde ce qui est protégé et ce qui ne l'est pas.
  const r = await pc.page.evaluate(([futur, hier]) => {
    const perime = {
      progress: { z11: { tOss: 20 }, z12: { tOss: 20 }, z13: { tOss: 20 } },
      at: {},                                  // resté en v1.86
      zoneUpdated: { z11: futur, z12: hier },   // z13 : aucune date de zone
      repli: futur,                            // horodatage de clé, futur
    };
    const releve = {
      progress: { z11: { tOss: 100 }, z12: { tOss: 100 }, z13: { tOss: 100 } },
      at: { z11: { tOss: Date.now() }, z12: { tOss: Date.now() }, z13: { tOss: Date.now() } },
      zoneUpdated: { z11: Date.now(), z12: Date.now(), z13: Date.now() },
      repli: Date.now(),
    };
    const f = mergeProgressByCell(releve, perime);
    return { z11: f.valeurs.z11.tOss, z12: f.valeurs.z12.tOss, z13: f.valeurs.z13.tOss };
  }, [Date.now() + JOUR, Date.now() - JOUR]);
  console.log('   relevé de terrain contre copie périmée à horloge +1 j :', JSON.stringify(r));
  b.chk('zone dont le zoneUpdated est FUTUR : le relevé est perdu (aggravation)',
    r.z11 === 100, { z11: r.z11 });
  b.chk('zone dont le zoneUpdated est RÉEL : le relevé est protégé (atténuation)',
    r.z12 === 100, { z12: r.z12 });
  b.chk('zone SANS zoneUpdated : le repli global futur reprend le dessus',
    r.z13 === 100, { z13: r.z13 });

  // ---------------------------------------------------------------------
  console.log('\n=== C. Migration au rechargement avec un zoneUpdated contaminé ===');
  // Un appareil resté en v1.86 (aucun horodatage de cellule) reçoit, par la
  // synchro, un zoneUpdated futur. Au rechargement, la migration date SES
  // PROPRES cellules avec cette date future.
  const legacy = SEED.herite({ keyStamp: SEED.IL_Y_A_UNE_SEMAINE });
  legacy.zoneUpdated = { z11: Date.now() + JOUR, z12: SEED.IL_Y_A_UNE_SEMAINE,
                         z13: SEED.IL_Y_A_UNE_SEMAINE, z21: SEED.IL_Y_A_UNE_SEMAINE };
  const vieux = await ouvrirAppareil(nav, nouveauServeur(), 'vieux', { seed: legacy, deviceId: 'vieux' });
  await isoler(vieux.page);
  const st = await lireStamps(vieux.page);
  console.log('   horodatages posés par la migration :', JSON.stringify(st));
  b.chk('la migration ne date pas les cellules dans le FUTUR',
    Math.max(...Object.values(st.z11)) <= Date.now() + 5000,
    { z11: st.z11, maintenant: Date.now() });
  b.chk('les zones à date réelle sont datées correctement par la migration',
    st.z12.tOss === SEED.IL_Y_A_UNE_SEMAINE, st.z12);

  // Conséquence : ces cellules datées du futur battent un relevé de terrain
  // fait aujourd'hui par un appareil à l'heure.
  const srv2 = nouveauServeur();
  const terrain = await ouvrirAppareil(nav, srv2, 'terrain', { seed: SEED, deviceId: 'terrain' });
  await isoler(terrain.page);
  await saisir(terrain.page, 'z11', 'tOss', 95);
  await synchroniser(terrain.page);
  // le vieil appareil rejoint ce serveur
  await vieux.page.evaluate(() => { state.syncLastSeenRemoteTs = 0; });
  await vieux.page.evaluate(async () => { try { await doSyncPull(); } catch (e) {} });
  await vieux.page.waitForTimeout(300);
  const vu = await lireTout(vieux.page);
  console.log('   le vieil appareil, après fusion, voit z11.tOss =', (vu.z11 || {}).tOss);
  b.chk('le relevé de terrain du jour n\'est pas battu par une cellule migrée dans le futur',
    (vu.z11 || {}).tOss === 95, vu.z11);

  errs.push(...tel.errs, ...pc.errs, ...vieux.errs, ...terrain.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
