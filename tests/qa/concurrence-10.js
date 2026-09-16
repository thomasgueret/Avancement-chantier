// AXE CONCURRENCE — 10. RAFALE : 300 saisies en quelques secondes (le relevé
// d'une tournée tapé au doigt levé). L'anti-rebond, `save()` et l'envoi
// tiennent-ils ? Combien d'écritures serveur ? L'état final est-il exact,
// en mémoire, dans le stockage ET sur le serveur ?
const { chromium } = require('playwright');
const L = require('./concurrence-lib.js');
const SEED = require('../seeds/liss.js');

const ZONES = ['z11', 'z12', 'z13', 'z21', 'z22', 'z23'];
const TACHES = ['tTrac', 'tOss', 'tIso', 'tPar'];
const CELLULES = [];
for (const z of ZONES) for (const t of TACHES) CELLULES.push([z, t]);

// Séquence déterministe de 300 saisies + état final attendu, calculés ici.
function sequence(n) {
  const seq = [], attendu = {};
  for (let i = 0; i < n; i++) {
    const [z, t] = CELLULES[i % CELLULES.length];
    const pct = 5 * (1 + (i % 20));            // 5..100, déjà au pas de 5
    seq.push([z, t, pct]);
    if (!attendu[z]) attendu[z] = {};
    attendu[z][t] = pct;
  }
  return { seq, attendu };
}

const compare = (a, b, cles) => {
  const diff = [];
  for (const z of cles) {
    for (const t of TACHES) {
      const va = (a[z] || {})[t], vb = (b[z] || {})[t];
      if (va !== vb) diff.push(`${z}.${t}: ${va} vs ${vb}`);
    }
  }
  return diff;
};

(async () => {
  const b = L.bilan();
  const nav = await chromium.launch({ executablePath: L.CHROME });
  const errs = [];
  const srv = L.nouveauServeur();
  const tel = await L.ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 } });
  await tel.page.waitForTimeout(2200);            // démarrage calmé, timers réels
  const ecr0 = srv.ecritures, lec0 = srv.lectures;

  const { seq, attendu } = sequence(300);
  console.log('=== A. 300 setProgress, une toutes les 10 ms (≈ 3 s) ===');
  const mesure = await tel.page.evaluate(async (s) => {
    const t0 = performance.now();
    let erreurs = 0;
    for (const [z, t, p] of s) {
      try { setProgress(z, t, p); } catch (e) { erreurs++; }
      await new Promise(r => setTimeout(r, 10));
    }
    return { ms: Math.round(performance.now() - t0), erreurs };
  }, seq);
  console.log('   durée :', mesure.ms, 'ms | exceptions :', mesure.erreurs);
  console.log('   écritures serveur PENDANT la rafale :', srv.ecritures - ecr0);
  b.chk('aucune exception pendant la rafale', mesure.erreurs === 0, mesure.erreurs);

  const mem = await L.lireTout(tel.page);
  const diffMem = compare(attendu, mem, ZONES);
  console.log('   écarts mémoire / attendu :', diffMem.length ? diffMem.slice(0, 6) : 'aucun');
  b.chk('l\'état en mémoire est exactement la dernière valeur de chaque cellule',
    diffMem.length === 0, diffMem.slice(0, 6));

  const sto = await tel.page.evaluate(() => JSON.parse(localStorage.getItem('chantier_v1') || '{}').taskProgress || {});
  const diffSto = compare(attendu, sto, ZONES);
  console.log('   écarts stockage / attendu :', diffSto.length ? diffSto.slice(0, 6) : 'aucun');
  b.chk('le stockage local porte le même état que la mémoire', diffSto.length === 0, diffSto.slice(0, 6));

  console.log('\n=== B. On laisse l\'anti-rebond finir ===');
  await tel.page.waitForTimeout(3000);
  const ecr = srv.ecritures - ecr0;
  console.log('   écritures serveur au total :', ecr, '| lectures :', srv.lectures - lec0);
  const sonde = await L.sonde(tel.page);
  console.log('   sonde :', JSON.stringify(sonde));
  const surSrv = L.serveurProgress(srv);
  const diffSrv = compare(attendu, surSrv, ZONES);
  console.log('   écarts serveur / attendu :', diffSrv.length ? diffSrv.slice(0, 6) : 'aucun');
  b.chk('le serveur reçoit l\'état final complet', diffSrv.length === 0, diffSrv.slice(0, 6));
  b.chk('l\'anti-rebond n\'a pas envoyé 300 fois (≤ 5 écritures)', ecr <= 5, ecr);
  b.chk('au moins une écriture a eu lieu', ecr >= 1, ecr);
  b.chk('plus rien n\'est en attente après la rafale', sonde.hasPendingPush === false, sonde);
  b.chk('la pastille annonce « Synchronisé » à la fin', /Synchronis/.test(sonde.chip || ''), sonde.chip);

  console.log('\n=== C. Tous les horodatages de cellule sont-ils posés ? ===');
  const at = await L.lireStamps(tel.page);
  let sansStamp = [];
  for (const z of ZONES) for (const t of TACHES) {
    if ((mem[z] || {})[t] !== undefined && !((at[z] || {})[t] > 0)) sansStamp.push(z + '.' + t);
  }
  console.log('   cellules sans horodatage :', sansStamp.length ? sansStamp : 'aucune');
  b.chk('invariant : toute valeur porte un horodatage après la rafale', sansStamp.length === 0, sansStamp);

  console.log('\n=== D. Rafale SERRÉE : 300 setProgress d\'affilée, sans respiration ===');
  const srv2 = L.nouveauServeur();
  const t2 = await L.ouvrirAppareil(nav, srv2, 'tel2', { seed: SEED, deviceId: 'tel2' });
  await t2.page.waitForTimeout(2200);
  const { seq: seq2, attendu: att2 } = sequence(300);
  const m2 = await t2.page.evaluate((s) => {
    const t0 = performance.now();
    let erreurs = 0;
    for (const [z, t, p] of s) { try { setProgress(z, t, p); } catch (e) { erreurs++; } }
    return { ms: Math.round(performance.now() - t0), erreurs };
  }, seq2);
  console.log('   durée de 300 saisies synchrones :', m2.ms, 'ms | exceptions :', m2.erreurs,
    '| ' + (m2.ms / 300).toFixed(1) + ' ms par saisie');
  b.chk('300 saisies d\'affilée sans exception', m2.erreurs === 0, m2.erreurs);
  await t2.page.waitForTimeout(3200);
  const diff2 = compare(att2, L.serveurProgress(srv2), ZONES);
  console.log('   écritures serveur :', srv2.ecritures, '| écarts serveur/attendu :', diff2.length ? diff2.slice(0, 6) : 'aucun');
  b.chk('la rafale serrée arrive intacte sur le serveur', diff2.length === 0, diff2.slice(0, 6));
  const s2 = await L.sonde(t2.page);
  console.log('   sonde :', JSON.stringify(s2));
  b.chk('rien ne reste en attente après la rafale serrée', s2.hasPendingPush === false, s2);

  // L'interface répond-elle encore ?
  const rendu = await t2.page.evaluate(() => {
    try { renderAvancement(); return 'ok'; } catch (e) { return 'KO ' + e.message; }
  });
  console.log('   renderAvancement après la rafale :', rendu);
  b.chk('le rendu de l\'avancement fonctionne encore après la rafale', rendu === 'ok', rendu);

  for (const x of [tel, t2]) errs.push(...x.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
