// 探索中のイベント種別ごとの小さなアイコン (アスキーアート)。
//
// portraits.ts と同じ方針: 将来 <img> に差し替えるだけで済むよう、
// 呼び出し側 (main.ts) は行数・幅を前提にせず、枠のサイズは CSS 側で固定にする。
// 敵の全身像を出す portraits.ts と違い、こちらは「何のイベントか」が一目でわかれば良い
// 小さな記号なので、5 行ぶんの簡素なブロックで揃えてある。

const ENEMY = ['  .-.  ', ' (o.o) ', '  |=|  ', ' /   \\ ', '  戦闘  '];

const TREASURE = [' ______ ', '|      |', '|~~~~~~|', '|______|', '  宝箱  '];

const HEAL = ['  ___  ', ' /  \\  ', '|  +  | ', ' \\___/ ', '  回復  '];

const TRAP = ['  /\\   ', ' /  \\  ', '/ !! \\ ', '------- ', '   罠   '];

const ALLY = ['  .-.  ', ' (o.o) ', '  /|\\  ', '  / \\  ', '  仲間  '];

const BOSS = [' .:*:. ', '(o   o)', ' \\ - / ', ' /|_|\\ ', '  ボス  '];

const NAMED: Record<string, readonly string[]> = {
  battle: ENEMY,
  elite: ENEMY,
  treasure: TREASURE,
  spring: HEAL,
  'boss-alt': HEAL,
  trap: TRAP,
  recruit: ALLY,
  boss: BOSS,
};

/** イベント種別からアイコン (5 行のアスキーアート) を選ぶ。未知の種別は宝箱にフォールバックする */
export function eventIconFor(kind: string): readonly string[] {
  return NAMED[kind] ?? TREASURE;
}
