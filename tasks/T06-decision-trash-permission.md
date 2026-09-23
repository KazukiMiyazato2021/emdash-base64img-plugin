---
id: T06
title: "決定: 画像をゴミ箱に移動できる権限"
type: 決定
status: todo
wave: 0
depends_on: []
soft_depends_on: []
blocks:
  - "[[T21-orphan-routes]]"
  - "[[T25-images-page]]"
files:
  - "plans/base64-image-plugin-spec.md(10・17 章)"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#10. 画像のライフサイクル]]"
  - "[[base64-image-plugin-spec#17. 実装時に再確認する事項]]"
tags:
  - task
  - decision
created: 2026-09-23
---

# T06 決定: 画像をゴミ箱に移動できる権限

> [!info] 概要
> - 種別: 決定 / ウェーブ: 0
> - 着手の条件(依存): なし
> - このタスクを待つもの: [[T21-orphan-routes|T21]]、[[T25-images-page|T25]]
> - 仕様: [[base64-image-plugin-spec#10. 画像のライフサイクル|仕様書 10章]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17章]]

## 目的

仕様書 17 章の未決事項。画像をゴミ箱に移動できる権限を決める。利用者が判断する。

## 選択肢

- **案A**: Contributor 以上(合意済みの案)
- **案B**: Editor 以上(`content:delete_any`)。**推奨**。自分のコンテンツを削除する `content:delete_own` でも Author 以上で(`references/emdash/packages/auth/src/rbac.ts:22`)、画像は複数の投稿から参照されうるため

## 作業内容

- [ ] 案A と案B のどちらにするかを決める
- [ ] 決めた権限を、このノートの「結果」に書く

## 完了条件

- [ ] 決定をこのノートと、仕様書 10・17 章に記録した

## 変更してよいファイル

- `plans/base64-image-plugin-spec.md`(10・17 章)
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!todo] 未記入
> 根拠レベル(実測+公式ドキュメント / 実測のみ / 公式ドキュメントのみ / 外部ドキュメントのみ / 推測のみ)を付けて記録する。設計が変わる場合は、仕様書と関係するタスクも更新する。
