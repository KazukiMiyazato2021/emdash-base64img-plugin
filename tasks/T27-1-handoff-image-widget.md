---
id: T27-1
title: "T27 の結果(単一画像の widget)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 4
parent: "[[T27-image-widget]]"
depends_on:
  - "[[T27-image-widget]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T30-admin-entry.md(作業内容に追加)"
  - "tasks/T31-e2e.md(作業内容に追加・新規作成の保存の項目に注記)"
  - "tasks/T23-upload-hook.md(未解決 3 に注記)"
  - "plans/base64-image-plugin-spec.md(19 章)"
  - "tasks/T27-1-handoff-image-widget.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#11.2 単一画像 widget(`base64-image:image`)]]"
  - "[[base64-image-plugin-spec#19. 対象外・将来の検討事項]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T27-1 T27 の結果(単一画像の widget)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 4 / ブランチ: `phase-4/t-27-1`
> - 親タスク: [[T27-image-widget|T27]]
> - 着手の条件(依存): [[T27-image-widget|T27]]
> - このタスクを待つもの: なし([[T30-admin-entry|T30]]・[[T31-e2e|T31]] はこの内容を前提に進める)

## 目的

T27 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T27 は、変更してよいファイルが `src/admin/ImageField.tsx` とテスト、仕様書 11.2、知見ノートだけだった。後続タスクへの影響は、ノートの「[[T27-image-widget#他のタスクへの影響|他のタスクへの影響]]」と「[[T27-image-widget#未解決・サブタスクの候補|未解決・サブタスクの候補]]」に書いてリーダーに報告した。

## 作業内容

- [x] [[T30-admin-entry|T30]]: `export const fields = { image: ImageField, … }` での登録と、`fields` に型の注釈を付けない理由
- [x] [[T31-e2e|T31]]: 編集ロックと処理中の表示の再現のしかた(`page.route`)。T27 が実際の管理画面で確かめていないこと。新規作成の保存のあとの作り直しは T27 が確かめたことの注記
- [x] [[T23-upload-hook|T23]]: 未解決 3(URL と widget の作り直しの時期)に、T27 で確かめた結果を注記
- [x] 仕様書 19 章: 必須の画像フィールドで画像が無いときの表示、`?field=` で開いたときのフォーカス(どちらも将来の検討事項)

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T28-gallery-widget|T28]])は、これらのファイルを変更しない。

## 結果

- T27 の「他のタスクへの影響」と「未解決・サブタスクの候補」は、次のように扱った。
  - [[T28-gallery-widget|T28]] に揃えてほしい点(編集ロック・値が正しくないとき・`imageRefs` を確かめないこと・余白・フォーカス・作り直し・登録の型): T28 の作業中にメッセージで送った。T28 のノートは T28 が書いているので、ここでは変えていない。
  - T22 の `ImageNotFound` に見出しと説明の props を足す案(正しくない値の表示に使う): T28 も正しくない値の表示を持つかを見てから、T28 のマージのときに決める。
  - 必須の画像フィールドの表示と、`?field=` で開いたときのフォーカス: 仕様書に無いので、19 章の将来の検討事項にした。
  - 編集ロックのダイアログが日本語の画面でも英語だった件: EmDash 側のことで、EmDash への報告の候補。報告は利用者の判断が要るので、今は行わない。
  - 仕様書 11.1 の編集ロックの項目と 18 章の行: T27 のマージのときに直した([[T27-image-widget#11.1 の変更の依頼(リーダーへ)|T27]])。
