---
title: workerd + D1(wrangler dev)でのプラグインの動きと、Node + SQLite との違い
aliases:
  - workerd と Node の違い
  - D1 でのクエリ数
  - D1 の読んだ行と書いた行
  - Workers で storage を省略したときのエラー
tags:
  - docs
  - cloudflare
  - d1
  - workerd
  - testing
source_task: "[[T32-cloudflare-check]]"
created: 2026-09-24
updated: 2026-09-24
---

# workerd + D1(wrangler dev)でのプラグインの動きと、Node + SQLite との違い

> [!summary] 要点
> - playground を Cloudflare アダプターでビルドし、`wrangler dev`(workerd + ローカルの D1)で動かした。アップロード・body の上限・保存 hook・参照元の記録・画像管理のルート・i18n・サイトのページ・管理画面の入口は、どれも Node + SQLite と同じ結果だった。プラグイン(`src/**`)の不具合は見つからなかった。根拠: 実測のみ
> - クエリ数は、SQLite の `begin` / `commit` の分だけ少ない。アップロード 1 回は 71(SQLite は 75)、i18n のサイトで 73(同 77)。hook のクエリ数(beforeSave 3、afterSave 0 / 3 / 新しい参照元 1 つにつき +2、afterPublish 3)、画像管理の一覧(最も重いページで 92。予算は 100)、ゴミ箱(9)は Node と同じ。根拠: 実測+公式ドキュメント
> - アップロード 1 回で、D1 は 761 行を読み、93 行を書く。読んだ行のうち 632 行は、EmDash が書き込みの前に `sqlite_master` を 2 回、全件読む分。Free の書き込みの上限(10 万行 / 日)は、アップロードだけなら約 1,000 回 / 日にあたる。根拠: 実測+公式ドキュメント
> - Node と違ったのは、どれも EmDash 側の動き。①消されたコレクションの `get` の例外が、`code` の無い `Error`(`D1_ERROR: no such table: …`)になる(プラグインは `code` を見ないので、結果は同じ)。②匿名の HTML のリクエストでは、レイアウトの先読みで 5 クエリ増える。③`storage` を省略したときの標準のメディアのアップロードが、`NO_STORAGE` でなく 500 `UPLOAD_ERROR`(`mkdir` の `EPERM`)になる。根拠: 実測+公式ドキュメント
> - ローカルの D1 では、同じ画像を参照する 8 件の同時作成を 4 回くり返しても、参照元の記録の書き直し(版の不一致)は 0 回だった。本番の D1 での起きやすさ、CPU 時間、起動時間は、デプロイが要るので測っていない(利用者の了承待ち。[[T32-cloudflare-check#デプロイして測る(任意・利用者の了承待ち)]])。
> - playground の Worker は圧縮前 13,158 KiB で、2026-09-04 からの上限(圧縮前 64 MiB。Free も同じ)に収まる。根拠: 実測+公式ドキュメント
> - 動かし方と測り方は [[wrangler-dev-local-measurement]]。関連: [[T32-cloudflare-check]]、[[base64-image-plugin-spec#2. 動作環境と制約|仕様書 2 章]]、[[base64-image-plugin-spec#18. 既知の制約とリスク|仕様書 18 章]]、[[cloudflare-workers-free-d1-limits]]

## 1. 環境と測り方

| 項目 | 版 |
|---|---|
| OS | macOS 26.4(25E246)、arm64(Apple M5 Pro) |
| Node / npm | 26.10.0 / 12.0.2 |
| wrangler | 4.135.0(workerd 1.20260918.1、miniflare 5.20260918.0-alpha) |
| Astro / アダプター | Astro 7.3.3、`@astrojs/cloudflare` 14.3.2(`@cloudflare/vite-plugin` 1.56.0、Vite 8.3.0) |
| EmDash | `emdash` 0.39.1、`@emdash-cms/cloudflare` 0.39.1(`d1({ binding: "DB", session: "auto" })`) |
| ブラウザ | Playwright 1.63.0 の Chromium 153 / Firefox 155 |

- `npm run build:cloudflare -w playground` でビルドし、`wrangler dev --port 8732 --inspector-port 9332 --ip 127.0.0.1` で動かした。本番のビルドを、ローカルの D1 で動かしている。2026-09-24 に計測。
- クエリ数は、応答の `Server-Timing` の `db.count`。D1 の呼び出しの数・読んだ行・書いた行は、wrangler dev の Local Explorer の span から数えた([[wrangler-dev-local-measurement#4. Local Explorer で D1 の呼び出しを数える]])。
- 認証は、ことわりが無ければセッションの Cookie(`X-EmDash-Request: 1` を付ける)。API トークンでは、トークンの確認と `last_used_at` の更新の 2 クエリ(書き 1 行)が増える。
- hook ごとのクエリ数は、使い捨てのサイト(`spikes/t32/site/`、git 管理外)で測った。本物の `createBase64ImagePlugin()` の hook を包み、前後の `getRequestContext().metrics.dbCount` の差をログに出す([[#11. 再現手順]])。
- 行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。

## 2. 結果の一覧

| 確かめたこと | workerd + D1 | Node + SQLite(これまでの実測) | 根拠 |
|---|---|---|---|
| アップロード 1 回のクエリ数 | 71(トークンでは 73)。i18n のサイトで 73 | 75、i18n で 77([[emdash-plugin-upload-route#クエリ数]]) | 実測+公式ドキュメント |
| アップロード 1 回の D1 の行 | 読み 761・書き 93。DB は 1 回あたり約 42KB 増える | (数えていない) | 実測のみ |
| body の上限とエラー | 600,000 バイトまで 200、600,001 で 413 `INVALID_PLUGIN_REQUEST`(chunked も同じ)。JSON・UTF-8 の誤りは 400 `INVALID_PLUGIN_REQUEST`、スキーマ違反は 400 `VALIDATION_ERROR` | 同じ([[emdash-plugin-route-body-limit]]) | 実測のみ |
| 保存 hook の拒否 | 422 `SAVE_REJECTED`。`message` は日本語と英語の 2 行(`\n` はそのまま) | 同じ([[emdash-content-before-save]]) | 実測のみ |
| 参照元の記録の hook | beforeSave 3(画像のフィールドが無い保存は 2)、afterSave 0 / 3 / 新しい参照元 1 つにつき +2、afterPublish 3 | 同じ([[image-owner-tracking-hooks]]) | 実測のみ |
| 同時作成・同時公開 | 8 件の同時作成 × 4 回で参照元は 8 / 8、書き直しは 0 回。同時公開 5 件でも消えない | 消えない([[emdash-plugin-storage-conditional-writes]]) | 実測のみ |
| `b64_images` があるかの確認 | isolate の最初の保存で +2(34、その後は 32) | インスタンスの最初の保存で +2([[emdash-native-plugin-lifecycle-hooks]]) | 実測のみ |
| lifecycle hook | 起動しただけでは `plugin:install` / `plugin:activate` は呼ばれない。無効 → 有効で `plugin:activate`(+2 クエリ) | 同じ([[emdash-native-plugin-lifecycle-hooks]]) | 実測のみ |
| 画像管理の一覧・ゴミ箱 | 1 ページ 13〜50、最も重いページで 92。ゴミ箱 9、知らない ID は 404 で 2 | 42〜90、ゴミ箱 9([[image-management-routes#ページごとの実測]]) | 実測のみ |
| 消されたコレクションの `get` | `Error`「`D1_ERROR: no such table: ec_…: SQLITE_ERROR`」(`code` なし)。失敗したクエリは `db.count` に入らない。参照元は `owner_deleted` | `ERR_SQLITE_ERROR` の no such table。`db.count` に入らない | 実測のみ |
| i18n | `getI18nConfig()` がサイトの設定を返す。`target.locale` の扱いも同じ | [[emdash-plugin-upload-route#ルートでの扱い]] | 実測のみ |
| サイトのページ | `/posts/` と詳細は 2 クエリ。HTML のリクエスト(`Accept: text/html`)では +5 | 先読みなし | 実測+公式ドキュメント |
| 管理画面の入口 | 20 項目すべて通った(Chromium の ja / en、Firefox の ja) | 同じ([[emdash-admin-entry-assembly]]) | 実測のみ |
| `storage` を省略したときの標準のメディア | 500 `UPLOAD_ERROR`(`Upload failed`。`mkdir` の `EPERM`) | 成功する(`./.emdash/uploads`) | 実測+公式ドキュメント |

## 3. アップロードのクエリ数と D1 の行

### クエリ数

- 71 = 75 − 4。SQLite での `begin` / `commit`(作成と公開の 2 組)が、D1 では出ない。EmDash の `withTransaction` は、D1 ではトランザクションを使わずに中身をそのまま実行する(`core/src/database/transaction.ts:1-11`、`:28-56`)。D1 の呼び出し 71 回は、すべて 1 本ずつのクエリだった(`batch` は 0)。根拠: 実測+公式ドキュメント
- i18n のサイトも同じく 4 本少ない 73(SQLite は 77)。
- 1 呼び出しの Cloudflare のサービスへのサブリクエストの上限(Free で 1,000。[[cloudflare-workers-free-d1-limits]])には十分収まる。D1 の limits のページに残る「Free は 1 呼び出し 50 クエリ」は wrangler dev では当てはまらず、D1 の呼び出しが 92 回のリクエストも通った。ただし wrangler dev が本番の上限を再現しているかは分からないので、本番の上限の確認にはならない(推測のみ)。

### D1 の読んだ行・書いた行

5 回のアップロード(WebP 15〜22KB、Cookie の認証)で、毎回同じ値だった。根拠: 実測のみ

| 項目 | 値 |
|---|---|
| D1 の呼び出し | 71 |
| 読んだ行(`rows_read` の合計) | 761 |
| 書いた行(`rows_written` の合計) | 93 |
| DB の大きさ(`size_after` の差) | 1 回あたり約 42KB |

- 読んだ行の 632 行(316 × 2)は、`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?` の 2 本。EmDash の書き込みの前の確認(`core/src/api/media-usage-write-fence.ts:41` が `core/src/database/dialect-helpers.ts:176-179` の `tableExists` を呼ぶ)で、作成と公開で 1 回ずつ。`sqlite_master` には名前の索引が無く、全件を読む(`EXPLAIN QUERY PLAN` は `SCAN sqlite_master`)。playground(コレクション 2 つ)で 316 行、コレクションを 1 つ(`title` だけ)足した DB では 338 行だった。コレクションやフィールドが増えると、書き込みのたびに読む行も増える。根拠: 実測+公式ドキュメント
- 書いた行で大きいのは、画像エントリの `INSERT`(25 行)と公開の `UPDATE`(14 行)。索引の分も 1 行と数える(D1 の料金の定義)。プラグインの `imageRefs` の記録(upsert)は 3 行。残りは EmDash のメディアの使用状況の索引とリビジョンの分。根拠: 実測+公式ドキュメント
- D1 の料金の定義では、読んだ行はスキャンした行の数、書いた行は `INSERT` / `UPDATE` / `DELETE` の行の数で、索引のある列を書くと索引の分も数える(https://developers.cloudflare.com/workers/platform/pricing/#d1)。ローカルの D1 の数え方が本番と同じかは確かめていない(推測のみ)。

### Free の 1 日の上限との関係

| 操作 | 書いた行 | 読んだ行 |
|---|---|---|
| アップロード 1 回 | 93 | 761 |
| 投稿の作成(画像あり / なし) | 50 / 49 | — |
| 投稿の保存・自動保存 | 39〜40 | — |
| 投稿の公開 | 38 | — |

- 投稿の行は、API トークンで送った値(トークンの `last_used_at` の 1 行を含む)。afterSave の hook の書き込みも含む。根拠: 実測のみ
- Free の上限(書き 10 万行・読み 500 万行 / 日)に対して、アップロードだけなら書きで約 1,075 回 / 日、読みで約 6,570 回 / 日。先に書きの上限に届く。投稿の保存は約 2,000〜2,500 回 / 日。ふつうの編集では問題にならないが、一括の取り込みでは上限に届きうる。根拠: 実測+公式ドキュメント(上限は [[cloudflare-workers-free-d1-limits]])

## 4. 参照元の記録

### hook ごとのクエリ数

使い捨てのサイトで、hook の前後の `metrics.dbCount` の差を数えた。Node の実測([[image-owner-tracking-hooks#操作ごとの記録とクエリ数]])と同じ。根拠: 実測のみ

| 操作 | db.count | beforeSave | afterSave / afterPublish |
|---|---|---|---|
| 作成(カバーに画像 A。新しい参照元) | 35 | 5(= 3 + isolate の最初の保存の 2) | afterSave 5(= 3 + 2) |
| 同じ参照のまま保存 | 55 | 3 | afterSave 3 |
| ギャラリーに画像 B を足して保存 | 64 | 3 | afterSave 5 |
| 自動保存(`skipRevision`) | 62 | 3 | afterSave 3 |
| 公開 | 50 | — | afterPublish 3 |
| 画像の無い投稿の作成 | 32 | 2 | afterSave 0 |

- afterSave・afterPublish のクエリは、応答のあと(`after()` → `waitUntil`)に実行され、`Server-Timing` の `db.count` に入らなかった(作成で `db.count` 35、同じリクエストの trace の D1 の呼び出しは 40)。同じ呼び出し(invocation)の trace には入るので、サブリクエストの数には入るとみられる([[emdash-after-save-payload#呼ばれる時機]] の見込みと同じ)。根拠: 実測のみ(サブリクエストの数え方は推測のみ)
- `b64_images` があるかの確認: サーバーを起動し直した直後の保存が 34、2 回目から 32 だった(+2)。Workers では isolate が作られるたびに起きる。根拠: 実測のみ

### 同時の書き込み

- 同じ画像を参照する投稿 8 件を同時に作成した。4 回くり返して、どれも 201、参照元は 8 / 8、`compareAndSet` の `UPDATE` は 8 回で、書き直し(`changes` が 0)は 0 回だった。根拠: 実測のみ
- 別の画像で、同時作成 8 件のあと、そのうち 1 件を複製した 5 件(複製は hook を呼ばないので、まだ記録されていない)を同時に公開した。参照元は 0 → 8 → 13 で、記録から漏れた投稿は 0 件。根拠: 実測のみ
- ローカルの D1 は、1 つの SQLite で順に実行し、ネットワークの待ちが無い。本番の D1 では読みと書きの間が長くなるので、書き直しは起きやすくなるとみられる(推測のみ)。

## 5. 画像管理のルート

- 一覧のクエリ数は、1 ページ 13〜50(API トークン。9 ページ)。最も重い形(画像がゴミ箱にあり、参照元は下書きだけに画像)を 8 枚作り、ほかの 1 枚と同じページに並べたところ 92 だった(予算 100。SQLite では、この形 8 枚だけのページで 90)。根拠: 実測のみ
- ゴミ箱への移動は 9(もう一度送っても 9)、知らない ID は 404 `IMAGE_NOT_FOUND` で 2。API トークンでは、どちらも +2。根拠: 実測のみ
- 一覧の最初のページを並行に送った応答時間(ローカル、ms): 1 件で 15、5 件で中央値 62、10 件で中央値 89・最大 116。すべて 200。根拠: 実測のみ(本番の D1 の待ちは含まない)

### 消されたコレクション

- 参照元のコレクションを消したあと、プラグインの `ctx.content.get(<消したコレクション>, id)` は次の例外を投げた。Node(SQLite)の `code: "ERR_SQLITE_ERROR"` と違い、`code` が無い。根拠: 実測のみ

```json
{
  "ctor": "Error",
  "name": "Error",
  "message": "D1_ERROR: no such table: ec_evs76213: SQLITE_ERROR",
  "cause": { "ctor": "Error", "name": "Error", "message": "no such table: ec_evs76213: SQLITE_ERROR" }
}
```

- プラグインの一覧は、`get` が例外を投げたら、コードを見ずにコレクションの一覧を読み、無ければ `owner_deleted` にする(`src/server/orphans.ts:18-20`)。D1 でも `owner_deleted` になった。根拠: 実測+公式ドキュメント(プラグインのソース)
- 失敗したクエリは、D1 の span には出る(`error.type` に上のメッセージ)が、`db.count` には入らない(一覧の 1 ページ目で `db.count` 41、D1 の呼び出し 42)。SQLite と同じ。根拠: 実測のみ

## 6. i18n

i18n のサイト(既定 `ja`、`ja` / `en`、`prefixDefaultLocale: false`)を別の D1 の状態で作って確かめた。根拠: 実測のみ

- workerd でも `getI18nConfig()` は `{ "defaultLocale": "ja", "locales": ["ja", "en"], "prefixDefaultLocale": false }` を返した。`ctx.site.locale` は `"en"` で、i18n の設定とは別(Node と同じ)。
- アップロードの結果は、Node の表([[emdash-plugin-upload-route#ルートでの扱い]])と同じだった。

| `target` | 結果 | 参照の `locale` | 参照元の `locale` | クエリ数 |
|---|---|---|---|---|
| `locale` も `entryId` も無い | 200 | `ja` | (参照元なし) | 73 |
| `ja` のエントリ、`locale: "ja"` | 200 | `ja` | `ja` | 73 |
| `en` のエントリ、`locale: "en"` / `"EN"` | 200 | `ja` | `en`(設定の表記にそろう) | 73 |
| `en` のエントリ、`locale` なし | 200 | `ja` | `ja`(サイトの既定) | 73 |
| `locale: "fr"` | 400 `INVALID_TARGET` | — | — | 1 |

## 7. サイトのページと、レイアウトの先読み

| URL | `Accept: */*` | `Accept: text/html` | 読んだ行 |
|---|---|---|---|
| `/posts/`(一覧) | 2(起動直後は 3) | 7(同 9) | 105 / 111 |
| `/posts/<slug>/`(詳細) | 2 | 7 | 52 / 58 |
| `/` | 0 | 5 | 0 / 6 |

- HTML のリクエストで増える 5 本(`_emdash_widget_areas`・`_emdash_menus`・`taxonomies` × 2・`_emdash_widgets`)は、EmDash のレイアウトの先読み(`prefetchLayoutData`)。リクエスト単位の DB(D1 など)で、`Accept` の先頭が `text/html` のときだけ `after()` で走る(`core/src/astro/middleware.ts:824-849`、`core/src/astro/prefetch.ts`)。同期の SQLite では走らない。プラグインのクエリではない。根拠: 実測+公式ドキュメント
- 画像は `<img src="data:image/webp;base64,…" width height>` で出て、ゴミ箱に入れた画像は「画像が見つかりません」の枠になった。ログには `[base64-image] 1 image(s) not found in "b64_images" …` の警告が出た。根拠: 実測のみ

## 8. 管理画面の入口

wrangler dev(本番のビルド)で、Playwright から次の 20 項目を確かめた。Chromium(ja / en)と Firefox(ja)で、すべて通った。根拠: 実測のみ

- ダッシュボードでの入口の読み込み(マニフェストの要求 2 回)、サイドバーの「画像」(en は「Images」)
- 画像管理ページ(一覧 200、サムネイルのある行)、プラグインの管理画面の「プラグインページ」から画像管理ページ
- 投稿の一覧のサムネイルの列(見出し、サムネイル 20 枚、サムネイルの要求 1 回、新しい行のサムネイル)
- 新規作成: `#field-cover` が fieldset、`#field-gallery` がボタン、JSON の入力欄が無い、アップロード 3 回がすべて 200、保存 201、保存した参照(1600×1067 のカバー、800×600・600×800 のギャラリー)、保存後の URL(`?locale=en`)
- 読み込み直し: プレビューの要求 2 回、画像 3 枚の表示
- Block Kit の管理画面の要求が無い、API のエラーが無い
- console: Chromium は無し。Firefox は CSP の eval の違反のエラーと scroll-linked の警告で、どちらも既知の EmDash 側のもの([[emdash-admin-console-noise]])。

## 9. storage を省略したとき(標準のメディアのアップロード)

- `POST /_emdash/api/media`(WebP 1 枚)は 500 `{"success":false,"error":{"code":"UPLOAD_ERROR","message":"Upload failed"}}` だった。ログは `[UPLOAD_ERROR] EmDashStorageError: Failed to upload file: <ID>.webp`(`code: 'UPLOAD_FAILED'`)で、原因は `Error: operation not permitted`(`syscall: 'mkdir'`、`code: 'EPERM'`)。根拠: 実測のみ
- `storage` を省略すると EmDash は `./.emdash/uploads` の local storage を使い、その `fs.mkdir` が workerd では許されない(`core/src/storage/local.ts:80`、`:107`)。ルートは例外を `UPLOAD_ERROR` にする(`core/src/astro/routes/api/media.ts:285`)。`NO_STORAGE` は storage が無いときだけ(同 `:124`)。根拠: 実測+公式ドキュメント
- 仕様書 2.3 の「標準のメディアのアップロードは使えない」は変わらない。エラーのコードが `NO_STORAGE` でないだけ。本番の Workers は確かめていない。

## 10. Worker の大きさ・起動時間・CPU 時間

- 大きさ: wrangler dev が表示した playground の Worker は 518 モジュール、13,157.72 KiB(圧縮前)。wrangler と同じ方法(全モジュールを続けて gzip)で数えると約 3,358 KiB。大きいのは EmDash と Astro のチャンクで、1 ファイルで最大 1,091 KiB。根拠: 実測のみ
- 上限: 2026-09-04 から、圧縮後の上限(Free 3 MB・Paid 10 MB)は無くなり、圧縮前の 64 MiB だけになった(Free・Paid とも)。playground の Worker は収まる(以前の Free の 3 MB は超えていた)。wrangler 4.135.0 のサイズの表示も 64 MiB を基準にしている(`MAX_UNCOMPRESSED_SIZE_BYTES`)。根拠: 実測+公式ドキュメント(https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/、https://developers.cloudflare.com/workers/platform/limits/#worker-size)
- 起動時間: 上限は 1 秒(グローバルスコープの評価)。本当の値は `wrangler deploy` か `wrangler versions upload` の出力の `startup_time_ms` で分かる(https://developers.cloudflare.com/workers/platform/limits/#worker-startup-time)。`wrangler check startup` はローカルで測るが、中で `wrangler deploy --dry-run` を動かすので、T32 では実行しなかった(Cloudflare に接続しないことを確かめきれないため)。未測定。根拠: 公式ドキュメントのみ
- CPU 時間: 測っていない。wrangler dev のインスペクターで CPU プロファイル(1ms 間隔)を取ると、アップロード 1 回の busy は約 112ms だった。ただし 224ms 中 163ms が Kysely の `provideConnection` で、ローカルの D1 の処理が入っているとみられる。ローカルの root span の `cpu_time_ms` も 0 だった。Workers の CPU 時間(I/O の待ちは含まない)の見積もりには使えない。Node での値は、ルートの検証全体が中央値 0.40ms / 0.93ms([[emdash-plugin-route-body-limit#CPU 時間(Node)]])、`preview` 10 件 × 500,000 バイトが 3.5〜5.6ms([[emdash-plugin-preview-thumbnail-routes]])。根拠: 実測のみ(D1 の処理とみたのは推測のみ)

## 11. 再現手順

- 動かし方(ビルド・ログイン・トークン)と、D1 の呼び出しの数え方は [[wrangler-dev-local-measurement]]。
- 使い捨てのサイトは、playground の `src/`・`seed/` と `astro.config.cloudflare.mjs` を複製し、プラグインを次の形で登録した(`plugins: [{ id: "base64-image", version: "0.0.0", entrypoint: "/plugins/spike-base64.ts", options: {} }]`)。i18n のサイトは、アダプターの `persistState: { path: ".wrangler/state-i18n" }` と `wrangler dev --persist-to .wrangler/state-i18n` で D1 の状態を分けた。

```ts
// spikes/t32/site/plugins/spike-base64.ts(抜粋)。hook を包んで、前後のクエリ数の差をログに出す
import { getRequestContext } from "emdash";
import { createBase64ImagePlugin } from "../../../../src/server/plugin.ts";

function wrap(name, hook) {
	return {
		...hook,
		handler: async (event, ctx) => {
			const metrics = getRequestContext()?.metrics;
			const before = metrics?.dbCount;
			try {
				return await hook.handler(event, ctx);
			} finally {
				const dbDelta = metrics && before !== undefined ? metrics.dbCount - before : null;
				console.log(`[t32-hook] ${JSON.stringify({ hook: name, collection: event?.collection, dbDelta })}`);
			}
		},
	};
}

export function createPlugin() {
	const plugin = createBase64ImagePlugin();
	const hooks = Object.fromEntries(Object.entries(plugin.hooks).map(([k, h]) => [k, wrap(k, h)]));
	return { ...plugin, hooks };
}
```

- 同時の書き込みは、アップロードで画像を 1 枚作り、その参照を `cover` に入れた投稿の作成(`POST /_emdash/api/content/posts`)を `Promise.all` で 8 件同時に送った。書き直しの回数は、各リクエストの trace の `_plugin_storage` への `UPDATE` のうち、`cloudflare.d1.response.changes` が 0 のものを数えた。参照元の数は、D1 に `SELECT data FROM _plugin_storage WHERE plugin_id = 'base64-image' AND collection = 'imageRefs' AND id = '<画像 ID>'` を送って読んだ。
