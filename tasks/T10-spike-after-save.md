---
id: T10
title: "調査: afterSave に渡される内容を確かめる"
type: スパイク
status: todo
wave: 2
depends_on:
  - "[[T02-playground]]"
soft_depends_on: []
blocks:
  - "[[T20-owner-tracking]]"
  - "[[T21-orphan-routes]]"
files:
  - "spikes/after-save/**(使い捨て)"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
  - "[[base64-image-plugin-spec#17. 実装時に再確認する事項]]"
tags:
  - task
  - spike
created: 2026-09-23
---

# T10 調査: afterSave に渡される内容を確かめる

> [!info] 概要
> - 種別: スパイク / ウェーブ: 2
> - 着手の条件(依存): [[T02-playground|T02]]
> - このタスクを待つもの: [[T20-owner-tracking|T20]]、[[T21-orphan-routes|T21]]
> - 仕様: [[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9章]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17章]]

## 目的

仕様書 17 章の未決事項。下書きを保存したとき、`content:afterSave` に下書きのデータが渡るのか、公開版のデータが渡るのかを確かめる(`references/emdash/packages/core/src/emdash-runtime.ts:3670`)。

## 作業内容

- [ ] 使い捨ての hook で、新規作成・下書き保存・公開・自動保存・複製のときに渡される内容を記録する
- [ ] `ctx.content.get` と `getRevision` で、公開版と下書きをそれぞれ取得できることを確認する

## 完了条件

- [ ] 結果を記録し、[[T20-owner-tracking|T20]] と [[T21-orphan-routes|T21]] の前提を確定した

## 変更してよいファイル

- `spikes/after-save/**`(使い捨て)
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!todo] 未記入
> 根拠レベル(実測+公式ドキュメント / 実測のみ / 公式ドキュメントのみ / 外部ドキュメントのみ / 推測のみ)を付けて記録する。設計が変わる場合は、仕様書と関係するタスクも更新する。
