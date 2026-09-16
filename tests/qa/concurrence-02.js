// AXE CONCURRENCE — 02. Après la course : pourquoi la saisie perdue ne
// revient-elle pas ? Diagnostic pas à pas du journal du serveur et des
// horodatages de chaque appareil, à chaque étape.
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
const srvVue = (srv) => ({
  updated_at: srv.ligne && srv.ligne.updated_at,
  ts: srv.ligne ? new Date(srv.ligne.updated_at).getTime() : 0,
  z11tOss: ((srv.ligne.state.taskProgress || {}).z11 || {}).tOss,
  z12tPar: ((srv.ligne.state.taskProgress || {}).z12 || {}).tPar,
  z12ParAt: ((srv.ligne.state.taskProgressAt || {}).z12 || {}).tPar,
  src: srv.ligne.state._sourceDeviceId,
});

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const srv = nouveauServeur();

  const tel = await ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel' });
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await isoler(tel.page); await isoler(pc.page);

  console.log('=== mise en place ===');
  await pousser(tel.page); await tirer(tel.page);
  await pousser(pc.page);  await tirer(pc.page);
  console.log('   serveur :', JSON.stringify(srvVue(srv)));
  console.log('   tel :', JSON.stringify(await stamps(tel.page)));
  console.log('   pc  :', JSON.stringify(await stamps(pc.page)));

  console.log('\n=== la course ===');
  await saisir(tel.page, 'z11', 'tOss', 100);
  await saisir(pc.page, 'z12', 'tPar', 60);
  srv.latenceMs = 300;
  const p1 = pousser(tel.page);
  await dormir(60);
  const p2 = pousser(pc.page);
  console.log('   envois :', JSON.stringify(await Promise.all([p1, p2])));
  srv.latenceMs = 0;
  console.log('   journal complet :', JSON.stringify(srv.journal));
  console.log('   serveur :', JSON.stringify(srvVue(srv)));
  console.log('   tel :', JSON.stringify(await stamps(tel.page)));
  console.log('   pc  :', JSON.stringify(await stamps(pc.page)));
  console.log('   pc  z12 local :', JSON.stringify((await lireTout(pc.page)).z12),
    ' stamps :', JSON.stringify((await lireStamps(pc.page)).z12));

  // L'updated_at du serveur a-t-il RECULÉ ? (le dernier écrivain avait une
  // horloge légèrement en retard)
  const j = srv.journal.map(x => new Date(x.updated_at).getTime());
  let recul = false;
  for (let i = 1; i < j.length; i++) if (j[i] < j[i - 1]) recul = true;
  b.chk('l\'updated_at du serveur ne recule jamais', !recul, srv.journal.map(x => x.updated_at));

  console.log('\n=== récupération : le PC pousse à nouveau (il a encore la donnée) ===');
  const ecr = srv.ecritures;
  console.log('   pc pousse :', await pousser(pc.page));
  console.log('   écritures :', srv.ecritures - ecr, '| journal :', JSON.stringify(srv.journal.slice(-2)));
  console.log('   serveur :', JSON.stringify(srvVue(srv)));
  console.log('   pc :', JSON.stringify(await stamps(pc.page)));
  b.chk('un second envoi du PC remet sa saisie sur le serveur',
    srvVue(srv).z12tPar === 60, srvVue(srv));

  console.log('\n=== le téléphone tire ensuite ===');
  console.log('   tel tire :', await tirer(tel.page));
  const t1 = await lireTout(tel.page);
  console.log('   tel z12 :', JSON.stringify(t1.z12), '| tel :', JSON.stringify(await stamps(tel.page)));
  b.chk('le téléphone récupère la saisie du PC par une lecture',
    (t1.z12 || {}).tPar === 60, t1.z12);

  console.log('\n=== puis le téléphone pousse (écrase-t-il de nouveau ?) ===');
  console.log('   tel pousse :', await pousser(tel.page));
  console.log('   serveur :', JSON.stringify(srvVue(srv)));
  b.chk('le renvoi du téléphone ne détruit pas la saisie du PC',
    srvVue(srv).z12tPar === 60, srvVue(srv));

  for (const a of [tel, pc]) errs.push(...a.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
