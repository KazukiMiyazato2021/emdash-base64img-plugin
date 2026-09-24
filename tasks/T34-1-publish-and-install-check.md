---
id: T34-1
title: "v0.1.0 を GitHub に push し、GitHub の URL でインストールして確かめる"
type: リリース
status: done
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

# T34-1 v0.1.0 を GitHub に push し、GitHub の URL でインストールして確かめる

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
- [x] 注釈付きのタグ `v0.1.0` を作る(README を合わせたあとのコミット。main にマージするなら、main のコミットに付けるかを決める)→ main のマージのコミットに付けた
- [x] 確認のあとで push する
- [x] 別の空のサイトから `github:<owner>/emdash-base64img-plugin#v0.1.0` で入れて、起動と、管理画面でのアップロード・サイトでの表示を確かめる(T33 のスクリプト。`spikes/t33-readme/`)。非公開なら、README の「非公開のリポジトリから入れるとき」(トークン)も確かめる

## 完了条件

- [x] GitHub の URL で入れたサイトで動作を確認できた

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

### push・pull request・タグ(2026-09-25)

- `develop` を push し、pull request #1(`develop` → `main`)を作った。利用者がマージした(マージのコミット `67ae500`。2026-09-24 15:38 UTC)。`main` の tree は、push した `develop`(`d5057df`)の tree と同じだった。GitHub の設定で、マージのあと `develop` のリモートのブランチは消えた。根拠: **実測のみ**
- `main` のマージのコミット `67ae500` に、注釈付きのタグ `v0.1.0` を作って push した。ローカルの `main` と `develop` は `67ae500` に進めた(どちらも早送り。`main` には直接コミットしていない)。

### GitHub の URL でのインストールの確認(2026-09-25)

`spikes/t34-release/`(git 管理外)に新しいサイトを作り、README の手順で確かめた。T33 のスクリプト(README のコードブロックの取り出し・ロックファイルの監査・入力画像の作成・管理画面での操作)を写して使った。macOS 26.4、Node 26.10.0、npm 12.0.2、Chromium 153(Playwright 1.63.0)、開発サーバーはポート 4434。根拠: **実測のみ**

| 手順 | 結果 |
|---|---|
| 土台(astro・アダプター・react) | 通常の設定(`min-release-age=3`)で入れた |
| EmDash 0.39.1(例外) | `npm install --min-release-age=0 --save-exact emdash@0.39.1` だけで入れた。監査で、公開から 3 日未満は EmDash 系 9 個(0.39.1 の版の一式)と、EmDash の外 13 個(`@atcute/*` 7 個・`@modelcontextprotocol/sdk`・`@wordpress/block-serialization-default-parser`・`dompurify`・`hono`・`prosemirror-dropcursor`・`yjs`)。EmDash の外は、このリポジトリのロックファイルの版に `overrides` で戻し、監査で 0 個にした |
| `.npmrc` | README のブロックのとおり `allow-git=root` |
| プラグイン | README のコマンド `npm install "github:KazukiMiyazato2021/emdash-base64img-plugin#v0.1.0"` は、README の注意のとおり `ERESOLVE`(`Found: emdash@undefined`)で止まった(`min-release-age` のため)。README の注意にある `--force` で入れると、増えたのはプラグインだけ(版 0.1.0、`resolved` は `git+ssh://git@github.com/KazukiMiyazato2021/emdash-base64img-plugin.git#67ae500…`)。監査で、registry の新しい版は 0 個 |
| サイトのファイル | README のブロックから `astro.config.mjs`(外部のフォントに接続しないよう、playground と同じ `local()` のフォントだけを足した)・`seed/seed.json`・`src/components/Base64Image.astro`・`src/pages/posts/index.astro`・`src/pages/posts/[slug].astro` を書き出し、`src/live.config.ts` は playground と同じもの |
| 管理画面 | 単一画像の widget(根は `FIELDSET`)とギャラリーの widget(ドロップゾーンのボタン)が出て、textarea は 0。アップロード 3 回が 200、保存が 201(URL は `…/posts/<ID>?locale=en`)、「Publish now」と確認のダイアログで公開が 200 |
| サイトのページ | 一覧と詳細の `<img>` は `data:image/webp;base64,…` で、width / height が実際の寸法と同じ(1600×1067・1200×800・800×1200)。data URL は 99,063・94,487・96,263 バイト(100,000 以下)。LCP の画像は `loading="eager"`・`fetchpriority="high"`、ギャラリーは `loading="lazy"`。無い投稿は 404 |
| console | 無い投稿を開いたときの 404 の「Failed to load resource」だけ([[emdash-admin-console-noise]] の Chromium の 4xx) |
| 片付け | 開発サーバーを止め、4434 に LISTEN が無いことを確かめた |

- 1 回目は、写した管理画面の操作のスクリプトが、公開のボタンを「公開 / Publish」として探していて、30 秒で止まった(T33 が「Publish now」と確認のダイアログに直す前の版だった)。README の手順 6 の押し方に直して、やり直した。プラグインの問題ではない。
- 1 回目の途中で保存した下書きの投稿が、確かめたサイトのデータベースに残っている(使い捨てのサイトなので消していない)。
