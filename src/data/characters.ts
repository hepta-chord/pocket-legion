// 本編とバランス計測 (sim/) が共有するキャラ定義。
//
// 世界設定: 主力は物理で、魔法使いは希少である。
// 0 コストの通常攻撃はレア (熟練者) だけが持つ。コモンは 1 コストの通常攻撃か
// 2 コストの強攻撃のどちらかで戦う。前衛の大半は物理スキルの手数で戦い、
// 魔法と必殺は一撃が明確に強い代わりに使うたび出撃を通してコストが上がる
// 「切りどころを選ぶ札」になる。
// レベル・陣営倍率を備えた成長系は v1 後回し (マイルストーン 5 の残り)。

import { makeSkillState, type Fighter } from '../battle';
import type { Faction } from '../data/factions';
import type { ActionSkillDef, PassiveDef } from '../data/skills';

/** レアの 0 コスト通常攻撃。タダでコンボを起点にできるのがレアの価値になる */
const zeroAttack = (id: string, name = '斬撃'): ActionSkillDef => ({
  id,
  name,
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'attack', target: 'one', power: 1.0 },
});

/** コモンの通常攻撃。1 コスト */
const commonAttack = (id: string): ActionSkillDef => ({
  id,
  name: '通常攻撃',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 1.0 },
});

/** コモンの強攻撃。2 コストぶん一撃は重い */
const heavyAttack = (id: string): ActionSkillDef => ({
  id,
  name: '強攻撃',
  category: 'physical',
  baseCost: 2,
  effect: { kind: 'attack', target: 'one', power: 1.8 },
});

const sweep: ActionSkillDef = {
  id: 'sweep',
  name: '薙ぎ払い',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'attack', target: 'all', power: 0.8 },
};

// 魔法は希少なぶん、物理の連打より一撃をはっきり強くする。
// 出撃を通したコスト上昇を払ってでも使いたい威力が無いと、札として死ぬため
const holyBolt: ActionSkillDef = {
  id: 'holy-bolt',
  name: '光弾',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 2.0 },
};

const pray: ActionSkillDef = {
  id: 'pray',
  name: '祈り',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'heal', power: 0.4 },
};

const cheer: ActionSkillDef = {
  id: 'cheer',
  name: '鼓舞',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'buff', power: 0.4 },
};

const barrier: ActionSkillDef = {
  id: 'barrier',
  name: '守りの膜',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'barrier' },
};

const greatBlade: ActionSkillDef = {
  id: 'great-blade',
  name: '大剣',
  category: 'ultimate',
  baseCost: 4,
  effect: { kind: 'attack', target: 'one', power: 3.5 },
  element: 'physical',
};

const lastStand: ActionSkillDef = {
  id: 'last-stand',
  name: '捨て身',
  category: 'ultimate',
  baseCost: 2,
  effect: { kind: 'attack', target: 'one', power: 3.0 },
  selfDown: true,
};

const finale: ActionSkillDef = {
  id: 'finale',
  name: '終の一撃',
  category: 'ultimate',
  baseCost: 5,
  effect: { kind: 'attack', target: 'all', power: 5.0 },
  oncePerSortie: true,
};

/** 主人公の必殺。浅層の最初の雑魚なら一撃で沈む威力にしてある */
const heroFinish: ActionSkillDef = {
  id: 'hero-finish',
  name: '必殺・断',
  category: 'ultimate',
  baseCost: 3,
  effect: { kind: 'attack', target: 'one', power: 2.8 },
};

/** 相棒の攻撃魔法。希少な魔法の入口として、一撃は主人公の斬撃より重い */
const mateBolt: ActionSkillDef = {
  id: 'mate-bolt',
  name: '攻撃魔法',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 2.0 },
};

/** 相棒のヒーリング。道中の HP 管理を安く支える */
const mateHeal: ActionSkillDef = {
  id: 'mate-heal',
  name: 'ヒーリング',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'heal', power: 0.3 },
};

const spring: PassiveDef = { id: 'spring', name: '泉脈', hooks: { manaPerTurn: 1 } };
const wall: PassiveDef = { id: 'wall', name: '盾構え', hooks: { guardRate: 0.1 } };
const scout: PassiveDef = { id: 'scout', name: '斥候', hooks: { telegraph: 1 } };
const bodyguard: PassiveDef = { id: 'bodyguard', name: '身代わり', hooks: { cover: true } };

export interface CharacterEntry {
  id: string;
  name: string;
  faction: Faction;
  rarity: 'common' | 'rare';
  /** 酒場の雇用額。レアは酒場に並ばないが、表示や将来の入手経路のため 0 でない値を持たせる */
  price: number;
  attack: number;
  vitality: number;
  skills: ActionSkillDef[];
  passives: PassiveDef[];
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

  // 王国の戦士 3 人。通常攻撃/強攻撃が主体で、1 人だけがパッシブを併せ持つ
  {
    id: 'k1',
    name: '王国兵士',
    faction: 'kingdom',
    rarity: 'common',
    price: 120,
    attack: 110,
    vitality: 50,
    skills: [commonAttack('k1-attack'), heavyAttack('k1-heavy')],
    passives: [],
  },
  {
    id: 'k2',
    name: '王国衛士',
    faction: 'kingdom',
    rarity: 'common',
    price: 120,
    attack: 100,
    vitality: 50,
    skills: [commonAttack('k2-attack')],
    passives: [spring],
  },
  {
    id: 'k3',
    name: '王国剣士',
    faction: 'kingdom',
    rarity: 'common',
    price: 120,
    attack: 100,
    vitality: 40,
    skills: [heavyAttack('k3-heavy'), commonAttack('k3-attack')],
    passives: [],
  },

  // 教団 3 人。祈り・光弾・鼓舞・バリアを分担する
  {
    id: 'o1',
    name: '教団の司祭',
    faction: 'order',
    rarity: 'common',
    price: 120,
    attack: 80,
    vitality: 50,
    skills: [pray, cheer],
    passives: [],
  },
  {
    id: 'o2',
    name: '教団の見習い',
    faction: 'order',
    rarity: 'common',
    price: 120,
    attack: 80,
    vitality: 50,
    skills: [holyBolt],
    passives: [scout],
  },
  {
    id: 'o3',
    name: '教団の守り手',
    faction: 'order',
    rarity: 'common',
    price: 120,
    attack: 70,
    vitality: 60,
    skills: [barrier],
    passives: [wall],
  },

  // 傭兵団 2 人。身代わり持ちと盾構え持ち
  {
    id: 'm1',
    name: '傭兵の身代わり役',
    faction: 'mercs',
    rarity: 'common',
    price: 120,
    attack: 90,
    vitality: 100,
    skills: [commonAttack('m1-attack')],
    passives: [bodyguard],
  },
  {
    id: 'm2',
    name: '傭兵の盾役',
    faction: 'mercs',
    rarity: 'common',
    price: 120,
    attack: 90,
    vitality: 90,
    skills: [heavyAttack('m2-heavy')],
    passives: [wall],
  },

  // レア 4 人。0 コスト攻撃を軸に、基礎値か有能なスキルで差をつける。陣営は散らす
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
  },
  {
    id: 'r2',
    name: '教団の賢者',
    faction: 'order',
    rarity: 'rare',
    price: 400,
    attack: 130,
    vitality: 50,
    skills: [zeroAttack('r2-slash', '一閃'), finale],
    passives: [],
  },
  {
    id: 'r3',
    name: '傭兵の豪傑',
    faction: 'mercs',
    rarity: 'rare',
    price: 400,
    attack: 135,
    vitality: 70,
    skills: [zeroAttack('r3-slash', '双撃'), sweep],
    passives: [],
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
  };
}
