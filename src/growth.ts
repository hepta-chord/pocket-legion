// レベルと成長カーブの計算。
//
// 「上限に届くまでの伸び方 (カーブの型)」と「どこまで伸びるか (growth・maxLevel)」を
// 分けて持つ (docs/plan.md「成長カーブ」)。カーブは進捗 t = (level-1)/(maxLevel-1) の
// 形だけを変え、どの型でも t=1 (レベル上限) では同じ値に揃う。
// growth・curve は「マスクパラメータ」(プレイヤーには見せない) なので、ここで計算はしても
// ViewModel には出さない (game.ts 側の責務)。

export type Curve = 'linear' | 'early' | 'late';

/** レベル・経験値・成長の型を持つ最小限の形。CharacterEntry はこれを満たす */
export interface Growable {
  level: number;
  maxLevel: number;
  growth: number;
  curve: Curve;
}

/** カーブの型ごとの形。直線 t / 早熟 sqrt(t) / 晩成 t^2。t=0 と t=1 はどの型でも同じ値になる */
function curveShape(curve: Curve, t: number): number {
  switch (curve) {
    case 'linear':
      return t;
    case 'early':
      return Math.sqrt(t);
    case 'late':
      return t * t;
  }
}

/** 0〜1 に正規化した進捗をカーブの型に通した値。maxLevel が 1 (上限なし相当) なら常に 1 扱いにする */
export function growthFactor(g: Growable): number {
  const denom = g.maxLevel - 1;
  const t = denom <= 0 ? 1 : Math.min(1, Math.max(0, (g.level - 1) / denom));
  return curveShape(g.curve, t);
}

/** base を今のレベルなりの実効値にする。上限到達時は base * (1 + growth) に揃う */
export function effectiveStat(base: number, g: Growable): number {
  return Math.round(base * (1 + g.growth * growthFactor(g)));
}

/** レベル N → N+1 に要る経験値。素直に増える式で足りる (docs/plan.md 8 節: 数値の調整はしない) */
export function expToNextLevel(level: number): number {
  return Math.round(20 + level * 12);
}

/**
 * 経験値を加え、上限まで自動でレベルを上げる。上がった回数を返す。
 * 上限に着いたキャラは経験値を受け取っても伸びしろが無いので、以後は捨てる
 * (exp も 0 に戻し、無意味に貯め続けないようにする)
 */
export function addExp(g: Growable & { exp: number }, amount: number): number {
  if (g.level >= g.maxLevel) return 0;
  g.exp += amount;
  let levels = 0;
  while (g.level < g.maxLevel) {
    const need = expToNextLevel(g.level);
    if (g.exp < need) break;
    g.exp -= need;
    g.level += 1;
    levels += 1;
  }
  if (g.level >= g.maxLevel) g.exp = 0;
  return levels;
}
