/**
 * E2E(Playwright 1.63.0、Chromium と Firefox。仕様書 15 章、tasks/T31-e2e.md)。
 *
 * 実行(リポジトリのルートで): npm run test:e2e
 * - playground の開発サーバー(ポート 4431。`E2E_PORT` で変えられる)を、空のデータベースで起動してから動かし、
 *   終わったら止める(`e2e/support/start-dev-server.ts`)。すでにポートに応答があれば、そのサーバーとデータベースを使う
 *   (テストは自分で作ったデータだけを見るので、データが残っていても動く)。
 * - 前準備(入力画像・ログイン・ロールの利用者・テスト用のコレクション)は `e2e/global-setup.ts`。
 * - `chromium` と `firefox` は同じテスト(`*.spec.ts`)を動かす。ブラウザを使わない API のテスト(`*.api.spec.ts`)は `api` で 1 回だけ。
 * - 入力画像は macOS の `sips` で作るので、macOS でだけ動く(e2e/fixtures/README.md)。
 */

import { defineConfig, devices } from "@playwright/test";

import { authStatePath, BASE_URL, PORT } from "./e2e/support/env";

const VIEWPORT = { width: 1280, height: 900 };

export default defineConfig({
	testDir: "./e2e",
	outputDir: "./test-results",
	fullyParallel: true,
	workers: 4,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	forbidOnly: true,
	reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
	globalSetup: "./e2e/global-setup.ts",
	use: {
		baseURL: BASE_URL,
		storageState: authStatePath("admin"),
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			testMatch: /(?<!\.api)\.spec\.ts$/,
			use: { ...devices["Desktop Chrome"], viewport: VIEWPORT },
		},
		{
			name: "firefox",
			testMatch: /(?<!\.api)\.spec\.ts$/,
			use: { ...devices["Desktop Firefox"], viewport: VIEWPORT },
		},
		{
			name: "api",
			testMatch: /\.api\.spec\.ts$/,
		},
	],
	webServer: {
		command: `node e2e/support/start-dev-server.ts --port ${PORT}`,
		url: `${BASE_URL}/`,
		reuseExistingServer: true,
		timeout: 120_000,
		gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
		stdout: "ignore",
		stderr: "pipe",
	},
});
