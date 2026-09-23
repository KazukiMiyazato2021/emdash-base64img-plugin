import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { sqlite } from "emdash/db";
import { base64ImagePlugin } from "emdash-plugin-base64-image";

/**
 * 管理画面のフォント `--font-emdash` を、ネットワークを使わずに登録するプロバイダー。
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
	adapter: node({
		mode: "standalone",
	}),
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
			// storage は指定しない。EmDash 0.39.1 は、省略すると ./.emdash/uploads の local storage を使う。
			plugins: [base64ImagePlugin()],
			fonts: false,
		}),
	],
	devToolbar: { enabled: false },
});
