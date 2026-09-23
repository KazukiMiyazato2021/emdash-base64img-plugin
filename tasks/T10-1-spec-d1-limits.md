---
id: T10-1
title: "D1 のクエリ数の上限を直し、T10 の結果を後続タスクに反映する"
type: ドキュメント
status: done
wave: 2
parent: "[[T10-spike-after-save]]"
depends_on:
  - "[[T10-spike-after-save]]"
soft_depends_on: []
blocks: []
files:
  - "plans/base64-image-plugin-spec.md(2.2・7・9・18 章)"
  - "tasks/T18-upload-route.md(作業内容に追加)"
  - "tasks/T20-owner-tracking.md(作業内容に追加)"
  - "tasks/T21-orphan-routes.md(作業内容を置き換え・追加)"
  - "tasks/T10-spike-after-save.md(表の wikilink の書き方だけ)"
  - "docs/cloudflare-workers-free-d1-limits.md"
  - "docs/00-index.md"
  - "tasks/T10-1-spec-d1-limits.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#2.2 プラットフォームの上限]]"
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T10-1 D1 のクエリ数の上限を直し、T10 の結果を後続タスクに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 2 / ブランチ: `phase-2/t-10-1`
> - 親タスク: [[T10-spike-after-save|T10]]
> - 着手の条件(依存): [[T10-spike-after-save|T10]]
> - このタスクを待つもの: なし([[T18-upload-route|T18]]・[[T20-owner-tracking|T20]]・[[T21-orphan-routes|T21]] はこの内容を前提に進める)
> - 仕様: [[base64-image-plugin-spec#2.2 プラットフォームの上限|仕様書 2.2]]、[[base64-image-plugin-spec#7. アップロード(書き込み経路)|7章]]、[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|9章]]

## 目的

仕様書が前提にしていた「D1 は 1 リクエスト 50 クエリまで」を、Cloudflare の現在のドキュメントに合わせて直す。T10 で分かったことを、後続タスクのノートに書く。

## 発生した理由

- [[T10-spike-after-save|T10]] の実測で、アップロード 1 回(作成 → 取得 → 公開)が 72 クエリだった。仕様書 7 章の「50 本に確実に収める」は満たせない。
- T10 の報告: Cloudflare のドキュメントが食い違う(D1 のページは 50、Workers のページは Cloudflare のサービスへのサブリクエストが 1,000)。
- リーダーが Cloudflare のドキュメントを検索して確かめた。Workers の limits のページと 2026-02-11 の changelog は、Free で Cloudflare のサービスへ 1,000 / 呼び出し。あわせて、2026-09-01 から D1 Free の 1 日の上限が厳密に適用されることが分かった。

## 作業内容

- [x] 仕様書 2.2 の表を、サブリクエストの 2 種類の上限と、D1 の 1 日の上限に直す
- [x] 仕様書 7 章の「1リクエストで1枚」の理由を直し、アップロードのクエリ数(72)を書く
- [x] 仕様書 9 章のページ送りの理由を直す(予算の値は T21 で決める)
- [x] 仕様書 18 章に、D1 の 1 日の上限を加える
- [x] T18・T20・T21 のノートに、T10 の結果を書く
- [x] 知見ノート [[cloudflare-workers-free-d1-limits]] を書き、索引を更新する

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク(T13・T14・T15)は、仕様書の 6・11・12 章しか触らないので、衝突しない。

## 結果

- 上限の読み方: 1 呼び出し 1,000 クエリ(公式ドキュメントのみ)。D1 のページの「50」との食い違いは残る。実際の D1 での確認は [[T32-cloudflare-check|T32]]。
- T10 が追加した設計(`content:afterPublish` でも参照元を記録する)は、リーダーが了承した。仕様書 9 章の「参照元を追記だけで記録する」方針のままで、記録の漏れ(一覧の一括公開)を塞ぐものなので、利用者の判断は不要と判断した(推測のみ)。
