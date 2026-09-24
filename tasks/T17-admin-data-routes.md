---
id: T17
title: "管理画面用のデータ取得ルートを作る"
type: 実装
status: done
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/routes/admin-data.ts"
  - "tests/server/admin-data.test.ts"
spec:
  - "[[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)]]"
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T17 管理画面用のデータ取得ルートを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)|仕様書 11.4]]、[[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

widget のプレビューと、一覧のサムネイル列が使うデータ取得ルートを作る。

## 作業内容

- [x] プレビュー取得: 画像 ID(最大 `maxItems` 件)を受け取り、`ctx.content.get` で本体を返す(1リクエストのクエリ数上限 50 に注意する)
  - 1 回の要求は `PREVIEW_MAX_IDS`(10)件まで。`maxItems`(最大 20)件は、画面([[T14-admin-i18n-api|T14]])が 10 件ずつ並行に送る。上限は 1 呼び出し 1,000 クエリで([[T10-1-spec-d1-limits|T10-1]])、10 件で 21 クエリだった。
- [x] サムネイル取得: 画像 ID(最大 100 件)を受け取り、`imageRefs.getMany` で `thumb` を返す(バインド変数の上限を考えて分割する)
- [x] 権限は `content:read`

## 完了条件

- [x] 単体テスト(偽の ctx を使う)

## 変更してよいファイル

- `src/server/routes/admin-data.ts`
- `tests/server/admin-data.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/server/routes/admin-data.ts` に、`preview` と `thumbnails` のルート(`previewRoute` / `thumbnailsRoute`)とハンドラー(`handlePreview` / `handleThumbnails`)を作った。`tests/server/admin-data.test.ts` に 45 件のテスト(型のテストを含む)を書いた。
> - playground を複製した使い捨てのサイト(`spikes/admin-data/`、git 管理外)で、本物と同じプラグイン ID(`base64-image`)で動かし、ロールごとの権限・クエリ数・応答の大きさ・時間・body の上限・D1 のバインド変数の上限(node:sqlite で模擬)を測った。[[T14-admin-i18n-api|T14]] のクライアント(`fetchPreviews` / `fetchThumbnails`)でも呼べることを確かめた。
> - `PREVIEW_MAX_IDS` は 10 のままにした(変更なし)。仕様書 11.2・11.4 を直した。
> - 知見ノート: [[emdash-plugin-preview-thumbnail-routes]](計測の全データと再現手順)

### T29 がルートを登録する方法

spike で同じ形の `definePlugin` を動かして確かめた。根拠: **実測+公式ドキュメント**

```ts
import { previewRoute, thumbnailsRoute } from "./server/routes/admin-data";
import { IMAGE_REFS_STORAGE, PLUGIN_ID, ROUTES } from "./shared/constants";

definePlugin({
	id: PLUGIN_ID,
	capabilities: ["content:read" /* , アップロードなどが使うもの */], // preview は ctx.content.get を使う
	storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } }, // thumbnails は ctx.storage.imageRefs を使う
	routes: {
		[ROUTES.preview]: previewRoute, // POST /_emdash/api/plugins/base64-image/preview
		[ROUTES.thumbnails]: thumbnailsRoute, // POST /_emdash/api/plugins/base64-image/thumbnails
		// [ROUTES.upload]: uploadRoute(T18)、画像管理のルート(T21)
	},
});
```

- `content:read` が無いと `ctx.content` が無く、`preview` は 500 `INTERNAL_ERROR` になる(ログに `ctx.content is missing. Declare the "content:read" capability.`)。`imageRefs` を宣言しないと、`thumbnails` も 500 になる。
- T17 のルートは `content:restore` を使わない。

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | `PREVIEW_MAX_IDS` は 10 のまま | クエリは 10 件で 21(上限 1,000 に比べて小さい)。固定上限(500,000)の画像 10 件で、応答は 5.0MB、JS の処理は 3.5ms(新しいプロセスの 1 回目 5.6ms)。20 件だと 10.0MB、7.0ms(1 回目 10.5ms)で、Workers Free の CPU 時間 10ms を 1 回目で超える。画面は 10 件ずつ並行に送るので、待ち時間はほぼ増えない | 実測のみ(Node + SQLite)。Workers での CPU 時間は推測のみ |
| 2 | body の上限は「ID の最大数 × 最大の長さ(128 文字)の空白なしの JSON + 1 KiB」。`preview` 2,343、`thumbnails` 14,133 バイト | ID の最大数から計算する(リーダーの指定)。1 KiB は、空白や改行を入れて送るクライアントのため。宣言しないと、EmDash は body を上限なしに読む | 実測+公式ドキュメント(境界の 200 / 413 を、`Content-Length` ありと chunked の両方で確かめた) |
| 3 | `getMany` は 50 件ずつ(`IMAGE_REFS_BATCH_SIZE`)に分けて並行に呼ぶ | バインド変数は「ID の数 + 2」。D1 の上限(100)を模擬すると、98 件は通り、99 件から例外になった。EmDash の `SQL_BATCH_SIZE` と同じ値 | 実測+公式ドキュメント(D1 そのものでは未実測) |
| 4 | 見つからない画像は T03 のスキーマのとおり `null`。ゴミ箱と無い画像は区別しない。`getTrashedVersioned`(`content:restore`)は使わない | widget の表示は同じ(仕様書 11.2)。区別すると capability が増え、クエリも増える(ゴミ箱 +4、無い +2) | 公式ドキュメントのみ(クエリ数は [[T10-spike-after-save\|T10]] の実測) |
| 5 | `preview` は、公開していない画像(下書き・公開の取り消し)も `null` にし、警告ログを出す | サイトの取得は既定で `published` の行だけを読む(`references/emdash/packages/core/src/loader.ts:1233`)。widget の表示をサイトの表示と揃える | 実測+公式ドキュメント |
| 6 | `preview` の値は `base64ImageEntrySchema` と `src` の接頭辞(`data:image/webp;base64,`)で確かめ、合わなければ `null` と警告ログ([[T15-site-resolve\|T15]] と同じ) | seed や手での書き換えは保存 hook を通らない([[T03-shared-contracts#後続タスク向けのメモ\|T03 のメモ]])。外部の URL などを管理画面に読み込まない | 実測のみ(不正な値の画像を作って確かめた) |
| 7 | `thumbnails` は `thumbnailSchema`(`thumb`・`width`・`height`)と `thumb` の接頭辞だけを確かめ、ほかの項目(`owners` など)は返さない | `owners` が壊れていてもサムネイルは出せる。応答も小さくなる | 設計判断 |
| 8 | `thumbnails` は、ゴミ箱に入った画像・公開していない画像にもサムネイルを返す | `imageRefs` は完全削除のときにしか消えない([[T21-orphan-routes\|T21]])。区別するには `b64_images` を 1 件ずつ読む必要があり、100 行で最大 200 クエリと本体の読み込みになる | 実測+公式ドキュメント |
| 9 | 取得の失敗(データベースのエラー)は `null` にせず、そのまま投げる(500 `INTERNAL_ERROR`) | `null` にすると、widget が「画像が見つかりません」と表示し、編集者が参照を外してしまう | 設計判断 |
| 10 | ハンドラーの ctx は使う部分だけの型(`PreviewRouteContext` / `ThumbnailsRouteContext`)にした | 偽の ctx でテストしやすく、要る capability とストレージが型から分かる。EmDash の `RouteContext<…>` はこの型に代入できる | 実測のみ(`tsc` と型のテスト) |
| 11 | `get` と `getMany` は並行に呼ぶ | D1 では往復の待ち時間が重なる。SQLite では変わらない | 推測のみ(D1 での差は未実測) |
| 12 | ログと例外のメッセージには、プラグイン ID を付けない | EmDash の `ctx.log` が `[plugin:base64-image]` を付ける(付けると二重になった) | 実測のみ |

### 計測結果(要約)

全データは [[emdash-plugin-preview-thumbnail-routes]]。macOS 26.4、Apple M5 Pro、Node 26.10.0、emdash 0.39.1、Astro 7.3.3(`astro dev`、ポート 4417)、SQLite 3.53.4。

| 項目 | 結果 | 根拠レベル |
|---|---|---|
| 権限 | 両ルートとも、未ログイン 401、Subscriber・Contributor・Author・Editor・Admin は 200。`X-EmDash-Request` なしは 403 `CSRF_REJECTED`、GET は 405、件数の超過と 0 件は 400 `VALIDATION_ERROR` | 実測+公式ドキュメント |
| `preview` のクエリ数 | 1 + 見つかった画像 × 2 + 見つからない画像 × 1(1 件 3、10 件 21、10 件とも無い 11) | 実測+公式ドキュメント |
| `thumbnails` のクエリ数 | 1 + ceil(件数 / 50)(50 件 2、51 件 3、100 件 3) | 実測+公式ドキュメント |
| 応答の大きさ | `preview` 10 件: 1,001,785 バイト(既定の予算)/ 5,001,795 バイト(固定上限)。`thumbnails` 100 件: 最大 808,835 バイト | 実測のみ |
| JS の処理だけの時間(定常 / 1 回目) | `preview` 10 × 100,000: 0.66 / 1.98ms、10 × 500,000: 3.48 / 5.64ms、20 × 500,000: 6.95 / 10.50ms。`thumbnails` 100 × 8,000: 0.56ms | 実測のみ |
| D1 のバインド変数(模擬) | 分けない `getMany` は 98 件まで。`thumbnails` の 100 件(50 件ずつ)は成功 | 実測+公式ドキュメント |
| T14 のクライアント | `fetchPreviews`(21 件)は 10 件ずつ 2 回を並行に送り、要求の順で 20 件を返した。`fetchThumbnails`(150 件)は 100 件と 50 件の 2 回 | 実測のみ |

### 画像の作り方(T18 の前)

spike のプラグインの補助のルートで、`ctx.content.create("b64_images", { image })` → `ctx.content.getVersioned` → `ctx.content.publish` で作り、`ctx.storage.imageRefs.put(id, record)` で記録を書いた(capability は `content:read` / `content:write` / `content:publish`、ストレージ `imageRefs`)。下書きは公開しないで残し、公開の取り消しは `getVersioned` → `unpublish`、ゴミ箱は `ctx.content.delete` で作った。1 枚あたり約 72 クエリ(T10 と同じ)。コードは [[emdash-plugin-preview-thumbnail-routes#再現手順]]。

### テスト

- `tests/server/admin-data.test.ts`: 45 件。ルートの宣言(permission・メソッド・body・入力のスキーマ)、EmDash の `RouteContext` をハンドラーの ctx に代入できること(型)、body の上限(最大の入力が収まる・整形した JSON も収まる・上限が最大の body + 1 KiB・ID の最大の長さが 128 文字)、`preview`(値をそのまま返す・要求の順・重複・ゴミ箱と無い画像・公開していない画像・不正な値 8 通り・固定上限ちょうど・並行・失敗を投げる・`ctx.content` が無い・応答のスキーマ)、`thumbnails`(サムネイルと寸法だけ・要求の順・重複・無い画像・不正な記録 7 通り・`owners` が壊れていても返す・50 件ずつの分割・D1 の上限を模擬した偽物の `getMany`・重複を除いた件数で分割・並行・失敗を投げる・ストレージが無い・応答のスキーマ)。
- コードを一時的に壊して、テストが失敗することを確かめた(19 種類。すべて 1 件以上が失敗した)。根拠: **実測のみ**
  - 重複を除かない / `getMany` を 100 件ずつにする / 公開していない画像も返す / `src`・`thumb` の接頭辞を確かめない / 別のコレクションを読む / `get`・`getMany` を 1 件ずつ待つ / 取得の失敗を `null` にする / permission を変える / `input` を書き忘れる / body の上限を宣言しない / body の余裕を 0 にする / ID の最大の長さを 26 にする / 記録をそのまま返す / `getMany` の返す順に並べる / 不正な値を警告しない / `imageRefs` に無い画像も警告する / `ctx.content` が無くても失敗しない

### 仕様書の変更

- 11.2: 「保存済みの画像は、まとめて1回で取得する」を、「`preview` から 10 件ずつ分けて並行に取得する」に直し、理由(応答の大きさと CPU 時間)を書いた。`preview` が `null` を返す画像(ゴミ箱・削除・未公開・不正な値)を書いた。
- 11.4: `getMany` を 50 件ずつに分けること、100 行の応答の最大(約 810KB)を書いた。警告アイコンは「`imageRefs` に無い行」に出し、ゴミ箱に入った画像はサムネイルが出ることを書いた。

### 後続タスク・未解決

1. `src/shared/constants.ts` の `PREVIEW_MAX_IDS` の説明(「`ctx.content.get` は 1 件につき 2 クエリなので、D1 の 1 リクエスト 50 クエリに余裕を残す」)が古い。値は 10 のままでよいが、理由を「1 件最大 500,000 バイトで、応答の大きさと CPU 時間を抑えるため(10 件で 5MB・約 3.5〜5.6ms)」に直すとよい。[[T03-shared-contracts|T03]] のファイルなので変更していない(サブタスクの候補)。
2. 同じく [[emdash-plugin-content-api-constraints]](「`ctx.content.get` のクエリ数」の節) の「D1 の上限(1 リクエスト 50 クエリ)に余裕を残すため、プレビュー取得は 1 回 10 件まで。実測は T17 で行う」も古い(既存の知見ノートなので変更していない)。[[T03-shared-contracts#未解決・サブタスクの候補|T03 の未解決 3]] と [[T14-admin-i18n-api#後続タスク・未解決|T14 の後続 1]] は、このタスクで決着した。
3. 一覧の列で、ゴミ箱に入った画像も警告にするか(仕様書 11.4)。するなら、[[T21-orphan-routes|T21]] が `imageRefs` にゴミ箱の状態を記録する案がある(標準 API のゴミ箱は `content:afterDelete` の `permanent: false`、T21 のゴミ箱のルートは自分で記録し、復元は `content:afterRestore` で消す。[[emdash-after-save-payload]])。`thumbnailItemSchema`(T03)の変更も要る。利用者の判断が要る(推測のみ)。
4. Workers(workerd + D1)での CPU 時間とクエリ数は測っていない。[[T32-cloudflare-check|T32]] で、`preview` 10 件 × 500,000 の CPU 時間を確かめるとよい。
5. `preview` は ID だけで引く(ロケールで絞らない)。参照の `locale` が画像エントリのロケールと違っても表示するが、サイト([[T15-site-resolve|T15]])では表示されない。参照は [[T18-upload-route|T18]] が作るので、ふつうは起きない(推測のみ)。
6. 画面側([[T22-widget-parts|T22]]・[[T24-list-column|T24]]・[[T27-image-widget|T27]]・[[T28-gallery-widget|T28]])向け: `preview` の `null` は「画像が見つかりません」、`thumbnails` の `null` は警告アイコン。`preview` の失敗(500 など)は `null` ではないので、エラーとして表示する。
