/* =====================================================================
 * app.js — Interface de l'optimiseur de calepinage bardage
 * ===================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'calepinage-bardage-v1';

  var state = {
    stock: [],
    pieces: [],
    params: { kerf: 3, margin: 0 },
  };
  var lastResult = null;

  /* ---------- Persistance ---------- */
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        state.stock = d.stock || [];
        state.pieces = d.pieces || [];
        state.params = d.params || state.params;
      }
    } catch (e) {}
    if (!state.stock.length) {
      // Exemple de départ
      state.stock = [{ name: 'Trespa 3050×1530', w: 3050, h: 1530, qty: '' }];
      state.pieces = [
        { name: 'Allège', type: 'rectangle', w: 1200, h: 600, qty: 4, color: '#ff671d', rotatable: true },
        { name: 'Rampant', type: 'triangle', base: 800, height: 500, corner: 'bl', qty: 2, color: '#2563eb', rotatable: true },
      ];
    }
  }

  /* ---------- Utilitaires ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function fmtMm(v) { return Math.round(v).toLocaleString('fr-FR') + ' mm'; }
  function fmtM2(mm2) { return (mm2 / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' m²'; }
  function pct(x) { return (x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %'; }

  function hexToRgb(hex) {
    hex = (hex || '#ff671d').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    return { r: parseInt(hex.substr(0, 2), 16), g: parseInt(hex.substr(2, 2), 16), b: parseInt(hex.substr(4, 2), 16) };
  }
  function tint(hex, ratio) {
    var c = hexToRgb(hex);
    return {
      r: Math.round(c.r + (255 - c.r) * ratio),
      g: Math.round(c.g + (255 - c.g) * ratio),
      b: Math.round(c.b + (255 - c.b) * ratio),
    };
  }
  function rgbCss(o) { return 'rgb(' + o.r + ',' + o.g + ',' + o.b + ')'; }

  function pieceDims(p) {
    if (p.type === 'rectangle') return fmtMm(p.w) + ' × ' + fmtMm(p.h);
    if (p.type === 'triangle') return 'base ' + fmtMm(p.base) + ' × h ' + fmtMm(p.height);
    if (p.type === 'trapezoid') return 'B ' + fmtMm(p.B) + ' / b ' + fmtMm(p.b) + ' × h ' + fmtMm(p.h);
    return '';
  }
  function typeLabel(t) {
    return t === 'rectangle' ? 'Rectangle' : t === 'triangle' ? 'Triangle' : 'Trapèze';
  }

  /* ---------- Onglets ---------- */
  function initTabs() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        $('page-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  /* ---------- Stock ---------- */
  function renderStock() {
    var tb = document.querySelector('#stock-table tbody');
    tb.innerHTML = '';
    if (!state.stock.length) {
      tb.appendChild(el('tr', { class: 'empty-row' }, [el('td', { colspan: '5' }, ['Aucune plaque en stock'])]));
      return;
    }
    state.stock.forEach(function (s, i) {
      var del = el('button', { class: 'icon-btn', title: 'Supprimer' }, ['×']);
      del.addEventListener('click', function () { state.stock.splice(i, 1); save(); renderStock(); });
      tb.appendChild(el('tr', {}, [
        el('td', {}, [s.name || ('Format ' + (i + 1))]),
        el('td', {}, [fmtMm(s.w)]),
        el('td', {}, [fmtMm(s.h)]),
        el('td', {}, [s.qty === '' || s.qty == null ? '∞' : String(s.qty)]),
        el('td', {}, [del]),
      ]));
    });
  }

  function initStockForm() {
    $('stock-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var w = parseFloat($('stock-w').value), h = parseFloat($('stock-h').value);
      if (!(w > 0) || !(h > 0)) { toast('Dimensions invalides'); return; }
      var qtyRaw = $('stock-qty').value.trim();
      state.stock.push({
        name: $('stock-name').value.trim(),
        w: w, h: h,
        qty: qtyRaw === '' ? '' : Math.max(1, parseInt(qtyRaw, 10) || 1),
      });
      save(); renderStock();
      this.reset();
      $('stock-name').focus();
    });
  }

  /* ---------- Pièces ---------- */
  function initPieceTypeToggle() {
    var sel = $('piece-type');
    function update() {
      document.querySelectorAll('.piece-fields').forEach(function (f) { f.hidden = true; });
      document.querySelector('.fields-' + sel.value).hidden = false;
    }
    sel.addEventListener('change', update);
    update();
  }

  function renderPieces() {
    var tb = document.querySelector('#piece-table tbody');
    tb.innerHTML = '';
    if (!state.pieces.length) {
      tb.appendChild(el('tr', { class: 'empty-row' }, [el('td', { colspan: '7' }, ['Aucune pièce'])]));
      return;
    }
    state.pieces.forEach(function (p, i) {
      var sw = el('span', { class: 'swatch' });
      sw.style.background = p.color || '#ff671d';
      var del = el('button', { class: 'icon-btn', title: 'Supprimer' }, ['×']);
      del.addEventListener('click', function () { state.pieces.splice(i, 1); save(); renderPieces(); });
      tb.appendChild(el('tr', {}, [
        el('td', {}, [sw]),
        el('td', {}, [p.name || ('Pièce ' + (i + 1))]),
        el('td', {}, [typeLabel(p.type)]),
        el('td', {}, [pieceDims(p)]),
        el('td', {}, [String(p.qty || 1)]),
        el('td', {}, [p.rotatable !== false ? '↻' : '—']),
        el('td', {}, [del]),
      ]));
    });
  }

  function initPieceForm() {
    $('piece-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var type = $('piece-type').value;
      var p = {
        name: $('piece-name').value.trim(),
        type: type,
        qty: Math.max(1, parseInt($('piece-qty').value, 10) || 1),
        color: $('piece-color').value,
        rotatable: $('piece-rot').checked,
      };
      if (type === 'rectangle') {
        p.w = parseFloat($('rect-w').value); p.h = parseFloat($('rect-h').value);
        if (!(p.w > 0) || !(p.h > 0)) { toast('Dimensions invalides'); return; }
      } else if (type === 'triangle') {
        p.base = parseFloat($('tri-base').value); p.height = parseFloat($('tri-height').value);
        p.corner = $('tri-corner').value;
        if (!(p.base > 0) || !(p.height > 0)) { toast('Dimensions invalides'); return; }
      } else {
        p.B = parseFloat($('trap-B').value); p.b = parseFloat($('trap-b').value); p.h = parseFloat($('trap-h').value);
        if (!(p.B > 0) || !(p.b > 0) || !(p.h > 0)) { toast('Dimensions invalides'); return; }
      }
      state.pieces.push(p);
      save(); renderPieces();
      // Conserver type/couleur, vider le reste
      $('piece-name').value = '';
      ['rect-w', 'rect-h', 'tri-base', 'tri-height', 'trap-B', 'trap-b', 'trap-h'].forEach(function (id) { $(id).value = ''; });
      $('piece-qty').value = '1';
      $('piece-name').focus();
    });
  }

  /* ---------- Réglages ---------- */
  function initParams() {
    $('param-kerf').value = state.params.kerf;
    $('param-margin').value = state.params.margin;
    $('param-kerf').addEventListener('input', function () { state.params.kerf = parseFloat(this.value) || 0; save(); });
    $('param-margin').addEventListener('input', function () { state.params.margin = parseFloat(this.value) || 0; save(); });

    $('btn-reset').addEventListener('click', function () {
      if (confirm('Effacer toutes les données ?')) {
        state.stock = []; state.pieces = [];
        save(); renderStock(); renderPieces();
        toast('Données effacées');
      }
    });
    $('btn-export-json').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var a = el('a', { href: URL.createObjectURL(blob), download: 'calepinage-sauvegarde.json' });
      document.body.appendChild(a); a.click(); a.remove();
    });
    $('btn-import-json').addEventListener('click', function () { $('file-import').click(); });
    $('file-import').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var d = JSON.parse(r.result);
          state.stock = d.stock || []; state.pieces = d.pieces || []; state.params = d.params || state.params;
          save(); renderStock(); renderPieces(); initParams();
          toast('Import réussi');
        } catch (err) { toast('Fichier invalide'); }
      };
      r.readAsText(f);
    });
  }

  /* ---------- Optimisation ---------- */
  function runOptimize() {
    if (!state.stock.length) { toast('Ajoutez au moins une plaque en stock'); return; }
    if (!state.pieces.length) { toast('Ajoutez au moins une pièce à découper'); return; }
    lastResult = window.NestingOptimizer.pack(state.pieces, state.stock, state.params);
    renderResult(lastResult);
    $('btn-pdf').disabled = lastResult.bins.length === 0;
    toast('Calepinage calculé : ' + lastResult.bins.length + ' plaque(s)');
  }

  function statBox(val, lbl, cls) {
    return el('div', { class: 'stat ' + (cls || '') }, [
      el('div', { class: 'val' }, [val]),
      el('div', { class: 'lbl' }, [lbl]),
    ]);
  }

  function renderResult(res) {
    var sum = $('summary');
    sum.innerHTML = '';
    var s = res.stats;
    var wasteCls = s.wasteRate < 0.15 ? 'good' : s.wasteRate < 0.3 ? 'warn' : 'bad';
    sum.appendChild(statBox(String(s.plateCount), 'Plaques utilisées', ''));
    sum.appendChild(statBox(pct(s.wasteRate), 'Taux de chute', wasteCls));
    sum.appendChild(statBox(pct(s.usefulRate), 'Taux d\'utilisation', 'good'));
    sum.appendChild(statBox(fmtM2(s.totalUsefulArea), 'Surface utile', ''));
    sum.appendChild(statBox(fmtM2(s.wasteArea), 'Surface chute', ''));

    var plates = $('plates');
    plates.innerHTML = '';

    if (res.unplaced.length) {
      var names = res.unplaced.map(function (b) { return b.name + ' (' + Math.round(b.bbox.w) + '×' + Math.round(b.bbox.h) + ')'; });
      plates.appendChild(el('div', { class: 'warn-box' }, [
        el('strong', {}, ['⚠ ' + res.unplaced.length + ' pièce(s) non placée(s) : ']),
        document.createTextNode(names.join(', ') + '. Aucun format de stock disponible ne peut les contenir (vérifiez les dimensions ou ajoutez du stock).'),
      ]));
    }

    res.bins.forEach(function (bin, i) {
      var waste = (bin.plateArea - bin.usefulArea) / bin.plateArea;
      var card = el('div', { class: 'plate-card' });
      card.appendChild(el('div', { class: 'plate-head' }, [
        el('h3', {}, ['Plaque ' + (i + 1) + ' — ' + bin.stockName]),
        el('div', { class: 'meta' }, [fmtMm(bin.W) + ' × ' + fmtMm(bin.H) + ' · ' + bin.placements.length + ' pièce(s) · chute ' + pct(waste)]),
      ]));
      var wrap = el('div', { class: 'plate-svg-wrap' });
      wrap.appendChild(buildPlateSVG(bin, res.params.kerf));
      card.appendChild(wrap);
      card.appendChild(buildCutList(bin));
      plates.appendChild(card);
    });
  }

  function svgEl(ns, tag, attrs) {
    var n = document.createElementNS(ns, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function polyPoints(poly, plateH) {

  // Dessine une ligne de cotation dans le SVG.
  // (x1,y1)-(x2,y2) : extrémités en coordonnées SVG (Y bas).
  // dir : 'h' (horizontale) ou 'v' (verticale) pour orienter le texte.
  function svgDimLine(svg, svgNS, x1, y1, x2, y2, label, dir, fs) {
    var color = '#1f2430';
    var lw = Math.max(fs * 0.045, 1);
    var tick = fs * 0.42;
    var g = svgEl(svgNS, 'g', {});

    // Ligne principale
    g.appendChild(svgEl(svgNS, 'line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: color, 'stroke-width': lw }));
    // Tirets perpendiculaires aux extrémités
    if (dir === 'h') {
      g.appendChild(svgEl(svgNS, 'line', { x1: x1, y1: y1 - tick, x2: x1, y2: y1 + tick, stroke: color, 'stroke-width': lw }));
      g.appendChild(svgEl(svgNS, 'line', { x1: x2, y1: y2 - tick, x2: x2, y2: y2 + tick, stroke: color, 'stroke-width': lw }));
      // Texte centré sous la ligne (halo blanc pour lisibilité sur tout fond)
      var tx = (x1 + x2) / 2, ty = y1 + fs * 0.78;
      var txtEl = svgEl(svgNS, 'text', {
        x: tx, y: ty, 'font-size': fs, 'text-anchor': 'middle', fill: color, 'dominant-baseline': 'middle',
        'paint-order': 'stroke', stroke: 'white', 'stroke-width': fs * 0.38, 'stroke-linejoin': 'round',
      });
      txtEl.textContent = label;
      g.appendChild(txtEl);
    } else {
      g.appendChild(svgEl(svgNS, 'line', { x1: x1 - tick, y1: y1, x2: x1 + tick, y2: y1, stroke: color, 'stroke-width': lw }));
      g.appendChild(svgEl(svgNS, 'line', { x1: x2 - tick, y1: y2, x2: x2 + tick, y2: y2, stroke: color, 'stroke-width': lw }));
      // Texte vertical (rotation -90°), halo blanc
      var midX = x1 + fs * 0.78, midY = (y1 + y2) / 2;
      var txtElV = svgEl(svgNS, 'text', {
        x: midX, y: midY, 'font-size': fs, 'text-anchor': 'middle', fill: color, 'dominant-baseline': 'middle',
        transform: 'rotate(-90,' + midX + ',' + midY + ')',
        'paint-order': 'stroke', stroke: 'white', 'stroke-width': fs * 0.38, 'stroke-linejoin': 'round',
      });
      txtElV.textContent = label;
      g.appendChild(txtElV);
    }
    svg.appendChild(g);
  }

  // Ajoute les cotations d'un placement (largeur et hauteur de la boîte englobante)
  function svgDimAnnotations(svg, svgNS, pl, plateH, fs) {
    var px = pl.x, py = pl.y, pw = pl.w, ph = pl.h;
    var gap = Math.max(fs * 0.48, 5);
    // Largeur : ligne horizontale sous la pièce
    var yDim = plateH - py + gap;
    svgDimLine(svg, svgNS, px, yDim, px + pw, yDim, Math.round(pw) + ' mm', 'h', fs);
    // Hauteur : ligne verticale à droite de la pièce
    var xDim = px + pw + gap;
    var sy1 = plateH - py;
    var sy2 = plateH - py - ph;
    svgDimLine(svg, svgNS, xDim, sy1, xDim, sy2, Math.round(ph) + ' mm', 'v', fs);
  }

  function buildPlateSVG(bin, kerf) {
    var W = bin.W, H = bin.H;
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'plate');
    var pad = Math.max(W, H) / 10;
    svg.setAttribute('viewBox', (-pad) + ' ' + (-pad) + ' ' + (W + pad * 2) + ' ' + (H + pad * 2));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    svg.appendChild(svgEl(svgNS, 'rect', {
      x: 0, y: 0, width: W, height: H,
      fill: '#ffffff', stroke: '#9ca3af', 'stroke-width': Math.max(2, W / 600),
    }));

    var fontSize = Math.max(W, H) / 45;
    var annoFont = Math.max(fontSize * 0.6, 16);
    var strokeW = Math.max(1.5, W / 900);

    // Pré-calcul des résultats (évite d'appeler placementPolygons 3 fois par placement)
    var allResults = bin.placements.map(function (pl) {
      return { pl: pl, r: window.NestingOptimizer.placementPolygons(pl) };
    });

    // PASSE 1 : polygones et noms (fond)
    allResults.forEach(function (item) {
      item.r.parts.forEach(function (pp) {
        svg.appendChild(Object.assign(svgEl(svgNS, 'polygon', {
          points: polyPoints(pp.poly, H),
          fill: rgbCss(tint(pp.color, 0.55)),
          stroke: pp.color, 'stroke-width': strokeW, 'stroke-linejoin': 'round',
        })));
        var cx = 0, cy = 0;
        pp.poly.forEach(function (p) { cx += p[0]; cy += p[1]; });
        cx /= pp.poly.length; cy /= pp.poly.length;
        var txt = svgEl(svgNS, 'text', {
          x: cx, y: H - cy, 'font-size': fontSize, 'text-anchor': 'middle',
          'dominant-baseline': 'middle', fill: '#1f2430', 'font-weight': '600',
          'paint-order': 'stroke', stroke: 'rgba(255,255,255,0.7)', 'stroke-width': fontSize * 0.3,
        });
        txt.textContent = pp.label;
        svg.appendChild(txt);
      });
    });

    // PASSE 2 : traits de scie (au-dessus des polygones)
    allResults.forEach(function (item) {
      item.r.cuts.forEach(function (cut) {
        var kw = Math.max(kerf || 1, 1);
        // Contour gris puis blanc = gap visuel du trait de scie
        svg.appendChild(svgEl(svgNS, 'line', {
          x1: cut[0][0], y1: H - cut[0][1], x2: cut[1][0], y2: H - cut[1][1],
          stroke: 'rgba(80,80,80,0.5)', 'stroke-width': kw + 1.5, 'stroke-linecap': 'butt',
        }));
        svg.appendChild(svgEl(svgNS, 'line', {
          x1: cut[0][0], y1: H - cut[0][1], x2: cut[1][0], y2: H - cut[1][1],
          stroke: '#f5f6f8', 'stroke-width': kw, 'stroke-linecap': 'butt',
        }));
      });
    });

    // PASSE 3 : cotations (toujours au premier plan, au-dessus de tout)
    allResults.forEach(function (item) {
      svgDimAnnotations(svg, svgNS, item.pl, H, annoFont);
    });

    return svg;
  }

  function placementSummary(bin) {
    var map = {};
    bin.placements.forEach(function (pl) {
      var result = window.NestingOptimizer.placementPolygons(pl);
      result.parts.forEach(function (pp) {
        var key = pp.label + '|' + pp.shape.type + '|' + Math.round(pp.shape.bbox.w) + '|' + Math.round(pp.shape.bbox.h);
        if (!map[key]) {
          map[key] = { label: pp.label, type: pp.shape.type, w: pp.shape.bbox.w, h: pp.shape.bbox.h, count: 0, shape: pp.shape };
        }
        map[key].count++;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function shapeDesc(item) {
    if (item.type === 'rectangle') return 'Rectangle ' + Math.round(item.w) + '×' + Math.round(item.h);
    if (item.type === 'triangle') return 'Triangle base ' + Math.round(item.shape.bbox.w) + ' × h ' + Math.round(item.shape.bbox.h);
    if (item.type === 'trapezoid') return 'Trapèze B' + Math.round(item.shape.B) + '/b' + Math.round(item.shape.b) + ' × h ' + Math.round(item.shape.h);
    return Math.round(item.w) + '×' + Math.round(item.h);
  }

  function buildCutList(bin) {
    var rows = placementSummary(bin);
    var table = el('table', { class: 'cut-list' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', {}, ['Pièce']), el('th', {}, ['Forme']), el('th', {}, ['Dimensions (mm)']), el('th', {}, ['Qté']),
    ])]));
    var tb = el('tbody');
    rows.forEach(function (r) {
      tb.appendChild(el('tr', {}, [
        el('td', {}, [r.label]),
        el('td', {}, [typeLabel(r.type)]),
        el('td', {}, [shapeDesc(r)]),
        el('td', {}, [String(r.count)]),
      ]));
    });
    table.appendChild(tb);
    return table;
  }

  /* ---------- Export PDF ---------- */
  function exportPDF() {
    if (!lastResult || !lastResult.bins.length) { toast('Lancez d\'abord l\'optimisation'); return; }
    if (!window.jspdf) { toast('Librairie PDF non chargée'); return; }
    var jsPDF = window.jspdf.jsPDF;
    var res = lastResult;
    var M = 12;

    // Format portrait A4
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();

    // ---- Page 1 : récapitulatif ----
    pdfHeader(doc, 'Carnet de découpe — Calepinage bardage', M);
    doc.setFontSize(10); doc.setTextColor(107, 114, 128);
    doc.text('Généré le ' + new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }), M, M + 11);

    var s = res.stats;
    var y = M + 22;
    pdfSectionTitle(doc, 'Synthèse', M, y); y += 7;
    doc.setFontSize(10); doc.setTextColor(55, 65, 81);
    var statLines = [
      'Plaques utilisées : ' + s.plateCount + '   |   Taux de chute : ' + pct(s.wasteRate) + '   |   Taux d\'utilisation : ' + pct(s.usefulRate),
      'Surface utile : ' + fmtM2(s.totalUsefulArea) + '   |   Surface chute : ' + fmtM2(s.wasteArea),
      'Trait de scie : ' + res.params.kerf + ' mm   |   Marge de rive : ' + res.params.margin + ' mm',
    ];
    statLines.forEach(function (l) { doc.text(l, M, y); y += 5.5; });

    if (res.unplaced.length) {
      y += 3;
      doc.setTextColor(220, 38, 38);
      doc.setFontSize(10);
      doc.text('Attention : ' + res.unplaced.length + ' piece(s) non placee(s) — stock insuffisant.', M, y);
      y += 6;
    }

    y += 4;
    pdfSectionTitle(doc, 'Contenu des plaques', M, y); y += 7;
    doc.setFontSize(9); doc.setTextColor(55, 65, 81);
    res.bins.forEach(function (bin, i) {
      var waste = (bin.plateArea - bin.usefulArea) / bin.plateArea;
      doc.text(
        'Plaque ' + (i + 1) + ' — ' + bin.stockName + '  (' + Math.round(bin.W) + ' × ' + Math.round(bin.H) + ' mm)'
        + '  ·  ' + bin.placements.length + ' piece(s)'
        + '  ·  chute ' + pct(waste),
        M, y
      );
      y += 5;
    });

    // ---- Une page par plaque ----
    res.bins.forEach(function (bin, i) {
      doc.addPage();
      var waste = (bin.plateArea - bin.usefulArea) / bin.plateArea;

      pdfHeader(doc, 'Plaque ' + (i + 1) + ' / ' + res.bins.length + ' — ' + bin.stockName, M);
      doc.setFontSize(9); doc.setTextColor(107, 114, 128);
      doc.text(
        Math.round(bin.W) + ' × ' + Math.round(bin.H) + ' mm'
        + '   |   ' + bin.placements.length + ' piece(s)'
        + '   |   Utilisation : ' + pct(1 - waste)
        + '   |   Chute : ' + pct(waste),
        M, M + 11
      );

      // Zone de dessin : toute la largeur, hauteur disponible moins le carnet en bas
      var rows = placementSummary(bin);
      var cutListH = 8 + rows.length * 4.5 + 2;
      if (cutListH > 50) cutListH = 50; // max 50 mm pour le carnet
      var drawAreaY = M + 16;
      var drawAreaH = pageH - drawAreaY - cutListH - M;

      drawPlatePDF(doc, bin, M, drawAreaY, pageW - 2 * M, drawAreaH, res.params.kerf);

      // Carnet de découpe sous le schéma
      var cutY = pageH - cutListH - M + 3;
      drawCutListPDF(doc, bin, M, cutY, pageW - 2 * M);
    });

    doc.save('carnet-decoupe-bardage.pdf');
    toast('PDF exporté — ' + res.bins.length + ' plaque(s)');
  }

  function pdfHeader(doc, title, M) {
    doc.setFontSize(14); doc.setTextColor(31, 36, 48);
    doc.setFont(undefined, 'bold');
    doc.text(title, M, M + 5);
    doc.setFont(undefined, 'normal');
  }

  function pdfSectionTitle(doc, title, x, y) {
    doc.setFontSize(10); doc.setTextColor(31, 36, 48);
    doc.setFont(undefined, 'bold');
    doc.text(title, x, y);
    doc.setFont(undefined, 'normal');
  }

  // Dessine un polygone dans le PDF via doc.lines (segments relatifs, chemin fermé).
  function pdfPolygon(doc, mapX, mapY, pts, style) {
    var startX = mapX(pts[0][0]), startY = mapY(pts[0][1]);
    var deltas = [];
    for (var k = 1; k < pts.length; k++) {
      deltas.push([mapX(pts[k][0]) - mapX(pts[k - 1][0]), mapY(pts[k][1]) - mapY(pts[k - 1][1])]);
    }
    deltas.push([startX - mapX(pts[pts.length - 1][0]), startY - mapY(pts[pts.length - 1][1])]);
    doc.lines(deltas, startX, startY, [1, 1], style);
  }

  function drawPlatePDF(doc, bin, x, y, maxW, maxH, kerf) {
    var W = bin.W, H = bin.H;
    // Réserver de la place pour les cotations extérieures
    var annoPad = 10;
    var scale = Math.min((maxW - annoPad) / W, (maxH - annoPad) / H);
    var drawnW = W * scale, drawnH = H * scale;
    var ox = x + annoPad / 2 + (maxW - annoPad - drawnW) / 2;
    var oy = y;

    function mapX(px) { return ox + px * scale; }
    function mapY(py) { return oy + (H - py) * scale; } // Y up -> PDF Y down

    // Fond et contour de la plaque
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(156, 163, 175);
    doc.setLineWidth(0.5);
    doc.rect(ox, oy, drawnW, drawnH, 'FD');

    // Marge de rive
    if (bin.margin > 0) {
      doc.setDrawColor(229, 231, 235);
      doc.setLineWidth(0.2);
      doc.rect(ox + bin.margin * scale, oy + bin.margin * scale,
               (W - 2 * bin.margin) * scale, (H - 2 * bin.margin) * scale, 'S');
    }

    // Tailles de police et dimensions des cotations proportionnelles au dessin
    var pieceFs = Math.max(10, Math.min(14, drawnW / 10));
    var dimFs   = Math.max(8,  Math.min(11, drawnW / 14));
    var gap     = Math.max(2, drawnW / 55);   // écart entre pièce et ligne de cote (mm PDF)
    var tick    = Math.max(1, drawnW / 80);   // longueur des tirets perpendiculaires (mm PDF)
    var annoLW  = Math.max(0.25, drawnW / 650);

    // Pré-calcul des polygones pour les 3 passes
    var allResults = bin.placements.map(function (pl) {
      return { pl: pl, r: window.NestingOptimizer.placementPolygons(pl) };
    });

    // PASSE 1 : polygones et noms (fond)
    allResults.forEach(function (item) {
      item.r.parts.forEach(function (pp) {
        var t = tint(pp.color, 0.55), c = hexToRgb(pp.color);
        doc.setFillColor(t.r, t.g, t.b);
        doc.setDrawColor(c.r, c.g, c.b);
        doc.setLineWidth(0.3);
        pdfPolygon(doc, mapX, mapY, pp.poly, 'FD');

        var cx = 0, cy = 0;
        pp.poly.forEach(function (p) { cx += p[0]; cy += p[1]; });
        cx /= pp.poly.length; cy /= pp.poly.length;
        doc.setFontSize(pieceFs);
        doc.setTextColor(31, 36, 48);
        doc.text(pp.label, mapX(cx), mapY(cy) + pieceFs * 0.18, { align: 'center' });
      });
    });

    // PASSE 2 : traits de scie (au-dessus des polygones)
    allResults.forEach(function (item) {
      item.r.cuts.forEach(function (cut) {
        var kw = Math.max((kerf || 0) * scale, 0.6);
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(kw + 0.4);
        doc.line(mapX(cut[0][0]), mapY(cut[0][1]), mapX(cut[1][0]), mapY(cut[1][1]));
        doc.setDrawColor(245, 246, 248);
        doc.setLineWidth(kw);
        doc.line(mapX(cut[0][0]), mapY(cut[0][1]), mapX(cut[1][0]), mapY(cut[1][1]));
      });
    });

    // PASSE 3 : cotations (toujours au premier plan)
    allResults.forEach(function (item) {
      var pl = item.pl;
      var px = pl.x, py = pl.y, pw = pl.w, ph = pl.h;

      // Largeur : ligne horizontale sous le bas de la pièce
      var yDim = mapY(py) + gap;
      doc.setDrawColor(55, 65, 81); doc.setLineWidth(annoLW);
      doc.line(mapX(px), yDim, mapX(px + pw), yDim);
      doc.line(mapX(px), yDim - tick, mapX(px), yDim + tick);
      doc.line(mapX(px + pw), yDim - tick, mapX(px + pw), yDim + tick);
      doc.setFontSize(dimFs); doc.setTextColor(55, 65, 81);
      doc.text(Math.round(pw) + ' mm', (mapX(px) + mapX(px + pw)) / 2, yDim + gap * 0.7, { align: 'center' });

      // Hauteur : ligne verticale à droite de la pièce
      var xDim = mapX(px + pw) + gap;
      var yTop = mapY(py + ph), yBot = mapY(py);
      doc.setDrawColor(55, 65, 81); doc.setLineWidth(annoLW);
      doc.line(xDim, yTop, xDim, yBot);
      doc.line(xDim - tick, yTop, xDim + tick, yTop);
      doc.line(xDim - tick, yBot, xDim + tick, yBot);
      doc.setFontSize(dimFs); doc.setTextColor(55, 65, 81);
      doc.text(Math.round(ph) + ' mm', xDim + gap * 0.7, (yTop + yBot) / 2,
               { align: 'center', angle: 90 });
    });
  }

  function drawCutListPDF(doc, bin, x, y, maxW) {
    var rows = placementSummary(bin);
    pdfSectionTitle(doc, 'Carnet de decoupe', x, y);
    y += 4.5;

    doc.setFontSize(7.5); doc.setTextColor(55, 65, 81);
    var cols = [0, maxW * 0.32, maxW * 0.58, maxW * 0.82];
    var headers = ['Pièce', 'Forme / Dimensions', 'Cote (mm)', 'Qté'];

    doc.setFont(undefined, 'bold');
    headers.forEach(function (h, j) { doc.text(h, x + cols[j], y); });
    doc.setFont(undefined, 'normal');
    y += 4;

    rows.forEach(function (r) {
      if (y > doc.internal.pageSize.getHeight() - 8) return; // sécurité bas de page
      doc.text(String(r.label).substring(0, 30), x + cols[0], y);
      doc.text(typeLabel(r.type), x + cols[1], y);
      doc.text(shapeDesc(r), x + cols[2], y);
      doc.text(String(r.count), x + cols[3], y);
      y += 4;
    });
  }

  /* ---------- Init ---------- */
  function init() {
    load();
    initTabs();
    initStockForm();
    initPieceForm();
    initPieceTypeToggle();
    initParams();
    renderStock();
    renderPieces();
    $('btn-optimize').addEventListener('click', runOptimize);
    $('btn-pdf').addEventListener('click', exportPDF);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
