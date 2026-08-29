import { describe, expect, it } from 'vitest';
import { newGame, step, toViewModel, type GameState } from './game';

function fresh(): GameState {
  return newGame('TESTAA');
}

/** 決着がつくまで潜り続ける。無限に回らないよう上限を切る */
function playOut(state: GameState, limit = 200): void {
  for (let i = 0; i < limit && !state.result; i++) {
    const vm = toViewModel(state);
    if (vm.screen.kind !== 'dungeon') break;
    step(state, vm.screen.event ? { type: 'resolve' } : { type: 'advance' });
  }
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
    // 被害の出るイベントに当たるまで潜れば、HP 1 では耐えられない
    playOut(state);
    expect(state.result?.won).toBe(false);
    expect(state.gold).toBe(0);
    expect(state.result?.gold).toBe(0);
  });
});

describe('区画の解放', () => {
  it('ボスを倒すと次の区画が開く', () => {
    const state = fresh();
    step(state, { type: 'sortie', sectorId: 1 });
    // ボスまで無傷で到達させ、解放だけを確かめる
    for (let i = 0; i < 20 && !state.run?.atBoss; i++) {
      step(state, { type: 'advance' });
      if (state.run) {
        state.run.pending = null;
        state.run.hp = state.run.maxHp;
      }
    }
    expect(state.run?.atBoss).toBe(true);
    step(state, { type: 'resolve' });
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

describe('seed', () => {
  it('同じ seed なら同じ出撃になる', () => {
    const a = newGame('SAME01');
    const b = newGame('SAME01');
    for (const s of [a, b]) {
      step(s, { type: 'sortie', sectorId: 1 });
      playOut(s, 40);
    }
    expect(a.log).toEqual(b.log);
  });
});
