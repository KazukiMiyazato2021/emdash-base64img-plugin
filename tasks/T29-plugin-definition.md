---
id: T29
title: "プラグイン定義(src/index.ts)を組み立てる"
type: 実装
status: done
wave: 4
depends_on:
  - "[[T07-spike-git-dependency]]"
  - "[[T16-reference-hook]]"
  - "[[T17-admin-data-routes]]"
  - "[[T18-upload-route]]"
  - "[[T19-image-entry-hook]]"
  - "[[T20-owner-tracking]]"
  - "[[T21-orphan-routes]]"
soft_depends_on: []
blocks:
  - "[[T31-e2e]]"
  - "[[T32-cloudflare-check]]"
  - "[[T33-readme]]"
files:
  - "src/index.ts"
  - "src/server/plugin.ts"
spec:
  - "[[base64-image-plugin-spec#4. アーキテクチャ]]"
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
  - "[[base64-image-plugin-spec#13. 設定]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T29 プラグイン定義(src/index.ts)を組み立てる

> [!info] 概要
> - 種別: 実装 / ウェーブ: 4
> - 着手の条件(依存): [[T07-spike-git-dependency|T07]]、[[T16-reference-hook|T16]]、[[T17-admin-data-routes|T17]]、[[T18-upload-route|T18]]、[[T19-image-entry-hook|T19]]、[[T20-owner-tracking|T20]]、[[T21-orphan-routes|T21]]
> - このタスクを待つもの: [[T31-e2e|T31]]、[[T32-cloudflare-check|T32]]、[[T33-readme|T33]]
> - 仕様: [[base64-image-plugin-spec#4. アーキテクチャ|仕様書 4章]]、[[base64-image-plugin-spec#7. アップロード(書き込み経路)|仕様書 7章]]、[[base64-image-plugin-spec#13. 設定|仕様書 13章]]

## 目的

サーバー側の各部品を `definePlugin` にまとめる。

## 作業内容

- [x] capability: `schema:read` / `content:read` / `content:write` / `content:publish` / `content:revisions:read` / `content:restore`(`content:restore` は画像管理の一覧が `getTrashedVersioned` に使う。[[T21-orphan-routes#T29 への引き継ぎ|T21]])
- [x] ストレージ `imageRefs`(インデックス `createdAt`)
- [x] ルート(アップロード・プレビュー・サムネイル・画像管理)と hook(beforeSave ×2、afterSave、afterDelete)を登録する(beforeSave は 1 つの handler で振り分ける。afterPublish も T20 の設定どおり登録した)
- [x] `admin`(`entry`、`fieldWidgets`、`pages`)
- [x] 起動時に `b64_images` があるかを確認し、なければエラーを出す(0.39.1 には起動時に呼ばれる hook が無いので、`plugin:activate` と最初の保存で確かめ、エラーのログを出す。[[#決めたこと]])
- [x] descriptor 関数 `base64ImagePlugin()`
- [x] [[T07-spike-git-dependency|T07]] の結果に合わせた配布形態(TS ソースのまま。T07 で、Node と Cloudflare の両アダプターで読み込めることを確かめた。ビルドは入れない)
- [x] ルートは、各タスク([[T17-admin-data-routes|T17]]・[[T18-upload-route|T18]]・[[T21-orphan-routes|T21]])が export する `PluginRoute<Input>` の定義を、`routes: { [ROUTES.x]: xRoute }` の形で登録する。`definePluginRoute` は json の入力の型が `unknown` になるので使わない。`input` を書き忘れても型エラーにならないので、各ルートの単体テストで確かめる([[T08-spike-route-body#T18 で使うルートの宣言|T08]])
- [x] `content:beforeSave` は 1 つのプラグインに 1 つだけ。[[T19-image-entry-hook|T19]](`b64_images`)と [[T16-reference-hook|T16]](それ以外、`validateReferencesBeforeSave`)を 1 つの handler で振り分ける。登録には capability `content:write` が要る(無いと警告だけ出して黙って飛ばす)。**beforeSave に `errorPolicy: "continue"` を付けない**(拒否の例外が捨てられ、保存が通る。afterSave の T20 と混同しない)。雛形は [[T16-reference-hook#T29 への引き継ぎ(登録のしかた)|T16]]
- [x] T20 の hook は、`imageOwnerHooks`(`src/server/hooks/owners.ts`。afterSave と afterPublish、`priority: 50`、`errorPolicy: "continue"`)をそのまま `hooks` に入れる。`errorPolicy` と `priority` を上書きしない。handler を包むときも例外を投げない。after* の hook の登録には capability `content:read` が要る(無いと警告だけで登録されない)。`schema:read` とストレージ `imageRefs` の宣言が無いと、エラーのログが出て記録されない([[T20-owner-tracking#T29 への引き継ぎ(登録のしかた)|T20]])
- [x] T17 のルート(`src/server/routes/admin-data.ts`)は `routes: { [ROUTES.preview]: previewRoute, [ROUTES.thumbnails]: thumbnailsRoute }` で登録する。capability `content:read` と、ストレージ `imageRefs` の宣言が無いと 500 になる。`content:restore` は要らない([[T17-admin-data-routes#結果|T17]])
- [x] widget の `fieldTypes` は `["json"]` にする。T11 の検証は、このプラグインの widget を使う `json` フィールドだけを保存先として受け付ける([[T11-server-validation#結果|T11]])
- [x] `src/index.ts` 以下は、利用者のサイトの `tsc` でも検査される(`astro.config.mjs` から辿られる)。`npm run typecheck` の 3 つの設定を通す([[T04-1-consumer-typecheck|T04-1]]、[[T07-1-spec-distribution|T07-1]])
- [x] アップロードのルートは `uploadRoute`(`src/server/routes/upload.ts`)を `routes: { [ROUTES.upload]: uploadRoute }` で登録する。使う capability は `schema:read` / `content:write` / `content:publish`(`content:read` は補われる)、ストレージは `imageRefs`。ハンドラーは、EmDash の i18n の設定(`getI18nConfig()`)をリクエストのたびに読む([[T18-upload-route#T29 がルートを登録する方法|T18]])
- [x] 完了の確認に、playground のサンプルの投稿を作るスクリプトを使える。開発サーバーを起動して `node playground/scripts/create-sample-posts.ts --base http://localhost:<ポート>` を実行すると、アップロードのルート・保存 hook(T16・T19)・参照元の記録(T20)をまとめて動かせる。そのあと `/posts/` で表示を確かめる。ルートが無いとスクリプトは 404 で止まる。T26 は、同じ登録を一時的に入れた使い捨てのサイトで確かめた([[playground-site-pages#再現手順]]、[[T26-playground-pages#他のタスクへの影響|T26]])
- [x] 画像管理のルートと hook(`src/server/routes/images-admin.ts`・`src/server/hooks/image-deleted.ts`)は `routes: { [ROUTES.imagesList]: imagesListRoute, [ROUTES.imagesTrash]: imagesTrashRoute }` と `hooks: { ...imageOwnerHooks, ...imageDeletedHooks }` で登録する。`imageDeletedHooks`(afterDelete。`priority: 50`・`errorPolicy: "continue"`)は上書きしない。使う capability は `schema:read`(消されたコレクションの確認)・`content:read`(`get`。afterDelete の登録にも要る)・`content:write`(ゴミ箱への移動)・`content:revisions:read`(`getRevision`)・`content:restore`(`getTrashedVersioned`。`content:read` は含まない)。宣言が足りないと、ルートは capability の名前を書いた `Error`(500)を投げ、`content:read` が無いと afterDelete は登録されない(警告だけ)([[T21-orphan-routes#T29 への引き継ぎ|T21]])
- [x] 画像管理ページのラベル(`admin.pages` の `label`)は、管理画面が `i18n._(label)` で訳すとみられる。辞書のキーは Lingui の ID なので、文字列のラベルは訳されず、本番のビルドでは描画のたびに Lingui の警告が出るとみられる(列の見出しでの実測からの推測。[[emdash-admin-content-list-columns]])。ラベルに何を使うかは [[T25-images-page|T25]] の結果に従う
- [x] 画像管理ページは `admin: { entry, pages: [IMAGES_PAGE] }` で登録する(`src/shared/constants.ts` の `IMAGES_PAGE`。パス `/images`、ラベルは管理画面の辞書の「Images」の ID `an5hVd`、アイコン `image`)。値を書き写さず、`label` を文字列にしない。`src/shared/constants.ts` は依存の無い定数だけなので、サーバーの入口から読み込んでよい(`src/admin/ImagesPage.tsx` は読み込まない。React と Kumo が入る)([[T25-2-page-registration-prep#T29・T30 での使い方|T25-2]]、[[emdash-admin-plugin-pages]])

## 完了条件

- [x] playground で起動し、各ルートと hook が動くことを手動で確認した(サンプルの投稿を作るスクリプトと REST で確かめた。widget と画像管理ページの描画は T30 のあと。[[#playground で確かめたこと]])

## 変更してよいファイル

- `src/index.ts`
- `src/server/plugin.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] まとめ
> - `src/server/plugin.ts`(新規)の `createBase64ImagePlugin()` に、各タスクの部品を export されたまま登録した: capability 6 つ、ストレージ `imageRefs`(索引 `createdAt`)、ルート 5 つ、hook 5 つ(`plugin:activate`・`content:beforeSave`・`content:afterSave`・`content:afterPublish`・`content:afterDelete`)、`admin`(`entry`・`fieldWidgets`・`pages: [IMAGES_PAGE]`)。`src/index.ts` は `createPlugin()`(名前付きと default)と descriptor の `base64ImagePlugin()` だけにした。
> - `content:beforeSave` は 1 つの handler(`validateBeforeSave`)で `b64_images`(T19)とほかのコレクション(T16)に振り分ける。priority 200、`errorPolicy` は既定の `abort`。
> - 「起動時に `b64_images` を確かめる」は、0.39.1 に起動時に呼ばれる hook が無いので、`plugin:activate` と、インスタンスごとの最初の `b64_images` 以外の保存で確かめ、無ければエラーのログを出す(例外は投げない)。
> - playground で、サンプルの投稿を作るスクリプト(投稿 3 件・画像 12 枚)と REST で、アップロード・保存 hook(T16・T19)・参照元の記録(T20)・プレビューとサムネイル(T17)・画像管理(T21)・完全削除の hook を確かめた。
> - テスト: `tests/server/plugin.test.ts` 36 件。実装を 40 か所壊し、39 か所でテストが失敗した(残る 1 か所は EmDash が補う capability)。
> - 知見ノート: [[emdash-native-plugin-lifecycle-hooks]]、[[emdash-plugin-definition-registration]]。

### 主な export(`src/server/plugin.ts`)

| export | 中身 |
|---|---|
| `createBase64ImagePlugin()` | `definePlugin` の結果(`ResolvedPlugin`)。`src/index.ts` の `createPlugin()` が呼ぶ |
| `validateBeforeSave(event, ctx)` | beforeSave の振り分け。EmDash の `ContentHookEvent` / `PluginContext` をそのまま渡せる |
| `checkImageCollection(ctx, trigger)` / `createImageCollectionCheck()` | `b64_images` の確認と、それを 1 回だけにする関数。結果は `exists` / `missing` / `unknown`(1 回だけの関数は 2 回目から `skipped`) |
| `PLUGIN_CAPABILITIES`、`BEFORE_SAVE_HOOK_PRIORITY`(200) | capability と beforeSave の priority |
| `PLUGIN_VERSION`、`PACKAGE_NAME`、`ADMIN_ENTRY` | descriptor と `definePlugin` で同じ値を使う(`src/index.ts` から移した) |

### 登録の中身

| 項目 | 登録したもの | 部品(タスク) |
|---|---|---|
| capability | `schema:read`・`content:read`・`content:write`・`content:publish`・`content:revisions:read`・`content:restore` | T16〜T21 の引き継ぎのとおり |
| ストレージ | `imageRefs`(`indexes: ["createdAt"]`) | T20・T21 |
| ルート | `upload`(T18)、`preview`・`thumbnails`(T17)、`images/list`・`images/trash`(T21)。キーは `ROUTES`、値は各タスクの `PluginRoute` の定義そのもの | T17・T18・T21 |
| `plugin:activate` | `b64_images` の確認 | このタスク |
| `content:beforeSave` | priority 200、`errorPolicy` なし(既定の `abort`)。`b64_images` 以外の最初の保存で確認し、そのあと振り分ける | T16・T19 |
| `content:afterSave` / `afterPublish` | `...imageOwnerHooks`(priority 50、`continue`) | T20 |
| `content:afterDelete` | `...imageDeletedHooks`(priority 50、`continue`) | T21 |
| `admin.entry` | `emdash-plugin-base64-image/admin`(マニフェストの `adminMode: "react"`) | [[T01-scaffold\|T01]] |
| `admin.fieldWidgets` | `image`「Base64 image」・`gallery`「Base64 image gallery」。どちらも `fieldTypes: ["json"]` | T11(`getFieldWidgetKind`) |
| `admin.pages` | `[IMAGES_PAGE]`(同じオブジェクト) | T25・T25-2 |

### 決めたこと

| 項目 | 決めたこと | 根拠 |
|---|---|---|
| `b64_images` の確認の時期 | `plugin:activate`(毎回)と、`createPlugin()` ごとの最初の `b64_images` 以外の beforeSave(1 回だけ。同時の保存でも 1 回)。0.39.1 では、config で登録した native プラグインの起動時に `plugin:install` / `plugin:activate` が呼ばれない(起動・最初のリクエスト・dev-bypass・再起動で呼ばれず、管理画面での有効化でだけ `plugin:activate` が呼ばれた) | 実測+公式ドキュメント([[emdash-native-plugin-lifecycle-hooks]]。`core/src/emdash-runtime.ts:1441-2169`、`:1004-1016`、`core/src/plugins/lifecycle.ts:18-47`) |
| 無いときの動き | 作り方(seed、`hidden: true`・`routable: false`・`supports: []`・json の `image`)を書いたエラーのログだけ。例外は投げない(beforeSave で投げるとすべての保存が止まり、`plugin:activate` の例外は捨てられる)。読み出しの失敗は警告。`ctx.schema` が無ければ `schema:read` の宣言を促すエラー。やり直さない | 実測+公式ドキュメント(`core/src/plugins/hooks.ts:498-531`、`:583-594`) |
| `b64_images` への保存では確かめない | beforeSave はコレクションの検証より前に呼ばれ、無ければ EmDash が `COLLECTION_NOT_FOUND` で止める(アップロードは `IMAGE_COLLECTION_MISSING`)。`b64_images` の beforeSave の「クエリはしない」(仕様書 8 章②)を保つ | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:3339`、`:3369-3370`) |
| 確認のクエリ | `ctx.schema.getCollection("b64_images")`。最初の 1 回だけ、あれば +2、無ければ +1(投稿の作成: playground で 36 → 34 → 34、`b64_images` の無いサイトで 35 → 34 → 34) | 実測+公式ドキュメント(`core/src/schema/registry.ts:314-321`) |
| beforeSave の priority | 200(既定 100 のほかのプラグインのあと)。EmDash は前の hook が返した値を次に渡すので、実際に保存される値を確かめる。同じ priority なら登録順で、base64-image が先に動いてしまう | 実測+公式ドキュメント(単体テストの「ほかのプラグインの beforeSave」。`core/src/plugins/hooks.ts:388-420`、`:543-598`) |
| beforeSave の `errorPolicy` | 書かない(既定の `abort`)。`continue` にすると拒否が捨てられて保存が通る(ミューテーション B1 で 3 件失敗) | 実測+公式ドキュメント(`core/src/plugins/hooks.ts:591-593`) |
| `content:read` | 宣言する。`content:write` などから補われるので動きは変わらない(ミューテーション C2 で失敗なし)が、after* の hook の登録と T17・T21 の `get` に要ることを書き残す | 実測+公式ドキュメント(`core/src/plugins/types.ts:84-107`) |
| widget の宣言 | 名前は `WIDGET_KINDS`、`fieldTypes: ["json"]`、`label` は英語。0.39.1 の管理画面は native の widget を管理画面の入口の `fields` から探し、`admin.fieldWidgets` はマニフェストに載せるだけ(表示に使わない) | 実測+公式ドキュメント(`admin/src/components/ContentEditor.tsx:1806-1863`。T30 の前は Cover / Gallery が textarea) |
| 定義の置き場所 | `src/server/plugin.ts`(タスクノートの `files` のとおり)。`src/index.ts` は入口だけ。`PLUGIN_VERSION` などの定数も移し、descriptor と定義で同じ値を使う | 推測のみ(設計の判断) |
| サーバーの入口が読み込むもの | `src/server/` と `src/shared/` だけ。外部は `emdash` と `zod`。管理画面の部品(React・Kumo)と `src/client/` は、型だけの import でも読み込まない | 実測のみ(単体テスト。`ts.preProcessFile` で辿る) |

### 実測(スパイク)

`b64_images` の無い使い捨てのサイト(`spikes/t29-plugin/site/`、git 管理外)に、lifecycle hook でログを出すだけのプラグインと並べて登録した(ポート 4429)。手順・環境・結果の表は [[emdash-native-plugin-lifecycle-hooks#実測(使い捨てのサイト、b64_images なし)]]。根拠: 実測のみ

- 起動・ページの表示・dev-bypass・再起動で、lifecycle hook は 1 回も呼ばれなかった。無効化で `plugin:deactivate`、有効化で `plugin:activate` が呼ばれた。`plugin:install` は一度も呼ばれなかった。
- 最初の投稿の作成で 1 回だけエラーのログ(`trigger: 'content:beforeSave'`)が出た。base64-image を無効にして有効に戻すと、もう一度出た(`trigger: 'plugin:activate'`)。
- アップロードは 500 `IMAGE_COLLECTION_MISSING`(7 クエリ)。

### playground で確かめたこと

playground を 4429 で起動し、`node playground/scripts/create-sample-posts.ts --base http://localhost:4429` で投稿 3 件・画像 12 枚を作った(画像はすべて公開済み、`imageRefs` の記録は 12 件で参照元が 1 件ずつ、`/posts/` と詳細ページに画像が出た)。続けて REST で、アップロード → 参照の保存 → 参照元の記録、T16・T19 の拒否(422)、`preview`・`thumbnails`、`images/list`・`images/trash`、標準 API での完全削除 → afterDelete で記録が消える → 消した画像を参照する保存が 422、を確かめた。結果の表(状態とクエリ数)は [[emdash-plugin-definition-registration#playground で確かめたこと]]。根拠: 実測のみ

管理画面(Chromium 153、日本語と英語)。根拠: 実測のみ

- **サイドバーにプラグインのページの項目は出なかった。** サイドバーは、管理画面の入口の `pages` に部品があるときだけ項目を出す(`admin/src/components/Sidebar.tsx:488-505`)。管理画面の入口はまだ仮実装(`export const fields = {}`)なので、T30 が `pages` を export すると出る。
- コマンドパレットには「画像」(英語では「Images」)が出る。日本語で「画像」を選ぶと `/_emdash/admin/plugins/base64-image/images` に移り、「プラグインエラー」「プラグインから404が返されました」になった(Block Kit の描画に落ち、`/_emdash/api/plugins/base64-image/admin` が 404。英語では URL を直接開いて「Plugin Error」を確かめた)。T30 のあとで解消するはず。
- 投稿の編集画面の Cover / Gallery は textarea(JSON の標準の入力)。T30 が `fields` を export すると widget になる。

確かめていないこと:

- widget と画像管理ページの描画、ブラウザでのアップロード(T30 のあと。[[T31-e2e|T31]])
- Cloudflare Workers と D1([[T32-cloudflare-check|T32]])。wrangler は使っていない(ポート 8729 / 9329 は使わなかった)
- i18n を設定したサイト
- マーケットプレイス・レジストリからのインストールでの `plugin:install` / `plugin:activate`(config で登録するこのプラグインには関係しない)

サーバーは確かめたあと止め、`lsof -nP -iTCP:4429 -sTCP:LISTEN` で何も出ないことを確かめた。

### テスト

`tests/server/plugin.test.ts`(36 件)。部品の中身は各タスクのテストにあるので、EmDash が登録をどう扱うかを、本物の `createHookPipeline` と `PluginContextFactory`(データベースは偽物)で確かめる。方法は [[emdash-plugin-definition-registration#登録を確かめるテスト]]。`tests/package-exports.test.ts`(4 件)は変えずに通る。

- 登録の中身(11 件): descriptor と同じ id・version・入口、5 つの hook がすべて登録される(警告なし)、ctx に使うアクセサーがすべてある、`imageRefs` の `createdAt` での一覧をストレージが受け付ける、ルート 5 つが export の定義そのもの、beforeSave の priority と `errorPolicy`、after* の設定が export のまま、widget の名前と `fieldTypes`、`IMAGES_PAGE` がそのまま、`createPlugin()` ごとに確認の状態が別
- 振り分け(6 件): `b64_images` の作成・更新の拒否と正しい作成(T19)、ほかのコレクションでの無い画像の拒否・値の形を T19 に回さない・正しい参照(T16)
- HookPipeline での実行(6 件): 拒否が保存を止める、priority の順、afterSave・afterPublish の記録、afterDelete の完全削除とゴミ箱、`plugin:activate` のログ(無い・ある)
- 最初の保存での確認(5 件)、`checkImageCollection` / `createImageCollectionCheck`(5 件)
- サーバーの入口が読み込むもの(1 件)、型(2 件。`expectTypeOf`)

### ミューテーションテスト

実装(`src/server/plugin.ts`・`src/index.ts`)を 1 か所ずつ壊し、`tests/server/plugin.test.ts` と `tests/package-exports.test.ts`(合わせて 40 件)を実行した。使い捨てのスクリプトで、壊したファイルは毎回元に戻し、最後に元のファイルとハッシュが一致することを確かめた。根拠: 実測のみ

| ID | 壊したところ | 失敗したテストの数 |
|---|---|---|
| C1〜C6 | capability を 1 つずつ外す(`schema:read`・`content:read`・`content:write`・`content:publish`・`content:revisions:read`・`content:restore`) | 1・**0**・4・1・1・1 |
| S1 / S2 | ストレージの宣言を外す / 索引を `createdBy` にする | 2 / 1 |
| R1 / R2 / R3 | アップロードのルートを外す / `preview` と `thumbnails` を入れ替える / ゴミ箱のルートを外す | 1 / 1 / 1 |
| B1 / B2 | beforeSave に `errorPolicy: "continue"` を付ける / priority を既定(100)にする | 3 / 2 |
| D1 / D2 / D3 | 振り分けを逆にする / すべて T16 に渡す / すべて T19 に渡す | 6 / 3 / 4 |
| H1 / H2 | afterSave・afterPublish を外す / afterSave の `errorPolicy` を `abort` で上書きする | 3 / 1 |
| H3 / H4 | afterDelete を外す / afterDelete の priority を 100 で上書きする | 3 / 1 |
| H5 | `plugin:activate` を外す | 3 |
| K1 / K2 / K3 | 最初の保存での確認を外す / 保存のたびに確かめる / `b64_images` への保存でも確かめる | 6 / 2 / 1 |
| K4 / K5 | 無いときに例外を投げる / 読み出しの失敗を投げ直す | 4 / 3 |
| K6 / K7 | 確かめ終わってから済みにする(同時の保存で 2 回読む) / `unknown` なら次の保存でやり直す | 1 / 1 |
| K8 / K9 | 確認の状態をモジュールで 1 つだけ持つ / `null` を「ある」とみなす | 6 / 2 |
| W1 / W2 | `fieldTypes` に `string` を足す / widget の名前を変える | 1 / 2 |
| P1 / P2 / P3 | `IMAGES_PAGE` を書き写す / ラベルを文字列にする / ページを外す | 1 / 1 / 1 |
| A1 | `admin.entry` を外す | 2 |
| I1 / I2 | サーバーの入口から、管理画面の部品 / `src/client` を型だけ読み込む | 1 / 1 |
| I3 / I4 | descriptor の `adminEntry` を誤る / version を定義と違う値にする | 3 / 2 |

- 40 か所のうち 39 か所で失敗した。C2(`content:read` を外す)は、EmDash が `content:write` などから補うので動きが変わらない(想定どおり)。
- P1(書き写す)は値が同じなので動きは変わらないが、[[T25-2-page-registration-prep|T25-2]] の「値を書き写さない」を守るため、同じオブジェクトであることを確かめている。

### 仕様書の変更

- 4.1: 「プラグインの定義」を足した(`src/server/plugin.ts` に置くこと、beforeSave の振り分け・priority 200・`errorPolicy`)。
- 7 章: capability に `content:restore` を足し、宣言が足りないときの動きを書いた。
- 13.1: 「起動時に確認」を、`plugin:activate` と最初の保存で確かめてエラーのログを出す、に変えた。
- ほかの章は変えていない。

### 他のタスクへの影響・サブタスクの候補

- [[T30-admin-entry|T30]]: サイドバーの項目は、管理画面の入口で `pages`(`{ [IMAGES_PAGE.path]: ImagesPage }`)を export して初めて出る(リーダーの見込みの「サイドバーの項目は出るはず」とは違った)。それまで、コマンドパレットの項目は 404 のエラーのページを開く。widget は `fields` の `image` / `gallery`(`WIDGET_KINDS` の名前)で描かれる。
- T30 への提案: マニフェストの `collections` には非表示の `b64_images` も入る(playground で確かめた)。無いときに、widget や画像管理ページが「`b64_images` がありません」と知らせられる(いまはアップロードして初めて `IMAGE_COLLECTION_MISSING` になる)。
- [[T32-cloudflare-check|T32]]: 確認のクエリ(あれば +2)は、isolate ごとの最初の保存で増える。Workers では isolate が作り直されるたびに起きる。`plugin:activate` が起動時に呼ばれないことは Node でだけ確かめた(Workers でも同じ `EmDashRuntime.create()` を通るとみられる。推測のみ)。
- [[T33-readme|T33]]: README に、`b64_images` を seed に入れること、無いと最初の保存と有効化のときにサーバーのログにエラーが出て、アップロードが `IMAGE_COLLECTION_MISSING` になることを書く。コマンドパレットの「Base64 Images」を選ぶと、標準の `b64_images` の一覧(`/_emdash/admin/content/b64_images`)に移ることを実測した([[T25-images-page#影響・サブタスクの候補|T25]] の推測のうち、移る先だけ。重さは測っていない)。
- 仕様書 15 章の構成図は、`src/index.ts` に `definePlugin` があるとしている。定義は `src/server/plugin.ts` に置いた(15 章は変更の範囲外なので変えていない。4.1 に書いた)。
- EmDash の公式ドキュメントは、`plugin:install` を「サイトに最初に追加したとき」、`plugin:activate` を「インストールのあとと、有効に戻したとき」に呼ぶと書いているが、config で登録した native プラグインでは起動時に呼ばれない(0.39.1)。公式の forms プラグインの `plugin:activate` での cron の登録も、config で登録すると行われないとみられる(推測のみ)。
- priority が 200 より大きいほかのプラグインの beforeSave が値を変えると、その値は確かめられない(ほぼ無いとみて、対策はしていない)。
- テストは `HookPipeline` の private の `getContext` を差し替えている。EmDash を上げたら、まずこのテストが通るかを確かめる。

### 未解決

- 部品(`src/server/**`・`src/shared/**`・`src/admin/**`)に直すべきところは見つからなかった。変更していない。

> [!note] 反映済み(リーダー、マージのとき)
> 知見ノート 2 つを索引に登録した。仕様書 15 章の構成の図を、`src/server/plugin.ts` と今のディレクトリに合わせて直した。「他のタスクへの影響」は後続タスクのノートに書いた([[T29-1-handoff-plugin-definition|T29-1]])。EmDash の公式ドキュメントと動きが違う件(lifecycle hook)の報告は、利用者の判断が要るので、今は行わない。
