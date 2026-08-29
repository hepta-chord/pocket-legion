import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { advance, damage, heal, isWiped, startRun } from './run';

describe('advance', () => {
  it('進むたびに深度が 1 つ増え、イベントを 1 つ抱える', () => {
    const run = startRun(1);
    const rng = new Rng(1);
    advance(run, rng);
    expect(run.depth).toBe(2);
    expect(run.pending).not.toBeNull();
  });

  it('ボスの深度に着くとイベントを引かずにボス戦になる', () => {
    const run = startRun(1);
    const rng = new Rng(1);
    for (let i = 0; i < 20 && !run.atBoss; i++) advance(run, rng);
    expect(run.atBoss).toBe(true);
    expect(run.depth).toBe(10);
    expect(run.pending).toBeNull();
  });
});

describe('HP', () => {
  it('回復は最大値で止まる', () => {
    const run = startRun(1);
    heal(run, 999);
    expect(run.hp).toBe(run.maxHp);
  });

  it('被害は 0 で止まり、そこで全滅になる', () => {
    const run = startRun(1);
    damage(run, 999);
    expect(run.hp).toBe(0);
    expect(isWiped(run)).toBe(true);
  });
});
