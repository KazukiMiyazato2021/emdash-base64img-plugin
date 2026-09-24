---
id: T19-1
title: "T19 の結果(b64_images の保存 hook)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 3
parent: "[[T19-image-entry-hook]]"
depends_on:
  - "[[T19-image-entry-hook]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T25-images-page.md(作業内容に追加)"
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "tasks/T32-cloudflare-check.md(作業内容に追加)"
  - "tasks/T33-readme.md(作業内容に追加)"
  - "tasks/T19-1-handoff-image-entry-hook.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#10. 画像のライフサイクル]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T19-1 T19 の結果(b64_images の保存 hook)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-19-1`
> - 親タスク: [[T19-image-entry-hook|T19]]
> - 着手の条件(依存): [[T19-image-entry-hook|T19]]
> - このタスクを待つもの: なし

## 目的

T19 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T19 は、変更してよいファイルが自分のファイルとノートと仕様書の一部だけだった。後続タスクへの影響は、ノートの「他のタスクへの影響」に書いてリーダーに報告した([[T19-image-entry-hook#他のタスクへの影響]])。仕様書 18 章と付録 B への反映は、T19 のマージのときにリーダーが行った。

## 作業内容

- [x] [[T25-images-page|T25]]: 非公開にした画像を公開し直す操作を、このページに置くかを決める
- [x] [[T31-e2e|T31]]: (任意)標準の編集画面からの `b64_images` の保存が拒否されること
- [x] [[T32-cloudflare-check|T32]]: workerd でも保存 hook の拒否が 422 と `message` になること
- [x] [[T33-readme|T33]]: `b64_images` を標準の画面で編集しないこと、画像は widget からアップロードすること
- [x] [[T18-upload-route|T18]](実行中)には、`ctx.content.create` の中の拒否が通常の `Error`(`code: "SAVE_REJECTED"`)で届くことを、メッセージで伝えた。T18 のノートは T18 が更新する

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T18-upload-route|T18]]・[[T20-owner-tracking|T20]]・[[T22-widget-parts|T22]])は、これらのファイルを変更しない。

## 結果

- T29 への登録のしかたは、[[T16-1-handoff-save-hook|T16-1]] で T29 のノートに書いた内容のままでよい(T19 の hook は ctx を使わず、登録に要る capability は `content:write` だけ)。
