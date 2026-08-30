# バッチ B: 戦闘ルール v2 の実装メモ

ゲームのルールそのものは `plan.md` が正である。ここはそれをコードへ落とすときの
対応表で、着手時に読む。実装が済んだらこのファイルは消す。

前提: バッチ A (UI 微調整) が dev にマージされた後に着手する。
両者は `game.ts` / `view.ts` / `main.ts` を触るので、並行させない。

## 1. 防御 (旧ガード)

- `GUARD_RATES` を `[0, 0.2, 0.45, 0.7, 0.9]` にする
- 識別子は `guard` のままでよいが、ユーザーに見える文字列はすべて「防御」にする
- `EnemyDef.guardBreak` を**削除する**。大技はダウンを起こさなくなるので使い道が無い

## 2. バフのスタック制 (鼓舞・ガード)

`BattleState.buff: number` (今はターン内の加算値) を、2 系統のスタックに置き換える。

```ts
interface BuffStack {
  /** 積んだ枚数。3 が上限 */
  stacks: number;
  /** 残りターン数。重ねがけで 3 に戻る */
  turns: number;
}
// state.cheer: BuffStack  攻撃 +20% / 枚
// state.ward:  BuffStack  被ダメージ -20% / 枚
```

- 効果は 3 ターン。重ねがけで `stacks` が増え (上限 3)、`turns` は 3 に戻る
- `endTurn` の整理で `turns` を 1 減らし、0 になったら `stacks` も 0 にする
- `SkillEffect` に `{ kind: 'cheer'; stacks: number }` と `{ kind: 'ward'; stacks: number }` を足す。
  `stacks` が 1 ならコモン、2 ならレアの上位スキルになる
- コスト管理は物理と同じ扱いにする (`category: 'physical'` を与えれば turnBump が +1 頭打ちで動く)
- 既存の `{ kind: 'buff' }` は `cheer` に置き換えて削除する
- 被ダメージの計算は「防御の軽減率」と「ward の軽減率」を**掛け算**で重ねる
  (防御 4 枚 0.1 × ward 3 枚 0.4 = 0.04 で 4%)

## 3. マナの払い出し

- `manaPayout(party, turn)` に変える。基礎は奇数ターン 2 / 偶数ターン 3
- 成長ぶんは `GameState` 側で持ち (`manaBonus: number`)、`startBattle` に渡す。
  中層クリアで +1 して 3 / 3 になる
- `MANA_PER_TURN` の定数は奇偶の 2 値に分ける

## 4. 敵の行動

`EnemyDef` に行動パターンを持たせる。

```ts
type EnemyAction =
  | { kind: 'attack' }
  | { kind: 'big' }            // 予告つき。痛いだけでダウンはしない
  | { kind: 'downstrike' }     // 予告つき。ダウンを起こす。防御では防げない
  | { kind: 'stun'; min: number; max: number }  // ランダム人数
  | { kind: 'cheer' }          // 自分を強化
  | { kind: 'ward' };          // 自分の被ダメージを下げる
```

- 大技 (`big`): `bigEvery` ターンごと。予告あり。**ダウンは起こさない**。
  防御を積まないと死ぬほど痛い威力にする
- ダウン攻撃 (`downstrike`): 別カウンタで管理する (`downEvery`、ボスは 5)。予告あり。
  対抗はバリアと身代わりだけ。防御・ward では防げない。雑魚の一部にも持たせる
- スタン (`stun`): 巻き込む人数は `rng.int(min, max)`。区画で変える
  (浅層 1〜2 / 中層 1〜3 / 深層 2〜4)
- **ボスは大技・ダウン攻撃のターン以外、通常行動を 2 回行う。**
  2 回ぶんを `attack` / `stun` / `cheer` / `ward` から引く

## 5. スタン

- `Fighter.stunnedUntil: number` (ターン番号) を持たせる。
  掛かったターンと次のターンが行動不可なので `stunnedUntil = state.turn + 1`
- `whyCannotUse` が「気絶している」を返す。交代の対象にも選べない
- 帰還と回復イベントで解除する (ダウンと同じ扱い)
- 将来、味方スキルの代償としても使えるよう、`SkillEffect` に
  `{ kind: 'stun-self' }` を足せる形にしておく (今回は敵専用でよい)

## 6. 予告の表示

- `EnemyState` は大技とダウン攻撃で別々のカウントダウンを持つ
- `BattleView` の敵アイコン列に両方を出す。ダウン攻撃の予告は別色にする
- どちらも 1 ターン前にログで警告する (バッチ A で入れた仕組みを流用する)

## 7. 数値

**実装では触らない。** 敵の攻撃力は「防御 1 枚を積んでちょうどいい」水準まで上げる
必要があるが、それは計画側が `npm run balance` を見ながら通しで振り直す。
実装は既存の値をそのまま移し、新規の値は仕様の初期値を使うこと。
