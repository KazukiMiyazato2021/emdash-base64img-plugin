---
id: T31-1
title: "T31 の結果(E2E)を既存の知見ノート・README・後続タスクに反映する"
type: ドキュメント
status: done
wave: 6
parent: "[[T31-e2e]]"
depends_on:
  - "[[T31-e2e]]"
soft_depends_on: []
blocks: []
files:
  - "docs/emdash-admin-console-noise.md(E2E で見つかったものの節)"
  - "docs/emdash-plugin-field-widget.md(3 章の推測を実測に)"
  - "docs/gallery-widget-reorder-focus.md(4 章の新規作成の行)"
  - "README.md(開発の節に E2E)"
  - "tasks/T34-release.md(作業内容に追加)"
  - "tasks/T31-1-handoff-e2e.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T31-1 T31 の結果(E2E)を既存の知見ノート・README・後続タスクに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 6 / ブランチ: `phase-6/t-31-1`
> - 親タスク: [[T31-e2e|T31]]
> - 着手の条件(依存): [[T31-e2e|T31]]
> - このタスクを待つもの: なし([[T34-release|T34]] はこの内容を前提に進める)

## 目的

T31 の報告のうち、既存の知見ノート・README・後続タスクに関わるものを書く。

## 発生した理由

T31 は、既存の知見ノートと README を変更してよい範囲の外だった。T31 の結果で推測が実測になったところと、E2E で見つかった console の出力を、既存の知見ノートに書くよう報告した([[T31-e2e#他のタスクへの影響・サブタスクの候補|T31]])。

## 作業内容

- [x] [[emdash-admin-console-noise]]: E2E で見つかった、EmDash と関係の無い console の出力(Chromium の 4xx の「Failed to load resource」、Playwright の `evaluate` による Firefox の警告)
- [x] [[emdash-plugin-field-widget]] 3 章: 新規作成の保存のあと、読み上げの領域が空に戻ること(推測 → 実測)
- [x] [[gallery-widget-reorder-focus]] 4 章: 新規作成の保存で、処理中のアップロードが中断され、残りが処理されないこと(推測 → 実測)
- [x] README の開発の節: `npm run test:e2e` と、macOS でだけ動くこと・データベースの扱い
- [x] [[T34-release|T34]]: タグを作る前に `npm run verify` と `npm run test:e2e` を通すこと

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスクは無い(フェーズ 6 の最後)。

## 結果

- T31 の「他のタスクへの影響・サブタスクの候補」と「未解決」は、次のように扱った。
  - 仕様書 18 章(処理中の保存): T31 のマージのときに、新規作成の保存の実測と、外れた画像が `detached` になることを書いた。
  - 多言語のサイト(翻訳の切り替え・`?locale=`)の E2E: playground に i18n の設定が無いので、今は作らない。作るには playground の設定と seed を変える必要がある。サーバー側の i18n の扱いは、SQLite([[T18-upload-route|T18]])と workerd([[T32-cloudflare-check|T32]])で確かめている。管理画面での翻訳の切り替えは、手で確かめる項目のまま([[e2e-playwright-emdash-admin#7. 手で確かめる項目]])。利用者に伝える。
  - CI: E2E の入力画像は macOS の `sips` で作るので、E2E は macOS でだけ動く([[T26-playground-pages|T26]] と同じ未解決)。README の開発の節に書いた。
  - 手で確かめる項目(スクリーンリーダー・OS からの本物のドラッグ・ヘッドレスでない Firefox の貼り付け・Safari の実機・本番のビルドと wrangler dev での E2E): [[e2e-playwright-emdash-admin#7. 手で確かめる項目]] のまま。
  - T31 のマージのとき、`e2e/roles.spec.ts` の待ち方をリーダーが直した([[T31-e2e#結果|T31 の反映済みの注記]])。
