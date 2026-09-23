---
id: T09
title: "スパイク: 画像の解決にかかるクエリ数を測る"
type: スパイク
status: todo
wave: 2
depends_on:
  - "[[T02-playground]]"
soft_depends_on: []
blocks: []
files:
  - "spikes/query-count/**(使い捨て)"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#12. サイト側の描画]]"
  - "[[base64-image-plugin-spec#16. 実装前の検証(スパイク)]]"
tags:
  - task
  - spike
created: 2026-09-23
---

# T09 スパイク: 画像の解決にかかるクエリ数を測る

> [!info] 概要
> - 種別: スパイク / ウェーブ: 2
> - 着手の条件(依存): [[T02-playground|T02]]
> - このタスクを待つもの: なし
> - 仕様: [[base64-image-plugin-spec#12. サイト側の描画|仕様書 12章]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|仕様書 16章]]

## 目的

仕様書 16 章の3つ目。`getEmDashCollection("b64_images", { where: { id: [...] } })` が実際に何クエリかかるかを測る。

## 作業内容

- [ ] playground に画像エントリを 10〜50 件作る(プラグイン経由と seed 経由の両方。authorId の有無で差が出るかを見る)
- [ ] Kysely のクエリログなどで、ID 10件 / 50件 / 51件のときのクエリ数を数える
- [ ] locale を明示したときとしないときの挙動を確認する

## 完了条件

- [ ] 結果を記録し、[[T15-site-resolve|T15]] の分割単位とクエリ数を確定した

## 変更してよいファイル

- `spikes/query-count/**`(使い捨て)
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!todo] 未記入
> 根拠レベル(実測+公式ドキュメント / 実測のみ / 公式ドキュメントのみ / 外部ドキュメントのみ / 推測のみ)を付けて記録する。設計が変わる場合は、仕様書と関係するタスクも更新する。
