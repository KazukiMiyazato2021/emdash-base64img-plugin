---
title: README の導入手順で新しいサイトを作って確かめた結果
aliases:
  - README の手順の確認
  - 導入手順の確認
  - README の手順で作ったサイト
tags:
  - docs
  - readme
  - distribution
  - npm
  - emdash
source_task: "[[T33-readme]]"
created: 2026-09-24
updated: 2026-09-24
---

# README の導入手順で新しいサイトを作って確かめた結果

> [!summary] 要点
> - README の手順(`.npmrc` → git 依存 → `astro.config.mjs` → seed → ページ)だけで、playground と同じ構成(Node + SQLite、`b64_images` と、`posts` の `cover` / `gallery`)を新しいサイトに作れた。管理画面の widget でアップロード・保存・公開し、サイトの一覧・詳細に `<img src="data:image/webp;base64,…" width height>` が出た。根拠: **実測のみ**
> - README の例のページに `<meta charset>` が無いと、日本語が文字化けした。Astro の応答は `Content-Type: text/html` で charset を含まない。例に HTML の骨組みを入れた。根拠: **実測のみ**
> - `min-release-age=3` のままプラグインを入れると `ERESOLVE`(`Found: emdash@undefined`)になった。`--force` なら、増えたのはプラグインの 1 件だけ。`--legacy-peer-deps` は peer として入った 4 個を消す。根拠: **実測のみ**
> - EmDash 0.39.1 の例外のコマンドで、EmDash の外に公開から 3 日未満の版が 15 個入った(2026-09-24)。`overrides` でルートのロックファイルの版に戻し、0 個にした。根拠: **実測のみ**
> - `b64_images` の無いサイトで、REST の schema API で作ると、サーバーを再起動せずにアップロードできた。API トークンを作れるのは管理者だけ。根拠: **実測+公式ドキュメント**
> - EmDash 標準の `b64_images` の画面のゴミ箱から「復元」できた。ただし、開くだけで一覧(`limit=100`)とゴミ箱(既定 50 件)の画像の本体を読み込む。根拠: **実測+公式ドキュメント**
> - 関連: [[T33-readme]]、[[npm12-git-dependency-policy]]、[[git-dependency-ts-source]]、[[emdash-dependency-versions]]、[[emdash-admin-entry-assembly]]、[[playground-site-pages]]、[[astro-dev-background-for-agents]]

> [!info] 環境
> - macOS 26.4(25E246、Apple M5 Pro)、Node 26.10.0、npm 12.0.2(mise)。利用者の `~/.npmrc` は `min-release-age=3` と `ignore-scripts=true`(変更していない)。
> - サイト: Astro 7.3.3、`@astrojs/node` 11.1.6、`@astrojs/react` 6.0.6、React 19.2.4、`emdash` / `@emdash-cms/admin` 0.39.1、`@cloudflare/kumo` 2.6.0、Vite 8.3.0、TypeScript 6.0.3、`@astrojs/check` 0.9.10。
> - ブラウザ: Playwright 1.63.0 の Chromium 153(ヘッドレス)。開発サーバーのポートは 4433。
> - 2026-09-24 の 11:40〜12:10 UTC に計測。プラグインは `phase-6/t-33` のコミット `f766e72` を git 依存(`git+file://`)で入れた。
> - サイトは `spikes/t33-readme/site/`(git 管理外)。worktree の中にあるので、上の階層に `node_modules` がある。`require.resolve` の解決先(`emdash-plugin-base64-image` → `./node_modules/emdash-plugin-base64-image/src/index.ts` など)と、`tsc --listFilesOnly`(サイトの外は TypeScript の lib だけ)で、サイトの外を読んでいないことを確かめた。

## 1. 作り方

README の読み手は「EmDash 0.39 のサイトがある人」なので、土台(Astro・アダプター・React・`src/live.config.ts`・`tsconfig.json`)は EmDash の公式の手順(`references/emdash/docs/src/content/docs/existing-project.mdx`)と playground に合わせて作り、そこから README の手順だけを進めた。

| 手順 | やったこと | 結果 |
|---|---|---|
| 土台 | `npm install astro@^7.3.2 @astrojs/node@^11.1.5 @astrojs/react@^6.0.5 react@19.2.4 react-dom@19.2.4`、`npm install -D typescript@^6.0.3 @astrojs/check@0.9.10 @types/node@^26.6.2`(通常の設定) | 256 + 86 パッケージ |
| 土台(例外) | `npm install --min-release-age=0 --save-exact emdash@0.39.1`(このコマンドには emdash だけ) | 311 パッケージを追加 |
| 監査 | [[npm12-git-dependency-policy#spike のロックファイルの監査]] のスクリプト | EmDash 系 9 個、**EmDash の外 15 個**(下の表) |
| `overrides` | 15 個をルートの `package-lock.json` の版に戻し、`npm install`(通常の設定) | 監査で EmDash の外 0 個。`npm ls --all` は終了コード 0 |
| README 手順 1 | サイトの `.npmrc` に `allow-git=root`(README のコードブロックをそのまま書き出した) | `npm config get allow-git` は `root` |
| README 手順 2 | `npm install "emdash-plugin-base64-image@git+file:///…#f766e72…"` | **`ERESOLVE`**(下の 2 章)。`--force` で入れた |
| README 手順 3〜5 | `astro.config.mjs`・`seed/seed.json`・`src/components/Base64Image.astro`・`src/pages/posts/index.astro`・`src/pages/posts/[slug].astro` を、README のコードブロックから機械的に書き出した | 最後に README の最終版と `cmp` で一致を確かめた |

根拠: **実測のみ**

- `astro.config.mjs` だけ、README に無い設定を足した: 管理画面のフォントを `local()` だけで登録するプロバイダーと `fonts: false`(playground と同じ。[[emdash-playground-site-config#管理画面のフォント]])。EmDash の既定は、開発サーバーの起動時に Google Fonts に接続するため。プラグインとは関係しない。
- EmDash 系の 9 個は、0.39.1 の 5 個(`emdash`・`@emdash-cms/admin`・`auth`・`blocks`・`gutenberg-to-portable-text`)と、`emdash@0.39.1` が版を固定して依存する 4 個(`@emdash-cms/plugin-types` 0.4.0、`registry-client` 0.6.1、`registry-lexicons` 0.6.0、`registry-verification` 0.3.2。どれも 2026-09-23 06:14〜06:15 UTC 公開)。後者は 0.39.1 ではないが、0.39.1 を入れると必ず入る([[npm12-git-dependency-policy#spike のロックファイルの監査]] と同じ扱い)。

EmDash の外に入った 15 個(公開日時は UTC。境界は 2026-09-21 11:45 UTC)と、戻した版(すべてルートのロックファイルの版):

| パッケージ | 入った版(公開日時) | 戻した版 |
|---|---|---|
| `@atcute/car` | 6.1.0(09-24 03:30) | 6.0.2 |
| `@atcute/cbor` | 2.3.8(09-24 03:30) | 2.3.7 |
| `@atcute/cid` | 2.5.0(09-24 03:30) | 2.4.2 |
| `@atcute/lexicons` | 2.1.1(09-23 01:46) | 2.1.0 |
| `@atcute/mst` | 1.1.1(09-24 03:30) | 1.1.0 |
| `@atcute/repo` | 1.1.0(09-24 03:30) | 1.0.2 |
| `@atcute/uint8array` | 1.2.0(09-24 03:30) | 1.1.5 |
| `@modelcontextprotocol/sdk` | 1.30.1(09-23 16:06) | 1.30.0 |
| `@wordpress/block-serialization-default-parser` | 5.56.0(09-23 12:33) | 5.55.0 |
| `dompurify` | 3.4.16(09-23 15:29) | 3.4.15 |
| `hono` | 4.13.9(09-24 01:32) | 4.13.8 |
| `prosemirror-dropcursor` | 1.8.4(09-24 08:32) | 1.8.3 |
| `prosemirror-model` | 1.25.12(09-21 13:05) | 1.25.11 |
| `prosemirror-view` | 1.42.5(09-21 13:08) | 1.42.4 |
| `yjs` | 13.6.33(09-23 16:37) | 13.6.32 |

根拠: **実測のみ**。T07(2026-09-23)の 7 個に、`@atcute/*` の 6 個・`hono`・`prosemirror-dropcursor` が加わった。例外のコマンドで何もない状態から入れると、日がたつほど EmDash の外の新しい版が増える。

## 2. プラグインのインストール(npm 12・min-release-age)

`min-release-age=3` のまま、EmDash 0.39.1 を入れたサイトにプラグインを足したときの結果。

| コマンド | 結果 |
|---|---|
| `npm install "emdash-plugin-base64-image@git+file:///…#<commit>"` | `ERESOLVE`。`Found: emdash@undefined` / `peer emdash@"^0.39.0" from emdash-plugin-base64-image@0.0.0` |
| `package.json` に手で書いてから `npm install`(引数なし)の `--dry-run` | 同じ `ERESOLVE` |
| `--legacy-peer-deps` の `--dry-run` | 「add emdash-plugin-base64-image」と「remove csstype / @types/react-dom / @types/react / @emnapi/runtime」。peer として自動で入っていたものが消えるので採らない |
| `--force` の `--dry-run` | 「add emdash-plugin-base64-image」だけ |
| `--force`(実行) | 追加 1。ロックファイルの差分は、プラグインの項目の追加とルートの `dependencies` だけ。監査(差分)で registry の新しい版は 0 個。`npm ls --all` は終了コード 0 |
| そのロックファイルで `npm ci` | 成功(`allow-git=root`・`min-release-age=3` のまま) |
| `npm ci --allow-git=none` | `npm error code EALLOWGIT` / `Fetching packages of type "git" have been disabled`(`npm ci` は先に `node_modules` を消すので、入れ直した) |

根拠: **実測のみ**

- README の対処は「EmDash を入れたときと同じく `--min-release-age=0` を付ける」(T07 の実測で、増えたのはプラグインだけ。[[npm12-git-dependency-policy#min-release-age と peer の解決]])と、「緩めたくなければ `--force`」にした。T33 では、利用者の了承の範囲(EmDash の 0.39.1 だけ)の外になるので、`--min-release-age=0` のほうは実行していない。
- 入ったプラグイン(`node_modules/emdash-plugin-base64-image`)は、`package.json`・`README.md`・`src/` の実体のディレクトリ(シンボリックリンクではない)。peer の `@emdash-cms/admin` 0.39.1・`@cloudflare/kumo` 2.6.0・`react` 19.2.4 は、`emdash` と一緒に入ったものが使われた(`npm ls`)。プラグインの `zod`(`^4.5.4`)は、サイト直下の 4.6.5(`astro` の依存)に重なった。根拠: **実測のみ**
- 公開日時: `npm view emdash "time[0.39.1]"` は `2026-09-23T10:19:59.335Z` の 1 行を出す。`npm view emdash time.0.39.1` は何も出さない(版の `.` がキーの区切りになる)。`npm view emdash time --json` は全版の表を配列で包んで出す。0.39.0 の公開は `2026-09-23T06:42:34.912Z`。根拠: **実測のみ**

## 3. 管理画面(widget・保存・公開)

開発用ログイン(`/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`)で入り、cookie `emdash-locale=ja` で日本語の画面にした。根拠: **実測のみ**

| 操作 | 結果 |
|---|---|
| 最初のリクエスト | seed(README の例)が入った。生成された `emdash-env.d.ts` に `B64Image`(`image: unknown`)と `Post`(`cover?: unknown`・`gallery?: unknown`) |
| 新規作成の画面 | `#field-cover` は `FIELDSET`(単一画像の widget)で「画像をドロップ / 貼り付け」。textarea は 0 |
| カバーに 2400×1600 の JPEG | 「画像を追加しました。」。1600×1067・保存サイズ 99.1KB・画質 0.86 |
| ギャラリーに PNG 2 枚(1200×800・800×1200) | 「2 枚の画像を追加しました。」。94.5KB・96.3KB |
| 保存 | `POST /_emdash/api/content/posts` が 201。URL は `/_emdash/admin/content/posts/<ID>?locale=en`。保存した値は `{ v: 1, id, locale: "en", width: 1600, height: 1067, alt: "README の確認のカバー" }` |
| 公開 | 右上の「Publish now」(日本語の画面でも英語)→ 確認のダイアログ(「Publish now?」「This content will be visible on the site immediately.」)の「Publish now」。`PUT …/posts/<ID>` 200 のあと `POST …/posts/<ID>/publish` 200 |
| 開き直した編集画面 | `preview` が widget ごとに 1 回。プレビューの画像は 1600×1067・1200×800・800×1200 で読み込み済み |

- 「Publish now」は確認のダイアログを開くだけで、公開はダイアログの中の同じ名前のボタンで行う(`references/emdash/packages/admin/src/components/ContentSettingsPanel.tsx:463-513`)。Playwright では、ダイアログ(`role="dialog"`)の中のボタンを押す。根拠: **実測+公式ドキュメント**
- ページを開いてすぐ(`networkidle` の直後)のスクリーンショットでは、プレビューが市松模様(まだ届いていない)だった。画像の要素を待ってから撮ると出ていた。根拠: **実測のみ**

## 4. サイトのページ(README の例のまま)

| ページ | 結果 |
|---|---|
| `/posts/` | 200。`<img>` 1 枚: `data:image/webp;base64,…`(99,063 文字)、`width="1600" height="1067"` と `naturalWidth` × `naturalHeight` が一致、`loading="eager"`・`fetchpriority="high"`。Layout Shift 0 回。`db.count` 3〜4(プロセスの最初の 1 回は、リダイレクトとタクソノミーの定義の読み出しが加わる) |
| `/posts/<slug>/` | 200。カバー(`priority`)とギャラリー 2 枚(`loading="lazy"`)。寸法はすべて一致、代替テキストは保存したもの(空欄は `alt=""`)。`db.count` 2 |
| `/posts/no-such-post/` | 404、「投稿が見つかりません」 |
| ギャラリーの画像をゴミ箱に移したあとの詳細 | `<img>` 2 枚と、`role="img"`・`aria-label="画像が見つかりません"`・`style="aspect-ratio: 1200 / 800;"` の枠 1 つ |

根拠: **実測のみ**(Chromium 153)

- 最初の README の例(レイアウト無し)では、`alt` とページの文字が `README ã®ç¢ºèªã®ã‚«ãƒãƒ¼` のように文字化けした。応答は `content-type: text/html`(charset なし)で、HTML は `<!DOCTYPE html><h1>投稿</h1>…` の断片だった。例に `<html lang="ja">`・`<meta charset="utf-8" />`・`<title>` を足すと直った。playground はレイアウト(`_components/Layout.astro`)に `<meta charset="UTF-8" />` があるので起きない。根拠: **実測のみ**

## 5. 画像管理ページ・ゴミ箱・戻し方

| 操作 | 結果 |
|---|---|
| サイドバー | 「プラグイン」の「画像」(`/_emdash/admin/plugins/base64-image/images`)。「画像の管理」に 3 行(寸法・保存サイズ・ID・公開の状態・使用中・参照元のフィールドとロケール・作成日時・操作) |
| ゴミ箱に移動(画像管理ページ) | ボタンの名前は「ゴミ箱に移動: 1200×800、2026/09/24 20:49 作成の画像」。確認(`alertdialog`)に「この画像は使用中です。…」。`POST …/images/trash` 200。行は「ゴミ箱」で、管理者には「完全に削除」だけ |
| 標準の画面(`/_emdash/admin/content/b64_images`)を開く | `GET /_emdash/api/content/b64_images?limit=100&orderBy=updatedAt&order=desc`(2 件で 194,779 バイト)と `GET …/b64_images/trash`(1 件で 96,779 バイト)。どちらも画像の本体を含む |
| 標準の画面の「ゴミ箱」のタブ(`role="tab"`、「ゴミ箱1」)→「<ID>を復元」 | `POST …/b64_images/<ID>/restore` 200。画像管理ページの行は「下書き」「サイトに表示されません。」で「公開」のボタン。サイトは「画像が見つかりません」の枠のまま |
| REST API で戻す(README のコマンド、Bearer トークン・スコープ `content:write`) | 200(`-o /dev/null -w "%{http_code}\n"` で `200` だけが出る)。本文を捨てないと、画像の本体を含む JSON がそのまま出る |
| 画像管理ページの「公開」 | `POST …/b64_images/<ID>/publish` 200。行は「公開済み」、詳細ページに画像が戻った |

根拠: **実測のみ**(一覧の件数の上限は、標準の画面が `limit: 100` を送ること(`references/emdash/packages/admin/src/router.tsx:440`)と、ゴミ箱の API の既定 50 件(`references/emdash/packages/core/src/database/repositories/content.ts:1581` の `Math.min(options.limit || 50, 100)`)から。こちらは **公式ドキュメントのみ**)

- API トークンは `POST /_emdash/api/admin/api-tokens`(管理画面の「設定」の「API Tokens」と同じ API)で作れる。作れるのは管理者だけ(`user.role < Role.ADMIN` は 403。`references/emdash/packages/core/src/astro/routes/api/admin/api-tokens/index.ts:39`、`:58`)。スコープの要否は、`/_emdash/api/content` の書き込みが `content:write`、`/_emdash/api/schema` の書き込みが `schema:write`(`references/emdash/packages/core/src/astro/middleware/auth.ts:754`、`:763`)。根拠: **実測+公式ドキュメント**
- 戻す操作の権限は、作成者の無い画像では `content:edit_any`(編集者以上。`references/emdash/packages/core/src/astro/routes/api/content/[collection]/[id]/restore.ts:44`)。編集者はトークンを作れないので、API で戻すのは管理者になる。根拠: **公式ドキュメントのみ**

## 6. b64_images の無いサイトと、API での直し方

seed を `posts`(`title` だけ)に差し替えた新しいデータベースで、README の「すでにデータベースがあるとき(API)」を進めた。トークンは管理者のもの(スコープ `schema:write,content:write`)。根拠: **実測のみ**

| 操作 | 結果 |
|---|---|
| README の API のブロック(`posts` のフィールド 2 つ) | 201 × 2。JSON に `widget` と `options` が入る |
| 新規作成の画面 | `cover` は widget(`FIELDSET`、「画像をドロップ / 貼り付け」) |
| `b64_images` が無いまま画像を追加 | `POST …/upload` 500。約 0.8 秒で「画像を保存するコレクション b64_images がありません。サイトの設定を確認してください。」。ドロップゾーンは残り、値は変わらない。画像なしの保存は 201 |
| サーバーのログ | アップロードで `[plugin:base64-image] Failed to create the image entry`(`message: "Collection 'b64_images' not found"`)。最初の保存で `[plugin:base64-image] The "b64_images" collection does not exist, …`(`trigger: 'content:beforeSave'`) |
| README の API のブロック(`b64_images` と `image` のフィールド) | 201 × 2(`hidden: true`・`routable: false`・`supports: []`・`image` は `json` で `required: true`) |
| 再起動せずに、もう一度画像を追加 | `POST …/upload` 200。1600×1200・98.1KB・画質 0.79。保存は 201 |
| 同じブロックをもう一度 | 409 `COLLECTION_EXISTS`(「Collection "b64_images" already exists」)と 409 `FIELD_EXISTS` |

- 開発用ログイン(dev-bypass)は、開くたびに seed を `onConflict: "skip"` で適用する(`references/emdash/packages/core/src/astro/routes/api/setup/dev-bypass.ts:59-73`)。seed はサーバーの起動時に読み込まれるので、seed に `b64_images` を足してサーバーを起動し直し、開発用ログインを開いても、無いコレクションは作られるとみられる(すでにあるコレクションのフィールドは足されない)。根拠: **公式ドキュメントのみ**(実行はしていない。README には、どの環境でも使える API の手順だけを書いた)

## 7. 型チェックとマイグレーション

| コマンド | 結果 |
|---|---|
| `npx astro check` | 6 ファイル、0 errors |
| `npx tsc --noEmit`(サイトの tsconfig: `extends: astro/tsconfigs/strict`、`include: ["src", ".astro/types.d.ts", "emdash-env.d.ts"]`) | 0 件。プラグインの `src` は辿られない(`--listFilesOnly` に無い) |
| 同じ設定で、`src/lib/images.ts` が `emdash-plugin-base64-image/astro` を re-export | 0 件。プラグインの 7 ファイル(`src/astro.ts`・`site/resolve.ts`・`shared/*` 5 つ)を検査 |
| `include` を `**/*` にした tsconfig(`allowJs: true` は Astro の base から) | 0 件。`astro.config.mjs` からプラグインの 19 ファイル(`src/index.ts`・`server/**`・`shared/**`)を検査 |
| `npx astro build` | 成功(2.2 秒)。`.emdash/migrations.json` |
| `npx emdash migrate --check` | 成功(終了コード 0、`Pending: none`) |
| `npx emdash migrate --from-config --check` | `Stripping types is currently unsupported for files under node_modules` で終了コード 1 |

根拠: **実測のみ**。T07 の結果([[git-dependency-ts-source#利用者側の型チェック]]、[[git-dependency-ts-source#`emdash migrate --from-config`]])と同じ。

## 8. 再現手順

```sh
# spikes/t33-readme/site に package.json を作り、土台を入れる(通常の設定)
npm install astro@^7.3.2 @astrojs/node@^11.1.5 @astrojs/react@^6.0.5 react@19.2.4 react-dom@19.2.4
npm install -D typescript@^6.0.3 @astrojs/check@0.9.10 @types/node@^26.6.2
npm install --min-release-age=0 --save-exact emdash@0.39.1     # 利用者が了承した例外
node ../audit-lock.mjs package-lock.json                        # 監査。EmDash の外が出たら overrides に足して npm install
# README の手順 1〜5(コードブロックを書き出す)
node ../extract-readme.mjs 0 .npmrc
npm install --force "emdash-plugin-base64-image@git+file:///Users/home/sandbox/emdash-base64img-plugin#<commit>"
# astro.config.mjs・seed/seed.json・src/components/Base64Image.astro・src/pages/posts/*.astro も同じく書き出す
npx astro dev --port 4433        # エージェントからはバックグラウンドで起動する
# Playwright: 開発用ログイン → /_emdash/admin/content/posts/new → 画像を追加 → 保存 → Publish now → /posts/ を調べる
npx astro dev stop && lsof -nP -iTCP:4433 -sTCP:LISTEN   # 何も出ないこと
```

README のコードブロックの取り出し(`extract-readme.mjs`)と、シェルのブロックを値だけ差し替えて実行するスクリプト(`run-readme-block.mjs`)の要点:

```js
// README.md のコードブロックを順に取り出す
const blocks = [...readme.matchAll(/^```([^\n`]*)\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], body: m[2] }));
// シェルのブロックは、代入の行(SITE=… / TOKEN=…)と <画像の ID> だけを差し替えて /bin/sh で実行する
body = body.replace(/^SITE=.*$/m, `SITE="http://localhost:4433"`).replace(/^TOKEN=.*$/m, `TOKEN="${token}"`);
```

公開のボタンの押し方(Playwright):

```js
await page.getByRole("button", { name: /Publish now/ }).click();
const dialog = page.getByRole("dialog");
await dialog.getByRole("button", { name: /Publish now/ }).click();
```
