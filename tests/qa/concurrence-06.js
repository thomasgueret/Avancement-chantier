// AXE CONCURRENCE — 06. Une SAISIE pendant qu'une fusion distante s'applique.
//
// `applyRemoteStateMerge` calcule d'abord ce qu'elle va écrire (1er passage),
// puis fait `await createLocalBackup(...)`, puis écrit `state.taskProgress =
// fusion.valeurs` EN BLOC. Entre le calcul et l'écriture il y a un `await` :
// l'utilisateur a tout le temps de toucher une cellule. Sa saisie est-elle
// dans le bloc écrit ? (non : il a été calculé avant elle)
//
// Trois prises :
//   A. saisie pendant l'attente RÉELLE de la sauvegarde IndexedDB (setTimeout 0)
//   B. même chose, mais la fenêtre est tenue ouverte à la main (porte sur
//      createLocalBackup) — pour prouver le mécanisme sans dépendre du tempo
//   C. saisie pendant que `_syncApplying` est vrai : que fait `save()` ?
const { chromium } = require('playwright');
const L = require('./concurrence-lib.js');
const SEED = require('../seeds/liss.js');

const MAINTENANT = Date.now();
// Un état distant qui apporte une cellule fraîche, donc une fusion à appliquer.
const distant = (z, t, v) => ({
  taskProgress: { [z]: { [t]: v } },
  taskProgressAt: { [z]: { [t]: MAINTENANT } },
  zoneUpdated: { [z]: MAINTENANT },
  syncKeyStamps: { taskProgress: MAINTENANT, zoneUpdated: MAINTENANT },
});

(async () => {
  const b = L.bilan();
  const nav = await chromium.launch({ executablePath: L.CHROME });
  const errs = [];
  const srv = L.nouveauServeur();

  const app = await L.ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel' });
  await L.isoler(app.page);

  console.log('=== A. Saisie pendant l\'attente réelle de la sauvegarde de sécurité ===');
  const a = await app.page.evaluate(async ([rem, ts]) => {
    const trace = [];
    const vraiSave = window.save;
    window.save = function () { trace.push('save(applying=' + _syncApplying + ')'); return vraiSave.apply(this, arguments); };
    const p = applyRemoteStateMerge(rem, ts);      // NON attendu
    setTimeout(() => {                              // pendant l'await du backup
      trace.push('saisie(applying=' + _syncApplying + ')');
      setProgress('z23', 'tOss', 35);
    }, 0);
    const r = await p;
    window.save = vraiSave;
    return {
      trace, r,
      z23: JSON.parse(JSON.stringify(state.taskProgress.z23 || null)),
      z23at: JSON.parse(JSON.stringify((state.taskProgressAt || {}).z23 || null)),
      z11: JSON.parse(JSON.stringify(state.taskProgress.z11 || null)),
      pending: state.syncPendingSince, stoPending: (JSON.parse(localStorage.getItem('chantier_v1') || '{}')).syncPendingSince,
      stampTP: state.syncKeyStamps.taskProgress,
    };
  }, [distant('z11', 'tOss', 100), MAINTENANT]);
  console.log('   ordre observé :', JSON.stringify(a.trace));
  console.log('   fusion :', JSON.stringify(a.r), '| z11 après fusion :', JSON.stringify(a.z11));
  console.log('   z23 (la saisie de l\'utilisateur) :', JSON.stringify(a.z23), '| son horodatage :', JSON.stringify(a.z23at));
  const saisiePendant = a.trace.some(x => x.startsWith('saisie')) &&
    a.trace.indexOf(a.trace.find(x => x.startsWith('saisie'))) < a.trace.length - 1;
  console.log('   la saisie est-elle tombée AVANT la fin de la fusion ?', saisiePendant);
  b.chk('la fusion distante est bien appliquée (z11 = 100)', (a.z11 || {}).tOss === 100, a.z11);
  b.chk('A. la saisie faite pendant la fusion SURVIT', (a.z23 || {}).tOss === 35, a.z23);
  b.chk('A. son horodatage de cellule survit aussi', (a.z23at || {}).tOss > 0, a.z23at);

  console.log('\n=== B. Même chose, fenêtre tenue ouverte à la main ===');
  const app2 = await L.ouvrirAppareil(nav, srv, 'tel2', { seed: SEED, deviceId: 'tel2' });
  await L.isoler(app2.page);
  const bb = await app2.page.evaluate(async ([rem, ts]) => {
    const trace = [];
    const vrai = window.createLocalBackup;
    let ouvrir;
    const porte = new Promise(r => { ouvrir = r; });
    window.createLocalBackup = async (raison) => {
      trace.push('backup:debut');
      await porte;                                  // fenêtre grande ouverte
      trace.push('backup:fin');
      return vrai(raison);
    };
    const p = applyRemoteStateMerge(rem, ts);
    await new Promise(r => setTimeout(r, 50));      // on est dans la fenêtre
    trace.push('saisie(applying=' + _syncApplying + ')');
    setProgress('z22', 'mPose', 2, true);           // saisie à la pièce
    const apresSaisie = JSON.parse(JSON.stringify(state.taskProgress.z22 || null));
    const pendantPending = state.syncPendingSince;
    ouvrir();
    const r = await p;
    window.createLocalBackup = vrai;
    return {
      trace, r, apresSaisie, pendantPending,
      z22: JSON.parse(JSON.stringify(state.taskProgress.z22 || null)),
      z22at: JSON.parse(JSON.stringify((state.taskProgressAt || {}).z22 || null)),
      z12: JSON.parse(JSON.stringify(state.taskProgress.z12 || null)),
      pending: state.syncPendingSince,
      stoP: (JSON.parse(localStorage.getItem('chantier_v1') || '{}')).syncPendingSince,
      stoZ22: ((JSON.parse(localStorage.getItem('chantier_v1') || '{}').taskProgress || {}).z22) || null,
    };
  }, [distant('z12', 'tPar', 40), MAINTENANT]);
  console.log('   ordre observé :', JSON.stringify(bb.trace));
  console.log('   juste après la saisie, z22 =', JSON.stringify(bb.apresSaisie),
    '| en attente =', bb.pendantPending);
  console.log('   après la fin de la fusion, z22 =', JSON.stringify(bb.z22),
    '| horodatage =', JSON.stringify(bb.z22at));
  console.log('   dans le localStorage : z22 =', JSON.stringify(bb.stoZ22), '| en attente =', bb.stoP);
  console.log('   z12 (apport distant) =', JSON.stringify(bb.z12), '| fusion :', JSON.stringify(bb.r));
  b.chk('B. la fusion distante est appliquée', (bb.z12 || {}).tPar === 40, bb.z12);
  b.chk('B. la saisie était bien enregistrée avant la fin de la fusion',
    (bb.apresSaisie || {}).mPose === 2, bb.apresSaisie);
  b.chk('B. la saisie SURVIT à la fin de la fusion', (bb.z22 || {}).mPose === 2, bb.z22);
  b.chk('B. la saisie est dans le stockage local après la fusion',
    (bb.stoZ22 || {}).mPose === 2, bb.stoZ22);
  b.chk('B. si la saisie a disparu, l\'appareil sait au moins qu\'il reste à envoyer',
    (bb.z22 || {}).mPose === 2 || bb.stoP > 0, { z22: bb.z22, stoP: bb.stoP });

  console.log('\n=== C. Ce que fait save() pendant _syncApplying (sonde directe) ===');
  const c = await app2.page.evaluate(() => {
    const avant = { pending: state.syncPendingSince, ts: state.syncTimestamp, stamp: state.syncKeyStamps.taskProgress };
    _syncApplying = true;
    setProgress('z21', 'tPar', 15);                 // saisie exactement pendant
    const pendant = { pending: state.syncPendingSince, ts: state.syncTimestamp, stamp: state.syncKeyStamps.taskProgress, hasPending: _hasPendingPush };
    _syncApplying = false;
    const sto = JSON.parse(localStorage.getItem('chantier_v1') || '{}');
    return { avant, pendant, valeur: (state.taskProgress.z21 || {}).tPar,
      stoValeur: ((sto.taskProgress || {}).z21 || {}).tPar, stoPending: sto.syncPendingSince,
      stoStamp: (sto.syncKeyStamps || {}).taskProgress };
  });
  console.log('   avant  :', JSON.stringify(c.avant));
  console.log('   pendant:', JSON.stringify(c.pendant));
  console.log('   valeur en mémoire :', c.valeur, '| dans le stockage :', c.stoValeur);
  console.log('   marque « à envoyer » dans le stockage :', c.stoPending,
    '| horodatage de clé taskProgress :', c.stoStamp);
  b.chk('C. la saisie faite pendant _syncApplying est bien écrite en local', c.stoValeur === 15, c.stoValeur);
  b.chk('C. elle est marquée « reste à envoyer »', c.stoPending > 0, c.stoPending);
  b.chk('C. l\'horodatage de clé taskProgress est rafraîchi (sinon elle perd tout arbitrage)',
    c.stoStamp > c.avant.stamp, { avant: c.avant.stamp, apres: c.stoStamp });

  for (const x of [app, app2]) errs.push(...x.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
