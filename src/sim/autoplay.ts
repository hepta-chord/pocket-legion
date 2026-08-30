// ヘッドレスの自動プレイ。
//
// 出撃 1 回 = 深度を上げながらの連戦として回し、貪欲な方針で戦わせて
// 勝率と消耗の形を測る。UI (game.ts / run.ts) を通らず battle.ts を直接叩くが、
// 酒場の代わり・ボス前の分岐・泉のリセット・recruit のデッキ加入は
// 出撃の骨格に効くので、簡略化した形で反映する。
//
// レベルは「出撃前に区画ごとの想定レベルを振って測る」形で入っている
// (浅層 1、中層 10、深層 20 など。docs/batch-growth.md 7 節)。経験値を積んで
// 上げていく過程そのものはここでは再現しない (計測は「その戦力なら勝てるか」を見るためで、
// 数値の調整は計画側がまとめて行う)。
//
// 所持ベースの陣営倍率 (roster.ts) はレベルと違い所持人数で決まるので、レベルだけ振っても
// 中盤以降の実態と合わない。出撃前に区画ごとの想定所持人数も振り、陣営の人口比と雇用上限に
// 沿って生成した owned から倍率を出す (docs/batch-faction.md 4 節)。
//
// 前衛の同陣営補正は battle.ts 側 (startBattle/swapMembers/downSlot) が前衛の顔ぶれから
// 自動で出し直すので、ここで別途は測らない (recruit で入った顔ぶれ次第でそのまま乗る)。
//
// まだ入っていないもの: 治療薬以外のアイテム、
// treasure/nothing (罠が隠れている) の抽選そのもの (金と HP は測定対象に含めていない)。
// ここの数字は骨格の健全性 (詰み方・戦術の偏り) を見るためのもので、最終調整ではない。

import {
  DEFENSE_MAX,
  endTurn,
  newParty,
  partyMaxHp,
  refillFront,
  resetSortieProgress,
  startBattle,
  swapMembers,
  useDefense,
  useSkill,
  whyCannotUse,
  effectiveCost,
  type BattleState,
  type Party,
  type SwapMove,
} from '../battle';
import { buildFighter, CHARACTERS, withLevel, type CharacterEntry } from '../data/characters';
import { generateCommon, generateRare } from '../data/common-gen';
import { makeBoss, makeFoe } from '../data/enemies';
import { FACTION_HIRE_CAP, FACTION_WEIGHT, FACTIONS, type Faction } from '../data/factions';
import { bossDepthAt, sectorById } from '../data/sectors';
import { Rng } from '../rng';
import { factionMultiplier, factionMultiplierOf, factionTotals, type FactionTotals } from '../roster';

/** コモンの id (`common-N`) に振る通し番号。生成の結果には影響しない */
let simCommonSerial = 1;

/** 雇用上限に達していない陣営の中から、人口比の重みで 1 つ選ぶ (game.ts の weightedFaction の簡易版) */
function weightedAvailableFaction(rng: Rng, counts: Record<Faction, number>): Faction {
  const pool = FACTIONS.filter((f) => counts[f] < FACTION_HIRE_CAP[f]);
  const usable = pool.length > 0 ? pool : FACTIONS;
  const total = usable.reduce((sum, f) => sum + FACTION_WEIGHT[f], 0);
  let roll = rng.next() * total;
  for (const f of usable) {
    roll -= FACTION_WEIGHT[f];
    if (roll < 0) return f;
  }
  return usable[usable.length - 1];
}

/**
 * 想定の所持人数ぶん、陣営の人口比と雇用上限に沿ってコモンを生成する (docs/batch-faction.md 4 節)。
 * hero/mate は雇用上限に数えない例外なので、この生成には含めない (呼び出し側が別に足す)
 */
function generateAssumedOwned(rng: Rng, assumedLevel: number, count: number): CharacterEntry[] {
  const counts: Record<Faction, number> = { kingdom: 0, order: 0, mercs: 0, frontier: 0 };
  const out: CharacterEntry[] = [];
  for (let i = 0; i < count; i++) {
    const faction = weightedAvailableFaction(rng, counts);
    counts[faction] += 1;
    out.push(withLevel(generateCommon(faction, rng, simCommonSerial++), assumedLevel));
  }
  return out;
}

/** ダンジョン内の加入イベント (recruit) の簡略版。コモンを 1 人その場で生成してデッキに足す。
 * 区画の想定レベルに合わせておく (でないと後半の連戦で level 1 の丸腰が混ざってしまう)。
 * 陣営倍率は出撃開始時点の想定所持 (initialTotals) を土台にした近似値を掛ける
 * (加入のたびに全所持を数え直すほどの精度は測定には要らない) */
function addRecruit(party: Party, rng: Rng, assumedLevel: number, initialTotals: FactionTotals): void {
  const faction = rng.pick(FACTIONS);
  const picked = withLevel(generateCommon(faction, rng, simCommonSerial++), assumedLevel);
  const fighter = buildFighter(picked, factionMultiplier(initialTotals, faction));
  const idx = party.front.findIndex((f) => f === null);
  if (idx >= 0) party.front[idx] = fighter;
  else party.reserve.push(fighter);
}

// events.ts の重み (recruit 5/100・spring 10/100) を、深度 +2 ごとの 1 区間
// (advance 2 回ぶん) の近似確率に丸めたもの。細かい抽選はここでは再現しない
const RECRUIT_CHANCE_PER_STEP = 0.1;
const SPRING_CHANCE_PER_STEP = 0.19;

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

function findSupport(state: BattleState, kind: 'heal' | 'cheer' | 'ward' | 'barrier'): { slot: number; skill: number } | null {
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

/**
 * 貪欲な方針 (docs/batch-b.md 補足): 防御は毎ターン 1 枚積む。大技の予告 (あと 1) が
 * 出たら 3〜4 枚に増やす。ダウン攻撃の予告にはバリアがあれば張る。鼓舞とガードは
 * 切れていたら積む。逃げるは使わない。
 */
function playTurn(state: BattleState, rng: Rng): void {
  // ダウン攻撃の予告。バリアが無ければ張っておく (防御・ward では防げないため)
  const downSoon = state.enemy.hp > 0 && state.enemy.downCountdown === 1;
  if (downSoon && !state.barrier) {
    const barrierSkill = findSupport(state, 'barrier');
    if (barrierSkill) useSkill(state, barrierSkill.slot, barrierSkill.skill, rng);
  }

  // 防御は毎ターン 1 枚。大技の予告 (あと 1) が出ているターンだけ 3〜4 枚まで積み増す
  const bigSoon = state.enemy.hp > 0 && state.enemy.bigCountdown === 1;
  const want = bigSoon ? DEFENSE_MAX : 1;
  while (state.defense < want && useDefense(state)) {
    /* 積めるだけ積む */
  }

  if (state.hp < state.maxHp * 0.45) {
    const healer = findSupport(state, 'heal');
    if (healer) useSkill(state, healer.slot, healer.skill, rng);
  }

  // 鼓舞・ガード (ward) は切れていたら積み直す
  if (state.cheer.stacks === 0) {
    const cheerSkill = findSupport(state, 'cheer');
    if (cheerSkill) useSkill(state, cheerSkill.slot, cheerSkill.skill, rng);
  }
  if (state.ward.stacks === 0) {
    const wardSkill = findSupport(state, 'ward');
    if (wardSkill) useSkill(state, wardSkill.slot, wardSkill.skill, rng);
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

/**
 * @param assumedLevel 出撃前に全員へ振る「想定レベル」。区画ごとに決め打ちで測る
 * (浅層 1、中層 10、深層 20 など。docs/batch-growth.md 7 節)。CHARACTERS は共有オブジェクトなので、
 * withLevel で独立したコピーを作ってからレベルを振る (他の測定・他のプレイへ漏れないように)
 * @param assumedOwnedCount 出撃前に持たせる想定の所持人数 (固定の 3 人 hero/mate/aide2 を含む)。
 * 所持ベースの陣営倍率 (roster.ts) は所持人数で決まるので、レベルだけ振っても中盤以降の実態と合わない
 * (docs/batch-faction.md 4 節。浅層 5・中層 12・深層 20 が初期値)
 */
export function playSortie(sectorId: number, rng: Rng, assumedLevel: number, assumedOwnedCount: number): SortieResult {
  // 区画の開始深度 (Sector.from) から測る。以前はここに区画ごとの開始深度を決め打ちで渡していたが、
  // 実装側 (run.ts の startRun) が Sector.from を見ずに深度 1 から始まる不具合を抱えていて、
  // 計測と実装が別の値を見ていた。Sector.from を直接引くことで両者を同じ値に揃える (不具合の修正)。
  // +1 するのは「区画に入った直後の 1 歩目」を最初の 1 戦に見立てるため (元の決め打ち値と同じ考え方)
  const startDepth = sectorById(sectorId).from + 1;
  // 出撃開始時: hero + mate + aide2 + 想定所持人数ぶんのコモン (酒場・道中の加入をまとめて先取りした形。
  // 陣営は人口比の重みで、雇用上限に沿って生成する)
  const hero = withLevel(CHARACTERS.find((c) => c.id === 'hero')!, assumedLevel);
  const mate = withLevel(CHARACTERS.find((c) => c.id === 'mate')!, assumedLevel);
  const aide2 = withLevel(CHARACTERS.find((c) => c.id === 'aide2')!, assumedLevel);
  const startCommons = generateAssumedOwned(rng, assumedLevel, Math.max(0, assumedOwnedCount - 3));
  const initial: CharacterEntry[] = [hero, mate, aide2, ...startCommons];
  // 所持ベースの陣営倍率は出撃時に一度だけ確定させる。以降の recruit・レア加入も
  // この時点の合算 (initialTotals) を近似の土台にする (加入のたびに数え直すほどの精度は測定に要らない)
  const initialTotals = factionTotals(initial);
  const fighters = initial.map((c) => buildFighter(c, factionMultiplierOf(initialTotals, c)));
  const party: Party = newParty(fighters.slice(0, 6), fighters.slice(6));
  let maxHp = partyMaxHp(party);
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

    // 泉のリセットと recruit のデッキ加入を、区間ごとの近似確率で反映する
    if (rng.chance(RECRUIT_CHANCE_PER_STEP)) addRecruit(party, rng, assumedLevel, initialTotals);
    if (rng.chance(SPRING_CHANCE_PER_STEP)) {
      hp = Math.min(maxHp, hp + Math.round(maxHp * 0.5));
      resetSortieProgress(party);
    }
    maxHp = partyMaxHp(party);

    const state = startBattle(party, hp, maxHp, makeFoe(depth, rng, false), rng);
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

  // ボス前の分岐イベント。HP が 6 割未満なら回復、以上ならレア加入を選ぶ。
  // レアは固定の名簿を持たずその場で生成する (docs/plan.md「レアリティと入手」) ので、
  // 「尽きて選べない」分岐は無く、必ず 1 人加入する
  if (hp < maxHp * 0.6) {
    hp = maxHp;
    resetSortieProgress(party);
  } else {
    const faction = rng.pick(FACTIONS);
    const picked = withLevel(generateRare(faction, rng, simCommonSerial++), assumedLevel);
    const fighter = buildFighter(picked, factionMultiplier(initialTotals, faction));
    const idx = party.front.findIndex((f) => f === null);
    if (idx >= 0) party.front[idx] = fighter;
    else party.reserve.push(fighter);
    maxHp = partyMaxHp(party);
  }

  // 区画の最深部のボス。雑魚と違って長期戦になるので、上限もターン数も別に持つ
  const boss = startBattle(party, hp, maxHp, makeBoss(sectorId, rng, sectorById(sectorId).depth), rng);
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
  /** ボスまで辿り着けた出撃の割合。雑魚で倒れると挑めない */
  bossReachRate: number;
  /** ボスに挑めた出撃のうち、勝った割合 */
  bossWinRate: number;
  /** ボス戦のターン数。挑めた出撃だけで平均する */
  avgBossTurns: number;
}

/**
 * @param assumedLevel 出撃前に全員へ振る想定レベル (docs/batch-growth.md 7 節)。区画ごとに呼び出し側が決める
 * @param assumedOwnedCount 出撃前に持たせる想定の所持人数 (docs/batch-faction.md 4 節)。区画ごとに呼び出し側が決める
 */
export function measure(
  label: string,
  sectorId: number,
  sorties: number,
  seed: number,
  assumedLevel: number,
  assumedOwnedCount: number,
): SectorReport {
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
    const r = playSortie(sectorId, rng, assumedLevel, assumedOwnedCount);
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
    bossReachRate: bossTries / sorties,
    bossWinRate: bossTries === 0 ? 0 : bossWins / bossTries,
    avgBossTurns: bossTries === 0 ? 0 : bossTurns / bossTries,
  };
}

// ---------------------------------------------------------------------------
// 奈落 (docs/batch-abyss.md 7 節)
//
// 通常区画と違い「どこまで潜れたか」だけが指標になるので、生還率やボス勝率は測らない。
// 自動操縦は常に「潜り続ける」に固定する。帰還の判断は人間のものなので、自動化して
// 閾値を設けると閾値の設定次第で数字が動いてしまい、奈落係数の目安として読めなくなるため

const ABYSS_SECTOR_ID = 4;
/** 安全弁。abyssMul は深度とともに伸び続けるのでいずれ全滅する想定だが、念のため上限を切る */
const ABYSS_SEGMENT_CAP = 200;

/** 奈落を全滅するまで潜り続けて測る 1 回ぶん。戻り値は倒れた深度 (=その回の最深到達深度) */
export function playAbyssSortie(rng: Rng, assumedLevel: number, assumedOwnedCount: number): number {
  const sector = sectorById(ABYSS_SECTOR_ID);
  const hero = withLevel(CHARACTERS.find((c) => c.id === 'hero')!, assumedLevel);
  const mate = withLevel(CHARACTERS.find((c) => c.id === 'mate')!, assumedLevel);
  const aide2 = withLevel(CHARACTERS.find((c) => c.id === 'aide2')!, assumedLevel);
  const startCommons = generateAssumedOwned(rng, assumedLevel, Math.max(0, assumedOwnedCount - 3));
  const initial: CharacterEntry[] = [hero, mate, aide2, ...startCommons];
  const initialTotals = factionTotals(initial);
  const fighters = initial.map((c) => buildFighter(c, factionMultiplierOf(initialTotals, c)));
  const party: Party = newParty(fighters.slice(0, 6), fighters.slice(6));
  let maxHp = partyMaxHp(party);
  let hp = maxHp;
  let depth = sector.from;

  for (let segment = 0; segment < ABYSS_SEGMENT_CAP; segment++) {
    // 深度 +2 ごとに 1 戦、10 階ぶんを 5 連戦で近似する (playSortie と同じ考え方)
    for (let step = 0; step < 5; step++) {
      depth += 2;
      if (rng.chance(RECRUIT_CHANCE_PER_STEP)) addRecruit(party, rng, assumedLevel, initialTotals);
      if (rng.chance(SPRING_CHANCE_PER_STEP)) {
        hp = Math.min(maxHp, hp + Math.round(maxHp * 0.5));
        resetSortieProgress(party);
      }
      maxHp = partyMaxHp(party);
      // makeFoe は depth なりに abyssMul も掛けて生成する (data/enemies.ts)
      const state = startBattle(party, hp, maxHp, makeFoe(depth, rng, false), rng);
      let turns = 0;
      while (state.outcome === 'ongoing' && turns < TURN_CAP) {
        playTurn(state, rng);
        turns += 1;
      }
      if (state.outcome !== 'victory') return depth;
      hp = state.hp;
      hp = Math.min(maxHp, hp + Math.round(maxHp * 0.2));
      refillFront(party);
    }

    // ボス前の分岐イベント。playSortie と同じ判定 (HP 6 割未満なら回復、以上ならレア加入)
    if (hp < maxHp * 0.6) {
      hp = maxHp;
      resetSortieProgress(party);
    } else {
      const faction = rng.pick(FACTIONS);
      const picked = withLevel(generateRare(faction, rng, simCommonSerial++), assumedLevel);
      const fighter = buildFighter(picked, factionMultiplier(initialTotals, faction));
      const idx = party.front.findIndex((f) => f === null);
      if (idx >= 0) party.front[idx] = fighter;
      else party.reserve.push(fighter);
      maxHp = partyMaxHp(party);
    }

    // 実際のボス深度は bossDepthAt (10 の倍数) で決める。近似の foe 連戦とは独立に求める
    const bossDepth = bossDepthAt(sector, depth);
    const boss = startBattle(party, hp, maxHp, makeBoss(ABYSS_SECTOR_ID, rng, bossDepth), rng);
    let bossTurns = 0;
    while (boss.outcome === 'ongoing' && bossTurns < BOSS_TURN_CAP) {
      playTurn(boss, rng);
      bossTurns += 1;
    }
    if (boss.outcome !== 'victory') return bossDepth;

    // 「潜り続ける」固定。回復も補給もしない (docs/plan.md「奈落」)
    hp = boss.hp;
    refillFront(party);
    depth = bossDepth;
  }
  return depth;
}

export interface AbyssReport {
  sorties: number;
  /** 平均到達深度 */
  avgDepth: number;
  /** 300 回のうち最も深く潜れた到達深度 */
  maxDepth: number;
}

/**
 * @param assumedLevel 出撃前に全員へ振る想定レベル (奈落は想定レベル 30 で測る。docs/batch-abyss.md 7 節)
 * @param assumedOwnedCount 出撃前に持たせる想定の所持人数 (奈落は想定 20 人で測る)
 */
export function measureAbyss(sorties: number, seed: number, assumedLevel: number, assumedOwnedCount: number): AbyssReport {
  const rng = new Rng(seed);
  let total = 0;
  let max = 0;
  for (let i = 0; i < sorties; i++) {
    const depth = playAbyssSortie(rng, assumedLevel, assumedOwnedCount);
    total += depth;
    if (depth > max) max = depth;
  }
  return { sorties, avgDepth: total / sorties, maxDepth: max };
}
