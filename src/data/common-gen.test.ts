import { describe, expect, it } from 'vitest';
import { FACTIONS } from './factions';
import { generateCommon, NAME_POOLS, SKILL_POOLS } from './common-gen';
import { Rng } from '../rng';

/** SKILL_POOLS の 2 枠目候補群に含まれる ActionSkillDef/PassiveDef の名前一覧 (陣営ごと) */
function secondSlotNames(faction: (typeof FACTIONS)[number]): string[] {
  return SKILL_POOLS[faction].slot2.map((c) => c.def.name);
}

describe('generateCommon', () => {
  it.each(FACTIONS)('%s: 名前・1 枠目スキル・2 枠目スキルがすべて陣営の候補群から来る', (faction) => {
    const rng = new Rng(12345);
    for (let i = 0; i < 20; i++) {
      const c = generateCommon(faction, rng, i);
      expect(c.faction).toBe(faction);
      expect(c.rarity).toBe('common');
      expect(NAME_POOLS[faction]).toContain(c.name);

      const slot1Names = SKILL_POOLS[faction].slot1.map((s) => s.name);
      expect(slot1Names).toContain(c.skills[0].name);

      // 2 枠目はスキルかパッシブのどちらか 1 つで、両方候補群に含まれる名前になる
      const secondName = c.skills[1]?.name ?? c.passives[0]?.name;
      expect(secondSlotNames(faction)).toContain(secondName);
    }
  });

  it('同じ seed (同じ Rng の初期状態) なら同じ個体が出る', () => {
    const a = generateCommon('kingdom', new Rng(999), 7);
    const b = generateCommon('kingdom', new Rng(999), 7);
    expect(a).toEqual(b);
  });

  it('serial が違えば id だけが変わる (中身は rng だけで決まる)', () => {
    const a = generateCommon('kingdom', new Rng(999), 1);
    const b = generateCommon('kingdom', new Rng(999), 2);
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe(b.name);
    expect(a.baseAttack).toBe(b.baseAttack);
  });

  it('どの陣営でも鼓舞 (支援) とガード (壁) のどちらも 2 枠目に持ちうる (陣営染めが成立する)', () => {
    for (const faction of FACTIONS) {
      const names = secondSlotNames(faction);
      expect(names).toContain('鼓舞');
      expect(names).toContain('ガード');
    }
  });

  it('攻撃力・体力に個体差が出る (同じ陣営・同じ型でも値が揺れる)', () => {
    const rng = new Rng(42);
    const attacks = new Set<number>();
    for (let i = 0; i < 10; i++) attacks.add(generateCommon('mercs', rng, i).baseAttack);
    expect(attacks.size).toBeGreaterThan(1);
  });
});
