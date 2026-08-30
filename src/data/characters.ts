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
// レベル・陣営倍率を備えた成長系は v1 後回し (マイルストーン 5 の残り)。

import { makeSkillState, type Fighter } from '../battle';
import type { Faction } from '../data/factions';
import type { ActionSkillDef, PassiveDef } from '../data/skills';

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
  /** 酒場の雇用額。レアは酒場に並ばないことがあるが、表示や将来の入手経路のため 0 でない値を持たせる */
  price: number;
  attack: number;
  vitality: number;
  skills: ActionSkillDef[];
  passives: PassiveDef[];
  /**
   * レアの入手経路。'tavern' は酒場だけに、'dungeon' はボス前の分岐イベントだけに並ぶ
   * (docs/plan.md「レアリティと入手」)。コモン (生成キャラ) と主人公・相棒は持たない
   */
  source?: 'tavern' | 'dungeon';
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
    faction: 'kingdom',
    rarity: 'rare',
    price: 400,
    attack: 120,
    vitality: 60,
    skills: [zeroAttack('hero-slash'), heroFinish],
    passives: [],
  },
  {
    id: 'mate',
    name: '相棒',
    faction: 'order',
    rarity: 'common',
    price: 120,
    attack: 90,
    vitality: 60,
    skills: [mateBolt, mateHeal],
    passives: [],
  },

  // レア 4 人。0 コスト攻撃を軸に、基礎値か有能なスキルで差をつける。陣営は散らす。
  // 4 人を 2 人ずつ酒場限定/ダンジョン限定に分ける (docs/plan.md「レアリティと入手」)。
  // スキル構成とパラメータは分岐前のまま変えていない
  {
    id: 'r1',
    name: '熟練剣士',
    faction: 'kingdom',
    rarity: 'rare',
    price: 400,
    attack: 140,
    vitality: 60,
    skills: [zeroAttack('r1-slash'), greatBlade],
    passives: [],
    source: 'tavern',
  },
  {
    id: 'r2',
    name: '教団の賢者',
    faction: 'order',
    rarity: 'rare',
    price: 400,
    attack: 130,
    vitality: 50,
    // 教団 (回復・支援) の顔として、レアの支援役 = 鼓舞 2 枚積みを持たせる
    skills: [zeroAttack('r2-slash', '一閃', '一閃'), cheer2],
    passives: [],
    source: 'dungeon',
  },
  {
    id: 'r3',
    name: '傭兵の豪傑',
    faction: 'mercs',
    rarity: 'rare',
    price: 400,
    attack: 135,
    vitality: 70,
    // 傭兵団 (ガード・体力・身代わり) の顔として、レアの壁役 = ward 2 枚積みを持たせる
    skills: [zeroAttack('r3-slash', '双撃', '双撃'), ward2],
    passives: [],
    source: 'tavern',
  },
  {
    id: 'r4',
    name: '辺境の捨て身剣士',
    faction: 'frontier',
    rarity: 'rare',
    price: 400,
    attack: 150,
    vitality: 40,
    skills: [zeroAttack('r4-slash'), lastStand],
    passives: [],
    source: 'dungeon',
  },
];

export function buildFighter(entry: CharacterEntry): Fighter {
  return {
    id: entry.id,
    name: entry.name,
    faction: entry.faction,
    attack: entry.attack,
    vitality: entry.vitality,
    skills: entry.skills.map(makeSkillState),
    passives: entry.passives,
    downed: false,
    stunnedUntil: 0,
  };
}
