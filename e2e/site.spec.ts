/**
 * サイト側の描画(仕様書 12 章。playground の `/posts/`・`/posts/<slug>/`。docs/playground-site-pages.md)。
 * 保存から表示までの通しの確認(カバーとギャラリーの width / height・100,000 バイト以下・priority)は flow.spec.ts。
 */

import type { Locator, Page } from "@playwright/test";

import { failedResourcePattern } from "./support/console-guard";
import { expectSiteImage, readRenderedImage } from "./support/pages";
import { expect, test } from "./support/test";

/** 一覧(新しく公開した順に 10 件ずつ)で、投稿のカードを探す。並列のテストが公開した投稿の分だけ、次のページへ進む */
async function findPostCard(page: Page, postId: string, maxPages = 10): Promise<Locator> {
	await page.goto("/posts/");
	for (let index = 0; index < maxPages; index++) {
		const card = page.locator(`[data-testid="post-card"][data-post-id="${postId}"]`);
		// oxlint-disable-next-line no-await-in-loop -- ページを順にたどる
		if ((await card.count()) > 0) return card;
		const next = page.getByRole("link", { name: "次のページ" });
		// oxlint-disable-next-line no-await-in-loop -- 同上
		if ((await next.count()) === 0) break;
		// oxlint-disable-next-line no-await-in-loop -- 同上
		await next.click();
		// oxlint-disable-next-line no-await-in-loop -- 同上
		await expect(page.getByRole("heading", { level: 1, name: "投稿の一覧" })).toBeVisible();
	}
	throw new Error(`一覧の ${maxPages} ページの中に、投稿 ${postId} のカードがありません`);
}

test("一覧: カードにカバーの img(参照の寸法、data URL)を出し、描画できる最初のカバーだけを priority にする", async ({
	page,
	api,
	token,
}) => {
	const ref = await api.uploadImage({ collection: "posts", field: "cover" });
	const post = await api.createPost({
		title: `E2E site list ${token}`,
		slug: `e2e-site-list-${token}`,
		cover: { ...ref, alt: "一覧のカード" },
		publish: true,
	});
	const card = await findPostCard(page, post.id);
	const image = card.locator(`img[data-field="cover"][data-image-id="${ref.id}"]`);
	expectSiteImage(await readRenderedImage(image), { ...ref, alt: "一覧のカード" });
	await expect(card).toContainText(`E2E site list ${token}`);

	// priority(loading="eager"・fetchpriority="high")は、そのページで最初に描画できたカバーだけ
	const covers = page.locator('[data-testid="post-card"] img[data-field="cover"]');
	const attributes = await covers.evaluateAll((images) =>
		images.map((element) => [
			element.getAttribute("loading"),
			element.getAttribute("fetchpriority"),
		]),
	);
	expect(attributes.length).toBeGreaterThan(0);
	expect(attributes[0]).toEqual(["eager", "high"]);
	for (const rest of attributes.slice(1)) expect(rest).toEqual(["lazy", null]);
});

test("詳細: カバーの画像がゴミ箱にあると、参照の寸法で場所を取った「画像が見つかりません」を出す(ギャラリーは遅延読み込み)", async ({
	page,
	api,
	token,
}) => {
	const cover = await api.uploadImage({ collection: "posts", field: "cover" });
	const photo = await api.uploadImage({ collection: "posts", field: "gallery" });
	const slug = `e2e-site-missing-${token}`;
	await api.createPost({
		title: `E2E site missing ${token}`,
		slug,
		cover,
		gallery: [{ ...photo, alt: "ギャラリーの 1 枚目" }],
		publish: true,
	});
	await api.trashImage(cover.id);

	await page.goto(`/posts/${slug}/`);
	const article = page.getByTestId("post");
	const missing = article.getByTestId("image-missing");
	await expect(missing).toHaveAttribute("data-field", "cover");
	await expect(missing).toHaveAttribute("data-image-id", cover.id);
	await expect(article.getByRole("img", { name: "画像が見つかりません" })).toBeVisible();
	const box = await missing.boundingBox();
	if (box === null) throw new Error("代わりの枠の大きさを読めません");
	expect(Math.abs(box.height - (box.width * cover.height) / cover.width)).toBeLessThanOrEqual(1);
	await expect(article.locator('img[data-field="cover"]')).toHaveCount(0);

	// カバーの参照があるので、ギャラリーは priority にしない
	const rendered = await readRenderedImage(article.locator(`img[data-image-id="${photo.id}"]`));
	expectSiteImage(rendered, { ...photo, alt: "ギャラリーの 1 枚目" });
	expect({ loading: rendered.loading, fetchPriority: rendered.fetchPriority }).toEqual({
		loading: "lazy",
		fetchPriority: null,
	});
});

test("詳細: カバーの無い投稿では、ギャラリーの最初の画像を priority にする", async ({
	page,
	api,
	token,
}) => {
	const first = await api.uploadImage({ collection: "posts", field: "gallery" });
	const second = await api.uploadImage({ collection: "posts", field: "gallery" });
	const slug = `e2e-site-gallery-${token}`;
	await api.createPost({
		title: `E2E site gallery ${token}`,
		slug,
		cover: null,
		gallery: [first, second],
		publish: true,
	});
	await page.goto(`/posts/${slug}/`);
	const article = page.getByTestId("post");
	await expect(article).toContainText("カバー画像はありません。");
	const images = article.locator('img[data-field="gallery"]');
	await expect(images).toHaveCount(2);
	const renderedFirst = await readRenderedImage(images.nth(0));
	const renderedSecond = await readRenderedImage(images.nth(1));
	expectSiteImage(renderedFirst, first);
	expectSiteImage(renderedSecond, second);
	expect([renderedFirst.loading, renderedFirst.fetchPriority]).toEqual(["eager", "high"]);
	expect([renderedSecond.loading, renderedSecond.fetchPriority]).toEqual(["lazy", null]);
});

test("詳細: 公開されていない投稿と、存在しない slug は 404", async ({
	page,
	api,
	consoleGuard,
	token,
}) => {
	// Chromium は、404 の文書にも「Failed to load resource」を console に出す
	consoleGuard.allow(failedResourcePattern(404));
	const slug = `e2e-site-draft-${token}`;
	await api.createPost({ title: `E2E site draft ${token}`, slug });
	for (const path of [`/posts/${slug}/`, `/posts/e2e-no-such-post-${token}/`]) {
		// oxlint-disable-next-line no-await-in-loop -- 1 つずつ確かめる
		const response = await page.goto(path);
		expect(response?.status(), path).toBe(404);
		// oxlint-disable-next-line no-await-in-loop -- 同上
		await expect(
			page.getByRole("heading", { level: 1, name: "投稿が見つかりません" }),
		).toBeVisible();
		// oxlint-disable-next-line no-await-in-loop -- 同上
		await expect(page.locator("img")).toHaveCount(0);
	}
});
