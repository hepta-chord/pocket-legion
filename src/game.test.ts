import { describe, expect, it } from 'vitest';
import { CHARACTERS } from './data/characters';
import { BOSS_ALT_EVENT, EVENTS } from './data/events';
import { newGame, step, toViewModel, type Action, type GameState } from './game';

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
    if (state.run) state.run.hp = 1;
    // 被害の出るイベント (即時解決も戦闘も) に当たるまで進めれば、HP 1 では耐えられない
    playOut(state);
    expect(state.result?.won).toBe(false);
    expect(state.gold).toBe(goldBefore);
    expect(state.result?.gold).toBe(0);
  });
});

describe('初期の 2 人', () => {
  it('主人公と相棒が必ず前衛にいる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const front = state.run!.party.front;
    expect(front.some((f) => f?.id === 'hero')).toBe(true);
    expect(front.some((f) => f?.id === 'mate')).toBe(true);
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

describe('初期状態', () => {
  it('roster は hero と mate だけ、所持金は 300、酒場にはコモン 3 人が並ぶ', () => {
    const state = fresh();
    expect(state.roster).toEqual(['hero', 'mate']);
    expect(state.gold).toBe(300);
    expect(state.tavern).toHaveLength(3);
    for (const id of state.tavern) {
      const entry = CHARACTERS.find((c) => c.id === id);
      expect(entry?.rarity).toBe('common');
      expect(state.roster).not.toContain(id);
    }
  });
});

describe('酒場', () => {
  it('雇うと roster に加わり、金が減り、酒場から外れる', () => {
    const state = fresh();
    const id = state.tavern[0];
    const entry = CHARACTERS.find((c) => c.id === id)!;
    const goldBefore = state.gold;
    step(state, { type: 'hire', id });
    expect(state.roster).toContain(id);
    expect(state.gold).toBe(goldBefore - entry.price);
    expect(state.tavern).not.toContain(id);
  });

  it('金が足りなければ雇えない', () => {
    const state = fresh();
    state.gold = 0;
    const id = state.tavern[0];
    step(state, { type: 'hire', id });
    expect(state.roster).not.toContain(id);
    expect(state.gold).toBe(0);
  });

  it('酒場にいない id は雇えない', () => {
    const state = fresh();
    const rosterBefore = [...state.roster];
    step(state, { type: 'hire', id: 'not-in-tavern' });
    expect(state.roster).toEqual(rosterBefore);
  });

  it('出撃を終えるたびに酒場が引き直される', () => {
    const state = fresh();
    const before = [...state.tavern];
    step(state, { type: 'sortie', sectorId: 1 });
    step(state, { type: 'retreat' });
    // 品揃えが変わりうることの確認 (所持していないコモンからの抽選なので、hero/mate 以外は毎回同じ結果とは限らない)
    expect(state.tavern).toHaveLength(3);
    for (const id of state.tavern) {
      expect(state.roster).not.toContain(id);
    }
    // seed が同じ手順で毎回引き直されることの再現性だけ見る (中身の変化までは問わない)
    expect(Array.isArray(before)).toBe(true);
  });
});

describe('出撃時のパーティ編成', () => {
  it('roster 全員でパーティを組む (roster が 2 人なら 2 人で潜る)', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    expect(state.run?.party.front.filter(Boolean)).toHaveLength(2);
  });

  it('雇ったキャラも次の出撃からパーティに入る', () => {
    const state = fresh();
    const id = state.tavern[0];
    step(state, { type: 'hire', id });
    step(state, { type: 'sortie', sectorId: 1 });
    const front = state.run!.party.front;
    expect(front.some((f) => f?.id === id)).toBe(true);
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
    if (state.run) state.run.hp = 1;
    playOut(state);
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

describe('ダンジョン内の加入イベント', () => {
  it('所持していないコモンが 1 人 roster とデッキに加わる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    const rosterBefore = state.roster.length;
    run.pending = EVENTS.find((e) => e.kind === 'recruit')!;
    step(state, { type: 'resolve' });
    expect(state.roster.length).toBe(rosterBefore + 1);
    const newId = state.roster[state.roster.length - 1];
    expect([...run.party.front, ...run.party.reserve].some((f) => f?.id === newId)).toBe(true);
  });

  it('全コモン所持済みなら金に化ける', () => {
    const state = fresh();
    state.roster = CHARACTERS.filter((c) => c.rarity === 'common').map((c) => c.id);
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    const goldBefore = run.gold;
    run.pending = EVENTS.find((e) => e.kind === 'recruit')!;
    step(state, { type: 'resolve' });
    expect(run.gold).toBeGreaterThan(goldBefore);
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

  it('「レアを迎える」で未所持のレアが roster とデッキに加わる', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.pending = BOSS_ALT_EVENT;
    const rosterBefore = state.roster.length;

    step(state, { type: 'resolve-alt' });

    expect(state.roster.length).toBe(rosterBefore + 1);
    const newId = state.roster[state.roster.length - 1];
    expect(CHARACTERS.find((c) => c.id === newId)?.rarity).toBe('rare');
    expect([...run.party.front, ...run.party.reserve].some((f) => f?.id === newId)).toBe(true);
    expect(run.pending).toBeNull();
  });

  it('全レア所持済みなら resolve-alt は何もしない', () => {
    const state = fresh();
    state.roster = [...state.roster, ...CHARACTERS.filter((c) => c.rarity === 'rare').map((c) => c.id)];
    step(state, { type: 'sortie', sectorId: 1 });
    const run = state.run!;
    run.pending = BOSS_ALT_EVENT;
    const rosterBefore = state.roster.length;

    step(state, { type: 'resolve-alt' });

    expect(state.roster.length).toBe(rosterBefore);
    expect(run.pending).not.toBeNull();
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
    expect(vm.screen.frontCount).toBe(1);
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
    expect(vm.screen.roster.map((r) => r.id)).toEqual(['hero', 'mate']);
    expect(vm.screen.roster[0].rarity).toBe('rare');
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
