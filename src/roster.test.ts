import { describe, expect, it } from 'vitest';
import type { CharacterEntry } from './data/characters';
import type { Faction } from './data/factions';
import {
  contributionOf,
  factionMultiplier,
  factionMultiplierOf,
  factionTotals,
  FACTION_MULTIPLIER_CAP,
  FACTION_MULTIPLIER_DIVISOR,
} from './roster';

// growth: 0 にして実効値を基礎値に固定し、テストの数値を単純にする (growth.ts の仕様:
// effectiveStat = base * (1 + growth * growthFactor) なので growth 0 なら常に base のまま)
function entry(id: string, faction: Faction, baseAttack: number, baseVitality: number): CharacterEntry {
  return {
    id,
    name: id,
    faction,
    rarity: 'common',
    baseAttack,
    baseVitality,
    skills: [],
    passives: [],
    level: 1,
    exp: 0,
    maxLevel: 20,
    growth: 0,
    curve: 'linear',
  };
}

describe('contributionOf / factionTotals', () => {
  it('実効攻撃力 + 実効体力の合算になる', () => {
    const a = entry('a', 'kingdom', 100, 60);
    expect(contributionOf(a)).toBe(160);
  });

  it('陣営ごとに所持全員 (自分を含む) を合算する', () => {
    const a = entry('a', 'kingdom', 100, 60);
    const b = entry('b', 'kingdom', 50, 40);
    const c = entry('c', 'order', 999, 999);
    const totals = factionTotals([a, b, c]);
    expect(totals.kingdom).toBe(160 + 90);
    expect(totals.order).toBe(1998);
    expect(totals.mercs).toBe(0);
    expect(totals.frontier).toBe(0);
  });
});

describe('factionMultiplier / factionMultiplierOf', () => {
  it('同陣営が増えるほど倍率が上がる', () => {
    const a = entry('a', 'kingdom', 100, 100); // contribution 200
    const b = entry('b', 'kingdom', 100, 100); // contribution 200
    const totals = factionTotals([a, b]);
    // a から見て自分以外は b の 200 だけ
    expect(factionMultiplierOf(totals, a)).toBeCloseTo(1 + 200 / FACTION_MULTIPLIER_DIVISOR);

    const c = entry('c', 'kingdom', 100, 100);
    const totals3 = factionTotals([a, b, c]);
    // 3 人目が増えると、a から見た「自分以外」の合算も増えて倍率が上がる
    expect(factionMultiplierOf(totals3, a)).toBeGreaterThan(factionMultiplierOf(totals, a));
  });

  it('自分自身は合算に入らない (同陣営が自分 1 人だけなら倍率は 1)', () => {
    const a = entry('a', 'kingdom', 100, 100);
    const totals = factionTotals([a]);
    expect(factionMultiplierOf(totals, a)).toBe(1);
  });

  it('上限 2.0 で頭打ちになる', () => {
    const a = entry('a', 'kingdom', 100, 100); // contribution 200
    // 自分以外の合算が定数 (3000) を大きく超えるようにする
    const others = Array.from({ length: 40 }, (_, i) => entry(`k${i}`, 'kingdom', 100, 100));
    const totals = factionTotals([a, ...others]);
    expect(factionMultiplierOf(totals, a)).toBe(FACTION_MULTIPLIER_CAP);
  });

  it('他陣営の所持は倍率に影響しない', () => {
    const a = entry('a', 'kingdom', 100, 100);
    const other = entry('o', 'order', 9999, 9999);
    const totals = factionTotals([a, other]);
    expect(factionMultiplierOf(totals, a)).toBe(1);
  });

  it('selfContribution を省略すると所持していない (見積もり用の) キャラの倍率になる', () => {
    const a = entry('a', 'kingdom', 100, 100);
    const totals = factionTotals([a]);
    // まだ owned に無い候補を見積もる場合は、自分のぶんを引かずにそのまま使う
    expect(factionMultiplier(totals, 'kingdom')).toBeCloseTo(1 + 200 / FACTION_MULTIPLIER_DIVISOR);
  });
});
