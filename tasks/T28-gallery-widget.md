---
id: T28
title: "ギャラリーの widget を作る"
type: 実装
status: todo
wave: 4
depends_on:
  - "[[T22-widget-parts]]"
  - "[[T23-upload-hook]]"
soft_depends_on: []
blocks:
  - "[[T30-admin-entry]]"
files:
  - "src/admin/GalleryField.tsx"
  - "tests/admin/GalleryField.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T28 ギャラリーの widget を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 4
> - 着手の条件(依存): [[T22-widget-parts|T22]]、[[T23-upload-hook|T23]]
> - このタスクを待つもの: [[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

仕様書 11.3 のギャラリー widget(`base64-image:gallery`)を作る。

## 作業内容

- [ ] 複数枚の選択・ドロップと、1枚ずつ順に処理する流れ
- [ ] 並べ替え(ドラッグと ↑↓ ボタン)、1枚ずつの削除と代替テキストの入力
- [ ] `maxItems` の表示と、超える分の拒否
- [ ] ファイルの選択は [[T27-image-widget|T27]] と同じく `accept="image/*"` にし、デコードの前に「読み込み中…」を描画する([[T12-input-decode#後続タスク向けのメモ|T12]])
- [ ] 保存済みの画像のプレビューは `fetchPreviews`(10 件ずつ並行。[[T17-admin-data-routes|T17]])。`imageRefs` に記録が無い画像の扱いは [[T27-image-widget|T27]] と揃える([[T16-reference-hook#他のタスクへの影響|T16]])
- [ ] 部品は `src/admin/parts/` から import する。props と使い方の例は [[T22-widget-parts#部品と props(T27・T28 向け)|T22 の表]] と [[T22-widget-parts#使い方の例|使い方の例]]。部品は表示と操作だけを受け持ち、アップロードの処理([[T23-upload-hook|T23]])や API の呼び出しは持たない
- [ ] `UploadProgress`・`ErrorMessage`・`UploadNotices` は、処理の有無にかかわらず常に描画する(読み上げの領域を先に DOM に置くため)。フォーカスは、処理を始めたらキャンセルボタンへ(`cancelButtonRef`)、キャンセル・失敗のあとはドロップゾーンへ(`buttonRef`)移す(押したボタンが消えるとフォーカスが失われるため)
- [ ] `ImageDropZone` は `multiple` にし、`description` に「あと N 枚追加できます」を渡す(ボタンの説明にもなる)。上限に達したときと処理中は `disabled`。上限を超える分の拒否と、その文字は T28 が持つ
- [ ] 1 枚ずつの部品は、画像ごとに区別できる名前を付ける: `FileSelectButton` の `aria-label`(「画像 2 を差し替え」)、`AltTextInput` の `itemLabel`(「画像 2」)、`ImageNotFound` の `size="small"` と `removeLabel`、`ImagePreview` の `size="small"`(96px の枠)。進捗は `UploadProgress` の `index`・`total`、追加し終えた枚数は `completed`
- [ ] 「差し替え」「削除」「↑」「↓」「あと N 枚追加できます」などの文字は、自分の辞書(`defineMessages`)に持つ。部品は持たない
- [ ] 見た目のクラスは、管理画面の CSS にあるものだけを使う(管理画面の CSS はビルド済みで、プラグインのファイルを読まない)。無いクラスと枠の色は style で書く。テストでは `tests/admin/admin-css.ts` の `findMissingClasses(container, sourceTokens("<自分のソース>"))` で、使うクラスが CSS にあることを確かめる([[T22-1-admin-css-test-helper|T22-1]]、[[emdash-admin-plugin-ui-styling]])
- [ ] アップロードの応答の `ref`(`{ v, id, locale, width, height, alt: "" }`)は、そのままフィールドの値にする。`ref.locale` は画像エントリのロケール(サイトの既定)で、編集中のエントリのロケールではないので書き換えない。代替テキストは、入力欄の値を `alt` に入れる([[T18-upload-route#T23 が使う応答|T18]])
- [ ] アップロードのエラーは、T14 の `useErrorMessage` でコードごとの文言を出す。`UPLOAD_FAILED`(500)は、作った画像エントリをルートがゴミ箱に移したあとのエラー、`IMAGE_ENTRY_INVALID`(400)は保存 hook が作成を拒否したもの。どちらもフィールドの値は変えない。複数の画像を順に送るとき、失敗した画像は値に足さず、その画像のエラーを出して次の画像に進むかを決める

## 完了条件

- [ ] コンポーネントのテスト(並べ替えのキーボード操作を含む)

## 変更してよいファイル

- `src/admin/GalleryField.tsx`
- `tests/admin/GalleryField.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
