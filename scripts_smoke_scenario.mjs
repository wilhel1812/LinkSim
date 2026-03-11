import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' });

console.log('scenario-visible', await page.locator('text=Scenario').count());
console.log('oslo-default', await page.locator('text=Oslo Local Net').count());

await page.selectOption('section:has-text("Scenario") select', 'hogevarde-vardefjell');
await page.waitForTimeout(800);

console.log('fyris-site', await page.locator('text=Fyrisjøvegen 299').count());

await browser.close();
