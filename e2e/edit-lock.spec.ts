/**
 * 編集ロック中の widget(仕様書 11.1・11.2・11.3、18 章「編集ロック」)。
 *
 * ほかの利用者のロックは、lock の API(`POST /_emdash/api/content/<collection>/<ID>/lock`)を `page.route` で差し替えて
 * 再現する(docs/emdash-plugin-field-widget.md の 2 章)。ダイアログ「This entry is open somewhere else」で
 * 「Open read-only」を選ぶと、EmDash はフィールドを `<fieldset disabled>` で包む。
 */

import type { Locator, Page } from "@playwright/test";

import { coverWidget, galleryWidget, openPost, recordUploads } from "./support/admin";
import { createDataTransfer, galleryImage } from "./support/images";
import { expect, test } from "./support/test";

/** ほかの利用者がロックを持っている応答を返す */
async function lockedByAnotherUser(page: Page): Promise<void> {
	const acquiredAt = new Date().toISOString();
	const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
	await page.route("**/_emdash/api/content/posts/*/lock*", (route) =>
		route.request().method() === "DELETE"
			? route.fulfill({ json: { data: { released: false } } })
			: route.fulfill({
					json: {
						data: {
							enabled: true,
							holder: { userId: "e2e-other-user", userName: "別の利用者", acquiredAt, expiresAt },
							heldByCaller: false,
						},
					},
				}),
	);
}

/** ロックのダイアログで「Open read-only」を選ぶ */
async function openReadOnly(page: Page): Promise<void> {
	const dialog = page.getByRole("alertdialog", { name: "This entry is open somewhere else" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Open read-only" }).click();
	await expect(dialog).toHaveCount(0);
}

/** 合成のドラッグのイベント(ファイル)を枠に送る */
async function dropFiles(page: Page, frame: Locator, names: string[]): Promise<void> {
	const transfer = await createDataTransfer(page, names);
	for (const type of ["dragenter", "dragover", "drop"]) {
		// oxlint-disable-next-line no-await-in-loop -- ドラッグのイベントは順に送る
		await frame.dispatchEvent(type, { dataTransfer: transfer });
	}
}

test.describe("編集ロック中の widget", () => {
	test("ボタンと入力欄は無効で、フォーカスも移らない。ギャラリーへのドロップと並べ替えのドラッグは受け付けない", async ({
		page,
		api,
		token,
	}) => {
		const cover = await api.uploadImage({ collection: "posts", field: "cover" });
		const first = await api.uploadImage({ collection: "posts", field: "gallery" });
		const second = await api.uploadImage({ collection: "posts", field: "gallery" });
		const post = await api.createPost({
			title: `E2E lock ${token}`,
			slug: `e2e-lock-${token}`,
			cover: { ...cover, alt: "カバー" },
			gallery: [
				{ ...first, alt: "一" },
				{ ...second, alt: "二" },
			],
		});
		const uploads = recordUploads(page);
		await lockedByAnotherUser(page);
		await openPost(page, post.id);
		await openReadOnly(page);

		// EmDash は、フィールドの並びを <fieldset disabled> で包む。widget の根の fieldset も :disabled に当たる
		// (Playwright の toBeDisabled は fieldset を対象にしないので、:disabled を直接見る)
		await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
		const coverField = coverWidget(page);
		expect(await coverField.root.evaluate((element) => element.matches(":disabled"))).toBe(true);
		for (const control of [
			coverField.replace,
			coverField.remove,
			coverField.alt,
			coverField.fileInput,
		]) {
			// oxlint-disable-next-line no-await-in-loop -- 1 つずつ確かめる
			await expect(control).toBeDisabled();
		}
		await coverField.replace.focus();
		await expect(coverField.replace).not.toBeFocused();

		const gallery = galleryWidget(page);
		await expect(gallery.zone).toBeDisabled();
		for (const name of [
			"画像 1 を下へ移動",
			"画像 2 を上へ移動",
			"画像 1 を差し替え",
			"画像 1 を削除",
		]) {
			// oxlint-disable-next-line no-await-in-loop -- 1 つずつ確かめる
			await expect(gallery.root.getByRole("button", { name })).toBeDisabled();
		}
		await expect(gallery.row(1).getByRole("textbox")).toBeDisabled();

		// 枠(div)へのドロップはブラウザが止めないので、widget が受け付けないこと
		await dropFiles(page, gallery.zoneFrame, [galleryImage(1)]);
		// つまみ(draggable の div)のドラッグも始まらない
		const handle = gallery.row(2).locator("[data-gallery-handle]");
		const handleBox = await handle.boundingBox();
		const targetBox = await gallery.row(1).boundingBox();
		if (handleBox === null || targetBox === null) throw new Error("行の位置を読めません");
		await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
		await page.mouse.down();
		await page.mouse.move(targetBox.x + 40, targetBox.y + targetBox.height * 0.4, { steps: 4 });
		await page.mouse.move(targetBox.x + 40, targetBox.y + targetBox.height * 0.25, { steps: 4 });
		// ロックしていなければ、ここで落とす位置の線(上側の影)とドラッグ中の薄い表示が出る(gallery-field.spec.ts)
		await expect(gallery.row(2)).not.toHaveClass(/opacity-50/);
		await expect(gallery.row(1)).not.toHaveCSS("box-shadow", /-3px/);
		await page.mouse.up();

		await page.waitForTimeout(1_000);
		expect(uploads.count()).toBe(0);
		await expect(gallery.rows).toHaveCount(2);
		await expect(gallery.row(1).getByRole("textbox")).toHaveValue("一");
		await expect(gallery.root.locator("[data-stage]")).toHaveCount(0);
	});

	test("画像の無い単一画像のフィールドに、ドロップしても処理を始めない", async ({
		page,
		api,
		token,
	}) => {
		const post = await api.createPost({
			title: `E2E lock empty ${token}`,
			slug: `e2e-lock-empty-${token}`,
			cover: null,
		});
		const uploads = recordUploads(page);
		await lockedByAnotherUser(page);
		await openPost(page, post.id);
		await openReadOnly(page);
		const cover = coverWidget(page);
		await expect(cover.zone).toBeDisabled();
		await dropFiles(page, cover.zoneFrame, [galleryImage(2)]);
		await page.waitForTimeout(1_000);
		expect(uploads.count()).toBe(0);
		await expect(cover.root.locator("[data-stage]")).toHaveCount(0);
		await expect(cover.zone).toBeVisible();
		await expect(cover.status).toHaveText("");
	});
});
