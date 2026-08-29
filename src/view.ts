// 描画層に渡すデータの型。見た目 (文字・色・座標) はここには入れない。
// game.ts はこの型を組み立てるだけで、文字で描くか画像で描くかを知らない。

export type ScreenKind = 'town' | 'dungeon' | 'result';

export interface LogLineView {
  kind: 'info' | 'good' | 'bad' | 'warn';
  text: string;
}

/** 拠点の画面 */
export interface TownView {
  kind: 'town';
  gold: number;
  /** 出撃できる区画。解放済みのものだけが並ぶ */
  sectors: { id: number; name: string; depth: number; unlocked: boolean }[];
}

/** ダンジョンの画面 */
export interface DungeonView {
  kind: 'dungeon';
  sectorName: string;
  depth: number;
  goal: number;
  hp: number;
  maxHp: number;
  /** 通路の奥行き。3D ビューの描き分けに使う */
  corridor: number;
  /** 未解決のイベント。null なら「進む」だけができる */
  event: { title: string; body: string; action: string } | null;
}

/** 出撃の結果 */
export interface ResultView {
  kind: 'result';
  won: boolean;
  depth: number;
  gold: number;
}

// 戦闘の画面はマイルストーン 2 で足す。今はイベントをその場で決着させている
export type ScreenView = TownView | DungeonView | ResultView;

export interface ViewModel {
  screen: ScreenView;
  log: LogLineView[];
  seed: string;
}
