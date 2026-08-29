// ダンジョンで起きるイベントの定義。
//
// マップを持たないので、進むたびにここから 1 つ引くのが探索のすべてになる。
// 重みは初期値で、バランス計測を見て動かす。

export type EventKind = 'battle' | 'elite' | 'treasure' | 'spring' | 'trap' | 'recruit';

export interface EventDef {
  kind: EventKind;
  weight: number;
  title: string;
  body: string;
  /** イベントを解決するボタンの文言 */
  action: string;
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

/** 0 以上 TOTAL_WEIGHT 未満の値から 1 つ選ぶ。乱数の消費は呼び出し側が持つ */
export function pickEvent(roll: number): EventDef {
  let acc = 0;
  for (const e of EVENTS) {
    acc += e.weight;
    if (roll < acc) return e;
  }
  return EVENTS[EVENTS.length - 1];
}
