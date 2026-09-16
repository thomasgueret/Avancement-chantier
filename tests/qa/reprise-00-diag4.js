// Diagnostic : le redémarrage a-t-il VRAIMENT lieu, et que devient un envoi
// en attente signalé seulement par `_hasPendingPush` (fusion où le local gagne,
// aucune marque posée) ?
const { chromium } = require('playwright');
const { CHROME, nouveauServeur, ouvrirAppareil, redemarrer, saisir, sonde, serveurProgress, dormir } = require('./reprise-lib.js');
const SEED = require('../seeds/liss.js');

const remettreAZero = (page) => page.evaluate(() => {
  clearTimeout(syncPushTimer); clearTimeout(syncRetryTimer);
  syncRetryTimer = null; syncRetryDelai = 0;
  _hasPendingPush = false; state.syncPendingSince = 0;
  const brut = JSON.parse(localStorage.getItem('chantier_v1') || '{}');
  brut.syncPendingSince = 0;
  localStorage.setItem('chantier_v1', JSON.stringify(brut));
});

(async () => {
  const nav = await chromium.launch({ executablePath: CHROME });
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel' });
  await dormir(2400);
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc', trace: true });
  await dormir(2400);
  await remettreAZero(tel.page); await remettreAZero(pc.page);

  srv.latenceEcritureMs = 5000;
  await saisir(tel.page, 'z21', 'tIso', 55);
  await dormir(2300);
  srv.latenceEcritureMs = 0;
  await saisir(pc.page, 'z13', 'tPar', 65);
  await dormir(2300);
  await dormir(4000);
  console.log('serveur après vol :', JSON.stringify(serveurProgress(srv).z13), JSON.stringify(serveurProgress(srv).z21));

  srv.enPanneEcriture = true;
  await pc.page.evaluate(async () => { try { await doSyncPull(); } catch (e) {} });
  await dormir(600);
  console.log('PC après fusion :', JSON.stringify(await sonde(pc.page)));
  await pc.page.evaluate(() => { window.__marqueur = 'AVANT_RELOAD'; });
  await dormir(2600);
  console.log('PC après echec  :', JSON.stringify(await sonde(pc.page)));

  await redemarrer(pc, 2000);
  const m = await pc.page.evaluate(() => window.__marqueur || null);
  console.log('marqueur après redémarrage (null = la page a bien rechargé) :', m);
  console.log('PC redémarré    :', JSON.stringify(await sonde(pc.page)));
  const brut = await pc.page.evaluate(() => JSON.parse(localStorage.getItem('chantier_v1')).syncPendingSince);
  console.log('stockage syncPendingSince :', brut);
  console.log('PC local z13 :', JSON.stringify(await pc.page.evaluate(() => state.taskProgress.z13)));
  console.log('serveur z13  :', JSON.stringify(serveurProgress(srv).z13));

  srv.enPanneEcriture = false;
  for (let i = 0; i < 12; i++) {
    await dormir(2000);
    console.log('t+' + (i * 2 + 2) + 's serveur z13=' + JSON.stringify(serveurProgress(srv).z13)
      + ' sonde=' + JSON.stringify(await sonde(pc.page)));
    if (serveurProgress(srv).z13 && serveurProgress(srv).z13.tPar === 65) break;
  }
  await nav.close();
})();
