/**
 * 画像管理ページ(`/_emdash/admin/plugins/base64-image/images`。仕様書 9 章・11.5)を、管理者で確かめる。
 * ロールごとのボタンは roles.spec.ts。
 *
 * 一覧は新しい順で、並列に動くほかのテストの画像も並ぶ。行は画像 ID で探す(`findImageRow`)。
 * 参照元の記録は、保存の応答のあとに hook が書く(T20)ので、API で状態を読み直して待ってからページを開く。
 */

import type { Response } from "@playwright/test";

import type { AdminApi, ImageListItem } from "./support/api";
import { clickSave, coverWidget, notifications, openPost } from "./support/admin";
import { failedResourcePattern } from "./support/console-guard";
import { PLUGIN_API } from "./support/env";
import { findImageRow, imagesPage, openImagesPage } from "./support/pages";
import { expect, test } from "./support/test";

/** 画像の一覧の状態が `expected` になるまで待つ(参照元の記録は、保存の応答のあとに書かれる) */
async function waitForImage(
	api: AdminApi,
	id: string,
	expected: Partial<Pick<ImageListItem, "usage" | "entryStatus" | "ownersTotal">>,
): Promise<void> {
	await expect
		.poll(
			async () => {
				const item = await api.findImage(id);
				return item === undefined
					? undefined
					: { usage: item.usage, entryStatus: item.entryStatus, ownersTotal: item.ownersTotal };
			},
			{ timeout: 20_000 },
		)
		.toMatchObject(expected);
}

/** 一覧に 2 ページ目があるようにする(無ければ、参照元の無い画像を 11 枚足す) */
async function ensureSecondPage(api: AdminApi): Promise<void> {
	const first = await api.listImages();
	if (first.nextCursor !== undefined) return;
	for (let i = 0; i < 11; i++) {
		// oxlint-disable-next-line no-await-in-loop -- アップロードは 1 枚ずつ
		await api.uploadImage({ collection: "posts", field: "gallery" });
	}
}

function isListResponse(response: Response): boolean {
	return new URL(response.url()).pathname === `${PLUGIN_API}/images/list`;
}

test.describe("画像管理ページ", () => {
	test("状態ごとの表示: 使用中・参照元が削除された・参照元から外された・参照元なし", async ({
		page,
		api,
		token,
	}) => {
		const inUse = await api.uploadImage({ collection: "posts", field: "cover" });
		const ownerDeleted = await api.uploadImage({ collection: "posts", field: "cover" });
		const detached = await api.uploadImage({ collection: "posts", field: "cover" });
		const noOwner = await api.uploadImage({ collection: "posts", field: "cover" });
		const inUsePost = await api.createPost({
			title: `E2E in use ${token}`,
			slug: `e2e-in-use-${token}`,
			cover: inUse,
		});
		const deletedPost = await api.createPost({
			title: `E2E deleted ${token}`,
			slug: `e2e-deleted-${token}`,
			cover: ownerDeleted,
		});
		const detachedPost = await api.createPost({
			title: `E2E detached ${token}`,
			slug: `e2e-detached-${token}`,
			cover: detached,
		});
		await waitForImage(api, ownerDeleted.id, { usage: "in_use" });
		await waitForImage(api, detached.id, { usage: "in_use" });
		await api.trashEntry("posts", deletedPost.id);
		// 外す: 一度も公開していない投稿の列の値は作成したときの値なので(仕様書 9 章)、画像を外した下書きを公開する
		expect((await api.updateEntry("posts", detachedPost.id, { cover: null })).status()).toBe(200);
		await api.publish("posts", detachedPost.id);
		await waitForImage(api, inUse.id, { usage: "in_use", ownersTotal: 1 });
		await waitForImage(api, ownerDeleted.id, { usage: "owner_deleted" });
		await waitForImage(api, detached.id, { usage: "detached" });
		await waitForImage(api, noOwner.id, { usage: "no_owner", ownersTotal: 0 });

		await openImagesPage(page);
		const inUseRow = await findImageRow(page, inUse.id);
		await expect(inUseRow.getByText("使用中", { exact: true }).first()).toBeVisible();
		await expect(inUseRow.getByRole("link", { name: `posts / ${inUsePost.id}` })).toHaveAttribute(
			"href",
			`/_emdash/admin/content/posts/${inUsePost.id}?locale=en`,
		);
		await expect(inUseRow.getByText("フィールド cover · en · 使用中")).toBeVisible();

		const deletedRow = await findImageRow(page, ownerDeleted.id);
		await expect(deletedRow.getByText("参照元が削除された", { exact: true })).toBeVisible();
		// 削除された参照元はリンクにしない
		await expect(deletedRow.getByRole("link")).toHaveCount(0);
		await expect(deletedRow.getByText(`posts / ${deletedPost.id}`)).toBeVisible();
		await expect(deletedRow.getByText("フィールド cover · en · 削除済み")).toBeVisible();

		const detachedRow = await findImageRow(page, detached.id);
		await expect(detachedRow.getByText("参照元から外された", { exact: true })).toBeVisible();
		await expect(detachedRow.getByText("フィールド cover · en · 外された")).toBeVisible();

		const noOwnerRow = await findImageRow(page, noOwner.id);
		await expect(noOwnerRow.getByText("参照元なし", { exact: true })).toBeVisible();
		await expect(noOwnerRow.getByText("なし", { exact: true })).toBeVisible();
		for (const row of [inUseRow, deletedRow, detachedRow, noOwnerRow]) {
			// oxlint-disable-next-line no-await-in-loop -- 行ごとに確かめる
			await expect(row.getByText("公開済み", { exact: true })).toBeVisible();
			// サムネイル(`alt=""` なので img の役割は無い)
			// oxlint-disable-next-line no-await-in-loop -- 同上
			await expect(row.locator("img")).toHaveAttribute("src", /^data:image\/webp;base64,/);
		}
	});

	test("ゴミ箱への移動をキーボードで操作できる: 最初のフォーカスはキャンセル、Escape で閉じてボタンに戻る。移動すると行は「ゴミ箱」になり、フォーカスは行の見出しへ", async ({
		page,
		api,
		token,
	}) => {
		const image = await api.uploadImage({ collection: "posts", field: "cover" });
		await api.createPost({ title: `E2E trash ${token}`, slug: `e2e-trash-${token}`, cover: image });
		await waitForImage(api, image.id, { usage: "in_use" });

		await openImagesPage(page);
		const images = imagesPage(page);
		const row = await findImageRow(page, image.id);
		const trashButton = row.getByRole("button", { name: /^ゴミ箱に移動: / });
		await trashButton.focus();
		await page.keyboard.press("Enter");
		await expect(images.dialog).toBeVisible();
		await expect(images.dialog).toHaveAccessibleName("画像をゴミ箱に移動しますか?");
		await expect(images.dialog).toContainText(
			"この画像は使用中です。移動すると、この画像を使っている投稿などに画像が表示されなくなります。",
		);
		const cancel = images.dialog.getByRole("button", { name: "キャンセル", exact: true });
		const confirm = images.dialog.getByRole("button", { name: "ゴミ箱に移動", exact: true });
		await expect(cancel).toBeFocused();
		// Tab はダイアログの中を回る
		await page.keyboard.press("Tab");
		await expect(confirm).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(images.dialog.locator(":focus")).toHaveCount(1);
		await page.keyboard.press("Escape");
		await expect(images.dialog).toHaveCount(0);
		await expect(trashButton).toBeFocused();

		await page.keyboard.press("Enter");
		await expect(cancel).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(confirm).toBeFocused();
		const trashed = page.waitForResponse(
			(response) => new URL(response.url()).pathname === `${PLUGIN_API}/images/trash`,
		);
		await page.keyboard.press("Enter");
		expect((await trashed).status()).toBe(200);
		await expect(images.dialog).toHaveCount(0);
		await expect(row.getByText("ゴミ箱", { exact: true })).toBeVisible();
		await expect(
			row.getByText("サイトに表示されません。ゴミ箱から戻せるのは編集者以上です。"),
		).toBeVisible();
		await expect(images.rowHeader(image.id)).toBeFocused();
		await expect(images.announcement).toHaveText(/をゴミ箱に移動しました。$/);
		await expect(row.getByRole("button", { name: /^ゴミ箱に移動: / })).toHaveCount(0);
		await expect(row.getByRole("button", { name: /^完全に削除: / })).toBeVisible();
	});

	test("完全に削除すると行が消えてフォーカスが次の行へ移る。その画像を参照したままの投稿は保存できず(422)、画像を外すと保存できる", async ({
		page,
		api,
		token,
		consoleGuard,
	}) => {
		// 保存の拒否(422)は、Chromium が console のエラーとして出す
		consoleGuard.allow(failedResourcePattern(422));
		const image = await api.uploadImage({ collection: "posts", field: "cover" });
		const post = await api.createPost({
			title: `E2E delete ${token}`,
			slug: `e2e-delete-${token}`,
			cover: image,
		});
		await waitForImage(api, image.id, { usage: "in_use" });
		await api.trashImage(image.id);

		await openImagesPage(page);
		const images = imagesPage(page);
		const row = await findImageRow(page, image.id);
		await expect(row.getByText("ゴミ箱", { exact: true })).toBeVisible();
		await row.getByRole("button", { name: /^完全に削除: / }).click();
		await expect(images.dialog).toHaveAccessibleName("画像を完全に削除しますか?");
		await expect(images.dialog).toContainText("完全に削除した画像は、元に戻せません。");
		await expect(images.dialog).toContainText(
			"この画像はまだ使用中です。参照している投稿などは、画像を外すまで保存できなくなります。",
		);
		const deleted = page.waitForResponse(
			(response) =>
				response.request().method() === "DELETE" &&
				new URL(response.url()).pathname ===
					`/_emdash/api/content/b64_images/${image.id}/permanent`,
		);
		await images.dialog.getByRole("button", { name: "完全に削除", exact: true }).click();
		expect((await deleted).status()).toBe(200);
		await expect(images.row(image.id)).toHaveCount(0);
		await expect(images.announcement).toHaveText(/を完全に削除しました。$/);
		await expect(page.locator(':focus[scope="row"], h1:focus')).toHaveCount(1);
		// 記録は、応答のあとに完全削除の hook が消す
		await expect.poll(() => api.findImage(image.id), { timeout: 20_000 }).toBeUndefined();

		// 参照したままの投稿: 「画像が見つかりません」。保存は保存 hook(8 章③)が拒否する
		await openPost(page, post.id);
		const cover = coverWidget(page);
		await expect(cover.root.getByText("画像が見つかりません", { exact: true })).toBeVisible();
		await page.getByRole("textbox", { name: "Title" }).fill(`E2E delete ${token} 更新`);
		const rejected = await clickSave(page);
		expect(rejected.status()).toBe(422);
		expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe(
			"SAVE_REJECTED",
		);
		// 通知には、保存 hook の日本語と英語の文が並ぶ(サーバーは管理画面の言語を知らない)
		await expect(notifications(page)).toContainText("画像が見つかりません");
		await expect(notifications(page)).toContainText("image not found");

		await cover.remove.click();
		await expect(cover.zone).toBeFocused();
		const saved = await clickSave(page);
		expect(saved.status()).toBe(200);
		expect((await api.getEntry("posts", post.id)).data["cover"]).toBeNull();
	});

	test("公開: ゴミ箱から戻した画像は下書きになり、「公開」で公開済みになる", async ({
		page,
		api,
	}) => {
		const image = await api.uploadImage({ collection: "posts", field: "cover" });
		await api.trashImage(image.id);
		await api.restoreEntry("b64_images", image.id);
		await waitForImage(api, image.id, { entryStatus: "active" });

		await openImagesPage(page);
		const images = imagesPage(page);
		const row = await findImageRow(page, image.id);
		await expect(row.getByText("下書き", { exact: true })).toBeVisible();
		await expect(row.getByText("サイトに表示されません。", { exact: true })).toBeVisible();
		const published = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === `/_emdash/api/content/b64_images/${image.id}/publish`,
		);
		await row.getByRole("button", { name: /^公開: / }).click();
		expect((await published).status()).toBe(200);
		await expect(row.getByText("公開済み", { exact: true })).toBeVisible();
		await expect(row.getByRole("button", { name: /^公開: / })).toHaveCount(0);
		await expect(images.rowHeader(image.id)).toBeFocused();
		await expect(images.announcement).toHaveText(/を公開しました。$/);
	});

	test("さらに読み込む: 続きの画像を足し、足した最初の行へフォーカスが移る", async ({
		page,
		api,
	}) => {
		await ensureSecondPage(api);
		await openImagesPage(page);
		const images = imagesPage(page);
		const before = await page.getByRole("rowheader").count();
		expect(before).toBeGreaterThan(0);
		await images.loadMore.click();
		await expect(images.announcement).toHaveText(/^さらに \d+ 枚の画像を読み込みました。$/);
		const announced = Number(
			/さらに (\d+) 枚/.exec((await images.announcement.textContent()) ?? "")?.[1],
		);
		expect(announced).toBeGreaterThan(0);
		await expect(page.getByRole("rowheader")).toHaveCount(before + announced);
		await expect(page.getByRole("rowheader").nth(before)).toBeFocused();
	});

	test("参照元の多い画像(参照元のエントリ 17 件): items が空の応答が続いても、続けて読んで表示する", async ({
		page,
		api,
		token,
	}) => {
		const image = await api.uploadImage({ collection: "posts", field: "cover" });
		for (let n = 1; n <= 17; n++) {
			// oxlint-disable-next-line no-await-in-loop -- 投稿は順に作る(参照元の記録の hook が、記録を 1 件ずつ足す)
			await api.createPost({
				title: `E2E owners ${token} ${n}`,
				slug: `e2e-owners-${token}-${n}`,
				cover: image,
			});
		}
		await waitForImage(api, image.id, { usage: "in_use", ownersTotal: 17 });

		const responses: { items: number; nextCursor: boolean }[] = [];
		page.on("response", async (response) => {
			if (!isListResponse(response)) return;
			const body = (await response.json()) as { data: { items: unknown[]; nextCursor?: string } };
			responses.push({
				items: body.data.items.length,
				nextCursor: body.data.nextCursor !== undefined,
			});
		});
		await openImagesPage(page);
		const images = imagesPage(page);
		let clicks = 0;
		// oxlint-disable-next-line no-await-in-loop -- 前の読み込みが終わってから、次を押す
		while ((await images.row(image.id).count()) === 0 && clicks < 30) {
			// oxlint-disable-next-line no-await-in-loop -- 同上
			await images.loadMore.click();
			clicks += 1;
			// oxlint-disable-next-line no-await-in-loop -- 同上
			await expect(images.loading).toHaveCount(0);
		}
		const row = images.row(image.id);
		await expect(row).toHaveCount(1);
		await expect(row.getByText("使用中", { exact: true }).first()).toBeVisible();
		await expect(row.getByRole("link", { name: /^posts \// })).toHaveCount(17);

		// items が空の応答があり、そのたびに画面は利用者の操作を待たずに次を読んだ(要求の数 = 操作の数 + 空の応答の数)
		const emptyCount = () =>
			responses.filter((entry) => entry.items === 0 && entry.nextCursor).length;
		await expect.poll(() => responses.length - emptyCount()).toBe(1 + clicks);
		expect(emptyCount()).toBeGreaterThanOrEqual(1);
	});

	test("読み込み位置が使えない(400 INVALID_CURSOR)ときは、最初から読み直して知らせる", async ({
		page,
		api,
		consoleGuard,
	}) => {
		consoleGuard.allow(failedResourcePattern(400));
		await ensureSecondPage(api);
		// 「さらに読み込む」を押した直後の要求だけ、カーソルを読めない値に書き換える
		// (最初の読み込みでも、参照元の多い画像を調べている間はカーソル付きの要求が続くので、それは書き換えない)
		let rewriteNext = false;
		await page.route(`**${PLUGIN_API}/images/list`, async (route) => {
			const body = route.request().postDataJSON() as { cursor?: string };
			if (!rewriteNext || body.cursor === undefined) {
				await route.continue();
				return;
			}
			rewriteNext = false;
			await route.continue({ postData: JSON.stringify({ cursor: "e2e-invalid-cursor" }) });
		});
		await openImagesPage(page);
		const images = imagesPage(page);
		const statuses: number[] = [];
		page.on("response", (response) => {
			if (isListResponse(response)) statuses.push(response.status());
		});
		rewriteNext = true;
		await images.loadMore.click();
		await expect(
			page.getByText("一覧の読み込み位置が古くなったため、最初から読み込み直しました。").first(),
		).toBeVisible();
		await expect(images.announcement).toHaveText(
			/^一覧の読み込み位置が古くなったため、最初から読み込み直しました。 \d+ 枚の画像を読み込みました。$/,
		);
		// 400 のあと、最初から読み直した(カーソルの無い要求から続く)要求はどれも 200
		expect(statuses[0]).toBe(400);
		expect(statuses.length).toBeGreaterThanOrEqual(2);
		expect(statuses.slice(1).every((status) => status === 200)).toBe(true);
		await expect(images.table).toBeVisible();
	});

	test("英語の管理画面では、ページの文言も英語になる", async ({ page, api }) => {
		const image = await api.uploadImage({ collection: "posts", field: "cover" });
		await page
			.context()
			.addCookies([{ name: "emdash-locale", value: "en", domain: "localhost", path: "/_emdash" }]);
		await page.goto("/_emdash/admin/plugins/base64-image/images");
		await expect(page.getByRole("heading", { level: 1, name: "Manage images" })).toBeVisible();
		const row = page.getByRole("row").filter({ hasText: `ID ${image.id}` });
		await expect(row).toHaveCount(1);
		await expect(row.getByText("Not referenced", { exact: true })).toBeVisible();
		await expect(row.getByRole("button", { name: /^Move to trash: / })).toBeVisible();
	});
});
