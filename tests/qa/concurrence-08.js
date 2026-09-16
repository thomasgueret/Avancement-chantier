// AXE CONCURRENCE — 08. DEUX ONGLETS de la même application sur le même
// appareil (usage de bureau : on ouvre l'appli deux fois sans y penser).
//
// Les deux onglets partagent le même localStorage ET le même
// `chantier_device_id`. Chacun tient son propre `state` en mémoire et
// `save()` réécrit TOUT le stockage depuis sa mémoire. Rien n'écoute
// l'évènement `storage`. Deux conséquences à mesurer :
//   - le second onglet qui sauvegarde efface-t-il la saisie du premier ?
//   - la synchro rattrape-t-elle ? (non : même DEVICE_ID → `sameDevice`, la
//     fusion est SAUTÉE ; l'onglet pousse alors son état sans fusionner)
const { chromium } = require('playwright');
const L = require('./concurrence-lib.js');
const SEED = require('../seeds/liss.js');

const stockage = (page) => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('chantier_v1') || '{}');
  return { tp: s.taskProgress || {}, at: s.taskProgressAt || {}, pending: s.syncPendingSince };
});

(async () => {
  const b = L.bilan();
  const nav = await chromium.launch({ executablePath: L.CHROME });
  const errs = [];
  const srv = L.nouveauServeur();

  // Un seul appareil = un seul contexte ; deux pages dedans = deux onglets.
  const A = await L.ouvrirAppareil(nav, srv, 'ongletA', { seed: SEED, deviceId: 'bureau' });
  const B = await L.ouvrirOnglet(A, 'ongletB');
  await L.isoler(A.page); await L.isoler(B.page);
  const idA = await A.page.evaluate(() => DEVICE_ID);
  const idB = await B.page.evaluate(() => DEVICE_ID);
  console.log('   DEVICE_ID onglet A :', idA, '| onglet B :', idB);
  b.chk('les deux onglets ont bien le même identifiant d\'appareil', idA === idB, { idA, idB });

  console.log('\n=== A. L\'onglet A saisit et envoie ===');
  await L.saisir(A.page, 'z11', 'tOss', 100);
  await L.pousser(A.page);
  let sto = await stockage(A.page);
  console.log('   stockage z11 :', JSON.stringify(sto.tp.z11), '| serveur z11 :',
    JSON.stringify(L.serveurProgress(srv).z11));
  b.chk('la saisie de A est dans le stockage local', (sto.tp.z11 || {}).tOss === 100, sto.tp.z11);
  b.chk('la saisie de A est sur le serveur', L.serveurCellule(srv, 'z11', 'tOss') === 100);

  console.log('\n=== B. L\'onglet B (ouvert avant) saisit à son tour ===');
  const memB = (await L.lireTout(B.page)).z11 || {};
  console.log('   mémoire de B pour z11 (il ignore la saisie de A) :', JSON.stringify(memB));
  await L.saisir(B.page, 'z12', 'tPar', 60);
  sto = await stockage(B.page);
  console.log('   stockage après le save de B : z11 =', JSON.stringify(sto.tp.z11),
    '| z12 =', JSON.stringify(sto.tp.z12));
  b.chk('le save du second onglet NE DÉTRUIT PAS la saisie du premier dans le stockage',
    (sto.tp.z11 || {}).tOss === 100, sto.tp.z11);
  b.chk('l\'horodatage de cellule de la saisie de A survit dans le stockage',
    ((sto.at.z11 || {}).tOss || 0) > SEED.IL_Y_A_UNE_SEMAINE, (sto.at.z11 || {}).tOss);

  console.log('\n=== C. L\'onglet B envoie : la synchro rattrape-t-elle ? ===');
  const sB = await L.sonde(B.page);
  console.log('   B avant envoi :', JSON.stringify(sB));
  console.log('   B pousse :', await L.pousser(B.page));
  console.log('   serveur z11 :', JSON.stringify(L.serveurProgress(srv).z11),
    '| z12 :', JSON.stringify(L.serveurProgress(srv).z12));
  b.chk('l\'envoi du second onglet ne détruit pas la saisie du premier sur le serveur',
    L.serveurCellule(srv, 'z11', 'tOss') === 100, L.serveurProgress(srv).z11);
  b.chk('l\'envoi du second onglet porte bien sa propre saisie',
    L.serveurCellule(srv, 'z12', 'tPar') === 60, L.serveurProgress(srv).z12);

  console.log('\n=== D. Les deux onglets relisent le serveur ===');
  console.log('   A tire :', await L.tirer(A.page), '| B tire :', await L.tirer(B.page));
  const va = await L.lireTout(A.page), vb = await L.lireTout(B.page);
  console.log('   A voit z11 =', JSON.stringify(va.z11), ' z12 =', JSON.stringify(va.z12));
  console.log('   B voit z11 =', JSON.stringify(vb.z11), ' z12 =', JSON.stringify(vb.z12));
  b.chk('après lecture, l\'onglet A a les deux saisies',
    (va.z11 || {}).tOss === 100 && (va.z12 || {}).tPar === 60, { z11: va.z11, z12: va.z12 });
  b.chk('après lecture, l\'onglet B a les deux saisies',
    (vb.z11 || {}).tOss === 100 && (vb.z12 || {}).tPar === 60, { z11: vb.z11, z12: vb.z12 });

  console.log('\n=== E. Rechargement de l\'onglet A : que reste-t-il ? ===');
  await L.redemarrer(A, 2000);
  const finalA = await L.lireTout(A.page);
  console.log('   A après rechargement : z11 =', JSON.stringify(finalA.z11), ' z12 =', JSON.stringify(finalA.z12));
  console.log('   serveur : z11 =', JSON.stringify(L.serveurProgress(srv).z11),
    ' z12 =', JSON.stringify(L.serveurProgress(srv).z12));
  b.chk('après rechargement, les deux saisies existent encore',
    (finalA.z11 || {}).tOss === 100 && (finalA.z12 || {}).tPar === 60,
    { z11: finalA.z11, z12: finalA.z12 });

  console.log('\n=== F. Variante SANS serveur (deux onglets hors réseau) ===');
  const srv2 = L.nouveauServeur();
  srv2.enPanne = true;
  const C = await L.ouvrirAppareil(nav, srv2, 'bureau2', { seed: SEED, deviceId: 'bureau2' });
  const D = await L.ouvrirOnglet(C, 'ongletD');
  await L.isoler(C.page); await L.isoler(D.page);
  await L.saisir(C.page, 'z21', 'tOss', 75);
  await L.saisir(C.page, 'z21', 'tIso', 50);
  await L.saisir(D.page, 'z22', 'mPose', 3, true);
  const sto2 = await stockage(D.page);
  console.log('   stockage : z21 =', JSON.stringify(sto2.tp.z21), '| z22 =', JSON.stringify(sto2.tp.z22));
  b.chk('hors réseau, le second onglet n\'efface pas les saisies du premier',
    (sto2.tp.z21 || {}).tOss === 75 && (sto2.tp.z21 || {}).tIso === 50, sto2.tp.z21);
  await L.redemarrer(C, 1500);
  const apresC = await L.lireTout(C.page);
  console.log('   après rechargement : z21 =', JSON.stringify(apresC.z21), '| z22 =', JSON.stringify(apresC.z22));
  b.chk('après rechargement hors réseau, les saisies des deux onglets sont là',
    (apresC.z21 || {}).tOss === 75 && (apresC.z22 || {}).mPose === 3,
    { z21: apresC.z21, z22: apresC.z22 });

  for (const x of [A, C]) errs.push(...x.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
