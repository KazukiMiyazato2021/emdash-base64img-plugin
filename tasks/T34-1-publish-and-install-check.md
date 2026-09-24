---
id: T34-1
title: "v0.1.0 を GitHub に push し、GitHub の URL でインストールして確かめる(利用者の確認待ち)"
type: リリース
status: todo
wave: 7
parent: "[[T34-release]]"
depends_on:
  - "[[T34-release]]"
soft_depends_on: []
blocks: []
files:
  - "README.md(インストールの節。リポジトリの公開・非公開に合わせる)"
  - "tasks/T34-1-publish-and-install-check.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
tags:
  - task
  - release
  - subtask
created: 2026-09-24
---

# T34-1 v0.1.0 を GitHub に push し、GitHub の URL でインストールして確かめる(利用者の確認待ち)

> [!info] 概要
> - 種別: リリース(予定外のサブタスク) / ウェーブ: 7 / ブランチ: `phase-7/t-34-1`
> - 親タスク: [[T34-release|T34]]
> - 着手の条件(依存): [[T34-release|T34]]、**利用者の確認**(push・main へのマージ・リポジトリの公開・非公開)
> - このタスクを待つもの: なし

## 目的

T34 で作ったローカルのタグ `v0.1.0` を GitHub に置き、利用者のサイトと同じ方法(`github:<owner>/emdash-base64img-plugin#v0.1.0`)で入れて動くことを確かめる。

## 発生した理由

T34 の作業のうち、GitHub への push と、GitHub の URL でのインストールは、外部への公開になるので、利用者の確認が要る。T34 はローカルでできるところ(版・テスト・E2E・仕様書)までにした。タグは、README をリポジトリの公開・非公開に合わせてから作る。

## 作業内容

- [ ] 利用者に確かめる: develop とタグ `v0.1.0` の push、main へのマージのしかた(main に直接コミットしないので、GitHub の pull request など)、リポジトリを公開するか非公開にするか
- [ ] README のインストールの節を、リポジトリの公開・非公開に合わせる
- [ ] 注釈付きのタグ `v0.1.0` を作る(README を合わせたあとのコミット。main にマージするなら、main のコミットに付けるかを決める)
- [ ] 確認のあとで push する
- [ ] 別の空のサイトから `github:<owner>/emdash-base64img-plugin#v0.1.0` で入れて、起動と、管理画面でのアップロード・サイトでの表示を確かめる(T33 のスクリプト。`spikes/t33-readme/`)。非公開なら、README の「非公開のリポジトリから入れるとき」(トークン)も確かめる

## 完了条件

- [ ] GitHub の URL で入れたサイトで動作を確認できた

## 変更してよいファイル

frontmatter の `files` のとおり。
