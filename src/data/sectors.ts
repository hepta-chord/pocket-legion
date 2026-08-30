// 区画の定義。開始深度とボスの深度で、そこに至るまでの長さを決める。
//
// 中層・深層は浅層の続きからではなく、それぞれの区画の深さから潜り始める
// (浅層 1〜10、中層 11〜20、深層 21〜30)。from を持たずに全区画が深度 1 から
// 始まる作りだと、中層を選んでも浅層と同じ深さを歩き直すだけになり、
// 区画を分けた意味が無くなってしまう (不具合の修正)。

export interface Sector {
  id: number;
  name: string;
  /** 開始深度。ここから潜り始める */
  from: number;
  /** ボスが出る深度。ここに着くとボス戦になる */
  depth: number;
}

export const SECTORS: readonly Sector[] = [
  { id: 1, name: '浅層', from: 1, depth: 10 },
  { id: 2, name: '中層', from: 11, depth: 20 },
  { id: 3, name: '深層', from: 21, depth: 30 },
];

export function sectorById(id: number): Sector {
  const s = SECTORS.find((x) => x.id === id);
  if (!s) throw new Error(`区画 ${id} は存在しません`);
  return s;
}
