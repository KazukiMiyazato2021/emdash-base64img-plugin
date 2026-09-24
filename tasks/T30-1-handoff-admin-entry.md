---
id: T30-1
title: "T30 の結果(管理画面の入口)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 5
parent: "[[T30-admin-entry]]"
depends_on:
  - "[[T30-admin-entry]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "tasks/T32-cloudflare-check.md(作業内容に追加)"
  - "tasks/T33-readme.md(seed の項目に追記)"
  - "tasks/T30-admin-entry.md(反映済みの注記だけ)"
  - "tasks/T30-1-handoff-admin-entry.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#11.1 共通方針]]"
  - "[[base64-image-plugin-spec#18. 既知の制約とリスク]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T30-1 T30 の結果(管理画面の入口)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 5 / ブランチ: `phase-5/t-30-1`
> - 親タスク: [[T30-admin-entry|T30]]
> - 着手の条件(依存): [[T30-admin-entry|T30]]
> - このタスクを待つもの: なし([[T31-e2e|T31]]・[[T32-cloudflare-check|T32]]・[[T33-readme|T33]] はこの内容を前提に進める)

## 目的

T30 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T30 は、変更してよいファイルが `src/admin.tsx` とテスト、仕様書 11 章、知見ノートだけだった。後続タスクへの影響は、ノートの「[[T30-admin-entry#他のタスクへの影響・サブタスクの候補|他のタスクへの影響・サブタスクの候補]]」と「[[T30-admin-entry#未解決|未解決]]」に書いてリーダーに報告した。

## 作業内容

- [x] [[T31-e2e|T31]]: console を見張るときに除く EmDash 側の 3 つ、入口の確かめ方と本番のビルドでのログイン、T30 が確かめていないこと(狭い画面・i18n のサイト・スクリーンリーダー)
- [x] [[T32-cloudflare-check|T32]]: 管理画面の入口が wrangler dev でも動くこと
- [x] [[T33-readme|T33]]: `b64_images` が無いときに編集者に出るメッセージと、README に書く直し方

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスクは無い(フェーズ 5 の最後)。

## 結果

- T30 の「他のタスクへの影響・サブタスクの候補」は、次のように扱った。
  - 仕様書 18 章に「`b64_images` の無いサイト」を足すか(候補 3): 足した(T30 のマージのとき)。先に知らせる表示は作らない(T30 の決めたこと 6)。
  - 知見ノート 2 つの索引への登録(候補 5): T30 のマージのときに行った。
  - EmDash への報告の候補(候補 4): 本番のビルドでコマンドパレットの項目を選ぶと出る Lingui の警告と、管理画面の CSP の下で zod 4 の eval の確認が Firefox で違反として出る件。報告は利用者の判断が要るので、今は行わない。どちらも動きは変わらない。
