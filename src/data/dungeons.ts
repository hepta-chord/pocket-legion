// 迷宮の定義。
//
// 「1 本のダンジョンの 3 区画」だった sectors.ts を、
// 「複数の迷宮があり、それぞれに区画 (深度とボス) がある」という形に読み替えられるよう、
// 迷宮を束ねる 1 段をここに置く。今は迷宮 1 本 (SECTORS の 3 区画) だけだが、
// 迷宮を増やすときは DUNGEONS に要素を足すだけで済む形にしておく。

import { SECTORS, type Sector } from './sectors';

export interface Dungeon {
  id: number;
  name: string;
  sectors: readonly Sector[];
}

export const DUNGEONS: readonly Dungeon[] = [{ id: 1, name: '迷宮都市の大穴', sectors: SECTORS }];

export function dungeonById(id: number): Dungeon {
  const d = DUNGEONS.find((x) => x.id === id);
  if (!d) throw new Error(`迷宮 ${id} は存在しません`);
  return d;
}
