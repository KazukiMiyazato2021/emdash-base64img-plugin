---
id: T29
title: "プラグイン定義(src/index.ts)を組み立てる"
type: 実装
status: todo
wave: 4
depends_on:
  - "[[T07-spike-git-dependency]]"
  - "[[T16-reference-hook]]"
  - "[[T17-admin-data-routes]]"
  - "[[T18-upload-route]]"
  - "[[T19-image-entry-hook]]"
  - "[[T20-owner-tracking]]"
  - "[[T21-orphan-routes]]"
soft_depends_on: []
blocks:
  - "[[T31-e2e]]"
  - "[[T32-cloudflare-check]]"
  - "[[T33-readme]]"
files:
  - "src/index.ts"
  - "src/server/plugin.ts"
spec:
  - "[[base64-image-plugin-spec#4. アーキテクチャ]]"
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
  - "[[base64-image-plugin-spec#13. 設定]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T29 プラグイン定義(src/index.ts)を組み立てる

> [!info] 概要
> - 種別: 実装 / ウェーブ: 4
> - 着手の条件(依存): [[T07-spike-git-dependency|T07]]、[[T16-reference-hook|T16]]、[[T17-admin-data-routes|T17]]、[[T18-upload-route|T18]]、[[T19-image-entry-hook|T19]]、[[T20-owner-tracking|T20]]、[[T21-orphan-routes|T21]]
> - このタスクを待つもの: [[T31-e2e|T31]]、[[T32-cloudflare-check|T32]]、[[T33-readme|T33]]
> - 仕様: [[base64-image-plugin-spec#4. アーキテクチャ|仕様書 4章]]、[[base64-image-plugin-spec#7. アップロード(書き込み経路)|仕様書 7章]]、[[base64-image-plugin-spec#13. 設定|仕様書 13章]]

## 目的

サーバー側の各部品を `definePlugin` にまとめる。

## 作業内容

- [ ] capability: `schema:read` / `content:read` / `content:write` / `content:publish` / `content:revisions:read`
- [ ] ストレージ `imageRefs`(インデックス `createdAt`)
- [ ] ルート(アップロード・プレビュー・サムネイル・画像管理)と hook(beforeSave ×2、afterSave、afterDelete)を登録する
- [ ] `admin`(`entry`、`fieldWidgets`、`pages`)
- [ ] 起動時に `b64_images` があるかを確認し、なければエラーを出す
- [ ] descriptor 関数 `base64ImagePlugin()`
- [ ] [[T07-spike-git-dependency|T07]] の結果に合わせた配布形態(TS ソースのまま、またはビルドあり)

## 完了条件

- [ ] playground で起動し、各ルートと hook が動くことを手動で確認した

## 変更してよいファイル

- `src/index.ts`
- `src/server/plugin.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
