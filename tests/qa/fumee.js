// Test de fumée : l'application démarre, tous les onglets s'ouvrent, aucune
// erreur console. C'est le garde-fou minimal avant tout commit.
const { chromium } = require('playwright');
const { CHROME, URL, bilan } = require('../harness/repro-sync.js');
const SEED = require('../seeds/liss.js');

(async () => {
  const b = bilan();
  const nav = await chromium.launch({ executablePath: CHROME });
  const errs = [];

  for (const [nom, graine] of [['chantier neuf', null], ['chantier garni', SEED], ['données héritées', SEED.herite()]]) {
    const ctx = await nav.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('[' + nom + '] PAGEERROR: ' + e.message));
    page.on('console', m => {
      const t = m.text();
      if (m.type() === 'error' && !/Supabase|net::ERR|Failed to load|jsdelivr|CDN/.test(t)) errs.push('[' + nom + '] CONSOLE: ' + t);
    });
    if (graine) await page.addInitScript(s => localStorage.setItem('chantier_v1', JSON.stringify(s)), graine);
    await page.goto(URL);
    await page.waitForTimeout(900);

    const onglets = await page.$$eval('.tab-btn[data-page]', els => els.map(e => e.dataset.page));
    b.chk(nom + ' : les onglets sont là', onglets.length > 3, onglets.length);
    for (const o of onglets) {
      await page.click('.tab-btn[data-page="' + o + '"]');
      await page.waitForTimeout(180);
      // chaque sous-onglet du groupe visible
      const subs = await page.$$eval('.seg-btn[data-group][data-sub]:not([hidden])', els =>
        els.filter(e => e.offsetParent !== null).map(e => e.dataset.group + '/' + e.dataset.sub));
      for (const s of subs) {
        const [g, sub] = s.split('/');
        await page.click('.seg-btn[data-group="' + g + '"][data-sub="' + sub + '"]').catch(() => {});
        await page.waitForTimeout(120);
      }
    }
    b.chk(nom + ' : tous les onglets et sous-onglets s\'ouvrent', true, onglets.length);

    // La barre des relevés doit exister dans Avancement > Avancement.
    await page.click('.tab-btn[data-page="avancement"]');
    await page.click('.seg-btn[data-group="avancement"][data-sub="fiche"]');
    await page.waitForTimeout(400);
    b.chk(nom + ' : la barre des relevés est rendue',
      (await page.$$eval('#relevesbar .releve-courant', e => e.length)) === 1);

    // Pas de débordement horizontal, sur mobile comme sur PC.
    for (const w of [390, 768, 1440]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => ({ body: document.body.scrollWidth, vw: innerWidth }));
      b.chk(nom + ' : ' + w + 'px sans débordement', m.body <= m.vw + 1, m);
    }
    await ctx.close();
  }

  const code = b.fin(errs);
  await nav.close();
  process.exit(code);
})();
