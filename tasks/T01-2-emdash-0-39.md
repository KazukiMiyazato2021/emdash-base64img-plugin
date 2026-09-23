---
id: T01-2
title: "EmDash を 0.39.1 に上げる"
type: 実装
status: done
wave: 0
parent: "[[T01-scaffold]]"
depends_on:
  - "[[T01-scaffold]]"
soft_depends_on:
  - "[[T06-decision-trash-permission]]"
blocks: []
files:
  - "package.json"
  - "package-lock.json"
  - "playground/package.json"
  - "tasks/T01-2-emdash-0-39.md"
  - "tasks/00-index.md"
  - "tasks/T01-scaffold.md(追記)"
  - "tasks/T06-decision-trash-permission.md(追記)"
  - "plans/base64-image-plugin-spec.md(版の記述と行番号)"
  - "docs/emdash-dependency-versions.md(docs/emdash-0-38-dependency-versions.md から改名)"
  - "docs/emdash-reference-vs-npm-0-38.md(追記)"
  - "docs/emdash-plugin-route-permissions.md(追記)"
  - "docs/emdash-native-plugin-entrypoints.md(追記)"
  - "docs/test-lint-setup.md(1 行)"
  - "docs/00-index.md"
spec:
  - "[[base64-image-plugin-spec#2. 動作環境と制約]]"
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
  - "[[base64-image-plugin-spec#20. 決定ログ]]"
tags:
  - task
  - impl
  - setup
  - subtask
created: 2026-09-24
---

# T01-2 EmDash を 0.39.1 に上げる

> [!info] 概要
> - 種別: 実装(予定外のサブタスク) / ウェーブ: 0 / ブランチ: `phase-0/t-01-2`
> - 親タスク: [[T01-scaffold|T01]](依存パッケージの版を決めたタスク)
> - 着手の条件(依存): [[T01-scaffold|T01]]。きっかけは [[T06-decision-trash-permission|T06]] の報告
> - このタスクを待つもの: なし(フェーズ 1 以降のすべてのタスクが、この版を前提にする)
> - 仕様: [[base64-image-plugin-spec#2. 動作環境と制約|仕様書 2章]]、[[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14章]]、[[base64-image-plugin-spec#20. 決定ログ|仕様書 20章]]

## 目的

仕様書は、プラグインが画像を公開すること(7 章)、フィールドの options を読むこと(8 章)、下書きを確かめること(9 章)を前提にしている。これらが動く EmDash の版を使う。

## 発生した理由

- [[T06-decision-trash-permission|T06]] で、`references/emdash` が 0.38.0 ではなく、そのあとの未リリースの開発版(`0.38.0-126-gea275faf`、未リリースの changeset 81 件)だと分かった。
- npm の `emdash@0.38.0` は、`schema:read` / `content:publish` / `content:revisions:read` を capability として受け付けない(`node_modules/emdash/dist/menus-D8mC4eaN.mjs:1465-1489`)。根拠: **実測+公式ドキュメント**
- npm の 0.39.0 / 0.39.1(2026-09-23 公開)にはある。根拠: **公式ドキュメントのみ**(tarball の `dist/manifest-schema-*.mjs` と `dist/context-*.mjs`)
- 2026-09-24、利用者が「0.39.1 を今すぐ入れる」を選んだ。`~/.npmrc` の `min-release-age=3` は変えずに、`emdash` と `@emdash-cms/*` の 0.39.1 系だけを、その 1 回のインストールで例外にする。

## 作業内容

- [x] `references/emdash` をタグ `emdash@0.39.1`(`ae32cf1e`)に切り替える(detached HEAD。元は `main` の `ea275faf`)
- [x] `package.json` の devDependencies を `emdash` / `@emdash-cms/admin` とも `0.39.1` にし、peer を `^0.39.0` にする。playground の `emdash` も `0.39.1` にする
- [x] `npm install --min-release-age=0` を 1 回だけ実行し、ロックファイルの差分を調べる
- [x] 例外の外で公開から 3 日未満の版が入っていたら戻す
- [x] `min-release-age=3` のままの `npm ci` で入ることを確かめる(ほかの worktree が使う手順)
- [x] 仕様書の版の記述、peer の範囲、ずれた行番号、決定ログを直す
- [x] 知見ノートを直し、索引とタスク一覧を更新する

## 完了条件

- [x] `npm run verify` が通る
- [x] ロックファイルの中で、公開から 3 日未満の版は EmDash の 0.39.1 系だけ
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。フェーズ 0 のほかのタスク(T01・T01-1・T06)はマージ済みなので、衝突しない。

## 結果

- 版が変わったパッケージは 10 個。うち 9 個は EmDash のもの(`emdash`、`@emdash-cms/admin` / `auth` / `blocks` / `gutenberg-to-portable-text` / `plugin-types` / `registry-client` / `registry-lexicons` / `registry-verification`)。根拠: **実測のみ**
- 例外の外に `@wordpress/block-serialization-default-parser` 5.56.0(2026-09-23 12:33 UTC 公開)が入った。ロックファイルのこの項目を元の 5.55.0 に戻した。依存の範囲は `^5.13.0` なので、5.55.0 でも満たす。根拠: **実測のみ**
- `min-release-age=3` のままでも、ロックファイルからの `npm ci` は成功した。この設定は、範囲から版を選ぶときにだけ働く。根拠: **実測のみ**
- `references/emdash` の `ea275faf` と `emdash@0.39.1` の差は、ソースで 22 ファイル(管理画面の見た目の調整、マイグレーション 081 の修正)と翻訳ファイルだけ。仕様書と知見ノートが引用しているファイルのうち、行がずれたのは `packages/admin/src/components/ContentEditor.tsx` だけ(`:1800` → `:1806`、`:1827` → `:1833`)。根拠: **実測のみ**(`git diff --stat`)
- 入口の形(`createPlugin` の名前付き export、`PluginDescriptor`)は 0.39.1 でも同じ。仮実装のまま `npm run verify` が通った。根拠: **実測+公式ドキュメント**
- 詳しくは [[emdash-dependency-versions#0.38.0 から 0.39.1 に上げた経緯]] と [[emdash-dependency-versions#min-release-age の例外(2026-09-24)]]。
