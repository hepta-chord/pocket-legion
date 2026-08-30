// コモン・レアのランダム生成。
//
// コモンもレアも固定の名簿を持たない。名簿を書き並べる労力を、
// 候補群 (スキル 1 枠目・2 枠目・名前・数値の帯) を整える労力に振り替える
// (docs/plan.md「コモンの生成」「レアリティと入手」)。
// 生成した個体そのもの (id・名前・スキル・パッシブ・数値) を呼び出し側 (GameState.owned) が
// そのまま保存するので、ここでは「1 人分の CharacterEntry を作る」ことだけをやる。

import type { Faction } from '../data/factions';
import type { CharacterEntry } from '../data/characters';
import type { ActionSkillDef, PassiveDef } from '../data/skills';
import type { Curve } from '../growth';
import type { Rng } from '../rng';

// ---------------------------------------------------------------------------
// スキル。既存のコモン用スキル (1 コスト通常攻撃 / 2 コスト強攻撃 / 光弾 / 祈り /
// 鼓舞 1 / ガード 1 / バリア / 薙ぎ払い / 火群) を陣営の得意系統に沿って割り振る。
// 定義そのものは可変状態を持たない (可変なコスト上昇は battle.ts の SkillState 側が持つ) ので、
// 複数の個体で同じ定義オブジェクトを共有しても壊れない

/** コモンの通常攻撃。1 コスト */
function commonAttack(id: string): ActionSkillDef {
  return {
    id,
    name: '通常攻撃',
    shortName: '攻撃',
    category: 'physical',
    baseCost: 1,
    effect: { kind: 'attack', target: 'one', power: 1.0 },
  };
}

/** コモンの強攻撃。2 コストぶん一撃は重い */
function heavyAttack(id: string): ActionSkillDef {
  return {
    id,
    name: '強攻撃',
    shortName: '強撃',
    category: 'physical',
    baseCost: 2,
    effect: { kind: 'attack', target: 'one', power: 1.8 },
  };
}

// 全体攻撃は敵の群れの規模で威力が伸びる (battle.ts)。単体スキルより 1 発が軽いぶん、
// 群れに当てたときだけ割に合う札になる
const sweep: ActionSkillDef = {
  id: 'sweep',
  name: '薙ぎ払い',
  shortName: '薙ぎ',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'attack', target: 'all', power: 0.8 },
};

const storm: ActionSkillDef = {
  id: 'storm',
  name: '火群',
  shortName: '火群',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'attack', target: 'all', power: 1.4 },
};

// 魔法は希少なぶん、物理の連打より一撃をはっきり強くする。
// コスト帯を 1/2/3 で持たせ、同コストの物理 (1c 1.0 / 2c 1.8) よりはっきり上に置く
// (docs/plan.md「スキル配分の指針」)
const holyBolt: ActionSkillDef = {
  id: 'holy-bolt',
  name: '光弾',
  shortName: '光弾',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 2.0 },
};

/** 閃光。2 コストの魔法単体攻撃。教団の 1 枠目候補に足す */
const flash: ActionSkillDef = {
  id: 'flash',
  name: '閃光',
  shortName: '閃光',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'attack', target: 'one', power: 3.0 },
};

const pray: ActionSkillDef = {
  id: 'pray',
  name: '祈り',
  shortName: '祈り',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'heal', power: 0.4 },
};

/** 鼓舞 1 枚積む。コモンの支援役が持つ */
const cheer1: ActionSkillDef = {
  id: 'cheer',
  name: '鼓舞',
  shortName: '鼓舞',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'cheer', stacks: 1 },
};

/** ward (被ダメージ減) を 1 枚積む。コモンの壁役が持つ */
const ward1: ActionSkillDef = {
  id: 'ward1',
  name: 'ガード',
  shortName: 'ガード',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'ward', stacks: 1 },
};

const barrier: ActionSkillDef = {
  id: 'barrier',
  name: '守りの膜',
  shortName: '守膜',
  category: 'magic',
  baseCost: 2,
  effect: { kind: 'barrier' },
};

/** 連撃。0.5 倍 × 2 回のコモン向け多段 (docs/plan.md「多段攻撃」)。王国・傭兵団の 1 枠目に足す */
const comboAttack: ActionSkillDef = {
  id: 'gen-combo',
  name: '連撃',
  shortName: '連撃',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 0.5, hits: 2 },
};

/**
 * 乱し。0 コストでランダムに 1 枚だけ剥がす (docs/plan.md「バフ剥がし」)。
 * 教団・王国の 2 枠目候補に足す。ネームドのカクサンが持っていた「全部剥がし」は
 * 浄化 (2 コスト) に格上げしたので、生成側の 2 枠目にはこの安い版を混ぜる
 */
const dispelOne: ActionSkillDef = {
  id: 'dispel-one',
  name: '乱し',
  shortName: '乱し',
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'dispel', scope: 'one' },
};

/** 崩し。0.8 倍の攻撃を入れてからランダムに 1 枚剥がす。傭兵団の 1 枠目候補・レアの 2 枠目候補 */
const dispelCrush: ActionSkillDef = {
  id: 'dispel-crush',
  name: '崩し',
  shortName: '崩し',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'dispel', scope: 'one', power: 0.8 },
};

// パッシブ「泉脈」(マナ払い出し +1) は廃止した。常時効くと払い出しの律動 (奇数 2 / 偶数 3) が
// 崩れるため、マナを増やす効果はアクションスキル (レア専用の魔力譲渡、後述) に移した
// (docs/plan.md「スキルスロット」)
const wall: PassiveDef = { id: 'wall', name: '盾構え', hooks: { defenseRate: 0.1 } };
const scout: PassiveDef = { id: 'scout', name: '斥候', hooks: { telegraph: 1 } };
const bodyguard: PassiveDef = { id: 'bodyguard', name: '身代わり', hooks: { cover: true } };
/** 商才。戦闘勝利時の獲得金 +25% (docs/plan.md「デメリットスキル」寄りのパッシブ例)。傭兵団の 2 枠目に足す */
const richTrade: PassiveDef = { id: 'rich-trade', name: '商才', hooks: { goldRate: 0.25 } };

const commonAtk = commonAttack('gen-attack');
const heavyAtk = heavyAttack('gen-heavy');

/** 2 枠目の候補。アクションスキルとパッシブが混在する */
type SecondSlotCandidate = { kind: 'skill'; def: ActionSkillDef } | { kind: 'passive'; def: PassiveDef };

function skill(def: ActionSkillDef): SecondSlotCandidate {
  return { kind: 'skill', def };
}

function passive(def: PassiveDef): SecondSlotCandidate {
  return { kind: 'passive', def };
}

interface FactionPool {
  /** 1 枠目。主に攻撃 */
  slot1: readonly ActionSkillDef[];
  /**
   * 2 枠目。支援・壁・もう 1 つの攻撃・パッシブを混ぜる。
   * どの陣営でも鼓舞 (支援) とガード (壁) は引けるようにしてあるので、
   * 単一陣営で染めても攻撃・支援・壁のどれかは揃う (docs/plan.md「コモンの生成」)
   */
  slot2: readonly SecondSlotCandidate[];
}

export const SKILL_POOLS: Record<Faction, FactionPool> = {
  // 王国: 物理の主力。1 枠目は物理攻撃で揃え、2 枠目に支援・壁・二の矢・斥候・乱しを混ぜる
  kingdom: {
    slot1: [commonAtk, heavyAtk, sweep, comboAttack],
    slot2: [skill(cheer1), skill(ward1), skill(heavyAtk), skill(dispelOne), passive(scout)],
  },
  // 教団: 回復・支援。希少な魔法 (光弾) の入口をここに置き、2 枠目は祈り・守りの膜・支援・壁・乱しを揃える
  order: {
    slot1: [holyBolt, commonAtk, flash],
    slot2: [skill(pray), skill(barrier), skill(cheer1), skill(ward1), skill(dispelOne)],
  },
  // 傭兵団: ガード・体力・身代わり。1 枠目に連撃・崩し (剥がし系の初手) を足し、2 枠目に身代わり・商才を置く
  mercs: {
    slot1: [commonAtk, heavyAtk, comboAttack, dispelCrush],
    slot2: [skill(ward1), skill(cheer1), skill(sweep), passive(bodyguard), passive(richTrade)],
  },
  // 辺境: 少数精鋭。2 枠目に火群 (魔法の二の矢) を置き、重い一撃も選べるようにする
  frontier: {
    slot1: [heavyAtk, sweep],
    slot2: [skill(storm), skill(cheer1), skill(ward1), passive(wall)],
  },
};

// ---------------------------------------------------------------------------
// レア専用のスキル候補群 (docs/plan.md「レアリティと入手」)。
// 陣営ごとに分けず、レアは頭数が少ないので 1 つの候補群で足りる。
// 0 コストの通常攻撃はレアの特権なので、1 枠目は 0 コストの多段バリエーションで揃える

/** レアの 0 コスト通常攻撃 (単発)。タダでコンボを起点にできるのがレアの価値になる */
const rareSlash: ActionSkillDef = {
  id: 'rare-slash',
  name: '斬撃',
  shortName: '斬撃',
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'attack', target: 'one', power: 1.0 },
};

/** 双撃。0 コストで 0.7 倍 × 2 回 (レアの多段は高倍率、docs/plan.md「多段攻撃」) */
const twinStrike: ActionSkillDef = {
  id: 'twin-strike',
  name: '双撃',
  shortName: '双撃',
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'attack', target: 'one', power: 0.7, hits: 2 },
};

/** 三連撃。0 コストで 0.5 倍 × 3 回 */
const tripleStrike: ActionSkillDef = {
  id: 'triple-strike',
  name: '三連撃',
  shortName: '三連撃',
  category: 'physical',
  baseCost: 0,
  effect: { kind: 'attack', target: 'one', power: 0.5, hits: 3 },
};

/**
 * マナを増やすアクションスキル。常時 +1 するパッシブ「泉脈」は払い出しの律動
 * (奇数 2 / 偶数 3) を崩すので廃止し、代わりに 1 マナ払って 2 マナ得る (差し引き +1) の
 * アクションにする。使うターンを選ばせるのが狙いなので、物理と同じ「ターン内 +1 で頭打ち」
 * の消耗にして、出撃を通した消耗はさせない (docs/plan.md「スキルスロット」)。レアだけが持つ
 */
const manaGift: ActionSkillDef = {
  id: 'mana-gift',
  name: '魔力譲渡',
  shortName: '魔力譲渡',
  category: 'physical',
  baseCost: 1,
  effect: { kind: 'mana', amount: 2 },
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

// 必殺の倍率はインロー (3.0) を 3 コスト帯までの頂点に、その下に並べる。
// 大剣だけは 4 コストの重さの対価として上に出る (docs/plan.md「スキル配分の指針」)
const lastStand: ActionSkillDef = {
  id: 'last-stand',
  name: '捨て身',
  shortName: '捨身',
  category: 'ultimate',
  baseCost: 2,
  effect: { kind: 'attack', target: 'one', power: 2.8 },
  selfDown: true,
};

const greatBlade: ActionSkillDef = {
  id: 'great-blade',
  name: '大剣',
  shortName: '大剣',
  category: 'ultimate',
  baseCost: 4,
  effect: { kind: 'attack', target: 'one', power: 3.5 },
};

/**
 * 乱れ撃ち。必殺の多段バリエーション (docs/plan.md「多段攻撃」)。3 コストで 0.7 倍 × 4 回
 * (合計 2.8。単発のインロー (3.0 倍) を超えないよう抑えてある)
 */
const rampage: ActionSkillDef = {
  id: 'rampage',
  name: '乱れ撃ち',
  shortName: '乱れ撃',
  category: 'ultimate',
  baseCost: 3,
  effect: { kind: 'attack', target: 'one', power: 0.7, hits: 4 },
};

/** 極光。3 コストの魔法単体攻撃。魔法のコスト帯 (1/2/3) の最上位で、レアの 2 枠目候補に足す */
const aurora: ActionSkillDef = {
  id: 'aurora',
  name: '極光',
  shortName: '極光',
  category: 'magic',
  baseCost: 3,
  effect: { kind: 'attack', target: 'one', power: 4.0 },
};

const RARE_SLOT1: readonly ActionSkillDef[] = [rareSlash, twinStrike, tripleStrike];
const RARE_SLOT2: readonly ActionSkillDef[] = [greatBlade, manaGift, ward2, lastStand, rampage, dispelCrush, aurora];

// ---------------------------------------------------------------------------
// 名前。陣営ごとに題材を変え、見ただけで所属が分かるようにする。全部カタカナ。
// レアもコモンと同じ候補から引く (docs/plan.md「レアリティと入手」: 固定の名簿を持たない)

// 候補数は雇用の上限 (data/factions.ts FACTION_HIRE_CAP) より多めに用意する
// (王国 16 / 教団 12 / 傭兵団 10 / 辺境 6 が目安。docs/plan.md「コモンの生成」)。
// 酒場の 1 回の品揃えの中で名前が重複しないよう引き直しているので、
// 候補が上限ぎりぎりだと引けなくなるため
export const NAME_POOLS: Record<Faction, readonly string[]> = {
  // 天気 (英語)
  kingdom: [
    'レイン', 'サンダー', 'ストーム', 'ブリーズ', 'ヘイル', 'ミスト', 'フロスト', 'ゲイル',
    'スノー', 'クラウド', 'フォグ', 'サンシャイン', 'タイフーン', 'サイクロン', 'モンスーン', 'オーロラ',
  ],
  // 果物 (イタリア語)
  order: [
    'メーラ', 'ペーラ', 'ウーヴァ', 'フィーコ', 'リモーネ', 'チリエージャ', 'ペスカ', 'アランチャ',
    'フラーゴラ', 'メローネ', 'プルーニャ', 'アナナス',
  ],
  // 酒
  mercs: ['ウォッカ', 'ジン', 'ラム', 'テキーラ', 'ブランデー', 'グラッパ', 'アブサン', 'メスカル', 'ウイスキー', 'コニャック'],
  // 山 (日本語)
  frontier: ['フジ', 'アサマ', 'ハクバ', 'タテヤマ', 'キリシマ', 'ヤリガタケ', 'ホタカ', 'オンタケ'],
};

// ---------------------------------------------------------------------------
// ステータス。2 枠目で引いた型 (攻撃・支援・壁) の基準値に幅を持たせて振るので、
// 同じ型でも個体差が出る

type Archetype = 'attacker' | 'support' | 'wall';

/** 2 枠目に何を引いたかで型を決める。壁 (ward・barrier・壁系パッシブ) / 支援 (鼓舞・回復・支援系パッシブ) /
 * それ以外 (もう 1 つの攻撃) を攻撃型とする */
function archetypeOf(candidate: SecondSlotCandidate): Archetype {
  if (candidate.kind === 'skill') {
    switch (candidate.def.effect.kind) {
      case 'ward':
      case 'barrier':
        return 'wall';
      case 'cheer':
      case 'heal':
      case 'dispel':
        return 'support';
      default:
        return 'attacker';
    }
  }
  switch (candidate.def.id) {
    case 'wall':
    case 'bodyguard':
      return 'wall';
    case 'scout':
    case 'rich-trade':
      return 'support';
    default:
      return 'attacker';
  }
}

/** 型ごとの基準値。壁は打たれ強く控えめな攻撃、攻撃型はその逆に振る */
const BASE_STATS: Record<Archetype, { attack: number; vitality: number }> = {
  attacker: { attack: 105, vitality: 45 },
  support: { attack: 80, vitality: 55 },
  wall: { attack: 75, vitality: 90 },
};

/** コモンのレベル上限の幅。16〜24 を目安にする (docs/batch-growth.md 補足) */
const COMMON_MAX_LEVEL_MIN = 16;
const COMMON_MAX_LEVEL_MAX = 24;
/** コモンの成長補正値の幅。レア (1.0〜1.5) より低い帯にして、早く仕上がるが頭打ちも早い
 * コモンの性格を表す (docs/plan.md「成長カーブ」)。上限到達時に base の 1.5〜1.8 倍まで伸びる */
const COMMON_GROWTH_MIN = 0.5;
const COMMON_GROWTH_MAX = 0.8;
const CURVES: readonly Curve[] = ['linear', 'early', 'late'];

/** レアの数値の帯 (docs/plan.md「レアリティと入手」)。コモンより高い攻撃・体力と、
 * 伸びしろの大きい成長 (growth 1.0〜1.5)・高いレベル上限 (30〜40) を持つ */
const RARE_BASE_ATTACK_MIN = 120;
const RARE_BASE_ATTACK_MAX = 150;
const RARE_BASE_VITALITY_MIN = 45;
const RARE_BASE_VITALITY_MAX = 70;
const RARE_GROWTH_MIN = 1.0;
const RARE_GROWTH_MAX = 1.5;
const RARE_MAX_LEVEL_MIN = 30;
const RARE_MAX_LEVEL_MAX = 40;

/** generateCommon/generateRare/rerollContent が共有する「中身」。名前・id・陣営は含まない */
type GeneratedContent = Pick<
  CharacterEntry,
  'baseAttack' | 'baseVitality' | 'skills' | 'passives' | 'maxLevel' | 'growth' | 'curve'
>;

/** コモンの中身を陣営の候補群から引く。attack/vitality は型の基準値に ±15% の幅を持たせる */
function commonContent(faction: Faction, rng: Rng): GeneratedContent {
  const pool = SKILL_POOLS[faction];
  const skill1 = rng.pick(pool.slot1);
  const slot2 = rng.pick(pool.slot2);
  const type = archetypeOf(slot2);
  const base = BASE_STATS[type];
  const variance = () => 0.85 + rng.next() * 0.3;
  return {
    baseAttack: Math.round(base.attack * variance()),
    baseVitality: Math.round(base.vitality * variance()),
    skills: slot2.kind === 'skill' ? [skill1, slot2.def] : [skill1],
    passives: slot2.kind === 'passive' ? [slot2.def] : [],
    maxLevel: rng.int(COMMON_MAX_LEVEL_MIN, COMMON_MAX_LEVEL_MAX),
    growth: COMMON_GROWTH_MIN + rng.next() * (COMMON_GROWTH_MAX - COMMON_GROWTH_MIN),
    curve: rng.pick(CURVES),
  };
}

/** レアの中身を専用の候補群・数値の帯から引く (docs/plan.md「レアリティと入手」)。
 * 陣営を問わない 1 つの候補群でよい (頭数が少ないため) */
function rareContent(rng: Rng): GeneratedContent {
  const skill1 = rng.pick(RARE_SLOT1);
  const skill2 = rng.pick(RARE_SLOT2);
  return {
    baseAttack: rng.int(RARE_BASE_ATTACK_MIN, RARE_BASE_ATTACK_MAX),
    baseVitality: rng.int(RARE_BASE_VITALITY_MIN, RARE_BASE_VITALITY_MAX),
    skills: [skill1, skill2],
    passives: [],
    maxLevel: rng.int(RARE_MAX_LEVEL_MIN, RARE_MAX_LEVEL_MAX),
    growth: RARE_GROWTH_MIN + rng.next() * (RARE_GROWTH_MAX - RARE_GROWTH_MIN),
    curve: rng.pick(CURVES),
  };
}

/**
 * コモンを 1 人生成する。スキル 1 枠目・2 枠目をそれぞれの候補群から 1 つずつ引き、
 * 名前も陣営の候補から引く。攻撃力・体力は 2 枠目で決まる型の基準値に幅 (±15%) を
 * 持たせて振るので、同じ型でも個体差が出る。
 * レベル上限・成長補正値・カーブの型も個体ごとに振る (docs/batch-growth.md 補足)。
 * 育ち切った到達値まで揃えてしまうと個性が消えるため、ここで意図的に揃えない。
 *
 * serial は id の衝突を避けるためだけの通し番号 (GameState.nextCommonId)。
 * 中身 (名前・スキル・数値) は rng だけで決まるので、同じ seed なら同じ個体が出る
 */
export function generateCommon(faction: Faction, rng: Rng, serial: number): CharacterEntry {
  const name = rng.pick(NAME_POOLS[faction]);
  return {
    id: `common-${serial}`,
    name,
    faction,
    rarity: 'common',
    ...commonContent(faction, rng),
    level: 1,
    exp: 0,
  };
}

/**
 * レアを 1 人生成する (docs/plan.md「レアリティと入手」)。固定の名簿 (旧 r1〜r4) は持たず、
 * コモンと同じ規則で名前を引き、スキルはレア専用の候補群 (0 コスト攻撃の多段バリエーション、
 * 大技・魔力譲渡・鉄壁・崩しなど) から、数値もレアの帯から振る。
 *
 * serial は id の衝突を避けるためだけの通し番号 (GameState.nextRareId)
 */
export function generateRare(faction: Faction, rng: Rng, serial: number): CharacterEntry {
  const name = rng.pick(NAME_POOLS[faction]);
  return {
    id: `rare-${serial}`,
    name,
    faction,
    rarity: 'rare',
    ...rareContent(rng),
    level: 1,
    exp: 0,
  };
}

/**
 * 転生 (docs/plan.md「転生所」)。名前・陣営・id は保ったまま、レベル 1 / exp 0 に戻し、
 * 基礎値・成長・スキルを同じレアリティの生成プールで引き直す。
 * generateCommon/generateRare と「中身」の生成部分 (commonContent/rareContent) を共有するので、
 * 生成プールを変えたときはここにも自動で反映される
 */
export function rerollContent(entry: CharacterEntry, rng: Rng): CharacterEntry {
  const content = entry.rarity === 'rare' ? rareContent(rng) : commonContent(entry.faction, rng);
  return { ...entry, ...content, level: 1, exp: 0 };
}
