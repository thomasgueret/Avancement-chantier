// AXE CONCURRENCE — 01. Deux appareils poussent quasi simultanément.
//
// La garde anti-écrasement de doSyncPush relit `updated_at` PUIS écrit. Entre
// les deux, il y a une fenêtre. Avec `srv.latenceMs` on l'élargit assez pour
// que les deux appareils lisent le même `updated_at` (donc « rien n'a bougé,
// j'écris ») avant que l'un des deux ait écrit. Le dernier qui écrit pousse un
// payload qui ignore la saisie de l'autre.
//
// On mesure : ce que le serveur porte après la course, ce que croit l'appareil
// perdant (chip / syncPendingSince), et ce que voit un TROISIÈME appareil qui
// lit pendant cette fenêtre.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, lireTout, stamps,
  saisir, synchroniser, bilan, isoler, dormir,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const srvCell = (srv, z, t) => {
  const tp = srv.ligne && srv.ligne.state && srv.ligne.state.taskProgress;
  return tp && tp[z] ? tp[z][t] : undefined;
};
const pousser = (page) => page.evaluate(async () => {
  try { await doSyncPush(); return 'ok'; } catch (e) { return 'KO ' + e.message; }
});

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const srv = nouveauServeur();

  console.log('=== A. Mise en place : deux appareils alignés sur la même version serveur ===');
  const tel = await ouvrirAppareil(nav, srv, 'telephone', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 },
  });
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await isoler(tel.page); await isoler(pc.page);

  await synchroniser(tel.page);          // crée la ligne
  await synchroniser(pc.page);           // pc intègre, lastSeen commun
  const sTel0 = await stamps(tel.page), sPc0 = await stamps(pc.page);
  console.log('   tel :', JSON.stringify(sTel0));
  console.log('   pc  :', JSON.stringify(sPc0));
  b.chk('les deux appareils ont vu la même version serveur',
    sTel0.vu === sPc0.vu && sTel0.vu > 0, { tel: sTel0.vu, pc: sPc0.vu });
  b.chk('rien n\'est en attente avant la course',
    !sTel0.enAttente && !sPc0.enAttente, { tel: sTel0.enAttente, pc: sPc0.enAttente });

  console.log('\n=== B. La course : chacun saisit une zone, puis pousse ===');
  await saisir(tel.page, 'z11', 'tOss', 100);   // relevé du terrain
  await saisir(pc.page, 'z12', 'tPar', 60);     // saisie au bureau
  console.log('   tel a z11.tOss=100, pc a z12.tPar=60');
  const ecrAvant = srv.ecritures;

  srv.latenceMs = 300;                          // élargit la fenêtre de course
  const pTel = pousser(tel.page);
  await dormir(60);                             // décalage : tel lit d'abord
  const pPc = pousser(pc.page);
  const res = await Promise.all([pTel, pPc]);
  srv.latenceMs = 0;
  console.log('   résultat des deux envois :', JSON.stringify(res));
  console.log('   écritures serveur pendant la course :', srv.ecritures - ecrAvant);
  console.log('   journal :', JSON.stringify(srv.journal.slice(-4)));
  const sur = { z11tOss: srvCell(srv, 'z11', 'tOss'), z12tPar: srvCell(srv, 'z12', 'tPar') };
  console.log('   SERVEUR après la course, les deux cellules :', JSON.stringify(sur));

  b.chk('la garde anti-écrasement conserve la saisie du téléphone',
    sur.z11tOss === 100, sur);
  b.chk('la garde anti-écrasement conserve la saisie du PC',
    sur.z12tPar === 60, sur);

  console.log('\n=== C. Que croit l\'appareil dont la saisie a disparu du serveur ? ===');
  const sTel1 = await stamps(tel.page), sPc1 = await stamps(pc.page);
  console.log('   tel :', JSON.stringify(sTel1));
  console.log('   pc  :', JSON.stringify(sPc1));
  const chipTel = await tel.page.evaluate(() => (document.getElementById('syncchip') || {}).textContent);
  const chipPc = await pc.page.evaluate(() => (document.getElementById('syncchip') || {}).textContent);
  console.log('   chip tel :', chipTel, '| chip pc :', chipPc);
  const perduTel = sur.z11tOss !== 100, perduPc = sur.z12tPar !== 60;
  if (perduTel || perduPc) {
    const perdant = perduTel ? sTel1 : sPc1;
    const chip = perduTel ? chipTel : chipPc;
    b.chk('l\'appareil dont la saisie n\'est PAS sur le serveur reste « en attente »',
      perdant.enAttente > 0, { enAttente: perdant.enAttente, chip });
    b.chk('son chip n\'annonce pas « Synchronisé »',
      !/Synchronis/.test(chip || ''), chip);
  } else {
    b.chk('(pas de perte : rien à vérifier côté chip)', true);
    b.chk('(idem)', true);
  }

  console.log('\n=== D. Un troisième appareil arrive et lit le serveur ===');
  const tab = await ouvrirAppareil(nav, srv, 'tablette', {
    seed: SEED.herite({ keyStamp: SEED.IL_Y_A_UNE_SEMAINE }), deviceId: 'tab',
  });
  await isoler(tab.page);
  await synchroniser(tab.page);
  const vuTab = await lireTout(tab.page);
  console.log('   tablette voit z11 :', JSON.stringify(vuTab.z11 || {}),
    '| z12 :', JSON.stringify(vuTab.z12 || {}));
  b.chk('le nouvel appareil reçoit les DEUX saisies concurrentes',
    (vuTab.z11 || {}).tOss === 100 && (vuTab.z12 || {}).tPar === 60,
    { z11: vuTab.z11, z12: vuTab.z12 });

  console.log('\n=== E. Convergence après resynchro des deux appareils ===');
  await synchroniser(tel.page);
  await synchroniser(pc.page);
  await synchroniser(tel.page);
  const fTel = await lireTout(tel.page), fPc = await lireTout(pc.page);
  console.log('   tel z11/z12 :', JSON.stringify(fTel.z11), JSON.stringify(fTel.z12));
  console.log('   pc  z11/z12 :', JSON.stringify(fPc.z11), JSON.stringify(fPc.z12));
  b.chk('après resynchro, le téléphone a les deux saisies',
    (fTel.z11 || {}).tOss === 100 && (fTel.z12 || {}).tPar === 60, { z11: fTel.z11, z12: fTel.z12 });
  b.chk('après resynchro, le PC a les deux saisies',
    (fPc.z11 || {}).tOss === 100 && (fPc.z12 || {}).tPar === 60, { z11: fPc.z11, z12: fPc.z12 });
  const surF = { z11tOss: srvCell(srv, 'z11', 'tOss'), z12tPar: srvCell(srv, 'z12', 'tPar') };
  console.log('   SERVEUR final :', JSON.stringify(surF));
  b.chk('le serveur finit par porter les deux saisies',
    surF.z11tOss === 100 && surF.z12tPar === 60, surF);

  for (const a of [tel, pc, tab]) errs.push(...a.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
