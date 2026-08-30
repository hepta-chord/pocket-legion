// 最上位の状態機械。
//
// 入力 (Action) を受けて状態を進め、描画層に渡す ViewModel を組み立てる。
// ここは render/ を import しない。文字で描くか画像で描くかを知らないままにしておく。

import {
  BUFF_STACK_MAX,
  DEFENSE_COST,
  DEFENSE_MAX,
  effectiveCost,
  effectiveFighterAttack,
  effectiveFighterVitality,
  endTurn,
  logBattle,
  MANA_CAP,
  refillFront,
  resetSortieProgress,
  startBattle,
  swapMembers,
  toggleFlee,
  useDefense,
  usePotion,
  useSkill,
  whyCannotUse,
  type BattleState,
  type EnemyDef,
  type EnemyState,
  type Fighter,
  type SwapMove,
} from './battle';
import {
  CHARACTERS,
  effectiveAttack,
  effectiveVitality,
  instantiate,
  skillLabels,
  type CharacterEntry,
} from './data/characters';
import { generateCommon, NAME_POOLS } from './data/common-gen';
import { CORPSE_TRAP_CHANCE, NOTHING_TRAP_CHANCE, TREASURE_TRAP_CHANCE } from './data/events';
import { FACTION_HIRE_CAP, FACTION_NAMES, FACTION_WEIGHT, FACTIONS, type Faction } from './data/factions';
import { makeBoss, makeFoe } from './data/enemies';
import { DUNGEONS } from './data/dungeons';
import { priceOf } from './data/pricing';
import { sectorById } from './data/sectors';
import type { ActionSkillDef, PassiveDef, SkillCategory } from './data/skills';
import { addExp } from './growth';
import {
  autoFillFormation,
  emptyFormation,
  placeInFormation,
  resolveFormation,
  setFrontMember,
  type Formation,
} from './formation';
import { hashSeed, Rng } from './rng';
import { factionMultiplier, factionMultiplierOf, factionTotals, type FactionTotals } from './roster';
import {
  addToDeck,
  advance,
  damage,
  heal,
  isWiped,
  reviveDowned,
  sectorOf,
  startRun,
  type RunState,
} from './run';
import type {
  BattleView,
  DungeonFormationView,
  DungeonView,
  FormationCharacterView,
  FormationEditorView,
  FormationSlotView,
  LogLineView,
  PassiveDetailView,
  SkillDetailView,
  TownView,
  ViewModel,
} from './view';

// レベル・成長カーブ・酒場の引き直し賃料などを GameState/CharacterEntry に足したので、
// 古いセーブと噛み合わなくなる。区切りを上げて捨てる
export const SAVE_VERSION = 11;

/** 回復薬の所持上限 */
const POTION_MAX = 3;
/** 出撃開始時の所持金。コモン 2 人を雇って 60 残る水準 */
const START_GOLD = 300;
/** 初期所持の回復薬。道具屋で買い足せるので 0 にはしない */
const START_POTIONS = 1;
/** 酒場の品揃えの人数 */
const TAVERN_SIZE = 3;
/** 酒場の品揃えに未所持レアを混ぜる確率。低確率の当たり枠にする */
const TAVERN_RARE_CHANCE = 0.15;
/** 酒場の引き直し賃料の初期値。所持金 (START_GOLD 300) と釣り合う額に置く */
const TAVERN_REROLL_BASE = 60;
/** 引き直すたびに賃料を上げる倍率。粘るほど高くつく形にする。出撃を終えると初期値に戻す */
const TAVERN_REROLL_RAISE = 1.5;
/** 道具屋の回復薬の値段の初期値。酒場の引き直し賃と同じ考え方 (買うたびに上がり、出撃で戻る) */
const POTION_PRICE_BASE = 80;
/** 回復薬を買うたびに値段を上げる倍率 */
const POTION_PRICE_RAISE = 1.5;

/** 戦闘に勝ったときの経験値の基準値。深度が深いほど、強敵・ボスほど多く入る */
const EXP_BASE = { battle: 8, elite: 16, boss: 50 } as const;
/** 泉の代替 (経験値をもらう) が渡す量。通常戦の数戦ぶんの上乗せにする */
const SPRING_ALT_EXP_MUL = 3;
/** 祠「祈る」が渡す経験値の倍率。泉の代替より軽い、単独のイベントとしての初期値 */
const SHRINE_PRAY_EXP_MUL = 2;
/** 休息「先を急ぐ」が渡す経験値の倍率。回復を捨てる代わりの見返りなので祠よりわずかに軽くする */
const REST_PRESS_EXP_MUL = 1.5;
/** 隊商の回復薬の値段。道具屋の初期値 (POTION_PRICE_BASE) より高くする (行商は割高) */
const CARAVAN_POTION_PRICE = 150;

export type Action =
  | { type: 'sortie'; sectorId: number }
  | { type: 'advance' }
  | { type: 'resolve' }
  /** ボス前の分岐イベントだけが持つ、もう一方の選択肢 (レアの加入) */
  | { type: 'resolve-alt' }
  | { type: 'retreat' }
  | { type: 'dismiss' }
  | { type: 'hire'; id: string }
  /** 酒場の品揃えを金を払って引き直す。賃料は state.tavernRerollCost */
  | { type: 'reroll-tavern' }
  /** 道具屋で回復薬を 1 個買う。値段は state.potionPrice */
  | { type: 'buy-potion' }
  | { type: 'potion' }
  /** 拠点の編成画面。所持キャラの一覧から前衛スロットへ配置する。id が null ならそのスロットを空にする */
  | { type: 'formation-set'; slot: number; id: string | null }
  /** 拠点の編成画面の操作列。前衛 6 枠をまとめて空にする */
  | { type: 'formation-clear-all' }
  /** ダンジョン内 (戦闘外) の編成。今のデッキの中から前衛スロットの中身を選び直す。新しいキャラは増やせない */
  | { type: 'dungeon-formation-set'; slot: number; id: string | null }
  | { type: 'battle-skill'; slot: number; skill: number }
  | { type: 'battle-defense' }
  | { type: 'battle-swap'; moves: SwapMove[] }
  /** 逃げるの宣言・キャンセルのトグル */
  | { type: 'battle-flee' }
  | { type: 'battle-end-turn' };

/** 進行中の戦闘の種別。決着時の報酬とボス処理の分岐に使う */
type BattleKind = 'battle' | 'elite' | 'boss';

export interface GameState {
  version: number;
  seed: string;
  rngState: number;
  gold: number;
  /** 回復薬の所持数。上限 POTION_MAX */
  potions: number;
  /**
   * 所持キャラそのもの。hero (コーモン)・mate (スケサン)・aide2 (カクサン) の固定 3 人は常に含む。
   * 固定のレア・固定の 3 人は CHARACTERS の定義をそのまま積む一方、
   * 生成コモンは生成した個体そのもの (id・名前・スキル・パッシブ・数値) を積む。
   * 「id で引き直す」経路を持たないので、生成コモンも所持した後は同じ個体のまま残る
   */
  owned: CharacterEntry[];
  /**
   * 次に生成するコモンへ振る通し番号。id (`common-N`) の衝突を避けるためだけの値で、
   * ゲームの結果には影響しない
   */
  nextCommonId: number;
  /**
   * 前衛の編成。長さ 6 固定、値は owned の id か空きを示す null。
   * デッキは絞らないので、控えは前衛に選ばれなかった owned 全員が自動で務める。
   * 一度も編成を触っていない (formationTouched が false) ときだけ
   * owned の先頭 6 人を自動で詰める (resolveFormation)
   */
  formation: Formation;
  /**
   * 編成を一度でも編集したか (「空にする」「全て外す」も含む)。
   * これが false の間だけ表示・出撃時に自動詰めへ落ちる。
   * formation の中身 (全部 null かどうか) だけで判定すると、「全て外す」で
   * 明示的に空にした場合まで「自動詰めの前」と誤認して詰め直してしまうため、
   * 別のフラグとして持つ
   */
  formationTouched: boolean;
  /**
   * 今の酒場の品揃え (最大 3 人)。生成コモンに加え、低確率で未所持レア (source: 'tavern') を混ぜる。
   * 生成した個体そのものを持つので、雇うとそのまま owned に移せる
   */
  tavern: CharacterEntry[];
  /**
   * 酒場の引き直しに要る今の賃料。引き直すたびに上がり (TAVERN_REROLL_RAISE)、
   * 出撃を終えると初期値 (TAVERN_REROLL_BASE) に戻る (粘りすぎを牽制しつつ、出撃間は仕切り直す)
   */
  tavernRerollCost: number;
  /**
   * 道具屋で回復薬を買う今の値段。買うたびに上がり (POTION_PRICE_RAISE)、
   * 出撃を終えると初期値 (POTION_PRICE_BASE) に戻る (酒場の引き直し賃料と同じ考え方)
   */
  potionPrice: number;
  /** 解放済みの区画。ボスを倒すと 1 つ増える */
  unlocked: number;
  /**
   * マナ払い出しの成長ぶん。区画のクリアで底上げする (中層クリアで +1 して、
   * 奇数ターンの基礎が偶数ターンと揃って 3/3 になる)
   */
  manaBonus: number;
  run: RunState | null;
  battle: BattleState | null;
  /** battle が何の遭遇から始まったか。battle が null のときは null */
  battleKind: BattleKind | null;
  /** 出撃を終えたときの結果。画面を閉じるまで残る */
  result: { won: boolean; depth: number; gold: number } | null;
  log: LogLineView[];
}

const LOG_LIMIT = 8;

/** source に一致する、まだ所持していないレアの一覧 */
function unownedRares(owned: readonly CharacterEntry[], source: 'tavern' | 'dungeon'): CharacterEntry[] {
  const ownedIds = new Set(owned.map((c) => c.id));
  return CHARACTERS.filter((c) => c.rarity === 'rare' && c.source === source && !ownedIds.has(c.id));
}

function hasUnownedRare(owned: readonly CharacterEntry[], source: 'tavern' | 'dungeon'): boolean {
  return unownedRares(owned, source).length > 0;
}

/** 固定の 3 人 (コーモン・スケサン・カクサン) の id。所持から外れず、雇用の上限にも数えない */
const FIXED_MEMBER_IDS = new Set(['hero', 'mate', 'aide2']);

/** 陣営ごとの所持人数。固定の 3 人は最初からいる例外で、雇用の上限には数えない */
function factionCount(owned: readonly CharacterEntry[], faction: Faction): number {
  return owned.filter((c) => c.faction === faction && !FIXED_MEMBER_IDS.has(c.id)).length;
}

/** まだ雇用の上限に達していない陣営の一覧。上限に達した陣営は酒場の抽選から外す */
function availableFactions(owned: readonly CharacterEntry[]): Faction[] {
  return FACTIONS.filter((f) => factionCount(owned, f) < FACTION_HIRE_CAP[f]);
}

/** faction の名前候補 (NAME_POOLS) に、まだ usedNames に無いものが 1 つでも残っているか */
function hasFreeName(faction: Faction, usedNames: ReadonlySet<string>): boolean {
  return NAME_POOLS[faction].some((n) => !usedNames.has(n));
}

/**
 * 酒場の抽選で誰も並べられない状態か。雇用の上限に達した陣営に加えて、
 * 名前の候補が (所持済みぶんも合わせて) 尽きた陣営も対象から外れる。
 * 未所持の酒場限定レアも無ければ、引き直しても誰も出てこない
 * (不具合の修正: 所持済みキャラの名前が酒場の候補から除かれていなかった)
 */
function tavernExhausted(owned: readonly CharacterEntry[]): boolean {
  if (hasUnownedRare(owned, 'tavern')) return false;
  const usedNames = new Set(owned.map((c) => c.name));
  return FACTIONS.every((f) => factionCount(owned, f) >= FACTION_HIRE_CAP[f] || !hasFreeName(f, usedNames));
}

/** 陣営の人口比 (FACTION_WEIGHT) で重み付けした抽選。pool は空でないこと */
function weightedFaction(rng: Rng, pool: readonly Faction[]): Faction {
  const total = pool.reduce((sum, f) => sum + FACTION_WEIGHT[f], 0);
  let roll = rng.next() * total;
  for (const f of pool) {
    roll -= FACTION_WEIGHT[f];
    if (roll < 0) return f;
  }
  return pool[pool.length - 1];
}

/**
 * 酒場に並ぶ個体の初期レベルを振る。進行が浅いうちは低め、進むほど幅を広げる
 * (docs/plan.md「酒場の品揃えと値段」)。unlocked (解放済みの区画数 1〜3) を進行度の目安にする
 */
function rollTavernLevel(rng: Rng, unlocked: number, maxLevel: number): number {
  const upper = 2 + (unlocked - 1) * 6;
  return Math.min(maxLevel, rng.int(1, Math.max(1, upper)));
}

/**
 * コモンを 1 人生成する。酒場の 1 回の品揃えの中で同じ名前が並ぶと見分けがつかないので、
 * 名前が使用済みなら生成し直す (陣営ごとの名前候補は雇用の上限より多く用意してあるので、
 * 数回のやり直しでまず解ける。上限を切って無限ループだけは避ける)。
 * 陣営は「まだ雇用の上限に達していない、かつ品揃えに出ていない」ものを人口比の重みで選ぶ
 * (3 枠すべて同じ陣営になるのを避けつつ、上限に達した陣営は並ばせない)
 */
function pickCommonAvoidingDuplicates(
  state: GameState,
  rng: Rng,
  usedNames: ReadonlySet<string>,
  usedFactions: ReadonlySet<Faction>,
  available: readonly Faction[],
): CharacterEntry {
  const freshFactions = available.filter((f) => !usedFactions.has(f));
  const factionPool = freshFactions.length > 0 ? freshFactions : available;
  const faction = weightedFaction(rng, factionPool);

  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = generateCommon(faction, rng, state.nextCommonId++);
    if (!usedNames.has(candidate.name)) return candidate;
  }
  // 20 回やり直しても衝突するのは名前候補が尽きるほど狭いときだけで、実運用では起きない想定。
  // それでも固まらないよう、最後は重複を許して返す
  return generateCommon(faction, rng, state.nextCommonId++);
}

/**
 * 酒場の品揃えを引き直す。コモンはその場で生成し (陣営は人口比の重みでランダム、
 * ただし品揃え内で散らす)、低確率 (TAVERN_RARE_CHANCE) で source: 'tavern' の未所持レアに
 * 差し替える。レア・コモンを問わず、酒場の 1 回の品揃えの中で同じ人・同じ名前が重複しないようにし、
 * 雇用の上限に達した陣営は並ばせない (達していれば TAVERN_SIZE 未満で終わることもある)。
 * 並ぶ個体の初期レベルもここでランダムに振る。
 *
 * usedNames は所持済みキャラの名前で種を撒く (不具合の修正)。これが無いと「今の品揃えの中」
 * だけで重複を避ける形になり、既に所持している名前の別個体が何度も並んでしまう
 * (プレイヤーには同じキャラが重複しているように見える)。
 */
function rerollTavern(state: GameState, rng: Rng): void {
  const picked: CharacterEntry[] = [];
  const usedRareIds = new Set<string>();
  const usedNames = new Set<string>(state.owned.map((c) => c.name));
  const usedFactions = new Set<Faction>();
  for (let i = 0; i < TAVERN_SIZE; i++) {
    const rareCandidates = unownedRares(state.owned, 'tavern').filter(
      (c) => !usedRareIds.has(c.id) && factionCount(state.owned, c.faction) < FACTION_HIRE_CAP[c.faction],
    );
    if (rareCandidates.length > 0 && rng.chance(TAVERN_RARE_CHANCE)) {
      const rare = instantiate(rng.pick(rareCandidates));
      rare.level = rollTavernLevel(rng, state.unlocked, rare.maxLevel);
      usedRareIds.add(rare.id);
      usedNames.add(rare.name);
      usedFactions.add(rare.faction);
      picked.push(rare);
      continue;
    }
    // 雇用の上限に達した陣営に加えて、名前の候補が (所持済みぶんも合わせて) 尽きた陣営も外す
    // (不具合の修正)。雇用上限を外すのと同じ扱いにする
    const available = availableFactions(state.owned).filter((f) => hasFreeName(f, usedNames));
    if (available.length === 0) break; // 誰も並べられない。品揃えが減る (最悪 0 人になる)
    const common = pickCommonAvoidingDuplicates(state, rng, usedNames, usedFactions, available);
    common.level = rollTavernLevel(rng, state.unlocked, common.maxLevel);
    usedNames.add(common.name);
    usedFactions.add(common.faction);
    picked.push(common);
  }
  state.tavern = picked;
}

export function newGame(seed: string): GameState {
  const rng = new Rng(hashSeed(seed));
  const hero = instantiate(CHARACTERS.find((c) => c.id === 'hero')!);
  const mate = instantiate(CHARACTERS.find((c) => c.id === 'mate')!);
  const aide2 = instantiate(CHARACTERS.find((c) => c.id === 'aide2')!);
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rngState: rng.state,
    gold: START_GOLD,
    potions: START_POTIONS,
    owned: [hero, mate, aide2],
    nextCommonId: 1,
    formation: emptyFormation(),
    formationTouched: false,
    tavern: [],
    tavernRerollCost: TAVERN_REROLL_BASE,
    potionPrice: POTION_PRICE_BASE,
    unlocked: 1,
    manaBonus: 0,
    run: null,
    battle: null,
    battleKind: null,
    result: null,
    log: [{ kind: 'info', text: '迷宮都市に着いた。' }],
  };
  rerollTavern(state, rng);
  state.rngState = rng.state;
  return state;
}

export function addLog(state: GameState, kind: LogLineView['kind'], text: string): void {
  state.log.push({ kind, text });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

/** 状態の rngState と読み書きが噛み合う Rng を作る */
function rngOf(state: GameState): Rng {
  return new Rng(state.rngState);
}

function commitRng(state: GameState, rng: Rng): void {
  state.rngState = rng.state;
}

// ---------------------------------------------------------------------------
// イベントの解決
//
// 戦闘 (battle / elite / ボス) は startBattle で battle.ts に委ねる。
// treasure / nothing はその場でパーティ HP と金だけを動かす軽いイベントなので resolveEvent
// (resolveTreasure/resolveNothing) にまとめる。spring / recruit / boss-alt は Party の構成
// そのもの (ダウン復帰・加入) を動かすので、個別の関数にしている。
//
// 罠 (trap) は単独のイベントとしては抽選されない (docs/plan.md「イベントの分岐」)。
// 宝箱を開けたとき・「何も無い」場所を通ったときの隠れた結果としてだけ出る。
// 見た目 (アイコン・題) は解決前も後も「宝箱」「何も無い」のまま変えない (開けるまで分からない)

interface Outcome {
  hp: number;
  gold: number;
  /** 宝イベントでまれに出る回復薬 (0 か 1)。今は使っていないが型は残しておく */
  potion: number;
  kind: LogLineView['kind'];
  text: string;
}

/** 罠の隠れた結果。宝箱・「何も無い」の両方から呼ぶ (docs/plan.md「イベントの分岐」) */
function trapOutcome(run: RunState, rng: Rng): Outcome {
  const hurt = Math.round((40 + run.depth * 9) * (0.8 + 0.4 * rng.next()));
  return { hp: -hurt, gold: 0, potion: 0, kind: 'warn', text: `罠だった。${hurt} 受けた。` };
}

/** 宝箱「開ける」。TREASURE_TRAP_CHANCE の確率で中身が罠に化ける */
function resolveTreasure(run: RunState, rng: Rng): Outcome {
  if (rng.chance(TREASURE_TRAP_CHANCE)) return trapOutcome(run, rng);
  const gold = Math.round((80 + run.depth * 20) * (0.8 + 0.4 * rng.next()));
  return { hp: 0, gold, potion: 0, kind: 'good', text: `箱には ${gold} G が入っていた。` };
}

/** 宝箱の代替「見送る」。何も得ない代わりに罠も踏まない */
function resolveTreasureSkip(): string {
  return '宝箱には触れず、そのまま通り過ぎた。';
}

/** 「何も無い」場所。NOTHING_TRAP_CHANCE の確率で実は罠だったことにする */
function resolveNothing(run: RunState, rng: Rng): Outcome {
  if (rng.chance(NOTHING_TRAP_CHANCE)) return trapOutcome(run, rng);
  return { hp: 0, gold: 0, potion: 0, kind: 'info', text: '何事もなく通り過ぎた。' };
}

/** Outcome (宝箱・「何も無い」の結果) を GameState/RunState へ反映する。全滅の判定もここで行う */
function applyOutcome(state: GameState, run: RunState, out: Outcome, rng: Rng): void {
  if (out.hp < 0) damage(run, -out.hp);
  else if (out.hp > 0) heal(run, out.hp);
  run.gold += out.gold;
  if (out.potion > 0) state.potions = Math.min(POTION_MAX, state.potions + out.potion);
  addLog(state, out.kind, out.text);
  if (isWiped(run)) {
    addLog(state, 'bad', '部隊は全滅した。稼ぎは通路に散らばった。');
    finishRun(state, false, rng);
  }
}

/** 泉。HP を最大値の半分回復し、sortieBump/spent をリセットし、ダウンした roster を全員復帰させる */
function resolveSpring(run: RunState): string {
  const back = Math.round(run.maxHp / 2);
  heal(run, back);
  const revived = reviveDowned(run);
  resetSortieProgress(run.party);
  return revived > 0 ? `泉で立て直した。${back} 回復した。${revived} 人が戦線に復帰した。` : `泉で立て直した。${back} 回復した。`;
}

/** ボス前の分岐イベント「回復する」。泉と同じ効果に加え HP は全回復する */
function resolveBossAltHeal(run: RunState): string {
  const revived = reviveDowned(run);
  resetSortieProgress(run.party);
  run.hp = run.maxHp;
  return revived > 0 ? `泉で全快した。${revived} 人が戦線に復帰した。` : '泉で全快した。';
}

/**
 * ボス前の分岐イベント「レアを迎える」。source: 'dungeon' の未所持レアから 1 人選び、
 * owned とデッキに入れる (docs/plan.md「レアリティと入手」)。
 * CHARACTERS の共有オブジェクトをそのまま積まないよう instantiate() でコピーする
 */
function resolveBossAltRare(state: GameState, run: RunState, rng: Rng): string {
  const candidates = unownedRares(state.owned, 'dungeon');
  if (candidates.length === 0) return resolveBossAltHeal(run);
  const picked = instantiate(rng.pick(candidates));
  state.owned.push(picked);
  addToDeck(run, picked, state.owned);
  return `${picked.name} が仲間になった。`;
}

/**
 * ダンジョン内の加入イベント。コモンは固定の名簿を持たないので、
 * 陣営をランダムに決めてその場で 1 人生成し、owned とデッキに入れる。
 * 酒場と同じく、雇用の上限に達した陣営は選ばない
 */
function resolveRecruit(state: GameState, run: RunState, rng: Rng): string {
  const available = availableFactions(state.owned);
  const faction = rng.pick(available.length > 0 ? available : FACTIONS);
  const picked = generateCommon(faction, rng, state.nextCommonId++);
  state.owned.push(picked);
  addToDeck(run, picked, state.owned);
  return `${picked.name} が仲間になった。`;
}

/** 泉の代替「経験値をもらう」。回復はしない代わりに、出撃メンバー全員にまとまった経験値が入る */
function resolveSpringAlt(state: GameState, run: RunState): string {
  const amount = Math.round(EXP_BASE.battle * (1 + run.depth / 10) * SPRING_ALT_EXP_MUL);
  awardExp(state, run, amount);
  return `泉の力を経験値に変えた。${amount} の経験値が入った。`;
}

/** 死体「漁る」。CORPSE_TRAP_CHANCE の確率で中身が罠に化ける (宝箱・「何も無い」と同じ仕掛け) */
function resolveCorpse(run: RunState, rng: Rng): Outcome {
  if (rng.chance(CORPSE_TRAP_CHANCE)) return trapOutcome(run, rng);
  const gold = Math.round((60 + run.depth * 15) * (0.8 + 0.4 * rng.next()));
  return { hp: 0, gold, potion: 0, kind: 'good', text: `亡骸を漁ると ${gold} G が出てきた。` };
}

/**
 * 隊商「買う」。所持金が足りない・回復薬が満杯なら買えない旨を伝えるだけで、
 * 罠のような代償は無い (単に足を止めただけで終わる)
 */
function resolveCaravan(state: GameState): { kind: LogLineView['kind']; text: string } {
  if (state.potions >= POTION_MAX) return { kind: 'info', text: '薬はもう十分持っている、と行商人は肩をすくめた。' };
  if (state.gold < CARAVAN_POTION_PRICE) return { kind: 'info', text: '持ち合わせが足りず、行商人はそのまま去っていった。' };
  state.gold -= CARAVAN_POTION_PRICE;
  state.potions += 1;
  return { kind: 'good', text: `回復薬を ${CARAVAN_POTION_PRICE} G で買った。` };
}

/** 祠「祈る」。泉の代替 (経験値をもらう) と同じ形にする */
function resolveShrinePray(state: GameState, run: RunState): string {
  const amount = Math.round(EXP_BASE.battle * (1 + run.depth / 10) * SHRINE_PRAY_EXP_MUL);
  awardExp(state, run, amount);
  return `祠に祈った。${amount} の経験値が入った。`;
}

/** 祠「壊す」。宝箱よりやや軽い金額にする (壊すだけの手間相応) */
function resolveShrineBreak(run: RunState, rng: Rng): string {
  const gold = Math.round((60 + run.depth * 15) * (0.8 + 0.4 * rng.next()));
  run.gold += gold;
  return `祠を壊すと ${gold} G が出てきた。`;
}

/**
 * 落石「押し通る」。HP を払って先へ進む。trapOutcome (受け身の罠) よりやや軽い代償にする
 * (自分で選んで受ける代償なので、踏んでしまう罠ほど痛くしない)
 */
function resolveRockfallPush(run: RunState, rng: Rng): Outcome {
  const hurt = Math.round((30 + run.depth * 7) * (0.8 + 0.4 * rng.next()));
  return { hp: -hurt, gold: 0, potion: 0, kind: 'warn', text: `瓦礫を押し通った。${hurt} 受けた。` };
}

/** 落石の代替「迂回する」。何も得ない代わりに何も失わない */
function resolveRockfallDetour(): string {
  return '安全な道を選び、遠回りをした。';
}

/** 休息「休む」。泉ほど大掛かりではない、HP を戻すだけの軽い休憩 (スキル消耗・ダウンは戻さない) */
function resolveRestHeal(run: RunState): string {
  const back = Math.round(run.maxHp * 0.25);
  heal(run, back);
  return `束の間、休息を取った。${back} 回復した。`;
}

/** 休息の代替「先を急ぐ」。回復はしない代わりに経験値をもらう */
function resolveRestPress(state: GameState, run: RunState): string {
  const amount = Math.round(EXP_BASE.battle * (1 + run.depth / 10) * REST_PRESS_EXP_MUL);
  awardExp(state, run, amount);
  return `休まず先を急いだ。${amount} の経験値が入った。`;
}

/**
 * 出撃を終える。勝てば戦利品を持ち帰り、負ければその出撃の稼ぎと回復薬を失う。
 * 酒場も道具屋の値段も仕切り直す (粘りすぎを牽制しつつ、出撃間は仕切り直す)
 */
function finishRun(state: GameState, won: boolean, rng: Rng): void {
  const run = state.run;
  if (!run) return;
  if (won) state.gold += run.gold;
  else state.potions = 0;
  state.result = { won, depth: run.depth, gold: won ? run.gold : 0 };
  state.run = null;
  state.tavernRerollCost = TAVERN_REROLL_BASE;
  state.potionPrice = POTION_PRICE_BASE;
  rerollTavern(state, rng);
}

// ---------------------------------------------------------------------------
// 戦闘

function enterBattle(state: GameState, run: RunState, kind: BattleKind, enemyDef: EnemyDef, line: string, rng: Rng): void {
  state.battle = startBattle(run.party, run.hp, run.maxHp, enemyDef, rng, state.manaBonus);
  state.battleKind = kind;
  addLog(state, 'warn', line);
}

/** battle.ts が積んだ (ダウンで Party から外れた) Fighter を run.downed へ回収する */
function drainDowned(run: RunState, b: BattleState): void {
  if (b.left.length === 0) return;
  run.downed.push(...b.left);
  b.left.length = 0;
}

/**
 * 経験値を出撃メンバー全員に加える (docs/plan.md「レベルと上限」)。
 * ダウン中は入らない仕様だが、呼び出し時点 (settleBattle) では drainDowned 済みで
 * ダウンした Fighter は既に run.party から抜けているので、ここでは front/reserve を
 * そのまま回せばよい。Fighter.id で owned (永続する CharacterEntry) を引いて書き込む
 */
function awardExp(state: GameState, run: RunState, amount: number): void {
  const members = [...run.party.front, ...run.party.reserve].filter((f): f is Fighter => f !== null);
  for (const f of members) {
    const entry = state.owned.find((c) => c.id === f.id);
    if (entry) addExp(entry, amount);
  }
}

/** 戦闘の決着を GameState 側へ反映する。victory / wipe / annihilated のときだけ動く */
function settleBattle(state: GameState, run: RunState, rng: Rng): void {
  const b = state.battle;
  if (!b) return;
  if (b.outcome === 'ongoing') return;

  // 戦闘中は battle.log をその場で見せているだけなので、抜けるときにまとめて本編ログへ移す
  for (const line of b.log) addLog(state, line.kind, line.text);

  if (b.outcome === 'fled') {
    // 逃げるが発動した戦闘。報酬は無し、パーティ HP は引き継ぎ、遭遇は消費される
    // (run.pending は既に null なのでそのまま探索を続けられる。ボス戦から逃げても区画は解放されない)
    run.hp = b.hp;
    refillFront(run.party);
    state.battle = null;
    state.battleKind = null;
    return;
  }

  if (b.outcome === 'victory') {
    run.hp = b.hp;
    const scale = 1 + run.depth / 10;
    const kind = state.battleKind;
    const gold =
      kind === 'boss'
        ? Math.round(rng.int(400, 700) * scale)
        : kind === 'elite'
          ? Math.round(rng.int(150, 250) * scale)
          : Math.round(rng.int(40, 90) * scale);
    run.gold += gold;
    addLog(state, 'good', `${gold} G を得た。`);
    // 経験値は出撃メンバー全員に入る (ダウン中は入らない)。強敵・ボスほど多い
    awardExp(state, run, Math.round(EXP_BASE[kind ?? 'battle'] * scale));
    refillFront(run.party);

    const wasBoss = kind === 'boss';
    state.battle = null;
    state.battleKind = null;
    if (wasBoss) {
      // 中層 (区画 2) のボスを倒すと、マナ払い出しの奇数ターンが底上げされ 3/3 の律動になる
      if (run.sectorId === 2) state.manaBonus = Math.max(state.manaBonus, 1);
      // 今は迷宮 1 本 (DUNGEONS[0]) だけなので決め打ちで参照する。迷宮が増えたら
      // run 側に迷宮 id を持たせて引き直す形になる
      if (state.unlocked === run.sectorId && state.unlocked < DUNGEONS[0].sectors.length) {
        state.unlocked += 1;
        addLog(state, 'good', `${sectorById(state.unlocked).name}への道が開いた。`);
      }
      finishRun(state, true, rng);
    }
    return;
  }

  // wipe (HP が尽きた) / annihilated (前衛が絶えた)。どちらも battle.log で理由は出ている
  addLog(state, 'bad', '出撃は終わった。稼ぎは通路に散らばった。');
  state.battle = null;
  state.battleKind = null;
  finishRun(state, false, rng);
}

// ---------------------------------------------------------------------------
// 遷移

export function step(state: GameState, action: Action): void {
  const rng = rngOf(state);
  switch (action.type) {
    case 'sortie': {
      if (state.run) break;
      if (action.sectorId > state.unlocked) break;
      state.run = startRun(action.sectorId, state.owned, state.formation, state.formationTouched);
      state.result = null;
      addLog(state, 'info', `${sectorById(action.sectorId).name}へ潜った。`);
      break;
    }

    case 'advance': {
      const run = state.run;
      if (!run || run.pending || run.atBoss || state.battle) break;
      advance(run, rng);
      if (run.atBoss) addLog(state, 'warn', '広間に出た。奥に守護者がいる。');
      break;
    }

    case 'resolve': {
      const run = state.run;
      if (!run || state.battle) break;
      if (run.atBoss) {
        const boss = makeBoss(run.sectorId, rng);
        enterBattle(state, run, 'boss', boss, `${boss.name} が立ちはだかる。`, rng);
        break;
      }
      if (!run.pending) break;
      const kind = run.pending.kind;
      switch (kind) {
        case 'battle':
        case 'elite': {
          run.pending = null;
          const foe = makeFoe(run.depth, rng, kind === 'elite');
          enterBattle(state, run, kind, foe, `${foe.name} が立ちはだかる。`, rng);
          break;
        }
        case 'boss-alt': {
          run.pending = null;
          addLog(state, 'good', resolveBossAltHeal(run));
          break;
        }
        case 'recruit': {
          run.pending = null;
          addLog(state, 'good', resolveRecruit(state, run, rng));
          break;
        }
        case 'spring': {
          run.pending = null;
          addLog(state, 'good', resolveSpring(run));
          break;
        }
        case 'treasure': {
          run.pending = null;
          applyOutcome(state, run, resolveTreasure(run, rng), rng);
          break;
        }
        case 'nothing': {
          run.pending = null;
          applyOutcome(state, run, resolveNothing(run, rng), rng);
          break;
        }
        case 'corpse': {
          run.pending = null;
          applyOutcome(state, run, resolveCorpse(run, rng), rng);
          break;
        }
        case 'caravan': {
          run.pending = null;
          const o = resolveCaravan(state);
          addLog(state, o.kind, o.text);
          break;
        }
        case 'shrine': {
          run.pending = null;
          addLog(state, 'good', resolveShrinePray(state, run));
          break;
        }
        case 'rockfall': {
          run.pending = null;
          applyOutcome(state, run, resolveRockfallPush(run, rng), rng);
          break;
        }
        case 'rest': {
          run.pending = null;
          addLog(state, 'good', resolveRestHeal(run));
          break;
        }
      }
      break;
    }

    case 'resolve-alt': {
      const run = state.run;
      if (!run || state.battle) break;
      if (!run.pending) break;
      switch (run.pending.kind) {
        case 'boss-alt': {
          if (!hasUnownedRare(state.owned, 'dungeon')) break;
          run.pending = null;
          addLog(state, 'good', resolveBossAltRare(state, run, rng));
          break;
        }
        case 'treasure': {
          if (!run.pending.altAction) break;
          run.pending = null;
          addLog(state, 'info', resolveTreasureSkip());
          break;
        }
        case 'spring': {
          if (!run.pending.altAction) break;
          run.pending = null;
          addLog(state, 'good', resolveSpringAlt(state, run));
          break;
        }
        case 'shrine': {
          if (!run.pending.altAction) break;
          run.pending = null;
          addLog(state, 'good', resolveShrineBreak(run, rng));
          break;
        }
        case 'rockfall': {
          if (!run.pending.altAction) break;
          run.pending = null;
          addLog(state, 'info', resolveRockfallDetour());
          break;
        }
        case 'rest': {
          if (!run.pending.altAction) break;
          run.pending = null;
          addLog(state, 'good', resolveRestPress(state, run));
          break;
        }
        default:
          // 二択を持たないイベントには resolve-alt が来ない想定。何もしない
          break;
      }
      break;
    }

    case 'retreat': {
      const run = state.run;
      if (!run || state.battle) break;
      addLog(state, 'info', '来た道を戻った。');
      finishRun(state, true, rng);
      break;
    }

    case 'dismiss':
      state.result = null;
      break;

    case 'hire': {
      if (state.run || state.battle) break;
      const idx = state.tavern.findIndex((c) => c.id === action.id);
      if (idx < 0) break;
      const entry = state.tavern[idx];
      const price = priceOf(entry);
      if (state.gold < price) break;
      state.gold -= price;
      // 酒場に並んでいた個体そのものを所持に移す。生成コモンはこの参照を保つことで、
      // 雇った後も同じ個体 (スキル・数値・今のレベル) のまま残る
      state.owned.push(entry);
      state.tavern.splice(idx, 1);
      addLog(state, 'good', `${entry.name} を雇った。`);
      break;
    }

    case 'reroll-tavern': {
      if (state.run || state.battle) break;
      if (state.gold < state.tavernRerollCost) break;
      state.gold -= state.tavernRerollCost;
      state.tavernRerollCost = Math.round(state.tavernRerollCost * TAVERN_REROLL_RAISE);
      rerollTavern(state, rng);
      addLog(state, 'info', '品揃えを引き直した。');
      break;
    }

    case 'buy-potion': {
      if (state.run || state.battle) break;
      if (state.potions >= POTION_MAX) break;
      if (state.gold < state.potionPrice) break;
      state.gold -= state.potionPrice;
      state.potions += 1;
      state.potionPrice = Math.round(state.potionPrice * POTION_PRICE_RAISE);
      addLog(state, 'good', '回復薬を買った。');
      break;
    }

    case 'formation-set': {
      // 拠点の編成画面だけの操作にする。出撃中は state.formation を触らず、
      // 代わりに dungeon-formation-set でその場のデッキを並べ替える
      if (state.run || state.battle) break;
      if (action.id !== null && !state.owned.some((c) => c.id === action.id)) break;
      if (!state.formationTouched) {
        // 初回の編集はまず今の自動詰めの並びを確定させてから 1 枠だけ変える。
        // でないと isFormationUnset が false になった瞬間、自動詰めしていた
        // 残り 5 枠まで表示上いっせいに空くバグになる (このスロットしか触っていないのに)
        state.formation = autoFillFormation(state.owned.map((c) => c.id));
        state.formationTouched = true;
      }
      placeInFormation(state.formation, action.slot, action.id);
      break;
    }

    case 'formation-clear-all': {
      if (state.run || state.battle) break;
      state.formation = emptyFormation();
      state.formationTouched = true;
      break;
    }

    case 'dungeon-formation-set': {
      const run = state.run;
      if (!run || state.battle) break;
      setFrontMember(run.party, action.slot, action.id);
      break;
    }

    case 'potion': {
      if (state.potions <= 0) break;
      const run = state.run;
      if (!run) break;
      const b = state.battle;
      if (b && b.outcome === 'ongoing') {
        const healed = usePotion(b);
        state.potions -= 1;
        addLog(state, 'good', `回復薬を使った。${healed} 回復した。`);
      } else if (!b) {
        const back = Math.round(run.maxHp / 2);
        heal(run, back);
        state.potions -= 1;
        addLog(state, 'good', `回復薬を使った。${back} 回復した。`);
      }
      break;
    }

    case 'battle-skill': {
      const run = state.run;
      const b = state.battle;
      if (!run || !b) break;
      useSkill(b, action.slot, action.skill, rng);
      drainDowned(run, b);
      settleBattle(state, run, rng);
      break;
    }

    case 'battle-defense': {
      const b = state.battle;
      if (!b) break;
      useDefense(b);
      break;
    }

    case 'battle-swap': {
      const run = state.run;
      const b = state.battle;
      if (!run || !b) break;
      swapMembers(b, action.moves);
      drainDowned(run, b);
      settleBattle(state, run, rng);
      break;
    }

    case 'battle-flee': {
      const b = state.battle;
      if (!b) break;
      toggleFlee(b, rng);
      break;
    }

    case 'battle-end-turn': {
      const run = state.run;
      const b = state.battle;
      if (!run || !b) break;
      endTurn(b, rng);
      // 大技・ダウン攻撃それぞれ「あと 1」になったターンの終わりに警告を出す。
      // アイコンだけだと見落とすため。ルールではなく戦況の言い換えなので、
      // ここ (game.ts) で battle.log に足す
      if (b.outcome === 'ongoing' && b.enemy.hp > 0) {
        if (b.enemy.bigCountdown === 1) logBattle(b, 'warn', `${b.enemy.def.name} が力を溜めている。`);
        if (b.enemy.downCountdown === 1) logBattle(b, 'warn', `${b.enemy.def.name} がダウン攻撃の構えを見せた。`);
        if (b.enemy.stunCountdown === 1) logBattle(b, 'warn', `${b.enemy.def.name} がスタンの構えを見せた。`);
      }
      drainDowned(run, b);
      settleBattle(state, run, rng);
      break;
    }
  }
  commitRng(state, rng);
}

// ---------------------------------------------------------------------------
// ViewModel

function resistLabel(resist: 'physical' | 'magic' | null): string | null {
  return resist === 'physical' ? '物理' : resist === 'magic' ? '魔法' : null;
}

function skillNote(oncePerSortie: boolean | undefined, selfDown: boolean | undefined): string | null {
  const tags: string[] = [];
  if (oncePerSortie) tags.push('1回限定');
  if (selfDown) tags.push('代償');
  return tags.length > 0 ? tags.join('・') : null;
}

function skillCategoryLabel(category: SkillCategory): string {
  return category === 'physical' ? '物理' : category === 'magic' ? '魔法' : '必殺';
}

/** スキルの効果を短文にする。編成画面の詳細タップで見せる (main.ts では組み立てない) */
function skillEffectText(def: ActionSkillDef): string {
  const e = def.effect;
  switch (e.kind) {
    case 'attack':
      return e.target === 'all' ? `敵全体に威力 ${e.power.toFixed(1)} の攻撃` : `敵に威力 ${e.power.toFixed(1)} の攻撃`;
    case 'heal':
      return `HP を最大値の ${Math.round(e.power * 100)}% 回復`;
    case 'cheer':
      return `鼓舞を ${e.stacks} 枚積む (1 枚につき攻撃 +20%、3 枚まで)`;
    case 'ward':
      return `ガードを ${e.stacks} 枚積む (1 枚につき被ダメージ -20%、3 枚まで)`;
    case 'barrier':
      return '次に来る敵の攻撃を 1 回無効化';
    case 'dispel':
      return '敵の鼓舞・ガードのスタックを 1 回で全部剥がす';
    case 'stun-self':
      return '代償として自分がその場でスタンする';
  }
}

function skillDetailOf(def: ActionSkillDef): SkillDetailView {
  return {
    name: def.name,
    cost: def.baseCost,
    category: skillCategoryLabel(def.category),
    effect: skillEffectText(def),
    note: skillNote(def.oncePerSortie, def.selfDown),
  };
}

/** パッシブの効果を短文にする。現行のパッシブはどれも単一の hook しか持たないが、複数あれば併記する */
function passiveEffectText(p: PassiveDef): string {
  const parts: string[] = [];
  const h = p.hooks;
  if (h.manaPerTurn) parts.push(`マナ払い出し ${h.manaPerTurn > 0 ? '+' : ''}${h.manaPerTurn}`);
  if (h.defenseRate) parts.push(`防御軽減率 ${h.defenseRate > 0 ? '+' : ''}${Math.round(h.defenseRate * 100)}%`);
  if (h.telegraph) parts.push(`大技・ダウン攻撃の予告 ${h.telegraph > 0 ? '+' : ''}${h.telegraph} ターン`);
  if (h.cover) parts.push('ボスの大技を前衛にいる間、身代わりする');
  return parts.length > 0 ? parts.join('・') : '効果なし';
}

function passiveDetailOf(p: PassiveDef): PassiveDetailView {
  return { name: p.name, effect: passiveEffectText(p) };
}

/**
 * 予告バッジ用の書き下しラベル。「大3」「ダ2」のような略記をやめ、実際の技名で見せる。
 * 大技は EnemyDef.bigName (雑魚は総称の「大技」、ボスは固有名)、ダウン攻撃は名前を持たないので総称のまま
 */
function bigCountdownLabel(e: EnemyState): string {
  return `${e.def.bigName} あと${e.bigCountdown}`;
}

function downCountdownLabel(e: EnemyState): string | null {
  return e.downCountdown === null ? null : `ダウン攻撃 あと${e.downCountdown}`;
}

function toBattleView(b: BattleState, potions: number, owned: readonly CharacterEntry[]): BattleView {
  const e = b.enemy;
  return {
    kind: 'battle',
    hp: b.hp,
    maxHp: b.maxHp,
    mana: b.mana,
    manaCap: MANA_CAP,
    defense: b.defense,
    defenseMax: DEFENSE_MAX,
    barrier: b.barrier,
    turn: b.turn,
    combo: b.combo,
    cheerStacks: b.cheer.stacks,
    cheerTurns: b.cheer.turns,
    cheerMax: BUFF_STACK_MAX,
    wardStacks: b.ward.stacks,
    wardTurns: b.ward.turns,
    wardMax: BUFF_STACK_MAX,
    fleeIn: b.fleeIn,
    potions,
    enemy: {
      name: e.def.name,
      groupSize: e.def.groupSize,
      hp: e.hp,
      maxHp: e.def.maxHp,
      resist: resistLabel(e.def.resist),
      bigCountdown: e.bigCountdown,
      bigLabel: bigCountdownLabel(e),
      downLabel: downCountdownLabel(e),
      // 敵の鼓舞・防御。味方の cheerStacks/wardStacks と同じ形で、状態アイコン列に出す
      // (今まで battle.ts の計算には入っていたのに画面に出ておらず、効果が無いように見えていた不具合)
      cheerStacks: e.cheer.stacks,
      cheerTurns: e.cheer.turns,
      wardStacks: e.ward.stacks,
      wardTurns: e.ward.turns,
      alive: e.hp > 0,
      isBoss: e.def.isBoss,
    },
    slots: b.party.front.map((f, slot) => {
      if (!f) return null;
      return {
        name: f.name,
        faction: FACTION_NAMES[f.faction],
        stunned: f.stunnedUntil > 0 && b.turn <= f.stunnedUntil,
        skills: f.skills.map((s, skillIndex) => ({
          name: s.def.name,
          shortName: s.def.shortName,
          cost: effectiveCost(s),
          raised: s.turnBump + s.sortieBump,
          usable: whyCannotUse(b, slot, skillIndex) === null,
          reason: whyCannotUse(b, slot, skillIndex),
          note: skillNote(s.def.oncePerSortie, s.def.selfDown),
        })),
      };
    }),
    reserve: b.party.reserve.map((f) => fighterCard(f, owned)),
    swapCooldown: b.party.swapCooldown,
    canDefense: b.defense < DEFENSE_MAX && b.mana >= DEFENSE_COST,
  };
}

/**
 * CharacterEntry (固定定義かその場で生成した個体) をカードにする。酒場・所持一覧・編成の
 * 候補一覧すべてで使う。一覧行の要約 (名前・陣営・レアリティ・攻撃力・体力) と、
 * タップして開く詳細 (スキル・パッシブの効果) を両方含める。
 * mul (陣営倍率) を掛けた実効値にする。素の値では編成・雇用の判断に使えない
 */
function characterCard(entry: CharacterEntry, mul: number): FormationCharacterView {
  return {
    id: entry.id,
    name: entry.name,
    faction: FACTION_NAMES[entry.faction],
    skills: skillLabels(entry),
    rarity: entry.rarity,
    attack: Math.round(effectiveAttack(entry) * mul),
    vitality: Math.round(effectiveVitality(entry) * mul),
    level: entry.level,
    maxLevel: entry.maxLevel,
    skillDetails: entry.skills.map(skillDetailOf),
    passiveDetails: entry.passives.map(passiveDetailOf),
  };
}

/**
 * 出撃済みの Fighter を characterCard と同じ形のカードにする (ダンジョン内の編成・交代ピッカー用)。
 * レアリティ・レベル・レベル上限は owned (所持キャラそのもの) から引く。生成コモンも所持した個体を
 * そのまま owned に積んでいるので、CHARACTERS (固定定義) を見なくても owned だけで引ける。
 * attack/vitality は陣営倍率 (Fighter.attack/vitality に焼き込み済み) と前衛補正 (vanguardMul) の
 * 両方を掛けた実効値にする。素の値では編成・交代の判断に使えない
 * (growth/curve は owned 側にしか無いマスクパラメータなので、ここにも出てこない)
 */
function fighterCard(f: Fighter, owned: readonly CharacterEntry[]): FormationCharacterView {
  const entry = owned.find((c) => c.id === f.id);
  return {
    id: f.id,
    name: f.name,
    faction: FACTION_NAMES[f.faction],
    skills: [...f.skills.map((s) => s.def.name), ...f.passives.map((p) => p.name)],
    rarity: entry?.rarity ?? 'common',
    attack: effectiveFighterAttack(f),
    vitality: effectiveFighterVitality(f),
    level: entry?.level ?? 1,
    maxLevel: entry?.maxLevel ?? 1,
    skillDetails: f.skills.map((s) => skillDetailOf(s.def)),
    passiveDetails: f.passives.map(passiveDetailOf),
  };
}

/** id の列 (前衛 6 枠) を編成カードの並びにする */
function toFormationSlots(
  owned: readonly CharacterEntry[],
  formation: readonly (string | null)[],
  totals: FactionTotals,
): FormationSlotView[] {
  return formation.map((id) => {
    if (!id) return { character: null };
    const entry = owned.find((c) => c.id === id);
    return { character: entry ? characterCard(entry, factionMultiplierOf(totals, entry)) : null };
  });
}

/** ダンジョン内 (戦闘外) の編成データ。今の Party (front/reserve) の中身だけを見せる */
function toDungeonFormationView(run: RunState, owned: readonly CharacterEntry[]): DungeonFormationView {
  const front = run.party.front;
  const slots: FormationSlotView[] = front.map((f) => ({ character: f ? fighterCard(f, owned) : null }));
  const members = [...front.filter((f): f is Fighter => f !== null), ...run.party.reserve];
  const roster = members.map((f) => {
    const idx = front.indexOf(f);
    return { ...fighterCard(f, owned), placedSlot: idx >= 0 ? idx : null };
  });
  return { slots, roster };
}

function toDungeonView(run: RunState, potions: number, owned: readonly CharacterEntry[]): DungeonView {
  const sector = sectorOf(run);
  const pending = run.atBoss
    ? { kind: 'boss' as const, title: '守護者', body: '奥から重い足音がする。', action: '挑む' }
    : run.pending
      ? {
          kind: run.pending.kind,
          title: run.pending.title,
          body: run.pending.body,
          action: run.pending.action,
          // boss-alt だけ、未所持レアが尽きていれば二択自体を隠す。他のイベント (宝・泉) は
          // 二択の抽選 (ALT_CHANCE) を run.ts 側で既に済ませてあるので、altAction をそのまま出す
          alt: run.pending.kind === 'boss-alt' ? (hasUnownedRare(owned, 'dungeon') ? run.pending.altAction : undefined) : run.pending.altAction,
        }
      : null;
  return {
    kind: 'dungeon',
    sectorName: sector.name,
    depth: run.depth,
    goal: sector.depth,
    hp: run.hp,
    maxHp: run.maxHp,
    // 通路の見た目だけを 4 段で回す。ゲーム状態ではない
    corridor: run.depth % 4,
    event: pending,
    front: run.party.front.map((f) => ({ character: f ? fighterCard(f, owned) : null })),
    frontCount: run.party.front.filter((f) => f !== null).length,
    reserveCount: run.party.reserve.length,
    downedCount: run.downed.length,
    potions,
    formation: toDungeonFormationView(run, owned),
  };
}

function toTownView(state: GameState): TownView {
  const resolved = resolveFormation(
    state.owned.map((c) => c.id),
    state.formation,
    state.formationTouched,
  );
  // 所持ベースの陣営倍率 (roster.ts)。owned に対する合算を先に 1 回だけ出し、
  // 個々のカードはここから自分のぶんを引いた倍率を使う (factionMultiplierOf)
  const totals = factionTotals(state.owned);
  const formation: FormationEditorView = {
    slots: toFormationSlots(state.owned, resolved, totals),
    auto: !state.formationTouched,
    roster: state.owned.map((entry) => {
      const idx = resolved.indexOf(entry.id);
      return { ...characterCard(entry, factionMultiplierOf(totals, entry)), placedSlot: idx >= 0 ? idx : null };
    }),
    // 何を集めると何が伸びるかを見せる (「王国 x1.32」のような形)。集める動機そのものになる
    factionMultipliers: FACTIONS.map((faction) => ({
      faction,
      name: FACTION_NAMES[faction],
      multiplier: factionMultiplier(totals, faction),
    })),
  };

  return {
    kind: 'town',
    gold: state.gold,
    potions: state.potions,
    // 今は迷宮 1 本 (DUNGEONS[0]) だけなので、その区画一覧をそのまま「迷宮の一覧」として出す。
    // 迷宮が増えたら、ここを dungeons 一覧 + 選んだ迷宮の区画一覧の 2 段に分ける
    sectors: DUNGEONS[0].sectors.map((s) => ({
      id: s.id,
      name: s.name,
      depth: s.depth,
      unlocked: s.id <= state.unlocked,
    })),
    tavern: state.tavern.map((entry) => {
      const price = priceOf(entry);
      // 酒場の面々はまだ所持していないので「自分のぶんを引く」必要が無い (selfContribution 省略)。
      // 今の所持だけを土台にした、雇ったらどうなるかの見積もりになる
      return { ...characterCard(entry, factionMultiplier(totals, entry.faction)), price, affordable: state.gold >= price };
    }),
    rerollCost: state.tavernRerollCost,
    // 金が足りないときに加えて、引き直しても誰も出てこない (tavernExhausted) ときも押せなくする。
    // 押しても何も変わらないボタンを活かしておく意味が無いため (不具合の修正)
    rerollAffordable: state.gold >= state.tavernRerollCost && !tavernExhausted(state.owned),
    potionPrice: state.potionPrice,
    potionMax: POTION_MAX,
    potionBuyable: state.potions < POTION_MAX && state.gold >= state.potionPrice,
    roster: state.owned.map((entry) => characterCard(entry, factionMultiplierOf(totals, entry))),
    formation,
  };
}

export function toViewModel(state: GameState): ViewModel {
  if (state.result) {
    return { screen: { kind: 'result', ...state.result }, log: [...state.log] };
  }

  if (state.battle) {
    // 戦闘中は本編ログの末尾に battle.log をつないで、直近の場面が読めるようにする。
    // 本編ログそのものへは決着時 (settleBattle) にまとめて移すので、ここでは二重に積まない
    const log = [...state.log, ...state.battle.log].slice(-LOG_LIMIT);
    return { screen: toBattleView(state.battle, state.potions, state.owned), log };
  }

  const log = [...state.log];

  const run = state.run;
  if (run) {
    return { screen: toDungeonView(run, state.potions, state.owned), log };
  }

  return { screen: toTownView(state), log };
}
