// 敵とボスの定義。本編とバランス計測 (sim/) が共有する。
//
// 敵は常に 1 体として戦う。かつての複数体編成 (makePack) は頭数 (groupSize) を
// HP と攻撃力に畳み込んで 1 体にまとめ、群れの規模は全体攻撃の威力にだけ効かせる。
// 通常戦は深度でスケールする使い捨ての雑魚、強敵 (elite) はその HP・攻撃力を
// 1.5 倍にしただけの同じ生成器を通す。ボスは区画ごとに固定 1 体で、
// 大技の間隔を詰めて (bigEvery 3) 威力も上げ (bigMul 2.5)、雑魚とは別枠で強くする。

import type { EnemyDef } from '../battle';
import type { Rng } from '../rng';
import type { Element } from './skills';

/**
 * 通常戦・強敵の雑魚を深度なりに 1 体生成する。elite なら HP と攻撃力を 1.5 倍にする。
 * groupSize は今までの count と同じ式で決め、count 体ぶんの HP・攻撃力の合計を
 * そのまま 1 体に畳み込む (数値は変えない。合算しただけ)。
 */
export function makeFoe(depth: number, rng: Rng, elite = false): EnemyDef {
  const groupSize = rng.int(1, Math.min(3, 1 + Math.floor(depth / 5)));
  const mul = elite ? 1.5 : 1;
  const resistRoll = rng.next();
  const resist: Element | null = resistRoll < 0.15 ? 'physical' : resistRoll < 0.3 ? 'magic' : null;
  const packName = elite ? '影の群れ' : '魔物の群れ';
  const soloName = elite ? '影' : '魔物';
  return {
    id: `d${depth}`,
    name: groupSize > 1 ? packName : soloName,
    // 今まで「1 体あたり (45 + depth*12) / count」を count 体だったので、
    // 1 体にまとめると合計は count が消えて 45 + depth*12 になる
    maxHp: Math.round((60 + depth * 16) * mul),
    // 今まで count 体がそれぞれ (4 + depth*0.9) で殴っていたので、
    // まとめると (4 + depth*0.9) * groupSize になる
    attack: Math.round((4 + depth * 0.9) * 1.4 * groupSize * mul),
    defense: Math.floor(depth / 5),
    resist,
    bigEvery: rng.int(3, 4),
    bigMul: 2.2,
    // 1 枚で防げると毎ターンの払い出しで必ず無効化できてしまうので、下限を 2 枚にする。
    // 個体ごとにばらつかせて、予告を見てから「これは止めに行くか、諦めて殴るか」を
    // 選べるようにする。深いほど重くなり、強敵はさらに 1 枚積ませる。
    // (雑魚の大技はダウンを起こさなくなったので、以後はダメージ軽減の計算にだけ使われる)
    guardBreak: Math.min(4, rng.int(2, 4) + Math.floor(depth / 12) + (elite ? 1 : 0)),
    groupSize,
    isBoss: false,
  };
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
  { name: '穴蜘蛛の女王', maxHp: 1600, attack: 4, defense: 4, guardBreak: 3 },
  { name: '骨の王', maxHp: 3000, attack: 7, defense: 7, guardBreak: 4 },
  { name: '深淵の使者', maxHp: 5000, attack: 10, defense: 10, guardBreak: 4 },
];

/**
 * 区画ごとのボスを 1 体作る。
 *
 * 50〜100 ターンの消耗戦にするため、通常攻撃は雑魚よりずっと軽い。
 * 長期戦で成立する 1 ターンあたりの被害はパーティ HP の予算を戦闘の長さで割った値で、
 * どうしても小さくなるため。
 * 脅威は大技に寄せてあり (bigMul 6.0)、答えなければ HP もダウンも持っていかれる。
 * ボスが怖いのは殴られ続けるからではなく、予告に毎回答えを出し続けるからにする。
 */
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
    bigMul: 6.0,
    guardBreak: spec.guardBreak,
    groupSize: 1,
    isBoss: true,
  };
}
