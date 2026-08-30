import './style.css';
import type { SwapMove } from './battle';
import { addLog, newGame, step, toViewModel, type Action, type GameState } from './game';
import type { Renderer } from './render/renderer';
import { TextRenderer } from './render/text-renderer';
import { randomSeedString } from './rng';
import { loadGame, saveGame } from './save';
import type { BattleView, ViewModel } from './view';

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

// 交代モードは 1 回の battle-swap にまとめて積む UI 上だけの状態なので、
// GameState には持たせずここで持つ。戦闘を抜けたら render() の先頭で必ず消す
let swapMode = false;
let swapPending: SwapMove[] = [];
let swapSelectedReserve: string | null = null;

function exitSwapMode(): void {
  swapMode = false;
  swapPending = [];
  swapSelectedReserve = null;
}

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

// ---------------------------------------------------------------------------
// 戦闘画面

function renderCombo(s: BattleView): void {
  const el = document.createElement('p');
  el.className = 'combo' + (s.combo > 0 ? ' active' : '');
  el.textContent =
    s.combo > 0 ? `コンボ ${s.combo} (×${(1 + 0.15 * s.combo).toFixed(2)})` : 'コンボ 0';
  panel.append(el);
}

function renderEnemies(s: BattleView): void {
  const box = document.createElement('div');
  box.className = 'enemies';
  const e = s.enemy;
  const row = document.createElement('div');
  row.className = 'enemy';
  if (!e.alive) row.classList.add('dead');
  if (e.alive && e.countdown === 1) row.classList.add('warn');

  const name = document.createElement('span');
  name.className = 'enemy-name';
  // 群れは頭数を添えて規模を見せる。単体 (groupSize 1) は素の名前のまま
  const label = e.groupSize > 1 ? `${e.name} (${e.groupSize})` : e.name;
  name.textContent = e.resist ? `${label} [${e.resist}耐性]` : label;
  row.append(name);

  const hp = document.createElement('span');
  hp.className = 'enemy-hp';
  hp.textContent = e.alive ? `HP ${e.hp}/${e.maxHp}` : '撃破';
  row.append(hp);

  if (e.alive) {
    const cd = document.createElement('span');
    cd.className = 'enemy-cd';
    cd.textContent = `大技まであと ${e.countdown}`;
    row.append(cd);
  }

  box.append(row);
  panel.append(box);
}

function renderFront(s: BattleView): void {
  const box = document.createElement('div');
  box.className = 'front';
  s.slots.forEach((slot, slotIndex) => {
    const card = document.createElement('div');
    card.className = 'card';
    if (!slot) {
      card.classList.add('empty');
      card.textContent = '空き枠';
      box.append(card);
      return;
    }

    const name = document.createElement('p');
    name.className = 'card-name';
    name.textContent = `${slot.name} (${slot.faction})`;
    card.append(name);

    const skillRow = document.createElement('div');
    skillRow.className = 'skills';
    slot.skills.forEach((sk, skillIndex) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'skill-btn';
      if (sk.raised > 0) b.classList.add('raised');
      b.disabled = !sk.usable;

      const label = document.createElement('span');
      label.className = 'skill-label';
      label.textContent = `${sk.name} (${sk.cost})`;
      b.append(label);

      if (sk.note) {
        const note = document.createElement('span');
        note.className = 'skill-note';
        note.textContent = sk.note;
        b.append(note);
      }
      if (!sk.usable && sk.reason) {
        const reason = document.createElement('span');
        reason.className = 'skill-reason';
        reason.textContent = sk.reason;
        b.append(reason);
      }

      if (sk.usable) {
        b.addEventListener('click', () => act({ type: 'battle-skill', slot: slotIndex, skill: skillIndex }));
      }
      skillRow.append(b);
    });
    card.append(skillRow);
    box.append(card);
  });
  panel.append(box);
}

function renderControls(s: BattleView): void {
  const box = document.createElement('div');
  box.className = 'controls';
  box.append(button(`ガード (${s.guard}/${s.guardMax})`, { type: 'battle-guard' }, !s.canGuard));
  box.append(button(`回復薬 (${s.potions})`, { type: 'potion' }, s.potions <= 0));

  const swapDisabled = s.swapCooldown > 0 || s.reserve.length === 0;
  const swapBtn = document.createElement('button');
  swapBtn.type = 'button';
  swapBtn.textContent = s.swapCooldown > 0 ? `交代 (あと ${s.swapCooldown})` : '交代';
  swapBtn.disabled = swapDisabled;
  if (!swapDisabled) {
    swapBtn.addEventListener('click', () => {
      exitSwapMode();
      swapMode = true;
      render();
    });
  }
  box.append(swapBtn);

  box.append(button('ターン終了', { type: 'battle-end-turn' }));
  panel.append(box);
}

/** 交代モード。控えを 1 人選び、次に入れ替え先の枠を選ぶのを繰り返して積み、確定でまとめて送る */
function renderSwapPanel(s: BattleView): void {
  const box = document.createElement('div');
  box.className = 'swap-panel';

  const stagedSlots = new Set(swapPending.map((m) => m.slot));
  const stagedIds = new Set(swapPending.map((m) => m.reserveId));

  if (swapPending.length > 0) {
    const summary = document.createElement('p');
    summary.className = 'body';
    summary.textContent = swapPending
      .map((m) => {
        const enteringName = s.reserve.find((r) => r.id === m.reserveId)?.name ?? m.reserveId;
        const leavingName = s.slots[m.slot]?.name ?? '空き枠';
        return `${leavingName} → ${enteringName}`;
      })
      .join('、');
    box.append(summary);
  }

  const hint = document.createElement('p');
  hint.className = 'body';
  box.append(hint);

  if (!swapSelectedReserve) {
    hint.textContent = '入れる控えを選ぶ。';
    const remain = s.reserve.filter((r) => !stagedIds.has(r.id));
    if (remain.length === 0) {
      const none = document.createElement('p');
      none.className = 'body';
      none.textContent = 'これ以上入れられる控えがいない。';
      box.append(none);
    }
    for (const r of remain) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${r.name} (${r.faction})`;
      b.addEventListener('click', () => {
        swapSelectedReserve = r.id;
        render();
      });
      box.append(b);
    }
  } else {
    hint.textContent = '入れ替え先の枠を選ぶ。';
    s.slots.forEach((slot, i) => {
      if (stagedSlots.has(i)) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = slot ? `${slot.name} と交代` : '空き枠に入れる';
      b.addEventListener('click', () => {
        swapPending.push({ slot: i, reserveId: swapSelectedReserve! });
        swapSelectedReserve = null;
        render();
      });
      box.append(b);
    });
  }

  const controls = document.createElement('div');
  controls.className = 'controls';

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.textContent = '確定';
  confirm.disabled = swapPending.length === 0;
  if (swapPending.length > 0) {
    confirm.addEventListener('click', () => {
      const moves = [...swapPending];
      exitSwapMode();
      act({ type: 'battle-swap', moves });
    });
  }
  controls.append(confirm);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => {
    exitSwapMode();
    render();
  });
  controls.append(cancel);

  box.append(controls);
  panel.append(box);
}

function renderBattle(s: BattleView): void {
  status.textContent = `HP ${s.hp}/${s.maxHp}  マナ ${s.mana}/${s.manaCap}  ガード ${s.guard}/${s.guardMax}  バリア ${s.barrier ? '有' : '無'}  ターン ${s.turn}`;
  renderCombo(s);
  renderEnemies(s);
  if (swapMode) {
    renderSwapPanel(s);
  } else {
    renderFront(s);
    renderControls(s);
  }
}

// ---------------------------------------------------------------------------

function renderPanel(vm: ViewModel): void {
  panel.innerHTML = '';
  const s = vm.screen;

  if (s.kind === 'town') {
    status.textContent = `所持金 ${s.gold} G  回復薬 ${s.potions}`;
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

    const tavernHead = document.createElement('p');
    tavernHead.className = 'lead';
    tavernHead.textContent = '酒場';
    panel.append(tavernHead);
    if (s.tavern.length === 0) {
      const none = document.createElement('p');
      none.className = 'body';
      none.textContent = '雇える顔ぶれがいない。';
      panel.append(none);
    }
    for (const t of s.tavern) {
      const card = document.createElement('div');
      card.className = 'card';
      const name = document.createElement('p');
      name.className = 'card-name';
      name.textContent = `${t.name} (${t.faction})`;
      const skills = document.createElement('p');
      skills.className = 'body';
      skills.textContent = t.skills.join('・');
      card.append(name, skills, button(`雇う (${t.price} G)`, { type: 'hire', id: t.id }, !t.affordable));
      panel.append(card);
    }

    const rosterHead = document.createElement('p');
    rosterHead.className = 'lead';
    rosterHead.textContent = `所持キャラ (${s.roster.length})`;
    panel.append(rosterHead);
    for (const r of s.roster) {
      const card = document.createElement('div');
      card.className = 'card';
      const name = document.createElement('p');
      name.className = 'card-name';
      name.textContent = `${r.name} (${r.faction} / ${r.rarity === 'rare' ? 'レア' : 'コモン'})`;
      const skills = document.createElement('p');
      skills.className = 'body';
      skills.textContent = r.skills.join('・');
      card.append(name, skills);
      panel.append(card);
    }
    return;
  }

  if (s.kind === 'dungeon') {
    status.textContent = `${s.sectorName}  深度 ${s.depth}/${s.goal}  HP ${s.hp}/${s.maxHp}`;
    const partyLine = document.createElement('p');
    partyLine.className = 'body';
    partyLine.textContent = `前衛 ${s.frontCount} 人 / 控え ${s.reserveCount} 人 / ダウン ${s.downedCount} 人`;
    panel.append(partyLine);

    if (s.event) {
      const title = document.createElement('p');
      title.className = 'lead';
      title.textContent = s.event.title;
      const body = document.createElement('p');
      body.className = 'body';
      body.textContent = s.event.body;
      panel.append(title, body, button(s.event.action, { type: 'resolve' }));
      if (s.event.alt) panel.append(button(s.event.alt, { type: 'resolve-alt' }));
    } else {
      panel.append(button('進む', { type: 'advance' }));
    }
    panel.append(button(`回復薬 (${s.potions})`, { type: 'potion' }, s.potions <= 0));
    panel.append(button('引き返す', { type: 'retreat' }));
    return;
  }

  if (s.kind === 'battle') {
    renderBattle(s);
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
  if (vm.screen.kind !== 'battle' && swapMode) exitSwapMode();
  stage.dataset.screen = vm.screen.kind;
  renderer.resize();
  renderer.draw(vm);
  renderPanel(vm);
  renderLog(vm);
}

window.addEventListener('resize', render);
render();
