---
id: T01
title: "リポジトリの雛形を作る"
type: 実装
status: todo
wave: 0
depends_on: []
soft_depends_on: []
blocks:
  - "[[T02-playground]]"
  - "[[T03-shared-contracts]]"
  - "[[T04-webp-utils]]"
  - "[[T05-spike-canvas-webp]]"
files:
  - "package.json"
  - "package-lock.json"
  - "playground/package.json(仮)"
  - "tsconfig.json"
  - ".oxlintrc.json"
  - ".prettierrc"
  - "vitest.config.ts"
  - ".gitignore"
  - "src/index.ts(仮実装)"
  - "src/admin.tsx(仮実装)"
  - "src/astro.ts(仮実装)"
  - "src/{server,client,admin,site,shared}/"
  - "tests/"
  - "e2e/"
  - "spikes/"
spec:
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - impl
  - setup
created: 2026-09-23
---

# T01 リポジトリの雛形を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 0
> - 着手の条件(依存): なし
> - このタスクを待つもの: [[T02-playground|T02]]、[[T03-shared-contracts|T03]]、[[T04-webp-utils|T04]]、[[T05-spike-canvas-webp|T05]]
> - 仕様: [[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14章]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15章]]

## 目的

すべてのタスクの土台を作る。パッケージ構成、ツール、仮の入口ファイルを用意し、後続のタスクが並列に着手できる状態にする。

## 作業内容

- [ ] ルートの `package.json`: name `emdash-plugin-base64-image`、`type: module`、`exports`(`.` → `./src/index.ts`、`./admin` → `./src/admin.tsx`、`./astro` → `./src/astro.ts`)、`files: ["src"]`
- [ ] peer dependency: `emdash ^0.38.0`、`react`、`@cloudflare/kumo`、`@emdash-cms/admin`
- [ ] npm workspaces(ルートと `playground/`)。`playground/package.json` は仮のファイルだけ作る(中身は [[T02-playground|T02]])
- [ ] 後続タスクで必要になる依存パッケージを、ここでまとめて入れる(zod、react / react-dom、`@cloudflare/kumo`、`@emdash-cms/admin`、`emdash`、vitest、jsdom、Testing Library、`@playwright/test` など)。後続タスクが `package.json` / `package-lock.json` を同時に変更して衝突するのを防ぐため
- [ ] TypeScript(strict)、oxlint、prettier、vitest の設定と npm scripts(`typecheck` / `lint` / `format` / `test`)
- [ ] ディレクトリ: `src/{server,client,admin,site,shared}`、`tests/`、`e2e/`、`spikes/`
- [ ] 入口ファイルの仮実装: `src/index.ts`(`definePlugin({ id: "base64-image", version: "0.0.0" })` と descriptor 関数 `base64ImagePlugin()`)、`src/admin.tsx`(空の `fields`)、`src/astro.ts`(空)
- [ ] `.gitignore`(`node_modules`、playground のデータベースファイルなど)

## 完了条件

- [ ] `npm install` / `npm run typecheck` / `npm run lint` / `npm test`(テスト0件でも成功)が通る
- [ ] `exports` の3つの入口が解決できる

## 変更してよいファイル

- `package.json`
- `package-lock.json`
- `playground/package.json`(仮)
- `tsconfig.json`
- `.oxlintrc.json`
- `.prettierrc`
- `vitest.config.ts`
- `.gitignore`
- `src/index.ts`(仮実装)
- `src/admin.tsx`(仮実装)
- `src/astro.ts`(仮実装)
- `src/{server,client,admin,site,shared}/`
- `tests/`
- `e2e/`
- `spikes/`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## メモ

- `references/` はすでに git 管理外。
- `mise.toml` の Node 26.10.0 / npm 12.0.2 を使う。
