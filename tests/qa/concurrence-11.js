// AXE CONCURRENCE — 11. RÉENTRANCE : deux réveils simultanés.
//
// `applyRemoteStateMerge` calcule ce qu'elle va écrire, attend la sauvegarde de
// sécurité, puis écrase `state.taskProgress` EN BLOC. Deux appels qui se
// chevauchent calculent donc tous les deux sur l'état d'AVANT, et le dernier à
// écrire efface l'apport du premier. Les deux réveils existent pour de vrai :
// l'évènement realtime et le pull périodique, ou — au démarrage — le push de
// reprise (qui fusionne via sa garde) et le pull initial, lancés en parallèle
// (`reprendreEnvoiEnAttente()` n'est pas attendu, app.js ~22415).
const { chromium } = require('playwright');
const L = require('./concurrence-lib.js');
const SEED = require('../seeds/liss.js');

const T = Date.now();
const etatDistant = (cells, ts) => {
  const tp = {}, at = {}, zu = {};
  for (const [z, t, v] of cells) {
    (tp[z] = tp[z] || {})[t] = v;
    (at[z] = at[z] || {})[t] = ts;
    zu[z] = ts;
  }
  return { taskProgress: tp, taskProgressAt: at, zoneUpdated: zu,
    syncKeyStamps: { taskProgress: ts, zoneUpdated: ts } };
};

(async () => {
  const b = L.bilan();
  const nav = await chromium.launch({ executablePath: L.CHROME });
  const errs = [];
  const srv = L.nouveauServeur();
  const app = await L.ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel' });
  await L.isoler(app.page);

  console.log('=== A. Deux applyRemoteStateMerge en parallèle (tempo naturel) ===');
  const a = await app.page.evaluate(async ([r1, r2, ts]) => {
    const res = await Promise.all([
      applyRemoteStateMerge(r1, ts), applyRemoteStateMerge(r2, ts + 1),
    ]);
    return { res,
      z11: JSON.parse(JSON.stringify(state.taskProgress.z11 || null)),
      z23: JSON.parse(JSON.stringify(state.taskProgress.z23 || null)),
      at11: JSON.parse(JSON.stringify((state.taskProgressAt || {}).z11 || null)),
      at23: JSON.parse(JSON.stringify((state.taskProgressAt || {}).z23 || null)),
      vu: state.syncLastSeenRemoteTs };
  }, [etatDistant([['z11', 'tOss', 100]], T), etatDistant([['z23', 'tPar', 45]], T + 1), T]);
  console.log('   fusions :', JSON.stringify(a.res));
  console.log('   z11 (apport de la 1re) :', JSON.stringify(a.z11), '| z23 (apport de la 2e) :', JSON.stringify(a.z23));
  b.chk('A. l\'apport de la 1re fusion est là', (a.z11 || {}).tOss === 100, a.z11);
  b.chk('A. l\'apport de la 2e fusion est là', (a.z23 || {}).tPar === 45, a.z23);
  b.chk('A. les horodatages de cellule suivent les valeurs',
    ((a.z11 || {}).tOss === undefined || (a.at11 || {}).tOss > 0)
    && ((a.z23 || {}).tPar === undefined || (a.at23 || {}).tPar > 0), { at11: a.at11, at23: a.at23 });

  console.log('\n=== B. Même chose, chevauchement forcé (porte sur la sauvegarde) ===');
  const app2 = await L.ouvrirAppareil(nav, srv, 'tel2', { seed: SEED, deviceId: 'tel2' });
  await L.isoler(app2.page);
  const bb = await app2.page.evaluate(async ([r1, r2, ts]) => {
    const trace = [];
    const vrai = window.createLocalBackup;
    let n = 0, ouvrir1;
    const porte1 = new Promise(r => { ouvrir1 = r; });
    window.createLocalBackup = async (raison) => {
      const i = ++n;
      trace.push('backup' + i + ':debut');
      if (i === 1) await porte1;               // la 1re fusion attend
      trace.push('backup' + i + ':fin');
      return vrai(raison);
    };
    const p1 = applyRemoteStateMerge(r1, ts);           // se bloque dans le backup
    await new Promise(r => setTimeout(r, 60));
    const p2 = applyRemoteStateMerge(r2, ts + 1);       // passe devant
    await p2;
    trace.push('2e appliquée, z23=' + JSON.stringify(state.taskProgress.z23 || null));
    ouvrir1();
    await p1;
    window.createLocalBackup = vrai;
    return { trace,
      z11: JSON.parse(JSON.stringify(state.taskProgress.z11 || null)),
      z23: JSON.parse(JSON.stringify(state.taskProgress.z23 || null)),
      stamp: state.syncKeyStamps.taskProgress };
  }, [etatDistant([['z11', 'tOss', 100]], T), etatDistant([['z23', 'tPar', 45]], T + 1), T]);
  console.log('   ordre :', JSON.stringify(bb.trace));
  console.log('   z11 :', JSON.stringify(bb.z11), '| z23 :', JSON.stringify(bb.z23));
  b.chk('B. l\'apport de la fusion RETARDÉE est là', (bb.z11 || {}).tOss === 100, bb.z11);
  b.chk('B. l\'apport de la fusion RAPIDE survit à la fusion retardée',
    (bb.z23 || {}).tPar === 45, bb.z23);

  console.log('\n=== C. Deux doSyncPull en parallèle, la ligne change entre les deux ===');
  const srv3 = L.nouveauServeur();
  const tel = await L.ouvrirAppareil(nav, srv3, 'telC', { seed: SEED, deviceId: 'telC' });
  const pc = await L.ouvrirAppareil(nav, srv3, 'pcC', { seed: SEED, deviceId: 'pcC' });
  await L.isoler(tel.page); await L.isoler(pc.page);
  await L.saisir(pc.page, 'z11', 'tOss', 100);
  await L.pousser(pc.page);                   // v1 : z11
  const v1 = JSON.parse(JSON.stringify(srv3.ligne));
  // On bloque la PREMIÈRE lecture complète du téléphone.
  const porte = srv3.bloquer('telC', 'get', 'state, updated_at');
  const pull1 = L.tirer(tel.page);
  await porte.atteinte;
  await L.saisir(pc.page, 'z12', 'tPar', 60);
  await L.pousser(pc.page);                   // v2 : z11 + z12
  const pull2 = await L.tirer(tel.page);      // lit v2 et l'applique
  console.log('   pull2 :', pull2, '| tel voit z12 :', JSON.stringify((await L.lireTout(tel.page)).z12));
  const v2ligne = srv3.ligne;
  srv3.ligne = v1;                            // la réponse en retard porte v1
  porte.ouvrir();
  console.log('   pull1 :', await pull1);
  srv3.ligne = v2ligne;
  const vc = await L.lireTout(tel.page);
  const sc = await L.sonde(tel.page);
  console.log('   tel z11 :', JSON.stringify(vc.z11), '| z12 :', JSON.stringify(vc.z12));
  console.log('   sonde :', JSON.stringify(sc), '| ts serveur :', L.serveurTs(srv3));
  b.chk('C. la réponse en retard ne fait pas disparaître la version récente',
    (vc.z12 || {}).tPar === 60 && (vc.z11 || {}).tOss === 100, { z11: vc.z11, z12: vc.z12 });
  await L.tirer(tel.page);
  const vc2 = (await L.lireTout(tel.page)).z12 || {};
  console.log('   après une lecture de plus, z12 :', JSON.stringify(vc2));
  b.chk('C. une lecture supplémentaire rétablit l\'état complet', vc2.tPar === 60, vc2);

  console.log('\n=== D. Deux doSyncPush en parallèle sur le même appareil ===');
  const srv4 = L.nouveauServeur();
  const t4 = await L.ouvrirAppareil(nav, srv4, 'telD', { seed: SEED, deviceId: 'telD' });
  await L.isoler(t4.page);
  await L.synchroniser(t4.page);
  await L.saisir(t4.page, 'z21', 'tIso', 35);
  const ecr4 = srv4.ecritures;
  const r4 = await t4.page.evaluate(async () => {
    const rs = await Promise.all([
      doSyncPush().then(() => 'ok', e => 'KO ' + e.message),
      doSyncPush().then(() => 'ok', e => 'KO ' + e.message),
    ]);
    return { rs, pending: state.syncPendingSince, has: _hasPendingPush, statut: state.syncStatus };
  });
  console.log('   résultats :', JSON.stringify(r4), '| écritures :', srv4.ecritures - ecr4);
  console.log('   serveur z21 :', JSON.stringify(L.serveurProgress(srv4).z21));
  b.chk('D. deux envois simultanés n\'écrasent pas la saisie',
    L.serveurCellule(srv4, 'z21', 'tIso') === 35, L.serveurProgress(srv4).z21);
  b.chk('D. état final cohérent (rien en attente, statut idle)',
    r4.has === false && r4.statut === 'idle', r4);

  console.log('\n=== E. Envoi et lecture en parallèle (cas du démarrage) ===');
  const srv5 = L.nouveauServeur();
  const t5 = await L.ouvrirAppareil(nav, srv5, 'telE', { seed: SEED, deviceId: 'telE' });
  const p5 = await L.ouvrirAppareil(nav, srv5, 'pcE', { seed: SEED, deviceId: 'pcE' });
  await L.isoler(t5.page); await L.isoler(p5.page);
  await L.saisir(p5.page, 'z13', 'tOss', 70);
  await L.pousser(p5.page);                   // le serveur porte la saisie du PC
  await L.saisir(t5.page, 'z22', 'tIso', 25); // le téléphone a sa propre saisie
  const r5 = await t5.page.evaluate(async () => {
    const rs = await Promise.all([
      doSyncPush().then(() => 'push ok', e => 'push KO'),
      doSyncPull(true).then(() => 'pull ok', e => 'pull KO'),
    ]);
    return { rs, has: _hasPendingPush, statut: state.syncStatus };
  });
  await t5.page.waitForTimeout(200);
  const v5 = await L.lireTout(t5.page);
  const sp5 = L.serveurProgress(srv5);
  console.log('   ', JSON.stringify(r5));
  console.log('   tel z13 :', JSON.stringify(v5.z13), '| z22 :', JSON.stringify(v5.z22));
  console.log('   serveur z13 :', JSON.stringify(sp5.z13), '| z22 :', JSON.stringify(sp5.z22));
  b.chk('E. la saisie locale survit à l\'envoi+lecture simultanés', (v5.z22 || {}).tIso === 25, v5.z22);
  b.chk('E. la saisie distante est intégrée', (v5.z13 || {}).tOss === 70, v5.z13);
  b.chk('E. le serveur porte les deux saisies',
    (sp5.z13 || {}).tOss === 70 && (sp5.z22 || {}).tIso === 25, { z13: sp5.z13, z22: sp5.z22 });

  for (const x of [app, app2, tel, pc, t4, t5, p5]) errs.push(...x.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
