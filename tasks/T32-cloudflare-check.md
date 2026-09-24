---
id: T32
title: "Cloudflare(wrangler dev + D1)で動作を確認する"
type: テスト
status: done
wave: 6
depends_on:
  - "[[T26-playground-pages]]"
  - "[[T29-plugin-definition]]"
  - "[[T30-admin-entry]]"
soft_depends_on: []
blocks:
  - "[[T34-release]]"
files:
  - "playground/wrangler.jsonc"
  - "playground/astro.config.cloudflare.mjs"
  - "playground/src/worker.ts"
  - "playground/package.json(scripts だけ)"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#2. 動作環境と制約]]"
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - test
created: 2026-09-23
---

# T32 Cloudflare(wrangler dev + D1)で動作を確認する

> [!info] 概要
> - 種別: テスト / ウェーブ: 6
> - 着手の条件(依存): [[T26-playground-pages|T26]]、[[T29-plugin-definition|T29]]、[[T30-admin-entry|T30]]
> - このタスクを待つもの: [[T34-release|T34]]
> - 仕様: [[base64-image-plugin-spec#2. 動作環境と制約|仕様書 2章]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15章]]

## 目的

Node + SQLite だけでなく、workerd + D1 でも動くことを確かめる。

## 作業内容

- [x] playground に wrangler の設定を追加する(D1 のみ、R2 なし)。依存(`@astrojs/cloudflare` 14.3.2・`@emdash-cms/cloudflare` 0.39.1・`wrangler` 4.135.0・`@cloudflare/workers-types` 5.20260921.1)は [[T32-1-cloudflare-deps|T32-1]] で入れた。設定と `src/worker.ts` は、T07 の spike の形([[git-dependency-ts-source#再現の手順]])を playground に合わせて作る
- [x] `wrangler dev` で主なシナリオを確認する(手動、または E2E の一部)
- [x] workerd でも、プラグインのルートの body の上限(`maxBytes`)とエラー(413 `INVALID_PLUGIN_REQUEST`・400 `VALIDATION_ERROR`)が Node と同じになるかを確かめる([[T08-spike-route-body#仕様書とほかのタスクへの影響|T08]]、[[T08-1-spec-route-body|T08-1]])
- [x] D1 で、参照元の記録の hook のクエリ数(0 / 3 / 新しい参照元 1 枚につき +2)と、並行公開・同時作成で参照元が消えないことを確かめる([[T20-owner-tracking|T20]]、[[emdash-plugin-storage-conditional-writes]])
- [x] workerd でも、保存 hook の拒否が 422 `SAVE_REJECTED` と `message` になることを確かめる([[T16-reference-hook|T16]]・[[T19-image-entry-hook|T19]])
- [ ] 任意: 利用者のアカウントの Workers Free にデプロイし、CPU 時間とクエリ数を測る(手動。利用者の了承を得てから行う)。**未実施(利用者の了承待ち)。** 手順の案は [[#デプロイして測る(任意・利用者の了承待ち)]]。CPU 時間は、アップロード 1 回の全体(body の parse・検証・作成・公開)で測る(Node での検証だけの時間は 0.28ms。[[emdash-plugin-route-body-limit]])
  - ルートの検証全体(T11)は Node で中央値 0.40ms / 0.93ms(`fromBase64` / `atob`)。workerd には `Uint8Array.fromBase64` がある([[T07-spike-git-dependency#結果|T07]]、[[server-image-validation]])
  - `preview` 10 件 × 500,000 バイトの JS の処理は、Node で 3.5〜5.6ms([[emdash-plugin-preview-thumbnail-routes]])。Workers でも 10ms に収まるかを測る
- [x] D1 で、アップロード 1 回のクエリ数を確かめる(SQLite では 75、i18n のサイトで 77。SQLite の `begin` / `commit` の 4 本は D1 では出ない見込み)。workerd でも `getI18nConfig()` がサイトの i18n の設定を返し、`target.locale` の確認が Node と同じになることを確かめる([[T18-upload-route#クエリ数|T18]]、[[emdash-plugin-upload-route]])
- [x] playground のページ(`/posts/`・`/posts/<slug>/`)は `wrangler dev` でもそのまま使える見込み。サンプルの投稿を作るスクリプトは開発用ログイン(`astro dev` だけ)を使うので、`wrangler dev` では使えない(API トークンでのログインには対応していない)。データの作り方を決める([[T26-playground-pages#他のタスクへの影響|T26]])
- [x] D1 で、画像管理の一覧のクエリ数(予算は 1 リクエスト 100。SQLite の実測は 1 ページ 42〜90)と、ゴミ箱のルートのクエリ数(9)を確かめる。一覧を並行に投げたときの応答時間と、消されたコレクションの `get` の例外の形(SQLite は `ERR_SQLITE_ERROR` の no such table。そのクエリは `db.count` に数えられない)も確かめる([[image-management-routes]]、[[T21-orphan-routes#仕様書・他のタスクへの影響|T21]])
- [x] `b64_images` があるかの確認は、プラグインのインスタンスごとの最初の `b64_images` 以外の保存でクエリを増やす(あれば +2、無ければ +1)。Workers では isolate が作り直されるたびに起きるので、D1 で数を確かめる。config で登録した native プラグインで、起動時に lifecycle hook(`plugin:install` / `plugin:activate`)が呼ばれないことは Node でだけ確かめた(workerd でも同じとみられる。推測のみ)([[T29-plugin-definition#他のタスクへの影響・サブタスクの候補|T29]]、[[emdash-native-plugin-lifecycle-hooks]])
- [x] 管理画面の入口(widget・一覧の列・サイドバーの項目と画像管理ページ)が、wrangler dev でも動くことを確かめる。T30 は Node の開発サーバーと本番のビルドだけで確かめた(確かめ方は [[emdash-admin-entry-assembly#6. 再現手順]])([[T30-admin-entry#未解決|T30]])

## 完了条件

- [x] 結果をこのノートに根拠レベル付きで記録した

## 変更してよいファイル

- `playground/wrangler.jsonc`
- `playground/astro.config.cloudflare.mjs`
- `playground/src/worker.ts`([[T32-1-cloudflare-deps|T32-1]] のときに追加)
- `playground/package.json`(scripts だけ。依存は [[T32-1-cloudflare-deps|T32-1]] で入れた)
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!summary] 要点
> - playground に Cloudflare 用の設定(D1 だけ。R2 と cron なし)を足し、`wrangler dev`(workerd + ローカルの D1)で、アップロード・body の上限・保存 hook・参照元の記録・画像管理のルート・i18n・サイトのページ・管理画面の入口を確かめた。どれも Node + SQLite と同じ結果で、**プラグイン(`src/**`)の不具合は見つからなかった**。根拠: 実測のみ
> - クエリ数は `begin` / `commit` の分だけ少ない(アップロード 71。SQLite は 75)。hook・画像管理の一覧(最も重いページで 92 / 予算 100)・ゴミ箱(9)は Node と同じ。アップロード 1 回で D1 は 761 行を読み、93 行を書く(Free の書き込みの上限で約 1,000 回 / 日)。根拠: 実測+公式ドキュメント
> - Node と違ったのは EmDash 側の 3 点(消されたコレクションの例外の形、匿名の HTML のリクエストでのレイアウトの先読み +5 クエリ、`storage` を省略したときの標準のメディアのアップロードが 500 `UPLOAD_ERROR`)。プラグインの動きは変わらない。
> - サンプルの投稿のスクリプトに `--token`(API トークン)を足し、ビルドしたサイトでもデータを作れるようにした。トークンは、同じローカルの状態を使う Cloudflare アダプターの開発サーバーの開発用ログイン(`?token=1`)で作る。
> - デプロイしての測定(CPU 時間・起動時間・本番の D1)は、**利用者の了承待ち**で行っていない。手順の案は [[#デプロイして測る(任意・利用者の了承待ち)]]。
> - 知見ノート: [[workerd-d1-plugin-behavior]](結果と Node との違い)、[[wrangler-dev-local-measurement]](動かし方・測り方・wrangler dev の注意)

### 変更したファイル

| ファイル | 変更 |
|---|---|
| `playground/wrangler.jsonc`(新規) | wrangler の設定。D1 の `DB` だけ(`database_id` なし)。`send_metrics: false` |
| `playground/astro.config.cloudflare.mjs`(新規) | Cloudflare アダプターと `d1({ binding: "DB", session: "auto" })`。`storage` なし。`inspectorPort: false` |
| `playground/src/worker.ts`(新規) | Worker の入口。EmDash のテンプレート(`templates/starter-cloudflare/src/worker.ts`)と同じ形 |
| `playground/package.json` | scripts に `dev:cloudflare`・`build:cloudflare`・`preview:cloudflare` を足した(依存は変えていない) |
| `playground/scripts/create-sample-posts.ts` | `--token` / `EMDASH_TOKEN` を足した。今までの使い方(開発用ログイン・`--trash-cover` など)は変えていない |
| `playground/README.md` | 「Cloudflare(workerd + D1)で動かす」の節、`--token`、`.wrangler/`。スクリプトが `npm run typecheck` の対象外という古い記述を直した(T26-1 で対象になっている) |
| `plans/base64-image-plugin-spec.md` | 2.2・2.3・15・18 章の Cloudflare に関する箇所だけ([[#仕様書・ほかのタスクへの影響]]) |
| `docs/workerd-d1-plugin-behavior.md`・`docs/wrangler-dev-local-measurement.md`(新規) | 知見ノート |

### 決めたこと

1. **Cloudflare 用の設定の形**: EmDash のテンプレート(`templates/starter-cloudflare`)から R2(`storage`)と cron を外した形にした。`compatibility_date`(`2026-02-24`)と `nodejs_compat` はテンプレートと同じ。`database_id` は書かない(ローカルだけで使う。ローカルの D1 の ID はバインディング名になる)。Node 用の `astro.config.mjs` と `npm run verify` はそのまま。根拠: 実測のみ(`npm run verify` が通ること、両方のビルドが動くこと)
2. **利用状況を送らない**: `wrangler.jsonc` に `send_metrics: false` を書いた(`WRANGLER_SEND_METRICS=false` と同じ)。開発サーバーは `cloudflare({ inspectorPort: false })` で workerd のデバッガーのポートを開かない。根拠: 実測+公式ドキュメント(wrangler のソース。[[wrangler-dev-local-measurement#5.3 利用状況の送信と、利用者の設定ディレクトリへの書き込み]])
3. **データの作り方**: `wrangler dev` は本番のビルドなので、開発用ログインは 403。Cloudflare アダプターの開発サーバー(`npm run dev:cloudflare -w playground`)は同じローカルの状態(`playground/.wrangler/state/v3` の D1 とセッションの KV)を使うので、そこで開発用ログインをすれば、その Cookie と `?token=1` の API トークンが `wrangler dev` でも使える。サンプルの投稿のスクリプトには `--token`(環境変数 `EMDASH_TOKEN`。EmDash の CLI と同じ名前)を足した。`--token` のときは `Authorization: Bearer` で送り、無ければ今までどおり開発用ログイン。`wrangler dev` と Node の `npm run preview`(どちらも開発用ログインは 403)で投稿 2 件と `--trash-cover` が通り、トークンなしでは `--token` を促すメッセージで止まることを確かめた。根拠: 実測+公式ドキュメント(`core/src/astro/routes/api/setup/dev-bypass.ts:46-49`・`:146-169`)
4. **測り方**: クエリ数は `Server-Timing` の `db.count`、D1 の呼び出し・読んだ行・書いた行は wrangler 4.135 の Local Explorer の span、hook ごとの数は本物の hook を包んだ使い捨てのサイトで数えた([[wrangler-dev-local-measurement#4. Local Explorer で D1 の呼び出しを数える]])。
5. **`wrangler check startup` と `wrangler deploy --dry-run` は実行しない**: どちらも `wrangler deploy` の処理を通る(`check startup` は中で `deploy --dry-run` を動かす)。Cloudflare に接続しないことを確かめきれないので、起動時間はデプロイの測定に回した。根拠: 公式ドキュメントのみ(wrangler のソースとドキュメント)

### 確かめた結果

環境: macOS 26.4(arm64、Apple M5 Pro)、Node 26.10.0、wrangler 4.135.0(workerd 1.20260918.1)、`@astrojs/cloudflare` 14.3.2、Astro 7.3.3、EmDash 0.39.1、Playwright 1.63.0(Chromium 153・Firefox 155)。ポートは 4432(開発サーバー)・8732 / 9332(`wrangler dev`)。詳しい値と再現手順は [[workerd-d1-plugin-behavior]]。EmDash の行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。

| 作業内容 | 結果 | 根拠 |
|---|---|---|
| wrangler の設定 | `npm run build:cloudflare -w playground` → `npm run preview:cloudflare -w playground`(`wrangler dev`)で動いた。バインディングは `DB`(D1)・`SESSION`(KV)・`IMAGES`・`ASSETS`、どれもローカル。Worker は 518 モジュール・13,157.72 KiB(圧縮前)で、2026-09-04 からの上限(圧縮前 64 MiB)に収まる | 実測+公式ドキュメント |
| 主なシナリオ | スクリプトでのアップロード・投稿の作成と公開・ゴミ箱、`/posts/` と詳細の表示(`width` / `height` 付きの `<img>`、「画像が見つかりません」の枠)、管理画面(下の行)が動いた | 実測のみ |
| body の上限とエラー | Node と同じ。600,000 バイトまで 200、600,001 で 413 `INVALID_PLUGIN_REQUEST`(chunked も同じ)、10.5MB も 413。不正な JSON・空・UTF-8 でない body は 400 `INVALID_PLUGIN_REQUEST`、スキーマ違反は 400 `VALIDATION_ERROR`、寸法の不一致は 400 `IMAGE_DIMENSIONS_MISMATCH`。認証なし 401、GET 405、Cookie で `X-EmDash-Request` なし 403 `CSRF_REJECTED`。拒否のクエリは API トークンで 3(トークンの 2 を除くと Node の 1 と同じ)。ただし wrangler dev では、body を読まずに返した応答の直後の大きい body が約半分の割合で 500 になる(ProxyWorker の失敗。開発サーバーでは起きない。[[wrangler-dev-local-measurement#5.1 body を読まずに返した応答の直後のリクエストが失敗する]]) | 実測のみ |
| 参照元の記録の hook | 本物の hook の前後の `metrics.dbCount` の差で、beforeSave 3(画像のフィールドが無い保存は 2)、afterSave 0 / 3 / 新しい参照元 1 つにつき +2、afterPublish 3。Node と同じ。afterSave・afterPublish のクエリは `db.count` に入らず、同じリクエストの trace には入る | 実測のみ |
| 同時作成・並行公開 | 同じ画像を参照する 8 件の同時作成 × 4 回で、参照元は毎回 8 / 8、`compareAndSet` の書き直しは 0 回。複製 5 件の同時公開でも 8 → 13 で漏れなし。ローカルの D1 は待ちが無いので、本番の D1 のほうが書き直しは起きやすいとみられる(推測のみ) | 実測のみ |
| 保存 hook の拒否 | 422 `SAVE_REJECTED` と `message`(日本語と英語の 2 行、`\n` のまま)。posts: 知らない画像 ID・参照の形・`maxItems` 超え。b64_images: `image` を含む更新・WebP でない REST の作成 | 実測のみ |
| アップロードのクエリ数と i18n | 71(SQLite 75)。i18n のサイトで 73(同 77)。D1 ではトランザクションを使わない(`core/src/database/transaction.ts:1-11`)ので `begin` / `commit` の 4 本が出ない。API トークンでは +2。`getI18nConfig()` は workerd でもサイトの設定(既定 `ja`、`ja` / `en`)を返し、`target.locale` の扱い(参照の `locale` は `ja`、参照元の `locale` は `en` / `EN` → `en`、省略 → `ja`、`fr` → 400 `INVALID_TARGET` で 1 クエリ)も Node と同じ | 実測+公式ドキュメント |
| D1 の行 | アップロード 1 回で読み 761・書き 93、DB は約 42KB 増える。読みの 632 行は、EmDash の書き込みの前の確認が `sqlite_master` を 2 回全件読む分(`core/src/api/media-usage-write-fence.ts:41`)。投稿の作成・保存・公開は 1 回 38〜50 行を書く | 実測+公式ドキュメント |
| サイトのページとデータの作り方 | ページはそのまま動いた。`/posts/` と詳細は 2 クエリ。`Accept: text/html` では EmDash のレイアウトの先読みで +5(D1 のようなリクエスト単位の DB だけ。`core/src/astro/middleware.ts:824-849`)。データは [[#決めたこと]] の 3 | 実測+公式ドキュメント |
| 画像管理の一覧・ゴミ箱 | 一覧は 1 ページ 13〜50、最も重い形(ゴミ箱の画像・参照元は下書きだけ)8 枚のページで 92(予算 100。SQLite は 90)。ゴミ箱 9、知らない ID は 404 で 2。一覧を並行に 1 / 5 / 10 件送ると、応答時間の中央値は 15 / 62 / 89ms(最大 116ms、ローカル) | 実測のみ |
| 消されたコレクションの `get` | `code` の無い `Error`「`D1_ERROR: no such table: ec_…: SQLITE_ERROR`」(`cause` も `Error`)。SQLite の `ERR_SQLITE_ERROR` と違うが、プラグインはコードを見ずにコレクションの一覧で確かめる(`src/server/orphans.ts:18-20`)ので、参照元は `owner_deleted` になった。失敗したクエリは `db.count` に入らない(SQLite と同じ) | 実測+公式ドキュメント |
| `b64_images` の確認と lifecycle hook | 起動し直した直後の保存が 34、2 回目から 32(+2。isolate ごとに起きる)。起動しただけでは `plugin:install` / `plugin:activate` は呼ばれなかった(陽性対照: 無効 → 有効で `plugin:deactivate` / `plugin:activate` が呼ばれ、base64-image の `plugin:activate` は +2 クエリ)。T29 の「workerd でも同じとみられる(推測のみ)」は実測で確かめられた | 実測のみ |
| 管理画面の入口 | wrangler dev(本番のビルド)で 20 項目(入口の読み込み・サイドバーの「画像」・画像管理ページ・一覧のサムネイルの列・widget でのアップロード 3 回と保存・読み込み直しの表示・プラグインの管理画面からの移動など)が、Chromium(ja / en)と Firefox(ja)ですべて通った。console は既知の EmDash 側のものだけ([[emdash-admin-console-noise]]) | 実測のみ |
| `storage` を省略したとき | 標準のメディアのアップロードは 500 `UPLOAD_ERROR`(`Upload failed`)。local storage の `mkdir` が `EPERM` になる(`core/src/storage/local.ts:80`・`:107`、`core/src/astro/routes/api/media.ts:285`)。`NO_STORAGE` にはならない(仕様書 2.3 の未確認の項目) | 実測+公式ドキュメント |
| CPU 時間・起動時間 | 測っていない。ローカルの CPU プロファイルはローカルの D1 の処理が大半で使えず、root span の `cpu_time_ms` も 0 だった。起動時間は `wrangler deploy` の `startup_time_ms` で測る | 実測のみ |

### デプロイして測る(任意・利用者の了承待ち)

T32 では行っていない(`wrangler login` をせず、Cloudflare のアカウントと API に接続しない、という指示のため)。利用者が了承したら、次の手順で測る案。

了承してほしいこと:

- 利用者の Cloudflare アカウント(Workers Free)に、Worker 1 つ(`base64-image-playground`)と、D1・KV を 1 つずつ作る。`https://base64-image-playground.<アカウントのサブドメイン>.workers.dev` で誰でも開ける状態になるので、測り終えたら消す。
- 使う量は Free の範囲に収まる見込み(書き込みは、アップロード 1 回 93 行・投稿の保存 1 回 40〜50 行。1 日 10 万行に対して数千行。推測のみ)。

手順(案):

1. 利用者が `npx wrangler login` でログインする(ブラウザの OAuth)。
2. 測定のあいだだけ、`playground/wrangler.jsonc` に `"observability": { "enabled": true }` を足す(Workers Logs の呼び出しのログに CPU 時間と wall time が出る。https://developers.cloudflare.com/changelog/post/2025-04-09-workers-timing/)。コミットしない。
3. ビルドしてデプロイする。

   ```sh
   npm run build:cloudflare -w playground
   cd playground && npx wrangler deploy
   ```

   - ID の無い D1・KV は、デプロイのときに wrangler が作る(wrangler 4.45 以降の自動の作成。open beta。https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/)。作った ID が設定ファイルに書き戻されることがあるので、コミットしない。手で作るなら `npx wrangler d1 create base64-image-playground`。
   - Astro のアダプターは `IMAGES`(Cloudflare Images)のバインディングも足すが、playground のページは使わない(推測のみ)。
   - 出力の `Total Upload`(圧縮前の大きさ。上限 64 MiB)と `startup_time_ms`(起動時間。上限 1 秒)を記録する(https://developers.cloudflare.com/workers/platform/limits/#worker-startup-time)。
4. `https://…workers.dev/_emdash/admin` を開き、セットアップの画面でパスキーの管理者を作る(開発用ログインは使えない)。
5. 管理画面の「設定 → API トークン」(`/_emdash/admin/settings/api-tokens`)で、`admin` スコープのトークンを作る。
6. データを作る: `node playground/scripts/create-sample-posts.ts --base https://…workers.dev --token <トークン> --posts 11 --gallery 10 --trash-cover`
7. 測る。

   | 項目 | 方法 | 目安 |
   |---|---|---|
   | CPU 時間: アップロード 1 回(約 20KB と約 75KB の WebP) | Workers Logs(ダッシュボードの Observability。Query Builder で CPU time の中央値と最大) | 10ms 以内(Free) |
   | CPU 時間: `preview` 10 件 × 500,000 バイト | 同上。`maxStoredBytes: 500000` のフィールドを測定用に足し、上限いっぱいの画像を 10 枚アップロードしてから送る | 10ms 以内 |
   | CPU 時間: 投稿の保存・画像管理の一覧(最も重いページ)・`/posts/` | 同上 | 10ms 以内 |
   | CPU の上限を超えた呼び出し | Workers Logs の outcome が `exceededCpu` のもの | 0 件 |
   | クエリ数 | 応答の `Server-Timing` の `db.count`(本番のビルドでも出る) | ローカルと同じ(アップロード 71 など) |
   | D1 の行 | D1 のダッシュボードの Metrics(Row Metrics)、またはトレース(`observability.traces`)の D1 の span | ローカルと同じ(読み 761・書き 93) |
   | 同時の書き込み | 同じ画像を参照する投稿 8 件の同時作成を数回(`spikes/t32/measure-cas.mjs` と同じ手順) | 参照元が消えない。書き直しの回数を記録する |

8. 片付け: `npx wrangler delete`(Worker)、`npx wrangler d1 delete base64-image-playground`、KV の削除(`npx wrangler kv namespace list` で ID を確かめて `npx wrangler kv namespace delete`)、設定ファイルの差分を戻す。必要なら `npx wrangler logout`。

### 仕様書・ほかのタスクへの影響

- 仕様書(Cloudflare に関する箇所だけ): 2.2 に Workers の大きさ(圧縮前 64 MiB)と起動時間(1 秒)の行を足した。2.3 の注記の「実際のエラーの形は T32 で確かめる」を結果(500 `UPLOAD_ERROR`)に置き換えた。15 章に Cloudflare 用の設定と `--token` を足し、本番での測定が未実施であることを書いた。18 章の「D1 の 1 日の上限」と「参照元の記録の同時書き込み」の行を、ローカルの D1 の実測に置き換えた。
- [[T31-e2e|T31]]: スクリプトの `--token` で、開発用ログインが 403 になるビルドしたサイトでもサンプルの投稿を作れる(`wrangler dev` と、Node の `npm run preview` で確かめた。トークンは開発サーバーの `dev-bypass?token=1` で作る。実測のみ)。E2E を wrangler dev で動かす場合は、413 のあとの大きい body の失敗([[wrangler-dev-local-measurement#5.1 body を読まずに返した応答の直後のリクエストが失敗する]])に注意する。
- [[T33-readme|T33]]: 利用者向けの README には、Workers で `storage` を省略すると標準のメディアのアップロードが 500 `UPLOAD_ERROR` になること(`NO_STORAGE` ではない)を書ける。Workers の大きさの上限は 2026-09-04 から圧縮前 64 MiB になった。
- [[T34-release|T34]]: workerd + D1 で妨げになるものは見つからなかった。本番での CPU 時間・起動時間は未確認(上の手順の案)。

### 未解決・サブタスクの候補

- **デプロイしての測定**(利用者の了承待ち): CPU 時間(10ms)、起動時間(1 秒)、本番の D1 での書き直しの起きやすさ、本番の D1 の行の数え方がローカルと同じか、サブリクエストの上限(1 呼び出し 1,000)の確認。
- `playground/src/worker.ts` は `npm run typecheck` の対象外(Workers の型が要る)。一時的な tsconfig(`types: ["@cloudflare/workers-types"]`)では通った。`npm run typecheck` に入れるなら、tsconfig と `package.json` の変更が要る(T32 の変更してよいファイルの外なので、変えていない)。
- 既存の知見ノートの更新(T32 の変更してよいファイルの外なので、変えていない): [[cloudflare-workers-free-d1-limits]] の「確かめられていないこと」と、[[emdash-after-save-payload]] の「応答後の hook のクエリも、同じ呼び出しのクエリ数に入る見込み(実測は T32)」は、[[workerd-d1-plugin-behavior]] の結果で更新できる。
- wrangler は、`send_metrics: false` でも利用者のグローバルの設定ディレクトリ(`~/Library/Preferences/.wrangler/`)にログ(T32 の実行で 12 個)を書き、`metrics.json` の `bannerLastShown` を書き換える。消していない。
- EmDash 側の動き(プラグインでは直せない): 書き込みのたびに `sqlite_master` を全件読む(アップロード 1 回で 632 行)。匿名の HTML のリクエストのレイアウトの先読み(+5 クエリ)。どちらも D1 の読んだ行と呼び出しの数を増やす。
- `.gitignore` に足すものは無い(`playground/.wrangler/` はルートの `.gitignore` の `.wrangler/` で除外されている)。
