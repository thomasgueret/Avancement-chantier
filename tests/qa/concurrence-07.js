// AXE CONCURRENCE — 07. Qui appelle save() pendant _syncApplying ?
// La trace de 06 montrait DEUX save() avec _syncApplying=true : celui de la
// fusion, et un second. Un save() pendant la fusion n'horodate aucune clé et
// ne programme aucun envoi : ce qu'il écrit ne partira jamais tout seul.
const { chromium } = require('playwright');
const L = require('./concurrence-lib.js');
const SEED = require('../seeds/liss.js');

const MAINTENANT = Date.now();

(async () => {
  const b = L.bilan();
  const nav = await chromium.launch({ executablePath: L.CHROME });
  const errs = [];
  const srv = L.nouveauServeur();
  const app = await L.ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel' });
  await L.isoler(app.page);

  const r = await app.page.evaluate(async ([rem, ts]) => {
    const appels = [];
    const vrai = window.save;
    window.save = function () {
      const pile = (new Error().stack || '').split('\n').slice(1, 6).map(s => s.trim()).join(' | ');
      appels.push({ applying: _syncApplying, pile });
      return vrai.apply(this, arguments);
    };
    const avant = {
      stamp: state.syncKeyStamps.taskProgress, ts: state.syncTimestamp,
      pending: state.syncPendingSince,
      histo: JSON.parse(JSON.stringify(state.avancementHistory || {})),
    };
    const res = await applyRemoteStateMerge(rem, ts);
    window.save = vrai;
    return { appels, res, avant,
      apres: { stamp: state.syncKeyStamps.taskProgress, ts: state.syncTimestamp,
        pending: state.syncPendingSince, hasPending: _hasPendingPush,
        histo: JSON.parse(JSON.stringify(state.avancementHistory || {})) } };
  }, [{
    taskProgress: { z11: { tOss: 100 } },
    taskProgressAt: { z11: { tOss: MAINTENANT } },
    zoneUpdated: { z11: MAINTENANT },
    syncKeyStamps: { taskProgress: MAINTENANT, zoneUpdated: MAINTENANT },
  }, MAINTENANT]);

  console.log('appels à save() pendant la fusion :');
  for (const a of r.appels) console.log('   applying=' + a.applying + '  ' + a.pile);
  console.log('avant :', JSON.stringify(r.avant));
  console.log('après :', JSON.stringify(r.apres));
  const pendant = r.appels.filter(a => a.applying);
  b.chk('la fusion appelle save() une seule fois (pas de save() parasite non horodaté)',
    pendant.length <= 1, pendant.map(x => x.pile));
  b.chk('l\'historique d\'avancement n\'est pas modifié en silence par la fusion',
    JSON.stringify(r.avant.histo) === JSON.stringify(r.apres.histo),
    { avant: Object.keys(r.avant.histo).length, apres: Object.keys(r.apres.histo).length });

  // Deuxième volet : après un pull où le LOCAL gagne, _hasPendingPush passe à
  // true (ligne 21348) mais `state.syncPendingSince` — la marque PERSISTÉE —
  // n'est pas posée. Toute saisie suivante trouve _hasPendingPush déjà vrai et
  // ne pose donc pas la marque non plus (save(), ligne 526).
  console.log('\n=== La marque persistée « reste à envoyer » après une fusion où le local gagne ===');
  const srv2 = L.nouveauServeur();
  const a2 = await L.ouvrirAppareil(nav, srv2, 'a2', { seed: SEED, deviceId: 'a2' });
  const b2 = await L.ouvrirAppareil(nav, srv2, 'b2', { seed: SEED, deviceId: 'b2' });
  await L.isoler(a2.page); await L.isoler(b2.page);
  await L.synchroniser(a2.page);           // a2 crée la ligne
  await L.saisir(b2.page, 'z13', 'tIso', 90);
  await L.pousser(b2.page);                // b2 pousse sa saisie
  await L.saisir(a2.page, 'z21', 'tOss', 55);  // a2 a une saisie que le serveur ignore
  const s1 = await L.sonde(a2.page);
  console.log('   a2 avant la lecture :', JSON.stringify(s1));
  await L.tirer(a2.page);                  // fusion : le local gagne sur z21
  const s2 = await L.sonde(a2.page);
  console.log('   a2 après la lecture :', JSON.stringify(s2));
  b.chk('après une fusion où le local gagne, un envoi est bien en attente',
    s2.hasPendingPush === true, s2.hasPendingPush);
  b.chk('cette attente est PERSISTÉE (survivrait à une fermeture brutale)',
    s2.stoPending > 0, { mem: s2.memPending, sto: s2.stoPending });

  // Et une saisie de plus juste après : pose-t-elle la marque ?
  await L.saisir(a2.page, 'z22', 'tOss', 20);
  const s3 = await L.sonde(a2.page);
  console.log('   a2 après une saisie supplémentaire :', JSON.stringify(s3));
  b.chk('une saisie faite ensuite pose la marque persistée',
    s3.stoPending > 0, { mem: s3.memPending, sto: s3.stoPending });

  // Conséquence : fermeture brutale, puis redémarrage. La saisie repart-elle ?
  console.log('\n=== Fermeture brutale puis redémarrage : la saisie repart-elle ? ===');
  srv2.enPanne = true;                     // rien ne peut partir d'ici
  await L.redemarrer(a2, 2500);
  srv2.enPanne = false;
  const s4 = await L.sonde(a2.page);
  console.log('   a2 au redémarrage :', JSON.stringify(s4));
  const loc = await L.lireTout(a2.page);
  console.log('   a2 garde ses saisies en local : z21 =', JSON.stringify(loc.z21), ' z22 =', JSON.stringify(loc.z22));
  // La reprise à délai doublant commence à 5 s : il faut attendre pour de vrai.
  await a2.page.waitForTimeout(20000);
  console.log('   a2 après attente de la reprise :', JSON.stringify(await L.sonde(a2.page)));
  const sp = L.serveurProgress(srv2);
  console.log('   journal srv2 :', srv2.journal.map(e => `${e.t}ms ${e.qui} ${e.op}${e.ok === false ? ' KO' : ''}`).join(' / '));
  console.log('   serveur : z21 =', JSON.stringify(sp.z21), ' z22 =', JSON.stringify(sp.z22));
  b.chk('après redémarrage, les saisies non envoyées finissent sur le serveur',
    (sp.z21 || {}).tOss === 55 && (sp.z22 || {}).tOss === 20, { z21: sp.z21, z22: sp.z22 });

  for (const x of [app, a2, b2]) errs.push(...x.errs);
  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
