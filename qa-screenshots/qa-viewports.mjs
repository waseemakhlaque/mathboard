// One-off viewport QA — run: npx playwright install webkit chromium firefox && node qa-screenshots/qa-viewports.mjs
import { chromium, firefox, webkit, devices } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.QA_URL || 'http://127.0.0.1:8790/';
const OUT = __dirname;

function scanForbidden(html) {
  const hits = [];
  for (const re of [/upgrade/i, /paywall/i, /£\s*9/, /\bstripe\b/i, /\bcheckout\b/i, /pro-badge/i]) {
    if (re.test(html)) hits.push(re.source);
  }
  // Allow "Protractor", "projectile", "proprietary", "progress", "profile"
  const badPro = html.match(/\bPro\b(?!tractor)/g);
  if (badPro && /MathBoard Pro|Upgrade to Pro|🔒.*Pro|Pro ✓|Pro active|Pro preview/i.test(html)) {
    hits.push('Pro marketing');
  }
  return hits;
}

async function shot(page, name, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(800);
  const html = await page.content();
  const hits = scanForbidden(html);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  // layout clip check: horizontal overflow
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, bodyW: document.body?.scrollWidth };
  });
  const clipped = overflow.scrollW > overflow.clientW + 2;
  return { name, file, hits, clipped, overflow, consoleErrs: errs };
}

const results = [];

// 1. Desktop Chrome 1920x1080
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrs = [];
  page.on('pageerror', (e) => pageErrs.push(String(e.message || e)));
  const r = await shot(page, '01-chrome-1920x1080', 1920, 1080);
  r.consoleErrs = pageErrs;
  // DOM Ctrl+F "pgrade"
  r.pgrade = await page.evaluate(() => document.body?.innerText?.includes('pgrade') || document.body?.innerHTML?.includes('pgrade'));
  results.push(r);
  await browser.close();
}

// 1b. Firefox 1920x1080
{
  const browser = await firefox.launch();
  const page = await browser.newPage();
  const r = await shot(page, '02-firefox-1920x1080', 1920, 1080);
  r.pgrade = await page.evaluate(() => (document.body?.innerHTML || '').includes('pgrade'));
  results.push(r);
  await browser.close();
}

// 2. iPad Pro 11 landscape (WebKit device)
{
  const ipad = devices['iPad Pro 11'];
  const browser = await webkit.launch();
  const context = await browser.newContext({
    ...ipad,
    viewport: { width: 1194, height: 834 }, // landscape
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(800);
  const html = await page.content();
  const file = path.join(OUT, '03-ipad-pro11-landscape.png');
  await page.screenshot({ path: file, fullPage: false });
  results.push({
    name: '03-ipad-pro11-landscape',
    file,
    hits: scanForbidden(html),
    pgrade: html.includes('pgrade'),
    clipped: false,
  });
  await browser.close();
}

// 3. Android tablet ~1280x800
{
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 12; SM-T870) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  const r = await shot(page, '04-android-tablet-1280x800', 1280, 800);
  results.push(r);
  await browser.close();
}

// 4. Low-end 1366x768
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const r = await shot(page, '05-pc-1366x768', 1366, 768);
  results.push(r);
  await browser.close();
}

// 5. Offline reload (Chromium)
{
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(500);
  await context.setOffline(true);
  let offlineOk = false;
  let offlineErr = '';
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    offlineOk = true;
  } catch (e) {
    offlineErr = String(e.message || e);
  }
  const file = path.join(OUT, '06-offline-reload.png');
  try { await page.screenshot({ path: file, fullPage: false }); } catch { /* ok */ }
  const html = offlineOk ? await page.content().catch(() => '') : '';
  results.push({
    name: '06-offline-reload',
    file,
    hits: html ? scanForbidden(html) : [],
    offlineOk,
    offlineErr,
    note: 'python http.server has no SW; offline reload may FAIL locally — retest under wrangler/production PWA',
  });
  await browser.close();
}

const report = path.join(OUT, 'QA-REPORT.md');
let md = `# Cross-device QA\n\nBase: ${BASE}\nDate: ${new Date().toISOString()}\n\n| Case | Result | Notes | Screenshot |\n|---|---|---|---|\n`;
for (const r of results) {
  const bad = (r.hits && r.hits.length) || r.pgrade || r.clipped;
  const status = bad ? 'FAIL' : (r.name.includes('offline') && !r.offlineOk ? 'FAIL*' : 'PASS');
  const notes = [
    r.hits?.length ? `forbidden: ${r.hits.join(',')}` : '',
    r.pgrade ? 'DOM has "pgrade"' : '',
    r.clipped ? `clipped scrollW=${r.overflow?.scrollW}` : '',
    r.consoleErrs?.length ? `console: ${r.consoleErrs.slice(0, 2).join(';')}` : '',
    r.offlineErr || '',
    r.note || '',
  ].filter(Boolean).join(' · ') || 'clean gate/shell';
  md += `| ${r.name} | ${status} | ${notes} | \`${path.basename(r.file)}\` |\n`;
}
md += `\n\\* Offline under \`python3 -m http.server\` has no service worker (disabled on localhost by design). Retest on deployed Worker.\n`;
md += `\n**Login / draw / papers / RAG:** not exercised — no test credentials in env. Structural note for Claude Code if needed.\n`;
fs.writeFileSync(report, md);
console.log(md);
