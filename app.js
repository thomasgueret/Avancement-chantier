/* =========================================================
   Suivi de chantier — application PWA
   Stockage local (localStorage) pour cette première version.
   La synchro multi-utilisateurs sera ajoutée ultérieurement.
   ========================================================= */

const STORAGE_KEY = 'chantier_v1';
// Version affichée. Convention : '0.N' correspond au cache 'chantier-vN'
// dans sw.js — toujours bumper les deux ensemble.
const APP_VERSION = '1.85';

// ====================================================================
//   MOT DE PASSE DES ONGLETS PROTÉGÉS (« ST » et « Devis »)
// ====================================================================
// Pour CHANGER le mot de passe : modifiez la valeur ci-dessous (fichier
// app.js, tout en haut). C'est le seul endroit à éditer, et il protège
// les DEUX onglets ST et Devis. Note : c'est une protection d'affichage
// (le code est public côté navigateur), pas un secret cryptographique.
const ST_PASSWORD = 'Thomas123';

// ---------- Supabase (synchro multi-appareils + équipe) ----------
// À remplir avec les valeurs de TON projet Supabase (Settings → API).
// Ces deux valeurs sont publiques par construction (la sécurité repose
// sur la RLS configurée dans le SQL).
const SUPABASE_URL      = 'https://djlxfbnkmixxuxmiikif.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqbHhmYm5rbWl4eHV4bWlpa2lmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MzUyNzcsImV4cCI6MjA5NjUxMTI3N30.84sp5vhAr1MEXMaHhVuhMZwONCsO7CMSWR_GkyjlZkM';
const SUPABASE_SDK_URL  = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Palette de couleurs pour les courbes (accent + 9 couleurs distinctes)
const CHART_COLORS = [
  '#ff671d', // accent (1ère entreprise)
  '#0a84ff', // bleu
  '#2e7d32', // vert
  '#5856d6', // violet
  '#c62828', // rouge
  '#0277bd', // bleu clair foncé
  '#7b1fa2', // magenta
  '#00796b', // sarcelle
  '#a17500', // or
  '#455a64'  // ardoise
];
const TOTAL_KEY = '__total__';
const TOTAL_COLOR = '#1f1b16';

// ---------- State ----------
const state = {
  companies: [],          // [{ id, name }]
  zones: [],              // [{ id, name, parentId }] — arborescence à plat
  taskSetups: [],         // [{ id, name, unit, tasks: [...] }] — ouvrages (configurations)
  currentSetupId: null,   // ouvrage en cours d'édition (onglet Données → Tâches)
  zoneOuvrages: {},       // { [zoneId]: [{ setupId, quantity }] } — ouvrages affectés à une zone, chacun avec sa quantité
  zoneCollapsed: {},      // { [zoneId]: true } — zones repliées dans l'arborescence
  taskProgress: {},       // { [zoneId]: { [taskId]: percent 0..100 } }
  zoneUpdated: {},        // { [zoneId]: timestamp (ms) — dernière modif d'avancement }
  avancementZoneId: null, // zone affichée dans l'onglet Avancement
  recapBuildingId: null,  // zone racine sélectionnée dans Avancement → Récapitulatif
  recapPeriod: '7',       // période de comparaison du récapitulatif (UI)
  recapCurveMode: 'pct',  // courbe en % ou en heures (UI)
  recapCurveZoom: 'auto', // échelle de temps de la courbe (UI)
  zonePickerCollapsed: {}, // { [zoneId]: true } — branches repliées dans les sélecteurs de zone (UI)
  // Planning par zone racine (Données → Planning) : permet de tracer la
  // courbe d'avancement d'un bâtiment sur SA propre période, au lieu de
  // rejouer partout celle du chantier.
  zoneDates: {},          // { [zoneId]: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', color } }
  ganttZoom: 'mois',      // échelle du planning : 'mois' | 'semaines' | 'jours' (UI)
  // Tableau de bord Avancement : un point d'historique par jour, pour la
  // courbe d'avancement et le calcul du rythme.
  // { 'YYYY-MM-DD': { pct, hDone, hBudget } }
  avancementHistory: {},
  // Administratif → Sécurité : documents administratifs par entreprise
  adminDocs: {},          // { [companyId]: [{ id, name, receivedAt: 'YYYY-MM-DD' | null }] }
  // Administratif → eCheckIn : ouvriers + pièces administratives par ouvrier
  workers: [],            // [{ id, companyId, name }]
  workerDocs: {},         // { [workerId]: { onSite, employmentType, [docId]: valeur } } — valeur dépend du type du doc
  docs: [                  // liste ordonnée des documents administratifs paramétrés
    { id: 'doc1', label: 'Doc 1', type: 'echeance', scope: 'both', required: true },
    { id: 'doc2', label: 'Doc 2', type: 'echeance', scope: 'both', required: true },
    { id: 'doc3', label: 'Doc 3', type: 'echeance', scope: 'both', required: true },
    { id: 'doc4', label: 'Doc 4', type: 'echeance', scope: 'both', required: true }
  ],
  echeckinCollapsed: {},  // { [companyId]: true } — entreprises repliées dans eCheckIn
  presences: {},          // { 'YYYY-MM-DD': [{ id, companyId, count }] }
  weather:   {},          // { 'YYYY-MM-DD': { [companyId]: true } } — entreprises en intempéries ce jour-là
  stockEntries: [],
  // Catalogue optionnel : { [clé normalisée du nom] : { key, name, unit,
  // min, leadDays, supplier, eOTP, notes } }. Une fiche s'ajoute à la volée
  // et n'est jamais un préalable à la saisie d'un mouvement.
  stockArticles: {},
  stockSettings: { alertDays: 7, coverDays: 15 },  // réglages projet
  stockPeriod: '30',      // fenêtre de consommation du Stock (UI)
  stockSort: 'statut',    // tri du Magasin (UI)
  stockQuery: '',         // recherche du Magasin (UI)
  stockMoveFilter: 'all', // filtre de type du journal (UI)       // [{ id, type: 'reception' | 'inventaire', article, qty, unit, unitPrice, eOTP, date, notes }]
  consommableEntries: [], // [{ id, orderId, date, notes, product, reference, qty, unit, unitPrice, eOTP }]
  consoProducts: [],      // registre canonique : [{ name, reference, unitPrice }]
  eotps: [],              // lignes de budget eOTP : [{ id, code, label, budget }]
  eotpRegistryInitialized: false, // flag de migration douce (une fois)
  eotpUnitsInitialized: false,    // flag de migration des unités € / h (une fois)
  // Suivi des heures : données par eOTP (indexées par eotpId, survit au renommage du code).
  // Suivi des heures organisé par semaines (instantanés pour comparer les écarts).
  heuresWeeks: [],
  // Ordre et regroupement des lignes du suivi des heures, communs à toutes
  // les semaines : [{ t: 'g', id, name }, { t: 'e', id: <eotpId> }, …].
  // Une ligne appartient à la rubrique qui la précède dans cette liste.
  heuresLayout: [],
  // Catégories de colonnes repliées dans le suivi des heures. Confort de
  // lecture propre à l'appareil : voir SYNC_EXCLUDED_KEYS.
  heuresColsCollapsed: [],
  heuresActiveWeekId: '',   // id de la semaine affichée
  // Données par semaine puis par eOTP :
  // { [weekId]: { [eotpId]: { selected, budgetHeures, unite, qteTotal, qteRealisee, sap, correction, pumaCumule } } }
  heuresData: {},
  heuresSapDate: '03/04',   // hérité (v1.21) — migré vers la 1re semaine, ignoré ensuite
  consoRecapMode: 'product', // 'product' | 'eotp' : axe de regroupement du récap Consommable
  stockCBMode: 'product',    // 'product' | 'eotp' : axe de regroupement du récap CB Stock
  projectStart: '',          // date ISO YYYY-MM-DD : début prévu du chantier
  projectEnd: '',            // date ISO YYYY-MM-DD : fin prévue du chantier
  tauxHoraire: 0,            // €/h — valorisation de la main d'œuvre (devis)
  workBatches: [],           // Proto : lots de travaux [{ id, name, color }]
  // Proto : plans organisés en dossiers (multi-plans).
  // Les anciens champs protoPlan/W/H sont migrés au 1er load.
  protoFolders: [],          // [{ id, name }]
  protoPlans: [],            // [{ id, folderId, name, dataUrl, w, h }]
  protoActivePlanId: '',     // id du plan affiché (vide = aucun plan actif)
  protoFilterLotId: '',      // filtre par lot ('' = tous)
  protoFilterTitle: '',      // filtre par titre de tâche ('' = toutes)
  protoFilterStatuses: ['todo', 'doing', 'done'], // statuts affichés
  // Champs hérités (v0.63) — gardés pour migration douce, ignorés ensuite
  protoPlan: '',
  protoPlanW: 0,
  protoPlanH: 0,
  // Proto : formes posées sur le plan
  // [{ id, planId, type:'point'|'line'|'rect',
  //    coords:{cx,cy} | {x1,y1,x2,y2} | {x,y,w,h},
  //    lotId, title, date, status:'todo'|'doing'|'done' }]
  protoShapes: [],
  // CR (comptes-rendus) : un CR par semaine et par entreprise.
  // crEntries[companyId][weekId][sectionKey] = [{ id, text }]
  // crCollapsed[companyId][weekId][sectionKey | '_company'] = bool
  // crAvancementVisible[companyId][weekId] = bool (défaut true)
  crEntries: {},
  crCollapsed: {},
  crSelectedCompanyId: null, // entreprise affichée dans le slider CR (UI per-device)
  crAvancementVisible: {},
  crAdminVisible: {},        // { [companyId]: { [weekId]: bool } } — aperçu Administratif
  crEffectifsVisible: {},    // { [companyId]: { [weekId]: bool } } — aperçu Effectifs (10 derniers jours)
  crSectionLabels: {},       // { [sectionKey]: 'label surchargé' } — renommage des rubriques built-in
  crCustomSections: [],      // [{ key: 'custom_<uid>', label }] — rubriques ajoutées par l'utilisateur
  crWeeks: {},               // { [companyId]: [{ id, label, createdAt }] }
  crSelectedWeekId: {},      // { [companyId]: weekId } — semaine active (UI per-device)
  // ST (sous-traitants) : lignes texte + montants € par groupe et par entreprise.
  // { [companyId]: { [groupKey]: [{ id, text, amount, sourceDevisLineId? }] } }
  stEntries: {},
  stSelectedCompanyId: null, // entreprise affichée dans le slider ST (UI per-device)
  // Devis : [{ id, number, etat, avenantNum,
  //   versions: [{ id, indice: '0'|'A'|'B'…, date, lines: [{ id, text,
  //     amount, companyId, hoursText, hours, materielText, materielAmount,
  //     materiauxText, materiauxAmount }] }] }]
  // Le DERNIER indice est la version courante (celle qui alimente ST).
  devis: [],
  devisSelectedId: '',       // devis affiché (UI per-device)
  devisSelectedVersion: {},  // { [devisId]: versionId } — indice affiché (UI per-device)
  // Travaux : matrice du scope chantier — lots (lignes, depuis Données →
  // Lots) × localisations (colonnes), une matrice PAR ZONE sélectionnée.
  // travauxCells[zoneId][lotId][locationId] = description de l'ouvrage.
  travauxLocations: [],      // [{ id, name }]
  travauxItems: [],          // hérité v1.47 (prestations libres) — conservé, plus affiché
  travauxCells: {},          // hérité v1.48 (matrice lots×localisations) — conservé, plus affiché
  travauxSelectedLevel: 1,   // hérité (UI per-device)
  travauxSelectedZoneId: '', // hérité (UI per-device)
  travauxLotFilter: '',      // hérité (UI per-device)
  // Travaux v1.51 : le CCTP du chantier, en 3 vues sur les mêmes données
  // (Visite = par lieu, CCTP = par lot, Carnet = paramétrage).
  // Structure calquée sur un CCTP : LOT (Données → Lots) → CHAPITRE → ARTICLE.
  travauxOuvrages: [],       // [{ id, name, lotId }] — chapitres d'ouvrage
  // [{ id, ouvrageId, title, text, remplacement, specs: [{ id, label, value }],
  //    everywhere, zones: { [zoneId]: true }, localisation }]
  travauxPrescriptions: [],
  travauxVisitePath: [],     // chemin de zones de la vue Visite (UI per-device)
  travauxVisiteDeep: false,  // inclure les sous-zones dans la Visite (UI per-device)
  // Synchronisation (modèle simplifié : un seul jeu partagé via Supabase)
  syncStatus: 'idle',        // 'idle' | 'syncing' | 'error' | 'offline'
  syncTimestamp: 0,          // ms epoch — dernier changement local connu
  syncLastPulled: 0,         // ms epoch — dernier pull réussi depuis le serveur
  // Horodatage PAR CLÉ du dernier changement local ({ [clé]: ms epoch }).
  // Voyage dans le payload de synchro : permet la fusion clé par clé au
  // pull (au lieu d'un écrasement intégral « last-write-wins » qui a déjà
  // fait perdre des données — cf. plans Proto).
  syncKeyStamps: {},
  // updated_at (ms) de la dernière version serveur vue par CET appareil.
  // Sert de garde au push : si le serveur a bougé depuis, on fusionne
  // d'abord. Persisté localement, jamais synchronisé.
  syncLastSeenRemoteTs: 0,
  currentDate: todayISO(),
  chartHidden: {},        // { [companyId]: true } — entreprises masquées du graphique
  chartRange: 30          // 7 | 30 | 'all'
};


// ---------- Persistence ----------
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Pas de données locales (nouvel appareil) : on saute la lecture mais
    // les migrations plus bas DOIVENT quand même tourner (migrateSetups
    // crée la configuration par défaut, etc.).
    if (!raw) { runPostLoadMigrations(); return; }
    const data = JSON.parse(raw);
    if (data.companies) state.companies = data.companies;
    if (data.zones) state.zones = data.zones;
    if (data.taskSetups) state.taskSetups = data.taskSetups;
    if (data.currentSetupId) state.currentSetupId = data.currentSetupId;
    if (data.zoneOuvrages) state.zoneOuvrages = data.zoneOuvrages;
    if (data.zoneCollapsed) state.zoneCollapsed = data.zoneCollapsed;
    if (data.taskProgress) state.taskProgress = data.taskProgress;
    if (data.zoneUpdated) state.zoneUpdated = data.zoneUpdated;
    if (data.zonePickerCollapsed && typeof data.zonePickerCollapsed === 'object') state.zonePickerCollapsed = data.zonePickerCollapsed;
    if (data.zoneDates && typeof data.zoneDates === 'object') state.zoneDates = data.zoneDates;
    if (GANTT_ZOOMS.some(z => z.key === data.ganttZoom)) state.ganttZoom = data.ganttZoom;
    if (data.avancementHistory && typeof data.avancementHistory === 'object') state.avancementHistory = data.avancementHistory;
    if (data.avancementZoneId) state.avancementZoneId = data.avancementZoneId;
    if (data.recapBuildingId) state.recapBuildingId = data.recapBuildingId;
    if (typeof data.recapPeriod === 'string') state.recapPeriod = data.recapPeriod;
    if (data.recapCurveMode === 'heures' || data.recapCurveMode === 'pct') state.recapCurveMode = data.recapCurveMode;
    if (typeof data.recapCurveZoom === 'string') state.recapCurveZoom = data.recapCurveZoom;
    if (data.adminDocs) state.adminDocs = data.adminDocs;
    if (data.workers) state.workers = data.workers;
    if (data.workerDocs) state.workerDocs = data.workerDocs;
    if (data.docs && data.docs.length > 0) {
      state.docs = data.docs;
    } else if (data.docLabels || data.docTypes) {
      // Migration v0.32 → docs[] : on reconstruit à partir des anciens maps
      state.docs = ['doc1', 'doc2', 'doc3', 'doc4'].map(id => ({
        id,
        label: data.docLabels?.[id] || ('Doc ' + id.replace('doc', '')),
        type: data.docTypes?.[id] || 'echeance',
        scope: 'both',
        required: true
      }));
    }
    // Garantit que chaque doc a un champ `required` (défaut true) pour
    // les sauvegardes antérieures à l'ajout du flag d'obligation.
    for (const d of state.docs) if (typeof d.required !== 'boolean') d.required = true;
    if (data.echeckinCollapsed) state.echeckinCollapsed = data.echeckinCollapsed;
    if (data.presences) state.presences = data.presences;
    if (data.weather)   state.weather   = data.weather;
    if (data.stockEntries) state.stockEntries = data.stockEntries;
    if (data.stockArticles && typeof data.stockArticles === 'object') state.stockArticles = data.stockArticles;
    if (data.stockSettings && typeof data.stockSettings === 'object') state.stockSettings = data.stockSettings;
    if (typeof data.stockPeriod === 'string') state.stockPeriod = data.stockPeriod;
    if (typeof data.stockSort === 'string') state.stockSort = data.stockSort;
    if (typeof data.stockMoveFilter === 'string') state.stockMoveFilter = data.stockMoveFilter;
    if (data.consommableEntries) state.consommableEntries = data.consommableEntries;
    if (data.consoProducts) state.consoProducts = data.consoProducts;
    if (data.eotps) state.eotps = data.eotps;
    if (typeof data.eotpRegistryInitialized === 'boolean') state.eotpRegistryInitialized = data.eotpRegistryInitialized;
    if (typeof data.eotpUnitsInitialized === 'boolean') state.eotpUnitsInitialized = data.eotpUnitsInitialized;
    if (data.heuresData && typeof data.heuresData === 'object') state.heuresData = data.heuresData;
    if (typeof data.heuresSapDate === 'string') state.heuresSapDate = data.heuresSapDate;
    if (Array.isArray(data.heuresWeeks)) state.heuresWeeks = data.heuresWeeks;
    if (Array.isArray(data.heuresLayout)) state.heuresLayout = data.heuresLayout;
    if (Array.isArray(data.heuresColsCollapsed)) state.heuresColsCollapsed = data.heuresColsCollapsed;
    if (typeof data.heuresActiveWeekId === 'string') state.heuresActiveWeekId = data.heuresActiveWeekId;
    if (data.consoRecapMode === 'product' || data.consoRecapMode === 'eotp') state.consoRecapMode = data.consoRecapMode;
    if (data.stockCBMode === 'product' || data.stockCBMode === 'eotp') state.stockCBMode = data.stockCBMode;
    if (typeof data.projectStart === 'string') state.projectStart = data.projectStart;
    if (typeof data.projectEnd === 'string') state.projectEnd = data.projectEnd;
    if (typeof data.tauxHoraire === 'number') state.tauxHoraire = data.tauxHoraire;
    if (Array.isArray(data.workBatches)) state.workBatches = data.workBatches;
    if (Array.isArray(data.protoFolders)) state.protoFolders = data.protoFolders;
    if (Array.isArray(data.protoPlans))   state.protoPlans   = data.protoPlans;
    if (typeof data.protoActivePlanId === 'string') state.protoActivePlanId = data.protoActivePlanId;
    if (typeof data.protoFilterLotId   === 'string') state.protoFilterLotId  = data.protoFilterLotId;
    if (typeof data.protoFilterTitle   === 'string') state.protoFilterTitle  = data.protoFilterTitle;
    if (Array.isArray(data.protoFilterStatuses)) state.protoFilterStatuses = data.protoFilterStatuses;
    if (typeof data.protoPlan === 'string') state.protoPlan = data.protoPlan;
    if (Number.isFinite(data.protoPlanW)) state.protoPlanW = data.protoPlanW;
    if (Number.isFinite(data.protoPlanH)) state.protoPlanH = data.protoPlanH;
    if (Array.isArray(data.protoShapes)) state.protoShapes = data.protoShapes;
    if (data.crEntries   && typeof data.crEntries   === 'object') state.crEntries   = data.crEntries;
    if (data.crCollapsed && typeof data.crCollapsed === 'object') state.crCollapsed = data.crCollapsed;
    if (data.crAvancementVisible && typeof data.crAvancementVisible === 'object') state.crAvancementVisible = data.crAvancementVisible;
    if (data.crAdminVisible      && typeof data.crAdminVisible      === 'object') state.crAdminVisible      = data.crAdminVisible;
    if (data.crEffectifsVisible  && typeof data.crEffectifsVisible  === 'object') state.crEffectifsVisible  = data.crEffectifsVisible;
    if (data.crSectionLabels     && typeof data.crSectionLabels     === 'object') state.crSectionLabels     = data.crSectionLabels;
    if (Array.isArray(data.crCustomSections))                                     state.crCustomSections    = data.crCustomSections;
    if (data.crWeeks && typeof data.crWeeks === 'object') state.crWeeks = data.crWeeks;
    if (data.crSelectedCompanyId) state.crSelectedCompanyId = data.crSelectedCompanyId;
    if (data.crSelectedWeekId && typeof data.crSelectedWeekId === 'object') state.crSelectedWeekId = data.crSelectedWeekId;
    if (data.stEntries && typeof data.stEntries === 'object') state.stEntries = data.stEntries;
    if (data.stSelectedCompanyId) state.stSelectedCompanyId = data.stSelectedCompanyId;
    if (Array.isArray(data.devis)) state.devis = data.devis;
    if (typeof data.devisSelectedId === 'string') state.devisSelectedId = data.devisSelectedId;
    if (data.devisSelectedVersion && typeof data.devisSelectedVersion === 'object') state.devisSelectedVersion = data.devisSelectedVersion;
    if (Array.isArray(data.travauxLocations)) state.travauxLocations = data.travauxLocations;
    if (Array.isArray(data.travauxItems)) state.travauxItems = data.travauxItems;
    if (data.travauxCells && typeof data.travauxCells === 'object') state.travauxCells = data.travauxCells;
    if (Number.isFinite(data.travauxSelectedLevel)) state.travauxSelectedLevel = data.travauxSelectedLevel;
    if (typeof data.travauxSelectedZoneId === 'string') state.travauxSelectedZoneId = data.travauxSelectedZoneId;
    if (typeof data.travauxLotFilter === 'string') state.travauxLotFilter = data.travauxLotFilter;
    if (Array.isArray(data.travauxOuvrages)) state.travauxOuvrages = data.travauxOuvrages;
    if (Array.isArray(data.travauxPrescriptions)) state.travauxPrescriptions = data.travauxPrescriptions;
    if (Array.isArray(data.travauxVisitePath)) state.travauxVisitePath = data.travauxVisitePath;
    if (typeof data.travauxVisiteDeep === 'boolean') state.travauxVisiteDeep = data.travauxVisiteDeep;
    if (data.chartHidden) state.chartHidden = data.chartHidden;
    if (data.chartRange) state.chartRange = data.chartRange;
    if (typeof data.syncTimestamp === 'number') state.syncTimestamp = data.syncTimestamp;
    if (data.syncKeyStamps && typeof data.syncKeyStamps === 'object') state.syncKeyStamps = data.syncKeyStamps;
    if (typeof data.syncLastSeenRemoteTs === 'number') state.syncLastSeenRemoteTs = data.syncLastSeenRemoteTs;
    // Champs hérités (ancien modèle à liste unique) → migrés ensuite
    if (data.tasks) state._legacyTasks = data.tasks;
    if (data.zoneHasTasks) state._legacyZoneHasTasks = data.zoneHasTasks;
    // Champs hérités (Phase A : un ouvrage et une quantité par zone) → migrés
    if (data.zoneSetup) state._legacyZoneSetup = data.zoneSetup;
    if (data.zoneQty) state._legacyZoneQty = data.zoneQty;
  } catch (e) {
    console.warn('Lecture stockage impossible', e);
  }
  runPostLoadMigrations();
}

// Migrations post-load. TOUTES doivent tourner AVANT initSyncStamps : le
// baseline (_syncJsonCache + seed des stamps) doit refléter l'état DÉJÀ
// migré, sinon le 1er save() prend le reformatage d'une migration pour une
// modif utilisateur « de maintenant » et tamponne la clé à l'heure du
// démarrage — ce qui a fait gagner des données périmées lors de la fusion
// et effacé des effectifs. (Régression corrigée en v1.30.)
function runPostLoadMigrations() {
  migrateConsoProductsFromEntries();
  migrateEOTPsFromConsoEntries();
  migrateEOTPUnits();
  migrateProtoPlansFromLegacy();
  migrateCRState();
  migrateHeuresWeeks();
  migratePresences();
  migrateSetups();
  migrateDevisVersions();
  initSyncStamps();
}

// Snapshot des clés persistées en localStorage (source de vérité unique,
// partagée entre save() et le self-check d'intégrité de la synchro).
function buildPersistedData() {
  return {
    companies: state.companies,
    zones: state.zones,
    taskSetups: state.taskSetups,
    currentSetupId: state.currentSetupId,
    zoneOuvrages: state.zoneOuvrages,
    zoneCollapsed: state.zoneCollapsed,
    taskProgress: state.taskProgress,
    zoneUpdated: state.zoneUpdated,
    zonePickerCollapsed: state.zonePickerCollapsed,
    zoneDates: state.zoneDates,
    ganttZoom: state.ganttZoom,
    avancementHistory: state.avancementHistory,
    avancementZoneId: state.avancementZoneId,
    recapBuildingId: state.recapBuildingId,
    recapPeriod: state.recapPeriod,
    recapCurveMode: state.recapCurveMode,
    recapCurveZoom: state.recapCurveZoom,
    adminDocs: state.adminDocs,
    workers: state.workers,
    workerDocs: state.workerDocs,
    docs: state.docs,
    echeckinCollapsed: state.echeckinCollapsed,
    presences: state.presences,
    weather: state.weather,
    stockEntries: state.stockEntries,
    stockArticles: state.stockArticles,
    stockSettings: state.stockSettings,
    stockPeriod: state.stockPeriod,
    stockSort: state.stockSort,
    stockMoveFilter: state.stockMoveFilter,
    consommableEntries: state.consommableEntries,
    consoProducts: state.consoProducts,
    eotps: state.eotps,
    eotpRegistryInitialized: state.eotpRegistryInitialized,
    eotpUnitsInitialized: state.eotpUnitsInitialized,
    heuresData: state.heuresData,
    heuresSapDate: state.heuresSapDate,
    heuresWeeks: state.heuresWeeks,
    heuresLayout: state.heuresLayout,
    heuresColsCollapsed: state.heuresColsCollapsed,
    heuresActiveWeekId: state.heuresActiveWeekId,
    consoRecapMode: state.consoRecapMode,
    stockCBMode: state.stockCBMode,
    projectStart: state.projectStart,
    projectEnd: state.projectEnd,
    tauxHoraire: state.tauxHoraire,
    workBatches: state.workBatches,
    protoFolders: state.protoFolders,
    protoPlans: state.protoPlans,
    protoActivePlanId: state.protoActivePlanId,
    protoFilterLotId: state.protoFilterLotId,
    protoFilterTitle: state.protoFilterTitle,
    protoFilterStatuses: state.protoFilterStatuses,
    protoShapes: state.protoShapes,
    crEntries: state.crEntries,
    crCollapsed: state.crCollapsed,
    crAvancementVisible: state.crAvancementVisible,
    crAdminVisible: state.crAdminVisible,
    crEffectifsVisible: state.crEffectifsVisible,
    crSectionLabels: state.crSectionLabels,
    crCustomSections: state.crCustomSections,
    crWeeks: state.crWeeks,
    crSelectedCompanyId: state.crSelectedCompanyId,
    crSelectedWeekId: state.crSelectedWeekId,
    stEntries: state.stEntries,
    stSelectedCompanyId: state.stSelectedCompanyId,
    devis: state.devis,
    devisSelectedId: state.devisSelectedId,
    devisSelectedVersion: state.devisSelectedVersion,
    travauxLocations: state.travauxLocations,
    travauxItems: state.travauxItems,
    travauxCells: state.travauxCells,
    travauxSelectedLevel: state.travauxSelectedLevel,
    travauxSelectedZoneId: state.travauxSelectedZoneId,
    travauxLotFilter: state.travauxLotFilter,
    travauxOuvrages: state.travauxOuvrages,
    travauxPrescriptions: state.travauxPrescriptions,
    travauxVisitePath: state.travauxVisitePath,
    travauxVisiteDeep: state.travauxVisiteDeep,
    chartHidden: state.chartHidden,
    chartRange: state.chartRange,
    syncTimestamp: state.syncTimestamp,
    syncKeyStamps: state.syncKeyStamps,
    syncLastSeenRemoteTs: state.syncLastSeenRemoteTs
  };
}

// Clés du state volontairement NON persistées (état d'exécution pur).
// Toute autre clé du state doit figurer dans buildPersistedData(), sinon
// le self-check ci-dessous la signale : c'est le garde-fou contre les
// « données d'un nouvel onglet oubliées de la synchro ».
const TRANSIENT_STATE_KEYS = new Set([
  'syncStatus',      // état réseau courant
  'syncLastPulled',  // horloge de session
  'currentDate',     // curseur « aujourd'hui » (recalculé au boot)
  'protoPlan', 'protoPlanW', 'protoPlanH' // héritage v0.63, migré au load
]);

// Vérifie la couverture persistance/synchro de toutes les clés du state.
// Appelé au boot : signale en console toute clé ni persistée, ni déclarée
// transitoire — et toute clé exclue de la synchro qui n'existe plus.
function syncSelfCheck() {
  const persisted = new Set(Object.keys(buildPersistedData()));
  const issues = [];
  for (const k in state) {
    if (k.startsWith('_')) continue;
    if (!persisted.has(k) && !TRANSIENT_STATE_KEYS.has(k)) {
      issues.push(`clé « ${k} » ni persistée (save) ni déclarée transitoire — elle sera perdue au rechargement et jamais synchronisée`);
    }
  }
  for (const k of SYNC_EXCLUDED_KEYS) {
    if (!(k in state)) issues.push(`clé exclue de la synchro « ${k} » absente du state (obsolète ?)`);
  }
  if (issues.length) console.warn('[SyncSelfCheck] ⚠️\n - ' + issues.join('\n - '));
  else console.info('[SyncSelfCheck] ✓ toutes les clés du state sont couvertes (persistance + synchro)');
  return issues;
}

// Cache des JSON par clé du dernier save : permet de détecter QUELLES
// clés ont changé (→ bump de leur stamp) sans re-stringifier deux fois.
let _syncJsonCache = null;

// Initialise le cache + amorce les stamps au premier chargement (migration
// depuis les versions sans syncKeyStamps : toutes les clés datées du
// dernier changement local connu).
function initSyncStamps() {
  if (!state.syncKeyStamps || typeof state.syncKeyStamps !== 'object') state.syncKeyStamps = {};
  const data = buildPersistedData();
  _syncJsonCache = {};
  const seed = state.syncTimestamp || 0;
  for (const k of Object.keys(data)) {
    _syncJsonCache[k] = JSON.stringify(data[k] === undefined ? null : data[k]);
    if (!SYNC_EXCLUDED_KEYS.has(k) && k !== 'syncKeyStamps' && !(k in state.syncKeyStamps)) {
      state.syncKeyStamps[k] = seed;
    }
  }
}

// Sauvegarde locale. Retourne true si l'écriture localStorage a réussi —
// false = stockage plein (quota) : la donnée n'est PAS persistée et
// l'utilisateur doit en être informé par l'appelant ou par le toast ici.
let _lastQuotaToastAt = 0;
function save() {
  const now = Date.now();
  // 1) Détection des clés modifiées → bump de leur stamp (fusion synchro).
  //    Le JSON de chaque clé est assemblé à la main pour ne stringifier
  //    qu'une seule fois (les plans pèsent lourd).
  // NB : dans buildPersistedData, syncKeyStamps est déclarée APRÈS toutes
  // les clés métier — quand on la sérialise, les bumps de ce save sont
  // donc déjà posés (l'itération suit l'ordre de déclaration).
  const data = buildPersistedData();
  if (!_syncJsonCache) _syncJsonCache = {};
  const parts = [];
  for (const k of Object.keys(data)) {
    const j = JSON.stringify(data[k] === undefined ? null : data[k]);
    if (_syncJsonCache[k] !== j) {
      // Pendant l'application d'un état distant, les stamps sont posés par
      // la fusion elle-même (valeurs du serveur) — on ne bump pas.
      if (!_syncApplying && !SYNC_EXCLUDED_KEYS.has(k) && k !== 'syncKeyStamps') {
        state.syncKeyStamps[k] = now;
      }
      _syncJsonCache[k] = j;
    }
    parts.push(JSON.stringify(k) + ':' + j);
  }
  const json = '{' + parts.join(',') + '}';

  // 2) Écriture localStorage — un échec (quota plein) est SIGNALÉ, pas
  //    avalé : sans ça l'utilisateur croit ses données sauvegardées alors
  //    qu'elles disparaîtront au prochain rechargement.
  let ok = true;
  try { localStorage.setItem(STORAGE_KEY, json); }
  catch (e) {
    ok = false;
    console.error('localStorage save KO (quota ?)', e);
    if (now - _lastQuotaToastAt > 30000 && typeof showToast === 'function') {
      _lastQuotaToastAt = now;
      showToast('⚠️ Stockage local plein : les dernières modifications ne sont PAS sauvegardées. Supprimez des plans ou libérez de l\'espace.', 'error');
    }
  }
  // 3) Synchro : à chaque save, on bump le timestamp et on schedule un
  //    push vers Supabase (sauf pendant l'application de l'état distant).
  if (!_syncApplying) {
    state.syncTimestamp = now;
    _hasPendingPush = true;
    if (typeof schedulePush === 'function') schedulePush();
  }
  return ok;
}

// ---------- Utils ----------
function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toISO(d);
}
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function formatDateFR(iso) {
  const d = fromISO(iso);
  const weekday = d.toLocaleDateString('fr-FR', { weekday: 'long' });
  const full = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return { weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1), full };
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- Setups (configurations de tâches) ----------
function getCurrentSetup() {
  return state.taskSetups.find(s => s.id === state.currentSetupId) || state.taskSetups[0] || null;
}
function getSetup(id) {
  return state.taskSetups.find(s => s.id === id) || null;
}
// Liste des ouvrages affectés à une zone, résolus en { setup, quantity }
function getZoneOuvrages(zoneId) {
  const list = state.zoneOuvrages[zoneId] || [];
  return list
    .map(o => ({ setup: getSetup(o.setupId), quantity: o.quantity || 0 }))
    .filter(o => o.setup);
}
function zoneIsTaskBearing(zoneId) {
  return getZoneOuvrages(zoneId).length > 0;
}

// Migration : ancien modèle (liste unique state.tasks + booléen zoneHasTasks)
// → nouveau modèle (configurations). Garantit toujours au moins une config
// et une unité par configuration ('m²' par défaut).
function migrateSetups() {
  if (state.taskSetups.length === 0) {
    const setupId = uid();
    state.taskSetups = [{ id: setupId, name: 'Configuration 1', unit: 'm²', tasks: state._legacyTasks || [] }];
    state.currentSetupId = setupId;
    if (state._legacyZoneHasTasks) {
      // Ancien modèle (v1) : on affecte ce premier ouvrage directement aux zones
      // marquées, sans passer par le champ intermédiaire zoneSetup.
      if (!state._legacyZoneSetup) state._legacyZoneSetup = {};
      for (const zid of Object.keys(state._legacyZoneHasTasks)) {
        if (state._legacyZoneHasTasks[zid]) state._legacyZoneSetup[zid] = setupId;
      }
    }
  }
  if (!state.currentSetupId || !getSetup(state.currentSetupId)) {
    state.currentSetupId = state.taskSetups[0].id;
  }
  // Reprend si possible l'unité d'une zone héritée pour seeder setup.unit
  for (const setup of state.taskSetups) {
    if (setup.unit) continue;
    let unit = null;
    if (state._legacyZoneSetup && state._legacyZoneQty) {
      for (const [zid, sid] of Object.entries(state._legacyZoneSetup)) {
        if (sid === setup.id && state._legacyZoneQty[zid]?.unit) {
          unit = state._legacyZoneQty[zid].unit;
          break;
        }
      }
    }
    setup.unit = unit || 'm²';
  }
  // Phase B : convertit l'ancien modèle « un ouvrage + une quantité par zone »
  // en tableau d'ouvrages affectés à chaque zone.
  if (state._legacyZoneSetup) {
    for (const zid of Object.keys(state._legacyZoneSetup)) {
      const sid = state._legacyZoneSetup[zid];
      if (!sid || !getSetup(sid)) continue;
      if (!state.zoneOuvrages[zid]) state.zoneOuvrages[zid] = [];
      // Évite de dupliquer si déjà présent
      if (!state.zoneOuvrages[zid].some(o => o.setupId === sid)) {
        const qty = state._legacyZoneQty?.[zid]?.value || 0;
        state.zoneOuvrages[zid].push({ setupId: sid, quantity: qty });
      }
    }
  }
  delete state._legacyTasks;
  delete state._legacyZoneHasTasks;
  delete state._legacyZoneSetup;
  delete state._legacyZoneQty;
}

function getCompany(id) {
  return state.companies.find(c => c.id === id);
}
function companyColor(companyId) {
  const idx = state.companies.findIndex(c => c.id === companyId);
  return idx < 0 ? '#999999' : CHART_COLORS[idx % CHART_COLORS.length];
}
function shortDateFR(iso) {
  const d = fromISO(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function niceMax(v) {
  if (v <= 0) return 5;
  const buckets = [5, 10, 15, 20, 30, 40, 50, 80, 100, 150, 200, 300, 500];
  for (const b of buckets) if (v <= b) return b;
  return Math.ceil(v / 100) * 100;
}

// ---------- Rendering ----------
function renderAll() {
  renderDate();
  renderEntries();
  renderCompanies();
  renderZones();
  renderSetupBar();
  renderTasks();
  renderChart();
  renderLegend();
  renderRecapTable();
  renderAvancement();
  // Un point d'avancement daté du jour dès l'ouverture : la courbe se
  // construit même si l'on ne visite pas le récapitulatif.
  stampAvancementHistory(true);
  renderAdministratif();
  renderDocLabelsConfig();
  renderEOTPsConfig();
  renderProjectDates();
  renderZonePlanning();
  renderTauxHoraire();
  renderWorkBatchesConfig();
  renderProto();
  renderStock();
  renderConsommable();
  renderCR();
  renderST();
  renderDevis();
  renderTravaux();
  renderHeures();
  renderDashboard();
  renderBackupsList();     // async, best-effort
  renderPlanSyncStatus();  // async, best-effort
}

function renderDate() {
  const { weekday, full } = formatDateFR(state.currentDate);
  document.getElementById('dateweekday').textContent = weekday;
  document.getElementById('datefull').textContent = full;
  document.getElementById('datepicker').value = state.currentDate;
}

function renderEntries() {
  const list = document.getElementById('entrylist');
  const empty = document.getElementById('emptystate');
  list.innerHTML = '';

  if (state.companies.length === 0) {
    empty.classList.add('show');
    document.getElementById('totalcount').textContent = '0';
    document.getElementById('totalsub').textContent = 'personne';
    return;
  }
  empty.classList.remove('show');

  const entries = state.presences[state.currentDate] || [];
  let total = 0;

  for (const company of state.companies) {
    const entry = entries.find(e => e.companyId === company.id);
    const count = entry ? entry.count : 0;
    total += count;

    const onWeather = isCompanyOnWeather(state.currentDate, company.id);
    const li = document.createElement('li');
    li.className = 'entry-item' + (count === 0 ? ' is-zero' : '') + (onWeather ? ' is-weather' : '');
    li.innerHTML = `
      <div class="entry-company"></div>
      <button class="weather-toggle" data-action="weather" aria-label="Marquer en intempéries">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17.5 14a4 4 0 0 0 0-8 7 7 0 0 0-13.16-1A4.5 4.5 0 0 0 4 14h13.5Z"/>
          <rect x="6" y="16" width="2" height="4" rx="1"/>
          <rect x="11" y="16" width="2" height="4" rx="1"/>
          <rect x="16" y="16" width="2" height="4" rx="1"/>
        </svg>
      </button>
      <div class="counter">
        <button class="counter-btn" data-action="dec" aria-label="Diminuer">−</button>
        <span class="counter-value"></span>
        <button class="counter-btn" data-action="inc" aria-label="Augmenter">+</button>
      </div>
    `;
    li.querySelector('.entry-company').textContent = company.name;
    li.querySelector('.counter-value').textContent = count;
    const weatherBtn = li.querySelector('[data-action="weather"]');
    if (onWeather) {
      weatherBtn.classList.add('active');
      weatherBtn.setAttribute('aria-label', 'Retirer le statut intempéries');
    }
    weatherBtn.addEventListener('click', () => toggleCompanyWeather(company.id));
    const decBtn = li.querySelector('[data-action="dec"]');
    if (count === 0) decBtn.disabled = true;
    decBtn.addEventListener('click', () => decrementCount(company.id));
    li.querySelector('[data-action="inc"]').addEventListener('click', () => incrementCount(company.id));
    list.appendChild(li);
  }

  document.getElementById('totalcount').textContent = total;
  document.getElementById('totalsub').textContent = total > 1 ? 'personnes' : 'personne';
}

// ---------- Chart (graphique évolution effectifs) ----------
function getChartDates() {
  const all = Object.keys(state.presences).filter(d => state.presences[d]?.length).sort();
  if (all.length === 0) return [];
  if (state.chartRange === 'all') return all;
  const n = state.chartRange;
  const maxDate = fromISO(all[all.length - 1]);
  const cutoff = new Date(maxDate);
  cutoff.setDate(cutoff.getDate() - (n - 1));
  const cutoffISO = toISO(cutoff);
  return all.filter(d => d >= cutoffISO);
}

function computeSeries(dates) {
  // Pour chaque entreprise, compte total par date (somme si plusieurs entrées)
  const series = {};
  for (const c of state.companies) series[c.id] = dates.map(() => 0);
  dates.forEach((date, i) => {
    for (const entry of state.presences[date] || []) {
      if (series[entry.companyId]) series[entry.companyId][i] += entry.count;
    }
  });
  return series;
}

function renderChart() {
  const svg = document.getElementById('chart');
  const empty = document.getElementById('chartempty');
  if (!svg) return;

  const dates = getChartDates();
  const visibleCompanies = state.companies.filter(c => !state.chartHidden[c.id]);

  if (dates.length === 0) {
    svg.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const series = computeSeries(dates);
  // Série Total : somme de TOUTES les entreprises par date (indépendante des toggles)
  const totalSeries = dates.map((_, i) => {
    let sum = 0;
    for (const c of state.companies) sum += (series[c.id]?.[i] || 0);
    return sum;
  });
  const showTotal = !state.chartHidden[TOTAL_KEY];

  const valuesForScale = visibleCompanies.flatMap(c => series[c.id] || [0]);
  if (showTotal) valuesForScale.push(...totalSeries);
  const maxVal = Math.max(0, ...valuesForScale);
  const yMax = niceMax(maxVal);

  // Dimensions du viewBox — calées sur la largeur réelle du conteneur, à
  // raison d'une unité par pixel. Avec un viewBox fixe (500×300) et une
  // largeur de 100 %, le graphique était mis à l'échelle de la page : sur un
  // 24 pouces il occupait plus de 1 000 px de haut et les libellés d'axes
  // étaient grossis d'autant. Ici la hauteur reste bornée et le texte garde
  // sa taille, quelle que soit la largeur d'écran.
  const wrap = svg.parentElement;
  const measured = wrap ? Math.round(wrap.getBoundingClientRect().width) : 0;
  const VB_W = measured > 0 ? Math.max(320, measured) : 720;   // 0 = onglet masqué
  const VB_H = Math.max(240, Math.min(380, Math.round(VB_W * 0.3)));
  svg.setAttribute('viewBox', `0 0 ${VB_W} ${VB_H}`);
  // MR laisse la place à la moitié du dernier libellé de date, centré sur le
  // bord droit du tracé : sans marge, « 14/08 » était rogné par le viewBox.
  const ML = 36, MR = 24, MT = 12, MB = 32;
  const plotL = ML, plotR = VB_W - MR;
  const plotT = MT, plotB = VB_H - MB;
  const plotW = plotR - plotL;
  const plotH = plotB - plotT;

  const xOf = (i) => dates.length === 1 ? (plotL + plotW / 2) : plotL + (plotW * i) / (dates.length - 1);
  const yOf = (v) => plotB - (plotH * v) / yMax;

  const parts = [];

  // Lignes de grille horizontales + labels Y (5 ticks)
  const TICKS = 4;
  for (let i = 0; i <= TICKS; i++) {
    const v = (yMax * i) / TICKS;
    const y = yOf(v);
    parts.push(`<line class="grid-line" x1="${plotL}" y1="${y}" x2="${plotR}" y2="${y}" />`);
    parts.push(`<text class="axis-label" x="${plotL - 6}" y="${y + 4}" text-anchor="end">${Math.round(v)}</text>`);
  }

  // Axe X (ligne du bas) et labels
  parts.push(`<line class="axis-line" x1="${plotL}" y1="${plotB}" x2="${plotR}" y2="${plotB}" />`);
  // Un libellé de date tous les ~86 px : 6 sur un téléphone, une vingtaine
  // sur un grand écran — la largeur gagnée sert à lire plus de dates.
  const maxLabels = Math.max(3, Math.min(dates.length, Math.floor(plotW / 86)));
  const labelIndices = new Set();
  if (dates.length <= maxLabels) {
    for (let i = 0; i < dates.length; i++) labelIndices.add(i);
  } else {
    const step = (dates.length - 1) / (maxLabels - 1);
    for (let i = 0; i < maxLabels; i++) labelIndices.add(Math.round(i * step));
  }
  labelIndices.forEach(i => {
    parts.push(`<text class="axis-label" x="${xOf(i)}" y="${plotB + 18}" text-anchor="middle">${shortDateFR(dates[i])}</text>`);
  });

  // Helper de tracé : path + points
  const drawSerie = (values, color, strokeWidth, pointRadius) => {
    if (dates.length === 1) {
      parts.push(`<circle class="data-point" cx="${xOf(0)}" cy="${yOf(values[0])}" r="${pointRadius + 0.5}" fill="${color}" />`);
      return;
    }
    const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');
    parts.push(`<path class="data-line" d="${d}" stroke="${color}" stroke-width="${strokeWidth}" />`);
    if (dates.length <= 20) {
      values.forEach((v, i) => {
        parts.push(`<circle class="data-point" cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="${pointRadius}" fill="${color}" />`);
      });
    }
  };

  // Courbes par entreprise
  for (const company of visibleCompanies) {
    const values = series[company.id];
    if (!values || !values.length) continue;
    drawSerie(values, companyColor(company.id), 2.2, 3.5);
  }

  // Courbe Total dessinée en dernier (au-dessus) si visible
  if (showTotal && state.companies.length > 0) {
    drawSerie(totalSeries, TOTAL_COLOR, 3.2, 4);
  }

  svg.innerHTML = parts.join('');
}

function renderLegend() {
  const list = document.getElementById('legendlist');
  if (!list) return;
  list.innerHTML = '';

  if (state.companies.length === 0) {
    const li = document.createElement('li');
    li.className = 'legend-item';
    li.style.justifyContent = 'center';
    li.style.color = 'var(--text-3)';
    li.style.cursor = 'default';
    li.textContent = 'Ajoutez des entreprises dans l\'onglet Données.';
    list.appendChild(li);
    return;
  }

  const makeItem = ({ key, name, color, isTotal }) => {
    const hidden = !!state.chartHidden[key];
    const li = document.createElement('li');
    li.className = 'legend-item' + (hidden ? ' off' : '') + (isTotal ? ' legend-item-total' : '');
    li.innerHTML = `
      <span class="legend-swatch"></span>
      <span class="legend-name"></span>
      <span class="legend-check">
        <svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
      </span>
    `;
    li.querySelector('.legend-swatch').style.background = color;
    li.querySelector('.legend-name').textContent = name;
    li.addEventListener('click', () => toggleCompanyVisibility(key));
    return li;
  };

  // Total en tête
  list.appendChild(makeItem({ key: TOTAL_KEY, name: 'Total', color: TOTAL_COLOR, isTotal: true }));

  // Entreprises ensuite
  for (const company of state.companies) {
    list.appendChild(makeItem({ key: company.id, name: company.name, color: companyColor(company.id) }));
  }
}

function toggleCompanyVisibility(companyId) {
  if (state.chartHidden[companyId]) delete state.chartHidden[companyId];
  else state.chartHidden[companyId] = true;
  save();
  renderChart();
  renderLegend();
}

function setChartRange(range) {
  state.chartRange = range;
  save();
  document.querySelectorAll('.chip-btn').forEach(b => {
    b.classList.toggle('active', String(b.dataset.range) === String(range));
  });
  renderChart();
  renderRecapTable();
}

// ---------- Tableau de bord ----------
// Vue globale agrégeant les autres onglets. Pensé desktop (3 colonnes)
// mais responsive jusqu'à 1 colonne sur mobile.
const STOCK_ALERT_THRESHOLD_DAYS = 7; // jours ouvrés avant épuisement

function renderDashboard() {
  if (!document.getElementById('page-dashboard')) return;
  renderDashboardVitals();
  renderDashboardAlerts();
  renderDashboardCurve();
  renderDashboardDocAlerts();
  renderDashboardStockAlerts();
  renderDashboardConsommable();
  renderDashboardEOTPAlerts();
  renderDashboardHeures();
  renderDashboardDevis();
  renderDashboardST();
  renderDashboardTravaux();
  renderDashboardCR();
  renderDashboardCompaniesPresence();
  renderDashboardBuildings();
}

// ====================================================================
//   SANTÉ DU PROJET — indicateurs vitaux et points d'attention
//   Le tableau de bord ne recalcule rien pour son compte : il consomme
//   les mêmes moteurs que les récapitulatifs (avancement pondéré par les
//   heures, planning, rythme), pour qu'un chiffre lu ici soit exactement
//   celui lu dans l'onglet correspondant.
// ====================================================================

// --- Bandeau des indicateurs vitaux ---
function renderDashboardVitals() {
  const el = document.getElementById('dashvitals');
  if (!el) return;
  el.innerHTML = '';
  const model = computeAvancementModel('');
  const planning = computeAvancementPlanning(model.pct);
  const velocity = computeAvancementVelocity();
  const alerts = computeProjectAlerts();
  const worst = alerts.length ? alerts[0].sev : null;
  const date = state.currentDate;
  const presences = state.presences[date] || [];
  const present = presences.reduce((s, e) => s + (e.count || 0), 0);
  const presentCompanies = presences.filter(e => (e.count || 0) > 0).length;

  const head = dashEl('div', 'dash-vitals-head');
  head.appendChild(dashEl('span', 'dash-vitals-eyebrow', 'SANTÉ DU PROJET'));
  const { full } = formatDateFR(date);
  head.appendChild(dashEl('span', 'dash-vitals-date', full));
  el.appendChild(head);

  const strip = dashEl('div', 'dash-vitals');
  const tile = (opts) => {
    const t = dashEl('button', 'dash-vital' + (opts.tone ? ' is-' + opts.tone : ''));
    t.type = 'button';
    t.appendChild(dashEl('span', 'dash-vital-label', opts.label));
    const v = dashEl('span', 'dash-vital-value');
    v.appendChild(dashEl('span', 'dash-vital-num', opts.value));
    if (opts.unit) v.appendChild(dashEl('span', 'dash-vital-unit', opts.unit));
    t.appendChild(v);
    if (opts.gauge != null) {
      const g = dashEl('span', 'dash-vital-gauge');
      const f = dashEl('span', 'dash-vital-gauge-fill' + (opts.tone ? ' is-' + opts.tone : ''));
      f.style.width = Math.max(0, Math.min(100, opts.gauge)) + '%';
      g.appendChild(f);
      t.appendChild(g);
    }
    if (opts.sub) t.appendChild(dashEl('span', 'dash-vital-sub', opts.sub));
    if (opts.page) t.addEventListener('click', () => { switchPage(opts.page); if (opts.sub2) switchSubPage(opts.sub2[0], opts.sub2[1]); });
    strip.appendChild(t);
  };

  const pctTone = model.pct >= 99.95 ? 'ok' : (model.pct >= 50 ? 'accent' : (model.pct > 0 ? 'warn' : 'idle'));
  tile({
    label: 'Avancement', value: model.hBudget > 0 || model.pct > 0 ? formatPct(Math.round(model.pct * 10) / 10) : '—',
    unit: '%', gauge: model.pct, tone: pctTone,
    sub: model.weighting === 'heures' ? 'pondéré par les heures' : 'pondération de repli',
    page: 'avancement', sub2: ['avancement', 'recap']
  });
  if (planning) {
    tile({
      label: 'Écart au planning',
      value: (planning.ecart >= 0 ? '+' : '−') + formatPct(Math.abs(Math.round(planning.ecart * 10) / 10)),
      unit: '%', tone: planning.ecart >= 0 ? 'ok' : 'bad',
      sub: (planning.ecart >= 0 ? 'en avance' : 'en retard') + ' · attendu ' + formatPct(Math.round(planning.pctTemps * 10) / 10) + ' %',
      page: 'avancement', sub2: ['avancement', 'recap']
    });
    tile({
      label: 'Calendrier', value: String(planning.remainingDays), unit: 'j restants',
      gauge: planning.pctTemps, tone: 'info',
      sub: planning.remainingWorkDays + ' j ouvrés · fin le ' + fmtFR(planning.end)
        + (velocity && velocity.etaISO ? ' · projetée ' + fmtFR(velocity.etaISO) : ''),
      page: 'avancement', sub2: ['avancement', 'recap']
    });
  } else {
    tile({ label: 'Calendrier', value: '—', tone: 'idle', sub: 'dates non renseignées (Données → Admin.)', page: 'donnees' });
  }
  const weatherCount = Object.keys(state.weather?.[date] || {}).length;
  tile({
    label: 'Effectif du jour', value: String(present), unit: present > 1 ? 'personnes' : 'personne',
    tone: present > 0 ? 'accent' : 'idle',
    sub: presentCompanies + '/' + state.companies.length + ' entreprise' + (state.companies.length > 1 ? 's' : '') + ' présente' + (presentCompanies > 1 ? 's' : '')
      + (weatherCount ? ' · ' + weatherCount + ' en intempéries' : ' · aucune intempérie'),
    page: 'effectifs'
  });
  const nAlert = alerts.reduce((s, a) => s + 1, 0);
  tile({
    label: 'Points d\'attention', value: String(nAlert),
    unit: nAlert > 1 ? 'sujets' : 'sujet',
    tone: worst === 'danger' ? 'bad' : (worst === 'warning' ? 'warn' : 'ok'),
    sub: nAlert === 0 ? 'rien à signaler' : (worst === 'danger' ? 'dont des sujets bloquants' : 'à surveiller')
  });
  el.appendChild(strip);
}

// --- Agrégation des points d'attention, toutes sources confondues ---
// Chaque entrée : { sev, n, label, detail, page, sub } — sev pilote le tri
// et la couleur, page/sub le saut vers l'onglet concerné.
function computeProjectAlerts() {
  const out = [];
  // Le libellé s'accorde au compteur : « 6 ouvriers », « 1 ouvrier ».
  // Un « (s) » systématique passe mal dans un document de pilotage.
  const push = (sev, n, one, many, detail, page, sub) => {
    if (!n) return;
    out.push({ sev, n, label: (Number(n) > 1 ? many : one), detail, page, sub });
  };

  // Administratif — documents obligatoires
  let nExpired = 0, nDanger = 0, nWarning = 0;
  for (const worker of state.workers) {
    const empType = getWorkerDocs(worker.id).employmentType;
    let maxIdx = -1;
    for (const docId of getApplicableDocIds(empType)) {
      if (!isDocRequired(docId)) continue;
      const idx = STATUS_WORST_ORDER.indexOf(getDocStatus(worker.id, docId));
      if (idx > maxIdx) maxIdx = idx;
    }
    const worst = maxIdx >= 0 ? STATUS_WORST_ORDER[maxIdx] : null;
    if (worst === 'expired') nExpired++;
    else if (worst === 'danger') nDanger++;
    else if (worst === 'warning') nWarning++;
  }
  push('danger', nExpired, 'ouvrier avec un document périmé', 'ouvriers avec un document périmé', 'Administratif → eCheckIn', 'administratif');
  push('warning', nDanger, 'ouvrier dont un document expire sous 3 jours', 'ouvriers dont un document expire sous 3 jours', 'Administratif → eCheckIn', 'administratif');
  push('info', nWarning, 'ouvrier dont un document expire sous 7 jours', 'ouvriers dont un document expire sous 7 jours', 'Administratif → eCheckIn', 'administratif');

  // Stock — statuts issus du modèle (couverture, mini et délai d'appro par article)
  const stockModel = computeStockModel();
  const nOut = stockModel.articles.filter(a => a.status === 'rupture').length;
  const nCrit = stockModel.articles.filter(a => a.status === 'critique').length;
  const nOrder = getStockReorderList().length;
  push('danger', nOut, 'article en rupture de stock', 'articles en rupture de stock',
    'Stock → Pilotage', 'stock', ['stock', 'pilotage']);
  push('warning', nCrit, 'article sous son seuil de réapprovisionnement', 'articles sous leur seuil de réapprovisionnement',
    'Stock → Pilotage', 'stock', ['stock', 'pilotage']);
  if (!nOut && !nCrit && nOrder) {
    push('info', nOrder, 'référence à commander', 'références à commander', 'Stock → Pilotage', 'stock', ['stock', 'pilotage']);
  }

  // Budget eOTP — dépassement projeté en fin de chantier
  const elapsed = getProjectMonthsElapsed(), totalProj = getProjectMonthsTotal();
  if (elapsed > 0 && totalProj > 0) {
    const spentByCode = new Map();
    for (const e of getConsommableEntries()) {
      const code = (e.eOTP || '').trim();
      if (!code) continue;
      spentByCode.set(code, (spentByCode.get(code) || 0) + (Number(e.qty) || 0) * (Number(e.unitPrice) || 0));
    }
    let over = 0, near = 0;
    for (const e of getEOTPs()) {
      const code = (e.code || '').trim();
      // Les lignes en heures ne se comparent pas à des dépenses en euros.
      if (!code || !(e.budget > 0) || isHourEOTP(e)) continue;
      const fdc = (spentByCode.get(code) || 0) / elapsed * totalProj;
      const ratio = fdc / e.budget;
      if (ratio >= 1) over++;
      else if (ratio >= 0.8) near++;
    }
    push('danger', over, 'ligne eOTP en dépassement projeté', 'lignes eOTP en dépassement projeté', 'Consommable → Budget', 'consommable');
    push('warning', near, 'ligne eOTP au-delà de 80 % du budget', 'lignes eOTP au-delà de 80 % du budget', 'Consommable → Budget', 'consommable');
  }

  // Heures — écart au stade négatif
  const selected = getEOTPs().filter(e => getHeuresRow(e.id).selected);
  if (selected.length) {
    let ecart = 0;
    for (const e of selected) ecart += computeHeuresRow(getHeuresRow(e.id)).ecart;
    if (ecart < 0) {
      out.push({ sev: 'warning', n: fmtHeures(Math.abs(ecart)),
        label: 'heures consommées au-delà du droit à dépenser',
        detail: 'Suivi des heures — écart au stade',
        page: 'avancement', sub: ['avancement', 'heures'] });
    }
  }

  // Avancement — zones sans mise à jour, ouvrages non pondérés
  const model = computeAvancementModel('');
  push('warning', model.issues.stale.length,
    'zone en cours sans mise à jour depuis ' + AVANCEMENT_STALE_DAYS + ' jours',
    'zones en cours sans mise à jour depuis ' + AVANCEMENT_STALE_DAYS + ' jours',
    'Avancement → Récapitulatif', 'avancement', ['avancement', 'recap']);
  const noRatio = [...new Set(model.issues.noRatio.map(i => i.name))];
  push('info', noRatio.length, 'ouvrage sans ratio ne pesant pas dans l\'avancement',
    'ouvrages sans ratio ne pesant pas dans l\'avancement', noRatio.slice(0, 3).join(', '), 'donnees');

  // Travaux — articles de CCTP sans localisation
  let noLoca = 0;
  for (const p of getTravauxPrescriptions()) {
    if (p.everywhere) continue;
    if (Object.keys(p.zones || {}).length) continue;
    if ((p.localisation || '').trim()) continue;
    noLoca++;
  }
  push('info', noLoca, 'article de CCTP sans localisation', 'articles de CCTP sans localisation', 'Travaux → CCTP', 'travaux', ['travaux', 'cctp']);

  // CR — tâches en retard d'échéance sur le dernier CR de chaque entreprise
  let lateCR = 0;
  const today = todayISO();
  for (const c of state.companies) {
    const weeks = getCRWeeks(c.id);
    if (!weeks.length) continue;
    const last = weeks[weeks.length - 1];
    for (const sec of getCRSections()) {
      for (const e of getCREntries(c.id, last.id, sec.key)) {
        if (isCRWidgetEntry(e) || e.done) continue;
        if (e.echeance && e.echeance !== 'PM' && e.echeance < today) lateCR++;
      }
    }
  }
  push('warning', lateCR, 'tâche de compte-rendu en retard d\'échéance', 'tâches de compte-rendu en retard d\'échéance', 'CR', 'cr');

  // Devis et ST — chiffres protégés par mot de passe
  if (protectedUnlocked) {
    const waiting = getDevisList().filter(d => d.etat === 'envoye').length;
    push('info', waiting, 'devis envoyé en attente de réponse', 'devis envoyés en attente de réponse', 'Devis', 'devis');
    let overST = 0;
    for (const c of state.companies) {
      if (!ST_GROUPS.some(g => getSTEntries(c.id, g.key).length > 0)) continue;
      const r = computeSTRecap(c.id);
      if (r.budget > 0 && r.depenses > r.budget) overST++;
    }
    push('danger', overST, 'sous-traitant au-delà du budget', 'sous-traitants au-delà du budget', 'ST', 'st');
  }

  const rank = { danger: 0, warning: 1, info: 2 };
  out.sort((a, b) => rank[a.sev] - rank[b.sev] || (Number(b.n) || 0) - (Number(a.n) || 0));
  return out;
}

// --- Carte « Points d'attention » consolidée ---
// Tous les sujets sont rendus ; la liste défile dans la carte. La hauteur
// de la carte ne dépend donc pas du nombre d'alertes, et aucun bouton
// déplier/replier ne s'intercale entre l'utilisateur et l'information.
function renderDashboardAlerts() {
  const el = document.getElementById('dashalerts');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Points d\'attention', null));
  const body = dashEl('div', 'dash-focus');
  const alerts = computeProjectAlerts();
  if (!alerts.length) {
    body.innerHTML = '<div class="dash-empty-ok"><div class="dash-empty-icon">✓</div>'
      + '<div class="dash-empty-text">Aucun point bloquant</div>'
      + '<div class="dash-empty-sub">Documents, stock, budgets, avancement et comptes-rendus sont au vert.</div></div>';
    el.appendChild(body);
    return;
  }
  const list = dashEl('div', 'dash-focus-list');
  for (const a of alerts) {
    const row = dashEl('button', 'dash-focus-row is-' + a.sev);
    row.type = 'button';
    row.appendChild(dashEl('span', 'dash-focus-num', String(a.n)));
    const txt = dashEl('span', 'dash-focus-text');
    txt.appendChild(dashEl('span', 'dash-focus-label', a.label));
    if (a.detail) txt.appendChild(dashEl('span', 'dash-focus-detail', a.detail));
    row.appendChild(txt);
    row.appendChild(dashEl('span', 'dash-focus-go', '→'));
    if (a.page) row.addEventListener('click', () => {
      switchPage(a.page);
      if (a.sub) switchSubPage(a.sub[0], a.sub[1]);
    });
    list.appendChild(row);
  }
  body.appendChild(list);
  el.appendChild(body);
  // Le dégradé de bas de liste ne s'affiche que s'il reste à faire défiler.
  requestAnimationFrame(() => {
    body.classList.toggle('has-more', list.scrollHeight - list.clientHeight > 4);
    list.addEventListener('scroll', () => {
      const bottom = list.scrollHeight - list.clientHeight - list.scrollTop;
      body.classList.toggle('has-more', bottom > 4);
    }, { passive: true });
  });
}

// --- Carte « Courbe d'avancement » (mini) ---
function renderDashboardCurve() {
  const el = document.getElementById('dashcurve');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Courbe d\'avancement', 'avancement'));
  const body = dashEl('div', 'dash-curve');
  const hist = state.avancementHistory || {};
  const keys = Object.keys(hist).sort();
  if (!keys.length) {
    body.innerHTML = '<p class="dash-empty-text">La courbe se construit automatiquement : un point est enregistré chaque jour où l\'avancement évolue.</p>';
    el.appendChild(body);
    return;
  }
  const model = computeAvancementModel('');
  const planning = computeAvancementPlanning(model.pct);
  // Format large : la carte occupe deux colonnes, la courbe se lit
  // dans le sens de la durée du chantier.
  const W = 720, H = 190, PL = 30, PR = 10, PT = 10, PB = 20;
  const day = 86400000;
  const first = new Date(keys[0] + 'T00:00:00').getTime();
  const last = new Date(keys[keys.length - 1] + 'T00:00:00').getTime();
  const t0 = planning ? Math.min(first, new Date(planning.start + 'T00:00:00').getTime()) : first;
  const t1 = planning ? Math.max(last, new Date(planning.end + 'T00:00:00').getTime()) : Math.max(last, t0 + day);
  const span = Math.max(day, t1 - t0);
  const x = (ms) => PL + ((ms - t0) / span) * (W - PL - PR);
  const yy = (p) => PT + (1 - Math.max(0, Math.min(100, p)) / 100) * (H - PT - PB);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'dash-curve-svg');
  const mk = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  for (const p of [0, 25, 50, 75, 100]) {
    svg.appendChild(mk('line', { x1: PL, x2: W - PR, y1: yy(p), y2: yy(p), class: 'dash-curve-grid' }));
    const t = mk('text', { x: PL - 4, y: yy(p) + 3, class: 'dash-curve-axis', 'text-anchor': 'end' });
    t.textContent = p + '%';
    svg.appendChild(t);
  }
  if (planning) {
    const ps = new Date(planning.start + 'T00:00:00').getTime();
    const pe = new Date(planning.end + 'T00:00:00').getTime();
    svg.appendChild(mk('line', { x1: x(ps), y1: yy(0), x2: x(pe), y2: yy(100), class: 'dash-curve-theory' }));
  }
  const pts = keys.map(k => ({ x: x(new Date(k + 'T00:00:00').getTime()), y: yy(hist[k].pct) }));
  if (pts.length > 1) {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    svg.appendChild(mk('path', { d: d + ` L${pts[pts.length - 1].x.toFixed(1)} ${yy(0)} L${pts[0].x.toFixed(1)} ${yy(0)} Z`, class: 'dash-curve-area' }));
    svg.appendChild(mk('path', { d, class: 'dash-curve-line' }));
  }
  const lastPt = pts[pts.length - 1];
  svg.appendChild(mk('circle', { cx: lastPt.x, cy: lastPt.y, r: 4, class: 'dash-curve-dot' }));
  const tx = x(new Date(todayISO() + 'T00:00:00').getTime());
  if (tx >= PL && tx <= W - PR) svg.appendChild(mk('line', { x1: tx, y1: PT, x2: tx, y2: H - PB, class: 'dash-curve-today' }));
  const l0 = mk('text', { x: PL, y: H - 5, class: 'dash-curve-axis' });
  l0.textContent = fmtFR(new Date(t0).toISOString().slice(0, 10));
  svg.appendChild(l0);
  const l1 = mk('text', { x: W - PR, y: H - 5, class: 'dash-curve-axis', 'text-anchor': 'end' });
  l1.textContent = fmtFR(new Date(t1).toISOString().slice(0, 10));
  svg.appendChild(l1);
  body.appendChild(svg);
  const legend = dashEl('div', 'dash-curve-legend');
  const mkLeg = (cls, txt) => {
    const s = dashEl('span', 'dash-curve-leg');
    s.appendChild(dashEl('span', 'dash-curve-swatch ' + cls));
    s.appendChild(dashEl('span', null, txt));
    legend.appendChild(s);
  };
  mkLeg('is-real', 'Réel');
  if (planning) mkLeg('is-theory', 'Théorique');
  body.appendChild(legend);
  el.appendChild(body);
}

// --- Carte « Travaux / CCTP » ---
function renderDashboardTravaux() {
  const el = document.getElementById('dashtravaux');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('CCTP du chantier', 'travaux'));
  const body = dashEl('div', 'dash-mini');
  const arts = getTravauxPrescriptions();
  if (!arts.length) {
    body.innerHTML = '<p class="dash-empty-text">Aucun article. Renseignez le Carnet dans l\'onglet Travaux.</p>';
    el.appendChild(body);
    return;
  }
  const groups = buildTravauxCCTP().filter(g => g.ouvrages.some(c => c.articles.length));
  const chapters = getTravauxOuvrages().length;
  const localised = arts.filter(p => p.everywhere || Object.keys(p.zones || {}).length || (p.localisation || '').trim()).length;
  const rempl = arts.filter(p => p.remplacement).length;
  const pct = Math.round((localised / arts.length) * 100);
  body.appendChild(dashMiniStat(String(arts.length), 'articles', chapters + ' chapitre' + (chapters > 1 ? 's' : '') + ' · ' + groups.length + ' lot' + (groups.length > 1 ? 's' : '')));
  const row = dashEl('div', 'dash-mini-rows');
  row.appendChild(dashMiniRow('Localisés', pct + ' %', pct >= 100 ? 'ok' : (pct >= 70 ? 'warn' : 'bad')));
  row.appendChild(dashMiniRow('Remplacements', String(rempl), rempl ? 'warn' : 'idle'));
  body.appendChild(row);
  el.appendChild(body);
}

// --- Carte « Comptes-rendus » ---
function renderDashboardCR() {
  const el = document.getElementById('dashcr');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Comptes-rendus', 'cr'));
  const body = dashEl('div', 'dash-mini');
  const companies = state.companies.filter(c => getCRWeeks(c.id).length > 0);
  if (!companies.length) {
    body.innerHTML = '<p class="dash-empty-text">Aucun compte-rendu créé.</p>';
    el.appendChild(body);
    return;
  }
  const today = todayISO();
  let open = 0, late = 0;
  const rows = [];
  for (const c of companies) {
    const weeks = getCRWeeks(c.id);
    const last = weeks[weeks.length - 1];
    let o = 0, l = 0;
    for (const sec of getCRSections()) {
      for (const e of getCREntries(c.id, last.id, sec.key)) {
        if (isCRWidgetEntry(e) || e.done) continue;
        o++;
        if (e.echeance && e.echeance !== 'PM' && e.echeance < today) l++;
      }
    }
    open += o; late += l;
    rows.push({ name: c.name, label: last.label, open: o, late: l });
  }
  body.appendChild(dashMiniStat(String(open), open > 1 ? 'tâches ouvertes' : 'tâche ouverte',
    companies.length + ' entreprise' + (companies.length > 1 ? 's' : '') + ' suivie' + (companies.length > 1 ? 's' : '')));
  const list = dashEl('div', 'dash-mini-rows');
  for (const r of rows.slice(0, 4)) {
    list.appendChild(dashMiniRow(r.name + ' · ' + r.label,
      r.open + (r.late ? ' · ' + r.late + ' en retard' : ''),
      r.late ? 'bad' : (r.open ? 'warn' : 'ok')));
  }
  body.appendChild(list);
  el.appendChild(body);
}

function dashEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
function dashMiniStat(num, unit, sub) {
  const box = dashEl('div', 'dash-mini-head');
  const line = dashEl('div', 'dash-mini-main');
  line.appendChild(dashEl('span', 'dash-mini-num', num));
  line.appendChild(dashEl('span', 'dash-mini-unit', unit));
  box.appendChild(line);
  if (sub) box.appendChild(dashEl('div', 'dash-mini-sub', sub));
  return box;
}
function dashMiniRow(label, value, tone) {
  const r = dashEl('div', 'dash-mini-row');
  r.appendChild(dashEl('span', 'dash-mini-label', label));
  r.appendChild(dashEl('span', 'dash-mini-val is-' + (tone || 'idle'), value));
  return r;
}

// Carte verrouillée (Devis / ST) : ces onglets sont protégés par mot de
// passe — leurs chiffres ne s'affichent sur le tableau de bord qu'une
// fois le déverrouillage fait dans la session.
function dashboardLockedBody(tabLabel) {
  const body = document.createElement('div');
  body.className = 'dash-locked';
  body.innerHTML = `<span class="dash-locked-icon">🔒</span><p class="dash-empty-text">Contenu protégé. Ouvrez l'onglet ${tabLabel} et saisissez le mot de passe pour afficher ces chiffres.</p>`;
  return body;
}

// --- Widget « Suivi des heures » (semaine active) ---
function renderDashboardHeures() {
  const el = document.getElementById('dashheures');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Suivi des heures', 'avancement', ['avancement', 'heures']));
  const body = document.createElement('div');
  body.className = 'dash-heures';
  const week = getHeuresActiveWeek();
  const selected = getEOTPs().filter(e => getHeuresRow(e.id).selected);
  if (selected.length === 0) {
    body.innerHTML = '<p class="dash-empty-text">Aucun eOTP suivi. Cochez-en dans l\'onglet Heures.</p>';
    el.appendChild(body);
    return;
  }
  let sumBudget = 0, sumDroit = 0, sumEcart = 0;
  for (const e of selected) {
    const row = getHeuresRow(e.id);
    const comp = computeHeuresRow(row);
    sumBudget += Number(row.budgetHeures) || 0;
    sumDroit += comp.droit;
    sumEcart += comp.ecart;
  }
  const pct = sumBudget > 0 ? Math.round((sumDroit / sumBudget) * 100) : null;
  body.innerHTML = `
    <div class="dash-heures-main">
      <span class="dash-heures-pct"></span>
      <span class="dash-heures-detail"></span>
    </div>
    <div class="dash-heures-ecart"></div>
  `;
  body.querySelector('.dash-heures-pct').textContent = pct != null ? pct + ' %' : '—';
  body.querySelector('.dash-heures-detail').textContent =
    `${fmtHeures(sumDroit)} h droit à dépenser / ${fmtHeures(sumBudget)} h budget · ${week ? week.name : ''}`;
  const ec = body.querySelector('.dash-heures-ecart');
  ec.textContent = `Écart au stade : ${sumEcart >= 0 ? '+' : ''}${fmtHeures(sumEcart)} h`;
  ec.classList.add(sumEcart >= 0 ? 'is-positive' : 'is-negative');
  el.appendChild(body);
}

// --- Widget « Devis » (sommes par état, version courante de chaque devis) ---
function renderDashboardDevis() {
  const el = document.getElementById('dashdevis');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Devis', 'devis'));
  if (!protectedUnlocked) { el.appendChild(dashboardLockedBody('Devis')); return; }
  const body = document.createElement('div');
  body.className = 'dash-devis';
  const list = getDevisList();
  if (list.length === 0) {
    body.innerHTML = '<p class="dash-empty-text">Aucun devis.</p>';
    el.appendChild(body);
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'dash-devis-list';
  for (const e of DEVIS_ETATS) {
    const items = list.filter(d => d.etat === e.key);
    if (items.length === 0) continue;
    const sum = items.reduce((s, d) => s + computeDevisRecap(d).total, 0);
    const li = document.createElement('li');
    li.className = 'dash-devis-row';
    li.innerHTML = `<span class="dash-devis-dot"></span><span class="dash-devis-label"></span><span class="dash-devis-count"></span><span class="dash-devis-sum"></span>`;
    li.querySelector('.dash-devis-dot').style.background = e.color;
    li.querySelector('.dash-devis-label').textContent = e.label;
    li.querySelector('.dash-devis-count').textContent = items.length;
    li.querySelector('.dash-devis-sum').textContent = fmtEur(sum);
    ul.appendChild(li);
  }
  body.appendChild(ul);
  el.appendChild(body);
}

// --- Widget « ST » (budget / dépenses / écart cumulés, toutes entreprises) ---
function renderDashboardST() {
  const el = document.getElementById('dashst');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Sous-traitants', 'st'));
  if (!protectedUnlocked) { el.appendChild(dashboardLockedBody('ST')); return; }
  const body = document.createElement('div');
  body.className = 'dash-st';
  const companies = state.companies.filter(c =>
    ST_GROUPS.some(g => getSTEntries(c.id, g.key).length > 0));
  if (companies.length === 0) {
    body.innerHTML = '<p class="dash-empty-text">Aucune donnée ST saisie.</p>';
    el.appendChild(body);
    return;
  }
  let budget = 0, depenses = 0;
  for (const c of companies) {
    const r = computeSTRecap(c.id);
    budget += r.budget;
    depenses += r.depenses;
  }
  const ecart = budget - depenses;
  const pct = budget !== 0 ? Math.round((ecart / budget) * 1000) / 10 : null;
  body.innerHTML = `
    <div class="dash-st-row"><span class="dash-st-lbl">Total budget</span><span class="dash-st-val"></span></div>
    <div class="dash-st-row"><span class="dash-st-lbl">Total dépenses</span><span class="dash-st-val"></span></div>
    <div class="dash-st-row dash-st-ecart"><span class="dash-st-lbl">Écart</span><span class="dash-st-val"></span></div>
    <div class="dash-st-foot"></div>
  `;
  const vals = body.querySelectorAll('.dash-st-val');
  vals[0].textContent = fmtEur(budget);
  vals[1].textContent = fmtEur(depenses);
  vals[2].textContent = pct != null ? `${fmtEur(ecart)} (${formatPct(pct)} %)` : fmtEur(ecart);
  body.querySelector('.dash-st-ecart').classList.add(ecart >= 0 ? 'is-positive' : 'is-negative');
  body.querySelector('.dash-st-foot').textContent = `${companies.length} sous-traitant${companies.length > 1 ? 's' : ''} suivi${companies.length > 1 ? 's' : ''}`;
  el.appendChild(body);
}

function dashboardCardHeader(title, gotoPage, sub) {
  const h = document.createElement('div');
  h.className = 'dash-card-head';
  const t = document.createElement('span');
  t.className = 'dash-card-eyebrow';
  t.textContent = (title || '').toUpperCase();
  h.appendChild(t);
  if (gotoPage) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'dash-card-link';
    link.textContent = 'Ouvrir →';
    link.addEventListener('click', () => {
      switchPage(gotoPage);
      if (sub) switchSubPage(sub[0], sub[1]);
    });
    h.appendChild(link);
  }
  return h;
}

// --- Widget « Alertes documents » (eCheckIn) ---
function renderDashboardDocAlerts() {
  const el = document.getElementById('dashdocalerts');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Alertes documents', 'administratif'));

  // Compte par sévérité, à travers tous les ouvriers, sur les seuls
  // documents OBLIGATOIRES et APPLICABLES au type d'emploi.
  let nExpired = 0, nDanger = 0, nWarning = 0;
  for (const worker of state.workers) {
    const empType = getWorkerDocs(worker.id).employmentType;
    let maxIdx = -1;
    for (const docId of getApplicableDocIds(empType)) {
      if (!isDocRequired(docId)) continue;
      const s = getDocStatus(worker.id, docId);
      const idx = STATUS_WORST_ORDER.indexOf(s);
      if (idx > maxIdx) maxIdx = idx;
    }
    const worst = maxIdx >= 0 ? STATUS_WORST_ORDER[maxIdx] : null;
    if (worst === 'expired') nExpired++;
    else if (worst === 'danger') nDanger++;
    else if (worst === 'warning') nWarning++;
  }

  const body = document.createElement('div');
  body.className = 'dash-alerts';
  if (nExpired === 0 && nDanger === 0 && nWarning === 0) {
    body.innerHTML = `
      <div class="dash-empty-ok">
        <div class="dash-empty-icon">✓</div>
        <div class="dash-empty-text">Aucun document à signaler</div>
      </div>`;
  } else {
    const rows = [];
    if (nExpired > 0) rows.push(`<div class="dash-alert-row is-expired">
        <div class="dash-alert-num">${nExpired}</div>
        <div class="dash-alert-label">${nExpired > 1 ? 'ouvriers' : 'ouvrier'} avec document périmé</div>
      </div>`);
    if (nDanger > 0)  rows.push(`<div class="dash-alert-row is-danger">
        <div class="dash-alert-num">${nDanger}</div>
        <div class="dash-alert-label">${nDanger > 1 ? 'ouvriers en danger' : 'ouvrier en danger'} <span class="dash-alert-hint">(≤ 3 j)</span></div>
      </div>`);
    if (nWarning > 0) rows.push(`<div class="dash-alert-row is-warning">
        <div class="dash-alert-num">${nWarning}</div>
        <div class="dash-alert-label">${nWarning > 1 ? 'ouvriers en alerte' : 'ouvrier en alerte'} <span class="dash-alert-hint">(≤ 7 j)</span></div>
      </div>`);
    body.innerHTML = rows.join('');
  }
  el.appendChild(body);
}

// --- Widget « Stock critique » ---
function renderDashboardStockAlerts() {
  const el = document.getElementById('dashstockalerts');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Stock critique', 'stock'));

  // Le statut vient du modèle : il combine la couverture, le stock mini et le
  // délai d'appro propres à chaque article, au lieu d'un unique seuil global.
  const model = computeStockModel();
  const critical = model.articles
    .filter(a => a.status === 'rupture' || a.status === 'critique')
    .map(a => ({ article: a.name, unit: a.unit, stock: a.stock, status: a.status, depletion: { days: a.days } }))
    .sort((a, b) => (a.depletion.days == null ? 1e9 : a.depletion.days) - (b.depletion.days == null ? 1e9 : b.depletion.days));
  const summary = model.articles;

  const body = document.createElement('div');
  body.className = 'dash-stock';
  if (critical.length === 0) {
    body.innerHTML = `
      <div class="dash-empty-ok">
        <div class="dash-empty-icon">✓</div>
        <div class="dash-empty-text">Aucun article en alerte</div>
        <div class="dash-empty-sub">${summary.length} référence${summary.length > 1 ? 's' : ''} suivie${summary.length > 1 ? 's' : ''}</div>
      </div>`;
  } else {
    const ul = document.createElement('ul');
    ul.className = 'dash-stock-list';
    for (const it of critical) {
      const days = it.depletion.days;
      const li = document.createElement('li');
      const klass = it.status === 'rupture' ? 'is-empty' : (days != null && days <= 3 ? 'is-danger' : 'is-warning');
      li.className = 'dash-stock-row ' + klass;
      const label = it.status === 'rupture' ? 'rupture'
        : days == null ? 'sous le mini'
        : (days === 1 ? '1 j ouvré' : `${days} j ouvrés`);
      li.innerHTML = `
        <span class="dash-stock-name"></span>
        <span class="dash-stock-stock"></span>
        <span class="dash-stock-days"></span>
      `;
      li.querySelector('.dash-stock-name').textContent = it.article;
      li.querySelector('.dash-stock-stock').textContent = `${fmtStockQty(it.stock)} ${it.unit}`;
      li.querySelector('.dash-stock-days').textContent = label;
      li.addEventListener('click', () => { switchPage('stock'); switchSubPage('stock', 'stockview'); openStockDetail(it.article); });
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }
  el.appendChild(body);
}

// --- Widget « Consommable ce mois » ---
// Stats simples : total dépensé sur le mois courant + nombre de
// commandes + total cumulé depuis le début du chantier. Donne une
// vue d'ensemble du rythme de consommation.
function renderDashboardConsommable() {
  const el = document.getElementById('dashconsommable');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Consommable ce mois', 'consommable'));

  const entries = getConsommableEntries();
  const body = document.createElement('div');
  body.className = 'dashboard-conso-body';
  if (entries.length === 0) {
    body.innerHTML = '<p class="dashboard-empty">Aucune commande enregistrée.</p>';
    el.appendChild(body);
    return;
  }
  const monthKey = (state.currentDate || todayISO()).slice(0, 7);
  let monthTotal = 0, cumulTotal = 0;
  const monthOrders = new Set();
  // Mini-tendance : 6 derniers mois (mois courant inclus, plus ancien à gauche).
  const monthlyTotals = new Map();
  for (const e of entries) {
    const eur = (Number(e.qty) || 0) * (Number(e.unitPrice) || 0);
    cumulTotal += eur;
    const mk = (e.date || '').slice(0, 7);
    if (mk) monthlyTotals.set(mk, (monthlyTotals.get(mk) || 0) + eur);
    if (mk === monthKey) {
      monthTotal += eur;
      monthOrders.add(getEntryOrderId(e));
    }
  }
  const nbOrders = monthOrders.size;
  // Construit la fenêtre des 6 mois en finissant par le mois courant
  const window6 = [];
  const ref = state.currentDate ? fromISO(state.currentDate) : new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    window6.push({ key: k, val: monthlyTotals.get(k) || 0 });
  }
  const maxVal = Math.max(1, ...window6.map(m => m.val));
  const bars = window6.map((m, i) => {
    const h = Math.max(8, (m.val / maxVal) * 100);
    const isLast = i === window6.length - 1;
    return `<div class="dash-bar ${isLast ? 'is-current' : ''}" style="height:${h}%" title="${m.key} : ${fmtEur(m.val)}"></div>`;
  }).join('');
  body.className = 'dash-conso';
  body.innerHTML = `
    <div class="dash-conso-headline">
      <span class="dash-conso-amount">${escapeHtml(fmtEur(monthTotal))}</span>
      <span class="dash-conso-sub">HT engagé ce mois</span>
    </div>
    <div class="dash-bars">${bars}</div>
    <div class="dash-conso-foot">
      <div>
        <div class="dash-conso-stat-val">${nbOrders}</div>
        <div class="dash-conso-stat-lbl">${nbOrders > 1 ? 'commandes' : 'commande'}</div>
      </div>
      <div class="dash-conso-foot-right">
        <div class="dash-conso-stat-val">${escapeHtml(fmtEur(cumulTotal))}</div>
        <div class="dash-conso-stat-lbl">cumul HT</div>
      </div>
    </div>
  `;
  el.appendChild(body);
}

// --- Widget « Budget eOTP » (alertes de dépassement projeté) ---
// Liste les lignes de budget eOTP dont la projection FDC dépasse ou
// approche du budget. Ne s'active que si les dates projet sont
// renseignées (sinon pas de FDC calculable).
function renderDashboardEOTPAlerts() {
  const el = document.getElementById('dasheotpalerts');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Budget eOTP', 'consommable'));

  const body = document.createElement('div');
  body.className = 'dashboard-eotp-body';
  const elapsed   = getProjectMonthsElapsed();
  const totalProj = getProjectMonthsTotal();
  // Pas de projection possible → on guide l'utilisateur
  if (elapsed <= 0 || totalProj <= 0) {
    body.innerHTML = '<p class="dashboard-empty">Renseignez les dates du chantier (Données → Admin.) pour activer la projection des dépenses.</p>';
    el.appendChild(body);
    return;
  }
  const eotps = getEOTPs().filter(e => (e.code || '').trim() && (e.budget || 0) > 0 && !isHourEOTP(e));
  if (eotps.length === 0) {
    body.innerHTML = '<p class="dashboard-empty">Aucune ligne de budget eOTP renseignée.</p>';
    el.appendChild(body);
    return;
  }
  // Agrège les dépenses par code eOTP
  const spentByCode = new Map();
  for (const e of getConsommableEntries()) {
    const code = (e.eOTP || '').trim();
    if (!code) continue;
    spentByCode.set(code, (spentByCode.get(code) || 0) + (Number(e.qty) || 0) * (Number(e.unitPrice) || 0));
  }
  // Calcule FDC et écart pour chaque eOTP, garde ceux en alerte
  const alerts = [];
  for (const eotp of eotps) {
    const spent = spentByCode.get(eotp.code) || 0;
    const fdc = (spent / elapsed) * totalProj;
    const ratio = fdc / eotp.budget; // 1 = budget pile atteint
    if (ratio < 0.80) continue; // pas d'alerte sous 80 %
    let level = 'warning';
    if (ratio >= 1) level = 'danger';
    alerts.push({ code: eotp.code, label: eotp.label, budget: eotp.budget, fdc, ecart: eotp.budget - fdc, level });
  }
  // Tri : dépassements d'abord, puis ratio décroissant
  alerts.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'danger' ? -1 : 1;
    return (b.fdc / b.budget) - (a.fdc / a.budget);
  });
  if (alerts.length === 0) {
    body.className = 'dash-eotp';
    body.innerHTML = `
      <div class="dash-eotp-ok">
        <div class="dash-donut dash-donut-success" style="--pct:100%">
          <div class="dash-donut-inner">
            <div class="dash-donut-num dash-donut-num-success">0</div>
            <div class="dash-donut-cap">dépassement</div>
          </div>
        </div>
        <div class="dash-eotp-ok-text">Aucun<br>dépassement<br>projeté</div>
      </div>`;
    el.appendChild(body);
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'dash-eotp-list';
  for (const a of alerts) {
    const li = document.createElement('li');
    li.className = 'dash-eotp-row is-' + a.level;
    li.innerHTML = `
      <span class="dash-eotp-code-wrap">
        <span class="dash-eotp-code"></span>
        <span class="dash-eotp-label"></span>
      </span>
      <span class="dash-eotp-ecart"></span>
    `;
    li.querySelector('.dash-eotp-code').textContent = a.code;
    const lbl = li.querySelector('.dash-eotp-label');
    if (a.label) lbl.textContent = a.label; else lbl.remove();
    li.querySelector('.dash-eotp-ecart').textContent = a.level === 'danger'
      ? `${fmtEur(a.ecart)} FDC`
      : `${Math.round((a.fdc / a.budget) * 100)} % FDC`;
    li.addEventListener('click', () => {
      switchPage('consommable'); switchSubPage('conso', 'conrecap');
      state.consoRecapMode = 'eotp'; save(); renderConsommableRecap();
    });
    ul.appendChild(li);
  }
  body.appendChild(ul);
  el.appendChild(body);
}

// --- Widget « Effectifs par entreprise » ---
function renderDashboardCompaniesPresence() {
  const el = document.getElementById('dashcompanies');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Effectifs par entreprise', 'effectifs'));

  const date = state.currentDate;
  const entries = state.presences[date] || [];
  const weather = state.weather?.[date] || {};
  const rows = state.companies.map(c => {
    const entry = entries.find(e => e.companyId === c.id);
    return { id: c.id, name: c.name, count: entry ? entry.count : 0, onWeather: !!weather[c.id] };
  }).sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'fr'));

  const body = document.createElement('div');
  body.className = 'dash-companies';
  if (state.companies.length === 0) {
    body.innerHTML = '<p class="dash-empty-text">Aucune entreprise enregistrée.</p>';
  } else {
    const maxCount = Math.max(1, ...rows.map(r => r.count));
    const total = rows.reduce((s, r) => s + r.count, 0);
    const rowsHtml = rows.map(r => {
      const pct = (r.count / maxCount) * 100;
      const isLead = r.count > 0 && r.count === maxCount;
      const weatherPill = r.onWeather ? '<span class="dash-company-weather" title="Intempéries">🌧</span>' : '';
      return `<div class="dash-company-row">
        <div class="dash-company-line">
          <span class="dash-company-name"></span>
          ${weatherPill}
          <span class="dash-company-num"></span>
        </div>
        <div class="dash-company-bar">
          <div class="dash-company-bar-fill ${isLead ? 'is-lead' : ''}" style="width:${pct}%"></div>
        </div>
      </div>`;
    }).join('');
    body.innerHTML = `
      ${rowsHtml}
      <div class="dash-companies-total">
        <span>Total présents</span>
        <span class="dash-companies-total-num">${total}</span>
      </div>`;
    // Remplit les noms et les nombres en safe (escape)
    const rowEls = body.querySelectorAll('.dash-company-row');
    rows.forEach((r, i) => {
      rowEls[i].querySelector('.dash-company-name').textContent = r.name;
      rowEls[i].querySelector('.dash-company-num').textContent = r.count;
    });
  }
  el.appendChild(body);
}

// --- Widget « Avancement par bâtiment » ---
// % global d'un bâtiment : même pondération horaire que les zones —
// chaque couple (zone, ouvrage) pèse ses heures allouées. Une façade de
// 40 h compte ainsi plus qu'un petit voile de 3 h. Repli sur la moyenne
// simple des zones si aucune heure n'est calculable.
function getBuildingOverallProgress(buildingId) {
  const descendants = getDescendantZones(buildingId);
  const active = descendants.filter(zid => getZoneOuvrages(zid).length > 0);
  if (active.length === 0) return null;
  let totalHours = 0, weighted = 0;
  for (const zid of active) {
    for (const o of getZoneOuvrages(zid)) {
      const h = getOuvrageAllocatedHours(o.quantity, o.setup);
      totalHours += h;
      weighted += h * getOuvrageRawProgress(zid, o.setup);
    }
  }
  if (totalHours > 0) return weighted / totalHours;
  const total = active.reduce((sum, zid) => sum + getZoneProgress(zid), 0);
  return total / active.length;
}
function renderDashboardBuildings() {
  const el = document.getElementById('dashbuildings');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Avancement par bâtiment', 'avancement'));

  // Même moteur que le récapitulatif : pondération par les heures
  // budgétées. Un bâtiment de 3 000 h ne pèse pas comme un de 300 h, et le
  // total affiché ici est donc exactement celui du récapitulatif.
  const model = computeAvancementModel('');
  const body = document.createElement('div');
  body.className = 'dash-buildings';
  if (model.buildings.length === 0) {
    body.innerHTML = '<p class="dash-empty-text">Aucun bâtiment (zone racine) défini.</p>';
    el.appendChild(body);
    return;
  }
  const unit = model.weighting === 'heures' ? ' h' : '';
  for (const b of model.buildings.slice().sort((x, z) => z.pct - x.pct)) {
    const row = document.createElement('div');
    row.className = 'dash-building-row';
    const has = b.hBudget > 0;
    const pct = has ? b.pct : 0;
    row.innerHTML = `
      <div class="dash-building-line">
        <span class="dash-building-name"></span>
        <span class="dash-building-pct ${has && pct > 0 ? '' : 'is-dim'}"></span>
      </div>
      <div class="dash-building-bar"><div class="dash-building-bar-fill ${pct > 0 ? '' : 'is-empty'}" style="width:${Math.max(pct, 1.5)}%"></div></div>
      <div class="dash-building-sub"><span class="dash-building-meta"></span><span class="dash-building-delta"></span></div>
    `;
    row.querySelector('.dash-building-name').textContent = b.name;
    row.querySelector('.dash-building-pct').textContent = has ? formatPct(Math.round(pct * 10) / 10) + ' %' : '—';
    row.querySelector('.dash-building-meta').textContent =
      has ? formatHours(b.hDone) + ' / ' + formatHours(b.hBudget) + unit + ' · ' + b.zones + ' zone' + (b.zones > 1 ? 's' : '')
          : 'aucune quantité renseignée';
    const delta = b.pct - model.pct;
    const dEl = row.querySelector('.dash-building-delta');
    if (has && model.buildings.length > 1 && Math.abs(delta) >= 0.05) {
      dEl.textContent = (delta >= 0 ? '+' : '−') + formatPct(Math.abs(Math.round(delta * 10) / 10)) + ' pts';
      dEl.classList.add(delta >= 0 ? 'is-positive' : 'is-negative');
    }
    if (pct >= 99.95) row.classList.add('is-done');
    body.appendChild(row);
  }
  const totalRow = document.createElement('div');
  totalRow.className = 'dash-buildings-total';
  totalRow.innerHTML = `
    <span class="dash-buildings-total-lbl">Avancement global</span>
    <span class="dash-buildings-total-val">${model.hBudget > 0 ? formatPct(Math.round(model.pct * 10) / 10) + ' %' : '—'}</span>`;
  body.appendChild(totalRow);
  el.appendChild(body);
}

// ---------- Tableau récap effectifs (Effectifs → Graphique) ----------
// Lignes = dates (les plus récentes en haut), colonnes = entreprises +
// total. Une cellule signalée d'une goutte quand l'entreprise était en
// intempéries ce jour-là. Suit la même plage que le graphique.
function renderRecapTable() {
  const wrap = document.getElementById('recaptablewrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const dates = getChartDates().slice().reverse();
  if (dates.length === 0 || state.companies.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'recap-empty';
    empty.textContent = state.companies.length === 0
      ? 'Aucune entreprise enregistrée.'
      : 'Aucune présence saisie.';
    wrap.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'recap-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const dateTh = document.createElement('th');
  dateTh.className = 'recap-date-col';
  dateTh.scope = 'col';
  dateTh.textContent = 'Date';
  headerRow.appendChild(dateTh);
  for (const company of state.companies) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = company.name;
    headerRow.appendChild(th);
  }
  const totalTh = document.createElement('th');
  totalTh.className = 'recap-total-col';
  totalTh.scope = 'col';
  totalTh.textContent = 'Total';
  headerRow.appendChild(totalTh);
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const date of dates) {
    const tr = document.createElement('tr');
    const dateCell = document.createElement('th');
    dateCell.className = 'recap-date-col';
    dateCell.scope = 'row';
    dateCell.textContent = formatDateShortFR(date);
    tr.appendChild(dateCell);
    const entries = state.presences[date] || [];
    let total = 0;
    for (const company of state.companies) {
      const entry = entries.find(e => e.companyId === company.id);
      const count = entry ? entry.count : 0;
      total += count;
      const td = document.createElement('td');
      const onWeather = isCompanyOnWeather(date, company.id);
      if (onWeather) td.classList.add('is-weather');
      td.innerHTML = onWeather
        ? `<span class="recap-count">${count}</span><span class="recap-weather" aria-label="intempéries">🌧</span>`
        : `<span class="recap-count">${count}</span>`;
      tr.appendChild(td);
    }
    const totalTd = document.createElement('td');
    totalTd.className = 'recap-total-col';
    totalTd.textContent = total;
    tr.appendChild(totalTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
}

// Format JJ/MM/AA pour le récap (compact pour les colonnes étroites)
function formatDateShortFR(iso) {
  const d = fromISO(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ---------- Zones (arborescence) ----------
function getZoneChildren(parentId) {
  return state.zones.filter(z => z.parentId === parentId);
}

function getZoneDescendants(id) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const z of state.zones) {
      if (z.parentId === cur && !out.has(z.id)) {
        out.add(z.id);
        stack.push(z.id);
      }
    }
  }
  return out;
}

// Sélection multi-zones (transitoire : non persistée ni synchronisée).
// Permet d'appliquer une action — ex. affecter un ouvrage — à toutes les
// zones cochées d'un coup.
const zoneSelection = new Set();

function renderZones() {
  // Le planning liste les zones racines : il suit toute création,
  // suppression ou renommage.
  renderZonePlanning();
  const tree = document.getElementById('zonetree');
  const empty = document.getElementById('zoneempty');
  if (!tree || !empty) return;
  tree.innerHTML = '';

  // Purge les ids sélectionnés qui n'existent plus (zones supprimées).
  for (const id of [...zoneSelection]) {
    if (!state.zones.some(z => z.id === id)) zoneSelection.delete(id);
  }

  if (state.zones.length === 0) {
    empty.classList.add('show');
    updateZoneBatchBar();
    return;
  }
  empty.classList.remove('show');

  const renderNode = (zone, depth) => {
    const children = getZoneChildren(zone.id);
    const hasChildren = children.length > 0;
    const collapsed = !!state.zoneCollapsed[zone.id];
    const isSelected = zoneSelection.has(zone.id);

    const row = document.createElement('div');
    row.className = 'zone-row' + (isSelected ? ' is-selected' : '');
    row.dataset.id = zone.id;
    row.dataset.depth = String(depth);
    row.style.setProperty('--depth', depth);
    const collapseHtml = hasChildren
      ? `<button class="zone-collapse" data-action="collapse" aria-label="${collapsed ? 'Déplier' : 'Replier'}">${collapsed ? '+' : '−'}</button>`
      : `<span class="zone-collapse-spacer"></span>`;
    row.innerHTML = `
      <div class="zone-row-main">
        <input class="zone-check" type="checkbox" aria-label="Sélectionner cette zone" />
        ${collapseHtml}
        <input class="zone-name-input" type="text" maxlength="80" placeholder="Nom de la zone" />
        <span class="zone-task-slot"></span>
        <button class="zone-add-sub" data-action="add-child" aria-label="Ajouter un sous-niveau">+</button>
        <button class="icon-btn danger" data-action="delete" aria-label="Supprimer">
          <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>
        </button>
      </div>
    `;
    const check = row.querySelector('.zone-check');
    check.checked = isSelected;
    check.addEventListener('change', () => toggleZoneSelection(zone.id, check.checked, row));
    const input = row.querySelector('.zone-name-input');
    input.value = zone.name;
    input.addEventListener('input', () => renameZone(zone.id, input.value));
    if (hasChildren) {
      row.querySelector('[data-action="collapse"]').addEventListener('click', () => toggleCollapse(zone.id));
    }
    row.querySelector('.zone-task-slot').replaceWith(buildZoneTaskPicker(zone));
    row.querySelector('[data-action="add-child"]').addEventListener('click', () => addZone(zone.id));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteZone(zone.id));
    // Liste des ouvrages affectés à la zone, chacun avec sa quantité
    for (const ouvrage of getZoneOuvrages(zone.id)) {
      row.appendChild(buildZoneOuvrageRow(zone, ouvrage));
    }
    tree.appendChild(row);

    if (!collapsed) {
      for (const child of children) renderNode(child, depth + 1);
    }
  };

  for (const root of getZoneChildren(null)) renderNode(root, 0);
  updateZoneBatchBar();
}

// Coche/décoche une zone. Mise à jour ciblée (pas de re-render : on ne
// casse ni le focus ni la position de défilement).
function toggleZoneSelection(zoneId, checked, row) {
  if (checked) zoneSelection.add(zoneId);
  else zoneSelection.delete(zoneId);
  if (row) row.classList.toggle('is-selected', checked);
  updateZoneBatchBar();
}

function clearZoneSelection() {
  zoneSelection.clear();
  document.querySelectorAll('.zone-row.is-selected').forEach(r => {
    r.classList.remove('is-selected');
    const cb = r.querySelector('.zone-check');
    if (cb) cb.checked = false;
  });
  updateZoneBatchBar();
}

// Barre d'actions groupées : visible dès qu'au moins une zone est cochée.
function updateZoneBatchBar() {
  const bar = document.getElementById('zonebatchbar');
  if (!bar) return;
  const n = zoneSelection.size;
  bar.hidden = n === 0;
  const count = document.getElementById('zonebatchcount');
  if (count) count.textContent = n > 1 ? `${n} zones sélectionnées` : `${n} zone sélectionnée`;
}

function toggleCollapse(zoneId) {
  if (state.zoneCollapsed[zoneId]) delete state.zoneCollapsed[zoneId];
  else state.zoneCollapsed[zoneId] = true;
  save();
  renderZones();
}

function addZone(parentId) {
  const zone = { id: uid(), name: '', parentId: parentId || null };
  state.zones.push(zone);
  // déplie le parent pour que la nouvelle sous-zone soit visible
  if (parentId) delete state.zoneCollapsed[parentId];
  save();
  renderZones();
  // Place le curseur dans le champ de la nouvelle zone SANS décaler la vue :
  // preventScroll garde la position de défilement (et donc le « + » cliqué)
  // au même endroit, pour enchaîner les ajouts sans remonter à chaque fois.
  const input = document.querySelector(`.zone-row[data-id="${zone.id}"] .zone-name-input`);
  if (input) input.focus({ preventScroll: true });
}

function renameZone(id, name) {
  const zone = state.zones.find(z => z.id === id);
  if (!zone) return;
  zone.name = name;
  save();
  // pas de re-render : l'utilisateur tape, on ne casse pas le focus
}

function deleteZone(id) {
  const zone = state.zones.find(z => z.id === id);
  if (!zone) return;
  const descendants = getZoneDescendants(id);
  const label = zone.name || 'cette zone';
  const msg = descendants.size > 0
    ? `Supprimer « ${label} » et ses ${descendants.size} sous-zone(s) ?`
    : `Supprimer « ${label} » ?`;
  if (!confirm(msg)) return;
  const toRemove = new Set([id, ...descendants]);
  state.zones = state.zones.filter(z => !toRemove.has(z.id));
  for (const zid of toRemove) {
    delete state.zoneOuvrages[zid];
    delete state.zoneCollapsed[zid];
    delete state.taskProgress[zid];
    delete state.zoneUpdated[zid];
    if (state.zoneDates) delete state.zoneDates[zid];
  }
  if (toRemove.has(state.avancementZoneId)) state.avancementZoneId = null;
  save();
  renderZones();
  renderAvancement();
}

// Picker (select natif iOS) pour AJOUTER un ouvrage à une zone.
// Le select ne liste que les ouvrages pas encore affectés à la zone.
const ZONE_UNITS = ['u', 'Ens.', 'm²', 'ml'];
// Un ouvrage en « u » se compte à la pièce : 12 marquises sur 84, pas 14 %.
// L'avancement reste stocké en pourcentage — c'est lui qui pondère les
// heures, alimente la courbe et la matrice — mais il se SAISIT et s'AFFICHE
// en pièces là où la quantité de la zone est connue.
function isUnitOuvrage(setup) {
  return !!setup && String(setup.unit || '').trim().toLowerCase() === 'u';
}
// Nombre de pièces correspondant à un pourcentage, et l'inverse.
function unitsFromPercent(percent, quantity) {
  return Math.round((quantity * (percent || 0)) / 100);
}
function percentFromUnits(units, quantity) {
  if (!(quantity > 0)) return 0;
  return Math.max(0, Math.min(100, (units / quantity) * 100));
}

// Palette de couleurs d'arrière-plan attribuées automatiquement aux ouvrages
// (selon leur position dans state.taskSetups). Volontairement très transparentes
// pour différencier sans alourdir l'interface.
const OUVRAGE_PALETTE = [
  { bg: 'rgba(33, 150, 243, 0.10)',  border: 'rgba(33, 150, 243, 0.35)' },
  { bg: 'rgba(76, 175, 80, 0.10)',   border: 'rgba(76, 175, 80, 0.35)'  },
  { bg: 'rgba(255, 152, 0, 0.12)',   border: 'rgba(255, 152, 0, 0.40)'  },
  { bg: 'rgba(156, 39, 176, 0.10)',  border: 'rgba(156, 39, 176, 0.35)' },
  { bg: 'rgba(0, 188, 212, 0.10)',   border: 'rgba(0, 188, 212, 0.35)'  },
  { bg: 'rgba(233, 30, 99, 0.10)',   border: 'rgba(233, 30, 99, 0.35)'  },
  { bg: 'rgba(121, 85, 72, 0.10)',   border: 'rgba(121, 85, 72, 0.35)'  },
  { bg: 'rgba(96, 125, 139, 0.10)',  border: 'rgba(96, 125, 139, 0.40)' }
];
function getOuvrageColor(setup) {
  const idx = state.taskSetups.findIndex(s => s.id === setup.id);
  return OUVRAGE_PALETTE[(idx >= 0 ? idx : 0) % OUVRAGE_PALETTE.length];
}
function applyOuvrageColor(el, setup) {
  const c = getOuvrageColor(setup);
  el.style.setProperty('--ouvrage-bg', c.bg);
  el.style.setProperty('--ouvrage-border', c.border);
}
function buildZoneTaskPicker(zone) {
  const assigned = state.zoneOuvrages[zone.id] || [];
  const assignedIds = new Set(assigned.map(o => o.setupId));
  const picker = document.createElement('span');
  picker.className = 'zone-task-picker' + (assigned.length > 0 ? ' active' : '');
  picker.innerHTML = '<svg class="zone-task-icon" viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm-2 14-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8Z"/></svg>';

  const select = document.createElement('select');
  select.className = 'zone-task-select';
  select.setAttribute('aria-label', 'Ajouter un ouvrage à la zone');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Ajouter un ouvrage…';
  select.appendChild(placeholder);
  let available = 0;
  for (const s of state.taskSetups) {
    if (assignedIds.has(s.id)) continue;
    available++;
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name || '(sans nom)';
    select.appendChild(opt);
  }
  if (available === 0) {
    const none = document.createElement('option');
    none.value = '';
    none.disabled = true;
    none.textContent = '(tous déjà affectés)';
    select.appendChild(none);
  }
  select.addEventListener('change', () => {
    const sid = select.value;
    if (sid) addOuvrageToZones(zone.id, sid);
    select.value = '';
  });
  picker.appendChild(select);
  return picker;
}

// Une ligne par ouvrage affecté : nom de l'ouvrage + quantité + unité + bouton retirer
function buildZoneOuvrageRow(zone, ouvrage) {
  const line = document.createElement('div');
  line.className = 'zone-row-ouvrage';

  const name = document.createElement('span');
  name.className = 'zone-ouvrage-name';
  name.textContent = ouvrage.setup.name || '(sans nom)';

  const qtyInput = document.createElement('input');
  qtyInput.className = 'zone-qty-input';
  qtyInput.type = 'text';
  qtyInput.inputMode = 'decimal';
  qtyInput.placeholder = 'Quantité';
  qtyInput.value = ouvrage.quantity ? formatRatio(ouvrage.quantity) : '';
  qtyInput.addEventListener('input', () => setOuvrageQuantity(zone.id, ouvrage.setup.id, parseRatio(qtyInput.value)));

  const unitLabel = document.createElement('span');
  unitLabel.className = 'zone-qty-unit-label';
  unitLabel.textContent = ouvrage.setup.unit || 'm²';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'icon-btn danger';
  removeBtn.setAttribute('aria-label', 'Retirer cet ouvrage de la zone');
  removeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2Z"/></svg>';
  removeBtn.addEventListener('click', () => removeOuvrageFromZone(zone.id, ouvrage.setup.id));

  line.append(name, qtyInput, unitLabel, removeBtn);
  return line;
}

function addOuvrageToZone(zoneId, setupId) {
  if (!state.zoneOuvrages[zoneId]) state.zoneOuvrages[zoneId] = [];
  if (state.zoneOuvrages[zoneId].some(o => o.setupId === setupId)) return;
  state.zoneOuvrages[zoneId].push({ setupId, quantity: 0 });
  save();
  renderZones();
  renderAvancement();
}

// Affecte un ouvrage à une zone ; si cette zone fait partie d'une sélection
// multiple (cases cochées), l'ouvrage est affecté à TOUTES les zones cochées
// d'un coup. Sinon, comportement normal (une seule zone).
function addOuvrageToZones(zoneId, setupId) {
  const targets = (zoneSelection.has(zoneId) && zoneSelection.size > 0)
    ? [...zoneSelection]
    : [zoneId];
  let changed = false;
  for (const zid of targets) {
    if (!state.zones.some(z => z.id === zid)) continue; // zone disparue
    if (!state.zoneOuvrages[zid]) state.zoneOuvrages[zid] = [];
    if (state.zoneOuvrages[zid].some(o => o.setupId === setupId)) continue; // déjà présent
    state.zoneOuvrages[zid].push({ setupId, quantity: 0 });
    changed = true;
  }
  if (!changed) return;
  save();
  renderZones();
  renderAvancement();
}

function removeOuvrageFromZone(zoneId, setupId) {
  const list = state.zoneOuvrages[zoneId];
  if (!list) return;
  state.zoneOuvrages[zoneId] = list.filter(o => o.setupId !== setupId);
  if (state.zoneOuvrages[zoneId].length === 0) {
    delete state.zoneOuvrages[zoneId];
    if (state.avancementZoneId === zoneId) state.avancementZoneId = null;
  }
  save();
  renderZones();
  renderAvancement();
}

function setOuvrageQuantity(zoneId, setupId, quantity) {
  const list = state.zoneOuvrages[zoneId];
  if (!list) return;
  const entry = list.find(o => o.setupId === setupId);
  if (!entry) return;
  entry.quantity = quantity;
  save();
}

// ---------- Données → Tâches : les ouvrages et leurs tâches ----------
// Un « ouvrage » est un mode opératoire réutilisable : une unité (m², ml, U…)
// et la liste des tâches qui le composent, chacune pesant une part du ratio
// total en h/unité. On l'affecte ensuite à des zones (Données → Zones) et on
// peut y rattacher une ligne de budget (Données → eOTP).
// L'ancienne barre était un menu déroulant : on ne voyait ni les autres
// ouvrages, ni ce qu'ils contenaient. Ce sont maintenant des vignettes.
function renderSetupBar() {
  const bar = document.getElementById('setupbar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const st of state.taskSetups) {
    const actif = st.id === state.currentSetupId;
    const chip = dbEl('button', 'ouvrage-chip' + (actif ? ' is-active' : ''));
    chip.type = 'button';
    chip.dataset.setupId = st.id;
    chip.setAttribute('aria-pressed', actif ? 'true' : 'false');
    chip.appendChild(dbEl('span', 'ouvrage-chip-name', st.name || '(ouvrage sans nom)'));
    const n = (st.tasks || []).length;
    const ratio = (st.tasks || []).filter(t => !t.excluded).reduce((a, t) => a + (t.ratio || 0), 0);
    chip.appendChild(dbEl('span', 'ouvrage-chip-meta',
      n ? n + (n > 1 ? ' tâches · ' : ' tâche · ') + formatRatio(ratio) + ' h/' + (st.unit || 'm²')
        : 'aucune tâche'));
    chip.addEventListener('click', () => switchSetup(st.id));
    bar.appendChild(chip);
  }
  const add = dbEl('button', 'ouvrage-chip ouvrage-chip-add');
  add.type = 'button';
  add.appendChild(dbEl('span', 'ouvrage-chip-name', '+ Nouvel ouvrage'));
  add.appendChild(dbEl('span', 'ouvrage-chip-meta', 'bardage, habillage, marquise…'));
  add.addEventListener('click', addSetup);
  bar.appendChild(add);
}

// En-tête de l'ouvrage courant : nom modifiable sur place (plus de mode
// « renommage » à activer), unité, et suppression.
function renderOuvrageHead() {
  const head = document.getElementById('ouvragehead');
  if (!head) return;
  head.innerHTML = '';
  const setup = getCurrentSetup();
  if (!setup) return;

  const nom = document.createElement('input');
  nom.className = 'ouvrage-name';
  nom.type = 'text'; nom.maxLength = 40;
  nom.value = setup.name || '';
  nom.placeholder = 'Nom de l\'ouvrage';
  nom.setAttribute('aria-label', 'Nom de l\'ouvrage');
  nom.addEventListener('input', () => {
    setup.name = nom.value;
    save();
    // La vignette et les menus qui citent cet ouvrage suivent la frappe,
    // mais on ne re-rend pas le champ lui-même : le focus resterait perdu.
    const chip = document.querySelector('.ouvrage-chip[data-setup-id="' + cssEscape(setup.id) + '"] .ouvrage-chip-name');
    if (chip) chip.textContent = setup.name || '(ouvrage sans nom)';
  });
  nom.addEventListener('change', () => { renderSetupBar(); renderEOTPsConfig(); renderAvancement(); });
  head.appendChild(nom);

  const uWrap = dbEl('label', 'ouvrage-unit');
  uWrap.appendChild(dbEl('span', 'ouvrage-unit-label', 'Unité'));
  const uSel = document.createElement('select');
  uSel.className = 'ouvrage-unit-select';
  uSel.setAttribute('aria-label', 'Unité de l\'ouvrage');
  for (const u of ZONE_UNITS) {
    const opt = document.createElement('option');
    opt.value = u; opt.textContent = u;
    if (u === setup.unit) opt.selected = true;
    uSel.appendChild(opt);
  }
  uSel.addEventListener('change', () => {
    setup.unit = uSel.value;
    save();
    renderSetupBar(); renderTasks(); renderZones(); renderAvancement();
  });
  uWrap.appendChild(uSel);
  head.appendChild(uWrap);

  const del = dbEl('button', 'ouvrage-del');
  del.type = 'button';
  del.textContent = 'Supprimer';
  del.title = 'Supprimer cet ouvrage et ses tâches';
  del.disabled = state.taskSetups.length <= 1;
  if (del.disabled) del.title = 'Le dernier ouvrage ne peut pas être supprimé';
  del.addEventListener('click', deleteSetup);
  head.appendChild(del);
}

function switchSetup(setupId) {
  if (!getSetup(setupId)) return;
  state.currentSetupId = setupId;
  save();
  renderSetupBar();
  renderOuvrageHead();
  renderTasks();
}

function addSetup() {
  const setup = { id: uid(), name: `Ouvrage ${state.taskSetups.length + 1}`, unit: 'm²', tasks: [] };
  state.taskSetups.push(setup);
  state.currentSetupId = setup.id;
  save();
  renderSetupBar();
  renderOuvrageHead();
  renderTasks();
  // Le menu « Ouvrage rattaché » de Données → eOTP doit connaître le nouvel
  // ouvrage tout de suite : sans ce rendu, il gardait la liste d'avant.
  renderEOTPsConfig();
  requestAnimationFrame(() => {
    const inp = document.querySelector('.ouvrage-name');
    if (inp) { inp.focus(); inp.select(); }
  });
}

function deleteSetup() {
  if (state.taskSetups.length <= 1) return;
  const setup = getCurrentSetup();
  if (!setup) return;
  const lignes = getEOTPs().filter(e => e.setupId === setup.id).length;
  if (!confirm(`Supprimer l'ouvrage « ${setup.name} » et ses tâches ?\n`
    + `Les zones qui l'utilisaient n'auront plus de tâches affectées`
    + (lignes ? `, et ${lignes} ligne(s) de budget repasseront en saisie manuelle` : '') + '.')) return;
  const taskIds = new Set(setup.tasks.map(t => t.id));
  // Retire cet ouvrage de toutes les zones qui l'utilisaient
  for (const zid of Object.keys(state.zoneOuvrages)) {
    const next = state.zoneOuvrages[zid].filter(o => o.setupId !== setup.id);
    if (next.length === 0) delete state.zoneOuvrages[zid];
    else state.zoneOuvrages[zid] = next;
  }
  for (const zid of Object.keys(state.taskProgress)) {
    for (const tid of Object.keys(state.taskProgress[zid])) {
      if (taskIds.has(tid)) delete state.taskProgress[zid][tid];
    }
    if (Object.keys(state.taskProgress[zid]).length === 0) delete state.taskProgress[zid];
  }
  state.taskSetups = state.taskSetups.filter(s => s.id !== setup.id);
  state.currentSetupId = state.taskSetups[0].id;
  if (state.avancementZoneId && !zoneIsTaskBearing(state.avancementZoneId)) state.avancementZoneId = null;
  save();
  renderSetupBar();
  renderOuvrageHead();
  renderTasks();
  renderZones();
  renderAvancement();
  renderEOTPsConfig();   // le rattachement des lignes de budget a pu tomber
}

// ---------- Tâches d'un ouvrage ----------
function renderTasks() {
  renderOuvrageHead();
  const list = document.getElementById('tasklist');
  const empty = document.getElementById('taskempty');
  if (!list || !empty) return;
  list.innerHTML = '';

  const setup = getCurrentSetup();
  const tasks = setup ? setup.tasks : [];
  if (tasks.length === 0) {
    empty.classList.add('show');
    updateRatioSum();
    return;
  }
  empty.classList.remove('show');

  // Part de chaque tâche dans le ratio total : c'est ce qui dit d'un coup
  // d'œil laquelle pèse, ce qu'une colonne de nombres ne montrait pas.
  const total = tasks.filter(t => !t.excluded).reduce((a, t) => a + (t.ratio || 0), 0);
  const unite = 'h/' + (setup.unit || 'm²');

  for (const task of tasks) {
    const excluded = !!task.excluded;
    const li = dbEl('li', 'task-item' + (excluded ? ' excluded' : ''));
    li.dataset.id = task.id;

    const handle = dbEl('button', 'drag-handle');
    handle.type = 'button';
    handle.setAttribute('aria-label', 'Maintenir et glisser pour réorganiser');
    handle.title = 'Maintenir et glisser pour réorganiser';
    handle.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z"/></svg>';
    li.appendChild(handle);

    const nom = document.createElement('input');
    nom.className = 'task-name-input';
    nom.type = 'text'; nom.maxLength = 80;
    nom.placeholder = 'Nom de la tâche';
    nom.value = task.name || '';
    nom.setAttribute('aria-label', 'Nom de la tâche');
    nom.addEventListener('input', () => renameTask(task.id, nom.value));
    li.appendChild(nom);

    const ratioWrap = dbEl('div', 'task-ratio');
    const ri = document.createElement('input');
    ri.className = 'task-ratio-input';
    ri.type = 'text'; ri.inputMode = 'decimal';
    ri.placeholder = '0';
    ri.value = task.ratio ? formatRatio(task.ratio) : '';
    ri.setAttribute('aria-label', 'Ratio de la tâche, en ' + unite);
    ri.addEventListener('input', () => {
      task.ratio = parseRatio(ri.value);
      save();
      updateRatioSum();
      refreshTaskShares();
    });
    ratioWrap.appendChild(ri);
    ratioWrap.appendChild(dbEl('span', 'task-ratio-unit', excluded ? 'hors ratio' : unite));
    li.appendChild(ratioWrap);

    // Barre de part + pourcentage, mis à jour sans reconstruire la ligne.
    const share = dbEl('div', 'task-share');
    const bar = dbEl('div', 'task-share-bar');
    bar.appendChild(dbEl('span', 'task-share-fill'));
    share.appendChild(bar);
    share.appendChild(dbEl('span', 'task-share-pct'));
    li.appendChild(share);

    const excl = dbEl('button', 'task-exclude-btn' + (excluded ? ' active' : ''));
    excl.type = 'button';
    excl.title = excluded
      ? 'Tâche hors ratio : elle ne compte pas dans le ratio de production (toucher pour la réintégrer)'
      : 'Sortir cette tâche du ratio de production (elle reste listée, mais ne pèse plus)';
    excl.setAttribute('aria-label', excl.title);
    excl.setAttribute('aria-pressed', excluded ? 'true' : 'false');
    excl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 1H9v2h6V1Zm4.03 6.39 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.96 8.96 0 0 0 12 4a9 9 0 1 0 9 9c0-2.12-.74-4.07-1.97-5.61ZM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-6h2V8h-2v6Z"/><path d="M3.5 2.1 21.9 20.5l-1.4 1.4L2.1 3.5 3.5 2.1Z"/></svg>';
    excl.addEventListener('click', () => toggleTaskExcluded(task.id));
    li.appendChild(excl);

    const del = dbEl('button', 'icon-btn danger');
    del.type = 'button';
    del.setAttribute('aria-label', 'Supprimer la tâche');
    del.title = 'Supprimer la tâche';
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>';
    del.addEventListener('click', () => deleteTask(task.id));
    li.appendChild(del);

    attachTaskDrag(handle, li);
    list.appendChild(li);
  }
  refreshTaskShares();
  updateRatioSum();
}

// Les barres de part se recalculent à chaque frappe dans un ratio : les
// reconstruire ferait perdre le focus du champ en cours de saisie.
function refreshTaskShares() {
  const setup = getCurrentSetup();
  if (!setup) return;
  const total = setup.tasks.filter(t => !t.excluded).reduce((a, t) => a + (t.ratio || 0), 0);
  for (const t of setup.tasks) {
    const li = document.querySelector('.task-item[data-id="' + cssEscape(t.id) + '"]');
    if (!li) continue;
    const fill = li.querySelector('.task-share-fill');
    const pct = li.querySelector('.task-share-pct');
    const part = (!t.excluded && total > 0) ? ((t.ratio || 0) / total) * 100 : 0;
    if (fill) fill.style.width = Math.max(0, Math.min(100, part)) + '%';
    if (pct) pct.textContent = t.excluded ? '—' : (total > 0 ? Math.round(part) + ' %' : '—');
  }
}

function updateRatioSum() {
  const el = document.getElementById('ratiototal');
  if (!el) return;
  el.innerHTML = '';
  const setup = getCurrentSetup();
  if (!setup || setup.tasks.length === 0) { el.hidden = true; return; }
  el.hidden = false;
  const actives = setup.tasks.filter(t => !t.excluded);
  const sum = actives.reduce((s, t) => s + (t.ratio || 0), 0);
  const hors = setup.tasks.length - actives.length;
  el.appendChild(dbEl('span', 'ratio-total-label', 'Ratio de production total'));
  const v = dbEl('span', 'ratio-total-value', formatRatio(sum) + ' h/' + (setup.unit || 'm²'));
  el.appendChild(v);
  el.appendChild(dbEl('span', 'ratio-total-detail',
    actives.length + (actives.length > 1 ? ' tâches comptées' : ' tâche comptée')
    + (hors ? ' · ' + hors + ' hors ratio' : '')));
}

function toggleTaskExcluded(id) {
  const setup = getCurrentSetup();
  const t = setup && setup.tasks.find(t => t.id === id);
  if (!t) return;
  t.excluded = !t.excluded;
  save();
  renderTasks();
  renderAvancement();
}

function addTask() {
  const setup = getCurrentSetup();
  if (!setup) return;
  const task = { id: uid(), name: '' };
  setup.tasks.push(task);
  save();
  renderTasks();
  const input = document.querySelector(`.task-item[data-id="${task.id}"] .task-name-input`);
  if (input) {
    input.focus();
    input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function renameTask(id, name) {
  const setup = getCurrentSetup();
  const t = setup && setup.tasks.find(t => t.id === id);
  if (!t) return;
  t.name = name;
  save();
}

function deleteTask(id) {
  const setup = getCurrentSetup();
  if (!setup) return;
  const t = setup.tasks.find(t => t.id === id);
  if (!t) return;
  const label = t.name || 'cette tâche';
  if (!confirm(`Supprimer la tâche « ${label} » ?`)) return;
  setup.tasks = setup.tasks.filter(t => t.id !== id);
  // Nettoyage des avancements liés à cette tâche
  for (const zoneId of Object.keys(state.taskProgress)) {
    delete state.taskProgress[zoneId][id];
    if (Object.keys(state.taskProgress[zoneId]).length === 0) delete state.taskProgress[zoneId];
  }
  save();
  renderTasks();
  renderAvancement();
}

// ---------- Drag & drop des tâches (long-press 300ms puis glisser) ----------
const LONG_PRESS_MS = 300;

function attachTaskDrag(handle, itemEl) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const list = itemEl.parentElement;
    if (!list) return;

    const startY = e.clientY;
    const items = Array.from(list.children);
    const startIdx = items.indexOf(itemEl);
    const rects = items.map(el => el.getBoundingClientRect());
    const gap = (rects[1]?.top || 0) - (rects[0]?.bottom || 0);
    const slot = (rects[0]?.height || 56) + Math.max(gap, 0);
    let currentIdx = startIdx;
    let dragMode = false;

    const enterDrag = () => {
      dragMode = true;
      itemEl.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(12);
    };
    const pressTimer = setTimeout(enterDrag, LONG_PRESS_MS);

    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      if (!dragMode) {
        if (Math.abs(dy) > 8) {
          clearTimeout(pressTimer);
        }
        return;
      }
      ev.preventDefault();
      itemEl.style.transform = `translateY(${dy}px)`;

      const dragCenter = rects[startIdx].top + rects[startIdx].height / 2 + dy;
      let newIdx = startIdx;
      for (let i = 0; i < rects.length; i++) {
        if (i === startIdx) continue;
        const r = rects[i];
        if (dragCenter >= r.top && dragCenter <= r.bottom) {
          newIdx = i;
          break;
        }
      }
      if (dragCenter < rects[0].top) newIdx = 0;
      else if (dragCenter > rects[rects.length - 1].bottom) newIdx = rects.length - 1;

      if (newIdx !== currentIdx) {
        currentIdx = newIdx;
        for (let i = 0; i < items.length; i++) {
          if (i === startIdx) continue;
          let shift = 0;
          if (startIdx < currentIdx && i > startIdx && i <= currentIdx) shift = -slot;
          else if (startIdx > currentIdx && i < startIdx && i >= currentIdx) shift = slot;
          items[i].style.transform = `translateY(${shift}px)`;
        }
      }
    };

    const onUp = () => {
      clearTimeout(pressTimer);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);

      if (dragMode && currentIdx !== startIdx) {
        const setup = getCurrentSetup();
        if (setup) {
          const [moved] = setup.tasks.splice(startIdx, 1);
          setup.tasks.splice(currentIdx, 0, moved);
          save();
        }
      }
      items.forEach(el => { el.style.transform = ''; });
      itemEl.classList.remove('dragging');
      if (dragMode) renderTasks();
    };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}

// ---------- Avancement ----------
function getZonePath(zoneId) {
  const path = [];
  let id = zoneId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const z = state.zones.find(z => z.id === id);
    if (!z) break;
    path.unshift(z);
    id = z.parentId;
  }
  return path;
}

function getTaskZonesInOrder() {
  // parcours pré-ordre de l'arborescence, en respectant l'ordre d'insertion
  const result = [];
  const walk = (parentId) => {
    for (const z of state.zones.filter(z => z.parentId === parentId)) {
      if (zoneIsTaskBearing(z.id)) result.push(z);
      walk(z.id);
    }
  };
  walk(null);
  return result;
}


function getProgress(zoneId, taskId) {
  return state.taskProgress[zoneId]?.[taskId] || 0;
}

// `libre` : ne pas caler sur le pas de 5 %. Une saisie à la pièce doit
// pouvoir valoir 13/84, ce que l'arrondi au multiple de 5 rendrait
// impossible à atteindre.
function setProgress(zoneId, taskId, percent, libre) {
  percent = libre
    ? Math.max(0, Math.min(100, percent))
    : Math.max(0, Math.min(100, Math.round(percent / 5) * 5));
  if (percent === 0) {
    if (state.taskProgress[zoneId]) {
      delete state.taskProgress[zoneId][taskId];
      if (Object.keys(state.taskProgress[zoneId]).length === 0) delete state.taskProgress[zoneId];
    }
  } else {
    if (!state.taskProgress[zoneId]) state.taskProgress[zoneId] = {};
    state.taskProgress[zoneId][taskId] = percent;
  }
  state.zoneUpdated[zoneId] = Date.now();
  save();
  invalidateHeuresModel();
  // Point d'historique du jour : c'est ce qui alimente la courbe
  // d'avancement et le calcul du rythme (throttlé en interne).
  stampAvancementHistory();
}

// Avancement global d'un ouvrage : PONDÉRÉ PAR LES HEURES ALLOUÉES à
// chaque tâche (heures = quantité de la zone × ratio de la tâche). La
// quantité étant commune à toutes les tâches d'un même ouvrage, elle se
// simplifie : pondérer par les heures ⇔ pondérer par les ratios. Une
// tâche à 10 h pèse donc 5× plus qu'une tâche à 2 h dans le % global.
// Les tâches « hors ratio » (excluded) sont ignorées dans ce calcul.
// Repli sur la moyenne simple si aucun ratio n'est renseigné.
// Avancement d'un ouvrage donné dans une zone (0..100, raw, non arrondi)
function getOuvrageRawProgress(zoneId, setup) {
  if (!setup) return 0;
  const tasks = setup.tasks.filter(t => !t.excluded);
  if (tasks.length === 0) return 0;
  const totalRatio = tasks.reduce((s, t) => s + (t.ratio || 0), 0);
  if (totalRatio > 0) {
    let weighted = 0;
    for (const t of tasks) weighted += (t.ratio || 0) * getProgress(zoneId, t.id);
    return weighted / totalRatio;
  }
  let sum = 0;
  for (const t of tasks) sum += getProgress(zoneId, t.id);
  return sum / tasks.length;
}
function getOuvrageProgress(zoneId, setup) {
  return Math.round(getOuvrageRawProgress(zoneId, setup) * 10) / 10;
}

// Heures totales allouées à un ouvrage dans une zone :
//   quantité de la zone × Σ des ratios des tâches actives (h/unité).
// Ex. bardage 20 m² à 2 h/m² = 40 h ; habillage alu 5 ml à 0,58 h/ml = 2,9 h.
// 0 si la quantité ou les ratios ne sont pas renseignés.
function getOuvrageAllocatedHours(quantity, setup) {
  if (!setup || !(quantity > 0)) return 0;
  const totalRatio = setup.tasks
    .filter(t => !t.excluded)
    .reduce((s, t) => s + (t.ratio || 0), 0);
  return quantity * totalRatio;
}

// % global de la zone : PONDÉRÉ PAR LES HEURES ALLOUÉES de chaque ouvrage
// (quantité × Σ ratios). Indispensable quand une même zone porte des
// ouvrages d'unités différentes : bardage 40 h à 0 % + habillage alu
// 2,9 h à 100 % → 2,9 / 42,9 = 6,8 %, et non 50 % en moyenne simple.
// Repli sur la moyenne simple si aucun ouvrage n'a d'heures calculables
// (quantités ou ratios non renseignés).
function getZoneProgress(zoneId) {
  const ouvrages = getZoneOuvrages(zoneId);
  if (ouvrages.length === 0) return 0;
  let totalHours = 0, weighted = 0;
  for (const o of ouvrages) {
    const h = getOuvrageAllocatedHours(o.quantity, o.setup);
    totalHours += h;
    weighted += h * getOuvrageRawProgress(zoneId, o.setup);
  }
  if (totalHours > 0) return Math.round((weighted / totalHours) * 10) / 10;
  let sum = 0;
  for (const o of ouvrages) sum += getOuvrageRawProgress(zoneId, o.setup);
  return Math.round((sum / ouvrages.length) * 10) / 10;
}

function formatPct(n) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}
function formatRatio(n) {
  return (n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}
function parseRatio(str) {
  const n = parseFloat(String(str).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatUpdatedDate(ts) {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function changeProgress(zoneId, taskId, delta, libre) {
  const cur = getProgress(zoneId, taskId);
  setProgress(zoneId, taskId, cur + delta, libre);
  renderFicheHeader();
  renderProgressList();
  renderRecap();
}
// Avance ou recule d'un nombre de PIÈCES. On repart du compte affiché et non
// du pourcentage brut : sinon un arrondi d'affichage ferait sauter deux
// pièces d'un coup, ou aucune.
function changeProgressUnits(zoneId, taskId, quantity, delta) {
  const cur = getProgress(zoneId, taskId);
  const pieces = unitsFromPercent(cur, quantity) + delta;
  setProgress(zoneId, taskId, percentFromUnits(pieces, quantity), true);
  renderFicheHeader();
  renderProgressList();
  renderRecap();
}

function navigateAvancement(delta) {
  // Navigation bornée au bâtiment courant (cf. renderAvancement).
  const root = getZoneRoot(state.avancementZoneId);
  const list = getTaskZonesInOrder().filter(z => getZoneRoot(z.id) === root);
  const idx = list.findIndex(z => z.id === state.avancementZoneId);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= list.length) return;
  state.avancementZoneId = list[newIdx].id;
  save();
  renderAvancement();
}

// Zone racine (bâtiment) d'une zone quelconque.
function getZoneRoot(zoneId) {
  let z = state.zones.find(x => x.id === zoneId);
  let guard = 0;
  while (z && z.parentId && guard++ < 100) {
    const parent = state.zones.find(x => x.id === z.parentId);
    if (!parent) break;
    z = parent;
  }
  return z ? z.id : null;
}

function resolveAvancementZone() {
  // Valide / fallback la zone sélectionnée
  const list = getTaskZonesInOrder();
  if (list.length === 0) {
    state.avancementZoneId = null;
    return null;
  }
  const current = list.find(z => z.id === state.avancementZoneId);
  if (current) return current;
  state.avancementZoneId = list[0].id;
  return list[0];
}

// ========================================================================
// SÉLECTEUR DE ZONE DÉPLIABLE — composant partagé
// Une seule arborescence, repliable branche par branche, réutilisée par
// tous les écrans qui demandent de choisir une (ou des) zone(s) :
// Avancement, Travaux → Visite, Travaux → Carnet.
// L'état replié/déplié est per-device (jamais synchronisé) : chacun
// organise sa lecture comme il l'entend.
// ========================================================================
function getZonePickerCollapsed() {
  if (!state.zonePickerCollapsed || typeof state.zonePickerCollapsed !== 'object') state.zonePickerCollapsed = {};
  return state.zonePickerCollapsed;
}
// Ouvre le chemin menant à une zone (à l'ouverture d'un sélecteur, on veut
// voir la sélection courante sans avoir à déplier soi-même).
function expandZonePickerPath(zoneId) {
  const col = getZonePickerCollapsed();
  for (const id of travauxZoneAncestors(zoneId)) delete col[id];
}
function toggleZonePickerNode(zoneId) {
  const col = getZonePickerCollapsed();
  if (col[zoneId]) delete col[zoneId];
  else col[zoneId] = true;
  save();
}
// Replie / déplie tout l'arbre d'un coup.
function setZonePickerAllCollapsed(collapsed) {
  const col = getZonePickerCollapsed();
  for (const k of Object.keys(col)) delete col[k];
  if (collapsed) for (const z of state.zones) if (travauxZoneChildren(z.id).length) col[z.id] = true;
  save();
}
function zonePickerAllCollapsed() {
  const col = getZonePickerCollapsed();
  const parents = state.zones.filter(z => travauxZoneChildren(z.id).length);
  return parents.length > 0 && parents.every(z => col[z.id]);
}

// opts :
//   mode        'select' (une zone) | 'check' (cases à cocher)
//   selectedId  zone active en mode select
//   isChecked / isInherited / isSelectable   prédicats optionnels
//   badge(zone) texte de la pastille de droite (ou null)
//   onSelect(zone) / onToggle(zone, checked)
//   filter      texte de recherche (les branches menant à un résultat
//               restent visibles et dépliées)
//   rerender()  appelé après un pli/dépli
function buildZonePickerTree(opts) {
  const col = getZonePickerCollapsed();
  const q = (opts.filter || '').trim().toLowerCase();
  // En recherche, on ne garde que les zones trouvées et leur chemin d'accès.
  let visible = null;
  if (q) {
    visible = new Set();
    const byId = new Map(state.zones.map(z => [z.id, z]));
    for (const z of state.zones) {
      if (!(z.name || '').toLowerCase().includes(q)) continue;
      let cur = z, guard = 0;
      while (cur && guard++ < 40) { visible.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : null; }
    }
  }
  const tree = document.createElement('div');
  tree.className = 'zp-tree';
  let shown = 0;

  const walk = (parentId, depth) => {
    for (const z of travauxZoneChildren(parentId)) {
      if (visible && !visible.has(z.id)) continue;
      const kids = travauxZoneChildren(z.id).filter(k => !visible || visible.has(k.id));
      // Une recherche en cours force le dépli : sinon les résultats
      // resteraient cachés sous une branche repliée.
      const collapsed = kids.length > 0 && !!col[z.id] && !q;
      shown++;

      const row = document.createElement('div');
      row.className = 'zp-row';
      row.style.setProperty('--d', String(Math.min(depth, 6)));

      if (kids.length) {
        const caret = document.createElement('button');
        caret.type = 'button';
        caret.className = 'zp-caret' + (collapsed ? '' : ' is-open');
        caret.setAttribute('aria-label', collapsed ? 'Déplier' : 'Replier');
        caret.setAttribute('aria-expanded', String(!collapsed));
        caret.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleZonePickerNode(z.id);
          opts.rerender();
        });
        row.appendChild(caret);
      } else {
        const sp = document.createElement('span');
        sp.className = 'zp-caret zp-caret-void';
        row.appendChild(sp);
      }

      const selectable = opts.isSelectable ? opts.isSelectable(z) : true;
      const badge = opts.badge ? opts.badge(z) : null;

      if (opts.mode === 'check') {
        const checked = opts.isChecked ? opts.isChecked(z) : false;
        const inherited = !checked && opts.isInherited ? opts.isInherited(z) : false;
        const lbl = document.createElement('label');
        lbl.className = 'zp-item zp-check' + (checked ? ' is-on' : '') + (inherited ? ' is-inherited' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked || inherited;
        cb.disabled = inherited;
        cb.addEventListener('change', () => opts.onToggle(z, cb.checked));
        lbl.appendChild(cb);
        const nm = document.createElement('span');
        nm.className = 'zp-name';
        travauxHiliteInto(nm, z.name || '(zone)', q);
        lbl.appendChild(nm);
        if (inherited) {
          const tag = document.createElement('span');
          tag.className = 'zp-tag';
          tag.textContent = 'hérité';
          lbl.appendChild(tag);
        }
        row.appendChild(lbl);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'zp-item'
          + (opts.selectedId === z.id ? ' is-on' : '')
          + (selectable ? '' : ' is-structural');
        const nm = document.createElement('span');
        nm.className = 'zp-name';
        travauxHiliteInto(nm, z.name || '(zone)', q);
        btn.appendChild(nm);
        if (badge != null) {
          const b = document.createElement('span');
          b.className = 'zp-badge';
          b.textContent = badge;
          btn.appendChild(b);
        }
        btn.addEventListener('click', () => {
          // Une zone « de structure » (sans tâches) sert de branche : la
          // toucher la déplie plutôt que de ne rien faire.
          if (!selectable) {
            if (kids.length) { toggleZonePickerNode(z.id); opts.rerender(); }
            return;
          }
          opts.onSelect(z);
        });
        row.appendChild(btn);
      }
      tree.appendChild(row);
      if (kids.length && !collapsed) walk(z.id, depth + 1);
    }
  };
  walk(null, 0);

  if (!shown) {
    const e = document.createElement('p');
    e.className = 'zp-empty';
    e.textContent = state.zones.length ? 'Aucune zone ne correspond.' : 'Créez vos zones dans Données → Zones.';
    tree.appendChild(e);
  }
  return tree;
}
// Barre « tout replier / tout déplier » commune aux sélecteurs.
function buildZonePickerFoldBar(rerender, extra) {
  const bar = document.createElement('div');
  bar.className = 'zp-bar';
  const allFolded = zonePickerAllCollapsed();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'zp-fold';
  btn.textContent = allFolded ? 'Tout déplier' : 'Tout replier';
  btn.addEventListener('click', () => { setZonePickerAllCollapsed(!allFolded); rerender(); });
  bar.appendChild(btn);
  if (extra) bar.appendChild(extra);
  return bar;
}


// Sélecteur de zone de l'onglet Avancement : ligne de chemin repliée par
// défaut, arbre complet au clic. L'état d'ouverture est purement d'écran.
let avancementPickerOpen = false;
function buildAvancementZonePicker(zone) {
  const wrap = document.createElement('div');
  wrap.className = 'zp' + (avancementPickerOpen ? ' is-open' : '');

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'zp-head';
  head.setAttribute('aria-expanded', String(avancementPickerOpen));
  const pin = document.createElement('span');
  pin.className = 'zp-pin';
  pin.textContent = '📍';
  head.appendChild(pin);
  const crumb = document.createElement('span');
  crumb.className = 'zp-crumb';
  const path = getZonePath(zone.id);
  path.forEach((z, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'zp-crumb-sep';
      sep.textContent = '›';
      crumb.appendChild(sep);
    }
    const seg = document.createElement('span');
    seg.className = 'zp-crumb-seg' + (i === path.length - 1 ? ' is-last' : '');
    seg.textContent = z.name || '(zone)';
    crumb.appendChild(seg);
  });
  head.appendChild(crumb);
  const chevron = document.createElement('span');
  chevron.className = 'zp-chevron';
  head.appendChild(chevron);
  head.addEventListener('click', () => {
    avancementPickerOpen = !avancementPickerOpen;
    if (avancementPickerOpen) expandZonePickerPath(zone.id);
    renderAvancement();
  });
  wrap.appendChild(head);

  if (avancementPickerOpen) {
    const panel = document.createElement('div');
    panel.className = 'zp-panel';
    panel.appendChild(buildZonePickerFoldBar(() => renderAvancement()));
    panel.appendChild(buildZonePickerTree({
      mode: 'select',
      selectedId: zone.id,
      isSelectable: (z) => zoneIsTaskBearing(z.id),
      badge: (z) => zoneIsTaskBearing(z.id) ? formatPct(getZoneProgress(z.id)) + ' %' : null,
      onSelect: (z) => {
        state.avancementZoneId = z.id;
        avancementPickerOpen = false;
        save();
        renderAvancement();
      },
      rerender: () => renderAvancement(),
    }));
    wrap.appendChild(panel);
  }
  return wrap;
}

function renderAvancement() {
  renderRecap();
  renderHeures();
  const pickers = document.getElementById('zonepickers');
  const fiche = document.getElementById('zonefiche');
  const empty = document.getElementById('avancementempty');
  if (!pickers || !fiche || !empty) return;

  pickers.innerHTML = '';

  // Cas 1 : pas de zones du tout
  if (state.zones.length === 0) {
    fiche.hidden = true;
    empty.innerHTML = '<p>Aucune zone créée.</p><p class="hint">Commencez par construire votre arborescence dans <strong>Données → Zones</strong>.</p>';
    empty.classList.add('show');
    return;
  }
  // Cas 2 : aucune zone n'a de configuration de tâches affectée
  const taskZones = getTaskZonesInOrder();
  if (taskZones.length === 0) {
    fiche.hidden = true;
    empty.innerHTML = '<p>Aucune zone n\'a de configuration de tâches.</p><p class="hint">Dans <strong>Données → Zones</strong>, touchez l\'icône tâche d\'une zone et choisissez une configuration.</p>';
    empty.classList.add('show');
    return;
  }

  const zone = resolveAvancementZone();
  if (!zone) {
    fiche.hidden = true;
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');

  // Sélecteur de zone : le chemin courant, et l'arborescence dépliable qui
  // s'ouvre à la demande. Une enfilade de menus natifs devient illisible
  // dès qu'un niveau compte trente logements.
  pickers.appendChild(buildAvancementZonePicker(zone));

  // Fiche : en-tête (flèches + titre) + liste de tâches
  fiche.hidden = false;
  // Les flèches restent dans le bâtiment courant : passer de la dernière
  // zone d'un bâtiment à la première du suivant fait perdre le fil. Au bord,
  // la flèche est grisée et l'on change de bâtiment par le sélecteur.
  const root = getZoneRoot(zone.id);
  const sameB = taskZones.filter(z => getZoneRoot(z.id) === root);
  const idx = sameB.findIndex(z => z.id === zone.id);
  const prevBtn = document.getElementById('ficheprev');
  const nextBtn = document.getElementById('fichenext');
  prevBtn.disabled = idx <= 0;
  nextBtn.disabled = idx < 0 || idx >= sameB.length - 1;
  const bName = (state.zones.find(z => z.id === root) || {}).name || 'ce bâtiment';
  prevBtn.title = prevBtn.disabled ? 'Première zone de ' + bName + ' — changez de bâtiment ci-dessus' : 'Zone précédente';
  nextBtn.title = nextBtn.disabled ? 'Dernière zone de ' + bName + ' — changez de bâtiment ci-dessus' : 'Zone suivante';

  renderFicheHeader();
  renderProgressList();
}

function renderFicheHeader() {
  const zone = state.zones.find(z => z.id === state.avancementZoneId);
  if (!zone) return;

  const pct = getZoneProgress(zone.id);
  document.querySelector('.fiche-header').classList.toggle('is-complete', pct >= 100);

  const titleEl = document.getElementById('fichetitle');
  titleEl.textContent = '';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = zone.name || '(zone sans nom)';
  const pctSpan = document.createElement('span');
  pctSpan.className = 'fiche-pct';
  pctSpan.textContent = `(${formatPct(pct)} %)`;
  titleEl.append(nameSpan, ' ', pctSpan);

  const updatedEl = document.getElementById('ficheupdated');
  const ts = state.zoneUpdated[zone.id];
  if (ts) {
    updatedEl.textContent = `Mis à jour le ${formatUpdatedDate(ts)}`;
    updatedEl.hidden = false;
  } else {
    updatedEl.hidden = true;
  }
}

function renderProgressList() {
  const list = document.getElementById('progresslist');
  if (!list) return;
  list.innerHTML = '';
  const zoneId = state.avancementZoneId;
  if (!zoneId) return;

  const ouvrages = getZoneOuvrages(zoneId);
  if (ouvrages.length === 0) return;

  for (const { setup, quantity } of ouvrages) {
    // En-tête de section : nom de l'ouvrage + % de l'ouvrage
    const ouvragePct = getOuvrageProgress(zoneId, setup);
    const header = document.createElement('li');
    header.className = 'progress-section-header' + (ouvragePct >= 100 ? ' is-done' : '');
    header.innerHTML = `
      <span class="progress-section-name"></span>
      <span class="progress-section-pct"></span>
    `;
    header.querySelector('.progress-section-name').textContent = setup.name || '(ouvrage sans nom)';
    header.querySelector('.progress-section-pct').textContent = `${formatPct(ouvragePct)} %`;
    applyOuvrageColor(header, setup);
    list.appendChild(header);

    if (setup.tasks.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'progress-empty';
      empty.textContent = 'Cet ouvrage ne contient aucune tâche.';
      list.appendChild(empty);
      continue;
    }
    for (const task of setup.tasks) {
      list.appendChild(buildProgressItem(zoneId, setup, task, quantity));
    }
  }
}

function buildProgressItem(zoneId, setup, task, quantity) {
  const percent = getProgress(zoneId, task.id);
  const isDone = percent >= 100;
  // Ouvrage compté à la pièce ET quantité connue : on saisit des pièces.
  // Sans quantité (rien de renseigné dans Données → Zones), il n'y a rien à
  // compter — on retombe sur le pourcentage.
  const enPieces = isUnitOuvrage(setup) && quantity > 0;
  const unit = setup.unit || 'm²';
  const pieces = enPieces ? unitsFromPercent(percent, quantity) : 0;

  const li = document.createElement('li');
  applyOuvrageColor(li, setup);
  li.className = 'progress-item' + (isDone ? ' is-done' : '') + (task.excluded ? ' is-excluded' : '')
    + (enPieces ? ' is-pieces' : '');
  li.innerHTML = `
    <div class="progress-info">
      <span class="progress-task-name"></span>
    </div>
    <div class="counter is-percent">
      <button class="counter-btn" data-action="dec">−</button>
      <span class="counter-value"></span>
      <button class="counter-btn" data-action="inc">+</button>
    </div>
    <button class="progress-tick" data-action="tick" aria-label="Marquer terminé">
      <svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
    </button>
  `;
  li.querySelector('.progress-task-name').textContent = task.name || '(tâche sans nom)';
  if (task.excluded) {
    const tag = document.createElement('span');
    tag.className = 'progress-tag';
    tag.textContent = 'hors ratio';
    li.querySelector('.progress-info').appendChild(tag);
  }
  // Récap sous le nom, au même format « réalisé / total » que les heures.
  // Quand le compteur affiche déjà les pièces, cette ligne porte le
  // pourcentage : les deux lectures restent disponibles, sans doublon.
  if (quantity > 0) {
    const meta = document.createElement('span');
    meta.className = 'progress-task-meta';
    const qty = document.createElement('span');
    qty.className = 'progress-task-meta-qty';
    qty.textContent = enPieces
      ? `${formatPct(percent)} % de ${formatQty(quantity)} ${unit}`
      : `${formatQty(quantity * percent / 100)} / ${formatQty(quantity)} ${unit}`;
    meta.appendChild(qty);
    const hours = quantity * (task.ratio || 0);
    if (!task.excluded && hours > 0) {
      // Pas d'arrondi au dixième d'heure ici : 22 m² × 0,3 h/m² à 75 % font
      // 4,95 h, et non 5 h. formatHours conserve la précision utile.
      const hrs = document.createElement('span');
      hrs.className = 'progress-task-meta-hours';
      hrs.textContent = `${formatHours(hours * percent / 100)} / ${formatHours(hours)} h`;
      meta.appendChild(hrs);
    }
    li.querySelector('.progress-info').after(meta);
  }

  const val = li.querySelector('.counter-value');
  const decBtn = li.querySelector('[data-action="dec"]');
  const incBtn = li.querySelector('[data-action="inc"]');
  if (enPieces) {
    val.innerHTML = '';
    val.appendChild(dbEl('strong', 'counter-units-done', String(pieces)));
    val.appendChild(dbEl('span', 'counter-units-total', '/ ' + formatQty(quantity) + ' ' + unit));
    // L'écart entre les deux nombres est un `gap` : il ne se lit ni à la
    // synthèse vocale ni au copier-coller. On donne donc la phrase entière.
    val.setAttribute('aria-label', pieces + ' sur ' + formatQty(quantity) + ' ' + unit + ' réalisées');
    decBtn.setAttribute('aria-label', 'Une pièce de moins');
    incBtn.setAttribute('aria-label', 'Une pièce de plus');
    decBtn.disabled = pieces <= 0;
    incBtn.disabled = pieces >= quantity;
    decBtn.addEventListener('click', () => changeProgressUnits(zoneId, task.id, quantity, -1));
    incBtn.addEventListener('click', () => changeProgressUnits(zoneId, task.id, quantity, +1));
  } else {
    val.textContent = `${percent} %`;
    decBtn.setAttribute('aria-label', '−5 %');
    incBtn.setAttribute('aria-label', '+5 %');
    decBtn.disabled = percent <= 0;
    incBtn.disabled = percent >= 100;
    decBtn.addEventListener('click', () => changeProgress(zoneId, task.id, -5));
    incBtn.addEventListener('click', () => changeProgress(zoneId, task.id, +5));
  }
  const tick = li.querySelector('[data-action="tick"]');
  tick.title = isDone
    ? 'Remettre à zéro'
    : (enPieces ? 'Marquer les ' + formatQty(quantity) + ' ' + unit + ' comme posées' : 'Marquer terminé à 100 %');
  tick.setAttribute('aria-label', tick.title);
  tick.addEventListener('click', () => {
    setProgress(zoneId, task.id, isDone ? 0 : 100);
    renderFicheHeader();
    renderProgressList();
    renderRecap();
  });
  return li;
}


// ================== IMPORT / EXPORT DES ZONES (fichier tableur) ==========
// Une ligne = une zone, décrite par son chemin (Bâtiment / Étage / Zone /
// Sous-zone). Les colonnes suivantes portent la quantité de chaque ouvrage
// pour la zone la plus profonde de la ligne. Format CSV point-virgule, UTF-8
// avec BOM : Excel FR l'ouvre en colonnes sans rien demander.
const ZONE_IO_LEVELS = ['Bâtiment', 'Étage', 'Zone', 'Sous-zone'];
const ZONE_IO_SEP = ';';

// Comparaison de noms tolérante : casse, accents et espaces multiples.
function zoneKeyOf(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// Analyseur CSV complet : guillemets, doublement des guillemets, retours à la
// ligne dans les champs, séparateur détecté sur la ligne d'en-tête.
function parseDelimited(text) {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = (clean.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || '');
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let q = false;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const sep = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ZONE_IO_SEP;
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQ) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === sep) { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  return rows.map(r => r.map(v => v.trim()));
}

// En-tête d'une colonne d'ouvrage : « Bardage métallique (m²) ».
function zoneIoOuvrageHeader(setup) {
  return (setup.name || '(ouvrage sans nom)') + ' (' + (setup.unit || 'm²') + ')';
}
// … et l'opération inverse, tolérante : on retire l'unité entre parenthèses
// puis on compare sur le nom normalisé.
function zoneIoMatchSetup(header) {
  const bare = String(header || '').replace(/\s*\([^)]*\)\s*$/, '');
  const k = zoneKeyOf(bare);
  if (!k) return null;
  return state.taskSetups.find(s => zoneKeyOf(s.name) === k)
    || state.taskSetups.find(s => zoneKeyOf(s.name) === zoneKeyOf(header)) || null;
}

// Lignes décrivant l'arborescence actuelle, dans l'ordre de l'arbre.
function zoneIoCurrentRows() {
  const setups = state.taskSetups;
  const rows = [];
  const walk = (parentId, path) => {
    for (const z of state.zones.filter(x => (x.parentId || null) === parentId)) {
      const p = path.concat([z.name || '']);
      if (p.length <= ZONE_IO_LEVELS.length) {
        const cells = ZONE_IO_LEVELS.map((_, i) => p[i] || '');
        const assigned = state.zoneOuvrages[z.id] || [];
        const qty = setups.map(s => {
          const found = assigned.find(o => o.setupId === s.id);
          return found ? String(found.quantity || 0).replace('.', ',') : '';
        });
        // On n'écrit la ligne que si elle porte des quantités ou si elle est
        // une feuille : sinon l'arbre se relit à travers ses descendants.
        const isLeaf = !state.zones.some(x => x.parentId === z.id);
        if (isLeaf || qty.some(v => v !== '')) rows.push(cells.concat(qty));
      }
      walk(z.id, p);
    }
  };
  walk(null, []);
  return rows;
}

function zoneIoHeaderRow() {
  return ZONE_IO_LEVELS.concat(state.taskSetups.map(zoneIoOuvrageHeader));
}
// Bloc d'aide en tête de fichier. Préfixé par « # » : l'import l'ignore, et
// le fichier reste auto-documenté quand il circule par mail.
function zoneIoInstructions() {
  const setups = state.taskSetups;
  return [
    '# MODÈLE D\'IMPORT DE ZONES — Suivi de chantier',
    '# ------------------------------------------------------------------',
    '# Une ligne = une zone. Les 4 premières colonnes décrivent son chemin :',
    '#   Bâtiment ; Étage ; Zone ; Sous-zone',
    '# Laissez vides les niveaux inutiles : « Bâtiment A ; RDC » crée le',
    '# bâtiment A et son étage RDC, sans descendre plus bas.',
    '# Les niveaux parents sont créés automatiquement s\'ils n\'existent pas.',
    '# Un nom déjà présent au même endroit est réutilisé, jamais dupliqué.',
    '#',
    '# Les colonnes suivantes sont vos ouvrages (Données → Tâches) : indiquez',
    '# la quantité pour la zone la plus profonde de la ligne. Case vide = pas',
    '# d\'affectation. Décimales avec la virgule ou le point.',
    setups.length
      ? '# Ouvrages disponibles : ' + setups.map(s => (s.name || '?') + ' (' + (s.unit || 'm²') + ')').join(' · ')
      : '# ATTENTION : aucun ouvrage paramétré. Créez-les dans Données → Tâches,'
        + ' puis retéléchargez ce modèle pour obtenir leurs colonnes.',
    '#',
    '# Les lignes commençant par # sont ignorées : supprimez le # devant les',
    '# exemples ci-dessous pour vous en servir, ou effacez-les.',
    '# ------------------------------------------------------------------',
  ];
}
function zoneIoExampleRows() {
  const n = state.taskSetups.length;
  const q = (a, b) => Array.from({ length: n }, (_, i) => (i === 0 ? a : (i === 1 ? b : '')));
  return [
    ['# Bâtiment A', 'RDC', '', ''].concat(q('320', '')),
    ['# Bâtiment A', 'R+1', 'Logement 11', ''].concat(q('', '96')),
    ['# Bâtiment A', 'R+1', 'Logement 12', 'Salle de bain'].concat(q('', '12,5')),
    ['# Bâtiment B', 'RDC', '', ''].concat(q('410', '150')),
  ];
}

function buildZoneCsv(rows, withInstructions, withExamples) {
  const lines = [];
  if (withInstructions) lines.push(...zoneIoInstructions());
  lines.push(zoneIoHeaderRow().map(csvEscape).join(ZONE_IO_SEP));
  if (withExamples) for (const r of zoneIoExampleRows()) lines.push(r.map(csvEscape).join(ZONE_IO_SEP));
  for (const r of rows) lines.push(r.map(csvEscape).join(ZONE_IO_SEP));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
function downloadZoneCsv(content, name) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportZoneTemplate() {
  downloadZoneCsv(buildZoneCsv([], true, true), 'modele-zones.csv');
  showToast('Modèle téléchargé — complétez-le puis réimportez-le');
}
function exportZoneTree() {
  const rows = zoneIoCurrentRows();
  if (!rows.length) { showToast('Aucune zone à exporter', 'error'); return; }
  const d = new Date();
  const stamp = String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
  downloadZoneCsv(buildZoneCsv(rows, true, false), 'zones_' + stamp + '.csv');
  showToast(rows.length + ' ligne' + (rows.length > 1 ? 's' : '') + ' exportée' + (rows.length > 1 ? 's' : ''));
}

// ---------------------------------------------------------------- import --
// Analyse SANS rien modifier : on renvoie un plan d'exécution et un rapport,
// que l'utilisateur valide avant application.
function planZoneImport(text) {
  const rows = parseDelimited(text);
  const plan = {
    columns: [], unknownColumns: [], newZones: [], reusedZones: 0,
    assignments: [], updates: 0, errors: [], lines: 0,
  };
  const body = rows.filter(r => r.length && !String(r[0] || '').trim().startsWith('#'));
  if (!body.length) { plan.errors.push('Fichier vide ou entièrement commenté (lignes « # »).'); return plan; }

  // En-tête : les 4 niveaux, puis une colonne par ouvrage.
  const header = body[0];
  const levelKeys = ZONE_IO_LEVELS.map(zoneKeyOf);
  const headOk = header.slice(0, 4).map(zoneKeyOf).every((h, i) => h === levelKeys[i]);
  if (!headOk) {
    plan.errors.push('En-tête inattendu. Les quatre premières colonnes doivent être : '
      + ZONE_IO_LEVELS.join(' ; ') + '. Repartez du modèle téléchargeable.');
    return plan;
  }
  for (let c = 4; c < header.length; c++) {
    const h = header[c];
    if (!h) continue;
    const setup = zoneIoMatchSetup(h);
    if (setup) plan.columns.push({ index: c, setup });
    else plan.unknownColumns.push(h);
  }

  // Arborescence provisoire : les zones existantes, plus celles à créer.
  const childrenOf = (parentId) => state.zones.filter(z => (z.parentId || null) === parentId);
  const pending = [];            // zones à créer, dans l'ordre
  const resolve = (parentId, name) => {
    const k = zoneKeyOf(name);
    const existing = childrenOf(parentId).find(z => zoneKeyOf(z.name) === k);
    if (existing) { plan.reusedZones++; return { id: existing.id, created: false }; }
    const already = pending.find(p => p.parentKey === String(parentId) && zoneKeyOf(p.name) === k);
    if (already) return { id: already.tmpId, created: false };
    const tmpId = '__new_' + pending.length;
    pending.push({ tmpId, parentKey: String(parentId), parentId, name: String(name).trim() });
    plan.newZones.push({ tmpId, name: String(name).trim(), parentId });
    return { id: tmpId, created: true };
  };

  for (let r = 1; r < body.length; r++) {
    const row = body[r];
    const path = ZONE_IO_LEVELS.map((_, i) => String(row[i] || '').trim()).filter(Boolean);
    const rawPath = ZONE_IO_LEVELS.map((_, i) => String(row[i] || '').trim());
    if (!path.length) continue;                       // ligne vide : ignorée
    plan.lines++;
    // Un trou dans le chemin (Bâtiment vide mais Étage rempli) est ambigu.
    const firstEmpty = rawPath.findIndex(v => !v);
    if (firstEmpty !== -1 && rawPath.slice(firstEmpty).some(Boolean)) {
      plan.errors.push('Ligne ' + (r + 1) + ' : chemin incomplet (« '
        + rawPath.map(v => v || '—').join(' › ') + ' »). Remplissez les niveaux de gauche à droite.');
      continue;
    }
    let parentId = null;
    let zoneId = null;
    for (const name of path) {
      const res = resolve(parentId, name);
      zoneId = res.id;
      parentId = res.id;
    }
    for (const col of plan.columns) {
      const raw = String(row[col.index] || '').trim();
      if (!raw) continue;
      const n = parseFloat(raw.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        plan.errors.push('Ligne ' + (r + 1) + ', colonne « ' + col.setup.name + ' » : « ' + raw + ' » n\'est pas une quantité valide.');
        continue;
      }
      plan.assignments.push({ zoneId, setupId: col.setup.id, quantity: n, path: path.join(' › '), setupName: col.setup.name });
    }
  }
  plan.pending = pending;
  // Compte des affectations qui écrasent une valeur existante.
  for (const a of plan.assignments) {
    if (String(a.zoneId).startsWith('__new_')) continue;
    const cur = (state.zoneOuvrages[a.zoneId] || []).find(o => o.setupId === a.setupId);
    if (cur && (cur.quantity || 0) !== a.quantity) plan.updates++;
  }
  return plan;
}

// Application du plan : création des zones puis affectation des quantités.
function applyZoneImport(plan) {
  const idMap = {};
  for (const p of plan.pending) {
    const parent = p.parentId && String(p.parentId).startsWith('__new_') ? idMap[p.parentId] : p.parentId;
    const zone = { id: uid(), name: p.name, parentId: parent || null };
    state.zones.push(zone);
    idMap[p.tmpId] = zone.id;
    if (zone.parentId) delete state.zoneCollapsed[zone.parentId];
  }
  let assigned = 0;
  for (const a of plan.assignments) {
    const zid = String(a.zoneId).startsWith('__new_') ? idMap[a.zoneId] : a.zoneId;
    if (!zid || !state.zones.some(z => z.id === zid)) continue;
    if (!state.zoneOuvrages[zid]) state.zoneOuvrages[zid] = [];
    const list = state.zoneOuvrages[zid];
    const found = list.find(o => o.setupId === a.setupId);
    if (found) found.quantity = a.quantity;
    else list.push({ setupId: a.setupId, quantity: a.quantity });
    assigned++;
  }
  save();
  renderZones();
  renderAvancement();
  renderZonePlanning();
  return { zones: plan.pending.length, assigned };
}

// ------------------------------------------------------- rapport & modale --
let _zoneImportPlan = null;
function openZoneImportModal(plan, fileName) {
  const overlay = document.getElementById('zoneimportmodal');
  const body = document.getElementById('zoneimportbody');
  const confirm = document.getElementById('zoneimportconfirm');
  if (!overlay || !body) return;
  _zoneImportPlan = plan;
  body.innerHTML = '';
  body.appendChild(dbEl('p', 'zone-import-file', fileName));

  const blocking = plan.errors.length > 0 && plan.newZones.length === 0 && plan.assignments.length === 0;
  const stats = dbEl('div', 'zone-import-stats');
  const stat = (n, label, cls) => {
    const s = dbEl('div', 'zone-import-stat' + (cls ? ' ' + cls : ''));
    s.appendChild(dbEl('span', 'zone-import-stat-n', String(n)));
    s.appendChild(dbEl('span', 'zone-import-stat-label', label));
    stats.appendChild(s);
  };
  stat(plan.lines, 'ligne' + (plan.lines > 1 ? 's' : '') + ' lue' + (plan.lines > 1 ? 's' : ''));
  stat(plan.newZones.length, 'zone' + (plan.newZones.length > 1 ? 's' : '') + ' créée' + (plan.newZones.length > 1 ? 's' : ''), 'is-ok');
  stat(plan.reusedZones, 'réutilisée' + (plan.reusedZones > 1 ? 's' : ''));
  stat(plan.assignments.length, 'quantité' + (plan.assignments.length > 1 ? 's' : '') + ' affectée' + (plan.assignments.length > 1 ? 's' : ''), 'is-ok');
  if (plan.updates) stat(plan.updates, 'écrasée' + (plan.updates > 1 ? 's' : ''), 'is-warn');
  if (plan.errors.length) stat(plan.errors.length, 'erreur' + (plan.errors.length > 1 ? 's' : ''), 'is-err');
  body.appendChild(stats);

  if (plan.columns.length) {
    body.appendChild(dbEl('p', 'zone-import-note',
      'Ouvrages reconnus : ' + plan.columns.map(c => c.setup.name).join(', ') + '.'));
  }
  if (plan.unknownColumns.length) {
    body.appendChild(dbEl('p', 'zone-import-note is-warn',
      'Colonnes ignorées (aucun ouvrage de ce nom dans Données → Tâches) : '
      + plan.unknownColumns.join(', ') + '.'));
  }
  if (plan.newZones.length) {
    const list = dbEl('ul', 'zone-import-list');
    for (const z of plan.newZones.slice(0, 12)) list.appendChild(dbEl('li', null, z.name));
    if (plan.newZones.length > 12) list.appendChild(dbEl('li', 'is-more', '… et ' + (plan.newZones.length - 12) + ' autres'));
    body.appendChild(dbEl('p', 'zone-import-note', 'Zones qui seront créées :'));
    body.appendChild(list);
  }
  if (plan.errors.length) {
    const list = dbEl('ul', 'zone-import-list is-err');
    for (const e of plan.errors.slice(0, 12)) list.appendChild(dbEl('li', null, e));
    if (plan.errors.length > 12) list.appendChild(dbEl('li', 'is-more', '… et ' + (plan.errors.length - 12) + ' autres'));
    body.appendChild(dbEl('p', 'zone-import-note is-warn', 'Lignes non importées :'));
    body.appendChild(list);
  }
  if (!blocking && !plan.newZones.length && !plan.assignments.length) {
    body.appendChild(dbEl('p', 'zone-import-note', 'Rien à importer : le fichier ne contient aucune zone nouvelle ni quantité.'));
  }
  confirm.disabled = blocking || (!plan.newZones.length && !plan.assignments.length);
  overlay.hidden = false;
}
function closeZoneImportModal() {
  const overlay = document.getElementById('zoneimportmodal');
  if (overlay) overlay.hidden = true;
  _zoneImportPlan = null;
  const input = document.getElementById('zoneimportinput');
  if (input) input.value = '';       // réimporter le même fichier reste possible
}
function confirmZoneImport() {
  if (!_zoneImportPlan) return;
  const res = applyZoneImport(_zoneImportPlan);
  closeZoneImportModal();
  showToast(res.zones + ' zone' + (res.zones > 1 ? 's' : '') + ' créée' + (res.zones > 1 ? 's' : '')
    + ' · ' + res.assigned + ' affectation' + (res.assigned > 1 ? 's' : ''));
}
function handleZoneImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      openZoneImportModal(planZoneImport(String(reader.result || '')), file.name);
    } catch (e) {
      console.warn('[Zones] import KO', e);
      showToast('Fichier illisible : vérifiez qu\'il s\'agit bien d\'un CSV', 'error');
    }
  };
  reader.onerror = () => showToast('Lecture du fichier impossible', 'error');
  reader.readAsText(file, 'UTF-8');
}

// ---------- Avancement → Récapitulatif (par bâtiment) ----------
// Bâtiment = zone racine (parentId === null).
function getBuildings() {
  return state.zones.filter(z => z.parentId === null);
}
// Toutes les zones descendantes (bâtiment inclus)
function getDescendantZones(rootId) {
  const out = [];
  const walk = (pid) => {
    out.push(pid);
    for (const z of state.zones) if (z.parentId === pid) walk(z.id);
  };
  walk(rootId);
  return out;
}


// Formate une quantité physique (m², ml, u…) avec séparation FR et
// précision décroissante par paliers. 2 décimales sous 100 garantit que
// la somme des contributions par tâche tombe précisément sur le total
// affiché en haut du récap (sinon 13,695 → « 13,7 » crée un écart visible).
function formatQty(n) {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  const decimals = abs >= 1000 ? 0 : (abs >= 100 ? 1 : 2);
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

// ========================================================================
// AVANCEMENT → RÉCAPITULATIF : le tableau de bord du projet
//
// Un modèle d'agrégation unique alimente toutes les vues. La brique
// élémentaire est le triplet (zone, ouvrage, tâche) :
//     heures budgétées  h     = quantité de la zone × ratio de la tâche (h/unité)
//     heures acquises   hDone = h × avancement de la tâche
// Les heures sont le seul dénominateur commun entre des ouvrages exprimés
// en m², ml ou u : c'est la valeur acquise du projet, et c'est déjà la
// règle appliquée dans getZoneProgress / getOuvrageAllocatedHours.
// Repli documenté si aucun ratio n'est saisi : pondération par les
// quantités, puis à défaut par le nombre de tâches. Le mode retenu est
// exposé et affiché — un chiffre présenté en réunion doit être opposable.
// ========================================================================
const AVANCEMENT_STALE_DAYS = 21;   // seuil « sans mise à jour »

function computeAvancementModel(buildingId) {
  const buildings = getBuildings();
  const inScope = buildingId ? buildings.filter(b => b.id === buildingId) : buildings;

  // Choix du mode de pondération, une fois pour tout le projet (et non par
  // bâtiment) : le % doit rester comparable d'un bâtiment à l'autre.
  let ratioSum = 0, qtySum = 0;
  for (const s of state.taskSetups) for (const t of (s.tasks || [])) if (!t.excluded) ratioSum += (t.ratio || 0);
  for (const zid of Object.keys(state.zoneOuvrages || {})) {
    for (const o of (state.zoneOuvrages[zid] || [])) qtySum += (o.quantity || 0);
  }
  const weighting = ratioSum > 0 ? 'heures' : (qtySum > 0 ? 'quantites' : 'taches');
  const taskWeight = (task, qty) => {
    if (task.excluded) return 0;
    if (weighting === 'heures') return (qty || 0) * (task.ratio || 0);
    if (weighting === 'quantites') return (qty || 0);
    return 1;
  };

  const model = {
    weighting, scopeId: buildingId || '',
    hBudget: 0, hDone: 0, pct: 0,
    buildings: [], ouvrages: [], matrix: {}, zones: [],
    counts: { zones: 0, zonesDone: 0, zonesToStart: 0, ouvrages: 0, taches: 0 },
    issues: { noRatio: [], noQty: [], stale: [] },
  };

  const ouvrageById = new Map();   // agrégat par ouvrage sur le périmètre
  const now = Date.now();

  for (const b of inScope) {
    const bAgg = { id: b.id, name: b.name || '(bâtiment)', hBudget: 0, hDone: 0, pct: 0, zones: 0 };
    model.matrix[b.id] = {};
    for (const zid of getDescendantZones(b.id)) {
      const ouvrages = getZoneOuvrages(zid);
      if (!ouvrages.length) continue;
      model.counts.zones++;
      bAgg.zones++;
      let zH = 0, zD = 0;
      for (const o of ouvrages) {
        const setup = o.setup;
        const qty = o.quantity || 0;
        if (!(qty > 0)) model.issues.noQty.push({ zoneId: zid, setupName: setup.name || '(ouvrage)' });

        let agg = ouvrageById.get(setup.id);
        if (!agg) {
          agg = {
            setupId: setup.id, name: setup.name || '(ouvrage sans nom)',
            unit: setup.unit || 'm²', setup,
            qtyTotal: 0, hBudget: 0, hDone: 0, pct: 0, weight: 0, zones: 0,
            tasks: new Map(),
          };
          ouvrageById.set(setup.id, agg);
        }
        agg.qtyTotal += qty;
        agg.zones++;

        const cell = model.matrix[b.id][setup.id] || (model.matrix[b.id][setup.id] = { h: 0, d: 0, qty: 0 });
        cell.qty += qty;

        for (const task of (setup.tasks || [])) {
          const p = getProgress(zid, task.id);
          const w = taskWeight(task, qty);
          let tAgg = agg.tasks.get(task.id);
          if (!tAgg) {
            tAgg = { id: task.id, name: task.name || '(tâche sans nom)', ratio: task.ratio || 0,
                     excluded: !!task.excluded, num: 0, den: 0, sum: 0, count: 0, hBudget: 0, hDone: 0 };
            agg.tasks.set(task.id, tAgg);
          }
          tAgg.num += p * qty;
          tAgg.den += qty;
          tAgg.sum += p;
          tAgg.count += 1;
          tAgg.hBudget += w;
          tAgg.hDone += w * p / 100;
          agg.hBudget += w;
          agg.hDone += w * p / 100;
          bAgg.hBudget += w;
          bAgg.hDone += w * p / 100;
          cell.h += w;
          cell.d += w * p / 100;
          zH += w;
          zD += w * p / 100;
        }
      }
      const zPct = zH > 0 ? (zD / zH) * 100 : getZoneProgress(zid);
      if (zPct >= 99.95) model.counts.zonesDone++;
      else if (zPct <= 0.05) model.counts.zonesToStart++;
      const updatedAt = state.zoneUpdated[zid] || 0;
      model.zones.push({
        id: zid, label: travauxZoneLabel(zid), buildingId: b.id,
        hBudget: zH, hDone: zD, pct: zPct, updatedAt,
      });
      const days = updatedAt ? Math.floor((now - updatedAt) / 86400000) : null;
      if (zPct > 0.05 && zPct < 99.95 && (days === null || days >= AVANCEMENT_STALE_DAYS)) {
        model.issues.stale.push({ zoneId: zid, label: travauxZoneLabel(zid), days, pct: zPct });
      }
    }
    bAgg.pct = bAgg.hBudget > 0 ? (bAgg.hDone / bAgg.hBudget) * 100 : 0;
    model.hBudget += bAgg.hBudget;
    model.hDone += bAgg.hDone;
    model.buildings.push(bAgg);
  }
  model.pct = model.hBudget > 0 ? (model.hDone / model.hBudget) * 100 : 0;

  // Mise en forme des ouvrages : quantités réalisées et poids relatif.
  for (const agg of ouvrageById.values()) {
    const tasks = Array.from(agg.tasks.values());
    const active = tasks.filter(t => !t.excluded);
    const totalRatio = active.reduce((s, t) => s + t.ratio, 0);
    const normWeight = (t) => {
      if (t.excluded) return 0;
      if (totalRatio > 0) return t.ratio / totalRatio;
      return active.length ? 1 / active.length : 0;
    };
    let qtyDone = 0;
    for (const t of tasks) {
      t.pct = t.den > 0 ? t.num / t.den : (t.count > 0 ? t.sum / t.count : 0);
      t.share = normWeight(t);
      // Quantités par tâche, au sens du récapitulatif par tâche de référence :
      // une tâche porte sur la TOTALITÉ de la quantité de l'ouvrage sur le
      // périmètre (« quantité totale » = Σ des quantités des zones), et sa
      // quantité réalisée est la somme zone par zone de quantité × avancement.
      // Aucune pondération par le ratio n'intervient ici : le ratio ne sert
      // qu'à convertir des quantités en heures. Deux tâches d'un même ouvrage
      // affichent donc la même quantité totale — c'est voulu, elles décrivent
      // le même mètre carré vu sous deux angles.
      t.qtyTotal = t.den;
      t.qtyDone = t.num / 100;
      t.qtyRemaining = Math.max(0, t.qtyTotal - t.qtyDone);
      t.hRemaining = Math.max(0, t.hBudget - t.hDone);
      // L'ouvrage, lui, cumule des quantités « équivalentes » : la part de
      // chaque tâche dans l'ouvrage (share) ramène ces quantités qui se
      // recouvrent à un total comparable à la quantité posée.
      qtyDone += t.share * t.qtyDone;
    }
    // Ordre des tâches = celui de l'ouvrage dans Données → Tâches (la Map
    // conserve l'ordre d'insertion), c'est-à-dire l'ordre d'exécution sur le
    // chantier : traçage, ossature, plaquage… On ne trie pas par poids, le
    // récapitulatif par tâche se lit comme un mode opératoire.
    agg.tasks = tasks;
    agg.qtyDone = Math.min(qtyDone, agg.qtyTotal);
    agg.qtyRemaining = Math.max(0, agg.qtyTotal - agg.qtyDone);
    agg.pct = agg.hBudget > 0 ? (agg.hDone / agg.hBudget) * 100
      : (agg.qtyTotal > 0 ? (agg.qtyDone / agg.qtyTotal) * 100 : 0);
    if (weighting === 'heures' && agg.hBudget <= 0) {
      model.issues.noRatio.push({ setupId: agg.setupId, name: agg.name });
    }
    model.counts.taches += agg.tasks.length;
    model.ouvrages.push(agg);
  }
  model.counts.ouvrages = model.ouvrages.length;
  for (const o of model.ouvrages) o.weight = model.hBudget > 0 ? (o.hBudget / model.hBudget) * 100 : 0;
  model.ouvrages.sort((a, b) => b.hBudget - a.hBudget || b.qtyTotal - a.qtyTotal);
  model.zones.sort((a, b) => a.pct - b.pct || b.hBudget - a.hBudget);
  model.issues.stale.sort((a, b) => (b.days == null ? 1e9 : b.days) - (a.days == null ? 1e9 : a.days));
  return model;
}

// Dates de planning applicables à un périmètre : celles de la zone racine
// si elles sont renseignées, sinon celles du chantier. Une zone sans dates
// propres reste donc lue sur la période globale.
function getZoneDates(zoneId) {
  const d = (state.zoneDates || {})[zoneId];
  if (d && d.start && d.end) return { start: d.start, end: d.end, own: true };
  return { start: state.projectStart, end: state.projectEnd, own: false };
}
function setZoneDate(zoneId, field, value) {
  if (!state.zoneDates || typeof state.zoneDates !== 'object') state.zoneDates = {};
  const d = state.zoneDates[zoneId] || (state.zoneDates[zoneId] = { start: '', end: '' });
  d[field] = value || '';
  // La couleur de la barre survit à un effacement des dates : on ne purge
  // l'entrée que lorsqu'il n'y reste plus rien du tout.
  if (!d.start && !d.end && !d.color) delete state.zoneDates[zoneId];
  save();
  renderZonePlanning();
  renderRecap();
}
// Écriture groupée (fin de glissé-déposé, validation de la modale) : une
// seule sauvegarde et un seul rendu pour l'ensemble des champs modifiés.
function setZonePlanning(zoneId, patch) {
  if (!state.zoneDates || typeof state.zoneDates !== 'object') state.zoneDates = {};
  const d = state.zoneDates[zoneId] || (state.zoneDates[zoneId] = { start: '', end: '' });
  Object.assign(d, patch);
  if (!d.start && !d.end && !d.color) delete state.zoneDates[zoneId];
  save();
  renderZonePlanning();
  renderRecap();
}

// ---------- Planning : avancement attendu au regard du calendrier ----------
function computeAvancementPlanning(pctReel, scope) {
  const dates = scope ? getZoneDates(scope) : { start: state.projectStart, end: state.projectEnd, own: false };
  const s = dates.start, e = dates.end;
  if (!s || !e) return null;
  const d0 = new Date(s + 'T00:00:00'), d1 = new Date(e + 'T00:00:00');
  const now = new Date(todayISO() + 'T00:00:00');
  if (!isFinite(d0.getTime()) || !isFinite(d1.getTime()) || d1 <= d0) return null;
  const day = 86400000;
  const totalDays = Math.round((d1 - d0) / day);
  const elapsed = Math.max(0, Math.min(totalDays, Math.round((now - d0) / day)));
  const pctTemps = (elapsed / totalDays) * 100;
  // Décompte en jours ouvrés : c'est la base des deux rythmes (à tenir et
  // observé). Un chantier ne produit pas le week-end ni les jours fériés.
  const overdue = now > d1;
  const todayIso = todayISO();
  return {
    start: s, end: e, ownDates: !!dates.own, totalDays, elapsed,
    remainingDays: Math.max(0, Math.round((d1 - now) / day)),
    totalWorkDays: countWorkingDays(s, e),
    remainingWorkDays: overdue ? 0 : countWorkingDays(todayIso > s ? todayIso : s, e),
    overdue,
    pctTemps,
    ecart: pctReel - pctTemps,
  };
}

// ---------- Historique : la courbe se construit jour après jour ----------
// Un point par jour ({ pct, hDone, hBudget }) : dictionnaire indexé par
// date, donc fusionné par union à la synchro — aucun point ne se perd.
let _avancementStampAt = 0;
function stampAvancementHistory(force) {
  if (!state.avancementHistory || typeof state.avancementHistory !== 'object') state.avancementHistory = {};
  const now = Date.now();
  if (!force && now - _avancementStampAt < 3000) return;
  _avancementStampAt = now;
  const m = computeAvancementModel('');
  if (m.hBudget <= 0 && m.pct <= 0) return;
  const key = todayISO();
  const prev = state.avancementHistory[key];
  const zones = {};
  for (const b of m.buildings) if (b.hBudget > 0) zones[b.id] = Math.round(b.pct * 100) / 100;
  // Détail du jour : avancement par zone porteuse et heures acquises par
  // ouvrage puis par tâche. C'est ce qui permet la colonne « variation sur
  // 7 / 30 jours » du récapitulatif. Purgé au-delà de 120 jours (cf.
  // pruneAvancementHistoryDetail) : au-delà, seule la courbe reste utile.
  const det = { z: {}, o: {} };
  for (const z of m.zones) if (z.hBudget > 0) det.z[z.id] = Math.round(z.pct * 100) / 100;
  for (const o of m.ouvrages) {
    if (!(o.hBudget > 0)) continue;
    const t = {};
    for (const tk of o.tasks) if (tk.hBudget > 0) t[tk.id] = Math.round(tk.hDone * 10) / 10;
    det.o[o.setupId] = { d: Math.round(o.hDone * 10) / 10, b: Math.round(o.hBudget * 10) / 10, t };
  }
  const next = {
    pct: Math.round(m.pct * 100) / 100,
    hDone: Math.round(m.hDone * 10) / 10,
    hBudget: Math.round(m.hBudget * 10) / 10,
    zones, det,
  };
  if (prev && prev.pct === next.pct && prev.hBudget === next.hBudget
      && _jsonEq(prev.zones || {}, zones) && _jsonEq(prev.det || {}, det)) return;
  state.avancementHistory[key] = next;
  pruneAvancementHistoryDetail();
  save();
}
// Le détail par zone / ouvrage / tâche pèse bien plus lourd que le point de
// courbe : on ne le garde que sur une fenêtre glissante. Les points anciens
// conservent pct / hDone / hBudget / zones, donc la courbe reste entière.
const AVANCEMENT_DETAIL_DAYS = 120;
function pruneAvancementHistoryDetail() {
  const h = state.avancementHistory || {};
  const limit = dayToISO(isoToDay(todayISO()) - AVANCEMENT_DETAIL_DAYS);
  for (const k of Object.keys(h)) {
    if (k < limit && h[k] && h[k].det) delete h[k].det;
  }
}
// Point d'historique le plus récent antérieur ou égal à une date donnée, et
// qui porte le détail. Renvoie null si l'historique ne remonte pas si loin.
function getAvancementDetailAt(dateISO) {
  const h = state.avancementHistory || {};
  let withDet = null, any = null;
  for (const k of Object.keys(h).sort()) {
    if (k > dateISO) break;
    if (!h[k]) continue;
    any = { date: k, pct: h[k].pct, zones: h[k].zones || {} };
    if (h[k].det) withDet = { date: k, det: h[k].det };
  }
  return { withDet, any };
}
// Périodes de comparaison proposées dans le récapitulatif.
const RECAP_PERIODS = [
  { key: '7',   label: '7 j',  days: 7 },
  { key: '30',  label: '30 j', days: 30 },
  { key: 'all', label: 'Depuis le début', days: null },
];
function getRecapPeriod() {
  return RECAP_PERIODS.find(p => p.key === state.recapPeriod) || RECAP_PERIODS[0];
}
// Référence de comparaison : le détail d'il y a N jours, ou « tout à zéro »
// pour la période « depuis le début » (le chantier a commencé à 0 %).
function getRecapBaseline() {
  const period = getRecapPeriod();
  if (period.days == null) return { period, zero: true, date: null, det: null, zones: null };
  const target = dayToISO(isoToDay(todayISO()) - period.days);
  const found = getAvancementDetailAt(target);
  return {
    period, zero: false,
    date: (found.withDet || found.any || {}).date || null,
    det: found.withDet ? found.withDet.det : null,
    // Les % par bâtiment survivent à la purge du détail : on s'en sert en
    // repli quand seule la ligne « bâtiment » est demandée.
    zones: found.any ? found.any.zones : null,
  };
}
// Série d'historique du périmètre : le global, ou l'avancement du bâtiment
// si un bâtiment est sélectionné. Les points antérieurs à l'enregistrement
// par zone sont simplement absents de la série du bâtiment.
function getAvancementSeries(scope) {
  const h = state.avancementHistory || {};
  const out = [];
  for (const k of Object.keys(h).sort()) {
    const p = scope ? (h[k].zones || {})[scope] : h[k].pct;
    if (typeof p === 'number') out.push({ date: k, pct: p });
  }
  return out;
}

// Vitesse d'avancement observée et date de fin projetée. La période
// d'observation court du PREMIER relevé d'avancement au dernier : sur un
// chantier, le rythme utile est celui tenu depuis le démarrage, pas celui
// d'une fenêtre glissante arbitraire — laquelle, sur un historique jeune,
// ne portait d'ailleurs que sur quelques jours. Tout est compté en JOURS
// OUVRÉS (lundi-vendredi hors fériés) : une semaine vaut 5 jours.
function computeAvancementVelocity(scope) {
  const serie = getAvancementSeries(scope);
  if (serie.length < 2) return null;
  const last = serie[serie.length - 1];
  const lastD = new Date(last.date + 'T00:00:00');
  const first = serie[0];
  const days = (lastD - new Date(first.date + 'T00:00:00')) / 86400000;
  if (days <= 0) return null;
  // Fenêtre comptée en jours ouvrés : deux points séparés par un week-end
  // n'ont pas produit d'avancement pendant deux jours, les compter
  // écraserait artificiellement le rythme. La semaine vaut 5 jours ouvrés.
  const workDays = countWorkingDays(first.date, last.date);
  if (workDays <= 0) return null;
  const perDay = (last.pct - first.pct) / workDays;
  const out = {
    perDay, perWeek: perDay * 5,
    windowDays: Math.round(days), windowWorkDays: workDays,
    fromISO: first.date, toISO: last.date,
    fromPct: first.pct, toPct: last.pct,
    etaISO: null, etaDays: null,
  };
  if (perDay > 0.001 && last.pct < 99.95) {
    const etaDays = Math.ceil((100 - last.pct) / perDay);   // en jours ouvrés
    if (etaDays < 2600) {
      out.etaDays = etaDays;
      out.etaISO = addWorkingDays(last.date, etaDays);
    }
  }
  return out;
}

// Date obtenue en avançant de n jours ouvrés à partir d'une date donnée
// (celle-ci non comptée). Sert à projeter une fin de chantier au rythme
// observé sans compter les week-ends ni les jours fériés.
function addWorkingDays(fromISO, n) {
  let d = isoToDay(fromISO);
  let left = Math.max(0, Math.round(n));
  let guard = 0;
  while (left > 0 && guard++ < 20000) {
    d += 1;
    const dow = dayOfWeek(d);
    if (dow === 0 || dow === 6) continue;
    if (frenchHolidayDays(new Date(d * 86400000).getUTCFullYear()).has(d)) continue;
    left--;
  }
  return dayToISO(d);
}

// Rythme À TENIR pour finir à la date objectif — à ne pas confondre avec le
// rythme OBSERVÉ de computeAvancementVelocity, qui extrapole le passé :
//   (100 % − avancement actuel) ÷ temps restant jusqu'à la date de fin.
// C'est cette droite que trace la courbe de projection du récapitulatif.
function computeAvancementTarget(pct, planning) {
  if (!planning) return null;
  const remaining = Math.max(0, 100 - pct);
  const days = planning.remainingDays;
  const workDays = Number(planning.remainingWorkDays) || 0;
  const out = {
    remaining, days, workDays, end: planning.end,
    overdue: !!planning.overdue,
    done: remaining <= 0.05,
    perDay: null, perWeek: null,
  };
  if (out.done) { out.perDay = 0; out.perWeek = 0; return out; }
  // Dernier jour : le rythme hebdomadaire n'a plus de sens, on annonce le
  // reste à faire. Au-delà de l'échéance, idem — mais le message diffère.
  out.lastDay = !out.overdue && days === 0;
  // Compté en jours ouvrés : la semaine de production vaut 5 jours. Une
  // échéance qui ne tombe que sur des week-ends ne laisse aucun jour ouvré.
  if (out.overdue || workDays <= 0) return out;
  out.perDay = remaining / workDays;
  out.perWeek = out.perDay * 5;
  return out;
}

// ---------- Petits utilitaires d'affichage ----------
// Teinte d'une cellule de matrice : couleur de la bande d'avancement,
// opacité proportionnelle au %. Le texte reste crème et lisible partout.
const DB_CELL_RGB = { 'is-done': '63,206,142', 'is-good': '242,105,30', 'is-going': '242,169,59' };
function dbCellTint(pct) {
  const rgb = DB_CELL_RGB[dbPctClass(pct)];
  if (!rgb) return 'var(--surface-2)';
  const a = 0.16 + 0.52 * Math.max(0, Math.min(100, pct)) / 100;
  return 'rgba(' + rgb + ',' + a.toFixed(2) + ')';
}
function dbPctClass(pct) {
  if (pct >= 99.95) return 'is-done';
  if (pct >= 50) return 'is-good';
  if (pct > 0) return 'is-going';
  return 'is-idle';
}
function formatHours(n) {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  const dec = abs >= 100 ? 0 : (abs >= 10 ? 1 : 2);
  return n.toLocaleString('fr-FR', { maximumFractionDigits: dec });
}
function dbEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
function dbCard(title, hint) {
  const card = dbEl('section', 'db-card');
  const head = dbEl('div', 'db-card-head');
  head.appendChild(dbEl('h3', 'db-card-title', title));
  if (hint) head.appendChild(dbEl('span', 'db-card-hint', hint));
  card.appendChild(head);
  return card;
}
function dbBar(pct, cls) {
  const wrap = dbEl('div', 'db-bar' + (cls ? ' ' + cls : ''));
  const fill = dbEl('div', 'db-bar-fill ' + dbPctClass(pct));
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  wrap.appendChild(fill);
  return wrap;
}

// ====================================================================
//   Export PDF de la synthèse d'avancement (Avancement → Récapitulatif)
//   Reprend la charte de l'export CR : A4 portrait, en-tête centré,
//   rubriques numérotées à bandeau orange, pied de page daté et paginé.
//   Le document reprend le tableau de bord de l'écran, dans l'ordre :
//   indicateurs, courbe, bâtiments, ouvrages et tâches, points d'attention.
// ====================================================================
async function exportAvancementToPDF(scope, label) {
  let jspdf;
  try {
    showToast('Génération du PDF…');
    jspdf = await loadJsPdf();
  } catch (e) {
    showToast('Impossible de charger jsPDF (connexion requise au 1er usage)', 'error');
    return;
  }
  const model = computeAvancementModel(scope);
  const planning = computeAvancementPlanning(model.pct, scope);
  const velocity = computeAvancementVelocity(scope);
  const unit = model.weighting === 'heures' ? ' h' : '';

  const pdf = hardenPdfText(new jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }));
  const PAGE_W = 210, PAGE_H = 297;
  const MARGIN = 18;
  const CONTENT_W = PAGE_W - 2 * MARGIN;
  const ORANGE = [237, 108, 2];
  const GREY_H = [232, 232, 232];
  const ALT = [248, 248, 248];
  const GREEN = [46, 125, 50], AMBER = [237, 108, 2], RED = [211, 47, 47], BLUE = [29, 127, 184];
  let y = MARGIN;
  let pageNum = 1;

  const addFooter = () => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120);
    const d = new Date();
    const stamp = `Édité le ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ` +
                  `à ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    pdf.text(stamp, MARGIN, PAGE_H - 10);
    pdf.text(`Page ${pageNum}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' });
    pdf.setTextColor(0);
  };
  const ensureSpace = (h) => {
    if (y + h > PAGE_H - 18) { addFooter(); pdf.addPage(); pageNum++; y = MARGIN; }
  };
  let secNum = 0;
  const banner = (title) => {
    secNum++;
    ensureSpace(16);
    pdf.setFillColor(...ORANGE);
    pdf.rect(MARGIN, y, CONTENT_W, 7.5, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(255);
    pdf.text(`${secNum}.  ${title}`, MARGIN + 4, y + 5.3);
    pdf.setTextColor(0);
    y += 13;
  };
  // Barre empilée réalisée / en cours / à faire — ici une simple jauge
  // d'avancement (réalisé vs reste), la granularité du tableau de bord.
  const gauge = (pct, x, w, h) => {
    pdf.setFillColor(224, 224, 224);
    pdf.rect(x, y, w, h, 'F');
    const p = Math.max(0, Math.min(100, pct));
    if (p > 0) {
      pdf.setFillColor(...(p >= 99.95 ? GREEN : (p >= 50 ? AMBER : RED)));
      pdf.rect(x, y, w * (p / 100), h, 'F');
    }
  };

  // ----- En-tête -----
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16);
  pdf.text('SYNTHÈSE D\'AVANCEMENT', PAGE_W / 2, y, { align: 'center' });
  y += 8;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
  pdf.text(label || 'Tout le projet', PAGE_W / 2, y, { align: 'center' });
  y += 5;
  const d0 = new Date();
  pdf.setFontSize(9); pdf.setTextColor(100);
  pdf.text(`Édité le ${String(d0.getDate()).padStart(2,'0')}/${String(d0.getMonth()+1).padStart(2,'0')}/${d0.getFullYear()}`,
    PAGE_W / 2, y, { align: 'center' });
  pdf.setTextColor(0);
  y += 6;
  pdf.setDrawColor(60); pdf.setLineWidth(0.4);
  pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // ----- 1. Indicateurs clés -----
  banner('INDICATEURS CLÉS');
  {
    const cards = [
      {
        label: 'AVANCEMENT GLOBAL',
        value: formatPct(Math.round(model.pct * 10) / 10) + ' %',
        color: ORANGE,
        sub: model.weighting === 'heures' ? 'pondéré par les heures budgétées'
          : (model.weighting === 'quantites' ? 'pondéré par les quantités' : 'moyenne des tâches'),
        pct: model.pct
      },
      planning ? {
        label: 'ÉCART AU PLANNING',
        value: (planning.ecart >= 0 ? '+' : '-') + formatPct(Math.abs(Math.round(planning.ecart * 10) / 10)) + ' %',
        color: planning.ecart >= 0 ? GREEN : RED,
        sub: (planning.ecart >= 0 ? 'En avance' : 'En retard') + ' — attendu ' + formatPct(Math.round(planning.pctTemps * 10) / 10) + ' %'
      } : { label: 'ÉCART AU PLANNING', value: '—', color: [140,140,140], sub: 'dates de chantier non renseignées' },
      {
        label: model.weighting === 'heures' ? 'HEURES DE MAIN-D\'ŒUVRE' : 'CHARGE PONDÉRÉE',
        value: formatHours(model.hDone) + unit + ' de droit à dépenser',
        color: [40, 40, 40],
        sub: 'sur ' + formatHours(model.hBudget) + unit + ' budgétées — reste ' + formatHours(Math.max(0, model.hBudget - model.hDone)) + unit
      },
      planning ? {
        label: 'CALENDRIER',
        value: planning.remainingDays + ' j',
        color: BLUE,
        sub: 'fin le ' + fmtFR(planning.end) + ' — ' + planning.elapsed + '/' + planning.totalDays + ' j écoulés'
      } : { label: 'CALENDRIER', value: '—', color: [140,140,140], sub: 'dates de chantier non renseignées' },
    ];
    const gap = 3;
    const cw = (CONTENT_W - gap * 3) / 4;
    const ch = 26;
    ensureSpace(ch + 4);
    const top = y;
    cards.forEach((c, i) => {
      const x = MARGIN + i * (cw + gap);
      pdf.setFillColor(250, 249, 247); pdf.setDrawColor(210); pdf.setLineWidth(0.2);
      pdf.rect(x, top, cw, ch, 'FD');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(120);
      pdf.text(pdf.splitTextToSize(c.label, cw - 5)[0], x + 2.5, top + 5);
      pdf.setFontSize(15); pdf.setTextColor(...c.color);
      pdf.text(c.value, x + 2.5, top + 13);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(110);
      const lines = pdf.splitTextToSize(c.sub, cw - 5).slice(0, 2);
      lines.forEach((ln, j) => pdf.text(ln, x + 2.5, top + 18.5 + j * 3));
      pdf.setTextColor(0);
    });
    y = top + ch + 3;
    // Jauge pleine largeur sous les cartes
    ensureSpace(6);
    gauge(model.pct, MARGIN, CONTENT_W, 3);
    y += 6;
    const target = computeAvancementTarget(model.pct, planning);
    if (target && !target.done && target.perWeek != null) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...GREEN);
      pdf.text('Rythme à tenir : ' + formatPct(Math.round(target.perWeek * 10) / 10)
        + ' %/semaine pour finir le ' + fmtFR(target.end)
        + ' (' + formatPct(Math.round(target.remaining * 10) / 10) + ' % restants en ' + target.workDays + ' jours ouvrés)', MARGIN, y);
      pdf.setTextColor(0);
      y += 5;
    }
    if (velocity) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(110);
      pdf.text('Rythme observé : ' + formatPct(Math.round(velocity.perWeek * 10) / 10) + ' %/semaine'
        + (velocity.etaISO ? ' — fin projetée le ' + fmtFR(velocity.etaISO) : '')
        + ' (depuis le ' + fmtFR(velocity.fromISO) + ', soit ' + velocity.windowWorkDays + ' jours ouvrés)', MARGIN, y);
      pdf.setTextColor(0);
      y += 5;
    }
    y += 3;
  }

  // ----- 2. Courbe d'avancement -----
  const serie = getAvancementSeries(scope);
  const hist = {};
  for (const p of serie) hist[p.date] = { pct: p.pct };
  const hKeys = serie.map(p => p.date);
  if (hKeys.length > 0) {
    banner('COURBE D\'AVANCEMENT');
    const H = 52, PADL = 12, PADB = 7, PADT = 3;
    ensureSpace(H + 8);
    const gx = MARGIN, gy = y, gw = CONTENT_W, gh = H;
    pdf.setFillColor(252, 251, 250); pdf.setDrawColor(215); pdf.setLineWidth(0.2);
    pdf.rect(gx, gy, gw, gh, 'FD');
    const day = 86400000;
    const first = new Date(hKeys[0] + 'T00:00:00').getTime();
    const last = new Date(hKeys[hKeys.length - 1] + 'T00:00:00').getTime();
    const t0 = planning ? Math.min(first, new Date(planning.start + 'T00:00:00').getTime()) : first;
    const t1 = planning ? Math.max(last, new Date(planning.end + 'T00:00:00').getTime()) : Math.max(last, t0 + day);
    const span = Math.max(day, t1 - t0);
    const px = (ms) => gx + PADL + ((ms - t0) / span) * (gw - PADL - 4);
    const py = (p) => gy + PADT + (1 - Math.max(0, Math.min(100, p)) / 100) * (gh - PADT - PADB);
    // Grille + graduations
    pdf.setFontSize(6); pdf.setTextColor(140);
    for (const p of [0, 25, 50, 75, 100]) {
      pdf.setDrawColor(228); pdf.setLineWidth(0.15);
      pdf.line(gx + PADL, py(p), gx + gw - 4, py(p));
      pdf.text(p + '%', gx + PADL - 1.5, py(p) + 1, { align: 'right' });
    }
    // Trajectoire théorique (pointillés)
    if (planning) {
      const ps = new Date(planning.start + 'T00:00:00').getTime();
      const pe = new Date(planning.end + 'T00:00:00').getTime();
      pdf.setDrawColor(...BLUE); pdf.setLineWidth(0.5);
      const x1 = px(ps), y1 = py(0), x2 = px(pe), y2 = py(100);
      const steps = 46;
      for (let i = 0; i < steps; i += 2) {
        const a = i / steps, b2 = Math.min(1, (i + 1) / steps);
        pdf.line(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b2, y1 + (y2 - y1) * b2);
      }
    }
    // Rythme à tenir : du point du jour à 100 % à l'échéance (pointillés verts)
    const pdfTarget = computeAvancementTarget(model.pct, planning);
    if (planning && pdfTarget && !pdfTarget.done && pdfTarget.perWeek != null) {
      const lastKey = hKeys[hKeys.length - 1];
      const fromMs = Math.max(new Date(todayISO() + 'T00:00:00').getTime(),
        new Date(lastKey + 'T00:00:00').getTime());
      const pe2 = new Date(planning.end + 'T00:00:00').getTime();
      const x1 = px(fromMs), y1 = py(hist[lastKey].pct), x2 = px(pe2), y2 = py(100);
      pdf.setDrawColor(...GREEN); pdf.setLineWidth(0.6);
      const steps = 40;
      for (let i = 0; i < steps; i += 2) {
        const a = i / steps, b2 = Math.min(1, (i + 1) / steps);
        pdf.line(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b2, y1 + (y2 - y1) * b2);
      }
    }
    // Courbe réelle
    pdf.setDrawColor(...ORANGE); pdf.setLineWidth(0.7);
    let prev = null;
    for (const k of hKeys) {
      const cur = { x: px(new Date(k + 'T00:00:00').getTime()), y: py(hist[k].pct) };
      if (prev) pdf.line(prev.x, prev.y, cur.x, cur.y);
      prev = cur;
    }
    if (prev) { pdf.setFillColor(...ORANGE); pdf.circle(prev.x, prev.y, 1, 'F'); }
    // Repère « aujourd'hui »
    const tx = px(new Date(todayISO() + 'T00:00:00').getTime());
    if (tx >= gx + PADL && tx <= gx + gw - 4) {
      pdf.setDrawColor(150); pdf.setLineWidth(0.2);
      for (let yy = gy + PADT; yy < gy + gh - PADB; yy += 3) pdf.line(tx, yy, tx, Math.min(yy + 1.5, gy + gh - PADB));
    }
    // Dates aux extrémités
    pdf.setTextColor(140); pdf.setFontSize(6);
    pdf.text(fmtFR(new Date(t0).toISOString().slice(0, 10)), gx + PADL, gy + gh - 2);
    pdf.text(fmtFR(new Date(t1).toISOString().slice(0, 10)), gx + gw - 4, gy + gh - 2, { align: 'right' });
    pdf.setTextColor(0);
    y = gy + gh + 4;
    // Légende
    pdf.setFontSize(7.5);
    let lx = MARGIN;
    const leg = [[ORANGE, 'Avancement réel']]
      .concat(planning ? [[BLUE, 'Trajectoire théorique']] : [])
      .concat(planning && pdfTarget && !pdfTarget.done && pdfTarget.perWeek != null
        ? [[GREEN, 'Rythme à tenir — ' + formatPct(Math.round(pdfTarget.perWeek * 10) / 10) + ' %/semaine']] : []);
    for (const [col, txt] of leg) {
      pdf.setDrawColor(...col); pdf.setLineWidth(0.7);
      pdf.line(lx, y - 1, lx + 5, y - 1);
      pdf.setTextColor(110); pdf.text(txt, lx + 6.5, y);
      lx += 6.5 + pdf.getTextWidth(txt) + 8;
    }
    pdf.setTextColor(0);
    y += 7;
  }

  // ----- 3. Par bâtiment -----
  if (model.buildings.length > 1) {
    banner('AVANCEMENT PAR BÂTIMENT');
    const rows = model.buildings.slice().sort((a, b) => b.pct - a.pct);
    for (const b of rows) {
      ensureSpace(12);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(20);
      pdf.text(b.name, MARGIN, y);
      pdf.text(formatPct(Math.round(b.pct * 10) / 10) + ' %', MARGIN + CONTENT_W, y, { align: 'right' });
      y += 1.5;
      gauge(b.pct, MARGIN, CONTENT_W, 2.4);
      y += 5.5;
      const delta = b.pct - model.pct;
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120);
      let txt = formatHours(b.hDone) + ' / ' + formatHours(b.hBudget) + unit
        + ' — ' + b.zones + ' zone' + (b.zones > 1 ? 's' : '');
      pdf.text(txt, MARGIN, y);
      if (Math.abs(delta) >= 0.05) {
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...(delta >= 0 ? GREEN : RED));
        pdf.text((delta >= 0 ? '+' : '-') + formatPct(Math.abs(Math.round(delta * 10) / 10)) + ' pts vs moyenne',
          MARGIN + CONTENT_W, y, { align: 'right' });
      }
      pdf.setTextColor(0);
      y += 6;
    }
    y += 2;
  }

  // ----- 4. Récapitulatif par tâche -----
  banner('RÉCAPITULATIF PAR TÂCHE');
  {
    // Mêmes colonnes qu'à l'écran : quantité totale / réalisée, puis heures
    // budgétées / réalisées / restantes.
    const numW = 21;
    const cw = { task: CONTENT_W - numW * 5 - 15, qtyT: numW, qtyD: numW, hB: numW, hD: numW, hR: numW, pct: 15 };
    const cx = {};
    cx.task = MARGIN;
    cx.qtyT = cx.task + cw.task;
    cx.qtyD = cx.qtyT + cw.qtyT;
    cx.hB = cx.qtyD + cw.qtyD;
    cx.hD = cx.hB + cw.hB;
    cx.hR = cx.hD + cw.hD;
    cx.pct = cx.hR + cw.hR;
    const HEAD = [['Tâche', 'task'], ['Qté totale', 'qtyT'], ['Qté réalisée', 'qtyD'],
                  ['H. budget', 'hB'], ['H. réalisées', 'hD'], ['H. restantes', 'hR'], ['%', 'pct']];
    const tableHead = () => {
      ensureSpace(6);
      pdf.setFillColor(...GREY_H);
      pdf.rect(MARGIN, y, CONTENT_W, 5, 'F');
      pdf.setDrawColor(190); pdf.setLineWidth(0.15);
      pdf.rect(MARGIN, y, CONTENT_W, 5, 'S');
      pdf.line(cx.hB, y, cx.hB, y + 5);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(60);
      pdf.text('Tâche', cx.task + 2, y + 3.4);
      for (const [label, key] of HEAD.slice(1)) {
        pdf.text(label, cx[key] + cw[key] - 1.5, y + 3.4, { align: 'right' });
      }
      pdf.setTextColor(0);
      y += 5;
    };
    for (const o of model.ouvrages) {
      ensureSpace(24);
      // Bandeau de l'ouvrage
      const BOX_H = 15;
      pdf.setFillColor(245, 243, 240); pdf.setDrawColor(205); pdf.setLineWidth(0.2);
      pdf.rect(MARGIN, y, CONTENT_W, BOX_H, 'FD');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(20);
      pdf.text(pdf.splitTextToSize(o.name, CONTENT_W - 46)[0], MARGIN + 3, y + 5);
      pdf.setFontSize(10); pdf.setTextColor(...ORANGE);
      pdf.text(formatPct(Math.round(o.pct * 10) / 10) + ' %', MARGIN + CONTENT_W - 3, y + 5, { align: 'right' });
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(110);
      pdf.text(formatQty(o.qtyTotal) + ' ' + o.unit
        + (model.weighting === 'heures'
          ? ' — ' + formatHours(o.hDone) + ' / ' + formatHours(o.hBudget) + ' h'
            + ' — reste ' + formatHours(Math.max(0, o.hBudget - o.hDone)) + ' h'
          : ' — ' + formatQty(o.qtyDone) + ' ' + o.unit + ' réalisés')
        + ' — poids ' + formatPct(Math.round(o.weight * 10) / 10) + ' % du projet', MARGIN + 3, y + 9);
      pdf.setTextColor(0);
      // Jauge sous la ligne de quantités, à l'intérieur de l'encadré.
      const boxTop = y;
      y = boxTop + 11.6;
      gauge(o.pct, MARGIN + 3, CONTENT_W - 6, 1.6);
      y = boxTop + BOX_H + 1.5;
      // Tableau des tâches
      tableHead();
      let alt = false;
      const na = '-';
      const noHours = model.weighting !== 'heures';
      const cell = (txt, key) => pdf.text(txt, cx[key] + cw[key] - 1.5, y + 3.4, { align: 'right' });
      for (const t of o.tasks) {
        ensureSpace(5.5);
        if (alt) { pdf.setFillColor(...ALT); pdf.rect(MARGIN, y, CONTENT_W, 5, 'F'); }
        alt = !alt;
        pdf.setDrawColor(220); pdf.setLineWidth(0.12);
        pdf.line(MARGIN, y + 5, MARGIN + CONTENT_W, y + 5);
        pdf.setDrawColor(215);
        pdf.line(cx.hB, y, cx.hB, y + 5);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5);
        pdf.setTextColor(t.excluded ? 140 : 30);
        pdf.text(pdf.splitTextToSize(t.name + (t.excluded ? '  (hors ratio)' : ''), cw.task - 4)[0], cx.task + 2, y + 3.4);
        pdf.setTextColor(90);
        cell(formatQty(t.qtyTotal) + ' ' + o.unit, 'qtyT');
        cell(formatQty(t.qtyDone) + ' ' + o.unit, 'qtyD');
        const h = (v) => (t.excluded || noHours) ? na : formatHours(v);
        cell(h(t.hBudget), 'hB');
        cell(h(t.hDone), 'hD');
        cell(h(t.hRemaining), 'hR');
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...(t.pct >= 99.95 ? GREEN : (t.pct > 0 ? [60,60,60] : [150,150,150])));
        cell(formatPct(Math.round(t.pct * 10) / 10) + ' %', 'pct');
        pdf.setTextColor(0);
        y += 5;
      }
      // Ligne de total : seules les heures s'additionnent d'une tâche à l'autre.
      if (!noHours) {
        ensureSpace(5.5);
        pdf.setFillColor(238, 236, 233); pdf.rect(MARGIN, y, CONTENT_W, 5, 'F');
        pdf.setDrawColor(190); pdf.setLineWidth(0.15);
        pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
        pdf.line(cx.hB, y, cx.hB, y + 5);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(70);
        pdf.text('Total ouvrage', cx.task + 2, y + 3.4);
        cell(formatQty(o.qtyTotal) + ' ' + o.unit, 'qtyT');
        cell(formatQty(o.qtyDone) + ' ' + o.unit + ' éq.', 'qtyD');
        cell(formatHours(o.hBudget), 'hB');
        cell(formatHours(o.hDone), 'hD');
        cell(formatHours(Math.max(0, o.hBudget - o.hDone)), 'hR');
        cell(formatPct(Math.round(o.pct * 10) / 10) + ' %', 'pct');
        pdf.setTextColor(0);
        y += 5;
      }
      y += 5;
    }
  }

  // ----- 5. Points d'attention -----
  banner('POINTS D\'ATTENTION');
  {
    const bullet = (txt, color) => {
      const lines = pdf.splitTextToSize(txt, CONTENT_W - 6);
      ensureSpace(lines.length * 4 + 1);
      pdf.setFillColor(...(color || [140, 140, 140]));
      pdf.circle(MARGIN + 1.4, y - 1.2, 0.9, 'F');
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(40);
      lines.forEach((ln, i) => pdf.text(ln, MARGIN + 5, y + i * 4));
      pdf.setTextColor(0);
      y += lines.length * 4 + 0.5;
    };
    const subTitle = (txt) => {
      ensureSpace(8);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(110);
      pdf.text(txt.toUpperCase(), MARGIN, y);
      pdf.setTextColor(0);
      y += 4.5;
    };

    subTitle('Reste à faire le plus lourd');
    const heavy = model.zones
      .filter(z => z.hBudget > 0 && z.pct < 99.95)
      .sort((a, b) => (b.hBudget * (100 - b.pct)) - (a.hBudget * (100 - a.pct)))
      .slice(0, 6);
    if (!heavy.length) bullet('Tout est terminé dans ce périmètre.', GREEN);
    for (const z of heavy) {
      bullet(z.label + ' — ' + formatHours(z.hBudget - z.hDone) + unit + ' restants (' + formatPct(Math.round(z.pct)) + ' %)', AMBER);
    }
    y += 2;

    subTitle('Sans mise à jour depuis ' + AVANCEMENT_STALE_DAYS + ' jours');
    const stale = model.issues.stale.slice(0, 6);
    if (!stale.length) bullet('Toutes les zones en cours ont été mises à jour récemment.', GREEN);
    for (const s of stale) {
      bullet(s.label + ' — ' + (s.days == null ? 'jamais saisie' : s.days + ' jours') + ' (' + formatPct(Math.round(s.pct)) + ' %)', RED);
    }
    y += 2;

    subTitle('Qualité des données');
    const notes = [];
    if (model.weighting !== 'heures') {
      notes.push(['Aucun ratio de production saisi : l\'avancement est pondéré par '
        + (model.weighting === 'quantites' ? 'les quantités.' : 'le nombre de tâches.'), AMBER]);
    }
    const noRatio = [...new Set(model.issues.noRatio.map(i => i.name))];
    if (noRatio.length) notes.push([noRatio.length + ' ouvrage(s) sans ratio ne pèsent pas dans le global : ' + noRatio.slice(0, 5).join(', ') + '.', AMBER]);
    const noQty = [...new Set(model.issues.noQty.map(i => i.setupName))];
    if (noQty.length) notes.push([model.issues.noQty.length + ' affectation(s) sans quantité (' + noQty.slice(0, 5).join(', ') + ').', AMBER]);
    if (!planning) notes.push(['Dates de chantier non renseignées : ni écart au planning, ni trajectoire théorique.', AMBER]);
    if (!notes.length) notes.push(['Ratios, quantités et dates sont renseignés : le chiffre global est pleinement pondéré.', GREEN]);
    for (const [txt, col] of notes) bullet(txt, col);
    y += 2;
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8); pdf.setTextColor(120);
    ensureSpace(5);
    pdf.text(model.counts.zones + ' zones porteuses  ·  ' + model.counts.ouvrages + ' ouvrages  ·  '
      + model.counts.taches + ' tâches  ·  ' + model.counts.zonesDone + ' zones terminées  ·  '
      + model.counts.zonesToStart + ' non commencées', MARGIN, y);
    pdf.setTextColor(0);
  }

  addFooter();
  const slug = (label || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'projet';
  const dd = String(d0.getDate()).padStart(2, '0');
  const mm = String(d0.getMonth() + 1).padStart(2, '0');
  pdf.save(`Avancement_${slug}_${dd}-${mm}-${d0.getFullYear()}.pdf`);
}

// ======================= RENDU DU TABLEAU DE BORD =======================
function renderRecap() {
  const pickerEl = document.getElementById('recappicker');
  const contentEl = document.getElementById('recapcontent');
  const emptyEl = document.getElementById('recapempty');
  if (!pickerEl || !contentEl || !emptyEl) return;
  pickerEl.innerHTML = '';
  contentEl.innerHTML = '';
  emptyEl.classList.remove('show');

  const buildings = getBuildings();
  if (buildings.length === 0) {
    emptyEl.innerHTML = '<p>Aucun bâtiment.</p><p class="hint">Créez au moins une zone racine dans <strong>Données → Zones</strong>.</p>';
    emptyEl.classList.add('show');
    return;
  }
  // Périmètre : tout le projet, ou un bâtiment. '' = tout le projet.
  let scope = state.recapBuildingId || '';
  if (scope && !buildings.some(b => b.id === scope)) scope = '';
  if (scope !== state.recapBuildingId) { state.recapBuildingId = scope; save(); }

  stampAvancementHistory();
  const model = computeAvancementModel(scope);
  const full = scope ? computeAvancementModel('') : model;

  // ----- Barre de périmètre + export -----
  const chips = dbEl('div', 'db-scope');
  const mkChip = (id, label, pct) => {
    const b = dbEl('button', 'db-scope-chip' + (scope === id ? ' is-on' : ''));
    b.type = 'button';
    b.appendChild(dbEl('span', 'db-scope-name', label));
    if (pct != null) b.appendChild(dbEl('span', 'db-scope-pct', formatPct(Math.round(pct * 10) / 10) + ' %'));
    b.addEventListener('click', () => { state.recapBuildingId = id; save(); renderRecap(); });
    chips.appendChild(b);
  };
  mkChip('', 'Tout le projet', full.pct);
  for (const b of full.buildings) mkChip(b.id, b.name, b.pct);
  pickerEl.appendChild(chips);
  // Période de comparaison : alimente les colonnes « variation » de la
  // matrice et du récapitulatif par tâche.
  const periods = dbEl('div', 'db-periods');
  periods.appendChild(dbEl('span', 'db-periods-label', 'Variation'));
  for (const per of RECAP_PERIODS) {
    const b = dbEl('button', 'db-period' + (getRecapPeriod().key === per.key ? ' is-on' : ''), per.label);
    b.type = 'button';
    b.title = per.days == null
      ? 'Variation depuis le démarrage du chantier'
      : 'Variation sur les ' + per.days + ' derniers jours';
    b.addEventListener('click', () => { state.recapPeriod = per.key; save(); renderRecap(); });
    periods.appendChild(b);
  }
  pickerEl.appendChild(periods);
  const exportBtn = dbEl('button', 'db-export', 'Exporter en PDF');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', () => {
    const label = scope ? (buildings.find(b => b.id === scope) || {}).name : 'Tout le projet';
    exportAvancementToPDF(scope, label);
  });
  pickerEl.appendChild(exportBtn);

  if (model.counts.zones === 0) {
    emptyEl.innerHTML = '<p>Aucun ouvrage affecté dans ce périmètre.</p><p class="hint">Affectez un ouvrage à au moins une zone dans <strong>Données → Zones</strong>.</p>';
    emptyEl.classList.add('show');
    return;
  }

  const planning = computeAvancementPlanning(model.pct, scope);
  const velocity = computeAvancementVelocity(scope);

  contentEl.appendChild(buildDbKpis(model, planning, velocity));
  contentEl.appendChild(buildDbCurve(model, planning, scope, velocity));
  const panels = [];
  if (!scope && full.buildings.length > 1) panels.push(buildDbBuildings(model));
  panels.push(buildDbMatrix(model, scope));
  if (panels.length > 1) {
    const grid = dbEl('div', 'db-grid');
    for (const p of panels) grid.appendChild(p);
    contentEl.appendChild(grid);
  } else {
    contentEl.appendChild(panels[0]);
  }
  contentEl.appendChild(buildDbOuvrages(model));
  contentEl.appendChild(buildDbFocus(model, planning));
}

// ----- 1. Bandeau d'indicateurs -----
function buildDbKpis(model, planning, velocity) {
  const row = dbEl('div', 'db-kpis');

  // Avancement global
  const k1 = dbEl('div', 'db-kpi db-kpi-main');
  k1.appendChild(dbEl('div', 'db-kpi-label', 'Avancement global'));
  const v1 = dbEl('div', 'db-kpi-value');
  v1.appendChild(dbEl('span', 'db-kpi-num', formatPct(Math.round(model.pct * 10) / 10)));
  v1.appendChild(dbEl('span', 'db-kpi-unit', '%'));
  k1.appendChild(v1);
  k1.appendChild(dbBar(model.pct, 'db-bar-lg'));
  // Le mode de pondération reste consultable en infobulle : il n'apparaît
  // plus en clair sous le chiffre, et « Qualité des données » le signale
  // déjà lorsqu'il n'est pas celui attendu.
  k1.title = model.weighting === 'heures' ? 'Pondéré par les heures budgétées'
    : (model.weighting === 'quantites' ? 'Pondéré par les quantités (aucun ratio saisi)'
      : 'Moyenne des tâches (ni ratio ni quantité saisis)');
  row.appendChild(k1);

  // Écart au planning
  const k2 = dbEl('div', 'db-kpi');
  k2.appendChild(dbEl('div', 'db-kpi-label', 'Écart au planning'));
  if (planning) {
    const e = planning.ecart;
    const v = dbEl('div', 'db-kpi-value ' + (e >= 0 ? 'is-pos' : 'is-neg'));
    v.appendChild(dbEl('span', 'db-kpi-num', (e >= 0 ? '+' : '−') + formatPct(Math.abs(Math.round(e * 10) / 10))));
    v.appendChild(dbEl('span', 'db-kpi-unit', '%'));
    k2.appendChild(v);
    k2.appendChild(dbEl('div', 'db-kpi-tag ' + (e >= 0 ? 'is-pos' : 'is-neg'),
      e >= 0 ? 'En avance sur le calendrier' : 'En retard sur le calendrier'));
    k2.appendChild(dbEl('div', 'db-kpi-sub',
      'Attendu au ' + fmtFR(todayISO()) + ' : ' + formatPct(Math.round(planning.pctTemps * 10) / 10) + ' %'));
  } else {
    k2.appendChild(dbEl('div', 'db-kpi-value db-kpi-void', '—'));
    k2.appendChild(dbEl('div', 'db-kpi-sub', 'Renseignez les dates du chantier dans Données → Chantier.'));
  }
  row.appendChild(k2);

  // Charge de travail
  const k3 = dbEl('div', 'db-kpi');
  k3.appendChild(dbEl('div', 'db-kpi-label', model.weighting === 'heures' ? 'Heures de main-d\'œuvre' : 'Charge pondérée'));
  const v3 = dbEl('div', 'db-kpi-value');
  v3.appendChild(dbEl('span', 'db-kpi-num', formatHours(model.hDone)));
  v3.appendChild(dbEl('span', 'db-kpi-unit', model.weighting === 'heures' ? 'h droit à dépenser' : 'pts acquis'));
  k3.appendChild(v3);
  k3.appendChild(dbBar(model.pct));
  k3.appendChild(dbEl('div', 'db-kpi-sub',
    'sur ' + formatHours(model.hBudget) + (model.weighting === 'heures' ? ' h budgétées · reste ' : ' · reste ')
    + formatHours(Math.max(0, model.hBudget - model.hDone)) + (model.weighting === 'heures' ? ' h' : '')));
  row.appendChild(k3);

  // Calendrier / projection
  const k4 = dbEl('div', 'db-kpi');
  k4.appendChild(dbEl('div', 'db-kpi-label', 'Calendrier'));
  if (planning) {
    const v = dbEl('div', 'db-kpi-value');
    v.appendChild(dbEl('span', 'db-kpi-num', String(planning.remainingDays)));
    v.appendChild(dbEl('span', 'db-kpi-unit', 'jours restants'));
    k4.appendChild(v);
    k4.appendChild(dbBar(planning.pctTemps, 'db-bar-time'));
    k4.appendChild(dbEl('div', 'db-kpi-sub',
      'Fin prévue le ' + fmtFR(planning.end)
      + ' · ' + planning.remainingWorkDays + ' j ouvrés restants'
      + ' · ' + planning.elapsed + '/' + planning.totalDays + ' j écoulés'));
  } else {
    k4.appendChild(dbEl('div', 'db-kpi-value db-kpi-void', '—'));
    k4.appendChild(dbEl('div', 'db-kpi-sub', 'Dates de chantier non renseignées.'));
  }
  // Rythme À TENIR : la donnée qui répond à « combien par semaine pour finir
  // à la date objectif ». Mise en avant, avant le rythme observé.
  const target = computeAvancementTarget(model.pct, planning);
  if (target) {
    let txt;
    if (target.done) txt = 'Objectif atteint : 100 % avant l\'échéance';
    else if (target.lastDay) txt = 'Dernier jour : ' + formatPct(Math.round(target.remaining * 10) / 10) + ' % restants';
    else if (target.perWeek == null) txt = 'Échéance dépassée : ' + formatPct(Math.round(target.remaining * 10) / 10) + ' % restants';
    else txt = 'À tenir : ' + formatPct(Math.round(target.perWeek * 10) / 10) + ' %/semaine jusqu\'au ' + fmtFR(target.end);
    const el = dbEl('div', 'db-kpi-sub db-kpi-target' + (target.perWeek == null && !target.done ? ' is-neg' : ''), txt);
    el.title = 'Rythme à tenir = (100 % − avancement actuel) ÷ jours ouvrés restants, ramené à une semaine de 5 jours'
      + (target.workDays ? ' — ' + formatPct(Math.round(target.remaining * 10) / 10) + ' % en ' + target.workDays + ' jours ouvrés' : '')
      + '. C\'est la pente de la courbe de projection.';
    k4.appendChild(el);
  }
  if (velocity) {
    const rate = dbEl('div', 'db-kpi-sub db-kpi-rate',
      'Rythme observé : ' + formatPct(Math.round(velocity.perWeek * 10) / 10) + ' %/semaine'
      + (velocity.etaISO ? ' · fin projetée le ' + fmtFR(velocity.etaISO) : ''));
    rate.title = 'Rythme constaté depuis le premier relevé, le ' + fmtFR(velocity.fromISO)
      + ' (' + formatPct(Math.round(velocity.fromPct * 10) / 10) + ' %), jusqu\'au ' + fmtFR(velocity.toISO)
      + ' (' + formatPct(Math.round(velocity.toPct * 10) / 10) + ' %) : ' + velocity.windowDays
      + ' jours, soit ' + velocity.windowWorkDays + ' jours ouvrés. Ramené à une semaine de 5 jours,'
      + ' puis prolongé jusqu\'à 100 %.';
    k4.appendChild(rate);
  }
  row.appendChild(k4);
  return row;
}

// ----- 2. Courbe d'avancement -----
// Quatre tracés se superposent : l'avancement réel, la trajectoire théorique
// (linéaire sur la période), le rythme à tenir (du jour à 100 % à l'échéance)
// et la projection au rythme observé (du jour à 100 % à la date projetée).
// L'échelle de temps se contracte ou se dilate comme celle du planning, et un
// curseur donne, pour n'importe quelle date, la valeur des quatre courbes.
const CURVE_ZOOMS = [
  { key: 'auto',     label: 'Ajusté',   dayW: null },
  { key: 'mois',     label: 'Mois',     dayW: 62 / 30.4 },
  { key: 'semaines', label: 'Semaines', dayW: 30 / 7 },
  { key: 'jours',    label: 'Jours',    dayW: 22 },
];
const CURVE_MAX_W = 24000;   // garde-fou : au-delà, le SVG devient inexploitable

// Graduations intermédiaires : un pas « rond » (jour, semaine, mois,
// trimestre, année) choisi pour laisser au moins ~86 px entre deux dates.
function curveTicks(t0, t1, plotW, prefer) {
  const day = 86400000;
  const days = Math.max(1, Math.round((t1 - t0) / day));
  const maxTicks = Math.max(2, Math.floor(plotW / 86));
  let step = days / maxTicks;
  // L'échelle choisie impose la finesse des repères tant qu'ils ne se
  // chevauchent pas : sur un chantier court, « Mois » et « Semaines » ne
  // dilatent rien (la largeur est déjà suffisante) mais doivent tout de même
  // changer visiblement la graduation.
  if (prefer) {
    const pxPerDay = plotW / days;
    if (prefer === 'jours' && pxPerDay >= 24) step = 1;
    else if (prefer === 'semaines' && pxPerDay * 7 >= 40) step = 7;
    else if (prefer === 'mois' && pxPerDay * 30 >= 52) step = 30;
  }
  const out = [];
  const push = (ms, label) => { if (ms >= t0 && ms <= t1) out.push({ ms, label }); };
  const d0 = new Date(t0);
  if (step <= 1.2) {
    for (let ms = t0; ms <= t1; ms += day) push(ms, fmtFR(new Date(ms).toISOString().slice(0, 10)).slice(0, 5));
  } else if (step <= 3) {
    for (let ms = t0; ms <= t1; ms += 2 * day) push(ms, fmtFR(new Date(ms).toISOString().slice(0, 10)).slice(0, 5));
  } else if (step <= 10) {
    // Lundis : le repère naturel d'un planning de chantier
    let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()));
    while (d.getUTCDay() !== 1) d = new Date(d.getTime() + day);
    for (let ms = d.getTime(); ms <= t1; ms += 7 * day) push(ms, fmtFR(new Date(ms).toISOString().slice(0, 10)).slice(0, 5));
  } else if (step <= 20) {
    let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()));
    while (d.getUTCDay() !== 1) d = new Date(d.getTime() + day);
    for (let ms = d.getTime(); ms <= t1; ms += 14 * day) push(ms, fmtFR(new Date(ms).toISOString().slice(0, 10)).slice(0, 5));
  } else {
    const monthStep = step <= 45 ? 1 : (step <= 75 ? 2 : (step <= 120 ? 3 : (step <= 250 ? 6 : 12)));
    let y = d0.getUTCFullYear(), m = d0.getUTCMonth();
    // On aligne le premier repère sur un multiple du pas pour éviter les
    // suites du type « févr., mai, août » quand « janv., avr., juil. » se lit mieux.
    m = Math.floor(m / monthStep) * monthStep;
    for (let ms = Date.UTC(y, m, 1); ms <= t1; ) {
      push(ms, monthStep >= 12
        ? String(new Date(ms).getUTCFullYear())
        : GANTT_MONTHS_FR[new Date(ms).getUTCMonth()] + ' ' + String(new Date(ms).getUTCFullYear()).slice(2));
      m += monthStep;
      if (m > 11) { y += Math.floor(m / 12); m %= 12; }
      ms = Date.UTC(y, m, 1);
    }
  }
  return out;
}

function buildDbCurve(model, planning, scope, velocity) {
  const card = dbCard('Courbe d\'avancement');
  const serie = getAvancementSeries(scope);
  const hBudget = model.hBudget;
  // La bascule n'a de sens qu'en pondération « heures » : sans ratio saisi,
  // model.hBudget est une somme de quantités, pas des heures.
  const canHours = model.weighting === 'heures' && hBudget > 0;
  const mode = (state.recapCurveMode === 'heures' && canHours) ? 'heures' : 'pct';
  const zoom = CURVE_ZOOMS.find(z => z.key === state.recapCurveZoom) || CURVE_ZOOMS[0];

  const head = card.querySelector('.db-card-head');
  const controls = dbEl('div', 'db-curve-controls');
  // Échelle de temps, comme au planning : « Ajusté » tient dans la page, les
  // autres dilatent l'axe et font défiler.
  const zseg = dbEl('div', 'db-curve-modes');
  zseg.appendChild(dbEl('span', 'db-curve-modes-label', 'Échelle'));
  for (const z of CURVE_ZOOMS) {
    const b = dbEl('button', 'db-curve-mode' + (zoom.key === z.key ? ' is-on' : ''), z.label);
    b.type = 'button';
    b.title = z.dayW == null ? 'Toute la période dans la largeur disponible'
      : 'Dilater l\'axe du temps à l\'échelle : ' + z.label.toLowerCase();
    b.addEventListener('click', () => { state.recapCurveZoom = z.key; save(); renderRecap(); });
    zseg.appendChild(b);
  }
  controls.appendChild(zseg);
  if (canHours) {
    const seg = dbEl('div', 'db-curve-modes');
    for (const [key, label] of [['pct', '%'], ['heures', 'Heures']]) {
      const b = dbEl('button', 'db-curve-mode' + (mode === key ? ' is-on' : ''), label);
      b.type = 'button';
      b.title = key === 'pct' ? 'Axe en pourcentage d\'avancement' : 'Axe en heures de main-d\'œuvre';
      b.addEventListener('click', () => { state.recapCurveMode = key; save(); renderRecap(); });
      seg.appendChild(b);
    }
    controls.appendChild(seg);
  }
  head.appendChild(controls);

  if (!serie.length) {
    card.appendChild(dbEl('p', 'db-empty', scope
      ? 'Pas encore de point pour ce bâtiment : la courbe par bâtiment se construit à partir des prochaines saisies d\'avancement.'
      : 'La courbe se construit automatiquement : un point est enregistré chaque jour où l\'avancement évolue.'));
    return card;
  }

  const scroll = dbEl('div', 'db-curve-scroll');
  const box = dbEl('div', 'db-curve-wrap');
  scroll.appendChild(box);
  card.appendChild(scroll);
  const legend = dbEl('div', 'db-legend');
  card.appendChild(legend);
  const notes = dbEl('div', 'db-curve-notes');
  card.appendChild(notes);

  // Le tracé se dimensionne sur la largeur réelle du conteneur : on attend
  // donc son insertion dans le document pour le dessiner.
  requestAnimationFrame(() => {
    if (!scroll.isConnected) return;
    drawDbCurve({ scroll, box, legend, notes, model, planning, scope, velocity, serie, mode, zoom, canHours, hBudget });
  });
  return card;
}

function drawDbCurve(ctx) {
  const { scroll, box, legend, notes, model, planning, scope, velocity, serie, mode, zoom, canHours, hBudget } = ctx;
  box.innerHTML = '';
  legend.innerHTML = '';
  notes.innerHTML = '';

  const day = 86400000;
  const ms = (iso) => new Date(iso + 'T00:00:00').getTime();
  const isoOf = (msVal) => new Date(msVal).toISOString().slice(0, 10);
  const keys = serie.map(p => p.date);
  const firstHist = ms(keys[0]);
  const lastHist = ms(keys[keys.length - 1]);
  let t0 = planning ? Math.min(firstHist, ms(planning.start)) : firstHist;
  let t1 = planning ? Math.max(lastHist, ms(planning.end)) : Math.max(lastHist, t0 + day);
  if (velocity && velocity.etaISO) t1 = Math.max(t1, ms(velocity.etaISO));
  const span = Math.max(day, t1 - t0);
  const totalDays = Math.round(span / day) + 1;

  const avail = Math.max(320, scroll.clientWidth || 760);
  const H = Math.max(240, Math.min(380, Math.round(avail * 0.3)));
  const PAD_L = mode === 'heures' ? 52 : 40, PAD_R = 16, PAD_T = 14, PAD_B = 30;
  const wanted = zoom.dayW ? Math.round(totalDays * zoom.dayW) + PAD_L + PAD_R : avail;
  const W = Math.max(avail, Math.min(CURVE_MAX_W, wanted));

  const yMax = mode === 'heures' ? hBudget : 100;
  const rawHist = state.avancementHistory || {};
  const valOf = (dateKey, pct) => {
    if (mode !== 'heures') return pct;
    const point = rawHist[dateKey];
    if (!scope && point && typeof point.hDone === 'number') return point.hDone;
    return (pct / 100) * hBudget;
  };
  const x = (v) => PAD_L + ((v - t0) / span) * (W - PAD_L - PAD_R);
  const y = (v) => PAD_T + (1 - Math.max(0, Math.min(yMax, v)) / yMax) * (H - PAD_T - PAD_B);
  const toY = (pct) => mode === 'heures' ? (pct / 100) * hBudget : pct;
  const fmtV = (pct) => mode === 'heures'
    ? formatHours((pct / 100) * hBudget) + ' h'
    : formatPct(Math.round(pct * 10) / 10) + ' %';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'db-curve');
  svg.style.width = W + 'px';
  svg.style.height = H + 'px';
  const mk = (tag, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };
  // Grille horizontale + graduations de l'axe des valeurs
  for (const q of [0, 0.25, 0.5, 0.75, 1]) {
    const v = yMax * q;
    svg.appendChild(mk('line', { x1: PAD_L, x2: W - PAD_R, y1: y(v), y2: y(v), class: 'db-curve-grid' }));
    const lab = mk('text', { x: PAD_L - 6, y: y(v) + 4, class: 'db-curve-axis', 'text-anchor': 'end' });
    lab.textContent = mode === 'heures' ? formatHours(v) : Math.round(q * 100) + '%';
    svg.appendChild(lab);
  }
  // Graduations de l'axe du temps
  const ticks = curveTicks(t0, t1, W - PAD_L - PAD_R, zoom.dayW ? zoom.key : null);
  for (const tk of ticks) {
    svg.appendChild(mk('line', { x1: x(tk.ms), x2: x(tk.ms), y1: PAD_T, y2: H - PAD_B, class: 'db-curve-vgrid' }));
    const lab = mk('text', { x: x(tk.ms), y: H - 10, class: 'db-curve-axis', 'text-anchor': 'middle' });
    lab.textContent = tk.label;
    svg.appendChild(lab);
  }
  // Repères de fin de bâtiment (période propre saisie dans le planning)
  const markers = [];
  if (!scope) {
    for (const b of getBuildings()) {
      const d = (state.zoneDates || {})[b.id];
      if (!d || !d.start || !d.end) continue;
      const t = ms(d.end);
      if (t < t0 || t > t1) continue;
      markers.push({ name: b.name || '(bâtiment)', iso: d.end, x: x(t), color: ganttZoneColor(b.id) });
    }
  }
  for (const mkr of markers) {
    const line = mk('line', { x1: mkr.x, x2: mkr.x, y1: PAD_T, y2: H - PAD_B, class: 'db-curve-marker' });
    line.setAttribute('stroke', mkr.color);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = mkr.name + ' — fin le ' + fmtFR(mkr.iso);
    line.appendChild(t);
    svg.appendChild(line);
    const dot = mk('circle', { cx: mkr.x, cy: PAD_T + 3, r: 3, class: 'db-curve-marker-dot' });
    dot.setAttribute('fill', mkr.color);
    dot.appendChild(t.cloneNode(true));
    svg.appendChild(dot);
  }

  // ----- Les quatre séries, sous forme de fonctions du temps -----
  const pts = keys.map(k => ({ ms: ms(k), k, pct: serie.find(p => p.date === k).pct }));
  const realAt = (v) => {
    if (v < pts[0].ms || v > pts[pts.length - 1].ms) return null;
    for (let i = 1; i < pts.length; i++) {
      if (v <= pts[i].ms) {
        const a = pts[i - 1], b = pts[i];
        if (b.ms === a.ms) return b.pct;
        return a.pct + (b.pct - a.pct) * ((v - a.ms) / (b.ms - a.ms));
      }
    }
    return pts[pts.length - 1].pct;
  };
  const ps = planning ? ms(planning.start) : null;
  const pe = planning ? ms(planning.end) : null;
  const theoryAt = (v) => {
    if (!planning || pe <= ps) return null;
    if (v < ps || v > pe) return null;
    return ((v - ps) / (pe - ps)) * 100;
  };
  const lastPct = pts[pts.length - 1].pct;
  const fromMs = Math.max(ms(todayISO()), lastHist);
  const target = computeAvancementTarget(lastPct, planning);
  const showTarget = !!(target && target.perWeek != null && !target.done && pe > fromMs);
  const targetAt = (v) => {
    if (!showTarget || v < fromMs || v > pe) return null;
    return lastPct + (100 - lastPct) * ((v - fromMs) / (pe - fromMs));
  };
  const etaMs = velocity && velocity.etaISO ? ms(velocity.etaISO) : null;
  const showEta = !!(etaMs && lastPct < 99.95 && etaMs > fromMs);
  const etaAt = (v) => {
    if (!showEta || v < fromMs || v > etaMs) return null;
    return lastPct + (100 - lastPct) * ((v - fromMs) / (etaMs - fromMs));
  };

  if (planning) svg.appendChild(mk('line', { x1: x(ps), y1: y(0), x2: x(pe), y2: y(yMax), class: 'db-curve-theory' }));
  if (showTarget) svg.appendChild(mk('line', { x1: x(fromMs), y1: y(toY(lastPct)), x2: x(pe), y2: y(yMax), class: 'db-curve-target' }));
  if (showEta) {
    svg.appendChild(mk('line', { x1: x(fromMs), y1: y(toY(lastPct)), x2: x(etaMs), y2: y(yMax), class: 'db-curve-eta' }));
    svg.appendChild(mk('circle', { cx: x(etaMs), cy: y(yMax), r: 3.5, class: 'db-curve-eta-dot' }));
  }
  // Courbe réelle
  const drawn = pts.map(p => ({ x: x(p.ms), y: y(valOf(p.k, p.pct)) }));
  if (drawn.length > 1) {
    const d = drawn.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    const area = d + ` L${drawn[drawn.length - 1].x.toFixed(1)} ${y(0)} L${drawn[0].x.toFixed(1)} ${y(0)} Z`;
    svg.appendChild(mk('path', { d: area, class: 'db-curve-area' }));
    svg.appendChild(mk('path', { d, class: 'db-curve-real' }));
  }
  const lastDrawn = drawn[drawn.length - 1];
  svg.appendChild(mk('circle', { cx: lastDrawn.x, cy: lastDrawn.y, r: 4.5, class: 'db-curve-dot' }));
  // Aujourd'hui
  const todayX = x(ms(todayISO()));
  if (todayX >= PAD_L && todayX <= W - PAD_R) {
    svg.appendChild(mk('line', { x1: todayX, y1: PAD_T, x2: todayX, y2: H - PAD_B, class: 'db-curve-today' }));
  }

  // ----- Curseur de lecture -----
  // Il se pose sur n'importe quelle DATE de la période, y compris celles sans
  // relevé : on lit alors la trajectoire théorique et les deux projections,
  // ce qui permet de se situer même sur les jours creux.
  const SERIES = [
    { key: 'real',   cls: 'is-real',   nom: 'Réel',            at: realAt },
    { key: 'theory', cls: 'is-theory', nom: 'Théorique',       at: theoryAt },
    { key: 'target', cls: 'is-target', nom: 'Rythme à tenir',  at: targetAt },
    { key: 'eta',    cls: 'is-eta',    nom: 'Rythme actuel',   at: etaAt },
  ];
  const cursor = mk('g', { class: 'db-curve-cursor', visibility: 'hidden' });
  const cLine = mk('line', { y1: PAD_T, y2: H - PAD_B, class: 'db-curve-cursor-line' });
  cursor.appendChild(cLine);
  const cDots = {};
  for (const s of SERIES) {
    cDots[s.key] = mk('circle', { r: 4, class: 'db-curve-cursor-dot ' + s.cls, visibility: 'hidden' });
    cursor.appendChild(cDots[s.key]);
  }
  svg.appendChild(cursor);
  const hit = mk('rect', {
    x: PAD_L, y: PAD_T,
    width: Math.max(1, W - PAD_L - PAD_R), height: Math.max(1, H - PAD_T - PAD_B),
    class: 'db-curve-hit',
  });
  svg.appendChild(hit);
  box.appendChild(svg);

  const tip = dbEl('div', 'db-curve-tip');
  tip.hidden = true;
  box.appendChild(tip);

  let hideTimer = null;
  const hideCursor = () => {
    cursor.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const moveCursor = (ev) => {
    const r = svg.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const vx = ((ev.clientX - r.left) / r.width) * W;
    // On se cale sur la journée la plus proche : le curseur parcourt toute la
    // période, pas seulement les dates relevées.
    const raw = t0 + ((vx - PAD_L) / Math.max(1, W - PAD_L - PAD_R)) * span;
    const at = Math.max(t0, Math.min(t1, Math.round(raw / day) * day));
    const cx = x(at);
    cursor.setAttribute('visibility', 'visible');
    cLine.setAttribute('x1', cx); cLine.setAttribute('x2', cx);
    tip.hidden = false;
    tip.innerHTML = '';
    tip.appendChild(dbEl('span', 'db-curve-tip-date', fmtFR(isoOf(at))));
    let any = false;
    for (const s of SERIES) {
      const v = s.at(at);
      const dot = cDots[s.key];
      if (v == null) { dot.setAttribute('visibility', 'hidden'); continue; }
      any = true;
      dot.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', y(toY(v)));
      const line = dbEl('span', 'db-curve-tip-line');
      line.appendChild(dbEl('span', 'db-curve-tip-swatch ' + s.cls));
      line.appendChild(dbEl('span', 'db-curve-tip-nom', s.nom));
      line.appendChild(dbEl('span', 'db-curve-tip-val', fmtV(v)));
      tip.appendChild(line);
    }
    if (!any) tip.appendChild(dbEl('span', 'db-curve-tip-nom', 'Aucune donnée à cette date'));
    else if (canHours && mode !== 'heures') {
      const rv = realAt(at);
      if (rv != null) tip.appendChild(dbEl('span', 'db-curve-tip-sub',
        formatHours((rv / 100) * hBudget) + ' h de droit à dépenser'));
    }
    // L'étiquette suit le curseur mais reste entièrement dans le cadre.
    const px = (cx / W) * r.width;
    const half = tip.offsetWidth / 2 + 2;
    tip.style.left = Math.max(half, Math.min(Math.max(half, r.width - half), px)) + 'px';
    if (ev.pointerType === 'touch') {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hideCursor, 3000);
    }
  };
  hit.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'touch') moveCursor(ev); });
  hit.addEventListener('pointerdown', moveCursor);
  hit.addEventListener('pointerleave', () => { clearTimeout(hideTimer); hideCursor(); });

  // ----- Légende et notes -----
  const mkLeg = (cls, text, title) => {
    const l = dbEl('span', 'db-legend-item');
    l.appendChild(dbEl('span', 'db-legend-swatch ' + cls));
    l.appendChild(dbEl('span', null, text));
    if (title) l.title = title;
    legend.appendChild(l);
  };
  mkLeg('is-real', 'Avancement réel');
  if (planning) mkLeg('is-theory', 'Trajectoire théorique');
  if (showTarget) {
    mkLeg('is-target', 'Rythme à tenir — ' + formatPct(Math.round(target.perWeek * 10) / 10)
      + ' %/semaine jusqu\'au ' + fmtFR(target.end),
      'Ce qu\'il faut produire chaque semaine pour finir à la date objectif.');
  }
  if (showEta) {
    mkLeg('is-eta', 'Rythme actuel — fin projetée le ' + fmtFR(velocity.etaISO),
      'Prolongation du rythme observé depuis le premier relevé (' + fmtFR(velocity.fromISO)
      + '), soit ' + velocity.windowWorkDays + ' jours ouvrés.');
  }
  if (markers.length) mkLeg('is-marker', 'Fin des bâtiments', markers.map(m => m.name + ' : ' + fmtFR(m.iso)).join(' · '));
  mkLeg('is-today', 'Aujourd\'hui');

  if (target && !target.done && target.perWeek == null) {
    notes.appendChild(dbEl('p', 'db-note is-warn', target.lastDay
      ? 'Dernier jour du planning : il reste ' + formatPct(Math.round(target.remaining * 10) / 10) + ' % à réaliser.'
      : 'La date de fin est dépassée : il reste ' + formatPct(Math.round(target.remaining * 10) / 10)
        + ' % à réaliser. Repoussez l\'échéance pour retrouver un rythme à tenir.'));
  }
  if (keys.length < 2) {
    notes.appendChild(dbEl('p', 'db-note',
      'Un seul point pour l\'instant : la courbe se remplira au fil des saisies d\'avancement.'));
  }
  if (W > scroll.clientWidth + 2) {
    notes.appendChild(dbEl('p', 'db-note', 'Échelle dilatée : faites défiler la courbe horizontalement.'));
  }
}

// ----- 3. Avancement par bâtiment -----
function buildDbBuildings(model) {
  const card = dbCard('Par bâtiment', 'écart à la moyenne du projet');
  const list = dbEl('div', 'db-rows');
  const sorted = model.buildings.slice().sort((a, b) => b.pct - a.pct);
  for (const b of sorted) {
    const row = dbEl('div', 'db-row');
    const head = dbEl('div', 'db-row-head');
    head.appendChild(dbEl('span', 'db-row-name', b.name));
    head.appendChild(dbEl('span', 'db-row-pct', formatPct(Math.round(b.pct * 10) / 10) + ' %'));
    row.appendChild(head);
    row.appendChild(dbBar(b.pct));
    const delta = b.pct - model.pct;
    const sub = dbEl('div', 'db-row-sub');
    sub.appendChild(dbEl('span', null, formatHours(b.hDone) + ' / ' + formatHours(b.hBudget)
      + (model.weighting === 'heures' ? ' h' : '') + ' · ' + b.zones + ' zone' + (b.zones > 1 ? 's' : '')));
    if (Math.abs(delta) >= 0.05) {
      sub.appendChild(dbEl('span', 'db-delta ' + (delta >= 0 ? 'is-pos' : 'is-neg'),
        (delta >= 0 ? '+' : '−') + formatPct(Math.abs(Math.round(delta * 10) / 10)) + ' pts'));
    }
    row.appendChild(sub);
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

// ----- 4. Matrice bâtiment × ouvrage -----
function buildDbMatrix(model, scope) {
  const base = getRecapBaseline();
  const card = dbCard('Matrice ' + (scope ? 'zones' : 'bâtiments') + ' × ouvrages',
    'variation ' + (base.period.days == null ? 'depuis le début' : 'sur ' + base.period.days + ' j'));
  const rows = scope
    ? model.zones.slice().sort((a, b) => a.label.localeCompare(b.label, 'fr')).map(z => ({ id: z.id, name: z.label.split(' › ').slice(1).join(' › ') || z.label }))
    : model.buildings.map(b => ({ id: b.id, name: b.name }));
  const cols = model.ouvrages.slice(0, 12);
  if (!rows.length || !cols.length) {
    card.appendChild(dbEl('p', 'db-empty', 'Pas assez de données pour croiser les axes.'));
    return card;
  }
  // En mode « un bâtiment », on recalcule les cellules à la maille zone.
  const cellFor = (rowId, setupId) => {
    if (!scope) {
      const c = (model.matrix[rowId] || {})[setupId];
      return c && c.h > 0 ? (c.d / c.h) * 100 : (c ? null : null);
    }
    const ouv = getZoneOuvrages(rowId).find(o => o.setup.id === setupId);
    if (!ouv) return null;
    return getOuvrageRawProgress(rowId, ouv.setup);
  };
  const wrap = dbEl('div', 'db-matrix-wrap');
  const table = dbEl('table', 'db-matrix');
  // Largeur utile : la table s'étire jusqu'à ce plafond puis se centre. Au-delà
  // les cellules deviendraient des bandeaux ; en deçà, le conteneur défile.
  const LABEL_W = 200, CELL_MAX = 74, DELTA_W = 62;
  table.style.maxWidth = (LABEL_W + cols.length * CELL_MAX + DELTA_W) + 'px';
  const thead = dbEl('thead');
  const trh = dbEl('tr');
  trh.appendChild(dbEl('th', 'db-matrix-corner', scope ? 'Zone' : 'Bâtiment'));
  for (const c of cols) {
    const th = dbEl('th', 'db-matrix-col');
    th.appendChild(dbEl('span', null, c.name));
    th.title = c.name + ' — ' + formatPct(Math.round(c.weight * 10) / 10) + ' % du projet';
    trh.appendChild(th);
  }
  const thDelta = dbEl('th', 'db-matrix-delta-col');
  thDelta.appendChild(dbEl('span', null, 'Δ'));
  thDelta.title = base.period.days == null
    ? 'Avancement gagné depuis le début du chantier'
    : 'Points d\'avancement gagnés sur les ' + base.period.days + ' derniers jours';
  trh.appendChild(thDelta);
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = dbEl('tbody');
  for (const r of rows) {
    const tr = dbEl('tr');
    tr.appendChild(dbEl('th', 'db-matrix-row', r.name));
    for (const c of cols) {
      const v = cellFor(r.id, c.setupId);
      const td = dbEl('td', 'db-matrix-cell');
      if (v == null) {
        td.classList.add('is-na');
        td.textContent = '·';
        td.title = r.name + ' — ' + c.name + ' : ouvrage non affecté';
      } else {
        // Teinte pleine dont l'opacité suit l'avancement : la valeur reste
        // lisible à 5 % comme à 100 %, contrairement à un remplissage partiel.
        td.classList.add(dbPctClass(v), 'is-clickable');
        td.textContent = Math.round(v) + '';
        td.title = r.name + ' — ' + c.name + ' : ' + formatPct(Math.round(v * 10) / 10) + ' %'
          + '\nCliquer pour ouvrir la saisie d\'avancement sur cet ouvrage';
        td.style.background = dbCellTint(v);
        td.tabIndex = 0;
        td.setAttribute('role', 'button');
        td.setAttribute('aria-label', r.name + ' — ' + c.name + ' : ouvrir la saisie d\'avancement');
        const go = () => openAvancementAt(r.id, c.setupId, !scope);
        td.addEventListener('click', go);
        td.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
        });
      }
      tr.appendChild(td);
    }
    // Variation de la ligne sur la période : lue dans l'historique.
    const dPct = matrixRowDelta(r.id, base, model);
    const tdD = dbEl('td', 'db-matrix-delta');
    if (dPct == null) {
      tdD.classList.add('is-na');
      tdD.textContent = '—';
      tdD.title = 'Pas d\'historique sur cette période';
    } else {
      tdD.classList.add(dPct > 0.05 ? 'is-pos' : (dPct < -0.05 ? 'is-neg' : 'is-flat'));
      tdD.textContent = (dPct > 0.05 ? '+' : (dPct < -0.05 ? '−' : '')) + formatPct(Math.abs(Math.round(dPct * 10) / 10));
      tdD.title = r.name + ' : ' + (dPct >= 0 ? '+' : '−') + formatPct(Math.abs(Math.round(dPct * 10) / 10))
        + ' points ' + (base.period.days == null ? 'depuis le début' : 'sur ' + base.period.days + ' j');
    }
    tr.appendChild(tdD);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  card.appendChild(wrap);
  if (model.ouvrages.length > cols.length) {
    card.appendChild(dbEl('p', 'db-note', 'Les ' + cols.length + ' ouvrages les plus lourds sont affichés (sur ' + model.ouvrages.length + ').'));
  }
  return card;
}

// Variation d'avancement d'une ligne de matrice (bâtiment ou zone) sur la
// période choisie. « Depuis le début » vaut l'avancement courant, le chantier
// ayant démarré à zéro ; sinon on lit le détail archivé.
function matrixRowDelta(rowId, base, model) {
  const cur = matrixRowPct(rowId, model);
  if (cur == null) return null;
  if (base.zero) return cur;               // tout est parti de 0 %
  let before = base.det && base.det.z ? base.det.z[rowId] : undefined;
  if (typeof before !== 'number' && base.zones) before = base.zones[rowId];
  if (typeof before !== 'number') return null;
  return cur - before;
}
function matrixRowPct(rowId, model) {
  const b = model.buildings.find(x => x.id === rowId);
  if (b) return b.pct;
  const z = model.zones.find(x => x.id === rowId);
  return z ? z.pct : null;
}
// Ouvre la saisie d'avancement sur la zone visée, en mettant en évidence
// l'ouvrage cliqué dans la matrice. `isBuilding` : on descend alors sur la
// première zone porteuse de cet ouvrage.
function openAvancementAt(rowId, setupId, isBuilding) {
  let zoneId = rowId;
  if (isBuilding) {
    zoneId = getDescendantZones(rowId).find(zid => getZoneOuvrages(zid).some(o => o.setup.id === setupId)) || null;
    if (!zoneId) { showToast('Aucune zone de ce bâtiment ne porte cet ouvrage', 'error'); return; }
  }
  state.avancementZoneId = zoneId;
  save();
  switchSubPage('avancement', 'fiche');
  renderAvancement();
  // Mise en évidence de la section de l'ouvrage, puis défilement dessus.
  requestAnimationFrame(() => {
    const headers = [...document.querySelectorAll('#progresslist .progress-section-header')];
    const setup = state.taskSetups.find(s2 => s2.id === setupId);
    const wanted = setup ? (setup.name || '(ouvrage sans nom)') : null;
    const target = headers.find(h => (h.querySelector('.progress-section-name') || {}).textContent === wanted);
    if (!target) return;
    target.classList.add('is-flash');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => target.classList.remove('is-flash'), 2200);
  });
}

// ----- 5. Détail par ouvrage et par tâche -----
// Tri, recherche et dépliage global en tête de carte : avec vingt ouvrages,
// retrouver une tâche à la main devient vite pénible. La colonne « Δ » donne
// les heures acquises sur la période choisie — « qui a bougé cette semaine ».
const DB_OUVRAGE_SORTS = [
  { key: 'poids',  label: 'Poids',      cmp: (a, b) => b.hBudget - a.hBudget },
  { key: 'reste',  label: 'Reste',      cmp: (a, b) => (b.hBudget - b.hDone) - (a.hBudget - a.hDone) },
  { key: 'pct',    label: 'Avancement', cmp: (a, b) => a.pct - b.pct },
  { key: 'nom',    label: 'Nom',        cmp: (a, b) => (a.name || '').localeCompare(b.name || '', 'fr') },
];
let _dbOuvrageSort = 'poids';
let _dbOuvrageQuery = '';
let _dbOuvrageOpen = false;

function buildDbOuvrages(model) {
  const base = getRecapBaseline();
  const card = dbCard('Récapitulatif par tâche');
  const tools = dbEl('div', 'db-ouvrages-tools');

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'db-ouvrage-search';
  search.placeholder = 'Filtrer un ouvrage ou une tâche…';
  search.value = _dbOuvrageQuery;
  search.addEventListener('input', () => { _dbOuvrageQuery = search.value; refresh(true); });
  tools.appendChild(search);

  const sortBox = dbEl('div', 'db-ouvrage-sorts');
  sortBox.appendChild(dbEl('span', 'db-ouvrage-sorts-label', 'Trier par'));
  for (const so of DB_OUVRAGE_SORTS) {
    const b = dbEl('button', 'db-ouvrage-sort' + (_dbOuvrageSort === so.key ? ' is-on' : ''), so.label);
    b.type = 'button';
    b.addEventListener('click', () => { _dbOuvrageSort = so.key; refresh(); });
    sortBox.appendChild(b);
  }
  tools.appendChild(sortBox);

  const toggle = dbEl('button', 'db-ouvrage-expand', _dbOuvrageOpen ? 'Tout replier' : 'Tout déplier');
  toggle.type = 'button';
  toggle.addEventListener('click', () => { _dbOuvrageOpen = !_dbOuvrageOpen; refresh(); });
  tools.appendChild(toggle);
  card.appendChild(tools);

  const list = dbEl('div', 'db-ouvrages');
  card.appendChild(list);
  const note = dbEl('p', 'db-empty');
  note.hidden = true;
  card.appendChild(note);

  // Redessine la liste sans reconstruire la carte : la recherche garde son
  // curseur et l'état de dépliage reste maîtrisé.
  function refresh(keepFocus) {
    list.innerHTML = '';
    const q = _dbOuvrageQuery.trim().toLowerCase();
    const sort = DB_OUVRAGE_SORTS.find(x => x.key === _dbOuvrageSort) || DB_OUVRAGE_SORTS[0];
    const matches = (o) => {
      if (!q) return null;                       // pas de filtre
      if ((o.name || '').toLowerCase().includes(q)) return o.tasks;
      const hit = o.tasks.filter(t => (t.name || '').toLowerCase().includes(q));
      return hit.length ? hit : false;
    };
    let shown = 0;
    for (const o of model.ouvrages.slice().sort(sort.cmp)) {
      const m = matches(o);
      if (m === false) continue;
      shown++;
      list.appendChild(buildDbOuvrageBox(o, model, base, m || o.tasks, !!q || _dbOuvrageOpen));
    }
    note.hidden = shown > 0;
    if (!shown) note.textContent = 'Aucun ouvrage ni tâche ne correspond à « ' + _dbOuvrageQuery.trim() + ' ».';
    toggle.textContent = _dbOuvrageOpen ? 'Tout replier' : 'Tout déplier';
    for (const b of sortBox.querySelectorAll('.db-ouvrage-sort')) {
      b.classList.toggle('is-on', b.textContent === sort.label);
    }
    if (keepFocus) search.focus();
  }
  refresh();
  return card;
}

// Heures acquises par un ouvrage / une tâche sur la période de comparaison.
// Renvoie null quand l'historique ne remonte pas assez loin.
function dbTaskDelta(base, setupId, taskId, currentHDone) {
  if (base.zero) return currentHDone;          // depuis le début : tout est gagné
  if (!base.det || !base.det.o) return null;
  const o = base.det.o[setupId];
  if (!o) return null;
  if (!taskId) return currentHDone - (Number(o.d) || 0);
  const before = o.t ? o.t[taskId] : undefined;
  if (typeof before !== 'number') return null;
  return currentHDone - before;
}
function dbDeltaCell(cls, delta, base) {
  const td = dbEl('td', cls);
  if (delta == null) {
    td.classList.add('is-na');
    td.textContent = '—';
    td.title = 'Pas d\'historique sur cette période';
    return td;
  }
  const r = Math.round(delta * 10) / 10;
  td.classList.add(r > 0.05 ? 'is-pos' : (r < -0.05 ? 'is-neg' : 'is-flat'));
  td.textContent = (r > 0.05 ? '+' : (r < -0.05 ? '−' : '')) + formatHours(Math.abs(r)) + ' h';
  td.title = 'Heures acquises ' + (base.period.days == null ? 'depuis le début' : 'sur les ' + base.period.days + ' derniers jours');
  return td;
}

function buildDbOuvrageBox(o, model, base, tasks, open) {
  const box = dbEl('details', 'db-ouvrage');
  if (open) box.open = true;
  const sum = dbEl('summary', 'db-ouvrage-head');
  const idBox = dbEl('div', 'db-ouvrage-id');
  idBox.appendChild(dbEl('span', 'db-ouvrage-name', o.name));
  idBox.appendChild(dbEl('span', 'db-ouvrage-meta',
    formatQty(o.qtyTotal) + ' ' + o.unit
    + (model.weighting === 'heures'
      ? ' · ' + formatHours(o.hDone) + ' / ' + formatHours(o.hBudget) + ' h'
        + ' · reste ' + formatHours(Math.max(0, o.hBudget - o.hDone)) + ' h'
      : ' · ' + formatQty(o.qtyDone) + ' ' + o.unit + ' réalisés'
        + ' · reste ' + formatQty(o.qtyRemaining) + ' ' + o.unit)));
  sum.appendChild(idBox);
  const stats = dbEl('div', 'db-ouvrage-stats');
  const oDelta = dbTaskDelta(base, o.setupId, null, o.hDone);
  if (oDelta != null && Math.abs(oDelta) >= 0.05) {
    const d = dbEl('span', 'db-ouvrage-delta ' + (oDelta > 0 ? 'is-pos' : 'is-neg'),
      (oDelta > 0 ? '+' : '−') + formatHours(Math.abs(oDelta)) + ' h');
    d.title = 'Heures acquises ' + (base.period.days == null ? 'depuis le début' : 'sur ' + base.period.days + ' j');
    stats.appendChild(d);
  }
  const w = dbEl('span', 'db-ouvrage-weight', formatPct(Math.round(o.weight * 10) / 10) + ' % du projet');
  w.title = 'Poids de cet ouvrage dans l\'avancement global';
  stats.appendChild(w);
  stats.appendChild(dbEl('span', 'db-ouvrage-pct ' + dbPctClass(o.pct), formatPct(Math.round(o.pct * 10) / 10) + ' %'));
  sum.appendChild(stats);
  box.appendChild(sum);
  box.appendChild(dbBar(o.pct));

  // Récapitulatif par tâche : quantité totale / réalisée, puis heures
  // budgétées / réalisées / restantes. Les quantités d'un même ouvrage se
  // recouvrent (chaque tâche traite les mêmes m²) : seules les colonnes
  // d'heures sont additionnables, et ce sont elles qu'on totalise.
  const tbl = dbEl('table', 'db-tasks');
  const thead = dbEl('thead');
  const trh = dbEl('tr');
  const dLabel = 'Δ ' + (base.period.days == null ? 'total' : base.period.days + ' j');
  const COLS = [
    ['Tâche', ''],
    ['Qté totale', 'num'],
    ['Qté réalisée', 'num'],
    ['H. budget', 'num is-hcol'],
    ['H. réalisées', 'num'],
    ['H. restantes', 'num'],
    [dLabel, 'num db-delta-col'],
    ['%', 'num'],
  ];
  for (const [label, cls] of COLS) trh.appendChild(dbEl('th', cls, label));
  thead.appendChild(trh);
  tbl.appendChild(thead);
  const tbody = dbEl('tbody');
  const noHours = model.weighting !== 'heures';
  for (const t of tasks) {
    const tr = dbEl('tr', t.excluded ? 'is-excluded' : (t.pct >= 99.95 ? 'is-done' : ''));
    const name = dbEl('td', 'db-task-name');
    name.appendChild(dbEl('span', null, t.name));
    if (t.excluded) name.appendChild(dbEl('span', 'db-task-tag', 'hors ratio'));
    tr.appendChild(name);
    tr.appendChild(dbEl('td', 'num', formatQty(t.qtyTotal) + ' ' + o.unit));
    tr.appendChild(dbEl('td', 'num', formatQty(t.qtyDone) + ' ' + o.unit));
    const h = (v) => (t.excluded || noHours) ? '—' : formatHours(v) + ' h';
    tr.appendChild(dbEl('td', 'num is-hcol', h(t.hBudget)));
    tr.appendChild(dbEl('td', 'num', h(t.hDone)));
    tr.appendChild(dbEl('td', 'num db-task-rest', h(t.hRemaining)));
    tr.appendChild(dbDeltaCell('num db-task-delta',
      (t.excluded || noHours) ? null : dbTaskDelta(base, o.setupId, t.id, t.hDone), base));
    tr.appendChild(dbEl('td', 'num db-task-pct ' + dbPctClass(t.pct), formatPct(Math.round(t.pct * 10) / 10) + ' %'));
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  if (!noHours) {
    const tfoot = dbEl('tfoot');
    const trf = dbEl('tr');
    trf.appendChild(dbEl('td', 'db-task-name', 'Total ouvrage'));
    trf.appendChild(dbEl('td', 'num', formatQty(o.qtyTotal) + ' ' + o.unit));
    // « éq. » : les quantités des tâches se recouvrent, leur somme n'a pas
    // de sens. On affiche la quantité ÉQUIVALENTE réalisée de l'ouvrage,
    // c'est-à-dire la quantité totale ramenée à son avancement en heures.
    const eq = dbEl('td', 'num', formatQty(o.qtyDone) + ' ' + o.unit + ' éq.');
    eq.title = 'Quantité équivalente réalisée : ' + formatQty(o.qtyTotal) + ' ' + o.unit
      + ' × ' + formatPct(Math.round(o.pct * 10) / 10) + ' % d\'avancement. '
      + 'Les quantités des tâches portent toutes sur le même métré : elles ne s\'additionnent pas.';
    trf.appendChild(eq);
    trf.appendChild(dbEl('td', 'num is-hcol', formatHours(o.hBudget) + ' h'));
    trf.appendChild(dbEl('td', 'num', formatHours(o.hDone) + ' h'));
    trf.appendChild(dbEl('td', 'num db-task-rest', formatHours(Math.max(0, o.hBudget - o.hDone)) + ' h'));
    trf.appendChild(dbDeltaCell('num db-task-delta', oDelta, base));
    trf.appendChild(dbEl('td', 'num db-task-pct ' + dbPctClass(o.pct), formatPct(Math.round(o.pct * 10) / 10) + ' %'));
    tfoot.appendChild(trf);
    tbl.appendChild(tfoot);
  }
  const tw = dbEl('div', 'db-tasks-wrap');
  tw.appendChild(tbl);
  box.appendChild(tw);
  return box;
}

// ----- 6. Points d'attention -----
function buildDbFocus(model, planning) {
  const card = dbCard('Points d\'attention');
  const cols = dbEl('div', 'db-focus');

  // a) Zones les moins avancées à fort volume
  const heavy = model.zones
    .filter(z => z.hBudget > 0 && z.pct < 99.95)
    .sort((a, b) => (b.hBudget * (100 - b.pct)) - (a.hBudget * (100 - a.pct)))
    .slice(0, 6);
  const c1 = dbEl('div', 'db-focus-col');
  c1.appendChild(dbEl('div', 'db-focus-title', 'Reste à faire le plus lourd'));
  if (!heavy.length) c1.appendChild(dbEl('p', 'db-empty', 'Tout est terminé dans ce périmètre.'));
  for (const z of heavy) {
    const it = dbEl('div', 'db-focus-item');
    it.appendChild(dbEl('span', 'db-focus-name', z.label));
    it.appendChild(dbEl('span', 'db-focus-val',
      formatHours(z.hBudget - z.hDone) + (model.weighting === 'heures' ? ' h' : '') + ' · ' + formatPct(Math.round(z.pct)) + ' %'));
    c1.appendChild(it);
  }
  cols.appendChild(c1);

  // b) Zones sans mise à jour récente
  const c2 = dbEl('div', 'db-focus-col');
  c2.appendChild(dbEl('div', 'db-focus-title', 'Sans mise à jour depuis ' + AVANCEMENT_STALE_DAYS + ' jours'));
  const stale = model.issues.stale.slice(0, 6);
  if (!stale.length) c2.appendChild(dbEl('p', 'db-empty', 'Toutes les zones en cours ont été mises à jour récemment.'));
  for (const s of stale) {
    const it = dbEl('div', 'db-focus-item');
    it.appendChild(dbEl('span', 'db-focus-name', s.label));
    it.appendChild(dbEl('span', 'db-focus-val is-warn',
      (s.days == null ? 'jamais saisie' : s.days + ' j') + ' · ' + formatPct(Math.round(s.pct)) + ' %'));
    c2.appendChild(it);
  }
  cols.appendChild(c2);

  // c) Qualité des données — ce qui fausse le chiffre global
  const c3 = dbEl('div', 'db-focus-col');
  c3.appendChild(dbEl('div', 'db-focus-title', 'Qualité des données'));
  const notes = [];
  if (model.weighting !== 'heures') {
    notes.push(['is-warn', 'Aucun ratio de production saisi : l\'avancement est pondéré par ' +
      (model.weighting === 'quantites' ? 'les quantités' : 'le nombre de tâches') + '.']);
  }
  const noRatio = [...new Set(model.issues.noRatio.map(i => i.name))];
  if (noRatio.length) notes.push(['is-warn', noRatio.length + ' ouvrage(s) sans ratio ne pèsent pas dans le global : ' + noRatio.slice(0, 4).join(', ')]);
  const noQty = [...new Set(model.issues.noQty.map(i => i.setupName))];
  if (noQty.length) notes.push(['is-warn', model.issues.noQty.length + ' affectation(s) sans quantité (' + noQty.slice(0, 4).join(', ') + ').']);
  if (!planning) notes.push(['is-warn', 'Dates de chantier non renseignées : ni écart au planning, ni trajectoire théorique.']);
  if (!notes.length) notes.push(['is-ok', 'Ratios, quantités et dates sont renseignés : le chiffre global est pleinement pondéré.']);
  for (const [cls, txt] of notes) {
    const it = dbEl('div', 'db-focus-note ' + cls);
    it.textContent = txt;
    c3.appendChild(it);
  }
  const counts = dbEl('div', 'db-focus-counts');
  counts.textContent = model.counts.zones + ' zones porteuses · ' + model.counts.ouvrages + ' ouvrages · '
    + model.counts.taches + ' tâches · ' + model.counts.zonesDone + ' zones terminées · '
    + model.counts.zonesToStart + ' non commencées';
  c3.appendChild(counts);
  cols.appendChild(c3);

  card.appendChild(cols);
  return card;
}


// ---------- Administratif → Sécurité (documents par entreprise) ----------
function getCompanyDocs(cid) { return state.adminDocs[cid] || []; }
function isSecurityComplete(cid) {
  const docs = getCompanyDocs(cid);
  if (docs.length === 0) return false;
  return docs.every(d => !!d.receivedAt);
}
function addAdminDoc(companyId) {
  if (!state.adminDocs[companyId]) state.adminDocs[companyId] = [];
  state.adminDocs[companyId].push({ id: uid(), name: '', receivedAt: null });
  save();
  renderSecurite();
}
function removeAdminDoc(companyId, docId) {
  const list = state.adminDocs[companyId];
  if (!list) return;
  state.adminDocs[companyId] = list.filter(d => d.id !== docId);
  if (state.adminDocs[companyId].length === 0) delete state.adminDocs[companyId];
  save();
  renderSecurite();
}
function setAdminDocName(companyId, docId, name) {
  const doc = (state.adminDocs[companyId] || []).find(d => d.id === docId);
  if (!doc) return;
  doc.name = name;
  save();
}
function setAdminDocDate(companyId, docId, dateStr) {
  const doc = (state.adminDocs[companyId] || []).find(d => d.id === docId);
  if (!doc) return;
  doc.receivedAt = dateStr || null;
  save();
  renderSecurite();
}

function renderSecurite() {
  const list = document.getElementById('securitelist');
  const empty = document.getElementById('securiteempty');
  if (!list || !empty) return;
  list.innerHTML = '';
  empty.classList.remove('show');

  if (state.companies.length === 0) {
    empty.innerHTML = '<p>Aucune entreprise enregistrée.</p><p class="hint">Ajoute des entreprises dans <strong>Données → Entreprises</strong>.</p>';
    empty.classList.add('show');
    return;
  }

  for (const company of state.companies) {
    const complete = isSecurityComplete(company.id);
    const card = document.createElement('div');
    card.className = 'admin-company' + (complete ? ' is-complete' : '');

    const header = document.createElement('div');
    header.className = 'admin-company-header';
    const name = document.createElement('span');
    name.className = 'admin-company-name';
    name.textContent = company.name || '(sans nom)';
    const addBtn = document.createElement('button');
    addBtn.className = 'admin-add-btn';
    addBtn.setAttribute('aria-label', 'Ajouter un document');
    addBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z"/></svg>';
    addBtn.addEventListener('click', () => addAdminDoc(company.id));
    header.append(name, addBtn);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'admin-company-body';
    const docs = getCompanyDocs(company.id);
    if (docs.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'admin-empty';
      hint.textContent = 'Aucun document. Appuyez sur + pour en ajouter.';
      body.appendChild(hint);
    } else {
      for (const doc of docs) {
        body.appendChild(buildAdminDocRow(company.id, doc));
      }
    }
    card.appendChild(body);
    list.appendChild(card);
  }
}

function buildAdminDocRow(companyId, doc) {
  const row = document.createElement('div');
  row.className = 'admin-doc-row' + (doc.receivedAt ? ' is-received' : '');

  const nameInput = document.createElement('input');
  nameInput.className = 'admin-doc-name';
  nameInput.type = 'text';
  nameInput.placeholder = 'Nom du document';
  nameInput.value = doc.name || '';
  nameInput.addEventListener('input', () => setAdminDocName(companyId, doc.id, nameInput.value));

  const dateInput = document.createElement('input');
  dateInput.className = 'admin-doc-date';
  dateInput.type = 'date';
  dateInput.setAttribute('aria-label', 'Date de réception');
  dateInput.value = doc.receivedAt || '';
  dateInput.addEventListener('change', () => setAdminDocDate(companyId, doc.id, dateInput.value));

  const delBtn = document.createElement('button');
  delBtn.className = 'admin-doc-delete';
  delBtn.setAttribute('aria-label', 'Supprimer le document');
  delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>';
  delBtn.addEventListener('click', () => removeAdminDoc(companyId, doc.id));

  row.append(nameInput, dateInput, delBtn);
  return row;
}

// ---------- Administratif → eCheckIn (ouvriers par entreprise) ----------
function getCompanyWorkers(cid) { return state.workers.filter(w => w.companyId === cid); }
const DOC_TYPES = ['validation', 'echeance', 'caces'];
const DOC_TYPE_LABELS = { validation: 'Validation', echeance: 'Échéance', caces: 'CACES' };
const DOC_SCOPES = ['salarie', 'interim', 'both'];
const DOC_SCOPE_LABELS = { salarie: 'Salarié', interim: 'Intérim', both: 'Tous' };

function getDocs() { return Array.isArray(state.docs) ? state.docs : []; }
function getDocIds() { return getDocs().map(d => d.id); }
function getDoc(id) { return getDocs().find(d => d.id === id) || null; }
// IDs des docs qui s'appliquent à un ouvrier selon son type d'emploi
function getApplicableDocIds(employmentType) {
  return getDocs()
    .filter(d => !d.scope || d.scope === 'both' || d.scope === employmentType)
    .map(d => d.id);
}
function defaultDocLabel(id) {
  // Pour les anciens IDs « docN », on renvoie « Doc N »
  const m = /^doc(\d+)$/.exec(id);
  return m ? `Doc ${m[1]}` : id;
}
function getDocLabel(id) {
  const d = getDoc(id);
  const v = d?.label;
  return (v && v.trim()) ? v : defaultDocLabel(id);
}
function getDocType(id) {
  const t = getDoc(id)?.type;
  return DOC_TYPES.includes(t) ? t : 'echeance';
}
function getDocScope(id) {
  const s = getDoc(id)?.scope;
  return DOC_SCOPES.includes(s) ? s : 'both';
}
function isDocRequired(id) {
  // Défaut : obligatoire (le doc compte pour le pire-statut de l'ouvrier
  // et de l'entreprise). Mettre `required: false` dans state.docs pour
  // afficher la couleur de la chip sans qu'elle influence l'agrégation.
  const d = getDoc(id);
  return d ? d.required !== false : true;
}
// Récupère la valeur d'un document en l'adaptant au type courant.
// Évite que le passage d'un type à l'autre n'affiche une valeur incohérente.
function getDocValue(workerId, field) {
  const raw = state.workerDocs[workerId]?.[field];
  const type = getDocType(field);
  if (type === 'validation') return (raw === 'conforme' || raw === 'non-conforme') ? raw : null;
  if (type === 'caces') return Array.isArray(raw) ? raw : [];
  // echeance (défaut)
  return (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) ? raw : null;
}
// Statut d'un document, normalisé à 'valid' | 'warning' | 'danger' | 'expired' | 'none'
function getDocStatus(workerId, field) {
  const type = getDocType(field);
  const value = getDocValue(workerId, field);
  if (type === 'validation') {
    if (value === 'conforme')     return 'valid';
    if (value === 'non-conforme') return 'expired';
    return 'none';
  }
  if (type === 'caces') {
    if (!value || value.length === 0) return 'none';
    let worstIdx = -1;
    for (const c of value) {
      const s = expiryStatus(c.expiresAt);
      const idx = STATUS_WORST_ORDER.indexOf(s);
      if (idx > worstIdx) worstIdx = idx;
    }
    return worstIdx >= 0 ? STATUS_WORST_ORDER[worstIdx] : 'none';
  }
  return expiryStatus(value);
}
// Pire statut parmi les 4 documents d'un ouvrier (expired > danger > warning > valid).
// Renvoie null si aucun document n'est documenté (tous "none").
const STATUS_WORST_ORDER = ['valid', 'warning', 'danger', 'expired'];
function getWorkerWorstStatus(workerId) {
  const empType = getWorkerDocs(workerId).employmentType;
  let worstIdx = -1;
  // Seuls les documents marqués « obligatoires » entrent dans le pire
  // statut. Un doc non obligatoire garde sa couleur sur sa chip mais
  // n'influe ni sur l'étiquette ouvrier ni sur l'étiquette entreprise.
  for (const k of getApplicableDocIds(empType)) {
    if (!isDocRequired(k)) continue;
    const s = getDocStatus(workerId, k);
    const idx = STATUS_WORST_ORDER.indexOf(s);
    if (idx > worstIdx) worstIdx = idx;
  }
  return worstIdx >= 0 ? STATUS_WORST_ORDER[worstIdx] : null;
}

function getWorkerDocs(wid) {
  const raw = state.workerDocs[wid] || {};
  // Migration : ancien modèle (booléens) ignoré, + champ employmentType
  // ajouté ultérieurement. Les valeurs des 4 docs sont laissées brutes
  // (peuvent être : string YYYY-MM-DD pour échéance, 'conforme' ou
  // 'non-conforme' pour validation, array pour CACES).
  const out = {
    onSite: !!raw.onSite,
    employmentType: raw.employmentType === 'interim' ? 'interim' : 'salarie'
  };
  for (const k of getDocIds()) out[k] = raw[k] ?? null;
  return out;
}
// Pire statut parmi les ouvriers PRÉSENTS d'une entreprise (même règle
// que pour la coloration de l'ouvrier : expired > danger > warning >
// valid, et 'none' ne contribue pas). null si aucun ouvrier présent
// ou si aucun n'a de date saisie.
function getCompanyWorstStatus(cid) {
  const presentWorkers = getCompanyWorkers(cid)
    .filter(w => getWorkerDocs(w.id).onSite);
  if (presentWorkers.length === 0) return null;
  let worstIdx = -1;
  for (const w of presentWorkers) {
    const s = getWorkerWorstStatus(w.id);
    const idx = STATUS_WORST_ORDER.indexOf(s);
    if (idx > worstIdx) worstIdx = idx;
  }
  return worstIdx >= 0 ? STATUS_WORST_ORDER[worstIdx] : null;
}
function addWorker(companyId) {
  state.workers.push({ id: uid(), companyId, name: '' });
  save();
  renderECheckIn();
}
function removeWorker(workerId) {
  const w = state.workers.find(w => w.id === workerId);
  if (!w) return;
  if (!confirm(`Supprimer l'ouvrier « ${w.name || 'sans nom'} » ?`)) return;
  state.workers = state.workers.filter(w => w.id !== workerId);
  delete state.workerDocs[workerId];
  save();
  renderECheckIn();
}
function setWorkerName(workerId, name) {
  const w = state.workers.find(w => w.id === workerId);
  if (!w) return;
  w.name = name;
  save();
}
function ensureWorkerDocsBag(workerId) {
  if (!state.workerDocs[workerId]) {
    state.workerDocs[workerId] = {
      onSite: false, employmentType: 'salarie',
      doc1: null, doc2: null, doc3: null, doc4: null
    };
  }
  if (!state.workerDocs[workerId].employmentType) {
    state.workerDocs[workerId].employmentType = 'salarie';
  }
  return state.workerDocs[workerId];
}
function toggleWorkerPresence(workerId) {
  const bag = ensureWorkerDocsBag(workerId);
  bag.onSite = !bag.onSite;
  save();
  refreshWorkerPresenceChip(workerId);
  refreshWorkerWorstStatus(workerId);
  refreshCompanyWorstStatus(workerId);
}
function toggleEmploymentType(workerId) {
  const bag = ensureWorkerDocsBag(workerId);
  bag.employmentType = bag.employmentType === 'interim' ? 'salarie' : 'interim';
  save();
  refreshWorkerTypeButton(workerId);
  // Les chips visibles dépendent du type d'emploi (scope) → reconstruire
  // la grille de chips de l'ouvrier (sans toucher au reste de la carte).
  refreshWorkerDocGrid(workerId);
  refreshWorkerWorstStatus(workerId);
  refreshCompanyWorstStatus(workerId);
}
// Reconstruit en place uniquement la grille de chips d'un ouvrier
function refreshWorkerDocGrid(workerId) {
  const card = document.querySelector(`.worker-card[data-worker-id="${workerId}"]`);
  if (!card) return;
  const grid = card.querySelector('.ec-doc-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const empType = getWorkerDocs(workerId).employmentType;
  for (const k of getApplicableDocIds(empType)) {
    grid.appendChild(buildECheckInDocChip(workerId, k, getDocLabel(k)));
  }
}
// Met à jour la valeur d'un doc (toutes types confondus) puis rafraîchit
// uniquement les éléments concernés — surtout pas le DOM entier : sur
// Safari iOS, un re-render synchrone détruirait l'input date pendant
// que le picker l'utilise, le faisant se fermer aussitôt.
function setWorkerDocValue(workerId, field, value) {
  const bag = ensureWorkerDocsBag(workerId);
  bag[field] = value;
  save();
  refreshDocChip(workerId, field);
  refreshWorkerWorstStatus(workerId);
  refreshCompanyWorstStatus(workerId);
}
// Alias historique (échéance) pour ne pas casser les callers existants
function setWorkerDocDate(workerId, field, dateStr) {
  setWorkerDocValue(workerId, field, dateStr || null);
}

function refreshDocChip(workerId, field) {
  const chip = document.querySelector(
    `.worker-card[data-worker-id="${workerId}"] .ec-doc[data-doc-field="${field}"]`
  );
  if (!chip) return;
  const type = getDocType(field);
  const status = getDocStatus(workerId, field);
  const value = getDocValue(workerId, field);

  // Classe de statut + de type (le sélecteur data-doc-field reste stable)
  chip.className = `ec-doc status-${status} doctype-${type}`;
  chip.setAttribute('data-doc-type', type);

  const dateEl = chip.querySelector('.ec-doc-date');
  if (dateEl) dateEl.textContent = formatDocChipValue(workerId, field);

  if (type === 'echeance') {
    // Synchronise la valeur de l'input sans le détruire (l'input survit
    // au refresh pour ne pas casser le picker iOS en cours d'utilisation)
    const input = chip.querySelector('.ec-doc-input');
    if (input && input.value !== (value || '')) input.value = value || '';
    let clear = chip.querySelector('.ec-doc-clear');
    if (value && !clear) {
      chip.appendChild(buildECheckInClearButton(workerId, field));
    } else if (!value && clear) {
      clear.remove();
    }
  } else {
    // Pour les types 'validation' et 'caces' : aucun input date ni ×.
    // S'ils existent (transition de type), on les retire.
    const stale = chip.querySelectorAll('.ec-doc-input, .ec-doc-clear');
    stale.forEach(el => el.remove());
  }
}

// Met à jour en place la classe worst-X de la carte entreprise selon
// la pire couleur parmi ses ouvriers présents.
function refreshCompanyWorstStatus(workerId) {
  const worker = state.workers.find(w => w.id === workerId);
  if (!worker) return;
  const companyCard = document.querySelector(
    `.admin-company[data-company-id="${worker.companyId}"]`
  );
  if (!companyCard) return;
  companyCard.classList.remove('worst-valid', 'worst-warning', 'worst-danger', 'worst-expired');
  const worst = getCompanyWorstStatus(worker.companyId);
  if (worst) companyCard.classList.add('worst-' + worst);
}

function refreshWorkerPresenceChip(workerId) {
  const card = document.querySelector(`.worker-card[data-worker-id="${workerId}"]`);
  if (!card) return;
  const chip = card.querySelector('.worker-presence');
  if (!chip) return;
  const onSite = getWorkerDocs(workerId).onSite;
  chip.classList.toggle('active', onSite);
  chip.setAttribute('aria-label', onSite ? 'Présent (toucher pour désactiver)' : 'Absent (toucher pour activer)');
  chip.setAttribute('aria-pressed', String(onSite));
}

function refreshWorkerTypeButton(workerId) {
  const card = document.querySelector(`.worker-card[data-worker-id="${workerId}"]`);
  if (!card) return;
  const btn = card.querySelector('.worker-type');
  if (!btn) return;
  const type = getWorkerDocs(workerId).employmentType;
  btn.classList.toggle('type-salarie', type === 'salarie');
  btn.classList.toggle('type-interim', type === 'interim');
  btn.setAttribute('aria-label', type === 'salarie'
    ? 'Salarié (toucher pour passer en intérim)'
    : 'Intérim (toucher pour passer en salarié)');
}

// Applique sur la carte ouvrier une classe worst-X correspondant au
// pire statut de ses 4 documents — uniquement si la présence est cochée.
function refreshWorkerWorstStatus(workerId) {
  const card = document.querySelector(`.worker-card[data-worker-id="${workerId}"]`);
  if (!card) return;
  card.classList.remove('worst-valid', 'worst-warning', 'worst-danger', 'worst-expired');
  if (!getWorkerDocs(workerId).onSite) return;
  const worst = getWorkerWorstStatus(workerId);
  if (worst) card.classList.add('worst-' + worst);
}

function buildECheckInClearButton(workerId, field) {
  const clear = document.createElement('button');
  clear.className = 'ec-doc-clear';
  clear.setAttribute('aria-label', 'Effacer la date');
  clear.textContent = '×';
  clear.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    setWorkerDocDate(workerId, field, null);
  });
  return clear;
}

function toggleECheckInCollapse(companyId) {
  if (state.echeckinCollapsed[companyId]) delete state.echeckinCollapsed[companyId];
  else state.echeckinCollapsed[companyId] = true;
  save();
  renderECheckIn();
}

// ---------- eCheckIn → récapitulatif des échéances ----------
// Construit un texte listant les documents périmés ou bientôt expirés
// pour TOUS les ouvriers (filtrés par scope vs type d'emploi). Format :
//   Société
//   Ouvrier : Doc est arrivé à échéance le JJ/MM/AAAA
//   Ouvrier : Doc arrivera à échéance le JJ/MM/AAAA
// Un bloc par entreprise, séparés par une ligne vide.
// Joint des clauses à la française : « A », « A et B », « A, B et C »…
function joinFR(parts) {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' et ' + parts[parts.length - 1];
}
// Échappe les caractères HTML spéciaux pour les noms saisis par l'utilisateur
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Construit deux versions du récap : texte brut et HTML (avec les
// documents périmés mis en gras et rouge). Le HTML est utilisé par les
// apps qui acceptent le formatage riche (mail), le texte brut sert de
// repli pour les autres (SMS, notes…). Voir copyExpiryReport.
function buildExpiryReport() {
  const blocksText = [];
  const blocksHtml = [];
  for (const company of state.companies) {
    const linesText = [];
    const linesHtml = [];
    for (const worker of getCompanyWorkers(company.id)) {
      const docs = getWorkerDocs(worker.id);
      const name = worker.name?.trim() || '(ouvrier sans nom)';
      const clausesText = [];
      const clausesHtml = [];
      const pushClause = (clause, isExpired) => {
        clausesText.push(clause);
        // Gras + souligné pour les périmés : les deux balises les plus
        // universellement supportées par les clients mail (y compris
        // Outlook iOS, qui peut rejeter <font> ou les styles couleurs
        // inline). Pas de couleur — l'œil repère déjà le formatage.
        clausesHtml.push(isExpired
          ? `<b><u>${escapeHtml(clause)}</u></b>`
          : escapeHtml(clause));
      };
      for (const docId of getApplicableDocIds(docs.employmentType)) {
        const type = getDocType(docId);
        const status = getDocStatus(worker.id, docId);
        if (status !== 'expired' && status !== 'danger' && status !== 'warning') continue;
        const label = getDocLabel(docId);
        if (type === 'echeance') {
          const date = getDocValue(worker.id, docId);
          if (!date) continue;
          const verb = (status === 'expired') ? 'est arrivé à échéance le' : 'arrivera à échéance le';
          pushClause(`${label} ${verb} ${fmtFR(date)}`, status === 'expired');
        } else if (type === 'validation') {
          pushClause(`${label} est non conforme`, true);
        } else if (type === 'caces') {
          const items = getDocValue(worker.id, docId) || [];
          for (const c of items) {
            const s = expiryStatus(c.expiresAt);
            if (s !== 'expired' && s !== 'danger' && s !== 'warning') continue;
            const subName = (c.name?.trim()) || label;
            const verb = (s === 'expired') ? 'est arrivé à échéance le' : 'arrivera à échéance le';
            pushClause(`${subName} ${verb} ${fmtFR(c.expiresAt)}`, s === 'expired');
          }
        }
      }
      if (clausesText.length > 0) {
        linesText.push(`${name} : ${joinFR(clausesText)}`);
        linesHtml.push(`${escapeHtml(name)} : ${joinFR(clausesHtml)}`);
      }
    }
    if (linesText.length > 0) {
      const companyName = company.name || '(entreprise sans nom)';
      blocksText.push([companyName, ...linesText].join('\n'));
      // <b> plutôt que <strong> pour la compat des vieux clients mail
      blocksHtml.push([`<b>${escapeHtml(companyName)}</b>`, ...linesHtml].join('<br>'));
    }
  }
  // Fragment HTML brut (sans wrapper <html>/<body>) : c'est ce que
  // la spec clipboard recommande. Les navigateurs ajoutent eux-mêmes
  // les enveloppes spécifiques au pasteboard (CF_HTML sur Windows,
  // etc.). Une enveloppe ajoutée par nos soins peut au contraire
  // perturber des clients comme Outlook iOS qui attendent un fragment.
  return {
    text: blocksText.join('\n\n'),
    html: blocksHtml.length > 0 ? blocksHtml.join('<br><br>') : ''
  };
}
async function copyExpiryReport() {
  const { text, html } = buildExpiryReport();
  if (!text) {
    showToast('Aucun document à signaler');
    return;
  }
  // Stratégie en cascade : on essaie d'abord ClipboardItem avec
  // text/html ET text/plain pour que les apps qui acceptent le riche
  // (mail) voient les docs périmés en gras rouge, tandis que celles
  // qui ne prennent que du texte (SMS, notes) tombent sur le plain.
  // Repli ensuite sur writeText, puis textarea + execCommand pour les
  // navigateurs les plus anciens.
  try {
    if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined' && html) {
      const item = new ClipboardItem({
        // charset=utf-8 explicite : sans ça certains clients (Outlook
        // iOS notamment) interprètent les accents en latin-1 et
        // produisent du mojibake ou refusent de coller.
        'text/plain': new Blob([text], { type: 'text/plain;charset=utf-8' }),
        'text/html':  new Blob([html], { type: 'text/html;charset=utf-8' })
      });
      await navigator.clipboard.write([item]);
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast('Récap copié dans le presse-papiers');
  } catch (e) {
    // Filet de sécurité : si write() échoue (permissions ou MIME non
    // autorisé), on retombe sur writeText
    try {
      await navigator.clipboard.writeText(text);
      showToast('Récap copié dans le presse-papiers');
    } catch (_) {
      showToast('Copie impossible', 'error');
    }
  }
}

function renderECheckIn() {
  const list = document.getElementById('echeckinlist');
  const empty = document.getElementById('echeckinempty');
  if (!list || !empty) return;
  list.innerHTML = '';
  empty.classList.remove('show');

  if (state.companies.length === 0) {
    empty.innerHTML = '<p>Aucune entreprise enregistrée.</p><p class="hint">Ajoute des entreprises dans <strong>Données → Entreprises</strong>.</p>';
    empty.classList.add('show');
    return;
  }

  for (const company of state.companies) {
    const worst = getCompanyWorstStatus(company.id);
    const collapsed = !!state.echeckinCollapsed[company.id];
    const card = document.createElement('div');
    card.className = 'admin-company' + (worst ? ' worst-' + worst : '') + (collapsed ? ' is-collapsed' : '');
    card.setAttribute('data-company-id', company.id);

    const header = document.createElement('div');
    header.className = 'admin-company-header';
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'zone-collapse';
    collapseBtn.setAttribute('aria-label', collapsed ? 'Déplier' : 'Replier');
    collapseBtn.textContent = collapsed ? '+' : '−';
    collapseBtn.addEventListener('click', () => toggleECheckInCollapse(company.id));
    const name = document.createElement('span');
    name.className = 'admin-company-name';
    name.textContent = company.name || '(sans nom)';
    const addBtn = document.createElement('button');
    addBtn.className = 'admin-add-btn';
    addBtn.setAttribute('aria-label', 'Ajouter un ouvrier');
    addBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z"/></svg>';
    addBtn.addEventListener('click', () => addWorker(company.id));
    header.append(collapseBtn, name, addBtn);
    card.appendChild(header);

    if (!collapsed) {
      const body = document.createElement('div');
      body.className = 'admin-company-body';
      const workers = getCompanyWorkers(company.id);
      if (workers.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'admin-empty';
        hint.textContent = 'Aucun ouvrier. Appuyez sur + pour en ajouter.';
        body.appendChild(hint);
      } else {
        for (const w of workers) {
          body.appendChild(buildWorkerCard(w));
        }
      }
      card.appendChild(body);
    }
    list.appendChild(card);
  }
}

function buildWorkerCard(worker) {
  const card = document.createElement('div');
  card.className = 'worker-card';
  card.setAttribute('data-worker-id', worker.id);
  const docs = getWorkerDocs(worker.id);
  // L'étiquette ouvrier se colore avec la pire couleur des 4 chips,
  // mais uniquement si la présence est cochée.
  if (docs.onSite) {
    const worst = getWorkerWorstStatus(worker.id);
    if (worst) card.classList.add('worst-' + worst);
  }

  // En-tête : nom + bouton Présent (tick) + bouton type (salarié/intérim) + supprimer
  const head = document.createElement('div');
  head.className = 'worker-head';
  const nameInput = document.createElement('input');
  nameInput.className = 'worker-name';
  nameInput.type = 'text';
  nameInput.placeholder = "Nom de l'ouvrier";
  nameInput.value = worker.name || '';
  nameInput.addEventListener('input', () => setWorkerName(worker.id, nameInput.value));

  const presenceBtn = document.createElement('button');
  presenceBtn.className = 'worker-presence' + (docs.onSite ? ' active' : '');
  presenceBtn.setAttribute('aria-pressed', String(!!docs.onSite));
  presenceBtn.setAttribute('aria-label', docs.onSite
    ? 'Présent (toucher pour désactiver)'
    : 'Absent (toucher pour activer)');
  presenceBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
  presenceBtn.addEventListener('click', () => toggleWorkerPresence(worker.id));

  const typeBtn = document.createElement('button');
  typeBtn.className = 'worker-type type-' + docs.employmentType;
  typeBtn.setAttribute('aria-label', docs.employmentType === 'salarie'
    ? 'Salarié (toucher pour passer en intérim)'
    : 'Intérim (toucher pour passer en salarié)');
  typeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 6h-3V4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2Zm-5 0H9V4h6v2Z"/></svg>';
  typeBtn.addEventListener('click', () => toggleEmploymentType(worker.id));

  const delBtn = document.createElement('button');
  delBtn.className = 'worker-delete';
  delBtn.setAttribute('aria-label', "Supprimer l'ouvrier");
  delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>';
  delBtn.addEventListener('click', () => removeWorker(worker.id));

  head.append(nameInput, presenceBtn, typeBtn, delBtn);
  card.appendChild(head);

  // Grille de pastilles documents colorées (filtrée par scope vs type d'emploi)
  const grid = document.createElement('div');
  grid.className = 'ec-doc-grid';
  for (const k of getApplicableDocIds(docs.employmentType)) {
    grid.appendChild(buildECheckInDocChip(worker.id, k, getDocLabel(k)));
  }
  card.appendChild(grid);

  return card;
}

// Construit le contenu visible du chip (libellé du doc + valeur formatée).
// Renvoie l'élément span "value" pour pouvoir le mettre à jour en place.
function buildECheckInDocChipBody(label, valueText) {
  const frag = document.createDocumentFragment();
  const name = document.createElement('span');
  name.className = 'ec-doc-name';
  name.textContent = label;
  const value = document.createElement('span');
  value.className = 'ec-doc-date';
  value.textContent = valueText;
  frag.append(name, value);
  return { frag, value };
}

// Texte affiché dans le chip selon le type
function formatDocChipValue(workerId, field) {
  const type = getDocType(field);
  const value = getDocValue(workerId, field);
  if (type === 'validation') {
    if (value === 'conforme')     return '✓ Conforme';
    if (value === 'non-conforme') return '✗ Non conf.';
    return '—';
  }
  if (type === 'caces') {
    const n = value.length;
    return n === 0 ? '—' : (n === 1 ? '1 CACES' : `${n} CACES`);
  }
  return value ? fmtFR(value) : '—';
}

function buildECheckInDocChip(workerId, field, label) {
  const type = getDocType(field);
  const status = getDocStatus(workerId, field);
  const chip = document.createElement('div');
  chip.className = `ec-doc status-${status} doctype-${type}`;
  chip.setAttribute('data-doc-field', field);
  chip.setAttribute('data-doc-type', type);

  const { frag } = buildECheckInDocChipBody(label, formatDocChipValue(workerId, field));
  chip.append(frag);

  if (type === 'echeance') {
    // L'input est étalé sur toute la chip (inset: 0, opacité 0). Le navigateur
    // ouvre le picker via ::-webkit-calendar-picker-indicator (étiré sur tout
    // l'input côté CSS) sur Chrome, et nativement au tap sur Safari/iOS.
    // Aucun JS pour ouvrir le picker → pas de double déclenchement.
    const dateStr = getDocValue(workerId, field);
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'ec-doc-input';
    input.value = dateStr || '';
    input.setAttribute('aria-label', `Date de péremption ${label}`);
    input.addEventListener('change', () => setWorkerDocValue(workerId, field, input.value || null));
    chip.appendChild(input);
    if (dateStr) chip.appendChild(buildECheckInClearButton(workerId, field));
  } else if (type === 'validation') {
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    const cycle = () => {
      const cur = getDocValue(workerId, field);
      const next = cur === null ? 'conforme' : cur === 'conforme' ? 'non-conforme' : null;
      setWorkerDocValue(workerId, field, next);
    };
    chip.addEventListener('click', cycle);
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); }
    });
  } else if (type === 'caces') {
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    const open = () => openCacesModal(workerId, field, label);
    chip.addEventListener('click', open);
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }

  return chip;
}

function renderAdministratif() {
  renderSecurite();
  renderECheckIn();
}

// ---------- Données → Administratif : configuration des documents ----------
function setDocLabel(id, value) {
  const d = getDoc(id);
  if (!d) return;
  d.label = value;
  save();
  // Met à jour en place les noms affichés dans toutes les chips eCheckIn
  // déjà rendues, sans détruire les inputs date.
  refreshDocLabelsInChips();
}
function refreshDocLabelsInChips() {
  for (const id of getDocIds()) {
    const label = getDocLabel(id);
    document.querySelectorAll(`.ec-doc[data-doc-field="${id}"] .ec-doc-name`)
      .forEach(el => { el.textContent = label; });
  }
}
function setDocType(id, type) {
  if (!DOC_TYPES.includes(type)) return;
  const d = getDoc(id);
  if (!d) return;
  d.type = type;
  save();
  // Le type change la structure et l'interaction du chip — on re-render
  // entièrement l'onglet eCheckIn (les ouvriers ne sont pas en train
  // d'interagir avec un picker quand on change le paramétrage).
  renderECheckIn();
}
function setDocScope(id, scope) {
  if (!DOC_SCOPES.includes(scope)) return;
  const d = getDoc(id);
  if (!d) return;
  d.scope = scope;
  save();
  // Met à jour le slider de scope en place (curseur orange + classe active)
  refreshScopeSlider(id);
  // Le scope filtre les chips visibles par ouvrier — re-render eCheckIn
  renderECheckIn();
}
function setDocRequired(id, required) {
  const d = getDoc(id);
  if (!d) return;
  d.required = !!required;
  save();
  // Re-render eCheckIn pour recalculer le pire-statut ouvrier + entreprise
  // (les chips elles-mêmes ne changent pas, mais l'agrégation oui).
  renderECheckIn();
}
function refreshScopeSlider(docId) {
  const item = document.querySelector(`.doc-label-item[data-doc-id="${docId}"]`);
  if (!item) return;
  const seg = item.querySelector('.doc-scope-seg');
  if (!seg) return;
  const idx = DOC_SCOPES.indexOf(getDocScope(docId));
  seg.dataset.position = String(idx >= 0 ? idx : 0);
  const buttons = seg.querySelectorAll('.seg-btn');
  buttons.forEach((b, i) => b.classList.toggle('active', i === idx));
}
function addDoc() {
  // Nouveau doc avec id unique et libellé par défaut « Doc N » basé
  // sur le nombre courant de documents.
  const id = 'doc_' + uid();
  const n = getDocs().length + 1;
  if (!Array.isArray(state.docs)) state.docs = [];
  state.docs.push({ id, label: `Doc ${n}`, type: 'echeance', scope: 'both', required: true });
  save();
  renderDocLabelsConfig();
  renderECheckIn();
}
function removeDoc(id) {
  const d = getDoc(id);
  if (!d) return;
  if (!confirm(`Supprimer « ${d.label || 'ce document'} » ?\nLes valeurs saisies pour ce document chez tous les ouvriers seront perdues.`)) return;
  state.docs = getDocs().filter(x => x.id !== id);
  // Nettoie les valeurs stockées sur chaque ouvrier
  for (const wid of Object.keys(state.workerDocs)) {
    if (state.workerDocs[wid]) delete state.workerDocs[wid][id];
  }
  save();
  renderDocLabelsConfig();
  renderECheckIn();
}

function renderDocLabelsConfig() {
  const list = document.getElementById('doclabelslist');
  if (!list) return;
  list.innerHTML = '';
  for (const doc of getDocs()) {
    list.appendChild(buildDocConfigRow(doc));
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-primary doc-add-btn';
  addBtn.textContent = '+ Ajouter un document';
  addBtn.addEventListener('click', addDoc);
  list.appendChild(addBtn);
}

// ---------- Données → eOTP : les lignes de budget ----------
// Deux familles qui n'ont ni la même unité ni le même usage : les lignes en
// heures pilotent l'onglet Heures, celles en euros les dépenses de
// Consommable. Les mélanger dans une pile de cartes rendait la page illisible ;
// on les sépare, on aligne les colonnes et on totalise chaque famille.
function renderEOTPsConfig() {
  const host = document.getElementById('eotplist');
  if (!host) return;
  host.innerHTML = '';
  const eotps = getEOTPs().slice().sort((a, b) => (a.code || '').localeCompare(b.code || '', 'fr'));
  const heures = eotps.filter(isHourEOTP);
  const euros = eotps.filter(e => !isHourEOTP(e));

  host.appendChild(buildEOTPSection({
    unite: 'h',
    titre: 'Main-d\'œuvre',
    sousTitre: 'Budget en heures — ces lignes alimentent l\'onglet Avancement → Heures.',
    lignes: heures,
    total: fmtHeures(heures.reduce((a, e) => a + (Number(e.budget) || 0), 0)) + ' h',
    vide: 'Aucune ligne en heures. Créez-en une pour suivre de la main-d\'œuvre.'
  }));
  host.appendChild(buildEOTPSection({
    unite: 'eur',
    titre: 'Achats et dépenses',
    sousTitre: 'Budget en euros — ces lignes sont proposées à la saisie dans Consommable.',
    lignes: euros,
    total: fmtEur(euros.reduce((a, e) => a + (Number(e.budget) || 0), 0)),
    vide: 'Aucune ligne en euros.'
  }));
}

function buildEOTPSection(cfg) {
  const sec = dbEl('div', 'eotp-section eotp-section-' + (cfg.unite === 'h' ? 'h' : 'eur'));
  const head = dbEl('div', 'eotp-section-head');
  const gauche = dbEl('div', 'eotp-section-titles');
  gauche.appendChild(dbEl('h3', 'eotp-section-title', cfg.titre));
  gauche.appendChild(dbEl('p', 'eotp-section-sub', cfg.sousTitre));
  head.appendChild(gauche);
  const chiffres = dbEl('div', 'eotp-section-figures');
  chiffres.appendChild(dbEl('span', 'eotp-section-total', cfg.total));
  chiffres.appendChild(dbEl('span', 'eotp-section-count',
    cfg.lignes.length + (cfg.lignes.length > 1 ? ' lignes' : ' ligne')));
  head.appendChild(chiffres);
  sec.appendChild(head);

  if (!cfg.lignes.length) {
    sec.appendChild(dbEl('p', 'eotp-section-empty', cfg.vide));
  } else {
    // Une rangée d'intitulés : sans elle, on ne sait pas ce que sont les
    // colonnes tant qu'on n'a pas cliqué dedans.
    const cols = dbEl('div', 'eotp-cols' + (cfg.unite === 'h' ? ' is-h' : ''));
    cols.appendChild(dbEl('span', '', 'Code'));
    cols.appendChild(dbEl('span', '', 'Libellé'));
    cols.appendChild(dbEl('span', 'is-num', 'Budget'));
    if (cfg.unite === 'h') cols.appendChild(dbEl('span', '', 'Ouvrage rattaché'));
    cols.appendChild(dbEl('span', ''));
    sec.appendChild(cols);
    const ul = dbEl('ul', 'eotp-list');
    for (const e of cfg.lignes) ul.appendChild(buildEOTPRow(e));
    sec.appendChild(ul);
  }
  const add = dbEl('button', 'eotp-add',
    cfg.unite === 'h' ? '+ Ligne en heures' : '+ Ligne en euros');
  add.type = 'button';
  add.addEventListener('click', () => addEOTP(cfg.unite));
  sec.appendChild(add);
  return sec;
}

function buildEOTPRow(eotp) {
  const enHeures = isHourEOTP(eotp);
  const li = dbEl('li', 'eotp-row' + (enHeures ? ' is-h' : ''));
  li.setAttribute('data-eotp-id', eotp.id);

  const code = document.createElement('input');
  code.className = 'eotp-code';
  code.type = 'text'; code.maxLength = 30;
  code.placeholder = 'OTP-2026-001';
  code.value = eotp.code || '';
  code.setAttribute('aria-label', 'Code de la ligne de budget');
  code.addEventListener('input', () => setEOTPCode(eotp.id, code.value));
  li.appendChild(code);

  const label = document.createElement('input');
  label.className = 'eotp-label';
  label.type = 'text'; label.maxLength = 80;
  label.placeholder = 'Libellé — Bardage petits bâtiments…';
  label.value = eotp.label || '';
  label.setAttribute('aria-label', 'Libellé de la ligne de budget');
  label.addEventListener('input', () => setEOTPLabel(eotp.id, label.value));
  li.appendChild(label);

  const wrap = dbEl('div', 'eotp-budget-wrap');
  const budget = document.createElement('input');
  budget.className = 'eotp-budget';
  budget.type = 'text'; budget.inputMode = 'decimal';
  budget.placeholder = '0';
  budget.value = eotp.budget ? fmtPriceForInput(eotp.budget) : '';
  budget.setAttribute('aria-label', 'Budget de la ligne');
  budget.addEventListener('input', () => setEOTPBudget(eotp.id, budget.value));
  wrap.appendChild(budget);
  const unit = dbEl('button', 'eotp-unit');
  unit.type = 'button';
  applyEOTPUnitButton(unit, eotp);
  // Changer d'unité fait changer la ligne de section : on re-rend toute la
  // page plutôt que de la laisser sous le mauvais titre.
  unit.addEventListener('click', () => { toggleEOTPUnit(eotp.id); renderEOTPsConfig(); });
  wrap.appendChild(unit);
  li.appendChild(wrap);

  if (enHeures) {
    const sel = document.createElement('select');
    sel.className = 'eotp-setup';
    sel.setAttribute('aria-label', 'Ouvrage rattaché');
    // Les options sont (re)construites à l'ouverture du menu : un ouvrage
    // créé entre-temps dans Données → Tâches doit y figurer sans avoir à
    // recharger la page.
    const remplir = () => {
      const courant = eotp.setupId || '';
      sel.innerHTML = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'Aucun — saisie manuelle';
      sel.appendChild(none);
      for (const st of state.taskSetups) {
        const opt = document.createElement('option');
        opt.value = st.id;
        opt.textContent = st.name || '(ouvrage sans nom)';
        sel.appendChild(opt);
      }
      sel.value = courant;
    };
    remplir();
    sel.addEventListener('mousedown', remplir);
    sel.addEventListener('focus', remplir);
    sel.addEventListener('change', () => { setEOTPSetup(eotp.id, sel.value); renderEOTPsConfig(); });
    li.appendChild(sel);
    if (eotp.setupId && !state.taskSetups.some(s => s.id === eotp.setupId)) {
      li.classList.add('is-orphan');
      sel.title = 'L\'ouvrage rattaché n\'existe plus : la ligne est repassée en saisie manuelle.';
    }
  }

  const del = dbEl('button', 'eotp-remove');
  del.type = 'button';
  del.setAttribute('aria-label', 'Supprimer cette ligne de budget');
  del.title = 'Supprimer cette ligne de budget';
  del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>';
  del.addEventListener('click', () => removeEOTP(eotp.id));
  li.appendChild(del);
  return li;
}
// Bouton d'unité de la ligne de budget : € (dépense) ou h (main-d'œuvre).
// Seules les lignes en « h » alimentent l'onglet Heures.
function applyEOTPUnitButton(btn, eotp) {
  const isH = isHourEOTP(eotp);
  btn.textContent = isH ? 'h' : '€';
  btn.classList.toggle('is-hours', isH);
  btn.title = isH
    ? 'Budget en heures — cette ligne apparaît dans l\'onglet Heures (toucher pour passer en €)'
    : 'Budget en euros (toucher pour passer en heures)';
  btn.setAttribute('aria-label', btn.title);
}

// ---------- Période du chantier (Données → Admin.) ----------
function renderProjectDates() {
  const startInp = document.getElementById('projectstart');
  const endInp   = document.getElementById('projectend');
  const info     = document.getElementById('projectdatesinfo');
  if (!startInp || !endInp || !info) return;
  // Synchronise les inputs (idempotent, n'écrase pas la saisie en cours)
  if (document.activeElement !== startInp) startInp.value = state.projectStart || '';
  if (document.activeElement !== endInp)   endInp.value   = state.projectEnd   || '';
  info.classList.remove('is-warn');
  if (!state.projectStart && !state.projectEnd) {
    info.textContent = 'Renseignez les dates pour voir la durée et les mois restants.';
    return;
  }
  if (state.projectStart && state.projectEnd && new Date(state.projectEnd) < new Date(state.projectStart)) {
    info.classList.add('is-warn');
    info.textContent = 'La date de fin doit être postérieure à la date de début.';
    return;
  }
  const total    = getProjectMonthsTotal();
  const elapsed  = getProjectMonthsElapsed();
  const remaining = getProjectMonthsRemaining();
  const parts = [];
  if (total > 0) parts.push(`Durée prévue : <strong>${total} mois</strong>`);
  else if (state.projectStart && !state.projectEnd) parts.push(`Début le <strong>${formatDateShortFR(state.projectStart)}</strong> — fin non renseignée`);
  else if (!state.projectStart && state.projectEnd) parts.push(`Fin le <strong>${formatDateShortFR(state.projectEnd)}</strong> — début non renseigné`);
  if (state.projectStart && elapsed > 0) parts.push(`<strong>${elapsed}</strong> écoulé${elapsed > 1 ? 's' : ''}`);
  if (state.projectEnd && remaining > 0) parts.push(`<strong>${remaining}</strong> restant${remaining > 1 ? 's' : ''}`);
  if (state.projectEnd && remaining === 0) parts.push('chantier terminé');
  info.innerHTML = parts.join(' · ');
}
// ================= PLANNING DES BÂTIMENTS (Données → Zones → Planning) =======
// Un planning en barres : une ligne par zone de premier niveau. La barre se
// déplace au glissé-déposé, s'allonge par la poignée de son extrémité droite
// et s'édite au double-clic. Sa période trace la trajectoire théorique du
// bâtiment dans la courbe d'avancement du récapitulatif ; le périmètre
// « Tout le projet » suit, lui, les dates du chantier (Données → Admin.).

const GANTT_PALETTE = ['#f2691e', '#1d7fb8', '#3aa76d', '#e0b400', '#9b5de5', '#e5484d', '#0f766e', '#7d7368'];
const GANTT_MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
// Échelles de temps, du plus large au plus fin (à la manière de MS Project).
// `dayW` est la largeur minimale d'une journée : c'est elle qui fixe la
// largeur totale de la piste, donc la précision du glissé-déposé.
const GANTT_ZOOMS = [
  { key: 'mois',     label: 'Mois',     dayW: 62 / 30.4 },   // ≈ 62 px par mois
  { key: 'semaines', label: 'Semaines', dayW: 30 / 7 },      // ≈ 30 px par semaine
  { key: 'jours',    label: 'Jours',    dayW: 26 },          // 26 px par jour
];
const GANTT_MAX_DAY_CELLS = 1500;   // au-delà, l'échelle « Jours » est inutilisable

// Les dates sont manipulées en « numéro de jour » (jours depuis 1970-01-01,
// en UTC) : insensible au fuseau et à l'heure d'été, et l'arithmétique de
// glissement se réduit à une addition d'entiers.
const isoToDay = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const dayToISO = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const dayOfWeek = (n) => (n + 4) % 7;   // 1970-01-01 était un jeudi → 4 (0 = dimanche)

// Dimanche de Pâques (algorithme de Meeus/Jones/Butcher), en numéro de jour.
function easterDay(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}
const _ganttHolidays = new Map();
function frenchHolidayDays(year) {
  if (_ganttHolidays.has(year)) return _ganttHolidays.get(year);
  const D = (m, d) => Math.round(Date.UTC(year, m - 1, d) / 86400000);
  const e = easterDay(year);
  const set = new Set([
    D(1, 1),        // Jour de l'an
    e + 1,          // Lundi de Pâques
    D(5, 1),        // Fête du Travail
    D(5, 8),        // Victoire 1945
    e + 39,         // Ascension
    e + 50,         // Lundi de Pentecôte
    D(7, 14),       // Fête nationale
    D(8, 15),       // Assomption
    D(11, 1),       // Toussaint
    D(11, 11),      // Armistice
    D(12, 25),      // Noël
  ]);
  _ganttHolidays.set(year, set);
  return set;
}
// Jours ouvrés d'une période, bornes incluses : du lundi au vendredi, hors
// jours fériés français. C'est l'unité de compte du planning (« jo »).
function countWorkingDays(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const a = isoToDay(startISO), b = isoToDay(endISO);
  if (!isFinite(a) || !isFinite(b) || b < a || b - a > 40000) return 0;
  const y0 = new Date(a * 86400000).getUTCFullYear();
  const y1 = new Date(b * 86400000).getUTCFullYear();
  const holidays = new Set();
  for (let y = y0; y <= y1; y++) for (const h of frenchHolidayDays(y)) holidays.add(h);
  let n = 0;
  for (let d = a; d <= b; d++) {
    const dow = dayOfWeek(d);
    if (dow === 0 || dow === 6 || holidays.has(d)) continue;
    n++;
  }
  return n;
}
// Numéro de semaine ISO 8601 (celui des plannings de chantier : « S28 »).
function isoWeekNumber(day) {
  // On se place sur le jeudi de la semaine : son année porte le numéro.
  const dow = dayOfWeek(day) === 0 ? 7 : dayOfWeek(day);   // 1 = lundi … 7 = dimanche
  const thursday = day + (4 - dow);
  const year = new Date(thursday * 86400000).getUTCFullYear();
  const jan4 = Math.round(Date.UTC(year, 0, 4) / 86400000);
  const jan4dow = dayOfWeek(jan4) === 0 ? 7 : dayOfWeek(jan4);
  const week1Monday = jan4 - (jan4dow - 1);
  return Math.floor((thursday - week1Monday) / 7) + 1;
}
const mondayOf = (day) => day - ((dayOfWeek(day) === 0 ? 7 : dayOfWeek(day)) - 1);

// Couleur par défaut d'un bâtiment : stable, dérivée de son rang.
function ganttZoneColor(zoneId) {
  const stored = ((state.zoneDates || {})[zoneId] || {}).color;
  if (stored) return stored;
  const idx = getBuildings().findIndex(z => z.id === zoneId);
  return GANTT_PALETTE[(idx >= 0 ? idx : 0) % GANTT_PALETTE.length];
}

// Fenêtre de temps affichée : englobe la période du chantier et toutes les
// barres, arrondie aux mois pleins avec un mois de marge de chaque côté pour
// laisser de la place au glissé-déposé.
function ganttDomain() {
  let lo = null, hi = null;
  const push = (iso) => {
    if (!iso) return;
    const d = isoToDay(iso);
    if (!isFinite(d)) return;
    lo = lo === null ? d : Math.min(lo, d);
    hi = hi === null ? d : Math.max(hi, d);
  };
  push(state.projectStart); push(state.projectEnd);
  for (const z of getBuildings()) {
    const d = (state.zoneDates || {})[z.id] || {};
    push(d.start); push(d.end);
  }
  if (lo === null) {
    const y = new Date().getFullYear();
    lo = Math.round(Date.UTC(y, 0, 1) / 86400000);
    hi = Math.round(Date.UTC(y, 11, 31) / 86400000);
  }
  const a = new Date(lo * 86400000), b = new Date(hi * 86400000);
  const first = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - 1, 1));
  const last  = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 2, 0));
  const startDay = Math.round(first.getTime() / 86400000);
  const endDay   = Math.round(last.getTime() / 86400000);
  const months = [];
  let y = first.getUTCFullYear(), m = first.getUTCMonth();
  while (y * 12 + m <= last.getUTCFullYear() * 12 + last.getUTCMonth()) {
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    months.push({ y, m, days, startDay: Math.round(Date.UTC(y, m, 1) / 86400000) });
    if (++m > 11) { m = 0; y++; }
  }
  return { startDay, endDay, totalDays: endDay - startDay + 1, months };
}

// ---------------------------------------------------------------- rendu ----
let _ganttDrag = null;      // état du glissé en cours (null au repos)
let _ganttRendered = null;  // { zoom, scrollLeft } du dernier rendu

// Jour affiché au centre de la fenêtre visible (à droite de la colonne des
// bâtiments, qui recouvre la piste). Sert à conserver le même point de vue
// quand on change d'échelle : sans cela, passer au jour renvoie l'utilisateur
// des mois en arrière.
function ganttCenterDay(dom) {
  const sc = document.getElementById('ganttscroll');
  const track = document.querySelector('.gantt-track');
  const label = document.querySelector('.gantt-label');
  if (!sc || !track || !label) return null;
  const t = track.getBoundingClientRect(), s = sc.getBoundingClientRect();
  if (!(t.width > 0)) return null;
  const labelW = label.getBoundingClientRect().width;
  const centerX = s.left + labelW + Math.max(0, s.width - labelW) / 2;
  return dom.startDay + ((centerX - t.left) / t.width) * dom.totalDays;
}
function ganttScrollToDay(day) {
  const sc = document.getElementById('ganttscroll');
  const track = document.querySelector('.gantt-track');
  const label = document.querySelector('.gantt-label');
  if (!sc || !track || !label || day == null) return;
  const dom = ganttDomain();
  const labelW = label.getBoundingClientRect().width;
  const trackW = track.getBoundingClientRect().width;
  const contentX = labelW + ((day - dom.startDay) / dom.totalDays) * trackW;
  sc.scrollLeft = Math.max(0, contentX - labelW - Math.max(0, sc.clientWidth - labelW) / 2);
}

function renderZonePlanning() {
  const chart = document.getElementById('ganttchart');
  const empty = document.getElementById('ganttempty');
  const toolbar = document.getElementById('gantttoolbar');
  const scroll = document.getElementById('ganttscroll');
  if (!chart || !empty) return;
  // Un rendu ne doit pas ramener la vue au 1er janvier : on retient la
  // position de défilement pour la restaurer à échelle constante.
  const keepScroll = scroll && _ganttRendered && _ganttRendered.zoom === state.ganttZoom
    ? scroll.scrollLeft : null;
  chart.innerHTML = '';
  if (toolbar) toolbar.innerHTML = '';

  const roots = getBuildings();
  empty.hidden = roots.length > 0;
  chart.hidden = roots.length === 0;
  if (!roots.length) return;

  const dom = ganttDomain();
  // L'échelle « Jours » n'a de sens que sur une fenêtre raisonnable : au-delà,
  // on retombe sur « Semaines » plutôt que d'aligner des milliers de cellules.
  const dayZoomOK = dom.totalDays <= GANTT_MAX_DAY_CELLS;
  let zoomKey = GANTT_ZOOMS.some(z => z.key === state.ganttZoom) ? state.ganttZoom : 'mois';
  if (zoomKey === 'jours' && !dayZoomOK) zoomKey = 'semaines';
  const zoom = GANTT_ZOOMS.find(z => z.key === zoomKey);
  chart.style.setProperty('--gantt-tl-w', Math.round(dom.totalDays * zoom.dayW) + 'px');
  chart.dataset.zoom = zoomKey;
  const pct = (day) => ((day - dom.startDay) / dom.totalDays) * 100;

  // ----- Barre d'outils : période du chantier + échelle de temps -----
  if (toolbar) {
    const chip = dbEl('span', 'gantt-chip');
    if (state.projectStart && state.projectEnd) {
      chip.textContent = 'Chantier : ' + fmtFR(state.projectStart) + ' → ' + fmtFR(state.projectEnd)
        + ' · ' + countWorkingDays(state.projectStart, state.projectEnd) + ' jo';
    } else {
      chip.classList.add('is-warn');
      chip.textContent = 'Dates du chantier non renseignées (Données → Admin.)';
    }
    toolbar.appendChild(chip);
    const zoomBox = dbEl('div', 'gantt-zoom');
    zoomBox.appendChild(dbEl('span', 'gantt-zoom-label', 'Échelle'));
    for (const z of GANTT_ZOOMS) {
      const b = dbEl('button', 'gantt-zoom-btn' + (z.key === zoomKey ? ' is-on' : ''), z.label);
      b.type = 'button';
      if (z.key === 'jours' && !dayZoomOK) {
        b.disabled = true;
        b.title = 'Fenêtre trop longue (' + dom.totalDays + ' jours) pour une échelle au jour';
      } else {
        b.title = 'Afficher le planning à l\'échelle : ' + z.label.toLowerCase();
        b.addEventListener('click', () => {
          const center = ganttCenterDay(dom);
          state.ganttZoom = z.key;
          save();
          renderZonePlanning();
          ganttScrollToDay(center);
        });
      }
      zoomBox.appendChild(b);
    }
    toolbar.appendChild(zoomBox);
    toolbar.appendChild(dbEl('span', 'gantt-hint', 'Glisser pour déplacer · poignée droite pour la durée · double-clic pour les propriétés'));
  }

  // ----- En-tête : deux niveaux, du plus large au plus fin. Chaque cellule
  // occupe un nombre de jours, sa largeur suit donc exactement la piste. -----
  const head = dbEl('div', 'gantt-head');
  head.appendChild(dbEl('div', 'gantt-corner', 'Bâtiment'));
  const scale = dbEl('div', 'gantt-scale');
  const mkRow = (cls, cells) => {
    const row = dbEl('div', 'gantt-scale-row ' + cls);
    for (const c of cells) {
      const cell = dbEl('div', c.cls, c.text);
      cell.style.flexGrow = String(c.days);
      if (c.title) cell.title = c.title;
      row.appendChild(cell);
    }
    return row;
  };
  // Niveau fin : mois, semaines ISO ou jours selon l'échelle.
  const fine = [];
  if (zoomKey === 'mois') {
    for (const mo of dom.months) fine.push({ cls: 'gantt-month', text: GANTT_MONTHS_FR[mo.m], days: mo.days });
  } else if (zoomKey === 'semaines') {
    for (let d = mondayOf(dom.startDay); d <= dom.endDay; d += 7) {
      const from = Math.max(d, dom.startDay), to = Math.min(d + 6, dom.endDay);
      fine.push({
        cls: 'gantt-week', text: 'S' + isoWeekNumber(d), days: to - from + 1,
        title: 'Semaine ' + isoWeekNumber(d) + ' — ' + fmtFR(dayToISO(from)) + ' → ' + fmtFR(dayToISO(to)),
      });
    }
  } else {
    for (let d = dom.startDay; d <= dom.endDay; d++) {
      const dow = dayOfWeek(d);
      fine.push({
        cls: 'gantt-day' + (dow === 0 || dow === 6 ? ' is-weekend' : ''),
        text: String(new Date(d * 86400000).getUTCDate()), days: 1,
        title: fmtFR(dayToISO(d)),
      });
    }
  }
  // Niveau large : années au-dessus des mois, mois au-dessus du reste.
  const coarse = [];
  if (zoomKey === 'mois') {
    let i = 0;
    while (i < dom.months.length) {
      let j = i, days = 0;
      while (j < dom.months.length && dom.months[j].y === dom.months[i].y) { days += dom.months[j].days; j++; }
      coarse.push({ cls: 'gantt-year', text: String(dom.months[i].y), days });
      i = j;
    }
  } else {
    for (const mo of dom.months) {
      const from = Math.max(mo.startDay, dom.startDay);
      const to = Math.min(mo.startDay + mo.days - 1, dom.endDay);
      if (to < from) continue;
      coarse.push({ cls: 'gantt-year', text: GANTT_MONTHS_FR[mo.m] + ' ' + String(mo.y).slice(2), days: to - from + 1 });
    }
  }
  scale.append(mkRow('gantt-years', coarse), mkRow('gantt-months', fine));
  head.appendChild(scale);
  chart.appendChild(head);

  // ----- Une ligne par bâtiment -----
  const todayDay = isoToDay(todayISO());
  const body = dbEl('div', 'gantt-body');
  // Quadrillage et week-ends : une seule couche derrière toutes les lignes,
  // et non un jeu de traits par bâtiment — à l'échelle du jour, la version
  // par ligne multiplierait les éléments par le nombre de bâtiments.
  const grid = dbEl('div', 'gantt-grid');
  if (zoomKey === 'jours') {
    for (let d = dom.startDay; d <= dom.endDay; d++) {
      if (dayOfWeek(d) !== 6) continue;              // samedi : on couvre le week-end
      const end = Math.min(d + 1, dom.endDay);
      const we = dbEl('div', 'gantt-weekend');
      we.style.left = pct(d) + '%';
      we.style.width = ((end + 1 - d) / dom.totalDays) * 100 + '%';
      grid.appendChild(we);
    }
  }
  if (zoomKey !== 'mois') {
    for (let d = mondayOf(dom.startDay); d <= dom.endDay; d += 7) {
      if (d <= dom.startDay) continue;
      const line = dbEl('div', 'gantt-gridline');
      line.style.left = pct(d) + '%';
      grid.appendChild(line);
    }
  }
  for (const mo of dom.months) {
    if (mo.startDay <= dom.startDay) continue;
    const line = dbEl('div', 'gantt-gridline is-month' + (mo.m === 0 ? ' is-year' : ''));
    line.style.left = pct(mo.startDay) + '%';
    grid.appendChild(line);
  }
  if (todayDay >= dom.startDay && todayDay <= dom.endDay) {
    const now = dbEl('div', 'gantt-today');
    now.style.left = pct(todayDay) + '%';
    now.title = "Aujourd'hui";
    grid.appendChild(now);
  }

  for (const z of roots) {
    const d = (state.zoneDates || {})[z.id] || {};
    const own = !!(d.start && d.end && isoToDay(d.end) >= isoToDay(d.start));
    const row = dbEl('div', 'gantt-row' + (own ? '' : ' is-inherited'));
    row.dataset.zone = z.id;

    // Libellé : nom + jours ouvrés entre parenthèses. Cliquable — c'est le
    // chemin d'édition fiable sur mobile, où le double-clic est incertain.
    const label = dbEl('button', 'gantt-label');
    label.type = 'button';
    label.title = 'Modifier la période de ' + (z.name || 'ce bâtiment');
    label.appendChild(dbEl('span', 'gantt-label-name', z.name || '(zone sans nom)'));
    const jo = own ? countWorkingDays(d.start, d.end)
      : countWorkingDays(state.projectStart, state.projectEnd);
    label.appendChild(dbEl('span', 'gantt-label-days' + (own ? '' : ' is-inherited'), '(' + jo + ' jo)'));
    // Une seule des deux dates saisie : la barre resterait celle du chantier
    // sans que rien ne le signale. On le dit là où l'œil est déjà.
    if (!own && (d.start || d.end)) {
      const warn = dbEl('span', 'gantt-label-warn', 'période incomplète');
      warn.title = 'Renseignez les deux dates pour que ce bâtiment ait sa propre trajectoire.';
      label.appendChild(warn);
    }
    label.addEventListener('click', () => openGanttModal(z.id));
    row.appendChild(label);

    const track = dbEl('div', 'gantt-track');
    const s = own ? d.start : state.projectStart;
    const e = own ? d.end : state.projectEnd;
    if (s && e && isoToDay(e) >= isoToDay(s)) {
      const bar = dbEl('div', 'gantt-bar' + (own ? '' : ' is-ghost'));
      bar.style.left = pct(isoToDay(s)) + '%';
      bar.style.width = ((isoToDay(e) + 1 - isoToDay(s)) / dom.totalDays) * 100 + '%';
      bar.style.setProperty('--gantt-bar-color', own ? ganttZoneColor(z.id) : 'var(--text-4)');
      bar.dataset.zone = z.id;
      bar.title = (own ? '' : 'Période du chantier — ')
        + fmtFR(s) + ' → ' + fmtFR(e) + ' · ' + countWorkingDays(s, e) + ' jo';
      if (own) {
        const handle = dbEl('div', 'gantt-bar-handle');
        handle.dataset.role = 'resize';
        handle.title = 'Allonger ou raccourcir';
        bar.appendChild(handle);
        bar.addEventListener('pointerdown', (ev) => ganttPointerDown(ev, z.id, dom));
      }
      track.appendChild(bar);
    } else {
      const warn = dbEl('div', 'gantt-bar-missing', 'Double-cliquez pour définir la période');
      track.appendChild(warn);
    }
    track.addEventListener('dblclick', () => { if (!_ganttDrag) openGanttModal(z.id); });
    row.appendChild(track);
    body.appendChild(row);
  }
  // Ajoutée en dernier pour que :nth-child compte bien les lignes ; elle
  // reste dessous grâce au z-index.
  body.appendChild(grid);
  chart.appendChild(body);

  // Position de la vue : conservée d'un rendu à l'autre, et calée sur le jour
  // à la première ouverture (ou sur la première barre si le jour est hors
  // fenêtre) plutôt que sur le début de la période affichée.
  if (scroll) {
    if (keepScroll != null) {
      scroll.scrollLeft = keepScroll;
    } else if (!_ganttRendered) {
      let focus = todayDay;
      if (focus < dom.startDay || focus > dom.endDay) {
        const firsts = roots.map(z => ((state.zoneDates || {})[z.id] || {}).start).filter(Boolean).map(isoToDay);
        focus = firsts.length ? Math.min(...firsts) : dom.startDay;
      }
      ganttScrollToDay(focus);
    }
  }
  _ganttRendered = { zoom: zoomKey };
}

// -------------------------------------------------------- glissé-déposé ----
function ganttPointerDown(ev, zoneId, dom) {
  if (ev.button != null && ev.button !== 0) return;
  const bar = ev.currentTarget;
  const track = bar.parentElement;
  const d = (state.zoneDates || {})[zoneId] || {};
  if (!d.start || !d.end) return;
  const width = track.getBoundingClientRect().width;
  if (!(width > 0)) return;
  ev.preventDefault();
  _ganttDrag = {
    zoneId, bar, dom,
    mode: ev.target && ev.target.dataset.role === 'resize' ? 'resize' : 'move',
    x0: ev.clientX,
    s0: isoToDay(d.start),
    e0: isoToDay(d.end),
    pxPerDay: width / dom.totalDays,
    moved: false,
    start: d.start, end: d.end,
  };
  bar.classList.add('is-dragging');
  try { bar.setPointerCapture(ev.pointerId); } catch (err) { /* pointeur déjà relâché */ }
  bar.addEventListener('pointermove', ganttPointerMove);
  bar.addEventListener('pointerup', ganttPointerUp);
  bar.addEventListener('pointercancel', ganttPointerUp);
}
function ganttPointerMove(ev) {
  const g = _ganttDrag;
  if (!g) return;
  const delta = Math.round((ev.clientX - g.x0) / g.pxPerDay);
  if (delta !== 0) g.moved = true;
  let s = g.s0, e = g.e0;
  if (g.mode === 'move') { s = g.s0 + delta; e = g.e0 + delta; }
  else { e = Math.max(g.s0, g.e0 + delta); }
  g.start = dayToISO(s);
  g.end = dayToISO(e);
  g.bar.style.left = ((s - g.dom.startDay) / g.dom.totalDays) * 100 + '%';
  g.bar.style.width = ((e + 1 - s) / g.dom.totalDays) * 100 + '%';
  // Retour immédiat : jours ouvrés dans le libellé et infobulle de la barre
  const row = g.bar.closest('.gantt-row');
  const days = row && row.querySelector('.gantt-label-days');
  if (days) days.textContent = '(' + countWorkingDays(g.start, g.end) + ' jo)';
  g.bar.title = fmtFR(g.start) + ' → ' + fmtFR(g.end) + ' · ' + countWorkingDays(g.start, g.end) + ' jo';
}
function ganttPointerUp(ev) {
  const g = _ganttDrag;
  if (!g) return;
  g.bar.removeEventListener('pointermove', ganttPointerMove);
  g.bar.removeEventListener('pointerup', ganttPointerUp);
  g.bar.removeEventListener('pointercancel', ganttPointerUp);
  g.bar.classList.remove('is-dragging');
  try { g.bar.releasePointerCapture(ev.pointerId); } catch (err) { /* déjà relâché */ }
  _ganttDrag = null;
  if (!g.moved) return;                        // simple clic : rien à écrire
  setZonePlanning(g.zoneId, { start: g.start, end: g.end });
  showToast(fmtFR(g.start) + ' → ' + fmtFR(g.end) + ' · ' + countWorkingDays(g.start, g.end) + ' jo');
}

// ---------------------------------------------------- modale de propriétés --
let _ganttModalZone = null;
function openGanttModal(zoneId) {
  const zone = state.zones.find(z => z.id === zoneId);
  const overlay = document.getElementById('ganttmodal');
  if (!zone || !overlay) return;
  _ganttModalZone = zoneId;
  const d = (state.zoneDates || {})[zoneId] || {};
  document.getElementById('ganttname').value = zone.name || '';
  document.getElementById('ganttstart').value = d.start || state.projectStart || '';
  document.getElementById('ganttend').value = d.end || state.projectEnd || '';
  renderGanttSwatches(d.color || ganttZoneColor(zoneId));
  updateGanttModalInfo();
  overlay.hidden = false;
}
function closeGanttModal() {
  const overlay = document.getElementById('ganttmodal');
  if (overlay) overlay.hidden = true;
  _ganttModalZone = null;
}
function renderGanttSwatches(selected) {
  const host = document.getElementById('ganttswatches');
  if (!host) return;
  host.innerHTML = '';
  host.dataset.color = selected;
  for (const c of GANTT_PALETTE) {
    const b = dbEl('button', 'gantt-swatch' + (c.toLowerCase() === String(selected).toLowerCase() ? ' is-on' : ''));
    b.type = 'button';
    b.style.background = c;
    b.setAttribute('aria-label', 'Couleur ' + c);
    b.addEventListener('click', () => renderGanttSwatches(c));
    host.appendChild(b);
  }
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'gantt-swatch-custom';
  custom.value = /^#[0-9a-f]{6}$/i.test(selected) ? selected : GANTT_PALETTE[0];
  custom.title = 'Couleur personnalisée';
  custom.addEventListener('input', () => renderGanttSwatches(custom.value));
  host.appendChild(custom);
}
function updateGanttModalInfo() {
  const info = document.getElementById('ganttmodalinfo');
  if (!info) return;
  const s = document.getElementById('ganttstart').value;
  const e = document.getElementById('ganttend').value;
  info.classList.remove('is-warn');
  if (!s || !e) {
    info.textContent = 'Sans les deux dates, ce bâtiment suit la période du chantier.';
    return;
  }
  if (isoToDay(e) < isoToDay(s)) {
    info.classList.add('is-warn');
    info.textContent = 'La date de fin doit être postérieure à la date de début.';
    return;
  }
  const cal = isoToDay(e) - isoToDay(s) + 1;
  info.textContent = cal + ' jour' + (cal > 1 ? 's' : '') + ' calendaires · '
    + countWorkingDays(s, e) + ' jours ouvrés (hors week-ends et jours fériés).';
}
function saveGanttModal() {
  const zoneId = _ganttModalZone;
  if (!zoneId) return;
  const name = document.getElementById('ganttname').value.trim();
  const s = document.getElementById('ganttstart').value;
  const e = document.getElementById('ganttend').value;
  if (s && e && isoToDay(e) < isoToDay(s)) {
    showToast('La date de fin doit être postérieure à la date de début', 'error');
    return;
  }
  const zone = state.zones.find(z => z.id === zoneId);
  if (zone && name && name !== zone.name) { renameZone(zoneId, name); renderZones(); }
  setZonePlanning(zoneId, { start: s || '', end: e || '', color: document.getElementById('ganttswatches').dataset.color || '' });
  closeGanttModal();
  showToast('Planning mis à jour');
}
function resetGanttModal() {
  if (!_ganttModalZone) return;
  setZonePlanning(_ganttModalZone, { start: '', end: '', color: '' });
  closeGanttModal();
  showToast('Ce bâtiment suit la période du chantier');
}

// Taux horaire (€/h) — Données → Admin. Utilisé par les totaux de devis.
function renderTauxHoraire() {
  const inp = document.getElementById('tauxhoraire');
  if (!inp || document.activeElement === inp) return;
  inp.value = state.tauxHoraire ? fmtPriceForInput(state.tauxHoraire) : '';
}
function setTauxHoraire(value) {
  const n = parseFloat(String(value).replace(/[^\d,.-]/g, '').replace(',', '.'));
  state.tauxHoraire = Number.isFinite(n) && n >= 0 ? n : 0;
  save();
  renderDevis(); // les totaux de lignes/devis dépendent du taux
}

function setProjectStart(value) {
  state.projectStart = value || '';
  save();
  renderProjectDates();
  renderConsommable();
}
function setProjectEnd(value) {
  state.projectEnd = value || '';
  save();
  renderProjectDates();
  renderConsommable();
}

function buildDocConfigRow(doc) {
  const li = document.createElement('li');
  li.className = 'doc-label-item';
  li.dataset.docId = doc.id;

  // Ligne 1 : libellé + type + supprimer
  const main = document.createElement('div');
  main.className = 'doc-label-main';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'doc-label-input';
  input.maxLength = 30;
  input.placeholder = defaultDocLabel(doc.id);
  input.value = doc.label || '';
  input.setAttribute('aria-label', `Libellé du document ${doc.id}`);
  input.addEventListener('input', () => setDocLabel(doc.id, input.value));
  const typeSelect = document.createElement('select');
  typeSelect.className = 'doc-type-select';
  typeSelect.setAttribute('aria-label', `Type de validation pour ${doc.label}`);
  for (const t of DOC_TYPES) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = DOC_TYPE_LABELS[t];
    if (t === getDocType(doc.id)) opt.selected = true;
    typeSelect.appendChild(opt);
  }
  typeSelect.addEventListener('change', () => setDocType(doc.id, typeSelect.value));
  const delBtn = document.createElement('button');
  delBtn.className = 'doc-remove-btn';
  delBtn.setAttribute('aria-label', `Supprimer le document ${doc.label}`);
  delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>';
  delBtn.addEventListener('click', () => removeDoc(doc.id));
  main.append(input, typeSelect, delBtn);

  // Ligne 2 : scope (salarié / tous / intérim) sous forme de slider
  const scopeBar = document.createElement('div');
  scopeBar.className = 'doc-scope-bar';
  const scopeLabel = document.createElement('span');
  scopeLabel.className = 'doc-scope-label';
  scopeLabel.textContent = 'Pour :';
  scopeBar.appendChild(scopeLabel);
  const seg = document.createElement('div');
  const idx = DOC_SCOPES.indexOf(getDocScope(doc.id));
  seg.className = 'segmented doc-scope-seg';
  seg.style.setProperty('--count', String(DOC_SCOPES.length));
  seg.dataset.position = String(idx >= 0 ? idx : 0);
  const thumb = document.createElement('div');
  thumb.className = 'segmented-thumb';
  seg.appendChild(thumb);
  for (let i = 0; i < DOC_SCOPES.length; i++) {
    const s = DOC_SCOPES[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn' + (i === idx ? ' active' : '');
    btn.textContent = DOC_SCOPE_LABELS[s];
    btn.addEventListener('click', () => setDocScope(doc.id, s));
    seg.appendChild(btn);
  }
  scopeBar.appendChild(seg);

  // Ligne 3 : case Obligatoire (case cochée → le doc compte pour le
  // pire-statut ouvrier/entreprise ; décochée → couleur du chip seule)
  const reqRow = document.createElement('label');
  reqRow.className = 'doc-required-row';
  const reqCheck = document.createElement('input');
  reqCheck.type = 'checkbox';
  reqCheck.className = 'doc-required-check';
  reqCheck.checked = isDocRequired(doc.id);
  reqCheck.addEventListener('change', () => setDocRequired(doc.id, reqCheck.checked));
  const reqText = document.createElement('span');
  reqText.className = 'doc-required-text';
  reqText.textContent = 'Obligatoire';
  reqRow.append(reqCheck, reqText);

  li.append(main, scopeBar, reqRow);
  return li;
}

// ---------- Modale CACES ----------
let cacesModalCtx = null; // { workerId, field, label } pendant l'ouverture
function openCacesModal(workerId, field, label) {
  cacesModalCtx = { workerId, field, label };
  const modal = document.getElementById('cacesmodal');
  const title = document.getElementById('cacesmodaltitle');
  if (!modal || !title) return;
  const workerName = state.workers.find(w => w.id === workerId)?.name || '';
  title.textContent = `${label}${workerName ? ' — ' + workerName : ''}`;
  renderCacesModalList();
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeCacesModal() {
  const modal = document.getElementById('cacesmodal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
  // Met à jour le chip + les pires statuts après modification
  if (cacesModalCtx) {
    const { workerId, field } = cacesModalCtx;
    cacesModalCtx = null;
    refreshDocChip(workerId, field);
    refreshWorkerWorstStatus(workerId);
    refreshCompanyWorstStatus(workerId);
  }
}
function renderCacesModalList() {
  if (!cacesModalCtx) return;
  const list = document.getElementById('caceslist');
  if (!list) return;
  list.innerHTML = '';
  const items = getDocValue(cacesModalCtx.workerId, cacesModalCtx.field);
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'caces-empty';
    li.textContent = 'Aucun CACES. Appuyez sur « + » pour en ajouter.';
    list.appendChild(li);
    return;
  }
  for (const c of items) list.appendChild(buildCacesRow(c));
}
function buildCacesRow(caces) {
  const status = expiryStatus(caces.expiresAt);
  const row = document.createElement('li');
  row.className = `caces-row status-${status}`;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'caces-name';
  nameInput.placeholder = 'Nom du CACES';
  nameInput.value = caces.name || '';
  nameInput.addEventListener('input', () => updateCaces(caces.id, { name: nameInput.value }));

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'caces-date';
  dateInput.value = caces.expiresAt || '';
  dateInput.setAttribute('aria-label', 'Date de péremption');
  dateInput.addEventListener('change', () => {
    const val = dateInput.value || null;
    updateCaces(caces.id, { expiresAt: val });
    // Mise à jour en place : surtout pas un re-render de la liste,
    // qui détruirait l'input pendant que iOS Safari l'utilise encore
    // (même problème que pour les chips eCheckIn — picker se ferme
    // sinon en validant la date du jour).
    row.className = `caces-row status-${expiryStatus(val)}`;
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'caces-delete';
  delBtn.setAttribute('aria-label', 'Supprimer ce CACES');
  delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>';
  delBtn.addEventListener('click', () => {
    removeCaces(caces.id);
    renderCacesModalList();
  });

  row.append(nameInput, dateInput, delBtn);
  return row;
}
function addCaces() {
  if (!cacesModalCtx) return;
  const { workerId, field } = cacesModalCtx;
  const bag = ensureWorkerDocsBag(workerId);
  const current = Array.isArray(bag[field]) ? bag[field].slice() : [];
  current.push({ id: uid(), name: '', expiresAt: null });
  bag[field] = current;
  save();
  renderCacesModalList();
}
function updateCaces(cacesId, patch) {
  if (!cacesModalCtx) return;
  const { workerId, field } = cacesModalCtx;
  const bag = ensureWorkerDocsBag(workerId);
  const list = Array.isArray(bag[field]) ? bag[field] : [];
  const entry = list.find(c => c.id === cacesId);
  if (!entry) return;
  Object.assign(entry, patch);
  save();
}
function removeCaces(cacesId) {
  if (!cacesModalCtx) return;
  const { workerId, field } = cacesModalCtx;
  const bag = ensureWorkerDocsBag(workerId);
  const list = Array.isArray(bag[field]) ? bag[field] : [];
  bag[field] = list.filter(c => c.id !== cacesId);
  save();
}

// ---------- eCheckIn : helpers de date de péremption ----------
// Statut d'expiration d'un document : valid > 7 j, warning ≤ 7 j,
// danger ≤ 3 j, expired si la date est passée, none si pas de date.
function expiryStatus(dateStr, today = new Date()) {
  if (!dateStr) return 'none';
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((d - t) / 86400000);
  if (diff < 0) return 'expired';
  if (diff <= 3) return 'danger';
  if (diff <= 7) return 'warning';
  return 'valid';
}
function fmtFR(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
// ---------- Sub-tabs ----------
function switchSubPage(group, name) {
  // Certains segmented ne pilotent pas de sous-page (le sélecteur de type de
  // la feuille de saisie Stock, par exemple) : leurs boutons portent la même
  // classe et déclenchaient ici une erreur silencieuse à chaque clic.
  if (!group) return;
  const seg = document.querySelector(`.segmented[data-group="${group}"]`);
  if (!seg) return;
  const buttons = Array.from(document.querySelectorAll(`.seg-btn[data-group="${group}"]`));
  const idx = buttons.findIndex(b => b.dataset.sub === name);
  buttons.forEach((b, i) => b.classList.toggle('active', i === idx));
  document.querySelectorAll(`.sub-page[data-group="${group}"]`).forEach(p => {
    p.classList.toggle('active', p.id === `sub-${name}`);
  });
  seg.dataset.position = String(idx < 0 ? 0 : idx);
  if (group === 'effectifs' && name === 'graphique') {
    renderChart();
    renderLegend();
  }
  // Garantit un récap toujours frais à l'ouverture du sous-onglet
  if (group === 'avancement' && name === 'recap') renderRecap();
  if (group === 'avancement' && name === 'heures') renderHeures();
  // Le tableau des heures a besoin de plus de largeur que le reste de la
  // page : on lève le plafond commun tant que son sous-onglet est ouvert.
  if (group === 'avancement') {
    const page = document.getElementById('page-avancement');
    if (page) page.classList.toggle('is-wide', name === 'heures');
  }
  if (group === 'proto' && name === 'recap') renderProtoRecap();
  if (group === 'stock') renderStock();
  if (group === 'travaux') renderTravaux();
  // Le planning se mesure sur la largeur réelle de sa piste : il doit être
  // (re)dessiné une fois son onglet visible.
  if (group === 'donnees' && name === 'zones') renderZonePlanning();
  if (group === 'zones') renderZonePlanning();
}

function renderCompanies() {
  const list = document.getElementById('companylist');
  list.innerHTML = '';
  if (state.companies.length === 0) {
    const li = document.createElement('li');
    li.className = 'company-item';
    li.style.color = 'var(--text-3)';
    li.style.justifyContent = 'center';
    li.textContent = 'Aucune entreprise enregistrée.';
    list.appendChild(li);
    return;
  }
  for (const company of state.companies) {
    const li = document.createElement('li');
    li.className = 'company-item';
    li.innerHTML = `
      <span class="company-name"></span>
      <button class="icon-btn danger" aria-label="Supprimer l'entreprise">
        <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>
      </button>
    `;
    li.querySelector('.company-name').textContent = company.name;
    li.querySelector('button').addEventListener('click', () => deleteCompany(company.id));
    list.appendChild(li);
  }
}

// ---------- Companies ----------
function addCompany(name) {
  name = name.trim();
  if (!name) return;
  if (state.companies.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    showToast('Cette entreprise existe déjà', 'error');
    return;
  }
  state.companies.push({ id: uid(), name });
  state.companies.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  save();
  renderAll();
  showToast('Entreprise ajoutée');
}

function deleteCompany(id) {
  const company = getCompany(id);
  if (!company) return;
  if (!confirm(`Supprimer l'entreprise « ${company.name} » ?\nLes présences déjà enregistrées seront conservées mais affichées comme « entreprise supprimée ».`)) return;
  state.companies = state.companies.filter(c => c.id !== id);
  delete state.chartHidden[id];
  delete state.adminDocs[id];
  delete state.echeckinCollapsed[id];
  delete state.crEntries[id];
  delete state.crCollapsed[id];
  delete state.crAvancementVisible[id];
  delete state.crAdminVisible[id];
  delete state.crEffectifsVisible[id];
  delete state.crWeeks[id];
  delete state.crSelectedWeekId[id];
  if (state.crSelectedCompanyId === id) state.crSelectedCompanyId = null;
  // Libère les lots qui pointaient sur cette entreprise (lien rompu)
  for (const lot of getWorkBatches()) if (lot.companyId === id) lot.companyId = null;
  // Nettoie les intempéries marquées pour cette entreprise
  for (const date of Object.keys(state.weather)) {
    if (state.weather[date]) {
      delete state.weather[date][id];
      if (Object.keys(state.weather[date]).length === 0) delete state.weather[date];
    }
  }
  // Retire les ouvriers de l'entreprise supprimée + leurs documents
  const removed = state.workers.filter(w => w.companyId === id);
  state.workers = state.workers.filter(w => w.companyId !== id);
  for (const w of removed) delete state.workerDocs[w.id];
  save();
  renderAll();
  showToast('Entreprise supprimée');
}

// ---------- Entries (presences) ----------
// ---------- Intempéries (statut par date × entreprise) ----------
function isCompanyOnWeather(date, companyId) {
  return !!state.weather?.[date]?.[companyId];
}
function toggleCompanyWeather(companyId) {
  const date = state.currentDate;
  if (!state.weather) state.weather = {};
  if (!state.weather[date]) state.weather[date] = {};
  if (state.weather[date][companyId]) {
    delete state.weather[date][companyId];
    if (Object.keys(state.weather[date]).length === 0) delete state.weather[date];
  } else {
    state.weather[date][companyId] = true;
  }
  save();
  renderEntries();
  renderRecapTable();
}

// ---------- Stock : catalogue, mouvements, modèle de calcul ----------
// Le journal `state.stockEntries` reste la seule source de vérité : une suite
// d'événements immuables rejoués dans l'ordre. Trois verbes désormais :
//   réception (+)  ajoute au stock
//   sortie (−)     retire du stock, éventuellement affectée à une zone
//   inventaire (=) recale le compteur sur la quantité comptée
// La sortie est la nouveauté qui débloque tout le reste : sans elle, la
// consommation ne pouvait être déduite qu'entre deux campagnes d'inventaire.
const STOCK_UNITS = ['u', 'sacs', 'palettes', 'kg', 't', 'm³', 'm²', 'ml', 'L'];
const STOCK_TYPES = {
  reception:  { label: 'Réception',  short: 'Réception',  sign: '+', dir: 1 },
  sortie:     { label: 'Sortie',     short: 'Sortie',     sign: '−', dir: -1 },
  inventaire: { label: 'Inventaire', short: 'Inventaire', sign: '=', dir: 0 },
};
function stockTypeOf(e) { return STOCK_TYPES[e && e.type] ? e.type : 'reception'; }

// Clé canonique d'un article : le nom, insensible à la casse, aux accents et
// aux espaces multiples. Dérivée du nom (et non d'un identifiant tiré au sort),
// deux appareils créent donc la même clé pour la même référence — la fusion par
// union de la synchro ne peut pas produire de doublon.
function stockKey(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
function getStockArticles() {
  if (!state.stockArticles || typeof state.stockArticles !== 'object') state.stockArticles = {};
  return state.stockArticles;
}
function getStockArticle(name) {
  const k = stockKey(name);
  return k ? (getStockArticles()[k] || null) : null;
}
// Fiche article : entièrement OPTIONNELLE. Elle se crée à la volée avec le seul
// nom et ne bloque jamais une saisie ; tous ses champs servent à affiner les
// alertes (mini, délai d'appro, fournisseur, eOTP par défaut).
function upsertStockArticle(name, patch) {
  const k = stockKey(name);
  if (!k) return null;
  const all = getStockArticles();
  if (!all[k]) all[k] = { key: k, name: String(name).trim(), unit: '', min: 0, leadDays: 0, supplier: '', eOTP: '', notes: '' };
  if (patch) Object.assign(all[k], patch);
  if (name) all[k].name = String(name).trim();
  return all[k];
}
function getStockSettings() {
  const s = state.stockSettings && typeof state.stockSettings === 'object' ? state.stockSettings : {};
  return {
    alertDays: Number.isFinite(s.alertDays) && s.alertDays > 0 ? s.alertDays : STOCK_ALERT_THRESHOLD_DAYS,
    coverDays: Number.isFinite(s.coverDays) && s.coverDays > 0 ? s.coverDays : 15,
  };
}
function setStockSetting(field, value) {
  if (!state.stockSettings || typeof state.stockSettings !== 'object') state.stockSettings = {};
  const n = parseInt(String(value).replace(/\D/g, ''), 10);
  state.stockSettings[field] = Number.isFinite(n) && n > 0 ? n : undefined;
  save();
  invalidateStockModel();
  renderStock();
}

function compareStockEntries(a, b) {
  // Ordre chronologique. À date égale, l'heure départage quand elle est
  // renseignée ; l'identifiant ne sert plus que de dernier recours (stabilité).
  return (a.date || '').localeCompare(b.date || '')
    || (a.time || '').localeCompare(b.time || '')
    || String(a.id || '').localeCompare(String(b.id || ''));
}

// ---------------------------------------------------------------- modèle ----
// Le journal est rejoué UNE fois par rendu, pas une fois par carte. Le résultat
// est mémorisé le temps d'un cycle : renderStock() est appelé par renderAll(),
// lui-même déclenché après chaque fusion de synchro entrante.
let _stockModel = null, _stockModelAt = 0;
function invalidateStockModel() { _stockModel = null; }
function computeStockModel() {
  const now = Date.now();
  if (_stockModel && now - _stockModelAt < 1200) return _stockModel;
  const settings = getStockSettings();
  const entries = (state.stockEntries || []).slice().sort(compareStockEntries);
  const map = new Map();
  for (const e of entries) {
    const k = stockKey(e.article);
    if (!k) continue;
    if (!map.has(k)) {
      map.set(k, {
        key: k, name: e.article, unit: e.unit || 'u', units: new Set(),
        stock: 0, entries: [], received: 0, releasedQty: 0, inventories: 0,
        spend: 0, receivedQty: 0, lastEntry: null, firstDate: e.date,
      });
    }
    const a = map.get(k);
    a.name = e.article;                  // dernière casse saisie
    a.lastEntry = e;
    a.entries.push(e);
    if (e.unit) a.units.add(e.unit);
    const t = stockTypeOf(e);
    const q = Number(e.qty) || 0;
    if (t === 'inventaire') { a.stock = q; a.inventories++; }
    else if (t === 'sortie') { a.stock -= q; a.releasedQty += q; }
    else {
      a.stock += q;
      a.receivedQty += q;
      a.spend += q * (Number(e.unitPrice) || 0);
    }
  }
  const period = getStockPeriod();
  const list = [];
  let totalValue = 0, totalSpend = 0, unpriced = 0, mixedUnits = 0;
  for (const a of map.values()) {
    const fiche = getStockArticles()[a.key] || null;
    // L'unité affichée vient de la fiche si elle en fixe une, sinon de la
    // dernière saisie. Un mélange d'unités est signalé plutôt que masqué :
    // l'ancien code écrasait l'unité à chaque itération et affichait
    // « 510 sacs » pour 10 palettes puis 500 sacs.
    a.unit = (fiche && fiche.unit) || a.unit;
    a.mixedUnits = a.units.size > 1;
    if (a.mixedUnits) mixedUnits++;
    a.pmp = a.receivedQty > 0 ? a.spend / a.receivedQty : 0;
    a.value = Math.max(0, a.stock) * a.pmp;
    totalValue += a.value;
    totalSpend += a.spend;
    a.unpriced = a.entries.filter(e => stockTypeOf(e) === 'reception' && !(Number(e.unitPrice) > 0)).length;
    unpriced += a.unpriced;
    a.min = fiche && Number(fiche.min) > 0 ? Number(fiche.min) : 0;
    a.leadDays = fiche && Number(fiche.leadDays) > 0 ? Number(fiche.leadDays) : 0;
    a.supplier = fiche ? (fiche.supplier || '') : '';
    a.eOTP = fiche ? (fiche.eOTP || '') : '';
    Object.assign(a, getStockConsumption(a, period.days));
    Object.assign(a, getStockDepletion(a, settings));
    list.push(a);
  }
  list.sort((x, y) => x.name.localeCompare(y.name, 'fr'));
  _stockModel = {
    articles: list, settings, period,
    totals: {
      references: list.length,
      value: totalValue,
      spend: totalSpend,
      unpriced,
      mixedUnits,
      moves: entries.length,
      movesPeriod: entries.filter(e => e.date >= dayToISO(isoToDay(todayISO()) - (period.days || 3650))).length,
      alerts: list.filter(a => a.status === 'rupture' || a.status === 'critique').length,
    },
  };
  _stockModelAt = now;
  return _stockModel;
}

// Consommation journalière d'un article. Deux sources possibles, dans cet
// ordre : les SORTIES réellement saisies sur la fenêtre (mesure directe), à
// défaut la déduction entre deux inventaires (méthode historique, conservée
// telle quelle). La provenance est renvoyée pour être affichée : l'application
// ne doit jamais laisser croire qu'un chiffre déduit a été mesuré.
function getStockConsumption(a, windowDays) {
  const today = isoToDay(todayISO());
  const fromISO = windowDays ? dayToISO(today - windowDays) : (a.firstDate || todayISO());
  const sorties = a.entries.filter(e => stockTypeOf(e) === 'sortie' && e.date >= fromISO);
  if (sorties.length) {
    const first = sorties[0].date < fromISO ? fromISO : sorties[0].date;
    const days = Math.max(1, businessDaysBetweenISO(first, todayISO()));
    const qty = sorties.reduce((s, e) => s + (Number(e.qty) || 0), 0);
    return { daily: qty / days, dailySource: 'sorties', dailySample: sorties.length, dailyDays: days };
  }
  const daily = getArticleDailyConsumption(a.name);
  return {
    daily: daily === null ? null : daily,
    dailySource: daily === null ? null : 'inventaires',
    dailySample: a.inventories,
    dailyDays: null,
  };
}
// Couverture restante et statut. Le seuil combine le délai d'appro de l'article
// (le ciment arrive en 48 h, la résine en trois semaines) et le seuil global.
function getStockDepletion(a, settings) {
  const daily = a.daily;
  const out = { days: null, date: null, status: 'inconnu' };
  if (a.stock <= 0) { out.days = 0; out.date = todayISO(); out.status = 'rupture'; return out; }
  if (a.min > 0 && a.stock <= a.min) out.status = 'critique';
  if (daily === null || daily <= 0) {
    if (out.status === 'inconnu') out.status = a.min > 0 ? 'ok' : 'inconnu';
    return out;
  }
  // Plancher plutôt qu'arrondi : 0,4 jour restant, c'est aujourd'hui, pas demain.
  out.days = Math.floor(a.stock / daily);
  out.date = addBusinessDaysISO(todayISO(), out.days);
  const seuil = settings.alertDays + (a.leadDays || 0);
  if (out.days <= 0) out.status = 'rupture';
  else if (out.days <= seuil) out.status = 'critique';
  else if (out.days <= seuil * 2) out.status = 'bas';
  else if (out.status === 'inconnu') out.status = 'ok';
  return out;
}
const STOCK_STATUS = {
  rupture:  { label: 'Rupture',   rank: 0 },
  critique: { label: 'Critique',  rank: 1 },
  bas:      { label: 'À surveiller', rank: 2 },
  ok:       { label: 'OK',        rank: 3 },
  inconnu:  { label: 'Sans conso', rank: 4 },
};
// Quantité à commander : de quoi couvrir la période cible, au-delà du mini,
// arrondie à l'unité supérieure. Rien à commander → null.
function getStockReorderQty(a, settings) {
  const cover = settings.coverDays + (a.leadDays || 0);
  const besoinConso = a.daily != null && a.daily > 0 ? a.daily * cover : 0;
  const cible = Math.max(besoinConso, a.min || 0);
  const manque = cible - Math.max(0, a.stock);
  if (!(manque > 0)) return null;
  return Math.ceil(manque * 100) / 100;
}
function getStockReorderList() {
  const m = computeStockModel();
  const out = [];
  for (const a of m.articles) {
    if (a.status !== 'rupture' && a.status !== 'critique') continue;
    const qty = getStockReorderQty(a, m.settings);
    if (qty == null) continue;
    out.push({ ...a, reorderQty: qty, reorderCost: qty * (a.pmp || 0) });
  }
  return out.sort((x, y) => STOCK_STATUS[x.status].rank - STOCK_STATUS[y.status].rank
    || (x.days == null ? 1e9 : x.days) - (y.days == null ? 1e9 : y.days));
}

// Agrégation historique conservée pour compatibilité : les modules qui
// n'avaient besoin que du stock courant continuent d'appeler getStockSummary.
function getStockSummary() {
  return computeStockModel().articles.map(a => ({
    article: a.name, unit: a.unit, stock: a.stock, lastEntry: a.lastEntry, count: a.entries.length,
  }));
}
// Historique d'un article (le plus récent en premier) pour la fiche
function getArticleHistory(articleName) {
  const key = stockKey(articleName);
  return (state.stockEntries || [])
    .filter(e => stockKey(e.article) === key)
    .sort(compareStockEntries)
    .reverse();
}
// Liste unique des noms d'articles : ceux du journal ET ceux du catalogue,
// pour qu'une fiche créée d'avance soit proposée à la saisie.
function getAllArticleNames() {
  const set = new Map();
  for (const e of (state.stockEntries || [])) {
    const k = stockKey(e.article);
    if (k) set.set(k, e.article);
  }
  for (const f of Object.values(getStockArticles())) {
    if (f && f.key && !set.has(f.key)) set.set(f.key, f.name);
  }
  return Array.from(set.values()).sort((a, b) => a.localeCompare(b, 'fr'));
}

// Jours ouvrés (lun-ven) strictement après d1 et jusqu'à d2 inclus.
// Une semaine pleine entre lundi et lundi suivant → 5 jours.
function businessDaysBetweenISO(d1, d2) {
  const start = new Date(d1 + 'T00:00:00');
  const end   = new Date(d2 + 'T00:00:00');
  if (end <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1); // borne basse exclue
  while (cur <= end) {
    const dow = cur.getDay(); // 0 = dimanche, 6 = samedi
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}
// Projette une date en avant de n jours ouvrés (lun-ven), en sautant
// samedis et dimanches. Si la cible tombe sur un week-end le résultat
// sera le prochain jour ouvré.
function addBusinessDaysISO(iso, n) {
  if (n <= 0) return iso;
  const d = fromISO(iso);
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return toISO(d);
}
function getArticleDailyConsumption(articleName) {
  const key = (articleName || '').trim().toLowerCase();
  const sorted = state.stockEntries
    .filter(e => (e.article || '').trim().toLowerCase() === key)
    .sort(compareStockEntries);
  const inventories = sorted.filter(e => e.type === 'inventaire');
  if (inventories.length < 2) return null;
  let totalConsumed = 0;
  let totalDays = 0;
  for (let i = 1; i < inventories.length; i++) {
    const prev = inventories[i - 1];
    const cur  = inventories[i];
    // Comptage en jours ouvrés uniquement (lun-ven) — week-ends exclus
    // car le chantier n'est pas actif.
    const days = businessDaysBetweenISO(prev.date, cur.date);
    if (days <= 0) continue;
    // Bornes par POSITION dans le journal trié, pas par comparaison de dates :
    // une réception datée le jour même d'un inventaire était exclue ici alors
    // que le calcul du stock la comptait — les deux modules divergeaient.
    const iPrev = sorted.indexOf(prev), iCur = sorted.indexOf(cur);
    const received = sorted
      .slice(iPrev + 1, iCur)
      .filter(e => stockTypeOf(e) === 'reception')
      .reduce((s, e) => s + (Number(e.qty) || 0), 0);
    const released = sorted
      .slice(iPrev + 1, iCur)
      .filter(e => stockTypeOf(e) === 'sortie')
      .reduce((s, e) => s + (Number(e.qty) || 0), 0);
    // On borne à 0 : un net négatif (stock qui monte sans réception
    // enregistrée) indique probablement une réception oubliée, on
    // l'ignore pour ne pas biaiser la moyenne.
    const consumed = Math.max(0, (Number(prev.qty) || 0) + received - released - (Number(cur.qty) || 0));
    totalConsumed += consumed;
    totalDays += days;
  }
  if (totalDays === 0) return null;
  return totalConsumed / totalDays;
}
// À partir du stock courant et de la conso moyenne, estime le nombre de
// jours ouvrés restants + la date d'épuisement (à compter d'aujourd'hui).
// Épuisement estimé. Passe par le modèle : la consommation vient des sorties
// saisies dès qu'il y en a, et seulement à défaut de la déduction entre deux
// inventaires — c'est ce qui rend la carte « Stock critique » du tableau de
// bord vivante sans attendre deux campagnes de comptage.
function getArticleDepletion(articleName, currentStock) {
  const a = computeStockModel().articles.find(x => x.key === stockKey(articleName));
  if (a) return { daily: a.daily, days: a.days, date: a.date, source: a.dailySource, status: a.status };
  const daily = getArticleDailyConsumption(articleName);
  if (daily === null || daily <= 0) return { daily, days: null, date: null };
  if (currentStock <= 0) return { daily, days: 0, date: todayISO() };
  const days = Math.floor(currentStock / daily);
  return { daily, days, date: addBusinessDaysISO(todayISO(), days) };
}
function fmtRate(n) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function fmtStockQty(n) {
  return (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

// ====================================================================
//   CR (comptes-rendus) — un CR par semaine et par entreprise.
//   Structure : crEntries[companyId][weekId][sectionKey] = [{ id, text }]
// ====================================================================
// Rubriques fournies par défaut (les clés sont stables — elles servent
// d'identifiant pour entries, collapses, snapshots, et débloquent les
// aperçus spéciaux : avancement / effectifs / admin).
const CR_DEFAULT_SECTIONS = [
  { key: 'header',       label: 'En-tête' },
  { key: 'avancement',   label: 'Avancements' },
  { key: 'effectifs',    label: 'Effectifs' },
  { key: 'admin',        label: 'Administratif' },
  { key: 'etudes',       label: 'Études' },
  { key: 'planning',     label: 'Planning' },
  { key: 'execution',    label: 'Exécution' },
  { key: 'reclamations', label: 'Réclamations' }
];
const CR_BUILTIN_SECTION_KEYS = new Set(CR_DEFAULT_SECTIONS.map(s => s.key));

// Renvoie la liste effective des rubriques d'un CR :
//   - Built-in (avec label possiblement surchargé par state.crSectionLabels)
//   - Suivies des rubriques personnalisées de state.crCustomSections
// Utilisé partout où on itérait sur CR_SECTIONS.
function getCRSections() {
  const overrides = state.crSectionLabels || {};
  const builtIn = CR_DEFAULT_SECTIONS.map(s => ({
    key: s.key,
    label: overrides[s.key] || s.label,
    builtIn: true
  }));
  const custom = Array.isArray(state.crCustomSections)
    ? state.crCustomSections.map(s => ({ key: s.key, label: s.label, builtIn: false }))
    : [];
  return [...builtIn, ...custom];
}
function getCRSectionLabel(key) {
  const all = getCRSections();
  const s = all.find(x => x.key === key);
  return s ? s.label : key;
}
function isValidCRSectionKey(key) {
  if (CR_BUILTIN_SECTION_KEYS.has(key)) return true;
  return Array.isArray(state.crCustomSections) && state.crCustomSections.some(s => s.key === key);
}
// Renomme une rubrique (built-in OU custom). Validation : non vide,
// trim, max 60 chars. Pour les built-in : on stocke un override dans
// state.crSectionLabels (label par défaut récupérable en cas de reset).
function renameCRSection(key, newLabel) {
  const trimmed = (newLabel || '').trim().slice(0, 60);
  if (!trimmed) return false;
  if (CR_BUILTIN_SECTION_KEYS.has(key)) {
    if (!state.crSectionLabels) state.crSectionLabels = {};
    state.crSectionLabels[key] = trimmed;
  } else {
    const arr = state.crCustomSections || [];
    const s = arr.find(x => x.key === key);
    if (!s) return false;
    s.label = trimmed;
  }
  save();
  return true;
}
// Ajoute une rubrique personnalisée (label imposé). Génère une clé
// stable basée sur uid().
function addCRSection(label) {
  const trimmed = (label || '').trim().slice(0, 60);
  if (!trimmed) return null;
  if (!Array.isArray(state.crCustomSections)) state.crCustomSections = [];
  const key = 'custom_' + uid();
  state.crCustomSections.push({ key, label: trimmed });
  save();
  return key;
}
// Supprime une rubrique personnalisée + son contenu (entries, collapses)
// dans toutes les entreprises × semaines. Les built-in ne sont pas
// supprimables — elles débloquent des aperçus structurants.
function deleteCRSection(key) {
  if (CR_BUILTIN_SECTION_KEYS.has(key)) return false;
  state.crCustomSections = (state.crCustomSections || []).filter(s => s.key !== key);
  // Nettoyage des entries et collapses portant cette clé
  for (const cid of Object.keys(state.crEntries || {})) {
    for (const wid of Object.keys(state.crEntries[cid] || {})) {
      if (state.crEntries[cid][wid]) delete state.crEntries[cid][wid][key];
    }
  }
  for (const cid of Object.keys(state.crCollapsed || {})) {
    for (const wid of Object.keys(state.crCollapsed[cid] || {})) {
      if (state.crCollapsed[cid][wid]) delete state.crCollapsed[cid][wid][key];
    }
  }
  save();
  return true;
}
const CR_SECTION_KEYS = new Set(CR_DEFAULT_SECTIONS.map(s => s.key));
// Libellé de l'entreprise « interne » (gestionnaire de chantier) toujours
// proposé dans le menu Responsable, en plus de l'entreprise du CR courant.
const CR_INTERNAL_LABEL = 'BBGO';

// Migre les anciennes structures CR (sans niveau « semaine ») vers la
// nouvelle. Idempotent : ne fait rien si déjà au bon format. Appelée
// au load et avant chaque render.
function migrateCRState() {
  if (!state.crEntries)           state.crEntries           = {};
  if (!state.crCollapsed)         state.crCollapsed         = {};
  if (!state.crAvancementVisible) state.crAvancementVisible = {};
  if (!state.crAdminVisible)      state.crAdminVisible      = {};
  if (!state.crEffectifsVisible)  state.crEffectifsVisible  = {};
  if (!state.crSectionLabels)     state.crSectionLabels     = {};
  if (!Array.isArray(state.crCustomSections)) state.crCustomSections = [];
  if (!state.crWeeks)             state.crWeeks             = {};
  if (!state.crSelectedWeekId)    state.crSelectedWeekId    = {};
  // Pour chaque entreprise qui a une donnée CR : s'assure qu'au moins une
  // semaine existe ; si l'ancien format (clés = sectionKey) est détecté,
  // tout est replié sous CR 1.
  const allCompanyIds = new Set([
    ...Object.keys(state.crEntries),
    ...Object.keys(state.crCollapsed),
    ...Object.keys(state.crAvancementVisible)
  ]);
  for (const companyId of allCompanyIds) {
    const ensureWeek = () => {
      if (!state.crWeeks[companyId] || state.crWeeks[companyId].length === 0) {
        const w = { id: 'wk_' + uid(), label: 'CR 1', createdAt: Date.now() };
        state.crWeeks[companyId] = [w];
        return w.id;
      }
      return state.crWeeks[companyId][0].id;
    };
    // crEntries : ancien format = { [sectionKey]: [...] }
    const entries = state.crEntries[companyId];
    if (entries && typeof entries === 'object') {
      const someSec = Object.keys(entries).find(k => CR_SECTION_KEYS.has(k));
      if (someSec && Array.isArray(entries[someSec])) {
        const wid = ensureWeek();
        state.crEntries[companyId] = { [wid]: entries };
      }
    }
    // crCollapsed : ancien format = { _company, [sectionKey]: bool }
    const collapsed = state.crCollapsed[companyId];
    if (collapsed && typeof collapsed === 'object') {
      const hasOld = Object.keys(collapsed).some(k => k === '_company' || CR_SECTION_KEYS.has(k));
      if (hasOld) {
        const wid = ensureWeek();
        state.crCollapsed[companyId] = { [wid]: collapsed };
      }
    }
    // crAvancementVisible : ancien format = bool direct
    const av = state.crAvancementVisible[companyId];
    if (typeof av === 'boolean') {
      const wid = ensureWeek();
      state.crAvancementVisible[companyId] = { [wid]: av };
    }
  }
  // v0.94 : chaque entrée gagne crOrigin, echeance, responsable. Pour les
  // entrées préexistantes, on tag avec le label de la semaine où elles
  // sont actuellement stockées (approximation faute d'historique).
  for (const companyId of Object.keys(state.crEntries)) {
    const byWeek = state.crEntries[companyId];
    if (!byWeek || typeof byWeek !== 'object') continue;
    const weeks = state.crWeeks[companyId] || [];
    for (const wid of Object.keys(byWeek)) {
      const bySec = byWeek[wid];
      if (!bySec || typeof bySec !== 'object') continue;
      const wk = weeks.find(w => w.id === wid);
      const fallbackLabel = wk ? wk.label : '';
      for (const secKey of Object.keys(bySec)) {
        const list = bySec[secKey];
        if (!Array.isArray(list)) continue;
        for (const e of list) {
          if (typeof e.crOrigin    === 'undefined') e.crOrigin    = fallbackLabel;
          if (typeof e.echeance    === 'undefined') e.echeance    = null;
          if (typeof e.responsable === 'undefined') e.responsable = null;
          if (typeof e.done        === 'undefined') e.done        = false;
        }
      }
    }
  }
}

function getCRWeeks(companyId) {
  let weeks = state.crWeeks[companyId];
  if (!Array.isArray(weeks) || weeks.length === 0) {
    weeks = [{ id: 'wk_' + uid(), label: 'CR 1', createdAt: Date.now() }];
    state.crWeeks[companyId] = weeks;
  }
  return weeks;
}
function getCRSelectedWeek(companyId) {
  const weeks = getCRWeeks(companyId);
  const wantedId = state.crSelectedWeekId[companyId];
  if (wantedId) {
    const found = weeks.find(w => w.id === wantedId);
    if (found) return found;
  }
  // Par défaut : la dernière (la plus récente)
  return weeks[weeks.length - 1];
}
function setCRSelectedWeek(companyId, weekId) {
  state.crSelectedWeekId[companyId] = weekId;
  save();
}
// Renvoie le prochain label « CR N » en se basant sur le max numérique
// trouvé dans les labels existants, +1. Robuste aux suppressions :
// supprimer CR 2 dans [CR 1, CR 2, CR 3] et ré-ajouter → CR 4.
function getNextCRWeekLabel(weeks) {
  let max = 0;
  for (const w of weeks) {
    const m = /^CR\s+(\d+)$/i.exec(w.label || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'CR ' + (max + 1);
}
function addCRWeek(companyId) {
  const weeks = getCRWeeks(companyId);
  const prev = weeks[weeks.length - 1];
  // Fige les aperçus Avancements + Administratif de la semaine précédente
  // AVANT d'en ajouter une nouvelle. À partir de maintenant, la
  // précédente est un cliché immuable au moment de la bascule.
  if (prev && !Array.isArray(prev.avancementSnapshot)) {
    prev.avancementSnapshot = computeAvancementForCompany(companyId);
  }
  if (prev && !Array.isArray(prev.adminSnapshot)) {
    prev.adminSnapshot = computeAdminAlertsForCompany(companyId);
  }
  if (prev && !Array.isArray(prev.effectifsSnapshot)) {
    prev.effectifsSnapshot = computeEffectifsForCompany(companyId);
  }
  const newWeek = { id: 'wk_' + uid(), label: getNextCRWeekLabel(weeks), createdAt: Date.now() };
  weeks.push(newWeek);
  // Recopie intégrale du contenu de la semaine précédente vers la nouvelle.
  // À terme : on ne transmettra que les tâches non cochées « Faite » — mais
  // pour l'instant, full copy pour ne perdre aucune info.
  if (state.crEntries[companyId] && state.crEntries[companyId][prev.id]) {
    const prevSecs = state.crEntries[companyId][prev.id];
    const newSecs = {};
    for (const secKey of Object.keys(prevSecs)) {
      if (!Array.isArray(prevSecs[secKey])) continue;
      // Ne propage que les tâches NON cochées « Faite ». Les notes Faite
      // restent visibles dans le CR d'origine mais ne polluent plus les
      // CR suivants. crOrigin préservé pour tracer la naissance d'une tâche.
      newSecs[secKey] = prevSecs[secKey]
        .filter(e => !e.done)
        .map(e => {
          // Un widget d'avancement se reporte tel quel, déjà validé : on
          // repart des quantités de la semaine précédente et on les met à
          // jour. Le transformer en note viderait la saisie.
          if (isCRWidgetEntry(e)) {
            return {
              id: uid(), kind: 'widget', draft: false,
              title: e.title || '',
              unit: e.unit || '',
              qtyTotal: e.qtyTotal, qtyDone: e.qtyDone, qtyDoing: e.qtyDoing,
              crOrigin: e.crOrigin || prev.label
            };
          }
          return {
            id: uid(),
            text: e.text || '',
            crOrigin: e.crOrigin || prev.label,
            echeance: e.echeance || null,
            responsable: e.responsable || null,
            done: false
          };
        });
    }
    state.crEntries[companyId][newWeek.id] = newSecs;
  }
  // Recopie l'état des collapses
  if (state.crCollapsed[companyId] && state.crCollapsed[companyId][prev.id]) {
    state.crCollapsed[companyId][newWeek.id] = { ...state.crCollapsed[companyId][prev.id] };
  }
  // Recopie l'état de visibilité de l'aperçu Avancements
  if (state.crAvancementVisible[companyId] && state.crAvancementVisible[companyId][prev.id] === false) {
    if (!state.crAvancementVisible[companyId]) state.crAvancementVisible[companyId] = {};
    state.crAvancementVisible[companyId][newWeek.id] = false;
  }
  // Idem pour l'aperçu Administratif
  if (state.crAdminVisible[companyId] && state.crAdminVisible[companyId][prev.id] === false) {
    if (!state.crAdminVisible[companyId]) state.crAdminVisible[companyId] = {};
    state.crAdminVisible[companyId][newWeek.id] = false;
  }
  // Idem pour l'aperçu Effectifs
  if (state.crEffectifsVisible[companyId] && state.crEffectifsVisible[companyId][prev.id] === false) {
    if (!state.crEffectifsVisible[companyId]) state.crEffectifsVisible[companyId] = {};
    state.crEffectifsVisible[companyId][newWeek.id] = false;
  }
  state.crSelectedWeekId[companyId] = newWeek.id;
  save();
  renderCR();
}

// Renomme une semaine de CR. Validation : non vide, trim, max 50 chars.
// Le label peut être quelconque (« CR 17 », « Compte-rendu spécial »), ce
// qui permet de reprendre une numérotation existante établie hors appli.
// Le numéro auto-incrémenté (getNextCRWeekLabel) reste robuste : il scanne
// les labels au format /^CR\s+(\d+)$/ et continue à partir du max trouvé.
function renameCRWeek(companyId, weekId, newLabel) {
  const weeks = getCRWeeks(companyId);
  const w = weeks.find(x => x.id === weekId);
  if (!w) return;
  const trimmed = (newLabel || '').trim().slice(0, 50);
  if (!trimmed || trimmed === w.label) return;
  w.label = trimmed;
  save();
  renderCR();
}

// Supprime une semaine + son contenu (entries, collapses, visibilité).
// Si on supprime la semaine la plus récente, on « dégèle » la nouvelle
// dernière (qui redevient live).
// Avec les polices standard, jsPDF n'encode que le jeu WinAnsi. Un seul
// caractère hors jeu — typiquement l'espace fine insécable (U+202F) que
// toLocaleString('fr-FR') insère comme séparateur de milliers — le fait
// basculer en encodage 16 bits : le texte ressort alors lettre par lettre
// (« 2 5 0 / 1 0 0 0 »). On normalise donc TOUT texte à l'écriture, ce qui
// protège aussi les mesures de largeur et les retours à la ligne.
function pdfSafeText(v) {
  return String(v == null ? '' : v)
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2026/g, '...');
}
function hardenPdfText(pdf) {
  const t0 = pdf.text.bind(pdf);
  const s0 = pdf.splitTextToSize.bind(pdf);
  const w0 = pdf.getTextWidth.bind(pdf);
  pdf.text = (t, x, y, o, tr) => t0(Array.isArray(t) ? t.map(pdfSafeText) : pdfSafeText(t), x, y, o, tr);
  pdf.splitTextToSize = (t, w, o) => s0(pdfSafeText(t), w, o);
  pdf.getTextWidth = (t) => w0(pdfSafeText(t));
  return pdf;
}

// ====================================================================
//   Export PDF d'un CR — Design A « Rapport classique sobre »
//   A4 portrait, en-tête centré, rubriques numérotées, pagination
//   automatique, footer avec date + n° de page. Pure jsPDF (texte +
//   primitives géométriques), pas de html2canvas pour rester léger.
// ====================================================================
async function exportCRToPDF(companyId, weekId) {
  const company = state.companies.find(c => c.id === companyId);
  if (!company) { showToast('Entreprise introuvable', 'error'); return; }
  const weeks = getCRWeeks(companyId);
  const weekIdx = weeks.findIndex(w => w.id === weekId);
  if (weekIdx < 0) { showToast('Semaine introuvable', 'error'); return; }
  const week = weeks[weekIdx];
  const isLatest = weekIdx === weeks.length - 1;

  let jspdf;
  try {
    showToast('Génération du PDF…');
    jspdf = await loadJsPdf();
  } catch (e) {
    showToast('Impossible de charger jsPDF (connexion requise au 1er usage)', 'error');
    return;
  }
  const pdf = new jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  hardenPdfText(pdf);
  const PAGE_W = 210, PAGE_H = 297;
  const MARGIN = 18;
  const CONTENT_W = PAGE_W - 2 * MARGIN;
  let y = MARGIN;
  let pageNum = 1;

  // ----- Helpers internes -----
  const ensureSpace = (h) => {
    if (y + h > PAGE_H - 18) { addFooter(); pdf.addPage(); pageNum++; y = MARGIN; }
  };
  const addFooter = () => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120);
    const d = new Date();
    const stamp = `Édité le ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ` +
                  `à ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    pdf.text(stamp, MARGIN, PAGE_H - 10);
    pdf.text(`Page ${pageNum}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' });
    pdf.setTextColor(0);
  };
  const drawText = (txt, x, opts = {}) => {
    pdf.setFont(opts.font || 'helvetica', opts.style || 'normal');
    pdf.setFontSize(opts.size || 10);
    if (opts.color) pdf.setTextColor(...opts.color); else pdf.setTextColor(0);
    pdf.text(txt, x, y, opts.textOpts || {});
  };
  const wrapWrite = (txt, x, w, opts = {}) => {
    pdf.setFont(opts.font || 'helvetica', opts.style || 'normal');
    pdf.setFontSize(opts.size || 10);
    if (opts.color) pdf.setTextColor(...opts.color); else pdf.setTextColor(0);
    const lines = pdf.splitTextToSize(txt, w);
    const lh = (opts.size || 10) * 0.42;
    for (const line of lines) {
      ensureSpace(lh + 1);
      pdf.text(line, x, y);
      y += lh;
    }
  };
  // Convertit "#RRGGBB" → [r,g,b]
  const hexToRgb = (hex) => {
    const m = /^#?([a-f0-9]{6})$/i.exec((hex || '').trim());
    if (!m) return [128, 128, 128];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  // ----- En-tête centré -----
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16);
  pdf.text('COMPTE-RENDU DE CHANTIER', PAGE_W / 2, y, { align: 'center' });
  y += 8;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
  pdf.text(`Entreprise : ${company.name}    Semaine : ${week.label}`, PAGE_W / 2, y, { align: 'center' });
  y += 5;
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;
  pdf.setFontSize(9); pdf.setTextColor(100);
  pdf.text(`Édité le ${dateStr}${isLatest ? '' : ' — données figées'}`, PAGE_W / 2, y, { align: 'center' });
  pdf.setTextColor(0);
  y += 6;
  pdf.setDrawColor(60); pdf.setLineWidth(0.4);
  pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // ----- Rubriques en tableaux -----
  // Bandeau orange + tableau 4 colonnes (CR | Tâche | Échéance | Entreprise).
  // Pour Avancements et Administratif, on garde au-dessous l'aperçu riche
  // (barres / docs périmés) si l'interrupteur dans l'app est sur ON.
  const ORANGE = [237, 108, 2];
  const HEADER_GREY = [232, 232, 232];
  const ALT_ROW = [248, 248, 248];
  const colW = { cr: 18, task: 92, ech: 22, ent: CONTENT_W - 18 - 92 - 22 }; // = 42
  const colX = {
    cr:  MARGIN,
    task: MARGIN + colW.cr,
    ech:  MARGIN + colW.cr + colW.task,
    ent:  MARGIN + colW.cr + colW.task + colW.ech
  };
  const fmtEch = (iso) => {
    const [yy, mm, dd] = iso.split('-');
    return dd + '/' + mm + '/' + yy.slice(2);
  };
  const colorForEch = (iso) => {
    if (!iso || iso === 'PM') return { rgb: [60,60,60], bold: false };
    const target = new Date(iso + 'T00:00:00');
    const ref = new Date(); ref.setHours(0,0,0,0);
    const diff = Math.round((target - ref) / 86400000);
    if (diff < 0)  return { rgb: [183, 28, 28], bold: true };  // dépassé → rouge gras
    if (diff <= 7) return { rgb: [183, 80, 8],  bold: true };  // imminent → orange gras
    return { rgb: [60, 60, 60], bold: false };
  };
  // Affichage colonne échéance : PM = 'PM' (gris foncé italique), date = JJ/MM/AA, sinon '—'
  const echDisplay = (iso) => {
    if (iso === 'PM') return 'PM';
    if (iso) return fmtEch(iso);
    return '—';
  };
  const respLabelFor = (e) =>
    (e.responsable === null || e.responsable === 'BBGO' || !e.responsable)
      ? CR_INTERNAL_LABEL
      : (state.companies.find(c => c.id === e.responsable)?.name || CR_INTERNAL_LABEL);

  const drawSectionBanner = (num, label) => {
    ensureSpace(7);
    pdf.setFillColor(...ORANGE);
    pdf.rect(MARGIN, y, CONTENT_W, 6.5, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(255);
    pdf.text(`${num}.  ${label.toUpperCase()}`, MARGIN + 3, y + 4.5);
    pdf.setTextColor(0);
    y += 6.5;
  };
  const drawTableHeader = () => {
    ensureSpace(6);
    pdf.setFillColor(...HEADER_GREY);
    pdf.rect(MARGIN, y, CONTENT_W, 5.5, 'F');
    pdf.setDrawColor(180); pdf.setLineWidth(0.15);
    pdf.line(colX.task, y, colX.task, y + 5.5);
    pdf.line(colX.ech,  y, colX.ech,  y + 5.5);
    pdf.line(colX.ent,  y, colX.ent,  y + 5.5);
    pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
    pdf.line(MARGIN, y + 5.5, MARGIN + CONTENT_W, y + 5.5);
    pdf.line(MARGIN, y, MARGIN, y + 5.5);
    pdf.line(MARGIN + CONTENT_W, y, MARGIN + CONTENT_W, y + 5.5);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(50);
    pdf.text('CR',         colX.cr  + colW.cr / 2,  y + 3.7, { align: 'center' });
    pdf.text('Tâche',      colX.task + 2,           y + 3.7);
    pdf.text('Échéance',   colX.ech + colW.ech / 2, y + 3.7, { align: 'center' });
    pdf.text('Entreprise', colX.ent + 2,            y + 3.7);
    pdf.setTextColor(0);
    y += 5.5;
  };
  const drawTableRow = (e, isAlt) => {
    const padX = 1.8, padY = 1.6, lineH = 3.4;
    const taskText = (e.text || '').trim() || '(sans texte)';
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
    const taskLines = pdf.splitTextToSize(taskText, colW.task - padX * 2);
    const respText = respLabelFor(e);
    const respLines = pdf.splitTextToSize(respText, colW.ent - padX * 2);
    const nLines = Math.max(taskLines.length, respLines.length, 1);
    const rowH = nLines * lineH + padY * 2;
    ensureSpace(rowH);
    // Échéance dépassée → fond rouge pâle (prime sur l'alternance)
    let isOverdue = false;
    if (e.echeance && e.echeance !== 'PM') {
      const target = new Date(e.echeance + 'T00:00:00');
      const ref = new Date(); ref.setHours(0,0,0,0);
      isOverdue = target < ref;
    }
    if (isOverdue) {
      pdf.setFillColor(252, 228, 228);
      pdf.rect(MARGIN, y, CONTENT_W, rowH, 'F');
    } else if (isAlt) {
      pdf.setFillColor(...ALT_ROW);
      pdf.rect(MARGIN, y, CONTENT_W, rowH, 'F');
    }
    pdf.setDrawColor(180); pdf.setLineWidth(0.15);
    pdf.line(MARGIN, y + rowH, MARGIN + CONTENT_W, y + rowH);
    pdf.line(MARGIN, y, MARGIN, y + rowH);
    pdf.line(colX.task, y, colX.task, y + rowH);
    pdf.line(colX.ech,  y, colX.ech,  y + rowH);
    pdf.line(colX.ent,  y, colX.ent,  y + rowH);
    pdf.line(MARGIN + CONTENT_W, y, MARGIN + CONTENT_W, y + rowH);
    // CR origin (centré, gras léger)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(40);
    pdf.text(e.crOrigin || '—', colX.cr + colW.cr / 2, y + padY + 2.6, { align: 'center' });
    // Tâche (multi-ligne) — barrée + grisée si « Faite »
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(e.done ? 140 : 20);
    for (let i = 0; i < taskLines.length; i++) {
      const ty = y + padY + 2.6 + i * lineH;
      pdf.text(taskLines[i], colX.task + padX, ty);
      if (e.done) {
        // Barre horizontale au milieu de la ligne pour matérialiser le ✓
        const lineW = pdf.getTextWidth(taskLines[i]);
        pdf.setDrawColor(140); pdf.setLineWidth(0.25);
        pdf.line(colX.task + padX, ty - 1, colX.task + padX + lineW, ty - 1);
      }
    }
    // Échéance (couleur selon proximité ; PM affiché tel quel)
    const ech = colorForEch(e.echeance);
    pdf.setFont('helvetica', e.echeance === 'PM' ? 'italic' : (ech.bold ? 'bold' : 'normal'));
    pdf.setTextColor(...ech.rgb);
    pdf.text(echDisplay(e.echeance), colX.ech + colW.ech / 2, y + padY + 2.6, { align: 'center' });
    pdf.setTextColor(0);
    // Entreprise (multi-ligne si nom long)
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(20);
    for (let i = 0; i < respLines.length; i++) {
      pdf.text(respLines[i], colX.ent + padX, y + padY + 2.6 + i * lineH);
    }
    pdf.setTextColor(0);
    y += rowH;
  };
  const drawEmptyTableRow = () => {
    const rowH = 6;
    ensureSpace(rowH);
    pdf.setDrawColor(180); pdf.setLineWidth(0.15);
    pdf.rect(MARGIN, y, CONTENT_W, rowH);
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); pdf.setTextColor(140);
    pdf.text('Aucune tâche pour cette rubrique', PAGE_W / 2, y + 4, { align: 'center' });
    pdf.setTextColor(0);
    y += rowH;
  };

  // Barre empilée + légende en %, à une position et une largeur données.
  // Partagée par l'aperçu automatique et par les widgets manuels : le rendu
  // est donc strictement identique pour les deux.
  const AVANC_LABELS  = { done: 'Réalisée', doing: 'En cours', todo: 'À faire' };
  const AVANC_PALETTE = { done: [46,125,50], doing: [237,108,2], todo: [211,47,47] };
  const AVANC_BAR_H = 2.4;
  const drawAvancBar = (pct, barX, barW) => {
    const sum = (pct.done || 0) + (pct.doing || 0) + (pct.todo || 0);
    const norm = sum > 0 ? sum : 1;
    pdf.setFillColor(220, 220, 220);
    pdf.rect(barX, y, barW, AVANC_BAR_H, 'F');
    let bx = barX;
    for (const k of ['done', 'doing', 'todo']) {
      const w = barW * ((pct[k] || 0) / norm);
      if (w <= 0) continue;
      pdf.setFillColor(...AVANC_PALETTE[k]);
      pdf.rect(bx, y, w, AVANC_BAR_H, 'F');
      bx += w;
    }
    y += AVANC_BAR_H + 3.5;
    pdf.setFontSize(8.5);
    let legX = barX;
    for (const k of ['done', 'doing', 'todo']) {
      if ((pct[k] || 0) <= 0.01) continue;
      pdf.setFillColor(...AVANC_PALETTE[k]);
      pdf.circle(legX, y - 1.0, 0.9, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0);
      const pctTxt = `${Math.round(pct[k])} %`;
      pdf.text(pctTxt, legX + 2.2, y);
      const pctTxtW = pdf.getTextWidth(pctTxt);
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(110);
      pdf.text(AVANC_LABELS[k], legX + 2.2 + pctTxtW + 1.5, y);
      const lblW = pdf.getTextWidth(AVANC_LABELS[k]);
      pdf.setTextColor(0);
      legX += 2.2 + pctTxtW + 1.5 + lblW + 7;
    }
    pdf.setFontSize(10);
    y += 3.5;
  };

  // Tâche de l'aperçu automatique : titre, plans concernés, barre.
  const drawAvancTask = (task) => {
    ensureSpace(11);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    pdf.text(task.title || '(sans intitulé)', MARGIN + 8, y);
    y += 2;
    if (Array.isArray(task.planNames) && task.planNames.length > 0) {
      pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8.5); pdf.setTextColor(120);
      const lines = pdf.splitTextToSize(task.planNames.join(' · '), CONTENT_W - 12);
      for (const ln of lines) {
        ensureSpace(3.2);
        pdf.text(ln, MARGIN + 8, y + 1.8);
        y += 3.2;
      }
      pdf.setTextColor(0); pdf.setFontSize(10);
      y += 0.5;
    }
    drawAvancBar(task.pct, MARGIN + 8, CONTENT_W - 8);
  };

  // Widget manuel : encadré aligné sur le tableau de la rubrique, pour
  // qu'il se lise comme un bloc de cette rubrique et non comme un élément
  // flottant entre deux sections.
  const PAD = 4;
  const drawManualWidget = (w) => {
    const v = computeCRWidget(w);
    const metaTxt = crWidgetMetaText(v);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9);
    const metaW = metaTxt ? pdf.getTextWidth(metaTxt) + 6 : 0;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10);
    const titleLines = pdf.splitTextToSize(w.title || '(sans intitulé)', CONTENT_W - PAD * 2 - metaW);
    const lineH = 4;
    const boxH = PAD + titleLines.length * lineH + 1.5 + AVANC_BAR_H + 3.5 + 3.5 + PAD - 2;
    ensureSpace(boxH + 2);
    const boxY = y;
    pdf.setFillColor(248, 246, 243);
    pdf.setDrawColor(210); pdf.setLineWidth(0.2);
    pdf.rect(MARGIN, boxY, CONTENT_W, boxH, 'FD');
    y = boxY + PAD + 1;
    // Intitulé à gauche, quantités à droite, sur la même ligne de base.
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(20);
    for (let i = 0; i < titleLines.length; i++) pdf.text(titleLines[i], MARGIN + PAD, y + i * lineH);
    if (metaTxt) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(90);
      pdf.text(metaTxt, MARGIN + CONTENT_W - PAD, y, { align: 'right' });
    }
    pdf.setTextColor(0); pdf.setFontSize(10);
    y += (titleLines.length - 1) * lineH + 1.5;
    drawAvancBar(v.pct, MARGIN + PAD, CONTENT_W - PAD * 2);
    y = boxY + boxH;
  };

  let secNum = 0;
  for (const sec of getCRSections()) {
    secNum++;
    const allEntries = getCREntries(companyId, weekId, sec.key);
    // Les widgets manuels ne sont pas des lignes de tableau : ils se
    // dessinent sous la rubrique, à l'identique de l'aperçu automatique.
    const entries = allEntries.filter(e => !isCRWidgetEntry(e));
    const widgets = allEntries.filter(isCRWidgetEntry).filter(e => !e.draft);
    const showAvancPreview = sec.key === 'avancement' && isCRAvancementVisible(companyId, weekId);
    const showAdminPreview = sec.key === 'admin'      && isCRAdminVisible(companyId, weekId);
    const showEffPreview   = sec.key === 'effectifs'  && isCREffectifsVisible(companyId, weekId);

    // Bandeau orange + tableau de tâches
    drawSectionBanner(secNum, sec.label);
    drawTableHeader();
    if (entries.length === 0) {
      drawEmptyTableRow();
    } else {
      let i = 0;
      for (const e of entries) { drawTableRow(e, i % 2 === 1); i++; }
    }

    // Widgets d'avancement saisis à la main : accolés au tableau de la
    // rubrique, séparés entre eux d'un filet d'un millimètre.
    if (widgets.length > 0) {
      for (const w of widgets) { drawManualWidget(w); y += 1; }
      y += 2;
    }

    // Aperçu Avancements (conditionné à l'interrupteur app)
    if (showAvancPreview) {
      const lotsAgg = isLatest
        ? computeAvancementForCompany(companyId)
        : (Array.isArray(week.avancementSnapshot) ? week.avancementSnapshot : computeAvancementForCompany(companyId));
      if (lotsAgg && lotsAgg.length > 0 && lotsAgg.some(l => l.tasks.length > 0)) {
        y += 8;
        for (const lot of lotsAgg) {
          if (!lot.tasks || lot.tasks.length === 0) continue;
          ensureSpace(7);
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
          const lotRgb = hexToRgb(lot.color);
          pdf.setFillColor(...lotRgb);
          pdf.rect(MARGIN + 4, y - 3, 2.2, 4, 'F');
          pdf.text(lot.name.toUpperCase(), MARGIN + 8, y);
          y += 5;
          for (const task of lot.tasks) drawAvancTask(task);
          y += 1;
        }
      }
    }

    // Aperçu Effectifs : tableau HORIZONTAL (2 lignes × 10 colonnes).
    if (showEffPreview) {
      const effData = isLatest
        ? computeEffectifsForCompany(companyId)
        : (Array.isArray(week.effectifsSnapshot) ? week.effectifsSnapshot : computeEffectifsForCompany(companyId));
      if (Array.isArray(effData) && effData.length > 0) {
        y += 6;
        const ordered = effData.slice().reverse(); // gauche = plus ancien
        const cols = ordered.length;
        const colW = CONTENT_W / cols;
        const rowH = 6.5;
        const tx = MARGIN;
        ensureSpace(rowH * 2 + 1);
        let total = 0, worked = 0, wDays = 0;
        // Ligne 1 : dates (en-tête gris)
        for (let i = 0; i < cols; i++) {
          const row = ordered[i];
          const cellX = tx + i * colW;
          if (row.onWeather) pdf.setFillColor(220, 235, 250);
          else pdf.setFillColor(232, 232, 232);
          pdf.rect(cellX, y, colW, rowH, 'F');
          pdf.setDrawColor(180); pdf.setLineWidth(0.15);
          pdf.rect(cellX, y, colW, rowH, 'S');
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(50);
          const [, mm, dd] = row.date.split('-');
          pdf.text(`${dd}/${mm}`, cellX + colW / 2, y + 4.4, { align: 'center' });
        }
        y += rowH;
        // Ligne 2 : effectifs (+ 🌧 si intempéries)
        for (let i = 0; i < cols; i++) {
          const row = ordered[i];
          const cellX = tx + i * colW;
          if (row.onWeather) {
            pdf.setFillColor(235, 245, 255);
            pdf.rect(cellX, y, colW, rowH, 'F');
          }
          pdf.setDrawColor(180); pdf.setLineWidth(0.15);
          pdf.rect(cellX, y, colW, rowH, 'S');
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11); pdf.setTextColor(20);
          pdf.text(String(row.count), cellX + colW / 2, y + 4.4, { align: 'center' });
          total += row.count;
          if (row.count > 0) worked++;
          if (row.onWeather) wDays++;
        }
        pdf.setTextColor(0);
        y += rowH;
        // Synthèse
        ensureSpace(5);
        y += 1.5;
        const avg = worked > 0 ? (total / worked).toFixed(1).replace('.', ',') : '0';
        pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); pdf.setTextColor(90);
        const summary = `Total : ${total} présences sur ${worked}/10 jours travaillés (moy. ${avg}/j)`
          + (wDays > 0 ? ` — ${wDays} j d'intempéries (cellules bleues)` : '');
        pdf.text(summary, MARGIN + 4, y + 2.5);
        pdf.setTextColor(0);
        y += 4;
      }
    }

    // Aperçu Administratif (conditionné à l'interrupteur app)
    if (showAdminPreview) {
      const data = isLatest
        ? computeAdminAlertsForCompany(companyId)
        : (Array.isArray(week.adminSnapshot) ? week.adminSnapshot : computeAdminAlertsForCompany(companyId));
      if (data && data.length > 0) {
        y += 8;
        for (const w of data) {
          ensureSpace(6);
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10);
          pdf.text(w.workerName, MARGIN + 4, y);
          y += 4;
          for (const it of w.items) {
            ensureSpace(5);
            pdf.setFont('helvetica', it.isExpired ? 'bold' : 'normal');
            pdf.setFontSize(9.5);
            if (it.isExpired) pdf.setTextColor(183, 28, 28);
            else pdf.setTextColor(70);
            pdf.text('•', MARGIN + 9, y);
            const lines = pdf.splitTextToSize(it.text, CONTENT_W - 16);
            for (let li = 0; li < lines.length; li++) {
              if (li > 0) { ensureSpace(4); }
              pdf.text(lines[li], MARGIN + 13, y);
              if (li < lines.length - 1) y += 3.8;
            }
            pdf.setTextColor(0);
            y += 4.2;
          }
          y += 1;
        }
      }
    }

    y += 6;
  }

  addFooter();

  // Nom de fichier sûr (pas de caractères chemin)
  const safe = (s) => (s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const fname = `CR_${safe(company.name)}_${safe(week.label)}_${dateStr.replace(/\//g, '-')}.pdf`;
  pdf.save(fname);
  showToast('PDF exporté ✓');
}

function deleteCRWeek(companyId, weekId) {
  const weeks = getCRWeeks(companyId);
  const idx = weeks.findIndex(w => w.id === weekId);
  if (idx < 0) return;
  const wasLatest = idx === weeks.length - 1;
  weeks.splice(idx, 1);
  if (state.crEntries[companyId])           delete state.crEntries[companyId][weekId];
  if (state.crCollapsed[companyId])         delete state.crCollapsed[companyId][weekId];
  if (state.crAvancementVisible[companyId]) delete state.crAvancementVisible[companyId][weekId];
  if (state.crAdminVisible[companyId])      delete state.crAdminVisible[companyId][weekId];
  if (state.crEffectifsVisible[companyId])  delete state.crEffectifsVisible[companyId][weekId];
  if (state.crSelectedWeekId[companyId] === weekId) delete state.crSelectedWeekId[companyId];
  if (wasLatest && weeks.length > 0) {
    const newLast = weeks[weeks.length - 1];
    delete newLast.avancementSnapshot;
    delete newLast.adminSnapshot;
    delete newLast.effectifsSnapshot;
  }
  save();
  renderCR();
  showToast('Compte-rendu supprimé');
}

function getCREntries(companyId, weekId, sectionKey) {
  const c = state.crEntries[companyId];
  if (!c || !c[weekId] || !Array.isArray(c[weekId][sectionKey])) return [];
  return c[weekId][sectionKey];
}
function ensureCRBucket(companyId, weekId, sectionKey) {
  if (!state.crEntries[companyId]) state.crEntries[companyId] = {};
  if (!state.crEntries[companyId][weekId]) state.crEntries[companyId][weekId] = {};
  if (!Array.isArray(state.crEntries[companyId][weekId][sectionKey])) {
    state.crEntries[companyId][weekId][sectionKey] = [];
  }
  return state.crEntries[companyId][weekId][sectionKey];
}
function isCRCollapsed(companyId, weekId, sectionKey) {
  return !!(state.crCollapsed[companyId] && state.crCollapsed[companyId][weekId] && state.crCollapsed[companyId][weekId][sectionKey]);
}
function toggleCRCollapsed(companyId, weekId, sectionKey) {
  if (!state.crCollapsed[companyId]) state.crCollapsed[companyId] = {};
  if (!state.crCollapsed[companyId][weekId]) state.crCollapsed[companyId][weekId] = {};
  const bag = state.crCollapsed[companyId][weekId];
  if (bag[sectionKey]) delete bag[sectionKey];
  else bag[sectionKey] = true;
  save();
}
function addCREntry(companyId, weekId, sectionKey) {
  const list = ensureCRBucket(companyId, weekId, sectionKey);
  const weeks = getCRWeeks(companyId);
  const wk = weeks.find(w => w.id === weekId);
  list.push({
    id: uid(),
    text: '',
    crOrigin: wk ? wk.label : '',  // ← n° du CR où la note est née
    echeance: null,                // ← 'YYYY-MM-DD' | 'PM' (pour mémoire) | null
    responsable: null,             // ← 'BBGO' | companyId | null (défaut BBGO au render)
    done: false                    // ← case « Faite » cochée par l'utilisateur
  });
  // Force le dépliage de la section quand on ajoute une note
  if (state.crCollapsed[companyId] && state.crCollapsed[companyId][weekId]) {
    delete state.crCollapsed[companyId][weekId][sectionKey];
  }
  save();
  renderCR();
  // Focus le nouveau textarea pour saisie immédiate
  requestAnimationFrame(() => {
    const last = document.querySelector(
      `.cr-entry[data-company-id="${companyId}"][data-week-id="${weekId}"][data-section-key="${sectionKey}"]:last-of-type textarea`
    );
    if (last) last.focus();
  });
}
function updateCREntry(companyId, weekId, sectionKey, entryId, text) {
  setCREntryField(companyId, weekId, sectionKey, entryId, 'text', text);
}
function setCREntryField(companyId, weekId, sectionKey, entryId, field, value) {
  const list = getCREntries(companyId, weekId, sectionKey);
  const entry = list.find(e => e.id === entryId);
  if (!entry) return;
  if (field === 'echeance')         entry.echeance    = value || null;
  else if (field === 'responsable') entry.responsable = value || null;
  else if (field === 'text')        entry.text        = value;
  else if (field === 'done')        entry.done        = !!value;
  save();
}
function deleteCREntry(companyId, weekId, sectionKey, entryId) {
  if (!state.crEntries[companyId] || !state.crEntries[companyId][weekId]) return;
  const list = state.crEntries[companyId][weekId][sectionKey];
  if (!Array.isArray(list)) return;
  state.crEntries[companyId][weekId][sectionKey] = list.filter(e => e.id !== entryId);
  save();
  renderCR();
}

function getCRSelectedCompany() {
  if (!state.companies.length) return null;
  if (state.crSelectedCompanyId) {
    const c = state.companies.find(c => c.id === state.crSelectedCompanyId);
    if (c) return c;
  }
  return state.companies[0];
}
function setCRSelectedCompany(companyId) {
  state.crSelectedCompanyId = companyId;
  save();
  renderCR();
}
function isCRAvancementVisible(companyId, weekId) {
  // Visible par défaut (clé absente = true)
  const bag = state.crAvancementVisible[companyId];
  if (!bag) return true;
  return bag[weekId] !== false;
}
function setCRAvancementVisible(companyId, weekId, visible) {
  if (!state.crAvancementVisible[companyId]) state.crAvancementVisible[companyId] = {};
  if (visible) delete state.crAvancementVisible[companyId][weekId];
  else state.crAvancementVisible[companyId][weekId] = false;
  save();
}
function isCRAdminVisible(companyId, weekId) {
  const bag = state.crAdminVisible[companyId];
  if (!bag) return true;
  return bag[weekId] !== false;
}
function setCRAdminVisible(companyId, weekId, visible) {
  if (!state.crAdminVisible[companyId]) state.crAdminVisible[companyId] = {};
  if (visible) delete state.crAdminVisible[companyId][weekId];
  else state.crAdminVisible[companyId][weekId] = false;
  save();
}
function isCREffectifsVisible(companyId, weekId) {
  const bag = state.crEffectifsVisible[companyId];
  if (!bag) return true;
  return bag[weekId] !== false;
}
function setCREffectifsVisible(companyId, weekId, visible) {
  if (!state.crEffectifsVisible[companyId]) state.crEffectifsVisible[companyId] = {};
  if (visible) delete state.crEffectifsVisible[companyId][weekId];
  else state.crEffectifsVisible[companyId][weekId] = false;
  save();
}

// Snapshot des 10 derniers jours de présences + intempéries pour une
// entreprise. Inclut TOUS les jours de la fenêtre (count=0 si pas de
// saisie), du plus récent au plus ancien. refDate par défaut = aujourd'hui.
//   → [{ date: 'YYYY-MM-DD', count: number, onWeather: boolean }]
function computeEffectifsForCompany(companyId, refDate) {
  const ref = refDate ? fromISO(refDate) : new Date();
  ref.setHours(0,0,0,0);
  const out = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(ref); d.setDate(d.getDate() - i);
    const iso = toISO(d);
    const entries = (state.presences && state.presences[iso]) || [];
    const entry = entries.find(e => e.companyId === companyId);
    out.push({
      date: iso,
      count: entry ? entry.count : 0,
      onWeather: isCompanyOnWeather(iso, companyId)
    });
  }
  return out;
}

// Calcule la liste des alertes documentaires (statut expired/danger/
// warning) pour les ouvriers d'une entreprise. Retourne une structure
// snapshot-able :
//   [{ workerName, items: [{ text, isExpired }] }]
// Mêmes règles métier que buildExpiryReport, juste filtrées par entreprise.
function computeAdminAlertsForCompany(companyId) {
  const out = [];
  const workers = (typeof getCompanyWorkers === 'function')
    ? getCompanyWorkers(companyId)
    : (state.workers || []).filter(w => w.companyId === companyId);
  for (const worker of workers) {
    const docs = getWorkerDocs(worker.id);
    const items = [];
    for (const docId of getApplicableDocIds(docs.employmentType)) {
      const type = getDocType(docId);
      const status = getDocStatus(worker.id, docId);
      if (status !== 'expired' && status !== 'danger' && status !== 'warning') continue;
      const label = getDocLabel(docId);
      if (type === 'echeance') {
        const date = getDocValue(worker.id, docId);
        if (!date) continue;
        const verb = (status === 'expired') ? 'est arrivé à échéance le' : 'arrivera à échéance le';
        items.push({ text: `${label} ${verb} ${fmtFR(date)}`, isExpired: status === 'expired' });
      } else if (type === 'validation') {
        items.push({ text: `${label} est non conforme`, isExpired: true });
      } else if (type === 'caces') {
        const list = getDocValue(worker.id, docId) || [];
        for (const c of list) {
          const s = expiryStatus(c.expiresAt);
          if (s !== 'expired' && s !== 'danger' && s !== 'warning') continue;
          const subName = (c.name?.trim()) || label;
          const verb = (s === 'expired') ? 'est arrivé à échéance le' : 'arrivera à échéance le';
          items.push({ text: `${subName} ${verb} ${fmtFR(c.expiresAt)}`, isExpired: s === 'expired' });
        }
      }
    }
    if (items.length > 0) {
      out.push({ workerName: worker.name?.trim() || '(ouvrier sans nom)', items });
    }
  }
  return out;
}

function renderCR() {
  migrateCRState();
  const slider     = document.getElementById('crslider');
  const weekSlider = document.getElementById('crweekslider');
  const body       = document.getElementById('crbody');
  const empty      = document.getElementById('crempty');
  if (!slider || !body) return;
  slider.innerHTML = '';
  if (weekSlider) weekSlider.innerHTML = '';
  body.innerHTML = '';
  if (!state.companies.length) {
    if (empty) empty.hidden = false;
    slider.hidden = true;
    if (weekSlider) weekSlider.hidden = true;
    body.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  slider.hidden = false;
  if (weekSlider) weekSlider.hidden = false;
  body.hidden = false;
  // Slider 1 : un chip par entreprise
  const selected = getCRSelectedCompany();
  for (const c of state.companies) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cr-slider-chip' + (selected && c.id === selected.id ? ' is-active' : '');
    chip.dataset.crAction = 'select-company';
    chip.dataset.companyId = c.id;
    chip.textContent = c.name;
    slider.appendChild(chip);
  }
  if (!selected) return;
  // Slider 2 : un chip par semaine de CR + bouton « + Nouvelle semaine »
  const weeks = getCRWeeks(selected.id);
  const activeWeek = getCRSelectedWeek(selected.id);
  if (weekSlider) {
    for (const w of weeks) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cr-week-chip' + (activeWeek && w.id === activeWeek.id ? ' is-active' : '');
      chip.dataset.crAction = 'select-week';
      chip.dataset.companyId = selected.id;
      chip.dataset.weekId = w.id;
      chip.textContent = w.label;
      weekSlider.appendChild(chip);
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'cr-week-add';
    addBtn.dataset.crAction = 'add-week';
    addBtn.dataset.companyId = selected.id;
    addBtn.setAttribute('aria-label', 'Nouvelle semaine');
    addBtn.textContent = '+ Nouvelle semaine';
    weekSlider.appendChild(addBtn);
  }
  // Body : la carte de l'entreprise/semaine sélectionnées
  const isLatest = activeWeek.id === weeks[weeks.length - 1].id;
  body.appendChild(buildCRCompanyCard(selected, activeWeek, isLatest));
}

function buildCRCompanyCard(company, week, isLatest) {
  const card = document.createElement('div');
  card.className = 'cr-company';
  card.dataset.companyId = company.id;
  card.dataset.weekId = week.id;
  const companyCollapsed = isCRCollapsed(company.id, week.id, '_company');
  if (companyCollapsed) card.classList.add('is-collapsed');

  const headWrap = document.createElement('div');
  headWrap.className = 'cr-company-head-wrap';
  // Le bandeau d'en-tête est un bouton pour permettre de replier la
  // carte. Le bouton de suppression est mis HORS du bouton pour qu'un
  // tap dessus ne déclenche pas aussi le collapse.
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'cr-company-head';
  head.dataset.crAction = 'toggle-company';
  head.dataset.companyId = company.id;
  head.dataset.weekId = week.id;
  head.innerHTML = `
    <span class="cr-collapse-icon">${companyCollapsed ? '+' : '−'}</span>
    <span class="cr-company-name">${escapeHtml(company.name)} <span class="cr-company-week">— ${escapeHtml(week.label)}${isLatest ? '' : ' (figé)'}</span></span>
  `;
  headWrap.appendChild(head);
  const ren = document.createElement('button');
  ren.type = 'button';
  ren.className = 'cr-rename-btn';
  ren.dataset.crAction = 'rename-week';
  ren.dataset.companyId = company.id;
  ren.dataset.weekId = week.id;
  ren.setAttribute('aria-label', 'Renommer ce compte-rendu');
  ren.setAttribute('title', 'Renommer ce compte-rendu');
  ren.innerHTML = '✏️';
  headWrap.appendChild(ren);
  const exp = document.createElement('button');
  exp.type = 'button';
  exp.className = 'cr-export-btn';
  exp.dataset.crAction = 'export-pdf';
  exp.dataset.companyId = company.id;
  exp.dataset.weekId = week.id;
  exp.setAttribute('aria-label', 'Exporter en PDF');
  exp.setAttribute('title', 'Exporter en PDF');
  exp.innerHTML = '📄';
  headWrap.appendChild(exp);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'cr-week-delete';
  del.dataset.crAction = 'delete-week';
  del.dataset.companyId = company.id;
  del.dataset.weekId = week.id;
  del.setAttribute('aria-label', 'Supprimer ce compte-rendu');
  del.setAttribute('title', 'Supprimer ce compte-rendu');
  del.innerHTML = '×';
  headWrap.appendChild(del);
  card.appendChild(headWrap);

  const body = document.createElement('div');
  body.className = 'cr-company-body';
  for (const sec of getCRSections()) {
    body.appendChild(buildCRSection(company.id, week, isLatest, sec));
  }
  // Bouton « + Rubrique » : ajoute une rubrique personnalisée à la fin.
  // S'applique à toutes les entreprises × semaines (les rubriques sont
  // partagées globalement — cohérent avec les built-in).
  const addSecBtn = document.createElement('button');
  addSecBtn.type = 'button';
  addSecBtn.className = 'cr-add-section';
  addSecBtn.dataset.crAction = 'add-section';
  addSecBtn.dataset.companyId = company.id;
  addSecBtn.dataset.weekId = week.id;
  addSecBtn.textContent = '+ Rubrique';
  body.appendChild(addSecBtn);
  card.appendChild(body);
  return card;
}

function buildCRSection(companyId, week, isLatest, sec) {
  const weekId = week.id;
  const wrap = document.createElement('div');
  wrap.className = 'cr-section';
  const collapsed = isCRCollapsed(companyId, weekId, sec.key);
  if (collapsed) wrap.classList.add('is-collapsed');

  const head = document.createElement('div');
  head.className = 'cr-section-head';
  const toggleBtn = `<button type="button" class="cr-section-toggle" data-cr-action="toggle-section" data-company-id="${companyId}" data-week-id="${weekId}" data-section-key="${sec.key}" aria-label="${collapsed ? 'Déplier' : 'Replier'}">${collapsed ? '+' : '−'}</button>`;
  const addAction = sec.key === 'avancement' ? 'add-choose' : 'add-entry';
  const addLabel  = sec.key === 'avancement' ? 'Ajouter une tâche ou un widget' : 'Ajouter une note';
  const addBtn    = `<button type="button" class="cr-add-entry" data-cr-action="${addAction}" data-company-id="${companyId}" data-week-id="${weekId}" data-section-key="${sec.key}" aria-label="${addLabel}">+</button>`;
  // Avancements : aperçu read-only + interrupteur ; mais on garde aussi le
  // bouton « + » pour permettre d'ajouter des notes libres au-dessus
  // de l'aperçu (cohérent avec les autres rubriques).
  if (sec.key === 'avancement') {
    const visible = isCRAvancementVisible(companyId, weekId);
    head.innerHTML = `
      ${toggleBtn}
      <button type="button" class="cr-section-name" data-cr-action="rename-section" data-company-id="${companyId}" data-week-id="${weekId}" data-section-key="${sec.key}" title="${sec.builtIn ? 'Tapotez pour renommer cette rubrique' : 'Tapotez pour renommer (laisser vide = supprimer)'}">${escapeHtml(sec.label)}</button>
      <label class="cr-switch" title="Inclure l'aperçu dans le compte-rendu">
        <input type="checkbox" data-cr-action="toggle-avancement-visible" data-company-id="${companyId}" data-week-id="${weekId}" ${visible ? 'checked' : ''}>
        <span class="cr-switch-track"><span class="cr-switch-thumb"></span></span>
      </label>
      ${addBtn}
    `;
  } else if (sec.key === 'admin') {
    const visible = isCRAdminVisible(companyId, weekId);
    head.innerHTML = `
      ${toggleBtn}
      <button type="button" class="cr-section-name" data-cr-action="rename-section" data-company-id="${companyId}" data-week-id="${weekId}" data-section-key="${sec.key}" title="${sec.builtIn ? 'Tapotez pour renommer cette rubrique' : 'Tapotez pour renommer (laisser vide = supprimer)'}">${escapeHtml(sec.label)}</button>
      <label class="cr-switch" title="Inclure l'aperçu dans le compte-rendu">
        <input type="checkbox" data-cr-action="toggle-admin-visible" data-company-id="${companyId}" data-week-id="${weekId}" ${visible ? 'checked' : ''}>
        <span class="cr-switch-track"><span class="cr-switch-thumb"></span></span>
      </label>
      ${addBtn}
    `;
  } else if (sec.key === 'effectifs') {
    const visible = isCREffectifsVisible(companyId, weekId);
    head.innerHTML = `
      ${toggleBtn}
      <button type="button" class="cr-section-name" data-cr-action="rename-section" data-company-id="${companyId}" data-week-id="${weekId}" data-section-key="${sec.key}" title="${sec.builtIn ? 'Tapotez pour renommer cette rubrique' : 'Tapotez pour renommer (laisser vide = supprimer)'}">${escapeHtml(sec.label)}</button>
      <label class="cr-switch" title="Inclure l'aperçu dans le compte-rendu">
        <input type="checkbox" data-cr-action="toggle-effectifs-visible" data-company-id="${companyId}" data-week-id="${weekId}" ${visible ? 'checked' : ''}>
        <span class="cr-switch-track"><span class="cr-switch-thumb"></span></span>
      </label>
      ${addBtn}
    `;
  } else {
    head.innerHTML = `
      ${toggleBtn}
      <button type="button" class="cr-section-name" data-cr-action="rename-section" data-company-id="${companyId}" data-week-id="${weekId}" data-section-key="${sec.key}" title="${sec.builtIn ? 'Tapotez pour renommer cette rubrique' : 'Tapotez pour renommer (laisser vide = supprimer)'}">${escapeHtml(sec.label)}</button>
      ${addBtn}
    `;
  }
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'cr-section-body';
  // Notes libres en haut, aperçu en bas pour Avancements / Effectifs / Administratif.
  const hasPreview = sec.key === 'avancement' || sec.key === 'admin' || sec.key === 'effectifs';
  const entries = getCREntries(companyId, weekId, sec.key);
  if (entries.length > 0) {
    for (const entry of entries) {
      body.appendChild(isCRWidgetEntry(entry)
        ? buildCRWidgetEntry(companyId, weekId, sec.key, entry)
        : buildCREntry(companyId, weekId, sec.key, entry));
    }
  } else if (!hasPreview) {
    const placeholder = document.createElement('p');
    placeholder.className = 'cr-section-empty';
    placeholder.textContent = 'Aucune note. Touchez + pour en ajouter une.';
    body.appendChild(placeholder);
  }
  if (sec.key === 'avancement') {
    const previewWrap = document.createElement('div');
    previewWrap.className = 'cr-avanc-preview';
    buildCRAvancementBody(previewWrap, companyId, week, isLatest);
    body.appendChild(previewWrap);
  } else if (sec.key === 'effectifs') {
    const previewWrap = document.createElement('div');
    previewWrap.className = 'cr-eff-preview';
    buildCREffectifsBody(previewWrap, companyId, week, isLatest);
    body.appendChild(previewWrap);
  } else if (sec.key === 'admin') {
    const previewWrap = document.createElement('div');
    previewWrap.className = 'cr-admin-preview';
    buildCRAdminBody(previewWrap, companyId, week, isLatest);
    body.appendChild(previewWrap);
  }
  wrap.appendChild(body);
  return wrap;
}

// Calcule la structure de données « Avancements » pour une entreprise
// (mêmes données que Suivi → Récap, agrégées sur tous les plans).
// Retourne { lots: [{ lotId, name, color, tasks: [{title,type,total,vols,pct}] }] }.
function computeAvancementForCompany(companyId) {
  const companyLots = getWorkBatches().filter(l => l.companyId === companyId);
  const out = [];
  for (const lot of companyLots) {
    // Une entrée par couple (plan, titre, type) : on NE fusionne PLUS les
    // tâches de même nom à travers les plans, sinon on ne voit pas si
    // l'avancement « Désamiantage » concerne le RDC ou l'étage. Le nom
    // du plan reste affiché sous chaque barre via planNames.
    const tasks = [];
    for (const plan of getProtoPlans()) {
      const planLots = getProtoRecapData(plan.id);
      const lotRecap = planLots.find(l => l.lotId === lot.id);
      if (!lotRecap) continue;
      const planName = (plan.name || '(plan sans nom)').trim();
      for (const t of lotRecap.tasks) {
        if (!(t.total > 0)) continue;
        const total = t.total;
        tasks.push({
          title: t.title,
          type: t.type,
          total,
          vols: { todo: t.vols.todo, doing: t.vols.doing, done: t.vols.done },
          pct: {
            todo:  (t.vols.todo  / total) * 100,
            doing: (t.vols.doing / total) * 100,
            done:  (t.vols.done  / total) * 100
          },
          planNames: [planName]
        });
      }
    }
    // Tri : alphabétique par titre, puis par nom de plan (pour grouper
    // visuellement les « Désamiantage » de tous les plans entre eux).
    tasks.sort((a, b) => {
      const byTitle = (a.title || 'ZZZ').localeCompare(b.title || 'ZZZ', 'fr');
      if (byTitle !== 0) return byTitle;
      return (a.planNames[0] || '').localeCompare(b.planNames[0] || '', 'fr');
    });
    out.push({
      lotId: lot.id,
      name: lot.name || '(lot sans nom)',
      color: lot.color || '#9aa0a6',
      tasks
    });
  }
  return out;
}

// Aperçu des avancements d'une entreprise pour une semaine donnée :
// - Si week est la dernière (isLatest) → données live (recalculées
//   à chaque rendu, suivent Suivi → Récap).
// - Sinon → snapshot figé pris au moment où une semaine suivante a été
//   créée. Si aucun snapshot n'existe (CR créés avant v0.90), on en
//   construit un à la volée à partir des données actuelles et on le
//   persiste : à partir de là, la rubrique est figée.
function buildCRAvancementBody(body, companyId, week, isLatest) {
  if (!isCRAvancementVisible(companyId, week.id)) {
    const off = document.createElement('p');
    off.className = 'cr-section-empty';
    off.textContent = 'Aperçu masqué (ne sera pas inclus dans l\'export PDF).';
    body.appendChild(off);
    return;
  }
  const companyLots = getWorkBatches().filter(l => l.companyId === companyId);
  if (companyLots.length === 0 && isLatest) {
    const none = document.createElement('p');
    none.className = 'cr-section-empty';
    none.textContent = 'Aucun lot n\'est rattaché à cette entreprise. Allez dans Données → Lots pour faire le lien.';
    body.appendChild(none);
    return;
  }
  let lotsAgg;
  if (isLatest) {
    lotsAgg = computeAvancementForCompany(companyId);
  } else {
    // Snapshot : utilise celui stocké sur la semaine, sinon back-fill
    // (semaines créées avant v0.90).
    if (!Array.isArray(week.avancementSnapshot)) {
      week.avancementSnapshot = computeAvancementForCompany(companyId);
      save();
    }
    lotsAgg = week.avancementSnapshot;
  }
  const anyTask = lotsAgg.some(l => l.tasks.length > 0);
  if (!anyTask) {
    const none = document.createElement('p');
    none.className = 'cr-section-empty';
    none.textContent = isLatest
      ? 'Aucune tâche n\'a encore été documentée sur les plans pour les lots de cette entreprise.'
      : 'Aucun avancement n\'avait été enregistré pour cette semaine.';
    body.appendChild(none);
    return;
  }
  if (!isLatest) {
    const badge = document.createElement('p');
    badge.className = 'cr-avanc-frozen-note';
    badge.textContent = '🔒 Aperçu figé à la création de la semaine suivante.';
    body.appendChild(badge);
  }
  for (const lotData of lotsAgg) {
    if (lotData.tasks.length === 0) continue;
    const lotCard = document.createElement('div');
    lotCard.className = 'cr-avanc-lot';
    lotCard.style.borderLeftColor = lotData.color || 'var(--accent)';
    let lotTotal = 0, lotDone = 0;
    for (const t of lotData.tasks) { lotTotal += t.total; lotDone += t.vols.done; }
    const lotPct = lotTotal > 0 ? Math.round((lotDone / lotTotal) * 100) : 0;
    const head = document.createElement('div');
    head.className = 'cr-avanc-lot-head';
    head.innerHTML = `
      <span class="cr-avanc-lot-name"></span>
      <span class="cr-avanc-lot-pct"></span>
    `;
    head.querySelector('.cr-avanc-lot-name').textContent = lotData.name || '(lot sans nom)';
    const pctEl = head.querySelector('.cr-avanc-lot-pct');
    pctEl.textContent = lotPct + ' %';
    pctEl.style.color = lotData.color || 'var(--accent)';
    lotCard.appendChild(head);
    const ul = document.createElement('ul');
    ul.className = 'cr-avanc-task-list';
    for (const t of lotData.tasks) ul.appendChild(buildCRAvancTaskRow(t));
    lotCard.appendChild(ul);
    body.appendChild(lotCard);
  }
}
// Aperçu Administratif : liste des ouvriers de l'entreprise dont au
// Aperçu Effectifs : tableau HORIZONTAL des 10 derniers jours.
// 2 lignes : (1) dates JJ/MM, (2) nombre de présents. Les jours en
// intempéries voient leur cellule teintée bleu pâle + 🌧 sous le chiffre.
// Live pour la dernière semaine, snapshot pour les précédentes.
function buildCREffectifsBody(body, companyId, week, isLatest) {
  if (!isCREffectifsVisible(companyId, week.id)) {
    const off = document.createElement('p');
    off.className = 'cr-section-empty';
    off.textContent = 'Aperçu masqué (ne sera pas inclus dans l\'export PDF).';
    body.appendChild(off);
    return;
  }
  let data;
  if (isLatest) {
    data = computeEffectifsForCompany(companyId);
  } else {
    if (!Array.isArray(week.effectifsSnapshot)) {
      week.effectifsSnapshot = computeEffectifsForCompany(companyId);
      save();
    }
    data = week.effectifsSnapshot;
  }
  if (!Array.isArray(data) || data.length === 0) {
    const none = document.createElement('p');
    none.className = 'cr-section-empty';
    none.textContent = 'Aucune donnée de présence disponible.';
    body.appendChild(none);
    return;
  }
  if (!isLatest) {
    const badge = document.createElement('p');
    badge.className = 'cr-avanc-frozen-note';
    badge.textContent = '🔒 Aperçu figé à la création de la semaine suivante.';
    body.appendChild(badge);
  }
  // Du plus ancien (gauche) au plus récent (droite) — lecture naturelle.
  const ordered = data.slice().reverse();
  const scroll = document.createElement('div');
  scroll.className = 'cr-eff-scroll';
  const table = document.createElement('table');
  table.className = 'cr-eff-htable';
  const trDates = document.createElement('tr');
  const trCounts = document.createElement('tr');
  let totalPresences = 0, daysWithCount = 0, weatherDays = 0;
  for (const row of ordered) {
    const [, mm, dd] = row.date.split('-');
    const thDate = document.createElement('th');
    thDate.scope = 'col';
    thDate.textContent = dd + '/' + mm;
    if (row.onWeather) thDate.classList.add('is-weather');
    trDates.appendChild(thDate);
    const tdCount = document.createElement('td');
    if (row.onWeather) {
      tdCount.classList.add('is-weather');
      tdCount.innerHTML = `<span class="cr-eff-h-num">${row.count}</span><span class="cr-eff-h-wsym" aria-label="intempéries">🌧</span>`;
    } else {
      tdCount.textContent = row.count;
    }
    trCounts.appendChild(tdCount);
    totalPresences += row.count;
    if (row.count > 0) daysWithCount++;
    if (row.onWeather) weatherDays++;
  }
  const thead = document.createElement('thead');
  thead.appendChild(trDates);
  const tbody = document.createElement('tbody');
  tbody.appendChild(trCounts);
  table.appendChild(thead);
  table.appendChild(tbody);
  scroll.appendChild(table);
  body.appendChild(scroll);
  const sum = document.createElement('p');
  sum.className = 'cr-eff-summary';
  const avg = daysWithCount > 0 ? (totalPresences / daysWithCount).toFixed(1).replace('.', ',') : '0';
  sum.textContent = `Total : ${totalPresences} présences sur ${daysWithCount}/10 jours travaillés (moy. ${avg}/j)`
    + (weatherDays > 0 ? ` — 🌧 ${weatherDays} j d'intempéries` : '');
  body.appendChild(sum);
}

// moins un document a un statut expired/danger/warning. Live pour la
// dernière semaine, snapshot pour les précédentes (back-fill auto).
function buildCRAdminBody(body, companyId, week, isLatest) {
  if (!isCRAdminVisible(companyId, week.id)) {
    const off = document.createElement('p');
    off.className = 'cr-section-empty';
    off.textContent = 'Aperçu masqué (ne sera pas inclus dans l\'export PDF).';
    body.appendChild(off);
    return;
  }
  let data;
  if (isLatest) {
    data = computeAdminAlertsForCompany(companyId);
  } else {
    if (!Array.isArray(week.adminSnapshot)) {
      week.adminSnapshot = computeAdminAlertsForCompany(companyId);
      save();
    }
    data = week.adminSnapshot;
  }
  if (!data || data.length === 0) {
    const ok = document.createElement('p');
    ok.className = 'cr-section-empty';
    ok.textContent = isLatest
      ? 'Aucun document à signaler pour les ouvriers de cette entreprise.'
      : 'Aucun document signalé lors de cette semaine.';
    body.appendChild(ok);
    return;
  }
  if (!isLatest) {
    const badge = document.createElement('p');
    badge.className = 'cr-avanc-frozen-note';
    badge.textContent = '🔒 Aperçu figé à la création de la semaine suivante.';
    body.appendChild(badge);
  }
  const list = document.createElement('ul');
  list.className = 'cr-admin-list';
  for (const w of data) {
    const li = document.createElement('li');
    li.className = 'cr-admin-worker';
    const head = document.createElement('div');
    head.className = 'cr-admin-worker-name';
    head.textContent = w.workerName;
    li.appendChild(head);
    const inner = document.createElement('ul');
    inner.className = 'cr-admin-items';
    for (const it of w.items) {
      const itemLi = document.createElement('li');
      itemLi.className = 'cr-admin-item' + (it.isExpired ? ' is-expired' : '');
      itemLi.textContent = it.text;
      inner.appendChild(itemLi);
    }
    li.appendChild(inner);
    list.appendChild(li);
  }
  body.appendChild(list);
}

function buildCRAvancTaskRow(task) {
  const li = document.createElement('li');
  li.className = 'cr-avanc-task';
  const head = document.createElement('div');
  head.className = 'cr-avanc-task-head';
  const title = document.createElement('span');
  title.className = 'cr-avanc-task-title';
  title.textContent = task.title || '(sans intitulé)';
  if (!task.title) title.style.fontStyle = 'italic';
  head.appendChild(title);
  const meta = document.createElement('span');
  meta.className = 'cr-avanc-task-meta';
  // metaText : libellé imposé (widget manuel, dont l'unité est libre) ;
  // sinon on retombe sur le volume calculé depuis les plans.
  meta.textContent = task.metaText != null ? task.metaText : fmtRecapVolume(task.type, task.total);
  head.appendChild(meta);
  li.appendChild(head);
  // Liste des plans qui contribuent à cette tâche (utile quand plusieurs
  // plans portent une tâche au même titre — sans ça on ne sait pas quelle
  // zone est concernée).
  if (Array.isArray(task.planNames) && task.planNames.length > 0) {
    const plans = document.createElement('div');
    plans.className = 'cr-avanc-task-plans';
    plans.textContent = '📐 ' + task.planNames.join(' · ');
    li.appendChild(plans);
  }
  const bar = document.createElement('div');
  bar.className = 'cr-avanc-bar';
  for (const k of ['done', 'doing', 'todo']) {
    const seg = document.createElement('div');
    seg.className = 'cr-avanc-bar-seg is-' + k;
    seg.style.flex = Math.max(task.pct[k], 0);
    bar.appendChild(seg);
  }
  li.appendChild(bar);
  // Légende sous la barre : % par statut (omis si <= 0,01 %)
  const lg = document.createElement('div');
  lg.className = 'cr-avanc-task-legend';
  const labels = { done: 'Réalisée', doing: 'En cours', todo: 'À faire' };
  for (const k of ['done', 'doing', 'todo']) {
    if (task.pct[k] <= 0.01) continue;
    const item = document.createElement('span');
    item.className = 'cr-avanc-task-legend-item';
    const dot = document.createElement('span');
    dot.className = 'cr-avanc-task-legend-dot is-' + k;
    const pct = document.createElement('span');
    pct.className = 'cr-avanc-task-legend-pct';
    pct.textContent = Math.round(task.pct[k]) + ' %';
    const lbl = document.createElement('span');
    lbl.textContent = labels[k];
    item.append(dot, pct, lbl);
    lg.appendChild(item);
  }
  if (lg.childNodes.length > 0) li.appendChild(lg);
  return li;
}

// ====================================================================
//   CR — WIDGET D'AVANCEMENT MANUEL
//   Même forme que l'aperçu automatique alimenté par l'onglet Suivi, mais
//   les quantités sont saisies à la main. Le widget vit dans le MÊME
//   tableau d'entrées que les notes (crEntries[...][sectionKey]) et se
//   distingue par kind: 'widget' — les notes existantes, qui n'ont pas ce
//   champ, restent lues exactement comme avant.
//   Champs propres au widget : title, unit, qtyTotal, qtyDone, qtyDoing.
//   (On n'utilise surtout pas « done », déjà pris par la case « Faite »
//   des notes.)
// ====================================================================
const CR_WIDGET_UNITS = ['m²', 'ml', 'u', 'm³', 'kg', 'T', '%'];

function isCRWidgetEntry(e) { return !!e && e.kind === 'widget'; }
function parseCRQty(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
// Quantités écrêtées + pourcentages, dérivés à l'affichage (jamais stockés).
function computeCRWidget(e) {
  const total = parseCRQty(e.qtyTotal);
  let done = parseCRQty(e.qtyDone);
  let doing = parseCRQty(e.qtyDoing);
  if (total > 0) {
    done = Math.min(done, total);
    doing = Math.min(doing, total - done);
  }
  const todo = Math.max(0, total - done - doing);
  const base = total > 0 ? total : (done + doing);
  const pct = base > 0
    ? { done: (done / base) * 100, doing: (doing / base) * 100, todo: (todo / base) * 100 }
    : { done: 0, doing: 0, todo: 0 };
  return { total, done, doing, todo, pct, unit: (e.unit || '').trim() };
}
function crWidgetMetaText(v) {
  const u = v.unit ? ' ' + v.unit : '';
  if (v.total > 0) return formatQty(v.done) + ' / ' + formatQty(v.total) + u;
  return formatQty(v.done) + u;
}

function addCRWidget(companyId, weekId, sectionKey) {
  const list = ensureCRBucket(companyId, weekId, sectionKey);
  const wk = getCRWeeks(companyId).find(w => w.id === weekId);
  const entry = {
    id: uid(),
    kind: 'widget',
    draft: true,                  // en cours de saisie → formulaire
    title: '',
    unit: 'm²',
    qtyTotal: '',
    qtyDone: '',
    qtyDoing: '',
    crOrigin: wk ? wk.label : ''
  };
  list.push(entry);
  if (state.crCollapsed[companyId] && state.crCollapsed[companyId][weekId]) {
    delete state.crCollapsed[companyId][weekId][sectionKey];
  }
  save();
  renderCR();
  requestAnimationFrame(() => {
    const el = document.querySelector(`.cr-widget[data-entry-id="${cssEscape(entry.id)}"] .cr-widget-title-input`);
    if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
  });
}
function getCRWidgetEntry(companyId, weekId, sectionKey, entryId) {
  return getCREntries(companyId, weekId, sectionKey).find(e => e.id === entryId && isCRWidgetEntry(e)) || null;
}
function setCRWidgetField(companyId, weekId, sectionKey, entryId, field, value) {
  const e = getCRWidgetEntry(companyId, weekId, sectionKey, entryId);
  if (!e) return null;
  e[field] = value;
  save();
  return e;
}
function setCRWidgetDraft(companyId, weekId, sectionKey, entryId, draft) {
  const e = getCRWidgetEntry(companyId, weekId, sectionKey, entryId);
  if (!e) return;
  if (!draft && !(e.title || '').trim()) {
    showToast('Donnez un intitulé à la tâche', 'error');
    const el = document.querySelector(`.cr-widget[data-entry-id="${cssEscape(entryId)}"] .cr-widget-title-input`);
    if (el) el.focus();
    return;
  }
  e.draft = !!draft;
  save();
  renderCR();
}

// ---------- Rendu : formulaire (brouillon) ou forme finale ----------
function buildCRWidgetEntry(companyId, weekId, sectionKey, entry) {
  const wrap = document.createElement('div');
  wrap.className = 'cr-widget' + (entry.draft ? ' is-draft' : '');
  wrap.dataset.companyId = companyId;
  wrap.dataset.weekId = weekId;
  wrap.dataset.sectionKey = sectionKey;
  wrap.dataset.entryId = entry.id;
  if (entry.draft) buildCRWidgetForm(wrap, companyId, weekId, sectionKey, entry);
  else buildCRWidgetFinal(wrap, companyId, weekId, sectionKey, entry);
  return wrap;
}

function buildCRWidgetForm(wrap, companyId, weekId, sectionKey, entry) {
  const head = document.createElement('div');
  head.className = 'cr-widget-form-head';
  head.appendChild(crEl('span', 'cr-widget-form-title', 'Widget d\'avancement'));
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'cr-widget-x';
  del.setAttribute('aria-label', 'Supprimer ce widget');
  del.textContent = '×';
  del.dataset.crAction = 'delete-entry';
  del.dataset.companyId = companyId;
  del.dataset.weekId = weekId;
  del.dataset.sectionKey = sectionKey;
  del.dataset.entryId = entry.id;
  head.appendChild(del);
  wrap.appendChild(head);

  // Aperçu vivant : la barre se remplit au fur et à mesure de la saisie.
  const preview = document.createElement('div');
  preview.className = 'cr-widget-live';
  wrap.appendChild(preview);
  const refresh = () => renderCRWidgetPreview(preview, entry);

  const mkField = (label, cls, value, placeholder, onInput, opts) => {
    const box = document.createElement('div');
    box.className = 'cr-widget-field' + (opts && opts.wide ? ' is-wide' : '');
    box.appendChild(crEl('label', 'cr-widget-label', label));
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'cr-widget-input ' + cls;
    inp.value = value == null ? '' : String(value);
    inp.placeholder = placeholder || '';
    if (opts && opts.numeric) inp.inputMode = 'decimal';
    if (opts && opts.list) inp.setAttribute('list', opts.list);
    if (opts && opts.maxLength) inp.maxLength = opts.maxLength;
    inp.addEventListener('input', () => { onInput(inp.value); refresh(); });
    box.appendChild(inp);
    return box;
  };

  wrap.appendChild(mkField('Intitulé de la tâche', 'cr-widget-title-input', entry.title,
    'Ex. Pose du bardage — façade Est',
    (v) => setCRWidgetField(companyId, weekId, sectionKey, entry.id, 'title', v),
    { wide: true, maxLength: 120 }));

  const grid = document.createElement('div');
  grid.className = 'cr-widget-grid';
  grid.appendChild(mkField('Quantité totale', 'cr-widget-total', entry.qtyTotal, '0',
    (v) => setCRWidgetField(companyId, weekId, sectionKey, entry.id, 'qtyTotal', v), { numeric: true }));
  grid.appendChild(mkField('Unité', 'cr-widget-unit', entry.unit, 'm²',
    (v) => setCRWidgetField(companyId, weekId, sectionKey, entry.id, 'unit', v),
    { list: 'cr-widget-units', maxLength: 8 }));
  grid.appendChild(mkField('Quantité réalisée', 'cr-widget-done', entry.qtyDone, '0',
    (v) => setCRWidgetField(companyId, weekId, sectionKey, entry.id, 'qtyDone', v), { numeric: true }));
  grid.appendChild(mkField('Quantité en cours', 'cr-widget-doing', entry.qtyDoing, '0',
    (v) => setCRWidgetField(companyId, weekId, sectionKey, entry.id, 'qtyDoing', v), { numeric: true }));
  wrap.appendChild(grid);

  const hint = crEl('p', 'cr-widget-hint',
    'Le reste à faire se calcule tout seul : total − réalisée − en cours.');
  wrap.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'cr-widget-form-actions';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn-primary cr-widget-validate';
  ok.textContent = 'Valider';
  ok.dataset.crAction = 'validate-widget';
  ok.dataset.companyId = companyId;
  ok.dataset.weekId = weekId;
  ok.dataset.sectionKey = sectionKey;
  ok.dataset.entryId = entry.id;
  actions.appendChild(ok);
  wrap.appendChild(actions);

  refresh();
}
// Aperçu de la barre pendant la saisie (sans reconstruire la page).
function renderCRWidgetPreview(host, entry) {
  host.innerHTML = '';
  const v = computeCRWidget(entry);
  host.appendChild(buildCRAvancTaskRow({
    title: (entry.title || '').trim() || 'Intitulé à renseigner',
    metaText: crWidgetMetaText(v),
    pct: v.pct
  }));
  host.appendChild(buildCRWidgetQtyLine(v));
}
// Ligne de quantités sous la barre — c'est ce que le widget automatique ne
// peut pas donner (il ne connaît que des pourcentages de surface de plan).
function buildCRWidgetQtyLine(v) {
  const line = document.createElement('div');
  line.className = 'cr-widget-qty';
  const u = v.unit ? ' ' + v.unit : '';
  const parts = [['done', 'Réalisée', v.done], ['doing', 'En cours', v.doing], ['todo', 'Reste', v.todo]];
  for (const [k, label, val] of parts) {
    if (k === 'doing' && val <= 0) continue;
    const item = document.createElement('span');
    item.className = 'cr-widget-qty-item is-' + k;
    item.appendChild(crEl('span', 'cr-widget-qty-label', label));
    item.appendChild(crEl('span', 'cr-widget-qty-val', formatQty(val) + u));
    line.appendChild(item);
  }
  return line;
}

function buildCRWidgetFinal(wrap, companyId, weekId, sectionKey, entry) {
  const v = computeCRWidget(entry);
  const actions = document.createElement('div');
  actions.className = 'cr-widget-actions';
  const mkBtn = (cls, action, label, html) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = html;
    b.dataset.crAction = action;
    b.dataset.companyId = companyId;
    b.dataset.weekId = weekId;
    b.dataset.sectionKey = sectionKey;
    b.dataset.entryId = entry.id;
    return b;
  };
  actions.appendChild(mkBtn('cr-widget-edit', 'edit-widget', 'Modifier ce widget',
    '<svg viewBox="0 0 24 24"><path d="M3 17v4h4l11-11-4-4L3 17Zm17.7-11.6-2.1-2.1a1 1 0 0 0-1.4 0l-1.8 1.8 3.5 3.5 1.8-1.8a1 1 0 0 0 0-1.4Z"/></svg>'));
  actions.appendChild(mkBtn('cr-widget-x', 'delete-entry', 'Supprimer ce widget', '×'));
  wrap.appendChild(actions);

  const card = document.createElement('div');
  card.className = 'cr-widget-card';
  card.appendChild(buildCRAvancTaskRow({
    title: entry.title,
    metaText: crWidgetMetaText(v),
    pct: v.pct
  }));
  card.appendChild(buildCRWidgetQtyLine(v));
  wrap.appendChild(card);
}

// Petit menu au clic sur « + » : note classique ou widget d'avancement.
function openCRAddMenu(btn, companyId, weekId, sectionKey) {
  closeCRAddMenu();
  const menu = document.createElement('div');
  menu.className = 'cr-add-menu';
  menu.id = 'cr-add-menu';
  const mk = (label, hint, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cr-add-menu-item';
    b.appendChild(crEl('span', 'cr-add-menu-label', label));
    b.appendChild(crEl('span', 'cr-add-menu-hint', hint));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); closeCRAddMenu(); onClick(); });
    menu.appendChild(b);
  };
  mk('Tâche', 'Une ligne de texte avec échéance et responsable',
    () => addCREntry(companyId, weekId, sectionKey));
  mk('Widget d\'avancement', 'Intitulé et quantités saisis à la main',
    () => addCRWidget(companyId, weekId, sectionKey));
  document.body.appendChild(menu);

  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth;
  let left = r.right - w;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  setTimeout(() => {
    document.addEventListener('click', closeCRAddMenu, { once: true });
    document.addEventListener('keydown', crAddMenuEsc);
  }, 0);
}
function crAddMenuEsc(e) { if (e.key === 'Escape') closeCRAddMenu(); }
function closeCRAddMenu() {
  const m = document.getElementById('cr-add-menu');
  if (m) m.remove();
  document.removeEventListener('keydown', crAddMenuEsc);
}
function crEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function buildCREntry(companyId, weekId, sectionKey, entry) {
  const row = document.createElement('div');
  row.className = 'cr-entry' + (entry.done ? ' is-done' : '');
  row.dataset.companyId = companyId;
  row.dataset.weekId = weekId;
  row.dataset.sectionKey = sectionKey;
  row.dataset.entryId = entry.id;

  // ----- Ligne 1 : checkbox ronde « Faite » + textarea + croix -----
  const topRow = document.createElement('div');
  topRow.className = 'cr-entry-row';
  const doneLabel = document.createElement('label');
  doneLabel.className = 'cr-entry-check';
  doneLabel.title = 'Marquer comme faite';
  const doneCb = document.createElement('input');
  doneCb.type = 'checkbox';
  doneCb.checked = !!entry.done;
  doneCb.dataset.crAction = 'set-entry-done';
  doneCb.dataset.companyId = companyId;
  doneCb.dataset.weekId = weekId;
  doneCb.dataset.sectionKey = sectionKey;
  doneCb.dataset.entryId = entry.id;
  doneLabel.appendChild(doneCb);
  topRow.appendChild(doneLabel);
  const ta = document.createElement('textarea');
  ta.className = 'cr-entry-text';
  ta.rows = 1;
  ta.placeholder = 'Décrivez la tâche…';
  ta.value = entry.text || '';
  ta.dataset.crAction = 'edit-entry';
  ta.dataset.companyId = companyId;
  ta.dataset.weekId = weekId;
  ta.dataset.sectionKey = sectionKey;
  ta.dataset.entryId = entry.id;
  // Auto-resize (recalcul après ajout dans le DOM)
  const autoResize = () => {
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  };
  ta.addEventListener('input', autoResize);
  setTimeout(autoResize, 0);
  topRow.appendChild(ta);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'cr-entry-delete';
  del.dataset.crAction = 'delete-entry';
  del.dataset.companyId = companyId;
  del.dataset.weekId = weekId;
  del.dataset.sectionKey = sectionKey;
  del.dataset.entryId = entry.id;
  del.setAttribute('aria-label', 'Supprimer');
  del.innerHTML = '×';
  topRow.appendChild(del);
  row.appendChild(topRow);

  // ----- Ligne 2 : chips (CR | Date | PM | Responsable) -----
  const chips = document.createElement('div');
  chips.className = 'cr-entry-chips';

  // Chip CR (origine, read-only)
  const crChip = document.createElement('span');
  crChip.className = 'cr-chip cr-chip-cr';
  crChip.textContent = entry.crOrigin || '—';
  chips.appendChild(crChip);

  // Chip Date — l'input date est superposé en transparent pour intercepter
  // le tap et déclencher le picker natif iOS/Android.
  const isPM = entry.echeance === 'PM';
  const dateChip = document.createElement('label');
  dateChip.className = 'cr-chip cr-chip-date' + (isPM ? ' is-disabled' : '');
  if (entry.echeance && entry.echeance !== 'PM') {
    const target = new Date(entry.echeance + 'T00:00:00');
    const ref = new Date(); ref.setHours(0,0,0,0);
    const diff = Math.round((target - ref) / 86400000);
    if (diff < 0) dateChip.classList.add('is-overdue');
    else if (diff <= 7) dateChip.classList.add('is-soon');
  }
  const dateLabel = document.createElement('span');
  dateLabel.className = 'cr-chip-text';
  if (entry.echeance && entry.echeance !== 'PM') {
    const [yy, mm, dd] = entry.echeance.split('-');
    dateLabel.textContent = '📅 ' + dd + '/' + mm + '/' + yy.slice(2);
  } else {
    dateLabel.textContent = '📅 Échéance';
  }
  dateChip.appendChild(dateLabel);
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = isPM ? '' : (entry.echeance || '');
  dateInput.className = 'cr-chip-hidden-input';
  dateInput.dataset.crAction = 'set-entry-echeance';
  dateInput.dataset.companyId = companyId;
  dateInput.dataset.weekId = weekId;
  dateInput.dataset.sectionKey = sectionKey;
  dateInput.dataset.entryId = entry.id;
  dateChip.appendChild(dateInput);
  chips.appendChild(dateChip);

  // Chip PM (toggle)
  const pmChip = document.createElement('label');
  pmChip.className = 'cr-chip cr-chip-pm' + (isPM ? ' is-active' : '');
  pmChip.title = 'Pour mémoire (pas d\'échéance précise)';
  const pmCb = document.createElement('input');
  pmCb.type = 'checkbox';
  pmCb.checked = isPM;
  pmCb.className = 'cr-chip-hidden-input';
  pmCb.dataset.crAction = 'set-entry-pm';
  pmCb.dataset.companyId = companyId;
  pmCb.dataset.weekId = weekId;
  pmCb.dataset.sectionKey = sectionKey;
  pmCb.dataset.entryId = entry.id;
  pmChip.appendChild(pmCb);
  const pmText = document.createElement('span');
  pmText.className = 'cr-chip-text';
  pmText.textContent = 'PM';
  pmChip.appendChild(pmText);
  chips.appendChild(pmChip);

  // Chip Responsable
  const respChip = document.createElement('label');
  respChip.className = 'cr-chip cr-chip-resp';
  const respLabelEl = document.createElement('span');
  respLabelEl.className = 'cr-chip-text';
  const company = state.companies.find(c => c.id === companyId);
  const respDisplay = (entry.responsable === null || !entry.responsable || entry.responsable === 'BBGO')
    ? CR_INTERNAL_LABEL
    : (company?.name || CR_INTERNAL_LABEL);
  respLabelEl.textContent = '👤 ' + respDisplay;
  respChip.appendChild(respLabelEl);
  const respSel = document.createElement('select');
  respSel.className = 'cr-chip-hidden-input';
  respSel.dataset.crAction = 'set-entry-responsable';
  respSel.dataset.companyId = companyId;
  respSel.dataset.weekId = weekId;
  respSel.dataset.sectionKey = sectionKey;
  respSel.dataset.entryId = entry.id;
  const optBBGO = document.createElement('option');
  optBBGO.value = 'BBGO'; optBBGO.textContent = CR_INTERNAL_LABEL;
  respSel.appendChild(optBBGO);
  if (company && company.name !== CR_INTERNAL_LABEL) {
    const o = document.createElement('option');
    o.value = companyId; o.textContent = company.name;
    respSel.appendChild(o);
  }
  respSel.value = (entry.responsable && [...respSel.options].some(o => o.value === entry.responsable))
    ? entry.responsable
    : 'BBGO';
  respChip.appendChild(respSel);
  chips.appendChild(respChip);

  row.appendChild(chips);
  return row;
}

// ================= STOCK : PILOTAGE, MAGASIN, MOUVEMENTS =================
// Le Stock reprend le vocabulaire visuel du récapitulatif d'avancement :
// bandeau de KPI, cartes .db-card à titre orange, sélecteur de période,
// recherche et tri. On lit d'abord ce qu'il faut décider, ensuite l'état du
// magasin, enfin le journal — l'ordre dans lequel se pose les questions.

const STOCK_PERIODS = [
  { key: '7',   label: '7 j',  days: 7 },
  { key: '30',  label: '30 j', days: 30 },
  { key: 'all', label: 'Tout', days: null },
];
function getStockPeriod() {
  return STOCK_PERIODS.find(p => p.key === state.stockPeriod) || STOCK_PERIODS[1];
}
const STOCK_SORTS = [
  { key: 'statut', label: 'Urgence', cmp: (a, b) => STOCK_STATUS[a.status].rank - STOCK_STATUS[b.status].rank
      || (a.days == null ? 1e9 : a.days) - (b.days == null ? 1e9 : b.days) },
  { key: 'valeur', label: 'Valeur', cmp: (a, b) => b.value - a.value },
  { key: 'conso',  label: 'Conso',  cmp: (a, b) => (b.daily || 0) - (a.daily || 0) },
  { key: 'nom',    label: 'Nom',    cmp: (a, b) => a.name.localeCompare(b.name, 'fr') },
];
function fmtEurShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 10000) return Math.round(v / 1000).toLocaleString('fr-FR') + ' k€';
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}
// Libellé honnête de la provenance du chiffre de consommation : l'application
// ne doit jamais laisser croire qu'un chiffre déduit a été mesuré.
function stockConsoSource(a) {
  if (a.dailySource === 'sorties') {
    return 'mesurée sur ' + a.dailySample + ' sortie' + (a.dailySample > 1 ? 's' : '')
      + ' (' + a.dailyDays + ' j ouvrés)';
  }
  if (a.dailySource === 'inventaires') return 'déduite de ' + a.dailySample + ' inventaires';
  return a.inventories >= 2 ? 'aucune conso observée' : 'saisissez des sorties, ou 2 inventaires';
}

// ------------------------------------------------------------- PILOTAGE ----
function renderStockPilot() {
  const host = document.getElementById('stockpilot');
  const empty = document.getElementById('stockpilotempty');
  if (!host || !empty) return;
  host.innerHTML = '';
  empty.classList.remove('show');
  const m = computeStockModel();
  if (!m.articles.length) {
    empty.innerHTML = '<p>Aucun mouvement enregistré.</p><p class="hint">Le bouton <strong>+</strong> de l\'onglet <strong>Mouvements</strong> ouvre la saisie : réception, sortie ou inventaire.</p>';
    empty.classList.add('show');
    return;
  }
  host.appendChild(buildStockKpis(m));
  const reorder = getStockReorderList();
  host.appendChild(buildStockReorderCard(reorder, m));
  const grid = dbEl('div', 'db-grid');
  grid.appendChild(buildStockConsoCard(m));
  grid.appendChild(buildStockIssuesCard(m, reorder));
  host.appendChild(grid);
}

function buildStockKpis(m) {
  const row = dbEl('div', 'db-kpis');
  const t = m.totals;

  const k1 = dbEl('div', 'db-kpi db-kpi-main');
  k1.appendChild(dbEl('div', 'db-kpi-label', 'Valeur du stock'));
  const v1 = dbEl('div', 'db-kpi-value');
  v1.appendChild(dbEl('span', 'db-kpi-num', fmtEurShort(t.value)));
  k1.appendChild(v1);
  k1.appendChild(dbEl('div', 'db-kpi-sub',
    'au prix moyen pondéré des réceptions' + (t.unpriced ? ' · ' + t.unpriced + ' sans prix' : '')));
  k1.title = 'Somme, pour chaque article, du stock courant multiplié par son prix moyen pondéré.';
  row.appendChild(k1);

  const k2 = dbEl('div', 'db-kpi');
  k2.appendChild(dbEl('div', 'db-kpi-label', 'À commander'));
  const reorder = getStockReorderList();
  const v2 = dbEl('div', 'db-kpi-value' + (reorder.length ? ' is-neg' : ' is-pos'));
  v2.appendChild(dbEl('span', 'db-kpi-num', String(reorder.length)));
  v2.appendChild(dbEl('span', 'db-kpi-unit', reorder.length > 1 ? 'références' : 'référence'));
  k2.appendChild(v2);
  const nRupture = reorder.filter(a => a.status === 'rupture').length;
  if (nRupture) k2.appendChild(dbEl('div', 'db-kpi-tag is-neg', nRupture + ' en rupture'));
  k2.appendChild(dbEl('div', 'db-kpi-sub', reorder.length
    ? 'environ ' + fmtEurShort(reorder.reduce((s, a) => s + a.reorderCost, 0)) + ' à engager'
    : 'aucune référence sous son seuil'));
  row.appendChild(k2);

  const k3 = dbEl('div', 'db-kpi');
  k3.appendChild(dbEl('div', 'db-kpi-label', 'Références suivies'));
  const v3 = dbEl('div', 'db-kpi-value');
  v3.appendChild(dbEl('span', 'db-kpi-num', String(t.references)));
  k3.appendChild(v3);
  const withConso = m.articles.filter(a => a.daily != null && a.daily > 0).length;
  k3.appendChild(dbEl('div', 'db-kpi-sub',
    withConso + ' avec une consommation connue · ' + (t.references - withConso) + ' sans'));
  row.appendChild(k3);

  const k4 = dbEl('div', 'db-kpi');
  k4.appendChild(dbEl('div', 'db-kpi-label', 'Mouvements'));
  const v4 = dbEl('div', 'db-kpi-value');
  v4.appendChild(dbEl('span', 'db-kpi-num', String(t.movesPeriod)));
  v4.appendChild(dbEl('span', 'db-kpi-unit', 'sur ' + m.period.label.toLowerCase()));
  k4.appendChild(v4);
  k4.appendChild(dbEl('div', 'db-kpi-sub', t.moves + ' depuis le début · ' + fmtEurShort(t.spend) + ' reçus'));
  row.appendChild(k4);
  return row;
}

// Carte de décision : c'est l'unique raison d'ouvrir l'onglet un mardi matin.
function buildStockReorderCard(list, m) {
  const card = dbCard('À commander', 'couverture cible : ' + m.settings.coverDays + ' j ouvrés');
  if (!list.length) {
    card.appendChild(dbEl('p', 'db-empty', 'Aucune référence sous son seuil. Rien à commander aujourd\'hui.'));
    return card;
  }
  const head = card.querySelector('.db-card-head');
  const copy = dbEl('button', 'stock-copy-btn', '⧉ Copier la liste');
  copy.type = 'button';
  copy.title = 'Copie un texte prêt à coller dans un mail de commande';
  copy.addEventListener('click', () => copyStockReorderList(list));
  head.appendChild(copy);

  const wrap = dbEl('div', 'db-tasks-wrap');
  const tbl = dbEl('table', 'db-tasks stock-reorder-table');
  const thead = dbEl('thead');
  const trh = dbEl('tr');
  for (const [label, cls] of [['Article', ''], ['Stock', 'num'], ['Couverture', 'num'],
    ['À commander', 'num'], ['Montant', 'num'], ['Fournisseur', ''], ['eOTP', '']]) {
    trh.appendChild(dbEl('th', cls, label));
  }
  thead.appendChild(trh);
  tbl.appendChild(thead);
  const tbody = dbEl('tbody');
  for (const a of list) {
    const tr = dbEl('tr', 'is-' + a.status);
    const name = dbEl('td', 'db-task-name');
    name.appendChild(dbEl('span', 'stock-dot is-' + a.status));
    const nb = dbEl('button', 'stock-link', a.name);
    nb.type = 'button';
    nb.addEventListener('click', () => openStockDetail(a.name));
    name.appendChild(nb);
    tr.appendChild(name);
    tr.appendChild(dbEl('td', 'num', fmtStockQty(a.stock) + ' ' + a.unit));
    // Le motif du déclenchement doit être lisible : sans lui, une couverture
    // de 56 jours dans une ligne « à commander » passe pour une incohérence.
    const cov = dbEl('td', 'num');
    if (a.min > 0 && a.stock <= a.min) {
      cov.appendChild(dbEl('span', 'stock-tag is-warn', 'sous le mini'));
      cov.title = 'Stock ' + fmtStockQty(a.stock) + ' ' + a.unit + ' ≤ mini ' + fmtStockQty(a.min) + ' ' + a.unit
        + (a.days != null ? ' — couverture ' + a.days + ' j ouvrés' : '');
    } else {
      cov.textContent = a.days == null ? '—' : (a.days <= 0 ? 'épuisé' : a.days + ' j');
    }
    tr.appendChild(cov);
    tr.appendChild(dbEl('td', 'num stock-strong', fmtStockQty(a.reorderQty) + ' ' + a.unit));
    tr.appendChild(dbEl('td', 'num', a.pmp > 0 ? fmtEurShort(a.reorderCost) : '—'));
    tr.appendChild(dbEl('td', null, a.supplier || '—'));
    tr.appendChild(dbEl('td', null, a.eOTP || '—'));
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  card.appendChild(wrap);
  card.appendChild(dbEl('p', 'db-note',
    'Quantité proposée = de quoi couvrir ' + m.settings.coverDays + ' jours ouvrés de consommation'
    + ' (plus le délai d\'appro de l\'article), au-delà du mini. Ajustez les seuils dans la fiche d\'un article.'));
  return card;
}
function copyStockReorderList(list) {
  const bySupplier = new Map();
  for (const a of list) {
    const k = a.supplier || 'Fournisseur non renseigné';
    if (!bySupplier.has(k)) bySupplier.set(k, []);
    bySupplier.get(k).push(a);
  }
  const lines = ['Demande d\'approvisionnement — ' + fmtFR(todayISO()), ''];
  for (const [sup, arr] of bySupplier) {
    lines.push(sup);
    for (const a of arr) {
      lines.push('  - ' + a.name + ' : ' + fmtStockQty(a.reorderQty) + ' ' + a.unit
        + (a.eOTP ? '  [' + a.eOTP + ']' : '')
        + '   (stock ' + fmtStockQty(a.stock) + ' ' + a.unit
        + (a.days != null ? ', couverture ' + a.days + ' j' : '') + ')');
    }
    lines.push('');
  }
  const total = list.reduce((s, a) => s + a.reorderCost, 0);
  if (total > 0) lines.push('Montant estimé : ' + fmtEurShort(total));
  const txt = lines.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(
      () => showToast('Liste copiée — collez-la dans votre mail'),
      () => showToast('Copie impossible', 'error'));
  } else {
    showToast('Copie non disponible sur cet appareil', 'error');
  }
}

// Consommation : qui pèse, et sur quelle base le chiffre est établi.
function buildStockConsoCard(m) {
  const card = dbCard('Consommation', 'sur ' + m.period.label.toLowerCase());
  const head = card.querySelector('.db-card-head');
  const seg = dbEl('div', 'db-periods');
  seg.appendChild(dbEl('span', 'db-periods-label', 'Fenêtre'));
  for (const p of STOCK_PERIODS) {
    const b = dbEl('button', 'db-period' + (m.period.key === p.key ? ' is-on' : ''), p.label);
    b.type = 'button';
    b.addEventListener('click', () => { state.stockPeriod = p.key; save(); invalidateStockModel(); renderStock(); });
    seg.appendChild(b);
  }
  head.appendChild(seg);

  const top = m.articles.filter(a => a.daily != null && a.daily > 0)
    .sort((a, b) => (b.daily * (b.pmp || 0)) - (a.daily * (a.pmp || 0)) || b.daily - a.daily)
    .slice(0, 8);
  if (!top.length) {
    card.appendChild(dbEl('p', 'db-empty',
      'Aucune consommation mesurable. Saisissez des sorties au fil de l\'eau, ou deux inventaires successifs sur un même article.'));
    return card;
  }
  const max = Math.max(...top.map(a => a.daily));
  const list = dbEl('div', 'db-rows');
  for (const a of top) {
    const row = dbEl('div', 'db-row');
    const h = dbEl('div', 'db-row-head');
    const nb = dbEl('button', 'stock-link db-row-name', a.name);
    nb.type = 'button';
    nb.addEventListener('click', () => openStockDetail(a.name));
    h.appendChild(nb);
    h.appendChild(dbEl('span', 'db-row-pct', fmtRate(a.daily) + ' ' + a.unit + '/j'));
    row.appendChild(h);
    const bar = dbEl('div', 'db-bar');
    const fill = dbEl('div', 'db-bar-fill is-good');
    fill.style.width = Math.max(3, (a.daily / max) * 100) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    const sub = dbEl('div', 'db-row-sub');
    sub.appendChild(dbEl('span', null, stockConsoSource(a)));
    if (a.pmp > 0) sub.appendChild(dbEl('span', 'db-delta', fmtEurShort(a.daily * a.pmp * 21) + '/mois'));
    row.appendChild(sub);
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

// Qualité des données : ce qui fausse les chiffres, dit clairement.
function buildStockIssuesCard(m, reorder) {
  const card = dbCard('Points d\'attention');
  const notes = [];
  const t = m.totals;
  if (t.unpriced) {
    notes.push(['is-warn', t.unpriced + ' réception(s) sans prix unitaire : elles entrent à 0 € dans la vision budget et faussent la valeur du stock.']);
  }
  if (t.mixedUnits) {
    const noms = m.articles.filter(a => a.mixedUnits).map(a => a.name).slice(0, 3).join(', ');
    notes.push(['is-warn', t.mixedUnits + ' article(s) saisis avec des unités différentes (' + noms + ') : le total additionne des grandeurs distinctes. Fixez l\'unité dans leur fiche.']);
  }
  const negatifs = m.articles.filter(a => a.stock < 0);
  if (negatifs.length) {
    notes.push(['is-warn', negatifs.length + ' article(s) en stock négatif (' + negatifs.map(a => a.name).slice(0, 3).join(', ') + ') : une réception manque, ou une sortie est en trop.']);
  }
  const sansConso = m.articles.filter(a => a.daily == null);
  if (sansConso.length) {
    notes.push(['', sansConso.length + ' article(s) sans consommation connue : ni sortie saisie, ni deux inventaires. Leur épuisement ne peut pas être estimé.']);
  }
  const dormants = m.articles.filter(a => a.lastEntry && a.lastEntry.date < dayToISO(isoToDay(todayISO()) - 60));
  if (dormants.length) {
    notes.push(['', dormants.length + ' article(s) sans mouvement depuis plus de 60 jours.']);
  }
  if (!notes.length) notes.push(['is-ok', 'Prix, unités et mouvements sont cohérents : les chiffres du stock sont fiables.']);
  for (const [cls, txt] of notes) {
    const el = dbEl('div', 'db-focus-note ' + cls);
    el.textContent = txt;
    card.appendChild(el);
  }
  const counts = dbEl('div', 'db-focus-counts');
  counts.textContent = t.references + ' références · ' + t.moves + ' mouvements · '
    + m.articles.filter(a => a.entries.some(e => stockTypeOf(e) === 'sortie')).length + ' avec sorties saisies';
  card.appendChild(counts);
  return card;
}

// -------------------------------------------------------------- MAGASIN ----
function renderStockSummary() {
  const list = document.getElementById('stocksummarylist');
  const empty = document.getElementById('stocksummaryempty');
  const tools = document.getElementById('stocktools');
  if (!list || !empty) return;
  list.innerHTML = '';
  empty.classList.remove('show');
  const m = computeStockModel();
  if (tools) renderStockTools(tools, m);
  if (m.articles.length === 0) {
    empty.innerHTML = '<p>Aucun article en stock.</p><p class="hint">Enregistrez une réception avec le bouton <strong>+</strong>.</p>';
    empty.classList.add('show');
    if (tools) tools.innerHTML = '';
    return;
  }
  const q = stockKey(state.stockQuery || '');
  const sort = STOCK_SORTS.find(s => s.key === state.stockSort) || STOCK_SORTS[0];
  const shown = m.articles
    .filter(a => !q || a.key.includes(q) || stockKey(a.supplier).includes(q))
    .sort(sort.cmp);
  if (!shown.length) {
    empty.innerHTML = '<p>Aucun article ne correspond à « ' + escapeHtml(state.stockQuery) + ' ».</p>';
    empty.classList.add('show');
    return;
  }
  for (const a of shown) list.appendChild(buildStockSummaryCard(a));
}
function renderStockTools(host, m) {
  host.innerHTML = '';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'stock-search';
  search.placeholder = 'Rechercher un article, un fournisseur…';
  search.value = state.stockQuery || '';
  search.addEventListener('input', () => {
    state.stockQuery = search.value;
    renderStockSummary();
    const again = document.querySelector('#stocktools .stock-search');
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });
  host.appendChild(search);

  const sorts = dbEl('div', 'db-ouvrage-sorts');
  sorts.appendChild(dbEl('span', 'db-ouvrage-sorts-label', 'Trier par'));
  for (const s of STOCK_SORTS) {
    const b = dbEl('button', 'db-ouvrage-sort' + ((state.stockSort || 'statut') === s.key ? ' is-on' : ''), s.label);
    b.type = 'button';
    b.addEventListener('click', () => { state.stockSort = s.key; save(); renderStockSummary(); });
    sorts.appendChild(b);
  }
  host.appendChild(sorts);

  const counts = dbEl('div', 'stock-tools-counts');
  const byStatus = {};
  for (const a of m.articles) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  for (const key of ['rupture', 'critique', 'bas', 'ok', 'inconnu']) {
    if (!byStatus[key]) continue;
    const chip = dbEl('span', 'stock-status-chip is-' + key);
    chip.appendChild(dbEl('span', 'stock-dot is-' + key));
    chip.appendChild(dbEl('span', null, byStatus[key] + ' ' + STOCK_STATUS[key].label.toLowerCase()));
    counts.appendChild(chip);
  }
  host.appendChild(counts);
}
function buildStockSummaryCard(a) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'stock-summary-card is-' + a.status;
  card.setAttribute('aria-label', 'Fiche de ' + a.name);
  const head = dbEl('div', 'stock-summary-head');
  const id = dbEl('div', 'stock-summary-id');
  const nameRow = dbEl('div', 'stock-summary-nameline');
  nameRow.appendChild(dbEl('span', 'stock-dot is-' + a.status));
  nameRow.appendChild(dbEl('span', 'stock-summary-name', a.name));
  if (a.mixedUnits) {
    const w = dbEl('span', 'stock-tag is-warn', 'unités mêlées');
    w.title = 'Cet article a été saisi avec plusieurs unités : le total additionne des grandeurs différentes.';
    nameRow.appendChild(w);
  }
  id.appendChild(nameRow);
  const sub = dbEl('div', 'stock-summary-sub');
  sub.textContent = a.daily != null && a.daily > 0
    ? fmtRate(a.daily) + ' ' + a.unit + '/j ouvré · ' + stockConsoSource(a)
    : stockConsoSource(a);
  id.appendChild(sub);
  head.appendChild(id);
  const right = dbEl('div', 'stock-summary-right');
  right.appendChild(dbEl('span', 'stock-summary-total', fmtStockQty(a.stock) + ' ' + a.unit));
  if (a.value > 0) right.appendChild(dbEl('span', 'stock-summary-value', fmtEurShort(a.value)));
  head.appendChild(right);
  card.appendChild(head);

  // Barre de couverture : la part du seuil d'alerte encore couverte.
  const seuil = (a.days != null) ? (computeStockModel().settings.alertDays + (a.leadDays || 0)) : 0;
  const bar = dbEl('div', 'db-bar stock-summary-bar');
  const fill = dbEl('div', 'db-bar-fill is-' + a.status);
  const pct = a.days == null ? 0 : Math.max(4, Math.min(100, (a.days / Math.max(1, seuil * 3)) * 100));
  fill.style.width = pct + '%';
  bar.appendChild(fill);
  card.appendChild(bar);

  const foot = dbEl('div', 'stock-summary-foot');
  foot.appendChild(dbEl('span', 'stock-summary-status is-' + a.status,
    a.status === 'rupture' ? 'Rupture'
    : a.days == null ? STOCK_STATUS[a.status].label
    : 'Couverture ' + a.days + ' j ouvrés'));
  if (a.date && a.days != null && a.days > 0) foot.appendChild(dbEl('span', null, 'épuisé le ' + fmtFR(a.date)));
  if (a.min > 0) foot.appendChild(dbEl('span', null, 'mini ' + fmtStockQty(a.min) + ' ' + a.unit));
  if (a.supplier) foot.appendChild(dbEl('span', null, a.supplier));
  if (a.lastEntry) {
    foot.appendChild(dbEl('span', null, 'dernier mouvement ' + fmtDateShortFR(a.lastEntry.date)));
  }
  card.appendChild(foot);
  card.addEventListener('click', () => openStockDetail(a.name));
  return card;
}

// ----------------------------------------------------------- MOUVEMENTS ----
const STOCK_MOVE_PAGE = 120;
let _stockMoveLimit = STOCK_MOVE_PAGE;
function renderStockEntries() {
  const list = document.getElementById('stockentrylist');
  const empty = document.getElementById('stockentryempty');
  const tools = document.getElementById('stockmovetools');
  if (!list || !empty) return;
  list.innerHTML = '';
  empty.classList.remove('show');
  if (tools) renderStockMoveTools(tools);
  if ((state.stockEntries || []).length === 0) {
    empty.innerHTML = '<p>Aucun mouvement enregistré.</p><p class="hint">Le bouton <strong>+</strong> ouvre la saisie : réception, sortie ou inventaire.</p>';
    empty.classList.add('show');
    if (tools) tools.innerHTML = '';
    return;
  }
  const filter = state.stockMoveFilter || 'all';
  const q = stockKey(state.stockQuery || '');
  const all = state.stockEntries.slice().sort(compareStockEntries).reverse()
    .filter(e => filter === 'all' || stockTypeOf(e) === filter)
    .filter(e => !q || stockKey(e.article).includes(q));
  if (!all.length) {
    empty.innerHTML = '<p>Aucun mouvement ne correspond à ce filtre.</p>';
    empty.classList.add('show');
    return;
  }
  // Regroupement par jour, avec le net du jour : c'est la lecture d'un carnet
  // de magasin, pas d'un tableau plat de trois cents lignes.
  const shown = all.slice(0, _stockMoveLimit);
  let currentDay = null;
  for (const e of shown) {
    if (e.date !== currentDay) {
      currentDay = e.date;
      const sameDay = all.filter(x => x.date === currentDay);
      const li = document.createElement('li');
      li.className = 'stock-day-head';
      li.appendChild(dbEl('span', 'stock-day-date', fmtDateShortFR(currentDay)));
      const counts = [];
      for (const t of ['reception', 'sortie', 'inventaire']) {
        const n = sameDay.filter(x => stockTypeOf(x) === t).length;
        if (n) counts.push(n + ' ' + STOCK_TYPES[t].short.toLowerCase() + (n > 1 ? 's' : ''));
      }
      li.appendChild(dbEl('span', 'stock-day-count', counts.join(' · ')));
      list.appendChild(li);
    }
    list.appendChild(buildStockEntryRow(e));
  }
  if (all.length > shown.length) {
    const li = document.createElement('li');
    li.className = 'stock-more';
    const b = dbEl('button', 'btn-secondary', 'Afficher ' + Math.min(STOCK_MOVE_PAGE, all.length - shown.length) + ' mouvements de plus');
    b.type = 'button';
    b.addEventListener('click', () => { _stockMoveLimit += STOCK_MOVE_PAGE; renderStockEntries(); });
    li.appendChild(b);
    li.appendChild(dbEl('span', 'stock-more-count', shown.length + ' / ' + all.length + ' affichés'));
    list.appendChild(li);
  }
}
function renderStockMoveTools(host) {
  host.innerHTML = '';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'stock-search';
  search.placeholder = 'Rechercher un article…';
  search.value = state.stockQuery || '';
  search.addEventListener('input', () => {
    state.stockQuery = search.value;
    _stockMoveLimit = STOCK_MOVE_PAGE;
    renderStockEntries();
    const again = document.querySelector('#stockmovetools .stock-search');
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });
  host.appendChild(search);
  const seg = dbEl('div', 'db-ouvrage-sorts');
  seg.appendChild(dbEl('span', 'db-ouvrage-sorts-label', 'Type'));
  const opts = [['all', 'Tous'], ['reception', 'Réceptions'], ['sortie', 'Sorties'], ['inventaire', 'Inventaires']];
  for (const [key, label] of opts) {
    const b = dbEl('button', 'db-ouvrage-sort' + ((state.stockMoveFilter || 'all') === key ? ' is-on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => {
      state.stockMoveFilter = key; save();
      _stockMoveLimit = STOCK_MOVE_PAGE;
      renderStockEntries();
    });
    seg.appendChild(b);
  }
  host.appendChild(seg);
}
function buildStockEntryRow(entry) {
  const t = stockTypeOf(entry);
  const def = STOCK_TYPES[t];
  const li = document.createElement('li');
  li.className = 'stock-entry-row type-' + t;
  li.setAttribute('data-entry-id', entry.id);
  const main = dbEl('div', 'stock-entry-main');
  // Le type est écrit en clair, pas seulement porté par une couleur : un
  // écran de téléphone en plein soleil ne distingue pas le vert du bleu.
  main.appendChild(dbEl('span', 'stock-entry-type is-' + t, def.short));
  main.appendChild(dbEl('span', 'stock-entry-name', entry.article));
  main.appendChild(dbEl('span', 'stock-entry-qty is-' + t, def.sign + ' ' + fmtStockQty(entry.qty) + ' ' + entry.unit));
  li.appendChild(main);

  const meta = dbEl('div', 'stock-entry-meta');
  if (t === 'reception' && Number(entry.unitPrice) > 0) {
    meta.appendChild(dbEl('span', null, fmtEurShort(entry.qty * entry.unitPrice)));
  }
  if (entry.eOTP) meta.appendChild(dbEl('span', null, entry.eOTP));
  if (entry.zoneId) {
    const z = state.zones.find(x => x.id === entry.zoneId);
    if (z) meta.appendChild(dbEl('span', null, '→ ' + travauxZoneLabel(entry.zoneId)));
  }
  if (entry.notes) meta.appendChild(dbEl('span', 'stock-entry-notes', entry.notes));
  if (meta.childElementCount) li.appendChild(meta);

  const actions = dbEl('div', 'stock-entry-actions');
  const again = dbEl('button', 'stock-entry-again', '↻');
  again.type = 'button';
  again.title = 'Refaire ce mouvement (reprend article, quantité et unité)';
  again.setAttribute('aria-label', 'Refaire ce mouvement');
  again.addEventListener('click', (ev) => { ev.stopPropagation(); repeatStockEntry(entry); });
  actions.appendChild(again);
  const del = document.createElement('button');
  del.className = 'stock-entry-delete';
  del.type = 'button';
  del.setAttribute('aria-label', 'Supprimer ce mouvement');
  del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>';
  del.addEventListener('click', (ev) => { ev.stopPropagation(); removeStockEntry(entry.id); });
  actions.appendChild(del);
  li.appendChild(actions);
  return li;
}

function renderStock() {
  invalidateStockModel();
  renderStockPilot();
  renderStockEntries();
  renderStockSummary();
  renderStockCB();
  refreshArticleControl();
}

// Peuple le dropdown des articles à partir de ceux déjà saisis. Si la
// liste est vide, on bascule directement sur le champ texte. Sinon le
// dropdown contient toutes les références + une entrée « + Nouveau
// article… » qui révèle le champ texte au choix.
const NEW_ARTICLE_SENTINEL = '__new__';
function refreshArticleControl(keep) {
  const sel = document.getElementById('stockarticleselect');
  const inp = document.getElementById('stockarticlenew');
  if (!sel || !inp) return;
  // La saisie en cours est préservée : renderStock() est appelé après chaque
  // fusion de synchro entrante, et vidait jusqu'ici le champ sous les doigts
  // de l'utilisateur en train de taper le nom d'un article.
  const keepValue = keep || document.activeElement === inp || document.activeElement === sel;
  const prevSel = sel.value, prevInp = inp.value, prevHidden = inp.hidden;
  const names = getAllArticleNames();
  sel.innerHTML = '';
  if (names.length === 0) {
    // Aucun article connu : on cache le select, on affiche le champ
    // texte (rien à choisir, l'utilisateur tape directement).
    sel.hidden = true;
    inp.hidden = false;
    if (!keepValue) inp.value = '';
    return;
  }
  sel.hidden = false;
  const placeholder = new Option('Choisir un article…', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  sel.appendChild(placeholder);
  for (const n of names) sel.appendChild(new Option(n, n));
  sel.appendChild(new Option('+ Nouveau article…', NEW_ARTICLE_SENTINEL));
  if (keepValue) {
    if (prevSel && [...sel.options].some(o => o.value === prevSel)) sel.value = prevSel;
    inp.hidden = prevHidden;
    inp.value = prevInp;
  } else {
    inp.hidden = true;
    inp.value = '';
  }
}
// Récupère l'article à enregistrer : si l'utilisateur a basculé sur la
// saisie nouvelle, c'est elle qui prime ; sinon on prend la sélection.
function getStockArticleFromForm() {
  const sel = document.getElementById('stockarticleselect');
  const inp = document.getElementById('stockarticlenew');
  if (inp && !inp.hidden) return inp.value;
  if (sel && sel.value && sel.value !== NEW_ARTICLE_SENTINEL) return sel.value;
  return '';
}
// Handler du select : « + Nouveau article… » → on révèle l'input texte
function onArticleSelectChange() {
  const sel = document.getElementById('stockarticleselect');
  const inp = document.getElementById('stockarticlenew');
  if (!sel || !inp) return;
  if (sel.value === NEW_ARTICLE_SENTINEL) {
    inp.hidden = false;
    inp.value = '';
    setTimeout(() => inp.focus(), 50);
  } else {
    inp.hidden = true;
    inp.value = '';
    // L'unité de la fiche prime : elle évite qu'un même article soit reçu
    // en sacs puis compté en palettes sans que rien ne le signale.
    const fiche = getStockArticle(sel.value);
    const unitSel = document.getElementById('stockunit');
    if (fiche && fiche.unit && unitSel && [...unitSel.options].some(o => o.value === fiche.unit)) {
      unitSel.value = fiche.unit;
    }
    if (fiche && fiche.eOTP && currentStockEntryType === 'reception') {
      const e = document.getElementById('stockeotp');
      if (e && [...e.options].some(o => o.value === fiche.eOTP)) e.value = fiche.eOTP;
    }
  }
  refreshStockCurrentHint();
}
function fmtDateShortFR(iso) {
  // (formatDateShortFR existe déjà ; alias pour éviter de re-déclarer)
  return formatDateShortFR(iso);
}

// ----- CRUD -----
function addStockEntry({ type, article, qty, unit, unitPrice, eOTP, date, notes, zoneId }) {
  if (!article || !article.trim()) { showToast('Article requis', 'error'); return false; }
  const q = parseFloat(String(qty).replace(',', '.'));
  if (!Number.isFinite(q) || q < 0) { showToast('Quantité invalide', 'error'); return false; }
  if (!date) { showToast('Date requise', 'error'); return false; }
  const t = STOCK_TYPES[type] ? type : 'reception';
  // Prix unitaire (optionnel) — utilisé pour la vision budget CB. Ni
  // l'inventaire (recalage physique) ni la sortie (mouvement interne) ne
  // sont des achats : ils ne portent donc ni prix ni imputation.
  let priceVal = 0;
  if (unitPrice != null && unitPrice !== '') {
    priceVal = parseFloat(String(unitPrice).replace(',', '.'));
    if (!Number.isFinite(priceVal) || priceVal < 0) priceVal = 0;
  }
  const isReception = t === 'reception';
  const now = new Date();
  state.stockEntries.push({
    id: uid(),
    type: t,
    article: article.trim(),
    qty: q,
    unit: unit || 'u',
    unitPrice: isReception ? priceVal : 0,
    eOTP: isReception ? (eOTP || '').trim() : '',
    zoneId: t === 'sortie' ? (zoneId || '') : '',
    date,
    // L'heure départage deux mouvements du même jour : sans elle, l'ordre
    // dépendait de l'ordre de saisie, donc du hasard après une synchro.
    time: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'),
    notes: (notes || '').trim()
  });
  // Fiche créée à la volée avec ce qu'on sait : jamais un préalable, juste un
  // enregistrement de ce qui vient d'être saisi.
  const fiche = upsertStockArticle(article, null);
  if (fiche && !fiche.unit && unit) fiche.unit = unit;
  if (fiche && isReception && !fiche.eOTP && eOTP) fiche.eOTP = String(eOTP).trim();
  save();
  invalidateStockModel();
  renderStock();
  return true;
}
// Refaire un mouvement : la feuille s'ouvre pré-remplie avec l'article, la
// quantité et l'unité de la ligne. Les livraisons de chantier se répètent.
function repeatStockEntry(entry) {
  openStockEntrySheet();
  setStockEntryType(stockTypeOf(entry));
  const sel = document.getElementById('stockarticleselect');
  const inp = document.getElementById('stockarticlenew');
  if (sel && [...sel.options].some(o => o.value === entry.article)) {
    sel.value = entry.article;
    if (inp) { inp.hidden = true; inp.value = ''; }
  } else if (inp) {
    inp.hidden = false;
    inp.value = entry.article;
  }
  document.getElementById('stockqty').value = fmtStockQty(entry.qty);
  const unitSel = document.getElementById('stockunit');
  if (unitSel && [...unitSel.options].some(o => o.value === entry.unit)) unitSel.value = entry.unit;
  if (stockTypeOf(entry) === 'reception' && Number(entry.unitPrice) > 0) {
    document.getElementById('stockprice').value = fmtPriceForInput(entry.unitPrice);
  }
  if (entry.eOTP) {
    const e = document.getElementById('stockeotp');
    if (e && [...e.options].some(o => o.value === entry.eOTP)) e.value = entry.eOTP;
  }
  if (entry.zoneId) {
    const z = document.getElementById('stockdest');
    if (z && [...z.options].some(o => o.value === entry.zoneId)) z.value = entry.zoneId;
  }
  refreshStockCurrentHint();
}
// Suppression immédiate et annulable, plutôt qu'une boîte de confirmation :
// sur un téléphone tenu d'une main, un « Annuler » qui reste trois secondes
// est plus sûr qu'un dialogue qu'on valide sans lire.
let _stockUndo = null;
function removeStockEntry(id) {
  const entry = state.stockEntries.find(e => e.id === id);
  if (!entry) return;
  state.stockEntries = state.stockEntries.filter(e => e.id !== id);
  _stockUndo = entry;
  save();
  invalidateStockModel();
  if (stockDetailArticle && stockKey(stockDetailArticle) === stockKey(entry.article)) {
    renderStockDetailBody();
  }
  renderStock();
  showStockUndoToast(entry);
}
function showStockUndoToast(entry) {
  const def = STOCK_TYPES[stockTypeOf(entry)];
  const el = document.getElementById('stockundo');
  if (!el) {
    showToast(def.short + ' supprimée');
    return;
  }
  el.innerHTML = '';
  el.appendChild(dbEl('span', null, def.short + ' ' + def.sign + fmtStockQty(entry.qty) + ' '
    + entry.unit + ' — ' + entry.article + ' supprimée'));
  const b = dbEl('button', 'stock-undo-btn', 'Annuler');
  b.type = 'button';
  b.addEventListener('click', undoStockDelete);
  el.appendChild(b);
  el.hidden = false;
  clearTimeout(showStockUndoToast._t);
  showStockUndoToast._t = setTimeout(() => { el.hidden = true; _stockUndo = null; }, 6000);
}
function undoStockDelete() {
  if (!_stockUndo) return;
  state.stockEntries.push(_stockUndo);
  _stockUndo = null;
  save();
  invalidateStockModel();
  renderStock();
  if (stockDetailArticle) renderStockDetailBody();
  const el = document.getElementById('stockundo');
  if (el) el.hidden = true;
  showToast('Mouvement rétabli');
}

// ----- Bottom sheet de saisie -----
let currentStockEntryType = 'reception';
function openStockEntrySheet() {
  const sheet = document.getElementById('stockentrysheet');
  if (!sheet) return;
  setStockEntryType('reception');
  // (Re)peuple le dropdown ; bascule auto sur le champ texte si aucune
  // référence existe encore.
  refreshArticleControl();
  document.getElementById('stockqty').value = '';
  const unitSel = document.getElementById('stockunit');
  if (unitSel.childElementCount === 0) {
    for (const u of STOCK_UNITS) {
      const opt = document.createElement('option');
      opt.value = u; opt.textContent = u;
      unitSel.appendChild(opt);
    }
  }
  unitSel.value = 'm³';
  document.getElementById('stockdate').value = todayISO();
  document.getElementById('stocknotes').value = '';
  // Champs CB : prix vide, eOTP repeuplé depuis Données → eOTP
  document.getElementById('stockprice').value = '';
  refreshStockEOTPSelect();
  refreshStockDestSelect();
  refreshStockCurrentHint();
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  // Focus : champ texte si pas de référence connue, sinon le select
  setTimeout(() => {
    const inp = document.getElementById('stockarticlenew');
    const sel = document.getElementById('stockarticleselect');
    if (inp && !inp.hidden) inp.focus();
    else if (sel) sel.focus();
  }, 50);
}
function closeStockEntrySheet() {
  const sheet = document.getElementById('stockentrysheet');
  if (sheet) sheet.hidden = true;
  document.body.style.overflow = '';
}
function setStockEntryType(type) {
  currentStockEntryType = STOCK_TYPES[type] ? type : 'reception';
  const seg = document.querySelector('.stock-type-seg');
  if (seg) {
    const buttons = seg.querySelectorAll('.seg-btn');
    buttons.forEach((b, i) => {
      const isActive = b.dataset.stockEntryType === currentStockEntryType;
      b.classList.toggle('active', isActive);
      if (isActive) seg.dataset.position = String(i);
    });
  }
  const hint = document.getElementById('stocktypehint');
  if (hint) {
    hint.textContent = currentStockEntryType === 'reception'
      ? 'Ajoute la quantité reçue au stock courant.'
      : currentStockEntryType === 'sortie'
        ? 'Retire la quantité servie du stock courant, avec sa destination.'
        : 'Remplace le stock courant par la quantité comptée (recalage).';
  }
  // Prix et eOTP n'ont de sens que pour un achat ; la destination, que pour
  // une sortie. On masque plutôt que de laisser saisir ce qui sera ignoré.
  const cb = document.getElementById('stockcbfields');
  if (cb) cb.hidden = currentStockEntryType !== 'reception';
  const dest = document.getElementById('stockdestfield');
  if (dest) dest.hidden = currentStockEntryType !== 'sortie';
  refreshStockCurrentHint();
}
// Rappel du stock courant de l'article choisi, sous le sélecteur : on sait
// tout de suite si l'on est en train de sortir plus que ce qui reste.
function refreshStockCurrentHint() {
  const el = document.getElementById('stockcurrent');
  if (!el) return;
  const name = getStockArticleFromForm();
  const a = name ? computeStockModel().articles.find(x => x.key === stockKey(name)) : null;
  if (!a) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'stock-form-stock' + (a.stock <= 0 ? ' is-warn' : '');
  el.textContent = 'Stock courant : ' + fmtStockQty(a.stock) + ' ' + a.unit
    + (a.days != null ? ' · couverture ' + a.days + ' j ouvrés' : '')
    + (a.min > 0 ? ' · mini ' + fmtStockQty(a.min) + ' ' + a.unit : '');
}
// Destinations d'une sortie : l'arborescence de zones déjà saisie ailleurs.
function refreshStockDestSelect() {
  const sel = document.getElementById('stockdest');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = '— Non affectée —';
  sel.appendChild(none);
  for (const z of state.zones) {
    const opt = document.createElement('option');
    opt.value = z.id;
    opt.textContent = travauxZoneLabel(z.id);
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}
// Peuple le dropdown eOTP du sheet de saisie Stock depuis Données → eOTP.
// Une option vide « — » permet de ne pas affecter l'achat à une ligne.
function refreshStockEOTPSelect() {
  const sel = document.getElementById('stockeotp');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  const optEmpty = document.createElement('option');
  optEmpty.value = ''; optEmpty.textContent = '— Aucun —';
  sel.appendChild(optEmpty);
  for (const e of getEOTPs()) {
    if (!e.code || !e.code.trim()) continue;
    const opt = document.createElement('option');
    opt.value = e.code;
    opt.textContent = e.label ? `${e.code} — ${e.label}` : e.code;
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}
// `again` : on enregistre et l'on garde la feuille ouverte, article et unité
// conservés, quantité vidée. C'est le geste du magasinier qui sert quatre
// équipes de suite depuis le même dépôt.
function submitStockEntry(again) {
  const article   = getStockArticleFromForm();
  const qty       = document.getElementById('stockqty').value;
  const unit      = document.getElementById('stockunit').value;
  const unitPrice = document.getElementById('stockprice').value;
  const eOTP      = document.getElementById('stockeotp').value;
  const zoneId    = (document.getElementById('stockdest') || {}).value || '';
  const date      = document.getElementById('stockdate').value;
  const notes     = document.getElementById('stocknotes').value;
  const ok = addStockEntry({ type: currentStockEntryType, article, qty, unit, unitPrice, eOTP, date, notes, zoneId });
  if (!ok) return;
  const label = STOCK_TYPES[currentStockEntryType].short;
  if (again) {
    showToast(label + ' enregistrée — au suivant');
    const q = document.getElementById('stockqty');
    q.value = '';
    refreshArticleControl(true);
    refreshStockCurrentHint();
    q.focus();
    return;
  }
  showToast(label + ' enregistrée');
  closeStockEntrySheet();
}

// ----- Fiche d'un article : état, courbe, réglages, historique -----
let stockDetailArticle = null;
function openStockDetail(article) {
  stockDetailArticle = article;
  const modal = document.getElementById('stockdetailmodal');
  const title = document.getElementById('stockdetailtitle');
  if (!modal || !title) return;
  title.textContent = article;
  renderStockDetailBody();
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeStockDetail() {
  const modal = document.getElementById('stockdetailmodal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
  stockDetailArticle = null;
}
function renderStockDetailBody() {
  if (!stockDetailArticle) return;
  const body = document.getElementById('stockdetailbody');
  if (!body) return;
  body.innerHTML = '';
  const m = computeStockModel();
  const a = m.articles.find(x => x.key === stockKey(stockDetailArticle));
  if (!a) {
    body.appendChild(dbEl('p', 'db-empty', 'Aucun mouvement enregistré pour cet article.'));
    return;
  }

  // Bandeau : stock, couverture, valeur, consommation
  const head = dbEl('div', 'stock-fiche-kpis');
  const kpi = (label, value, sub, cls) => {
    const k = dbEl('div', 'stock-fiche-kpi' + (cls ? ' ' + cls : ''));
    k.appendChild(dbEl('div', 'stock-fiche-kpi-label', label));
    k.appendChild(dbEl('div', 'stock-fiche-kpi-value', value));
    if (sub) k.appendChild(dbEl('div', 'stock-fiche-kpi-sub', sub));
    head.appendChild(k);
  };
  kpi('Stock courant', fmtStockQty(a.stock) + ' ' + a.unit,
    a.lastEntry ? 'dernier mouvement le ' + fmtDateShortFR(a.lastEntry.date) : '',
    a.stock <= 0 ? 'is-rupture' : '');
  kpi('Couverture',
    a.days == null ? '—' : (a.days <= 0 ? 'épuisé' : a.days + ' j ouvrés'),
    a.date && a.days > 0 ? 'jusqu\'au ' + fmtFR(a.date) : STOCK_STATUS[a.status].label,
    'is-' + a.status);
  kpi('Consommation', a.daily != null && a.daily > 0 ? fmtRate(a.daily) + ' ' + a.unit + '/j' : '—',
    stockConsoSource(a));
  kpi('Valeur', a.pmp > 0 ? fmtEurShort(a.value) : '—',
    a.pmp > 0 ? fmtRate(a.pmp) + ' €/' + a.unit + ' en moyenne' : 'aucun prix saisi');
  body.appendChild(head);

  if (a.mixedUnits) {
    body.appendChild(dbEl('p', 'db-note is-warn',
      'Cet article a été saisi avec plusieurs unités (' + [...a.units].join(', ')
      + ') : le stock additionne des grandeurs différentes. Fixez une unité ci-dessous.'));
  }

  // Courbe du niveau de stock, rejouée mouvement par mouvement.
  body.appendChild(buildStockCurve(a));

  // Réglages de la fiche : tout est optionnel et se remplit quand on veut.
  const fiche = upsertStockArticle(a.name, null);
  const form = dbEl('div', 'stock-fiche-form');
  form.appendChild(dbEl('div', 'stock-fiche-form-title', 'Réglages de l\'article'));
  const grid = dbEl('div', 'stock-fiche-grid');
  const field = (label, node, title) => {
    const w = dbEl('label', 'stock-fiche-field');
    const l = dbEl('span', 'stock-fiche-field-label', label);
    if (title) l.title = title;
    w.appendChild(l);
    w.appendChild(node);
    grid.appendChild(w);
  };
  const mkInput = (value, attrs, onChange) => {
    const i = document.createElement('input');
    i.className = 'stock-form-input';
    Object.assign(i, attrs);
    i.value = value == null ? '' : value;
    i.addEventListener('change', () => onChange(i.value));
    return i;
  };
  const unitSel = document.createElement('select');
  unitSel.className = 'stock-form-input';
  unitSel.appendChild(new Option('— dernière saisie —', ''));
  for (const u of STOCK_UNITS) unitSel.appendChild(new Option(u, u));
  unitSel.value = fiche.unit || '';
  unitSel.addEventListener('change', () => setStockArticleField(a.name, 'unit', unitSel.value));
  field('Unité de référence', unitSel, 'Fixe l\'unité de l\'article : la saisie s\'y cale, et les mélanges d\'unités cessent.');
  field('Stock mini', mkInput(fiche.min || '', { type: 'text', inputMode: 'decimal', placeholder: '0' },
    v => setStockArticleField(a.name, 'min', v)), 'En dessous, l\'article passe en critique quelle que soit la consommation.');
  field('Délai d\'appro (j ouvrés)', mkInput(fiche.leadDays || '', { type: 'text', inputMode: 'numeric', placeholder: '0' },
    v => setStockArticleField(a.name, 'leadDays', v)), 'S\'ajoute au seuil d\'alerte : le ciment arrive en 48 h, la résine en trois semaines.');
  field('Fournisseur', mkInput(fiche.supplier || '', { type: 'text', maxLength: 60, placeholder: 'Nom du fournisseur' },
    v => setStockArticleField(a.name, 'supplier', v)));
  const eotpSel = document.createElement('select');
  eotpSel.className = 'stock-form-input';
  eotpSel.appendChild(new Option('— Aucun —', ''));
  for (const e of getEOTPs()) {
    if (!e.code || !e.code.trim() || isHourEOTP(e)) continue;
    eotpSel.appendChild(new Option(e.label ? e.code + ' — ' + e.label : e.code, e.code));
  }
  eotpSel.value = fiche.eOTP || '';
  eotpSel.addEventListener('change', () => setStockArticleField(a.name, 'eOTP', eotpSel.value));
  field('eOTP par défaut', eotpSel, 'Proposé automatiquement à chaque réception de cet article.');
  form.appendChild(grid);
  body.appendChild(form);

  // Historique
  const history = getArticleHistory(a.name);
  if (!history.length) return;
  const title = dbEl('div', 'stock-detail-section-title', 'Historique — ' + history.length + ' mouvements');
  body.appendChild(title);
  const ul = dbEl('ul', 'stock-history');
  let running = a.stock;
  for (const e of history) {
    const t = stockTypeOf(e);
    const def = STOCK_TYPES[t];
    const li = dbEl('li', 'stock-history-item type-' + t);
    const line = dbEl('div', 'stock-history-line');
    line.appendChild(dbEl('span', 'stock-history-date', fmtDateShortFR(e.date)));
    line.appendChild(dbEl('span', 'stock-history-type is-' + t, def.short));
    line.appendChild(dbEl('span', 'stock-history-qty is-' + t, def.sign + fmtStockQty(e.qty) + ' ' + e.unit));
    line.appendChild(dbEl('span', 'stock-history-after', '→ ' + fmtStockQty(running) + ' ' + a.unit));
    const del = document.createElement('button');
    del.className = 'stock-history-delete';
    del.type = 'button';
    del.setAttribute('aria-label', 'Supprimer ce mouvement');
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>';
    del.addEventListener('click', () => removeStockEntry(e.id));
    line.appendChild(del);
    li.appendChild(line);
    const extra = [];
    if (t === 'reception' && Number(e.unitPrice) > 0) extra.push(fmtRate(e.unitPrice) + ' €/' + e.unit + ' · ' + fmtEurShort(e.qty * e.unitPrice));
    if (e.eOTP) extra.push(e.eOTP);
    if (e.zoneId && state.zones.some(z => z.id === e.zoneId)) extra.push('→ ' + travauxZoneLabel(e.zoneId));
    if (e.notes) extra.push(e.notes);
    if (extra.length) li.appendChild(dbEl('div', 'stock-history-notes', extra.join(' · ')));
    ul.appendChild(li);
    // Remonte le temps : on retire l'effet du mouvement pour obtenir l'état
    // qui le précédait, affiché sur la ligne suivante (plus ancienne).
    if (t === 'inventaire') running = null;
    else if (t === 'sortie') running = running == null ? null : running + (Number(e.qty) || 0);
    else running = running == null ? null : running - (Number(e.qty) || 0);
    if (running == null) running = 0;
  }
  body.appendChild(ul);
}
function setStockArticleField(name, field, value) {
  const patch = {};
  if (field === 'min' || field === 'leadDays') {
    const n = parseFloat(String(value).replace(',', '.'));
    patch[field] = Number.isFinite(n) && n >= 0 ? n : 0;
  } else {
    patch[field] = String(value || '').trim();
  }
  upsertStockArticle(name, patch);
  save();
  invalidateStockModel();
  renderStock();
  renderStockDetailBody();
}

// Courbe du niveau de stock : le journal rejoué dans l'ordre, en escalier.
// Un inventaire pose une marche, une réception monte, une sortie descend.
function buildStockCurve(a) {
  const box = dbEl('div', 'stock-fiche-curve');
  const pts = [];
  let lvl = 0;
  const sorted = a.entries.slice().sort(compareStockEntries);
  for (const e of sorted) {
    const t = stockTypeOf(e);
    const q = Number(e.qty) || 0;
    if (t === 'inventaire') lvl = q;
    else if (t === 'sortie') lvl -= q;
    else lvl += q;
    pts.push({ ms: new Date(e.date + 'T00:00:00').getTime(), v: lvl });
  }
  if (pts.length < 2) {
    box.appendChild(dbEl('p', 'db-note', 'La courbe apparaîtra dès le deuxième mouvement.'));
    return box;
  }
  const W = 560, H = 130, PAD_L = 44, PAD_R = 10, PAD_T = 10, PAD_B = 20;
  const t0 = pts[0].ms, t1 = Math.max(pts[pts.length - 1].ms, t0 + 86400000);
  const vMax = Math.max(1, ...pts.map(p => p.v), a.min || 0);
  const x = (ms) => PAD_L + ((ms - t0) / (t1 - t0)) * (W - PAD_L - PAD_R);
  const y = (v) => PAD_T + (1 - Math.max(0, Math.min(vMax, v)) / vMax) * (H - PAD_T - PAD_B);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('class', 'db-curve stock-curve');
  const mk = (tag, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };
  for (const q of [0, 0.5, 1]) {
    const v = vMax * q;
    svg.appendChild(mk('line', { x1: PAD_L, x2: W - PAD_R, y1: y(v), y2: y(v), class: 'db-curve-grid' }));
    const lab = mk('text', { x: PAD_L - 5, y: y(v) + 3.5, class: 'db-curve-axis', 'text-anchor': 'end' });
    lab.textContent = fmtStockQty(Math.round(v * 10) / 10);
    svg.appendChild(lab);
  }
  if (a.min > 0 && a.min <= vMax) {
    svg.appendChild(mk('line', { x1: PAD_L, x2: W - PAD_R, y1: y(a.min), y2: y(a.min), class: 'stock-curve-min' }));
  }
  // Tracé en escalier : entre deux mouvements, le stock ne bouge pas.
  let d = 'M' + x(pts[0].ms).toFixed(1) + ' ' + y(pts[0].v).toFixed(1);
  for (let i = 1; i < pts.length; i++) {
    d += ' L' + x(pts[i].ms).toFixed(1) + ' ' + y(pts[i - 1].v).toFixed(1)
      + ' L' + x(pts[i].ms).toFixed(1) + ' ' + y(pts[i].v).toFixed(1);
  }
  svg.appendChild(mk('path', { d: d + ' L' + x(pts[pts.length - 1].ms).toFixed(1) + ' ' + y(0) + ' L' + x(pts[0].ms).toFixed(1) + ' ' + y(0) + ' Z', class: 'db-curve-area' }));
  svg.appendChild(mk('path', { d, class: 'db-curve-real' }));
  svg.appendChild(mk('circle', { cx: x(pts[pts.length - 1].ms), cy: y(pts[pts.length - 1].v), r: 3.5, class: 'db-curve-dot' }));
  const l0 = mk('text', { x: PAD_L, y: H - 6, class: 'db-curve-axis' });
  l0.textContent = fmtDateShortFR(new Date(t0).toISOString().slice(0, 10));
  svg.appendChild(l0);
  const l1 = mk('text', { x: W - PAD_R, y: H - 6, class: 'db-curve-axis', 'text-anchor': 'end' });
  l1.textContent = fmtDateShortFR(new Date(t1).toISOString().slice(0, 10));
  svg.appendChild(l1);
  box.appendChild(svg);
  return box;
}

// ---------- Consommables (commandes groupées + récap mensuel) ----------
const CONSO_UNITS = ['u', 'paires', 'boîtes', 'sacs', 'palettes', 'kg', 't', 'm³', 'm²', 'ml', 'L'];

function getConsommableEntries() { return Array.isArray(state.consommableEntries) ? state.consommableEntries : []; }
function getEntryOrderId(e) { return e.orderId || e.id; }
function getEntryReference(e) { return e.reference || ''; }
function getEntryEOTP(e) { return e.eOTP || ''; }
function compareConsommableEntries(a, b) {
  return (a.date || '').localeCompare(b.date || '') ||
         String(a.id || '').localeCompare(String(b.id || ''));
}
// Registre canonique des produits : un produit y est enregistré la
// première fois qu'il est saisi (avec sa référence + son prix
// unitaire). Les futures saisies du même produit reprennent ces
// valeurs en lecture seule pour éviter divergences et doublons.
function getConsoProducts() { return Array.isArray(state.consoProducts) ? state.consoProducts : []; }
function getConsoProduct(name) {
  const k = (name || '').trim().toLowerCase();
  return getConsoProducts().find(p => (p.name || '').trim().toLowerCase() === k) || null;
}
function getAllConsoProducts() {
  return getConsoProducts().slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
// Insère ou complète un produit dans le registre. Si le produit existe
// déjà avec une référence/un prix non vide, on NE les écrase PAS — on
// remplit uniquement ce qui manque.
function upsertConsoProduct({ name, reference, unitPrice }) {
  if (!name || !name.trim()) return null;
  if (!Array.isArray(state.consoProducts)) state.consoProducts = [];
  let p = getConsoProduct(name);
  if (!p) {
    p = { name: name.trim(), reference: (reference || '').trim(), unitPrice: Number(unitPrice) || 0 };
    state.consoProducts.push(p);
  } else {
    if (!p.reference && reference) p.reference = String(reference).trim();
    if ((!p.unitPrice || p.unitPrice === 0) && unitPrice) p.unitPrice = Number(unitPrice) || 0;
  }
  return p;
}
// Migration : si le registre est vide mais qu'on a des entrées (cas
// upgrade depuis v0.52), on le reconstruit en parcourant les entrées
// dans l'ordre chronologique (la première occurrence d'un produit
// fixe sa référence et son prix canoniques).
function migrateConsoProductsFromEntries() {
  if (getConsoProducts().length > 0) return;
  state.consoProducts = [];
  const sorted = getConsommableEntries().slice().sort(compareConsommableEntries);
  for (const e of sorted) {
    upsertConsoProduct({ name: e.product, reference: e.reference, unitPrice: e.unitPrice });
  }
}

// ---------- Registre eOTP (lignes de budget) ----------
function getEOTPs() { return Array.isArray(state.eotps) ? state.eotps : []; }
function getEOTP(code) {
  const k = (code || '').trim();
  if (!k) return null;
  return getEOTPs().find(e => (e.code || '').trim() === k) || null;
}
function addEOTP(unite) {
  if (!Array.isArray(state.eotps)) state.eotps = [];
  const id = 'eotp_' + uid();
  state.eotps.push({ id, code: '', label: '', budget: 0, unit: unite === 'h' ? 'h' : 'eur', setupId: '' });
  save();
  renderEOTPsConfig();
  // La nouvelle ligne est vide : on met le curseur dedans plutôt que de
  // laisser l'utilisateur la chercher au milieu des autres.
  requestAnimationFrame(() => {
    const inp = document.querySelector('.eotp-row[data-eotp-id="' + cssEscape(id) + '"] .eotp-code');
    if (inp) { inp.focus(); inp.scrollIntoView({ block: 'nearest' }); }
  });
}
// Unité du budget : 'eur' (défaut, dépenses de Consommable) ou 'h'
// (main-d'œuvre). Les lignes en heures sont celles que suit l'onglet Heures,
// dont elles alimentent la colonne « Budget heure ».
function isHourEOTP(eotp) { return !!eotp && eotp.unit === 'h'; }
function getHourEOTPs() { return getEOTPs().filter(isHourEOTP); }
function toggleEOTPUnit(id) {
  const e = getEOTPs().find(x => x.id === id);
  if (!e) return;
  e.unit = isHourEOTP(e) ? 'eur' : 'h';
  if (!isHourEOTP(e)) e.setupId = '';   // le rattachement n'a de sens qu'en heures
  save();
  renderConsommable();
  renderHeures();
}
// Rattachement d'une ligne de budget à un ouvrage : le suivi des heures y
// puise alors quantité totale, quantité réalisée et unité, au lieu de les
// faire ressaisir. '' = saisie manuelle (comportement d'origine).
function setEOTPSetup(id, setupId) {
  const e = getEOTPs().find(x => x.id === id);
  if (!e) return;
  e.setupId = state.taskSetups.some(s => s.id === setupId) ? setupId : '';
  save();
  renderHeures();
}
function getEOTPSetup(eotp) {
  if (!eotp || !eotp.setupId) return null;
  return state.taskSetups.find(s => s.id === eotp.setupId) || null;
}
function removeEOTP(id) {
  const e = getEOTPs().find(x => x.id === id);
  if (!e) return;
  const label = e.code || e.label || 'cette ligne';
  if (!confirm(`Supprimer la ligne de budget « ${label} » ?\nLes commandes existantes conservent ce code mais il ne sera plus proposé dans le menu déroulant.`)) return;
  state.eotps = getEOTPs().filter(x => x.id !== id);
  save();
  renderEOTPsConfig();
  renderConsommable();
}
function setEOTPCode(id, code) {
  const e = getEOTPs().find(x => x.id === id);
  if (!e) return;
  const oldCode = e.code;
  const newCode = (code || '').trim();
  e.code = newCode;
  // Si le code change et qu'il existait avant, on met à jour les
  // entrées qui le référencent pour ne pas créer d'orphelins.
  if (oldCode && oldCode !== newCode) {
    for (const entry of getConsommableEntries()) {
      if (entry.eOTP === oldCode) entry.eOTP = newCode;
    }
  }
  save();
  renderConsommable();
}
function setEOTPLabel(id, label) {
  const e = getEOTPs().find(x => x.id === id);
  if (!e) return;
  e.label = (label || '').trim();
  save();
  renderConsommable();
}
function setEOTPBudget(id, value) {
  const e = getEOTPs().find(x => x.id === id);
  if (!e) return;
  const n = parseFloat(String(value).replace(',', '.'));
  e.budget = Number.isFinite(n) && n >= 0 ? n : 0;
  save();
  // La colonne « Budget heure » du suivi des heures lit cette valeur.
  if (isHourEOTP(e)) renderHeures();
}
// Migration douce : à la première lecture du storage avec eOTP existants
// dans les entrées mais pas encore dans le registre, on enregistre les
// codes pour qu'ils apparaissent dans le menu déroulant. Une fois fait,
// le flag empêche de tout réajouter si l'utilisateur supprime un code.
function migrateEOTPsFromConsoEntries() {
  if (state.eotpRegistryInitialized) return;
  if (!Array.isArray(state.eotps)) state.eotps = [];
  const known = new Set(state.eotps.map(x => (x.code || '').trim()));
  for (const e of getConsommableEntries()) {
    const code = (e.eOTP || '').trim();
    if (!code || known.has(code)) continue;
    state.eotps.push({ id: 'eotp_' + uid(), code, label: '', budget: 0 });
    known.add(code);
  }
  state.eotpRegistryInitialized = true;
}
// Migration des unités (v1.71). Avant la bascule € / h, l'onglet Heures
// proposait toutes les lignes de budget et son budget horaire était saisi
// dans le tableau. On bascule donc en « h » les lignes qui y étaient déjà
// cochées, et on remonte leur budget horaire de la dernière semaine vers la
// ligne de budget — sans quoi le tableau se viderait à la mise à jour.
function migrateEOTPUnits() {
  if (state.eotpUnitsInitialized) return;
  const weeks = Array.isArray(state.heuresWeeks) ? state.heuresWeeks : [];
  const data = state.heuresData && typeof state.heuresData === 'object' ? state.heuresData : {};
  const tracked = new Map();   // eotpId → dernier budget horaire saisi
  for (const w of weeks) {
    const bucket = data[w.id];
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [eotpId, row] of Object.entries(bucket)) {
      if (!row || !row.selected) continue;
      tracked.set(eotpId, Number(row.budgetHeures) || 0);
    }
  }
  for (const e of getEOTPs()) {
    if (e.unit === 'h' || e.unit === 'eur') continue;
    if (tracked.has(e.id)) {
      e.unit = 'h';
      const b = tracked.get(e.id);
      if (b > 0) e.budget = b;
    } else {
      e.unit = 'eur';
    }
  }
  state.eotpUnitsInitialized = true;
}

// Affichage : code « OTP-2026-001 » ou « OTP-2026-001 — Plomberie » si label
function eotpDisplay(eotp) {
  if (!eotp) return '';
  return eotp.label ? `${eotp.code} — ${eotp.label}` : eotp.code;
}

// ========================================================================
// SUIVI DES HEURES (onglet dédié, optimisé PC)
// Tableau récapitulatif par eOTP : budgets en heures, ratios, droit à
// dépenser (valeur acquise), heures pointées (PUMA/SAP), écart au stade.
// Les lignes sont les eOTP « sélectionnés » (cochés). La colonne « Qté
// réalisé au stade » est saisie manuellement pour l'instant ; sa liaison
// avec l'avancement physique est prévue dans une étape ultérieure.
// ========================================================================

// Champs numériques de saisie (parse FR : virgule décimale acceptée).
// « budgetHeures » n'y figure pas : il est lu dans Données → eOTP.
const HEURES_NUM_FIELDS = ['qteTotal', 'qteRealisee', 'sap', 'correction', 'pumaCumule', 'ecartFdcCorrige'];
// Champs qui acceptent une valeur négative : la Correction (le PUMA peut être
// sous le SAP) et l'écart FDC corrigé (négatif = dépassement projeté).
const HEURES_SIGNED_FIELDS = new Set(['correction', 'ecartFdcCorrige']);

// --- Semaines (instantanés du tableau, pour comparer les écarts) ----------
// Migration douce : l'ancien format (v1.19-1.21) stockait heuresData à plat
// { [eotpId]: row }. On le bascule dans une 1re semaine « Semaine 1 ».
function migrateHeuresWeeks() {
  if (!Array.isArray(state.heuresWeeks)) state.heuresWeeks = [];
  if (state.heuresWeeks.length > 0) return;

  const old = state.heuresData;
  const vals = old && typeof old === 'object' ? Object.values(old) : [];
  const looksFlat = vals.some(v => v && typeof v === 'object' &&
    ('budgetHeures' in v || 'selected' in v || 'qteTotal' in v));

  const wid = 'hw_' + uid();
  state.heuresWeeks = [{
    id: wid, name: 'Semaine 1', createdAt: Date.now(),
    sapDate: typeof state.heuresSapDate === 'string' ? state.heuresSapDate : '03/04'
  }];
  state.heuresActiveWeekId = wid;
  // Nidifie l'ancien jeu plat sous la 1re semaine ; sinon repart vide.
  state.heuresData = { [wid]: looksFlat ? old : {} };
}

function getHeuresWeeks() {
  if (!Array.isArray(state.heuresWeeks) || state.heuresWeeks.length === 0) {
    migrateHeuresWeeks();
  }
  return state.heuresWeeks;
}
function getHeuresActiveWeek() {
  const weeks = getHeuresWeeks();
  const found = weeks.find(w => w.id === state.heuresActiveWeekId);
  return found || weeks[weeks.length - 1];
}
// Une semaine est VERROUILLÉE dès qu'une semaine plus récente existe. Le
// verrou n'est pas un drapeau à migrer : il se déduit de la position, donc il
// est vrai sur toutes les installations dès la mise à jour et la synchro ne
// peut pas le contredire. Son effet réel n'est pas de griser des champs — c'est
// d'arrêter de RÉÉCRIRE les valeurs stockées depuis le budget eOTP et depuis le
// modèle d'avancement vivant. Sans cela, corriger un budget aujourd'hui
// déplacerait l'écart au stade de toutes les semaines passées, et donc l'écart
// S/S-1 de la semaine suivante.
// `w.unlocked` est l'issue de secours : posée à la main, elle rend la semaine
// modifiable et ses valeurs à nouveau vivantes.
function isHeuresWeekLocked(week) {
  if (!week || week.unlocked) return false;
  const weeks = getHeuresWeeks();
  const i = weeks.findIndex(w => w.id === week.id);
  return i >= 0 && i < weeks.length - 1;
}
function setHeuresWeekUnlocked(weekId, on) {
  const w = getHeuresWeeks().find(x => x.id === weekId);
  if (!w) return;
  if (on) w.unlocked = true; else delete w.unlocked;
  save();
  renderHeures();
  showToast(on
    ? 'Semaine déverrouillée — ses valeurs redeviennent vivantes, l\'écart S/S-1 de la semaine suivante va bouger'
    : 'Semaine reverrouillée');
}
// Semaine qui précède celle-ci dans le classeur (null pour la première).
function getHeuresPrevWeek(week) {
  const weeks = getHeuresWeeks();
  const i = weeks.findIndex(w => w.id === (week || {}).id);
  return i > 0 ? weeks[i - 1] : null;
}
// Écarts au stade de la semaine précédente, par eOTP. LECTURE PURE : on ne
// passe pas par getHeuresRow/resolveHeuresRow, qui écriraient dans le bucket
// de cette semaine et détruiraient l'instantané qu'on vient y lire.
function getHeuresPrevEcarts() {
  const prev = getHeuresPrevWeek(getHeuresActiveWeek());
  if (!prev) return null;
  const bucket = (state.heuresData || {})[prev.id];
  if (!bucket) return null;
  const out = new Map();
  for (const [id, raw] of Object.entries(bucket)) {
    if (!raw || !raw.selected) continue;
    out.set(id, computeHeuresRow(raw).ecart);
  }
  return out;
}
function setHeuresActiveWeek(weekId) {
  state.heuresActiveWeekId = weekId;
  save();
  renderHeures();
}
function getNextHeuresWeekName(weeks) {
  let max = 0;
  for (const w of weeks) {
    const m = /^Semaine\s+(\d+)$/i.exec((w.name || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'Semaine ' + (max + 1);
}
// Bucket de données d'une semaine (créé au besoin).
function getHeuresWeekData(weekId) {
  if (!state.heuresData || typeof state.heuresData !== 'object') state.heuresData = {};
  if (!state.heuresData[weekId] || typeof state.heuresData[weekId] !== 'object') {
    state.heuresData[weekId] = {};
  }
  return state.heuresData[weekId];
}
// Nouvelle semaine = copie intégrale de la semaine active (report des budgets
// et quantités pour rendre les écarts d'une semaine à l'autre exploitables).
function addHeuresWeek() {
  const weeks = getHeuresWeeks();
  const active = getHeuresActiveWeek();
  const wid = 'hw_' + uid();
  const newWeek = {
    id: wid,
    name: getNextHeuresWeekName(weeks),
    createdAt: Date.now(),
    sapDate: active ? (active.sapDate || '03/04') : '03/04'
  };
  weeks.push(newWeek);
  // Copie profonde des lignes de la semaine active.
  const prevData = active ? getHeuresWeekData(active.id) : {};
  const copy = {};
  for (const eotpId of Object.keys(prevData)) {
    copy[eotpId] = { ...prevData[eotpId] };
  }
  state.heuresData[wid] = copy;
  state.heuresActiveWeekId = wid;
  save();
  renderHeures();
  // Sélectionne le texte de l'onglet fraîchement créé pour le renommer vite.
  requestAnimationFrame(() => {
    const inp = document.querySelector('.heures-week-tab.is-active .heures-week-name');
    if (inp) { inp.focus(); inp.select(); }
  });
}
function renameHeuresWeek(weekId, name) {
  const w = getHeuresWeeks().find(x => x.id === weekId);
  if (!w) return;
  w.name = String(name || '');
  save();
  // Pas de re-rendu : l'input garde le focus pendant la frappe.
}
function deleteHeuresWeek(weekId) {
  const weeks = getHeuresWeeks();
  if (weeks.length <= 1) return; // garde toujours au moins une semaine
  const w = weeks.find(x => x.id === weekId);
  if (!w) return;
  if (!confirm(`Supprimer « ${w.name || 'cette semaine'} » et ses données ?`)) return;
  const idx = weeks.findIndex(x => x.id === weekId);
  weeks.splice(idx, 1);
  if (state.heuresData) delete state.heuresData[weekId];
  if (state.heuresActiveWeekId === weekId) {
    const fallback = weeks[Math.max(0, idx - 1)];
    state.heuresActiveWeekId = fallback ? fallback.id : '';
  }
  save();
  renderHeures();
}

// Accès paresseux à l'objet de données d'un eOTP pour la SEMAINE ACTIVE.
function getHeuresRow(eotpId) {
  const week = getHeuresActiveWeek();
  const bucket = getHeuresWeekData(week.id);
  let row = bucket[eotpId];
  if (!row) {
    row = { selected: false, budgetHeures: 0, unite: '', qteTotal: 0, qteRealisee: 0,
            sap: 0, correction: 0, pumaCumule: 0, ecartFdcCorrige: 0 };
    bucket[eotpId] = row;
  }
  // Le budget heures n'est plus saisi dans le tableau : il est repris de la
  // ligne de budget correspondante (Données → eOTP, unité « h »). On le
  // recopie dans l'instantané de la semaine — MAIS seulement tant que la
  // semaine est ouverte : une semaine verrouillée garde le budget qu'elle
  // avait au moment où on l'a quittée.
  if (!isHeuresWeekLocked(week)) {
    const eotp = getEOTPs().find(e => e.id === eotpId);
    if (eotp) row.budgetHeures = Number(eotp.budget) || 0;
  }
  return row;
}

// Colonnes calculées d'une ligne. Renvoie aussi les drapeaux de validité
// pour gérer les divisions par zéro proprement.
function computeHeuresRow(row) {
  const budget = Number(row.budgetHeures) || 0;
  const qteTotal = Number(row.qteTotal) || 0;
  const qteReal = Number(row.qteRealisee) || 0;
  const puma = Number(row.pumaCumule) || 0;
  const correction = Number(row.correction) || 0;
  const ecartFdcCorrige = Number(row.ecartFdcCorrige) || 0;

  const ratio = qteTotal > 0 ? budget / qteTotal : null;          // Budget h / Qté totale
  const avancement = qteTotal > 0 ? qteReal / qteTotal : null;    // Qté réalisée / Qté totale (0..1)
  const droit = avancement != null ? budget * avancement : 0;     // Budget h × avancement % (valeur acquise)
  const qteRestante = qteTotal > 0 ? qteTotal - qteReal : null;   // Quantité : Qté totale − Qté réalisée

  // La Correction se SOUSTRAIT du PUMA cumulé. Elle mesure de combien le PUMA
  // dépasse le SAP ; la retrancher recale le cumulé sur la référence SAP.
  // (Le classeur de référence écrit « =K−J » sur toutes ses feuilles, alors
  // que son propre en-tête annonce un « + » — c'est la formule qui fait foi.)
  const pumaEcart = puma - correction;

  const ratioActuel = qteReal > 0 ? pumaEcart / qteReal : null;   // (PUMA − Correction) / Qté réalisée
  // Projection : au ratio constaté quand il existe, sinon au ratio théorique.
  // Retomber sur zéro — ce que fait le IFERROR du classeur — reviendrait à
  // projeter zéro heure restante pour un ouvrage pas commencé.
  const ratioProjete = ratioActuel != null ? ratioActuel : ratio;
  const estimeAuTheorique = ratioActuel == null && ratio != null && qteRestante != null;
  const radHeures = (ratioProjete != null && qteRestante != null)  // Reste à dépenser, en heures
    ? qteRestante * ratioProjete : null;
  const fdcAuto = radHeures != null ? pumaEcart + radHeures : null; // Projection fin de chantier
  const ecartFdc = fdcAuto != null ? budget - fdcAuto : null;      // Dépassement projeté en fin de chantier
  const ecart = droit - pumaEcart;                                 // Écart au stade
  const radCorrige = budget - pumaEcart - ecartFdcCorrige;         // Reste à dépenser sous la projection corrigée

  return { budget, ratio, avancement, droit, qteRestante, pumaEcart, ratioActuel,
           radHeures, fdcAuto, ecartFdc, ecart, ecartFdcCorrige, radCorrige, estimeAuTheorique };
}

// L'écart de la semaine ne se déduit pas d'une ligne seule : il lui faut la
// même ligne la semaine d'avant. On l'ajoute au résultat au moment du rendu.
// `prev` est la Map rendue par getHeuresPrevEcarts() (null = première semaine).
function withHeuresEcartSem(comp, eotpId, prev) {
  comp.ecartSem = (prev && prev.has(eotpId)) ? comp.ecart - prev.get(eotpId) : null;
  return comp;
}

// Formatage heures : entier si rond, sinon 1 décimale, séparateurs FR.
function fmtHeures(n) {
  const v = Number(n) || 0;
  const dec = Number.isInteger(v) ? 0 : 1;
  return v.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: 1 });
}
// Valeur numérique pour un input (vide si 0, pour ne pas afficher des « 0 » partout).
function fmtHeuresInput(n) {
  const v = Number(n) || 0;
  if (v === 0) return '';
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/ /g, '');
}


// Date de référence affichée entre parenthèses dans l'en-tête « SAP (…) ».
// Propre à la semaine active (chaque instantané a sa date d'extraction SAP).
function getHeuresSapDate() {
  const week = getHeuresActiveWeek();
  return week && typeof week.sapDate === 'string' ? week.sapDate : '03/04';
}
function setHeuresSapDate(value) {
  const week = getHeuresActiveWeek();
  if (week) week.sapDate = String(value || '');
  save();
  // Pas de re-rendu : l'input conserve sa valeur, rien d'autre n'en dépend.
}

function setHeuresField(eotpId, field, value) {
  if (isHeuresWeekLocked(getHeuresActiveWeek())) return;   // semaine close
  const row = getHeuresRow(eotpId);
  if (field === 'unite') {
    row.unite = (value || '').trim();
  } else if (HEURES_NUM_FIELDS.includes(field)) {
    const n = parseFloat(String(value).replace(',', '.'));
    if (HEURES_SIGNED_FIELDS.has(field)) {
      row[field] = Number.isFinite(n) ? n : 0;
    } else {
      row[field] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
  }
  save();
  // Re-rendu ciblé des colonnes calculées de la ligne + du pied, sans
  // reconstruire les inputs (préserve le focus de saisie).
  refreshHeuresComputed(eotpId);
}

function renderHeures() {
  invalidateHeuresModel();
  renderHeuresWeekTabs();
  renderHeuresEOTPSelect();
  renderHeuresLockBar();
  renderHeuresTable();
  const addGroup = document.getElementById('heuresaddgroup');
  if (addGroup && !addGroup.dataset.bound) {
    addGroup.dataset.bound = '1';
    addGroup.addEventListener('click', addHeuresGroup);
  }
  const exp = document.getElementById('heuresexport');
  if (exp && !exp.dataset.bound) {
    exp.dataset.bound = '1';
    exp.addEventListener('click', () => exportHeuresToPDF());
  }
}

// Bandeau d'une semaine close. Il est posé AVANT le conteneur du tableau,
// pas dedans : le conteneur défile horizontalement, un bloc placé à
// l'intérieur sortirait de l'écran au premier geste — or c'est la seule
// surface qui explique pourquoi les chiffres ne bougent plus.
function renderHeuresLockBar() {
  const wrap = document.getElementById('heurestablewrap');
  if (!wrap || !wrap.parentNode) return;
  const old = document.getElementById('heureslockbar');
  if (old) old.remove();
  const week = getHeuresActiveWeek();
  if (!week) return;
  const weeks = getHeuresWeeks();
  const i = weeks.findIndex(w => w.id === week.id);
  const archivee = i >= 0 && i < weeks.length - 1;
  if (!archivee) return;

  const bar = dbEl('div', 'heures-lock-bar');
  bar.id = 'heureslockbar';
  const verrou = isHeuresWeekLocked(week);
  if (verrou) {
    bar.appendChild(dbEl('strong', '', '\uD83D\uDD12 Semaine close.'));
    bar.appendChild(dbEl('span', '',
      'Ses valeurs sont figées telles qu\'elles étaient à la création de « '
      + (weeks[i + 1].name || 'la semaine suivante')
      + ' ». C\'est ce qui rend l\'écart S/S-1 fiable.'));
  } else {
    bar.appendChild(dbEl('strong', '', '\u26A0 Semaine rouverte.'));
    bar.appendChild(dbEl('span', '',
      'Ses valeurs redeviennent vivantes : l\'écart S/S-1 de « '
      + (weeks[i + 1].name || 'la semaine suivante') + ' » va bouger avec elles.'));
  }
  const btn = dbEl('button', 'heures-lock-btn', verrou ? 'Rouvrir' : 'Reverrouiller');
  btn.type = 'button';
  btn.title = verrou
    ? 'Rouvrir cette semaine pour corriger une saisie. Les écarts de la semaine suivante s\'en trouveront modifiés.'
    : 'Refermer cette semaine et refiger ses valeurs.';
  btn.addEventListener('click', () => setHeuresWeekUnlocked(week.id, verrou));
  bar.appendChild(btn);
  wrap.parentNode.insertBefore(bar, wrap);
}

// Onglets de semaines, design « classeur ». L'onglet actif porte un champ
// éditable pour renommer la semaine ; un onglet « + » crée une semaine.
function renderHeuresWeekTabs() {
  const el = document.getElementById('heuresweektabs');
  if (!el) return;
  el.innerHTML = '';
  const weeks = getHeuresWeeks();
  const active = getHeuresActiveWeek();

  for (const w of weeks) {
    const isActive = active && w.id === active.id;
    const tab = document.createElement('div');
    const close = isHeuresWeekLocked(w);
    tab.className = 'heures-week-tab' + (isActive ? ' is-active' : '') + (close ? ' is-locked' : '');
    tab.dataset.weekId = w.id;
    if (close) tab.title = 'Semaine close : ses valeurs sont figées';

    if (isActive) {
      // Onglet actif : nom éditable + petite croix de suppression.
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'heures-week-name';
      input.value = w.name || '';
      input.maxLength = 24;
      input.size = Math.max(6, (w.name || '').length);
      input.setAttribute('aria-label', 'Nom de la semaine');
      input.addEventListener('input', () => {
        input.size = Math.max(6, input.value.length);
        renameHeuresWeek(w.id, input.value);
      });
      tab.appendChild(input);
      if (weeks.length > 1) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'heures-week-del';
        del.setAttribute('aria-label', 'Supprimer la semaine');
        del.textContent = '×';
        del.addEventListener('click', (e) => { e.stopPropagation(); deleteHeuresWeek(w.id); });
        tab.appendChild(del);
      }
    } else {
      // Onglet inactif : bouton de sélection.
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'heures-week-label';
      btn.textContent = w.name || '(sans nom)';
      btn.addEventListener('click', () => setHeuresActiveWeek(w.id));
      tab.appendChild(btn);
      if (close) tab.appendChild(dbEl('span', 'heures-week-lock', '\uD83D\uDD12'));
    }
    el.appendChild(tab);
  }

  // Onglet « + » : nouvelle semaine (copie de la semaine active).
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'heures-week-tab heures-week-add';
  add.setAttribute('aria-label', 'Nouvelle semaine');
  add.title = 'Nouvelle semaine (copie de la semaine active)';
  add.textContent = '+';
  add.addEventListener('click', addHeuresWeek);
  el.appendChild(add);
}

// Le suivi des heures lit l'avancement pour les lignes rattachées à un
// ouvrage. Le modèle est mémorisé quelques instants : `refreshHeuresComputed`
// est appelé à chaque frappe, on ne recalcule pas tout le chantier à chaque
// touche. `renderHeures` repart toujours d'un modèle frais.
let _heuresModel = null, _heuresModelAt = 0;
function invalidateHeuresModel() { _heuresModel = null; }
function getHeuresAvancementModel() {
  const now = Date.now();
  if (_heuresModel && now - _heuresModelAt < 1500) return _heuresModel;
  _heuresModel = computeAvancementModel('');
  _heuresModelAt = now;
  return _heuresModel;
}
// Ligne de tableau résolue : les champs alimentés par l'ouvrage rattaché
// écrasent la saisie manuelle, et l'on renvoie l'agrégat pour l'affichage.
function resolveHeuresRow(eotp, model) {
  const row = getHeuresRow(eotp.id);
  const link = eotp.setupId ? (model.ouvrages || []).find(o => o.setupId === eotp.setupId) : null;
  // Rattachement qui ne donne rien : soit l'ouvrage a été supprimé de
  // Données → Tâches, soit il n'est encore affecté à aucune zone. La ligne
  // retombe alors en saisie manuelle, mais on le dit — sans ce signal, elle
  // afficherait les dernières valeurs recopiées sans qu'on sache pourquoi
  // elles ne bougent plus.
  const orphan = !link && !!eotp.setupId;
  // Reprise des quantités depuis l'ouvrage : elle s'arrête au verrouillage,
  // sinon saisir de l'avancement aujourd'hui réécrirait les quantités des
  // semaines déjà closes.
  if (link && !isHeuresWeekLocked(getHeuresActiveWeek())) {
    row.unite = link.unit || '';
    row.qteTotal = Math.round(link.qtyTotal * 100) / 100;
    row.qteRealisee = Math.round(link.qtyDone * 100) / 100;
  }
  return { row, link, orphan, setup: eotp.setupId ? getEOTPSetup(eotp) : null };
}
const HEURES_AUTO_FIELDS = new Set(['unite', 'qteTotal', 'qteRealisee']);

// Lignes de budget suivies ici : celles dont l'unité est « h ». Une ligne en
// euros relève de Consommable → Budget, pas du suivi de main-d'œuvre.
function getHeuresCandidates() {
  return getHourEOTPs()
    .filter(e => (e.code || '').trim() || (e.label || '').trim())
    .sort((a, b) => (a.code || '').localeCompare(b.code || '', 'fr'));
}

// Sélecteur compact : un bouton qui déplie un panneau de cases à cocher.
// La rangée de pastilles occupait une à trois lignes entières ; ici tout
// tient sur la ligne des onglets de semaines.
function renderHeuresEOTPSelect() {
  const el = document.getElementById('heureseotpselect');
  if (!el) return;
  const wasOpen = !!el.querySelector('.heures-eotp-panel:not([hidden])');
  el.innerHTML = '';
  const eotps = getHeuresCandidates();

  const btn = dbEl('button', 'heures-eotp-toggle');
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  btn.appendChild(dbEl('span', 'heures-eotp-toggle-label', 'eOTP suivis'));
  const count = dbEl('span', 'heures-eotp-count');
  const chevron = dbEl('span', 'heures-eotp-chevron', '▾');
  btn.append(count, chevron);
  el.appendChild(btn);

  const panel = dbEl('div', 'heures-eotp-panel');
  panel.hidden = true;
  el.appendChild(panel);

  const refreshCount = () => {
    const sel = eotps.filter(e => getHeuresRow(e.id).selected).length;
    count.textContent = sel + ' / ' + eotps.length;
    btn.classList.toggle('is-empty', sel === 0);
  };

  if (eotps.length === 0) {
    count.textContent = '0';
    btn.classList.add('is-empty');
    btn.disabled = true;
    btn.title = 'Aucune ligne de budget en heures. Dans Données → eOTP, basculez une ligne sur « h ».';
    panel.remove();
    return;
  }

  const actions = dbEl('div', 'heures-eotp-actions');
  const mkAction = (label, value) => {
    const b = dbEl('button', 'heures-eotp-action', label);
    b.type = 'button';
    b.addEventListener('click', () => {
      for (const e of eotps) getHeuresRow(e.id).selected = value;
      save();
      renderHeures();
      openHeuresEOTPPanel();
    });
    return b;
  };
  actions.append(mkAction('Tout cocher', true), mkAction('Tout décocher', false));
  panel.appendChild(actions);

  for (const e of eotps) {
    const row = getHeuresRow(e.id);
    const opt = dbEl('label', 'heures-eotp-opt' + (row.selected ? ' is-selected' : ''));
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!row.selected;
    cb.addEventListener('change', () => {
      row.selected = cb.checked;
      save();
      opt.classList.toggle('is-selected', cb.checked);
      renderHeuresTable();
      refreshCount();
    });
    opt.appendChild(cb);
    opt.appendChild(dbEl('span', 'heures-eotp-opt-name', eotpDisplay(e) || '(sans code)'));
    opt.appendChild(dbEl('span', 'heures-eotp-opt-budget', fmtHeures(Number(e.budget) || 0) + ' h'));
    panel.appendChild(opt);
  }
  refreshCount();

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (panel.hidden) openHeuresEOTPPanel(); else closeHeuresEOTPPanel();
  });
  panel.addEventListener('click', (ev) => ev.stopPropagation());
  if (wasOpen) openHeuresEOTPPanel();
}
function openHeuresEOTPPanel() {
  const el = document.getElementById('heureseotpselect');
  if (!el) return;
  const panel = el.querySelector('.heures-eotp-panel');
  const btn = el.querySelector('.heures-eotp-toggle');
  if (!panel || !btn) return;
  panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('is-open');
  document.addEventListener('click', closeHeuresEOTPPanel);
  document.addEventListener('keydown', heuresEOTPPanelEsc);
}
function closeHeuresEOTPPanel() {
  const el = document.getElementById('heureseotpselect');
  document.removeEventListener('click', closeHeuresEOTPPanel);
  document.removeEventListener('keydown', heuresEOTPPanelEsc);
  if (!el) return;
  const panel = el.querySelector('.heures-eotp-panel');
  const btn = el.querySelector('.heures-eotp-toggle');
  if (panel) panel.hidden = true;
  if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('is-open'); }
}
function heuresEOTPPanelEsc(e) { if (e.key === 'Escape') closeHeuresEOTPPanel(); }

// Définition des colonnes du tableau. `calc` = colonne dérivée (lecture seule).
// L'ordre suit celui du classeur de référence : d'abord le métré et le droit
// acquis, puis le constat AU STADE, puis la projection EN FIN DE CHANTIER.
const HEURES_COLUMNS = [
  { key: 'taches',          label: 'Tâches',            kind: 'label' },
  { key: 'budgetHeures',    label: 'Budget heure',      kind: 'calc', cat: 'budget',     title: 'Budget de la ligne eOTP saisi dans Données → eOTP (unité « h »)' },
  { key: 'unite',           label: 'Unités',            kind: 'text', cat: 'budget' },
  { key: 'ratio',           label: 'Ratio théo.',       kind: 'calc', cat: 'budget',     title: 'Ratio théorique : Budget heure ÷ Qté totale' },
  { key: 'qteTotal',        label: 'Qté totale',        kind: 'num',  cat: 'budget',     title: 'Quantité totale de l\'ouvrage' },
  { key: 'qteRealisee',     label: 'Qté réalisée',      kind: 'num',  cat: 'avancement', title: 'Quantité réalisée au stade — saisie manuelle' },
  { key: 'avancement',      label: 'Avanc.',            kind: 'calc', cat: 'avancement', title: 'Avancement : Qté réalisée ÷ Qté totale' },
  { key: 'droit',           label: 'Droit à dép.',      kind: 'calc', cat: 'avancement', title: 'Droit à dépenser : Budget heure × avancement (valeur acquise)' },
  { key: 'sap',             label: 'SAP',               kind: 'num',  cat: 'sap' },
  { key: 'correction',      label: 'Correction',        kind: 'num',  cat: 'sap',        title: 'Correction PUMA − SAP : de combien le PUMA dépasse le SAP. Elle est RETRANCHÉE du PUMA cumulé. Peut être négative.' },
  { key: 'pumaCumule',      label: 'PUMA cum.',         kind: 'num',  cat: 'puma',       title: 'PUMA cumulé' },
  { key: 'pumaEcart',       label: 'PUMA corrigé',      kind: 'calc', cat: 'puma',       title: 'PUMA cumulé − Correction : les heures pointées, recalées sur la référence SAP' },
  { key: 'ecart',           label: 'Écart au stade',    kind: 'calc', cat: 'stade',      title: 'Droit à dépenser − PUMA corrigé. Positif = dans le budget à ce jour.' },
  { key: 'ratioActuel',     label: 'Ratio actuel',      kind: 'calc', cat: 'stade',      title: 'PUMA corrigé ÷ Qté réalisée — le ratio réellement constaté' },
  { key: 'radHeures',       label: 'RAD (h)',           kind: 'calc', cat: 'fdc',        title: 'Reste à dépenser : (Qté totale − Qté réalisée) × ratio actuel. Au ratio théorique tant qu\'aucune quantité n\'est réalisée.' },
  { key: 'fdcAuto',         label: 'FDC auto',          kind: 'calc', cat: 'fdc',        title: 'Fin de chantier projetée : PUMA corrigé + RAD (h)' },
  { key: 'ecartFdc',        label: 'Écart FDC',         kind: 'calc', cat: 'fdc',        title: 'Budget heure − FDC auto : le dépassement projeté en fin de chantier. Positif = on rentre dans le budget.' },
  { key: 'ecartFdcCorrige', label: 'Écart FDC corr.',   kind: 'num',  cat: 'manuel',     title: 'Votre appréciation de l\'écart en fin de chantier, quand le calcul automatique ne reflète pas ce que vous savez du chantier. Saisie manuelle.' },
  { key: 'radCorrige',      label: 'RAD corrigé',       kind: 'calc', cat: 'manuel',     title: 'Budget heure − PUMA corrigé − Écart FDC corrigé : les heures qu\'il reste à dépenser sous votre projection' },
  { key: 'ecartSem',        label: 'Écart S/S-1',       kind: 'calc', cat: 'evolution',  title: 'Écart au stade de cette semaine − celui de la semaine précédente. Positif = on a gagné cette semaine.' }
];
// Colonnes d'écart : vert quand c'est favorable, rouge quand ça dépasse.
const HEURES_SIGNED_COLUMNS = new Set(['ecart', 'ecartFdc', 'ecartSem']);
// Colonnes réellement saisies à la main : elles portent un contraste crème
// pour se repérer d'un coup d'œil dans un tableau de vingt colonnes.
const HEURES_SAISIE_COLUMNS = new Set(['qteRealisee', 'pumaCumule']);

// --- Catégories d'en-tête (1re rangée du THEAD), repliables ---------------
// Les bandeaux se déduisent des SUITES CONTIGUËS de même `cat` : l'ordre des
// bandeaux ne peut donc pas diverger de celui des colonnes, et ajouter ou
// retirer une colonne fait apparaître ou disparaître sa catégorie toute seule.
const HEURES_CAT_META = {
  budget:     { label: 'Budget',     abbr: 'Budget' },
  avancement: { label: 'Avancement', abbr: 'Avanc.' },
  sap:        { label: 'SAP',        abbr: 'SAP' },
  puma:       { label: 'PUMA',       abbr: 'PUMA' },
  stade:      { label: 'Au stade',   abbr: 'Stade' },
  fdc:        { label: 'FDC auto',   abbr: 'FDC' },
  manuel:     { label: 'Manuel',     abbr: 'Manuel' },
  evolution:  { label: 'Évolution',  abbr: 'S/S-1' }
};
function getHeuresCatRuns() {
  const runs = [];
  for (const col of HEURES_COLUMNS) {
    if (!col.cat) continue;                       // la colonne Tâches n'en a pas
    const last = runs[runs.length - 1];
    if (last && last.key === col.cat) { last.cols.push(col); continue; }
    const meta = HEURES_CAT_META[col.cat] || { label: col.cat, abbr: col.cat };
    runs.push({ key: col.cat, label: meta.label, abbr: meta.abbr, cols: [col] });
  }
  return runs;
}
// Première colonne de chaque catégorie : elle porte le trait de séparation.
function getHeuresCatStarts() {
  return new Set(getHeuresCatRuns().map(r => r.cols[0].key));
}
function getHeuresCollapsedCats() {
  if (!Array.isArray(state.heuresColsCollapsed)) state.heuresColsCollapsed = [];
  return new Set(state.heuresColsCollapsed);
}
function toggleHeuresCat(key) {
  const set = getHeuresCollapsedCats();
  if (set.has(key)) set.delete(key); else set.add(key);
  const known = new Set(getHeuresCatRuns().map(r => r.key));
  state.heuresColsCollapsed = [...set].filter(k => known.has(k));   // purge des clés obsolètes
  save();
  renderHeuresTable();   // pas renderHeures() : les onglets et le sélecteur ne changent pas
}
// Cellules réellement émises, hors colonne Tâches, dans l'ordre d'affichage :
//   { t:'col', col, start } pour une colonne, { t:'fold', run } pour un pli.
function getHeuresVisibleCells() {
  const collapsed = getHeuresCollapsedCats();
  const out = [];
  for (const run of getHeuresCatRuns()) {
    if (collapsed.has(run.key)) { out.push({ t: 'fold', run }); continue; }
    run.cols.forEach((col, i) => out.push({ t: 'col', col, start: i === 0 }));
  }
  return out;
}

// Largeurs : un pourcentage pour l'affichage, un plancher en pixels pour la
// min-width. Sans <colgroup>, `table-layout: fixed` prendrait ses largeurs sur
// la PREMIÈRE rangée — celle des catégories, dont les cellules ont un colSpan —
// et les répartirait à parts égales.
const HEURES_NARROW_COLS = new Set(['unite', 'ratio', 'avancement', 'ratioActuel']);
const HEURES_W   = { label: 13.0, wide: 4.70, narrow: 3.50, fold: 2.20 };  // %
const HEURES_MIN = { label: 186,  wide: 68,   narrow: 52,   fold: 32 };    // px
function heuresCellMetrics(cell) {
  if (cell.t === 'fold') return { pct: HEURES_W.fold, min: HEURES_MIN.fold };
  return HEURES_NARROW_COLS.has(cell.col.key)
    ? { pct: HEURES_W.narrow, min: HEURES_MIN.narrow }
    : { pct: HEURES_W.wide,   min: HEURES_MIN.wide };
}
function buildHeuresColgroup(cells) {
  const cg = document.createElement('colgroup');
  const first = document.createElement('col');
  first.style.width = HEURES_W.label + '%';
  cg.appendChild(first);
  const m = cells.map(heuresCellMetrics);
  const rest = 100 - HEURES_W.label;
  const tot = m.reduce((a, x) => a + x.pct, 0) || 1;
  cells.forEach((cell, k) => {
    const c = document.createElement('col');
    c.className = cell.t === 'fold' ? 'heures-colw-fold' : 'heures-colw-' + cell.col.key;
    // Renormalisation : les colonnes visibles remplissent toujours 100 %,
    // repliées ou non — sinon replier laisserait un vide réparti au hasard.
    c.style.width = (m[k].pct * rest / tot).toFixed(3) + '%';
    cg.appendChild(c);
  });
  return cg;
}
function heuresMinWidth(cells) {
  return HEURES_MIN.label + cells.reduce((a, c) => a + heuresCellMetrics(c).min, 0);
}
// Bande d'une catégorie repliée : un accordéon fermé, cliquable sur toute sa
// hauteur pour redéplier.
function buildHeuresFoldCell(run, tag) {
  const el = document.createElement(tag || 'td');
  el.className = 'heures-fold heures-fold-' + run.key;
  el.dataset.cat = run.key;
  el.title = 'Déplier « ' + run.label + ' » (' + run.cols.map(c => c.label).join(', ') + ')';
  return el;
}

// Texte affiché pour une cellule calculée donnée.
function heuresCalcText(key, comp) {
  switch (key) {
    case 'budgetHeures': return fmtHeures(comp.budget) + ' h';
    case 'ratio':        return comp.ratio != null ? fmtHeures(comp.ratio) : '—';
    case 'avancement':   return comp.avancement != null ? Math.round(comp.avancement * 100) + ' %' : '—';
    case 'droit':        return fmtHeures(comp.droit) + ' h';
    case 'pumaEcart':    return fmtHeures(comp.pumaEcart) + ' h';
    case 'ratioActuel':  return comp.ratioActuel != null ? fmtHeures(comp.ratioActuel) : '—';
    case 'radHeures':    return comp.radHeures != null ? fmtHeures(comp.radHeures) + ' h' : '—';
    case 'fdcAuto':      return comp.fdcAuto != null ? fmtHeures(comp.fdcAuto) + ' h' : '—';
    case 'ecartFdc':     return comp.ecartFdc != null ? fmtHeures(comp.ecartFdc) + ' h' : '—';
    case 'radCorrige':   return fmtHeures(comp.radCorrige) + ' h';
    case 'ecart':        return fmtHeures(comp.ecart) + ' h';
    case 'ecartSem':     return comp.ecartSem != null ? fmtHeures(comp.ecartSem) + ' h' : '—';
    default:             return '—';
  }
}

// ----- Ordre et rubriques du suivi des heures -----
// `state.heuresLayout` est une liste à plat qui donne l'ordre d'affichage :
// des rubriques `{ t:'g', id, name }` et des lignes `{ t:'e', id, g }`.
// L'appartenance à une rubrique est portée par la ligne elle-même (`g`), pas
// par sa position : déplacer une rubrique n'avale donc pas les lignes qui la
// suivent, et des lignes libres peuvent vivre sous une rubrique remplie.
// La position, elle, reste libre — la même mécanique de glissé sert au
// réordonnancement et au regroupement.
function getHeuresLayoutRaw() {
  if (!Array.isArray(state.heuresLayout)) state.heuresLayout = [];
  return state.heuresLayout;
}
// Réconcilie la disposition avec les lignes de budget réellement présentes
// (on retire ce qui n'existe plus, on ajoute ce qui vient d'apparaître) puis
// normalise : chaque ligne se range juste sous l'en-tête de sa rubrique.
function getHeuresLayout() {
  const candidates = getHeuresCandidates();
  const known = new Set(candidates.map(e => e.id));
  const raw = getHeuresLayoutRaw();
  const groupIds = new Set(raw.filter(i => i && i.t === 'g' && i.id).map(i => i.id));
  const items = [];
  const seen = new Set();
  for (const it of raw) {
    if (!it || !it.id || seen.has(it.id)) continue;
    if (it.t === 'g') { seen.add(it.id); items.push({ t: 'g', id: it.id, name: it.name }); continue; }
    if (!known.has(it.id)) continue;
    seen.add(it.id);
    items.push({ t: 'e', id: it.id, g: groupIds.has(it.g) ? it.g : null });
  }
  for (const e of candidates) if (!seen.has(e.id)) items.push({ t: 'e', id: e.id, g: null });

  const byGroup = new Map();
  for (const it of items) {
    if (it.t !== 'e' || !it.g) continue;
    if (!byGroup.has(it.g)) byGroup.set(it.g, []);
    byGroup.get(it.g).push(it);
  }
  const out = [];
  for (const it of items) {
    if (it.t === 'g') { out.push(it); out.push(...(byGroup.get(it.id) || [])); continue; }
    if (!it.g) out.push(it);
  }
  return out;
}
// Lignes d'une rubrique, dans l'ordre.
function getHeuresGroupMembers(list, groupId) {
  return list.filter(i => i.t === 'e' && i.g === groupId);
}
function saveHeuresLayout(list) {
  state.heuresLayout = list;
  save();
}
function addHeuresGroup() {
  const list = getHeuresLayout();
  const n = list.filter(i => i.t === 'g').length + 1;
  const id = 'hg_' + uid();
  // En tête du tableau : la rubrique est visible tout de suite, et naît vide
  // — l'appartenance étant explicite, rien ne la rejoint sans un dépôt.
  list.unshift({ t: 'g', id, name: 'Rubrique ' + n });
  saveHeuresLayout(list);
  renderHeures();
  requestAnimationFrame(() => {
    const inp = document.querySelector('.heures-group-name[data-group-id="' + cssEscape(id) + '"]');
    if (inp) { inp.focus(); inp.select(); }
  });
}
function renameHeuresGroup(id, name) {
  const g = getHeuresLayoutRaw().find(i => i.t === 'g' && i.id === id);
  if (!g) return;
  g.name = String(name || '');
  save();
  // Pas de re-rendu : l'utilisateur tape, on ne casse pas le focus.
}
// Supprimer une rubrique ne supprime pas ses lignes : elles redeviennent
// libres, là où elles étaient.
function removeHeuresGroup(id) {
  const list = getHeuresLayout().filter(i => !(i.t === 'g' && i.id === id));
  for (const it of list) if (it.t === 'e' && it.g === id) it.g = null;
  saveHeuresLayout(list);
  renderHeures();
  showToast('Rubrique supprimée — ses lignes restent en place');
}
// Déplace un élément (ligne ou rubrique) avant ou après une cible. Déplacer
// une rubrique emporte ses lignes : sans cela, réordonner les rubriques
// disloquerait l'affichage. Une ligne déposée hérite de la rubrique de la
// ligne au-dessus d'elle — déposée juste sous un en-tête, elle y entre ;
// déposée au-dessus, elle en sort.
function moveHeuresItem(dragId, targetId, after) {
  if (dragId === targetId) return;
  const list = getHeuresLayout();
  const from = list.findIndex(i => i.id === dragId);
  if (from < 0) return;
  const dragged = list[from];
  const block = dragged.t === 'g'
    ? [dragged, ...getHeuresGroupMembers(list, dragged.id)]
    : [dragged];
  if (block.some(i => i.id === targetId)) return;   // dépôt à l'intérieur de soi

  const rest = list.filter(i => !block.includes(i));
  let at = rest.findIndex(i => i.id === targetId);
  if (at < 0) at = rest.length;
  else if (after) at += 1;
  if (dragged.t === 'e') {
    const prev = rest[at - 1];
    dragged.g = !prev ? null : (prev.t === 'g' ? prev.id : (prev.g || null));
  }
  rest.splice(at, 0, ...block);
  saveHeuresLayout(rest);
  renderHeures();
}

// Glisser-déposer des lignes du tableau. La poignée seule arme le glissé :
// la ligne porte des champs de saisie, la rendre draggable en permanence
// empêcherait de sélectionner du texte dedans.
let _heuresDrag = null;
function heuresAttachDrag(tr, id) {
  tr.dataset.layoutId = id;
  tr.addEventListener('dragstart', (e) => {
    _heuresDrag = { id };
    tr.classList.add('is-dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }
  });
  tr.addEventListener('dragend', () => {
    tr.classList.remove('is-dragging');
    tr.draggable = false;
    heuresClearDropMarks();
    _heuresDrag = null;
  });
  tr.addEventListener('dragover', (e) => {
    if (!_heuresDrag || _heuresDrag.id === id) return;
    e.preventDefault();
    const r = tr.getBoundingClientRect();
    const after = (e.clientY - r.top) > r.height / 2;
    heuresClearDropMarks();
    tr.classList.add(after ? 'is-drop-after' : 'is-drop-before');
  });
  tr.addEventListener('drop', (e) => {
    if (!_heuresDrag) return;
    e.preventDefault();
    const r = tr.getBoundingClientRect();
    const after = (e.clientY - r.top) > r.height / 2;
    const dragId = _heuresDrag.id;
    heuresClearDropMarks();
    _heuresDrag = null;
    moveHeuresItem(dragId, id, after);
  });
}
function heuresClearDropMarks() {
  document.querySelectorAll('.heures-table tr.is-drop-before, .heures-table tr.is-drop-after')
    .forEach(el => el.classList.remove('is-drop-before', 'is-drop-after'));
}
// Au doigt, le glissé natif HTML5 n'existe pas : on suit le pointeur nous-mêmes
// et on lit la ligne sous le doigt. Même repères visuels, même dépôt.
function heuresTouchDrag(startEvt, tr, id) {
  const table = tr.closest('.heures-table');
  if (!table) return;
  let target = null, after = false, moved = false;
  const onMove = (e) => {
    e.preventDefault();
    if (!moved) { moved = true; tr.classList.add('is-dragging'); }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el && el.closest('tr[data-layout-id]');
    heuresClearDropMarks();
    if (!row || row === tr || !table.contains(row)) { target = null; return; }
    const r = row.getBoundingClientRect();
    after = (e.clientY - r.top) > r.height / 2;
    target = row.dataset.layoutId;
    row.classList.add(after ? 'is-drop-after' : 'is-drop-before');
  };
  const onEnd = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);
    tr.classList.remove('is-dragging');
    heuresClearDropMarks();
    if (target) moveHeuresItem(id, target, after);
  };
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onEnd);
  document.addEventListener('pointercancel', onEnd);
  startEvt.preventDefault();
}
// Poignée : n'arme le glissé qu'au moment où on l'attrape, et propose les
// flèches au clavier — le glissé natif n'existe pas au doigt.
function buildHeuresHandle(tr, id, label) {
  const h = dbEl('button', 'heures-handle');
  h.type = 'button';
  h.title = label + ' — glissez pour déplacer, ou utilisez ↑ ↓ au clavier';
  h.setAttribute('aria-label', 'Déplacer ' + label);
  h.textContent = '⠿';
  h.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') { heuresTouchDrag(e, tr, id); return; }
    tr.draggable = true;
  });
  h.addEventListener('pointerup', () => { tr.draggable = false; });
  h.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    moveHeuresItemBy(id, e.key === 'ArrowUp' ? -1 : 1);
    requestAnimationFrame(() => {
      const again = document.querySelector('.heures-handle[data-layout-id="' + cssEscape(id) + '"]');
      if (again) again.focus();
    });
  });
  h.dataset.layoutId = id;
  return h;
}
// Déplacement au clavier : d'un cran, en sautant le bloc d'une rubrique.
function moveHeuresItemBy(id, delta) {
  const list = getHeuresLayout();
  const from = list.findIndex(i => i.id === id);
  if (from < 0) return;
  const item = list[from];
  const size = item.t === 'g' ? 1 + getHeuresGroupMembers(list, item.id).length : 1;
  const target = delta < 0 ? from - 1 : from + size;
  if (target < 0 || target >= list.length) return;
  moveHeuresItem(id, list[target].id, delta > 0);
}

// Ligne de rubrique : un bandeau contrasté qui totalise les lignes qu'elle
// contient. Les colonnes additives (heures, écarts) se somment ; les autres
// (unité, quantités, ratios) ne le peuvent que si toutes les lignes partagent
// la même unité — sinon on additionnerait des mètres carrés et des mètres
// linéaires, et l'on affiche « — » plutôt qu'un chiffre faux.
function buildHeuresGroupRow(group, members, model, prevEcarts) {
  const tr = document.createElement('tr');
  tr.className = 'heures-group';
  tr.setAttribute('data-group-row', group.id);
  heuresAttachDrag(tr, group.id);

  const agg = { budget: 0, droit: 0, sap: 0, corr: 0, puma: 0, pumaEcart: 0, ecart: 0,
                radHeures: 0, fdc: 0, ecartFdc: 0, ecartFdcCorrige: 0, radCorrige: 0,
                qteTotal: 0, qteReal: 0 };
  const units = new Set();
  let fdcManquants = 0;
  // Écart de la semaine : somme des lignes qui existaient déjà la semaine
  // d'avant. `ecartSemConnu` reste faux si aucune ne se compare.
  let ecartSem = 0, ecartSemConnu = false;
  for (const e of members) {
    const { row } = resolveHeuresRow(e, model);
    const comp = computeHeuresRow(row);
    agg.budget          += Number(row.budgetHeures) || 0;
    agg.sap             += Number(row.sap) || 0;
    agg.corr            += Number(row.correction) || 0;
    agg.puma            += Number(row.pumaCumule) || 0;
    agg.ecartFdcCorrige += comp.ecartFdcCorrige;
    agg.droit           += comp.droit;
    agg.pumaEcart       += comp.pumaEcart;
    agg.radCorrige      += comp.radCorrige;
    agg.ecart           += comp.ecart;
    if (comp.fdcAuto == null) fdcManquants++;
    else { agg.fdc += comp.fdcAuto; agg.radHeures += comp.radHeures; agg.ecartFdc += comp.ecartFdc; }
    agg.qteTotal += Number(row.qteTotal) || 0;
    agg.qteReal  += Number(row.qteRealisee) || 0;
    if (prevEcarts && prevEcarts.has(e.id)) { ecartSem += comp.ecart - prevEcarts.get(e.id); ecartSemConnu = true; }
    if (row.unite) units.add(row.unite);
  }
  // Unité, quantités et ratios ne se totalisent que si toutes les lignes
  // partagent la même unité — sinon on additionnerait des m² et des ml.
  const sameUnit = units.size === 1 ? [...units][0] : null;
  const avancement = agg.budget > 0 ? agg.droit / agg.budget : null;
  const ratio = sameUnit && agg.qteTotal > 0 ? agg.budget / agg.qteTotal : null;
  const ratioActuel = sameUnit && agg.qteReal > 0 ? agg.pumaEcart / agg.qteReal : null;
  const partiel = fdcManquants > 0 ? ' *' : '';

  const values = {
    budgetHeures:    fmtHeures(agg.budget) + ' h',
    unite:           sameUnit || '—',
    ratio:           ratio != null ? fmtHeures(ratio) : '—',
    qteTotal:        sameUnit ? fmtHeures(agg.qteTotal) : '—',
    qteRealisee:     sameUnit ? fmtHeures(agg.qteReal) : '—',
    avancement:      avancement != null ? Math.round(avancement * 100) + ' %' : '—',
    droit:           fmtHeures(agg.droit) + ' h',
    sap:             fmtHeures(agg.sap) + ' h',
    correction:      fmtHeures(agg.corr) + ' h',
    pumaCumule:      fmtHeures(agg.puma) + ' h',
    pumaEcart:       fmtHeures(agg.pumaEcart) + ' h',
    ecart:           fmtHeures(agg.ecart) + ' h',
    ratioActuel:     ratioActuel != null ? fmtHeures(ratioActuel) : '—',
    radHeures:       fmtHeures(agg.radHeures) + ' h' + partiel,
    fdcAuto:         fmtHeures(agg.fdc) + ' h' + partiel,
    ecartFdc:        fmtHeures(agg.ecartFdc) + ' h' + partiel,
    ecartFdcCorrige: fmtHeures(agg.ecartFdcCorrige) + ' h',
    radCorrige:      fmtHeures(agg.radCorrige) + ' h',
    ecartSem:        ecartSemConnu ? fmtHeures(ecartSem) + ' h' : '—'
  };

  const th = document.createElement('th');
  th.scope = 'row';
  th.className = 'heures-cell-label heures-group-label';
  const bar = dbEl('div', 'heures-group-bar');
  bar.appendChild(buildHeuresHandle(tr, group.id, group.name || 'cette rubrique'));
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'heures-group-name';
  inp.dataset.groupId = group.id;
  inp.value = group.name || '';
  inp.maxLength = 40;
  inp.placeholder = 'Nom de la rubrique';
  inp.setAttribute('aria-label', 'Nom de la rubrique');
  inp.addEventListener('input', () => renameHeuresGroup(group.id, inp.value));
  bar.appendChild(inp);
  if (members.length) {
    const count = dbEl('span', 'heures-group-count', String(members.length));
    count.title = members.length + (members.length > 1 ? ' lignes' : ' ligne') + ' dans cette rubrique';
    bar.appendChild(count);
  }
  const del = dbEl('button', 'heures-group-del', '×');
  del.type = 'button';
  del.title = 'Supprimer la rubrique (les lignes restent)';
  del.setAttribute('aria-label', 'Supprimer la rubrique');
  del.addEventListener('click', () => removeHeuresGroup(group.id));
  bar.appendChild(del);
  th.appendChild(bar);
  tr.appendChild(th);

  // Rubrique vide : plutôt qu'une rangée de tirets, une invite qui dit le geste.
  if (!members.length) {
    const hint = document.createElement('td');
    hint.className = 'heures-group-hint';
    hint.colSpan = getHeuresVisibleCells().length;
    hint.textContent = 'Faites glisser une ligne juste en dessous pour la ranger ici';
    tr.appendChild(hint);
    return tr;
  }

  for (const cell of getHeuresVisibleCells()) {
    if (cell.t === 'fold') { tr.appendChild(buildHeuresFoldCell(cell.run)); continue; }
    const col = cell.col;
    const td = document.createElement('td');
    td.className = 'heures-col-' + col.key + (cell.start ? ' is-cat-start' : '');
    // `?? '—'` plutôt que la valeur brute : une colonne ajoutée à
    // HEURES_COLUMNS sans être ajoutée ici se voit comme un tiret, pas comme
    // le mot « undefined » au milieu d'un bandeau de totaux.
    td.textContent = values[col.key] ?? '—';
    if (HEURES_SIGNED_COLUMNS.has(col.key)) {
      const v = col.key === 'ecart' ? agg.ecart : (col.key === 'ecartSem' ? ecartSem : agg.ecartFdc);
      td.classList.toggle('is-positive', v >= 0);
      td.classList.toggle('is-negative', v < 0);
    }
    if (fdcManquants > 0 && (col.key === 'radHeures' || col.key === 'fdcAuto' || col.key === 'ecartFdc')) {
      td.classList.add('is-partial');
      td.title = 'Total sur ' + (members.length - fdcManquants) + ' lignes sur ' + members.length
        + ' : le reste est sans quantité totale, donc non projetable.';
    }
    tr.appendChild(td);
  }
  return tr;
}

// THEAD à deux rangées : bandeaux de catégories repliables, puis colonnes.
function buildHeuresHead(cells, qteSaisissable, verrouillee) {
  const thead = document.createElement('thead');
  const trCat = dbEl('tr', 'heures-cats');
  const trCol = dbEl('tr', 'heures-cols');
  const collapsed = getHeuresCollapsedCats();

  // Colonne Tâches : un seul th, à cheval sur les deux rangées.
  const thT = document.createElement('th');
  thT.scope = 'col';
  thT.rowSpan = 2;
  thT.className = 'heures-col-taches';
  thT.textContent = HEURES_COLUMNS[0].label;
  trCat.appendChild(thT);

  for (const run of getHeuresCatRuns()) {
    const folded = collapsed.has(run.key);
    const thc = document.createElement('th');
    thc.scope = 'colgroup';
    thc.className = 'heures-cat heures-cat-' + run.key + (folded ? ' is-folded' : '');
    thc.colSpan = folded ? 1 : run.cols.length;
    const btn = dbEl('button', 'heures-cat-toggle');
    btn.type = 'button';
    btn.dataset.cat = run.key;
    btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
    const liste = run.cols.map(c => c.label).join(', ');
    btn.title = (folded ? 'Déplier « ' : 'Replier « ') + run.label + ' » (' + liste + ')'
      + (run.key === 'sap' ? ' — SAP au ' + getHeuresSapDate() : '');
    btn.setAttribute('aria-label', btn.title);
    btn.appendChild(dbEl('span', 'heures-cat-label', folded ? run.abbr : run.label));
    btn.appendChild(dbEl('span', 'heures-cat-chevron', folded ? '›' : '⌄'));
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleHeuresCat(run.key); });
    thc.appendChild(btn);
    trCat.appendChild(thc);

    if (folded) {
      const th = buildHeuresFoldCell(run, 'th');
      th.scope = 'col';
      th.appendChild(dbEl('span', 'heures-fold-abbr', run.abbr));
      trCol.appendChild(th);
      continue;
    }
    run.cols.forEach((col, i) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.className = 'heures-col-' + col.key + (col.kind === 'calc' ? ' is-calc' : '')
        + (i === 0 ? ' is-cat-start' : '');
      if (col.title) th.title = col.title;
      // Contraste « à saisir » : jamais sur une semaine close, où plus rien
      // ne se saisit, et jamais sur Qté réalisée si tout vient des ouvrages.
      if (HEURES_SAISIE_COLUMNS.has(col.key) && !verrouillee
          && (col.key !== 'qteRealisee' || qteSaisissable)) th.classList.add('is-saisie-head');
      if (col.key === 'sap') {
        // En-tête « SAP (date) » dont le texte entre parenthèses est éditable.
        th.appendChild(document.createTextNode(col.label + ' ('));
        const dateInput = document.createElement('input');
        dateInput.type = 'text';
        dateInput.className = 'heures-sap-date';
        dateInput.value = getHeuresSapDate();
        dateInput.maxLength = 12;
        dateInput.disabled = !!verrouillee;
        dateInput.setAttribute('aria-label', 'Date de référence SAP');
        dateInput.addEventListener('input', () => setHeuresSapDate(dateInput.value));
        th.appendChild(dateInput);
        th.appendChild(document.createTextNode(')'));
      } else {
        th.textContent = col.label;
      }
      trCol.appendChild(th);
    });
  }
  thead.appendChild(trCat);
  thead.appendChild(trCol);
  return thead;
}

function renderHeuresTable() {
  const wrap = document.getElementById('heurestablewrap');
  if (!wrap) return;
  const sx = wrap.scrollLeft;            // replier ne doit pas nous ramener à gauche
  wrap.innerHTML = '';

  const semaine = getHeuresActiveWeek();
  const verrouillee = isHeuresWeekLocked(semaine);
  const prevEcarts = getHeuresPrevEcarts();
  const candidates = getHeuresCandidates();
  const selected = candidates.filter(e => getHeuresRow(e.id).selected);

  if (selected.length === 0) {
    const p = document.createElement('p');
    p.className = 'heures-empty';
    p.textContent = candidates.length === 0
      ? 'Aucune ligne de budget en heures. Dans Données → eOTP, basculez une ligne sur « h » pour la suivre ici.'
      : 'Choisissez au moins une ligne dans « eOTP suivis » pour l\'ajouter au tableau.';
    wrap.appendChild(p);
    return;
  }

  const model = getHeuresAvancementModel();
  const table = document.createElement('table');
  table.className = 'heures-table';

  // THEAD : bandeaux de catégories puis intitulés de colonnes. Le colgroup
  // porte les largeurs — avec table-layout:fixed, sans lui, elles seraient
  // prises sur la première rangée (celle des catégories, à colSpan) et
  // réparties à parts égales.
  const cells = getHeuresVisibleCells();
  // Teinte « à saisir » sur l'en-tête Qté réalisée : seulement si au moins une
  // ligne affichée est encore saisissable. Les lignes rattachées à un ouvrage
  // sont en lecture seule — y annoncer « à saisir » serait faux.
  const qteSaisissable = selected.some(e => !resolveHeuresRow(e, model).link);
  table.appendChild(buildHeuresColgroup(cells));
  table.style.minWidth = heuresMinWidth(cells) + 'px';
  table.appendChild(buildHeuresHead(cells, qteSaisissable, verrouillee));

  // TBODY — l'ordre et les rubriques viennent de state.heuresLayout. Les
  // lignes non cochées pour la semaine active sont masquées, mais gardent
  // leur place : recocher une ligne la remet où elle était.
  const tbody = document.createElement('tbody');
  const selIds = new Set(selected.map(e => e.id));
  const byId = new Map(candidates.map(e => [e.id, e]));
  const layout = getHeuresLayout();
  // Une rubrique et ses lignes forment un bloc encadré : l'en-tête ouvre le
  // cadre, la dernière ligne visible le referme. `lastOfGroup` retient donc
  // quelle ligne porte le trait de fermeture — la dernière *cochée*, pas la
  // dernière de la disposition.
  const lastOfGroup = new Set();
  for (const it of layout) {
    if (it.t !== 'g') continue;
    const vis = getHeuresGroupMembers(layout, it.id).filter(m => selIds.has(m.id));
    if (vis.length) lastOfGroup.add(vis[vis.length - 1].id);
  }
  for (const it of layout) {
    if (it.t === 'g') {
      // Membres visibles de la rubrique, pour la semaine active.
      const members = getHeuresGroupMembers(layout, it.id)
        .filter(m => selIds.has(m.id)).map(m => byId.get(m.id));
      tbody.appendChild(buildHeuresGroupRow(it, members, model, prevEcarts));
      continue;
    }
    if (!selIds.has(it.id)) continue;
    tbody.appendChild(buildHeuresRow(byId.get(it.id), model, it.g, lastOfGroup.has(it.id),
                                     { verrouillee, prevEcarts, cells }));
  }
  table.appendChild(tbody);

  // TFOOT (totaux)
  table.appendChild(buildHeuresFoot(selected, prevEcarts));

  wrap.appendChild(table);
  wrap.scrollLeft = sx;
  // La 2e rangée du THEAD colle SOUS la 1re : son `top` vaut la hauteur réelle
  // de la rangée de catégories, qui dépend de la police et du zoom.
  requestAnimationFrame(() => {
    const r0 = table.tHead && table.tHead.rows[0];
    if (r0) table.style.setProperty('--heures-cat-h', Math.round(r0.getBoundingClientRect().height) + 'px');
  });
  // Une bande repliée se déplie d'un clic n'importe où dans sa colonne.
  table.addEventListener('click', (e) => {
    const f = e.target.closest('.heures-fold');
    if (f && f.dataset.cat) toggleHeuresCat(f.dataset.cat);
  });
}

function buildHeuresRow(eotp, model, groupId, lastOfGroup, opts) {
  const o = opts || {};
  const verrouillee = o.verrouillee != null ? o.verrouillee : isHeuresWeekLocked(getHeuresActiveWeek());
  const prevEcarts = o.prevEcarts !== undefined ? o.prevEcarts : getHeuresPrevEcarts();
  const cells = o.cells || getHeuresVisibleCells();
  const { row, link, orphan, setup } = resolveHeuresRow(eotp, model || getHeuresAvancementModel());
  const tr = document.createElement('tr');
  tr.setAttribute('data-heures-id', eotp.id);
  if (link) tr.classList.add('is-linked');
  if (groupId) {
    tr.classList.add('is-grouped');
    tr.dataset.groupId = groupId;
    if (lastOfGroup) tr.classList.add('is-last-of-group');
  }

  heuresAttachDrag(tr, eotp.id);
  {
      const col = HEURES_COLUMNS[0];
      const th = document.createElement('th');
      th.scope = 'row';
      th.className = 'heures-cell-label';
      th.appendChild(buildHeuresHandle(tr, eotp.id, eotpDisplay(eotp) || 'cette ligne'));
      th.appendChild(dbEl('span', 'heures-label-text', eotpDisplay(eotp) || '(sans code)'));
      if (link) {
        const tag = dbEl('span', 'heures-link-tag', '⇄ ' + link.name);
        tag.title = 'Quantités et avancement repris de l\'ouvrage « ' + link.name
          + ' » (Avancement). Modifiable dans Données → eOTP.';
        th.appendChild(tag);
      } else if (orphan) {
        const tag = dbEl('span', 'heures-link-tag is-orphan',
          '⚠ ' + (setup ? 'ouvrage non affecté' : 'ouvrage supprimé'));
        tag.title = setup
          ? 'L\'ouvrage « ' + (setup.name || '') + ' » n\'est affecté à aucune zone : rien à reprendre. '
            + 'Affectez-le dans Données → Zones, ou repassez la ligne en saisie manuelle.'
          : 'L\'ouvrage rattaché a été supprimé de Données → Tâches. La ligne est repassée en saisie manuelle.';
        th.appendChild(tag);
      }
      tr.appendChild(th);
  }
  for (const cell of cells) {
    if (cell.t === 'fold') { tr.appendChild(buildHeuresFoldCell(cell.run)); continue; }
    const col = cell.col;
    const td = document.createElement('td');
    td.className = 'heures-col-' + col.key + (cell.start ? ' is-cat-start' : '');
    // Champ alimenté par l'ouvrage rattaché : lecture seule, comme une
    // colonne calculée — la donnée vient de la saisie d'avancement.
    if (link && HEURES_AUTO_FIELDS.has(col.key)) {
      td.classList.add('is-calc', 'is-auto');
      td.textContent = col.key === 'unite' ? (row.unite || '—') : fmtHeures(row[col.key]);
      td.title = 'Repris de l\'ouvrage « ' + link.name + ' »';
      tr.appendChild(td);
      continue;
    }
    if (col.kind === 'calc') {
      td.classList.add('is-calc', 'heures-calc-' + col.key);
      // Le texte est posé par refreshHeuresComputed juste après.
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'heures-input';
      input.setAttribute('data-field', col.key);
      input.disabled = verrouillee;
      if (col.kind === 'num') {
        input.inputMode = 'decimal';
        input.value = fmtHeuresInput(row[col.key]);
        input.placeholder = '0';
      } else { // text
        input.value = row.unite || '';
        input.placeholder = 'm², ml…';
        input.maxLength = 8;
      }
      input.addEventListener('input', () => setHeuresField(eotp.id, col.key, input.value));
      td.appendChild(input);
      // Contraste « à saisir » : posé sur la cellule uniquement là où un champ
      // est réellement modifiable — jamais sur une valeur reprise d'un ouvrage
      // ni sur une semaine close, où il mentirait.
      if (HEURES_SAISIE_COLUMNS.has(col.key) && !verrouillee) td.classList.add('is-saisie');
    }
    tr.appendChild(td);
  }
  // Pose les valeurs calculées initiales
  applyHeuresComputedToRow(tr, row, prevEcarts, eotp.id);
  return tr;
}

// Met à jour les cellules calculées d'une ligne (et colore les écarts).
function applyHeuresComputedToRow(tr, row, prevEcarts, eotpId) {
  const comp = withHeuresEcartSem(computeHeuresRow(row),
    eotpId || tr.getAttribute('data-heures-id'),
    prevEcarts !== undefined ? prevEcarts : getHeuresPrevEcarts());
  for (const col of HEURES_COLUMNS) {
    if (col.kind !== 'calc') continue;
    const td = tr.querySelector('.heures-calc-' + col.key);
    if (!td) continue;
    td.textContent = heuresCalcText(col.key, comp);
    if (HEURES_SIGNED_COLUMNS.has(col.key)) {
      const v = comp[col.key];
      td.classList.toggle('is-positive', v != null && v >= 0);
      td.classList.toggle('is-negative', v != null && v < 0);
    }
    // Projection faite au ratio théorique faute de quantité réalisée : on le
    // dit, sinon le chiffre semble sorti d'un « Ratio actuel » affiché « — ».
    if (col.key === 'radHeures' || col.key === 'fdcAuto' || col.key === 'ecartFdc') {
      td.classList.toggle('is-estimated', !!comp.estimeAuTheorique);
      if (comp.estimeAuTheorique) {
        td.title = 'Estimé au ratio théorique : aucune quantité réalisée sur cette ligne.';
      } else {
        td.removeAttribute('title');
      }
    }
  }
}

// Re-rendu ciblé après saisie : recalcule la ligne concernée + le pied,
// sans toucher aux inputs (préserve le focus).
function refreshHeuresComputed(eotpId) {
  const prevEcarts = getHeuresPrevEcarts();
  const tr = document.querySelector('tr[data-heures-id="' + cssEscape(eotpId) + '"]');
  if (tr) applyHeuresComputedToRow(tr, getHeuresRow(eotpId), prevEcarts, eotpId);
  const model = getHeuresAvancementModel();
  const selected = getHeuresCandidates().filter(e => getHeuresRow(e.id).selected);
  for (const e of selected) resolveHeuresRow(e, model);
  const tfoot = document.querySelector('.heures-table tfoot');
  if (tfoot) {
    const fresh = buildHeuresFoot(selected, prevEcarts);
    tfoot.replaceWith(fresh);
  }
  refreshHeuresGroupRows(model, selected, prevEcarts);
}

// Les rubriques totalisent leurs lignes : une saisie dans une ligne change
// leur bandeau. On les reconstruit sur place, sans re-rendre le tableau —
// le champ en cours de saisie garde le focus.
function refreshHeuresGroupRows(model, selected, prevEcarts) {
  const rows = document.querySelectorAll('.heures-table tr.heures-group');
  if (!rows.length) return;
  const active = document.activeElement;
  const selIds = new Set(selected.map(e => e.id));
  const byId = new Map(getHeuresCandidates().map(e => [e.id, e]));
  const layout = getHeuresLayout();
  for (const tr of rows) {
    const gid = tr.getAttribute('data-group-row');
    const group = layout.find(it => it.t === 'g' && it.id === gid);
    if (!group) continue;
    // Une rubrique dont on édite le nom ne doit pas être remplacée sous les
    // doigts de l'utilisateur : seules ses cellules chiffrées sont refaites.
    const editing = active && tr.contains(active);
    const members = getHeuresGroupMembers(layout, gid)
      .filter(m => selIds.has(m.id)).map(m => byId.get(m.id));
    const fresh = buildHeuresGroupRow(group, members, model, prevEcarts);
    if (!editing) { tr.replaceWith(fresh); continue; }
    for (const col of HEURES_COLUMNS) {
      if (col.kind === 'label') continue;
      const from = fresh.querySelector('.heures-col-' + col.key);
      const to = tr.querySelector('.heures-col-' + col.key);
      if (!from || !to) continue;
      to.textContent = from.textContent;
      to.className = from.className;
    }
  }
}

// Petit échappement pour les sélecteurs d'attribut (les eotpId sont de la
// forme eotp_xxx mais on reste prudent).
function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

function buildHeuresFoot(selected, prevEcarts) {
  const tfoot = document.createElement('tfoot');
  const tr = document.createElement('tr');

  // Sommes des colonnes additives. `fdcManquants` compte les lignes qu'on n'a
  // pas su projeter : les taire ferait passer un total partiel pour un total.
  const sum = { budget: 0, droit: 0, sap: 0, corr: 0, puma: 0, pumaEcart: 0,
                radHeures: 0, fdc: 0, ecartFdc: 0, ecartFdcCorrige: 0, radCorrige: 0, ecart: 0 };
  let fdcManquants = 0;
  for (const e of selected) {
    const row = getHeuresRow(e.id);
    const comp = computeHeuresRow(row);
    sum.budget          += Number(row.budgetHeures) || 0;
    sum.sap             += Number(row.sap) || 0;
    sum.corr            += Number(row.correction) || 0;
    sum.puma            += Number(row.pumaCumule) || 0;
    sum.ecartFdcCorrige += comp.ecartFdcCorrige;
    sum.droit           += comp.droit;
    sum.pumaEcart       += comp.pumaEcart;
    sum.radCorrige      += comp.radCorrige;
    sum.ecart           += comp.ecart;
    if (comp.fdcAuto == null) fdcManquants++;
    else { sum.fdc += comp.fdcAuto; sum.radHeures += comp.radHeures; sum.ecartFdc += comp.ecartFdc; }
  }
  // Avancement global pondéré par les budgets : Σ droit / Σ budget
  const globalAvancement = sum.budget > 0 ? sum.droit / sum.budget : null;
  const partiel = fdcManquants > 0 ? ' *' : '';
  let ecartSemTotal = null;
  if (prevEcarts && prevEcarts.size) {
    let prevTotal = 0;
    for (const v of prevEcarts.values()) prevTotal += v;
    ecartSemTotal = sum.ecart - prevTotal;
  }

  const footValues = {
    taches:          'Total',
    budgetHeures:    fmtHeures(sum.budget) + ' h',
    unite:           '—',
    ratio:           '—',
    qteTotal:        '—',
    qteRealisee:     '—',
    avancement:      globalAvancement != null ? Math.round(globalAvancement * 100) + ' %' : '—',
    droit:           fmtHeures(sum.droit) + ' h',
    sap:             fmtHeures(sum.sap) + ' h',
    correction:      fmtHeures(sum.corr) + ' h',
    pumaCumule:      fmtHeures(sum.puma) + ' h',
    pumaEcart:       fmtHeures(sum.pumaEcart) + ' h',
    ecart:           fmtHeures(sum.ecart) + ' h',
    ratioActuel:     '—',
    radHeures:       fmtHeures(sum.radHeures) + ' h' + partiel,
    fdcAuto:         fmtHeures(sum.fdc) + ' h' + partiel,
    ecartFdc:        fmtHeures(sum.ecartFdc) + ' h' + partiel,
    ecartFdcCorrige: fmtHeures(sum.ecartFdcCorrige) + ' h',
    radCorrige:      fmtHeures(sum.radCorrige) + ' h',
    // Total de l'écart de la semaine : la DIFFÉRENCE DES TOTAUX, pas la somme
    // des différences de lignes. Sinon une ligne ajoutée au suivi cette
    // semaine sortirait du compte et le total afficherait un mouvement nul
    // pendant que le solde glisse.
    ecartSem:        ecartSemTotal != null ? fmtHeures(ecartSemTotal) + ' h' : '—'
  };
  const partielTitre = fdcManquants > 0
    ? 'Total sur ' + (selected.length - fdcManquants) + ' lignes sur ' + selected.length
      + ' : ' + fdcManquants + (fdcManquants > 1 ? ' lignes sont' : ' ligne est')
      + ' sans quantité totale, donc non projetable.'
    : '';

  // Cellule « Total », toujours émise en premier.
  const thTot = document.createElement('th');
  thTot.scope = 'row';
  thTot.className = 'heures-col-taches';
  thTot.textContent = footValues.taches;
  tr.appendChild(thTot);
  for (const cell2 of getHeuresVisibleCells()) {
    if (cell2.t === 'fold') { tr.appendChild(buildHeuresFoldCell(cell2.run)); continue; }
    const col = cell2.col;
    const cell = document.createElement('td');
    cell.className = 'heures-col-' + col.key + (cell2.start ? ' is-cat-start' : '');
    cell.textContent = footValues[col.key] ?? '—';
    if (HEURES_SIGNED_COLUMNS.has(col.key)) {
      const v = col.key === 'ecart' ? sum.ecart
              : (col.key === 'ecartSem' ? ecartSemTotal : sum.ecartFdc);
      cell.classList.toggle('is-positive', v != null && v >= 0);
      cell.classList.toggle('is-negative', v != null && v < 0);
    }
    if (partielTitre && (col.key === 'radHeures' || col.key === 'fdcAuto' || col.key === 'ecartFdc')) {
      cell.title = partielTitre;
      cell.classList.add('is-partial');
    }
    tr.appendChild(cell);
  }
  tfoot.appendChild(tr);
  return tfoot;
}


// ====================================================================
//   Export PDF du suivi des heures — A4 PAYSAGE
//   Le tableau porte vingt colonnes : en portrait il faudrait le couper
//   en deux, et le document perdrait ce qui fait sa valeur — lire l'écart
//   d'une ligne d'un bout à l'autre. Tout est dessiné en jsPDF pur
//   (rect / line / triangle / text), sans bibliothèque de graphiques.
// ====================================================================

// Données du rapport. LECTURE SEULE : rien n'est écrit dans l'état, et la
// semaine précédente est lue sans passer par getHeuresRow, qui la réécrirait.
function buildHeuresReportData() {
  const week = getHeuresActiveWeek();
  const weeks = getHeuresWeeks();
  const prevWeek = getHeuresPrevWeek(week);
  const prevEcarts = getHeuresPrevEcarts();
  const model = getHeuresAvancementModel();
  const selected = getHeuresCandidates().filter(e => getHeuresRow(e.id).selected);

  const lignes = [];
  for (const e of selected) {
    const { row, link } = resolveHeuresRow(e, model);
    const comp = withHeuresEcartSem(computeHeuresRow(row), e.id, prevEcarts);
    lignes.push({ id: e.id, nom: eotpDisplay(e) || '(sans code)', lien: link ? link.name : '', row, comp });
  }

  // Totaux : mêmes règles que le pied du tableau, y compris la différence
  // des totaux pour l'écart de la semaine.
  const t = { budget: 0, droit: 0, sap: 0, corr: 0, puma: 0, pumaEcart: 0, ecart: 0,
              radHeures: 0, fdc: 0, ecartFdc: 0, ecartFdcCorrige: 0, radCorrige: 0 };
  let fdcManquants = 0, ss1Manquants = 0;
  for (const l of lignes) {
    t.budget += l.comp.budget; t.droit += l.comp.droit;
    t.sap += Number(l.row.sap) || 0; t.corr += Number(l.row.correction) || 0;
    t.puma += Number(l.row.pumaCumule) || 0;
    t.pumaEcart += l.comp.pumaEcart; t.ecart += l.comp.ecart;
    t.ecartFdcCorrige += l.comp.ecartFdcCorrige; t.radCorrige += l.comp.radCorrige;
    if (l.comp.fdcAuto == null) fdcManquants++;
    else { t.fdc += l.comp.fdcAuto; t.radHeures += l.comp.radHeures; t.ecartFdc += l.comp.ecartFdc; }
    if (l.comp.ecartSem == null) ss1Manquants++;
  }
  t.avancement = t.budget > 0 ? t.droit / t.budget : null;
  let ss1Total = null;
  if (prevEcarts && prevEcarts.size) {
    let p = 0;
    for (const v of prevEcarts.values()) p += v;
    ss1Total = t.ecart - p;
  }

  // Avancement par bâtiment. Sur un chantier suivi uniquement par les heures,
  // aucune zone ne porte d'ouvrage : le modèle d'avancement est alors vide et
  // ce bloc n'aurait rien à montrer. On se rabat sur les rubriques que le
  // conducteur a lui-même créées dans cet onglet — c'est SON regroupement.
  const av = computeAvancementModel('');
  let familles = [], familleSource = 'batiments';
  if (av.buildings.length && av.hBudget > 0) {
    familles = av.buildings.map(b => ({ nom: b.name, pct: b.pct, done: b.hDone, budget: b.hBudget,
                                        detail: b.zones + (b.zones > 1 ? ' zones' : ' zone') }));
  } else {
    familleSource = 'rubriques';
    const layout = getHeuresLayout();
    const parId = new Map(lignes.map(l => [l.id, l]));
    for (const it of layout) {
      if (it.t !== 'g') continue;
      const membres = getHeuresGroupMembers(layout, it.id).map(m => parId.get(m.id)).filter(Boolean);
      if (!membres.length) continue;
      let bud = 0, dr = 0;
      for (const m of membres) { bud += m.comp.budget; dr += m.comp.droit; }
      familles.push({ nom: it.name || 'Rubrique', pct: bud > 0 ? (dr / bud) * 100 : 0,
                      done: dr, budget: bud,
                      detail: membres.length + (membres.length > 1 ? ' lignes' : ' ligne') });
    }
    const libres = lignes.filter(l => !layout.some(i => i.t === 'e' && i.id === l.id && i.g));
    if (familles.length && libres.length) {
      let bud = 0, dr = 0;
      for (const m of libres) { bud += m.comp.budget; dr += m.comp.droit; }
      familles.push({ nom: 'Hors rubrique', pct: bud > 0 ? (dr / bud) * 100 : 0,
                      done: dr, budget: bud,
                      detail: libres.length + (libres.length > 1 ? ' lignes' : ' ligne') });
    }
  }

  return { week, weeks, prevWeek, lignes, totaux: t, ss1Total, ss1Manquants, fdcManquants,
           familles, familleSource, avModel: av, layout: getHeuresLayout(),
           verrouillee: isHeuresWeekLocked(week) };
}

// Colonnes du tableau détaillé, en millimètres. La somme fait exactement
// CONTENT_W (277 mm) en paysage — vérifié par assertion au premier export.
const HEURES_PDF_COLS = [
  { key: 'taches',          w: 42, al: 'left'  },
  { key: 'budgetHeures',    w: 13 }, { key: 'unite',        w: 7  },
  { key: 'ratio',           w: 10 }, { key: 'qteTotal',     w: 13 },
  { key: 'qteRealisee',     w: 13 }, { key: 'avancement',   w: 8  },
  { key: 'droit',           w: 13 }, { key: 'sap',          w: 13 },
  { key: 'correction',      w: 13 }, { key: 'pumaCumule',   w: 14 },
  { key: 'pumaEcart',       w: 14 }, { key: 'ecart',        w: 15 },
  { key: 'ratioActuel',     w: 9  }, { key: 'radHeures',    w: 12 },
  { key: 'fdcAuto',         w: 13 }, { key: 'ecartFdc',     w: 15 },
  { key: 'ecartFdcCorrige', w: 13 }, { key: 'radCorrige',   w: 12 },
  { key: 'ecartSem',        w: 15 }
];

async function exportHeuresToPDF() {
  const weeks = getHeuresWeeks();
  if (!weeks.length) { showToast('Aucune semaine à exporter', 'error'); return; }
  const R = buildHeuresReportData();
  if (!R.lignes.length) {
    showToast('Aucune ligne eOTP suivie : rien à exporter', 'error');
    return;
  }
  let jspdf;
  try {
    showToast('Génération du PDF…');
    jspdf = await loadJsPdf();
  } catch (e) {
    // jsPDF vient d'un CDN et le service worker ne met en cache que les
    // fichiers de l'application : il faut du réseau à CHAQUE session, pas
    // seulement à la première.
    showToast('Impossible de charger jsPDF — une connexion est nécessaire pour générer un PDF', 'error');
    return;
  }

  const pdf = hardenPdfText(new jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }));
  const PAGE_W = 297, PAGE_H = 210, MARGIN = 10;
  const CONTENT_W = PAGE_W - 2 * MARGIN;      // 277
  const ORANGE = [237, 108, 2], DARK = [38, 38, 38];
  const GREEN = [46, 125, 50], RED = [198, 40, 40], GREY = [120, 120, 120];
  const CARD = [250, 249, 247], LINE = [214, 214, 214], HEADBG = [236, 236, 236];
  let y = MARGIN, pageNum = 0;

  // --- petites aides -------------------------------------------------
  const H = (n, signe) => (signe && n > 0 ? '+' : '') + fmtHeures(n);
  const P = (n) => (n == null ? 'n/a' : formatPct(Math.round(n * 10) / 10) + ' %');
  const teinte = (n) => (n == null ? GREY : (n >= 0 ? GREEN : RED));
  // Tronquage VISIBLE : sans les points de suspension, deux lignes voisines
  // d'une même famille s'impriment à l'identique et on ne sait plus laquelle
  // dérape.
  const coupe = (txt, w) => {
    const l = pdf.splitTextToSize(String(txt == null ? '' : txt), w);
    return l.length > 1 ? pdf.splitTextToSize(l[0], w - 3)[0] + '...' : l[0];
  };
  const addFooter = () => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(130);
    const d = new Date();
    const p2 = (v) => String(v).padStart(2, '0');
    pdf.text(`Suivi des heures — ${R.week.name || ''} — édité le ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} à ${p2(d.getHours())}:${p2(d.getMinutes())}`,
      MARGIN, PAGE_H - 6);
    pdf.text(`Page ${pageNum}`, PAGE_W - MARGIN, PAGE_H - 6, { align: 'right' });
    pdf.setTextColor(0);
  };
  // jsPDF ouvre déjà une page : la première n'en ajoute pas une de plus.
  const newPage = () => { if (pageNum > 0) { addFooter(); pdf.addPage(); } pageNum++; y = MARGIN; };
  const ensureSpace = (h) => { if (y + h > PAGE_H - 12) newPage(); };
  let secNum = 0;
  const banner = (titre) => {
    secNum++;
    ensureSpace(16);
    pdf.setFillColor(...ORANGE);
    pdf.rect(MARGIN, y, CONTENT_W, 7, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(255);
    pdf.text(`${secNum}.  ${titre}`, MARGIN + 3, y + 4.9);
    pdf.setTextColor(0);
    y += 10.5;
  };
  const note = (txt) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(125);
    pdf.splitTextToSize(txt, CONTENT_W).forEach((l) => { pdf.text(l, MARGIN, y); y += 3.1; });
    pdf.setTextColor(0); y += 1.6;
  };
  const jauge = (pct, x, yy, w, h, couleur) => {
    pdf.setFillColor(226, 226, 226); pdf.rect(x, yy, w, h, 'F');
    const p = Math.max(0, Math.min(100, pct || 0));
    if (p > 0) { pdf.setFillColor(...(couleur || ORANGE)); pdf.rect(x, yy, w * p / 100, h, 'F'); }
  };
  // Hachure : le signal survit à une impression en noir et blanc, ce qu'une
  // couleur seule ne fait pas.
  const hachure = (x, yy, w, h) => {
    pdf.setDrawColor(255); pdf.setLineWidth(0.35);
    for (let d = 0; d < w + h; d += 1.8) {
      const x1 = x + Math.max(0, d - h), y1 = yy + Math.min(h, d);
      const x2 = x + Math.min(w, d),     y2 = yy + Math.max(0, d - w);
      pdf.line(x1, y1, x2, y2);
    }
    pdf.setLineWidth(0.2);
  };

  // ================= PAGE DE GARDE =================
  newPage();
  const T = R.totaux;
  pdf.setFillColor(...ORANGE); pdf.rect(0, 0, PAGE_W, 3, 'F');
  y = 34;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(27); pdf.setTextColor(...DARK);
  pdf.text('SUIVI DES HEURES', PAGE_W / 2, y, { align: 'center' });
  y += 11;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(14); pdf.setTextColor(90);
  pdf.text(coupe((state.companies[0] && state.companies[0].name) || 'Chantier', 200), PAGE_W / 2, y, { align: 'center' });
  y += 8;
  pdf.setFontSize(11);
  pdf.text(R.week.name || 'Semaine en cours', PAGE_W / 2, y, { align: 'center' });
  y += 14;
  pdf.setDrawColor(...LINE); pdf.setLineWidth(0.4);
  pdf.line(PAGE_W / 2 - 45, y, PAGE_W / 2 + 45, y);
  y += 16;

  // Le verdict, en très gros : c'est le seul chiffre que le conducteur
  // cherche en ouvrant le document.
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(120);
  pdf.text('ÉCART AU STADE', PAGE_W / 2, y, { align: 'center' });
  y += 15;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(38); pdf.setTextColor(...teinte(T.ecart));
  pdf.text(H(T.ecart, true) + ' h', PAGE_W / 2, y, { align: 'center' });
  y += 9;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(110);
  pdf.text(T.ecart >= 0
    ? 'Les heures pointées restent sous le droit à dépenser.'
    : 'Les heures pointées dépassent le droit à dépenser.', PAGE_W / 2, y, { align: 'center' });
  y += 16;

  // Trois chiffres d'appui, sobres.
  {
    const items = [
      ['Budget suivi', fmtHeures(T.budget) + ' h', R.lignes.length + (R.lignes.length > 1 ? ' lignes eOTP' : ' ligne eOTP')],
      ['Écart de la semaine', R.ss1Total == null ? 'n/a' : H(R.ss1Total, true) + ' h',
        R.prevWeek ? 'vs ' + (R.prevWeek.name || 'la semaine précédente') : 'première semaine : aucun comparatif'],
      ['Écart fin de chantier', H(T.ecartFdc, true) + ' h' + (R.fdcManquants ? ' *' : ''),
        'FDC projetée ' + fmtHeures(T.fdc) + ' h'],
    ];
    const cw = 78, gap = 8, x0 = (PAGE_W - (cw * 3 + gap * 2)) / 2;
    items.forEach((it, i) => {
      const x = x0 + i * (cw + gap);
      pdf.setFillColor(...CARD); pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2);
      pdf.rect(x, y, cw, 24, 'FD');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(120);
      pdf.text(it[0].toUpperCase(), x + 4, y + 5.5);
      pdf.setFontSize(14);
      pdf.setTextColor(...(i === 1 && R.ss1Total != null ? teinte(R.ss1Total)
        : (i === 2 ? teinte(T.ecartFdc) : DARK)));
      pdf.text(it[1], x + 4, y + 14);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(125);
      pdf.text(coupe(it[2], cw - 8), x + 4, y + 20);
    });
    y += 32;
  }
  pdf.setTextColor(0);
  {
    const d = new Date();
    const p2 = (v) => String(v).padStart(2, '0');
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(140);
    pdf.text(`Édité le ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`
      + (R.verrouillee ? ' — semaine close, valeurs figées' : ''), PAGE_W / 2, PAGE_H - 22, { align: 'center' });
    pdf.setTextColor(0);
  }

  // ================= TABLEAU DE BORD =================
  newPage();
  banner('SYNTHÈSE — ' + (R.week.name || ''));
  note(R.lignes.length + ' ligne(s) eOTP suivie(s), relevé SAP du ' + getHeuresSapDate() + '.'
    + (R.fdcManquants ? ' * ' + R.fdcManquants + ' ligne(s) sans quantité totale ne sont pas projetables : elles sortent des totaux de fin de chantier.' : ''));
  {
    const cartes = [
      ['BUDGET SUIVI', fmtHeures(T.budget) + ' h', DARK, 'avancement ' + P(T.avancement == null ? null : T.avancement * 100)],
      ['DROIT À DÉPENSER', fmtHeures(T.droit) + ' h', DARK, 'budget × avancement'],
      ['HEURES POINTÉES', fmtHeures(T.pumaEcart) + ' h', DARK, 'PUMA ' + fmtHeures(T.puma) + ' h moins correction ' + fmtHeures(T.corr) + ' h'],
      ['ÉCART AU STADE', H(T.ecart, true) + ' h', teinte(T.ecart), 'droit moins pointé'],
      ['ÉCART S/S-1', R.ss1Total == null ? 'n/a' : H(R.ss1Total, true) + ' h', teinte(R.ss1Total),
        R.prevWeek ? 'vs ' + coupe(R.prevWeek.name || '', 40) : 'aucun comparatif'],
    ];
    const gap = 3, cw = (CONTENT_W - gap * 4) / 5;
    cartes.forEach((c, i) => {
      const x = MARGIN + i * (cw + gap);
      pdf.setFillColor(...CARD); pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2);
      pdf.rect(x, y, cw, 24, 'FD');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(120);
      pdf.text(c[0], x + 3, y + 5);
      pdf.setFontSize(14); pdf.setTextColor(...c[2]);
      pdf.text(coupe(c[1], cw - 6), x + 3, y + 13.5);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.3); pdf.setTextColor(125);
      pdf.text(coupe(c[3], cw - 6), x + 3, y + 20);
    });
    pdf.setTextColor(0);
    y += 29;
  }

  // Produit vs consommé : deux barres sur le même axe, la seule image qui
  // explique l'écart au stade.
  {
    ensureSpace(30);
    const bx = MARGIN + 40, bw = CONTENT_W - 40 - 30;
    const pAcq = T.budget > 0 ? (T.droit / T.budget) * 100 : 0;
    const pCon = T.budget > 0 ? (T.pumaEcart / T.budget) * 100 : 0;
    const ligne = (lab, pct, val, couleur, yy) => {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(70);
      pdf.text(lab, MARGIN, yy + 3.4);
      jauge(Math.min(100, pct), bx, yy, bw, 4.6, couleur);
      if (pct > 100) {           // dépassement : un chevron, pas une barre qui déborde
        pdf.setFillColor(...RED);
        pdf.triangle(bx + bw + 1, yy, bx + bw + 4.5, yy + 2.3, bx + bw + 1, yy + 4.6, 'F');
      }
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(...DARK);
      pdf.text(P(pct) + '  ' + fmtHeures(val) + ' h', PAGE_W - MARGIN, yy + 3.4, { align: 'right' });
    };
    ligne('PRODUIT', pAcq, T.droit, [70, 130, 180], y);
    // Repère pointillé : où en est le produit, reporté sur la barre du bas.
    const xr = bx + bw * Math.min(1, Math.max(0, pAcq / 100));
    pdf.setDrawColor(90); pdf.setLineWidth(0.3);
    if (pdf.setLineDashPattern) pdf.setLineDashPattern([0.8, 0.8], 0);
    pdf.line(xr, y, xr, y + 13.6);
    if (pdf.setLineDashPattern) pdf.setLineDashPattern([], 0);
    ligne('CONSOMMÉ', pCon, T.pumaEcart, pCon > pAcq ? RED : GREEN, y + 9);
    y += 17;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(125);
    pdf.text('Les deux barres se lisent sur le même axe, en % du budget suivi. L\'écart entre elles EST l\'écart au stade.',
      MARGIN, y);
    pdf.setTextColor(0);
    y += 7;
  }

  // ----- Avancement par bâtiment -----
  banner(R.familleSource === 'batiments' ? 'AVANCEMENT PAR BÂTIMENT' : 'AVANCEMENT PAR RUBRIQUE');
  note(R.familleSource === 'batiments'
    ? 'Avancement physique du chantier (Avancement → Récapitulatif), pondéré par les heures budgétées des ouvrages. Il ne se compare pas aux heures pointées ci-dessus : ce sont deux mesures distinctes.'
    : 'Aucune zone ne porte d\'ouvrage : l\'avancement physique par bâtiment n\'est pas calculable. Le classement ci-dessous reprend vos rubriques du tableau des heures, en valeur acquise (droit à dépenser ÷ budget).');
  if (!R.familles.length) {
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8.5); pdf.setTextColor(140);
    pdf.text('Aucun bâtiment porteur d\'ouvrage, et aucune rubrique définie dans le tableau des heures.', MARGIN, y);
    pdf.setTextColor(0); pdf.setFont('helvetica', 'normal');
    y += 8;
  } else {
    const moy = R.familleSource === 'batiments' ? R.avModel.pct
      : (T.budget > 0 ? (T.droit / T.budget) * 100 : 0);
    const rows = R.familles.slice().sort((a, b) => b.pct - a.pct);
    const NOM_W = 52, PCT_W = 16, VAL_W = 54;   // la colonne de droite porte « x / y h · n lignes »
    const bx = MARGIN + NOM_W, bw = CONTENT_W - NOM_W - PCT_W - VAL_W;
    // Repère « avancement moyen » : chaque barre se juge par rapport à lui.
    const xm = bx + bw * Math.max(0, Math.min(1, moy / 100));
    ensureSpace(10 + rows.length * 7.4);
    pdf.setFillColor(...HEADBG); pdf.rect(MARGIN, y, CONTENT_W, 5, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(90);
    pdf.text(R.familleSource === 'batiments' ? 'BÂTIMENT' : 'RUBRIQUE', MARGIN + 2, y + 3.5);
    pdf.text('AVANCEMENT', bx + 2, y + 3.5);
    pdf.text('%', bx + bw + PCT_W - 2, y + 3.5, { align: 'right' });
    pdf.text('HEURES ACQUISES / BUDGET', PAGE_W - MARGIN - 2, y + 3.5, { align: 'right' });
    pdf.setTextColor(0);
    y += 7.2;
    for (const b of rows) {
      ensureSpace(8);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...DARK);
      pdf.text(coupe(b.nom, NOM_W - 3), MARGIN, y + 3.2);
      const retard = moy - b.pct;
      const couleur = b.pct >= 99.95 ? GREEN : (retard > 5 ? RED : ORANGE);
      jauge(b.pct, bx, y, bw, 4.4, couleur);
      // Retard marqué : hachure, pour que le signal survive au noir et blanc.
      if (retard > 5) hachure(bx, y, bw * Math.max(0, Math.min(100, b.pct)) / 100, 4.4);
      pdf.setDrawColor(60); pdf.setLineWidth(0.35);
      pdf.line(xm, y - 0.7, xm, y + 5.1);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
      pdf.setTextColor(...(retard > 5 ? RED : DARK));
      pdf.text(P(b.pct), bx + bw + PCT_W - 2, y + 3.2, { align: 'right' });
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(125);
      pdf.text(fmtHeures(b.done) + ' / ' + fmtHeures(b.budget) + ' h  ·  ' + b.detail,
        PAGE_W - MARGIN - 2, y + 3.2, { align: 'right' });
      pdf.setTextColor(0);
      y += 7.4;
    }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(125);
    pdf.text('Le trait vertical marque la moyenne (' + P(moy) + '). Une barre hachurée accuse plus de 5 points de retard sur cette moyenne.',
      MARGIN, y + 2);
    pdf.setTextColor(0);
    y += 8;
  }

  // ----- Où l'on gagne, où l'on perd -----
  newPage();
  banner('OÙ L\'ON GAGNE, OÙ L\'ON PERD');
  note('Écart au stade ligne par ligne : droit à dépenser moins heures pointées. La colonne de droite donne le mouvement de la semaine, pour distinguer un retard ancien d\'un dérapage récent.');
  {
    const gains = R.lignes.filter(l => l.comp.ecart > 0).reduce((a, l) => a + l.comp.ecart, 0);
    const pertes = R.lignes.filter(l => l.comp.ecart < 0).reduce((a, l) => a + l.comp.ecart, 0);
    const nG = R.lignes.filter(l => l.comp.ecart > 0).length;
    const nP = R.lignes.filter(l => l.comp.ecart < 0).length;
    // Barre bilan : la part de gains et la part de pertes, à l'échelle.
    const amp = Math.max(gains, Math.abs(pertes)) || 1;
    const bw = CONTENT_W - 66;
    ensureSpace(22);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(...GREEN);
    pdf.text('GAINS', MARGIN, y + 3.4);
    pdf.setFillColor(...GREEN); pdf.rect(MARGIN + 20, y, bw * (gains / amp), 4.4, 'F');
    pdf.setTextColor(...DARK); pdf.setFontSize(7.5);
    pdf.text('+' + fmtHeures(gains) + ' h  (' + nG + ')', PAGE_W - MARGIN, y + 3.4, { align: 'right' });
    y += 7;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(...RED);
    pdf.text('PERTES', MARGIN, y + 3.4);
    pdf.setFillColor(...RED); pdf.rect(MARGIN + 20, y, bw * (Math.abs(pertes) / amp), 4.4, 'F');
    hachure(MARGIN + 20, y, bw * (Math.abs(pertes) / amp), 4.4);
    pdf.setTextColor(...DARK); pdf.setFontSize(7.5);
    pdf.text(fmtHeures(pertes) + ' h  (' + nP + ')', PAGE_W - MARGIN, y + 3.4, { align: 'right' });
    y += 9;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(125);
    pdf.text('Solde : ' + H(T.ecart, true) + ' h sur ' + R.lignes.length + ' ligne(s).', MARGIN, y);
    pdf.setTextColor(0);
    y += 7;
  }
  // Classement : les pires d'abord, c'est là qu'on agit.
  {
    const rows = R.lignes.slice().sort((a, b) => a.comp.ecart - b.comp.ecart);
    const NOM_W = 74, BAR_W = CONTENT_W - NOM_W - 40 - 30 - 26;
    const amp = Math.max(1, ...rows.map(l => Math.abs(l.comp.ecart)));
    const zero = MARGIN + NOM_W + BAR_W / 2;
    pdf.setFillColor(...HEADBG); pdf.rect(MARGIN, y, CONTENT_W, 5, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(90);
    pdf.text('LIGNE eOTP', MARGIN + 2, y + 3.5);
    pdf.text('PERTE', zero - 3, y + 3.5, { align: 'right' });
    pdf.text('GAIN', zero + 3, y + 3.5);
    pdf.text('ÉCART AU STADE', MARGIN + NOM_W + BAR_W + 38, y + 3.5, { align: 'right' });
    pdf.text('S/S-1', MARGIN + NOM_W + BAR_W + 68, y + 3.5, { align: 'right' });
    pdf.text('RATIO', PAGE_W - MARGIN - 2, y + 3.5, { align: 'right' });
    pdf.setTextColor(0);
    y += 6.6;
    for (const l of rows) {
      ensureSpace(6);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.2); pdf.setTextColor(...DARK);
      pdf.text(coupe(l.nom, NOM_W - 3), MARGIN, y + 3);
      const w = (BAR_W / 2) * (Math.abs(l.comp.ecart) / amp);
      if (l.comp.ecart >= 0) {
        pdf.setFillColor(...GREEN); pdf.rect(zero, y + 0.4, w, 3.4, 'F');
      } else {
        pdf.setFillColor(...RED); pdf.rect(zero - w, y + 0.4, w, 3.4, 'F');
        hachure(zero - w, y + 0.4, w, 3.4);
      }
      pdf.setDrawColor(150); pdf.setLineWidth(0.2);
      pdf.line(zero, y, zero, y + 4.2);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.2); pdf.setTextColor(...teinte(l.comp.ecart));
      pdf.text(H(l.comp.ecart, true) + ' h', MARGIN + NOM_W + BAR_W + 38, y + 3, { align: 'right' });
      pdf.setTextColor(...teinte(l.comp.ecartSem));
      pdf.text(l.comp.ecartSem == null ? 'n/a' : H(l.comp.ecartSem, true), MARGIN + NOM_W + BAR_W + 68, y + 3, { align: 'right' });
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(110);
      pdf.text(l.comp.ratioActuel == null ? 'n/a'
        : fmtHeures(l.comp.ratioActuel) + (l.comp.ratio != null ? ' / ' + fmtHeures(l.comp.ratio) : ''),
        PAGE_W - MARGIN - 2, y + 3, { align: 'right' });
      pdf.setTextColor(0);
      y += 5.4;
    }
    y += 2;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(125);
    pdf.text('Colonne RATIO : ratio constaté / ratio théorique. Un ratio constaté supérieur au théorique signifie qu\'on dépense plus d\'heures par unité que prévu.',
      MARGIN, y);
    pdf.setTextColor(0);
    y += 7;
  }

  // ================= TABLEAU DÉTAILLÉ =================
  newPage();
  banner('TABLEAU DÉTAILLÉ — ' + (R.week.name || ''));
  {
    const somme = HEURES_PDF_COLS.reduce((a, c) => a + c.w, 0);
    if (Math.abs(somme - CONTENT_W) > 0.5) console.warn('Largeurs PDF heures : ' + somme + ' mm au lieu de ' + CONTENT_W);
  }
  {
    const parKey = new Map(HEURES_COLUMNS.map(c => [c.key, c]));
    const xs = []; let cx = MARGIN;
    for (const c of HEURES_PDF_COLS) { xs.push(cx); cx += c.w; }
    const ROW_H = 5.0;
    // Étiquettes courtes : « Écart FDC corr. » ne tient pas dans 14 mm.
    const COURT = {
      taches: 'Tâche', budgetHeures: 'Budget', unite: 'Un.', ratio: 'R. th.',
      qteTotal: 'Qté tot.', qteRealisee: 'Qté réal.', avancement: 'Avanc.', droit: 'Droit',
      sap: 'SAP', correction: 'Correc.', pumaCumule: 'PUMA', pumaEcart: 'PUMA c.',
      ecart: 'Éc. stade', ratioActuel: 'R. act.', radHeures: 'RAD (h)', fdcAuto: 'FDC',
      ecartFdc: 'Éc. FDC', ecartFdcCorrige: 'Éc. FDC c.', radCorrige: 'RAD c.', ecartSem: 'Éc. S/S-1'
    };
    const entete = () => {
      // Bandeaux de catégorie, puis intitulés : la même lecture qu'à l'écran.
      pdf.setFillColor(224, 224, 224);
      pdf.rect(MARGIN, y, CONTENT_W, 4.6, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(5.8); pdf.setTextColor(80);
      let k = 1;
      for (const run of getHeuresCatRuns()) {
        const x0 = xs[k];
        let w = 0;
        for (const col of run.cols) { const idx = HEURES_PDF_COLS.findIndex(c => c.key === col.key); if (idx >= 0) w += HEURES_PDF_COLS[idx].w; }
        pdf.setDrawColor(190); pdf.setLineWidth(0.2);
        pdf.line(x0, y, x0, y + 4.6);
        pdf.text(coupe(run.label.toUpperCase(), w - 1.5), x0 + w / 2, y + 3.1, { align: 'center' });
        k += run.cols.length;
      }
      y += 4.6;
      pdf.setFillColor(...HEADBG);
      pdf.rect(MARGIN, y, CONTENT_W, 5.4, 'F');
      pdf.setFontSize(5.9); pdf.setTextColor(60);
      HEURES_PDF_COLS.forEach((c, i) => {
        const lab = COURT[c.key] || c.key;
        if (c.al === 'left') pdf.text(lab, xs[i] + 1.5, y + 3.6);
        else pdf.text(coupe(lab, c.w - 2), xs[i] + c.w - 1.5, y + 3.6, { align: 'right' });
      });
      pdf.setDrawColor(150); pdf.setLineWidth(0.3);
      pdf.line(MARGIN, y + 5.4, PAGE_W - MARGIN, y + 5.4);
      pdf.setTextColor(0);
      y += 6.2;
    };
    entete();

    const HEURES_PDF_H = new Set(['sap', 'correction', 'pumaCumule', 'ecartFdcCorrige']);
    const cellule = (l, key) => {
      const col = parKey.get(key);
      if (!col) return '';
      if (col.kind === 'calc') return heuresCalcText(key, l.comp);
      if (key === 'unite') return l.row.unite || '-';
      const v = Number(l.row[key]) || 0;
      // À l'écran ce sont des champs de saisie ; sur papier, un chiffre nu au
      // milieu de colonnes en heures se lit mal.
      return HEURES_PDF_H.has(key) ? fmtHeures(v) + ' h' : fmtHeures(v);
    };
    const dessineLigne = (nom, get, gras, fond, teinteCle, encre) => {
      ensureSpace(ROW_H + 2);
      if (y === MARGIN) entete();
      if (fond) { pdf.setFillColor(...fond); pdf.rect(MARGIN, y - 0.6, CONTENT_W, ROW_H, 'F'); }
      pdf.setFont('helvetica', gras ? 'bold' : 'normal'); pdf.setFontSize(6.1);
      HEURES_PDF_COLS.forEach((c, i) => {
        const txt = c.key === 'taches' ? nom : get(c.key);
        if (txt == null || txt === '') return;
        const sig = teinteCle && teinteCle(c.key);
        pdf.setTextColor(...(sig || encre || DARK));
        if (c.al === 'left') pdf.text(coupe(txt, c.w - 2.5), xs[i] + 1.5, y + 2.9);
        else pdf.text(coupe(txt, c.w - 2), xs[i] + c.w - 1.5, y + 2.9, { align: 'right' });
      });
      pdf.setTextColor(0);
      y += ROW_H;
    };

    // Ordre et rubriques du tableau, à l'identique de l'écran.
    const parId = new Map(R.lignes.map(l => [l.id, l]));
    const vus = new Set();
    let alt = 0;
    const ligneNormale = (l) => {
      const fond = (alt++ % 2) ? [248, 248, 248] : null;
      const teinteCle = (k) => {
        if (!HEURES_SIGNED_COLUMNS.has(k)) return null;
        const v = k === 'ecart' ? l.comp.ecart : (k === 'ecartSem' ? l.comp.ecartSem : l.comp.ecartFdc);
        return v == null ? null : (v >= 0 ? GREEN : RED);
      };
      dessineLigne(l.nom, (k) => cellule(l, k), false, fond, teinteCle);
      vus.add(l.id);
    };
    for (const it of R.layout) {
      if (it.t === 'g') {
        const membres = getHeuresGroupMembers(R.layout, it.id).map(m => parId.get(m.id)).filter(Boolean);
        if (!membres.length) continue;
        const agg = { budget: 0, droit: 0, sap: 0, corr: 0, puma: 0, pumaEcart: 0, ecart: 0,
                      radHeures: 0, fdc: 0, ecartFdc: 0, ecartFdcCorrige: 0, radCorrige: 0, ecartSem: 0 };
        let ss1 = false;
        for (const m of membres) {
          agg.budget += m.comp.budget; agg.droit += m.comp.droit;
          agg.sap += Number(m.row.sap) || 0; agg.corr += Number(m.row.correction) || 0;
          agg.puma += Number(m.row.pumaCumule) || 0;
          agg.pumaEcart += m.comp.pumaEcart; agg.ecart += m.comp.ecart;
          agg.ecartFdcCorrige += m.comp.ecartFdcCorrige; agg.radCorrige += m.comp.radCorrige;
          if (m.comp.fdcAuto != null) { agg.fdc += m.comp.fdcAuto; agg.radHeures += m.comp.radHeures; agg.ecartFdc += m.comp.ecartFdc; }
          if (m.comp.ecartSem != null) { agg.ecartSem += m.comp.ecartSem; ss1 = true; }
        }
        const av = agg.budget > 0 ? Math.round((agg.droit / agg.budget) * 100) + ' %' : '-';
        const vals = { budgetHeures: fmtHeures(agg.budget) + ' h', unite: '', ratio: '', qteTotal: '', qteRealisee: '',
          avancement: av, droit: fmtHeures(agg.droit) + ' h', sap: fmtHeures(agg.sap) + ' h',
          correction: fmtHeures(agg.corr) + ' h', pumaCumule: fmtHeures(agg.puma) + ' h',
          pumaEcart: fmtHeures(agg.pumaEcart) + ' h', ecart: H(agg.ecart, true) + ' h', ratioActuel: '',
          radHeures: fmtHeures(agg.radHeures) + ' h', fdcAuto: fmtHeures(agg.fdc) + ' h',
          ecartFdc: H(agg.ecartFdc, true) + ' h', ecartFdcCorrige: fmtHeures(agg.ecartFdcCorrige) + ' h',
          radCorrige: fmtHeures(agg.radCorrige) + ' h', ecartSem: ss1 ? H(agg.ecartSem, true) + ' h' : '' };
        dessineLigne((it.name || 'Rubrique').toUpperCase(), (k) => vals[k], true, ORANGE, null, [255, 255, 255]);
        for (const m of membres) ligneNormale(m);
        continue;
      }
      const l = parId.get(it.id);
      if (l && !vus.has(l.id)) ligneNormale(l);
    }
    for (const l of R.lignes) if (!vus.has(l.id)) ligneNormale(l);

    // Pied de tableau
    ensureSpace(8);
    pdf.setDrawColor(90); pdf.setLineWidth(0.4);
    pdf.line(MARGIN, y - 0.6, PAGE_W - MARGIN, y - 0.6);
    const footVals = {
      budgetHeures: fmtHeures(T.budget) + ' h', unite: '', ratio: '', qteTotal: '', qteRealisee: '',
      avancement: T.avancement != null ? Math.round(T.avancement * 100) + ' %' : '-',
      droit: fmtHeures(T.droit) + ' h', sap: fmtHeures(T.sap) + ' h', correction: fmtHeures(T.corr) + ' h',
      pumaCumule: fmtHeures(T.puma) + ' h', pumaEcart: fmtHeures(T.pumaEcart) + ' h',
      ecart: H(T.ecart, true) + ' h', ratioActuel: '',
      radHeures: fmtHeures(T.radHeures) + ' h' + (R.fdcManquants ? ' *' : ''),
      fdcAuto: fmtHeures(T.fdc) + ' h' + (R.fdcManquants ? ' *' : ''),
      ecartFdc: H(T.ecartFdc, true) + ' h' + (R.fdcManquants ? ' *' : ''),
      ecartFdcCorrige: fmtHeures(T.ecartFdcCorrige) + ' h', radCorrige: fmtHeures(T.radCorrige) + ' h',
      ecartSem: R.ss1Total == null ? '' : H(R.ss1Total, true) + ' h'
    };
    dessineLigne('TOTAL', (k) => footVals[k], true, [235, 235, 235], (k) => {
      if (!HEURES_SIGNED_COLUMNS.has(k)) return null;
      const v = k === 'ecart' ? T.ecart : (k === 'ecartSem' ? R.ss1Total : T.ecartFdc);
      return v == null ? null : (v >= 0 ? GREEN : RED);
    });
    y += 3;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.3); pdf.setTextColor(125);
    pdf.text('PUMA corrigé = PUMA cumulé - Correction.  Écart au stade = Droit à dépenser - PUMA corrigé.  '
      + 'Écart FDC = Budget - FDC auto.  Écart S/S-1 = écart au stade de cette semaine - celui de la précédente.',
      MARGIN, y);
    pdf.setTextColor(0);
  }

  addFooter();
  const nom = 'suivi-heures-' + (R.week.name || 'semaine').replace(/[^\w\-]+/g, '-').toLowerCase() + '.pdf';
  pdf.save(nom);
  showToast('PDF généré');
}

// ========================================================================
// ST (sous-traitants) — onglets par entreprise (comme CR) + 4 groupes de
// lignes texte/montant avec total en bas de chaque groupe.
// ========================================================================
const ST_GROUPS = [
  { key: 'conforme', label: 'Conforme' },
  { key: 'marche',   label: 'Marché traité' },
  { key: 'rad',      label: 'Reste à Dépenser' },
  { key: 'rat',      label: 'Reste à Traiter' }
];

function getSTSelectedCompany() {
  if (!state.companies.length) return null;
  if (state.stSelectedCompanyId) {
    const c = state.companies.find(c => c.id === state.stSelectedCompanyId);
    if (c) return c;
  }
  return state.companies[0];
}
function setSTSelectedCompany(companyId) {
  state.stSelectedCompanyId = companyId;
  save();
  renderST();
}

function getSTEntries(companyId, groupKey) {
  const c = state.stEntries[companyId];
  if (!c || !Array.isArray(c[groupKey])) return [];
  return c[groupKey];
}
function ensureSTBucket(companyId, groupKey) {
  if (!state.stEntries[companyId]) state.stEntries[companyId] = {};
  if (!Array.isArray(state.stEntries[companyId][groupKey])) state.stEntries[companyId][groupKey] = [];
  return state.stEntries[companyId][groupKey];
}
// Une entrée ST issue d'un devis encore Brouillon/Envoyé est « en
// attente » : affichée sur fond gris et EXCLUE des totaux (groupe
// Conforme + bandeau récap) tant que le devis n'est pas validé ou plus.
function isSTEntryPendingDevis(entry) {
  if (!entry || !entry.sourceDevisLineId) return false;
  const d = getDevisByLineId(entry.sourceDevisLineId);
  return !!d && !isDevisValidated(d);
}
function getSTGroupTotal(companyId, groupKey) {
  return getSTEntries(companyId, groupKey).reduce((s, e) =>
    s + (isSTEntryPendingDevis(e) ? 0 : (Number(e.amount) || 0)), 0);
}
function addSTEntry(companyId, groupKey) {
  const list = ensureSTBucket(companyId, groupKey);
  list.push({ id: uid(), text: '', amount: 0 });
  save();
  renderST();
  requestAnimationFrame(() => {
    const last = document.querySelector(
      `.st-entry[data-company-id="${cssEscape(companyId)}"][data-group-key="${groupKey}"]:last-of-type .st-entry-text`);
    if (last) last.focus();
  });
}
function setSTEntryField(companyId, groupKey, entryId, field, value) {
  const list = getSTEntries(companyId, groupKey);
  const entry = list.find(e => e.id === entryId);
  if (!entry) return;
  if (field === 'text') {
    entry.text = value;
    save();
    // pas de re-render : on ne casse pas le focus de la frappe
  } else if (field === 'amount') {
    const n = parseFloat(String(value).replace(/[^\d,.-]/g, '').replace(',', '.'));
    entry.amount = Number.isFinite(n) ? n : 0;
    save();
    refreshSTGroupTotal(companyId, groupKey); // total du groupe à jour…
    refreshSTRecap(companyId);                // …et le bandeau récap
  }
}
function deleteSTEntry(companyId, groupKey, entryId) {
  const c = state.stEntries[companyId];
  if (!c || !Array.isArray(c[groupKey])) return;
  c[groupKey] = c[groupKey].filter(e => e.id !== entryId);
  save();
  renderST();
}
function refreshSTGroupTotal(companyId, groupKey) {
  const el = document.querySelector(
    `.st-group[data-company-id="${cssEscape(companyId)}"][data-group-key="${groupKey}"] .st-group-total-val`);
  if (el) el.textContent = fmtEur(getSTGroupTotal(companyId, groupKey));
}

// Déverrouillage PARTAGÉ des onglets protégés (ST + Devis) — valable pour
// la session (jusqu'au rechargement). Non persisté, non synchronisé.
// Un seul mot de passe (ST_PASSWORD) et un seul déverrouillage pour les deux.
let protectedUnlocked = false;

// Écran de saisie du mot de passe (cf. constante ST_PASSWORD en haut du
// fichier). onUnlock() est appelé une fois le bon mot de passe entré.
function buildProtectedLock(tabLabel, onUnlock) {
  const wrap = document.createElement('div');
  wrap.className = 'st-lock';
  wrap.innerHTML = `
    <div class="st-lock-icon">🔒</div>
    <p class="st-lock-title">Contenu protégé</p>
    <p class="st-lock-help">Entrez le mot de passe pour afficher l'onglet ${tabLabel}.</p>
    <input type="password" class="st-lock-input" placeholder="Mot de passe" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button type="button" class="btn-primary st-lock-btn">Déverrouiller</button>
    <p class="st-lock-error" hidden>Mot de passe incorrect.</p>
  `;
  const input = wrap.querySelector('.st-lock-input');
  const btn   = wrap.querySelector('.st-lock-btn');
  const err   = wrap.querySelector('.st-lock-error');
  const attempt = () => {
    if (input.value === ST_PASSWORD) {
      protectedUnlocked = true;
      onUnlock();
    } else {
      err.hidden = false;
      input.value = '';
      input.focus();
    }
  };
  btn.addEventListener('click', attempt);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); attempt(); } });
  input.addEventListener('input', () => { err.hidden = true; });
  setTimeout(() => input.focus(), 60);
  return wrap;
}

function renderST() {
  const slider = document.getElementById('stslider');
  const body = document.getElementById('stbody');
  const empty = document.getElementById('stempty');
  if (!slider || !body) return;
  if (!state.stEntries || typeof state.stEntries !== 'object') state.stEntries = {};
  slider.innerHTML = '';
  body.innerHTML = '';
  // Verrou : tant que le mot de passe n'est pas saisi, on masque tout le
  // contenu (sélecteur + groupes) et on affiche l'écran de déverrouillage.
  if (!protectedUnlocked) {
    slider.hidden = true;
    if (empty) empty.hidden = true;
    body.hidden = false;
    body.appendChild(buildProtectedLock('ST', renderST));
    return;
  }
  if (!state.companies.length) {
    if (empty) empty.hidden = false;
    slider.hidden = true; body.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  slider.hidden = false; body.hidden = false;

  const selected = getSTSelectedCompany();
  for (const c of state.companies) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cr-slider-chip' + (selected && c.id === selected.id ? ' is-active' : '');
    chip.dataset.stAction = 'select-company';
    chip.dataset.companyId = c.id;
    chip.textContent = c.name;
    slider.appendChild(chip);
  }
  if (!selected) return;

  const card = document.createElement('div');
  card.className = 'st-company';
  card.appendChild(buildSTRecap(selected.id));
  for (const g of ST_GROUPS) card.appendChild(buildSTGroup(selected.id, g));
  body.appendChild(card);
}

// Récap financier de l'entreprise sélectionnée.
//  Total budget   = groupe « Conforme »
//  Total dépenses = « Marché traité » + « Reste à Dépenser » + « Reste à Traiter »
//  Écart          = budget − dépenses   (pourcentage = écart / budget × 100)
function computeSTRecap(companyId) {
  const budget = getSTGroupTotal(companyId, 'conforme');
  const depenses = getSTGroupTotal(companyId, 'marche')
    + getSTGroupTotal(companyId, 'rad')
    + getSTGroupTotal(companyId, 'rat');
  const ecart = budget - depenses;
  const pct = budget !== 0 ? (ecart / budget) * 100 : null;
  return { budget, depenses, ecart, pct };
}
function stEcartText(r) {
  return r.pct != null
    ? `${fmtEur(r.ecart)} (${formatPct(Math.round(r.pct * 10) / 10)} %)`
    : fmtEur(r.ecart);
}
function buildSTRecap(companyId) {
  const r = computeSTRecap(companyId);
  const el = document.createElement('div');
  el.className = 'st-recap';
  el.dataset.companyId = companyId;
  el.innerHTML = `
    <div class="st-recap-cell">
      <span class="st-recap-label">Total budget</span>
      <span class="st-recap-val" data-st-recap="budget"></span>
    </div>
    <div class="st-recap-cell">
      <span class="st-recap-label">Total dépenses</span>
      <span class="st-recap-val" data-st-recap="depenses"></span>
    </div>
    <div class="st-recap-cell">
      <span class="st-recap-label">Écart</span>
      <span class="st-recap-val" data-st-recap="ecart"></span>
    </div>
  `;
  el.querySelector('[data-st-recap="budget"]').textContent = fmtEur(r.budget);
  el.querySelector('[data-st-recap="depenses"]').textContent = fmtEur(r.depenses);
  el.querySelector('[data-st-recap="ecart"]').textContent = stEcartText(r);
  return el;
}
function refreshSTRecap(companyId) {
  const el = document.querySelector(`.st-recap[data-company-id="${cssEscape(companyId)}"]`);
  if (!el) return;
  const r = computeSTRecap(companyId);
  el.querySelector('[data-st-recap="budget"]').textContent = fmtEur(r.budget);
  el.querySelector('[data-st-recap="depenses"]').textContent = fmtEur(r.depenses);
  el.querySelector('[data-st-recap="ecart"]').textContent = stEcartText(r);
}

function buildSTGroup(companyId, group) {
  const wrap = document.createElement('div');
  wrap.className = 'st-group';
  wrap.dataset.companyId = companyId;
  wrap.dataset.groupKey = group.key;

  const head = document.createElement('div');
  head.className = 'st-group-head';
  head.innerHTML = `
    <span class="st-group-name"></span>
    <button type="button" class="st-add-entry" data-st-action="add-entry" data-company-id="${companyId}" data-group-key="${group.key}" aria-label="Ajouter une ligne">+</button>
  `;
  head.querySelector('.st-group-name').textContent = group.label;
  wrap.appendChild(head);

  const list = document.createElement('div');
  list.className = 'st-group-body';
  const entries = getSTEntries(companyId, group.key);
  if (entries.length === 0) {
    const ph = document.createElement('p');
    ph.className = 'st-group-empty';
    ph.textContent = 'Aucune ligne. Touchez + pour en ajouter une.';
    list.appendChild(ph);
  } else {
    for (const e of entries) list.appendChild(buildSTEntry(companyId, group.key, e));
  }
  wrap.appendChild(list);

  // Total du groupe : bandeau orange, écriture blanche.
  const foot = document.createElement('div');
  foot.className = 'st-group-total';
  foot.innerHTML = `<span class="st-group-total-label">Total</span><span class="st-group-total-val"></span>`;
  foot.querySelector('.st-group-total-val').textContent = fmtEur(getSTGroupTotal(companyId, group.key));
  wrap.appendChild(foot);
  return wrap;
}

function buildSTEntry(companyId, groupKey, entry) {
  const row = document.createElement('div');
  row.className = 'st-entry';
  row.dataset.companyId = companyId;
  row.dataset.groupKey = groupKey;
  row.dataset.entryId = entry.id;

  const ta = document.createElement('textarea');
  ta.className = 'st-entry-text';
  ta.rows = 1;
  ta.placeholder = 'Description…';
  ta.value = entry.text || '';
  ta.dataset.stAction = 'edit-text';
  ta.dataset.companyId = companyId;
  ta.dataset.groupKey = groupKey;
  ta.dataset.entryId = entry.id;
  const autoResize = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
  ta.addEventListener('input', autoResize);
  setTimeout(autoResize, 0);
  row.appendChild(ta);

  const amtWrap = document.createElement('div');
  amtWrap.className = 'st-entry-amount-wrap';
  // Devis pas encore validé : montant exclu du total du groupe, avec un
  // fond qui suit l'état du devis (gris = Brouillon, orange = Envoyé).
  if (isSTEntryPendingDevis(entry)) {
    amtWrap.classList.add('is-pending');
    const srcDevis = getDevisByLineId(entry.sourceDevisLineId);
    if (srcDevis && srcDevis.etat === 'envoye') amtWrap.classList.add('is-pending-envoye');
    amtWrap.title = 'Devis non validé : montant non compté dans le total';
  }
  const amt = document.createElement('input');
  amt.className = 'st-entry-amount';
  amt.type = 'text';
  amt.inputMode = 'decimal';
  amt.placeholder = '0';
  amt.value = entry.amount ? fmtPriceForInput(entry.amount) : '';
  amt.dataset.stAction = 'edit-amount';
  amt.dataset.companyId = companyId;
  amt.dataset.groupKey = groupKey;
  amt.dataset.entryId = entry.id;
  amtWrap.appendChild(amt);
  const eur = document.createElement('span');
  eur.className = 'st-entry-eur';
  eur.textContent = '€';
  amtWrap.appendChild(eur);
  row.appendChild(amtWrap);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'st-entry-delete';
  del.dataset.stAction = 'delete-entry';
  del.dataset.companyId = companyId;
  del.dataset.groupKey = groupKey;
  del.dataset.entryId = entry.id;
  del.setAttribute('aria-label', 'Supprimer cette ligne');
  del.innerHTML = '×';
  row.appendChild(del);
  return row;
}

// ========================================================================
// DEVIS — onglets colorés par état, encart récap, lignes texte + montant €
// + entreprise bénéficiaire. Chaque ligne rattachée à une entreprise crée
// automatiquement une entrée « Devis n°XX : … » dans ST → groupe Conforme.
// ========================================================================
const DEVIS_ETATS = [
  { key: 'brouillon', label: 'Brouillon',    color: '#6b7280' }, // gris
  { key: 'envoye',    label: 'Envoyé',       color: '#f2691e' }, // orange
  { key: 'valide',    label: 'Validé',       color: '#16a34a' }, // vert
  { key: 'os',        label: 'OS reçu',      color: '#14532d' }, // vert foncé
  { key: 'avenant',   label: 'Avenant reçu', color: '#111827' }, // noir
  { key: 'refuse',    label: 'Refusé',       color: '#dc2626' }  // rouge
];
function getDevisEtat(key) {
  return DEVIS_ETATS.find(e => e.key === key) || DEVIS_ETATS[0];
}
// « Validé ou plus » : le devis compte dans les budgets ST à partir de
// Validé (Validé, OS reçu, Avenant reçu). Brouillon/Envoyé = en attente.
function isDevisValidated(d) {
  return !!d && ['valide', 'os', 'avenant'].includes(d.etat);
}
function getDevisByLineId(lineId) {
  for (const d of getDevisList()) {
    for (const v of getDevisVersions(d)) {
      if ((v.lines || []).some(l => l.id === lineId)) return d;
    }
  }
  return null;
}
// Localise une ligne dans les versions d'un devis.
function findDevisLine(d, lineId) {
  for (const v of getDevisVersions(d)) {
    const line = (v.lines || []).find(l => l.id === lineId);
    if (line) return { version: v, line };
  }
  return null;
}
// Une ligne n'alimente ST que si elle appartient à la version COURANTE
// (dernier indice) — les indices précédents sont un historique.
function isDevisLineCurrent(d, lineId) {
  const cur = getDevisCurrentVersion(d);
  return (cur.lines || []).some(l => l.id === lineId);
}

function getDevisList() { return Array.isArray(state.devis) ? state.devis : (state.devis = []); }
function getDevisById(id) { return getDevisList().find(d => d.id === id) || null; }

// --- Indices (versions) d'un devis : 0 puis A, B, C… ---
function devisIndiceLabel(idx) {
  if (idx === 0) return '0';
  let n = idx, s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}
// Migration : les devis pré-versions ({ lines, date } à plat) deviennent
// un indice « 0 ». Idempotente ; s'exécute au boot et défensivement à
// l'accès (un payload d'ancien client peut réintroduire l'ancien format).
function ensureDevisVersions(d) {
  if (!d) return d;
  if (!Array.isArray(d.versions) || d.versions.length === 0) {
    d.versions = [{
      id: 'dvv_' + uid(),
      indice: '0',
      date: d.date || '',
      lines: Array.isArray(d.lines) ? d.lines : []
    }];
    delete d.lines;
  }
  return d;
}
function migrateDevisVersions() {
  for (const d of getDevisList()) ensureDevisVersions(d);
}
function getDevisVersions(d) { return ensureDevisVersions(d).versions; }
// La version COURANTE (dernier indice) : celle qui alimente ST.
function getDevisCurrentVersion(d) {
  const v = getDevisVersions(d);
  return v[v.length - 1];
}
function getSelectedDevisVersion(d) {
  const versions = getDevisVersions(d);
  const wanted = (state.devisSelectedVersion || {})[d.id];
  return versions.find(v => v.id === wanted) || versions[versions.length - 1];
}
function setSelectedDevisVersion(devisId, versionId) {
  if (!state.devisSelectedVersion) state.devisSelectedVersion = {};
  state.devisSelectedVersion[devisId] = versionId;
  save();
  renderDevis();
}
// Nouvel indice = copie de la version courante (lignes dupliquées avec de
// nouveaux ids). Le pont ST bascule sur les nouvelles lignes : l'ancien
// indice devient un historique qui n'alimente plus ST.
function addDevisVersion(devisId) {
  const d = getDevisById(devisId);
  if (!d) return;
  const versions = getDevisVersions(d);
  const prev = versions[versions.length - 1];
  const copy = {
    id: 'dvv_' + uid(),
    indice: devisIndiceLabel(versions.length),
    date: todayISO(),
    lines: (prev.lines || []).map(l => ({ ...l, id: 'dl_' + uid() }))
  };
  // Bascule ST : retire les entrées des anciennes lignes, crée celles des copies.
  for (const l of (prev.lines || [])) removeSTEntryForDevisLine(l.id);
  versions.push(copy);
  for (const l of copy.lines) syncDevisLineToST(l, d);
  if (!state.devisSelectedVersion) state.devisSelectedVersion = {};
  state.devisSelectedVersion[devisId] = copy.id;
  save();
  renderDevis();
  renderST();
}
function deleteDevisVersion(devisId, versionId) {
  const d = getDevisById(devisId);
  if (!d) return;
  const versions = getDevisVersions(d);
  if (versions.length <= 1) return;
  const idx = versions.findIndex(v => v.id === versionId);
  if (idx < 0) return;
  const wasCurrent = idx === versions.length - 1;
  const v = versions[idx];
  if (!confirm(`Supprimer l'indice ${v.indice} de ce devis ?`)) return;
  if (wasCurrent) {
    // La version précédente redevient courante → re-bascule du pont ST.
    for (const l of (v.lines || [])) removeSTEntryForDevisLine(l.id);
    versions.splice(idx, 1);
    const cur = versions[versions.length - 1];
    for (const l of (cur.lines || [])) syncDevisLineToST(l, d);
  } else {
    versions.splice(idx, 1);
  }
  if (state.devisSelectedVersion) delete state.devisSelectedVersion[devisId];
  save();
  renderDevis();
  renderST();
}
function getSelectedDevis() {
  const list = getDevisList();
  if (!list.length) return null;
  return list.find(d => d.id === state.devisSelectedId) || list[0];
}
function setSelectedDevis(id) {
  state.devisSelectedId = id;
  save();
  renderDevis();
}
function getNextDevisNumber() {
  let max = 0;
  for (const d of getDevisList()) if (Number(d.number) > max) max = Number(d.number);
  return max + 1;
}
function addDevis() {
  const d = {
    id: 'dv_' + uid(), number: getNextDevisNumber(), etat: 'brouillon', avenantNum: '',
    versions: [{ id: 'dvv_' + uid(), indice: '0', date: todayISO(), lines: [] }]
  };
  getDevisList().push(d);
  state.devisSelectedId = d.id;
  save();
  renderDevis();
}
function deleteDevis(id) {
  const d = getDevisById(id);
  if (!d) return;
  if (!confirm(`Supprimer le devis n°${d.number} et ses lignes ?\nLes lignes ST liées seront aussi retirées.`)) return;
  for (const v of getDevisVersions(d)) {
    for (const line of (v.lines || [])) removeSTEntryForDevisLine(line.id);
  }
  state.devis = getDevisList().filter(x => x.id !== id);
  if (state.devisSelectedId === id) {
    const list = getDevisList();
    state.devisSelectedId = list.length ? list[list.length - 1].id : '';
  }
  save();
  renderDevis();
  renderST();
}
function setDevisEtat(id, etat) {
  const d = getDevisById(id);
  if (!d) return;
  d.etat = etat;
  // Re-synchronise les lignes de la version courante : un passage en
  // « Refusé » les retire de ST → Conforme ; en sortir les recrée.
  for (const line of (getDevisCurrentVersion(d).lines || [])) {
    syncDevisLineToST(line, d);
  }
  save();
  renderDevis(); // recolore l'onglet
  renderST();    // les montants liés entrent/sortent du groupe Conforme
}
function setDevisDate(id, value) {
  const d = getDevisById(id);
  if (!d) return;
  // La date de rédaction est propre à l'indice affiché.
  const v = getSelectedDevisVersion(d);
  if (v) v.date = value || '';
  save();
}
function setDevisAvenantNum(id, value) {
  const d = getDevisById(id);
  if (!d) return;
  d.avenantNum = String(value || '');
  save();
}
// Taux horaire propre au devis (vide/0 = taux global de Données).
// Rafraîchit les totaux affichés sans re-render (préserve le focus).
function setDevisTauxHoraire(id, value) {
  const d = getDevisById(id);
  if (!d) return;
  const n = parseFloat(String(value).replace(/[^\d,.-]/g, '').replace(',', '.'));
  d.tauxHoraire = Number.isFinite(n) && n >= 0 ? n : 0;
  save();
  const v = getSelectedDevisVersion(d);
  for (const line of (v.lines || [])) refreshDevisLineTotal(d.id, line.id);
  refreshDevisRecap(d.id);
}

// --- Lignes de devis (opèrent sur l'indice AFFICHÉ) ---
function addDevisLine(devisId) {
  const d = getDevisById(devisId);
  if (!d) return;
  const v = getSelectedDevisVersion(d);
  if (!Array.isArray(v.lines)) v.lines = [];
  const line = { id: 'dl_' + uid(), text: '', amount: 0, companyId: '' };
  v.lines.push(line);
  save();
  renderDevis();
  requestAnimationFrame(() => {
    const last = document.querySelector(`.devis-line[data-line-id="${cssEscape(line.id)}"] .devis-line-text`);
    if (last) last.focus();
  });
}
const DEVIS_LINE_TEXT_FIELDS = new Set(['hoursText', 'materielText', 'materiauxText']);
const DEVIS_LINE_NUM_FIELDS = new Set(['hours', 'materielAmount', 'materiauxAmount']);

function setDevisLineField(devisId, lineId, field, value) {
  const d = getDevisById(devisId);
  if (!d) return;
  const found = findDevisLine(d, lineId);
  if (!found) return;
  const line = found.line;
  // Seule la version courante alimente ST (les autres = historique).
  const bridgeST = isDevisLineCurrent(d, lineId);
  if (field === 'text') {
    line.text = value;
    if (bridgeST) syncDevisLineToST(line, d);
    save();
  } else if (field === 'amount') {
    const n = parseFloat(String(value).replace(/[^\d,.-]/g, '').replace(',', '.'));
    line.amount = Number.isFinite(n) ? n : 0;
    if (bridgeST) syncDevisLineToST(line, d);
    save();
    refreshDevisLineTotal(d.id, lineId);
    refreshDevisRecap(d.id);
    if (bridgeST) renderST(); // le montant Conforme change → récap ST à jour
  } else if (field === 'companyId') {
    line.companyId = value || '';
    if (bridgeST) { syncDevisLineToST(line, d); renderST(); }
    save();
  } else if (DEVIS_LINE_TEXT_FIELDS.has(field)) {
    line[field] = value;
    save();
  } else if (DEVIS_LINE_NUM_FIELDS.has(field)) {
    const n = parseFloat(String(value).replace(/[^\d,.-]/g, '').replace(',', '.'));
    line[field] = Number.isFinite(n) ? n : 0;
    save();
    // Heures / matériel / matériaux entrent dans le total de la ligne
    refreshDevisLineTotal(d.id, lineId);
    refreshDevisRecap(d.id);
  }
}
function deleteDevisLine(devisId, lineId) {
  const d = getDevisById(devisId);
  if (!d) return;
  const found = findDevisLine(d, lineId);
  if (!found) return;
  found.version.lines = (found.version.lines || []).filter(l => l.id !== lineId);
  removeSTEntryForDevisLine(lineId);
  save();
  renderDevis();
  renderST();
}

// --- Pont Devis → ST (groupe Conforme de l'entreprise bénéficiaire) ---
function findSTEntryForDevisLine(lineId) {
  for (const cid of Object.keys(state.stEntries || {})) {
    const arr = state.stEntries[cid] && state.stEntries[cid].conforme;
    if (!Array.isArray(arr)) continue;
    const e = arr.find(x => x.sourceDevisLineId === lineId);
    if (e) return { companyId: cid, entry: e };
  }
  return null;
}
function removeSTEntryForDevisLine(lineId) {
  for (const cid of Object.keys(state.stEntries || {})) {
    const arr = state.stEntries[cid] && state.stEntries[cid].conforme;
    if (!Array.isArray(arr)) continue;
    state.stEntries[cid].conforme = arr.filter(x => x.sourceDevisLineId !== lineId);
  }
}
// Crée / met à jour / déplace / retire l'entrée ST liée à une ligne de devis.
function syncDevisLineToST(line, devis) {
  const existing = findSTEntryForDevisLine(line.id);
  // Devis REFUSÉ : ses lignes n'apparaissent pas du tout dans ST →
  // Conforme (retirées si présentes). Elles reviennent automatiquement
  // si le devis change d'état.
  if (devis && devis.etat === 'refuse') {
    if (existing) removeSTEntryForDevisLine(line.id);
    return;
  }
  if (!line.companyId) {                 // pas d'entreprise → pas d'entrée ST
    if (existing) removeSTEntryForDevisLine(line.id);
    return;
  }
  const text = `Devis n°${devis.number} : ${line.text || ''}`;
  const amount = Number(line.amount) || 0;
  if (existing && existing.companyId === line.companyId) {
    existing.entry.text = text;
    existing.entry.amount = amount;
  } else {
    if (existing) removeSTEntryForDevisLine(line.id); // entreprise changée → on déplace
    const bucket = ensureSTBucket(line.companyId, 'conforme');
    bucket.push({ id: uid(), text, amount, sourceDevisLineId: line.id });
  }
}

// --- Totaux ---
// Taux horaire global (Données → Admin) : valeur PAR DÉFAUT.
function getTauxHoraire() { return Number(state.tauxHoraire) || 0; }
// Taux horaire effectif d'un devis : le sien s'il est renseigné (> 0),
// sinon le taux global de Données. Les taux varient selon les devis.
function getDevisTauxHoraire(devis) {
  const own = Number(devis && devis.tauxHoraire) || 0;
  return own > 0 ? own : getTauxHoraire();
}
// Total d'une ligne de devis = montant sous-traitant + heures × taux
// horaire (celui du devis) + matériel + matériaux.
function computeDevisLineTotal(line, taux) {
  return (Number(line.amount) || 0)
    + (Number(line.hours) || 0) * (Number(taux) || 0)
    + (Number(line.materielAmount) || 0)
    + (Number(line.materiauxAmount) || 0);
}
function refreshDevisLineTotal(devisId, lineId) {
  const d = getDevisById(devisId);
  const found = d && findDevisLine(d, lineId);
  if (!found) return;
  const el = document.querySelector(`.devis-line[data-line-id="${cssEscape(lineId)}"] .devis-line-total-val`);
  if (el) el.textContent = fmtEur(computeDevisLineTotal(found.line, getDevisTauxHoraire(d)));
}
// --- Récaps ---
// Récap d'une VERSION (bandeau du corps : l'indice affiché).
function computeDevisVersionRecap(version, taux) {
  const lines = (version && version.lines) || [];
  const total = lines.reduce((s, l) => s + computeDevisLineTotal(l, taux), 0);
  return { total, count: lines.length };
}
// Récap d'un DEVIS = sa version courante (dernier indice), à son taux.
// Utilisé par l'onglet Récap (sommes par état).
function computeDevisRecap(devis) {
  return computeDevisVersionRecap(getDevisCurrentVersion(devis), getDevisTauxHoraire(devis));
}
function refreshDevisRecap(devisId) {
  const d = getDevisById(devisId);
  if (!d) return;
  const el = document.querySelector(`.devis-recap[data-devis-id="${cssEscape(devisId)}"]`);
  if (!el) return;
  const r = computeDevisVersionRecap(getSelectedDevisVersion(d), getDevisTauxHoraire(d));
  const t = el.querySelector('[data-devis-recap="total"]');
  const c = el.querySelector('[data-devis-recap="count"]');
  if (t) t.textContent = fmtEur(r.total);
  if (c) c.textContent = String(r.count);
}

// --- Rendu ---
function renderDevis() {
  const tabs = document.getElementById('devistabs');
  const body = document.getElementById('devisbody');
  if (!tabs || !body) return;
  tabs.innerHTML = '';
  body.innerHTML = '';
  // Verrou partagé avec ST
  const scrollbarEl = document.getElementById('devistabsscrollbar');
  if (!protectedUnlocked) {
    tabs.hidden = true;
    if (scrollbarEl) scrollbarEl.hidden = true;
    body.hidden = false;
    body.appendChild(buildProtectedLock('Devis', renderDevis));
    return;
  }
  tabs.hidden = false; body.hidden = false;

  const list = getDevisList();
  const isRecap = state.devisSelectedId === '__recap__';
  const selected = isRecap ? null : getSelectedDevis();

  // Onglet Récapitulatif (sommes par état, tous devis confondus)
  const recapTab = document.createElement('button');
  recapTab.type = 'button';
  recapTab.className = 'devis-tab devis-tab-recap' + (isRecap ? ' is-active' : '');
  recapTab.dataset.devisAction = 'select';
  recapTab.dataset.devisId = '__recap__';
  recapTab.textContent = 'Récap';
  tabs.appendChild(recapTab);

  for (const d of list) {
    const et = getDevisEtat(d.etat);
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'devis-tab' + (selected && d.id === selected.id ? ' is-active' : '');
    tab.dataset.devisAction = 'select';
    tab.dataset.devisId = d.id;
    tab.style.background = et.color;
    tab.textContent = 'Devis ' + d.number;
    tabs.appendChild(tab);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'devis-tab devis-tab-add';
  add.dataset.devisAction = 'add';
  add.setAttribute('aria-label', 'Nouveau devis');
  add.textContent = '+';
  tabs.appendChild(add);
  requestAnimationFrame(updateDevisTabsScrollbar);

  if (isRecap) {
    body.appendChild(buildDevisRecapBody());
    return;
  }
  if (!selected) {
    const empty = document.createElement('p');
    empty.className = 'st-group-empty';
    empty.style.padding = '20px 4px';
    empty.textContent = 'Aucun devis. Touchez + pour en créer un.';
    body.appendChild(empty);
    return;
  }
  body.appendChild(buildDevisBody(selected));
}

// --- Barre de défilement personnalisée sous les onglets de devis ---
// Les barres natives « overlay » n'apparaissent qu'en cours de geste
// (voire jamais sur iOS) : celle-ci est toujours visible dès que les
// onglets débordent, et elle est draggable.
function updateDevisTabsScrollbar() {
  const tabs = document.getElementById('devistabs');
  const bar = document.getElementById('devistabsscrollbar');
  const thumb = document.getElementById('devistabsscrollthumb');
  if (!tabs || !bar || !thumb) return;
  const overflow = tabs.scrollWidth - tabs.clientWidth;
  if (overflow <= 1) { bar.hidden = true; return; }
  bar.hidden = false;
  const trackW = bar.clientWidth;
  const thumbW = Math.max(28, (tabs.clientWidth / tabs.scrollWidth) * trackW);
  const maxX = trackW - thumbW;
  const x = (tabs.scrollLeft / overflow) * maxX;
  thumb.style.width = thumbW + 'px';
  thumb.style.transform = `translateX(${x}px)`;
}
function setupDevisTabsScrollbar() {
  const tabs = document.getElementById('devistabs');
  const bar = document.getElementById('devistabsscrollbar');
  const thumb = document.getElementById('devistabsscrollthumb');
  if (!tabs || !bar || !thumb) return;
  tabs.addEventListener('scroll', updateDevisTabsScrollbar, { passive: true });
  window.addEventListener('resize', updateDevisTabsScrollbar);
  // Drag du curseur (pointer events : souris + tactile)
  let dragging = false, startX = 0, startScroll = 0;
  thumb.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startScroll = tabs.scrollLeft;
    thumb.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const overflow = tabs.scrollWidth - tabs.clientWidth;
    const maxX = bar.clientWidth - thumb.offsetWidth;
    if (maxX <= 0) return;
    tabs.scrollLeft = startScroll + (e.clientX - startX) * (overflow / maxX);
  });
  const endDrag = () => { dragging = false; };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
  // Clic sur la piste : saute à la position correspondante
  bar.addEventListener('pointerdown', (e) => {
    if (e.target === thumb) return;
    const rect = bar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - thumb.offsetWidth / 2) / Math.max(1, bar.clientWidth - thumb.offsetWidth);
    tabs.scrollLeft = Math.max(0, Math.min(1, ratio)) * (tabs.scrollWidth - tabs.clientWidth);
  });
}

// Onglet Récap : pour chaque état, nombre de devis et somme de leurs
// montants ; bandeau orange avec le total général en tête.
function buildDevisRecapBody() {
  const list = getDevisList();
  const card = document.createElement('div');
  card.className = 'devis-card';

  let grandTotal = 0, grandCount = 0;
  const perEtat = DEVIS_ETATS.map(e => {
    const items = list.filter(d => d.etat === e.key);
    const sum = items.reduce((s, d) => s + computeDevisRecap(d).total, 0);
    grandTotal += sum; grandCount += items.length;
    return { etat: e, count: items.length, sum };
  });

  const banner = document.createElement('div');
  banner.className = 'st-recap';
  banner.innerHTML = `
    <div class="st-recap-cell">
      <span class="st-recap-label">Total tous devis</span>
      <span class="st-recap-val"></span>
    </div>
    <div class="st-recap-cell">
      <span class="st-recap-label">Nombre de devis</span>
      <span class="st-recap-val"></span>
    </div>
  `;
  banner.querySelectorAll('.st-recap-val')[0].textContent = fmtEur(grandTotal);
  banner.querySelectorAll('.st-recap-val')[1].textContent = String(grandCount);
  card.appendChild(banner);

  const rows = document.createElement('div');
  rows.className = 'devis-recap-rows';
  for (const { etat, count, sum } of perEtat) {
    const row = document.createElement('div');
    row.className = 'devis-recap-row';
    row.innerHTML = `
      <span class="devis-recap-dot"></span>
      <span class="devis-recap-label"></span>
      <span class="devis-recap-count"></span>
      <span class="devis-recap-sum"></span>
    `;
    row.querySelector('.devis-recap-dot').style.background = etat.color;
    row.querySelector('.devis-recap-label').textContent = etat.label;
    row.querySelector('.devis-recap-count').textContent = count === 0 ? '—' : (count + (count > 1 ? ' devis' : ' devis'));
    row.querySelector('.devis-recap-sum').textContent = fmtEur(sum);
    rows.appendChild(row);
  }
  card.appendChild(rows);
  return card;
}

function buildDevisBody(devis) {
  const card = document.createElement('div');
  card.className = 'devis-card';
  const version = getSelectedDevisVersion(devis);
  const isCurrent = version.id === getDevisCurrentVersion(devis).id;

  // Slider des indices (versions) : 0, A, B, C… + « + » pour un nouvel
  // indice (copie de la version courante).
  const verBar = document.createElement('div');
  verBar.className = 'devis-versions';
  for (const v of getDevisVersions(devis)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'devis-version-chip' + (v.id === version.id ? ' is-active' : '');
    chip.dataset.devisAction = 'select-version';
    chip.dataset.devisId = devis.id;
    chip.dataset.versionId = v.id;
    chip.textContent = 'Indice ' + v.indice;
    verBar.appendChild(chip);
  }
  if (getDevisVersions(devis).length > 1) {
    const delVer = document.createElement('button');
    delVer.type = 'button';
    delVer.className = 'devis-version-chip devis-version-del';
    delVer.dataset.devisAction = 'delete-version';
    delVer.dataset.devisId = devis.id;
    delVer.dataset.versionId = version.id;
    delVer.title = 'Supprimer l\'indice affiché';
    delVer.textContent = '×';
    verBar.appendChild(delVer);
  }
  const addVer = document.createElement('button');
  addVer.type = 'button';
  addVer.className = 'devis-version-chip devis-version-add';
  addVer.dataset.devisAction = 'add-version';
  addVer.dataset.devisId = devis.id;
  addVer.title = 'Nouvel indice (copie de la version courante)';
  addVer.textContent = '+';
  verBar.appendChild(addVer);
  card.appendChild(verBar);

  if (!isCurrent) {
    const note = document.createElement('p');
    note.className = 'devis-version-note';
    note.textContent = `Indice ${version.indice} — version archivée : ses montants n'alimentent pas l'onglet ST (seul le dernier indice compte).`;
    card.appendChild(note);
  }

  // Ligne état + suppression
  const etatRow = document.createElement('div');
  etatRow.className = 'devis-etat-row';
  const sel = document.createElement('select');
  sel.className = 'devis-etat-select';
  sel.dataset.devisAction = 'set-etat';
  sel.dataset.devisId = devis.id;
  sel.setAttribute('aria-label', 'État du devis');
  for (const e of DEVIS_ETATS) {
    const opt = new Option(e.label, e.key);
    if (e.key === devis.etat) opt.selected = true;
    sel.appendChild(opt);
  }
  const etatLabel = document.createElement('span');
  etatLabel.className = 'devis-etat-label';
  etatLabel.textContent = 'État :';
  etatRow.appendChild(etatLabel);
  etatRow.appendChild(sel);
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'devis-delete-btn';
  delBtn.dataset.devisAction = 'delete';
  delBtn.dataset.devisId = devis.id;
  delBtn.textContent = 'Supprimer le devis';
  etatRow.appendChild(delBtn);
  card.appendChild(etatRow);

  // N° d'avenant — visible uniquement quand l'état est « Avenant reçu ».
  if (devis.etat === 'avenant') {
    const avRow = document.createElement('div');
    avRow.className = 'devis-etat-row devis-avenant-row';
    const avLabel = document.createElement('span');
    avLabel.className = 'devis-etat-label';
    avLabel.textContent = 'N° d\'avenant :';
    avRow.appendChild(avLabel);
    const avInp = document.createElement('input');
    avInp.type = 'text';
    avInp.className = 'devis-avenant-input';
    avInp.maxLength = 20;
    avInp.placeholder = 'ex. AV-03';
    avInp.value = devis.avenantNum || '';
    avInp.dataset.devisAction = 'set-avenant';
    avInp.dataset.devisId = devis.id;
    avInp.setAttribute('aria-label', 'Numéro de l\'avenant');
    avRow.appendChild(avInp);
    card.appendChild(avRow);
  }

  // Taux horaire propre au devis (les taux varient selon les devis).
  // Vide = taux global de Données (affiché en placeholder).
  const tauxRow = document.createElement('div');
  tauxRow.className = 'devis-etat-row devis-taux-row';
  const tauxLabel = document.createElement('span');
  tauxLabel.className = 'devis-etat-label';
  tauxLabel.textContent = 'Taux horaire :';
  tauxRow.appendChild(tauxLabel);
  const tauxInp = document.createElement('input');
  tauxInp.type = 'text';
  tauxInp.inputMode = 'decimal';
  tauxInp.className = 'devis-taux-input';
  tauxInp.placeholder = getTauxHoraire() > 0 ? fmtPriceForInput(getTauxHoraire()) + ' (défaut)' : '0';
  tauxInp.value = (Number(devis.tauxHoraire) || 0) > 0 ? fmtPriceForInput(devis.tauxHoraire) : '';
  tauxInp.dataset.devisAction = 'set-taux';
  tauxInp.dataset.devisId = devis.id;
  tauxInp.setAttribute('aria-label', 'Taux horaire de ce devis');
  tauxRow.appendChild(tauxInp);
  const tauxUnit = document.createElement('span');
  tauxUnit.className = 'devis-etat-label';
  tauxUnit.textContent = '€ / h';
  tauxRow.appendChild(tauxUnit);
  card.appendChild(tauxRow);

  // Date de rédaction — sur sa propre ligne, sous l'état (par indice).
  const dateRow = document.createElement('div');
  dateRow.className = 'devis-etat-row devis-date-row';
  const dateLabel = document.createElement('span');
  dateLabel.className = 'devis-etat-label';
  dateLabel.textContent = 'Rédigé le :';
  dateRow.appendChild(dateLabel);
  const dateInp = document.createElement('input');
  dateInp.type = 'date';
  dateInp.className = 'devis-date-input';
  dateInp.value = version.date || '';
  dateInp.dataset.devisAction = 'set-date';
  dateInp.dataset.devisId = devis.id;
  dateInp.setAttribute('aria-label', 'Date de rédaction de cet indice');
  dateRow.appendChild(dateInp);
  card.appendChild(dateRow);

  // Encart récap (orange, comme ST) — totaux de l'indice affiché
  const r = computeDevisVersionRecap(version, getDevisTauxHoraire(devis));
  const recap = document.createElement('div');
  recap.className = 'st-recap devis-recap';
  recap.dataset.devisId = devis.id;
  recap.innerHTML = `
    <div class="st-recap-cell">
      <span class="st-recap-label">Montant total</span>
      <span class="st-recap-val" data-devis-recap="total"></span>
    </div>
    <div class="st-recap-cell">
      <span class="st-recap-label">Nombre de lignes</span>
      <span class="st-recap-val" data-devis-recap="count"></span>
    </div>
  `;
  recap.querySelector('[data-devis-recap="total"]').textContent = fmtEur(r.total);
  recap.querySelector('[data-devis-recap="count"]').textContent = String(r.count);
  card.appendChild(recap);

  // Lignes de l'indice affiché
  const lines = document.createElement('div');
  lines.className = 'devis-lines';
  if (!version.lines || version.lines.length === 0) {
    const ph = document.createElement('p');
    ph.className = 'st-group-empty';
    ph.textContent = 'Aucune ligne. Touchez « + Ajouter une ligne ».';
    lines.appendChild(ph);
  } else {
    for (const line of version.lines) lines.appendChild(buildDevisLine(devis.id, line));
  }
  card.appendChild(lines);

  const addLine = document.createElement('button');
  addLine.type = 'button';
  addLine.className = 'cr-add-section devis-add-line';
  addLine.dataset.devisAction = 'add-line';
  addLine.dataset.devisId = devis.id;
  addLine.textContent = '+ Ajouter une ligne';
  card.appendChild(addLine);
  return card;
}

// Champ montant (droite d'une sous-ligne) : input décimal + suffixe (€/h).
function buildDevisAmountWrap(devisId, lineId, field, value, suffix) {
  const wrap = document.createElement('div');
  wrap.className = 'st-entry-amount-wrap';
  const inp = document.createElement('input');
  inp.className = 'st-entry-amount';
  inp.type = 'text';
  inp.inputMode = 'decimal';
  inp.placeholder = '0';
  inp.value = value ? fmtPriceForInput(value) : '';
  inp.dataset.devisAction = 'edit-line-field';
  inp.dataset.devisId = devisId;
  inp.dataset.lineId = lineId;
  inp.dataset.field = field;
  wrap.appendChild(inp);
  const suf = document.createElement('span');
  suf.className = 'st-entry-eur';
  suf.textContent = suffix;
  wrap.appendChild(suf);
  return wrap;
}

// Bloc de devis (une « tâche », comme les cartes de l'onglet CR) :
//   description
//   entreprise affectée      | montant €   (→ alimente ST → Conforme)
//   main d'œuvre             | heures h
//   matériel                 | montant €
//   matériaux                | montant €
function buildDevisLine(devisId, line) {
  const card = document.createElement('div');
  card.className = 'devis-line';
  card.dataset.devisId = devisId;
  card.dataset.lineId = line.id;

  // Ligne 1 : description + suppression du bloc
  const top = document.createElement('div');
  top.className = 'devis-line-row devis-line-toprow';
  const ta = document.createElement('textarea');
  ta.className = 'devis-line-text';
  ta.rows = 1;
  ta.placeholder = 'Description du devis…';
  ta.value = line.text || '';
  ta.dataset.devisAction = 'edit-text';
  ta.dataset.devisId = devisId;
  ta.dataset.lineId = line.id;
  const autoResize = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
  ta.addEventListener('input', autoResize);
  setTimeout(autoResize, 0);
  top.appendChild(ta);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'st-entry-delete';
  del.dataset.devisAction = 'delete-line';
  del.dataset.devisId = devisId;
  del.dataset.lineId = line.id;
  del.setAttribute('aria-label', 'Supprimer ce bloc');
  del.innerHTML = '×';
  top.appendChild(del);
  card.appendChild(top);

  // Ligne 2 : sous-traitant + montant € (celui repris dans ST), avec un
  // libellé fixe au-dessus (les placeholders disparaissent à la saisie).
  const compGroup = document.createElement('div');
  compGroup.className = 'devis-field-group';
  const compLabel = document.createElement('span');
  compLabel.className = 'devis-field-label';
  compLabel.textContent = 'Sous-traitant';
  compGroup.appendChild(compLabel);
  const compRow = document.createElement('div');
  compRow.className = 'devis-line-row';
  const comp = document.createElement('select');
  comp.className = 'devis-line-company';
  comp.dataset.devisAction = 'edit-company';
  comp.dataset.devisId = devisId;
  comp.dataset.lineId = line.id;
  comp.setAttribute('aria-label', 'Entreprise sous-traitante');
  const none = new Option('— Entreprise —', '');
  if (!line.companyId) none.selected = true;
  comp.appendChild(none);
  for (const c of state.companies) {
    const opt = new Option(c.name, c.id);
    if (c.id === line.companyId) opt.selected = true;
    comp.appendChild(opt);
  }
  compRow.appendChild(comp);
  compRow.appendChild(buildDevisAmountWrap(devisId, line.id, 'amount', line.amount, '€'));
  compGroup.appendChild(compRow);
  card.appendChild(compGroup);

  // Lignes 3-5 : main d'œuvre (heures), matériel (€), matériaux (€) —
  // chacune avec son libellé fixe au-dessus du champ.
  const subRows = [
    { label: 'Main d\'œuvre', textField: 'hoursText',     placeholder: 'Détail (optionnel)…', amountField: 'hours',           suffix: 'h' },
    { label: 'Matériel',      textField: 'materielText',  placeholder: 'Détail (optionnel)…', amountField: 'materielAmount',  suffix: '€' },
    { label: 'Matériaux',     textField: 'materiauxText', placeholder: 'Détail (optionnel)…', amountField: 'materiauxAmount', suffix: '€' },
  ];
  for (const sub of subRows) {
    const group = document.createElement('div');
    group.className = 'devis-field-group';
    const lbl = document.createElement('span');
    lbl.className = 'devis-field-label';
    lbl.textContent = sub.label;
    group.appendChild(lbl);
    const row = document.createElement('div');
    row.className = 'devis-line-row';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'devis-line-sub';
    inp.placeholder = sub.placeholder;
    inp.value = line[sub.textField] || '';
    inp.dataset.devisAction = 'edit-line-field';
    inp.dataset.devisId = devisId;
    inp.dataset.lineId = line.id;
    inp.dataset.field = sub.textField;
    row.appendChild(inp);
    row.appendChild(buildDevisAmountWrap(devisId, line.id, sub.amountField, line[sub.amountField], sub.suffix));
    group.appendChild(row);
    card.appendChild(group);
  }

  // Total du bloc : sous-traitant + heures × taux horaire (du devis) + matériel + matériaux
  const totalRow = document.createElement('div');
  totalRow.className = 'devis-line-total';
  totalRow.innerHTML = `<span class="devis-line-total-label">Total ligne</span><span class="devis-line-total-val"></span>`;
  totalRow.querySelector('.devis-line-total-val').textContent =
    fmtEur(computeDevisLineTotal(line, getDevisTauxHoraire(getDevisById(devisId))));
  card.appendChild(totalRow);
  return card;
}

// ========================================================================
// TRAVAUX — le CCTP du chantier, en 3 vues sur les MÊMES données
//   • Visite : « je suis ici » → tout ce qui est dû dans ce lieu, classé
//     par lot (cas d'usage : je visite un logement).
//   • CCTP   : « le lot X » → sommaire + articles numérotés avec leur
//     LOCALISATION (cas d'usage : rendez-vous avec le sous-traitant).
//   • Carnet : paramétrage (chapitres, articles, lieux concernés).
//
// Modèle calqué sur un CCTP de bâtiment :
//   LOT (Données → Lots)
//    └─ CHAPITRE  travauxOuvrages      { id, name, lotId }
//        └─ ARTICLE travauxPrescriptions { id, ouvrageId, title, text,
//              remplacement, specs:[{id,label,value}], everywhere,
//              zones:{[zoneId]:true}, localisation }
// Numérotation automatique : <lot>.<chapitre>.<article> (ex. 6.1.2).
// Les champs title / localisation / lotId sont optionnels : les données
// antérieures restent lisibles (titre vide → la 1re ligne du texte sert de
// titre, lotId vide → chapitre rangé dans « Hors lot »).
// ========================================================================

// Filtres de consultation — volontairement hors du state : ce sont des
// filtres d'écran, jamais synchronisés ni persistés.
let travauxSearchQuery = '';
let travauxCctpLotId = '';   // '' = tous les lots
// Identifiant du groupe « Hors lot » dans les vues (les chapitres, eux,
// portent simplement lotId = '').
const TRAVAUX_HORS_LOT = '__hors_lot__';

// ---------- Arborescence des zones ----------
// Enfants directs d'une zone, dans l'ordre de saisie (Données → Zones).
function travauxZoneChildren(parentId) {
  const pid = parentId || null;
  return state.zones.filter(z => (z.parentId || null) === pid);
}
// TOUTES les zones en ordre ARBORESCENT : bâtiment, puis ses sous-zones,
// puis le bâtiment suivant… (et non l'ordre de création, qui mélange les
// bâtiments et leurs sous-zones).
function getZonesOrdered() {
  const out = [];
  const seen = new Set();
  const walk = (pid, depth) => {
    if (depth > 20) return;
    for (const z of travauxZoneChildren(pid)) {
      if (seen.has(z.id)) continue;
      seen.add(z.id);
      out.push({ zone: z, depth });
      walk(z.id, depth + 1);
    }
  };
  walk(null, 1);
  // Zones orphelines (parent supprimé) : rattachées en fin de liste.
  for (const z of state.zones) if (!seen.has(z.id)) { seen.add(z.id); out.push({ zone: z, depth: 1 }); }
  return out;
}
function travauxZoneAncestors(zoneId) {
  const byId = new Map(state.zones.map(z => [z.id, z]));
  const set = new Set();
  let cur = byId.get(zoneId), guard = 0;
  while (cur && guard++ < 40) { set.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  return set;
}
function travauxZoneLabel(zoneId) {
  const byId = new Map(state.zones.map(z => [z.id, z]));
  const parts = [];
  let cur = byId.get(zoneId), guard = 0;
  while (cur && guard++ < 40) { parts.unshift(cur.name || '(zone)'); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  return parts.join(' › ');
}
function travauxZoneName(zoneId) {
  const z = state.zones.find(x => x.id === zoneId);
  return z ? (z.name || '(zone)') : '';
}

// ---------- Accès aux données ----------
function getTravauxOuvrages() { return Array.isArray(state.travauxOuvrages) ? state.travauxOuvrages : (state.travauxOuvrages = []); }
function getTravauxPrescriptions() { return Array.isArray(state.travauxPrescriptions) ? state.travauxPrescriptions : (state.travauxPrescriptions = []); }
function getTravauxOuvrage(id) { return getTravauxOuvrages().find(o => o.id === id) || null; }
function getTravauxPrescription(id) { return getTravauxPrescriptions().find(p => p.id === id) || null; }
function getPrescriptionsForOuvrage(ouvrageId) { return getTravauxPrescriptions().filter(p => p.ouvrageId === ouvrageId); }

// Numéro d'un lot : celui inscrit dans son nom s'il y en a un (« 06 -
// Plâtrerie », « Lot 3 Peinture » → 6, 3), sinon son rang dans Données →
// Lots. Cela permet de coller à la numérotation du CCTP du marché.
function travauxLotNum(lot, rang) {
  const m = /^\s*(?:lot\s*)?n?°?\s*(\d{1,2})\b/i.exec(lot.name || '');
  return m ? Number(m[1]) : rang;
}
// Construit l'arborescence numérotée LOT → CHAPITRE → ARTICLE.
function buildTravauxCCTP() {
  const lots = getWorkBatches();
  const groups = [];
  const byLot = new Map();
  lots.forEach((lot, i) => {
    const g = {
      id: lot.id, name: lot.name || 'Lot sans nom',
      color: lot.color || 'var(--accent)', num: travauxLotNum(lot, i + 1),
      companyName: travauxLotCompanyName(lot.id), ouvrages: []
    };
    byLot.set(lot.id, g);
    groups.push(g);
  });
  // Les lots se lisent dans l'ordre de leur numéro (comme un CCTP relié) ;
  // « Hors lot » ferme toujours la marche.
  groups.sort((a, b) => a.num - b.num);
  // id distinct de '' : '' désigne déjà « tous les lots » dans les filtres.
  const horsLot = {
    id: TRAVAUX_HORS_LOT, isOrphan: true, name: 'Hors lot', color: '#7d7368',
    num: groups.reduce((m, g) => Math.max(m, g.num), 0) + 1, companyName: '', ouvrages: []
  };
  for (const o of getTravauxOuvrages()) {
    const g = byLot.get(o.lotId) || horsLot;
    const chap = { ouvrage: o, num: g.num + '.' + (g.ouvrages.length + 1), articles: [] };
    for (const p of getPrescriptionsForOuvrage(o.id)) {
      chap.articles.push({ presc: p, num: chap.num + '.' + (chap.articles.length + 1) });
    }
    g.ouvrages.push(chap);
  }
  if (horsLot.ouvrages.length) groups.push(horsLot);
  return groups;
}

// Titre d'article : le champ dédié, sinon la 1re ligne de la description.
function travauxArticleTitle(p) {
  const t = (p.title || '').trim();
  if (t) return t;
  const first = (p.text || '').trim().split('\n')[0].trim();
  return first || '(prestation à décrire)';
}
// Corps d'article : le reste, quand la 1re ligne a servi de titre.
function travauxArticleBody(p) {
  const txt = p.text || '';
  if ((p.title || '').trim()) return txt;
  return txt.split('\n').slice(1).join('\n');
}
// Lieux d'application, dans l'ordre de l'arborescence.
function travauxArticleZoneIds(p) {
  if (!p.zones) return [];
  const order = new Map(getZonesOrdered().map((e, i) => [e.zone.id, i]));
  return Object.keys(p.zones)
    .filter(id => order.has(id))
    .sort((a, b) => order.get(a) - order.get(b));
}
// Une prescription s'applique à la zone Z si : « partout », OU une de ses
// zones cochées est Z ou un ANCÊTRE de Z (héritage vers les sous-zones).
function prescriptionAppliesToZone(p, zoneId, ancestorsSet) {
  if (p.everywhere) return true;
  if (!p.zones) return false;
  const anc = ancestorsSet || travauxZoneAncestors(zoneId);
  for (const zid of Object.keys(p.zones)) if (anc.has(zid)) return true;
  return false;
}
// Texte indexé par la recherche (titre, corps, détails, localisation…).
function travauxArticleHaystack(p, chapName, lotName, num) {
  const specs = (p.specs || []).map(s => (s.label || '') + ' ' + (s.value || '')).join(' ');
  const zones = travauxArticleZoneIds(p).map(id => travauxZoneLabel(id)).join(' ');
  return [num, lotName, chapName, travauxArticleTitle(p), p.text || '', specs, p.localisation || '', zones,
    p.everywhere ? 'partout toutes zones' : '', p.remplacement ? 'remplacement' : '']
    .join(' ').toLowerCase();
}

// ======================= MUTATIONS (vue Carnet) =======================
function addTravauxOuvrage(lotId) {
  const o = { id: 'to_' + uid(), name: '', lotId: lotId || '' };
  getTravauxOuvrages().push(o);
  save();
  travauxCarnetSel = { type: 'chapitre', id: o.id };
  travauxCarnetEditing = true;
  travauxCarnetCollapsed.delete('lot:' + (lotId || TRAVAUX_HORS_LOT));
  renderTravauxCarnet();
  requestAnimationFrame(() => {
    const el = document.getElementById('carnet-field-chap');
    if (el) el.focus();
  });
}
function renameTravauxOuvrage(id, name) {
  const o = getTravauxOuvrage(id);
  if (!o) return;
  o.name = name;
  save(); // frappe en cours : pas de re-render
}
function setTravauxOuvrageLot(id, lotId) {
  const o = getTravauxOuvrage(id);
  if (!o) return;
  o.lotId = lotId || '';
  save();
  renderTravauxCarnet();
}
function deleteTravauxOuvrage(id) {
  const o = getTravauxOuvrage(id);
  if (!o) return;
  const nb = getPrescriptionsForOuvrage(id).length;
  if (!confirm(`Supprimer le chapitre \u00ab ${o.name || 'sans nom'} \u00bb${nb ? ` et ses ${nb} article(s)` : ''} ?`)) return;
  state.travauxOuvrages = getTravauxOuvrages().filter(x => x.id !== id);
  state.travauxPrescriptions = getTravauxPrescriptions().filter(p => p.ouvrageId !== id);
  save();
  travauxCarnetSel = null;
  travauxCarnetEditing = false;
  renderTravauxCarnet();
}

function addTravauxPrescription(ouvrageId) {
  const p = {
    id: 'tp_' + uid(), ouvrageId, title: '', text: '', remplacement: false,
    specs: [], everywhere: false, zones: {}, localisation: ''
  };
  getTravauxPrescriptions().push(p);
  save();
  travauxCarnetCollapsed.delete('chap:' + ouvrageId);
  travauxCarnetSel = { type: 'article', id: p.id };
  travauxCarnetEditing = true;
  renderTravauxCarnet();
  requestAnimationFrame(() => {
    const el = document.getElementById('carnet-field-title');
    if (el) el.focus();
  });
}
function setTravauxPrescriptionField(id, field, value) {
  const p = getTravauxPrescription(id);
  if (!p) return;
  p[field] = value;
  save(); // frappe en cours : pas de re-render
}
function deleteTravauxPrescription(id) {
  const p = getTravauxPrescription(id);
  if (!p) return;
  if (!confirm('Supprimer cet article ?')) return;
  state.travauxPrescriptions = getTravauxPrescriptions().filter(x => x.id !== id);
  save();
  travauxCarnetSel = null;
  travauxCarnetEditing = false;
  renderTravauxCarnet();
}
function setTravauxSpecField(prescId, specId, field, value) {
  const p = getTravauxPrescription(prescId);
  if (!p || !Array.isArray(p.specs)) return;
  const s = p.specs.find(x => x.id === specId);
  if (!s) return;
  s[field] = value;
  save(); // frappe en cours
}

// ======================= RENDU =======================
function renderTravaux() {
  if (!document.getElementById('page-travaux')) return;
  renderTravauxVisite();
  renderTravauxCCTP();
  renderTravauxCarnet();
}

// ---------------------- Briques partagées aux deux vues ----------------------
// Entreprise rattachée à un lot (Données → Lots) : en visite comme en
// rendez-vous, la première question est « qui doit cette prestation ? ».
function travauxLotCompanyName(lotId) {
  const lot = getWorkBatches().find(l => l.id === lotId);
  if (!lot || !lot.companyId) return '';
  const c = getCompany(lot.companyId);
  return c && c.name ? c.name : '';
}
// Surligne les occurrences de la recherche dans un texte.
function travauxHiliteInto(el, text, q) {
  const src = text || '';
  const needle = (q || '').trim();
  if (!needle) { el.textContent = src; return; }
  const low = src.toLowerCase(), lq = needle.toLowerCase();
  el.textContent = '';
  let from = 0, i;
  while ((i = low.indexOf(lq, from)) !== -1) {
    if (i > from) el.appendChild(document.createTextNode(src.slice(from, i)));
    const m = document.createElement('mark');
    m.className = 'tv-mark';
    m.textContent = src.slice(i, i + needle.length);
    el.appendChild(m);
    from = i + needle.length;
  }
  el.appendChild(document.createTextNode(src.slice(from)));
}
// Version texte d'un article — sert au partage et à la copie.
function travauxArticleAsText(a) {
  const p = a.presc;
  const out = [a.num + ' - ' + travauxArticleTitle(p) + (p.remplacement ? '   [REMPLACEMENT]' : '')];
  const body = travauxArticleBody(p).trim();
  if (body) out.push(body);
  const specs = (p.specs || [])
    .filter(s => (s.label || '').trim() || (s.value || '').trim())
    .map(s => '• ' + ((s.label || '').trim() ? s.label.trim() + ' : ' : '') + (s.value || '').trim());
  if (specs.length) out.push(specs.join('\n'));
  const loca = [];
  if ((p.localisation || '').trim()) loca.push(p.localisation.trim());
  if (p.everywhere) loca.push('Toutes les zones du chantier.');
  else for (const z of travauxArticleZoneIds(p)) loca.push('- ' + travauxZoneLabel(z));
  if (loca.length) out.push('LOCALISATION :\n' + loca.join('\n'));
  return out.join('\n');
}
// Partage natif si l'appareil le propose (téléphone), presse-papiers sinon.
async function travauxShareOrCopy(title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copié dans le presse-papiers');
  } catch (e) {
    showToast('Copie impossible sur cet appareil', 'error');
  }
}
// Navigation croisée : les deux vues sont deux projections du même document.
function travauxGotoArticle(prescId) {
  const p = getTravauxPrescription(prescId);
  if (!p) return;
  const o = getTravauxOuvrage(p.ouvrageId);
  travauxCctpLotId = o ? (o.lotId || TRAVAUX_HORS_LOT) : '';
  travauxSearchQuery = '';
  travauxCctpRempl = false;
  travauxCctpNoLoca = false;
  const input = document.getElementById('travauxsearch');
  if (input) input.value = '';
  switchSubPage('travaux', 'cctp');
  requestAnimationFrame(() => travauxFlashArticle(prescId));
}
function travauxFlashArticle(prescId) {
  const el = document.getElementById('travaux-art-' + prescId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('is-flash');
  setTimeout(() => el.classList.remove('is-flash'), 1600);
}
function travauxGotoZone(zoneId) {
  const byId = new Map(state.zones.map(z => [z.id, z]));
  const path = [];
  let cur = byId.get(zoneId), guard = 0;
  while (cur && guard++ < 40) { path.unshift(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  if (!path.length) return;
  state.travauxVisitePath = path;
  save();
  travauxVisiteLotId = '';
  switchSubPage('travaux', 'visite');
}

// Bloc « détails techniques » en pastilles (lecture).
function buildTravauxSpecChips(p, q) {
  const specs = (p.specs || []).filter(s => (s.label || '').trim() || (s.value || '').trim());
  if (!specs.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'travaux-sheet-specs';
  for (const s of specs) {
    const chip = document.createElement('span');
    chip.className = 'travaux-spec-chip';
    if (s.label) {
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = s.label;
      chip.appendChild(k);
    }
    const v = document.createElement('span');
    travauxHiliteInto(v, s.value || '', q);
    chip.appendChild(v);
    wrap.appendChild(chip);
  }
  return wrap;
}
// Bloc « LOCALISATION : » à la façon d'un CCTP. Les zones sont cliquables :
// elles ouvrent la vue Visite sur le lieu concerné.
function buildTravauxLocalisationBlock(p, q) {
  const note = (p.localisation || '').trim();
  const zoneIds = travauxArticleZoneIds(p);
  if (!p.everywhere && !note && !zoneIds.length) return null;
  const box = document.createElement('div');
  box.className = 'travaux-loca';
  const head = document.createElement('div');
  head.className = 'travaux-loca-head';
  head.textContent = 'LOCALISATION :';
  box.appendChild(head);
  if (note) {
    const t = document.createElement('p');
    t.className = 'travaux-loca-note';
    travauxHiliteInto(t, note, q);
    box.appendChild(t);
  }
  if (p.everywhere) {
    const t = document.createElement('p');
    t.className = 'travaux-loca-all';
    t.textContent = 'Toutes les zones du chantier.';
    box.appendChild(t);
  } else if (zoneIds.length) {
    const list = document.createElement('div');
    list.className = 'travaux-loca-zones';
    for (const zid of zoneIds) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'travaux-loca-zone';
      b.title = 'Voir tout ce qui est dû dans ce lieu';
      travauxHiliteInto(b, travauxZoneLabel(zid), q);
      b.addEventListener('click', () => travauxGotoZone(zid));
      list.appendChild(b);
    }
    box.appendChild(list);
  }
  return box;
}

// ---------------------- Vue CCTP : le document ----------------------
// Filtres d'écran (ni persistés, ni synchronisés).
let travauxCctpRempl = false;      // n'afficher que les remplacements
let travauxCctpNoLoca = false;     // n'afficher que les articles sans localisation
let travauxCctpActiveChap = '';    // chapitre courant, suivi au défilement
let _travauxScrollHooked = false;

function renderTravauxCCTP() {
  renderTravauxCctpTools();
  renderTravauxCctpLots();
  renderTravauxCctpBody();
}
function renderTravauxCctpTools() {
  const setOn = (id, on) => { const b = document.getElementById(id); if (b) b.classList.toggle('is-on', !!on); };
  setOn('travauxcctprempl', travauxCctpRempl);
  setOn('travauxcctpnoloca', travauxCctpNoLoca);
}
// Structure filtrée : sert à la fois au sommaire et au document.
function travauxCctpFiltered() {
  const q = travauxSearchQuery.trim().toLowerCase();
  const keep = (a, chapName, lotName) => {
    const p = a.presc;
    if (travauxCctpRempl && !p.remplacement) return false;
    if (travauxCctpNoLoca && (p.everywhere || Object.keys(p.zones || {}).length || (p.localisation || '').trim())) return false;
    if (q && !travauxArticleHaystack(p, chapName, lotName, a.num).includes(q)) return false;
    return true;
  };
  const out = [];
  for (const g of buildTravauxCCTP()) {
    const chaps = [];
    for (const chap of g.ouvrages) {
      const arts = chap.articles.filter(a => keep(a, chap.ouvrage.name || '', g.name));
      if (arts.length) chaps.push({ chap, arts });
    }
    if (chaps.length) out.push({ group: g, chaps });
  }
  return out;
}
function renderTravauxCctpLots() {
  const el = document.getElementById('travauxcctplots');
  if (!el) return;
  el.innerHTML = '';
  // Les compteurs suivent les filtres actifs mais IGNORENT le filtre de lot :
  // on voit toujours combien d'articles chaque lot contiendrait.
  const data = travauxCctpFiltered();
  if (!data.length) return;
  const mk = (id, label, color, count, active) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tv-lot-chip' + (active ? ' is-on' : '');
    if (color) {
      const dot = document.createElement('span');
      dot.className = 'travaux-lot-dot';
      dot.style.background = color;
      btn.appendChild(dot);
    }
    const t = document.createElement('span');
    t.className = 'tv-lot-chip-name';
    t.textContent = label;
    btn.appendChild(t);
    const c = document.createElement('span');
    c.className = 'tv-lot-count';
    c.textContent = String(count);
    btn.appendChild(c);
    btn.addEventListener('click', () => {
      travauxCctpLotId = id;
      renderTravauxCCTP();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    el.appendChild(btn);
  };
  const total = data.reduce((n, d) => n + d.chaps.reduce((m, c) => m + c.arts.length, 0), 0);
  mk('', 'Tous les lots', '', total, !travauxCctpLotId);
  for (const d of data) {
    const co = d.group.companyName;
    mk(d.group.id, d.group.num + ' · ' + d.group.name + (co ? ' — ' + co : ''), d.group.color,
      d.chaps.reduce((m, c) => m + c.arts.length, 0), travauxCctpLotId === d.group.id);
  }
}
function renderTravauxCctpBody() {
  const body = document.getElementById('travauxcctpbody');
  const nav = document.getElementById('travauxcctpnav');
  const ctx = document.getElementById('travauxcctpcontext');
  const wrap = document.querySelector('.cctp');
  if (!body || !nav) return;
  body.innerHTML = '';
  nav.innerHTML = '';
  if (ctx) { ctx.hidden = true; ctx.textContent = ''; }
  travauxCctpActiveChap = '';

  const q = travauxSearchQuery.trim();
  const searching = q.length > 0;
  if (wrap) wrap.classList.toggle('is-search', searching);

  const data = travauxCctpFiltered();
  if (!data.length) {
    body.appendChild(travauxEmptyMsg(
      (searching || travauxCctpRempl || travauxCctpNoLoca)
        ? 'Aucun article ne correspond à cette recherche.'
        : 'Aucun article. Renseignez le Carnet : un chapitre par famille d\'ouvrage, un article par prestation due.'));
    return;
  }

  // --- Mode recherche : résultats à plat, tous lots confondus ---
  if (searching) {
    const hits = [];
    for (const d of data) for (const c of d.chaps) for (const a of c.arts) hits.push({ g: d.group, chap: c.chap, a });
    const info = document.createElement('div');
    info.className = 'tv-result-info';
    info.textContent = hits.length + ' article' + (hits.length > 1 ? 's' : '') + ' pour « ' + q + ' »';
    body.appendChild(info);
    for (const h of hits) body.appendChild(buildTravauxArticle(h.a, { lot: h.g, chapName: h.chap.ouvrage.name, q }));
    return;
  }

  // --- Mode lecture : sommaire + document du lot sélectionné ---
  let shown = data;
  if (travauxCctpLotId) {
    shown = data.filter(d => d.group.id === travauxCctpLotId);
    if (!shown.length) { travauxCctpLotId = ''; shown = data; }
  }
  for (const d of shown) {
    nav.appendChild(buildCctpNavLot(d));
    body.appendChild(buildCctpLotHead(d.group));
    for (const { chap, arts } of d.chaps) {
      const h = document.createElement('h3');
      h.className = 'travaux-chap-head';
      h.id = 'travaux-chap-' + chap.ouvrage.id;
      h.dataset.chapId = chap.ouvrage.id;
      h.dataset.context = 'LOT ' + d.group.num + ' › ' + chap.num + ' ' + (chap.ouvrage.name || 'CHAPITRE').toUpperCase();
      h.textContent = chap.num + ' - ' + (chap.ouvrage.name || 'CHAPITRE SANS NOM').toUpperCase();
      body.appendChild(h);
      for (const a of arts) body.appendChild(buildTravauxArticle(a, {}));
    }
  }
  hookTravauxCctpScroll();
  requestAnimationFrame(updateTravauxCctpContext);
}
function buildCctpLotHead(g) {
  const head = document.createElement('div');
  head.className = 'travaux-lot-head';
  head.style.setProperty('--lot-color', g.color);
  const n = document.createElement('span');
  n.className = 'travaux-lot-head-num';
  n.textContent = 'LOT ' + g.num;
  head.appendChild(n);
  const nm = document.createElement('span');
  nm.className = 'travaux-lot-head-name';
  nm.textContent = g.name;
  head.appendChild(nm);
  if (g.companyName) {
    const co = document.createElement('span');
    co.className = 'travaux-lot-head-co';
    co.textContent = g.companyName;
    head.appendChild(co);
  }
  return head;
}
// Sommaire : les chapitres du lot ; les articles du chapitre courant se
// révèlent seuls (pure CSS, aucun re-rendu au défilement).
function buildCctpNavLot(d) {
  const box = document.createElement('div');
  box.className = 'cctp-nav-lot';
  const head = document.createElement('div');
  head.className = 'cctp-nav-lot-head';
  head.style.setProperty('--lot-color', d.group.color);
  head.textContent = 'LOT ' + d.group.num + ' · ' + d.group.name;
  box.appendChild(head);
  if (d.group.companyName) {
    const co = document.createElement('div');
    co.className = 'cctp-nav-lot-co';
    co.textContent = d.group.companyName;
    box.appendChild(co);
  }
  for (const { chap, arts } of d.chaps) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cctp-nav-chap';
    b.dataset.chapId = chap.ouvrage.id;
    const n = document.createElement('span');
    n.className = 'cctp-nav-num';
    n.textContent = chap.num;
    b.appendChild(n);
    const t = document.createElement('span');
    t.className = 'cctp-nav-text';
    t.textContent = (chap.ouvrage.name || 'Chapitre').toUpperCase();
    b.appendChild(t);
    const c = document.createElement('span');
    c.className = 'tv-lot-count';
    c.textContent = String(arts.length);
    b.appendChild(c);
    b.addEventListener('click', () => {
      const h = document.getElementById('travaux-chap-' + chap.ouvrage.id);
      if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      closeTravauxCctpNav();
    });
    box.appendChild(b);
    const arch = document.createElement('div');
    arch.className = 'cctp-nav-arts';
    for (const a of arts) {
      const ab = document.createElement('button');
      ab.type = 'button';
      ab.className = 'cctp-nav-art';
      const an = document.createElement('span');
      an.className = 'cctp-nav-num';
      an.textContent = a.num;
      ab.appendChild(an);
      const at = document.createElement('span');
      at.className = 'cctp-nav-text';
      at.textContent = travauxArticleTitle(a.presc);
      ab.appendChild(at);
      ab.addEventListener('click', () => { travauxFlashArticle(a.presc.id); closeTravauxCctpNav(); });
      arch.appendChild(ab);
    }
    box.appendChild(arch);
  }
  return box;
}
function closeTravauxCctpNav() {
  const wrap = document.querySelector('.cctp');
  if (wrap) wrap.classList.remove('is-nav-open');
  const btn = document.getElementById('travauxcctpsomm');
  if (btn) btn.classList.remove('is-on');
}
// Repère de lecture : un bandeau collant rappelle en permanence dans quel
// lot et quel chapitre on se trouve, et le sommaire suit.
function hookTravauxCctpScroll() {
  if (_travauxScrollHooked) return;
  _travauxScrollHooked = true;
  let raf = 0;
  window.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; updateTravauxCctpContext(); });
  }, { passive: true });
}
function updateTravauxCctpContext() {
  const sub = document.getElementById('sub-cctp');
  if (!sub || !sub.classList.contains('active')) return;
  const bar = document.getElementById('travauxcctpcontext');
  if (!bar) return;
  const heads = Array.from(document.querySelectorAll('#travauxcctpbody .travaux-chap-head'));
  if (!heads.length) { bar.hidden = true; return; }
  const limit = 130;
  let cur = heads[0];
  for (const h of heads) { if (h.getBoundingClientRect().top <= limit) cur = h; else break; }
  bar.hidden = false;
  bar.textContent = cur.dataset.context || cur.textContent;
  const id = cur.dataset.chapId || '';
  if (id === travauxCctpActiveChap) return;
  travauxCctpActiveChap = id;
  let active = null;
  document.querySelectorAll('.cctp-nav-chap').forEach(el => {
    const on = el.dataset.chapId === id;
    el.classList.toggle('is-active', on);
    if (on) active = el;
  });
  // On déplace le sommaire dans son propre cadre (jamais la page).
  const nav = document.getElementById('travauxcctpnav');
  if (nav && active && nav.scrollHeight > nav.clientHeight) {
    nav.scrollTop = Math.max(0, active.offsetTop - nav.clientHeight / 2);
  }
}
// Un article de CCTP : numéro + titre, corps, détails, LOCALISATION.
function buildTravauxArticle(a, opts) {
  const p = a.presc;
  const q = (opts && opts.q) || '';
  const art = document.createElement('article');
  art.className = 'travaux-art';
  art.id = 'travaux-art-' + p.id;

  const head = document.createElement('div');
  head.className = 'travaux-art-head';
  const num = document.createElement('span');
  num.className = 'travaux-art-num';
  num.textContent = a.num;
  head.appendChild(num);
  const title = document.createElement('h4');
  title.className = 'travaux-art-title';
  travauxHiliteInto(title, travauxArticleTitle(p), q);
  head.appendChild(title);
  if (p.remplacement) {
    const tag = document.createElement('span');
    tag.className = 'travaux-rempl-tag';
    tag.textContent = 'Remplacement';
    head.appendChild(tag);
  }
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'travaux-art-copy';
  copy.title = 'Copier / partager cet article';
  copy.setAttribute('aria-label', 'Copier ou partager cet article');
  copy.innerHTML = SVG_COPY;
  copy.addEventListener('click', () => travauxShareOrCopy(a.num + ' ' + travauxArticleTitle(p), travauxArticleAsText(a)));
  head.appendChild(copy);
  art.appendChild(head);

  // Fil d'Ariane (mode recherche : on rappelle lot + chapitre)
  if (opts && opts.lot) {
    const crumb = document.createElement('button');
    crumb.type = 'button';
    crumb.className = 'travaux-art-crumb';
    crumb.title = 'Ouvrir ce lot dans le document';
    const dot = document.createElement('span');
    dot.className = 'travaux-lot-dot';
    dot.style.background = opts.lot.color;
    crumb.appendChild(dot);
    crumb.appendChild(document.createTextNode(
      'LOT ' + opts.lot.num + ' · ' + opts.lot.name + ' › ' + (opts.chapName || 'Chapitre')));
    crumb.addEventListener('click', () => travauxGotoArticle(p.id));
    art.appendChild(crumb);
  }

  const bodyTxt = travauxArticleBody(p).trim();
  if (bodyTxt) {
    const pre = document.createElement('div');
    pre.className = 'travaux-art-body';
    travauxHiliteInto(pre, bodyTxt, q);
    art.appendChild(pre);
  }
  const chips = buildTravauxSpecChips(p, q);
  if (chips) art.appendChild(chips);
  const loca = buildTravauxLocalisationBlock(p, q);
  if (loca) art.appendChild(loca);
  return art;
}

// ---------------------- Vue Visite : la fiche de lieu ----------------------
let travauxVisiteSearch = '';
let travauxVisiteLotId = '';          // '' = tous les lots
let travauxVisiteRemplOnly = false;
let travauxVisiteExpandAll = false;
let travauxVisiteExpanded = new Set(); // articles dépliés un par un

function renderTravauxVisite() {
  renderTravauxVisiteLocBar();
  renderTravauxVisiteHop();
  renderTravauxVisiteTools();
  renderTravauxVisiteBody();
}
// Chemin de zones sélectionné, validé contre l'arborescence courante.
function getTravauxVisitePath() {
  if (!Array.isArray(state.travauxVisitePath)) state.travauxVisitePath = [];
  const out = [];
  let parent = null;
  for (const zid of state.travauxVisitePath) {
    const z = travauxZoneChildren(parent).find(x => x.id === zid);
    if (!z) break;
    out.push(z.id);
    parent = z.id;
  }
  if (!out.length) {
    const roots = travauxZoneChildren(null);
    if (roots.length) out.push(roots[0].id);
  }
  state.travauxVisitePath = out;
  return out;
}
function getTravauxVisiteTarget() {
  const path = getTravauxVisitePath();
  if (!path.length) return null;
  return state.zones.find(z => z.id === path[path.length - 1]) || null;
}
function setTravauxVisitePath(path) {
  state.travauxVisitePath = path;
  save();
  renderTravauxVisite();
}
// Fil d'Ariane cliquable : compact quelle que soit la profondeur, chaque
// segment remonte à son niveau.
function renderTravauxVisiteLocBar() {
  const bar = document.getElementById('travauxlocbar');
  if (!bar) return;
  bar.innerHTML = '';
  if (!state.zones.length) return;
  const path = getTravauxVisitePath();
  const pin = document.createElement('span');
  pin.className = 'tv-pin';
  pin.textContent = '📍';
  bar.appendChild(pin);
  const crumb = document.createElement('div');
  crumb.className = 'tv-crumb';
  path.forEach((zid, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'tv-crumb-sep';
      sep.textContent = '›';
      crumb.appendChild(sep);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tv-crumb-btn' + (i === path.length - 1 ? ' is-last' : '');
    btn.textContent = travauxZoneName(zid);
    btn.addEventListener('click', () => setTravauxVisitePath(path.slice(0, i + 1)));
    crumb.appendChild(btn);
  });
  bar.appendChild(crumb);
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'tv-locpick';
  pick.textContent = 'Changer de lieu';
  pick.addEventListener('click', openTravauxZoneModal);
  bar.appendChild(pick);
}
// Rangée de saut rapide : les sous-zones du lieu courant, ou à défaut ses
// voisines — c'est le geste le plus fréquent en visite.
function renderTravauxVisiteHop() {
  const el = document.getElementById('travauxlochop');
  if (!el) return;
  el.innerHTML = '';
  const path = getTravauxVisitePath();
  const target = getTravauxVisiteTarget();
  if (!target) return;
  const kids = travauxZoneChildren(target.id);
  const down = kids.length > 0;
  const list = down ? kids : travauxZoneChildren(target.parentId || null);
  if (list.length < 2 && !down) return;
  if (!list.length) return;
  const lbl = document.createElement('span');
  lbl.className = 'tv-hop-label';
  lbl.textContent = down ? 'Descendre' : 'Voisines';
  el.appendChild(lbl);
  const row = document.createElement('div');
  row.className = 'tv-hop-row';
  for (const z of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tv-hop-btn' + (!down && z.id === target.id ? ' is-on' : '');
    btn.textContent = z.name || '(zone)';
    btn.addEventListener('click', () => {
      setTravauxVisitePath(down ? path.concat(z.id) : path.slice(0, -1).concat(z.id));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    row.appendChild(btn);
  }
  el.appendChild(row);
}
function renderTravauxVisiteTools() {
  const target = getTravauxVisiteTarget();
  const hasKids = target ? travauxZoneChildren(target.id).length > 0 : false;
  const exp = document.getElementById('travauxvisiteexpand');
  if (exp) {
    exp.classList.toggle('is-on', travauxVisiteExpandAll);
    exp.textContent = travauxVisiteExpandAll ? 'Tout replier' : 'Tout déplier';
  }
  const rp = document.getElementById('travauxvisiterempl');
  if (rp) rp.classList.toggle('is-on', travauxVisiteRemplOnly);
  const dp = document.getElementById('travauxvisitedeep');
  if (dp) {
    dp.hidden = !hasKids;
    dp.classList.toggle('is-on', hasKids && !!state.travauxVisiteDeep);
  }
}
function renderTravauxVisiteBody() {
  const body = document.getElementById('travauxvisitebody');
  const lotsEl = document.getElementById('travauxvisitelots');
  if (!body) return;
  body.innerHTML = '';
  if (lotsEl) lotsEl.innerHTML = '';
  if (!state.zones.length) {
    body.appendChild(travauxEmptyMsg('Aucune zone. Créez votre arborescence dans Données → Zones, puis renseignez le Carnet.'));
    return;
  }
  const target = getTravauxVisiteTarget();
  if (!target) return;

  // Périmètre : la zone et ses ancêtres (héritage descendant) ; en option
  // ses descendants, pour la vue d'ensemble d'un bâtiment ou d'un niveau.
  const hasKids = travauxZoneChildren(target.id).length > 0;
  const deep = hasKids && !!state.travauxVisiteDeep;
  const scope = travauxZoneAncestors(target.id);
  const descendants = new Set();
  if (deep) for (const zid of getDescendantZones(target.id)) if (zid !== target.id) { scope.add(zid); descendants.add(zid); }
  const q = travauxVisiteSearch.trim().toLowerCase();
  const applies = (p) => p.everywhere || Object.keys(p.zones || {}).some(z => scope.has(z));
  const viaSub = (p) => {
    if (p.everywhere) return '';
    const ids = Object.keys(p.zones || {});
    if (ids.some(z => !descendants.has(z) && scope.has(z))) return '';
    const sub = ids.find(z => descendants.has(z));
    return sub ? travauxZoneLabel(sub) : '';
  };

  // Ce qui est dû ici, avant filtre de lot (pour des compteurs stables).
  const all = [];
  for (const g of buildTravauxCCTP()) {
    const chaps = [];
    for (const chap of g.ouvrages) {
      const arts = chap.articles.filter(a => {
        const p = a.presc;
        if (!applies(p)) return false;
        if (travauxVisiteRemplOnly && !p.remplacement) return false;
        if (q && !travauxArticleHaystack(p, chap.ouvrage.name || '', g.name, a.num).includes(q)) return false;
        return true;
      });
      if (arts.length) chaps.push({ chap, arts });
    }
    if (chaps.length) all.push({ group: g, chaps });
  }
  const total = all.reduce((n, d) => n + d.chaps.reduce((m, c) => m + c.arts.length, 0), 0);

  // Synthèse : combien de prestations, réparties sur quels lots.
  const synth = document.createElement('div');
  synth.className = 'tv-synth';
  const strong = document.createElement('span');
  strong.className = 'tv-synth-count';
  strong.textContent = String(total);
  synth.appendChild(strong);
  const lbl = document.createElement('span');
  lbl.textContent = ' prestation' + (total > 1 ? 's' : '') + ' due' + (total > 1 ? 's' : '')
    + (deep ? ' ici et dans les sous-zones' : ' ici')
    + (all.length ? ' · ' + all.length + ' lot' + (all.length > 1 ? 's' : '') : '');
  synth.appendChild(lbl);
  body.appendChild(synth);

  if (lotsEl && all.length > 1) {
    const mk = (id, label, color, count, active) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tv-lot-chip' + (active ? ' is-on' : '');
      if (color) {
        const dot = document.createElement('span');
        dot.className = 'travaux-lot-dot';
        dot.style.background = color;
        btn.appendChild(dot);
      }
      const t = document.createElement('span');
      t.className = 'tv-lot-chip-name';
      t.textContent = label;
      btn.appendChild(t);
      const c = document.createElement('span');
      c.className = 'tv-lot-count';
      c.textContent = String(count);
      btn.appendChild(c);
      btn.addEventListener('click', () => { travauxVisiteLotId = id; renderTravauxVisiteBody(); });
      lotsEl.appendChild(btn);
    };
    mk('', 'Tous', '', total, !travauxVisiteLotId);
    for (const d of all) {
      const co = d.group.companyName;
      mk(d.group.id, d.group.num + ' · ' + d.group.name + (co ? ' — ' + co : ''), d.group.color,
        d.chaps.reduce((m, c) => m + c.arts.length, 0), travauxVisiteLotId === d.group.id);
    }
  }

  let shown = all;
  if (travauxVisiteLotId) {
    shown = all.filter(d => d.group.id === travauxVisiteLotId);
    if (!shown.length) { travauxVisiteLotId = ''; shown = all; }
  }
  if (!total) {
    body.appendChild(travauxEmptyMsg(
      (q || travauxVisiteRemplOnly) ? 'Aucune prestation ne correspond à ce filtre dans ce lieu.'
        : 'Rien de prescrit pour ce lieu' + (hasKids && !deep ? ' — essayez « Sous-zones ».' : '. Renseignez le Carnet.')));
    return;
  }
  for (const d of shown) body.appendChild(buildTravauxVisiteLotCard(d, viaSub, q));
}
function buildTravauxVisiteLotCard(d, viaSub, q) {
  const g = d.group;
  const card = document.createElement('section');
  card.className = 'travaux-visite-lot';
  card.style.setProperty('--lot-color', g.color);
  const nbArts = d.chaps.reduce((n, c) => n + c.arts.length, 0);

  const head = document.createElement('div');
  head.className = 'travaux-visite-lot-head';
  const dot = document.createElement('span');
  dot.className = 'travaux-lot-dot';
  dot.style.background = g.color;
  head.appendChild(dot);
  const nmBox = document.createElement('div');
  nmBox.className = 'travaux-visite-lot-id';
  const nm = document.createElement('span');
  nm.className = 'travaux-visite-lot-name';
  nm.textContent = 'LOT ' + g.num + ' · ' + g.name;
  nmBox.appendChild(nm);
  if (g.companyName) {
    const co = document.createElement('span');
    co.className = 'travaux-visite-lot-co';
    co.textContent = g.companyName;
    nmBox.appendChild(co);
  }
  head.appendChild(nmBox);
  const cnt = document.createElement('span');
  cnt.className = 'travaux-visite-lot-count';
  cnt.textContent = nbArts + ' prest.';
  head.appendChild(cnt);
  card.appendChild(head);

  for (const { chap, arts } of d.chaps) {
    const ch = document.createElement('div');
    ch.className = 'travaux-visite-chap';
    ch.textContent = chap.num + ' - ' + (chap.ouvrage.name || 'Chapitre').toUpperCase();
    card.appendChild(ch);
    for (const a of arts) card.appendChild(buildTravauxVisiteLine(a, viaSub, q));
  }
  return card;
}
function buildTravauxVisiteLine(a, viaSub, q) {
  const p = a.presc;
  const line = document.createElement('div');
  line.className = 'travaux-visite-line';

  const top = document.createElement('div');
  top.className = 'travaux-visite-line-top';
  const num = document.createElement('span');
  num.className = 'travaux-art-num travaux-art-num-sm';
  num.textContent = a.num;
  top.appendChild(num);
  const txt = document.createElement('span');
  txt.className = 'travaux-sheet-text';
  travauxHiliteInto(txt, travauxArticleTitle(p), q);
  top.appendChild(txt);
  if (p.remplacement) {
    const tag = document.createElement('span');
    tag.className = 'travaux-rempl-tag';
    tag.textContent = 'Remplacement';
    top.appendChild(tag);
  }
  line.appendChild(top);

  const via = viaSub ? viaSub(p) : '';
  if (via) {
    const v = document.createElement('div');
    v.className = 'travaux-visite-via';
    v.textContent = '↳ uniquement : ' + via;
    line.appendChild(v);
  }
  const chips = buildTravauxSpecChips(p, q);
  if (chips) line.appendChild(chips);

  const bodyTxt = travauxArticleBody(p).trim();
  const note = (p.localisation || '').trim();
  const hasDetail = !!(bodyTxt || note);
  const open = travauxVisiteExpandAll || travauxVisiteExpanded.has(p.id);

  const actions = document.createElement('div');
  actions.className = 'tv-line-actions';
  if (hasDetail) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tv-line-btn tv-line-more' + (open ? ' is-on' : '');
    more.textContent = open ? 'Masquer le détail' : 'Détail';
    more.addEventListener('click', () => {
      if (travauxVisiteExpanded.has(p.id)) travauxVisiteExpanded.delete(p.id);
      else travauxVisiteExpanded.add(p.id);
      travauxVisiteExpandAll = false;
      renderTravauxVisiteTools();
      renderTravauxVisiteBody();
    });
    actions.appendChild(more);
  }
  const goto = document.createElement('button');
  goto.type = 'button';
  goto.className = 'tv-line-btn';
  goto.textContent = 'Article complet →';
  goto.addEventListener('click', () => travauxGotoArticle(p.id));
  actions.appendChild(goto);
  line.appendChild(actions);

  if (hasDetail && open) {
    const det = document.createElement('div');
    det.className = 'tv-line-detail';
    if (bodyTxt) {
      const b = document.createElement('div');
      b.className = 'travaux-art-body';
      travauxHiliteInto(b, bodyTxt, q);
      det.appendChild(b);
    }
    if (note) {
      const n = document.createElement('div');
      n.className = 'travaux-loca';
      const h = document.createElement('div');
      h.className = 'travaux-loca-head';
      h.textContent = 'LOCALISATION :';
      n.appendChild(h);
      const t = document.createElement('p');
      t.className = 'travaux-loca-note';
      travauxHiliteInto(t, note, q);
      n.appendChild(t);
      det.appendChild(n);
    }
    line.appendChild(det);
  }
  return line;
}
// Fiche de visite en texte : ce que l'on envoie depuis le chantier.
function travauxVisiteAsText() {
  const target = getTravauxVisiteTarget();
  if (!target) return '';
  const lines = ['FICHE DE VISITE — ' + travauxZoneLabel(target.id), ''];
  const cards = document.querySelectorAll('#travauxvisitebody .travaux-visite-lot');
  if (!cards.length) return lines.join('\n') + 'Aucune prestation due.';
  // On repart des données (et non du DOM) pour inclure les détails masqués.
  const scope = travauxZoneAncestors(target.id);
  const deep = !!state.travauxVisiteDeep && travauxZoneChildren(target.id).length > 0;
  if (deep) for (const zid of getDescendantZones(target.id)) scope.add(zid);
  const q = travauxVisiteSearch.trim().toLowerCase();
  for (const g of buildTravauxCCTP()) {
    if (travauxVisiteLotId && g.id !== travauxVisiteLotId) continue;
    const chunks = [];
    for (const chap of g.ouvrages) {
      const arts = chap.articles.filter(a => {
        const p = a.presc;
        if (!(p.everywhere || Object.keys(p.zones || {}).some(z => scope.has(z)))) return false;
        if (travauxVisiteRemplOnly && !p.remplacement) return false;
        if (q && !travauxArticleHaystack(p, chap.ouvrage.name || '', g.name, a.num).includes(q)) return false;
        return true;
      });
      if (!arts.length) continue;
      chunks.push('  ' + chap.num + ' - ' + (chap.ouvrage.name || 'Chapitre').toUpperCase());
      for (const a of arts) chunks.push('    ' + travauxArticleAsText(a).split('\n').join('\n    '));
    }
    if (!chunks.length) continue;
    lines.push('LOT ' + g.num + ' · ' + g.name + (g.companyName ? ' — ' + g.companyName : ''));
    lines.push(chunks.join('\n'), '');
  }
  return lines.join('\n');
}

// ---------------------- Sélecteur de lieu (modale arborescente) ----------------------
let travauxZoneModalFilter = '';
function openTravauxZoneModal() {
  const m = document.getElementById('travauxzonemodal');
  if (!m) return;
  travauxZoneModalFilter = '';
  // On déplie le chemin du lieu courant : la sélection doit être visible
  // dès l'ouverture, même si la branche avait été repliée ailleurs.
  const cur = getTravauxVisiteTarget();
  if (cur) expandZonePickerPath(cur.id);
  const inp = document.getElementById('travauxzonemodalsearch');
  if (inp) inp.value = '';
  m.hidden = false;
  renderTravauxZoneModal();
  if (inp) requestAnimationFrame(() => inp.focus());
}
function closeTravauxZoneModal() {
  const m = document.getElementById('travauxzonemodal');
  if (m) m.hidden = true;
}
function renderTravauxZoneModal() {
  const list = document.getElementById('travauxzonepicklist');
  if (!list) return;
  list.innerHTML = '';
  const currentId = (getTravauxVisiteTarget() || {}).id;
  list.appendChild(buildZonePickerFoldBar(renderTravauxZoneModal));
  list.appendChild(buildZonePickerTree({
    mode: 'select',
    selectedId: currentId,
    filter: travauxZoneModalFilter,
    badge: (z) => {
      const n = travauxCountPrescriptionsForZone(z.id);
      return n ? String(n) : null;
    },
    onSelect: (z) => { closeTravauxZoneModal(); travauxGotoZone(z.id); },
    rerender: renderTravauxZoneModal,
  }));
}
// Nombre de prestations dues dans une zone (héritage compris) — affiché
// dans le sélecteur pour repérer les lieux chargés.
function travauxCountPrescriptionsForZone(zoneId) {
  const scope = travauxZoneAncestors(zoneId);
  let n = 0;
  for (const p of getTravauxPrescriptions()) {
    if (p.everywhere || Object.keys(p.zones || {}).some(z => scope.has(z))) n++;
  }
  return n;
}

// ---------------------- Vue Carnet (éditeur de CCTP) ----------------------
// Interface maître / détail : à gauche la structure complète du CCTP
// (lots → chapitres → articles), à droite l'éditeur du SEUL élément
// sélectionné. On passe ainsi d'un mur de formulaires empilés à un écran
// où l'on ne voit que ce que l'on modifie.
// Sur mobile les deux panneaux se succèdent (structure ⇄ éditeur).
//
// Les états ci-dessous sont des états d'écran : ni persistés, ni
// synchronisés — chaque appareil garde sa propre navigation.
let travauxCarnetSel = null;            // { type: 'chapitre' | 'article', id }
let travauxCarnetFilter = '';           // filtre de la structure
let travauxCarnetCollapsed = new Set(); // lots / chapitres repliés
let travauxCarnetEditing = false;       // mobile : éditeur au premier plan
let travauxZonesOpen = false;           // panneau « zones » déplié
let travauxZoneFilter = '';             // filtre de l'arbre des zones

const SVG_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"/></svg>';
const SVG_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>';
const SVG_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/></svg>';

// État de complétude d'un article — signalé par une pastille dans la
// structure, pour repérer d'un coup d'œil ce qui reste à rédiger.
function travauxArticleStatus(p) {
  if (!(p.title || '').trim() && !(p.text || '').trim()) return 'vide';
  if (!p.everywhere && !Object.keys(p.zones || {}).length && !(p.localisation || '').trim()) return 'loca';
  return 'ok';
}
const TRAVAUX_STATUS_LABEL = {
  vide: 'Article encore vide',
  loca: 'Localisation non renseignée',
  ok: 'Article complet',
};

// ======================= Réorganisation =======================
// L'ordre des tableaux fixe la numérotation du CCTP : déplacer un élément,
// c'est le déplacer réellement dans state.travauxOuvrages / …Prescriptions.
function travauxSiblingsOfOuvrage(o) {
  return getTravauxOuvrages().filter(x => (x.lotId || '') === (o.lotId || ''));
}
function moveTravauxOuvrageStep(id, dir) {
  const arr = getTravauxOuvrages();
  const o = getTravauxOuvrage(id);
  if (!o) return;
  const sibs = travauxSiblingsOfOuvrage(o);
  const j = sibs.indexOf(o) + dir;
  if (j < 0 || j >= sibs.length) return;
  const a = arr.indexOf(o), b = arr.indexOf(sibs[j]);
  arr[a] = sibs[j]; arr[b] = o;
  save();
  renderTravauxCarnet();
}
function moveTravauxPrescriptionStep(id, dir) {
  const arr = getTravauxPrescriptions();
  const p = getTravauxPrescription(id);
  if (!p) return;
  const sibs = getPrescriptionsForOuvrage(p.ouvrageId);
  const j = sibs.indexOf(p) + dir;
  if (j < 0 || j >= sibs.length) return;
  const a = arr.indexOf(p), b = arr.indexOf(sibs[j]);
  arr[a] = sibs[j]; arr[b] = p;
  save();
  renderTravauxCarnet();
}
// Glisser-déposer : on retire l'élément puis on le réinsère avant (ou
// après) la cible. Le déplacement reste confiné à son parent.
function dropTravauxOuvrage(dragId, targetId, after) {
  if (dragId === targetId) return;
  const arr = getTravauxOuvrages();
  const d = getTravauxOuvrage(dragId), t = getTravauxOuvrage(targetId);
  if (!d || !t || (d.lotId || '') !== (t.lotId || '')) return;
  arr.splice(arr.indexOf(d), 1);
  arr.splice(arr.indexOf(t) + (after ? 1 : 0), 0, d);
  save();
  renderTravauxCarnet();
}
function dropTravauxPrescription(dragId, targetId, after) {
  if (dragId === targetId) return;
  const arr = getTravauxPrescriptions();
  const d = getTravauxPrescription(dragId), t = getTravauxPrescription(targetId);
  if (!d || !t || d.ouvrageId !== t.ouvrageId) return;
  arr.splice(arr.indexOf(d), 1);
  arr.splice(arr.indexOf(t) + (after ? 1 : 0), 0, d);
  save();
  renderTravauxCarnet();
}
// Dupliquer un article : le gain de temps décisif quand on rédige un CCTP,
// où deux articles voisins ne diffèrent souvent que d'une ligne.
function duplicateTravauxPrescription(id) {
  const arr = getTravauxPrescriptions();
  const p = getTravauxPrescription(id);
  if (!p) return;
  const copy = JSON.parse(JSON.stringify(p));
  copy.id = 'tp_' + uid();
  copy.specs = (copy.specs || []).map(s => ({ ...s, id: 'sp_' + uid() }));
  if ((copy.title || '').trim()) copy.title = copy.title + ' (copie)';
  arr.splice(arr.indexOf(p) + 1, 0, copy);
  save();
  travauxCarnetSel = { type: 'article', id: copy.id };
  renderTravauxCarnet();
  requestAnimationFrame(() => {
    const el = document.getElementById('carnet-field-title');
    if (el) { el.focus(); el.select(); }
  });
}

// ======================= Sélection & navigation =======================
function travauxCarnetNormalizeSelection() {
  const sel = travauxCarnetSel;
  if (sel && sel.type === 'article' && getTravauxPrescription(sel.id)) return;
  if (sel && sel.type === 'chapitre' && getTravauxOuvrage(sel.id)) return;
  const p = getTravauxPrescriptions()[0];
  if (p) { travauxCarnetSel = { type: 'article', id: p.id }; return; }
  const o = getTravauxOuvrages()[0];
  travauxCarnetSel = o ? { type: 'chapitre', id: o.id } : null;
}
function selectTravauxCarnet(type, id, focusSel) {
  travauxCarnetSel = { type, id };
  travauxCarnetEditing = true;
  travauxZonesOpen = false;
  travauxZoneFilter = '';
  renderTravauxCarnetTree();
  renderTravauxCarnetEditor();
  travauxCarnetSyncPane();
  if (focusSel) requestAnimationFrame(() => {
    const el = document.querySelector(focusSel);
    if (el) { el.focus(); if (el.select) el.select(); }
  });
}
function travauxCarnetSyncPane() {
  const wrap = document.querySelector('.carnet');
  if (wrap) wrap.classList.toggle('is-editing', travauxCarnetEditing);
}
function travauxCarnetBackToTree() {
  travauxCarnetEditing = false;
  travauxCarnetSyncPane();
}
function toggleTravauxCarnetNode(id) {
  if (travauxCarnetCollapsed.has(id)) travauxCarnetCollapsed.delete(id);
  else travauxCarnetCollapsed.add(id);
  renderTravauxCarnetTree();
}
function toggleTravauxCarnetFoldAll() {
  const groups = buildTravauxCCTP();
  const ids = [];
  for (const g of groups) { ids.push('lot:' + g.id); for (const c of g.ouvrages) ids.push('chap:' + c.ouvrage.id); }
  const allFolded = ids.length > 0 && ids.every(i => travauxCarnetCollapsed.has(i));
  travauxCarnetCollapsed = allFolded ? new Set() : new Set(ids);
  renderTravauxCarnetTree();
}

// ======================= Rendu : ossature =======================
function renderTravauxCarnet() {
  const body = document.getElementById('travauxcarnetbody');
  if (!body) return;
  if (!body.querySelector('.carnet')) buildTravauxCarnetSkeleton(body);
  travauxCarnetNormalizeSelection();
  renderTravauxCarnetTree();
  renderTravauxCarnetEditor();
  travauxCarnetSyncPane();
}
function buildTravauxCarnetSkeleton(body) {
  body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'carnet';
  // L'ossature n'est construite qu'une fois : le champ de filtre n'est
  // jamais recréé, donc la saisie ne perd jamais le focus.
  wrap.innerHTML =
    '<aside class="carnet-nav">' +
      '<div class="carnet-nav-head">' +
        '<div class="carnet-search">' + SVG_SEARCH +
          '<input type="search" id="carnetfilter" placeholder="Filtrer la structure…" autocomplete="off">' +
        '</div>' +
        '<button type="button" class="carnet-fold" id="carnetfold" aria-label="Tout replier ou déplier">⇕</button>' +
      '</div>' +
      '<div class="carnet-tree" id="carnettree"></div>' +
    '</aside>' +
    '<section class="carnet-editor" id="carneteditor"></section>';
  body.appendChild(wrap);
  const input = wrap.querySelector('#carnetfilter');
  input.addEventListener('input', () => { travauxCarnetFilter = input.value; renderTravauxCarnetTree(); });
  wrap.querySelector('#carnetfold').addEventListener('click', toggleTravauxCarnetFoldAll);
}

// ======================= Rendu : structure (panneau gauche) =======================
function renderTravauxCarnetTree() {
  const tree = document.getElementById('carnettree');
  if (!tree) return;
  tree.innerHTML = '';
  const q = travauxCarnetFilter.trim().toLowerCase();
  const groups = buildTravauxCCTP();
  const lots = getWorkBatches();

  if (!lots.length && !getTravauxOuvrages().length) {
    tree.appendChild(travauxEmptyMsg('Commencez par créer vos lots dans Données → Lots, puis ajoutez ici un chapitre et ses articles.'));
  }

  let shown = 0;
  for (const g of groups) {
    const lotHit = !q || g.name.toLowerCase().includes(q);
    const chaps = [];
    for (const chap of g.ouvrages) {
      const chapHit = lotHit || (chap.ouvrage.name || '').toLowerCase().includes(q);
      const arts = chapHit ? chap.articles
        : chap.articles.filter(a => travauxArticleHaystack(a.presc, chap.ouvrage.name || '', g.name, a.num).includes(q));
      if (chapHit || arts.length) chaps.push({ chap, arts });
    }
    if (q && !lotHit && !chaps.length) continue;
    shown++;
    tree.appendChild(buildCarnetLotNode(g, chaps, !!q));
  }
  if (q && !shown) tree.appendChild(travauxEmptyMsg('Aucun résultat pour « ' + travauxCarnetFilter.trim() + ' ».'));

  // Un point d'entrée « hors lot » tant qu'aucun chapitre orphelin n'existe.
  if (!q && !groups.some(g => g.isOrphan)) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'carnet-add carnet-add-lot';
    add.textContent = '+ Chapitre hors lot';
    add.addEventListener('click', () => addTravauxOuvrage(''));
    tree.appendChild(add);
  }
}
function buildCarnetLotNode(g, chaps, filtering) {
  const key = 'lot:' + g.id;
  const folded = !filtering && travauxCarnetCollapsed.has(key);
  const node = document.createElement('div');
  node.className = 'carnet-lot';
  node.style.setProperty('--lot-color', g.color);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'carnet-lot-row' + (folded ? ' is-folded' : '');
  row.innerHTML = '<span class="carnet-caret"></span>';
  const dot = document.createElement('span');
  dot.className = 'travaux-lot-dot';
  dot.style.background = g.color;
  row.appendChild(dot);
  const nm = document.createElement('span');
  nm.className = 'carnet-lot-name';
  nm.textContent = g.num + ' · ' + g.name;
  row.appendChild(nm);
  const cnt = document.createElement('span');
  cnt.className = 'carnet-count';
  cnt.textContent = String(g.ouvrages.reduce((n, c) => n + c.articles.length, 0));
  row.appendChild(cnt);
  row.addEventListener('click', () => toggleTravauxCarnetNode(key));
  node.appendChild(row);

  if (folded) return node;
  const bodyEl = document.createElement('div');
  bodyEl.className = 'carnet-lot-body';
  for (const { chap, arts } of chaps) bodyEl.appendChild(buildCarnetChapNode(chap, arts, filtering));
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'carnet-add';
  add.textContent = '+ Chapitre';
  add.addEventListener('click', () => addTravauxOuvrage(g.isOrphan ? '' : g.id));
  bodyEl.appendChild(add);
  node.appendChild(bodyEl);
  return node;
}
function buildCarnetChapNode(chap, arts, filtering) {
  const o = chap.ouvrage;
  const key = 'chap:' + o.id;
  const folded = !filtering && travauxCarnetCollapsed.has(key);
  const selected = travauxCarnetSel && travauxCarnetSel.type === 'chapitre' && travauxCarnetSel.id === o.id;

  const node = document.createElement('div');
  node.className = 'carnet-chap';

  const row = document.createElement('div');
  row.className = 'carnet-chap-row' + (folded ? ' is-folded' : '') + (selected ? ' is-sel' : '');
  row.dataset.chapId = o.id;
  row.draggable = true;
  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'carnet-caret-btn';
  caret.setAttribute('aria-label', folded ? 'Déplier' : 'Replier');
  caret.innerHTML = '<span class="carnet-caret"></span>';
  caret.addEventListener('click', (e) => { e.stopPropagation(); toggleTravauxCarnetNode(key); });
  row.appendChild(caret);
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'carnet-chap-open';
  const num = document.createElement('span');
  num.className = 'carnet-num';
  num.textContent = chap.num;
  open.appendChild(num);
  const nm = document.createElement('span');
  nm.className = 'carnet-chap-name';
  nm.textContent = o.name || 'Chapitre sans nom';
  if (!o.name) nm.classList.add('is-empty');
  open.appendChild(nm);
  open.addEventListener('click', () => selectTravauxCarnet('chapitre', o.id));
  row.appendChild(open);
  const cnt = document.createElement('span');
  cnt.className = 'carnet-count';
  cnt.textContent = String(chap.articles.length);
  row.appendChild(cnt);
  travauxAttachDrag(row, o.id, 'chap', dropTravauxOuvrage);
  node.appendChild(row);

  if (folded) return node;
  const list = document.createElement('div');
  list.className = 'carnet-art-list';
  for (const a of arts) list.appendChild(buildCarnetArtRow(a));
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'carnet-add carnet-add-art';
  add.textContent = '+ Article';
  add.addEventListener('click', () => addTravauxPrescription(o.id));
  list.appendChild(add);
  node.appendChild(list);
  return node;
}
function buildCarnetArtRow(a) {
  const p = a.presc;
  const selected = travauxCarnetSel && travauxCarnetSel.type === 'article' && travauxCarnetSel.id === p.id;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'carnet-art-row' + (selected ? ' is-sel' : '');
  row.dataset.artId = p.id;
  row.draggable = true;
  const num = document.createElement('span');
  num.className = 'carnet-num';
  num.textContent = a.num;
  row.appendChild(num);
  const t = document.createElement('span');
  t.className = 'carnet-art-title';
  t.textContent = travauxArticleTitle(p);
  row.appendChild(t);
  const st = travauxArticleStatus(p);
  const dot = document.createElement('span');
  dot.className = 'carnet-status carnet-status-' + st;
  dot.title = TRAVAUX_STATUS_LABEL[st];
  row.appendChild(dot);
  row.addEventListener('click', () => selectTravauxCarnet('article', p.id));
  travauxAttachDrag(row, p.id, 'art', dropTravauxPrescription);
  return row;
}
// Glisser-déposer natif : réservé au pointeur (PC). Sur tactile, les
// flèches ▲▼ de l'éditeur font le même travail.
let _travauxDrag = null;
function travauxAttachDrag(el, id, kind, dropFn) {
  el.addEventListener('dragstart', (e) => {
    _travauxDrag = { id, kind };
    el.classList.add('is-dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }
  });
  el.addEventListener('dragend', () => { el.classList.remove('is-dragging'); travauxClearDropMarks(); _travauxDrag = null; });
  el.addEventListener('dragover', (e) => {
    if (!_travauxDrag || _travauxDrag.kind !== kind || _travauxDrag.id === id) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const after = (e.clientY - r.top) > r.height / 2;
    travauxClearDropMarks();
    el.classList.add(after ? 'is-drop-after' : 'is-drop-before');
  });
  el.addEventListener('drop', (e) => {
    if (!_travauxDrag || _travauxDrag.kind !== kind) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const after = (e.clientY - r.top) > r.height / 2;
    const dragId = _travauxDrag.id;
    travauxClearDropMarks();
    _travauxDrag = null;
    dropFn(dragId, id, after);
  });
}
function travauxClearDropMarks() {
  document.querySelectorAll('.is-drop-before, .is-drop-after')
    .forEach(el => el.classList.remove('is-drop-before', 'is-drop-after'));
}

// ======================= Rendu : éditeur (panneau droit) =======================
function renderTravauxCarnetEditor() {
  const host = document.getElementById('carneteditor');
  if (!host) return;
  host.innerHTML = '';
  const sel = travauxCarnetSel;
  if (!sel) {
    host.appendChild(buildCarnetPlaceholder());
    return;
  }
  if (sel.type === 'chapitre') host.appendChild(buildCarnetChapEditor(getTravauxOuvrage(sel.id)));
  else host.appendChild(buildCarnetArtEditor(getTravauxPrescription(sel.id)));
}
function buildCarnetPlaceholder() {
  const box = document.createElement('div');
  box.className = 'carnet-placeholder';
  box.innerHTML =
    '<div class="carnet-placeholder-icon">📖</div>' +
    '<p class="carnet-placeholder-title">Votre CCTP est vide</p>' +
    '<p class="carnet-placeholder-text">Ajoutez un chapitre dans un lot (colonne de gauche), puis ses articles. ' +
    'La numérotation 1.1.1 se met à jour toute seule.</p>';
  return box;
}
// Bandeau commun : retour (mobile), fil d'Ariane, actions.
function buildCarnetHead(crumbParts, actions) {
  const head = document.createElement('header');
  head.className = 'carnet-head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'carnet-back';
  back.textContent = '‹ Structure';
  back.addEventListener('click', travauxCarnetBackToTree);
  head.appendChild(back);
  const crumb = document.createElement('div');
  crumb.className = 'carnet-crumb';
  crumbParts.forEach((part, i) => {
    if (i) { const s = document.createElement('span'); s.className = 'carnet-crumb-sep'; s.textContent = '›'; crumb.appendChild(s); }
    const s = document.createElement('span');
    s.textContent = part;
    crumb.appendChild(s);
  });
  head.appendChild(crumb);
  const bar = document.createElement('div');
  bar.className = 'carnet-actions';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'carnet-action' + (a.danger ? ' is-danger' : '');
    b.setAttribute('aria-label', a.label);
    b.title = a.label;
    if (a.icon) b.innerHTML = a.icon; else b.textContent = a.text;
    b.addEventListener('click', a.onClick);
    bar.appendChild(b);
  }
  head.appendChild(bar);
  return head;
}
function carnetSection(title, hint) {
  const sec = document.createElement('section');
  sec.className = 'carnet-card';
  const h = document.createElement('div');
  h.className = 'carnet-card-head';
  const t = document.createElement('span');
  t.className = 'carnet-card-title';
  t.textContent = title;
  h.appendChild(t);
  if (hint) {
    const s = document.createElement('span');
    s.className = 'carnet-card-hint';
    s.textContent = hint;
    h.appendChild(s);
  }
  sec.appendChild(h);
  return sec;
}

// ----- Éditeur de chapitre -----
function buildCarnetChapEditor(o) {
  const wrap = document.createElement('div');
  if (!o) return wrap;
  const chap = travauxFindChap(o.id);
  const lotName = chap ? chap.lotName : 'Hors lot';
  wrap.appendChild(buildCarnetHead(['LOT ' + (chap ? chap.lotNum : '?') + ' · ' + lotName, 'Chapitre ' + (chap ? chap.num : '')], [
    { label: 'Monter le chapitre', text: '▲', onClick: () => moveTravauxOuvrageStep(o.id, -1) },
    { label: 'Descendre le chapitre', text: '▼', onClick: () => moveTravauxOuvrageStep(o.id, 1) },
    { label: 'Supprimer le chapitre', icon: SVG_TRASH, danger: true, onClick: () => deleteTravauxOuvrage(o.id) },
  ]));

  const idSec = carnetSection('Chapitre', 'Une famille d\'ouvrages : Cloisons, Peintures, Portes…');
  const nm = document.createElement('input');
  nm.type = 'text';
  nm.id = 'carnet-field-chap';
  nm.className = 'carnet-input carnet-input-title';
  nm.placeholder = 'Nom du chapitre (ex. CLOISONS)';
  nm.maxLength = 80;
  nm.value = o.name || '';
  nm.addEventListener('input', () => {
    renameTravauxOuvrage(o.id, nm.value);
    const row = document.querySelector('.carnet-chap-row[data-chap-id="' + cssEscape(o.id) + '"] .carnet-chap-name');
    if (row) { row.textContent = nm.value || 'Chapitre sans nom'; row.classList.toggle('is-empty', !nm.value); }
  });
  idSec.appendChild(nm);
  const lotLbl = document.createElement('div');
  lotLbl.className = 'carnet-label';
  lotLbl.textContent = 'Lot de rattachement';
  idSec.appendChild(lotLbl);
  const sel = document.createElement('select');
  sel.className = 'carnet-input carnet-select';
  sel.appendChild(new Option('Hors lot', ''));
  for (const lot of getWorkBatches()) sel.appendChild(new Option(lot.name || 'Lot sans nom', lot.id));
  sel.value = o.lotId || '';
  sel.addEventListener('change', () => setTravauxOuvrageLot(o.id, sel.value));
  idSec.appendChild(sel);
  wrap.appendChild(idSec);

  const arts = getPrescriptionsForOuvrage(o.id);
  const listSec = carnetSection('Articles', arts.length + ' article' + (arts.length > 1 ? 's' : ''));
  if (!arts.length) {
    const e = document.createElement('p');
    e.className = 'carnet-hint';
    e.textContent = 'Aucun article dans ce chapitre.';
    listSec.appendChild(e);
  }
  for (const p of arts) {
    const a = travauxFindArticle(p.id);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'carnet-mini-row';
    const n = document.createElement('span');
    n.className = 'carnet-num';
    n.textContent = a ? a.num : '';
    row.appendChild(n);
    const t = document.createElement('span');
    t.textContent = travauxArticleTitle(p);
    row.appendChild(t);
    row.addEventListener('click', () => selectTravauxCarnet('article', p.id));
    listSec.appendChild(row);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'carnet-add';
  add.textContent = '+ Article';
  add.addEventListener('click', () => addTravauxPrescription(o.id));
  listSec.appendChild(add);
  wrap.appendChild(listSec);
  return wrap;
}

// ----- Éditeur d'article -----
function buildCarnetArtEditor(p) {
  const wrap = document.createElement('div');
  if (!p) return wrap;
  const a = travauxFindArticle(p.id);
  const num = a ? a.num : '';
  wrap.appendChild(buildCarnetHead(
    ['LOT ' + (a ? a.lotNum : '?') + ' · ' + (a ? a.lotName : ''), a ? (a.chapName || 'Chapitre') : '', 'Article ' + num],
    [
      { label: 'Monter l\'article', text: '▲', onClick: () => moveTravauxPrescriptionStep(p.id, -1) },
      { label: 'Descendre l\'article', text: '▼', onClick: () => moveTravauxPrescriptionStep(p.id, 1) },
      { label: 'Dupliquer l\'article', icon: SVG_COPY, onClick: () => duplicateTravauxPrescription(p.id) },
      { label: 'Supprimer l\'article', icon: SVG_TRASH, danger: true, onClick: () => deleteTravauxPrescription(p.id) },
    ]));

  // 1) Intitulé
  const idSec = carnetSection('Intitulé de l\'article', num);
  const ti = document.createElement('input');
  ti.type = 'text';
  ti.id = 'carnet-field-title';
  ti.className = 'carnet-input carnet-input-title';
  ti.placeholder = 'Ex. PEINTURE DES PORTES INTÉRIEURES';
  ti.maxLength = 120;
  ti.value = p.title || '';
  ti.addEventListener('input', () => {
    setTravauxPrescriptionField(p.id, 'title', ti.value);
    carnetRefreshArtRow(p);
  });
  idSec.appendChild(ti);
  const remplLbl = document.createElement('label');
  remplLbl.className = 'carnet-switch' + (p.remplacement ? ' is-on' : '');
  const remplCb = document.createElement('input');
  remplCb.type = 'checkbox';
  remplCb.checked = !!p.remplacement;
  remplCb.addEventListener('change', () => {
    p.remplacement = remplCb.checked;
    save();
    remplLbl.classList.toggle('is-on', remplCb.checked);
  });
  remplLbl.appendChild(remplCb);
  const remplTxt = document.createElement('span');
  remplTxt.textContent = 'Remplacement (dépose + pose de neuf)';
  remplLbl.appendChild(remplTxt);
  idSec.appendChild(remplLbl);
  wrap.appendChild(idSec);

  // 2) Descriptif
  const dSec = carnetSection('Descriptif', 'Le corps de l\'article, tel qu\'il sera lu');
  const ta = document.createElement('textarea');
  ta.className = 'carnet-input carnet-textarea';
  ta.rows = 4;
  ta.placeholder = 'Mise en œuvre comprenant :\n- …\n- …';
  ta.value = p.text || '';
  const grow = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
  ta.addEventListener('input', () => { grow(); setTravauxPrescriptionField(p.id, 'text', ta.value); carnetRefreshArtRow(p); });
  setTimeout(grow, 0);
  dSec.appendChild(ta);
  wrap.appendChild(dSec);

  // 3) Détails techniques
  const sSec = carnetSection('Détails techniques', 'Couleur, référence, performance…');
  const specsWrap = document.createElement('div');
  specsWrap.className = 'carnet-specs';
  for (const s of (p.specs || [])) specsWrap.appendChild(buildCarnetSpecRow(p, s));
  sSec.appendChild(specsWrap);
  const addSpec = document.createElement('button');
  addSpec.type = 'button';
  addSpec.className = 'carnet-add carnet-add-inline';
  addSpec.textContent = '+ Détail';
  addSpec.addEventListener('click', () => {
    if (!Array.isArray(p.specs)) p.specs = [];
    const s = { id: 'sp_' + uid(), label: '', value: '' };
    p.specs.push(s);
    save();
    const row = buildCarnetSpecRow(p, s);
    specsWrap.appendChild(row);
    const inp = row.querySelector('input');
    if (inp) inp.focus();
  });
  sSec.appendChild(addSpec);
  wrap.appendChild(sSec);

  // 4) Localisation
  const lSec = carnetSection('Localisation', 'Le « LOCALISATION : » du CCTP');
  const loc = document.createElement('textarea');
  loc.className = 'carnet-input carnet-textarea';
  loc.rows = 2;
  loc.placeholder = 'Ex. : entre la loge et le sas, suivant légende des plans architecte.';
  loc.value = p.localisation || '';
  const growLoc = () => { loc.style.height = 'auto'; loc.style.height = (loc.scrollHeight + 2) + 'px'; };
  loc.addEventListener('input', () => { growLoc(); setTravauxPrescriptionField(p.id, 'localisation', loc.value); carnetRefreshArtRow(p); });
  setTimeout(growLoc, 0);
  lSec.appendChild(loc);
  lSec.appendChild(buildCarnetZonePanel(p));
  wrap.appendChild(lSec);
  return wrap;
}
function buildCarnetSpecRow(p, s) {
  const row = document.createElement('div');
  row.className = 'carnet-spec-row';
  const lab = document.createElement('input');
  lab.type = 'text';
  lab.className = 'carnet-input carnet-spec-label';
  lab.placeholder = 'Détail (ex. Couleur)';
  lab.maxLength = 30;
  lab.value = s.label || '';
  lab.addEventListener('input', () => setTravauxSpecField(p.id, s.id, 'label', lab.value));
  row.appendChild(lab);
  const val = document.createElement('input');
  val.type = 'text';
  val.className = 'carnet-input carnet-spec-value';
  val.placeholder = 'Valeur (ex. RAL 9007)';
  val.maxLength = 60;
  val.value = s.value || '';
  val.addEventListener('input', () => setTravauxSpecField(p.id, s.id, 'value', val.value));
  row.appendChild(val);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'carnet-spec-del';
  del.setAttribute('aria-label', 'Supprimer ce détail');
  del.textContent = '×';
  del.addEventListener('click', () => {
    p.specs = (p.specs || []).filter(x => x.id !== s.id);
    save();
    row.remove();
  });
  row.appendChild(del);
  return row;
}
// Met à jour la ligne correspondante dans la structure sans tout redessiner
// (le titre et la pastille de complétude suivent la frappe).
function carnetRefreshArtRow(p) {
  const row = document.querySelector('.carnet-art-row[data-art-id="' + cssEscape(p.id) + '"]');
  if (!row) return;
  const t = row.querySelector('.carnet-art-title');
  if (t) t.textContent = travauxArticleTitle(p);
  const dot = row.querySelector('.carnet-status');
  if (dot) {
    const st = travauxArticleStatus(p);
    dot.className = 'carnet-status carnet-status-' + st;
    dot.title = TRAVAUX_STATUS_LABEL[st];
  }
}

// ----- Sélecteur de zones : résumé + arbre dépliable -----
function buildCarnetZonePanel(p) {
  const panel = document.createElement('div');
  panel.className = 'carnet-zones';

  const bar = document.createElement('div');
  bar.className = 'carnet-zones-bar';
  const summary = document.createElement('div');
  summary.className = 'carnet-zones-summary';
  bar.appendChild(summary);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'carnet-zones-toggle';
  bar.appendChild(toggle);
  panel.appendChild(bar);

  const treeBox = document.createElement('div');
  treeBox.className = 'carnet-zones-tree';
  panel.appendChild(treeBox);

  const refreshSummary = () => {
    summary.innerHTML = '';
    if (p.everywhere) {
      const chip = document.createElement('span');
      chip.className = 'carnet-zone-chip is-all';
      chip.textContent = 'Partout sur le chantier';
      summary.appendChild(chip);
      return;
    }
    const ids = travauxArticleZoneIds(p);
    if (!ids.length) {
      const e = document.createElement('span');
      e.className = 'carnet-zones-empty';
      e.textContent = 'Aucune zone sélectionnée';
      summary.appendChild(e);
      return;
    }
    for (const id of ids.slice(0, 4)) {
      const chip = document.createElement('span');
      chip.className = 'carnet-zone-chip';
      chip.textContent = travauxZoneLabel(id);
      summary.appendChild(chip);
    }
    if (ids.length > 4) {
      const more = document.createElement('span');
      more.className = 'carnet-zone-chip is-more';
      more.textContent = '+' + (ids.length - 4);
      summary.appendChild(more);
    }
  };
  const refreshOpen = () => {
    toggle.textContent = travauxZonesOpen ? 'Terminer' : 'Choisir les zones';
    toggle.classList.toggle('is-on', travauxZonesOpen);
    treeBox.hidden = !travauxZonesOpen;
    if (travauxZonesOpen) renderCarnetZoneTree(p, treeBox, refreshSummary);
  };
  toggle.addEventListener('click', () => {
    travauxZonesOpen = !travauxZonesOpen;
    // Idem : on ouvre les branches des zones déjà cochées.
    if (travauxZonesOpen) for (const zid of Object.keys(p.zones || {})) expandZonePickerPath(zid);
    refreshOpen();
    if (travauxZonesOpen) requestAnimationFrame(() => treeBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  });
  refreshSummary();
  refreshOpen();
  return panel;
}
function renderCarnetZoneTree(p, box, onChange) {
  box.innerHTML = '';

  // « Partout » court-circuite l'arbre : inutile de l'afficher.
  const every = document.createElement('label');
  every.className = 'carnet-switch carnet-zone-every' + (p.everywhere ? ' is-on' : '');
  const everyCb = document.createElement('input');
  everyCb.type = 'checkbox';
  everyCb.checked = !!p.everywhere;
  everyCb.addEventListener('change', () => {
    p.everywhere = everyCb.checked;
    save();
    carnetRefreshArtRow(p);
    renderCarnetZoneTree(p, box, onChange);
    onChange();
  });
  every.appendChild(everyCb);
  const everyTxt = document.createElement('span');
  everyTxt.textContent = 'Partout — toutes les zones du chantier';
  every.appendChild(everyTxt);
  box.appendChild(every);
  if (p.everywhere) return;

  if (!state.zones.length) {
    const hint = document.createElement('p');
    hint.className = 'carnet-hint';
    hint.textContent = 'Créez vos zones dans Données → Zones.';
    box.appendChild(hint);
    return;
  }

  const search = document.createElement('div');
  search.className = 'carnet-search carnet-zone-search';
  search.innerHTML = SVG_SEARCH;
  const inp = document.createElement('input');
  inp.type = 'search';
  inp.placeholder = 'Trouver une zone…';
  inp.value = travauxZoneFilter;
  inp.addEventListener('input', () => {
    travauxZoneFilter = inp.value;
    renderCarnetZoneTree(p, box, onChange);
    const again = box.querySelector('.carnet-zone-search input');
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });
  search.appendChild(inp);
  box.appendChild(search);

  const checked = p.zones || {};
  const covered = travauxCoveringAncestors(checked);
  box.appendChild(buildZonePickerFoldBar(() => renderCarnetZoneTree(p, box, onChange)));
  const tree = buildZonePickerTree({
    mode: 'check',
    filter: travauxZoneFilter,
    isChecked: (z) => !!checked[z.id],
    isInherited: (z) => covered.has(z.id),
    onToggle: (z, on) => {
      checkedSet(p, z.id, on);
      carnetRefreshArtRow(p);
      renderCarnetZoneTree(p, box, onChange);
      onChange();
    },
    rerender: () => renderCarnetZoneTree(p, box, onChange),
  });
  box.appendChild(tree);
  const note = document.createElement('p');
  note.className = 'carnet-hint';
  note.textContent = 'Cocher un bâtiment ou un niveau couvre automatiquement toutes ses sous-zones.';
  box.appendChild(note);
}
function checkedSet(p, zoneId, on) {
  if (!p.zones || typeof p.zones !== 'object') p.zones = {};
  if (on) {
    p.zones[zoneId] = true;
    // Cocher un parent rend ses descendants redondants : on les retire pour
    // que la localisation reste lisible (« Bâtiment A » et non « Bâtiment A »
    // + « Bâtiment A › R+1 › Logement 12 »).
    for (const d of getDescendantZones(zoneId)) if (d !== zoneId) delete p.zones[d];
  } else {
    delete p.zones[zoneId];
  }
  save();
}
// Zones couvertes par héritage : descendantes d'une zone cochée.
function travauxCoveringAncestors(checked) {
  const covered = new Set();
  for (const zid of Object.keys(checked)) for (const d of getDescendantZones(zid)) if (d !== zid) covered.add(d);
  return covered;
}

// Retrouve la position numérotée d'un chapitre / d'un article.
function travauxFindChap(ouvrageId) {
  for (const g of buildTravauxCCTP()) {
    for (const c of g.ouvrages) {
      if (c.ouvrage.id === ouvrageId) return { num: c.num, lotNum: g.num, lotName: g.name };
    }
  }
  return null;
}
function travauxFindArticle(prescId) {
  for (const g of buildTravauxCCTP()) {
    for (const c of g.ouvrages) {
      for (const a of c.articles) {
        if (a.presc.id === prescId) return { num: a.num, lotNum: g.num, lotName: g.name, chapName: c.ouvrage.name };
      }
    }
  }
  return null;
}
function travauxEmptyMsg(text) {
  const p = document.createElement('p');
  p.className = 'heures-empty';
  p.textContent = text;
  return p;
}

// Unité la plus récemment utilisée pour un produit (pour pré-remplir
// le sélecteur unité quand on choisit un produit existant).
function getMostRecentUnitForProduct(name) {
  const key = (name || '').trim().toLowerCase();
  let unit = 'u';
  let lastDate = '';
  for (const e of getConsommableEntries()) {
    if ((e.product || '').trim().toLowerCase() !== key) continue;
    const d = e.date || '';
    if (d >= lastDate) { unit = e.unit || 'u'; lastDate = d; }
  }
  return unit;
}
function fmtPriceForInput(n) {
  if (!n || isNaN(Number(n))) return '';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function fmtEur(n) {
  return Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Période du chantier (utilisée par récap + projection FDC) ----------
// Tous les compteurs sont en mois inclusifs (le mois de début et le mois de
// fin comptent chacun pour 1). monthsInclusive('2026-01-15','2026-03-02') = 3.
function monthsInclusive(aISO, bISO) {
  if (!aISO || !bISO) return 0;
  const a = new Date(aISO);
  const b = new Date(bISO);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return 0;
  if (b < a) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}
function getProjectMonthsTotal() {
  return monthsInclusive(state.projectStart, state.projectEnd);
}
function getProjectMonthsElapsed() {
  if (!state.projectStart) return 0;
  return monthsInclusive(state.projectStart, todayISO());
}
function getProjectMonthsRemaining() {
  if (!state.projectEnd) return 0;
  return monthsInclusive(todayISO(), state.projectEnd);
}


function fmtMonthKeyFR(monthKey) {
  const [y, m] = monthKey.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  let s = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ----- Liste des commandes (sous-onglet Saisie) -----
// Les entrées sont regroupées par orderId : un en-tête « Commande du X »
// avec total, puis les lignes produits en dessous.
function renderConsommableEntries() {
  const list = document.getElementById('consoentrylist');
  const empty = document.getElementById('consoentryempty');
  if (!list || !empty) return;
  list.innerHTML = '';
  empty.classList.remove('show');
  const entries = getConsommableEntries();
  if (entries.length === 0) {
    empty.innerHTML = '<p>Aucune commande enregistrée.</p><p class="hint">Tapez le bouton + en bas à droite pour saisir votre première commande.</p>';
    empty.classList.add('show');
    return;
  }
  const sorted = entries.slice().sort(compareConsommableEntries).reverse();
  const seen = new Set();
  const ordered = [];
  for (const e of sorted) {
    const oid = getEntryOrderId(e);
    if (seen.has(oid)) continue;
    seen.add(oid);
    const group = sorted.filter(x => getEntryOrderId(x) === oid);
    ordered.push({ orderId: oid, entries: group });
  }
  for (const g of ordered) list.appendChild(buildOrderGroup(g));
}
function buildOrderGroup(group) {
  const wrap = document.createElement('li');
  wrap.className = 'conso-order-group';
  wrap.setAttribute('data-order-id', group.orderId);
  const first = group.entries[0];
  const total = group.entries.reduce((s, e) => s + (Number(e.qty) || 0) * (Number(e.unitPrice) || 0), 0);
  const header = document.createElement('div');
  header.className = 'conso-order-head';
  header.innerHTML = `
    <span class="conso-order-date"></span>
    <span class="conso-order-notes"></span>
    <span class="conso-order-total"></span>
    <button class="conso-order-edit" type="button" aria-label="Modifier la commande">
      <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>
    </button>
  `;
  header.querySelector('.conso-order-date').textContent = formatDateShortFR(first.date);
  header.querySelector('.conso-order-notes').textContent = first.notes || '';
  header.querySelector('.conso-order-total').textContent = fmtEur(total);
  header.querySelector('.conso-order-edit').addEventListener('click', () => openConsommableSheetForEdit(group.orderId));
  wrap.appendChild(header);
  const ul = document.createElement('ul');
  ul.className = 'conso-order-entries';
  for (const e of group.entries) ul.appendChild(buildOrderEntryRow(e));
  wrap.appendChild(ul);
  return wrap;
}
function buildOrderEntryRow(entry) {
  const li = document.createElement('li');
  li.className = 'conso-order-entry';
  const total = (Number(entry.qty) || 0) * (Number(entry.unitPrice) || 0);
  const ref = getEntryReference(entry);
  const eotp = getEntryEOTP(entry);
  li.innerHTML = `
    <div class="conso-entry-main">
      <span class="conso-entry-name"></span>
      <span class="conso-entry-qty"></span>
      <span class="conso-entry-total"></span>
      <button class="stock-entry-delete" type="button" aria-label="Supprimer cette ligne">
        <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
      </button>
    </div>
    <div class="conso-entry-sub" hidden>
      <span class="conso-entry-ref"></span>
      <span class="conso-entry-eotp"></span>
    </div>
  `;
  li.querySelector('.conso-entry-name').textContent = entry.product;
  li.querySelector('.conso-entry-qty').textContent = `${fmtStockQty(entry.qty)} ${entry.unit}`;
  li.querySelector('.conso-entry-total').textContent = fmtEur(total);
  li.querySelector('.stock-entry-delete').addEventListener('click', () => removeConsommableEntry(entry.id));
  if (ref || eotp) {
    const sub = li.querySelector('.conso-entry-sub');
    sub.hidden = false;
    sub.querySelector('.conso-entry-ref').textContent = ref ? `Réf. ${ref}` : '';
    sub.querySelector('.conso-entry-eotp').textContent = eotp ? `eOTP ${eotp}` : '';
  }
  return li;
}

// ----- Récap mensuel (sous-onglet Récapitulatif) -----
function renderConsommableRecap() {
  const wrap = document.getElementById('consorecapwrap');
  const empty = document.getElementById('consorecapempty');
  if (!wrap || !empty) return;
  // Reflète l'état actif sur les boutons de mode (idempotent)
  const mode = state.consoRecapMode === 'eotp' ? 'eotp' : 'product';
  document.querySelectorAll('.recap-mode-btn').forEach(b => {
    const on = b.dataset.recapMode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  wrap.innerHTML = '';
  empty.classList.remove('show');
  const entries = getConsommableEntries();
  if (entries.length === 0) {
    empty.innerHTML = '<p>Aucun consommable à afficher.</p><p class="hint">Saisis une commande pour commencer.</p>';
    empty.classList.add('show');
    return;
  }
  if (mode === 'eotp') renderConsommableRecapByEOTP(wrap, empty, entries);
  else                 renderConsommableRecapByProduct(wrap, empty, entries);
}

function renderConsommableRecapByProduct(wrap, empty, entries) {
  const monthSet = new Set();
  const productMap = new Map(); // lc → { display, unit, ref, totalQty, monthsWithData:Set }
  const cells = new Map();
  // Itère trié pour que la « dernière référence » prise soit bien la plus récente
  const sorted = entries.slice().sort(compareConsommableEntries);
  for (const e of sorted) {
    const monthKey = (e.date || '').slice(0, 7);
    if (!monthKey) continue;
    const pKey = (e.product || '').trim().toLowerCase();
    if (!pKey) continue;
    monthSet.add(monthKey);
    if (!productMap.has(pKey)) productMap.set(pKey, { display: e.product, unit: e.unit, ref: '', totalQty: 0, monthsWithData: new Set() });
    const cur = productMap.get(pKey);
    cur.display = e.product;
    cur.unit = e.unit;
    // La référence affichée dans le récap vient de l'entrée la plus
    // récente (ou ultérieurement remplacée par la canonique ci-après)
    if (e.reference) cur.ref = e.reference;
    cur.monthsWithData.add(monthKey);
    const cellKey = pKey + '|' + monthKey;
    if (!cells.has(cellKey)) cells.set(cellKey, { qty: 0, total: 0, unit: e.unit });
    const cell = cells.get(cellKey);
    const q = Number(e.qty) || 0;
    const p = Number(e.unitPrice) || 0;
    cell.qty += q;
    cell.total += q * p;
    cell.unit = e.unit;
    cur.totalQty += q;
  }
  const months = Array.from(monthSet).sort();
  // Préfère la référence canonique si elle existe (= celle qui apparaît
  // dans le dropdown de saisie), pour avoir partout la même chaîne.
  for (const [, p] of productMap) {
    const canonical = getConsoProduct(p.display);
    if (canonical && canonical.reference) p.ref = canonical.reference;
  }
  const products = Array.from(productMap.entries())
    .sort((a, b) => a[1].display.localeCompare(b[1].display, 'fr'));
  const headerLabel = 'Produit';
  const rowBuilder = ([, p]) => {
    const cellTh = document.createElement('th');
    cellTh.className = 'recap-date-col';
    cellTh.scope = 'row';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'conso-product-name';
    nameDiv.textContent = p.display;
    cellTh.appendChild(nameDiv);
    if (p.ref) {
      const refDiv = document.createElement('div');
      refDiv.className = 'conso-product-ref';
      refDiv.textContent = p.ref;
      cellTh.appendChild(refDiv);
    }
    return cellTh;
  };
  const cellAccess = ([pKey], monthKey) => cells.get(pKey + '|' + monthKey);
  // Pour la moyenne mensuelle : on prend les mois écoulés depuis le
  // début du chantier si renseigné (vue projet réelle), sinon la plage
  // de mois couverts par les données (fallback).
  const elapsed = getProjectMonthsElapsed();
  const fallbackMonths = months.length; // au moins 1 si on est ici
  const trailingCols = [
    {
      header: 'Moy. / mois',
      headerTitle: elapsed > 0
        ? `Moyenne mensuelle calculée sur ${elapsed} mois écoulés depuis le début du chantier`
        : `Moyenne calculée sur ${fallbackMonths} mois (durée des données — renseignez les dates dans Données → Admin. pour un calcul basé sur la durée projet).`,
      className: 'recap-avg-col',
      cell: ([, p], rowTotal) => {
        const divisor = elapsed > 0 ? elapsed : fallbackMonths;
        if (divisor <= 0) return { text: '—', className: 'recap-empty-cell' };
        const avgQty = p.totalQty / divisor;
        const avgEur = rowTotal / divisor;
        return {
          html: `<span class="conso-cell-qty">${escapeHtml(fmtStockQty(avgQty))} ${escapeHtml(p.unit || '')}</span><br><span class="conso-cell-eur">${escapeHtml(fmtEur(avgEur))}</span>`
        };
      },
      footer: (grandTotal, rowTotals, allRows) => {
        const divisor = elapsed > 0 ? elapsed : fallbackMonths;
        if (divisor <= 0) return { text: '—' };
        const avgEur = grandTotal / divisor;
        // Pas de moyenne quantité globale (unités hétérogènes) — juste €
        return { html: `<span class="conso-cell-eur">${escapeHtml(fmtEur(avgEur))}</span>` };
      }
    }
  ];
  buildRecapTable(wrap, months, products, headerLabel, rowBuilder, cellAccess, [], trailingCols);
}

function renderConsommableRecapByEOTP(wrap, empty, entries) {
  const monthSet = new Set();
  // key = code eOTP ou '' pour « sans eOTP »
  const eotpRows = new Map(); // key → { code, label, budget }
  const cells = new Map();    // key + '|' + month → { total }
  for (const e of entries) {
    const monthKey = (e.date || '').slice(0, 7);
    if (!monthKey) continue;
    const code = (e.eOTP || '').trim();
    monthSet.add(monthKey);
    if (!eotpRows.has(code)) {
      const reg = code ? getEOTP(code) : null;
      eotpRows.set(code, {
        code,
        label: reg?.label || '',
        budget: reg && Number.isFinite(reg.budget) ? reg.budget : 0
      });
    }
    const cellKey = code + '|' + monthKey;
    if (!cells.has(cellKey)) cells.set(cellKey, { total: 0 });
    cells.get(cellKey).total += (Number(e.qty) || 0) * (Number(e.unitPrice) || 0);
  }
  if (eotpRows.size === 0) {
    empty.innerHTML = '<p>Aucune dépense affectée à un eOTP.</p><p class="hint">Renseigne un eOTP lors de la saisie d\'une commande pour suivre la consommation par ligne de budget.</p>';
    empty.classList.add('show');
    return;
  }
  const months = Array.from(monthSet).sort();
  // Tri : codes alphanumériques puis « Sans eOTP » en dernier
  const rows = Array.from(eotpRows.entries()).sort((a, b) => {
    if (!a[0] && !b[0]) return 0;
    if (!a[0]) return 1;
    if (!b[0]) return -1;
    return a[0].localeCompare(b[0], 'fr');
  });
  const headerLabel = 'eOTP';
  const rowBuilder = ([code, row]) => {
    const cellTh = document.createElement('th');
    cellTh.className = 'recap-date-col';
    cellTh.scope = 'row';
    if (code) {
      const codeDiv = document.createElement('div');
      codeDiv.className = 'conso-eotp-code';
      codeDiv.textContent = code;
      cellTh.appendChild(codeDiv);
      if (row.label) {
        const labelDiv = document.createElement('div');
        labelDiv.className = 'conso-eotp-label';
        labelDiv.textContent = row.label;
        cellTh.appendChild(labelDiv);
      }
    } else {
      const noneDiv = document.createElement('div');
      noneDiv.className = 'conso-eotp-none';
      noneDiv.textContent = 'Sans eOTP';
      cellTh.appendChild(noneDiv);
    }
    return cellTh;
  };
  const cellAccess = ([code], monthKey) => cells.get(code + '|' + monthKey);
  // Colonnes Budget et Reste à dépenser, entre eOTP et les mois.
  // « Sans eOTP » n'a pas de budget : on affiche « — » dans les deux.
  const extraCols = [
    {
      header: 'Budget',
      className: 'recap-budget-col',
      cell: ([code, row]) => {
        if (!code) return { text: '—', className: 'recap-empty-cell' };
        return { text: fmtEur(row.budget) };
      },
      footer: (_, rowTotals, rows) => {
        const sum = rows.reduce((s, [code, r]) => s + (code ? r.budget : 0), 0);
        return { text: fmtEur(sum) };
      }
    },
    {
      header: 'RAD',
      headerTitle: 'Reste à dépenser (Budget − Total)',
      className: 'recap-reste-col',
      cell: ([code, row], rowTotal) => {
        if (!code) return { text: '—', className: 'recap-empty-cell' };
        const reste = row.budget - rowTotal;
        return {
          text: fmtEur(reste),
          className: reste < 0 ? 'recap-reste-negative' : ''
        };
      },
      footer: (grandTotal, rowTotals, rows) => {
        const sumBudget = rows.reduce((s, [code, r]) => s + (code ? r.budget : 0), 0);
        const sumDepenses = rows.reduce((s, [code, r], i) => s + (code ? rowTotals[i] : 0), 0);
        const reste = sumBudget - sumDepenses;
        return {
          text: fmtEur(reste),
          className: reste < 0 ? 'recap-reste-negative' : ''
        };
      }
    }
  ];
  // Colonnes trailing : FDC et Écart FDC, à droite du Total.
  // FDC = projection des dépenses à la fin du chantier si on continue
  // au rythme moyen constaté (avg/mois × durée totale projet).
  // Équivalent : total_actuel + avg/mois × mois_restants — formellement
  // identique. Requiert les deux dates projet renseignées.
  const elapsed   = getProjectMonthsElapsed();
  const totalProj = getProjectMonthsTotal();
  const canProject = elapsed > 0 && totalProj > 0;
  const fdcTooltip = canProject
    ? `Projection à la fin du chantier : moyenne mensuelle (sur ${elapsed} mois écoulés) × durée totale du chantier (${totalProj} mois).`
    : 'Renseignez les dates de début et fin du chantier dans Données → Admin. pour activer la projection.';
  const trailingCols = [
    {
      header: 'FDC',
      headerTitle: fdcTooltip,
      className: 'recap-fdc-col',
      cell: ([code, row], rowTotal) => {
        if (!canProject) return { text: '—', className: 'recap-empty-cell' };
        const avg = rowTotal / elapsed;
        const fdc = avg * totalProj;
        return { text: fmtEur(fdc) };
      },
      footer: (grandTotal) => {
        if (!canProject) return { text: '—', className: 'recap-empty-cell' };
        const fdc = (grandTotal / elapsed) * totalProj;
        return { text: fmtEur(fdc) };
      }
    },
    {
      header: 'Écart FDC',
      headerTitle: canProject
        ? 'Budget − FDC : marge prévisionnelle en fin de chantier (rouge si dépassement)'
        : fdcTooltip,
      className: 'recap-ecart-col',
      cell: ([code, row], rowTotal) => {
        if (!canProject || !code) return { text: '—', className: 'recap-empty-cell' };
        const fdc = (rowTotal / elapsed) * totalProj;
        const ecart = row.budget - fdc;
        return {
          text: fmtEur(ecart),
          className: ecart < 0 ? 'recap-reste-negative' : ''
        };
      },
      footer: (_, rowTotals, allRows) => {
        if (!canProject) return { text: '—', className: 'recap-empty-cell' };
        const sumBudget = allRows.reduce((s, [code, r]) => s + (code ? r.budget : 0), 0);
        const sumFDC = allRows.reduce((s, [code, _r], i) => {
          if (!code) return s; // exclut « Sans eOTP » comme pour le RAD
          return s + (rowTotals[i] / elapsed) * totalProj;
        }, 0);
        const ecart = sumBudget - sumFDC;
        return {
          text: fmtEur(ecart),
          className: ecart < 0 ? 'recap-reste-negative' : ''
        };
      }
    }
  ];
  buildRecapTable(wrap, months, rows, headerLabel, rowBuilder, cellAccess, extraCols, trailingCols);
}

// ====================================================================
//   STOCK → CB : récap budget par produit / par eOTP
// ====================================================================
// Vision budget des entrées Stock (réceptions uniquement — l'inventaire
// est un recalage physique). Réutilise buildRecapTable + les helpers
// FDC / RAD / Écart du récap Consommable.
//   - Mode produit : lignes = articles, colonnes = mois × quantités
//   - Mode eOTP    : lignes = eOTP, colonnes = mois × dépenses €,
//                    avec Budget / RAD / FDC / Écart FDC
// Achats seuls : ni les inventaires (recalage physique) ni les sorties
// (mouvement interne) ne sont des dépenses. Le filtre « tout sauf inventaire »
// aurait compté chaque sortie comme un achat dans toute la vision budget.
function getStockReceptions() {
  return (state.stockEntries || []).filter(e => stockTypeOf(e) === 'reception');
}
function renderStockCB() {
  const wrap  = document.getElementById('stockcbwrap');
  const empty = document.getElementById('stockcbempty');
  if (!wrap || !empty) return;
  const mode = state.stockCBMode === 'eotp' ? 'eotp' : 'product';
  document.querySelectorAll('.recap-mode-btn[data-stock-cb-mode]').forEach(b => {
    const on = b.dataset.stockCbMode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  wrap.innerHTML = '';
  empty.classList.remove('show');
  const entries = getStockReceptions();
  if (entries.length === 0) {
    empty.innerHTML = '<p>Aucune réception à afficher.</p><p class="hint">Enregistre une réception (avec un prix unitaire) pour faire apparaître la vision budget.</p>';
    empty.classList.add('show');
    return;
  }
  // Une réception sans prix entre à 0 € et fausse silencieusement le RAD, le
  // FDC et l'écart : on le dit, plutôt que de laisser croire au chiffre.
  const unpriced = entries.filter(e => !(Number(e.unitPrice) > 0)).length;
  if (unpriced) {
    const warn = dbEl('p', 'stock-cb-warn',
      unpriced + ' réception' + (unpriced > 1 ? 's' : '') + ' sans prix unitaire : '
      + (unpriced > 1 ? 'elles comptent' : 'elle compte') + ' pour 0 € dans ce tableau.');
    warn.title = 'Ouvrez la fiche de l\'article concerné pour compléter le prix des réceptions.';
    wrap.appendChild(warn);
  }
  if (mode === 'eotp') renderStockCBByEOTP(wrap, empty, entries);
  else                 renderStockCBByProduct(wrap, empty, entries);
}

function renderStockCBByProduct(wrap, empty, entries) {
  const monthSet = new Set();
  const productMap = new Map();
  const cells = new Map();
  for (const e of entries) {
    const monthKey = (e.date || '').slice(0, 7);
    if (!monthKey) continue;
    const pKey = (e.article || '').trim().toLowerCase();
    if (!pKey) continue;
    monthSet.add(monthKey);
    if (!productMap.has(pKey)) productMap.set(pKey, { display: e.article, unit: e.unit, totalQty: 0 });
    const cur = productMap.get(pKey);
    cur.display = e.article;
    cur.unit = e.unit;
    const cellKey = pKey + '|' + monthKey;
    if (!cells.has(cellKey)) cells.set(cellKey, { qty: 0, total: 0, unit: e.unit });
    const cell = cells.get(cellKey);
    const q = Number(e.qty) || 0;
    const p = Number(e.unitPrice) || 0;
    cell.qty += q;
    cell.total += q * p;
    cell.unit = e.unit;
    cur.totalQty += q;
  }
  if (productMap.size === 0) {
    empty.innerHTML = '<p>Aucune donnée à afficher.</p>';
    empty.classList.add('show');
    return;
  }
  const months = Array.from(monthSet).sort();
  const products = Array.from(productMap.entries())
    .sort((a, b) => a[1].display.localeCompare(b[1].display, 'fr'));
  const rowBuilder = ([, p]) => {
    const cellTh = document.createElement('th');
    cellTh.className = 'recap-date-col';
    cellTh.scope = 'row';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'conso-product-name';
    nameDiv.textContent = p.display;
    cellTh.appendChild(nameDiv);
    if (p.unit) {
      const refDiv = document.createElement('div');
      refDiv.className = 'conso-product-ref';
      refDiv.textContent = 'unité : ' + p.unit;
      cellTh.appendChild(refDiv);
    }
    return cellTh;
  };
  const cellAccess = ([pKey], monthKey) => cells.get(pKey + '|' + monthKey);
  const elapsed = getProjectMonthsElapsed();
  const fallbackMonths = months.length;
  const trailingCols = [{
    header: 'Moy. / mois',
    headerTitle: elapsed > 0
      ? `Moyenne mensuelle calculée sur ${elapsed} mois écoulés depuis le début du chantier`
      : `Moyenne calculée sur ${fallbackMonths} mois (durée des données — renseignez les dates dans Données → Admin. pour un calcul basé sur la durée projet).`,
    className: 'recap-avg-col',
    cell: ([, p], rowTotal) => {
      const divisor = elapsed > 0 ? elapsed : fallbackMonths;
      if (divisor <= 0) return { text: '—', className: 'recap-empty-cell' };
      const avgQty = p.totalQty / divisor;
      const avgEur = rowTotal / divisor;
      return { html: `<span class="conso-cell-qty">${escapeHtml(fmtStockQty(avgQty))} ${escapeHtml(p.unit || '')}</span><br><span class="conso-cell-eur">${escapeHtml(fmtEur(avgEur))}</span>` };
    },
    footer: (grandTotal) => {
      const divisor = elapsed > 0 ? elapsed : fallbackMonths;
      if (divisor <= 0) return { text: '—' };
      const avgEur = grandTotal / divisor;
      return { html: `<span class="conso-cell-eur">${escapeHtml(fmtEur(avgEur))}</span>` };
    }
  }];
  buildRecapTable(wrap, months, products, 'Article', rowBuilder, cellAccess, [], trailingCols);
}

// Les lignes de budget en heures sont écartées : leur budget est un volume de
// main-d'œuvre, pas une enveloppe en euros — le comparer à des achats
// afficherait « 1 200 € » là où la ligne vaut 1 200 heures.
function renderStockCBByEOTP(wrap, empty, entries) {
  const monthSet = new Set();
  const eotpRows = new Map();
  const cells = new Map();
  for (const e of entries) {
    const monthKey = (e.date || '').slice(0, 7);
    if (!monthKey) continue;
    const code = (e.eOTP || '').trim();
    monthSet.add(monthKey);
    const reg = code ? getEOTP(code) : null;
    if (reg && isHourEOTP(reg)) continue;      // ligne en heures : hors budget €
    if (!eotpRows.has(code)) {
      eotpRows.set(code, {
        code,
        label: reg?.label || '',
        budget: reg && Number.isFinite(reg.budget) ? reg.budget : 0
      });
    }
    const cellKey = code + '|' + monthKey;
    if (!cells.has(cellKey)) cells.set(cellKey, { total: 0 });
    cells.get(cellKey).total += (Number(e.qty) || 0) * (Number(e.unitPrice) || 0);
  }
  if (eotpRows.size === 0) {
    empty.innerHTML = '<p>Aucune dépense affectée à un eOTP.</p><p class="hint">Renseigne un eOTP lors de la saisie d\'une réception pour suivre la consommation par ligne de budget.</p>';
    empty.classList.add('show');
    return;
  }
  const months = Array.from(monthSet).sort();
  const rows = Array.from(eotpRows.entries()).sort((a, b) => {
    if (!a[0] && !b[0]) return 0;
    if (!a[0]) return 1;
    if (!b[0]) return -1;
    return a[0].localeCompare(b[0], 'fr');
  });
  const rowBuilder = ([code, row]) => {
    const cellTh = document.createElement('th');
    cellTh.className = 'recap-date-col';
    cellTh.scope = 'row';
    if (code) {
      const codeDiv = document.createElement('div');
      codeDiv.className = 'conso-eotp-code';
      codeDiv.textContent = code;
      cellTh.appendChild(codeDiv);
      if (row.label) {
        const labelDiv = document.createElement('div');
        labelDiv.className = 'conso-eotp-label';
        labelDiv.textContent = row.label;
        cellTh.appendChild(labelDiv);
      }
    } else {
      const noneDiv = document.createElement('div');
      noneDiv.className = 'conso-eotp-none';
      noneDiv.textContent = 'Sans eOTP';
      cellTh.appendChild(noneDiv);
    }
    return cellTh;
  };
  const cellAccess = ([code], monthKey) => cells.get(code + '|' + monthKey);
  const extraCols = [
    {
      header: 'Budget', className: 'recap-budget-col',
      cell: ([code, row]) => code ? { text: fmtEur(row.budget) } : { text: '—', className: 'recap-empty-cell' },
      footer: (_, __, rows) => ({ text: fmtEur(rows.reduce((s, [c, r]) => s + (c ? r.budget : 0), 0)) })
    },
    {
      header: 'RAD', headerTitle: 'Reste à dépenser (Budget − Total)',
      className: 'recap-reste-col',
      cell: ([code, row], rowTotal) => {
        if (!code) return { text: '—', className: 'recap-empty-cell' };
        const reste = row.budget - rowTotal;
        return { text: fmtEur(reste), className: reste < 0 ? 'recap-reste-negative' : '' };
      },
      footer: (_, rowTotals, allRows) => {
        const sumBudget   = allRows.reduce((s, [c, r]) => s + (c ? r.budget : 0), 0);
        const sumDepenses = allRows.reduce((s, [c, _r], i) => s + (c ? rowTotals[i] : 0), 0);
        const reste = sumBudget - sumDepenses;
        return { text: fmtEur(reste), className: reste < 0 ? 'recap-reste-negative' : '' };
      }
    }
  ];
  const elapsed   = getProjectMonthsElapsed();
  const totalProj = getProjectMonthsTotal();
  const canProject = elapsed > 0 && totalProj > 0;
  const fdcTooltip = canProject
    ? `Projection à la fin du chantier : moyenne mensuelle (sur ${elapsed} mois écoulés) × durée totale du chantier (${totalProj} mois).`
    : 'Renseignez les dates de début et fin du chantier dans Données → Admin. pour activer la projection.';
  const trailingCols = [
    {
      header: 'FDC', headerTitle: fdcTooltip, className: 'recap-fdc-col',
      cell: (_, rowTotal) => {
        if (!canProject) return { text: '—', className: 'recap-empty-cell' };
        return { text: fmtEur((rowTotal / elapsed) * totalProj) };
      },
      footer: (grandTotal) => {
        if (!canProject) return { text: '—', className: 'recap-empty-cell' };
        return { text: fmtEur((grandTotal / elapsed) * totalProj) };
      }
    },
    {
      header: 'Écart FDC',
      headerTitle: canProject ? 'Budget − FDC : marge prévisionnelle en fin de chantier (rouge si dépassement)' : fdcTooltip,
      className: 'recap-ecart-col',
      cell: ([code, row], rowTotal) => {
        if (!canProject || !code) return { text: '—', className: 'recap-empty-cell' };
        const fdc = (rowTotal / elapsed) * totalProj;
        const ecart = row.budget - fdc;
        return { text: fmtEur(ecart), className: ecart < 0 ? 'recap-reste-negative' : '' };
      },
      footer: (_, rowTotals, allRows) => {
        if (!canProject) return { text: '—', className: 'recap-empty-cell' };
        const sumBudget = allRows.reduce((s, [c, r]) => s + (c ? r.budget : 0), 0);
        const sumFDC = allRows.reduce((s, [c, _r], i) => {
          if (!c) return s;
          return s + (rowTotals[i] / elapsed) * totalProj;
        }, 0);
        const ecart = sumBudget - sumFDC;
        return { text: fmtEur(ecart), className: ecart < 0 ? 'recap-reste-negative' : '' };
      }
    }
  ];
  buildRecapTable(wrap, months, rows, 'eOTP', rowBuilder, cellAccess, extraCols, trailingCols);
}

// Squelette commun produit×mois / eOTP×mois : un th de ligne, N colonnes
// extra (entre row label et mois), N mois, un total, puis N colonnes
// trailing (après le total — utilisé pour la moyenne mensuelle en mode
// produit et la projection FDC/Écart en mode eOTP).
// Format d'une colonne (extra ou trailing) :
//   { header, headerTitle?, className?, cell(rowEntry, rowTotal) →
//     { text?, html?, className? }, footer(grand, rowTotals, rows) → ... }
function buildRecapTable(wrap, months, rows, headerLabel, rowBuilder, cellAccess, extraCols = [], trailingCols = []) {
  const table = document.createElement('table');
  table.className = 'recap-table conso-recap-table';

  const renderCellLike = (td, out) => {
    if (!out) return;
    if (out.html != null)      td.innerHTML = out.html;
    else if (out.text != null) td.textContent = out.text;
    if (out.className) td.classList.add(...out.className.split(' ').filter(Boolean));
  };

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const firstTh = document.createElement('th');
  firstTh.className = 'recap-date-col';
  firstTh.scope = 'col';
  firstTh.textContent = headerLabel;
  headRow.appendChild(firstTh);
  for (const col of extraCols) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (col.className) th.className = col.className;
    if (col.headerTitle) th.title = col.headerTitle;
    th.textContent = col.header;
    headRow.appendChild(th);
  }
  for (const m of months) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = fmtMonthKeyFR(m);
    headRow.appendChild(th);
  }
  const totalTh = document.createElement('th');
  totalTh.className = 'recap-total-col';
  totalTh.scope = 'col';
  totalTh.textContent = 'Total';
  headRow.appendChild(totalTh);
  for (const col of trailingCols) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (col.className) th.className = col.className;
    if (col.headerTitle) th.title = col.headerTitle;
    th.textContent = col.header;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const monthTotals = months.map(() => 0);
  const rowTotals = [];
  let grandTotal = 0;
  // 1er passage : calcule les rowTotals et stocke les <tr> pour insérer
  // les colonnes extra (qui peuvent dépendre du rowTotal) après coup.
  const rowFragments = rows.map((rowEntry) => {
    const tr = document.createElement('tr');
    tr.appendChild(rowBuilder(rowEntry));
    const monthCells = [];
    let rowTotal = 0;
    for (let i = 0; i < months.length; i++) {
      const td = document.createElement('td');
      const cell = cellAccess(rowEntry, months[i]);
      if (cell) {
        if (cell.qty != null) {
          // Mode produit : qty (unité) + € HT
          td.innerHTML = `<span class="conso-cell-qty"></span><br><span class="conso-cell-eur"></span>`;
          td.querySelector('.conso-cell-qty').textContent = `${fmtStockQty(cell.qty)} ${cell.unit}`;
          td.querySelector('.conso-cell-eur').textContent = fmtEur(cell.total);
        } else {
          // Mode eOTP : montant € seulement (les unités sont hétérogènes)
          td.innerHTML = `<span class="conso-cell-eur"></span>`;
          td.querySelector('.conso-cell-eur').textContent = fmtEur(cell.total);
        }
        rowTotal += cell.total;
        monthTotals[i] += cell.total;
      } else {
        td.innerHTML = '<span class="recap-empty-cell">—</span>';
      }
      monthCells.push(td);
    }
    rowTotals.push(rowTotal);
    grandTotal += rowTotal;
    return { tr, monthCells, rowEntry, rowTotal };
  });
  // 2e passage : insère les colonnes extra (avec rowTotal connu) entre
  // le th de ligne et les mois, puis les cellules mois, le total et
  // les colonnes trailing.
  for (const { tr, monthCells, rowEntry, rowTotal } of rowFragments) {
    for (const col of extraCols) {
      const td = document.createElement('td');
      if (col.className) td.className = col.className;
      renderCellLike(td, col.cell(rowEntry, rowTotal));
      tr.appendChild(td);
    }
    for (const td of monthCells) tr.appendChild(td);
    const totalTd = document.createElement('td');
    totalTd.className = 'recap-total-col';
    totalTd.textContent = fmtEur(rowTotal);
    tr.appendChild(totalTd);
    for (const col of trailingCols) {
      const td = document.createElement('td');
      if (col.className) td.className = col.className;
      renderCellLike(td, col.cell(rowEntry, rowTotal));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');
  const footRow = document.createElement('tr');
  const footLabel = document.createElement('th');
  footLabel.className = 'recap-date-col';
  footLabel.scope = 'row';
  footLabel.textContent = 'Total';
  footRow.appendChild(footLabel);
  for (const col of extraCols) {
    const td = document.createElement('td');
    if (col.className) td.className = col.className;
    renderCellLike(td, col.footer ? col.footer(grandTotal, rowTotals, rows) : null);
    footRow.appendChild(td);
  }
  for (let i = 0; i < months.length; i++) {
    const td = document.createElement('td');
    td.textContent = fmtEur(monthTotals[i]);
    footRow.appendChild(td);
  }
  const gtTd = document.createElement('td');
  gtTd.className = 'recap-total-col';
  gtTd.textContent = fmtEur(grandTotal);
  footRow.appendChild(gtTd);
  for (const col of trailingCols) {
    const td = document.createElement('td');
    if (col.className) td.className = col.className;
    renderCellLike(td, col.footer ? col.footer(grandTotal, rowTotals, rows) : null);
    footRow.appendChild(td);
  }
  tfoot.appendChild(footRow);
  table.appendChild(tfoot);

  wrap.appendChild(table);
}

function setConsoRecapMode(mode) {
  const next = (mode === 'eotp') ? 'eotp' : 'product';
  if (state.consoRecapMode === next) return;
  state.consoRecapMode = next;
  save();
  renderConsommableRecap();
}
function setStockCBMode(mode) {
  const next = (mode === 'eotp') ? 'eotp' : 'product';
  if (state.stockCBMode === next) return;
  state.stockCBMode = next;
  save();
  renderStockCB();
}

function renderConsommable() {
  renderConsommableEntries();
  renderConsommableRecap();
}

function removeConsommableEntry(id) {
  const entry = getConsommableEntries().find(e => e.id === id);
  if (!entry) return;
  const label = `${entry.product} (${fmtStockQty(entry.qty)} ${entry.unit} à ${fmtEur(entry.unitPrice)} le ${formatDateShortFR(entry.date)})`;
  if (!confirm(`Supprimer la ligne ${label} ?`)) return;
  state.consommableEntries = getConsommableEntries().filter(e => e.id !== id);
  save();
  renderConsommable();
}

// ----- Bottom sheet : commande groupée multi-lignes -----
// Mode édition : null pour une nouvelle commande, orderId pour une
// commande existante qu'on remplace au moment du Save.
let editingOrderId = null;

function openConsommableSheet() {
  const sheet = document.getElementById('consoentrysheet');
  if (!sheet) return;
  editingOrderId = null;
  const title = document.getElementById('consoentrysheetTitle');
  if (title) title.textContent = 'Nouvelle commande';
  document.getElementById('consoorderdate').value = todayISO();
  document.getElementById('consoordernotes').value = '';
  const linesContainer = document.getElementById('consoorderlines');
  linesContainer.innerHTML = '';
  addOrderLine();
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
}
// Ouvre le sheet en mode édition : ré-utilise l'orderId, pré-remplit la
// date/notes et les lignes avec les entrées existantes. À la
// soumission, les anciennes entrées sont remplacées par les nouvelles.
function openConsommableSheetForEdit(orderId) {
  const sheet = document.getElementById('consoentrysheet');
  if (!sheet) return;
  const orderEntries = getConsommableEntries()
    .filter(e => getEntryOrderId(e) === orderId)
    .sort(compareConsommableEntries);
  if (orderEntries.length === 0) return;
  editingOrderId = orderId;
  const title = document.getElementById('consoentrysheetTitle');
  if (title) title.textContent = 'Modifier la commande';
  document.getElementById('consoorderdate').value = orderEntries[0].date || todayISO();
  document.getElementById('consoordernotes').value = orderEntries[0].notes || '';
  const linesContainer = document.getElementById('consoorderlines');
  linesContainer.innerHTML = '';
  for (const entry of orderEntries) {
    const lineEl = buildOrderLine();
    linesContainer.appendChild(lineEl);
    // Force la sélection du produit puis dispatch change pour que le
    // handler remplisse ref + PU canoniques et révèle les détails.
    const sel = lineEl.querySelector('.conso-line-product');
    sel.value = entry.product;
    sel.dispatchEvent(new Event('change'));
    // Restaure qty/unité/eOTP propres à l'entrée (le handler de change
    // peut avoir mis l'unité "la plus récente" du produit, on remet
    // celle réellement enregistrée pour cette ligne)
    lineEl.querySelector('.conso-line-qty').value  = fmtStockQty(entry.qty);
    lineEl.querySelector('.conso-line-unit').value = entry.unit || 'u';
    // eOTP : si le code existe dans le dropdown, on le sélectionne ;
    // sinon (cas où le code aurait disparu du registre) on bascule sur
    // « + Nouveau » avec la valeur historique pré-remplie en texte.
    const eotpSelEdit = lineEl.querySelector('.conso-line-eotp');
    const eotpNewEdit = lineEl.querySelector('.conso-line-eotp-new');
    const wanted = entry.eOTP || '';
    if (!wanted) {
      eotpSelEdit.value = '';
      eotpNewEdit.hidden = true;
    } else if (Array.from(eotpSelEdit.options).some(o => o.value === wanted)) {
      eotpSelEdit.value = wanted;
      eotpNewEdit.hidden = true;
    } else {
      eotpSelEdit.value = NEW_ARTICLE_SENTINEL;
      eotpNewEdit.hidden = false;
      eotpNewEdit.value = wanted;
    }
  }
  refreshOrderLineNumbers();
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeConsommableSheet() {
  const sheet = document.getElementById('consoentrysheet');
  if (sheet) sheet.hidden = true;
  document.body.style.overflow = '';
  editingOrderId = null;
}

function buildOrderLine() {
  const line = document.createElement('div');
  line.className = 'conso-order-line';
  line.setAttribute('data-line-id', uid());

  const header = document.createElement('div');
  header.className = 'conso-line-header';
  const num = document.createElement('span');
  num.className = 'conso-line-num';
  num.textContent = 'Ligne';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'conso-line-remove';
  remove.setAttribute('aria-label', 'Supprimer cette ligne');
  remove.textContent = '×';
  remove.addEventListener('click', () => removeOrderLine(line));
  header.append(num, remove);
  line.appendChild(header);

  // Sélection produit — toujours visible
  const prodLabel = document.createElement('label');
  prodLabel.className = 'stock-form-label';
  prodLabel.textContent = 'Produit';
  line.appendChild(prodLabel);
  const sel = document.createElement('select');
  sel.className = 'stock-form-input conso-line-product';
  line.appendChild(sel);
  // Champ texte pour un nouveau produit (caché tant que « Nouveau »
  // n'est pas sélectionné)
  const newInp = document.createElement('input');
  newInp.type = 'text';
  newInp.maxLength = 60;
  newInp.autocomplete = 'off';
  newInp.placeholder = 'Nom du nouveau produit';
  newInp.className = 'stock-form-input stock-article-new conso-line-product-new';
  newInp.hidden = true;
  line.appendChild(newInp);
  populateLineProductSelect(sel);

  // Bloc détails — caché jusqu'à ce qu'un produit soit sélectionné.
  // Layout compact : ref + PU côte à côte, qty + unité côte à côte,
  // eOTP en pleine largeur — moins de hauteur sur mobile.
  const details = document.createElement('div');
  details.className = 'conso-line-details';
  details.hidden = true;
  details.innerHTML = `
    <div class="stock-qty-row">
      <div>
        <label class="stock-form-label">Référence</label>
        <input class="stock-form-input conso-line-ref" type="text" maxlength="40" placeholder="VIS-6X40-001">
      </div>
      <div>
        <label class="stock-form-label">Prix unitaire (€ HT)</label>
        <div class="conso-price-wrap">
          <input class="stock-form-input conso-line-price" type="text" inputmode="decimal" placeholder="0,00">
          <button class="conso-price-edit" type="button" aria-label="Mettre à jour le prix unitaire du produit dans le registre (n'affecte pas les commandes précédentes)" hidden>
            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm17.71-10.04a1 1 0 0 0 0-1.41l-2.51-2.51a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 2-2.0Z"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="stock-qty-row">
      <div>
        <label class="stock-form-label">Quantité</label>
        <input class="stock-form-input conso-line-qty" type="text" inputmode="decimal" placeholder="0">
      </div>
      <div>
        <label class="stock-form-label">Unité</label>
        <select class="stock-form-input conso-line-unit"></select>
      </div>
    </div>
    <label class="stock-form-label">eOTP (optionnel)</label>
    <select class="stock-form-input conso-line-eotp"></select>
    <input class="stock-form-input conso-line-eotp-new stock-article-new" type="text" maxlength="30" placeholder="Nouveau code eOTP" hidden>
  `;
  const unitSel = details.querySelector('.conso-line-unit');
  for (const u of CONSO_UNITS) unitSel.appendChild(new Option(u, u));
  unitSel.value = 'u';
  // Dropdown eOTP basé sur le registre
  const eotpSel = details.querySelector('.conso-line-eotp');
  const eotpNew = details.querySelector('.conso-line-eotp-new');
  populateLineEOTPSelect(eotpSel);
  eotpSel.addEventListener('change', () => {
    if (eotpSel.value === NEW_ARTICLE_SENTINEL) {
      eotpNew.hidden = false;
      eotpNew.value = '';
      setTimeout(() => eotpNew.focus(), 50);
    } else {
      eotpNew.hidden = true;
      eotpNew.value = '';
    }
  });
  line.appendChild(details);

  const refInp   = details.querySelector('.conso-line-ref');
  const priceInp = details.querySelector('.conso-line-price');
  const priceEdit = details.querySelector('.conso-price-edit');

  // Clic crayon : ré-active la saisie du PU et mémorise l'intention de
  // mettre à jour le prix canonique au prochain submit. Les anciennes
  // entrées (autres commandes) conservent leur unitPrice historique.
  priceEdit.addEventListener('click', () => {
    line.dataset.priceUnlocked = '1';
    priceInp.readOnly = false;
    priceInp.classList.add('is-unlocked');
    priceEdit.hidden = true;
    setTimeout(() => { priceInp.focus(); priceInp.select(); }, 50);
  });

  sel.addEventListener('change', () => {
    // À tout changement de produit, on remet à zéro le déverrouillage
    delete line.dataset.priceUnlocked;
    priceInp.classList.remove('is-unlocked');
    priceEdit.hidden = true;
    if (sel.value === NEW_ARTICLE_SENTINEL) {
      // Nouveau produit : nom à saisir, ref et PU éditables et vides
      newInp.hidden = false;
      newInp.value = '';
      refInp.value = '';
      refInp.readOnly = false;
      priceInp.value = '';
      priceInp.readOnly = false;
      unitSel.value = 'u';
      details.hidden = false;
      setTimeout(() => newInp.focus(), 50);
    } else if (sel.value) {
      // Produit existant : on lit le registre, ref/PU readonly si déjà set
      newInp.hidden = true;
      newInp.value = '';
      const canonical = getConsoProduct(sel.value);
      refInp.value    = canonical?.reference || '';
      refInp.readOnly = !!(canonical && canonical.reference);
      const hasCanonPrice = !!(canonical && canonical.unitPrice > 0);
      priceInp.value  = hasCanonPrice ? fmtPriceForInput(canonical.unitPrice) : '';
      priceInp.readOnly = hasCanonPrice;
      // Crayon visible uniquement quand un prix canonique est verrouillé
      priceEdit.hidden = !hasCanonPrice;
      unitSel.value   = getMostRecentUnitForProduct(sel.value);
      details.hidden = false;
    } else {
      // Aucune sélection (placeholder) → cache les détails
      newInp.hidden = true;
      newInp.value = '';
      details.hidden = true;
    }
  });

  return line;
}
function populateLineProductSelect(sel) {
  sel.innerHTML = '';
  const products = getAllConsoProducts();
  const placeholder = new Option('Choisir un produit…', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  sel.appendChild(placeholder);
  for (const p of products) {
    const text = p.reference ? `${p.name} (${p.reference})` : p.name;
    sel.appendChild(new Option(text, p.name));
  }
  sel.appendChild(new Option('+ Nouveau produit…', NEW_ARTICLE_SENTINEL));
}
function populateLineEOTPSelect(sel) {
  sel.innerHTML = '';
  // « Aucun » par défaut (eOTP optionnel)
  const none = new Option('— Aucun —', '');
  none.selected = true;
  sel.appendChild(none);
  const eotps = getEOTPs().slice().sort((a, b) => (a.code || '').localeCompare(b.code || '', 'fr'));
  for (const e of eotps) {
    if (!e.code) continue;
    sel.appendChild(new Option(eotpDisplay(e), e.code));
  }
  sel.appendChild(new Option('+ Nouveau eOTP…', NEW_ARTICLE_SENTINEL));
}
function addOrderLine() {
  const container = document.getElementById('consoorderlines');
  if (!container) return;
  container.appendChild(buildOrderLine());
  refreshOrderLineNumbers();
}
function removeOrderLine(lineEl) {
  const container = document.getElementById('consoorderlines');
  if (!container) return;
  if (container.children.length <= 1) return;
  lineEl.remove();
  refreshOrderLineNumbers();
}
function refreshOrderLineNumbers() {
  const lines = document.querySelectorAll('.conso-order-line');
  lines.forEach((line, idx) => {
    line.querySelector('.conso-line-num').textContent = `Ligne ${idx + 1}`;
    line.querySelector('.conso-line-remove').hidden = (lines.length === 1);
  });
}

function submitConsommableOrder() {
  const date = document.getElementById('consoorderdate').value;
  if (!date) { showToast('Date requise', 'error'); return; }
  const notes = document.getElementById('consoordernotes').value.trim();
  const lineEls = Array.from(document.querySelectorAll('.conso-order-line'));
  const parsed = [];
  for (const el of lineEls) {
    const sel    = el.querySelector('.conso-line-product');
    const newInp = el.querySelector('.conso-line-product-new');
    const ref    = el.querySelector('.conso-line-ref').value.trim();
    const qtyStr = el.querySelector('.conso-line-qty').value;
    const unit   = el.querySelector('.conso-line-unit').value;
    const priceStr = el.querySelector('.conso-line-price').value;
    // eOTP : dropdown du registre + champ texte (caché sauf si « + Nouveau »)
    const eotpSel = el.querySelector('.conso-line-eotp');
    const eotpNew = el.querySelector('.conso-line-eotp-new');
    let eOTP = '';
    if (eotpNew && !eotpNew.hidden) eOTP = eotpNew.value.trim();
    else if (eotpSel && eotpSel.value && eotpSel.value !== NEW_ARTICLE_SENTINEL) eOTP = eotpSel.value;

    let product = '';
    if (newInp && !newInp.hidden) product = newInp.value.trim();
    else if (sel.value && sel.value !== NEW_ARTICLE_SENTINEL) product = sel.value;

    if (!product && !qtyStr && !priceStr) continue; // ligne vide ignorée
    if (!product) { showToast(`Ligne ${parsed.length + 1} : produit requis`, 'error'); return; }
    const q = parseFloat(String(qtyStr).replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) { showToast(`« ${product} » : quantité invalide`, 'error'); return; }
    const p = parseFloat(String(priceStr).replace(',', '.'));
    if (!Number.isFinite(p) || p < 0) { showToast(`« ${product} » : prix invalide`, 'error'); return; }

    // Si l'utilisateur a tapé un nom déjà existant via « Nouveau »,
    // on respecte le registre canonique (ref + PU) pour ne pas
    // diverger silencieusement. Sinon on enregistre les valeurs
    // saisies dans le registre pour les futurs réemplois.
    // Exception : si le crayon PU a été cliqué, on accepte le prix
    // saisi et on marquera la ligne pour MAJ du registre au commit.
    const canonical = getConsoProduct(product);
    const priceUnlocked = el.dataset.priceUnlocked === '1';
    let finalRef = ref;
    let finalPrice = p;
    if (canonical) {
      if (canonical.reference) finalRef = canonical.reference;
      if (canonical.unitPrice > 0 && !priceUnlocked) finalPrice = canonical.unitPrice;
    }

    parsed.push({ product, reference: finalRef, qty: q, unit: unit || 'u', unitPrice: finalPrice, eOTP, priceOverride: priceUnlocked });
  }
  if (parsed.length === 0) { showToast('Aucune ligne à enregistrer', 'error'); return; }

  if (!Array.isArray(state.consommableEntries)) state.consommableEntries = [];
  // Mode édition : on remplace les entrées de la commande existante par
  // les nouvelles lignes parsées (mêmes orderId/date/notes appliqués).
  const isEditing = !!editingOrderId;
  const orderId = isEditing ? editingOrderId : ('order_' + uid());
  if (isEditing) {
    state.consommableEntries = state.consommableEntries.filter(e => getEntryOrderId(e) !== orderId);
  }
  for (const line of parsed) {
    // Insère ou complète le registre canonique (n'écrase pas les
    // valeurs déjà saisies). Si l'utilisateur a explicitement mis à
    // jour le prix via le crayon, on FORCE l'écrasement du PU canonique
    // (les anciennes entrées d'autres commandes conservent leur prix
    // historique, déjà stocké dans entry.unitPrice).
    upsertConsoProduct({ name: line.product, reference: line.reference, unitPrice: line.unitPrice });
    if (line.priceOverride) {
      const canonical = getConsoProduct(line.product);
      if (canonical) canonical.unitPrice = line.unitPrice;
    }
    // Enregistre un nouveau code eOTP s'il n'est pas connu (sans budget
    // ni libellé, à compléter dans Données → eOTP)
    if (line.eOTP && !getEOTP(line.eOTP)) {
      state.eotps.push({ id: 'eotp_' + uid(), code: line.eOTP, label: '', budget: 0 });
    }
    state.consommableEntries.push({
      id: uid(), orderId, date, notes,
      product: line.product, reference: line.reference,
      qty: line.qty, unit: line.unit, unitPrice: line.unitPrice,
      eOTP: line.eOTP
    });
  }
  save();
  renderConsommable();
  showToast(isEditing
    ? `Commande mise à jour (${parsed.length} ligne${parsed.length > 1 ? 's' : ''})`
    : `Commande enregistrée (${parsed.length} ligne${parsed.length > 1 ? 's' : ''})`);
  closeConsommableSheet();
}

function incrementCount(companyId) {
  const date = state.currentDate;
  if (!state.presences[date]) state.presences[date] = [];
  let entry = state.presences[date].find(e => e.companyId === companyId);
  if (!entry) {
    entry = { id: uid(), companyId, count: 0 };
    state.presences[date].push(entry);
  }
  if (entry.count >= 999) return;
  entry.count++;
  save();
  renderEntries();
  renderChart();
  renderRecapTable();
}

function decrementCount(companyId) {
  const date = state.currentDate;
  const entries = state.presences[date];
  if (!entries) return;
  const idx = entries.findIndex(e => e.companyId === companyId);
  if (idx < 0) return;
  entries[idx].count--;
  if (entries[idx].count <= 0) {
    entries.splice(idx, 1);
    if (entries.length === 0) delete state.presences[date];
  }
  save();
  renderEntries();
  renderChart();
  renderRecapTable();
}

// Migration : fusionne les doublons éventuels (d'anciennes données pouvaient
// contenir plusieurs entrées pour la même entreprise à la même date)
function migratePresences() {
  for (const date of Object.keys(state.presences)) {
    const entries = state.presences[date];
    if (!Array.isArray(entries)) continue;
    const byCompany = new Map();
    for (const entry of entries) {
      const existing = byCompany.get(entry.companyId);
      if (existing) existing.count += entry.count;
      else byCompany.set(entry.companyId, { id: entry.id, companyId: entry.companyId, count: entry.count });
    }
    state.presences[date] = Array.from(byCompany.values());
    if (state.presences[date].length === 0) delete state.presences[date];
  }
}

// ---------- Date navigation ----------
function shiftDate(days) {
  const d = fromISO(state.currentDate);
  d.setDate(d.getDate() + days);
  state.currentDate = toISO(d);
  renderDate();
  renderEntries();
}

// ---------- Toast ----------
let toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- Tabs ----------
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  window.scrollTo({ top: 0, behavior: 'instant' });
  // Si la tab bar est scrollable horizontalement, on amène le bouton
  // actif dans la zone visible pour éviter qu'il soit hors-champ après
  // la sélection.
  const activeBtn = document.querySelector(`.tab-btn.active[data-page="${name}"]`);
  if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
    activeBtn.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }
  if (name === 'avancement') renderAvancement();
  if (name === 'administratif') renderAdministratif();
  if (name === 'stock') renderStock();
  if (name === 'consommable') renderConsommable();
  if (name === 'dashboard') renderDashboard();
  if (name === 'proto') renderProto();
  if (name === 'cr') renderCR();
  if (name === 'st') renderST();
  if (name === 'devis') renderDevis();
  if (name === 'travaux') renderTravaux();
  // Synchro : à chaque changement d'onglet, on tente un pull en arrière-
  // plan pour récupérer les dernières modifs des coéquipiers.
  if (isSupabaseConfigured()) {
    withTimeout(doSyncPull(), 'pull tab change').catch(err => console.warn('[Sync] pull tab change KO', err));
  }
}

// ---------- Import / Export ----------
function exportData() {
  const data = {
    companies: state.companies,
    zones: state.zones,
    taskSetups: state.taskSetups,
    zoneOuvrages: state.zoneOuvrages,
    zoneCollapsed: state.zoneCollapsed,
    taskProgress: state.taskProgress,
    zoneUpdated: state.zoneUpdated,
    presences: state.presences,
    adminDocs: state.adminDocs,
    workers: state.workers,
    workerDocs: state.workerDocs,
    docs: state.docs,
    echeckinCollapsed: state.echeckinCollapsed,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chantier-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Export réussi');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.companies || !data.presences) throw new Error('Format invalide');
      if (!confirm('Importer ce fichier remplacera vos données actuelles. Continuer ?')) return;
      state.companies = data.companies;
      state.zones = data.zones || [];
      state.taskSetups = data.taskSetups || [];
      state.currentSetupId = data.currentSetupId || null;
      state.zoneOuvrages = data.zoneOuvrages || {};
      // Compat. anciens exports (un ouvrage / qty séparés par zone)
      state._legacyZoneSetup = data.zoneSetup;
      state._legacyZoneQty = data.zoneQty;
      state.zoneCollapsed = data.zoneCollapsed || {};
      state.taskProgress = data.taskProgress || {};
      state.zoneUpdated = data.zoneUpdated || {};
      state.avancementZoneId = null;
      state.presences = data.presences;
      state.weather = data.weather || {};
      state.stockEntries = data.stockEntries || [];
      state.stockArticles = (data.stockArticles && typeof data.stockArticles === 'object') ? data.stockArticles : {};
      state.stockSettings = (data.stockSettings && typeof data.stockSettings === 'object') ? data.stockSettings : { alertDays: 7, coverDays: 15 };
      state.consommableEntries = data.consommableEntries || [];
      state.consoProducts = data.consoProducts || [];
      state.eotps = data.eotps || [];
      state.eotpRegistryInitialized = data.eotpRegistryInitialized === true;
      state.eotpUnitsInitialized = data.eotpUnitsInitialized === true;
      state.consoRecapMode = (data.consoRecapMode === 'eotp') ? 'eotp' : 'product';
      state.projectStart = typeof data.projectStart === 'string' ? data.projectStart : '';
      state.projectEnd   = typeof data.projectEnd   === 'string' ? data.projectEnd   : '';
      state.workBatches  = Array.isArray(data.workBatches) ? data.workBatches : [];
      state.protoFolders = Array.isArray(data.protoFolders) ? data.protoFolders : [];
      state.protoPlans   = Array.isArray(data.protoPlans) ? data.protoPlans : [];
      state.protoActivePlanId   = typeof data.protoActivePlanId === 'string' ? data.protoActivePlanId : '';
      state.protoFilterLotId    = typeof data.protoFilterLotId  === 'string' ? data.protoFilterLotId  : '';
      state.protoFilterTitle    = typeof data.protoFilterTitle  === 'string' ? data.protoFilterTitle  : '';
      state.protoFilterStatuses = Array.isArray(data.protoFilterStatuses) ? data.protoFilterStatuses : ['todo','doing','done'];
      state.protoPlan    = typeof data.protoPlan === 'string' ? data.protoPlan : '';
      state.protoPlanW   = Number.isFinite(data.protoPlanW) ? data.protoPlanW : 0;
      state.protoPlanH   = Number.isFinite(data.protoPlanH) ? data.protoPlanH : 0;
      state.protoShapes  = Array.isArray(data.protoShapes) ? data.protoShapes : [];
      migrateProtoPlansFromLegacy();
      state.adminDocs = data.adminDocs || {};
      state.workers = data.workers || [];
      state.workerDocs = data.workerDocs || {};
      state.docs = (data.docs && data.docs.length > 0) ? data.docs
        : ['doc1', 'doc2', 'doc3', 'doc4'].map(id => ({
            id,
            label: data.docLabels?.[id] || ('Doc ' + id.replace('doc', '')),
            type: data.docTypes?.[id] || 'echeance',
            scope: 'both',
            required: true
          }));
      for (const d of state.docs) if (typeof d.required !== 'boolean') d.required = true;
      state.echeckinCollapsed = data.echeckinCollapsed || {};
      // Compat. anciens exports (liste de tâches unique)
      state._legacyTasks = data.tasks;
      state._legacyZoneHasTasks = data.zoneHasTasks;
      migrateSetups();
      migrateConsoProductsFromEntries();
  migrateEOTPsFromConsoEntries();
  migrateEOTPUnits();
      save();
      renderAll();
      showToast('Import réussi');
    } catch (e) {
      showToast('Fichier invalide', 'error');
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('Effacer TOUTES les données (entreprises, zones, tâches, avancements et présences) ?\nCette action est irréversible.')) return;
  state.companies = [];
  state.zones = [];
  state.taskSetups = [];
  state.currentSetupId = null;
  state.zoneOuvrages = {};
  state.zoneCollapsed = {};
  state.taskProgress = {};
  state.zoneUpdated = {};
  state.avancementZoneId = null;
  state.presences = {};
  state.weather = {};
  state.stockEntries = [];
  state.stockArticles = {};
  state.stockSettings = { alertDays: 7, coverDays: 15 };
  state.consommableEntries = [];
  state.consoProducts = [];
  state.eotps = [];
  state.eotpRegistryInitialized = false;
  state.eotpUnitsInitialized = false;
  state.recapPeriod = '7';
  state.recapCurveMode = 'pct';
  state.recapCurveZoom = 'auto';
  state.consoRecapMode = 'product';
  state.projectStart = '';
  state.projectEnd = '';
  state.workBatches = [];
  state.protoFolders = [];
  state.protoPlans = [];
  state.protoActivePlanId = '';
  state.protoFilterLotId = '';
  state.protoFilterTitle = '';
  state.protoFilterStatuses = ['todo', 'doing', 'done'];
  state.protoPlan = '';
  state.protoPlanW = 0;
  state.protoPlanH = 0;
  state.protoShapes = [];
  state.adminDocs = {};
  state.workers = [];
  state.workerDocs = {};
  state.docs = [
    { id: 'doc1', label: 'Doc 1', type: 'echeance', scope: 'both', required: true },
    { id: 'doc2', label: 'Doc 2', type: 'echeance', scope: 'both', required: true },
    { id: 'doc3', label: 'Doc 3', type: 'echeance', scope: 'both', required: true },
    { id: 'doc4', label: 'Doc 4', type: 'echeance', scope: 'both', required: true }
  ];
  state.echeckinCollapsed = {};
  migrateSetups();
  save();
  renderAll();
  showToast('Données effacées');
}

// ====================================================================
//   PROTO — Plans + tâches géolocalisées (prototype expérimental)
// ====================================================================
//
// Modèle : un plan (data URL JPEG, compressé à 1920px max) + des
// formes vectorielles dessinées par-dessus dans un SVG calé sur les
// dimensions naturelles de l'image (viewBox = px naturels). Cela
// rend le rendu résolution-indépendant : la même forme à la même
// position que le plan soit affiché à 100 % ou redimensionné.
//
// Chaque forme porte des métadonnées (lot de travaux, intitulé, date,
// statut) éditables via un bottom sheet. Le statut détermine la
// couleur de remplissage (todo=rouge, doing=orange, done=vert).

const PROTO_STATUS_LIST = ['todo', 'doing', 'done'];
const PROTO_STATUS_LABEL = { todo: 'À faire', doing: 'En cours', done: 'Réalisée' };
const PROTO_STATUS_COLOR = { todo: '#d32f2f', doing: '#ed6c02', done: '#2e7d32' };
const PROTO_MAX_PLAN_DIM = 1920; // px max sur le plus grand côté
const PROTO_DEFAULT_LOT_COLORS = ['#0a84ff', '#ff9500', '#5856d6', '#34c759', '#ff2d55', '#af52de'];

// État UI (non persisté) du Proto
let protoTool = 'select';   // 'select' | 'point' | 'line' | 'rect' | 'polygon' | 'polyline'
// Mode série : quand activé, le 1er sheet d'édition d'une forme capture
// les valeurs (lot/intitulé/statut/date) et les applique automatiquement
// aux formes suivantes — pratique pour saisir beaucoup de tâches en
// rafale avec la même catégorisation.
let protoSeriesMode = false;
let protoSeriesDefaults = null;  // { lotId, title, date, status }
let protoDrawing = null;    // état pendant un dessin (rect/line)
let protoPolyDraw = null;   // état pendant un dessin de polygone (multi-clics)
let protoEditingShapeId = null;
// État du viewport (zoom/pan). Non persisté — réinitialisé au reload.
let protoView = { scale: 1, tx: 0, ty: 0 };
const PROTO_ZOOM_MIN = 0.5;
const PROTO_ZOOM_MAX = 8;
// Suivi des pointers actifs pour différencier draw/pan/pinch.
// Chaque entrée porte un timestamp `t` rafraîchi à chaque pointermove —
// permet d'évincer les pointers fantômes (iOS Safari peut oublier
// d'émettre un pointerup quand l'OS intercepte la séquence ou qu'un
// modal s'ouvre, laissant une entrée stale qui fait croire à un pinch
// avec un seul doigt).
const protoActivePointers = new Map(); // pointerId → { x, y, t }
const PROTO_POINTER_STALE_MS = 2000;
let protoPinch = null;      // { lastDist, lastCx, lastCy }
let protoPan = null;        // { startClientX, startClientY, startTx, startTy, pointerId }
function evictStaleProtoPointers() {
  const now = Date.now();
  for (const [id, info] of Array.from(protoActivePointers.entries())) {
    if (now - (info.t || 0) > PROTO_POINTER_STALE_MS) {
      protoActivePointers.delete(id);
    }
  }
  if (protoActivePointers.size < 2) protoPinch = null;
}

// ---------- Lots de travaux (Données → Lots) ----------
function getWorkBatches() { return Array.isArray(state.workBatches) ? state.workBatches : []; }
function getWorkBatch(id) { return getWorkBatches().find(l => l.id === id) || null; }
function addWorkBatch() {
  if (!Array.isArray(state.workBatches)) state.workBatches = [];
  const used = new Set(state.workBatches.map(l => l.color));
  const color = PROTO_DEFAULT_LOT_COLORS.find(c => !used.has(c)) || PROTO_DEFAULT_LOT_COLORS[state.workBatches.length % PROTO_DEFAULT_LOT_COLORS.length];
  state.workBatches.push({ id: 'lot_' + uid(), name: '', color });
  save();
  renderWorkBatchesConfig();
}
function removeWorkBatch(id) {
  const lot = getWorkBatch(id);
  if (!lot) return;
  if (!confirm(`Supprimer le lot « ${lot.name || 'sans nom'} » ?\nLes formes du Proto qui le référencent garderont leur couleur historique mais le lot ne sera plus proposé.`)) return;
  state.workBatches = getWorkBatches().filter(l => l.id !== id);
  save();
  renderWorkBatchesConfig();
}
function setWorkBatchName(id, name) {
  const lot = getWorkBatch(id);
  if (!lot) return;
  lot.name = (name || '').trim();
  save();
}
function setWorkBatchColor(id, color) {
  const lot = getWorkBatch(id);
  if (!lot) return;
  lot.color = color;
  save();
  renderProtoSVG(); // les formes du plan changent de couleur
}
function setWorkBatchCompany(id, companyId) {
  const lot = getWorkBatch(id);
  if (!lot) return;
  lot.companyId = companyId || null;
  save();
  // Si on est sur l'onglet CR, l'aperçu Avancements peut changer
  if (document.getElementById('page-cr')?.classList.contains('active')) renderCR();
}

function renderWorkBatchesConfig() {
  const list = document.getElementById('lotslist');
  if (!list) return;
  list.innerHTML = '';
  const lots = getWorkBatches();
  if (lots.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'eotp-empty';
    empty.textContent = 'Aucun lot de travaux. Tapez « + Ajouter » pour en créer.';
    list.appendChild(empty);
    return;
  }
  for (const lot of lots) list.appendChild(buildLotRow(lot));
}
function buildLotRow(lot) {
  const li = document.createElement('li');
  li.className = 'lot-row';
  li.setAttribute('data-lot-id', lot.id);
  li.innerHTML = `
    <input class="lot-color" type="color" aria-label="Couleur du lot">
    <input class="lot-name" type="text" maxlength="40" placeholder="Plomberie, Électricité, Cloisons…">
    <select class="lot-company" aria-label="Entreprise rattachée à ce lot"></select>
    <button class="eotp-remove lot-remove" type="button" aria-label="Supprimer ce lot">
      <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
    </button>
  `;
  const color = li.querySelector('.lot-color');
  const name  = li.querySelector('.lot-name');
  const comp  = li.querySelector('.lot-company');
  color.value = lot.color || '#0a84ff';
  name.value  = lot.name  || '';
  // Options : « — Aucune — » + toutes les entreprises
  const optNone = document.createElement('option');
  optNone.value = '';
  optNone.textContent = '— Aucune —';
  comp.appendChild(optNone);
  for (const c of state.companies) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    comp.appendChild(o);
  }
  comp.value = lot.companyId || '';
  color.addEventListener('input', () => setWorkBatchColor(lot.id, color.value));
  name.addEventListener('input',  () => setWorkBatchName(lot.id, name.value));
  comp.addEventListener('change', () => setWorkBatchCompany(lot.id, comp.value));
  li.querySelector('.lot-remove').addEventListener('click', () => removeWorkBatch(lot.id));
  return li;
}

// ---------- Dossiers + plans (multi-plans) ----------
function getProtoFolders() { return Array.isArray(state.protoFolders) ? state.protoFolders : []; }
function getProtoPlans()   { return Array.isArray(state.protoPlans)   ? state.protoPlans   : []; }
function getProtoFolder(id){ return getProtoFolders().find(f => f.id === id) || null; }
function getProtoPlan(id)  { return getProtoPlans().find(p => p.id === id) || null; }
function getActiveProtoPlan() {
  const id = state.protoActivePlanId;
  if (!id) return null;
  return getProtoPlan(id);
}
function getPlansInFolder(folderId) {
  return getProtoPlans().filter(p => p.folderId === folderId);
}
function ensureDefaultFolder() {
  if (getProtoFolders().length > 0) return getProtoFolders()[0];
  if (!Array.isArray(state.protoFolders)) state.protoFolders = [];
  const folder = { id: 'fld_' + uid(), name: 'Mes plans' };
  state.protoFolders.push(folder);
  return folder;
}
function addProtoFolder() {
  if (!Array.isArray(state.protoFolders)) state.protoFolders = [];
  const folder = { id: 'fld_' + uid(), name: 'Nouveau dossier' };
  state.protoFolders.push(folder);
  save();
  renderProtoManager();
  renderProtoPlanSelector();
}
function renameProtoFolder(id, name) {
  const f = getProtoFolder(id);
  if (!f) return;
  f.name = (name || '').trim();
  save();
  renderProtoPlanSelector();
}
function removeProtoFolder(id) {
  const f = getProtoFolder(id);
  if (!f) return;
  const plansInside = getPlansInFolder(id);
  const nbShapes = state.protoShapes.filter(s => plansInside.some(p => p.id === s.planId)).length;
  const msg = `Supprimer le dossier « ${f.name || 'sans nom'} » avec ${plansInside.length} plan(s) et ${nbShapes} forme(s) ?`;
  if (!confirm(msg)) return;
  const ids = new Set(plansInside.map(p => p.id));
  state.protoPlans = getProtoPlans().filter(p => p.folderId !== id);
  state.protoShapes = state.protoShapes.filter(s => !ids.has(s.planId));
  state.protoFolders = getProtoFolders().filter(x => x.id !== id);
  for (const pid of ids) deletePlanImageEverywhere(pid);
  // Si le plan actif a disparu, en choisit un autre
  if (!getActiveProtoPlan()) state.protoActivePlanId = (getProtoPlans()[0]?.id) || '';
  save();
  renderProtoManager();
  renderProto();
}
function renameProtoPlan(id, name) {
  const p = getProtoPlan(id);
  if (!p) return;
  p.name = (name || '').trim();
  save();
  renderProtoPlanSelector();
}
function removeProtoPlan(id) {
  const p = getProtoPlan(id);
  if (!p) return;
  const nb = state.protoShapes.filter(s => s.planId === id).length;
  if (!confirm(`Supprimer le plan « ${p.name || 'sans nom'} » et ses ${nb} forme(s) ?`)) return;
  state.protoPlans = getProtoPlans().filter(x => x.id !== id);
  state.protoShapes = state.protoShapes.filter(s => s.planId !== id);
  deletePlanImageEverywhere(id);
  if (state.protoActivePlanId === id) {
    state.protoActivePlanId = (getProtoPlans()[0]?.id) || '';
  }
  save();
  renderProtoManager();
  renderProto();
}
function setActiveProtoPlan(id) {
  const p = getProtoPlan(id);
  if (!p) return;
  state.protoActivePlanId = id;
  // Reset du viewport pour ne pas garder le zoom du plan précédent
  protoView = { scale: 1, tx: 0, ty: 0 };
  cancelProtoInProgress();
  save();
  renderProto();
  applyProtoView();
}
// Migration douce : si l'utilisateur avait un plan via les anciens
// champs protoPlan/W/H (v0.63), on le déplace dans un dossier par
// défaut et on associe les formes existantes au nouveau plan.
function migrateProtoPlansFromLegacy() {
  if (!state.protoPlan) return;            // rien à migrer
  if (getProtoPlans().length > 0) return;  // déjà migré
  const folder = ensureDefaultFolder();
  const plan = {
    id: 'pln_' + uid(), folderId: folder.id, name: 'Plan',
    dataUrl: state.protoPlan, w: state.protoPlanW, h: state.protoPlanH
  };
  state.protoPlans.push(plan);
  state.protoActivePlanId = plan.id;
  // Associe les formes orphelines au plan migré
  for (const sh of (state.protoShapes || [])) {
    if (!sh.planId) sh.planId = plan.id;
  }
  // Vide les champs hérités pour libérer la place (le contenu est
  // désormais dans state.protoPlans[0].dataUrl)
  state.protoPlan = '';
  state.protoPlanW = 0;
  state.protoPlanH = 0;
}

// ---------- Filtres ----------
function shapeMatchesFilters(sh) {
  if (state.protoFilterLotId && sh.lotId !== state.protoFilterLotId) return false;
  if (state.protoFilterTitle && (sh.title || '').trim() !== state.protoFilterTitle) return false;
  if (Array.isArray(state.protoFilterStatuses) && !state.protoFilterStatuses.includes(sh.status || 'todo')) return false;
  return true;
}
function setProtoFilterLot(id) {
  state.protoFilterLotId = id || '';
  // Si le filtre titre courant n'existe pas dans le nouveau lot filtré,
  // on le réinitialise pour éviter un SVG vide silencieux. Sinon on le
  // garde — pratique pour passer d'un lot à l'autre avec la même tâche.
  if (state.protoFilterTitle) {
    const plan = getActiveProtoPlan();
    if (plan) {
      const stillThere = (state.protoShapes || []).some(s =>
        s.planId === plan.id &&
        (s.title || '').trim() === state.protoFilterTitle &&
        (!id || s.lotId === id));
      if (!stillThere) state.protoFilterTitle = '';
    }
  }
  save();
  renderProtoFilterBar();
  renderProtoSVG();
  renderProtoLegend();
}
function setProtoFilterTitle(title) {
  state.protoFilterTitle = (title || '').trim();
  save();
  renderProtoSVG();
  renderProtoLegend();
}
function toggleProtoFilterStatus(status) {
  if (!Array.isArray(state.protoFilterStatuses)) state.protoFilterStatuses = ['todo', 'doing', 'done'];
  const idx = state.protoFilterStatuses.indexOf(status);
  if (idx >= 0) state.protoFilterStatuses.splice(idx, 1);
  else state.protoFilterStatuses.push(status);
  save();
  refreshProtoFilterStatusBar();
  renderProtoSVG();
  renderProtoLegend();
}

// ---------- Rendu de la page Proto ----------
function renderProto() {
  const empty  = document.getElementById('protoempty');
  const editor = document.getElementById('protoeditor');
  if (!empty || !editor) return;
  const activePlan = getActiveProtoPlan();
  // S'il existe au moins un plan mais qu'aucun n'est actif, en active un.
  if (!activePlan && getProtoPlans().length > 0) {
    state.protoActivePlanId = getProtoPlans()[0].id;
    save();
  }
  const plan = getActiveProtoPlan();
  empty.hidden  = !!plan;
  editor.hidden = !plan;
  if (!plan) return;
  // Image + SVG calés sur la même viewBox = dimensions naturelles px.
  // L'image vient du cache mémoire ; sinon chargement asynchrone depuis
  // IndexedDB (ou le bucket Storage si elle vient d'un autre appareil).
  const img = document.getElementById('protoimage');
  const cachedImg = planImageCache.get(plan.id);
  if (cachedImg) {
    img.src = cachedImg;
  } else {
    // Pas d'image en cache : on évite un src vide (flash d'image cassée)
    // et on tente le chargement avec réessais (IDB → bucket Storage).
    img.removeAttribute('src');
    ensurePlanImageDisplayed(plan.id, img);
  }
  const svg = document.getElementById('protosvg');
  svg.setAttribute('viewBox', `0 0 ${plan.w} ${plan.h}`);
  renderProtoPlanSelector();
  renderProtoFilterBar();
  renderProtoSVG();
  renderProtoLegend();
  renderProtoRecap();
  refreshProtoToolbar();
  refreshProtoPolyHint();
  applyProtoView();
}

function renderProtoSVG() {
  const svg = document.getElementById('protosvg');
  if (!svg) return;
  svg.innerHTML = '';
  const planId = state.protoActivePlanId;
  if (!planId) return;
  // Ordre z : surfaces (rect/polygon) en bas, lignes/polylignes au
  // milieu, points au-dessus. Filtres lot + statut appliqués ici (les
  // formes filtrées disparaissent du DOM, donc ne reçoivent pas non
  // plus de clic).
  const orderRank = { rect: 0, polygon: 0, line: 1, polyline: 1, point: 2 };
  const shapes = (state.protoShapes || [])
    .filter(s => s.planId === planId)
    .filter(shapeMatchesFilters)
    .slice()
    .sort((a, b) => (orderRank[a.type] ?? 0) - (orderRank[b.type] ?? 0));
  for (const sh of shapes) svg.appendChild(buildShapeElement(sh));
}

function buildShapeElement(sh) {
  const ns = 'http://www.w3.org/2000/svg';
  const plan = getActiveProtoPlan();
  if (!plan) return document.createElementNS(ns, 'g');
  const lot = getWorkBatch(sh.lotId);
  const lotColor = lot ? lot.color : '#888';
  const statusColor = PROTO_STATUS_COLOR[sh.status] || PROTO_STATUS_COLOR.todo;
  // Taille réduite de 30% par rapport à v0.78 (demande utilisateur) :
  // points plus petits, traits plus fins pour rect/line/polygon/polyline.
  const sw = Math.max(plan.w, plan.h) / 200; // ref ~ 0.5% du plan
  const sw70 = sw * 0.7;                     // épaisseur trait réduite
  let el;
  if (sh.type === 'point') {
    el = document.createElementNS(ns, 'circle');
    el.setAttribute('cx', sh.coords.cx);
    el.setAttribute('cy', sh.coords.cy);
    el.setAttribute('r',  Math.max(sw * 1.75, 5.6));  // 30% plus petit
    el.setAttribute('fill', statusColor);
    el.setAttribute('stroke', lotColor);
    el.setAttribute('stroke-width', sw70);
  } else if (sh.type === 'line') {
    el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', sh.coords.x1);
    el.setAttribute('y1', sh.coords.y1);
    el.setAttribute('x2', sh.coords.x2);
    el.setAttribute('y2', sh.coords.y2);
    el.setAttribute('stroke', statusColor);
    el.setAttribute('stroke-width', sw * 1.4);  // 30% plus fin que sw*2
    el.setAttribute('stroke-linecap', 'round');
  } else if (sh.type === 'polygon') {
    el = document.createElementNS(ns, 'polygon');
    el.setAttribute('points', (sh.coords.points || []).map(p => `${p.x},${p.y}`).join(' '));
    el.setAttribute('fill', statusColor);
    el.setAttribute('fill-opacity', '0.25');
    el.setAttribute('stroke', statusColor);
    el.setAttribute('stroke-width', sw70);
    el.setAttribute('stroke-linejoin', 'round');
  } else if (sh.type === 'polyline') {
    // Polyligne = série de segments connectés, NON refermée
    el = document.createElementNS(ns, 'polyline');
    el.setAttribute('points', (sh.coords.points || []).map(p => `${p.x},${p.y}`).join(' '));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', statusColor);
    el.setAttribute('stroke-width', sw * 1.4);
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
  } else { // rect
    el = document.createElementNS(ns, 'rect');
    el.setAttribute('x', sh.coords.x);
    el.setAttribute('y', sh.coords.y);
    el.setAttribute('width',  sh.coords.w);
    el.setAttribute('height', sh.coords.h);
    el.setAttribute('fill', statusColor);
    el.setAttribute('fill-opacity', '0.25');
    el.setAttribute('stroke', statusColor);
    el.setAttribute('stroke-width', sw70);
  }
  el.classList.add('proto-shape');
  el.setAttribute('data-shape-id', sh.id);
  // L'ouverture du sheet est gérée dans protoPointerDown (réponse
  // immédiate au tap mobile, plus rapide qu'un événement 'click').
  return el;
}

function renderProtoLegend() {
  const el = document.getElementById('protolegend');
  if (!el) return;
  // Compteurs filtrés : reflètent les formes effectivement visibles
  // (filtres lot + statut appliqués). Une catégorie peut afficher 0
  // si elle est filtrée hors-vue.
  const counts = { todo: 0, doing: 0, done: 0 };
  const planId = state.protoActivePlanId;
  for (const sh of (state.protoShapes || [])) {
    if (sh.planId !== planId) continue;
    if (!shapeMatchesFilters(sh)) continue;
    if (counts[sh.status] != null) counts[sh.status]++;
  }
  const activeStatuses = new Set(state.protoFilterStatuses || []);
  el.innerHTML = '';
  for (const s of PROTO_STATUS_LIST) {
    const chip = document.createElement('span');
    chip.className = 'proto-legend-chip';
    if (!activeStatuses.has(s)) chip.classList.add('is-muted');
    chip.innerHTML = `<span class="proto-legend-dot" style="background:${PROTO_STATUS_COLOR[s]}"></span><span>${PROTO_STATUS_LABEL[s]} : <strong>${counts[s]}</strong></span>`;
    el.appendChild(chip);
  }
}

// ---------- Récap d'avancement (sous-onglet Proto → Récap) ----------
// Calcul des "volumes" par tâche selon le type dominant de ses formes :
//  - surface  : somme des aires (rect = w·h, polygon = formule du lacet)
//  - longueur : somme des longueurs euclidiennes des lignes
//  - compte   : nombre de points
// Une tâche est identifiée par son intitulé (title) — au sein d'un même
// lot, deux formes avec le même intitulé sont agrégées.
function polygonAreaProto(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area / 2);
}
function shapeRawValue(s) {
  // Retourne la "quantité" brute selon le type de la forme
  if (s.type === 'rect')    return { surface: (s.coords.w || 0) * (s.coords.h || 0) };
  if (s.type === 'polygon') return { surface: polygonAreaProto(s.coords.points) };
  if (s.type === 'line')    return { length: Math.hypot(s.coords.x2 - s.coords.x1, s.coords.y2 - s.coords.y1) };
  if (s.type === 'polyline') {
    // Longueur = somme des segments. Une polyligne avec < 2 sommets
    // n'existe pas (filtré dans finishPolyline) mais on est défensif.
    const pts = (s.coords && s.coords.points) || [];
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
    }
    return { length: len };
  }
  if (s.type === 'point')   return { count: 1 };
  return {};
}
function dominantTaskType(shapes) {
  // Type dominant = celui qui apparaît le plus, surface en cas d'égalité
  const c = { surface: 0, length: 0, count: 0 };
  for (const s of shapes) {
    if (s.type === 'rect' || s.type === 'polygon') c.surface++;
    else if (s.type === 'line' || s.type === 'polyline') c.length++;
    else if (s.type === 'point') c.count++;
  }
  if (c.surface >= c.length && c.surface >= c.count && c.surface > 0) return 'surface';
  if (c.length >= c.count && c.length > 0) return 'length';
  if (c.count > 0) return 'count';
  return null;
}
function fmtRecapVolume(type, value) {
  // Affichage compact ; les unités sont en pixels-plan tant qu'on n'a
  // pas calibré une échelle réelle. On formatte avec K si très grand.
  if (value == null) return '—';
  let txt;
  if (type === 'surface') {
    txt = (value >= 100000 ? (value / 1000).toFixed(1) + 'k' : Math.round(value).toLocaleString('fr-FR')) + ' u²';
  } else if (type === 'length') {
    txt = (value >= 100000 ? (value / 1000).toFixed(1) + 'k' : Math.round(value).toLocaleString('fr-FR')) + ' u';
  } else {
    txt = value + (value > 1 ? ' points' : ' point');
  }
  return txt;
}
function getProtoRecapData(planId) {
  // Filtre les formes du plan + filtre les formes avec un type
  // reconnu, puis groupe par lotId → title.
  const shapes = (state.protoShapes || []).filter(s => s.planId === planId);
  // Map<lotId, Map<title, [shapes…]>>
  const byLot = new Map();
  for (const s of shapes) {
    const lotKey = s.lotId || '';
    const titleKey = (s.title || '').trim();
    if (!byLot.has(lotKey)) byLot.set(lotKey, new Map());
    const byTitle = byLot.get(lotKey);
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, []);
    byTitle.get(titleKey).push(s);
  }
  const lots = [];
  for (const [lotId, byTitle] of byLot.entries()) {
    const lot = lotId ? getWorkBatch(lotId) : null;
    const tasks = [];
    for (const [title, taskShapes] of byTitle.entries()) {
      const type = dominantTaskType(taskShapes);
      if (!type) continue;
      const vols = { todo: 0, doing: 0, done: 0 };
      const counts = { todo: 0, doing: 0, done: 0 };
      let total = 0;
      for (const s of taskShapes) {
        // N'agrège que les formes correspondant au type dominant —
        // une ligne « parasite » dans une tâche surface est ignorée.
        const v = shapeRawValue(s);
        const value = v[type] || 0;
        if (value <= 0 && type !== 'count') continue;
        const st = (s.status || 'todo');
        vols[st] = (vols[st] || 0) + value;
        counts[st] = (counts[st] || 0) + 1;
        total += value;
      }
      if (total <= 0) continue;
      const pct = {
        todo:  total > 0 ? (vols.todo  / total) * 100 : 0,
        doing: total > 0 ? (vols.doing / total) * 100 : 0,
        done:  total > 0 ? (vols.done  / total) * 100 : 0
      };
      tasks.push({ title, type, total, vols, counts, pct });
    }
    if (tasks.length === 0) continue;
    // Tri tâches : terminées en dernier ? Non — alphabétique par nom.
    tasks.sort((a, b) => (a.title || 'ZZZ').localeCompare(b.title || 'ZZZ', 'fr'));
    lots.push({
      lotId,
      name: lot ? (lot.name || '(sans nom)') : '',
      color: lot ? lot.color : '#9aa0a6',
      tasks
    });
  }
  // Tri lots : alphabétique ; ceux sans lot en dernier
  lots.sort((a, b) => {
    if (!a.lotId && !b.lotId) return 0;
    if (!a.lotId) return 1;
    if (!b.lotId) return -1;
    return (a.name || '').localeCompare(b.name || '', 'fr');
  });
  return lots;
}

function renderProtoRecap() {
  renderProtoRecapSlider();
  const body = document.getElementById('protorecapbody');
  if (!body) return;
  body.innerHTML = '';
  const plan = getActiveProtoPlan();
  if (!plan) {
    body.innerHTML = `
      <div class="proto-recap-empty">
        <p>Aucun plan disponible.</p>
        <p class="hint">Téléversez un plan dans le sous-onglet « Plans » pour commencer.</p>
      </div>`;
    return;
  }
  const lots = getProtoRecapData(plan.id);
  if (lots.length === 0) {
    body.innerHTML = `
      <div class="proto-recap-empty">
        <p>Aucune tâche documentée sur ce plan.</p>
        <p class="hint">Posez des formes (point/ligne/rect/polygone) et renseignez intitulé + lot + statut pour faire apparaître l'avancement ici.</p>
      </div>`;
    return;
  }
  // Stats globales du plan : pourcentage global = moyenne pondérée
  // des % done de chaque tâche, pondérée par leur volume total.
  let totalVol = 0, doneVol = 0, doingVol = 0, todoVol = 0, taskCount = 0;
  for (const lot of lots) for (const t of lot.tasks) {
    totalVol  += t.total;
    doneVol   += t.vols.done;
    doingVol  += t.vols.doing;
    todoVol   += t.vols.todo;
    taskCount += 1;
  }
  const globalPct = totalVol > 0 ? Math.round((doneVol / totalVol) * 100) : 0;
  const stats = document.createElement('div');
  stats.className = 'proto-recap-plan-stats';
  stats.innerHTML = `
    <div class="proto-recap-plan-stat">
      <div class="proto-recap-plan-stat-value" id="prps-pct"></div>
      <div class="proto-recap-plan-stat-label">avancement</div>
    </div>
    <div class="proto-recap-plan-stat">
      <div class="proto-recap-plan-stat-value" id="prps-tasks"></div>
      <div class="proto-recap-plan-stat-label">tâches</div>
    </div>
    <div class="proto-recap-plan-stat">
      <div class="proto-recap-plan-stat-value" id="prps-lots"></div>
      <div class="proto-recap-plan-stat-label">lots</div>
    </div>
  `;
  stats.querySelector('#prps-pct').textContent  = globalPct + ' %';
  stats.querySelector('#prps-tasks').textContent = taskCount;
  stats.querySelector('#prps-lots').textContent  = lots.length;
  body.appendChild(stats);
  for (const lot of lots) body.appendChild(buildRecapLotCard(lot));
}
function buildRecapLotCard(lot) {
  const card = document.createElement('section');
  card.className = 'proto-recap-lot' + (lot.lotId ? '' : ' is-none');
  if (lot.lotId) card.style.borderLeftColor = lot.color || 'var(--accent)';
  // Agrégat lot : % done global du lot
  let lotTotal = 0, lotDone = 0;
  for (const t of lot.tasks) { lotTotal += t.total; lotDone += t.vols.done; }
  const lotPct = lotTotal > 0 ? Math.round((lotDone / lotTotal) * 100) : 0;
  const head = document.createElement('header');
  head.className = 'proto-recap-lot-head';
  const name = document.createElement('span');
  name.className = 'proto-recap-lot-name';
  name.textContent = lot.lotId ? lot.name : 'Tâches sans lot';
  head.appendChild(name);
  const agg = document.createElement('span');
  agg.className = 'proto-recap-lot-aggregate';
  if (lot.lotId) agg.style.color = lot.color || 'var(--accent)';
  agg.textContent = lotPct + ' %';
  head.appendChild(agg);
  card.appendChild(head);
  const ul = document.createElement('ul');
  ul.className = 'proto-recap-task-list';
  for (const t of lot.tasks) ul.appendChild(buildRecapTaskRow(t));
  card.appendChild(ul);
  return card;
}
function buildRecapTaskRow(task) {
  const li = document.createElement('li');
  li.className = 'proto-recap-task';
  // En-tête : titre + total + type
  const head = document.createElement('div');
  head.className = 'proto-recap-task-head';
  const title = document.createElement('span');
  title.className = 'proto-recap-task-title';
  title.textContent = task.title || '(sans intitulé)';
  if (!task.title) title.style.fontStyle = 'italic';
  head.appendChild(title);
  const meta = document.createElement('span');
  meta.className = 'proto-recap-task-meta';
  meta.textContent = fmtRecapVolume(task.type, task.total);
  head.appendChild(meta);
  li.appendChild(head);
  // Barre 3 segments
  const bar = document.createElement('div');
  bar.className = 'proto-recap-bar';
  const segDone  = document.createElement('div');
  segDone.className = 'proto-recap-bar-seg is-done';
  segDone.style.flex = Math.max(task.pct.done,  0);
  const segDoing = document.createElement('div');
  segDoing.className = 'proto-recap-bar-seg is-doing';
  segDoing.style.flex = Math.max(task.pct.doing, 0);
  const segTodo  = document.createElement('div');
  segTodo.className = 'proto-recap-bar-seg is-todo';
  segTodo.style.flex = Math.max(task.pct.todo,  0);
  bar.append(segDone, segDoing, segTodo);
  li.appendChild(bar);
  // Légende sous la barre : % par statut
  const lg = document.createElement('div');
  lg.className = 'proto-recap-task-legend';
  for (const k of ['done', 'doing', 'todo']) {
    if (task.pct[k] <= 0.01) continue;
    const item = document.createElement('span');
    item.className = 'proto-recap-task-legend-item';
    const dot = document.createElement('span');
    dot.className = 'proto-recap-task-legend-dot is-' + k;
    const pct = document.createElement('span');
    pct.className = 'proto-recap-task-legend-pct';
    pct.textContent = Math.round(task.pct[k]) + ' %';
    const lbl = document.createElement('span');
    const labels = { done: 'Réalisée', doing: 'En cours', todo: 'À faire' };
    lbl.textContent = labels[k];
    item.append(dot, pct, lbl);
    lg.appendChild(item);
  }
  li.appendChild(lg);
  return li;
}
function renderProtoRecapSlider() {
  const slider = document.getElementById('protorecapsliders');
  if (!slider) return;
  slider.innerHTML = '';
  const plans = getProtoPlans();
  if (plans.length === 0) {
    const empty = document.createElement('div');
    empty.style.fontSize = '12px';
    empty.style.color = 'var(--text-3)';
    empty.style.fontStyle = 'italic';
    empty.textContent = 'Aucun plan disponible.';
    slider.appendChild(empty);
    return;
  }
  for (const p of plans) {
    const folder = getProtoFolder(p.folderId);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'proto-recap-plan-chip' + (p.id === state.protoActivePlanId ? ' is-active' : '');
    chip.innerHTML = `
      <span class="proto-recap-plan-chip-folder"></span>
      <span class="proto-recap-plan-chip-name"></span>
    `;
    chip.querySelector('.proto-recap-plan-chip-folder').textContent = folder ? (folder.name || '(sans dossier)') : '(sans dossier)';
    chip.querySelector('.proto-recap-plan-chip-name').textContent = p.name || '(sans nom)';
    chip.addEventListener('click', () => {
      state.protoActivePlanId = p.id;
      save();
      renderProtoRecap();
    });
    slider.appendChild(chip);
  }
}

function renderProtoPlanSelector() {
  const sel = document.getElementById('protoplanselect');
  if (!sel) return;
  sel.innerHTML = '';
  const folders = getProtoFolders();
  const plans = getProtoPlans();
  if (plans.length === 0) {
    sel.appendChild(new Option('Aucun plan', ''));
    return;
  }
  // Groupe par dossier (avec <optgroup> pour la lisibilité)
  for (const folder of folders) {
    const fplans = getPlansInFolder(folder.id);
    if (fplans.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = folder.name || '(dossier sans nom)';
    for (const p of fplans) {
      const opt = new Option(p.name || '(plan sans nom)', p.id);
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }
  // Plans orphelins (folderId inconnu)
  const orphans = plans.filter(p => !getProtoFolder(p.folderId));
  if (orphans.length > 0) {
    const group = document.createElement('optgroup');
    group.label = '(sans dossier)';
    for (const p of orphans) group.appendChild(new Option(p.name || '(sans nom)', p.id));
    sel.appendChild(group);
  }
  sel.value = state.protoActivePlanId || '';
}

function renderProtoFilterBar() {
  const lotSel = document.getElementById('protofilterlot');
  if (lotSel) {
    lotSel.innerHTML = '';
    lotSel.appendChild(new Option('Tous les lots', ''));
    for (const lot of getWorkBatches()) {
      if (!lot.name) continue;
      lotSel.appendChild(new Option(lot.name, lot.id));
    }
    lotSel.value = state.protoFilterLotId || '';
  }
  // Filtre tâche : titres uniques des formes du plan actif, filtrés par
  // lot courant si présent (pour ne pas proposer des tâches qui seraient
  // de toute façon masquées par l'autre filtre).
  const titleSel = document.getElementById('protofiltertitle');
  if (titleSel) {
    const plan = getActiveProtoPlan();
    const titles = new Set();
    if (plan) {
      for (const s of (state.protoShapes || [])) {
        if (s.planId !== plan.id) continue;
        if (state.protoFilterLotId && s.lotId !== state.protoFilterLotId) continue;
        const t = (s.title || '').trim();
        if (t) titles.add(t);
      }
    }
    const sorted = Array.from(titles).sort((a, b) => a.localeCompare(b, 'fr'));
    titleSel.innerHTML = '';
    titleSel.appendChild(new Option('Toutes les tâches', ''));
    for (const t of sorted) titleSel.appendChild(new Option(t, t));
    titleSel.value = (state.protoFilterTitle && sorted.includes(state.protoFilterTitle))
      ? state.protoFilterTitle
      : '';
    titleSel.disabled = sorted.length === 0;
  }
  refreshProtoFilterStatusBar();
}
function refreshProtoFilterStatusBar() {
  const active = new Set(state.protoFilterStatuses || []);
  document.querySelectorAll('.proto-filter-status[data-proto-filter-status]').forEach(btn => {
    const on = active.has(btn.dataset.protoFilterStatus);
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function refreshProtoToolbar() {
  document.querySelectorAll('.proto-tool-btn[data-proto-tool]').forEach(btn => {
    const on = btn.dataset.protoTool === protoTool;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const wrap = document.getElementById('protocanvaswrap');
  if (wrap) wrap.dataset.protoTool = protoTool;
  // Bouton "Série" : actif quand le mode est ON
  const seriesBtn = document.getElementById('protoseriestoggle');
  if (seriesBtn) {
    seriesBtn.classList.toggle('is-active', protoSeriesMode);
    seriesBtn.setAttribute('aria-pressed', protoSeriesMode ? 'true' : 'false');
  }
}
function setProtoTool(tool) {
  if (!['select', 'point', 'line', 'rect', 'polygon', 'polyline'].includes(tool)) return;
  // Annule tout dessin en cours quand on change d'outil
  cancelProtoInProgress();
  protoTool = tool;
  refreshProtoToolbar();
  refreshProtoPolyHint();
}

// Mode série : toggle on/off. Quand activé, après une 1re saisie le
// sheet ne s'ouvre plus pour les formes suivantes (les défauts captés
// sont appliqués directement). Cleared quand on toggle off.
function toggleProtoSeriesMode() {
  protoSeriesMode = !protoSeriesMode;
  if (!protoSeriesMode) protoSeriesDefaults = null;
  refreshProtoToolbar();
  if (protoSeriesMode) showToast('Mode série activé — la 1re forme captera lot+intitulé+statut, les suivantes les hériteront.');
  else showToast('Mode série désactivé');
}

function refreshProtoPolyHint() {
  const hint = document.getElementById('protopolyhint');
  if (!hint) return;
  hint.hidden = !((protoTool === 'polygon' || protoTool === 'polyline') && protoPolyDraw);
  // Texte adapté selon l'outil
  const txt = document.getElementById('protopolyhinttext');
  if (txt) {
    if (protoTool === 'polyline') txt.textContent = 'Cliquez pour placer un sommet — terminez avec « ✓ Terminer ».';
    else                          txt.textContent = 'Cliquez pour placer un sommet — fermez en cliquant le 1er point ou « ✓ Terminer ».';
  }
}

// ---------- Upload du plan ----------
// folderId : dossier de destination (créé si nécessaire). Si vide,
// on utilise le dossier par défaut.
function handleProtoUpload(file, folderId) {
  if (!file) return;
  const isPdf  = /^application\/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
  const isJpeg = /^image\/jpe?g$/i.test(file.type)     || /\.jpe?g$/i.test(file.name);
  if (isPdf)  return handleProtoUploadPdf(file, folderId);
  if (isJpeg) return handleProtoUploadJpeg(file, folderId);
  showToast('Format non supporté : JPG/JPEG ou PDF uniquement', 'error');
}

// Insère un plan dans le dossier cible avec un nom unique, gérant le
// quota localStorage. Retourne true si réussi.
function addProtoPlanFromCanvas(canvas, baseName, folderId, suffix) {
  try {
    const folder = (folderId && getProtoFolder(folderId)) || ensureDefaultFolder();
    const usedNames = new Set(getProtoPlans().map(p => p.name));
    let name = baseName;
    if (suffix) name = `${baseName} (${suffix})`;
    if (!name || usedNames.has(name)) {
      let n = 1, candidate = 'Plan 1';
      while (usedNames.has(candidate)) { n++; candidate = 'Plan ' + n; }
      name = candidate;
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    // L'image vit en IndexedDB (+ bucket Supabase Storage pour les autres
    // appareils) ; le state ne porte que les métadonnées — le quota
    // localStorage n'est plus une contrainte.
    const plan = {
      id: 'pln_' + uid(), folderId: folder.id, name,
      w: canvas.width, h: canvas.height
    };
    const prevActiveId = state.protoActivePlanId;
    state.protoPlans.push(plan);
    state.protoActivePlanId = plan.id;
    if (!save()) {
      state.protoPlans.pop();
      state.protoActivePlanId = prevActiveId;
      save();
      return false;
    }
    planImageCache.set(plan.id, dataUrl);
    mediaPutPlanImage(plan.id, dataUrl)
      .then(() => queuePlanUpload(plan.id))
      .catch(e => {
        console.error('IDB plan KO', e);
        showToast('Image du plan non persistée (stockage navigateur indisponible)', 'error');
      });
    return true;
  } catch (err) {
    return false;
  }
}

function handleProtoUploadJpeg(file, folderId) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      // Redimensionne à 1920px max pour rester sous la limite localStorage
      let w = img.naturalWidth, h = img.naturalHeight;
      const ratio = Math.min(1, PROTO_MAX_PLAN_DIM / Math.max(w, h));
      const tw = Math.round(w * ratio);
      const th = Math.round(h * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = tw; canvas.height = th;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, tw, th);
      const baseName = (file.name || '').replace(/\.[a-z]+$/i, '').trim();
      if (addProtoPlanFromCanvas(canvas, baseName.length <= 40 ? baseName : 'Plan', folderId, null)) {
        renderProto();
        renderProtoManager();
        showToast('Plan ajouté');
      } else {
        showToast('Plan trop lourd (quota navigateur). Essayez un fichier plus petit.', 'error');
      }
    };
    img.onerror = () => showToast('Image illisible', 'error');
    img.src = reader.result;
  };
  reader.onerror = () => showToast('Lecture du fichier impossible', 'error');
  reader.readAsDataURL(file);
}

// Charge PDF.js depuis un CDN à la première utilisation. Le service
// worker met le fichier en cache pour les usages hors-ligne suivants.
const PROTO_PDFJS_URL    = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
const PROTO_PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
let protoPdfJsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (protoPdfJsPromise) return protoPdfJsPromise;
  protoPdfJsPromise = (async () => {
    const mod = await import(/* @vite-ignore */ PROTO_PDFJS_URL);
    if (mod.GlobalWorkerOptions) mod.GlobalWorkerOptions.workerSrc = PROTO_PDFJS_WORKER;
    window.pdfjsLib = mod;
    return mod;
  })().catch((err) => {
    protoPdfJsPromise = null;
    throw err;
  });
  return protoPdfJsPromise;
}

async function handleProtoUploadPdf(file, folderId) {
  let pdfjs;
  try {
    showToast('Chargement de la bibliothèque PDF…');
    pdfjs = await loadPdfJs();
  } catch (err) {
    showToast('Impossible de charger PDF.js (connexion requise au 1er usage)', 'error');
    return;
  }
  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (err) {
    showToast('Lecture du PDF impossible', 'error');
    return;
  }
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: buf }).promise;
  } catch (err) {
    showToast('PDF invalide ou protégé', 'error');
    return;
  }
  const baseName = (file.name || '').replace(/\.[a-z]+$/i, '').trim() || 'PDF';
  const nbPages = pdf.numPages;
  let added = 0;
  for (let pageNum = 1; pageNum <= nbPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const v1 = page.getViewport({ scale: 1 });
      // Echelle pour la dimension max = 1920 px (cap à 4x pour éviter
      // les rendus énormes sur des PDF en très basse résolution)
      const targetScale = Math.min(PROTO_MAX_PLAN_DIM / Math.max(v1.width, v1.height), 4);
      const viewport = page.getViewport({ scale: targetScale });
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      // Fond blanc (les PDF n'ont pas toujours de fond solide ;
      // sans ça, certaines pages se retrouvent transparentes ⇒
      // illisibles après conversion JPEG)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const suffix = nbPages > 1 ? `p${pageNum}/${nbPages}` : null;
      if (!addProtoPlanFromCanvas(canvas, baseName.length <= 40 ? baseName : 'PDF', folderId, suffix)) {
        showToast(`Quota navigateur atteint : ${added}/${nbPages} page(s) ajoutée(s)`, 'error');
        break;
      }
      added++;
    } catch (err) {
      // Page illisible — on continue avec les suivantes
      console.warn('PDF page ' + pageNum + ' KO', err);
    }
  }
  renderProto();
  renderProtoManager();
  if (added > 0) {
    showToast(nbPages === 1
      ? 'Plan ajouté'
      : `${added} page${added > 1 ? 's' : ''} importée${added > 1 ? 's' : ''}`);
  } else {
    showToast('Aucune page exploitable dans ce PDF', 'error');
  }
}

// ---------- Export PDF du plan ----------
// jsPDF chargé à la demande au 1er export. Cache via SW idem PDF.js.
const PROTO_JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm';
let protoJsPdfPromise = null;
function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf);
  if (protoJsPdfPromise) return protoJsPdfPromise;
  protoJsPdfPromise = (async () => {
    const mod = await import(/* @vite-ignore */ PROTO_JSPDF_URL);
    // Le bundle ESM jsdelivr expose { jsPDF }
    const ns = (mod && mod.jsPDF) ? mod : (mod && mod.default && mod.default.jsPDF ? mod.default : { jsPDF: mod.jsPDF || mod.default });
    window.jspdf = ns;
    return ns;
  })().catch((err) => { protoJsPdfPromise = null; throw err; });
  return protoJsPdfPromise;
}

// Convertit #rrggbb → 'rgba(r, g, b, a)' pour utiliser des transparences
// avec les API canvas (qui n'acceptent pas le format #rrggbbaa partout).
function hexToRgba(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(0, 0, 0, ${alpha})`;
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function hexToRgbInts(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 0, g: 0, b: 0 };
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16)
  };
}

// Dessine une forme sur le canvas (utilisé pour l'aperçu + le PDF).
function drawProtoShapeOnCanvas(ctx, s, plan) {
  const lot = getWorkBatch(s.lotId);
  const lotColor = lot ? lot.color : '#888888';
  const statusColor = PROTO_STATUS_COLOR[s.status] || PROTO_STATUS_COLOR.todo;
  const sw = Math.max(plan.w, plan.h) / 200;
  const sw70 = sw * 0.7;
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';
  if (s.type === 'point') {
    ctx.fillStyle = statusColor;
    ctx.strokeStyle = lotColor;
    ctx.lineWidth = sw70;
    ctx.beginPath();
    ctx.arc(s.coords.cx, s.coords.cy, Math.max(sw * 1.75, 5.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (s.type === 'line') {
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = sw * 1.4;
    ctx.beginPath();
    ctx.moveTo(s.coords.x1, s.coords.y1);
    ctx.lineTo(s.coords.x2, s.coords.y2);
    ctx.stroke();
  } else if (s.type === 'rect') {
    ctx.fillStyle = hexToRgba(statusColor, 0.25);
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = sw70;
    ctx.fillRect(s.coords.x, s.coords.y, s.coords.w, s.coords.h);
    ctx.strokeRect(s.coords.x, s.coords.y, s.coords.w, s.coords.h);
  } else if (s.type === 'polygon') {
    const pts = s.coords.points || [];
    if (pts.length < 3) return;
    ctx.fillStyle = hexToRgba(statusColor, 0.25);
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = sw70;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (s.type === 'polyline') {
    const pts = s.coords.points || [];
    if (pts.length < 2) return;
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = sw * 1.4;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}

// Charge l'image d'un plan en Promise.
function loadImagePromise(dataUrl) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Image illisible'));
    img.src = dataUrl;
  });
}

// Rend dans un canvas le plan + les formes filtrées (z-order identique
// au SVG). Le canvas a la résolution naturelle du plan, garantissant
// un export net même après agrandissement dans le PDF.
async function renderProtoExportCanvas(plan) {
  const dataUrl = await loadPlanImage(plan.id);
  if (!dataUrl) throw new Error('Image du plan indisponible (pas encore synchronisée ?)');
  const img = await loadImagePromise(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width  = plan.w;
  canvas.height = plan.h;
  const ctx = canvas.getContext('2d');
  // Fond blanc avant l'image au cas où celle-ci aurait des zones
  // transparentes (sécurité — les JPEG n'ont pas d'alpha mais bon)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, plan.w, plan.h);
  // Formes filtrées + z-order
  const order = { rect: 0, polygon: 0, line: 1, point: 2 };
  const shapes = (state.protoShapes || [])
    .filter(s => s.planId === plan.id && shapeMatchesFilters(s))
    .slice()
    .sort((a, b) => (order[a.type] ?? 0) - (order[b.type] ?? 0));
  for (const s of shapes) drawProtoShapeOnCanvas(ctx, s, plan);
  return canvas;
}

// Texte décrivant les filtres actifs (utilisé dans l'aperçu et le PDF)
function getProtoFiltersSummary() {
  const parts = [];
  if (state.protoFilterLotId) {
    const lot = getWorkBatch(state.protoFilterLotId);
    parts.push('Lot : ' + (lot && lot.name ? lot.name : '(sans nom)'));
  } else {
    parts.push('Tous les lots');
  }
  if (state.protoFilterTitle) {
    parts.push('Tâche : ' + state.protoFilterTitle);
  }
  const statuses = state.protoFilterStatuses || [];
  if (statuses.length < 3) {
    if (statuses.length === 0) parts.push('Aucun statut');
    else parts.push('Statuts : ' + statuses.map(s => PROTO_STATUS_LABEL[s]).join(' · '));
  } else {
    parts.push('Tous les statuts');
  }
  return parts.join(' — ');
}

// Ouvre la modale d'aperçu / export PDF.
async function openProtoExport() {
  const plan = getActiveProtoPlan();
  if (!plan) { showToast('Aucun plan actif', 'error'); return; }
  const m = document.getElementById('protoexport');
  if (!m) return;
  protoResetGestureState();
  // Reset des champs
  document.getElementById('protoexportname').value = (plan.name || 'Plan').replace(/[^\w\s.-]/g, '_');
  document.getElementById('protoexportfilters').textContent = getProtoFiltersSummary();
  const preview = document.getElementById('protoexportpreview');
  preview.innerHTML = '<p class="hint">Génération de l\'aperçu…</p>';
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  try {
    const canvas = await renderProtoExportCanvas(plan);
    // Affiche le canvas tel quel — CSS le contraint à la taille de la modale
    preview.innerHTML = '';
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Aperçu du plan ' + plan.name;
    preview.appendChild(img);
    // On stocke le canvas pour le réutiliser à l'export (évite un re-render)
    preview._protoCanvas = canvas;
  } catch (err) {
    preview.innerHTML = '<p class="hint">Aperçu indisponible : ' + (err && err.message ? err.message : 'erreur') + '</p>';
  }
}
function closeProtoExport() {
  const m = document.getElementById('protoexport');
  if (m) m.hidden = true;
  document.body.style.overflow = '';
}

async function doProtoExportDownload() {
  const plan = getActiveProtoPlan();
  if (!plan) return;
  const preview = document.getElementById('protoexportpreview');
  const orient = (document.querySelector('input[name="protoexportorient"]:checked') || {}).value || 'auto';
  let jspdf;
  try {
    showToast('Chargement de la bibliothèque PDF…');
    jspdf = await loadJsPdf();
  } catch (err) {
    showToast('Impossible de charger jsPDF (connexion requise au 1er usage)', 'error');
    return;
  }
  // Récupère le canvas déjà rendu (ou refait si besoin)
  const canvas = (preview && preview._protoCanvas) || await renderProtoExportCanvas(plan);
  const ratio = canvas.width / canvas.height;
  let orientation = orient;
  if (orient === 'auto') orientation = ratio >= 1 ? 'landscape' : 'portrait';
  const pdf = new jspdf.jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10;
  // En-tête
  pdf.setFontSize(14);
  pdf.setTextColor(20, 24, 33);
  pdf.text(plan.name || 'Plan', margin, 12);
  const folder = getProtoFolder(plan.folderId);
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  if (folder && folder.name) pdf.text(folder.name, margin, 17);
  const dateStr = new Date().toLocaleDateString('fr-FR');
  pdf.text(dateStr, pageW - margin, 12, { align: 'right' });
  // Indicateur de filtres
  pdf.setFontSize(8);
  pdf.text('Filtres : ' + getProtoFiltersSummary(), pageW - margin, 17, { align: 'right' });
  // Zone image
  const headerH = 22;
  const footerH = 14;
  const availW = pageW - 2 * margin;
  const availH = pageH - headerH - footerH;
  let imgW, imgH;
  if (ratio > availW / availH) { imgW = availW; imgH = availW / ratio; }
  else                          { imgH = availH; imgW = availH * ratio; }
  const imgX = (pageW - imgW) / 2;
  const imgY = headerH;
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', imgX, imgY, imgW, imgH);
  // Légende en pied de page : compteurs par statut
  const shapes = (state.protoShapes || []).filter(s => s.planId === plan.id && shapeMatchesFilters(s));
  const counts = { todo: 0, doing: 0, done: 0 };
  for (const s of shapes) if (counts[s.status] != null) counts[s.status]++;
  pdf.setFontSize(9);
  pdf.setTextColor(40);
  let lx = margin;
  const ly = pageH - 6;
  for (const k of ['todo', 'doing', 'done']) {
    const c = hexToRgbInts(PROTO_STATUS_COLOR[k]);
    pdf.setFillColor(c.r, c.g, c.b);
    pdf.circle(lx + 2, ly - 2, 1.6, 'F');
    pdf.setTextColor(40);
    pdf.text(`${PROTO_STATUS_LABEL[k]} : ${counts[k]}`, lx + 6, ly);
    lx += 38;
  }
  pdf.setTextColor(140);
  pdf.text(`${shapes.length} forme${shapes.length > 1 ? 's' : ''}`, pageW - margin, ly, { align: 'right' });
  // Nom de fichier
  let fname = (document.getElementById('protoexportname').value || plan.name || 'plan').trim();
  fname = fname.replace(/\.pdf$/i, '').replace(/[^\w\s.-]/g, '_').slice(0, 80) || 'plan';
  pdf.save(fname + '.pdf');
  closeProtoExport();
  showToast('PDF généré');
}

function clearProtoShapes() {
  const planId = state.protoActivePlanId;
  const shapes = (state.protoShapes || []).filter(s => s.planId === planId);
  if (shapes.length === 0) return;
  if (!confirm(`Supprimer les ${shapes.length} forme(s) du plan affiché ?`)) return;
  state.protoShapes = state.protoShapes.filter(s => s.planId !== planId);
  save();
  renderProtoSVG();
  renderProtoLegend();
}

// ---------- Manager (modal de gestion des dossiers + plans) ----------
let protoUploadTargetFolderId = '';
function openProtoManager() {
  const m = document.getElementById('protomanager');
  if (!m) return;
  protoResetGestureState(); // évite que des pointers en cours « bavent » dans la modale
  renderProtoManager();
  m.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeProtoManager() {
  const m = document.getElementById('protomanager');
  if (m) m.hidden = true;
  document.body.style.overflow = '';
}
function renderProtoManager() {
  const list = document.getElementById('protomanagerlist');
  if (!list) return;
  list.innerHTML = '';
  const folders = getProtoFolders();
  if (folders.length === 0) {
    const p = document.createElement('p');
    p.className = 'eotp-empty';
    p.textContent = 'Aucun dossier. Tapez « + Dossier » pour en créer un.';
    list.appendChild(p);
    return;
  }
  for (const folder of folders) {
    list.appendChild(buildProtoFolderRow(folder));
  }
}
function buildProtoFolderRow(folder) {
  const wrap = document.createElement('div');
  wrap.className = 'proto-folder';
  wrap.dataset.folderId = folder.id;
  wrap.innerHTML = `
    <div class="proto-folder-head">
      <span class="proto-folder-icon" aria-hidden="true">📁</span>
      <input class="proto-folder-name" type="text" maxlength="40">
      <button class="proto-folder-add-plan" type="button" aria-label="Ajouter un plan dans ce dossier">+ Plan</button>
      <button class="proto-folder-delete" type="button" aria-label="Supprimer ce dossier">
        <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
      </button>
    </div>
    <ul class="proto-plans-list"></ul>
  `;
  const nameInp = wrap.querySelector('.proto-folder-name');
  nameInp.value = folder.name || '';
  nameInp.addEventListener('input', () => renameProtoFolder(folder.id, nameInp.value));
  wrap.querySelector('.proto-folder-delete').addEventListener('click', () => removeProtoFolder(folder.id));
  wrap.querySelector('.proto-folder-add-plan').addEventListener('click', () => {
    protoUploadTargetFolderId = folder.id;
    const inp = document.getElementById('protoupload');
    if (inp) inp.click();
  });
  const ul = wrap.querySelector('.proto-plans-list');
  const plans = getPlansInFolder(folder.id);
  if (plans.length === 0) {
    const li = document.createElement('li');
    li.className = 'proto-plan-empty';
    li.textContent = 'Aucun plan. Tapez « + Plan » pour téléverser.';
    ul.appendChild(li);
  } else {
    for (const p of plans) ul.appendChild(buildProtoPlanRow(p));
  }
  return wrap;
}
function buildProtoPlanRow(plan) {
  const li = document.createElement('li');
  li.className = 'proto-plan-row' + (plan.id === state.protoActivePlanId ? ' is-active' : '');
  li.innerHTML = `
    <span class="proto-plan-icon" aria-hidden="true">📄</span>
    <input class="proto-plan-name" type="text" maxlength="40">
    <button class="proto-plan-load" type="button">Ouvrir</button>
    <button class="proto-plan-delete" type="button" aria-label="Supprimer ce plan">
      <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
    </button>
  `;
  const nameInp = li.querySelector('.proto-plan-name');
  nameInp.value = plan.name || '';
  nameInp.addEventListener('input', () => renameProtoPlan(plan.id, nameInp.value));
  li.querySelector('.proto-plan-load').addEventListener('click', () => {
    setActiveProtoPlan(plan.id);
    closeProtoManager();
  });
  li.querySelector('.proto-plan-delete').addEventListener('click', () => removeProtoPlan(plan.id));
  return li;
}

// ---------- Zoom / Pan ----------
// Le zoom s'applique via CSS transform sur .proto-canvas-inner (qui
// contient l'image + le SVG). Cela laisse intacts les coords du SVG
// : getScreenCTM() retourne la matrice complète (CSS transform inclus),
// donc protoSvgCoords convertit toujours correctement vers les px
// naturels du plan.
function applyProtoView() {
  const inner = document.getElementById('protocanvasinner');
  if (!inner) return;
  inner.style.transform = `translate(${protoView.tx}px, ${protoView.ty}px) scale(${protoView.scale})`;
}
function zoomByAtClient(factor, clientX, clientY) {
  const wrap = document.getElementById('protocanvaswrap');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  const newScale = Math.max(PROTO_ZOOM_MIN, Math.min(PROTO_ZOOM_MAX, protoView.scale * factor));
  if (newScale === protoView.scale) return;
  // Garde le point (cx, cy) immobile pendant le zoom
  const sx = (cx - protoView.tx) / protoView.scale;
  const sy = (cy - protoView.ty) / protoView.scale;
  protoView.scale = newScale;
  protoView.tx = cx - sx * newScale;
  protoView.ty = cy - sy * newScale;
  applyProtoView();
}
function protoZoomIn()    { protoResetGestureState(); zoomCentered(1.25); }
function protoZoomOut()   { protoResetGestureState(); zoomCentered(1 / 1.25); }
function protoZoomReset() { protoResetGestureState(); protoView = { scale: 1, tx: 0, ty: 0 }; applyProtoView(); }
function zoomCentered(factor) {
  const wrap = document.getElementById('protocanvaswrap');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  zoomByAtClient(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

// ---------- Dessin sur le SVG ----------
// Convertit un événement pointer en coords SVG (= px naturels du plan).
// On utilise getBoundingClientRect() plutôt que getScreenCTM() : la
// rect prend en compte de manière fiable les transforms CSS appliqués
// aux ancêtres HTML (le scale/translate sur .proto-canvas-inner),
// alors que getScreenCTM() les ignore sur iOS Safari (les formes se
// posaient alors à plusieurs centimètres du doigt en mode zoomé).
function protoSvgCoords(evt) {
  const svg = document.getElementById('protosvg');
  const plan = getActiveProtoPlan();
  if (!svg || !plan) return null;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: (evt.clientX - rect.left) * (plan.w / rect.width),
    y: (evt.clientY - rect.top)  * (plan.h / rect.height)
  };
}

function cancelProtoInProgress() {
  if (protoDrawing) {
    if (protoDrawing.previewEl) protoDrawing.previewEl.remove();
    protoDrawing = null;
  }
  if (protoPolyDraw) {
    clearPolygonPreview();
    protoPolyDraw = null;
  }
  protoPan = null;
}
function isProtoShape(target) {
  return target && target.classList && target.classList.contains('proto-shape');
}

// ---------- Dispatcher pointer (draw vs pan vs pinch vs polygon) ----------
// Les listeners sont attachés sur .proto-canvas-wrap (HTMLElement) plutôt
// que sur le SVG : setPointerCapture est plus fiable sur un élément
// HTML, et l'événement reste capté même quand le doigt sort de la zone
// de l'SVG, ce qui résout le bug du drag tactile sur iOS Safari.
function protoPointerDown(evt) {
  // Ignore les pointers qui démarrent sur les contrôles flottants
  // (zoom, export PDF, hint polygone) — ils ont leur propre handler
  // de click. Sans cette exclusion, startProtoPan() appelle
  // preventDefault() sur pointerdown, ce qui annule le click et empêche
  // le bouton de s'activer (régression : la barre .proto-export-bar
  // a été ajoutée séparément et n'était pas dans la liste).
  if (evt.target && evt.target.closest &&
      (evt.target.closest('.proto-zoom-bar')   ||
       evt.target.closest('.proto-export-bar') ||
       evt.target.closest('.proto-poly-hint'))) {
    return;
  }
  // Tap sur une forme en mode Sélection : on ouvre directement le
  // sheet sans tracker le pointer. Important : ne PAS l'ajouter à
  // activePointers, sinon l'ouverture de la modale empêche le
  // pointerup correspondant d'atteindre le wrap et on laisse une
  // entrée fantôme (cause du bug « zoom à 1 doigt + dessin impossible »).
  if (protoTool === 'select' && isProtoShape(evt.target)) {
    const id = evt.target.getAttribute('data-shape-id');
    if (id) {
      protoResetGestureState();
      openProtoShapeSheet(id);
    }
    return;
  }
  // Évince tout pointer fantôme avant d'évaluer le nombre de doigts.
  // Sans cette purge, une entrée stale fait basculer en pinch alors
  // qu'un seul vrai doigt est posé.
  evictStaleProtoPointers();
  protoActivePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY, t: Date.now() });
  if (protoActivePointers.size === 2) {
    // 2 doigts → pinch-pan (annule tout dessin en cours)
    cancelProtoInProgress();
    protoPinch = null; // sera (re)initialisé au prochain move
    captureProtoPointers();
    evt.preventDefault();
    return;
  }
  // Mode Sélection : démarre un pan (à n'importe quel zoom, pour
  // pouvoir recentrer l'image).
  if (protoTool === 'select') {
    startProtoPan(evt);
    return;
  }
  // Mode polygone OU polyligne : clic = ajouter un sommet.
  // Polygone se referme en cliquant le 1er point ; polyligne se finit
  // par le bouton « Terminer » du hint.
  if (protoTool === 'polygon' || protoTool === 'polyline') {
    if (isProtoShape(evt.target)) {
      protoActivePointers.delete(evt.pointerId);
      return;
    }
    handlePolygonClick(evt);
    return;
  }
  // Modes point / line / rect
  if (isProtoShape(evt.target)) {
    protoActivePointers.delete(evt.pointerId);
    return;
  }
  startSimpleDraw(evt);
}

// Reset complet de l'état des gestes — utilisé quand on ouvre une
// modale ou qu'on clique sur un bouton de zoom (situations où les
// pointerup peuvent ne pas revenir au wrap, laissant des fantômes).
function protoResetGestureState() {
  protoActivePointers.clear();
  protoPinch = null;
  cancelProtoInProgress();
}
function protoPointerMove(evt) {
  if (protoActivePointers.has(evt.pointerId)) {
    protoActivePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY, t: Date.now() });
  }
  if (protoActivePointers.size === 2) {
    updateProtoPinch();
    evt.preventDefault();
    return;
  }
  if (protoPan && evt.pointerId === protoPan.pointerId) {
    updateProtoPan(evt);
    evt.preventDefault();
    return;
  }
  if (protoPolyDraw) {
    updatePolygonHintLine(evt);
    return;
  }
  if (protoDrawing && evt.pointerId === protoDrawing.pointerId) {
    updateSimpleDraw(evt);
    return;
  }
}
function protoPointerUp(evt) {
  protoActivePointers.delete(evt.pointerId);
  if (protoActivePointers.size < 2) protoPinch = null;
  if (protoPan && evt.pointerId === protoPan.pointerId) {
    endProtoPan(evt);
    return;
  }
  if (protoDrawing && evt.pointerId === protoDrawing.pointerId) {
    endSimpleDraw(evt);
  }
}

function captureProtoPointers() {
  const wrap = document.getElementById('protocanvaswrap');
  if (!wrap || !wrap.setPointerCapture) return;
  for (const id of protoActivePointers.keys()) {
    try { wrap.setPointerCapture(id); } catch (_) {}
  }
}

// ---------- Pinch (2 doigts) ----------
function updateProtoPinch() {
  if (protoActivePointers.size !== 2) return;
  const pts = Array.from(protoActivePointers.values());
  const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const cx = (pts[0].x + pts[1].x) / 2;
  const cy = (pts[0].y + pts[1].y) / 2;
  if (!protoPinch) {
    protoPinch = { lastDist: dist, lastCx: cx, lastCy: cy };
    return;
  }
  const factor = dist / protoPinch.lastDist;
  // Pan = déplacement du centroïde
  protoView.tx += cx - protoPinch.lastCx;
  protoView.ty += cy - protoPinch.lastCy;
  applyProtoView();
  // Zoom centré sur le centroïde
  if (factor > 0.01) zoomByAtClient(factor, cx, cy);
  protoPinch.lastDist = dist;
  protoPinch.lastCx = cx;
  protoPinch.lastCy = cy;
}

// ---------- Pan (déplacement quand zoom > 1) ----------
function startProtoPan(evt) {
  const wrap = document.getElementById('protocanvaswrap');
  if (wrap && wrap.setPointerCapture) {
    try { wrap.setPointerCapture(evt.pointerId); } catch (_) {}
  }
  protoPan = {
    startClientX: evt.clientX, startClientY: evt.clientY,
    startTx: protoView.tx, startTy: protoView.ty,
    pointerId: evt.pointerId
  };
  evt.preventDefault();
}
function updateProtoPan(evt) {
  if (!protoPan) return;
  protoView.tx = protoPan.startTx + (evt.clientX - protoPan.startClientX);
  protoView.ty = protoPan.startTy + (evt.clientY - protoPan.startClientY);
  applyProtoView();
}
function endProtoPan() { protoPan = null; }

// ---------- Drawing simple : point / line / rect ----------
function startSimpleDraw(evt) {
  const plan = getActiveProtoPlan();
  if (!plan) return;
  const c = protoSvgCoords(evt);
  if (!c) return;
  if (protoTool === 'point') {
    const sh = { id: 's_' + uid(), planId: plan.id, type: 'point', coords: { cx: c.x, cy: c.y },
      lotId: '', title: '', date: '', status: 'todo' };
    state.protoShapes.push(sh);
    save();
    renderProtoSVG();
    renderProtoLegend();
    finalizeShapeCreation(sh);
    return;
  }
  const wrap = document.getElementById('protocanvaswrap');
  if (wrap && evt.pointerId != null && wrap.setPointerCapture) {
    try { wrap.setPointerCapture(evt.pointerId); } catch (_) {}
  }
  protoDrawing = { startX: c.x, startY: c.y, type: protoTool, previewEl: null, pointerId: evt.pointerId };
  evt.preventDefault();
}
function updateSimpleDraw(evt) {
  if (!protoDrawing) return;
  const c = protoSvgCoords(evt);
  if (!c) return;
  const plan = getActiveProtoPlan();
  if (!plan) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('protosvg');
  if (!protoDrawing.previewEl) {
    const el = document.createElementNS(ns, protoDrawing.type === 'line' ? 'line' : 'rect');
    el.classList.add('proto-shape-preview');
    el.setAttribute('stroke', PROTO_STATUS_COLOR.todo);
    el.setAttribute('stroke-width', Math.max(plan.w, plan.h) / 100);
    el.setAttribute('stroke-dasharray', Math.max(plan.w, plan.h) / 50);
    el.setAttribute('fill', protoDrawing.type === 'rect' ? 'rgba(211,47,47,0.15)' : 'none');
    svg.appendChild(el);
    protoDrawing.previewEl = el;
  }
  if (protoDrawing.type === 'line') {
    protoDrawing.previewEl.setAttribute('x1', protoDrawing.startX);
    protoDrawing.previewEl.setAttribute('y1', protoDrawing.startY);
    protoDrawing.previewEl.setAttribute('x2', c.x);
    protoDrawing.previewEl.setAttribute('y2', c.y);
  } else {
    const x = Math.min(protoDrawing.startX, c.x);
    const y = Math.min(protoDrawing.startY, c.y);
    const w = Math.abs(c.x - protoDrawing.startX);
    const h = Math.abs(c.y - protoDrawing.startY);
    protoDrawing.previewEl.setAttribute('x', x);
    protoDrawing.previewEl.setAttribute('y', y);
    protoDrawing.previewEl.setAttribute('width', w);
    protoDrawing.previewEl.setAttribute('height', h);
  }
  evt.preventDefault();
}
function endSimpleDraw(evt) {
  if (!protoDrawing) return;
  const plan = getActiveProtoPlan();
  const c = protoSvgCoords(evt) || { x: protoDrawing.startX, y: protoDrawing.startY };
  if (protoDrawing.previewEl) protoDrawing.previewEl.remove();
  const wrap = document.getElementById('protocanvaswrap');
  if (wrap && protoDrawing.pointerId != null && wrap.releasePointerCapture) {
    try { wrap.releasePointerCapture(protoDrawing.pointerId); } catch (_) {}
  }
  if (!plan) { protoDrawing = null; return; }
  const minSize = Math.max(plan.w, plan.h) / 100;
  let sh = null;
  if (protoDrawing.type === 'line') {
    const dist = Math.hypot(c.x - protoDrawing.startX, c.y - protoDrawing.startY);
    if (dist < minSize) { protoDrawing = null; return; }
    sh = { id: 's_' + uid(), planId: plan.id, type: 'line',
      coords: { x1: protoDrawing.startX, y1: protoDrawing.startY, x2: c.x, y2: c.y },
      lotId: '', title: '', date: '', status: 'todo' };
  } else {
    const x = Math.min(protoDrawing.startX, c.x);
    const y = Math.min(protoDrawing.startY, c.y);
    const w = Math.abs(c.x - protoDrawing.startX);
    const h = Math.abs(c.y - protoDrawing.startY);
    if (w < minSize || h < minSize) { protoDrawing = null; return; }
    sh = { id: 's_' + uid(), planId: plan.id, type: 'rect', coords: { x, y, w, h },
      lotId: '', title: '', date: '', status: 'todo' };
  }
  protoDrawing = null;
  state.protoShapes.push(sh);
  save();
  renderProtoSVG();
  renderProtoLegend();
  finalizeShapeCreation(sh);
}

// ---------- Drawing polygone (clic par clic) ----------
function handlePolygonClick(evt) {
  const plan = getActiveProtoPlan();
  if (!plan) return;
  const c = protoSvgCoords(evt);
  if (!c) return;
  const closeThreshold = Math.max(plan.w, plan.h) / 40; // ~2.5 % du plan
  if (!protoPolyDraw) {
    protoPolyDraw = { points: [{ x: c.x, y: c.y }], previewEl: null, firstVertexEl: null, hintLineEl: null, closeLineEl: null };
  } else {
    // Pour le polygone uniquement : clic sur le 1er sommet ferme.
    // La polyligne ignore ce raccourci, l'utilisateur termine via
    // le bouton « ✓ Terminer » du hint.
    if (protoTool === 'polygon') {
      const first = protoPolyDraw.points[0];
      const distToFirst = Math.hypot(c.x - first.x, c.y - first.y);
      if (protoPolyDraw.points.length >= 3 && distToFirst <= closeThreshold) {
        finishPolygon();
        return;
      }
    }
    protoPolyDraw.points.push({ x: c.x, y: c.y });
  }
  drawPolygonPreview();
  refreshProtoPolyHint();
  evt.preventDefault();
}

// Termine une polyligne (au moins 2 sommets) et la stocke en tant que
// shape type 'polyline'.
function finishPolyline() {
  if (!protoPolyDraw) return;
  const plan = getActiveProtoPlan();
  const pts = protoPolyDraw.points.slice();
  clearPolygonPreview();
  protoPolyDraw = null;
  refreshProtoPolyHint();
  if (!plan || pts.length < 2) return;
  const sh = { id: 's_' + uid(), planId: plan.id, type: 'polyline',
    coords: { points: pts },
    lotId: '', title: '', date: '', status: 'todo' };
  state.protoShapes.push(sh);
  save();
  renderProtoSVG();
  renderProtoLegend();
  finalizeShapeCreation(sh);
}

// Helper appelé après création d'une forme (point/line/rect/polygon/
// polyline) : en mode série avec des défauts captés, applique-les sans
// ouvrir le sheet. Sinon, ouvre le sheet d'édition normalement.
function finalizeShapeCreation(sh) {
  if (protoSeriesMode && protoSeriesDefaults) {
    sh.lotId  = protoSeriesDefaults.lotId  || '';
    sh.title  = protoSeriesDefaults.title  || '';
    sh.date   = protoSeriesDefaults.date   || '';
    sh.status = protoSeriesDefaults.status || 'todo';
    save();
    renderProtoSVG();
    renderProtoLegend();
    showToast('Forme ajoutée (série) ✓');
    return;
  }
  openProtoShapeSheet(sh.id);
}

// Termine le dessin polygone/polyligne en cours (appelé par le bouton
// « ✓ Terminer » du hint).
function finishCurrentPolyDraw() {
  if (!protoPolyDraw) return;
  if (protoTool === 'polyline') finishPolyline();
  else if (protoPolyDraw.points.length >= 3) finishPolygon();
  else cancelPolygon();
}
function clearPolygonPreview() {
  if (!protoPolyDraw) return;
  ['previewEl', 'firstVertexEl', 'hintLineEl', 'closeLineEl'].forEach(k => {
    if (protoPolyDraw[k]) { protoPolyDraw[k].remove(); protoPolyDraw[k] = null; }
  });
}
function drawPolygonPreview() {
  if (!protoPolyDraw) return;
  clearPolygonPreview();
  const plan = getActiveProtoPlan();
  if (!plan) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('protosvg');
  const sw = Math.max(plan.w, plan.h) / 100;
  // Polyline des sommets placés
  if (protoPolyDraw.points.length > 1) {
    const pl = document.createElementNS(ns, 'polyline');
    pl.classList.add('proto-shape-preview');
    pl.setAttribute('points', protoPolyDraw.points.map(p => `${p.x},${p.y}`).join(' '));
    pl.setAttribute('stroke', PROTO_STATUS_COLOR.todo);
    pl.setAttribute('stroke-width', sw);
    pl.setAttribute('fill', 'none');
    svg.appendChild(pl);
    protoPolyDraw.previewEl = pl;
  }
  // Marqueur du premier sommet (cible pour refermer)
  const first = protoPolyDraw.points[0];
  const dot = document.createElementNS(ns, 'circle');
  dot.classList.add('proto-shape-preview');
  dot.setAttribute('cx', first.x);
  dot.setAttribute('cy', first.y);
  dot.setAttribute('r', sw * 1.8);
  dot.setAttribute('fill', PROTO_STATUS_COLOR.todo);
  dot.setAttribute('fill-opacity', '0.4');
  dot.setAttribute('stroke', PROTO_STATUS_COLOR.todo);
  dot.setAttribute('stroke-width', sw / 2);
  svg.appendChild(dot);
  protoPolyDraw.firstVertexEl = dot;
}
function updatePolygonHintLine(evt) {
  if (!protoPolyDraw) return;
  const c = protoSvgCoords(evt);
  if (!c) return;
  const plan = getActiveProtoPlan();
  if (!plan) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('protosvg');
  const sw = Math.max(plan.w, plan.h) / 100;
  const last = protoPolyDraw.points[protoPolyDraw.points.length - 1];
  const first = protoPolyDraw.points[0];
  // Ligne pointillée du dernier sommet au curseur
  if (!protoPolyDraw.hintLineEl) {
    const ln = document.createElementNS(ns, 'line');
    ln.classList.add('proto-shape-preview');
    ln.setAttribute('stroke', PROTO_STATUS_COLOR.todo);
    ln.setAttribute('stroke-width', sw);
    ln.setAttribute('stroke-dasharray', Math.max(plan.w, plan.h) / 80);
    svg.appendChild(ln);
    protoPolyDraw.hintLineEl = ln;
  }
  protoPolyDraw.hintLineEl.setAttribute('x1', last.x);
  protoPolyDraw.hintLineEl.setAttribute('y1', last.y);
  protoPolyDraw.hintLineEl.setAttribute('x2', c.x);
  protoPolyDraw.hintLineEl.setAttribute('y2', c.y);
  // Ligne de fermeture (du curseur au premier sommet) quand on a déjà
  // au moins 3 sommets — pour visualiser le polygone fini
  if (protoPolyDraw.points.length >= 2) {
    if (!protoPolyDraw.closeLineEl) {
      const ln2 = document.createElementNS(ns, 'line');
      ln2.classList.add('proto-shape-preview');
      ln2.setAttribute('stroke', PROTO_STATUS_COLOR.todo);
      ln2.setAttribute('stroke-width', sw / 2);
      ln2.setAttribute('stroke-dasharray', Math.max(plan.w, plan.h) / 120);
      ln2.setAttribute('opacity', '0.5');
      svg.appendChild(ln2);
      protoPolyDraw.closeLineEl = ln2;
    }
    protoPolyDraw.closeLineEl.setAttribute('x1', c.x);
    protoPolyDraw.closeLineEl.setAttribute('y1', c.y);
    protoPolyDraw.closeLineEl.setAttribute('x2', first.x);
    protoPolyDraw.closeLineEl.setAttribute('y2', first.y);
  }
}
function finishPolygon() {
  if (!protoPolyDraw) return;
  const plan = getActiveProtoPlan();
  const pts = protoPolyDraw.points.slice();
  clearPolygonPreview();
  protoPolyDraw = null;
  refreshProtoPolyHint();
  if (!plan || pts.length < 3) return;
  const sh = { id: 's_' + uid(), planId: plan.id, type: 'polygon',
    coords: { points: pts },
    lotId: '', title: '', date: '', status: 'todo' };
  state.protoShapes.push(sh);
  save();
  renderProtoSVG();
  renderProtoLegend();
  finalizeShapeCreation(sh);
}
function cancelPolygon() {
  cancelProtoInProgress();
  refreshProtoPolyHint();
}

// ---------- Bottom sheet d'édition d'une forme ----------
function openProtoShapeSheet(shapeId) {
  const sh = state.protoShapes.find(s => s.id === shapeId);
  if (!sh) return;
  protoEditingShapeId = shapeId;
  const sheet = document.getElementById('protoshapesheet');
  if (!sheet) return;
  // Peuple le dropdown des lots
  const sel = document.getElementById('protoshapelot');
  sel.innerHTML = '';
  sel.appendChild(new Option('— Aucun —', ''));
  for (const lot of getWorkBatches()) {
    if (!lot.name) continue;
    sel.appendChild(new Option(lot.name, lot.id));
  }
  sel.value = sh.lotId || '';
  document.getElementById('protoshapetitle').value = sh.title || '';
  document.getElementById('protoshapedate').value  = sh.date  || '';
  document.querySelectorAll('.proto-status-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.protoStatus === (sh.status || 'todo'));
  });
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeProtoShapeSheet() {
  const sheet = document.getElementById('protoshapesheet');
  if (sheet) sheet.hidden = true;
  document.body.style.overflow = '';
  protoEditingShapeId = null;
}
function saveProtoShapeSheet() {
  const sh = state.protoShapes.find(s => s.id === protoEditingShapeId);
  if (!sh) { closeProtoShapeSheet(); return; }
  sh.lotId = document.getElementById('protoshapelot').value || '';
  sh.title = document.getElementById('protoshapetitle').value.trim();
  sh.date  = document.getElementById('protoshapedate').value || '';
  const active = document.querySelector('.proto-status-btn.is-active');
  sh.status = active ? active.dataset.protoStatus : 'todo';
  // Mode série : on capture les valeurs comme défauts pour les prochaines
  // formes (jusqu'à ce que le mode soit désactivé).
  if (protoSeriesMode) {
    protoSeriesDefaults = { lotId: sh.lotId, title: sh.title, date: sh.date, status: sh.status };
    showToast('Tâche enregistrée — défauts série captés ✓');
  } else {
    showToast('Tâche enregistrée');
  }
  save();
  renderProtoFilterBar();
  renderProtoSVG();
  renderProtoLegend();
  closeProtoShapeSheet();
}
function deleteProtoShape() {
  const sh = state.protoShapes.find(s => s.id === protoEditingShapeId);
  if (!sh) { closeProtoShapeSheet(); return; }
  if (!confirm('Supprimer cette forme ?')) return;
  state.protoShapes = state.protoShapes.filter(s => s.id !== protoEditingShapeId);
  save();
  renderProtoFilterBar();
  renderProtoSVG();
  renderProtoLegend();
  closeProtoShapeSheet();
}

// ====================================================================
//   SAUVEGARDES DE SECOURS (IndexedDB)
// ====================================================================
// Filet de sécurité contre les écrasements de synchro : avant chaque
// application d'un état distant qui modifie des données, l'état local
// courant est photographié dans IndexedDB (quota bien plus large que
// localStorage — les plans y tiennent). Ring de BACKUP_KEEP snapshots,
// restauration depuis Données → Admin.

const BACKUP_DB_NAME = 'chantier_backups';
const BACKUP_STORE = 'snapshots';
const BACKUP_KEEP = 20;

function openBackupDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        db.createObjectStore(BACKUP_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Photographie l'état persisté ACTUEL (le JSON localStorage, déjà
// sérialisé — coût quasi nul) et taille le ring à BACKUP_KEEP.
async function createLocalBackup(reason) {
  const json = localStorage.getItem(STORAGE_KEY);
  if (!json) return null;
  const db = await openBackupDB();
  try {
    const tx = db.transaction(BACKUP_STORE, 'readwrite');
    const store = tx.objectStore(BACKUP_STORE);
    await idbReq(store.add({ ts: Date.now(), reason: reason || 'manuelle', size: json.length, json }));
    // Prune : garde les BACKUP_KEEP plus récents
    const keys = await idbReq(store.getAllKeys());
    if (keys.length > BACKUP_KEEP) {
      keys.sort((a, b) => a - b);
      for (const k of keys.slice(0, keys.length - BACKUP_KEEP)) {
        await idbReq(store.delete(k));
      }
    }
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    return true;
  } finally { db.close(); }
}

// Sauvegarde « de sécurité » périodique : au démarrage, si aucune
// sauvegarde n'a été prise depuis > 12 h, on en crée une. Garantit un
// point de restauration récent même sans conflit de synchro.
async function maybeCreateStartupBackup() {
  try {
    const backups = await listLocalBackups();
    const last = backups.length ? backups[0].ts : 0;
    if (Date.now() - last > 12 * 3600 * 1000) {
      await createLocalBackup('démarrage (sécurité quotidienne)');
    }
  } catch (e) { console.warn('Backup démarrage KO', e); }
}

// Liste les sauvegardes (métadonnées seulement pour l'affichage).
async function listLocalBackups() {
  const db = await openBackupDB();
  try {
    const store = db.transaction(BACKUP_STORE, 'readonly').objectStore(BACKUP_STORE);
    const all = await idbReq(store.getAll());
    return all
      .map(b => ({ id: b.id, ts: b.ts, reason: b.reason, size: b.size }))
      .sort((a, b) => b.ts - a.ts);
  } finally { db.close(); }
}

// Restaure une sauvegarde : l'état restauré devient LA référence (tous
// ses stamps sont datés de maintenant, il gagnera la fusion partout et
// sera poussé vers le serveur). L'état actuel est sauvegardé avant.
async function restoreLocalBackup(id) {
  const db = await openBackupDB();
  let record;
  try {
    const store = db.transaction(BACKUP_STORE, 'readonly').objectStore(BACKUP_STORE);
    record = await idbReq(store.get(id));
  } finally { db.close(); }
  if (!record || !record.json) throw new Error('Sauvegarde introuvable');
  await createLocalBackup('avant restauration');
  const data = JSON.parse(record.json);
  // L'état restauré fait autorité : stamps à maintenant, version serveur
  // « jamais vue » pour forcer une fusion propre au prochain cycle.
  const now = Date.now();
  const stamps = {};
  for (const k of Object.keys(data)) {
    if (!SYNC_EXCLUDED_KEYS.has(k) && k !== 'syncKeyStamps') stamps[k] = now;
  }
  data.syncKeyStamps = stamps;
  data.syncTimestamp = now;
  data.syncLastSeenRemoteTs = 0;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  window.location.reload();
}

// ====================================================================
//   IMAGES DES PLANS — IndexedDB local + Supabase Storage pour la synchro
// ====================================================================
// Les images (dataUrl JPEG ~0,5 Mo pièce) ne vivent plus dans le state :
//  - localStorage ne contient que les métadonnées {id, folderId, name, w, h}
//    → plus jamais de quota dépassé (~5 Mo), capacité ~200-500 plans en IDB ;
//  - le payload de synchro redescend à quelques centaines de Ko → push/pull
//    rapides, plus de risque de timeout Supabase ;
//  - chaque image est uploadée UNE SEULE FOIS dans le bucket Storage
//    « plans » (SQL de création : supabase-plans.sql) et téléchargée à la
//    demande par les autres appareils, puis mise en cache local.

const MEDIA_DB_NAME = 'chantier_media';
const MEDIA_STORE = 'plans';
const PLAN_UPLOAD_QUEUE_KEY = 'chantier_plan_upload_queue';
const PLANS_BUCKET = 'plans';

const planImageCache = new Map(); // planId → dataUrl (cache mémoire de session)
let _planBucketMissing = false;   // bucket absent : on arrête de réessayer cette session
let _planBucketToastShown = false;

function openMediaDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MEDIA_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function mediaPutPlanImage(planId, dataUrl) {
  const db = await openMediaDB();
  try {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    tx.objectStore(MEDIA_STORE).put({ id: planId, dataUrl });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } finally { db.close(); }
}
async function mediaGetPlanImage(planId) {
  const db = await openMediaDB();
  try {
    const rec = await idbReq(db.transaction(MEDIA_STORE, 'readonly').objectStore(MEDIA_STORE).get(planId));
    return rec ? rec.dataUrl : null;
  } finally { db.close(); }
}
async function mediaDeletePlanImage(planId) {
  const db = await openMediaDB();
  try {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    tx.objectStore(MEDIA_STORE).delete(planId);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } finally { db.close(); }
}
async function mediaListPlanIds() {
  const db = await openMediaDB();
  try {
    return await idbReq(db.transaction(MEDIA_STORE, 'readonly').objectStore(MEDIA_STORE).getAllKeys());
  } finally { db.close(); }
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

// Récupère l'image d'un plan : cache mémoire → IndexedDB → Supabase
// Storage (autre appareil). Renvoie null si introuvable partout.
async function loadPlanImage(planId) {
  if (planImageCache.has(planId)) return planImageCache.get(planId);
  try {
    const local = await mediaGetPlanImage(planId);
    if (local) { planImageCache.set(planId, local); return local; }
  } catch (e) { console.warn('IDB plans KO', e); }
  // Téléchargement depuis le bucket (image uploadée par un autre appareil)
  if (_planBucketMissing) return null;
  const supa = await loadSupabase();
  if (!supa || !supa.storage) return null;
  try {
    const { data, error } = await supa.storage.from(PLANS_BUCKET).download(planId + '.jpg');
    if (error || !data) { classifyPlanStorageError(error); return null; }
    const dataUrl = await blobToDataUrl(data);
    planImageCache.set(planId, dataUrl);
    mediaPutPlanImage(planId, dataUrl).catch(e => console.warn('IDB put KO', e));
    return dataUrl;
  } catch (e) { classifyPlanStorageError(e); return null; }
}

// Distingue le bucket absent (problème de config, on latche + informe)
// d'une erreur TRANSITOIRE (image d'un autre appareil pas encore
// uploadée = « Object not found » ; réseau). Un objet manquant NE doit
// PAS désactiver la synchro : il suffit de réessayer un peu plus tard.
// Dernière erreur Storage rencontrée (affichée dans Données → Admin).
let _planLastStorageError = null; // { msg, ts }

function classifyPlanStorageError(err) {
  const msg = String((err && err.message) || err || '');
  _planLastStorageError = { msg, ts: Date.now() };
  if (/bucket not found|bucket.*does not exist|no such bucket/i.test(msg)) {
    _planBucketMissing = true;
    if (!_planBucketToastShown && typeof showToast === 'function') {
      _planBucketToastShown = true;
      showToast('Synchro des plans inactive : bucket « plans » absent côté Supabase (exécutez supabase-plans.sql).', 'error');
    }
    console.warn('[Plans] bucket Storage indisponible :', msg);
    renderPlanSyncStatus();
    return 'bucket-missing';
  }
  // Erreur de DROITS (politiques RLS absentes/incomplètes, clé invalide) :
  // ce n'est PAS transitoire — réessayer en boucle ne sert à rien et
  // laissait l'utilisateur sans aucun signal (bucket vide, autres
  // appareils sans images). On latche + on informe clairement.
  if (/row-level security|violates.*policy|unauthorized|not.*authorized|permission|access denied|invalid.*(signature|jwt|key)|403/i.test(msg)) {
    _planBucketMissing = true;
    if (!_planBucketToastShown && typeof showToast === 'function') {
      _planBucketToastShown = true;
      showToast('Envoi des plans REFUSÉ par Supabase (règles d\'accès manquantes ?). Ré-exécutez supabase-plans.sql en entier, puis Données → Admin → Relancer.', 'error');
    }
    console.warn('[Plans] accès Storage refusé :', msg);
    renderPlanSyncStatus();
    return 'config';
  }
  // Object not found / réseau → transitoire, on réessaiera.
  console.info('[Plans] image indisponible pour l\'instant (transitoire) :', msg);
  renderPlanSyncStatus();
  return 'transient';
}

// Affiche l'image d'un plan dans <img>, avec réessais si elle vient
// d'être uploadée par un autre appareil et n'est pas encore disponible
// (fenêtre de quelques secondes le temps de l'upload). S'arrête si le
// plan n'est plus actif ou si le bucket est absent.
const PLAN_IMG_RETRY_DELAYS = [2000, 4000, 8000, 15000, 30000, 60000];
async function ensurePlanImageDisplayed(planId, imgEl) {
  for (let attempt = 0; attempt <= PLAN_IMG_RETRY_DELAYS.length; attempt++) {
    if (state.protoActivePlanId !== planId) return;      // l'utilisateur a changé de plan
    const dataUrl = await loadPlanImage(planId);
    if (dataUrl) {
      if (state.protoActivePlanId === planId && imgEl) imgEl.src = dataUrl;
      return;
    }
    if (_planBucketMissing) return;                      // inutile d'insister
    if (attempt < PLAN_IMG_RETRY_DELAYS.length) {
      await new Promise(r => setTimeout(r, PLAN_IMG_RETRY_DELAYS[attempt]));
    }
  }
}

// --- File d'attente d'upload (persistée : survit aux rechargements) ---
function getPlanUploadQueue() {
  try { return JSON.parse(localStorage.getItem(PLAN_UPLOAD_QUEUE_KEY) || '[]'); }
  catch (_) { return []; }
}
function setPlanUploadQueue(ids) {
  try { localStorage.setItem(PLAN_UPLOAD_QUEUE_KEY, JSON.stringify(ids)); } catch (_) {}
}
function queuePlanUpload(planId) {
  const q = getPlanUploadQueue();
  if (!q.includes(planId)) { q.push(planId); setPlanUploadQueue(q); }
  processPlanUploadQueue();
}
let _planUploadRunning = false;
async function processPlanUploadQueue() {
  if (_planUploadRunning || _planBucketMissing || !isSupabaseConfigured()) return;
  const supa = await loadSupabase();
  if (!supa || !supa.storage) return;
  _planUploadRunning = true;
  let hadError = false;
  try {
    // IMPORTANT : relire la file à CHAQUE itération et retirer par id.
    // L'ancienne version travaillait sur une copie prise au départ et la
    // réécrivait après chaque envoi : les pages d'un PDF multi-pages
    // ajoutées PENDANT l'envoi de la première étaient écrasées de la
    // file — jamais uploadées, sans erreur (cause de plans absents sur
    // les autres appareils).
    const dequeue = (planId) => setPlanUploadQueue(getPlanUploadQueue().filter(id => id !== planId));
    while (true) {
      const q = getPlanUploadQueue();
      if (q.length === 0) break;
      const planId = q[0];
      // Plan supprimé entre-temps : on retire de la file sans uploader
      if (!getProtoPlans().some(p => p.id === planId)) { dequeue(planId); continue; }
      const dataUrl = planImageCache.get(planId) || await mediaGetPlanImage(planId);
      if (!dataUrl) { dequeue(planId); continue; }
      const blob = await (await fetch(dataUrl)).blob();
      const { error } = await supa.storage.from(PLANS_BUCKET)
        .upload(planId + '.jpg', blob, { upsert: true, contentType: 'image/jpeg' });
      if (error) { classifyPlanStorageError(error); hadError = true; break; }
      dequeue(planId);
    }
    if (getPlanUploadQueue().length === 0) _planLastStorageError = null; // tout est parti
  } catch (e) {
    console.warn('[Plans] upload KO (retentera)', e);
    _planLastStorageError = { msg: String(e && e.message || e), ts: Date.now() };
    hadError = true;
  } finally {
    _planUploadRunning = false;
    renderPlanSyncStatus();
    // Des images ont pu être mises en file juste après la sortie de
    // boucle (course bénigne) : on repart une fois, sauf en erreur.
    if (!hadError && !_planBucketMissing && getPlanUploadQueue().length > 0) {
      setTimeout(() => processPlanUploadQueue(), 100);
    }
  }
}

// Panneau « Plans (synchronisation) » dans Données → Admin : rend visible
// ce qui était invisible — images locales, envois en attente, dernière
// erreur Storage — pour diagnostiquer un plan qui n'arrive pas sur un
// autre appareil.
async function renderPlanSyncStatus() {
  const el = document.getElementById('plansyncstatus');
  if (!el) return;
  const nbPlans = getProtoPlans().length;
  const queue = getPlanUploadQueue().filter(id => getProtoPlans().some(p => p.id === id));
  let nbLocal = 0;
  try {
    const ids = await mediaListPlanIds();
    const known = new Set(getProtoPlans().map(p => p.id));
    nbLocal = ids.filter(id => known.has(id)).length;
  } catch (_) {}
  const parts = [];
  parts.push(`<span>${nbPlans} plan${nbPlans > 1 ? 's' : ''} · ${nbLocal} image${nbLocal > 1 ? 's' : ''} sur cet appareil · <strong>${queue.length}</strong> en attente d'envoi</span>`);
  if (_planBucketMissing) {
    parts.push('<span class="plansync-err">⚠️ Envoi bloqué : bucket absent ou accès refusé côté Supabase (supabase-plans.sql), puis « Relancer ».</span>');
  } else if (_planLastStorageError) {
    parts.push('<span class="plansync-err">⚠️ Dernière erreur : ' + escapeHtml(_planLastStorageError.msg).slice(0, 140) + '</span>');
  } else if (queue.length === 0 && nbPlans > 0) {
    parts.push('<span class="plansync-ok">✓ Aucun envoi en attente</span>');
  } else if (queue.length > 0) {
    parts.push('<span class="plansync-warn">Gardez l\'app ouverte : les images partent en arrière-plan.</span>');
  }
  el.innerHTML = parts.join('');
}

// Suppression distante (best-effort : une image orpheline dans le bucket
// n'a aucun impact fonctionnel).
async function deletePlanImageRemote(planId) {
  if (_planBucketMissing || !isSupabaseConfigured()) return;
  try {
    const supa = await loadSupabase();
    if (supa && supa.storage) await supa.storage.from(PLANS_BUCKET).remove([planId + '.jpg']);
  } catch (e) { console.warn('[Plans] suppression distante KO', e); }
}

// Suppression complète (cache + IDB + file + bucket) — utilisée par
// removeProtoPlan / removeProtoFolder.
function deletePlanImageEverywhere(planId) {
  planImageCache.delete(planId);
  setPlanUploadQueue(getPlanUploadQueue().filter(id => id !== planId));
  mediaDeletePlanImage(planId).catch(e => console.warn('IDB delete KO', e));
  deletePlanImageRemote(planId);
}

// Migration : extrait les dataUrl encore présents dans state.protoPlans
// (versions ≤ 1.27, ou payload poussé par un ancien client) vers IDB,
// allège le state et programme l'upload vers le bucket.
async function migratePlanImagesToIDB() {
  const plans = getProtoPlans();
  const toMigrate = plans.filter(p => typeof p.dataUrl === 'string' && p.dataUrl.length > 0);
  if (toMigrate.length === 0) return false;
  for (const p of toMigrate) {
    planImageCache.set(p.id, p.dataUrl);
    try { await mediaPutPlanImage(p.id, p.dataUrl); }
    catch (e) { console.warn('Migration plan → IDB KO pour', p.id, e); continue; }
    delete p.dataUrl;
    queuePlanUpload(p.id);
  }
  save(); // le JSON localStorage redevient léger
  console.info(`[Plans] ${toMigrate.length} image(s) migrée(s) vers IndexedDB`);
  return true;
}

// Nettoyage : supprime de l'IDB les images de plans qui n'existent plus.
async function gcPlanImages() {
  try {
    const ids = await mediaListPlanIds();
    const known = new Set(getProtoPlans().map(p => p.id));
    for (const id of ids) {
      if (!known.has(id)) await mediaDeletePlanImage(id);
    }
  } catch (e) { console.warn('GC plans KO', e); }
}

// Liste des sauvegardes dans Données → Admin (asynchrone, best-effort).
async function renderBackupsList() {
  const ul = document.getElementById('backuplist');
  if (!ul) return;
  let backups = [];
  try { backups = await listLocalBackups(); }
  catch (e) { console.warn('Lecture des sauvegardes KO', e); }
  ul.innerHTML = '';
  if (backups.length === 0) {
    const li = document.createElement('li');
    li.className = 'backup-empty';
    li.textContent = 'Aucune sauvegarde pour l\'instant. Elles se créent automatiquement dès que la synchro modifie vos données.';
    ul.appendChild(li);
    return;
  }
  for (const b of backups) {
    const li = document.createElement('li');
    li.className = 'backup-item';
    li.innerHTML = `
      <div class="backup-meta">
        <span class="backup-date"></span>
        <span class="backup-reason"></span>
      </div>
      <span class="backup-size"></span>
      <button class="backup-restore" type="button">Restaurer</button>
    `;
    const d = new Date(b.ts);
    li.querySelector('.backup-date').textContent =
      d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
      ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    li.querySelector('.backup-reason').textContent = b.reason || '';
    li.querySelector('.backup-size').textContent = (b.size / 1024 / 1024).toFixed(2).replace('.', ',') + ' Mo';
    li.querySelector('.backup-restore').addEventListener('click', async () => {
      if (!confirm(`Restaurer la sauvegarde du ${li.querySelector('.backup-date').textContent} ?\n\nVos données actuelles seront d'abord sauvegardées, puis remplacées. L'état restauré deviendra la référence pour tous les appareils.`)) return;
      try { await restoreLocalBackup(b.id); }
      catch (e) { showToast('Restauration impossible : ' + (e.message || 'erreur'), 'error'); }
    });
    ul.appendChild(li);
  }
}

// ====================================================================
//   SUPABASE + SYNCHRONISATION — modèle simplifié, sans compte
// ====================================================================
// Tout le monde partage la même ligne site_data identifiée par
// SHARED_SITE_ID. Pas d'auth, pas de login : n'importe qui ayant le
// lien lit/écrit les mêmes données. La RLS Supabase doit autoriser
// anon SELECT/UPDATE sur cette ligne (SQL fourni dans le README).

const SHARED_SITE_ID = '11111111-1111-1111-1111-111111111111';

let supabaseClient = null;
let supabaseLoadPromise = null;

function isSupabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function loadSupabase() {
  if (supabaseClient) return Promise.resolve(supabaseClient);
  if (supabaseLoadPromise) return supabaseLoadPromise;
  if (!isSupabaseConfigured()) return Promise.resolve(null);
  supabaseLoadPromise = (async () => {
    const mod = await import(/* @vite-ignore */ SUPABASE_SDK_URL);
    supabaseClient = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return supabaseClient;
  })().catch((err) => {
    supabaseLoadPromise = null;
    console.error('Supabase SDK chargement KO', err);
    // Sans SDK, RIEN ne se synchronise : le signaler au lieu de laisser
    // la pastille sur « Synchronisé » (faux sentiment de sécurité).
    if (typeof setSyncStatus === 'function') setSyncStatus('error');
    return null;
  });
  return supabaseLoadPromise;
}

// ====================================================================
//   SYNCHRONISATION — push/pull state ↔ site_data
// ====================================================================
// Stratégie : last-write-wins par timestamp. Push debouncé sur 1.5 s
// après chaque save(). Pull initial au login + realtime via WebSocket
// pour récupérer les changements des coéquipiers en quasi-temps réel.

const SYNC_DEBOUNCE_MS = 1500;
const SYNC_POLL_INTERVAL_MS = 20000; // pull périodique toutes les 20s
const SYNC_OP_TIMEOUT_MS = 5000;     // timeout dur sur chaque op réseau
// Le push peut transporter plusieurs Mo (plans en dataUrl) : sur une
// connexion chantier, 5 s ne suffisent pas toujours → timeout dédié.
const SYNC_PUSH_TIMEOUT_MS = 20000;

// Wrappe une promise dans un timeout dur. Si la promise ne résout pas
// dans le délai imparti, on rejette pour éviter un hang permanent
// (problème observé sur mobile : setupSyncRealtime qui ne revient
// jamais quand Realtime n'est pas activé côté Supabase).
function withTimeout(p, label, ms = SYNC_OP_TIMEOUT_MS) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} : timeout ${ms}ms`)), ms))
  ]);
}
// ID unique de cet appareil — permet de différencier nos propres
// pushs (skippés en realtime) des pushs d'autres appareils du même
// compte (qu'on doit pull). Stocké en localStorage, jamais synchronisé.
function getDeviceId() {
  let id = '';
  try { id = localStorage.getItem('chantier_device_id') || ''; } catch (_) {}
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { localStorage.setItem('chantier_device_id', id); } catch (_) {}
  }
  return id;
}
const DEVICE_ID = getDeviceId();
// Clés exclues de la synchro : préférences UI per-device + état sync
const SYNC_EXCLUDED_KEYS = new Set([
  'currentDate',                     // curseur "aujourd'hui" local
  'chartHidden', 'chartRange',       // filtres graphique perso
  'consoRecapMode',                  // mode récap conso perso
  'stockCBMode',                     // mode récap CB stock perso
  'stockPeriod', 'stockSort', 'stockQuery', 'stockMoveFilter', // affichage du Stock (UI)
  'heuresColsCollapsed',             // colonnes repliées du suivi des heures
  'protoActivePlanId',               // plan en cours d'édition
  'protoFilterLotId', 'protoFilterTitle', 'protoFilterStatuses', // filtres Proto
  'echeckinCollapsed',               // sections eCheckIn pliées/dépliées
  'crSelectedCompanyId',             // entreprise sélectionnée dans le slider CR (UI)
  'crSelectedWeekId',                // semaine CR sélectionnée par entreprise (UI)
  'stSelectedCompanyId',             // entreprise sélectionnée dans le slider ST (UI)
  'devisSelectedId',                 // devis sélectionné (UI)
  'devisSelectedVersion',            // indice sélectionné par devis (UI)
  'travauxSelectedLevel',            // niveau de zones affiché dans Travaux (UI)
  'travauxSelectedZoneId',           // zone affichée dans Travaux (UI)
  'travauxLotFilter',                // filtre de lots dans Travaux (UI)
  'travauxVisitePath', 'travauxVisiteDeep', // lieu sélectionné dans la vue Visite (UI)
  'zonePickerCollapsed',             // branches repliées des sélecteurs de zone (UI)
  'recapPeriod', 'recapCurveMode', 'recapCurveZoom', // réglages d'affichage du récapitulatif (UI)
  'ganttZoom',                       // échelle du planning des bâtiments (UI)
  'syncStatus', 'syncTimestamp', 'syncLastPulled', 'syncLastSeenRemoteTs',
  'protoPlan', 'protoPlanW', 'protoPlanH' // champs hérités migrés
]);

let _syncApplying = false;        // true pendant l'application du state distant
let _hasPendingPush = false;      // true si une modif locale n'a pas encore été poussée
let syncPushTimer = null;
let syncPollTimer = null;
let syncRealtimeChannel = null;

function schedulePush() {
  if (!isSupabaseConfigured()) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(() => {
    withTimeout(doSyncPush(), 'push debounced', SYNC_PUSH_TIMEOUT_MS).catch(err => console.warn('[Sync] push debounced KO', err));
  }, SYNC_DEBOUNCE_MS);
}

function getSyncablePayload() {
  const out = {};
  for (const k in state) {
    if (SYNC_EXCLUDED_KEYS.has(k)) continue;
    if (k.startsWith('_')) continue; // clés transitoires/héritées (_legacy*)
    out[k] = state[k];
  }
  // Marqueur d'appareil — sera lu côté pull pour éviter qu'un appareil
  // re-pull son propre push (boucle inutile mais sans dégât).
  out._sourceDeviceId = DEVICE_ID;
  return out;
}

function setSyncStatus(s) {
  state.syncStatus = s;
  updateSyncChip();
}

// Push avec GARDE ANTI-ÉCRASEMENT : avant d'écrire, on vérifie que la
// version serveur est bien celle qu'on a vue en dernier. Si un autre
// appareil a écrit entre-temps, on FUSIONNE d'abord (pull) puis on push
// l'état fusionné. Sans cette garde, un appareil à l'état périmé qui
// fait une modification anodine écrase tout le travail des autres
// (c'est exactement ainsi que les plans Proto ont été perdus).
async function doSyncPush() {
  const supa = await loadSupabase();
  if (!supa) { setSyncStatus('error'); return; }
  setSyncStatus('syncing');
  try {
    const { data: head, error: headErr } = await supa
      .from('site_data')
      .select('updated_at')
      .eq('site_id', SHARED_SITE_ID)
      .maybeSingle();
    if (headErr) throw headErr;
    const headTs = head && head.updated_at ? new Date(head.updated_at).getTime() : 0;
    if (headTs && headTs !== (state.syncLastSeenRemoteTs || 0)) {
      // Le serveur a une version qu'on n'a jamais intégrée → fusion d'abord.
      // (skipHeadCheck : on vient de vérifier updated_at, inutile de relire.)
      await doSyncPull(false, { skipPushGuard: true, skipHeadCheck: true });
    }
    const payload = getSyncablePayload();
    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 4_000_000) {
      console.warn(`[Sync] payload volumineux : ${(payloadJson.length / 1e6).toFixed(1)} Mo — les plans uploadés alourdissent chaque synchro.`);
    }
    const updatedAt = new Date(state.syncTimestamp || Date.now()).toISOString();
    // Upsert : crée la ligne au premier push, puis met à jour à chaque sauvegarde.
    const { error } = await supa.from('site_data').upsert({
      site_id: SHARED_SITE_ID,
      state: payload,
      updated_at: updatedAt
    }, { onConflict: 'site_id' });
    if (error) throw error;
    state.syncLastSeenRemoteTs = new Date(updatedAt).getTime();
    _hasPendingPush = false;
    setSyncStatus('idle');
    // Profite du réseau disponible pour écouler les images en attente
    processPlanUploadQueue();
  } catch (err) {
    console.error('Sync push KO', err);
    setSyncStatus('error');
  }
}

// Pull avec FUSION PAR CLÉ : chaque clé du state est arbitrée par son
// horodatage (syncKeyStamps) — la version la plus récente gagne, clé par
// clé. Un appareil qui n'a pas touché aux plans ne peut donc plus les
// écraser en poussant une modification d'effectifs. Avant d'appliquer le
// moindre changement distant, une sauvegarde locale est créée (IndexedDB).
async function doSyncPull(initial = false, opts = {}) {
  const supa = await loadSupabase();
  if (!supa) { setSyncStatus('error'); return; }
  setSyncStatus('syncing');
  try {
    // PULL EN DEUX TEMPS : on lit d'abord SEULEMENT updated_at (quelques
    // octets). Si le serveur n'a pas bougé depuis la dernière version vue,
    // on s'arrête là — le polling (20 s) ne télécharge plus l'état complet
    // inutilement (avant : tout l'état à chaque tick, plans compris).
    if (!opts.skipHeadCheck) {
      const { data: head, error: headErr } = await supa
        .from('site_data')
        .select('updated_at')
        .eq('site_id', SHARED_SITE_ID)
        .maybeSingle();
      if (headErr) throw headErr;
      const headTs = head && head.updated_at ? new Date(head.updated_at).getTime() : 0;
      if (!initial && head && headTs && headTs === (state.syncLastSeenRemoteTs || 0)) {
        state.syncLastPulled = Date.now();
        setSyncStatus('idle');
        return;
      }
    }
    const { data, error } = await supa
      .from('site_data')
      .select('state, updated_at')
      .eq('site_id', SHARED_SITE_ID)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const remoteTs = data.updated_at ? new Date(data.updated_at).getTime() : 0;
      const remoteState = data.state || {};
      const remoteHasData = Object.keys(remoteState).length > 0;
      const sameDevice = remoteState._sourceDeviceId === DEVICE_ID;
      const alreadySeen = remoteTs && remoteTs === (state.syncLastSeenRemoteTs || 0);
      if (!remoteHasData && initial) {
        // Serveur vide à la 1re connexion → on push notre état local
        await doSyncPush();
      } else if (remoteHasData && !sameDevice && !alreadySeen) {
        const changedKeys = await applyRemoteStateMerge(remoteState, remoteTs);
        state.syncLastSeenRemoteTs = remoteTs;
        if (changedKeys.localWins > 0 && !opts.skipPushGuard) {
          // Des clés locales plus récentes ont survécu à la fusion : le
          // serveur ne les a pas encore → push pour faire converger.
          _hasPendingPush = true;
          schedulePush();
        }
      } else if (sameDevice || alreadySeen) {
        state.syncLastSeenRemoteTs = remoteTs;
      }
    } else if (initial) {
      await doSyncPush();
    }
    state.syncLastPulled = Date.now();
    setSyncStatus('idle');
  } catch (err) {
    console.error('Sync pull KO', err);
    setSyncStatus('error');
  }
}

// Fusion de l'état distant dans le state local, clé par clé.
// Règle : pour chaque clé synchronisable, gagne la version au stamp le
// plus récent. Un payload d'ancien client (sans stamps) est daté de son
// updated_at global. Retourne { remoteWins, localWins }.
// Collections « journal » : enregistrements saisis à la main, NON
// reconstituables. Lors d'une fusion on ne SUPPRIME jamais un
// enregistrement présent d'un côté (union) — un appareil périmé ne peut
// donc pas effacer les effectifs/saisies des autres. Un conflit ponctuel
// (même enregistrement édité des deux côtés) est tranché par l'horodatage
// de clé le plus récent. Compromis assumé : la suppression d'un
// enregistrement entier ne se propage pas depuis un appareil très en
// retard (il « réapparaît » — bénin et rare, contre une perte de données
// catastrophique).
const SYNC_UNION_DICT_KEYS = new Set([
  'presences', 'weather', 'taskProgress', 'zoneUpdated', 'avancementHistory', 'zoneDates', 'stockArticles',
  'adminDocs', 'workerDocs', 'heuresData', 'crEntries', 'stEntries',
  'travauxCells'
]);
const SYNC_UNION_ARRAY_KEYS = new Set([
  'stockEntries', 'consommableEntries', 'protoShapes', 'devis',
  'travauxLocations', 'travauxItems', 'travauxOuvrages', 'travauxPrescriptions'
]);

function _isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function _jsonEq(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

// Union récursive de deux objets : toute sous-clé présente d'un côté est
// conservée ; en cas de conflit sur une feuille, le côté « le plus récent »
// gagne (remoteNewer). Les tableaux et scalaires sont des feuilles.
function unionMergeDeep(local, remote, remoteNewer) {
  if (_isPlainObject(local) && _isPlainObject(remote)) {
    const out = {};
    const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    for (const k of keys) {
      const hl = Object.prototype.hasOwnProperty.call(local, k);
      const hr = Object.prototype.hasOwnProperty.call(remote, k);
      if (hl && hr) out[k] = unionMergeDeep(local[k], remote[k], remoteNewer);
      else if (hl) out[k] = local[k];
      else out[k] = remote[k];
    }
    return out;
  }
  if (_jsonEq(local, remote)) return local;
  return remoteNewer ? remote : local;
}

// Union de deux tableaux d'enregistrements par id : aucun id supprimé,
// conflit tranché par récence. Conserve l'ordre local puis ajoute les
// enregistrements présents seulement côté distant.
function unionMergeById(localArr, remoteArr, remoteNewer) {
  const local = Array.isArray(localArr) ? localArr : [];
  const remote = Array.isArray(remoteArr) ? remoteArr : [];
  const keyOf = (x) => (x && x.id != null) ? x.id : JSON.stringify(x);
  const byId = new Map();
  const order = [];
  for (const it of local) { const k = keyOf(it); if (!byId.has(k)) order.push(k); byId.set(k, it); }
  for (const it of remote) {
    const k = keyOf(it);
    if (!byId.has(k)) { order.push(k); byId.set(k, it); }
    else if (remoteNewer && !_jsonEq(byId.get(k), it)) byId.set(k, it);
  }
  return order.map(k => byId.get(k));
}

async function applyRemoteStateMerge(remoteState, remoteTs) {
  const remoteStamps = (remoteState.syncKeyStamps && typeof remoteState.syncKeyStamps === 'object')
    ? remoteState.syncKeyStamps : {};
  const localStamps = state.syncKeyStamps || {};
  const keys = new Set();
  for (const k of Object.keys(remoteState)) keys.add(k);
  for (const k in state) keys.add(k);
  keys.delete('_sourceDeviceId');
  keys.delete('syncKeyStamps');

  // 1er passage : déterminer la valeur retenue pour chaque clé (sans rien
  // modifier). toApply = { k, value, stamp }. localWins compte les clés
  // dont notre version détient des données que le serveur n'a pas encore
  // (→ il faudra pousser pour faire converger).
  const toApply = [];
  let localWins = 0;
  for (const k of keys) {
    if (SYNC_EXCLUDED_KEYS.has(k) || k.startsWith('_')) continue;
    const inRemote = Object.prototype.hasOwnProperty.call(remoteState, k);
    if (!inRemote) { localWins++; continue; } // clé locale inconnue du serveur
    const rStamp = Number(remoteStamps[k]) || remoteTs || 0;
    const lStamp = Number(localStamps[k]) || 0;

    // Collections DICT « journal » (présences, avancement, docs…) : fusion
    // union — on ne perd jamais une entrée datée/nommée. Les suppressions
    // internes (valeur d'une clé) se propagent via « le plus récent gagne »
    // sur la feuille ; supprimer une clé entière est rare et non bloquant.
    if (SYNC_UNION_DICT_KEYS.has(k)) {
      const remoteNewer = rStamp >= lStamp;
      const merged = unionMergeDeep(_isPlainObject(state[k]) ? state[k] : {}, _isPlainObject(remoteState[k]) ? remoteState[k] : {}, remoteNewer);
      if (!_jsonEq(merged, state[k])) toApply.push({ k, value: merged, stamp: Math.max(rStamp, lStamp) });
      if (!_jsonEq(merged, remoteState[k])) localWins++;
      continue;
    }
    // Collections ARRAY supprimables (formes Proto, devis, travaux, stock,
    // conso…) : union ARBITRÉE PAR HORODATAGE. Le côté le plus récent gagne
    // le tableau entier → les SUPPRESSIONS se propagent (bug corrigé). On
    // n'unionne (anti-perte) que sur égalité stricte de stamp = vraie
    // édition concurrente hors-ligne.
    if (SYNC_UNION_ARRAY_KEYS.has(k)) {
      let merged;
      if (rStamp > lStamp) merged = remoteState[k];
      else if (lStamp > rStamp) merged = state[k];
      else merged = unionMergeById(state[k], remoteState[k], true);
      if (!_jsonEq(merged, state[k])) toApply.push({ k, value: merged, stamp: Math.max(rStamp, lStamp) });
      if (!_jsonEq(merged, remoteState[k])) localWins++;
      continue;
    }

    // Autres clés (structurelles / scalaires) : dernier stamp gagnant.
    if (rStamp > lStamp) {
      if (!_jsonEq(remoteState[k], state[k])) toApply.push({ k, value: remoteState[k], stamp: rStamp });
      else localStamps[k] = rStamp; // aligne le stamp, valeur identique
    } else if (lStamp > rStamp) {
      if (!_jsonEq(remoteState[k], state[k])) localWins++;
    }
  }

  if (toApply.length === 0) return { remoteWins: 0, localWins };

  // 2e passage : SAUVEGARDE de l'état actuel avant tout écrasement, puis
  // application des valeurs retenues.
  try {
    await createLocalBackup('avant synchro (' + toApply.map(x => x.k).slice(0, 5).join(', ') + (toApply.length > 5 ? '…' : '') + ')');
  } catch (e) { console.warn('Backup avant synchro KO (on continue)', e); }

  _syncApplying = true;
  try {
    for (const { k, value, stamp } of toApply) {
      state[k] = value;
      localStamps[k] = stamp;
    }
    state.syncTimestamp = Math.max(state.syncTimestamp || 0, remoteTs || 0);
    save();
    renderAll();
  } finally { _syncApplying = false; }
  // Un ancien client (≤ v1.27) peut avoir poussé des plans avec l'image
  // dataUrl embarquée : on l'extrait vers IndexedDB pour ré-alléger le
  // state (et on la republie vers le bucket au passage).
  if (getProtoPlans().some(p => typeof p.dataUrl === 'string' && p.dataUrl.length > 0)) {
    migratePlanImagesToIDB().catch(e => console.warn('Migration plans post-pull KO', e));
  }
  return { remoteWins: toApply.length, localWins };
}

async function setupSyncRealtime() {
  const supa = await loadSupabase();
  if (!supa || typeof supa.channel !== 'function') return;
  await teardownSyncRealtime();
  try {
    syncRealtimeChannel = supa.channel('site_data_shared')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'site_data',
        filter: 'site_id=eq.' + SHARED_SITE_ID
      }, () => {
        // doSyncPull saute en interne si le state distant vient de cet
        // appareil (via _sourceDeviceId), donc OK d'appeler à chaque event.
        doSyncPull();
      })
      .subscribe();
  } catch (err) {
    console.warn('Realtime setup KO (continue sans realtime)', err);
  }
}
async function teardownSyncRealtime() {
  if (!syncRealtimeChannel) return;
  const supa = await loadSupabase();
  if (supa) {
    try { await supa.removeChannel(syncRealtimeChannel); } catch (_) {}
  }
  syncRealtimeChannel = null;
}

// Polling régulier (fallback robuste si realtime n'est pas activé sur la
// table dans Supabase). 20 s = compromis entre latence et requêtes
// inutiles. Le SDK Supabase coalesce les requêtes — pas de surcharge.
function startSyncPolling() {
  stopSyncPolling();
  syncPollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && isSupabaseConfigured()) {
      withTimeout(doSyncPull(), 'pull polling').catch(err => console.warn('[Sync] pull polling KO', err));
    }
  }, SYNC_POLL_INTERVAL_MS);
}
function stopSyncPolling() {
  if (syncPollTimer) clearInterval(syncPollTimer);
  syncPollTimer = null;
}

// Force une synchro complète : push immédiat si des modifs locales
// sont en attente, puis pull. Utilisé par le bouton « Forcer la sync ».
async function forceFullSync() {
  if (!isSupabaseConfigured()) {
    showToast('Synchronisation non configurée', 'error');
    return;
  }
  clearTimeout(syncPushTimer);
  if (_hasPendingPush) {
    try { await withTimeout(doSyncPush(), 'force push', SYNC_PUSH_TIMEOUT_MS); } catch (e) { console.warn(e); }
  }
  try { await withTimeout(doSyncPull(true), 'force pull'); } catch (e) { console.warn(e); }
  showToast('Synchronisation effectuée');
}

function updateSyncChip() {
  const chip = document.getElementById('syncchip');
  if (!chip) return;
  const labels = {
    idle:    { txt: '🟢 Synchronisé',           cls: 'is-idle' },
    syncing: { txt: '🟡 Sync en cours…',        cls: 'is-syncing' },
    error:   { txt: '🔴 Erreur de sync',         cls: 'is-error' },
    offline: { txt: '⚫ Hors-ligne',             cls: 'is-offline' }
  };
  const lbl = labels[state.syncStatus] || labels.idle;
  chip.textContent = lbl.txt;
  chip.className = 'auth-sync-chip ' + lbl.cls;
}

// Détecte le passage online/offline pour mettre à jour le chip et
// déclencher un push des changements en attente
window.addEventListener('online', () => {
  if (state.syncStatus === 'offline') {
    setSyncStatus('idle');
    schedulePush();
  }
  processPlanUploadQueue(); // reprend les uploads d'images en attente
});
window.addEventListener('offline', () => {
  if (isSupabaseConfigured()) setSyncStatus('offline');
});
// Quand l'utilisateur revient sur l'onglet (focus), pull immédiat pour
// rattraper les changements éventuels des coéquipiers.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isSupabaseConfigured()) {
    withTimeout(doSyncPull(), 'pull visibility').catch(err => console.warn('[Sync] pull visibility KO', err));
  }
});

// ---------- Init ----------
function init() {
  load(); // inclut désormais migratePresences() + migrateSetups() (cf. load)
  syncSelfCheck();
  document.getElementById('appversion').textContent = `Version ${APP_VERSION}`;
  renderAll();

  // Images des plans : migration v1.27 → IndexedDB (allège localStorage
  // et le payload de synchro), nettoyage des images orphelines, puis
  // reprise des uploads en attente vers le bucket Storage.
  (async () => {
    try {
      await maybeCreateStartupBackup();
      const migrated = await migratePlanImagesToIDB();
      if (migrated) renderProto(); // ré-affiche le plan actif depuis le cache
      await gcPlanImages();
      processPlanUploadQueue();
    } catch (e) { console.warn('Init images plans KO', e); }
  })();

  // Tabs (bas de l'écran)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  // Segmented controls (Saisie / Graphique, Entreprises / Zones)
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSubPage(btn.dataset.group, btn.dataset.sub));
  });

  // Zones
  document.getElementById('zoneaddroot').addEventListener('click', () => addZone(null));
  const zoneBatchClear = document.getElementById('zonebatchclear');
  if (zoneBatchClear) zoneBatchClear.addEventListener('click', clearZoneSelection);

  // Import / export de l'arborescence par fichier tableur
  const zoneTpl = document.getElementById('zonetemplatebtn');
  if (zoneTpl) zoneTpl.addEventListener('click', exportZoneTemplate);
  const zoneExp = document.getElementById('zoneexportbtn');
  if (zoneExp) zoneExp.addEventListener('click', exportZoneTree);
  const zoneImpBtn = document.getElementById('zoneimportbtn');
  const zoneImpInput = document.getElementById('zoneimportinput');
  if (zoneImpBtn && zoneImpInput) {
    zoneImpBtn.addEventListener('click', () => zoneImpInput.click());
    zoneImpInput.addEventListener('change', () => handleZoneImportFile(zoneImpInput.files && zoneImpInput.files[0]));
  }
  const zoneImpModal = document.getElementById('zoneimportmodal');
  if (zoneImpModal) {
    document.getElementById('zoneimportclose').addEventListener('click', closeZoneImportModal);
    document.getElementById('zoneimportcancel').addEventListener('click', closeZoneImportModal);
    document.getElementById('zoneimportconfirm').addEventListener('click', confirmZoneImport);
    zoneImpModal.addEventListener('click', (e) => { if (e.target === zoneImpModal) closeZoneImportModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !zoneImpModal.hidden) closeZoneImportModal();
    });
  }

  // Planning des bâtiments : modale de propriétés d'une barre
  const ganttOverlay = document.getElementById('ganttmodal');
  if (ganttOverlay) {
    document.getElementById('ganttmodalclose').addEventListener('click', closeGanttModal);
    ganttOverlay.addEventListener('click', (e) => { if (e.target === ganttOverlay) closeGanttModal(); });
    document.getElementById('ganttsave').addEventListener('click', saveGanttModal);
    document.getElementById('ganttreset').addEventListener('click', resetGanttModal);
    document.getElementById('ganttstart').addEventListener('change', updateGanttModalInfo);
    document.getElementById('ganttend').addEventListener('change', updateGanttModalInfo);
    document.getElementById('ganttname').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveGanttModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !ganttOverlay.hidden) closeGanttModal();
    });
  }
  // Deux vues se dimensionnent sur la largeur réelle de l'écran : le planning
  // (largeur de sa piste) et la courbe du récapitulatif (viewBox choisi par
  // paliers). On les redessine quand la fenêtre change de taille — rotation,
  // redimensionnement, passage sur un second écran.
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      if (document.getElementById('sub-zoneplanning')?.classList.contains('active')) renderZonePlanning();
      if (document.getElementById('sub-recap')?.classList.contains('active')) renderRecap();
      if (document.getElementById('sub-graphique')?.classList.contains('active')) renderChart();
    }, 150);
  });

  // Plans : bouton « Relancer l'envoi » (Données → Admin). Réarme la
  // synchro Storage après correction côté Supabase (bucket/policies).
  const planRetryBtn = document.getElementById('plansyncretry');
  if (planRetryBtn) planRetryBtn.addEventListener('click', async () => {
    planRetryBtn.disabled = true;
    try {
      _planBucketMissing = false;
      _planBucketToastShown = false;
      _planLastStorageError = null;
      // Ré-enfile TOUTES les images présentes sur cet appareil (upsert :
      // renvoyer une image déjà au bucket est inoffensif). Récupère les
      // envois perdus par les anciennes versions (file écrasée).
      try {
        const known = new Set(getProtoPlans().map(p => p.id));
        const localIds = (await mediaListPlanIds()).filter(id => known.has(id));
        const q = getPlanUploadQueue();
        for (const id of localIds) if (!q.includes(id)) q.push(id);
        setPlanUploadQueue(q);
      } catch (e) { console.warn('Ré-enfilage plans KO', e); }
      await processPlanUploadQueue();
      await renderPlanSyncStatus();
      const q = getPlanUploadQueue().length;
      showToast(q === 0 ? 'Tous les plans de cet appareil sont envoyés ✓' : `${q} envoi(s) encore en attente — voir l'état ci-dessus`, q === 0 ? '' : 'error');
    } finally { planRetryBtn.disabled = false; }
  });

  // Sauvegardes de secours (Données → Admin)
  const backupCreateBtn = document.getElementById('backupcreate');
  if (backupCreateBtn) backupCreateBtn.addEventListener('click', async () => {
    backupCreateBtn.disabled = true;
    try {
      await createLocalBackup('manuelle');
      showToast('Sauvegarde créée');
      renderBackupsList();
    } catch (e) {
      showToast('Sauvegarde impossible : ' + (e.message || 'erreur'), 'error');
    } finally { backupCreateBtn.disabled = false; }
  });

  // Tâches
  const taskAdd = document.getElementById('taskadd');
  if (taskAdd) taskAdd.addEventListener('click', addTask);

  // Avancement : flèches de navigation
  document.getElementById('ficheprev').addEventListener('click', () => navigateAvancement(-1));
  document.getElementById('fichenext').addEventListener('click', () => navigateAvancement(+1));

  // Range chips du graphique
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.range === 'all' ? 'all' : parseInt(btn.dataset.range, 10);
      setChartRange(r);
    });
  });
  // Restaurer la sélection de range au chargement
  document.querySelectorAll('.chip-btn').forEach(b => {
    b.classList.toggle('active', String(b.dataset.range) === String(state.chartRange));
  });

  // Date
  document.getElementById('dateprev').addEventListener('click', () => shiftDate(-1));
  document.getElementById('datenext').addEventListener('click', () => shiftDate(1));
  document.getElementById('datedisplay').addEventListener('click', () => {
    document.getElementById('datepicker').showPicker?.() ?? document.getElementById('datepicker').click();
  });
  document.getElementById('datepicker').addEventListener('change', (e) => {
    state.currentDate = e.target.value;
    renderDate();
    renderEntries();
  });

  // Companies
  document.getElementById('addcompanyform').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('newcompanyname');
    addCompany(input.value);
    input.value = '';
  });

  // Import / Export / Reset
  document.getElementById('exportbtn').addEventListener('click', exportData);
  document.getElementById('importbtn').addEventListener('click', () => document.getElementById('importinput').click());
  document.getElementById('importinput').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('resetbtn').addEventListener('click', resetAll);

  // Modale CACES : fermeture (×, clic sur l'overlay) + ajout
  const cacesModal = document.getElementById('cacesmodal');
  if (cacesModal) {
    document.getElementById('cacesmodalclose').addEventListener('click', closeCacesModal);
    cacesModal.addEventListener('click', (e) => {
      if (e.target === cacesModal) closeCacesModal();
    });
    document.getElementById('cacesadd').addEventListener('click', addCaces);
  }

  // Bouton « Copier le récap des échéances » en haut d'eCheckIn
  const reportBtn = document.getElementById('echeckinreportbtn');
  if (reportBtn) reportBtn.addEventListener('click', copyExpiryReport);

  // ----- Stock : FAB + bottom sheet + modale détail -----
  const stockFab = document.getElementById('stockfab');
  if (stockFab) stockFab.addEventListener('click', openStockEntrySheet);
  const stockFab2 = document.getElementById('stockfab2');
  if (stockFab2) stockFab2.addEventListener('click', openStockEntrySheet);
  const stockSheet = document.getElementById('stockentrysheet');
  if (stockSheet) {
    document.getElementById('stockentrysheetclose').addEventListener('click', closeStockEntrySheet);
    stockSheet.addEventListener('click', (e) => { if (e.target === stockSheet) closeStockEntrySheet(); });
    document.getElementById('stockentrysave').addEventListener('click', () => submitStockEntry(false));
    const againBtn = document.getElementById('stockentrysaveagain');
    if (againBtn) againBtn.addEventListener('click', () => submitStockEntry(true));
    // Boutons Réception / Inventaire dans le segmented
    stockSheet.querySelectorAll('[data-stock-entry-type]').forEach(b => {
      b.addEventListener('click', () => setStockEntryType(b.dataset.stockEntryType));
    });
    // Dropdown article : bascule sur le champ texte si « Nouveau »
    const articleSel = document.getElementById('stockarticleselect');
    if (articleSel) articleSel.addEventListener('change', onArticleSelectChange);
    const articleNew = document.getElementById('stockarticlenew');
    if (articleNew) articleNew.addEventListener('input', refreshStockCurrentHint);
  }
  const stockDetailModalEl = document.getElementById('stockdetailmodal');
  if (stockDetailModalEl) {
    document.getElementById('stockdetailclose').addEventListener('click', closeStockDetail);
    stockDetailModalEl.addEventListener('click', (e) => { if (e.target === stockDetailModalEl) closeStockDetail(); });
  }

  // ----- Consommable : FAB + bottom sheet + dropdown -----
  const consoFab = document.getElementById('consofab');
  if (consoFab) consoFab.addEventListener('click', openConsommableSheet);
  const consoSheet = document.getElementById('consoentrysheet');
  if (consoSheet) {
    document.getElementById('consoentrysheetclose').addEventListener('click', closeConsommableSheet);
    consoSheet.addEventListener('click', (e) => { if (e.target === consoSheet) closeConsommableSheet(); });
    document.getElementById('consoentrysave').addEventListener('click', submitConsommableOrder);
    const addLineBtn = document.getElementById('consoaddline');
    if (addLineBtn) addLineBtn.addEventListener('click', addOrderLine);
  }

  // ----- Données → Admin. : période du chantier -----
  const projStart = document.getElementById('projectstart');
  const projEnd   = document.getElementById('projectend');
  if (projStart) projStart.addEventListener('change', () => setProjectStart(projStart.value));
  if (projEnd)   projEnd.addEventListener('change',   () => setProjectEnd(projEnd.value));
  const tauxInp = document.getElementById('tauxhoraire');
  if (tauxInp) tauxInp.addEventListener('input', () => setTauxHoraire(tauxInp.value));

  // ----- Consommable → Récap : bascule produit / eOTP -----
  document.querySelectorAll('.recap-mode-btn[data-recap-mode]').forEach(btn => {
    btn.addEventListener('click', () => setConsoRecapMode(btn.dataset.recapMode));
  });
  // ----- Stock → CB : bascule produit / eOTP -----
  document.querySelectorAll('.recap-mode-btn[data-stock-cb-mode]').forEach(btn => {
    btn.addEventListener('click', () => setStockCBMode(btn.dataset.stockCbMode));
  });

  // ----- Données → Lots : bouton + ajouter -----
  const lotsAddBtn = document.getElementById('lotsadd');
  if (lotsAddBtn) lotsAddBtn.addEventListener('click', addWorkBatch);

  // ----- Proto : upload + outils + dessin + bottom sheet -----
  const protoUpload = document.getElementById('protoupload');
  if (protoUpload) protoUpload.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    handleProtoUpload(f, protoUploadTargetFolderId);
    protoUploadTargetFolderId = '';
    e.target.value = ''; // permet de re-uploader le même fichier
  });
  document.querySelectorAll('.proto-tool-btn[data-proto-tool]').forEach(btn => {
    btn.addEventListener('click', () => setProtoTool(btn.dataset.protoTool));
  });
  const protoClear = document.getElementById('protoclear');
  if (protoClear) protoClear.addEventListener('click', clearProtoShapes);
  const protoOpenManager = document.getElementById('protoopenmanager');
  if (protoOpenManager) protoOpenManager.addEventListener('click', openProtoManager);
  const protoEmptyManager = document.getElementById('protoemptymanager');
  if (protoEmptyManager) protoEmptyManager.addEventListener('click', openProtoManager);
  const protoPlanSel = document.getElementById('protoplanselect');
  if (protoPlanSel) protoPlanSel.addEventListener('change', (e) => setActiveProtoPlan(e.target.value));
  const protoFilterLot = document.getElementById('protofilterlot');
  if (protoFilterLot) protoFilterLot.addEventListener('change', (e) => setProtoFilterLot(e.target.value));
  const protoFilterTitle = document.getElementById('protofiltertitle');
  if (protoFilterTitle) protoFilterTitle.addEventListener('change', (e) => setProtoFilterTitle(e.target.value));
  document.querySelectorAll('.proto-filter-status[data-proto-filter-status]').forEach(btn => {
    btn.addEventListener('click', () => toggleProtoFilterStatus(btn.dataset.protoFilterStatus));
  });
  // Manager modal
  const protoMgr = document.getElementById('protomanager');
  if (protoMgr) {
    document.getElementById('protomanagerclose').addEventListener('click', closeProtoManager);
    protoMgr.addEventListener('click', (e) => { if (e.target === protoMgr) closeProtoManager(); });
    document.getElementById('protomanageraddfolder').addEventListener('click', addProtoFolder);
  }
  // Listeners pointer attachés sur le wrap HTMLElement plutôt que le
  // SVG : setPointerCapture est plus fiable et le drag continue de
  // fonctionner même si le doigt sort de la zone du SVG (iOS Safari).
  const protoWrap = document.getElementById('protocanvaswrap');
  if (protoWrap) {
    protoWrap.addEventListener('pointerdown',   protoPointerDown);
    protoWrap.addEventListener('pointermove',   protoPointerMove);
    protoWrap.addEventListener('pointerup',     protoPointerUp);
    protoWrap.addEventListener('pointercancel', protoPointerUp);
    protoWrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomByAtClient(f, e.clientX, e.clientY);
    }, { passive: false });
  }
  // Filet de sécurité : tout pointerup/cancel au niveau du document
  // nettoie activePointers, même si l'événement n'a pas été délivré au
  // wrap (cas iOS Safari où un pointerup peut être manqué quand un
  // modal s'ouvre ou que l'OS intercepte le toucher). Sans ce filet,
  // des entrées fantômes restaient en mémoire et faisaient basculer
  // par erreur en mode pinch (size = 2) au prochain touch — empêchant
  // tout dessin de fonctionner jusqu'au reload.
  const releaseGhostPointer = (e) => {
    if (protoActivePointers.has(e.pointerId)) {
      protoActivePointers.delete(e.pointerId);
      if (protoActivePointers.size < 2) protoPinch = null;
    }
  };
  document.addEventListener('pointerup',     releaseGhostPointer, true);
  document.addEventListener('pointercancel', releaseGhostPointer, true);
  // Si l'utilisateur quitte la fenêtre (changement d'onglet, retour au
  // shell iOS…), on remet les compteurs à zéro à son retour.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') protoResetGestureState();
  });
  const protoZIn  = document.getElementById('protozoomin');
  const protoZOut = document.getElementById('protozoomout');
  const protoZRst = document.getElementById('protozoomreset');
  if (protoZIn)  protoZIn.addEventListener('click', protoZoomIn);
  if (protoZOut) protoZOut.addEventListener('click', protoZoomOut);
  if (protoZRst) protoZRst.addEventListener('click', protoZoomReset);
  // Polygone / Polyligne : bouton « ✓ Terminer » + « Annuler »
  const protoPolyCancel = document.getElementById('protopolycancel');
  if (protoPolyCancel) protoPolyCancel.addEventListener('click', cancelPolygon);
  const protoPolyFinish = document.getElementById('protopolyfinish');
  if (protoPolyFinish) protoPolyFinish.addEventListener('click', finishCurrentPolyDraw);
  // Mode série (rafale)
  const protoSeriesBtn = document.getElementById('protoseriestoggle');
  if (protoSeriesBtn) protoSeriesBtn.addEventListener('click', toggleProtoSeriesMode);
  // Export PDF
  const protoExpOpen = document.getElementById('protoexportopen');
  if (protoExpOpen) protoExpOpen.addEventListener('click', openProtoExport);
  const protoExp = document.getElementById('protoexport');
  if (protoExp) {
    document.getElementById('protoexportclose').addEventListener('click', closeProtoExport);
    protoExp.addEventListener('click', (e) => { if (e.target === protoExp) closeProtoExport(); });
    document.getElementById('protoexportdownload').addEventListener('click', doProtoExportDownload);
  }
  // Escape annule un polygone en cours
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && protoPolyDraw) cancelPolygon();
  });
  const protoSheet = document.getElementById('protoshapesheet');
  if (protoSheet) {
    document.getElementById('protoshapesheetclose').addEventListener('click', closeProtoShapeSheet);
    protoSheet.addEventListener('click', (e) => { if (e.target === protoSheet) closeProtoShapeSheet(); });
    document.getElementById('protoshapesave').addEventListener('click', saveProtoShapeSheet);
    document.getElementById('protoshapedelete').addEventListener('click', deleteProtoShape);
    document.querySelectorAll('.proto-status-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.proto-status-btn').forEach(b => b.classList.toggle('is-active', b === btn));
      });
    });
  }

  // ----- CR : délégation d'événements sur la page entière -----
  const crPage = document.getElementById('page-cr');
  if (crPage) {
    crPage.addEventListener('click', (e) => {
      const t = e.target.closest('[data-cr-action]');
      if (!t) return;
      const action = t.dataset.crAction;
      const companyId  = t.dataset.companyId;
      const weekId     = t.dataset.weekId;
      const sectionKey = t.dataset.sectionKey;
      const entryId    = t.dataset.entryId;
      if (action === 'select-company') {
        setCRSelectedCompany(companyId);
      } else if (action === 'select-week') {
        setCRSelectedWeek(companyId, weekId);
        renderCR();
      } else if (action === 'add-week') {
        addCRWeek(companyId);
      } else if (action === 'export-pdf') {
        exportCRToPDF(companyId, weekId);
      } else if (action === 'rename-week') {
        const w = getCRWeeks(companyId).find(x => x.id === weekId);
        if (!w) return;
        const proposed = prompt('Renommer ce compte-rendu (ex. « CR 17 ») :', w.label || '');
        if (proposed !== null) renameCRWeek(companyId, weekId, proposed);
      } else if (action === 'delete-week') {
        const weeks = getCRWeeks(companyId);
        const w = weeks.find(x => x.id === weekId);
        if (!w) return;
        if (confirm(`Supprimer définitivement le compte-rendu « ${w.label} » ?\nLes notes saisies dedans seront perdues.`)) {
          deleteCRWeek(companyId, weekId);
        }
      } else if (action === 'toggle-company') {
        toggleCRCollapsed(companyId, weekId, '_company');
        renderCR();
      } else if (action === 'toggle-section') {
        toggleCRCollapsed(companyId, weekId, sectionKey);
        renderCR();
      } else if (action === 'rename-section') {
        const current = getCRSectionLabel(sectionKey);
        const isBuiltIn = CR_BUILTIN_SECTION_KEYS.has(sectionKey);
        const hint = isBuiltIn
          ? 'Nouveau nom de la rubrique :'
          : 'Nouveau nom (laisser vide et OK pour supprimer la rubrique) :';
        const proposed = prompt(hint, current);
        if (proposed === null) return; // annulé
        const trimmed = proposed.trim();
        if (!trimmed) {
          if (isBuiltIn) return; // pas de suppression possible
          if (confirm(`Supprimer la rubrique « ${current} » et toutes ses notes ?`)) {
            deleteCRSection(sectionKey);
            renderCR();
          }
          return;
        }
        if (renameCRSection(sectionKey, trimmed)) renderCR();
      } else if (action === 'add-section') {
        const proposed = prompt('Nom de la nouvelle rubrique :', '');
        if (proposed === null) return;
        if (addCRSection(proposed)) renderCR();
      } else if (action === 'add-entry') {
        addCREntry(companyId, weekId, sectionKey);
      } else if (action === 'add-choose') {
        e.stopPropagation();
        openCRAddMenu(t, companyId, weekId, sectionKey);
      } else if (action === 'validate-widget') {
        setCRWidgetDraft(companyId, weekId, sectionKey, entryId, false);
      } else if (action === 'edit-widget') {
        setCRWidgetDraft(companyId, weekId, sectionKey, entryId, true);
      } else if (action === 'delete-entry') {
        const list = getCREntries(companyId, weekId, sectionKey);
        const isWidget = isCRWidgetEntry(list.find(x => x.id === entryId));
        if (confirm(isWidget ? 'Supprimer ce widget ?' : 'Supprimer cette note ?')) {
          deleteCREntry(companyId, weekId, sectionKey, entryId);
        }
      }
    });
    crPage.addEventListener('change', (e) => {
      const av = e.target.closest('input[data-cr-action="toggle-avancement-visible"]');
      if (av) {
        setCRAvancementVisible(av.dataset.companyId, av.dataset.weekId, av.checked);
        renderCR();
        return;
      }
      const ad = e.target.closest('input[data-cr-action="toggle-admin-visible"]');
      if (ad) {
        setCRAdminVisible(ad.dataset.companyId, ad.dataset.weekId, ad.checked);
        renderCR();
        return;
      }
      const ef = e.target.closest('input[data-cr-action="toggle-effectifs-visible"]');
      if (ef) {
        setCREffectifsVisible(ef.dataset.companyId, ef.dataset.weekId, ef.checked);
        renderCR();
        return;
      }
      const ech = e.target.closest('input[data-cr-action="set-entry-echeance"]');
      if (ech) {
        setCREntryField(ech.dataset.companyId, ech.dataset.weekId, ech.dataset.sectionKey, ech.dataset.entryId, 'echeance', ech.value);
        // Refresh inline du label + couleur du chip date
        const chip = ech.closest('.cr-chip-date');
        const lbl  = chip?.querySelector('.cr-chip-text');
        chip?.classList.remove('is-overdue', 'is-soon');
        if (ech.value) {
          const [yy, mm, dd] = ech.value.split('-');
          if (lbl) lbl.textContent = '📅 ' + dd + '/' + mm + '/' + yy.slice(2);
          const target = new Date(ech.value + 'T00:00:00');
          const ref = new Date(); ref.setHours(0,0,0,0);
          const diff = Math.round((target - ref) / 86400000);
          if (diff < 0) chip?.classList.add('is-overdue');
          else if (diff <= 7) chip?.classList.add('is-soon');
        } else if (lbl) {
          lbl.textContent = '📅 Échéance';
        }
        return;
      }
      const pm = e.target.closest('input[data-cr-action="set-entry-pm"]');
      if (pm) {
        // Coché → echeance = 'PM' ; décoché → null (revient à champ vide)
        setCREntryField(pm.dataset.companyId, pm.dataset.weekId, pm.dataset.sectionKey, pm.dataset.entryId, 'echeance', pm.checked ? 'PM' : null);
        renderCR();
        return;
      }
      const done = e.target.closest('input[data-cr-action="set-entry-done"]');
      if (done) {
        setCREntryField(done.dataset.companyId, done.dataset.weekId, done.dataset.sectionKey, done.dataset.entryId, 'done', done.checked);
        // Toggle visuel direct via classe sans re-render complet
        const row = done.closest('.cr-entry');
        if (row) row.classList.toggle('is-done', done.checked);
        return;
      }
      const resp = e.target.closest('select[data-cr-action="set-entry-responsable"]');
      if (resp) {
        setCREntryField(resp.dataset.companyId, resp.dataset.weekId, resp.dataset.sectionKey, resp.dataset.entryId, 'responsable', resp.value);
        // Refresh inline du label du chip Responsable
        const chip = resp.closest('.cr-chip-resp');
        const lbl  = chip?.querySelector('.cr-chip-text');
        if (lbl) {
          const company = state.companies.find(c => c.id === resp.dataset.companyId);
          const respDisplay = (resp.value === 'BBGO' || !resp.value)
            ? CR_INTERNAL_LABEL
            : (company?.name || CR_INTERNAL_LABEL);
          lbl.textContent = '👤 ' + respDisplay;
        }
        return;
      }
    });
    crPage.addEventListener('input', (e) => {
      const ta = e.target.closest('textarea[data-cr-action="edit-entry"]');
      if (!ta) return;
      updateCREntry(ta.dataset.companyId, ta.dataset.weekId, ta.dataset.sectionKey, ta.dataset.entryId, ta.value);
    });
  }

  // ----- ST : délégation d'événements sur la page entière -----
  const stPage = document.getElementById('page-st');
  if (stPage) {
    stPage.addEventListener('click', (e) => {
      const t = e.target.closest('[data-st-action]');
      if (!t) return;
      const { stAction, companyId, groupKey, entryId } = t.dataset;
      if (stAction === 'select-company') setSTSelectedCompany(companyId);
      else if (stAction === 'add-entry') addSTEntry(companyId, groupKey);
      else if (stAction === 'delete-entry') {
        if (confirm('Supprimer cette ligne ?')) deleteSTEntry(companyId, groupKey, entryId);
      }
    });
    stPage.addEventListener('input', (e) => {
      const el = e.target.closest('[data-st-action]');
      if (!el) return;
      if (el.dataset.stAction === 'edit-text') {
        setSTEntryField(el.dataset.companyId, el.dataset.groupKey, el.dataset.entryId, 'text', el.value);
      } else if (el.dataset.stAction === 'edit-amount') {
        setSTEntryField(el.dataset.companyId, el.dataset.groupKey, el.dataset.entryId, 'amount', el.value);
      }
    });
  }

  // ----- Travaux : barres d'outils des vues Visite et CCTP -----
  // Les champs et boutons vivent dans le HTML et ne sont jamais recréés :
  // la saisie ne perd donc jamais le focus, et l'état visuel est piloté par
  // les fonctions de rendu (classe « is-on »).
  const onInput = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => fn(el));
  };
  const onClick = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => fn(el));
  };

  // CCTP : recherche, filtres rapides, sommaire (mobile)
  onInput('travauxsearch', (el) => {
    travauxSearchQuery = el.value;
    renderTravauxCctpLots();
    renderTravauxCctpBody();
  });
  onClick('travauxcctprempl', () => { travauxCctpRempl = !travauxCctpRempl; renderTravauxCCTP(); });
  onClick('travauxcctpnoloca', () => { travauxCctpNoLoca = !travauxCctpNoLoca; renderTravauxCCTP(); });
  onClick('travauxcctpsomm', (el) => {
    const wrap = document.querySelector('.cctp');
    if (!wrap) return;
    const open = wrap.classList.toggle('is-nav-open');
    el.classList.toggle('is-on', open);
  });

  // Visite : recherche dans le lieu, filtres, dépliage, partage
  onInput('travauxvisitesearch', (el) => { travauxVisiteSearch = el.value; renderTravauxVisiteBody(); });
  onClick('travauxvisiterempl', () => { travauxVisiteRemplOnly = !travauxVisiteRemplOnly; renderTravauxVisite(); });
  onClick('travauxvisitedeep', () => {
    state.travauxVisiteDeep = !state.travauxVisiteDeep;
    save();
    renderTravauxVisite();
  });
  onClick('travauxvisiteexpand', () => {
    travauxVisiteExpandAll = !travauxVisiteExpandAll;
    travauxVisiteExpanded.clear();
    renderTravauxVisiteTools();
    renderTravauxVisiteBody();
  });
  onClick('travauxvisiteshare', () => {
    const target = getTravauxVisiteTarget();
    if (!target) { showToast('Aucun lieu sélectionné', 'error'); return; }
    travauxShareOrCopy('Fiche de visite — ' + travauxZoneLabel(target.id), travauxVisiteAsText());
  });

  // Sélecteur de lieu (modale)
  onInput('travauxzonemodalsearch', (el) => { travauxZoneModalFilter = el.value; renderTravauxZoneModal(); });
  onClick('travauxzonemodalclose', closeTravauxZoneModal);
  const zoneModal = document.getElementById('travauxzonemodal');
  if (zoneModal) {
    zoneModal.addEventListener('click', (e) => { if (e.target === zoneModal) closeTravauxZoneModal(); });
  }

  // ----- Devis : barre de défilement des onglets + délégation -----
  setupDevisTabsScrollbar();
  const devisPage = document.getElementById('page-devis');
  if (devisPage) {
    devisPage.addEventListener('click', (e) => {
      const t = e.target.closest('[data-devis-action]');
      if (!t) return;
      const { devisAction, devisId, lineId, versionId } = t.dataset;
      if (devisAction === 'select') setSelectedDevis(devisId);
      else if (devisAction === 'add') addDevis();
      else if (devisAction === 'delete') deleteDevis(devisId);
      else if (devisAction === 'select-version') setSelectedDevisVersion(devisId, versionId);
      else if (devisAction === 'add-version') addDevisVersion(devisId);
      else if (devisAction === 'delete-version') deleteDevisVersion(devisId, versionId);
      else if (devisAction === 'add-line') addDevisLine(devisId);
      else if (devisAction === 'delete-line') {
        if (confirm('Supprimer cette ligne ? La ligne ST liée sera aussi retirée.')) deleteDevisLine(devisId, lineId);
      }
    });
    devisPage.addEventListener('change', (e) => {
      const t = e.target.closest('[data-devis-action]');
      if (!t) return;
      if (t.dataset.devisAction === 'set-etat') setDevisEtat(t.dataset.devisId, t.value);
      else if (t.dataset.devisAction === 'set-date') setDevisDate(t.dataset.devisId, t.value);
      else if (t.dataset.devisAction === 'edit-company') setDevisLineField(t.dataset.devisId, t.dataset.lineId, 'companyId', t.value);
    });
    devisPage.addEventListener('input', (e) => {
      const t = e.target.closest('[data-devis-action]');
      if (!t) return;
      if (t.dataset.devisAction === 'edit-text') setDevisLineField(t.dataset.devisId, t.dataset.lineId, 'text', t.value);
      else if (t.dataset.devisAction === 'edit-line-field') setDevisLineField(t.dataset.devisId, t.dataset.lineId, t.dataset.field, t.value);
      else if (t.dataset.devisAction === 'set-avenant') setDevisAvenantNum(t.dataset.devisId, t.value);
      else if (t.dataset.devisAction === 'set-taux') setDevisTauxHoraire(t.dataset.devisId, t.value);
    });
  }

  // ----- Sync : chip d'état (droite) + bouton 🔄 (gauche), tous deux dans le header -----
  const syncChip     = document.getElementById('syncchip');
  const syncForceBtn = document.getElementById('syncforcebtn');
  const triggerForceSync = async (el) => {
    try {
      if (el) el.disabled = true;
      if (syncForceBtn) syncForceBtn.classList.add('is-spinning');
      await forceFullSync();
    } catch (e) {
      showToast('Sync KO : ' + (e.message || 'erreur'), 'error');
    } finally {
      if (el) el.disabled = false;
      if (syncForceBtn) syncForceBtn.classList.remove('is-spinning');
    }
  };
  if (syncChip)     syncChip.addEventListener('click',     () => triggerForceSync(syncChip));
  if (syncForceBtn) syncForceBtn.addEventListener('click', () => triggerForceSync(syncForceBtn));
  if (isSupabaseConfigured()) {
    if (syncChip)     syncChip.hidden = false;
    if (syncForceBtn) syncForceBtn.hidden = false;
    updateSyncChip();
    (async () => {
      try { await withTimeout(doSyncPull(true), 'initial pull', 15000); } catch (e) { console.warn('[Sync] initial pull KO', e); }
      try { await withTimeout(setupSyncRealtime(), 'setupSyncRealtime'); } catch (e) { console.warn(e); }
      try { startSyncPolling(); } catch (e) { console.warn(e); }
    })();
  }

  // Service worker : enregistrement + rechargement auto à chaque mise à jour
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => { reg.update(); })
      .catch(() => {});
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  // Filet de sécurité manuel : purge complète du cache et rechargement sur
  // la dernière version publiée. Les données (localStorage) sont intactes.
  const forceUpdateBtn = document.getElementById('forceupdatebtn');
  if (forceUpdateBtn) forceUpdateBtn.addEventListener('click', forceAppUpdate);
}

async function forceAppUpdate() {
  const btn = document.getElementById('forceupdatebtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Mise à jour en cours…'; }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(() => {})));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => {})));
    }
    // Vider les caches du service worker ne suffit pas : le cache HTTP du
    // navigateur garde sa propre copie. Un fetch en « reload » la contourne
    // ET la remplace, si bien que le rechargement qui suit repart du serveur.
    await Promise.all(['./', 'index.html', 'app.js', 'style.css', 'manifest.json']
      .map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
  } catch (e) {
    console.warn('[MAJ] purge partielle', e);
  }
  window.location.reload();
}

document.addEventListener('DOMContentLoaded', init);
