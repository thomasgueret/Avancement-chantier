// AXE « horloge » — 03 : l'application récupère-t-elle quand l'horloge est
// corrigée EN COURS DE ROUTE, et combien de temps dure l'empoisonnement ?
//
// A. Le téléphone en avance relève, pousse, contamine le dépôt. Puis son
//    horloge est remise à l'heure (même appareil, mêmes données, horloge juste).
//    Ses nouvelles saisies sont-elles encore perdues ?
// B. Durée : on simule l'écoulement du temps réel en ouvrant l'appareil à
//    l'heure avec un décalage POSITIF croissant (« nous sommes X plus tard »).
//    À partir de quand une saisie honnête reprend-elle la main ?
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, lireTout, lireStamps, stamps,
  saisir, synchroniser, bilan, isoler,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const MIN = 60000, H = 3600000;

// Récupère l'état persisté d'un appareil, pour le rouvrir « même appareil,
// autre horloge » (un addInitScript ne se retire pas d'une page existante).
const exporterEtat = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('chantier_v1')));

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const srv = nouveauServeur();

  // ---------------------------------------------------------------------
  console.log('=== A. Le téléphone en avance (+1 h) fait sa tournée ===');
  const tel = await ouvrirAppareil(nav, srv, 'telephone', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 }, decalageMs: +H,
  });
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await isoler(tel.page); await isoler(pc.page);

  for (const z of ['z11', 'z12', 'z13']) { await saisir(tel.page, z, 'tOss', 100); await saisir(tel.page, z, 'tIso', 75); }
  await synchroniser(tel.page);
  await synchroniser(pc.page);
  const apresTournee = await lireStamps(pc.page);
  const avance = Object.values(apresTournee.z11).reduce((a, v) => Math.max(a, v), 0) - Date.now();
  console.log('   le dépôt partagé porte des horodatages en avance de', Math.round(avance / 1000), 's');
  b.chk('le relevé du téléphone en avance arrive sur l\'ordinateur',
    (await lireTout(pc.page)).z11.tOss === 100);

  // ---------------------------------------------------------------------
  console.log('\n=== B. L\'horloge du téléphone est CORRIGÉE (même appareil, mêmes données) ===');
  const etatTel = await exporterEtat(tel.page);
  await tel.ctx.close();
  const telOk = await ouvrirAppareil(nav, srv, 'telephone-corrige', {
    seed: etatTel, deviceId: 'tel', viewport: { width: 390, height: 844 }, decalageMs: 0,
  });
  await isoler(telOk.page);
  const stApres = await stamps(telOk.page);
  console.log('   après remise à l\'heure, marqueurs de l\'appareil :', JSON.stringify(stApres));
  b.chk('l\'horodatage de clé taskProgress reste dans le futur après la remise à l\'heure',
    stApres.taskProgress > Date.now(), { stamp: stApres.taskProgress, maintenant: Date.now() });
  const stCell = await lireStamps(telOk.page);
  console.log('   horodatages de cellule conservés (z11) :', JSON.stringify(stCell.z11));
  b.chk('les horodatages de cellule restent dans le futur après la remise à l\'heure',
    stCell.z11.tOss > Date.now(), stCell.z11);

  // Le téléphone remis à l'heure corrige une valeur : 100 -> 55.
  await saisir(telOk.page, 'z11', 'tOss', 55);
  const stampCorrection = (await lireStamps(telOk.page)).z11.tOss;
  console.log('   nouvelle saisie du téléphone remis à l\'heure, horodatage :', stampCorrection);
  b.chk('la nouvelle saisie est horodatée au temps RÉEL (plus de futur)',
    stampCorrection <= Date.now() + 2000, stampCorrection);
  await synchroniser(telOk.page);
  const telApres = await lireTout(telOk.page);
  console.log('   téléphone après synchro, z11.tOss =', telApres.z11.tOss);
  b.chk('la saisie du téléphone REMIS À L\'HEURE survit à sa propre synchro',
    telApres.z11.tOss === 55, telApres.z11);
  await synchroniser(pc.page);
  const pcApres = await lireTout(pc.page);
  console.log('   ordinateur après synchro, z11.tOss =', pcApres.z11.tOss);
  b.chk('la correction du téléphone remis à l\'heure parvient à l\'ordinateur',
    pcApres.z11.tOss === 55, pcApres.z11);

  // ---------------------------------------------------------------------
  console.log('\n=== C. L\'ordinateur à l\'heure corrige à son tour : est-il encore bloqué ? ===');
  await saisir(pc.page, 'z12', 'tOss', 45);
  await synchroniser(pc.page);
  await synchroniser(telOk.page);
  await synchroniser(pc.page);
  const pcC = await lireTout(pc.page);
  const telC = await lireTout(telOk.page);
  console.log('   z12.tOss — ordinateur :', pcC.z12.tOss, '| téléphone :', telC.z12.tOss);
  b.chk('la correction de l\'ordinateur (z12) survit malgré le dépôt empoisonné',
    pcC.z12.tOss === 45 && telC.z12.tOss === 45, { pc: pcC.z12, tel: telC.z12 });

  // ---------------------------------------------------------------------
  console.log('\n=== D. Durée de l\'empoisonnement, mesurée en bout en bout ===');
  // On repart d'un dépôt frais empoisonné par un téléphone +1 h, puis on ouvre
  // l'appareil à l'heure « plus tard » (décalage = temps écoulé) et on regarde
  // si sa saisie tient.
  for (const ecoule of [1 * MIN, 30 * MIN, 59 * MIN, 61 * MIN]) {
    const s2 = nouveauServeur();
    const t2 = await ouvrirAppareil(nav, s2, 't2', { seed: SEED, deviceId: 't2', decalageMs: +H });
    await isoler(t2.page);
    await saisir(t2.page, 'z21', 'tOss', 100);
    await synchroniser(t2.page);
    const p2 = await ouvrirAppareil(nav, s2, 'p2', { seed: SEED, deviceId: 'p2', decalageMs: ecoule });
    await isoler(p2.page);
    await synchroniser(p2.page);                 // reçoit le relevé empoisonné
    await saisir(p2.page, 'z21', 'tOss', 30);    // saisie honnête, « ecoule » plus tard
    await synchroniser(p2.page);
    await synchroniser(t2.page);                 // le téléphone renvoie son avis
    await synchroniser(p2.page);
    const fin = await lireTout(p2.page);
    const tient = (fin.z21 || {}).tOss === 30;
    console.log(`   ${Math.round(ecoule / MIN)} min après : z21.tOss = ${(fin.z21 || {}).tOss}`
      + (tient ? '  (la saisie honnête tient)' : '  (la saisie honnête est ANNULÉE)'));
    b.chk(`[t+${Math.round(ecoule / MIN)} min] la saisie honnête tient face au relevé horodaté +1 h`,
      tient, fin.z21);
    errs.push(...t2.errs, ...p2.errs);
    await t2.ctx.close(); await p2.ctx.close();
  }

  errs.push(...pc.errs, ...telOk.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
