// 所持ベースの陣営倍率 (docs/plan.md「ステータスと陣営倍率」)。
//
// 実効ステータス = 基礎値 (レベル込み) × 陣営倍率。同陣営を集めて育てるほど全員が底上げされる、
// 所持だけで決まる長期の成長軸で、編成 (前衛に誰を置くか) には依らない。
// 前衛の同陣営補正 (battle.ts の recalcVanguardBonus) とは別物で、掛け算で重ねる
// (docs/batch-faction.md 補足)。
//
// 出撃に Fighter を組むタイミング (formation.ts / run.ts) で一度だけ確定させ、
// Fighter.attack / vitality に焼き込む。戦闘中に倍率が変わることは無いので、
// 戦闘の途中で計算し直さない。

import { effectiveAttack, effectiveVitality, type CharacterEntry } from './data/characters';
import { FACTIONS, type Faction } from './data/factions';

/** 倍率の分母。攻撃力が3桁のスケールに合わせた値 (雇用上限まで揃えたときに +5割前後で頭打ちが目安) */
export const FACTION_MULTIPLIER_DIVISOR = 3000;
/** 倍率の上限。合算元がレベルで伸び、その倍率がまたステータスを押し上げるので、蓋をしないと後半で発散する */
export const FACTION_MULTIPLIER_CAP = 2.0;

export type FactionTotals = Record<Faction, number>;

/** キャラ 1 人ぶんの、倍率の合算に使う値 (実効攻撃力 + 実効体力) */
export function contributionOf(entry: CharacterEntry): number {
  return effectiveAttack(entry) + effectiveVitality(entry);
}

/**
 * 陣営ごとの合算 (owned 全員ぶん、自分を含む)。
 * 「自分以外」の合算は factionMultiplier 側でここから自分のぶんを引いて出すので、
 * 所持人数が多いときも owned を毎回全走査せずに済む
 */
export function factionTotals(owned: readonly CharacterEntry[]): FactionTotals {
  const totals = Object.fromEntries(FACTIONS.map((f) => [f, 0])) as FactionTotals;
  for (const c of owned) totals[c.faction] += contributionOf(c);
  return totals;
}

/**
 * 陣営倍率。selfContribution に本人ぶんの合算値を渡すと「自分以外」の倍率になる。
 * まだ owned に積んでいない (加入前の見積もり用の) キャラを見るときは省略してよい
 * (0 のまま、既存の所持ぶんだけで倍率を出す)
 */
export function factionMultiplier(totals: FactionTotals, faction: Faction, selfContribution = 0): number {
  const others = Math.max(0, totals[faction] - selfContribution);
  return Math.min(FACTION_MULTIPLIER_CAP, 1 + others / FACTION_MULTIPLIER_DIVISOR);
}

/** entry 本人を除いた陣営倍率。owned から Fighter を組むときに使う基本形 */
export function factionMultiplierOf(totals: FactionTotals, entry: CharacterEntry): number {
  return factionMultiplier(totals, entry.faction, contributionOf(entry));
}
