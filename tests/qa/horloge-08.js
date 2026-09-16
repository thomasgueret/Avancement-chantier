// AXE « horloge » — 08 : l'utilisateur peut-il RÉCUPÉRER ?
//
// Quand la fusion écrase une saisie, `applyRemoteStateMerge` crée d'abord une
// sauvegarde locale (« avant synchro (…) ») que l'utilisateur peut restaurer
// depuis Données → Admin. On vérifie si ce filet rattrape une saisie détruite
// par un horodatage futur.
//
// NB technique : `restoreLocalBackup()` finit par `location.reload()`, or le
// harnais réinjecte le localStorage de la graine à chaque navigation. On
// reproduit donc EXACTEMENT sa logique (stamps de clé à maintenant,
// syncTimestamp à maintenant, syncLastSeenRemoteTs à 0, cellules inchangées)
// puis on rouvre l'appareil sur l'état restauré — équivalent du rechargement.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, lireTout, lireStamps, stamps,
  saisir, synchroniser, bilan, isoler,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const H = 3600000;

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const srv = nouveauServeur();

  // Le téléphone en avance d'une heure relève 100, le PC corrige à 40 après.
  const tel = await ouvrirAppareil(nav, srv, 'tel', {
    seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 }, decalageMs: +H });
  const pc = await ouvrirAppareil(nav, srv, 'pc', { seed: SEED, deviceId: 'pc' });
  await isoler(tel.page); await isoler(pc.page);
  await saisir(tel.page, 'z11', 'tOss', 100);
  await synchroniser(tel.page);
  await synchroniser(pc.page);
  await saisir(pc.page, 'z11', 'tOss', 40);
  await synchroniser(pc.page);
  await synchroniser(tel.page);
  await synchroniser(pc.page);
  const detruit = await lireTout(pc.page);
  console.log('=== La correction du PC a-t-elle été détruite ? z11.tOss =', (detruit.z11 || {}).tOss);
  b.chk('préalable : la correction du PC est bien détruite (sinon ce test ne prouve rien)',
    (detruit.z11 || {}).tOss === 100, detruit.z11);

  // Que trouve l'utilisateur dans la liste des sauvegardes ?
  const liste = await pc.page.evaluate(() => listLocalBackups()
    .then(l => l.map(x => ({ reason: x.reason, ts: x.ts }))));
  console.log('   sauvegardes proposées à l\'utilisateur :');
  for (const s of liste) console.log('     -', new Date(s.ts).toLocaleString('fr-FR'), '|', s.reason);
  b.chk('une sauvegarde « avant synchro » a bien été créée avant l\'écrasement',
    liste.some(s => /avant synchro/.test(s.reason || '')), liste.map(s => s.reason));
  b.chk('le motif de la sauvegarde dit à l\'utilisateur QUELLE saisie va être écrasée',
    liste.some(s => /z11|tOss|40|avancement/i.test(s.reason || '')), liste.map(s => s.reason));

  // Restauration (même logique que le bouton « Restaurer »).
  const restaure = await pc.page.evaluate(async () => {
    const l = await listLocalBackups();
    const cible = l.filter(x => /avant synchro/.test(x.reason || ''))
      .sort((a, c) => c.ts - a.ts)[0];
    const db = await openBackupDB();
    let rec;
    try {
      rec = await idbReq(db.transaction(BACKUP_STORE, 'readonly').objectStore(BACKUP_STORE).get(cible.id));
    } finally { db.close(); }
    const data = JSON.parse(rec.json);
    const now = Date.now();
    const st = {};
    for (const k of Object.keys(data)) {
      if (!SYNC_EXCLUDED_KEYS.has(k) && k !== 'syncKeyStamps') st[k] = now;
    }
    data.syncKeyStamps = st;
    data.syncTimestamp = now;
    data.syncLastSeenRemoteTs = 0;
    return data;
  });
  console.log('   état restauré : z11.tOss =', (restaure.taskProgress.z11 || {}).tOss,
    '| horodatage de la cellule =', (restaure.taskProgressAt.z11 || {}).tOss,
    '(futur ?', (restaure.taskProgressAt.z11 || {}).tOss > Date.now(), ')');
  b.chk('la sauvegarde contient bien la correction du PC (40)',
    (restaure.taskProgress.z11 || {}).tOss === 40, restaure.taskProgress.z11);
  b.chk('la restauration redate les cellules (sinon elle reperdra le même arbitrage)',
    (restaure.taskProgressAt.z11 || {}).tOss >= Date.now() - 60000,
    { stampCellule: (restaure.taskProgressAt.z11 || {}).tOss, maintenant: Date.now() });

  await pc.ctx.close();
  const pc2 = await ouvrirAppareil(nav, srv, 'pc-restaure', { seed: restaure, deviceId: 'pc' });
  await isoler(pc2.page);
  const avantSync = await lireTout(pc2.page);
  console.log('   après restauration, avant synchro : z11.tOss =', (avantSync.z11 || {}).tOss);
  b.chk('la restauration remet bien 40 à l\'écran',
    (avantSync.z11 || {}).tOss === 40, avantSync.z11);

  // Attention à l'interprétation : le dernier écrivain du serveur est
  // l'appareil « pc » lui-même, donc `_sourceDeviceId === DEVICE_ID` et le
  // pull SAUTE la fusion. Ce premier succès ne prouve donc rien.
  console.log('   dernier écrivain de la ligne serveur :', srv.ligne.state._sourceDeviceId);
  await synchroniser(pc2.page);
  const apresSync = await lireTout(pc2.page);
  console.log('   après la première synchro qui suit : z11.tOss =', (apresSync.z11 || {}).tOss);
  b.chk('la restauration résiste à la synchro suivante (ligne écrite par cet appareil : fusion sautée)',
    (apresSync.z11 || {}).tOss === 40, apresSync.z11);

  await synchroniser(tel.page);
  await synchroniser(pc2.page);
  const fin = await lireTout(pc2.page);
  const finTel = await lireTout(tel.page);
  console.log('   après resynchro du téléphone : PC =', (fin.z11 || {}).tOss,
    '| téléphone =', (finTel.z11 || {}).tOss);
  b.chk('la valeur restaurée survit au retour du téléphone en avance',
    (fin.z11 || {}).tOss === 40 && (finTel.z11 || {}).tOss === 40,
    { pc: (fin.z11 || {}).tOss, tel: (finTel.z11 || {}).tOss });

  errs.push(...tel.errs, ...pc2.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
