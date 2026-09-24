/**
 * 編集画面の開き方ごとの、アップロードの保存先(`target`。仕様書 7 章、docs/emdash-admin-content-editor-url.md)。
 *
 * widget は URL から `target` を求め、`entryId` と `locale` は、URL に両方があるときだけ送る。
 * - 新規作成: どちらも送らない。保存すると URL に ID と `?locale=` が付き、widget は作り直される
 * - コンテンツ一覧から開く: `?locale=<エントリのロケール>` が付くので、両方を送る
 * - ダッシュボードの「最近の更新」・コマンドパレットから開く: `?locale=` が付かないので、どちらも送らない
 */

import type { Page, Request } from "@playwright/test";

import type { UploadTarget } from "./support/api";
import {
	clickSave,
	contentRow,
	coverWidget,
	entryIdFromUrl,
	filterContentList,
	galleryWidget,
	openCommandPalette,
	openNewPost,
	recordUploads,
	waitForEditor,
} from "./support/admin";
import { fixture, PLUGIN_API } from "./support/env";
import { ACCEPTED, galleryImage } from "./support/images";
import { expect, test } from "./support/test";

/** 単一画像とギャラリーに 1 枚ずつ上げ、送った `target` を返す */
async function uploadToBothFields(page: Page): Promise<UploadTarget[]> {
	const uploads = recordUploads(page);
	const cover = coverWidget(page);
	await cover.fileInput.setInputFiles(fixture(ACCEPTED.webp));
	await expect(cover.status).toHaveText("画像を追加しました。");
	const gallery = galleryWidget(page);
	await gallery.fileInput.setInputFiles([fixture(galleryImage(3))]);
	await expect(gallery.progress).toHaveText("画像を追加しました。");
	return uploads.targets();
}

function isPreviewRequest(request: Request): boolean {
	return new URL(request.url()).pathname === `${PLUGIN_API}/preview`;
}

test("新規作成: entryId と locale を送らない。保存すると widget が作り直され、そのあとは両方を送る", async ({
	page,
	token,
}) => {
	const uploads = recordUploads(page);
	const previews: Request[] = [];
	page.on("request", (request) => {
		if (isPreviewRequest(request)) previews.push(request);
	});
	await openNewPost(page);
	await page.getByRole("textbox", { name: "Title" }).fill(`E2E target new ${token}`);
	const cover = coverWidget(page);
	// 作り直されたかを見る目印
	await cover.root.evaluate((element) => element.setAttribute("data-e2e-marker", "before-save"));
	await cover.fileInput.setInputFiles(fixture(ACCEPTED.webp));
	await expect(cover.status).toHaveText("画像を追加しました。");
	await cover.alt.fill("保存する代替テキスト");
	expect(uploads.targets()).toEqual([{ collection: "posts", field: "cover" }]);

	const previewsBeforeSave = previews.length;
	expect((await clickSave(page)).status()).toBe(201);
	await page.waitForURL(/\/_emdash\/admin\/content\/posts\/[0-9A-Z]{26}\?locale=en$/);
	const id = entryIdFromUrl(page);
	// 作り直された: 目印が消え、プレビューを取り直し、保存した値(代替テキスト)で表示する
	await expect(cover.root).not.toHaveAttribute("data-e2e-marker", "before-save");
	await expect.poll(() => previews.length).toBeGreaterThan(previewsBeforeSave);
	await expect(cover.preview).toBeVisible();
	await expect(cover.alt).toHaveValue("保存する代替テキスト");
	await expect(cover.status).toHaveText("");

	// 差し替えのアップロードは、エントリ ID とロケールを送る
	await cover.fileInput.setInputFiles(fixture(ACCEPTED.pngAlpha));
	await expect(cover.status).toHaveText("画像を追加しました。");
	expect(uploads.targets()).toEqual([
		{ collection: "posts", field: "cover" },
		{ collection: "posts", field: "cover", entryId: id, locale: "en" },
	]);
});

test("コンテンツ一覧から開いた編集: URL に ?locale=en が付き、entryId と locale を送る", async ({
	page,
	api,
	token,
}) => {
	const title = `E2E target list ${token}`;
	const post = await api.createPost({ title, slug: `e2e-target-list-${token}` });
	await page.goto("/_emdash/admin/content/posts");
	await filterContentList(page, "Posts", token, 1);
	await contentRow(page, title).getByRole("link", { name: title, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/_emdash/admin/content/posts/${post.id}\\?locale=en$`));
	await waitForEditor(page);
	expect(await uploadToBothFields(page)).toEqual([
		{ collection: "posts", field: "cover", entryId: post.id, locale: "en" },
		{ collection: "posts", field: "gallery", entryId: post.id, locale: "en" },
	]);
});

test("ダッシュボードの「最近の更新」から開いた編集: ?locale= が付かず、entryId と locale を送らない", async ({
	page,
	api,
	token,
}) => {
	const title = `E2E target dashboard ${token}`;
	const post = await api.createPost({ title, slug: `e2e-target-dashboard-${token}` });
	const recent = page.getByRole("main").getByRole("link", { name: title });
	// 「最近の更新」は、画像のエントリも含めて新しい順に 10 件。並列に動くほかのテストの更新で押し出されるので、
	// 投稿を更新し直してから読み込み直す
	await expect(async () => {
		expect((await api.updateEntry("posts", post.id, { title })).ok()).toBe(true);
		await page.goto("/_emdash/admin/");
		await expect(recent).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 30_000 });
	await expect(recent).toHaveAttribute("href", `/_emdash/admin/content/posts/${post.id}`);
	await recent.click();
	await expect(page).toHaveURL(new RegExp(`/_emdash/admin/content/posts/${post.id}$`));
	await waitForEditor(page);
	expect(await uploadToBothFields(page)).toEqual([
		{ collection: "posts", field: "cover" },
		{ collection: "posts", field: "gallery" },
	]);
});

test("コマンドパレットから開いた編集: ?locale= が付かず、entryId と locale を送らない", async ({
	page,
	api,
	token,
}) => {
	// コマンドパレットの検索は、公開済みのエントリだけを返す(global setup が posts の検索を有効にしている)
	const title = `E2E target palette ${token}`;
	const post = await api.createPost({ title, slug: `e2e-target-palette-${token}`, publish: true });
	await page.goto("/_emdash/admin/");
	await expect(page.getByRole("heading", { level: 1, name: "ダッシュボード" })).toBeVisible();
	const palette = await openCommandPalette(page);
	await palette.search.fill(token);
	await palette.dialog.getByRole("option", { name: title }).click();
	await expect(page).toHaveURL(new RegExp(`/_emdash/admin/content/posts/${post.id}$`));
	await waitForEditor(page);
	expect(await uploadToBothFields(page)).toEqual([
		{ collection: "posts", field: "cover" },
		{ collection: "posts", field: "gallery" },
	]);
});
