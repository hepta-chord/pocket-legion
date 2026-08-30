// 出撃 1 回ぶんの進行。
//
// マップを持たないので、状態は「今どの区画のどの深度にいるか」と
// 「未解決のイベントがあるか」だけで足りる。座標も向きも持たない。

import { newParty, partyMaxHp, type Fighter, type Party } from './battle';
import { buildFighter, CHARACTERS, type CharacterEntry } from './data/characters';
import { BOSS_ALT_EVENT, pickEvent, TOTAL_WEIGHT, type EventDef } from './data/events';
import { sectorById, type Sector } from './data/sectors';
import type { Rng } from './rng';

export interface RunState {
  sectorId: number;
  /** 現在の深度。1 から始まり、ボスの深度に着くとボス戦になる */
  depth: number;
  hp: number;
  maxHp: number;
  /** その出撃で拾った金。全滅すると失う */
  gold: number;
  /** 未解決のイベント。null なら「進む」だけができる */
  pending: EventDef | null;
  /** ボスに挑む深度に着いた */
  atBoss: boolean;
  /** 出撃メンバー。Fighter は出撃をまたいで生きるので、帰還処理は roster 側の仕事にする */
  party: Party;
  /**
   * ダウンして party (front / reserve) から外れた Fighter。
   * battle.ts の BattleState.left を戦闘のたびにここへ回収する (game.ts の仕事)。
   * 泉・ボス前の回復イベントでここから party へ戻す
   */
  downed: Fighter[];
}

/**
 * 出撃メンバーを roster (所持キャラの id 列) 全員で組む。前衛 6 まで、あふれたら控えになる。
 * roster が 2 人しかいなければ 2 人で潜ることになる (docs/plan.md の編成フロー)
 */
function buildParty(roster: readonly string[]): Party {
  const fighters = roster
    .map((id) => CHARACTERS.find((c) => c.id === id))
    .filter((c): c is CharacterEntry => c !== undefined)
    .map(buildFighter);
  return newParty(fighters.slice(0, 6), fighters.slice(6));
}

export function startRun(sectorId: number, roster: readonly string[]): RunState {
  const party = buildParty(roster);
  const maxHp = partyMaxHp(party);
  return {
    sectorId,
    depth: 1,
    hp: maxHp,
    maxHp,
    gold: 0,
    pending: null,
    atBoss: false,
    party,
    downed: [],
  };
}

export function sectorOf(run: RunState): Sector {
  return sectorById(run.sectorId);
}

/**
 * 1 歩進めて、着いた先のイベントを決める。
 * ボスの深度に着いたときはイベントを引かずにボス戦になる。
 * ボスの 1 つ手前の深度は、通常の抽選をせず固定でボス前の分岐イベントにする
 * (docs/plan.md「ボス前の分岐イベント」)
 */
export function advance(run: RunState, rng: Rng): void {
  run.depth += 1;
  const sector = sectorOf(run);
  if (run.depth >= sector.depth) {
    run.atBoss = true;
    run.pending = null;
    return;
  }
  if (run.depth === sector.depth - 1) {
    run.pending = BOSS_ALT_EVENT;
    return;
  }
  run.pending = pickEvent(rng.int(0, TOTAL_WEIGHT - 1));
}

export function damage(run: RunState, amount: number): void {
  run.hp = Math.max(0, run.hp - amount);
}

export function heal(run: RunState, amount: number): void {
  run.hp = Math.min(run.maxHp, run.hp + amount);
}

export function isWiped(run: RunState): boolean {
  return run.hp <= 0;
}

/**
 * 新しいキャラをその場でデッキ (出撃メンバー) に入れる。前衛に空きがあれば前衛、無ければ控え。
 * 新しい体力ぶん maxHp も伸ばす (元から居た扱いの復帰 (reviveDowned) とは違い、
 * こちらは編成そのものが増えるため)
 */
export function addToDeck(run: RunState, entry: CharacterEntry): void {
  const fighter = buildFighter(entry);
  const idx = run.party.front.findIndex((f) => f === null);
  if (idx >= 0) run.party.front[idx] = fighter;
  else run.party.reserve.push(fighter);
  run.maxHp = partyMaxHp(run.party);
}

/**
 * ダウンした roster メンバーを全員 party に戻す (前衛の空きから詰め、余りは控え)。
 * 戻す人数を返す (ログ文言に使う)
 */
export function reviveDowned(run: RunState): number {
  const revived = run.downed.splice(0, run.downed.length);
  for (const f of revived) {
    f.downed = false;
    const idx = run.party.front.findIndex((x) => x === null);
    if (idx >= 0) run.party.front[idx] = f;
    else run.party.reserve.push(f);
  }
  return revived.length;
}
