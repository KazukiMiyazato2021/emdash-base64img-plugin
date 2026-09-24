/**
 * 画像管理ページのロールごとの表示(仕様書 10 章・11.5、T06・T25)。
 *
 * ロールの利用者のログインの状態は global setup が作る(e2e/global-setup.ts の「ロールの利用者」)。ボタンの出し分けは
 * 表示のためだけで、権限はサーバーが判定する(寄稿者のゴミ箱への移動は実際に通ること、閲覧者の一覧は 403 になることを見る)。
 */

import type { Locator } from "@playwright/test";

import type { AdminApi } from "./support/api";
import { failedResourcePattern } from "./support/console-guard";
import { authStatePath, PLUGIN_API, type RoleName } from "./support/env";
import { findImageRow, imagesPage, openImagesPage } from "./support/pages";
import { expect, test } from "./support/test";

/** 状態の違う 3 枚: 公開済み・下書き(ゴミ箱から戻した)・ゴミ箱 */
async function createImagesInEachState(api: AdminApi) {
	const published = await api.uploadImage({ collection: "posts", field: "cover" });
	const draft = await api.uploadImage({ collection: "posts", field: "cover" });
	const trashed = await api.uploadImage({ collection: "posts", field: "cover" });
	await api.trashImage(draft.id);
	await api.restoreEntry("b64_images", draft.id);
	await api.trashImage(trashed.id);
	return { published: published.id, draft: draft.id, trashed: trashed.id };
}

/** 行の操作のボタン(名前の「<操作>: <画像の名前>」の操作の部分) */
async function actionsOf(row: Locator): Promise<string[]> {
	const names = await row
		.getByRole("button")
		.evaluateAll((buttons) =>
			buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent ?? ""),
		);
	return names.map((name) => name.split(": ")[0] ?? name);
}

const EXPECTED: Record<
	Exclude<RoleName, "subscriber">,
	Record<"published" | "draft" | "trashed", string[]>
> = {
	admin: { published: ["ゴミ箱に移動"], draft: ["公開", "ゴミ箱に移動"], trashed: ["完全に削除"] },
	editor: { published: ["ゴミ箱に移動"], draft: ["公開", "ゴミ箱に移動"], trashed: [] },
	author: { published: ["ゴミ箱に移動"], draft: ["ゴミ箱に移動"], trashed: [] },
	contributor: { published: ["ゴミ箱に移動"], draft: ["ゴミ箱に移動"], trashed: [] },
};

for (const role of ["admin", "editor", "author", "contributor"] as const) {
	test.describe(`ロール: ${role}`, () => {
		test.use({ storageState: authStatePath(role) });

		test(`${role} には、画像の状態とロールに応じた操作のボタンだけが出る`, async ({
			page,
			api,
		}) => {
			const ids = await createImagesInEachState(api);
			await openImagesPage(page);
			// 操作のボタンは、ロール(`GET /_emdash/api/auth/me`)が届いてから出る(届くまではロール 0 として扱う)。
			// 一覧が先に届くと、行はボタン無しで出る。最初に確かめる公開済みの行は、どのロールでも「ゴミ箱に移動」が
			// 出るので、その行で待てば、ロールが届いてから残りの行を確かめられる(ボタンが無いはずの行を待つと、すぐに通ってしまう)。
			for (const state of ["published", "draft", "trashed"] as const) {
				// oxlint-disable-next-line no-await-in-loop -- 行ごとに確かめる
				const row = await findImageRow(page, ids[state]);
				// oxlint-disable-next-line no-await-in-loop -- 同上
				await expect
					.poll(() => actionsOf(row), { message: `${role} / ${state}` })
					.toEqual(EXPECTED[role][state]);
			}
		});
	});
}

test.describe("ロール: contributor(操作)", () => {
	test.use({ storageState: authStatePath("contributor") });

	test("寄稿者は、使用中でない画像をゴミ箱に移せる(サーバーも受け付ける)", async ({
		page,
		api,
	}) => {
		const image = await api.uploadImage({ collection: "posts", field: "cover" });
		await openImagesPage(page);
		const images = imagesPage(page);
		const row = await findImageRow(page, image.id);
		await row.getByRole("button", { name: /^ゴミ箱に移動: / }).click();
		await expect(images.dialog).toHaveAccessibleName("画像をゴミ箱に移動しますか?");
		const trashed = page.waitForResponse(
			(response) => new URL(response.url()).pathname === `${PLUGIN_API}/images/trash`,
		);
		await images.dialog.getByRole("button", { name: "ゴミ箱に移動", exact: true }).click();
		expect((await trashed).status()).toBe(200);
		await expect(row.getByText("ゴミ箱", { exact: true })).toBeVisible();
		// 寄稿者には完全削除のボタンが出ない
		await expect(row.getByRole("button")).toHaveCount(0);
		expect((await api.findImage(image.id))?.entryStatus).toBe("trashed");
	});
});

test.describe("ロール: subscriber", () => {
	test.use({ storageState: authStatePath("subscriber") });

	test("閲覧者が開くと、一覧は 403 になり、権限が要ることを示す(サイドバーの項目はロールで絞られない)", async ({
		page,
		consoleGuard,
	}) => {
		consoleGuard.allow(failedResourcePattern(403));
		const listed = page.waitForResponse(
			(response) => new URL(response.url()).pathname === `${PLUGIN_API}/images/list`,
		);
		await page.goto("/_emdash/admin/plugins/base64-image/images");
		expect((await listed).status()).toBe(403);
		const images = imagesPage(page);
		await expect(images.heading).toBeVisible();
		const alert = page.getByRole("alert").filter({ hasText: "画像の一覧を読み込めませんでした" });
		await expect(alert).toContainText(
			"画像の一覧を見る権限がありません。画像の管理は、寄稿者以上のロールで行えます。",
		);
		await expect(images.table).toHaveCount(0);
		await expect(
			page
				.getByRole("complementary", { name: "管理ナビゲーション" })
				.getByRole("link", { name: "画像", exact: true }),
		).toBeVisible();
	});
});
