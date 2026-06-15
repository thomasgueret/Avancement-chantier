/* =====================================================================
 * optimizer.js — Moteur de calepinage / optimisation du taux de chute
 *
 * Algorithme :
 *   1. Expansion des pièces (quantités -> items individuels).
 *   2. Pré-passe d'appairage : deux triangles rectangles identiques sont
 *      fusionnés en un rectangle plein (gain réel sur les rampants/pignons).
 *      Un trapèze rectangle peut être complété par son triangle rectangle
 *      complémentaire (mêmes base manquante et hauteur) pour former un
 *      rectangle plein.
 *   3. Packing 2D MaxRects (heuristique Best Short Side Fit) avec rotation
 *      optionnelle, trait de scie (kerf) et marge de rive.
 *
 * Toutes les dimensions sont en millimètres.
 * ===================================================================== */

(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Géométrie des formes
   *
   * Chaque forme est décrite dans un repère local (origine en bas-gauche
   * de sa boîte englobante, axe Y vers le haut). On expose :
   *   - bbox  : { w, h }
   *   - poly  : polygone de la pièce utile [[x,y],...]
   *   - offcut: polygone de la chute interne à la boîte englobante (ou null)
   *   - area  : surface utile (mm²)
   * ------------------------------------------------------------------ */

  function rectShape(w, h) {
    return {
      type: 'rectangle',
      bbox: { w, h },
      poly: [[0, 0], [w, 0], [w, h], [0, h]],
      offcut: null,
      area: w * h,
    };
  }

  // Triangle rectangle. `corner` indique le sommet portant l'angle droit :
  // 'bl' (bas-gauche, défaut), 'br', 'tr', 'tl'. base = côté horizontal,
  // height = côté vertical.
  function rightTriangleShape(base, height, corner) {
    corner = corner || 'bl';
    const w = base, h = height;
    let poly, offcut;
    switch (corner) {
      case 'bl':
        poly = [[0, 0], [w, 0], [0, h]];
        offcut = [[w, 0], [w, h], [0, h]];
        break;
      case 'br':
        poly = [[0, 0], [w, 0], [w, h]];
        offcut = [[0, 0], [w, h], [0, h]];
        break;
      case 'tr':
        poly = [[w, 0], [w, h], [0, h]];
        offcut = [[0, 0], [w, 0], [0, h]];
        break;
      case 'tl':
      default:
        poly = [[0, 0], [w, h], [0, h]];
        offcut = [[0, 0], [w, 0], [w, h]];
        break;
    }
    return {
      type: 'triangle',
      corner,
      bbox: { w, h },
      poly,
      offcut,
      area: (base * height) / 2,
    };
  }

  // Trapèze rectangle : côté vertical à gauche, grande base en bas (B),
  // petite base en haut (b), hauteur h. La chute est le triangle rectangle
  // en haut à droite (jambes (B-b) et h).
  function rightTrapezoidShape(B, b, h) {
    const w = Math.max(B, b);
    // On suppose B >= b (grande base en bas). Si b > B on retourne verticalement.
    if (b > B) {
      const poly = [[0, 0], [b, 0], [B, h], [0, h]];
      const offcut = [[B, 0], [b, 0], [B, h]];
      return { type: 'trapezoid', B, b, h, bbox: { w, h }, poly, offcut, area: ((B + b) / 2) * h };
    }
    const poly = [[0, 0], [B, 0], [b, h], [0, h]];
    const offcut = [[b, h], [B, 0], [B, h]];
    return { type: 'trapezoid', B, b, h, bbox: { w, h }, poly, offcut, area: ((B + b) / 2) * h };
  }

  // Construit la forme géométrique à partir d'une définition de pièce.
  function buildShape(def) {
    switch (def.type) {
      case 'rectangle':
        return rectShape(def.w, def.h);
      case 'triangle':
        return rightTriangleShape(def.base, def.height, def.corner || 'bl');
      case 'trapezoid':
        return rightTrapezoidShape(def.B, def.b, def.h);
      default:
        throw new Error('Type de pièce inconnu : ' + def.type);
    }
  }

  /* ------------------------------------------------------------------ *
   * Transformations de polygones (pour le rendu)
   * ------------------------------------------------------------------ */

  function rotatePolyCW90(poly, bw, bh) {
    // Rotation 90° horaire dans la boîte (bw x bh) -> nouvelle boîte (bh x bw)
    return poly.map(function (p) {
      return [p[1], bw - p[0]];
    });
  }

  function flipPolyX(poly, bw) {
    return poly.map(function (p) { return [bw - p[0], p[1]]; });
  }

  function flipPolyY(poly, bh) {
    return poly.map(function (p) { return [p[0], bh - p[1]]; });
  }

  /* ------------------------------------------------------------------ *
   * Expansion + appairage
   * ------------------------------------------------------------------ */

  function expandAndPair(pieces) {
    // 1. Expansion en items unitaires
    let items = [];
    pieces.forEach(function (def, idx) {
      const qty = Math.max(1, parseInt(def.qty, 10) || 1);
      for (let i = 0; i < qty; i++) {
        const shape = buildShape(def);
        items.push({
          refIndex: idx,
          name: def.name || ('Pièce ' + (idx + 1)),
          color: def.color || '#ff671d',
          rotatable: def.rotatable !== false,
          shape: shape,
          composite: null, // rempli si appairé
        });
      }
    });

    // 2. Appairage des triangles rectangles identiques (mêmes base/hauteur)
    //    -> rectangle plein base x hauteur.
    const used = new Array(items.length).fill(false);
    const result = [];

    function triKey(it) {
      const s = it.shape;
      // clé indépendante du coin : un triangle (base,height) peut toujours
      // être pivoté pour compléter un autre identique.
      const a = Math.round(s.bbox.w * 100) / 100;
      const b = Math.round(s.bbox.h * 100) / 100;
      return a + 'x' + b;
    }

    // Index des triangles libres par clé
    const triBuckets = {};
    items.forEach(function (it, i) {
      if (it.shape.type === 'triangle') {
        const k = triKey(it);
        (triBuckets[k] = triBuckets[k] || []).push(i);
      }
    });

    Object.keys(triBuckets).forEach(function (k) {
      const list = triBuckets[k];
      for (let j = 0; j + 1 < list.length; j += 2) {
        const i1 = list[j], i2 = list[j + 1];
        used[i1] = true; used[i2] = true;
        const a = items[i1], b = items[i2];
        const w = a.shape.bbox.w, h = a.shape.bbox.h;
        result.push({
          kind: 'composite',
          name: a.name + ' + ' + b.name,
          rotatable: a.rotatable && b.rotatable,
          bbox: { w, h },
          area: a.shape.area + b.shape.area,
          parts: [
            { item: a, place: 'tri-bl' },
            { item: b, place: 'tri-tr' },
          ],
        });
      }
    });

    // 3. Reste des items non appairés
    items.forEach(function (it, i) {
      if (used[i]) return;
      result.push({
        kind: 'single',
        name: it.name,
        rotatable: it.rotatable,
        bbox: { w: it.shape.bbox.w, h: it.shape.bbox.h },
        area: it.shape.area,
        item: it,
      });
    });

    return result;
  }

  /* ------------------------------------------------------------------ *
   * MaxRects bin packing (Best Short Side Fit)
   * ------------------------------------------------------------------ */

  function MaxRects(W, H) {
    this.W = W;
    this.H = H;
    this.free = [{ x: 0, y: 0, w: W, h: H }];
    this.placed = [];
  }

  // heuristic : 'bssf' (best short side fit), 'baf' (best area fit),
  //             'bl' (bottom-left), 'blsf' (best long side fit)
  //
  // w, h   : dimensions réelles de la pièce (sans kerf)
  // kerf   : épaisseur du trait de scie — ajouté uniquement si la pièce ne remplit
  //          pas entièrement la zone libre dans la dimension concernée, c'est-à-dire
  //          seulement quand une coupe sera réellement effectuée de ce côté.
  //
  // Le nœud retourné contient :
  //   w, h      : espace consommé (pièce + kerf éventuel), utilisé pour fragmenter
  //               les zones libres restantes
  //   pieceW/H  : dimensions réelles de la pièce (pour l'enregistrement du placement)
  MaxRects.prototype.findNode = function (w, h, rotatable, kerf, heuristic) {
    kerf = kerf || 0;
    heuristic = heuristic || 'bssf';
    let best = null, bestPrimary = Infinity, bestSecondary = Infinity;
    const self = this;
    const consider = function (pw, ph, rotated, free) {
      // Le kerf n'est ajouté dans une direction que si l'espace restant après
      // la pièce est au moins égal au kerf : cela indique qu'une autre pièce
      // pourrait s'y placer et qu'une coupe sera réellement effectuée.
      // Si le reliquat est inférieur au kerf (minuscule bande inutilisable),
      // la coupe n'est pas nécessaire et le kerf n'est pas consommé.
      const effW = pw + (free.w >= pw + kerf - 1e-9 ? kerf : 0);
      const effH = ph + (free.h >= ph + kerf - 1e-9 ? kerf : 0);
      if (effW > free.w + 1e-6 || effH > free.h + 1e-6) return;
      const leftoverH = free.w - effW;
      const leftoverV = free.h - effH;
      const shortSide = Math.min(leftoverH, leftoverV);
      const longSide = Math.max(leftoverH, leftoverV);
      let primary, secondary;
      switch (heuristic) {
        case 'baf':
          primary = free.w * free.h - effW * effH; secondary = shortSide; break;
        case 'bl':
          primary = free.y + effH; secondary = free.x; break;
        case 'blsf':
          primary = longSide; secondary = shortSide; break;
        case 'bssf':
        default:
          primary = shortSide; secondary = longSide; break;
      }
      if (primary < bestPrimary - 1e-9 ||
          (Math.abs(primary - bestPrimary) < 1e-9 && secondary < bestSecondary - 1e-9)) {
        bestPrimary = primary; bestSecondary = secondary;
        best = {
          x: free.x, y: free.y,
          w: effW, h: effH,           // espace consommé (avec kerf si coupe)
          pieceW: pw, pieceH: ph,      // dimensions réelles de la pièce
          rotated: rotated, shortSide: shortSide, longSide: longSide,
        };
      }
    };
    for (let i = 0; i < self.free.length; i++) {
      const free = self.free[i];
      consider(w, h, false, free);
      if (rotatable) consider(h, w, true, free);
    }
    return best;
  };

  MaxRects.prototype.placeNode = function (node) {
    const newFree = [];
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i];
      if (this.splitFree(f, node, newFree)) {
        // f a été découpé en sous-rectangles ajoutés à newFree
      } else {
        newFree.push(f);
      }
    }
    this.free = newFree;
    this.prune();
    this.placed.push(node);
  };

  MaxRects.prototype.splitFree = function (f, used, out) {
    // Pas d'intersection ?
    if (used.x >= f.x + f.w - 1e-9 || used.x + used.w <= f.x + 1e-9 ||
        used.y >= f.y + f.h - 1e-9 || used.y + used.h <= f.y + 1e-9) {
      return false;
    }
    // Bandes restantes (algorithme MaxRects standard)
    if (used.x < f.x + f.w && used.x + used.w > f.x) {
      if (used.y > f.y) out.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
      if (used.y + used.h < f.y + f.h) out.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - (used.y + used.h) });
    }
    if (used.y < f.y + f.h && used.y + used.h > f.y) {
      if (used.x > f.x) out.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
      if (used.x + used.w < f.x + f.w) out.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - (used.x + used.w), h: f.h });
    }
    return true;
  };

  MaxRects.prototype.prune = function () {
    const fr = this.free;
    for (let i = 0; i < fr.length; i++) {
      for (let j = i + 1; j < fr.length; j++) {
        if (contains(fr[j], fr[i])) { fr.splice(i, 1); i--; break; }
        if (contains(fr[i], fr[j])) { fr.splice(j, 1); j--; }
      }
    }
  };

  function contains(a, b) {
    return a.x <= b.x + 1e-9 && a.y <= b.y + 1e-9 &&
           a.x + a.w >= b.x + b.w - 1e-9 && a.y + a.h >= b.y + b.h - 1e-9;
  }

  /* ------------------------------------------------------------------ *
   * Packing principal multi-plaques / multi-formats
   * ------------------------------------------------------------------ */

  // Une passe de packing pour une stratégie donnée (ordre de tri + heuristique).
  function runPack(blocks, stockList, kerf, margin, heuristic) {
    const stock = stockList.map(function (s, i) {
      const q = (s.qty === Infinity || s.qty === '∞' || s.qty == null || s.qty === '')
        ? Infinity : Math.max(0, parseInt(s.qty, 10) || 0);
      return { idx: i, name: s.name || ('Format ' + (i + 1)), W: parseFloat(s.w), H: parseFloat(s.h), remaining: q };
    }).filter(function (s) { return s.W > 0 && s.H > 0; });

    const bins = [];
    const unplaced = [];

    function usableArea(s) {
      return Math.max(0, s.W - 2 * margin) * Math.max(0, s.H - 2 * margin);
    }

    function openBinFor(bw, bh, rotatable) {
      let chosen = null;
      stock.forEach(function (s) {
        if (s.remaining <= 0) return;
        const uw = s.W - 2 * margin, uh = s.H - 2 * margin;
        const fits = (bw <= uw + 1e-6 && bh <= uh + 1e-6) ||
                     (rotatable && bh <= uw + 1e-6 && bw <= uh + 1e-6);
        if (!fits) return;
        const a = usableArea(s);
        if (!chosen || a > chosen.area) chosen = { s: s, area: a };
      });
      if (!chosen) return null;
      chosen.s.remaining -= 1;
      const bin = {
        stockIdx: chosen.s.idx, stockName: chosen.s.name, W: chosen.s.W, H: chosen.s.H, margin: margin,
        mr: new MaxRects(chosen.s.W - 2 * margin, chosen.s.H - 2 * margin), placements: [],
      };
      bins.push(bin);
      return bin;
    }

    function addPlacement(bin, block, node) {
      bin.mr.placeNode(node);
      bin.placements.push({
        block: block,
        x: node.x + bin.margin, y: node.y + bin.margin,
        // pieceW/H : dimensions réelles (sans kerf) pour le rendu
        w: node.pieceW, h: node.pieceH, rotated: node.rotated,
      });
    }

    blocks.forEach(function (block) {
      const bw = block.bbox.w, bh = block.bbox.h;
      // findNode gère le kerf conditionnel : kerf est passé directement
      // 1. Meilleur emplacement parmi les plaques déjà ouvertes
      let bestBin = null, bestNode = null, bestScore = Infinity;
      for (let i = 0; i < bins.length; i++) {
        const node = bins[i].mr.findNode(bw, bh, block.rotatable, kerf, heuristic);
        if (node) {
          const score = node.shortSide + node.longSide;
          if (score < bestScore) { bestScore = score; bestBin = bins[i]; bestNode = node; }
        }
      }
      if (bestBin) { addPlacement(bestBin, block, bestNode); return; }
      // 2. Nouvelle plaque
      const bin = openBinFor(bw, bh, block.rotatable);
      if (bin) {
        const node = bin.mr.findNode(bw, bh, block.rotatable, kerf, heuristic);
        if (node) { addPlacement(bin, block, node); return; }
      }
      // 3. Non plaçable
      unplaced.push(block);
    });

    let totalPlateArea = 0, totalUsefulArea = 0;
    bins.forEach(function (bin) {
      bin.plateArea = bin.W * bin.H;
      bin.usefulArea = bin.placements.reduce(function (acc, p) { return acc + p.block.area; }, 0);
      totalPlateArea += bin.plateArea;
      totalUsefulArea += bin.usefulArea;
    });
    const wasteArea = totalPlateArea - totalUsefulArea;

    return {
      bins: bins,
      unplaced: unplaced,
      stats: {
        plateCount: bins.length,
        totalPlateArea: totalPlateArea,
        totalUsefulArea: totalUsefulArea,
        wasteArea: wasteArea,
        wasteRate: totalPlateArea > 0 ? wasteArea / totalPlateArea : 0,
        usefulRate: totalPlateArea > 0 ? totalUsefulArea / totalPlateArea : 0,
      },
      params: { kerf: kerf, margin: margin },
    };
  }

  // Ordres de tri candidats
  const SORTERS = {
    maxSide: function (a, b) {
      const ma = Math.max(a.bbox.w, a.bbox.h), mb = Math.max(b.bbox.w, b.bbox.h);
      if (mb !== ma) return mb - ma;
      return b.area - a.area;
    },
    area: function (a, b) { return b.area - a.area; },
    height: function (a, b) {
      if (b.bbox.h !== a.bbox.h) return b.bbox.h - a.bbox.h;
      return b.bbox.w - a.bbox.w;
    },
    width: function (a, b) {
      if (b.bbox.w !== a.bbox.w) return b.bbox.w - a.bbox.w;
      return b.bbox.h - a.bbox.h;
    },
  };

  function pack(pieces, stockList, options) {
    options = options || {};
    const kerf = Math.max(0, parseFloat(options.kerf) || 0);
    const margin = Math.max(0, parseFloat(options.margin) || 0);

    const baseBlocks = expandAndPair(pieces);

    const sorters = ['maxSide', 'area', 'height', 'width'];
    const heuristics = ['bssf', 'baf', 'bl', 'blsf'];

    let best = null;
    sorters.forEach(function (sk) {
      const sorted = baseBlocks.slice().sort(SORTERS[sk]);
      heuristics.forEach(function (h) {
        const res = runPack(sorted, stockList, kerf, margin, h);
        if (isBetter(res, best)) best = res;
      });
    });
    return best || runPack(baseBlocks, stockList, kerf, margin, 'bssf');
  }

  // Critère : moins de pièces non placées, puis moins de plaques, puis moins de chute.
  function isBetter(res, best) {
    if (!best) return true;
    if (res.unplaced.length !== best.unplaced.length) return res.unplaced.length < best.unplaced.length;
    if (res.stats.plateCount !== best.stats.plateCount) return res.stats.plateCount < best.stats.plateCount;
    return res.stats.wasteArea < best.stats.wasteArea - 1e-6;
  }

  /* ------------------------------------------------------------------ *
   * Calcul des polygones absolus d'un placement (pour le rendu)
   *
   * Retourne { parts, cuts } :
   *   parts : [{ poly, color, label, shape }, ...]
   *     Polygones des pièces utiles en coordonnées plaque (mm),
   *     origine en bas-gauche, Y vers le haut.
   *   cuts : [[[x1,y1],[x2,y2]], ...]
   *     Segments de coupe internes (trait de scie diagonal entre deux
   *     triangles appairés). Mêmes coordonnées plaque que les polygones.
   * ------------------------------------------------------------------ */

  function placementPolygons(placement) {
    const block = placement.block;
    const parts = [];
    const cuts = [];
    // Dimensions du bloc dans son repère local (avant rotation)
    const bw = block.bbox.w, bh = block.bbox.h;

    function emit(item) {
      let poly = item.shape.poly.map(function (p) { return p.slice(); });
      let lw = item.shape.bbox.w, lh = item.shape.bbox.h;
      if (placement.rotated) poly = rotatePolyCW90(poly, lw, lh);
      const tx = placement.x, ty = placement.y;
      parts.push({
        poly: poly.map(function (p) { return [p[0] + tx, p[1] + ty]; }),
        color: item.color,
        label: item.name,
        shape: item.shape,
      });
    }

    if (block.kind === 'single') {
      emit(block.item);
    } else if (block.kind === 'composite') {
      // Deux triangles : bl + tr
      block.parts.forEach(function (part) {
        const it = part.item;
        let poly;
        if (part.place === 'tri-bl') {
          poly = [[0, 0], [bw, 0], [0, bh]];
        } else {
          poly = [[bw, 0], [bw, bh], [0, bh]];
        }
        if (placement.rotated) poly = rotatePolyCW90(poly, bw, bh);
        const tx = placement.x, ty = placement.y;
        parts.push({
          poly: poly.map(function (p) { return [p[0] + tx, p[1] + ty]; }),
          color: it.color,
          label: it.name,
          shape: it.shape,
        });
      });

      // Ligne de coupe diagonale entre les deux triangles appairés.
      // En repère local (Y haut) : de (bw, 0) à (0, bh).
      let diagA = [bw, 0], diagB = [0, bh];
      if (placement.rotated) {
        diagA = rotatePolyCW90([diagA], bw, bh)[0];
        diagB = rotatePolyCW90([diagB], bw, bh)[0];
      }
      const tx = placement.x, ty = placement.y;
      cuts.push([
        [diagA[0] + tx, diagA[1] + ty],
        [diagB[0] + tx, diagB[1] + ty],
      ]);
    }
    return { parts: parts, cuts: cuts };
  }

  global.NestingOptimizer = {
    pack: pack,
    buildShape: buildShape,
    expandAndPair: expandAndPair,
    placementPolygons: placementPolygons,
  };

})(typeof window !== 'undefined' ? window : this);
