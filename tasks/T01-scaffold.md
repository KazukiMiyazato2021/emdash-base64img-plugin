---
id: T01
title: "リポジトリの雛形を作る"
type: 実装
status: done
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
  - "mise.toml"
  - "tsconfig.json"
  - ".oxlintrc.json"
  - ".prettierrc"
  - ".prettierignore"
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

- [x] ルートの `package.json`: name `emdash-plugin-base64-image`、`type: module`、`exports`(`.` → `./src/index.ts`、`./admin` → `./src/admin.tsx`、`./astro` → `./src/astro.ts`)、`files: ["src"]`
  - 追加で `private: true`(npm に公開しないため)、`main: ./src/index.ts`(公式の color プラグインと同じ)を書いた。
- [x] peer dependency: `emdash ^0.38.0`、`react`、`@cloudflare/kumo`、`@emdash-cms/admin`
  - 範囲は `@emdash-cms/admin ^0.38.0`、`@cloudflare/kumo 2.6.0`、`react ^18.0.0 || ^19.0.0`。理由は [[#結果]]。
- [x] npm workspaces(ルートと `playground/`)。`playground/package.json` は仮のファイルだけ作る(中身は [[T02-playground|T02]])
  - 仮のファイルに、playground の依存(`astro`、`@astrojs/node`、`@astrojs/react`、`emdash`、`react`、`react-dom`、`file:..` でこのプラグイン)だけを入れた。スクリプトや seed の設定は T02 が書く。理由は [[#結果]]。
- [x] 後続タスクで必要になる依存パッケージを、ここでまとめて入れる(zod、react / react-dom、`@cloudflare/kumo`、`@emdash-cms/admin`、`emdash`、vitest、jsdom、Testing Library、`@playwright/test` など)。後続タスクが `package.json` / `package-lock.json` を同時に変更して衝突するのを防ぐため
  - Cloudflare 用の依存(`@astrojs/cloudflare`、`@emdash-cms/cloudflare`、`wrangler`)は入れていない。[[T32-cloudflare-check|T32]] の前に追加が必要。
- [x] TypeScript(strict)、oxlint、prettier、vitest の設定と npm scripts(`typecheck` / `lint` / `format` / `test`)
  - リーダーの指定で `build` と `verify` も追加した。
- [x] ディレクトリ: `src/{server,client,admin,site,shared}`、`tests/`、`e2e/`、`spikes/`
- [x] 入口ファイルの仮実装: `src/index.ts`(`definePlugin({ id: "base64-image", version: "0.0.0" })` と descriptor 関数 `base64ImagePlugin()`)、`src/admin.tsx`(空の `fields`)、`src/astro.ts`(空)
  - EmDash 0.38.0 に合わせて、`src/index.ts` から名前付きの `createPlugin()` も export した(native 形式ではこれが呼ばれる)。
- [x] `.gitignore`(`node_modules`、playground のデータベースファイルなど)
- [x] (リーダーの指定)`mise.toml`(Node 26.10.0 / npm 12.0.2)
- [x] (リーダーの指定)Playwright のブラウザを導入する(`npx playwright install chromium firefox`)
- [x] (リーダーの指定)つまずいた点を `docs/` に知見ノートとして書く

## 完了条件

- [x] `npm install` / `npm run typecheck` / `npm run lint` / `npm test`(テスト0件でも成功)が通る
  - `npm run verify`(build + lint + test)が通った。テストは 2 ファイル・7 件。テストに一致するファイルが 0 件のときも終了コード 0 になることを確かめた。
- [x] `exports` の3つの入口が解決できる

## 変更してよいファイル

- `package.json`
- `package-lock.json`
- `playground/package.json`(仮)
- `mise.toml`(リーダーの指定で追加)
- `tsconfig.json`
- `.oxlintrc.json`
- `.prettierrc`
- `.prettierignore`(リーダーの指定で追加)
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

## 結果

> [!summary] まとめ
> - `npm run verify` が通る雛形を作った(build・lint・test とも成功、テスト 7 件)。
> - `exports` の 3 つの入口は、Node(自己参照と playground からのリンク経由)・TypeScript・vitest のいずれでも解決できた。
> - 知見ノート: [[emdash-0-38-dependency-versions]]、[[npm-workspaces-nested-worktree]]、[[emdash-native-plugin-entrypoints]]、[[test-lint-setup]]

### 入口の形(EmDash 0.38.0)

- native 形式のプラグインは、EmDash が生成する仮想モジュールで `import { createPlugin } from "<entrypoint>"` され、`createPlugin(options)` が呼ばれる。タスクの作業内容にあった `definePlugin(...)` と `base64ImagePlugin()` に加えて、名前付きの `createPlugin` の export が必要。根拠: **公式ドキュメントのみ**(`references/emdash/packages/core/src/astro/integration/virtual-modules.ts:303`)
- descriptor は `{ id, version, entrypoint: "emdash-plugin-base64-image", options: {}, adminEntry: "emdash-plugin-base64-image/admin" }`。`PluginDescriptor` の必須は `id` / `version` / `entrypoint`。根拠: **公式ドキュメントのみ**(`references/emdash/packages/core/src/astro/integration/runtime.ts:84`)
- `definePlugin` には `admin: { entry: "emdash-plugin-base64-image/admin" }` も書いた。実行時にこれがあると、管理画面のマニフェストが `adminMode: "react"` になる。公式の color プラグインも両方に書いている。根拠: **公式ドキュメントのみ**(`references/emdash/packages/core/src/emdash-runtime.ts:2917`、`references/emdash/packages/plugins/color/src/index.ts:23`)
- `tests/package-exports.test.ts` で、descriptor と `package.json` の `name` / `exports`、`createPlugin()` の `id` / `version` / `admin.entry` の一致を確かめている。`adminEntry` をわざと `…/admin.tsx` に変えると失敗した。根拠: **実測のみ**

### exports の解決

| 方法 | 結果 | 根拠 |
|---|---|---|
| Node の自己参照(`node_modules` なしで `package.json` と `src/` だけを置いた場所) | 3 つとも `src/` のファイルに解決。`exports` に無いパスは `ERR_PACKAGE_PATH_NOT_EXPORTED` | **実測のみ** |
| playground から(`node_modules/emdash-plugin-base64-image -> ..` 経由) | 3 つとも、ルートの `src/` のファイルに解決 | **実測のみ** |
| TypeScript(`moduleResolution: bundler`) | `.` / `./admin` / `./astro` を import するテストの型チェックが通る | **実測のみ** |
| vitest | 同じテストが通る | **実測のみ** |
| `npm pack --dry-run` | 配布物は `package.json` と `src/` だけ(9 ファイル) | **実測のみ** |

### 依存パッケージの版

詳細は [[emdash-0-38-dependency-versions]]。

- `emdash` / `@emdash-cms/admin` は devDependencies で `0.38.0` に固定し、peer は `^0.38.0`。`^0.38.0` は 0.39.x(latest の 0.39.1 を含む)も、npm にある deprecated の 1.0.0 も含まない。根拠: **実測のみ**(`semver.satisfies`、`npm view`)
- `@cloudflare/kumo` は `2.6.0` に固定(peer も)。`@emdash-cms/admin` 0.38.0 が `2.6.0` に完全一致で依存しており、EmDash は Kumo の版に合わせて管理画面の CSS を作っているため。根拠: **公式ドキュメントのみ**(`references/emdash/pnpm-workspace.yaml:97-102`)+ `npm view` の **実測**
- react / react-dom は 19.2.4、`@types/react` 19.2.14、`@types/react-dom` 19.2.3(EmDash 0.38.0 の catalog と同じ)。peer の `react` は `@emdash-cms/admin` 0.38.0 と同じ `^18.0.0 || ^19.0.0`。
- `zod` は dependencies に `^4.5.4`。ロックは `emdash` が依存する 4.5.4 に揃え、`node_modules/zod` を 1 つにした。根拠: **実測のみ**
- `astro ^7.3.2` と `@astrojs/react ^6.0.5` を明示した。`emdash` の省略できない peer なので、書かないと npm が最新(`@astrojs/react` 7.0.0。peer が増えている)を入れる。根拠: **実測のみ**
- TypeScript は 6.0.3(latest は 7.0.2)、vitest は 4.1.11(latest は 5.0.1)。EmDash 0.38.0 の catalog と同じメジャーにした。根拠: **推測のみ**(周辺ツールとの相性を優先した判断)
- 利用者の `~/.npmrc` に `min-release-age=3` と `ignore-scripts=true` がある。公開から 3 日未満の jsdom 30.1.1・oxlint 1.85.0・prettier 3.9.9 は `ETARGET` で入らなかったので、1 つ前の版にした。スクリプトを持つ `esbuild` と `fsevents` は、スクリプトなしで動いた。根拠: **実測のみ**

### playground/package.json に依存を先に入れた理由

- npm workspaces のロックファイルはルートの 1 つだけで、playground の依存もそこに記録される。[[T02-playground|T02]] の「変更してよいファイル」は `playground/**` だけなので、T02 が依存を足すとロックファイルの変更が必要になる。根拠: **実測のみ**
- そのため、EmDash のテンプレート(`references/emdash/templates/blog/package.json`)と同じ依存を先に入れた。T02 がスクリプトや `emdash.seed` を足すだけなら、ロックファイルは変わらない。
- ルートのプラグインは `"emdash-plugin-base64-image": "file:.."` で参照する。npm 12 は `node_modules/emdash-plugin-base64-image -> ..`(ルート自身へのリンク)を作る。根拠: **実測のみ**。詳細は [[npm-workspaces-nested-worktree]]。

### テスト・lint の設定

詳細は [[test-lint-setup]]。

- vitest 4.1.11 には `environmentMatchGlobs` が無いので、`test.projects` で node と dom(jsdom)に分けた。`tests/admin/**` と `tests/client/**` が jsdom。根拠: **実測のみ**
- globals を使わないので、Testing Library の自動クリーンアップが働かない。`tests/setup/dom.ts` で `cleanup()` を明示した。消すとテストが失敗することを確かめた。根拠: **実測のみ**
- lint は `oxlint --deny-warnings`(警告も失敗)。`src/**` では `Buffer` / `process` / `node:*` などを禁止した(`src` はブラウザと Workers で動くため)。
- 対象範囲: vitest は `tests/**/*.test.{ts,tsx}`、tsc は `src` / `tests` / `e2e` / `*.config.ts`。oxlint と prettier は `references/`・`.claude/`・playground のビルド出力・`spikes/`・`plans/`・`tasks/`・`docs/` を除外した。各場所に lint エラーのあるファイルを置いて、除外されることを確かめた。根拠: **実測のみ**
- tsconfig の `include` には、リーダーの指定(src / tests / 設定ファイル)に加えて `e2e` を入れた。[[T31-e2e|T31]] の E2E テストも型チェックするため。
- 仕様書 15 章は「lint と format は EmDash と同じ oxlint + prettier」としているが、EmDash 0.38.0 は `.astro` 以外の整形に oxfmt を使っている(`references/emdash/.prettierignore:1-3`)。指定どおり prettier にした。根拠: **公式ドキュメントのみ**

### Playwright のブラウザ

- `@playwright/test` 1.63.0 で `npx playwright install chromium firefox` を実行し、Chromium 153.0.8010.12(`chromium-1243`、headless shell も)と Firefox 155.0(`firefox-1543`)を `~/Library/Caches/ms-playwright` に入れた。両方とも起動できた。根拠: **実測のみ**
- `@playwright/test` は `1.63.0` に固定した。版が変わるとブラウザの入れ直しが必要になるため。

### 仕様書の更新

- 14 章の peer dependency に、決めた範囲(`@emdash-cms/admin` / `@cloudflare/kumo` / `react`)と、dependency の `zod` を追記した。

### 後続タスクへの影響

- [[T02-playground|T02]]: playground の依存は入れてある。スクリプト(`dev` / `build`)を足すと、ルートの `npm run build` にも含まれる。依存を増やす場合は、ロックファイルの変更が必要になる。
- [[T04-webp-utils|T04]]: tsconfig の `lib` に `esnext.typedarrays` を入れたので、`Uint8Array.fromBase64` の型が使える。`src/**` では `Buffer` を使えない。
- [[T11-server-validation|T11]]〜[[T21-orphan-routes|T21]]: vitest の node 環境で `emdash` を import できる。
- [[T12-input-decode|T12]]・[[T13-encode-search|T13]]・[[T22-widget-parts|T22]]〜[[T28-gallery-widget|T28]]: `tests/client/**` と `tests/admin/**` は jsdom で動き、jest-dom のマッチャーが使える。`describe` などは `vitest` から import する。
- [[T32-cloudflare-check|T32]]: Cloudflare 用の依存が未導入。依存を追加する小さな変更が先に必要。
