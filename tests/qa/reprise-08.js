// Conséquences des deux marques divergentes (mémoire / stockage) et de la
// garde anti-écrasement qui relit `updated_at` AVANT un envoi lent.
//
// A. Un envoi lent en vol écrase la saisie d'un autre appareil ; si cet
//    appareil est refermé, la saisie disparaît pour TOUT LE MONDE.
// B. La marque périmée du stockage relance un envoi inutile à CHAQUE
//    redémarrage, alors que rien n'est en attente.
// C. Le cas inverse : une fusion où le LOCAL gagne arme `_hasPendingPush`
//    sans poser de marque — et la marque du stockage vient d'être remise à 0
//    par la sauvegarde de la fusion. Fermeture → plus aucune reprise.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, redemarrer, saisir, sonde,
  serveurProgress, bilan, dormir,
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

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });

  // =====================================================================
  console.log('=== A. Écrasement par un envoi en vol, puis appareil refermé ===');
  {
    const srv = nouveauServeur();
    const tel = await ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 } });
    await dormir(2400);
    const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
    await dormir(2400);
    await remettreAZero(tel.page); await remettreAZero(pc.page);

    srv.latenceEcritureMs = 5000;
    await saisir(tel.page, 'z21', 'tIso', 55);       // envoi lent du téléphone
    await dormir(2300);
    srv.latenceEcritureMs = 0;
    await saisir(pc.page, 'z13', 'tPar', 65);        // le conducteur saisit sur le PC
    await dormir(2300);
    const pcSonde = await sonde(pc.page);
    console.log('   le PC se croit à jour :', JSON.stringify({ chip: pcSonde.chip, mem: pcSonde.memPending }));
    b.chk('le PC a poussé et affiche « Synchronisé »',
      (serveurProgress(srv).z13 || {}).tPar === 65 && /Synchronisé/.test(pcSonde.chip || ''),
      { distant: serveurProgress(srv).z13, chip: pcSonde.chip });
    // Le conducteur referme son PC, confiant.
    await pc.ctx.close();
    console.log('   PC fermé');
    await dormir(4000);                              // l'upsert du téléphone se termine
    console.log('   serveur :', JSON.stringify(serveurProgress(srv).z13));
    b.chk('[garde anti-écrasement] la saisie du PC n\'a pas été écrasée par l\'envoi en vol',
      (serveurProgress(srv).z13 || {}).tPar === 65, serveurProgress(srv).z13);
    // Le téléphone continue à travailler ; personne ne peut plus récupérer z13.
    await dormir(25000);
    const telVue = await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress)));
    console.log('   25 s plus tard — serveur :', JSON.stringify(serveurProgress(srv).z13),
      '| téléphone :', JSON.stringify(telVue.z13));
    b.chk('25 s plus tard, la saisie du PC est toujours récupérable sur le serveur',
      (serveurProgress(srv).z13 || {}).tPar === 65, serveurProgress(srv).z13);
    b.chk('25 s plus tard, le téléphone voit la saisie du PC',
      (telVue.z13 || {}).tPar === 65, telVue.z13);
    const s = await sonde(tel.page);
    b.chk('le téléphone n\'affiche rien d\'anormal (il croit tout savoir)',
      /Synchronisé/.test(s.chip || ''), s.chip);
    await tel.ctx.close();
  }

  // =====================================================================
  console.log('\n=== B. Marque périmée : un envoi inutile à chaque redémarrage ===');
  {
    const srv = nouveauServeur();
    const tel = await ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel' });
    await dormir(2600);
    await saisir(tel.page, 'z22', 'mPose', 45);
    await dormir(2600);
    let s = await sonde(tel.page);
    b.chk('la saisie est partie, rien en attente en mémoire',
      s.memPending === 0 && (serveurProgress(srv).z22 || {}).mPose === 45,
      { mem: s.memPending, distant: serveurProgress(srv).z22 });
    b.chk('[cas 9] le stockage garde la marque périmée', s.stoPending === 0, s.stoPending);

    const avantTout = JSON.stringify(await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress))));
    let inutiles = 0, recul = 0;
    for (let i = 1; i <= 3; i++) {
      const e0 = srv.ecritures, u0 = srv.ligne.updated_at;
      await redemarrer(tel, 2000);
      const apres = JSON.stringify(await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress))));
      const u1 = srv.ligne.updated_at;
      console.log('   redémarrage ' + i + ' : écritures ' + e0 + ' -> ' + srv.ecritures
        + ' | avancement inchangé : ' + (apres === avantTout)
        + ' | updated_at ' + u0 + ' -> ' + u1);
      if (srv.ecritures > e0) inutiles++;
      // tolérance : 1 ms d'écart vient de l'arrondi de la date du tout premier
      // save, ce n'est pas un recul significatif.
      if (new Date(u1).getTime() < new Date(u0).getTime() - 1) recul++;
    }
    b.chk('un redémarrage sans aucune modification ne doit provoquer aucune écriture',
      inutiles === 0, { redemarragesAvecEcriture: inutiles });
    b.chk('l\'horodatage `updated_at` du serveur ne recule jamais',
      recul === 0, { reculs: recul });
    await tel.ctx.close();
  }

  // =====================================================================
  console.log('\n=== C. Fusion où le local gagne : aucune marque posée ===');
  {
    const srv = nouveauServeur();
    const tel = await ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 } });
    await dormir(2400);
    const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
    await dormir(2400);
    await remettreAZero(tel.page); await remettreAZero(pc.page);

    // 1) Le téléphone part sur un envoi lent (5 s), qui figera son payload.
    srv.latenceEcritureMs = 5000;
    await saisir(tel.page, 'z21', 'tIso', 55);
    await dormir(2300);
    // 2) Le PC saisit et pousse pendant ce temps — avec succès.
    srv.latenceEcritureMs = 0;
    await saisir(pc.page, 'z13', 'tPar', 65);
    await dormir(2300);
    b.chk('le PC a poussé sa saisie', (serveurProgress(srv).z13 || {}).tPar === 65,
      serveurProgress(srv).z13);
    // 3) L'envoi du téléphone atterrit et écrase la ligne : z13 disparaît,
    //    z21.tIso apparaît.
    await dormir(4000);
    const apresVol = serveurProgress(srv);
    console.log('   serveur après l\'envoi en vol :', JSON.stringify({ z13: apresVol.z13, z21: apresVol.z21 }));

    // 4) Le PC fait sa lecture périodique : la fusion lui apporte z21.tIso
    //    (donc elle SAUVEGARDE) et constate que son z13 gagne (localWins).
    srv.enPanneEcriture = true;          // ses envois échoueront
    await pc.page.evaluate(async () => { try { await doSyncPull(); } catch (e) {} });
    await dormir(600);
    let sp = await sonde(pc.page);
    console.log('   PC après fusion :', JSON.stringify(sp));
    const pcLocal = await pc.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress)));
    b.chk('la fusion a bien apporté la cellule du téléphone au PC (il a sauvegardé)',
      (pcLocal.z21 || {}).tIso === 55, pcLocal.z21);
    b.chk('le PC détient toujours sa saisie z13', (pcLocal.z13 || {}).tPar === 65, pcLocal.z13);
    b.chk('le PC sait qu\'il a quelque chose à envoyer (`_hasPendingPush`)',
      sp.hasPendingPush === true, sp.hasPendingPush);
    // OBSERVATION (pas une trouvaille en soi) : dans ce chemin, AUCUNE marque
    // n'est posée — ni en mémoire, ni dans le stockage. `_hasPendingPush` seul
    // tient l'information. La question est donc : la reprise survit-elle
    // quand même à une fermeture ? (vérifié plus bas)
    console.log('   marques dans ce chemin : mémoire=' + sp.memPending + ' stockage=' + sp.stoPending
      + ' (aucune marque posée, seul `_hasPendingPush` porte l\'information)');
    b.chk('la pastille dit bien « Non envoyé » dans ce chemin sans marque',
      /Non envoyé/.test(sp.chip || ''), sp.chip);

    // 5) L'envoi échoue (réseau qui répond mais refuse d'écrire), puis le PC
    //    est fermé et rouvert.
    await dormir(2600);
    sp = await sonde(pc.page);
    console.log('   PC après échec de l\'envoi :', JSON.stringify(sp));
    b.chk('après l\'échec, la pastille reste « Non envoyé »', /Non envoyé/.test(sp.chip || ''),
      { stockage: sp.stoPending, chip: sp.chip });
    await pc.page.evaluate(() => { window.__marqueur = 'AVANT'; });
    await redemarrer(pc, 1800);
    b.chk('le redémarrage a bien eu lieu (marqueur de page perdu)',
      (await pc.page.evaluate(() => window.__marqueur || null)) === null);
    sp = await sonde(pc.page);
    console.log('   PC redémarré :', JSON.stringify(sp));
    b.chk('au redémarrage, le PC sait encore qu\'il doit envoyer (la fusion le redétecte)',
      sp.hasPendingPush === true, { p: sp.hasPendingPush, m: sp.memPending, chip: sp.chip });

    // 6) Le réseau redevient parfait. Sans aucune action, la saisie du PC
    //    doit revenir sur le serveur.
    srv.enPanneEcriture = false;
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < 40000) {
      await dormir(500);
      if ((serveurProgress(srv).z13 || {}).tPar === 65) { ok = true; break; }
    }
    console.log('   z13 de retour sur le serveur : ' + ok + ' (après ' + (Date.now() - t0) + ' ms)');
    b.chk('la saisie du PC revient sur le serveur, sans action de l\'utilisateur', ok,
      { delaiMs: Date.now() - t0, distant: serveurProgress(srv).z13 });
    sp = await sonde(pc.page);
    b.chk('la pastille du PC ne mentait pas : elle était orange tant que z13 manquait',
      ok ? /Synchronisé/.test(sp.chip || '') : /Non envoyé/.test(sp.chip || ''), sp.chip);
    await pc.ctx.close(); await tel.ctx.close();
  }

  const code = b.fin([]);
  await nav.close();
  process.exit(code);
})();
