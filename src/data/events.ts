// ダンジョンで起きるイベントの定義。
//
// マップを持たないので、進むたびにここから 1 つ引くのが探索のすべてになる。
// 重みは初期値で、バランス計測を見て動かす。

export type EventKind = 'battle' | 'elite' | 'treasure' | 'spring' | 'trap' | 'recruit' | 'boss-alt';

export interface EventDef {
  kind: EventKind;
  weight: number;
  title: string;
  body: string;
  /** イベントを解決するボタンの文言 */
  action: string;
  /** boss-alt だけが持つ、もう一方の選択肢の文言 */
  altAction?: string;
}

export const EVENTS: readonly EventDef[] = [
  { kind: 'battle', weight: 50, title: '魔物の群れ', body: '通路の先が塞がれている。', action: '戦う' },
  { kind: 'elite', weight: 10, title: '手強い影', body: '大きな影がこちらを見ている。', action: '挑む' },
  { kind: 'treasure', weight: 15, title: '宝箱', body: '打ち捨てられた箱がある。', action: '開ける' },
  { kind: 'spring', weight: 10, title: '泉', body: '澄んだ水が湧いている。', action: '休む' },
  { kind: 'trap', weight: 10, title: '罠', body: '足元の石が沈んだ。', action: '耐える' },
  { kind: 'recruit', weight: 5, title: '生存者', body: '壁際に人影がうずくまっている。', action: '声をかける' },
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
