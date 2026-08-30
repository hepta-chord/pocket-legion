import { describe, expect, it } from 'vitest';
import { FACTIONS } from './factions';
import { generateCommon, generateRare, SKILL_POOLS } from './common-gen';
import { CHARACTERS } from './characters';
import { Rng } from '../rng';

// レア/コモンの成長の帯 (docs/plan.md「成長カーブ」)。レアは伸びしろが大きく上限も高い、
// コモンは早く仕上がるが頭打ちも早い、という性格を growth/maxLevel の帯で分ける
const RARE_GROWTH_MIN = 1.0;
const RARE_GROWTH_MAX = 1.5;
const RARE_MAX_LEVEL_MIN = 30;
const RARE_MAX_LEVEL_MAX = 40;
const COMMON_GROWTH_MIN = 0.5;
const COMMON_GROWTH_MAX = 0.8;
const COMMON_MAX_LEVEL_MIN = 16;
const COMMON_MAX_LEVEL_MAX = 24;

describe('スケサンのネームド化 (docs/plan.md「初期の 2 人」)', () => {
  it('スケサンは rarity: named で、スキルと数値 (攻撃魔法・ヒーリング) は変わっていない', () => {
    const mate = CHARACTERS.find((c) => c.id === 'mate')!;
    expect(mate.rarity).toBe('named');
    expect(mate.skills.map((s) => s.id)).toEqual(['mate-bolt', 'mate-heal']);
    expect(mate.baseAttack).toBe(90);
    expect(mate.baseVitality).toBe(60);
  });
});

describe('レア/コモンの成長の帯 (docs/plan.md「成長カーブ」)', () => {
  it('generateRare は growth 1.0〜1.5、maxLevel 30〜40 の帯に収まる (全陣営・多数サンプル)', () => {
    // レアは固定の名簿を持たず、その場で生成する (docs/plan.md「レアリティと入手」)
    const rng = new Rng(555);
    for (const faction of FACTIONS) {
      for (let i = 0; i < 50; i++) {
        const c = generateRare(faction, rng, i);
        expect(c.rarity).toBe('rare');
        expect(c.growth).toBeGreaterThanOrEqual(RARE_GROWTH_MIN);
        expect(c.growth).toBeLessThanOrEqual(RARE_GROWTH_MAX);
        expect(c.maxLevel).toBeGreaterThanOrEqual(RARE_MAX_LEVEL_MIN);
        expect(c.maxLevel).toBeLessThanOrEqual(RARE_MAX_LEVEL_MAX);
      }
    }
  });

  it('主人公は growth が帯に収まり、maxLevel 999・curveRef 30 は変えていない (指示どおり)', () => {
    const hero = CHARACTERS.find((c) => c.id === 'hero')!;
    expect(hero.growth).toBeGreaterThanOrEqual(RARE_GROWTH_MIN);
    expect(hero.growth).toBeLessThanOrEqual(RARE_GROWTH_MAX);
    expect(hero.maxLevel).toBe(999);
    expect(hero.curveRef).toBe(30);
  });

  it('生成コモンは growth 0.5〜0.8、maxLevel 16〜24 の帯に収まる (全陣営・多数サンプル)', () => {
    const rng = new Rng(777);
    for (const faction of FACTIONS) {
      for (let i = 0; i < 50; i++) {
        const c = generateCommon(faction, rng, i);
        expect(c.growth).toBeGreaterThanOrEqual(COMMON_GROWTH_MIN);
        expect(c.growth).toBeLessThanOrEqual(COMMON_GROWTH_MAX);
        expect(c.maxLevel).toBeGreaterThanOrEqual(COMMON_MAX_LEVEL_MIN);
        expect(c.maxLevel).toBeLessThanOrEqual(COMMON_MAX_LEVEL_MAX);
      }
    }
  });
});

describe('マナを増やすスキル (魔力譲渡) はレアだけが持つ (docs/plan.md「スキルスロット」)', () => {
  it('generateRare は魔力譲渡 (kind: mana) を引くことがあり、コモンの生成は持たない', () => {
    const rng = new Rng(321);
    let sawManaGift = false;
    for (let i = 0; i < 200; i++) {
      const c = generateRare('kingdom', rng, i);
      expect(c.rarity).toBe('rare');
      if (c.skills.some((s) => s.effect.kind === 'mana')) sawManaGift = true;
    }
    expect(sawManaGift).toBe(true);
  });

  it('コモンの生成候補群 (SKILL_POOLS) には魔力譲渡 (kind: mana) が含まれない', () => {
    for (const faction of FACTIONS) {
      const pool = SKILL_POOLS[faction];
      for (const s of pool.slot1) expect(s.effect.kind).not.toBe('mana');
      for (const c of pool.slot2) {
        if (c.kind === 'skill') expect(c.def.effect.kind).not.toBe('mana');
      }
    }
  });
});

describe('パッシブ「泉脈」の廃止 (docs/plan.md「スキルスロット」)', () => {
  it('固定キャラのパッシブに泉脈 (id: spring) は無い', () => {
    for (const c of CHARACTERS) {
      expect(c.passives.some((p) => p.id === 'spring' || p.name === '泉脈')).toBe(false);
    }
  });

  it('コモンの生成候補群 (SKILL_POOLS) のパッシブに泉脈は無い', () => {
    for (const faction of FACTIONS) {
      for (const c of SKILL_POOLS[faction].slot2) {
        if (c.kind === 'passive') {
          expect(c.def.id).not.toBe('spring');
          expect(c.def.name).not.toBe('泉脈');
        }
      }
    }
  });
});
