---
id: T33
title: "README と導入手順を書く"
type: ドキュメント
status: todo
wave: 6
depends_on:
  - "[[T29-plugin-definition]]"
  - "[[T30-admin-entry]]"
soft_depends_on: []
blocks:
  - "[[T34-release]]"
files:
  - "README.md"
spec:
  - "[[base64-image-plugin-spec#13. 設定]]"
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
  - "[[base64-image-plugin-spec#18. 既知の制約とリスク]]"
tags:
  - task
  - docs
created: 2026-09-23
---

# T33 README と導入手順を書く

> [!info] 概要
> - 種別: ドキュメント / ウェーブ: 6
> - 着手の条件(依存): [[T29-plugin-definition|T29]]、[[T30-admin-entry|T30]]
> - このタスクを待つもの: [[T34-release|T34]]
> - 仕様: [[base64-image-plugin-spec#13. 設定|仕様書 13章]]、[[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14章]]、[[base64-image-plugin-spec#18. 既知の制約とリスク|仕様書 18章]]

## 目的

自分のサイトにこのプラグインを入れるための手順をまとめる。

## 作業内容

- [ ] インストール(git 依存でタグを指定する方法。非公開リポジトリの場合のトークン)
- [ ] `astro.config.mjs` の設定(storage を指定しない)
- [ ] seed(`b64_images` とフィールドの定義)と options の一覧
- [ ] サイト側の使い方(`resolveBase64Images` と `Image`、一覧ページでまとめて解決する方法)
- [ ] 制約(Safari 非対応、HEIC 非対応、容量、バックアップ、標準の `b64_images` の画面を使わないこと)

## 完了条件

- [ ] README の手順だけで、playground と同じ構成を再現できる

## 変更してよいファイル

- `README.md`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
