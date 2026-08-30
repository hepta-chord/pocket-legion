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

  /** #corridor の親 (#stage)。この要素の実寸を基準に、文字グリッドと同じ縦横比を
   * 保ったまま収まる最大サイズを計算する */
  private readonly stage: HTMLElement;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d コンテキストを取得できません');
    this.ctx = ctx;
    const stage = canvas.parentElement;
    if (!stage) throw new Error('#corridor の親要素が見つかりません');
    this.stage = stage;

    // canvas 自体の縦横比を文字グリッドと同じ比率に固定する。style.css 側の
    // max-width/max-height:100% と合わせて、CSS だけで見た初期状態やスクリプト無効時にも
    // 崩れた形にはならないようにする (実際の px サイズは resize() が JS 側で確定させる。
    // canvas は width/height 属性 (描画解像度) を持つ replaced element で、一度でも小さい
    // 値で初期化されるとブラウザがその値を「もとの大きさ」として扱ってしまい、
    // aspect-ratio や max-width/max-height を指定していてもそこから先は大きくなれなくなる
    // (Chromium で実測して確認済み)。そのため実際のレイアウトは canvas 自身の
    // getBoundingClientRect() ではなく、常に親 (#stage) の実寸から計算する)
    canvas.style.aspectRatio = `${CORRIDOR_SIZE.width * CHAR_ASPECT} / ${CORRIDOR_SIZE.height}`;

    this.resize();

    // 初回描画はレイアウト確定前の寸法で測ってしまうことがあり (flex の高さが
    // まだ確定していない、など)、そのあと別の描画契機で再測定されると実寸とズレて
    // 絵が変わって見えてしまう (通路の絵が途中で変わるバグの原因)。
    // 測り直しの契機を時間や描画回数に頼らず、表示枠そのものの変化を監視して
    // 変わったらここで測り直してから直前の絵を描き直す。観測対象は canvas 自身ではなく
    // #stage (親) にする。canvas 自身のサイズはこちらが style.width/height で決めるので、
    // 監視すべきは「収まる先の枠が変わったかどうか」であって canvas 自身の結果ではない
    const observer = new ResizeObserver(() => {
      this.resize();
      if (this.lastVm) this.draw(this.lastVm);
    });
    observer.observe(this.stage);
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    // border を含まない内寸 (#stage は border:1px + overflow:hidden) を使う
    const availW = this.stage.clientWidth;
    const availH = this.stage.clientHeight;
    // 表示サイズが 0 のまま描くと以降ずっと空になるので、測り直した値をそのつど反映する。
    // ただし前回と同じ大きさなら測り直しても結果は変わらないので、canvas の再確保 (中身が
    // 消える) を避けるためにここで打ち切る
    if (availW === this.lastRect.w && availH === this.lastRect.h) return;
    this.lastRect = { w: availW, h: availH };

    // 文字セルは固定の縦横比 (CHAR_ASPECT) で保ち、枠の縦横比に合わせて引き伸ばさない。
    // 枠の幅・高さのどちらに合わせても収まりきる方のスケールを選ぶ (contain と同じ考え方)。
    // canvas の CSS サイズをここで確定させてしまうので、中央寄せは #stage 側の
    // display:flex + align-items/justify-content:center に任せられる (余白を自分で
    // 振る必要はない)
    const scale = Math.min(availW / (CORRIDOR_SIZE.width * CHAR_ASPECT), availH / CORRIDOR_SIZE.height);
    const cssW = CORRIDOR_SIZE.width * CHAR_ASPECT * scale;
    const cssH = CORRIDOR_SIZE.height * scale;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.cell = { w: cssW / CORRIDOR_SIZE.width, h: cssH / CORRIDOR_SIZE.height };
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
