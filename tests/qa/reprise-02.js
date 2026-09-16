// (2) Le réseau RÉPOND mais l'envoi ÉCHOUE, sans que `navigator.onLine`
//     bascule : portail captif, 5xx, règle de sécurité. C'est le cas qui
//     laissait deux heures de relevé sur l'appareil en v1.87.
//
// Particularité : les LECTURES continuent de réussir. Le pull périodique
// (20 s) tourne donc normalement, remet le statut à « idle » et fusionne
// l'état distant PAR-DESSUS des saisies qui n'ont pas encore pu partir.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, saisir, sonde, serveurProgress,
  bilan, dormir,
} = require('./reprise-lib.js');
const SEED = require('../seeds/liss.js');

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const srv = nouveauServeur();

  // Le PC alimente le serveur en premier.
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await dormir(2600);
  console.log('=== A. Le serveur est alimenté par le PC ===');
  b.chk('le serveur porte l\'état du PC', !!srv.ligne, { ecritures: srv.ecritures });

  // Le téléphone arrive, se synchronise, puis part sur le chantier.
  const tel = await ouvrirAppareil(nav, srv, 'tel', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 },
  });
  await dormir(2600);
  let s = await sonde(tel.page);
  b.chk('le téléphone démarre synchronisé', /Synchronisé/.test(s.chip || ''), s.chip);

  // --- Panne d'ÉCRITURE seulement.
  console.log('\n=== B. Les écritures échouent, les lectures passent ===');
  srv.enPanneEcriture = true;
  const ecrBase = srv.ecritures, lecBase = srv.lectures;
  await saisir(tel.page, 'z22', 'mPose', 75);
  await saisir(tel.page, 'z23', 'mPose', 50);
  await dormir(3200);

  s = await sonde(tel.page);
  console.log('   sonde tel :', JSON.stringify(s));
  console.log('   tentatives upsert :', srv.tentativesUpsert, ' réussies :', srv.ecritures,
    ' lectures OK :', srv.lectures);
  b.chk('l\'upsert a bien été TENTÉ (la lecture de garde a réussi)',
    srv.tentativesUpsert > 0, srv.tentativesUpsert);
  b.chk('aucune écriture n\'a abouti', srv.ecritures === ecrBase, { ecritures: srv.ecritures });
  b.chk('les lectures, elles, continuent de réussir', srv.lectures > lecBase,
    { lectures: srv.lectures, base: lecBase });
  b.chk('navigator.onLine reste à true — aucun évènement `online` ne viendra',
    (await tel.page.evaluate(() => navigator.onLine)) === true);
  b.chk('la marque d\'attente est posée ET persistée',
    s.memPending > 0 && s.stoPending > 0, { mem: s.memPending, sto: s.stoPending });
  b.chk('la pastille dit « Non envoyé » malgré un réseau qui répond',
    /Non envoyé/.test(s.chip || ''), s.chip);
  b.chk('la reprise est armée sans avoir eu besoin de `online`',
    s.retryArme === true, { arme: s.retryArme, delai: s.retryDelai });

  // --- Pendant ce temps, le PC pousse une modification plus ANCIENNE sur
  //     d'autres cellules : le pull du téléphone va fusionner par-dessus.
  console.log('\n=== C. Le pull périodique fusionne pendant que l\'envoi est bloqué ===');
  srv.enPanneEcriture = false;
  await saisir(pc.page, 'z11', 'tPar', 30);
  await dormir(2600);
  srv.enPanneEcriture = true;
  b.chk('le PC a bien poussé sa modification', serveurProgress(srv).z11.tPar === 30,
    serveurProgress(srv).z11);

  // On force un pull côté téléphone (comme le fait le timer de 20 s) sans
  // rien envoyer : c'est exactement le risque — fusionner par-dessus.
  await tel.page.evaluate(async () => { try { await doSyncPull(); } catch (e) {} });
  await dormir(600);
  const telApres = await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress)));
  console.log('   téléphone après pull :', JSON.stringify(telApres));
  b.chk('les saisies NON ENVOYÉES du téléphone survivent au pull',
    (telApres.z22 || {}).mPose === 75 && (telApres.z23 || {}).mPose === 50,
    { z22: telApres.z22, z23: telApres.z23 });
  b.chk('le téléphone a bien reçu la cellule du PC', (telApres.z11 || {}).tPar === 30, telApres.z11);
  s = await sonde(tel.page);
  b.chk('la pastille reste « Non envoyé » après un pull réussi (pas de faux vert)',
    /Non envoyé/.test(s.chip || ''), { chip: s.chip, statut: s.statut });
  b.chk('la marque d\'attente n\'a pas été effacée par le pull', s.memPending > 0, s.memPending);

  // --- L'écriture repasse. Toujours aucune action de l'utilisateur.
  console.log('\n=== D. L\'écriture repasse — rien ne doit rester sur l\'appareil ===');
  srv.enPanneEcriture = false;
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < 75000) {
    await dormir(500);
    const d = serveurProgress(srv);
    if ((d.z22 || {}).mPose === 75 && (d.z23 || {}).mPose === 50) { ok = true; break; }
  }
  console.log('   arrivée sur le serveur après ' + (Date.now() - t0) + ' ms');
  b.chk('les saisies bloquées finissent par partir seules', ok,
    { delaiMs: Date.now() - t0, distant: serveurProgress(srv).z22 });
  await dormir(800);
  s = await sonde(tel.page);
  b.chk('la pastille repasse au vert', /Synchronisé/.test(s.chip || ''), s.chip);
  b.chk('le serveur porte les deux avancements (téléphone + PC)',
    (serveurProgress(srv).z11 || {}).tPar === 30 && (serveurProgress(srv).z22 || {}).mPose === 75,
    serveurProgress(srv));

  const code = b.fin([...tel.errs, ...pc.errs]);
  await nav.close();
  process.exit(code);
})();
