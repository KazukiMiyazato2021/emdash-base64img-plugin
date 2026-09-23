---
id: T03
title: "共有の型・スキーマ・定数を定める"
type: 実装
status: todo
wave: 1
depends_on:
  - "[[T01-scaffold]]"
soft_depends_on: []
blocks:
  - "[[T11-server-validation]]"
  - "[[T12-input-decode]]"
  - "[[T13-encode-search]]"
  - "[[T14-admin-i18n-api]]"
  - "[[T15-site-resolve]]"
  - "[[T16-reference-hook]]"
  - "[[T17-admin-data-routes]]"
  - "[[T20-owner-tracking]]"
  - "[[T21-orphan-routes]]"
files:
  - "src/shared/constants.ts"
  - "src/shared/types.ts"
  - "src/shared/schema.ts"
  - "src/shared/options.ts"
  - "src/shared/errors.ts"
  - "src/shared/pipeline.ts"
  - "tests/shared/schema.test.ts"
spec:
  - "[[base64-image-plugin-spec#5. データモデル]]"
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
  - "[[base64-image-plugin-spec#13. 設定]]"
tags:
  - task
  - impl
  - shared
created: 2026-09-23
---

# T03 共有の型・スキーマ・定数を定める

> [!info] 概要
> - 種別: 実装 / ウェーブ: 1
> - 着手の条件(依存): [[T01-scaffold|T01]]
> - このタスクを待つもの: [[T11-server-validation|T11]]、[[T12-input-decode|T12]]、[[T13-encode-search|T13]]、[[T14-admin-i18n-api|T14]]、[[T15-site-resolve|T15]]、[[T16-reference-hook|T16]]、[[T17-admin-data-routes|T17]]、[[T20-owner-tracking|T20]]、[[T21-orphan-routes|T21]]
> - 仕様: [[base64-image-plugin-spec#5. データモデル|仕様書 5章]]、[[base64-image-plugin-spec#7. アップロード(書き込み経路)|仕様書 7章]]、[[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8章]]、[[base64-image-plugin-spec#13. 設定|仕様書 13.2]]

## 目的

サーバー・管理画面・サイト側の各タスクが並列に実装できるよう、データの形とインターフェースを先に固める。**多くのタスクがこれを待つので、最優先で小さく仕上げる。**

## 作業内容

- [ ] 定数: プラグイン ID `base64-image`、widget 名(`image` / `gallery`)、コレクション `b64_images`、ストレージ `imageRefs`、固定上限(保存 500,000 / サムネイル 8,000 / alt 1,000 文字)
- [ ] フィールド options の型と既定値の補完(`maxStoredBytes` 100000 / `maxEdge` 1600 / `minQuality` 0.6 / `minEdge` 480 / `maxItems` 10)
- [ ] zod スキーマと型: 画像エントリの値、参照 `{ v, id, locale, width, height, alt }`、ギャラリー(参照の配列)、`imageRefs` のメタデータ
- [ ] type guard: `isBase64ImageRef` / `isBase64ImageGallery`
- [ ] 各ルートの入出力の型: アップロード、プレビュー取得、サムネイル取得、画像管理(一覧・状態・ゴミ箱)
- [ ] エラーコード一覧(`SCREAMING_SNAKE_CASE`)
- [ ] 圧縮処理のインターフェース: デコード結果、エンコーダー関数、圧縮結果の型

## 完了条件

- [ ] スキーマの単体テスト(正常な値・境界値・不正な値)
- [ ] 仕様書 5・7・8 章の形と一致している

## 変更してよいファイル

- `src/shared/constants.ts`
- `src/shared/types.ts`
- `src/shared/schema.ts`
- `src/shared/options.ts`
- `src/shared/errors.ts`
- `src/shared/pipeline.ts`
- `tests/shared/schema.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## メモ

- 確定後に形を変えると多くのタスクに影響する。変更が必要になったら、影響するタスクの担当と調整する。
