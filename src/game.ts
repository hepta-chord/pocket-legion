// 最上位の状態機械。
//
// 入力 (Action) を受けて状態を進め、描画層に渡す ViewModel を組み立てる。
// ここは render/ を import しない。文字で描くか画像で描くかを知らないままにしておく。

import {
  effectiveCost,
  endTurn,
  GUARD_COST,
  GUARD_MAX,
  MANA_CAP,
  refillFront,
  startBattle,
  swapMembers,
  useGuard,
  useSkill,
  whyCannotUse,
  type BattleState,
  type EnemyDef,
  type SwapMove,
} from './battle';
import { FACTION_NAMES } from './data/factions';
import type { EventKind } from './data/events';
import { makeBoss, makePack } from './data/enemies';
import { SECTORS, sectorById } from './data/sectors';
import { hashSeed, Rng } from './rng';
import { advance, damage, heal, isWiped, sectorOf, startRun, type RunState } from './run';
import type { BattleView, LogLineView, ViewModel } from './view';

// 戦闘 (RunState.party) が加わって古いセーブと形が合わなくなったので、区切りを上げて捨てる
export const SAVE_VERSION = 2;

export type Action =
  | { type: 'sortie'; sectorId: number }
  | { type: 'advance' }
  | { type: 'resolve' }
  | { type: 'retreat' }
  | { type: 'dismiss' }
  | { type: 'battle-skill'; slot: number; skill: number }
  | { type: 'battle-guard' }
  | { type: 'battle-target'; index: number }
  | { type: 'battle-swap'; moves: SwapMove[] }
  | { type: 'battle-end-turn' };

/** 進行中の戦闘の種別。決着時の報酬とボス処理の分岐に使う */
type BattleKind = 'battle' | 'elite' | 'boss';

export interface GameState {
  version: number;
  seed: string;
  rngState: number;
  gold: number;
  /** 解放済みの区画。ボスを倒すと 1 つ増える */
  unlocked: number;
  run: RunState | null;
  battle: BattleState | null;
  /** battle が何の遭遇から始まったか。battle が null のときは null */
  battleKind: BattleKind | null;
  /** 選択中の敵の添字。戦闘開始時と対象が死んだときに、生きている先頭へ寄せ直す */
  battleTarget: number;
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
    battle: null,
    battleKind: null,
    battleTarget: 0,
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
// 戦闘 (battle / elite / ボス) は startBattle で battle.ts に委ねる。
// ここでその場決着させるのは treasure / spring / trap / recruit の 4 つだけ。

interface Outcome {
  hp: number;
  gold: number;
  kind: LogLineView['kind'];
  text: string;
}

function resolveEvent(run: RunState, kind: Exclude<EventKind, 'battle' | 'elite'>, rng: Rng): Outcome {
  const scale = 1 + run.depth / 10;
  switch (kind) {
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

/** 出撃を終える。勝てば戦利品を持ち帰り、負ければその出撃の稼ぎを失う */
function finishRun(state: GameState, won: boolean): void {
  const run = state.run;
  if (!run) return;
  if (won) state.gold += run.gold;
  state.result = { won, depth: run.depth, gold: won ? run.gold : 0 };
  state.run = null;
}

// ---------------------------------------------------------------------------
// 戦闘

/** 選択中の敵が倒れていたら、生きている先頭に寄せ直す */
function syncBattleTarget(state: GameState): void {
  const b = state.battle;
  if (!b) return;
  if (b.enemies[state.battleTarget]?.hp > 0) return;
  const alive = b.enemies.findIndex((e) => e.hp > 0);
  if (alive >= 0) state.battleTarget = alive;
}

function enterBattle(state: GameState, run: RunState, kind: BattleKind, enemies: EnemyDef[], line: string): void {
  state.battle = startBattle(run.party, run.hp, run.maxHp, enemies);
  state.battleKind = kind;
  state.battleTarget = 0;
  addLog(state, 'warn', line);
}

/** 戦闘の決着を GameState 側へ反映する。victory / wipe / annihilated のときだけ動く */
function settleBattle(state: GameState, run: RunState, rng: Rng): void {
  const b = state.battle;
  if (!b) return;
  syncBattleTarget(state);
  if (b.outcome === 'ongoing') return;

  // 戦闘中は battle.log をその場で見せているだけなので、抜けるときにまとめて本編ログへ移す
  for (const line of b.log) addLog(state, line.kind, line.text);

  if (b.outcome === 'victory') {
    run.hp = b.hp;
    const scale = 1 + run.depth / 10;
    const kind = state.battleKind;
    const gold =
      kind === 'boss'
        ? Math.round(rng.int(40, 70) * scale)
        : kind === 'elite'
          ? Math.round(rng.int(15, 25) * scale)
          : Math.round(rng.int(4, 9) * scale);
    run.gold += gold;
    addLog(state, 'good', `${gold} G を得た。`);
    refillFront(run.party);

    const wasBoss = kind === 'boss';
    state.battle = null;
    state.battleKind = null;
    if (wasBoss) {
      if (state.unlocked === run.sectorId && state.unlocked < SECTORS.length) {
        state.unlocked += 1;
        addLog(state, 'good', `${sectorById(state.unlocked).name}への道が開いた。`);
      }
      finishRun(state, true);
    }
    return;
  }

  // wipe (HP が尽きた) / annihilated (前衛が絶えた)。どちらも battle.log で理由は出ている
  addLog(state, 'bad', '出撃は終わった。稼ぎは通路に散らばった。');
  state.battle = null;
  state.battleKind = null;
  finishRun(state, false);
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
      if (!run || run.pending || run.atBoss || state.battle) break;
      advance(run, rng);
      if (run.atBoss) addLog(state, 'warn', '広間に出た。奥に守護者がいる。');
      break;
    }

    case 'resolve': {
      const run = state.run;
      if (!run || state.battle) break;
      if (run.atBoss) {
        const boss = makeBoss(run.sectorId, rng);
        enterBattle(state, run, 'boss', [boss], `${boss.name} が立ちはだかる。`);
        break;
      }
      if (!run.pending) break;
      const kind = run.pending.kind;
      if (kind === 'battle' || kind === 'elite') {
        run.pending = null;
        const enemies = makePack(run.depth, rng, kind === 'elite');
        enterBattle(state, run, kind, enemies, kind === 'elite' ? '影が立ちはだかる。' : '魔物が立ちはだかる。');
        break;
      }
      const out = resolveEvent(run, kind, rng);
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
      if (!run || state.battle) break;
      addLog(state, 'info', '来た道を戻った。');
      finishRun(state, true);
      break;
    }

    case 'dismiss':
      state.result = null;
      break;

    case 'battle-skill': {
      const run = state.run;
      const b = state.battle;
      if (!run || !b) break;
      useSkill(b, action.slot, action.skill, rng, state.battleTarget);
      settleBattle(state, run, rng);
      break;
    }

    case 'battle-guard': {
      const b = state.battle;
      if (!b) break;
      useGuard(b);
      break;
    }

    case 'battle-target': {
      const b = state.battle;
      if (!b) break;
      const e = b.enemies[action.index];
      if (e && e.hp > 0) state.battleTarget = action.index;
      break;
    }

    case 'battle-swap': {
      const run = state.run;
      const b = state.battle;
      if (!run || !b) break;
      swapMembers(b, action.moves);
      settleBattle(state, run, rng);
      break;
    }

    case 'battle-end-turn': {
      const run = state.run;
      const b = state.battle;
      if (!run || !b) break;
      endTurn(b, rng);
      settleBattle(state, run, rng);
      break;
    }
  }
  commitRng(state, rng);
}

// ---------------------------------------------------------------------------
// ViewModel

function resistLabel(resist: 'physical' | 'magic' | null): string | null {
  return resist === 'physical' ? '物理' : resist === 'magic' ? '魔法' : null;
}

function skillNote(oncePerSortie: boolean | undefined, selfDown: boolean | undefined): string | null {
  const tags: string[] = [];
  if (oncePerSortie) tags.push('1回限定');
  if (selfDown) tags.push('代償');
  return tags.length > 0 ? tags.join('・') : null;
}

function toBattleView(b: BattleState, target: number): BattleView {
  return {
    kind: 'battle',
    hp: b.hp,
    maxHp: b.maxHp,
    mana: b.mana,
    manaCap: MANA_CAP,
    guard: b.guard,
    guardMax: GUARD_MAX,
    turn: b.turn,
    target,
    enemies: b.enemies.map((e) => ({
      name: e.def.name,
      hp: e.hp,
      maxHp: e.def.maxHp,
      resist: resistLabel(e.def.resist),
      countdown: e.countdown,
      alive: e.hp > 0,
    })),
    slots: b.party.front.map((f, slot) => {
      if (!f) return null;
      return {
        name: f.name,
        faction: FACTION_NAMES[f.faction],
        skills: f.skills.map((s, skillIndex) => ({
          name: s.def.name,
          cost: effectiveCost(s),
          raised: s.turnBump + s.sortieBump,
          usable: whyCannotUse(b, slot, skillIndex) === null,
          reason: whyCannotUse(b, slot, skillIndex),
          note: skillNote(s.def.oncePerSortie, s.def.selfDown),
        })),
      };
    }),
    reserve: b.party.reserve.map((f) => ({ id: f.id, name: f.name, faction: FACTION_NAMES[f.faction] })),
    swapCooldown: b.party.swapCooldown,
    canGuard: b.guard < GUARD_MAX && b.mana >= GUARD_COST,
  };
}

export function toViewModel(state: GameState): ViewModel {
  if (state.result) {
    return { screen: { kind: 'result', ...state.result }, log: [...state.log], seed: state.seed };
  }

  if (state.battle) {
    // 戦闘中は本編ログの末尾に battle.log をつないで、直近の場面が読めるようにする。
    // 本編ログそのものへは決着時 (settleBattle) にまとめて移すので、ここでは二重に積まない
    const log = [...state.log, ...state.battle.log].slice(-LOG_LIMIT);
    return { screen: toBattleView(state.battle, state.battleTarget), log, seed: state.seed };
  }

  const log = [...state.log];

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
