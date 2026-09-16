// Banc dédié à l'axe « reprise des envois ».
//
// Différence essentielle avec tests/harness/repro-sync.js : le faux Supabase
// est installé AVANT le démarrage de l'application, en interceptant l'import
// du SDK (cdn.jsdelivr.net). Le harnais partagé, lui, l'installe 700 ms après
// `goto`, c'est-à-dire APRÈS `reprendreEnvoiEnAttente()` et le pull initial —
// ce qui rend intestables les scénarios de redémarrage de cet axe.
//
// Le serveur factice sait aussi tomber en panne d'ÉCRITURE SEULEMENT
// (portail captif / 5xx : le réseau répond, `navigator.onLine` ne bascule pas)
// et journalise chaque appel dans l'ordre d'invocation, avec sa date relative.
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = 'http://127.0.0.1:8765/index.html';
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

const MODULE_FAUX_SDK = `
export function createClient() {
  const faire = () => {
    let cols = '';
    const req = {
      select(c) { cols = c; return req; },
      eq() { return req; },
      async maybeSingle() {
        try { return { data: await window.__srvGet(cols), error: null }; }
        catch (e) { return { data: null, error: e }; }
      },
      async upsert(row) {
        try { await window.__srvUpsert(row); return { error: null }; }
        catch (e) { return { error: e }; }
      },
    };
    return req;
  };
  return {
    from: faire,
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
  };
}
export default { createClient };
`;

function nouveauServeur() {
  return {
    ligne: null,
    journal: [],            // ordre d'invocation : { op, cols, qui, t, ok }
    lectures: 0, ecritures: 0,
    tentativesGet: 0, tentativesUpsert: 0,
    enPanne: false,          // coupure totale
    enPanneLecture: false,   // lectures KO seules
    enPanneEcriture: false,  // écritures KO seules (réseau qui répond mais échoue)
    latenceMs: 0,            // latence des lectures
    latenceEcritureMs: 0,    // latence des écritures
    t0: Date.now(),
    // instants (ms depuis t0) des tentatives d'écriture, réussies ou non
    tentativesEcritureT: [],
  };
}

async function brancher(page, srv, nom) {
  await page.route(SDK, route => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    body: MODULE_FAUX_SDK,
  }));
  await page.exposeFunction('__srvGet', async (cols) => {
    const e = { op: 'get', cols: cols || '', qui: nom, t: Date.now() - srv.t0 };
    srv.journal.push(e); srv.tentativesGet++;
    if (srv.latenceMs) await dormir(srv.latenceMs);
    if (srv.enPanne || srv.enPanneLecture) { e.ok = false; throw new Error('reseau coupe (lecture)'); }
    e.ok = true; srv.lectures++;
    if (!srv.ligne) return null;
    if (cols === 'updated_at') return { updated_at: srv.ligne.updated_at };
    return { state: srv.ligne.state, updated_at: srv.ligne.updated_at };
  });
  await page.exposeFunction('__srvUpsert', async (row) => {
    const e = { op: 'upsert', qui: nom, t: Date.now() - srv.t0, updated_at: row.updated_at };
    srv.journal.push(e); srv.tentativesUpsert++;
    srv.tentativesEcritureT.push(e.t);
    if (srv.latenceEcritureMs) await dormir(srv.latenceEcritureMs);
    else if (srv.latenceMs) await dormir(srv.latenceMs);
    if (srv.enPanne || srv.enPanneEcriture) { e.ok = false; throw new Error('reseau coupe (ecriture)'); }
    e.ok = true; srv.ecritures++;
    srv.ligne = { state: row.state, updated_at: row.updated_at };
    return true;
  });
}

// opts : { seed, deviceId, viewport, decalageMs }
async function ouvrirAppareil(nav, srv, nom, opts = {}) {
  // Service worker BLOQUÉ : sans cela il prend le contrôle, déclenche le
  // `controllerchange` → `location.reload()` de l'application (l'appareil
  // redémarre tout seul au milieu du test) et surtout il intercepte lui-même
  // l'import du SDK, hors de portée de page.route. Le SW n'a aucun rôle dans
  // l'axe testé ici.
  const ctx = await nav.newContext({
    viewport: opts.viewport || { width: 1400, height: 900 },
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if (opts.trace) console.log('   [' + nom + '/' + m.type() + '] ' + t.slice(0, 220));
    if (m.type() === 'error' && !/Supabase|net::ERR|Failed to load|Sync p(ush|ull) KO/.test(t)) errs.push('CONSOLE: ' + t);
  });
  await brancher(page, srv, nom);
  if (opts.decalageMs) {
    await page.addInitScript((ms) => {
      const vrai = Date.now;
      Date.now = () => vrai() + ms;
      const V = Date;
      window.Date = new Proxy(V, { construct(t, a) { return a.length ? new t(...a) : new t(vrai() + ms); } });
      window.Date.now = Date.now;
    }, opts.decalageMs);
  }
  if (opts.seed) {
    // PIÈGE : un addInitScript se rejoue à CHAQUE navigation. Écrire la graine
    // sans condition remettrait le stockage à l'état initial à chaque
    // `redemarrer()` — et effacerait précisément la saisie dont on veut
    // vérifier la survie. On ne sème donc que sur un stockage vide.
    await page.addInitScript(([s, id]) => {
      if (!localStorage.getItem('chantier_v1')) localStorage.setItem('chantier_v1', JSON.stringify(s));
      if (id) localStorage.setItem('chantier_device_id', id);
    }, [opts.seed, opts.deviceId || '']);
  } else if (opts.deviceId) {
    await page.addInitScript((id) => localStorage.setItem('chantier_device_id', id), opts.deviceId);
  }
  await page.goto(URL);
  await page.waitForTimeout(900);
  return { ctx, page, nom, errs };
}

// Redémarrage : recharge la page en conservant le localStorage. Le faux SDK
// est réinstallé tout seul (la route et exposeFunction survivent au goto).
async function redemarrer(app, attente = 900) {
  await app.page.goto(URL);
  await app.page.waitForTimeout(attente);
  return app;
}

const lireTout = (page) => page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress || {})));
const lireStamps = (page) => page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgressAt || {})));
const saisir = (page, z, t, p) => page.evaluate(([a, b, c]) => { setProgress(a, b, c); }, [z, t, p]);

// Vue interne : mémoire ET stockage, pour distinguer les deux marques.
const sonde = (page) => page.evaluate(() => {
  let brut = {};
  try { brut = JSON.parse(localStorage.getItem('chantier_v1') || '{}'); } catch (_) {}
  const chip = document.getElementById('syncchip');
  return {
    memPending: state.syncPendingSince,
    stoPending: brut.syncPendingSince,
    hasPendingPush: _hasPendingPush,
    statut: state.syncStatus,
    retryDelai: (typeof syncRetryDelai !== 'undefined') ? syncRetryDelai : null,
    retryArme: (typeof syncRetryTimer !== 'undefined') ? syncRetryTimer !== null : null,
    pushArme: (typeof syncPushTimer !== 'undefined') ? syncPushTimer !== null : null,
    chip: chip ? chip.textContent : null,
    chipClasse: chip ? chip.className : null,
    vu: state.syncLastSeenRemoteTs,
    ts: state.syncTimestamp,
  };
});

// Ce que le serveur porte réellement pour une cellule.
const serveurCellule = (srv, z, t) => {
  if (!srv.ligne) return undefined;
  const tp = (srv.ligne.state || {}).taskProgress || {};
  return (tp[z] || {})[t];
};
const serveurProgress = (srv) => (srv.ligne ? ((srv.ligne.state || {}).taskProgress || {}) : {});

// Passe la page en arrière-plan / au premier plan, pour de vrai du point de
// vue de l'application (document.visibilityState est en lecture seule).
const visibilite = (page, etat) => page.evaluate((v) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}, etat);

function bilan() {
  const b = { ok: 0, ko: 0, echecs: [] };
  b.chk = (label, cond, detail) => {
    if (cond) b.ok++; else { b.ko++; b.echecs.push(label); }
    console.log((cond ? '  OK  ' : '  KO  ') + label + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''));
    return cond;
  };
  b.fin = (errs = []) => {
    console.log('\n=== BILAN ===');
    console.log(b.ok + ' OK, ' + b.ko + ' en echec');
    if (b.echecs.length) console.log('echecs :', b.echecs);
    console.log('erreurs JS :', errs.length ? errs.slice(0, 6) : 'aucune');
    return b.ko || errs.length ? 1 : 0;
  };
  return b;
}

module.exports = {
  CHROME, URL, SDK, dormir, nouveauServeur, ouvrirAppareil, redemarrer,
  lireTout, lireStamps, saisir, sonde, serveurCellule, serveurProgress,
  visibilite, bilan,
};
