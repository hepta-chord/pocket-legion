// 描画層に渡すデータの型。見た目 (文字・色・座標) はここには入れない。

export type ScreenKind = 'town' | 'dungeon' | 'battle' | 'result';

export interface LogLineView {
  kind: 'info' | 'good' | 'bad' | 'warn';
  text: string;
}

/** アクションスキル 1 つぶんの詳細。編成画面の「タップして開く詳細」用 */
export interface SkillDetailView {
  name: string;
  cost: number;
  /** '物理' | '魔法' | '必殺' */
  category: string;
  /** 効果の短文。game.ts 側で文字列化したものをそのまま出す */
  effect: string;
  /** '1回限定' '代償' など。無ければ null */
  note: string | null;
}

/** パッシブスキル 1 つぶんの詳細 */
export interface PassiveDetailView {
  name: string;
  effect: string;
}

/** 酒場・所持一覧・編成で共有する、キャラ 1 人ぶんの表示情報 */
export interface CharacterCardView {
  id: string;
  name: string;
  faction: string;
  /** アクションスキルとパッシブの名前を並べたもの。一覧行の要約に使う */
  skills: string[];
}

/**
 * 編成カードで共有する形。レアリティ・攻撃力・体力 (パーティ最大 HP への寄与) を常に持たせ、
 * 一覧行 (名前・陣営・レアリティ・攻撃力・体力) とタップして開く詳細 (スキル・パッシブ) の
 * 両方を賄う。詳細の効果文はここで文字列として届く (main.ts では組み立てない)
 */
export type FormationCharacterView = CharacterCardView & {
  rarity: 'common' | 'rare';
  attack: number;
  vitality: number;
  skillDetails: SkillDetailView[];
  passiveDetails: PassiveDetailView[];
};

/** 編成の 1 スロットに置かれているキャラ。null は空き */
export interface FormationSlotView {
  character: FormationCharacterView | null;
}

/**
 * 拠点の編成ページ。前衛 6 人を選ぶだけの画面で、控えは絞らない
 * (前衛に選ばれなかった roster 全員が自動で控えになる)。
 * 戦闘画面のキャラスロットと同じ 3 列 × 2 行にするため、slots は長さ 6 で固定にする
 */
export interface FormationEditorView {
  slots: FormationSlotView[];
  /** 編成を一度も触っておらず、roster の先頭から自動で詰めた表示になっているか */
  auto: boolean;
  /** 配置候補 (所持キャラ全員)。placedSlot は今どの前衛スロットにいるか (控えなら null) */
  roster: (FormationCharacterView & { placedSlot: number | null })[];
}

/**
 * ダンジョン内 (戦闘外) の編成。今のデッキ (前衛 + 控え) のうち、前衛 6 枠の中身だけを
 * 並べ替える。新しいキャラは増やせず、ダウン中のキャラは Party から退避済みなので
 * そもそも候補に出てこない
 */
export interface DungeonFormationView {
  slots: FormationSlotView[];
  /** 候補 (今のデッキ全員)。placedSlot は前衛のどこにいるか (控えなら null) */
  roster: (FormationCharacterView & { placedSlot: number | null })[];
}

/** 拠点の画面 */
export interface TownView {
  kind: 'town';
  gold: number;
  potions: number;
  /** 出撃できる区画。解放済みのものだけが並ぶ */
  sectors: { id: number; name: string; depth: number; unlocked: boolean }[];
  /** 酒場の品揃え (コモン 3 人まで)。affordable は所持金で雇えるか */
  tavern: (FormationCharacterView & { price: number; affordable: boolean })[];
  /** 所持キャラの一覧 */
  roster: FormationCharacterView[];
  formation: FormationEditorView;
}

/**
 * ダンジョン画面のイベント。alt があれば二択になる (ボス前の分岐イベント)。
 * kind はアイコン選び専用の分類で、render/ 側 (main.ts が呼ぶ) がここから絵を選ぶ。
 * boss-alt は「回復する」の絵 (回復) にする。ボスの広間だけ EventDef を経ないので 'boss' を持つ
 */
interface DungeonEventView {
  kind: 'battle' | 'elite' | 'treasure' | 'spring' | 'trap' | 'recruit' | 'boss-alt' | 'boss';
  title: string;
  body: string;
  action: string;
  alt?: string;
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
  event: DungeonEventView | null;
  /** キャラスロット (3×2) にそのまま出す、今の前衛 6 枠。タップしても何も起きない表示専用の並び */
  front: FormationSlotView[];
  frontCount: number;
  reserveCount: number;
  downedCount: number;
  potions: number;
  /** ダンジョン内 (戦闘外) の編成ページ用。今のデッキの並べ替えだけができる */
  formation: DungeonFormationView;
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
  /** 積んだ防御の枚数 */
  defense: number;
  defenseMax: number;
  /** バリアが張られているか。あれば次の敵の攻撃 (ダウン攻撃も含む) を 1 回無効化する */
  barrier: boolean;
  turn: number;
  /** 同一ターン内で命中した攻撃の回数。0 は目立たせない表示にする */
  combo: number;
  /** 鼓舞スタック。0 なら支援中でない */
  cheerStacks: number;
  /** ward スタック。0 なら被ダメージ減の支援中でない */
  wardStacks: number;
  /** 逃げるの宣言から発動までの残りターン。null は宣言していない */
  fleeIn: number | null;
  potions: number;
  /** 敵は常に 1 体。対象選択を無くすための仕様なので単数で持つ */
  enemy: {
    name: string;
    /** 元の頭数。2 以上なら群れなので、名前に添えて規模を見せる (例: 魔物の群れ (3)) */
    groupSize: number;
    hp: number;
    maxHp: number;
    /** 表示用。'物理' | '魔法' | null */
    resist: string | null;
    /** 大技まであと何ターンか */
    bigCountdown: number;
    /** ダウン攻撃まであと何ターンか。持たない敵は null */
    downCountdown: number | null;
    alive: boolean;
    isBoss: boolean;
  };
  /** 前衛 6 枠。null は空きスロット */
  slots: ({
    name: string;
    faction: string;
    /** スタンで行動不可になっているか */
    stunned: boolean;
    skills: {
      name: string;
      /** ボタンに出す短縮名。折り返さない前提の 3〜4 文字 */
      shortName: string;
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
  /** 交代ピッカーの候補。編成画面と同じ要約情報を出す (名前・陣営・レアリティ・攻撃力・体力) */
  reserve: FormationCharacterView[];
  swapCooldown: number;
  canDefense: boolean;
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
