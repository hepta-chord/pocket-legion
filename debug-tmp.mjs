import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
const page = await context.newPage();
page.on('console', m => console.log('CONSOLE:', m.text()));
await page.goto('http://localhost:5183/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#stage[data-screen]');
await page.locator('.card-tappable').filter({ hasText: '探索' }).first().click();
await page.locator('.card-tappable:not([disabled])').first().click();
await page.waitForFunction(() => document.getElementById('stage').dataset.screen === 'dungeon');

const info = await page.evaluate(() => {
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('corridor');
  const cs = getComputedStyle(canvas);
  const ss = getComputedStyle(stage);
  return {
    stageRect: stage.getBoundingClientRect(),
    canvasRect: canvas.getBoundingClientRect(),
    canvasAspectRatio: cs.aspectRatio,
    canvasDisplay: cs.display,
    canvasMaxWidth: cs.maxWidth,
    canvasMaxHeight: cs.maxHeight,
    canvasWidthAttr: canvas.width,
    canvasHeightAttr: canvas.height,
    canvasInlineStyle: canvas.getAttribute('style'),
    stageDisplay: ss.display,
    stageAlignItems: ss.alignItems,
    stageJustifyContent: ss.justifyContent,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
