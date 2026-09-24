---
id: T08
title: "スパイク: プラグインのルートの body 上限を確かめる"
type: スパイク
status: done
wave: 2
depends_on:
  - "[[T02-playground]]"
soft_depends_on: []
blocks:
  - "[[T18-upload-route]]"
files:
  - "spikes/route-body/**(使い捨て)"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
  - "[[base64-image-plugin-spec#16. 実装前の検証(スパイク)]]"
tags:
  - task
  - spike
created: 2026-09-23
---

# T08 スパイク: プラグインのルートの body 上限を確かめる

> [!info] 概要
> - 種別: スパイク / ウェーブ: 2
> - 着手の条件(依存): [[T02-playground|T02]]
> - このタスクを待つもの: [[T18-upload-route|T18]]
> - 仕様: [[base64-image-plugin-spec#7. アップロード(書き込み経路)|仕様書 7章]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|仕様書 16章]]

## 目的

仕様書 16 章の2つ目。native プラグインのルートが、約 100KB(と固定上限の 500KB)の JSON を受け取れるかを確かめる。

## 作業内容

- [x] 使い捨てのルートを作り、100KB / 500KB / 1MiB 超の body を送る
- [x] `request` の宣言(body の形式と上限)の書き方と、上限を超えたときのエラーの形を確認する
- [x] 管理画面から呼ぶときの CSRF ヘッダー(`X-EmDash-Request: 1`)と、権限チェックの挙動を確認する
  - 管理画面そのもの(ブラウザ)からではなく、ブラウザと同じヘッダー(Cookie・`X-EmDash-Request`・`Origin`)を付けた HTTP リクエストで確かめた。

## 完了条件

- [x] 結果を記録し、[[T18-upload-route|T18]] で使うルートの宣言方法をまとめた

## 変更してよいファイル

- `spikes/route-body/**`(使い捨て)
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!summary] 結論
> - native プラグインのルートは、100KB の data URL も、固定上限(500,000)の data URL も受け取れる。設計を変える必要は無い。
> - 仕様書 16 章が引用した「既定 1MiB」は、ルートが `request`(body の形式)を宣言したときだけの上限である。native でも同じ処理を通る。**宣言しないと上限は無い。** そのため、アップロードのルートでは `request: { body: "json", maxBytes: 600_000 }` を宣言する。
> - 権限の表は、0.39.1 でも [[T06-decision-trash-permission|T06]](0.38.0)と同じだった。T06 の結論は変わらない。
> - 詳細・再現手順・全データ: [[emdash-plugin-route-body-limit]]、[[emdash-plugin-route-permissions#0.39.1 での再計測]]

使い捨てのサイト(`spikes/route-body/site/`。playground の複製)で、開発サーバー(`astro dev --port 4408`)と本番のビルド(`astro build` + `astro preview --port 4408`)の両方で測った。すべての結果が両方で同じだった。環境: macOS 26.4、Apple M5 Pro、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、`@astrojs/node` 11.1.6、zod 4.5.4。2026-09-24 に計測。

### body の上限

- `request` を宣言しないルートは、12,000,000 バイトの JSON も受け取った。EmDash の側に上限は無い(POST は `request.json()` で読む。`packages/core/src/plugins/routes.ts:129-150`)。根拠: **実測+公式ドキュメント**
- `request: { body: "json" }` の既定の上限は 1,048,576 バイトである。1,048,576 は 200、1,048,577 は 413 だった。`maxBytes: 600_000` なら、600,000 は 200、600,001 は 413。根拠: **実測+公式ドキュメント**(`packages/plugin-types/src/routes.ts:3-4`、`packages/core/src/plugins/route-wire.ts:177-203`)
- `maxBytes` が 8 MiB を超えても、エラーにならずに 8,388,608 に切り詰められる。native の `definePlugin` はルートの宣言を検証せず、型エラーにもならない。根拠: **実測+公式ドキュメント**(`route-wire.ts:186` の `Math.min`)
- 上限を超えたときの応答は 413 `{"success":false,"error":{"code":"INVALID_PLUGIN_REQUEST","message":"Plugin route request body exceeds 1048576 bytes"}}` である。`Content-Length` があれば読む前に、無ければ(chunked)読みながら数えて拒否した。根拠: **実測+公式ドキュメント**
- ほかの上限(参考): 本番の `@astrojs/node` は 1 GiB、`astro dev` は無し、Cloudflare はアカウントのプランで決まる(Free は 100 MB)。Astro の `actionBodySizeLimit` / `serverIslandBodySizeLimit`(1 MiB)は、プラグインのルートには関係しない。根拠: **公式ドキュメントのみ**
- 仕様書 2.2 の「EmDash API のリクエスト body 10MB(`packages/core/src/api/parse.ts:13`)」は、EmDash 自身の API の `parseBody` の上限である。プラグインのルートには当てはまらない。根拠: **公式ドキュメントのみ**
- JSON の応答には上限が無く、12MB の応答も返った(8 MiB の上限があるのは `response: "raw"` だけ)。根拠: **実測+公式ドキュメント**

### 不正な body と入力のスキーマ

- `json` を宣言したルートでは、正しくない JSON・空の body は 400 `INVALID_PLUGIN_REQUEST`(「not valid JSON」)になる。UTF-8 でないバイトも 400 `INVALID_PLUGIN_REQUEST`(「not valid UTF-8」)になる。Content-Type は見ない。宣言しないと、どれも `ctx.input` が `undefined` になるだけである。根拠: **実測+公式ドキュメント**
- `input: uploadRequestSchema` に合わない入力(`width: 0`、知らないキー、500,001 文字の `dataUrl`)は、400 `VALIDATION_ERROR`「Invalid request body」になり、ハンドラーは呼ばれない。どの項目が悪いかは返らない。根拠: **実測+公式ドキュメント**
- 判定の順番は、認証 401 → 権限 403 → CSRF 403 → `methods` 405(`Allow: POST`)→ body の上限 413 → スキーマ 400 である。根拠: **実測+公式ドキュメント**(`packages/core/src/plugins/http-route-dispatch.ts:104-126`)

### 権限と CSRF(0.39.1 での再計測)

- permission ×ロールの表は T06 と同じだった(省略すると Admin のみ、`content:create` は Contributor 以上、存在しない文字列は全員 500)。`content:read`(Subscriber 以上)と `media:upload`(Contributor 以上)の行を足した。GET / DELETE / PUT / PATCH でも同じだった。根拠: **実測+公式ドキュメント**
- CSRF の確認は 2 か所にある。1 つはミドルウェアで、ヘッダーが無く、`Origin` が別のサイトなら「Cross-origin request blocked」を返す。公開ルートも対象になる。もう 1 つはディスパッチで、private ルートにヘッダーが無ければ、メソッドに関係なく「Missing required header」を返す。コードはどちらも `CSRF_REJECTED`。根拠: **実測+公式ドキュメント**
- API トークンは `admin` スコープが要る。トークンでも、利用者の今のロールで `permission` が判定される。根拠: **実測+公式ドキュメント**
- `docs/emdash-plugin-route-permissions.md` に「0.39.1 での再計測」を追記した(リーダーの指定)。

### CPU 時間(Node)

根拠: **実測のみ**(Node 26.10.0、Apple M5 Pro。Workers では測っていない)

| 処理(中央値) | 既定の予算(body 100,875 B) | 固定上限(body 503,076 B) |
|---|---|---|
| UTF-8 のデコード + `JSON.parse` | 0.027ms | 0.131ms |
| `uploadRequestSchema.safeParse`(jitless。Workers と同じ経路) | 0.024ms | 0.115ms |
| `parseWebpDataUrl`(本体 + サムネイル) | 0.009ms | 0.035ms |
| 合計 | 0.057ms | 0.277ms |
| 合計(新しいプロセスでの 1 回目、15 回の中央値) | 0.83ms | 1.10ms |

- どれも Workers Free の 10ms と比べて小さい。1 回目は zod の初期化が大半を占める。
- 宣言しないルートに 10.5MB の body を送ると、parse に 3.3ms、スキーマに 2.3ms を使ってから拒否する(zod は `max` で失敗したあとも、正規表現で文字列全体を調べる)。body の上限を宣言すれば、読む前に 413 になる。
- アップロード全体(クエリ 72 本の組み立て、公開など)の CPU 時間は測っていない。Workers での値は [[T32-cloudflare-check|T32]] で確かめる(推測のみ)。

### T18 で使うルートの宣言

spike で同じ宣言のルートを動かして確かめた形。`…` を仮の実装にしたコピーは、`definePlugin({ routes: { [ROUTES.upload]: uploadRoute } })` まで含めて `tsc` を通った。根拠: **実測+公式ドキュメント**

```ts
// src/server/routes/upload.ts
import type { PluginRoute, RouteContext } from "emdash";
import { PluginRouteError } from "emdash";

import { ROUTE_PERMISSIONS } from "../../shared/constants";
import { uploadRequestSchema } from "../../shared/schema";
import type { UploadRequest, UploadResponse } from "../../shared/types";

/**
 * アップロードの body の上限(バイト)。正しい入力の body は最大 509,462 バイト
 * (dataUrl 500,000 文字、thumb 8,000 文字、filename などほかの項目も最大。locale が普通の長さのとき)で、それに余裕を足した。
 * 宣言しないと、EmDash は body を上限なしに読む。
 */
export const UPLOAD_MAX_BODY_BYTES = 600_000;

export async function handleUpload(ctx: RouteContext<UploadRequest>): Promise<UploadResponse> {
	// private ルートでは EmDash が認証済みの利用者を入れるが、型は省略可能なので絞り込む
	if (!ctx.user) throw PluginRouteError.unauthorized();
	const input = ctx.input; // uploadRequestSchema で検証済み
	// 検証(T11)→ create → getVersioned → publish → imageRefs → 参照を返す(仕様書 7 章)
	…
}

export const uploadRoute: PluginRoute<UploadRequest> = {
	permission: ROUTE_PERMISSIONS.upload, // "content:create"(Contributor 以上)
	methods: ["POST"],
	request: { body: "json", maxBytes: UPLOAD_MAX_BODY_BYTES },
	input: uploadRequestSchema,
	handler: handleUpload,
};

// T29: definePlugin({ routes: { [ROUTES.upload]: uploadRoute } })
```

- 型は `PluginRoute<UploadRequest>` で付ける。`definePluginRoute` を使うと、json の入力の型は `unknown` になる(TS18046)。根拠: **実測のみ**(`tsc`)
- `input` を書き忘れても型エラーにならない(ハンドラーの型は bivariance で通る)。T18 の単体テストで、スキーマに合わない入力が拒否されることを確かめる。固定上限の入力を `JSON.stringify` したバイト数が `UPLOAD_MAX_BODY_BYTES` 以下であることも確かめる(上限や定数を変えたときに失敗する)。根拠: **実測のみ**(型)/ **推測のみ**(テストの方針)
- 既定の 1 MiB でも足りる。それでも 600,000 を明示するのは、上限をコードで読めるようにするためと、既定値が変わっても挙動が変わらないようにするためである。
- 画面側([[T14-admin-i18n-api|T14]])は `X-EmDash-Request: 1` を付けて POST する。EmDash が返す `INVALID_PLUGIN_REQUEST`(400 / 413)・`VALIDATION_ERROR`・`METHOD_NOT_ALLOWED`・`CSRF_REJECTED` は、`src/shared/errors.ts` の `HOST_ERROR_CODES` にある。

### 仕様書とほかのタスクへの影響

- 仕様書 7 章: ルートの宣言(`methods` / `request` / `input`)、body の上限、CSRF のヘッダー、CPU 時間を追記した(リーダーの指定)。
- 仕様書 16 章(リーダーが更新する): 2 つ目の項目の結論として、「『既定 1MiB』は `request` を宣言したルートだけの上限。native も同じ(`maxBytes` で最大 8 MiB)。宣言しないと上限なし。アップロードのルートは `request: { body: "json", maxBytes: 600_000 }` を宣言する。100KB も固定上限の 500KB も受け取れた」を提案する。
- 仕様書 2.2 と付録 B の「EmDash API のリクエスト body 10MB(`packages/core/src/api/parse.ts:13`)」は、プラグインのルートには当てはまらない。7 章以外なので変更していない。
- [[T03-shared-contracts|T03]] / [[T11-server-validation|T11]] / [[T18-upload-route|T18]]: `localeSchema` に長さの上限が無く、`uploadRequestSchema` は 450,002 文字の `target.locale` も通した。根拠: **実測のみ**。サイトのロケールと照らし合わせるか、スキーマに上限を足す必要がある(推測のみ)。
- [[T17-admin-data-routes|T17]]: JSON の応答には上限が無いので、プレビュー取得(10 件 × 最大 500,000 文字)も大きさでは失敗しない。
- [[T32-cloudflare-check|T32]]: workerd でも同じ上限・エラーになるか、アップロード全体の CPU 時間を確かめる。

### 変更したファイル

- 新規: `docs/emdash-plugin-route-body-limit.md`
- 追記: `docs/emdash-plugin-route-permissions.md`(「0.39.1 での再計測」。リーダーの指定)
- 追記: `plans/base64-image-plugin-spec.md` の 7 章(リーダーの指定)
- このノート
- `spikes/route-body/**`(git 管理外。コミットしない)
