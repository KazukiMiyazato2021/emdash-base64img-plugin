---
id: T08
title: "スパイク: プラグインのルートの body 上限を確かめる"
type: スパイク
status: todo
wave: 2
depends_on:
  - "[[T02-playground]]"
soft_depends_on: []
blocks:
  - "[[T18-upload-route]]"
files:
  - "spikes/route-body/**(使い捨て)"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
  - "[[base64-image-plugin-spec#16. 実装前の検証(スパイク)]]"
tags:
  - task
  - spike
created: 2026-09-23
---

# T08 スパイク: プラグインのルートの body 上限を確かめる

> [!info] 概要
> - 種別: スパイク / ウェーブ: 2
> - 着手の条件(依存): [[T02-playground|T02]]
> - このタスクを待つもの: [[T18-upload-route|T18]]
> - 仕様: [[base64-image-plugin-spec#7. アップロード(書き込み経路)|仕様書 7章]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|仕様書 16章]]

## 目的

仕様書 16 章の2つ目。native プラグインのルートが、約 100KB(と固定上限の 500KB)の JSON を受け取れるかを確かめる。

## 作業内容

- [ ] 使い捨てのルートを作り、100KB / 500KB / 1MiB 超の body を送る
- [ ] `request` の宣言(body の形式と上限)の書き方と、上限を超えたときのエラーの形を確認する
- [ ] 管理画面から呼ぶときの CSRF ヘッダー(`X-EmDash-Request: 1`)と、権限チェックの挙動を確認する

## 完了条件

- [ ] 結果を記録し、[[T18-upload-route|T18]] で使うルートの宣言方法をまとめた

## 変更してよいファイル

- `spikes/route-body/**`(使い捨て)
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!todo] 未記入
> 根拠レベル(実測+公式ドキュメント / 実測のみ / 公式ドキュメントのみ / 外部ドキュメントのみ / 推測のみ)を付けて記録する。設計が変わる場合は、仕様書と関係するタスクも更新する。
