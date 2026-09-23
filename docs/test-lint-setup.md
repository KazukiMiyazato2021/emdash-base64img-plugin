---
title: テスト・lint・E2E の設定
aliases:
  - vitest の設定
  - oxlint と prettier の設定
tags:
  - docs
  - test
  - lint
  - vitest
  - oxlint
source_task: "[[T01-scaffold]]"
created: 2026-09-23
updated: 2026-09-24
---

# テスト・lint・E2E の設定

> [!summary] 要点
> - vitest 4.1.11 には `environmentMatchGlobs` が無い。`test.projects` で「node」と「dom」(jsdom)の 2 つに分けた。`tests/admin/**` と `tests/client/**` が jsdom。
> - vitest の globals を使わないので、Testing Library の自動クリーンアップは働かない。`tests/setup/dom.ts` で `cleanup()` を明示している。
> - `npm run lint` は `oxlint --deny-warnings && prettier --check .`。警告も失敗になる。`src/**` では Node.js 専用の API(`Buffer`、`process`、`node:*`)を禁止した。
> - Playwright 1.63.0 のブラウザ(Chromium 153.0.8010.12 / Firefox 155.0)を導入済み。
> - 関連: [[T01-scaffold]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15 章]]

## npm scripts

| script | 中身 |
|---|---|
| `typecheck` | `tsc --noEmit` |
| `build` | `npm run typecheck && npm run build --workspaces --if-present`(playground に `build` があれば、それも実行する) |
| `lint` | `oxlint --deny-warnings && prettier --check .` |
| `format` | `prettier --write .` |
| `test` | `vitest run` |
| `verify` | `npm run build && npm run lint && npm test`(各タスクの最終確認) |

## vitest(4.1.11)

- `environmentMatchGlobs` は、入れた vitest 4.1.11 の型定義に存在しない。パスごとに環境を変えるには `test.projects` を使う。根拠: **実測のみ**(`node_modules/vitest/dist` の型定義を検索)
- `passWithNoTests` はプロジェクトごとには設定できない(`NonProjectOptions` に含まれる)。ルートの `test` に書いた。テストに一致するファイルが 0 件でも終了コード 0 になった。根拠: **実測のみ**
- プロジェクト:

| 名前 | 環境 | include | setupFiles |
|---|---|---|---|
| `node` | node | `tests/**/*.test.{ts,tsx}`(dom の対象を除く) | なし |
| `dom` | jsdom | `tests/admin/**/*.test.{ts,tsx}`、`tests/client/**/*.test.{ts,tsx}` | `tests/setup/dom.ts` |

- `--reporter=verbose` で、各テストが `|node|` / `|dom|` のどちらで動いたかが表示される。根拠: **実測のみ**
- `describe` / `it` / `expect` / `vi` は `vitest` から import する(globals は使わない)。
- `@vitejs/plugin-react` を入れなくても、TSX(`jsx: "react-jsx"`)のテストは動いた。根拠: **実測のみ**
- vitest の node 環境で `emdash` のメインの入口(`definePlugin`)を import できた。根拠: **実測のみ**

### Testing Library の後片付け

`@testing-library/react` は、`afterEach` がグローバルにあるときだけ、自動で `cleanup()` を登録する(`node_modules/@testing-library/react/dist/index.js:26`。根拠: **公式ドキュメントのみ**)。globals を使っていないので、`tests/setup/dom.ts` で明示した。

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
	cleanup();
});
```

- `cleanup()` の行を消すと、`tests/admin/test-environment.test.tsx` の「前のテストで描画した DOM が片付けられている」が失敗した。根拠: **実測のみ**
- `@testing-library/jest-dom` 7.0.1 は `./vitest` の入口を持ち、`@testing-library/dom`(`>=10 <11`)を peer に要求する。根拠: **実測のみ**(`npm view`)

## TypeScript

- `strict` に加えて `noUncheckedIndexedAccess` / `noImplicitOverride` / `verbatimModuleSyntax` / `isolatedModules` をオンにした(EmDash の `tsconfig.base.json` とほぼ同じ)。
- `lib` は `es2024` / `esnext.typedarrays` / `dom` / `dom.iterable`。TypeScript 6.0.3 では `Uint8Array.fromBase64` の型が `lib.esnext.typedarrays.d.ts` にある([[T04-webp-utils]] で使える)。根拠: **実測のみ**
- `include` は `src` / `tests` / `e2e` / `*.config.ts`。`types` は `["node"]`([[npm-workspaces-nested-worktree#TypeScript の @types の探し方]])。

## oxlint(1.83.0)

- プラグイン: `typescript` / `unicorn` / `oxc` / `import` / `promise` / `react` / `jsx-a11y` / `vitest`。`plugins` を書くと既定のプラグインが置き換わるので、既定の 3 つ(`typescript` / `unicorn` / `oxc`)も書いた(`node_modules/oxlint/configuration_schema.json` の `plugins` の説明。根拠: **公式ドキュメントのみ**)。
- カテゴリ: `correctness` をエラー、`suspicious` と `perf` を警告(EmDash と同じ)。`--deny-warnings` なので、警告も lint の失敗になる。
- 個別に設定したルール(根拠: **実測のみ**。`oxlint --rules -f json` と実行結果で確認):

| ルール | 設定 | 理由 |
|---|---|---|
| `react/rules-of-hooks` | error | カテゴリが `pedantic` なので、明示しないとオンにならない |
| `react/react-in-jsx-scope` | off | 自動 JSX ランタイム(`react-jsx`)では不要なのに、`suspicious` で警告になった |
| `import/no-unassigned-import` | `@testing-library/jest-dom/vitest` を許可 | setup ファイルの副作用 import のため |
| `no-unused-vars` | `_` で始まる名前を除外 | EmDash と同じ |
| `no-restricted-globals` / `no-restricted-imports`(`src/**` だけ) | `Buffer` / `process` / `__dirname` / `__filename` / `require` と `node:*` を禁止 | `src` はブラウザ(管理画面)と Workers で動く。base64 は `Uint8Array.fromBase64` / `atob` を使う(仕様書 付録 A.4) |

- 空のファイルは `unicorn/no-empty-file`(correctness)でエラー、`export {};` は `unicorn/require-module-specifiers` で警告になる。中身の無い仮のモジュールは、`export {};` に理由付きの `// oxlint-disable-next-line unicorn/require-module-specifiers -- …` を付ける。
- EmDash は `oxlint --type-aware` を使っているが、このリポジトリでは使っていない(`oxlint-tsgolint` が別に必要)。

## prettier(3.9.8)

- `.prettierrc`: `useTabs: true`、`printWidth: 100`。
  - EmDash(0.39.1 でも同じ)は、`.astro` 以外の整形に prettier ではなく oxfmt を使っている(`references/emdash/.prettierignore:1-3`、`references/emdash/package.json:24-25`)。根拠: **公式ドキュメントのみ**。仕様書 15 章の「EmDash と同じ oxlint + prettier」とは少し違う。
  - EmDash のコードには 80 文字を超える行が多い(`packages/core/src/plugins/define-plugin.ts` で 19 行。根拠: **実測のみ**)。oxfmt の既定の行幅 100 に合わせた(根拠: **推測のみ**)。
- 対象はコードと設定ファイルだけ。`.prettierignore` で `references/`、`.claude/`、playground のビルド出力、`spikes/`、`plans/` / `tasks/` / `docs/`、`*.md`、`package-lock.json` を除外した。Markdown は Obsidian 形式なので整形しない。
- prettier 3 は `.gitignore` も読む。`.gitignore` にだけ書いた場所のファイルは、コマンドラインで明示しても対象外になった。根拠: **実測のみ**
- prettier 3 は `.git/info/exclude` を読まない。メインの作業ディレクトリにだけある `.obsidian/`(利用者の Obsidian の設定。`.git/info/exclude` で除外)が `prettier --check .` の対象になり、失敗した。`.prettierignore` に `.obsidian/` を追加した([[T01-1-workflow-docs-index|T01-1]])。根拠: **実測のみ**
- `.astro` を整形するプラグイン(`prettier-plugin-astro`)は入れていない。`prettier --check .` は、整形できない拡張子のファイルを飛ばす。

## E2E(Playwright 1.63.0)

- `npx playwright install chromium firefox` で、`~/Library/Caches/ms-playwright` に次を入れた。後続のタスクは入れ直さない。根拠: **実測のみ**

| ブラウザ | 版 | ディレクトリ |
|---|---|---|
| Chrome for Testing | 153.0.8010.12 | `chromium-1243` |
| Chrome Headless Shell | 153.0.8010.12 | `chromium_headless_shell-1243` |
| Firefox | 155.0 | `firefox-1543` |
| FFmpeg | — | `ffmpeg-1011`(導入済みだった) |

- `chromium.launch()` と `firefox.launch()` で起動し、User-Agent を取得できた。根拠: **実測のみ**
- `@playwright/test` の版を変えると、ブラウザの版も変わり、入れ直しが必要になる。

> [!info] 計測環境
> macOS(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2、TypeScript 6.0.3、vitest 4.1.11、jsdom 30.1.0、oxlint 1.83.0、prettier 3.9.8、Playwright 1.63.0。2026-09-23 に計測。
