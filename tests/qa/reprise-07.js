// (8) La pastille : est-elle vraie DANS TOUS LES CAS ? Une pastille verte
//     mensongère est un défaut grave.
// (9) Après un envoi réussi, `state.syncPendingSince` repasse à 0 en mémoire ;
//     le stockage, lui, porte-t-il encore l'ancienne marque, et avec quelles
//     conséquences au redémarrage ?
// Et la garde anti-écrasement : que se passe-t-il si un autre appareil écrit
// PENDANT qu'un envoi lent est en vol ?
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, redemarrer, saisir, sonde,
  serveurProgress, bilan, dormir,
} = require('./reprise-lib.js');
const SEED = require('../seeds/liss.js');

const remettreAZero = (page) => page.evaluate(() => {
  clearTimeout(syncPushTimer); clearTimeout(syncRetryTimer);
  syncRetryTimer = null; syncRetryDelai = 0;
  _hasPendingPush = false; state.syncPendingSince = 0;
  const brut = JSON.parse(localStorage.getItem('chantier_v1') || '{}');
  brut.syncPendingSince = 0;
  localStorage.setItem('chantier_v1', JSON.stringify(brut));
  if (typeof updateSyncChip === 'function') updateSyncChip();
});

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'tel', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 },
  });
  await dormir(2600);

  // =====================================================================
  console.log('=== A. Saisie faite PENDANT un envoi lent en vol ===');
  // Réseau de chantier : l\'écriture met 6 s. L\'utilisateur tape une deuxième
  // cellule pendant ce temps. `doSyncPush` a déjà figé son payload.
  await remettreAZero(tel.page);
  srv.latenceEcritureMs = 6000;
  await saisir(tel.page, 'z22', 'mPose', 90);
  await dormir(2200);                       // l'anti-rebond a tiré, l'upsert est en vol
  let s = await sonde(tel.page);
  b.chk('l\'envoi est en cours et la pastille l\'annonce',
    s.statut === 'syncing', { statut: s.statut, chip: s.chip });
  await dormir(4000);                       // on est encore dans l'upsert
  await saisir(tel.page, 'z23', 'mFin', 70);  // 2e saisie, payload déjà figé
  console.log('   2e saisie faite pendant que l\'upsert est en vol');

  // On guette l'INSTANT où l'application se déclare à jour.
  let instantane = null;
  for (let i = 0; i < 60; i++) {
    const x = await sonde(tel.page);
    if (x.hasPendingPush === false) {
      instantane = { ...x, distantZ23: (serveurProgress(srv).z23 || {}).mFin };
      break;
    }
    await dormir(100);
  }
  console.log('   instantané au moment où l\'app se croit à jour :', JSON.stringify(instantane));
  b.chk('un tel instant existe bien (l\'envoi a réussi)', !!instantane, instantane);
  if (instantane) {
    b.chk('[pastille] elle ne doit PAS être verte tant que la 2e saisie n\'est pas partie',
      !/Synchronisé/.test(instantane.chip || '') || instantane.distantZ23 === 70,
      { chip: instantane.chip, distant: instantane.distantZ23 });
    b.chk('[marque] la marque d\'attente ne doit pas être effacée alors qu\'une saisie reste à envoyer',
      instantane.memPending > 0 || instantane.distantZ23 === 70,
      { memoire: instantane.memPending, stockage: instantane.stoPending, distant: instantane.distantZ23 });
  }
  // La 2e saisie finit-elle par partir (anti-rebond de sa propre sauvegarde) ?
  srv.latenceEcritureMs = 0;
  let t0 = Date.now(), ok = false;
  while (Date.now() - t0 < 30000) {
    await dormir(300);
    if ((serveurProgress(srv).z23 || {}).mFin === 70) { ok = true; break; }
  }
  console.log('   la 2e saisie arrive après ' + (Date.now() - t0) + ' ms');
  b.chk('la 2e saisie finit tout de même par partir', ok, serveurProgress(srv).z23);

  // =====================================================================
  console.log('\n=== B. Un autre appareil écrit PENDANT un envoi lent en vol ===');
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await dormir(2600);
  await remettreAZero(tel.page);
  await remettreAZero(pc.page);
  srv.latenceEcritureMs = 5000;
  await saisir(tel.page, 'z21', 'tIso', 55);   // téléphone : envoi lent qui part
  await dormir(2000);                          // l'upsert du téléphone est en vol
  srv.latenceEcritureMs = 0;
  await saisir(pc.page, 'z13', 'tPar', 65);    // le PC écrit pendant ce temps
  await dormir(2200);
  console.log('   serveur juste après l\'écriture du PC :', JSON.stringify(serveurProgress(srv).z13));
  b.chk('le PC a bien écrit sa cellule pendant l\'envoi du téléphone',
    (serveurProgress(srv).z13 || {}).tPar === 65, serveurProgress(srv).z13);
  await dormir(3500);                          // l'upsert du téléphone se termine
  const apresVol = serveurProgress(srv);
  console.log('   serveur après la fin de l\'envoi du téléphone :',
    JSON.stringify({ z13: apresVol.z13, z21: apresVol.z21 }));
  b.chk('[garde anti-écrasement] la cellule du PC survit à l\'envoi en vol du téléphone',
    (apresVol.z13 || {}).tPar === 65, apresVol.z13);
  // Si elle a disparu : revient-elle, et en combien de temps ?
  t0 = Date.now(); let revenue = (apresVol.z13 || {}).tPar === 65;
  while (!revenue && Date.now() - t0 < 45000) {
    await dormir(500);
    if ((serveurProgress(srv).z13 || {}).tPar === 65) revenue = true;
  }
  console.log('   cellule du PC présente sur le serveur : ' + revenue
    + (revenue ? ' (après ' + (Date.now() - t0) + ' ms)' : ''));
  b.chk('la cellule du PC est présente sur le serveur au bout du compte', revenue,
    { delaiMs: Date.now() - t0, z13: serveurProgress(srv).z13 });
  const pcSonde = await sonde(pc.page);
  b.chk('le PC, lui, ne signale rien d\'anormal pendant ce temps',
    /Synchronisé/.test(pcSonde.chip || ''), pcSonde.chip);

  // =====================================================================
  console.log('\n=== C. Redémarrage APRÈS un envoi réussi, réseau coupé ===');
  // Conséquence de (9) : le stockage porte encore une marque périmée alors que
  // tout est parti. Au redémarrage sans réseau, l'application annonce un
  // retard qui n'existe pas et relance des envois inutiles.
  await dormir(1500);
  let sAvant = await sonde(tel.page);
  console.log('   avant fermeture :', JSON.stringify({ mem: sAvant.memPending, sto: sAvant.stoPending, chip: sAvant.chip }));
  b.chk('tout est parti : rien en attente en mémoire, pastille verte',
    sAvant.memPending === 0 && /Synchronisé/.test(sAvant.chip || ''),
    { mem: sAvant.memPending, chip: sAvant.chip });
  b.chk('[cas 9] mais le STOCKAGE porte encore une marque d\'attente périmée',
    sAvant.stoPending === 0, { stockage: sAvant.stoPending });

  // L'état local et l'état serveur sont-ils identiques ? (rien à envoyer)
  const avantLocal = await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress)));
  const avantDistant = serveurProgress(srv);
  const identiques = JSON.stringify(avantLocal) === JSON.stringify(avantDistant);
  console.log('   local == distant ? ' + identiques);

  srv.enPanne = true;
  const ups0 = srv.journal.length;
  await redemarrer(tel, 1400);
  s = await sonde(tel.page);
  console.log('   après redémarrage sans réseau :', JSON.stringify(s));
  b.chk('l\'avancement local est bien identique à celui du serveur (rien à envoyer)',
    identiques, { local: Object.keys(avantLocal), distant: Object.keys(avantDistant) });
  b.chk('[pastille] elle ne doit pas annoncer « Non envoyé » alors que tout est parti',
    !/Non envoyé/.test(s.chip || ''), { chip: s.chip, marqueRelue: s.memPending });
  await dormir(12000);
  const tentativesInutiles = srv.journal.slice(ups0).filter(e => e.ok === false).length;
  console.log('   appels réseau en échec depuis le redémarrage : ' + tentativesInutiles);
  b.chk('aucune tentative d\'envoi inutile n\'est relancée en boucle',
    tentativesInutiles === 0, { tentatives: tentativesInutiles });
  srv.enPanne = false;

  const code = b.fin([...tel.errs, ...pc.errs]);
  await nav.close();
  process.exit(code);
})();
