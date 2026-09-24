/**
 * 異常系(仕様書 6.1・6.5・8 章): 受け付けない入力画像、Safari 相当のブラウザ、標準の編集画面からの `b64_images` の保存。
 * 画像が消えた参照を持つ投稿の保存は images-page.spec.ts(完全削除のあと)。サーバー側の検証は server-validation.api.spec.ts。
 */

import { coverWidget, notifications, openNewPost, recordUploads } from "./support/admin";
import { failedResourcePattern } from "./support/console-guard";
import { fixture } from "./support/env";
import { ACCEPTED, REJECTED } from "./support/images";
import { expect, test } from "./support/test";

/** 拒否のコードの文言(`src/client/error-messages.ts` の日本語) */
const MESSAGES: Record<(typeof REJECTED)[number]["code"] | "BROWSER_UNSUPPORTED", string> = {
	INPUT_HEIC_REJECTED:
		"HEIC / HEIF の画像は使えません。iPhone のカメラ設定を「互換性優先」にするか、JPEG に書き出してください。",
	INPUT_SVG_REJECTED: "SVG の画像は使えません。PNG か JPEG に書き出してから選んでください。",
	INPUT_FORMAT_REJECTED:
		"この形式の画像は使えません。JPEG / PNG / WebP / AVIF / GIF / BMP の画像を選んでください。",
	INPUT_DECODE_FAILED:
		"画像を読み込めませんでした。ファイルが壊れているか、このブラウザが読み込めない形式です。",
	INPUT_FILE_TOO_LARGE: "ファイルが大きすぎます(上限 40MB)。",
	INPUT_TOO_MANY_PIXELS: "画像の画素数が多すぎます(上限 6,400 万画素)。",
	BROWSER_UNSUPPORTED:
		"このブラウザは非対応です(画像を WebP に変換できません)。Chrome、Edge、Firefox を使ってください。",
};

test.describe("受け付けない入力画像", () => {
	for (const entry of REJECTED) {
		test(`${entry.file} は ${entry.code} で拒否し、アップロードしない`, async ({ page }) => {
			const uploads = recordUploads(page);
			await openNewPost(page);
			const cover = coverWidget(page);
			await cover.fileInput.setInputFiles(fixture(entry.file));
			await expect(cover.error).toContainText(MESSAGES[entry.code]);
			// 値は変わらない(画像なしのまま)。エラーは閉じられる
			await expect(cover.zone).toBeVisible();
			await cover.root.getByRole("button", { name: "エラーを閉じる" }).click();
			await expect(cover.error).toHaveCount(0);
			expect(uploads.count()).toBe(0);
		});
	}
});

test("Safari 相当(canvas の toBlob が WebP の代わりに PNG を返す)では、非対応と知らせてアップロードしない", async ({
	page,
}) => {
	// Safari は、toBlob に image/webp を渡してもエラーを出さずに PNG を返す(仕様書 6.1)
	await page.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.toBlob;
		HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type, quality) {
			original.call(this, callback, type === "image/webp" ? "image/png" : type, quality);
		};
	});
	const uploads = recordUploads(page);
	await openNewPost(page);
	const cover = coverWidget(page);
	await cover.fileInput.setInputFiles(fixture(ACCEPTED.webp));
	await expect(cover.error).toContainText(MESSAGES.BROWSER_UNSUPPORTED);
	await expect(cover.zone).toBeVisible();
	expect(uploads.count()).toBe(0);
});

test("標準の編集画面から b64_images を保存すると、保存 hook が拒否する(422、通知に日本語と英語の文)", async ({
	page,
	api,
	consoleGuard,
	token,
}) => {
	consoleGuard.allow(failedResourcePattern(422));
	const image = await api.uploadImage({ collection: "posts", field: "cover" });
	await page.goto(`/_emdash/admin/content/b64_images/${image.id}`);
	await expect(page.getByRole("heading", { level: 1, name: "Base64 Imagesを編集" })).toBeVisible();
	// 画像の値は変えずに、ほかの欄(slug)だけを変えて保存する。管理画面は毎回すべてのフィールド(image も)を送る
	await page.getByRole("textbox", { name: "識別名（スラッグ）" }).fill(`e2e-image-${token}`);
	const [response] = await Promise.all([
		page.waitForResponse(
			(candidate) =>
				candidate.request().method() === "PUT" &&
				new URL(candidate.url()).pathname === `/_emdash/api/content/b64_images/${image.id}`,
		),
		page.getByRole("button", { name: "保存", exact: true }).click(),
	]);
	expect(response.status()).toBe(422);
	expect(((await response.json()) as { error: { code: string } }).error.code).toBe("SAVE_REJECTED");
	const toast = notifications(page).getByRole("dialog", { name: "保存に失敗しました" });
	await expect(toast).toContainText(
		"画像エントリ(b64_images.image): 作成したあとは変更できません。別の画像にするときは、新しい画像をアップロードしてください。",
	);
	await expect(toast).toContainText(
		"Image entry (b64_images.image): it cannot be changed after it is created.",
	);
});
