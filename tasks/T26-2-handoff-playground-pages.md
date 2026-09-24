---
id: T26-2
title: "T26 の結果(playground のページと E2E の入力画像)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 3
parent: "[[T26-playground-pages]]"
depends_on:
  - "[[T26-playground-pages]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T29-plugin-definition.md(作業内容に追加)"
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "tasks/T32-cloudflare-check.md(作業内容に追加)"
  - "tasks/T33-readme.md(作業内容に追加)"
  - "tasks/T26-playground-pages.md(反映済みの注記だけ)"
  - "tasks/T26-2-handoff-playground-pages.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#12. サイト側の描画]]"
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T26-2 T26 の結果(playground のページと E2E の入力画像)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-26-2`
> - 親タスク: [[T26-playground-pages|T26]]
> - 着手の条件(依存): [[T26-playground-pages|T26]]
> - このタスクを待つもの: なし([[T29-plugin-definition|T29]]・[[T31-e2e|T31]]・[[T32-cloudflare-check|T32]]・[[T33-readme|T33]] はこの内容を前提に進める)

## 目的

T26 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T26 は、変更してよいファイルが playground のページ・seed・スクリプト・README と E2E の入力画像だけだった。後続タスクへの影響は、ノートの「他のタスクへの影響」「未解決・サブタスクの候補」に書いてリーダーに報告した。仕様書 12 章と 15 章は T26 が直した。

## 作業内容

- [x] [[T29-plugin-definition|T29]]: 完了の確認に、サンプルの投稿を作るスクリプトを使えること
- [x] [[T31-e2e|T31]]: 入力画像の作り方(テストの前に作る、`sips` が要る)、本物の HEIC、ページの `data-testid`、開発サーバーの読み直しと歓迎ダイアログの待ち方
- [x] [[T32-cloudflare-check|T32]]: スクリプトは `wrangler dev` では使えないこと
- [x] [[T33-readme|T33]]: サイト側の例での `getEmDashEntry` の `error` の扱いと、LCP の対象の選び方

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T21-orphan-routes|T21]]・[[T23-upload-hook|T23]]・[[T24-list-column|T24]])は、これらのファイルを変更しない。

## 結果

- T26 の「他のタスクへの影響」の 4 行と、「未解決・サブタスクの候補」の 3・4 は、上のとおり反映した。
- 未解決の 1(スクリプトの型チェック)は [[T26-1-typecheck-playground-scripts|T26-1]] で直した。
- 未解決の 2(ルートの `package.json` に script を足すか)は、T31 の作業内容に入れた。E2E を実行する script を足すときに合わせて決める(1 つのフェーズで `package.json` を変えるタスクは 1 つに限るため)。
- T15 は完了しているので、`resolveBase64Images` の最初の呼び出しでクエリが 1 本増えることは、仕様書 12 章(T26 が追記)と [[playground-site-pages]] にあれば足りる。
