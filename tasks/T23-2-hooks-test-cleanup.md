---
id: T23-2
title: "フックのテストの afterEach で、投げる前に描画を片付ける"
type: 実装
status: done
wave: 3
parent: "[[T23-upload-hook]]"
depends_on:
  - "[[T23-upload-hook]]"
  - "[[T25-images-page]]"
soft_depends_on: []
blocks: []
files:
  - "tests/admin/hooks.test.ts(afterEach だけ)"
  - "docs/react-hook-testing-pitfalls.md(例と説明)"
  - "tasks/T23-2-hooks-test-cleanup.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - impl
  - test
  - subtask
created: 2026-09-24
---

# T23-2 フックのテストの afterEach で、投げる前に描画を片付ける

> [!info] 概要
> - 種別: 実装(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-23-2`
> - 親タスク: [[T23-upload-hook|T23]]
> - 着手の条件(依存): [[T23-upload-hook|T23]]、[[T25-images-page|T25]](問題を見つけた)
> - このタスクを待つもの: なし
> - 仕様: [[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15 章]]

## 目的

`tests/admin/hooks.test.ts` で 1 つのテストが失敗したときに、その描画が次のテストに残らないようにする。

## 発生した理由

- T23 のテストは、act の外での状態の変化(React の警告)を失敗にするため、`afterEach` で `console.error` を見張り、呼ばれていれば例外を投げる([[react-hook-testing-pitfalls#act の外での状態の変化を失敗にする]])。
- Vitest 4.1.11 の `afterEach` は、登録と逆の順に呼ばれ、1 つが投げると残りを呼ばない。ファイルの `afterEach` が投げると、`tests/setup/dom.ts` の `cleanup()` が呼ばれず、描画したフックが次のテストに残る。
- [[T25-images-page|T25]] が、自分のテストで同じ形の問題に当たって見つけた([[react-effect-lint-and-vitest-hooks]])。`tests/admin/hooks.test.ts` は T23 のファイルなので、T25 は変更せずに報告した。

## 作業内容

- [x] `tests/admin/hooks.test.ts` の `afterEach` の最初で `cleanup()` を呼ぶ
- [x] 直す前と後で、失敗したテストの描画が次のテストに残るかを確かめる
- [x] 知見ノート [[react-hook-testing-pitfalls]] の例と説明を直す

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているサブタスク(T25-2。`src/admin/ImagesPage.tsx` と `src/shared/constants.ts` など)は、これらのファイルを変更しない。

## 結果

- 確かめ方: `hooks.test.ts` の最後に一時的に 2 つのテストを足した。A は `renderHook` で描画してから `console.error` を呼ぶ(`afterEach` で失敗する)。B は `document.body` に何も残っていないことを確かめる。根拠: **実測のみ**

| | A | B |
|---|---|---|
| 直す前 | 失敗(意図どおり) | **失敗**(A の描画が残り、`body` の子が 1 つ) |
| 直した後(`afterEach` の最初で `cleanup()`) | 失敗(意図どおり) | 通る |

- 一時的なテストは消した。`cleanup()` を先に呼ぶので、アンマウントのときの警告も見張りの対象になる([[T25-images-page|T25]] の `ImagesPage.test.tsx` と同じ形)。
- `cleanup()` は `tests/setup/dom.ts` の `afterEach` でもう一度呼ばれるが、2 回目は何もしない。
