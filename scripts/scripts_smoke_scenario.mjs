import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle' });

console.log('scenario-visible', await page.locator('text=Scenario').count());
console.log('open-sim-library', await page.locator('button:has-text("Open Simulation Library")').count());
console.log('open-site-library', await page.locator('button:has-text("Open Site Library")').count());

await browser.close();
