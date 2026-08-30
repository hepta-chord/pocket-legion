// 出撃 1 回ぶんの進行。
//
// マップを持たないので、状態は「今どの区画のどの深度にいるか」と
// 「未解決のイベントがあるか」だけで足りる。座標も向きも持たない。

import { partyMaxHp, recalcVanguardBonus, type Fighter, type Party } from './battle';
import { buildFighter, type CharacterEntry } from './data/characters';
import { BOSS_ALT_EVENT, decideOccurrence, pickEvent, TOTAL_WEIGHT, type EventDef } from './data/events';
import { bossDepthAt, sectorById, type Sector } from './data/sectors';
import { partyFromRosterAndFormation, type Formation } from './formation';
import { factionMultiplierOf, factionTotals } from './roster';
import type { Rng } from './rng';

export interface RunState {
  sectorId: number;
  /** 現在の深度。1 から始まり、ボスの深度に着くとボス戦になる */
  depth: number;
  hp: number;
  maxHp: number;
  /** その出撃で拾った金。全滅すると失う */
  gold: number;
  /** 未解決のイベント。null なら「進む」だけができる */
  pending: EventDef | null;
  /** ボスに挑む深度に着いた */
  atBoss: boolean;
  /**
   * 奈落のボスを倒した直後。「潜り続ける」か「帰還する」かを選ぶまで進めない
   * (通常の区画では常に false のまま。docs/plan.md「奈落」)
   */
  abyssChoice: boolean;
  /** 出撃メンバー。Fighter は出撃をまたいで生きるので、帰還処理は roster 側の仕事にする */
  party: Party;
  /**
   * ダウンして party (front / reserve) から外れた Fighter。
   * battle.ts の BattleState.left を戦闘のたびにここへ回収する (game.ts の仕事)。
   * 泉・ボス前の回復イベントでここから party へ戻す
   */
  downed: Fighter[];
}

export function startRun(
  sectorId: number,
  owned: readonly CharacterEntry[],
  formation: Formation,
  formationTouched?: boolean,
): RunState {
  // 編成 (formation) は前衛 6 枠だけを決める。デッキは絞らないので、
  // 前衛に選ばれなかった owned 全員が控えになる (docs/plan.md「編成画面」)
  const party = partyFromRosterAndFormation(owned, formation, formationTouched);
  const maxHp = partyMaxHp(party);
  // 区画ごとの開始深度 (from) から潜り始める。中層・深層が浅層の続きの深さから
  // 始まってしまうと、区画を分けた意味が無くなるため (不具合の修正)
  const depth = sectorById(sectorId).from;
  return {
    sectorId,
    depth,
    hp: maxHp,
    maxHp,
    gold: 0,
    pending: null,
    atBoss: false,
    abyssChoice: false,
    party,
    downed: [],
  };
}

export function sectorOf(run: RunState): Sector {
  return sectorById(run.sectorId);
}

/**
 * 1 歩進めて、着いた先のイベントを決める。
 * ボスの深度に着いたときはイベントを引かずにボス戦になる (ボスの深度は bossDepthAt で決める。
 * 通常の区画では sector.depth のまま固定、奈落は 10 の倍数を追いかけ続ける)。
 * ボスの 1 つ手前の深度は、通常の抽選をせず固定でボス前の分岐イベントにする
 * (docs/plan.md「ボス前の分岐イベント」)。奈落でもこの仕組みがそのまま働くので、
 * 39・49・59 階……に分岐イベントが出る
 */
export function advance(run: RunState, rng: Rng): void {
  run.depth += 1;
  const sector = sectorOf(run);
  const bossDepth = bossDepthAt(sector, run.depth);
  if (run.depth >= bossDepth) {
    run.atBoss = true;
    run.pending = null;
    return;
  }
  if (run.depth === bossDepth - 1) {
    run.pending = BOSS_ALT_EVENT;
    return;
  }
  // 二択を持つ定義 (宝・泉) でも、実際に見せるかどうかは 2 割程度の確率でしか出さない
  // (docs/plan.md「イベントの分岐」)。ボス前の分岐イベントはこの抽選を経ず必ず両方出す
  run.pending = decideOccurrence(pickEvent(rng.int(0, TOTAL_WEIGHT - 1)), rng);
}

/**
 * 奈落のボスを倒した後「潜り続ける」を選んだときの遷移。
 * フラグを戻して次の「進む」で深度を進められるようにし、
 * **HP を全回復してダウンした味方も戻す**。ただし魔法・必殺の出撃通しコストは戻さない。
 *
 * 完全に無補給にすると、ボスを倒した直後の消耗そのままで次の 10 階に入ることになり、
 * 50 階のボスを 97% 倒せる部隊が 60 階には 0% しか届かない崖になっていた (計測で確認)。
 * 壁の正体を「強い札が撃てなくなること」に一本化すると、
 * 深さが伸びるほど手数だけで戦う形になり、記録が滑らかに伸びる (docs/plan.md「奈落」)
 */
export function continueAbyss(run: RunState): number {
  run.atBoss = false;
  run.abyssChoice = false;
  run.hp = run.maxHp;
  return reviveDowned(run);
}

export function damage(run: RunState, amount: number): void {
  run.hp = Math.max(0, run.hp - amount);
}

export function heal(run: RunState, amount: number): void {
  run.hp = Math.min(run.maxHp, run.hp + amount);
}

export function isWiped(run: RunState): boolean {
  return run.hp <= 0;
}

/**
 * 新しいキャラをその場でデッキ (出撃メンバー) に入れる。前衛に空きがあれば前衛、無ければ控え。
 * デッキは絞らないので控えの人数に上限は無く、常にデッキへ入る。
 * 新しい体力ぶん maxHp も伸ばす (元から居た扱いの復帰 (reviveDowned) とは違い、
 * こちらは編成そのものが増えるため)。
 * owned (この時点の所持キャラ全員。呼び出し側は entry を積んだ後に渡す) から
 * 陣営倍率を出して Fighter.attack/vitality に焼き込む
 */
export function addToDeck(run: RunState, entry: CharacterEntry, owned: readonly CharacterEntry[]): void {
  const totals = factionTotals(owned);
  const fighter = buildFighter(entry, factionMultiplierOf(totals, entry));
  const idx = run.party.front.findIndex((f) => f === null);
  if (idx >= 0) run.party.front[idx] = fighter;
  else run.party.reserve.push(fighter);
  // 前衛の顔ぶれが変わりうるので同陣営補正 (battle.ts) も出し直してから maxHp を測る
  recalcVanguardBonus(run.party);
  run.maxHp = partyMaxHp(run.party);
}

/**
 * ダウンした roster メンバーを全員 party に戻す (前衛の空きから詰め、余りは控え)。
 * 戻す人数を返す (ログ文言に使う)
 */
export function reviveDowned(run: RunState): number {
  const revived = run.downed.splice(0, run.downed.length);
  for (const f of revived) {
    f.downed = false;
    const idx = run.party.front.findIndex((x) => x === null);
    if (idx >= 0) run.party.front[idx] = f;
    else run.party.reserve.push(f);
  }
  // 前衛の顔ぶれが変わりうるので同陣営補正を出し直す
  if (revived.length > 0) recalcVanguardBonus(run.party);
  return revived.length;
}
