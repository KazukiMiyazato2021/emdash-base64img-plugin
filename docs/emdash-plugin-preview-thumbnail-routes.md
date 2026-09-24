---
title: 管理画面のプレビュー・サムネイル取得ルートのクエリ数・応答の大きさ・CPU 時間(EmDash 0.39.1)
aliases:
  - プレビュー取得のクエリ数
  - PREVIEW_MAX_IDS の根拠
  - imageRefs の getMany とバインド変数
  - サムネイル取得のクエリ数
tags:
  - docs
  - emdash
  - plugin
  - route
  - d1
  - performance
source_task: "[[T17-admin-data-routes]]"
created: 2026-09-24
updated: 2026-09-24
---

# 管理画面のプレビュー・サムネイル取得ルートのクエリ数・応答の大きさ・CPU 時間(EmDash 0.39.1)

> [!summary] 要点
> - `preview`(1 回 10 件まで)は、ID ごとに `ctx.content.get("b64_images", id)` を並行に呼ぶ。クエリ数は **1(ルートの固定費)+ 見つかった画像 × 2 + 見つからない画像 × 1**。10 件で 21。
> - `thumbnails`(1 回 100 件まで)は、`imageRefs.getMany` を 50 件ずつ呼ぶ。クエリ数は **1 + ceil(件数 / 50)**。100 件で 3。
> - `getMany` は ID を分けずに IN 句に入れ、バインド変数を「ID の数 + 2」個使う。D1 の上限(1 クエリ 100 個)を node:sqlite で模擬すると、98 件は通り、99 件から `too many SQL variables` の**例外**になった(`getEmDashCollection` のように黙って空にはならない)。
> - 応答の大きさ: `preview` は 1 件ごとに data URL の長さ + 約 180 バイト。10 件で最大 5,001,795 バイト(固定上限 500,000 の画像)、既定の予算(100,000)で 1,001,785 バイト。`thumbnails` は 100 件で最大 808,835 バイト。
> - JS の処理だけの時間(Node 26、Apple M5 Pro、zod は jitless): `preview` 10 件 × 500,000 で 3.5ms(新しいプロセスの 1 回目は 5.6ms)、20 件 × 500,000 で 7.0ms(1 回目 10.5ms)。Workers Free の CPU 時間は 10ms で、20 件は 1 回目で超える。**`PREVIEW_MAX_IDS` は 10 のままにした**([[#preview の件数(PREVIEW_MAX_IDS)]])。
> - 権限はどちらも `content:read`。未ログインは 401、Subscriber 以上は 200。
> - body の上限は「ID の最大数 × 最大の長さ(128 文字)の JSON + 1 KiB」。`preview` 2,343、`thumbnails` 14,133 バイトで、1 バイト超えると 413 `INVALID_PLUGIN_REQUEST`。
> - 関連: [[T17-admin-data-routes]]、[[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11.2]]、[[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)|仕様書 11.4]]、[[emdash-plugin-content-query-counts]]、[[emdash-plugin-route-body-limit]]、[[emdash-plugin-route-permissions]]、[[emdash-query-count-b64-images]]、[[cloudflare-workers-free-d1-limits]]、[[emdash-admin-api-requests]]

> [!info] 計測の方法と環境
> - playground を複製した使い捨てのサイト(`spikes/admin-data/site/`、git 管理外)に、T17 のルートを本物と同じプラグイン ID(`base64-image`)で登録した。画像は補助のルートで作った([[#再現手順]])。
> - クエリ数は応答の `Server-Timing` の `db.count` で読んだ(暖機のあと 7 回、すべて同じ値)。SQL とパラメータは `EMDASH_QUERY_LOG=1` のログ(`.astro/dev.log`)で確かめた。
> - macOS 26.4(Darwin 25.4.0、arm64、Apple M5 Pro)、Node 26.10.0(SQLite 3.53.4)、emdash 0.39.1、Astro 7.3.3(`astro dev`、ポート 4417)、`@astrojs/node` 11.1.6、Kysely 0.29.6、zod 4.5.4、esbuild 0.28.2。2026-09-24 に計測。
> - Cloudflare Workers(workerd + D1)では測っていない。[[T32-cloudflare-check|T32]] で確かめられる。

## ルートの形と登録の仕方

`src/server/routes/admin-data.ts` の export。宣言は [[emdash-plugin-route-body-limit#アップロードのルートの宣言(T18 向けの雛形)|T08 の雛形]] に合わせた。

| export | 中身 |
|---|---|
| `previewRoute` | `PluginRoute<PreviewRequest>`。`permission: "content:read"`、`methods: ["POST"]`、`request: { body: "json", maxBytes: PREVIEW_MAX_BODY_BYTES }`、`input: previewRequestSchema`、`handler: handlePreview` |
| `thumbnailsRoute` | `PluginRoute<ThumbnailsRequest>`。同じ形で、`maxBytes: THUMBNAILS_MAX_BODY_BYTES`、`input: thumbnailsRequestSchema`、`handler: handleThumbnails` |
| `handlePreview` / `handleThumbnails` | ハンドラー。ctx は使う部分だけの型(`PreviewRouteContext` / `ThumbnailsRouteContext`)。EmDash の `RouteContext<…>` はこの型に代入できる(型のテストで確かめた) |
| `PREVIEW_MAX_BODY_BYTES` / `THUMBNAILS_MAX_BODY_BYTES` | 2,343 / 14,133 |
| `IMAGE_REFS_BATCH_SIZE` | 50(`getMany` 1 回の ID の数) |

[[T29-plugin-definition|T29]] は次のように登録する。spike で同じ形の `definePlugin` を動かして確かめた。根拠: **実測+公式ドキュメント**

```ts
import { definePlugin } from "emdash";

import { previewRoute, thumbnailsRoute } from "./server/routes/admin-data";
import { IMAGE_REFS_STORAGE, PLUGIN_ID, ROUTES } from "./shared/constants";

definePlugin({
	id: PLUGIN_ID,
	// preview は ctx.content.get を使う。content:read が無いと ctx.content が無く、500 INTERNAL_ERROR になる
	capabilities: ["content:read" /* , アップロードなどが使うもの */],
	// thumbnails は ctx.storage.imageRefs を使う。宣言が無いと 500 INTERNAL_ERROR になる
	storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } },
	routes: {
		[ROUTES.preview]: previewRoute, // POST /_emdash/api/plugins/base64-image/preview
		[ROUTES.thumbnails]: thumbnailsRoute, // POST /_emdash/api/plugins/base64-image/thumbnails
	},
});
```

- どちらのルートも `content:restore` は使わない。

## クエリ数

根拠: **実測+公式ドキュメント**(`references/emdash/packages/core/src/plugins/content-access.ts:25-51`、`core/src/database/repositories/plugin-storage.ts:271-288`)

| 要求 | db.count | 内訳 |
|---|---|---|
| `preview` 1 件(見つかる) | 3 | 固定費 1 + `get` 2(行 / `has_seo`) |
| `preview` 10 件(見つかる) | 21 | 1 + 10 × 2 |
| `preview` 10 件(どれも無い) | 11 | 1 + 10 × 1(行だけ) |
| `preview` 10 件(見つかる 4・ゴミ箱 2・無い 2・公開していない 2) | 17 | 1 + 4 × 2 + 2 × 1 + 2 × 1 + 2 × 2。公開していない画像は `get` で見つかる(2 クエリ)が、`null` で返す |
| (比較用)上限なしで 20 件 / 40 件 | 41 / 81 | 1 + 件数 × 2 |
| `thumbnails` 1 件 / 40 件 / 50 件 | 2 / 2 / 2 | 固定費 1 + `getMany` 1 |
| `thumbnails` 51 件 / 100 件 / 100 件(どれも無い) | 3 / 3 / 3 | 1 + `getMany` 2(50 件ずつ) |

- `get` の SQL は `SELECT * FROM "ec_b64_images" WHERE id = ? AND deleted_at IS NULL`(ロケールで絞らない)。見つかると `has_seo` を読み、`b64_images`(SEO なし)ではそこで終わる。
- `getMany` の SQL は `select "id", "data" from "_plugin_storage" where "plugin_id" = ? and "collection" = ? and "id" in (?, …)`。50 件のときのパラメータは 52 個だった(ログで数えた)。
- ルートの固定費 1 は、セッションの利用者の行([[emdash-plugin-content-query-counts]])。
- 上限は 1 呼び出し 1,000 クエリ([[cloudflare-workers-free-d1-limits]])で、どちらのルートも十分小さい。以前の前提(50)でも収まる。

## 応答の大きさ

根拠: **実測のみ**(開発サーバーの応答の body のバイト数)

| 要求 | バイト数 |
|---|---|
| `preview` 1 件 × 100,000 | 100,210 |
| `preview` 10 件 × 100,000(既定の予算) | 1,001,785 |
| `preview` 10 件 × 500,000(固定上限) | 5,001,795 |
| (比較用)20 件 × 100,000 / 20 件 × 500,000 | 2,003,545 / 10,003,565 |
| `preview` 10 件(どれも無い) | 525 |
| `thumbnails` 100 件(サムネイル 4,000 × 20 + 8,000 × 80) | 728,795 |
| `thumbnails` 100 件 × 8,000(上限。ベンチマークで作った応答) | 808,835 |
| `thumbnails` 100 件(どれも無い) | 5,335 |

- JSON の応答には上限が無い([[emdash-plugin-route-body-limit#応答の大きさ]])。大きさで失敗することは無い。

## 時間

### 開発サーバーの中(SQLite の読み出しを含む)

比較用のルートでハンドラーを `performance.now()` で挟み、応答の包み(`{ success: true, data }`)の `JSON.stringify` を別に測った。15 回の中央値。根拠: **実測のみ**

| 件数 × data URL の長さ | ハンドラー(ms) | `JSON.stringify`(ms) | `db.total`(ms) | `Server-Timing` の `mw`(ms) |
|---|---|---|---|---|
| 10 × 100,000 | 1.13 | 0.07 | 0 | 2 |
| 20 × 100,000 | 2.14 | 0.13 | 1 | 3 |
| 10 × 500,000 | 3.52 | 0.34 | 1 | 6 |
| 20 × 500,000 | 7.64 | 1.05 | 2 | 10 |

### JS の処理だけ(Workers の CPU 時間に入る部分の見積もり)

`src/server/routes/admin-data.ts` を esbuild でまとめ、データベースを使わずに測った。1 件ごとに、行の値の `JSON.parse`(EmDash の `deserializeValue`)→ `handlePreview`(zod の検証)→ 応答の包みの `JSON.stringify` と UTF-8 への変換を行う。zod は `z.config({ jitless: true })`(Cloudflare では `new Function` を使わない経路。[[emdash-plugin-route-body-limit#CPU 時間(Node)]])。定常は 30 回の空回しのあと 200 回、1 回目は新しいプロセスで 7 回測った。根拠: **実測のみ**

| 件数 × data URL の長さ | 定常 中央値(ms) | 定常 p95(ms) | 新しいプロセスの 1 回目 中央値(ms) |
|---|---|---|---|
| 1 × 100,000 | 0.062 | 0.096 | 1.05 |
| 10 × 100,000 | 0.663 | 0.863 | 1.98 |
| 20 × 100,000 | 1.319 | 1.727 | 3.00 |
| 1 × 500,000 | 0.370 | 0.418 | 1.28 |
| 10 × 500,000 | 3.483 | 4.174 | 5.64 |
| 20 × 500,000 | 6.954 | 10.428 | 10.50 |
| `thumbnails` 100 × 8,000 | 0.563 | 0.633 | — |

- 時間は data URL の長さの合計にほぼ比例する(500,000 文字 1 件で約 0.35ms)。1 回目は zod の初期化などで約 1ms 増える。
- Workers では、これに D1 の結果の受け取り(行の文字列を Worker に移す処理)と EmDash の処理が加わる(推測のみ)。D1 を待つ時間は CPU 時間に入らない([[emdash-plugin-route-body-limit#CPU 時間(Node)]])。

## preview の件数(PREVIEW_MAX_IDS)

**10 のままにした。** 根拠: **実測のみ**(Node。Workers の値は推測のみ)

| 観点 | 10 件 | 20 件 | 判断 |
|---|---|---|---|
| クエリ数 | 21 | 41 | どちらも上限(1,000)より十分小さい。件数を決める理由にならない |
| 応答の大きさ(固定上限の画像) | 最大 5.0MB | 最大 10.0MB | 小さいほうがよい |
| JS の処理(固定上限の画像、定常 / 1 回目) | 3.5 / 5.6ms | 7.0 / 10.5ms | 20 件は Workers Free の 10ms を 1 回目で超える |
| JS の処理(既定の予算 100,000、定常 / 1 回目) | 0.7 / 2.0ms | 1.3 / 3.0ms | どちらも小さい |
| 待ち時間 | — | — | 画面([[T14-admin-i18n-api\|T14]] の `fetchPreviews`)は 10 件ずつ並行に送るので、20 枚でもほぼ 1 往復 |

- 件数を増やすと、1 回の呼び出しの CPU 時間と応答が画像の大きさに比例して増える。10 件なら、固定上限の画像ばかりでも 1 回目で約 5.6ms で、EmDash の処理と D1 の結果の受け取りの分の余裕が残る(推測のみ)。
- 画像の大きさは読むまで分からないので、件数ではなくバイト数で区切ることはしない。
- 仕様書 11.2 の「まとめて1回で取得する」は、「10 件ずつ分けて並行に送る」に直した([[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11.2]])。

## D1 のバインド変数と getMany

D1 は手元で動かせないので、[[emdash-query-count-b64-images#1 回の IN 句に入れられる ID の数(D1 の上限 100)|T09]] と同じく、node:sqlite の `database.limits.variableNumber` を 100 にした dialect をサイトの `database` に指定した。根拠: **実測+公式ドキュメント**(D1 そのものでは未実測。上限 100 は Cloudflare の文書)

| 呼び出し | バインド変数 | 結果 |
|---|---|---|
| `getMany` を分けずに 50 件 | 52 | 成功 |
| `getMany` を分けずに 98 件 | 100 | 成功 |
| `getMany` を分けずに 99 件 | 101 | **例外** `too many SQL variables` |
| `getMany` を分けずに 100 件 | 102 | **例外** |
| `thumbnails` ルート 100 件(50 件ずつ) | 52 × 2 | 成功(3 クエリ、100 件とも見つかる) |
| `preview` ルート 10 件 | 1 × 10 | 成功(21 クエリ) |

- EmDash の `getMany` は分割しない(`plugin-storage.ts:271-288`)。EmDash 自身の IN 句は `SQL_BATCH_SIZE = 50` で分けている(`core/src/utils/chunks.ts:16-17`)ので、同じ 50 にした。根拠: 公式ドキュメントのみ
- 失敗は例外で返る。分けずに 100 件を渡すと、`thumbnails` は 500 `INTERNAL_ERROR` になる(推測のみ。分けたので起きない)。

## 見つからない画像の表し方

T03 の `previewResponseSchema` / `thumbnailsResponseSchema` の形のまま(`image` / `thumbnail` が `null`)。同じ ID(ゴミ箱 2・下書き 2・公開の取り消し 1・無い 1・公開済み 1)を両方のルートに送って確かめた。根拠: **実測+公式ドキュメント**

| 画像の状態 | `preview` の `image` | `thumbnails` の `thumbnail` | ログ |
|---|---|---|---|
| 公開済み・値が正しい | 値 | サムネイル | — |
| ゴミ箱に入った | `null`(`get` が `null`) | **サムネイル**(`imageRefs` に残る) | — |
| 完全削除した・無い ID | `null` | `null`(`imageRefs` に無い) | — |
| 公開していない(下書き・公開の取り消し) | `null` | サムネイル | 警告 |
| 値が不正(形・`src` が WebP の data URL でない) | `null` | —(`imageRefs` の値が不正なら `null`) | 警告 |

- ゴミ箱と無い画像は区別しない。区別するには capability `content:restore` の `getTrashedVersioned` が要り([[emdash-plugin-content-api-constraints#ゴミ箱に入っているかの判定]])、widget の表示(「画像が見つかりません」)も変わらないため。
- 公開していない画像を `null` にするのは、サイトの取得(`getEmDashCollection`)が既定で `status = 'published'` の行だけを読むため(`core/src/loader.ts:1233`)。widget の表示とサイトの表示を揃える。
- 値は `base64ImageEntrySchema` と `src` の接頭辞(`data:image/webp;base64,`)で確かめる(サイト側の [[T15-site-resolve|T15]] と同じ)。seed や手での書き換えは保存 hook を通らないため([[emdash-plugin-content-api-constraints#seed のエントリ ID]])。
- `thumbnails` は `thumbnailSchema`(`thumb`・`width`・`height`)と `thumb` の接頭辞だけを確かめ、ほかの項目(`owners` など)は返さない。
- 取得の失敗(データベースのエラー)は `null` にせず、そのまま投げる(500 `INTERNAL_ERROR`)。`null` にすると、widget が「画像が見つかりません」と表示し、編集者が参照を外してしまうため。
- `get` はロケールで絞らない。単一ロケールのサイトで `locale: "ja"` で作った画像も、ID だけで見つかった。根拠: **実測+公式ドキュメント**
- `ctx.log.warn` の行には、EmDash が `[plugin:base64-image]` を付ける(例: `[plugin:base64-image] 3 image(s) in "b64_images" have an invalid value; returning null: …`)。メッセージにはプラグイン ID を書かない。根拠: **実測のみ**

## 権限・CSRF・メソッド

根拠: **実測+公式ドキュメント**([[emdash-plugin-route-permissions]] と同じ方法。開発用の管理者の `users.role` を書き換えた)

| 要求 | `preview` | `thumbnails` |
|---|---|---|
| 未ログイン | 401 `UNAUTHORIZED` | 401 `UNAUTHORIZED` |
| Subscriber(10)/ Contributor(20)/ Author(30)/ Editor(40)/ Admin(50) | 200 | 200 |
| Subscriber、`X-EmDash-Request` なし | 403 `CSRF_REJECTED` | 403 `CSRF_REJECTED` |
| Subscriber、GET | 405 `METHOD_NOT_ALLOWED` | 405 `METHOD_NOT_ALLOWED` |
| 件数が上限を超える(11 件 / 101 件)・0 件の `ids` | 400 `VALIDATION_ERROR` | 400 `VALIDATION_ERROR` |

## body の上限

根拠: **実測+公式ドキュメント**(`core/src/plugins/route-wire.ts:177-203`)

- 上限は、ID の最大数だけ最大の長さ(`entryIdSchema` の 128 文字)の ID を並べた空白なしの JSON(画面の `JSON.stringify` と同じ形)に、空白や改行のための 1 KiB を足した値。`preview` は 1,319 + 1,024 = 2,343、`thumbnails` は 13,109 + 1,024 = 14,133 バイト。ID は ASCII なので、文字数とバイト数が同じ。
- 空白で大きさを合わせた body を送った結果:

| body | `Content-Length` あり | chunked(`Content-Length` なし) |
|---|---|---|
| `preview` 2,343 バイト | 200 | 200 |
| `preview` 2,344 バイト | 413 `INVALID_PLUGIN_REQUEST`「Plugin route request body exceeds 2343 bytes」 | 413 |
| `thumbnails` 14,133 バイト | 200 | 200 |
| `thumbnails` 14,134 バイト | 413(「exceeds 14133 bytes」) | 413 |
| 最大の入力(空白なし)1,319 / 13,109 バイト | 200 / 200 | — |

- 単体テストでは、最大の入力の body が上限に収まること、2 文字の字下げ・タブで整形した JSON も収まること、上限が「最大の body + 1 KiB」であることを確かめる。`PREVIEW_MAX_IDS` や `THUMBNAILS_MAX_IDS` を変えると、上限も計算し直される。

## T14 のクライアントとの結合

`src/client/api.ts`([[T14-admin-i18n-api|T14]])を esbuild でまとめて Node で動かし、`fetch` を包んで開発サーバーとセッションの cookie に向けた。根拠: **実測のみ**

- `fetchPreviews`(21 件、重複 1・ゴミ箱 2・無い 1・下書き 1 を含む): 10 件ずつ 2 回の要求がほぼ同時に送られ(開始の差 2.3ms)、20 件が要求の順で返った。見つかったのは 16 件。応答は T14 のスキーマ(`previewResponseSchema`)を通った。
- `fetchThumbnails`(150 件): 100 件と 50 件の 2 回が並行に送られ、150 件が返った。
- どの要求にも `X-EmDash-Request: 1` が付いていた。

## 再現手順

1. playground の `astro.config.mjs` / `tsconfig.json` / `seed/` / `src/` を `spikes/admin-data/site/` に複製する。`package.json` には playground と同じ `dependencies`(`astro`、`emdash`、`@astrojs/node`、`@astrojs/react`、`react`、`react-dom`。インストールは要らない)を書く([[emdash-after-save-payload#再現手順]])。
2. `astro.config.mjs` の `plugins` を、本物と同じ ID の spike のプラグインに差し替える。D1 の上限を模擬するときは、`SPIKE_D1_LIMIT=100` で dialect を差し替える([[emdash-query-count-b64-images#再現の手順]])。

```js
// spikes/admin-data/site/astro.config.mjs(抜粋)
const D1_LIMIT = process.env.SPIKE_D1_LIMIT ? Number(process.env.SPIKE_D1_LIMIT) : undefined;
const baseDb = sqlite({ url: "file:./data.db" });
const database = D1_LIMIT
	? { ...baseDb, entrypoint: here("./d1-like-dialect.mjs"), config: { url: "file:./data.db", variableNumber: D1_LIMIT } }
	: baseDb;
// emdash({ database, plugins: [{ id: "base64-image", version: "0.0.0", entrypoint: "/plugins/admin-data-spike.ts", options: {} }], fonts: false })
```

```js
// d1-like-dialect.mjs: emdash/db/sqlite(core/src/db/node-sqlite-compat.ts)と同じ包みで、上限だけを変える
const database = new DatabaseSync(filePath);
database.limits.variableNumber = config.variableNumber; // 100: 100 個は通り、101 個は too many SQL variables
return new SqliteDialect({ database: { close, prepare(sql) { /* reader / all / run / iterate */ } } });
```

3. 画像はアップロードのルート([[T18-upload-route|T18]])がまだ無いので、spike のプラグインの補助のルートで作る。capability は `content:read` / `content:write` / `content:publish`、ストレージ `imageRefs` を宣言する。1 枚の作成・公開・`imageRefs` の保存で約 72 クエリ(2 枚で 144。[[emdash-plugin-content-query-counts#書き込み(参考)|T10]] と同じ)。

```ts
// spikes/admin-data/site/plugins/admin-data-spike.ts(抜粋)
import { definePlugin } from "emdash";
import { previewRoute, thumbnailsRoute } from "../../../../src/server/routes/admin-data";
import { IMAGE_COLLECTION, IMAGE_REFS_STORAGE, ROUTES } from "../../../../src/shared/constants";

const PREFIX = "data:image/webp;base64,";
const dataUrl = (length: number) => PREFIX + "A".repeat(length - PREFIX.length); // 中身は検証しないので長さだけ合わせる

export function createPlugin() {
	return definePlugin({
		id: "base64-image",
		version: "0.0.0",
		capabilities: ["content:read", "content:write", "content:publish"],
		storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } },
		routes: {
			[ROUTES.preview]: previewRoute,
			[ROUTES.thumbnails]: thumbnailsRoute,
			"spike/create": {
				// permission を省略 = Admin のみ
				handler: async (ctx) => {
					const { count, srcLength = 100_000, thumbLength = 4_000, publish = true } = ctx.input as {
						count: number; srcLength?: number; thumbLength?: number; publish?: boolean;
					};
					const bytes = Math.floor(((srcLength - PREFIX.length) * 3) / 4);
					const ids: string[] = [];
					for (let i = 0; i < count; i++) {
						const image = { src: dataUrl(srcLength), mimeType: "image/webp", width: 1280, height: 853, meta: { v: 1, bytes, quality: 0.77 } };
						const item = await ctx.content!.create!(IMAGE_COLLECTION, { image });
						if (publish) {
							const { _rev } = (await ctx.content!.getVersioned!(IMAGE_COLLECTION, item.id))!;
							await ctx.content!.publish!(IMAGE_COLLECTION, item.id, { _rev });
						}
						await ctx.storage[IMAGE_REFS_STORAGE]!.put(item.id, {
							owners: [], bytes, width: 1280, height: 853, thumb: dataUrl(thumbLength),
							createdAt: new Date().toISOString(), createdBy: ctx.user?.id ?? "spike",
						});
						ids.push(item.id);
					}
					return { ids };
				},
			},
			// ほかに: spike/trash(ctx.content.delete)、spike/unpublish(getVersioned → unpublish)、
			// spike/preview-n(handlePreview を件数の上限なしで呼び、時間を測る)、spike/getmany-raw(getMany を分けずに呼ぶ)、
			// spike/put-ref(imageRefs に任意の記録を書く)
		},
	});
}
```

4. サイトのディレクトリで起動し、開発用ログインの cookie を取り、`X-EmDash-Request: 1` を付けて POST する。ロールは `users.role` を書き換えて変える([[emdash-plugin-route-permissions#0.39.1 での再計測]])。

```sh
cd spikes/admin-data/site
EMDASH_QUERY_LOG=1 node ../../../node_modules/astro/bin/astro.mjs dev --port 4417   # エージェントから実行するとバックグラウンドになる
# D1 の上限の模擬: SPIKE_D1_LIMIT=100 を前に付ける
node ../../../node_modules/astro/bin/astro.mjs dev stop
```

```js
const res = await fetch(`${base}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`, { redirect: "manual" });
const cookie = res.headers.getSetCookie().find((c) => c.startsWith("astro-session=")).split(";")[0];
const r = await fetch(`${base}/_emdash/api/plugins/base64-image/preview`, {
	method: "POST",
	headers: { "X-EmDash-Request": "1", "Content-Type": "application/json", Cookie: cookie },
	body: JSON.stringify({ ids }),
});
// r.headers.get("server-timing") の db.count、(await r.text()).length
```

5. JS の処理だけの時間は、`export { handlePreview, handleThumbnails } from "../../src/server/routes/admin-data"; export { z } from "zod";` を `npx esbuild … --bundle --format=esm --platform=node` でまとめ、`z.config({ jitless: true })` のあと、`get` が `{ status: "published", data: { image: JSON.parse(raw) } }` を返す偽の ctx で `handlePreview` → `JSON.stringify` → `TextEncoder#encode` を繰り返して測る。1 回目は `node bench.mjs first <件数> <長さ>` のように新しいプロセスで測る。
