---
id: T15
title: "サイト側の resolveBase64Images を作る"
type: 実装
status: done
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
soft_depends_on:
  - "[[T09-spike-query-count]]"
blocks:
  - "[[T26-playground-pages]]"
files:
  - "src/site/resolve.ts"
  - "src/astro.ts"
  - "tests/site/resolve.test.ts"
  - "plans/base64-image-plugin-spec.md(12 章と 20 章。API の形)"
spec:
  - "[[base64-image-plugin-spec#12. サイト側の描画]]"
tags:
  - task
  - impl
  - site
created: 2026-09-23
---

# T15 サイト側の resolveBase64Images を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]
> - 結果を後で反映する(着手はブロックしない): [[T09-spike-query-count|T09]]
> - このタスクを待つもの: [[T26-playground-pages|T26]]
> - 仕様: [[base64-image-plugin-spec#12. サイト側の描画|仕様書 12章]]

## 目的

仕様書 12 章のサイト側 API を作る。

## 作業内容

- [x] `resolveBase64Images(refs)`: 重複を除き、ロケールごとに `getEmDashCollection("b64_images", { where: { id }, locale })` で取得する(50件ずつ)
- [x] `MediaValue` 互換の値(alt は参照のもの)を返す。見つからない ID は警告ログを出す
- [x] `src/astro.ts` から、関数・型・type guard を export する

## 完了条件

- [x] 単体テスト(`getEmDashCollection` を差し替えて、分割・ロケール・欠損を確認する)
- [x] [[T09-spike-query-count|T09]] の結果を反映した

## 変更してよいファイル

- `src/site/resolve.ts`
- `src/astro.ts`
- `tests/site/resolve.test.ts`
- `plans/base64-image-plugin-spec.md`(12 章と 20 章。API の形を実装に合わせた)

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

チームメイトが実装とテストを書いたところで、2 回止まった(API の利用上限と、応答の途絶)。リーダーが引き取り、利用者向けの型チェック([[T04-1-consumer-typecheck|T04-1]])への対応、仕様書の更新、このノートの記入をした。

### API の形(仕様書 12 章を更新)

```ts
const images = await resolveBase64Images(refs); // refs: readonly Base64ImageRef[]
const image = images.get(ref); // ResolvedBase64Image | undefined(= 画像エントリの値 + id + alt)
```

- 仕様書は「画像 ID をキーにした値」と `images.get(ref.id)` だった。**参照を渡す `get(ref)` に変えた。** alt は参照ごとに持つので、同じ画像を alt の違う複数の参照(表紙とギャラリーなど)が指すと、ID だけでは alt が決まらないため。画像は参照の `locale` と `id` で引き、ほかのロケールの結果は使わない。`get` は呼ぶたびに新しいオブジェクトを返す。根拠: **推測のみ**(設計の判断)
- `ResolvedBase64Image` は `emdash` の `ImageValue` に代入できる(`expectTypeOf(...).toExtend<ImageValue>()` を tsc で確かめた)。`emdash/ui` の `Image` にそのまま渡せる。根拠: **実測のみ**(型チェック)
- 参照の形でない値(`json` フィールドはサイトの型では `unknown`)は、取得せず、`get` も `undefined` を返す。
- 取得の関数を引数で受け取る `resolveBase64ImagesWith(load, refs)` を `src/site/resolve.ts` に置き、`src/astro.ts` の `resolveBase64Images` が `getEmDashCollection` を渡す。`src/site/resolve.ts` は `emdash` を読み込まない。
- `LoadCollection` の `collection` は `string` にした。`getEmDashCollection` は `<T extends string>` なので、サイトが `EmDashCollections` の型を生成していても代入できる。根拠: **公式ドキュメントのみ**(`node_modules/emdash/dist/config-Cw1Xz_Br.d.mts:4281`)

### T09 の申し送りの反映

[[T09-spike-query-count#T15 への申し送り|T09 の申し送り]] の 6 項目をすべて入れた。

| 申し送り | 実装 |
|---|---|
| 1. 50 件ずつ | `BATCH_SIZE = 50`。呼び出しは `Promise.all` で並べる |
| 2. `locale` でまとめ、必ず渡す | ロケールごとにまとめ、どの呼び出しにも `locale` を渡す |
| 3. 戻り値の `error` を確かめる | `error` があれば、その呼び出しの ID をすべて描画せず、`error` を付けて警告する。例外も同じに扱う(画像のためにページの描画を止めない) |
| 4. `entry.data.id` で引く | `entry.id`(`ja/…`)は使わない |
| 5. 返る順番は要求の順ではない | ロケール → ID の Map にする |
| 6. 並べ替えてから呼ぶ | ロケールも ID も並べ替える。重複した ID は 1 回だけ取得する |

### 値の検証と警告ログ

- 取得した値を `base64ImageEntrySchema`([[T03-shared-contracts|T03]])で検証し、`src` が `data:image/webp;base64,` で始まることも確かめる。seed や手での書き換えは保存 hook を通らないため。data URL の中身(base64 と WebP のヘッダー)は、描画のたびには確かめない(保存時に T19 の hook で確かめる)。
- 警告ログ(`console.warn`、接頭辞 `[base64-image]`)は、呼び出しごとに種類別に 1 行: 取得の失敗(`Failed to load …`、`error` も渡す)・値が不正(`… have an invalid value`)・見つからない(`… not found`)。ロケールと ID を含める。

### 利用者向けの型チェックへの対応

`phase/2` に T04-1 が入ったので、ブランチを `phase/2`(`6b741b4`)に進めてから確かめた。`tsconfig.consumer-loose.json` で `toSorted`(ES2023)が 2 件のエラーになったので、`sort()` に変えた。`safeParse` の結果は `parsed.success === false` で判別するようにした。3 つの設定のどれも 0 件。根拠: **実測のみ**

### テスト

`tests/site/resolve.test.ts` の 24 件。`getEmDashCollection` の偽物は、T09 の実測に合わせて、返る順番を要求と逆にし、バインド変数が 100 個を超えると `{ entries: [], error }` を返す。

- わざと入れた不具合 7 種類(分割を 100 件にする・`locale` を渡さない・`entry.id` で引く・ID を並べ替えない・`error` を見ない・`src` の接頭辞を確かめない・alt を参照から取らない)は、すべてテストが失敗した。根拠: **実測のみ**
- 実際の EmDash での確認(playground のページで描画する)は [[T26-playground-pages|T26]] で行う。
