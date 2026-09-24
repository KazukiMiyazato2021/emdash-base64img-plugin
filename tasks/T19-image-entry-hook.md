---
id: T19
title: "b64_images の保存 hook(検証)を作る"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T11-server-validation]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/hooks/image-entry.ts"
  - "tests/server/image-entry.test.ts"
spec:
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T19 b64_images の保存 hook(検証)を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T11-server-validation|T11]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8章]]

## 目的

仕様書 8 章の②。API / MCP / 管理画面など、どこから `b64_images` に書き込まれても中身を検証する。

## 作業内容

- [ ] `content:beforeSave` で、コレクションが `b64_images` のときだけ [[T11-server-validation|T11]] の検証を行う
- [ ] 部分更新、不正な値、上限を超えた値を拒否する
- [ ] `content:beforeSave` は 1 つのプラグインに 1 つしか登録できない。T19 は、[[T16-reference-hook|T16]] の `validateReferencesBeforeSave(event, ctx)` と同じ形の関数(例: `validateImageEntryBeforeSave(event, ctx)`)を export し、[[T29-plugin-definition|T29]] が 1 つの handler で振り分ける([[T16-reference-hook#T29 への引き継ぎ(登録のしかた)|T16]])
- [ ] 検証は `validateImageEntry(event.content[IMAGE_FIELD])`([[T11-server-validation#T18・T19 が使う export|T11]])。失敗したら `ContentSaveRejectedError` を投げる。ほかの例外は、EmDash が `CONTENT_HOOK_ERROR` の固定の文に置き換え、メッセージを隠す(`references/emdash/packages/core/src/emdash-runtime.ts:513`。[[server-image-validation]])

## 完了条件

- [ ] 単体テスト

## 変更してよいファイル

- `src/server/hooks/image-entry.ts`
- `tests/server/image-entry.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
