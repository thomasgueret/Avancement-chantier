// Banc à deux (ou trois) appareils : chaque « appareil » est un contexte de
// navigateur isolé, et tous partagent un faux Supabase tenu côté Node — une
// seule ligne `site_data`, exactement comme en production.
//
// Sert à reproduire pour de vrai les pertes de saisies d'avancement.
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = 'http://127.0.0.1:8765/index.html';

// ---- Le faux serveur, une seule ligne site_data ----
function nouveauServeur() {
  return {
    ligne: null,              // { state, updated_at }
    journal: [],              // trace de toutes les écritures
    lectures: 0, ecritures: 0,
    enPanne: false,           // simule une coupure réseau
    latenceMs: 0,             // délai injecté, pour provoquer les courses
  };
}

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// Installe dans la page un client Supabase factice qui parle au serveur Node.
async function brancher(page, serveur, nom) {
  await page.exposeFunction('__srvGet', async (cols) => {
    if (serveur.latenceMs) await dormir(serveur.latenceMs);
    if (serveur.enPanne) throw new Error('reseau coupe');
    serveur.lectures++;
    if (!serveur.ligne) return null;
    if (cols === 'updated_at') return { updated_at: serveur.ligne.updated_at };
    return { state: serveur.ligne.state, updated_at: serveur.ligne.updated_at };
  });
  await page.exposeFunction('__srvUpsert', async (row) => {
    if (serveur.latenceMs) await dormir(serveur.latenceMs);
    if (serveur.enPanne) throw new Error('reseau coupe');
    serveur.ecritures++;
    serveur.ligne = { state: row.state, updated_at: row.updated_at };
    serveur.journal.push({ qui: nom, updated_at: row.updated_at });
    return true;
  });
  await page.addInitScript(() => {
    window.__installerFauxSupabase = () => {
      const client = {
        from() {
          const req = {
            _cols: '',
            select(cols) { req._cols = cols; return req; },
            eq() { return req; },
            async maybeSingle() {
              try { return { data: await window.__srvGet(req._cols), error: null }; }
              catch (e) { return { data: null, error: e }; }
            },
            async upsert(row) {
              try { await window.__srvUpsert(row); return { error: null }; }
              catch (e) { return { error: e }; }
            },
          };
          return req;
        },
        channel() { return { on() { return this; }, subscribe() { return this; } }; },
        removeChannel() {},
      };
      window.loadSupabase = () => Promise.resolve(client);
      if (typeof supabaseClient !== 'undefined') { try { supabaseClient = client; } catch (_) {} }
    };
  });
}

// opts : { seed, deviceId, viewport, decalageMs, appVersion }
async function ouvrirAppareil(nav, serveur, nom, opts = {}) {
  const ctx = await nav.newContext({ viewport: opts.viewport || { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !/Supabase|net::ERR|Failed to load/.test(t)) errs.push('CONSOLE: ' + t);
  });
  await brancher(page, serveur, nom);
  // Décalage d'horloge éventuel, posé AVANT tout script de la page.
  if (opts.decalageMs) {
    await page.addInitScript((ms) => {
      const vrai = Date.now;
      Date.now = () => vrai() + ms;
      const V = Date;
      window.Date = new Proxy(V, {
        construct(t, a) { return a.length ? new t(...a) : new t(vrai() + ms); },
      });
      window.Date.now = Date.now;
    }, opts.decalageMs);
  }
  if (opts.seed) {
    await page.addInitScript(([s, id]) => {
      localStorage.setItem('chantier_v1', JSON.stringify(s));
      if (id) localStorage.setItem('chantier_device_id', id);
    }, [opts.seed, opts.deviceId || '']);
  } else if (opts.deviceId) {
    await page.addInitScript((id) => localStorage.setItem('chantier_device_id', id), opts.deviceId);
  }
  await page.goto(URL);
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__installerFauxSupabase());
  return { ctx, page, nom, errs };
}

// Recharge un appareil en conservant son localStorage (redémarrage d'application).
async function redemarrer(app) {
  await app.page.goto(URL);
  await app.page.waitForTimeout(700);
  await app.page.evaluate(() => window.__installerFauxSupabase());
  return app;
}

const lireAvancement = (page, zoneId) =>
  page.evaluate((z) => JSON.parse(JSON.stringify(state.taskProgress[z] || {})), zoneId);
const lireTout = (page) =>
  page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgress || {})));
const lireStamps = (page) =>
  page.evaluate(() => JSON.parse(JSON.stringify(state.taskProgressAt || {})));
const stamps = (page) =>
  page.evaluate(() => ({
    taskProgress: state.syncKeyStamps.taskProgress, syncTimestamp: state.syncTimestamp,
    vu: state.syncLastSeenRemoteTs, statut: state.syncStatus, enAttente: state.syncPendingSince,
  }));

const saisir = (page, zoneId, taskId, pct) =>
  page.evaluate(([z, t, p]) => { setProgress(z, t, p); }, [zoneId, taskId, pct]);

const attendrePush = (page, ms = 2600) => page.waitForTimeout(ms);

// ÉTANCHÉITÉ — coupe le pull périodique (20 s) et l'anti-rebond d'envoi, pour
// que la seule synchro qui se produise soit celle que le test demande.
// Sans cela un appareil laissé ouvert tire les données de l'autre tout seul,
// et le test « prouve » une convergence qu'il n'a pas provoquée.
const isoler = (page) => page.evaluate(() => {
  clearInterval(syncPollTimer); clearTimeout(syncPollTimer); syncPollTimer = null;
  clearTimeout(syncPushTimer); syncPushTimer = null;
  clearTimeout(syncRetryTimer); syncRetryTimer = null;
  window.schedulePush = () => {};          // plus d'envoi spontané
  window.__isole = true;
});

// Force une synchro complète (envoi puis lecture), sans dépendre des timers.
const synchroniser = async (page) => {
  await page.evaluate(async () => {
    try { await doSyncPush(); } catch (e) {}
    try { await doSyncPull(); } catch (e) {}
  });
  await page.waitForTimeout(300);
};

// Petit compteur d'assertions partagé par toutes les suites.
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
  CHROME, URL, nouveauServeur, ouvrirAppareil, redemarrer, brancherPage: brancher,
  lireAvancement, lireTout, lireStamps, stamps, saisir, attendrePush, synchroniser, bilan, dormir,
  isoler,
};
