---
id: T01-1
title: "運用ルールの更新と知見の索引を作る"
type: ドキュメント
status: done
wave: 0
parent: "[[T01-scaffold]]"
depends_on:
  - "[[T01-scaffold]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/00-index.md"
  - "tasks/T01-1-workflow-docs-index.md"
  - "docs/00-index.md"
  - "docs/claude-code-worktree-isolation.md"
  - ".prettierignore"
  - "docs/test-lint-setup.md(prettier の節に追記)"
  - "plans/base64-image-plugin-spec.md(15 章のツールの記述)"
spec:
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T01-1 運用ルールの更新と知見の索引を作る

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 0 / ブランチ: `phase-0/t-01-1`
> - 親タスク: [[T01-scaffold|T01]]
> - 着手の条件(依存): [[T01-scaffold|T01]]
> - このタスクを待つもの: なし
> - 仕様: [[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15章]]

## 目的

実装を始めるときに利用者から指示された進め方を、タスク一覧に反映する。進め方は、フェーズブランチを使うこと、worktree で隔離したチームで進めること、知見ノートの索引を作ることの 3 つ。あわせて、T01 で見つかった仕様書の記述の誤りを直す。

## 発生した理由

- 利用者の指示(2026-09-23):
  - フェーズごとに `develop` から `phase/N` を作る。
  - タスクごとに `phase-N/t-N` を作り、予定外の作業には `phase-N/t-N-N` を作る。
  - 知見は `docs/` に書き、パスの索引を作る。
- 元の [[tasks/00-index|タスク一覧]] は、`task/<ID>-<slug>` のブランチを PR でマージする前提で書いていた。
- [[T01-scaffold|T01]] の報告で、仕様書 15 章の「EmDash と同じ oxlint + prettier」が不正確だと分かった。

## 作業内容

- [x] [[tasks/00-index|タスク一覧]] の「進め方のルール」と「共通の完了条件」を、フェーズブランチの運用に書き換える
- [x] このサブタスクを、タスク一覧(ウェーブの表・依存グラフ・全タスクの表)に追加する
- [x] [[docs/00-index|知見の索引]] を作り、T01 の知見ノート 4 件を登録する
- [x] worktree で隔離したチームを動かして分かったことを、[[claude-code-worktree-isolation]] に書く
- [x] 仕様書 15 章のツールの記述を直す
- [x] メインの作業ディレクトリにある `.obsidian/` を prettier の対象から外す(worktree には無いので T01 では見つからなかった)

## 完了条件

- [x] `npm run verify` が通る
- [x] タスク一覧と索引の wikilink がすべて解決する

## 変更してよいファイル

- `tasks/00-index.md`
- `tasks/T01-1-workflow-docs-index.md`(このノート)
- `docs/00-index.md`
- `docs/claude-code-worktree-isolation.md`
- `.prettierignore`(`.obsidian/` の除外)
- `docs/test-lint-setup.md`(prettier の節に追記)
- `plans/base64-image-plugin-spec.md`(15 章のツールの記述)

## 結果

- 整形ツール: EmDash 0.38.0 は、lint に oxlint を、整形に oxfmt と prettier(`.astro` 用)を使っている(`references/emdash/package.json:24-27`。公式ドキュメントのみ)。このリポジトリは、合意どおり prettier に統一する。仕様書 15 章の記述をこれに合わせて直した。
- `.obsidian/`: 利用者の Obsidian の設定は `.git/info/exclude` で git から外しているが、prettier 3 は `.gitignore` と `.prettierignore` しか読まない。そのため、メインの作業ディレクトリでだけ `prettier --check .` が失敗した(実測のみ)。`.prettierignore` に追加した。
- worktree の分岐元: isolation: worktree で作られる worktree は、リーダーが今いるブランチではなく `main` から作られた(実測のみ)。チームメイトは、分岐元を確かめたうえでフェーズブランチからタスクブランチを作る。詳しくは [[claude-code-worktree-isolation]]。
