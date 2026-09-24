---
id: T16-2
title: "imageRefs の getMany を分けて呼ぶ処理を共通にする"
type: 実装
status: done
wave: 2
parent: "[[T16-reference-hook]]"
depends_on:
  - "[[T16-reference-hook]]"
  - "[[T17-admin-data-routes]]"
soft_depends_on: []
blocks: []
files:
  - "src/server/image-refs.ts"
  - "src/server/routes/admin-data.ts(分割の部分だけ)"
  - "src/server/hooks/references.ts(分割の部分だけ)"
  - "tests/server/image-refs.test.ts"
  - "tests/server/admin-data.test.ts(import だけ)"
  - "tests/server/references.test.ts(import だけ)"
  - "tasks/T20-owner-tracking.md(作業内容に追加)"
  - "tasks/T21-orphan-routes.md(作業内容に追加)"
  - "tasks/T16-2-image-refs-batches.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#5.3 参照元メタデータ(プラグインストレージ `imageRefs`、キーは画像 ID)]]"
tags:
  - task
  - impl
  - subtask
created: 2026-09-24
---

# T16-2 imageRefs の getMany を分けて呼ぶ処理を共通にする

> [!info] 概要
> - 種別: 実装(予定外のサブタスク) / ウェーブ: 2 / ブランチ: `phase-2/t-16-2`
> - 親タスク: [[T16-reference-hook|T16]]
> - 着手の条件(依存): [[T16-reference-hook|T16]]、[[T17-admin-data-routes|T17]]
> - このタスクを待つもの: なし([[T20-owner-tracking|T20]]・[[T21-orphan-routes|T21]] はこの部品を使う)

## 目的

プラグインストレージ `imageRefs` の `getMany` を 50 件ずつに分けて呼ぶ処理を、1 か所にまとめる。

## 発生した理由

- EmDash 0.39.1 の `getMany` は ID を分けずに IN 句に入れる。D1 では 99 件から例外になる([[T17-admin-data-routes#結果|T17]] の実測)。
- [[T17-admin-data-routes|T17]](サムネイル取得のルート)と [[T16-reference-hook|T16]](参照の存在確認)は並行に作られた。どちらも、定数 `IMAGE_REFS_BATCH_SIZE`(50)と分割の処理を、自分のファイルに持っていた。
- フェーズ 3 の [[T20-owner-tracking|T20]](参照元の記録)も同じ処理を使う。3 つ目の複製ができる前にまとめる。

## 作業内容

- [x] `src/server/image-refs.ts`: `IMAGE_REFS_BATCH_SIZE`(50)と `getManyInBatches(storage, ids)` を作る
  - ID の重複を除く
  - 50 件ずつ並行に `getMany` を呼ぶ
  - 結果を 1 つの Map にまとめる
- [x] T17 の `handleThumbnails` と T16 の存在確認を、`getManyInBatches` を使う形にする(動作は同じ)
- [x] 両方のテストの `IMAGE_REFS_BATCH_SIZE` の import 先を変える
- [x] `tests/server/image-refs.test.ts` を作る
  - 空・見つからない ID・重複・分け方と順番
  - D1 の上限を模擬した偽物での 150 件
  - 並行に呼ぶこと
  - 失敗をそのまま返すこと
  - `StorageCollection` を渡せること(型)
- [x] T20・T21 のノートに、この部品を使うことを書く

## 完了条件

- [x] `npm run verify` が通る(3 つの型チェックを含む)
- [x] わざと入れた不具合をテストが見つける

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T12-input-decode|T12]])は、これらのファイルを変更しない。

## 結果

- T16 と T17 の既存のテスト(分割の件数と順番を含む)は、import 先を変えただけで、すべて通った。根拠: **実測のみ**
- わざと入れた不具合 5 種類は、すべてテストが失敗した。根拠: **実測のみ**
  - 分割を 100 件にする
  - 重複を除かない
  - 順に待つ(並行にしない)
  - 最初の結果だけを使う
  - 1 件ずつ少なく分ける
- `admin-data.ts` の `uniqueIds`(応答の順番を決める)は、そのまま残した。
