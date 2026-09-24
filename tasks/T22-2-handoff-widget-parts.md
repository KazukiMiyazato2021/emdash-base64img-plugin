---
id: T22-2
title: "T22 の結果(widget 共通の UI 部品)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 3
parent: "[[T22-widget-parts]]"
depends_on:
  - "[[T22-widget-parts]]"
  - "[[T22-1-admin-css-test-helper]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T24-list-column.md(作業内容に追加)"
  - "tasks/T25-images-page.md(作業内容に追加)"
  - "tasks/T27-image-widget.md(作業内容に追加)"
  - "tasks/T28-gallery-widget.md(作業内容に追加)"
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "tasks/T22-widget-parts.md(反映済みの注記だけ)"
  - "tasks/T22-2-handoff-widget-parts.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#11.1 共通方針]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T22-2 T22 の結果(widget 共通の UI 部品)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-22-2`
> - 親タスク: [[T22-widget-parts|T22]]
> - 着手の条件(依存): [[T22-widget-parts|T22]]、[[T22-1-admin-css-test-helper|T22-1]](テストの補助の使い方を書くため)
> - このタスクを待つもの: なし([[T24-list-column|T24]]・[[T25-images-page|T25]]・[[T27-image-widget|T27]]・[[T28-gallery-widget|T28]]・[[T31-e2e|T31]] はこの内容を前提に進める)

## 目的

T22 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T22 は、変更してよいファイルが `src/admin/parts/**` とテストだけだった。後続タスクへの影響は、ノートの「部品と props(T27・T28 向け)」「後続タスク・未解決」に書いてリーダーに報告した。仕様書 11.1・11.2 は T22 が直した。

## 作業内容

- [x] [[T24-list-column|T24]]: 管理画面の CSS にあるクラスだけを使うことと、テストの補助([[T22-1-admin-css-test-helper|T22-1]])。アイコン。Kumo の注意
- [x] [[T25-images-page|T25]]: T24 と同じ内容に加えて、使える部品(`ErrorMessage`・`formatKilobytes`・`ImageInfo`)
- [x] [[T27-image-widget|T27]]: 部品の props と使い方の例への案内、常に描画する部品とフォーカスの移し方、文字は自分の辞書に持つこと、単一画像の `ImageDropZone` は複数を拒否すること、CSS のクラス
- [x] [[T28-gallery-widget|T28]]: T27 と同じ内容に加えて、`multiple`・`description`・`disabled` と、画像ごとに区別できる名前の付け方
- [x] [[T31-e2e|T31]]: 貼り付けの E2E は Chromium だけで行うことと、その方法。キーボードの操作。実際の Firefox での貼り付け(任意)

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T21-orphan-routes|T21]]・[[T23-upload-hook|T23]]・[[T26-playground-pages|T26]])は、これらのファイルを変更しない。

## 結果

- T22 の「後続タスク・未解決」の 1〜3 は、上のとおり反映した。
- 4(実際の Firefox での貼り付け)は、T31 の任意の項目にした。
- 5(アイコンを `@phosphor-icons/react` に揃える)は、今はしない。`package.json` の peerDependencies を増やすことになり、利用者のサイトに依存が増えるため。必要になったらサブタスクにする。
- 6(EmDash の `ImageDropTarget` のドラッグ中の枠の色が出ていないとみられる)は、EmDash 側の不具合の候補として [[emdash-admin-plugin-ui-styling]] に書かれている。このプラグインの作業ではない。EmDash の画面で確かめてはいない(推測のみ)。
- チームメイトへの指示(リーダーが持つ `team-rules.md`)に、管理画面の部品の書き方(CSS のクラス、テストの補助、Kumo の注意、`<output>`)を加えた。
