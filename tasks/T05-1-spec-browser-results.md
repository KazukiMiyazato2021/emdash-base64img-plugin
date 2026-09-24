---
id: T05-1
title: "T05 の結果を仕様書と T13 に反映する"
type: ドキュメント
status: done
wave: 1
parent: "[[T05-spike-canvas-webp]]"
depends_on:
  - "[[T05-spike-canvas-webp]]"
soft_depends_on: []
blocks: []
files:
  - "plans/base64-image-plugin-spec.md(6.3・16 章、付録 A.4・A.5)"
  - "tasks/T13-encode-search.md(作業内容・完了条件)"
  - "tasks/T05-1-spec-browser-results.md"
  - "tasks/00-index.md"
  - "docs/00-index.md"
spec:
  - "[[base64-image-plugin-spec#6.3 リサイズと画質の方針(Q7)]]"
  - "[[base64-image-plugin-spec#16. 実装前の検証(スパイク)]]"
  - "[[base64-image-plugin-spec#A.5 ブラウザの canvas での確認]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T05-1 T05 の結果を仕様書と T13 に反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 1 / ブランチ: `phase-1/t-05-1`
> - 親タスク: [[T05-spike-canvas-webp|T05]]
> - 着手の条件(依存): [[T05-spike-canvas-webp|T05]]
> - このタスクを待つもの: なし([[T13-encode-search|T13]] はこの内容を前提に進める)
> - 仕様: [[base64-image-plugin-spec#6.3 リサイズと画質の方針(Q7)|仕様書 6.3]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|仕様書 16章]]、[[base64-image-plugin-spec#A.5 ブラウザの canvas での確認|付録 A.5]]

## 目的

[[T05-spike-canvas-webp|T05]] で決まった縮小の方法と探索の順番を、仕様書と [[T13-encode-search|T13]] のノートに書く。T05 は既定値を変えなかったので、自分では仕様書と T13 を更新していない。

## 発生した理由

- T05 の結論は「既定値は変えない。ただし、縮小は `createImageBitmap` の `resizeQuality: "high"` にし、探索は `minQuality` を最初に試す順番にする」だった。2 つ目以降は実装の方針なので、仕様書 6.3 に残す必要がある。
- 仕様書 16 章のスパイクのチェックリストは、スパイクどうしが同じ行の近くを編集して衝突しないよう、リーダーがマージのときに更新する。
- T03 の報告で、T13 のノートの「サムネイル 8,000 バイト以下」を、data URL の長さの意味に揃える必要があった。T03 は T13 のノートを変更できなかった。

## 作業内容

- [x] 仕様書 6.3 に、縮小の方法・探索の順番・画質を明示することと、既定値を変えない理由を書く
- [x] 仕様書 16 章の 4 つ目の項目に、チェックと結論を付ける
- [x] 付録 A.4 に T04 の実装での処理時間を、付録 A.5 にブラウザでの最高画質の表を加える
- [x] T13 のノートの作業内容と完了条件を、上の方針とサムネイルの上限(data URL の長さ)に合わせる
- [x] タスク一覧と知見の索引を更新する

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。フェーズ 1 のほかのタスクはすべてマージ済みなので、衝突しない。

## 結果

- 数値は [[T05-spike-canvas-webp#結果|T05 の結果]] と [[canvas-webp-encoding]] から写した(根拠レベル: 実測のみ)。付録 A.5 の表は、cwebp / Chromium(`drawImage` の `high`、ソフトウェア描画)/ Firefox(`createImageBitmap` の `resizeQuality: "high"`)の 3 列にまとめた。
