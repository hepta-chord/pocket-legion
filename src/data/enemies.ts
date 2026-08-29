// 敵とボスの定義。本編とバランス計測 (sim/) が共有する。
//
// 通常戦は深度でスケールする使い捨ての雑魚集団、強敵 (elite) はその HP・攻撃力を
// 1.5 倍にしただけの同じ生成器を通す。ボスは区画ごとに固定 1 体で、
// 大技の間隔を詰めて (bigEvery 3) 威力も上げ (bigMul 2.5)、雑魚とは別枠で強くする。

import type { EnemyDef } from '../battle';
import type { Rng } from '../rng';
import type { Element } from './skills';

/** 通常戦・強敵の雑魚を深度なりに生成する。elite なら HP と攻撃力を 1.5 倍にする */
export function makePack(depth: number, rng: Rng, elite = false): EnemyDef[] {
  const count = rng.int(1, Math.min(3, 1 + Math.floor(depth / 5)));
  const mul = elite ? 1.5 : 1;
  const defs: EnemyDef[] = [];
  for (let i = 0; i < count; i++) {
    const resistRoll = rng.next();
    const resist: Element | null = resistRoll < 0.15 ? 'physical' : resistRoll < 0.3 ? 'magic' : null;
    defs.push({
      id: `d${depth}-${i}`,
      name: elite ? `影${i + 1}` : `魔物${i + 1}`,
      maxHp: Math.round(((45 + depth * 12) / count) * mul),
      attack: Math.round((4 + depth * 0.9) * mul),
      defense: Math.floor(depth / 5),
      resist,
      bigEvery: rng.int(3, 4),
      bigMul: 2.2,
      // 1 枚で防げると毎ターンの払い出しで必ず無効化できてしまうので、下限を 2 枚にする。
      // 個体ごとにばらつかせて、予告を見てから「これは止めに行くか、諦めて殴るか」を
      // 選べるようにする。深いほど重くなり、強敵はさらに 1 枚積ませる
      guardBreak: Math.min(4, rng.int(2, 4) + Math.floor(depth / 12) + (elite ? 1 : 0)),
    });
  }
  return defs;
}

interface BossSpec {
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  /** ダウンを防ぐのに要るガードの枚数 */
  guardBreak: number;
}

/** 区画ごとのボス。名前と強さは深度帯に合わせて 3 段階で決め打ちする */
const BOSSES: readonly BossSpec[] = [
  { name: '穴蜘蛛の女王', maxHp: 220, attack: 16, defense: 4, guardBreak: 3 },
  { name: '骨の王', maxHp: 420, attack: 26, defense: 7, guardBreak: 4 },
  { name: '深淵の使者', maxHp: 700, attack: 40, defense: 10, guardBreak: 4 },
];

/** 区画ごとのボスを 1 体作る。雑魚より大幅に硬く、大技の間隔と威力も上げてある */
export function makeBoss(sectorId: number, rng: Rng): EnemyDef {
  const spec = BOSSES[Math.min(sectorId, BOSSES.length) - 1] ?? BOSSES[BOSSES.length - 1];
  const resist: Element = rng.chance(0.5) ? 'physical' : 'magic';
  return {
    id: `boss-${sectorId}`,
    name: spec.name,
    maxHp: spec.maxHp,
    attack: spec.attack,
    defense: spec.defense,
    resist,
    bigEvery: 3,
    bigMul: 2.5,
    guardBreak: spec.guardBreak,
  };
}
