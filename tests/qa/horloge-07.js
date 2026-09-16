// AXE « horloge » — 07 : deux appareils décalés DANS LE MÊME SENS (le décalage
// relatif est ce qui compte), puis la contamination des horodatages de CLÉ —
// qui ne concerne plus seulement l'avancement.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, lireTout, stamps,
  saisir, synchroniser, bilan, isoler,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const MIN = 60000, H = 3600000, JOUR = 86400000, AN = 365 * JOUR;

// Les deux appareils décalés de la même façon : l'un relève, l'autre corrige
// après. Rien ne doit être perdu.
async function memeSens(nav, b, nom, dTel, dPc) {
  console.log(`\n--- ${nom} : téléphone ${dTel} ms, ordinateur ${dPc} ms ---`);
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'tel', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 }, decalageMs: dTel });
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc', decalageMs: dPc });
  await isoler(tel.page); await isoler(pc.page);
  await saisir(tel.page, 'z11', 'tOss', 100);
  await synchroniser(tel.page);
  await synchroniser(pc.page);
  await saisir(pc.page, 'z11', 'tOss', 40);      // correction POSTÉRIEURE en réel
  await synchroniser(pc.page);
  await synchroniser(tel.page);
  await synchroniser(pc.page);
  const t = await lireTout(tel.page), p = await lireTout(pc.page);
  console.log('   téléphone :', (t.z11 || {}).tOss, '| ordinateur :', (p.z11 || {}).tOss);
  b.chk(`[${nom}] la correction postérieure est conservée`,
    (p.z11 || {}).tOss === 40 && (t.z11 || {}).tOss === 40,
    { tel: (t.z11 || {}).tOss, pc: (p.z11 || {}).tOss });
  const errs = [...tel.errs, ...pc.errs];
  await tel.ctx.close(); await pc.ctx.close();
  return errs;
}

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];

  console.log('=== A. Décalage COMMUN aux deux appareils ===');
  errs.push(...await memeSens(nav, b, 'tous deux +1 h', +H, +H));
  errs.push(...await memeSens(nav, b, 'tous deux +1 an', +AN, +AN));
  errs.push(...await memeSens(nav, b, 'tous deux -1 jour', -JOUR, -JOUR));
  console.log('\n=== B. Décalage du MÊME SENS mais inégal (5 min d\'écart) ===');
  errs.push(...await memeSens(nav, b, 'tel +1 h 05, pc +1 h', +H + 5 * MIN, +H));
  errs.push(...await memeSens(nav, b, 'tel +1 h, pc +1 h 05', +H, +H + 5 * MIN));

  // ---------------------------------------------------------------------
  console.log('\n=== C. Contamination des horodatages de CLÉ (hors avancement) ===');
  {
    const srv = nouveauServeur();
    const tel = await ouvrirAppareil(nav, srv, 'tel', {
      seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 }, decalageMs: +AN });
    const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
    await isoler(tel.page); await isoler(pc.page);

    // Le téléphone en avance ajoute une entreprise (clé `companies`, arbitrée
    // par l'horodatage de clé — pas cellule par cellule).
    await tel.page.evaluate(() => { state.companies.push({ id: 'c2', name: 'PLOMBERIE DUR' }); save(); });
    await synchroniser(tel.page);
    await synchroniser(pc.page);
    const avant = await pc.page.evaluate(() => ({
      stampCompanies: state.syncKeyStamps.companies, noms: state.companies.map(c => c.name) }));
    console.log('   PC après fusion :', JSON.stringify(avant),
      '(futur ?', avant.stampCompanies > Date.now(), ')');
    b.chk('l\'horodatage de clé « companies » du PC est contaminé par le futur',
      avant.stampCompanies > Date.now() + 60000, avant);

    // Le PC ajoute à son tour une entreprise, aujourd'hui.
    await pc.page.evaluate(() => { state.companies.push({ id: 'c3', name: 'ELEC MARTIN' }); save(); });
    const apres = await pc.page.evaluate(() => ({
      stampCompanies: state.syncKeyStamps.companies, noms: state.companies.map(c => c.name) }));
    console.log('   PC après SA modification :', JSON.stringify(apres));
    b.chk('l\'horodatage de clé du PC RECULE quand il modifie une clé contaminée',
      apres.stampCompanies < avant.stampCompanies,
      { avant: avant.stampCompanies, apres: apres.stampCompanies });

    await synchroniser(pc.page);
    await synchroniser(tel.page);
    await synchroniser(pc.page);
    const fin = await pc.page.evaluate(() => state.companies.map(c => c.name));
    const finTel = await tel.page.evaluate(() => state.companies.map(c => c.name));
    console.log('   entreprises — PC :', JSON.stringify(fin), '| téléphone :', JSON.stringify(finTel));
    b.chk('l\'entreprise ajoutée sur le PC survit à la synchro',
      fin.includes('ELEC MARTIN'), fin);
    b.chk('elle parvient au téléphone', finTel.includes('ELEC MARTIN'), finTel);

    // Même question pour un scalaire ordinaire : le début de période de relevé.
    await tel.page.evaluate(() => { state.avancementReleveDebut = Date.now(); save(); });
    await synchroniser(tel.page);
    await synchroniser(pc.page);
    const debutPc = await pc.page.evaluate(() => state.avancementReleveDebut);
    console.log('   avancementReleveDebut reçu par le PC :', debutPc, '(futur ?', debutPc > Date.now(), ')');
    b.chk('le début de période de relevé n\'est pas placé dans le futur sur le PC',
      debutPc <= Date.now() + 5000, { debutPc, maintenant: Date.now() });
    const cpt = await pc.page.evaluate(() => compterSaisiesPeriode());
    console.log('   compteur de saisies de la période en cours sur le PC :', JSON.stringify(cpt));

    // Et le PC peut-il rouvrir une période correcte ?
    await pc.page.evaluate(() => { state.avancementReleveDebut = Date.now(); save(); });
    await synchroniser(pc.page);
    await synchroniser(tel.page);
    await synchroniser(pc.page);
    const debutFinal = await pc.page.evaluate(() => state.avancementReleveDebut);
    console.log('   après correction sur le PC, valeur finale :', debutFinal,
      '(futur ?', debutFinal > Date.now(), ')');
    b.chk('la correction du PC sur ce scalaire tient face au téléphone en avance',
      debutFinal <= Date.now() + 5000, debutFinal);

    errs.push(...tel.errs, ...pc.errs);
    await tel.ctx.close(); await pc.ctx.close();
  }

  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
