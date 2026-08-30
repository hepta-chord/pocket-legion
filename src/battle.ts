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
export const GUARD_RATES = [0, 0.25, 0.5, 0.75, 0.9] as const;
export const SWAP_COOLDOWN = 3;
/** パーティ最大 HP の、編成に依らない土台 */
export const PARTY_BASE_HP = 2000;

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
  /**
   * 大技のダウンを防ぐのに要るガードの枚数。
   * 1 枚で防げてしまうと毎ターンの払い出し (3) で予告を必ず無効化でき、
   * ダウンも交代も起きなくなる。強い敵ほど多く積ませて、
   * マナの持ち越しと 4 枚ガードが「予告への回答」として働くようにする。
   * ボスでしか大技のダウンが起きなくなった今もフィールドとしては維持する
   * (雑魚の大技はダメージ軽減の計算にだけ使われる)。
   */
  guardBreak: number;
  /**
   * 元の頭数。敵は常に 1 体として戦うが、群れの規模は全体攻撃の威力に効かせる
   * (敵の表示にもそのまま出す)。1 なら単体
   */
  groupSize: number;
  /** ボスだけが大技でダウンを起こす。雑魚の大技はダメージだけ */
  isBoss: boolean;
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
  /** 敵は常に 1 体。対象選択を無くすための仕様なので単数で持つ */
  enemy: EnemyState;
  mana: number;
  /** このターンに積んだガードの枚数 */
  guard: number;
  /**
   * バリア。張ると次に来る敵の攻撃 (通常・大技どちらも) を 1 回まるごと無効化し、
   * ダウンも防いで自身は消費される。予告を見てから張る札にするため、
   * ガードと違ってターン終了では消さずターンをまたいで残す
   */
  barrier: boolean;
  /** 支援スキルによるターン中の攻撃倍率への加算 */
  buff: number;
  turn: number;
  /**
   * 同一ターン内で攻撃が命中した回数。攻撃の基礎ダメージに (1 + 0.15 * combo) を掛け、
   * 命中のたび 1 増える。回復・支援・バリアは数えず、途切れさせもしない。
   * ターン終了で 0 に戻る (guard・buff と同じ扱い)
   */
  combo: number;
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
 * 大技 1 ターン前のアナウンスのように、ルールそのものではなく戦況から作る文言を
 * endTurn の直後に足したいときに使う。ここでしか battle.log に触れないよう集約しておく
 */
export function logBattle(state: BattleState, kind: LogLineView['kind'], text: string): void {
  addLog(state, kind, text);
}

/**
 * 物理スキルの turnBump はターン明けでしか戻らないので、戦闘がプレイヤーの行動中に
 * 勝利で終わる (endTurn を経由しない) と上がったまま次の戦闘に持ち越ってしまう。
 * 戦闘開始のたびに前衛・控え全員ぶん 0 に戻して、素のコストで始まるようにする
 */
function resetTurnBumps(party: Party): void {
  for (const f of [...party.front, ...party.reserve]) {
    if (!f) continue;
    for (const s of f.skills) s.turnBump = 0;
  }
}

export function startBattle(party: Party, hp: number, maxHp: number, enemyDef: EnemyDef): BattleState {
  party.swapCooldown = 0;
  resetTurnBumps(party);
  const telegraph = hookSum(party, 'telegraph');
  const state: BattleState = {
    party,
    hp,
    maxHp,
    enemy: {
      def: enemyDef,
      hp: enemyDef.maxHp,
      countdown: Math.max(1, enemyDef.bigEvery + telegraph),
    },
    mana: 0,
    guard: 0,
    barrier: false,
    buff: 0,
    turn: 1,
    combo: 0,
    outcome: 'ongoing',
    log: [],
    stats: { swaps: 0, downs: 0 },
    left: [],
  };
  state.mana = Math.min(MANA_CAP, manaPayout(party));
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

/** 使えないときはその理由を返す。UI がボタンの無効化と表示に使う */
export function whyCannotUse(state: BattleState, slot: number, skillIndex: number): string | null {
  if (state.outcome !== 'ongoing') return '戦闘は終わっている';
  const f = state.party.front[slot];
  if (!f) return '空きスロット';
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
  let base = attacker.attack * def.effect.power * (1 + state.buff) * comboMul;
  // 敵は 1 体にまとめて表すが、全体攻撃は元の頭数 (groupSize) ぶん威力が伸びる。
  // でないと「群れに強い」という全体攻撃の性格が消えるため
  if (def.effect.target === 'all') base *= 1 + 0.3 * (enemy.def.groupSize - 1);
  let dmg = Math.round(base * (0.6 + 0.4 * rng.next())) - enemy.def.defense;
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
  // 物理は +1 で頭打ちにして、2 発目からは 1 マナで連打できる主力の手数にする
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
  } else if (e.kind === 'buff') {
    state.buff += e.power;
    addLog(state, 'good', `${f.name} の${s.def.name}。攻めが乗った。`);
  } else {
    state.barrier = true;
    addLog(state, 'good', `${f.name} の${s.def.name}。バリアを張った。`);
  }

  // selfDown は自分で選んで払う代償なので、身代わりの肩代わり (coverable) は効かせない
  if (s.def.selfDown) downSlot(state, slot, rng, '代償に', false);
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
// ターンの終了 (敵の行動と明けの整理)

export function endTurn(state: BattleState, rng: Rng): void {
  if (state.outcome !== 'ongoing') return;
  const rate = guardRate(state);
  const enemy = state.enemy;

  if (enemy.hp > 0) {
    enemy.countdown -= 1;

    if (enemy.countdown <= 0) {
      // 大技
      if (state.barrier) {
        state.barrier = false;
        addLog(state, 'good', `バリアが${enemy.def.name}の大技を防いだ。`);
      } else {
        // ガードが guardBreak 枚成立していればダウンは防げる (ボスの大技だけ)
        const raw = enemy.def.attack * enemy.def.bigMul;
        const dmg = Math.max(0, Math.round(raw * (1 - rate)));
        state.hp = Math.max(0, state.hp - dmg);
        addLog(state, 'bad', `${enemy.def.name} の大技。${dmg} 受けた。`);
        if (enemy.def.isBoss) {
          if (state.guard >= enemy.def.guardBreak) {
            addLog(state, 'good', '防御がダウンを防いだ。');
          } else {
            const occupied = state.party.front.flatMap((f, i) => (f ? [i] : []));
            if (occupied.length > 0) downSlot(state, rng.pick(occupied), rng, '大技で', true);
          }
        }
      }
      enemy.countdown = enemy.def.bigEvery;
    } else {
      if (state.barrier) {
        state.barrier = false;
        addLog(state, 'good', `バリアが${enemy.def.name}の攻撃を防いだ。`);
      } else {
        const raw = Math.round(enemy.def.attack * (0.5 + 0.5 * rng.next()));
        const dmg = Math.max(0, Math.round(raw * (1 - rate)));
        state.hp = Math.max(0, state.hp - dmg);
        addLog(state, 'bad', `${enemy.def.name} の攻撃。${dmg} 受けた。`);
      }
    }

    if (state.hp <= 0) {
      state.outcome = 'wipe';
      addLog(state, 'bad', '部隊は崩れ落ちた。');
      return;
    }
    if (state.outcome !== 'ongoing') return;
  }

  // ターン明けの整理。バリアは予告を見てから張る札にするため、ここでは消さない
  state.turn += 1;
  state.guard = 0;
  state.buff = 0;
  state.combo = 0;
  for (const f of [...state.party.front, ...state.party.reserve]) {
    if (!f) continue;
    for (const s of f.skills) s.turnBump = 0;
  }
  state.party.swapCooldown = Math.max(0, state.party.swapCooldown - 1);
  state.mana = Math.min(MANA_CAP, state.mana + manaPayout(state.party));
}
