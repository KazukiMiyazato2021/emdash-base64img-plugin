---
id: T28-1
title: "T28 の結果(ギャラリーの widget)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 4
parent: "[[T28-gallery-widget]]"
depends_on:
  - "[[T28-gallery-widget]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T30-admin-entry.md(登録の項目を更新)"
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "tasks/T33-readme.md(作業内容に追加)"
  - "tasks/T28-gallery-widget.md(反映済みの注記だけ)"
  - "tasks/T28-1-handoff-gallery-widget.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#11.3 ギャラリー widget(`base64-image:gallery`)]]"
  - "[[base64-image-plugin-spec#18. 既知の制約とリスク]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T28-1 T28 の結果(ギャラリーの widget)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 4 / ブランチ: `phase-4/t-28-1`
> - 親タスク: [[T28-gallery-widget|T28]]
> - 着手の条件(依存): [[T28-gallery-widget|T28]]
> - このタスクを待つもの: なし([[T30-admin-entry|T30]]・[[T31-e2e|T31]]・[[T33-readme|T33]] はこの内容を前提に進める)

## 目的

T28 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T28 は、変更してよいファイルが `src/admin/GalleryField.tsx` とテスト、仕様書 11.3、知見ノートだけだった。後続タスクへの影響は、ノートの「[[T28-gallery-widget#他のタスクへの影響|他のタスクへの影響]]」と「[[T28-gallery-widget#未解決・サブタスクの候補|未解決・サブタスクの候補]]」に書いてリーダーに報告した。

## 作業内容

- [x] [[T30-admin-entry|T30]]: 登録の項目を `fields = { image: ImageField, gallery: GalleryField }` に更新
- [x] [[T31-e2e|T31]]: 並べ替えのドラッグ(`page.mouse`)と落とす位置の線の確かめ方、fieldset での編集ロック、処理中の保存の再現と案内の確認、T28 が確かめていないこと
- [x] [[T33-readme|T33]]: widget の使い方、処理中は保存しないこと、必須のギャラリーが `[]` で保存できること

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク(T28-2。T22 の部品の修正)は、これらのファイルを変更しない。

## 結果

- T28 の「他のタスクへの影響」と「未解決・サブタスクの候補」は、次のように扱った。
  - 処理中の保存で画像が外れる件(未解決 1): 仕様書 18 章に書いた(T28 のマージのとき)。処理中に「処理が終わってから保存する」案内を出すことにし、T22 の部品(`UploadProgress`)を直すサブタスク T28-2 で作る。外れた画像を知らせて足し直せるようにする案は、今は作らない(案内で足りるとみた。EmDash が手動の保存でも編集中の値を残すようになれば起きなくなる)。
  - 新規作成の画面で処理中に保存したとき(未解決 2): T31 で確かめる。
  - 代替テキストの入力欄の幅(未解決 3): T28-2 で直す。
  - 必須のギャラリーが `[]` で保存できる件(未解決 4): 仕様書 18 章に書いた。空を拒むかは仕様に無いので、今は変えない。T33 の README に書く。
  - OS からの本物のドラッグとスクリーンリーダー(未解決 5): T31 に、手で確かめる項目として書いた。
  - 根の要素(未解決 6): `?field=` でボタンにフォーカスが移る今の形のままにする(T28 のマージのとき)。単一画像の widget の `?field=` は仕様書 19 章。
  - T22 の `ImageNotFound` に見出しと説明の props を足す案([[T27-1-handoff-image-widget|T27-1]] で T28 のマージまで保留した): 今は作らない。2 つの widget は、`ImageNotFound` と同じ見た目の枠をクラスの定数で写している(単一画像の `INVALID_BOX_CLASS` は大きい枠、ギャラリーの `SMALL_BOX_CLASS` は小さい枠)。共通にするなら、T22 に枠だけの部品を足す形になる。写しは 2 か所だけで、どちらもテストで管理画面の CSS にあるクラスかを確かめているので、見送る。
  - 手動の保存の応答が編集中の値を置き換える件: EmDash の自動保存は置き換えない(`ContentEditor.tsx:519-527` のコメント)ので、EmDash への報告の候補。報告は利用者の判断が要るので、今は行わない。
