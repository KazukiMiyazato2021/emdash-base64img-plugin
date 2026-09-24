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
  - "tasks/T32-cloudflare-check.md・plans/base64-image-plugin-spec.md(15 章)・docs/workerd-d1-plugin-behavior.md・docs/cloudflare-workers-free-d1-limits.md(デプロイしての測定の判断)"
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

- [x] 利用者に確かめる: develop とタグ `v0.1.0` の push、main へのマージのしかた(main に直接コミットしないので、GitHub の pull request など)、リポジトリを公開するか非公開にするか
- [x] README のインストールの節を、リポジトリの公開・非公開に合わせる
- [ ] 注釈付きのタグ `v0.1.0` を作る(README を合わせたあとのコミット。main にマージするなら、main のコミットに付けるかを決める)
- [ ] 確認のあとで push する
- [ ] 別の空のサイトから `github:<owner>/emdash-base64img-plugin#v0.1.0` で入れて、起動と、管理画面でのアップロード・サイトでの表示を確かめる(T33 のスクリプト。`spikes/t33-readme/`)。非公開なら、README の「非公開のリポジトリから入れるとき」(トークン)も確かめる

## 完了条件

- [ ] GitHub の URL で入れたサイトで動作を確認できた

## 変更してよいファイル

frontmatter の `files` のとおり。

## 結果

### 利用者の判断(2026-09-25)

| 論点 | 判断 |
|---|---|
| 公開のしかた | `develop` を push し、`develop` から `main` への pull request を `gh` で作る。利用者が pull request をマージしたあと、`main` のコミットに注釈付きのタグ `v0.1.0` を作って push し、`github:…#v0.1.0` でのインストールを確かめる。`main` には直接コミットしない |
| Workers Free での測定(T32 の任意の作業) | 今は測らない。wrangler dev のローカルの D1 の結果で進める([[T32-cloudflare-check#デプロイして測る(任意・利用者の了承待ち)\|T32]] に注記した) |
| EmDash への報告の候補 | 今は何もしない。候補は各タスクノートと知見ノートに残す |

- リポジトリ: GitHub の `KazukiMiyazato2021/emdash-base64img-plugin` は公開(`gh repo view` の `visibility` は `PUBLIC`)。GitHub にあるのは `main`(最初のコミット `14b5db3`)だけだった。`develop` は `main` を含む。根拠: **実測のみ**(2026-09-25)
- push の前に、追跡されているファイルに秘密(トークン・鍵)が無いことを確かめた(`git grep` で、GitHub のトークン・API キー・秘密鍵などの形を探して 0 件)。ローカルのパス(`/Users/home/…`)は 5 つのファイルにある。根拠: **実測のみ**
- README: リポジトリが公開なので、「非公開のリポジトリから入れるとき」は、フォークを非公開にしたときなどの方法とし、確かめていないことを書いた。
- phase/7 は、`develop` を push する前に `develop` にマージする(T34-1 の残り(タグ・インストールの確認)は、`develop` と `main` の上で行うため)。
