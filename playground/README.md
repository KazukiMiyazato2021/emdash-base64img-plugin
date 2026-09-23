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
> - 関連: [[T02-playground]]、[[base64-image-plugin-spec#13.1 seed|仕様書 13.1]]、[[emdash-playground-site-config]]、[[emdash-seed-and-b64-images]]、[[astro-dev-background-for-agents]]、[[vite-watch-scope-playground]]

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

## seed

- `playground/seed/seed.json` にある。コレクションは 2 つ。
  - `b64_images`: 画像の本体を置く非表示のコレクション(`hidden: true` / `routable: false` / `supports: []` / `image` は json・必須)
  - `posts`: `title`、`cover`(widget `base64-image:image`)、`gallery`(widget `base64-image:gallery`)
- 適用されるのは、データベースが空のときの最初のリクエストと、開発用ログインのとき。**すでにあるコレクションは変更されない。**
- seed を変えたら、サーバーを止め、データベースを消してから起動し直す(動いているサーバーは seed の変更を読み直さない)。
- プラグインの widget ができるまでは、`cover` と `gallery` は JSON の入力欄で表示される。参照を JSON で直接入力できる([[emdash-seed-and-b64-images#widget が見つからないフィールドの表示]])。

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
