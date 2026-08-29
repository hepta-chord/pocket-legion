# Pocket Legion

文字だけの編成型ダンジョンクローラー。
迷宮都市の拠点で部隊を編成・強化し、マップレスの 3D ビューダンジョンを進み、
ボスを倒して帰還するループを繰り返す。

スマートフォンのブラウザで遊ぶ前提で、GitHub Pages に置いて URL で配る。

企画と仕様は [docs/plan.md](docs/plan.md) にある。

## 今できること

戦闘 UI (マイルストーン 5 の一部) まで実装してある。編成画面と成長系はまだ無い。

- 画面では、拠点から出撃して通路を進み、戦闘・強敵・ボスは battle.ts の実ロジックで戦い、
  宝・泉・罠・加入はその場で即時解決する。勝てば深度なりの金を持ち帰り、
  負ければ (全滅・前衛全滅のどちらでも) その出撃の稼ぎを失って拠点に戻る
- battle.ts に戦闘の純ロジックが入っている。マナ、系統ごとのコスト上昇 (物理はターン内、
  魔法・必殺は出撃を通して)、ガードの重ねがけ、手動交代のクールタイム、
  ダウンと同陣営の自動補充、空きスロットからの全滅、敵の大技の予告、物理・魔法耐性
- 出撃メンバーは `data/characters.ts` の先頭 10 人 (前衛 6 + 控え 4) で固定。
  編成画面と、レベル・陣営倍率による強化はマイルストーン 4 で入る
- `npm run balance` でヘッドレスの自動プレイが回り、区画ごとの生還率と消耗の形が表になる。
  表の読み方は `scripts/balance.ts` の出力末尾に出る

## 開発

```
npm install
npm run dev      # 開発サーバー
npm test         # テスト
npm run build    # 型検査 + 本番ビルド
npm run balance  # 戦闘バランスの計測
```

## 構成

```
src/
  main.ts            起動。Renderer の選択、入力と画面の接続。戦闘の交代 UI もここ
  game.ts            最上位の状態機械 (拠点 / ダンジョン / 戦闘 / 結果)。ViewModel を返す
  view.ts            描画層に渡すデータの型。見た目を含まない
  run.ts             出撃 1 回ぶんの進行 (深度、イベント、パーティ)
  battle.ts          戦闘の状態遷移 (マナ、コスト上昇、ガード、交代、ダウン、耐性)
  rng.ts             シード付き乱数
  save.ts            localStorage の保存と復元
  data/
    characters.ts    本編と sim/ が共有するキャラ定義 (仮プール。本実装はマイルストーン 4)
    enemies.ts       本編と sim/ が共有する敵とボスの生成
    sectors.ts       区画とボスの深度
    events.ts        イベントの定義と重み
    factions.ts      陣営の定義
    skills.ts        スキルの型 (系統とコスト上昇の規則)
  render/
    renderer.ts      Renderer インターフェース
    corridor.ts      疑似 3D 通路のアスキー生成
    text-renderer.ts Canvas に文字で描く
  sim/
    autoplay.ts      ヘッドレスの自動プレイ
    report.ts        結果を表に畳む
scripts/
  balance.ts         バランス計測の入口 (npm run balance)
```

テストは `src/**/*.test.ts` に置く。

`game.ts` と `view.ts` は `render/` を import しない。
見た目をタイル画像に替えたいときは、`Renderer` を実装した `TileRenderer` を `src/render/` に足し、
`src/main.ts` の 1 行を差し替える。

## 公開

`main` に push すると `.github/workflows/pages.yml` がビルドして GitHub Pages に配信する。
リポジトリの Settings → Pages で Source を「GitHub Actions」にしておく。
