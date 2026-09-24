---
title: playground のサイト側のページで確かめた描画・LCP・クエリ数と、アップロードのルートで作ったサンプルの投稿
aliases:
  - playground のページ
  - サイト側の描画の実物での確認
  - resolveBase64Images の実物での確認
  - getEmDashEntry の LiveEntryNotFoundError
tags:
  - docs
  - emdash
  - site
  - playground
  - performance
source_task: "[[T26-playground-pages]]"
created: 2026-09-24
updated: 2026-09-24
---

# playground のサイト側のページで確かめた描画・LCP・クエリ数と、アップロードのルートで作ったサンプルの投稿

> [!summary] 要点
> - playground に投稿の一覧(`/posts/`)と詳細(`/posts/<slug か ID>/`)を作った。どちらも、ページで使う参照を集めて `resolveBase64Images`([[T15-site-resolve|T15]])を 1 回だけ呼ぶ。
> - `emdash/ui` の `Image` に解決した値を渡すと、`<img src="data:image/webp;base64,…" width height alt loading="lazy" decoding="async">` がそのまま出る。`priority` を付けると `loading="eager"` と `fetchpriority="high"` になる。`data-*` の属性も `<img>` に付く。根拠: 実測+公式ドキュメント
> - Chromium 153・Firefox 155 で、すべての `<img>` の data URL がデコードされ、寸法が width / height 属性と一致し、表示の縦横比も一致した。Chromium では、LCP の要素が `priority` の画像になり、Layout Shift は 0 回だった。根拠: 実測のみ
> - **ページのクエリは 2 本**(投稿 1、画像 1)だった。一覧 10 件でも、詳細の 11 枚(カバーとギャラリー 10 枚)でも同じ。プロセスで最初の画像の取得だけ、タクソノミーの定義の読み出しが 1 本増える(`where` を使うため)。根拠: 実測+公式ドキュメント
> - **`getEmDashEntry` は、見つからないときも `error`(Astro の `LiveEntryNotFoundError`)を返す**。EmDash の型の説明(「見つからないときは設定しない」)と違う。`error` があるだけで 500 にすると、存在しない URL が 500 になる。根拠: 実測+公式ドキュメント
> - アップロードのルートで画像を作るサンプルのスクリプト(`playground/scripts/create-sample-posts.ts`)を、ルートと hook を一時的に登録した使い捨てのサイトで動かした。114 枚すべてが `imageRefs` に記録され、参照元も 1 件ずつ記録された。作った投稿は管理画面で保存できた。根拠: 実測のみ
> - 関連: [[T26-playground-pages]]、[[base64-image-plugin-spec#12. サイト側の描画|仕様書 12 章]]、[[T15-site-resolve]]、[[emdash-query-count-b64-images]]、[[emdash-plugin-upload-route]]、[[T16-reference-hook#seed の画像の扱い|T16]]、[[playground/README|playground の README]]、[[e2e-input-image-fixtures]]

> [!info] 確かめた方法と環境
> - playground の開発サーバー(`astro dev --port 4426`)と、ルートと hook を登録した使い捨てのサイト(`spikes/t26-pages/site/`、git 管理外。[[#再現手順]])。ページのファイルは同じもの(`diff -r` で確かめた)。
> - ページは Playwright(Chromium 153.0.8010.12 の headless shell、Firefox 155.0)で開き、下までスクロールして遅延読み込みの画像も読み込ませてから調べた。クエリ数は応答の `Server-Timing` の `db.count` と、`EMDASH_QUERY_LOG=1` のログで数えた。
> - macOS 26.4(25E246、Apple M5 Pro)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、`@astrojs/node` 11.1.6、Playwright 1.63.0。2026-09-24 に計測。
> - 行番号は `references/emdash/packages/core/src/` 以下(タグ `emdash@0.39.1`)。引用した `query.ts`・`loader.ts`・`components/EmDashImage.astro` は、インストールされた `node_modules/emdash/src` と同一だった(`cmp`)。Cloudflare(workerd + D1)では確かめていない([[T32-cloudflare-check|T32]])。

## ページの作り

| ページ | 取得 | 解決する参照 | `priority` |
|---|---|---|---|
| `/posts/` | `getEmDashCollection("posts", { limit: 10, cursor, orderBy: { published_at: "desc" } })` | 表示するエントリのカバー | 描画できる最初のカバー |
| `/posts/<slug か ID>/` | `getEmDashEntry("posts", decodeSlug(Astro.params.slug))` | カバーとギャラリー | カバー。カバーの無い投稿では、描画できる最初のギャラリーの画像 |

- `json` フィールドの値はサイトの型で `unknown` なので、`isBase64ImageRef` で参照の形のものだけを集める。ギャラリーは 1 枚ずつ確かめ、形の正しいものだけを並べる(`isBase64ImageGallery` だと、1 枚の不正で全部が消える)。
- 一覧のリンクは `entry.id`(slug。slug が無ければエントリ ID。`loader.ts:1443-1449`)を `encodeURIComponent` し、詳細は `decodeSlug` で戻す。EmDash のテンプレート(`templates/blog/src/pages/posts/`)と同じ形。`getEmDashEntry` は slug と ID のどちらでも引ける(`loader.ts:1545-1586`)。根拠: 公式ドキュメントのみ
- 画像が見つからないときは、参照の寸法(`aspect-ratio`)で場所を取った「画像が見つかりません」の枠を出す。`resolveBase64Images` が警告ログ(`[base64-image] 1 image(s) not found in "b64_images" (locale "en"); not rendering: …`)を出すことも確かめた。根拠: 実測のみ
- 共通の部品(レイアウトと画像 1 枚分の部品)は `src/pages/_components/` に置いた。`_` から始まるディレクトリはルートにならない(Astro の規則)。T26 で変更してよいのが `src/pages/**` だけのため。

## 出力される `<img>`

実際の HTML(data URL は長さだけにした)。根拠: 実測+公式ドキュメント(`components/EmDashImage.astro:139-156` は `src` があれば `buildResponsiveImage` に渡し、`media/responsive.ts:127` は http(s) 以外を `null` にするので、変換されずに `<img>` になる。`:253-258` が `loading` / `fetchpriority` / `decoding` と残りの属性)

```html
<!-- priority あり -->
<img src="data:image/webp;base64,…(22015 chars)" width="1280" height="853" alt="…のカバー画像"
  loading="eager" fetchpriority="high" decoding="async" class="emdash-image-media …"
  data-field="cover" data-image-id="01M390KVQQTZY6Z9CHXW0JWY63">
<!-- priority なし・代替テキストが空 -->
<img src="data:image/webp;base64,…(15639 chars)" width="600" height="800" alt
  loading="lazy" decoding="async" class="emdash-image-media …" data-field="gallery" data-image-id="…">
```

- `EmDashImage` の `.emdash-image-media { max-width: 100%; height: auto }` はコンポーネントの中のスタイル。カードの幅に合わせるため、playground ではレイアウトの global なスタイルで `width: 100%` を足した。
- 画像エントリの `meta`(`{ v, bytes, quality }`)に `blurhash` / `dominantColor` は無いので、プレースホルダーの背景は付かない(`:198-208`)。

## ブラウザでの確認

`<img>` ごとに「`src` が `data:image/webp;base64,` で始まる」「width / height 属性がある」「`naturalWidth` × `naturalHeight` が属性と一致する」「表示の高さが `幅 × height / width` と 1px 以内で一致する」「読み込みが終わっている」を調べた。根拠: 実測のみ

| ページ(データ) | Chromium 153 | Firefox 155 |
|---|---|---|
| 一覧(10 件。うち 1 件はカバーをゴミ箱に移した、1 件はカバーなし) | 画像 8 枚すべて問題なし。代わりの枠 1。LCP は `priority` のカバー(3 件目)、Layout Shift 0 回 | 画像 8 枚すべて問題なし |
| 一覧の次のページ(`?cursor=`) | 画像 2 枚、問題なし | 同じ |
| 詳細(カバーとギャラリー 10 枚) | 11 枚すべて問題なし。LCP はカバー(613,440 px²)、Layout Shift 0 回 | 同じ(LCP は測っていない) |
| 詳細(カバーをゴミ箱に移した) | 10 枚問題なし、代わりの枠 1(960 × 639.8)。`priority` なし。LCP は見出し(ギャラリーは画面の外) | 同じ |
| 詳細(カバーなし、ギャラリー 3 枚) | 3 枚問題なし。LCP は `priority` のギャラリーの 1 枚目 | 同じ |
| 存在しない slug | 404、画像なし | 同じ |

- Layout Shift は、`PerformanceObserver`(`layout-shift`、`buffered: true`)で 0 件だった。width / height 属性で縦横比が決まり、遅延読み込みの画像も場所を取っているため。
- Firefox 155 は LCP と Layout Shift の API を調べていない(属性とデコードの確認だけ)。
- 開発サーバーで初めてブラウザが接続したとき、Vite が 1 回ページを読み直すことがあった(`page.evaluate` が「Execution context was destroyed」で失敗した)。`networkidle` を待ってから調べると起きなかった。E2E([[T31-e2e|T31]])でも、開いた直後の操作はこれに注意する。根拠: 実測のみ(読み直しの原因は確かめていない)

### LCP の対象の選び方

- 仕様書 12 章の例は `priority={i === 0}`(最初のカード)。最初のカードの画像がゴミ箱にあると、どの画像にも `priority` が付かない。一覧では、描画できる最初のカバーにした(同じ行に並ぶ次のカードの画像が LCP になるため)。
- 詳細では、カバーの画像が見つからなくても、代わりの枠がカバーの場所を取るので、ギャラリーは画面の外になり、LCP にならなかった(Chromium で見出しが LCP)。そのため、カバーの参照があればカバーだけを対象にし、カバーの無い投稿だけギャラリーの最初の画像を対象にした。根拠: 実測のみ(1280 × 800 の画面)

## クエリ数

`db.count` とログの SQL。根拠: 実測+公式ドキュメント

| ページ | db.count | 中身 |
|---|---|---|
| 一覧(カバー 10 件) | **2** | `ec_posts`(`getEmDashCollection`)1、`ec_b64_images`(`resolveBase64Images`)1 |
| 詳細(カバーとギャラリー 10 枚) | **2** | `ec_posts`(`getEmDashEntry`)1、`ec_b64_images` 1 |
| 詳細(カバーなし・ギャラリー 3 枚) | 2 | 同上 |
| プロセスで最初の一覧 | 4 | 上の 2 本に、`_emdash_redirects` と `_emdash_taxonomy_defs` が 1 本ずつ |
| 書き込みのあと・30 秒ごと | +1 | `_emdash_redirects`(リダイレクトのキャッシュは 30 秒で、書き込みでも破棄される) |

- `_emdash_taxonomy_defs`: `getEmDashCollection` に `where` を渡すと、キーがタクソノミーの名前かを調べるために、タクソノミーの定義を読む(`loader.ts:1273-1274`)。結果は `globalThis` に持つので、同じプロセスの 2 回目からは読まない(`:370-399`。分離したデータベースのときは毎回読む)。`resolveBase64Images` は `where: { id }` を使うので、プロセスで最初の 1 回だけ 1 本増える。[[T09-spike-query-count|T09]] の「1 回の呼び出しは 1 クエリ」は、暖機のあとの数。Workers では isolate ごとに 1 回と考えられる(推測のみ)。
- `_emdash_redirects`: `astro/middleware/redirect.ts:64-67` と `redirects/cache.ts:47`(`REDIRECT_CACHE_TTL_MS = 30_000`)。ページと関係なく、どのリクエストでも起きうる。
- 画像エントリは、アップロードのルートで作ると作成者の ID を持たない(`author_id` が null。114 枚すべて)。このサイトにはバイラインも無いので、バイラインの補完のクエリは出なかった([[emdash-query-count-b64-images]])。確認のために標準の REST API で作った画像(作成者あり)でも、バイラインの無いサイトでは 2 本だった。
- HTML の大きさ: 一覧 10 件で 212,672〜232,729 文字(サンプルのカバーは data URL で約 2.1 万文字)。詳細(カバーとギャラリー 10 枚)で約 19.8 万文字。

## getEmDashEntry は見つからないときも error を返す

`/posts/存在しない slug/` で `getEmDashEntry` は `{ entry: null, error }` を返し、`error.name` は `LiveEntryNotFoundError`(メッセージ「Entry _emdash → … was not found.」)だった。根拠: 実測+公式ドキュメント

- Astro の `getLiveEntry` は、ローダーが何も返さないと `LiveEntryNotFoundError` を返す(Astro 7.3.3 の `node_modules/astro/dist/content/runtime.js:296-300`)。EmDash の `getEmDashEntry` は、その `error` をそのまま返す(公開の経路 `query.ts:1009-1010`、下書きの経路 `:941-942`)。
- 型の説明は「見つからないときは設定しない(本当の失敗のときだけ)」(`query.ts:297`、`:846`)で、実際と違う。EmDash のテンプレートは `error` を見ずに、`entry` が無ければ `/404` へ転送している。
- playground の詳細ページは、`error.name` が `LiveEntryNotFoundError` のときは 404、ほかの `error` は 500 にした。最初は「`error` があれば 500」にしていて、存在しない URL が 500 になった。

## seed の画像を使わない理由

[[T26-playground-pages#結果|T26 の決定]]。seed には `b64_images` の画像も、それを参照する投稿も入れない。

- seed の画像は保存 hook を通らず、`imageRefs` に記録が無い。プラグインの保存 hook が登録されると([[T29-plugin-definition|T29]])、それを参照する投稿は、管理画面でタイトルだけを変えても保存できない(管理画面は毎回すべてのフィールドを送る)。根拠: 実測+公式ドキュメント([[T16-reference-hook#seed の画像の扱い|T16]] の実測)
- 画像管理ページ([[T25-images-page|T25]])は `imageRefs` を一覧するので、seed の画像は出ない。一覧のサムネイル([[T24-list-column|T24]])も `imageRefs` から作るので出ない。E2E や手動の確認で「保存できない投稿」「管理ページに出ない画像」が混ざると、不具合と区別しにくい。根拠: 推測のみ(T24・T25 はまだ組み立てていない)
- 描画の確認だけなら seed の画像でもできるが、開発用ログインは既定で seed の内容も入れる(`?content=0` で入れない。`astro/routes/api/setup/dev-bypass.ts:59-61`、公式ドキュメントのみ)ので、E2E のデータにも混ざる。表示用の画像はアップロードのルートで作り、手順(スクリプト)を README に書いた。

## サンプルの投稿を作るスクリプト

`playground/scripts/create-sample-posts.ts`(使い方は [[playground/README#表示用のデータの作り方|playground の README]])。開発用ログイン → Chromium の canvas で WebP(本体とサムネイル)を描く → アップロードのルートに 1 枚ずつ送る → 標準の REST API で投稿を作って公開する。

使い捨てのサイト(ルートと hook を登録)で確かめた結果。根拠: 実測のみ

| 確かめたこと | 結果 |
|---|---|
| 1 件・ギャラリー 0 枚 / 10 件・ギャラリー 10 枚・`--trash-cover` | どちらも成功。10 件 × 11 枚(110 回のアップロード)で約 3.5 秒 |
| 画像の大きさ | カバー(1280 × 853)は data URL で約 2.1 万文字、ギャラリー(800 × 600 / 600 × 800)は約 1.3〜1.6 万文字。すべて画質 0.8 で予算内 |
| データベース | 画像エントリ 114 件がすべて公開済みで、`imageRefs` も 114 件。参照元は 1 件ずつ(投稿の作成のときに、参照元の記録の hook([[T20-owner-tracking\|T20]])が足した)。`author_id` は null |
| 管理画面での保存(Chromium。widget が無いので JSON の入力欄) | タイトルを変えて保存すると、`PUT` の `data` に `title` / `cover` / `gallery` が入り、200。カバーをゴミ箱に移した投稿も 200(`imageRefs` が残るため。[[T16-reference-hook\|T16]] の決定 11)、カバーなしの投稿も 200 |
| `--trash-cover` | 最後の投稿のカバーが `DELETE /_emdash/api/content/b64_images/{id}` でゴミ箱に入り、サイトでは代わりの枠と警告ログになった |
| 本物の playground(ルートが無い) | `POST …/upload` が 404 `NOT_FOUND`(「Plugin route not found」)になり、スクリプトは T29 を確かめるよう案内して終了コード 1 で止まった |
| `--posts x` | 「0 以上の整数にしてください」で止まった |

- 画面の最初のアクセスで出る「Welcome to EmDash, Dev!」のダイアログは、ブラウザのコンテキストごとに、画面を開いてから少し遅れて出た。Playwright の `isVisible` は待たないので見逃し、ダイアログの下の保存ボタンを押せなかった(その間に自動保存が走った)。`waitFor({ state: "visible", timeout })` で待ってから閉じる。根拠: 実測のみ
- 本物の playground(ルートが無い)でも、確認のためだけに標準の REST API で画像エントリを作り(保存 hook が無いので通る)、ページが同じように描画されることを Chromium・Firefox で確かめた。この方法で作った画像は `imageRefs` に記録が無いので、T29 のあとは使えない。

## 再現手順

1. playground の `astro.config.mjs` / `package.json` / `tsconfig.json` / `seed/` / `src/` を `spikes/t26-pages/site/` に複製し、`package.json` の `dependencies` からプラグイン本体(`file:..`)を外す([[emdash-plugin-upload-route#再現手順]] と同じ)。ページは `emdash-plugin-base64-image/astro` を読むが、ルートの `node_modules/emdash-plugin-base64-image` はリポジトリのルートへのリンクなので、そのまま読める。
2. `astro.config.mjs` の `plugins` を、次のプラグインの descriptor(`entrypoint: "/plugins/base64-image-spike.ts"`、`adminEntry: "emdash-plugin-base64-image/admin"`)に替える。

```ts
// spikes/t26-pages/site/plugins/base64-image-spike.ts(T29 の代わり。登録の形は T16・T18・T20 の引き継ぎのとおり)
export function createPlugin() {
	return definePlugin({
		id: "base64-image",
		version: "0.0.0",
		capabilities: ["schema:read", "content:read", "content:write", "content:publish"],
		storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } },
		hooks: {
			...imageOwnerHooks,
			"content:beforeSave": {
				handler: async (event, ctx) => {
					if (event.collection === IMAGE_COLLECTION) return validateImageEntryBeforeSave(event, ctx);
					await validateReferencesBeforeSave(event, ctx);
				},
			},
		},
		routes: {
			[ROUTES.upload]: uploadRoute,
			[ROUTES.preview]: previewRoute,
			[ROUTES.thumbnails]: thumbnailsRoute,
		},
		admin: { entry: "emdash-plugin-base64-image/admin" },
	});
}
```

3. サイトのディレクトリで `EMDASH_QUERY_LOG=1 node ../../../node_modules/astro/bin/astro.mjs dev --port 4426`(止めるのは `… dev stop`)。
4. リポジトリのルートで `node playground/scripts/create-sample-posts.ts --base http://localhost:4426 --posts 10 --gallery 10 --trash-cover`。
5. ページを Playwright で開いて調べる(ページの中で実行した部分)。

```js
// <img> ごとに属性・デコードの結果・表示の縦横比を調べる(遅延読み込みの画像は、先に下までスクロールして読み込ませる)
[...document.querySelectorAll("img")].map((img) => {
	const rect = img.getBoundingClientRect();
	const width = Number(img.getAttribute("width"));
	const height = Number(img.getAttribute("height"));
	return {
		srcPrefix: img.getAttribute("src")?.slice(0, 23), // "data:image/webp;base64,"
		naturalMatches: img.naturalWidth === width && img.naturalHeight === height,
		ratioMatches: Math.abs(rect.height - (rect.width * height) / width) <= 1,
		complete: img.complete,
		loading: img.getAttribute("loading"),
		fetchpriority: img.getAttribute("fetchpriority"),
	};
});
// Chromium: LCP の要素と Layout Shift
new PerformanceObserver((list) => console.log(list.getEntries().at(-1)?.element)).observe({
	type: "largest-contentful-paint",
	buffered: true,
});
new PerformanceObserver((list) => console.log(list.getEntries().length)).observe({
	type: "layout-shift",
	buffered: true,
});
```
