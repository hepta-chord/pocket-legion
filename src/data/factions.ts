// 陣営の定義。
// キャラの所属は id で持ち、表示名はここで引く。

export type Faction = 'kingdom' | 'order' | 'mercs' | 'frontier';

export const FACTION_NAMES: Record<Faction, string> = {
  kingdom: '王国',
  order: '教団',
  mercs: '傭兵団',
  frontier: '辺境',
};

export const FACTIONS: readonly Faction[] = ['kingdom', 'order', 'mercs', 'frontier'];

/**
 * 陣営の人口。王国 > 教団 > 傭兵団 > 辺境の順に少なくなる (docs/plan.md「陣営の人口」)。
 * 酒場に並ぶ確率の重みと、雇用の上限の両方にこの比率をそのまま使う (「重みも同じ比率でよい」)。
 * 主人公・相棒はこの上限に数えない
 */
export const FACTION_HIRE_CAP: Record<Faction, number> = {
  kingdom: 12,
  order: 9,
  mercs: 6,
  frontier: 3,
};

/** 酒場に並ぶ確率の重み。FACTION_HIRE_CAP と同じ比率を使う */
export const FACTION_WEIGHT: Record<Faction, number> = FACTION_HIRE_CAP;
