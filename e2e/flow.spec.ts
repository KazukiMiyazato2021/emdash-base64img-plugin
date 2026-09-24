/**
 * 通しの確認(仕様書 15 章): 実ブラウザの canvas で圧縮 → アップロード → 保存 → サイトに表示(img の width / height)
 * → 一覧のサムネイル → 画像管理ページ。
 */

import {
	clickSave,
	contentRow,
	coverWidget,
	entryIdFromUrl,
	filterContentList,
	galleryWidget,
	openNewPost,
	publishFromEditor,
	recordUploads,
} from "./support/admin";
import { fixture } from "./support/env";
import { ACCEPTED, galleryImage } from "./support/images";
import { expectSiteImage, findImageRow, openImagesPage, readRenderedImage } from "./support/pages";
import { expect, test } from "./support/test";

test("写真を選ぶと圧縮してアップロードし、保存・公開した投稿がサイト・一覧・画像管理ページに出る", async ({
	page,
	api,
	token,
}) => {
	const uploads = recordUploads(page);
	const title = `E2E flow ${token}`;
	await openNewPost(page);
	await page.getByRole("textbox", { name: "Title" }).fill(title);

	// 単一画像: 2400 × 1600 の JPEG は、長辺 1600px に縮小され、保存サイズ 100,000 バイト以下の画質になる
	const cover = coverWidget(page);
	await cover.fileInput.setInputFiles(fixture(ACCEPTED.photo));
	await expect(cover.status).toHaveText("画像を追加しました。");
	await expect(cover.preview).toHaveAttribute("width", "1600");
	await expect(cover.preview).toHaveAttribute("height", "1067");
	const info = (await cover.info.textContent()) ?? "";
	const match = /^1600×1067 · 保存サイズ (\d+\.\d)KB · 画質 (0\.\d\d)$/.exec(info);
	expect(match, info).not.toBeNull();
	expect(Number(match?.[1])).toBeLessThanOrEqual(100);
	await cover.alt.fill("E2E のカバー画像");

	// ギャラリー: 2 枚
	const gallery = galleryWidget(page);
	await gallery.fileInput.setInputFiles([fixture(galleryImage(1)), fixture(galleryImage(2))]);
	await expect(gallery.progress).toHaveText("2 枚の画像を追加しました。");
	await expect(gallery.rows).toHaveCount(2);

	// 新規作成の画面では、エントリ ID とロケールを送らない(仕様書 7 章)
	expect(uploads.targets()).toEqual([
		{ collection: "posts", field: "cover" },
		{ collection: "posts", field: "gallery" },
		{ collection: "posts", field: "gallery" },
	]);

	// 保存(新規作成は 201)。URL にエントリ ID と ?locale= が付く
	const saved = await clickSave(page);
	expect(saved.status()).toBe(201);
	await page.waitForURL(/\/_emdash\/admin\/content\/posts\/[0-9A-Z]{26}\?locale=en$/);
	const postId = entryIdFromUrl(page);

	// 公開
	expect((await publishFromEditor(page, postId)).status()).toBe(200);

	const post = await api.getEntry("posts", postId);
	const coverRef = post.data["cover"] as { id: string; width: number; height: number; alt: string };
	const galleryRefs = post.data["gallery"] as {
		id: string;
		width: number;
		height: number;
		alt: string;
	}[];
	expect(coverRef).toMatchObject({
		width: 1600,
		height: 1067,
		alt: "E2E のカバー画像",
		locale: "en",
	});
	expect(galleryRefs.map((ref) => [ref.width, ref.height])).toEqual([
		[800, 600],
		[800, 600],
	]);

	// サイトの詳細: img の width / height が参照の寸法で、data URL が 100,000 バイト以下
	const slug = `e2e-flow-${token}`;
	await page.goto(`/posts/${slug}/`);
	const article = page.getByTestId("post");
	await expect(article).toHaveAttribute("data-post-id", postId);
	const coverImage = await readRenderedImage(article.locator('img[data-field="cover"]'));
	expectSiteImage(coverImage, coverRef);
	// LCP の対象(カバー)には priority が付く(仕様書 12 章)
	expect({ loading: coverImage.loading, fetchPriority: coverImage.fetchPriority }).toEqual({
		loading: "eager",
		fetchPriority: "high",
	});
	const galleryImages = article.locator('img[data-field="gallery"]');
	await expect(galleryImages).toHaveCount(2);
	for (const [index, ref] of galleryRefs.entries()) {
		// oxlint-disable-next-line no-await-in-loop -- 1 枚ずつ画面に入れて読み込ませる
		const rendered = await readRenderedImage(galleryImages.nth(index));
		expectSiteImage(rendered, ref);
		expect(rendered.loading).toBe("lazy");
	}

	// コンテンツ一覧: 行にカバーのサムネイル(代替テキスト付き)
	await page.goto("/_emdash/admin/content/posts");
	await filterContentList(page, "Posts", token, 1);
	await expect(
		contentRow(page, title).getByRole("img", { name: "E2E のカバー画像" }),
	).toBeVisible();

	// 画像管理ページ: カバーの画像は「使用中」で、参照元へのリンクがある
	await openImagesPage(page);
	const imageRow = await findImageRow(page, coverRef.id);
	await expect(imageRow.getByText("公開済み", { exact: true })).toBeVisible();
	await expect(imageRow.getByText("使用中", { exact: true }).first()).toBeVisible();
	const ownerLink = imageRow.getByRole("link", { name: `posts / ${postId}` });
	await expect(ownerLink).toHaveAttribute(
		"href",
		`/_emdash/admin/content/posts/${postId}?locale=en`,
	);
	await expect(imageRow.getByText("フィールド cover · en · 使用中")).toBeVisible();
	await ownerLink.click();
	await expect(page.getByRole("heading", { name: "Postsを編集" })).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`/content/posts/${postId}\\?locale=en$`));
	await expect(coverWidget(page).alt).toHaveValue("E2E のカバー画像");
});
