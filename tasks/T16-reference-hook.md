---
id: T16
title: "参照を持つコレクションの保存 hook(検証)を作る"
type: 実装
status: done
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/hooks/references.ts"
  - "tests/server/references.test.ts"
spec:
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T16 参照を持つコレクションの保存 hook(検証)を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8章]]

## 目的

仕様書 8 章の③。参照を持つコレクションの `content:beforeSave` で参照を検証する。

## 作業内容

- [x] 保存するコレクションのフィールド定義から、このプラグインの widget のフィールドを特定する(`ctx.schema.getCollection`)
- [x] 参照の形、alt の長さ、ギャラリーの枚数と重複を検証する
- [x] 参照している画像 ID が `imageRefs` にあるかを、`getMany` でまとめて確認する
- [x] 部分更新(送られてきたフィールドだけ)に対応する
- [x] 失敗したときは、どのフィールドの何が問題かをメッセージで返す

## 完了条件

- [x] 単体テスト(偽の ctx を使う)

## 変更してよいファイル

- `src/server/hooks/references.ts`
- `tests/server/references.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/server/hooks/references.ts` に、参照を持つコレクションの `content:beforeSave` の本体 `validateReferencesBeforeSave(event, ctx)` を作った。EmDash の `ContentHookEvent` / `PluginContext` をそのまま渡せる(型のテストで確かめた)。
> - `tests/server/references.test.ts` に 40 件のテストを書いた(偽の ctx。偽の `getMany` は、D1 のバインド変数の上限を超えると失敗する)。実装を 17 通りに壊し、どれもテストが失敗することを確かめた。
> - 使い捨てのサイト(`spikes/reference-hook/`、git 管理外)にこの hook を登録し、REST と管理画面(Chromium)で、正しい参照・不正な参照・存在しない画像・部分更新・seed の画像の保存を確かめた。
> - 知見ノート: [[emdash-content-before-save]](拒否の方法と応答、管理画面の表示、hook に渡る内容、言語の手がかりが無いこと、クエリ数)
> - 仕様書は変更していない(8 章の表は T11 も関係するため)。変更してほしい点は [[#仕様書への反映(リーダーが反映する)]]。
> - リーダーの連絡(2026-09-24)に従い、対象のフィールドの判定を T11 の `getFieldWidgetKind` と同じ規則(`json` 型で、widget がこのプラグインのもの)にした。分岐元(`f2c3f97`)に T11 の関数が無いので、同じ形の関数をこのファイルの中に置いた。

### 主な export

| export | 内容 |
|---|---|
| `validateReferencesBeforeSave(event, ctx)` | hook の本体。問題が無ければ何も返さない(データは変えない)。問題があれば `ContentSaveRejectedError` を投げる |
| `getImageFields(fields)` | フィールド定義から、このプラグインの widget を使う `json` フィールド(`{ slug, label, kind, options }`)を、定義の順に返す。[[T20-owner-tracking\|T20]] でも使える |
| `IMAGE_REFS_BATCH_SIZE`(50)、`MAX_LISTED_ISSUES`(3) | `getMany` 1 回の ID の数、`message` に並べる問題の数 |
| 型 `ReferenceHookEvent` / `ReferenceHookContext` / `ReferenceFieldInfo` / `ImageRefsLookup` / `ImageField` | EmDash の型のうち、この hook が使う部分 |

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 拒否は `ContentSaveRejectedError(message)` を投げる。プラグインの定義の誤り(`ctx.schema` や `imageRefs` が無い)と、`getMany` の失敗は、通常の例外のまま投げる | `ContentSaveRejectedError` だけが 422 `SAVE_REJECTED` と `message` を返す。ほかの例外は 500 `CONTENT_HOOK_ERROR` で、文言は固定の文に置き換わる。定義の誤りやデータベースの失敗を「参照が不正」と見せない | 実測+公式ドキュメント |
| 2 | `message` には日本語と英語の両方を、日本語・英語の順に書く | hook は管理画面の言語を知らない(event・ctx・リクエストの文脈のどれにも無い)。`ctx.site.locale` は、0.39.1 ではセットアップでも設定画面でも書かれないオプション `emdash:locale` の値で、ほぼ常に `en`。管理画面は `message` を訳さずに出す。日本語を先にするのは、このプラグインの主な利用者の言語に合わせたため | 手がかりが無いことは実測+公式ドキュメント。順番は設計判断 |
| 3 | 問題 1 件を 1 行にする(`画像フィールド「Gallery」(gallery)の 2 枚目: 画像が見つかりません(ID: …)。`)。並べるのは 3 件までで、残りは件数だけ。画像が見つからないときは、原因と対処を 1 回だけ添える | 管理画面の通知は幅 340px で約 5.6 秒で消え、改行は空白になる。日本語と英語で 1 件でも 10 行ほどになる | 実測のみ |
| 4 | 対象は、このプラグインの widget を使う `json` フィールドだけ(T11 と同じ規則)。`json` 以外の型で widget だけがこのプラグインのもの、というフィールドは**検証しない(無視する)** | 管理画面は毎回すべてのフィールドを送るので、拒否にすると、設定の誤り 1 つでそのコレクション全体が保存できなくなる。そのフィールドには、アップロードのルートが `INVALID_TARGET` で拒否するので widget から参照が入らず、設定の誤りはアップロードの時点で分かる | 公式ドキュメントのみ(`admin/src/components/ContentEditor.tsx:1807`、T11)+ 推測のみ(影響の見積もり) |
| 5 | `b64_images` の保存では何もしない(クエリもしない)。送られたデータが空でも何もしない。widget のフィールドが無いコレクションでは `getCollection` の 2 クエリだけ | `b64_images` は [[T19-image-entry-hook\|T19]] が検証する。フィールドの型と widget は、定義を読まないと分からない | 実測+公式ドキュメント |
| 6 | 送られてきたフィールドだけを検証する。`null` / `undefined` は「画像なし」として通し、ギャラリーの `[]` も通す。必須かどうかは確かめない | 更新の beforeSave には、送ったフィールドだけが渡る。管理画面は未設定の値(`null`)も送り返す。必須は、このあと EmDash が検証する | 実測+公式ドキュメント |
| 7 | 参照の形は `base64ImageRefSchema`(`z.strictObject`)で確かめ、問題のあるキーを 5 つまで並べる。alt が長すぎることだけが問題なら「代替テキストが 1,000 文字を超えています(N 文字)」にする。長さはコードポイントで数える | 知らないキー(data URL など)を参照に入れさせない。alt は編集者が直せる問題なので分けて書く | 設計判断(数え方は [[zod-string-length-code-points]]) |
| 8 | ギャラリーは、`normalizeFieldOptions(options).maxItems` を超えたら枚数と上限だけを書き、1 枚ずつの検証と存在の確認はしない。同じ画像 ID の 2 回目以降を「N 枚目と同じ画像」とする(alt が違っても重複) | 大きな配列で処理とクエリを増やさない。画像は再利用しない(仕様書 10 章)ので、同じ ID の 2 回目は誤り | 設計判断 |
| 9 | 存在の確認は、形の正しい参照の ID を、フィールドをまたいで重複を除き、50 件ずつ `getMany` に渡す(ふつうは 1 回)。形の問題があっても存在は確かめ、すべての問題を 1 回の応答で返す | `getMany` のバインド変数は ID の数 + 2 で、D1 の上限は 100。拒否するときに増えるのは 1 クエリだけ | 実測+公式ドキュメント |
| 10 | seed で作った画像(`imageRefs` に無い)を参照する保存は拒否する(仕様書 8 章③のまま)。`b64_images` を確かめる代わりの処理は入れない | [[#seed の画像の扱い]] | 拒否されることは実測+公式ドキュメント。代わりの案の影響は推測のみ |
| 11 | ゴミ箱に入った画像を参照する保存は通る | 存在の判定は `imageRefs` だけ。ゴミ箱に移しても `imageRefs` は残る(消すのは完全削除の afterDelete。[[T21-orphan-routes\|T21]])。ゴミ箱かを確かめるには、1 枚につき 2 クエリ以上と画像本体の読み出しが要る | 公式ドキュメントのみ([[emdash-plugin-content-query-counts]]) |

### seed の画像の扱い

- seed で作った `b64_images` のエントリは保存 hook を通らないので、`imageRefs` の記録が無い。それを参照する投稿の保存は `画像が見つかりません(ID: seedimg1)` で拒否された。根拠: 実測+公式ドキュメント(`references/emdash/packages/core/src/seed/apply.ts:670-684`)
- **管理画面は毎回すべてのフィールドを送るので、seed の投稿は、タイトルだけを変えても保存できない**(保存も自動保存も拒否された)。REST で `data: { title }` だけを送る部分更新は通る。根拠: 実測のみ
- 拒否のままにした理由:
  1. `imageRefs` は、このプラグインが画像を管理する台帳で、一覧のサムネイル([[T17-admin-data-routes|T17]])・画像管理ページ([[T21-orphan-routes|T21]])・参照元の記録([[T20-owner-tracking|T20]])も `imageRefs` を見る。seed の画像は、保存 hook で通しても、一覧では警告になり、画像管理ページにも出ず、ゴミ箱に移せない。保存の 1 か所だけで通すと、問題が見えにくくなる。
  2. `imageRefs` に無い ID だけ `ctx.content.get("b64_images", id)` で確かめる案は、seed の画像 1 枚につき、保存・自動保存のたびに 2 クエリ(見つからなければ 1)と、画像本体(最大 100,000 バイト)の読み出しが増える。カバー 1 枚と 10 枚のギャラリーなら +22 クエリと約 1.1MB になる。ゴミ箱の扱いも食い違う(seed の画像はゴミ箱に入ると拒否、アップロードした画像はゴミ箱でも通る)。capability `content:read` も要る。根拠: 推測のみ(1 件のクエリ数は [[emdash-plugin-content-query-counts]] の実測)
  3. サムネイルはブラウザでしか作れない(`imageRefsRecordSchema` の `thumb` は必須)ので、hook の中で `imageRefs` を補うこともできない。
- 影響: E2E やサイトの見本で seed の画像を使うと、その投稿は管理画面で保存できない。画像はアップロードのルートで作る(`imageRefs` も書かれる)。seed の画像を使えるようにするには、`imageRefs` に登録する手段が要る([[#未解決・サブタスクの候補]] の 1)。
- 開発者が原因に気付けるよう、拒否の文言に「アップロード以外の方法(seed など)で作られた画像」の可能性を書いた。

### 実測(スパイク)

環境: macOS 26.4(arm64)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、SQLite、Playwright 1.63.0(Chromium 153.0.8010.12)。開発サーバーはポート 4416。詳しくは [[emdash-content-before-save]]。

REST(`posts` の `gallery` は `maxItems: 3`):

| 保存 | 結果 | db.count |
|---|---|---|
| 正しい参照(作成) | 201 | 37(検証なしは 34) |
| 形の誤り(`id` が無い・知らないキー)/ 参照でない値(文字列) | 422 `SAVE_REJECTED` | 5 |
| 存在しない画像 | 422 | 6 |
| ギャラリー 4 枚 / 重複 / 配列でない | 422 | 5 / 6 / 5 |
| alt 1,001 文字 / 絵文字 1,000 文字 | 422 / 201 | 5 / 37 |
| 部分更新: `title` だけ / `cover` に存在しない画像 / `cover: null, gallery: []` / `data: {}` / SEO だけ | 200 / 422 / 200 / 200 / 200(hook は呼ばれない) | — |
| seed の投稿: `title` だけ / 管理画面と同じくすべてのフィールド | 200 / 422(`seedimg1` が見つからない) | — |
| hook が通常の `Error` を投げる | 500 `CONTENT_HOOK_ERROR`(「A plugin hook failed while saving content」) | — |
| `errorPolicy: "continue"` で拒否を投げる | **201(不正な参照のまま保存される)** | — |

管理画面(Chromium。widget がまだ無いので、JSON の入力欄に参照を入れた):

| 操作 | 結果 |
|---|---|
| 正しい参照で新規作成 | 保存され、編集画面に移った |
| 形の誤り・存在しない画像で新規作成 | 通知「Failed to save」の本文に `message`(改行は空白になる) |
| 保存済みの投稿のタイトルだけを変えて保存 | `PUT` の `data` に `title` / `cover` / `gallery` がすべて入り、200 |
| seed の投稿のタイトルだけを変えて保存 / 変えたまま待って自動保存 | 「Failed to save」/「Autosave failed」に同じ `message` |
| 日本語の管理画面(Cookie `emdash-locale=ja`) | 見出しは「保存に失敗しました」、本文は `message` のまま(日本語が先) |

- hook が足すクエリは、SQL の差で数えると、`_emdash_collections` と `_emdash_fields`(`getCollection`)の 2 本と、画像の値を送ったときの `_plugin_storage … "id" in (?, ?, ?)`(`getMany`)の 1 本だった。作成・更新・画像のフィールドの無いコレクション(`pages`: 33 → 35)で同じだった。根拠: 実測のみ
- hook の実行時間(クエリの待ち時間を含む、SQLite)は、139 回で中央値 0.20ms、最大 4.5ms(起動直後)。根拠: 実測のみ

### T29 への引き継ぎ(登録のしかた)

```ts
// src/index.ts(T29)の抜粋。T19 の関数名は仮
import { definePlugin } from "emdash";

import { validateImageEntryBeforeSave } from "./server/hooks/image-entry";
import { validateReferencesBeforeSave } from "./server/hooks/references";
import { IMAGE_COLLECTION, IMAGE_REFS_STORAGE } from "./shared/constants";

export function createPlugin() {
	return definePlugin({
		id: "base64-image",
		version: PLUGIN_VERSION,
		// content:write: beforeSave の登録に必須(無いと警告だけ出して黙って飛ばす)
		// schema:read: ctx.schema(フィールド定義)
		capabilities: ["schema:read", "content:read", "content:write", "content:publish", "content:revisions:read"],
		// ctx.storage.imageRefs
		storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } },
		hooks: {
			// content:beforeSave は 1 つのプラグインに 1 つだけ。T19(b64_images)と T16(それ以外)を振り分ける。
			// errorPolicy は書かない(既定の "abort")。"continue" にすると拒否の例外が捨てられ、保存が通る(実測)
			"content:beforeSave": {
				handler: async (event, ctx) => {
					if (event.collection === IMAGE_COLLECTION) return validateImageEntryBeforeSave(event, ctx);
					return validateReferencesBeforeSave(event, ctx);
				},
			},
			// afterSave(T20)、afterDelete(T21)などは別に書く
		},
	});
}
```

- T16 が使う capability は `content:write`(登録)と `schema:read`(`ctx.schema`)、ストレージは `imageRefs`。`content:read` は使わない。
- `validateReferencesBeforeSave` は `b64_images` では何もしないので、振り分けずに T19 の処理のあとで続けて呼んでもよい。値を変えないので、戻り値は `undefined`(保存するデータはそのまま)。
- `errorPolicy` を `"continue"` にしない。afterSave(T20)の `"continue"` と混同しない。
- `priority` は、ほかのプラグインの beforeSave が値を変えたあとで確かめられるよう、既定(100)より大きい値(あとで実行)にするとよい。根拠: 推測のみ(`references/emdash/packages/core/src/plugins/hooks.ts:390-420` は `priority` の小さい順に並べ、`:555-576` は前の hook が返した内容を次の hook に渡す)
- `ctx.schema` が無いと `b64_images` 以外のすべての保存が、`imageRefs` が無いと画像の参照を含む保存が、500 `CONTENT_HOOK_ERROR` になる(設定の誤りを見逃さないため)。capability とストレージの宣言を落とさない。

### 仕様書への反映(リーダーが反映する)

8 章の表は T11 も関係するので、変更していない。反映してほしい点:

1. 8 章 ③ の検証内容
   - 対象は「このプラグインの widget を使う `json` フィールド」。`json` 以外の型のフィールドは検証しない(決定 4)。
   - 検証するのは、送られてきたフィールドだけ。`null` / `undefined` / 空の配列は「画像なし」として通す(決定 6)。
   - 「`getMany` でまとめて1クエリ」を「ID の重複を除いて 50 件ずつ `getMany`(ふつうは 1 クエリ)。ほかに、フィールド定義の読み出し(`ctx.schema.getCollection`)で 2 クエリ。widget のフィールドが無いコレクションの保存でも、この 2 クエリは増える」に。
   - 「不正なとき」の列: 「`ContentSaveRejectedError` を投げる(422 `SAVE_REJECTED`)。`message` に日本語と英語を並べ、問題は 3 件まで」(決定 1〜3)。
2. 8 章の本文(③の存在確認の影響)への追記
   - seed で作った画像(`imageRefs` に無い)を参照する投稿も拒否される。管理画面は毎回すべてのフィールドを送るので、タイトルだけの変更でも保存できない。
   - ゴミ箱に入った画像を参照する保存は通る(`imageRefs` が残るため)。
   - 保存 hook は管理画面の言語を知らない。`message` は訳されずに、保存の失敗の通知にそのまま出る(改行は空白)。
   - 処理の重さ: hook は中央値 0.20ms(クエリを含む、SQLite)。
3. 5.2 の「`b64_images` を seed で作るときはこの規則に合わせる」のあとに「seed で作った画像を参照する投稿は、管理画面で保存できない(8 章③)。画像はアップロードで作る」。
4. 13.1 に同じ注意(seed に `b64_images` の内容を入れても、それを参照する投稿は保存できない)。
5. 18 章(既知の制約とリスク)に「seed で作った画像は、参照を持つコレクションの保存 hook で拒否される」と「保存の拒否の文言は日本語と英語を並べる(サーバーは管理画面の言語を知らない)」。
6. 付録 B に `packages/core/src/plugins/save-rejection.ts`(拒否の例外)、`packages/core/src/emdash-runtime.ts:513`(拒否の応答)、`packages/core/src/plugins/hooks.ts:543`(`errorPolicy` と拒否)、`packages/admin/src/router.tsx:1097`(保存の失敗の通知)。

### 他のタスクへの影響

| タスク | 影響 |
|---|---|
| [[T29-plugin-definition\|T29]] | 上の登録のしかた。`errorPolicy` を `"continue"` にしない。タスクノートの「hook(beforeSave ×2 …)」は、1 つの handler で振り分ける形になる |
| [[T19-image-entry-hook\|T19]] | `content:beforeSave` を T16 と共有する(T29 が振り分ける) |
| [[T20-owner-tracking\|T20]] | 対象のフィールドの判定に `getImageFields`(`json` + widget)を使える。beforeSave を通った保存の参照は、保存の時点で `imageRefs` にある |
| [[T26-playground-pages\|T26]] / [[T31-e2e\|T31]] | seed に `b64_images` の内容と、それを参照する投稿を入れると、その投稿は管理画面で保存できない。画像はアップロードのルートで作る |
| [[T27-image-widget\|T27]] / [[T28-gallery-widget\|T28]] | プレビュー([[T17-admin-data-routes\|T17]] の `preview`)は `b64_images` を読むので、seed の画像も表示されるが、保存は拒否される。`imageRefs` に無いこと(`thumbnails` の `null`)でも「画像が見つかりません」を出すと、保存の前に気付ける |
| マージ | `src/server/hooks/references.ts` の `getFieldWidgetKind` を、T11 の `src/server/validate.ts` のものに差し替える(同じ規則・同じ引数の形) |

### テスト

- `tests/server/references.test.ts`: 40 件。
  - 対象とクエリ: `b64_images`・空のデータ・widget の無いコレクション・コレクションが無い・部分更新・ほかのプラグインの widget・`json` 以外の型・`null` / `undefined` / `[]`・フィールドをまたいだ ID の重複
  - 参照の形: 文字列・配列・キーの欠け・知らないキー・`v`・寸法・ロケール・ID の文字・alt の境界(絵文字 1,000 / 1,001 文字)・alt とほかの問題が重なるとき
  - ギャラリー: 配列でない・`maxItems` の境界(3 / 4 枚)・既定値(10 枚)と上限(20 枚)への丸め・重複・不正な 1 枚があるときのほかの画像の確認
  - 存在: 見つからない画像の場所と注意書き・50 件ずつの分割(120 枚で 3 回)・2 回目の呼び出しに入った画像
  - message: 並べる順番・3 件までと残りの件数・表示名の扱い・キーの数と長さの上限
  - 例外: `ContentSaveRejectedError` と EmDash の `isContentSaveRejection`・`ctx.schema` / `imageRefs` が無いとき・`getMany` の失敗
  - 型: EmDash の `content:beforeSave` の handler(`ContentHookEvent` / `PluginContext`)としてそのまま登録できる
- 実装を 17 通りに壊し、どれもテストが失敗することを確かめた: ID の重複を除かない / 50 件ずつに分けない / alt を UTF-16 で数える / `null` を拒否する / ギャラリーの重複を見ない / `maxItems` を丸めない / `maxItems` ちょうどを拒否する / 枚数を超えても 1 枚ずつ確かめる / 通常の `Error` で拒否する / 並べ替えない / 件数で切らない / 英語を先にする / `b64_images` も検証する / 見つからない画像を見逃す / alt だけの問題も形の問題にする / キーを並べない / `json` 以外の型も対象にする。ctx の型に `StorageCollection` に無いメソッドを足すと、型のテストが tsc で失敗することも確かめた。根拠: 実測のみ
- `npm run verify`: build(tsc 3 つの設定と playground のビルド)・lint(oxlint・prettier)・test(8 ファイル 590 件)がすべて通った。

### 未解決・サブタスクの候補

1. seed(やアップロード以外の方法)で作った `b64_images` を `imageRefs` に登録する手段。サムネイルはブラウザでしか作れないので、画像管理ページなどで未登録の画像を見つけ、プレビューからサムネイルを作って登録する形になる見込み(推測のみ)。seed の画像を使いたい場合のサブタスクの候補。
2. `ctx.schema.getCollection` の 2 クエリは、画像のフィールドを持たないコレクションを含む、すべての保存(自動保存も)に掛かる。モジュールの中にキャッシュすると、スキーマの変更に追随できず、EmDash の分離したデータベース(`dbIsIsolated`)でも誤るので、しなかった。1 呼び出し 1,000 の上限(仕様書 2.2)には十分収まる。
3. 参照の `locale`・`width`・`height` が画像エントリと一致するかは確かめていない(仕様書 8 章③に無い)。寸法は `imageRefs` にあるのでクエリを増やさずに確かめられる。ロケールは `imageRefs` に無い。
4. `required` の画像フィールドに `null` を送ったときの扱いは EmDash に任せた(T16 は通す)。
5. seed と、ほかのプラグインの `ctx.content.update` は保存 hook を通らないので、そこから入った参照は検証されない([[emdash-after-save-payload#プラグインからの書き込み]])。
