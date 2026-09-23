---
id: T15
title: "サイト側の resolveBase64Images を作る"
type: 実装
status: todo
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
soft_depends_on:
  - "[[T09-spike-query-count]]"
blocks:
  - "[[T26-playground-pages]]"
files:
  - "src/site/resolve.ts"
  - "src/astro.ts"
  - "tests/site/resolve.test.ts"
spec:
  - "[[base64-image-plugin-spec#12. サイト側の描画]]"
tags:
  - task
  - impl
  - site
created: 2026-09-23
---

# T15 サイト側の resolveBase64Images を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]
> - 結果を後で反映する(着手はブロックしない): [[T09-spike-query-count|T09]]
> - このタスクを待つもの: [[T26-playground-pages|T26]]
> - 仕様: [[base64-image-plugin-spec#12. サイト側の描画|仕様書 12章]]

## 目的

仕様書 12 章のサイト側 API を作る。

## 作業内容

- [ ] `resolveBase64Images(refs)`: 重複を除き、ロケールごとに `getEmDashCollection("b64_images", { where: { id }, locale })` で取得する(50件ずつ)
- [ ] `MediaValue` 互換の値(alt は参照のもの)を返す。見つからない ID は警告ログを出す
- [ ] `src/astro.ts` から、関数・型・type guard を export する

## 完了条件

- [ ] 単体テスト(`getEmDashCollection` を差し替えて、分割・ロケール・欠損を確認する)
- [ ] [[T09-spike-query-count|T09]] の結果を反映した

## 変更してよいファイル

- `src/site/resolve.ts`
- `src/astro.ts`
- `tests/site/resolve.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
