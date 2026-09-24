---
id: T34
title: "v0.1.0 をリリースする"
type: リリース
status: done
wave: 7
depends_on:
  - "[[T31-e2e]]"
  - "[[T32-cloudflare-check]]"
  - "[[T33-readme]]"
soft_depends_on: []
blocks: []
files:
  - "package.json(version)"
  - "package-lock.json(ルートの version)"
  - "src/server/plugin.ts(PLUGIN_VERSION)"
  - "tests/package-exports.test.ts(version が揃っていることのテスト)"
  - "plans/base64-image-plugin-spec.md(status・14 章)"
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

- [x] バージョンを 0.1.0 にして、タグ `v0.1.0` を作る(GitHub への push は利用者の確認を得てから)→ 版は 0.1.0 にした。タグは、README をリポジトリの公開・非公開に合わせたあとのコミットに作るので、push と合わせて [[T34-1-publish-and-install-check|T34-1]] に回した
- [ ] 別の空のサイトから `github:<owner>/emdash-base64img-plugin#v0.1.0` でインストールし、起動を確認する → GitHub への push が要るので [[T34-1-publish-and-install-check|T34-1]] に回した。(npm 12 では、そのサイトの `.npmrc` に `allow-git=root` が要る。[[npm12-git-dependency-policy]])
- [x] 仕様書の status を更新する
- [ ] README のインストールのコマンド(`github:KazukiMiyazato2021/emdash-base64img-plugin#v0.1.0`。owner は `git remote` から)を、作ったタグと、リポジトリを公開するか非公開にするかに合わせる。非公開なら、README の「非公開のリポジトリから入れるとき」(トークンを使う方法)は T33 では確かめていないので、ここで確かめるか、確かめていないことを README に残す([[T33-readme#結果|T33]]) → リポジトリの公開・非公開は利用者が決めるので、[[T34-1-publish-and-install-check|T34-1]] に回した。
- [x] 別のサイトでの確認には、T33 の確かめ方のスクリプト(メインの作業ディレクトリの `spikes/t33-readme/`。git 管理外。README のコードブロックを取り出してサイトを作る・管理画面の widget でアップロードして公開する・サイトのページを確かめる)を使える。手順と結果の形は [[readme-install-verification]]。EmDash 0.39.1 の公開から 3 日たつ前(2026-09-26 19:20 日本時間ごろより前)に行うなら、`min-release-age` の例外と監査が要る([[emdash-dependency-versions#min-release-age の例外(2026-09-24)]])
- [x] タグを作る前に、`npm run verify` と `npm run test:e2e`(Chromium・Firefox)を通す。E2E は macOS でだけ動き、playground のデータベースを空にしてから動く([[T31-e2e#結果|T31]]、[[e2e-playwright-emdash-admin]])

## 完了条件

- [ ] 別のサイトで動作を確認できた → GitHub からのインストールは [[T34-1-publish-and-install-check|T34-1]]。ローカルの git 依存(`git+file`)では T33 で確かめた(下の「結果」)

## 変更してよいファイル

- `package.json`(version)
- `plans/base64-image-plugin-spec.md`(status)

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

- 版: `package.json`(とロックファイルのルート)の `version` を 0.1.0 にした(`npm version 0.1.0 --no-git-tag-version`)。プラグインの `version`(`src/server/plugin.ts` の `PLUGIN_VERSION`。descriptor と `definePlugin` が使う)も 0.1.0 にした。T34 の変更してよいファイルには無かったが、descriptor の版が 0.0.0 のままになるので直した。
- 版を揃えるテスト: `tests/package-exports.test.ts` に「descriptor と `createPlugin()` の version は、package.json の version と同じ」を足した。`PLUGIN_VERSION` を 0.0.0 に戻すと失敗することを確かめた。根拠: **実測のみ**
- `npm run verify`: build・lint・test が通った(テスト 25 ファイル・1,869 件)。`npm run test:e2e`: Chromium と Firefox で 151 件が通過、1 件がスキップ(Firefox のヘッドレスの貼り付け。T31 のとおり)、1.9 分。根拠: **実測のみ**
- 別のサイトでの確認: T33 が README の手順で新しいサイトを作り、ローカルの git 依存(`git+file`)で入れて、管理画面でのアップロード・保存・公開とサイトのページでの表示を確かめた([[readme-install-verification]])。そのあと、配布する `src/` は変わっていない(`git diff c635c3e develop -- src/` が空。`package.json` は `test:e2e` の script だけ)。そのため、ローカルでの確認はやり直していない。GitHub の URL(`github:…#v0.1.0`)でのインストールは、push が要るので [[T34-1-publish-and-install-check|T34-1]] で行う。
- タグ: まだ作っていない。README のインストールの節はリポジトリの公開・非公開で変わるので、利用者の確認のあと、README を合わせたコミットに注釈付きのタグ `v0.1.0` を作る。main へのマージと push も、利用者の確認を得てから行う([[T34-1-publish-and-install-check|T34-1]])。phase/7 は、T34-1 が終わるまで develop にマージしない。
- 仕様書: status を「実装済み(v0.1.0)」にし、14 章に最初の版と、版を揃えるテストを書いた。
