import { configDefaults, defineConfig } from "vitest/config";

// DOM が必要なテスト(管理画面の部品とブラウザ側の処理)。それ以外は node 環境で動かす。
const DOM_TESTS = ["tests/admin/**/*.test.{ts,tsx}", "tests/client/**/*.test.{ts,tsx}"];

export default defineConfig({
	test: {
		// テストがまだ 0 件の段階でも `vitest run` を成功させる。
		passWithNoTests: true,
		projects: [
			{
				extends: true,
				test: {
					name: "node",
					environment: "node",
					include: ["tests/**/*.test.{ts,tsx}"],
					exclude: [...configDefaults.exclude, ...DOM_TESTS],
				},
			},
			{
				extends: true,
				test: {
					name: "dom",
					environment: "jsdom",
					include: DOM_TESTS,
					setupFiles: ["./tests/setup/dom.ts"],
				},
			},
		],
	},
});
