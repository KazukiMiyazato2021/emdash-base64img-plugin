---
id: T23
title: "アップロード処理の React フックを作る"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T12-input-decode]]"
  - "[[T13-encode-search]]"
  - "[[T14-admin-i18n-api]]"
soft_depends_on: []
blocks:
  - "[[T27-image-widget]]"
  - "[[T28-gallery-widget]]"
files:
  - "src/admin/hooks/**"
  - "tests/admin/hooks.test.ts"
spec:
  - "[[base64-image-plugin-spec#4.2 アップロードの流れ]]"
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T23 アップロード処理の React フックを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T12-input-decode|T12]]、[[T13-encode-search|T13]]、[[T14-admin-i18n-api|T14]]
> - このタスクを待つもの: [[T27-image-widget|T27]]、[[T28-gallery-widget|T28]]
> - 仕様: [[base64-image-plugin-spec#4.2 アップロードの流れ|仕様書 4.2]]、[[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

「デコード → 圧縮 → サムネイル → アップロード → 参照を返す」の一連の処理を、widget から使えるフックにまとめる。

## 作業内容

- [ ] [[T12-input-decode|T12]]・[[T13-encode-search|T13]]・[[T14-admin-i18n-api|T14]] を組み合わせた `useImageUpload`(進捗・キャンセル・エラーを状態として返す)
- [ ] 保存済み画像のプレビュー取得(`usePreviewImages`)
- [ ] 複数ファイルを1枚ずつ順に処理する仕組み(ギャラリー用)

## 完了条件

- [ ] フックのテスト(エンコーダーと API をモックにする)

## 変更してよいファイル

- `src/admin/hooks/**`
- `tests/admin/hooks.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
