// (8) La pastille, cas par cas. Et l'évènement `online` : il doit relancer
//     l'envoi DÈS QU'IL Y A QUELQUE CHOSE EN ATTENTE, quel que soit le statut
//     affiché — c'est le correctif du défaut n° 2 de la v1.87.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, saisir, sonde, serveurProgress,
  bilan, dormir,
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
const emettre = (page, nom) => page.evaluate((n) => window.dispatchEvent(new Event(n)), nom);
const chipInfo = (page) => page.evaluate(() => {
  const c = document.getElementById('syncchip');
  return { txt: c.textContent, cls: c.className, titre: c.title, cache: c.hidden };
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
  console.log('=== A. La pastille, état par état ===');
  await remettreAZero(tel.page);
  let c = await chipInfo(tel.page);
  console.log('   au repos :', JSON.stringify(c));
  b.chk('la pastille est visible quand la synchro est configurée', c.cache === false, c.cache);
  b.chk('au repos : « Synchronisé »', /Synchronisé/.test(c.txt), c.txt);

  // hors-ligne, RIEN en attente
  await emettre(tel.page, 'offline');
  await dormir(150);
  c = await chipInfo(tel.page);
  console.log('   hors-ligne sans rien en attente :', JSON.stringify(c));
  b.chk('hors-ligne sans rien en attente : « Hors-ligne »', /Hors-ligne/.test(c.txt), c.txt);

  // hors-ligne AVEC quelque chose en attente : l'attente doit primer
  srv.enPanne = true;
  await saisir(tel.page, 'z22', 'mPose', 30);
  await dormir(150);
  c = await chipInfo(tel.page);
  console.log('   hors-ligne avec une saisie en attente :', JSON.stringify(c));
  b.chk('hors-ligne + saisie en attente : c\'est « Non envoyé » qui s\'affiche',
    /Non envoyé/.test(c.txt), c.txt);
  b.chk('la classe CSS traduit l\'attente', /is-pending/.test(c.cls), c.cls);
  b.chk('l\'infobulle explique que la donnée est sur l\'appareil et comment réessayer',
    /enregistrées sur cet appareil/i.test(c.titre) && /réessayer/i.test(c.titre), c.titre);

  // après l'échec : statut error, mais l'attente prime encore
  await dormir(2200);
  let s = await sonde(tel.page);
  c = await chipInfo(tel.page);
  console.log('   après échec :', JSON.stringify({ statut: s.statut, chip: c.txt }));
  b.chk('statut « error » mais la pastille dit toujours « Non envoyé »',
    s.statut === 'error' && /Non envoyé/.test(c.txt), { statut: s.statut, chip: c.txt });

  // =====================================================================
  console.log('\n=== B. `online` relance l\'envoi quel que soit le statut ===');
  srv.enPanne = false;
  s = await sonde(tel.page);
  const delaiAvant = s.retryDelai;
  const ecr0 = srv.ecritures;
  const t0 = Date.now();
  await emettre(tel.page, 'online');
  let ok = false;
  while (Date.now() - t0 < 4000) {
    await dormir(150);
    if ((serveurProgress(srv).z22 || {}).mPose === 30) { ok = true; break; }
  }
  console.log('   envoi après `online` en ' + (Date.now() - t0) + ' ms (délai de reprise en cours : '
    + delaiAvant + ' ms)');
  b.chk('`online` provoque un envoi IMMÉDIAT, sans attendre la reprise',
    ok && Date.now() - t0 < 3000, { delaiMs: Date.now() - t0, ecritures: srv.ecritures, ecr0 });
  await dormir(500);
  s = await sonde(tel.page);
  b.chk('`online` a remis le délai de reprise à zéro', s.retryDelai === 0, s.retryDelai);
  b.chk('la reprise est désarmée', s.retryArme === false, s.retryArme);
  c = await chipInfo(tel.page);
  b.chk('la pastille redevient verte, et la donnée est bien sur le serveur',
    /Synchronisé/.test(c.txt) && (serveurProgress(srv).z22 || {}).mPose === 30,
    { chip: c.txt, distant: serveurProgress(srv).z22 });
  b.chk('l\'infobulle du repos propose de forcer une synchro',
    /forcer une synchronisation/i.test(c.titre), c.titre);

  // =====================================================================
  console.log('\n=== C. `online` sans rien en attente n\'écrit rien ===');
  await remettreAZero(tel.page);
  const ecr1 = srv.ecritures;
  await emettre(tel.page, 'online');
  await dormir(1200);
  b.chk('aucune écriture inutile sur `online` quand rien n\'est en attente',
    srv.ecritures === ecr1, { avant: ecr1, apres: srv.ecritures });

  // =====================================================================
  console.log('\n=== D. `online` alors que le statut affiché est « Hors-ligne » ===');
  // Le cas du v1.87 : la bascule du navigateur ne suffisait pas, il fallait
  // aussi que le statut soit « offline ». On vérifie les deux chemins.
  srv.enPanne = true;
  await saisir(tel.page, 'z23', 'mPose', 85);
  await emettre(tel.page, 'offline');
  await dormir(2200);
  s = await sonde(tel.page);
  console.log('   statut affiché :', s.statut, '| pastille :', s.chip);
  srv.enPanne = false;
  const t1 = Date.now();
  await emettre(tel.page, 'online');
  ok = false;
  while (Date.now() - t1 < 4000) {
    await dormir(150);
    if ((serveurProgress(srv).z23 || {}).mPose === 85) { ok = true; break; }
  }
  b.chk('le retour de réseau signalé par le navigateur envoie tout de suite', ok,
    { delaiMs: Date.now() - t1, distant: serveurProgress(srv).z23 });
  s = await sonde(tel.page);
  b.chk('le statut « offline » est repassé à un statut normal',
    s.statut !== 'offline', s.statut);
  b.chk('pastille verte', /Synchronisé/.test(s.chip || ''), s.chip);

  // =====================================================================
  console.log('\n=== E. Un clic sur la pastille force la synchro ===');
  srv.enPanne = true;
  await saisir(tel.page, 'z21', 'mFin', 15);
  await dormir(2200);
  srv.enPanne = false;
  const t2 = Date.now();
  await tel.page.click('#syncchip');
  ok = false;
  while (Date.now() - t2 < 6000) {
    await dormir(150);
    if ((serveurProgress(srv).z21 || {}).mFin === 15) { ok = true; break; }
  }
  b.chk('le clic sur la pastille envoie la saisie en attente', ok,
    { delaiMs: Date.now() - t2, distant: serveurProgress(srv).z21 });
  await dormir(700);
  s = await sonde(tel.page);
  b.chk('après le clic, plus rien en attente',
    s.hasPendingPush === false && s.memPending === 0, { p: s.hasPendingPush, m: s.memPending });
  b.chk('pastille verte après le clic', /Synchronisé/.test(s.chip || ''), s.chip);

  const code = b.fin(tel.errs);
  await nav.close();
  process.exit(code);
})();
