import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { makeBoss, makeFoe } from './enemies';

describe('makeBoss', () => {
  it('浅層のダウン攻撃は 10 ターンに 1 回、中層・深層はそこから少し詰める', () => {
    expect(makeBoss(1, new Rng(1)).downEvery).toBe(10);
    expect(makeBoss(2, new Rng(1)).downEvery).toBe(9);
    expect(makeBoss(3, new Rng(1)).downEvery).toBe(8);
  });

  it('スタンは stunEvery のクールタイム制で持ち、行動パターンの抽選には乗らない', () => {
    const boss = makeBoss(2, new Rng(1));
    expect(boss.stunEvery).not.toBeNull();
    expect(boss.pattern.some((a) => a.kind === 'stun')).toBe(false);
    expect(boss.pattern.map((a) => a.kind).sort()).toEqual(['attack', 'cheer', 'ward']);
  });

  it('浅層は中層・深層よりスタンの間隔が長い (猶予がある)', () => {
    const shallow = makeBoss(1, new Rng(1));
    const mid = makeBoss(2, new Rng(1));
    expect(shallow.stunEvery!).toBeGreaterThan(mid.stunEvery!);
  });
});

describe('makeFoe', () => {
  it('行動パターンは attack だけで、スタンは乗らない', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 30; i++) {
      const foe = makeFoe(10, rng);
      expect(foe.pattern).toEqual([{ kind: 'attack' }]);
    }
  });

  it('スタン持ちの雑魚は stunEvery が 4〜6 の範囲で、人数は 1 人のまま', () => {
    const rng = new Rng(3);
    let sawStun = false;
    for (let i = 0; i < 200; i++) {
      const foe = makeFoe(10, rng);
      if (foe.stunEvery === null) continue;
      sawStun = true;
      expect(foe.stunEvery).toBeGreaterThanOrEqual(4);
      expect(foe.stunEvery).toBeLessThanOrEqual(6);
      expect(foe.stunRange).toEqual({ min: 1, max: 1 });
    }
    expect(sawStun).toBe(true);
  });
});
