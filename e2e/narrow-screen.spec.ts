/**
 * 狭い画面(390 × 844)での管理画面(T30 が確かめていなかったこと。部品ごとの確認は T25・T27・T28)。
 * 編集画面の widget は画面の幅に収まり、画像管理ページの表は枠(`overflow-x-auto`)の中で横にスクロールする。
 * どちらもページ全体は横にスクロールしない。
 */

import { coverWidget, galleryWidget, openPost } from "./support/admin";
import { imagesPage, openImagesPage } from "./support/pages";
import { expect, test } from "./support/test";

test.use({ viewport: { width: 390, height: 844 } });

test("編集画面: 画像のある単一画像とギャラリーが画面の幅に収まる", async ({ page, api, token }) => {
	const cover = await api.uploadImage({ collection: "posts", field: "cover" });
	const first = await api.uploadImage({ collection: "posts", field: "gallery" });
	const second = await api.uploadImage({ collection: "posts", field: "gallery" });
	const post = await api.createPost({
		title: `E2E narrow ${token}`,
		slug: `e2e-narrow-${token}`,
		cover: { ...cover, alt: "狭い画面のカバー" },
		gallery: [first, second],
	});
	await openPost(page, post.id);
	const coverField = coverWidget(page);
	const gallery = galleryWidget(page);
	await expect(coverField.preview).toBeVisible();
	await expect(gallery.rows).toHaveCount(2);
	await expect(gallery.row(2).locator("img")).toBeVisible();

	const layout = await page.evaluate(() => {
		const width = document.documentElement.clientWidth;
		const elements = document.querySelectorAll(
			"fieldset#field-cover, fieldset#field-cover *, li[data-gallery-key], li[data-gallery-key] *",
		);
		const outside = Array.from(elements)
			.filter((element) => {
				const rect = element.getBoundingClientRect();
				return rect.width > 0 && (rect.left < -0.5 || rect.right > width + 0.5);
			})
			.map((element) => element.outerHTML.slice(0, 120));
		return { width, scrollWidth: document.documentElement.scrollWidth, outside };
	});
	expect(layout.outside).toEqual([]);
	expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
	for (const control of [
		coverField.alt,
		coverField.replace,
		coverField.remove,
		gallery.row(2).getByRole("button", { name: "画像 2 を上へ移動" }),
		gallery.row(2).getByRole("button", { name: "画像 2 を削除" }),
		gallery.row(2).getByRole("textbox"),
	]) {
		// oxlint-disable-next-line no-await-in-loop -- 1 つずつ確かめる
		await expect(control).toBeVisible();
	}
});

test("画像管理ページ: 表は枠の中で横にスクロールし、ページは横にスクロールしない", async ({
	page,
	api,
}) => {
	await api.uploadImage({ collection: "posts", field: "cover" });
	await openImagesPage(page);
	const layout = await imagesPage(page).table.evaluate((table) => {
		let scroller = table.parentElement;
		while (scroller !== null && !/auto|scroll/.test(getComputedStyle(scroller).overflowX)) {
			scroller = scroller.parentElement;
		}
		return {
			width: document.documentElement.clientWidth,
			scrollWidth: document.documentElement.scrollWidth,
			scroller:
				scroller === null
					? null
					: {
							right: scroller.getBoundingClientRect().right,
							scrollWidth: scroller.scrollWidth,
							clientWidth: scroller.clientWidth,
						},
		};
	});
	expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
	expect(layout.scroller).not.toBeNull();
	expect(layout.scroller?.right ?? Infinity).toBeLessThanOrEqual(layout.width + 0.5);
	// 表は枠より広く、枠の中でスクロールできる
	expect(layout.scroller?.scrollWidth ?? 0).toBeGreaterThan(layout.scroller?.clientWidth ?? 0);
});
