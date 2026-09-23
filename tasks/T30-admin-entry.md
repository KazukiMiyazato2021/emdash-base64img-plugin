---
id: T30
title: "管理画面のエントリ(src/admin.tsx)を組み立てる"
type: 実装
status: todo
wave: 5
depends_on:
  - "[[T24-list-column]]"
  - "[[T25-images-page]]"
  - "[[T27-image-widget]]"
  - "[[T28-gallery-widget]]"
soft_depends_on: []
blocks:
  - "[[T31-e2e]]"
  - "[[T32-cloudflare-check]]"
  - "[[T33-readme]]"
files:
  - "src/admin.tsx"
spec:
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T30 管理画面のエントリ(src/admin.tsx)を組み立てる

> [!info] 概要
> - 種別: 実装 / ウェーブ: 5
> - 着手の条件(依存): [[T24-list-column|T24]]、[[T25-images-page|T25]]、[[T27-image-widget|T27]]、[[T28-gallery-widget|T28]]
> - このタスクを待つもの: [[T31-e2e|T31]]、[[T32-cloudflare-check|T32]]、[[T33-readme|T33]]
> - 仕様: [[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

管理画面側の部品を `src/admin.tsx` にまとめる。

## 作業内容

- [ ] `fields`(`image` / `gallery`)、`pages`、`contentListColumns` を export する

## 完了条件

- [ ] playground の管理画面に、widget・一覧の列・画像管理ページが表示される

## 変更してよいファイル

- `src/admin.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
