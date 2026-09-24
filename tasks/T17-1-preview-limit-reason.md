---
id: T17-1
title: "PREVIEW_MAX_IDS の理由を T17 の実測に合わせて直す"
type: ドキュメント
status: done
wave: 2
parent: "[[T17-admin-data-routes]]"
depends_on:
  - "[[T17-admin-data-routes]]"
soft_depends_on: []
blocks: []
files:
  - "src/shared/constants.ts(`PREVIEW_MAX_IDS` のコメントだけ)"
  - "docs/emdash-plugin-content-api-constraints.md(`ctx.content.get` のクエリ数の節)"
  - "tasks/T03-shared-contracts.md(未解決 3 に追記)"
  - "tasks/T14-admin-i18n-api.md(後続タスク・未解決 1 に追記)"
  - "tasks/T17-1-preview-limit-reason.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#11.2 単一画像 widget(`base64-image:image`)]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T17-1 PREVIEW_MAX_IDS の理由を T17 の実測に合わせて直す

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 2 / ブランチ: `phase-2/t-17-1`
> - 親タスク: [[T17-admin-data-routes|T17]]
> - 着手の条件(依存): [[T17-admin-data-routes|T17]]
> - このタスクを待つもの: なし

## 目的

`PREVIEW_MAX_IDS`(1 回のプレビュー取得の件数、10)の理由を、T17 の実測に合わせて直す。値は変えない。

## 発生した理由

- [[T03-shared-contracts|T03]] は、D1 の上限を「1 リクエスト 50 クエリ」と考えて、`PREVIEW_MAX_IDS` を 10 にした。
- [[T10-1-spec-d1-limits|T10-1]] で、実際の上限は 1 呼び出し 1,000 だと分かった。
- [[T17-admin-data-routes|T17]] の実測でも 10 件のままにしたが、理由は応答の大きさと CPU 時間に変わった([[emdash-plugin-preview-thumbnail-routes]])。
- `src/shared/constants.ts` のコメントと、T03 の知見ノートには、古い理由が残っていた。どちらも T17 が変更してよいファイルではないので、T17 は報告だけをした。

## 作業内容

- [x] `src/shared/constants.ts` の `PREVIEW_MAX_IDS` のコメントを、応答の大きさと CPU 時間の理由に直す(値は 10 のまま)
- [x] [[emdash-plugin-content-api-constraints]] の「`ctx.content.get` のクエリ数」に、T03 の時点の前提と T17 の結論を書く
- [x] T03 のノートの未解決 3 と、T14 のノートの後続タスク・未解決 1 に、T17 で決着したことを書く(決定の記録は書き換えない)

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T12-input-decode|T12]]・[[T16-reference-hook|T16]])は、これらのファイルを変更しない。

## 結果

- 値は変えていないので、動作とテストへの影響は無い。
- 仕様書 11.2 は、T17 が直した(10 件ずつ並行に取得する理由)。
