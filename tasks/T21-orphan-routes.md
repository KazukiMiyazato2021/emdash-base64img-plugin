---
id: T21
title: "未使用画像の判定と画像管理ルートを作る"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T03-shared-contracts]]"
  - "[[T06-decision-trash-permission]]"
  - "[[T10-spike-after-save]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/orphans.ts"
  - "src/server/routes/images-admin.ts"
  - "src/server/hooks/image-deleted.ts"
  - "tests/server/orphans.test.ts"
spec:
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
  - "[[base64-image-plugin-spec#10. 画像のライフサイクル]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T21 未使用画像の判定と画像管理ルートを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T03-shared-contracts|T03]]、[[T06-decision-trash-permission|T06]]、[[T10-spike-after-save|T10]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9章]]、[[base64-image-plugin-spec#10. 画像のライフサイクル|仕様書 10章]]

## 目的

仕様書 9 章の判定と、10 章の削除操作のサーバー側を作る。

## 作業内容

- [ ] 一覧ルート: `imageRefs` を `createdAt` 順に 10 件程度ずつ取得し、参照元ごとに公開版と下書き(`getRevision`)を確認して状態を判定する
- [ ] 状態: 使用中 / 参照元が削除された / 参照元から外された / 参照元なし
- [ ] ゴミ箱へ移動するルート([[T06-decision-trash-permission|T06]] で決めた権限)
- [ ] `content:afterDelete` で `b64_images` が完全削除されたら、`imageRefs` からも削除する
- [ ] 1リクエストのクエリ数が 50 未満になるよう、1回に扱う件数を計算して決める

## 完了条件

- [ ] 単体テスト(偽の ctx で各状態を再現する)

## 変更してよいファイル

- `src/server/orphans.ts`
- `src/server/routes/images-admin.ts`
- `src/server/hooks/image-deleted.ts`
- `tests/server/orphans.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
