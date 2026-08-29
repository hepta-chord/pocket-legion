// 本編とバランス計測 (sim/) が共有するキャラ定義。
//
// 陣営・レベル・入手経路を備えた 23 種の本実装はマイルストーン 4 で入る。
// それまでは、docs/plan.md のスキル配分の指針
// (物理は希少・必殺か代償と相方・アタッカーの主流は魔法) をなぞったこの仮プールを
// 本編の出撃メンバーとしてもそのまま使う。

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

/** 主人公の必殺。使うほど高くつく必殺だけに頼らせないための heroSlash とのセット */
const heroFinish: ActionSkillDef = {
  id: 'hero-finish',
  name: '必殺・断',
  category: 'ultimate',
  baseCost: 3,
  effect: { kind: 'attack', target: 'one', power: 2.8 },
};

/** 相棒の攻撃魔法。安いぶん出撃を通してじわじわ高くつく */
const mateBolt: ActionSkillDef = {
  id: 'mate-bolt',
  name: '攻撃魔法',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 1.3 },
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
  // 初期の 2 人。所持から外れない (run.ts の defaultParty が前衛へ固定で入れる)。
  // 主人公の 0 コスト通常攻撃だけが出撃を通してすり減らない火力になる
  { id: 'hero', faction: 'kingdom', attack: 12, vitality: 6, skills: [heroSlash, heroFinish], passives: [] },
  // 相棒の安いヒーリングが道中の HP 管理を支える
  { id: 'mate', faction: 'order', attack: 9, vitality: 6, skills: [mateBolt, mateHeal], passives: [] },
  // 王国: 攻撃魔法
  { id: 'k1', faction: 'kingdom', attack: 11, vitality: 5, skills: [bolt, blaze], passives: [] },
  { id: 'k2', faction: 'kingdom', attack: 10, vitality: 5, skills: [bolt], passives: [spring] },
  { id: 'k3', faction: 'kingdom', attack: 10, vitality: 4, skills: [storm], passives: [scout] },
  { id: 'k4', faction: 'kingdom', attack: 12, vitality: 4, skills: [blaze, cheer], passives: [] },
  // 教団: 回復と支援。o2 はバリアを持たせ、盾構えは残す
  { id: 'o1', faction: 'order', attack: 8, vitality: 5, skills: [pray, bolt], passives: [] },
  { id: 'o2', faction: 'order', attack: 7, vitality: 6, skills: [barrier], passives: [wall] },
  { id: 'o3', faction: 'order', attack: 8, vitality: 5, skills: [cheer, bolt], passives: [] },
  // 傭兵団: 体力と、希少な物理。m2 は身代わりを持たせ、大技のダウンを肩代わりする役にする
  { id: 'm1', faction: 'mercs', attack: 11, vitality: 8, skills: [slash('slash-a'), greatBlade], passives: [] },
  { id: 'm2', faction: 'mercs', attack: 9, vitality: 10, skills: [slash('slash-b')], passives: [bodyguard] },
  // 物理 + 物理のレア枠。使い勝手の対価に数値を抑える
  { id: 'm3', faction: 'mercs', attack: 8, vitality: 6, skills: [slash('slash-c'), slash('slash-d')], passives: [] },
  // 辺境: 必殺と代償
  { id: 'f1', faction: 'frontier', attack: 12, vitality: 5, skills: [lastStand, bolt], passives: [] },
  { id: 'f2', faction: 'frontier', attack: 13, vitality: 4, skills: [finale, bolt], passives: [] },
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
