/* =========================================================
   Suivi de chantier — application PWA
   Stockage local (localStorage) pour cette première version.
   La synchro multi-utilisateurs sera ajoutée ultérieurement.
   ========================================================= */

const STORAGE_KEY = 'chantier_v1';
// Version affichée. Convention : '0.N' correspond au cache 'chantier-vN'
// dans sw.js — toujours bumper les deux ensemble.
const APP_VERSION = '0.45';

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
    if (data.chartHidden) state.chartHidden = data.chartHidden;
    if (data.chartRange) state.chartRange = data.chartRange;
    // Champs hérités (ancien modèle à liste unique) → migrés ensuite
    if (data.tasks) state._legacyTasks = data.tasks;
    if (data.zoneHasTasks) state._legacyZoneHasTasks = data.zoneHasTasks;
    // Champs hérités (Phase A : un ouvrage et une quantité par zone) → migrés
    if (data.zoneSetup) state._legacyZoneSetup = data.zoneSetup;
    if (data.zoneQty) state._legacyZoneQty = data.zoneQty;
  } catch (e) {
    console.warn('Lecture stockage impossible', e);
  }
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
    chartHidden: state.chartHidden,
    chartRange: state.chartRange
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
// Premier ouvrage (compat. pour le code qui n'a pas encore conscience du multi)
function getZoneSetup(zoneId) {
  const list = getZoneOuvrages(zoneId);
  return list.length > 0 ? list[0].setup : null;
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
  renderStock();
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
// Wrapper historique (utilisé dans certains anciens tests)
function buildExpiryReportText() { return buildExpiryReport().text; }

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
function daysUntil(dateStr, today = new Date()) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d - t) / 86400000);
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
  refreshArticleDatalist();
}
function refreshArticleDatalist() {
  const dl = document.getElementById('stockarticlelist');
  if (!dl) return;
  dl.innerHTML = '';
  for (const name of getAllArticleNames()) {
    const opt = document.createElement('option');
    opt.value = name;
    dl.appendChild(opt);
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
  // Reset des champs
  document.getElementById('stockarticle').value = '';
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
  refreshArticleDatalist();
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  // Focus sur le premier champ utile
  setTimeout(() => document.getElementById('stockarticle')?.focus(), 50);
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
  const article = document.getElementById('stockarticle').value;
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
  }
  const stockDetailModalEl = document.getElementById('stockdetailmodal');
  if (stockDetailModalEl) {
    document.getElementById('stockdetailclose').addEventListener('click', closeStockDetail);
    stockDetailModalEl.addEventListener('click', (e) => { if (e.target === stockDetailModalEl) closeStockDetail(); });
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
