// 編成 (formation) の型と操作。
//
// 編成が決めるのは「前衛 6 人に誰を置くか」だけ。控えは絞らない仕様なので
// (デッキは roster 全員、前衛に選ばれなかった人が自動で控えに回る)、
// 編成として persist するのは前衛 6 枠ぶんの id 列で足りる。
// Fighter (レベル・コスト上昇などの可変状態を持つ実体) への変換は startRun のタイミングでだけ行う。

import { buildFighter, CHARACTERS } from './data/characters';
import { FRONT_SIZE, type Fighter, type Party } from './battle';

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

/** 出撃直前に実際に使う前衛の並びを決める。未設定なら自動詰めに落ちる */
export function resolveFormation(roster: readonly string[], formation: readonly (string | null)[]): Formation {
  return isFormationUnset(formation) ? autoFillFormation(roster) : [...formation];
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

function fighterOf(id: string): Fighter | null {
  const entry = CHARACTERS.find((c) => c.id === id);
  return entry ? buildFighter(entry) : null;
}

/**
 * roster (所持キャラ全員) と編成 (前衛 6 枠) から Party を組む。
 * 前衛は編成どおりに、控えは前衛に選ばれなかった roster 全員になる。
 * デッキは絞らない仕様なので、控えの人数に上限は無い
 */
export function partyFromRosterAndFormation(roster: readonly string[], formation: readonly (string | null)[]): Party {
  const front6 = resolveFormation(roster, formation);
  const frontIds = new Set(front6.filter((id): id is string => id !== null));
  const front = front6.map((id) => (id ? fighterOf(id) : null));
  const reserve = roster
    .filter((id) => !frontIds.has(id))
    .map(fighterOf)
    .filter((f): f is Fighter => f !== null);
  return { front, reserve, swapCooldown: 0 };
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
    return;
  }

  const frontIdx = party.front.findIndex((f) => f?.id === id);
  if (frontIdx >= 0) {
    const incoming = party.front[frontIdx];
    party.front[frontIdx] = current;
    party.front[slot] = incoming;
    return;
  }

  const reserveIdx = party.reserve.findIndex((f) => f.id === id);
  if (reserveIdx < 0) return; // 今のデッキにいないキャラは置けない
  const incoming = party.reserve.splice(reserveIdx, 1)[0];
  party.front[slot] = incoming;
  if (current) party.reserve.push(current);
}
