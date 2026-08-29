# Pocket Legion

文字だけの編成型ダンジョンクローラー。
迷宮都市の拠点で部隊を編成・強化し、マップレスの 3D ビューダンジョンを進み、
ボスを倒して帰還するループを繰り返す。

スマートフォンのブラウザで遊ぶ前提で、GitHub Pages に置いて URL で配る。

企画と仕様は [docs/plan.md](docs/plan.md) にある。

## 今できること

マイルストーン 2 (戦闘コア) まで実装してある。

- 画面では、拠点から出撃して通路を進み、イベントを解決してボスか全滅で帰るまでが一周する。
  画面上の戦闘はまだ仮の即時決着で、battle.ts はマイルストーン 5 の UI でつながる
- battle.ts に戦闘の純ロジックが入っている。マナ、系統ごとのコスト上昇 (物理はターン内、
  魔法・必殺は出撃を通して)、ガードの重ねがけ、手動交代のクールタイム、
  ダウンと同陣営の自動補充、空きスロットからの全滅、敵の大技の予告、物理・魔法耐性
- `npm run balance` でヘッドレスの自動プレイが回り、区画ごとの生還率と消耗の形が表になる

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
  main.ts            起動。Renderer の選択、入力と画面の接続
  game.ts            最上位の状態機械 (拠点 / ダンジョン / 結果)。ViewModel を返す
  view.ts            描画層に渡すデータの型。見た目を含まない
  run.ts             出撃 1 回ぶんの進行 (深度、イベント、HP)
  battle.ts          戦闘の状態遷移 (マナ、コスト上昇、ガード、交代、ダウン、耐性)
  rng.ts             シード付き乱数
  save.ts            localStorage の保存と復元
  data/
    sectors.ts       区画とボスの深度
    events.ts        イベントの定義と重み
    factions.ts      陣営の定義
    skills.ts        スキルの型 (系統とコスト上昇の規則)
  render/
    renderer.ts      Renderer インターフェース
    corridor.ts      疑似 3D 通路のアスキー生成
    text-renderer.ts Canvas に文字で描く
  sim/
    pool.ts          計測用の仮キャラプール (本編のキャラ定義は別に入る)
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
