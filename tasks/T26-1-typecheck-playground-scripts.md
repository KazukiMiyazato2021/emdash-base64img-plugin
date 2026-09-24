---
id: T26-1
title: "playground のスクリプトも npm run typecheck で検査する"
type: 実装
status: done
wave: 3
parent: "[[T26-playground-pages]]"
depends_on:
  - "[[T26-playground-pages]]"
soft_depends_on: []
blocks: []
files:
  - "tsconfig.json(include だけ)"
  - "docs/test-lint-setup.md(TypeScript の節)"
  - "docs/npm-workspaces-nested-worktree.md(tsc の行)"
  - "tasks/T26-1-typecheck-playground-scripts.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - impl
  - tooling
  - subtask
created: 2026-09-24
---

# T26-1 playground のスクリプトも npm run typecheck で検査する

> [!info] 概要
> - 種別: 実装(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-26-1`
> - 親タスク: [[T26-playground-pages|T26]]
> - 着手の条件(依存): [[T26-playground-pages|T26]]
> - このタスクを待つもの: なし
> - 仕様: [[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15 章]]

## 目的

T26 が作った `playground/scripts/create-sample-posts.ts` を、`npm run typecheck`(`build` と `verify` から呼ばれる)の型チェックの対象にする。

## 発生した理由

- このスクリプトは、Node が型の注釈を取り除いて実行する(`node playground/scripts/create-sample-posts.ts`)。実行では型を確かめない。
- ルートの `tsconfig.json` の `include` は `src` / `tests` / `e2e` / `*.config.ts` で、`playground/scripts` が無い。T26 は手で `tsc` を通して 0 件だったが、あとの変更で型が崩れても `npm run verify` では気付けない。
- `tsconfig.json` は T26 の変更してよいファイルではなかったので、T26 は足さずに報告した([[T26-playground-pages#未解決・サブタスクの候補|T26 の未解決 1]])。

## 作業内容

- [x] ルートの `tsconfig.json` の `include` に `playground/scripts` を足す
- [x] スクリプトの型の誤りを `tsc` が見つけることを確かめる
- [x] 知見ノートの TypeScript の設定の記述を直す

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T21-orphan-routes|T21]]・[[T23-upload-hook|T23]]・[[T24-list-column|T24]])は、これらのファイルを変更しない。

## 結果

- `include` を `["src", "tests", "e2e", "playground/scripts", "*.config.ts"]` にした。`tsc --noEmit` は 0 件のまま通った。根拠: **実測のみ**
- スクリプトに型の誤り(`const MAX_STORED_BYTES: number = "100000"`)を一時的に入れると、`tsc --noEmit` が TS2322 で失敗した。元に戻して通ることを確かめた。根拠: **実測のみ**
- `tsc --noEmit --listFilesOnly` で、`playground` から読み込まれるのはこのスクリプトだけだった(`playground/node_modules` は空で、`@playwright/test` はルートの `node_modules` から読む)。根拠: **実測のみ**(メインの作業ディレクトリで確かめた。入れ子の worktree でも、worktree の `node_modules` から読む見込み。推測のみ)
- 利用者向けの 2 つの設定(`tsconfig.consumer-loose.json`・`tsconfig.consumer-strict.json`)は `include` を `src` だけに上書きしているので、変わらない。
- ルートの `package.json` に script(入力画像やサンプルの投稿を作るもの)を足すかは、このタスクでは扱わない。E2E の実行の仕組みを作る [[T31-e2e|T31]] が `package.json` を変えるときに合わせて決める(1 つのフェーズで `package.json` を変えるタスクは 1 つに限るため)。
