// コモンのランダム生成。
//
// コモンは固定の名簿を持たない。名簿を書き並べる労力を、陣営ごとの候補群
// (スキル 1 枠目・2 枠目・名前) を整える労力に振り替える (docs/plan.md「コモンの生成」)。
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

// 魔法は希少なぶん、物理の連打より一撃をはっきり強くする
const holyBolt: ActionSkillDef = {
  id: 'holy-bolt',
  name: '光弾',
  shortName: '光弾',
  category: 'magic',
  baseCost: 1,
  effect: { kind: 'attack', target: 'one', power: 2.0 },
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

// パッシブ「泉脈」(マナ払い出し +1) は廃止した。常時効くと払い出しの律動 (奇数 2 / 偶数 3) が
// 崩れるため、マナを増やす効果はアクションスキル (data/characters.ts の魔力譲渡、レア専用) に
// 移した (docs/plan.md「スキルスロット」)
const wall: PassiveDef = { id: 'wall', name: '盾構え', hooks: { defenseRate: 0.1 } };
const scout: PassiveDef = { id: 'scout', name: '斥候', hooks: { telegraph: 1 } };
const bodyguard: PassiveDef = { id: 'bodyguard', name: '身代わり', hooks: { cover: true } };

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
  // 王国: 物理の主力。1 枠目は物理攻撃で揃え、2 枠目に支援・壁・二の矢・斥候を混ぜる
  kingdom: {
    slot1: [commonAtk, heavyAtk, sweep],
    slot2: [skill(cheer1), skill(ward1), skill(heavyAtk), passive(scout)],
  },
  // 教団: 回復・支援。希少な魔法 (光弾) の入口をここに置き、2 枠目は祈り・守りの膜・支援・壁を揃える
  order: {
    slot1: [holyBolt, commonAtk],
    slot2: [skill(pray), skill(barrier), skill(cheer1), skill(ward1)],
  },
  // 傭兵団: ガード・体力・身代わり。2 枠目に身代わりパッシブを置く
  mercs: {
    slot1: [commonAtk, heavyAtk],
    slot2: [skill(ward1), skill(cheer1), skill(sweep), passive(bodyguard)],
  },
  // 辺境: 少数精鋭。2 枠目に火群 (魔法の二の矢) を置き、重い一撃も選べるようにする
  frontier: {
    slot1: [heavyAtk, sweep],
    slot2: [skill(storm), skill(cheer1), skill(ward1), passive(wall)],
  },
};

// ---------------------------------------------------------------------------
// 名前。陣営ごとに題材を変え、見ただけで所属が分かるようにする。全部カタカナ

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
  const pool = SKILL_POOLS[faction];
  const skill1 = rng.pick(pool.slot1);
  const slot2 = rng.pick(pool.slot2);
  const type = archetypeOf(slot2);
  const base = BASE_STATS[type];
  const variance = () => 0.85 + rng.next() * 0.3;
  const baseAttack = Math.round(base.attack * variance());
  const baseVitality = Math.round(base.vitality * variance());
  const name = rng.pick(NAME_POOLS[faction]);

  return {
    id: `common-${serial}`,
    name,
    faction,
    rarity: 'common',
    baseAttack,
    baseVitality,
    skills: slot2.kind === 'skill' ? [skill1, slot2.def] : [skill1],
    passives: slot2.kind === 'passive' ? [slot2.def] : [],
    level: 1,
    exp: 0,
    maxLevel: rng.int(COMMON_MAX_LEVEL_MIN, COMMON_MAX_LEVEL_MAX),
    growth: COMMON_GROWTH_MIN + rng.next() * (COMMON_GROWTH_MAX - COMMON_GROWTH_MIN),
    curve: rng.pick(CURVES),
  };
}
