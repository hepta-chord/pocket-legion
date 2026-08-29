import { describe, expect, it } from 'vitest';
import { EVENTS } from './data/events';
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
    step(state, { type: 'sortie', sectorId: 1 });
    step(state, { type: 'advance' });
    // 戦闘中は引き返せない仕様なので、即時解決するイベントで確かめる
    if (state.run) state.run.pending = EVENTS.find((e) => e.kind === 'treasure')!;
    step(state, { type: 'resolve' });
    const carried = state.run?.gold ?? 0;
    step(state, { type: 'retreat' });
    expect(state.gold).toBe(carried);
    expect(state.result?.won).toBe(true);
  });

  it('全滅するとその出撃の稼ぎを失う', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    if (state.run) state.run.hp = 1;
    // 被害の出るイベント (即時解決も戦闘も) に当たるまで進めれば、HP 1 では耐えられない
    playOut(state);
    expect(state.result?.won).toBe(false);
    expect(state.gold).toBe(0);
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
    expect(state.gold).toBe(0);
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
