---
id: T21-1
title: "T21 の結果(画像管理のルート)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 3
parent: "[[T21-orphan-routes]]"
depends_on:
  - "[[T21-orphan-routes]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T25-images-page.md(作業内容に追加)"
  - "tasks/T29-plugin-definition.md(capability の項目と、作業内容に追加)"
  - "tasks/T32-cloudflare-check.md(作業内容に追加)"
  - "plans/base64-image-plugin-spec.md(19 章)"
  - "playground/README.md(ログインの節に 1 行)"
  - "tasks/T21-1-handoff-orphan-routes.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
  - "[[base64-image-plugin-spec#10. 画像のライフサイクル]]"
  - "[[base64-image-plugin-spec#19. 対象外・将来の検討事項]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T21-1 T21 の結果(画像管理のルート)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-21-1`
> - 親タスク: [[T21-orphan-routes|T21]]
> - 着手の条件(依存): [[T21-orphan-routes|T21]]
> - このタスクを待つもの: なし([[T25-images-page|T25]]・[[T29-plugin-definition|T29]]・[[T32-cloudflare-check|T32]] はこの内容を前提に進める)

## 目的

T21 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T21 は、変更してよいファイルが自分のファイルとノート、仕様書の 9 章(判定)と 10 章だけだった。後続タスクへの影響は、ノートの「T29 への引き継ぎ」「T25 への引き継ぎ」「仕様書・他のタスクへの影響」「未解決・サブタスクの候補」に書いてリーダーに報告した。

## 作業内容

- [x] [[T25-images-page|T25]]: 応答の形とページ送り(`items: []` で `nextCursor` があれば続けて読む、`INVALID_CURSOR`)、`entryStatus` によるボタンの出し分けと操作のあとの表示。公開済みかどうかと参照元の全体の件数は、サブタスク T21-2 で足すこと
- [x] [[T29-plugin-definition|T29]]: capability の一覧に `content:restore` を足した。画像管理のルートと afterDelete の hook の登録のしかた
- [x] [[T32-cloudflare-check|T32]]: D1 での一覧とゴミ箱のクエリ数、並行に投げたときの応答時間、消されたコレクションの例外の形
- [x] 仕様書 19 章: 記録だけが残った画像(`missing`)の記録を消す操作を、将来の検討事項にした
- [x] `playground/README.md`: seed にあるコレクションを消すと、開発用ログインが 500 になること
- [x] 実行中の [[T24-list-column|T24]] には、ゴミ箱の状態を記録しないこと(今の仕様のまま)を、メッセージで伝えた

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク(T21-2・[[T23-upload-hook|T23]]・[[T24-list-column|T24]])は、これらのファイルを変更しない。

## 結果

- T21 の未解決の 1(一覧の項目に公開済みかどうかが無い)と 2(参照元の全体の件数が無い)は、T25 の画面に要るので、T25 より前にサブタスク T21-2 で足す。T21 を行ったチームメイトが、同じ worktree で続けて行う。
- 3(記録だけが残った画像を片付けるルート)は、起きるのが完全削除の hook の失敗などに限られるので、v1 では作らず、仕様書 19 章の将来の検討事項にした。T25 は、その画像に操作が無いことが分かる表示にする。
- 4(ゴミ箱の状態の記録)は、T21 の決定 7 のとおり見送る。仕様書 10 章に理由がある。
- 5(開発用ログインが 500 になる)は、playground を使う人が出会いうるので、`playground/README.md` のログインの節に書いた。
