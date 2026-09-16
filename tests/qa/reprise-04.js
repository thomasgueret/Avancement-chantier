// (4) Fermeture pendant l'anti-rebond d'envoi : que devient la DERNIÈRE saisie ?
// (5) `pagehide` / `beforeunload` / passage en arrière-plan : `flushSyncPush()`
//     part-il vraiment, sans attendre les 1,5 s de l'anti-rebond ?
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, redemarrer, saisir, sonde,
  serveurProgress, visibilite, bilan, dormir,
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

// Premier upsert enregistré à partir de l'instant `depuis` (ms serveur).
const premierUpsertApres = (srv, depuis) => {
  const e = srv.journal.find(x => x.op === 'upsert' && x.t >= depuis);
  return e ? e.t - depuis : -1;
};

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'tel', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 },
  });
  await dormir(2600);

  // =====================================================================
  console.log('=== A. Passage en arrière-plan : envoi sans attendre l\'anti-rebond ===');
  await remettreAZero(tel.page);
  let t = Date.now() - srv.t0;
  await saisir(tel.page, 'z22', 'mPose', 35);
  await dormir(100);
  await visibilite(tel.page, 'hidden');
  await dormir(700);                       // bien avant 1500 ms
  let d = premierUpsertApres(srv, t);
  console.log('   premier upsert ' + d + ' ms après la saisie');
  b.chk('l\'appareil rangé envoie tout de suite (< 800 ms, pas 1500 ms)',
    d >= 0 && d < 800, { delaiMs: d });
  b.chk('la saisie est sur le serveur', (serveurProgress(srv).z22 || {}).mPose === 35,
    serveurProgress(srv).z22);
  await visibilite(tel.page, 'visible');
  await dormir(900);

  // =====================================================================
  console.log('\n=== B. `pagehide` : flushSyncPush part-il ? ===');
  await remettreAZero(tel.page);
  t = Date.now() - srv.t0;
  await saisir(tel.page, 'z22', 'mFin', 20);
  await dormir(80);
  await tel.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await dormir(700);
  d = premierUpsertApres(srv, t);
  console.log('   premier upsert ' + d + ' ms après la saisie');
  b.chk('`pagehide` déclenche l\'envoi immédiat', d >= 0 && d < 800, { delaiMs: d });
  b.chk('la saisie est sur le serveur après `pagehide`',
    (serveurProgress(srv).z22 || {}).mFin === 20, serveurProgress(srv).z22);

  // =====================================================================
  console.log('\n=== C. `beforeunload` : flushSyncPush part-il ? ===');
  await remettreAZero(tel.page);
  t = Date.now() - srv.t0;
  await saisir(tel.page, 'z23', 'mFin', 60);
  await dormir(80);
  await tel.page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  await dormir(700);
  d = premierUpsertApres(srv, t);
  console.log('   premier upsert ' + d + ' ms après la saisie');
  b.chk('`beforeunload` déclenche l\'envoi immédiat', d >= 0 && d < 800, { delaiMs: d });
  b.chk('la saisie est sur le serveur après `beforeunload`',
    (serveurProgress(srv).z23 || {}).mFin === 60, serveurProgress(srv).z23);

  // =====================================================================
  console.log('\n=== D. Rien en attente : le flush ne doit rien écrire ===');
  await dormir(600);
  await remettreAZero(tel.page);
  const ecr = srv.ecritures;
  await tel.page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('beforeunload')); });
  await dormir(600);
  b.chk('aucune écriture parasite quand rien n\'est en attente',
    srv.ecritures === ecr, { avant: ecr, apres: srv.ecritures });

  // =====================================================================
  console.log('\n=== E. Fermeture à différents instants de l\'anti-rebond, réseau coupé ===');
  for (const [attente, zone, tache, val] of [[0, 'z21', 'mPose', 45], [1400, 'z21', 'mFin', 25]]) {
    console.log('   -- fermeture ' + attente + ' ms après la saisie --');
    await remettreAZero(tel.page);
    srv.enPanne = true;
    await saisir(tel.page, zone, tache, val);
    if (attente) await dormir(attente);
    await redemarrer(tel, 1300);
    let s = await sonde(tel.page);
    const loc = await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress)));
    b.chk('   la saisie survit au redémarrage (fermeture à ' + attente + ' ms)',
      (loc[zone] || {})[tache] === val, (loc[zone] || {}));
    b.chk('   la marque d\'attente est relue du stockage (fermeture à ' + attente + ' ms)',
      s.memPending > 0 && s.hasPendingPush === true, { m: s.memPending, p: s.hasPendingPush });
    b.chk('   la pastille dit « Non envoyé » (fermeture à ' + attente + ' ms)',
      /Non envoyé/.test(s.chip || ''), s.chip);
    srv.enPanne = false;
    const t0 = Date.now();
    let ok = false;
    while (Date.now() - t0 < 70000) {
      await dormir(400);
      if ((serveurProgress(srv)[zone] || {})[tache] === val) { ok = true; break; }
    }
    b.chk('   la saisie part seule après le retour du réseau (fermeture à ' + attente + ' ms)',
      ok, { delaiMs: Date.now() - t0, distant: serveurProgress(srv)[zone] });
    await dormir(600);
    s = await sonde(tel.page);
    b.chk('   pastille verte une fois partie (fermeture à ' + attente + ' ms)',
      /Synchronisé/.test(s.chip || ''), s.chip);
  }

  const code = b.fin(tel.errs);
  await nav.close();
  process.exit(code);
})();
