---
id: T12
title: "入力画像の判定とデコードを作る"
type: 実装
status: todo
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
soft_depends_on: []
blocks:
  - "[[T23-upload-hook]]"
files:
  - "src/client/input.ts"
  - "tests/client/input.test.ts"
spec:
  - "[[base64-image-plugin-spec#6.5 入力形式と上限(Q8)]]"
tags:
  - task
  - impl
  - client
created: 2026-09-23
---

# T12 入力画像の判定とデコードを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]
> - このタスクを待つもの: [[T23-upload-hook|T23]]
> - 仕様: [[base64-image-plugin-spec#6.5 入力形式と上限(Q8)|仕様書 6.5]]

## 目的

仕様書 6.5 のとおりに、受け付ける形式と上限を判定し、画像をデコードする。

## 作業内容

- [ ] 形式の判定(MIME タイプと、実際にデコードできたか): JPEG / PNG / WebP / AVIF / BMP は受け付ける。GIF は静止画にする注意を返す。HEIC / HEIF・SVG・TIFF などは拒否する
- [ ] 上限: ファイル 40MB、6,400万画素
- [ ] `createImageBitmap(file, { imageOrientation: "from-image" })` でデコードする
- [ ] 拒否の理由ごとのエラーコード(HEIC の案内文を含む)

## 完了条件

- [ ] 単体テスト(jsdom では画像をデコードできないので、判定ロジックとデコードの呼び出しを分けてテストする)

## 変更してよいファイル

- `src/client/input.ts`
- `tests/client/input.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
