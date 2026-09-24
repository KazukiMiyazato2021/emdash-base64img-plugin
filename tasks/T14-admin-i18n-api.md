---
id: T14
title: "管理画面の文言(i18n)と API クライアントを作る"
type: 実装
status: done
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
soft_depends_on: []
blocks:
  - "[[T22-widget-parts]]"
  - "[[T23-upload-hook]]"
  - "[[T24-list-column]]"
  - "[[T25-images-page]]"
files:
  - "src/client/i18n.ts"
  - "src/client/error-messages.ts"
  - "src/client/api.ts"
  - "tests/client/api.test.ts"
spec:
  - "[[base64-image-plugin-spec#11.1 共通方針]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T14 管理画面の文言(i18n)と API クライアントを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]
> - このタスクを待つもの: [[T22-widget-parts|T22]]、[[T23-upload-hook|T23]]、[[T24-list-column|T24]]、[[T25-images-page|T25]]
> - 仕様: [[base64-image-plugin-spec#11.1 共通方針|仕様書 11.1]]

## 目的

管理画面側の各タスクが共通で使う、文言と通信処理を用意する。

## 作業内容

- [x] 文言の仕組み: `<html lang>` で日本語と英語を切り替える(どちらでもなければ英語)。各部品が自分のファイル内に ja / en の辞書を持てるヘルパーにする
- [x] エラーコードに対応する文言(ja / en)
- [x] API クライアント: アップロード、プレビュー取得、サムネイル取得、画像管理(一覧・ゴミ箱)、標準の完全削除 API(`DELETE /_emdash/api/content/b64_images/{id}/permanent`)
- [x] CSRF ヘッダー `X-EmDash-Request: 1` の付与と、エラーコードから文言への変換

## 完了条件

- [x] 単体テスト(fetch をモックにする)

## 変更してよいファイル

- `src/client/i18n.ts`
- `src/client/error-messages.ts`
- `src/client/api.ts`
- `tests/client/api.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/client/` に i18n / error-messages / api の 3 ファイルを作り、`tests/client/api.test.ts` に 157 件のテスト(型のテストを含む)を書いた。変更してよいテストのファイルが 1 つなので、3 ファイル分のテストをまとめた。
> - EmDash 0.39.1 のソースで送り方とエラーの形を確かめ、playground(Chromium)で実際に呼んで確かめた。管理画面の言語を変えると、再読み込みせずに `<html lang>` が変わることも実測した。
> - 知見ノート: [[emdash-admin-api-requests]](送り方・層ごとのエラー・完全削除 API)、[[emdash-admin-locale-lang]](言語と `<html lang>`)
> - T03 のファイル(`src/shared/*`)は変更していない。

### 主な export

| ファイル | export |
|---|---|
| `src/client/i18n.ts` | `LOCALES` / `Locale`、`DEFAULT_LOCALE`、`resolveLocale`、`getDocumentLocale`、`subscribeDocumentLocale`、`useLocale`、`defineMessages`、`useMessages`、型 `Messages` / `MessageShape` / `MessageValue` / `WidenMessages` |
| `src/client/error-messages.ts` | `ERROR_MESSAGES`(`KnownErrorCode` のすべて)、`NOTICE_MESSAGES`(`NoticeCode`)、`UNKNOWN_ERROR_MESSAGES`、`getErrorCode`、`getErrorMessage`、`getNoticeMessage`、`useErrorMessage` |
| `src/client/api.ts` | `uploadImage`(型は `UploadImage`)、`fetchPreviews`、`fetchThumbnails`、`listImages`、`trashImage`、`deleteImagePermanently`、`errorCodeForStatus`、`permanentDeleteResponseSchema` / `PermanentDeleteResponse`、`RequestOptions` |

### 後続タスクでの使い方

```tsx
import { deleteImagePermanently, fetchPreviews, fetchThumbnails, listImages, trashImage, uploadImage } from "../client/api";
import { getNoticeMessage, useErrorMessage } from "../client/error-messages";
import { defineMessages, useLocale, useMessages } from "../client/i18n";

// 部品の文言は、部品のファイルの中に持つ(T22・T24・T25・T27・T28)。ja の関数の引数には型を書く
const messages = defineMessages({
	ja: { select: "ファイルを選択", remaining: (count: number) => `あと ${count} 枚追加できます` },
	en: { select: "Select a file", remaining: (count) => `You can add ${count} more` },
});

function Example({ error }: { error: unknown }) {
	const t = useMessages(messages); // 言語が変わると再描画する
	const errorText = useErrorMessage(error); // error が null / undefined なら undefined
	const gifNote = getNoticeMessage("GIF_FIRST_FRAME_ONLY", useLocale());
	return <p>{errorText ?? t.remaining(3)}</p>;
}

// 通信(T23・T24・T25)。失敗は Base64ImageError、中断は signal.reason で reject する
const { ref } = await uploadImage(request, { signal }); // T23
const { items } = await fetchPreviews(ids, { signal }); // T23。重複を除き 10 件ずつ並行して送り、要求の順に返す
const { items: rows } = await fetchThumbnails(visibleIds, { signal }); // T24。100 件ずつ
const page = await listImages({ cursor }); // T25。次のページは page.nextCursor
await trashImage(id); // T25
await deleteImagePermanently(id); // T25。管理者のみ。ゴミ箱に入っていなければ NOT_FOUND
```

- テストでは、描画の前に `document.documentElement.lang = "ja"` を設定する。fetch は `vi.stubGlobal("fetch", mock)` で差し替える(`api.ts` は呼ぶときに `globalThis.fetch` を読む)。
- 中断されたときの reject の値は `signal.reason`(既定は `AbortError` の `DOMException`)。`getErrorMessage` に渡すと「予期しないエラー」になるので、画面は `signal.aborted` を見て、キャンセルをエラーとして出さない。
- `NOT_FOUND` の文言は「対象が見つかりません。すでに削除されたか、プラグインが無効…」。完全削除でゴミ箱に入っていない場合に別の文言を出したいときは、T25 が自分の辞書で補う。

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 言語は `<html lang>` の主言語のサブタグ(大文字・小文字を区別しない)で決める。`ja` → 日本語、それ以外 → 英語 | 管理画面には `en-GB` もある。`jv`(ジャワ語)のように `ja` で始まる別の言語を日本語にしない | 公式ドキュメントのみ(`packages/admin/src/locales/locales.ts:34-64`) |
| 2 | `useLocale()` は `useSyncExternalStore` と `MutationObserver`(`attributeFilter: ["lang"]`)で `lang` の変化に追随する。監視は購読の数によらず 1 つ | 管理画面は言語を変えると、再読み込みせずに `lang` を書き換える。plugin の部品は再描画されるとは限らない | 実測+公式ドキュメント([[emdash-admin-locale-lang]]) |
| 3 | 辞書は `defineMessages({ ja, en })`。ja から形を推論し、en は `NoInfer` で確かめる。キーの過不足・関数の引数の型の違いは型エラー | 各部品が自分のファイルに辞書を持つ(共有の辞書ファイルを作らない)。漏れを tsc で見つける | 実測のみ(`@ts-expect-error` を tsc で確かめた) |
| 4 | エラーの文言は `Record<KnownErrorCode, string>` の辞書。T03 にコードを足すと、tsc とテストの両方が失敗する | 指示のとおり。文言はコードだけで決める(`details` は届かない) | 実測のみ(コードを消すと tsc とテストが失敗した) |
| 5 | 401 は body に関係なく `UNAUTHORIZED`。エラーの形の body で、`SERVER_ERROR_CODES` / `HOST_ERROR_CODES` のコードならそれを使う。それ以外は HTTP ステータスから決める(`errorCodeForStatus`) | 標準 API の middleware は未ログインで `NOT_AUTHENTICATED`、セッションの利用者が消えたとき 401 `NOT_FOUND` を返す。外部の認証は `text/plain` | 実測+公式ドキュメント([[emdash-admin-api-requests]]) |
| 6 | 応答の `error.code` がブラウザ側のコード(`CLIENT_ERROR_CODES`)でも使わない | サーバーはそれらを返さない。`NETWORK_ERROR` などを誤って出さない | 設計判断 |
| 7 | リダイレクトは追わない(`redirect: "manual"`)。受け取ったら `UNAUTHORIZED` | EmDash が API の要求をリダイレクトするのは認証の middleware の例外のときだけ。Cloudflare Access などのログイン画面は別のオリジンで、追うと CORS で失敗し、通信のエラーと区別できない | EmDash の部分は公式ドキュメントのみ。Access の部分は推測のみ |
| 8 | 送る前に入力を T03 のスキーマで確かめ、合わなければ送らずに `VALIDATION_ERROR`。完全削除の ID も `entryIdSchema` で確かめる | 完全削除の ID は URL のパスに入る(`..` などで別のパスを指さない)。サーバーと同じスキーマなので結果は変わらない | 設計判断 |
| 9 | プレビューとサムネイルは、重複を除いて `PREVIEW_MAX_IDS`(10)/ `THUMBNAILS_MAX_IDS`(100)件ずつ並行して送り、要求の順につなげる。ID が空なら送らない | T03 の決定(10 件ずつ分けて送る)。並行にして待ち時間を 1 往復分にする | 設計判断 |
| 10 | `signal` は fetch に渡し、中断されたら(fetch・body の読み込みの失敗の理由に関係なく)`signal.reason` で reject する。送る前と body を読んだ直後にも確かめる | `src/shared/pipeline.ts` の約束 | 実測のみ(テスト) |
| 11 | `credentials: "same-origin"` を明示する | 管理画面の `apiFetch` は既定のまま(同じ値)。意図を書いておく | 公式ドキュメントのみ |
| 12 | 文言は、日本語は「です・ます」、括弧は半角(仕様書に合わせた)。HEIC の案内は仕様書 6.5 の文をそのまま含める | 仕様書 6.1・6.5・11.2 の画面の文言と揃える | — |

### テスト

- `tests/client/api.test.ts`: 157 件。`resolveLocale`・`<html lang>` の購読(解除・購読し直し・同じ関数の 2 回の購読)・`useLocale` / `useMessages` の再描画、`defineMessages` の型、すべてのエラーコードと注意のコードの ja / en の文言(ja は日本語を含み、en は含まない)、HEIC の案内、上限の差し込み、`getErrorMessage`、各関数の URL・メソッド・CSRF ヘッダー・`credentials`・`redirect`・body、成功と形が合わない応答、EmDash のコード、401、知らないコード、ステータスだけの応答、リダイレクト、通信のエラー、キャンセル(送る前・応答待ち・body の読み込み中・読み終えた直後)、送る前の入力の確認、ID の分割と順序。
- コードを一時的に壊して、テストが失敗することを確かめた(27 種類。すべて vitest が失敗し、うち 3 種類は tsc も失敗)。根拠: 実測のみ
  - api.ts: CSRF ヘッダーを付けない / `credentials` を変える / リダイレクトを追う / 401 を `UNAUTHORIZED` にしない / 応答のブラウザ側コードを受け付ける / fetch の失敗時・body を読んだ後に中断を確かめない / 413 の変換 / ID の重複を除かない / 塊の大きさ / 送る前の入力の確認をしない(ルート・完全削除)/ `opaqueredirect`・3xx を見ない / `data` の形を確かめない / 届いた順に items をつなげる
  - i18n.ts: `_` を区切りとして扱わない / 前方一致で比べる / 1 つの解除で監視を止める / 監視を作り直さない / 購読を包まない / `lang` 以外の属性で通知する / `useLocale` が購読しない
  - error-messages.ts: en の文言を 1 つ消す / ja の文言を英語にする / `code` を持つオブジェクトを読まない / MB を 2 進で数える

### 仕様書の変更

- 11.1: 言語を変えると再読み込みせずに `<html lang>` が変わり、部品が `useLocale()` で追随することを 1 行加えた(決定 2)。

### マージ前の修正(リーダー)

チームメイトの分岐元(`7d6825b`)のあとで、`phase/2` に [[T04-1-consumer-typecheck|T04-1]](利用者のサイトの設定の代わりの型チェック)が入った。`phase/2` を取り込むと、`src/client/api.ts` が 3 件のエラーになったので、リーダーが直した。根拠: **実測のみ**

- 緩い設定(`strict: false`): 包みと `data` の検証の結果を 1 つの変数にまとめていたため、`!parsed.success` で絞り込まれなかった → 包みと `data` を順に `=== false` で判別する形にした
- 厳しい設定(`exactOptionalPropertyTypes`): `RequestOptions` の `signal` に `undefined` を渡せなかった → `signal?: AbortSignal | undefined` にした。`fetch` の `RequestInit` に `body: undefined` / `signal: undefined` を入れていた → 値があるときだけ入れる形にした(送る内容は同じ)
- 直したあと、3 つの設定の型チェックと、`tests/client/api.test.ts` の 157 件が通った。

### 後続タスク・未解決

1. `fetchPreviews` は 1 回 10 件なので、20 枚のギャラリーは 2 回に分かれる(並行)。仕様書 11.2 の「まとめて1回で取得する」とずれる。件数は [[T17-admin-data-routes|T17]] がクエリ数を実測して決める([[T03-shared-contracts#未解決・サブタスクの候補|T03 の未解決 3]])。仕様書 11.2 は、T17 の結果とあわせて直すのがよい。
2. `HOST_ERROR_CODES` に無い EmDash のコード(`NOT_AUTHENTICATED` / `ACCOUNT_DISABLED` / `INVALID_TOKEN` / `INVALID_PLUGIN_ROUTE` / `RATE_LIMITED` など)は、HTTP ステータスから変換しているので、T03 の変更は要らない。元のコードは `details.responseCode` に残る。
3. Cloudflare Access の期限切れで、API の要求がどう返るか(リダイレクトか 401 か)は確かめていない。[[T32-cloudflare-check|T32]] で Access を使うなら確かめられる。
4. プラグインのルートがまだ無いので(T29 の前)、`uploadImage` などの成功は実物では確かめていない(モックのテストだけ)。E2E([[T31-e2e|T31]])で確かめる。
