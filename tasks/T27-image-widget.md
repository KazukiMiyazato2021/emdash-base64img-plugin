---
id: T27
title: "単一画像の widget を作る"
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
  - "src/admin/ImageField.tsx"
  - "tests/admin/ImageField.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T27 単一画像の widget を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 4
> - 着手の条件(依存): [[T22-widget-parts|T22]]、[[T23-upload-hook|T23]]
> - このタスクを待つもの: [[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

仕様書 11.2 の単一画像 widget(`base64-image:image`)を作る。

## 作業内容

- [ ] 状態: 空・処理中・設定済み・画像が見つからない
- [ ] 差し替え・削除・代替テキストの入力
- [ ] `onChange` に参照(`{ v, id, locale, width, height, alt }`)を渡す
- [ ] 失敗したときは、フィールドの値を変えない
- [ ] `<input type="file">` の `accept` は `image/*` にする。MIME タイプを並べると HEIC を選べなくなり、HEIC の案内を出せない。Firefox はデコードの間(6,400 万画素で 100ms 前後)画面を止めるので、「読み込み中…」はデコードを始める前に描画しておく([[T12-input-decode#後続タスク向けのメモ|T12]])
- [ ] 保存済みの画像のプレビューは `fetchPreviews`([[T14-admin-i18n-api|T14]]・[[T17-admin-data-routes|T17]])。`image: null` は「画像が見つかりません」。プレビューは `b64_images` を読むので、`imageRefs` に記録が無い画像(seed など)も表示されるが、保存は拒否される([[T16-reference-hook#他のタスクへの影響|T16]])。保存の前に気付けるよう、`fetchThumbnails` で `imageRefs` にあるかも確かめるかを決める
- [ ] 部品は `src/admin/parts/` から import する。props と使い方の例は [[T22-widget-parts#部品と props(T27・T28 向け)|T22 の表]] と [[T22-widget-parts#使い方の例|使い方の例]]。部品は表示と操作だけを受け持ち、アップロードの処理([[T23-upload-hook|T23]])や API の呼び出しは持たない
- [ ] `UploadProgress`・`ErrorMessage`・`UploadNotices` は、処理の有無にかかわらず常に描画する(読み上げの領域を先に DOM に置くため)。フォーカスは、処理を始めたらキャンセルボタンへ(`cancelButtonRef`)、キャンセル・失敗のあとはドロップゾーンへ(`buttonRef`)移す(押したボタンが消えるとフォーカスが失われるため)
- [ ] 「差し替え」「削除」などの文字は、自分の辞書(`defineMessages`)に持つ。部品は持たない。「差し替え」は `FileSelectButton`、削除は Kumo の `Button`(`secondary-destructive`)
- [ ] 空のときの `ImageDropZone` は `multiple` なし。複数のファイルがドロップ・貼り付けされたら、部品が「画像は 1 枚ずつ追加してください。」と出して `onFiles` を呼ばない(仕様書 11.2)。形式は部品では確かめないので、`onFiles` のファイルを T23 のフックに渡す
- [ ] 見た目のクラスは、管理画面の CSS にあるものだけを使う(管理画面の CSS はビルド済みで、プラグインのファイルを読まない)。無いクラスと枠の色は style で書く。テストでは `tests/admin/admin-css.ts` の `findMissingClasses(container, sourceTokens("<自分のソース>"))` で、使うクラスが CSS にあることを確かめる([[T22-1-admin-css-test-helper|T22-1]]、[[emdash-admin-plugin-ui-styling]])

## 完了条件

- [ ] コンポーネントのテスト

## 変更してよいファイル

- `src/admin/ImageField.tsx`
- `tests/admin/ImageField.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
