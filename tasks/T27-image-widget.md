---
id: T27
title: "単一画像の widget を作る"
type: 実装
status: todo
wave: 4
depends_on:
  - "[[T22-widget-parts]]"
  - "[[T23-upload-hook]]"
soft_depends_on: []
blocks:
  - "[[T30-admin-entry]]"
files:
  - "src/admin/ImageField.tsx"
  - "tests/admin/ImageField.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T27 単一画像の widget を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 4
> - 着手の条件(依存): [[T22-widget-parts|T22]]、[[T23-upload-hook|T23]]
> - このタスクを待つもの: [[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

仕様書 11.2 の単一画像 widget(`base64-image:image`)を作る。

## 作業内容

- [ ] 状態: 空・処理中・設定済み・画像が見つからない
- [ ] 差し替え・削除・代替テキストの入力
- [ ] `onChange` に参照(`{ v, id, locale, width, height, alt }`)を渡す
- [ ] 失敗したときは、フィールドの値を変えない

## 完了条件

- [ ] コンポーネントのテスト

## 変更してよいファイル

- `src/admin/ImageField.tsx`
- `tests/admin/ImageField.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
