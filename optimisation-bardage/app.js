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
      wrap.appendChild(buildPlateSVG(bin));
      card.appendChild(wrap);
      card.appendChild(buildCutList(bin));
      plates.appendChild(card);
    });
  }

  function polyPoints(poly, plateH) {
    // SVG Y vers le bas : on inverse
    return poly.map(function (p) { return p[0] + ',' + (plateH - p[1]); }).join(' ');
  }

  function buildPlateSVG(bin) {
    var W = bin.W, H = bin.H;
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'plate');
    svg.setAttribute('viewBox', '-10 -10 ' + (W + 20) + ' ' + (H + 20));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Contour plaque
    var border = document.createElementNS(svgNS, 'rect');
    border.setAttribute('x', 0); border.setAttribute('y', 0);
    border.setAttribute('width', W); border.setAttribute('height', H);
    border.setAttribute('fill', '#ffffff');
    border.setAttribute('stroke', '#9ca3af');
    border.setAttribute('stroke-width', Math.max(2, W / 600));
    svg.appendChild(border);

    var fontSize = Math.max(W, H) / 45;
    var strokeW = Math.max(1.5, W / 900);

    bin.placements.forEach(function (pl) {
      var polys = window.NestingOptimizer.placementPolygons(pl);
      polys.forEach(function (pp) {
        var poly = document.createElementNS(svgNS, 'polygon');
        poly.setAttribute('points', polyPoints(pp.poly, H));
        poly.setAttribute('fill', rgbCss(tint(pp.color, 0.55)));
        poly.setAttribute('stroke', pp.color);
        poly.setAttribute('stroke-width', strokeW);
        poly.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(poly);

        // Étiquette au centroïde
        var cx = 0, cy = 0;
        pp.poly.forEach(function (p) { cx += p[0]; cy += p[1]; });
        cx /= pp.poly.length; cy /= pp.poly.length;
        var txt = document.createElementNS(svgNS, 'text');
        txt.setAttribute('x', cx);
        txt.setAttribute('y', H - cy);
        txt.setAttribute('font-size', fontSize);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dominant-baseline', 'middle');
        txt.setAttribute('fill', '#1f2430');
        txt.setAttribute('font-weight', '600');
        var dimW = Math.round(pp.shape.bbox.w), dimH = Math.round(pp.shape.bbox.h);
        txt.textContent = pp.label + ' (' + dimW + '×' + dimH + ')';
        svg.appendChild(txt);
      });
    });
    return svg;
  }

  function placementSummary(bin) {
    // Regroupe les pièces identiques de la plaque pour le carnet
    var map = {};
    bin.placements.forEach(function (pl) {
      var polys = window.NestingOptimizer.placementPolygons(pl);
      polys.forEach(function (pp) {
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
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var M = 12;
    var res = lastResult;

    // ---- Page de garde / récapitulatif ----
    doc.setFontSize(20); doc.setTextColor('#1f2430');
    doc.text('Carnet de découpe — Calepinage bardage', M, M + 6);
    doc.setFontSize(11); doc.setTextColor('#6b7280');
    doc.text('Généré le ' + new Date().toLocaleString('fr-FR'), M, M + 13);

    var s = res.stats;
    var y = M + 26;
    doc.setFontSize(13); doc.setTextColor('#1f2430');
    doc.text('Synthèse', M, y); y += 7;
    doc.setFontSize(11); doc.setTextColor('#374151');
    var lines = [
      'Plaques utilisées : ' + s.plateCount,
      'Taux de chute : ' + pct(s.wasteRate),
      'Taux d\'utilisation : ' + pct(s.usefulRate),
      'Surface utile : ' + fmtM2(s.totalUsefulArea),
      'Surface chute : ' + fmtM2(s.wasteArea),
      'Trait de scie : ' + res.params.kerf + ' mm · Marge de rive : ' + res.params.margin + ' mm',
    ];
    lines.forEach(function (l) { doc.text(l, M, y); y += 6; });

    if (res.unplaced.length) {
      y += 4;
      doc.setTextColor('#dc2626');
      doc.text('⚠ ' + res.unplaced.length + ' pièce(s) non placée(s) — stock insuffisant.', M, y);
    }

    // ---- Une page par plaque ----
    res.bins.forEach(function (bin, i) {
      doc.addPage();
      doc.setFontSize(15); doc.setTextColor('#1f2430');
      doc.text('Plaque ' + (i + 1) + ' — ' + bin.stockName, M, M + 5);
      doc.setFontSize(10); doc.setTextColor('#6b7280');
      var waste = (bin.plateArea - bin.usefulArea) / bin.plateArea;
      doc.text(fmtMm(bin.W) + ' × ' + fmtMm(bin.H) + '  ·  ' + bin.placements.length + ' pièce(s)  ·  chute ' + pct(waste), M, M + 11);

      drawPlatePDF(doc, bin, M, M + 16, pageW - 2 * M, pageH - (M + 16) - M - 38);
      drawCutListPDF(doc, bin, M, pageH - 36, pageW - 2 * M);
    });

    doc.save('carnet-decoupe-bardage.pdf');
    toast('PDF exporté');
  }

  function drawPlatePDF(doc, bin, x, y, maxW, maxH) {
    var W = bin.W, H = bin.H;
    var scale = Math.min(maxW / W, maxH / H);
    var ox = x + (maxW - W * scale) / 2;
    var oy = y;
    function mapX(px) { return ox + px * scale; }
    function mapY(py) { return oy + (H - py) * scale; } // Y up -> page Y down

    // Contour plaque
    doc.setDrawColor('#9ca3af'); doc.setLineWidth(0.4); doc.setFillColor('#ffffff');
    doc.rect(ox, oy, W * scale, H * scale, 'FD');

    bin.placements.forEach(function (pl) {
      var polys = window.NestingOptimizer.placementPolygons(pl);
      polys.forEach(function (pp) {
        var t = tint(pp.color, 0.55);
        var c = hexToRgb(pp.color);
        doc.setFillColor(t.r, t.g, t.b);
        doc.setDrawColor(c.r, c.g, c.b);
        doc.setLineWidth(0.3);
        // Polygone -> doc.lines (segments relatifs, fermé)
        var pts = pp.poly;
        var startX = mapX(pts[0][0]), startY = mapY(pts[0][1]);
        var deltas = [];
        for (var k = 1; k < pts.length; k++) {
          deltas.push([mapX(pts[k][0]) - mapX(pts[k - 1][0]), mapY(pts[k][1]) - mapY(pts[k - 1][1])]);
        }
        doc.lines(deltas, startX, startY, [1, 1], 'FD', true);

        // Étiquette
        var cx = 0, cy = 0;
        pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
        cx /= pts.length; cy /= pts.length;
        var fs = Math.max(5, Math.min(9, W * scale / 40));
        doc.setFontSize(fs); doc.setTextColor('#1f2430');
        var dimW = Math.round(pp.shape.bbox.w), dimH = Math.round(pp.shape.bbox.h);
        doc.text(pp.label + ' (' + dimW + '×' + dimH + ')', mapX(cx), mapY(cy), { align: 'center', baseline: 'middle' });
      });
    });
  }

  function drawCutListPDF(doc, bin, x, y, maxW) {
    var rows = placementSummary(bin);
    doc.setFontSize(9); doc.setTextColor('#1f2430');
    doc.text('Carnet de découpe', x, y);
    y += 4;
    doc.setFontSize(8); doc.setTextColor('#374151');
    var colW = maxW / 4;
    doc.setFont(undefined, 'bold');
    doc.text('Pièce', x, y); doc.text('Forme', x + colW, y);
    doc.text('Dimensions (mm)', x + 2 * colW, y); doc.text('Qté', x + 3 * colW, y);
    doc.setFont(undefined, 'normal');
    y += 4;
    rows.slice(0, 6).forEach(function (r) {
      doc.text(String(r.label).substr(0, 28), x, y);
      doc.text(typeLabel(r.type), x + colW, y);
      doc.text(shapeDesc(r), x + 2 * colW, y);
      doc.text(String(r.count), x + 3 * colW, y);
      y += 4;
    });
    if (rows.length > 6) doc.text('… +' + (rows.length - 6) + ' autre(s)', x, y);
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
