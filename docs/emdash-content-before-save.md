---
title: EmDash 0.39.1 の content:beforeSave で保存を拒否する方法と、渡る内容・管理画面の表示・クエリ数
aliases:
  - beforeSave で保存を拒否する
  - ContentSaveRejectedError の応答
  - SAVE_REJECTED の表示
  - 保存 hook の言語
tags:
  - docs
  - emdash
  - plugin
  - hooks
  - admin
source_task: "[[T16-reference-hook]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 の content:beforeSave で保存を拒否する方法と、渡る内容・管理画面の表示・クエリ数

> [!summary] 要点
> - 拒否は `ContentSaveRejectedError`(`emdash` から import)を投げる。応答は **422** `{ "success": false, "error": { "code": "SAVE_REJECTED", "message": … } }`。`message` はそのまま返り、改行も保たれる。**ほかの例外は 500 `CONTENT_HOOK_ERROR`** で、文言は「A plugin hook failed while saving content」に置き換わる。
> - 管理画面は、保存の失敗を通知(トースト)で出す。見出しは EmDash が訳し(「Failed to save」「保存に失敗しました」、自動保存は「Autosave failed」)、本文は `message` そのまま。**本文の改行は空白になる**。通知の幅は 340px で、約 5.6 秒で消える。
> - **hook は管理画面の言語を知る手段が無い。** event は `content` / `collection` / `isNew` / `id` / `actor`(`{ id, role }`)だけ。リクエストの文脈(`getRequestContext()`)にも、リクエストや Cookie は無い。`ctx.site.locale` はオプション `emdash:locale` の値で、0.39.1 ではセットアップでも設定画面でも書かれないので、既定の `en` になる。
> - 更新(`PUT`)の beforeSave には、**送ったフィールドだけ**が渡る。`data: {}` でも(空のオブジェクトで)呼ばれ、`data` の無い `PUT` では呼ばれない。管理画面は、保存・自動保存のたびに、フォームにあるすべてのフィールドを送る。
> - **`errorPolicy: "continue"` にすると、拒否の例外が捨てられて保存が通る。** beforeSave は既定の `"abort"` のままにする。
> - 1 つのプラグインの `content:beforeSave` は 1 つだけ(`hooks` のキー)。登録には capability `content:write` が要る(無いと警告を出して黙って飛ばす)。
> - クエリ数: `ctx.schema.getCollection` は 2(`_emdash_collections` と `_emdash_fields`)、プラグインストレージの `getMany` は 1 回 1(`id in (…)`。バインド変数は ID の数 + 2)。
> - 関連: [[T16-reference-hook]]、[[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8 章]]、[[emdash-after-save-payload]]、[[emdash-plugin-content-query-counts]]、[[emdash-plugin-route-errors]]、[[emdash-admin-locale-lang]]、[[emdash-seed-and-b64-images]]

> [!info] 確かめた方法と環境
> - playground を複製した使い捨てのサイト(`spikes/reference-hook/site/`、git 管理外)に、T16 の hook(`src/server/hooks/references.ts`)を登録するプラグイン(ID は本番と同じ `base64-image`)を入れた。受け取った event と結果を JSONL に書き、REST のリクエストと、Playwright で動かした管理画面の両方で保存した。[[#再現手順]]
> - macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、SQLite(`node:sqlite`)、Playwright 1.63.0(Chromium 153.0.8010.12、headless)、Kumo 2.6.0。開発サーバーはポート 4416。2026-09-24 に計測。
> - 行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。Cloudflare Workers(workerd + D1)では確かめていない。

## 拒否のしかたと応答

`POST /_emdash/api/content/{collection}`(作成)と `PUT …/{id}`(更新)で確かめた。

| hook の動き | HTTP | body | 根拠 |
|---|---|---|---|
| `throw new ContentSaveRejectedError(message)` | 422 | `{"success":false,"error":{"code":"SAVE_REJECTED","message":"…"}}` | 実測+公式ドキュメント(`core/src/plugins/save-rejection.ts:8-20`、`core/src/emdash-runtime.ts:513-539`、`core/src/api/errors.ts:510`) |
| 改行を含む `message` | 422 | `message` の `\n` がそのまま返る | 実測のみ |
| `throw new Error("…")` | 500 | `{"success":false,"error":{"code":"CONTENT_HOOK_ERROR","message":"A plugin hook failed while saving content"}}`。元のメッセージはサーバーのログ(`EmDash: content:beforeSave hook failed:`)にだけ出る | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:531-538`) |
| `errorPolicy: "continue"` で `ContentSaveRejectedError` を投げる | **201** | 保存が通る(拒否した値がそのまま入る) | 実測+公式ドキュメント(`core/src/plugins/hooks.ts:583-594` は、`errorPolicy` が `"abort"` のときだけ投げ直す) |

- 拒否の判定は、クラスだけでなく名前(`error.name === "ContentSaveRejectedError"`)でも行う。バンドラーがモジュールを複製しても拒否として扱われる(`core/src/plugins/save-rejection.ts:17-20`)。根拠: 公式ドキュメントのみ
- native プラグインの拒否では、応答に `details` は付かない(`details` が付くのは sandboxed プラグインの拒否だけ。`core/src/emdash-runtime.ts:514-529`)。どのフィールドの何が問題かは `message` に書くしかない。根拠: 実測+公式ドキュメント
- `errorPolicy` の既定は `"abort"`(`core/src/plugins/define-plugin.ts:258-290`)。afterSave では「後続のプラグインを止めない」ために `"continue"` にする([[emdash-after-save-payload#afterSave が例外を投げたとき]])が、**beforeSave で同じ指定をすると検証が効かなくなる**(上の表の最後の行)。
- beforeSave の登録には capability `content:write` が要る。無いと `[hooks] Plugin "…" declares content:beforeSave hook without content:write capability — skipping` と警告を出して登録しない(`core/src/plugins/hooks.ts:315-366`)。根拠: 公式ドキュメントのみ
- `hooks` はフック名をキーにしたオブジェクトなので、1 つのプラグインに `content:beforeSave` は 1 つしか書けない(`core/src/plugins/types.ts:1639`)。複数の検証は 1 つの handler の中で振り分ける。根拠: 公式ドキュメントのみ

## 管理画面での表示

| 操作 | 通知の見出し(英語 / 日本語の管理画面) | 本文 | 根拠 |
|---|---|---|---|
| 新規作成の保存 | Failed to save / 保存に失敗しました | `message` そのまま | 実測+公式ドキュメント(`admin/src/router.tsx:733-743`) |
| 編集画面の保存(タイトルだけを変えても) | Failed to save | 同上 | 実測+公式ドキュメント(`admin/src/router.tsx:1097-1109`) |
| 自動保存(最後の変更から 2 秒後) | Autosave failed | 同上 | 実測+公式ドキュメント(`admin/src/router.tsx:1190-1201`) |

- 本文は、応答の `error.message` をそのまま使う(`admin/src/lib/api/client.ts:98-117`)。`VALIDATION_ERROR` のようにフィールド名を訳して並べる仕組み(`admin/src/lib/content-validation-errors.ts`)は、`SAVE_REJECTED` には働かない。根拠: 実測+公式ドキュメント
- **改行は空白になる。** 通知の本文の要素には `white-space` の指定が無い(Kumo の toast の `text-[0.925rem] leading-5`)。`message` の 1 行ごとの文は、空白でつながった 1 つの段落として表示された。根拠: 実測+公式ドキュメント
- 通知の幅は 340px(Kumo の toast の `sm:w-[340px]`)。日本語と英語で 1 件ずつ書いた `message` は 10 行ほど(高さ 236px)、2 件と注意書きで 336px になった。根拠: 実測のみ
- 通知は、表示されてから約 5.6 秒で消えた(8 回で 5.56〜5.87 秒)。根拠: 実測のみ
- 自動保存が 4xx で拒否されると、管理画面は同じ内容の自動保存を送り直さない(`isTerminalRequestError`。`admin/src/router.tsx:1192`、`admin/src/components/ContentEditor.tsx:719-726`)。次に内容を変えると、また送る。根拠: 公式ドキュメントのみ

## hook に渡る内容(beforeSave)

`posts`(`supports: ["drafts", "revisions", "search", "seo"]`)と、画像のフィールドが無い `pages` で記録した。

| 操作 | beforeSave | `isNew` / `id` | `content` のキー | 根拠 |
|---|---|---|---|---|
| 作成 `POST` | 呼ばれる | `true` / 無い | 送ったフィールド | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:3335-3350`) |
| 更新 `PUT`(`data` の一部だけ) | 呼ばれる | `false` / エントリの ID | **送ったフィールドだけ**(`data: { title }` なら `["title"]`) | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:3469-3485`、`docs/src/content/docs/plugins/creating-plugins/hooks.mdx`) |
| 更新 `PUT`(`data: {}`) | 呼ばれる | `false` / ID | 空 | 実測のみ |
| 更新 `PUT`(`data` なし。SEO などだけ) | **呼ばれない** | — | — | 実測+公式ドキュメント(`:3471` の `if (bodyWithoutRev.data)`) |
| 管理画面の保存・自動保存 | 呼ばれる | `false` / ID | フォームにあるすべてのフィールド(値が無いフィールドは送られないことがある。seed の投稿では `gallery` が無かった) | 実測のみ |
| MCP の作成・更新 | 呼ばれる(同じ `handleContentCreate` / `handleContentUpdate` を通る) | — | — | 公式ドキュメントのみ(`core/src/mcp/server.ts:1031`、`:1188`) |

- `actor` は、REST と管理画面からの保存で `{ id, role }`(dev-bypass の管理者は `role: 50`)。根拠: 実測のみ
- 管理画面は、読み込んだ値を自動保存で送り返す。データベースの値が `null` のフィールドは `null` が届くので、EmDash の検証は、必須でないフィールドの `null` を通す(`core/src/schema/zod-generator.ts:38-48` のコメント)。beforeSave でも `null` を「値なし」として通さないと、既存のエントリの保存が壊れる。根拠: 公式ドキュメントのみ
- beforeSave のあとで EmDash がフィールドの型と必須を検証する(作成は `partial: false`、更新は `partial: true`。`core/src/emdash-runtime.ts:3366-3378`、`:3501-3512`)。beforeSave が値を変えなければ、その検証は送られた値に対して行われる。根拠: 公式ドキュメントのみ

## hook から管理画面の言語を知る方法は無い

| 見たもの | 中身 | 根拠 |
|---|---|---|
| event | `content` / `collection` / `isNew` / `id` / `actor`(`{ id, role }`)。言語は無い | 実測+公式ドキュメント(`core/src/plugins/types.ts:1295-1328`) |
| `getRequestContext()` | `editMode` / `queryRecorder` / `metrics` だけ(i18n を設定したサイトでは、ルーティングの `locale` も入る)。リクエスト・Cookie・`Accept-Language` は無い | 実測+公式ドキュメント(`core/src/request-context.ts`) |
| `ctx.site.locale` | オプション `emdash:locale` の値。無ければ `"en"`。0.39.1 では、このオプションを書くのはバックアップの復元だけ(セットアップ・設定画面では書かない)。playground では `en` だった | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:1553-1570`、`core/src/plugins/context.ts:1362-1369`、`core/src/api/handlers/backup.ts:68`) |
| 管理画面の言語 | Cookie `emdash-locale` → `Accept-Language` → `en` で決まる([[emdash-admin-locale-lang]])。hook からは読めない | 実測+公式ドキュメント |

- EmDash 自身も、サーバーのエラーの文言は英語だけにして、コードから管理画面が訳す方針(`references/emdash/.claude/CLAUDE.md` の「Server-side error messages are English-only for now」)。`SAVE_REJECTED` の `message` は訳されずにそのまま出るので、プラグインの文言は、読む人の言語を決め打ちするか、複数の言語を並べるしかない。根拠: 公式ドキュメントのみ

## クエリ数

同じ保存を、hook の検証あり・なしで送り、`Server-Timing` の `db.count` と、`EMDASH_QUERY_LOG=1` のリクエストごとの SQL を比べた。hook の中の処理は beforeSave なので、応答の前に終わり、`db.count` に入る。

| 保存 | なし | あり | 増えた SQL | 根拠 |
|---|---|---|---|---|
| `posts` の作成(`cover` と `gallery` に画像 3 枚) | 34 | 37 | `_emdash_collections` / `_emdash_fields` / `_plugin_storage … id in (?, ?, ?)` | 実測のみ |
| `pages`(画像のフィールドなし)の作成 | 33 | 35 | `_emdash_collections` / `_emdash_fields` | 実測のみ |
| `posts` の更新(すべてのフィールド) | 62 | 65 | 作成と同じ 3 本 | 実測のみ |
| `posts` の更新(`title` だけ) | 62 | 64 | `_emdash_collections` / `_emdash_fields` | 実測のみ |
| `pages` の更新 | 61 | 63 | 同上 | 実測のみ |
| 拒否した作成 | — | 5〜6 | 形の誤りだけなら `getMany` をしない | 実測のみ |

- `ctx.schema.getCollection` は、コレクションの行とフィールドの行の 2 クエリ(`core/src/schema/registry.ts:314-321`、`core/src/plugins/context.ts:379-381`)。リクエストの中でキャッシュされないので、**画像のフィールドが無いコレクションの保存でも 2 増える**。EmDash の更新は、beforeSave の前に同じフィールド定義を読んでいる(`core/src/emdash-runtime.ts:3464-3466`)が、hook には渡さない。根拠: 実測+公式ドキュメント
- `getMany` は ID を分けずに 1 つの `IN` に入れる。SQL は `select "id", "data" from "_plugin_storage" where "plugin_id" = ? and "collection" = ? and "id" in (?, ?, ?)` で、バインド変数は ID の数 + 2(`core/src/database/repositories/plugin-storage.ts:271-288`)。D1 の上限(1 クエリ 100 個)を超えないよう、呼ぶ側で分ける。根拠: 実測+公式ドキュメント
- 更新(`PUT`)の `db.count` は、同じリクエストでも 56〜65 とばらついた。リビジョンの整理(`DELETE FROM revisions … NOT IN (…)`)が同じリクエストで数えられ、その回数と `NOT IN` の長さが回ごとに違うため。hook のクエリは、`db.count` の差ではなく SQL の差で数えた。根拠: 実測のみ([[emdash-plugin-content-query-counts#書き込み(参考)]] の 55〜62 と同じ現象)
- hook の実行時間(クエリの待ち時間を含む、SQLite)は、139 回で中央値 0.20ms、95 パーセンタイル 0.84ms、最大 4.5ms(起動直後)。根拠: 実測のみ

## 再現手順

1. playground の `src/` と `tsconfig.json` を `spikes/reference-hook/site/` に複製し、`astro.config.mjs` の `plugins` を spike のプラグインに差し替える。`package.json` には playground と同じ `dependencies` を書く([[emdash-after-save-payload#再現手順]] の注意)。
2. seed に、画像のフィールドを持つ `posts`、持たない `pages`、`b64_images` と、seed で作る画像とそれを参照する投稿を入れる。
3. `spikes/reference-hook/site/` で `EMDASH_QUERY_LOG=1 node <worktree>/node_modules/astro/bin/astro.mjs dev --port 4416` を実行する(エージェントから実行するとバックグラウンドになる。[[astro-dev-background-for-agents]])。止めるのは同じディレクトリで `… astro.mjs dev stop`。**プラグインのコードを変えたら、サーバーを起動し直す**(プラグインは起動時に作られ、ファイルを変えても差し替わらなかった。実測のみ)。
4. `GET /_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` の Cookie と `X-EmDash-Request: 1` で REST を呼ぶ。管理画面は Playwright で操作する(最初の画面で「Welcome to EmDash, Dev!」を閉じる。日本語の管理画面は Cookie `emdash-locale=ja` で開き、保存のボタンは「保存」)。

```js
// spikes/reference-hook/site/astro.config.mjs(抜粋)
emdash({
	database: sqlite({ url: "file:./data.db" }),
	plugins: [{ id: "base64-image", version: "0.0.0", entrypoint: "/plugins/spike-refs.ts", options: {} }],
	fonts: false,
}),
```

```ts
// spikes/reference-hook/site/plugins/spike-refs.ts(抜粋)
import { ContentSaveRejectedError, definePlugin } from "emdash";
import { validateReferencesBeforeSave } from "../../../../src/server/hooks/references.ts";

export function createPlugin() {
	return definePlugin({
		id: "base64-image",
		version: "0.0.0",
		// content:write が無いと beforeSave は登録されない。schema:read が無いと ctx.schema が無い
		capabilities: ["schema:read", "content:read", "content:write"],
		storage: { imageRefs: { indexes: ["createdAt"] } },
		hooks: {
			"content:beforeSave": {
				// "continue" にすると拒否が捨てられて保存が通る(上の表)
				errorPolicy: process.env["SPIKE_ERROR_POLICY"] === "continue" ? "continue" : "abort",
				handler: async (event, ctx) => {
					const title = typeof event.content["title"] === "string" ? event.content["title"] : "";
					if (title.includes("[throw-plain]")) throw new Error("spike: plain error in beforeSave");
					if (title.includes("[reject-lines]")) throw new ContentSaveRejectedError("first line\nsecond line");
					await validateReferencesBeforeSave(event, ctx);
				},
			},
		},
		routes: {
			// imageRefs に記録を作る(アップロードの代わり)。permission を省くと管理者だけ
			"spike/put-refs": {
				handler: async (ctx) => {
					const { ids } = ctx.input as { ids: string[] };
					await ctx.storage["imageRefs"]!.putMany(ids.map((id) => ({ id, data: { owners: [] /* … */ } })));
					return { ids };
				},
			},
		},
	});
}
```

- 通知の文言は、見出しの文字列(`Failed to save` など)で要素を探し、祖先の `li` の `innerText` を読んだ。通知は下から入ってくるので、スクリーンショットは表示から 0.7 秒待って撮った。根拠: 実測のみ
- hook を足したクエリの特定は、[[emdash-plugin-content-query-counts#計り方]] のやり方で `dev.log` をリクエストごとに分け、検証あり・なしの同じ種類のリクエストの SQL の差(多重集合の差)を取った。
