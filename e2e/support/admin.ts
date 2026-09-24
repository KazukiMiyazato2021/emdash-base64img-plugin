/**
 * 管理画面(EmDash 0.39.1)の操作の補助。画面の文言は日本語(global setup が cookie `emdash-locale=ja` を入れる)。
 *
 * 編集画面の widget の見つけ方(docs/emdash-admin-entry-assembly.md の 6 章):
 * - 単一画像(`cover`): `#field-cover` が widget の根の fieldset。ファイルの入力欄は、画像が無いときはドロップゾーンの、
 *   画像があるときは「差し替え」のもので、どちらのときも fieldset の中に 1 つだけある。
 * - ギャラリー(`gallery`): `#field-gallery` はドロップゾーンのボタン。widget の根は、その 4 つ上の div
 *   (ボタン → 枠 → ドロップゾーン → 余白の div → 根。`src/admin/GalleryField.tsx`)。
 */

import type { Locator, Page, Request, Response } from "@playwright/test";

import type { UploadTarget } from "./api";
import { PLUGIN_API } from "./env";
import { expect } from "./test";

/** 編集画面の widget が描かれるまで待つ(Cover と Gallery の widget) */
export async function waitForEditor(page: Page): Promise<void> {
	await expect(page.locator("fieldset#field-cover")).toBeVisible();
	await expect(page.locator("button#field-gallery")).toBeVisible();
}

/** 投稿の新規作成の画面を開く */
export async function openNewPost(page: Page): Promise<void> {
	await page.goto("/_emdash/admin/content/posts/new");
	await waitForEditor(page);
}

/** 投稿の編集画面を開く。既定は一覧から開いたときと同じ `?locale=en` 付き。`locale: null` で付けない */
export async function openPost(
	page: Page,
	id: string,
	options: { locale?: string | null } = {},
): Promise<void> {
	const locale = options.locale === undefined ? "en" : options.locale;
	const query = locale === null ? "" : `?locale=${encodeURIComponent(locale)}`;
	await page.goto(`/_emdash/admin/content/posts/${id}${query}`);
	await waitForEditor(page);
}

/** 単一画像の widget(`cover`) */
export function coverWidget(page: Page) {
	const root = page.locator("fieldset#field-cover");
	return {
		root,
		/** ドロップゾーンのボタン(画像が無いとき) */
		zone: root.getByRole("button", { name: /^Cover: / }),
		/** ドロップゾーンの枠(`drop` を送る先) */
		zoneFrame: root.getByRole("button", { name: /^Cover: / }).locator("xpath=.."),
		fileInput: root.locator('input[type="file"]'),
		preview: root.locator("img"),
		alt: root.getByRole("textbox", { name: "代替テキスト" }),
		replace: root.getByRole("button", { name: "差し替え", exact: true }),
		remove: root.getByRole("button", { name: "削除", exact: true }),
		cancel: root.getByRole("button", { name: "キャンセル", exact: true }),
		/** 進捗の読み上げの領域(`<output>`) */
		status: root.locator("output"),
		/** エラーの領域の中身(Kumo の Banner) */
		error: root.locator('[role="alert"]').filter({ hasText: /\S/ }),
		saveHint: root.getByText("処理が終わってから保存してください。"),
		info: root.locator("p.tabular-nums"),
	};
}

/** ギャラリーの widget(`gallery`) */
export function galleryWidget(page: Page) {
	const zone = page.locator("button#field-gallery");
	const root = zone.locator("xpath=ancestor::div[4]");
	return {
		root,
		zone,
		zoneFrame: zone.locator("xpath=.."),
		fileInput: root.locator('input[type="file"][multiple]'),
		rows: root.locator("li[data-gallery-key]"),
		/** n 番目(1 から)の行 */
		row: (n: number) => root.locator("li[data-gallery-key]").nth(n - 1),
		/** 並べ替え・削除などの読み上げ(根の直下の `<output>`) */
		announcement: root.locator(":scope > output"),
		/** 追加の進捗の読み上げ(`UploadProgress` の `<output>`) */
		progress: root.locator(":scope > div > div > output"),
		cancel: root.getByRole("button", { name: "キャンセル", exact: true }),
		saveHint: root.getByText("処理が終わってから保存してください。"),
		errors: root.locator('[role="alert"]').filter({ hasText: /\S/ }),
		count: root.getByText(/^\d+ \/ \d+ 枚$/),
	};
}

/** 「保存」のボタン(保存したあとは「保存済み」になり、押せない) */
export function saveButton(page: Page): Locator {
	return page.getByRole("button", { name: "保存", exact: true });
}

/** 投稿の手動の保存の要求か(自動保存は `skipRevision` を送る。docs/gallery-widget-reorder-focus.md の 4 章) */
export function isManualSave(request: Request): boolean {
	const url = new URL(request.url());
	if (!/^\/_emdash\/api\/content\/posts(\/[^/]+)?$/.test(url.pathname)) return false;
	if (request.method() === "POST") return url.pathname === "/_emdash/api/content/posts";
	if (request.method() !== "PUT") return false;
	const body = request.postDataJSON() as { skipRevision?: unknown } | null;
	return body?.skipRevision === undefined;
}

/** 「保存」を押し、手動の保存の応答を待つ */
export async function clickSave(page: Page): Promise<Response> {
	const [response] = await Promise.all([
		page.waitForResponse((candidate) => isManualSave(candidate.request())),
		saveButton(page).click(),
	]);
	return response;
}

/** 編集画面の「Publish now」で公開する(確認のダイアログ「Publish now?」でもう一度押す)。公開の応答を返す */
export async function publishFromEditor(page: Page, entryId: string): Promise<Response> {
	const published = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname === `/_emdash/api/content/posts/${entryId}/publish`,
	);
	await page.getByRole("button", { name: "Publish now", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Publish now?" })
		.getByRole("button", { name: "Publish now", exact: true })
		.click();
	return published;
}

/** アップロードの要求(このプラグインのルート) */
export function isUploadRequest(request: Request): boolean {
	return request.method() === "POST" && new URL(request.url()).pathname === `${PLUGIN_API}/upload`;
}

/**
 * アップロードの要求を止めておく(処理中の表示を確かめるため。docs/emdash-plugin-field-widget.md の 8 章)。
 * `passFirst` 件目までは止めずに送る。`release()` のあとは、止めていた要求も、あとの要求もそのまま送る。
 * 画面が中断した要求は捨てる。
 */
export async function holdUploads(page: Page, options: { passFirst?: number } = {}) {
	const passFirst = options.passFirst ?? 0;
	const { promise: gate, resolve: release } = Promise.withResolvers<void>();
	let seen = 0;
	let held = 0;
	await page.route(`**${PLUGIN_API}/upload`, async (route) => {
		seen += 1;
		if (seen > passFirst) {
			held += 1;
			await gate;
		}
		// 画面が中断した(キャンセルした)要求は、続けられない
		await route.continue().catch(() => undefined);
	});
	return {
		/** 止めている(止めた)要求の数 */
		held: () => held,
		release: () => release(),
	};
}

/**
 * 投稿の手動の保存の要求(`isManualSave`)を止めておく。`bodies()` は止めた要求の body。
 * `release()` のあとは、止めていた要求も、あとの要求もそのまま送る。ほかの要求は止めない。
 */
export async function holdManualSaves(page: Page) {
	const { promise: gate, resolve: release } = Promise.withResolvers<void>();
	const bodies: unknown[] = [];
	await page.route(
		(url) => url.pathname.startsWith("/_emdash/api/content/posts"),
		async (route) => {
			if (!isManualSave(route.request())) {
				await route.fallback();
				return;
			}
			bodies.push(route.request().postDataJSON());
			await gate;
			await route.continue();
		},
	);
	return {
		bodies: () => bodies,
		release: () => release(),
	};
}

/** アップロードの要求を記録する。`targets()` で送った `target` の一覧 */
export function recordUploads(page: Page) {
	const requests: Request[] = [];
	page.on("request", (request) => {
		if (isUploadRequest(request)) requests.push(request);
	});
	return {
		count: () => requests.length,
		targets: () =>
			requests.map((request) => (request.postDataJSON() as { target: UploadTarget }).target),
	};
}

/** 画面の URL からエントリ ID を読む(`/_emdash/admin/content/<collection>/<ID>`) */
export function entryIdFromUrl(page: Page): string {
	const match = /\/_emdash\/admin\/content\/[^/]+\/([0-9A-Z]{26})(?:\?|$)/.exec(page.url());
	if (match?.[1] === undefined) throw new Error(`URL にエントリ ID がありません: ${page.url()}`);
	return match[1];
}

/** 画面の右下の通知(Kumo の Toast)の領域 */
export function notifications(page: Page): Locator {
	return page.getByRole("region", { name: "Notifications" });
}

/** コンテンツ一覧の表の行(見出しの行を除く) */
export function contentRows(page: Page): Locator {
	return page.locator("main table tbody tr");
}

/** コンテンツ一覧の、タイトルが `title` の行(行の名前は「<タイトル>を選択 …」で始まる) */
export function contentRow(page: Page, title: string): Locator {
	const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return page.getByRole("row", { name: new RegExp(`^${escaped}を選択`) });
}

/**
 * コンテンツ一覧を、検索欄(「<コレクションのラベルの小文字>を検索」)で絞り込む。一覧は更新日時の新しい順の
 * 20 件ずつなので、並列に動くほかのテストが投稿を作ると、目当ての行が 1 ページ目から外れうる。テストの目印(`token`)で
 * 絞り込み、`rows` 行になるまで待つ。
 */
export async function filterContentList(
	page: Page,
	collectionLabel: string,
	term: string,
	rows: number,
): Promise<void> {
	await page.getByRole("searchbox", { name: `${collectionLabel.toLowerCase()}を検索` }).fill(term);
	await expect(contentRows(page)).toHaveCount(rows);
}

/**
 * コマンドパレットを開く。EmDash は react-hotkeys-hook の `mod+k` で開き、`mod` は UA に「Mac」があれば ⌘、
 * 無ければ Ctrl になる。Playwright の `ControlOrMeta` は実行している OS で決まり、Desktop Chrome / Desktop Firefox の
 * UA は Windows なので、UA から押すキーを決める。読み込みの直後に押して開かなければ、押し直す(開いているときに
 * 押しても閉じない)。
 */
export async function openCommandPalette(page: Page) {
	const dialog = page.getByRole("dialog").filter({ has: page.getByRole("combobox") });
	const search = dialog.getByRole("combobox", { name: "ページやコンテンツを検索…" });
	const isMac = await page.evaluate(
		() => /mac/i.test(navigator.userAgent) && !/iphone|ipad|ipod/i.test(navigator.userAgent),
	);
	await expect(async () => {
		await page.keyboard.press(isMac ? "Meta+K" : "Control+K");
		await expect(search).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
	return { dialog, search };
}
