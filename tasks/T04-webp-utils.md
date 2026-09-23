---
id: T04
title: "WebP と data URL の低レベル処理を作る"
type: 実装
status: todo
wave: 1
depends_on:
  - "[[T01-scaffold]]"
soft_depends_on: []
blocks:
  - "[[T11-server-validation]]"
  - "[[T13-encode-search]]"
files:
  - "src/shared/webp.ts"
  - "src/shared/data-url.ts"
  - "tests/shared/webp.test.ts"
  - "tests/fixtures/webp/**"
spec:
  - "[[base64-image-plugin-spec#6.2 サイズ予算(Q6)]]"
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
tags:
  - task
  - impl
  - shared
created: 2026-09-23
---

# T04 WebP と data URL の低レベル処理を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 1
> - 着手の条件(依存): [[T01-scaffold|T01]]
> - このタスクを待つもの: [[T11-server-validation|T11]]、[[T13-encode-search|T13]]
> - 仕様: [[base64-image-plugin-spec#6.2 サイズ予算(Q6)|仕様書 6.2]]、[[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8章]]

## 目的

サーバー側の検証と、ブラウザ側の圧縮処理の両方が使う低レベルの処理を用意する。

## 作業内容

- [ ] data URL の分解(`data:image/webp;base64,` で始まるか、base64 の文字種)
- [ ] base64 のデコード(`Uint8Array.fromBase64` があれば使い、なければ `atob`)
- [ ] WebP ヘッダーの解析(RIFF / WEBP、`VP8 ` / `VP8L` / `VP8X`)による寸法の取得
- [ ] 保存サイズの計算(`23 + 4 × ceil(B / 3)`)と、その逆算(予算から WebP 本体の上限を求める)
- [ ] テスト用 WebP の作成(cwebp で非可逆・可逆・透過つきを作り、`tests/fixtures/webp/` に置く)

## 完了条件

- [ ] 単体テスト: 3種類のチャンク、壊れたデータ、境界値(WebP 本体 74,982 / 74,983 バイト)
- [ ] 約 100KB の data URL の処理が 1ms 未満(仕様書 付録 A.4 と同程度)

## 変更してよいファイル

- `src/shared/webp.ts`
- `src/shared/data-url.ts`
- `tests/shared/webp.test.ts`
- `tests/fixtures/webp/**`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
