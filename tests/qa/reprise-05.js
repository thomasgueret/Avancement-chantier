// (6) Panne PERMANENTE : la reprise plafonne-t-elle à 60 s, ou tourne-t-elle
//     en boucle serrée ? Le timer est-il arrêté au succès, sans fuite ?
//
// On instrumente `doSyncPush` DANS LA PAGE (on remplace la liaison globale par
// une enveloppe qui horodate chaque appel) : c'est la seule façon de compter
// les TENTATIVES d'envoi sans les confondre avec les lectures du pull
// périodique, qui tape le même point d'entrée serveur.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, saisir, sonde, serveurProgress,
  bilan, dormir,
} = require('./reprise-lib.js');
const SEED = require('../seeds/liss.js');

const instrumenter = (page) => page.evaluate(() => {
  window.__pushes = [];
  window.__pulls = [];
  const vraiPush = doSyncPush, vraiPull = doSyncPull;
  doSyncPush = function () { window.__pushes.push(Date.now()); return vraiPush.apply(this, arguments); };
  doSyncPull = function () { window.__pulls.push(Date.now()); return vraiPull.apply(this, arguments); };
});
const tentatives = (page) => page.evaluate(() => ({ pushes: window.__pushes.slice(), pulls: window.__pulls.slice() }));

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'tel', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 },
  });
  await dormir(2600);
  await instrumenter(tel.page);

  // =====================================================================
  console.log('=== A. 46 s de panne totale : cadence des tentatives ===');
  srv.enPanne = true;
  const t0 = Date.now();
  await saisir(tel.page, 'z22', 'mPose', 55);
  await dormir(46000);
  const { pushes, pulls } = await tentatives(tel.page);
  const rel = pushes.map(x => Math.round((x - t0) / 100) / 10);
  console.log('   tentatives d\'envoi (s depuis la saisie) :', JSON.stringify(rel));
  console.log('   écarts (s) :', JSON.stringify(rel.slice(1).map((v, i) => Math.round((v - rel[i]) * 10) / 10)));
  console.log('   pulls (s) :', JSON.stringify(pulls.map(x => Math.round((x - t0) / 100) / 10)));
  b.chk('il y a bien eu plusieurs tentatives d\'envoi', pushes.length >= 3, pushes.length);
  b.chk('AUCUNE boucle serrée : moins de 10 tentatives en 46 s',
    pushes.length < 10, { tentatives: pushes.length });
  const ecarts = rel.slice(1).map((v, i) => v - rel[i]);
  b.chk('les écarts entre tentatives croissent (délai doublant)',
    ecarts.length >= 2 && ecarts.every((v, i) => i === 0 || v >= ecarts[i - 1] - 0.5),
    ecarts);
  b.chk('aucun écart inférieur à 1,4 s (pas de martèlement)',
    ecarts.every(v => v >= 1.4), ecarts);
  let s = await sonde(tel.page);
  console.log('   sonde :', JSON.stringify(s));
  b.chk('le délai de reprise a grandi (≥ 20 s après 46 s de panne)',
    s.retryDelai >= 20000, s.retryDelai);
  b.chk('le délai de reprise ne dépasse jamais 60 s', s.retryDelai <= 60000, s.retryDelai);
  b.chk('la pastille est restée « Non envoyé » pendant toute la panne',
    /Non envoyé/.test(s.chip || ''), s.chip);
  b.chk('la marque d\'attente est toujours persistée', s.stoPending > 0, s.stoPending);

  // =====================================================================
  console.log('\n=== B. Le plafond de 60 s ===');
  const plafond = await tel.page.evaluate(() => {
    const suite = [];
    _hasPendingPush = true;
    syncRetryDelai = 0;
    for (let i = 0; i < 8; i++) { planifierReprise(); suite.push(syncRetryDelai); }
    clearTimeout(syncRetryTimer);
    return { suite, max: SYNC_RETRY_MAX_MS, min: SYNC_RETRY_MIN_MS };
  });
  console.log('   suite des délais :', JSON.stringify(plafond));
  b.chk('la suite est 5 s puis doublement', plafond.suite[0] === 5000 && plafond.suite[1] === 10000,
    plafond.suite.slice(0, 3));
  b.chk('la suite plafonne exactement à 60 s et n\'en bouge plus',
    plafond.suite[plafond.suite.length - 1] === 60000
    && plafond.suite.filter(v => v > 60000).length === 0, plafond.suite);

  // =====================================================================
  console.log('\n=== C. Pas de fuite : 6 appels d\'affilée = un seul timer ===');
  await tel.page.evaluate(() => { window.__pushes.length = 0; _hasPendingPush = true; syncRetryDelai = 0; });
  await tel.page.evaluate(() => { for (let i = 0; i < 6; i++) planifierReprise(); });
  // le dernier appel a posé un délai de 5*2^5 = 160 s → plafonné à 60 s : rien
  // ne doit tirer dans les 8 s qui suivent, et surtout pas six fois.
  await dormir(8000);
  const apresFuite = (await tentatives(tel.page)).pushes.length;
  console.log('   tentatives dans les 8 s :', apresFuite);
  b.chk('les appels successifs n\'accumulent pas de timers',
    apresFuite === 0, { tentatives: apresFuite });

  // =====================================================================
  console.log('\n=== D. Arrêt au succès, puis silence ===');
  await tel.page.evaluate(() => { syncRetryDelai = 0; arreterReprise(); window.__pushes.length = 0; });
  srv.enPanne = false;
  await tel.page.evaluate(() => { _hasPendingPush = true; planifierReprise(); });
  const t1 = Date.now();
  let ok = false;
  while (Date.now() - t1 < 20000) {
    await dormir(400);
    if ((serveurProgress(srv).z22 || {}).mPose === 55) { ok = true; break; }
  }
  b.chk('la reprise finit par envoyer la saisie', ok,
    { delaiMs: Date.now() - t1, distant: serveurProgress(srv).z22 });
  await dormir(700);
  s = await sonde(tel.page);
  b.chk('au succès, le timer de reprise est remis à null',
    s.retryArme === false, s.retryArme);
  b.chk('au succès, le délai de reprise est remis à zéro', s.retryDelai === 0, s.retryDelai);
  b.chk('la pastille repasse au vert', /Synchronisé/.test(s.chip || ''), s.chip);
  const nb = (await tentatives(tel.page)).pushes.length;
  await dormir(9000);
  const nb2 = (await tentatives(tel.page)).pushes.length;
  console.log('   tentatives après succès : ' + nb + ' -> ' + nb2);
  b.chk('aucune tentative fantôme dans les 9 s qui suivent le succès',
    nb2 === nb, { avant: nb, apres: nb2 });
  s = await sonde(tel.page);
  b.chk('rien ne reste en attente', s.hasPendingPush === false && s.memPending === 0,
    { p: s.hasPendingPush, m: s.memPending });

  const code = b.fin(tel.errs);
  await nav.close();
  process.exit(code);
})();
