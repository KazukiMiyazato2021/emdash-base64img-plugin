---
title: b64_images の保存 hook(作成の検証と更新の拒否)と、書き込みの経路ごとの動き
aliases:
  - b64_images の保存 hook
  - 画像エントリの保存 hook
  - validateImageEntryBeforeSave
  - b64_images の更新の拒否
tags:
  - docs
  - emdash
  - plugin
  - hooks
  - b64_images
source_task: "[[T19-image-entry-hook]]"
created: 2026-09-24
updated: 2026-09-24
---

# b64_images の保存 hook(作成の検証と更新の拒否)と、書き込みの経路ごとの動き

> [!summary] 要点
> - `src/server/hooks/image-entry.ts` の `validateImageEntryBeforeSave(event, ctx)` は、`b64_images` の `content:beforeSave` の本体。**作成**(`isNew: true`)では `image` を T11 の `validateImageEntry` で確かめ、**更新**(`isNew: false`)では `image` が送られてきたら値によらず拒否する。`image` の無い更新と、ほかのコレクションでは何もしない。ctx は使わず、クエリもしない。
> - hook が無いと、EmDash は `json` フィールドの中身を確かめない。上限を超える `src`・WebP でない `src`・アニメーション・知らないキーも 201 で保存され、`image: null` は 500 になる。**`b64_images`(`supports: []`)の更新は、公開中の列の値をそのまま書き換える**(下書きのリビジョンは作られない)。
> - 管理画面の標準の編集画面は、保存・自動保存・「Publish now」のたびに `data.image` を送る(slug だけを変えても送る)。そのため、この hook のもとでは、`b64_images` のエントリはそこから保存も公開もできない。拒否の `message` は通知(「Failed to save」「Autosave failed」「保存に失敗しました」など)の本文にそのまま出る。「Unpublish」は PUT を送らないので通る。
> - プラグインの `ctx.content.create` の中で拒否されると、呼んだ側には `name` と `code` が `"SAVE_REJECTED"` の**通常の `Error`** が届く(`ContentSaveRejectedError` ではない。`message` は hook の文)。
> - MCP は Bearer のトークンだけを受け付ける(セッションの Cookie は 401)。`content_create` / `content_update` も同じ hook を通り、拒否はツールの結果(`isError: true`)の `[SAVE_REJECTED] <message>` になる。
> - 処理時間は、開発サーバーの 69 回で中央値 0.10ms(作成の検証 0.12ms、更新の拒否 0.035ms)。hook が足すクエリは 0 で、拒否した作成は 3 クエリで終わる(通すと 32)。
> - 関連: [[T19-image-entry-hook]]、[[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8 章②]]、[[server-image-validation]](T11 の検証)、[[emdash-content-before-save]](拒否の方法と管理画面の表示)、[[emdash-after-save-payload]](操作ごとに呼ばれる hook)、[[emdash-seed-and-b64-images]]

> [!info] 確かめた方法と環境
> - playground を複製した使い捨てのサイト(`spikes/image-entry-hook/site/`、git 管理外)に、ID が `base64-image` の native プラグインを入れた。`content:beforeSave` は [[T29-plugin-definition|T29]] と同じく 1 つの handler で、`b64_images` なら T19、それ以外なら [[T16-reference-hook|T16]] の hook を呼ぶ。受け取った event と結果と処理時間を JSONL に書いた。環境変数 `SPIKE_MODE=record` で起動すると検証をせず、EmDash だけの動きを見られる。[[#再現手順]]
> - 標準の REST API・プラグインのルート(アップロードの代わりに `ctx.content.create` → `getVersioned` → `publish`)・MCP・管理画面(Playwright で操作)で書き込んだ。
> - macOS 26.4(Darwin 25.4.0、arm64、Apple M5 Pro)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、SQLite(`node:sqlite`)、Playwright 1.63.0(Chromium 153.0.8010.12、headless)。開発サーバーはポート 4419。2026-09-24 に計測。
> - 行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。Cloudflare Workers(workerd + D1)では確かめていない。

## hook の動き

| 保存 | hook の動き | 根拠 |
|---|---|---|
| `b64_images` の作成(REST の POST・MCP の `content_create`・管理画面の新規作成・プラグインの `ctx.content.create`) | `validateImageEntry(event.content.image)`。失敗したら `ContentSaveRejectedError`(422 `SAVE_REJECTED`) | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:3335-3350`) |
| 作成で `image` が無い・`null`・オブジェクトでない | 拒否(EmDash だけなら、省略は 400 `VALIDATION_ERROR`、`null` は 500 `CONTENT_CREATE_ERROR`) | 実測のみ |
| `b64_images` の更新で `image` がある(同じ値・`null` も) | 拒否。中身は確かめない(デコードしない) | 実測のみ |
| `b64_images` の更新で `image` が無い(`data: {}` など) | 何もしない | 実測のみ |
| `data` の無い更新 / 無い ID への更新 | hook は呼ばれない(無い ID は REST のルートが先に 404 を返す) | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:3471`、`core/src/astro/routes/api/content/[collection]/[id].ts:79-86`) |
| ほかのコレクション | 何もしない(T29 の handler が T16 に振り分ける) | 実測のみ |

- event のキーは、REST・MCP・管理画面からの保存では `content` / `collection` / `isNew` / `actor`(更新では `id` も)。プラグインの `ctx.content.create` では `actor` が無い。根拠: 実測+公式ドキュメント(`core/src/plugins/hooks.ts:543-576`)
- `message` は日本語と英語の 2 行。日本語の行は T11 の `reason` と `details` から書き、英語の行は T11 の `message` をそのまま使う(300 文字で切る)。hook が管理画面の言語を知らないことは [[emdash-content-before-save#hook から管理画面の言語を知る方法は無い]]。

```text
画像エントリ(b64_images.image): meta.bytes(777)が、src の WebP 本体のバイト数(778)と一致しません。
Image entry (b64_images.image): meta.bytes (777) does not match the size of the WebP in src (778 bytes).
```

```text
画像エントリ(b64_images.image): 作成したあとは変更できません。別の画像にするときは、新しい画像をアップロードしてください。
Image entry (b64_images.image): it cannot be changed after it is created. To use a different image, upload a new one.
```

## 更新の扱い(決めたこと)

| 案 | 管理画面の標準の編集画面 | 参照・`imageRefs` との食い違い | 費用 | 採否 |
|---|---|---|---|---|
| A. 中身だけ確かめる(作成と同じ) | 変えずに保存・公開できる | 別の正しい画像に差し替えられる。参照の `width` / `height` と `imageRefs` のサムネイル・バイト数・寸法が、元の画像のまま残る | クエリ 0 | 不採用 |
| **B. `image` があれば値によらず拒否する** | 保存・自動保存・「Publish now」は拒否される(「Unpublish」は通る) | 起きない | クエリ 0、デコードもしない | **採用** |
| C. 保存済みの値と比べ、違うときだけ拒否する | 変えずに保存・公開できる | 起きない | `ctx.content.get` で 2 クエリと最大 500,000 バイトの読み出し、capability `content:read`、値の比較 | 不採用 |

- 採用の理由: 仕様書 5.1・10 章は「画像エントリは、作成したあと変更しない」。`b64_images` の更新は公開中の値をすぐに書き換える(下の表)ので、差し替えを許すと、サイトの画像と参照の寸法・一覧のサムネイルが食い違う。B は判定に何も読まずに済む。
- B で困るのは、標準の編集画面から `b64_images` を保存・公開できないことだけ。標準の画面はもともと使わない(仕様書 10 章)。プラグイン自身は `b64_images` を更新しない(アップロードは作成と公開だけで、公開は beforeSave を通らない)。根拠: 推測のみ(影響の見積もり)
- C で通るようになるのは、標準の編集画面での `image` を変えない保存(slug・投稿者などの変更と「Publish now」)だけ。保存ボタンは変更が無いと押せない(`admin/src/components/SaveButton.tsx:99`)が、slug だけを変えても `data.image` は送られる。`b64_images` は `routable: false` で slug を使わず、標準の画面も使わないので、そのために `image` を含む更新のたびに読み出しを足す理由は無い。根拠: 画面の動きは実測+公式ドキュメント。使い道の判断は推測のみ

## hook が無いときの EmDash の動き

`SPIKE_MODE=record`(検証なし)と、この hook を入れたとき(検証あり)で、同じリクエストを送った。`db.count` は `Server-Timing` のクエリ数。

| 書き込み(REST) | 検証なし | 検証あり |
|---|---|---|
| 作成: 正しい値(lossy 300 × 199、filename・quality の有無、`src` 499,999 文字) | 201(32) | 201(32) |
| 作成: `src` 500,003 文字 / 正しい `src` + 2 文字(500,001 文字) | **201**(32) | 422(3) |
| 作成: `image` を省略 | 400 `VALIDATION_ERROR`(7) | 422(3) |
| 作成: `image: null` | **500 `CONTENT_CREATE_ERROR`**(13) | 422(3) |
| 作成: `image` が文字列 / `meta` が無い / 知らないキー / `meta.bytes` が違う / 寸法が違う / アニメーション / PNG の data URL / 長辺 4,097px / 長い知らないキー 1,000 個 | **201**(32) | 422(3) |
| 更新: 同じ `image` / 別の正しい `image` / 不正な `image` | **200**(38) | 422(12) |
| 更新: `image: null` | **500 `CONTENT_UPDATE_ERROR`**(21) | 422(12) |
| 更新: `data: {}` / `data` なし | 200(38 / 31) | 200(38 / 31) |
| 無い ID に `image` | 404 `NOT_FOUND`(5) | 404(5) |

- 根拠: 実測のみ(表の値)。`json` フィールドの検証は `z.unknown()` で中身を見ない(`core/src/schema/zod-generator.ts:174`。[[server-image-validation#widget とフィールドの型]])。
- **公開中の値が書き換わる。** アップロードのルートと同じ作り方で公開した画像(300 × 199)を、検証なしで PUT(257 × 129)すると 200 で、`status` は `published` のまま、`draftRevisionId` は `null` のまま、列の値が 257 × 129 になった。リビジョンは公開のときの 1 件だけ。`supports` に `revisions` が無いコレクションの更新は、下書きのリビジョンを作らずに列を書き換える(`core/src/emdash-runtime.ts:3521`、`:3632`)。検証ありでは 422 で、値は変わらなかった。根拠: 実測+公式ドキュメント
- 検証ありの `db.count` は、通した作成では検証なしと同じ(hook はクエリをしない)。拒否した作成は 3、拒否した更新は 12 で、保存の処理に進まない分だけ少ない。根拠: 実測のみ

## 管理画面(標準の画面)

Chromium で `/_emdash/admin/content/b64_images/new` と `/_emdash/admin/content/b64_images/{id}` を直接開いた(`b64_images` はサイドバーに出ない)。`image` は widget の無い `json` フィールドなので、JSON の入力欄(textarea)になる。

| 操作 | 送られたリクエスト | 結果 | 根拠 |
|---|---|---|---|
| 新規作成: 正しい値を入れて保存 | `POST`(`data.image`・`bylines`) | 201。編集画面に移る(下書き) | 実測のみ |
| 新規作成: `meta.bytes` の違う値で保存 | `POST` | 422。通知「Failed to save」の本文に `message`(2 行が空白でつながる) | 実測のみ |
| 公開済みの画像を開いただけ | なし | 保存ボタンは「Saved」で押せない。ほかに「Unpublish Base64 Images」、Slug、Ownership、Bylines、「Move to Trash」がある | 実測+公式ドキュメント(`admin/src/components/SaveButton.tsx:99`) |
| JSON を変えて保存 | `PUT`(`data.image`・`_rev`) | 422。「Failed to save」+ 変更できない旨。値は変わらない | 実測のみ |
| JSON を変えて 2 秒待つ | `PUT`(`data.image`・`skipRevision`・`_rev`) | 422。「Autosave failed」+ 同じ `message` | 実測のみ |
| slug だけを変えて保存 | `PUT`(`data.image`・`slug`・`_rev`) | 422。slug も変わらない | 実測のみ |
| 変えずに「Unpublish」 | `POST …/unpublish` だけ | 200。下書きに戻る(beforeSave は呼ばれない) | 実測+公式ドキュメント(`admin/src/components/ContentEditor.tsx:921` は、未保存の変更があるときだけ保存を先に送る) |
| 下書きの画像で「Publish now」 | `PUT`(`data.image`・`_rev`)で止まる | 422。「Failed to save」。公開されない | 実測+公式ドキュメント(`admin/src/router.tsx:1483-1497` は、公開の前に必ず保存を送る) |
| 日本語の管理画面(Cookie `emdash-locale=ja`)で同じ拒否 | — | 見出しは「保存に失敗しました」「自動保存に失敗しました」、本文は `message` のまま | 実測のみ |

- 非公開にした画像は、標準の API の `POST /_emdash/api/content/b64_images/{id}/publish` で公開し直せた(PUT を送らないので beforeSave を通らない)。根拠: 実測のみ
- 新規作成の画面で作った画像は `imageRefs` に記録が無いので、投稿から参照すると T16 の hook が拒否する([[T16-reference-hook#seed の画像の扱い]] と同じ)。画像はアップロードのルートで作る。根拠: 公式ドキュメントのみ(T16 の実装から)

## プラグインの `ctx.content.create`(アップロードのルート)

| 確かめたこと | 結果 | 根拠 |
|---|---|---|
| hook が呼ばれるか | 呼ばれる(`isNew: true`、`actor` なし)。正しい値なら作成・公開まで 200(72 クエリ) | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:2128-2157`) |
| hook が拒否したときに投げられるもの | `name: "SAVE_REJECTED"`、`code: "SAVE_REJECTED"`、`message` は hook の文の**通常の `Error`**。`instanceof ContentSaveRejectedError` も `isContentSaveRejection` も false | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:2151`: `throw Object.assign(new Error(result.error.message), { name: result.error.code, code: result.error.code })`) |

- ルートでこの例外をそのまま投げると、EmDash は 500 `INTERNAL_ERROR` の固定の文にする([[emdash-plugin-route-errors]])。T18 は `code === "SAVE_REJECTED"` を受け止めて、自分のコードに変換する必要がある。① を通った値は ② も通る([[server-image-validation#上限の決め方]])ので、ここで拒否されるのはルートの不具合(`meta.bytes` の入れ方の誤りなど)。根拠: 推測のみ(ルートでの変換は T18 で確かめる)

## MCP

| 確かめたこと | 結果 | 根拠 |
|---|---|---|
| セッションの Cookie で `POST /_emdash/api/mcp` | 401 `NOT_AUTHENTICATED` | 実測+公式ドキュメント(`core/src/astro/middleware/auth.ts:264-271`: MCP は Bearer だけ) |
| API トークン(`content:read`・`content:write`)で `content_create`(正しい値) | 作成された(下書き) | 実測のみ |
| 同じく `content_create`(`meta.bytes` が違う) | ツールの結果が `isError: true` で、本文は `[SAVE_REJECTED] <message>` | 実測+公式ドキュメント(`core/src/mcp/server.ts:333`) |
| `content_update`(別の `image`) | 同じく `[SAVE_REJECTED]` と、変更できない旨の `message` | 実測のみ |
| `content_update`(`data: {}`) | 通る(hook は空の `content` で呼ばれ、何もしない) | 実測のみ |

- `content_update` には `_rev` が要る。無いと「`_rev is required: call content_get for this item and pass back the _rev it returns.`」で、hook まで届かない(`core/src/mcp/server.ts:59`)。根拠: 実測+公式ドキュメント
- トークンは `POST /_emdash/api/admin/api-tokens`(`{ name, scopes }`)で作った([[emdash-plugin-route-permissions]])。

## 処理時間

開発サーバーの hook の中で、`validateImageEntryBeforeSave` の前後の `performance.now()` の差を記録した(`b64_images` の 69 回。ms)。

| 場面 | 回数 | 中央値 | p95 | 最大 |
|---|---|---|---|---|
| 作成・通した | 19 | 0.118 | 0.958 | 2.197(起動後の 1 回目) |
| 作成・拒否した | 31 | 0.148 | 0.716 | 7.531(起動後の最初の拒否) |
| 更新・拒否した | 16 | 0.035 | 0.083 | 0.104 |
| 更新・`image` なし | 3 | 0.005 | 0.005 | 0.006 |

- 新しいプロセスで 1 回目だけを測ると(esbuild でまとめて Node で実行)、通す作成が 1.0〜3.2ms、上限超えの拒否が 0.25〜2.1ms、更新の拒否が 0.06ms だった。どちらも最初の実行だけが大きい(ディスクのキャッシュが冷えた 1 回目が 3.2ms / 2.1ms で、以後は 1.0ms / 0.25ms 前後)。2 回目からは 0.04〜0.2ms。根拠: 実測のみ
- 検証そのものの重さ(固定上限の入力で 0.14ms / 0.41ms。`fromBase64` / `atob`)は [[server-image-validation#処理時間]]。Workers(workerd)では測っていない。

## 再現手順

1. playground の `src/` と `tsconfig.json` を `spikes/image-entry-hook/site/` に複製し、`astro.config.mjs` の `plugins` を spike のプラグインに差し替える。`package.json` には playground と同じ `dependencies` を書く([[emdash-after-save-payload#再現手順]] の注意)。seed には `b64_images`・`posts`(画像のフィールドあり)・`pages`(なし)を入れる。
2. `spikes/image-entry-hook/site/` で `EMDASH_QUERY_LOG=1 node <worktree>/node_modules/astro/bin/astro.mjs dev --port 4419` を実行する(エージェントから実行するとバックグラウンドになる。止めるのは同じディレクトリで `… astro.mjs dev stop`。[[astro-dev-background-for-agents]])。検証なしで見るときは `SPIKE_MODE=record` を付けて起動し直す(プラグインのコードや環境変数を変えたら起動し直す)。
3. `GET /_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` の Cookie と `X-EmDash-Request: 1` で REST を呼ぶ。MCP は API トークンを作って `Authorization: Bearer …` で呼ぶ。管理画面は Playwright で開き、最初に出る「Welcome to EmDash, Dev!」の「Get Started」を、表示されるまで待ってから押す(`isVisible` は待たないので、`waitFor` を使う)。

```js
// spikes/image-entry-hook/site/astro.config.mjs(抜粋)
emdash({
	database: sqlite({ url: "file:./data.db" }),
	plugins: [{ id: "base64-image", version: "0.0.0", entrypoint: "/plugins/spike-image-entry.ts", options: {} }],
	fonts: false,
}),
```

```ts
// spikes/image-entry-hook/site/plugins/spike-image-entry.ts(抜粋)
import { definePlugin } from "emdash";
import { validateImageEntryBeforeSave } from "../../../../src/server/hooks/image-entry.ts";
import { validateReferencesBeforeSave } from "../../../../src/server/hooks/references.ts";

export function createPlugin() {
	return definePlugin({
		id: "base64-image",
		version: "0.0.0",
		capabilities: ["schema:read", "content:read", "content:write", "content:publish", "content:revisions:read"],
		storage: { imageRefs: { indexes: ["createdAt"] } },
		hooks: {
			"content:beforeSave": {
				handler: async (event, ctx) => {
					// T29 と同じ振り分け。errorPolicy は既定の "abort" のまま
					if (event.collection === "b64_images") return validateImageEntryBeforeSave(event, ctx);
					return validateReferencesBeforeSave(event, ctx);
				},
			},
		},
		routes: {
			// アップロードのルートの代わり: 拒否されたときに投げられるものを返す
			"spike/create-image": {
				request: { body: "json", maxBytes: 2_000_000 },
				input: z.object({ image: z.unknown(), publish: z.boolean().optional() }),
				handler: async (ctx) => {
					try {
						const item = await ctx.content!.create!("b64_images", { image: ctx.input.image });
						// publish が true なら getVersioned → publish
						return { ok: true, id: item.id };
					} catch (error) {
						return { ok: false, name: error.name, code: error.code, message: error.message };
					}
				},
			},
		},
	});
}
```

- REST の確認は `scripts/rest.mjs`、公開済みの画像の更新は `scripts/published-update.mjs`、T16 との振り分けは `scripts/dispatch.mjs`、管理画面は `scripts/admin.mjs`(`ja` を渡すと日本語の管理画面)、MCP は `scripts/mcp.mjs`、1 回目の時間は `scripts/bench-entry.ts`(いずれも `spikes/image-entry-hook/` の中。git 管理外)。
- テスト用の値は、`tests/fixtures/webp/` の WebP と、`VP8X` の WebP を `XMP ` チャンクで伸ばしたもの(`src` 499,999 / 500,003 文字。作り方は [[server-image-validation#実際の WebP を指定の大きさにする]])。
