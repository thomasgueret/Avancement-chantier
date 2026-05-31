/* =========================================================
   Suivi de chantier — application PWA
   Stockage local (localStorage) pour cette première version.
   La synchro multi-utilisateurs sera ajoutée ultérieurement.
   ========================================================= */

const STORAGE_KEY = 'chantier_v1';
// Version affichée. Convention : '0.N' correspond au cache 'chantier-vN'
// dans sw.js — toujours bumper les deux ensemble.
const APP_VERSION = '0.24';

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
  workerDocs: {},         // { [workerId]: { onSite, doc1, doc2, doc3, doc4 } } — docN = 'YYYY-MM-DD' | null (péremption)
  echeckinCollapsed: {},  // { [companyId]: true } — entreprises repliées dans eCheckIn
  presences: {},          // { 'YYYY-MM-DD': [{ id, companyId, count }] }
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
    if (data.echeckinCollapsed) state.echeckinCollapsed = data.echeckinCollapsed;
    if (data.presences) state.presences = data.presences;
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
    echeckinCollapsed: state.echeckinCollapsed,
    presences: state.presences,
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
  renderAvancement();
  renderAdministratif();
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

    const li = document.createElement('li');
    li.className = 'entry-item' + (count === 0 ? ' is-zero' : '');
    li.innerHTML = `
      <div class="entry-company"></div>
      <div class="counter">
        <button class="counter-btn" data-action="dec" aria-label="Diminuer">−</button>
        <span class="counter-value"></span>
        <button class="counter-btn" data-action="inc" aria-label="Augmenter">+</button>
      </div>
    `;
    li.querySelector('.entry-company').textContent = company.name;
    li.querySelector('.counter-value').textContent = count;
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
const WORKER_DOC_KEYS = ['doc1', 'doc2', 'doc3', 'doc4'];
function getWorkerDocs(wid) {
  const raw = state.workerDocs[wid] || {};
  // Migration : ancien modèle (booléens) → date string ou null
  const out = { onSite: !!raw.onSite };
  for (const k of WORKER_DOC_KEYS) {
    const v = raw[k];
    out[k] = (typeof v === 'string' && v) ? v : null;
  }
  return out;
}
// Entreprise « complète » : tous ses ouvriers ont les 4 docs avec une
// date renseignée ET aucune n'est périmée. La présence ne compte pas
// (c'est une notion mutable au quotidien).
function isECheckInComplete(cid) {
  const workers = getCompanyWorkers(cid);
  if (workers.length === 0) return false;
  return workers.every(w => {
    const d = getWorkerDocs(w.id);
    return WORKER_DOC_KEYS.every(k => d[k] && expiryStatus(d[k]) !== 'expired');
  });
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
    state.workerDocs[workerId] = { onSite: false, doc1: null, doc2: null, doc3: null, doc4: null };
  }
  return state.workerDocs[workerId];
}
function toggleWorkerPresence(workerId) {
  const bag = ensureWorkerDocsBag(workerId);
  bag.onSite = !bag.onSite;
  save();
  renderECheckIn();
}
function setWorkerDocDate(workerId, field, dateStr) {
  const bag = ensureWorkerDocsBag(workerId);
  bag[field] = dateStr || null;
  save();
  renderECheckIn();
}
function toggleECheckInCollapse(companyId) {
  if (state.echeckinCollapsed[companyId]) delete state.echeckinCollapsed[companyId];
  else state.echeckinCollapsed[companyId] = true;
  save();
  renderECheckIn();
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
    const complete = isECheckInComplete(company.id);
    const collapsed = !!state.echeckinCollapsed[company.id];
    const card = document.createElement('div');
    card.className = 'admin-company' + (complete ? ' is-complete' : '') + (collapsed ? ' is-collapsed' : '');

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
  const docs = getWorkerDocs(worker.id);

  // En-tête : nom de l'ouvrier + chip Présent + bouton supprimer
  const head = document.createElement('div');
  head.className = 'worker-head';
  const nameInput = document.createElement('input');
  nameInput.className = 'worker-name';
  nameInput.type = 'text';
  nameInput.placeholder = "Nom de l'ouvrier";
  nameInput.value = worker.name || '';
  nameInput.addEventListener('input', () => setWorkerName(worker.id, nameInput.value));
  const presenceBtn = document.createElement('button');
  presenceBtn.className = 'worker-chip presence' + (docs.onSite ? ' active' : '');
  presenceBtn.textContent = docs.onSite ? '✓ Présent' : 'Présent';
  presenceBtn.addEventListener('click', () => toggleWorkerPresence(worker.id));
  const delBtn = document.createElement('button');
  delBtn.className = 'worker-delete';
  delBtn.setAttribute('aria-label', "Supprimer l'ouvrier");
  delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>';
  delBtn.addEventListener('click', () => removeWorker(worker.id));
  head.append(nameInput, presenceBtn, delBtn);
  card.appendChild(head);

  // Grille 2×2 de pastilles documents colorées selon la péremption
  const grid = document.createElement('div');
  grid.className = 'ec-doc-grid';
  const labels = { doc1: 'Doc 1', doc2: 'Doc 2', doc3: 'Doc 3', doc4: 'Doc 4' };
  for (const k of WORKER_DOC_KEYS) {
    grid.appendChild(buildECheckInDocChip(worker.id, k, labels[k], docs[k]));
  }
  card.appendChild(grid);

  return card;
}

function buildECheckInDocChip(workerId, field, label, dateStr) {
  const status = expiryStatus(dateStr);
  const chip = document.createElement('div');
  chip.className = `ec-doc status-${status}`;

  const name = document.createElement('span');
  name.className = 'ec-doc-name';
  name.textContent = label;

  const date = document.createElement('span');
  date.className = 'ec-doc-date';
  date.textContent = dateStr ? fmtFR(dateStr) : '—';

  // Input date superposé en plein écran de la chip pour ouvrir le picker iOS
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'ec-doc-input';
  input.value = dateStr || '';
  input.setAttribute('aria-label', `Date de péremption ${label}`);
  input.addEventListener('change', () => setWorkerDocDate(workerId, field, input.value));

  chip.append(name, date, input);

  // Bouton effacer (visible seulement si une date est saisie)
  if (dateStr) {
    const clear = document.createElement('button');
    clear.className = 'ec-doc-clear';
    clear.setAttribute('aria-label', 'Effacer la date');
    clear.textContent = '×';
    clear.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      setWorkerDocDate(workerId, field, null);
    });
    chip.appendChild(clear);
  }

  return chip;
}

function renderAdministratif() {
  renderSecurite();
  renderECheckIn();
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
  // Retire les ouvriers de l'entreprise supprimée + leurs documents
  const removed = state.workers.filter(w => w.companyId === id);
  state.workers = state.workers.filter(w => w.companyId !== id);
  for (const w of removed) delete state.workerDocs[w.id];
  save();
  renderAll();
  showToast('Entreprise supprimée');
}

// ---------- Entries (presences) ----------
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
  if (name === 'avancement') renderAvancement();
  if (name === 'administratif') renderAdministratif();
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
      state.adminDocs = data.adminDocs || {};
      state.workers = data.workers || [];
      state.workerDocs = data.workerDocs || {};
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
  state.adminDocs = {};
  state.workers = [];
  state.workerDocs = {};
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
