/**
 * コンテンツ一覧のサムネイル列(仕様書 11.4)。global setup が、ギャラリーだけのコレクション `albums`(`photos`)と、
 * このプラグインのフィールドが無いコレクション `notes` を作っている。
 */

import type { Page, Request } from "@playwright/test";

import { contentRow, filterContentList } from "./support/admin";
import { readData } from "./support/api";
import { CSRF_HEADERS, PLUGIN_API } from "./support/env";
import { expect, test } from "./support/test";

/** 一覧の表で、見出しが `label` の列の位置(0 から)。無ければ -1 */
async function columnIndex(page: Page, label: string): Promise<number> {
	const table = page.locator("main table");
	await expect(table).toBeVisible();
	return table.evaluate((element, name) => {
		const headers = Array.from(element.querySelectorAll("thead th"));
		return headers.findIndex(
			(th) => th.getAttribute("aria-label") === name || th.textContent?.trim() === name,
		);
	}, label);
}

function isThumbnailsRequest(request: Request): boolean {
	return new URL(request.url()).pathname === `${PLUGIN_API}/thumbnails`;
}

test.describe("コンテンツ一覧のサムネイル列", () => {
	test("Posts: 見出しは「画像」。1 ページのサムネイルは 1 回の要求で取得し、画像なしは「—」、記録の無い画像は警告", async ({
		page,
		api,
		token,
	}) => {
		const withCover = await api.uploadImage({ collection: "posts", field: "cover" });
		const deleted = await api.uploadImage({ collection: "posts", field: "cover" });
		const trashed = await api.uploadImage({ collection: "posts", field: "cover" });
		const titles = {
			cover: `E2E list cover ${token}`,
			none: `E2E list none ${token}`,
			deleted: `E2E list deleted ${token}`,
			trashed: `E2E list trashed ${token}`,
		};
		await api.createPost({
			title: titles.cover,
			slug: `e2e-list-cover-${token}`,
			cover: { ...withCover, alt: "一覧のカバー" },
		});
		await api.createPost({ title: titles.none, slug: `e2e-list-none-${token}`, cover: null });
		await api.createPost({
			title: titles.deleted,
			slug: `e2e-list-deleted-${token}`,
			cover: deleted,
		});
		await api.createPost({
			title: titles.trashed,
			slug: `e2e-list-trashed-${token}`,
			cover: trashed,
		});
		// 完全に削除すると、記録(imageRefs)も消える。ゴミ箱に移しただけなら記録は残る
		await api.deleteImagePermanently(deleted.id);
		await api.trashImage(trashed.id);

		const requests: Request[] = [];
		page.on("request", (request) => {
			if (isThumbnailsRequest(request)) requests.push(request);
		});
		await page.goto("/_emdash/admin/content/posts");
		const index = await columnIndex(page, "画像");
		expect(index).toBeGreaterThan(0);
		await filterContentList(page, "Posts", token, 4);
		const cell = (title: string) => contentRow(page, title).getByRole("cell").nth(index);

		const coverImage = cell(titles.cover).getByRole("img", { name: "一覧のカバー" });
		await expect(coverImage).toBeVisible();
		await expect(coverImage).toHaveAttribute("src", /^data:image\/webp;base64,/);
		await expect(cell(titles.none)).toHaveText("—画像なし");
		const missing = cell(titles.deleted).locator(
			'[title="画像が見つかりません(完全に削除されたか、記録がありません)"]',
		);
		await expect(missing).toBeVisible();
		await expect(cell(titles.trashed).getByRole("img", { name: "画像" })).toBeVisible();

		// 表示中の行の分を、まとめて 1 回で取得する。絞り込みの前の 1 ページ目に入っていれば、そのときの要求に含まれ、
		// 絞り込みのあとは取り直さない。入っていなければ、絞り込みのあとの 1 回に含まれる。どちらでも、この 3 枚を含む
		// 要求は 1 回で、同じ画像を 2 回は要求しない
		await page.waitForTimeout(1_000);
		const idLists = requests.map((request) => (request.postDataJSON() as { ids: string[] }).ids);
		const ours = [withCover.id, deleted.id, trashed.id];
		const containing = idLists.filter((ids) => ids.some((id) => ours.includes(id)));
		expect(containing).toHaveLength(1);
		expect(containing[0]).toEqual(expect.arrayContaining(ours));
		const requested = idLists.flat();
		expect(new Set(requested).size).toBe(requested.length);
	});

	test("Albums(ギャラリーだけ): 1 枚目と「+N」を出し、空のギャラリーは「—」", async ({
		page,
		api,
		token,
	}) => {
		const photos = [];
		for (const alt of ["アルバム 1", "アルバム 2", "アルバム 3"]) {
			// oxlint-disable-next-line no-await-in-loop -- アップロードは 1 枚ずつ
			const ref = await api.uploadImage({ collection: "albums", field: "photos" });
			photos.push({ ...ref, alt });
		}
		const full = `E2E album full ${token}`;
		const empty = `E2E album empty ${token}`;
		await api.createEntry("albums", `e2e-album-full-${token}`, { title: full, photos });
		await api.createEntry("albums", `e2e-album-empty-${token}`, { title: empty, photos: [] });

		await page.goto("/_emdash/admin/content/albums");
		const index = await columnIndex(page, "画像");
		expect(index).toBeGreaterThan(0);
		await filterContentList(page, "Albums", token, 2);
		const fullCell = contentRow(page, full).getByRole("cell").nth(index);
		await expect(fullCell.getByRole("img", { name: "アルバム 1" })).toBeVisible();
		await expect(fullCell).toContainText("+2");
		await expect(fullCell).toContainText("ほか 2 枚");
		await expect(contentRow(page, empty).getByRole("cell").nth(index)).toHaveText("—画像なし");
	});

	test("このプラグインのフィールドが無いコレクション(Notes)には列が出ない: 直接開いたときと、ダッシュボードから最初に開いたとき", async ({
		page,
		api,
		token,
	}) => {
		const title = `E2E note ${token}`;
		await api.createEntry("notes", `e2e-note-${token}`, { title });
		const requests: Request[] = [];
		page.on("request", (request) => {
			if (isThumbnailsRequest(request)) requests.push(request);
		});

		// ダッシュボードから、SPA の中の移動で最初に開く一覧
		await page.goto("/_emdash/admin/");
		await expect(page.getByRole("heading", { level: 1, name: "ダッシュボード" })).toBeVisible();
		await page
			.getByRole("complementary", { name: "管理ナビゲーション" })
			.getByRole("link", { name: "Notes" })
			.click();
		await expect(contentRow(page, title)).toBeVisible();
		expect(await columnIndex(page, "画像")).toBe(-1);

		// 直接開く
		await page.goto("/_emdash/admin/content/notes");
		await expect(contentRow(page, title)).toBeVisible();
		expect(await columnIndex(page, "画像")).toBe(-1);
		expect(requests).toHaveLength(0);
	});

	test("英語の管理画面では、列の見出しが「Image」になる", async ({ page }) => {
		await page
			.context()
			.addCookies([{ name: "emdash-locale", value: "en", domain: "localhost", path: "/_emdash" }]);
		await page.goto("/_emdash/admin/content/posts");
		await expect(page.getByRole("columnheader", { name: "Image", exact: true })).toBeVisible();
		expect(await columnIndex(page, "画像")).toBe(-1);
	});
});

test.describe("一覧の一括操作と参照元の記録", () => {
	test("複製した投稿(記録なし)を一覧の一括公開で公開すると、参照元が記録される(応答のあとに書かれるので、読み直して待つ)", async ({
		page,
		api,
		token,
	}) => {
		const ref = await api.uploadImage({ collection: "posts", field: "cover" });
		const title = `E2E bulk ${token}`;
		const original = await api.createPost({
			title,
			slug: `e2e-bulk-${token}`,
			cover: { ...ref, alt: "一括公開のカバー" },
		});
		const ownersOf = async () =>
			((await api.findImage(ref.id))?.owners ?? []).map((owner) => owner.entryId).toSorted();
		await expect.poll(ownersOf, { timeout: 20_000 }).toEqual([original.id]);
		// 複製はどの hook も呼ばないので、参照元は増えない(仕様書 9 章。サーバー側の確認は server-validation.api.spec.ts)
		const duplicated = await readData<{ item: { id: string } }>(
			await api.request.post(`/_emdash/api/content/posts/${original.id}/duplicate`, {
				headers: CSRF_HEADERS,
			}),
			"複製",
		);
		const copyId = duplicated.item.id;

		// 管理画面の一括公開は、エントリごとの公開の API を呼ぶ(afterPublish の hook が参照元を記録する)
		await page.goto("/_emdash/admin/content/posts");
		await filterContentList(page, "Posts", token, 2);
		const copyRow = contentRow(page, `${title} (Copy)`);
		// 複製の行にも、同じ画像のサムネイルが出る
		await expect(copyRow.getByRole("img", { name: "一括公開のカバー" })).toBeVisible();
		await copyRow.getByRole("checkbox").check();
		const published = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				new URL(response.url()).pathname === `/_emdash/api/content/posts/${copyId}/publish`,
		);
		await page.getByRole("button", { name: "公開", exact: true }).click();
		expect((await published).status()).toBe(200);
		await expect.poll(ownersOf, { timeout: 20_000 }).toEqual([original.id, copyId].toSorted());
	});
});
