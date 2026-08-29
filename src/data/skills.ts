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
  | { kind: 'attack'; target: 'one' | 'all'; power: number }
  /** power は最大 HP に対する割合 */
  | { kind: 'heal'; power: number }
  /** power はターン中の攻撃倍率への加算 */
  | { kind: 'buff'; power: number }
  /** 次に来る敵の攻撃を 1 回無効化する。ダウンも防ぐ */
  | { kind: 'barrier' };

export interface ActionSkillDef {
  id: string;
  name: string;
  category: SkillCategory;
  baseCost: number;
  effect: SkillEffect;
  /** 攻撃の属性。省略すると物理スキルは物理、それ以外は魔法になる */
  element?: Element;
  /** 出撃中 1 回しか使えない */
  oncePerSortie?: boolean;
  /** 発動すると自分がダウンする */
  selfDown?: boolean;
}

export function elementOf(def: ActionSkillDef): Element {
  return def.element ?? (def.category === 'physical' ? 'physical' : 'magic');
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
    /** ガード軽減率への加算。合計は 0.95 で頭打ち。負ならデメリット */
    guardRate?: number;
    /** 敵の大技の予告を延ばすターン数。戦闘開始時に 1 度だけ効く。負ならデメリット */
    telegraph?: number;
    /** ボスの大技のダウンを、前衛にいる限り自動で肩代わりする (先頭の 1 人だけ) */
    cover?: boolean;
  };
}
