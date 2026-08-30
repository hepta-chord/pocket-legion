import { SAVE_VERSION, type GameState } from './game';

const KEY = 'pocket-legion/save/v1';

// localStorage が使えない環境 (プライベートブラウズなど) でも落ちないように、失敗は握りつぶす。
//
// 古い形式のセーブは変換せずに捨てる。
// 改修のたびに GameState が変わる段階なので、変換を積むと形式の数だけはしごが伸びる。
// 捨てたことは呼び出し側に伝えて、黙って新しいゲームが始まらないようにする。

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 保存できなくてもゲームは続ける */
  }
}

export interface LoadResult {
  state: GameState | null;
  /** セーブはあったが形式が古くて捨てた */
  discarded: boolean;
}

export function loadGame(): LoadResult {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { state: null, discarded: false };
    const parsed = JSON.parse(raw) as { version?: number; seed?: unknown };
    if (typeof parsed.seed !== 'string') return { state: null, discarded: true };
    if (parsed.version !== SAVE_VERSION) return { state: null, discarded: true };
    return { state: parsed as unknown as GameState, discarded: false };
  } catch {
    return { state: null, discarded: true };
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 消せなくても続ける */
  }
}
