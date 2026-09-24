// 画像管理ページ(src/admin/ImagesPage.tsx。T25・T25-2)のテスト。
// fetch を偽のサーバーに差し替え、本物の API クライアント(src/client/api.ts)を通して、送る要求と画面を確かめる。
// `@emdash-cms/admin` は読み込むと重い(jsdom で数秒)ので、`useCurrentUser` だけのモックにする(本物は最後のテストで使う)。
// 一覧のサムネイル列(src/admin/ThumbnailColumn.tsx。T24)は差し替えない。このページと同じモジュールの覚え書きを調べる。

import type { PluginAdminModule } from "@emdash-cms/admin";
import { useCurrentUser } from "@emdash-cms/admin";
import { isSafePluginPagePath, normalizePluginPagePath } from "@emdash-cms/blocks/server";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PluginAdminConfig } from "emdash";
import { createHash } from "node:crypto";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import {
	contentEditorHref,
	entryDisplayOf,
	ImagesPage,
	MAX_REQUESTS_PER_LOAD,
	readImageList,
	readImagePages,
	ROLE_ADMIN,
	ROLE_CONTRIBUTOR,
	ROLE_EDITOR,
} from "../../src/admin/ImagesPage";
import {
	clearThumbnailColumnCache,
	preloadThumbnailColumn,
	requestThumbnails,
	showsThumbnailColumn,
} from "../../src/admin/ThumbnailColumn";
import { ERROR_MESSAGES } from "../../src/client/error-messages";
import { IMAGES_PAGE } from "../../src/shared/constants";
import { isBase64ImageError } from "../../src/shared/errors";
import type { ImageListItem, ImageListOwner } from "../../src/shared/types";
import { findMissingClasses, sourceTokens } from "./admin-css";

vi.mock("@emdash-cms/admin", () => ({ useCurrentUser: vi.fn<() => unknown>() }));

// ---------------------------------------------------------------------------
// 偽のサーバー
// ---------------------------------------------------------------------------

const PLUGIN_API = "/_emdash/api/plugins/base64-image";
const LIST_URL = `${PLUGIN_API}/images/list`;
const TRASH_URL = `${PLUGIN_API}/images/trash`;
const contentUrl = (id: string, action: "permanent" | "publish") =>
	`/_emdash/api/content/b64_images/${id}/${action}`;
// スキーマは形だけを確かめるので、data URL の中身は本物の WebP でなくてよい
const THUMB = "data:image/webp;base64,UklGRhYAAABXRUJQ";
// 一覧のサムネイル列(T24)が使う要求
const MANIFEST_URL = "/_emdash/api/manifest";
const THUMBNAILS_URL = `${PLUGIN_API}/thumbnails`;
/** 管理画面のマニフェスト(posts にはこのプラグインのフィールドがあり、pages には無い) */
const COLUMN_MANIFEST = {
	collections: {
		posts: {
			fields: {
				title: { kind: "string" },
				cover: { kind: "json", widget: "base64-image:image" },
			},
		},
		pages: { fields: { title: { kind: "string" } } },
	},
};

interface SentRequest {
	readonly url: string;
	readonly method: string;
	readonly body: unknown;
	readonly headers: Headers;
	readonly signal: AbortSignal | undefined;
}

type Handler = (request: SentRequest) => Response | Promise<Response>;

const routes = new Map<string, Handler>();
const sent: SentRequest[] = [];
const fetchMock = vi.fn<typeof fetch>();

function route(method: string, url: string, handler: Handler): void {
	routes.set(`${method} ${url}`, handler);
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function success(data: unknown): Response {
	return json({ success: true, data });
}

function apiError(code: string, status: number, message = "failed"): Response {
	return json({ success: false, error: { code, message } }, status);
}

/** 中断されるまで応答しない(中断されたら fetch と同じく reject する) */
function hang(request: SentRequest): Promise<Response> {
	return new Promise((_resolve, reject) => {
		request.signal?.addEventListener("abort", () => reject(new TypeError("aborted")), {
			once: true,
		});
	});
}

/** テストから応答の時を決める */
function deferred<T>(): PromiseWithResolvers<T> {
	return Promise.withResolvers<T>();
}

interface PageData {
	readonly items: readonly ImageListItem[];
	readonly nextCursor?: string;
}

/** 一覧のルート。キーはカーソル(最初のページは "")。無いカーソルは 400 `INVALID_CURSOR` */
function listPages(pages: Record<string, PageData | Handler>): void {
	route("POST", LIST_URL, (request) => {
		const cursor = (request.body as { cursor?: string }).cursor ?? "";
		const page = pages[cursor];
		if (page === undefined) return apiError("INVALID_CURSOR", 400, "Invalid cursor");
		return typeof page === "function" ? page(request) : success(page);
	});
}

function listRequests(): unknown[] {
	return sent.filter((request) => request.url === LIST_URL).map((request) => request.body);
}

function requestsTo(url: string): SentRequest[] {
	return sent.filter((request) => request.url === url);
}

// ---------------------------------------------------------------------------
// 一覧の項目
// ---------------------------------------------------------------------------

const POST_ID = "01J8Z3K4M5N6P7Q8R9S0POST01";

function owner(overrides: Partial<ImageListOwner> = {}): ImageListOwner {
	return {
		collection: "posts",
		entryId: POST_ID,
		locale: "ja",
		field: "cover",
		status: "in_use",
		...overrides,
	};
}

let createdSeq = 0;

/**
 * 作成日時。項目を作るごとに 1 分ずつ進める(テストごとに 2026-09-24 12:00 UTC から)。
 * ボタンの名前は寸法と作成日時(分まで)なので、同じにならないようにする(同じときの扱いは別のテストで確かめる)。
 */
function nextCreatedAt(): string {
	const at = new Date(Date.UTC(2026, 8, 24, 12, createdSeq));
	createdSeq += 1;
	return at.toISOString();
}

function item(overrides: Partial<ImageListItem> = {}): ImageListItem {
	return {
		id: "img-1",
		thumb: THUMB,
		width: 1280,
		height: 853,
		bytes: 74_668,
		createdAt: nextCreatedAt(),
		entryStatus: "active",
		entryPublication: "published",
		usage: "in_use",
		owners: [owner()],
		ownersTotal: 1,
		...overrides,
	};
}

function formatDate(iso: string, locale: "ja" | "en" = "ja"): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
		new Date(iso),
	);
}

/** ボタンの名前などに使う画像の名前(日本語) */
function nameOf(image: ImageListItem): string {
	return `${image.width}×${image.height}、${formatDate(image.createdAt)} 作成の画像`;
}

// ---------------------------------------------------------------------------
// 描画と操作の道具
// ---------------------------------------------------------------------------

function setRole(role: number | undefined): void {
	vi.mocked(useCurrentUser).mockReturnValue({
		data: role === undefined ? undefined : { id: "user-1", email: "user@example.com", role },
	} as unknown as ReturnType<typeof useCurrentUser>);
}

/** ページを描き、最初の読み込みが終わるまで待つ */
async function renderPage(): Promise<ReturnType<typeof render>> {
	const view = render(<ImagesPage />);
	await waitFor(() => expect(screen.queryByText("画像の一覧を読み込み中…")).toBeNull());
	return view;
}

/** 画像の一覧の表(確認のダイアログにも `ID <画像 ID>` を出すので、行は表の中から探す) */
function table(): HTMLElement {
	const element = document.querySelector("table");
	if (element === null) throw new Error("table not found");
	return element;
}

/** 画像の行(`ID <画像 ID>` を含む行) */
function row(id: string): HTMLElement {
	const cell = within(table()).getByText(`ID ${id}`).closest("tr");
	if (!(cell instanceof HTMLElement)) throw new Error(`row not found: ${id}`);
	return cell;
}

function hasRow(id: string): boolean {
	const element = document.querySelector("table");
	return element !== null && within(element).queryByText(`ID ${id}`) !== null;
}

function rowHeader(id: string): HTMLElement {
	return within(row(id)).getByRole("rowheader");
}

function rowButtons(id: string): string[] {
	return within(row(id))
		.queryAllByRole("button")
		.map((button) => button.textContent ?? "");
}

function announcement(): string {
	const region = document.querySelector("output[aria-live]");
	if (region === null) throw new Error("live region not found");
	return region.textContent ?? "";
}

async function changeLang(lang: string): Promise<void> {
	await act(async () => {
		document.documentElement.lang = lang;
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

// ---------------------------------------------------------------------------
// 共通の準備
// ---------------------------------------------------------------------------

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
	document.documentElement.lang = "ja";
	routes.clear();
	sent.length = 0;
	createdSeq = 0;
	// 一覧の列の要求(完全削除のあとで、このページがマニフェストを読み直す)
	route("GET", MANIFEST_URL, () => success(COLUMN_MANIFEST));
	route("POST", THUMBNAILS_URL, (request) =>
		success({
			items: (request.body as { ids: string[] }).ids.map((id) => ({
				id,
				thumbnail: { thumb: THUMB, width: 96, height: 64 },
			})),
		}),
	);
	// 一覧の列の覚え書きはモジュールの中にあるので、テストごとに消す
	clearThumbnailColumnCache();
	fetchMock.mockReset();
	fetchMock.mockImplementation(async (input, init = {}) => {
		const url = String(input);
		const method = init.method ?? "GET";
		const request: SentRequest = {
			url,
			method,
			body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
			headers: new Headers(init.headers),
			signal: init.signal ?? undefined,
		};
		sent.push(request);
		const handler = routes.get(`${method} ${url}`);
		if (handler === undefined) return apiError("NOT_FOUND", 404, `no route: ${method} ${url}`);
		return handler(request);
	});
	vi.stubGlobal("fetch", fetchMock);
	setRole(ROLE_ADMIN);
	// act の外での状態の変化(React の警告)をテストの失敗にする(docs/react-hook-testing-pitfalls.md)
	consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
	// 先に描画を片付ける(アンマウントの警告も数える。ここで失敗しても、次のテストに DOM を残さない。
	// afterEach で例外を投げると、tests/setup/dom.ts の cleanup が呼ばれなかった)
	cleanup();
	vi.unstubAllGlobals();
	const warnings = consoleError.mock.calls.map((args) => args.map(String).join(" "));
	consoleError.mockRestore();
	if (warnings.length > 0) throw new Error(`console.error was called:\n${warnings.join("\n")}`);
});

// ---------------------------------------------------------------------------
// 補助
// ---------------------------------------------------------------------------

describe("補助", () => {
	it("参照元の編集画面の URL は、管理画面の編集画面の形で ?locale= を付ける", () => {
		expect(contentEditorHref(owner())).toBe(`/_emdash/admin/content/posts/${POST_ID}?locale=ja`);
		expect(contentEditorHref(owner({ collection: "news_items", locale: "en-US" }))).toBe(
			`/_emdash/admin/content/news_items/${POST_ID}?locale=en-US`,
		);
	});

	it.each([
		["active", "published", "published"],
		["active", "draft", "draft"],
		["active", "scheduled", "scheduled"],
		// ルートの約束では起きない。サイトに出ないことだけが確かなので下書きとして扱う
		["active", null, "draft"],
		["trashed", null, "trashed"],
		["missing", null, "missing"],
	] as const)("画像エントリの表示: %s / %s → %s", (entryStatus, entryPublication, expected) => {
		expect(entryDisplayOf({ entryStatus, entryPublication })).toBe(expected);
	});

	it("ロールの値は EmDash と同じ(寄稿者 20・編集者 40・管理者 50)", () => {
		expect([ROLE_CONTRIBUTOR, ROLE_EDITOR, ROLE_ADMIN]).toEqual([20, 40, 50]);
	});
});

// ---------------------------------------------------------------------------
// 一覧の読み方
// ---------------------------------------------------------------------------

describe("一覧の読み方", () => {
	it("最初のページを読み、画像ごとにサムネイル・寸法・保存サイズ・ID・状態・参照元・作成日時を出す", async () => {
		const image = item({
			owners: [
				owner(),
				owner({ field: "gallery", status: "detached" }),
				owner({
					collection: "pages",
					entryId: "01J8Z3K4M5N6P7Q8R9S0PAGE01",
					status: "owner_deleted",
				}),
			],
			ownersTotal: 23,
		});
		listPages({ "": { items: [image] } });

		await renderPage();

		// 一覧の要求は、プラグインのルートを CSRF のヘッダー付きの POST で、最初は body `{}` で送る
		expect(listRequests()).toEqual([{}]);
		expect(sent[0]?.method).toBe("POST");
		expect(sent[0]?.headers.get("X-EmDash-Request")).toBe("1");

		expect(screen.getByRole("heading", { level: 1, name: "画像の管理" })).toBeInTheDocument();
		const imagesTable = screen.getByRole("table", { name: "アップロードした画像(1 枚を表示中)" });
		expect(
			within(imagesTable)
				.getAllByRole("columnheader")
				.map((header) => header.textContent),
		).toEqual(["画像", "状態", "参照元", "作成日時", "操作"]);

		const cells = within(row("img-1"));
		const thumbnail = row("img-1").querySelector("img");
		expect(thumbnail).toHaveAttribute("src", THUMB);
		expect(thumbnail).toHaveAttribute("width", "1280");
		expect(thumbnail).toHaveAttribute("height", "853");
		// 保存サイズは data URL の長さ(WebP 本体 74,668 バイト → 23 + 4 × ceil(74,668 / 3) = 99,583)
		expect(cells.getByText("1280×853 · 保存サイズ 99.6KB")).toBeInTheDocument();
		expect(cells.getByText("公開済み")).toBeInTheDocument();
		expect(cells.getAllByText("使用中")).not.toHaveLength(0);

		// 参照元は記録ごとに 1 行。削除された参照元はリンクにしない。載せきれない分は「ほか N 件」
		const links = cells.getAllByRole("link");
		expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
			[`posts / ${POST_ID}`, `/_emdash/admin/content/posts/${POST_ID}?locale=ja`],
			[`posts / ${POST_ID}`, `/_emdash/admin/content/posts/${POST_ID}?locale=ja`],
		]);
		expect(cells.getByText("フィールド cover · ja · 使用中")).toBeInTheDocument();
		expect(cells.getByText("フィールド gallery · ja · 外された")).toBeInTheDocument();
		expect(cells.getByText("pages / 01J8Z3K4M5N6P7Q8R9S0PAGE01")).not.toHaveAttribute("href");
		expect(cells.getByText("フィールド cover · ja · 削除済み")).toBeInTheDocument();
		expect(cells.getByText("ほか 20 件")).toBeInTheDocument();

		const time = row("img-1").querySelector("time");
		expect(time).toHaveAttribute("dateTime", "2026-09-24T12:00:00.000Z");
		expect(time).toHaveTextContent(formatDate("2026-09-24T12:00:00.000Z"));

		expect(announcement()).toBe("1 枚の画像を読み込みました。");
	});

	it("状態ごとのバッジと説明を出す", async () => {
		listPages({
			"": {
				items: [
					item({ id: "published", usage: "in_use" }),
					item({ id: "draft", entryPublication: "draft", usage: "owner_deleted" }),
					item({ id: "scheduled", entryPublication: "scheduled", usage: "detached" }),
					item({ id: "trashed", entryStatus: "trashed", entryPublication: null }),
					item({
						id: "missing",
						entryStatus: "missing",
						entryPublication: null,
						usage: "no_owner",
						owners: [],
						ownersTotal: 0,
					}),
				],
			},
		});

		await renderPage();

		const statusOf = (id: string) => within(row(id)).getAllByRole("cell")[0]?.textContent;
		expect(statusOf("published")).toBe("公開済み使用中");
		expect(statusOf("draft")).toBe("下書き参照元が削除されたサイトに表示されません。");
		expect(statusOf("scheduled")).toBe(
			"予約済み参照元から外された予約の日時まで、サイトに表示されません。",
		);
		expect(statusOf("trashed")).toBe(
			"ゴミ箱使用中サイトに表示されません。ゴミ箱から戻せるのは編集者以上です。",
		);
		expect(statusOf("missing")).toBe(
			"エントリなし参照元なし画像のエントリが無く、記録だけが残っています。このページからは操作できません。",
		);
		// 参照元の無い画像は「なし」
		expect(within(row("missing")).getAllByRole("cell")[1]).toHaveTextContent("なし");
	});

	it("一覧が空なら「画像はまだありません。」", async () => {
		listPages({ "": { items: [] } });

		await renderPage();

		expect(screen.getByText("画像はまだありません。")).toBeInTheDocument();
		expect(screen.queryByRole("table")).toBeNull();
		expect(screen.queryByRole("button", { name: "さらに読み込む" })).toBeNull();
		expect(announcement()).toBe("画像はありません。");
	});

	it("読み込み中は、訳した文字を出す(Kumo の Loader の英語は読み上げから隠す)", async () => {
		listPages({ "": hang });
		render(<ImagesPage />);

		const loading = await screen.findByText("画像の一覧を読み込み中…");
		expect(loading.querySelector('[aria-hidden="true"] [role="status"]')).not.toBeNull();
		expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
	});

	it("「さらに読み込む」で次のページを足し、最初に足した画像の行にフォーカスを移す。最後のページでボタンは消える", async () => {
		const user = userEvent.setup();
		listPages({
			"": { items: [item({ id: "img-1" })], nextCursor: "c2" },
			c2: {
				items: [
					item({ id: "img-2", createdAt: "2026-09-23T12:00:00.000Z" }),
					item({ id: "img-3" }),
				],
			},
		});
		await renderPage();

		await user.click(screen.getByRole("button", { name: "さらに読み込む" }));

		await waitFor(() => expect(rowHeader("img-2")).toHaveFocus());
		expect(listRequests()).toEqual([{}, { cursor: "c2" }]);
		expect(
			screen
				.getAllByRole("row")
				.slice(1)
				.map((tr) => within(tr).getByRole("rowheader").textContent),
		).toEqual([
			expect.stringContaining("ID img-1"),
			expect.stringContaining("ID img-2"),
			expect.stringContaining("ID img-3"),
		]);
		expect(screen.queryByRole("button", { name: "さらに読み込む" })).toBeNull();
		expect(announcement()).toBe("さらに 2 枚の画像を読み込みました。");
	});

	it("続きのページに、表示中の画像がまた含まれていても、重ねて出さない", async () => {
		const user = userEvent.setup();
		listPages({
			"": { items: [item({ id: "img-1" }), item({ id: "img-2" })], nextCursor: "c2" },
			c2: { items: [item({ id: "img-2" }), item({ id: "img-3" })] },
		});
		await renderPage();

		await user.click(screen.getByRole("button", { name: "さらに読み込む" }));

		// フォーカスは、新しく足した最初の画像へ
		await waitFor(() => expect(rowHeader("img-3")).toHaveFocus());
		expect(
			within(table())
				.getAllByText(/^ID img-/)
				.map((node) => node.textContent),
		).toEqual(["ID img-1", "ID img-2", "ID img-3"]);
		expect(announcement()).toBe("さらに 1 枚の画像を読み込みました。");
	});

	it("items: [] で nextCursor がある応答は、一覧の終わりにせず続けて読む", async () => {
		const user = userEvent.setup();
		listPages({
			"": { items: [], nextCursor: "h1" },
			h1: { items: [], nextCursor: "h2" },
			h2: { items: [item({ id: "img-1" })], nextCursor: "c2" },
			c2: { items: [], nextCursor: "h3" },
			h3: { items: [item({ id: "img-2" })] },
		});

		await renderPage();

		expect(listRequests()).toEqual([{}, { cursor: "h1" }, { cursor: "h2" }]);
		expect(screen.getByText("ID img-1")).toBeInTheDocument();
		expect(screen.queryByText("画像はまだありません。")).toBeNull();

		// 「さらに読み込む」でも、空のページを続けて読む
		await user.click(screen.getByRole("button", { name: "さらに読み込む" }));
		await screen.findByText("ID img-2");
		expect(listRequests()).toEqual([
			{},
			{ cursor: "h1" },
			{ cursor: "h2" },
			{ cursor: "c2" },
			{ cursor: "h3" },
		]);
	});

	it(`空のページが続いても、1 回の読み込みで送る要求は ${MAX_REQUESTS_PER_LOAD} 回まで。残りは「さらに読み込む」で続ける`, async () => {
		const user = userEvent.setup();
		let count = 0;
		listPages({
			"": { items: [], nextCursor: "p1" },
			...Object.fromEntries(
				Array.from({ length: 60 }, (_, index) => [
					`p${index + 1}`,
					() => {
						count += 1;
						return success({ items: [], nextCursor: `p${index + 2}` });
					},
				]),
			),
		});

		await renderPage();

		expect(listRequests()).toHaveLength(MAX_REQUESTS_PER_LOAD);
		expect(
			screen.getByText(
				"表示中の画像はありません。一覧には続きがあります。続きを読み込んでください。",
			),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "さらに読み込む" }));
		await waitFor(() => expect(listRequests()).toHaveLength(MAX_REQUESTS_PER_LOAD * 2));
		// 2 回目は、1 回目の最後のカーソルから続ける
		expect(listRequests()[MAX_REQUESTS_PER_LOAD]).toEqual({ cursor: `p${MAX_REQUESTS_PER_LOAD}` });
		expect(count).toBe(MAX_REQUESTS_PER_LOAD * 2 - 1);
	});

	it("「さらに読み込む」が 400 INVALID_CURSOR なら、最初から読み直して一覧を置き換え、そのことを知らせる", async () => {
		const user = userEvent.setup();
		let firstPage = [item({ id: "old-1" })];
		listPages({
			"": () => success({ items: firstPage, nextCursor: "stale" }),
		});
		await renderPage();
		firstPage = [item({ id: "new-1" }), item({ id: "new-2" })];

		await user.click(screen.getByRole("button", { name: "さらに読み込む" }));

		await screen.findByText("ID new-1");
		expect(listRequests()).toEqual([{}, { cursor: "stale" }, {}]);
		expect(screen.queryByText("ID old-1")).toBeNull();
		expect(
			screen.getByText("一覧の読み込み位置が古くなったため、最初から読み込み直しました。"),
		).toBeInTheDocument();
		expect(announcement()).toBe(
			"一覧の読み込み位置が古くなったため、最初から読み込み直しました。 2 枚の画像を読み込みました。",
		);
		// 最初から読み直したときは、フォーカスを動かさない(「さらに読み込む」に残る)
		expect(screen.getByRole("button", { name: "さらに読み込む" })).toHaveFocus();

		// 「最初から読み込み直す」を押したら、この知らせは消す
		await user.click(screen.getByRole("button", { name: "最初から読み込み直す" }));
		await waitFor(() => expect(listRequests()).toHaveLength(4));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "最初から読み込み直す" })).toHaveAttribute(
				"aria-disabled",
				"false",
			),
		);
		expect(
			screen.queryByText("一覧の読み込み位置が古くなったため、最初から読み込み直しました。"),
		).toBeNull();
	});

	it("最初から読み直しても INVALID_CURSOR なら、繰り返さずにエラーを出す", async () => {
		const user = userEvent.setup();
		let calls = 0;
		listPages({
			"": () => {
				calls += 1;
				return calls === 1
					? success({ items: [item()], nextCursor: "stale" })
					: apiError("INVALID_CURSOR", 400);
			},
		});
		await renderPage();

		await user.click(screen.getByRole("button", { name: "さらに読み込む" }));

		const alert = await screen.findByText(ERROR_MESSAGES.ja.INVALID_CURSOR);
		expect(alert.closest('[role="alert"]')).not.toBeNull();
		expect(listRequests()).toEqual([{}, { cursor: "stale" }, {}]);
		// 読み込めた一覧はそのまま残す
		expect(screen.getByText("ID img-1")).toBeInTheDocument();
	});

	it.each([
		[
			"403(閲覧者など)は、必要なロールを伝える",
			() => apiError("FORBIDDEN", 403, "Insufficient permissions"),
			"画像の一覧を見る権限がありません。画像の管理は、寄稿者以上のロールで行えます。",
		],
		["401", () => apiError("UNAUTHORIZED", 401), ERROR_MESSAGES.ja.UNAUTHORIZED],
		["500", () => apiError("INTERNAL_ERROR", 500), ERROR_MESSAGES.ja.INTERNAL_ERROR],
	])("最初の読み込みの失敗: %s", async (_label, reply, text) => {
		listPages({ "": reply });

		await renderPage();

		const alert = screen.getAllByRole("alert").find((region) => region.textContent !== "");
		expect(alert).toHaveTextContent("画像の一覧を読み込めませんでした");
		expect(alert).toHaveTextContent(text);
		expect(screen.queryByText("画像はまだありません。")).toBeNull();
	});

	it("「さらに読み込む」の失敗は、ボタンの近くに出し、フォーカスはボタンに残す。もう一度押すと同じカーソルで読む", async () => {
		const user = userEvent.setup();
		let failures = 1;
		listPages({
			"": { items: [item({ id: "img-1" })], nextCursor: "c2" },
			c2: () => {
				if (failures > 0) {
					failures -= 1;
					return apiError("INTERNAL_ERROR", 500);
				}
				return success({ items: [item({ id: "img-2" })] });
			},
		});
		await renderPage();
		const button = screen.getByRole("button", { name: "さらに読み込む" });

		await user.click(button);

		const text = await screen.findByText(ERROR_MESSAGES.ja.INTERNAL_ERROR);
		const region = text.closest('[role="alert"]');
		expect(region?.parentElement).toContainElement(button);
		expect(button).toHaveFocus();

		await user.click(button);
		await screen.findByText("ID img-2");
		expect(listRequests()).toEqual([{}, { cursor: "c2" }, { cursor: "c2" }]);
		expect(screen.queryByText(ERROR_MESSAGES.ja.INTERNAL_ERROR)).toBeNull();
	});

	it("「最初から読み込み直す」は、先頭から読み直して一覧を置き換える。読み込み中は押しても送らない", async () => {
		const user = userEvent.setup();
		let first = [item({ id: "img-1" })];
		const gate = deferred<Response>();
		let calls = 0;
		listPages({
			"": () => {
				calls += 1;
				return calls === 1 ? success({ items: first }) : gate.promise;
			},
		});
		await renderPage();
		first = [item({ id: "img-9" })];
		const reload = screen.getByRole("button", { name: "最初から読み込み直す" });

		await user.click(reload);
		// 読み込み中(aria-disabled。フォーカスは残る)
		const busy = screen.getByRole("button", { name: "読み込んでいます…" });
		expect(busy).toHaveAttribute("aria-disabled", "true");
		expect(busy).toHaveFocus();
		await user.click(busy);
		expect(listRequests()).toHaveLength(2);

		await act(async () => {
			gate.resolve(success({ items: first }));
		});
		await screen.findByText("ID img-9");
		expect(screen.queryByText("ID img-1")).toBeNull();
		expect(screen.getByRole("button", { name: "最初から読み込み直す" })).toHaveAttribute(
			"aria-disabled",
			"false",
		);
	});

	it("中断した読み込みの結果は捨てる(StrictMode の effect の二重実行でも、読み込み中の表示を保つ)", async () => {
		const gate = deferred<Response>();
		let calls = 0;
		listPages({
			"": (request) => {
				calls += 1;
				return calls === 1 ? hang(request) : gate.promise;
			},
		});

		render(
			<StrictMode>
				<ImagesPage />
			</StrictMode>,
		);

		await waitFor(() => expect(listRequests()).toHaveLength(2));
		expect(sent[0]?.signal?.aborted).toBe(true);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(screen.getByText("画像の一覧を読み込み中…")).toBeInTheDocument();
		expect(document.querySelector('[role="alert"]')).toBeEmptyDOMElement();

		await act(async () => {
			gate.resolve(success({ items: [item()] }));
		});
		expect(row("img-1")).toBeInTheDocument();
		expect(listRequests()).toHaveLength(2);
	});

	it("アンマウントしたら、読み込み中の要求を中断する", async () => {
		listPages({ "": hang });
		const view = render(<ImagesPage />);
		await waitFor(() => expect(listRequests()).toHaveLength(1));

		view.unmount();

		expect(sent[0]?.signal?.aborted).toBe(true);
	});

	it("言語を変えると文言だけが変わり、一覧は読み直さない", async () => {
		const image = item();
		listPages({ "": { items: [image] } });
		await renderPage();

		await changeLang("en");

		expect(screen.getByRole("heading", { level: 1, name: "Manage images" })).toBeInTheDocument();
		expect(screen.getByRole("table", { name: "Uploaded images (1 shown)" })).toBeInTheDocument();
		expect(within(row("img-1")).getByText("Published")).toBeInTheDocument();
		expect(within(row("img-1")).getByText("field cover · ja · in use")).toBeInTheDocument();
		expect(
			within(row("img-1")).getByRole("button", {
				name: `Move to trash: 1280×853 image created ${formatDate(image.createdAt, "en")}`,
			}),
		).toBeInTheDocument();
		expect(screen.getByText("“Not referenced” does not mean “safe to delete”")).toBeInTheDocument();
		expect(listRequests()).toHaveLength(1);
	});
});

describe("readImagePages / readImageList", () => {
	it("空のページは続けて読み、画像が届くか最後のページで返す", async () => {
		listPages({
			"": { items: [], nextCursor: "h1" },
			h1: { items: [item()], nextCursor: "c2" },
		});

		const result = await readImagePages(undefined, new AbortController().signal);

		expect(result.items.map((entry) => entry.id)).toEqual(["img-1"]);
		expect(result.nextCursor).toBe("c2");
	});

	it("INVALID_CURSOR なら最初から 1 回だけ読み直す。ほかのエラーはそのまま投げる", async () => {
		listPages({ "": { items: [item()] } });

		await expect(readImageList("stale", new AbortController().signal)).resolves.toMatchObject({
			restarted: true,
			nextCursor: undefined,
		});
		expect(listRequests()).toEqual([{ cursor: "stale" }, {}]);

		route("POST", LIST_URL, () => apiError("INTERNAL_ERROR", 500));
		const error = await readImageList("c2", new AbortController().signal).catch(
			(caught: unknown) => caught,
		);
		expect(isBase64ImageError(error) && error.code).toBe("INTERNAL_ERROR");
		expect(listRequests()).toHaveLength(3);
	});
});

// ---------------------------------------------------------------------------
// ボタンの出し分け
// ---------------------------------------------------------------------------

describe("ボタンの出し分け(ロールと画像の状態)", () => {
	const images = [
		item({ id: "published" }),
		item({ id: "draft", entryPublication: "draft" }),
		item({ id: "scheduled", entryPublication: "scheduled" }),
		item({ id: "trashed", entryStatus: "trashed", entryPublication: null }),
		item({
			id: "missing",
			entryStatus: "missing",
			entryPublication: null,
			owners: [],
			ownersTotal: 0,
		}),
	];

	it.each([
		["ロールが分からない(読み込み中)", undefined, [[], [], [], [], []]],
		["閲覧者", 10, [[], [], [], [], []]],
		["寄稿者", 20, [["ゴミ箱に移動"], ["ゴミ箱に移動"], ["ゴミ箱に移動"], [], []]],
		["投稿者", 30, [["ゴミ箱に移動"], ["ゴミ箱に移動"], ["ゴミ箱に移動"], [], []]],
		["編集者", 40, [["ゴミ箱に移動"], ["公開", "ゴミ箱に移動"], ["ゴミ箱に移動"], [], []]],
		[
			"管理者",
			50,
			[["ゴミ箱に移動"], ["公開", "ゴミ箱に移動"], ["ゴミ箱に移動"], ["完全に削除"], []],
		],
	] as const)("%s", async (_label, role, expected) => {
		setRole(role);
		listPages({ "": { items: images } });

		await renderPage();

		expect(images.map((image) => rowButtons(image.id))).toEqual(expected);
	});

	it("ボタンの名前には、どの画像かを含める(見える文字から始める)", async () => {
		const image = item({ id: "draft", entryPublication: "draft" });
		const trashed = item({
			id: "trashed",
			width: 800,
			height: 600,
			createdAt: "2026-09-20T01:02:00.000Z",
			entryStatus: "trashed",
			entryPublication: null,
		});
		listPages({ "": { items: [image, trashed] } });

		await renderPage();

		expect(
			within(row("draft"))
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-label")),
		).toEqual([`公開: ${nameOf(image)}`, `ゴミ箱に移動: ${nameOf(image)}`]);
		expect(within(row("trashed")).getByRole("button")).toHaveAccessibleName(
			`完全に削除: ${nameOf(trashed)}`,
		);
	});

	it("寸法と作成日時(分まで)が同じ画像がほかにもあれば、名前に ID を足して区別する", async () => {
		const first = item({ id: "img-1", createdAt: "2026-09-24T12:00:00.000Z" });
		const second = item({ id: "img-2", createdAt: "2026-09-24T12:00:30.000Z" });
		const other = item({ id: "img-3", createdAt: "2026-09-24T12:05:00.000Z" });
		listPages({ "": { items: [first, second, other] } });

		await renderPage();

		expect(nameOf(first)).toBe(nameOf(second));
		expect(within(row("img-1")).getByRole("button")).toHaveAccessibleName(
			`ゴミ箱に移動: ${nameOf(first)}(ID img-1)`,
		);
		expect(within(row("img-2")).getByRole("button")).toHaveAccessibleName(
			`ゴミ箱に移動: ${nameOf(second)}(ID img-2)`,
		);
		expect(within(row("img-3")).getByRole("button")).toHaveAccessibleName(
			`ゴミ箱に移動: ${nameOf(other)}`,
		);

		await changeLang("en");
		expect(within(row("img-1")).getByRole("button")).toHaveAccessibleName(
			`Move to trash: 1280×853 image created ${formatDate(first.createdAt, "en")} (ID img-1)`,
		);
	});

	it("ロールが後から分かったら、ボタンを出す", async () => {
		setRole(undefined);
		listPages({ "": { items: [item()] } });
		const view = await renderPage();
		expect(rowButtons("img-1")).toEqual([]);

		setRole(ROLE_CONTRIBUTOR);
		view.rerender(<ImagesPage />);

		expect(rowButtons("img-1")).toEqual(["ゴミ箱に移動"]);
	});
});

// ---------------------------------------------------------------------------
// ゴミ箱に移動
// ---------------------------------------------------------------------------

describe("ゴミ箱に移動", () => {
	it("使用中の画像は、確認で使用中であることと、戻せるのは編集者以上であることを示す。最初のフォーカスはキャンセル", async () => {
		const user = userEvent.setup();
		const image = item({ usage: "in_use" });
		listPages({ "": { items: [image] } });
		await renderPage();

		await user.click(screen.getByRole("button", { name: `ゴミ箱に移動: ${nameOf(image)}` }));

		const dialog = await screen.findByRole("alertdialog", { name: "画像をゴミ箱に移動しますか?" });
		expect(dialog).toHaveAccessibleDescription(
			"この画像は使用中です。移動すると、この画像を使っている投稿などに画像が表示されなくなります。 ゴミ箱に移動した画像は、サイトに表示されなくなります。ゴミ箱から戻せるのは、編集者以上のロールの利用者です。",
		);
		// どの画像かを確かめられるよう、サムネイル・寸法・ID を出す
		expect(dialog.querySelector("img")).toHaveAttribute("src", THUMB);
		expect(within(dialog).getByText("1280×853 · 保存サイズ 99.6KB")).toBeInTheDocument();
		expect(within(dialog).getByText("ID img-1")).toBeInTheDocument();
		await waitFor(() =>
			expect(within(dialog).getByRole("button", { name: "キャンセル" })).toHaveFocus(),
		);
		expect(requestsTo(TRASH_URL)).toHaveLength(0);
	});

	it("使用中でない画像の確認には、使用中の文を出さない", async () => {
		const user = userEvent.setup();
		const image = item({ usage: "no_owner", owners: [], ownersTotal: 0 });
		listPages({ "": { items: [image] } });
		await renderPage();

		await user.click(screen.getByRole("button", { name: `ゴミ箱に移動: ${nameOf(image)}` }));

		const dialog = await screen.findByRole("alertdialog");
		expect(dialog).toHaveAccessibleDescription(
			"ゴミ箱に移動した画像は、サイトに表示されなくなります。ゴミ箱から戻せるのは、編集者以上のロールの利用者です。",
		);
	});

	it("キャンセル・Escape では送らずに閉じ、フォーカスをボタンに戻す", async () => {
		const user = userEvent.setup();
		const image = item();
		listPages({ "": { items: [image] } });
		await renderPage();
		const trash = screen.getByRole("button", { name: `ゴミ箱に移動: ${nameOf(image)}` });

		await user.click(trash);
		await user.click(await screen.findByRole("button", { name: "キャンセル" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		await waitFor(() => expect(trash).toHaveFocus());

		await user.keyboard("{Enter}");
		await screen.findByRole("alertdialog");
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		await waitFor(() => expect(trash).toHaveFocus());
		expect(requestsTo(TRASH_URL)).toHaveLength(0);
		expect(rowButtons("img-1")).toEqual(["ゴミ箱に移動"]);
	});

	it("移動すると、行をゴミ箱の状態にし、フォーカスを行の見出しに移して知らせる(管理者には完全に削除を出す)", async () => {
		const user = userEvent.setup();
		const image = item({ entryPublication: "draft" });
		listPages({ "": { items: [image] } });
		route("POST", TRASH_URL, (request) =>
			success({ id: (request.body as { id: string }).id, trashed: true }),
		);
		await renderPage();

		await user.click(screen.getByRole("button", { name: `ゴミ箱に移動: ${nameOf(image)}` }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "ゴミ箱に移動" }));

		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		await waitFor(() => expect(rowHeader("img-1")).toHaveFocus());
		expect(requestsTo(TRASH_URL).map((request) => request.body)).toEqual([{ id: "img-1" }]);
		expect(within(row("img-1")).getByText("ゴミ箱")).toBeInTheDocument();
		expect(rowButtons("img-1")).toEqual(["完全に削除"]);
		expect(announcement()).toBe(`${nameOf(image)}をゴミ箱に移動しました。`);
	});

	it("キーボードだけで、ボタン → 確認 → 移動 ができる", async () => {
		const user = userEvent.setup();
		setRole(ROLE_CONTRIBUTOR);
		listPages({ "": { items: [item()] } });
		route("POST", TRASH_URL, () => success({ id: "img-1", trashed: true }));
		await renderPage();

		// 「最初から読み込み直す」→ 参照元のリンク → ゴミ箱に移動
		await user.tab();
		await user.tab();
		await user.tab();
		expect(screen.getByRole("button", { name: /^ゴミ箱に移動: / })).toHaveFocus();
		await user.keyboard("{Enter}");
		const dialog = await screen.findByRole("alertdialog");
		await waitFor(() =>
			expect(within(dialog).getByRole("button", { name: "キャンセル" })).toHaveFocus(),
		);
		await user.tab();
		expect(within(dialog).getByRole("button", { name: "ゴミ箱に移動" })).toHaveFocus();
		await user.keyboard("{Enter}");

		await waitFor(() => expect(rowHeader("img-1")).toHaveFocus());
		expect(requestsTo(TRASH_URL)).toHaveLength(1);
	});

	it("失敗したら、確認を開いたままエラーを出す。処理中は二度押し・Escape を受け付けない", async () => {
		const user = userEvent.setup();
		const image = item();
		listPages({ "": { items: [image] } });
		const gate = deferred<Response>();
		route("POST", TRASH_URL, () => gate.promise);
		await renderPage();

		await user.click(screen.getByRole("button", { name: `ゴミ箱に移動: ${nameOf(image)}` }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "ゴミ箱に移動" }));

		const pending = within(dialog).getByRole("button", { name: "移動しています…" });
		expect(pending).toHaveAttribute("aria-disabled", "true");
		expect(within(dialog).getByRole("button", { name: "キャンセル" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		await user.click(pending);
		await user.keyboard("{Escape}");
		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
		expect(requestsTo(TRASH_URL)).toHaveLength(1);

		await act(async () => {
			gate.resolve(apiError("IMAGE_NOT_FOUND", 404, "Image not found"));
		});

		const alert = within(dialog).getByRole("alert");
		expect(alert).toHaveTextContent("ゴミ箱に移動できませんでした");
		expect(alert).toHaveTextContent(ERROR_MESSAGES.ja.IMAGE_NOT_FOUND);
		expect(within(dialog).getByRole("button", { name: "ゴミ箱に移動" })).toHaveAttribute(
			"aria-disabled",
			"false",
		);
		// 行は変わらない
		expect(within(row("img-1")).getByText("公開済み")).toBeInTheDocument();

		// 閉じて開き直すと、前のエラーは消えている
		await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		await user.click(screen.getByRole("button", { name: `ゴミ箱に移動: ${nameOf(image)}` }));
		expect(within(await screen.findByRole("alertdialog")).getByRole("alert")).toBeEmptyDOMElement();
	});

	it("確認の外側を押しても閉じない(alertdialog。管理画面の確認と同じ)", async () => {
		const user = userEvent.setup();
		const image = item();
		listPages({ "": { items: [image] } });
		await renderPage();

		await user.click(screen.getByRole("button", { name: `ゴミ箱に移動: ${nameOf(image)}` }));
		await screen.findByRole("alertdialog");
		await user.click(document.body);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});

		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
		expect(requestsTo(TRASH_URL)).toHaveLength(0);
	});

	it("403 は、ロールが変わった可能性を伝える", async () => {
		const user = userEvent.setup();
		const image = item();
		listPages({ "": { items: [image] } });
		route("POST", TRASH_URL, () => apiError("FORBIDDEN", 403, "Insufficient permissions"));
		await renderPage();

		await user.click(screen.getByRole("button", { name: `ゴミ箱に移動: ${nameOf(image)}` }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "ゴミ箱に移動" }));

		expect(await within(dialog).findByRole("alert")).toHaveTextContent(
			"この操作を行う権限がありません。ロールが変更された可能性があるため、ページを再読み込みしてください。",
		);
	});
});

// ---------------------------------------------------------------------------
// 完全に削除
// ---------------------------------------------------------------------------

describe("完全に削除", () => {
	const trashed = (id: string, overrides: Partial<ImageListItem> = {}) =>
		item({ id, entryStatus: "trashed", entryPublication: null, ...overrides });

	it("確認では元に戻せないことを示し、使用中なら保存できなくなること、そうでなければ「参照されていない」の注意を出す", async () => {
		const user = userEvent.setup();
		const inUse = trashed("in-use", { usage: "in_use" });
		const unused = trashed("unused", { usage: "no_owner", owners: [], ownersTotal: 0 });
		listPages({ "": { items: [inUse, unused] } });
		await renderPage();

		await user.click(screen.getByRole("button", { name: `完全に削除: ${nameOf(inUse)}` }));
		let dialog = await screen.findByRole("alertdialog", { name: "画像を完全に削除しますか?" });
		expect(dialog).toHaveAccessibleDescription(
			"完全に削除した画像は、元に戻せません。 この画像はまだ使用中です。参照している投稿などは、画像を外すまで保存できなくなります。",
		);
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

		await user.click(screen.getAllByRole("button", { name: /^完全に削除: / })[1] as HTMLElement);
		dialog = await screen.findByRole("alertdialog");
		expect(dialog).toHaveAccessibleDescription(
			"完全に削除した画像は、元に戻せません。 参照されていないと判定された画像でも、古いリビジョンや、複製したまま保存も公開もしていないエントリから、まだ参照されている可能性があります。",
		);
	});

	it("削除すると、標準 API を DELETE で呼び、行を消して次の行にフォーカスを移す", async () => {
		const user = userEvent.setup();
		const first = trashed("img-1");
		listPages({ "": { items: [first, trashed("img-2"), trashed("img-3")] } });
		route("DELETE", contentUrl("img-1", "permanent"), () =>
			success({ deleted: true, id: "img-1" }),
		);
		await renderPage();

		await user.click(screen.getByRole("button", { name: `完全に削除: ${nameOf(first)}` }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "完全に削除" }));

		await waitFor(() => expect(hasRow("img-1")).toBe(false));
		await waitFor(() => expect(rowHeader("img-2")).toHaveFocus());
		const [request] = requestsTo(contentUrl("img-1", "permanent"));
		expect(request?.method).toBe("DELETE");
		expect(request?.headers.get("X-EmDash-Request")).toBe("1");
		expect(announcement()).toBe(`${nameOf(first)}を完全に削除しました。`);
		// 記録は応答のあとに消えるので、すぐに読み直さない
		expect(listRequests()).toHaveLength(1);
	});

	it("最後の行を消したら前の行へ、1 枚も無くなったら見出しへフォーカスを移す", async () => {
		const user = userEvent.setup();
		listPages({ "": { items: [trashed("img-1"), trashed("img-2")] } });
		for (const id of ["img-1", "img-2"]) {
			route("DELETE", contentUrl(id, "permanent"), () => success({ deleted: true, id }));
		}
		await renderPage();

		await user.click(within(row("img-2")).getByRole("button"));
		await user.click(
			within(await screen.findByRole("alertdialog")).getByRole("button", { name: "完全に削除" }),
		);
		await waitFor(() => expect(rowHeader("img-1")).toHaveFocus());

		await user.click(within(row("img-1")).getByRole("button"));
		await user.click(
			within(await screen.findByRole("alertdialog")).getByRole("button", { name: "完全に削除" }),
		);
		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 1, name: "画像の管理" })).toHaveFocus(),
		);
		expect(screen.getByText("画像はまだありません。")).toBeInTheDocument();
	});

	it("404(ゴミ箱に入っていない)は、戻された可能性も含めて伝える", async () => {
		const user = userEvent.setup();
		const image = trashed("img-1");
		listPages({ "": { items: [image] } });
		route("DELETE", contentUrl("img-1", "permanent"), () =>
			apiError("NOT_FOUND", 404, "Content item not found: img-1"),
		);
		await renderPage();

		await user.click(screen.getByRole("button", { name: `完全に削除: ${nameOf(image)}` }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "完全に削除" }));

		const alert = await within(dialog).findByRole("alert");
		await waitFor(() => expect(alert).toHaveTextContent("完全に削除できませんでした"));
		expect(alert).toHaveTextContent(
			"ゴミ箱に画像が見つかりません。すでに完全に削除されたか、ゴミ箱から戻された可能性があります。一覧を読み込み直してください。",
		);
		expect(hasRow("img-1")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 公開
// ---------------------------------------------------------------------------

describe("公開(下書きの画像を公開し直す)", () => {
	it("標準 API を body なしの POST で呼び、公開済みにして、行の見出しにフォーカスを移す", async () => {
		const user = userEvent.setup();
		setRole(ROLE_EDITOR);
		const image = item({ entryPublication: "draft" });
		listPages({ "": { items: [image] } });
		route("POST", contentUrl("img-1", "publish"), () =>
			success({ item: { id: "img-1", status: "published", data: {} }, _rev: "r1" }),
		);
		await renderPage();

		await user.click(screen.getByRole("button", { name: `公開: ${nameOf(image)}` }));

		await waitFor(() => expect(rowHeader("img-1")).toHaveFocus());
		const [request] = requestsTo(contentUrl("img-1", "publish"));
		expect(request?.method).toBe("POST");
		expect(request?.body).toBeUndefined();
		expect(within(row("img-1")).getByText("公開済み")).toBeInTheDocument();
		expect(within(row("img-1")).queryByText("サイトに表示されません。")).toBeNull();
		expect(rowButtons("img-1")).toEqual(["ゴミ箱に移動"]);
		expect(announcement()).toBe(`${nameOf(image)}を公開しました。`);
	});

	it("処理中は「公開しています…」にして二度押しを受け付けない", async () => {
		const user = userEvent.setup();
		setRole(ROLE_EDITOR);
		const image = item({ entryPublication: "draft" });
		listPages({ "": { items: [image] } });
		const gate = deferred<Response>();
		route("POST", contentUrl("img-1", "publish"), () => gate.promise);
		await renderPage();
		const button = screen.getByRole("button", { name: `公開: ${nameOf(image)}` });

		await user.click(button);
		expect(button).toHaveTextContent("公開しています…");
		expect(button).toHaveAttribute("aria-disabled", "true");
		expect(button).toHaveFocus();
		await user.click(button);
		expect(requestsTo(contentUrl("img-1", "publish"))).toHaveLength(1);

		await act(async () => {
			gate.resolve(success({ item: { id: "img-1", status: "published" } }));
		});
		await waitFor(() => expect(rowHeader("img-1")).toHaveFocus());
	});

	it.each([
		[
			"409 ENTRY_LOCKED(ほかの利用者が編集画面で開いている)",
			() => apiError("ENTRY_LOCKED", 409, "Someone is holding this entry"),
			"ほかの利用者が編集画面でこの画像を開いているため、公開できません。しばらくしてから、もう一度お試しください。",
		],
		[
			"422 PUBLISH_REJECTED(ほかのプラグインが止めた)",
			() => apiError("PUBLISH_REJECTED", 422, "Rejected"),
			"公開が拒否されました。ほかのプラグインの公開の規則で止められた可能性があります。",
		],
		[
			"409 CONFLICT",
			() => apiError("CONFLICT", 409, "Conflict"),
			"ほかの操作と重なったため、公開できませんでした。一覧を読み込み直してから、もう一度お試しください。",
		],
		[
			"404(ゴミ箱に移動された・削除された)",
			() => apiError("NOT_FOUND", 404, "Content item not found"),
			"画像が見つかりません。ゴミ箱に移動されたか、削除された可能性があります。一覧を読み込み直してください。",
		],
		[
			"403",
			() => apiError("FORBIDDEN", 403, "Insufficient permissions"),
			"この操作を行う権限がありません。ロールが変更された可能性があるため、ページを再読み込みしてください。",
		],
		["500", () => apiError("CONTENT_PUBLISH_ERROR", 500), ERROR_MESSAGES.ja.INTERNAL_ERROR],
	])("失敗: %s は、行にエラーを出し、フォーカスはボタンに残す", async (_label, reply, text) => {
		const user = userEvent.setup();
		setRole(ROLE_EDITOR);
		const image = item({ entryPublication: "draft" });
		listPages({ "": { items: [image] } });
		route("POST", contentUrl("img-1", "publish"), reply);
		await renderPage();
		const button = screen.getByRole("button", { name: `公開: ${nameOf(image)}` });

		await user.click(button);

		const alert = await within(row("img-1")).findByText(text);
		expect(alert.closest('[role="alert"]')).toHaveTextContent("公開できませんでした");
		expect(button).toHaveTextContent("公開");
		expect(button).toHaveAttribute("aria-disabled", "false");
		expect(button).toHaveFocus();
		expect(within(row("img-1")).getByText("下書き")).toBeInTheDocument();
	});

	it("公開に失敗したあとでゴミ箱に移動したら、公開の失敗の表示を消す", async () => {
		const user = userEvent.setup();
		setRole(ROLE_EDITOR);
		const image = item({ entryPublication: "draft" });
		listPages({ "": { items: [image] } });
		route("POST", contentUrl("img-1", "publish"), () => apiError("ENTRY_LOCKED", 409));
		route("POST", TRASH_URL, () => success({ id: "img-1", trashed: true }));
		await renderPage();

		await user.click(screen.getByRole("button", { name: `公開: ${nameOf(image)}` }));
		await within(row("img-1")).findByText(/ほかの利用者が編集画面で/);
		await user.click(screen.getByRole("button", { name: `ゴミ箱に移動: ${nameOf(image)}` }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "ゴミ箱に移動" }));

		await waitFor(() => expect(rowHeader("img-1")).toHaveFocus());
		expect(within(row("img-1")).getByText("ゴミ箱")).toBeInTheDocument();
		expect(within(row("img-1")).queryByText(/ほかの利用者が編集画面で/)).toBeNull();
	});

	it("公開し直すと、前の失敗の表示を消す", async () => {
		const user = userEvent.setup();
		setRole(ROLE_EDITOR);
		const image = item({ entryPublication: "draft" });
		listPages({ "": { items: [image] } });
		let calls = 0;
		route("POST", contentUrl("img-1", "publish"), () => {
			calls += 1;
			return calls === 1
				? apiError("ENTRY_LOCKED", 409)
				: success({ item: { id: "img-1", status: "published" } });
		});
		await renderPage();
		const button = screen.getByRole("button", { name: `公開: ${nameOf(image)}` });

		await user.click(button);
		await within(row("img-1")).findByText(/ほかの利用者が編集画面で/);
		await user.click(button);

		await waitFor(() => expect(within(row("img-1")).getByText("公開済み")).toBeInTheDocument());
		expect(within(row("img-1")).queryByText(/ほかの利用者が編集画面で/)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 一覧のサムネイル列(T24)の覚え書き
// ---------------------------------------------------------------------------

describe("一覧のサムネイル列(T24)の覚え書き", () => {
	/** 列の覚え書きを作っておく(コンテンツ一覧を開いたあとの状態)。マニフェストとサムネイルを 1 回ずつ取得する */
	async function primeColumn(ids: readonly string[]): Promise<void> {
		preloadThumbnailColumn();
		requestThumbnails(ids);
		await waitFor(() => expect(showsThumbnailColumn("pages")).toBe(false));
		await waitFor(() => expect(requestsTo(THUMBNAILS_URL)).toHaveLength(1));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		// 覚えている間(1 分)は取り直さない
		requestThumbnails(ids);
		expect(requestsTo(THUMBNAILS_URL)).toHaveLength(1);
		expect(requestsTo(MANIFEST_URL)).toHaveLength(1);
	}

	it("完全に削除したら、覚え書きを消し、マニフェストをすぐに読み直す(次に開く一覧で、サムネイルを取り直し、列を出すコレクションを正しく判定する)", async () => {
		const user = userEvent.setup();
		const image = item({ id: "img-1", entryStatus: "trashed", entryPublication: null });
		listPages({ "": { items: [image] } });
		route("DELETE", contentUrl("img-1", "permanent"), () =>
			success({ deleted: true, id: "img-1" }),
		);
		await renderPage();
		await primeColumn(["img-1", "img-2"]);

		await user.click(screen.getByRole("button", { name: `完全に削除: ${nameOf(image)}` }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "完全に削除" }));
		await waitFor(() => expect(hasRow("img-1")).toBe(false));

		// マニフェストは、完全削除の応答のあとですぐに読み直す
		await waitFor(() => expect(requestsTo(MANIFEST_URL)).toHaveLength(2));
		const deleteAt = sent.findIndex((request) => request.method === "DELETE");
		const manifestAt = sent.findLastIndex((request) => request.url === MANIFEST_URL);
		expect(manifestAt).toBeGreaterThan(deleteAt);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		// 次に開く一覧: このプラグインのフィールドの無いコレクションでは、最初の判定から列を出さない(読み込み中の true にならない)
		expect(showsThumbnailColumn("pages")).toBe(false);
		expect(showsThumbnailColumn("posts")).toBe(true);
		// サムネイルは取り直す(完全に削除した画像は、警告アイコンになる)
		requestThumbnails(["img-1", "img-2"]);
		expect(requestsTo(THUMBNAILS_URL)).toHaveLength(2);
		expect(requestsTo(THUMBNAILS_URL)[1]?.body).toEqual({ ids: ["img-1", "img-2"] });
	});

	it("ゴミ箱への移動と公開では、覚え書きを消さない(記録が変わらず、一覧の列の表示も変わらない)", async () => {
		const user = userEvent.setup();
		const draft = item({ id: "img-1", entryPublication: "draft" });
		const published = item({ id: "img-2" });
		listPages({ "": { items: [draft, published] } });
		route("POST", contentUrl("img-1", "publish"), () =>
			success({ item: { id: "img-1", status: "published" } }),
		);
		route("POST", TRASH_URL, () => success({ id: "img-2", trashed: true }));
		await renderPage();
		await primeColumn(["img-1", "img-2"]);

		await user.click(screen.getByRole("button", { name: `公開: ${nameOf(draft)}` }));
		await waitFor(() => expect(within(row("img-1")).getByText("公開済み")).toBeInTheDocument());
		await user.click(screen.getByRole("button", { name: `ゴミ箱に移動: ${nameOf(published)}` }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "ゴミ箱に移動" }));
		await waitFor(() => expect(within(row("img-2")).getByText("ゴミ箱")).toBeInTheDocument());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(requestsTo(MANIFEST_URL)).toHaveLength(1);
		requestThumbnails(["img-1", "img-2"]);
		expect(requestsTo(THUMBNAILS_URL)).toHaveLength(1);
	});

	it("完全削除に失敗したら、覚え書きを消さない", async () => {
		const user = userEvent.setup();
		const image = item({ id: "img-1", entryStatus: "trashed", entryPublication: null });
		listPages({ "": { items: [image] } });
		route("DELETE", contentUrl("img-1", "permanent"), () => apiError("NOT_FOUND", 404));
		await renderPage();
		await primeColumn(["img-1"]);

		await user.click(screen.getByRole("button", { name: `完全に削除: ${nameOf(image)}` }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "完全に削除" }));
		await within(dialog).findByText("完全に削除できませんでした");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(requestsTo(MANIFEST_URL)).toHaveLength(1);
		requestThumbnails(["img-1"]);
		expect(requestsTo(THUMBNAILS_URL)).toHaveLength(1);
	});

	it("一覧の列のモジュールは、このページから読み込んでも、実行時に @emdash-cms/admin を読み込まない(T24 の決まり)", async () => {
		const loaded = "@emdash-cms/admin was loaded at runtime";
		// 読み込み直し、@emdash-cms/admin を読み込もうとしたら失敗するようにする(型だけの import は実行時に消える)
		vi.resetModules();
		vi.doMock("@emdash-cms/admin", () => {
			throw new Error(loaded);
		});
		try {
			await expect(import("../../src/admin/ThumbnailColumn")).resolves.toHaveProperty(
				"clearThumbnailColumnCache",
			);
			// 比べるため: このページは useCurrentUser を実行時に読み込むので、同じ条件では読み込めない(確かめ方が働いていること)
			const failure = await import("../../src/admin/ImagesPage").then(
				() => undefined,
				(error: unknown) => error,
			);
			expect(failure).toBeInstanceOf(Error);
			expect(String((failure as Error).cause ?? failure)).toContain(loaded);
		} finally {
			// ほかのテストが読み込むときのために、ファイルの先頭と同じモックに戻す
			vi.doMock("@emdash-cms/admin", () => ({ useCurrentUser }));
		}
	});
});

// ---------------------------------------------------------------------------
// ページの定数(T29・T30 の登録に使う)
// ---------------------------------------------------------------------------

describe("ページの定数(src/shared/constants.ts の IMAGES_PAGE。T29・T30 が登録に使う)", () => {
	it("T29 の definePlugin の admin.pages に、そのまま入れられる(型のテスト)", () => {
		const admin: PluginAdminConfig = {
			entry: "emdash-plugin-base64-image/admin",
			pages: [IMAGES_PAGE],
		};
		expect(admin.pages).toEqual([{ path: "/images", label: "an5hVd", icon: "image" }]);
	});

	it("T30 の pages のキーに使える(props を受け取らない部品。型のテスト)", () => {
		const pages: NonNullable<PluginAdminModule["pages"]> = { [IMAGES_PAGE.path]: ImagesPage };
		expect(pages[IMAGES_PAGE.path]).toBe(ImagesPage);
	});

	it("パスは管理画面が受け付ける形で、/ から始める(サイドバーのリンクと、部品を探すキーが同じになる)", () => {
		expect(isSafePluginPagePath(IMAGES_PAGE.path)).toBe(true);
		expect(normalizePluginPagePath(IMAGES_PAGE.path)).toBe(IMAGES_PAGE.path);
	});

	it("ラベルは、Lingui が「Images」から作る ID(sha256 の base64 の先頭 6 文字)", () => {
		// 管理画面はラベルを `i18n._(label)` で訳すので、文字列の「Images」は訳されない(本番のビルドでは警告も出る)
		expect(createHash("sha256").update("Images\u001F").digest("base64").slice(0, 6)).toBe(
			IMAGES_PAGE.label,
		);
	});

	it("ラベルの ID は、管理画面が使えるすべての言語の辞書にある(日本語は「画像」、英語は「Images」)", async () => {
		const { SUPPORTED_LOCALES, loadMessages } = await import("@emdash-cms/admin/locales");
		const translations = new Map<string, unknown>();
		for (const { code } of SUPPORTED_LOCALES) {
			// oxlint-disable-next-line no-await-in-loop -- 辞書を 1 つずつ読む(テストだけ)
			translations.set(code, (await loadMessages(code))[IMAGES_PAGE.label]);
		}

		expect(translations.size).toBeGreaterThan(1);
		// 訳が無い言語(ID がそのままサイドバーに出る)
		const untranslated = [...translations]
			.filter(
				([, translation]) =>
					!Array.isArray(translation) ||
					translation.length !== 1 ||
					typeof translation[0] !== "string" ||
					translation[0].trim() === "",
			)
			.map(([code]) => code);
		expect(untranslated).toEqual([]);
		expect(translations.get("ja")).toEqual(["画像"]);
		expect(translations.get("en")).toEqual(["Images"]);
	});
});

// ---------------------------------------------------------------------------
// 見た目のクラス
// ---------------------------------------------------------------------------

describe("見た目のクラス", () => {
	it("使うクラスは、すべて管理画面の CSS にある(状態・参照元・エラー・確認のダイアログを出した状態で)", async () => {
		const user = userEvent.setup();
		listPages({
			"": {
				items: [
					item({
						id: "draft",
						entryPublication: "draft",
						owners: [
							owner(),
							owner({ field: "gallery", status: "detached" }),
							owner({ status: "owner_deleted", entryId: "gone" }),
						],
						ownersTotal: 30,
					}),
					item({ id: "scheduled", entryPublication: "scheduled", usage: "owner_deleted" }),
					item({
						id: "trashed",
						entryStatus: "trashed",
						entryPublication: null,
						usage: "detached",
					}),
					item({
						id: "missing",
						entryStatus: "missing",
						entryPublication: null,
						usage: "no_owner",
						owners: [],
						ownersTotal: 0,
					}),
				],
				nextCursor: "c2",
			},
			c2: () => apiError("INTERNAL_ERROR", 500),
		});
		route("POST", contentUrl("draft", "publish"), () => apiError("ENTRY_LOCKED", 409));
		route("POST", TRASH_URL, () => apiError("INTERNAL_ERROR", 500));
		await renderPage();

		await user.click(screen.getByRole("button", { name: /^公開: / }));
		await within(row("draft")).findByText(/ほかの利用者が編集画面で/);
		await user.click(screen.getByRole("button", { name: "さらに読み込む" }));
		await screen.findByText(ERROR_MESSAGES.ja.INTERNAL_ERROR);
		await user.click(screen.getAllByRole("button", { name: /^ゴミ箱に移動: / })[0] as HTMLElement);
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "ゴミ箱に移動" }));
		await within(dialog).findByText("ゴミ箱に移動できませんでした");

		const missing = findMissingClasses(
			document.body,
			sourceTokens("src/admin/ImagesPage.tsx", "src/admin/parts"),
		);
		expect(missing.fromSource).toEqual([]);
		expect(missing.unknown).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 本物の useCurrentUser
// ---------------------------------------------------------------------------

// 本物の `@emdash-cms/admin` を読むので(約 1.5 秒)、負荷の高いマシンでも既定の 5 秒で失敗しないよう延ばす(T30-2)
describe("ロールの取得(本物の useCurrentUser)", { timeout: 30_000 }, () => {
	it("管理画面の React Query と同じ要求(GET /_emdash/api/auth/me)の role でボタンを出す", async () => {
		// 本物の `@emdash-cms/admin` を読む(jsdom で数秒かかる)。管理画面と同じく、Lingui を有効にし、QueryClient の中に置く。
		// `@tanstack/react-query` と `@lingui/core` は `@emdash-cms/admin` の依存で、このプラグインの package.json には無い
		// (巻き上げられた node_modules から、管理画面と同じものを読む)
		const actual = await vi.importActual<typeof import("@emdash-cms/admin")>("@emdash-cms/admin");
		const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
		const { i18n } = await import("@lingui/core");
		i18n.loadAndActivate({ locale: "en", messages: {} });
		vi.mocked(useCurrentUser).mockImplementation(actual.useCurrentUser);
		route("GET", "/_emdash/api/auth/me", () =>
			success({ id: "user-1", email: "admin@example.com", role: 50, isFirstLogin: false }),
		);
		const image = item({ entryStatus: "trashed", entryPublication: null });
		listPages({ "": { items: [image] } });

		render(
			<QueryClientProvider client={new QueryClient()}>
				<ImagesPage />
			</QueryClientProvider>,
		);

		expect(
			await screen.findByRole("button", { name: `完全に削除: ${nameOf(image)}` }),
		).toBeInTheDocument();
		expect(requestsTo("/_emdash/api/auth/me").map((request) => request.method)).toEqual(["GET"]);
	}, 30_000);
});
