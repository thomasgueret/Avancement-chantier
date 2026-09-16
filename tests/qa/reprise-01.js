// (1) Réseau COUPÉ, une tournée entière de saisies, réseau REVENU sans qu'on
//     touche à rien : tout doit partir tout seul.
//
// Aucun `isoler()` : ce sont précisément les timers qu'on met à l'épreuve.
// Aucun évènement `online` n'est émis, aucun clic : on veut la reprise seule.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, saisir, sonde, serveurProgress,
  bilan, dormir,
} = require('./reprise-lib.js');
const SEED = require('../seeds/liss.js');

const TOURNEE = [
  ['z11', 'tOss', 100], ['z11', 'tIso', 75],
  ['z12', 'tOss', 100], ['z12', 'tIso', 50],
  ['z13', 'tOss', 100], ['z21', 'tPar', 25],
];

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'tel', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 },
  });

  // --- Démarrage propre : le serveur était vide, il reçoit l'état initial.
  await dormir(2600);
  const base = srv.ecritures;
  console.log('=== A. Départ : serveur alimenté, pastille au vert ===');
  let s = await sonde(tel.page);
  console.log('   sonde :', JSON.stringify(s));
  b.chk('au départ, rien en attente', s.hasPendingPush === false && s.memPending === 0, s);
  b.chk('au départ, la pastille est verte', /Synchronisé/.test(s.chip || ''), s.chip);
  b.chk('le serveur porte bien l\'état initial', !!srv.ligne, { ecritures: base });

  // --- La coupure : le bâtiment sans réseau.
  console.log('\n=== B. Réseau coupé, tournée de 6 saisies ===');
  srv.enPanne = true;
  for (const [z, t, p] of TOURNEE) { await saisir(tel.page, z, t, p); await dormir(200); }
  await dormir(3200);   // l'anti-rebond (1,5 s) a eu le temps d'échouer

  s = await sonde(tel.page);
  console.log('   sonde :', JSON.stringify(s));
  console.log('   tentatives d\'écriture :', srv.tentativesUpsert, ' réussies :', srv.ecritures);
  b.chk('aucune écriture n\'a abouti pendant la coupure', srv.ecritures === base,
    { ecritures: srv.ecritures, base });
  // NB : `doSyncPush` commence par relire `updated_at` (garde anti-écrasement).
  // Sous coupure totale, c'est cette LECTURE qui échoue : le compteur d'upsert
  // ne bouge donc pas. On compte les appels en échec, pas les upserts.
  const echecsReseau = srv.journal.filter(e => e.ok === false).length;
  b.chk('une tentative d\'envoi a bien eu lieu et a échoué (anti-rebond)',
    echecsReseau > 0 && s.statut === 'error', { echecsReseau, statut: s.statut });
  b.chk('une marque d\'attente est posée en mémoire', s.memPending > 0, s.memPending);
  b.chk('la marque d\'attente est PERSISTÉE dans le stockage', s.stoPending > 0, s.stoPending);
  b.chk('la pastille dit « Non envoyé »', /Non envoyé/.test(s.chip || ''), s.chip);
  b.chk('la reprise est armée', s.retryArme === true, { retryArme: s.retryArme, delai: s.retryDelai });
  b.chk('le délai de reprise part à 5 s', s.retryDelai === 5000, s.retryDelai);

  // Les 6 saisies sont-elles au moins sur l'appareil ?
  const local = await tel.page.evaluate(() => {
    const brut = JSON.parse(localStorage.getItem('chantier_v1') || '{}');
    return brut.taskProgress || {};
  });
  const manquantesLocal = TOURNEE.filter(([z, t, p]) => (local[z] || {})[t] !== p);
  b.chk('les 6 saisies de la tournée sont dans le stockage local',
    manquantesLocal.length === 0, manquantesLocal);

  // --- Le réseau revient. On ne fait RIEN : pas d'`online`, pas de clic.
  console.log('\n=== C. Réseau revenu, aucune action de l\'utilisateur ===');
  const onLine = await tel.page.evaluate(() => navigator.onLine);
  b.chk('navigator.onLine n\'a jamais basculé (panne côté serveur)', onLine === true, onLine);
  srv.enPanne = false;
  const t0 = Date.now();
  let attendu = 0;
  while (Date.now() - t0 < 75000) {
    await dormir(500);
    if (srv.ecritures > base) { attendu = Date.now() - t0; break; }
  }
  console.log('   première écriture réussie après ' + attendu + ' ms de réseau rétabli');
  b.chk('la reprise part TOUTE SEULE après le retour du réseau', attendu > 0,
    { attenduMs: attendu, ecritures: srv.ecritures });
  b.chk('la reprise part en moins de 65 s (plafond annoncé : 60 s)',
    attendu > 0 && attendu < 65000, attendu);

  await dormir(1200);
  const distant = serveurProgress(srv);
  const manquantes = TOURNEE.filter(([z, t, p]) => (distant[z] || {})[t] !== p);
  console.log('   serveur, avancement reçu :', JSON.stringify(distant));
  b.chk('les 6 saisies de la tournée sont arrivées sur le serveur',
    manquantes.length === 0, manquantes);

  s = await sonde(tel.page);
  console.log('   sonde finale :', JSON.stringify(s));
  b.chk('après l\'envoi, plus rien en attente en mémoire',
    s.hasPendingPush === false && s.memPending === 0, { p: s.hasPendingPush, m: s.memPending });
  b.chk('la pastille redevient verte quand la donnée est partie',
    /Synchronisé/.test(s.chip || ''), s.chip);
  b.chk('la reprise est désarmée et son délai remis à zéro',
    s.retryArme === false && s.retryDelai === 0, { arme: s.retryArme, delai: s.retryDelai });
  // (9) : le stockage, lui, porte-t-il encore l'ancienne marque ?
  b.chk('[cas 9] le stockage ne porte plus de marque d\'attente après l\'envoi réussi',
    s.stoPending === 0, { stockage: s.stoPending, memoire: s.memPending });

  const code = b.fin(tel.errs);
  await nav.close();
  process.exit(code);
})();
