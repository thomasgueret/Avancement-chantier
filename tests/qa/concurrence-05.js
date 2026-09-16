// AXE CONCURRENCE — 05. Diagnostic du REDÉMARRAGE pendant la divergence :
// au démarrage, `reprendreEnvoiEnAttente()` (envoi) et `doSyncPull(true)`
// (lecture) partent EN PARALLÈLE (le premier n'est pas attendu). Qui gagne ?
// Et le push de reprise du démarrage peut-il écraser ce que le serveur porte ?
const { chromium } = require('playwright');
const L = require('./concurrence-lib.js');
const SEED = require('../seeds/liss.js');

(async () => {
  const b = L.bilan();
  const nav = await chromium.launch({ executablePath: L.CHROME });
  const errs = [];
  const srv = L.nouveauServeur();

  const tel = await L.ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel', trace: false });
  const pc = await L.ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await L.isoler(tel.page); await L.isoler(pc.page);
  await L.synchroniser(tel.page); await L.synchroniser(pc.page); await L.synchroniser(tel.page);

  srv.enPanne = true;
  await L.saisir(pc.page, 'z12', 'tPar', 60);
  await L.pousser(pc.page);
  srv.enPanne = false;
  await L.dormir(30);
  await L.saisir(tel.page, 'z11', 'tOss', 100);
  await L.pousser(tel.page);
  await L.pousser(pc.page);          // fusion + renvoi au MÊME updated_at
  console.log('=== état de départ ===');
  console.log('   serveur ts =', L.serveurTs(srv), ' z12 =', JSON.stringify(L.serveurProgress(srv).z12));
  console.log('   tel  :', JSON.stringify(await L.sonde(tel.page)));
  console.log('   tel z12 :', JSON.stringify((await L.lireTout(tel.page)).z12));
  const tsDivergence = L.serveurTs(srv);
  b.chk('point de départ : le téléphone ignore la saisie du PC, mais le serveur l\'a',
    L.serveurCellule(srv, 'z12', 'tPar') === 60 && ((await L.lireTout(tel.page)).z12 || {}).tPar === undefined);

  console.log('\n=== redémarrage du téléphone, journal serveur détaillé ===');
  const nAvant = srv.journal.length;
  await L.redemarrer(tel, 2500);
  const jour = srv.journal.slice(nAvant).map(e => `${e.t}ms ${e.qui} ${e.op}${e.cols ? '(' + e.cols + ')' : ''}${e.updated_at ? ' @' + new Date(e.updated_at).getTime() : ''}${e.ok === false ? ' KO' : ''}`);
  console.log('   ' + jour.join('\n   '));
  const sTel = await L.sonde(tel.page);
  const vTel = (await L.lireTout(tel.page)).z12 || {};
  console.log('   tel z12 :', JSON.stringify(vTel), '| sonde :', JSON.stringify(sTel));
  console.log('   serveur ts =', L.serveurTs(srv), '(départ', tsDivergence + ') z12 =',
    JSON.stringify(L.serveurProgress(srv).z12));
  b.chk('le redémarrage n\'efface pas la saisie du PC du serveur',
    L.serveurCellule(srv, 'z12', 'tPar') === 60, L.serveurProgress(srv).z12);
  b.chk('le redémarrage rapatrie la saisie du PC sur le téléphone', vTel.tPar === 60, vTel);

  // Deuxième prise : le même redémarrage, mais AVEC une saisie en attente sur
  // le téléphone (cas réel : il a saisi hors réseau puis rouvert l'appli).
  console.log('\n=== 2e prise : redémarrage avec un envoi EN ATTENTE ===');
  const srv2 = L.nouveauServeur();
  const t2 = await L.ouvrirAppareil(nav, srv2, 'tel2', { seed: SEED, deviceId: 'tel2' });
  const p2 = await L.ouvrirAppareil(nav, srv2, 'pc2', { seed: SEED, deviceId: 'pc2' });
  await L.isoler(t2.page); await L.isoler(p2.page);
  await L.synchroniser(t2.page); await L.synchroniser(p2.page); await L.synchroniser(t2.page);
  // le PC saisit et envoie normalement
  await L.saisir(p2.page, 'z13', 'tOss', 80);
  await L.pousser(p2.page);
  console.log('   serveur porte z13.tOss =', L.serveurCellule(srv2, 'z13', 'tOss'), 'ts =', L.serveurTs(srv2));
  // le téléphone saisit HORS RÉSEAU puis on le redémarre
  srv2.enPanne = true;
  await L.saisir(t2.page, 'z21', 'tIso', 45);
  await L.pousser(t2.page);
  console.log('   tel2 sonde avant redémarrage :', JSON.stringify(await L.sonde(t2.page)));
  srv2.enPanne = false;
  const n2 = srv2.journal.length;
  await L.redemarrer(t2, 2500);
  console.log('   ' + srv2.journal.slice(n2).map(e => `${e.t}ms ${e.qui} ${e.op}${e.cols ? '(' + e.cols + ')' : ''}${e.updated_at ? ' @' + new Date(e.updated_at).getTime() : ''}${e.ok === false ? ' KO' : ''}`).join('\n   '));
  const sp = L.serveurProgress(srv2);
  console.log('   serveur z13 :', JSON.stringify(sp.z13), '| z21 :', JSON.stringify(sp.z21));
  const loc = await L.lireTout(t2.page);
  console.log('   tel2 z13 :', JSON.stringify(loc.z13), '| z21 :', JSON.stringify(loc.z21));
  console.log('   tel2 sonde :', JSON.stringify(await L.sonde(t2.page)));
  b.chk('la saisie hors réseau du téléphone part au redémarrage',
    (sp.z21 || {}).tIso === 45, sp.z21);
  b.chk('le push de reprise du démarrage n\'écrase pas la saisie du PC',
    (sp.z13 || {}).tOss === 80, sp.z13);
  b.chk('le téléphone a aussi récupéré la saisie du PC',
    (loc.z13 || {}).tOss === 80, loc.z13);

  for (const a of [tel, pc, t2, p2]) errs.push(...a.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
