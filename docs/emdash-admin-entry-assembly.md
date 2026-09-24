---
title: EmDash 0.39.1 の管理画面の入口(adminEntry)の組み立てと、実際の管理画面での確認
aliases:
  - 管理画面の入口の組み立て
  - src/admin.tsx の export
  - 入口の読み込み時の先読み
  - プラグインの管理画面のプラグインページのボタン
  - 管理画面の JS の大きさ
  - b64_images の無いサイトの管理画面
tags:
  - docs
  - emdash
  - admin
  - testing
  - browser
source_task: "[[T30-admin-entry]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 の管理画面の入口(adminEntry)の組み立てと、実際の管理画面での確認

> [!summary] 要点
> - 入口 `src/admin.tsx` は `fields`(`image` / `gallery`)・`pages`(`/images`)・`contentListColumns`(`thumbnailColumn`)の 3 つを export し、読み込み時に `preloadThumbnailColumn()` を呼ぶ。名前とパスは、プラグイン定義(T29)の `admin.fieldWidgets` / `admin.pages` と同じ定数(`WIDGET_KINDS`・`IMAGES_PAGE`)から取る。根拠: 実測+公式ドキュメント
> - 組み立てた入口で、playground の開発サーバーと本番のビルドの両方で、widget(アップロード・保存)・一覧の列・サイドバーの項目・コマンドパレット・プラグインの管理画面の「プラグインページ」が動いた(Chromium 153。Firefox 155 は表示を確かめた)。T29 の前の状態(textarea・サイドバーに項目なし・パレットで 404)は解消した。根拠: 実測のみ
> - プラグインの管理画面(`/_emdash/admin/plugins-manager`)の「プラグインページ」のボタンは `/_emdash/admin/plugins/base64-image`(残りが空)を開き、管理画面は `pages` の最初の部品を出す。`pages` は画像管理ページだけなので、そこが開く。根拠: 実測+公式ドキュメント
> - 管理画面のクライアントの JS は、入口を組み立てると +103,267 B(gzip +32,529 B、全体の約 0.9%)。管理画面の本体と同じチャンクに入り、`@emdash-cms/admin` は 1 つだけ(重複しない)。根拠: 実測のみ
> - `b64_images` の無いサイトでは、widget はアップロードの失敗で「画像を保存するコレクション b64_images がありません。サイトの設定を確認してください。」を出す(ファイルを選んでから約 0.6 秒)。画像管理ページは「画像はありません」。T30 では、先に知らせる表示は作らないことにした([[T30-admin-entry#決めたこと|T30]])。根拠: 実測のみ
> - 入口のテストは、`vi.resetModules()` で入口を読み込み直して、読み込み時の先読み(`fetch`)と export の中身を確かめる。ページの探し方は、`@emdash-cms/admin` の本物の `usePluginPage` で確かめる。根拠: 実測のみ
> - 実際の管理画面の console に出た警告・エラーは、どれも EmDash 側のもの([[emdash-admin-console-noise]])。
> - 関連: [[T30-admin-entry]]、[[emdash-plugin-definition-registration]]、[[emdash-plugin-field-widget]]、[[emdash-admin-content-list-columns]]、[[emdash-admin-plugin-pages]]、[[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11 章]]

> [!info] 環境
> - Apple M5 Pro、macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0。`emdash` / `@emdash-cms/admin` 0.39.1、Astro 7.3.3、React 19.2.4、`@cloudflare/kumo` 2.6.0、zod 4.5.4、`@lingui/core` 5.9.5、vitest 4.1.11、Playwright 1.63.0(ヘッドレス。Chromium 153.0.8010.12、Firefox 155.0)。2026-09-24 に計測。
> - playground(開発サーバー `astro dev` と、本番のビルド `astro build` + `astro preview`)。ポート 4430。データベースは worktree の中の `playground/data.db`。
> - 行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。

## 1. 入口の形

```tsx
// src/admin.tsx(抜粋。コメントは省いた)
import type { PluginAdminModule } from "@emdash-cms/admin";

import { GalleryField } from "./admin/GalleryField";
import { ImageField } from "./admin/ImageField";
import { ImagesPage } from "./admin/ImagesPage";
import { preloadThumbnailColumn, thumbnailColumn } from "./admin/ThumbnailColumn";
import { IMAGES_PAGE } from "./shared/constants";

preloadThumbnailColumn();

export const fields = { image: ImageField, gallery: GalleryField };
export const pages = { [IMAGES_PAGE.path]: ImagesPage } satisfies NonNullable<PluginAdminModule["pages"]>;
export const contentListColumns = [thumbnailColumn] satisfies NonNullable<
	PluginAdminModule["contentListColumns"]
>;
```

| export | 管理画面の使い方 | 無いときの管理画面 | 根拠 |
|---|---|---|---|
| `fields` | フィールドの `widget`(`base64-image:image`)を最初の `:` で分け、`pluginAdmins[<ID>].fields[<名前>]` が**関数のとき**だけ描く(`admin/src/components/ContentEditor.tsx:1806-1844`) | 標準の入力(`json` は textarea。`:1863`) | 実測+公式ドキュメント |
| `pages` | サイドバーは、マニフェストの `adminPages` のうち、入口の `pages` に部品があるものだけを出す(`admin/src/components/Sidebar.tsx:488-505`)。ページの URL `/plugins/<ID>/<残り>` は「`/` + 残り」で探す(`admin/src/router.tsx:2733-2747`)。末尾の `/` は区別せず、`/` は最初のページになる(`admin/src/lib/plugin-context.tsx:65-76`) | サイドバーに項目が出ない。コマンドパレットの項目は Block Kit のページになり、404「Plugin route not found」(T29 の実測) | 実測+公式ドキュメント |
| `contentListColumns` | 一覧の画面が、コレクションごとに列を選ぶ([[emdash-admin-content-list-columns]]) | 列が出ない | 実測+公式ドキュメント |

- 管理画面は、入口のモジュール全体を `import * as admin0 from "<adminEntry>"` で読み込む(`core/src/astro/integration/virtual-modules.ts:327-359`)。`PluginAdminModule` にはほかに `widgets`(ダッシュボード)と `contentEditorPanels` があり、このプラグインは使わない。テストで、export がこの 3 つだけであることを確かめている。
- `ContentEditor` は `typeof PluginField === "function"` で判定する(`:1830`)。`React.memo` などで包むとオブジェクトになり、widget は描かれずに標準の入力に落ちる(公式ドキュメントのみ。テストで、見つかる値が関数であることを確かめている)。

### 型の付け方

- `fields` には型の注釈(`PluginAdminModule["fields"]` や `satisfies`)を付けない。0.39.1 の `fields` の型は props 無しの `Record<string, React.ComponentType>` で、props が必須の widget は代入できない(TS2322。[[emdash-plugin-field-widget#1. widget が受け取る props]])。根拠: 公式ドキュメントのみ+型チェックの実測
- `pages` と `contentListColumns` は `satisfies` で `PluginAdminModule` の型に合うことを確かめる(推論された型はそのまま)。EmDash のドキュメントも、列を `satisfies readonly ContentListColumnExtension[]` で書いている(`docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx`)。`emdash` の `PluginAdminExports` は値の型が `JSX.Element` で部品に合わないので使わない(`core/src/plugins/types.ts:2088-2092`)。根拠: 公式ドキュメントのみ(`npm run typecheck` の 3 つの設定で通ることは実測)

### 読み込み時の先読み

`preloadThumbnailColumn()` はモジュールの最上位で呼ぶ。`fetch` は、入口の読み込みの中で同期的に呼ばれる(`ensureManifest` → `apiFetch`)。開発サーバーと本番のビルドのどちらでも、ダッシュボードを読み込むと `GET /_emdash/api/manifest` が 2 回(管理画面と先読み)送られた。ログイン画面でも入口は読み込まれ、先読みは 401 で失敗するが、例外は外に出ない(テストで確かめた)。根拠: 実測のみ

## 2. 入口のテスト

`tests/admin/admin-entry.test.tsx`(12 件)。根拠: 実測のみ

- **読み込み直し**: `vi.resetModules()` のあとで `import("../../src/admin")` し、続けて部品のモジュール(`ImageField` など)を import する。入口が読み込んだものと同じモジュールが返るので、`toBe` で「部品そのもの」を比べられる(`{ ...thumbnailColumn, label: "Image" }` のような上書きも見つかる)。`vi.mock` の登録は `vi.resetModules()` のあとも残る。
- **`@emdash-cms/admin`**: 画像管理ページが実行時に `useCurrentUser` を読み込むので、`vi.mock("@emdash-cms/admin", () => ({ useCurrentUser: vi.fn() }))` にする(本物は jsdom で数秒)。ページの探し方のテストだけ、本物を `vi.importActual` で読み、`PluginAdminProvider` と `usePluginPage` で、`/images`・`/images/`・`/`(プラグインページのボタン)で画像管理ページが見つかり、無いパスは `null` になることを確かめる(1 件で約 1.9 秒)。
- **サーバー側の宣言との対応**: `createPlugin().admin` の `fieldWidgets` の名前と `fields` のキー、`pages` のパスと入口の `pages` のキーを比べる。jsdom の中でも `src/index.ts` は読み込めた(約 0.3 秒)。
- **先読み**: `fetch` を `vi.stubGlobal` で差し替えてから読み込み、(1) 読み込んだだけで `GET /_emdash/api/manifest` が CSRF のヘッダー付きで 1 回送られる、(2) 応答が届いてから開いた一覧は、最初の判定からフィールドの無いコレクションに列を出さない(要求は増えない)、(3) 比べるため、入口を通さずに列だけを読み込むと最初の判定は `true`、(4) 先読みが 401 でも読み込みは失敗せず、次の判定で取り直す、を確かめる。

```ts
async function loadEntry() {
	vi.resetModules();
	const entry = await import("../../src/admin");
	const [{ ImageField }, { GalleryField }, { ImagesPage }, column] = await Promise.all([
		import("../../src/admin/ImageField"),
		import("../../src/admin/GalleryField"),
		import("../../src/admin/ImagesPage"),
		import("../../src/admin/ThumbnailColumn"),
	]);
	return { entry, ImageField, GalleryField, ImagesPage, column };
}
```

- 入口を 17 通りに壊し、16 通りでテストが失敗した。残る 1 つは、先読みを `queueMicrotask` で 1 マイクロタスク遅らせたもので、`import()` が終わる前に要求が出るので、動きは変わらない([[T30-admin-entry#ミューテーションテスト|T30]])。

## 3. playground での確認

playground に投稿 3 件(画像 12 枚。`playground/scripts/create-sample-posts.ts`)と、このプラグインのフィールドの無いコレクション `notes`(`title` だけ。schema API で作った)を用意し、Playwright で操作した。根拠: 実測のみ

| 確かめたこと | 開発サーバー | 本番のビルド |
|---|---|---|
| ダッシュボードの読み込みで、マニフェストの要求が 2 回(管理画面 + 先読み) | Chromium・Firefox | Chromium・Firefox |
| サイドバーの「プラグイン」に「画像」(英語は「Images」)。押すと画像管理ページ(「画像の管理」、10 行)が開く | Chromium・Firefox | Chromium・Firefox |
| ダッシュボードから SPA で最初に開いた Notes の一覧に列が出ない。直接開いた Notes と、非表示の `b64_images` の一覧にも出ない | Chromium(Firefox は SPA の Notes だけ) | 同じ |
| Posts の一覧に「画像」(英語は「Image」)の列とサムネイル。1 ページ目のサムネイルの要求は 1 回 | Chromium・Firefox | Chromium・Firefox |
| コマンドパレットで「画像」を選ぶと、画像管理ページが開く(404 にならない) | Chromium | Chromium |
| プラグインの管理画面の「プラグインページ」(`aria-label` は「プラグインページ」)で画像管理ページが開く | Chromium | Chromium |
| 新規作成の画面で、`#field-cover` は fieldset(単一画像の widget)、`#field-gallery` はドロップゾーンのボタン(ギャラリーの widget)。textarea は無い | Chromium・Firefox | Chromium・Firefox |
| カバーに 2400×1600 の JPEG、ギャラリーに PNG 2 枚をアップロード(要求 3 件、すべて 200)。代替テキストを入れて保存すると 201、保存した値は参照(カバーは 1600×1067 と代替テキスト、ギャラリーは 2 件) | Chromium | Chromium |
| 保存のあと URL は `/_emdash/admin/content/posts/<ID>?locale=en`。読み込み直すと、`preview` を widget ごとに 1 回送り、保存した画像と代替テキストが出る | Chromium | Chromium |
| 一覧に戻ると、保存した投稿の行にサムネイル | Chromium | Chromium |
| Block Kit のページの要求(`POST /_emdash/api/plugins/base64-image/admin`) | 0 回 | 0 回 |
| API の 4xx・5xx | 無し | 無し |

- 保存のすぐあとにも `preview` が widget ごとに 1 回送られた。新規作成の保存でエントリ ID が決まり、widget が作り直されるため([[emdash-plugin-field-widget#3. 新規作成を保存すると widget は作り直される]])。
- console に出たものは、どれも EmDash 側のもの([[emdash-admin-console-noise]]): 本番のビルドでコマンドパレットの項目を選んだときの Lingui の警告(空のメッセージ)、Firefox の本番のビルドの CSP の違反(zod の eval の確認)、Firefox でサイドバーをスクロールしたときの警告。
- 開発用ログイン(dev-bypass)は本番のビルドでは 403 なので、開発サーバーで保存した Playwright の `storageState` を使った([[emdash-admin-content-list-columns#再現手順]] と同じ)。

### プラグインの管理画面の「プラグインページ」

- プラグインの管理画面は、`hasAdminPages` で有効なプラグインのカードに「プラグインページ」(`Plugin pages`)のボタンを出し、`to="/plugins/$pluginId/$"`・`_splat: ""` で開く(`admin/src/components/PluginManager.tsx:525-534`)。リンクは `/_emdash/admin/plugins/base64-image`(末尾の `/` なし)だった。
- 管理画面は `usePluginPage(<ID>, "/")` で探し、`/` に部品が無ければ `pages` の最初の部品を出す(`admin/src/lib/plugin-context.tsx:72-74`)。T30 の前(`pages` なし)は Block Kit のページになる。根拠: 実測+公式ドキュメント

## 4. 管理画面の JS の大きさ

playground の本番のビルド(`playground/dist/client/_astro/*.js`)を、入口が仮実装のとき(`bb05e05`)と組み立てたあとで比べた。gzip は level 9、brotli は既定。根拠: 実測のみ

| | 仮実装(`fields = {}`) | 組み立てたあと | 差 |
|---|---|---|---|
| JS 全体(38 ファイル) | 12,818,815 B | 12,922,082 B | +103,267 B |
| gzip | 3,577,498 B | 3,610,027 B | +32,529 B |
| 管理画面の本体のチャンク(`PluginRegistry.*.js`) | 8,099,851 B(gzip 1,926,617 B) | 8,203,118 B(gzip 1,959,146 B) | +103,267 B |

- 増えた分は、すべて管理画面の本体のチャンクに入った(ほかのファイルは同じ大きさ)。管理画面の本体は、仮実装のときからこのチャンクにある。管理画面だけにある文字列(「This entry is open somewhere else」など)は、このチャンクと各言語の辞書にしか無く、`@emdash-cms/admin` は重複していない。画像管理ページの `useCurrentUser` が管理画面と同じ React Query の結果を共有できるのは、このため。
- 「Some chunks are larger than 500 kB」の警告は、仮実装のときから出ている(管理画面の本体が 8MB)。
- zod(4.5.4。インストールされているのは 1 つ)も、このチャンクの中で管理画面と共有している。管理画面が遅れて読み込む別のチャンク(`listing-policy.*.js`)にも、zod の同じ処理(eval の確認)がある。

## 5. b64_images の無いサイト

playground を写した使い捨てのサイト(`spikes/t30-no-b64/site/`、git 管理外)で、seed から `b64_images` を外し、組み立てた入口のまま Chromium 153 で操作した(開発サーバー)。根拠: 実測のみ

| 操作 | 編集者に見えるもの | サーバーのログ |
|---|---|---|
| マニフェスト | `collections` は `posts` だけ | — |
| カバーに 2400×1600 の JPEG を選ぶ | 読み込み・圧縮のあと、約 0.6 秒で「画像を保存するコレクション b64_images がありません。サイトの設定を確認してください。」(値は変わらない) | `Failed to create the image entry { … message: "Collection 'b64_images' not found" }`。アップロードは 500 `IMAGE_COLLECTION_MISSING` |
| ギャラリーに PNG 2 枚 | ファイル名ごとに同じ文(2 件) | 同じ(1 枚ごと) |
| 画像なしで投稿を保存 | 201(保存できる) | 最初の保存で、作り方(seed か schema API、`hidden: true` など)を書いたエラー([[emdash-native-plugin-lifecycle-hooks]]) |
| 画像管理ページ | 「画像はありません。」(設定の誤りは示さない) | — |
| 一覧の列 | 「—」(画像なし) | — |

- ブラウザの console には、アップロードの 500 の読み込みエラーが 1 枚ごとに出た。
- 先に知らせる表示(マニフェストの `collections` に `b64_images` が無ければ widget や画像管理ページで知らせる)は作らないことにした。理由は [[T30-admin-entry#決めたこと]]。

## 6. 再現手順

```sh
npm ci
node e2e/fixtures/make-images.ts                        # 入力画像(e2e/fixtures/images/)
npm run dev -w playground -- --port 4430
node playground/scripts/create-sample-posts.ts --base http://localhost:4430
curl -s -c cookies.txt -o /dev/null "http://localhost:4430/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin"
# このプラグインのフィールドの無いコレクション
curl -s -b cookies.txt -H 'X-EmDash-Request: 1' -H 'Content-Type: application/json' \
  -X POST http://localhost:4430/_emdash/api/schema/collections --data '{"slug":"notes","label":"Notes","supports":["drafts"]}'
curl -s -b cookies.txt -H 'X-EmDash-Request: 1' -H 'Content-Type: application/json' \
  -X POST http://localhost:4430/_emdash/api/schema/collections/notes/fields --data '{"slug":"title","label":"Title","type":"string","required":true}'
curl -s -b cookies.txt -H 'X-EmDash-Request: 1' -H 'Content-Type: application/json' \
  -X POST http://localhost:4430/_emdash/api/content/notes --data '{"slug":"note-1","data":{"title":"Note 1"}}'
# Playwright で確かめる(下の抜粋)。終わったら止める
npm run dev -w playground -- stop
lsof -nP -iTCP:4430 -sTCP:LISTEN   # 何も出ないこと
# 本番のビルド: 開発サーバーで storageState を保存してから
npm run build -w playground && npm run preview -w playground -- --port 4430
npm run preview -w playground -- stop
```

```js
// Playwright(抜粋)。日本語は cookie emdash-locale=ja(Path=/_emdash)
// 初回ログインの歓迎ダイアログは、読み込みが落ち着いたあとで出る。待ってから閉じる
const welcome = page.getByRole("button", { name: /はじめる|Get Started/ });
if (await welcome.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) await welcome.click();
// サイドバーの項目
await page.locator('a[href="/_emdash/admin/plugins/base64-image/images"]').first().click();
// 一覧の列: 見出しの aria-label(ja は「画像」、en は「Image」)の位置の td を読む
// プラグインの管理画面のボタン(サイドバーの /images を除く)
await page.locator('main a[href^="/_emdash/admin/plugins/base64-image"]:not([href$="/images"])').first().click();
// 編集画面: 単一画像は #field-cover の中の input、ギャラリーは multiple の input
await page.locator('#field-cover input[type="file"]').setInputFiles("e2e/fixtures/images/photo-2400x1600.jpg");
await page.locator("#field-cover").getByText("画像を追加しました。").waitFor();
await page.locator('input[type="file"][multiple]').setInputFiles(["e2e/fixtures/images/gallery-01.png", "e2e/fixtures/images/gallery-02.png"]);
await page.getByText("2 枚の画像を追加しました。").waitFor();
```

- `b64_images` の無いサイトは、playground の `astro.config.mjs`・`tsconfig.json`・`src/` を写し、`seed/seed.json` から `b64_images` を外した。`package.json` には playground と同じ `dependencies` を書く(依存はインストールせず、worktree の `node_modules` を使う)。`dependencies` を書かないと、Astro が `emdash` をバンドルの対象にせず、開発サーバーが「Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. Received protocol 'astro:'」で動かなかった(実測のみ)。起動はサイトのディレクトリで `node <worktree>/node_modules/astro/bin/astro.mjs dev --port 4430`([[astro-dev-background-for-agents]])。
