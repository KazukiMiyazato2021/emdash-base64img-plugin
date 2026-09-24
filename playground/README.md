---
title: playground(動作確認用サイト)
aliases:
  - playground
  - 動作確認用サイト
tags:
  - playground
  - emdash
source_task: "[[T02-playground]]"
created: 2026-09-24
updated: 2026-09-24
---

# playground(動作確認用サイト)

> [!summary] 概要
> - プラグイン「base64-image」を動かして確かめるための EmDash サイト。Astro + `@astrojs/node` + SQLite で、`storage` は指定しない。
> - プラグインは `file:..` でリポジトリのルートを参照する。配布物には含めない。
> - サイト側のページは、投稿の一覧(`/posts/`)と詳細(`/posts/<slug か ID>/`)。画像は `resolveBase64Images` でまとめて解決する([[#ページ]])。
> - 表示用の画像は、アップロードのルートで作る(seed には画像と投稿を入れていない)。サンプルの投稿を作るスクリプトがある([[#表示用のデータの作り方]])。
> - 関連: [[T02-playground]]、[[T26-playground-pages]]、[[base64-image-plugin-spec#13.1 seed|仕様書 13.1]]、[[emdash-playground-site-config]]、[[emdash-seed-and-b64-images]]、[[astro-dev-background-for-agents]]、[[vite-watch-scope-playground]]、[[playground-site-pages]]

コマンドは、すべてリポジトリのルートで実行する。

## 起動

```sh
npm ci                                      # 初回だけ(worktree ごとに必要)
npm run dev -w playground -- --port 4402    # 開発サーバー
```

- サイト: `http://localhost:4402/`、管理画面: `http://localhost:4402/_emdash/admin`
- 端末で実行すると前面で動き、Ctrl+C で止まる。
- Claude Code などのエージェントから実行すると、Astro がサーバーをバックグラウンドで起動し、コマンドはすぐに終わる([[astro-dev-background-for-agents]])。止めるのは次のコマンド。

```sh
npm run dev -w playground -- stop      # 停止
npm run dev -w playground -- status    # 動いているか
npm run dev -w playground -- logs      # ログ(playground/.astro/dev.log)
```

> [!warning] 作業の最後にサーバーを止める
> バックグラウンドのサーバーは、起動したシェルが終わっても動き続ける。`npm run dev -w playground -- stop` のあと、`lsof -nP -iTCP:4402 -sTCP:LISTEN` で何も出ないことを確かめる。

## ポートの変え方

- `--` のあとの `--port` で指定する。省略すると 4321。
- チームでは、ほかの作業とぶつからないよう `4400 + タスク番号` を使う(例: T07 は `--port 4407`)。
- 同じ playground のディレクトリで動かせるサーバーは 1 つだけ。別のポートで起動し直すときは、先に `-- stop` する。

## ログイン(開発用)

ブラウザで次を開く。パスキーを使わずに、管理者 `dev@emdash.local` としてログインできる。

```text
http://localhost:4402/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin
```

- 開発サーバーのときだけ使える(`npm run preview` では 403)。
- 初めてのときは、マイグレーション・seed の適用・管理者の作成もまとめて行う。「Welcome to EmDash, Dev!」のダイアログが出たら「Get Started」で閉じる。
- ログインのセッションは `playground/node_modules/.astro/sessions` に保存される。データベースを消したあとは、もう一度この URL を開く。
- この URL は、開くたびに seed を適用し直す。seed にあるコレクションを管理画面で消すと、`COLLECTION_EXISTS` で 500 になる(EmDash 0.39.1 の動き)。seed からそのコレクションを外して起動し直すか、先にログインした cookie を使い回す([[image-management-routes]])。

## seed

- `playground/seed/seed.json` にある。コレクションは 2 つ。
  - `b64_images`: 画像の本体を置く非表示のコレクション(`hidden: true` / `routable: false` / `supports: []` / `image` は json・必須)
  - `posts`: `title`、`cover`(widget `base64-image:image`)、`gallery`(widget `base64-image:gallery`)
- 適用されるのは、データベースが空のときの最初のリクエストと、開発用ログインのとき。**すでにあるコレクションは変更されない。**
- seed を変えたら、サーバーを止め、データベースを消してから起動し直す(動いているサーバーは seed の変更を読み直さない)。
- プラグインの widget ができるまでは、`cover` と `gallery` は JSON の入力欄で表示される。参照を JSON で直接入力できる([[emdash-seed-and-b64-images#widget が見つからないフィールドの表示]])。
- **seed には `b64_images` の画像も、それを参照する投稿も入れない。** seed で作った画像は `imageRefs` に記録が無く、プラグインの保存 hook が登録されると、それを参照する投稿は管理画面で保存できなくなる(タイトルだけを変えても拒否される)。画像管理ページにも出ず、一覧のサムネイルも出ない([[T16-reference-hook#seed の画像の扱い|T16]])。画像は、次のアップロードのルートで作る。

## ページ

| URL | 内容 |
|---|---|
| `/` | トップ(ページと管理画面へのリンク) |
| `/posts/` | 公開した投稿の一覧(カード、10 件ずつ、新しく公開した順)。`?cursor=` で次のページ |
| `/posts/<slug か ID>/` | 投稿の詳細(カバーとギャラリー、画像ごとに代替テキスト)。見つからなければ 404 |

- 画像は、ページで使う参照を集め、`resolveBase64Images` を 1 回だけ呼んで解決する(一覧はカバー、詳細はカバーとギャラリー)。描画は `emdash/ui` の `Image` で、`<img src="data:image/webp;base64,…" width height>` が出る([[base64-image-plugin-spec#12. サイト側の描画|仕様書 12 章]])。
- LCP の対象の画像に `priority` を付ける(`loading="eager"` と `fetchpriority="high"`。ほかは `loading="lazy"`)。一覧は描画できる最初のカバー、詳細はカバー(カバーの無い投稿では、描画できる最初のギャラリーの画像)。
- 画像が見つからない(ゴミ箱に入った・削除された)ときは、参照の寸法で場所を取った「画像が見つかりません」の枠を出す。サーバーのログに `[base64-image] … not found …` の警告が出る。
- E2E で探せるよう、次の属性を付けている。

| 要素 | 属性 |
|---|---|
| 一覧のカード(`li`) | `data-testid="post-card"`、`data-post-id`(エントリ ID) |
| 詳細の本文(`article`) | `data-testid="post"`、`data-post-id` |
| 画像(`img`) | `data-field`(`cover` / `gallery`)、`data-image-id`(画像 ID) |
| 見つからない画像の枠 | `data-testid="image-missing"`、`data-field`、`data-image-id` |
| 投稿が無いとき(一覧) | `data-testid="no-posts"` |

- 共通の部品は `playground/src/pages/_components/`(`_` から始まるので、ルートにならない)にある。

## 表示用のデータの作り方

アップロードのルート(`POST /_emdash/api/plugins/base64-image/upload`)で画像を作る。ルートは画像エントリを公開し、`imageRefs` に記録するので、その画像を参照する投稿は管理画面でも保存できる。

> [!warning] アップロードのルートは、プラグインの定義(`src/index.ts`、[[T29-plugin-definition|T29]])が登録する
> 登録されるまでは 404 になり、下のスクリプトも管理画面の widget も使えない。T26 では、ルートと hook を一時的に登録した使い捨てのサイトで、スクリプトとページを確かめた([[playground-site-pages#再現手順]])。

### スクリプト(サンプルの投稿をまとめて作る)

```sh
npm run dev -w playground -- --port 4402                                  # 先に起動する
node playground/scripts/create-sample-posts.ts --base http://localhost:4402  # 3 件(ギャラリー 3 枚ずつ)
node playground/scripts/create-sample-posts.ts --base http://localhost:4402 --posts 11 --gallery 10 --trash-cover
```

| オプション | 既定 | 内容 |
|---|---|---|
| `--base` | `http://localhost:4321` | 開発サーバーの URL |
| `--posts` | 3 | 作る投稿の数。11 件以上で、一覧に次のページができる |
| `--gallery` | 3 | 1 件のギャラリーの枚数(`gallery` の `maxItems` は 10)。横長(800×600)と縦長(600×800)を交互に作り、最後の 1 枚は代替テキストを空にする |
| `--trash-cover` | なし | 最後の投稿のカバー画像をゴミ箱に移す(サイトで「画像が見つかりません」の枠を確かめる) |

- 開発用ログインで Cookie を得て、画像を Playwright の Chromium の canvas で描き(WebP、カバーは 1280×853)、アップロードのルートに 1 枚ずつ送る。そのあと標準の REST API で投稿を作って公開する。
- 開発用ログインを使うので、開発サーバー(`astro dev`)でだけ動く。タイトルと slug には実行した時刻が入るので、何度実行しても重ならない。
- `npm run typecheck` の対象外(Node が型の注釈を取り除いて実行する)。

### 管理画面から作る

widget([[T27-image-widget|T27]]・[[T28-gallery-widget|T28]]、組み立ては [[T30-admin-entry|T30]])ができたあとは、投稿の編集画面の Cover / Gallery から画像を選ぶと、同じルートでアップロードされる。投稿を公開すると、サイトのページに出る。

### E2E の入力画像

管理画面のファイル選択に渡す画像(形式ごとの画像・大きすぎる画像・壊れた画像)は `e2e/fixtures/make-images.ts` で作る。一覧と、実ブラウザで確かめた結果は [[e2e/fixtures/README|e2e/fixtures/README.md]]。

## データベースの消し方

```sh
npm run dev -w playground -- stop     # 先にサーバーを止める
rm -f playground/data.db              # SQLite のデータベース
rm -rf playground/.emdash/uploads     # メディアのアップロード(あれば)
npm run dev -w playground -- --port 4402
```

- 起動後、開発用ログインの URL を開くと、seed が適用され、管理者が作り直される。
- `playground/data.db` は git の管理外(ルートの `.gitignore` の `*.db`)。

## ビルド

```sh
npm run build -w playground      # astro build(約 2 秒)
npm run preview -w playground -- --port 4402   # ビルドしたサイトを動かす(止めるのは -- stop)
```

- `npm run verify`(ルートの `npm run build`)にも含まれる。データベースもネットワークも使わない。
- `playground/dist/` と `playground/.emdash/migrations.json` を書き出す。どちらも git の管理外。

## 設定のポイント

| 項目 | 設定 | 理由 |
|---|---|---|
| データベース | `sqlite({ url: "file:./data.db" })` | `playground/data.db` に置く。worktree ごとに別になる |
| storage | 指定しない | R2 を使わない構成を再現する。ただし EmDash 0.39.1 は、省略すると `./.emdash/uploads` の local storage を使うので、標準のメディアのアップロードは成功する([[emdash-playground-site-config#storage を省略したとき]]) |
| 管理画面のフォント | `fonts: false` と、`--font-emdash` を `local()` だけで登録するプロバイダー | ビルドと起動で Google Fonts を取得しないため。`fonts: false` だけだと管理画面が表示できない([[emdash-playground-site-config#管理画面のフォント]]) |
| 監視の除外 | 足していない | 監視は playground の中とプラグインのソースだけで、ルートや `node_modules` をたどらない([[vite-watch-scope-playground]]) |

## 生成されるファイル

| パス | 内容 | git |
|---|---|---|
| `data.db` | SQLite のデータベース | 管理外 |
| `emdash-env.d.ts` | 開発サーバーの起動時に生成されるコレクションの型 | 管理外(`playground/.gitignore`) |
| `.emdash/` | マイグレーションのマニフェストと、メディアのアップロード | 管理外(`playground/.gitignore`) |
| `.astro/`、`dist/`、`node_modules/` | Astro の型・ログ・ビルド出力・キャッシュ | 管理外 |

> [!warning] `npm run lint` と `emdash-env.d.ts`
> `emdash-env.d.ts` は prettier の書式に合わない(末尾に改行が無い)。ルートの `.prettierignore` で除外されていないと、開発サーバーを一度起動したあとの `npm run lint`(`npm run verify`)が失敗する。その場合は、サーバーを止めてから `rm playground/emdash-env.d.ts` を実行する。
