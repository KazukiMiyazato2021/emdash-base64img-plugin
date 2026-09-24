---
id: T18-1
title: "T18 の結果(アップロードのルート)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 3
parent: "[[T18-upload-route]]"
depends_on:
  - "[[T18-upload-route]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T25-images-page.md(作業内容に追加)"
  - "tasks/T27-image-widget.md(作業内容に追加)"
  - "tasks/T28-gallery-widget.md(作業内容に追加)"
  - "tasks/T29-plugin-definition.md(作業内容に追加)"
  - "tasks/T32-cloudflare-check.md(作業内容に追加)"
  - "tasks/T18-upload-route.md(反映済みの注記だけ)"
  - "plans/base64-image-plugin-spec.md(19 章)"
  - "tasks/T18-1-handoff-upload-route.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
  - "[[base64-image-plugin-spec#19. 対象外・将来の検討事項]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T18-1 T18 の結果(アップロードのルート)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-18-1`
> - 親タスク: [[T18-upload-route|T18]]
> - 着手の条件(依存): [[T18-upload-route|T18]]
> - このタスクを待つもの: なし([[T25-images-page|T25]]・[[T27-image-widget|T27]]・[[T28-gallery-widget|T28]]・[[T29-plugin-definition|T29]]・[[T32-cloudflare-check|T32]] はこの内容を前提に進める)

## 目的

T18 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T18 は、変更してよいファイルが自分のファイルとノート、仕様書の 5.4・7 章だけだった。後続タスクへの影響は、ノートの「他のタスクへの影響」「未解決」に書いてリーダーに報告した。仕様書 4.2・7・8 章への反映は、T18 のマージのときにリーダーが行った。

## 作業内容

- [x] [[T25-images-page|T25]]: アップロードの途中で失敗した画像が一覧に出ることと、その扱い。`owners` にロケールだけが違う同じエントリが並ぶことがあること
- [x] [[T27-image-widget|T27]] / [[T28-gallery-widget|T28]]: 応答の `ref` はそのまま値にし、`ref.locale` を書き換えないこと。エラーの出し方(`UPLOAD_FAILED`・`IMAGE_ENTRY_INVALID`)
- [x] [[T29-plugin-definition|T29]]: アップロードのルートの登録と、使う capability
- [x] [[T32-cloudflare-check|T32]]: D1 でのクエリ数と、workerd での `getI18nConfig()`
- [x] 仕様書 19 章: 「既存の `b64_images` を `imageRefs` に登録する機能」で、アップロードの途中で残ったエントリも拾えること
- [x] 実行中の [[T23-upload-hook|T23]] には、`target.entryId` を送るときにエントリのロケールも送ること、応答の形、エラーのコードを、メッセージで伝えた。実行中の [[T21-orphan-routes|T21]] には、失敗したときに残るものを、メッセージで伝えた

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T21-orphan-routes|T21]]・[[T23-upload-hook|T23]]・[[T24-list-column|T24]]・[[T26-playground-pages|T26]])は、これらのファイルを変更しない。

## 結果

- T18 の「他のタスクへの影響」のうち、T14 の `INVALID_TARGET` の文言は、`target.locale` がサイトのロケールでないときにも出る。この文言は別のサブタスクで扱う(`src/client/error-messages.ts` の変更で、ドキュメントの反映とは種類が違うため)。
- T19・T20 への影響は、T18 のノートに書かれたとおりで、ほかのノートへの反映は要らない(どちらも完了している)。
