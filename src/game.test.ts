import { describe, expect, it } from 'vitest';
import { effectiveAttack, type CharacterEntry } from './data/characters';
import { generateCommon, NAME_POOLS } from './data/common-gen';
import { BOSS_ALT_EVENT, EVENTS } from './data/events';
import { FACTION_HIRE_CAP, FACTIONS } from './data/factions';
import { priceOf } from './data/pricing';
import { newGame, step, toViewModel, type Action, type GameState } from './game';
import { Rng } from './rng';
import { factionMultiplierOf, factionTotals } from './roster';

function fresh(): GameState {
  return newGame('TESTAA');
}

/** 決着がつくまで町・ダンジョン・戦闘を貪欲な方針でまとめて進める。無限に回らないよう上限を切る */
function playOut(state: GameState, limit = 400): void {
  for (let i = 0; i < limit && !state.result; i++) {
    const vm = toViewModel(state);
    if (vm.screen.kind === 'battle') {
      step(state, battlePolicy(state));
    } else if (vm.screen.kind === 'dungeon') {
      step(state, vm.screen.event ? { type: 'resolve' } : { type: 'advance' });
    } else {
      break;
    }
  }
}

/** 貪欲な戦闘方針。使える札の先頭を使い、無ければターンを終える */
function battlePolicy(state: GameState): Action {
  const vm = toViewModel(state);
  if (vm.screen.kind !== 'battle') throw new Error('戦闘画面ではない');
  for (let slot = 0; slot < vm.screen.slots.length; slot++) {
    const card = vm.screen.slots[slot];
    if (!card) continue;
    for (let skill = 0; skill < card.skills.length; skill++) {
      if (card.skills[skill].usable) return { type: 'battle-skill', slot, skill };
    }
  }
  return { type: 'battle-end-turn' };
}

/** 出撃直後の run に、次の resolve で開始する戦闘イベントを強制的に据える */
function forceBattleEvent(state: GameState, kind: 'battle' | 'elite' = 'battle'): void {
  const def = EVENTS.find((e) => e.kind === kind)!;
  if (state.run) state.run.pending = def;
}

describe('拠点', () => {
  it('最初は区画 1 だけが解放されている', () => {
    const vm = toViewModel(fresh());
    expect(vm.screen.kind).toBe('town');
    if (vm.screen.kind !== 'town') return;
    expect(vm.screen.sectors.map((s) => s.unlocked)).toEqual([true, false, false]);
  });

  it('未解放の区画へは出撃できない', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 3 });
    expect(state.run).toBeNull();
  });
});

describe('出撃', () => {
  it('出撃するとダンジョンの画面になる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    expect(toViewModel(state).screen.kind).toBe('dungeon');
  });

  it('イベントを抱えている間は進めない', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    step(state, { type: 'advance' });
    const depth = state.run?.depth;
    step(state, { type: 'advance' });
    expect(state.run?.depth).toBe(depth);
  });

  it('引き返すと稼ぎを持ち帰れる', () => {
    const state = fresh();
    const goldBefore = state.gold;
    step(state, { type: 'sortie', sectorId: 1 });
    step(state, { type: 'advance' });
    // 戦闘中は引き返せない仕様なので、即時解決するイベントで確かめる
    if (state.run) state.run.pending = EVENTS.find((e) => e.kind === 'treasure')!;
    step(state, { type: 'resolve' });
    const carried = state.run?.gold ?? 0;
    step(state, { type: 'retreat' });
    expect(state.gold).toBe(goldBefore + carried);
    expect(state.result?.won).toBe(true);
  });

  it('全滅するとその出撃の稼ぎを失う', () => {
    const state = fresh();
    const goldBefore = state.gold;
    step(state, { type: 'sortie', sectorId: 1 });
    // 戦闘に入り、確実に全滅させる (敵の行動は「何もしない」を引くこともあるので、
    // HP を低くして自然な被弾待ちにするのではなく battle.hp を直接 0 にして決め打ちする)
    forceBattleEvent(state, 'battle');
    step(state, { type: 'resolve' });
    expect(state.battle).not.toBeNull();
    state.battle!.hp = 0;
    step(state, { type: 'battle-end-turn' });
    expect(state.result?.won).toBe(false);
    expect(state.gold).toBe(goldBefore);
    expect(state.result?.gold).toBe(0);
  });
});

describe('初期の 3 人', () => {
  it('主人公・相棒・カクサンが必ず前衛にいる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const front = state.run!.party.front;
    expect(front.some((f) => f?.id === 'hero')).toBe(true);
    expect(front.some((f) => f?.id === 'mate')).toBe(true);
    expect(front.some((f) => f?.id === 'aide2')).toBe(true);
  });

  it('固定 3 人の名前がコーモン・スケサン・カクサンで、カクサンはバフ剥がしとガード 1 を持つ', () => {
    const state = fresh();
    const hero = state.owned.find((c) => c.id === 'hero')!;
    const mate = state.owned.find((c) => c.id === 'mate')!;
    const aide2 = state.owned.find((c) => c.id === 'aide2')!;
    expect(hero.name).toBe('コーモン');
    expect(mate.name).toBe('スケサン');
    expect(aide2.name).toBe('カクサン');
    expect(aide2.rarity).toBe('named');
    const skillKinds = aide2.skills.map((s) => s.effect.kind).sort();
    expect(skillKinds).toEqual(['dispel', 'ward'].sort());
  });

  it('カクサンは雇用上限に数えない (傭兵団の上限に達していても酒場に居座れる)', () => {
    const state = fresh();
    expect(state.owned.some((c) => c.id === 'aide2')).toBe(true);
    // aide2 自身は factionCount の対象外なので、傭兵団の残り枠は上限そのままになる
    const vm = toViewModel(state);
    if (vm.screen.kind !== 'town') throw new Error('拠点ではない');
    // 上限に達していなければ酒場・formation どちらの陣営倍率一覧にも普通に出る
    expect(vm.screen.formation.factionMultipliers.some((f) => f.faction === 'mercs')).toBe(true);
  });
});

describe('区画の解放', () => {
  it('ボスを倒すと次の区画が開く', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    // ボスまで無傷で到達させる
    for (let i = 0; i < 20 && !state.run?.atBoss; i++) {
      step(state, { type: 'advance' });
      if (state.run) {
        state.run.pending = null;
        state.run.hp = state.run.maxHp;
      }
    }
    expect(state.run?.atBoss).toBe(true);
    step(state, { type: 'resolve' });
    expect(state.battle).not.toBeNull();
    expect(state.battleKind).toBe('boss');

    // 敵を倒し、決着判定 (checkVictory) を挟む行動を 1 回叩いて勝ちにする
    state.battle!.enemy.hp = 0;
    step(state, { type: 'battle-skill', slot: 0, skill: 0 });

    expect(state.battle).toBeNull();
    expect(state.unlocked).toBe(2);
    expect(state.result?.won).toBe(true);
  });
});

describe('結果の画面', () => {
  it('閉じると拠点に戻る', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    step(state, { type: 'retreat' });
    expect(toViewModel(state).screen.kind).toBe('result');
    step(state, { type: 'dismiss' });
    expect(toViewModel(state).screen.kind).toBe('town');
  });
});

describe('戦闘への遷移', () => {
  it('戦闘イベントを resolve すると戦闘画面になる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    forceBattleEvent(state, 'battle');
    step(state, { type: 'resolve' });
    expect(toViewModel(state).screen.kind).toBe('battle');
    expect(state.battle).not.toBeNull();
    expect(state.battleKind).toBe('battle');
  });

  it('戦闘に勝つとダンジョン画面に戻り、パーティ HP が引き継がれる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const maxHp = state.run!.maxHp;
    forceBattleEvent(state, 'battle');
    step(state, { type: 'resolve' });
    const goldBefore = state.run!.gold;

    state.battle!.enemy.hp = 0;
    step(state, { type: 'battle-skill', slot: 0, skill: 0 });

    expect(state.battle).toBeNull();
    expect(toViewModel(state).screen.kind).toBe('dungeon');
    expect(state.run?.hp).toBe(maxHp);
    expect(state.run!.gold).toBeGreaterThan(goldBefore);
  });

  it('戦闘に負けると出撃が終わり、稼ぎを失う', () => {
    const state = fresh();
    const goldBefore = state.gold;
    step(state, { type: 'sortie', sectorId: 1 });
    if (state.run) state.run.gold = 50;
    forceBattleEvent(state, 'battle');
    step(state, { type: 'resolve' });
    expect(state.battle).not.toBeNull();

    state.battle!.hp = 0;
    step(state, { type: 'battle-end-turn' });

    expect(state.battle).toBeNull();
    expect(state.run).toBeNull();
    expect(state.result?.won).toBe(false);
    expect(state.result?.gold).toBe(0);
    expect(state.gold).toBe(goldBefore);
  });

  it('前衛が絶えると (annihilated) 出撃が終わる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    forceBattleEvent(state, 'battle');
    step(state, { type: 'resolve' });
    const b = state.battle!;

    // 代償スキルで自滅させる。控えを空にしておけば自動補充が起きず前衛が絶える
    const survivor = b.party.front[0]!;
    survivor.skills.push({
      def: {
        id: 'test-sacrifice',
        name: 'テスト代償',
        shortName: '代償',
        category: 'ultimate',
        baseCost: 0,
        effect: { kind: 'attack', target: 'one', power: 1 },
        selfDown: true,
      },
      turnBump: 0,
      sortieBump: 0,
      spent: false,
    });
    b.party.front = [survivor, null, null, null, null, null];
    b.party.reserve = [];

    step(state, { type: 'battle-skill', slot: 0, skill: survivor.skills.length - 1 });

    expect(state.battle).toBeNull();
    expect(state.run).toBeNull();
    expect(state.result?.won).toBe(false);
  });
});

describe('ViewModel 経由の検証', () => {
  it('slots にスキルの使用可否と whyCannotUse の理由が届く', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    forceBattleEvent(state, 'battle');
    step(state, { type: 'resolve' });

    const vm = toViewModel(state);
    expect(vm.screen.kind).toBe('battle');
    if (vm.screen.kind !== 'battle') return;
    const card = vm.screen.slots[0];
    expect(card).not.toBeNull();
    expect(card!.skills.length).toBeGreaterThan(0);

    // マナを切らして、コストのあるスキルが使用不可になり理由が届くことを確かめる
    state.battle!.mana = 0;
    const vm2 = toViewModel(state);
    if (vm2.screen.kind !== 'battle') return;
    const costly = vm2.screen.slots[0]!.skills.find((sk) => sk.cost > 0);
    expect(costly?.usable).toBe(false);
    expect(costly?.reason).toBe('マナが足りない');
  });
});

describe('大技 1 ターン前のアナウンス', () => {
  it('countdown が 1 になったターンの終わりに警告ログが出る', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    forceBattleEvent(state, 'battle');
    step(state, { type: 'resolve' });
    const b = state.battle!;
    b.enemy.bigCountdown = 2;

    step(state, { type: 'battle-end-turn' });

    expect(state.battle?.outcome).toBe('ongoing');
    expect(state.battle?.enemy.bigCountdown).toBe(1);
    const vm = toViewModel(state);
    expect(vm.log.some((l) => l.kind === 'warn' && l.text.includes('力を溜めている'))).toBe(true);
  });

  it('countdown が 1 以外のターンでは警告ログを出さない', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    forceBattleEvent(state, 'battle');
    step(state, { type: 'resolve' });
    const b = state.battle!;
    b.enemy.bigCountdown = 5;

    step(state, { type: 'battle-end-turn' });

    expect(state.battle?.enemy.bigCountdown).toBe(4);
    const vm = toViewModel(state);
    expect(vm.log.some((l) => l.text.includes('力を溜めている'))).toBe(false);
  });
});

describe('初期状態', () => {
  it('owned は主人公と相棒だけ、所持金は 300、酒場には 3 人が並ぶ、回復薬は 1 個持っている', () => {
    const state = fresh();
    expect(state.owned.map((c) => c.id)).toEqual(['hero', 'mate', 'aide2']);
    expect(state.gold).toBe(300);
    expect(state.potions).toBe(1);
    expect(state.tavern).toHaveLength(3);
    for (const c of state.tavern) {
      expect(state.owned.some((o) => o.id === c.id)).toBe(false);
    }
  });
});

describe('酒場', () => {
  it('雇うと owned に加わり、金が減り、酒場から外れる (雇った個体そのものが owned に残る)', () => {
    const state = fresh();
    // レアが混ざっていても (400 G) 必ず雇えるだけの所持金にしておく
    state.gold = 1000;
    const entry = state.tavern[0];
    const goldBefore = state.gold;
    step(state, { type: 'hire', id: entry.id });
    const owned = state.owned.find((o) => o.id === entry.id);
    expect(owned).toBeDefined();
    expect(state.gold).toBe(goldBefore - priceOf(entry));
    expect(state.tavern.some((t) => t.id === entry.id)).toBe(false);
    // 生成コモンでも、雇った後は酒場に並んでいたときと同じスキル構成のまま残る
    expect(owned?.skills.map((s) => s.name)).toEqual(entry.skills.map((s) => s.name));
  });

  it('金が足りなければ雇えない', () => {
    const state = fresh();
    state.gold = 0;
    const id = state.tavern[0].id;
    step(state, { type: 'hire', id });
    expect(state.owned.some((o) => o.id === id)).toBe(false);
    expect(state.gold).toBe(0);
  });

  it('酒場にいない id は雇えない', () => {
    const state = fresh();
    const ownedBefore = [...state.owned];
    step(state, { type: 'hire', id: 'not-in-tavern' });
    expect(state.owned).toEqual(ownedBefore);
  });

  it('出撃を終えるたびに酒場が引き直される', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    step(state, { type: 'retreat' });
    expect(state.tavern).toHaveLength(3);
    for (const c of state.tavern) {
      expect(state.owned.some((o) => o.id === c.id)).toBe(false);
    }
  });

  it('酒場にレアが混ざりうること (その場で generateRare により生成される)', () => {
    // 低確率 (15%) の当たりなので、seed を変えて何度も引き直して確かめる
    let sawRare = false;
    for (let seed = 0; seed < 200; seed++) {
      const state = newGame(`SEED${seed}`);
      for (const c of state.tavern) {
        if (c.rarity !== 'rare') continue;
        sawRare = true;
      }
    }
    expect(sawRare).toBe(true);
  });

  it('1 回の品揃えの中で名前が重複しない', () => {
    for (let seed = 0; seed < 200; seed++) {
      const state = newGame(`NAME${seed}`);
      const names = state.tavern.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('陣営が 4 つあり品揃えは 3 人なので、可能な範囲で陣営が散らばる (3 枠すべて同じ陣営にならない)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const state = newGame(`FACTION${seed}`);
      const factions = new Set(state.tavern.map((c) => c.faction));
      expect(factions.size).toBeGreaterThan(1);
    }
  });
});

describe('酒場: 雇用上限', () => {
  it('陣営が雇用上限に達すると、以後は酒場に並ばなくなる (統計テスト)', () => {
    const state = fresh();
    // 辺境の上限は 3 (hero は上限に数えない)。上限ぴったりまで積む
    const rng = new Rng(1);
    state.owned.push(...[1, 2, 3].map((i) => generateCommon('frontier', rng, 100 + i)));
    for (let i = 0; i < 100; i++) {
      step(state, { type: 'sortie', sectorId: 1 });
      step(state, { type: 'retreat' });
      expect(state.tavern.some((c) => c.faction === 'frontier')).toBe(false);
    }
  });
});

describe('酒場: 所持済みの名前の重複 (不具合の修正)', () => {
  it('所持済みキャラと同じ名前は酒場に並ばない (統計テスト)', () => {
    const state = fresh();
    state.gold = 1_000_000;
    // 引き直すたびに 1 人雇って owned を増やしながら、そのたびに酒場と所持で名前が
    // 重複していないことを確かめる
    for (let i = 0; i < 30; i++) {
      step(state, { type: 'reroll-tavern' });
      const ownedNames = new Set(state.owned.map((o) => o.name));
      for (const t of state.tavern) expect(ownedNames.has(t.name)).toBe(false);
      if (state.tavern.length > 0) step(state, { type: 'hire', id: state.tavern[0].id });
    }
  });

  it('名前の候補が尽きた陣営は、雇用上限に達していなくても酒場の抽選から外れる (統計テスト)', () => {
    const state = fresh();
    state.gold = 1_000_000;
    // 辺境 (NAME_POOLS.frontier) の名前を、所持済み名として全部埋めてしまう。
    // hasFreeName は名前だけを見て陣営そのものは見ないので、owned に積む個体の faction は
    // 何でもよい (ここでは frontier の雇用上限を巻き込まないよう、あえて別陣営にしておく)
    let serial = 0;
    const dummies: CharacterEntry[] = NAME_POOLS.frontier.map((name) => ({
      id: `dummy-${serial++}`,
      name,
      faction: 'kingdom',
      rarity: 'common',
      baseAttack: 1,
      baseVitality: 1,
      skills: [],
      passives: [],
      level: 1,
      exp: 0,
      maxLevel: 1,
      growth: 0,
      curve: 'linear',
    }));
    state.owned.push(...dummies);

    for (let i = 0; i < 50; i++) {
      step(state, { type: 'reroll-tavern' });
      expect(state.tavern.some((c) => c.faction === 'frontier')).toBe(false);
    }
  });

  it('全陣営が上限に達すれば、酒場が空になり引き直せなくなる (レアも同じ陣営枠から生成するため)', () => {
    const state = fresh();
    state.gold = 1_000_000;
    const rng = new Rng(2);
    let serial = 500;
    for (const faction of FACTIONS) {
      for (let i = 0; i < FACTION_HIRE_CAP[faction]; i++) {
        state.owned.push(generateCommon(faction, rng, serial++));
      }
    }

    step(state, { type: 'reroll-tavern' });

    expect(state.tavern).toHaveLength(0);
    const vm = toViewModel(state);
    if (vm.screen.kind !== 'town') throw new Error('拠点ではない');
    expect(vm.screen.rerollAffordable).toBe(false);
  });
});

describe('酒場の引き直し', () => {
  it('引き直すと金が減り、賃料が上がる', () => {
    const state = fresh();
    state.gold = 100000;
    const costBefore = state.tavernRerollCost;
    step(state, { type: 'reroll-tavern' });
    expect(state.gold).toBe(100000 - costBefore);
    expect(state.tavernRerollCost).toBeGreaterThan(costBefore);
  });

  it('金が足りなければ引き直せない', () => {
    const state = fresh();
    state.gold = 0;
    const before = [...state.tavern];
    const costBefore = state.tavernRerollCost;
    step(state, { type: 'reroll-tavern' });
    expect(state.gold).toBe(0);
    expect(state.tavernRerollCost).toBe(costBefore);
    expect(state.tavern).toEqual(before);
  });

  it('出撃を終えると賃料が初期値に戻る', () => {
    const state = fresh();
    state.gold = 100000;
    const initial = state.tavernRerollCost;
    step(state, { type: 'reroll-tavern' });
    expect(state.tavernRerollCost).toBeGreaterThan(initial);
    step(state, { type: 'sortie', sectorId: 1 });
    step(state, { type: 'retreat' });
    expect(state.tavernRerollCost).toBe(initial);
  });
});

describe('道具屋', () => {
  it('買うと回復薬が 1 増え、金が減る', () => {
    const state = fresh();
    state.gold = 100000;
    const potionsBefore = state.potions;
    const priceBefore = state.potionPrice;
    step(state, { type: 'buy-potion' });
    expect(state.potions).toBe(potionsBefore + 1);
    expect(state.gold).toBe(100000 - priceBefore);
  });

  it('買うたびに値段が上がる', () => {
    const state = fresh();
    state.gold = 100000;
    const priceBefore = state.potionPrice;
    step(state, { type: 'buy-potion' });
    expect(state.potionPrice).toBeGreaterThan(priceBefore);
  });

  it('金が足りなければ買えない', () => {
    const state = fresh();
    state.gold = 0;
    const potionsBefore = state.potions;
    const priceBefore = state.potionPrice;
    step(state, { type: 'buy-potion' });
    expect(state.potions).toBe(potionsBefore);
    expect(state.gold).toBe(0);
    expect(state.potionPrice).toBe(priceBefore);
  });

  it('所持上限 (3 個) に達すると買えなくなる', () => {
    const state = fresh();
    state.gold = 1000000;
    state.potions = 3;
    const priceBefore = state.potionPrice;
    step(state, { type: 'buy-potion' });
    expect(state.potions).toBe(3);
    expect(state.potionPrice).toBe(priceBefore);
  });

  it('出撃を終えると値段が初期値に戻る', () => {
    const state = fresh();
    state.gold = 100000;
    const initial = state.potionPrice;
    step(state, { type: 'buy-potion' });
    expect(state.potionPrice).toBeGreaterThan(initial);
    step(state, { type: 'sortie', sectorId: 1 });
    step(state, { type: 'retreat' });
    expect(state.potionPrice).toBe(initial);
  });
});

describe('出撃時のパーティ編成', () => {
  it('owned 全員でパーティを組む (owned が 3 人なら 3 人で潜る)', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    expect(state.run?.party.front.filter(Boolean)).toHaveLength(3);
  });

  it('雇ったキャラも次の出撃からパーティに入る', () => {
    const state = fresh();
    // レアが混ざっていても (400 G) 必ず雇えるだけの所持金にしておく
    state.gold = 1000;
    const id = state.tavern[0].id;
    step(state, { type: 'hire', id });
    step(state, { type: 'sortie', sectorId: 1 });
    const front = state.run!.party.front;
    expect(front.some((f) => f?.id === id)).toBe(true);
  });
});

describe('セーブ・ロードを跨いだ生成コモンの同一性', () => {
  it('雇った生成コモンは JSON の保存・復元を跨いでも同じスキル・数値を持つ', () => {
    const state = fresh();
    // レアが混ざっていても (400 G) 必ず雇えるだけの所持金にしておく
    state.gold = 1000;
    const entry = state.tavern[0];
    step(state, { type: 'hire', id: entry.id });

    // save.ts は JSON.stringify/parse を通すだけなので、ここでも同じ経路で確かめる
    const restored: GameState = JSON.parse(JSON.stringify(state));
    const owned = restored.owned.find((o) => o.id === entry.id);
    expect(owned).toBeDefined();
    expect(owned?.name).toBe(entry.name);
    expect(owned?.faction).toBe(entry.faction);
    expect(owned?.baseAttack).toBe(entry.baseAttack);
    expect(owned?.baseVitality).toBe(entry.baseVitality);
    expect(owned?.skills.map((s) => s.name)).toEqual(entry.skills.map((s) => s.name));
    expect(owned?.passives.map((p) => p.name)).toEqual(entry.passives.map((p) => p.name));
  });
});

describe('拠点の一覧', () => {
  it('迷宮 (区画) と酒場が ViewModel に並んで届く', () => {
    const state = fresh();
    const vm = toViewModel(state);
    expect(vm.screen.kind).toBe('town');
    if (vm.screen.kind !== 'town') return;
    expect(vm.screen.sectors).toHaveLength(3);
    expect(vm.screen.sectors[0].unlocked).toBe(true);
    expect(Array.isArray(vm.screen.tavern)).toBe(true);
  });
});

describe('編成: 空にする / 全て外す', () => {
  /** 自動詰めが前衛 6 枠を丸ごと埋めるだけの人数を owned に用意する (生成コモンを 4 人足す) */
  function sixPersonRoster(state: GameState): void {
    const rng = new Rng(1);
    const generated = [1, 2, 3, 4].map((i) => generateCommon('kingdom', rng, i));
    state.owned = [...state.owned, ...generated];
  }

  it('未編集のまま 1 枠だけ空にしても、他の枠の自動詰めは残る (以前は全枠が空になる不具合があった)', () => {
    const state = fresh();
    sixPersonRoster(state);

    const before = toViewModel(state);
    if (before.screen.kind !== 'town') throw new Error('拠点画面ではない');
    expect(before.screen.formation.auto).toBe(true);
    const beforeIds = before.screen.formation.slots.map((s) => s.character?.id ?? null);
    expect(beforeIds.filter((id) => id !== null)).toHaveLength(6);

    step(state, { type: 'formation-set', slot: 0, id: null });

    const after = toViewModel(state);
    if (after.screen.kind !== 'town') throw new Error('拠点画面ではない');
    expect(after.screen.formation.auto).toBe(false);
    const afterIds = after.screen.formation.slots.map((s) => s.character?.id ?? null);
    expect(afterIds[0]).toBeNull();
    // 触っていない残り 5 枠は、自動詰めが見せていたキャラのまま変わらないこと
    expect(afterIds.slice(1)).toEqual(beforeIds.slice(1));
    expect(afterIds.slice(1).every((id) => id !== null)).toBe(true);
  });

  it('「全て外す」は前衛 6 枠を実際に空にし、自動詰めへは戻らない (出撃時も空のまま)', () => {
    const state = fresh();
    sixPersonRoster(state);

    step(state, { type: 'formation-clear-all' });

    const vm = toViewModel(state);
    if (vm.screen.kind !== 'town') throw new Error('拠点画面ではない');
    expect(vm.screen.formation.auto).toBe(false);
    expect(vm.screen.formation.slots.every((s) => s.character === null)).toBe(true);

    step(state, { type: 'sortie', sectorId: 1 });
    expect(state.run?.party.front.every((f) => f === null)).toBe(true);
    expect(state.run?.party.reserve).toHaveLength(state.owned.length);
  });
});

describe('回復薬', () => {
  it('ダンジョン画面で使うと run.hp が最大値の半分回復し、1 個減る', () => {
    const state = fresh();
    state.potions = 2;
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.hp = 1;
    step(state, { type: 'potion' });
    expect(run.hp).toBe(1 + Math.round(run.maxHp / 2));
    expect(state.potions).toBe(1);
  });

  it('戦闘画面で使うとマナと combo を動かさず battle.hp が回復する', () => {
    const state = fresh();
    state.potions = 1;
    step(state, { type: 'sortie', sectorId: 1 });
    forceBattleEvent(state, 'battle');
    step(state, { type: 'resolve' });
    const b = state.battle!;
    b.hp = 1;
    const manaBefore = b.mana;
    const comboBefore = b.combo;
    step(state, { type: 'potion' });
    expect(b.hp).toBe(1 + Math.round(b.maxHp / 2));
    expect(b.mana).toBe(manaBefore);
    expect(b.combo).toBe(comboBefore);
    expect(state.potions).toBe(0);
  });

  it('0 個のときは何も起きない', () => {
    const state = fresh();
    state.potions = 0;
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.hp = 1;
    step(state, { type: 'potion' });
    expect(run.hp).toBe(1);
  });

  it('全滅すると回復薬を没収される', () => {
    const state = fresh();
    state.potions = 3;
    step(state, { type: 'sortie', sectorId: 1 });
    forceBattleEvent(state, 'battle');
    step(state, { type: 'resolve' });
    state.battle!.hp = 0;
    step(state, { type: 'battle-end-turn' });
    expect(state.result?.won).toBe(false);
    expect(state.potions).toBe(0);
  });
});

describe('泉イベント', () => {
  it('HP を半分回復し、sortieBump をリセットし、ダウンした roster を復帰させる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.hp = 1;
    const downedFighter = run.party.front[0]!;
    downedFighter.skills[0].sortieBump = 3;
    run.party.front[0] = null;
    run.downed.push(downedFighter);

    run.pending = EVENTS.find((e) => e.kind === 'spring')!;
    step(state, { type: 'resolve' });

    expect(run.hp).toBe(1 + Math.round(run.maxHp / 2));
    expect(run.downed).toHaveLength(0);
    expect(downedFighter.downed).toBe(false);
    expect(downedFighter.skills[0].sortieBump).toBe(0);
    expect(run.party.front.some((f) => f === downedFighter)).toBe(true);
  });
});

describe('宝箱・「何も無い」に隠れた罠', () => {
  it('宝箱を開けると金が入るか、まれに中身が罠になる (統計テスト)', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    let trapCount = 0;
    let goldCount = 0;
    for (let i = 0; i < 300; i++) {
      run.hp = run.maxHp; // 罠で全滅させないため、毎回全回復させておく
      run.gold = 0;
      run.pending = EVENTS.find((e) => e.kind === 'treasure')!;
      step(state, { type: 'resolve' });
      if (run.gold > 0) goldCount += 1;
      else trapCount += 1;
    }
    expect(goldCount).toBeGreaterThan(0);
    expect(trapCount).toBeGreaterThan(0);
    // 初期値は 30%。統計テストなので幅を持たせる
    const rate = trapCount / 300;
    expect(rate).toBeGreaterThan(0.15);
    expect(rate).toBeLessThan(0.45);
  });

  it('宝箱から回復薬が出る確率はおよそ 10% (統計テスト)', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    const trials = 2000;
    let potionCount = 0;
    for (let i = 0; i < trials; i++) {
      run.hp = run.maxHp; // 罠で全滅させないため、毎回全回復させておく
      state.potions = 0; // 上限で頭打ちにならないよう、毎回空にしておく
      run.pending = EVENTS.find((e) => e.kind === 'treasure')!;
      step(state, { type: 'resolve' });
      if (state.potions > 0) potionCount += 1;
    }
    // 指示値は 10%。統計テストなので幅を持たせる
    const rate = potionCount / trials;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.15);
  });

  it('宝箱を「見送る」と金も罠も無い', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    const hpBefore = run.hp;
    const goldBefore = run.gold;
    run.pending = { ...EVENTS.find((e) => e.kind === 'treasure')!, altAction: '見送る' };
    step(state, { type: 'resolve-alt' });
    expect(run.hp).toBe(hpBefore);
    expect(run.gold).toBe(goldBefore);
    expect(run.pending).toBeNull();
  });

  it('「何も無い」は何も起きないか、まれに罠が仕掛けてある (統計テスト)', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    let trapCount = 0;
    for (let i = 0; i < 300; i++) {
      run.hp = run.maxHp;
      run.pending = EVENTS.find((e) => e.kind === 'nothing')!;
      step(state, { type: 'resolve' });
      if (run.hp < run.maxHp) trapCount += 1;
    }
    // 初期値は 25%。統計テストなので幅を持たせる
    const rate = trapCount / 300;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.4);
  });
});

describe('隊商イベント', () => {
  it('所持金が足りれば回復薬を 1 個買える', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    state.gold = 1000;
    state.potions = 0;
    const goldBefore = state.gold;
    run.pending = EVENTS.find((e) => e.kind === 'caravan')!;
    step(state, { type: 'resolve' });
    expect(state.potions).toBe(1);
    expect(state.gold).toBeLessThan(goldBefore);
    expect(run.pending).toBeNull();
  });

  it('所持金が足りなければ何も起きない', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    state.gold = 0;
    state.potions = 0;
    run.pending = EVENTS.find((e) => e.kind === 'caravan')!;
    step(state, { type: 'resolve' });
    expect(state.potions).toBe(0);
    expect(state.gold).toBe(0);
  });

  it('回復薬が満杯なら所持金があっても買わない', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    state.gold = 1000;
    state.potions = 3;
    const goldBefore = state.gold;
    run.pending = EVENTS.find((e) => e.kind === 'caravan')!;
    step(state, { type: 'resolve' });
    expect(state.potions).toBe(3);
    expect(state.gold).toBe(goldBefore);
  });

  it('常に二択 (alwaysAlt) で、「買う」「襲う」が揃っている', () => {
    const caravan = EVENTS.find((e) => e.kind === 'caravan')!;
    expect(caravan.alwaysAlt).toBe(true);
    expect(caravan.action).toBe('買う');
    expect(caravan.altAction).toBe('襲う');
  });

  it('「襲う」を選ぶと通常の雑魚戦と同じ仕組みで戦闘に入る', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.pending = EVENTS.find((e) => e.kind === 'caravan')!;
    step(state, { type: 'resolve-alt' });
    expect(state.battle).not.toBeNull();
    expect(state.battleKind).toBe('caravan');
    expect(run.pending).toBeNull();
  });

  it('襲って勝つと、通常戦の報酬に加えて回復薬が 1 個増える', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    state.potions = 0;
    run.pending = EVENTS.find((e) => e.kind === 'caravan')!;
    step(state, { type: 'resolve-alt' });
    const goldBefore = run.gold;

    state.battle!.enemy.hp = 0;
    step(state, { type: 'battle-skill', slot: 0, skill: 0 });

    expect(state.battle).toBeNull();
    expect(state.potions).toBe(1);
    expect(run.gold).toBeGreaterThan(goldBefore);
  });

  it('襲って負けると、通常の戦闘敗北と同じく出撃が終わり回復薬は増えない', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    state.potions = 0;
    run.pending = EVENTS.find((e) => e.kind === 'caravan')!;
    step(state, { type: 'resolve-alt' });

    state.battle!.hp = 0;
    step(state, { type: 'battle-end-turn' });

    expect(state.result?.won).toBe(false);
    expect(state.potions).toBe(0);
  });
});

describe('祠イベント (常に二択)', () => {
  it('「祈る」で経験値が入る', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    const member = [...run.party.front, ...run.party.reserve].find((f) => f !== null)!;
    const entry = state.owned.find((c) => c.id === member.id)!;
    const expBefore = entry.exp;
    run.pending = EVENTS.find((e) => e.kind === 'shrine')!;
    step(state, { type: 'resolve' });
    expect(entry.exp).toBeGreaterThan(expBefore);
    expect(run.pending).toBeNull();
  });

  it('「壊す」で金が入る', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    const goldBefore = run.gold;
    run.pending = EVENTS.find((e) => e.kind === 'shrine')!;
    step(state, { type: 'resolve-alt' });
    expect(run.gold).toBeGreaterThan(goldBefore);
    expect(run.pending).toBeNull();
  });
});

describe('落石イベント (常に二択)', () => {
  it('「押し通る」で HP を失う', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.hp = run.maxHp;
    run.pending = EVENTS.find((e) => e.kind === 'rockfall')!;
    step(state, { type: 'resolve' });
    expect(run.hp).toBeLessThan(run.maxHp);
    expect(run.pending).toBeNull();
  });

  it('「迂回する」は何も失わない', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    const hpBefore = run.hp;
    const goldBefore = run.gold;
    run.pending = EVENTS.find((e) => e.kind === 'rockfall')!;
    step(state, { type: 'resolve-alt' });
    expect(run.hp).toBe(hpBefore);
    expect(run.gold).toBe(goldBefore);
    expect(run.pending).toBeNull();
  });
});

describe('休息イベント (常に二択)', () => {
  it('「休む」で HP が回復する', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.hp = 1;
    run.pending = EVENTS.find((e) => e.kind === 'rest')!;
    step(state, { type: 'resolve' });
    expect(run.hp).toBeGreaterThan(1);
    expect(run.pending).toBeNull();
  });

  it('「先を急ぐ」は回復せず経験値が入る', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.hp = 1;
    const member = [...run.party.front, ...run.party.reserve].find((f) => f !== null)!;
    const entry = state.owned.find((c) => c.id === member.id)!;
    const expBefore = entry.exp;
    run.pending = EVENTS.find((e) => e.kind === 'rest')!;
    step(state, { type: 'resolve-alt' });
    expect(run.hp).toBe(1);
    expect(entry.exp).toBeGreaterThan(expBefore);
    expect(run.pending).toBeNull();
  });
});

describe('死体イベントに隠れた罠', () => {
  it('漁ると金が入るか、まれに中身が罠になる (統計テスト)', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    let trapCount = 0;
    let goldCount = 0;
    for (let i = 0; i < 300; i++) {
      run.hp = run.maxHp; // 罠で全滅させないため、毎回全回復させておく
      run.gold = 0;
      run.pending = EVENTS.find((e) => e.kind === 'corpse')!;
      step(state, { type: 'resolve' });
      if (run.gold > 0) goldCount += 1;
      else trapCount += 1;
    }
    expect(goldCount).toBeGreaterThan(0);
    expect(trapCount).toBeGreaterThan(0);
    // 初期値は 25%。統計テストなので幅を持たせる
    const rate = trapCount / 300;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.4);
  });
});

describe('ダンジョン内の加入イベント', () => {
  it('コモンが 1 人その場で生成され、owned とデッキに加わる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    const ownedBefore = state.owned.length;
    run.pending = EVENTS.find((e) => e.kind === 'recruit')!;
    step(state, { type: 'resolve' });
    expect(state.owned.length).toBe(ownedBefore + 1);
    const newEntry = state.owned[state.owned.length - 1];
    expect(newEntry.rarity).toBe('common');
    expect([...run.party.front, ...run.party.reserve].some((f) => f?.id === newEntry.id)).toBe(true);
  });

  it('コモンは固定名簿を持たないので、大量に所持していても加入イベントは常に新しい個体を生成する (金には化けない)', () => {
    const state = fresh();
    const rng = new Rng(1);
    state.owned.push(...[1, 2, 3, 4, 5].map((i) => generateCommon('order', rng, i)));
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    const ownedBefore = state.owned.length;
    const goldBefore = run.gold;
    run.pending = EVENTS.find((e) => e.kind === 'recruit')!;
    step(state, { type: 'resolve' });
    expect(state.owned.length).toBe(ownedBefore + 1);
    expect(run.gold).toBe(goldBefore);
  });
});

describe('ボス前の分岐イベント', () => {
  it('「回復する」で HP が全回復し、ダウンが復帰する', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.hp = 1;
    const downedFighter = run.party.front[0]!;
    run.party.front[0] = null;
    run.downed.push(downedFighter);
    run.pending = BOSS_ALT_EVENT;

    step(state, { type: 'resolve' });

    expect(run.hp).toBe(run.maxHp);
    expect(run.downed).toHaveLength(0);
    expect(run.pending).toBeNull();
  });

  it('「レアを迎える」で generateRare が 1 人その場で生成され、owned とデッキに加わる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.pending = BOSS_ALT_EVENT;
    const ownedBefore = state.owned.length;

    step(state, { type: 'resolve-alt' });

    expect(state.owned.length).toBe(ownedBefore + 1);
    const newEntry = state.owned[state.owned.length - 1];
    expect(newEntry.rarity).toBe('rare');
    expect([...run.party.front, ...run.party.reserve].some((f) => f?.id === newEntry.id)).toBe(true);
    expect(run.pending).toBeNull();
  });

  it('全陣営が雇用上限に達していても resolve-alt は必ずレアを出す (在庫という概念が無いため)', () => {
    const state = fresh();
    const rng = new Rng(3);
    let serial = 900;
    for (const faction of FACTIONS) {
      for (let i = 0; i < FACTION_HIRE_CAP[faction]; i++) {
        state.owned.push(generateCommon(faction, rng, serial++));
      }
    }
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.pending = BOSS_ALT_EVENT;
    const ownedBefore = state.owned.length;

    step(state, { type: 'resolve-alt' });

    expect(state.owned.length).toBe(ownedBefore + 1);
    expect(run.pending).toBeNull();
  });
});

describe('ViewModel: ダンジョンの前衛・控え・ダウンの表示', () => {
  it('前衛・控え・ダウンの人数が届く', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    const downedFighter = run.party.front[0]!;
    run.party.front[0] = null;
    run.downed.push(downedFighter);

    const vm = toViewModel(state);
    expect(vm.screen.kind).toBe('dungeon');
    if (vm.screen.kind !== 'dungeon') return;
    expect(vm.screen.frontCount).toBe(2);
    expect(vm.screen.downedCount).toBe(1);
  });
});

describe('ViewModel: 拠点の酒場と所持一覧', () => {
  it('tavern と roster が名前・陣営・スキル・価格つきで届く', () => {
    const state = fresh();
    const vm = toViewModel(state);
    expect(vm.screen.kind).toBe('town');
    if (vm.screen.kind !== 'town') return;
    expect(vm.screen.tavern).toHaveLength(3);
    expect(vm.screen.tavern[0].price).toBeGreaterThan(0);
    expect(vm.screen.roster.map((r) => r.id)).toEqual(['hero', 'mate', 'aide2']);
    expect(vm.screen.roster[0].rarity).toBe('named');
  });
});

describe('陣営倍率 (所持ベース) の表示', () => {
  it('編成画面に陣営倍率が出て、同陣営を集めるほど上がる。カードの攻撃力も倍率込みの実効値になる', () => {
    const state = fresh();
    const mateEntry = state.owned.find((c) => c.id === 'mate')!;
    const bareBefore = toViewModel(state);
    if (bareBefore.screen.kind !== 'town') throw new Error('拠点ではない');
    const orderBefore = bareBefore.screen.formation.factionMultipliers.find((f) => f.faction === 'order')!;
    // 最初は mate (order) 1 人だけなので、mate 自身のカードには「自分以外」が誰もおらず倍率は 1
    // (factionMultipliers の一覧値は自分を除かない集計なので、mate 自身のぶんだけ 1 より大きい)
    const mateCardBefore = bareBefore.screen.roster.find((c) => c.id === 'mate')!;
    expect(mateCardBefore.attack).toBe(effectiveAttack(mateEntry));

    // mate と同じ陣営 (order) を追加でまとめて集める
    const rng = new Rng(1);
    state.owned.push(...[1, 2, 3, 4].map((i) => generateCommon('order', rng, i)));

    const vm = toViewModel(state);
    if (vm.screen.kind !== 'town') throw new Error('拠点ではない');
    const order = vm.screen.formation.factionMultipliers.find((f) => f.faction === 'order')!;
    expect(order.multiplier).toBeGreaterThan(orderBefore.multiplier);
    // 他陣営 (kingdom) は誰も増やしていないので倍率は変わらない
    const kingdom = vm.screen.formation.factionMultipliers.find((f) => f.faction === 'kingdom')!;
    expect(kingdom.multiplier).toBe(1);

    // カードの攻撃力は倍率を掛けた実効値になる (素の実効値より大きい)。
    // 一覧の roster カードは「自分以外」で倍率を出すので、期待値もそれで計算する
    const mateCard = vm.screen.roster.find((c) => c.id === 'mate')!;
    expect(mateCard.attack).toBeGreaterThan(effectiveAttack(mateEntry));
    const totals = factionTotals(state.owned);
    expect(mateCard.attack).toBe(Math.round(effectiveAttack(mateEntry) * factionMultiplierOf(totals, mateEntry)));
  });
});

describe('seed', () => {
  it('同じ seed なら同じ出撃になる', () => {
    const a = newGame('SAME01');
    const b = newGame('SAME01');
    for (const s of [a, b]) {
      step(s, { type: 'sortie', sectorId: 1 });
      playOut(s);
    }
    expect(a.log).toEqual(b.log);
  });

  it('同じ seed なら同じ戦闘結果になる', () => {
    const a = newGame('SAME02');
    const b = newGame('SAME02');
    for (const s of [a, b]) {
      step(s, { type: 'sortie', sectorId: 1 });
      forceBattleEvent(s, 'battle');
      step(s, { type: 'resolve' });
      for (let i = 0; i < 40 && s.battle; i++) step(s, battlePolicy(s));
    }
    expect(a.battle?.outcome ?? a.result?.won).toEqual(b.battle?.outcome ?? b.result?.won);
    expect(a.log).toEqual(b.log);
  });
});
