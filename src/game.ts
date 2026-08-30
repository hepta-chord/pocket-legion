// 最上位の状態機械。
//
// 入力 (Action) を受けて状態を進め、描画層に渡す ViewModel を組み立てる。
// ここは render/ を import しない。文字で描くか画像で描くかを知らないままにしておく。

import {
  effectiveCost,
  endTurn,
  GUARD_COST,
  GUARD_MAX,
  MANA_CAP,
  refillFront,
  resetSortieProgress,
  startBattle,
  swapMembers,
  useGuard,
  usePotion,
  useSkill,
  whyCannotUse,
  type BattleState,
  type EnemyDef,
  type Fighter,
  type SwapMove,
} from './battle';
import { CHARACTERS, skillLabels, type CharacterEntry } from './data/characters';
import { FACTION_NAMES } from './data/factions';
import { makeBoss, makeFoe } from './data/enemies';
import { SECTORS, sectorById } from './data/sectors';
import type { ActionSkillDef, PassiveDef, SkillCategory } from './data/skills';
import {
  emptyFormation,
  isFormationUnset,
  placeInFormation,
  resolveFormation,
  setFrontMember,
  type Formation,
} from './formation';
import { hashSeed, Rng } from './rng';
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

// 編成 (formation) を足して GameState の形が変わったので、古いセーブと噛み合わなくなる。
// 区切りを上げて捨てる
export const SAVE_VERSION = 5;

/** 回復薬の所持上限 */
const POTION_MAX = 3;
/** 出撃開始時の所持金。コモン 2 人を雇って 60 残る水準 */
const START_GOLD = 300;

export type Action =
  | { type: 'sortie'; sectorId: number }
  | { type: 'advance' }
  | { type: 'resolve' }
  /** ボス前の分岐イベントだけが持つ、もう一方の選択肢 (レアの加入) */
  | { type: 'resolve-alt' }
  | { type: 'retreat' }
  | { type: 'dismiss' }
  | { type: 'hire'; id: string }
  | { type: 'potion' }
  /** 拠点の編成画面。所持キャラの一覧から前衛スロットへ配置する。id が null ならそのスロットを空にする */
  | { type: 'formation-set'; slot: number; id: string | null }
  /** ダンジョン内 (戦闘外) の編成。今のデッキの中から前衛スロットの中身を選び直す。新しいキャラは増やせない */
  | { type: 'dungeon-formation-set'; slot: number; id: string | null }
  | { type: 'battle-skill'; slot: number; skill: number }
  | { type: 'battle-guard' }
  | { type: 'battle-swap'; moves: SwapMove[] }
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
  /** 所持キャラの id 列。hero と mate は常に含む */
  roster: string[];
  /**
   * 前衛の編成。長さ 6 固定、値は roster の id か空きを示す null。
   * デッキは絞らないので、控えは前衛に選ばれなかった roster 全員が自動で務める。
   * 全スロット空 (初期状態) のときだけ roster の先頭 6 人を自動で詰める (resolveFormation)
   */
  formation: Formation;
  /** 今の酒場の品揃え (コモンの id、最大 3 人) */
  tavern: string[];
  /** 解放済みの区画。ボスを倒すと 1 つ増える */
  unlocked: number;
  run: RunState | null;
  battle: BattleState | null;
  /** battle が何の遭遇から始まったか。battle が null のときは null */
  battleKind: BattleKind | null;
  /** 出撃を終えたときの結果。画面を閉じるまで残る */
  result: { won: boolean; depth: number; gold: number } | null;
  log: LogLineView[];
}

const LOG_LIMIT = 8;

/** 所持していないコモンから rng で最大 3 人を引く (足りなければあるだけ) */
function rerollTavern(state: GameState, rng: Rng): void {
  const remaining = CHARACTERS.filter((c) => c.rarity === 'common' && !state.roster.includes(c.id));
  const picked: string[] = [];
  for (let i = 0; i < 3 && remaining.length > 0; i++) {
    const idx = rng.int(0, remaining.length - 1);
    picked.push(remaining[idx].id);
    remaining.splice(idx, 1);
  }
  state.tavern = picked;
}

function hasUnownedRare(roster: readonly string[]): boolean {
  return CHARACTERS.some((c) => c.rarity === 'rare' && !roster.includes(c.id));
}

export function newGame(seed: string): GameState {
  const rng = new Rng(hashSeed(seed));
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rngState: rng.state,
    gold: START_GOLD,
    potions: 0,
    roster: ['hero', 'mate'],
    formation: emptyFormation(),
    tavern: [],
    unlocked: 1,
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
// treasure / trap はその場でパーティ HP と金だけを動かす軽いイベントなので resolveEvent に
// まとめる。spring / recruit / boss-alt は Party の構成そのもの (ダウン復帰・加入) を
// 動かすので、個別の関数にしている。

interface Outcome {
  hp: number;
  gold: number;
  /** 宝イベントでまれに出る回復薬 (0 か 1) */
  potion: number;
  kind: LogLineView['kind'];
  text: string;
}

function resolveEvent(run: RunState, kind: 'treasure' | 'trap', rng: Rng): Outcome {
  const roll = () => 0.8 + 0.4 * rng.next();
  switch (kind) {
    case 'treasure': {
      const gold = Math.round((80 + run.depth * 20) * roll());
      const potion = rng.chance(0.3) ? 1 : 0;
      const note = potion ? ' 底に回復薬も 1 個沈んでいた。' : '';
      return { hp: 0, gold, potion, kind: 'good', text: `箱には ${gold} G が入っていた。${note}` };
    }
    case 'trap': {
      const hurt = Math.round((40 + run.depth * 9) * roll());
      return { hp: -hurt, gold: 0, potion: 0, kind: 'warn', text: `罠が弾けた。${hurt} 受けた。` };
    }
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

/** ボス前の分岐イベント「レアを迎える」。未所持のレアから 1 人選び、roster とデッキに入れる */
function resolveBossAltRare(state: GameState, run: RunState, rng: Rng): string {
  const candidates = CHARACTERS.filter((c) => c.rarity === 'rare' && !state.roster.includes(c.id));
  if (candidates.length === 0) return resolveBossAltHeal(run);
  const picked = rng.pick(candidates);
  state.roster.push(picked.id);
  addToDeck(run, picked);
  return `${picked.name} が仲間になった。`;
}

/** ダンジョン内の加入イベント。所持していないコモンから 1 人、無ければ金に化ける */
function resolveRecruit(state: GameState, run: RunState, rng: Rng): string {
  const candidates = CHARACTERS.filter((c) => c.rarity === 'common' && !state.roster.includes(c.id));
  if (candidates.length === 0) {
    const gold = Math.round(100 * (1 + run.depth / 10));
    run.gold += gold;
    return `見知った顔ばかりだった。かわりに ${gold} G を渡された。`;
  }
  const picked = rng.pick(candidates);
  state.roster.push(picked.id);
  addToDeck(run, picked);
  return `${picked.name} が仲間になった。`;
}

/** 出撃を終える。勝てば戦利品を持ち帰り、負ければその出撃の稼ぎと回復薬を失う */
function finishRun(state: GameState, won: boolean, rng: Rng): void {
  const run = state.run;
  if (!run) return;
  if (won) state.gold += run.gold;
  else state.potions = 0;
  state.result = { won, depth: run.depth, gold: won ? run.gold : 0 };
  state.run = null;
  rerollTavern(state, rng);
}

// ---------------------------------------------------------------------------
// 戦闘

function enterBattle(state: GameState, run: RunState, kind: BattleKind, enemyDef: EnemyDef, line: string): void {
  state.battle = startBattle(run.party, run.hp, run.maxHp, enemyDef);
  state.battleKind = kind;
  addLog(state, 'warn', line);
}

/** battle.ts が積んだ (ダウンで Party から外れた) Fighter を run.downed へ回収する */
function drainDowned(run: RunState, b: BattleState): void {
  if (b.left.length === 0) return;
  run.downed.push(...b.left);
  b.left.length = 0;
}

/** 戦闘の決着を GameState 側へ反映する。victory / wipe / annihilated のときだけ動く */
function settleBattle(state: GameState, run: RunState, rng: Rng): void {
  const b = state.battle;
  if (!b) return;
  if (b.outcome === 'ongoing') return;

  // 戦闘中は battle.log をその場で見せているだけなので、抜けるときにまとめて本編ログへ移す
  for (const line of b.log) addLog(state, line.kind, line.text);

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
    refillFront(run.party);

    const wasBoss = kind === 'boss';
    state.battle = null;
    state.battleKind = null;
    if (wasBoss) {
      if (state.unlocked === run.sectorId && state.unlocked < SECTORS.length) {
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
      state.run = startRun(action.sectorId, state.roster, state.formation);
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
        enterBattle(state, run, 'boss', boss, `${boss.name} が立ちはだかる。`);
        break;
      }
      if (!run.pending) break;
      const kind = run.pending.kind;
      switch (kind) {
        case 'battle':
        case 'elite': {
          run.pending = null;
          const foe = makeFoe(run.depth, rng, kind === 'elite');
          enterBattle(state, run, kind, foe, `${foe.name} が立ちはだかる。`);
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
        case 'treasure':
        case 'trap': {
          const out = resolveEvent(run, kind, rng);
          run.pending = null;
          if (out.hp < 0) damage(run, -out.hp);
          else if (out.hp > 0) heal(run, out.hp);
          run.gold += out.gold;
          if (out.potion > 0) state.potions = Math.min(POTION_MAX, state.potions + out.potion);
          addLog(state, out.kind, out.text);
          if (isWiped(run)) {
            addLog(state, 'bad', '部隊は全滅した。稼ぎは通路に散らばった。');
            finishRun(state, false, rng);
          }
          break;
        }
      }
      break;
    }

    case 'resolve-alt': {
      const run = state.run;
      if (!run || state.battle) break;
      if (!run.pending || run.pending.kind !== 'boss-alt') break;
      if (!hasUnownedRare(state.roster)) break;
      run.pending = null;
      addLog(state, 'good', resolveBossAltRare(state, run, rng));
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
      if (!state.tavern.includes(action.id)) break;
      if (state.roster.includes(action.id)) break;
      const entry = CHARACTERS.find((c) => c.id === action.id);
      if (!entry) break;
      if (state.gold < entry.price) break;
      state.gold -= entry.price;
      state.roster.push(entry.id);
      state.tavern = state.tavern.filter((id) => id !== entry.id);
      addLog(state, 'good', `${entry.name} を雇った。`);
      break;
    }

    case 'formation-set': {
      // 拠点の編成画面だけの操作にする。出撃中は state.formation を触らず、
      // 代わりに dungeon-formation-set でその場のデッキを並べ替える
      if (state.run || state.battle) break;
      if (action.id !== null && !state.roster.includes(action.id)) break;
      placeInFormation(state.formation, action.slot, action.id);
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

    case 'battle-guard': {
      const b = state.battle;
      if (!b) break;
      useGuard(b);
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

    case 'battle-end-turn': {
      const run = state.run;
      const b = state.battle;
      if (!run || !b) break;
      endTurn(b, rng);
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
    case 'buff':
      return `攻撃に +${Math.round(e.power * 100)}% の支援`;
    case 'barrier':
      return '次に来る敵の攻撃を 1 回無効化';
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
  if (h.guardRate) parts.push(`ガード軽減率 ${h.guardRate > 0 ? '+' : ''}${Math.round(h.guardRate * 100)}%`);
  if (h.telegraph) parts.push(`大技の予告 ${h.telegraph > 0 ? '+' : ''}${h.telegraph} ターン`);
  if (h.cover) parts.push('ボスの大技を前衛にいる間、身代わりする');
  return parts.length > 0 ? parts.join('・') : '効果なし';
}

function passiveDetailOf(p: PassiveDef): PassiveDetailView {
  return { name: p.name, effect: passiveEffectText(p) };
}

function toBattleView(b: BattleState, potions: number): BattleView {
  const e = b.enemy;
  return {
    kind: 'battle',
    hp: b.hp,
    maxHp: b.maxHp,
    mana: b.mana,
    manaCap: MANA_CAP,
    guard: b.guard,
    guardMax: GUARD_MAX,
    barrier: b.barrier,
    turn: b.turn,
    combo: b.combo,
    buff: b.buff,
    potions,
    enemy: {
      name: e.def.name,
      groupSize: e.def.groupSize,
      hp: e.hp,
      maxHp: e.def.maxHp,
      resist: resistLabel(e.def.resist),
      countdown: e.countdown,
      alive: e.hp > 0,
      isBoss: e.def.isBoss,
    },
    slots: b.party.front.map((f, slot) => {
      if (!f) return null;
      return {
        name: f.name,
        faction: FACTION_NAMES[f.faction],
        skills: f.skills.map((s, skillIndex) => ({
          name: s.def.name,
          cost: effectiveCost(s),
          raised: s.turnBump + s.sortieBump,
          usable: whyCannotUse(b, slot, skillIndex) === null,
          reason: whyCannotUse(b, slot, skillIndex),
          note: skillNote(s.def.oncePerSortie, s.def.selfDown),
        })),
      };
    }),
    reserve: b.party.reserve.map(fighterCard),
    swapCooldown: b.party.swapCooldown,
    canGuard: b.guard < GUARD_MAX && b.mana >= GUARD_COST,
  };
}

/**
 * roster の id からキャラ定義を引いてカードにする。酒場・所持一覧・編成の候補一覧すべてで使う。
 * 一覧行の要約 (名前・陣営・レアリティ・攻撃力・体力) と、タップして開く詳細
 * (スキル・パッシブの効果) を両方含める
 */
function characterCard(entry: CharacterEntry): FormationCharacterView {
  return {
    id: entry.id,
    name: entry.name,
    faction: FACTION_NAMES[entry.faction],
    skills: skillLabels(entry),
    rarity: entry.rarity,
    attack: entry.attack,
    vitality: entry.vitality,
    skillDetails: entry.skills.map(skillDetailOf),
    passiveDetails: entry.passives.map(passiveDetailOf),
  };
}

/**
 * 出撃済みの Fighter を characterCard と同じ形のカードにする (ダンジョン内の編成・交代ピッカー用)。
 * レアリティはキャラ定義から引く (Fighter 自体は持たない)
 */
function fighterCard(f: Fighter): FormationCharacterView {
  const entry = CHARACTERS.find((c) => c.id === f.id);
  return {
    id: f.id,
    name: f.name,
    faction: FACTION_NAMES[f.faction],
    skills: [...f.skills.map((s) => s.def.name), ...f.passives.map((p) => p.name)],
    rarity: entry?.rarity ?? 'common',
    attack: f.attack,
    vitality: f.vitality,
    skillDetails: f.skills.map((s) => skillDetailOf(s.def)),
    passiveDetails: f.passives.map(passiveDetailOf),
  };
}

/** id の列 (前衛 6 枠) を編成カードの並びにする */
function toFormationSlots(formation: readonly (string | null)[]): FormationSlotView[] {
  return formation.map((id) => {
    if (!id) return { character: null };
    const entry = CHARACTERS.find((c) => c.id === id);
    return { character: entry ? characterCard(entry) : null };
  });
}

/** ダンジョン内 (戦闘外) の編成データ。今の Party (front/reserve) の中身だけを見せる */
function toDungeonFormationView(run: RunState): DungeonFormationView {
  const front = run.party.front;
  const slots: FormationSlotView[] = front.map((f) => ({ character: f ? fighterCard(f) : null }));
  const members = [...front.filter((f): f is Fighter => f !== null), ...run.party.reserve];
  const roster = members.map((f) => {
    const idx = front.indexOf(f);
    return { ...fighterCard(f), placedSlot: idx >= 0 ? idx : null };
  });
  return { slots, roster };
}

function toDungeonView(run: RunState, potions: number, roster: readonly string[]): DungeonView {
  const sector = sectorOf(run);
  const pending = run.atBoss
    ? { title: '守護者', body: '奥から重い足音がする。', action: '挑む' }
    : run.pending
      ? run.pending.kind === 'boss-alt'
        ? {
            title: run.pending.title,
            body: run.pending.body,
            action: run.pending.action,
            alt: hasUnownedRare(roster) ? run.pending.altAction : undefined,
          }
        : { title: run.pending.title, body: run.pending.body, action: run.pending.action }
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
    front: run.party.front.map((f) => ({ character: f ? fighterCard(f) : null })),
    frontCount: run.party.front.filter((f) => f !== null).length,
    reserveCount: run.party.reserve.length,
    downedCount: run.downed.length,
    potions,
    formation: toDungeonFormationView(run),
  };
}

function toTownView(state: GameState): TownView {
  const entryOf = (id: string) => CHARACTERS.find((c) => c.id === id);
  const rosterEntries = state.roster.map(entryOf).filter((c): c is CharacterEntry => c !== undefined);

  const resolved = resolveFormation(state.roster, state.formation);
  const formation: FormationEditorView = {
    slots: toFormationSlots(resolved),
    auto: isFormationUnset(state.formation),
    roster: rosterEntries.map((entry) => {
      const idx = resolved.indexOf(entry.id);
      return { ...characterCard(entry), placedSlot: idx >= 0 ? idx : null };
    }),
  };

  return {
    kind: 'town',
    gold: state.gold,
    potions: state.potions,
    sectors: SECTORS.map((s) => ({
      id: s.id,
      name: s.name,
      depth: s.depth,
      unlocked: s.id <= state.unlocked,
    })),
    tavern: state.tavern
      .map(entryOf)
      .filter((c): c is CharacterEntry => c !== undefined)
      .map((entry) => ({ ...characterCard(entry), price: entry.price, affordable: state.gold >= entry.price })),
    roster: rosterEntries.map(characterCard),
    formation,
  };
}

export function toViewModel(state: GameState): ViewModel {
  if (state.result) {
    return { screen: { kind: 'result', ...state.result }, log: [...state.log], seed: state.seed };
  }

  if (state.battle) {
    // 戦闘中は本編ログの末尾に battle.log をつないで、直近の場面が読めるようにする。
    // 本編ログそのものへは決着時 (settleBattle) にまとめて移すので、ここでは二重に積まない
    const log = [...state.log, ...state.battle.log].slice(-LOG_LIMIT);
    return { screen: toBattleView(state.battle, state.potions), log, seed: state.seed };
  }

  const log = [...state.log];

  const run = state.run;
  if (run) {
    return { screen: toDungeonView(run, state.potions, state.roster), log, seed: state.seed };
  }

  return { screen: toTownView(state), log, seed: state.seed };
}
