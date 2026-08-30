import { describe, expect, it } from 'vitest';
import type { EventKind } from '../data/events';
import { eventIconFor } from './event-icons';

// white-space: pre で描画するので折り返しはしないが、行ごとに幅が違うと絵が歪んで見える
// (以前ここで不具合が出ている)。本文の行 (先頭 4 行) は同じ文字数で揃っているはずで、
// ラベル行 (5 行目) は全角の語を詰めているぶん短くなるのが仕様なので別扱いにする
const KINDS: readonly (EventKind | 'boss')[] = [
  'battle',
  'elite',
  'treasure',
  'spring',
  'nothing',
  'recruit',
  'caravan',
  'shrine',
  'rockfall',
  'corpse',
  'rest',
  'boss-alt',
  'boss',
];

describe('eventIconFor (アイコンの等幅)', () => {
  it('どの種別も 5 行のアイコンを返す', () => {
    for (const kind of KINDS) {
      expect(eventIconFor(kind)).toHaveLength(5);
    }
  });

  it('本文 4 行 (絵の部分) は種別ごとに文字数が揃っている', () => {
    for (const kind of KINDS) {
      const art = eventIconFor(kind);
      const bodyLengths = new Set(art.slice(0, 4).map((line) => line.length));
      expect(bodyLengths.size, `kind=${kind} の本文行の幅が揃っていない`).toBe(1);
    }
  });

  it('新設 5 種 (隊商・祠・落石・死体・休息) は他と別のアイコンを持つ (取り違えていない)', () => {
    const newKinds: (EventKind | 'boss')[] = ['caravan', 'shrine', 'rockfall', 'corpse', 'rest'];
    const arts = newKinds.map((k) => eventIconFor(k).join('\n'));
    expect(new Set(arts).size).toBe(newKinds.length);
  });

  it('未知の種別は宝箱にフォールバックする', () => {
    expect(eventIconFor('unknown-kind')).toEqual(eventIconFor('treasure'));
  });
});
