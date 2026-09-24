import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import type { ContentItem } from "@emdash-cms/admin";
import { fetchManifest } from "@emdash-cms/admin";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	clearThumbnailColumnCache,
	collectThumbnailIds,
	getRowImage,
	MANIFEST_STALE_MS,
	MAX_CACHED_THUMBNAILS,
	preloadThumbnailColumn,
	requestThumbnails,
	selectThumbnailField,
	showsThumbnailColumn,
	THUMBNAIL_COLUMN_LABEL,
	THUMBNAIL_STALE_MS,
	thumbnailColumn,
	type ThumbnailField,
} from "../../src/admin/ThumbnailColumn";
import { ERROR_MESSAGES } from "../../src/client/error-messages";
import type { Base64ImageRef, Thumbnail } from "../../src/shared/types";
import { findMissingClasses, sourceTokens } from "./admin-css";

// モジュールは差し替えない。マニフェストの取得は本物の `emdash/plugin-utils` の `apiFetch` / `parseApiResponse` を通り、
// `fetch` だけを偽物にする。jsdom では管理画面の Lingui が有効になっていない(入口の読み込み時と同じ状態)。
// 比べるために、管理画面の `fetchManifest`(`@emdash-cms/admin`)も呼ぶ。

// ---------------------------------------------------------------------------
// 共通の道具
// ---------------------------------------------------------------------------

const MANIFEST_URL = "/_emdash/api/manifest";
const THUMBNAILS_URL = "/_emdash/api/plugins/base64-image/thumbnails";

/** 一覧のマニフェスト(`collections[slug].fields` のキーの順はスキーマの順) */
const MANIFEST = {
	collections: {
		// 単一画像とギャラリーの両方 → 単一画像(cover)
		posts: {
			fields: {
				title: { kind: "string" },
				gallery: { kind: "json", widget: "base64-image:gallery" },
				cover: { kind: "json", widget: "base64-image:image" },
			},
		},
		// ギャラリーだけ → ギャラリー(photos)
		albums: {
			fields: {
				title: { kind: "string" },
				photos: { kind: "json", widget: "base64-image:gallery" },
			},
		},
		// このプラグインのフィールドが無い
		pages: { fields: { title: { kind: "string" }, body: { kind: "portableText" } } },
		// 画像の本体のコレクション(widget の無い json)
		b64_images: { fields: { image: { kind: "json" } } },
	},
};

function ref(id: string, alt = ""): Base64ImageRef {
	return { v: 1, id, locale: "en", width: 1280, height: 853, alt };
}

function thumb(id: string): Thumbnail {
	return { thumb: `data:image/webp;base64,${id}`, width: 1280, height: 853 };
}

function makeItem(id: string, data: Record<string, unknown>): ContentItem {
	return {
		id,
		type: "posts",
		slug: id,
		status: "published",
		locale: "en",
		translationGroup: null,
		data,
		authorId: null,
		primaryBylineId: null,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
		publishedAt: null,
		scheduledAt: null,
		liveRevisionId: null,
		draftRevisionId: null,
	};
}

/** 一覧の画面と同じく、行ごとにセルを描き、どのセルにも同じ `visibleItems` を渡す */
function ListTable({
	collection,
	items,
}: {
	readonly collection: string;
	readonly items: readonly ContentItem[];
}) {
	const Cell = thumbnailColumn.cell;
	return (
		<table>
			<tbody>
				{items.map((item) => (
					<tr key={item.id} data-testid={`row-${item.id}`}>
						<td>
							<Cell collection={collection} item={item} locale={item.locale} visibleItems={items} />
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** 一覧の画面の代わり。`recompute` のときは、描画中に列を選び直す(`ContentList.tsx` の `useMemo` と同じ) */
function ListScreen({
	items,
	recompute,
}: {
	readonly items: readonly ContentItem[];
	readonly recompute: boolean;
}) {
	if (recompute) showsThumbnailColumn("posts");
	return <ListTable collection="posts" items={items} />;
}

function renderList(collection: string, items: readonly ContentItem[]) {
	const view = render(<ListTable collection={collection} items={items} />);
	return {
		...view,
		/** 一覧の画面は描画のたびに `visibleItems` を作り直す(`paginatedItems` の slice) */
		rerenderList: (next: readonly ContentItem[] = items) =>
			view.rerender(<ListTable collection={collection} items={[...next]} />),
	};
}

function row(id: string): HTMLElement {
	return screen.getByTestId(`row-${id}`);
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function success(data: unknown): Response {
	return jsonResponse({ success: true, data });
}

/** `thumbnails` ルートの偽物。`known` に無い ID は `thumbnail: null`(`imageRefs` に無い) */
function thumbnailsResponse(
	ids: readonly string[],
	known: Readonly<Record<string, Thumbnail>>,
): Response {
	return success({ items: ids.map((id) => ({ id, thumbnail: known[id] ?? null })) });
}

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

type Handler<A extends unknown[]> = (...args: A) => Response | Promise<Response>;

/** 管理画面の API の偽物。マニフェスト(GET)と、このプラグインの thumbnails(POST)に答える */
const api: {
	manifest: Handler<[]>;
	thumbnails: Handler<[ids: string[]]>;
	/** 次の thumbnails の要求にだけ使う応答(先に入れたものから) */
	thumbnailsOnce: Handler<[ids: string[]]>[];
} = {
	manifest: () => success(MANIFEST),
	thumbnails: () => success({ items: [] }),
	thumbnailsOnce: [],
};

const fetchMock = vi.fn<typeof fetch>();

async function route(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
	const url = String(input);
	if (url === MANIFEST_URL) return api.manifest();
	if (url === THUMBNAILS_URL) {
		const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
		return (api.thumbnailsOnce.shift() ?? api.thumbnails)(ids);
	}
	throw new Error(`unexpected request: ${url}`);
}

function serveManifest(manifest: unknown = MANIFEST): void {
	api.manifest = () => success(manifest);
}

/** マニフェストの応答を止める。返した Deferred で応答する */
function holdManifest(): Deferred<Response> {
	const response = deferred<Response>();
	api.manifest = () => response.promise;
	return response;
}

/** 応答を返す。`known` のサムネイルだけがある */
function serveThumbnails(known: Readonly<Record<string, Thumbnail>>): void {
	api.thumbnails = (ids) => thumbnailsResponse(ids, known);
}

/** 次の thumbnails の要求の応答を止める。返した Deferred で応答する */
function holdThumbnailsOnce(): Deferred<Response> {
	const response = deferred<Response>();
	api.thumbnailsOnce.push(() => response.promise);
	return response;
}

function callsTo(url: string) {
	return fetchMock.mock.calls.filter(([input]) => String(input) === url);
}

function manifestRequests(): number {
	return callsTo(MANIFEST_URL).length;
}

/** サムネイルの要求で送った ID(要求ごと) */
function sentIds(): string[][] {
	return callsTo(THUMBNAILS_URL).map(
		([, init]) => (JSON.parse(String(init?.body)) as { ids: string[] }).ids,
	);
}

/** Promise の続き(マイクロタスク)と、それによる再描画を済ませる */
async function flush(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

/** 描画したあとで `<html lang>` を変える(MutationObserver の通知を待つ。docs/emdash-admin-locale-lang.md) */
async function changeLang(lang: string): Promise<void> {
	await act(async () => {
		document.documentElement.lang = lang;
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

beforeEach(() => {
	// 前のテストの描画は tests/setup/dom.ts の cleanup で片付いている(購読も解除されている)。
	clearThumbnailColumnCache();
	serveManifest();
	serveThumbnails({});
	api.thumbnailsOnce.length = 0;
	fetchMock.mockReset();
	fetchMock.mockImplementation(route);
	vi.stubGlobal("fetch", fetchMock);
	document.documentElement.lang = "ja";
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 表示するフィールド・行の値
// ---------------------------------------------------------------------------

describe("selectThumbnailField", () => {
	it("単一画像があれば、スキーマの順で最初の単一画像(前にギャラリーがあっても)", () => {
		expect(
			selectThumbnailField({
				gallery: { kind: "json", widget: "base64-image:gallery" },
				cover: { kind: "json", widget: "base64-image:image" },
				hero: { kind: "json", widget: "base64-image:image" },
			}),
		).toEqual({ slug: "cover", kind: "image" });
	});

	it("単一画像が無ければ、最初のギャラリー", () => {
		expect(
			selectThumbnailField({
				title: { kind: "string" },
				photos: { kind: "json", widget: "base64-image:gallery" },
				more: { kind: "json", widget: "base64-image:gallery" },
			}),
		).toEqual({ slug: "photos", kind: "gallery" });
	});

	it("json でないフィールド・ほかの widget・widget の無い json は対象にしない", () => {
		expect(
			selectThumbnailField({
				text: { kind: "string", widget: "base64-image:image" },
				other: { kind: "json", widget: "another-plugin:image" },
				raw: { kind: "json" },
			}),
		).toBeNull();
	});

	it.each([[undefined], [null], ["fields"], [[{ kind: "json", widget: "base64-image:image" }]]])(
		"フィールドの一覧がオブジェクトでなければ null(%j)",
		(fields) => {
			expect(selectThumbnailField(fields)).toBeNull();
		},
	);

	it("形の崩れたフィールドは読み飛ばす", () => {
		expect(
			selectThumbnailField({
				broken: null,
				list: ["json"],
				cover: { kind: "json", widget: "base64-image:image" },
			}),
		).toEqual({ slug: "cover", kind: "image" });
	});
});

describe("getRowImage", () => {
	const image: ThumbnailField = { slug: "cover", kind: "image" };
	const gallery: ThumbnailField = { slug: "photos", kind: "gallery" };

	it("単一画像: 参照ならその画像。値が無ければ未設定、参照の形でなければ不正", () => {
		expect(getRowImage({ cover: ref("a1", "説明") }, image)).toEqual({
			status: "image",
			ref: ref("a1", "説明"),
			more: 0,
		});
		expect(getRowImage({}, image)).toEqual({ status: "none" });
		expect(getRowImage({ cover: null }, image)).toEqual({ status: "none" });
		expect(getRowImage({ cover: {} }, image)).toEqual({ status: "invalid" });
		expect(getRowImage({ cover: "a1" }, image)).toEqual({ status: "invalid" });
		expect(getRowImage({ cover: [ref("a1")] }, image)).toEqual({ status: "invalid" });
	});

	it("ギャラリー: 1 枚目と残りの枚数。空・値なしは未設定、参照の配列でなければ不正", () => {
		expect(getRowImage({ photos: [ref("g1"), ref("g2"), ref("g3")] }, gallery)).toEqual({
			status: "image",
			ref: ref("g1"),
			more: 2,
		});
		expect(getRowImage({ photos: [ref("g1")] }, gallery)).toEqual({
			status: "image",
			ref: ref("g1"),
			more: 0,
		});
		expect(getRowImage({ photos: [] }, gallery)).toEqual({ status: "none" });
		expect(getRowImage({ photos: null }, gallery)).toEqual({ status: "none" });
		expect(getRowImage({ photos: ref("g1") }, gallery)).toEqual({ status: "invalid" });
		expect(getRowImage({ photos: [ref("g1"), { id: "g2" }] }, gallery)).toEqual({
			status: "invalid",
		});
	});
});

describe("collectThumbnailIds", () => {
	it("表示する画像の ID を、重複を除いて行の順に集める(未設定・不正な行は除く)", () => {
		const field: ThumbnailField = { slug: "cover", kind: "image" };
		const items = [
			{ data: { cover: ref("b2") } },
			{ data: { cover: ref("a1") } },
			{ data: {} },
			{ data: { cover: ref("b2") } },
			{ data: { cover: { id: "x9" } } },
			{ data: { cover: ref("c3") } },
		];
		expect(collectThumbnailIds(items, field)).toEqual(["b2", "a1", "c3"]);
	});
});

// ---------------------------------------------------------------------------
// 列を出すコレクション(collections)
// ---------------------------------------------------------------------------

describe("showsThumbnailColumn", () => {
	it("マニフェストを読み込むまでは true。呼ばれたときに読み込みを 1 回だけ始める", async () => {
		const manifest = holdManifest();

		expect(showsThumbnailColumn("pages")).toBe(true);
		expect(showsThumbnailColumn("posts")).toBe(true);
		expect(manifestRequests()).toBe(1);

		manifest.resolve(success(MANIFEST));
		await flush();
		expect(showsThumbnailColumn("pages")).toBe(false);
		expect(manifestRequests()).toBe(1);
	});

	it("読み込んだあとは、このプラグインのフィールドがあるコレクションだけ true", async () => {
		showsThumbnailColumn("posts");
		await flush();

		expect(showsThumbnailColumn("posts")).toBe(true);
		expect(showsThumbnailColumn("albums")).toBe(true);
		expect(showsThumbnailColumn("pages")).toBe(false);
		expect(showsThumbnailColumn("b64_images")).toBe(false);
		// マニフェストに無いコレクション
		expect(showsThumbnailColumn("unknown")).toBe(false);
	});

	it("マニフェストは CSRF のヘッダーを付けて GET で取得し、応答の包み(data)を開く", async () => {
		preloadThumbnailColumn();
		await flush();

		const [call] = callsTo(MANIFEST_URL);
		const init = call?.[1];
		expect(init?.method ?? "GET").toBe("GET");
		expect(new Headers(init?.headers).get("X-EmDash-Request")).toBe("1");
		expect(showsThumbnailColumn("pages")).toBe(false);
		expect(showsThumbnailColumn("posts")).toBe(true);
	});

	it("管理画面の Lingui が有効になる前でも読み込める(管理画面の fetchManifest はこの状態で失敗する)", async () => {
		// 管理画面の入口を読み込んだ時点と同じ状態。fetchManifest は応答を受け取ったあとで i18n._ を呼ぶ
		await expect(fetchManifest()).rejects.toThrow(/without setting a locale/);

		preloadThumbnailColumn();
		await flush();
		expect(showsThumbnailColumn("pages")).toBe(false);
	});

	it("読み込みに失敗したら true のまま、次に呼ばれたときに読み直す", async () => {
		api.manifest = () => Promise.reject(new TypeError("Failed to fetch"));
		expect(showsThumbnailColumn("pages")).toBe(true);
		await flush();
		expect(manifestRequests()).toBe(1);

		api.manifest = () => jsonResponse({ success: false, error: { code: "INTERNAL_ERROR" } }, 500);
		expect(showsThumbnailColumn("pages")).toBe(true);
		await flush();
		expect(manifestRequests()).toBe(2);

		serveManifest();
		expect(showsThumbnailColumn("pages")).toBe(true);
		expect(manifestRequests()).toBe(3);
		await flush();
		expect(showsThumbnailColumn("pages")).toBe(false);
	});

	it("マニフェストが古くなったら読み直す。読み直している間は前の結果を使う", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-24T00:00:00.000Z"));
		showsThumbnailColumn("pages");
		await flush();
		expect(showsThumbnailColumn("pages")).toBe(false);
		expect(manifestRequests()).toBe(1);

		// 古くなる前は読み直さない
		vi.setSystemTime(Date.now() + MANIFEST_STALE_MS - 1);
		expect(showsThumbnailColumn("pages")).toBe(false);
		expect(manifestRequests()).toBe(1);

		// pages に単一画像のフィールドが足された
		const updated = holdManifest();
		vi.setSystemTime(Date.now() + 1);
		expect(showsThumbnailColumn("pages")).toBe(false);
		expect(manifestRequests()).toBe(2);

		updated.resolve(
			success({
				collections: {
					...MANIFEST.collections,
					pages: { fields: { hero: { kind: "json", widget: "base64-image:image" } } },
				},
			}),
		);
		await flush();
		expect(showsThumbnailColumn("pages")).toBe(true);
	});

	it("一覧の描画中に呼ばれても、表示中のセルを更新しない(React の警告が出ない)", async () => {
		// セルがマニフェストの失敗を表示している状態で、一覧の画面が列を選び直す(読み直しが始まる)
		api.manifest = () => Promise.reject(new TypeError("Failed to fetch"));
		const items = [makeItem("p1", { cover: ref("a1") })];
		const view = render(<ListScreen items={items} recompute={false} />);
		expect(await screen.findByText("サムネイルを読み込めませんでした")).toBeInTheDocument();

		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			view.rerender(<ListScreen items={items} recompute />);
			await flush();
			expect(manifestRequests()).toBe(2);
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});

	it("preloadThumbnailColumn で、一覧を開く前に読み込める", async () => {
		preloadThumbnailColumn();
		expect(manifestRequests()).toBe(1);
		await flush();

		expect(showsThumbnailColumn("pages")).toBe(false);
		expect(manifestRequests()).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// セル
// ---------------------------------------------------------------------------

describe("ThumbnailCell", () => {
	it("表示中の行の画像を、1 回の要求でまとめて取得する(重複を除き、行の順)", async () => {
		serveThumbnails({ b2: thumb("b2"), a1: thumb("a1") });
		renderList("posts", [
			makeItem("p1", { cover: ref("b2") }),
			makeItem("p2", { cover: ref("a1") }),
			makeItem("p3", { cover: ref("b2") }),
			makeItem("p4", {}),
			makeItem("p5", { cover: { id: "x9" } }),
		]);

		expect(await screen.findAllByRole("img")).toHaveLength(3);
		expect(sentIds()).toEqual([["b2", "a1"]]);
		expect(manifestRequests()).toBe(1);
	});

	it("サムネイル・未設定(—)・警告アイコン(記録が無い・値が不正)を表示する", async () => {
		serveThumbnails({ a1: thumb("a1"), b2: thumb("b2") });
		renderList("posts", [
			makeItem("p1", { cover: ref("a1", "海辺の写真") }),
			makeItem("p2", { cover: ref("b2") }),
			makeItem("p3", { cover: null }),
			makeItem("p4", { cover: ref("gone") }),
			makeItem("p5", { cover: { id: "x9" } }),
		]);
		await screen.findAllByRole("img");

		// 代替テキストがあればそれを、空なら「画像」を alt にする
		const photo = within(row("p1")).getByRole("img", { name: "海辺の写真" });
		expect(photo).toHaveAttribute("src", "data:image/webp;base64,a1");
		expect(within(row("p2")).getByRole("img", { name: "画像" })).toHaveAttribute(
			"src",
			"data:image/webp;base64,b2",
		);

		// 未設定は「—」(読み上げは「画像なし」)
		expect(row("p3")).toHaveTextContent("—画像なし");
		expect(within(row("p3")).getByText("—")).toHaveAttribute("aria-hidden", "true");
		expect(within(row("p3")).queryByRole("img")).toBeNull();

		// imageRefs に記録が無い画像(thumbnail: null)と、参照の形でない値は警告アイコン
		const notFound = "画像が見つかりません(完全に削除されたか、記録がありません)";
		expect(row("p4")).toHaveTextContent(notFound);
		expect(within(row("p4")).getByTitle(notFound).querySelector("svg")).not.toBeNull();
		expect(row("p5")).toHaveTextContent("画像の値が正しくありません");
		expect(
			within(row("p5")).getByTitle("画像の値が正しくありません").querySelector("svg"),
		).not.toBeNull();
		// 値が不正な画像は要求しない
		expect(sentIds()).toEqual([["a1", "b2", "gone"]]);
	});

	it("取得している間は、読み込み中の枠を出す", async () => {
		const response = holdThumbnailsOnce();
		renderList("posts", [makeItem("p1", { cover: ref("a1") })]);
		await waitFor(() => expect(sentIds()).toHaveLength(1));

		expect(screen.getByText("サムネイルを読み込み中")).toHaveClass("sr-only");
		expect(screen.queryByRole("img")).toBeNull();

		response.resolve(thumbnailsResponse(["a1"], { a1: thumb("a1") }));
		expect(await screen.findByRole("img", { name: "画像" })).toBeInTheDocument();
		expect(screen.queryByText("サムネイルを読み込み中")).toBeNull();
	});

	it("ギャラリーは 1 枚目と「+N」(残りの枚数)を表示する", async () => {
		serveThumbnails({ g1: thumb("g1"), h1: thumb("h1") });
		renderList("albums", [
			makeItem("a", { photos: [ref("g1"), ref("g2"), ref("g3")] }),
			makeItem("b", { photos: [ref("h1")] }),
			makeItem("c", { photos: [] }),
		]);
		await screen.findAllByRole("img");

		expect(within(row("a")).getByRole("img")).toHaveAttribute("src", "data:image/webp;base64,g1");
		expect(within(row("a")).getByText("+2")).toHaveAttribute("aria-hidden", "true");
		expect(within(row("a")).getByText("ほか 2 枚")).toHaveClass("sr-only");
		expect(row("b")).not.toHaveTextContent("+");
		expect(row("c")).toHaveTextContent("—画像なし");
		// 1 枚目だけを要求する
		expect(sentIds()).toEqual([["g1", "h1"]]);
	});

	it("単一画像のフィールドがあるコレクションでは、ギャラリーに画像があっても単一画像を表示する", async () => {
		serveThumbnails({ c1: thumb("c1"), g1: thumb("g1") });
		renderList("posts", [
			makeItem("p1", { cover: ref("c1"), gallery: [ref("g1"), ref("g2")] }),
			makeItem("p2", { gallery: [ref("g1")] }),
		]);
		await screen.findByRole("img");

		expect(within(row("p1")).getByRole("img")).toHaveAttribute("src", "data:image/webp;base64,c1");
		expect(row("p1")).not.toHaveTextContent("+");
		expect(row("p2")).toHaveTextContent("—画像なし");
		expect(sentIds()).toEqual([["c1"]]);
	});

	it("このプラグインのフィールドが無いコレクションでは、何も描かず、要求もしない", async () => {
		renderList("pages", [makeItem("x1", { title: "About", cover: ref("a1") })]);
		await waitFor(() => expect(within(row("x1")).getByRole("cell")).toBeEmptyDOMElement());
		await flush();

		expect(within(row("x1")).getByRole("cell")).toBeEmptyDOMElement();
		expect(sentIds()).toEqual([]);
	});

	it("マニフェストを読み込んでいる間は読み込み中の枠、読み込めなければ警告を出す。作り直すと読み直す", async () => {
		const manifest = holdManifest();
		serveThumbnails({ a1: thumb("a1") });
		const items = [makeItem("p1", { cover: ref("a1") })];
		const first = renderList("posts", items);

		expect(await screen.findByText("サムネイルを読み込み中")).toBeInTheDocument();
		manifest.reject(new TypeError("Failed to fetch"));
		expect(await screen.findByText("サムネイルを読み込めませんでした")).toBeInTheDocument();
		expect(sentIds()).toEqual([]);
		first.unmount();

		serveManifest();
		renderList("posts", items);
		expect(await screen.findByRole("img")).toBeInTheDocument();
		expect(manifestRequests()).toBe(2);
	});

	it("一覧が描画し直されても(同じ行なら)要求し直さない", async () => {
		serveThumbnails({ a1: thumb("a1") });
		const { rerenderList } = renderList("posts", [makeItem("p1", { cover: ref("a1") })]);
		await screen.findByRole("img");

		rerenderList();
		rerenderList();
		await flush();
		expect(sentIds()).toHaveLength(1);
	});

	it("次のページは、まだ取得していない画像だけを要求する。戻ったページは要求しない", async () => {
		serveThumbnails({ a1: thumb("a1"), b2: thumb("b2"), c3: thumb("c3") });
		const page1 = [makeItem("p1", { cover: ref("a1") }), makeItem("p2", { cover: ref("b2") })];
		const page2 = [makeItem("p3", { cover: ref("b2") }), makeItem("p4", { cover: ref("c3") })];
		const { rerenderList } = renderList("posts", page1);
		await screen.findAllByRole("img");

		rerenderList(page2);
		await waitFor(() => expect(within(row("p4")).getByRole("img")).toBeInTheDocument());
		rerenderList(page1);
		await flush();

		expect(within(row("p1")).getByRole("img")).toBeInTheDocument();
		expect(sentIds()).toEqual([["a1", "b2"], ["c3"]]);
	});

	it("1 分たった画像は取り直す。取り直している間も前のサムネイルを表示する", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-24T00:00:00.000Z"));
		serveThumbnails({ a1: thumb("a1") });
		const items = [makeItem("p1", { cover: ref("a1") })];
		const first = renderList("posts", items);
		await screen.findByRole("img");
		first.unmount();

		// 1 分たつ前は取り直さない
		vi.setSystemTime(Date.now() + THUMBNAIL_STALE_MS - 1);
		const second = renderList("posts", items);
		await flush();
		expect(sentIds()).toHaveLength(1);
		second.unmount();

		vi.setSystemTime(Date.now() + 1);
		const response = holdThumbnailsOnce();
		renderList("posts", items);
		await flush();
		expect(sentIds()).toHaveLength(2);
		expect(screen.getByRole("img")).toHaveAttribute("src", "data:image/webp;base64,a1");
		expect(screen.queryByText("サムネイルを読み込み中")).toBeNull();

		response.resolve(thumbnailsResponse(["a1"], {}));
		expect(
			await screen.findByText("画像が見つかりません(完全に削除されたか、記録がありません)"),
		).toBeInTheDocument();
	});

	it("取得に失敗したら警告を出し、理由をマウスで見られる。作り直すと取り直す", async () => {
		api.thumbnailsOnce.push(() =>
			jsonResponse({ success: false, error: { code: "INTERNAL_ERROR", message: "boom" } }, 500),
		);
		serveThumbnails({ a1: thumb("a1") });
		const items = [makeItem("p1", { cover: ref("a1") })];
		const first = renderList("posts", items);

		const label = await screen.findByText("サムネイルを読み込めませんでした");
		expect(label).toHaveClass("sr-only");
		expect(label.parentElement).toHaveAttribute(
			"title",
			`サムネイルを読み込めませんでした。${ERROR_MESSAGES.ja.INTERNAL_ERROR}`,
		);
		first.unmount();

		renderList("posts", items);
		expect(await screen.findByRole("img")).toBeInTheDocument();
		expect(sentIds()).toEqual([["a1"], ["a1"]]);
	});

	it("応答に無い画像は、見つからない画像ではなく取得の失敗として扱う", async () => {
		api.thumbnailsOnce.push(() => thumbnailsResponse(["a1"], { a1: thumb("a1") }));
		renderList("posts", [
			makeItem("p1", { cover: ref("a1") }),
			makeItem("p2", { cover: ref("b2") }),
		]);

		expect(
			await within(row("p2")).findByText("サムネイルを読み込めませんでした"),
		).toBeInTheDocument();
		expect(row("p2")).not.toHaveTextContent("画像が見つかりません");
		expect(within(row("p1")).getByRole("img")).toBeInTheDocument();
	});

	it("言語を切り替えると、文言が変わる", async () => {
		const response = holdThumbnailsOnce();
		renderList("albums", [
			makeItem("a", { photos: [ref("g1"), ref("g2")] }),
			makeItem("b", { photos: [] }),
		]);
		// マニフェストを読み込み、サムネイルを取得している間
		await waitFor(() => expect(sentIds()).toHaveLength(1));
		expect(within(row("a")).getByText("サムネイルを読み込み中")).toBeInTheDocument();

		await changeLang("en");
		expect(within(row("a")).getByText("Loading thumbnail")).toBeInTheDocument();
		expect(within(row("a")).getByText("1 more")).toBeInTheDocument();
		expect(row("b")).toHaveTextContent("—No image");

		response.resolve(thumbnailsResponse(["g1"], {}));
		expect(
			await within(row("a")).findByText("Image not found (permanently deleted or not recorded)"),
		).toBeInTheDocument();
	});

	it("使うクラスは、すべて管理画面の CSS にある", async () => {
		serveThumbnails({ a1: thumb("a1"), g1: thumb("g1") });
		// サムネイル・+N・未設定・警告を 1 つの表に出す
		const { container } = render(
			<ListTable
				collection="albums"
				items={[
					makeItem("a", { photos: [ref("g1"), ref("g2")] }),
					makeItem("b", { photos: [] }),
					makeItem("c", { photos: [ref("gone")] }),
					makeItem("d", { photos: [{ id: "x9" }] }),
				]}
			/>,
		);
		await screen.findByRole("img");
		// 読み込み中の枠も
		holdThumbnailsOnce();
		const { container: loadingContainer } = render(
			<ListTable collection="posts" items={[makeItem("p1", { cover: ref("new1") })]} />,
		);
		await screen.findByText("サムネイルを読み込み中");

		const tokens = sourceTokens("src/admin/ThumbnailColumn.tsx");
		for (const root of [container, loadingContainer]) {
			const missing = findMissingClasses(root, tokens);
			expect(missing.fromSource).toEqual([]);
			expect(missing.unknown).toEqual([]);
		}
		expect(container.querySelector(".emdash-media-transparency-grid")).not.toBeNull();
		expect(container.querySelector(".text-kumo-warning")).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// サムネイルの覚え書き
// ---------------------------------------------------------------------------

function makeIds(prefix: string, count: number): string[] {
	return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

describe("requestThumbnails", () => {
	it(`覚えておくのは ${MAX_CACHED_THUMBNAILS} 件まで。古いものから捨て、捨てた画像は取り直す`, async () => {
		const older = makeIds("o", 150);
		const newer = makeIds("n", 100);
		requestThumbnails(older);
		await flush();
		requestThumbnails(newer);
		await flush();
		fetchMock.mockClear();

		// 250 件のうち、古い 50 件が捨てられている
		requestThumbnails(older);
		await flush();
		expect(sentIds()).toEqual([older.slice(0, 50)]);

		// 表示した画像は新しいものとして残る(捨てられたのは newer の古い側)
		fetchMock.mockClear();
		requestThumbnails([...older, ...newer.slice(50)]);
		await flush();
		expect(sentIds()).toEqual([]);
	});

	it("取得中の画像は送らない(まだの画像だけを、応答を待たずに送る)", async () => {
		const response = holdThumbnailsOnce();
		requestThumbnails(["a1", "b2"]);
		requestThumbnails(["b2", "c3"]);
		requestThumbnails(["a1", "c3"]);
		expect(sentIds()).toEqual([["a1", "b2"], ["c3"]]);

		response.resolve(thumbnailsResponse(["a1", "b2"], {}));
		await flush();
		requestThumbnails(["a1", "b2", "c3"]);
		expect(sentIds()).toHaveLength(2);
	});

	it("覚え書きを消す前に始めた要求の結果は、届いても覚えない", async () => {
		const response = holdThumbnailsOnce();
		requestThumbnails(["a1"]);
		clearThumbnailColumnCache();
		response.resolve(thumbnailsResponse(["a1"], { a1: thumb("a1") }));
		await flush();

		serveThumbnails({ a1: thumb("a1") });
		renderList("posts", [makeItem("p1", { cover: ref("a1") })]);
		expect(await screen.findByRole("img")).toBeInTheDocument();
		expect(sentIds()).toEqual([["a1"], ["a1"]]);
	});
});

// ---------------------------------------------------------------------------
// 列の見出し
// ---------------------------------------------------------------------------

describe("thumbnailColumn の label", () => {
	it("管理画面の辞書にある「Image」の ID で、日本語は「画像」、英語は「Image」に訳される", async () => {
		// Lingui のメッセージ ID(`@lingui/message-utils` の generateMessageId と同じ計算)
		const linguiId = createHash("sha256").update("Image\u001F").digest("base64").slice(0, 6);
		expect(thumbnailColumn.label).toBe(linguiId);
		expect(THUMBNAIL_COLUMN_LABEL).toBe(linguiId);

		// インストールされた @emdash-cms/admin のビルド済みの辞書
		const require = createRequire(import.meta.url);
		const catalog = async (locale: string) =>
			(
				(await import(
					pathToFileURL(require.resolve(`@emdash-cms/admin/locales/${locale}/messages.mjs`)).href
				)) as { messages: Record<string, unknown> }
			).messages;
		expect((await catalog("ja"))[thumbnailColumn.label]).toEqual(["画像"]);
		expect((await catalog("en"))[thumbnailColumn.label]).toEqual(["Image"]);
	});
});
