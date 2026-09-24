---
title: EmDash 0.39.1 のコンテンツ一覧に、プラグインの列(contentListColumns)を足すときの呼ばれ方と注意
aliases:
  - contentListColumns の呼ばれ方
  - 一覧の列の collections の判定
  - 列の見出しの翻訳(Lingui の ID)
  - fetchManifest と Lingui
tags:
  - docs
  - emdash
  - admin
  - lingui
  - i18n
source_task: "[[T24-list-column]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 のコンテンツ一覧に、プラグインの列(contentListColumns)を足すときの呼ばれ方と注意

> [!summary] 要点
> - 列の `collections`(同期関数)は、一覧の画面の `useMemo` の中で呼ばれる。呼び直されるのは、コレクション・利用者のロール・プラグインの状態が変わったときだけ(描画のたびではない)。管理画面を読み込み直して一覧を開くと 2 回(ロールが読み込まれたとき)、ダッシュボードから SPA で移ると 1 回だった。
> - そのため、`collections` の中でマニフェストを非同期に取得しても、結果が届いたときに列は選び直されない。**管理画面の入口の読み込み時にマニフェストの取得を始めておく**と、最初に開いた一覧から正しく判定できた(しないと、フィールドの無いコレクションに空の列が出た)。
> - `@emdash-cms/admin` の `fetchManifest` は、応答を受け取ったあとで管理画面の Lingui(`i18n._`)を呼ぶ。入口の読み込み時は Lingui がまだ有効でなく、**`fetchManifest` は毎回失敗した**。同じ要求を `emdash/plugin-utils`(EmDash がプラグインの管理画面向けに用意した関数。Lingui を使わない)の `apiFetch` + `parseApiResponse` で送ると成功した。
> - 列の `label` は、管理画面が `i18n._(label)` で訳して見出しと `<th aria-label>` に使う。辞書のキーは Lingui が作る 6 文字の ID なので、**"Image" のような文字列は訳されない**(日本語の画面でも「Image」)。本番のビルドでは、描画のたびに「Uncompiled message detected!」が console に出た。辞書にある「Image」の ID(`hG89Ed`)を渡すと「画像」になり、警告も出なかった。
> - セルは行ごとに 1 つ作られ、どのセルにも同じ `visibleItems`(表示中のページの行。1 ページ 20 行)が渡る。要求は `visibleItems` の分を 1 回にまとめる。
> - 関連: [[T24-list-column]]、[[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)|仕様書 11.4]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17 章]]、[[emdash-admin-locale-lang]]、[[emdash-admin-api-requests]]、[[emdash-admin-plugin-ui-styling]]、[[emdash-plugin-preview-thumbnail-routes]]

> [!info] 計測の方法と環境
> - playground を複製した使い捨てのサイト(`spikes/list-column/site/`、git 管理外)に、本物と同じプラグイン ID(`base64-image`)で、`src/admin/ThumbnailColumn.tsx` の列を登録した。列は、呼ばれ方を記録する包みに入れた([[#再現手順]])。
> - Playwright(Chromium 153.0.8010.12、ヘッドレス)で管理画面を操作した。開発サーバー(`astro dev`)と、本番のビルド(`astro build` + `astro preview`)の両方で確かめた。ポートは 4424。
> - macOS 26.4(Darwin 25.4.0、arm64、Apple M5 Pro)、Node 26.10.0、`emdash` / `@emdash-cms/admin` 0.39.1、Astro 7.3.3、`@astrojs/node` 11.1.6、React 19.2.4、`@lingui/core` 5.9.5、Playwright 1.63.0。2026-09-24 に計測。
> - マニフェストの取得を、`@emdash-cms/admin` の `apiFetch` / `parseApiResponse` から `emdash/plugin-utils` のものに切り替えたあと、[[#collections が呼ばれる時]] と [[#列の中身(このプラグインの実測)]] の場面を開発サーバーと本番のビルドで測り直し、同じ結果だった。
> - 行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。

## 列の定義と、管理画面での使われ方

`ContentListColumnExtension`(`admin/src/lib/content-list-columns.tsx:23-38`)。根拠: **公式ドキュメントのみ**(下の表)。呼ばれ方は [[#collections が呼ばれる時]] で実測した。

| 項目 | 管理画面での使われ方 | 場所 |
|---|---|---|
| `id` / `label` / `cell` | 必須。どれかが不正な列は、警告を出して捨てる | `content-list-columns.tsx:79-120` |
| `label` | `i18n._(label)` の結果を、見出しの `<th aria-label>` と中身(`header` が無いとき)、`header` が失敗したときの代わりに使う | `admin/src/components/ContentList.tsx:1145-1169` |
| `collections` | 配列か同期関数。関数は try/catch で呼び、例外は `false`(console.error) | `content-list-columns.tsx:122-141` |
| `cell` | 行ごとに `<td>` の中で描く。props は `collection` / `item` / `locale` / `visibleItems`。`ContentListColumnBoundary` で包み、`key` にコレクション・ロケール・行の ID を含める(`resetKey` は `item.updatedAt`) | `ContentList.tsx:1296-1321` |
| `visibleItems` | 表示中のページの行(`paginatedItems`。1 ページ 20 行) | `ContentList.tsx:194`、`:324-327`、`:682` |
| 選び直し | `resolveContentListColumns(pluginAdmins, collection, userRole, pluginStates)` を `useMemo` で包む。依存は `[collection, pluginAdmins, pluginStates, userRole]` | `ContentList.tsx:382-385` |
| ロール・プラグインの状態 | `userRole={currentUser?.role ?? 0}`、`pluginStates={manifest.plugins}`。無効にしたプラグインの列は出ない | `admin/src/router.tsx:680-681`、`content-list-columns.tsx:157-159` |
| ゴミ箱のタブ | プラグインの列は出さない(見出しはタイトル・ロケール・削除日時・操作だけで、列の数も `trashColSpan = i18n ? 4 : 3`) | `ContentList.tsx:408`、`:752-803` |

- プラグインの管理画面のモジュールは、管理画面の起動時に静的に読み込まれる(`import * as admin0 from "<adminEntry>"`。`core/src/astro/integration/virtual-modules.ts:329-359`)。管理画面は `client:only="react"` なので、読み込まれるのはブラウザだけ(`core/src/astro/routes/admin.astro:143-148`)。根拠: 公式ドキュメントのみ
- 管理画面のマニフェストは、`AdminManifest.collections[slug].fields[slug]` に `kind`(型から決まる。`json` は `"json"`)と `widget` を持つ(`core/src/api/handlers/manifest.ts:37-54`、`:271-298`)。フィールドのキーの順はスキーマの順(`sort_order`。`core/src/schema/registry.ts:362-364`)。根拠: 公式ドキュメントのみ(一覧の列の判定で実測した)

## collections が呼ばれる時

列の `collections` を包んで、呼ばれた時刻(プラグインのモジュールを読み込んでからの ms)と結果を記録した。根拠: **実測+公式ドキュメント**

| 開き方 | 呼ばれた回数 | 結果(先読みなし) | 結果(先読みあり) |
|---|---|---|---|
| ダッシュボードを開き、サイドバーで Pages(フィールドなし)へ移る(SPA) | 1 回 | `true`(マニフェストがまだ)→ **空の列が出た**(3/3) | `false` → 列は出ない(3/3) |
| 同じく Posts(フィールドあり)へ移る | 1 回 | `true` → 列が出る | `true` → 列が出る |
| `/_emdash/admin/content/pages` を直接開く(読み込み直し) | 2 回(約 33ms と 66ms) | 1 回目 `true`、2 回目 `false` → 列は出ない(5/5) | 1 回目から `false`(5/5) |
| `/_emdash/admin/content/posts` を直接開く | 2 回 | `true`・`true`(5/5) | `true`・`true`(5/5) |
| Posts → Pages → Albums → Posts(SPA) | 移るたびに 1 回 | Pages は `false`、Albums・Posts は `true` | — |

- 「先読み」は、プラグインの管理画面のモジュールを読み込んだときにマニフェストの取得を始めること(このプラグインの `preloadThumbnailColumn()`)。
- 直接開いたときの 2 回目は、`userRole` が 0 から利用者のロールに変わったため(`useCurrentUser` の結果が届いた)とみられる。根拠: 推測のみ(依存の配列からの推論)。ダッシュボードから移るときは利用者がすでに読み込まれていて、2 回目が無い。
- どの場合も、セルは行の数だけ描かれ、`visibleItems` の長さは表示中の行の数(Posts の 1 ページ目は 20、2 ページ目は 5、Albums は 3)だった。

> [!warning] 非同期の結果を待って列を選び直させる方法は無い
> `useMemo` の依存(コレクション・`pluginAdmins`・`pluginStates`・`userRole`)は、プラグインからは変えられない。`collections` の中で例外を投げても `false` になる(Suspense の Promise も try/catch で捕まる)。そのため、判定に使うデータは、一覧を開くより前に手元にある必要がある。

## fetchManifest は、管理画面の Lingui が有効になる前に呼ぶと失敗する

`fetchManifest` は次のとおり(`admin/src/lib/api/client.ts:341-344`)。`apiFetch` の応答を待ったあとで、エラーの文言(`i18n._(msg\`Failed to fetch manifest\`)`)を、成功・失敗に関係なく作る。管理画面の Lingui は、`AdminApp` の最初の描画で有効になる(`admin/src/App.tsx:138-142`)。根拠: **実測+公式ドキュメント**

```ts
export async function fetchManifest(): Promise<AdminManifest> {
	const response = await apiFetch(`${API_BASE}/manifest`);
	return parseApiResponse<AdminManifest>(response, i18n._(msg`Failed to fetch manifest`));
}
```

| 呼び方(プラグインのモジュールの読み込み時) | 結果 |
|---|---|
| `fetchManifest()`(`@emdash-cms/admin`) | 約 5〜6ms 後に失敗(5/5。開発サーバーと本番のビルドの両方)。`Error: Lingui: Attempted to call a translation function without setting a locale.` |
| `@emdash-cms/admin` の `parseApiResponse(await apiFetch(\`${API_BASE}/manifest\`), "Failed to fetch the admin manifest")`(文言を渡す) | 成功(開発サーバー 3/3・5/5、本番のビルド 3/3) |
| `emdash/plugin-utils` の `parseApiResponse(await apiFetch("/_emdash/api/manifest"), "Failed to fetch the admin manifest")`(このプラグインの実装) | 成功(開発サーバー 3/3・5/5、本番のビルド 3/3) |

- `@emdash-cms/admin` の `parseApiResponse` は、文言を省くと既定値で `i18n._` を呼ぶ(`client.ts:329-339`)。失敗のときの `throwResponseError` が Lingui を使うのは、`SAVE_REJECTED` の特別な場合だけ(`client.ts:63-78`、`:98-116`)。根拠: 公式ドキュメントのみ
- `emdash/plugin-utils` の `apiFetch` と `parseApiResponse` は、管理画面のものと同じく CSRF のヘッダー(`X-EmDash-Request: 1`)を付け、応答の包み(`data`)を開く。Lingui は使わない(`core/src/plugin-utils.ts:27-31`、`:62-71`)。ビルド済みの `node_modules/emdash/dist/plugin-utils.mjs` は、ほかのモジュールを読み込まない 80 行のファイル。EmDash のドキュメントも、プラグインの管理画面ではこちらを使う例を示している(`react-admin.mdx:143`、`:283`、`:386`。`:386` は一覧の列の例)。根拠: 公式ドキュメントのみ(このプラグインで実測した)
- このプラグインは、`emdash/plugin-utils` を使う。管理画面の内部の変更で入口の読み込み時の取得が壊れることがなく、実行時に `@emdash-cms/admin` を読み込まない(型だけ)。jsdom で `src/admin/ThumbnailColumn.tsx` を読み込むと 115ms で、そのあとで `@emdash-cms/admin` を読み込むと 3,860ms かかった(列のモジュールが管理画面の本体を読み込んでいないことの確認)。根拠: 実測のみ
- jsdom の単体テストでも、管理画面の Lingui は有効になっていないので、`fetchManifest()` は同じく失敗する(`tests/admin/ThumbnailColumn.test.tsx` で確かめている)。
- ログイン画面(`/_emdash/admin/login`)も同じ管理画面のモジュールを読み込むので、先読みは 401 で失敗する。ログインに成功すると `window.location.href` で読み込み直す(`admin/src/components/LoginPage.tsx:186`、`:205`)ので、そこで先読みし直される。根拠: 公式ドキュメントのみ

## 列の見出し(label)と Lingui の ID

管理画面の辞書(`@emdash-cms/admin/dist/locales/<locale>/messages.mjs`)のキーは、Lingui がメッセージから作る 6 文字の ID(`@lingui/message-utils` の `generateMessageId`: `sha256(message + "\u001F" + context)` の base64 の先頭 6 文字)。`i18n._(label)` は、辞書に無い `label` をそのまま返す。根拠: **実測+公式ドキュメント**

| `label` | 日本語の画面の見出し(と `aria-label`) | 英語 | 「Uncompiled message detected!」(本番のビルド) |
|---|---|---|---|
| `"Image"` | Image(訳されない) | Image | 6 回(読み込みと、検索欄への入力で描き直したとき) |
| `"hG89Ed"`(「Image」の ID) | 画像 | Image | 0 回 |

- 「Image」は管理画面の辞書にある(`admin/src/locales/ja/messages.po` の `msgid "Image"` → `msgstr "画像"`。de は「Bild」、ar は「صورة」)。
- 警告は本番のビルドだけで出た。`@lingui/core` 5.9.5 は、`process.env.NODE_ENV !== "production"` のときだけメッセージのコンパイラーを設定し(`node_modules/@lingui/core/dist/index.mjs:266-268`)、コンパイラーが無いときは、訳が文字列なら `console.warn` する(`:395-410`)。辞書に無い `label` は、`label` の文字列そのものが訳として使われるので警告になる。開発サーバーでは 0 回だった。
- EmDash のドキュメントは「`Settings` のようなラベルは、管理画面に訳があれば使われる」としている(`docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx:225`。ページのラベルについての記述。`admin/src/components/Sidebar.tsx:321-331` のコメントも同じ)。一覧の列の `label` では、0.39.1 の辞書のキーが ID なので、文字列のままでは訳されなかった。
- ページのラベル(サイドバーとコマンドパレット)も、同じく `i18n._(label)` を通る(`Sidebar.tsx:333-341`、`:497`、`AdminCommandPalette.tsx:259`、`:298`)。文字列のラベルは訳されず、本番のビルドでは同じ警告が出るとみられる。根拠: 推測のみ(ページのラベルでは確かめていない)
- ドキュメントには、プラグインが自分の辞書を共有の Lingui に `i18n.load` で読み込み、言語が変わったら読み込み直す方法もある(`react-admin.mdx:225-262`。`@lingui/core` を peerDependencies に入れる)。このプラグインは `@lingui/core` を依存に持たないので採らなかった。なお、ドキュメントの例のように訳を文字列で読み込むと、本番のビルドでは辞書にあっても同じ警告が出る(コンパイラーが無いとき、訳が文字列なら警告する。`node_modules/@lingui/core/dist/index.mjs:395-410`。管理画面の辞書の訳は `["画像"]` のような配列)。根拠: 公式ドキュメントのみ(Lingui のソース。実行はしていない)
- ID を使うと、EmDash の辞書から「Image」が消えたとき、見出しに ID(`hG89Ed`)がそのまま出る。このプラグインは、インストールした `@emdash-cms/admin` の辞書に ID があることを単体テストで確かめている(EmDash を上げたときに気付ける)。

## 列の中身(このプラグインの実測)

`src/admin/ThumbnailColumn.tsx` を登録したサイトで確かめた。posts 25 件(2 ページ)、albums 3 件、pages 2 件。根拠: **実測のみ**(開発サーバーと本番のビルドで同じ結果)

| 確かめたこと | 結果 |
|---|---|
| Posts の 1 ページ目(20 行、画像 8 枚) | `thumbnails` の要求は 1 回・8 件。`Server-Timing` の `db.count` は 2 |
| 同じページに戻る・2 ページ目(取得済みの画像だけ)・1 ページ目に戻る | 要求なし(1 分以内) |
| マニフェストの要求 | 管理画面の 1 回と、このプラグインの 1 回。どちらも `db.count` 7(開発サーバー) |
| ゴミ箱に移した画像を参照する行 | サムネイルが出る(`imageRefs` に残るため) |
| `imageRefs` の記録を消した画像を参照する行 | 警告アイコンと「画像が見つかりません(完全に削除されたか、記録がありません)」 |
| 参照の形でない値 / 未設定 / ギャラリーだけの行(cover が優先) | 警告アイコン / 「—」 / 「—」 |
| Albums(ギャラリーだけ) | 1 枚目と「+3」(読み上げは「ほか 3 枚」)、空のギャラリーは「—」 |
| 見た目 | 40px の正方形(EmDash のメディアライブラリの一覧と同じクラス)。行の高さは、サムネイルのある行で約 65px |
| console の警告・エラー | なし(React の警告を含む) |

## jsdom で `@emdash-cms/admin` を読み込むとき

- `@emdash-cms/admin` の入口(`dist/index.js`)は、vitest の jsdom で読み込める。時間は約 2.3〜3.9 秒(ルーターや TanStack Query などを含む)。このプラグインのテストでは、`fetchManifest` と比べるテスト(`tests/admin/ThumbnailColumn.test.tsx`)だけが読み込む。根拠: 実測のみ
- 読み込むと、Node 26 が `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.` を 1 回出す(テストは失敗しない)。根拠: 実測のみ
- `fetch` は呼ぶときに読むので、`vi.stubGlobal("fetch", …)` で差し替えると、`apiFetch` も差し替えた `fetch` を使う(管理画面のものは `client.ts:17-21`、`emdash/plugin-utils` のものは `core/src/plugin-utils.ts:27-31`)。根拠: 実測+公式ドキュメント

## 再現手順

1. playground の `tsconfig.json` と `src/` を `spikes/list-column/site/` に複製し、`package.json` には playground と同じ `dependencies`(プラグイン本体の `file:..` を除く)を書く。seed は、`b64_images`・`posts`(`title`・`gallery`(ギャラリー)・`cover`(単一画像)の順)・`albums`(`photos`)・`pages`(`title` だけ)にした。
2. `astro.config.mjs` の `plugins` に、本物と同じ ID で登録する。

```js
emdash({
	database: sqlite({ url: "file:./data.db" }),
	plugins: [
		{
			id: "base64-image",
			version: "0.0.0",
			entrypoint: "/plugins/list-column-spike.ts", // thumbnails ルート(T17)と、画像を作る補助のルート
			adminEntry: "/plugins/list-column-admin.tsx",
			options: {},
		},
	],
	fonts: false,
});
```

3. 管理画面の入口(抜粋)。`localStorage` の値で、先読みと `label` を切り替えた。

```tsx
// spikes/list-column/site/plugins/list-column-admin.tsx
import { preloadThumbnailColumn, showsThumbnailColumn, thumbnailColumn } from "../../../../src/admin/ThumbnailColumn";

const log = { start: performance.now(), predicateCalls: [] as { collection: string; result: boolean; at: number }[] };
(window as unknown as { __T24: typeof log }).__T24 = log;
if (localStorage.getItem("t24-preload") === "1") preloadThumbnailColumn();

export const contentListColumns = [
	{
		...thumbnailColumn,
		label: localStorage.getItem("t24-label") ?? thumbnailColumn.label,
		collections: (collection: string) => {
			const result = showsThumbnailColumn(collection);
			log.predicateCalls.push({ collection, result, at: Math.round(performance.now() - log.start) });
			return result;
		},
	},
];
export const fields = {};
```

4. `cd spikes/list-column/site && node ../../../node_modules/astro/bin/astro.mjs dev --port 4424` で起動する(エージェントから実行するとバックグラウンドになる。[[astro-dev-background-for-agents]])。本番のビルドは `… astro.mjs build` のあと `… astro.mjs preview --port 4424`。開発サーバーで作ったログインのセッション(`storageState`)は、`preview` でもそのまま使えた。
5. Playwright で `/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` を開いてログインし、補助のルートで画像(`b64_images` の作成・公開と `imageRefs` の記録)を作り、標準 API(`POST /_emdash/api/content/<collection>`)で投稿を作る。日本語は cookie `emdash-locale=ja`(`Path=/_emdash`)。歓迎のダイアログ(日本語は「はじめる」)を閉じてから操作する。
6. 一覧の `<th aria-label="画像">` の位置から、各行の `<td>` の中身(`img`・`.sr-only`・`title`)を読み、`window.__T24.predicateCalls` と、`/_emdash/api/manifest`・`…/thumbnails` の要求を数える。
7. 最後に `… astro.mjs dev stop`(または `preview stop`)で止め、`lsof -nP -iTCP:4424 -sTCP:LISTEN` で何も出ないことを確かめる。
