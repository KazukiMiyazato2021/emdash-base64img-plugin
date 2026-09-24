---
id: T11
title: "サーバー側の検証ロジックを作る"
type: 実装
status: done
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
  - "[[T04-webp-utils]]"
soft_depends_on: []
blocks:
  - "[[T18-upload-route]]"
  - "[[T19-image-entry-hook]]"
files:
  - "src/server/validate.ts"
  - "tests/server/validate.test.ts"
spec:
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T11 サーバー側の検証ロジックを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]、[[T04-webp-utils|T04]]
> - このタスクを待つもの: [[T18-upload-route|T18]]、[[T19-image-entry-hook|T19]]
> - 仕様: [[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8章]]

## 目的

アップロード用ルートと保存 hook が共通で使う検証処理を、純粋な関数として作る。

## 作業内容

- [x] アップロード入力の検証(仕様書 8 章の①): data URL の形式と長さ、WebP の中身、寸法の一致、長辺 ≤ `maxEdge`、サムネイル
- [x] 画像エントリの値の検証(②で使う)
- [x] フィールド定義(`widget` / `options`)から、適用する上限を決める処理
- [x] エラーは [[T03-shared-contracts|T03]] のエラーコードで返す

## 完了条件

- [x] 単体テスト: 正常系、各エラー、境界値(保存 100,000 / 100,001 バイト、固定上限 500,000)

## 変更してよいファイル

- `src/server/validate.ts`
- `tests/server/validate.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/server/validate.ts` に、仕様書 8 章の①(アップロード用ルート)と②(`b64_images` の保存 hook)の検証を、EmDash の ctx を受け取らない純粋な関数として作った。失敗は例外ではなく結果の値(`{ ok: false, code, reason, message, details }`)で返す。
> - `tests/server/validate.test.ts` に 147 件のテストを書いた。境界値は、実際の WebP(フィクスチャと Chromium の canvas の出力)から作った data URL で試した。わざと入れた 18 種類の不具合は、すべてテストが失敗した。
> - 固定上限の入力で、ルートの検証全体(JSON の parse・スキーマ・①・②)は中央値 0.40ms / 0.93ms(`fromBase64` / `atob`)、新しいプロセスの 1 回目で 1.9ms / 3.1ms。Workers Free の 10ms より小さい。
> - 仕様書は 5.1(`meta.bytes` の確認)と 6.4(サーバーがサムネイルの長辺を確かめること)に 1 行ずつ足した。8 章の表への反映は [[#仕様書への反映]] に書いた(リーダーが反映する)。
> - 知見ノート: [[server-image-validation]](EmDash の挙動、上限の決め方、境界値の WebP の作り方、処理時間と手順)

### T18・T19 が使う export

| export | 使う場所 | 内容 |
|---|---|---|
| `validateUpload(input, collection)` | [[T18-upload-route\|T18]] | ① の入口。保存先 → 画像本体 → サムネイルの順に確かめる。`input` は `ctx.input`(`UploadRequest`)、`collection` は `ctx.schema.getCollection(input.target.collection)` の結果(無ければ null)。成功すると `{ ok: true, kind, options, image, thumb }` |
| `validateImageEntry(value)` | [[T19-image-entry-hook\|T19]] | ② の入口。`event.content.image`(型は `unknown` でよい)を確かめる。成功すると `{ ok: true, entry, image }` |
| `resolveUploadTarget(collection, target)` / `validateUploadImages(input, limits)` | 部品 | ① を 2 つに分けたもの(`validateUpload` はこの 2 つを順に呼ぶ) |
| `getFieldWidgetKind(field)` | [[T16-reference-hook\|T16]] など | このプラグインの widget の `json` フィールドなら `"image"` / `"gallery"`、そうでなければ null |
| `IMAGE_ENTRY_LIMITS` | — | ② の上限 `{ maxStoredBytes: 500000, maxEdge: 4096 }` |
| `VALIDATION_ERROR_CODES` / 型 `ValidationErrorCode` | — | この検証が返すコード(8 種類。`ERROR_HTTP_STATUS` ではどれも 400) |
| 型 `ValidationFailure` / `ValidationReason` / `TargetRejectionReason` | — | 失敗の形と、詳しい理由(T04 の 12 種類 + この検証の 11 種類) |
| 型 `CheckedWebp` | — | 成功したときの `image` / `thumb`: `storedBytes`(data URL の長さ)・`webpBytes`(WebP 本体のバイト数)・`info`(`WebpInfo`) |
| 型 `UploadInputLike` / `UploadImagesInput` / `UploadTargetLike` / `CollectionSchemaLike` / `FieldSchemaLike` / `ImageLimits` | — | 入力の形。`UploadRequest`・EmDash の `CollectionSchemaInfo`・`FieldOptions` をそのまま渡せる(型のテストで確かめた) |
| 型 `UploadValidationResult` / `UploadTargetResult` / `UploadImagesResult` / `ImageEntryResult` | — | 各関数の結果 |

呼び方の例(T18)。

```ts
import { PluginRouteError } from "emdash";

import { SCHEMA_VERSION, WEBP_MIME_TYPE } from "../../shared/constants";
import { ERROR_HTTP_STATUS } from "../../shared/errors";
import type { Base64ImageEntry } from "../../shared/types";
import { validateUpload } from "../validate";

// ctx.schema は capability "schema:read" を宣言したときだけある。無いのはプラグインの定義の誤りなので 500 にする
const collection = await ctx.schema.getCollection(input.target.collection);
const checked = validateUpload(input, collection);
if (checked.ok === false) {
	throw new PluginRouteError(checked.code, checked.message, ERROR_HTTP_STATUS[checked.code]);
}
const image: Base64ImageEntry = {
	src: input.dataUrl,
	mimeType: WEBP_MIME_TYPE,
	width: input.width,
	height: input.height,
	...(input.filename === undefined ? {} : { filename: input.filename }),
	// meta.bytes と imageRefs.bytes は、検証がデコードした WebP 本体のバイト数にする(② が一致を確かめる)
	meta: { v: SCHEMA_VERSION, bytes: checked.image.webpBytes, quality: input.quality },
};
```

呼び方の例(T19)。

```ts
import { ContentSaveRejectedError } from "emdash";

import { IMAGE_COLLECTION, IMAGE_FIELD } from "../../shared/constants";
import { validateImageEntry } from "../validate";

if (event.collection === IMAGE_COLLECTION) {
	const result = validateImageEntry(event.content[IMAGE_FIELD]);
	if (result.ok === false) {
		// ContentSaveRejectedError 以外を投げると、EmDash はメッセージを隠した CONTENT_HOOK_ERROR にする
		throw new ContentSaveRejectedError(`${IMAGE_COLLECTION}.${IMAGE_FIELD}: ${result.message}`);
	}
}
```

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 例外を投げず、結果の値で返す。`result.ok === false` で判別する | 呼び出し側ごとに投げる例外が違う。ルートは HTTP ステータス付きの `PluginRouteError`、保存 hook は `ContentSaveRejectedError`。保存 hook でほかの例外を投げると、EmDash はメッセージを隠した `CONTENT_HOOK_ERROR` にする(`references/emdash/packages/core/src/emdash-runtime.ts:513`)。値で返せば変換を型で強制でき、T04 の関数とも同じ形になる | 公式ドキュメントのみ |
| 2 | 失敗には `code`(T03 の `ServerErrorCode`)に加えて `reason`(詳しい理由)・`message`(英語。値の名前・上限・実際の値を書き、data URL の中身は入れない)・`details`(ログ用)を持たせる | 画面の文言はコードで決める。調査には T04 の理由が要る。保存 hook は `message` しか返せない | —(設計判断) |
| 3 | 保存先は、フィールドがあり、widget がこのプラグインのもの(`getWidgetKind`)で、型が `json` であること。どれかが欠けると `INVALID_TARGET`(理由は 5 種類) | 管理画面は型を見ずに widget を割り当てる(`packages/admin/src/components/ContentEditor.tsx:1807`)。参照を元の形のまま保存できるのは `json` 型だけ(`string` 型などはオブジェクトを拒否し、使われない画像が残る)。仕様書 13.1 のフィールドも `json` | 公式ドキュメントのみ |
| 4 | 適用する上限はフィールドの `options` を `normalizeFieldOptions` で丸めたもの。関数の中でも、保存サイズは 500,000、長辺は 16,383(`WEBP_MAX_DIMENSION`)で抑える | `options` は DB の JSON を parse しただけの値で、`null` や配列もありうる(`packages/core/src/schema/registry.ts:1922`)。丸めていない上限を渡されても、固定上限と WebP の寸法の上限を超えないようにする | 公式ドキュメントのみ(`options` の値)/ 実測のみ(テスト) |
| 5 | 画像本体の順番: 長さ(デコードの前)→ `parseWebpDataUrl` → 静止画か → 寸法の一致 → 長辺。① は保存先 → 画像本体 → サムネイルの順 | 大きな文字列をデコードしない(4,000,023 文字の data URL で、デコーダーが呼ばれないことをスパイで確かめた)。WebP の寸法の上限(16,383)は、長辺の上限(4,096 以下)で必ず満たされるので、長辺の確認にまとめた | 実測のみ |
| 6 | アニメーションの WebP は拒否する(`IMAGE_DATA_INVALID` / `THUMB_DATA_INVALID`、理由 `ANIMATED`) | このプラグインは静止画しか作らない(GIF も最初のフレームだけ。仕様書 6.5)。アニメーションは各フレームの中身を確かめていない(`parseWebp` はキャンバスの寸法だけを読む) | 推測のみ(方針) |
| 7 | サムネイルは、長さ ≤ 8,000(`THUMB_TOO_LARGE`)、静止画の WebP、長辺 ≤ 96px(`THUMB_EDGE`。超えると `THUMB_DATA_INVALID`)。下限・縦横比・本体との大小は確かめない | ブラウザは長辺 96px を超えるサムネイルを作らない(`src/client/thumbnail.ts`)。単色の 4096 × 4096 は可逆の WebP で 706 バイトで、8,000 バイトに入る。一覧に最大 100 枚並ぶので、寸法の上限が要る。サムネイルは本体ではなく元の画像から作るので、本体より大きいこともある(本体を予算で縮めたとき)。元が 48px 未満なら 48px 未満にもなる。コードを `THUMB_TOO_LARGE` にしないのは、画面の文言が「保存サイズが上限を超えています」だから | 実測のみ(706 バイト)/ 公式ドキュメントのみ(T13 のコード)|
| 8 | ② の上限は `IMAGE_ENTRY_LIMITS`(保存 500,000 バイト・長辺 4,096px = `MAX_EDGE_LIMIT`)。`WEBP_MAX_DIMENSION`(16,383)にはしない | ② はどのフィールドの画像か分からない。どのフィールドの options でも ① が受け付けうる最大にすると、「① を通った値は ② も通る」が成り立つ(ルートの `ctx.content.create` は ② を呼ぶ)。このプラグインは 4,096px を超える画像を作らない。16,383 × 16,383 は 2.7 億画素(RGBA で約 1GB)で、単色なら小さなデータで作れる見込み(4096 × 4096 の単色は可逆の WebP で 706 バイトだった)。16,383 は `width` / `height` のスキーマでも確かめている | 実測のみ(テスト・706 バイト)/ 推測のみ(方針・16,383px の大きさ) |
| 9 | ② は `src` の長さをスキーマ(`base64ImageEntrySchema`)より先に確かめ、そのあと値の形・`src` の中身・`meta.bytes` の順に確かめる | スキーマの正規表現(ASCII の確認)を大きな文字列に掛けないため。500,001 文字の `src` は `IMAGE_ENTRY_INVALID` ではなく `IMAGE_TOO_LARGE` になる | 実測のみ |
| 10 | ② で `meta.bytes` が WebP 本体のバイト数と一致することを確かめる(違えば `IMAGE_ENTRY_INVALID`、理由 `META_BYTES_MISMATCH`)。`meta.quality` は確かめない | `meta.bytes` は画面の保存サイズの表示と `imageRefs.bytes` に使う。デコードしたバイト数と比べるだけなので費用は無い。`meta.quality` はブラウザの申告(仕様書 5.1) | —(設計判断) |
| 11 | 上限が `NaN` なら拒否する | 比較を「以下なら通す」の形にした。丸めていない値を渡されたときに、黙って通さないため | 実測のみ(テスト) |

### T04 の理由とエラーコードの対応

| 理由(`reason`) | 出どころ | 意味 | 画像本体(① `dataUrl`・② `src`) | サムネイル(① `thumb`) |
|---|---|---|---|---|
| `STORED_BYTES_OVER_LIMIT` | T11 | data URL の長さが上限を超える(デコードの前に確かめる) | `IMAGE_TOO_LARGE` | `THUMB_TOO_LARGE` |
| `NOT_WEBP_DATA_URL` | T04(data URL) | `data:image/webp;base64,` で始まらない | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `INVALID_BASE64` | T04(data URL) | 接頭辞より後が正しい base64 でない | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `TOO_SHORT` | T04(WebP) | 20 バイトに満たない | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `NOT_WEBP` | T04(WebP) | `RIFF` / `WEBP` のシグネチャが無い | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `RIFF_SIZE_MISMATCH` | T04(WebP) | RIFF のサイズ欄とデータ長が違う | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `MALFORMED_CHUNK` | T04(WebP) | チャンクが範囲を超える・末尾で終わらない・単純形式に余計なチャンク | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `UNSUPPORTED_FORMAT` | T04(WebP) | 最初のチャンクが `VP8 ` / `VP8L` / `VP8X` でない | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `INVALID_VP8_HEADER` | T04(WebP) | `VP8 ` のフレームヘッダーが不正 | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `INVALID_VP8L_HEADER` | T04(WebP) | `VP8L` のヘッダーが不正 | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `INVALID_VP8X_HEADER` | T04(WebP) | `VP8X` が不正(大きさ・キャンバスの面積) | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `MISSING_IMAGE_DATA` | T04(WebP) | `VP8X` の後に画像データが無い | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `CANVAS_SIZE_MISMATCH` | T04(WebP) | `VP8X` のキャンバスと画像データの寸法が違う(WebP の中の食い違い) | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `ANIMATED` | T11 | アニメーションの WebP | `IMAGE_DATA_INVALID` | `THUMB_DATA_INVALID` |
| `DIMENSIONS_MISMATCH` | T11 | 申告された width / height がヘッダーの寸法と違う | `IMAGE_DIMENSIONS_MISMATCH` | —(申告が無い) |
| `EDGE_OVER_LIMIT` | T11 | 長辺が上限を超える | `IMAGE_EDGE_TOO_LONG` | `THUMB_DATA_INVALID` |
| `ENTRY_SHAPE` | T11(② だけ) | 値の形がスキーマに合わない | `IMAGE_ENTRY_INVALID` | — |
| `META_BYTES_MISMATCH` | T11(② だけ) | `meta.bytes` が WebP 本体のバイト数と違う | `IMAGE_ENTRY_INVALID` | — |
| `COLLECTION_NOT_FOUND` / `COLLECTION_MISMATCH` / `FIELD_NOT_FOUND` / `NOT_PLUGIN_WIDGET` / `NOT_JSON_FIELD` | T11(① だけ) | 保存先が無い・渡したスキーマが別のコレクション・フィールドが無い・widget が違う・`json` 型でない | `INVALID_TARGET` | — |

- T04 の 12 種類は、理由によらず `*_DATA_INVALID` にした。画面にできるのは「画像を選び直してください」だけなので、コードを分けても使い道が無い。理由は `reason`・`details.webpReason`・`message`(末尾の括弧)に残る。
- `message` の文は `WEBP_REASON_TEXT`(キーを理由の型で網羅)から作る。T04 が理由を増やすと型エラーになる。
- 12 種類それぞれを、実際の WebP を壊した data URL で、画像本体・サムネイル・画像エントリの 3 か所で確かめた(36 件)。根拠: **実測のみ**

### テスト

`tests/server/validate.test.ts`: 147 件。根拠: **実測のみ**

- 受け付けるもの: フィクスチャ 5 個(`VP8 `・`VP8L`・`VP8X` + `ALPH` + `VP8 `・`VP8L` の透過・`VP8X` + `VP8L` + `XMP `)と、Chromium 153 の canvas の出力 2 個(`VP8X` + `ICCP` + `VP8 `。寸法は `VP8X` から読む。横長と縦長)を、① と ② で。
- 境界値(実際の WebP を `XMP ` チャンクで伸ばした data URL。作り方は [[server-image-validation#境界値のテストの作り方]]):
  - 既定の上限 100,000: 保存 99,999(WebP 74,982 B)は通る、100,003(74,984 B)は `IMAGE_TOO_LARGE`。100,000 文字(正しい data URL + 1 文字)は長さの確認を通って `INVALID_BASE64`、100,001 文字は `IMAGE_TOO_LARGE`。`maxStoredBytes` 99,999 で 99,999 は通り、99,998 では拒否。
  - 固定上限 500,000: options が 10,000,000 でも、499,999 は通り、500,000 文字は `INVALID_BASE64`、500,001 文字と 500,003 は `IMAGE_TOO_LARGE`。② も同じ。
  - サムネイル 8,000: 7,999 は通り、8,000 文字は `INVALID_BASE64`、8,001 文字と 8,003 は `THUMB_TOO_LARGE`(フィールドの上限に関係なく)。
  - 長辺: 300px の画像を `maxEdge` 300 / 299、縦長 97px を 97 / 96、`MAX_EDGE_LIMIT` を Chromium の 4096 × 1 / 4097 × 1、`WEBP_MAX_DIMENSION` を組み立てた `VP8L` の 16,383 / 16,384 で。サムネイルは 96 × 64 / 65 × 97 で。
  - 正しい data URL の長さは 23 + 4k で、WebP 全体は偶数バイトなので、100,000 / 100,001 / 500,000 / 500,001 文字の正しい data URL は作れない。そのため長さの確認は、正しい data URL に文字を足して試した。
- そのほか: 保存先の 5 つの理由と options の丸め、寸法の不一致(7 通り。0・負・小数・NaN を含む)、アニメーション、T04 の 12 種類の対応、② の値の形(17 通り)と `meta.bytes`、確かめる順番、「① を通った値は ② も通る」、`CollectionSchemaInfo` と `UploadRequest` をそのまま渡せること(型のテスト)。
- わざと不具合を入れて、テストが失敗するかを確かめた(1 つずつ入れて実行し、元に戻した)。18 種類すべてで失敗した。

| 入れた不具合 | 失敗したテスト |
|---|---|
| 長さの比較を `<` にする(上限ちょうどを拒否) | 5 |
| 長さの確認をデコードの後にする | 1 |
| アニメーションを受け付ける | 2 |
| 高さの一致を確かめない | 1 |
| 長辺に幅だけを使う | 1 |
| `json` 型を確かめない | 3 |
| `meta.bytes` を確かめない | 3 |
| サムネイルに固定上限 500,000 を当てる | 3 |
| サムネイルの不正を `IMAGE_DATA_INVALID` にする | 15 |
| 保存サイズを固定上限で抑えない | 1 |
| ② の長辺の上限を `WEBP_MAX_DIMENSION` にする | 2 |
| ② で `src` の長さをスキーマより先に確かめない | 3 |
| サムネイルの長辺を確かめない | 1 |
| 長辺を `WEBP_MAX_DIMENSION` で抑えない | 1 |
| フィールドの `options` を読まない | 10 |
| 長辺の上限が `NaN` のとき通す | 1 |
| コレクションの取り違えを確かめない | 1 |
| サムネイルを画像本体より先に確かめる | 2 |

### 処理時間(Workers Free の CPU 時間は 10ms)

| 入力 | 測ったもの | `fromBase64` 中央値 / p95(ms) | `atob` 中央値 / p95(ms) |
|---|---|---|---|
| 固定上限(data URL 499,999 文字 + サムネイル 7,999 文字、body 508,188 バイト) | `validateUpload`(①) | 0.034 / 0.052 | 0.327 / 0.426 |
| 同じ | `validateImageEntry`(②) | 0.142 / 0.160 | 0.409 / 0.508 |
| 同じ | ルートの検証全体(JSON の parse + `uploadRequestSchema` + ① + ②) | 0.405 / 0.446 | 0.933 / 0.985 |
| 同じ・新しいプロセスでの 1 回目(5 回) | ルートの検証全体 | 1.85〜1.95 | 2.97〜3.31 |
| 既定(data URL 99,999 文字) | ルートの検証全体 | 0.087 / 0.100 | 0.194 / 0.233 |

- アップロードでは、ルートの `ctx.content.create` が ② の保存 hook を呼ぶので、① と ② が 1 回ずつ動く。「ルートの検証全体」はその組み合わせ。最も重い 1 回目の `atob` でも 3.3ms で、10ms より小さい。根拠: **実測のみ**(Node 26.10.0、Apple M5 Pro。手順は [[server-image-validation#処理時間]])
- Workers(workerd)では測っていない。`Uint8Array.fromBase64` があるかも確かめていない。根拠: **推測のみ**(同じ V8 なので同程度の見込み)

### 仕様書への反映

このタスクで変えたところ(5.1・6.4 だけ):

- 5.1: 「`meta.bytes` は、保存 hook(8 章の②)が、`src` をデコードした WebP 本体のバイト数と一致することを確かめる」を足した(決定 10)。
- 6.4: 「サーバーは、長辺が 96px 以下の静止画の WebP だけを受け付ける(超えると `THUMB_DATA_INVALID`)」と理由を足した(決定 7)。

リーダーに反映をお願いしたいところ(8 章の表など。このタスクでは変えていない):

1. 8 章の表 ①
   - 「保存先のフィールドが存在し、このプラグインの widget であること」→「保存先のフィールドが存在し、このプラグインの widget の `json` フィールドであること」(決定 3)
   - 「`dataUrl` が … 長さが `maxStoredBytes` 以下(固定上限 500,000)」に「長さはデコードする前に確かめる」を足す(決定 5)
   - 「デコードした中身が WebP …」に「静止画であること(アニメーションは拒否)」を足す(決定 6)
   - 「`thumb` が WebP で、data URL の長さで 8,000 バイト以下」→「`thumb` が静止画の WebP で、長辺 96px 以下、data URL の長さで 8,000 バイト以下」(決定 7)
   - 「不正なとき」の列: 「拒否(HTTP 400。コードと理由の対応は [[T11-server-validation#T04 の理由とエラーコードの対応|T11]])」
2. 8 章の表 ②: 「①と同じ中身の検証」→「値の形(`base64ImageEntrySchema`)と、`src` の ① と同じ中身の検証(フィールドが分からないので固定上限: 保存 500,000 バイト・長辺 4,096px)。`meta.bytes` が WebP 本体のバイト数と一致すること」(決定 8〜10)
3. 8 章の「処理の重さ」: 固定上限の入力でのルートの検証全体(0.40ms / 0.93ms、1 回目 1.9ms / 3.1ms)を足す。付録 A.4 にも足せる。
4. 5.3 の `thumb` のコメント「長辺 96px 程度」は、6.4 と揃えるなら「長辺 96px 以下」。

### 他のタスクへの影響

| タスク | 内容 |
|---|---|
| [[T18-upload-route\|T18]] | 上の呼び方の例のとおり。`meta.bytes` と `imageRefs.bytes` は `checked.image.webpBytes` にする(② が一致を確かめる)。`ctx.schema` が無いのはプラグインの定義の誤りなので、`INVALID_TARGET` にせず 500 にする。`collection` には `input.target.collection` のスキーマを渡す(別のコレクションなら `COLLECTION_MISMATCH`) |
| [[T19-image-entry-hook\|T19]] | 上の呼び方の例のとおり。必ず `ContentSaveRejectedError` に変換する。部分更新で `image` が無いときの扱いは T19 が決める(画像エントリは作成後に変更しない。仕様書 5.1) |
| [[T16-reference-hook\|T16]] | 「このプラグインのフィールド」の判定を `getFieldWidgetKind`(`json` 型 + widget)と揃えるとよい。T16 は並行して作られているので、マージのときに確かめる(推測のみ) |
| [[T21-orphan-routes\|T21]] / [[T24-list-column\|T24]] / [[T29-plugin-definition\|T29]] | フィールドの判定に `getFieldWidgetKind` を使える。T29 の widget の `fieldTypes` は `["json"]` にすると、この検証と揃う |
| [[T32-cloudflare-check\|T32]] | workerd で、アップロード全体の CPU 時間と `Uint8Array.fromBase64` の有無を確かめる |

### 未解決

- `target.entryId` / `target.locale` は確かめていない(T18 が参照元の記録に使う)。[[T08-spike-route-body|T08]] が指摘した `localeSchema` に長さの上限が無い問題は残っている([[T03-shared-contracts|T03]] のスキーマの範囲)。
- Workers での処理時間は未計測(上記)。
