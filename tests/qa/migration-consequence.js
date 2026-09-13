// La CONSÉQUENCE du repli de migration à 1970, mesurée sur un banc étanche.
//
// Scénario réel de la fenêtre de mise à jour : le téléphone passe en v1.88 et
// migre (toutes ses cellules datées de 1970), l'ordinateur est encore en v1.86
// (aucun horodatage de cellule, son repli est son horodatage de clé, bien réel).
// Si l'ordinateur périmé gagne, le bug d'origine est toujours là.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, lireTout, lireStamps,
  saisir, synchroniser, bilan, isoler,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const JOUR = 86400000;

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];

  // ---------------------------------------------------------------------
  console.log('=== A. Arbitrage nu : cellule migrée contre cellule non migrée ===');
  // On interroge directement la fonction de fusion, sans réseau, pour savoir
  // qui gagne. L'appareil LOCAL est migré (stamp 1970), le DISTANT est resté
  // en v1.86 (aucun stamp de cellule, repli = son horodatage de clé réel).
  const seul = await ouvrirAppareil(nav, nouveauServeur(), 'seul', { seed: SEED.herite(), deviceId: 'seul' });
  await isoler(seul.page);
  const arbitrage = await seul.page.evaluate(([hier, ceMatin]) => {
    // Local : le relevé de terrain, daté au niveau de la cellule.
    // Distant : un appareil resté en version antérieure — aucune date de
    // cellule, mais une dernière modification de zone d'hier.
    const r = mergeProgressByCell(
      { progress: { z11: { tOss: 100 } }, at: { z11: { tOss: ceMatin } },
        zoneUpdated: { z11: ceMatin }, repli: ceMatin },
      { progress: { z11: { tOss: 20 } }, at: {},
        zoneUpdated: { z11: hier }, repli: Date.now() });
    return { valeur: r.valeurs.z11.tOss, stamp: r.stamps.z11.tOss };
  }, [Date.now() - JOUR, Date.now() - 3600000]);
  console.log('   relevé migré (stamp 1970) vs copie périmée non datée (repli = hier)');
  console.log('   la fusion retient :', JSON.stringify(arbitrage));
  b.chk('le relevé de terrain migré NE DOIT PAS perdre contre une copie périmée',
    arbitrage.valeur === 100, arbitrage);

  // ---------------------------------------------------------------------
  console.log('\n=== B. Bout en bout : tournée sur téléphone migré, PC resté en v1.86 ===');
  const srv = nouveauServeur();
  // Le téléphone : état hérité, il migre au chargement, puis fait la tournée.
  const tel = await ouvrirAppareil(nav, srv, 'telephone', {
    seed: SEED.herite({ keyStamp: SEED.IL_Y_A_UNE_SEMAINE }),
    deviceId: 'tel', viewport: { width: 390, height: 844 },
  });
  await isoler(tel.page);
  const dateMigration = (await lireStamps(tel.page)).z11 || {};
  console.log('   horodatage des cellules héritées après migration :', JSON.stringify(dateMigration));
  for (const z of ['z11', 'z12', 'z13']) {
    await saisir(tel.page, z, 'tOss', 100);
    await saisir(tel.page, z, 'tIso', 75);
  }
  const relevé = await lireTout(tel.page);
  console.log('   relevé de la tournée, z11 :', JSON.stringify(relevé.z11));
  await synchroniser(tel.page);
  console.log('   poussé (écritures serveur :', srv.ecritures + ')');

  // Le PC arrive APRÈS, tout neuf dans la session, resté en v1.86 :
  // aucun horodatage de cellule, un horodatage de clé d'AUJOURD'HUI (il a
  // saisi autre chose ce matin), et l'avancement d'AVANT la visite.
  const pc = await ouvrirAppareil(nav, srv, 'pc', {
    seed: SEED.herite({ keyStamp: Date.now() }),
    deviceId: 'pc',
  });
  await isoler(pc.page);
  // On le remet dans l'état v1.86 : la migration l'a daté, on efface.
  await pc.page.evaluate(() => { state.taskProgressAt = {}; });
  const pcAvant = await lireTout(pc.page);
  console.log('   PC avant fusion, z11 :', JSON.stringify(pcAvant.z11));
  await synchroniser(pc.page);
  const pcApres = await lireTout(pc.page);
  console.log('   PC après fusion,  z11 :', JSON.stringify(pcApres.z11 || {}));
  b.chk('le relevé de terrain arrive sur le PC périmé et ne recule pas',
    (pcApres.z11 || {}).tOss === 100 && (pcApres.z11 || {}).tIso === 75,
    pcApres.z11 || {});

  // Et il ne doit pas non plus être détruit côté téléphone au retour.
  await synchroniser(tel.page);
  const telApres = await lireTout(tel.page);
  console.log('   TÉLÉPHONE après resynchro, z11 :', JSON.stringify(telApres.z11 || {}));
  b.chk('le relevé survit sur le téléphone qui l\'a saisi',
    (telApres.z11 || {}).tOss === 100 && (telApres.z11 || {}).tIso === 75,
    telApres.z11 || {});

  // ---------------------------------------------------------------------
  console.log('\n=== C. La restauration d\'une sauvegarde tient-elle face à la synchro ? ===');
  // L'utilisateur restaure un état correct sur le PC ; le serveur porte encore
  // l'état erroné. Les valeurs restaurées doivent gagner.
  const srv3 = nouveauServeur();
  const p1 = await ouvrirAppareil(nav, srv3, 'p1', { seed: SEED.herite({ keyStamp: Date.now() - JOUR }), deviceId: 'p1' });
  await isoler(p1.page);
  await saisir(p1.page, 'z11', 'tOss', 0);      // la fausse manœuvre : remise à zéro
  await synchroniser(p1.page);
  console.log('   serveur porte la remise à zéro');
  // Restauration d'un état antérieur correct, à la façon d'une restauration
  // de sauvegarde : on réécrit taskProgress SANS toucher aux horodatages.
  await p1.page.evaluate(() => {
    state.taskProgress = { z11: { tTrac: 100, tOss: 100, tIso: 75 } };
    save();
  });
  const avantSync = await lireTout(p1.page);
  console.log('   après restauration locale, z11 :', JSON.stringify(avantSync.z11));
  await synchroniser(p1.page);
  const apresSync = await lireTout(p1.page);
  console.log('   après la synchro suivante, z11 :', JSON.stringify(apresSync.z11 || {}));
  b.chk('une restauration n\'est pas défaite par la synchro qui suit',
    (apresSync.z11 || {}).tOss === 100, apresSync.z11 || {});

  for (const app of [seul, tel, pc, p1]) errs.push(...app.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
