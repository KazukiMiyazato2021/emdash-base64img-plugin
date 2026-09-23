---
id: T13
title: "リサイズ・画質探索・サムネイル生成を作る"
type: 実装
status: todo
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
  - "[[T04-webp-utils]]"
soft_depends_on:
  - "[[T05-spike-canvas-webp]]"
blocks:
  - "[[T23-upload-hook]]"
files:
  - "src/client/encode.ts"
  - "src/client/thumbnail.ts"
  - "tests/client/encode.test.ts"
spec:
  - "[[base64-image-plugin-spec#6.1 エンコード方式]]"
  - "[[base64-image-plugin-spec#6.2 サイズ予算(Q6)]]"
  - "[[base64-image-plugin-spec#6.3 リサイズと画質の方針(Q7)]]"
  - "[[base64-image-plugin-spec#6.4 サムネイル]]"
tags:
  - task
  - impl
  - client
created: 2026-09-23
---

# T13 リサイズ・画質探索・サムネイル生成を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]、[[T04-webp-utils|T04]]
> - 結果を後で反映する(着手はブロックしない): [[T05-spike-canvas-webp|T05]]
> - このタスクを待つもの: [[T23-upload-hook|T23]]
> - 仕様: [[base64-image-plugin-spec#6.1 エンコード方式|仕様書 6.1]]、[[base64-image-plugin-spec#6.2 サイズ予算(Q6)|仕様書 6.2]]、[[base64-image-plugin-spec#6.3 リサイズと画質の方針(Q7)|仕様書 6.3]]、[[base64-image-plugin-spec#6.4 サムネイル|仕様書 6.4]]

## 目的

仕様書 6.1〜6.4 のエンコード処理を作る。

## 作業内容

- [ ] canvas で長辺を `maxEdge` 以下に縮小する(拡大しない)
- [ ] 画質 `minQuality`〜0.92 の二分探索で、`maxStoredBytes` に収まる最高の画質を選ぶ
- [ ] 収まらなければ 0.8 倍に縮小して再試行し、長辺が `minEdge` を下回ったらエラーにする
- [ ] Blob の type が `image/webp` でなければ、非対応ブラウザとしてエラーにする(Safari)
- [ ] サムネイル生成(長辺 96px 程度、8,000 バイト以下)
- [ ] テストのため、エンコーダーを差し替えられるようにする
- [ ] キャンセル(`AbortSignal`)に対応する

## 完了条件

- [ ] 単体テスト: 偽のエンコーダーで、探索の結果・縮小の回数・エラーになる条件を確認する
- [ ] [[T05-spike-canvas-webp|T05]] の結果を反映した(既定値の調整が必要な場合)

## 変更してよいファイル

- `src/client/encode.ts`
- `src/client/thumbnail.ts`
- `tests/client/encode.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
