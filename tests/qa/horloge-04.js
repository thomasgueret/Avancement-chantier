// AXE « horloge » — 04 : la garde anti-écrasement de doSyncPush et
// `syncLastSeenRemoteTs` face à un updated_at qui vient de l'horloge locale.
//
// `updated_at` est écrit depuis `state.syncTimestamp`. Et à la fin d'une
// fusion, `applyRemoteStateMerge` fait
//     state.syncTimestamp = Math.max(state.syncTimestamp, remoteTs)
// — donc un appareil à l'heure qui fusionne le relevé d'un téléphone EN AVANCE
// adopte l'horodatage futur de celui-ci. Le push « de convergence » qui suit
// (localWins > 0 → schedulePush) réécrit alors la ligne partagée avec
// EXACTEMENT le même `updated_at`. Pour tous les autres appareils, la garde
// `headTs === syncLastSeenRemoteTs` dit « déjà vue » : ils n'intègrent jamais
// cette version.
//
// NB : ici on ne coupe PAS schedulePush (ce serait masquer le mécanisme
// testé) ; on coupe seulement le pull périodique de 20 s, et on pilote
// l'attente de l'anti-rebond à la main.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, lireTout, stamps,
  saisir, synchroniser, bilan, isoler, dormir,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const H = 3600000;
// Coupe le pull périodique et la reprise, MAIS garde l'anti-rebond d'envoi.
const isolerSaufPush = (page) => page.evaluate(() => {
  clearInterval(syncPollTimer); clearTimeout(syncPollTimer); syncPollTimer = null;
  clearTimeout(syncRetryTimer); syncRetryTimer = null;
});

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];

  // ---------------------------------------------------------------------
  console.log('=== A. La garde relit updated_at : détecte-t-elle encore un changement ? ===');
  {
    const srv = nouveauServeur();
    const tel = await ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel', decalageMs: +H });
    const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
    await isoler(tel.page); await isoler(pc.page);
    await saisir(pc.page, 'z23', 'mPose', 25);
    await synchroniser(pc.page);
    const vuPc = (await stamps(pc.page)).vu;
    await saisir(tel.page, 'z11', 'tOss', 100);
    await synchroniser(tel.page);   // le téléphone pré-fusionne (garde) puis pousse
    const telTout = await lireTout(tel.page);
    b.chk('la garde a fait fusionner le téléphone avant son envoi (z23 conservé)',
      (telTout.z23 || {}).mPose === 25, telTout.z23);
    b.chk('le relevé du PC n\'est pas effacé du serveur par le push du téléphone',
      ((srv.ligne.state.taskProgress.z23) || {}).mPose === 25, srv.ligne.state.taskProgress.z23);
    console.log('   updated_at serveur :', srv.ligne.updated_at, '| vu par le PC avant :', new Date(vuPc).toISOString());
    errs.push(...tel.errs, ...pc.errs);
    await tel.ctx.close(); await pc.ctx.close();
  }

  // ---------------------------------------------------------------------
  console.log('\n=== B. Le piège du « déjà vu » : updated_at futur réécrit à l\'identique ===');
  {
    const srv = nouveauServeur();
    const tel = await ouvrirAppareil(nav, srv, 'tel', {
      seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 }, decalageMs: +H,
    });
    const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
    await isoler(tel.page);            // le téléphone : piloté à la main
    await isolerSaufPush(pc.page);     // le PC : anti-rebond d'envoi RÉEL

    // 1) Le PC relève z22/mPose = 50 dans un bâtiment sans réseau.
    srv.enPanne = true;
    await saisir(pc.page, 'z22', 'mPose', 50);
    await dormir(2200);                // l'anti-rebond part et échoue
    srv.enPanne = false;
    const st1 = await stamps(pc.page);
    console.log('   PC : saisie en attente ?', st1.enAttente > 0, '| syncTimestamp =', st1.syncTimestamp);

    // 2) Le téléphone EN AVANCE relève et pousse : la ligne prend un
    //    updated_at dans le futur.
    await saisir(tel.page, 'z11', 'tOss', 100);
    await synchroniser(tel.page);
    const updatedFutur = srv.ligne.updated_at;
    console.log('   updated_at écrit par le téléphone (futur) :', updatedFutur);
    b.chk('le téléphone en avance écrit un updated_at dans le futur',
      new Date(updatedFutur).getTime() > Date.now() + 60000, updatedFutur);

    // 3) Le PC tire : il fusionne, adopte le syncTimestamp futur, et pousse
    //    tout seul (localWins) — on laisse l'anti-rebond faire son travail.
    await pc.page.evaluate(() => doSyncPull());
    await dormir(2500);
    const st2 = await stamps(pc.page);
    console.log('   PC après fusion : syncTimestamp =', st2.syncTimestamp,
      '(futur ?', st2.syncTimestamp > Date.now(), ') | vu =', st2.vu);
    b.chk('le PC à l\'heure adopte le syncTimestamp FUTUR du téléphone',
      st2.syncTimestamp > Date.now() + 60000, st2);
    console.log('   journal des écritures serveur :', JSON.stringify(srv.journal));
    b.chk('le PC a bien poussé son relevé (z22) vers le serveur',
      ((srv.ligne.state.taskProgress.z22) || {}).mPose === 50, srv.ligne.state.taskProgress.z22);
    b.chk('le PC a réécrit la ligne avec le MÊME updated_at que le téléphone',
      srv.ligne.updated_at === updatedFutur,
      { serveur: srv.ligne.updated_at, telephone: updatedFutur });

    // 4) Le téléphone tire : voit-il le relevé du PC ?
    const lecturesAvant = srv.lectures;
    await tel.page.evaluate(() => doSyncPull());
    await dormir(300);
    const telTout = await lireTout(tel.page);
    console.log('   lectures serveur consommées par ce pull :', srv.lectures - lecturesAvant,
      '(1 = arrêt sur la garde « déjà vu », 2 = état complet lu)');
    console.log('   TÉLÉPHONE : z22 =', JSON.stringify(telTout.z22 || null));
    b.chk('le téléphone intègre le relevé du PC (z22/mPose = 50)',
      (telTout.z22 || {}).mPose === 50, telTout.z22 || null);

    // 5) Et le téléphone, en poussant sa saisie suivante, efface-t-il le
    //    relevé du PC de la ligne partagée ?
    await saisir(tel.page, 'z13', 'tPar', 10);
    await synchroniser(tel.page);
    console.log('   serveur après le push suivant du téléphone : z22 =',
      JSON.stringify(srv.ligne.state.taskProgress.z22 || null));
    b.chk('le relevé du PC est toujours sur le serveur après le push du téléphone',
      ((srv.ligne.state.taskProgress.z22) || {}).mPose === 50,
      srv.ligne.state.taskProgress.z22 || null);

    // 6) Le PC peut-il encore le récupérer ?
    await pc.page.evaluate(() => doSyncPull());
    await dormir(2500);
    const pcTout = await lireTout(pc.page);
    b.chk('le PC garde son propre relevé localement quoi qu\'il arrive',
      (pcTout.z22 || {}).mPose === 50, pcTout.z22 || null);
    console.log('   serveur final : z22 =', JSON.stringify(srv.ligne.state.taskProgress.z22 || null));

    // 7) Une NOUVELLE saisie du PC (qui remet son syncTimestamp au temps réel)
    //    débloque-t-elle la situation ?
    await saisir(pc.page, 'z23', 'mFin', 15);
    await dormir(2500);
    console.log('   updated_at après la saisie suivante du PC :', srv.ligne.updated_at);
    await tel.page.evaluate(() => doSyncPull());
    await dormir(300);
    const telTout2 = await lireTout(tel.page);
    console.log('   TÉLÉPHONE après cette nouvelle saisie du PC : z22 =', JSON.stringify(telTout2.z22 || null));
    b.chk('il faut une saisie SUPPLÉMENTAIRE du PC pour que le téléphone voie enfin z22',
      (telTout2.z22 || {}).mPose === 50, telTout2.z22 || null);

    // Ce que voit l'utilisateur du téléphone pendant tout ce temps.
    const chip = await tel.page.evaluate(() => {
      const c = document.getElementById('syncchip');
      return { txt: c && c.textContent, statut: state.syncStatus, enAttente: state.syncPendingSince };
    });
    console.log('   pastille du téléphone :', JSON.stringify(chip));
    b.chk('le téléphone n\'affiche pas « Synchronisé » alors qu\'il ignore le relevé du PC',
      !((telTout.z22 || {}).mPose !== 50 && /Synchronis/.test(chip.txt || '')), chip);

    errs.push(...tel.errs, ...pc.errs);
    await tel.ctx.close(); await pc.ctx.close();
  }

  // ---------------------------------------------------------------------
  console.log('\n=== C. Horloge en RETARD : le relevé du téléphone devient invisible ===');
  // Le téléphone a une horloge en retard d'une heure. Il n'a JAMAIS vu la
  // version du serveur (cas du départ au chantier), donc son push
  // pré-fusionne ; `syncTimestamp = Math.max(local, remoteTs)` le hisse alors
  // EXACTEMENT à l'updated_at que le PC vient d'écrire — et qu'il a déjà vu.
  {
    const srv = nouveauServeur();
    const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
    const tel = await ouvrirAppareil(nav, srv, 'tel', {
      seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 }, decalageMs: -H,
    });
    await isoler(pc.page); await isoler(tel.page);
    await saisir(pc.page, 'z11', 'tPar', 60);
    await synchroniser(pc.page);
    const t1 = srv.ligne.updated_at;
    await saisir(tel.page, 'z21', 'mFin', 35);   // le relevé du chantier
    await synchroniser(tel.page);
    const t2 = srv.ligne.updated_at;
    console.log('   updated_at : PC =', t1, '-> après push du téléphone en retard =', t2);
    b.chk('le relevé du téléphone est bien arrivé sur le serveur',
      ((srv.ligne.state.taskProgress.z21) || {}).mFin === 35, srv.ligne.state.taskProgress.z21);
    b.chk('le téléphone en retard réécrit la ligne avec un updated_at DÉJÀ VU par le PC',
      t2 === t1, { t1, t2 });
    const lect = srv.lectures;
    await pc.page.evaluate(() => doSyncPull());
    await dormir(200);
    const pcTout = await lireTout(pc.page);
    console.log('   lectures consommées par le pull du PC :', srv.lectures - lect,
      '| PC : z21 =', JSON.stringify(pcTout.z21 || null));
    b.chk('le PC voit le relevé du téléphone en retard',
      (pcTout.z21 || {}).mFin === 35, pcTout.z21 || null);
    const chipPc = await pc.page.evaluate(() => {
      const c = document.getElementById('syncchip');
      return { txt: c && c.textContent, statut: state.syncStatus };
    });
    console.log('   pastille du PC :', JSON.stringify(chipPc));

    // Et la saisie suivante du PC efface-t-elle le relevé du téléphone
    // de la ligne partagée ?
    await saisir(pc.page, 'z12', 'tPar', 20);
    await synchroniser(pc.page);
    console.log('   serveur après la saisie suivante du PC : z21 =',
      JSON.stringify(srv.ligne.state.taskProgress.z21 || null));
    b.chk('le relevé du téléphone survit sur le serveur à la saisie suivante du PC',
      ((srv.ligne.state.taskProgress.z21) || {}).mFin === 35,
      srv.ligne.state.taskProgress.z21 || null);
    const chipTel = await tel.page.evaluate(() => {
      const c = document.getElementById('syncchip');
      return { txt: c && c.textContent, enAttente: state.syncPendingSince };
    });
    console.log('   pastille du téléphone pendant ce temps :', JSON.stringify(chipTel));
    b.chk('le téléphone n\'affiche pas « Synchronisé » si son relevé a disparu du serveur',
      !(((srv.ligne.state.taskProgress.z21) || {}).mFin !== 35 && /Synchronis/.test(chipTel.txt || '')),
      chipTel);

    // Un appareil qui rejoint le chantier maintenant (nouveau poste, tablette
    // du conducteur de travaux) : que reçoit-il ?
    const neuf = await ouvrirAppareil(nav, srv, 'neuf', { deviceId: 'neuf' });
    await isoler(neuf.page);
    await neuf.page.evaluate(() => doSyncPull(true));
    await dormir(300);
    const neufTout = await lireTout(neuf.page);
    console.log('   appareil NEUF après sa première synchro : z21 =', JSON.stringify(neufTout.z21 || null));
    b.chk('un appareil qui rejoint le chantier reçoit le relevé du téléphone en retard',
      (neufTout.z21 || {}).mFin === 35, neufTout.z21 || null);
    errs.push(...neuf.errs);
    await neuf.ctx.close();
    errs.push(...pc.errs, ...tel.errs);
    await pc.ctx.close(); await tel.ctx.close();
  }

  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
