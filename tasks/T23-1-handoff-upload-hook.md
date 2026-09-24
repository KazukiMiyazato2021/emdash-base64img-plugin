---
id: T23-1
title: "T23 の結果(アップロード処理の React フック)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 3
parent: "[[T23-upload-hook]]"
depends_on:
  - "[[T23-upload-hook]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T27-image-widget.md(作業内容に追加)"
  - "tasks/T28-gallery-widget.md(作業内容に追加)"
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "tasks/T23-upload-hook.md(反映済みの注記だけ)"
  - "tasks/T23-1-handoff-upload-hook.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T23-1 T23 の結果(アップロード処理の React フック)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-23-1`
> - 親タスク: [[T23-upload-hook|T23]]
> - 着手の条件(依存): [[T23-upload-hook|T23]]
> - このタスクを待つもの: なし([[T27-image-widget|T27]]・[[T28-gallery-widget|T28]]・[[T31-e2e|T31]] はこの内容を前提に進める)

## 目的

T23 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T23 は、変更してよいファイルが `src/admin/hooks/**` とテスト、自分のノートだけだった。後続タスクへの影響は、ノートの「T27・T28 が使うもの」「使い方の例」「他のタスクへの影響」に書いてリーダーに報告した。仕様書 11 章への追記の依頼は、T23 のマージのときにリーダーが反映した。

## 作業内容

- [x] [[T27-image-widget|T27]]: `useUploadTarget` と `useImageUpload` の使い方(結果が `done` のときだけ `onChange`)、`usePreviewImages` と `prime`
- [x] [[T28-gallery-widget|T28]]: `useUploadQueue` の使い方(`onUploaded` は続けて呼ばれる、`limit`、進捗の数、1 枚ごとの失敗)、`usePreviewImages` と `prime`
- [x] [[T31-e2e|T31]]: 編集画面の開き方ごとに送る `target` と、新規作成の保存のあとの widget の作り直し

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク(T21-2・[[T24-list-column|T24]])は、これらのファイルを変更しない。

## 結果

- T23 の「他のタスクへの影響」のうち、T22・T18・T20・T21 の分は、どれも完了したタスクへの説明で、ノートへの反映は要らない。
  - T21 の分(URL を手で slug にして開いた画面では、slug が参照元の `entryId` に記録される)は、保存のときに T20 が正しい参照元を足すので、画像が未使用に見えることはない見込み(推測のみ)。
- 未解決・サブタスクの候補の 1(`?locale=` の無い画面で、翻訳の API からロケールを引く)は、作らない。参照元は保存のときに T20 がエントリ自身のロケールで記録するので、機能は欠けない(T23 の決定 3)。
- 2(保存先を求められないときの専用のエラーコード)も、作らない。widget が描かれるのはコンテンツの編集画面だけで、起きるのは編集画面の外で widget を描いたときに限られる。そのときも `INVALID_TARGET` の文言([[T18-2-invalid-target-message|T18-2]] で広げたもの)が出る。
- 3(実際の管理画面での確認)は、上のとおり T31 に書いた。T27 も、widget を作るときに playground で確かめる。
- 5(Firefox のデコード中の画面の停止)は、[[T12-input-decode|T12]] と同じ理由で見送る。仕様書 18 章の「Firefox でのデコード」の行にある。
