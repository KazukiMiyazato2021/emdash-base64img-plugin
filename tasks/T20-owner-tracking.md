---
id: T20
title: "参照元の記録(afterSave)を作る"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T03-shared-contracts]]"
  - "[[T10-spike-after-save]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/hooks/owners.ts"
  - "tests/server/owners.test.ts"
spec:
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T20 参照元の記録(afterSave)を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T03-shared-contracts|T03]]、[[T10-spike-after-save|T10]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9章]]

## 目的

仕様書 9 章の記録処理を作る。

## 作業内容

- [ ] `content:afterSave` で、保存されたエントリの中の参照を取り出す
- [ ] `imageRefs.getMany` → `owners` に追記 → `putMany`(1〜2クエリ)
  - 読むときは `getManyInBatches`(`src/server/image-refs.ts`)を使う。`getMany` は ID を分けずに IN 句に入れ、D1 では 99 件から例外になるので、50 件ずつに分ける([[T16-2-image-refs-batches|T16-2]])
  - このプラグインのフィールドは `getFieldWidgetKind`(`src/server/validate.ts`)で判定する(`json` 型で、かつ widget がこのプラグインのもの。[[T11-server-validation|T11]]・[[T16-reference-hook|T16]] と同じ規則)
- [ ] 追記だけを行い、削除はしない。同じ参照元は重複させない
- [ ] afterSave は遅れて実行されるので、例外は外に出さずにログに出す
- [ ] [[T10-spike-after-save#結果|T10]] の結果に合わせる(仕様書 9 章):
  - 参照は `event.content.data`(下書き)と `event.content.liveData`(列の値)の両方から集める
  - `content:afterPublish` でも同じ処理をする(一覧の一括公開では afterSave が呼ばれない)
  - hook に `errorPolicy: "continue"` を指定する
  - `b64_images` と、このプラグインの widget を持たないコレクションは読み飛ばす

## 完了条件

- [ ] 単体テスト
- [ ] [[T10-spike-after-save|T10]] の結果(渡される内容)に合った実装になっている

## 変更してよいファイル

- `src/server/hooks/owners.ts`
- `tests/server/owners.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
