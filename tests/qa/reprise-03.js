// (3) L'appareil est FERMÉ avec un envoi en attente, puis rouvert.
//     `syncPendingSince` doit être persisté et l'envoi repartir SEUL.
//     Cas critique de la v1.89 : UNE SEULE saisie, puis fermeture.
const { chromium } = require('playwright');
const {
  CHROME, URL, nouveauServeur, ouvrirAppareil, redemarrer, saisir, sonde,
  serveurProgress, bilan, dormir,
} = require('./reprise-lib.js');
const SEED = require('../seeds/liss.js');

// Remet l'appareil dans l'état « tout est parti, rien en attente », y compris
// DANS LE STOCKAGE : sans cela la marque périmée laissée par l'envoi précédent
// masquerait le défaut que la v1.89 a fermé.
const remettreAZero = (page) => page.evaluate(() => {
  clearTimeout(syncPushTimer); clearTimeout(syncRetryTimer);
  syncRetryTimer = null; syncRetryDelai = 0;
  _hasPendingPush = false;
  state.syncPendingSince = 0;
  const brut = JSON.parse(localStorage.getItem('chantier_v1') || '{}');
  brut.syncPendingSince = 0;
  localStorage.setItem('chantier_v1', JSON.stringify(brut));
  if (typeof updateSyncChip === 'function') updateSyncChip();
});

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });

  // =====================================================================
  console.log('=== A. UNE SEULE saisie : la marque atteint-elle le stockage ? ===');
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'tel', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 },
  });
  await dormir(2600);
  await remettreAZero(tel.page);
  let s = await sonde(tel.page);
  b.chk('point de départ : aucune marque, ni en mémoire ni dans le stockage',
    s.memPending === 0 && (s.stoPending || 0) === 0, { mem: s.memPending, sto: s.stoPending });

  srv.enPanne = true;
  await saisir(tel.page, 'z22', 'mPose', 75);     // UNE seule saisie
  s = await sonde(tel.page);
  console.log('   juste après la saisie :', JSON.stringify(s));
  b.chk('[v1.89] après UN SEUL save, la marque est DÉJÀ dans le stockage',
    s.stoPending > 0, { sto: s.stoPending, mem: s.memPending });
  b.chk('la pastille passe à « Non envoyé » sans attendre l\'anti-rebond',
    /Non envoyé/.test(s.chip || ''), s.chip);
  const marqueAvant = s.stoPending;

  // =====================================================================
  console.log('\n=== B. Fermeture immédiate (dans l\'anti-rebond), réseau coupé ===');
  // Aucune attente : on ferme AVANT que l'anti-rebond de 1,5 s ait fini.
  await redemarrer(tel, 1400);
  s = await sonde(tel.page);
  console.log('   après redémarrage (réseau toujours coupé) :', JSON.stringify(s));
  const apresRedem = await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress)));
  b.chk('la saisie est toujours sur l\'appareil après redémarrage',
    (apresRedem.z22 || {}).mPose === 75, apresRedem.z22);
  b.chk('la marque d\'attente a survécu à la fermeture',
    s.memPending === marqueAvant, { relue: s.memPending, attendue: marqueAvant });
  b.chk('l\'application se sait en retard (`_hasPendingPush`) au redémarrage',
    s.hasPendingPush === true, s.hasPendingPush);
  b.chk('la pastille dit « Non envoyé » dès le redémarrage', /Non envoyé/.test(s.chip || ''), s.chip);
  b.chk('un envoi a été TENTÉ au démarrage et a échoué (réseau coupé)',
    srv.journal.some(e => e.ok === false), { echecs: srv.journal.filter(e => e.ok === false).length });
  b.chk('la reprise est armée après l\'échec du démarrage', s.retryArme === true,
    { arme: s.retryArme, delai: s.retryDelai });

  console.log('\n=== C. Réseau revenu, AUCUNE action : la saisie part-elle ? ===');
  srv.enPanne = false;
  let t0 = Date.now(), ok = false;
  while (Date.now() - t0 < 70000) {
    await dormir(500);
    if ((serveurProgress(srv).z22 || {}).mPose === 75) { ok = true; break; }
  }
  console.log('   arrivée après ' + (Date.now() - t0) + ' ms');
  b.chk('la saisie unique finit par partir seule, sans aucune action',
    ok, { delaiMs: Date.now() - t0, distant: serveurProgress(srv).z22 });
  await dormir(700);
  s = await sonde(tel.page);
  b.chk('pastille verte après l\'envoi', /Synchronisé/.test(s.chip || ''), s.chip);

  // =====================================================================
  console.log('\n=== D. Redémarrage AVEC réseau : l\'envoi part au démarrage ===');
  await remettreAZero(tel.page);
  srv.enPanne = false;
  // Le réseau marche, mais il est LENT (700 ms par lecture). La tentative de
  // dernière chance (`pagehide`/`beforeunload`) commence par relire
  // `updated_at` : sa réponse arrive après la mort de la page, elle n'atteint
  // donc jamais l'upsert. Toute écriture observée est forcément celle du
  // nouveau démarrage — l'attribution est sans ambiguïté.
  srv.latenceMs = 700;
  await saisir(tel.page, 'z23', 'mFin', 40);
  const ecrAvant = srv.ecritures, upsAvant = srv.tentativesUpsert;
  const tNav = Date.now() - srv.t0;
  await tel.page.goto(URL);
  await dormir(3000);
  srv.latenceMs = 0;
  console.log('   écritures : ' + ecrAvant + ' -> ' + srv.ecritures);
  console.log('   journal (fin) :', srv.journal.slice(-8)
    .map(e => e.op + '(' + (e.cols || '') + ')@' + e.t + (e.ok ? '' : ' KO')).join('  '));
  b.chk('la page fermée n\'a pas pu écrire (aucun upsert pendant sa mort)',
    !srv.journal.some(e => e.op === 'upsert' && e.t >= tNav && e.t < tNav + 690),
    { tNav });
  b.chk('le redémarrage à lui seul a envoyé la saisie en attente',
    (serveurProgress(srv).z23 || {}).mFin === 40,
    { distant: serveurProgress(srv).z23, ecritures: srv.ecritures });
  s = await sonde(tel.page);
  b.chk('plus rien en attente en mémoire après le redémarrage réussi',
    s.hasPendingPush === false && s.memPending === 0, { p: s.hasPendingPush, m: s.memPending });
  b.chk('pastille verte', /Synchronisé/.test(s.chip || ''), s.chip);

  // =====================================================================
  console.log('\n=== E. Redémarrage en attente ALORS QUE le serveur a bougé ===');
  // Course réelle : `reprendreEnvoiEnAttente()` n'est PAS attendu avant le
  // pull initial (aucun `await`). Les deux partent ensemble. Avec de la
  // latence, l'envoi et la lecture s'entrelacent : rien ne doit se perdre.
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await dormir(2600);
  await remettreAZero(tel.page);
  srv.enPanne = true;
  await saisir(tel.page, 'z21', 'tOss', 65);       // saisie du téléphone, bloquée
  await dormir(300);
  srv.enPanne = false;
  await saisir(pc.page, 'z12', 'tPar', 45);        // le PC, lui, pousse
  await dormir(2600);
  b.chk('le PC a poussé sa cellule', (serveurProgress(srv).z12 || {}).tPar === 45,
    serveurProgress(srv).z12);
  const telLocal = await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress)));
  console.log('   le téléphone détient z21.tOss =', (telLocal.z21 || {}).tOss,
    '| serveur :', JSON.stringify(serveurProgress(srv).z21));

  srv.latenceMs = 350;             // pour provoquer l'entrelacement
  srv.latenceEcritureMs = 350;
  await redemarrer(tel, 3500);
  srv.latenceMs = 0; srv.latenceEcritureMs = 0;
  await dormir(2500);
  const telFin = await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress)));
  const srvFin = serveurProgress(srv);
  console.log('   téléphone :', JSON.stringify(telFin.z21), JSON.stringify(telFin.z12));
  console.log('   serveur   :', JSON.stringify(srvFin.z21), JSON.stringify(srvFin.z12));
  b.chk('la saisie en attente du téléphone atteint le serveur malgré la course',
    (srvFin.z21 || {}).tOss === 65, { distant: srvFin.z21 });
  b.chk('la cellule du PC n\'est pas écrasée par le démarrage du téléphone',
    (srvFin.z12 || {}).tPar === 45, { distant: srvFin.z12 });
  b.chk('le téléphone a bien intégré la cellule du PC',
    (telFin.z12 || {}).tPar === 45, { local: telFin.z12 });
  s = await sonde(tel.page);
  b.chk('plus rien en attente à la fin', s.hasPendingPush === false && s.memPending === 0,
    { p: s.hasPendingPush, m: s.memPending });

  const code = b.fin([...tel.errs, ...pc.errs]);
  await nav.close();
  process.exit(code);
})();
