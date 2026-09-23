---
id: T16
title: "参照を持つコレクションの保存 hook(検証)を作る"
type: 実装
status: todo
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/hooks/references.ts"
  - "tests/server/references.test.ts"
spec:
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T16 参照を持つコレクションの保存 hook(検証)を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8章]]

## 目的

仕様書 8 章の③。参照を持つコレクションの `content:beforeSave` で参照を検証する。

## 作業内容

- [ ] 保存するコレクションのフィールド定義から、このプラグインの widget のフィールドを特定する(`ctx.schema.getCollection`)
- [ ] 参照の形、alt の長さ、ギャラリーの枚数と重複を検証する
- [ ] 参照している画像 ID が `imageRefs` にあるかを、`getMany` でまとめて確認する
- [ ] 部分更新(送られてきたフィールドだけ)に対応する
- [ ] 失敗したときは、どのフィールドの何が問題かをメッセージで返す

## 完了条件

- [ ] 単体テスト(偽の ctx を使う)

## 変更してよいファイル

- `src/server/hooks/references.ts`
- `tests/server/references.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
