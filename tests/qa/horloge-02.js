// AXE « horloge » — 02 : bout en bout, deux appareils, un téléphone en avance.
//
// Question centrale : une saisie faite PLUS TARD sur un appareil à l'heure
// peut-elle être écrasée par une saisie faite PLUS TÔT sur un appareil dont
// l'horloge avance ? On ne raisonne pas : on fait la tournée, on synchronise,
// et on regarde ce qui reste sur chaque écran.
//
// Déroulé (temps RÉEL croissant) :
//   t0      le téléphone (horloge +D) relève z11/tOss = 100
//   t0+ε    le téléphone synchronise
//   t0+2ε   l'ordinateur (à l'heure) synchronise et voit 100
//   t0+3ε   l'ordinateur CORRIGE sur place : z11/tOss = 40 (c'est la vérité
//           la plus récente du chantier), et synchronise
//   t0+4ε   le téléphone synchronise
//   t0+5ε   l'ordinateur synchronise
// À la fin, tout le monde doit afficher 40.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, lireTout, lireStamps, stamps,
  saisir, synchroniser, bilan, isoler,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const H = 3600000, JOUR = 86400000, AN = 365 * JOUR;

async function scenario(nav, b, nom, decalageMs) {
  console.log(`\n========== ${nom} (decalageMs = ${decalageMs}) ==========`);
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'telephone', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 }, decalageMs,
  });
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await isoler(tel.page); await isoler(pc.page);

  // t0 : le téléphone relève 100 sur z11/tOss.
  await saisir(tel.page, 'z11', 'tOss', 100);
  await synchroniser(tel.page);
  const stTel = await lireStamps(tel.page);
  console.log('   horodatage posé par le téléphone sur z11/tOss :', stTel.z11.tOss,
    '(écart au réel :', stTel.z11.tOss - Date.now(), 'ms)');
  console.log('   updated_at écrit sur le serveur :', srv.ligne.updated_at);

  // l'ordinateur voit le relevé du téléphone
  await synchroniser(pc.page);
  const pcVu = await lireTout(pc.page);
  b.chk(`[${nom}] l'ordinateur reçoit bien le relevé du téléphone`,
    (pcVu.z11 || {}).tOss === 100, pcVu.z11);

  // PLUS TARD : l'ordinateur, à l'heure, corrige à 40 sur place.
  await saisir(pc.page, 'z11', 'tOss', 40);
  const stPc = await lireStamps(pc.page);
  console.log('   horodatage posé par l\'ordinateur (postérieur en réel) :', stPc.z11.tOss);
  b.chk(`[${nom}] la saisie de l'ordinateur est bien POSTÉRIEURE en temps réel`,
    stPc.z11.tOss >= stTel.z11.tOss - decalageMs, { pc: stPc.z11.tOss, tel: stTel.z11.tOss });
  await synchroniser(pc.page);
  console.log('   après envoi PC, serveur porte :',
    JSON.stringify((srv.ligne.state.taskProgress.z11 || {}).tOss));

  // Le téléphone se resynchronise (c'est ce qui se passe en rentrant du chantier).
  await synchroniser(tel.page);
  const telFin = await lireTout(tel.page);
  console.log('   TÉLÉPHONE après resynchro, z11.tOss =', (telFin.z11 || {}).tOss);
  b.chk(`[${nom}] le téléphone accepte la correction de l'ordinateur`,
    (telFin.z11 || {}).tOss === 40, telFin.z11);

  // Et l'ordinateur, lui, garde-t-il sa correction ?
  await synchroniser(pc.page);
  const pcFin = await lireTout(pc.page);
  console.log('   ORDINATEUR après resynchro, z11.tOss =', (pcFin.z11 || {}).tOss);
  b.chk(`[${nom}] la correction faite sur l'ordinateur SURVIT à la synchro`,
    (pcFin.z11 || {}).tOss === 40, pcFin.z11);

  // Les deux écrans disent-ils la même chose ?
  b.chk(`[${nom}] les deux appareils convergent`,
    (pcFin.z11 || {}).tOss === (telFin.z11 || {}).tOss,
    { pc: (pcFin.z11 || {}).tOss, tel: (telFin.z11 || {}).tOss });

  // L'utilisateur a-t-il un signe que quelque chose a été défait ?
  const vu = await pc.page.evaluate(() => {
    const chip = document.getElementById('syncchip');
    return { chip: chip ? chip.textContent : null, statut: state.syncStatus,
             enAttente: state.syncPendingSince,
             toasts: Array.from(document.querySelectorAll('.toast, #toast')).map(t => t.textContent) };
  });
  console.log('   ce que voit l\'utilisateur sur l\'ordinateur :', JSON.stringify(vu));
  if ((pcFin.z11 || {}).tOss !== 40) {
    b.chk(`[${nom}] l'utilisateur est AVERTI que sa saisie a été annulée`,
      /futur|horloge|annul|conflit|écras/i.test(JSON.stringify(vu)), vu);
  }

  const ecart = await pc.page.evaluate(() => {
    const at = state.taskProgressAt || {};
    let max = 0;
    for (const z of Object.keys(at)) for (const t of Object.keys(at[z])) max = Math.max(max, at[z][t]);
    return { horodatageMax: max, maintenant: Date.now(), avanceMs: max - Date.now(),
             syncTimestamp: state.syncTimestamp, stampCle: (state.syncKeyStamps || {}).taskProgress };
  });
  console.log('   contamination mesurée sur l\'ordinateur :', JSON.stringify(ecart));
  b.chk(`[${nom}] l'ordinateur ne porte pas d'horodatage de cellule dans le futur`,
    ecart.avanceMs <= 5000, ecart);
  b.chk(`[${nom}] le syncTimestamp de l'ordinateur n'est pas contaminé par le futur`,
    ecart.syncTimestamp <= Date.now() + 5000, ecart);

  const errs = [...tel.errs, ...pc.errs];
  await tel.ctx.close(); await pc.ctx.close();
  return errs;
}

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  for (const [nom, d] of [
    ['tel à l\'heure (témoin)', 0],
    ['tel +1 h', +H],
    ['tel +1 jour', +JOUR],
    ['tel +1 an', +AN],
    ['tel -1 h', -H],
    ['tel -1 jour', -JOUR],
  ]) {
    errs.push(...await scenario(nav, b, nom, d));
  }
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
