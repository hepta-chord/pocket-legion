import { describe, expect, it } from 'vitest';
import { EVENTS, pickEvent, TOTAL_WEIGHT } from './events';

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
