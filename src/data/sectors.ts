// 区画の定義。ボスの深度と、そこに至るまでの長さを決める。

export interface Sector {
  id: number;
  name: string;
  /** ボスが出る深度。ここに着くとボス戦になる */
  depth: number;
}

export const SECTORS: readonly Sector[] = [
  { id: 1, name: '浅層', depth: 10 },
  { id: 2, name: '中層', depth: 20 },
  { id: 3, name: '深層', depth: 30 },
];

export function sectorById(id: number): Sector {
  const s = SECTORS.find((x) => x.id === id);
  if (!s) throw new Error(`区画 ${id} は存在しません`);
  return s;
}
