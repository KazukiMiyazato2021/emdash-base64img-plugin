// 管理画面の入口(src/admin.tsx。T30)のテスト。
// - EmDash の管理画面は、入口の `fields`・`pages`・`contentListColumns` を読む(`@emdash-cms/admin` の `PluginAdminModule`)。
//   中身が部品のモジュールの export そのものであることと、キーがサーバー側の宣言(`WIDGET_KINDS`・`IMAGES_PAGE`・
//   `createPlugin()` の `admin`)と合うことを確かめる。
// - 入口は、読み込み時に一覧の列のマニフェストを取り始める(T24)。`fetch` を差し替えてから、テストごとに読み込み直す
//   (`vi.resetModules()`。部品のモジュールも読み込み直されるので、入口が読み込んだものと比べる)。
// - `@emdash-cms/admin` は読み込むと重い(jsdom で数秒)ので、画像管理ページが実行時に使う `useCurrentUser` だけのモックにする。
//   管理画面がページを探す `usePluginPage` だけは、本物を `vi.importActual` で読む。

import type * as EmDashAdmin from "@emdash-cms/admin";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlugin } from "../../src/index";
import { IMAGES_PAGE, PLUGIN_ID, WIDGET_IDS, WIDGET_KINDS } from "../../src/shared/constants";

vi.mock("@emdash-cms/admin", () => ({ useCurrentUser: vi.fn<() => unknown>() }));

// このファイルのテストは、入口と部品のモジュールを読み込み直し(最初の 1 回は約 2 秒)、本物の `@emdash-cms/admin` も読む
// (約 2.5 秒)。ほかの作業で負荷の高いマシン(負荷平均が約 20)では、既定の 5 秒を超えて失敗したことがある(T30-2)。
vi.setConfig({ testTimeout: 30_000 });

// ---------------------------------------------------------------------------
// 共通の道具
// ---------------------------------------------------------------------------

const MANIFEST_URL = "/_emdash/api/manifest";

/** 管理画面のマニフェスト(posts にはこのプラグインのフィールドがあり、pages には無い) */
const MANIFEST = {
	collections: {
		posts: {
			fields: {
				title: { kind: "string" },
				cover: { kind: "json", widget: "base64-image:image" },
				gallery: { kind: "json", widget: "base64-image:gallery" },
			},
		},
		pages: { fields: { title: { kind: "string" } } },
	},
};

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** マニフェストの要求(`GET /_emdash/api/manifest`) */
function manifestRequests() {
	return fetchMock.mock.calls.filter(([input]) => String(input) === MANIFEST_URL);
}

/** Promise の続き(マニフェストの応答の処理)を済ませる */
async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 入口を読み込み直す(読み込み時の先読みがもう一度走る)。部品は、入口が読み込んだものと同じモジュールを返す。
 * `@emdash-cms/admin` のモックは `vi.resetModules()` のあとも残る。
 */
async function loadEntry() {
	vi.resetModules();
	const entry = await import("../../src/admin");
	const [{ ImageField }, { GalleryField }, { ImagesPage }, column] = await Promise.all([
		import("../../src/admin/ImageField"),
		import("../../src/admin/GalleryField"),
		import("../../src/admin/ImagesPage"),
		import("../../src/admin/ThumbnailColumn"),
	]);
	return { entry, ImageField, GalleryField, ImagesPage, column };
}

/** 入口の一覧の列(1 つだけ) */
function onlyColumn(entry: Awaited<ReturnType<typeof loadEntry>>["entry"]) {
	const [column] = entry.contentListColumns;
	if (column === undefined) throw new Error("contentListColumns is empty");
	return column;
}

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockImplementation(async (input) => {
		if (String(input) === MANIFEST_URL) return json({ success: true, data: MANIFEST });
		throw new Error(`unexpected request: ${String(input)}`);
	});
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// export の中身
// ---------------------------------------------------------------------------

describe("export の中身", () => {
	it("export は fields・pages・contentListColumns の 3 つだけ(管理画面が読むほかの名前は無い)", async () => {
		const { entry } = await loadEntry();

		expect(Object.keys(entry).toSorted()).toEqual(["contentListColumns", "fields", "pages"]);
	});

	it("fields のキーは WIDGET_KINDS の名前で、単一画像とギャラリーの widget をそのまま入れる", async () => {
		const { entry, ImageField, GalleryField } = await loadEntry();

		expect(Object.keys(entry.fields).toSorted()).toEqual([...WIDGET_KINDS].toSorted());
		expect(entry.fields.image).toBe(ImageField);
		expect(entry.fields.gallery).toBe(GalleryField);
	});

	it("フィールドの widget(WIDGET_IDS)を、管理画面と同じく最初の : で分けて探すと、その widget の関数が見つかる", async () => {
		const { entry, ImageField, GalleryField } = await loadEntry();
		// 管理画面は `pluginAdmins[<: の前>]?.fields?.[<: の後ろ>]` が関数のときだけ描き、そうでなければ標準の入力に落ちる
		// (`references/emdash/packages/admin/src/components/ContentEditor.tsx:1806-1830`)
		const pluginAdmins: Readonly<Record<string, { readonly fields?: Record<string, unknown> }>> = {
			[PLUGIN_ID]: entry,
		};
		const expected = { image: ImageField, gallery: GalleryField };

		for (const kind of WIDGET_KINDS) {
			const widget: string = WIDGET_IDS[kind];
			const separator = widget.indexOf(":");
			const found = pluginAdmins[widget.slice(0, separator)]?.fields?.[widget.slice(separator + 1)];
			expect(typeof found).toBe("function");
			expect(found).toBe(expected[kind]);
		}
	});

	it("pages のキーは IMAGES_PAGE.path だけで、画像管理ページをそのまま入れる", async () => {
		const { entry, ImagesPage } = await loadEntry();

		expect(Object.keys(entry.pages)).toEqual([IMAGES_PAGE.path]);
		expect(entry.pages[IMAGES_PAGE.path]).toBe(ImagesPage);
	});

	it("contentListColumns は一覧の列(thumbnailColumn)1 つだけで、項目を上書きしない", async () => {
		const { entry, column } = await loadEntry();

		expect(entry.contentListColumns).toHaveLength(1);
		expect(onlyColumn(entry)).toBe(column.thumbnailColumn);
		// 見出しは管理画面の辞書の ID のまま(文字列にすると訳されない。T24)
		expect(onlyColumn(entry).label).toBe(column.THUMBNAIL_COLUMN_LABEL);
	});
});

// ---------------------------------------------------------------------------
// サーバー側の宣言との対応
// ---------------------------------------------------------------------------

describe("サーバー側の宣言(createPlugin() の admin)との対応", () => {
	it("admin.fieldWidgets(マニフェストに載る widget)の名前と、fields のキーが 1 対 1", async () => {
		const { entry } = await loadEntry();
		const widgets = createPlugin().admin.fieldWidgets ?? [];

		expect(widgets.map((widget) => widget.name).toSorted()).toEqual(
			Object.keys(entry.fields).toSorted(),
		);
	});

	it("admin.pages(サイドバー・コマンドパレットの項目)のパスごとに、pages に部品がある", async () => {
		const { entry } = await loadEntry();
		const pages = createPlugin().admin.pages ?? [];

		// サイドバーは、入口の `pages` に部品のあるページだけを出す(`references/emdash/packages/admin/src/components/Sidebar.tsx:488-505`)
		expect(pages.map((page) => page.path)).toEqual(Object.keys(entry.pages));
	});
});

// ---------------------------------------------------------------------------
// 管理画面がページを探す(本物の usePluginPage)
// ---------------------------------------------------------------------------

describe("管理画面がページを探す(@emdash-cms/admin の本物の usePluginPage)", () => {
	it("サイドバーのリンク(/images)・末尾の /・プラグインの管理画面の「Plugin pages」(/)で画像管理ページが見つかり、無いパスは見つからない", async () => {
		const { entry, ImagesPage } = await loadEntry();
		const admin = await vi.importActual<typeof EmDashAdmin>("@emdash-cms/admin");
		const found = new Map<string, unknown>();
		// ページの URL `/_emdash/admin/plugins/<ID>/<残り>` の「/ + 残り」で探す(`references/emdash/packages/admin/src/router.tsx:2733-2747`)。
		// プラグインの管理画面の「Plugin pages」は `/plugins/<ID>` を開く(残りは空で、「/」で探す。`references/emdash/packages/admin/src/components/PluginManager.tsx:525-534`)
		const paths = [IMAGES_PAGE.path, `${IMAGES_PAGE.path}/`, "/", "/missing"];
		function Probe({ path }: { readonly path: string }) {
			found.set(path, admin.usePluginPage(PLUGIN_ID, path));
			return null;
		}

		render(
			<admin.PluginAdminProvider pluginAdmins={{ [PLUGIN_ID]: { pages: entry.pages } }}>
				{paths.map((path) => (
					<Probe key={path} path={path} />
				))}
			</admin.PluginAdminProvider>,
		);

		expect(found.get(IMAGES_PAGE.path)).toBe(ImagesPage);
		expect(found.get(`${IMAGES_PAGE.path}/`)).toBe(ImagesPage);
		expect(found.get("/")).toBe(ImagesPage);
		// 部品が無いと、管理画面は Block Kit のページとして扱い、404「Plugin route not found」になる(T29 の実測)
		expect(found.get("/missing")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 読み込み時の先読み(一覧の列のマニフェスト)
// ---------------------------------------------------------------------------

describe("読み込み時の先読み(一覧の列のマニフェスト)", () => {
	it("読み込んだだけで(一覧の列を使う前に)、GET /_emdash/api/manifest を CSRF のヘッダー付きで 1 回送る", async () => {
		await loadEntry();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [[input, init] = []] = manifestRequests();
		expect(String(input)).toBe(MANIFEST_URL);
		expect(init?.method ?? "GET").toBe("GET");
		expect(new Headers(init?.headers).get("X-EmDash-Request")).toBe("1");
	});

	it("先読みの結果が届いてから開いた一覧は、最初の判定から、フィールドの無いコレクションに列を出さない(要求は増えない)", async () => {
		const { entry } = await loadEntry();
		await flush();

		expect(onlyColumn(entry).collections("pages")).toBe(false);
		expect(onlyColumn(entry).collections("posts")).toBe(true);
		expect(manifestRequests()).toHaveLength(1);
	});

	it("比べるため: 入口を通さずに列だけを読み込むと、最初の判定は true(空の列が出る)で、そこで取得を始める", async () => {
		vi.resetModules();
		const { thumbnailColumn } = await import("../../src/admin/ThumbnailColumn");
		await flush();
		expect(manifestRequests()).toHaveLength(0);

		expect(thumbnailColumn.collections("pages")).toBe(true);
		expect(manifestRequests()).toHaveLength(1);
		await flush();
		expect(thumbnailColumn.collections("pages")).toBe(false);
	});

	it("先読みが失敗しても(ログイン画面の 401)、入口の読み込みは失敗しない。次の判定で列を出し、取り直す", async () => {
		fetchMock.mockImplementation(async () =>
			json({ success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, 401),
		);
		const { entry } = await loadEntry();
		await flush();
		expect(manifestRequests()).toHaveLength(1);

		fetchMock.mockImplementation(async () => json({ success: true, data: MANIFEST }));
		// 取り直している間は、列を出す(フィールドのあるコレクションで列が出ないまま残るのを避ける。T24)
		expect(onlyColumn(entry).collections("pages")).toBe(true);
		expect(manifestRequests()).toHaveLength(2);
		await flush();
		expect(onlyColumn(entry).collections("pages")).toBe(false);
	});
});
