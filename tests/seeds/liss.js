// Graine « Olivier LISSAGARAY » — le bâtiment où l'utilisateur a perdu deux
// heures de relevé. 2 niveaux, 6 zones, 2 ouvrages, avec l'avancement tel
// qu'il était AVANT la visite de chantier.
//
// Sert de point de départ commun à toutes les suites de synchro : le scénario
// de perte se rejoue sur cet état exact.
const OUV_GO = {
  id: 'ouvGO', name: 'Gros œuvre', unit: 'm²',
  tasks: [
    { id: 'tTrac', name: 'Traçage', ratio: 0.2 },
    { id: 'tOss', name: 'Ossature', ratio: 1.2 },
    { id: 'tIso', name: 'Isolation', ratio: 0.8 },
    { id: 'tPar', name: 'Parement', ratio: 1.5 },
  ],
};
const OUV_MEN = {
  id: 'ouvMEN', name: 'Menuiseries', unit: 'u',
  tasks: [
    { id: 'mPose', name: 'Pose', ratio: 2 },
    { id: 'mFin', name: 'Finitions', ratio: 0.5 },
  ],
};

const ZONES = [
  { id: 'bLISS', name: 'Olivier LISSAGARAY', parentId: null },
  { id: 'n1', name: 'R+1', parentId: 'bLISS' },
  { id: 'n2', name: 'R+2', parentId: 'bLISS' },
  { id: 'z11', name: 'Logement 11', parentId: 'n1' },
  { id: 'z12', name: 'Logement 12', parentId: 'n1' },
  { id: 'z13', name: 'Logement 13', parentId: 'n1' },
  { id: 'z21', name: 'Logement 21', parentId: 'n2' },
  { id: 'z22', name: 'Logement 22', parentId: 'n2' },
  { id: 'z23', name: 'Logement 23', parentId: 'n2' },
];

const zoneOuvrages = {};
for (const z of ['z11', 'z12', 'z13', 'z21', 'z22', 'z23']) {
  zoneOuvrages[z] = [
    { setupId: 'ouvGO', quantity: 60 },
    { setupId: 'ouvMEN', quantity: 4 },
  ];
}

// Avancement d'AVANT la visite : le chantier a déjà tourné quelques semaines.
const AVANT = {
  z11: { tTrac: 100, tOss: 20 },
  z12: { tTrac: 100, tOss: 20 },
  z13: { tTrac: 100 },
  z21: { tTrac: 50 },
};

// Horodatages cohérents : tout ceci date d'il y a une semaine.
const IL_Y_A_UNE_SEMAINE = 1757000000000;   // ~4 septembre 2025, fixe pour la reproductibilité
const taskProgressAt = {};
for (const z of Object.keys(AVANT)) {
  taskProgressAt[z] = {};
  for (const t of Object.keys(AVANT[z])) taskProgressAt[z][t] = IL_Y_A_UNE_SEMAINE;
}

module.exports = {
  companies: [{ id: 'c1', name: 'BIC' }],
  zones: ZONES,
  taskSetups: [OUV_GO, OUV_MEN],
  currentSetupId: 'ouvGO',
  zoneOuvrages,
  taskProgress: JSON.parse(JSON.stringify(AVANT)),
  taskProgressAt,
  avancementReleves: {},
  avancementReleveDebut: IL_Y_A_UNE_SEMAINE,
  zoneUpdated: Object.fromEntries(Object.keys(AVANT).map(z => [z, IL_Y_A_UNE_SEMAINE])),
  avancementZoneId: 'z11',
  recapBuildingId: 'bLISS',
  syncTimestamp: IL_Y_A_UNE_SEMAINE,
  syncKeyStamps: { taskProgress: IL_Y_A_UNE_SEMAINE, taskProgressAt: IL_Y_A_UNE_SEMAINE, zones: IL_Y_A_UNE_SEMAINE },
  syncLastSeenRemoteTs: 0,
};

module.exports.AVANT = AVANT;
module.exports.IL_Y_A_UNE_SEMAINE = IL_Y_A_UNE_SEMAINE;

// Variante HÉRITÉE (avant v1.87) : le même chantier, mais SANS aucun
// horodatage par cellule — c'est l'état de tous les appareils au moment de
// la mise à jour. C'est le cas le plus dangereux, et donc le plus testé.
module.exports.herite = (opts = {}) => {
  const s = JSON.parse(JSON.stringify(module.exports));
  delete s.taskProgressAt;
  delete s.AVANT;
  delete s.IL_Y_A_UNE_SEMAINE;
  delete s.herite;
  if (opts.keyStamp !== undefined) s.syncKeyStamps.taskProgress = opts.keyStamp;
  if (opts.syncTimestamp !== undefined) s.syncTimestamp = opts.syncTimestamp;
  if (opts.sansStamps) { s.syncKeyStamps = {}; delete s.syncTimestamp; }
  if (opts.progress) s.taskProgress = JSON.parse(JSON.stringify(opts.progress));
  return s;
};
