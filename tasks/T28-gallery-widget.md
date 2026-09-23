---
id: T28
title: "ギャラリーの widget を作る"
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
  - "src/admin/GalleryField.tsx"
  - "tests/admin/GalleryField.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T28 ギャラリーの widget を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 4
> - 着手の条件(依存): [[T22-widget-parts|T22]]、[[T23-upload-hook|T23]]
> - このタスクを待つもの: [[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

仕様書 11.3 のギャラリー widget(`base64-image:gallery`)を作る。

## 作業内容

- [ ] 複数枚の選択・ドロップと、1枚ずつ順に処理する流れ
- [ ] 並べ替え(ドラッグと ↑↓ ボタン)、1枚ずつの削除と代替テキストの入力
- [ ] `maxItems` の表示と、超える分の拒否

## 完了条件

- [ ] コンポーネントのテスト(並べ替えのキーボード操作を含む)

## 変更してよいファイル

- `src/admin/GalleryField.tsx`
- `tests/admin/GalleryField.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
