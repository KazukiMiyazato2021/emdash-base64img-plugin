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
| [[emdash-playground-site-config\|storage を指定しない EmDash サイト(Node + SQLite)の設定とビルド]] | `docs/emdash-playground-site-config.md` | storage を省略すると local storage が既定になる。`fonts: false` の不具合と回避策。`astro build` の挙動(約 2 秒、DB・ネットワーク不要)。生成されるファイル | [[T02-playground\|T02]] |
| [[emdash-seed-and-b64-images\|EmDash の seed の適用と b64_images の最小構成]] | `docs/emdash-seed-and-b64-images.md` | seed が適用される時期と条件。`b64_images` はタイトル不要、`routable: false` は必須。公開でリビジョンが 1 件できる。dev-bypass。widget が無いフィールドは JSON の入力欄になる | [[T02-playground\|T02]] |
| [[emdash-query-count-b64-images\|b64_images を ID の IN 句で取得するときのクエリ数]] | `docs/emdash-query-count-b64-images.md` | `getEmDashCollection` は 50 件まで 1 クエリ。バインド変数は ID 数 + 7(1 回 93 件まで)。上限を超えると `{ entries: [], error }` で黙って空になる。locale を省いたときの絞り込み。バイラインでの増え方 | [[T09-spike-query-count\|T09]] |
| [[emdash-after-save-payload\|EmDash 0.39.1 の content:afterSave に渡る内容と、操作ごとに呼ばれる hook]] | `docs/emdash-after-save-payload.md` | `content.data` は下書き、`liveData` は列の値。呼ばれるのは作成と更新だけ(公開・複製・ゴミ箱・復元では呼ばれない)。`errorPolicy`。`afterDelete` の形。プラグインの書き込みと hook | [[T10-spike-after-save\|T10]] |
| [[emdash-plugin-content-query-counts\|EmDash 0.39.1 のプラグイン content API のクエリ数]] | `docs/emdash-plugin-content-query-counts.md` | 参照元 1 件 1 / 3 / 6、画像の状態 2 / 5 / 3、アップロード 72(SQLite)。T21 の件数の決め方 | [[T10-spike-after-save\|T10]] |
| [[emdash-reference-vs-npm-0-38\|references/emdash と npm の emdash@0.38.0 のずれ]] | `docs/emdash-reference-vs-npm-0-38.md` | 参照ソースは 0.38.0 のあとの開発版だった。npm の 0.38.0 には `schema:read` などの capability が無い(0.39.1 に上げて解消) | [[T06-decision-trash-permission\|T06]] |
| [[emdash-plugin-route-permissions\|EmDash のプラグインルートの権限]] | `docs/emdash-plugin-route-permissions.md` | ルートの `permission` とロールごとの結果(0.38.0 と 0.39.1 で実測。結果は同じ)。省略すると Admin のみ。CSRF の確認は 2 か所。API トークンは `admin` スコープ。`ctx.content` は利用者の権限を確かめない。画面側のロールの取り方 | [[T06-decision-trash-permission\|T06]]、[[T08-spike-route-body\|T08]] |
| [[emdash-plugin-route-errors\|EmDash 0.39.1 のプラグインルートのエラーの返り方]] | `docs/emdash-plugin-route-errors.md` | `PluginRouteError` は `{ success: false, error: { code, message } }` と HTTP ステータスになる。`details` は応答に入らない。想定外の例外は `INTERNAL_ERROR` | [[T03-shared-contracts\|T03]] |
| [[emdash-plugin-route-body-limit\|EmDash 0.39.1 のプラグインルートの body 上限と、ルートの宣言の書き方]] | `docs/emdash-plugin-route-body-limit.md` | 既定 1 MiB は `request` を宣言したルートだけの上限(`maxBytes` で最大 8 MiB)。宣言しないと上限なし。判定の順番(401 → 403 → CSRF → 405 → 413 → 400)。アップロードのルートの雛形。CPU 時間。JSON の応答には上限が無い | [[T08-spike-route-body\|T08]] |
| [[emdash-plugin-preview-thumbnail-routes\|管理画面のプレビュー・サムネイル取得ルートのクエリ数・応答の大きさ・CPU 時間]] | `docs/emdash-plugin-preview-thumbnail-routes.md` | `preview` 10 件で 21 クエリ・最大 5MB・3.5ms、20 件は Workers Free の CPU 時間に届くので 10 件のまま。`getMany` は ID + 2 個のバインド変数を使い、99 件から例外になるので 50 件ずつ。見つからない画像は `null` | [[T17-admin-data-routes\|T17]] |
| [[emdash-plugin-content-api-constraints\|EmDash 0.39.1 のプラグイン API で、データの形に関わる制約]] | `docs/emdash-plugin-content-api-constraints.md` | エントリ ID は作成まで決まらない。seed の ID はそのまま使われる。`getTrashedVersioned` でゴミ箱を判定できる。`get` は 1 件 2 クエリ。widget に collection / entryId / locale は渡らない | [[T03-shared-contracts\|T03]] |
| [[emdash-admin-api-requests\|EmDash 0.39.1 の API を管理画面の部品から呼ぶときの送り方とエラーの形]] | `docs/emdash-admin-api-requests.md` | 同じオリジンの `/_emdash/api/...` を `X-EmDash-Request: 1` 付きの `fetch` で呼ぶ。未ログインはプラグインのルートが `UNAUTHORIZED`、標準 API が `NOT_AUTHENTICATED`。外部の認証の失敗は `text/plain`。`src/client/api.ts` のコードの決め方 | [[T14-admin-i18n-api\|T14]] |
| [[emdash-admin-locale-lang\|EmDash 0.39.1 の管理画面の言語と html の lang 属性]] | `docs/emdash-admin-locale-lang.md` | `<html lang>` は cookie `emdash-locale` → `Accept-Language` → `en` で決まる。設定画面で言語を変えると再読み込みせずに書き換わるので、`MutationObserver` で追随する | [[T14-admin-i18n-api\|T14]] |

## ライブラリ

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[zod-string-length-code-points\|zod 4.5 の文字列の長さはコードポイントで数える]] | `docs/zod-string-length-code-points.md` | `max` / `min` はコードポイント単位。data URL のスキーマは ASCII に限り、長さの上限をバイトの上限と一致させた | [[T03-shared-contracts\|T03]] |

## ブラウザ・画像処理

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[webp-data-url-validation\|WebP の data URL の検証]] | `docs/webp-data-url-validation.md` | `atob` / `fromBase64` は空白を読み飛ばす。O(1) の検査で不正な base64 を拒否する方法。WebP ヘッダーの検査(libwebp との比較)。Chromium の canvas は `VP8X` + `ICCP` で 482 バイト増える。約 100KB で 0.009〜0.15ms。テスト用の WebP は `tests/fixtures/webp/README.md` | [[T04-webp-utils\|T04]] |
| [[canvas-webp-encoding\|canvas の WebP エンコード(Chromium・Firefox と cwebp の比較)]] | `docs/canvas-webp-encoding.md` | 同じ画素ならエンコーダーの差は小さい。ずれの主因は縮小の方法(Firefox は `imageSmoothingQuality` が無い)。`createImageBitmap` の `resizeQuality: "high"` で縮小し、`minQuality` から探索する。時間・可逆になる画質・全データと再現のコード | [[T05-spike-canvas-webp\|T05]] |
| [[server-image-validation\|サーバー側の画像の検証(アップロードと画像エントリ)]] | `docs/server-image-validation.md` | 保存先は widget と `json` 型の両方で判定する。長さはデコードする前に確かめる。サムネイルは長辺 96px まで(小さなデータで大きな寸法を作れる)。画像エントリは固定上限。境界値の WebP の作り方。検証全体は 0.40ms / 0.93ms | [[T11-server-validation\|T11]] |
| [[compress-image-browser-check\|圧縮処理(compressImage・createThumbnail)を Chromium・Firefox で動かした結果]] | `docs/compress-image-browser-check.md` | 写真 5 枚の結果は T05 の表と長辺・画質・エンコード回数まで一致した。中断は 0.4ms 以内に reject。透過は保持される。乱数ノイズの画像は Chromium の GPU 描画だけ上限を超えた | [[T13-encode-search\|T13]] |
| [[jsdom-browser-api-gaps\|jsdom でブラウザ側の画像処理をテストするときの注意]] | `docs/jsdom-browser-api-gaps.md` | jsdom 30.1.0 には `createImageBitmap`・`OffscreenCanvas` が無く、canvas の `getContext` は `null`。canvas の部分は差し替えられるように作り、偽物でテストする。`abort()` の `reason` は Node の `DOMException` | [[T13-encode-search\|T13]] |

## Cloudflare

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[cloudflare-workers-free-d1-limits\|Workers Free で D1 に送れるクエリ数と、1 日の上限]] | `docs/cloudflare-workers-free-d1-limits.md` | Free はサブリクエストが外部 50・Cloudflare のサービス 1,000 / 呼び出し(D1 は後者)。D1 のページの「50」と食い違う。D1 Free の 1 日の上限(読み 500 万・書き 10 万行)は 2026-09-01 から厳密に適用 | [[T10-1-spec-d1-limits\|T10-1]] |
