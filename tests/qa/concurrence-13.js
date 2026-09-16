// AXE CONCURRENCE — 13. Largeur de la fenêtre dangereuse, et ce qui tombe
// dedans en plus d'une saisie : une CLÔTURE de relevé, une RESTAURATION.
//
// A. Combien de temps dure le `await createLocialBackup()` de la fusion ?
//    (c'est la durée pendant laquelle toute action de l'utilisateur est perdue)
// B. `cloturerReleve()` pendant la fenêtre.
// C. `restaurerReleve()` pendant la fenêtre — le message dit « restauré ».
const { chromium } = require('playwright');
const L = require('./concurrence-lib.js');
const SEED = require('../seeds/liss.js');

const T = Date.now();
const etatDistant = (cells, ts) => {
  const tp = {}, at = {}, zu = {};
  for (const [z, t, v] of cells) {
    (tp[z] = tp[z] || {})[t] = v; (at[z] = at[z] || {})[t] = ts; zu[z] = ts;
  }
  return { taskProgress: tp, taskProgressAt: at, zoneUpdated: zu,
    syncKeyStamps: { taskProgress: ts, zoneUpdated: ts } };
};

const observerBackup = (page) => page.evaluate(() => {
  if (window.__obsBackup) return;
  window.__obsBackup = true;
  const vrai = window.createLocalBackup;
  window.__dansBackup = false;
  window.createLocalBackup = async (r) => {
    window.__dansBackup = true;
    try { return await vrai(r); } finally { window.__dansBackup = false; }
  };
});
const attendreFenetre = `new Promise(res => { let n = 0; const f = () => {
  if (window.__dansBackup) return res(true);
  if (++n > 3000) return res(false);
  setTimeout(f, 0); }; f(); })`;

(async () => {
  const b = L.bilan();
  const nav = await chromium.launch({ executablePath: L.CHROME });
  const errs = [];
  const srv = L.nouveauServeur();
  const app = await L.ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel' });
  await L.isoler(app.page);

  console.log('=== A. Durée réelle de la sauvegarde de sécurité (la fenêtre) ===');
  const mes = await app.page.evaluate(async () => {
    const un = async () => { const t = performance.now(); await createLocalBackup('mesure'); return performance.now() - t; };
    const petit = [];
    for (let i = 0; i < 5; i++) petit.push(Math.round(await un()));
    const taillePetite = (localStorage.getItem('chantier_v1') || '').length;
    // On gonfle l'état comme un vrai chantier (photos de plans déjà migrées
    // mises à part, le state réel pèse plusieurs centaines de Ko).
    state.__gros = undefined;
    const bourrage = [];
    for (let i = 0; i < 400; i++) bourrage.push({ id: 'x' + i, txt: 'a'.repeat(2000) });
    state.travauxItems = bourrage;           // clé synchronisée ordinaire
    save();
    const gros = [];
    for (let i = 0; i < 5; i++) gros.push(Math.round(await un()));
    const tailleGrosse = (localStorage.getItem('chantier_v1') || '').length;
    state.travauxItems = [];
    save();
    return { petit, gros, taillePetite, tailleGrosse };
  });
  console.log('   état de', mes.taillePetite, 'octets → sauvegarde :', mes.petit.join(', '), 'ms');
  console.log('   état de', mes.tailleGrosse, 'octets → sauvegarde :', mes.gros.join(', '), 'ms');
  const maxi = Math.max(...mes.petit, ...mes.gros);
  b.chk('la fenêtre existe et est mesurable (> 0 ms)', maxi > 0, { petit: mes.petit, gros: mes.gros });

  console.log('\n=== B. cloturerReleve() pendant la fenêtre de fusion ===');
  const app2 = await L.ouvrirAppareil(nav, srv, 'tel2', { seed: SEED, deviceId: 'tel2' });
  await L.isoler(app2.page);
  await observerBackup(app2.page);
  const rb = await app2.page.evaluate(async ([rem, ts, code]) => {
    window.prompt = () => 'Tournée du mardi';
    const avant = JSON.parse(JSON.stringify(state.taskProgress));
    const p = applyRemoteStateMerge(rem, ts);
    const ok = await eval(code);
    cloturerReleve();
    const relevesApres = Object.values(state.avancementReleves || {}).map(r => r.name);
    const pctFige = Object.values(state.avancementReleves || {}).map(r => r.pct);
    await p;
    return { ok, avant, relevesApres, pctFige,
      relevesFin: Object.values(state.avancementReleves || {}).map(r => r.name),
      debut: state.avancementReleveDebut,
      tp: JSON.parse(JSON.stringify(state.taskProgress)),
      sto: JSON.parse(localStorage.getItem('chantier_v1') || '{}').avancementReleves || {} };
  }, [etatDistant([['z11', 'tOss', 100]], T), T, attendreFenetre]);
  console.log('   fenêtre atteinte :', rb.ok);
  console.log('   relevés juste après la clôture :', JSON.stringify(rb.relevesApres));
  console.log('   relevés après la fin de la fusion :', JSON.stringify(rb.relevesFin));
  console.log('   relevés dans le stockage :', JSON.stringify(Object.values(rb.sto).map(r => r.name)));
  b.chk('B. la fenêtre a été atteinte', rb.ok === true);
  b.chk('B. le relevé clôturé pendant la fusion existe encore après',
    rb.relevesFin.length === 1, rb.relevesFin);
  b.chk('B. il est aussi dans le stockage local',
    Object.keys(rb.sto).length === 1, Object.values(rb.sto).map(r => r.name));

  console.log('\n=== B2. Même clôture, mais le distant apporte AUSSI un relevé ===');
  // La clé avancementReleves entre alors dans `toApply` : le bloc écrit à la
  // fin de la fusion a été calculé AVANT la clôture.
  const app2b = await L.ouvrirAppareil(nav, srv, 'tel2b', { seed: SEED, deviceId: 'tel2b' });
  await L.isoler(app2b.page);
  await observerBackup(app2b.page);
  const rb2 = await app2b.page.evaluate(async ([rem, ts, code]) => {
    window.prompt = () => 'Tournée du mardi';
    const p = applyRemoteStateMerge(rem, ts);
    const ok = await eval(code);
    cloturerReleve();
    const juste = Object.values(state.avancementReleves || {}).map(r => r.name);
    await p;
    return { ok, juste,
      fin: Object.values(state.avancementReleves || {}).map(r => r.name),
      sto: Object.values(JSON.parse(localStorage.getItem('chantier_v1') || '{}').avancementReleves || {}).map(r => r.name) };
  }, [Object.assign(etatDistant([['z11', 'tOss', 100]], T), {
    avancementReleves: { relDist: { id: 'relDist', name: 'Relevé du collègue', closedAt: T, startedAt: 1, saisies: 2, pct: 10, taskProgress: {}, taskProgressAt: {} } },
    syncKeyStamps: { taskProgress: T, zoneUpdated: T, avancementReleves: T },
  }), T, attendreFenetre]);
  console.log('   fenêtre atteinte :', rb2.ok);
  console.log('   relevés juste après la clôture :', JSON.stringify(rb2.juste));
  console.log('   relevés après la fusion        :', JSON.stringify(rb2.fin));
  console.log('   relevés dans le stockage       :', JSON.stringify(rb2.sto));
  b.chk('B2. la fenêtre a été atteinte', rb2.ok === true);
  b.chk('B2. le relevé clôturé pendant la fusion survit (et celui du collègue arrive)',
    rb2.fin.includes('Tournée du mardi'), rb2.fin);

  console.log('\n=== C. restaurerReleve() pendant la fenêtre de fusion ===');
  const app3 = await L.ouvrirAppareil(nav, srv, 'tel3', { seed: SEED, deviceId: 'tel3' });
  await L.isoler(app3.page);
  await observerBackup(app3.page);
  const rc = await app3.page.evaluate(async ([rem, ts, code]) => {
    window.confirm = () => true;
    const toasts = [];
    const vraiToast = window.showToast;
    window.showToast = (m, t) => { toasts.push(m); return vraiToast ? vraiToast(m, t) : undefined; };
    // Un relevé figé « propre » : z13 à 100 partout.
    const id = 'relX';
    state.avancementReleves = { [id]: {
      id, name: 'Relevé de référence', startedAt: 1, closedAt: Date.now(), saisies: 4, pct: 42,
      taskProgress: { z13: { tTrac: 100, tOss: 100, tIso: 100, tPar: 100 } },
      taskProgressAt: { z13: { tTrac: 1, tOss: 1, tIso: 1, tPar: 1 } },
    } };
    save();
    const p = applyRemoteStateMerge(rem, ts);
    const ok = await eval(code);
    restaurerReleve(id);
    const juste = JSON.parse(JSON.stringify(state.taskProgress));
    await p;
    window.showToast = vraiToast;
    return { ok, toasts, juste,
      fin: JSON.parse(JSON.stringify(state.taskProgress)),
      sto: JSON.parse(localStorage.getItem('chantier_v1') || '{}').taskProgress || {},
      releves: Object.values(state.avancementReleves || {}).map(r => r.name) };
  }, [etatDistant([['z11', 'tOss', 100]], T), T, attendreFenetre]);
  console.log('   fenêtre atteinte :', rc.ok, '| messages affichés :', JSON.stringify(rc.toasts));
  console.log('   juste après la restauration, zones :', JSON.stringify(Object.keys(rc.juste)));
  console.log('   après la fin de la fusion, zones  :', JSON.stringify(Object.keys(rc.fin)));
  console.log('   dans le stockage, zones           :', JSON.stringify(Object.keys(rc.sto)));
  console.log('   relevés :', JSON.stringify(rc.releves));
  b.chk('C. la fenêtre a été atteinte', rc.ok === true);
  b.chk('C. la restauration est effective après la fusion (z13 à 100, pas de z11/z12 ressuscités)',
    JSON.stringify(Object.keys(rc.fin)) === '["z13"]', Object.keys(rc.fin));
  b.chk('C. si la restauration a été annulée, l\'utilisateur n\'a pas vu « restauré »',
    JSON.stringify(Object.keys(rc.fin)) === '["z13"]' || !rc.toasts.some(t => /restauré/.test(t)),
    rc.toasts);

  for (const x of [app, app2, app2b, app3]) errs.push(...x.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
