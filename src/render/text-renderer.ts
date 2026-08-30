import { CORRIDOR_SIZE, corridorLines } from './corridor';
import type { Renderer } from './renderer';
import type { ViewModel } from '../view';

/** 文字セルの縦横比 (幅/高さ)。等幅フォントの字形に近い比率で、枠の縦横比が
 * どう変わっても通路の絵の形そのものは崩れないようにするための固定値 */
const CHAR_ASPECT = 0.6;

/**
 * Canvas に文字グリッドで描く。
 * 描くのはダンジョンの通路だけで、拠点と結果の画面は DOM が受け持つ。
 * 通路が無い画面のときは何も描かず、canvas を隠すのは main.ts の仕事にしている。
 */
export class TextRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private cell = { w: 0, h: 0 };
  /** 直近に resize() で測った表示枠の CSS px サイズ。同じ値での測り直しを弾いて無駄な
   * canvas クリアを避ける (main.ts の render() は毎回 resize() を呼ぶため) */
  private lastRect = { w: -1, h: -1 };
  /** 直近の draw() 呼び出しの引数。ResizeObserver から測り直したあと同じ絵で描き直すために持つ */
  private lastVm: ViewModel | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d コンテキストを取得できません');
    this.ctx = ctx;

    // canvas 自体の縦横比を文字グリッドと同じ比率に固定する (style.css 側は #corridor に
    // aspect-ratio を書いていないので、ここで唯一の値渡し元として与える)。これで
    // ステージの高さが場面ごとに変わっても canvas の形自体は変わらず、大きさだけが変わる
    canvas.style.aspectRatio = `${CORRIDOR_SIZE.width * CHAR_ASPECT} / ${CORRIDOR_SIZE.height}`;

    this.resize();

    // 初回描画はレイアウト確定前の寸法で測ってしまうことがあり (flex の高さが
    // まだ確定していない、など)、そのあと別の描画契機で再測定されると実寸とズレて
    // 絵が変わって見えてしまう (通路の絵が途中で変わるバグの原因)。
    // 測り直しの契機を時間や描画回数に頼らず、表示枠そのものの変化を監視して
    // 変わったらここで測り直してから直前の絵を描き直す
    const observer = new ResizeObserver(() => {
      this.resize();
      if (this.lastVm) this.draw(this.lastVm);
    });
    observer.observe(canvas);
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    // 表示サイズが 0 のまま描くと以降ずっと空になるので、測り直した値をそのつど反映する。
    // ただし前回と同じ大きさなら測り直しても結果は変わらないので、canvas の再確保 (中身が
    // 消える) を避けるためにここで打ち切る
    if (rect.width === this.lastRect.w && rect.height === this.lastRect.h) return;
    this.lastRect = { w: rect.width, h: rect.height };

    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // canvas 自体の CSS 縦横比 (aspect-ratio) が CORRIDOR_SIZE と同じ比率に固定されているので、
    // 幅から計算しても高さから計算しても同じ大きさの文字セルになる。余白を振る必要もない
    // (contain のための min() 計算・offset はここでは不要になった)
    this.cell = { w: rect.width / CORRIDOR_SIZE.width, h: rect.height / CORRIDOR_SIZE.height };
  }

  draw(vm: ViewModel): void {
    this.lastVm = vm;
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
