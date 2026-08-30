import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { ALT_CHANCE, decideOccurrence, EVENTS, pickEvent, TOTAL_WEIGHT } from './events';

describe('EVENTS の構成', () => {
  it('罠 (trap) は単独のイベントとして抽選されない。何も無い (nothing) が入っている', () => {
    const kinds = EVENTS.map((e) => e.kind);
    expect(kinds).not.toContain('trap');
    expect(kinds).toContain('nothing');
  });

  it('宝箱は「開ける/見送る」の二択を持つ', () => {
    const treasure = EVENTS.find((e) => e.kind === 'treasure')!;
    expect(treasure.action).toBe('開ける');
    expect(treasure.altAction).toBe('見送る');
  });
});

describe('pickEvent', () => {
  it('重みの境目でイベントが切り替わる', () => {
    let acc = 0;
    for (const e of EVENTS) {
      expect(pickEvent(acc).kind).toBe(e.kind);
      expect(pickEvent(acc + e.weight - 1).kind).toBe(e.kind);
      acc += e.weight;
    }
  });

  it('全域が引ける。取りこぼしの重みがない', () => {
    const seen = new Set<string>();
    for (let roll = 0; roll < TOTAL_WEIGHT; roll++) seen.add(pickEvent(roll).kind);
    expect(seen.size).toBe(EVENTS.length);
  });
});

describe('decideOccurrence (二択が実際に出る確率)', () => {
  it('altAction を持たないイベントはそのまま返す', () => {
    const battle = EVENTS.find((e) => e.kind === 'battle')!;
    expect(decideOccurrence(battle, new Rng(1))).toBe(battle);
  });

  it('altAction を持つイベントでも、毎回は二択にならない (ALT_CHANCE 程度の統計テスト)', () => {
    const treasure = EVENTS.find((e) => e.kind === 'treasure')!;
    expect(treasure.altAction).toBeDefined();
    const rng = new Rng(1);
    const trials = 4000;
    let withAlt = 0;
    for (let i = 0; i < trials; i++) {
      if (decideOccurrence(treasure, rng).altAction) withAlt += 1;
    }
    const rate = withAlt / trials;
    // 統計テストなので幅を持たせる (期待値 ALT_CHANCE=0.2 の ±0.05)
    expect(rate).toBeGreaterThan(ALT_CHANCE - 0.05);
    expect(rate).toBeLessThan(ALT_CHANCE + 0.05);
  });

  it('元の EVENTS の要素は書き換えない (occurrence は新しいオブジェクト)', () => {
    const spring = EVENTS.find((e) => e.kind === 'spring')!;
    const rng = new Rng(2);
    for (let i = 0; i < 50; i++) decideOccurrence(spring, rng);
    expect(spring.altAction).toBe('経験値をもらう');
  });
});
