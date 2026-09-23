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

## EmDash

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[emdash-dependency-versions\|EmDash に合わせた依存パッケージの版]] | `docs/emdash-dependency-versions.md` | `emdash` / `@emdash-cms/admin` は 0.39.1、peer は `^0.39.0`。kumo は 2.6.0。0.38.0 から上げた経緯と、`min-release-age` の例外の手順・監査結果 | [[T01-scaffold\|T01]]、[[T01-2-emdash-0-39\|T01-2]] |
| [[emdash-native-plugin-entrypoints\|EmDash の native プラグインの入口]] | `docs/emdash-native-plugin-entrypoints.md` | descriptor の必須項目、名前付き export の `createPlugin`、`adminEntry` と `admin.entry` の違い(0.38.0 と 0.39.1 で同じ) | [[T01-scaffold\|T01]] |
| [[emdash-reference-vs-npm-0-38\|references/emdash と npm の emdash@0.38.0 のずれ]] | `docs/emdash-reference-vs-npm-0-38.md` | 参照ソースは 0.38.0 のあとの開発版だった。npm の 0.38.0 には `schema:read` などの capability が無い(0.39.1 に上げて解消) | [[T06-decision-trash-permission\|T06]] |
| [[emdash-plugin-route-permissions\|EmDash のプラグインルートの権限]] | `docs/emdash-plugin-route-permissions.md` | ルートの `permission` とロールごとの結果(0.38.0 で実測)。省略すると Admin のみ。`ctx.content` は利用者の権限を確かめない。画面側のロールの取り方 | [[T06-decision-trash-permission\|T06]] |

## ブラウザ・画像処理

| ノート | パス | 内容 | 元のタスク |
|---|---|---|---|
| [[webp-data-url-validation\|WebP の data URL の検証]] | `docs/webp-data-url-validation.md` | `atob` / `fromBase64` は空白を読み飛ばす。O(1) の検査で不正な base64 を拒否する方法。WebP ヘッダーの検査(libwebp との比較)。Chromium の canvas は `VP8X` + `ICCP` で 482 バイト増える。約 100KB で 0.009〜0.15ms。テスト用の WebP は `tests/fixtures/webp/README.md` | [[T04-webp-utils\|T04]] |

## Cloudflare

まだ無い。
