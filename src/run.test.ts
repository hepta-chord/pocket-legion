import { describe, expect, it } from 'vitest';
import { CHARACTERS } from './data/characters';
import { Rng } from './rng';
import { addToDeck, advance, damage, heal, isWiped, reviveDowned, startRun } from './run';

const ROSTER = ['hero', 'mate'];

describe('advance', () => {
  it('進むたびに深度が 1 つ増え、イベントを 1 つ抱える', () => {
    const run = startRun(1, ROSTER);
    const rng = new Rng(1);
    advance(run, rng);
    expect(run.depth).toBe(2);
    expect(run.pending).not.toBeNull();
  });

  it('ボスの深度に着くとイベントを引かずにボス戦になる', () => {
    const run = startRun(1, ROSTER);
    const rng = new Rng(1);
    for (let i = 0; i < 20 && !run.atBoss; i++) advance(run, rng);
    expect(run.atBoss).toBe(true);
    expect(run.depth).toBe(10);
    expect(run.pending).toBeNull();
  });

  it('ボスの 1 つ手前の深度は固定でボス前の分岐イベントになる', () => {
    const run = startRun(1, ROSTER);
    const rng = new Rng(1);
    for (let i = 0; i < 20 && run.depth < 9; i++) advance(run, rng);
    expect(run.depth).toBe(9);
    expect(run.pending?.kind).toBe('boss-alt');
  });
});

describe('HP', () => {
  it('回復は最大値で止まる', () => {
    const run = startRun(1, ROSTER);
    heal(run, 99999);
    expect(run.hp).toBe(run.maxHp);
  });

  it('被害は 0 で止まり、そこで全滅になる', () => {
    const run = startRun(1, ROSTER);
    damage(run, 99999);
    expect(run.hp).toBe(0);
    expect(isWiped(run)).toBe(true);
  });
});

describe('編成', () => {
  it('roster 全員でパーティを組む。前衛 6 まで、あふれれば控え', () => {
    const bigRoster = CHARACTERS.map((c) => c.id);
    const run = startRun(1, bigRoster);
    expect(run.party.front.filter(Boolean)).toHaveLength(6);
    expect(run.party.reserve.length).toBe(bigRoster.length - 6);
  });

  it('roster が 2 人だけなら 2 人で潜る', () => {
    const run = startRun(1, ROSTER);
    expect(run.party.front.filter(Boolean)).toHaveLength(2);
    expect(run.party.reserve).toHaveLength(0);
  });
});

describe('addToDeck', () => {
  it('前衛に空きがあれば前衛に、無ければ控えに入り、maxHp が伸びる', () => {
    const run = startRun(1, ROSTER);
    const before = run.maxHp;
    const entry = CHARACTERS.find((c) => c.id === 'k1')!;
    addToDeck(run, entry);
    expect(run.party.front.some((f) => f?.id === 'k1')).toBe(true);
    expect(run.maxHp).toBeGreaterThan(before);
  });
});

describe('reviveDowned', () => {
  it('ダウンした Fighter を前衛の空きから戻し、downed を空にする', () => {
    const run = startRun(1, ROSTER);
    const downedFighter = run.party.front[0]!;
    run.party.front[0] = null;
    run.downed.push(downedFighter);

    const revived = reviveDowned(run);

    expect(revived).toBe(1);
    expect(run.downed).toHaveLength(0);
    expect(downedFighter.downed).toBe(false);
    expect(run.party.front.some((f) => f === downedFighter)).toBe(true);
  });
});
