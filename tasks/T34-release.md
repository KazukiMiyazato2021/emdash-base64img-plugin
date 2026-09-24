---
id: T34
title: "v0.1.0 をリリースする"
type: リリース
status: todo
wave: 7
depends_on:
  - "[[T31-e2e]]"
  - "[[T32-cloudflare-check]]"
  - "[[T33-readme]]"
soft_depends_on: []
blocks: []
files:
  - "package.json(version)"
  - "plans/base64-image-plugin-spec.md(status)"
spec:
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
tags:
  - task
  - release
created: 2026-09-23
---

# T34 v0.1.0 をリリースする

> [!info] 概要
> - 種別: リリース / ウェーブ: 7
> - 着手の条件(依存): [[T31-e2e|T31]]、[[T32-cloudflare-check|T32]]、[[T33-readme|T33]]
> - このタスクを待つもの: なし
> - 仕様: [[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14章]]

## 目的

git 依存で配布する最初のバージョンを作る。

## 作業内容

- [ ] バージョンを 0.1.0 にして、タグ `v0.1.0` を作る(GitHub への push は利用者の確認を得てから)
- [ ] 別の空のサイトから `github:<owner>/emdash-base64img-plugin#v0.1.0` でインストールし、起動を確認する(npm 12 では、そのサイトの `.npmrc` に `allow-git=root` が要る。[[npm12-git-dependency-policy]])
- [ ] 仕様書の status を更新する
- [ ] README のインストールのコマンド(`github:KazukiMiyazato2021/emdash-base64img-plugin#v0.1.0`。owner は `git remote` から)を、作ったタグと、リポジトリを公開するか非公開にするかに合わせる。非公開なら、README の「非公開のリポジトリから入れるとき」(トークンを使う方法)は T33 では確かめていないので、ここで確かめるか、確かめていないことを README に残す([[T33-readme#結果|T33]])
- [ ] 別のサイトでの確認には、T33 の確かめ方のスクリプト(メインの作業ディレクトリの `spikes/t33-readme/`。git 管理外。README のコードブロックを取り出してサイトを作る・管理画面の widget でアップロードして公開する・サイトのページを確かめる)を使える。手順と結果の形は [[readme-install-verification]]。EmDash 0.39.1 の公開から 3 日たつ前(2026-09-26 19:20 日本時間ごろより前)に行うなら、`min-release-age` の例外と監査が要る([[emdash-dependency-versions#min-release-age の例外(2026-09-24)]])
- [ ] タグを作る前に、`npm run verify` と `npm run test:e2e`(Chromium・Firefox)を通す。E2E は macOS でだけ動き、playground のデータベースを空にしてから動く([[T31-e2e#結果|T31]]、[[e2e-playwright-emdash-admin]])

## 完了条件

- [ ] 別のサイトで動作を確認できた

## 変更してよいファイル

- `package.json`(version)
- `plans/base64-image-plugin-spec.md`(status)

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
