// 計測結果を表に畳む。

import type { SectorReport } from './autoplay';

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const num = (v: number): string => v.toFixed(1);

export function formatReports(rows: SectorReport[]): string {
  const header = ['区画', '出撃', '生還率', '勝ち戦', 'ターン/戦', '交代/出撃', '交代なし', '前衛全滅'];
  const table = [
    header,
    ...rows.map((r) => [
      r.label,
      String(r.sorties),
      pct(r.winRate),
      num(r.avgBattlesWon),
      num(r.avgTurnsPerBattle),
      num(r.avgSwaps),
      pct(r.zeroSwapRate),
      pct(r.annihilatedRate),
    ]),
  ];
  const widths = header.map((_, c) => Math.max(...table.map((row) => row[c].length)));
  return table.map((row) => row.map((cell, c) => cell.padStart(widths[c])).join('  ')).join('\n');
}
