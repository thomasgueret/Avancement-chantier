// AXE « horloge » — 01 : arbitrage nu face à un décalage d'horloge.
//
// L'arbitrage cellule par cellule compare des horodatages produits par
// `Date.now()` de CHAQUE appareil. On interroge directement
// `mergeProgressByCell` pour savoir, offset par offset, si la saisie faite le
// plus TARD dans le temps RÉEL est bien celle qui est retenue.
//
// Convention : T0 = maintenant. L'appareil DÉCALÉ saisit à T0 (réel) mais
// horodate T0+D. L'appareil À L'HEURE saisit 10 min PLUS TARD (T0+TARD) et
// horodate honnêtement T0+TARD. La saisie de l'appareil à l'heure est donc,
// dans la réalité du chantier, la plus récente : c'est elle qui doit gagner.
const { chromium } = require('playwright');
const {
  CHROME, nouveauServeur, ouvrirAppareil, bilan, isoler,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const MIN = 60000, H = 3600000, JOUR = 86400000, AN = 365 * JOUR;
const TARD = 10 * MIN;   // l'appareil à l'heure passe 10 minutes après

const CAS = [
  ['telephone +1 h',    +H],
  ['telephone +1 jour', +JOUR],
  ['telephone +1 an',   +AN],
  ['telephone -1 h',    -H],
  ['telephone -1 jour', -JOUR],
];

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const app = await ouvrirAppareil(nav, nouveauServeur(), 'banc', { seed: SEED, deviceId: 'banc' });
  await isoler(app.page);

  const T0 = await app.page.evaluate(() => Date.now());
  console.log('=== A. Qui gagne : la saisie la plus récente en temps réel, ou la mieux datée ? ===');

  for (const [nom, D] of CAS) {
    // Décalé : saisit 100 à T0 (réel), horodaté T0+D.
    const decale = { progress: { z11: { tOss: 100 } }, at: { z11: { tOss: T0 + D } },
                     zoneUpdated: { z11: T0 + D }, repli: T0 + D };
    // À l'heure : saisit 40 dix minutes PLUS TARD, horodaté T0+TARD.
    const honnete = { progress: { z11: { tOss: 40 } }, at: { z11: { tOss: T0 + TARD } },
                      zoneUpdated: { z11: T0 + TARD }, repli: T0 + TARD };

    const r = await app.page.evaluate(([a, c]) => {
      const s1 = mergeProgressByCell(a, c);        // local = à l'heure, distant = décalé
      const s2 = mergeProgressByCell(c, a);        // local = décalé, distant = à l'heure
      return {
        sensHonneteLocal: { v: s1.valeurs.z11.tOss, ts: s1.stamps.z11.tOss },
        sensDecaleLocal:  { v: s2.valeurs.z11.tOss, ts: s2.stamps.z11.tOss },
      };
    }, [honnete, decale]);

    console.log(`\n  --- ${nom} (D = ${D} ms) ---`);
    console.log('   fusion (appareil à l\'heure qui tire) :', JSON.stringify(r.sensHonneteLocal));
    console.log('   fusion (appareil décalé qui tire)    :', JSON.stringify(r.sensDecaleLocal));

    b.chk(`[${nom}] fusion symétrique : même valeur dans les deux sens`,
      r.sensHonneteLocal.v === r.sensDecaleLocal.v,
      [r.sensHonneteLocal.v, r.sensDecaleLocal.v]);

    // La vérité du chantier : 40, saisi 10 min plus tard sur un appareil juste.
    const attendu = 40;
    b.chk(`[${nom}] la saisie la PLUS RÉCENTE EN RÉEL (40) est retenue`,
      r.sensHonneteLocal.v === attendu, r.sensHonneteLocal);

    b.chk(`[${nom}] l'horodatage retenu n'est pas dans le futur`,
      r.sensHonneteLocal.ts <= T0 + TARD + 5000,
      { retenu: r.sensHonneteLocal.ts, maintenantPlusTard: T0 + TARD });
  }

  // ---------------------------------------------------------------------
  console.log('\n=== B. Durée de l\'empoisonnement : combien de temps la saisie future gagne-t-elle ? ===');
  // Une cellule horodatée T0+D dans le dépôt partagé bat toute saisie honnête
  // tant que l'horloge réelle n'a pas dépassé T0+D. On mesure ce seuil.
  for (const [nom, D] of CAS.filter(c => c[1] > 0)) {
    const seuil = await app.page.evaluate(([t0, d, tard]) => {
      const futur = { progress: { z11: { tOss: 100 } }, at: { z11: { tOss: t0 + d } },
                      zoneUpdated: {}, repli: 0 };
      // On simule des saisies honnêtes successives, de plus en plus tard.
      const essais = [tard, 3600000, 86400000, 400 * 86400000];
      return essais.map(dt => {
        const h = { progress: { z11: { tOss: 40 } }, at: { z11: { tOss: t0 + dt } },
                    zoneUpdated: {}, repli: 0 };
        return { dt, v: mergeProgressByCell(h, futur).valeurs.z11.tOss };
      });
    }, [T0, D, TARD]);
    console.log(`  ${nom} :`, JSON.stringify(seuil));
    const premierSucces = seuil.find(e => e.v === 40);
    const attenduMs = D;
    b.chk(`[${nom}] il faut attendre ~${Math.round(D / 3600000)} h avant qu'une saisie honnête reprenne la main`,
      !!premierSucces && premierSucces.dt > attenduMs - 1,
      { premierSucces, attenduMs });
  }

  // ---------------------------------------------------------------------
  console.log('\n=== C. Repli par zone empoisonné : zoneUpdated futur contre cellule datée ===');
  // Le repli par zone (v1.89) est écrit lui aussi avec l'horloge locale.
  // Une cellule SANS horodatage propre côté décalé hérite donc d'un repli futur.
  for (const [nom, D] of CAS) {
    const r = await app.page.evaluate(([t0, d, tard]) => {
      // Décalé : appareil resté en v1.86 (aucun stamp de cellule), mais son
      // zoneUpdated a été écrit avec son horloge avancée.
      const decale = { progress: { z11: { tOss: 20 } }, at: {},
                       zoneUpdated: { z11: t0 + d }, repli: t0 + d };
      const honnete = { progress: { z11: { tOss: 100 } }, at: { z11: { tOss: t0 + tard } },
                        zoneUpdated: { z11: t0 + tard }, repli: t0 + tard };
      const f = mergeProgressByCell(honnete, decale);
      return { v: f.valeurs.z11.tOss, ts: f.stamps.z11.tOss };
    }, [T0, D, TARD]);
    console.log(`  ${nom} :`, JSON.stringify(r));
    b.chk(`[${nom}] un relevé daté ne perd pas contre une copie périmée à zoneUpdated futur`,
      r.v === 100, r);
  }

  // ---------------------------------------------------------------------
  console.log('\n=== D. Pierre tombale future : une remise à zéro d\'un appareil en avance ===');
  // Cas le plus méchant : le téléphone en avance remet une cellule à 0
  // (pierre tombale, aucune valeur). L'appareil à l'heure la resaisit après.
  for (const [nom, D] of CAS.filter(c => c[1] > 0)) {
    const r = await app.page.evaluate(([t0, d, tard]) => {
      const decale = { progress: {}, at: { z11: { tOss: t0 + d } },
                       zoneUpdated: { z11: t0 + d }, repli: t0 + d };
      const honnete = { progress: { z11: { tOss: 100 } }, at: { z11: { tOss: t0 + tard } },
                        zoneUpdated: { z11: t0 + tard }, repli: t0 + tard };
      const f = mergeProgressByCell(honnete, decale);
      return { present: f.valeurs.z11 ? ('tOss' in f.valeurs.z11) : false,
               v: (f.valeurs.z11 || {}).tOss, ts: (f.stamps.z11 || {}).tOss };
    }, [T0, D, TARD]);
    console.log(`  ${nom} :`, JSON.stringify(r));
    b.chk(`[${nom}] la resaisie postérieure survit à la pierre tombale future`,
      r.v === 100, r);
  }

  const code = b.fin(app.errs);
  await nav.close();
  process.exit(code);
})();
