# Briefing QA — campagne de tests v1.89

Tu es testeur. Ton travail est de **casser** le code, pas de le réparer ni de le
complimenter. Un axe qui ne trouve rien est un résultat valable, à condition
d'avoir vraiment essayé.

## Règles absolues

1. **NE MODIFIE JAMAIS** `app.js`, `index.html`, `style.css`, `sw.js`,
   `manifest.json`, ni aucun fichier existant du dépôt. Tu es en lecture seule
   sur l'application. Aucune commande `git` qui écrit (`add`, `commit`,
   `checkout`, `stash`, `reset`, `push`…).
2. **Écris tes tests dans `/home/user/Avancement-chantier/tests/qa/`**, et
   **préfixe-les de ton slug d'axe** : `<slug>-01.js`, `<slug>-02.js`…
   D'autres agents travaillent en même temps : un nom non préfixé écrase leur
   travail. Tes captures d'écran vont dans le même dossier (elles sont ignorées
   par git). N'écris pas dans `tests/harness/` ni `tests/seeds/` — ce sont des
   fichiers partagés ; si tu as besoin d'une variante, crée
   `tests/seeds/<slug>-*.js`.
3. **Tu dois EXÉCUTER tes tests.** Une hypothèse non exécutée n'est pas une
   trouvaille. Chaque trouvaille doit citer une commande de repro exécutable et
   la sortie réellement observée.
4. Ne lance pas plus de **2 navigateurs Chromium en même temps** (4 cœurs,
   d'autres agents tournent).

## Mise en route

```sh
cd /home/user/Avancement-chantier/tests
sh srv.sh                      # garantit http://127.0.0.1:8765 (idempotent — relance-le si une page ne charge pas)
node qa/<slug>-01.js
```

- Playwright est installé dans `tests/node_modules`. **Lance node depuis
  `tests/`**, sinon `require` échoue.
- Chromium : `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (constante
  `CHROME` du harnais).
- **Aucun accès Internet** : Supabase et le CDN jsPDF ne répondent pas. Pour la
  synchro, utilise le faux serveur du harnais.

## Le harnais — `tests/harness/repro-sync.js`

```js
const { chromium } = require('playwright');
const {
  CHROME, URL, nouveauServeur, ouvrirAppareil, redemarrer, isoler,
  lireTout, lireStamps, lireAvancement, stamps, saisir, attendrePush,
  synchroniser, bilan, dormir,
} = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

const b = bilan();                       // b.chk(label, cond, detail) ; b.fin(errs)
const nav = await chromium.launch({ executablePath: CHROME });
const srv = nouveauServeur();            // { ligne, journal, lectures, ecritures, enPanne, latenceMs }
const tel = await ouvrirAppareil(nav, srv, 'telephone',
  { seed: SEED, deviceId: 'tel', viewport: { width: 390, height: 844 }, decalageMs: 0 });
await isoler(tel.page);                  // coupe le pull périodique (20 s) et l'anti-rebond
await saisir(tel.page, 'z11', 'tOss', 100);
await synchroniser(tel.page);            // envoi PUIS lecture, déterministe
srv.enPanne = true;                      // coupe le réseau
srv.latenceMs = 300;                     // injecte un délai, pour provoquer les courses
await redemarrer(tel);                   // recharge en gardant le localStorage
const code = b.fin(tel.errs);            // tel.errs : erreurs JS collectées
```

**`isoler(page)` est important** : sans lui, un appareil laissé ouvert tire les
données de l'autre tout seul au bout de 20 s, et ton test « prouve » une
convergence qu'il n'a pas provoquée. C'est une erreur qui a déjà faussé un test
de cette campagne. Ne l'utilise PAS quand tu testes justement les timers
(reprise, anti-rebond, pull périodique) — dans ce cas, pilote `srv.enPanne` et
attends réellement.

## La graine — `tests/seeds/liss.js`

Bâtiment « Olivier LISSAGARAY », 2 niveaux, 6 zones (`z11`…`z23`), 2 ouvrages :
`ouvGO` en m² (tâches `tTrac`, `tOss`, `tIso`, `tPar`) et `ouvMEN` en **u**
(tâches `mPose`, `mFin`). Avancement d'avant la visite, daté d'il y a une
semaine (`SEED.IL_Y_A_UNE_SEMAINE`).

`SEED.herite({ keyStamp, syncTimestamp, sansStamps, progress })` renvoie la même
graine **sans `taskProgressAt`** — l'état de tous les appareils avant la v1.87.

Tout est global dans la page : `state`, `save()`, `setProgress()`,
`computeAvancementModel()`, `applyRemoteStateMerge()`, `mergeProgressByCell()`,
`renderAvancement()`, `cloturerReleve()`, `restaurerReleve()`,
`compterSaisiesPeriode()`, `pctInstantane()`, `doSyncPush()`, `doSyncPull()`…
Tu peux donc les appeler via `page.evaluate`, en plus de piloter l'interface.

## Ce qui est sous test

### A. Fusion de l'avancement cellule par cellule — `app.js` ~3104-3185, ~21425-21530

- `state.taskProgressAt = { [zoneId]: { [taskId]: ms } }` — un horodatage par cellule.
- `setProgress(z, t, pct, libre)` : `pct === 0` **supprime** la valeur mais
  **pose quand même l'horodatage** (pierre tombale). `libre` contourne
  l'arrondi au pas de 5 %.
- `migrerHorodatageAvancement()` — appelée depuis `runPostLoadMigrations()`,
  date une fois les cellules d'avant la v1.87 avec, par ordre de préférence,
  `zoneUpdated[zone]`, puis `syncKeyStamps.taskProgress`, puis `syncTimestamp`,
  puis 1.
- `mergeProgressByCell(loc, rem)` où chaque côté est
  `{ progress, at, zoneUpdated, repli }`. **Signature changée en v1.89** — six
  arguments positionnels auparavant. Règles :
  - un côté n'a une **opinion** que s'il porte une valeur ou une pierre
    tombale ; sinon l'autre fait foi ;
  - sinon l'horodatage le plus récent gagne ;
  - à égalité, la valeur présente l'emporte sur l'absence, puis le distant ;
  - le **repli** d'une cellule sans horodatage propre est `zoneUpdated[zone]`,
    puis `repli` (l'horodatage de clé) ;
  - invariant : toute valeur retenue repart avec un horodatage ;
  - accumulateurs sans prototype (zone nommée `__proto__`).
- `applyRemoteStateMerge` traite `taskProgress` par ce chemin et **saute**
  `taskProgressAt`.

### B. Fiabilité d'envoi — `app.js` ~21150-21230, ~21270-21400, ~21680-21760

- `state.syncPendingSince` : marque **persistée** d'un envoi en attente, posée
  **au début** de `save()` (v1.89) ; dans `SYNC_EXCLUDED_KEYS`, jamais synchronisée.
- `reprendreEnvoiEnAttente()` au démarrage, **avant** la première lecture.
- `planifierReprise()` / `arreterReprise()` : reprise à délai doublant, 5 s → 60 s.
- `flushSyncPush()` sur `pagehide` et `beforeunload`.
- `online` → envoi immédiat si quelque chose est en attente, quel que soit le statut.
- `visibilitychange` → visible : **envoi puis lecture** (l'ordre compte).
- `updateSyncChip()` : « 🟠 Non envoyé » tant qu'une saisie n'est pas partie.
- `doSyncPush` garde anti-écrasement : relit `updated_at`, si ≠
  `syncLastSeenRemoteTs` il fusionne d'abord. `updated_at` est écrit depuis
  `state.syncTimestamp` — l'horloge de l'appareil.

### C. Relevés d'avancement — `app.js` ~3565-3760, `index.html` `#relevesbar`, CSS `.releve-*`

Un relevé est un **instantané figé** de tout l'avancement, pris à la clôture
d'une tournée. L'avancement courant continue, intact.

- `state.avancementReleves = { [id]: { id, name, startedAt, closedAt, saisies,
  pct, taskProgress, taskProgressAt } }` — clé en **union profonde** à la synchro.
- `state.avancementReleveDebut` : début de la période en cours (ms), scalaire
  ordinaire (donc arbitré par le dernier horodatage).
- `cloturerReleve()` — `prompt()` pour le nom, défaut « Semaine <n ISO> »,
  purge au-delà de `RELEVES_MAX = 52`, rouvre une période.
- `restaurerReleve(id)` — fige d'abord l'état courant sous « Avant restauration
  du … », remplace `taskProgress`, **redate toutes les cellules à maintenant**.
- `supprimerReleve(id)`, `renderRelevesBar()`, `compterSaisiesPeriode()`,
  `pctInstantane(progress)` (échange `state.taskProgress` le temps du calcul).
- **Garantie annoncée à l'utilisateur** : une clôture ne change *rien* à
  l'avancement courant, à l'avancement global, à la matrice, au récapitulatif
  ni aux courbes (`state.avancementHistory`).

## Déjà trouvé et corrigé en v1.89 — ne le re-rapporte pas, mais vérifie que ça tient

1. La datation rétroactive envoyait tout le chantier en 1970 (appel trop tôt
   dans `load()`), et l'appareil qui se mettait à jour perdait alors contre
   celui qui ne s'était pas encore mis à jour. Corrigé.
2. Le repli de la fusion était l'horodatage de clé, commun à toutes les zones —
   le mécanisme de la perte d'origine. Il est désormais par zone.
3. Une valeur pouvait être retenue sans horodatage. Invariant rétabli.
4. Une zone nommée `__proto__` polluait `Object.prototype`. Accumulateurs sans
   prototype.
5. `syncPendingSince` était écrit avec un `save` de retard. Posé avant la
   sérialisation.

Les suites `tests/qa/migration-repli.js`, `migration-consequence.js` et
`fumee.js` couvrent ces points et passent. Lis-les : elles montrent le style
attendu, et les **régressions** qu'il ne faut pas réintroduire.

## Ce qui compte comme trouvaille

Une trouvaille = **un comportement de l'application qui trahit l'utilisateur**,
démontré par une exécution. Par ordre de gravité :

- `perte_donnee` — une saisie disparaît, recule, ou ne part jamais. Le pire.
- `corruption` — état incohérent, exception non rattrapée, rendu cassé.
- `garantie_violee` — une promesse ci-dessus est fausse (ex. la clôture décale une courbe).
- `robustesse` — plante sur une entrée limite, une donnée héritée, un quota.
- `ergonomie` — l'utilisateur ne peut pas comprendre ou récupérer.

Ne rapporte **pas** : un test à toi qui se trompe d'API, une préférence de
style, une amélioration souhaitable sans défaut démontré, un `console.warn`
attendu (Supabase absent, CDN injoignable).

Quand tu doutes qu'un comportement soit voulu, teste-le quand même et dis
franchement dans `doute` pourquoi ça pourrait être intentionnel.
