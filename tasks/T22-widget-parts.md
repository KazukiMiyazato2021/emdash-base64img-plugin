---
id: T22
title: "widget 共通の UI 部品を作る"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T14-admin-i18n-api]]"
soft_depends_on: []
blocks:
  - "[[T27-image-widget]]"
  - "[[T28-gallery-widget]]"
files:
  - "src/admin/parts/**"
  - "tests/admin/parts.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11.1 共通方針]]"
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T22 widget 共通の UI 部品を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T14-admin-i18n-api|T14]]
> - このタスクを待つもの: [[T27-image-widget|T27]]、[[T28-gallery-widget|T28]]
> - 仕様: [[base64-image-plugin-spec#11.1 共通方針|仕様書 11.1]]、[[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

単一画像とギャラリーの widget が共通で使う UI 部品を作る。

## 作業内容

- [ ] ドロップゾーン(ファイル選択・ドロップ・貼り付け、キーボード操作)
- [ ] 処理状況の表示(`aria-live`、キャンセルボタン)
- [ ] プレビュー(`<img width height>`)と情報表示(寸法・保存サイズ・画質)
- [ ] 代替テキストの入力(空欄のときの注意)
- [ ] エラー表示と「画像が見つかりません」の表示
- [ ] Kumo のコンポーネントを使う

## 完了条件

- [ ] コンポーネントのテスト(jsdom + Testing Library)
- [ ] 日本語・英語で表示でき、キーボードで操作できる

## 変更してよいファイル

- `src/admin/parts/**`
- `tests/admin/parts.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
