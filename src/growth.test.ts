import { describe, expect, it } from 'vitest';
import { addExp, effectiveStat, expToNextLevel, growthFactor, type Growable } from './growth';

function growable(over: Partial<Growable> = {}): Growable {
  return { level: 1, maxLevel: 20, growth: 0.5, curve: 'linear', ...over };
}

describe('growthFactor / effectiveStat', () => {
  it('レベル 1 (t=0) はどのカーブでも実効値が base のまま', () => {
    for (const curve of ['linear', 'early', 'late'] as const) {
      const g = growable({ level: 1, curve });
      expect(growthFactor(g)).toBe(0);
      expect(effectiveStat(100, g)).toBe(100);
    }
  });

  it('上限 (t=1) では、カーブの型によらず同じ値に着く', () => {
    const results = (['linear', 'early', 'late'] as const).map((curve) =>
      effectiveStat(100, growable({ level: 20, maxLevel: 20, growth: 0.5, curve })),
    );
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(150); // 100 * (1 + 0.5)
  });

  it('同じ growth/maxLevel でも、カーブの型で途中 (レベル上限より手前) の値が変わる', () => {
    const mid = { level: 10, maxLevel: 20, growth: 0.5 } as const;
    const linear = effectiveStat(100, growable({ ...mid, curve: 'linear' }));
    const early = effectiveStat(100, growable({ ...mid, curve: 'early' }));
    const late = effectiveStat(100, growable({ ...mid, curve: 'late' }));
    // 早熟は直線より高く、晩成は直線より低い (同じ t でも sqrt(t) > t > t^2、0<t<1 のとき)
    expect(early).toBeGreaterThan(linear);
    expect(late).toBeLessThan(linear);
  });

  it('maxLevel が 1 (実質上限なし扱いにはしない特殊値) でも t=1 として扱い、壊れない', () => {
    const g = growable({ level: 1, maxLevel: 1, growth: 0.5, curve: 'linear' });
    expect(() => effectiveStat(100, g)).not.toThrow();
  });
});

describe('addExp', () => {
  it('経験値が足りるとレベルが上がり、上限は超えない', () => {
    const g = { ...growable({ maxLevel: 3 }), exp: 0 };
    let total = 0;
    for (let lv = 1; lv < g.maxLevel; lv++) total += expToNextLevel(lv);
    const levels = addExp(g, total + 9999); // 大量に注いでも上限を超えない
    expect(g.level).toBe(g.maxLevel);
    expect(levels).toBeGreaterThan(0);
    expect(g.level).toBeLessThanOrEqual(g.maxLevel);
  });

  it('上限に達したキャラは経験値を受け取っても伸びない', () => {
    const g = { ...growable({ level: 5, maxLevel: 5 }), exp: 0 };
    const levels = addExp(g, 99999);
    expect(levels).toBe(0);
    expect(g.level).toBe(5);
    expect(g.exp).toBe(0);
  });

  it('主人公相当 (maxLevel 999) は事実上レベルが頭打ちにならない', () => {
    const g = { ...growable({ level: 1, maxLevel: 999 }), exp: 0 };
    addExp(g, 99999);
    expect(g.level).toBeGreaterThan(1);
    expect(g.level).toBeLessThan(999);
  });
});
