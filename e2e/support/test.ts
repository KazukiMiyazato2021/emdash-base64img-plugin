/**
 * E2E の `test` と `expect`。Playwright の標準に、次のフィクスチャを足す。
 *
 * - `api`: 管理者として API を呼ぶ(データの準備と確認。`./api.ts`)。ブラウザのロールとは関係なく管理者。
 * - `consoleGuard`: ブラウザの console の警告・エラーを見張る(`./console-guard.ts`)。`page` の終わりに確かめる。
 * - `token`: このテストだけの目印(英小文字と数字)。投稿のタイトルと slug に入れて、ほかのテストのデータと区別する
 *   (テストは並列に動き、データベースを共有する)。
 *
 * フィクスチャの 2 つ目の引数は、Playwright のドキュメントでは `use` と書くが、ここでは `provide` と呼ぶ。
 * oxlint の react の規則(rules-of-hooks)が、`use(...)` を React の `use` の呼び出しと見なすため。
 */

import { test as base, expect } from "@playwright/test";

import { AdminApi } from "./api";
import { ConsoleGuard } from "./console-guard";
import { authStatePath, BASE_URL } from "./env";

interface Fixtures {
	api: AdminApi;
	consoleGuard: ConsoleGuard;
	token: string;
}

let tokenSequence = 0;

export const test = base.extend<Fixtures>({
	api: async ({ playwright }, provide) => {
		const request = await playwright.request.newContext({
			baseURL: BASE_URL,
			storageState: authStatePath("admin"),
		});
		await provide(new AdminApi(request));
		await request.dispose();
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright のフィクスチャは、使うものが無くても分割代入で受ける
	consoleGuard: async ({}, provide) => {
		await provide(new ConsoleGuard());
	},
	page: async ({ page, consoleGuard }, provide) => {
		consoleGuard.watch(page);
		await provide(page);
		consoleGuard.assertClean();
	},
	// oxlint-disable-next-line no-empty-pattern -- 同上
	token: async ({}, provide, testInfo) => {
		tokenSequence += 1;
		const random = Math.random().toString(36).slice(2, 7);
		await provide(
			`${testInfo.project.name.slice(0, 2)}${testInfo.workerIndex}${tokenSequence}${random}`,
		);
	},
});

export { expect };
