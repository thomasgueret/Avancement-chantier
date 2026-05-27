/* =========================================================
   Suivi de chantier — application PWA
   Stockage local (localStorage) pour cette première version.
   La synchro multi-utilisateurs sera ajoutée ultérieurement.
   ========================================================= */

const STORAGE_KEY = 'chantier_v1';

// ---------- State ----------
const state = {
  companies: [],          // [{ id, name }]
  presences: {},          // { 'YYYY-MM-DD': [{ id, companyId, count }] }
  currentDate: todayISO()
};

// ---------- Persistence ----------
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.companies) state.companies = data.companies;
    if (data.presences) state.presences = data.presences;
  } catch (e) {
    console.warn('Lecture stockage impossible', e);
  }
}
function save() {
  const data = { companies: state.companies, presences: state.presences };
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
function getCompany(id) {
  return state.companies.find(c => c.id === id);
}

// ---------- Rendering ----------
function renderAll() {
  renderDate();
  renderEntries();
  renderCompanies();
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
  const entries = state.presences[state.currentDate] || [];

  list.innerHTML = '';
  let total = 0;

  if (entries.length === 0) {
    empty.classList.add('show');
  } else {
    empty.classList.remove('show');
    for (const entry of entries) {
      const company = getCompany(entry.companyId);
      const name = company ? company.name : '(entreprise supprimée)';
      total += entry.count;

      const li = document.createElement('li');
      li.className = 'entry-item';
      li.innerHTML = `
        <div class="entry-company"></div>
        <div class="entry-count"><span class="num"></span><small>pers.</small></div>
        <div class="entry-actions">
          <button class="icon-btn" data-action="edit" aria-label="Modifier">
            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm17.71-10.04a1 1 0 0 0 0-1.41l-2.51-2.51a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>
          </button>
          <button class="icon-btn danger" data-action="delete" aria-label="Supprimer">
            <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>
          </button>
        </div>
      `;
      li.querySelector('.entry-company').textContent = name;
      li.querySelector('.num').textContent = entry.count;
      li.querySelector('[data-action="edit"]').addEventListener('click', () => openEntryModal(entry));
      li.querySelector('[data-action="delete"]').addEventListener('click', () => deleteEntry(entry.id));
      list.appendChild(li);
    }
  }

  document.getElementById('totalcount').textContent = total;
  document.getElementById('totalsub').textContent = total > 1 ? 'personnes' : 'personne';
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
  renderCompanies();
  showToast('Entreprise ajoutée');
}

function deleteCompany(id) {
  const company = getCompany(id);
  if (!company) return;
  if (!confirm(`Supprimer l'entreprise « ${company.name} » ?\nLes présences déjà enregistrées seront conservées mais affichées comme « entreprise supprimée ».`)) return;
  state.companies = state.companies.filter(c => c.id !== id);
  save();
  renderCompanies();
  renderEntries();
  showToast('Entreprise supprimée');
}

// ---------- Entries (presences) ----------
function openEntryModal(entry = null) {
  if (state.companies.length === 0) {
    showToast('Ajoutez d\'abord une entreprise dans l\'onglet Données', 'error');
    return;
  }
  const modal = document.getElementById('entrymodal');
  const select = document.getElementById('entrycompany');
  const countInput = document.getElementById('entrycount');
  const idInput = document.getElementById('entryid');
  const title = document.getElementById('entrymodaltitle');

  select.innerHTML = state.companies
    .map(c => `<option value="${c.id}"></option>`)
    .join('');
  Array.from(select.options).forEach((opt, i) => {
    opt.textContent = state.companies[i].name;
  });

  if (entry) {
    title.textContent = 'Modifier la présence';
    select.value = entry.companyId;
    countInput.value = entry.count;
    idInput.value = entry.id;
  } else {
    title.textContent = 'Ajouter une présence';
    select.value = state.companies[0].id;
    countInput.value = '';
    idInput.value = '';
  }

  modal.hidden = false;
  setTimeout(() => countInput.focus(), 50);
}

function closeEntryModal() {
  document.getElementById('entrymodal').hidden = true;
}

function saveEntryFromForm(e) {
  e.preventDefault();
  const companyId = document.getElementById('entrycompany').value;
  const count = parseInt(document.getElementById('entrycount').value, 10);
  const id = document.getElementById('entryid').value;

  if (!companyId || !Number.isFinite(count) || count < 1) return;

  const date = state.currentDate;
  if (!state.presences[date]) state.presences[date] = [];
  const entries = state.presences[date];

  if (id) {
    const idx = entries.findIndex(en => en.id === id);
    if (idx >= 0) entries[idx] = { id, companyId, count };
  } else {
    entries.push({ id: uid(), companyId, count });
  }

  save();
  closeEntryModal();
  renderEntries();
  showToast('Présence enregistrée');
}

function deleteEntry(id) {
  const date = state.currentDate;
  if (!state.presences[date]) return;
  state.presences[date] = state.presences[date].filter(e => e.id !== id);
  if (state.presences[date].length === 0) delete state.presences[date];
  save();
  renderEntries();
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
}

// ---------- Import / Export ----------
function exportData() {
  const data = { companies: state.companies, presences: state.presences, exportedAt: new Date().toISOString() };
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
      state.presences = data.presences;
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
  if (!confirm('Effacer TOUTES les données (entreprises et présences) ?\nCette action est irréversible.')) return;
  state.companies = [];
  state.presences = {};
  save();
  renderAll();
  showToast('Données effacées');
}

// ---------- Init ----------
function init() {
  load();
  renderAll();

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
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

  // Add entry
  document.getElementById('addentry').addEventListener('click', () => openEntryModal());
  document.getElementById('entrycancel').addEventListener('click', closeEntryModal);
  document.getElementById('entryform').addEventListener('submit', saveEntryFromForm);
  document.getElementById('entrymodal').addEventListener('click', (e) => {
    if (e.target.id === 'entrymodal') closeEntryModal();
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
