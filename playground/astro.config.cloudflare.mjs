/**
 * playground を Cloudflare Workers(workerd + D1)で動かすときの設定(T32)。
 *
 * - Node 用の `astro.config.mjs` と同じサイトを、Cloudflare アダプターと D1 で動かす。storage(R2)は指定しない
 *   (仕様書 13.3 の形)。wrangler の設定は `wrangler.jsonc`、Worker の入口は `src/worker.ts`。
 * - ビルドして `wrangler dev` で動かす(`npm run build:cloudflare -w playground` → `npm run preview:cloudflare -w playground`)。
 *   開発サーバー(`npm run dev:cloudflare -w playground`)でも使える。手順は playground/README.md。
 * - D1 のローカルの状態は `playground/.wrangler/state/v3`(git 管理外)。開発サーバーと `wrangler dev` は同じものを使う。
 * - ビルドの出力は Node 用と同じ `playground/dist/`。Node 用のビルド(`npm run verify` など)のあとは、
 *   Cloudflare 用にビルドし直してから `wrangler dev` を動かす。
 */
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1 } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { base64ImagePlugin } from "emdash-plugin-base64-image";

/**
 * 管理画面のフォント `--font-emdash` を、ネットワークを使わずに登録するプロバイダー(`astro.config.mjs` と同じ)。
 *
 * EmDash の既定では、ビルドや開発サーバーの起動時に Google Fonts から Noto Sans を取得する。
 * `fonts: false` で止めると、管理画面の `<Font cssVariable="--font-emdash" />` が
 * FontFamilyNotFound で失敗する(EmDash 0.39.1)。そのため、同じ変数を端末のフォント(`local()`)だけで登録する。
 */
const localFontProvider = {
	name: "playground-local-font",
	resolveFont: () => ({
		fonts: [{ src: [{ name: "Noto Sans" }], weight: "100 900", style: "normal" }],
	}),
};

export default defineConfig({
	output: "server",
	// 開発サーバーの workerd のデバッガーのポートを開かない(既定は 9229 から空いているもの。ほかの作業とぶつけない)。
	// `wrangler dev` のデバッガーのポートは、コマンドの `--inspector-port` で決める。
	adapter: cloudflare({ inspectorPort: false }),
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
			database: d1({ binding: "DB", session: "auto" }),
			// storage は指定しない(R2 を使わない)。
			plugins: [base64ImagePlugin()],
			fonts: false,
		}),
	],
	devToolbar: { enabled: false },
});
