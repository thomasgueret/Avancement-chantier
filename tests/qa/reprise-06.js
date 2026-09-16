// (7) `visibilitychange` → visible : l'ENVOI doit précéder la LECTURE.
//     On lit l'ordre RÉEL dans le journal du serveur, pas l'intention du code.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, saisir, sonde, serveurProgress,
  visibilite, bilan, dormir,
} = require('./reprise-lib.js');
const SEED = require('../seeds/liss.js');

const trace = (journal) => journal.map(e =>
  e.qui + ':' + e.op + (e.cols ? '(' + e.cols + ')' : '') + '@' + e.t + (e.ok ? '' : ' KO')).join('  ');

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'tel', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 },
  });
  await dormir(2600);

  // =====================================================================
  console.log('=== A. Serveur inchangé : l\'envoi doit passer AVANT la lecture ===');
  srv.enPanne = true;
  await saisir(tel.page, 'z22', 'mPose', 85);
  await dormir(300);
  await visibilite(tel.page, 'hidden');      // le flush échoue (réseau coupé)
  await dormir(500);
  srv.enPanne = false;
  const lec0 = srv.lectures, ecr0 = srv.ecritures, i0 = srv.journal.length;
  await visibilite(tel.page, 'visible');
  await dormir(1500);
  const seq = srv.journal.slice(i0);
  console.log('   journal après retour au premier plan :\n     ' + trace(seq));
  console.log('   lectures ' + lec0 + '->' + srv.lectures + ', écritures ' + ecr0 + '->' + srv.ecritures);
  const iUpsert = seq.findIndex(e => e.op === 'upsert');
  const iLectureComplete = seq.findIndex(e => e.op === 'get' && e.cols !== 'updated_at');
  b.chk('un envoi a bien eu lieu au retour au premier plan', iUpsert >= 0, { iUpsert });
  b.chk('le premier appel est la garde anti-écrasement (lecture de updated_at)',
    seq[0] && seq[0].op === 'get' && seq[0].cols === 'updated_at', seq[0]);
  b.chk('l\'ENVOI précède toute lecture complète de l\'état distant',
    iUpsert >= 0 && (iLectureComplete === -1 || iUpsert < iLectureComplete),
    { iUpsert, iLectureComplete });
  b.chk('l\'envoi est terminé avant que la lecture ne commence (2e get après l\'upsert)',
    iUpsert === 1, { sequence: seq.map(e => e.op + (e.cols ? '/' + e.cols : '')) });
  b.chk('le compteur d\'écritures a bougé', srv.ecritures > ecr0, { ecr0, apres: srv.ecritures });
  b.chk('le compteur de lectures a bougé aussi (la lecture suit)',
    srv.lectures > lec0, { lec0, apres: srv.lectures });
  b.chk('la saisie en attente est arrivée', (serveurProgress(srv).z22 || {}).mPose === 85,
    serveurProgress(srv).z22);
  let s = await sonde(tel.page);
  b.chk('pastille verte après le retour au premier plan', /Synchronisé/.test(s.chip || ''), s.chip);

  // =====================================================================
  console.log('\n=== B. Rien en attente : le retour au premier plan ne doit rien écrire ===');
  await visibilite(tel.page, 'hidden');
  await dormir(400);
  const ecr1 = srv.ecritures, lec1 = srv.lectures, i1 = srv.journal.length;
  await visibilite(tel.page, 'visible');
  await dormir(1200);
  console.log('   journal :\n     ' + trace(srv.journal.slice(i1)));
  b.chk('aucune écriture inutile quand rien n\'est en attente',
    srv.ecritures === ecr1, { avant: ecr1, apres: srv.ecritures });
  b.chk('une lecture a bien eu lieu (rattrapage des coéquipiers)',
    srv.lectures > lec1, { avant: lec1, apres: srv.lectures });

  // =====================================================================
  console.log('\n=== C. Le serveur a bougé pendant l\'absence : rien ne se perd ===');
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await dormir(2600);
  srv.enPanne = true;
  await saisir(tel.page, 'z23', 'mPose', 65);       // le téléphone retient une saisie
  await dormir(300);
  await visibilite(tel.page, 'hidden');
  await dormir(400);
  srv.enPanne = false;
  await saisir(pc.page, 'z13', 'tOss', 80);         // le PC pousse pendant l'absence
  await dormir(2600);
  b.chk('le PC a bien poussé', (serveurProgress(srv).z13 || {}).tOss === 80,
    serveurProgress(srv).z13);
  const i2 = srv.journal.length;
  await visibilite(tel.page, 'visible');
  await dormir(2500);
  const seq2 = srv.journal.slice(i2).filter(e => e.qui === 'tel');
  console.log('   journal (téléphone) :\n     ' + trace(seq2));
  const distant = serveurProgress(srv);
  const local = await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress)));
  b.chk('la saisie retenue par le téléphone atteint le serveur',
    (distant.z23 || {}).mPose === 65, distant.z23);
  b.chk('la cellule du PC n\'est pas écrasée sur le serveur',
    (distant.z13 || {}).tOss === 80, distant.z13);
  b.chk('le téléphone a intégré la cellule du PC', (local.z13 || {}).tOss === 80, local.z13);
  b.chk('la garde anti-écrasement a bien fusionné AVANT d\'écrire (lecture complète puis upsert)',
    (() => {
      const iL = seq2.findIndex(e => e.op === 'get' && e.cols !== 'updated_at');
      const iU = seq2.findIndex(e => e.op === 'upsert');
      return iL >= 0 && iU >= 0 && iL < iU;
    })(), seq2.map(e => e.op + (e.cols ? '/' + e.cols : '')));
  s = await sonde(tel.page);
  b.chk('plus rien en attente', s.hasPendingPush === false && s.memPending === 0,
    { p: s.hasPendingPush, m: s.memPending });
  b.chk('pastille verte', /Synchronisé/.test(s.chip || ''), s.chip);

  // =====================================================================
  console.log('\n=== D. Retour au premier plan avec l\'envoi toujours en panne ===');
  // La lecture doit tout de même avoir lieu (le `.then` suit le `.catch`),
  // et elle ne doit pas effacer la saisie qui n'a pas pu partir.
  srv.enPanneEcriture = true;
  await saisir(tel.page, 'z21', 'tIso', 35);
  await dormir(300);
  await visibilite(tel.page, 'hidden');
  await dormir(300);
  srv.enPanneEcriture = false;
  await saisir(pc.page, 'z11', 'tIso', 95);
  await dormir(2600);
  srv.enPanneEcriture = true;
  const i3 = srv.journal.length, lec3 = srv.lectures;
  await visibilite(tel.page, 'visible');
  await dormir(2500);
  const seq3 = srv.journal.slice(i3).filter(e => e.qui === 'tel');
  console.log('   journal (téléphone) :\n     ' + trace(seq3));
  b.chk('malgré l\'échec de l\'envoi, la lecture a bien eu lieu',
    srv.lectures > lec3, { avant: lec3, apres: srv.lectures });
  const local2 = await tel.page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress)));
  b.chk('la saisie non envoyée survit à la lecture', (local2.z21 || {}).tIso === 35, local2.z21);
  b.chk('la cellule du PC est bien arrivée sur le téléphone',
    (local2.z11 || {}).tIso === 95, local2.z11);
  s = await sonde(tel.page);
  b.chk('la pastille reste « Non envoyé » (pas de faux vert)',
    /Non envoyé/.test(s.chip || ''), { chip: s.chip, statut: s.statut });
  srv.enPanneEcriture = false;

  const code = b.fin([...tel.errs, ...pc.errs]);
  await nav.close();
  process.exit(code);
})();
