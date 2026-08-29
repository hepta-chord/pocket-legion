import { describe, expect, it } from 'vitest';
import {
  effectiveCost,
  endTurn,
  GUARD_MAX,
  makeSkillState,
  MANA_CAP,
  MANA_PER_TURN,
  newParty,
  partyMaxHp,
  PARTY_BASE_HP,
  refillFront,
  startBattle,
  swapMembers,
  SWAP_COOLDOWN,
  useGuard,
  useSkill,
  whyCannotUse,
  type EnemyDef,
  type Fighter,
} from './battle';
import type { Faction } from './data/factions';
import type { ActionSkillDef, PassiveDef } from './data/skills';
import { Rng } from './rng';

// ---------------------------------------------------------------------------
// 部品

const SLASH: ActionSkillDef = {
  id: 'slash',
  name: '斬撃',
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'attack', target: 'one', power: 1 },
};

const FIRE: ActionSkillDef = {
  id: 'fire',
  name: '火弾',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'attack', target: 'one', power: 1.5 },
};

const NUKE: ActionSkillDef = {
  id: 'nuke',
  name: '終の一撃',
  category: 'ultimate',
  baseCost: 3,
  effect: { kind: 'attack', target: 'one', power: 3 },
  oncePerSortie: true,
};

const SACRIFICE: ActionSkillDef = {
  id: 'sacrifice',
  name: '捨て身',
  category: 'ultimate',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 2 },
  selfDown: true,
};

const PRAY: ActionSkillDef = {
  id: 'pray',
  name: '祈り',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'heal', power: 0.5 },
};

const CHEER: ActionSkillDef = {
  id: 'cheer',
  name: '鼓舞',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'buff', power: 0.5 },
};

function fighter(id: string, faction: Faction = 'kingdom', skills: ActionSkillDef[] = [SLASH], passives: PassiveDef[] = []): Fighter {
  return {
    id,
    name: id,
    faction,
    attack: 10,
    vitality: 5,
    skills: skills.map(makeSkillState),
    passives,
    downed: false,
  };
}

function enemy(over: Partial<EnemyDef> = {}): EnemyDef {
  return {
    id: 'e',
    name: '魔物',
    maxHp: 999,
    attack: 0,
    defense: 0,
    resist: null,
    bigEvery: 99,
    bigMul: 2,
    ...over,
  };
}

function battleOf(front: Fighter[], reserve: Fighter[] = [], enemies: EnemyDef[] = [enemy()]) {
  const party = newParty(front, reserve);
  return startBattle(party, 100, 100, enemies);
}

// ---------------------------------------------------------------------------

describe('マナ', () => {
  it('毎ターン払い出され、上限で頭打ちになる', () => {
    const state = battleOf([fighter('a')]);
    const rng = new Rng(1);
    expect(state.mana).toBe(MANA_PER_TURN);
    endTurn(state, rng);
    expect(state.mana).toBe(MANA_PER_TURN * 2);
    for (let i = 0; i < 5; i++) endTurn(state, rng);
    expect(state.mana).toBe(MANA_CAP);
  });

  it('パッシブが払い出しを増やす', () => {
    const passive: PassiveDef = { id: 'p', name: '泉脈', hooks: { manaPerTurn: 1 } };
    const state = battleOf([fighter('a', 'kingdom', [SLASH], [passive])]);
    expect(state.mana).toBe(MANA_PER_TURN + 1);
  });
});

describe('物理スキル', () => {
  it('同一ターン内の連打はコストが 1 ずつ上がり、ターン明けに戻る', () => {
    const state = battleOf([fighter('a')]);
    const rng = new Rng(1);
    const skill = state.party.front[0]!.skills[0];
    expect(effectiveCost(skill)).toBe(0);
    useSkill(state, 0, 0, rng);
    expect(effectiveCost(skill)).toBe(1);
    useSkill(state, 0, 0, rng);
    expect(effectiveCost(skill)).toBe(2);
    expect(state.mana).toBe(MANA_PER_TURN - 1);
    endTurn(state, rng);
    expect(effectiveCost(skill)).toBe(0);
  });

  it('0 コストを 2 枚持つと毎ターン 2 回タダで動ける', () => {
    const state = battleOf([fighter('a', 'kingdom', [SLASH, { ...SLASH, id: 'slash2' }])]);
    const rng = new Rng(1);
    useSkill(state, 0, 0, rng);
    useSkill(state, 0, 1, rng);
    expect(state.mana).toBe(MANA_PER_TURN);
  });
});

describe('魔法・必殺スキル', () => {
  it('使うたび出撃を通してコストが上がり、次の戦闘にも残る', () => {
    const f = fighter('a', 'kingdom', [FIRE]);
    const party = newParty([f]);
    let state = startBattle(party, 100, 100, [enemy()]);
    const rng = new Rng(1);
    state.mana = 10;
    useSkill(state, 0, 0, rng);
    expect(effectiveCost(f.skills[0])).toBe(3);
    endTurn(state, rng);
    expect(effectiveCost(f.skills[0])).toBe(3);
    state = startBattle(party, 100, 100, [enemy()]);
    expect(effectiveCost(f.skills[0])).toBe(3);
  });

  it('出撃中 1 回限定のスキルは 2 度使えない', () => {
    const state = battleOf([fighter('a', 'kingdom', [NUKE])]);
    const rng = new Rng(1);
    useSkill(state, 0, 0, rng);
    expect(whyCannotUse(state, 0, 0)).toBe('この出撃ではもう使えない');
  });

  it('代償スキルは使うと自分がダウンし、同陣営が自動で入る', () => {
    const state = battleOf([fighter('a', 'kingdom', [SACRIFICE])], [fighter('b', 'kingdom')]);
    const rng = new Rng(1);
    useSkill(state, 0, 0, rng);
    expect(state.party.front[0]?.id).toBe('b');
    expect(state.party.reserve).toHaveLength(0);
  });

  it('控えに同陣営がいなければ空きスロットになる', () => {
    const state = battleOf([fighter('a', 'kingdom', [SACRIFICE]), fighter('c', 'order')], [fighter('b', 'order')]);
    const rng = new Rng(1);
    useSkill(state, 0, 0, rng);
    expect(state.party.front[0]).toBeNull();
    expect(state.party.reserve).toHaveLength(1);
  });

  it('前衛がすべて空くと全滅扱いで負ける', () => {
    const state = battleOf([fighter('a', 'kingdom', [SACRIFICE])], [fighter('b', 'order')]);
    const rng = new Rng(1);
    useSkill(state, 0, 0, rng);
    expect(state.outcome).toBe('annihilated');
  });
});

describe('ガード', () => {
  it('1 マナで 1 枚。4 枚で打ち止め', () => {
    const state = battleOf([fighter('a')]);
    state.mana = 10;
    for (let i = 0; i < GUARD_MAX; i++) expect(useGuard(state)).toBe(true);
    expect(useGuard(state)).toBe(false);
    expect(state.mana).toBe(10 - GUARD_MAX);
  });

  it('積むほど被ダメージが減る', () => {
    const foe = enemy({ attack: 20 });
    const bare = battleOf([fighter('a')], [], [foe]);
    endTurn(bare, new Rng(7));
    const lostBare = 100 - bare.hp;

    const guarded = battleOf([fighter('a')], [], [foe]);
    guarded.mana = 10;
    for (let i = 0; i < 4; i++) useGuard(guarded);
    endTurn(guarded, new Rng(7));
    const lostGuarded = 100 - guarded.hp;

    expect(lostBare).toBeGreaterThan(0);
    expect(lostGuarded).toBeLessThan(lostBare * 0.3);
  });

  it('大技はガードが 1 枚でもあればダウンを防ぐ', () => {
    const foe = enemy({ attack: 5, bigEvery: 1 });
    const hit = battleOf([fighter('a')], [fighter('b', 'kingdom')], [foe]);
    endTurn(hit, new Rng(1));
    expect(hit.stats.downs).toBe(1);

    const held = battleOf([fighter('a')], [fighter('b', 'kingdom')], [foe]);
    useGuard(held);
    endTurn(held, new Rng(1));
    expect(held.stats.downs).toBe(0);
  });
});

describe('交代', () => {
  it('複数人を一度に入れ替えられ、下がった側はダウンする', () => {
    const state = battleOf(
      [fighter('a'), fighter('b')],
      [fighter('c', 'order'), fighter('d', 'order')],
    );
    const ok = swapMembers(state, [
      { slot: 0, reserveId: 'c' },
      { slot: 1, reserveId: 'd' },
    ]);
    expect(ok).toBe(true);
    expect(state.party.front[0]?.id).toBe('c');
    expect(state.party.front[1]?.id).toBe('d');
    expect(state.party.swapCooldown).toBe(SWAP_COOLDOWN);
  });

  it('クールタイム中は使えず、ターンごとに 1 減る', () => {
    const state = battleOf([fighter('a')], [fighter('c', 'order'), fighter('d', 'order')]);
    const rng = new Rng(1);
    swapMembers(state, [{ slot: 0, reserveId: 'c' }]);
    expect(swapMembers(state, [{ slot: 1, reserveId: 'd' }])).toBe(false);
    for (let i = 0; i < SWAP_COOLDOWN; i++) endTurn(state, rng);
    expect(swapMembers(state, [{ slot: 1, reserveId: 'd' }])).toBe(true);
  });

  it('空きスロットへの補充は誰もダウンさせない', () => {
    const state = battleOf([fighter('a')], [fighter('c', 'order')]);
    swapMembers(state, [{ slot: 1, reserveId: 'c' }]);
    expect(state.stats.downs).toBe(0);
    expect(state.party.front[1]?.id).toBe('c');
  });
});

describe('ダメージ', () => {
  it('耐性は該当属性のダメージを減らす', () => {
    const bare = battleOf([fighter('a', 'kingdom', [FIRE])], [], [enemy()]);
    useSkill(bare, 0, 0, new Rng(5));
    const plain = 999 - bare.enemies[0].hp;

    const walled = battleOf([fighter('a', 'kingdom', [FIRE])], [], [enemy({ resist: 'magic' })]);
    useSkill(walled, 0, 0, new Rng(5));
    const resisted = 999 - walled.enemies[0].hp;

    expect(resisted).toBeLessThan(plain);
    expect(resisted).toBeGreaterThanOrEqual(Math.floor(plain / 2));
  });

  it('物理耐性は魔法に効かない', () => {
    const state = battleOf([fighter('a', 'kingdom', [FIRE])], [], [enemy({ resist: 'physical' })]);
    const twin = battleOf([fighter('a', 'kingdom', [FIRE])], [], [enemy()]);
    useSkill(state, 0, 0, new Rng(5));
    useSkill(twin, 0, 0, new Rng(5));
    expect(state.enemies[0].hp).toBe(twin.enemies[0].hp);
  });

  it('支援はターン中の攻撃を底上げし、ターン明けに消える', () => {
    const buffed = battleOf([fighter('a', 'kingdom', [CHEER, SLASH])]);
    useSkill(buffed, 0, 0, new Rng(9));
    useSkill(buffed, 0, 1, new Rng(5));
    const withBuff = 999 - buffed.enemies[0].hp;

    const bare = battleOf([fighter('a', 'kingdom', [CHEER, SLASH])]);
    useSkill(bare, 0, 1, new Rng(5));
    const without = 999 - bare.enemies[0].hp;

    expect(withBuff).toBeGreaterThan(without);
    endTurn(buffed, new Rng(1));
    expect(buffed.buff).toBe(0);
  });

  it('回復は最大値で止まる', () => {
    const state = battleOf([fighter('a', 'kingdom', [PRAY])]);
    state.hp = 80;
    useSkill(state, 0, 0, new Rng(1));
    expect(state.hp).toBe(100);
  });
});

describe('決着', () => {
  it('敵を討ち果たすと勝ち', () => {
    const state = battleOf([fighter('a')], [], [enemy({ maxHp: 1 })]);
    useSkill(state, 0, 0, new Rng(1));
    expect(state.outcome).toBe('victory');
  });

  it('パーティ HP が尽きると全滅', () => {
    const state = battleOf([fighter('a')], [], [enemy({ attack: 500 })]);
    endTurn(state, new Rng(1));
    expect(state.outcome).toBe('wipe');
    expect(state.hp).toBe(0);
  });
});

describe('予告', () => {
  it('カウントが減り、大技のあと元に戻る', () => {
    const state = battleOf([fighter('a')], [fighter('b', 'kingdom'), fighter('c', 'kingdom')], [enemy({ attack: 1, bigEvery: 2 })]);
    const rng = new Rng(1);
    expect(state.enemies[0].countdown).toBe(2);
    endTurn(state, rng);
    expect(state.enemies[0].countdown).toBe(1);
    endTurn(state, rng);
    expect(state.enemies[0].countdown).toBe(2);
  });

  it('パッシブが予告を延ばす', () => {
    const passive: PassiveDef = { id: 'p', name: '斥候', hooks: { telegraph: 1 } };
    const state = battleOf([fighter('a', 'kingdom', [SLASH], [passive])], [], [enemy({ bigEvery: 2 })]);
    expect(state.enemies[0].countdown).toBe(3);
  });
});

describe('編成の器', () => {
  it('最大 HP は土台 + 出撃メンバーの体力の合計になる', () => {
    const party = newParty([fighter('a'), fighter('b')], [fighter('c')]);
    expect(partyMaxHp(party)).toBe(PARTY_BASE_HP + 15);
  });

  it('refillFront が空きスロットを控えで埋める', () => {
    const party = newParty([fighter('a')], [fighter('b'), fighter('c')]);
    party.front[0] = null;
    refillFront(party);
    expect(party.front.filter(Boolean)).toHaveLength(2);
    expect(party.reserve).toHaveLength(0);
  });
});
