// 本編とバランス計測 (sim/) が共有するキャラ定義。
//
// 世界設定: 主力は物理で、魔法使いは希少である。
// 0 コストの通常攻撃はレア (熟練者) だけが持つ。コモンは 1 コスト通常攻撃か
// 2 コスト強攻撃のどちらかで戦う。前衛の大半は物理スキルの手数で戦い、
// 魔法と必殺は一撃が明確に強い代わりに使うたび出撃を通してコストが上がる
// 「切りどころを選ぶ札」になる。
//
// コモンとレアはどちらもここに名簿を持たない (data/common-gen.ts でその場ごとに生成する)。
// ここに残るのは固定の 3 人 (主人公コーモン・相棒スケサンとカクサン) だけで、
// rarity は 'named' という別格の扱いにする (docs/plan.md「初期の 2 人」)。
// ネームドは酒場に出ず、雇用上限にも数えず、転生もできない。
//
// レベル・成長カーブ (growth.ts) は個体ごとに持つ。CHARACTERS の要素はあくまで
// 「定義」の共有オブジェクトなので、所持に積むときは instantiate() で必ずコピーを作り、
// レベルアップが他のセーブ・他のプレイへ漏れないようにする。

import { makeSkillState, type Fighter } from '../battle';
import type { Faction } from '../data/factions';
import type { ActionSkillDef, PassiveDef } from '../data/skills';
import { effectiveStat, type Curve } from '../growth';

/** レアの 0 コスト通常攻撃。タダでコンボを起点にできるのがレアの価値になる。主人公だけがここで使う
 * (コモン・レアの生成分は common-gen.ts の rareSlash が同じ形を持つ) */
const zeroAttack = (id: string, name = '斬撃', shortName = '斬撃'): ActionSkillDef => ({
  id,
  name,
  shortName,
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'attack', target: 'one', power: 1.0 },
});

/**
 * 主人公の必殺。他の必殺より高倍率の単発にして、必殺の最上位に置く
 * (docs/plan.md「スキル配分の指針」)。必殺は物理属性に落ちる (elementOf) ので、
 * 魔法耐性の敵にも半減されない
 */
const heroFinish: ActionSkillDef = {
  id: 'hero-finish',
  name: 'インロー',
  shortName: 'インロー',
  category: 'ultimate',
  baseCost: 3,
  effect: { kind: 'attack', target: 'one', power: 3.0 },
};

/** 相棒の攻撃魔法。希少な魔法の入口として、一撃は主人公の斬撃より重い */
const mateBolt: ActionSkillDef = {
  id: 'mate-bolt',
  name: '攻撃魔法',
  shortName: '魔法',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 2.0 },
};

/** 相棒のヒーリング。道中の HP 管理を安く支える */
const mateHeal: ActionSkillDef = {
  id: 'mate-heal',
  name: 'ヒーリング',
  shortName: '回復',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'heal', power: 0.3 },
};

/**
 * もう 1 人の相棒 (カクサン) のバフ剥がし。解除の 3 段階のうち最上位「浄化」(2 コスト・全部剥がす)
 * を持つ (docs/plan.md「バフ剥がし」)。物理と同じコスト規則 (ターン内 +1 で頭打ち) にする
 */
const purge: ActionSkillDef = {
  id: 'purge',
  name: '浄化',
  shortName: '浄化',
  category: 'physical',
  baseCost: 2,
  effect: { kind: 'dispel', scope: 'all' },
};

/** カクサンのガード 1 枚積み。common-gen.ts の ward1 と同じ定義だが、生成コモンとは
 * 独立した固定キャラなので、ここでも別オブジェクトとして持つ (id は共有してよい) */
const aideWard: ActionSkillDef = {
  id: 'ward1',
  name: 'ガード',
  shortName: 'ガード',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'ward', stacks: 1 },
};

export interface CharacterEntry {
  id: string;
  name: string;
  faction: Faction;
  /**
   * 'named' は固定の 3 人 (主人公・相棒 2 人) だけが持つ別格のレアリティ。
   * 酒場に出ず、雇用上限にも数えず、転生所でも扱えない (docs/plan.md「初期の 2 人」「転生所」)
   */
  rarity: 'common' | 'rare' | 'named';
  /** レベル 1 のときの攻撃力。実効値 (レベルなり) は effectiveAttack で計算する */
  baseAttack: number;
  /** レベル 1 のときの体力。実効値は effectiveVitality で計算する */
  baseVitality: number;
  skills: ActionSkillDef[];
  passives: PassiveDef[];
  /** 現在レベル。初期値 1 */
  level: number;
  /** 現在の経験値 */
  exp: number;
  /**
   * レベル上限。個体ごとに振る (docs/batch-growth.md 補足)。コモンは 16〜24、レアはそれより高く、
   * 主人公だけは上限が無い代わりに大きな値 (999) を入れる
   */
  maxLevel: number;
  /**
   * 成長の補正値 (マスクパラメータ)。上限到達時の伸び幅 (base * (1 + growth)) を決める。
   * growth と maxLevel は個体ごとに違う値を持たせ、育ち切った到達値が全員同じにならないようにする
   */
  growth: number;
  /** 成長カーブの型 (マスクパラメータ)。ViewModel には出さない */
  curve: Curve;
  /** カーブを正規化する基準レベル。上限の無いキャラだけが持つ (growth.ts を参照) */
  curveRef?: number;
}

/** 現在レベルでの実効攻撃力 */
export function effectiveAttack(entry: CharacterEntry): number {
  return effectiveStat(entry.baseAttack, entry);
}

/** 現在レベルでの実効体力 (パーティ最大 HP への寄与) */
export function effectiveVitality(entry: CharacterEntry): number {
  return effectiveStat(entry.baseVitality, entry);
}

/**
 * CHARACTERS (固定の主人公・相棒) は module 単位の共有オブジェクトなので、
 * そのまま owned に積んでレベルを書き込むと、他のセーブ・他のプレイにまで伸びてしまう。
 * 所持に移すときは必ずこれを通し、独立したコピー (レベル 1・経験値 0 の新品) にする
 */
export function instantiate(entry: CharacterEntry): CharacterEntry {
  return { ...entry, level: 1, exp: 0 };
}

/** 酒場・テスト・sim/ 計測で「このレベルから始まる個体」を作る。上限は超えない */
export function withLevel(entry: CharacterEntry, level: number): CharacterEntry {
  return { ...entry, level: Math.max(1, Math.min(level, entry.maxLevel)), exp: 0 };
}

/** 酒場・所持一覧に出す短いスキル注記。アクション名とパッシブ名を並べる */
export function skillLabels(entry: CharacterEntry): string[] {
  return [...entry.skills.map((s) => s.name), ...entry.passives.map((p) => p.name)];
}

export const CHARACTERS: readonly CharacterEntry[] = [
  // 固定の 3 人。所持から外れない (roster の初期値に固定で入る)。名前も固定にする
  // (docs/plan.md「初期の 2 人」。主人公 = コーモン、相棒 = スケサンとカクサン)。
  // rarity は 'named' (酒場に出ない・雇用上限に数えない・転生不可)
  {
    id: 'hero',
    name: 'コーモン',
    // 辺境に置く。0 コストの斬撃と必殺という構成が辺境の得意系統 (必殺と代償) に合い、
    // 人口の最も少ない陣営なので、陣営倍率を主人公の側から伸ばすのが難しくなる。
    // レベル上限が無い代わりに倍率で伸びにくい、という釣り合いになる
    faction: 'frontier',
    rarity: 'named',
    baseAttack: 120,
    baseVitality: 60,
    skills: [zeroAttack('hero-slash'), heroFinish],
    passives: [],
    level: 1,
    exp: 0,
    // 上限なしの代わりに大きな値 (999) を入れる。晩成型にして、
    // 「長く遊ぶほど主人公が部隊の芯になる」を数値でも表す
    maxLevel: 999,
    growth: 1.5,
    curve: 'late',
    // 上限が無いぶん、カーブは 30 レベルを 1 周ぶんとして数える。
    // maxLevel を基準にすると進捗がいつまでも 0 に近く、まったく育たない
    curveRef: 30,
  },
  {
    id: 'mate',
    name: 'スケサン',
    faction: 'order',
    // 攻撃魔法とヒーリングを併せ持つ、教団の顔にふさわしい構成なのでネームド扱いにする
    // (docs/plan.md「初期の 3 人」)。スキルと数値そのものは変えない
    rarity: 'named',
    baseAttack: 90,
    baseVitality: 60,
    skills: [mateBolt, mateHeal],
    passives: [],
    level: 1,
    exp: 0,
    // レアの帯 (growth 1.0〜1.5 / maxLevel 30〜40) に収める
    maxLevel: 30,
    growth: 1.0,
    // 早熟型。安いヒーリングで序盤から支える相棒の役回りに合わせる
    curve: 'early',
  },
  {
    id: 'aide2',
    name: 'カクサン',
    // 傭兵団に置く。バフ剥がしが無いと自分を固め続けるボスに手が無くなるので、
    // 陣営を問わず最初から持たせる (docs/plan.md「初期の 2 人」「バフ剥がし」)
    faction: 'mercs',
    rarity: 'named',
    // 攻撃力・体力はコモンの壁役と同程度でよい (common-gen.ts BASE_STATS.wall と揃える)
    baseAttack: 75,
    baseVitality: 90,
    skills: [purge, aideWard],
    passives: [],
    level: 1,
    exp: 0,
    maxLevel: 30,
    growth: 1.0,
    curve: 'linear',
  },
];

/**
 * factionMul は所持ベースの陣営倍率 (roster.ts の factionMultiplierOf)。省略時は 1 倍
 * (テストや、まだ所持と紐付いていない簡易な呼び出しのための既定値)。
 * 戦闘中に変わらない値なのでここで Fighter.attack/vitality に直接焼き込む。
 * 前衛の同陣営補正 (vanguardMul) は別物で、戦闘の中で変わるので焼き込まず battle.ts 側に持つ
 */
export function buildFighter(entry: CharacterEntry, factionMul = 1): Fighter {
  return {
    id: entry.id,
    name: entry.name,
    faction: entry.faction,
    attack: Math.round(effectiveAttack(entry) * factionMul),
    vitality: Math.round(effectiveVitality(entry) * factionMul),
    skills: entry.skills.map(makeSkillState),
    passives: entry.passives,
    downed: false,
    stunnedUntil: 0,
    vanguardMul: 1,
  };
}
