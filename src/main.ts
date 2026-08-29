import './style.css';
import { addLog, newGame, step, toViewModel, type Action, type GameState } from './game';
import type { Renderer } from './render/renderer';
import { TextRenderer } from './render/text-renderer';
import { randomSeedString } from './rng';
import { loadGame, saveGame } from './save';
import type { ViewModel } from './view';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}

const canvas = byId<HTMLCanvasElement>('corridor');
// 描画層はここで 1 つ選んで差し込む。タイル描画にするときはこの 1 行を替える
const renderer: Renderer = new TextRenderer(canvas);

const stage = byId('stage');
const panel = byId('panel');
const logBox = byId('log');
const status = byId('status');

const loaded = loadGame();
let state: GameState = loaded.state ?? newGame(randomSeedString());
if (loaded.discarded) addLog(state, 'info', '前のセーブは形式が古いので読めなかった。新しく始める。');

function act(action: Action): void {
  step(state, action);
  saveGame(state);
  render();
}

function button(label: string, action: Action, disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.disabled = disabled;
  if (!disabled) b.addEventListener('click', () => act(action));
  return b;
}

function renderPanel(vm: ViewModel): void {
  panel.innerHTML = '';
  const s = vm.screen;

  if (s.kind === 'town') {
    status.textContent = `所持金 ${s.gold} G`;
    const head = document.createElement('p');
    head.className = 'lead';
    head.textContent = 'どこへ潜るか。';
    panel.append(head);
    for (const sec of s.sectors) {
      panel.append(
        button(
          `${sec.name} (深度 ${sec.depth})${sec.unlocked ? '' : ' — 未開放'}`,
          { type: 'sortie', sectorId: sec.id },
          !sec.unlocked,
        ),
      );
    }
    return;
  }

  if (s.kind === 'dungeon') {
    status.textContent = `${s.sectorName}  深度 ${s.depth}/${s.goal}  HP ${s.hp}/${s.maxHp}`;
    if (s.event) {
      const title = document.createElement('p');
      title.className = 'lead';
      title.textContent = s.event.title;
      const body = document.createElement('p');
      body.className = 'body';
      body.textContent = s.event.body;
      panel.append(title, body, button(s.event.action, { type: 'resolve' }));
    } else {
      panel.append(button('進む', { type: 'advance' }));
    }
    panel.append(button('引き返す', { type: 'retreat' }));
    return;
  }

  status.textContent = s.won ? '帰還' : '全滅';
  const title = document.createElement('p');
  title.className = 'lead';
  title.textContent = s.won ? `深度 ${s.depth} から戻った。` : `深度 ${s.depth} で倒れた。`;
  const body = document.createElement('p');
  body.className = 'body';
  body.textContent = s.won ? `${s.gold} G を持ち帰った。` : '稼ぎはすべて失った。';
  panel.append(title, body, button('都市へ', { type: 'dismiss' }));
}

function renderLog(vm: ViewModel): void {
  logBox.innerHTML = '';
  for (const line of vm.log) {
    const p = document.createElement('p');
    p.className = `line ${line.kind}`;
    p.textContent = line.text;
    logBox.append(p);
  }
}

function render(): void {
  const vm = toViewModel(state);
  stage.dataset.screen = vm.screen.kind;
  renderer.resize();
  renderer.draw(vm);
  renderPanel(vm);
  renderLog(vm);
}

window.addEventListener('resize', render);
render();
