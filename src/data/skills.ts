// スキルの型。
//
// 系統 (category) がコスト上昇の規則を決める。
// - physical: 発動するたび、そのターン中コスト +1。ターン終了で戻る
// - magic / ultimate: 発動するたび、その出撃を通してコスト +1。帰還で戻る
//
// つまり物理は「ターン内の連打が高くつく」だけで消耗しないが、
// 魔法と必殺は使うほど確実にすり減る。持ち主の配分は docs/plan.md の指針に従う。

export type SkillCategory = 'physical' | 'magic' | 'ultimate';

/** ダメージの属性。敵の耐性と突き合わせる */
export type Element = 'physical' | 'magic';

export type SkillEffect =
  /**
   * hits は同じ威力のヒットを何回刻むか (省略 = 1)。power は 1 ヒットあたりの倍率で、
   * 例えば 0.5 倍 × 2 回なら power: 0.5, hits: 2 と書く (合計は 1 発ものと同水準に揃える)。
   * 各ヒットは個別にダメージ計算され、その時点のコンボが乗ったうえでコンボを 1 ずつ進める
   * (docs/plan.md「多段攻撃」)
   */
  | { kind: 'attack'; target: 'one' | 'all'; power: number; hits?: number }
  /** power は最大 HP に対する割合 */
  | { kind: 'heal'; power: number }
  /** 鼓舞。攻撃 +20%/枚。stacks は 1 度に積む枚数 (コモンは 1、レアの上位は 2) */
  | { kind: 'cheer'; stacks: number }
  /** ward。被ダメージ -20%/枚。stacks は 1 度に積む枚数 (コモンは 1、レアの上位は 2) */
  | { kind: 'ward'; stacks: number }
  /** 次に来る敵の攻撃系の行動 (attack/big/downstrike) の先頭ヒットだけを無効化する。
   * 行動を丸ごと無効化はしない (docs/plan.md「ダウン攻撃への対抗」) */
  | { kind: 'barrier' }
  /**
   * バフ剥がし。相手の鼓舞・防御 (ward) のスタックを剥がす。
   * 味方が使えば敵の、敵が使えば味方の鼓舞・ward を剥がす「効く相手が使い手の逆側になる」
   * 手段なので、対象は battle.ts 側 (useSkill / applyNormalAction) が呼び出し元で振り分ける。
   * 3 段階を持たせる (docs/plan.md「バフ剥がし」):
   * - scope: 'one' はランダムに 1 スタックだけ (乱し・崩し)。'all' は全部 (浄化)
   * - power があれば、剥がす前にその倍率の物理攻撃を 1 発入れる (崩し。コンボにも乗る)
   */
  | { kind: 'dispel'; scope: 'one' | 'all'; power?: number }
  /**
   * 発動すると自分がその場でスタンする。今回これを持つ味方スキルは無いが、
   * 将来「自分や味方をスタンさせる代償」を持つスキルを作れるよう型だけ用意しておく
   */
  | { kind: 'stun-self' }
  /**
   * マナを増やす (MANA_CAP で頭打ち)。常時効くパッシブ (旧「泉脈」) だと払い出しの律動
   * (奇数 2 / 偶数 3) が崩れるので、コストを払って使うアクションにする。
   * amount はコストを差し引く前の増加量そのもの (例: baseCost 1 で amount 2 なら差し引き +1)。
   * レアだけが持つ (docs/plan.md「スキルスロット」)
   */
  | { kind: 'mana'; amount: number };

export interface ActionSkillDef {
  id: string;
  name: string;
  /** キャラスロットのボタンに出す短縮名 (3〜4 文字程度、折り返さない前提)。詳細やログは name を使う */
  shortName: string;
  category: SkillCategory;
  baseCost: number;
  effect: SkillEffect;
  /** 攻撃の属性。省略すると category 'magic' だけが魔法、それ以外 (physical/ultimate) は物理になる */
  element?: Element;
  /** 出撃中 1 回しか使えない */
  oncePerSortie?: boolean;
  /** 発動すると自分がダウンする */
  selfDown?: boolean;
}

/**
 * 属性が魔法になるのは category 'magic' だけ。必殺 (ultimate) は物理に落とす
 * (docs/plan.md「スキル配分の指針」)。必殺は技の冴えであって魔法ではない、という整理で、
 * 魔法属性のままだと魔法耐性の敵に主人公の切り札まで半減してしまうため。
 * element での個別上書きは残す
 */
export function elementOf(def: ActionSkillDef): Element {
  return def.element ?? (def.category === 'magic' ? 'magic' : 'physical');
}

/**
 * パッシブスキル。前衛にいる間だけ効き、値は同じ項目どうし加算される。
 * ここに無い効果 (同陣営の攻撃 +x% など) は roster 側の実効値計算で扱う。
 */
export interface PassiveDef {
  id: string;
  name: string;
  hooks: {
    /** 毎ターンのマナ払い出しへの加算。負ならデメリット */
    manaPerTurn?: number;
    /** 防御軽減率への加算。合計は 0.95 で頭打ち。負ならデメリット */
    defenseRate?: number;
    /** 敵の大技の予告を延ばすターン数。戦闘開始時に 1 度だけ効く。負ならデメリット */
    telegraph?: number;
    /** ボスの大技のダウンを、前衛にいる限り自動で肩代わりする (先頭の 1 人だけ) */
    cover?: boolean;
    /** 戦闘勝利時の獲得金への倍率加算 (商才)。前衛の合計を 1 に足して掛ける (端数は round) */
    goldRate?: number;
  };
}
