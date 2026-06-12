/* =========================================================
   Suivi de chantier — application PWA
   Stockage local (localStorage) pour cette première version.
   La synchro multi-utilisateurs sera ajoutée ultérieurement.
   ========================================================= */

const STORAGE_KEY = 'chantier_v1';
// Version affichée. Convention : '0.N' correspond au cache 'chantier-vN'
// dans sw.js — toujours bumper les deux ensemble.
const APP_VERSION = '0.85';

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
const TOTAL_COLOR = '#1a1d23';

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
  stockEntries: [],       // [{ id, type: 'reception' | 'inventaire', article, qty, unit, date, notes }]
  consommableEntries: [], // [{ id, orderId, date, notes, product, reference, qty, unit, unitPrice, eOTP }]
  consoProducts: [],      // registre canonique : [{ name, reference, unitPrice }]
  eotps: [],              // lignes de budget eOTP : [{ id, code, label, budget }]
  eotpRegistryInitialized: false, // flag de migration douce (une fois)
  consoRecapMode: 'product', // 'product' | 'eotp' : axe de regroupement du récap Consommable
  projectStart: '',          // date ISO YYYY-MM-DD : début prévu du chantier
  projectEnd: '',            // date ISO YYYY-MM-DD : fin prévue du chantier
  workBatches: [],           // Proto : lots de travaux [{ id, name, color }]
  // Proto : plans organisés en dossiers (multi-plans).
  // Les anciens champs protoPlan/W/H sont migrés au 1er load.
  protoFolders: [],          // [{ id, name }]
  protoPlans: [],            // [{ id, folderId, name, dataUrl, w, h }]
  protoActivePlanId: '',     // id du plan affiché (vide = aucun plan actif)
  protoFilterLotId: '',      // filtre par lot ('' = tous)
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
  // Synchronisation (modèle simplifié : un seul jeu partagé via Supabase)
  syncStatus: 'idle',        // 'idle' | 'syncing' | 'error' | 'offline'
  syncTimestamp: 0,          // ms epoch — dernier changement local connu
  syncLastPulled: 0,         // ms epoch — dernier pull réussi depuis le serveur
  currentDate: todayISO(),
  chartHidden: {},        // { [companyId]: true } — entreprises masquées du graphique
  chartRange: 30          // 7 | 30 | 'all'
};

// État transitoire (non persisté)
let setupRenaming = false;

// ---------- Persistence ----------
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.companies) state.companies = data.companies;
    if (data.zones) state.zones = data.zones;
    if (data.taskSetups) state.taskSetups = data.taskSetups;
    if (data.currentSetupId) state.currentSetupId = data.currentSetupId;
    if (data.zoneOuvrages) state.zoneOuvrages = data.zoneOuvrages;
    if (data.zoneCollapsed) state.zoneCollapsed = data.zoneCollapsed;
    if (data.taskProgress) state.taskProgress = data.taskProgress;
    if (data.zoneUpdated) state.zoneUpdated = data.zoneUpdated;
    if (data.avancementZoneId) state.avancementZoneId = data.avancementZoneId;
    if (data.recapBuildingId) state.recapBuildingId = data.recapBuildingId;
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
    if (data.consommableEntries) state.consommableEntries = data.consommableEntries;
    if (data.consoProducts) state.consoProducts = data.consoProducts;
    if (data.eotps) state.eotps = data.eotps;
    if (typeof data.eotpRegistryInitialized === 'boolean') state.eotpRegistryInitialized = data.eotpRegistryInitialized;
    if (data.consoRecapMode === 'product' || data.consoRecapMode === 'eotp') state.consoRecapMode = data.consoRecapMode;
    if (typeof data.projectStart === 'string') state.projectStart = data.projectStart;
    if (typeof data.projectEnd === 'string') state.projectEnd = data.projectEnd;
    if (Array.isArray(data.workBatches)) state.workBatches = data.workBatches;
    if (Array.isArray(data.protoFolders)) state.protoFolders = data.protoFolders;
    if (Array.isArray(data.protoPlans))   state.protoPlans   = data.protoPlans;
    if (typeof data.protoActivePlanId === 'string') state.protoActivePlanId = data.protoActivePlanId;
    if (typeof data.protoFilterLotId   === 'string') state.protoFilterLotId  = data.protoFilterLotId;
    if (Array.isArray(data.protoFilterStatuses)) state.protoFilterStatuses = data.protoFilterStatuses;
    if (typeof data.protoPlan === 'string') state.protoPlan = data.protoPlan;
    if (Number.isFinite(data.protoPlanW)) state.protoPlanW = data.protoPlanW;
    if (Number.isFinite(data.protoPlanH)) state.protoPlanH = data.protoPlanH;
    if (Array.isArray(data.protoShapes)) state.protoShapes = data.protoShapes;
    if (data.chartHidden) state.chartHidden = data.chartHidden;
    if (data.chartRange) state.chartRange = data.chartRange;
    if (typeof data.syncTimestamp === 'number') state.syncTimestamp = data.syncTimestamp;
    // Champs hérités (ancien modèle à liste unique) → migrés ensuite
    if (data.tasks) state._legacyTasks = data.tasks;
    if (data.zoneHasTasks) state._legacyZoneHasTasks = data.zoneHasTasks;
    // Champs hérités (Phase A : un ouvrage et une quantité par zone) → migrés
    if (data.zoneSetup) state._legacyZoneSetup = data.zoneSetup;
    if (data.zoneQty) state._legacyZoneQty = data.zoneQty;
  } catch (e) {
    console.warn('Lecture stockage impossible', e);
  }
  // Migrations post-load
  migrateConsoProductsFromEntries();
  migrateEOTPsFromConsoEntries();
  migrateProtoPlansFromLegacy();
}
function save() {
  const data = {
    companies: state.companies,
    zones: state.zones,
    taskSetups: state.taskSetups,
    currentSetupId: state.currentSetupId,
    zoneOuvrages: state.zoneOuvrages,
    zoneCollapsed: state.zoneCollapsed,
    taskProgress: state.taskProgress,
    zoneUpdated: state.zoneUpdated,
    avancementZoneId: state.avancementZoneId,
    recapBuildingId: state.recapBuildingId,
    adminDocs: state.adminDocs,
    workers: state.workers,
    workerDocs: state.workerDocs,
    docs: state.docs,
    echeckinCollapsed: state.echeckinCollapsed,
    presences: state.presences,
    weather: state.weather,
    stockEntries: state.stockEntries,
    consommableEntries: state.consommableEntries,
    consoProducts: state.consoProducts,
    eotps: state.eotps,
    eotpRegistryInitialized: state.eotpRegistryInitialized,
    consoRecapMode: state.consoRecapMode,
    projectStart: state.projectStart,
    projectEnd: state.projectEnd,
    workBatches: state.workBatches,
    protoFolders: state.protoFolders,
    protoPlans: state.protoPlans,
    protoActivePlanId: state.protoActivePlanId,
    protoFilterLotId: state.protoFilterLotId,
    protoFilterStatuses: state.protoFilterStatuses,
    protoShapes: state.protoShapes,
    chartHidden: state.chartHidden,
    chartRange: state.chartRange,
    syncTimestamp: state.syncTimestamp
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch (e) { console.warn('localStorage save KO', e); }
  // Synchro : à chaque save, on bump le timestamp et on schedule un
  // push vers Supabase (sauf quand on est justement en train d'appliquer
  // l'état distant — sinon boucle infinie).
  if (!_syncApplying) {
    state.syncTimestamp = Date.now();
    _hasPendingPush = true;
    if (typeof schedulePush === 'function') schedulePush();
  }
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
  renderAdministratif();
  renderDocLabelsConfig();
  renderEOTPsConfig();
  renderProjectDates();
  renderWorkBatchesConfig();
  renderProto();
  renderStock();
  renderConsommable();
  renderDashboard();
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

  // Dimensions du viewBox
  const VB_W = 500, VB_H = 300;
  const ML = 36, MR = 12, MT = 12, MB = 32;
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
  const maxLabels = 6;
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
  renderDashboardToday();
  renderDashboardDocAlerts();
  renderDashboardStockAlerts();
  renderDashboardConsommable();
  renderDashboardEOTPAlerts();
  renderDashboardCompaniesPresence();
  renderDashboardBuildings();
}

function dashboardCardHeader(title, gotoPage) {
  const h = document.createElement('div');
  h.className = 'dashboard-card-header';
  const t = document.createElement('h3');
  t.className = 'dashboard-card-title';
  t.textContent = title;
  h.appendChild(t);
  if (gotoPage) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'dashboard-card-link';
    link.textContent = 'Ouvrir →';
    link.addEventListener('click', () => switchPage(gotoPage));
    h.appendChild(link);
  }
  return h;
}

// --- Widget « Aujourd'hui » (hero) ---
function renderDashboardToday() {
  const el = document.getElementById('dashtoday');
  if (!el) return;
  el.innerHTML = '';
  const date = state.currentDate;
  const presences = state.presences[date] || [];
  const total = presences.reduce((s, e) => s + (e.count || 0), 0);
  const presentCount = presences.filter(e => (e.count || 0) > 0).length;
  const weatherCount = Object.keys(state.weather?.[date] || {}).length;
  const totalCompanies = state.companies.length;
  const { full } = formatDateFR(date);

  el.appendChild(dashboardCardHeader('Aujourd\'hui', 'effectifs'));
  const body = document.createElement('div');
  body.className = 'dashboard-today-body';
  body.innerHTML = `
    <div class="dashboard-today-date"></div>
    <div class="dashboard-today-stats">
      <div class="dashboard-today-stat">
        <div class="dashboard-today-value" id="dt-total"></div>
        <div class="dashboard-today-label" id="dt-totallabel"></div>
      </div>
      <div class="dashboard-today-stat">
        <div class="dashboard-today-value" id="dt-present"></div>
        <div class="dashboard-today-label">entreprises présentes</div>
      </div>
      <div class="dashboard-today-stat ${weatherCount > 0 ? 'is-weather-on' : ''}" id="dt-weather-wrap">
        <div class="dashboard-today-value" id="dt-weather"></div>
        <div class="dashboard-today-label">en intempéries</div>
      </div>
    </div>
  `;
  body.querySelector('.dashboard-today-date').textContent = full;
  body.querySelector('#dt-total').textContent = total;
  body.querySelector('#dt-totallabel').textContent = total > 1 ? 'personnes sur chantier' : 'personne sur chantier';
  body.querySelector('#dt-present').textContent = `${presentCount}/${totalCompanies}`;
  body.querySelector('#dt-weather').textContent = weatherCount;
  el.appendChild(body);
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
  body.className = 'dashboard-alerts-body';
  if (nExpired === 0 && nDanger === 0 && nWarning === 0) {
    body.innerHTML = '<p class="dashboard-empty">Aucun document à signaler.</p>';
  } else {
    body.innerHTML = `
      <div class="dashboard-alert-row status-expired" hidden>
        <span class="dashboard-alert-count" id="da-expired"></span>
        <span class="dashboard-alert-label">ouvriers avec doc périmé</span>
      </div>
      <div class="dashboard-alert-row status-danger" hidden>
        <span class="dashboard-alert-count" id="da-danger"></span>
        <span class="dashboard-alert-label">ouvriers en danger (≤ 3 j)</span>
      </div>
      <div class="dashboard-alert-row status-warning" hidden>
        <span class="dashboard-alert-count" id="da-warning"></span>
        <span class="dashboard-alert-label">ouvriers en alerte (≤ 7 j)</span>
      </div>
    `;
    if (nExpired > 0) {
      body.querySelector('.status-expired').hidden = false;
      body.querySelector('#da-expired').textContent = nExpired;
    }
    if (nDanger > 0) {
      body.querySelector('.status-danger').hidden = false;
      body.querySelector('#da-danger').textContent = nDanger;
    }
    if (nWarning > 0) {
      body.querySelector('.status-warning').hidden = false;
      body.querySelector('#da-warning').textContent = nWarning;
    }
  }
  el.appendChild(body);
}

// --- Widget « Stock critique » ---
function renderDashboardStockAlerts() {
  const el = document.getElementById('dashstockalerts');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Stock critique', 'stock'));

  const summary = getStockSummary();
  const critical = [];
  for (const item of summary) {
    const dep = getArticleDepletion(item.article, item.stock);
    if (dep.days !== null && dep.days >= 0 && dep.days <= STOCK_ALERT_THRESHOLD_DAYS) {
      critical.push({ ...item, depletion: dep });
    }
  }
  critical.sort((a, b) => a.depletion.days - b.depletion.days);

  const body = document.createElement('div');
  body.className = 'dashboard-stock-body';
  if (critical.length === 0) {
    body.innerHTML = '<p class="dashboard-empty">Aucun article en alerte.</p>';
  } else {
    const ul = document.createElement('ul');
    ul.className = 'dashboard-stock-list';
    for (const it of critical) {
      const days = it.depletion.days;
      const li = document.createElement('li');
      li.className = 'dashboard-stock-row' + (days <= 0 ? ' is-empty' : (days <= 3 ? ' is-danger' : ' is-warning'));
      const label = days <= 0 ? 'épuisé' : (days === 1 ? '1 j ouvré' : `${days} j ouvrés`);
      li.innerHTML = `
        <span class="dashboard-stock-name"></span>
        <span class="dashboard-stock-stock"></span>
        <span class="dashboard-stock-days"></span>
      `;
      li.querySelector('.dashboard-stock-name').textContent = it.article;
      li.querySelector('.dashboard-stock-stock').textContent = `${fmtStockQty(it.stock)} ${it.unit}`;
      li.querySelector('.dashboard-stock-days').textContent = label;
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
  for (const e of entries) {
    const eur = (Number(e.qty) || 0) * (Number(e.unitPrice) || 0);
    cumulTotal += eur;
    if ((e.date || '').slice(0, 7) === monthKey) {
      monthTotal += eur;
      monthOrders.add(getEntryOrderId(e));
    }
  }
  const nbOrders = monthOrders.size;
  body.innerHTML = `
    <div class="dashboard-conso-stats">
      <div class="dashboard-conso-stat is-primary">
        <div class="dashboard-conso-value" id="dc-month"></div>
        <div class="dashboard-conso-label">ce mois HT</div>
      </div>
      <div class="dashboard-conso-stat">
        <div class="dashboard-conso-value" id="dc-orders"></div>
        <div class="dashboard-conso-label" id="dc-orders-label"></div>
      </div>
      <div class="dashboard-conso-stat">
        <div class="dashboard-conso-value" id="dc-cumul"></div>
        <div class="dashboard-conso-label">cumul HT</div>
      </div>
    </div>
  `;
  body.querySelector('#dc-month').textContent  = fmtEur(monthTotal);
  body.querySelector('#dc-orders').textContent = nbOrders;
  body.querySelector('#dc-orders-label').textContent = nbOrders > 1 ? 'commandes ce mois' : 'commande ce mois';
  body.querySelector('#dc-cumul').textContent  = fmtEur(cumulTotal);
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
  const eotps = getEOTPs().filter(e => (e.code || '').trim() && (e.budget || 0) > 0);
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
    body.innerHTML = '<p class="dashboard-empty">Aucun dépassement projeté. ✓</p>';
    el.appendChild(body);
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'dashboard-eotp-list';
  for (const a of alerts) {
    const li = document.createElement('li');
    li.className = 'dashboard-eotp-row is-' + a.level;
    li.innerHTML = `
      <span class="dashboard-eotp-code-wrap">
        <span class="dashboard-eotp-code"></span>
        <span class="dashboard-eotp-label"></span>
      </span>
      <span class="dashboard-eotp-ecart"></span>
    `;
    li.querySelector('.dashboard-eotp-code').textContent = a.code;
    const lbl = li.querySelector('.dashboard-eotp-label');
    if (a.label) lbl.textContent = a.label; else lbl.remove();
    li.querySelector('.dashboard-eotp-ecart').textContent = a.level === 'danger'
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
  body.className = 'dashboard-companies-body';
  if (state.companies.length === 0) {
    body.innerHTML = '<p class="dashboard-empty">Aucune entreprise enregistrée.</p>';
  } else {
    const table = document.createElement('table');
    table.className = 'dashboard-table';
    table.innerHTML = '<thead><tr><th>Entreprise</th><th>Effectif</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.className = r.onWeather ? 'is-weather' : '';
      tr.innerHTML = `
        <td>
          <span class="dashboard-company-name"></span>
          ${r.onWeather ? '<span class="dashboard-weather-pill">🌧</span>' : ''}
        </td>
        <td class="dashboard-table-num"></td>
      `;
      tr.querySelector('.dashboard-company-name').textContent = r.name;
      tr.querySelector('.dashboard-table-num').textContent = r.count;
      tbody.appendChild(tr);
    }
    const total = rows.reduce((s, r) => s + r.count, 0);
    const tfoot = document.createElement('tfoot');
    tfoot.innerHTML = '<tr><th>Total</th><th class="dashboard-table-num"></th></tr>';
    tfoot.querySelector('.dashboard-table-num').textContent = total;
    table.appendChild(tbody);
    table.appendChild(tfoot);
    body.appendChild(table);
  }
  el.appendChild(body);
}

// --- Widget « Avancement par bâtiment » ---
function getBuildingOverallProgress(buildingId) {
  const descendants = getDescendantZones(buildingId);
  const active = descendants.filter(zid => getZoneOuvrages(zid).length > 0);
  if (active.length === 0) return null;
  const total = active.reduce((sum, zid) => sum + getZoneProgress(zid), 0);
  return total / active.length;
}
function renderDashboardBuildings() {
  const el = document.getElementById('dashbuildings');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(dashboardCardHeader('Avancement par bâtiment', 'avancement'));

  const buildings = getBuildings();
  const body = document.createElement('div');
  body.className = 'dashboard-buildings-body';
  if (buildings.length === 0) {
    body.innerHTML = '<p class="dashboard-empty">Aucun bâtiment (zone racine) défini.</p>';
  } else {
    for (const b of buildings) {
      const pct = getBuildingOverallProgress(b.id);
      const row = document.createElement('div');
      row.className = 'dashboard-building-row';
      const pctText = pct === null ? '—' : `${formatPct(Math.round(pct * 10) / 10)} %`;
      const barPct = pct === null ? 0 : Math.max(0, Math.min(100, pct));
      row.innerHTML = `
        <div class="dashboard-building-line">
          <span class="dashboard-building-name"></span>
          <span class="dashboard-building-pct"></span>
        </div>
        <div class="dashboard-building-bar"><div class="dashboard-building-bar-fill" style="width:${barPct}%"></div></div>
      `;
      row.querySelector('.dashboard-building-name').textContent = b.name || '(zone sans nom)';
      row.querySelector('.dashboard-building-pct').textContent = pctText;
      if (pct !== null && pct >= 100) row.classList.add('is-done');
      body.appendChild(row);
    }
  }
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

function renderZones() {
  const tree = document.getElementById('zonetree');
  const empty = document.getElementById('zoneempty');
  if (!tree || !empty) return;
  tree.innerHTML = '';

  if (state.zones.length === 0) {
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');

  const renderNode = (zone, depth) => {
    const children = getZoneChildren(zone.id);
    const hasChildren = children.length > 0;
    const collapsed = !!state.zoneCollapsed[zone.id];

    const row = document.createElement('div');
    row.className = 'zone-row';
    row.dataset.id = zone.id;
    row.dataset.depth = String(depth);
    row.style.setProperty('--depth', depth);
    const collapseHtml = hasChildren
      ? `<button class="zone-collapse" data-action="collapse" aria-label="${collapsed ? 'Déplier' : 'Replier'}">${collapsed ? '+' : '−'}</button>`
      : `<span class="zone-collapse-spacer"></span>`;
    row.innerHTML = `
      <div class="zone-row-main">
        ${collapseHtml}
        <input class="zone-name-input" type="text" maxlength="80" placeholder="Nom de la zone" />
        <span class="zone-task-slot"></span>
        <button class="zone-add-sub" data-action="add-child" aria-label="Ajouter un sous-niveau">+</button>
        <button class="icon-btn danger" data-action="delete" aria-label="Supprimer">
          <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>
        </button>
      </div>
    `;
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
  // focus le champ de la nouvelle zone
  const input = document.querySelector(`.zone-row[data-id="${zone.id}"] input`);
  if (input) {
    input.focus();
    // assure que le champ est visible
    input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
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
  }
  if (toRemove.has(state.avancementZoneId)) state.avancementZoneId = null;
  save();
  renderZones();
  renderAvancement();
}

// Picker (select natif iOS) pour AJOUTER un ouvrage à une zone.
// Le select ne liste que les ouvrages pas encore affectés à la zone.
const ZONE_UNITS = ['u', 'Ens.', 'm²', 'ml'];

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
    if (sid) addOuvrageToZone(zone.id, sid);
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

// ---------- Setups : barre de gestion des configurations ----------
function renderSetupBar() {
  const bar = document.getElementById('setupbar');
  if (!bar) return;
  bar.innerHTML = '';
  const setup = getCurrentSetup();
  if (!setup) return;

  if (setupRenaming) {
    const input = document.createElement('input');
    input.className = 'setup-rename-input';
    input.maxLength = 40;
    input.value = setup.name;
    input.placeholder = 'Nom de la configuration';
    bar.appendChild(input);
    requestAnimationFrame(() => { input.focus(); input.select(); });
    const commit = () => {
      if (!setupRenaming) return;
      setupRenaming = false;
      const name = input.value.trim();
      if (name) { setup.name = name; save(); }
      renderSetupBar();
      renderAvancement();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    return;
  }

  const select = document.createElement('select');
  select.className = 'setup-select';
  select.setAttribute('aria-label', 'Configuration de tâches');
  for (const s of state.taskSetups) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name || '(sans nom)';
    if (s.id === state.currentSetupId) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => switchSetup(select.value));
  bar.appendChild(select);

  // Sélecteur d'unité de l'ouvrage (Phase A : l'unité passe au niveau de
  // l'ouvrage ; les ratios sont en h/<unité>, et les zones affichent cette
  // unité en lecture seule)
  const unitSelect = document.createElement('select');
  unitSelect.className = 'setup-unit-select';
  unitSelect.setAttribute('aria-label', 'Unité de l\'ouvrage');
  for (const u of ZONE_UNITS) {
    const opt = document.createElement('option');
    opt.value = u;
    opt.textContent = u;
    if (u === setup.unit) opt.selected = true;
    unitSelect.appendChild(opt);
  }
  unitSelect.addEventListener('change', () => {
    setup.unit = unitSelect.value;
    save();
    renderTasks();
    renderZones();
    renderAvancement();
  });
  bar.appendChild(unitSelect);

  const mkBtn = (label, svg, danger) => {
    const b = document.createElement('button');
    b.className = 'setup-icon-btn' + (danger ? ' danger' : '');
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    bar.appendChild(b);
    return b;
  };
  mkBtn('Renommer la configuration',
    '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>'
  ).addEventListener('click', () => { setupRenaming = true; renderSetupBar(); });
  mkBtn('Nouvelle configuration',
    '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z"/></svg>'
  ).addEventListener('click', addSetup);
  const delBtn = mkBtn('Supprimer la configuration',
    '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>',
    true
  );
  if (state.taskSetups.length <= 1) delBtn.disabled = true;
  delBtn.addEventListener('click', deleteSetup);
}

function switchSetup(setupId) {
  if (!getSetup(setupId)) return;
  state.currentSetupId = setupId;
  save();
  renderSetupBar();
  renderTasks();
}

function addSetup() {
  const setup = { id: uid(), name: `Configuration ${state.taskSetups.length + 1}`, unit: 'm²', tasks: [] };
  state.taskSetups.push(setup);
  state.currentSetupId = setup.id;
  setupRenaming = true;
  save();
  renderSetupBar();
  renderTasks();
}

function deleteSetup() {
  if (state.taskSetups.length <= 1) return;
  const setup = getCurrentSetup();
  if (!setup) return;
  if (!confirm(`Supprimer la configuration « ${setup.name} » et ses tâches ?\nLes zones qui l'utilisaient n'auront plus de tâches affectées.`)) return;
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
  renderTasks();
  renderZones();
  renderAvancement();
}

// ---------- Tasks (tâches d'une configuration) ----------
function renderTasks() {
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

  for (const task of tasks) {
    const excluded = !!task.excluded;
    const li = document.createElement('li');
    li.className = 'task-item' + (excluded ? ' excluded' : '');
    li.dataset.id = task.id;
    li.innerHTML = `
      <button class="drag-handle" aria-label="Maintenir et glisser pour réorganiser">
        <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z"/></svg>
      </button>
      <input class="task-name-input" type="text" maxlength="80" placeholder="Nom de la tâche" />
      <span class="task-ratio-slot"></span>
      <button class="task-exclude-btn${excluded ? ' active' : ''}" data-action="exclude" aria-label="Exclure du ratio de production">
        <svg viewBox="0 0 24 24"><path d="M15 1H9v2h6V1Zm4.03 6.39 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.96 8.96 0 0 0 12 4a9 9 0 1 0 9 9c0-2.12-.74-4.07-1.97-5.61ZM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-6h2V8h-2v6Z"/><path d="M3.5 2.1 21.9 20.5l-1.4 1.4L2.1 3.5 3.5 2.1Z"/></svg>
      </button>
      <button class="icon-btn danger" data-action="delete" aria-label="Supprimer">
        <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>
      </button>
    `;
    const input = li.querySelector('.task-name-input');
    input.value = task.name;
    input.addEventListener('input', () => renameTask(task.id, input.value));

    const slot = li.querySelector('.task-ratio-slot');
    const wrap = document.createElement('span');
    wrap.className = 'task-ratio';
    const ri = document.createElement('input');
    ri.className = 'task-ratio-input';
    ri.type = 'text';
    ri.inputMode = 'decimal';
    ri.placeholder = '0';
    ri.value = task.ratio ? formatRatio(task.ratio) : '';
    ri.addEventListener('input', () => {
      task.ratio = parseRatio(ri.value);
      save();
      updateRatioSum();
    });
    wrap.appendChild(ri);
    if (excluded) {
      const badge = document.createElement('span');
      badge.className = 'task-hors-ratio';
      badge.textContent = 'hors ratio';
      wrap.appendChild(badge);
    } else {
      const unit = document.createElement('span');
      unit.className = 'task-ratio-unit';
      unit.textContent = `h/${setup.unit || 'm²'}`;
      wrap.appendChild(unit);
    }
    slot.replaceWith(wrap);

    li.querySelector('[data-action="exclude"]').addEventListener('click', () => toggleTaskExcluded(task.id));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => deleteTask(task.id));
    attachTaskDrag(li.querySelector('.drag-handle'), li);
    list.appendChild(li);
  }
  updateRatioSum();
}

function updateRatioSum() {
  const el = document.getElementById('ratiototal');
  if (!el) return;
  const setup = getCurrentSetup();
  if (!setup || setup.tasks.length === 0) { el.hidden = true; return; }
  el.hidden = false;
  const sum = setup.tasks.filter(t => !t.excluded).reduce((s, t) => s + (t.ratio || 0), 0);
  el.textContent = `Ratio de production total : ${formatRatio(sum)} h/${setup.unit || 'm²'}`;
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
  const input = document.querySelector(`.task-item[data-id="${task.id}"] input`);
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

function drillDown(zoneId) {
  let current = zoneId;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (zoneIsTaskBearing(current)) return current;
    const children = state.zones.filter(z => z.parentId === current);
    if (children.length === 0) return current;
    current = children[0].id;
  }
  return current;
}

function getProgress(zoneId, taskId) {
  return state.taskProgress[zoneId]?.[taskId] || 0;
}

function setProgress(zoneId, taskId, percent) {
  percent = Math.max(0, Math.min(100, Math.round(percent / 5) * 5));
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
}

// Avancement global pondéré par le ratio de production des tâches (0..100)
// Les tâches « hors ratio » (excluded) sont ignorées dans ce calcul.
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
// % global de la zone : moyenne simple des % par ouvrage
// (placeholder en attendant la décision sur la pondération horaire)
function getZoneProgress(zoneId) {
  const ouvrages = getZoneOuvrages(zoneId);
  if (ouvrages.length === 0) return 0;
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

function changeProgress(zoneId, taskId, delta) {
  const cur = getProgress(zoneId, taskId);
  setProgress(zoneId, taskId, cur + delta);
  renderFicheHeader();
  renderProgressList();
  renderRecap();
}

function navigateAvancement(delta) {
  const list = getTaskZonesInOrder();
  const idx = list.findIndex(z => z.id === state.avancementZoneId);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= list.length) return;
  state.avancementZoneId = list[newIdx].id;
  save();
  renderAvancement();
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

function renderAvancement() {
  renderRecap();
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

  // Sélecteurs en cascade : un par niveau du chemin
  const path = getZonePath(zone.id);
  let parentId = null;
  for (let d = 0; d < path.length; d++) {
    const siblings = state.zones.filter(z => z.parentId === parentId);
    if (siblings.length === 0) break;

    const wrap = document.createElement('div');
    wrap.className = 'zone-picker';
    wrap.innerHTML = `
      <span class="zone-picker-label">Niveau ${d + 1}</span>
      <select></select>
    `;
    const select = wrap.querySelector('select');
    for (const sib of siblings) {
      const opt = document.createElement('option');
      opt.value = sib.id;
      opt.textContent = sib.name || '(sans nom)';
      if (sib.id === path[d].id) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      state.avancementZoneId = drillDown(select.value);
      save();
      renderAvancement();
    });
    pickers.appendChild(wrap);

    parentId = path[d].id;
  }

  // Fiche : en-tête (flèches + titre) + liste de tâches
  fiche.hidden = false;
  const idx = taskZones.findIndex(z => z.id === zone.id);
  document.getElementById('ficheprev').disabled = idx <= 0;
  document.getElementById('fichenext').disabled = idx < 0 || idx >= taskZones.length - 1;

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

  for (const { setup } of ouvrages) {
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
      list.appendChild(buildProgressItem(zoneId, setup, task));
    }
  }
}

function buildProgressItem(zoneId, setup, task) {
  const percent = getProgress(zoneId, task.id);
  const isDone = percent >= 100;
  const li = document.createElement('li');
  applyOuvrageColor(li, setup);
  li.className = 'progress-item' + (isDone ? ' is-done' : '') + (task.excluded ? ' is-excluded' : '');
  li.innerHTML = `
    <div class="progress-info">
      <span class="progress-task-name"></span>
    </div>
    <div class="counter is-percent">
      <button class="counter-btn" data-action="dec" aria-label="−5 %">−</button>
      <span class="counter-value"></span>
      <button class="counter-btn" data-action="inc" aria-label="+5 %">+</button>
    </div>
    <button class="progress-tick" data-action="tick" aria-label="Marquer terminé à 100 %">
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
  li.querySelector('.counter-value').textContent = `${percent} %`;
  const decBtn = li.querySelector('[data-action="dec"]');
  const incBtn = li.querySelector('[data-action="inc"]');
  if (percent <= 0) decBtn.disabled = true;
  if (percent >= 100) incBtn.disabled = true;
  decBtn.addEventListener('click', () => changeProgress(zoneId, task.id, -5));
  incBtn.addEventListener('click', () => changeProgress(zoneId, task.id, +5));
  li.querySelector('[data-action="tick"]').addEventListener('click', () => {
    setProgress(zoneId, task.id, isDone ? 0 : 100);
    renderFicheHeader();
    renderProgressList();
    renderRecap();
  });
  return li;
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
    emptyEl.innerHTML = '<p>Aucun bâtiment.</p><p class="hint">Crée au moins une zone racine dans <strong>Données → Zones</strong>.</p>';
    emptyEl.classList.add('show');
    return;
  }

  // Résolution du bâtiment sélectionné
  let buildingId = state.recapBuildingId;
  if (!buildings.some(b => b.id === buildingId)) buildingId = buildings[0].id;
  if (buildingId !== state.recapBuildingId) {
    state.recapBuildingId = buildingId;
    save();
  }

  // Menu déroulant des bâtiments
  const label = document.createElement('label');
  label.className = 'recap-picker-label';
  label.textContent = 'Bâtiment';
  const select = document.createElement('select');
  select.className = 'recap-picker-select';
  select.setAttribute('aria-label', 'Bâtiment');
  for (const b of buildings) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name || '(zone sans nom)';
    if (b.id === buildingId) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    state.recapBuildingId = select.value;
    save();
    renderRecap();
  });
  pickerEl.append(label, select);

  // Agrégation : pour chaque (ouvrage, tâche), somme pondérée par la quantité
  // d'ouvrage de chaque sous-zone. agg[setupId][taskId] = { num, den, count, sum }
  const descendants = getDescendantZones(buildingId);
  const agg = {};
  const setupOrder = [];
  for (const zid of descendants) {
    for (const o of getZoneOuvrages(zid)) {
      const sid = o.setup.id;
      if (!agg[sid]) { agg[sid] = { setup: o.setup, tasks: {} }; setupOrder.push(sid); }
      const q = o.quantity || 0;
      for (const task of o.setup.tasks) {
        const t = agg[sid].tasks[task.id] || (agg[sid].tasks[task.id] = { task, num: 0, den: 0, sum: 0, count: 0 });
        const p = getProgress(zid, task.id);
        t.num += p * q;
        t.den += q;
        t.sum += p;
        t.count += 1;
      }
    }
  }

  if (setupOrder.length === 0) {
    emptyEl.innerHTML = '<p>Ce bâtiment ne contient aucun ouvrage.</p><p class="hint">Affecte un ouvrage à au moins une de ses zones dans <strong>Données → Zones</strong>.</p>';
    emptyEl.classList.add('show');
    return;
  }

  // Construction du tableau
  for (const sid of setupOrder) {
    const group = agg[sid];
    const section = document.createElement('div');
    section.className = 'recap-section';
    applyOuvrageColor(section, group.setup);

    const header = document.createElement('div');
    header.className = 'recap-section-header';
    const name = document.createElement('span');
    name.className = 'recap-section-name';
    name.textContent = group.setup.name || '(ouvrage sans nom)';
    header.appendChild(name);
    section.appendChild(header);

    const rows = document.createElement('ul');
    rows.className = 'recap-rows';
    for (const task of group.setup.tasks) {
      const t = group.tasks[task.id];
      if (!t) continue;
      // % pondéré par la quantité ; si toutes les quantités sont 0, repli sur moyenne simple
      const pct = t.den > 0 ? t.num / t.den : (t.count > 0 ? t.sum / t.count : 0);
      const rounded = Math.round(pct * 10) / 10;
      const isDone = rounded >= 100;
      const li = document.createElement('li');
      li.className = 'recap-row' + (isDone ? ' is-done' : '') + (task.excluded ? ' is-excluded' : '');
      const nm = document.createElement('span');
      nm.className = 'recap-task-name';
      nm.textContent = task.name || '(tâche sans nom)';
      const pc = document.createElement('span');
      pc.className = 'recap-task-pct';
      pc.textContent = `${formatPct(rounded)} %`;
      li.append(nm);
      if (task.excluded) {
        const tag = document.createElement('span');
        tag.className = 'recap-tag';
        tag.textContent = 'hors ratio';
        li.append(tag);
      }
      li.append(pc);
      rows.appendChild(li);
    }
    section.appendChild(rows);
    contentEl.appendChild(section);
  }
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

function renderEOTPsConfig() {
  const list = document.getElementById('eotplist');
  if (!list) return;
  list.innerHTML = '';
  const eotps = getEOTPs();
  if (eotps.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'eotp-empty';
    empty.textContent = 'Aucune ligne de budget. Tapez « + Ajouter » pour en créer.';
    list.appendChild(empty);
    return;
  }
  // Tri par code alphanumérique pour la lecture
  const sorted = eotps.slice().sort((a, b) => (a.code || '').localeCompare(b.code || '', 'fr'));
  for (const e of sorted) list.appendChild(buildEOTPRow(e));
}
function buildEOTPRow(eotp) {
  const li = document.createElement('li');
  li.className = 'eotp-row';
  li.setAttribute('data-eotp-id', eotp.id);
  li.innerHTML = `
    <div class="eotp-row-main">
      <input class="eotp-code" type="text" maxlength="30" placeholder="OTP-2026-001">
      <div class="eotp-budget-wrap">
        <input class="eotp-budget" type="text" inputmode="decimal" placeholder="0">
        <span class="eotp-budget-currency">€</span>
      </div>
      <button class="eotp-remove" type="button" aria-label="Supprimer cette ligne">
        <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
      </button>
    </div>
    <input class="eotp-label" type="text" maxlength="80" placeholder="Libellé (optionnel) : Plomberie phase 1, GO…">
  `;
  const code   = li.querySelector('.eotp-code');
  const budget = li.querySelector('.eotp-budget');
  const label  = li.querySelector('.eotp-label');
  code.value   = eotp.code || '';
  budget.value = eotp.budget ? fmtPriceForInput(eotp.budget) : '';
  label.value  = eotp.label || '';
  code.addEventListener('input',   () => setEOTPCode(eotp.id, code.value));
  budget.addEventListener('input', () => setEOTPBudget(eotp.id, budget.value));
  label.addEventListener('input',  () => setEOTPLabel(eotp.id, label.value));
  li.querySelector('.eotp-remove').addEventListener('click', () => removeEOTP(eotp.id));
  return li;
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
  const buttons = Array.from(document.querySelectorAll(`.seg-btn[data-group="${group}"]`));
  const idx = buttons.findIndex(b => b.dataset.sub === name);
  buttons.forEach((b, i) => b.classList.toggle('active', i === idx));
  document.querySelectorAll(`.sub-page[data-group="${group}"]`).forEach(p => {
    p.classList.toggle('active', p.id === `sub-${name}`);
  });
  document.querySelector(`.segmented[data-group="${group}"]`).dataset.position = String(idx < 0 ? 0 : idx);
  if (group === 'effectifs' && name === 'graphique') {
    renderChart();
    renderLegend();
  }
  // Garantit un récap toujours frais à l'ouverture du sous-onglet
  if (group === 'avancement' && name === 'recap') renderRecap();
  if (group === 'proto' && name === 'recap') renderProtoRecap();
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

// ---------- Stock (entrées + consultation) ----------
const STOCK_UNITS = ['u', 'sacs', 'palettes', 'kg', 't', 'm³', 'm²', 'ml', 'L'];

function compareStockEntries(a, b) {
  // Ordre chronologique (asc), à date égale : par id pour stabilité
  return a.date.localeCompare(b.date) || String(a.id || '').localeCompare(String(b.id || ''));
}
// Agrégation : pour chaque article, on calcule le stock courant en
// parcourant les entrées triées par date asc. Réception = ajout,
// Inventaire = remise au compteur. La dernière entrée détermine
// l'unité affichée.
function getStockSummary() {
  const map = new Map();
  const sorted = state.stockEntries.slice().sort(compareStockEntries);
  for (const e of sorted) {
    const key = (e.article || '').trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { article: e.article, unit: e.unit, stock: 0, lastEntry: e, count: 0 });
    }
    const cur = map.get(key);
    cur.article = e.article;       // garde la dernière casse saisie
    cur.unit = e.unit;
    cur.lastEntry = e;
    cur.count++;
    if (e.type === 'inventaire') cur.stock = Number(e.qty) || 0;
    else cur.stock += Number(e.qty) || 0;
  }
  return Array.from(map.values()).sort((a, b) => a.article.localeCompare(b.article, 'fr'));
}
// Historique d'un article (le plus récent en premier) pour la modale détail
function getArticleHistory(articleName) {
  const key = (articleName || '').trim().toLowerCase();
  return state.stockEntries
    .filter(e => (e.article || '').trim().toLowerCase() === key)
    .sort(compareStockEntries)
    .reverse();
}
// Liste unique des noms d'articles déjà saisis, pour le datalist
function getAllArticleNames() {
  const set = new Map(); // clé = lowercase, valeur = dernière casse
  for (const e of state.stockEntries) {
    const k = (e.article || '').trim().toLowerCase();
    if (k) set.set(k, e.article);
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
    const received = sorted
      .filter(e => e.type === 'reception' && e.date > prev.date && e.date < cur.date)
      .reduce((s, e) => s + (Number(e.qty) || 0), 0);
    // On borne à 0 : un net négatif (stock qui monte sans réception
    // enregistrée) indique probablement une réception oubliée, on
    // l'ignore pour ne pas biaiser la moyenne.
    const consumed = Math.max(0, (Number(prev.qty) || 0) + received - (Number(cur.qty) || 0));
    totalConsumed += consumed;
    totalDays += days;
  }
  if (totalDays === 0) return null;
  return totalConsumed / totalDays;
}
// À partir du stock courant et de la conso moyenne, estime le nombre de
// jours ouvrés restants + la date d'épuisement (à compter d'aujourd'hui).
function getArticleDepletion(articleName, currentStock) {
  const daily = getArticleDailyConsumption(articleName);
  if (daily === null || daily <= 0) return { daily, days: null, date: null };
  if (currentStock <= 0) return { daily, days: 0, date: todayISO() };
  const days = Math.round(currentStock / daily);
  return { daily, days, date: addBusinessDaysISO(todayISO(), days) };
}
function fmtRate(n) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function fmtStockQty(n) {
  return (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

// ----- Rendu : liste des entrées (sous-onglet Enregistrement) -----
function renderStockEntries() {
  const list = document.getElementById('stockentrylist');
  const empty = document.getElementById('stockentryempty');
  if (!list || !empty) return;
  list.innerHTML = '';
  empty.classList.remove('show');
  if (state.stockEntries.length === 0) {
    empty.innerHTML = '<p>Aucune entrée enregistrée.</p><p class="hint">Tapez le bouton + en bas à droite pour en ajouter une.</p>';
    empty.classList.add('show');
    return;
  }
  const sorted = state.stockEntries.slice().sort(compareStockEntries).reverse();
  for (const e of sorted) {
    list.appendChild(buildStockEntryRow(e));
  }
}
function buildStockEntryRow(entry) {
  const li = document.createElement('li');
  li.className = 'stock-entry-row type-' + entry.type;
  li.setAttribute('data-entry-id', entry.id);
  const sign = entry.type === 'inventaire' ? '=' : '+';
  li.innerHTML = `
    <span class="stock-entry-date"></span>
    <span class="stock-entry-name"></span>
    <span class="stock-entry-qty"></span>
    <button class="stock-entry-delete" type="button" aria-label="Supprimer cette entrée">
      <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
    </button>
  `;
  li.querySelector('.stock-entry-date').textContent = fmtDateShortFR(entry.date);
  li.querySelector('.stock-entry-name').textContent = entry.article;
  li.querySelector('.stock-entry-qty').textContent = `${sign} ${fmtStockQty(entry.qty)} ${entry.unit}`;
  li.querySelector('.stock-entry-delete').addEventListener('click', () => removeStockEntry(entry.id));
  return li;
}

// ----- Rendu : cards par article (sous-onglet Stock) -----
function renderStockSummary() {
  const list = document.getElementById('stocksummarylist');
  const empty = document.getElementById('stocksummaryempty');
  if (!list || !empty) return;
  list.innerHTML = '';
  empty.classList.remove('show');
  const summary = getStockSummary();
  if (summary.length === 0) {
    empty.innerHTML = '<p>Aucun stock à afficher.</p><p class="hint">Commencez par saisir une entrée dans Enregistrement.</p>';
    empty.classList.add('show');
    return;
  }
  for (const item of summary) {
    list.appendChild(buildStockSummaryCard(item));
  }
}
function buildStockSummaryCard(item) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'stock-summary-card';
  card.setAttribute('aria-label', `Détails de ${item.article}`);
  const lastVerb = item.lastEntry.type === 'inventaire' ? 'Inventaire' : 'Réception';
  const lastSign = item.lastEntry.type === 'inventaire' ? '=' : '+';
  card.innerHTML = `
    <div class="stock-summary-head">
      <span class="stock-summary-name"></span>
      <span class="stock-summary-total"></span>
    </div>
    <div class="stock-summary-sub"></div>
  `;
  card.querySelector('.stock-summary-name').textContent = item.article;
  card.querySelector('.stock-summary-total').textContent = `${fmtStockQty(item.stock)} ${item.unit}`;
  card.querySelector('.stock-summary-sub').textContent =
    `Dernière entrée : ${fmtDateShortFR(item.lastEntry.date)} — ${lastVerb} ${lastSign}${fmtStockQty(item.lastEntry.qty)} ${item.unit}`;
  card.addEventListener('click', () => openStockDetail(item.article));
  return card;
}

function renderStock() {
  renderStockEntries();
  renderStockSummary();
  refreshArticleControl();
}
// Peuple le dropdown des articles à partir de ceux déjà saisis. Si la
// liste est vide, on bascule directement sur le champ texte. Sinon le
// dropdown contient toutes les références + une entrée « + Nouveau
// article… » qui révèle le champ texte au choix.
const NEW_ARTICLE_SENTINEL = '__new__';
function refreshArticleControl() {
  const sel = document.getElementById('stockarticleselect');
  const inp = document.getElementById('stockarticlenew');
  if (!sel || !inp) return;
  const names = getAllArticleNames();
  sel.innerHTML = '';
  if (names.length === 0) {
    // Aucun article connu : on cache le select, on affiche le champ
    // texte (rien à choisir, l'utilisateur tape directement).
    sel.hidden = true;
    inp.hidden = false;
    inp.value = '';
    return;
  }
  sel.hidden = false;
  const placeholder = new Option('Choisir un article…', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  sel.appendChild(placeholder);
  for (const n of names) sel.appendChild(new Option(n, n));
  sel.appendChild(new Option('+ Nouveau article…', NEW_ARTICLE_SENTINEL));
  inp.hidden = true;
  inp.value = '';
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
  }
}
function fmtDateShortFR(iso) {
  // (formatDateShortFR existe déjà ; alias pour éviter de re-déclarer)
  return formatDateShortFR(iso);
}

// ----- CRUD -----
function addStockEntry({ type, article, qty, unit, date, notes }) {
  if (!article || !article.trim()) { showToast('Article requis', 'error'); return false; }
  const q = parseFloat(String(qty).replace(',', '.'));
  if (!Number.isFinite(q) || q < 0) { showToast('Quantité invalide', 'error'); return false; }
  if (!date) { showToast('Date requise', 'error'); return false; }
  state.stockEntries.push({
    id: uid(),
    type: type === 'inventaire' ? 'inventaire' : 'reception',
    article: article.trim(),
    qty: q,
    unit: unit || 'u',
    date,
    notes: (notes || '').trim()
  });
  save();
  renderStock();
  return true;
}
function removeStockEntry(id) {
  const entry = state.stockEntries.find(e => e.id === id);
  if (!entry) return;
  const label = `${entry.article} (${entry.type === 'inventaire' ? 'inventaire' : 'réception'} ${fmtStockQty(entry.qty)} ${entry.unit} du ${fmtDateShortFR(entry.date)})`;
  if (!confirm(`Supprimer l'entrée ${label} ?`)) return;
  state.stockEntries = state.stockEntries.filter(e => e.id !== id);
  save();
  // Si la modale détail est ouverte sur cet article, on la rafraîchit
  if (stockDetailArticle && stockDetailArticle.toLowerCase() === entry.article.toLowerCase()) {
    renderStockDetailBody();
  }
  renderStock();
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
  currentStockEntryType = type === 'inventaire' ? 'inventaire' : 'reception';
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
      : 'Remplace le stock courant par la quantité comptée (recalage).';
  }
}
function submitStockEntry() {
  const article = getStockArticleFromForm();
  const qty     = document.getElementById('stockqty').value;
  const unit    = document.getElementById('stockunit').value;
  const date    = document.getElementById('stockdate').value;
  const notes   = document.getElementById('stocknotes').value;
  const ok = addStockEntry({ type: currentStockEntryType, article, qty, unit, date, notes });
  if (ok) {
    showToast(currentStockEntryType === 'inventaire' ? 'Inventaire enregistré' : 'Réception enregistrée');
    closeStockEntrySheet();
  }
}

// ----- Modale détail d'un article -----
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
  const summary = getStockSummary().find(s =>
    s.article.toLowerCase() === stockDetailArticle.toLowerCase()
  );
  // Bandeau résumé
  const head = document.createElement('div');
  head.className = 'stock-detail-head';
  if (summary) {
    head.innerHTML = `
      <div class="stock-detail-label">Stock courant</div>
      <div class="stock-detail-value">${fmtStockQty(summary.stock)} ${escapeHtml(summary.unit)}</div>
    `;
  } else {
    head.innerHTML = `<div class="stock-detail-label">Aucun stock enregistré pour cet article.</div>`;
  }
  body.appendChild(head);

  // Encarts : conso moyenne / jours restants estimés.
  if (summary) {
    const stats = document.createElement('div');
    stats.className = 'stock-detail-stats';
    const { daily, days, date } = getArticleDepletion(summary.article, summary.stock);

    // Conso moyenne
    const consoCard = document.createElement('div');
    consoCard.className = 'stock-detail-stat';
    if (daily !== null && daily > 0) {
      consoCard.innerHTML = `
        <div class="stock-detail-stat-label">Conso moyenne</div>
        <div class="stock-detail-stat-value"></div>
        <div class="stock-detail-stat-sub">par jour ouvré</div>
      `;
      consoCard.querySelector('.stock-detail-stat-value').textContent = `${fmtRate(daily)} ${summary.unit}`;
    } else {
      consoCard.innerHTML = `
        <div class="stock-detail-stat-label">Conso moyenne</div>
        <div class="stock-detail-stat-value stock-detail-stat-empty">—</div>
        <div class="stock-detail-stat-sub"></div>
      `;
      consoCard.querySelector('.stock-detail-stat-sub').textContent =
        daily === null ? '2 inventaires min.' : 'Aucune conso observée';
    }
    stats.appendChild(consoCard);

    // Épuisement estimé
    const depletionCard = document.createElement('div');
    depletionCard.className = 'stock-detail-stat';
    if (days !== null && date) {
      const valueText = days === 0 ? 'épuisé' : (days === 1 ? 'dans 1 j ouvré' : `dans ${days} j ouvrés`);
      depletionCard.innerHTML = `
        <div class="stock-detail-stat-label">Épuisement estimé</div>
        <div class="stock-detail-stat-value"></div>
        <div class="stock-detail-stat-sub"></div>
      `;
      depletionCard.querySelector('.stock-detail-stat-value').textContent = valueText;
      depletionCard.querySelector('.stock-detail-stat-sub').textContent =
        days === 0 ? '' : `(${formatDateShortFR(date)})`;
    } else {
      depletionCard.innerHTML = `
        <div class="stock-detail-stat-label">Épuisement estimé</div>
        <div class="stock-detail-stat-value stock-detail-stat-empty">—</div>
        <div class="stock-detail-stat-sub">Conso indispo.</div>
      `;
    }
    stats.appendChild(depletionCard);

    body.appendChild(stats);
  }

  const history = getArticleHistory(stockDetailArticle);
  if (history.length === 0) return;

  const title = document.createElement('div');
  title.className = 'stock-detail-section-title';
  title.textContent = 'Historique';
  body.appendChild(title);

  const ul = document.createElement('ul');
  ul.className = 'stock-history';
  for (const e of history) {
    const li = document.createElement('li');
    li.className = 'stock-history-item type-' + e.type;
    const sign = e.type === 'inventaire' ? '=' : '+';
    const verb = e.type === 'inventaire' ? 'Inventaire' : 'Réception';
    li.innerHTML = `
      <div class="stock-history-line">
        <span class="stock-history-date"></span>
        <span class="stock-history-type"></span>
        <span class="stock-history-qty"></span>
        <button class="stock-history-delete" type="button" aria-label="Supprimer cette entrée">
          <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
        </button>
      </div>
      <div class="stock-history-notes"></div>
    `;
    li.querySelector('.stock-history-date').textContent = fmtDateShortFR(e.date);
    li.querySelector('.stock-history-type').textContent = verb;
    li.querySelector('.stock-history-qty').textContent = `${sign}${fmtStockQty(e.qty)} ${e.unit}`;
    const notesEl = li.querySelector('.stock-history-notes');
    if (e.notes) notesEl.textContent = e.notes; else notesEl.remove();
    li.querySelector('.stock-history-delete').addEventListener('click', () => removeStockEntry(e.id));
    ul.appendChild(li);
  }
  body.appendChild(ul);
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
function addEOTP() {
  if (!Array.isArray(state.eotps)) state.eotps = [];
  state.eotps.push({ id: 'eotp_' + uid(), code: '', label: '', budget: 0 });
  save();
  renderEOTPsConfig();
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
// Affichage : code « OTP-2026-001 » ou « OTP-2026-001 — Plomberie » si label
function eotpDisplay(eotp) {
  if (!eotp) return '';
  return eotp.label ? `${eotp.code} — ${eotp.label}` : eotp.code;
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
      state.consommableEntries = data.consommableEntries || [];
      state.consoProducts = data.consoProducts || [];
      state.eotps = data.eotps || [];
      state.eotpRegistryInitialized = data.eotpRegistryInitialized === true;
      state.consoRecapMode = (data.consoRecapMode === 'eotp') ? 'eotp' : 'product';
      state.projectStart = typeof data.projectStart === 'string' ? data.projectStart : '';
      state.projectEnd   = typeof data.projectEnd   === 'string' ? data.projectEnd   : '';
      state.workBatches  = Array.isArray(data.workBatches) ? data.workBatches : [];
      state.protoFolders = Array.isArray(data.protoFolders) ? data.protoFolders : [];
      state.protoPlans   = Array.isArray(data.protoPlans) ? data.protoPlans : [];
      state.protoActivePlanId   = typeof data.protoActivePlanId === 'string' ? data.protoActivePlanId : '';
      state.protoFilterLotId    = typeof data.protoFilterLotId  === 'string' ? data.protoFilterLotId  : '';
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
  state.consommableEntries = [];
  state.consoProducts = [];
  state.eotps = [];
  state.eotpRegistryInitialized = false;
  state.consoRecapMode = 'product';
  state.projectStart = '';
  state.projectEnd = '';
  state.workBatches = [];
  state.protoFolders = [];
  state.protoPlans = [];
  state.protoActivePlanId = '';
  state.protoFilterLotId = '';
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
    <button class="eotp-remove lot-remove" type="button" aria-label="Supprimer ce lot">
      <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
    </button>
  `;
  const color = li.querySelector('.lot-color');
  const name  = li.querySelector('.lot-name');
  color.value = lot.color || '#0a84ff';
  name.value  = lot.name  || '';
  color.addEventListener('input', () => setWorkBatchColor(lot.id, color.value));
  name.addEventListener('input',  () => setWorkBatchName(lot.id, name.value));
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
  if (Array.isArray(state.protoFilterStatuses) && !state.protoFilterStatuses.includes(sh.status || 'todo')) return false;
  return true;
}
function setProtoFilterLot(id) {
  state.protoFilterLotId = id || '';
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
  // Image + SVG calés sur la même viewBox = dimensions naturelles px
  const img = document.getElementById('protoimage');
  img.src = plan.dataUrl;
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
  if (s.type === 'point')   return { count: 1 };
  return {};
}
function dominantTaskType(shapes) {
  // Type dominant = celui qui apparaît le plus, surface en cas d'égalité
  const c = { surface: 0, length: 0, count: 0 };
  for (const s of shapes) {
    if (s.type === 'rect' || s.type === 'polygon') c.surface++;
    else if (s.type === 'line') c.length++;
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
    const plan = {
      id: 'pln_' + uid(), folderId: folder.id, name,
      dataUrl, w: canvas.width, h: canvas.height
    };
    state.protoPlans.push(plan);
    state.protoActivePlanId = plan.id;
    save();
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
  const img = await loadImagePromise(plan.dataUrl);
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
  // (zoom, hint polygone) — ils ont leur propre handler de click.
  if (evt.target && evt.target.closest &&
      (evt.target.closest('.proto-zoom-bar') || evt.target.closest('.proto-poly-hint'))) {
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
  renderProtoSVG();
  renderProtoLegend();
  closeProtoShapeSheet();
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
  'protoActivePlanId',               // plan en cours d'édition
  'protoFilterLotId', 'protoFilterStatuses', // filtres Proto
  'echeckinCollapsed',               // sections eCheckIn pliées/dépliées
  'syncStatus', 'syncTimestamp', 'syncLastPulled',
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
    withTimeout(doSyncPush(), 'push debounced').catch(err => console.warn('[Sync] push debounced KO', err));
  }, SYNC_DEBOUNCE_MS);
}

function getSyncablePayload() {
  const out = {};
  for (const k in state) {
    if (SYNC_EXCLUDED_KEYS.has(k)) continue;
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

async function doSyncPush() {
  const supa = await loadSupabase();
  if (!supa) return;
  setSyncStatus('syncing');
  try {
    const payload = getSyncablePayload();
    const updatedAt = new Date(state.syncTimestamp || Date.now()).toISOString();
    // Upsert : crée la ligne au premier push, puis met à jour à chaque sauvegarde.
    const { error } = await supa.from('site_data').upsert({
      site_id: SHARED_SITE_ID,
      state: payload,
      updated_at: updatedAt
    }, { onConflict: 'site_id' });
    if (error) throw error;
    _hasPendingPush = false;
    setSyncStatus('idle');
  } catch (err) {
    console.error('Sync push KO', err);
    setSyncStatus('error');
  }
}

async function doSyncPull(initial = false) {
  const supa = await loadSupabase();
  if (!supa) return;
  setSyncStatus('syncing');
  try {
    const { data, error } = await supa
      .from('site_data')
      .select('state, updated_at')
      .eq('site_id', SHARED_SITE_ID)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const remoteTs = data.updated_at ? new Date(data.updated_at).getTime() : 0;
      const localTs = state.syncTimestamp || 0;
      const remoteHasData = data.state && Object.keys(data.state || {}).length > 0;
      // Skip si le push vient de cet appareil-ci (le state distant
      // contient un marqueur _sourceDeviceId qu'on a mis nous-même)
      const sameDevice = data.state && data.state._sourceDeviceId === DEVICE_ID;
      if (!remoteHasData && initial) {
        // Serveur vide à la 1re connexion → on push notre état local
        await doSyncPush();
      } else if (remoteHasData && !sameDevice && (initial ? remoteTs >= localTs : remoteTs > localTs)) {
        // Appliquer l'état distant (flag pour ne pas re-déclencher push)
        _syncApplying = true;
        try {
          for (const k in data.state) {
            if (SYNC_EXCLUDED_KEYS.has(k)) continue;
            if (k === '_sourceDeviceId') continue;
            state[k] = data.state[k];
          }
          state.syncTimestamp = remoteTs;
          save();
          renderAll();
        } finally { _syncApplying = false; }
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
    try { await withTimeout(doSyncPush(), 'force push'); } catch (e) { console.warn(e); }
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
  load();
  migratePresences();
  migrateSetups();
  document.getElementById('appversion').textContent = `Version ${APP_VERSION}`;
  renderAll();

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

  // Tâches
  document.getElementById('taskfab').addEventListener('click', addTask);

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
  const stockSheet = document.getElementById('stockentrysheet');
  if (stockSheet) {
    document.getElementById('stockentrysheetclose').addEventListener('click', closeStockEntrySheet);
    stockSheet.addEventListener('click', (e) => { if (e.target === stockSheet) closeStockEntrySheet(); });
    document.getElementById('stockentrysave').addEventListener('click', submitStockEntry);
    // Boutons Réception / Inventaire dans le segmented
    stockSheet.querySelectorAll('[data-stock-entry-type]').forEach(b => {
      b.addEventListener('click', () => setStockEntryType(b.dataset.stockEntryType));
    });
    // Dropdown article : bascule sur le champ texte si « Nouveau »
    const articleSel = document.getElementById('stockarticleselect');
    if (articleSel) articleSel.addEventListener('change', onArticleSelectChange);
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

  // ----- Données → eOTP : bouton + Ajouter une ligne de budget -----
  const eotpAddBtn = document.getElementById('eotpadd');
  if (eotpAddBtn) eotpAddBtn.addEventListener('click', addEOTP);

  // ----- Données → Admin. : période du chantier -----
  const projStart = document.getElementById('projectstart');
  const projEnd   = document.getElementById('projectend');
  if (projStart) projStart.addEventListener('change', () => setProjectStart(projStart.value));
  if (projEnd)   projEnd.addEventListener('change',   () => setProjectEnd(projEnd.value));

  // ----- Consommable → Récap : bascule produit / eOTP -----
  document.querySelectorAll('.recap-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setConsoRecapMode(btn.dataset.recapMode));
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

  // ----- Sync : chip dans le header (clic = force full sync) -----
  const syncChip = document.getElementById('syncchip');
  if (syncChip) syncChip.addEventListener('click', async () => {
    try {
      syncChip.disabled = true;
      await forceFullSync();
    } catch (e) {
      showToast('Sync KO : ' + (e.message || 'erreur'), 'error');
    } finally { syncChip.disabled = false; }
  });
  if (isSupabaseConfigured()) {
    if (syncChip) syncChip.hidden = false;
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
}

document.addEventListener('DOMContentLoaded', init);
