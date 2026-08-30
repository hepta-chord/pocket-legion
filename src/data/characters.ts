// 本編とバランス計測 (sim/) が共有するキャラ定義。
//
// 世界設定: 主力は物理で、魔法使いは希少である。
// 0 コストの通常攻撃はレア (熟練者) だけが持つ。コモンは 1 コスト通常攻撃か
// 2 コスト強攻撃のどちらかで戦う。前衛の大半は物理スキルの手数で戦い、
// 魔法と必殺は一撃が明確に強い代わりに使うたび出撃を通してコストが上がる
// 「切りどころを選ぶ札」になる。
//
// コモンはここに名簿を持たない (data/common-gen.ts でその場ごとに生成する)。
// ここに残るのは固定で定義するキャラ: 初期の 2 人 (主人公・相棒) と、
// レア 4 人 (0 コスト通常攻撃を持つ熟練者。スキル構成もパラメータも固定)。
//
// レベル・成長カーブ (growth.ts) は個体ごとに持つ。CHARACTERS の要素はあくまで
// 「定義」の共有オブジェクトなので、所持に積むときは instantiate() で必ずコピーを作り、
// レベルアップが他のセーブ・他のプレイへ漏れないようにする。
// 陣営倍率 (同陣営の所持で全員が底上げされる仕組み) はまだ後回し (マイルストーン 5 の残り)。

import { makeSkillState, type Fighter } from '../battle';
import type { Faction } from '../data/factions';
import type { ActionSkillDef, PassiveDef } from '../data/skills';
import { effectiveStat, type Curve } from '../growth';

/** レアの 0 コスト通常攻撃。タダでコンボを起点にできるのがレアの価値になる */
const zeroAttack = (id: string, name = '斬撃', shortName = '斬撃'): ActionSkillDef => ({
  id,
  name,
  shortName,
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'attack', target: 'one', power: 1.0 },
});

/** 鼓舞を一度に 2 枚積む。レアの支援役が持つ上位版 */
const cheer2: ActionSkillDef = {
  id: 'cheer2',
  name: '大鼓舞',
  shortName: '大鼓舞',
  category: 'physical',
  baseCost: 2,
  effect: { kind: 'cheer', stacks: 2 },
};

/** ward を一度に 2 枚積む。レアの壁役が持つ上位版 */
const ward2: ActionSkillDef = {
  id: 'ward2',
  name: '鉄壁',
  shortName: '鉄壁',
  category: 'physical',
  baseCost: 2,
  effect: { kind: 'ward', stacks: 2 },
};

const lastStand: ActionSkillDef = {
  id: 'last-stand',
  name: '捨て身',
  shortName: '捨身',
  category: 'ultimate',
  baseCost: 2,
  effect: { kind: 'attack', target: 'one', power: 3.0 },
  selfDown: true,
};

const greatBlade: ActionSkillDef = {
  id: 'great-blade',
  name: '大剣',
  shortName: '大剣',
  category: 'ultimate',
  baseCost: 4,
  effect: { kind: 'attack', target: 'one', power: 3.5 },
  element: 'physical',
};

/** 主人公の必殺。浅層の最初の雑魚なら一撃で沈む威力にしてある */
const heroFinish: ActionSkillDef = {
  id: 'hero-finish',
  name: '必殺・断',
  shortName: '必殺',
  category: 'ultimate',
  baseCost: 3,
  effect: { kind: 'attack', target: 'one', power: 2.8 },
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

export interface CharacterEntry {
  id: string;
  name: string;
  faction: Faction;
  rarity: 'common' | 'rare';
  /** レベル 1 のときの攻撃力。実効値 (レベルなり) は effectiveAttack で計算する */
  baseAttack: number;
  /** レベル 1 のときの体力。実効値は effectiveVitality で計算する */
  baseVitality: number;
  skills: ActionSkillDef[];
  passives: PassiveDef[];
  /**
   * レアの入手経路。'tavern' は酒場だけに、'dungeon' はボス前の分岐イベントだけに並ぶ
   * (docs/plan.md「レアリティと入手」)。コモン (生成キャラ) と主人公・相棒は持たない
   */
  source?: 'tavern' | 'dungeon';
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
 * CHARACTERS (固定の主人公・相棒・レア) は module 単位の共有オブジェクトなので、
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
  // 初期の 2 人。所持から外れない (roster の初期値に固定で入る)
  {
    id: 'hero',
    name: '主人公',
    // 辺境に置く。0 コストの斬撃と必殺という構成が辺境の得意系統 (必殺と代償) に合い、
    // 人口の最も少ない陣営なので、陣営倍率を主人公の側から伸ばすのが難しくなる。
    // レベル上限が無い代わりに倍率で伸びにくい、という釣り合いになる
    faction: 'frontier',
    rarity: 'rare',
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
  },
  {
    id: 'mate',
    name: '相棒',
    faction: 'order',
    rarity: 'common',
    baseAttack: 90,
    baseVitality: 60,
    skills: [mateBolt, mateHeal],
    passives: [],
    level: 1,
    exp: 0,
    maxLevel: 22,
    growth: 0.6,
    // 早熟型。安いヒーリングで序盤から支える相棒の役回りに合わせる
    curve: 'early',
  },

  // レア 4 人。0 コスト攻撃を軸に、基礎値か有能なスキルで差をつける。陣営は散らす。
  // 4 人を 2 人ずつ酒場限定/ダンジョン限定に分ける (docs/plan.md「レアリティと入手」)。
  // スキル構成とパラメータは分岐前のまま変えていない
  {
    id: 'r1',
    name: '熟練剣士',
    faction: 'kingdom',
    rarity: 'rare',
    baseAttack: 140,
    baseVitality: 60,
    skills: [zeroAttack('r1-slash'), greatBlade],
    passives: [],
    source: 'tavern',
    level: 1,
    exp: 0,
    maxLevel: 32,
    growth: 1.0,
    curve: 'linear',
  },
  {
    id: 'r2',
    name: '教団の賢者',
    faction: 'order',
    rarity: 'rare',
    baseAttack: 130,
    baseVitality: 50,
    // 教団 (回復・支援) の顔として、レアの支援役 = 鼓舞 2 枚積みを持たせる
    skills: [zeroAttack('r2-slash', '一閃', '一閃'), cheer2],
    passives: [],
    source: 'dungeon',
    level: 1,
    exp: 0,
    maxLevel: 34,
    growth: 0.9,
    curve: 'early',
  },
  {
    id: 'r3',
    name: '傭兵の豪傑',
    faction: 'mercs',
    rarity: 'rare',
    baseAttack: 135,
    baseVitality: 70,
    // 傭兵団 (ガード・体力・身代わり) の顔として、レアの壁役 = ward 2 枚積みを持たせる
    skills: [zeroAttack('r3-slash', '双撃', '双撃'), ward2],
    passives: [],
    source: 'tavern',
    level: 1,
    exp: 0,
    maxLevel: 30,
    growth: 1.1,
    curve: 'linear',
  },
  {
    id: 'r4',
    name: '辺境の捨て身剣士',
    faction: 'frontier',
    rarity: 'rare',
    baseAttack: 150,
    baseVitality: 40,
    skills: [zeroAttack('r4-slash'), lastStand],
    passives: [],
    source: 'dungeon',
    level: 1,
    exp: 0,
    maxLevel: 36,
    growth: 1.2,
    curve: 'late',
  },
];

export function buildFighter(entry: CharacterEntry): Fighter {
  return {
    id: entry.id,
    name: entry.name,
    faction: entry.faction,
    attack: effectiveAttack(entry),
    vitality: effectiveVitality(entry),
    skills: entry.skills.map(makeSkillState),
    passives: entry.passives,
    downed: false,
    stunnedUntil: 0,
  };
}
