// 出撃 1 回ぶんの進行。
//
// マップを持たないので、状態は「今どの区画のどの深度にいるか」と
// 「未解決のイベントがあるか」だけで足りる。座標も向きも持たない。

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
}

/** マイルストーン 4 で編成から算出するようになるまでの仮の最大 HP */
export const PLACEHOLDER_MAX_HP = 60;

export function startRun(sectorId: number): RunState {
  return {
    sectorId,
    depth: 1,
    hp: PLACEHOLDER_MAX_HP,
    maxHp: PLACEHOLDER_MAX_HP,
    gold: 0,
    pending: null,
    atBoss: false,
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
