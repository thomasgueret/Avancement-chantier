// Sonde de banc : le faux SDK est-il bien actif DÈS le démarrage ?
// Si ce test ne passe pas, toutes les suites suivantes sont sans valeur.
const { chromium } = require('playwright');
const { CHROME, nouveauServeur, ouvrirAppareil, sonde, bilan, dormir } = require('./reprise-lib.js');
const SEED = require('../seeds/liss.js');

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const srv = nouveauServeur();
  const tel = await ouvrirAppareil(nav, srv, 'tel', { seed: SEED, deviceId: 'tel' });
  await dormir(1200);
  console.log('journal serveur :', JSON.stringify(srv.journal, null, 1));
  console.log('sonde :', JSON.stringify(await sonde(tel.page)));
  b.chk('le serveur a été appelé pendant le démarrage (faux SDK actif au boot)',
    srv.journal.length > 0, { appels: srv.journal.length });
  b.chk('le serveur vide a reçu le push initial', srv.ecritures >= 1, { ecritures: srv.ecritures });
  b.chk('la ligne serveur porte l\'avancement de la graine',
    !!(srv.ligne && srv.ligne.state && srv.ligne.state.taskProgress
       && srv.ligne.state.taskProgress.z11), srv.ligne && Object.keys(srv.ligne.state.taskProgress || {}));
  const code = b.fin(tel.errs);
  await nav.close();
  process.exit(code);
})();
