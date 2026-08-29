import { describe, expect, it } from 'vitest';
import { CORRIDOR_SIZE, corridorLines } from './corridor';

describe('corridorLines', () => {
  it('決まった高さで、横幅に収まる', () => {
    for (let depth = 0; depth < 12; depth++) {
      const lines = corridorLines(depth);
      expect(lines).toHaveLength(CORRIDOR_SIZE.height);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(CORRIDOR_SIZE.width);
    }
  });

  it('位相 1 周ぶんの 4 段がすべて違う見た目になる', () => {
    const seen = new Set([0, 1, 2, 3].map((d) => corridorLines(d).join('\n')));
    expect(seen.size).toBe(4);
  });

  it('位相は 4 段で一周する', () => {
    expect(corridorLines(5).join('\n')).toBe(corridorLines(1).join('\n'));
  });

  it('通路の突き当たりは斜線で埋まらない', () => {
    for (let depth = 0; depth < 4; depth++) {
      const lines = corridorLines(depth);
      const middle = lines[Math.floor(CORRIDOR_SIZE.height / 2)];
      expect(middle[Math.floor(CORRIDOR_SIZE.width / 2)]).toBe(' ');
    }
  });
});
