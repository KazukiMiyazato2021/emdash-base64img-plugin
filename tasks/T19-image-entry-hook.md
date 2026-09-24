---
id: T19
title: "b64_images の保存 hook(検証)を作る"
type: 実装
status: done
wave: 3
depends_on:
  - "[[T11-server-validation]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/hooks/image-entry.ts"
  - "tests/server/image-entry.test.ts"
spec:
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T19 b64_images の保存 hook(検証)を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T11-server-validation|T11]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8章]]

## 目的

仕様書 8 章の②。API / MCP / 管理画面など、どこから `b64_images` に書き込まれても中身を検証する。

## 作業内容

- [x] `content:beforeSave` で、コレクションが `b64_images` のときだけ [[T11-server-validation|T11]] の検証を行う(作成のとき。更新は [[#決めたこと]] の 3)
- [x] 部分更新、不正な値、上限を超えた値を拒否する(「部分更新」は、リーダーの指定に従い、`image` を含む更新を値によらず拒否し、`image` の無い部分更新は何もしない形にした)
- [x] `content:beforeSave` は 1 つのプラグインに 1 つしか登録できない。T19 は、[[T16-reference-hook|T16]] の `validateReferencesBeforeSave(event, ctx)` と同じ形の関数(例: `validateImageEntryBeforeSave(event, ctx)`)を export し、[[T29-plugin-definition|T29]] が 1 つの handler で振り分ける([[T16-reference-hook#T29 への引き継ぎ(登録のしかた)|T16]])
- [x] 検証は `validateImageEntry(event.content[IMAGE_FIELD])`([[T11-server-validation#T18・T19 が使う export|T11]])。失敗したら `ContentSaveRejectedError` を投げる。ほかの例外は、EmDash が `CONTENT_HOOK_ERROR` の固定の文に置き換え、メッセージを隠す(`references/emdash/packages/core/src/emdash-runtime.ts:513`。[[server-image-validation]])

## 完了条件

- [x] 単体テスト

## 変更してよいファイル

- `src/server/hooks/image-entry.ts`
- `tests/server/image-entry.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/server/hooks/image-entry.ts` に、`b64_images` の `content:beforeSave` の本体 `validateImageEntryBeforeSave(event, ctx)` を作った。作成では T11 の `validateImageEntry` で `image` を確かめ、更新では `image` が送られてきたら値によらず拒否する。`image` の無い更新と、ほかのコレクションでは何もしない。ctx は使わず、クエリもしない。
> - `tests/server/image-entry.test.ts` に 64 件のテストを書いた(何かを読むと失敗する偽の ctx)。実装を 22 通りに壊し、どれもテストが失敗することを確かめた。
> - 使い捨てのサイト(`spikes/image-entry-hook/`、git 管理外)に、T29 と同じ振り分けの handler でこの hook と T16 の hook を登録し、標準の REST API・プラグインの `ctx.content.create`・MCP・管理画面(Chromium、英語と日本語)で、正しい値・不正な値・上限を超えた値の作成と、更新を確かめた。
> - 知見ノート: [[b64-images-save-hook]](hook の動き、更新の扱いの比較、hook が無いときの EmDash の動き、管理画面・`ctx.content.create`・MCP での結果、処理時間、再現手順)
> - 仕様書は 8 章の表の②、5.1、10 章を直した([[#仕様書への反映]])。

### 主な export

| export | 内容 |
|---|---|
| `validateImageEntryBeforeSave(event, _ctx?)` | hook の本体。問題が無ければ何も返さない(データは変えない)。問題があれば `ContentSaveRejectedError` を投げる。`ctx` は受け取るだけで使わない(T16 と同じ `(event, ctx)` で呼べる) |
| 型 `ImageEntryHookEvent` | EmDash の `ContentHookEvent` のうち、この hook が読む部分(`content` / `collection` / `isNew`)。`ContentHookEvent` をそのまま渡せる(型のテストで確かめた) |
| `MAX_DETAIL_LENGTH`(300) | 英語の行に入れる T11 の `message` の長さの上限 |

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 関数は `validateImageEntryBeforeSave(event, _ctx?)`。`b64_images` 以外では何もしない。`ctx` は使わない | T29 が T16 の hook と 1 つの handler で振り分ける。どちらも相手のコレクションでは何もしないので、振り分けずに続けて呼んでもよい。`ctx` を使わないので、capability やストレージの宣言の漏れで 500 になることもない | 設計判断。T29 の形で登録できることは実測のみ(tsc の型のテストと spike) |
| 2 | 作成(`isNew: true`)は `validateImageEntry(event.content.image)` で確かめる。`image` が無い・`null`・オブジェクトでない値も拒否する | EmDash は `json` フィールドの中身を確かめず、上限を超える `src`・WebP でない `src`・アニメーション・知らないキーも 201 で保存した。`image: null` は列の NOT NULL で 500、省略は 400 になる。hook で先に 422 と理由を返す | 実測+公式ドキュメント(`core/src/schema/zod-generator.ts:174`) |
| 3 | 更新(`isNew: false`)で `image` が送られてきたら、値によらず拒否する(同じ値・`null` も)。中身は確かめない | 仕様書 5.1・10 章「作成したあと変更しない」。`supports: []` のコレクションの更新は、公開中の列の値をそのまま書き換えた(下書きのリビジョンは作られない)。差し替えを許すと、参照の `width` / `height` と `imageRefs` のサムネイル・バイト数・寸法が食い違う。保存済みの値と比べる案(比べて違うときだけ拒否)は、2 クエリと最大 500,000 バイトの読み出しと `content:read` が要る。それで通るようになるのは、標準の編集画面での `image` を変えない保存(slug・投稿者の変更と「Publish now」)だけで、`b64_images` ではどれも使い道が無い([[b64-images-save-hook#更新の扱い(決めたこと)]]) | 書き換わることは実測+公式ドキュメント(`core/src/emdash-runtime.ts:3521`、`:3632`)。案の比較は推測のみ |
| 4 | 更新で `image` が無ければ何もしない。値が `undefined` のキーは「送られていない」と同じに扱う | リーダーの指定。JSON では `undefined` を送れないので、REST・MCP の「送られていない」と同じ意味になる。`data: {}` の更新は REST・MCP のどちらでも hook が空の `content` で呼ばれ、通った | 実測のみ |
| 5 | 拒否の `message` は、T16 と同じく日本語と英語を 1 行ずつ、この順に書く。行の先頭は「画像エントリ(b64_images.image): 」「Image entry (b64_images.image): 」 | hook は管理画面の言語を知らない。通知には `message` がそのまま出る(改行は空白)。日本語の管理画面でも英語の管理画面でも、見出しだけが訳され、本文は 2 つの言語が並んだ | 表示は実測のみ。言語の手がかりが無いことは実測+公式ドキュメント([[emdash-content-before-save]]) |
| 6 | 英語の行は T11 の `message` をそのまま使い(句点を補う)、300 文字で切る。日本語の行は T11 の `reason` と `details` から書き、数は桁区切りを付ける。値の形の問題は、スキーマで確かめ直して問題のキーを `meta.bytes` の形で並べる(5 つ・1 つ 40 文字まで)。T04 の 12 種類の理由は、日本語の文に理由のコードを添える | T11 の `message` は保存 hook にそのまま渡せる英語。zod の `unrecognized_keys` の文には知らないキーがすべて入るので、長大なキーを 1,000 個送ると切らなければ数十万文字になる(切ると 1 件の `message` は 600 文字未満)。T04 の理由の日本語は、理由の型をキーにした表で、T04 が理由を増やすと型エラーになる | 実測のみ(テスト)。方針は設計判断 |
| 7 | `details` に数が無いときは「?」を書く | T11 の `details` の項目名が変わったときに、空の文にせず気付けるようにする(テストも失敗する) | 設計判断 |
| 8 | `errorPolicy` は既定の `"abort"` のまま(T29 に引き継ぐ) | `"continue"` にすると拒否が捨てられて保存が通る([[emdash-content-before-save#拒否のしかたと応答]]) | 公式ドキュメントのみ(T16 の実測を引用) |

### 実測(スパイク)

環境: macOS 26.4(arm64)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、SQLite、Playwright 1.63.0(Chromium 153.0.8010.12)。開発サーバーはポート 4419。詳しくは [[b64-images-save-hook]]。

| 書き込み | 検証なし(EmDash だけ) | この hook |
|---|---|---|
| REST: 正しい値の作成(`src` 499,999 文字まで) | 201 | 201(`db.count` は同じ 32) |
| REST: 上限を超える `src`(500,001 / 500,003 文字)・WebP でない・アニメーション・長辺 4,097px・形の誤り | **201** | 422 `SAVE_REJECTED`(3 クエリ) |
| REST: `image` の省略 / `null` | 400 / **500** | 422 |
| REST: 公開済みの画像の `image` を更新 | **200。公開中の値が書き換わる** | 422。値は変わらない |
| REST: `data: {}` / `data` なし / 無い ID | 200 / 200 / 404 | 同じ(`data` なしと無い ID では hook は呼ばれない) |
| プラグインの `ctx.content.create`(アップロードの代わり) | — | 正しい値は作成・公開まで通る(72 クエリ)。拒否すると `name` / `code` が `SAVE_REJECTED` の通常の `Error` が投げられる |
| MCP(API トークン)の `content_create` / `content_update` | — | 作成は検証、`image` を含む更新は拒否(`[SAVE_REJECTED] <message>`)、`data: {}` は通る |
| 管理画面: 新規作成 | — | 正しい値は作成、不正な値は「Failed to save」/「保存に失敗しました」+ `message` |
| 管理画面: 編集画面の保存・自動保存・slug だけの変更・「Publish now」 | — | どれも `data.image` を送るので 422(「Failed to save」「Autosave failed」)。「Unpublish」は PUT を送らないので通る |

- hook の処理時間(開発サーバー、`b64_images` の 69 回): 中央値 0.10ms(作成の検証 0.12ms、更新の拒否 0.035ms)。起動後の最初の拒否だけ 7.5ms。新しいプロセスの 1 回目は、通す作成 1.0〜3.2ms、拒否 0.25〜2.1ms。根拠: 実測のみ
- T16 の hook と同じ handler に振り分けても、T16 の検証(`posts` の参照の存在確認、`pages` の保存)はそのまま動いた。根拠: 実測のみ

### T29 への引き継ぎ(登録のしかた)

```ts
// src/index.ts(T29)の抜粋
import { definePlugin } from "emdash";

import { validateImageEntryBeforeSave } from "./server/hooks/image-entry";
import { validateReferencesBeforeSave } from "./server/hooks/references";
import { IMAGE_COLLECTION, IMAGE_REFS_STORAGE } from "./shared/constants";

export function createPlugin() {
	return definePlugin({
		id: "base64-image",
		version: PLUGIN_VERSION,
		// content:write: beforeSave の登録に必須(無いと警告だけ出して黙って飛ばす)。schema:read は T16 の ctx.schema
		capabilities: ["schema:read", "content:read", "content:write", "content:publish", "content:revisions:read"],
		storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } },
		hooks: {
			// content:beforeSave は 1 つのプラグインに 1 つだけ。T19(b64_images)と T16(それ以外)を振り分ける。
			// errorPolicy は書かない(既定の "abort")。"continue" にすると拒否の例外が捨てられ、保存が通る
			"content:beforeSave": {
				handler: async (event, ctx) => {
					if (event.collection === IMAGE_COLLECTION) return validateImageEntryBeforeSave(event, ctx);
					return validateReferencesBeforeSave(event, ctx);
				},
			},
		},
	});
}
```

- T19 の hook は `ctx` を使わない。必要なのは beforeSave の登録に要る capability `content:write` だけ。
- どちらの hook も相手のコレクションでは何もしないので、振り分けずに `await validateImageEntryBeforeSave(event, ctx); await validateReferencesBeforeSave(event, ctx);` と続けて呼んでもよい。どちらも値を変えないので、戻り値は `undefined`(保存するデータはそのまま)。
- この形の handler が `PluginHooks["content:beforeSave"]` に代入できることは、`tests/server/image-entry.test.ts` の型のテスト(`t29BeforeSave`)で確かめた。
- `priority` は T16 の提案(既定の 100 より大きい値)のままでよい。T19 は値を変えないので、順番の影響を受けない(推測のみ)。

### T18 への引き継ぎ

- アップロードのルートの `ctx.content.create("b64_images", { image })` でも、この hook が作成として呼ばれる(`actor` は無い)。① を通った値を T11 の例どおりに組み立てれば(`meta.bytes` は `checked.image.webpBytes`)、② も通る(テスト「アップロードのルート(T18)が作る値は通る」)。
- この hook が拒否すると、`ctx.content.create` は `ContentSaveRejectedError` ではなく、`name` と `code` が `"SAVE_REJECTED"`、`message` が hook の文の通常の `Error` を投げる(`references/emdash/packages/core/src/emdash-runtime.ts:2151`)。そのまま投げ直すと 500 `INTERNAL_ERROR` の固定の文になるので、`code` を見て自分のエラーコード(`UPLOAD_FAILED` など)に変換し、`message` はログに出す。① を通った値でここに来るのはルートの不具合なので、500 が妥当(推測のみ)。根拠: 実測+公式ドキュメント(投げられるものの形)
- `ctx.content.update` / `delete` はどの保存 hook も通らないので、この hook には止められない([[emdash-after-save-payload#プラグインからの書き込み]])。後始末で `delete` を使うことには影響しない。

### 仕様書への反映

このタスクで変えたところ(8 章の表の②、5.1、10 章だけ):

- 8 章の表の②: 作成は中身を検証し、`image` が無い・`null` も拒否。更新で `image` が送られてきたら値によらず拒否し、`image` の無い更新は通す。プラグインの `ctx.content.create` も対象で、クエリはしない。「不正なとき」は `ContentSaveRejectedError`(422 `SAVE_REJECTED`)と、日本語・英語の `message`。
- 5.1: 「画像エントリは、作成したあと変更しない」に、保存 hook が `image` を送る更新を拒否することと、その理由(公開中の値が書き換わる)を足した。
- 10 章: 「標準の編集画面からは `b64_images` のエントリを保存も公開もできない(「Unpublish」は通る)」を足した。

リーダーに反映を検討してほしいところ(ほかの章。このタスクでは変えていない):

1. 18 章(既知の制約とリスク): 「`b64_images` は標準の編集画面から保存・公開できない。非公開にしたものは、標準の API の `POST …/publish` で公開し直す」。
2. 付録 B: `packages/core/src/emdash-runtime.ts:2151`(プラグインの `ctx.content.create` が拒否を通常の `Error` にする)、`:3632`(`supports` に `revisions` の無いコレクションの更新は列を書き換える)、`packages/admin/src/router.tsx:1483`(「Publish now」は保存してから公開する)、`packages/core/src/astro/middleware/auth.ts:270`(MCP は Bearer だけ)。

### テスト

- `tests/server/image-entry.test.ts`: 64 件。偽の ctx は、何かのプロパティを読むと例外を投げる Proxy(hook が ctx を使わない=クエリをしないことを確かめる)。T11 の `validateImageEntry` は `vi.mock` で呼び出しを数え、実際の値では作れない失敗(保存先の理由、`details` の欠け)だけ結果を差し替えた。
  - 対象: ほかのコレクション(作成・更新)では何もせず、検証も呼ばない。ctx を読まない。ctx を省略しても呼べる。
  - 作成: 受け付ける 5 種類の WebP と、filename・quality の有無。固定上限の境界(`src` 499,999 / 500,003 文字)、長辺の境界(4,096 / 4,097px)。アップロードのルートが作る値(① を通った値)。オブジェクトでない値(省略・`undefined`・`null`・文字列・数値・配列)。形の問題 6 通り(キーの並べ方)。`meta.bytes`・寸法の不一致・アニメーション・data URL の誤り 3 通り。
  - 更新: `image` があれば値によらず拒否し、検証を呼ばない(6 通り)。`image` が無ければ何もしない(3 通り)。
  - message: T04 の 12 種類の理由の日本語の文(型で網羅を確かめ、文が互いに違うことも確かめる)、保存先の理由、`details` の欠け、句点の補い、長大なキーが 1,000 個あるときの切り方。
  - 例外と型: `ContentSaveRejectedError` と `isContentSaveRejection`。EmDash の beforeSave の handler として、また T29 の振り分けの handler として代入できる。
- 実装を 22 通りに壊し、どれもテストが失敗することを確かめた(1 つずつ入れて実行し、元に戻した)。根拠: 実測のみ

| 入れた不具合 | 失敗したテスト |
|---|---|
| コレクションを確かめない | 3 |
| 更新でも拒否せず、中身を検証する | 8 |
| 更新で `image` が無くても拒否する | 4 |
| 更新の `image: null` を「送られていない」とする | 1 |
| 更新で `image` のキーがあれば(値が `undefined` でも)拒否する | 1 |
| 作成と更新を取り違える | 57 |
| 作成の不正な値を通す | 39 |
| 作成の拒否を通常の `Error` で投げる | 39 |
| 英語を先にする | 43 |
| T11 の `message` を切らない | 1 |
| 英語の行に句点を足さない | 33 |
| キーの数を切らない / キーの長さを切らない | 1 / 1 |
| T04 の理由を日本語の文にしない | 16 |
| T04 の理由のコードを添えない | 15 |
| `details` の項目の名前を誤る | 1 |
| 日本語の数に桁区切りを付けない | 2 |
| `details` が無いとき空にする | 1 |
| 知らないキーを並べない | 3 |
| 入れ子のキーを最初の段だけにする | 1 |
| 値の形の問題をいつも「オブジェクトでない」にする | 7 |
| アニメーションの文を別の文にする | 1 |

- `npm run verify`: build(tsc の 3 つの設定と playground のビルド)・lint(oxlint・prettier)・test(13 ファイル 1,124 件)がすべて通った。

### 他のタスクへの影響

| タスク | 影響 |
|---|---|
| [[T29-plugin-definition\|T29]] | 上の登録のしかた。T19 の hook は ctx を使わない。`errorPolicy` を `"continue"` にしない |
| [[T18-upload-route\|T18]] | `ctx.content.create` が拒否されたときの例外の形(上の「T18 への引き継ぎ」)。`meta.bytes` は `checked.image.webpBytes` にする |
| [[T21-orphan-routes\|T21]] | ゴミ箱への移動(`ctx.content.delete`)と標準の API の復元・完全削除は beforeSave を通らないので、影響しない |
| [[T26-playground-pages\|T26]] / [[T31-e2e\|T31]] | 標準の新規作成の画面や REST で作った画像は `imageRefs` に無いので、投稿から参照できない(T16)。画像はアップロードのルートで作る。E2E で、標準の編集画面からの `b64_images` の保存が拒否されることを確かめてもよい |
| [[T32-cloudflare-check\|T32]] | workerd でも、拒否が 422 と `message` になることと、hook の処理時間を確かめる |
| [[T33-readme\|T33]] | 「`b64_images` は標準の画面で編集しない。編集画面からは保存も公開もできない。画像を差し替えるときは新しくアップロードする」と書く |

### 未解決・サブタスクの候補

1. 翻訳の作成(`translationOf`)は確かめていない(playground は多言語でない)。`image` を翻訳しないフィールドにしたサイトで、`image` を送らずに翻訳を作ると、EmDash は beforeSave のあとで元の値を写す(`core/src/emdash-runtime.ts:3352-3361`)が、この hook は先に「オブジェクトではない」で拒否する見込み(推測のみ)。仕様書の seed の `image` は翻訳する(既定)ので、通常は起きない。
2. seed と、ほかのプラグインの `ctx.content.update` は保存 hook を通らないので、そこから入った画像エントリは検証されない([[T16-reference-hook#未解決・サブタスクの候補|T16]] の 5 と同じ)。
3. 標準の編集画面で「Unpublish」すると、同じ画面からは公開し直せない(「Publish now」が保存を先に送るため)。標準の API の `POST /_emdash/api/content/b64_images/{id}/publish` なら公開できた。画像管理ページ([[T25-images-page|T25]])に公開し直す操作を置くかは未定。
