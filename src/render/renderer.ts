import type { ViewModel } from '../view';

/**
 * 描画層の境界。
 * ゲーム本体は ViewModel を渡すだけで、文字で描くか画像で描くかを知らない。
 * タイル画像で描きたくなったら、このインターフェースを実装した TileRenderer を足して
 * main.ts で差し込む。
 */
export interface Renderer {
  draw(vm: ViewModel): void;
  /** キャンバスの表示サイズが変わったときに呼ぶ */
  resize(): void;
}
