import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', (msg) => {
    try {
      const text = msg.text();
      logs.push({ type: msg.type(), text });
      console.log('[BROWSER]', msg.type(), text);
    } catch (e) {}
  });

  // adjust URL if Vite dev is on non-default port
  const url = 'http://localhost:5173/';
  console.log('Navigating to', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // wait for the MapView to render a country list (approx)
  await page.waitForSelector('.text-xl', { timeout: 15000 }).catch(()=>{});

  // click first country polygon by simulating a click on the map canvas
  // maplibre uses a canvas inside the map container; try clicking center
  const mapSelector = '#map-'; // map container has dynamic id; click the center of viewport
  await page.mouse.click(page.viewportSize().width / 2, page.viewportSize().height / 2);
  await page.waitForTimeout(1000);

  // alternatively click the first pattern card in the side panel after selection
  const countryPanelSelector = '.rounded-2xl.border';
  // try to click a country tile in the list if it exists
  const panel = await page.$(countryPanelSelector);
  if (panel) {
    // scroll panel to bottom to trigger lazy loading
    await page.evaluate(() => {
      const el = document.querySelector('.rounded-2xl.border.border-zinc-800.bg-zinc-900\/40.p-3');
      if (el) el.scrollIntoView();
      const scrollEl = document.querySelector('[class*="overflow-y-auto"]');
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  }

  // wait a bit for lazy loads
  await page.waitForTimeout(3000);

  console.log('Collected logs:', logs.length);

  // count our TileSVG mini summary messages
  const tileLogs = logs.filter(l => l.text && l.text.includes('[TileSVG] mini summary'));
  console.log('Tile summary logs found:', tileLogs.length);
  for (const t of tileLogs.slice(0, 10)) console.log(' ->', t.text);

  await browser.close();
})();