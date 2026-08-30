// 探索中のイベント種別ごとの小さなアイコン (アスキーアート)。
//
// portraits.ts と同じ方針: 将来 <img> に差し替えるだけで済むよう、
// 呼び出し側 (main.ts) は行数・幅を前提にせず、枠のサイズは CSS 側で固定にする。
// 敵の全身像を出す portraits.ts と違い、こちらは「何のイベントか」が一目でわかれば良い
// 小さな記号なので、5 行ぶんの簡素なブロックで揃えてある。
//
// 線には罫線素片 (─ │ ╱ ╲) を使う (render/corridor.ts と同じ理由)。
// `-` `|` `/` `\` は字形が字送りより細く、並べると字の間に隙間が空いて線が
// 途切れて見える。罫線素片は隣の字とつながるように設計されているので、線が線として読める。
// あわせて CSS 側の line-height を 1 にし (style.css の .event-icon-art)、縦線が
// 行の間で途切れないようにしてある。'.' '(' ')' 'o' '=' '#' '~' のような、
// 線ではなく単独の記号として置いている文字は罫線素片に替えていない

const ENEMY = ['  .─.  ', ' (o.o) ', '  │=│  ', ' ╱   ╲ ', '  戦闘  '];

const TREASURE = ['┌──────┐', '│      │', '│~~~~~~│', '└──────┘', '  宝箱  '];

const HEAL = [' ┌───┐ ', ' │   │ ', '│  +  │', ' └───┘ ', '  回復  '];

// 「何も無い」の絵。中身は開くまで分からない (罠が隠れていることもある) が、
// 見た目は最後まで「何も無い」静かな通路のまま変えない
const NOTHING = ['       ', '   .   ', '  . .  ', '   .   ', ' 何も無い'];

const ALLY = ['  .─.  ', ' (o.o) ', '  ╱│╲  ', '  ╱ ╲  ', '  仲間  '];

const BOSS = [' .:*:. ', '(o   o)', ' ╲ ─ ╱ ', ' ╱│─│╲ ', '  ボス  '];

const CARAVAN = ['  ───  ', ' ╱───╲ ', '│o───o│', ' O   O ', '  隊商  '];

const SHRINE = ['┌─────┐', '│     │', '│ [ ] │', '└─────┘', '  祈る  '];

const ROCKFALL = [' *   * ', '  * *  ', ' [###] ', '───────', '  落石  '];

const CORPSE = ['  ───  ', ' (x x) ', '  ╲─╱  ', ' ╱   ╲ ', '  死体  '];

const REST = ['   ^   ', '  ╱│╲  ', ' (   ) ', '~~~~~~~', '  休息  '];

const NAMED: Record<string, readonly string[]> = {
  battle: ENEMY,
  elite: ENEMY,
  treasure: TREASURE,
  spring: HEAL,
  'boss-alt': HEAL,
  nothing: NOTHING,
  recruit: ALLY,
  caravan: CARAVAN,
  shrine: SHRINE,
  rockfall: ROCKFALL,
  corpse: CORPSE,
  rest: REST,
  boss: BOSS,
};

/** イベント種別からアイコン (5 行のアスキーアート) を選ぶ。未知の種別は宝箱にフォールバックする */
export function eventIconFor(kind: string): readonly string[] {
  return NAMED[kind] ?? TREASURE;
}
