// 酒場の値付け。
//
// 固定の 120 G / 400 G をやめ、レベル上限・スキル・体力・攻撃力から計算する
// (docs/plan.md「酒場の品揃えと値段」)。スキルはここに決め打ちの値付け表を持ち、
// 体力・攻撃力は現在レベルでの実効値を換算して足す。

import { effectiveAttack, effectiveVitality, type CharacterEntry } from './characters';

/**
 * スキル 1 つぶんの値段。id で引く決め打ちの表。
 * コスト・威力・希少さから決め打ちで振ってあり、数値の調整は行わない (docs/plan.md 8 節)。
 * 0 コスト通常攻撃 (レアの証) は特に高く、鼓舞 2 積み・ward 2 積みのようなレアの上位版もそれに準じる
 */
const SKILL_PRICE: Record<string, number> = {
  // コモンの基本スキル
  'gen-attack': 10,
  'gen-heavy': 18,
  sweep: 16,
  storm: 30,
  'holy-bolt': 28,
  flash: 40,
  pray: 24,
  cheer: 20,
  ward1: 20,
  barrier: 26,
  'gen-combo': 22,
  'dispel-one': 14,
  'dispel-crush': 26,
  // 初期の 3 人 (ネームド)
  'mate-bolt': 22,
  'mate-heal': 22,
  'hero-slash': 60,
  'hero-finish': 70,
  purge: 34,
  // レア専用 (0 コスト通常攻撃の多段バリエーションと、その上位版)
  'rare-slash': 60,
  'twin-strike': 65,
  'triple-strike': 70,
  cheer2: 40,
  ward2: 40,
  'last-stand': 65,
  'great-blade': 66,
  rampage: 80,
  aurora: 85,
};

/** 未知の id (将来スキルを増やしたときの保険) は平均的な値を仮に置く */
const SKILL_PRICE_FALLBACK = 15;

export function skillPrice(id: string): number {
  return SKILL_PRICE[id] ?? SKILL_PRICE_FALLBACK;
}

/** 攻撃力・体力 1 点あたりの換算額 */
export const ATTACK_GOLD_PER_POINT = 0.5;
export const VITALITY_GOLD_PER_POINT = 0.3;
/** レベル上限 1 あたりの換算額 (伸びしろへの値付け) */
export const MAX_LEVEL_GOLD_PER_POINT = 2;
/** レアリティの係数。コモン (~120 G 帯) からレア (~400 G 帯) へ引き上げる */
export const RARE_PRICE_MULTIPLIER = 1.4;
/** 端数を丸める単位 */
export const PRICE_ROUND_UNIT = 10;
/** どれだけ非力な個体でも下回らない下限 */
export const PRICE_FLOOR = 30;

/**
 * 雇用額。材料はレベル上限・スキル・体力・攻撃力 (現在レベルでの実効値)。
 * レアリティの係数を掛けて、レアが 400 G 帯、コモンが 120 G 帯におおよそ収まるようにする
 * (docs/plan.md「酒場の品揃えと値段」)。数値の調整はしない (docs/batch-growth.md 8 節)
 */
export function priceOf(entry: CharacterEntry): number {
  const skillsTotal = entry.skills.reduce((sum, s) => sum + skillPrice(s.id), 0);
  const statPrice =
    effectiveAttack(entry) * ATTACK_GOLD_PER_POINT + effectiveVitality(entry) * VITALITY_GOLD_PER_POINT;
  // 主人公 (上限 999) のような「実質無制限」は伸びしろの値付けが青天井になってしまうので、
  // 換算に使う上限は現実的なコモン・レアの幅で頭打ちにする (主人公は酒場に並ばないので実害はない)
  const capPrice = Math.min(entry.maxLevel, 60) * MAX_LEVEL_GOLD_PER_POINT;
  const rarityMul = entry.rarity === 'rare' ? RARE_PRICE_MULTIPLIER : 1;
  const raw = (skillsTotal + statPrice + capPrice) * rarityMul;
  return Math.max(PRICE_FLOOR, Math.round(raw / PRICE_ROUND_UNIT) * PRICE_ROUND_UNIT);
}
