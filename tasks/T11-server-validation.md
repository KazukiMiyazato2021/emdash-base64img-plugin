---
id: T11
title: "サーバー側の検証ロジックを作る"
type: 実装
status: todo
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
  - "[[T04-webp-utils]]"
soft_depends_on: []
blocks:
  - "[[T18-upload-route]]"
  - "[[T19-image-entry-hook]]"
files:
  - "src/server/validate.ts"
  - "tests/server/validate.test.ts"
spec:
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T11 サーバー側の検証ロジックを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]、[[T04-webp-utils|T04]]
> - このタスクを待つもの: [[T18-upload-route|T18]]、[[T19-image-entry-hook|T19]]
> - 仕様: [[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8章]]

## 目的

アップロード用ルートと保存 hook が共通で使う検証処理を、純粋な関数として作る。

## 作業内容

- [ ] アップロード入力の検証(仕様書 8 章の①): data URL の形式と長さ、WebP の中身、寸法の一致、長辺 ≤ `maxEdge`、サムネイル
- [ ] 画像エントリの値の検証(②で使う)
- [ ] フィールド定義(`widget` / `options`)から、適用する上限を決める処理
- [ ] エラーは [[T03-shared-contracts|T03]] のエラーコードで返す

## 完了条件

- [ ] 単体テスト: 正常系、各エラー、境界値(保存 100,000 / 100,001 バイト、固定上限 500,000)

## 変更してよいファイル

- `src/server/validate.ts`
- `tests/server/validate.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
