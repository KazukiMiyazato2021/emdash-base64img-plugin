---
id: T02
title: "playground(動作確認用サイト)を作る"
type: 実装
status: done
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

- [x] `playground/` に EmDash サイトを作る(Astro + `@astrojs/node` + `@astrojs/react`、`sqlite()`、**storage は指定しない**)
- [x] npm workspaces でルートのプラグインを参照し、`plugins: [base64ImagePlugin()]` を登録する
- [x] seed: `b64_images`(`hidden: true` / `routable: false` / `supports: []` / `image` は json)と `posts`(`cover` / `gallery` に widget と options)
- [x] `b64_images` の seed に最低限必要なフィールド構成を確認する(仕様書 17 章の未決事項)
- [x] 開発用ログイン(`/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`)で管理画面に入れることを確認する
- [x] 起動手順を `playground/README.md` に書く

## 完了条件

- [x] `npm run dev -w playground` で起動し、storage なしの構成で管理画面から posts を作成できる(`storage` を指定しない構成。ただし EmDash 0.39.1 は省略すると local storage を使う。[[#storage を省略したときの挙動]])
- [x] seed の最小構成の確認結果を、仕様書 17 章に反映した(13.1 章にも追記した)

## 結果

2026-09-24 に実施。リーダーからの追加の指定(ポート 4402、scripts、ビルドの安定性と時間、監視の確認、未知の widget の表示、Playwright での確認、README)も含む。

### 作ったもの

| ファイル | 内容 |
|---|---|
| `playground/package.json` | scripts に `dev` / `build`(`astro build`)/ `preview` を足した。依存は T01 のまま(`package-lock.json` は変更なし) |
| `playground/astro.config.mjs` | `@astrojs/node`(standalone)+ `@astrojs/react` + `emdash({ database: sqlite({ url: "file:./data.db" }), plugins: [base64ImagePlugin()], fonts: false })`。`storage` は指定しない。管理画面のフォント `--font-emdash` を `local()` だけのプロバイダーで登録 |
| `playground/seed/seed.json` | 仕様書 13.1 と同じ `b64_images` と `posts` |
| `playground/src/live.config.ts`、`src/pages/index.astro` | EmDash のテンプレートと同じ定型と、トップページ(E2E 用のページは [[T26-playground-pages\|T26]]) |
| `playground/tsconfig.json` | `astro/tsconfigs/strict` + `types: ["node"]`(エディター用。`npm run verify` の対象外) |
| `playground/.gitignore` | 生成される `emdash-env.d.ts` と `.emdash/` を除外 |
| `playground/README.md` | 起動・停止、ポート、ログイン、seed、データベースの消し方、ビルド、生成されるファイル |

### 決めたこと

| # | 決めたこと | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 管理画面のフォントは `fonts: false` にし、`--font-emdash` を `local("Noto Sans")` だけのプロバイダーで自前で登録する | 既定のままだと、ビルドと起動のたびに Google Fonts を取得する(ネットワークなし・キャッシュなしで 11.07 秒、エラーの出力あり)。`fonts: false` だけだと管理画面が `FontFamilyNotFound` で表示できない | 実測+公式ドキュメント |
| 2 | scripts は `dev` / `build` / `preview` の 3 つ。`start`(`node ./dist/server/entry.mjs`)は入れない | `preview` と役割が重なる。`preview` は `-- stop` で止められる | 実測のみ |
| 3 | `vite.server.watch.ignored` は足さない | 監視は playground の中とプラグインのソースのファイルだけで、ルート・`node_modules`・`spikes/` をたどらない | 実測のみ |
| 4 | seed は仕様書 13.1 のまま。`posts` の `search` は有効にならない(`searchable` なフィールドが無い)が、例に合わせた | プラグインの確認には検索は要らない | 実測+公式ドキュメント |

### 確かめたこと

| 項目 | 結果 | 根拠レベル |
|---|---|---|
| 起動 | `npm run dev -w playground -- --port 4402` で起動。エージェントから実行すると Astro 7.3.3 が自動でバックグラウンドにし、`npm run dev -w playground -- stop` で止まる([[astro-dev-background-for-agents]]) | 実測+公式ドキュメント |
| 開発用ログイン | dev-bypass で管理画面に入れた(ダッシュボードまで 0.8〜2.0 秒)。初回は歓迎ダイアログが出る | 実測のみ |
| 管理画面から posts を作る | Playwright(Chromium 153、headless)で、新規作成 → タイトルと `cover` / `gallery` の JSON を入力 → Save → 下書きとして保存(55〜94ms)→ API と一覧で確認。新しいデータベースでも通った。スクリプトは `spikes/t02-playground/admin-posts.mjs`(コミットしない) | 実測のみ |
| widget が無いフィールドの表示 | `base64-image:image` / `base64-image:gallery` は、json の既定の入力欄(textarea、placeholder `{}`)で表示された。不正な JSON は「Invalid JSON」 | 実測+公式ドキュメント |
| `b64_images` の最小構成 | タイトル用のフィールドは不要。`routable: false` は必須(省略すると slug なしで公開できない)。`hidden` はサイドバーとクイックアクションだけ。公開でリビジョンが 1 件できる。`image: null` は 500 | 実測+公式ドキュメント |
| seed の適用 | データベースが空のときの最初のリクエスト(起動直後の typegen)と dev-bypass。既存のコレクションは飛ばす。seed の変更は動いているサーバーに反映されない | 実測+公式ドキュメント |
| 監視 | 監視対象は 9 ディレクトリ・24 項目。playground の外で 3,000 ファイルを書いて消しても、イベント 0 件・CPU 時間の増加なし([[vite-watch-scope-playground]]) | 実測のみ |
| ビルド | データベースもネットワークも使わない。`data.db` が無くても通る。`.emdash/migrations.json` を書く | 実測+公式ドキュメント |

詳しくは知見ノート [[emdash-playground-site-config]]、[[emdash-seed-and-b64-images]]、[[vite-watch-scope-playground]]、[[astro-dev-background-for-agents]]。

### ビルドの時間

| 計測 | 時間 |
|---|---|
| `npm run build -w playground`(オンライン、3 回) | 1.95 / 1.97 / 2.00 秒 |
| 同上(`sandbox-exec` で外向きの通信を禁止、キャッシュなし) | 2.57 秒 |
| `npm run verify` 全体(3 回。1 回目は Vite の依存の再最適化あり) | 4.97 / 3.62 / 3.42 秒 |
| うち `astro build`(Astro の表示の `Server built in`) | 2.15 / 1.46 / 1.47 秒 |

環境: macOS 26.4(arm64)、Node 26.10.0、npm 12.0.2、Astro 7.3.3、Vite 8.3.0。根拠: **実測のみ**

### storage を省略したときの挙動

- EmDash 0.39.1 は、`storage` を省略すると `./.emdash/uploads` の local storage を既定で使う(`references/emdash/packages/core/src/astro/integration/index.ts:71-75`、`:335`、公式ドキュメントの `configuration.mdx:73`)。playground でもメディアのアップロードが 201 で成功した。**仕様書 2.3 の「`NO_STORAGE` になる」状態は、Node では再現しない。** 根拠: **実測+公式ドキュメント**
- `storage: false`(型定義には無い)を一時的な設定で試すと、アップロードは 500 `NO_STORAGE` になり、posts の作成は通った。指示どおり、playground は `storage` を省略したままにした。根拠: **実測のみ**

### 仕様書・他タスクへの影響(リーダーへ)

- **ルートの `.prettierignore` に `playground/emdash-env.d.ts` が必要**。開発サーバーが生成するこのファイルは prettier の書式に合わず、無いと開発サーバーを起動したあとの `npm run verify` が失敗する(prettier は `playground/.gitignore` を読まない)。T02 では変更していない。根拠: **実測のみ**
- 仕様書 2.3 / 13.3: `storage` の省略は「storage なし」にならない(上記)。Cloudflare で省略したときの挙動は [[T32-cloudflare-check|T32]] で確かめる必要がある。playground を本当に storage なしにするかどうかは要判断(`storage: false` は型の外)。
- 仕様書 5.1 / 5.4: `supports: []` でも公開時に画像データを複製したリビジョンが 1 件でき、容量の見積もり(約 5,000 枚)は約半分になる見込み。
- [[T19-image-entry-hook|T19]]: `image: null` は EmDash の検証を通り、DB の制約で 500 になる。保存 hook で先に拒否する。
- [[T09-spike-query-count|T09]]: 開発サーバーの応答の `Server-Timing` に `db.count`(クエリ数)が出る。
- [[T26-playground-pages|T26]] / [[T31-e2e|T31]]: 空のデータベースでは最初の公開ページが `/_emdash/admin/setup` に 302 になることがある。最初のログインで歓迎ダイアログが出る。同じタイトルの投稿は slug が重なって 409 になる。

## 変更してよいファイル

- `playground/**`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
