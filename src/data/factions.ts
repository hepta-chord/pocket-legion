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
