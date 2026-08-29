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
export const MANA_PER_TURN = 3;
export const MANA_CAP = 10;
export const GUARD_COST = 1;
export const GUARD_MAX = 4;
/** ガードの枚数ごとの軽減率。0 枚は素通し */
export const GUARD_RATES = [0, 0.4, 0.6, 0.75, 0.85] as const;
export const SWAP_COOLDOWN = 3;
/** パーティ最大 HP の、編成に依らない土台 */
export const PARTY_BASE_HP = 30;

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
function hookSum(party: Party, key: 'manaPerTurn' | 'guardRate' | 'telegraph'): number {
  let v = 0;
  for (const f of party.front) {
    if (!f) continue;
    for (const p of f.passives) v += p.hooks[key] ?? 0;
  }
  return v;
}

export function manaPayout(party: Party): number {
  return Math.max(0, MANA_PER_TURN + hookSum(party, 'manaPerTurn'));
}

// ---------------------------------------------------------------------------
// 敵

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
  /** 大技の威力。通常攻撃に対する倍率 */
  bigMul: number;
}

export interface EnemyState {
  def: EnemyDef;
  hp: number;
  /** 大技まであと何ターンか。予告としてそのまま表示する */
  countdown: number;
}

// ---------------------------------------------------------------------------
// 戦闘の状態

export type BattleOutcome = 'ongoing' | 'victory' | 'wipe' | 'annihilated';

export interface BattleState {
  party: Party;
  /** パーティ HP。出撃をまたぐ値なので、戦闘後に呼び出し側が回収する */
  hp: number;
  maxHp: number;
  enemies: EnemyState[];
  mana: number;
  /** このターンに積んだガードの枚数 */
  guard: number;
  /** 支援スキルによるターン中の攻撃倍率への加算 */
  buff: number;
  turn: number;
  outcome: BattleOutcome;
  log: LogLineView[];
  /** バランス計測用の集計 */
  stats: { swaps: number; downs: number };
}

const LOG_LIMIT = 30;

function addLog(state: BattleState, kind: LogLineView['kind'], text: string): void {
  state.log.push({ kind, text });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

export function startBattle(party: Party, hp: number, maxHp: number, enemyDefs: EnemyDef[]): BattleState {
  party.swapCooldown = 0;
  const telegraph = hookSum(party, 'telegraph');
  const state: BattleState = {
    party,
    hp,
    maxHp,
    enemies: enemyDefs.map((d) => ({
      def: d,
      hp: d.maxHp,
      countdown: Math.max(1, d.bigEvery + telegraph),
    })),
    mana: 0,
    guard: 0,
    buff: 0,
    turn: 1,
    outcome: 'ongoing',
    log: [],
    stats: { swaps: 0, downs: 0 },
  };
  state.mana = Math.min(MANA_CAP, manaPayout(party));
  return state;
}

// ---------------------------------------------------------------------------
// プレイヤーの行動

export function effectiveCost(s: SkillState): number {
  return s.def.baseCost + s.turnBump + s.sortieBump;
}

/** 使えないときはその理由を返す。UI がボタンの無効化と表示に使う */
export function whyCannotUse(state: BattleState, slot: number, skillIndex: number): string | null {
  if (state.outcome !== 'ongoing') return '戦闘は終わっている';
  const f = state.party.front[slot];
  if (!f) return '空きスロット';
  const s = f.skills[skillIndex];
  if (!s) return 'スキルがない';
  if (s.def.oncePerSortie && s.spent) return 'この出撃ではもう使えない';
  if (effectiveCost(s) > state.mana) return 'マナが足りない';
  return null;
}

function pickTarget(state: BattleState, wanted: number): EnemyState | null {
  const at = state.enemies[wanted];
  if (at && at.hp > 0) return at;
  return state.enemies.find((e) => e.hp > 0) ?? null;
}

function hitEnemy(state: BattleState, attacker: Fighter, def: ActionSkillDef, enemy: EnemyState, rng: Rng): void {
  if (def.effect.kind !== 'attack') return;
  const base = attacker.attack * def.effect.power * (1 + state.buff);
  let dmg = Math.round(base * (0.6 + 0.4 * rng.next())) - enemy.def.defense;
  const resisted = enemy.def.resist === elementOf(def);
  if (resisted) dmg = Math.round(dmg / 2);
  dmg = Math.max(1, dmg);
  enemy.hp = Math.max(0, enemy.hp - dmg);
  const note = resisted ? ' (耐性)' : '';
  addLog(state, 'good', `${attacker.name} の${def.name}。${enemy.def.name} に ${dmg}${note}。`);
}

function checkVictory(state: BattleState): void {
  if (state.outcome !== 'ongoing') return;
  if (state.enemies.every((e) => e.hp <= 0)) {
    state.outcome = 'victory';
    addLog(state, 'good', '敵を討ち果たした。');
  }
}

export function useSkill(state: BattleState, slot: number, skillIndex: number, rng: Rng, target = 0): boolean {
  if (whyCannotUse(state, slot, skillIndex) !== null) return false;
  const f = state.party.front[slot]!;
  const s = f.skills[skillIndex];
  state.mana -= effectiveCost(s);

  // 系統ごとのコスト上昇。ここが消耗の正体になる
  if (s.def.category === 'physical') s.turnBump += 1;
  else s.sortieBump += 1;
  if (s.def.oncePerSortie) s.spent = true;

  const e = s.def.effect;
  if (e.kind === 'attack') {
    if (e.target === 'all') {
      for (const enemy of state.enemies) if (enemy.hp > 0) hitEnemy(state, f, s.def, enemy, rng);
    } else {
      const enemy = pickTarget(state, target);
      if (enemy) hitEnemy(state, f, s.def, enemy, rng);
    }
  } else if (e.kind === 'heal') {
    const back = Math.round(state.maxHp * e.power);
    state.hp = Math.min(state.maxHp, state.hp + back);
    addLog(state, 'good', `${f.name} の${s.def.name}。${back} 回復した。`);
  } else {
    state.buff += e.power;
    addLog(state, 'good', `${f.name} の${s.def.name}。攻めが乗った。`);
  }

  if (s.def.selfDown) downSlot(state, slot, rng, '代償に');
  checkVictory(state);
  return true;
}

export function useGuard(state: BattleState): boolean {
  if (state.outcome !== 'ongoing') return false;
  if (state.guard >= GUARD_MAX) return false;
  if (state.mana < GUARD_COST) return false;
  state.mana -= GUARD_COST;
  state.guard += 1;
  return true;
}

function guardRate(state: BattleState): number {
  if (state.guard === 0) return 0;
  return Math.min(0.95, GUARD_RATES[state.guard] + hookSum(state.party, 'guardRate'));
}

export interface SwapMove {
  slot: number;
  reserveId: string;
}

/**
 * 手動交代。一度に何人でも入れ替えられるが、実行するとクールタイムがかかる。
 * 下がったキャラはダウン扱いで、空きスロットへの補充にも同じ 1 回を使う。
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
 */
function downSlot(state: BattleState, slot: number, rng: Rng, cause: string): void {
  const party = state.party;
  const f = party.front[slot];
  if (!f) return;
  f.downed = true;
  state.stats.downs += 1;

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
// ターンの終了 (敵の行動と明けの整理)

export function endTurn(state: BattleState, rng: Rng): void {
  if (state.outcome !== 'ongoing') return;
  const rate = guardRate(state);

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    enemy.countdown -= 1;

    if (enemy.countdown <= 0) {
      // 大技。ガードが 1 枚でも成立していればダウンは防げる
      const raw = enemy.def.attack * enemy.def.bigMul;
      const dmg = Math.max(0, Math.round(raw * (1 - rate)));
      state.hp = Math.max(0, state.hp - dmg);
      addLog(state, 'bad', `${enemy.def.name} の大技。${dmg} 受けた。`);
      if (state.guard === 0) {
        const occupied = state.party.front.flatMap((f, i) => (f ? [i] : []));
        if (occupied.length > 0) downSlot(state, rng.pick(occupied), rng, '大技で');
      } else {
        addLog(state, 'good', 'ガードがダウンを防いだ。');
      }
      enemy.countdown = enemy.def.bigEvery;
    } else {
      const raw = Math.round(enemy.def.attack * (0.5 + 0.5 * rng.next()));
      const dmg = Math.max(0, Math.round(raw * (1 - rate)));
      state.hp = Math.max(0, state.hp - dmg);
      addLog(state, 'bad', `${enemy.def.name} の攻撃。${dmg} 受けた。`);
    }

    if (state.hp <= 0) {
      state.outcome = 'wipe';
      addLog(state, 'bad', '部隊は崩れ落ちた。');
      return;
    }
    if (state.outcome !== 'ongoing') return;
  }

  // ターン明けの整理
  state.turn += 1;
  state.guard = 0;
  state.buff = 0;
  for (const f of [...state.party.front, ...state.party.reserve]) {
    if (!f) continue;
    for (const s of f.skills) s.turnBump = 0;
  }
  state.party.swapCooldown = Math.max(0, state.party.swapCooldown - 1);
  state.mana = Math.min(MANA_CAP, state.mana + manaPayout(state.party));
}
