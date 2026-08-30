// 編成 (formation) の型と操作。
//
// 編成が決めるのは「前衛 6 人に誰を置くか」だけ。控えは絞らない仕様なので
// (デッキは所持キャラ全員、前衛に選ばれなかった人が自動で控えに回る)、
// 編成として persist するのは前衛 6 枠ぶんの id 列で足りる。
// Fighter (レベル・コスト上昇などの可変状態を持つ実体) への変換は startRun のタイミングでだけ行う。
//
// 所持キャラは固定のレア/主人公/相棒だけでなく、その場で生成したコモンも含む
// (GameState.owned: CharacterEntry[])。CHARACTERS (固定定義) を直接引かず、
// 呼び出し側が渡す owned の中から探す形にして、生成コモンも同じ経路で Fighter に変換できるようにする

import { buildFighter, type CharacterEntry } from './data/characters';
import { FRONT_SIZE, recalcVanguardBonus, type Fighter, type Party } from './battle';
import { factionMultiplierOf, factionTotals } from './roster';

export const FRONT_SLOTS = FRONT_SIZE;

/** 前衛スロットごとのキャラ id。null は空き */
export type Formation = (string | null)[];

export function emptyFormation(): Formation {
  return new Array(FRONT_SLOTS).fill(null);
}

/** プレイヤーがまだ編成を一度も触っていない (全スロット空) かどうか */
export function isFormationUnset(formation: readonly (string | null)[]): boolean {
  return formation.every((id) => id === null);
}

/** roster の先頭 6 人を前衛に詰めた既定の編成。formation が空のときのフォールバックにする */
export function autoFillFormation(roster: readonly string[]): Formation {
  const slots = emptyFormation();
  roster.slice(0, FRONT_SLOTS).forEach((id, i) => {
    slots[i] = id;
  });
  return slots;
}

/**
 * 出撃直前・編成表示に実際に使う前衛の並びを決める。
 * touched を省くと formation の中身 (全部 null かどうか) から自動判定するが、
 * これだと「一度も触っていない (自動詰めのまま)」と「触った結果たまたま全部空にした」を
 * 区別できない (後者も isFormationUnset が true になり、自動詰めへ引き戻されてしまう)。
 * 「全て外す」を本当に空のまま見せるには、呼び出し側 (GameState.formationTouched) が
 * 触ったかどうかを別に持って、touched として明示的に渡す必要がある
 */
export function resolveFormation(
  roster: readonly string[],
  formation: readonly (string | null)[],
  touched: boolean = !isFormationUnset(formation),
): Formation {
  return touched ? [...formation] : autoFillFormation(roster);
}

/**
 * スロットにキャラを置く。id が既に別スロットにいれば、そちらを空にしてから置く
 * (同じキャラを 2 スロットには置けない、という制約をここで一箇所に集約する)。
 * id が null ならそのスロットを空にするだけ。formation はその場で書き換える
 */
export function placeInFormation(formation: Formation, slot: number, id: string | null): void {
  if (slot < 0 || slot >= FRONT_SLOTS) return;
  if (id !== null) {
    const dup = formation.indexOf(id);
    if (dup >= 0) formation[dup] = null;
  }
  formation[slot] = id;
}

/**
 * owned (所持キャラ全員) と編成 (前衛 6 枠) から Party を組む。
 * 前衛は編成どおりに、控えは前衛に選ばれなかった owned 全員になる。
 * デッキは絞らない仕様なので、控えの人数に上限は無い
 */
export function partyFromRosterAndFormation(
  owned: readonly CharacterEntry[],
  formation: readonly (string | null)[],
  touched?: boolean,
): Party {
  // 所持ベースの陣営倍率 (roster.ts) は出撃時に一度だけ確定させ、Fighter.attack/vitality に焼き込む。
  // 陣営ごとの合算を先に出しておき、entry ごとに自分のぶんを引く形にして全走査を 1 回に抑える
  const totals = factionTotals(owned);
  const byId = new Map(owned.map((entry) => [entry.id, entry] as const));
  const fighterOf = (id: string): Fighter | null => {
    const entry = byId.get(id);
    return entry ? buildFighter(entry, factionMultiplierOf(totals, entry)) : null;
  };

  const ids = owned.map((entry) => entry.id);
  const front6 = resolveFormation(ids, formation, touched);
  const frontIds = new Set(front6.filter((id): id is string => id !== null));
  const front = front6.map((id) => (id ? fighterOf(id) : null));
  const reserve = ids
    .filter((id) => !frontIds.has(id))
    .map(fighterOf)
    .filter((f): f is Fighter => f !== null);
  const party: Party = { front, reserve, swapCooldown: 0 };
  // 前衛の同陣営補正 (battle.ts) は陣営倍率とは別物で、前衛の顔ぶれが決まった直後に確定させる
  recalcVanguardBonus(party);
  return party;
}

// ---------------------------------------------------------------------------
// ダンジョン内 (戦闘外) の並べ替え
//
// こちらは所持キャラの一覧から選ぶのではなく、今の Party (front/reserve) の中に
// 既にいるメンバーだけを動かす。新しいキャラは増やせず、ダウン中のキャラは
// Party から退避済み (run.downed) なのでそもそも候補に出てこない。

/**
 * 前衛スロットに、今のデッキの誰かを置く (id は front/reserve のどちらかにいる前提)。
 * 置きたい相手が前衛の別スロットにいれば入れ替え、控えにいればそちらと入れ替えて
 * 元の前衛メンバーを控えに回す。id が null ならそのスロットを空け、元の前衛メンバーは控えに回る
 */
export function setFrontMember(party: Party, slot: number, id: string | null): void {
  if (slot < 0 || slot >= FRONT_SLOTS) return;
  const current = party.front[slot];
  if (current && current.id === id) return; // 変化なし

  if (id === null) {
    party.front[slot] = null;
    if (current) party.reserve.push(current);
    // 前衛の顔ぶれが変わったので同陣営補正 (battle.ts) を出し直す
    recalcVanguardBonus(party);
    return;
  }

  const frontIdx = party.front.findIndex((f) => f?.id === id);
  if (frontIdx >= 0) {
    const incoming = party.front[frontIdx];
    party.front[frontIdx] = current;
    party.front[slot] = incoming;
    recalcVanguardBonus(party);
    return;
  }

  const reserveIdx = party.reserve.findIndex((f) => f.id === id);
  if (reserveIdx < 0) return; // 今のデッキにいないキャラは置けない
  const incoming = party.reserve.splice(reserveIdx, 1)[0];
  party.front[slot] = incoming;
  if (current) party.reserve.push(current);
  recalcVanguardBonus(party);
}
