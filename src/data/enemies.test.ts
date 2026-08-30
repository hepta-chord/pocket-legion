import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { makeBoss, makeFoe } from './enemies';

describe('makeBoss', () => {
  it('浅層のダウン攻撃は 10 ターンに 1 回、中層・深層はそこから少し詰める', () => {
    expect(makeBoss(1, new Rng(1)).downEvery).toBe(10);
    expect(makeBoss(2, new Rng(1)).downEvery).toBe(9);
    expect(makeBoss(3, new Rng(1)).downEvery).toBe(8);
  });

  it('スタンは stunEvery のクールタイム制で持ち、行動枠の抽選には乗らない', () => {
    const boss = makeBoss(2, new Rng(1));
    expect(boss.stunEvery).not.toBeNull();
    for (const slot of boss.slots) expect(slot.some((c) => c.action.kind === 'stun')).toBe(false);
  });

  it('2 枠持ち、枠 1 は攻撃 9:何もしない 1、枠 2 は鼓舞・防御を含む重み付けになっている', () => {
    const boss = makeBoss(1, new Rng(1));
    expect(boss.slots).toHaveLength(2);
    const [slot1, slot2] = boss.slots;
    expect(slot1.map((c) => c.action.kind).sort()).toEqual(['attack', 'none'].sort());
    expect(slot1.find((c) => c.action.kind === 'attack')?.weight).toBe(9);
    expect(slot1.find((c) => c.action.kind === 'none')?.weight).toBe(1);
    expect(slot2.some((c) => c.action.kind === 'cheer')).toBe(true);
    expect(slot2.some((c) => c.action.kind === 'ward')).toBe(true);
  });

  it('深いほど枠 2 の攻撃寄りの重みが増える (浅層 < 中層 < 深層)', () => {
    const weightOf = (sectorId: number, kind: 'attack' | 'cheer') =>
      makeBoss(sectorId, new Rng(1)).slots[1].find((c) => c.action.kind === kind)?.weight ?? 0;
    expect(weightOf(1, 'attack')).toBeLessThan(weightOf(2, 'attack'));
    expect(weightOf(2, 'attack')).toBeLessThan(weightOf(3, 'attack'));
    expect(weightOf(1, 'cheer')).toBeGreaterThan(weightOf(3, 'cheer'));
  });

  it('浅層は中層・深層よりスタンの間隔が長い (猶予がある)', () => {
    const shallow = makeBoss(1, new Rng(1));
    const mid = makeBoss(2, new Rng(1));
    expect(shallow.stunEvery!).toBeGreaterThan(mid.stunEvery!);
  });
});

describe('makeFoe', () => {
  it('行動枠は 1 つで攻撃 9:何もしない 1、スタンは乗らない', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 30; i++) {
      const foe = makeFoe(10, rng);
      expect(foe.slots).toHaveLength(1);
      const slot = foe.slots[0];
      expect(slot.map((c) => c.action.kind).sort()).toEqual(['attack', 'none'].sort());
      expect(slot.some((c) => c.action.kind === 'stun')).toBe(false);
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
