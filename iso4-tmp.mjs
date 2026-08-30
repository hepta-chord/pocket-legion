import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
await page.goto('file:///home/user/pocket-legion/iso-tmp.html');
const info = await page.evaluate(() => {
  const g = document.getElementById('g').getBoundingClientRect();
  const h = document.getElementById('h').getBoundingClientRect();
  return { g, h, gRatio: g.width/g.height, hRatio: h.width/h.height };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
