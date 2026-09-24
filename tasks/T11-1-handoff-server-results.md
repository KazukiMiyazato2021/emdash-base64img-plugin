---
id: T11-1
title: "T11・T17 の結果を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 2
parent: "[[T11-server-validation]]"
depends_on:
  - "[[T11-server-validation]]"
  - "[[T17-admin-data-routes]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T18-upload-route.md(作業内容に追加)"
  - "tasks/T19-image-entry-hook.md(作業内容に追加)"
  - "tasks/T21-orphan-routes.md(作業内容に追加)"
  - "tasks/T24-list-column.md(作業内容に追加)"
  - "tasks/T29-plugin-definition.md(作業内容に追加)"
  - "tasks/T32-cloudflare-check.md(作業内容に追加)"
  - "tasks/T11-1-handoff-server-results.md"
  - "tasks/00-index.md"
spec: []
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T11-1 T11・T17 の結果を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 2 / ブランチ: `phase-2/t-11-1`
> - 親タスク: [[T11-server-validation|T11]](あわせて [[T17-admin-data-routes|T17]] の結果も反映する)
> - 着手の条件(依存): [[T11-server-validation|T11]]、[[T17-admin-data-routes|T17]]
> - このタスクを待つもの: なし(フェーズ 3 以降のタスクは、この内容を前提に進める)

## 目的

T11(サーバー側の検証)と T17(プレビュー・サムネイル取得のルート)の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。フェーズ 3 以降のチームメイトは、タスクノートを読んで作業を始めるため。

## 発生した理由

T11 と T17 は、変更してよいファイルが自分のファイルとノートだけだった。後続タスクへの影響は、変更せずにリーダーに報告した([[T11-server-validation#他のタスクへの影響]]、[[T17-admin-data-routes#結果]])。

## 作業内容

- [x] [[T18-upload-route|T18]]: `validateUpload` の呼び方、エラーの投げ方、`meta.bytes` に入れる値、`ctx.schema` が無いときは 500
- [x] [[T19-image-entry-hook|T19]]: `validateImageEntry` の呼び方と、`ContentSaveRejectedError` を投げること(ほかの例外はメッセージが隠れる)
- [x] [[T21-orphan-routes|T21]]: ゴミ箱に入った画像を `imageRefs` に記録するかを決める(T17 の未解決)
- [x] [[T24-list-column|T24]]: `fetchThumbnails` の結果の読み方。ゴミ箱に入った画像にもサムネイルが返ること
- [x] [[T29-plugin-definition|T29]]: T17 のルートの登録と、要る capability・ストレージ。widget の `fieldTypes` は `["json"]`
- [x] [[T32-cloudflare-check|T32]]: 検証全体と `preview` の CPU 時間(Node の値)と、Workers で測ること

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T12-input-decode|T12]]・[[T16-reference-hook|T16]])は、これらのファイルを変更しない。

## 結果

- T17 が「利用者の判断が要る」とした件(ゴミ箱に入った画像も一覧の列にサムネイルが出る)は、T21 で調べてから決めることにした。
  - 仕様書 11.4 の「見つからない行に警告アイコン」は、今は「`imageRefs` に無い行」になっている(T17 が直した)。
  - ゴミ箱の画像を区別するには、`imageRefs` にゴミ箱の状態を記録する必要がある。そのためには、ゴミ箱から戻したときに呼ばれる hook が要る。
  - T21 でその hook の有無を確かめ、記録できない・コストが大きいときに、利用者に判断を求める。根拠: **推測のみ**(進め方の判断)
- T11 の「workerd で `Uint8Array.fromBase64` があるかは確かめていない」は、[[T07-spike-git-dependency#結果|T07]] が確かめている(ある)ので、T32 には測る項目だけを書いた。
