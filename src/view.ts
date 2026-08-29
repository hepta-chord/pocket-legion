// 描画層に渡すデータの型。見た目 (文字・色・座標) はここには入れない。

export type ScreenKind = 'town' | 'dungeon' | 'battle' | 'result';

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

/**
 * 戦闘の画面。
 * UI がゲームのルールを再計算しなくて済むよう、判断に要るものを全部詰めてある
 * (使えるかどうかの判定は whyCannotUse の結果をそのまま持つ)。
 */
export interface BattleView {
  kind: 'battle';
  hp: number;
  maxHp: number;
  mana: number;
  manaCap: number;
  guard: number;
  guardMax: number;
  turn: number;
  /** 選択中の敵 */
  target: number;
  enemies: {
    name: string;
    hp: number;
    maxHp: number;
    /** 表示用。'物理' | '魔法' | null */
    resist: string | null;
    /** 大技まであと何ターンか */
    countdown: number;
    alive: boolean;
  }[];
  /** 前衛 6 枠。null は空きスロット */
  slots: ({
    name: string;
    faction: string;
    skills: {
      name: string;
      cost: number;
      /** 素のコストから上がっているぶん。0 なら上昇していない */
      raised: number;
      usable: boolean;
      /** 使えない理由。usable が true なら null */
      reason: string | null;
      /** '1回限定' '代償' など、札の性格を示す短い注記。無ければ null */
      note: string | null;
    }[];
  } | null)[];
  reserve: { id: string; name: string; faction: string }[];
  swapCooldown: number;
  canGuard: boolean;
}

/** 出撃の結果 */
export interface ResultView {
  kind: 'result';
  won: boolean;
  depth: number;
  gold: number;
}

export type ScreenView = TownView | DungeonView | BattleView | ResultView;

export interface ViewModel {
  screen: ScreenView;
  log: LogLineView[];
  seed: string;
}
