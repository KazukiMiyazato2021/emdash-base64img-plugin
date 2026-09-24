---
id: T30-2
title: "本物の管理画面のモジュールを読むテストのタイムアウトを延ばす"
type: テスト
status: done
wave: 6
parent: "[[T30-admin-entry]]"
depends_on:
  - "[[T30-admin-entry]]"
soft_depends_on: []
blocks: []
files:
  - "tests/admin/admin-entry.test.tsx"
  - "tests/admin/ImagesPage.test.tsx(本物の useCurrentUser の describe だけ)"
  - "tasks/T30-2-heavy-import-test-timeout.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - test
  - subtask
created: 2026-09-24
---

# T30-2 本物の管理画面のモジュールを読むテストのタイムアウトを延ばす

> [!info] 概要
> - 種別: テスト(予定外のサブタスク) / ウェーブ: 6 / ブランチ: `phase-6/t-30-2`
> - 親タスク: [[T30-admin-entry|T30]]
> - 着手の条件(依存): [[T30-admin-entry|T30]]
> - このタスクを待つもの: なし

## 目的

負荷の高いマシンでも、`npm run verify` のテストがタイムアウトで失敗しないようにする。

## 発生した理由

[[T32-cloudflare-check|T32]] の `npm run verify` で、`tests/admin/admin-entry.test.tsx` の 1 件が vitest の既定のタイムアウト(5 秒)で失敗した。そのときは T31・T33 も同時に動いていて、負荷平均は約 20 だった。そのファイルだけをやり直すと 12 件とも通り、verify をやり直すとすべて通った(T32 の報告)。

## 作業内容

- [x] 時間のかかるテストを調べる
- [x] `tests/admin/admin-entry.test.tsx` のタイムアウトを、ファイル全体で 30 秒にする(`vi.setConfig({ testTimeout: 30_000 })`)
- [x] `tests/admin/ImagesPage.test.tsx` の、本物の `@emdash-cms/admin` を読む describe だけを 30 秒にする(`describe(名前, { timeout: 30_000 }, …)`)
- [x] 2 つの書き方で、実際にタイムアウトが延びることを確かめる

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T31-e2e|T31]])は、`tests/` を変更しない。

## 結果

- 時間: 負荷平均が約 16 のとき、`admin-entry.test.tsx` は、最初のテスト(入口と部品のモジュールを初めて読み込む)が 1,835ms、本物の `@emdash-cms/admin` を読む `usePluginPage` のテストが約 2.4 秒、ほかは 2〜5ms。`ImagesPage.test.tsx` の本物の `useCurrentUser` のテストは約 1.3〜1.7 秒。根拠: **実測のみ**(`vitest --reporter=verbose`)
- `admin-entry.test.tsx` はどのテストも入口を読み込み直す(`vi.resetModules()`)ので、最初の読み込みの時間は、実行の順(絞り込みを含む)で最初になったテストにかかる。そのため、ファイル全体のタイムアウトを延ばした。`ImagesPage.test.tsx` は、重いのが 1 つの describe だけなので、その describe だけを延ばした。
- 確かめ方: 6 秒待つだけの使い捨てのテストで、`vi.setConfig({ testTimeout: 30_000 })` と `describe(名前, { timeout: 30_000 }, …)` のどちらでも通り、指定しない describe では 5,006ms でタイムアウトになった(対照)。使い捨てのテストは消した。根拠: **実測のみ**(vitest 4.1.11)
- 負荷を再現しての確認はしていない。30 秒は、負荷平均 16 での時間(最大約 2.4 秒)の 10 倍以上の余裕として選んだ。根拠: **推測のみ**
