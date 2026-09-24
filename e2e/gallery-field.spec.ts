/**
 * ギャラリーの widget(`base64-image:gallery`。仕様書 11.3)を、実際の管理画面(playground の Gallery、上限 10 枚)で確かめる。
 */

import type { Page } from "@playwright/test";

import type { AdminApi, ImageRef } from "./support/api";
import {
	clickSave,
	galleryWidget,
	holdUploads,
	openNewPost,
	openPost,
	recordUploads,
} from "./support/admin";
import { fixture, PLUGIN_API } from "./support/env";
import { ACCEPTED, createDataTransfer, galleryImage } from "./support/images";
import { expect, test } from "./support/test";

/** 代替テキストを付けた画像を `count` 枚持つ投稿を作る */
async function createGalleryPost(
	api: AdminApi,
	token: string,
	alts: readonly string[],
): Promise<{ id: string; refs: ImageRef[] }> {
	const refs: ImageRef[] = [];
	for (const alt of alts) {
		// oxlint-disable-next-line no-await-in-loop -- アップロードは 1 枚ずつ
		const ref = await api.uploadImage({ collection: "posts", field: "gallery" });
		refs.push({ ...ref, alt });
	}
	const post = await api.createPost({
		title: `E2E gallery ${token}`,
		slug: `e2e-gallery-${token}`,
		gallery: refs,
	});
	return { id: post.id, refs };
}

/** 各行の代替テキストの値(行の順) */
async function altTexts(page: Page): Promise<string[]> {
	const gallery = galleryWidget(page);
	return gallery.rows.evaluateAll((rows) =>
		rows.map((row) => row.querySelector<HTMLInputElement>('input:not([type="file"])')?.value ?? ""),
	);
}

test.describe("ギャラリーの widget", () => {
	test("複数の画像を 1 枚ずつ順に処理して追加し、保存すると選んだ順の参照になる", async ({
		page,
		api,
	}) => {
		const uploads = await holdUploads(page);
		const uploadIds: string[] = [];
		page.on("response", async (response) => {
			if (new URL(response.url()).pathname !== `${PLUGIN_API}/upload`) return;
			const body = (await response.json()) as { data: { ref: ImageRef } };
			uploadIds.push(body.data.ref.id);
		});
		await openNewPost(page);
		await page.getByRole("textbox", { name: "Title" }).fill(`E2E gallery add ${Date.now()}`);
		const gallery = galleryWidget(page);
		await expect(gallery.count).toHaveText("0 / 10 枚");
		await gallery.zone.focus();
		const [chooser] = await Promise.all([
			page.waitForEvent("filechooser"),
			page.keyboard.press("Enter"),
		]);
		expect(chooser.isMultiple()).toBe(true);
		await chooser.setFiles([1, 2, 3].map((n) => fixture(galleryImage(n))));

		// 1 枚目の要求を止めている間、2 枚目は送らない(1 枚ずつ順に処理する)
		await expect(gallery.progress).toHaveText("3 枚中 1 枚目: 画像をアップロードしています。");
		await expect(gallery.root.getByText("1 / 3 枚目")).toBeVisible();
		await expect(gallery.cancel).toBeFocused();
		await expect(gallery.saveHint).toBeVisible();
		await page.waitForTimeout(500);
		expect(uploads.held()).toBe(1);

		uploads.release();
		await expect(gallery.progress).toHaveText("3 枚の画像を追加しました。");
		await expect(gallery.rows).toHaveCount(3);
		await expect(gallery.zone).toBeFocused();
		await expect(gallery.count).toHaveText("3 / 10 枚");
		await expect(gallery.root.getByText("あと 7 枚追加できます(最大 10 枚)。")).toBeVisible();

		const saved = await clickSave(page);
		expect(saved.status()).toBe(201);
		const body = saved.request().postDataJSON() as { data: { gallery: ImageRef[] } };
		expect(body.data.gallery.map((ref) => ref.id)).toEqual(uploadIds);
		const created = (await saved.json()) as { data: { item: { id: string } } };
		const entry = await api.getEntry("posts", created.data.item.id);
		expect(
			(entry.data["gallery"] as ImageRef[]).map((ref) => [ref.id, ref.width, ref.height]),
		).toEqual(uploadIds.map((id) => [id, 800, 600]));
	});

	test("↑↓ ボタンで並べ替えられ、フォーカスは押したボタンに残る。端のボタンは aria-disabled で何もしない", async ({
		page,
		api,
		token,
	}) => {
		const post = await createGalleryPost(api, token, ["一", "二", "三"]);
		// 読み込み直したときのプレビューは、まとめて 1 回で取得する(10 件まで)
		const previews: string[][] = [];
		page.on("request", (request) => {
			if (new URL(request.url()).pathname === `${PLUGIN_API}/preview`) {
				previews.push((request.postDataJSON() as { ids: string[] }).ids);
			}
		});
		await openPost(page, post.id);
		const gallery = galleryWidget(page);
		await expect(gallery.rows).toHaveCount(3);
		await expect.poll(() => previews).toEqual([post.refs.map((ref) => ref.id)]);

		await gallery.root.getByRole("button", { name: "画像 1 を下へ移動" }).focus();
		await page.keyboard.press("Enter");
		await expect.poll(() => altTexts(page)).toEqual(["二", "一", "三"]);
		await expect(gallery.announcement).toHaveText(
			"画像を 1 番目から 2 番目に移動しました(全 3 枚)。",
		);
		// 押したボタン(行と一緒に動いた)にフォーカスが残る
		await expect(gallery.root.getByRole("button", { name: "画像 2 を下へ移動" })).toBeFocused();

		await page.keyboard.press("Space");
		await expect.poll(() => altTexts(page)).toEqual(["二", "三", "一"]);
		const lastDown = gallery.root.getByRole("button", { name: "画像 3 を下へ移動" });
		await expect(lastDown).toBeFocused();
		await expect(lastDown).toHaveAttribute("aria-disabled", "true");
		await page.keyboard.press("Enter");
		await page.waitForTimeout(300);
		expect(await altTexts(page)).toEqual(["二", "三", "一"]);
		await expect(lastDown).toBeFocused();
		await expect(gallery.root.getByRole("button", { name: "画像 1 を上へ移動" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);

		expect((await clickSave(page)).status()).toBe(200);
		const saved = (await api.getEntry("posts", post.id)).data["gallery"] as ImageRef[];
		expect(saved.map((ref) => ref.alt)).toEqual(["二", "三", "一"]);
	});

	test("ドラッグ(つまみ)で並べ替えられ、落とす位置に線が出る", async ({ page, api, token }) => {
		const post = await createGalleryPost(api, token, ["一", "二", "三"]);
		await openPost(page, post.id);
		const gallery = galleryWidget(page);
		await expect(gallery.rows).toHaveCount(3);

		const handle = gallery.row(3).locator("[data-gallery-handle]");
		const handleBox = await handle.boundingBox();
		const targetBox = await gallery.row(1).boundingBox();
		if (handleBox === null || targetBox === null) throw new Error("行の位置を読めません");
		await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
		await page.mouse.down();
		await page.mouse.move(targetBox.x + 40, targetBox.y + targetBox.height * 0.4, { steps: 4 });
		await page.mouse.move(targetBox.x + 40, targetBox.y + targetBox.height * 0.25, { steps: 4 });
		// 1 枚目の前に落とす線(上側の影)と、ドラッグ中の行の薄い表示
		await expect(gallery.row(1)).toHaveCSS("box-shadow", /-3px/);
		await expect(gallery.row(3)).toHaveClass(/opacity-50/);
		await page.mouse.up();
		await expect.poll(() => altTexts(page)).toEqual(["三", "一", "二"]);
		await expect(gallery.announcement).toHaveText(
			"画像を 3 番目から 1 番目に移動しました(全 3 枚)。",
		);
		await expect(gallery.row(1)).not.toHaveCSS("box-shadow", /-3px/);
		expect((await clickSave(page)).status()).toBe(200);
		const saved = (await api.getEntry("posts", post.id)).data["gallery"] as ImageRef[];
		expect(saved.map((ref) => ref.alt)).toEqual(["三", "一", "二"]);
	});

	test("削除すると次の画像の見出しへ、最後なら前の画像へ、無くなればドロップゾーンへフォーカスが移る", async ({
		page,
		api,
		token,
	}) => {
		const post = await createGalleryPost(api, token, ["一", "二", "三"]);
		await openPost(page, post.id);
		const gallery = galleryWidget(page);
		const title = (n: number) => gallery.root.locator("[data-gallery-title]").nth(n - 1);

		await gallery.root.getByRole("button", { name: "画像 2 を削除" }).focus();
		await page.keyboard.press("Enter");
		await expect(gallery.rows).toHaveCount(2);
		await expect(gallery.announcement).toHaveText("2 番目の画像を削除しました(残り 2 枚)。");
		await expect(title(2)).toBeFocused();
		expect(await altTexts(page)).toEqual(["一", "三"]);

		await gallery.root.getByRole("button", { name: "画像 2 を削除" }).click();
		await expect(gallery.rows).toHaveCount(1);
		await expect(title(1)).toBeFocused();

		await gallery.root.getByRole("button", { name: "画像 1 を削除" }).click();
		await expect(gallery.rows).toHaveCount(0);
		await expect(gallery.zone).toBeFocused();
		await expect(gallery.count).toHaveText("0 / 10 枚");
		expect((await clickSave(page)).status()).toBe(200);
		expect((await api.getEntry("posts", post.id)).data["gallery"]).toEqual([]);
	});

	test("枚数の上限: 12 枚を選ぶと 10 枚を追加し、超えた 2 枚はファイルごとに失敗を出す。上限に達したら追加できない", async ({
		page,
	}) => {
		const uploads = recordUploads(page);
		await openNewPost(page);
		const gallery = galleryWidget(page);
		await gallery.fileInput.setInputFiles(
			Array.from({ length: 12 }, (_, i) => fixture(galleryImage(i + 1))),
		);
		await expect(gallery.progress).toHaveText("10 枚の画像を追加しました。", { timeout: 30_000 });
		await expect(gallery.rows).toHaveCount(10);
		expect(uploads.count()).toBe(10);
		for (const name of [galleryImage(11), galleryImage(12)]) {
			// oxlint-disable-next-line no-await-in-loop -- ファイルごとのエラーを確かめる
			await expect(gallery.errors.filter({ hasText: name })).toContainText(
				"ギャラリーの画像の枚数が上限を超えています。",
			);
		}
		await expect(gallery.errors).toHaveCount(2);
		await expect(gallery.zone).toBeDisabled();
		await expect(
			gallery.root.getByText("上限の 10 枚に達しています。追加するには、画像を削除してください。"),
		).toBeVisible();
		await expect(gallery.count).toHaveText("10 / 10 枚");

		await gallery.root.getByRole("button", { name: "エラーをすべて閉じる" }).click();
		await expect(gallery.errors).toHaveCount(0);
		// ドロップゾーンは押せないので、最後の画像の見出しへ
		await expect(gallery.root.locator("[data-gallery-title]").nth(9)).toBeFocused();
	});

	test("受け付けない形式(HEIC)は、ほかの画像を待たずに失敗を出し、残りの画像は追加する", async ({
		page,
	}) => {
		await openNewPost(page);
		const gallery = galleryWidget(page);
		await gallery.fileInput.setInputFiles([
			fixture(galleryImage(1)),
			fixture("heic-640x480.heic"),
			fixture(galleryImage(2)),
		]);
		await expect(gallery.errors.filter({ hasText: "heic-640x480.heic" })).toContainText(
			"HEIC / HEIF の画像は使えません。",
		);
		await expect(gallery.progress).toHaveText("2 枚の画像を追加しました。");
		await expect(gallery.rows).toHaveCount(2);
	});

	test("差し替えると、その位置だけ新しい画像になり、代替テキストは空、フォーカスはその画像の代替テキストへ", async ({
		page,
		api,
		token,
	}) => {
		const post = await createGalleryPost(api, token, ["一", "二"]);
		await openPost(page, post.id);
		const gallery = galleryWidget(page);
		await gallery.root.getByRole("button", { name: "画像 1 を差し替え" }).focus();
		const [chooser] = await Promise.all([
			page.waitForEvent("filechooser"),
			page.keyboard.press("Enter"),
		]);
		expect(chooser.isMultiple()).toBe(false);
		await chooser.setFiles(fixture(ACCEPTED.webp));
		await expect(gallery.announcement).toHaveText("1 番目の画像を差し替えました。");
		const firstAlt = gallery.row(1).getByRole("textbox", { name: "代替テキスト(画像 1)" });
		await expect(firstAlt).toBeFocused();
		await expect(firstAlt).toHaveValue("");
		expect(await altTexts(page)).toEqual(["", "二"]);
		await expect(gallery.row(1).locator("img")).toHaveAttribute("width", "640");
		expect((await clickSave(page)).status()).toBe(200);
		const saved = (await api.getEntry("posts", post.id)).data["gallery"] as ImageRef[];
		expect(saved[0]?.id).not.toBe(post.refs[0]?.id);
		expect(saved[1]).toEqual(post.refs[1]);
	});

	test("ドロップ: 複数のファイルをまとめて受け取り、1 枚ずつ追加する", async ({ page }) => {
		await openNewPost(page);
		const gallery = galleryWidget(page);
		const transfer = await createDataTransfer(page, [galleryImage(4), galleryImage(5)]);
		for (const type of ["dragenter", "dragover", "drop"]) {
			// oxlint-disable-next-line no-await-in-loop -- ドラッグのイベントは順に送る
			await gallery.zoneFrame.dispatchEvent(type, { dataTransfer: transfer });
		}
		await expect(gallery.progress).toHaveText("2 枚の画像を追加しました。");
		await expect(gallery.rows).toHaveCount(2);
		// マウスでドロップしただけなら、フォーカスは動かさない
		await expect(gallery.zone).not.toBeFocused();
	});
});
