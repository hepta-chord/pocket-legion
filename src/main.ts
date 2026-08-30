import './style.css';
import type { SwapMove } from './battle';
import { FACTION_NAMES, FACTIONS, type Faction } from './data/factions';
import { addLog, newGame, step, toViewModel, type Action, type GameState } from './game';
import { portraitFor } from './render/portraits';
import type { Renderer } from './render/renderer';
import { TextRenderer } from './render/text-renderer';
import { randomSeedString } from './rng';
import { loadGame, saveGame } from './save';
import type { BattleView, DungeonView, FormationCharacterView, TownView, ViewModel } from './view';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}

const stage = byId('stage');
const canvas = byId<HTMLCanvasElement>('corridor');
// 描画層はここで 1 つ選んで差し込む。タイル描画にするときはこの 1 行を替える
const renderer: Renderer = new TextRenderer(canvas);

const portraitEl = byId('portrait');
const stageBody = byId('stage-body');
const iconsEnemy = byId('icons-enemy');
const iconsAlly = byId('icons-ally');
const logBox = byId('log');
const cluster = byId('cluster');
const slotsEl = byId('slots');
const controlsEl = byId('controls');
const status = byId('status');
const pickerEl = byId('picker');
const detailModalEl = byId('detail-modal');

const loaded = loadGame();
let state: GameState = loaded.state ?? newGame(randomSeedString());
if (loaded.discarded) addLog(state, 'info', '前のセーブは形式が古いので読めなかった。新しく始める。');

// 拠点内のページ・ダンジョン内の編成パネル開閉・戦闘の交代モードは、
// GameState (セーブ対象) には持たせない UI だけの状態にする。
// 理由: セーブしたい「進行」ではなく「今どの画面を見ているか」でしかなく、
// リロードすれば拠点トップやダンジョンの通常画面に戻ってもプレイヤーは困らないため。
// (docs/plan.md 4 節の「main.ts のローカル状態にしてもよい」を選んだ)
type TownPage = 'home' | 'tavern' | 'formation';
let page: TownPage = 'home';
let dungeonFormationOpen = false;

// 戦闘の交代 (編成ボタン) は、1 回の battle-swap にまとめて積む UI 上だけの状態
let swapMode = false;
let swapPending: SwapMove[] = [];

// 探索の「進む」演出中フラグ。演出は main.ts (描画層) だけに閉じ、game.ts にタイマーを持ち込まない。
// 演出中は操作ボタンを無効化して、連打による多重前進を防ぐ
let advancing = false;

/** 編成候補・交代候補のピッカー。スロットをタップして開き、一覧からキャラを選ぶ (行をタップで詳細ポップアップが開く) */
interface PickerConfig {
  title: string;
  rows: (FormationCharacterView & { placedSlot: number | null })[];
  /** 「空にする」を選べるか。交代ピッカーでは、そのスロットに何か積んでいるときだけ true */
  allowClear: boolean;
  onPick: (id: string | null) => void;
}
let picker: PickerConfig | null = null;
/** 陣営の絞り込み。ピッカーを開き直すたび 'all' に戻す */
let pickerFactionFilter: 'all' | Faction = 'all';
/** タップして開いた詳細ポップアップの対象。null なら閉じている */
let detailRow: (FormationCharacterView & { placedSlot: number | null }) | null = null;

function closePicker(): void {
  picker = null;
  pickerFactionFilter = 'all';
  detailRow = null;
}

function act(action: Action): void {
  step(state, action);
  saveGame(state);
  render();
}

function actionButton(label: string, action: Action, disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.disabled = disabled;
  if (!disabled) b.addEventListener('click', () => act(action));
  return b;
}

/** ゲームの Action を伴わない、画面遷移だけのボタン (拠点のページ切替・交代モードの開始など) */
function navButton(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.disabled = disabled;
  if (!disabled) b.addEventListener('click', onClick);
  return b;
}

function rarityLabel(rarity: 'common' | 'rare'): string {
  return rarity === 'rare' ? 'レア' : 'コモン';
}

// ---------------------------------------------------------------------------
// ステータスバー

function statusSpan(text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}

function renderStatus(vm: ViewModel): void {
  status.innerHTML = '';
  const s = vm.screen;
  if (s.kind === 'battle') {
    status.append(statusSpan(`HP ${s.hp}/${s.maxHp}`), statusSpan(`マナ ${s.mana}/${s.manaCap}`), statusSpan(`ターン ${s.turn}`));
  } else if (s.kind === 'dungeon') {
    status.append(statusSpan(`HP ${s.hp}/${s.maxHp}`), statusSpan(`${s.sectorName} 深度 ${s.depth}/${s.goal}`));
  } else if (s.kind === 'town') {
    status.append(statusSpan(`所持金 ${s.gold} G`), statusSpan(`回復薬 ${s.potions}`), statusSpan(`seed ${vm.seed}`));
  } else {
    status.append(statusSpan(s.won ? '帰還' : '全滅'));
  }
}

// ---------------------------------------------------------------------------
// ステージ本体 (拠点・ダンジョンのイベント・結果)。戦闘は #portrait 側が受け持つ

function renderHomeStage(s: TownView): void {
  const head = document.createElement('p');
  head.className = 'lead';
  head.textContent = 'どこへ潜るか。';
  stageBody.append(head);

  const list = document.createElement('div');
  list.className = 'list';
  for (const sec of s.sectors) {
    list.append(
      actionButton(
        `${sec.name} (深度 ${sec.depth})${sec.unlocked ? '' : ' — 未開放'}`,
        { type: 'sortie', sectorId: sec.id },
        !sec.unlocked,
      ),
    );
  }
  stageBody.append(list);
}

function renderTavernStage(s: TownView): void {
  const head = document.createElement('p');
  head.className = 'lead';
  head.textContent = '酒場';
  stageBody.append(head);

  if (s.tavern.length === 0) {
    const none = document.createElement('p');
    none.className = 'body';
    none.textContent = '雇える顔ぶれがいない。';
    stageBody.append(none);
    return;
  }

  const list = document.createElement('div');
  list.className = 'list';
  for (const t of s.tavern) {
    const card = document.createElement('div');
    card.className = 'card';
    const name = document.createElement('p');
    name.className = 'card-name';
    name.textContent = `${t.name} (${t.faction} / ${rarityLabel(t.rarity)})`;
    const sub = document.createElement('p');
    sub.className = 'card-sub';
    sub.textContent = `攻撃 ${t.attack} ・ 体力 ${t.vitality}`;
    card.append(name, sub, actionButton(`雇う (${t.price} G)`, { type: 'hire', id: t.id }, !t.affordable));
    list.append(card);
  }
  stageBody.append(list);
}

function renderFormationStage(s: TownView): void {
  const head = document.createElement('p');
  head.className = 'lead';
  head.textContent = '前衛の編成 (6 人)';
  stageBody.append(head);
  const note = document.createElement('p');
  note.className = 'body';
  note.textContent = s.formation.auto
    ? '未設定なので、所持キャラの先頭から自動で詰めている。スロットをタップして選び直せる。'
    : '控えは前衛に選ばれなかった roster 全員が自動で務める。スロットをタップして入れ替える。';
  stageBody.append(note);
}

function renderStageBody(vm: ViewModel): void {
  stageBody.innerHTML = '';
  const s = vm.screen;

  if (s.kind === 'town') {
    if (page === 'home') renderHomeStage(s);
    else if (page === 'tavern') renderTavernStage(s);
    else renderFormationStage(s);
    return;
  }

  if (s.kind === 'dungeon') {
    if (!s.event) return;
    const box = document.createElement('div');
    box.className = 'event-box';
    const title = document.createElement('p');
    title.className = 'stage-title';
    title.textContent = s.event.title;
    const body = document.createElement('p');
    body.className = 'stage-body-text';
    body.textContent = s.event.body;
    box.append(title, body);
    stageBody.append(box);
    return;
  }

  if (s.kind === 'result') {
    const title = document.createElement('p');
    title.className = 'stage-title';
    title.textContent = s.won ? `深度 ${s.depth} から戻った。` : `深度 ${s.depth} で倒れた。`;
    const body = document.createElement('p');
    body.className = 'stage-body-text';
    body.textContent = s.won ? `${s.gold} G を持ち帰った。` : '稼ぎはすべて失った。';
    stageBody.append(title, body);
  }
}

// ---------------------------------------------------------------------------
// 戦闘の敵画像枠 (アスキーアートのプレースホルダ)

function renderPortrait(vm: ViewModel): void {
  portraitEl.innerHTML = '';
  if (vm.screen.kind !== 'battle') return;
  const e = vm.screen.enemy;

  const info = document.createElement('div');
  info.className = 'enemy-info';
  const name = document.createElement('p');
  name.className = 'enemy-name';
  name.textContent = e.groupSize > 1 ? `${e.name} (${e.groupSize})` : e.name;
  const hp = document.createElement('p');
  hp.className = 'enemy-hp';
  hp.textContent = e.alive ? `HP ${e.hp}/${e.maxHp}` : '撃破';
  info.append(name, hp);
  portraitEl.append(info);

  const art = document.createElement('pre');
  art.className = 'portrait-art' + (e.isBoss ? ' boss' : '');
  art.textContent = portraitFor(e.name, e.isBoss).join('\n');
  portraitEl.append(art);
}

// ---------------------------------------------------------------------------
// 左右の状態アイコン列 (戦闘のみ)

function badge(text: string, cls = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = 'badge' + (cls ? ` ${cls}` : '');
  el.textContent = text;
  return el;
}

function renderIcons(vm: ViewModel): void {
  iconsLeft.innerHTML = '';
  iconsRight.innerHTML = '';
  if (vm.screen.kind !== 'battle') return;
  const s = vm.screen;

  // 左: 味方の状態。0 や無しのときは出さない
  if (s.guard > 0) iconsLeft.append(badge(`ガ${s.guard}`));
  if (s.barrier) iconsLeft.append(badge('バリア'));
  if (s.combo > 0) iconsLeft.append(badge(`コンボ${s.combo}`, 'warn'));
  if (s.buff > 0) iconsLeft.append(badge('支援', 'warn'));

  // 右: 敵の状態。耐性・大技の予告・ボスの印
  const e = s.enemy;
  if (e.alive) {
    if (e.resist) iconsRight.append(badge(e.resist === '物理' ? '物理耐' : '魔法耐'));
    iconsRight.append(badge(`大${e.countdown}`, e.countdown === 1 ? 'warn' : ''));
    if (e.isBoss) iconsRight.append(badge('ボス', 'boss'));
  }
}

// ---------------------------------------------------------------------------
// キャラスロット (3 列 x 2 行) の各種カード

function emptySlotCard(label = '空き'): HTMLElement {
  const div = document.createElement('div');
  div.className = 'slot-card empty';
  div.textContent = label;
  return div;
}

/** ダンジョン探索中の表示専用カード。タップしても何も起きない (docs/plan.md 3 節) */
function displaySlotCard(character: FormationCharacterView | null): HTMLElement {
  if (!character) return emptySlotCard();
  const div = document.createElement('div');
  div.className = 'slot-card';
  const name = document.createElement('p');
  name.className = 'slot-name';
  name.textContent = character.name;
  const sub = document.createElement('p');
  sub.className = 'slot-name';
  sub.textContent = character.faction;
  div.append(name, sub);
  return div;
}

/** 編成 (拠点・ダンジョン内) のスロット。カード全体がボタンで、タップでピッカーを開く */
function tappableSlotCard(character: FormationCharacterView | null, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'slot-card selectable' + (character ? '' : ' empty');
  b.addEventListener('click', onClick);
  if (!character) {
    b.textContent = '空き (タップ)';
    return b;
  }
  const name = document.createElement('p');
  name.className = 'slot-name';
  name.textContent = character.name;
  const sub = document.createElement('p');
  sub.className = 'slot-name';
  sub.textContent = `${character.faction} / ${rarityLabel(character.rarity)}`;
  b.append(name, sub);
  return b;
}

/** 戦闘中の前衛カード。名前とスキル 2 つのボタンを収める */
function battleSlotCard(slot: BattleView['slots'][number], slotIndex: number): HTMLElement {
  if (!slot) return emptySlotCard();
  const card = document.createElement('div');
  card.className = 'slot-card';
  const name = document.createElement('p');
  name.className = 'slot-name';
  name.textContent = slot.name;
  card.append(name);

  const row = document.createElement('div');
  row.className = 'slot-skills';
  slot.skills.forEach((sk, skillIndex) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'skill-btn' + (sk.raised > 0 ? ' raised' : '');
    b.disabled = !sk.usable;
    const label = document.createElement('span');
    label.className = 'skill-label';
    label.textContent = `${sk.name}(${sk.cost})`;
    b.append(label);
    if (sk.note) {
      const note = document.createElement('span');
      note.className = 'skill-note';
      note.textContent = sk.note;
      b.append(note);
    }
    if (sk.usable) {
      b.addEventListener('click', () => act({ type: 'battle-skill', slot: slotIndex, skill: skillIndex }));
    } else if (sk.reason) {
      b.title = sk.reason;
    }
    row.append(b);
  });
  card.append(row);
  return card;
}

/** 戦闘の交代モード中の前衛カード。カード全体がボタンで、控えのピッカーを開く */
function battleSwapSlotCard(s: BattleView, slotIndex: number): HTMLElement {
  const staged = swapPending.find((m) => m.slot === slotIndex);
  const current = s.slots[slotIndex];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'slot-card selectable' + (!current && !staged ? ' empty' : '');
  b.addEventListener('click', () => openBattleSwapPicker(s, slotIndex));
  const name = document.createElement('p');
  name.className = 'slot-name';
  if (staged) {
    const incoming = s.reserve.find((r) => r.id === staged.reserveId);
    name.textContent = `→ ${incoming?.name ?? staged.reserveId}`;
  } else {
    name.textContent = current ? current.name : '空き (タップ)';
  }
  b.append(name);
  return b;
}

// ---------------------------------------------------------------------------
// ピッカー (編成の候補一覧・戦闘の交代一覧)
//
// リスト行はタップで詳細 (スキル・パッシブの効果) を展開するアコーディオンにする。
// 候補が多くなっても外側の #app 自体はスクロールさせたくないので、
// #picker はフルスクリーンの重ねものにして、内部の一覧だけスクロールを許す

function buildPickerRow(c: FormationCharacterView & { placedSlot: number | null }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'picker-row';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'picker-row-head';
  const primary = document.createElement('p');
  primary.className = 'card-name';
  primary.textContent = `${c.name} (${c.faction} / ${rarityLabel(c.rarity)})`;
  const sub = document.createElement('p');
  sub.className = 'card-sub';
  sub.textContent = `攻撃 ${c.attack} ・ 体力 ${c.vitality}`;
  head.append(primary, sub);
  if (c.placedSlot !== null) {
    const placed = document.createElement('p');
    placed.className = 'card-sub placed';
    placed.textContent = `配置中: 前衛 ${c.placedSlot + 1}`;
    head.append(placed);
  }
  head.addEventListener('click', () => {
    pickerExpanded = pickerExpanded === c.id ? null : c.id;
    render();
  });
  row.append(head);

  if (pickerExpanded === c.id) {
    const detail = document.createElement('div');
    detail.className = 'picker-detail';
    for (const sk of c.skillDetails) {
      const p = document.createElement('p');
      p.className = 'picker-skill';
      const note = sk.note ? ` (${sk.note})` : '';
      p.textContent = `${sk.name} [${sk.category} ${sk.cost}] ${sk.effect}${note}`;
      detail.append(p);
    }
    for (const p of c.passiveDetails) {
      const el = document.createElement('p');
      el.className = 'picker-passive';
      el.textContent = `${p.name}: ${p.effect}`;
      detail.append(el);
    }
    const place = document.createElement('button');
    place.type = 'button';
    place.textContent = 'この枠に配置';
    place.addEventListener('click', () => {
      const onPick = picker!.onPick;
      closePicker();
      onPick(c.id);
    });
    detail.append(place);
    row.append(detail);
  }
  return row;
}

function renderPicker(): void {
  pickerEl.innerHTML = '';
  if (!picker) {
    pickerEl.hidden = true;
    return;
  }
  pickerEl.hidden = false;

  const header = document.createElement('div');
  header.className = 'picker-header';
  const title = document.createElement('p');
  title.className = 'picker-title';
  title.textContent = picker.title;
  header.append(title, navButton('閉じる', () => { closePicker(); render(); }));
  pickerEl.append(header);

  const list = document.createElement('div');
  list.className = 'picker-list';

  if (picker.allowClear) {
    const row = document.createElement('div');
    row.className = 'picker-row';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'picker-row-head';
    head.textContent = '空にする';
    head.addEventListener('click', () => {
      const onPick = picker!.onPick;
      closePicker();
      onPick(null);
    });
    row.append(head);
    list.append(row);
  }

  for (const c of picker.rows) list.append(buildPickerRow(c));
  pickerEl.append(list);
}

function openTownFormationPicker(s: TownView, slot: number): void {
  picker = {
    title: `前衛 ${slot + 1} に置くキャラ`,
    rows: s.formation.roster,
    allowClear: true,
    onPick: (id) => act({ type: 'formation-set', slot, id }),
  };
  pickerExpanded = null;
  render();
}

function openDungeonFormationPicker(s: DungeonView, slot: number): void {
  picker = {
    title: `前衛 ${slot + 1} に置くキャラ`,
    rows: s.formation.roster,
    allowClear: true,
    onPick: (id) => act({ type: 'dungeon-formation-set', slot, id }),
  };
  pickerExpanded = null;
  render();
}

function openBattleSwapPicker(s: BattleView, slot: number): void {
  // 他のスロットに積んだ控えは候補から外す (同じ控えを 2 枠に入れられない)
  const takenElsewhere = new Set(swapPending.filter((m) => m.slot !== slot).map((m) => m.reserveId));
  const rows = s.reserve.filter((r) => !takenElsewhere.has(r.id)).map((r) => ({ ...r, placedSlot: null }));
  picker = {
    title: `前衛 ${slot + 1} に入れる控え`,
    rows,
    allowClear: swapPending.some((m) => m.slot === slot),
    onPick: (id) => {
      swapPending = swapPending.filter((m) => m.slot !== slot);
      if (id !== null) swapPending.push({ slot, reserveId: id });
      render();
    },
  };
  pickerExpanded = null;
  render();
}

// ---------------------------------------------------------------------------
// 操作クラスタ (キャラスロット + 操作ボタン列)

function renderBattleCluster(s: BattleView): void {
  if (swapMode) {
    s.slots.forEach((_, i) => slotsEl.append(battleSwapSlotCard(s, i)));
    const confirm = navButton(`確定 (${swapPending.length})`, () => {
      const moves = [...swapPending];
      swapMode = false;
      swapPending = [];
      act({ type: 'battle-swap', moves });
    }, swapPending.length === 0);
    controlsEl.append(confirm);
    controlsEl.append(navButton('取消', () => {
      swapMode = false;
      swapPending = [];
      render();
    }));
    return;
  }

  s.slots.forEach((slot, i) => slotsEl.append(battleSlotCard(slot, i)));

  controlsEl.append(actionButton('ターン終了', { type: 'battle-end-turn' }));
  controlsEl.append(actionButton(`ガード (${s.guard}/${s.guardMax})`, { type: 'battle-guard' }, !s.canGuard));
  controlsEl.append(actionButton(`回復薬 (${s.potions})`, { type: 'potion' }, s.potions <= 0));
  const swapDisabled = s.swapCooldown > 0 || s.reserve.length === 0;
  controlsEl.append(
    navButton(
      s.swapCooldown > 0 ? `編成 (あと${s.swapCooldown})` : '編成',
      () => {
        swapMode = true;
        swapPending = [];
        render();
      },
      swapDisabled,
    ),
  );
}

function renderDungeonCluster(s: DungeonView): void {
  if (dungeonFormationOpen) {
    s.formation.slots.forEach((slot, i) =>
      slotsEl.append(tappableSlotCard(slot.character, () => openDungeonFormationPicker(s, i))),
    );
    controlsEl.append(navButton('戻る', () => {
      dungeonFormationOpen = false;
      render();
    }));
    return;
  }

  s.front.forEach((slot) => slotsEl.append(displaySlotCard(slot.character)));

  if (s.event) {
    controlsEl.append(actionButton(s.event.action, { type: 'resolve' }));
    if (s.event.alt) controlsEl.append(actionButton(s.event.alt, { type: 'resolve-alt' }));
  } else {
    controlsEl.append(actionButton('進む', { type: 'advance' }));
  }
  controlsEl.append(actionButton('引き返す', { type: 'retreat' }));
  controlsEl.append(actionButton(`回復薬 (${s.potions})`, { type: 'potion' }, s.potions <= 0));
  controlsEl.append(navButton('編成', () => {
    dungeonFormationOpen = true;
    render();
  }));
}

function renderTownCluster(s: TownView): void {
  if (page === 'formation') {
    s.formation.slots.forEach((slot, i) =>
      slotsEl.append(tappableSlotCard(slot.character, () => openTownFormationPicker(s, i))),
    );
    controlsEl.append(navButton('戻る', () => {
      page = 'home';
      render();
    }));
    return;
  }

  cluster.classList.add('no-slots');
  if (page === 'tavern') {
    controlsEl.append(navButton('戻る', () => {
      page = 'home';
      render();
    }));
    return;
  }

  controlsEl.append(navButton('酒場', () => {
    page = 'tavern';
    render();
  }));
  controlsEl.append(navButton('編成', () => {
    page = 'formation';
    render();
  }));
}

function renderCluster(vm: ViewModel): void {
  slotsEl.innerHTML = '';
  controlsEl.innerHTML = '';
  cluster.classList.remove('no-slots');

  const s = vm.screen;
  if (s.kind === 'battle') return renderBattleCluster(s);
  if (s.kind === 'dungeon') return renderDungeonCluster(s);
  if (s.kind === 'town') return renderTownCluster(s);

  cluster.classList.add('no-slots');
  controlsEl.append(actionButton('都市へ', { type: 'dismiss' }));
}

// ---------------------------------------------------------------------------
// メッセージログ

function renderLog(vm: ViewModel): void {
  logBox.innerHTML = '';
  for (const line of vm.log) {
    const p = document.createElement('p');
    p.className = `line ${line.kind}`;
    p.textContent = line.text;
    logBox.append(p);
  }
}

// ---------------------------------------------------------------------------

function render(): void {
  const vm = toViewModel(state);
  // 画面種別が変われば、その場限りの UI 状態は毎回リセットする
  if (vm.screen.kind !== 'battle') {
    swapMode = false;
    swapPending = [];
  }
  if (vm.screen.kind !== 'town') page = 'home';
  if (vm.screen.kind !== 'dungeon') dungeonFormationOpen = false;

  stage.dataset.screen = vm.screen.kind;
  renderer.resize();
  renderer.draw(vm);

  renderStatus(vm);
  renderStageBody(vm);
  renderPortrait(vm);
  renderIcons(vm);
  renderLog(vm);
  renderCluster(vm);
  renderPicker();
}

window.addEventListener('resize', render);
render();
