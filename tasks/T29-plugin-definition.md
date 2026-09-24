---
id: T29
title: "プラグイン定義(src/index.ts)を組み立てる"
type: 実装
status: todo
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

- [ ] capability: `schema:read` / `content:read` / `content:write` / `content:publish` / `content:revisions:read` / `content:restore`(`content:restore` は画像管理の一覧が `getTrashedVersioned` に使う。[[T21-orphan-routes#T29 への引き継ぎ|T21]])
- [ ] ストレージ `imageRefs`(インデックス `createdAt`)
- [ ] ルート(アップロード・プレビュー・サムネイル・画像管理)と hook(beforeSave ×2、afterSave、afterDelete)を登録する
- [ ] `admin`(`entry`、`fieldWidgets`、`pages`)
- [ ] 起動時に `b64_images` があるかを確認し、なければエラーを出す
- [ ] descriptor 関数 `base64ImagePlugin()`
- [ ] [[T07-spike-git-dependency|T07]] の結果に合わせた配布形態(TS ソースのまま。T07 で、Node と Cloudflare の両アダプターで読み込めることを確かめた。ビルドは入れない)
- [ ] ルートは、各タスク([[T17-admin-data-routes|T17]]・[[T18-upload-route|T18]]・[[T21-orphan-routes|T21]])が export する `PluginRoute<Input>` の定義を、`routes: { [ROUTES.x]: xRoute }` の形で登録する。`definePluginRoute` は json の入力の型が `unknown` になるので使わない。`input` を書き忘れても型エラーにならないので、各ルートの単体テストで確かめる([[T08-spike-route-body#T18 で使うルートの宣言|T08]])
- [ ] `content:beforeSave` は 1 つのプラグインに 1 つだけ。[[T19-image-entry-hook|T19]](`b64_images`)と [[T16-reference-hook|T16]](それ以外、`validateReferencesBeforeSave`)を 1 つの handler で振り分ける。登録には capability `content:write` が要る(無いと警告だけ出して黙って飛ばす)。**beforeSave に `errorPolicy: "continue"` を付けない**(拒否の例外が捨てられ、保存が通る。afterSave の T20 と混同しない)。雛形は [[T16-reference-hook#T29 への引き継ぎ(登録のしかた)|T16]]
- [ ] T20 の hook は、`imageOwnerHooks`(`src/server/hooks/owners.ts`。afterSave と afterPublish、`priority: 50`、`errorPolicy: "continue"`)をそのまま `hooks` に入れる。`errorPolicy` と `priority` を上書きしない。handler を包むときも例外を投げない。after* の hook の登録には capability `content:read` が要る(無いと警告だけで登録されない)。`schema:read` とストレージ `imageRefs` の宣言が無いと、エラーのログが出て記録されない([[T20-owner-tracking#T29 への引き継ぎ(登録のしかた)|T20]])
- [ ] T17 のルート(`src/server/routes/admin-data.ts`)は `routes: { [ROUTES.preview]: previewRoute, [ROUTES.thumbnails]: thumbnailsRoute }` で登録する。capability `content:read` と、ストレージ `imageRefs` の宣言が無いと 500 になる。`content:restore` は要らない([[T17-admin-data-routes#結果|T17]])
- [ ] widget の `fieldTypes` は `["json"]` にする。T11 の検証は、このプラグインの widget を使う `json` フィールドだけを保存先として受け付ける([[T11-server-validation#結果|T11]])
- [ ] `src/index.ts` 以下は、利用者のサイトの `tsc` でも検査される(`astro.config.mjs` から辿られる)。`npm run typecheck` の 3 つの設定を通す([[T04-1-consumer-typecheck|T04-1]]、[[T07-1-spec-distribution|T07-1]])
- [ ] アップロードのルートは `uploadRoute`(`src/server/routes/upload.ts`)を `routes: { [ROUTES.upload]: uploadRoute }` で登録する。使う capability は `schema:read` / `content:write` / `content:publish`(`content:read` は補われる)、ストレージは `imageRefs`。ハンドラーは、EmDash の i18n の設定(`getI18nConfig()`)をリクエストのたびに読む([[T18-upload-route#T29 がルートを登録する方法|T18]])
- [ ] 完了の確認に、playground のサンプルの投稿を作るスクリプトを使える。開発サーバーを起動して `node playground/scripts/create-sample-posts.ts --base http://localhost:<ポート>` を実行すると、アップロードのルート・保存 hook(T16・T19)・参照元の記録(T20)をまとめて動かせる。そのあと `/posts/` で表示を確かめる。ルートが無いとスクリプトは 404 で止まる。T26 は、同じ登録を一時的に入れた使い捨てのサイトで確かめた([[playground-site-pages#再現手順]]、[[T26-playground-pages#他のタスクへの影響|T26]])
- [ ] 画像管理のルートと hook(`src/server/routes/images-admin.ts`・`src/server/hooks/image-deleted.ts`)は `routes: { [ROUTES.imagesList]: imagesListRoute, [ROUTES.imagesTrash]: imagesTrashRoute }` と `hooks: { ...imageOwnerHooks, ...imageDeletedHooks }` で登録する。`imageDeletedHooks`(afterDelete。`priority: 50`・`errorPolicy: "continue"`)は上書きしない。使う capability は `schema:read`(消されたコレクションの確認)・`content:read`(`get`。afterDelete の登録にも要る)・`content:write`(ゴミ箱への移動)・`content:revisions:read`(`getRevision`)・`content:restore`(`getTrashedVersioned`。`content:read` は含まない)。宣言が足りないと、ルートは capability の名前を書いた `Error`(500)を投げ、`content:read` が無いと afterDelete は登録されない(警告だけ)([[T21-orphan-routes#T29 への引き継ぎ|T21]])
- [ ] 画像管理ページのラベル(`admin.pages` の `label`)は、管理画面が `i18n._(label)` で訳すとみられる。辞書のキーは Lingui の ID なので、文字列のラベルは訳されず、本番のビルドでは描画のたびに Lingui の警告が出るとみられる(列の見出しでの実測からの推測。[[emdash-admin-content-list-columns]])。ラベルに何を使うかは [[T25-images-page|T25]] の結果に従う
- [ ] 画像管理ページは `admin: { entry, pages: [IMAGES_PAGE] }` で登録する(`src/shared/constants.ts` の `IMAGES_PAGE`。パス `/images`、ラベルは管理画面の辞書の「Images」の ID `an5hVd`、アイコン `image`)。値を書き写さず、`label` を文字列にしない。`src/shared/constants.ts` は依存の無い定数だけなので、サーバーの入口から読み込んでよい(`src/admin/ImagesPage.tsx` は読み込まない。React と Kumo が入る)([[T25-2-page-registration-prep#T29・T30 での使い方|T25-2]]、[[emdash-admin-plugin-pages]])

## 完了条件

- [ ] playground で起動し、各ルートと hook が動くことを手動で確認した

## 変更してよいファイル

- `src/index.ts`
- `src/server/plugin.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
