---
id: T24
title: "コンテンツ一覧のサムネイル列を作る"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T14-admin-i18n-api]]"
soft_depends_on: []
blocks:
  - "[[T30-admin-entry]]"
files:
  - "src/admin/ThumbnailColumn.tsx"
  - "tests/admin/ThumbnailColumn.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)]]"
  - "[[base64-image-plugin-spec#17. 実装時に再確認する事項]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T24 コンテンツ一覧のサムネイル列を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T14-admin-i18n-api|T14]]
> - このタスクを待つもの: [[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)|仕様書 11.4]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17章]]

## 目的

仕様書 11.4 のコンテンツ一覧の列を作る。

## 作業内容

- [ ] `contentListColumns` の拡張を定義する
- [ ] `fetchManifest` で、コレクションごとにこのプラグインの widget のフィールドを特定する(単一画像を優先し、なければギャラリー)
- [ ] `collections`(同期関数)での判定方法を決める(仕様書 17 章の未決事項)
- [ ] `visibleItems` の分のサムネイルを、1回のリクエストでまとめて取得する
- [ ] 表示: サムネイル、「+N」、「—」、警告アイコン

## 完了条件

- [ ] コンポーネントのテスト
- [ ] 未決事項の結果を仕様書 17 章に反映した

## 変更してよいファイル

- `src/admin/ThumbnailColumn.tsx`
- `tests/admin/ThumbnailColumn.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
