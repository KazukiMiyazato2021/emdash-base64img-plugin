/**
 * 単一画像の widget(`base64-image:image`。仕様書 11.2)を、実際の管理画面(playground の Cover)で確かめる。
 */

import type { Page } from "@playwright/test";

import {
	clickSave,
	coverWidget,
	galleryWidget,
	holdUploads,
	openNewPost,
	openPost,
	recordUploads,
} from "./support/admin";
import { fixture } from "./support/env";
import { ACCEPTED, createDataTransfer, galleryImage } from "./support/images";
import { expect, test } from "./support/test";

/** 画像の (x, y) の画素を、ページの canvas で読む([r, g, b, a]) */
async function readPixel(page: Page, x: number, y: number): Promise<number[]> {
	return coverWidget(page).preview.evaluate(
		async (image: HTMLImageElement, point) => {
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d");
			if (context === null) throw new Error("2d のコンテキストを作れません");
			context.drawImage(image, 0, 0);
			return Array.from(context.getImageData(point.x, point.y, 1, 1).data);
		},
		{ x, y },
	);
}

test.describe("単一画像の widget", () => {
	test("キーボードだけで選べる: Tab でドロップゾーンへ、Enter でファイルの選択。処理中はキャンセル、追加のあとは代替テキストにフォーカス", async ({
		page,
	}) => {
		const uploads = await holdUploads(page);
		await openNewPost(page);
		const cover = coverWidget(page);
		await page.getByRole("textbox", { name: "Title" }).focus();
		await page.keyboard.press("Tab");
		await expect(cover.zone).toBeFocused();
		await expect(cover.zone).toHaveAccessibleName("Cover: ファイルを選択");

		const [chooser] = await Promise.all([
			page.waitForEvent("filechooser"),
			page.keyboard.press("Enter"),
		]);
		expect(chooser.isMultiple()).toBe(false);
		await chooser.setFiles(fixture(ACCEPTED.photo));

		// 処理中: 進捗の行とキャンセルだけになり、フォーカスはキャンセルへ。保存しないよう案内し、キャンセルの説明にする
		await expect(cover.root.locator('[data-stage="uploading"]')).toContainText("アップロード中…");
		await expect(cover.status).toHaveText("画像をアップロードしています。");
		await expect(cover.cancel).toBeFocused();
		await expect(cover.saveHint).toBeVisible();
		const hintId = await cover.saveHint.getAttribute("id");
		await expect(cover.cancel).toHaveAttribute("aria-describedby", hintId ?? "");
		await expect(cover.cancel).toHaveAccessibleDescription("処理が終わってから保存してください。");

		uploads.release();
		await expect(cover.status).toHaveText("画像を追加しました。");
		await expect(cover.alt).toBeFocused();
		await expect(cover.saveHint).toHaveCount(0);
		await expect(cover.root.getByText("空欄のときは、装飾画像として扱われます")).toBeVisible();
	});

	test("アップロード中にキャンセルすると要求を中断し、前の画像と代替テキストのまま差し替えのボタンにフォーカスが戻る", async ({
		page,
		api,
		token,
	}) => {
		const ref = await api.uploadImage({ collection: "posts", field: "cover" });
		const post = await api.createPost({
			title: `E2E cancel ${token}`,
			slug: `e2e-cancel-${token}`,
			cover: { ...ref, alt: "前の代替テキスト" },
		});
		const uploads = await holdUploads(page);
		await openPost(page, post.id);
		const cover = coverWidget(page);
		await expect(cover.alt).toHaveValue("前の代替テキスト");

		await cover.replace.focus();
		const [chooser] = await Promise.all([
			page.waitForEvent("filechooser"),
			page.keyboard.press("Enter"),
		]);
		await chooser.setFiles(fixture(ACCEPTED.pngAlpha));
		await expect(cover.cancel).toBeFocused();
		await expect.poll(uploads.held).toBe(1);

		const aborted = page.waitForEvent("requestfailed", (request) =>
			request.url().endsWith("/_emdash/api/plugins/base64-image/upload"),
		);
		await page.keyboard.press("Enter");
		await aborted;
		await expect(cover.replace).toBeFocused();
		await expect(cover.alt).toHaveValue("前の代替テキスト");
		await expect(cover.preview).toHaveAttribute("width", String(ref.width));
		await expect(cover.error).toHaveCount(0);
		// 値は変わらない(保存済みのまま)
		await expect(page.getByRole("button", { name: "保存済み" })).toBeDisabled();
		uploads.release();
	});

	test("差し替えると代替テキストは空になり、フォーカスは代替テキストへ。保存すると新しい参照になる", async ({
		page,
		api,
		token,
	}) => {
		const ref = await api.uploadImage({ collection: "posts", field: "cover" });
		const post = await api.createPost({
			title: `E2E replace ${token}`,
			slug: `e2e-replace-${token}`,
			cover: { ...ref, alt: "前の画像の説明" },
		});
		await openPost(page, post.id);
		const cover = coverWidget(page);
		await cover.replace.focus();
		const [chooser] = await Promise.all([
			page.waitForEvent("filechooser"),
			page.keyboard.press("Enter"),
		]);
		await chooser.setFiles(fixture(ACCEPTED.webp));
		await expect(cover.status).toHaveText("画像を追加しました。");
		await expect(cover.alt).toBeFocused();
		await expect(cover.alt).toHaveValue("");
		await expect(cover.preview).toHaveAttribute("width", "640");
		await cover.alt.fill("新しい画像の説明");
		expect((await clickSave(page)).status()).toBe(200);
		const saved = await api.getEntry("posts", post.id);
		expect(saved.data["cover"]).toMatchObject({ width: 640, height: 480, alt: "新しい画像の説明" });
		expect((saved.data["cover"] as { id: string }).id).not.toBe(ref.id);
	});

	test("削除すると画像が外れ、フォーカスはドロップゾーンへ。保存した値は null", async ({
		page,
		api,
		token,
	}) => {
		const ref = await api.uploadImage({ collection: "posts", field: "cover" });
		const post = await api.createPost({
			title: `E2E remove ${token}`,
			slug: `e2e-remove-${token}`,
			cover: ref,
		});
		await openPost(page, post.id);
		const cover = coverWidget(page);
		await cover.remove.focus();
		await page.keyboard.press("Enter");
		await expect(cover.zone).toBeFocused();
		await expect(cover.preview).toHaveCount(0);
		expect((await clickSave(page)).status()).toBe(200);
		expect((await api.getEntry("posts", post.id)).data["cover"]).toBeNull();
	});

	test("ドロップ: 1 枚なら追加し、2 枚は「1 枚ずつ」と知らせて送らない", async ({ page }) => {
		const uploads = recordUploads(page);
		await openNewPost(page);
		const cover = coverWidget(page);

		const two = await createDataTransfer(page, [galleryImage(1), galleryImage(2)]);
		for (const type of ["dragenter", "dragover", "drop"]) {
			// oxlint-disable-next-line no-await-in-loop -- ドラッグのイベントは順に送る
			await cover.zoneFrame.dispatchEvent(type, { dataTransfer: two });
		}
		await expect(
			cover.root.getByRole("alert").filter({ hasText: "画像は 1 枚ずつ追加してください。" }),
		).toBeVisible();

		const one = await createDataTransfer(page, [galleryImage(3)]);
		for (const type of ["dragenter", "dragover", "drop"]) {
			// oxlint-disable-next-line no-await-in-loop -- 同上
			await cover.zoneFrame.dispatchEvent(type, { dataTransfer: one });
		}
		await expect(cover.status).toHaveText("画像を追加しました。");
		await expect(cover.preview).toHaveAttribute("width", "800");
		expect(uploads.count()).toBe(1);
	});

	test("貼り付け: フォーカスのあるドロップゾーンだけが受け取り、もう 1 つの画像のフィールドには入らない", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName !== "chromium",
			"Firefox 155 のヘッドレスはクリップボードの画像を読めず、合成の ClipboardEvent も中身が空になる(docs/admin-image-input-browser-behavior.md)。手で確かめる項目にした",
		);
		const uploads = recordUploads(page);
		await openNewPost(page);
		await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
		// クリップボードに PNG を入れる(書き込みは、利用者の操作(クリック)の中で行う)
		await page.evaluate(() => {
			const button = document.createElement("button");
			button.id = "e2e-copy-image";
			button.textContent = "copy";
			button.addEventListener("click", () => {
				const canvas = document.createElement("canvas");
				canvas.width = 320;
				canvas.height = 200;
				const context = canvas.getContext("2d");
				if (context === null) return;
				context.fillStyle = "#1e90ff";
				context.fillRect(0, 0, 320, 200);
				const item = new ClipboardItem({
					"image/png": new Promise<Blob>((resolve, reject) => {
						canvas.toBlob(
							(blob) => (blob === null ? reject(new Error("toBlob")) : resolve(blob)),
							"image/png",
						);
					}),
				});
				// 書き込みは非同期。終わったことをボタンの属性で知らせる(待たずに貼り付けると、空のまま貼り付けることがある)
				navigator.clipboard.write([item]).then(
					() => button.setAttribute("data-copied", "true"),
					(error: unknown) => button.setAttribute("data-copied", `error: ${String(error)}`),
				);
			});
			document.body.append(button);
		});
		const copyButton = page.locator("#e2e-copy-image");
		await copyButton.click();
		await expect(copyButton).toHaveAttribute("data-copied", "true");
		await copyButton.evaluate((element) => element.remove());

		const cover = coverWidget(page);
		const gallery = galleryWidget(page);
		// ギャラリーのボタンにフォーカスして貼り付ける → ギャラリーだけに入る
		await gallery.zone.focus();
		await page.keyboard.press("ControlOrMeta+V");
		await expect(gallery.rows).toHaveCount(1);
		await expect(gallery.progress).toHaveText("画像を追加しました。");
		await expect(cover.zone).toBeVisible();

		// カバーのボタンにフォーカスして貼り付ける → カバーだけに入る
		await cover.zone.focus();
		await page.keyboard.press("ControlOrMeta+V");
		await expect(cover.status).toHaveText("画像を追加しました。");
		await expect(cover.preview).toHaveAttribute("width", "320");
		await expect(gallery.rows).toHaveCount(1);

		// ほかの入力欄にフォーカスがあるときは、どちらも受け取らない
		await page.getByRole("textbox", { name: "Title" }).focus();
		await page.keyboard.press("ControlOrMeta+V");
		await page.waitForTimeout(1_000);
		expect(uploads.targets()).toEqual([
			{ collection: "posts", field: "gallery" },
			{ collection: "posts", field: "cover" },
		]);
	});

	test("受け付ける形式: PNG の透過・WebP・AVIF・BMP・GIF(最初のフレーム)・EXIF の向き", async ({
		page,
	}) => {
		await openNewPost(page);
		const cover = coverWidget(page);
		const cases = [
			{ file: ACCEPTED.pngAlpha, width: 640, height: 480 },
			{ file: ACCEPTED.webp, width: 640, height: 480 },
			{ file: ACCEPTED.avif, width: 640, height: 480 },
			{ file: ACCEPTED.bmp, width: 640, height: 480 },
			{ file: ACCEPTED.gif, width: 320, height: 240 },
			{ file: ACCEPTED.photoExif6, width: 1067, height: 1600 },
		];
		for (const entry of cases) {
			// oxlint-disable-next-line no-await-in-loop -- 1 枚ずつ差し替えて確かめる
			await cover.fileInput.setInputFiles(fixture(entry.file));
			// oxlint-disable-next-line no-await-in-loop -- 同上
			await expect(cover.status, entry.file).toHaveText("画像を追加しました。");
			// oxlint-disable-next-line no-await-in-loop -- 同上
			await expect(cover.preview, entry.file).toHaveAttribute("width", String(entry.width));
			// oxlint-disable-next-line no-await-in-loop -- 同上
			await expect(cover.preview, entry.file).toHaveAttribute("height", String(entry.height));
			// oxlint-disable-next-line no-await-in-loop -- 同上
			await expect(cover.info, entry.file).toHaveText(
				new RegExp(`^${entry.width}×${entry.height} · 保存サイズ \\d+\\.\\dKB · 画質 0\\.\\d\\d$`),
			);
			if (entry.file === ACCEPTED.pngAlpha) {
				// 透過は保持される(角は透明、中心は不透明)
				// oxlint-disable-next-line no-await-in-loop -- 同上
				expect((await readPixel(page, 0, 0))[3]).toBeLessThanOrEqual(8);
				// oxlint-disable-next-line no-await-in-loop -- 同上
				expect((await readPixel(page, 320, 240))[3]).toBeGreaterThanOrEqual(247);
			}
			if (entry.file === ACCEPTED.gif) {
				// GIF は最初のフレーム(赤)の静止画になり、注意を出す
				// oxlint-disable-next-line no-await-in-loop -- 同上
				await expect(
					cover.root.getByText(
						"GIF は最初のフレームだけの静止画になります(アニメーションは保存されません)。",
					),
				).toBeVisible();
				// oxlint-disable-next-line no-await-in-loop -- 同上
				const [red, green, blue] = await readPixel(page, 10, 10);
				expect(red).toBeGreaterThan(150);
				expect(green).toBeLessThan(100);
				expect(blue).toBeLessThan(100);
			}
		}
	});

	test("英語の管理画面では、widget の文言も英語になる", async ({ page }) => {
		await page
			.context()
			.addCookies([{ name: "emdash-locale", value: "en", domain: "localhost", path: "/_emdash" }]);
		await openNewPost(page);
		const root = coverWidget(page).root;
		const zone = root.getByRole("button", { name: "Cover: Select a file" });
		await expect(zone).toBeVisible();
		await expect(zone).toContainText("Drop or paste an image");
		await root.locator('input[type="file"]').setInputFiles(fixture(ACCEPTED.webp));
		await expect(root.locator("output")).toHaveText("Image added.");
		await expect(root.getByRole("button", { name: "Replace", exact: true })).toBeVisible();
		await expect(root.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
		await expect(root.getByRole("textbox", { name: "Alternative text" })).toBeVisible();
		await expect(root.locator("p.tabular-nums")).toHaveText(
			/^640×480 · Stored size \d+\.\d KB · Quality 0\.\d\d$/,
		);
	});
});
