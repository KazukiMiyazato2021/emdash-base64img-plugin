---
title: EmDash 0.39.1 のプラグインの管理ページ(admin.pages)の登録と、サイドバーのラベルの翻訳
aliases:
  - プラグインの管理ページの登録
  - admin.pages のラベル
  - サイドバーのラベルの翻訳(Lingui の ID)
  - プラグインのページで useCurrentUser を使う
  - プラグインのページから一覧の列の覚え書きを消す
tags:
  - docs
  - emdash
  - admin
  - lingui
  - i18n
source_task: "[[T25-images-page]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 のプラグインの管理ページ(admin.pages)の登録と、サイドバーのラベルの翻訳

> [!summary] 要点
> - ページは 2 か所で登録する。サーバー側の `definePlugin({ admin: { entry, pages: [{ path, label, icon }] } })` がサイドバーとコマンドパレットの項目(マニフェストの `adminPages`)になり、管理画面の入口の `export const pages = { "<path>": Component }` が描く部品になる。部品は `/_emdash/admin/plugins/<プラグイン ID><path>` に、props なしで、管理画面の枠(サイドバー・ヘッダー)の中に描かれる。根拠: 実測+公式ドキュメント
> - サイドバーとコマンドパレットは、`label` を管理画面の Lingui で訳す(`i18n._(label)`)。辞書のキーは Lingui の 6 文字の ID なので、**文字列の「Images」は訳されない**(日本語の画面でも「Images」)。本番のビルドでは、描き直しのたびに「Uncompiled message detected!」が出た(ページを開き、コマンドパレットで検索し、別のページへ移って戻る操作で 7 回)。**辞書にある「Images」の ID `an5hVd` を渡すと、日本語は「画像」、英語は「Images」になり、警告も出なかった。** 根拠: 実測+公式ドキュメント
> - `an5hVd` は、0.39.1 の管理画面の 29 の辞書(pseudo を含む)のすべてにある(訳が英語と同じ「Images」の言語もある)。根拠: 実測のみ
> - プラグインのページの項目は、サイドバーの「プラグイン」(Plugins)のグループに出る。**ロールで絞られない**(閲覧者にも出る)。根拠: 実測+公式ドキュメント
> - ページの部品は管理画面の React Query と Lingui の中で描かれるので、`@emdash-cms/admin` の `useCurrentUser()` がそのまま使える。管理画面と同じ `["currentUser"]` の結果を共有し、`GET /_emdash/api/auth/me` は読み込みごとに 1 回だけだった(開発サーバーと本番のビルド)。根拠: 実測+公式ドキュメント
> - ページの部品と一覧の列(`contentListColumns`)は、同じ入口から読み込まれ、モジュールの変数を共有する(管理画面の中を移っても読み込み直されない)。ページで一覧の列の覚え書きを消すと、次に開いた一覧が取り直した。マニフェストの覚え書きも消したときは、すぐに読み直さないと、フィールドの無いコレクションに空の列が出た([[#ページから一覧の列の覚え書きを消す]])。根拠: 実測のみ
> - 関連: [[T25-images-page]]、[[base64-image-plugin-spec#11.5 画像管理ページ|仕様書 11.5]]、[[emdash-admin-content-list-columns]](一覧の列の `label` も同じく `i18n._` を通る)、[[emdash-admin-locale-lang]]、[[kumo-dialog-confirm-a11y]]

> [!info] 計測の方法と環境
> - playground を複製した使い捨てのサイト(`spikes/images-page/site/`、git 管理外)に、T29・T30 の代わりにルート・hook・画像管理ページを登録した(ID `base64-image`。[[#再現手順]])。ラベルを比べるため、同じ部品を 3 つのパスに、3 通りのラベルで登録した。
> - Playwright(Chromium 153.0.8010.12、ヘッドレス)で管理画面を操作した。開発サーバー(`astro dev`)と本番のビルド(`astro build` + `astro preview`)の両方で確かめた。ポートは 4425。
> - macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、`emdash` / `@emdash-cms/admin` 0.39.1、Astro 7.3.3、React 19.2.4、`@lingui/core` 5.9.5、`@tanstack/react-query` 5.90.21、Playwright 1.63.0。2026-09-24 に計測。
> - 行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。

## 登録の形

| 側 | 書く場所 | 中身 | 使われ方 |
|---|---|---|---|
| サーバー | `definePlugin({ admin: { entry, pages } })` | `pages: [{ path: "/images", label: "an5hVd", icon: "image" }]`(`PluginAdminPage` は `label` が必須。`core/src/plugins/types.ts:1826-1830`) | マニフェストの `adminPages`(`core/src/emdash-runtime.ts:2915-2940`)。`admin.entry` があると `adminMode: "react"` |
| 管理画面 | descriptor の `adminEntry` が指すモジュール | `export const pages = { "/images": ImagesPage }` | 管理画面の起動時に静的に読み込まれる(`core/src/astro/integration/virtual-modules.ts:327-359`) |

- 描画: ルート `/plugins/$pluginId/$` が、`"/" + splat` をキーにして `pages` から部品を探し、props なしで描く。見つからなければ Block Kit のページ(サンドボックス)として扱う(`admin/src/router.tsx:2729-2747`)。キーは `/` から始める。末尾の `/` の有無は区別しない。`/` を開いたときは最初のページになる(`admin/src/lib/plugin-context.tsx:65-76`)。根拠: 実測+公式ドキュメント(`pages` に登録し、`admin.pages` に無いパスも開けた)
- サイドバーの項目は、マニフェストの `adminPages` のうち、`pages` に部品があり、パスが安全なもの(`/^\/[a-z0-9][a-z0-9/_-]*$/i`、`.` と `..` を含まない。`blocks/src/validation.ts:54`、`:132-139`)だけ(`admin/src/components/Sidebar.tsx:488-503`)。
- アイコンは名前で指定する。`image` は Phosphor の `Image`(`admin/src/components/admin-navigation-icons.ts:90`、`:135`)。
- このプラグインでは、`admin.pages` を T29(`src/index.ts`)、`pages` を T30(`src/admin.tsx`)が書き、どちらも `src/shared/constants.ts` の `IMAGES_PAGE`(`{ path: "/images", label: "an5hVd", icon: "image" }`)を使う。T29 は `pages: [IMAGES_PAGE]`、T30 は `{ [IMAGES_PAGE.path]: ImagesPage }`。`path` と `pages` のキーが食い違うと、上の条件でサイドバーに項目が出ない([[T25-images-page#T29・T30 への登録のしかた]]、[[T25-2-page-registration-prep|T25-2]])。
  - `IMAGES_PAGE` は `PluginAdminPage`(`{ path: string; label: string; icon?: string }`。`core/src/plugins/types.ts:1826-1830`)の形そのままで、`emdash` の `PluginAdminConfig` の `pages` に入れられることを型のテストで確かめている。`path` は `/` から始めるので、サイドバーのリンク(`normalizePluginPagePath(page.path)`。`blocks/src/validation.ts:128-130`、`admin/src/components/Sidebar.tsx:496-499`)と、部品を探すキー(`"/" + splat`)が同じ文字列になる。根拠: 実測+公式ドキュメント(テストで `isSafePluginPagePath` と `normalizePluginPagePath` を通した。定数で登録したページが、実際の管理画面のサイドバーのリンクから開けた)

## ラベルの翻訳

`resolvePluginPageLabel(label, pluginId, translate)` は、`label` があれば `translate(label)` を返す。サイドバーは `(id) => i18n._(id)`、コマンドパレットも同じく共有の Lingui で訳す(`admin/src/components/Sidebar.tsx:321-341`、`:497`、`admin/src/components/AdminCommandPalette.tsx:251-271`)。辞書のキーは Lingui の ID(`sha256(メッセージ + "\u001F" + 文脈)` の base64 の先頭 6 文字)。根拠: **実測+公式ドキュメント**

| `label` | 日本語(サイドバー) | 英語(サイドバー) | 「Uncompiled message detected!」 |
|---|---|---|---|
| `"an5hVd"`(「Images」の ID) | 画像 | Images | 0 回(開発・本番) |
| `"Images"`(文字列) | Images(訳されない) | Images | 開発 0 回、**本番 7 回**(ページを開き、コマンドパレットで検索し、ダッシュボードへ移って戻る操作で。日本語と英語で同じ) |
| `"hG89Ed"`(「Image」の ID) | 画像 | Image | 0 回(開発・本番) |

- 警告の本文は「Uncompiled message detected! Message: > Images …」。本番のビルドでは Lingui にコンパイラーが無く、辞書に無い文字列がそのまま訳として使われると警告する([[emdash-admin-content-list-columns#列の見出し(label)と Lingui の ID]])。
- コマンドパレットの検索は、訳したタイトルと、キーワード(`plugin` とプラグイン ID)で絞る(`AdminCommandPalette.tsx:259-266`、`:276-289`)。日本語で「画像」と入力すると ID の 2 件が出て、文字列の「Images」の項目は出なかった。英語で「Images」と入力すると、EmDash の「Media Library」と、非表示のコレクション `b64_images` のラベル「Base64 Images」も出た。根拠: 実測のみ
- `an5hVd` の訳は、0.39.1 の 29 の辞書(`@emdash-cms/admin/dist/locales/<言語>/messages.mjs`)のすべてにある。訳が英語と同じ「Images」の言語もある(eu・fa・fr・ko・pl)。`tests/admin/ImagesPage.test.tsx` が、`@emdash-cms/admin/locales` の `SUPPORTED_LOCALES` と `loadMessages` で、すべての言語に訳があることを確かめている(EmDash を上げたときに気付ける)。根拠: 実測のみ
- EmDash の辞書から ID が消えると、サイドバーに `an5hVd` がそのまま出る。ドキュメントには、プラグインが自分の辞書を共有の Lingui に読み込む方法もある(`docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx:225-262`)が、このプラグインは `@lingui/core` を依存に持たないので採らない([[emdash-admin-content-list-columns]] と同じ)。

## ロールと表示

- サイドバーの項目はロールで絞る(`filterNavItemsByRole`。`minRole` の無い項目は全員に出る。`Sidebar.tsx:65-70`)が、プラグインのページの項目には `minRole` が付かない(`Sidebar.tsx:488-503`、グループは `:609-615`)。閲覧者(ロール 10)でも「プラグイン」のグループにページが出て、開けた。そのため、ページの中で権限の無いことを伝える必要がある(画像管理ページは、一覧のルートの 403 で「寄稿者以上のロールで行えます」を出す)。根拠: 実測+公式ドキュメント
- ロールは開発用の管理者の `users.role` を `node:sqlite` で書き換えて変えた。EmDash はリクエストごとに読み直すので、ページを読み込み直すと反映された([[image-management-routes#再現手順]] と同じ)。

## useCurrentUser を使う

`@emdash-cms/admin` は `useCurrentUser` を export している(`admin/src/lib/api/index.ts:419`、`admin/src/index.ts:11`)。中身は `useQuery({ queryKey: ["currentUser"], queryFn: fetchCurrentUser, staleTime: 5 分, retry: false })` で、`fetchCurrentUser` は `GET /_emdash/api/auth/me` の `data`(`{ id, email, name, role, avatarUrl, isFirstLogin }`)を返す(`admin/src/lib/api/current-user.ts:20-31`)。根拠: **実測+公式ドキュメント**

- プラグインのページは管理画面の `QueryClientProvider` の中で描かれるので、そのまま使えた。開発サーバーと本番のビルドのどちらでも、ロールに合わせてボタンが出た。
- 管理画面のヘッダーやサイドバーと結果を共有する。ページの読み込みごとの `GET /_emdash/api/auth/me` は 1 回だった(このページが 2 回目を送らない)。
- `fetchCurrentUser` は、エラーの文言を作るために、応答を待ったあとで管理画面の Lingui(`i18n._`)を呼ぶ。管理画面の中では Lingui が有効なので問題ない。jsdom のテストで本物を使うときは、`i18n.loadAndActivate({ locale: "en", messages: {} })` と `QueryClientProvider` が要る([[emdash-admin-content-list-columns#fetchManifest は、管理画面の Lingui が有効になる前に呼ぶと失敗する]] と同じ理由)。根拠: 実測のみ(`tests/admin/ImagesPage.test.tsx` の最後のテスト)
- ページのモジュールが `@emdash-cms/admin` を読み込んでも、管理画面の本体と同じモジュールなので、ブラウザが読み込む量は増えないとみられる。根拠: 推測のみ(バンドルの中身は調べていない)jsdom のテストでは読み込みが重いので(約 2〜4 秒)、ふだんは `vi.mock("@emdash-cms/admin", () => ({ useCurrentUser: vi.fn() }))` で差し替える。

## ページから一覧の列の覚え書きを消す

画像管理ページで画像を完全に削除すると、`imageRefs` の記録が消え、コンテンツ一覧のサムネイル列([[T24-list-column|T24]])の表示が変わる(サムネイル → 警告アイコン)。列は、取得したサムネイルとマニフェストをモジュールの中に 1 分覚えるので、ページから消す([[T25-2-page-registration-prep|T25-2]])。根拠: **実測のみ**(開発サーバーと本番のビルド。環境は冒頭の「計測の方法と環境」と同じ。手順は [[#再現手順]] の 7)

- ページの部品と一覧の列は、どちらも管理画面の入口(descriptor の `adminEntry`)から読み込まれる。管理画面の中を SPA で移っても、モジュールは読み込み直されない。ページで `clearThumbnailColumnCache()` を呼ぶと、次に開いた一覧の列がサムネイルを取り直し、警告アイコンになった。
- `clearThumbnailColumnCache()` はマニフェストの覚え書きも消す。消したままにすると、次に開いた一覧がフィールドの無いコレクションだったとき、空の列が出た。一覧の画面は、`collections` をコレクションなどが変わったときにしか呼ばないため([[emdash-admin-content-list-columns#collections が呼ばれる時]])。消したすぐあとに `preloadThumbnailColumn()` でマニフェストを読み直すと、出なかった。

| 完全削除のあと、ページがすること | 一覧を開く順(SPA) | Posts(フィールドあり)の列 | Pages(フィールドなし) |
|---|---|---|---|
| 何もしない | Posts → Pages | **サムネイルのまま**(取り直さない) | 列なし |
| 消すだけ | Posts → Pages | 警告アイコン | 列なし |
| 消すだけ | Pages → Posts | 警告アイコン | **空の列** |
| 消して、すぐにマニフェストを読み直す(採用) | Posts → Pages、Pages → Posts | 警告アイコン | 列なし |

- 採用した形は、開発サーバーと本番のビルドの両方で 2 つの順を確かめた(ほかの形は開発サーバーだけ)。要求の順は、どれも「マニフェスト 2 回(ダッシュボード)→ サムネイル(Posts)→ `DELETE …/permanent` → マニフェスト(読み直し)→ サムネイル(Posts に戻ったとき)」だった。console の警告・エラーは無かった。
- 完全削除の `content:afterDelete` は応答のあとに実行される(`after()`)。この計測では、一覧に戻ったときには記録が消えていた。応答の直後に一覧を開くと、記録が残っていて、古いサムネイルをもう一度覚えることがありうる。根拠: 推測のみ
- ゴミ箱への移動と公開では、記録も列の表示も変わらない(ゴミ箱の画像にもサムネイルを出す。[[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)|仕様書 11.4]])ので、消さない。ゴミ箱に移した画像が、一覧でサムネイルのまま出ることは確かめた(上の計測の前に、カバーの画像をゴミ箱に移している)。公開は、このプラグインの hook が `b64_images` の保存・公開で `imageRefs` を変えないこと(`src/server/hooks/owners.ts:207`、単体テスト `tests/server/owners.test.ts:275-285`)から判断した(実際の管理画面では確かめていない)。

## 再現手順

1. playground の `astro.config.mjs` / `tsconfig.json` / `seed/` / `src/` / `package.json` を `spikes/images-page/site/` に複製し(依存はインストールせず、worktree の `node_modules` を使う)、`astro.config.mjs` の `plugins` を次の descriptor にする。

```js
plugins: [
	{
		id: "base64-image",
		version: "0.0.0",
		entrypoint: "/plugins/images-page-spike.ts",
		adminEntry: "/plugins/images-page-admin.tsx",
		options: {},
	},
],
```

2. プラグインの定義(ルートと hook は [[playground-site-pages#再現手順]]・[[image-management-routes#再現手順]] と同じ。抜粋)と、管理画面の入口。

```ts
// spikes/images-page/site/plugins/images-page-spike.ts(抜粋)
admin: {
	entry: "/plugins/images-page-admin.tsx",
	pages: [
		{ path: "/images", label: "an5hVd", icon: "image" },
		{ path: "/images-string", label: "Images", icon: "image" },
		{ path: "/images-image", label: "hG89Ed", icon: "image" },
	],
},
```

```tsx
// spikes/images-page/site/plugins/images-page-admin.tsx
import { ImagesPage } from "../../../../src/admin/ImagesPage";

export const fields = {};
export const pages = { "/images": ImagesPage, "/images-string": ImagesPage, "/images-image": ImagesPage };
```

3. サイトのディレクトリで `node ../../../node_modules/astro/bin/astro.mjs dev --port 4425` を実行し(エージェントからはバックグラウンドになる。[[astro-dev-background-for-agents]])、リポジトリのルートで `node playground/scripts/create-sample-posts.ts --base http://localhost:4425 --posts 3 --gallery 3 --trash-cover` で画像を作る。
4. Playwright で開発用ログイン(`/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`)をして `storageState` を保存し、cookie `emdash-locale`(`ja` / `en`、`Path=/_emdash`)を付けて `/_emdash/admin/plugins/base64-image/images` を開く。`a[href*="/plugins/base64-image/"]` の文字を読み、`page.on("console")` で「Uncompiled message detected」を数える。コマンドパレットは ⌘K で開き、「画像」「Images」を入力して `[role="option"]` を読む。
5. 本番のビルドは `… astro.mjs build` のあと `… astro.mjs preview --port 4425`。開発サーバーで保存した `storageState` がそのまま使えた。
6. 最後に `… astro.mjs dev stop` / `… preview stop` で止め、`lsof -nP -iTCP:4425 -sTCP:LISTEN` で何も出ないことを確かめる。
7. [[#ページから一覧の列の覚え書きを消す]]([[T25-2-page-registration-prep|T25-2]])では、seed に Pages(`title` だけ)のコレクションを足し、定義の `admin.pages` を `[IMAGES_PAGE]` にし、管理画面の入口を次の形にした。投稿は `create-sample-posts.ts`(`--posts 2` か `3`、`--gallery 1`)で作った。Playwright で「投稿のカバーの画像をゴミ箱に移す(`images/trash` のルート)→ ダッシュボード → サイドバーで Posts → サイドバーで画像管理ページへ移り、その画像を完全に削除 → サイドバーで Posts と Pages(順を変えて 2 通り)」と操作し、見出しが「画像」の列のセルと、`/_emdash/api/manifest`・`…/thumbnails` の要求を数えた。比べる形は、`src/admin/ImagesPage.tsx` の `refreshThumbnailColumn()` を一時的に書き換えて作った(計測のあとで元に戻した)。本番のビルドでは、投稿を開発サーバーで作ってから止め、`build` と `preview` をした。

```tsx
// spikes/images-page/site/plugins/images-page-admin.tsx(T25-2)
import { ImagesPage } from "../../../../src/admin/ImagesPage";
import { preloadThumbnailColumn, thumbnailColumn } from "../../../../src/admin/ThumbnailColumn";
import { IMAGES_PAGE } from "../../../../src/shared/constants";

preloadThumbnailColumn();

export const fields = {};
export const contentListColumns = [thumbnailColumn];
export const pages = { [IMAGES_PAGE.path]: ImagesPage };
```
