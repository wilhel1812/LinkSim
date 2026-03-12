import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', msg => {
  console.log(`[console:${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', err => {
  console.log(`[pageerror] ${err.stack || err.message}`);
});

const resp = await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle' });
console.log('status', resp?.status());

await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/linksim_ui_check.png', fullPage: true });

const hasTitle = await page.locator('text=LinkSim').count();
const hasScenario = await page.locator('text=Scenario').count();
console.log('has-title', hasTitle);
console.log('has-scenario', hasScenario);

await browser.close();
