---
id: T02
title: "playground(動作確認用サイト)を作る"
type: 実装
status: todo
wave: 1
depends_on:
  - "[[T01-scaffold]]"
soft_depends_on: []
blocks:
  - "[[T07-spike-git-dependency]]"
  - "[[T08-spike-route-body]]"
  - "[[T09-spike-query-count]]"
  - "[[T10-spike-after-save]]"
  - "[[T26-playground-pages]]"
files:
  - "playground/**"
spec:
  - "[[base64-image-plugin-spec#13.1 seed]]"
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
  - "[[base64-image-plugin-spec#17. 実装時に再確認する事項]]"
tags:
  - task
  - impl
  - playground
created: 2026-09-23
---

# T02 playground(動作確認用サイト)を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 1
> - 着手の条件(依存): [[T01-scaffold|T01]]
> - このタスクを待つもの: [[T07-spike-git-dependency|T07]]、[[T08-spike-route-body|T08]]、[[T09-spike-query-count|T09]]、[[T10-spike-after-save|T10]]、[[T26-playground-pages|T26]]
> - 仕様: [[base64-image-plugin-spec#13.1 seed|仕様書 13.1]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15章]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17章]]

## 目的

スパイク・手動確認・E2E に使う EmDash サイトを、Node + SQLite で用意する。

## 作業内容

- [ ] `playground/` に EmDash サイトを作る(Astro + `@astrojs/node` + `@astrojs/react`、`sqlite()`、**storage は指定しない**)
- [ ] npm workspaces でルートのプラグインを参照し、`plugins: [base64ImagePlugin()]` を登録する
- [ ] seed: `b64_images`(`hidden: true` / `routable: false` / `supports: []` / `image` は json)と `posts`(`cover` / `gallery` に widget と options)
- [ ] `b64_images` の seed に最低限必要なフィールド構成を確認する(仕様書 17 章の未決事項)
- [ ] 開発用ログイン(`/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`)で管理画面に入れることを確認する
- [ ] 起動手順を `playground/README.md` に書く

## 完了条件

- [ ] `npm run dev -w playground` で起動し、storage なしの構成で管理画面から posts を作成できる
- [ ] seed の最小構成の確認結果を、仕様書 17 章に反映した

## 変更してよいファイル

- `playground/**`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
