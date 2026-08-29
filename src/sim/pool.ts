// バランス計測用の仮キャラプール。
//
// 本編のキャラ定義 (data/characters.ts) はマイルストーン 4 で入る。
// それまでの計測は、docs/plan.md のスキル配分の指針
// (物理は希少・必殺か代償と相方・アタッカーの主流は魔法) をなぞったこのプールで行う。

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

const bolt: ActionSkillDef = {
  id: 'bolt',
  name: '魔弾',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 1.2 },
};

const blaze: ActionSkillDef = {
  id: 'blaze',
  name: '大火',
  category: 'magic',
  baseCost: 3,
  effect: { kind: 'attack', target: 'one', power: 2.2 },
};

const storm: ActionSkillDef = {
  id: 'storm',
  name: '火群',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'attack', target: 'all', power: 0.9 },
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
  effect: { kind: 'attack', target: 'one', power: 3 },
  element: 'physical',
};

const lastStand: ActionSkillDef = {
  id: 'last-stand',
  name: '捨て身',
  category: 'ultimate',
  baseCost: 2,
  effect: { kind: 'attack', target: 'one', power: 2.5 },
  selfDown: true,
};

const finale: ActionSkillDef = {
  id: 'finale',
  name: '終の一撃',
  category: 'ultimate',
  baseCost: 5,
  effect: { kind: 'attack', target: 'all', power: 4 },
  oncePerSortie: true,
};

const spring: PassiveDef = { id: 'spring', name: '泉脈', hooks: { manaPerTurn: 1 } };
const wall: PassiveDef = { id: 'wall', name: '盾構え', hooks: { guardRate: 0.1 } };
const scout: PassiveDef = { id: 'scout', name: '斥候', hooks: { telegraph: 1 } };

interface PoolEntry {
  id: string;
  faction: Faction;
  attack: number;
  vitality: number;
  skills: ActionSkillDef[];
  passives: PassiveDef[];
}

export const POOL: readonly PoolEntry[] = [
  // 王国: 攻撃魔法
  { id: 'k1', faction: 'kingdom', attack: 11, vitality: 5, skills: [bolt, blaze], passives: [] },
  { id: 'k2', faction: 'kingdom', attack: 10, vitality: 5, skills: [bolt], passives: [spring] },
  { id: 'k3', faction: 'kingdom', attack: 10, vitality: 4, skills: [storm], passives: [scout] },
  { id: 'k4', faction: 'kingdom', attack: 12, vitality: 4, skills: [blaze, cheer], passives: [] },
  // 教団: 回復と支援
  { id: 'o1', faction: 'order', attack: 8, vitality: 5, skills: [pray, bolt], passives: [] },
  { id: 'o2', faction: 'order', attack: 7, vitality: 6, skills: [pray], passives: [wall] },
  { id: 'o3', faction: 'order', attack: 8, vitality: 5, skills: [cheer, bolt], passives: [] },
  // 傭兵団: 体力と、希少な物理
  { id: 'm1', faction: 'mercs', attack: 11, vitality: 8, skills: [slash('slash-a'), greatBlade], passives: [] },
  { id: 'm2', faction: 'mercs', attack: 9, vitality: 10, skills: [slash('slash-b')], passives: [wall] },
  // 物理 + 物理のレア枠。使い勝手の対価に数値を抑える
  { id: 'm3', faction: 'mercs', attack: 8, vitality: 6, skills: [slash('slash-c'), slash('slash-d')], passives: [] },
  // 辺境: 必殺と代償
  { id: 'f1', faction: 'frontier', attack: 12, vitality: 5, skills: [lastStand, bolt], passives: [] },
  { id: 'f2', faction: 'frontier', attack: 13, vitality: 4, skills: [finale, bolt], passives: [] },
];

export function buildFighter(entry: PoolEntry): Fighter {
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
