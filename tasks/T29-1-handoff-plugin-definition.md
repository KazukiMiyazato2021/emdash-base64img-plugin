---
id: T29-1
title: "T29 の結果(プラグイン定義)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 4
parent: "[[T29-plugin-definition]]"
depends_on:
  - "[[T29-plugin-definition]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T30-admin-entry.md(作業内容に追加)"
  - "tasks/T32-cloudflare-check.md(作業内容に追加)"
  - "tasks/T33-readme.md(作業内容に追加・コマンドパレットの項目を更新)"
  - "plans/base64-image-plugin-spec.md(18 章)"
  - "docs/emdash-dependency-versions.md(EmDash を上げるときに先に確かめることの節)"
  - "tasks/T29-plugin-definition.md(反映済みの注記だけ)"
  - "tasks/T29-1-handoff-plugin-definition.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#4. アーキテクチャ]]"
  - "[[base64-image-plugin-spec#18. 既知の制約とリスク]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T29-1 T29 の結果(プラグイン定義)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 4 / ブランチ: `phase-4/t-29-1`
> - 親タスク: [[T29-plugin-definition|T29]]
> - 着手の条件(依存): [[T29-plugin-definition|T29]]
> - このタスクを待つもの: なし([[T30-admin-entry|T30]]・[[T32-cloudflare-check|T32]]・[[T33-readme|T33]] はこの内容を前提に進める)

## 目的

T29 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T29 は、変更してよいファイルが `src/index.ts` と `src/server/plugin.ts`(とテスト・仕様書 4.1 など)だけだった。後続タスクへの影響は、ノートの「[[T29-plugin-definition#他のタスクへの影響・サブタスクの候補|他のタスクへの影響・サブタスクの候補]]」に書いてリーダーに報告した。

## 作業内容

- [x] [[T30-admin-entry|T30]]: widget は入口の `fields` の `image` / `gallery` で描かれること、サイドバーの項目は入口で `pages` を export して初めて出ること(それまでコマンドパレットの項目は 404 の画面を開く)。`b64_images` が無いことを widget や画像管理ページで知らせるかの検討
- [x] [[T32-cloudflare-check|T32]]: `b64_images` の確認で増えるクエリ(isolate ごとの最初の保存で、あれば +2、無ければ +1)を D1 で数えること。起動時に lifecycle hook が呼ばれないことは Node でだけ確かめたこと
- [x] [[T33-readme|T33]]: `b64_images` を seed に入れること、無いときのログと `IMAGE_COLLECTION_MISSING`。コマンドパレットの項目の移る先(`/_emdash/admin/content/b64_images`)
- [x] 仕様書 18 章: コマンドパレットの行の移る先を実測に直す。priority が 200 より大きいほかのプラグインの beforeSave の行を足す
- [x] 知見ノート [[emdash-dependency-versions]]: EmDash を上げるときに先に確かめること(テストが頼っている EmDash の内部の形・辞書・依存の表)

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T27-image-widget|T27]]・[[T28-gallery-widget|T28]])は、これらのファイルを変更しない。

## 結果

- T29 の「他のタスクへの影響・サブタスクの候補」は、次のように扱った。
  - T30 への提案(マニフェストで `b64_images` が無いことを知らせる): T30 の作業内容に「検討」として足した。作るかは T30 で決める。
  - 仕様書 15 章の構成の図: T29 のマージのときに直した。
  - EmDash の公式ドキュメントと lifecycle hook の動きが違う件: EmDash への報告は、利用者の判断が要るので、今は行わない。公式の forms プラグインの cron の登録も config で登録すると行われないとみられる件(推測のみ)は、報告を決めるときに一緒に扱う。
  - priority が 200 より大きいほかのプラグインの beforeSave: 仕様書 18 章に既知の制約として書いた(対策はしない)。
  - テストが `HookPipeline` の private の `getContext` を差し替えている件: T20・T21 のテストも同じ差し替えをしている。ほかの「EmDash を上げると壊れうる前提」(辞書のメッセージ ID・`SAVE_REJECTED` の形・`getMany` のクエリ・推移的な依存・lifecycle hook)と合わせて、[[emdash-dependency-versions#EmDash を上げるときに先に確かめること]] に表でまとめた。
