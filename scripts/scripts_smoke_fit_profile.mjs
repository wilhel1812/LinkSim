import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle' });

console.log('fit-button', await page.locator('button:has-text("Fit")').count());
await page.locator('button:has-text("Fit")').click();
await page.waitForTimeout(400);
console.log('path-profile-visible', await page.locator('text=Path Profile').count());

await browser.close();
