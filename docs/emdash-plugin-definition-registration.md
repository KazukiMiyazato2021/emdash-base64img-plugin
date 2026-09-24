---
title: EmDash 0.39.1 の native プラグインの登録(definePlugin)と、登録を確かめるテスト
aliases:
  - definePlugin の登録
  - capability と ctx のアクセサー
  - hook の priority と errorPolicy
  - admin.fieldWidgets は表示に使われない
  - プラグインのページがサイドバーに出る条件
  - 登録を確かめるテスト
tags:
  - docs
  - emdash
  - plugin
  - testing
source_task: "[[T29-plugin-definition]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 の native プラグインの登録(definePlugin)と、登録を確かめるテスト

> [!summary] 要点
> - `ctx` に入るアクセサーは、プラグインの capability とストレージの宣言だけで決まる。宣言が足りないと、ルートはアクセサーが無くて 500 になり、hook は**警告を出すだけで登録されない**(プラグインは読み込まれ、その hook の処理だけが黙って行われない)。根拠: 実測+公式ドキュメント
> - hook の登録に要る capability: `content:beforeSave` は `content:write`、`content:afterSave` / `afterPublish` / `afterDelete` は `content:read`。lifecycle hook は要らない。`content:write` / `content:publish` / `content:revisions:read` があると、`definePlugin` が `content:read` を足す。`content:restore` は `content:read` を含まない。根拠: 実測+公式ドキュメント
> - hook は priority の小さい順に実行され、同じなら登録順(`plugins: [...]` の並び)。beforeSave は、前の hook が返した値を次の hook に渡す。例外で保存を止めるのは `errorPolicy: "abort"`(既定)のときだけ。base64-image の beforeSave は priority 200(既定 100 のほかのプラグインのあと)で、`errorPolicy` は書かない。根拠: 実測+公式ドキュメント
> - `admin.fieldWidgets` は**マニフェストに載るだけ**で、native プラグインの widget の表示には使われない。管理画面は、管理画面の入口の `fields[<widget の名前>]` を探し、無ければ標準の入力(`json` なら textarea)を出す。根拠: 実測+公式ドキュメント
> - プラグインのページの項目は、**サイドバーには、管理画面の入口の `pages` に部品があるときだけ出る**(`adminMode: "react"`)。コマンドパレットはそれを確かめないので、入口に `pages` が無いと、パレットから開いたページは Block Kit の画面になり、404「Plugin route not found」のエラーになった([[T30-admin-entry|T30]] の前の状態)。根拠: 実測+公式ドキュメント
> - テストでは、本物の `createHookPipeline` に登録して hook の並びと実行を、その `PluginContextFactory` で作る ctx(データベースは偽物)で capability とストレージの宣言を確かめられる。根拠: 実測のみ
> - 関連: [[T29-plugin-definition]]、[[emdash-native-plugin-lifecycle-hooks]]、[[emdash-native-plugin-entrypoints]]、[[emdash-admin-plugin-pages]]、[[emdash-content-before-save]]、[[emdash-plugin-content-api-constraints]]

> [!info] 環境
> - macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、`emdash` / `@emdash-cms/admin` 0.39.1、Astro 7.3.3、SQLite(`node:sqlite`、SQLite 3.53.4)、vitest 4.1.11、TypeScript 6.0.3、Playwright 1.63.0(Chromium 153.0.8010.12、ヘッドレス)。2026-09-24 に計測。
> - playground(`npm run dev -w playground -- --port 4429`)と、`b64_images` の無い使い捨てのサイト(`spikes/t29-plugin/site/`、git 管理外。[[emdash-native-plugin-lifecycle-hooks#再現手順]])を使った。
> - 行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。

## capability と ctx

`PluginContextFactory.createContext`(`core/src/plugins/context.ts:1624-1706`)は、capability とストレージの宣言から ctx を組み立てる。組み立てるときにデータベースは読まない。根拠: 実測+公式ドキュメント

| capability | ctx に入るもの | base64-image で使うところ | 無いとき |
|---|---|---|---|
| `schema:read` | `ctx.schema`(`getCollection` / `listCollections`。`:1706`) | T16・T18・T20(フィールド定義)、T21(消されたコレクション)、`b64_images` の確認 | `ctx.schema` が `undefined` |
| `content:read` | `ctx.content.get` / `list`(`:1664-1669`) | T17 のプレビュー、T21 の一覧。after* の hook の登録 | `content:write` などから補われるので、宣言を外しても変わらない |
| `content:write` | `create` / `update` / `delete` など(`:1652-1663`) | T18 のアップロード、T18 の後始末と T21 のゴミ箱(`delete`)。beforeSave の登録 | beforeSave が登録されない |
| `content:publish` | `getVersioned` / `publish` / `unpublish` / `schedule` / `unschedule`(`:1670-1686`) | T18(作った画像の公開) | アップロードが 500 |
| `content:revisions:read` | `getRevision`(`:1658`、`:1667`) | T21(参照元の下書き) | 一覧が 500 |
| `content:restore` | `getTrashedVersioned` / `restore`(`:1687-1704`) | T21(画像がゴミ箱にあるか) | 一覧・ゴミ箱が 500 |

- 「無いとき」のうち、ルートの 500 は [[T17-admin-data-routes|T17]]・[[T18-upload-route|T18]]・[[T21-orphan-routes|T21]] の結果による。このタスクでは、宣言したときにアクセサーがあること(単体テスト)と、宣言を外すとテストが失敗すること([[T29-plugin-definition#ミューテーションテスト|ミューテーションテスト]])を確かめた。
- `definePlugin` は capability の名前を検証し(知らない名前は例外)、`PLUGIN_CAPABILITY_IMPLICATIONS` で足す(`core/src/plugins/define-plugin.ts:201-208`、`core/src/plugins/types.ts:84-107`)。根拠: 公式ドキュメントのみ
- `content:restore` を宣言し、`content:read`(と、それを補う capability)が無いと、`get` / `list` は「Missing capability: content:read」を投げる代わりの関数になる(`context.ts:1689-1696`)。base64-image は `content:read` も宣言するので当たらない。根拠: 公式ドキュメントのみ
- ストレージ: `storage: { imageRefs: { indexes: ["createdAt"] } }` で `ctx.storage.imageRefs` ができる。`query` の `where` / `orderBy` に索引の無い項目を使うと、データベースを読む前に「Cannot query on non-indexed field」「Cannot order by non-indexed field」を投げる(`core/src/plugins/storage-query.ts:113-146`)。宣言を変えると、一覧(T21)はそこで 500 になる。根拠: 実測+公式ドキュメント(単体テストで、`createdAt` の `orderBy` は偽のデータベースまで届き、`createdBy` は届く前に拒否された)

## hook の登録と実行順

| hook | 登録に要る capability | base64-image の設定 | 中身 |
|---|---|---|---|
| `plugin:activate` | なし | 既定(priority 100、`abort`) | `b64_images` の確認([[emdash-native-plugin-lifecycle-hooks]]) |
| `content:beforeSave` | `content:write` | priority 200、`errorPolicy` は既定の `abort` | `b64_images` は T19、ほかは T16 に振り分ける。最初の保存で `b64_images` を確かめる |
| `content:afterSave` / `content:afterPublish` | `content:read` | T20 の `imageOwnerHooks` のまま(priority 50、`continue`) | 参照元の記録 |
| `content:afterDelete` | `content:read` | T21 の `imageDeletedHooks` のまま(priority 50、`continue`) | 完全削除した画像の記録を消す |

- 登録に要る capability は `HOOK_REQUIRED_CAPABILITY`(`core/src/plugins/hooks.ts:309-348`)。無ければ `console.warn("[hooks] Plugin \"…\" declares … hook without … capability — skipping")` を出して登録しない(`:353-376`)。根拠: 実測+公式ドキュメント
- 既定は priority 100、timeout 5,000ms、`errorPolicy: "abort"`(`core/src/plugins/define-plugin.ts:262-289`)。`sortHooks`(`hooks.ts:388-420`)は priority の小さい順に並べ、同じ priority なら元の順(登録順)を保つ。根拠: 実測+公式ドキュメント
- beforeSave(`hooks.ts:543-598`)は、hook が値を返せば次の hook にその値を渡し、例外は `errorPolicy === "abort"` のときだけ投げ直す。`"continue"` にすると、`ContentSaveRejectedError` も捨てられて保存が通る。根拠: 実測+公式ドキュメント
- 1 つのプラグインが持てる beforeSave は 1 つ(`hooks` のキー)。`b64_images`(T19)と参照(T16)を 1 つの handler で振り分ける(`src/server/plugin.ts` の `validateBeforeSave`)。

### beforeSave の priority を 200 にした理由

ほかのプラグインの beforeSave(既定の 100)が値を変えたあとの、実際に保存される値を確かめるため。単体テストで、既定の priority で `cover` を `imageRefs` に無い画像に書き換えるプラグインを、base64-image の**あと**に登録した。priority 200 なら書き換えたあとの値を拒否し、既定の 100 にすると、登録の早い base64-image が先に動いて、書き換えた値が保存された(テストが失敗した)。priority が 200 より大きいほかのプラグインの書き換えは確かめられない。根拠: 実測のみ(本物の `HookPipeline`)

## 管理画面の登録(admin)

| 宣言 | 使われ方 | 根拠 |
|---|---|---|
| `admin.entry` | マニフェストの `adminMode` を `"react"` にする(`core/src/emdash-runtime.ts:2917-2928`)。管理画面のバンドルに入れるのは descriptor の `adminEntry`([[emdash-native-plugin-entrypoints]]) | 実測+公式ドキュメント(マニフェストで `"react"`) |
| `admin.fieldWidgets` | マニフェストの `fieldWidgets` にそのまま載る。編集画面は、フィールドの `widget`(`<プラグイン ID>:<名前>`)を分け、管理画面の入口の `fields[<名前>]` が関数ならそれを描く(`admin/src/components/ContentEditor.tsx:1806-1844`)。マニフェストの `fieldWidgets` を見るのは、Block Kit の `elements` を持つ widget(sandboxed)のときだけ(`:1845-1862`)。どちらも無ければ標準の入力に落ちる(`:1863`) | 実測+公式ドキュメント |
| `admin.pages` | マニフェストの `adminPages`。サイドバーは、`adminMode` が `"blocks"` でなければ、管理画面の入口の `pages` にそのパスの部品があるものだけを出す(`admin/src/components/Sidebar.tsx:488-505`)。コマンドパレットは部品を確かめずに出す(`admin/src/components/AdminCommandPalette.tsx:251-270`)。部品の無いページを開くと Block Kit の描画に落ち(`admin/src/router.tsx:2733-2747`)、`POST /_emdash/api/plugins/<ID>/admin` を送る(`admin/src/components/SandboxedPluginPage.tsx:45-56`)。そのルートが無いので 404「Plugin route not found」(`core/src/plugins/http-route-dispatch.ts:104-105`) | 実測+公式ドキュメント |

- base64-image の widget の宣言は `{ name: "image" | "gallery", label: "Base64 image" | "Base64 image gallery", fieldTypes: ["json"] }`。名前は `WIDGET_KINDS`(フィールドの `widget` の `base64-image:image` / `base64-image:gallery` の後ろの部分)。`label` は表示に使われないので英語にした。
- `admin.pages` は `[IMAGES_PAGE]`(`src/shared/constants.ts`。ラベルは Lingui の ID `an5hVd`。[[emdash-admin-plugin-pages]])。

### T30 の前の管理画面(playground、実測)

T29 の登録だけ(管理画面の入口は `export const fields = {}` の仮実装)で、Chromium 153 で確かめた。根拠: 実測のみ

| 確かめたこと | 日本語 | 英語 |
|---|---|---|
| サイドバーのプラグインのページの項目 | 出ない | 出ない |
| コマンドパレット(「画像」「Images」と入力) | 「画像」 | 「Base64 Images」「Media Library」「Images」 |
| ページ `/_emdash/admin/plugins/base64-image/images` を開く(日本語はパレットの「画像」を選んで移った。英語は URL を直接開いた) | 「プラグインエラー」「プラグインから404が返されました：…Plugin route not found」 | 「Plugin Error」「Plugin responded with 404: …」 |
| パレットの「Base64 Images」を選ぶ | — | `/_emdash/admin/content/b64_images`(非表示のコレクションの標準の一覧)に移った |
| 投稿の編集画面の Cover / Gallery | textarea(JSON の標準の入力) | 同じ |
| console | 404 の読み込みエラーだけ | 同じ |

- サイドバーの項目は、T30 が管理画面の入口で `pages` を export すると出る([[emdash-admin-plugin-pages]] の使い捨てのサイトで、両方を登録したときに出た)。
- パレットの「Base64 Images」を選ぶと、非表示の `b64_images` の標準の一覧に移る。一覧の重さ(1 ページ 100 件の base64)は測っていない([[T25-images-page#影響・サブタスクの候補|T25]] の推測のうち、移る先だけを確かめた)。

## 登録を確かめるテスト

`tests/server/plugin.test.ts`(36 件)。部品の中身は各タスクのテストにあるので、ここでは「EmDash が登録をどう扱うか」を本物の EmDash で確かめる。根拠: 実測のみ

- **hook の登録**: `createHookPipeline([createPlugin()]).getRegisteredHooks()` が 5 つの hook を返し、`console.warn` が呼ばれないこと。capability を外すと、その hook が並びから消える。
- **hook の実行**: 本物の `HookPipeline` の private の `getContext` だけを差し替え、偽のサイトの ctx を渡す。`runContentBeforeSave` / `runContentAfterSave` / `runContentAfterPublish` / `runContentAfterDelete` / `runPluginActivate` を実行し、拒否が伝わること、priority の順、記録の変化を確かめる。
- **ctx の中身**: 本物の `PluginContextFactory` で ctx を作り、使うアクセサーがすべて関数であることを確かめる。データベースは、使われたら例外を投げる Proxy にする(ctx を作るときには読まれない)。
- **読み込むファイル**: `ts.preProcessFile` で `src/index.ts` から相対 import(`import type` と `export … from` を含む)を辿り、`src/server/` と `src/shared/` だけで、外部のパッケージは `emdash` と `zod` だけであること。利用者のサイトの `tsc` は型だけの import も辿るので、型だけの import も数える。
- **型**: `expectTypeOf` で、`createPlugin()` が `ResolvedPlugin` であること、振り分けと確認の関数に EmDash の `ContentHookEvent` / `PluginContext` をそのまま渡せること。

```ts
/** 本物の HookPipeline に登録し、hook に渡す ctx だけを偽のサイトのものにする */
function pipelineWith(site: FakeSite, plugins: ResolvedPlugin[]): HookPipeline {
	const pipeline = createHookPipeline(plugins);
	(pipeline as unknown as { getContext(pluginId: string): unknown }).getContext = () => site.context();
	return pipeline;
}

/** 本物の PluginContextFactory で ctx を作る。データベースは使われたら DB_REACHED を投げる */
function emdashContext(plugin: ResolvedPlugin): PluginContext {
	const unusable = () => {
		throw new Error("DB_REACHED");
	};
	// `then` を undefined にしないと、await されたときに thenable とみなされる
	const db = new Proxy({}, { get: (_target, property) => (property === "then" ? undefined : unusable) });
	const contentActions = new Proxy({}, { get: () => unusable }) as ContentActionCallbacks;
	const pipeline = createHookPipeline([plugin], { db: db as never, contentActions });
	return (pipeline as unknown as { getContext(pluginId: string): PluginContext }).getContext(plugin.id);
}
```

> [!warning] private の API に触れている
> `HookPipeline` の `getContext` は private。EmDash を上げたら、まずこのテストが通るかを確かめる。`content:publish` / `content:restore` のアクセサーは `contentActions` があるときだけ入る(`context.ts:1670`、`:1687`)ので、偽物でも渡す。

- 実装を 1 か所ずつ壊した 40 通り(capability・ストレージ・ルート・hook の設定・振り分け・確認・widget・ページ・入口)のうち、39 通りでテストが失敗した。残る 1 つは `content:read` の宣言を外したもので、EmDash が補うので動きが変わらない([[T29-plugin-definition#ミューテーションテスト|T29]])。

## playground で確かめたこと

playground を 4429 で起動し、`node playground/scripts/create-sample-posts.ts --base http://localhost:4429` で投稿 3 件と画像 12 枚を作った。画像はすべて公開済み(live の版あり)、`imageRefs` の記録は 12 件で、それぞれ参照元が 1 件。`/posts/` にカバー画像が出て、詳細ページには画像が 4 枚(カバー 1、ギャラリー 3)出た。根拠: 実測のみ

続けて REST で確かめた(dev-bypass の cookie、`X-EmDash-Request: 1`)。根拠: 実測のみ

| 手順 | 結果 | クエリ |
|---|---|---|
| マニフェスト | 200。`adminMode: "react"`、`adminPages` は `IMAGES_PAGE`、`fieldWidgets` は `image` / `gallery`(`json`)。`collections` に `b64_images` がある | 7 |
| 投稿の作成(参照なし) | 201 | 34 |
| アップロード(`target.entryId` あり) | 200。参照 `{ v: 1, id, locale: "en", width: 300, height: 199, alt: "" }` | 75 |
| 投稿の更新(`cover` に参照) | 200。`imageRefs` の参照元に `{ collection: "posts", entryId, locale: "en", field: "cover" }` | 58 |
| 無い画像を参照する投稿(T16) | 422 `SAVE_REJECTED`「画像フィールド「Cover」(cover): 画像が見つかりません(ID: missingimage01)。」 | 6 |
| 不正な値の `b64_images` の作成(T19) | 422 `SAVE_REJECTED`「画像エントリ(b64_images.image): 値の形が正しくありません(キー: meta)。」 | 3 |
| `b64_images` の更新で `image` を送る(T19) | 422 `SAVE_REJECTED`「…作成したあとは変更できません。…」 | 11 |
| `preview`(T17) | 200。本体(300×199)と、無い ID の `null` | 4 |
| `thumbnails`(T17) | 200。サムネイルと、無い ID の `null` | 2 |
| `images/list`(T21) | 200。10 件と `nextCursor`。上げた画像は公開済み・使用中・参照元 1 件 | 37 |
| `images/trash`(T21) | 200。ゴミ箱に移り、`imageRefs` の記録は残る | 9 |
| もう一度 `images/list` | 200。上げた画像は `trashed`・使用中 | 40 |
| 完全削除(`DELETE /_emdash/api/content/b64_images/{id}/permanent`) | 200。afterDelete(T21)が `imageRefs` の記録を消した | 36 |
| もう一度 `thumbnails` | 200。`null` | 2 |
| 消した画像を参照したままの投稿を保存(T16) | 422 `SAVE_REJECTED` | 19 |

- 確かめていないこと: widget と画像管理ページの描画([[T30-admin-entry|T30]])、Cloudflare Workers と D1([[T32-cloudflare-check|T32]])、i18n を設定したサイト、wrangler。

## 再現手順

```sh
npm run dev -w playground -- --port 4429
node playground/scripts/create-sample-posts.ts --base http://localhost:4429
curl -s -c cookies.txt -o /dev/null "http://localhost:4429/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin"
# プラグインのルート(例: サムネイル)。応答の Server-Timing の db.count がクエリ数
curl -s -D - -b cookies.txt -H 'X-EmDash-Request: 1' -H 'Content-Type: application/json' \
  -X POST http://localhost:4429/_emdash/api/plugins/base64-image/thumbnails --data '{"ids":["<画像 ID>"]}'
npm run dev -w playground -- stop
lsof -nP -iTCP:4429 -sTCP:LISTEN   # 何も出ないこと
```

- `imageRefs` の記録は、SQLite の `_plugin_storage`(`plugin_id = 'base64-image' and collection = 'imageRefs'`)を `node:sqlite` の読み取り専用で読んで確かめた。afterSave / afterDelete は応答のあとに動くので、100ms ごとに 5 秒まで読み直した。
