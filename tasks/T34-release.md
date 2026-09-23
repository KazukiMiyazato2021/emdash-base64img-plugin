---
id: T34
title: "v0.1.0 をリリースする"
type: リリース
status: todo
wave: 7
depends_on:
  - "[[T31-e2e]]"
  - "[[T32-cloudflare-check]]"
  - "[[T33-readme]]"
soft_depends_on: []
blocks: []
files:
  - "package.json(version)"
  - "plans/base64-image-plugin-spec.md(status)"
spec:
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
tags:
  - task
  - release
created: 2026-09-23
---

# T34 v0.1.0 をリリースする

> [!info] 概要
> - 種別: リリース / ウェーブ: 7
> - 着手の条件(依存): [[T31-e2e|T31]]、[[T32-cloudflare-check|T32]]、[[T33-readme|T33]]
> - このタスクを待つもの: なし
> - 仕様: [[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14章]]

## 目的

git 依存で配布する最初のバージョンを作る。

## 作業内容

- [ ] バージョンを 0.1.0 にして、タグ `v0.1.0` を作る(GitHub への push は利用者の確認を得てから)
- [ ] 別の空のサイトから `github:<owner>/emdash-base64img-plugin#v0.1.0` でインストールし、起動を確認する
- [ ] 仕様書の status を更新する

## 完了条件

- [ ] 別のサイトで動作を確認できた

## 変更してよいファイル

- `package.json`(version)
- `plans/base64-image-plugin-spec.md`(status)

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
