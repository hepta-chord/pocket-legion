// 敵とボスの定義。本編とバランス計測 (sim/) が共有する。
//
// 数値は大味に振ってある。ダメージは 2〜3 桁で動き、細かい差は読ませない。
// 道中の雑魚はダウンを起こさず、パーティ HP を削るだけの存在で、
// 浅い深度では瞬殺できる。深くなるほど HP が二次で伸びて、
// 「まだ farm できる深さ」と「削られ始める深さ」の縁が生まれる。

import type { ActionSlot, EnemyDef } from '../battle';
import type { Rng } from '../rng';
import type { Element } from './skills';

/** 雑魚の行動枠。1 枠だけで、攻撃 9・何もしない 1 を基準にする (docs/plan.md「敵の行動と予告」) */
const FOE_SLOTS: ActionSlot[] = [
  [
    { action: { kind: 'attack' }, weight: 9 },
    { action: { kind: 'none' }, weight: 1 },
  ],
];

/**
 * ボスのスタンが巻き込む人数の幅。区画 (浅層/中層/深層) で変える。
 *
 * 複数を巻き込むのはボスだけにする。雑魚が 2 人まとめて気絶させると、
 * 前衛が 4 人前後の序盤では手番の半分が飛んで、道中がただの事故になる。
 * 場を荒らす派手さはボス戦にだけ置く。
 */
function bossStunRange(sectorId: number): { min: number; max: number } {
  if (sectorId <= 1) return { min: 1, max: 2 };
  if (sectorId === 2) return { min: 1, max: 3 };
  return { min: 2, max: 4 };
}

/** スタンを持たない敵に入れておく既定値。stunEvery が null のときは使われない */
const NO_STUN_RANGE = { min: 1, max: 1 };

/**
 * 通常戦・強敵の雑魚を深度なりに生成する。elite なら HP と攻撃力を 1.5 倍にする。
 *
 * ダウン攻撃・スタンは雑魚の一部だけが持つ (docs/plan.md「敵の行動と予告」)。
 * 2 割程度にダウン攻撃、別の 2 割程度にスタンを持たせ、両方持つ個体は作らない
 * (どちらも持たない大半は、大技以外はただ殴るだけの雑魚になる)。
 * スタンは大技・ダウン攻撃と同じクールタイム制 (stunEvery) にしてあり、行動枠の
 * 抽選には乗らず、予告もしない (大技・ダウン攻撃と違って、来ると分かっている必要はない)
 */
export function makeFoe(depth: number, rng: Rng, elite = false): EnemyDef {
  const groupSize = rng.int(1, Math.min(3, 1 + Math.floor(depth / 5)));
  const mul = elite ? 1.5 : 1;
  // 耐性なしが主で、持ちが出たら苦戦する回にする。
  // 主力が物理の世界なので、物理耐性のほうがきつい壁として多めに出る
  const resistRoll = rng.next();
  const resist: Element | null = resistRoll < 0.08 ? 'physical' : resistRoll < 0.12 ? 'magic' : null;

  const specialRoll = rng.next();
  const hasDownstrike = specialRoll < 0.2;
  const hasStun = !hasDownstrike && specialRoll < 0.4;

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
    // 雑魚の大技は個体ごとの技名を持たない。予告バッジには総称の「大技」を出す
    bigName: '大技',
    downEvery: hasDownstrike ? rng.int(4, 6) : null,
    // 雑魚のスタンは必ず 1 人だけにする (複数はボスの特権)
    stunEvery: hasStun ? rng.int(4, 6) : null,
    stunRange: NO_STUN_RANGE,
    slots: FOE_SLOTS,
  };
}

interface BossSpec {
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  /** 大技の名前。ボスは固有の技名を予告バッジに出す */
  bigName: string;
}

/** 区画ごとのボス。名前と強さは深度帯に合わせて 3 段階で決め打ちする */
const BOSSES: readonly BossSpec[] = [
  { name: '穴蜘蛛の女王', maxHp: 2200, attack: 40, defense: 40, bigName: '毒霧の乱舞' },
  { name: '骨の王', maxHp: 5000, attack: 70, defense: 70, bigName: '亡者の号令' },
  { name: '深淵の使者', maxHp: 9000, attack: 100, defense: 100, bigName: '深淵からの侵蝕' },
];

/**
 * ボスのダウン攻撃の間隔 (ターン)。浅層は 10 ターンに 1 回にし (docs/batch-growth.md 6 節)、
 * 中層・深層はそこから少しだけ詰める (深いほど長期戦になるので、詰めすぎない程度に)
 */
function bossDownEvery(sectorId: number): number {
  if (sectorId <= 1) return 10;
  if (sectorId === 2) return 9;
  return 8;
}

/**
 * ボスのスタンの間隔 (ターン)。浅層は少し猶予を持たせ、中層・深層は 4 ターンに詰める
 * (docs/batch-growth.md 6 節)
 */
function bossStunEvery(sectorId: number): number {
  return sectorId <= 1 ? 5 : 4;
}

/**
 * ボスの行動枠 (docs/plan.md「敵の行動と予告」)。2 枠持つ。
 * 枠 1 はほぼ攻撃 (9:1) で、ここでほぼ毎ターン殴ってくる。
 * 枠 2 で自己強化 (鼓舞・防御) を織り交ぜる (浅層は 5:5:1:2)。均等な 1/3 ずつだと
 * 自己強化ばかりで殴ってこなくなるため、枠を分けて「ほぼ殴る」を土台に据えてある。
 * 深いほど枠 2 の攻撃寄りの重みを増やす、という素直な差だけを付ける
 * (重みそのものの調整は行わない。docs/batch-next.md 6 節)
 */
function bossSlots(sectorId: number): ActionSlot[] {
  const slot1: ActionSlot = [
    { action: { kind: 'attack' }, weight: 9 },
    { action: { kind: 'none' }, weight: 1 },
  ];
  const selfBuffWeight = sectorId <= 1 ? 5 : sectorId === 2 ? 4 : 3;
  const attackWeight = sectorId <= 1 ? 1 : sectorId === 2 ? 3 : 5;
  const slot2: ActionSlot = [
    { action: { kind: 'cheer' }, weight: selfBuffWeight },
    { action: { kind: 'ward' }, weight: selfBuffWeight },
    { action: { kind: 'attack' }, weight: attackWeight },
    { action: { kind: 'none' }, weight: 2 },
  ];
  return [slot1, slot2];
}

/**
 * 区画ごとのボスを 1 体作る。
 *
 * 50〜100 ターンの消耗戦にするため、通常攻撃は深度なりの雑魚よりずっと軽い。
 * 長期戦で成立する 1 ターンあたりの被害はパーティ HP の予算を戦闘の長さで割った値で、
 * どうしても小さくなるため。
 * 脅威は大技とダウン攻撃に寄せてあり (bigMul 6.0)、答えなければ HP もダウンも持っていかれる。
 * ボスが怖いのは殴られ続けるからではなく、予告に毎回答えを出し続けるからにする。
 *
 * ボスは全員が大技・ダウン攻撃・スタン・自己鼓舞・自己防御を持つ。スタンも大技・ダウン攻撃と
 * 同じクールタイム制 (stunEvery) にしてあり、行動枠の抽選には乗らない
 * (乗せると、2 枠と合わせて毎ターン頻繁にスタンが飛んでしまう)。予告もしない。
 * どちらの特殊行動のターンでもなければ、bossSlots (2 枠) を引く
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
    groupSize: 1,
    isBoss: true,
    bigEvery: 3,
    bigMul: 6.0,
    bigName: spec.bigName,
    downEvery: bossDownEvery(sectorId),
    stunEvery: bossStunEvery(sectorId),
    stunRange: bossStunRange(sectorId),
    slots: bossSlots(sectorId),
  };
}
