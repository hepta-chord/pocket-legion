// 疑似 3D の通路をアスキーで組み立てる。
//
// マップを持たないので、ここに描くものはゲーム状態ではない。
// 「進んでいる感じ」を出すためだけの飾りである。
//
// 枠を等比で入れ子に描き、深度に応じて位相をずらす。
// 位相が 1 周ぶん進むと枠が 1 つ手前に流れてくるので、
// 段を作り直さずに前進のアニメーションになる。

const WIDTH = 33;
const HEIGHT = 15;
/** 1 段奥に行くときの縮小率 */
const RATIO = 0.62;
/** 位相の分割数。深度 PHASES 回で枠が 1 つぶん流れる */
const PHASES = 4;

export function corridorLines(depth: number): string[] {
  const rows: string[][] = [];
  for (let y = 0; y < HEIGHT; y++) rows.push(new Array(WIDTH).fill(' '));

  const cx = (WIDTH - 1) / 2;
  const cy = (HEIGHT - 1) / 2;
  const phase = (((depth % PHASES) + PHASES) % PHASES) / PHASES;

  let inner: { left: number; right: number; top: number; bottom: number } | null = null;

  // t = -1 から始めると、位相が進むにつれて画面の外から新しい枠が入ってくる
  for (let i = -1; i < 6; i++) {
    const t = i + phase;
    const halfX = cx * Math.pow(RATIO, t);
    const halfY = cy * Math.pow(RATIO, t);
    // 画面からはみ出す枠はまだ手前すぎるので飛ばす
    if (halfX > cx || halfY > cy) continue;
    const left = Math.round(cx - halfX);
    const right = Math.round(cx + halfX);
    const top = Math.round(cy - halfY);
    const bottom = Math.round(cy + halfY);
    // 枠が近づきすぎると縦線が固まって潰れて見えるので、間隔を保てる大きさで打ち切る
    if (halfX < 3.5 || halfY < 2) break;

    for (let x = left; x <= right; x++) {
      rows[top][x] = '-';
      rows[bottom][x] = '-';
    }
    for (let y = top; y <= bottom; y++) {
      rows[y][left] = '|';
      rows[y][right] = '|';
    }
    inner = { left, right, top, bottom };
  }

  if (inner) drawCorners(rows, cx, cy, inner);

  return rows.map((r) => r.join('').replace(/\s+$/, ''));
}

/**
 * 四隅から中心へ向かう斜線を引き、枠と枠の間を奥行きでつなぐ。
 * 既に文字がある位置と、最も奥の枠の内側には書かない。
 * 内側まで引くと通路の突き当たりが斜線で埋まってしまう。
 */
function drawCorners(
  rows: string[][],
  cx: number,
  cy: number,
  inner: { left: number; right: number; top: number; bottom: number },
): void {
  const corners = [
    { x: 0, y: 0, ch: '\\' },
    { x: WIDTH - 1, y: 0, ch: '/' },
    { x: 0, y: HEIGHT - 1, ch: '/' },
    { x: WIDTH - 1, y: HEIGHT - 1, ch: '\\' },
  ];
  for (const c of corners) {
    const dx = cx - c.x;
    const dy = cy - c.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(c.x + (dx * i) / steps);
      const y = Math.round(c.y + (dy * i) / steps);
      if (x > inner.left && x < inner.right && y > inner.top && y < inner.bottom) break;
      if (rows[y][x] === ' ') rows[y][x] = c.ch;
    }
  }
}

export const CORRIDOR_SIZE = { width: WIDTH, height: HEIGHT };
