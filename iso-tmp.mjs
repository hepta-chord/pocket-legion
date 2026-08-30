import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
await page.goto('file:///home/user/pocket-legion/iso-tmp.html');
const info = await page.evaluate(() => {
  const a = document.getElementById('a').getBoundingClientRect();
  const b = document.getElementById('b').getBoundingClientRect();
  return { a, b };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
