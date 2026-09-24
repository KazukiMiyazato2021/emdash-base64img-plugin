---
id: T20-1
title: "T20 の結果(参照元の記録)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 3
parent: "[[T20-owner-tracking]]"
depends_on:
  - "[[T20-owner-tracking]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T21-orphan-routes.md(作業内容に追加)"
  - "tasks/T29-plugin-definition.md(作業内容に追加)"
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "tasks/T32-cloudflare-check.md(作業内容に追加)"
  - "tasks/T20-1-handoff-owner-tracking.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T20-1 T20 の結果(参照元の記録)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-20-1`
> - 親タスク: [[T20-owner-tracking|T20]]
> - 着手の条件(依存): [[T20-owner-tracking|T20]]
> - このタスクを待つもの: なし([[T21-orphan-routes|T21]] はこの内容を前提に進める)

## 目的

T20 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T20 は、変更してよいファイルが自分のファイルとノートと仕様書の一部だけだった。後続タスクへの影響は、ノートの「T29 への引き継ぎ」「T21 への注意」「仕様書・他のタスクへの影響」に書いてリーダーに報告した。仕様書 18 章と付録 B への反映は、T20 のマージのときにリーダーが行った。

## 作業内容

- [x] [[T21-orphan-routes|T21]]: 記録の読み方(`owners` は増えるだけ、記録の遅れ、壊れた要素、`readReferencedImageIds`)と、書き換えは `compareAndSet` で行うこと
- [x] [[T29-plugin-definition|T29]]: `imageOwnerHooks` の登録(`priority` と `errorPolicy` を上書きしない、`content:read` が要る)
- [x] [[T31-e2e|T31]]: 参照元の記録を確かめるときは、保存の応答のあと少し待つ
- [x] [[T32-cloudflare-check|T32]]: D1 での hook のクエリ数と、同時の保存で参照元が消えないこと
- [x] [[T18-upload-route|T18]](実行中)には、最初の参照元の形(`{ collection, entryId, locale, field }`、`locale` は投稿のロケール)と、既存の記録の書き換えには `compareAndSet` を使うことを、メッセージで伝えた

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T18-upload-route|T18]]・[[T22-widget-parts|T22]]・[[T23-upload-hook|T23]])は、これらのファイルを変更しない。

## 結果

- T20 の未解決の 1(beforeSave と afterSave が、フィールド定義の読み出しの 2 クエリを 1 回ずつ行う)は、プラグインにリクエストの中で結果を共有する手段が無いので、そのままにする。上限(1 呼び出し 1,000)には十分収まる。
- [[T19-1-handoff-image-entry-hook|T19-1]] の登録で、`tasks/00-index.md` の概要の行(サブタスクの件数と一覧)の更新が漏れていた(書き換えたが保存していなかった)。ここで T19-1 と T20-1 をあわせて足し、件数を 16 にした。
