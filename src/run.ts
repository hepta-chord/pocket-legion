// 出撃 1 回ぶんの進行。
//
// マップを持たないので、状態は「今どの区画のどの深度にいるか」と
// 「未解決のイベントがあるか」だけで足りる。座標も向きも持たない。

import { newParty, partyMaxHp, type Party } from './battle';
import { buildFighter, CHARACTERS } from './data/characters';
import { pickEvent, TOTAL_WEIGHT, type EventDef } from './data/events';
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
}

/**
 * 出撃メンバーを組む。編成画面はマイルストーン 4 なので、今は CHARACTERS の先頭から
 * 固定で 10 人 (前衛 6 + 控え 4) を選ぶ。
 * 主人公と相棒は出撃を通してすり減らない下支えなので、必ず前衛に入れる
 * (CHARACTERS の並び順に頼らず、id で明示的に拾う)。
 */
function defaultParty(): Party {
  const hero = CHARACTERS.find((c) => c.id === 'hero')!;
  const mate = CHARACTERS.find((c) => c.id === 'mate')!;
  const rest = CHARACTERS.filter((c) => c.id !== 'hero' && c.id !== 'mate').slice(0, 8).map(buildFighter);
  const front = [buildFighter(hero), buildFighter(mate), ...rest.slice(0, 4)];
  const reserve = rest.slice(4, 8);
  return newParty(front, reserve);
}

export function startRun(sectorId: number): RunState {
  const party = defaultParty();
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
  };
}

export function sectorOf(run: RunState): Sector {
  return sectorById(run.sectorId);
}

/**
 * 1 歩進めて、着いた先のイベントを決める。
 * ボスの深度に着いたときはイベントを引かず、ボス戦に入る。
 */
export function advance(run: RunState, rng: Rng): void {
  run.depth += 1;
  if (run.depth >= sectorOf(run).depth) {
    run.atBoss = true;
    run.pending = null;
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
