// AXE CONCURRENCE — 12. Bout en bout, deux appareils réels : l'ouvrier saisit
// une cellule pendant que le pull périodique applique la fusion du collègue.
//
// Aucun mécanisme n'est remplacé ici : la sauvegarde de sécurité IndexedDB est
// la vraie, on l'OBSERVE seulement (un drapeau) pour savoir quand sa fenêtre
// est ouverte, et c'est dans cette vraie fenêtre que la saisie est faite.
//
// Ce qu'on vérifie ensuite : la saisie est-elle encore là, part-elle un jour,
// et l'application dit-elle quelque chose ?
const { chromium } = require('playwright');
const L = require('./concurrence-lib.js');
const SEED = require('../seeds/liss.js');

// Pose un drapeau pendant l'attente RÉELLE de createLocalBackup (sans la retarder).
const observerBackup = (page) => page.evaluate(() => {
  if (window.__obsBackup) return;
  window.__obsBackup = true;
  const vrai = window.createLocalBackup;
  window.__dansBackup = false;
  window.createLocalBackup = async (r) => {
    window.__dansBackup = true;
    try { return await vrai(r); } finally { window.__dansBackup = false; }
  };
});

(async () => {
  const b = L.bilan();
  const nav = await chromium.launch({ executablePath: L.CHROME });
  const errs = [];
  const srv = L.nouveauServeur();
  const tel = await L.ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 } });
  const pc = await L.ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await L.isoler(tel.page); await L.isoler(pc.page);
  await L.synchroniser(tel.page);
  await L.synchroniser(pc.page);
  await L.synchroniser(tel.page);
  await observerBackup(tel.page);

  console.log('=== Le collègue saisit et envoie ; le téléphone va tirer ===');
  await L.saisir(pc.page, 'z11', 'tIso', 85);
  await L.pousser(pc.page);
  console.log('   serveur z11 :', JSON.stringify(L.serveurProgress(srv).z11));

  console.log('\n=== Pendant la fusion, l\'ouvrier saisit z23 / tOss = 35 ===');
  const r = await tel.page.evaluate(async () => {
    const p = doSyncPull().then(() => 'pull ok', e => 'pull KO ' + e.message);
    // attend l'ouverture de la VRAIE fenêtre de sauvegarde
    const attendu = await new Promise(res => {
      let n = 0;
      const boucle = () => {
        if (window.__dansBackup) return res(true);
        if (++n > 2000) return res(false);
        setTimeout(boucle, 0);
      };
      boucle();
    });
    const applying1 = _syncApplying;
    setProgress('z23', 'tOss', 35);
    const justeApres = JSON.parse(JSON.stringify(state.taskProgress.z23 || null));
    const res = await p;
    return { attendu, applying1, justeApres, res,
      z23: JSON.parse(JSON.stringify(state.taskProgress.z23 || null)),
      z23at: JSON.parse(JSON.stringify((state.taskProgressAt || {}).z23 || null)),
      z11: JSON.parse(JSON.stringify(state.taskProgress.z11 || null)),
      has: _hasPendingPush, pending: state.syncPendingSince,
      sto: ((JSON.parse(localStorage.getItem('chantier_v1') || '{}').taskProgress || {}).z23) || null,
      stoPending: JSON.parse(localStorage.getItem('chantier_v1') || '{}').syncPendingSince,
      chip: (document.getElementById('syncchip') || {}).textContent };
  });
  console.log('   fenêtre de sauvegarde atteinte :', r.attendu, '| _syncApplying à cet instant :', r.applying1);
  console.log('   juste après la saisie, z23 =', JSON.stringify(r.justeApres));
  console.log('   après la fusion,      z23 =', JSON.stringify(r.z23), '| horodatage :', JSON.stringify(r.z23at));
  console.log('   dans le stockage,     z23 =', JSON.stringify(r.sto));
  console.log('   z11 (apport du collègue) =', JSON.stringify(r.z11));
  console.log('   pastille :', r.chip, '| en attente (mém/sto) :', r.pending, '/', r.stoPending);
  b.chk('la fenêtre de sauvegarde a bien été atteinte (le scénario est réel)', r.attendu === true);
  b.chk('la saisie était enregistrée avant la fin de la fusion', (r.justeApres || {}).tOss === 35, r.justeApres);
  b.chk('l\'apport du collègue est bien appliqué', (r.z11 || {}).tIso === 85, r.z11);
  b.chk('LA SAISIE DE L\'OUVRIER SURVIT à la fusion', (r.z23 || {}).tOss === 35, r.z23);
  b.chk('la saisie est dans le stockage local', (r.sto || {}).tOss === 35, r.sto);
  b.chk('si elle a disparu, la pastille ou la marque le signale',
    (r.z23 || {}).tOss === 35 || r.stoPending > 0 || /Non envoy/.test(r.chip || ''),
    { chip: r.chip, stoPending: r.stoPending });

  console.log('\n=== La saisie finit-elle sur le serveur ? (envoi, puis redémarrage) ===');
  await L.pousser(tel.page);
  console.log('   serveur z23 :', JSON.stringify(L.serveurProgress(srv).z23));
  await L.redemarrer(tel, 2600);
  await tel.page.waitForTimeout(1200);
  console.log('   après redémarrage — local z23 :', JSON.stringify((await L.lireTout(tel.page)).z23),
    '| serveur z23 :', JSON.stringify(L.serveurProgress(srv).z23));
  b.chk('la saisie de l\'ouvrier arrive sur le serveur',
    L.serveurCellule(srv, 'z23', 'tOss') === 35, L.serveurProgress(srv).z23);

  console.log('\n=== Et le collègue, la voit-il ? ===');
  await L.synchroniser(pc.page);
  const vpc = (await L.lireTout(pc.page)).z23 || {};
  console.log('   pc z23 :', JSON.stringify(vpc));
  b.chk('le collègue reçoit la saisie de l\'ouvrier', vpc.tOss === 35, vpc);

  for (const x of [tel, pc]) errs.push(...x.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
