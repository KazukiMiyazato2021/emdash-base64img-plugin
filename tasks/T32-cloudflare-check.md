---
id: T32
title: "Cloudflare(wrangler dev + D1)で動作を確認する"
type: テスト
status: todo
wave: 6
depends_on:
  - "[[T26-playground-pages]]"
  - "[[T29-plugin-definition]]"
  - "[[T30-admin-entry]]"
soft_depends_on: []
blocks:
  - "[[T34-release]]"
files:
  - "playground/wrangler.jsonc"
  - "playground/astro.config.cloudflare.mjs"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#2. 動作環境と制約]]"
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - test
created: 2026-09-23
---

# T32 Cloudflare(wrangler dev + D1)で動作を確認する

> [!info] 概要
> - 種別: テスト / ウェーブ: 6
> - 着手の条件(依存): [[T26-playground-pages|T26]]、[[T29-plugin-definition|T29]]、[[T30-admin-entry|T30]]
> - このタスクを待つもの: [[T34-release|T34]]
> - 仕様: [[base64-image-plugin-spec#2. 動作環境と制約|仕様書 2章]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15章]]

## 目的

Node + SQLite だけでなく、workerd + D1 でも動くことを確かめる。

## 作業内容

- [ ] playground に wrangler の設定を追加する(D1 のみ、R2 なし)
- [ ] `wrangler dev` で主なシナリオを確認する(手動、または E2E の一部)
- [ ] 任意: 利用者のアカウントの Workers Free にデプロイし、CPU 時間とクエリ数を測る(手動。利用者の了承を得てから行う)

## 完了条件

- [ ] 結果をこのノートに根拠レベル付きで記録した

## 変更してよいファイル

- `playground/wrangler.jsonc`
- `playground/astro.config.cloudflare.mjs`
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!todo] 未記入
> 根拠レベル(実測+公式ドキュメント / 実測のみ / 公式ドキュメントのみ / 外部ドキュメントのみ / 推測のみ)を付けて記録する。設計が変わる場合は、仕様書と関係するタスクも更新する。
