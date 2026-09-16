// AXE CONCURRENCE — 09. Une SAISIE pendant qu'un ENVOI est en vol.
//
// `doSyncPush` fige son payload (`getSyncablePayload`) puis attend l'écriture.
// Une saisie faite pendant cette attente n'est PAS dans le payload. Or au
// retour, le succès remet à zéro `_hasPendingPush` ET `state.syncPendingSince` :
// l'appareil déclare « tout est parti » alors que la dernière saisie est encore
// chez lui.
//
// On tient l'écriture ouverte avec une porte, on saisit, on relâche, et on
// regarde : le serveur, la pastille, la marque persistée, puis ce que fait une
// fermeture immédiate (pagehide → flushSyncPush).
const { chromium } = require('playwright');
const L = require('./concurrence-lib.js');
const SEED = require('../seeds/liss.js');

(async () => {
  const b = L.bilan();
  const nav = await chromium.launch({ executablePath: L.CHROME });
  const errs = [];
  const srv = L.nouveauServeur();
  const tel = await L.ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 } });
  await L.isoler(tel.page);
  await L.synchroniser(tel.page);

  console.log('=== A. Saisie pendant l\'écriture réseau ===');
  await L.saisir(tel.page, 'z11', 'tOss', 100);     // la saisie qui déclenche l'envoi
  const porte = srv.bloquer('tel', 'upsert');
  const envoi = L.pousser(tel.page);
  await porte.atteinte;                             // l'écriture est en vol
  console.log('   écriture en vol, on saisit maintenant');
  await L.saisir(tel.page, 'z13', 'tIso', 65);      // LA saisie critique
  const pendant = await L.sonde(tel.page);
  console.log('   pendant le vol :', JSON.stringify(pendant));
  porte.ouvrir();
  console.log('   envoi :', await envoi);
  await tel.page.waitForTimeout(120);

  const apres = await L.sonde(tel.page);
  const surSrv = L.serveurProgress(srv);
  console.log('   après le vol :', JSON.stringify(apres));
  console.log('   serveur : z11 =', JSON.stringify(surSrv.z11), '| z13 =', JSON.stringify(surSrv.z13));
  b.chk('la saisie qui a déclenché l\'envoi est bien partie',
    (surSrv.z11 || {}).tOss === 100, surSrv.z11);
  b.chk('la saisie faite PENDANT l\'envoi n\'est pas sur le serveur (constat)',
    (surSrv.z13 || {}).tIso === undefined, surSrv.z13);
  b.chk('l\'appareil sait qu\'il reste quelque chose à envoyer (_hasPendingPush)',
    apres.hasPendingPush === true, apres.hasPendingPush);
  b.chk('la pastille n\'annonce pas « Synchronisé » alors qu\'une saisie n\'est pas partie',
    !/Synchronis/.test(apres.chip || ''), apres.chip);
  b.chk('la marque persistée « reste à envoyer » est conservée',
    apres.stoPending > 0, { mem: apres.memPending, sto: apres.stoPending });

  console.log('\n=== B. L\'utilisateur ferme tout de suite (pagehide → flushSyncPush) ===');
  const nAvant = srv.journal.length;
  await tel.page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
  await tel.page.waitForTimeout(400);
  const tent = srv.journal.slice(nAvant);
  console.log('   tentatives réseau après pagehide :', JSON.stringify(tent.map(e => e.op + (e.cols ? '(' + e.cols + ')' : ''))));
  console.log('   serveur z13 :', JSON.stringify(L.serveurProgress(srv).z13));
  b.chk('la fermeture envoie la saisie restée en local',
    L.serveurCellule(srv, 'z13', 'tIso') === 65, L.serveurProgress(srv).z13);

  console.log('\n=== C. Et au redémarrage suivant, la saisie part-elle ? ===');
  const avantRedem = L.serveurCellule(srv, 'z13', 'tIso');
  await L.redemarrer(tel, 2600);
  console.log('   serveur z13 :', JSON.stringify(L.serveurProgress(srv).z13),
    '| local z13 :', JSON.stringify((await L.lireTout(tel.page)).z13));
  console.log('   sonde :', JSON.stringify(await L.sonde(tel.page)));
  b.chk('au pire, le redémarrage finit par envoyer la saisie',
    L.serveurCellule(srv, 'z13', 'tIso') === 65,
    { avantRedem, apres: L.serveurCellule(srv, 'z13', 'tIso') });

  console.log('\n=== D. Même scène, mais l\'anti-rebond réel est laissé en place ===');
  const srv2 = L.nouveauServeur();
  const t2 = await L.ouvrirAppareil(nav, srv2, 'tel2', { seed: SEED, deviceId: 'tel2' });
  await t2.page.waitForTimeout(2200);               // laisse le démarrage se calmer
  await L.saisir(t2.page, 'z11', 'tOss', 100);
  const porte2 = srv2.bloquer('tel2', 'upsert');
  await t2.page.waitForTimeout(1800);               // l'anti-rebond a déclenché l'envoi
  await porte2.atteinte;
  await L.saisir(t2.page, 'z13', 'tIso', 65);       // saisie pendant le vol
  porte2.ouvrir();
  await t2.page.waitForTimeout(2600);               // l'anti-rebond de CETTE saisie
  const sp2 = L.serveurProgress(srv2);
  console.log('   serveur : z11 =', JSON.stringify(sp2.z11), '| z13 =', JSON.stringify(sp2.z13));
  console.log('   sonde :', JSON.stringify(await L.sonde(t2.page)));
  b.chk('avec l\'anti-rebond réel, la saisie faite pendant l\'envoi part quand même',
    (sp2.z13 || {}).tIso === 65, sp2.z13);

  for (const x of [tel, t2]) errs.push(...x.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
