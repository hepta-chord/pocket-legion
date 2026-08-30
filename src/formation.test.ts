import { describe, expect, it } from 'vitest';
import { newParty } from './battle';
import { buildFighter, type CharacterEntry } from './data/characters';
import type { Faction } from './data/factions';
import {
  autoFillFormation,
  emptyFormation,
  isFormationUnset,
  partyFromRosterAndFormation,
  placeInFormation,
  resolveFormation,
  setFrontMember,
} from './formation';

// テストは固定名簿 (data/characters.ts) の中身に依存しない。
// コモンが生成に変わって固定 id (k1, k2 ...) を持たなくなったので、
// ここでは owned (CharacterEntry[]) をその場で組み立てて渡す
function entry(id: string, faction: Faction = 'kingdom'): CharacterEntry {
  return {
    id,
    name: id,
    faction,
    rarity: 'common',
    price: 120,
    attack: 100,
    vitality: 50,
    skills: [],
    passives: [],
  };
}

const OWNED = ['hero', 'mate', 'k1', 'k2'].map((id) => entry(id));
const ROSTER = OWNED.map((c) => c.id);

describe('emptyFormation / isFormationUnset', () => {
  it('空の編成は長さ 6 で全部 null、isFormationUnset は true', () => {
    const f = emptyFormation();
    expect(f).toHaveLength(6);
    expect(f.every((id) => id === null)).toBe(true);
    expect(isFormationUnset(f)).toBe(true);
  });

  it('1 箇所でも埋まっていれば unset ではない', () => {
    const f = emptyFormation();
    f[0] = 'hero';
    expect(isFormationUnset(f)).toBe(false);
  });
});

describe('autoFillFormation / resolveFormation', () => {
  it('roster の先頭 6 人を前衛に詰める', () => {
    const f = autoFillFormation(ROSTER);
    expect(f.slice(0, 4)).toEqual(ROSTER);
    expect(f.slice(4)).toEqual([null, null]);
  });

  it('formation が空なら自動詰めに落ちる', () => {
    expect(resolveFormation(ROSTER, emptyFormation())).toEqual(autoFillFormation(ROSTER));
  });

  it('formation が設定済みならそのまま使う (自動詰めをしない)', () => {
    const manual = ['k1', null, null, null, null, null];
    expect(resolveFormation(ROSTER, manual)).toEqual(manual);
  });
});

describe('placeInFormation', () => {
  it('スロットに置く', () => {
    const f = emptyFormation();
    placeInFormation(f, 2, 'k1');
    expect(f[2]).toBe('k1');
  });

  it('同じキャラが既に別スロットにいれば、そちらを空にしてから置く (重複配置の禁止)', () => {
    const f = emptyFormation();
    placeInFormation(f, 0, 'k1');
    placeInFormation(f, 3, 'k1');
    expect(f[0]).toBeNull();
    expect(f[3]).toBe('k1');
    expect(f.filter((id) => id === 'k1')).toHaveLength(1);
  });

  it('id に null を渡すとそのスロットを空にする', () => {
    const f = emptyFormation();
    placeInFormation(f, 1, 'k1');
    placeInFormation(f, 1, null);
    expect(f[1]).toBeNull();
  });
});

describe('partyFromRosterAndFormation', () => {
  it('編成が空 (初期状態) なら owned の先頭 6 人を前衛に、残りを控えにする', () => {
    const bigOwned = [...OWNED, entry('k3'), entry('o1'), entry('o2'), entry('o3')];
    const party = partyFromRosterAndFormation(bigOwned, emptyFormation());
    expect(party.front.filter(Boolean)).toHaveLength(6);
    // デッキは絞らない仕様なので、owned 全員が前衛か控えのどちらかに入る
    expect(party.front.filter(Boolean).length + party.reserve.length).toBe(bigOwned.length);
  });

  it('owned 全員が出撃デッキに入る (控えの人数に上限は無い)', () => {
    const bigOwned = [...OWNED, entry('k3'), entry('o1'), entry('o2'), entry('o3')];
    const party = partyFromRosterAndFormation(bigOwned, emptyFormation());
    const seatedIds = new Set(
      [...party.front.filter((f): f is NonNullable<typeof f> => f !== null), ...party.reserve].map((f) => f.id),
    );
    expect(seatedIds.size).toBe(bigOwned.length);
    for (const c of bigOwned) expect(seatedIds.has(c.id)).toBe(true);
  });

  it('編成で選んだ前衛がそのまま前衛になり、選ばれなかった owned は控えになる', () => {
    const formation = ['k2', null, null, null, null, null];
    const party = partyFromRosterAndFormation(OWNED, formation);
    expect(party.front[0]?.id).toBe('k2');
    expect(party.front.slice(1).every((f) => f === null)).toBe(true);
    expect(party.reserve.map((f) => f.id).sort()).toEqual(['hero', 'k1', 'mate']);
  });

  it('生成コモン (owned に積まれた個体そのもの) のスキルもそのまま Fighter に反映される', () => {
    const generated: CharacterEntry = {
      id: 'common-1',
      name: 'レイン',
      faction: 'kingdom',
      rarity: 'common',
      price: 120,
      attack: 111,
      vitality: 47,
      skills: [
        {
          id: 'gen-attack',
          name: '通常攻撃',
          shortName: '攻撃',
          category: 'physical',
          baseCost: 1,
          effect: { kind: 'attack', target: 'one', power: 1.0 },
        },
      ],
      passives: [],
    };
    const party = partyFromRosterAndFormation([generated], emptyFormation());
    const f = party.front[0];
    expect(f?.id).toBe('common-1');
    expect(f?.attack).toBe(111);
    expect(f?.skills[0].def.name).toBe('通常攻撃');
  });
});

describe('setFrontMember (ダンジョン内の並べ替え)', () => {
  function fighterOf(id: string) {
    return buildFighter(OWNED.find((c) => c.id === id)!);
  }

  function partyOf(frontIds: string[], reserveIds: string[] = []) {
    return newParty(frontIds.map(fighterOf), reserveIds.map(fighterOf));
  }

  it('控えのキャラを前衛スロットに入れると、元の前衛は控えに回る', () => {
    const party = partyOf(['hero', 'mate'], ['k1']);
    setFrontMember(party, 0, 'k1');
    expect(party.front[0]?.id).toBe('k1');
    expect(party.reserve.map((f) => f.id)).toContain('hero');
    expect(party.front.filter(Boolean)).toHaveLength(2);
  });

  it('前衛同士を指定すると入れ替わる', () => {
    const party = partyOf(['hero', 'mate']);
    setFrontMember(party, 0, 'mate');
    expect(party.front[0]?.id).toBe('mate');
    expect(party.front[1]?.id).toBe('hero');
  });

  it('id に null を渡すとそのスロットが空き、元の前衛は控えに回る', () => {
    const party = partyOf(['hero', 'mate']);
    setFrontMember(party, 0, null);
    expect(party.front[0]).toBeNull();
    expect(party.reserve.map((f) => f.id)).toContain('hero');
  });

  it('人数は増減しない', () => {
    const party = partyOf(['hero', 'mate', 'k1', 'k2']);
    const before = party.front.filter(Boolean).length + party.reserve.length;
    setFrontMember(party, 0, 'k2');
    setFrontMember(party, 5, 'hero');
    const after = party.front.filter(Boolean).length + party.reserve.length;
    expect(after).toBe(before);
  });
});
