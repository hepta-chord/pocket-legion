// 戦闘の状態遷移。
//
// game.ts と同じく描画を知らない純ロジックで、乱数は Rng を受け取って消費する。
// Fighter は出撃をまたいで生きるオブジェクトで、魔法・必殺のコスト上昇 (sortieBump) や
// ダウンはここで書き込んだものがそのまま次の戦闘に持ち越される。
// 帰還時のリセットは roster 側の仕事にする。

import type { Faction } from './data/factions';
import { elementOf, type ActionSkillDef, type Element, type PassiveDef } from './data/skills';
import type { Rng } from './rng';
import type { LogLineView } from './view';

export const FRONT_SIZE = 6;
/** マナの払い出しは奇数ターン/偶数ターンで基礎値が違う (2 ターンで 5 の律動) */
export const MANA_BASE_ODD = 2;
export const MANA_BASE_EVEN = 3;
export const MANA_CAP = 10;
export const DEFENSE_COST = 1;
export const DEFENSE_MAX = 4;
/** 防御の枚数ごとの軽減率。0 枚は素通し */
export const DEFENSE_RATES = [0, 0.2, 0.45, 0.7, 0.9] as const;
export const SWAP_COOLDOWN = 3;
/** パーティ最大 HP の、編成に依らない土台 */
export const PARTY_BASE_HP = 2000;

/** 鼓舞・ガード (ward) スタックの共通の骨格。上限枚数と、1 回の付与ぶんの持続ターン */
export const BUFF_STACK_MAX = 3;
export const BUFF_STACK_TURNS = 3;
/** 鼓舞 1 枚あたりの攻撃倍率への加算 */
export const CHEER_RATE_PER_STACK = 0.2;
/** ward 1 枚あたりの被ダメージ軽減率 */
export const WARD_RATE_PER_STACK = 0.2;

// ---------------------------------------------------------------------------
// パーティ

export interface SkillState {
  def: ActionSkillDef;
  /** 物理スキルの上昇ぶん。ターン終了で消える */
  turnBump: number;
  /** 魔法・必殺スキルの上昇ぶん。帰還まで消えない */
  sortieBump: number;
  /** 出撃中 1 回限定のスキルを使ったか */
  spent: boolean;
}

export interface Fighter {
  id: string;
  name: string;
  faction: Faction;
  /** 実効攻撃力。レベルと陣営倍率は roster 側で織り込む */
  attack: number;
  /** パーティ最大 HP への寄与 */
  vitality: number;
  skills: SkillState[];
  passives: PassiveDef[];
  downed: boolean;
  /**
   * スタンで行動不可になっているターン番号の上限。0 は「スタンしていない」。
   * 掛かったターンと次のターンが行動不可になるよう、掛けた側が state.turn + 1 を書き込む。
   * 帰還と回復イベントで 0 に戻す (ダウンと同じ扱い)
   */
  stunnedUntil: number;
}

export interface Party {
  /** 前衛。null は空きスロット */
  front: (Fighter | null)[];
  reserve: Fighter[];
  /** 手動交代の残りクールタイム */
  swapCooldown: number;
}

export function makeSkillState(def: ActionSkillDef): SkillState {
  return { def, turnBump: 0, sortieBump: 0, spent: false };
}

export function newParty(front: Fighter[], reserve: Fighter[] = []): Party {
  const slots: (Fighter | null)[] = front.slice(0, FRONT_SIZE);
  while (slots.length < FRONT_SIZE) slots.push(null);
  return { front: slots, reserve: [...reserve], swapCooldown: 0 };
}

export function partyMaxHp(party: Party): number {
  let sum = PARTY_BASE_HP;
  for (const f of party.front) if (f) sum += f.vitality;
  for (const f of party.reserve) sum += f.vitality;
  return sum;
}

/** 戦闘の合間に空きスロットを控えで埋める。ダンジョン内の立て直しに使う */
export function refillFront(party: Party): void {
  for (let i = 0; i < party.front.length; i++) {
    if (party.front[i]) continue;
    const next = party.reserve.shift();
    if (!next) return;
    party.front[i] = next;
  }
}

/** 前衛のパッシブを合算する。前衛にいる間だけ効く */
function hookSum(party: Party, key: 'manaPerTurn' | 'defenseRate' | 'telegraph'): number {
  let v = 0;
  for (const f of party.front) {
    if (!f) continue;
    for (const p of f.passives) v += p.hooks[key] ?? 0;
  }
  return v;
}

/**
 * 毎ターンのマナの払い出し。基礎は奇数ターン 2 / 偶数ターン 3。
 * bonus (GameState.manaBonus) は成長要素で、奇数ターンの基礎に乗る
 * (中層クリアで +1 して奇数側が 3 になり、奇偶とも 3/3 になる)
 */
export function manaPayout(party: Party, turn: number, bonus: number): number {
  const base = turn % 2 === 1 ? MANA_BASE_ODD + bonus : MANA_BASE_EVEN;
  return Math.max(0, base + hookSum(party, 'manaPerTurn'));
}

// ---------------------------------------------------------------------------
// バフのスタック (鼓舞・ガード、敵の自己鼓舞・自己防御も同じ骨格を使う)

export interface BuffStack {
  /** 積んだ枚数。BUFF_STACK_MAX が上限 */
  stacks: number;
  /** 残りターン数。重ねがけで BUFF_STACK_TURNS に戻る */
  turns: number;
}

function emptyBuffStack(): BuffStack {
  return { stacks: 0, turns: 0 };
}

/** 重ねがけ。上限まで積み、残りターンは満タンに戻る */
function addBuffStack(buff: BuffStack, add: number): void {
  buff.stacks = Math.min(BUFF_STACK_MAX, buff.stacks + add);
  buff.turns = BUFF_STACK_TURNS;
}

/** ターン明けの整理。0 になったら stacks も 0 に戻す */
function tickBuffStack(buff: BuffStack): void {
  if (buff.turns <= 0) return;
  buff.turns -= 1;
  if (buff.turns <= 0) buff.stacks = 0;
}

// ---------------------------------------------------------------------------
// 敵

export type EnemyAction =
  | { kind: 'attack' }
  | { kind: 'big' }
  | { kind: 'downstrike' }
  /** 巻き込む人数は rng.int(min, max)。区画で変える */
  | { kind: 'stun'; min: number; max: number }
  /** 自分を強化する (攻撃力アップ) */
  | { kind: 'cheer' }
  /** 自分の被ダメージを下げる */
  | { kind: 'ward' };

export interface EnemyDef {
  id: string;
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  /** 該当属性のダメージを半減する。隠さず表示する */
  resist: Element | null;
  /** 大技を使う間隔 (ターン) */
  bigEvery: number;
  /** 大技の威力。通常攻撃に対する倍率。大技はダウンを起こさない */
  bigMul: number;
  /** 大技の名前。予告バッジに書き下す (「大N」ではなく実際の技名を見せるため)。
   * ボスは固有の名前を持たせ、雑魚は「大技」のような総称でよい */
  bigName: string;
  /** ダウン攻撃の間隔 (ターン)。null なら持たない。防御・ward では防げず、バリアと身代わりだけが対抗手段 */
  downEvery: number | null;
  /**
   * 大技・ダウン攻撃以外の「通常行動」の候補。雑魚は毎ターンここから 1 回、
   * ボスは大技・ダウン攻撃のターン以外は 2 回引く (attack / stun / cheer / ward)
   */
  pattern: EnemyAction[];
  /**
   * 元の頭数。敵は常に 1 体として戦うが、群れの規模は全体攻撃の威力に効かせる
   * (敵の表示にもそのまま出す)。1 なら単体
   */
  groupSize: number;
  isBoss: boolean;
}

export interface EnemyState {
  def: EnemyDef;
  hp: number;
  /** 大技まであと何ターンか。予告としてそのまま表示する */
  bigCountdown: number;
  /** ダウン攻撃まであと何ターンか。持たない敵は null */
  downCountdown: number | null;
  /** 敵の自己鼓舞・自己防御。プレイヤー側の鼓舞・ward と同じ骨格 */
  cheer: BuffStack;
  ward: BuffStack;
  /**
   * 次ターンに取る行動。戦闘開始時とターン終了時にあらかじめ引いておき、
   * 表示 (次ターン予告) と実際の行動を一致させる。大技・ダウン攻撃のターンは要素 1 つ、
   * それ以外は雑魚 1 個・ボス 2 個 (通常行動を 2 回行うため)
   */
  nextActions: EnemyAction[];
}

// ---------------------------------------------------------------------------
// 戦闘の状態

export type BattleOutcome = 'ongoing' | 'victory' | 'wipe' | 'annihilated' | 'fled';

export interface BattleState {
  party: Party;
  /** パーティ HP。出撃をまたぐ値なので、戦闘後に呼び出し側が回収する */
  hp: number;
  maxHp: number;
  /** 敵は常に 1 体。対象選択を無くすための仕様なので単数で持つ */
  enemy: EnemyState;
  mana: number;
  /** マナ払い出しの成長ぶん (GameState.manaBonus)。startBattle で渡され、endTurn の payout に乗る */
  manaBonus: number;
  /** このターンに積んだ防御の枚数 */
  defense: number;
  /**
   * バリア。張ると次に来る敵の攻撃 (通常・大技・ダウン攻撃どれも) を 1 回まるごと無効化し、
   * ダウンも防いで自身は消費される。予告を見てから張る札にするため、
   * 防御と違ってターン終了では消さずターンをまたいで残す
   */
  barrier: boolean;
  /** 鼓舞スタック。攻撃 +20%/枚、3 枚まで */
  cheer: BuffStack;
  /** ward スタック。被ダメージ -20%/枚、3 枚まで。防御とは掛け算で重なる */
  ward: BuffStack;
  turn: number;
  /**
   * 同一ターン内で攻撃が命中した回数。攻撃の基礎ダメージに (1 + 0.15 * combo) を掛け、
   * 命中のたび 1 増える。回復・支援・バリアは数えず、途切れさせもしない。
   * ターン終了で 0 に戻る (defense と同じ扱い)
   */
  combo: number;
  /** 逃げるの宣言から発動までの残りターン。null は宣言していない */
  fleeIn: number | null;
  outcome: BattleOutcome;
  log: LogLineView[];
  /** バランス計測用の集計 */
  stats: { swaps: number; downs: number };
  /**
   * ダウンして Party (front / reserve) から完全に外れた Fighter。
   * downSlot / swapMembers で外れた本人をここに積む。捨てると出撃中の回復イベントで
   * 復帰させる手段が無くなるため、呼び出し側 (game.ts) がここから回収して
   * RunState.downed に積み直す形にする。回収後は呼び出し側が空にすること
   */
  left: Fighter[];
}

const LOG_LIMIT = 30;

function addLog(state: BattleState, kind: LogLineView['kind'], text: string): void {
  state.log.push({ kind, text });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

/**
 * battle.log へ 1 行足す、外部 (game.ts) 向けの窓口。
 * 大技・ダウン攻撃 1 ターン前のアナウンスのように、ルールそのものではなく戦況から作る文言を
 * endTurn の直後に足したいときに使う。ここでしか battle.log に触れないよう集約しておく
 */
export function logBattle(state: BattleState, kind: LogLineView['kind'], text: string): void {
  addLog(state, kind, text);
}

/**
 * 物理スキルの turnBump はターン明けでしか戻らないので、戦闘がプレイヤーの行動中に
 * 勝利で終わる (endTurn を経由しない) と上がったまま次の戦闘に持ち越ってしまう。
 * 戦闘開始のたびに前衛・控え全員ぶん 0 に戻して、素のコストで始まるようにする。
 *
 * スタン (stunnedUntil) も同じタイミングでここで解除する。スタンはダウンより軽い
 * 「手数を削るだけ」の状態で、戦闘をまたいで残すほどの重さではない。
 * ターン番号は戦闘ごとに 1 から数え直すので、スタンを持ち越すとターン番号の意味が
 * 戦闘ごとにずれて扱いにくくなる、という理由もある
 */
function resetTurnBumps(party: Party): void {
  for (const f of [...party.front, ...party.reserve]) {
    if (!f) continue;
    for (const s of f.skills) s.turnBump = 0;
    f.stunnedUntil = 0;
  }
}

/**
 * manaBonus は GameState 側の成長要素。省略時は 0 (テストや素の戦闘生成の既定値)。
 * rng は初手の「次ターンの行動」を引くのに使う (敵の予告と実際の行動を一致させるため、
 * 通常行動の抽選は実行の 1 ターン前に済ませておく)
 */
export function startBattle(party: Party, hp: number, maxHp: number, enemyDef: EnemyDef, rng: Rng, manaBonus = 0): BattleState {
  party.swapCooldown = 0;
  resetTurnBumps(party);
  const telegraph = hookSum(party, 'telegraph');
  const enemy: EnemyState = {
    def: enemyDef,
    hp: enemyDef.maxHp,
    bigCountdown: Math.max(1, enemyDef.bigEvery + telegraph),
    downCountdown: enemyDef.downEvery !== null ? Math.max(1, enemyDef.downEvery + telegraph) : null,
    cheer: emptyBuffStack(),
    ward: emptyBuffStack(),
    nextActions: [],
  };
  enemy.nextActions = rollNextActions(enemy, rng);
  const state: BattleState = {
    party,
    hp,
    maxHp,
    enemy,
    mana: 0,
    manaBonus,
    defense: 0,
    barrier: false,
    cheer: emptyBuffStack(),
    ward: emptyBuffStack(),
    turn: 1,
    combo: 0,
    fleeIn: null,
    outcome: 'ongoing',
    log: [],
    stats: { swaps: 0, downs: 0 },
    left: [],
  };
  state.mana = Math.min(MANA_CAP, manaPayout(party, state.turn, manaBonus));
  return state;
}

/** 出撃中1回限定・出撃を通したコスト上昇 (sortieBump) を戻す。回復イベント (泉・ボス前の回復) の仕事 */
export function resetSortieProgress(party: Party): void {
  for (const f of [...party.front, ...party.reserve]) {
    if (!f) continue;
    for (const s of f.skills) {
      s.sortieBump = 0;
      s.spent = false;
    }
  }
}

// ---------------------------------------------------------------------------
// プレイヤーの行動

export function effectiveCost(s: SkillState): number {
  return s.def.baseCost + s.turnBump + s.sortieBump;
}

function isStunned(state: BattleState, f: Fighter): boolean {
  return f.stunnedUntil > 0 && state.turn <= f.stunnedUntil;
}

/** 使えないときはその理由を返す。UI がボタンの無効化と表示に使う */
export function whyCannotUse(state: BattleState, slot: number, skillIndex: number): string | null {
  if (state.outcome !== 'ongoing') return '戦闘は終わっている';
  const f = state.party.front[slot];
  if (!f) return '空きスロット';
  if (isStunned(state, f)) return '気絶している';
  const s = f.skills[skillIndex];
  if (!s) return 'スキルがない';
  if (s.def.oncePerSortie && s.spent) return 'この出撃ではもう使えない';
  // バリアは同時に 1 枚しか持てない。マナを無駄にしないよう発動自体を止める
  if (s.def.effect.kind === 'barrier' && state.barrier) return 'バリアは既にある';
  if (effectiveCost(s) > state.mana) return 'マナが足りない';
  return null;
}

function hitEnemy(state: BattleState, attacker: Fighter, def: ActionSkillDef, enemy: EnemyState, rng: Rng): void {
  if (def.effect.kind !== 'attack') return;
  // コンボはその攻撃の発動時点の値を使う。1 発目は等倍、2 発目 +15%、3 発目 +30% ...
  const comboMul = 1 + 0.15 * state.combo;
  const cheerMul = 1 + CHEER_RATE_PER_STACK * state.cheer.stacks;
  let base = attacker.attack * def.effect.power * cheerMul * comboMul;
  // 敵は 1 体にまとめて表すが、全体攻撃は元の頭数 (groupSize) ぶん威力が伸びる。
  // でないと「群れに強い」という全体攻撃の性格が消えるため
  if (def.effect.target === 'all') base *= 1 + 0.3 * (enemy.def.groupSize - 1);
  let dmg = Math.round(base * (0.6 + 0.4 * rng.next())) - enemy.def.defense;
  // 敵の自己防御 (ward)。プレイヤーの防御・ward と同じ「積むほど軽減」の考え方を敵にも適用する
  dmg = Math.round(dmg * (1 - WARD_RATE_PER_STACK * enemy.ward.stacks));
  const resisted = enemy.def.resist === elementOf(def);
  if (resisted) dmg = Math.round(dmg / 2);
  dmg = Math.max(1, dmg);
  enemy.hp = Math.max(0, enemy.hp - dmg);
  state.combo += 1;
  const note = resisted ? ' (耐性)' : '';
  addLog(state, 'good', `${attacker.name} の${def.name}。${enemy.def.name} に ${dmg}${note}。`);
}

/** 戦闘中に使う回復薬。マナもコンボも動かさない、battle.ts の外にある持ち物の効果 */
export function usePotion(state: BattleState): number {
  if (state.outcome !== 'ongoing') return 0;
  const back = Math.round(state.maxHp / 2);
  const before = state.hp;
  state.hp = Math.min(state.maxHp, state.hp + back);
  return state.hp - before;
}

function checkVictory(state: BattleState): void {
  if (state.outcome !== 'ongoing') return;
  if (state.enemy.hp <= 0) {
    state.outcome = 'victory';
    addLog(state, 'good', '敵を討ち果たした。');
  }
}

export function useSkill(state: BattleState, slot: number, skillIndex: number, rng: Rng): boolean {
  if (whyCannotUse(state, slot, skillIndex) !== null) return false;
  const f = state.party.front[slot]!;
  const s = f.skills[skillIndex];
  state.mana -= effectiveCost(s);

  // 系統ごとのコスト上昇。魔法・必殺は青天井で、ここが出撃を通した消耗の正体になる。
  // 物理は +1 で頭打ちにして、2 発目からは 1 マナで連打できる主力の手数にする。
  // 鼓舞・ガード (ward) も物理と同じ扱い (category: 'physical') にして、出撃を通した消耗はさせない
  if (s.def.category === 'physical') s.turnBump = Math.min(1, s.turnBump + 1);
  else s.sortieBump += 1;
  if (s.def.oncePerSortie) s.spent = true;

  const e = s.def.effect;
  if (e.kind === 'attack') {
    if (state.enemy.hp > 0) hitEnemy(state, f, s.def, state.enemy, rng);
  } else if (e.kind === 'heal') {
    const back = Math.round(state.maxHp * e.power);
    state.hp = Math.min(state.maxHp, state.hp + back);
    addLog(state, 'good', `${f.name} の${s.def.name}。${back} 回復した。`);
  } else if (e.kind === 'cheer') {
    addBuffStack(state.cheer, e.stacks);
    addLog(state, 'good', `${f.name} の${s.def.name}。鼓舞が ${state.cheer.stacks} 枚になった。`);
  } else if (e.kind === 'ward') {
    addBuffStack(state.ward, e.stacks);
    addLog(state, 'good', `${f.name} の${s.def.name}。ガードが ${state.ward.stacks} 枚になった。`);
  } else if (e.kind === 'barrier') {
    state.barrier = true;
    addLog(state, 'good', `${f.name} の${s.def.name}。バリアを張った。`);
  } else {
    // stun-self: 将来、味方スキルの代償として使う枠。今回は敵専用の仕組みだが型だけ用意しておく
    f.stunnedUntil = Math.max(f.stunnedUntil, state.turn + 1);
    addLog(state, 'warn', `${f.name} の${s.def.name}。代償で気絶した。`);
  }

  // selfDown は自分で選んで払う代償なので、身代わりの肩代わり (coverable) は効かせない
  if (s.def.selfDown) downSlot(state, slot, rng, '代償に', false);
  checkVictory(state);
  return true;
}

export function useDefense(state: BattleState): boolean {
  if (state.outcome !== 'ongoing') return false;
  if (state.defense >= DEFENSE_MAX) return false;
  if (state.mana < DEFENSE_COST) return false;
  state.mana -= DEFENSE_COST;
  state.defense += 1;
  return true;
}

function defenseRate(state: BattleState): number {
  if (state.defense === 0) return 0;
  return Math.min(0.95, DEFENSE_RATES[state.defense] + hookSum(state.party, 'defenseRate'));
}

function wardRate(state: BattleState): number {
  return WARD_RATE_PER_STACK * state.ward.stacks;
}

/** 防御と ward の軽減率は掛け算で重ねる (防御 4 枚 0.1 × ward 3 枚 0.4 = 0.04 で被害 4%) */
function damageReduction(state: BattleState): number {
  return (1 - defenseRate(state)) * (1 - wardRate(state));
}

/** 逃げるの宣言・キャンセルのトグル。マナは要らず、戦闘中いつでも押せる */
export function toggleFlee(state: BattleState, rng: Rng): boolean {
  if (state.outcome !== 'ongoing') return false;
  if (state.fleeIn === null) {
    state.fleeIn = rng.int(1, 3);
    addLog(state, 'warn', `離脱を試みる。あと ${state.fleeIn} ターンで抜ける。`);
  } else {
    state.fleeIn = null;
    addLog(state, 'info', '離脱を取りやめた。');
  }
  return true;
}

export interface SwapMove {
  slot: number;
  reserveId: string;
}

/**
 * 手動交代。一度に何人でも入れ替えられるが、実行するとクールタイムがかかる。
 * 下がったキャラはダウン扱いで、空きスロットへの補充にも同じ 1 回を使う。
 * スタン中のキャラは行動もスキルも選べないのと同じ理由で、交代の対象にも選べない。
 */
export function swapMembers(state: BattleState, moves: SwapMove[]): boolean {
  const party = state.party;
  if (state.outcome !== 'ongoing') return false;
  if (party.swapCooldown > 0) return false;
  if (moves.length === 0) return false;

  const slots = new Set<number>();
  const ids = new Set<string>();
  for (const m of moves) {
    if (m.slot < 0 || m.slot >= FRONT_SIZE) return false;
    if (slots.has(m.slot) || ids.has(m.reserveId)) return false;
    if (!party.reserve.some((r) => r.id === m.reserveId)) return false;
    const current = party.front[m.slot];
    if (current && isStunned(state, current)) return false;
    slots.add(m.slot);
    ids.add(m.reserveId);
  }

  for (const m of moves) {
    const idx = party.reserve.findIndex((r) => r.id === m.reserveId);
    const entering = party.reserve.splice(idx, 1)[0];
    const leaving = party.front[m.slot];
    party.front[m.slot] = entering;
    if (leaving) {
      leaving.downed = true;
      state.stats.downs += 1;
      state.left.push(leaving);
      addLog(state, 'warn', `${leaving.name} が下がってダウン。${entering.name} が前に出た。`);
    } else {
      addLog(state, 'info', `${entering.name} が空いた枠に入った。`);
    }
  }
  party.swapCooldown = SWAP_COOLDOWN;
  state.stats.swaps += moves.length;
  return true;
}

// ---------------------------------------------------------------------------
// ダウン

/**
 * ダウンさせ、控えの同陣営からランダムに 1 人を自動で入れる。
 * 同陣営が残っていなければ空きスロットになり、前衛がすべて空くと全滅扱いで負ける。
 *
 * coverable が true (ボスの大技によるダウン) のときだけ、身代わり (cover) を持つ
 * キャラが前衛にいれば肩代わりする。自己ダウン代償のスキルは自分で選んで払う代償、
 * 手動交代はプレイヤーが選んで下げる行為なので、どちらも肩代わりの対象にしない。
 */
function downSlot(state: BattleState, slot: number, rng: Rng, cause: string, coverable: boolean): void {
  const party = state.party;
  if (coverable) {
    // 身代わり役は前衛の先頭にいる 1 人。複数いても最初に見つかった 1 人が引き受ける
    const coverSlot = party.front.findIndex(
      (m, i) => m && i !== slot && m.passives.some((p) => p.hooks.cover),
    );
    if (coverSlot >= 0) slot = coverSlot;
  }

  const f = party.front[slot];
  if (!f) return;
  f.downed = true;
  state.stats.downs += 1;
  state.left.push(f);

  const candidates = party.reserve.filter((r) => r.faction === f.faction);
  if (candidates.length > 0) {
    const pick = rng.pick(candidates);
    party.reserve.splice(party.reserve.indexOf(pick), 1);
    party.front[slot] = pick;
    addLog(state, 'warn', `${f.name} が${cause}ダウン。${pick.name} が続いた。`);
  } else {
    party.front[slot] = null;
    addLog(state, 'warn', `${f.name} が${cause}ダウン。埋める者がいない。`);
  }

  if (party.front.every((x) => x === null)) {
    state.outcome = 'annihilated';
    addLog(state, 'bad', '前衛が絶えた。');
  }
}

// ---------------------------------------------------------------------------
// 敵の行動

function occupiedSlots(party: Party): number[] {
  return party.front.flatMap((f, i) => (f ? [i] : []));
}

/** 重複無しで n 件抜く (敵のスタンが巻き込む人数を選ぶのに使う) */
function pickDistinct(pool: readonly number[], n: number, rng: Rng): number[] {
  const remaining = [...pool];
  const out: number[] = [];
  for (let i = 0; i < n && remaining.length > 0; i++) {
    const idx = rng.int(0, remaining.length - 1);
    out.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return out;
}

function enemyCheerMul(enemy: EnemyState): number {
  return 1 + CHEER_RATE_PER_STACK * enemy.cheer.stacks;
}

/** 大技。防御・ward の軽減は乗るが、ダウンは起こさない (guardBreak は廃止) */
function doBig(state: BattleState, enemy: EnemyState): void {
  if (state.barrier) {
    state.barrier = false;
    addLog(state, 'good', `バリアが${enemy.def.name}の大技を防いだ。`);
    return;
  }
  const raw = enemy.def.attack * enemy.def.bigMul * enemyCheerMul(enemy);
  const dmg = Math.max(0, Math.round(raw * damageReduction(state)));
  state.hp = Math.max(0, state.hp - dmg);
  addLog(state, 'bad', `${enemy.def.name} の大技。${dmg} 受けた。`);
}

/** ダウン攻撃。防御・ward では防げず、バリアと身代わりだけが対抗手段 */
function doDownstrike(state: BattleState, enemy: EnemyState, rng: Rng): void {
  if (state.barrier) {
    state.barrier = false;
    addLog(state, 'good', `バリアが${enemy.def.name}のダウン攻撃を防いだ。`);
    return;
  }
  const raw = enemy.def.attack * enemyCheerMul(enemy) * (0.5 + 0.5 * rng.next());
  const dmg = Math.max(0, Math.round(raw));
  state.hp = Math.max(0, state.hp - dmg);
  addLog(state, 'bad', `${enemy.def.name} のダウン攻撃。${dmg} 受けた。`);
  const occupied = occupiedSlots(state.party);
  if (occupied.length > 0) downSlot(state, rng.pick(occupied), rng, 'ダウン攻撃で', true);
}

/**
 * 大技・ダウン攻撃以外の通常行動を 1 回分適用する。
 * action は「次ターンの予告」として 1 ターン前に引いておいた値をそのまま渡す
 * (ここで新たに rng.pick すると、予告と実際の行動がずれてしまう)
 */
function applyNormalAction(state: BattleState, enemy: EnemyState, action: EnemyAction, rng: Rng): void {
  switch (action.kind) {
    case 'attack': {
      if (state.barrier) {
        state.barrier = false;
        addLog(state, 'good', `バリアが${enemy.def.name}の攻撃を防いだ。`);
        return;
      }
      const raw = enemy.def.attack * enemyCheerMul(enemy) * (0.5 + 0.5 * rng.next());
      const dmg = Math.max(0, Math.round(raw * damageReduction(state)));
      state.hp = Math.max(0, state.hp - dmg);
      addLog(state, 'bad', `${enemy.def.name} の攻撃。${dmg} 受けた。`);
      return;
    }
    case 'stun': {
      const occupied = occupiedSlots(state.party);
      const count = Math.min(occupied.length, rng.int(action.min, action.max));
      const targets = pickDistinct(occupied, count, rng);
      const names: string[] = [];
      for (const slot of targets) {
        const f = state.party.front[slot];
        if (!f) continue;
        f.stunnedUntil = Math.max(f.stunnedUntil, state.turn + 1);
        names.push(f.name);
      }
      if (names.length > 0) addLog(state, 'warn', `${enemy.def.name} のスタン。${names.join('・')} が気絶した。`);
      return;
    }
    case 'cheer':
      addBuffStack(enemy.cheer, 1);
      addLog(state, 'warn', `${enemy.def.name} が自らを鼓舞した。`);
      return;
    case 'ward':
      addBuffStack(enemy.ward, 1);
      addLog(state, 'warn', `${enemy.def.name} が身を固めた。`);
      return;
    case 'big':
    case 'downstrike':
      // pattern (通常行動の候補) には入れない値。ここに来ることは無いが型のための保険
      return;
  }
}

/**
 * 次ターンに取る行動を引く。bigCountdown / downCountdown は「あと 1」で次ターンに発動する
 * (resolveEnemyTurn が毎ターン先頭で 1 減らしてから判定するのと同じしきい値)。
 * 大技・ダウン攻撃のターンは要素 1 つ、それ以外は通常行動 (attack/stun/cheer/ward) を
 * 雑魚 1 回・ボス 2 回ぶん引く。これを実行の 1 ターン前に済ませておくことで、
 * 予告表示と実際の行動を一致させる (乱数の消費順は変わるが、ルールの結果は変えない)
 */
function rollNextActions(enemy: EnemyState, rng: Rng): EnemyAction[] {
  if (enemy.bigCountdown <= 1) return [{ kind: 'big' }];
  if (enemy.downCountdown !== null && enemy.downCountdown <= 1) return [{ kind: 'downstrike' }];
  const times = enemy.def.isBoss ? 2 : 1;
  const pattern = enemy.def.pattern.length > 0 ? enemy.def.pattern : ([{ kind: 'attack' }] as EnemyAction[]);
  const actions: EnemyAction[] = [];
  for (let i = 0; i < times; i++) actions.push(rng.pick(pattern));
  return actions;
}

/**
 * 敵の 1 ターンぶんの行動。大技・ダウン攻撃はそれぞれ別のカウントダウンで管理し、
 * どちらのターンでもなければ、1 ターン前に引いておいた nextActions (通常行動) を実行する。
 * 最後に次ターンぶんの nextActions を引き直し、予告を更新する。
 */
function resolveEnemyTurn(state: BattleState, enemy: EnemyState, rng: Rng): void {
  enemy.bigCountdown -= 1;
  if (enemy.bigCountdown <= 0) {
    doBig(state, enemy);
    enemy.bigCountdown = enemy.def.bigEvery;
    enemy.nextActions = rollNextActions(enemy, rng);
    return;
  }

  if (enemy.downCountdown !== null) {
    enemy.downCountdown -= 1;
    if (enemy.downCountdown <= 0) {
      doDownstrike(state, enemy, rng);
      enemy.downCountdown = enemy.def.downEvery ?? enemy.def.bigEvery;
      enemy.nextActions = rollNextActions(enemy, rng);
      return;
    }
  }

  for (const action of enemy.nextActions) {
    if (state.outcome !== 'ongoing' || state.hp <= 0) break;
    applyNormalAction(state, enemy, action, rng);
  }
  enemy.nextActions = rollNextActions(enemy, rng);
}

// ---------------------------------------------------------------------------
// ターンの終了 (敵の行動と明けの整理)

export function endTurn(state: BattleState, rng: Rng): void {
  if (state.outcome !== 'ongoing') return;
  const enemy = state.enemy;

  if (enemy.hp > 0) {
    resolveEnemyTurn(state, enemy, rng);

    if (state.hp <= 0) {
      state.outcome = 'wipe';
      addLog(state, 'bad', '部隊は崩れ落ちた。');
      return;
    }
    if (state.outcome !== 'ongoing') return;
  }

  // 逃げるの進行。敵の行動が終わったあとに 1 減らす。凌ぎきれば発動して戦闘が終わる
  if (state.fleeIn !== null) {
    state.fleeIn -= 1;
    if (state.fleeIn <= 0) {
      state.outcome = 'fled';
      addLog(state, 'info', '戦線を離脱した。');
      return;
    }
  }

  // ターン明けの整理。バリアは予告を見てから張る札にするため、ここでは消さない
  state.turn += 1;
  state.defense = 0;
  state.combo = 0;
  tickBuffStack(state.cheer);
  tickBuffStack(state.ward);
  tickBuffStack(enemy.cheer);
  tickBuffStack(enemy.ward);
  for (const f of [...state.party.front, ...state.party.reserve]) {
    if (!f) continue;
    for (const s of f.skills) s.turnBump = 0;
  }
  state.party.swapCooldown = Math.max(0, state.party.swapCooldown - 1);
  state.mana = Math.min(MANA_CAP, state.mana + manaPayout(state.party, state.turn, state.manaBonus));
}
