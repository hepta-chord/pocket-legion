# Pocket Legion

文字だけの編成型ダンジョンクローラー。
迷宮都市の拠点で部隊を編成・強化し、マップレスの 3D ビューダンジョンを進み、
ボスを倒して帰還するループを繰り返す。

スマートフォンのブラウザで遊ぶ前提で、GitHub Pages に置いて URL で配る。

企画と仕様は [docs/plan.md](docs/plan.md) にある。

## 今できること

マイルストーン 1 (骨格) まで実装してある。
拠点から出撃し、通路を進んでイベントを解決し、ボスを倒すか全滅して帰るまでが一周する。

戦闘はまだ battle.ts に分かれておらず、その場で被害と稼ぎを確定させる仮の処理になっている。
マナ・スキル・編成はマイルストーン 2 以降で入る。

## 開発

```
npm install
npm run dev      # 開発サーバー
npm test         # テスト
npm run build    # 型検査 + 本番ビルド
```

## 構成

```
src/
  main.ts            起動。Renderer の選択、入力と画面の接続
  game.ts            最上位の状態機械 (拠点 / ダンジョン / 結果)。ViewModel を返す
  view.ts            描画層に渡すデータの型。見た目を含まない
  run.ts             出撃 1 回ぶんの進行 (深度、イベント、HP)
  rng.ts             シード付き乱数
  save.ts            localStorage の保存と復元
  data/
    sectors.ts       区画とボスの深度
    events.ts        イベントの定義と重み
  render/
    renderer.ts      Renderer インターフェース
    corridor.ts      疑似 3D 通路のアスキー生成
    text-renderer.ts Canvas に文字で描く
```

テストは `src/**/*.test.ts` に置く。

`game.ts` と `view.ts` は `render/` を import しない。
見た目をタイル画像に替えたいときは、`Renderer` を実装した `TileRenderer` を `src/render/` に足し、
`src/main.ts` の 1 行を差し替える。

## 公開

`main` に push すると `.github/workflows/pages.yml` がビルドして GitHub Pages に配信する。
リポジトリの Settings → Pages で Source を「GitHub Actions」にしておく。
