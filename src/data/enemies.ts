// 敵とボスの定義。本編とバランス計測 (sim/) が共有する。
//
// 数値は大味に振ってある。ダメージは 2〜3 桁で動き、細かい差は読ませない。
// 道中の雑魚はダウンを起こさず、パーティ HP を削るだけの存在で、
// 浅い深度では瞬殺できる。深くなるほど HP が二次で伸びて、
// 「まだ farm できる深さ」と「削られ始める深さ」の縁が生まれる。

import type { ActionSlot, EnemyDef } from '../battle';
import type { Rng } from '../rng';
import type { Element } from './skills';

/** 雑魚の行動枠。1 枠だけで、攻撃 9・何もしない 1 を基準にする (docs/plan.md「敵の行動と予告」) */
const FOE_SLOTS: ActionSlot[] = [
  [
    { action: { kind: 'attack' }, weight: 9 },
    { action: { kind: 'none' }, weight: 1 },
  ],
];

/**
 * ボスのスタンが巻き込む人数の幅。区画 (浅層/中層/深層) で変える。
 *
 * 複数を巻き込むのはボスだけにする。雑魚が 2 人まとめて気絶させると、
 * 前衛が 4 人前後の序盤では手番の半分が飛んで、道中がただの事故になる。
 * 場を荒らす派手さはボス戦にだけ置く。
 */
function bossStunRange(sectorId: number): { min: number; max: number } {
  if (sectorId <= 1) return { min: 1, max: 2 };
  if (sectorId === 2) return { min: 1, max: 3 };
  return { min: 2, max: 4 };
}

/** スタンを持たない敵に入れておく既定値。stunEvery が null のときは使われない */
const NO_STUN_RANGE = { min: 1, max: 1 };

/**
 * 奈落係数。最初のボス (深度 40) を超えたぶんだけ敵の HP・攻撃力と報酬の金に掛かる。
 * 基礎式 (深度の一次) の上にこの一次の係数が乗るので実質二次で伸び、
 * 主人公以外の成長が頭打ちになった部隊はどこかで必ず壁に当たる。
 *
 * 起点を 30 ではなく 40 に置いてあるのは、31〜40 階を「深層の続き」の素直な伸びに保つため。
 * 30 から掛け始めると、深層をクリアしたばかりの部隊が最初のボス (40 階) に
 * 1 割しか届かず、奈落の最初の山を見ないまま終わってしまう (計測で確認)
 * (docs/plan.md「奈落」)
 */
export function abyssMul(depth: number): number {
  return depth <= 40 ? 1 : 1 + 0.04 * (depth - 40);
}

/**
 * 攻撃力に掛ける奈落係数。HP 側 (abyssMul) の半分にしてある。
 *
 * パーティ HP はレベル上限のせいでどこかで頭打ちになるのに、
 * 敵の攻撃力は基礎式 (深度の一次) だけでも伸び続ける。そこへ HP と同じ係数を掛けると、
 * 55 階あたりで雑魚の一撃がパーティ HP を丸ごと持っていくようになり、
 * 50 階のボスを 97% 倒せる部隊が 60 階には 1% しか届かない「崖」になっていた (計測で確認)。
 * 壁は事故ではなく消耗であってほしいので、深さの重みは HP (戦闘が長引く) 側に寄せる
 */
export function abyssAttackMul(depth: number): number {
  return depth <= 40 ? 1 : 1 + 0.02 * (depth - 40);
}

/**
 * 通常戦・強敵の雑魚を深度なりに生成する。elite なら HP と攻撃力を 1.5 倍にする。
 *
 * ダウン攻撃・スタンは雑魚の一部だけが持つ (docs/plan.md「敵の行動と予告」)。
 * 2 割程度にダウン攻撃、別の 2 割程度にスタンを持たせ、両方持つ個体は作らない
 * (どちらも持たない大半は、大技以外はただ殴るだけの雑魚になる)。
 * スタンは大技・ダウン攻撃と同じクールタイム制 (stunEvery) にしてあり、行動枠の
 * 抽選には乗らず、予告もしない (大技・ダウン攻撃と違って、来ると分かっている必要はない)
 */
export function makeFoe(depth: number, rng: Rng, elite = false): EnemyDef {
  const groupSize = rng.int(1, Math.min(3, 1 + Math.floor(depth / 5)));
  // elite 倍率と奈落係数は別掛け (奈落の強敵は両方が乗って重くなる)。
  // 攻撃力だけは緩い係数 (abyssAttackMul) を使う
  const mul = (elite ? 1.5 : 1) * abyssMul(depth);
  const atkMul = (elite ? 1.5 : 1) * abyssAttackMul(depth);
  // 耐性なしが主で、持ちが出たら苦戦する回にする。
  // 主力が物理の世界なので、物理耐性のほうがきつい壁として多めに出る
  const resistRoll = rng.next();
  const resist: Element | null = resistRoll < 0.08 ? 'physical' : resistRoll < 0.12 ? 'magic' : null;

  const specialRoll = rng.next();
  const hasDownstrike = specialRoll < 0.2;
  const hasStun = !hasDownstrike && specialRoll < 0.4;
  // 中層以深 (depth 11 以上) は 30% で通常攻撃が 2 回刻みになる (合計威力は同じ、絵替わり)。
  // 浅層でこの判定を挟むと乱数の消費順が変わってしまうので、depth 未満のときは rng を引かない
  const attackHits = depth >= 11 && rng.chance(0.3) ? 2 : undefined;

  return {
    id: `d${depth}`,
    name: groupSize > 1 ? (elite ? '影の群れ' : '魔物の群れ') : elite ? '影' : '魔物',
    // 深度 2 の単体 (最初に出る雑魚) は、主人公が斬撃を振り続けて 2 ターン、
    // 必殺なら一撃で沈む量。深さには一次で伸ばす。
    // 二次で伸ばすと、こちらの火力 (レベルで約 2 倍、陣営倍率で最大 2 倍) が
    // まったく追いつかず、中層から先が越えられない壁になる
    maxHp: Math.round((150 + depth * 80) * mul),
    attack: Math.round((40 + depth * 9) * groupSize * atkMul),
    defense: depth * 2,
    resist,
    groupSize,
    isBoss: false,
    bigEvery: rng.int(3, 4),
    bigMul: 2.2,
    attackHits,
    // 雑魚の大技は個体ごとの技名を持たない。予告バッジには総称の「大技」を出す
    bigName: '大技',
    downEvery: hasDownstrike ? rng.int(4, 6) : null,
    // 雑魚のスタンは必ず 1 人だけにする (複数はボスの特権)
    stunEvery: hasStun ? rng.int(4, 6) : null,
    stunRange: NO_STUN_RANGE,
    slots: FOE_SLOTS,
  };
}

interface BossSpec {
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  /** 大技の名前。ボスは固有の技名を予告バッジに出す */
  bigName: string;
  /** 大技の威力倍率。既定は 6.0 だが、骨の王だけ剥がしを兼ねる代わりに落とす */
  bigMul: number;
  /** 大技を刻む回数。省略 (1) は単発 */
  bigHits?: number;
  /** 大技の先頭に付く解除ヒットの枚数。省略 (0) は解除を持たない */
  bigDispel?: number;
  /** 通常攻撃を刻む回数。省略 (1) は単発 */
  attackHits?: number;
  /** スタンの間隔 (ターン)。省略時は bossStunEvery の一般則に従う */
  stunEveryOverride?: number;
  /** 枠 2 (自己強化・解除・攻撃の混ぜ方)。ボスごとの戦い方の個性そのもの
   * (docs/plan.md「敵の行動と予告」)。枠 1 は 3 体とも共通 (攻撃 9:無 1) */
  slot2: ActionSlot;
}

/** ボスの枠 1。3 体とも共通で、ここでほぼ毎ターン殴ってくる */
const BOSS_SLOT1: ActionSlot = [
  { action: { kind: 'attack' }, weight: 9 },
  { action: { kind: 'none' }, weight: 1 },
];

/**
 * 区画ごとのボス個性 (docs/plan.md「敵の行動と予告」)。同じ「固くて痛い」の数値違いにしないため、
 * 枠 2 の中身をボスごとに変える。
 * - 浅層・穴蜘蛛の女王: 自己強化型。鼓舞・防御を積みながら殴る (現行のまま)
 * - 中層・骨の王: 解除型。枠 2 に解除を混ぜ、こちらの鼓舞・ガードを維持させない。
 *   大技 (亡者の号令) の先頭で鼓舞・ガードを 1 枚剥がしてから高倍率 (5.0) の一撃を入れる。
 *   剥がしの分だけ bigMul を通常より低くしてある
 * - 深層・八岐大蛇: スタン・多段型。枠 2 は攻撃寄りにし、通常攻撃がデフォルトで 2 回刻み、
 *   スタンの間隔を詰め (bossStunEvery で 3 に)、大技 (八首の顎) は
 *   解除 1 枚 + 8 回の連撃にする (1 ヒット 0.75 相当)
 */
const BOSSES: readonly BossSpec[] = [
  {
    name: '穴蜘蛛の女王',
    maxHp: 1200,
    attack: 40,
    defense: 40,
    bigName: '毒霧の乱舞',
    bigMul: 6.0,
    slot2: [
      { action: { kind: 'cheer' }, weight: 5 },
      { action: { kind: 'ward' }, weight: 5 },
      { action: { kind: 'attack' }, weight: 1 },
      { action: { kind: 'none' }, weight: 2 },
    ],
  },
  {
    name: '骨の王',
    maxHp: 2900,
    attack: 70,
    defense: 70,
    bigName: '亡者の号令',
    bigMul: 5.0,
    bigDispel: 1,
    slot2: [
      { action: { kind: 'dispel' }, weight: 5 },
      { action: { kind: 'cheer' }, weight: 2 },
      { action: { kind: 'ward' }, weight: 2 },
      { action: { kind: 'attack' }, weight: 2 },
      { action: { kind: 'none' }, weight: 2 },
    ],
  },
  {
    name: '八岐大蛇',
    maxHp: 5200,
    attack: 100,
    defense: 100,
    bigName: '八首の顎',
    bigMul: 6.0,
    bigHits: 8,
    bigDispel: 1,
    attackHits: 2,
    stunEveryOverride: 3,
    slot2: [
      { action: { kind: 'attack' }, weight: 5 },
      { action: { kind: 'cheer' }, weight: 2 },
      { action: { kind: 'ward' }, weight: 2 },
      { action: { kind: 'none' }, weight: 2 },
    ],
  },
];

/**
 * ボスのダウン攻撃の間隔 (ターン)。浅層は 10 ターンに 1 回にし (docs/batch-growth.md 6 節)、
 * 中層・深層はそこから少しだけ詰める (深いほど長期戦になるので、詰めすぎない程度に)
 */
function bossDownEvery(sectorId: number): number {
  if (sectorId <= 1) return 10;
  if (sectorId === 2) return 9;
  return 8;
}

/**
 * ボスのスタンの間隔 (ターン)。浅層は少し猶予を持たせ、中層は 4 ターンに詰める
 * (docs/batch-growth.md 6 節)。深層 (八岐大蛇) は個性として 3 までさらに詰める
 * (BossSpec.stunEveryOverride)
 */
function bossStunEvery(sectorId: number, override?: number): number {
  if (override !== undefined) return override;
  return sectorId <= 1 ? 5 : 4;
}

/**
 * 区画ごとのボスを 1 体作る。
 *
 * HP は浅層が 10 ターン強、中層・深層が 30〜45 ターンで沈む量に合わせてある。
 * 深いほど長い消耗戦になるが、雑魚戦 (5〜10 ターン) とは別物の長さを保つ。
 *
 * 50〜100 ターンの消耗戦にするため、通常攻撃は深度なりの雑魚よりずっと軽い。
 * 長期戦で成立する 1 ターンあたりの被害はパーティ HP の予算を戦闘の長さで割った値で、
 * どうしても小さくなるため。
 * 脅威は大技とダウン攻撃に寄せてあり、答えなければ HP もダウンも持っていかれる。
 * ボスが怖いのは殴られ続けるからではなく、予告に毎回答えを出し続けるからにする。
 *
 * ボスは全員が大技・ダウン攻撃・スタン・自己鼓舞・自己防御を持つ。スタンも大技・ダウン攻撃と
 * 同じクールタイム制 (stunEvery) にしてあり、行動枠の抽選には乗らない
 * (乗せると、2 枠と合わせて毎ターン頻繁にスタンが飛んでしまう)。予告もしない。
 * どちらの特殊行動のターンでもなければ、BOSS_SLOT1 + spec.slot2 (2 枠) を引く
 *
 * 奈落 (sectorId 4) は新造せず、既存 3 体を 10 階ごとにローテーションで再登場させる
 * (深度 40 = 穴蜘蛛の女王、50 = 骨の王、60 = 八岐大蛇、70 = また穴蜘蛛…)。
 * spec の素の値は深層基準 (穴蜘蛛 1200 など) のままなので、奈落の穴蜘蛛は深層の骨の王より
 * 弱い個体として出る。10 階ごとの山に強弱の波が出るほうが単調にならないので、これは意図どおり
 * (docs/batch-abyss.md 3 節)。downEvery/stunEvery/stunRange は深層と同じ扱いに固定する
 */
export function makeBoss(sectorId: number, rng: Rng, depth: number): EnemyDef {
  const specIndex = sectorId === 4 ? ((depth / 10 - 4) % 3 + 3) % 3 : Math.min(sectorId, BOSSES.length) - 1;
  const spec = BOSSES[specIndex] ?? BOSSES[BOSSES.length - 1];
  const resist: Element = rng.chance(0.5) ? 'physical' : 'magic';
  const mul = abyssMul(depth);
  const atkMul = abyssAttackMul(depth);
  // 行動パターンの個性 (downEvery/stunEvery/stunRange) を決める区画は、奈落なら深層 (3) 固定にする
  const tierId = sectorId === 4 ? 3 : sectorId;
  return {
    id: sectorId === 4 ? `boss-abyss-${depth}` : `boss-${sectorId}`,
    name: spec.name,
    maxHp: Math.round(spec.maxHp * mul),
    attack: Math.round(spec.attack * atkMul),
    defense: spec.defense,
    resist,
    groupSize: 1,
    isBoss: true,
    bigEvery: 3,
    bigMul: spec.bigMul,
    bigHits: spec.bigHits,
    bigDispel: spec.bigDispel,
    attackHits: spec.attackHits,
    bigName: spec.bigName,
    downEvery: bossDownEvery(tierId),
    stunEvery: bossStunEvery(tierId, spec.stunEveryOverride),
    stunRange: bossStunRange(tierId),
    slots: [BOSS_SLOT1, spec.slot2],
  };
}
