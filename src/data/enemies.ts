// 敵とボスの定義。本編とバランス計測 (sim/) が共有する。
//
// 数値は大味に振ってある。ダメージは 2〜3 桁で動き、細かい差は読ませない。
// 道中の雑魚はダウンを起こさず、パーティ HP を削るだけの存在で、
// 浅い深度では瞬殺できる。深くなるほど HP が二次で伸びて、
// 「まだ farm できる深さ」と「削られ始める深さ」の縁が生まれる。

import type { EnemyAction, EnemyDef } from '../battle';
import type { Rng } from '../rng';
import type { Element } from './skills';

/** スタンが巻き込む人数の幅。区画 (浅層/中層/深層) で変える */
function stunRange(sectorId: number): { min: number; max: number } {
  if (sectorId <= 1) return { min: 1, max: 2 };
  if (sectorId === 2) return { min: 1, max: 3 };
  return { min: 2, max: 4 };
}

/**
 * 通常戦・強敵の雑魚を深度なりに生成する。elite なら HP と攻撃力を 1.5 倍にする。
 * sectorId はスタンの巻き込み人数の幅にだけ使う (浅層/中層/深層で変える)。
 *
 * ダウン攻撃・スタンは雑魚の一部だけが持つ (docs/plan.md「敵の行動と予告」)。
 * 2 割程度にダウン攻撃、別の 2 割程度にスタンを持たせ、両方持つ個体は作らない
 * (どちらも持たない大半は、大技以外はただ殴るだけの雑魚になる)
 */
export function makeFoe(depth: number, rng: Rng, elite = false, sectorId = 1): EnemyDef {
  const groupSize = rng.int(1, Math.min(3, 1 + Math.floor(depth / 5)));
  const mul = elite ? 1.5 : 1;
  // 耐性なしが主で、持ちが出たら苦戦する回にする。
  // 主力が物理の世界なので、物理耐性のほうがきつい壁として多めに出る
  const resistRoll = rng.next();
  const resist: Element | null = resistRoll < 0.08 ? 'physical' : resistRoll < 0.12 ? 'magic' : null;

  const specialRoll = rng.next();
  const hasDownstrike = specialRoll < 0.2;
  const hasStun = !hasDownstrike && specialRoll < 0.4;
  const pattern: EnemyAction[] = hasStun ? [{ kind: 'attack' }, { kind: 'stun', ...stunRange(sectorId) }] : [{ kind: 'attack' }];

  return {
    id: `d${depth}`,
    name: groupSize > 1 ? (elite ? '影の群れ' : '魔物の群れ') : elite ? '影' : '魔物',
    // 深度 2 の単体 (最初に出る雑魚) は、主人公が斬撃を振り続けて 2 ターン、
    // 必殺なら最低の出目でも一撃で沈む量。深い雑魚は二次で伸びて壁になる
    maxHp: Math.round((150 + depth * depth * 12) * mul),
    attack: Math.round((40 + depth * 9) * groupSize * mul),
    defense: depth * 2,
    resist,
    groupSize,
    isBoss: false,
    bigEvery: rng.int(3, 4),
    bigMul: 2.2,
    downEvery: hasDownstrike ? rng.int(4, 6) : null,
    pattern,
  };
}

interface BossSpec {
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
}

/** 区画ごとのボス。名前と強さは深度帯に合わせて 3 段階で決め打ちする */
const BOSSES: readonly BossSpec[] = [
  { name: '穴蜘蛛の女王', maxHp: 2200, attack: 40, defense: 40 },
  { name: '骨の王', maxHp: 5000, attack: 70, defense: 70 },
  { name: '深淵の使者', maxHp: 9000, attack: 100, defense: 100 },
];

/** ボスのダウン攻撃の間隔 (ターン)。「5 ターンごとに 1 人程度」の目安 */
const BOSS_DOWN_EVERY = 5;

/**
 * 区画ごとのボスを 1 体作る。
 *
 * 50〜100 ターンの消耗戦にするため、通常攻撃は深度なりの雑魚よりずっと軽い。
 * 長期戦で成立する 1 ターンあたりの被害はパーティ HP の予算を戦闘の長さで割った値で、
 * どうしても小さくなるため。
 * 脅威は大技とダウン攻撃に寄せてあり (bigMul 6.0)、答えなければ HP もダウンも持っていかれる。
 * ボスが怖いのは殴られ続けるからではなく、予告に毎回答えを出し続けるからにする。
 *
 * ボスは全員が大技・ダウン攻撃・スタン・自己鼓舞・自己防御を持ち、
 * どちらの特殊行動のターンでもなければ通常行動 (attack/stun/cheer/ward) を 2 回行う。
 */
export function makeBoss(sectorId: number, rng: Rng): EnemyDef {
  const spec = BOSSES[Math.min(sectorId, BOSSES.length) - 1] ?? BOSSES[BOSSES.length - 1];
  const resist: Element = rng.chance(0.5) ? 'physical' : 'magic';
  const pattern: EnemyAction[] = [{ kind: 'attack' }, { kind: 'stun', ...stunRange(sectorId) }, { kind: 'cheer' }, { kind: 'ward' }];
  return {
    id: `boss-${sectorId}`,
    name: spec.name,
    maxHp: spec.maxHp,
    attack: spec.attack,
    defense: spec.defense,
    resist,
    groupSize: 1,
    isBoss: true,
    bigEvery: 3,
    bigMul: 6.0,
    downEvery: BOSS_DOWN_EVERY,
    pattern,
  };
}
