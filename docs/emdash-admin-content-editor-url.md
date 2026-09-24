---
title: EmDash 0.39.1 の管理画面の編集画面の URL と、widget からアップロードの保存先を求める方法
aliases:
  - 管理画面の編集画面の URL
  - アップロードの保存先(target)の求め方
  - widget から collection・エントリ ID・ロケールを知る方法
tags:
  - docs
  - emdash
  - admin
  - widget
source_task: "[[T23-upload-hook]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 の管理画面の編集画面の URL と、widget からアップロードの保存先を求める方法

> [!summary] 要点
> - plugin widget の props には、コレクション・エントリ ID・ロケールが入らない([[emdash-plugin-content-api-constraints#plugin widget に渡る props]])。アップロードの `target` は、**管理画面の URL** と、props の **`id`(`field-<slug>`)** から求める。根拠: 公式ドキュメントのみ
> - 編集画面の URL は、新規作成が `/_emdash/admin/content/<collection>/new`、既存のエントリ(翻訳を含む)が `/_emdash/admin/content/<collection>/<エントリ ID>`。管理画面の起点 `/_emdash/admin` は固定。根拠: 公式ドキュメントのみ(`references/emdash/packages/admin/src/router.tsx:689`・`:835`・`:2814`)
> - `?locale=` は、**開き方によって付かない。** 一覧・翻訳の切り替え・新規作成の保存のあとは、エントリの保存済みのロケールが付く。ダッシュボード・コマンドパレット・サイトのツールバーから開くと付かない。根拠: 公式ドキュメントのみ
> - 2 つ目の部分(`$id`)には slug も入りうる(標準 API は ID と slug のどちらでも引く)。管理画面の中の移動は ID を使う。根拠: 公式ドキュメントのみ
> - `?locale=` の値は、ルーター(TanStack Router)が `true` / `false` / 数値に変換し、JSON として読めれば `JSON.parse` する。管理画面は文字列のときだけ使う。`src/admin/hooks/upload-target.ts` の `readRouterSearchString` は、`JSON.parse` だけを試して、文字列かどうかについて同じ結果を出す。根拠: 実測+公式ドキュメント(テストで確かめた。インストールされた `@tanstack/router-core` 1.163.2 のソース)
> - [[T23-upload-hook|T23]] は、**`entryId` と `locale` を組にして、URL に両方があるときだけ送る**ことにした(アップロード用ルートの参照元の記録。[[T18-upload-route#T23 が使う応答|T18]])。
> - 関連: [[base64-image-plugin-spec#7. アップロード(書き込み経路)|仕様書 7 章]]、[[emdash-plugin-upload-route]]、[[T27-image-widget]]、[[T28-gallery-widget]]

## 編集画面のルート

EmDash 0.39.1 の管理画面(`@emdash-cms/admin`)は TanStack Router の SPA で、起点(`basepath`)は `/_emdash/admin` に固定されている。サイトの設定では変えられない。根拠: 公式ドキュメントのみ

| 画面 | パス | 検索パラメーター | ソース |
|---|---|---|---|
| 新規作成 | `/content/$collection/new` | `locale`(文字列のときだけ) | `packages/admin/src/router.tsx:687-695` |
| 既存のエントリの編集(翻訳も同じ) | `/content/$collection/$id` | `field`・`locale`(文字列のときだけ) | `packages/admin/src/router.tsx:833-842` |
| 起点 | `/_emdash/admin` | — | `packages/admin/src/router.tsx:2811-2816`、`packages/admin/src/App.tsx:38`、注入されるルート `packages/core/src/astro/integration/routes.ts:83` |

- ルーターは、静的な `/new` を `$id` より先に当てる。そのため、2 つ目が `new` なら新規作成の画面。
- plugin の field widget が描かれるのは、この 2 つの画面の `ContentEditor` だけ(`FieldRenderer` の呼び出しは `packages/admin/src/components/ContentEditor.tsx:1379` の 1 か所)。
- widget の props の `id` は `field-${name}`(`ContentEditor.tsx:1791`)。`name` はトップレベルのフィールドの slug。

## `?locale=` が付く開き方と付かない開き方

| 開き方 | 付くか | 値 | ソース |
|---|---|---|---|
| コンテンツ一覧の行 | 付く | そのエントリの `locale`(DB の値。i18n の無いサイトでも列の既定値 `en`) | `components/ContentList.tsx:1269-1271`、`:1340-1342` |
| 一覧の「新規作成」 | i18n のサイトだけ付く | 一覧で選んでいるロケール | `components/ContentList.tsx:427-429` |
| 新規作成の保存のあと | 付く | 作ったエントリの `locale` | `router.tsx:725-731` |
| 翻訳の作成・切り替え | 付く | 翻訳のエントリの `locale`(ID も翻訳のもの) | `router.tsx:1351-1358`、`components/ContentSettingsPanel.tsx:1146-1148` |
| ダッシュボード(最近の項目・保存の失敗の通知) | 付かない | — | `components/Dashboard.tsx:165-166`、`:467-468` |
| ダッシュボードの「新規作成」 | 付かない | — | `components/Dashboard.tsx:259-261` |
| コマンドパレット | 付かない | — | `components/AdminCommandPalette.tsx:368-369` |
| サイトのツールバー(visual editing)の「管理画面で開く」 | 付かない | — | `packages/core/src/visual-editing/toolbar.ts:732`、`:953` |
| プラグインのリンク(`LinkTarget` の `content`) | ロケールがあれば付く | 指定したロケール | `lib/plugin-links.ts:7-8` |

- 根拠: 公式ドキュメントのみ(`references/emdash/packages/admin/src/` 以下。パスはそこからの相対)
- `?locale=` が無いとき、管理画面はエントリを ID で取得し(ID での取得はロケールを使わない)、保存にはエントリ自身の `locale`(`rawItem.locale`)を使う(`router.tsx:868-879`、`:1083`)。widget からは、このエントリのロケールは見えない。
- 同じエントリを `?locale=` と違うロケールで開けるのは、URL を手で書き換えたときだけ。

## `$id` に slug が入る場合

- 標準 API の取得は、ULID の形ならまず ID で、そうでなければまず slug で引く(`packages/core/src/database/repositories/content.ts:633-659`)。そのため、URL を手で `/content/posts/my-first-post` にしても編集画面が開く。
- 管理画面の中の移動と、ツールバー・プラグインのリンクは、どれもエントリ ID を使う。
- プラグインの `ctx.content.get` は ID だけで引く(`packages/core/src/plugins/content-access.ts:25-27`)。slug をエントリ ID として参照元に記録すると、未使用の判定([[T21-orphan-routes|T21]])でそのエントリは「削除された」ように見える。保存のときに正しい参照元が足される([[T20-owner-tracking|T20]])ので、使用中の画像が未使用に見えることはない(推測のみ)。
- `entryIdSchema`(英数字で始まり、英数字・`_`・`-` の 128 文字まで)は、`my-first-post` のような slug も通す。日本語の slug や `.` を含む slug は通らない。

## 検索パラメーターの読み方(TanStack Router)

管理画面のルーターの `parseSearch` は、`qss.js` の `decode` で値を変換し、残った文字列に `JSON.parse` を試す(`node_modules/@tanstack/router-core/dist/esm/qss.js`、`searchParams.js`。1.163.2)。管理画面の `validateSearch` は、`locale` が文字列のときだけ使う。根拠: 実測+公式ドキュメント(インストールされた `parseSearchWith(JSON.parse)` を Node 26 で動かし、下の表の値を得た。`tests/admin/hooks.test.ts` の `readRouterSearchString` のテストは、同じ入力で同じ結果を確かめる)

| URL の値 | ルーターが渡す値 | 管理画面の `locale` |
|---|---|---|
| `?locale=ja` / `?locale=en-US` | `"ja"` / `"en-US"` | その値 |
| `?locale=%22ja%22`(`"ja"`) | `"ja"`(`JSON.parse`) | `"ja"` |
| `?locale=true` / `?locale=false` / `?locale=1` | `true` / `false` / `1`(`qss.js` の `toValue`) | 使わない |
| `?locale=1e3` / `?locale=%2012`(` 12`) | `1000` / `12`(`toValue` は変換せず、`JSON.parse` が数値にする) | 使わない |
| `?locale=0x10` / `?locale=NaN` / `?locale=Infinity` | `"0x10"` / `"NaN"` / `"Infinity"`(どちらでも変換されない) | その値 |
| `?locale=null` / `?locale=%5B%22ja%22%5D` | `null` / `["ja"]` | 使わない |
| `?locale=ja&locale=en` | `["ja", "en"]`(配列) | 使わない |
| `?locale=` | `""` | `""`(既定ロケールにならない) |

- ルーターが文字列の値を URL に書くときは、`JSON.parse` できる文字列(`"123"` など)だけを JSON にする。ロケール(`ja`・`en-US`)は、そのまま `?locale=ja` になる。
- 表の値は、次のように確かめた(worktree の直下で `node` に渡す `.mjs`)。

```js
import { parseSearchWith } from "./node_modules/@tanstack/router-core/dist/esm/searchParams.js";
const parse = parseSearchWith(JSON.parse); // 管理画面のルーターと同じ(router-core の既定の parseSearch)
for (const search of ["?locale=ja", "?locale=1e3", "?locale=0x10", "?locale=ja&locale=en"]) {
	const value = parse(search).locale;
	console.log(search, JSON.stringify(value), typeof value === "string" ? "使う" : "使わない");
}
```

- `toValue` が変換するのは `"true"`・`"false"` と、JS の数値の標準の書き方(`+str + "" === str`)の文字列だけで、どれも `JSON.parse` でも文字列にならない。そのため、文字列かどうかだけを知りたいなら、`toValue` を真似ずに `JSON.parse` を試せば同じ結果になる。`readRouterSearchString` はこの形にした(変換を真似た処理を外しても、テストの結果が変わらないことをミューテーションテストで確かめた)。根拠: 実測+公式ドキュメント(`qss.js:11-16`、`searchParams.js:7-24`)

## T23 の決定(アップロードの `target`)

`src/admin/hooks/upload-target.ts` の `resolveUploadTarget(fieldId, location)` / `useUploadTarget(fieldId)`。

| 値 | 求め方 | 送らないとき |
|---|---|---|
| `collection` | パスの 1 つ目(パーセントエンコードを戻す)。`slugSchema` に合うこと | 合わなければ、コンテンツの画面ではない(`not-content-editor`)。アップロードは `INVALID_TARGET` で失敗 |
| `field` | `id` から `field-` を除いたもの。`slugSchema` に合うこと | 合わなければ `invalid-field-id`。アップロードは `INVALID_TARGET` で失敗 |
| `entryId` | パスの 2 つ目。`entryIdSchema` に合うこと | `new`、合わない値、または `locale` が無いとき |
| `locale` | `?locale=` をルーターと同じ規則で読んだ文字列。`localeSchema` に合い、35 文字まで | 無いとき、合わないとき、または `entryId` が無いとき |

- `entryId` と `locale` は組にする。アップロード用ルートは、`entryId` の参照元を `target.locale` で記録し、省くと既定ロケールで記録する。既定以外のロケールのエントリでは、保存のときの記録([[T20-owner-tracking|T20]])とロケールだけ違う参照元が増える。根拠: 実測のみ([[emdash-plugin-upload-route#参照元の記録(T20)との関係|T18 の実測]])
- `?locale=` の無い画面からは、参照元を送らない。参照元は、保存・自動保存・公開のときに T20 が、エントリ自身のロケールで記録する。アップロードしてから一度も保存しなかった画像は、「参照元なし」になる(仕様書 9 章の説明どおり)。
- 新規作成の画面では、`locale` も送らない。ルートは `target.locale` をサイトのロケールと照らし合わせ、合わなければアップロード全体を 400 `INVALID_TARGET` にする(i18n のサイトは設定のロケール、無いサイトは 35 文字まで)。`entryId` が無ければ、ロケールは何にも使われない。
- 35 文字は、ルートが i18n の無いサイトで受け付ける長さ。手で書き換えた長い `?locale=` でアップロードを失敗させないため、超えたらロケールは分からないとみなす。
- 描画のたびに `window.location` を読む。ルーターの移動(`history.pushState`)はイベントを出さないが、別のエントリ・翻訳・新規作成の保存のあとへ移ると widget は作り直される(`ContentEditor.tsx:1370-1377` のキー `${name}:${item?.id ?? "new"}`、新規作成と編集は別のルート)。戻る・進む(`popstate`)は購読する。根拠: 公式ドキュメントのみ(実際の管理画面での確認は [[T27-image-widget|T27]] / [[T31-e2e|T31]])

> [!note] 採らなかった案: 翻訳の一覧の API でロケールを引く
> `GET /_emdash/api/content/{collection}/{id}/translations`(権限 `content:read`)は、同じ翻訳グループのエントリの `{ id, locale, slug, status, updatedAt }` を返す。翻訳の無いエントリでも自分自身を 1 件返す(`packages/core/src/api/handlers/content.ts:2122-2182`、`packages/core/src/astro/routes/api/content/[collection]/[id]/translations.ts`)。`?locale=` の無い画面でも、これでエントリのロケールを引けば参照元を送れる。要求が 1 つ増え、標準 API の応答の形に頼ることになるので、最初の版では採らない。根拠: 公式ドキュメントのみ(実行はしていない)

## 確かめていないこと

- 実際の管理画面(playground)で、各画面の URL と、widget が作り直される時期は確かめていない。アップロードのルートは [[T29-plugin-definition|T29]] で登録され、widget は [[T27-image-widget|T27]] / [[T28-gallery-widget|T28]] で作られる。
