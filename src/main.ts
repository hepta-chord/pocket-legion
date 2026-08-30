import './style.css';
import type { SwapMove } from './battle';
import { FACTION_NAMES, FACTIONS, type Faction } from './data/factions';
import { addLog, newGame, step, toViewModel, type Action, type GameState } from './game';
import { eventIconFor } from './render/event-icons';
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

/**
 * タップして開く詳細ポップアップ (モーダル)。編成・交代のピッカー行と酒場のカードが共有する。
 * 実行ボタンのラベルと挙動だけが呼び出し側で違う (配置 / 雇用)。null なら閉じている
 */
interface DetailModalConfig {
  row: FormationCharacterView & { placedSlot?: number | null };
  actionLabel: string;
  actionDisabled?: boolean;
  onAction: () => void;
}
let activeDetail: DetailModalConfig | null = null;

function closePicker(): void {
  picker = null;
  pickerFactionFilter = 'all';
  activeDetail = null;
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

function statusSpan(text: string, cls = ''): HTMLSpanElement {
  const el = document.createElement('span');
  if (cls) el.className = cls;
  el.textContent = text;
  return el;
}

/** HP バー (数値併記)。パーティ用・敵用の両方で使う共通部品 */
function hpGroup(label: string, hp: number, maxHp: number, cls = ''): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'hp-group' + (cls ? ` ${cls}` : '');
  const text = document.createElement('span');
  text.textContent = `${label} ${hp}/${maxHp}`;
  const track = document.createElement('span');
  track.className = 'hp-track';
  const fill = document.createElement('span');
  fill.className = 'hp-fill';
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
  fill.style.width = `${pct}%`;
  track.append(fill);
  wrap.append(text, track);
  return wrap;
}

/** マナを ●●●○○○○○○○ の丸の列にする。現在値まで塗り、上限まで空丸 */
function manaDots(mana: number, cap: number): string {
  const filled = Math.max(0, Math.min(cap, mana));
  return '●'.repeat(filled) + '○'.repeat(Math.max(0, cap - filled));
}

function renderStatus(vm: ViewModel): void {
  status.innerHTML = '';
  const s = vm.screen;
  if (s.kind === 'battle') {
    const mana = document.createElement('span');
    mana.className = 'mana-dots';
    mana.textContent = `マナ ${manaDots(s.mana, s.manaCap)}`;
    status.append(hpGroup('HP', s.hp, s.maxHp), mana, statusSpan(`ターン ${s.turn}`));
    status.append(statusSpan(`防御 ${s.defense}/${s.defenseMax}`));
    if (s.fleeIn !== null) status.append(statusSpan(`離脱まで ${s.fleeIn}`, 'warn'));
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
    // 酒場のカードもタップで詳細モーダルを開く。中身は編成と同じ (名前・陣営・レアリティ・
    // 攻撃力・体力・スキル 2 つの詳細・パッシブ)。雇う判断にはスキルも見えないと片手落ちになる
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card card-tappable';
    const name = document.createElement('p');
    name.className = 'card-name';
    name.textContent = `${t.name} (${t.faction} / ${rarityLabel(t.rarity)})`;
    const sub = document.createElement('p');
    sub.className = 'card-sub';
    sub.textContent = `攻撃 ${t.attack} ・ 体力 ${t.vitality} ・ ${t.price} G`;
    card.append(name, sub);
    card.addEventListener('click', () => {
      activeDetail = {
        row: t,
        actionLabel: `雇う (${t.price} G)`,
        actionDisabled: !t.affordable,
        onAction: () => act({ type: 'hire', id: t.id }),
      };
      render();
    });
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
  portraitEl.classList.remove('visible');

  if (vm.screen.kind === 'battle') {
    portraitEl.classList.add('visible');
    const e = vm.screen.enemy;

    const info = document.createElement('div');
    info.className = 'enemy-info';
    const name = document.createElement('p');
    name.className = 'enemy-name';
    name.textContent = e.groupSize > 1 ? `${e.name} (${e.groupSize})` : e.name;
    info.append(name);

    const hpWrap = document.createElement('div');
    hpWrap.className = 'enemy-hp-wrap';
    if (e.alive) {
      hpWrap.append(hpGroup('HP', e.hp, e.maxHp, 'enemy'));
    } else {
      const hp = document.createElement('p');
      hp.className = 'enemy-hp';
      hp.textContent = '撃破';
      hpWrap.append(hp);
    }
    info.append(hpWrap);
    portraitEl.append(info);

    const art = document.createElement('pre');
    art.className = 'portrait-art' + (e.isBoss ? ' boss' : '');
    art.textContent = portraitFor(e.name, e.isBoss).join('\n');
    portraitEl.append(art);
    return;
  }

  // 探索中のイベントアイコン。通路の中央あたりに小さな絵を出し、
  // 何が起きたかをタイトル・本文より先に一目でわかるようにする
  if (vm.screen.kind === 'dungeon' && vm.screen.event) {
    portraitEl.classList.add('visible');
    const art = document.createElement('pre');
    art.className = `event-icon-art event-icon-${vm.screen.event.kind}`;
    art.textContent = eventIconFor(vm.screen.event.kind).join('\n');
    portraitEl.append(art);
  }
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
  iconsEnemy.innerHTML = '';
  iconsAlly.innerHTML = '';
  if (vm.screen.kind !== 'battle') return;
  const s = vm.screen;

  // ステージ左: 味方の状態を縦列で。防御の枚数・逃走の残りターンは上部ステータスに出すので、
  // ここではバフ・バリアだけを並べる。0 や無しのときは出さない
  if (s.barrier) iconsAlly.append(badge('バリア'));
  if (s.cheerStacks > 0) iconsAlly.append(badge(`鼓舞${s.cheerStacks}`, 'warn'));
  if (s.wardStacks > 0) iconsAlly.append(badge(`ガ${s.wardStacks}`, 'warn'));
  if (s.combo > 0) iconsAlly.append(badge(`コンボ${s.combo}`, 'warn'));

  // ステージ右: 敵の状態を縦列で。耐性・大技とダウン攻撃の予告・ボスの印
  const e = s.enemy;
  if (e.alive) {
    if (e.resist) iconsEnemy.append(badge(e.resist === '物理' ? '物理耐' : '魔法耐'));
    iconsEnemy.append(badge(`大${e.bigCountdown}`, e.bigCountdown === 1 ? 'warn' : ''));
    // ダウン攻撃の予告は大技と別色にする (down クラス)
    if (e.downCountdown !== null) iconsEnemy.append(badge(`ダ${e.downCountdown}`, 'down'));
    if (e.isBoss) iconsEnemy.append(badge('ボス', 'boss'));
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

/** 戦闘中の前衛カード。名前とスキル 2 つのボタンを縦に収める (横並びだと名前が折り返しやすいため) */
function battleSlotCard(slot: BattleView['slots'][number], slotIndex: number): HTMLElement {
  if (!slot) return emptySlotCard();
  const card = document.createElement('div');
  card.className = 'slot-card' + (slot.stunned ? ' stunned' : '');
  const name = document.createElement('p');
  name.className = 'slot-name';
  name.textContent = slot.stunned ? `${slot.name} (気絶)` : slot.name;
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
    // ボタンには折り返さない短縮名 + コストだけを出す。正式名はログ・詳細モーダル側で見せる
    label.textContent = `${sk.shortName}(${sk.cost})`;
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
// 一覧の上部に陣営の絞り込みボタンを置く。行はタップで詳細ポップアップ (モーダル) を開く。
// 行内で展開するアコーディオンだとボタンが見切れて読みにくいので、詳細は別レイヤーに出す。
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
    activeDetail = {
      row: c,
      actionLabel: 'この枠に配置',
      onAction: () => {
        const onPick = picker!.onPick;
        const id = c.id;
        closePicker();
        onPick(id);
      },
    };
    render();
  });
  row.append(head);
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

  // 陣営の絞り込み。該当キャラがいない陣営は押せない
  const filterRow = document.createElement('div');
  filterRow.className = 'picker-filter';
  const options: ('all' | Faction)[] = ['all', ...FACTIONS];
  for (const f of options) {
    const label = f === 'all' ? '全て' : FACTION_NAMES[f];
    const hasAny = f === 'all' || picker.rows.some((r) => r.faction === FACTION_NAMES[f]);
    const btn = navButton(
      label,
      () => {
        pickerFactionFilter = f;
        render();
      },
      !hasAny,
    );
    if (pickerFactionFilter === f) btn.classList.add('active');
    filterRow.append(btn);
  }
  pickerEl.append(filterRow);

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

  const filtered =
    pickerFactionFilter === 'all'
      ? picker.rows
      : picker.rows.filter((r) => r.faction === FACTION_NAMES[pickerFactionFilter as Faction]);
  for (const c of filtered) list.append(buildPickerRow(c));
  pickerEl.append(list);
}

/**
 * 詳細ポップアップ (モーダル)。名前・陣営・レアリティ・攻撃力・体力・スキル 2 つの詳細・
 * パッシブを出す。編成・交代のピッカーと酒場が共有する 1 つのコンポーネントで、
 * 実行ボタンのラベルと挙動 (配置 / 雇用) だけが activeDetail 側で違う
 */
function renderDetailModal(): void {
  detailModalEl.innerHTML = '';
  if (!activeDetail) {
    detailModalEl.hidden = true;
    return;
  }
  detailModalEl.hidden = false;
  const cfg = activeDetail;
  const c = cfg.row;

  const card = document.createElement('div');
  card.className = 'modal-card';

  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('p');
  title.className = 'modal-title';
  title.textContent = `${c.name} (${c.faction} / ${rarityLabel(c.rarity)})`;
  head.append(title);
  card.append(head);

  const scroll = document.createElement('div');
  scroll.className = 'modal-scroll';
  const stats = document.createElement('p');
  stats.className = 'card-sub';
  stats.textContent = `攻撃 ${c.attack} ・ 体力 ${c.vitality}`;
  scroll.append(stats);
  if (c.placedSlot !== null && c.placedSlot !== undefined) {
    const placed = document.createElement('p');
    placed.className = 'card-sub placed';
    placed.textContent = `配置中: 前衛 ${c.placedSlot + 1}`;
    scroll.append(placed);
  }
  for (const sk of c.skillDetails) {
    const p = document.createElement('p');
    p.className = 'picker-skill';
    const note = sk.note ? ` (${sk.note})` : '';
    p.textContent = `${sk.name} [${sk.category} ${sk.cost}] ${sk.effect}${note}`;
    scroll.append(p);
  }
  for (const p of c.passiveDetails) {
    const el = document.createElement('p');
    el.className = 'picker-passive';
    el.textContent = `${p.name}: ${p.effect}`;
    scroll.append(el);
  }
  card.append(scroll);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.textContent = cfg.actionLabel;
  primary.disabled = !!cfg.actionDisabled;
  primary.addEventListener('click', () => {
    activeDetail = null;
    cfg.onAction();
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '閉じる';
  close.addEventListener('click', () => {
    activeDetail = null;
    render();
  });
  actions.append(primary, close);
  card.append(actions);

  detailModalEl.append(card);
}

function openTownFormationPicker(s: TownView, slot: number): void {
  picker = {
    title: `前衛 ${slot + 1} に置くキャラ`,
    rows: s.formation.roster,
    allowClear: true,
    onPick: (id) => act({ type: 'formation-set', slot, id }),
  };
  pickerFactionFilter = 'all';
  activeDetail = null;
  render();
}

function openDungeonFormationPicker(s: DungeonView, slot: number): void {
  picker = {
    title: `前衛 ${slot + 1} に置くキャラ`,
    rows: s.formation.roster,
    allowClear: true,
    onPick: (id) => act({ type: 'dungeon-formation-set', slot, id }),
  };
  pickerFactionFilter = 'all';
  activeDetail = null;
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
  pickerFactionFilter = 'all';
  activeDetail = null;
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

  // 操作は押す頻度で 2 群に分ける。常用群 (ターン終了・防御) は毎ターン押すので大きく上に、
  // 臨時群 (回復薬・編成・逃げる) はたまにしか押さないので小さく下にまとめる。
  // 防御の枚数・逃走の残りターンは上部のステータス欄に出すので、ボタン側に数字は乗せない
  const primary = document.createElement('div');
  primary.className = 'controls-primary';
  primary.append(actionButton('ターン終了', { type: 'battle-end-turn' }));
  primary.append(actionButton('防御', { type: 'battle-defense' }, !s.canDefense));
  controlsEl.append(primary);

  const secondary = document.createElement('div');
  secondary.className = 'controls-secondary';
  secondary.append(actionButton('回復薬', { type: 'potion' }, s.potions <= 0));
  const swapDisabled = s.swapCooldown > 0 || s.reserve.length === 0;
  secondary.append(
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
  secondary.append(actionButton(s.fleeIn !== null ? '離脱取消' : '逃げる', { type: 'battle-flee' }));
  controlsEl.append(secondary);
}

// ---------------------------------------------------------------------------
// 探索の「進む」演出。約 2 秒かけて通路が 3 歩ぶん流れて見せてから、
// ゲーム状態 (advance) を進めてログ・イベントを出す。
// corridor.ts の位相は depth % 4 なので、深度を小数のまま渡せば途中の位相も連続的に描ける。
// game.ts にはタイマーを持ち込まず、ここ (main.ts) だけで完結させる

const ADVANCE_DURATION_MS = 1000;
const ADVANCE_STEPS = 3;

function startAdvanceAnimation(vmBefore: ViewModel): void {
  if (vmBefore.screen.kind !== 'dungeon') return;
  const screen = vmBefore.screen;
  const baseDepth = screen.corridor;

  advancing = true;
  render(); // 操作ボタンを無効化した状態を即座に反映する

  const start = performance.now();
  const frame = (now: number): void => {
    const t = Math.min(1, (now - start) / ADVANCE_DURATION_MS);
    // 通路の描画だけを直接差し替える。render() は呼ばない (呼ぶと通常の corridor に戻ってしまう)
    renderer.draw({ ...vmBefore, screen: { ...screen, corridor: baseDepth + t * ADVANCE_STEPS } });
    if (t < 1) {
      requestAnimationFrame(frame);
      return;
    }
    advancing = false;
    act({ type: 'advance' });
  };
  requestAnimationFrame(frame);
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
    controlsEl.append(actionButton(s.event.action, { type: 'resolve' }, advancing));
    if (s.event.alt) controlsEl.append(actionButton(s.event.alt, { type: 'resolve-alt' }, advancing));
  } else {
    controlsEl.append(navButton('進む', () => startAdvanceAnimation(toViewModel(state)), advancing));
  }
  controlsEl.append(actionButton('引き返す', { type: 'retreat' }, advancing));
  controlsEl.append(actionButton(`回復薬 (${s.potions})`, { type: 'potion' }, advancing || s.potions <= 0));
  controlsEl.append(navButton('編成', () => {
    dungeonFormationOpen = true;
    render();
  }, advancing));
}

function renderTownCluster(s: TownView): void {
  if (page === 'formation') {
    s.formation.slots.forEach((slot, i) =>
      slotsEl.append(tappableSlotCard(slot.character, () => openTownFormationPicker(s, i))),
    );
    controlsEl.append(actionButton('全て外す', { type: 'formation-clear-all' }));
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
  if (vm.screen.kind !== 'dungeon') {
    dungeonFormationOpen = false;
    advancing = false;
  }

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
  renderDetailModal();
}

window.addEventListener('resize', render);
render();
