---
id: T26
title: "playground に E2E 用のページとデータを用意する"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T02-playground]]"
  - "[[T15-site-resolve]]"
soft_depends_on: []
blocks:
  - "[[T31-e2e]]"
  - "[[T32-cloudflare-check]]"
files:
  - "playground/src/pages/**"
  - "playground/seed/**"
  - "e2e/fixtures/**"
spec:
  - "[[base64-image-plugin-spec#12. サイト側の描画]]"
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - impl
  - playground
created: 2026-09-23
---

# T26 playground に E2E 用のページとデータを用意する

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T02-playground|T02]]、[[T15-site-resolve|T15]]
> - このタスクを待つもの: [[T31-e2e|T31]]、[[T32-cloudflare-check|T32]]
> - 仕様: [[base64-image-plugin-spec#12. サイト側の描画|仕様書 12章]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15章]]

## 目的

E2E と手動確認のために、サイト側のページとテストデータを用意する。

## 作業内容

- [ ] 記事一覧ページ(カード表示。表示するエントリの参照を `resolveBase64Images` で1回で解決する)
- [ ] 表示用の画像は、アップロードのルートで作る(seed の `b64_images` には `imageRefs` の記録が無く、それを参照する投稿は保存 hook で拒否され、管理画面で保存できない。[[T16-reference-hook#seed の画像の扱い|T16]])。作り方(スクリプトか手順)を `playground/README.md` に書く
- [ ] サイト側の API は `images.get(ref)`(参照を渡す。[[T15-site-resolve#結果|T15]])
- [ ] 記事詳細ページ(カバーとギャラリー。LCP の画像に `priority`)
- [ ] E2E 用の画像ファイルを作るスクリプト(形式ごとの画像、巨大な画像。HEIC は MIME タイプを偽ったファイルで代用する)

## 完了条件

- [ ] ページが表示され、`<img>` に width / height が出力される

## 変更してよいファイル

- `playground/src/pages/**`
- `playground/seed/**`
- `e2e/fixtures/**`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
