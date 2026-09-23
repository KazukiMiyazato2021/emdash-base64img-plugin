---
title: git 依存 + TS ソースのプラグインを利用者のサイトで読み込む
aliases:
  - git 依存の TS ソース
  - TS ソースのまま配布する
  - プラグインのビルドの要否
tags:
  - docs
  - distribution
  - vite
  - astro
  - cloudflare
  - typescript
source_task: "[[T07-spike-git-dependency]]"
created: 2026-09-24
updated: 2026-09-24
---

# git 依存 + TS ソースのプラグインを利用者のサイトで読み込む

> [!summary] 要点
> - TS ソースのまま(`files: ["src"]`、ビルドなし)のプラグインを git 依存で入れたサイトで、Node アダプター(`astro dev` / `astro build` / `astro preview`)と Cloudflare アダプター(`astro build` + `wrangler dev`、`astro dev`)のすべてで、サーバー側・サイト側・管理画面の入口を読み込めた。**ビルドは入れない。**
> - Vite は `.ts` / `.tsx` の入口を SSR で外部化しない。Cloudflare の worker の環境はそもそも `noExternal: true`。EmDash はプラグインを特別扱いしていない。
> - npm 12 は git 依存を既定で拒否する。サイトの `.npmrc` に `allow-git=root` が要る → [[npm12-git-dependency-policy]]
> - Cloudflare アダプターの `astro dev` では、最初のリクエストでプラグインが依存の最適化に加わり、1 回だけ再読み込みが起きる。サイトの `vite.ssr.optimizeDeps.include` に入れると起きない。
> - 利用者の `astro check` は、プラグインの `src` の型エラーを報告しない。`tsc` は報告する。TypeScript 5.x、`lib` を絞った設定、`strict: false` では `src/shared/data-url.ts` がエラーになる(TypeScript 6.0.3 / 7.0.2 の既定と strictest では 0 件)。
> - `emdash migrate --from-config` は、Node が `node_modules` の中の `.ts` を読めないので失敗する。EmDash はこの経路をローカルの調査用としていて、デプロイでは build のマニフェストを使う。
> - 関連: [[T07-spike-git-dependency]]、[[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14 章]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|仕様書 16 章]]、[[emdash-native-plugin-entrypoints]]、[[emdash-playground-site-config]]、[[emdash-dependency-versions]]、[[npm12-git-dependency-policy]]

## 確かめた構成

- 使い捨てのサイト `spikes/git-dependency/site/`: playground の設定と seed を複製した。ルートの workspaces には入れず、そのディレクトリの中で `npm install` した。Node 用の `astro.config.mjs` と、Cloudflare 用の `astro.config.cloudflare.mjs`(仕様書 13.3 の形。`storage` は指定しない)を並べた。
- 入れたプラグインは 2 つ。
  1. 実際のコミット: `git+file:///Users/home/sandbox/emdash-base64img-plugin#2779d00913fd506f58d57f7b250ec70c98f72645`(`phase/2`)
  2. フィクスチャー: 上のコミットのコピーに、後のタスクで入る形を足した使い捨ての git リポジトリ(`spikes/git-dependency/fixture-plugin`、コミット `b940ce6`)。JSX の widget(hooks と Kumo の `Button`)、拡張子なしの相対 import、T03 の zod スキーマを入力にした公開ルート、サイト側の関数を持つ。`src/shared` は `phase/2` と同じ。
- 目印の文字列(`T07_SERVER_MARKER` / `T07_ASTRO_MARKER` / `T07_ADMIN_WIDGET_MARKER`)で、ビルド結果と実行結果を確かめた。
- spike は worktree の中にあり、上の階層に `node_modules` がある。`tsc --listFilesOnly` で、サイトの外のファイル(TypeScript 自身の lib を除く)を読んでいないことを確かめた。

## 結果

| 経路 | 実際のコミット | フィクスチャー | 根拠 |
|---|---|---|---|
| Node `astro dev` | `/` が 200。マニフェストに `base64-image`(`adminMode: "react"`)。管理画面が入口を読み込む | 公開ルート・入力検証(不正なら 400)・サイト側の関数・widget の描画(Chromium 153・Firefox 155) | 実測+公式ドキュメント |
| Node `astro build` | 成功。サーバーのバンドルに `//#region node_modules/emdash-plugin-base64-image/src/index.ts` | 3 つの目印がすべて入る(管理画面の目印はクライアントのバンドルだけ) | 実測のみ |
| Node `astro preview` | `/` が 200。マニフェストに登録 | ルート・ページ・widget の描画 | 実測のみ |
| Cloudflare `astro build` | 成功。`dist/server/chunks/middleware_*.mjs` に同じ region | 3 つの目印が入る | 実測のみ |
| Cloudflare `wrangler dev` | 起動。`/` が 200。管理画面の `PluginRegistry.*.js` に `"base64-image"` | ルート(workerd には `Uint8Array.fromBase64` がある)・入力検証・ページ・目印入りのチャンクの読み込み | 実測のみ |
| Cloudflare `astro dev`(追加で確認) | — | 動く。最初のリクエストで依存の再最適化と再読み込みが 1 回起きる([[#Cloudflare アダプターの astro dev の再最適化]]) | 実測+公式ドキュメント |

### Node の SSR で外部化されない理由

- Vite 8.3.0 は、解決した入口の拡張子が `.js` / `.mjs` / `.cjs` / 拡張子なし のときだけ外部化する(`node_modules/vite/dist/node/chunks/node.js:6823` の `canExternalizeFile`)。`./src/index.ts` などは外部化されず、Vite が変換してバンドルに入れる。ビルド結果の `dist/server` にも `from "emdash-plugin-base64-image"` は残らなかった。根拠: **実測+公式ドキュメント**
- EmDash の `ssr.noExternal` は `emdash` と `@emdash-cms/admin` だけで、プラグインを特別扱いする設定は無い(`references/emdash/packages/core/src/astro/integration/vite-config.ts:481-602`)。根拠: **公式ドキュメントのみ**
- Node 26 でプラグインを直接 import すると、`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`(`node_modules` の中の型は除去しない)で失敗する。根拠: **実測のみ**
- Astro 7.3.3 は、設定ファイルを最初に Node の `import()` で読み、失敗したら Vite で読み直す(`node_modules/astro/dist/core/config/vite-load.js:14`、`:26-29`)。git 依存では Node の読み込みが上のエラーで失敗し、Vite に切り替わる。根拠: **実測+公式ドキュメント**(`import("./astro.config.mjs")` の失敗と dev・build の成功は実測、切り替えはソースから。Astro の debug ログは `--verbose` でも出なかった)

### Cloudflare(workerd)

- Cloudflare の Vite プラグインは、worker の環境を `resolve.noExternal: true` にする(`node_modules/@cloudflare/vite-plugin/dist/index.mjs:66636`)。ビルドではすべてバンドルされ、`dist/server/wrangler.json` は `no_bundle: true` になる。根拠: **実測+公式ドキュメント**
- `wrangler dev` は、`.wrangler/deploy/config.json` のリダイレクトで `dist/server/wrangler.json` を使う。アダプターが `SESSION`(KV)・`IMAGES`・`ASSETS` のバインディングを足し、いずれもローカルで動いた。根拠: **実測のみ**
- 空の D1 では `/` がセットアップ画面に転送される。セットアップ画面へのアクセスでマイグレーションが走ったあとは描画された(`references/emdash/packages/core/src/astro/middleware.ts:721-733`)。根拠: **実測+公式ドキュメント**
- 本番ビルドでは開発用ログインが 403 で、マニフェストは 401 になる。サーバー側の読み込みは、公開ページと公開ルート(フィクスチャー)で確かめた。公開ページでも runtime の初期化(プラグインの生成を含む)が走る(`middleware.ts:742-752`)。根拠: **実測+公式ドキュメント**

### 管理画面の入口(`./admin` の `.tsx`)

- 開発時: 仮想モジュール `virtual:emdash/admin-registry` が `import * as admin0 from "/node_modules/emdash-plugin-base64-image/src/admin.tsx"` を出力し、Vite がソースを変換して配信した。`.vite/deps` の事前バンドルは通らない。Vite が事前バンドルの対象にするのは `/\.[cm]?[jt]s$/` に合う入口だけ(`node.js:716` の `OPTIMIZABLE_ENTRY_RE`、`:2067` の `isOptimizable`)。根拠: **実測+公式ドキュメント**
- widget の `.tsx` から import した `react` / `@cloudflare/kumo` は、管理画面と同じものが使われた(`useState` が動き、コンソールのエラーは 0)。根拠: **実測のみ**
- ビルド: 管理画面の `PluginRegistry.*.js` に入る(Node・Cloudflare とも)。サーバーのバンドルには入らない。根拠: **実測のみ**

### Cloudflare アダプターの astro dev の再最適化

キャッシュ(`node_modules/.vite`)を消して起動し、最初に公開ルートを呼んだときのログ(2 回とも同じ):

```text
dependency optimized: emdash-plugin-base64-image
optimized dependencies changed. reloading
[vite] program reload
[200] /_emdash/api/plugins/base64-image/ping 3521ms
```

- Vite は、サーバー側の環境では依存の自動検出を既定で無効にする(`node_modules/vite/dist/node/chunks/node.js:36823` の `noDiscovery: consumer !== "client"`)。Cloudflare の Vite プラグインは、worker の環境でこれを有効に戻す(`node_modules/@cloudflare/vite-plugin/dist/index.mjs:66662` の `noDiscovery: false`)。worker の環境は `noExternal: true` でもあるので、`node_modules` の中のプラグインは依存の最適化(事前バンドル)の対象になる。根拠: **公式ドキュメントのみ**
- プラグインの本体は仮想モジュール `virtual:emdash/plugins` からしか import されず、EmDash は `virtual:emdash` を最初の走査から除外している(`vite-config.ts:505`)。そのため起動時には見つからず、最初のリクエストで見つかる。根拠: **実測+公式ドキュメント**
- EmDash は、`node_modules` から入れたパッケージがセッションの途中で再最適化されると、読み込み済みのモジュールが消えたチャンクを参照して書き込みが失敗しうると書いている(`vite-config.ts:495-503`)。今回は、再読み込みのあとで投稿の作成(201)と widget の表示ができた。根拠: **実測+公式ドキュメント**
- 対策: サイトの設定で、workerd 用の依存の最適化に最初から含める。キャッシュを消して起動し直すと、再最適化のメッセージが出ず、`node_modules/.vite/deps_ssr` にプラグインの 2 つの入口(`.` と `./astro`)が作られた。根拠: **実測のみ**

```js
// astro.config.mjs(Cloudflare アダプターのサイト)
export default defineConfig({
	// …
	vite: { ssr: { optimizeDeps: { include: ["emdash-plugin-base64-image"] } } },
});
```

- playground は workspace のリンク(`node_modules` の外)なので、最適化の対象にならない見込み。根拠: **推測のみ**(EmDash のコメントの「workspace symlink は最適化されない」から)
- Node アダプターの `astro dev` では、プラグインによる再最適化は起きなかった。サーバー側の環境の自動検出が、上の既定どおり無効なため。根拠: **実測+公式ドキュメント**

## `files: ["src"]`

- `npm pack --dry-run`: 17 ファイル(`package.json` と `src/**`)。playground・tests・e2e・docs・plans・tasks・spikes・tsconfig は入らない。根拠: **実測のみ**
- git 依存で入れた `node_modules/emdash-plugin-base64-image` も同じ中身になった(npm は git のチェックアウトを pack してから入れる)。空の `.gitkeep` も入るが害は無い。プラグインの devDependencies は入らず、追加されたのはプラグインの 1 パッケージだけだった。根拠: **実測のみ**
- サイトのロックファイルの項目に、プラグインの `"workspaces": ["playground"]` がそのまま記録される。依存の workspaces は使われないので影響は無い。根拠: **実測のみ**
- 公式の `@emdash-cms/plugin-color@0.2.0` と `@emdash-cms/plugin-forms@0.2.7` も、`main: "src/index.ts"`、`./admin` が `.tsx` のまま npm に公開されている(`npm view`)。npm から入れたこれらも、git 依存と同じく `node_modules` の中の TS ソースになる。sandboxed 形式のプラグインは `dist` を配る(`virtual-modules.ts` の `TS_SOURCE_EXT_RE` で TS ソースを拒否する)。根拠: **公式ドキュメントのみ**

## 利用者側の型チェック

- `astro check`(EmDash のテンプレートの `typecheck`): プラグインの `src` の型エラーを報告しない。陽性対照として、入れたプラグインの `astro.ts` と `index.ts` にわざと型エラーを入れ、ページと利用者の `.ts` から import しても 0 件だった。報告するのはプロジェクトのファイル(6 ファイル)だけ。根拠: **実測のみ**
- `tsc --noEmit`: 陽性対照のエラーを報告した。`skipLibCheck` の対象は `.d.ts` だけなので、`.ts` のまま配る `src` は検査される。辿られる経路は 2 つあった。根拠: **実測のみ**
  - Astro の既定の `include`(`**/*`)と `allowJs` で `astro.config.mjs` が入り、そこから `src/index.ts` 以下(フィクスチャーで 9 ファイル)
  - 利用者の `.ts` が `emdash-plugin-base64-image/astro` を import したとき(`src/astro.ts` 以下)
- 管理画面の `.tsx` は、利用者のコードが `/admin` を import しない限り辿られない。明示的に含めても、`jsx: preserve`(Astro の既定)・`react-jsx` のどちらでも 0 件だった。

プラグインのエラーの件数(フィクスチャーの 13 ファイルを `include` に明示。表の「実際に辿られる範囲」以外は、辿られる範囲より広い):

| TypeScript | 利用者の設定 | プラグインのエラー |
|---|---|---|
| 6.0.3 | テンプレートの形(strict、`include: ["src", …]`)、実際に辿られる範囲 | 0 |
| 6.0.3 | Astro の base / strict / strictest | 0 |
| 6.0.3 | strictest + `noPropertyAccessFromIndexSignature` / `erasableSyntaxOnly` / `noUncheckedSideEffectImports` | 0 |
| 6.0.3 | `jsx: "react-jsx"`、`types: []` | 0 |
| 6.0.3 | `lib: ["es2022", "dom", "dom.iterable"]` | 4(`data-url.ts:119`・`:120`・`:142` の `fromBase64` / `toBase64`) |
| 6.0.3 | `strict: false` | 2(`data-url.ts:173`・`:175`) |
| 5.9.3 / 5.8.3 | base(strict なし) | 6(上の 4 + 2) |
| 5.9.3 / 5.8.3 | strict / strictest、strict で実際に辿られる範囲 | 4 |
| 7.0.2 | base / strictest | 0 |

根拠: すべて **実測のみ**

- `Uint8Array.fromBase64` / `toBase64` の型は、TypeScript 6 の既定の lib にはあるが、TypeScript 5.x の lib と ES2022 に絞った lib には無い。根拠: **実測のみ**
- `if (!decoded.ok) return decoded;` は、`strictNullChecks` が無効だと絞り込まれない。TypeScript 6 は `strict` の既定が有効なので、`strict` を書かない base でも出ない(`strict: false` を明示すると出る)。根拠: **実測のみ**
- `@astrojs/check` 0.9.10 の peer は `typescript: ^5.0.0 || ^6.0.0`。EmDash のテンプレートは TypeScript を直接の依存に書いていないので、npm が peer として 6.0.3 を入れる。TypeScript 5.x を固定しているサイトだけが上の表の 5.x の行に当たる。根拠: **実測+公式ドキュメント**(`npm view`、`references/emdash/templates/*/package.json`)

試した対策(spike の中のコピーだけで確認。`src/shared/data-url.ts` は [[T04-webp-utils|T04]] の担当のファイル)。TypeScript 5.8.3 / 5.9.3 / 6.0.3 / 7.0.2 の上の全設定で 0 件になった。根拠: **実測のみ**(型チェックだけ。実行は確かめていない)

```ts
/** 利用者の lib に esnext.typedarrays が無くても型が通るよう、使う形だけを自前で宣言する */
interface Base64Uint8ArrayConstructor {
	fromBase64?: (base64: string, options: { lastChunkHandling: "strict" }) => Uint8Array;
}
interface Base64Uint8Array {
	toBase64?: () => string;
}

// decodeWithRuntime の中
const { fromBase64 } = Uint8Array as unknown as Base64Uint8ArrayConstructor;
if (typeof fromBase64 === "function") {
	return fromBase64.call(Uint8Array, base64, { lastChunkHandling: "strict" });
}

// encodeBase64 の中
const { toBase64 } = bytes as unknown as Base64Uint8Array;
if (typeof toBase64 === "function") return toBase64.call(bytes);

// parseWebpDataUrl の中(strictNullChecks が無効でも絞り込まれる)
if (decoded.ok === false) return decoded;
if (parsed.ok === false) return parsed;
```

- zod: サイトでは、プラグインがサイト直下の 4.6.5、`emdash` が入れ子の 4.5.4 を使った(`astro` の依存 `^4.5.4` が 4.6.5 を選ぶため)。T03 のスキーマ(4.6.5)をルートの `input` に渡しても、型チェック(0 件)と実行(検証と 400)の両方で問題なかった。根拠: **実測のみ**
- 利用者の `src/worker.ts`(EmDash のテンプレートと同じ `satisfies ExportedHandler`)は、strictest で TS1360 になった。利用者のコードの問題で、プラグインとは関係ない。根拠: **実測のみ**

## `emdash migrate --from-config`

- `emdash migrate --check`(`astro build` が書く `.emdash/migrations.json` を読む)は成功した。根拠: **実測のみ**
- `emdash migrate --from-config --check` は、`Stripping types is currently unsupported for files under node_modules` で失敗した(終了コード 1)。EmDash は Vite の `loadConfigFromFile` で設定を読み(`references/emdash/packages/core/src/migrations/config-loader.ts:104-134`)、このときプラグインは外部の依存として Node に読まれる。根拠: **実測+公式ドキュメント**
- EmDash のドキュメントは、`--from-config` をローカルの調査用とし、デプロイでは build のマニフェストを使うよう書いている(`references/emdash/docs/src/content/docs/deployment/core-migrations.mdx:43`)。影響は小さい。TS ソースの公式プラグイン(`@emdash-cms/plugin-forms` など)を npm から入れたサイトでも同じになる見込み。根拠: **公式ドキュメントのみ**(公式プラグインでの確認はしていない)

## 再現の手順

```sh
# 1. サイトを作る(playground の seed と live.config.ts を複製し、下のファイルを置く)
cd spikes/git-dependency/site
npm install                                   # Astro・アダプター・wrangler など(min-release-age=3 のまま)
npm install --min-release-age=0 --save-exact emdash@0.39.1 @emdash-cms/cloudflare@0.39.1   # EmDash 0.39.1 の例外
#    → 監査して overrides を足し、npm install(手順は [[npm12-git-dependency-policy#spike のロックファイルの監査]])
npm install --min-release-age=0 "emdash-plugin-base64-image@git+file:///Users/home/sandbox/emdash-base64img-plugin#<commit>"

# 2. Node アダプター
npx astro dev --port 4407          # エージェントから実行するとバックグラウンドで起動する。止めるのは npx astro dev stop
npx astro build && npx astro preview --port 4407

# 3. Cloudflare アダプター
npx astro build --config astro.config.cloudflare.mjs
WRANGLER_SEND_METRICS=false npx wrangler dev --port 8707 --inspector-port 9307 --ip 127.0.0.1
npx astro dev --config astro.config.cloudflare.mjs --port 4407

# 4. 型チェック
npx astro check
npx tsc --noEmit -p tsconfig.default-strict.json
```

`site/package.json`(抜粋)と `.npmrc`:

```json
{
	"dependencies": {
		"@astrojs/cloudflare": "14.3.2",
		"@astrojs/node": "^11.1.5",
		"@astrojs/react": "^6.0.5",
		"@emdash-cms/cloudflare": "0.39.1",
		"astro": "^7.3.2",
		"emdash": "0.39.1",
		"emdash-plugin-base64-image": "git+file:///Users/home/sandbox/emdash-base64img-plugin#2779d00913fd506f58d57f7b250ec70c98f72645",
		"react": "19.2.4",
		"react-dom": "19.2.4"
	},
	"devDependencies": {
		"@astrojs/check": "0.9.10",
		"@cloudflare/workers-types": "5.20260920.1",
		"typescript": "6.0.3",
		"wrangler": "4.135.0"
	}
}
```

```ini
# site/.npmrc
allow-git=root
```

Cloudflare 用の設定(Node 用は playground と同じで、プラグインの import 元だけが git 依存になる):

```js
// astro.config.cloudflare.mjs(抜粋。フォントは playground と同じ local() のプロバイダー)
export default defineConfig({
	output: "server",
	adapter: cloudflare({ inspectorPort: 9307 }), // astro dev のときだけ使う。並列の作業とぶつからないポートにする
	integrations: [
		react(),
		emdash({ database: d1({ binding: "DB", session: "auto" }), plugins: [base64ImagePlugin()], fonts: false }),
	],
});
```

```jsonc
// wrangler.jsonc(src/worker.ts は templates/starter-cloudflare と同じ)
{
	"name": "t07-git-dependency",
	"main": "./src/worker.ts",
	"compatibility_date": "2026-02-24",
	"compatibility_flags": ["nodejs_compat"],
	"d1_databases": [{ "binding": "DB", "database_name": "t07-git-dependency", "database_id": "t07-git-dependency-local" }],
}
```

フィクスチャーのサーバー側の入口(抜粋):

```ts
import type { PluginDescriptor, RouteContext } from "emdash";
import { definePlugin } from "emdash";

import { pingPayload } from "./server/marker"; // 拡張子なしの相対 import
import { PLUGIN_ID, WIDGET_KINDS } from "./shared/constants";
import { previewRequestSchema } from "./shared/schema";
import type { PreviewRequest } from "./shared/types";

// routes は Record<string, PluginRoute>(入力は unknown)なので、型付きの RouteContext を受け取る関数を渡す(公式の forms プラグインと同じ形)
async function echoHandler(ctx: RouteContext<PreviewRequest>) {
	return { ids: ctx.input.ids, count: ctx.input.ids.length };
}

export function createPlugin() {
	return definePlugin({
		id: PLUGIN_ID,
		version: "0.0.0",
		admin: {
			entry: "emdash-plugin-base64-image/admin",
			fieldWidgets: WIDGET_KINDS.map((name) => ({ name, label: name, fieldTypes: ["json" as const] })),
		},
		routes: {
			ping: { public: true, handler: async () => pingPayload() },
			echo: { public: true, input: previewRequestSchema, handler: echoHandler },
		},
	});
}
```

- 公開ルートは `GET /_emdash/api/plugins/base64-image/ping`、`POST …/echo`。`public: true` のルートは認証と CSRF の確認を飛ばす(`references/emdash/packages/core/src/plugins/types.ts:1771-1774`)。
- widget は `src/admin.tsx` で `export const fields = { image: ImageFieldMarker, gallery: ImageFieldMarker }` とし、`ImageFieldMarker.tsx` で JSX・`useState`・Kumo の `Button`・`../shared/options` を使った。
- 管理画面の確認は Playwright(`@playwright/test` 1.63.0)で、開発用ログイン → `/_emdash/admin/content/posts/new` → 目印の文字列を待つ。本番ビルドでは、開発時に curl で作ったセッションの Cookie を渡した(Node アダプターのセッションはファイル保存なので preview でも有効)。

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2、Astro 7.3.3、Vite 8.3.0、rolldown 1.2.9、@vitejs/plugin-react 5.2.0、@astrojs/node 11.1.6、@astrojs/react 6.0.6、@astrojs/cloudflare 14.3.2、@cloudflare/vite-plugin 1.56.0、wrangler 4.135.0(workerd 1.20260918.1、miniflare 5.20260918.0-alpha)、emdash / @emdash-cms/cloudflare 0.39.1、@astrojs/check 0.9.10(@astrojs/language-server 2.17.0)、TypeScript 6.0.3(ほかに 5.8.3 / 5.9.3 / 7.0.2 を scratchpad に入れて比較)、Playwright 1.63.0(Chromium 153、Firefox 155)。2026-09-24 に計測。
