// ヘッドレスの自動プレイ。
//
// 出撃 1 回 = 深度を上げながらの連戦として回し、貪欲な方針で戦わせて
// 勝率と消耗の形を測る。UI を通らず battle.ts を直接叩く。
//
// まだ入っていないもの: レベル、陣営倍率、前衛の同陣営補正、イベントの多様さ。
// ここの数字は骨格の健全性 (詰み方・戦術の偏り) を見るためのもので、最終調整ではない。

import {
  endTurn,
  GUARD_MAX,
  newParty,
  partyMaxHp,
  refillFront,
  startBattle,
  swapMembers,
  useGuard,
  useSkill,
  whyCannotUse,
  effectiveCost,
  type BattleState,
  type Party,
  type SwapMove,
} from '../battle';
import { buildFighter, CHARACTERS } from '../data/characters';
import { makeBoss, makePack } from '../data/enemies';
import { Rng } from '../rng';

// ---------------------------------------------------------------------------
// 貪欲な行動方針

interface AttackChoice {
  slot: number;
  skill: number;
  cost: number;
  power: number;
}

function usableAttacks(state: BattleState): AttackChoice[] {
  const out: AttackChoice[] = [];
  state.party.front.forEach((f, slot) => {
    if (!f) return;
    f.skills.forEach((s, skill) => {
      if (s.def.effect.kind !== 'attack') return;
      if (whyCannotUse(state, slot, skill) !== null) return;
      out.push({ slot, skill, cost: effectiveCost(s), power: s.def.effect.power });
    });
  });
  // 安い順、同コストなら威力の高い順
  return out.sort((a, b) => a.cost - b.cost || b.power - a.power);
}

function findSupport(state: BattleState, kind: 'heal' | 'buff'): { slot: number; skill: number } | null {
  for (let slot = 0; slot < state.party.front.length; slot++) {
    const f = state.party.front[slot];
    if (!f) continue;
    for (let skill = 0; skill < f.skills.length; skill++) {
      if (f.skills[skill].def.effect.kind !== kind) continue;
      if (whyCannotUse(state, slot, skill) === null) return { slot, skill };
    }
  }
  return null;
}

/** 前衛としてもう動けない (どのスキルも高くつきすぎる) なら交代候補にする */
function driedUp(state: BattleState, slot: number): boolean {
  const f = state.party.front[slot];
  if (!f) return false;
  const costs = f.skills
    .filter((s) => !(s.def.oncePerSortie && s.spent))
    .map((s) => effectiveCost(s));
  if (costs.length === 0) return true;
  return Math.min(...costs) > 3;
}

function playTurn(state: BattleState, rng: Rng): void {
  // 予告が出ている敵のうち、最も重い guardBreak まで積めればダウンを止められる。
  // 届かないなら軽減ぶんだけ取って、残りのマナは攻めに回す
  const incoming = state.enemies.filter((e) => e.hp > 0 && e.countdown === 1);
  if (incoming.length > 0) {
    const need = Math.min(GUARD_MAX, Math.max(...incoming.map((e) => e.def.guardBreak)));
    const want = state.mana >= need ? need : state.hp < state.maxHp * 0.5 ? 2 : 1;
    while (state.guard < want && useGuard(state)) {
      /* 積めるだけ積む */
    }
  }

  if (state.hp < state.maxHp * 0.45) {
    const healer = findSupport(state, 'heal');
    if (healer) useSkill(state, healer.slot, healer.skill, rng);
  }

  if (state.mana >= 3) {
    const buffer = findSupport(state, 'buff');
    if (buffer) useSkill(state, buffer.slot, buffer.skill, rng);
  }

  // 攻撃は安い順に、使えるものが無くなるまで
  for (let i = 0; i < 20 && state.outcome === 'ongoing'; i++) {
    const options = usableAttacks(state);
    if (options.length === 0) break;
    useSkill(state, options[0].slot, options[0].skill, rng);
  }
  if (state.outcome !== 'ongoing') return;

  // 干上がった前衛を控えと入れ替える。空きスロットもここで埋める
  if (state.party.swapCooldown === 0 && state.party.reserve.length > 0) {
    const moves: SwapMove[] = [];
    const pool = [...state.party.reserve];
    for (let slot = 0; slot < state.party.front.length && pool.length > 0; slot++) {
      if (state.party.front[slot] !== null && !driedUp(state, slot)) continue;
      moves.push({ slot, reserveId: pool.shift()!.id });
    }
    if (moves.length > 0) swapMembers(state, moves);
  }

  endTurn(state, rng);
}

// ---------------------------------------------------------------------------
// 出撃 1 回の連戦

export interface SortieResult {
  survived: boolean;
  battlesWon: number;
  turns: number;
  swaps: number;
  downs: number;
  annihilated: boolean;
  /** 区画のボスに勝ったか。雑魚で倒れたときは挑めていない */
  bossWon: boolean;
  /** ボス戦のターン数。挑めていなければ 0 */
  bossTurns: number;
}

const TURN_CAP = 25;
/** ボスは消耗戦になるので上限を別に持つ。設計目標は 50〜100 ターン */
const BOSS_TURN_CAP = 200;

export function playSortie(sectorId: number, startDepth: number, rng: Rng): SortieResult {
  // プールから 10 人を無作為に連れて行く
  const picked = [...CHARACTERS]
    .map((e) => ({ e, key: rng.next() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, 10)
    .map(({ e }) => buildFighter(e));
  const party: Party = newParty(picked.slice(0, 6), picked.slice(6));
  const maxHp = partyMaxHp(party);
  let hp = maxHp;

  const result: SortieResult = {
    survived: true,
    battlesWon: 0,
    turns: 0,
    swaps: 0,
    downs: 0,
    annihilated: false,
    bossWon: false,
    bossTurns: 0,
  };

  // 深度 +2 ごとに 1 戦。区画 1 なら深度 2〜10 の 5 連戦にあたる
  for (let step = 0; step < 5; step++) {
    const depth = startDepth + step * 2;
    const state = startBattle(party, hp, maxHp, makePack(depth, rng));
    let turns = 0;
    while (state.outcome === 'ongoing' && turns < TURN_CAP) {
      playTurn(state, rng);
      turns += 1;
    }
    result.turns += turns;
    result.swaps += state.stats.swaps;
    result.downs += state.stats.downs;
    if (state.outcome !== 'victory') {
      result.survived = false;
      result.annihilated = state.outcome === 'annihilated';
      return result;
    }
    result.battlesWon += 1;
    hp = state.hp;
    // 泉や回復薬の代わり。戦間で少し立て直す
    hp = Math.min(maxHp, hp + Math.round(maxHp * 0.2));
    refillFront(party);
  }

  // 区画の最深部のボス。雑魚と違って長期戦になるので、上限もターン数も別に持つ
  const boss = startBattle(party, hp, maxHp, [makeBoss(sectorId, rng)]);
  let bossTurns = 0;
  while (boss.outcome === 'ongoing' && bossTurns < BOSS_TURN_CAP) {
    playTurn(boss, rng);
    bossTurns += 1;
  }
  result.bossTurns = bossTurns;
  result.swaps += boss.stats.swaps;
  result.downs += boss.stats.downs;
  if (boss.outcome === 'victory') {
    result.bossWon = true;
  } else {
    result.survived = false;
    result.annihilated = boss.outcome === 'annihilated';
  }
  return result;
}

// ---------------------------------------------------------------------------

export interface SectorReport {
  label: string;
  sorties: number;
  winRate: number;
  avgBattlesWon: number;
  avgTurnsPerBattle: number;
  avgSwaps: number;
  /** ダウンの総数。前衛全滅率が 0 のとき、そもそも消耗しているのかを切り分ける */
  avgDowns: number;
  zeroSwapRate: number;
  annihilatedRate: number;
  /** ボスに挑めた出撃のうち、勝った割合 */
  bossWinRate: number;
  /** ボス戦のターン数。挑めた出撃だけで平均する */
  avgBossTurns: number;
}

export function measure(label: string, sectorId: number, startDepth: number, sorties: number, seed: number): SectorReport {
  const rng = new Rng(seed);
  let wins = 0;
  let battles = 0;
  let turns = 0;
  let swaps = 0;
  let downs = 0;
  let zeroSwap = 0;
  let annihilated = 0;
  let bossTries = 0;
  let bossWins = 0;
  let bossTurns = 0;
  for (let i = 0; i < sorties; i++) {
    const r = playSortie(sectorId, startDepth, rng);
    // 雑魚で倒れた出撃はボスに挑めていないので、ボスの平均から外す
    if (r.bossTurns > 0) {
      bossTries += 1;
      bossTurns += r.bossTurns;
      if (r.bossWon) bossWins += 1;
    }
    if (r.survived) wins += 1;
    battles += r.battlesWon + (r.survived ? 0 : 1);
    turns += r.turns;
    swaps += r.swaps;
    downs += r.downs;
    if (r.swaps === 0) zeroSwap += 1;
    if (r.annihilated) annihilated += 1;
  }
  return {
    label,
    sorties,
    winRate: wins / sorties,
    avgBattlesWon: battles / sorties,
    avgTurnsPerBattle: turns / battles,
    avgSwaps: swaps / sorties,
    avgDowns: downs / sorties,
    zeroSwapRate: zeroSwap / sorties,
    annihilatedRate: annihilated / sorties,
    bossWinRate: bossTries === 0 ? 0 : bossWins / bossTries,
    avgBossTurns: bossTries === 0 ? 0 : bossTurns / bossTries,
  };
}
