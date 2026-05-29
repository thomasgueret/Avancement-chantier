/* =========================================================
   Suivi de chantier — application PWA
   Stockage local (localStorage) pour cette première version.
   La synchro multi-utilisateurs sera ajoutée ultérieurement.
   ========================================================= */

const STORAGE_KEY = 'chantier_v1';
const APP_VERSION = '0.10.0';

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
  taskSetups: [],         // [{ id, name, tasks: [{ id, name }] }] — configurations de tâches
  currentSetupId: null,   // configuration en cours d'édition (onglet Données → Tâches)
  zoneSetup: {},          // { [zoneId]: setupId } — configuration affectée à chaque zone
  zoneCollapsed: {},      // { [zoneId]: true } — zones repliées dans l'arborescence
  taskProgress: {},       // { [zoneId]: { [taskId]: percent 0..100 } }
  zoneUpdated: {},        // { [zoneId]: timestamp (ms) — dernière modif d'avancement }
  avancementZoneId: null, // zone affichée dans l'onglet Avancement
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
    if (data.zoneSetup) state.zoneSetup = data.zoneSetup;
    if (data.zoneCollapsed) state.zoneCollapsed = data.zoneCollapsed;
    if (data.taskProgress) state.taskProgress = data.taskProgress;
    if (data.zoneUpdated) state.zoneUpdated = data.zoneUpdated;
    if (data.avancementZoneId) state.avancementZoneId = data.avancementZoneId;
    if (data.presences) state.presences = data.presences;
    if (data.chartHidden) state.chartHidden = data.chartHidden;
    if (data.chartRange) state.chartRange = data.chartRange;
    // Champs hérités (ancien modèle à liste unique) → migrés ensuite
    if (data.tasks) state._legacyTasks = data.tasks;
    if (data.zoneHasTasks) state._legacyZoneHasTasks = data.zoneHasTasks;
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
    zoneSetup: state.zoneSetup,
    zoneCollapsed: state.zoneCollapsed,
    taskProgress: state.taskProgress,
    zoneUpdated: state.zoneUpdated,
    avancementZoneId: state.avancementZoneId,
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
function getZoneSetup(zoneId) {
  const setupId = state.zoneSetup[zoneId];
  return setupId ? getSetup(setupId) : null;
}
function zoneIsTaskBearing(zoneId) {
  return !!getZoneSetup(zoneId);
}

// Migration : ancien modèle (liste unique state.tasks + booléen zoneHasTasks)
// → nouveau modèle (configurations). Garantit toujours au moins une config.
function migrateSetups() {
  if (state.taskSetups.length === 0) {
    const setupId = uid();
    state.taskSetups = [{ id: setupId, name: 'Configuration 1', tasks: state._legacyTasks || [] }];
    state.currentSetupId = setupId;
    if (state._legacyZoneHasTasks) {
      for (const zid of Object.keys(state._legacyZoneHasTasks)) {
        if (state._legacyZoneHasTasks[zid]) state.zoneSetup[zid] = setupId;
      }
    }
  }
  if (!state.currentSetupId || !getSetup(state.currentSetupId)) {
    state.currentSetupId = state.taskSetups[0].id;
  }
  delete state._legacyTasks;
  delete state._legacyZoneHasTasks;
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
      ${collapseHtml}
      <input class="zone-name-input" type="text" maxlength="80" placeholder="Nom de la zone" />
      <span class="zone-task-slot"></span>
      <button class="zone-add-sub" data-action="add-child" aria-label="Ajouter un sous-niveau">+</button>
      <button class="icon-btn danger" data-action="delete" aria-label="Supprimer">
        <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>
      </button>
    `;
    const input = row.querySelector('input');
    input.value = zone.name;
    input.addEventListener('input', () => renameZone(zone.id, input.value));
    if (hasChildren) {
      row.querySelector('[data-action="collapse"]').addEventListener('click', () => toggleCollapse(zone.id));
    }
    row.querySelector('.zone-task-slot').replaceWith(buildZoneTaskPicker(zone));
    row.querySelector('[data-action="add-child"]').addEventListener('click', () => addZone(zone.id));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteZone(zone.id));
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
    delete state.zoneSetup[zid];
    delete state.zoneCollapsed[zid];
    delete state.taskProgress[zid];
    delete state.zoneUpdated[zid];
  }
  if (toRemove.has(state.avancementZoneId)) state.avancementZoneId = null;
  save();
  renderZones();
  renderAvancement();
}

// Picker (select natif iOS) pour affecter une configuration de tâches à une zone
function buildZoneTaskPicker(zone) {
  const assignedId = state.zoneSetup[zone.id] || '';
  const picker = document.createElement('span');
  picker.className = 'zone-task-picker' + (assignedId ? ' active' : '');
  picker.innerHTML = '<svg class="zone-task-icon" viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm-2 14-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8Z"/></svg>';

  const select = document.createElement('select');
  select.className = 'zone-task-select';
  select.setAttribute('aria-label', 'Configuration de tâches de la zone');
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'Aucune';
  select.appendChild(noneOpt);
  for (const s of state.taskSetups) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name || '(sans nom)';
    if (s.id === assignedId) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    assignZoneSetup(zone.id, select.value);
    picker.classList.toggle('active', !!select.value);
  });
  picker.appendChild(select);
  return picker;
}

function assignZoneSetup(zoneId, setupId) {
  if (setupId) state.zoneSetup[zoneId] = setupId;
  else delete state.zoneSetup[zoneId];
  if (!setupId && state.avancementZoneId === zoneId) state.avancementZoneId = null;
  save();
  renderAvancement();
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
  const setup = { id: uid(), name: `Configuration ${state.taskSetups.length + 1}`, tasks: [] };
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
  for (const zid of Object.keys(state.zoneSetup)) {
    if (state.zoneSetup[zid] === setup.id) delete state.zoneSetup[zid];
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
    return;
  }
  empty.classList.remove('show');

  for (const task of tasks) {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.dataset.id = task.id;
    li.innerHTML = `
      <button class="drag-handle" aria-label="Maintenir et glisser pour réorganiser">
        <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z"/></svg>
      </button>
      <input class="task-name-input" type="text" maxlength="80" placeholder="Nom de la tâche" />
      <button class="icon-btn danger" data-action="delete" aria-label="Supprimer">
        <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>
      </button>
    `;
    const input = li.querySelector('input');
    input.value = task.name;
    input.addEventListener('input', () => renameTask(task.id, input.value));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => deleteTask(task.id));
    attachTaskDrag(li.querySelector('.drag-handle'), li);
    list.appendChild(li);
  }
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

// Moyenne des avancements des tâches de la configuration affectée à la zone (0..100)
function getZoneProgress(zoneId) {
  const setup = getZoneSetup(zoneId);
  if (!setup || setup.tasks.length === 0) return 0;
  let sum = 0;
  for (const task of setup.tasks) sum += getProgress(zoneId, task.id);
  return Math.round(sum / setup.tasks.length);
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
  pctSpan.textContent = `(${pct} %)`;
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

  const setup = getZoneSetup(zoneId);
  const tasks = setup ? setup.tasks : [];
  if (tasks.length === 0) {
    const li = document.createElement('li');
    li.className = 'progress-empty';
    li.textContent = 'Cette configuration ne contient aucune tâche.';
    list.appendChild(li);
    return;
  }

  for (const task of tasks) {
    const percent = getProgress(zoneId, task.id);
    const isDone = percent >= 100;
    const li = document.createElement('li');
    li.className = 'progress-item' + (isDone ? ' is-done' : '');
    li.innerHTML = `
      <span class="progress-task-name"></span>
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
    });
    list.appendChild(li);
  }
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
}

// ---------- Import / Export ----------
function exportData() {
  const data = {
    companies: state.companies,
    zones: state.zones,
    taskSetups: state.taskSetups,
    zoneSetup: state.zoneSetup,
    zoneCollapsed: state.zoneCollapsed,
    taskProgress: state.taskProgress,
    zoneUpdated: state.zoneUpdated,
    presences: state.presences,
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
      state.zoneSetup = data.zoneSetup || {};
      state.zoneCollapsed = data.zoneCollapsed || {};
      state.taskProgress = data.taskProgress || {};
      state.zoneUpdated = data.zoneUpdated || {};
      state.avancementZoneId = null;
      state.presences = data.presences;
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
  state.zoneSetup = {};
  state.zoneCollapsed = {};
  state.taskProgress = {};
  state.zoneUpdated = {};
  state.avancementZoneId = null;
  state.presences = {};
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

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
