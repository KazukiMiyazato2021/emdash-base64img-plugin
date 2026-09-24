---
id: T30
title: "管理画面のエントリ(src/admin.tsx)を組み立てる"
type: 実装
status: todo
wave: 5
depends_on:
  - "[[T24-list-column]]"
  - "[[T25-images-page]]"
  - "[[T27-image-widget]]"
  - "[[T28-gallery-widget]]"
soft_depends_on: []
blocks:
  - "[[T31-e2e]]"
  - "[[T32-cloudflare-check]]"
  - "[[T33-readme]]"
files:
  - "src/admin.tsx"
spec:
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T30 管理画面のエントリ(src/admin.tsx)を組み立てる

> [!info] 概要
> - 種別: 実装 / ウェーブ: 5
> - 着手の条件(依存): [[T24-list-column|T24]]、[[T25-images-page|T25]]、[[T27-image-widget|T27]]、[[T28-gallery-widget|T28]]
> - このタスクを待つもの: [[T31-e2e|T31]]、[[T32-cloudflare-check|T32]]、[[T33-readme|T33]]
> - 仕様: [[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

管理画面側の部品を `src/admin.tsx` にまとめる。

## 作業内容

- [ ] `fields`(`image` / `gallery`)、`pages`、`contentListColumns` を export する
- [ ] 一覧の列は `src/admin/ThumbnailColumn.tsx` の `thumbnailColumn` を `contentListColumns` に入れ、入口の読み込み時に `preloadThumbnailColumn()` を呼ぶ(マニフェストの先読み。呼ばないと、最初に SPA で開いた一覧で、このプラグインのフィールドの無いコレクションにも空の列が出る)。`thumbnailColumn` の項目(`label` など)は上書きしない。`label` は管理画面の辞書の ID で、文字列にすると訳されない([[T24-list-column#T30 が登録するもの|T24]]、[[emdash-admin-content-list-columns]])
- [ ] 入口を読み込むテストでは、先読みが `fetch`(`GET /_emdash/api/manifest`)を呼ぶ。`fetch` を差し替えておく(差し替えなくても例外は外に出ないが、失敗の要求が 1 回出る)([[T24-list-column#T30 が登録するもの|T24]])
- [ ] 画像管理ページは `export const pages = { [IMAGES_PAGE.path]: ImagesPage }` で登録する(`IMAGES_PAGE` は `src/shared/constants.ts`、`ImagesPage` は `src/admin/ImagesPage.tsx`。キーは T29 の `admin.pages` の `path` と同じ)。`ImagesPage` は `@emdash-cms/admin` の `useCurrentUser` を使うので、管理画面の中でだけ描ける。ページと一覧の列は同じ入口から読み込まれ、覚え書きを共有するので、つなぐための作業は無い([[T25-2-page-registration-prep#T29・T30 での使い方|T25-2]])
- [ ] widget は、入口の `fields` の `image` / `gallery`(`src/shared/constants.ts` の `WIDGET_KINDS` の名前)で描かれる。プラグイン定義の `admin.fieldWidgets`(T29)はマニフェストに載るだけで、`fields` に部品が無いと標準の入力(`json` なら textarea)になる。画像管理ページのサイドバーの項目も、入口で `pages` を export して初めて出る(それまでコマンドパレットの項目は 404「Plugin route not found」の画面を開く)。入口を組み立てたら、playground でサイドバーの項目・widget・一覧の列が出ることを確かめる([[T29-plugin-definition#他のタスクへの影響・サブタスクの候補|T29]]、[[emdash-plugin-definition-registration]])
- [ ] (検討)`b64_images` が無いサイトで、widget や画像管理ページが「`b64_images` がありません」と知らせるかを決める。マニフェストの `collections` には非表示の `b64_images` も入る(T29 の実測)。いまは、アップロードして初めて 500 `IMAGE_COLLECTION_MISSING` になり、サーバーのログにエラーが出る。作らないなら、理由を結果に書く([[T29-plugin-definition#他のタスクへの影響・サブタスクの候補|T29]])

## 完了条件

- [ ] playground の管理画面に、widget・一覧の列・画像管理ページが表示される

## 変更してよいファイル

- `src/admin.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
