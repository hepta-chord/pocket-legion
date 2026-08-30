import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = 'http://localhost:5183/';
const SHOTS_DIR = '/home/user/pocket-legion/shots';
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const viewports = [
  { name: '375x667', width: 375, height: 667 },
  { name: '393x852', width: 393, height: 852 },
  { name: '414x896', width: 414, height: 896 },
];

async function measure(page, label) {
  return await page.evaluate((label) => {
    const canvas = document.getElementById('corridor');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const doc = document.documentElement;
    return {
      label,
      screen: document.getElementById('stage').dataset.screen,
      rectW: rect.width,
      rectH: rect.height,
      ratio: rect.width / rect.height,
      canvasW: canvas.width,
      canvasH: canvas.height,
      expectedW: Math.max(1, Math.round(rect.width * dpr)),
      expectedH: Math.max(1, Math.round(rect.height * dpr)),
      dpr,
      scrollHeight: doc.scrollHeight,
      clientHeight: doc.clientHeight,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  }, label);
}

async function clickText(page, selector, text) {
  const el = page.locator(selector).filter({ hasText: text }).first();
  await el.click();
}

const results = [];
const consoleErrors = [];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
});

for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${vp.name}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => consoleErrors.push(`[${vp.name}] pageerror: ${err.message}`));

  // 毎回まっさらな状態から始める (前回のセーブが残っていると分岐が変わるため)
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#stage[data-screen]');

  results.push(await measure(page, `${vp.name} 拠点`));

  // 拠点 -> 探索
  await clickText(page, '.card-tappable', '探索');
  results.push(await measure(page, `${vp.name} 探索一覧`));

  // 探索 -> 区画を選ぶ (開放済みの先頭)
  await clickText(page, '.card-tappable:not([disabled])', '');
  await page.waitForFunction(() => document.getElementById('stage').dataset.screen === 'dungeon');
  results.push(await measure(page, `${vp.name} ダンジョン入場直後`));
  await page.screenshot({ path: `${SHOTS_DIR}/verify-${vp.name}-01-dungeon-enter.png` });

  // 「進む」を押して演出中・演出後を測る。イベントが出るまで繰り返す
  let sawEvent = false;
  let sawBattle = false;
  for (let i = 0; i < 25 && !sawBattle; i++) {
    const screen = await page.evaluate(() => document.getElementById('stage').dataset.screen);
    if (screen === 'battle') { sawBattle = true; break; }

    const hasEventBox = await page.evaluate(() => !!document.querySelector('.event-box'));
    if (screen === 'dungeon' && hasEventBox) {
      // イベント表示中: 選択肢ボタンを押して先へ進める
      if (!sawEvent) {
        results.push(await measure(page, `${vp.name} イベント表示時`));
        await page.screenshot({ path: `${SHOTS_DIR}/verify-${vp.name}-03-event.png` });
        sawEvent = true;
      }
      const primaryBtn = page.locator('#controls .controls-primary button').first();
      await primaryBtn.click();
      await page.waitForTimeout(150);
      continue;
    }

    const advanceBtn = page.locator('#controls .controls-primary button', { hasText: '進む' });
    if ((await advanceBtn.count()) === 0) break;
    await advanceBtn.click();
    // 演出中 (1回だけ計測)
    if (i === 0) {
      await page.waitForTimeout(300);
      results.push(await measure(page, `${vp.name} 進む演出中`));
    }
    await page.waitForTimeout(1200); // 演出終了 (1000ms) を待つ
    const screenAfter = await page.evaluate(() => document.getElementById('stage').dataset.screen);
    if (i === 0) {
      results.push(await measure(page, `${vp.name} 進む演出後`));
      await page.screenshot({ path: `${SHOTS_DIR}/verify-${vp.name}-02-advance-done.png` });
    }
  }

  if (sawBattle) {
    results.push(await measure(page, `${vp.name} 戦闘`));
    await page.screenshot({ path: `${SHOTS_DIR}/verify-${vp.name}-04-battle.png` });
  } else {
    results.push({ label: `${vp.name} 戦闘`, note: '25回の進むで戦闘に到達しなかった' });
  }

  await context.close();
}

await browser.close();

console.log(JSON.stringify(results, null, 2));
console.log('--- console errors ---');
console.log(JSON.stringify(consoleErrors, null, 2));

fs.writeFileSync('/tmp/claude-0/-home-user-pocket-rogue/78ef83c8-23be-542c-a2b6-41eafeb26da9/scratchpad/results.json', JSON.stringify({ results, consoleErrors }, null, 2));
