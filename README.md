# emdash-plugin-base64-image

[EmDash](https://github.com/emdash-cms/emdash) 0.39 の native プラグイン。画像を WebP の data URL(base64)にして、サイトのデータベース(D1 / SQLite)に保存する。R2 などのオブジェクトストレージを使わずに、投稿に画像を持たせられる。

- 管理画面で選んだ画像を、ブラウザで WebP に圧縮してから保存する(保存する data URL は既定で 100,000 バイト以下)。幅と高さも保存する。
- 単一画像のフィールド(widget `base64-image:image`)と、ギャラリーのフィールド(widget `base64-image:gallery`)を提供する。
- サイトでは、`resolveBase64Images` で画像をまとめて取得し、`emdash/ui` の `Image` で `<img src="data:image/webp;base64,…" width height>` として描く。
- 管理画面のコンテンツの一覧にサムネイルの列を足し、画像を管理するページ(サイドバーの「プラグイン」の「画像」)を足す。

> [!IMPORTANT]
> - 対象は EmDash 0.39 系(peer は `emdash` の `^0.39.0`)。0.40 以降では動作を確かめていない。
> - 管理画面で画像を追加できるブラウザは Chrome / Edge / Firefox。**Safari では追加できない**(canvas で WebP を作れないため)。
> - npm には公開していない。GitHub のリポジトリから git 依存として入れる。npm 12 では、サイトの `.npmrc` に設定が要る(下の手順 1)。

## しくみ

- 画像の本体は、サイトに作る非表示のコレクション `b64_images` に 1 枚 1 エントリで置く。
- 投稿のフィールド(`json` 型)には、画像への参照 `{ v, id, locale, width, height, alt }` だけを保存する。ギャラリーは参照の配列。
- アップロードは、プラグインのルート(`/_emdash/api/plugins/base64-image/upload`)が受け付け、画像を検証して `b64_images` に作り、公開する。どの投稿のどのフィールドで使っているか(参照元)は、プラグインのストレージに記録する。
- 詳しい設計は [仕様書](plans/base64-image-plugin-spec.md) にある。

## 導入

前提: EmDash 0.39 のサイトがあること(Astro の `output: "server"` と、`src/live.config.ts` の `_emdash` コレクション。EmDash のテンプレートから作ったサイトなら入っている)。コマンドは、サイトのディレクトリで実行する。

### 1. `.npmrc` に `allow-git=root` を書く

サイトの `.npmrc` に次の 1 行を書き、サイトのリポジトリにコミットする。

```ini
allow-git=root
```

- npm 12 は、git 依存を既定で拒否する(`npm error code EALLOWGIT`)。`root` は、サイトの `package.json` に直接書いた git 依存だけを許す。
- `npm ci` を実行する CI やビルドの環境(Cloudflare Workers Builds など)でも要る。コミットしておかないと、そこでインストールが止まる。
- 詳しくは [docs/npm12-git-dependency-policy.md](docs/npm12-git-dependency-policy.md)。

### 2. プラグインを入れる

`#` のあとに、使う版のタグを書く。

```sh
npm install "github:KazukiMiyazato2021/emdash-base64img-plugin#v0.1.0"
```

- `package.json` の `dependencies` に、この git 依存が入る(パッケージ名は `emdash-plugin-base64-image`)。
- プラグインは TypeScript のソースのまま配布している(ビルドの手順も install スクリプトも無い)。サイトの Vite がソースを変換する。
- peer dependency は `emdash`(`^0.39.0`)、`@emdash-cms/admin`(`^0.39.0`)、`@cloudflare/kumo`(`2.6.0`)、`react`(`^18.0.0 || ^19.0.0`)。EmDash 0.39 のサイトなら、どれも `emdash` と一緒に入っている。

> [!NOTE]
> npm の `min-release-age`(公開から指定した日数がたっていない版を入れない設定)を使っている場合:
> - サイトの EmDash の版の公開から、その日数がまだたっていないときは、このコマンドが `ERESOLVE`(`Found: emdash@undefined`)で止まる。プラグインの peer の `emdash` を解決するときに、npm が EmDash の版を選び直すため。
> - EmDash を入れたときと同じく、このコマンドにも `--min-release-age=0` を付ける。`min-release-age` を緩めたくなければ、代わりに `--force`(peer の食い違いを無視する)でも入る。確かめたときは、どちらでも、増えたのはプラグインだけだった。
> - 公開日時は `npm view emdash "time[0.39.1]"` で確かめられる(版はサイトの `package.json` の `emdash` に合わせる)。日数がたっていれば、どちらも付けなくてよい。

#### 非公開のリポジトリから入れるとき

このリポジトリは公開しているので、通常は要らない。フォークを非公開にしたときなど、リポジトリが非公開なら、インストールする環境ごとに、リポジトリを読む権限が要る。この節の方法は、npm 12 のソースを読んで書いたもので、実際には確かめていない。

- 手元の PC: GitHub に登録した SSH の鍵で読めるなら、上と同じコマンドで入る(npm は、HTTPS で読めなければ SSH で読む)。
- CI やビルドの環境: リポジトリを読めるトークン(GitHub の fine-grained personal access token で、このリポジトリの Contents を Read-only)を秘密の環境変数に入れ、`npm ci` より前に、git が HTTPS の URL にトークンを付けるよう設定する。

```sh
git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
```

> [!CAUTION]
> トークンを `package.json` の URL に直接書かない(`git+https://<トークン>@github.com/…`)。`package.json` と `package-lock.json` にそのまま残る。

### 3. `astro.config.mjs` に登録する

`emdash()` の `plugins` に `base64ImagePlugin()` を入れる。`storage` は指定しない(R2 を使わない)。

Node + SQLite の例(このリポジトリの `playground/` と同じ構成):

```js
import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { sqlite } from "emdash/db";
import { base64ImagePlugin } from "emdash-plugin-base64-image";

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./data.db" }),
			// storage は指定しない
			plugins: [base64ImagePlugin()],
		}),
	],
});
```

Cloudflare Workers + D1 の例:

```js
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1 } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { base64ImagePlugin } from "emdash-plugin-base64-image";

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			// storage(R2)は指定しない
			plugins: [base64ImagePlugin()],
		}),
	],
	// 任意: astro dev の最初のリクエストで起きる、依存の最適化による再読み込みを避ける
	vite: { ssr: { optimizeDeps: { include: ["emdash-plugin-base64-image"] } } },
});
```

- EmDash の Cloudflare のテンプレートから作ったサイトでは、`storage: r2({ binding: "MEDIA" })` と、wrangler の設定の `r2_buckets` を外す。
- この形は、このリポジトリの playground の Cloudflare 用の設定([playground/astro.config.cloudflare.mjs](playground/astro.config.cloudflare.mjs)・[playground/wrangler.jsonc](playground/wrangler.jsonc)・[playground/src/worker.ts](playground/src/worker.ts))で、`wrangler dev`(workerd + ローカルの D1)で動くことを確かめた。アップロード・保存・参照元の記録・画像管理ページは Node と同じ結果だった。本番の Workers へのデプロイでは確かめていない。詳しくは [docs/workerd-d1-plugin-behavior.md](docs/workerd-d1-plugin-behavior.md)。
- `vite.ssr.optimizeDeps.include` は Cloudflare アダプターの `astro dev` のためのもの。無くても動くが、最初のリクエストで Vite が依存を最適化し直し、ページが 1 回読み込み直される。Node アダプターでは起きないので要らない。詳しくは [docs/git-dependency-ts-source.md](docs/git-dependency-ts-source.md)。

> [!NOTE]
> Node では、`storage` を省略すると、EmDash が `./.emdash/uploads` のローカルの storage を既定で使う。そのため、EmDash 標準のメディアのアップロードも動く。R2 の無い Cloudflare のサイトでは、標準のメディアの機能(メディアライブラリ、標準の画像・ファイルのフィールド、リッチテキストへの画像のアップロード)は使えず、このプラグインがサイトで唯一の画像の手段になる。`wrangler dev` で確かめたときは、標準のメディアのアップロードが 500 `UPLOAD_ERROR`(`Upload failed`)になった(`NO_STORAGE` ではない)。

### 4. コレクションとフィールドを作る

サイトには次の 2 つが要る。

- 画像の本体を置く非表示のコレクション `b64_images`。**プラグインはコレクションを作れない**ので、サイトで作る。
- 画像を持たせるコレクションの、このプラグインの widget を使う `json` のフィールド。管理画面のスキーマの編集画面では `widget` を指定できないので、seed か API で作る。

#### 新しいデータベースのとき(seed)

`seed/seed.json` に書く(EmDash は `.emdash/seed.json`、`package.json` の `emdash.seed`、`seed/seed.json` の順に探す)。`posts` の `cover` を単一画像、`gallery` をギャラリーにする例:

```json
{
	"$schema": "https://emdashcms.com/seed.schema.json",
	"version": "1",
	"collections": [
		{
			"slug": "b64_images",
			"label": "Base64 Images",
			"hidden": true,
			"routable": false,
			"supports": [],
			"fields": [{ "slug": "image", "label": "Image", "type": "json", "required": true }]
		},
		{
			"slug": "posts",
			"label": "Posts",
			"supports": ["drafts", "revisions", "search", "seo"],
			"fields": [
				{ "slug": "title", "label": "Title", "type": "string", "required": true },
				{
					"slug": "cover",
					"label": "Cover",
					"type": "json",
					"widget": "base64-image:image",
					"options": { "maxStoredBytes": 100000 }
				},
				{
					"slug": "gallery",
					"label": "Gallery",
					"type": "json",
					"widget": "base64-image:gallery",
					"options": { "maxStoredBytes": 100000, "maxItems": 10 }
				}
			]
		}
	]
}
```

- `b64_images` は、この形のまま使う(`hidden: true`・`routable: false`・`supports: []`・`image` は `json` で必須)。`routable: false` は必須で、外すと画像を公開できない(プラグインが作るエントリには slug が無い)。
- seed が適用されるのは、コレクションが 1 つも無いデータベースへの最初のリクエストと、セットアップ(開発では開発用ログイン)のときだけ。すでにあるコレクションは変わらない。すでに動いているサイトは、次の API の手順で足す。
- **seed に `b64_images` のエントリ(画像)を入れない。** seed で作った画像はプラグインの記録に無く、それを参照する投稿は、管理画面で保存できない(タイトルだけを変えても拒否される)。画像は管理画面の widget からアップロードする。

#### すでにデータベースがあるとき(API)

EmDash の REST API(`POST /_emdash/api/schema/collections` と `POST /_emdash/api/schema/collections/{コレクション}/fields`)で作る。管理者のロールが要る。

API トークンは、管理者が管理画面の「設定」の「API Tokens」(`/_emdash/admin/settings/api-tokens`)で作る。トークンを作れるのは管理者だけ。

```sh
SITE=https://example.com       # サイトの URL
TOKEN=ec_pat_...               # 管理者の API トークン(スコープ schema:write)
```

画像の本体を置くコレクション `b64_images`:

```sh
curl -X POST "$SITE/_emdash/api/schema/collections" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"slug":"b64_images","label":"Base64 Images","hidden":true,"routable":false,"supports":[]}'
curl -X POST "$SITE/_emdash/api/schema/collections/b64_images/fields" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"slug":"image","label":"Image","type":"json","required":true}'
```

`posts` に、単一画像のフィールド `cover` と、ギャラリーのフィールド `gallery` を足す:

```sh
curl -X POST "$SITE/_emdash/api/schema/collections/posts/fields" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"slug":"cover","label":"Cover","type":"json","widget":"base64-image:image","options":{"maxStoredBytes":100000}}'
curl -X POST "$SITE/_emdash/api/schema/collections/posts/fields" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"slug":"gallery","label":"Gallery","type":"json","widget":"base64-image:gallery","options":{"maxStoredBytes":100000,"maxItems":10}}'
```

- どれも、作れたら `201` と、作ったものの JSON が返る。すでにあれば `409` になる。
- 開発サーバー(`astro dev`)では、トークンの代わりに開発用ログインの Cookie も使える。`curl -c cookies.txt "$SITE/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin"` で Cookie を保存し、`-H "Authorization: …"` の代わりに `-b cookies.txt -H "X-EmDash-Request: 1"` を付けて送る。
- 新しい環境でも同じ構成になるよう、seed にも同じ定義を書いておく。
- MCP の `schema_create_collection` / `schema_create_field` でも作れる。

#### フィールドの `options`

どれも省略できる。

| option | 対象 | 既定値 | 範囲 | 内容 |
|---|---|---|---|---|
| `maxStoredBytes` | 単一画像・ギャラリー | 100000 | 10,000〜500,000 | 保存する data URL の最大の長さ(バイト)。1 枚の大きさと、ページの重さが決まる |
| `maxEdge` | 単一画像・ギャラリー | 1600 | 96〜4,096 | 長辺の上限(px)。大きい画像は縮小する |
| `minQuality` | 単一画像・ギャラリー | 0.6 | 0〜0.92 | 画質の下限。この画質で収まらなければ、長辺を 0.8 倍ずつ縮める |
| `minEdge` | 単一画像・ギャラリー | 480 | 96〜`maxEdge` | 縮める長辺の下限(px)。ここまで縮めても収まらない画像はエラーになる |
| `maxItems` | ギャラリー | 10 | 1〜20 | 最大の枚数 |

- 範囲の外の数値は範囲の中に丸め、整数の項目は小数点以下を切り捨てる。数値でない値は既定値にする。
- `maxItems` をあとから小さくすると、上限を超えているギャラリーは、枚数を減らすまで保存できない。

### 5. サイトのページで描く

`emdash-plugin-base64-image/astro` の `resolveBase64Images` に、ページで使う参照をまとめて渡す。結果の `get(参照)` が、`emdash/ui` の `Image` にそのまま渡せる値(`src` は data URL、`alt` はその参照のもの)を返す。

- `json` のフィールドは、サイトの型では `unknown` になる。`isBase64ImageRef` で参照の形のものだけを取り出す。
- 1 ページの参照は、まとめて 1 回で解決する。一覧のページでも、表示するエントリの参照を集めて 1 回で渡す(10 件の一覧でも、画像の取得は 1 クエリ)。
- 画像が見つからない(ゴミ箱に入った・完全に削除された)・値が正しくない・取得に失敗したときは、`get` が `undefined` を返し、サーバーのログに警告を出す。例外は投げない。

画像 1 枚を描く部品(`src/components/Base64Image.astro`)。見つからない画像は、参照の寸法で場所を取った枠にして、レイアウトがずれないようにする。

```astro
---
import { Image } from "emdash/ui";
import type { Base64ImageRef, ResolvedBase64Images } from "emdash-plugin-base64-image/astro";

interface Props {
	imageRef: Base64ImageRef;
	images: ResolvedBase64Images;
	/** LCP の対象の画像に付ける(loading="eager" と fetchpriority="high" になる) */
	priority?: boolean;
}

const { imageRef, images, priority = false } = Astro.props;
const image = images.get(imageRef);
---

{
	image ? (
		<Image image={image} priority={priority} />
	) : (
		<div role="img" aria-label="画像が見つかりません" style={`aspect-ratio: ${imageRef.width} / ${imageRef.height};`}>
			画像が見つかりません
		</div>
	)
}
```

一覧のページ(`src/pages/posts/index.astro`)。表示する投稿のカバーを集めて、1 回で解決する。

```astro
---
import { getEmDashCollection } from "emdash";
import { isBase64ImageRef, resolveBase64Images } from "emdash-plugin-base64-image/astro";

import Base64Image from "../../components/Base64Image.astro";

const { entries, error } = await getEmDashCollection("posts", {
	limit: 10,
	orderBy: { published_at: "desc" },
});

const covers = entries.map((entry) => entry.data.cover).filter(isBase64ImageRef);
const images = await resolveBase64Images(covers);
// LCP の対象: 描画できる最初のカバー(1 件目の画像が見つからないときは、次のカバー)
const lcpCover = covers.find((ref) => images.get(ref) !== undefined);
---

<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<title>投稿</title>
	</head>
	<body>
		<h1>投稿</h1>
		{error && <p>投稿を読み込めませんでした。</p>}
		<ul>
			{
				entries.map((entry) => {
					const cover = entry.data.cover;
					return (
						<li>
							<a href={`/posts/${encodeURIComponent(entry.id)}/`}>
								{isBase64ImageRef(cover) && (
									<Base64Image imageRef={cover} images={images} priority={cover === lcpCover} />
								)}
								{entry.data.title}
							</a>
						</li>
					);
				})
			}
		</ul>
	</body>
</html>
```

詳細のページ(`src/pages/posts/[slug].astro`)。カバーとギャラリーを 1 回で解決する。

```astro
---
import { decodeSlug, getEmDashEntry } from "emdash";
import { isBase64ImageRef, resolveBase64Images } from "emdash-plugin-base64-image/astro";

import Base64Image from "../../components/Base64Image.astro";

const slug = decodeSlug(Astro.params.slug);
const { entry: post, error } = slug
	? await getEmDashEntry("posts", slug)
	: { entry: null, error: undefined };

// 見つからないときも error(LiveEntryNotFoundError)が返る。ほかの失敗だけを 500 にする
if (!post) {
	Astro.response.status = error && error.name !== "LiveEntryNotFoundError" ? 500 : 404;
}

const cover = post && isBase64ImageRef(post.data.cover) ? post.data.cover : undefined;
// ギャラリーは 1 枚ずつ確かめる(1 枚が正しくなくても、ほかの画像は描く)
const gallery =
	post && Array.isArray(post.data.gallery) ? post.data.gallery.filter(isBase64ImageRef) : [];
const images = await resolveBase64Images(cover ? [cover, ...gallery] : gallery);
// LCP の対象: カバー。カバーの無い投稿では、描画できる最初のギャラリーの画像
const lcpRef = cover ?? gallery.find((ref) => images.get(ref) !== undefined);
---

<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<title>{post ? post.data.title : "投稿が見つかりません"}</title>
	</head>
	<body>
		{
			post ? (
				<article>
					<h1>{post.data.title}</h1>
					{cover && <Base64Image imageRef={cover} images={images} priority={cover === lcpRef} />}
					<ul>
						{gallery.map((ref) => (
							<li>
								<Base64Image imageRef={ref} images={images} priority={ref === lcpRef} />
							</li>
						))}
					</ul>
				</article>
			) : (
				<h1>投稿が見つかりません</h1>
			)
		}
	</body>
</html>
```

- `getEmDashEntry` は、エントリが見つからないときも `error`(Astro の `LiveEntryNotFoundError`)を返す。`error` があるだけで 500 にすると、存在しない URL が 500 になる。
- `priority` は、LCP(最も大きく描かれる要素)になる画像 1 枚だけに付ける。対象を「1 件目のカバー」のように決め打ちすると、その画像が見つからないときに、どの画像にも付かない。描画できる最初の画像を選ぶ。
- 詳細のページでカバーが見つからないときは、代わりの枠がカバーの場所を占めるので、ほかの画像には付けない。
- 例では、`<html>` と `<meta charset="utf-8" />` をページに直接書いた。サイトにレイアウトがあれば、それで包む。`<meta charset>` が無いと、日本語が文字化けする(Astro の応答の `Content-Type` は `text/html` で、charset を含まない)。
- このリポジトリの `playground/src/pages/` に、同じ形のページ(レイアウトとスタイル付き)がある。

### 6. 確かめる

1. 開発サーバーを起動し、管理画面(`/_emdash/admin`)を開く。
2. 投稿の編集画面で、`cover` と `gallery` が「画像をドロップ / 貼り付け」の枠になっていることを確かめる(JSON の入力欄のままなら、手順 3・4 を見直す)。
3. 画像を追加して保存・公開し、サイトのページ(上の例では `/posts/`)に画像が出ることを確かめる。公開は、編集画面の右上の「Publish now」(EmDash 0.39.1 では日本語の画面でも英語のまま)を押し、確認のダイアログでもう一度「Publish now」を押す。

### 型チェックとマイグレーション

- サイトの `tsc --noEmit` は、サイトの設定でプラグインの `src` も型チェックする(TypeScript のソースのまま配布しているため)。サイトの `.ts` がプラグインを import しているときや、tsconfig の `include` に `astro.config.mjs` が入るときに辿られる。`astro check` はプラグインの `src` を検査しない。どちらでもエラーは出ない(緩い設定と厳しい設定の代わりの tsconfig で、変更のたびに確かめている)。
- `emdash migrate --from-config` は使えない(Node が `node_modules` の中の `.ts` を読めず、`Stripping types is currently unsupported for files under node_modules` で失敗する)。`astro build` が書くマニフェストを使う既定の `emdash migrate` を使う。EmDash も `--from-config` をローカルの調査用としている。

## 管理画面での使い方

### 単一画像のフィールド

- 追加: 枠を押してファイルを選ぶ、画像をドロップする、または枠のボタンにフォーカスを置いて Ctrl+V(Mac は ⌘V)で貼り付ける。1 枚ずつ追加する。
- 選ぶと、ブラウザで読み込み・圧縮・サムネイルの作成をしてから、すぐにアップロードする。進捗(「圧縮中… 1280px / 画質 0.74」など)とキャンセルのボタンが出る。
- 代替テキスト: 画像ごとに入れる。空欄なら装飾画像として扱われる。
- 差し替え: 新しい画像をアップロードして置き換える。**代替テキストは空になる**ので、入れ直す。
- 削除: フィールドから画像を外す。画像そのものは残る(画像管理ページで扱う)。

### ギャラリーのフィールド

- 追加: 複数のファイルをまとめて選択・ドロップできる。1 枚ずつ順に処理し、終わった画像から値に加える。1 枚が失敗しても、残りは処理する。
- 並べ替え: 画像ごとの ↑↓ のボタン(Enter / Space でも押せる)か、つまみ・縮小画像のドラッグ。
- 枚数: 「あと N 枚追加できます」が出る。`maxItems` に達すると、枠を押せなくなる。上限を超える分は、処理せずにファイルごとにエラーを出す。
- 1 枚ずつ、差し替え(代替テキストは空になる)・削除・代替テキストの入力ができる。

### 値が正しくないとき

seed や手での書き換えで、フィールドの値が参照の形になっていないときの表示。どれも、直すまで投稿を保存できない(保存が拒否される)。

| 表示 | 直し方 |
|---|---|
| 単一画像:「画像の値が正しくありません」 | 削除ボタンで外し、画像を追加し直す |
| ギャラリー:「ギャラリーの形ではありません」の説明(値が配列でない) | 「値を空にする」。値が画像 1 枚の参照なら「1 枚目にする」も使える |
| ギャラリー:「データが正しくありません」(参照の形でない要素) | その要素を削除する |
| ギャラリー:「同じ画像が N 番目にもあります」 | どちらかを削除する |
| 「画像が見つかりません」 | ゴミ箱に入った・完全に削除された画像。削除ボタンで外す(ゴミ箱に入っただけなら、参照したままでも保存できる) |

### 保存するときの注意

> [!WARNING]
> **画像の処理中は保存しない。** 処理中は、進捗の下に「処理が終わってから保存してください。」が出る。処理中に「保存」を押すと、保存の応答が返るまでに追加された画像が、フォームから外れる(EmDash が保存の応答でフォームの値を置き換えるため)。外れた画像は、画像管理ページに「参照元なし」として残るので、ゴミ箱に移す。新規作成の画面では、処理が終わってから最初の保存をする。

- 必須(`required`)のギャラリーでも、画像を全部消した空の配列(`[]`)のまま保存できる(EmDash の必須の確認は、値なし・`null`・空文字だけを拒否する)。単一画像の必須は、画像なし(`null`)を拒否する。
- 保存が拒否されたときのメッセージは、日本語と英語を並べて出る(サーバーは管理画面の言語を知らないため)。

### 画像管理ページ

サイドバーの「プラグイン」の「画像」(`/_emdash/admin/plugins/base64-image/images`)。アップロードした画像を新しい順に並べ、状態(使用中・参照元が削除された・参照元から外された・参照元なし)、参照元へのリンク、公開の状態を出す。

| 操作 | 対象の画像 | できるロール |
|---|---|---|
| ゴミ箱に移動 | ゴミ箱に入っていない画像 | 寄稿者以上 |
| 完全に削除 | ゴミ箱の画像だけ | 管理者 |
| 公開 | 下書きの画像(ゴミ箱から戻した画像など) | 編集者以上 |

- ゴミ箱に入った画像は、サイトに表示されなくなる。寄稿者は、ほかの人の投稿で使われている画像もゴミ箱に移せる(移す前に確認が出て、使用中ならそのことを示す)。
- 完全に削除した画像を参照したままの投稿は、画像を外すまで保存できない。
- 画像は自動では消えない。フィールドから外した画像・差し替えた前の画像も残る。容量を空けるには、ゴミ箱に移してから完全に削除する。
- 「参照されていない」は「消しても安全」ではない。判定の対象は、今のコンテンツ(公開版と下書き)だけで、古いリビジョンや、複製したまま保存していないエントリからは、まだ参照されていることがある。
- ページの項目は、ロールで絞られない(閲覧者のサイドバーにも出る)。閲覧者が開くと、権限が無いことを示す文が出る。

### ゴミ箱から戻す

画像管理ページには、ゴミ箱から戻す操作が無い。EmDash の REST API で戻す。戻せるのは編集者以上で、API トークンを作れるのは管理者だけなので、トークンで戻すのは管理者になる(編集者は、下の標準の画面の「復元」を使うか、管理者に頼む)。

```sh
SITE=https://example.com       # サイトの URL
TOKEN=ec_pat_...               # 管理者の API トークン(スコープ content:write)
curl -X POST "$SITE/_emdash/api/content/b64_images/<画像の ID>/restore" \
  -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}\n"
```

- 画像の ID は、画像管理ページの各行に出ている。`200` が出れば戻っている(応答の本文には画像の本体が入るので、`-o /dev/null` で捨てている)。
- 戻した画像は下書きになり、サイトには表示されない。画像管理ページの「公開」で公開し直す。
- EmDash 標準の `b64_images` の画面(`/_emdash/admin/content/b64_images`)の「ゴミ箱」のタブの「復元」でも戻せる。ただし、その画面は開くだけで、一覧の最大 100 件とゴミ箱の最大 50 件の画像の本体を読み込む(下の「使わない画面」)。

### 使わない画面

`b64_images` の EmDash 標準の画面は使わない。

- 標準の一覧・ゴミ箱の画面(`/_emdash/admin/content/b64_images`)は、開くだけで、一覧の最大 100 件とゴミ箱の最大 50 件の画像の本体(既定で 1 件最大 100,000 バイトの base64)を読み込み、重い。
- 標準の編集画面からは、保存も公開もできない(保存 hook が拒否する)。画像を差し替えるときは、投稿のフィールドで新しくアップロードする。
- 標準の新規作成の画面・REST API・seed で作った画像は、プラグインの記録に無く、投稿から参照すると保存が拒否される。画像は widget からアップロードする。
- 管理画面のコマンドパレットで「Images」などと入力すると、非表示の `b64_images`(「Base64 Images」)も候補に出る。選ぶと標準の一覧に移るので、選ばない(画像管理ページは「画像」)。

## 制約

| 項目 | 内容 |
|---|---|
| ブラウザ | 管理画面で画像を追加できるのは Chrome / Edge / Firefox。Safari は非対応 |
| 入力形式 | JPEG / PNG / WebP / AVIF / BMP / GIF。HEIC / HEIF・SVG・TIFF などは受け付けない(HEIC は、iPhone のカメラ設定を「互換性優先」にするか、JPEG に書き出す) |
| 入力の大きさ | 40MB まで、6,400 万画素まで |
| アニメーション | GIF・アニメーション WebP・APNG は、最初のフレームの静止画になる |
| 変換 | 位置情報を含む EXIF は消える。透過は残る。色は sRGB になる |
| 容量 | 画像 1 枚は最大 100,000 バイト(既定)。公開すると本体を写したリビジョンが 1 件できるので、1 枚でその約 2 倍を使う。D1 Free の 500MB で約 2,500 枚。使用量は Cloudflare のダッシュボードで見る |
| D1 の 1 日の上限(Free) | 書き込みは 10 万行 / 日、読み込みは 500 万行 / 日で、超えると UTC の 0 時までクエリが失敗する。画像 1 枚のアップロードで約 93 行を書き、約 761 行を読む(投稿の保存・公開は 1 回 38〜50 行を書く)。アップロードだけなら書き込みの上限は約 1,000 回 / 日にあたる。数は `wrangler dev` のローカルの D1 で測ったもの |
| バックアップ | 戻せるのは D1 の Time Travel(Free は直近 7 日)だけ。`wrangler d1 export` は、EmDash の検索の仮想テーブルがあるデータベースでは使えない |
| ページの重さ | 画像は HTML に埋め込まれる。10 件の一覧で最大約 1MB、カバーとギャラリー 10 枚のページで約 1.1MB |
| 対象外 | リッチテキストの本文中の画像と、OGP の画像 |
| seed の画像 | seed で作った `b64_images` を参照する投稿は保存できない。画像はアップロードで作る |
| ほかのプラグイン | このプラグインの保存 hook は priority 200 で動く。それより後(priority が 200 より大きい)に動くほかのプラグインの保存 hook が変えた値は、確かめない |

理由と測定の結果は、[仕様書](plans/base64-image-plugin-spec.md) の 2 章・6 章・18 章にある。

## 困ったとき

| 症状 | 原因 | 対処 |
|---|---|---|
| `npm error code EALLOWGIT` | npm 12 が git 依存を拒否した | 手順 1 の `.npmrc` |
| `ERESOLVE` と `Found: emdash@undefined` | `min-release-age` が EmDash 0.39 系を外した | 手順 2 の注意 |
| 投稿の編集画面で、画像のフィールドが JSON の入力欄のまま | フィールドの `widget` が無いか違う、またはプラグインが登録されていない | 手順 3・4 |
| アップロードで「画像を保存するコレクション b64_images がありません。サイトの設定を確認してください。」 | `b64_images` が無い | 下の「b64_images が無いとき」 |
| 保存で「画像が見つかりません(ID: …)」 | 完全に削除した画像か、seed などアップロード以外で作った画像を参照している | widget の削除ボタンで外し、画像をアップロードし直す |
| 「このブラウザは非対応です」 | Safari | Chrome / Edge / Firefox を使う |
| `emdash migrate --from-config` が `Stripping types is currently unsupported for files under node_modules` で失敗する | TypeScript のソースのまま配布しているため | `astro build` のあとで既定の `emdash migrate` を使う |
| Cloudflare の `astro dev` で、最初のリクエストでページが読み込み直される | Vite の依存の最適化 | 手順 3 の `vite.ssr.optimizeDeps.include` |

### b64_images が無いとき

編集者の画面には、画像を選んだあとに「画像を保存するコレクション b64_images がありません。サイトの設定を確認してください。」が出るだけで、値は変わらない(画像なしの投稿は保存できる)。直し方はサーバーのログにだけ出る。

- アップロードのたびに `[plugin:base64-image] Failed to create the image entry`(`Collection 'b64_images' not found`)が出る。アップロードは 500 `IMAGE_COLLECTION_MISSING`。
- プロセス(Workers では isolate)ごとの最初の保存と、管理画面でプラグインを有効に戻したときに、次のエラーが出る。

```text
[plugin:base64-image] The "b64_images" collection does not exist, so images cannot be uploaded (the upload route returns IMAGE_COLLECTION_MISSING). This plugin cannot create collections: add it to the site's seed, or create it with the schema API (hidden: true, routable: false, supports: [], and a required "image" field of type json).
```

直し方:

1. 動いているサイトのデータベースに、手順 4 の「すでにデータベースがあるとき(API)」で `b64_images` を作る(seed に足すだけでは、すでにあるデータベースには入らない)。
2. 新しい環境のために、seed にも `b64_images` を足す。
3. もう一度、画像を追加する。サーバーの再起動は要らない。

## 資料

- [仕様書](plans/base64-image-plugin-spec.md): 設計・既定値の理由・既知の制約(18 章)
- [playground/README.md](playground/README.md): このリポジトリの動作確認用のサイト
- [docs/npm12-git-dependency-policy.md](docs/npm12-git-dependency-policy.md): npm 12 の git 依存と `min-release-age`
- [docs/git-dependency-ts-source.md](docs/git-dependency-ts-source.md): TypeScript のソースのまま配布したプラグインの読み込み・型チェック・マイグレーション
- [docs/emdash-dependency-versions.md](docs/emdash-dependency-versions.md): 依存パッケージの版と、EmDash を上げるときに確かめること
- [docs/readme-install-verification.md](docs/readme-install-verification.md): この README の手順で新しいサイトを作って確かめた結果
- [docs/00-index.md](docs/00-index.md): 作業中に得た知見の索引

## 開発

このリポジトリで開発するときは、Node 26.10.0 と npm 12.0.2 を使う(`mise.toml`)。

```sh
npm ci
npm run verify                              # 型チェック・playground のビルド・lint・単体テスト
npm run dev -w playground -- --port 4321    # 動作確認用のサイト(使い方は playground/README.md)
npm run test:e2e                            # E2E(Playwright。Chromium と Firefox)
```

- E2E は、playground の開発サーバー(ポート 4431)を空のデータベースで起動して動かし、終わったら止める。playground のデータベースがあれば、日時の付いた名前で残してから空にする。
- E2E の入力画像は macOS の `sips` で作るので、E2E は macOS でだけ動く。Playwright のブラウザ(Chromium・Firefox)を先に入れておく。詳しくは [docs/e2e-playwright-emdash-admin.md](docs/e2e-playwright-emdash-admin.md)。
