---
id: T14
title: "管理画面の文言(i18n)と API クライアントを作る"
type: 実装
status: todo
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
soft_depends_on: []
blocks:
  - "[[T22-widget-parts]]"
  - "[[T23-upload-hook]]"
  - "[[T24-list-column]]"
  - "[[T25-images-page]]"
files:
  - "src/client/i18n.ts"
  - "src/client/error-messages.ts"
  - "src/client/api.ts"
  - "tests/client/api.test.ts"
spec:
  - "[[base64-image-plugin-spec#11.1 共通方針]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T14 管理画面の文言(i18n)と API クライアントを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]
> - このタスクを待つもの: [[T22-widget-parts|T22]]、[[T23-upload-hook|T23]]、[[T24-list-column|T24]]、[[T25-images-page|T25]]
> - 仕様: [[base64-image-plugin-spec#11.1 共通方針|仕様書 11.1]]

## 目的

管理画面側の各タスクが共通で使う、文言と通信処理を用意する。

## 作業内容

- [ ] 文言の仕組み: `<html lang>` で日本語と英語を切り替える(どちらでもなければ英語)。各部品が自分のファイル内に ja / en の辞書を持てるヘルパーにする
- [ ] エラーコードに対応する文言(ja / en)
- [ ] API クライアント: アップロード、プレビュー取得、サムネイル取得、画像管理(一覧・ゴミ箱)、標準の完全削除 API(`DELETE /_emdash/api/content/b64_images/{id}/permanent`)
- [ ] CSRF ヘッダー `X-EmDash-Request: 1` の付与と、エラーコードから文言への変換

## 完了条件

- [ ] 単体テスト(fetch をモックにする)

## 変更してよいファイル

- `src/client/i18n.ts`
- `src/client/error-messages.ts`
- `src/client/api.ts`
- `tests/client/api.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
