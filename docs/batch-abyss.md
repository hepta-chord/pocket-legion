# バッチ 奈落 (クリア後のエンドレス区画) 実装メモ

docs/plan.md「区画と進行」の下にある「奈落 (クリア後のエンドレス区画)」節が正典。
このメモは作業割り当てと初期数値をまとめたもの。

## 進め方の約束

- **新規テストは書かない**。既存テストが落ちたら、仕様変更に合わせる最小修正だけ行う
- **数値はこのメモの初期値をそのまま使い、調整はしない**。調整は sim で計測してから別途行う
- `git add` はパスを明示する。`-A` や `.` は使わない
- SAVE_VERSION を 12 → 13 に上げる (GameState に最深記録が増えて形が変わるため)
- アーキテクチャの掟: game.ts / view.ts は render/ を import しない

## 1. 区画の定義 (data/sectors.ts)

`Sector` に 2 つ足す。

```ts
/** 終わりの無い区画 (奈落)。ボスを倒しても次の 10 階が続く */
endless?: boolean;
/** ボスが出る深度の間隔。endless の区画だけが持つ (奈落は 10) */
bossEvery?: number;
```

- SECTORS に足す: `{ id: 4, name: '奈落', from: 31, depth: 40, endless: true, bossEvery: 10 }`
  (depth は「最初のボスが出る深度」として引き続き使う)
- **ボス深度を返す関数**を sectors.ts に新設する:
  ```ts
  export function bossDepthAt(sector: Sector, depth: number): number
  ```
  通常の区画は `sector.depth` を返す。endless なら
  `depth` 以上で最も近い bossEvery の倍数を返す (31〜40 なら 40、41〜50 なら 50)

## 2. 奈落係数 (data/enemies.ts)

```ts
/**
 * 奈落係数。深度 30 を超えたぶんだけ敵の HP・攻撃力と報酬の金に掛かる。
 * 基礎式 (深度の一次) の上にこの一次が乗るので実質二次で伸び、
 * 主人公以外の成長が頭打ちになった部隊はどこかで必ず壁に当たる
 * (docs/plan.md「奈落」)
 */
export function abyssMul(depth: number): number {
  return depth <= 30 ? 1 : 1 + 0.04 * (depth - 30);
}
```

- `makeFoe` の maxHp / attack に掛ける (既存の elite 倍率とは別に掛ける)
- `makeBoss` の maxHp / attack に掛ける
- 報酬の金 (game.ts の baseGold) にも掛ける。深いほど稼ぎも増えないと、
  潜り続ける動機が「記録」だけになって金の使い道と繋がらないため

## 3. 奈落のボス (data/enemies.ts)

既存の 3 体をローテーションで再登場させる。新造はしない。

- `makeBoss` の署名を `makeBoss(sectorId: number, rng: Rng, depth: number)` に変える
  (呼び出し側は run.depth を渡す)
- spec の選び方:
  - 通常の区画 (id 1〜3): 今までどおり `BOSSES[sectorId - 1]`
  - 奈落 (id 4): `BOSSES[(depth / 10 - 4) % 3]`。
    深度 40 = 穴蜘蛛の女王、50 = 骨の王、60 = 八岐大蛇、70 = また穴蜘蛛…
- 奈落のボスの HP・攻撃は `spec.maxHp * abyssMul(depth)` /
  `spec.attack * abyssMul(depth)` にする。
  **spec の素の値は深層基準 (穴蜘蛛 1200) のままなので、
  奈落の穴蜘蛛は深層の骨の王より弱い個体として出る。** これは意図どおりで、
  10 階ごとの山に強弱の波が出るほうが単調にならない
- downEvery / stunEvery / stunRange は深層と同じ扱い (`bossDownEvery(3)` などに固定) にする
- id は `boss-abyss-${depth}` にして通常のボスと区別する

## 4. 進行 (run.ts)

- `advance` のボス判定を `bossDepthAt(sector, run.depth)` 基準に置き換える。
  ボス前の分岐イベント (回復かレア) も `bossDepthAt(...) - 1` に置く。
  これで奈落でも 39・49・59 階に分岐イベントが出る
- **奈落のボスを倒したあとの分岐**: RunState に足す
  ```ts
  /** 奈落のボスを倒した直後。「潜り続ける」か「帰還する」かを選ぶまで進めない */
  abyssChoice: boolean;
  ```
  startRun では false
- 「潜り続ける」を選んだら `atBoss` を false に戻し、`abyssChoice` も false にして
  次の深度へ進めるようにする。**回復も補給もしない** (docs/plan.md「奈落」)

## 5. ゲーム状態 (game.ts)

- `GameState` に足す:
  ```ts
  /** 到達した最も深い深度。全滅しても更新する (docs/plan.md「奈落」) */
  deepest: number;
  ```
  newGame の初期値は 0。**advance のたびに `Math.max` で更新**する
  (帰還時にだけ更新すると、全滅した回の記録が残らない)
- Action を 2 つ足す:
  ```ts
  /** 奈落のボスを倒したあと「潜り続ける」。回復も補給も無しで次の 10 階に入る */
  | { type: 'abyss-continue' }
  /** 奈落のボスを倒したあと「帰還する」。戦利品を持って拠点に戻る */
  | { type: 'abyss-return' }
  ```
- **ボス撃破時の分岐** (`resolveBattle` の `wasBoss` の枝):
  - 通常の区画: 今までどおり `finishRun(state, true, rng)`
  - 奈落: `finishRun` を呼ばず `run.abyssChoice = true` にして、
    ログに「守護者は沈んだ。さらに潜るか、ここで戻るか」を出す
- **奈落の解放**: 深層 (区画 3) のボスを倒したら `state.unlocked` が 4 になる。
  既存の `state.unlocked < DUNGEONS[0].sectors.length` の判定は
  SECTORS が 4 件になれば自然にそうなる。ログは「奈落への道が開いた。」
- マナ払い出しの成長 (`manaBonus`) は奈落では増やさない。
  今の実装が `run.sectorId === 2` 限定なので、そのままで条件を満たす

## 6. 表示 (view.ts / main.ts)

- `TownView.sectors` の各要素に足す:
  ```ts
  /** 終わりの無い区画か。true なら「B40」ではなく最深記録を出す */
  endless?: boolean;
  /** 最深到達深度 (endless の区画だけ) */
  deepest?: number;
  ```
  探索の一覧には「奈落 (最深 42 階)」の形で出す。未到達 (deepest が区画の from 未満) なら
  「奈落 (未到達)」
- `ExploreView` に `abyssChoice: boolean` を足す。true のときは
  操作クラスタの「進む」の代わりに **「潜り続ける」「帰還する」の 2 つ**を出す
  (イベントの二択と同じ見た目でよい)。ステージには
  「守護者は沈んだ。奈落はまだ続いている。」を出す
- 探索画面の深度表示は、奈落では「40 / 40」のような goal 付きではなく
  **「42 階」だけ**にする (終わりが無いので目標深度を出す意味が無い)。
  ExploreView の `goal` を `number | null` にして、奈落では null を入れる

## 7. sim (sim/autoplay.ts / scripts/balance.ts)

奈落は「どこまで潜れたか」が唯一の指標なので、既存の表とは別に 1 行足す。

- 区画 4 (奈落) を、想定レベル 30・想定所持人数 20 で 300 回まわす
- 出すのは **平均到達深度と最深到達深度**の 2 つ。生還率やボス勝率は出さなくてよい
  (全滅するまで潜り続けるのが前提のため)
- **sim の自動操縦は「常に潜り続ける」**にする。帰還の判断は人間のもので、
  自動化すると閾値の設定次第で数字が動いてしまい、係数の目安として読めなくなるため

## 対象ファイルの目安

src/data/sectors.ts, src/data/enemies.ts, src/run.ts, src/game.ts,
src/view.ts, src/main.ts, src/sim/autoplay.ts, scripts/balance.ts。
既存テスト: run.test.ts / game.test.ts が makeBoss の署名変更・SAVE_VERSION で
落ちるはずなので、仕様に合わせて直す。
