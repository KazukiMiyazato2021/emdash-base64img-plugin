---
title: 知見の索引
aliases:
  - 知見 index
  - docs index
tags:
  - docs
  - index
created: 2026-09-24
updated: 2026-09-24
---

# 知見の索引

> [!summary] 概要
> タスクを進める中で得た知見と検証結果のノートの一覧。
> - 各ノートの知見には根拠レベルを付けている: **実測+公式ドキュメント** / **実測のみ** / **公式ドキュメントのみ** / **外部ドキュメントのみ** / **推測のみ**。EmDash のソースを読んで確かめた事実(実行はしていない)は「公式ドキュメントのみ」に含める。
> - 関係するノート: [[base64-image-plugin-spec|仕様書]] / [[tasks/00-index|タスク一覧]]
> - この索引は、タスクブランチをフェーズブランチにマージするときにリーダーが更新する。

## 環境・ツール・進め方

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[npm-workspaces-nested-worktree\|npm 12 の workspaces と入れ子の worktree]] | `docs/npm-workspaces-nested-worktree.md` | playground が `file:..` でルートを参照する構成。ロックファイルはルートの 1 つだけ。入れ子の worktree で上位の `node_modules` が解決される問題 | [[T01-scaffold\|T01]] |
| [[test-lint-setup\|テスト・lint・E2E の設定]] | `docs/test-lint-setup.md` | vitest の projects(node / jsdom)、`cleanup()` の明示、oxlint と prettier の対象、Playwright のブラウザ | [[T01-scaffold\|T01]] |
| [[claude-code-worktree-isolation\|worktree で隔離したチームの運用]] | `docs/claude-code-worktree-isolation.md` | isolation: worktree の worktree は `main` から作られる。分岐元の確認、片付け、共有される stash | [[T01-1-workflow-docs-index\|T01-1]] |
| [[astro-dev-background-for-agents\|エージェントから実行した astro dev はバックグラウンドで起動する]] | `docs/astro-dev-background-for-agents.md` | Astro 7.3.3 は環境変数 `CLAUDECODE` を見て `astro dev` / `astro preview` を自動でバックグラウンドにする。止めるのは `npm run dev -w playground -- stop` | [[T02-playground\|T02]] |
| [[vite-watch-scope-playground\|playground の開発サーバーが監視する範囲]] | `docs/vite-watch-scope-playground.md` | 監視は playground の中と、読み込まれたプラグインのソースだけ。ルート自身へのリンク・`spikes/`・`.claude/` はたどらない(除外の設定は不要) | [[T02-playground\|T02]] |
| [[git-dependency-ts-source\|git 依存 + TS ソースのプラグインを利用者のサイトで読み込む]] | `docs/git-dependency-ts-source.md` | ビルドなしの TS ソースを git 依存で入れ、Node と Cloudflare の両アダプターで読み込めた。利用者の `tsc` は `src` を検査する(`astro check` はしない)。緩い設定・厳しい設定の代わりの tsconfig で確かめる。`emdash migrate --from-config` は失敗する | [[T07-spike-git-dependency\|T07]]、[[T04-1-consumer-typecheck\|T04-1]] |
| [[npm12-git-dependency-policy\|npm 12 の git 依存・install スクリプトの既定と min-release-age]] | `docs/npm12-git-dependency-policy.md` | npm 12 は git 依存を既定で拒否する(サイトの `.npmrc` に `allow-git=root` が要る)。依存の install スクリプト(git 依存の `prepare` も)は既定で止まる。`min-release-age` で peer の解決が `ERESOLVE` になる | [[T07-spike-git-dependency\|T07]] |

## EmDash

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[emdash-dependency-versions\|EmDash に合わせた依存パッケージの版]] | `docs/emdash-dependency-versions.md` | `emdash` / `@emdash-cms/admin` は 0.39.1、peer は `^0.39.0`。kumo は 2.6.0。0.38.0 から上げた経緯と、`min-release-age` の例外の手順・監査結果 | [[T01-scaffold\|T01]]、[[T01-2-emdash-0-39\|T01-2]] |
| [[emdash-native-plugin-entrypoints\|EmDash の native プラグインの入口]] | `docs/emdash-native-plugin-entrypoints.md` | descriptor の必須項目、名前付き export の `createPlugin`、`adminEntry` と `admin.entry` の違い(0.38.0 と 0.39.1 で同じ) | [[T01-scaffold\|T01]] |
| [[emdash-native-plugin-lifecycle-hooks\|EmDash 0.39.1 の native プラグインの lifecycle hook(起動時に呼ばれない)]] | `docs/emdash-native-plugin-lifecycle-hooks.md` | config で登録した native プラグインでは、起動時に `plugin:install` / `plugin:activate` が呼ばれない(`plugin:activate` は管理者が有効にしたときだけ)。公式ドキュメントの説明と違う。`b64_images` があるかは `plugin:activate` と最初の保存で確かめる | [[T29-plugin-definition\|T29]] |
| [[emdash-plugin-definition-registration\|EmDash 0.39.1 のプラグイン定義の登録(capability と ctx、hook の登録条件と順番、fieldWidgets、ページ)]] | `docs/emdash-plugin-definition-registration.md` | capability が足りないとルートは 500、hook は警告だけで登録されない。hook は priority の小さい順で、beforeSave は値を次に渡す。`admin.fieldWidgets` はマニフェストに載るだけ。サイドバーの項目は入口の `pages` に部品があるときだけ出る。登録を確かめるテストの作り方 | [[T29-plugin-definition\|T29]] |
| [[emdash-admin-entry-assembly\|EmDash 0.39.1 の管理画面の入口(adminEntry)の組み立てと、実際の管理画面での確認]] | `docs/emdash-admin-entry-assembly.md` | 入口は `fields`・`pages`・`contentListColumns` を export し、読み込み時に一覧の列のマニフェストを取り始める。入口のテストの作り方(`vi.resetModules()`、本物の `usePluginPage`)。playground の開発サーバーと本番のビルドでの確認、管理画面の JS の増え方(gzip +33KB)、`b64_images` の無いサイトで編集者に見えるもの | [[T30-admin-entry\|T30]] |
| [[emdash-admin-console-noise\|EmDash 0.39.1 の管理画面が console に出す、プラグインと関係の無い警告・エラー]] | `docs/emdash-admin-console-noise.md` | 本番のビルドのコマンドパレットの Lingui の警告、Firefox の本番のビルドの zod 4 による CSP の eval の違反、Firefox のサイドバーのスクロールの警告。E2E で console を見張るときに除く | [[T30-admin-entry\|T30]] |
| [[emdash-playground-site-config\|storage を指定しない EmDash サイト(Node + SQLite)の設定とビルド]] | `docs/emdash-playground-site-config.md` | storage を省略すると local storage が既定になる。`fonts: false` の不具合と回避策。`astro build` の挙動(約 2 秒、DB・ネットワーク不要)。生成されるファイル | [[T02-playground\|T02]] |
| [[emdash-seed-and-b64-images\|EmDash の seed の適用と b64_images の最小構成]] | `docs/emdash-seed-and-b64-images.md` | seed が適用される時期と条件。`b64_images` はタイトル不要、`routable: false` は必須。公開でリビジョンが 1 件できる。dev-bypass。widget が無いフィールドは JSON の入力欄になる | [[T02-playground\|T02]] |
| [[emdash-query-count-b64-images\|b64_images を ID の IN 句で取得するときのクエリ数]] | `docs/emdash-query-count-b64-images.md` | `getEmDashCollection` は 50 件まで 1 クエリ。バインド変数は ID 数 + 7(1 回 93 件まで)。上限を超えると `{ entries: [], error }` で黙って空になる。locale を省いたときの絞り込み。バイラインでの増え方 | [[T09-spike-query-count\|T09]] |
| [[playground-site-pages\|playground のサイト側のページで確かめた描画・LCP・クエリ数と、サンプルの投稿]] | `docs/playground-site-pages.md` | `emdash/ui` の `Image` は、data URL をそのまま `<img width height>` で出す。一覧 10 件でも詳細 11 枚でも、ページのクエリは 2 本。Chromium で LCP の要素は `priority` の画像で、Layout Shift は 0 回。`getEmDashEntry` は見つからないときも `LiveEntryNotFoundError` を返す。アップロードのルートでサンプルの投稿を作るスクリプト | [[T26-playground-pages\|T26]] |
| [[emdash-after-save-payload\|EmDash 0.39.1 の content:afterSave に渡る内容と、操作ごとに呼ばれる hook]] | `docs/emdash-after-save-payload.md` | `content.data` は下書き、`liveData` は列の値。呼ばれるのは作成と更新だけ(公開・複製・ゴミ箱・復元では呼ばれない)。`errorPolicy`。`afterDelete` の形。プラグインの書き込みと hook | [[T10-spike-after-save\|T10]] |
| [[image-owner-tracking-hooks\|参照元の記録(afterSave / afterPublish)の動き、操作ごとの記録とクエリ数]] | `docs/image-owner-tracking-hooks.md` | 参照元は `event.collection`・`event.content.id`・`event.content.locale` から作る。クエリは 0 / 3 / 新しい参照元 1 枚につき +2。`"continue"` の hook の例外はログに出ない。`priority: 50` で既定のほかのプラグインの例外に巻き込まれない | [[T20-owner-tracking\|T20]] |
| [[image-management-routes\|画像管理のルート(一覧の判定・クエリ数の予算・ページ送り・ゴミ箱・完全削除の後始末)]] | `docs/image-management-routes.md` | 一覧は 1 リクエスト 100 クエリの予算で最大 10 枚(参照元が 1 件ずつなら 8 枚、実測 42〜90 クエリ)。参照元が 16 件以上の画像は `items: []` と `nextCursor` で分けて調べる。カーソルは自前。`getTrashedVersioned` でゴミ箱と記録だけの画像を区別する。プラグインの `ctx.content.delete` では `content:afterDelete` が呼ばれない。完全削除のあとの記録の削除。公開の状態(`entryPublication`)と参照元の全体の件数(`ownersTotal`)。公開し直す操作の材料(標準 API は Editor 以上) | [[T21-orphan-routes\|T21]]、[[T21-2-list-publish-status\|T21-2]] |
| [[emdash-plugin-storage-conditional-writes\|EmDash 0.39.1 のプラグインストレージの条件付きの書き込み]] | `docs/emdash-plugin-storage-conditional-writes.md` | `getVersioned` / `compareAndSet` / `updateIf` がある。版はどの書き込みでも変わる。トランザクションは使えない。「`getMany` → `putMany`」の同時の追記は消える(実測)。版を確かめて書き、変わっていたら読み直す | [[T20-owner-tracking\|T20]] |
| [[emdash-content-before-save\|EmDash 0.39.1 の content:beforeSave で保存を拒否する方法]] | `docs/emdash-content-before-save.md` | `ContentSaveRejectedError` で 422 `SAVE_REJECTED`、ほかの例外は 500 で文言が隠れる。管理画面は `message` をそのまま通知に出す。hook は管理画面の言語を知らない。`errorPolicy: "continue"` では拒否が捨てられる。beforeSave はプラグインに 1 つで、`content:write` が要る | [[T16-reference-hook\|T16]] |
| [[b64-images-save-hook\|b64_images の保存 hook(作成の検証と更新の拒否)]] | `docs/b64-images-save-hook.md` | REST・`ctx.content.create`・MCP・管理画面のどれでも hook を通る。hook が無いと上限超えや WebP でない値も 201 で保存される。更新は `image` を送ったら拒否するので、標準の編集画面からは保存・公開できない。`ctx.content.create` の中の拒否は通常の `Error`(`code: "SAVE_REJECTED"`)で届く | [[T19-image-entry-hook\|T19]] |
| [[emdash-plugin-content-query-counts\|EmDash 0.39.1 のプラグイン content API のクエリ数]] | `docs/emdash-plugin-content-query-counts.md` | 参照元 1 件 1 / 3 / 6、画像の状態 2 / 5 / 3、アップロード 72(SQLite)。T21 の件数の決め方 | [[T10-spike-after-save\|T10]] |
| [[emdash-reference-vs-npm-0-38\|references/emdash と npm の emdash@0.38.0 のずれ]] | `docs/emdash-reference-vs-npm-0-38.md` | 参照ソースは 0.38.0 のあとの開発版だった。npm の 0.38.0 には `schema:read` などの capability が無い(0.39.1 に上げて解消) | [[T06-decision-trash-permission\|T06]] |
| [[emdash-plugin-route-permissions\|EmDash のプラグインルートの権限]] | `docs/emdash-plugin-route-permissions.md` | ルートの `permission` とロールごとの結果(0.38.0 と 0.39.1 で実測。結果は同じ)。省略すると Admin のみ。CSRF の確認は 2 か所。API トークンは `admin` スコープ。`ctx.content` は利用者の権限を確かめない。画面側のロールの取り方 | [[T06-decision-trash-permission\|T06]]、[[T08-spike-route-body\|T08]] |
| [[emdash-plugin-route-errors\|EmDash 0.39.1 のプラグインルートのエラーの返り方]] | `docs/emdash-plugin-route-errors.md` | `PluginRouteError` は `{ success: false, error: { code, message } }` と HTTP ステータスになる。`details` は応答に入らない。想定外の例外は `INTERNAL_ERROR` | [[T03-shared-contracts\|T03]] |
| [[emdash-plugin-route-body-limit\|EmDash 0.39.1 のプラグインルートの body 上限と、ルートの宣言の書き方]] | `docs/emdash-plugin-route-body-limit.md` | 既定 1 MiB は `request` を宣言したルートだけの上限(`maxBytes` で最大 8 MiB)。宣言しないと上限なし。判定の順番(401 → 403 → CSRF → 405 → 413 → 400)。アップロードのルートの雛形。CPU 時間。JSON の応答には上限が無い | [[T08-spike-route-body\|T08]] |
| [[emdash-plugin-preview-thumbnail-routes\|管理画面のプレビュー・サムネイル取得ルートのクエリ数・応答の大きさ・CPU 時間]] | `docs/emdash-plugin-preview-thumbnail-routes.md` | `preview` 10 件で 21 クエリ・最大 5MB・3.5ms、20 件は Workers Free の CPU 時間に届くので 10 件のまま。`getMany` は ID + 2 個のバインド変数を使い、99 件から例外になるので 50 件ずつ。見つからない画像は `null` | [[T17-admin-data-routes\|T17]] |
| [[emdash-plugin-upload-route\|プラグインから画像エントリを作って公開する(アップロードのルート)]] | `docs/emdash-plugin-upload-route.md` | ロケールの確認 → 検証 → 作成 → `imageRefs` → 公開の順。ロケールは `getI18nConfig()` で読む(`ctx.site.locale` は別物)。作成の中の拒否は通常の `Error` で届く。失敗時はゴミ箱に移す。75 クエリ。公開のリビジョンの複製は避けられない | [[T18-upload-route\|T18]] |
| [[emdash-plugin-content-api-constraints\|EmDash 0.39.1 のプラグイン API で、データの形に関わる制約]] | `docs/emdash-plugin-content-api-constraints.md` | エントリ ID は作成まで決まらない。seed の ID はそのまま使われる。`getTrashedVersioned` でゴミ箱を判定できる。`get` は 1 件 2 クエリ。widget に collection / entryId / locale は渡らない | [[T03-shared-contracts\|T03]] |
| [[emdash-admin-api-requests\|EmDash 0.39.1 の API を管理画面の部品から呼ぶときの送り方とエラーの形]] | `docs/emdash-admin-api-requests.md` | 同じオリジンの `/_emdash/api/...` を `X-EmDash-Request: 1` 付きの `fetch` で呼ぶ。未ログインはプラグインのルートが `UNAUTHORIZED`、標準 API が `NOT_AUTHENTICATED`。外部の認証の失敗は `text/plain`。`src/client/api.ts` のコードの決め方 | [[T14-admin-i18n-api\|T14]] |
| [[emdash-admin-locale-lang\|EmDash 0.39.1 の管理画面の言語と html の lang 属性]] | `docs/emdash-admin-locale-lang.md` | `<html lang>` は cookie `emdash-locale` → `Accept-Language` → `en` で決まる。設定画面で言語を変えると再読み込みせずに書き換わるので、`MutationObserver` で追随する | [[T14-admin-i18n-api\|T14]] |
| [[emdash-admin-content-editor-url\|EmDash 0.39.1 の管理画面の編集画面の URL と、widget の保存先の求め方]] | `docs/emdash-admin-content-editor-url.md` | plugin widget の props にはコレクション・エントリ ID・ロケールが無いので、URL(`/_emdash/admin/content/<collection>/<ID か new>` と `?locale=`)と props の `id`(`field-<slug>`)から求める。`?locale=` はダッシュボード・コマンドパレット・サイトのツールバーから開くと付かない。ルーターの `?locale=` の読み方 | [[T23-upload-hook\|T23]] |
| [[emdash-plugin-field-widget\|EmDash 0.39.1 の plugin widget が受け取るものと、実際の管理画面での振る舞い]] | `docs/emdash-plugin-field-widget.md` | plugin widget の props は 8 つで、`readOnly` は渡らない。編集ロックは包みの `<fieldset disabled>` で伝わるが、`div` へのドロップは届く。新規作成を保存すると widget は作り直される。`fields` に型の注釈を付けない。`?field=` で開いても fieldset にフォーカスは移らない。フィールドの間隔と、表示の切り替えでフォーカスを戻す方法 | [[T27-image-widget\|T27]] |
| [[emdash-admin-content-list-columns\|EmDash 0.39.1 の管理画面のコンテンツ一覧の列(判定の呼ばれ方・マニフェストの先読み・見出しの訳)]] | `docs/emdash-admin-content-list-columns.md` | 列の `collections` は同期関数で、コレクションやロールが変わったときだけ呼ばれるので、入口の読み込み時にマニフェストを先読みする。`fetchManifest` は Lingui の有効化の前に失敗するので `emdash/plugin-utils` で送る。`label` は Lingui の ID で訳される(文字列は訳されない) | [[T24-list-column\|T24]] |
| [[emdash-admin-plugin-pages\|EmDash 0.39.1 の管理画面のプラグインのページ(登録・ラベルの訳・ロール・useCurrentUser)]] | `docs/emdash-admin-plugin-pages.md` | ページは `definePlugin` の `admin.pages` と入口の `pages` の 2 か所で登録する。サイドバーとコマンドパレットは `label` を Lingui の ID で訳す(「Images」の ID `an5hVd` なら ja は「画像」)。項目はロールで絞られない。`useCurrentUser()` がそのまま使える。ページから一覧の列の覚え書きを消すときは、マニフェストも読み直す | [[T25-images-page\|T25]]、[[T25-2-page-registration-prep\|T25-2]] |
| [[emdash-admin-plugin-ui-styling\|EmDash 0.39.1 の管理画面で、プラグインの部品に Kumo と CSS のクラスを使うときの注意]] | `docs/emdash-admin-plugin-ui-styling.md` | 管理画面の CSS はビルド済みでプラグインのファイルを読まないので、CSS にあるクラスだけが当たる(テストで確かめる)。層の外の `*` の `border-color` が枠の色のクラスより強い。Kumo 2.6.0 の `Loader`・`Label`・`Button`・`Banner` の注意。厳しい型チェックでは、Kumo の省略できる props に `undefined` を渡せない。Kumo の `Input` は `className` を `<input>` に付け、狭い列では `min-w-0` が要る(Firefox) | [[T22-widget-parts\|T22]]、[[T28-2-save-hint-alt-width\|T28-2]] |

## ライブラリ

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[zod-string-length-code-points\|zod 4.5 の文字列の長さはコードポイントで数える]] | `docs/zod-string-length-code-points.md` | `max` / `min` はコードポイント単位。data URL のスキーマは ASCII に限り、長さの上限をバイトの上限と一致させた | [[T03-shared-contracts\|T03]] |
| [[react-hook-testing-pitfalls\|React のフックのテストで気を付けること(StrictMode・act の外の更新・oxlint の誤検出)]] | `docs/react-hook-testing-pitfalls.md` | `renderHook` の `wrapper` で `<StrictMode>` を包んでも effect は 2 回動かない(`reactStrictMode: true` を使う)。`console.error` を見張って act の外の更新を失敗にする。oxlint 1.83.0 の `react(memo-dependencies)` は `catch` の無い `try` / `finally` で誤って報告する | [[T23-upload-hook\|T23]] |
| [[react-effect-lint-and-vitest-hooks\|oxlint の set-state-in-effect と、Vitest の afterEach で投げるときの後片付け]] | `docs/react-effect-lint-and-vitest-hooks.md` | oxlint 1.83.0 の `react(set-state-in-effect)` は effect から呼んだ関数の中の `setState` をエラーにする(読み込みと反映を分ける)。Vitest 4.1.11 の `afterEach` はどれかが投げると残りを呼ばないので、投げる前に `cleanup()` を呼ぶ | [[T25-images-page\|T25]] |
| [[kumo-dialog-confirm-a11y\|Kumo 2.6.0 の Dialog で確認を作るときのキーボードと読み上げ]] | `docs/kumo-dialog-confirm-a11y.md` | `role="alertdialog"` は外側を押しても閉じない(Escape では閉じる)。最初のフォーカスは中の最初の要素。開いている間、外側は `aria-hidden` になるが `aria-live` の領域は隠れない。ボタンが消えるときのフォーカスの移し方。`disabled` にするとフォーカスが失われる | [[T25-images-page\|T25]] |

## ブラウザ・画像処理

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[webp-data-url-validation\|WebP の data URL の検証]] | `docs/webp-data-url-validation.md` | `atob` / `fromBase64` は空白を読み飛ばす。O(1) の検査で不正な base64 を拒否する方法。WebP ヘッダーの検査(libwebp との比較)。Chromium の canvas は `VP8X` + `ICCP` で 482 バイト増える。約 100KB で 0.009〜0.15ms。テスト用の WebP は `tests/fixtures/webp/README.md` | [[T04-webp-utils\|T04]] |
| [[canvas-webp-encoding\|canvas の WebP エンコード(Chromium・Firefox と cwebp の比較)]] | `docs/canvas-webp-encoding.md` | 同じ画素ならエンコーダーの差は小さい。ずれの主因は縮小の方法(Firefox は `imageSmoothingQuality` が無い)。`createImageBitmap` の `resizeQuality: "high"` で縮小し、`minQuality` から探索する。時間・可逆になる画質・全データと再現のコード | [[T05-spike-canvas-webp\|T05]] |
| [[server-image-validation\|サーバー側の画像の検証(アップロードと画像エントリ)]] | `docs/server-image-validation.md` | 保存先は widget と `json` 型の両方で判定する。長さはデコードする前に確かめる。サムネイルは長辺 96px まで(小さなデータで大きな寸法を作れる)。画像エントリは固定上限。境界値の WebP の作り方。検証全体は 0.40ms / 0.93ms | [[T11-server-validation\|T11]] |
| [[compress-image-browser-check\|圧縮処理(compressImage・createThumbnail)を Chromium・Firefox で動かした結果]] | `docs/compress-image-browser-check.md` | 写真 5 枚の結果は T05 の表と長辺・画質・エンコード回数まで一致した。中断は 0.4ms 以内に reject。透過は保持される。乱数ノイズの画像は Chromium の GPU 描画だけ上限を超えた | [[T13-encode-search\|T13]] |
| [[jsdom-browser-api-gaps\|jsdom でブラウザ側の画像処理をテストするときの注意]] | `docs/jsdom-browser-api-gaps.md` | jsdom 30.1.0 には `createImageBitmap`・`OffscreenCanvas` が無く、canvas の `getContext` は `null`。canvas の部分は差し替えられるように作り、偽物でテストする。`abort()` の `reason` は Node の `DOMException` | [[T13-encode-search\|T13]] |
| [[input-image-decode\|入力画像の形式の判定とデコード]] | `docs/input-image-decode.md` | `File.type` は拡張子だけで決まり、`createImageBitmap` は中身で形式を決める(ICO もデコードする)ので、形式は先頭のバイトで判定する。デコードは 1 画素約 4 バイトのメモリを使うので、画素数はヘッダーで確かめる。Firefox はデコードの間、画面を止める | [[T12-input-decode\|T12]] |
| [[admin-image-input-browser-behavior\|画像の入力(ファイルの選択・ドロップ・貼り付け)のブラウザでの挙動]] | `docs/admin-image-input-browser-behavior.md` | 貼り付けのイベントが届く要素は、Chromium 153 がフォーカスのあるボタン、Firefox 155 が body なので、`document` で受けて判定する。Firefox のヘッドレスはクリップボードの画像を読めず、合成した `ClipboardEvent` は空になる(貼り付けの E2E は Chromium で行う)。ドロップは両方で試せる | [[T22-widget-parts\|T22]] |
| [[gallery-widget-reorder-focus\|ギャラリーの widget の並べ替え(ドラッグと ↑↓)・フォーカス・処理中の保存]] | `docs/gallery-widget-reorder-focus.md` | HTML の Drag and Drop で並べ替える作り方(つまみ・独自の種類・落とす位置の線)。React DOM 19 は並べ替えのあとにフォーカスを戻すが、生の `insertBefore` では外れる。`disabled` にしたボタンからはフォーカスが外れる(端の ↑↓ は `aria-disabled`)。処理中に「Save」を押すと、EmDash が応答でフォームの値を置き換え、そのあいだに足した画像が外れる。Firefox の狭い画面で代替テキストの入力欄がはみ出す(`min-w-0` で直した)。処理中の案内はキャンセルボタンの説明にする | [[T28-gallery-widget\|T28]]、[[T28-2-save-hint-alt-width\|T28-2]] |
| [[e2e-input-image-fixtures\|E2E の入力画像を Node・sips・Chromium で作る方法]] | `docs/e2e-input-image-fixtures.md` | 28 個を、新しいパッケージを入れずに約 1.5 秒で作る。macOS の `sips` は WebP を書けないので、WebP は Chromium の canvas で作る。本番の判定・圧縮に通した結果。HEIC の拒否は本物の HEIC で確かめる(中身が JPEG なら受け付けられる)。git には入れない | [[T26-playground-pages\|T26]] |
| [[upload-hook-browser-check\|アップロードのフックを Chromium・Firefox で動かした結果]] | `docs/upload-hook-browser-check.md` | 「読み込み中…」をデコードの前に描画するには `requestAnimationFrame` を 2 回待つ(1 回では 30 回中 20 回で間に合わない)。Firefox 155 はデコードと縮小の間に主スレッドを最大約 120ms 止め、キャンセルはそのあとに届く。送った要求 36 件はサーバーの検証を通った | [[T23-upload-hook\|T23]] |

## Cloudflare

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[cloudflare-workers-free-d1-limits\|Workers Free で D1 に送れるクエリ数と、1 日の上限]] | `docs/cloudflare-workers-free-d1-limits.md` | Free はサブリクエストが外部 50・Cloudflare のサービス 1,000 / 呼び出し(D1 は後者)。D1 のページの「50」と食い違う。D1 Free の 1 日の上限(読み 500 万・書き 10 万行)は 2026-09-01 から厳密に適用 | [[T10-1-spec-d1-limits\|T10-1]] |
