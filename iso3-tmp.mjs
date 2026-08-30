import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
await page.goto('file:///home/user/pocket-legion/iso-tmp.html');
const info = await page.evaluate(() => {
  const e = document.getElementById('e').getBoundingClientRect();
  const f = document.getElementById('f').getBoundingClientRect();
  return { e, f };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
