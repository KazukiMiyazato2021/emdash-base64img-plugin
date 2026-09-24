---
id: T24
title: "コンテンツ一覧のサムネイル列を作る"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T14-admin-i18n-api]]"
soft_depends_on: []
blocks:
  - "[[T30-admin-entry]]"
files:
  - "src/admin/ThumbnailColumn.tsx"
  - "tests/admin/ThumbnailColumn.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)]]"
  - "[[base64-image-plugin-spec#17. 実装時に再確認する事項]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T24 コンテンツ一覧のサムネイル列を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T14-admin-i18n-api|T14]]
> - このタスクを待つもの: [[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)|仕様書 11.4]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17章]]

## 目的

仕様書 11.4 のコンテンツ一覧の列を作る。

## 作業内容

- [ ] `contentListColumns` の拡張を定義する
- [ ] `fetchManifest` で、コレクションごとにこのプラグインの widget のフィールドを特定する(単一画像を優先し、なければギャラリー)
- [ ] `collections`(同期関数)での判定方法を決める(仕様書 17 章の未決事項)
- [ ] `visibleItems` の分のサムネイルを、1回のリクエストでまとめて取得する
- [ ] 表示: サムネイル、「+N」、「—」、警告アイコン
- [ ] サムネイルは [[T14-admin-i18n-api|T14]] の `fetchThumbnails`(100 件ずつ)で取得する。`thumbnail: null` は `imageRefs` に無い画像(完全削除した・記録が無い)で、警告アイコンを出す。ゴミ箱に入った画像はサムネイルが返る(仕様書 11.4。[[T17-admin-data-routes#結果|T17]])。[[T21-orphan-routes|T21]] がゴミ箱の状態を記録することにしたら、それに合わせる
- [ ] 見た目のクラスは、管理画面の CSS にあるものだけを使う(管理画面の CSS はビルド済みで、プラグインのファイルを読まない)。無いクラスと枠の色は style で書く。テストでは `tests/admin/admin-css.ts` の `findMissingClasses(container, sourceTokens("<自分のソース>"))` で、使うクラスが CSS にあることを確かめる([[T22-1-admin-css-test-helper|T22-1]]、[[emdash-admin-plugin-ui-styling]])
- [ ] アイコンは `src/admin/parts/icons.tsx` の `UploadIcon`・`ImageMissingIcon`・`WarningIcon` を使える(`@phosphor-icons/react` はこのプラグインの peerDependencies に無いので、自前の SVG。飾りとして `aria-hidden`)。Kumo 2.6.0 の注意([[emdash-admin-plugin-ui-styling#Kumo 2.6.0 の注意点|知見ノート]]): `Loader` は英語の `aria-label="Loading"` と `role="status"` を持つ(飾りなら `aria-hidden` の要素で包み、伝えるなら訳した `aria-label` を渡す)。`Button` の名前は `title` でなく `aria-label` で付ける(`title` はツールチップで包む)。`Label`(`Input` の `label`)に `required={false}` を渡すと英語の「(optional)」が出る。Kumo の省略できる props に `undefined` になりうる値を渡すと、利用者の厳しい型チェック(`exactOptionalPropertyTypes`)で型エラーになるので、値があるときだけ展開する。読み上げの領域は `role="status"` でなく `<output>`(oxlint の `jsx-a11y/prefer-tag-over-role`)

## 完了条件

- [ ] コンポーネントのテスト
- [ ] 未決事項の結果を仕様書 17 章に反映した

## 変更してよいファイル

- `src/admin/ThumbnailColumn.tsx`
- `tests/admin/ThumbnailColumn.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
