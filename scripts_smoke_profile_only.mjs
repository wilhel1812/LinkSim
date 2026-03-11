import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' });

const before = await page.locator('section.chart-panel').getAttribute('data-profile-revision');
await page.selectOption('section:has-text("Scenario") select', 'oslo-regional');
await page.waitForTimeout(500);
const after = await page.locator('section.chart-panel').getAttribute('data-profile-revision');

console.log('profile-before', before);
console.log('profile-after', after);
console.log('profile-updated', before !== after);

await browser.close();
