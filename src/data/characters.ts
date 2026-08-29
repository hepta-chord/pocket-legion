// 本編とバランス計測 (sim/) が共有するキャラ定義。
//
// 世界設定: 主力は物理で、魔法使いは希少である。
// 前衛の大半は物理スキルの手数で戦い、魔法と必殺は一撃が明確に強い代わりに
// 使うたび出撃を通してコストが上がる「切りどころを選ぶ札」になる。
// 陣営・レベル・入手経路を備えた本実装はマイルストーン 5 で入る。

import { makeSkillState, type Fighter } from '../battle';
import type { Faction } from '../data/factions';
import type { ActionSkillDef, PassiveDef } from '../data/skills';

const slash = (id: string): ActionSkillDef => ({
  id,
  name: '斬撃',
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'attack', target: 'one', power: 1 },
});

/** 物理の強撃。物理はコスト上昇が +1 で止まるので、素のコストで差をつける */
const heavyBlow: ActionSkillDef = {
  id: 'heavy-blow',
  name: '強撃',
  category: 'physical',
  baseCost: 2,
  effect: { kind: 'attack', target: 'one', power: 1.8 },
};

const sweep: ActionSkillDef = {
  id: 'sweep',
  name: '薙ぎ払い',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'attack', target: 'all', power: 0.8 },
};

// 魔法は希少なぶん、物理の連打より一撃をはっきり強くする。
// 出撃を通したコスト上昇を払ってでも使いたい威力が無いと、札として死ぬため
const blaze: ActionSkillDef = {
  id: 'blaze',
  name: '大火',
  category: 'magic',
  baseCost: 3,
  effect: { kind: 'attack', target: 'one', power: 3.5 },
};

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

const barrier: ActionSkillDef = {
  id: 'barrier',
  name: '守りの膜',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'barrier' },
};

/** 主人公の通常攻撃。0 コストで出撃を通して消耗しない、唯一の下支えになる */
const heroSlash: ActionSkillDef = {
  id: 'hero-slash',
  name: '斬撃',
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'attack', target: 'one', power: 1.0 },
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

interface CharacterEntry {
  id: string;
  faction: Faction;
  attack: number;
  vitality: number;
  skills: ActionSkillDef[];
  passives: PassiveDef[];
}

export const CHARACTERS: readonly CharacterEntry[] = [
  // 初期の 2 人。所持から外れない (run.ts の defaultParty が前衛へ固定で入れる)
  { id: 'hero', faction: 'kingdom', attack: 120, vitality: 60, skills: [heroSlash, heroFinish], passives: [] },
  { id: 'mate', faction: 'order', attack: 90, vitality: 60, skills: [mateBolt, mateHeal], passives: [] },
  // 王国: 物理の主力。標準の戦士の供給源
  { id: 'k1', faction: 'kingdom', attack: 110, vitality: 50, skills: [slash('slash-k1'), heavyBlow], passives: [] },
  { id: 'k2', faction: 'kingdom', attack: 100, vitality: 50, skills: [slash('slash-k2')], passives: [spring] },
  { id: 'k3', faction: 'kingdom', attack: 100, vitality: 40, skills: [sweep], passives: [scout] },
  { id: 'k4', faction: 'kingdom', attack: 120, vitality: 40, skills: [slash('slash-k4'), cheer], passives: [] },
  // 教団: 回復と支援。希少な魔法使いの多くはここに置く
  { id: 'o1', faction: 'order', attack: 80, vitality: 50, skills: [blaze, pray], passives: [] },
  { id: 'o2', faction: 'order', attack: 70, vitality: 60, skills: [barrier], passives: [wall] },
  { id: 'o3', faction: 'order', attack: 80, vitality: 50, skills: [holyBolt, cheer], passives: [] },
  // 傭兵団: ガードと体力。m2 は身代わりで大技のダウンを肩代わりする役にする
  { id: 'm1', faction: 'mercs', attack: 110, vitality: 80, skills: [slash('slash-m1'), greatBlade], passives: [] },
  { id: 'm2', faction: 'mercs', attack: 90, vitality: 100, skills: [slash('slash-m2')], passives: [bodyguard] },
  { id: 'm3', faction: 'mercs', attack: 80, vitality: 60, skills: [slash('slash-m3a'), slash('slash-m3b')], passives: [] },
  // 辺境: 必殺と代償
  { id: 'f1', faction: 'frontier', attack: 120, vitality: 50, skills: [lastStand, slash('slash-f1')], passives: [] },
  { id: 'f2', faction: 'frontier', attack: 130, vitality: 40, skills: [finale, slash('slash-f2')], passives: [] },
];

export function buildFighter(entry: CharacterEntry): Fighter {
  return {
    id: entry.id,
    name: entry.id,
    faction: entry.faction,
    attack: entry.attack,
    vitality: entry.vitality,
    skills: entry.skills.map(makeSkillState),
    passives: entry.passives,
    downed: false,
  };
}
