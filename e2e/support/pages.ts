/**
 * サイトのページ(playground の `/posts/`・`/posts/<slug>/`)と、画像管理ページの補助。
 */

import type { Locator, Page } from "@playwright/test";

import { expect } from "./test";

/** `<img>` の属性と、ブラウザでのデコードの結果 */
export interface RenderedImage {
	src: string;
	width: number;
	height: number;
	naturalWidth: number;
	naturalHeight: number;
	complete: boolean;
	loading: string | null;
	fetchPriority: string | null;
	alt: string | null;
}

/**
 * `<img>` を読み込ませてから、属性とデコードの結果を読む(`loading="lazy"` の画像は、画面に入るまで読み込まれない)。
 */
export async function readRenderedImage(image: Locator): Promise<RenderedImage> {
	await image.scrollIntoViewIfNeeded();
	await expect
		.poll(() =>
			image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
		)
		.toBe(true);
	return image.evaluate((element: HTMLImageElement) => ({
		src: element.getAttribute("src") ?? "",
		width: Number(element.getAttribute("width")),
		height: Number(element.getAttribute("height")),
		naturalWidth: element.naturalWidth,
		naturalHeight: element.naturalHeight,
		complete: element.complete,
		loading: element.getAttribute("loading"),
		fetchPriority: element.getAttribute("fetchpriority"),
		alt: element.getAttribute("alt"),
	}));
}

/** サイトの `<img>` が、参照の寸法どおりの WebP の data URL で、保存サイズの上限以下であることを確かめる */
export function expectSiteImage(
	image: RenderedImage,
	ref: { width: number; height: number; alt: string },
	maxStoredBytes = 100_000,
): void {
	expect(image.src.startsWith("data:image/webp;base64,")).toBe(true);
	expect(image.src.length).toBeLessThanOrEqual(maxStoredBytes);
	expect({ width: image.width, height: image.height }).toEqual({
		width: ref.width,
		height: ref.height,
	});
	expect({ width: image.naturalWidth, height: image.naturalHeight }).toEqual({
		width: ref.width,
		height: ref.height,
	});
	expect(image.alt ?? "").toBe(ref.alt);
}

/** 画像管理ページ */
export function imagesPage(page: Page) {
	return {
		heading: page.getByRole("heading", { level: 1, name: "画像の管理" }),
		table: page.getByRole("table"),
		/** 画像の行(行の見出しのセルに「ID <画像 ID>」がある) */
		row: (imageId: string) => page.getByRole("row").filter({ hasText: `ID ${imageId}` }),
		/** 行の見出しのセル(操作のあとのフォーカスの移る先) */
		rowHeader: (imageId: string) =>
			page.getByRole("rowheader").filter({ hasText: `ID ${imageId}` }),
		loadMore: page.getByRole("button", { name: "さらに読み込む", exact: true }),
		/** 読み込み中のボタン(「さらに読み込む」「最初から読み込み直す」を押したあと) */
		loading: page.getByRole("button", { name: "読み込んでいます…", exact: true }),
		reload: page.getByRole("button", { name: "最初から読み込み直す", exact: true }),
		/** 読み上げの領域(`<output>`) */
		announcement: page.locator("main output"),
		dialog: page.getByRole("alertdialog"),
	};
}

/** 画像管理ページを開き、一覧の最初の読み込み(表が出るまで)を待つ */
export async function openImagesPage(page: Page): Promise<void> {
	await page.goto("/_emdash/admin/plugins/base64-image/images");
	const images = imagesPage(page);
	await expect(images.heading).toBeVisible();
	await expect(images.table).toBeVisible();
	await expect(images.loading).toHaveCount(0);
}

/**
 * 画像管理ページで、画像の行が出るまで「さらに読み込む」を押す(一覧は新しい順で、ほかのテストの画像も並ぶ)。
 */
export async function findImageRow(page: Page, imageId: string, maxClicks = 30): Promise<Locator> {
	const images = imagesPage(page);
	const row = images.row(imageId);
	for (let click = 0; click <= maxClicks; click++) {
		// oxlint-disable-next-line no-await-in-loop -- 前の読み込みが終わってから、次を押す
		if ((await row.count()) > 0) return row;
		// oxlint-disable-next-line no-await-in-loop -- 同上
		if ((await images.loadMore.count()) === 0) break;
		// oxlint-disable-next-line no-await-in-loop -- 同上
		await images.loadMore.click();
		// 読み込みの間、ボタンの文字は「読み込んでいます…」になる
		// oxlint-disable-next-line no-await-in-loop -- 同上
		await expect(images.loading).toHaveCount(0);
	}
	await expect(row, `画像 ${imageId} の行が見つかりません`).toHaveCount(1);
	return row;
}
