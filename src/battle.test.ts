import { describe, expect, it } from 'vitest';
import {
  DEFENSE_MAX,
  effectiveCost,
  endTurn,
  makeSkillState,
  MANA_CAP,
  newParty,
  partyMaxHp,
  PARTY_BASE_HP,
  refillFront,
  resetSortieProgress,
  startBattle,
  swapMembers,
  SWAP_COOLDOWN,
  toggleFlee,
  useDefense,
  usePotion,
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
  shortName: '斬撃',
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'attack', target: 'one', power: 1 },
};

const FIRE: ActionSkillDef = {
  id: 'fire',
  name: '火弾',
  shortName: '火弾',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'attack', target: 'one', power: 1.5 },
};

const NUKE: ActionSkillDef = {
  id: 'nuke',
  name: '終の一撃',
  shortName: '終撃',
  category: 'ultimate',
  baseCost: 3,
  effect: { kind: 'attack', target: 'one', power: 3 },
  oncePerSortie: true,
};

const SACRIFICE: ActionSkillDef = {
  id: 'sacrifice',
  name: '捨て身',
  shortName: '捨身',
  category: 'ultimate',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 2 },
  selfDown: true,
};

const PRAY: ActionSkillDef = {
  id: 'pray',
  name: '祈り',
  shortName: '祈り',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'heal', power: 0.5 },
};

const CHEER: ActionSkillDef = {
  id: 'cheer',
  name: '鼓舞',
  shortName: '鼓舞',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'cheer', stacks: 1 },
};

const CHEER2: ActionSkillDef = {
  id: 'cheer2',
  name: '大鼓舞',
  shortName: '大鼓舞',
  category: 'physical',
  baseCost: 2,
  effect: { kind: 'cheer', stacks: 2 },
};

const WARD: ActionSkillDef = {
  id: 'ward',
  name: 'ガード',
  shortName: 'ガード',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'ward', stacks: 1 },
};

const WARD2: ActionSkillDef = {
  id: 'ward2',
  name: '鉄壁',
  shortName: '鉄壁',
  category: 'physical',
  baseCost: 2,
  effect: { kind: 'ward', stacks: 2 },
};

const STORM: ActionSkillDef = {
  id: 'storm',
  name: '火群',
  shortName: '火群',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'attack', target: 'all', power: 1 },
};

const BARRIER: ActionSkillDef = {
  id: 'barrier',
  name: '守りの膜',
  shortName: '守膜',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'barrier' },
};

const STUN_SELF: ActionSkillDef = {
  id: 'stun-self',
  name: 'テスト代償気絶',
  shortName: '気絶',
  category: 'magic',
  baseCost: 0,
  effect: { kind: 'stun-self' },
};

const COVER: PassiveDef = { id: 'cover', name: '身代わり', hooks: { cover: true } };

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
    stunnedUntil: 0,
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
    downEvery: null,
    pattern: [{ kind: 'attack' }],
    groupSize: 1,
    isBoss: false,
    ...over,
  };
}

/** ボス。デフォルトでは大技・ダウン攻撃を起こさない間隔にしておき、テストごとに個別に短くする */
function boss(over: Partial<EnemyDef> = {}): EnemyDef {
  return enemy({ isBoss: true, downEvery: null, ...over });
}

function battleOf(front: Fighter[], reserve: Fighter[] = [], foe: EnemyDef = enemy()) {
  const party = newParty(front, reserve);
  return startBattle(party, 100, 100, foe);
}

// ---------------------------------------------------------------------------

describe('マナの奇偶', () => {
  it('奇数ターンは 2、偶数ターンは 3 が基礎になる', () => {
    const state = battleOf([fighter('a')]);
    const rng = new Rng(1);
    expect(state.turn).toBe(1);
    expect(state.mana).toBe(2);
    endTurn(state, rng); // turn -> 2 (偶数)
    expect(state.turn).toBe(2);
    expect(state.mana).toBe(2 + 3);
    endTurn(state, rng); // turn -> 3 (奇数)
    expect(state.turn).toBe(3);
    expect(state.mana).toBe(Math.min(MANA_CAP, 2 + 3 + 2));
  });

  it('上限で頭打ちになる', () => {
    const state = battleOf([fighter('a')]);
    const rng = new Rng(1);
    for (let i = 0; i < 10; i++) endTurn(state, rng);
    expect(state.mana).toBe(MANA_CAP);
  });

  it('パッシブが払い出しを増やす', () => {
    const passive: PassiveDef = { id: 'p', name: '泉脈', hooks: { manaPerTurn: 1 } };
    const state = battleOf([fighter('a', 'kingdom', [SLASH], [passive])]);
    expect(state.mana).toBe(2 + 1);
  });

  it('manaBonus は奇数ターンの基礎に乗る (中層クリアで 3/3 になる)', () => {
    const party = newParty([fighter('a')]);
    const state = startBattle(party, 100, 100, enemy(), 1);
    expect(state.turn).toBe(1);
    expect(state.mana).toBe(3); // 2 + manaBonus(1)
    endTurn(state, new Rng(1));
    expect(state.mana).toBe(3 + 3); // 偶数ターンは manaBonus の影響を受けない
  });
});

describe('物理スキル', () => {
  it('連打で 1 上がるが +1 で頭打ちになり、ターン明けに戻る', () => {
    const state = battleOf([fighter('a')]);
    const rng = new Rng(1);
    const skill = state.party.front[0]!.skills[0];
    expect(effectiveCost(skill)).toBe(0);
    useSkill(state, 0, 0, rng);
    expect(effectiveCost(skill)).toBe(1);
    useSkill(state, 0, 0, rng);
    expect(effectiveCost(skill)).toBe(1);
    useSkill(state, 0, 0, rng);
    expect(state.mana).toBe(2 - 2);
    endTurn(state, rng);
    expect(effectiveCost(skill)).toBe(0);
  });

  it('0 コストを 2 枚持つと毎ターン 2 回タダで動ける', () => {
    const state = battleOf([fighter('a', 'kingdom', [SLASH, { ...SLASH, id: 'slash2' }])]);
    const rng = new Rng(1);
    useSkill(state, 0, 0, rng);
    useSkill(state, 0, 1, rng);
    expect(state.mana).toBe(2);
  });
});

describe('魔法・必殺スキル', () => {
  it('使うたび出撃を通してコストが上がり、次の戦闘にも残る', () => {
    const f = fighter('a', 'kingdom', [FIRE]);
    const party = newParty([f]);
    let state = startBattle(party, 100, 100, enemy());
    const rng = new Rng(1);
    state.mana = 10;
    useSkill(state, 0, 0, rng);
    expect(effectiveCost(f.skills[0])).toBe(3);
    endTurn(state, rng);
    expect(effectiveCost(f.skills[0])).toBe(3);
    state = startBattle(party, 100, 100, enemy());
    expect(effectiveCost(f.skills[0])).toBe(3);
  });

  it('出撃中 1 回限定のスキルは 2 度使えない', () => {
    const state = battleOf([fighter('a', 'kingdom', [NUKE])]);
    state.mana = 10;
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

describe('防御', () => {
  it('1 マナで 1 枚。4 枚で打ち止め', () => {
    const state = battleOf([fighter('a')]);
    state.mana = 10;
    for (let i = 0; i < DEFENSE_MAX; i++) expect(useDefense(state)).toBe(true);
    expect(useDefense(state)).toBe(false);
    expect(state.mana).toBe(10 - DEFENSE_MAX);
  });

  it('軽減率は 1/2/3/4 枚でそれぞれ 20/45/70/90%', () => {
    // 大技 (bigMul 1、bigEvery 1) は乱数を挟まない決め打ちのダメージなので、軽減率をそのまま検算できる
    const rates = [0, 0.2, 0.45, 0.7, 0.9];
    for (let n = 0; n <= DEFENSE_MAX; n++) {
      const foe = boss({ attack: 1000, bigMul: 1, bigEvery: 1 });
      const party = newParty([fighter('a')]);
      const state = startBattle(party, 100000, 100000, foe);
      state.mana = 10;
      for (let i = 0; i < n; i++) useDefense(state);
      endTurn(state, new Rng(7));
      const lost = 100000 - state.hp;
      const expected = Math.round(1000 * (1 - rates[n]));
      expect(lost).toBe(expected);
    }
  });
});

describe('鼓舞・ガード (ward) のスタック', () => {
  it('3 枚まで積め、3 ターンで切れる', () => {
    const state = battleOf([fighter('a', 'kingdom', [CHEER])]);
    state.mana = 10;
    const rng = new Rng(1);
    useSkill(state, 0, 0, rng);
    expect(state.cheer.stacks).toBe(1);
    useSkill(state, 0, 0, rng);
    expect(state.cheer.stacks).toBe(2);
    useSkill(state, 0, 0, rng);
    expect(state.cheer.stacks).toBe(3);
    useSkill(state, 0, 0, rng); // 上限を超えては積めない
    expect(state.cheer.stacks).toBe(3);

    // 3 ターン持続する (turns は再付与のたび 3 に戻る)。ここでは追加せず経過だけ見る
    endTurn(state, rng);
    expect(state.cheer.stacks).toBe(3);
    endTurn(state, rng);
    expect(state.cheer.stacks).toBe(3);
    endTurn(state, rng);
    expect(state.cheer.stacks).toBe(0);
  });

  it('重ねがけでターンが 3 に戻る', () => {
    const state = battleOf([fighter('a', 'kingdom', [CHEER])]);
    state.mana = 10;
    const rng = new Rng(1);
    useSkill(state, 0, 0, rng);
    endTurn(state, rng);
    endTurn(state, rng);
    // ここで切れる直前 (turns=1) のはず。ここで積み直すと turns が 3 に戻る
    useSkill(state, 0, 0, rng);
    endTurn(state, rng);
    endTurn(state, rng);
    expect(state.cheer.stacks).toBe(2); // まだ切れていない (turns を 3 に戻せていた証拠)
    endTurn(state, rng);
    expect(state.cheer.stacks).toBe(0);
  });

  it('cheer2 / ward2 は一度に 2 枚積む', () => {
    const state = battleOf([fighter('a', 'kingdom', [CHEER2, WARD2])]);
    state.mana = 10;
    const rng = new Rng(1);
    useSkill(state, 0, 0, rng);
    expect(state.cheer.stacks).toBe(2);
    useSkill(state, 0, 1, rng);
    expect(state.ward.stacks).toBe(2);
  });

  it('鼓舞は攻撃力を、ward は被ダメージを軽減する', () => {
    const cheered = battleOf([fighter('a', 'kingdom', [CHEER, SLASH])], [], enemy({ maxHp: 99999 }));
    cheered.mana = 10;
    useSkill(cheered, 0, 0, new Rng(5)); // 鼓舞
    useSkill(cheered, 0, 1, new Rng(5)); // 攻撃
    const withCheer = 99999 - cheered.enemy.hp;

    const bare = battleOf([fighter('a', 'kingdom', [CHEER, SLASH])], [], enemy({ maxHp: 99999 }));
    useSkill(bare, 0, 1, new Rng(5));
    const without = 99999 - bare.enemy.hp;
    expect(withCheer).toBeGreaterThan(without);
  });

  it('防御と ward の軽減は掛け算で重なる (防御 4 枚 + ward 3 枚で被害 4% 前後)', () => {
    // 大技 (乱数無し、決め打ちダメージ) で検算する
    const foe = boss({ attack: 1000, bigMul: 1, bigEvery: 1 });
    const party = newParty([fighter('a', 'kingdom', [WARD, WARD, WARD])]);
    const state = startBattle(party, 100000, 100000, foe);
    state.mana = 10;
    const rng = new Rng(1);
    for (let i = 0; i < 4; i++) useDefense(state);
    useSkill(state, 0, 0, rng);
    useSkill(state, 0, 1, rng);
    useSkill(state, 0, 2, rng);
    expect(state.ward.stacks).toBe(3);
    endTurn(state, rng);
    const lost = 100000 - state.hp;
    // 防御 0.9 (10%残る) × ward 0.6 (40%残る) = 4%残る -> 1000 の 4% = 40
    expect(lost).toBe(40);
  });
});

describe('スタン', () => {
  it('対象をそのターンと次のターン行動不可にし、whyCannotUse が理由を返す', () => {
    const state = battleOf([fighter('a')]);
    const target = state.party.front[0]!;
    // 「そのターン」に掛かったとみなし、次のターンぶんまで効かせる
    target.stunnedUntil = state.turn + 1;
    expect(whyCannotUse(state, 0, 0)).toBe('気絶している');

    const rng = new Rng(1);
    endTurn(state, rng); // turn が 1 つ進んでも、まだ stunnedUntil 以下なので気絶中
    expect(state.turn).toBeLessThanOrEqual(target.stunnedUntil);
    expect(whyCannotUse(state, 0, 0)).toBe('気絶している');

    endTurn(state, rng); // さらに進めば解ける
    expect(state.turn).toBeGreaterThan(target.stunnedUntil);
    expect(whyCannotUse(state, 0, 0)).toBeNull();
  });

  it('スタン中は交代の対象にも選べない', () => {
    const state = battleOf([fighter('a')], [fighter('c', 'order')]);
    const target = state.party.front[0]!;
    target.stunnedUntil = state.turn + 1;
    expect(swapMembers(state, [{ slot: 0, reserveId: 'c' }])).toBe(false);
  });

  it('ボスのスタンがランダム人数を巻き込む', () => {
    const foe = boss({ attack: 0, bigEvery: 99, pattern: [{ kind: 'stun', min: 2, max: 2 }] });
    const state = battleOf(
      [fighter('a'), fighter('b'), fighter('c'), fighter('d')],
      [],
      foe,
    );
    endTurn(state, new Rng(3));
    const stunned = state.party.front.filter((f) => f && f.stunnedUntil >= state.turn);
    expect(stunned).toHaveLength(2);
  });

  it('stun-self エフェクトは発動者自身をスタンさせる', () => {
    const state = battleOf([fighter('a', 'kingdom', [STUN_SELF])]);
    const self = state.party.front[0]!;
    useSkill(state, 0, 0, new Rng(1));
    expect(self.stunnedUntil).toBeGreaterThanOrEqual(state.turn);
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
    const bare = battleOf([fighter('a', 'kingdom', [FIRE])], [], enemy());
    useSkill(bare, 0, 0, new Rng(5));
    const plain = 999 - bare.enemy.hp;

    const walled = battleOf([fighter('a', 'kingdom', [FIRE])], [], enemy({ resist: 'magic' }));
    useSkill(walled, 0, 0, new Rng(5));
    const resisted = 999 - walled.enemy.hp;

    expect(resisted).toBeLessThan(plain);
    expect(resisted).toBeGreaterThanOrEqual(Math.floor(plain / 2));
  });

  it('物理耐性は魔法に効かない', () => {
    const state = battleOf([fighter('a', 'kingdom', [FIRE])], [], enemy({ resist: 'physical' }));
    const twin = battleOf([fighter('a', 'kingdom', [FIRE])], [], enemy());
    useSkill(state, 0, 0, new Rng(5));
    useSkill(twin, 0, 0, new Rng(5));
    expect(state.enemy.hp).toBe(twin.enemy.hp);
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
    const state = battleOf([fighter('a')], [], enemy({ maxHp: 1 }));
    useSkill(state, 0, 0, new Rng(1));
    expect(state.outcome).toBe('victory');
  });

  it('パーティ HP が尽きると全滅', () => {
    const state = battleOf([fighter('a')], [], enemy({ attack: 500 }));
    endTurn(state, new Rng(1));
    expect(state.outcome).toBe('wipe');
    expect(state.hp).toBe(0);
  });
});

describe('予告', () => {
  it('大技のカウントが減り、発動のあと元に戻る', () => {
    const state = battleOf([fighter('a')], [fighter('b', 'kingdom'), fighter('c', 'kingdom')], enemy({ attack: 1, bigEvery: 2 }));
    const rng = new Rng(1);
    expect(state.enemy.bigCountdown).toBe(2);
    endTurn(state, rng);
    expect(state.enemy.bigCountdown).toBe(1);
    endTurn(state, rng);
    expect(state.enemy.bigCountdown).toBe(2);
  });

  it('パッシブが予告を延ばす', () => {
    const passive: PassiveDef = { id: 'p', name: '斥候', hooks: { telegraph: 1 } };
    const state = battleOf([fighter('a', 'kingdom', [SLASH], [passive])], [], enemy({ bigEvery: 2 }));
    expect(state.enemy.bigCountdown).toBe(3);
  });

  it('ダウン攻撃も別カウントダウンで予告される', () => {
    const state = battleOf([fighter('a')], [], enemy({ bigEvery: 99, downEvery: 3 }));
    expect(state.enemy.downCountdown).toBe(3);
    const rng = new Rng(1);
    endTurn(state, rng);
    expect(state.enemy.downCountdown).toBe(2);
  });

  it('ダウン攻撃を持たない敵は downCountdown が null', () => {
    const state = battleOf([fighter('a')], [], enemy({ downEvery: null }));
    expect(state.enemy.downCountdown).toBeNull();
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

describe('大技', () => {
  it('雑魚の大技はダメージだけで、ダウンを起こさない', () => {
    const foe = enemy({ attack: 5, bigEvery: 1, isBoss: false });
    const state = battleOf([fighter('a')], [fighter('b', 'kingdom')], foe);
    endTurn(state, new Rng(1));
    expect(state.hp).toBeLessThan(100);
    expect(state.stats.downs).toBe(0);
  });

  it('ボスの大技もダウンを起こさない (guardBreak は廃止)', () => {
    const foe = boss({ attack: 5, bigEvery: 1 });
    const state = battleOf([fighter('a')], [fighter('b', 'kingdom')], foe);
    endTurn(state, new Rng(1));
    expect(state.hp).toBeLessThan(100);
    expect(state.stats.downs).toBe(0);
  });

  it('防御を積むほど大技の被害が減る', () => {
    const foe = boss({ attack: 100, bigMul: 2, bigEvery: 1 });
    const bare = battleOf([fighter('a')], [], foe);
    endTurn(bare, new Rng(1));
    const lostBare = 100 - bare.hp;

    const guarded = battleOf([fighter('a')], [], foe);
    guarded.mana = 10;
    for (let i = 0; i < 4; i++) useDefense(guarded);
    endTurn(guarded, new Rng(1));
    const lostGuarded = 100 - guarded.hp;

    expect(lostGuarded).toBeLessThan(lostBare);
  });
});

describe('ダウン攻撃', () => {
  it('ダウンを起こし、防御では防げない', () => {
    const foe = boss({ attack: 5, bigEvery: 99, downEvery: 1 });
    const state = battleOf([fighter('a')], [fighter('b', 'kingdom')], foe);
    state.mana = 10;
    for (let i = 0; i < 4; i++) useDefense(state);
    endTurn(state, new Rng(1));
    expect(state.stats.downs).toBe(1);
  });

  it('雑魚のダウン攻撃も同様にダウンを起こす', () => {
    const foe = enemy({ attack: 5, bigEvery: 99, downEvery: 1, isBoss: false });
    const state = battleOf([fighter('a')], [fighter('b', 'kingdom')], foe);
    endTurn(state, new Rng(1));
    expect(state.stats.downs).toBe(1);
  });

  it('バリアで防げる', () => {
    const foe = boss({ attack: 5, bigEvery: 99, downEvery: 1 });
    const state = battleOf([fighter('a', 'kingdom', [BARRIER])], [fighter('b', 'kingdom')], foe);
    state.mana = 10;
    useSkill(state, 0, 0, new Rng(1));
    expect(state.barrier).toBe(true);
    endTurn(state, new Rng(1));
    expect(state.stats.downs).toBe(0);
    expect(state.barrier).toBe(false);
  });

  it('身代わりで防げる (肩代わり)', () => {
    const attacker = fighter('a', 'kingdom');
    const guardian = fighter('guard', 'kingdom', [SLASH], [COVER]);
    const foe = boss({ attack: 1, bigEvery: 99, downEvery: 1 });
    const state = battleOf([attacker, guardian], [], foe);
    endTurn(state, new Rng(1));
    expect(state.stats.downs).toBe(1);
    expect(guardian.downed).toBe(true);
    expect(attacker.downed).toBe(false);
  });
});

describe('バリア', () => {
  it('次に来る攻撃を 1 回無効化し、ダメージもダウンも防いで消費される', () => {
    const foe = boss({ attack: 50, bigEvery: 99, downEvery: 1 });
    const state = battleOf([fighter('a', 'kingdom', [BARRIER])], [fighter('b', 'kingdom')], foe);
    state.mana = 10;
    useSkill(state, 0, 0, new Rng(1));
    expect(state.barrier).toBe(true);

    endTurn(state, new Rng(1));

    expect(state.hp).toBe(100);
    expect(state.stats.downs).toBe(0);
    expect(state.barrier).toBe(false);
  });

  it('同時に 2 枚は持てない', () => {
    const state = battleOf([fighter('a', 'kingdom', [BARRIER])]);
    state.mana = 10;
    useSkill(state, 0, 0, new Rng(1));
    expect(state.barrier).toBe(true);
    expect(whyCannotUse(state, 0, 0)).toBe('バリアは既にある');

    const manaBefore = state.mana;
    const ok = useSkill(state, 0, 0, new Rng(1));
    expect(ok).toBe(false);
    expect(state.mana).toBe(manaBefore);
  });

  it('ターンをまたいで残る (防御と違ってターン終了では消えない)', () => {
    const foe = enemy({ maxHp: 1 });
    const state = battleOf([fighter('a', 'kingdom', [BARRIER])], [], foe);
    state.mana = 10;
    useSkill(state, 0, 0, new Rng(1));
    expect(state.barrier).toBe(true);

    // 敵を倒れた扱いにして、このターンは敵の行動が起きないようにする
    // (敵の攻撃が来なければバリアは消費されない。それでもターン明けの整理では消えないことを見る)
    state.enemy.hp = 0;
    endTurn(state, new Rng(1));

    expect(state.turn).toBe(2);
    expect(state.barrier).toBe(true);
  });
});

describe('身代わり', () => {
  it('前衛にいると、ダウン攻撃のダウンを肩代わりする', () => {
    const attacker = fighter('a', 'kingdom');
    const guardian = fighter('guard', 'kingdom', [SLASH], [COVER]);
    const foe = boss({ attack: 1, bigEvery: 99, downEvery: 1 });
    const state = battleOf([attacker, guardian], [], foe);

    endTurn(state, new Rng(1));

    expect(state.stats.downs).toBe(1);
    expect(guardian.downed).toBe(true);
    expect(attacker.downed).toBe(false);
  });

  it('自己ダウン代償のスキル (selfDown) は肩代わりしない', () => {
    const attacker = fighter('a', 'kingdom', [SACRIFICE]);
    const guardian = fighter('guard', 'kingdom', [SLASH], [COVER]);
    const state = battleOf([attacker, guardian]);

    useSkill(state, 0, 0, new Rng(1));

    expect(attacker.downed).toBe(true);
    expect(guardian.downed).toBe(false);
  });
});

describe('物理コストの持ち越し (バグ修正)', () => {
  it('戦闘中に勝って turnBump が残っても、次の startBattle で素のコストに戻る', () => {
    const front = fighter('a');
    const party = newParty([front]);
    const state = startBattle(party, 100, 100, enemy({ maxHp: 999 }));
    const rng = new Rng(1);
    useSkill(state, 0, 0, rng); // 物理を 1 発。turnBump が 1 に上がる
    expect(effectiveCost(front.skills[0])).toBe(1);
    // endTurn (ターン明けの整理) を経由せず、プレイヤーの行動中に勝利させる
    state.enemy.hp = 0;
    useSkill(state, 0, 0, rng);
    expect(state.outcome).toBe('victory');
    expect(front.skills[0].turnBump).toBe(1); // 持ち越ったままになっている

    const next = startBattle(party, 100, 100, enemy());
    expect(effectiveCost(front.skills[0])).toBe(0);
    expect(next.party.front[0]?.skills[0].turnBump).toBe(0);
  });

  it('控えのメンバーの turnBump も戦闘開始でリセットされる', () => {
    const reserveMember = fighter('b');
    reserveMember.skills[0].turnBump = 1;
    const party = newParty([fighter('a')], [reserveMember]);
    startBattle(party, 100, 100, enemy());
    expect(reserveMember.skills[0].turnBump).toBe(0);
  });
});

describe('コンボ', () => {
  it('攻撃が命中するたび 1 増え、ターン明けで 0 に戻る', () => {
    const state = battleOf([fighter('a', 'kingdom', [SLASH, { ...SLASH, id: 'slash2' }])], [], enemy({ maxHp: 99999 }));
    expect(state.combo).toBe(0);
    useSkill(state, 0, 0, new Rng(1));
    expect(state.combo).toBe(1);
    useSkill(state, 0, 1, new Rng(1));
    expect(state.combo).toBe(2);
    endTurn(state, new Rng(1));
    expect(state.combo).toBe(0);
  });

  it('同一ターンの 2 発目は 1 発目よりダメージが伸びる (発動時点の combo を使う)', () => {
    const state = battleOf([fighter('a', 'kingdom', [SLASH, { ...SLASH, id: 'slash2' }])], [], enemy({ maxHp: 99999 }));
    useSkill(state, 0, 0, new Rng(5));
    const first = 99999 - state.enemy.hp;
    const hpBeforeSecond = state.enemy.hp;
    // 同じ乱数を与えて被ダメージの下限乱数を揃え、combo による伸びだけを見る
    useSkill(state, 0, 1, new Rng(5));
    const second = hpBeforeSecond - state.enemy.hp;
    expect(second).toBeGreaterThan(first);
  });

  it('回復・支援・バリアは combo を増やさず、途切れさせもしない', () => {
    const state = battleOf([fighter('a', 'kingdom', [SLASH, CHEER])], [], enemy({ maxHp: 99999 }));
    useSkill(state, 0, 0, new Rng(1));
    expect(state.combo).toBe(1);
    useSkill(state, 0, 1, new Rng(1)); // 鼓舞
    expect(state.combo).toBe(1);
    useSkill(state, 0, 0, new Rng(1)); // もう 1 発。途切れずに 2 になる
    expect(state.combo).toBe(2);
  });

  it('敵を倒しきったあとの攻撃 (不発) は combo を増やさない', () => {
    const state = battleOf([fighter('a', 'kingdom', [SLASH])], [], enemy({ maxHp: 1 }));
    useSkill(state, 0, 0, new Rng(1));
    expect(state.outcome).toBe('victory');
    expect(state.combo).toBe(1);
  });
});

describe('回復薬', () => {
  it('最大 HP の半分回復し、マナと combo を動かさない', () => {
    const state = battleOf([fighter('a')]);
    state.hp = 40;
    state.mana = 3;
    state.combo = 2;
    const healed = usePotion(state);
    expect(healed).toBe(50);
    expect(state.hp).toBe(90);
    expect(state.mana).toBe(3);
    expect(state.combo).toBe(2);
  });

  it('最大値で止まる', () => {
    const state = battleOf([fighter('a')]);
    state.hp = 90;
    usePotion(state);
    expect(state.hp).toBe(100);
  });
});

describe('resetSortieProgress', () => {
  it('前衛・控え全員の sortieBump と spent を戻す', () => {
    const f = fighter('a', 'kingdom', [FIRE]);
    const r = fighter('b', 'order', [NUKE]);
    const party = newParty([f], [r]);
    f.skills[0].sortieBump = 3;
    r.skills[0].spent = true;
    resetSortieProgress(party);
    expect(f.skills[0].sortieBump).toBe(0);
    expect(r.skills[0].spent).toBe(false);
  });
});

describe('Party から外れた Fighter の回収 (state.left)', () => {
  it('ダウンで前衛から外れた本人が left に積まれる', () => {
    const state = battleOf([fighter('a', 'kingdom', [SACRIFICE])], [fighter('b', 'kingdom')]);
    const a = state.party.front[0]!;
    useSkill(state, 0, 0, new Rng(1));
    expect(state.left).toHaveLength(1);
    expect(state.left[0]).toBe(a);
  });

  it('手動交代で下がった本人が left に積まれる', () => {
    const state = battleOf([fighter('a')], [fighter('c', 'order')]);
    const a = state.party.front[0]!;
    swapMembers(state, [{ slot: 0, reserveId: 'c' }]);
    expect(state.left).toHaveLength(1);
    expect(state.left[0]).toBe(a);
  });
});

describe('全体攻撃と群れの規模', () => {
  it('groupSize が大きい (群れの規模が大きい) ほど威力が伸びる', () => {
    const solo = enemy({ groupSize: 1, maxHp: 99999 });
    const pack = enemy({ groupSize: 3, maxHp: 99999 });
    const soloState = battleOf([fighter('a', 'kingdom', [STORM])], [], solo);
    const packState = battleOf([fighter('a', 'kingdom', [STORM])], [], pack);

    useSkill(soloState, 0, 0, new Rng(5));
    useSkill(packState, 0, 0, new Rng(5));

    const soloDmg = 99999 - soloState.enemy.hp;
    const packDmg = 99999 - packState.enemy.hp;
    expect(packDmg).toBeGreaterThan(soloDmg);
  });
});

describe('ボスの通常行動 2 回', () => {
  it('大技・ダウン攻撃のターン以外は通常行動を 2 回行う', () => {
    // pattern を attack だけにして、2 回攻撃したぶんだけ被害が乗ることを見る
    const foe = boss({ attack: 100, bigEvery: 99, downEvery: null, pattern: [{ kind: 'attack' }] });
    const single = enemy({ attack: 100, bigEvery: 99, downEvery: null, pattern: [{ kind: 'attack' }], isBoss: false });

    const bossState = battleOf([fighter('a')], [], foe);
    endTurn(bossState, new Rng(1));
    const bossLost = 100 - bossState.hp;

    const trashState = battleOf([fighter('a')], [], single);
    endTurn(trashState, new Rng(1));
    const trashLost = 100 - trashState.hp;

    // 2 回攻撃 (ボス) と 1 回攻撃 (雑魚) の期待値差はおよそ 2 倍。乱数があるので緩めに比較する
    expect(bossLost).toBeGreaterThan(trashLost);
  });
});

describe('逃げる', () => {
  it('宣言すると 1〜3 ターン後に発動する', () => {
    const state = battleOf([fighter('a')], [], enemy({ attack: 0 }));
    const rng = new Rng(4);
    expect(toggleFlee(state, rng)).toBe(true);
    expect(state.fleeIn).not.toBeNull();
    const declared = state.fleeIn!;
    expect(declared).toBeGreaterThanOrEqual(1);
    expect(declared).toBeLessThanOrEqual(3);

    for (let i = 0; i < declared - 1; i++) {
      endTurn(state, rng);
      expect(state.outcome).toBe('ongoing');
    }
    endTurn(state, rng);
    expect(state.outcome).toBe('fled');
  });

  it('トグルでキャンセルできる', () => {
    const state = battleOf([fighter('a')]);
    const rng = new Rng(1);
    toggleFlee(state, rng);
    expect(state.fleeIn).not.toBeNull();
    toggleFlee(state, rng);
    expect(state.fleeIn).toBeNull();
    endTurn(state, rng);
    expect(state.outcome).toBe('ongoing');
  });

  it('発動までの間、敵は普通に行動する', () => {
    const state = battleOf([fighter('a')], [], enemy({ attack: 10, bigEvery: 99 }));
    const rng = new Rng(2);
    toggleFlee(state, rng);
    const hpBefore = state.hp;
    endTurn(state, rng);
    if (state.outcome === 'ongoing') expect(state.hp).toBeLessThan(hpBefore);
  });
});
