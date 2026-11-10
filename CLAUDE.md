# Avancement-chantier

Contexte du projet, pour reprendre le travail sans avoir à tout réexpliquer.

## À quoi sert l'application

Outil de pilotage de chantier pour un **conducteur de travaux**, utilisé
principalement **sur le chantier, au téléphone**, et au bureau sur ordinateur.
Elle remplace un empilement de classeurs Excel : avancement des ouvrages,
effectifs, heures consommées contre budget, pièces administratives des
sous-traitants, stock, consommables, CCTP et comptes rendus hebdomadaires.

Trois contraintes dictent toute l'architecture :

1. **Le chantier n'a pas de réseau fiable.** Tout doit fonctionner hors ligne,
   la saisie ne doit jamais attendre le serveur, et rien ne doit se perdre.
2. **La donnée la plus coûteuse est l'avancement.** Elle se relève à pied, sur
   place. Une saisie perdue, ce sont deux heures de tournée à refaire.
3. **L'outil est utilisé d'une main, debout, sur un écran de téléphone.**
   Mobile d'abord ; le confort PC vient ensuite, jamais l'inverse.

## Pile technique

JavaScript **vanilla, sans aucun build ni framework**. Quatre fichiers servis
tels quels :

| Fichier | Rôle |
|---|---|
| `app.js` | ~21 000 lignes — tout : état, rendu, calculs, synchro |
| `index.html` | la coquille : onglets, sous-onglets, conteneurs vides |
| `style.css` | ~7 500 lignes, thème clair |
| `sw.js` | service worker, « réseau d'abord » puis repli sur le cache |

- Un **seul objet global `state`**, persisté dans `localStorage` sous la clé
  `chantier_v1`.
- **IndexedDB** pour les images de plans et un anneau de 20 sauvegardes locales
  (`createLocalBackup`, `BACKUP_KEEP = 20`) — local à chaque appareil.
- **Supabase** pour la synchro multi-appareils : **une seule ligne partagée**
  (`site_data`, `SHARED_SITE_ID = '11111111-…'`), **sans authentification**.
- **jsPDF** chargé depuis un CDN pour les exports ; le service worker ne cache
  que le même domaine, donc l'export PDF exige une connexion.

## Les onglets

**Tableau de bord** — points d'attention consolidés (documents expirés, stock
en alerte, eOTP en dérive, CR en retard…), courbe d'avancement, cartes par
bâtiment, suivi des heures, entreprises.

**Effectifs** — *Saisie* (présences par entreprise et par jour, intempéries) ·
*Graphique* (courbes d'effectifs par entreprise).

**Avancement** — *Avancement* : la fiche de saisie par zone, ouvrage par
ouvrage, tâche par tâche. Pourcentage pour les ouvrages en m²/ml, **saisie à la
pièce pour les ouvrages en « u »**. Barre des **relevés** (voir plus bas).
*Heures* : le tableau de suivi des heures contre budget, 20 colonnes rangées en
catégories repliables (Budget / Avancement / SAP / PUMA / Au stade / FDC auto /
Manuel), lignes réordonnables et regroupables en rubriques, verrouillage de la
semaine précédente, écart S/S-1, export PDF avec page de garde et tableau de
bord. *Récapitulatif* : tableau de bord de projet — matrice bâtiments ×
ouvrages, courbes avec projection, rythme observé en jours ouvrés.

**Travaux** — le CCTP du chantier en trois vues sur les mêmes données :
*Visite* (« je suis ici » → tout ce qui est dû dans ce lieu, par lot), *CCTP*
(sommaire et articles numérotés `lot.chapitre.article` avec leur localisation),
*Carnet* (paramétrage des chapitres et articles).

**Administratif** — *Sécurité* (pièces administratives par entreprise avec
échéances) · *eCheckIn* (fiches ouvriers, documents, présence sur site).

**Stock** — *Pilotage* (ce qu'il faut décider aujourd'hui) · *Magasin* (article
par article) · *Mouvements* (journal) · *CB* (vision budget par produit ou par
eOTP).

**Consommable** — *Saisie* (commandes groupées) · *Récapitulatif* (par produit
ou par eOTP).

**Suivi** — plans annotés : formes posées sur un plan, par lot et par statut,
avec filtres et récapitulatif.

**CR** — comptes rendus hebdomadaires par entreprise : rubriques
personnalisables, widget d'avancement, aperçus Administratif et Effectifs,
passage de semaine, export PDF.

**Données** — *Zones* (arborescence du chantier + *Planning* en barres par
bâtiment) · *Tâches* (ouvrages : unité, tâches, ratios d'heures, poids et
usage) · *eOTP* (lignes de budget en € ou en heures, rattachement à un ouvrage)
· *Entreprises* · *Lots* · *Admin.* (dates du chantier, libellés des documents,
sauvegardes, état de synchro).

## La synchronisation — le sujet le plus sensible du projet

Un seul enregistrement partagé, pas de serveur applicatif, donc tout l'arbitrage
se fait côté client.

- **Par clé** : `state.syncKeyStamps[k]` est tamponné dans `save()` pour chaque
  clé modifiée. `SYNC_UNION_DICT_KEYS` (union profonde), `SYNC_UNION_ARRAY_KEYS`
  (le plus récent gagne le tableau entier, union par id à égalité),
  `SYNC_EXCLUDED_KEYS` (état d'affichage propre à l'appareil),
  `SYNC_RETIRED_KEYS` (onglets supprimés — ignorées à la fusion pour qu'elles ne
  reviennent pas par la ligne partagée), sinon dernier tampon gagnant.
- **Par cellule, pour l'avancement** : `state.taskProgressAt[zone][tâche]` donne
  son propre horodatage à chaque cellule. `mergeProgressByCell(loc, rem)`
  arbitre cellule par cellule, avec trois règles qui comptent :
  l'**opinion** (un côté n'a voix que s'il porte une valeur ou une pierre
  tombale — sinon l'autre fait foi), la **pierre tombale** (une remise à zéro
  pose un horodatage, donc se propage au lieu d'être ressuscitée), et le
  **repli par zone** (`zoneUpdated[zone]` avant l'horodatage de clé).
- **Garde anti-écrasement** : `doSyncPush` relit `updated_at` ; s'il diffère de
  `syncLastSeenRemoteTs`, il fusionne avant d'écrire.
- **Fiabilité d'envoi** : `syncPendingSince` persisté, reprise à délai doublant
  5 s → 60 s, envoi sur `pagehide`/`beforeunload`, envoi **avant** lecture au
  retour sur l'application, pastille « 🟠 Non envoyé » tant qu'une saisie n'est
  pas partie.

### Les relevés d'avancement

L'avancement est un état **courant**, pas une donnée hebdomadaire. Un relevé est
donc un **instantané figé** pris à la clôture d'une tournée, rangé à part dans
`state.avancementReleves` (clé en union profonde : aucun relevé ne peut
disparaître d'une fusion), tandis que `taskProgress` continue intact — c'est ce
qui garantit que **les courbes, la matrice et le récapitulatif ne bougent pas**
quand on clôture. Restaurer fige d'abord l'état courant sous « Avant
restauration du … », puis redate chaque cellule pour gagner la fusion suivante.

## Conventions à respecter

- **Branche de travail : `claude/construction-tracking-app-yKUdG`**, jamais une
  autre. Pas de pull request sauf demande explicite.
- `APP_VERSION` dans `app.js` et `CACHE` dans `sw.js` se **bumpent ensemble**
  (`'1.90'` ↔ `'chantier-v190'`).
- Interface et commentaires **en français**. Les commentaires expliquent
  *pourquoi*, pas *quoi* — en particulier devant chaque correction de perte de
  données, où ils rappellent le symptôme qu'ils évitent.
- **Aucun débordement horizontal** de 390 à 1440 px. Les tableaux larges vont
  dans leur propre conteneur `overflow-x: auto`.
- `table-layout: fixed` + `<colgroup>` : dès que la première ligne de `thead`
  porte des `colSpan`, les largeurs doivent venir de `<col>`.
- Pour les rails de tableau, `box-shadow: inset` et non `border` (une bordure
  décale le contenu en layout fixe).

## Tests

Dans `tests/`, versionnés (ils ont déjà été perdus une fois en vivant dans un
répertoire temporaire).

```sh
cd tests && npm install        # playwright ; Chromium est déjà dans l'image
sh srv.sh                      # sert le dépôt sur http://127.0.0.1:8765
node qa/fumee.js               # test de fumée : tous les onglets, 3 largeurs
```

- `harness/repro-sync.js` — banc à plusieurs appareils avec faux Supabase :
  coupure réseau (`srv.enPanne`), latence injectée (`srv.latenceMs`), décalage
  d'horloge (`decalageMs`), et **`isoler(page)`** qui coupe le pull périodique
  de 20 s et l'anti-rebond d'envoi.
  **`isoler()` n'est pas optionnel** : sans lui, un appareil laissé ouvert tire
  les données de l'autre tout seul et le test « prouve » une convergence qu'il
  n'a pas provoquée. Ne pas l'utiliser quand on teste justement les timers.
- `seeds/liss.js` — bâtiment « Olivier LISSAGARAY », 6 zones, 2 ouvrages (un en
  m², un en « u »). `SEED.herite({…})` rend la même graine **sans**
  `taskProgressAt`, c'est-à-dire l'état d'avant la v1.87.
- Chromium : `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Piège récurrent : `toLocaleString('fr-FR')` produit une **espace insécable
  étroite (U+202F)** — normaliser avant toute comparaison de chaîne.

## Où en est le projet

**v1.90**, 165 commits. L'essentiel du travail récent a porté sur une perte
réelle de données : deux heures de relevé de chantier disparues.

- **v1.87** — quatre causes identifiées sur banc à deux appareils : l'arbitrage
  par clé unique faisait reculer des zones jamais touchées ; un envoi en échec
  n'était jamais relancé ; la marque d'attente ne survivait pas à la fermeture ;
  la pastille annonçait « Synchronisé » à tort.
- **v1.88** — système de relevés (sauvegarde, clôture, restauration).
- **v1.89** — la correction précédente était **incomplète** : la datation
  rétroactive envoyait tout le chantier en 1970 (appel trop tôt dans `load()`),
  et le repli de la fusion restait l'horodatage de clé. Reproduit : `tOss`
  repassait de 100 % à 20 %. Corrigé, plus trois défauts de robustesse.
- **v1.90** — retrait des onglets **ST** et **Devis** et de tous leurs liens
  (dont le champ « Taux horaire » de Données → Admin, qui n'alimentait qu'eux).

### Points ouverts

1. **Sécurité — à traiter.** Le dépôt GitHub est **public** et contient l'URL
   Supabase et la clé anon ; les politiques RLS donnent au rôle anonyme la
   lecture et l'écriture complètes sur `site_data`, et lecture / écriture /
   **suppression** sur le bucket `plans`. Il n'y a **aucune authentification** :
   qui trouve le dépôt peut lire, modifier ou effacer tout le chantier, images
   de plans comprises. Les données incluent des informations nominatives sur les
   ouvriers (noms, échéances de documents). Un audit était en cours quand il a
   été interrompu ; ce point reste entier.
2. **Campagne de tests inachevée.** 5 axes sur 13 ont rendu un résultat
   (fusion, convergence, migration, horloge, reprise) ; la phase de réfutation
   adverse n'a jamais tourné. Les constats de l'axe « horloge » — un appareil
   dont l'horloge avance gagnerait tous les conflits — sont **crédibles mais non
   vérifiés**. Suites rejouables dans `tests/qa/horloge-*.js`,
   `reprise-*.js`, `concurrence-*.js`.
3. `syncSelfCheck()` signale la clé `stockQuery` (recherche du Magasin), ni
   persistée ni déclarée transitoire. Préexistant, inoffensif, une ligne à
   ajouter dans `TRANSIENT_STATE_KEYS`.
4. Données → **Entreprises** et **Lots** sont restés dans l'ancien style de
   liste simple, alors que Zones, Tâches et eOTP ont été refondus.
5. `origin/main` est loin derrière la branche de travail.
