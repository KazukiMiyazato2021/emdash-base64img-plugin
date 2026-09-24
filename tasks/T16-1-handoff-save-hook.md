---
id: T16-1
title: "T16 の結果(保存 hook の登録と seed の画像)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 2
parent: "[[T16-reference-hook]]"
depends_on:
  - "[[T16-reference-hook]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T19-image-entry-hook.md(作業内容に追加)"
  - "tasks/T26-playground-pages.md(作業内容に追加)"
  - "tasks/T27-image-widget.md(作業内容に追加)"
  - "tasks/T28-gallery-widget.md(作業内容に追加)"
  - "tasks/T29-plugin-definition.md(作業内容に追加)"
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "plans/base64-image-plugin-spec.md(19 章)"
  - "tasks/T16-1-handoff-save-hook.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
  - "[[base64-image-plugin-spec#19. 対象外・将来の検討事項]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T16-1 T16 の結果(保存 hook の登録と seed の画像)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 2 / ブランチ: `phase-2/t-16-1`
> - 親タスク: [[T16-reference-hook|T16]]
> - 着手の条件(依存): [[T16-reference-hook|T16]]
> - このタスクを待つもの: なし(フェーズ 3 以降のタスクは、この内容を前提に進める)

## 目的

T16 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T16 は、変更してよいファイルが自分のファイルとノートだけだった。後続タスクへの影響は、変更せずにリーダーに報告した([[T16-reference-hook#他のタスクへの影響]]、[[T16-reference-hook#T29 への引き継ぎ(登録のしかた)]])。仕様書への反映は、T16 のマージのときにリーダーが行った。

## 作業内容

- [x] [[T19-image-entry-hook|T19]]: `content:beforeSave` は 1 つのプラグインに 1 つだけなので、T16 と同じ形の関数を export し、T29 が振り分ける
- [x] [[T29-plugin-definition|T29]]: beforeSave の振り分け、`content:write` が要ること、beforeSave に `errorPolicy: "continue"` を付けないこと
- [x] [[T26-playground-pages|T26]]・[[T31-e2e|T31]]: 画像はアップロードのルートで作る(seed の画像を参照する投稿は保存できない)
- [x] [[T27-image-widget|T27]]・[[T28-gallery-widget|T28]]: プレビューは `imageRefs` に記録が無い画像も表示するが、保存は拒否される。保存の前に気付けるようにするかを決める
- [x] 仕様書 19 章: 既存の `b64_images` を `imageRefs` に登録する機能を、将来の検討事項に足す

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T12-input-decode|T12]])が編集しうるのは、仕様書の 6.5 だけなので、衝突しない。

## 結果

- T16 が挙げたサブタスクの候補「既存の `b64_images` を `imageRefs` に登録する方法」は、最初の版の範囲に入れず、仕様書 19 章(将来の検討事項)に書いた。
  - サムネイルはブラウザでしか作れないので、管理画面の機能として作る必要がある。
  - 最初の版では、画像はアップロードで作る運用にする。根拠: **推測のみ**(範囲の判断)
