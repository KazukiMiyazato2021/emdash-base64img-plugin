---
id: T25
title: "画像管理ページを作る"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T14-admin-i18n-api]]"
  - "[[T06-decision-trash-permission]]"
soft_depends_on: []
blocks:
  - "[[T30-admin-entry]]"
files:
  - "src/admin/ImagesPage.tsx"
  - "tests/admin/ImagesPage.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11.5 画像管理ページ]]"
  - "[[base64-image-plugin-spec#10. 画像のライフサイクル]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T25 画像管理ページを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T14-admin-i18n-api|T14]]、[[T06-decision-trash-permission|T06]]
> - このタスクを待つもの: [[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11.5 画像管理ページ|仕様書 11.5]]、[[base64-image-plugin-spec#10. 画像のライフサイクル|仕様書 10章]]

## 目的

仕様書 11.5 の画像管理ページを作る。

## 作業内容

- [ ] 一覧(サムネイル・寸法・保存サイズ・参照元へのリンク・状態バッジ・作成日時)とページ送り
- [ ] 「参照されていない」は「消しても安全」ではない、という注意の表示
- [ ] ゴミ箱への移動([[T06-decision-trash-permission|T06]] で決めた権限)と、完全削除(管理者のみ。確認ダイアログ付き)

## 完了条件

- [ ] コンポーネントのテスト

## 変更してよいファイル

- `src/admin/ImagesPage.tsx`
- `tests/admin/ImagesPage.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
