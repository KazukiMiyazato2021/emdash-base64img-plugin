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

## EmDash

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[emdash-dependency-versions\|EmDash に合わせた依存パッケージの版]] | `docs/emdash-dependency-versions.md` | `emdash` / `@emdash-cms/admin` は 0.39.1、peer は `^0.39.0`。kumo は 2.6.0。0.38.0 から上げた経緯と、`min-release-age` の例外の手順・監査結果 | [[T01-scaffold\|T01]]、[[T01-2-emdash-0-39\|T01-2]] |
| [[emdash-native-plugin-entrypoints\|EmDash の native プラグインの入口]] | `docs/emdash-native-plugin-entrypoints.md` | descriptor の必須項目、名前付き export の `createPlugin`、`adminEntry` と `admin.entry` の違い(0.38.0 と 0.39.1 で同じ) | [[T01-scaffold\|T01]] |
| [[emdash-playground-site-config\|storage を指定しない EmDash サイト(Node + SQLite)の設定とビルド]] | `docs/emdash-playground-site-config.md` | storage を省略すると local storage が既定になる。`fonts: false` の不具合と回避策。`astro build` の挙動(約 2 秒、DB・ネットワーク不要)。生成されるファイル | [[T02-playground\|T02]] |
| [[emdash-seed-and-b64-images\|EmDash の seed の適用と b64_images の最小構成]] | `docs/emdash-seed-and-b64-images.md` | seed が適用される時期と条件。`b64_images` はタイトル不要、`routable: false` は必須。公開でリビジョンが 1 件できる。dev-bypass。widget が無いフィールドは JSON の入力欄になる | [[T02-playground\|T02]] |
| [[emdash-query-count-b64-images\|b64_images を ID の IN 句で取得するときのクエリ数]] | `docs/emdash-query-count-b64-images.md` | `getEmDashCollection` は 50 件まで 1 クエリ。バインド変数は ID 数 + 7(1 回 93 件まで)。上限を超えると `{ entries: [], error }` で黙って空になる。locale を省いたときの絞り込み。バイラインでの増え方 | [[T09-spike-query-count\|T09]] |
| [[emdash-reference-vs-npm-0-38\|references/emdash と npm の emdash@0.38.0 のずれ]] | `docs/emdash-reference-vs-npm-0-38.md` | 参照ソースは 0.38.0 のあとの開発版だった。npm の 0.38.0 には `schema:read` などの capability が無い(0.39.1 に上げて解消) | [[T06-decision-trash-permission\|T06]] |
| [[emdash-plugin-route-permissions\|EmDash のプラグインルートの権限]] | `docs/emdash-plugin-route-permissions.md` | ルートの `permission` とロールごとの結果(0.38.0 で実測)。省略すると Admin のみ。`ctx.content` は利用者の権限を確かめない。画面側のロールの取り方 | [[T06-decision-trash-permission\|T06]] |
| [[emdash-plugin-route-errors\|EmDash 0.39.1 のプラグインルートのエラーの返り方]] | `docs/emdash-plugin-route-errors.md` | `PluginRouteError` は `{ success: false, error: { code, message } }` と HTTP ステータスになる。`details` は応答に入らない。想定外の例外は `INTERNAL_ERROR` | [[T03-shared-contracts\|T03]] |
| [[emdash-plugin-content-api-constraints\|EmDash 0.39.1 のプラグイン API で、データの形に関わる制約]] | `docs/emdash-plugin-content-api-constraints.md` | エントリ ID は作成まで決まらない。seed の ID はそのまま使われる。`getTrashedVersioned` でゴミ箱を判定できる。`get` は 1 件 2 クエリ。widget に collection / entryId / locale は渡らない | [[T03-shared-contracts\|T03]] |

## ライブラリ

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[zod-string-length-code-points\|zod 4.5 の文字列の長さはコードポイントで数える]] | `docs/zod-string-length-code-points.md` | `max` / `min` はコードポイント単位。data URL のスキーマは ASCII に限り、長さの上限をバイトの上限と一致させた | [[T03-shared-contracts\|T03]] |

## ブラウザ・画像処理

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[webp-data-url-validation\|WebP の data URL の検証]] | `docs/webp-data-url-validation.md` | `atob` / `fromBase64` は空白を読み飛ばす。O(1) の検査で不正な base64 を拒否する方法。WebP ヘッダーの検査(libwebp との比較)。Chromium の canvas は `VP8X` + `ICCP` で 482 バイト増える。約 100KB で 0.009〜0.15ms。テスト用の WebP は `tests/fixtures/webp/README.md` | [[T04-webp-utils\|T04]] |
| [[canvas-webp-encoding\|canvas の WebP エンコード(Chromium・Firefox と cwebp の比較)]] | `docs/canvas-webp-encoding.md` | 同じ画素ならエンコーダーの差は小さい。ずれの主因は縮小の方法(Firefox は `imageSmoothingQuality` が無い)。`createImageBitmap` の `resizeQuality: "high"` で縮小し、`minQuality` から探索する。時間・可逆になる画質・全データと再現のコード | [[T05-spike-canvas-webp\|T05]] |

## Cloudflare

まだ無い。
