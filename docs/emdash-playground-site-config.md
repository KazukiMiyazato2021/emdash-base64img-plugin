---
title: storage を指定しない EmDash サイト(Node + SQLite)の設定とビルド
aliases:
  - playground の設定
  - storage を省略したときの既定
  - EmDash の fonts false
  - astro build とネットワーク
tags:
  - docs
  - emdash
  - playground
  - astro
  - build
source_task: "[[T02-playground]]"
created: 2026-09-24
updated: 2026-09-24
---

# storage を指定しない EmDash サイト(Node + SQLite)の設定とビルド

> [!summary] 要点
> - **`storage` を省略しても「storage なし」にはならない。** EmDash 0.39.1 は `./.emdash/uploads` の local storage を既定で使い、Node ではメディアのアップロードが成功する(201)。本当に無効にするには `storage: false`(型定義には無い)を渡す。このときアップロードは 500 `NO_STORAGE` になる。
> - 管理画面のフォントは、既定では Google Fonts の Noto Sans をビルド時と開発サーバーの起動時に取得する。**`fonts: false` にすると管理画面が `FontFamilyNotFound` で表示できない**(EmDash 0.39.1 の不具合)。playground は、`--font-emdash` を `local()` だけのプロバイダーで自前で登録した。
> - この設定の `astro build` は、データベースにもネットワークにも触れず、約 2 秒で終わる。`.emdash/migrations.json` を書き出す。
> - 開発サーバーが生成する `playground/emdash-env.d.ts` は、prettier のチェックで必ず失敗する。ルートの `.prettierignore` で除外する必要がある。
> - 関連: [[T02-playground]]、[[playground/README|playground の README]]、[[base64-image-plugin-spec#2.3 storage なしで使えなくなる EmDash の機能|仕様書 2.3]]、[[base64-image-plugin-spec#13.3 `astro.config.mjs`|仕様書 13.3]]、[[astro-dev-background-for-agents]]

## playground の設定

```js
// playground/astro.config.mjs(抜粋)
const localFontProvider = {
	name: "playground-local-font",
	resolveFont: () => ({
		fonts: [{ src: [{ name: "Noto Sans" }], weight: "100 900", style: "normal" }],
	}),
};

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	fonts: [
		{
			provider: localFontProvider,
			name: "EmDash Admin",
			cssVariable: "--font-emdash",
			fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
		},
	],
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./data.db" }),
			plugins: [base64ImagePlugin()],
			fonts: false,
		}),
	],
	devToolbar: { enabled: false },
});
```

- データベースは `file:./data.db`。パスは `process.cwd()` から解決される(`references/emdash/packages/core/src/db/sqlite.ts` の `createDialect`)。`npm run dev -w playground` は playground のディレクトリで動くので、`playground/data.db` になる。根拠: **実測+公式ドキュメント**
- playground からプラグインは `file:..` で参照する([[npm-workspaces-nested-worktree]])。依存の追加は不要だった(`package-lock.json` は変わらない)。根拠: **実測のみ**

## storage を省略したとき

- 省略すると、integration が既定の local storage を入れる(`references/emdash/packages/core/src/astro/integration/index.ts:71-75`、`:335` の `storage: config.storage ?? DEFAULT_STORAGE`)。公式ドキュメントにも「省略すると `./.emdash/uploads` に保存する」とある(`references/emdash/docs/src/content/docs/reference/configuration.mdx:73`)。根拠: **公式ドキュメントのみ**
- 実測: `POST /_emdash/api/media`(1×1 の PNG)は 201 になり、`playground/.emdash/uploads/<ULID>.png` ができた。管理画面にも「Media」と「Upload Media」が出る。根拠: **実測+公式ドキュメント**
- `storage: false` を渡すと、`??` は `false` を置き換えないので storage のモジュールが空になり(`references/emdash/packages/core/src/astro/integration/virtual-modules.ts:151-159`)、実行時の storage は `null` になる(`references/emdash/packages/core/src/emdash-runtime.ts:2316-2330`)。実測で、アップロードは 500 `{"code":"NO_STORAGE"}` になった。管理画面の「Media」と「Upload Media」は表示されたままだった。posts の作成は通った。根拠: **実測+公式ドキュメント**
- ただし `storage` の型は `StorageDescriptor`(`references/emdash/packages/core/src/astro/integration/runtime.ts:199`)で、`false` は型の上では許されない。`.mjs` の設定ファイルでは型チェックされないので動く。根拠: **公式ドキュメントのみ**

> [!warning] 仕様書 2.3 と 13.3 への影響
> 仕様書は「storage を指定しない = メディアのアップロードが `NO_STORAGE` になる」を前提にしている。Node では成り立たない。Cloudflare で省略したとき(local storage の `node:fs` が workerd でどう動くか)は未確認で、[[T32-cloudflare-check|T32]] で確かめる必要がある。playground は指示どおり `storage` を省略したので、標準のメディア機能が使える状態になっている。

## 管理画面のフォント

EmDash は `fonts` を省略すると、Astro の Font API で Noto Sans(Google Fonts)を登録する(`references/emdash/packages/core/src/astro/integration/index.ts:535-560`)。「フォントはビルド時に Google からダウンロードして自前で配信する」と説明されている(`references/emdash/packages/core/src/astro/integration/runtime.ts:568-601`)。根拠: **公式ドキュメントのみ**

ビルドの時間と結果(`npm run build -w playground`)。ネットワークなしは、macOS の `sandbox-exec` で外向きの通信を禁止して試した。

| フォントの設定 | ネットワーク | フォントのキャッシュ | 結果 | 時間 |
|---|---|---|---|---|
| 既定 | あり | なし | 成功。16 ファイルを取得 | 4.64 秒 |
| 既定 | あり | あり | 成功 | 3.50 秒 |
| 既定 | なし | なし | 成功するが、`fonts.google.com` への再試行(3 回)とスタックトレース、`No data found for font family Noto Sans` が出る。管理画面のフォントは入らない | 11.07 秒 |
| 既定 | なし | あり | 成功。警告なし | 1.91 秒 |
| `fonts: false` | なし | — | ビルドは成功。**管理画面が `FontFamilyNotFound` で表示できない** | 2.73 秒 |
| `fonts: false` + `resolveFont` が `undefined` を返すプロバイダー | なし | — | 成功。`No data found for font family …` の警告が 3 行出る | 1.98 秒 |
| `fonts: false` + `local()` を返すプロバイダー(採用) | なし | — | 成功。警告なし | 2.57 秒 |
| 同上 | あり | — | 成功 | 1.95〜2.00 秒(3 回) |

根拠: すべて **実測のみ**

- キャッシュの場所: `playground/.astro/fonts/`(プロバイダーのメタデータなど)と `playground/node_modules/.astro/fonts/`(woff2、約 2.4MB)。新しい worktree では空なので、既定のままだと最初のビルドでネットワークを使う。根拠: **実測のみ**
- `fonts: false` で壊れる理由: 管理画面の `references/emdash/packages/core/src/astro/routes/admin.astro:87` が `<Font cssVariable="--font-emdash" />` を無条件に描画する。登録されていない変数を渡すと、Astro の `Font.astro` が `FontFamilyNotFound` を投げる(`node_modules/astro/components/Font.astro:13-19`)。根拠: **実測+公式ドキュメント**
- フォントのデータが空でも、ファミリーが登録されていれば `Font.astro` は例外を出さない(`node_modules/astro/dist/assets/fonts/core/compute-font-families-assets.js:14-40` は警告して続ける)。そこで、同じ `cssVariable` を自前で登録した。`local()` のソースを返すと、警告も出ない。根拠: **実測+公式ドキュメント**
- 生成される CSS(`dist/server/chunks/_astro_assets_*.mjs`)。端末に Noto Sans があれば使い、無ければ system-ui などになる。根拠: **実測のみ**

```css
@font-face{font-family:"EmDash Admin-62e8dbe1eba7186e";src:local("Noto Sans");font-display:swap;font-weight:100 900;font-style:normal;}
/* --font-emdash: "EmDash Admin-62e8dbe1eba7186e", ui-sans-serif, system-ui, sans-serif; */
```

## astro build の挙動

- データベースに触れない。`data.db` が無い状態でビルドしても成功し、`data.db` は作られなかった。根拠: **実測のみ**
- EmDash は `astro build` / `astro sync` のときに、マイグレーションのマニフェストを `<root>/.emdash/migrations.json` に書く(`references/emdash/packages/core/src/astro/integration/index.ts:628-652`、`references/emdash/packages/core/src/migrations/manifest-writer.ts:13`)。タブでインデントした JSON なので、prettier のチェックは通った。根拠: **実測+公式ドキュメント**
- `Some chunks are larger than 500 kB after minification` の警告が毎回出る。EmDash の管理画面のバンドルで、失敗ではない。根拠: **実測のみ**
- `@astrojs/node` はセッションをファイルに保存する(`Enabling sessions with filesystem storage`)。保存先は Astro の cacheDir の `sessions`(= `playground/node_modules/.astro/sessions`。`node_modules/@astrojs/node/dist/index.js:41-44`)。根拠: **実測+公式ドキュメント**

## 生成されるファイル

| パス | 作るもの | いつ | git | prettier(`npm run lint`) |
|---|---|---|---|---|
| `playground/data.db` | EmDash(`node:sqlite`) | 最初のリクエスト | ルートの `.gitignore`(`*.db`) | 対象外 |
| `playground/emdash-env.d.ts` | EmDash の型生成 | 開発サーバーの起動時と、スキーマの変更時 | `playground/.gitignore` | **対象。必ず失敗する** |
| `playground/.emdash/migrations.json` | EmDash | `astro build` | `playground/.gitignore` | 対象。通る |
| `playground/.emdash/uploads/` | local storage | メディアのアップロード | `playground/.gitignore` | 対象外(画像) |
| `playground/.astro/` | Astro(型、`dev.json`、`dev.log`、フォント) | 起動・ビルド | ルートの `.gitignore` | `.prettierignore` で除外 |
| `playground/dist/` | `astro build` | ビルド | ルートの `.gitignore` | `.prettierignore` で除外 |
| `playground/node_modules/.astro/`、`.vite/` | Astro・Vite(セッション、フォント、依存の最適化) | 起動・ビルド | `node_modules/` | 対象外 |

根拠: **実測のみ**

- `emdash-env.d.ts` は `process.cwd()` に書かれる(`references/emdash/packages/core/src/astro/integration/dev-typegen.ts:38`)。中身は 2 スペースのインデントで、末尾に改行が無い(`references/emdash/packages/core/src/schema/zod-generator.ts:355-399` の `lines.join("\n")`)。prettier は末尾に改行を必ず付けるので、どう設定しても差分になる。根拠: **実測+公式ドキュメント**
- prettier 3.9.8 は、入れ子の `.gitignore` / `.prettierignore` を読まない(`sub/.gitignore` と `sub/.prettierignore` に書いたファイルも、ルートからの `prettier --check .` で警告された)。そのため `playground/.gitignore` では除外できない。根拠: **実測のみ**
- 開発サーバーを一度でも起動すると、ルートの `.prettierignore` に `playground/emdash-env.d.ts` が無い限り、`npm run lint`(`npm run verify`)が失敗する。それまでは、`npm run verify` の前に `playground/emdash-env.d.ts` を消す。oxlint は、このファイルを含めて 11 ファイルを調べ、指摘は無かった。根拠: **実測のみ**

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2、emdash 0.39.1、Astro 7.3.3、@astrojs/node 11.1.6、Vite 8.3.0、prettier 3.9.8、oxlint 1.83.0。ネットワークなしの計測は `sandbox-exec -p '(version 1)(allow default)(deny network-outbound (remote ip "*:*"))'` の中で `npm run build -w playground` を実行した。2026-09-24 に計測。
