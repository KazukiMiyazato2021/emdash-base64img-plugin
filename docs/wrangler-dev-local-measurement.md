---
title: wrangler dev(ローカルの D1)で playground を動かし、測る方法と注意点
aliases:
  - wrangler dev のログイン
  - Local Explorer の observability
  - D1 のローカルの状態
  - ProxyWorker の Network connection lost
tags:
  - docs
  - cloudflare
  - wrangler
  - d1
  - testing
source_task: "[[T32-cloudflare-check]]"
created: 2026-09-24
updated: 2026-09-24
---

# wrangler dev(ローカルの D1)で playground を動かし、測る方法と注意点

> [!summary] 要点
> - playground の Cloudflare 用の設定は `wrangler.jsonc`・`astro.config.cloudflare.mjs`・`src/worker.ts`。Astro のビルドが `dist/server/wrangler.json` を書き、`.wrangler/deploy/config.json` が wrangler をそこへ向ける。`wrangler dev` はビルドした `dist/` を動かす(本番のビルド)。根拠: 実測のみ
> - D1 と KV(セッション)のローカルの状態は `playground/.wrangler/state/v3`。Cloudflare アダプターの開発サーバーと `wrangler dev` が同じものを使う(`database_id` を書かないので、D1 の ID はバインディング名の `DB`)。ルートの `.gitignore` の `.wrangler/` で git の管理外。根拠: 実測のみ
> - `wrangler dev` では開発用ログインが 403。開発サーバーで開発用ログイン(`?token=1` で API トークンも)をしておけば、同じ状態を読む `wrangler dev` でも、その Cookie とトークンが使える。サンプルの投稿のスクリプトは `--token` で動く。根拠: 実測+公式ドキュメント
> - wrangler 4.135 の Local Explorer(`/cdn-cgi/local/explorer/api`)で、リクエストごとの D1 の呼び出し(SQL・読んだ行・書いた行・エラー)を SQL で引ける。ローカルの D1 に SQL を送ることもできる。根拠: 実測のみ
> - wrangler dev だけの不具合: body を読まずに返した応答(413・403)の直後に大きい body を送ると、約半分の割合で `Network connection lost` の 500 になる(ProxyWorker)。Cloudflare アダプターの開発サーバーでは起きない。根拠: 実測のみ
> - `send_metrics: false` で利用状況は送られないが、wrangler は利用者のグローバルの設定ディレクトリにログを書き、`metrics.json` の `bannerLastShown` を書き換える。根拠: 実測+公式ドキュメント(wrangler のソース)
> - 関連: [[workerd-d1-plugin-behavior]](結果)、[[T32-cloudflare-check]]、[[playground/README|playground の README]]、[[astro-dev-background-for-agents]]、[[git-dependency-ts-source]]

> [!info] 環境
> macOS 26.4(arm64)、Node 26.10.0、wrangler 4.135.0(workerd 1.20260918.1)、`@astrojs/cloudflare` 14.3.2、Astro 7.3.3、EmDash 0.39.1。2026-09-24 に確認した。版の一覧は [[workerd-d1-plugin-behavior#1. 環境と測り方]]。

## 1. 設定とファイル

| ファイル | 役目 |
|---|---|
| `playground/wrangler.jsonc` | wrangler の設定。D1(`DB`)だけ。R2 と cron は無い。`compatibility_date` と `nodejs_compat` は EmDash のテンプレート(`templates/starter-cloudflare`)と同じ。`send_metrics: false` |
| `playground/astro.config.cloudflare.mjs` | Node 用の `astro.config.mjs` と同じサイトを、`@astrojs/cloudflare` と `d1({ binding: "DB", session: "auto" })` で動かす。`storage` は指定しない |
| `playground/src/worker.ts` | Worker の入口。テンプレートと同じく、`@emdash-cms/cloudflare/worker` の handler に `scheduled` を足し、`PluginBridge` を export する |
| `playground/package.json` | `dev:cloudflare`(`astro dev --config astro.config.cloudflare.mjs`)、`build:cloudflare`、`preview:cloudflare`(`wrangler dev`) |

- ビルドすると、Astro のアダプターが `dist/server/wrangler.json`(`main: entry.mjs`、`no_bundle: true`、バインディングの `SESSION`(KV)・`DB`(D1)・`IMAGES`・`ASSETS`)と、`.wrangler/deploy/config.json`(`{"configPath":"../../dist/server/wrangler.json", …}`)を書く。`wrangler dev` は「Using redirected Wrangler configuration」と出して、ビルドの出力を動かす。根拠: 実測のみ
- ビルドの出力は Node 用と同じ `playground/dist/`。`npm run verify`(Node のビルド)のあとは、`build:cloudflare` でビルドし直してから `wrangler dev` を動かす。
- `astro.config.cloudflare.mjs` の `cloudflare({ inspectorPort: false })` は、開発サーバーの workerd のデバッガーのポートを開かないため(既定では 9229 から空いているものを開く)。`wrangler dev` のデバッガーのポートは `--inspector-port` で決める。
- `src/worker.ts` の `ExportedHandler` は Workers の型で、`npm run typecheck` の対象外(`tsconfig.json` の `include` に `playground/src` が無い)。`@cloudflare/workers-types` を `types` に入れた一時的な tsconfig で型が通ることは確かめた。根拠: 実測のみ

## 2. ローカルの状態(D1・KV)

- 開発サーバー(Cloudflare の Vite プラグイン)も `wrangler dev` も、`playground/.wrangler/state/v3` に書く。`wrangler dev` は、`--persist-to` が無ければ元の設定ファイルのディレクトリの `.wrangler/state` を使い(`node_modules/wrangler/wrangler-dist/cli.js` の `getLocalPersistencePath`)、`dist/server/wrangler.json` の `userConfigPath` は `playground/wrangler.jsonc` になっている。`--persist-to` は実行したディレクトリからの相対パス。根拠: 実測+公式ドキュメント(wrangler のソース)
- `database_id` を書かないので、ローカルの D1 の ID はバインディング名になる(Local Explorer の `GET /d1/database` が `{"name":"DB","uuid":"DB"}`)。セッションの KV(`SESSION`)も同じ状態の中にあるので、開発サーバーで作ったセッションと API トークンが、`wrangler dev` でも使える。根拠: 実測のみ
- 消し方: サーバーを止めてから `rm -rf playground/.wrangler/state`。次に開発サーバーで開発用ログインをすると、マイグレーション・seed・管理者の作成がやり直される。
- 状態を分けるとき: 開発サーバーはアダプターの `persistState: { path: ".wrangler/state-i18n" }`、`wrangler dev` は `--persist-to .wrangler/state-i18n`。どちらもその下の `v3` を使う(T32 の i18n の確認で使った)。根拠: 実測のみ
- `.wrangler/` はルートの `.gitignore`(14 行目)で除外されている。`git check-ignore -v` で、`playground/.wrangler/state/v3/d1` と `playground/.wrangler/deploy/config.json` が除外されることを確かめた。根拠: 実測のみ

## 3. ログインと API トークン

- `wrangler dev` の開発用ログインは 403 `{"code":"FORBIDDEN","message":"Dev bypass is only available in development mode"}`。本番のビルドでは `import.meta.env.DEV` が偽になるため(`core/src/astro/routes/api/setup/dev-bypass.ts:46-49`)。根拠: 実測+公式ドキュメント
- 手順: Cloudflare アダプターの開発サーバーで開発用ログインをしてから止め、ビルドして `wrangler dev` を動かす。開発サーバーで作ったものは、同じローカルの状態から読まれる。
  - `GET /_emdash/api/setup/dev-bypass?token=1` は、セッションの Cookie(`astro-session`)に加えて、応答の `data.token` に API トークン(`ec_pat_…`)を返す。スコープは `content:*`・`media:*`・`schema:*`・`admin`(`dev-bypass.ts:146-169`)。同じ名前(`dev-bypass-token`)の古いトークンは消される。根拠: 実測+公式ドキュメント
  - その Cookie を付けると、`wrangler dev`(`http://localhost:8732`)でも `GET /_emdash/api/auth/me` が 200(無いと 401)、管理画面も 200 だった。Cookie はポートで分けられない(RFC 6265 の 8.5)ので、ブラウザで `http://localhost:4432` にログインしたあと、同じブラウザで `http://localhost:8732` を開けばログインしたままになるとみられる(ブラウザの操作では確かめていない)。`localhost` と `127.0.0.1` は別のホストなので、どちらかにそろえる。根拠: 実測のみ(Cookie)、外部ドキュメントのみ(ポート)、推測のみ(ブラウザの操作)
  - API トークンは `Authorization: Bearer <トークン>` で送る。プラグインのルートには `admin` スコープが要り、`X-EmDash-Request` は要らない([[emdash-plugin-route-permissions]])。トークンの確認と `last_used_at` の更新で、リクエストごとに 2 クエリ(書き 1 行)増える。根拠: 実測のみ
- 本番(デプロイした Worker)では開発用ログインが使えないので、管理画面の「設定 → API トークン」(`/_emdash/admin/settings/api-tokens`。`packages/admin/src/router.tsx:2222`)でトークンを作る。
- サンプルの投稿のスクリプトは、`--token <トークン>` か環境変数 `EMDASH_TOKEN` で API トークンを使う(無ければ今までどおり開発用ログイン)。環境変数の名前は EmDash の CLI と同じ(`node_modules/emdash/dist/cli/index.mjs:302-314`)。`--token` を渡すと、`wrangler dev` でも Node の `npm run preview` でも、投稿 2 件の作成と `--trash-cover` が通った。渡さないと、開発用ログインの 403 と、`--token` を使うよう促すメッセージで止まる。根拠: 実測のみ
- `d1({ session: "auto" })` のサイトでは、EmDash が D1 の Sessions API のブックマークを Cookie `__em_d1_bookmark` に入れる(開発用ログインの応答で確認)。根拠: 実測のみ

## 4. Local Explorer で D1 の呼び出しを数える

wrangler 4.135 の `wrangler dev` は、エージェントから動かすと「Wrangler detected this dev session is running in an AI agent.」と出し、Local Explorer の API を案内する。根拠: 実測のみ

| API | 内容 |
|---|---|
| `POST /cdn-cgi/local/explorer/api/local/observability/query` | 読み取りだけの SQL(`SELECT` / `WITH`)で、記録された trace(`spans`)と console のログ(`logs`)を引く。属性は `json(attributes)` で読む |
| `POST /cdn-cgi/local/explorer/api/local/observability/clear` | 記録を消す |
| `GET /cdn-cgi/local/explorer/api/d1/database` | ローカルの D1 の一覧 |
| `POST /cdn-cgi/local/explorer/api/d1/database/DB/raw` | ローカルの D1 に SQL を送る(`{"sql":"…"}`。結果は `result[0].results.columns` / `rows` と `meta`) |

- `spans` には `trace_id` / `span_id` / `parent_id` / `service` / `name` / `start_ms` / `duration_ms` / `error` / `outcome` / `attributes` などの列がある。リクエストの root の span(`parent_id IS NULL`)の属性に `url.full` がある。D1 の span は `d1_all`・`d1_batch` などで、属性に `db.query.text`・`cloudflare.d1.response.rows_read`・`rows_written`・`changes`・`size_after` がある。失敗したクエリは `error.type` にメッセージが入る。根拠: 実測+公式ドキュメント(属性の名前は https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/ と同じ)
- root の span の `cpu_time_ms` はローカルでは 0 だった。CPU 時間は測れない。
- リクエストの URL に目印のクエリ(`?_t32=<ID>`)を付けて送り、その trace の D1 の span を集めた。

```js
// spikes/t32/lib.mjs(抜粋)。目印の付いたリクエストの trace から、D1 の呼び出しと行の数を集める
async function obs(base, sql) {
	const res = await fetch(new URL("/cdn-cgi/local/explorer/api/local/observability/query", base), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ sql }),
	});
	const { result } = await res.json();
	return result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c, row[i]])));
}

export async function traceSummary(base, marker) {
	await new Promise((r) => setTimeout(r, 400)); // after() の hook が終わるのを待つ
	const [root] = await obs(base, `SELECT trace_id FROM spans WHERE parent_id IS NULL
		AND json_extract(attributes, '$."url.full"') LIKE '%_t32=${marker}%'`);
	const spans = await obs(base, `SELECT name, error, json(attributes) AS a FROM spans
		WHERE trace_id = '${root.trace_id}' AND name LIKE 'd1_%' ORDER BY start_ms`);
	let rowsRead = 0;
	let rowsWritten = 0;
	for (const s of spans) {
		const a = JSON.parse(s.a);
		rowsRead += a["cloudflare.d1.response.rows_read"] ?? 0;
		rowsWritten += a["cloudflare.d1.response.rows_written"] ?? 0;
	}
	return { d1Calls: spans.length, rowsRead, rowsWritten };
}
```

### `db.count` と D1 の呼び出しの関係

- `Server-Timing` の `db.count` は、本番のビルド(`wrangler dev`)でも出る。根拠: 実測のみ
- ふつうのリクエストでは、`db.count` と D1 の呼び出しの数が一致した(アップロードで 71 と 71)。根拠: 実測のみ
- 一致しないのは次のとき。根拠: 実測のみ
  - afterSave・afterPublish の hook のクエリ: 応答のあと(`waitUntil`)に走り、同じ trace には入るが `db.count` には入らない。
  - 失敗したクエリ(消されたコレクションの `SELECT` など): span はあるが `db.count` には入らない。
  - 起動して最初のリクエスト: EmDash の初期化のクエリが `d1_batch` 1 回にまとまる。

## 5. wrangler dev の注意

### 5.1 body を読まずに返した応答の直後のリクエストが失敗する

- プラグインのルートに上限を超える body(600,001 バイト)を送ると、ルートは body を読み切らずに 413 を返す。その直後に、上限内の大きい body(600,000 バイト)を送ると、wrangler dev は約半分の割合で 500(JSON でない本文)を返し、ログに次が出る。根拠: 実測のみ

```text
✘ [ERROR] Error inside ProxyWorker (the affected request failed; the dev server continues): POST http://127.0.0.1:8732/_emdash/api/plugins/base64-image/upload?… (failed after 1 attempt): Network connection lost.
```

| 送り方 | 413 のあとの 600,000 バイト | 対照(600,000 → 600,000) |
|---|---|---|
| Node の `fetch`(15 回) | 400 が 7 回、500 が 8 回 | 400 が 15 回 |
| `curl`(10 回。毎回つなぎ直す) | 400 と 500 が交互に 5 回ずつ | — |
| Cloudflare アダプターの開発サーバー(`astro dev`、15 回) | 400 が 15 回 | 400 が 15 回 |

- 413 のあとの小さい body(スキーマ違反の短い JSON)は、3 回続けて 400 で、失敗しなかった。セッションの Cookie で `X-EmDash-Request` を付けずに正しい body(約 31KB)を送った 403(CSRF。body は読まれない)の直後の、600,001 バイトのリクエストも 1 回同じ失敗になった。読まれなかった body のあとに大きい body を送ると起きるとみられる。根拠: 実測のみ(条件の見立ては推測のみ)
- 起きるのは wrangler dev の ProxyWorker(ローカルの中継)で、プラグインの応答は正しい(413・403 は正しく返っている)。本番の Workers で起きるかは確かめていない(起きないとみられる。推測のみ)。
- E2E などで、wrangler dev で 413 を確かめたあとに大きい body を送るときは、失敗しうることに注意する。413 の確かめは開発サーバーで行うか、あいだに小さいリクエストを挟む。

### 5.2 デバッガー(インスペクター)

- `--inspector-port 9332` の `http://127.0.0.1:9332/json` に Worker が 1 つ出て、`ws://127.0.0.1:9332/ws` につなげる。WebSocket は `Origin` ヘッダーが要る(`localhost`・`127.0.0.1` など。無いと 400「Expected `Origin` header」。`node_modules/wrangler/wrangler-dist/InspectorProxyWorker.js:368-396`)。Node の `WebSocket` では `{ headers: { Origin: "http://localhost" } }` を渡した。根拠: 実測+公式ドキュメント(wrangler のソース)
- CPU プロファイル(`Profiler.start` / `stop`)は取れるが、アップロードでは大半がローカルの D1 の処理(Kysely の `provideConnection`)で、Workers の CPU 時間の見積もりには使えなかった([[workerd-d1-plugin-behavior#10. Worker の大きさ・起動時間・CPU 時間]])。サンプリングの間隔を 100µs にすると、`Profiler.stop` の応答のあとで WebSocket が閉じた(1005。プロファイルが大きすぎたためとみられる)。1ms にすると取れた。根拠: 実測のみ(原因は推測のみ)

### 5.3 利用状況の送信と、利用者の設定ディレクトリへの書き込み

- 送信の判定は、環境変数 `WRANGLER_SEND_METRICS`、設定の `send_metrics`、利用者のグローバルの `metrics.json` の順(`node_modules/wrangler/wrangler-dist/cli.js` の `getMetricsConfig`)。`wrangler.jsonc` の `send_metrics: false` と環境変数 `WRANGLER_SEND_METRICS=false` の両方を使い、`--log-level debug` で「Metrics dispatcher: Dispatching disabled - would have sent …」と出ることを確かめた。根拠: 実測+公式ドキュメント(wrangler のソース)
- それでも「Cloudflare collects anonymous telemetry …」の案内は出る。案内は、利用者のグローバルの `metrics.json`(macOS は `~/Library/Preferences/.wrangler/metrics.json`)で送信が許されていて、`bannerLastShown` が今の版と違うときに出て、そのあと `bannerLastShown` を書き換える(`printMetricsBanner`)。根拠: 実測+公式ドキュメント(wrangler のソース)
- wrangler は、実行のたびに `~/Library/Preferences/.wrangler/logs/wrangler-<日時>.log` にログを書く。T32 の実行で 12 個できた。根拠: 実測のみ
- どちらも利用者のホームの下のファイルで、リポジトリには入らない。

### 5.4 サーバーの起動と停止

- `npm run dev:cloudflare -w playground -- --port 4432` は、Node 用と同じく、エージェントから実行すると Astro がバックグラウンドで起動する。止めるのは `npm run dev:cloudflare -w playground -- stop`([[astro-dev-background-for-agents]])。根拠: 実測のみ
- `npm run preview:cloudflare -w playground -- …`(`wrangler dev`)は前面で動き続ける。エージェントからは、バックグラウンドのタスクとして起動し、終わったらタスクを止める。`--show-interactive-dev-session=false` でキー操作の案内を消せる。止めたあと `lsof -nP -iTCP:<ポート> -sTCP:LISTEN` で何も出ないことを確かめる。
- 開発サーバーの起動では、ログに「Re-optimizing dependencies because vite config has changed」が 2 回出るが、最初のリクエストでの再読み込み([[git-dependency-ts-source#Cloudflare アダプターの astro dev の再最適化]])は起きなかった。playground ではプラグインが `node_modules/emdash-plugin-base64-image -> ..` のリンクで、Vite の依存の最適化(`playground/node_modules/.vite/deps_ssr/_metadata.json`)に入っていなかった。そのためとみられる。git 依存で入れる利用者のサイトでは起きる(T07 の実測)。根拠: 実測のみ(理由は推測のみ)

## 6. 手順のまとめ

```sh
# 1. 開発サーバーで、D1 の準備・ログイン・API トークンを作る
WRANGLER_SEND_METRICS=false npm run dev:cloudflare -w playground -- --port 4432
curl -s -c cookies.txt "http://localhost:4432/_emdash/api/setup/dev-bypass?token=1" > devbypass.json
npm run dev:cloudflare -w playground -- stop

# 2. ビルドして wrangler dev で動かす(前面で動く。止めるのは Ctrl+C)
npm run build:cloudflare -w playground
WRANGLER_SEND_METRICS=false npm run preview:cloudflare -w playground -- --port 8732 --inspector-port 9332 --ip 127.0.0.1 --show-interactive-dev-session=false

# 3. サンプルの投稿(トークンは devbypass.json の data.token)
node playground/scripts/create-sample-posts.ts --base http://localhost:8732 --token <トークン>

# 4. 記録された trace を見る(wrangler が案内する例。D1 の span の集め方は 4 章のコード)
curl -s -X POST http://127.0.0.1:8732/cdn-cgi/local/explorer/api/local/observability/query \
  -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT service, name, outcome, duration_ms FROM spans WHERE parent_id IS NULL LIMIT 20"}'
```
