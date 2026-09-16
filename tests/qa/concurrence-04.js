// AXE CONCURRENCE — 04. La divergence créée par un `updated_at` non monotone
// est-elle RATTRAPÉE par un mécanisme quelconque : pull périodique, retour
// d'onglet, redémarrage complet de l'application ?
//
// Reprise du scénario de 03, mais avec le faux serveur branché AVANT le
// démarrage, pour que le pull initial du redémarrage soit réel.
const { chromium } = require('playwright');
const L = require('./concurrence-lib.js');
const SEED = require('../seeds/liss.js');

(async () => {
  const b = L.bilan();
  const nav = await chromium.launch({ executablePath: L.CHROME });
  const errs = [];
  const srv = L.nouveauServeur();

  const tel = await L.ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 } });
  const pc = await L.ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await L.isoler(tel.page); await L.isoler(pc.page);

  console.log('=== Alignement ===');
  await L.synchroniser(tel.page);
  await L.synchroniser(pc.page);
  await L.synchroniser(tel.page);
  console.log('   serveur ts =', L.serveurTs(srv), '| tel vu =', (await L.sonde(tel.page)).vu,
    '| pc vu =', (await L.sonde(pc.page)).vu);

  console.log('\n=== Le PC saisit hors réseau, le téléphone saisit et envoie ===');
  srv.enPanne = true;
  await L.saisir(pc.page, 'z12', 'tPar', 60);
  await L.pousser(pc.page);
  srv.enPanne = false;
  await L.dormir(30);
  await L.saisir(tel.page, 'z11', 'tOss', 100);
  await L.pousser(tel.page);
  const tsApresTel = L.serveurTs(srv);

  console.log('\n=== Le PC revient : fusion + renvoi ===');
  await L.pousser(pc.page);
  const tsApresPc = L.serveurTs(srv);
  console.log('   serveur :', JSON.stringify(L.serveurProgress(srv).z12), '| ts', tsApresTel, '->', tsApresPc);
  b.chk('le serveur porte la saisie du PC après sa fusion',
    L.serveurCellule(srv, 'z12', 'tPar') === 60, L.serveurProgress(srv).z12);
  b.chk('l\'updated_at a changé alors que le contenu a changé',
    tsApresPc !== tsApresTel, { avant: tsApresTel, apres: tsApresPc });

  console.log('\n=== Rattrapage 1 : pull périodique du téléphone (doSyncPull ordinaire) ===');
  await L.tirer(tel.page);
  let v = (await L.lireTout(tel.page)).z12 || {};
  console.log('   tel z12 :', JSON.stringify(v));
  b.chk('le pull périodique rapatrie la saisie du PC', v.tPar === 60, v);

  console.log('\n=== Rattrapage 2 : retour au premier plan (push puis pull) ===');
  await L.visibilite(tel.page, 'hidden');
  await L.visibilite(tel.page, 'visible');
  await tel.page.waitForTimeout(900);
  v = (await L.lireTout(tel.page)).z12 || {};
  console.log('   tel z12 :', JSON.stringify(v));
  b.chk('le retour au premier plan rapatrie la saisie du PC', v.tPar === 60, v);
  console.log('   serveur z12 après ce retour :', JSON.stringify(L.serveurProgress(srv).z12));
  b.chk('le retour au premier plan du téléphone n\'efface pas la saisie du PC sur le serveur',
    L.serveurCellule(srv, 'z12', 'tPar') === 60, L.serveurProgress(srv).z12);

  console.log('\n=== Rattrapage 3 : redémarrage complet du téléphone (pull initial) ===');
  await L.redemarrer(tel, 1600);
  v = (await L.lireTout(tel.page)).z12 || {};
  const sTel = await L.sonde(tel.page);
  console.log('   tel z12 après redémarrage :', JSON.stringify(v), '| sonde :', JSON.stringify(sTel));
  b.chk('un redémarrage complet du téléphone rapatrie la saisie du PC', v.tPar === 60, v);
  console.log('   serveur z12 :', JSON.stringify(L.serveurProgress(srv).z12));
  b.chk('le redémarrage du téléphone n\'efface pas la saisie du PC sur le serveur',
    L.serveurCellule(srv, 'z12', 'tPar') === 60, L.serveurProgress(srv).z12);

  console.log('\n=== Et si un appareil neuf lit maintenant ? ===');
  const tab = await L.ouvrirAppareil(nav, srv, 'tab', { seed: SEED, deviceId: 'tab' });
  await L.isoler(tab.page);
  const vTab = (await L.lireTout(tab.page)).z12 || {};
  console.log('   tablette z12 (après son pull initial) :', JSON.stringify(vTab));
  b.chk('l\'appareil neuf reçoit la saisie du PC', vTab.tPar === 60, vTab);

  for (const a of [tel, pc, tab]) errs.push(...a.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
