// AXE CONCURRENCE — 03. `updated_at` N'EST PAS MONOTONE : il est recopié de
// `state.syncTimestamp`, et la fusion pose `syncTimestamp = max(local, remoteTs)`.
// Un appareil qui fusionne puis renvoie écrit donc une ligne dont l'`updated_at`
// est EXACTEMENT celui qu'il vient de lire. Le contenu du serveur a changé, sa
// version non.
//
// Conséquence : tous les autres appareils, qui comparent `updated_at` à
// `syncLastSeenRemoteTs`, croient être à jour. Ils ne relisent pas — et le
// premier qui renvoie son propre état écrase la saisie qui vient d'arriver.
//
// Scénario 100 % ordinaire, sans course, sans décalage d'horloge :
//   T1  le PC saisit au bureau, mais son réseau est coupé (envoi en attente)
//   T2  le téléphone saisit sur le chantier et envoie  → serveur @ T2
//   T3  le réseau du PC revient : il fusionne et renvoie → serveur @ T2 (!)
//   T4  le téléphone renvoie (n'importe quel déclencheur) → la saisie du PC meurt
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, lireTout, lireStamps, stamps,
  saisir, bilan, isoler, dormir,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const pousser = (page) => page.evaluate(async () => {
  try { await doSyncPush(); return 'ok'; } catch (e) { return 'KO ' + e.message; }
});
const tirer = (page) => page.evaluate(async () => {
  try { await doSyncPull(); return 'ok'; } catch (e) { return 'KO ' + e.message; }
});
const vue = (srv) => {
  const s = srv.ligne ? srv.ligne.state : {};
  const tp = s.taskProgress || {};
  return {
    ts: srv.ligne ? new Date(srv.ligne.updated_at).getTime() : 0,
    src: s._sourceDeviceId,
    z11tOss: (tp.z11 || {}).tOss, z12tPar: (tp.z12 || {}).tPar,
  };
};

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const srv = nouveauServeur();

  const tel = await ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 } });
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await isoler(tel.page); await isoler(pc.page);

  console.log('=== Alignement initial des deux appareils sur la même version ===');
  await pousser(tel.page); await tirer(tel.page);
  await pousser(pc.page);  await tirer(pc.page);
  await tirer(tel.page);
  let sTel = await stamps(tel.page), sPc = await stamps(pc.page);
  console.log('   serveur :', JSON.stringify(vue(srv)));
  console.log('   tel vu =', sTel.vu, '| pc vu =', sPc.vu);
  b.chk('les deux appareils sont alignés sur la version du serveur',
    sTel.vu === vue(srv).ts && sPc.vu === vue(srv).ts, { tel: sTel.vu, pc: sPc.vu, srv: vue(srv).ts });

  console.log('\n=== T1 : le PC saisit, son réseau est coupé — envoi en attente ===');
  srv.enPanne = true;
  await saisir(pc.page, 'z12', 'tPar', 60);
  console.log('   pc pousse (doit échouer) :', await pousser(pc.page));
  srv.enPanne = false;
  sPc = await stamps(pc.page);
  console.log('   pc :', JSON.stringify(sPc));
  b.chk('la saisie du PC est bien marquée en attente', sPc.enAttente > 0, sPc.enAttente);

  console.log('\n=== T2 : le téléphone saisit sur le chantier et envoie ===');
  await dormir(30);
  await saisir(tel.page, 'z11', 'tOss', 100);
  console.log('   tel pousse :', await pousser(tel.page));
  const apresT2 = vue(srv);
  sTel = await stamps(tel.page);
  console.log('   serveur :', JSON.stringify(apresT2), '| tel vu =', sTel.vu);
  b.chk('le relevé du téléphone est sur le serveur', apresT2.z11tOss === 100, apresT2);

  console.log('\n=== T3 : le réseau du PC revient, il fusionne et renvoie ===');
  console.log('   pc pousse :', await pousser(pc.page));
  const apresT3 = vue(srv);
  sPc = await stamps(pc.page);
  console.log('   serveur :', JSON.stringify(apresT3));
  console.log('   pc :', JSON.stringify(sPc));
  b.chk('le serveur porte maintenant LES DEUX saisies', apresT3.z11tOss === 100 && apresT3.z12tPar === 60, apresT3);
  console.log('   updated_at avant T3 =', apresT2.ts, '| après T3 =', apresT3.ts);
  b.chk('la version du serveur (updated_at) AVANCE quand son contenu change',
    apresT3.ts > apresT2.ts, { avant: apresT2.ts, apres: apresT3.ts });

  console.log('\n=== T3bis : le téléphone relit — voit-il la saisie du PC ? ===');
  const lect = srv.lectures;
  console.log('   tel tire :', await tirer(tel.page));
  const telVoit = await lireTout(tel.page);
  console.log('   lectures serveur consommées :', srv.lectures - lect);
  console.log('   tel z12 :', JSON.stringify(telVoit.z12));
  b.chk('une lecture du téléphone rapatrie la saisie du PC',
    (telVoit.z12 || {}).tPar === 60, telVoit.z12);

  console.log('\n=== T4 : le téléphone renvoie (retour d\'onglet, nouvelle saisie, reprise…) ===');
  console.log('   tel pousse :', await pousser(tel.page));
  const apresT4 = vue(srv);
  console.log('   serveur :', JSON.stringify(apresT4));
  b.chk('le renvoi du téléphone NE DÉTRUIT PAS la saisie du PC',
    apresT4.z12tPar === 60, apresT4);

  console.log('\n=== T5 : et le PC ? Sait-il qu\'il a de nouveau quelque chose à envoyer ? ===');
  console.log('   pc tire :', await tirer(pc.page));
  sPc = await stamps(pc.page);
  const chipPc = await pc.page.evaluate(() => (document.getElementById('syncchip') || {}).textContent);
  const pcLocal = await lireTout(pc.page);
  console.log('   pc :', JSON.stringify(sPc), '| chip :', chipPc);
  console.log('   pc garde sa saisie en local :', JSON.stringify(pcLocal.z12));
  b.chk('si la saisie du PC n\'est plus sur le serveur, le PC le détecte (en attente ou chip orange)',
    apresT4.z12tPar === 60 || sPc.enAttente > 0 || /Non envoy/.test(chipPc || ''),
    { srv: apresT4.z12tPar, enAttente: sPc.enAttente, chip: chipPc });

  console.log('\n=== T6 : un appareil neuf (autre ouvrier) lit le serveur ===');
  const tab = await ouvrirAppareil(nav, srv, 'tab', { seed: SEED, deviceId: 'tab' });
  await isoler(tab.page);
  await tirer(tab.page);
  const vuTab = await lireTout(tab.page);
  console.log('   tablette z11 :', JSON.stringify(vuTab.z11), '| z12 :', JSON.stringify(vuTab.z12));
  b.chk('un appareil neuf reçoit les deux saisies',
    (vuTab.z11 || {}).tOss === 100 && (vuTab.z12 || {}).tPar === 60, { z11: vuTab.z11, z12: vuTab.z12 });

  console.log('\n=== T7 : stamps de cellule côté serveur (la pierre tombale est-elle là ?) ===');
  const atSrv = (srv.ligne.state.taskProgressAt || {}).z12 || {};
  console.log('   taskProgressAt.z12 sur le serveur :', JSON.stringify(atSrv));
  console.log('   taskProgressAt.z12 sur le PC      :', JSON.stringify((await lireStamps(pc.page)).z12));
  b.chk('l\'horodatage de la cellule du PC survit sur le serveur si sa valeur y est',
    (apresT4.z12tPar === 60) === (atSrv.tPar > 0), { val: apresT4.z12tPar, at: atSrv.tPar });

  for (const a of [tel, pc, tab]) errs.push(...a.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
