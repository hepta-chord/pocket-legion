import { CORRIDOR_SIZE, corridorLines } from './corridor';
import type { Renderer } from './renderer';
import type { ViewModel } from '../view';

/**
 * Canvas に文字グリッドで描く。
 * 描くのはダンジョンの通路だけで、拠点と結果の画面は DOM が受け持つ。
 * 通路が無い画面のときは何も描かず、canvas を隠すのは main.ts の仕事にしている。
 */
export class TextRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private cell = { w: 0, h: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d コンテキストを取得できません');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    // 表示サイズが 0 のまま描くと以降ずっと空になるので、測り直した値をそのつど反映する
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cell = {
      w: rect.width / CORRIDOR_SIZE.width,
      h: rect.height / CORRIDOR_SIZE.height,
    };
  }

  draw(vm: ViewModel): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    if (vm.screen.kind !== 'dungeon') return;

    const size = Math.min(this.cell.w * 1.6, this.cell.h);
    this.ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = '#5f7a8a';

    const lines = corridorLines(vm.screen.corridor);
    for (let y = 0; y < lines.length; y++) {
      for (let x = 0; x < lines[y].length; x++) {
        const ch = lines[y][x];
        if (ch === ' ') continue;
        this.ctx.fillText(ch, x * this.cell.w, y * this.cell.h);
      }
    }
  }
}
