---
id: T09-1
title: "T09 の結果を仕様書に反映する(16 章・5.2 のロケール)"
type: ドキュメント
status: done
wave: 2
parent: "[[T09-spike-query-count]]"
depends_on:
  - "[[T09-spike-query-count]]"
soft_depends_on: []
blocks: []
files:
  - "plans/base64-image-plugin-spec.md(5.2・16 章)"
  - "docs/astro-dev-background-for-agents.md(1 項目追加)"
  - "docs/00-index.md"
  - "tasks/T09-1-spec-locale-query-count.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#5.2 参照(投稿側フィールドの値)]]"
  - "[[base64-image-plugin-spec#16. 実装前の検証(スパイク)]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T09-1 T09 の結果を仕様書に反映する(16 章・5.2 のロケール)

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 2 / ブランチ: `phase-2/t-09-1`
> - 親タスク: [[T09-spike-query-count|T09]]
> - 着手の条件(依存): [[T09-spike-query-count|T09]]
> - このタスクを待つもの: なし
> - 仕様: [[base64-image-plugin-spec#5.2 参照(投稿側フィールドの値)|仕様書 5.2]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|仕様書 16章]]

## 目的

[[T09-spike-query-count|T09]] の報告のうち、T09 の変更してよい範囲(12 章)の外にあったものを反映する。

## 発生した理由

- 仕様書 16 章のスパイクのチェックリストは、衝突を避けるためリーダーがマージのときに更新する。
- 仕様書 5.2 は「取得がリクエストのロケールに絞り込まれる」としていた。T09 の実測では、locale を省くと、匿名の閲覧者には既定のロケールが使われた(`/ja/` のページでも)。リクエストのロケールが使われるのは、編集モードとプレビューのときだけ。結論(locale を明示して取得する)は変わらない。
- T09 の使い捨てのサイトで、`astro dev` の起動のつまずき(相対パスの `--root`)が見つかった。

## 作業内容

- [x] 仕様書 16 章の 3 つ目の項目にチェックと結論を付ける
- [x] 仕様書 5.2 のロケールの説明を、実測に合わせて直す
- [x] `docs/astro-dev-background-for-agents.md` に `--root` の注意を追加する
- [x] 知見の索引に `docs/emdash-query-count-b64-images.md` を追加し、タスク一覧にこのサブタスクを追加する

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いている [[T15-site-resolve|T15]] は仕様書の 12 章しか触らないので、衝突しない。

## 結果

- 5.2 の根拠は [[T09-spike-query-count#結果|T09 の結果]](実測+公式ドキュメント)。
