---
id: T03
title: "共有の型・スキーマ・定数を定める"
type: 実装
status: done
wave: 1
depends_on:
  - "[[T01-scaffold]]"
soft_depends_on: []
blocks:
  - "[[T11-server-validation]]"
  - "[[T12-input-decode]]"
  - "[[T13-encode-search]]"
  - "[[T14-admin-i18n-api]]"
  - "[[T15-site-resolve]]"
  - "[[T16-reference-hook]]"
  - "[[T17-admin-data-routes]]"
  - "[[T20-owner-tracking]]"
  - "[[T21-orphan-routes]]"
files:
  - "src/shared/constants.ts"
  - "src/shared/types.ts"
  - "src/shared/schema.ts"
  - "src/shared/options.ts"
  - "src/shared/errors.ts"
  - "src/shared/pipeline.ts"
  - "tests/shared/schema.test.ts"
spec:
  - "[[base64-image-plugin-spec#5. データモデル]]"
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
  - "[[base64-image-plugin-spec#13. 設定]]"
tags:
  - task
  - impl
  - shared
created: 2026-09-23
---

# T03 共有の型・スキーマ・定数を定める

> [!info] 概要
> - 種別: 実装 / ウェーブ: 1
> - 着手の条件(依存): [[T01-scaffold|T01]]
> - このタスクを待つもの: [[T11-server-validation|T11]]、[[T12-input-decode|T12]]、[[T13-encode-search|T13]]、[[T14-admin-i18n-api|T14]]、[[T15-site-resolve|T15]]、[[T16-reference-hook|T16]]、[[T17-admin-data-routes|T17]]、[[T20-owner-tracking|T20]]、[[T21-orphan-routes|T21]]
> - 仕様: [[base64-image-plugin-spec#5. データモデル|仕様書 5章]]、[[base64-image-plugin-spec#7. アップロード(書き込み経路)|仕様書 7章]]、[[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8章]]、[[base64-image-plugin-spec#13. 設定|仕様書 13.2]]

## 目的

サーバー・管理画面・サイト側の各タスクが並列に実装できるよう、データの形とインターフェースを先に固める。**多くのタスクがこれを待つので、最優先で小さく仕上げる。**

## 作業内容

- [x] 定数: プラグイン ID `base64-image`、widget 名(`image` / `gallery`)、コレクション `b64_images`、ストレージ `imageRefs`、固定上限(保存 500,000 / サムネイル 8,000 / alt 1,000 文字)
- [x] フィールド options の型と既定値の補完(`maxStoredBytes` 100000 / `maxEdge` 1600 / `minQuality` 0.6 / `minEdge` 480 / `maxItems` 10)
- [x] zod スキーマと型: 画像エントリの値、参照 `{ v, id, locale, width, height, alt }`、ギャラリー(参照の配列)、`imageRefs` のメタデータ
- [x] type guard: `isBase64ImageRef` / `isBase64ImageGallery`
- [x] 各ルートの入出力の型: アップロード、プレビュー取得、サムネイル取得、画像管理(一覧・状態・ゴミ箱)
- [x] エラーコード一覧(`SCREAMING_SNAKE_CASE`)
- [x] 圧縮処理のインターフェース: デコード結果、エンコーダー関数、圧縮結果の型

## 完了条件

- [x] スキーマの単体テスト(正常な値・境界値・不正な値)
- [x] 仕様書 5・7・8 章の形と一致している(形を変えた 3 点は、仕様書のほうを更新した。[[#仕様書の変更]])

## 変更してよいファイル

- `src/shared/constants.ts`
- `src/shared/types.ts`
- `src/shared/schema.ts`
- `src/shared/options.ts`
- `src/shared/errors.ts`
- `src/shared/pipeline.ts`
- `tests/shared/schema.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## メモ

- 確定後に形を変えると多くのタスクに影響する。変更が必要になったら、影響するタスクの担当と調整する。

## 結果

> [!success] 概要(2026-09-24)
> - `src/shared/` に constants / options / schema / types / errors / pipeline の 6 ファイルを作り、`tests/shared/schema.test.ts` に 109 件のテスト(型のテストを含む)を書いた。
> - 仕様書の形から 3 点を変えた: 画像エントリの値から `id` を外した / `meta.quality`(圧縮時の画質)とアップロードの `quality` を加えた / サムネイルの上限を data URL の長さで測ると明記した。
> - 仕様の未決事項として、options の範囲と丸め(13.2)、ルートの名前・permission・エラーの形(7 章)、画像エントリ自身の状態(9 章)を決めた。
> - スキーマは形(型・必須・範囲)だけを確かめる。data URL の中身(接頭辞・base64・WebP・寸法)は [[T11-server-validation|T11]] が [[T04-webp-utils|T04]] の関数で確かめる。T04 のファイルは import していない。

### 主な export

| ファイル | export |
|---|---|
| `src/shared/constants.ts` | `PLUGIN_ID`、`WIDGET_KINDS` / `WidgetKind`、`WIDGET_IDS`、`IMAGE_COLLECTION`、`IMAGE_FIELD`、`IMAGE_REFS_STORAGE`、`SCHEMA_VERSION`、`WEBP_MIME_TYPE`、`MAX_STORED_BYTES_LIMIT`(500,000)、`MIN_STORED_BYTES_LIMIT`(10,000)、`THUMB_MAX_STORED_BYTES`(8,000)、`THUMB_EDGE`(96)、`MAX_ALT_LENGTH`(1,000)、`MAX_QUALITY`(0.92)、`SHRINK_FACTOR`(0.8)、`MAX_EDGE_LIMIT`(4,096)、`MIN_EDGE_LIMIT`(96)、`MAX_ITEMS_LIMIT`(20)、`WEBP_MAX_DIMENSION`(16,383)、`MAX_FILENAME_LENGTH`(255)、`MAX_INPUT_FILE_BYTES`(40,000,000)、`MAX_INPUT_PIXELS`(64,000,000)、`DEFAULT_FIELD_OPTIONS`、`FIELD_OPTION_RANGES`、`ROUTES` / `RouteKey`、`ROUTE_PERMISSIONS`、`PREVIEW_MAX_IDS`(10)、`THUMBNAILS_MAX_IDS`(100) |
| `src/shared/options.ts` | `FieldOptions`、`FieldOptionsInput`、`normalizeFieldOptions`、`getWidgetKind` |
| `src/shared/schema.ts` | 部品: `slugSchema`、`entryIdSchema`、`localeSchema`、`dimensionSchema`、`altSchema`、`qualitySchema`、`filenameSchema`、`imageDataUrlSchema`、`thumbDataUrlSchema`、`webpBytesSchema`、`isoDateTimeSchema`<br>値: `base64ImageMetaSchema`、`base64ImageEntrySchema`、`base64ImageRefSchema`、`base64ImageGallerySchema`、`isBase64ImageRef`、`isBase64ImageGallery`、`imageOwnerSchema`、`imageRefsRecordSchema`<br>ルート: `uploadTargetSchema`、`uploadRequestSchema`、`uploadResponseSchema`、`previewRequestSchema`、`previewItemSchema`、`previewResponseSchema`、`thumbnailsRequestSchema`、`thumbnailSchema`、`thumbnailItemSchema`、`thumbnailsResponseSchema`、`ownerStatusSchema`、`imageUsageSchema`、`imageEntryStatusSchema`、`imagesListRequestSchema`、`imageListOwnerSchema`、`imageListItemSchema`、`imagesListResponseSchema`、`imagesTrashRequestSchema`、`imagesTrashResponseSchema`、`routeSuccessBodySchema` |
| `src/shared/types.ts` | `Base64ImageMeta`、`Base64ImageEntry`、`Base64ImageRef`、`Base64ImageGallery`、`ImageOwner`、`ImageRefsRecord`、`UploadTarget`、`UploadRequest`、`UploadResponse`、`PreviewRequest`、`PreviewItem`、`PreviewResponse`、`ThumbnailsRequest`、`Thumbnail`、`ThumbnailItem`、`ThumbnailsResponse`、`OwnerStatus`、`ImageUsage`、`ImageEntryStatus`、`ImagesListRequest`、`ImageListOwner`、`ImageListItem`、`ImagesListResponse`、`ImagesTrashRequest`、`ImagesTrashResponse`、`ResolvedBase64Image` |
| `src/shared/errors.ts` | `SERVER_ERROR_CODES` / `ServerErrorCode`、`ERROR_HTTP_STATUS`、`CLIENT_ERROR_CODES` / `ClientErrorCode`、`ErrorCode`、`HOST_ERROR_CODES` / `HostErrorCode`、`KnownErrorCode`、`NOTICE_CODES` / `NoticeCode`、`isKnownErrorCode`、`ErrorDetails`、`Base64ImageError` / `Base64ImageErrorOptions`、`isBase64ImageError`、`routeErrorBodySchema` / `RouteErrorBody` |
| `src/shared/pipeline.ts` | `ImageSource`、`DecodedImage`、`DecodeOptions`、`DecodeImage`、`EncodeRequest`、`WebpEncoder`、`CompressProgress`、`CompressOptions`、`CompressionResult`、`CompressImage`、`ThumbnailOptions`、`ThumbnailResult`、`CreateThumbnail`、`UploadOptions`、`UploadImage` |

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 画像エントリの値(`b64_images` の `image`)に `id` を持たせない。読み出すときにエントリ ID を `id` に入れる。`ResolvedBase64Image`(値 + `id` + 参照の `alt`)が `MediaValue` に代入できる | プラグインの `ctx.content.create` は ID を指定できず(`references/emdash/packages/core/src/emdash-runtime.ts:2135`)、新規作成時の `content:beforeSave` にも ID が渡らない(`:3339`)。ID はリポジトリで決まる(`database/repositories/content.ts:334`) | ID は公式ドキュメントのみ。`MediaValue` への代入は実測のみ(tsc) |
| 2 | 画像エントリに `meta.quality`(任意)、アップロードの入力に `quality`(必須)を加えた | 仕様書 11.2 は、設定済みの画像に「画質 0.77」を出す。保存済みの画像を開き直したときにも出すには、保存しておく必要がある | —(設計判断) |
| 3 | サムネイルの上限は data URL の長さで 8,000 バイト(WebP 本体で 5,982 バイト)。定数は `THUMB_MAX_STORED_BYTES` | 仕様書 5.3 と 6.4・8 章の書き方が食い違っていた(T04 の指摘)。本体の `maxStoredBytes` と同じく、保存する文字列の長さで測る(リーダーの決定) | —(リーダーの決定) |
| 4 | data URL のスキーマを、空白を除く ASCII の印字可能文字に限る | zod 4.5.4 の `max` は文字列をコードポイントで数える。ASCII に限れば、長さの上限がバイトの上限になる([[zod-string-length-code-points]]) | 実測+公式ドキュメント |
| 5 | 代替テキストの 1,000 文字はコードポイントで数える | zod の数え方のまま。HTML の `maxlength` は UTF-16 で数えるので、入力欄のほうが厳しいか同じになる | 実測+公式ドキュメント |
| 6 | options の範囲と丸め(仕様書 13.2): `maxStoredBytes` 10,000〜500,000 / `maxEdge` 96〜4,096 / `minQuality` 0〜0.92 / `minEdge` 96〜`maxEdge` / `maxItems` 1〜20。範囲外は丸め、整数の項目は切り捨て、数値でない値は既定値 | 500,000 は仕様の固定上限。96 はサムネイルの長辺、0.92 は画質の上限。4,096 と 20 は小さく始めた(広げるのは後からできる) | 500,000・0.92 は仕様書のとおり。4,096 は推測のみ。ほかは設計判断 |
| 7 | エントリ ID は、英数字で始まり英数字・`_`・`-` だけの 128 文字まで | EmDash の ULID は満たす。seed で slug を省いたエントリは seed の `id` がそのまま ID になる(`seed/apply.ts:676`)。`/` と `.` を含まないので、URL のパスに入れても別のパスを指さない | 公式ドキュメントのみ |
| 8 | ルートのエラー: ハンドラーは `PluginRouteError(code, message, ERROR_HTTP_STATUS[code])` を投げる。応答は `{ success: false, error: { code, message } }`。画面の文言はコードだけで決める | `details` は応答から落ちる。想定外の例外は `INTERNAL_ERROR` で `message` が固定の文になる([[emdash-plugin-route-errors]]) | 実測+公式ドキュメント |
| 9 | ルートの名前は `upload` / `preview` / `thumbnails` / `images/list` / `images/trash`。どれも POST + JSON の body。permission は `content:create` / `content:read` / `content:read` / `content:read_drafts` / `content:create` | GET・DELETE は入力が query 文字列から作られ、値が文字列になり、1 つだけの値は配列にならない(`plugins/routes.ts:129-150`)。permission は [[T06-decision-trash-permission\|T06]] と [[T17-admin-data-routes\|T17]] のとおり | 公式ドキュメントのみ。permission が EmDash の `Permission` 型に合うことは実測のみ(tsc) |
| 10 | プレビュー取得は 1 回 10 件、サムネイル取得は 1 回 100 件まで。超える分はクライアントが分けて送る | `ctx.content.get` は見つかった 1 件につき 2 クエリ(`plugins/content-access.ts:25-51`)。D1 は 1 リクエスト 50 クエリまで。コンテンツ一覧は 1 ページ 100 行 | 公式ドキュメントのみ |
| 11 | 画像管理の一覧の項目に、`usage`(状態バッジ)と `owners[].status`(参照元ごとの状態)とは別に、`entryStatus`(`active` / `trashed` / `missing`)を持たせる | 完全削除のボタンは、ゴミ箱に入った画像にだけ出す(T06)。0.39.1 では `content:restore` の `getTrashedVersioned` が、ゴミ箱に入っているエントリだけを返す(`emdash-runtime.ts:3877-3892`) | 公式ドキュメントのみ |
| 12 | `usage` は、参照元が無ければ `no_owner`、あれば `in_use` → `owner_deleted` → `detached` の順で最初に見つかった状態 | 参照元がゴミ箱から戻されると画像がまた必要になるので、`owner_deleted` を `detached` より先にする | 推測のみ(設計判断) |

### 仕様書の変更

- 5.1: 画像エントリの値から `id` を外し、`meta.quality` を加えた。理由(決定 1・2)を書いた。
- 5.2: `id` の規則(決定 7)と、`alt` をコードポイントで数えること(決定 5)を書いた。
- 5.3・6.4・8 章①: サムネイルの上限を「data URL の長さで 8,000 バイト以下(WebP 本体で 5,982 バイト以下)」に揃えた(決定 3。書き方が食い違っていたため)。
- 7 章: 入力に `quality` を加え、応答 `{ ref }` とエラーの形(決定 8)を書いた。
- 9 章: 画像エントリ自身の状態(決定 11)を書いた。
- 13.2: 範囲の列と、丸めの規則・理由(決定 6)を書いた。

### テスト

- `tests/shared/schema.test.ts`: 109 件。参照・ギャラリー・画像エントリ・`imageRefs`・各ルートの入出力の正常な値・境界値・不正な値、options の補完と丸め、widget の判定、エラーコード、応答の包み。型のテスト(tsc で確かめる)は、`MediaValue` への代入、type guard の絞り込み、ルートの `input` への代入、permission の型。
- コードを一時的に壊して、テストが失敗することを確かめた(9 種類はテストが失敗、2 種類は tsc が失敗)。根拠: 実測のみ
  - テスト: alt の上限を外す / 参照を `z.object` にする / data URL の ASCII 制約を外す / 画像エントリに `id` を許す / 一覧の `entryStatus` を省略可能にする / `minEdge` を `maxEdge` で丸めない / 継承したプロパティを読む / 整数の項目を切り捨てない / 名前だけで `Base64ImageError` と判定する
  - tsc: 画像エントリの `width` を文字列にする(`MediaValue` に代入できない)/ permission を `content:trash` にする
- `npm run verify`: build(tsc)・lint(oxlint・prettier)・test(3 ファイル 116 件)がすべて通った。

### 後続タスク向けのメモ

| タスク | メモ |
|---|---|
| [[T11-server-validation\|T11]] | 適用する上限は `normalizeFieldOptions(field.options)`、widget の判定は `getWidgetKind(field.widget)`。スキーマは data URL が ASCII で長さが固定上限以下であることだけを確かめる。接頭辞・base64・WebP・寸法は T04 の `parseWebpDataUrl` などで確かめる。長さは `.length` で比べてよい(ASCII のため)。エラーは `SERVER_ERROR_CODES` のコード |
| [[T12-input-decode\|T12]] / [[T13-encode-search\|T13]] / [[T23-upload-hook\|T23]] | `pipeline.ts` の `DecodeImage` / `CompressImage` / `CreateThumbnail` / `UploadImage` の形で作る。失敗は `Base64ImageError`(`CLIENT_ERROR_CODES`)、中断は `signal.reason` で reject する。GIF の注意は `NOTICE_CODES` の `GIF_FIRST_FRAME_ONLY`。圧縮結果の `quality` をアップロードの入力に入れる。アップロードの `filename` は 1〜255 文字なので、空なら省き、長ければ切り詰める |
| [[T14-admin-i18n-api\|T14]] | ルートは `ROUTES`、どれも POST + JSON。エラーの body は `routeErrorBodySchema`。文言は `KnownErrorCode`(このプラグインのコードと `HOST_ERROR_CODES`)について用意する。`details` は届かないので、上限の値などは画面が持つ値を差し込む。プレビュー取得は `PREVIEW_MAX_IDS` 件ずつ分けて送る |
| [[T15-site-resolve\|T15]] | 返す値の型は `ResolvedBase64Image`。seed で作った `b64_images` は保存 hook を通らないので、値は `base64ImageEntrySchema` で確かめてから使う |
| [[T16-reference-hook\|T16]] | 参照・ギャラリーのスキーマは形と固定上限(20 枚)だけ。フィールドの `maxItems` と重複と `imageRefs` の存在は T16 が確かめる。拒否は `ContentSaveRejectedError(message)` で、どのフィールドの何番目かを `message` に書く |
| [[T17-admin-data-routes\|T17]] | 応答の `items` は要求の ID から重複を除いて要求の順に並べ、見つからない画像は `null`。seed 由来の値は `base64ImageEntrySchema` で確かめ、合わなければ `null` にする。クエリ数を実測して `PREVIEW_MAX_IDS` を見直す |
| [[T18-upload-route\|T18]] | ルートの `input` に `uploadRequestSchema` を渡す(失敗は EmDash の `VALIDATION_ERROR`)。応答は `{ ref }`(`alt` は空)。`quality` は `meta.quality` に保存する |
| [[T20-owner-tracking\|T20]] | 参照元は `imageOwnerSchema`。`imageRefsRecordSchema` は `z.object` なので、読むと未知のキーは落ちる |
| [[T21-orphan-routes\|T21]] / [[T29-plugin-definition\|T29]] | 一覧の項目は `imageListItemSchema`。`entryStatus` を正しく 3 つに分けるには capability `content:restore` が要る(`restore` の権限も含む)。宣言しない場合は「`imageRefs` にあって `get` が `null`」をゴミ箱とみなすことになり、`missing` を区別できない([[emdash-plugin-content-api-constraints]]) |
| [[T25-images-page\|T25]] | 完全削除のボタンは `entryStatus === "trashed"` の画像にだけ出す。状態バッジは `usage` |
| [[T26-playground-pages\|T26]] | seed で `b64_images` を作るなら、ID は `entryIdSchema` の規則に合わせる([[#未解決・サブタスクの候補]] の 1 も参照) |

### 未解決・サブタスクの候補

1. seed で作った `b64_images` には `imageRefs` の記録ができない。seed はリポジトリを直接使うので、保存 hook を通らず、プラグインストレージも書かない(`references/emdash/packages/core/src/seed/apply.ts:670-684`。公式ドキュメントのみ)。[[T16-reference-hook|T16]] の存在確認(`imageRefs` にあること)で、seed の画像を参照する投稿の保存が拒否される。[[T26-playground-pages|T26]]・[[T31-e2e|T31]] で seed の画像を使うなら、アップロードのルートで作るか、`imageRefs` を補う処理が要る。
2. [[T13-encode-search|T13]] のノートの「サムネイル生成(長辺 96px 程度、8,000 バイト以下)」は、data URL の長さの意味に揃えるとよい(このタスクで変更してよいファイルではない)。
3. プレビュー取得は 1 回 10 件なので、20 枚のギャラリーは 2 回に分かれる(仕様書 11.2 の「まとめて1回で」は 10 枚までになる)。[[T17-admin-data-routes|T17]] がクエリ数を実測してから、上げるかを決める。
4. 仕様書 8 章①の行は [[T04-webp-utils|T04]] も変更している可能性がある。マージのときに衝突しうる。
