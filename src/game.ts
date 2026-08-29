// 最上位の状態機械。
//
// 入力 (Action) を受けて状態を進め、描画層に渡す ViewModel を組み立てる。
// ここは render/ を import しない。文字で描くか画像で描くかを知らないままにしておく。

import type { EventKind } from './data/events';
import { SECTORS, sectorById } from './data/sectors';
import { hashSeed, Rng } from './rng';
import { advance, damage, heal, isWiped, sectorOf, startRun, type RunState } from './run';
import type { LogLineView, ViewModel } from './view';

export const SAVE_VERSION = 1;

export type Action =
  | { type: 'sortie'; sectorId: number }
  | { type: 'advance' }
  | { type: 'resolve' }
  | { type: 'retreat' }
  | { type: 'dismiss' };

export interface GameState {
  version: number;
  seed: string;
  rngState: number;
  gold: number;
  /** 解放済みの区画。ボスを倒すと 1 つ増える */
  unlocked: number;
  run: RunState | null;
  /** 出撃を終えたときの結果。画面を閉じるまで残る */
  result: { won: boolean; depth: number; gold: number } | null;
  log: LogLineView[];
}

const LOG_LIMIT = 8;

export function newGame(seed: string): GameState {
  return {
    version: SAVE_VERSION,
    seed,
    rngState: hashSeed(seed),
    gold: 0,
    unlocked: 1,
    run: null,
    result: null,
    log: [{ kind: 'info', text: '迷宮都市に着いた。' }],
  };
}

export function addLog(state: GameState, kind: LogLineView['kind'], text: string): void {
  state.log.push({ kind, text });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

/** 状態の rngState と読み書きが噛み合う Rng を作る */
function rngOf(state: GameState): Rng {
  return new Rng(state.rngState);
}

function commitRng(state: GameState, rng: Rng): void {
  state.rngState = rng.state;
}

// ---------------------------------------------------------------------------
// イベントの解決
//
// 戦闘はマイルストーン 2 で battle.ts に移す。それまでは深度なりの被害と稼ぎを
// その場で確定させて、出撃が一周まわることだけを確かめられるようにしておく。

interface Outcome {
  hp: number;
  gold: number;
  kind: LogLineView['kind'];
  text: string;
}

function resolveEvent(run: RunState, kind: EventKind, rng: Rng): Outcome {
  const scale = 1 + run.depth / 10;
  switch (kind) {
    case 'battle': {
      const hurt = Math.round(rng.int(3, 7) * scale);
      const gold = Math.round(rng.int(4, 9) * scale);
      return { hp: -hurt, gold, kind: 'bad', text: `魔物を退けた。${hurt} 受け、${gold} G を得た。` };
    }
    case 'elite': {
      const hurt = Math.round(rng.int(8, 14) * scale);
      const gold = Math.round(rng.int(15, 25) * scale);
      return { hp: -hurt, gold, kind: 'bad', text: `影を斬り伏せた。${hurt} 受け、${gold} G を得た。` };
    }
    case 'treasure': {
      const gold = Math.round(rng.int(10, 20) * scale);
      return { hp: 0, gold, kind: 'good', text: `箱には ${gold} G が入っていた。` };
    }
    case 'spring': {
      const back = Math.round(run.maxHp / 3);
      return { hp: back, gold: 0, kind: 'good', text: `泉で立て直した。${back} 回復した。` };
    }
    case 'trap': {
      const hurt = Math.round(rng.int(4, 9) * scale);
      return { hp: -hurt, gold: 0, kind: 'warn', text: `罠が弾けた。${hurt} 受けた。` };
    }
    case 'recruit':
      // 加入はマイルストーン 4 で roster.ts が引き受ける
      return { hp: 0, gold: 0, kind: 'good', text: '生存者は都市まで付いてくると言った。' };
  }
}

function resolveBoss(state: GameState, run: RunState, rng: Rng): void {
  const hurt = Math.round(rng.int(10, 20) * (1 + run.depth / 10));
  damage(run, hurt);
  if (isWiped(run)) {
    addLog(state, 'bad', `守護者に沈められた。`);
    finishRun(state, false);
    return;
  }
  const gold = Math.round(rng.int(40, 70) * (1 + run.depth / 10));
  run.gold += gold;
  addLog(state, 'good', `守護者を討った。${hurt} 受け、${gold} G を得た。`);
  if (state.unlocked === run.sectorId && state.unlocked < SECTORS.length) {
    state.unlocked += 1;
    addLog(state, 'good', `${sectorById(state.unlocked).name}への道が開いた。`);
  }
  finishRun(state, true);
}

/** 出撃を終える。勝てば戦利品を持ち帰り、負ければその出撃の稼ぎを失う */
function finishRun(state: GameState, won: boolean): void {
  const run = state.run;
  if (!run) return;
  if (won) state.gold += run.gold;
  state.result = { won, depth: run.depth, gold: won ? run.gold : 0 };
  state.run = null;
}

// ---------------------------------------------------------------------------
// 遷移

export function step(state: GameState, action: Action): void {
  const rng = rngOf(state);
  switch (action.type) {
    case 'sortie': {
      if (state.run) break;
      if (action.sectorId > state.unlocked) break;
      state.run = startRun(action.sectorId);
      state.result = null;
      addLog(state, 'info', `${sectorById(action.sectorId).name}へ潜った。`);
      break;
    }

    case 'advance': {
      const run = state.run;
      if (!run || run.pending || run.atBoss) break;
      advance(run, rng);
      if (run.atBoss) addLog(state, 'warn', '広間に出た。奥に守護者がいる。');
      break;
    }

    case 'resolve': {
      const run = state.run;
      if (!run) break;
      if (run.atBoss) {
        resolveBoss(state, run, rng);
        break;
      }
      if (!run.pending) break;
      const out = resolveEvent(run, run.pending.kind, rng);
      run.pending = null;
      if (out.hp < 0) damage(run, -out.hp);
      else if (out.hp > 0) heal(run, out.hp);
      run.gold += out.gold;
      addLog(state, out.kind, out.text);
      if (isWiped(run)) {
        addLog(state, 'bad', '部隊は全滅した。稼ぎは通路に散らばった。');
        finishRun(state, false);
      }
      break;
    }

    case 'retreat': {
      const run = state.run;
      if (!run) break;
      addLog(state, 'info', '来た道を戻った。');
      finishRun(state, true);
      break;
    }

    case 'dismiss':
      state.result = null;
      break;
  }
  commitRng(state, rng);
}

// ---------------------------------------------------------------------------
// ViewModel

export function toViewModel(state: GameState): ViewModel {
  const log = state.log.map((l) => ({ ...l }));

  if (state.result) {
    return { screen: { kind: 'result', ...state.result }, log, seed: state.seed };
  }

  const run = state.run;
  if (run) {
    const sector = sectorOf(run);
    const pending = run.atBoss
      ? { title: '守護者', body: '奥から重い足音がする。', action: '挑む' }
      : run.pending
        ? { title: run.pending.title, body: run.pending.body, action: run.pending.action }
        : null;
    return {
      screen: {
        kind: 'dungeon',
        sectorName: sector.name,
        depth: run.depth,
        goal: sector.depth,
        hp: run.hp,
        maxHp: run.maxHp,
        // 通路の見た目だけを 4 段で回す。ゲーム状態ではない
        corridor: run.depth % 4,
        event: pending,
      },
      log,
      seed: state.seed,
    };
  }

  return {
    screen: {
      kind: 'town',
      gold: state.gold,
      sectors: SECTORS.map((s) => ({
        id: s.id,
        name: s.name,
        depth: s.depth,
        unlocked: s.id <= state.unlocked,
      })),
    },
    log,
    seed: state.seed,
  };
}
