/**
 * 管理画面の入口(T30。docs/emdash-admin-entry-assembly.md の 3 章・6 章): サイドバーの項目・コマンドパレット・
 * プラグインの管理画面の「プラグインページ」から画像管理ページが開くこと、編集画面に widget が描かれること
 * (標準の textarea に落ちないこと)、Block Kit のページの要求を送らないこと。
 */

import type { Page, Request } from "@playwright/test";

import { openCommandPalette, openNewPost } from "./support/admin";
import { PLUGIN_API } from "./support/env";
import { imagesPage } from "./support/pages";
import { expect, test } from "./support/test";

const IMAGES_PAGE_PATH = "/_emdash/admin/plugins/base64-image/images";

/** Block Kit のページの要求(入口に `pages` が無いと、管理画面はこれでページを描こうとする) */
function recordBlockKitRequests(page: Page): Request[] {
	const requests: Request[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.startsWith(`${PLUGIN_API}/admin`)) requests.push(request);
	});
	return requests;
}

async function openDashboard(page: Page): Promise<void> {
	await page.goto("/_emdash/admin/");
	await expect(page.getByRole("heading", { level: 1, name: "ダッシュボード" })).toBeVisible();
}

test("サイドバーの「画像」から、画像管理ページが開く", async ({ page, api }) => {
	// 空のデータベースでは表が出ない(「画像はありません。」)ので、1 枚上げておく
	await api.uploadImage({ collection: "posts", field: "cover" });
	const blockKit = recordBlockKitRequests(page);
	await openDashboard(page);
	// 画面の高さ 900px では、項目はサイドバーの下にある(押すとサイドバーがスクロールする)
	const link = page
		.getByRole("complementary", { name: "管理ナビゲーション" })
		.getByRole("link", { name: "画像", exact: true });
	await expect(link).toHaveAttribute("href", IMAGES_PAGE_PATH);
	await link.click();
	await expect(page).toHaveURL(IMAGES_PAGE_PATH);
	await expect(imagesPage(page).heading).toBeVisible();
	await expect(imagesPage(page).table).toBeVisible();
	expect(blockKit).toHaveLength(0);
});

test("コマンドパレットで「画像」を選ぶと、画像管理ページが開く", async ({ page }) => {
	const blockKit = recordBlockKitRequests(page);
	await openDashboard(page);
	const palette = await openCommandPalette(page);
	await palette.search.fill("画像");
	await palette.dialog.getByRole("option", { name: "画像", exact: true }).click();
	await expect(page).toHaveURL(IMAGES_PAGE_PATH);
	await expect(imagesPage(page).heading).toBeVisible();
	expect(blockKit).toHaveLength(0);
});

test("プラグインの管理画面の「プラグインページ」で、画像管理ページ(pages の最初の部品)が開く", async ({
	page,
}) => {
	const blockKit = recordBlockKitRequests(page);
	await page.goto("/_emdash/admin/plugins-manager");
	await expect(page.getByRole("heading", { level: 3, name: "base64-image" })).toBeVisible();
	const link = page.getByRole("main").getByRole("link", { name: "プラグインページ" });
	await expect(link).toHaveAttribute("href", "/_emdash/admin/plugins/base64-image");
	await link.click();
	await expect(page).toHaveURL("/_emdash/admin/plugins/base64-image");
	await expect(imagesPage(page).heading).toBeVisible();
	expect(blockKit).toHaveLength(0);
});

test("編集画面には、このプラグインの widget が描かれる(標準の textarea ではない)", async ({
	page,
}) => {
	await openNewPost(page);
	// 単一画像は fieldset(根)、ギャラリーはドロップゾーンのボタン。どちらも id は `field-<slug>`
	await expect(page.locator("#field-cover")).toHaveJSProperty("tagName", "FIELDSET");
	await expect(page.locator("#field-gallery")).toHaveJSProperty("tagName", "BUTTON");
	await expect(page.locator("textarea#field-cover, textarea#field-gallery")).toHaveCount(0);
	await expect(page.locator('#field-cover input[type="file"]')).toHaveCount(1);
	await expect(page.locator('input[type="file"][multiple]')).toHaveCount(1);
	await expect(page.getByRole("button", { name: /^Cover: / })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Gallery: / })).toBeVisible();
});
