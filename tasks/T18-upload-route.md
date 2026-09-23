---
id: T18
title: "アップロード用ルートを作る"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T11-server-validation]]"
  - "[[T08-spike-route-body]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/routes/upload.ts"
  - "tests/server/upload.test.ts"
spec:
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T18 アップロード用ルートを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T11-server-validation|T11]]、[[T08-spike-route-body|T08]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#7. アップロード(書き込み経路)|仕様書 7章]]

## 目的

仕様書 7 章のアップロード処理を作る。

## 作業内容

- [ ] ルートの定義([[T08-spike-route-body|T08]] の結果に基づく body の宣言。権限は `content:create`)
- [ ] 検証([[T11-server-validation|T11]])→ `ctx.content.create("b64_images", …)` → `getVersioned` → `publish` → `imageRefs.put` → 参照を返す
- [ ] `target.entryId` があれば、最初の参照元として記録する
- [ ] 途中で失敗したときの後始末(作成済みのエントリの扱い)を決めて実装する

## 完了条件

- [ ] 単体テスト(偽の ctx): 正常系、検証エラー、作成・公開・保存それぞれの失敗
- [ ] 1リクエストのクエリ数が 50 に収まることを playground で確認した

## 変更してよいファイル

- `src/server/routes/upload.ts`
- `tests/server/upload.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
