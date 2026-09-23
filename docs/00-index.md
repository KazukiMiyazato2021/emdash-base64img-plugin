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
| [[emdash-0-38-dependency-versions\|EmDash 0.38.0 に合わせた依存パッケージの版]] | `docs/emdash-0-38-dependency-versions.md` | `emdash` / `@emdash-cms/admin` は 0.38.0 に固定し、peer は `^0.38.0`(0.39.x を含まない)。kumo は 2.6.0。`~/.npmrc` の `min-release-age=3` の影響 | [[T01-scaffold\|T01]] |
| [[emdash-native-plugin-entrypoints\|EmDash 0.38.0 の native プラグインの入口]] | `docs/emdash-native-plugin-entrypoints.md` | descriptor の必須項目、名前付き export の `createPlugin`、`adminEntry` と `admin.entry` の違い | [[T01-scaffold\|T01]] |

## ブラウザ・画像処理

まだ無い。

## Cloudflare

まだ無い。
