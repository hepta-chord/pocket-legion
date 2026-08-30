// ダンジョンで起きるイベントの定義。
//
// マップを持たないので、進むたびにここから 1 つ引くのが探索のすべてになる。
// 重みは初期値で、バランス計測を見て動かす。

import type { Rng } from '../rng';

// 罠は単独のイベントとしては存在しない。宝箱・「何も無い」を解決したときの隠れた結果
// (game.ts の trapOutcome) としてだけ出るので、この EventKind には 'trap' を持たない
// (docs/plan.md「イベントの分岐」)
export type EventKind =
  | 'battle'
  | 'elite'
  | 'treasure'
  | 'spring'
  | 'nothing'
  | 'recruit'
  | 'caravan'
  | 'shrine'
  | 'rockfall'
  | 'corpse'
  | 'rest'
  | 'boss-alt';

export interface EventDef {
  kind: EventKind;
  weight: number;
  title: string;
  body: string;
  /** イベントを解決するボタンの文言 */
  action: string;
  /**
   * もう一方の選択肢の文言。持っていても毎回は出さず、二択が実際に出るかどうかは
   * ALT_CHANCE の確率で抽選する (run.ts の advance が引く。docs/plan.md「イベントの分岐」)。
   * boss-alt はボス前に固定で置く分岐なので、この抽選を経ずに必ず両方出す
   */
  altAction?: string;
  /**
   * true なら altAction を持っていても ALT_CHANCE の抽選を経ず、常に二択のまま見せる。
   * 祠・落石・休息は「選ばせるためのイベント」そのものなので、たまに二択が消えては
   * 存在意義が無くなる (docs/plan.md「分岐を増やす」)
   */
  alwaysAlt?: boolean;
}

/**
 * 二択が実際に出る確率。altAction を持つイベントでも、毎回選ばせると選択そのものが
 * 作業になるので、まれ (2 割程度) にしか出さない
 */
export const ALT_CHANCE = 0.2;

/**
 * 宝箱を開けたときに、中身が罠だった確率。予告や見た目 (アイコン・題) は変えず、
 * 開けるまで分からないままにする (docs/plan.md「イベントの分岐」)
 */
export const TREASURE_TRAP_CHANCE = 0.3;
/** 「何も無い」場所を通ったときに、実は罠が仕掛けてあった確率 */
export const NOTHING_TRAP_CHANCE = 0.25;
/** 死体を漁ったときに、実は罠が仕掛けてあった確率。宝箱・「何も無い」と同じ仕掛け */
export const CORPSE_TRAP_CHANCE = 0.25;

export const EVENTS: readonly EventDef[] = [
  { kind: 'battle', weight: 50, title: '魔物の群れ', body: '通路の先が塞がれている。', action: '戦う' },
  { kind: 'elite', weight: 10, title: '手強い影', body: '大きな影がこちらを見ている。', action: '挑む' },
  {
    kind: 'treasure',
    weight: 15,
    title: '宝箱',
    body: '打ち捨てられた箱がある。',
    // 開けるまで中身は分からない (TREASURE_TRAP_CHANCE で罠に化ける)。
    // 「見送る」を選べば何も得ない代わりに罠も踏まない
    action: '開ける',
    altAction: '見送る',
  },
  {
    kind: 'spring',
    weight: 10,
    title: '泉',
    body: '澄んだ水が湧いている。',
    action: '回復する',
    altAction: '経験値をもらう',
  },
  {
    kind: 'nothing',
    weight: 10,
    title: '何も無い',
    body: '静かな通路が続いている。',
    // 何も起きないことが大半だが、NOTHING_TRAP_CHANCE で罠が仕掛けてあることもある。
    // 毎回何かが起きると「起きたこと」自体の重みが無くなるので、意図して空振りを混ぜてある
    action: '進む',
  },
  { kind: 'recruit', weight: 5, title: '生存者', body: '壁際に人影がうずくまっている。', action: '声をかける' },
  {
    kind: 'caravan',
    weight: 8,
    title: '行商人',
    body: '荷を積んだ隊商とすれ違った。',
    action: '買う',
  },
  {
    kind: 'shrine',
    weight: 8,
    title: '古い祠',
    body: '苔むした祠がひっそりと佇んでいる。',
    // 「選ばせるためのイベント」なので ALT_CHANCE の抽選を経ず常に二択にする
    action: '祈る',
    altAction: '壊す',
    alwaysAlt: true,
  },
  {
    kind: 'rockfall',
    weight: 8,
    title: '崩れた通路',
    body: '瓦礫が道を塞いでいる。',
    action: '押し通る',
    altAction: '迂回する',
    alwaysAlt: true,
  },
  {
    kind: 'corpse',
    weight: 8,
    title: '冒険者の亡骸',
    body: '力尽きた冒険者が横たわっている。',
    // 開けるまで中身は分からない (CORPSE_TRAP_CHANCE で罠に化ける)。宝箱と同じ仕掛け
    action: '漁る',
  },
  {
    kind: 'rest',
    weight: 8,
    title: '安全な窪み',
    body: '身を隠せそうな窪みがある。',
    action: '休む',
    altAction: '先を急ぐ',
    alwaysAlt: true,
  },
];

export const TOTAL_WEIGHT = EVENTS.reduce((sum, e) => sum + e.weight, 0);

/**
 * ボスの 1 つ手前の深度に固定で置く分岐イベント。通常の抽選 (EVENTS / pickEvent) を経ないので
 * weight は使わない。「回復する」か「レアを迎える」の二択にする
 * (レアを全員所持済みなら加入の選択肢自体を出さない。判断は state.roster を見る game.ts 側に置く)
 */
export const BOSS_ALT_EVENT: EventDef = {
  kind: 'boss-alt',
  weight: 0,
  title: '静かな祭壇',
  body: '奥へ進む前に、二つの気配が選べと言っている。',
  action: '回復する',
  altAction: 'レアを迎える',
};

/** 0 以上 TOTAL_WEIGHT 未満の値から 1 つ選ぶ。乱数の消費は呼び出し側が持つ */
export function pickEvent(roll: number): EventDef {
  let acc = 0;
  for (const e of EVENTS) {
    acc += e.weight;
    if (roll < acc) return e;
  }
  return EVENTS[EVENTS.length - 1];
}

/**
 * 抽選した EventDef を「今回の 1 回」の見せ方に固定する。altAction を持つ定義でも、
 * ALT_CHANCE の確率でしか二択を見せない (外れれば altAction を落とした軽いコピーを返す)。
 * EVENTS の要素は共有オブジェクトなので、ここで書き換えず新しいオブジェクトを作って返す
 */
export function decideOccurrence(def: EventDef, rng: Rng): EventDef {
  if (!def.altAction) return def;
  // 祠・落石・休息 (alwaysAlt) は ALT_CHANCE の抽選を経ず、必ず二択のまま返す
  if (def.alwaysAlt) return def;
  if (rng.chance(ALT_CHANCE)) return def;
  return { ...def, altAction: undefined };
}
