---
id: T17
title: "管理画面用のデータ取得ルートを作る"
type: 実装
status: todo
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/routes/admin-data.ts"
  - "tests/server/admin-data.test.ts"
spec:
  - "[[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)]]"
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T17 管理画面用のデータ取得ルートを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)|仕様書 11.4]]、[[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

widget のプレビューと、一覧のサムネイル列が使うデータ取得ルートを作る。

## 作業内容

- [ ] プレビュー取得: 画像 ID(最大 `maxItems` 件)を受け取り、`ctx.content.get` で本体を返す(1リクエストのクエリ数上限 50 に注意する)
- [ ] サムネイル取得: 画像 ID(最大 100 件)を受け取り、`imageRefs.getMany` で `thumb` を返す(バインド変数の上限を考えて分割する)
- [ ] 権限は `content:read`

## 完了条件

- [ ] 単体テスト(偽の ctx を使う)

## 変更してよいファイル

- `src/server/routes/admin-data.ts`
- `tests/server/admin-data.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
