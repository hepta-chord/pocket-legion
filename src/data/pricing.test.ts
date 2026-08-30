import { describe, expect, it } from 'vitest';
import type { CharacterEntry } from './characters';
import { priceOf } from './pricing';

function entry(over: Partial<CharacterEntry> = {}): CharacterEntry {
  return {
    id: 'x',
    name: 'x',
    faction: 'kingdom',
    rarity: 'common',
    baseAttack: 100,
    baseVitality: 50,
    skills: [],
    passives: [],
    level: 1,
    exp: 0,
    maxLevel: 20,
    growth: 0.5,
    curve: 'linear',
    ...over,
  };
}

describe('priceOf', () => {
  it('レベル上限が高いほど値段が上がる', () => {
    const low = priceOf(entry({ maxLevel: 16 }));
    const high = priceOf(entry({ maxLevel: 24 }));
    expect(high).toBeGreaterThan(low);
  });

  it('スキルを持つほど値段が上がる', () => {
    const bare = priceOf(entry({ skills: [] }));
    const withSkill = priceOf(
      entry({
        skills: [
          {
            id: 'gen-attack',
            name: '通常攻撃',
            shortName: '攻撃',
            category: 'physical',
            baseCost: 1,
            effect: { kind: 'attack', target: 'one', power: 1.0 },
          },
        ],
      }),
    );
    expect(withSkill).toBeGreaterThan(bare);
  });

  it('体力が高いほど値段が上がる', () => {
    const low = priceOf(entry({ baseVitality: 40 }));
    const high = priceOf(entry({ baseVitality: 100 }));
    expect(high).toBeGreaterThan(low);
  });

  it('攻撃力が高いほど値段が上がる (レベルが上がって実効値が伸びた場合も同様)', () => {
    const low = priceOf(entry({ baseAttack: 80 }));
    const high = priceOf(entry({ baseAttack: 160 }));
    expect(high).toBeGreaterThan(low);

    const level1 = priceOf(entry({ level: 1, maxLevel: 20, growth: 1.0 }));
    const leveled = priceOf(entry({ level: 20, maxLevel: 20, growth: 1.0 }));
    expect(leveled).toBeGreaterThan(level1);
  });

  it('レアはコモンと同じ数値でも係数のぶん高くなる', () => {
    const common = priceOf(entry({ rarity: 'common' }));
    const rare = priceOf(entry({ rarity: 'rare' }));
    expect(rare).toBeGreaterThan(common);
  });

  it('レアはおよそ 400 G 帯、コモンはおよそ 120 G 帯に収まる (generateRare/generateCommon で確認)', async () => {
    // レアは固定の名簿を持たずその場で生成する (docs/plan.md「レアリティと入手」) ので、
    // 生成した個体そのもので帯を確かめる
    const { generateCommon, generateRare } = await import('./common-gen');
    const { Rng } = await import('../rng');
    const rng = new Rng(2024);
    for (let i = 0; i < 30; i++) {
      const rare = priceOf(generateRare('kingdom', rng, i));
      expect(rare).toBeGreaterThan(250);
      expect(rare).toBeLessThan(550);
      const common = priceOf(generateCommon('kingdom', rng, i));
      expect(common).toBeGreaterThan(60);
      expect(common).toBeLessThan(220);
    }
  });
});
