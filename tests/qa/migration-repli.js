// LE TEST DÉCISIF sur la migration de la v1.86 vers la v1.88.
//
// `migrerHorodatageAvancement()` doit dater les cellules d'avancement héritées
// avec le dernier horodatage connu de la clé. Si elle les date de 1970, alors
// un appareil resté en v1.86 — dont le repli est SON horodatage de clé, bien
// réel — gagne tous les conflits contre l'appareil à jour. Le bug d'origine
// ne serait pas corrigé : il serait retourné contre l'utilisateur.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, lireTout, lireStamps, stamps,
  saisir, synchroniser, bilan,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const srv = nouveauServeur();
  const tousErrs = [];

  console.log('=== 1. Ce que la migration écrit comme horodatage ===');
  // Un appareil hérité : avancement réel, PAS de taskProgressAt, mais un
  // horodatage de clé bien renseigné (il s'est synchronisé la semaine dernière).
  const pc = await ouvrirAppareil(nav, srv, 'pc', {
    seed: SEED.herite({ keyStamp: SEED.IL_Y_A_UNE_SEMAINE }),
    deviceId: 'pc',
  });
  const apresMigration = await lireStamps(pc.page);
  const st = await stamps(pc.page);
  console.log('   syncKeyStamps.taskProgress relu  :', st.taskProgress);
  console.log('   horodatages posés par la migration :', JSON.stringify(apresMigration.z11 || {}));
  const posé = (apresMigration.z11 || {}).tTrac;
  console.log('   soit la date :', posé ? new Date(posé).toISOString() : '(aucun)');

  b.chk('la migration a bien daté les cellules héritées', !!posé, posé);
  b.chk('elle les date de la DERNIÈRE SYNCHRO CONNUE, pas de 1970',
    posé === SEED.IL_Y_A_UNE_SEMAINE,
    { posé, attendu: SEED.IL_Y_A_UNE_SEMAINE, dateposée: posé ? new Date(posé).toISOString() : null });

  console.log('\n=== 2. La conséquence : un appareil v1.86 face à un appareil v1.88 ===');
  // Le téléphone fait la tournée, sur un appareil À JOUR (v1.88).
  const tel = await ouvrirAppareil(nav, srv, 'telephone', {
    seed: SEED.herite({ keyStamp: SEED.IL_Y_A_UNE_SEMAINE }),
    deviceId: 'tel', viewport: { width: 390, height: 844 },
  });
  for (const z of ['z11', 'z12', 'z13']) {
    await saisir(tel.page, z, 'tOss', 100);
    await saisir(tel.page, z, 'tIso', 75);
  }
  const relevé = await lireTout(tel.page);
  console.log('   relevé de terrain (téléphone), z11 :', JSON.stringify(relevé.z11));
  await synchroniser(tel.page);
  console.log('   poussé au serveur. écritures :', srv.ecritures);

  // Le PC, resté en v1.86 dans l'esprit : il n'a AUCUN horodatage de cellule.
  // On le simule en vidant taskProgressAt juste avant la synchro, et en lui
  // donnant un horodatage de clé frais — comme s'il venait de modifier autre chose.
  await pc.page.evaluate(() => {
    state.taskProgressAt = {};
    state.syncKeyStamps.taskProgress = Date.now();
    save();
  });
  await synchroniser(pc.page);
  const pcApres = await lireTout(pc.page);
  console.log('   sur le PC après fusion, z11 :', JSON.stringify(pcApres.z11 || {}));

  b.chk("le relevé de terrain survit sur l'appareil resté en arrière",
    (pcApres.z11 || {}).tOss === 100 && (pcApres.z11 || {}).tIso === 75,
    pcApres.z11 || {});

  // Et l'inverse : le téléphone se resynchronise après le PC.
  await synchroniser(tel.page);
  const telApres = await lireTout(tel.page);
  console.log('   sur le TÉLÉPHONE après resynchro, z11 :', JSON.stringify(telApres.z11 || {}));
  b.chk('le relevé de terrain survit sur le téléphone qui l\'a saisi',
    (telApres.z11 || {}).tOss === 100 && (telApres.z11 || {}).tIso === 75,
    telApres.z11 || {});

  console.log('\n=== 3. Deux appareils hérités, aucun stamp de clé (repli = 1 des deux côtés) ===');
  const srv2 = nouveauServeur();
  const a = await ouvrirAppareil(nav, srv2, 'A', { seed: SEED.herite({ sansStamps: true }), deviceId: 'A' });
  const c = await ouvrirAppareil(nav, srv2, 'C', { seed: SEED.herite({ sansStamps: true }), deviceId: 'C' });
  await saisir(a.page, 'z22', 'tOss', 90);   // A relève une zone que C ne connaît pas
  await synchroniser(a.page);
  await synchroniser(c.page);
  const cVu = await lireTout(c.page);
  console.log('   C voit z22 :', JSON.stringify(cVu.z22 || {}));
  b.chk('une zone relevée sur A arrive bien sur C', (cVu.z22 || {}).tOss === 90, cVu.z22 || {});
  await saisir(c.page, 'z23', 'tOss', 30);
  await synchroniser(c.page);
  await synchroniser(a.page);
  const aVu = await lireTout(a.page);
  b.chk('et la zone relevée sur C arrive sur A, sans effacer celle de A',
    (aVu.z23 || {}).tOss === 30 && (aVu.z22 || {}).tOss === 90,
    { z22: aVu.z22, z23: aVu.z23 });

  for (const app of [pc, tel, a, c]) tousErrs.push(...app.errs);
  const code = b.fin(tousErrs);
  await nav.close();
  process.exit(code);
})();
