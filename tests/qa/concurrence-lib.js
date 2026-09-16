// Banc dédié à l'axe « écrasement concurrent, réentrance, courses ».
//
// Trois choses que le harnais partagé ne donne pas et dont cet axe a besoin :
//
//  1. Le faux Supabase est installé AVANT le démarrage de l'application (on
//     intercepte l'import du SDK), donc `reprendreEnvoiEnAttente()` et le pull
//     initial parlent au faux serveur. Indispensable pour les redémarrages.
//  2. Des PORTES : on peut suspendre un appel serveur précis (lecture d'en-tête
//     d'un appareil donné, écriture d'un autre) et le relâcher à la main. Une
//     course devient alors reproductible au lieu d'être une loterie de latence.
//  3. Deux pages dans LE MÊME contexte → deux onglets de la même application
//     sur le même appareil, donc le même localStorage.
//
// (structure inspirée de qa/reprise-lib.js, réécrite pour rester indépendante)
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
  const srv = {
    ligne: null,
    journal: [],                 // { op, cols, qui, t, updated_at, ok }
    lectures: 0, ecritures: 0,
    enPanne: false, enPanneLecture: false, enPanneEcriture: false,
    latenceMs: 0, latenceEcritureMs: 0,
    portes: [],
    t0: Date.now(),
  };
  // Suspend le PROCHAIN appel `op` de l'appareil `qui`. Renvoie une porte :
  //   await porte.atteinte   -> l'appel est arrivé et attend
  //   porte.ouvrir()         -> on le laisse passer
  srv.bloquer = (qui, op, cols) => {
    let ouvrir, arrive;
    const porte = { qui, op, cols };
    porte.promesse = new Promise(r => { ouvrir = r; });
    porte.atteinte = new Promise(r => { arrive = r; });
    porte.ouvrir = ouvrir; porte._arrive = arrive;
    srv.portes.push(porte);
    return porte;
  };
  srv._porte = async (qui, op, cols) => {
    const i = srv.portes.findIndex(p => p.qui === qui && p.op === op && (!p.cols || p.cols === cols));
    if (i < 0) return;
    const p = srv.portes.splice(i, 1)[0];
    p._arrive();
    await p.promesse;
  };
  return srv;
}

async function brancher(cible, srv, nom) {
  await cible.route(SDK, route => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    body: MODULE_FAUX_SDK,
  }));
  await cible.exposeFunction('__srvGet', async (cols) => {
    const e = { op: 'get', cols: cols || '', qui: nom, t: Date.now() - srv.t0 };
    srv.journal.push(e);
    await srv._porte(nom, 'get', cols || '');
    if (srv.latenceMs) await dormir(srv.latenceMs);
    if (srv.enPanne || srv.enPanneLecture) { e.ok = false; throw new Error('reseau coupe (lecture)'); }
    e.ok = true; srv.lectures++;
    if (!srv.ligne) return null;
    if (cols === 'updated_at') return { updated_at: srv.ligne.updated_at };
    return { state: srv.ligne.state, updated_at: srv.ligne.updated_at };
  });
  await cible.exposeFunction('__srvUpsert', async (row) => {
    const e = { op: 'upsert', qui: nom, t: Date.now() - srv.t0, updated_at: row.updated_at };
    srv.journal.push(e);
    await srv._porte(nom, 'upsert');
    if (srv.latenceEcritureMs) await dormir(srv.latenceEcritureMs);
    else if (srv.latenceMs) await dormir(srv.latenceMs);
    if (srv.enPanne || srv.enPanneEcriture) { e.ok = false; throw new Error('reseau coupe (ecriture)'); }
    e.ok = true; srv.ecritures++;
    srv.ligne = { state: row.state, updated_at: row.updated_at };
    return true;
  });
}

function brancherErreurs(page, nom, errs, trace) {
  page.on('pageerror', e => errs.push('PAGEERROR[' + nom + ']: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if (trace) console.log('   [' + nom + '/' + m.type() + '] ' + t.slice(0, 240));
    // « Sync push/pull KO » est attendu dès qu'on coupe le réseau exprès.
    if (m.type() === 'error' && !/Supabase|net::ERR|Failed to load|Sync p(ush|ull) KO/.test(t)) {
      errs.push('CONSOLE[' + nom + ']: ' + t);
    }
  });
}

// opts : { seed, deviceId, viewport, decalageMs, trace }
async function ouvrirAppareil(nav, srv, nom, opts = {}) {
  const ctx = await nav.newContext({
    viewport: opts.viewport || { width: 1400, height: 900 },
    serviceWorkers: 'block',     // sinon il recharge la page en pleine course
  });
  const errs = [];
  await brancher(ctx, srv, nom);
  if (opts.decalageMs) {
    await ctx.addInitScript((ms) => {
      const vrai = Date.now;
      Date.now = () => vrai() + ms;
      const V = Date;
      window.Date = new Proxy(V, { construct(t, a) { return a.length ? new t(...a) : new t(vrai() + ms); } });
      window.Date.now = Date.now;
    }, opts.decalageMs);
  }
  if (opts.seed) {
    // On ne sème que sur un stockage vide : sinon chaque rechargement
    // effacerait la saisie dont on veut vérifier la survie.
    await ctx.addInitScript(([s, id]) => {
      if (!localStorage.getItem('chantier_v1')) localStorage.setItem('chantier_v1', JSON.stringify(s));
      if (id) localStorage.setItem('chantier_device_id', id);
    }, [opts.seed, opts.deviceId || '']);
  } else if (opts.deviceId) {
    await ctx.addInitScript((id) => localStorage.setItem('chantier_device_id', id), opts.deviceId);
  }
  const page = await ctx.newPage();
  brancherErreurs(page, nom, errs, opts.trace);
  await page.goto(URL);
  await page.waitForTimeout(900);
  return { ctx, page, nom, errs };
}

// SECOND ONGLET du même appareil : même contexte, donc même localStorage.
async function ouvrirOnglet(app, nom, opts = {}) {
  const page = await app.ctx.newPage();
  brancherErreurs(page, nom, app.errs, opts.trace);
  await page.goto(URL);
  await page.waitForTimeout(900);
  return { ctx: app.ctx, page, nom, errs: app.errs };
}

async function redemarrer(app, attente = 900) {
  await app.page.goto(URL);
  await app.page.waitForTimeout(attente);
  return app;
}

// ---- sondes ----
const lireTout = (page) => page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress || {})));
const lireStamps = (page) => page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgressAt || {})));
const saisir = (page, z, t, p, libre) => page.evaluate(([a, b, c, d]) => { setProgress(a, b, c, d); }, [z, t, p, libre]);

const sonde = (page) => page.evaluate(() => {
  let brut = {};
  try { brut = JSON.parse(localStorage.getItem('chantier_v1') || '{}'); } catch (_) {}
  const chip = document.getElementById('syncchip');
  return {
    memPending: state.syncPendingSince,
    stoPending: brut.syncPendingSince,
    hasPendingPush: _hasPendingPush,
    applying: _syncApplying,
    statut: state.syncStatus,
    vu: state.syncLastSeenRemoteTs,
    ts: state.syncTimestamp,
    stampTP: (state.syncKeyStamps || {}).taskProgress,
    chip: chip ? chip.textContent : null,
  };
});

const isoler = (page) => page.evaluate(() => {
  clearInterval(syncPollTimer); clearTimeout(syncPollTimer); syncPollTimer = null;
  clearTimeout(syncPushTimer); syncPushTimer = null;
  clearTimeout(syncRetryTimer); syncRetryTimer = null;
  window.schedulePush = () => {};
  window.__isole = true;
});

const pousser = (page) => page.evaluate(async () => {
  try { await doSyncPush(); return 'ok'; } catch (e) { return 'KO ' + e.message; }
});
const tirer = (page, initial = false) => page.evaluate(async (i) => {
  try { await doSyncPull(i); return 'ok'; } catch (e) { return 'KO ' + e.message; }
}, initial);
const synchroniser = async (page) => { await pousser(page); await tirer(page); };

const serveurCellule = (srv, z, t) => {
  if (!srv.ligne) return undefined;
  return (((srv.ligne.state || {}).taskProgress || {})[z] || {})[t];
};
const serveurProgress = (srv) => (srv.ligne ? ((srv.ligne.state || {}).taskProgress || {}) : {});
const serveurTs = (srv) => (srv.ligne ? new Date(srv.ligne.updated_at).getTime() : 0);

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
  CHROME, URL, SDK, dormir, nouveauServeur, ouvrirAppareil, ouvrirOnglet, redemarrer,
  lireTout, lireStamps, saisir, sonde, isoler, pousser, tirer, synchroniser,
  serveurCellule, serveurProgress, serveurTs, visibilite, bilan,
};
