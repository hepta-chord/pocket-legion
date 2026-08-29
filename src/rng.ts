// シード付き乱数 (mulberry32)。
// Math.random はシードを指定できず、友人と同じダンジョンを共有できないので自作している。
// state を保存・復元できるようにして、セーブデータからゲームを再現できるようにする。

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0;
  }

  /** [0, 1) の浮動小数 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** min 以上 max 以下の整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** 文字列のシードを 32bit 整数に変換する (FNV-1a) */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 読み間違えやすい 0/O・1/I を除いた文字だけを使う
const SEED_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 人が読み上げて伝えられる 6 文字のシード */
export function randomSeedString(): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)];
  }
  return s;
}

export function normalizeSeed(input: string): string {
  return input.trim().toUpperCase();
}
