# Optimisation calepinage bardage

Application web (HTML/CSS/JS, sans build) pour **optimiser le taux de chute**
lors de la découpe de plaques de bardage, puis générer un **carnet de découpe
PDF** téléchargeable.

## Fonctionnalités

- **Stock** : saisie des formats de plaques disponibles (largeur × hauteur),
  avec quantité limitée ou illimitée (∞).
- **Pièces à découper** : rectangles, **triangles rectangles** et
  **trapèzes rectangles**, avec quantité, couleur, et rotation autorisée ou non.
- **Réglages** : trait de scie (kerf) et marge de rive.
- **Optimiseur** : calepinage 2D par algorithme *MaxRects* (heuristique
  *Best Short Side Fit*) avec rotation, et **appairage automatique des
  triangles rectangles identiques** en rectangles pleins (vrai gain de matière
  sur les rampants et pignons).
- **Visualisation** : schéma de chaque plaque avec les vraies formes et les
  étiquettes, plus le **taux de chute** global et par plaque.
- **Export PDF** : récapitulatif + une page par plaque (schéma vectoriel +
  carnet de découpe).
- **PWA** : installable, fonctionne hors-ligne, données enregistrées localement
  (localStorage). Import/export d'une sauvegarde JSON.

## Utilisation

Ouvrir `index.html` dans un navigateur, ou déployer le dossier sur GitHub Pages.
Aucune dépendance à installer : seule la librairie `jsPDF` est chargée via CDN
pour l'export PDF.

## Architecture

| Fichier         | Rôle                                                        |
|-----------------|-------------------------------------------------------------|
| `index.html`    | Structure de l'interface (onglets Stock / Pièces / Réglages / Calepinage). |
| `style.css`     | Mise en forme.                                              |
| `optimizer.js`  | Moteur de calepinage (géométrie, appairage, MaxRects). Sans dépendance, testable seul. |
| `app.js`        | Interface, état (localStorage), rendu SVG, export PDF.      |
| `manifest.json` | Manifeste PWA.                                              |

## Limites connues / pistes d'amélioration

- Le packing se fait sur la **boîte englobante** de chaque pièce. Les triangles
  rectangles identiques sont appairés, mais les chutes triangulaires internes
  d'un trapèze ou d'un triangle isolé ne sont pas encore re-remplies par de
  petites pièces (piste : nesting des chutes triangulaires).
- Heuristique gloutonne : le résultat est très bon mais pas garanti optimal au
  sens strict.
- Les trapèzes sont supposés **rectangles** (un côté vertical).

Contributions bienvenues — l'objectif est de faire évoluer l'outil au fil des
chantiers.
