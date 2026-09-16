// Retrait des onglets ST et Devis (v1.90).
//
// Trois questions : ont-ils vraiment disparu de l'interface ? un chantier qui
// contenait des devis se charge-t-il encore ? et surtout — leurs données
// peuvent-elles REVENIR par la ligne Supabase partagée, que les appareils non
// encore mis à jour continuent d'alimenter ?
const { chromium } = require('playwright');
const {
  CHROME, URL, nouveauServeur, ouvrirAppareil, redemarrer, isoler,
  saisir, synchroniser, bilan,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

// Un état tel qu'il existait AVANT le retrait : avec devis, lignes ST et taux.
// (JSON.parse/stringify pour ne garder que les DONNÉES de la graine : ses
//  helpers exportés ne se sérialisent pas vers la page.)
const BASE = JSON.parse(JSON.stringify(SEED));
delete BASE.AVANT; delete BASE.IL_Y_A_UNE_SEMAINE;
const AVEC_DEVIS = Object.assign({}, BASE, {
  tauxHoraire: 42,
  devis: [{
    id: 'dv1', number: 1, etat: 'valide', avenantNum: '',
    versions: [{ id: 'v1', indice: '0', date: '2026-09-01', lines: [
      { id: 'l1', text: 'Cloisons R+1', amount: 12000, companyId: 'c1', hours: 40 },
    ] }],
  }],
  devisSelectedId: 'dv1',
  devisSelectedVersion: { dv1: 'v1' },
  stEntries: { c1: { conforme: [{ id: 'e1', text: 'Devis n°1 : Cloisons R+1', amount: 12000, sourceDevisLineId: 'l1' }] } },
  stSelectedCompanyId: 'c1',
});

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];

  console.log('=== 1. Les deux onglets ont disparu de l\'interface ===');
  const ctx = await nav.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !/Supabase|net::ERR|Failed to load/.test(t)) errs.push('CONSOLE: ' + t);
  });
  await page.addInitScript(s => localStorage.setItem('chantier_v1', JSON.stringify(s)), AVEC_DEVIS);
  await page.goto(URL);
  await page.waitForTimeout(900);

  b.chk('aucun bouton d\'onglet ST', (await page.$$('.tab-btn[data-page="st"]')).length === 0);
  b.chk('aucun bouton d\'onglet Devis', (await page.$$('.tab-btn[data-page="devis"]')).length === 0);
  b.chk('aucune page ST', (await page.$$('#page-st')).length === 0);
  b.chk('aucune page Devis', (await page.$$('#page-devis')).length === 0);
  b.chk('aucune carte Devis au tableau de bord', (await page.$$('#dashdevis')).length === 0);
  b.chk('aucune carte ST au tableau de bord', (await page.$$('#dashst')).length === 0);
  b.chk('plus de champ Taux horaire dans Données', (await page.$$('#tauxhoraire')).length === 0);
  const nOnglets = (await page.$$('.tab-btn[data-page]')).length;
  console.log('   onglets restants :', nOnglets);
  b.chk('il reste bien les autres onglets', nOnglets >= 8, nOnglets);

  console.log('\n=== 2. Plus aucune trace dans le texte de l\'application ===');
  const texte = await page.evaluate(() => document.body.innerText);
  b.chk('le mot « Devis » n\'apparaît plus nulle part', !/devis/i.test(texte),
    (texte.match(/.{0,40}devis.{0,40}/i) || [''])[0]);
  const html = await page.content();
  b.chk('plus de gestionnaire data-devis-action', !/data-devis-action/.test(html));
  b.chk('plus de gestionnaire data-st-action', !/data-st-action/.test(html));

  console.log('\n=== 3. Un chantier qui CONTENAIT des devis se charge sans erreur ===');
  const etat = await page.evaluate(() => ({
    devis: state.devis, stEntries: state.stEntries, taux: state.tauxHoraire,
    selfCheck: syncSelfCheck(),
  }));
  b.chk('state.devis n\'existe plus', etat.devis === undefined, etat.devis);
  b.chk('state.stEntries n\'existe plus', etat.stEntries === undefined, etat.stEntries);
  b.chk('state.tauxHoraire n\'existe plus', etat.taux === undefined, etat.taux);
  // Le contrôle d'intégrité signale déjà `stockQuery` AVANT ce retrait (clé
  // d'affichage du Magasin, ni persistée ni déclarée transitoire) : on vérifie
  // seulement qu'aucune des clés retirées n'y apparaît.
  b.chk('le contrôle d\'intégrité ne signale aucune clé retirée',
    Array.isArray(etat.selfCheck) && !etat.selfCheck.some(m => /devis|stEntries|tauxHoraire|stSelected/i.test(m)),
    etat.selfCheck);

  // Une saisie, puis on regarde ce qui est réellement écrit en stockage.
  await page.evaluate(() => { setProgress('z11', 'tOss', 60); });
  await page.waitForTimeout(300);
  const stocke = await page.evaluate(() => JSON.parse(localStorage.getItem('chantier_v1')));
  b.chk('les devis ne sont plus écrits en stockage', !('devis' in stocke));
  b.chk('les lignes ST ne sont plus écrites en stockage', !('stEntries' in stocke));
  b.chk('le taux horaire n\'est plus écrit en stockage', !('tauxHoraire' in stocke));
  b.chk('les données du chantier, elles, sont bien là',
    stocke.taskProgress && stocke.taskProgress.z11 && stocke.taskProgress.z11.tOss === 60,
    stocke.taskProgress && stocke.taskProgress.z11);
  await ctx.close();

  console.log('\n=== 4. LE POINT SENSIBLE : la ligne partagée contient encore des devis ===');
  // Un appareil non mis à jour a poussé son état complet, devis compris.
  const srv = nouveauServeur();
  srv.ligne = {
    updated_at: new Date(Date.now() - 60000).toISOString(),
    state: Object.assign({}, AVEC_DEVIS, {
      _sourceDeviceId: 'vieil-appareil',
      syncKeyStamps: { devis: Date.now(), stEntries: Date.now(), tauxHoraire: Date.now(), taskProgress: SEED.IL_Y_A_UNE_SEMAINE },
      syncTimestamp: Date.now() - 60000,
    }),
  };
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await isoler(pc.page);
  await synchroniser(pc.page);
  const apres = await pc.page.evaluate(() => ({
    devis: state.devis, stEntries: state.stEntries, taux: state.tauxHoraire,
    zones: Object.keys(state.taskProgress || {}).length,
  }));
  console.log('   après fusion avec la ligne partagée :', JSON.stringify(apres));
  b.chk('les devis ne rentrent PAS dans le state par la synchro', apres.devis === undefined, apres.devis);
  b.chk('les lignes ST ne rentrent PAS non plus', apres.stEntries === undefined, apres.stEntries);
  b.chk('le taux horaire non plus', apres.taux === undefined, apres.taux);
  b.chk('mais les vraies données du chantier sont bien fusionnées', apres.zones > 0, apres.zones);

  // Et elles ne doivent pas non plus revenir après un redémarrage.
  await redemarrer(pc);
  await isoler(pc.page);
  const apresRedemarrage = await pc.page.evaluate(() => ({ devis: state.devis, stEntries: state.stEntries }));
  b.chk('elles ne reviennent pas au redémarrage suivant',
    apresRedemarrage.devis === undefined && apresRedemarrage.stEntries === undefined, apresRedemarrage);

  // Ce que cet appareil pousse ne doit plus contenir les clés retirées.
  await saisir(pc.page, 'z12', 'tIso', 50);
  await synchroniser(pc.page);
  const pousse = srv.ligne.state;
  b.chk('l\'appareil à jour ne repousse pas les devis au serveur', !('devis' in pousse));
  b.chk('ni les lignes ST', !('stEntries' in pousse));
  console.log('   la ligne partagée est nettoyée :', !('devis' in pousse) && !('stEntries' in pousse));

  console.log('\n=== 5. Les autres onglets fonctionnent toujours ===');
  for (const [p, sel] of [['dashboard', '#dashalerts'], ['cr', '#page-cr'], ['donnees', '#page-donnees'],
                          ['avancement', '#page-avancement'], ['stock', '#page-stock']]) {
    await pc.page.click('.tab-btn[data-page="' + p + '"]').catch(() => {});
    await pc.page.waitForTimeout(250);
    const vu = await pc.page.$$eval(sel, e => e.length);
    b.chk('onglet ' + p + ' : rendu présent', vu === 1, vu);
  }
  const alertes = await pc.page.$eval('#dashalerts', e => e.textContent.length);
  b.chk('la carte « points d\'attention » se rend encore', alertes > 0, alertes);

  errs.push(...pc.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
