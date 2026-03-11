import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' });

const modelSection = page.locator('section:has-text("Model")');
await modelSection.locator('button:has-text("ITM")').click();
await page.waitForTimeout(400);

console.log('itm-chip', await page.locator('button.is-selected:has-text("ITM")').count());
console.log('oslo-net', await page.locator('text=Oslo Local Net').count());

await browser.close();
