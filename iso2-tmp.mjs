import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
await page.goto('file:///home/user/pocket-legion/iso-tmp.html');
const info = await page.evaluate(() => {
  const c = document.getElementById('c').getBoundingClientRect();
  const cc = document.getElementById('cc').getBoundingClientRect();
  const d = document.getElementById('d').getBoundingClientRect();
  return { c, cc, d };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
