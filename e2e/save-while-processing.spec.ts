/**
 * 処理中の保存(仕様書 18 章、docs/gallery-widget-reorder-focus.md の 4 章)。
 *
 * EmDash の編集画面は、保存の応答が届くとフォームの値を応答の `item.data` に置き換える。手動の保存の要求を送ってから
 * 応答が届くまでに widget が足した画像は、応答でフォームから外れる。時間に頼らないように、アップロードの要求と
 * 手動の保存の要求(`skipRevision` の無い PUT)を `page.route` で止め、順番を決めて進める。
 */

import type { Page } from "@playwright/test";

import type { ImageRef } from "./support/api";
import {
	coverWidget,
	entryIdFromUrl,
	galleryWidget,
	holdManualSaves,
	holdUploads,
	isManualSave,
	isUploadRequest,
	openNewPost,
	openPost,
	saveButton,
} from "./support/admin";
import { fixture } from "./support/env";
import { ACCEPTED, galleryImage } from "./support/images";
import { expect, test } from "./support/test";

const SAVE_HINT = "処理が終わってから保存してください。";

/** アップロードの応答で作られた画像の ID(順に) */
function recordUploadedIds(page: Page): () => string[] {
	const ids: string[] = [];
	page.on("response", async (response) => {
		if (!isUploadRequest(response.request()) || response.status() !== 200) return;
		const body = (await response.json()) as { data: { ref: ImageRef } };
		ids.push(body.data.ref.id);
	});
	return () => ids;
}

/** 手動の保存の応答を待つ */
function waitForManualSave(page: Page) {
	return page.waitForResponse((response) => isManualSave(response.request()));
}

test("既存の投稿: ギャラリーの処理中に保存すると、保存の要求のあいだに足した画像はフォームから外れる", async ({
	page,
	api,
	token,
}) => {
	const post = await api.createPost({
		title: `E2E save busy ${token}`,
		slug: `e2e-save-busy-${token}`,
	});
	await openPost(page, post.id);
	const uploadedIds = recordUploadedIds(page);
	// 1 枚目は通し、2 枚目から止める
	const uploads = await holdUploads(page, { passFirst: 1 });
	const saves = await holdManualSaves(page);
	const gallery = galleryWidget(page);
	await gallery.fileInput.setInputFiles([1, 2, 3, 4].map((n) => fixture(galleryImage(n))));
	await expect(gallery.rows).toHaveCount(1);
	await expect.poll(() => uploads.held()).toBe(1);
	// 処理中の案内が出て、キャンセルボタンの説明になっている
	await expect(gallery.saveHint).toBeVisible();
	await expect(gallery.cancel).toHaveAccessibleDescription(SAVE_HINT);

	// 1 枚が値に入ったところで保存する(案内は保存を止めない)
	await saveButton(page).click();
	await expect.poll(() => saves.bodies().length).toBe(1);
	const sent = (saves.bodies()[0] as { data: { gallery: ImageRef[] } }).data.gallery;
	expect(sent).toHaveLength(1);

	// 保存の要求のあいだに、残りの 3 枚を処理させる
	uploads.release();
	await expect(gallery.rows).toHaveCount(4);
	await expect(gallery.saveHint).toHaveCount(0);

	// 保存の応答で、フォームの値は保存した 1 枚に戻る(あとの 3 枚は、知らせなしに外れる)
	const saved = waitForManualSave(page);
	saves.release();
	expect((await saved).status()).toBe(200);
	await expect(gallery.rows).toHaveCount(1);
	const entry = await api.getEntry("posts", post.id);
	expect((entry.data["gallery"] as ImageRef[]).map((ref) => ref.id)).toEqual(
		sent.map((ref) => ref.id),
	);
	// 外れた画像のエントリは残る。アップロードのときに参照元(この投稿)が記録されるので、状態は detached
	// (参照元の値に無い)になる
	expect(uploadedIds()).toHaveLength(4);
	const dropped = uploadedIds()[3] ?? "";
	await expect
		.poll(
			async () => {
				const image = await api.findImage(dropped);
				return { usage: image?.usage, owners: image?.owners.map((owner) => owner.entryId) };
			},
			{ timeout: 20_000 },
		)
		.toEqual({ usage: "detached", owners: [post.id] });
});

test("既存の投稿: 単一画像の処理中に保存すると、保存の要求のあいだに入った画像はフォームから外れる", async ({
	page,
	api,
	token,
}) => {
	const post = await api.createPost({
		title: `E2E save busy cover ${token}`,
		slug: `e2e-save-busy-cover-${token}`,
		cover: null,
	});
	await openPost(page, post.id);
	const uploads = await holdUploads(page);
	const saves = await holdManualSaves(page);
	// 保存のボタンを押せるように、ほかの欄を変える
	await page.getByRole("textbox", { name: "Title" }).fill(`E2E save busy cover ${token} (edited)`);
	const cover = coverWidget(page);
	await cover.fileInput.setInputFiles(fixture(ACCEPTED.webp));
	await expect.poll(() => uploads.held()).toBe(1);
	await expect(cover.saveHint).toBeVisible();
	await expect(cover.cancel).toHaveAccessibleDescription(SAVE_HINT);

	await saveButton(page).click();
	await expect.poll(() => saves.bodies().length).toBe(1);
	expect((saves.bodies()[0] as { data: { cover?: unknown } }).data.cover ?? null).toBeNull();

	uploads.release();
	await expect(cover.status).toHaveText("画像を追加しました。");
	await expect(cover.preview).toBeVisible();

	const saved = waitForManualSave(page);
	saves.release();
	expect((await saved).status()).toBe(200);
	// 応答の値(画像なし)に戻る
	await expect(cover.zone).toBeVisible();
	await expect(cover.preview).toHaveCount(0);
	expect((await api.getEntry("posts", post.id)).data["cover"] ?? null).toBeNull();
});

test("新規作成: 処理中に最初の保存をすると、widget が作り直されて残りの処理が止まる(知らせは出ない)", async ({
	page,
	api,
	token,
}) => {
	await openNewPost(page);
	await page.getByRole("textbox", { name: "Title" }).fill(`E2E save busy new ${token}`);
	const uploadRequests: string[] = [];
	page.on("request", (request) => {
		if (isUploadRequest(request)) uploadRequests.push(request.url());
	});
	const aborted: string[] = [];
	page.on("requestfailed", (request) => {
		if (isUploadRequest(request)) aborted.push(request.failure()?.errorText ?? "");
	});
	const uploads = await holdUploads(page, { passFirst: 1 });
	const gallery = galleryWidget(page);
	await gallery.fileInput.setInputFiles([1, 2, 3].map((n) => fixture(galleryImage(n))));
	await expect(gallery.rows).toHaveCount(1);
	await expect.poll(() => uploads.held()).toBe(1);
	await expect(gallery.saveHint).toBeVisible();

	const created = waitForManualSave(page);
	await saveButton(page).click();
	expect((await created).status()).toBe(201);
	await expect(page).toHaveURL(/\/_emdash\/admin\/content\/posts\/[0-9A-Z]{26}\?locale=en$/);
	const id = entryIdFromUrl(page);

	// 作り直しで、止めていた 2 枚目の要求は中断され、3 枚目は始まらない
	await expect.poll(() => aborted.length).toBe(1);
	uploads.release();
	await page.waitForTimeout(2_000);
	expect(uploadRequests).toHaveLength(2);
	await expect(gallery.rows).toHaveCount(1);
	await expect(gallery.saveHint).toHaveCount(0);
	await expect(gallery.cancel).toHaveCount(0);
	await expect(gallery.errors).toHaveCount(0);
	expect((await api.getEntry("posts", id)).data["gallery"]).toHaveLength(1);
});
