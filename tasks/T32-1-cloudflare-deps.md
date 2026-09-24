---
id: T32-1
title: "playground に Cloudflare 用の依存を入れる"
type: 環境
status: done
wave: 6
parent: "[[T32-cloudflare-check]]"
depends_on:
  - "[[T30-admin-entry]]"
soft_depends_on: []
blocks:
  - "[[T32-cloudflare-check]]"
files:
  - "playground/package.json(dependencies・devDependencies)"
  - "package-lock.json"
  - "docs/emdash-dependency-versions.md(Cloudflare 用の依存の節)"
  - "docs/npm-workspaces-nested-worktree.md(Cloudflare 用の依存の行)"
  - "tasks/T32-cloudflare-check.md(依存の注記と、変更してよいファイル)"
  - "tasks/T32-1-cloudflare-deps.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - env
  - subtask
created: 2026-09-24
---

# T32-1 playground に Cloudflare 用の依存を入れる

> [!info] 概要
> - 種別: 環境(予定外のサブタスク) / ウェーブ: 6 / ブランチ: `phase-6/t-32-1`
> - 親タスク: [[T32-cloudflare-check|T32]]
> - 着手の条件(依存): [[T30-admin-entry|T30]](フェーズ 5 のあと)
> - このタスクを待つもの: [[T32-cloudflare-check|T32]]

## 目的

T32 が playground を Cloudflare(workerd + D1)で動かせるように、Cloudflare 用の依存を playground に入れる。

## 発生した理由

- T32 の変更してよいファイルは、Cloudflare 用の設定だけだった。依存はまだ入っていなかった([[npm-workspaces-nested-worktree#ロックファイルは 1 つ]])。
- `@emdash-cms/cloudflare` の 0.39.1 は、公開から 3 日未満で、利用者の了承した `min-release-age` の例外(`emdash` と `@emdash-cms/*` の 0.39.1 だけ)で入れる必要があった。例外の範囲を守るため、リーダーが入れた。
- ロックファイルは 1 つ(ルートの `package-lock.json`)なので、同時に動く T31・T33 と衝突しないよう、T32 を始める前に入れた。

## 作業内容

- [x] 通常の設定(`min-release-age=3`)で `@astrojs/cloudflare`(`dependencies`)、`wrangler`・`@cloudflare/workers-types`(`devDependencies`)を入れる
- [x] 例外として `@emdash-cms/cloudflare@0.39.1` だけを `npm install -w playground --min-release-age=0 --save-exact` で入れる
- [x] ロックファイルの差分を監査する(公開から 3 日未満の版が EmDash の外に入っていないこと)
- [x] 知見ノート [[emdash-dependency-versions]] と [[npm-workspaces-nested-worktree]] に、入れた版と監査の結果を書く
- [x] [[T32-cloudflare-check|T32]] のノートに、依存を入れたことと、変更してよいファイル(`playground/src/worker.ts`・`playground/package.json` の scripts)を足す

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T31-e2e|T31]]・[[T33-readme|T33]])は、これらのファイルを変更しない。

## 結果

| パッケージ | 版 | 入れ方 |
|---|---|---|
| `@astrojs/cloudflare` | 14.3.2 | 通常の設定 |
| `@emdash-cms/cloudflare` | 0.39.1 | 例外(このパッケージだけ) |
| `wrangler` | 4.135.0 | 通常の設定 |
| `@cloudflare/workers-types` | 5.20260921.1 | 通常の設定 |

- 監査: ロックファイルに追加された 62 項目のうち、公開から 3 日未満は `@emdash-cms/cloudflare@0.39.1` だけ(EmDash の外は 0 個)。`overrides` は要らなかった。根拠: **実測のみ**(scratchpad の監査のスクリプトで、npm registry の公開日時を調べた。2026-09-24 11:31 UTC)
- `npm ls -w playground --depth=0` で、足した 4 つが入っていることを確かめた。`wrangler --version` は 4.135.0。根拠: **実測のみ**
- `npm run verify`: build・lint・test が通った(テスト 25 ファイル・1,868 件)。Cloudflare 用の設定と `src/worker.ts` はまだ無いので、Cloudflare でのビルドは T32 で行う。
- 詳しくは [[emdash-dependency-versions#Cloudflare 用の依存(2026-09-24)]]。
