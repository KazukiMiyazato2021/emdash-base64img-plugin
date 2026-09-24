---
id: T24-1
title: "T24 の結果(コンテンツ一覧のサムネイル列)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 3
parent: "[[T24-list-column]]"
depends_on:
  - "[[T24-list-column]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T29-plugin-definition.md(作業内容に追加)"
  - "tasks/T30-admin-entry.md(作業内容に追加)"
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "tasks/T24-list-column.md(反映済みの注記だけ)"
  - "tasks/T24-1-handoff-list-column.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T24-1 T24 の結果(コンテンツ一覧のサムネイル列)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-24-1`
> - 親タスク: [[T24-list-column|T24]]
> - 着手の条件(依存): [[T24-list-column|T24]]
> - このタスクを待つもの: なし([[T29-plugin-definition|T29]]・[[T30-admin-entry|T30]]・[[T31-e2e|T31]] はこの内容を前提に進める)

## 目的

T24 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T24 は、変更してよいファイルが `src/admin/ThumbnailColumn.tsx` とテスト、仕様書の 11.4・17 章だけだった。後続タスクへの影響は、ノートの「T30 が登録するもの」「他のタスクへの影響」に書いてリーダーに報告した。

## 作業内容

- [x] [[T30-admin-entry|T30]]: `thumbnailColumn` の登録と、入口の読み込み時の `preloadThumbnailColumn()`。入口を読み込むテストでの `fetch`
- [x] [[T29-plugin-definition|T29]]: 画像管理ページのラベルも `i18n._(label)` で訳されるとみられること(ラベルは T25 の結果に従う)
- [x] [[T31-e2e|T31]]: 実際の管理画面で、列の要求の回数・列を出すコレクション・見出しの言語・表示を確かめる

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T25-images-page|T25]])は、これらのファイルを変更しない。

## 結果

- T24 の「他のタスクへの影響」の 1・2・4 は、上のとおり反映した。
- 3(画像管理ページで完全に削除したあと、一覧の列が最大 1 分、前のサムネイルを出す)は、実行中の T25 にメッセージで伝えた。`clearThumbnailColumnCache()` のつなぎ込みは、T25 のブランチに T24 のコードが無いので、T25 のマージのあとにリーダーが扱う。
- 未解決の 3・4(EmDash への提案・報告の候補)は、外部のリポジトリへの投稿になり、利用者の判断が要るので、今は行わない。内容は [[T24-list-column#未解決・サブタスクの候補|T24 のノート]] と [[emdash-admin-content-list-columns]] に残っている。
