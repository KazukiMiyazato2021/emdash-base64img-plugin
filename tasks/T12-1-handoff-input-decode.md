---
id: T12-1
title: "T12 の結果(入力画像の判定とデコード)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 2
parent: "[[T12-input-decode]]"
depends_on:
  - "[[T12-input-decode]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T23-upload-hook.md(作業内容に追加)"
  - "tasks/T27-image-widget.md(作業内容に追加)"
  - "tasks/T28-gallery-widget.md(作業内容に追加)"
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "tasks/T12-1-handoff-input-decode.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#6.5 入力形式と上限(Q8)]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T12-1 T12 の結果(入力画像の判定とデコード)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 2 / ブランチ: `phase-2/t-12-1`
> - 親タスク: [[T12-input-decode|T12]]
> - 着手の条件(依存): [[T12-input-decode|T12]]
> - このタスクを待つもの: なし(フェーズ 3 以降のタスクは、この内容を前提に進める)

## 目的

T12 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T12 は、変更してよいファイルが自分のファイルとノートと仕様書 6.5 だけだった。後続タスクへの影響は、ノートの「後続タスク向けのメモ」に書いてリーダーに報告した([[T12-input-decode#後続タスク向けのメモ]])。仕様書 18・19 章への反映は、T12 のマージのときにリーダーが行った。

## 作業内容

- [x] [[T23-upload-hook|T23]]: `decodeImage` の結果を `finally` で閉じる(Firefox では中断がデコードのあとに届く)、`inspectInputFile` での先の判定、注意の表示、ファイル名、テストの作り方
- [x] [[T27-image-widget|T27]]・[[T28-gallery-widget|T28]]: `accept="image/*"`、デコードの前に「読み込み中…」を描画する
- [x] [[T31-e2e|T31]]: `setInputFiles`、HEIC の作り方、壊れたファイルには乱数のファイルを使う

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスクは無い。

## 結果

- アニメーション WebP・APNG・AVIF のシーケンスの注意書き(T12 のサブタスクの候補)は、最初の版に入れないことにした。
  - 仕様書 6.5 には GIF の注意しか無く、ほかの形式の注意には、注意のコードと文言の追加が要る。
  - 仕様書 18 章に既知の制約として、19 章に将来の検討事項として書いた(T12 のマージのとき)。根拠: **推測のみ**(範囲の判断)
