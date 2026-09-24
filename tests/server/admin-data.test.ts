import type { ContentAccess, RouteContext, StorageCollection } from "emdash";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { IMAGE_REFS_BATCH_SIZE } from "../../src/server/image-refs";
import {
	PREVIEW_MAX_BODY_BYTES,
	THUMBNAILS_MAX_BODY_BYTES,
	handlePreview,
	handleThumbnails,
	previewRoute,
	thumbnailsRoute,
	type PreviewRouteContext,
	type ThumbnailsRouteContext,
} from "../../src/server/routes/admin-data";
import { PREVIEW_MAX_IDS, THUMBNAILS_MAX_IDS } from "../../src/shared/constants";
import {
	entryIdSchema,
	previewRequestSchema,
	previewResponseSchema,
	thumbnailsRequestSchema,
	thumbnailsResponseSchema,
} from "../../src/shared/schema";
import type { PreviewRequest, ThumbnailsRequest } from "../../src/shared/types";

/** プラグインの `ctx.content.get` が返すエントリ */
type PluginContentItem = NonNullable<Awaited<ReturnType<ContentAccess["get"]>>>;
type GetMany = StorageCollection["getMany"];
type Warn = (message: string, data?: unknown) => void;

// 値の形だけを確かめるので、data URL の中身は本物の WebP でなくてよい(接頭辞は確かめる)。
const WEBP_DATA_URL = "data:image/webp;base64,UklGRhYAAABXRUJQ";
const THUMB_DATA_URL = "data:image/webp;base64,UklGRhYAAABXRUJQVlA4";
/** D1 のバインド変数の上限(1 クエリ) */
const D1_MAX_BINDINGS = 100;
/** `imageRefs` の `getMany` が、ID のほかに使うバインド変数(`plugin_id`・`collection`) */
const GET_MANY_BINDINGS_BESIDES_IDS = 2;
/** body の上限に足す余裕(バイト) */
const BODY_MARGIN_BYTES = 1_024;
/** `entryIdSchema` が受け付ける ID の最大の長さ */
const ENTRY_ID_MAX_LENGTH = 128;

function imageId(n: number): string {
	return `01J8Z3K4M5N6P7Q8R9S0${String(n).padStart(6, "0")}`;
}

function range(count: number): number[] {
	return Array.from({ length: count }, (_, i) => i + 1);
}

function imageValue(overrides: Record<string, unknown> = {}) {
	return {
		src: WEBP_DATA_URL,
		mimeType: "image/webp",
		width: 1280,
		height: 853,
		filename: "IMG_0001.jpg",
		meta: { v: 1, bytes: 17, quality: 0.77 },
		...overrides,
	};
}

/**
 * `ctx.content.get("b64_images", id)` が返すエントリ(プラグインのルートで作って公開したもの)。
 * `data` には、値が null でない列だけが入る(`references/emdash/packages/core/src/database/repositories/content.ts:2748`)。
 */
function contentItem(id: string, overrides: Partial<PluginContentItem> = {}): PluginContentItem {
	return {
		id,
		type: "b64_images",
		slug: null,
		status: "published",
		locale: "en",
		data: { image: imageValue() },
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:01.000Z",
		publishedAt: "2026-09-24T00:00:01.000Z",
		scheduledAt: null,
		authorId: null,
		translationGroup: id,
		liveRevisionId: "01J8Z3K4M5N6P7Q8R9S0REV001",
		draftRevisionId: null,
		version: 2,
		...overrides,
	};
}

/** `ctx.content.get` の偽物。`b64_images` 以外のコレクションでは何も見つからない */
function fakeGet(items: readonly PluginContentItem[]) {
	const byId = new Map(items.map((item) => [item.id, item]));
	return vi.fn<ContentAccess["get"]>(async (collection, id) =>
		collection === "b64_images" ? (byId.get(id) ?? null) : null,
	);
}

function previewContext(ids: string[], get: ContentAccess["get"]) {
	const warn = vi.fn<Warn>();
	const ctx: PreviewRouteContext = { input: { ids }, content: { get }, log: { warn } };
	return { ctx, warn };
}

/** `imageRefs` の記録(仕様書 5.3) */
function refsRecord(overrides: Record<string, unknown> = {}) {
	return {
		owners: [
			{ collection: "posts", entryId: "01J8Z3K4M5N6P7Q8R9S0POST01", locale: "en", field: "cover" },
		],
		bytes: 17,
		width: 1280,
		height: 853,
		thumb: THUMB_DATA_URL,
		createdAt: "2026-09-24T00:00:00.000Z",
		createdBy: "01J8Z3K4M5N6P7Q8R9S0USER01",
		...overrides,
	};
}

/**
 * `ctx.storage.imageRefs.getMany` の偽物。
 * - D1 と同じく、バインド変数が 100 個を超えるクエリ(ID が 99 件以上)は失敗する。
 * - 返す Map の順番は要求の順ではない(データベースの行の順。ここでは逆順にする)。
 */
function fakeGetMany(records: ReadonlyMap<string, unknown>) {
	return vi.fn<GetMany>(async (ids) => {
		if (ids.length + GET_MANY_BINDINGS_BESIDES_IDS > D1_MAX_BINDINGS) {
			throw new Error("D1_ERROR: too many SQL variables");
		}
		const found = new Map<string, unknown>();
		for (const id of ids.toReversed()) {
			if (records.has(id)) found.set(id, structuredClone(records.get(id)));
		}
		return found;
	});
}

function thumbnailsContext(ids: string[], getMany: GetMany) {
	const warn = vi.fn<Warn>();
	const ctx: ThumbnailsRouteContext = {
		input: { ids },
		storage: { imageRefs: { getMany } },
		log: { warn },
	};
	return { ctx, warn };
}

/** 最大の長さの ID を `count` 件並べた `{"ids":[…]}`(画面は `JSON.stringify` で送る) */
function longestIdsBody(count: number, space?: string | number): string {
	const ids = range(count).map((n) => String(n).padStart(ENTRY_ID_MAX_LENGTH, "0"));
	return JSON.stringify({ ids }, null, space);
}

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

describe("ルートの宣言", () => {
	it.each([
		["preview", previewRoute, previewRequestSchema, PREVIEW_MAX_BODY_BYTES, handlePreview],
		[
			"thumbnails",
			thumbnailsRoute,
			thumbnailsRequestSchema,
			THUMBNAILS_MAX_BODY_BYTES,
			handleThumbnails,
		],
	] as const)(
		"%s: content:read・POST・JSON の body・入力のスキーマを宣言する",
		(_name, route, schema, maxBytes, handler) => {
			expect(route.permission).toBe("content:read");
			expect(route.methods).toStrictEqual(["POST"]);
			expect(route.request).toStrictEqual({ body: "json", maxBytes });
			expect(route.input).toBe(schema);
			expect(route.handler).toBe(handler);
			expect(route.public).toBeUndefined();
		},
	);

	it("EmDash がルートに渡す ctx を、ハンドラーの ctx として受け取れる", () => {
		expectTypeOf<RouteContext<PreviewRequest>>().toExtend<PreviewRouteContext>();
		expectTypeOf<RouteContext<ThumbnailsRequest>>().toExtend<ThumbnailsRouteContext>();
	});
});

describe("body の上限(ID の最大数から計算する)", () => {
	it("ID の最大の長さは 128 文字(entryIdSchema)", () => {
		expect(entryIdSchema.safeParse("0".repeat(ENTRY_ID_MAX_LENGTH)).success).toBe(true);
		expect(entryIdSchema.safeParse("0".repeat(ENTRY_ID_MAX_LENGTH + 1)).success).toBe(false);
	});

	it.each([
		["preview", previewRoute, previewRequestSchema, PREVIEW_MAX_IDS],
		["thumbnails", thumbnailsRoute, thumbnailsRequestSchema, THUMBNAILS_MAX_IDS],
	] as const)(
		"%s: 最大の入力の body が上限に収まり、上限は最大の body + 1 KiB",
		(_name, route, schema, maxIds) => {
			const longest = longestIdsBody(maxIds);
			expect(schema.safeParse(JSON.parse(longest)).success).toBe(true);
			// ID が 1 件多いと、入力のスキーマで拒否される(上限の計算に使った件数とスキーマが揃っている)
			expect(schema.safeParse(JSON.parse(longestIdsBody(maxIds + 1))).success).toBe(false);

			const maxBytes = route.request?.maxBytes;
			expect(maxBytes).toBe(byteLength(longest) + BODY_MARGIN_BYTES);
			// 空白や改行を入れた JSON(2 文字の字下げ・タブ)も収まる
			expect(byteLength(longestIdsBody(maxIds, 2))).toBeLessThanOrEqual(maxBytes ?? 0);
			expect(byteLength(longestIdsBody(maxIds, "\t"))).toBeLessThanOrEqual(maxBytes ?? 0);
		},
	);

	it("上限の値(プレビュー 10 件で 2,343 バイト、サムネイル 100 件で 14,133 バイト)", () => {
		expect(PREVIEW_MAX_IDS).toBe(10);
		expect(PREVIEW_MAX_BODY_BYTES).toBe(2_343);
		expect(THUMBNAILS_MAX_IDS).toBe(100);
		expect(THUMBNAILS_MAX_BODY_BYTES).toBe(14_133);
	});
});

describe("handlePreview", () => {
	it("見つかった画像は、保存された値をそのまま返す", async () => {
		const id = imageId(1);
		const get = fakeGet([contentItem(id)]);
		const { ctx, warn } = previewContext([id], get);

		const response = await handlePreview(ctx);

		expect(response).toStrictEqual({ items: [{ id, image: imageValue() }] });
		expect(get.mock.calls).toStrictEqual([["b64_images", id]]);
		expect(warn).not.toHaveBeenCalled();
	});

	it("items は要求の順で、重複を除く。get は同じ ID に 1 回だけ呼ぶ", async () => {
		const [a, b, c] = [imageId(1), imageId(2), imageId(3)];
		const get = fakeGet([contentItem(a), contentItem(b), contentItem(c)]);
		const { ctx } = previewContext([c, a, c, b, a], get);

		const response = await handlePreview(ctx);

		expect(response.items.map((item) => item.id)).toStrictEqual([c, a, b]);
		expect(get.mock.calls.map(([, id]) => id)).toStrictEqual([c, a, b]);
	});

	it("ゴミ箱に入った画像・無い画像(get が null)は image を null にし、警告は出さない", async () => {
		const [found, gone] = [imageId(1), imageId(2)];
		const get = fakeGet([contentItem(found)]);
		const { ctx, warn } = previewContext([gone, found], get);

		const response = await handlePreview(ctx);

		expect(response.items).toStrictEqual([
			{ id: gone, image: null },
			{ id: found, image: imageValue() },
		]);
		expect(warn).not.toHaveBeenCalled();
	});

	it("公開していない画像(サイトに表示されない)は null にし、警告を出す", async () => {
		const [draft, published] = [imageId(1), imageId(2)];
		const get = fakeGet([
			contentItem(draft, { status: "draft", publishedAt: null, liveRevisionId: null }),
			contentItem(published),
		]);
		const { ctx, warn } = previewContext([draft, published], get);

		const response = await handlePreview(ctx);

		expect(response.items).toStrictEqual([
			{ id: draft, image: null },
			{ id: published, image: imageValue() },
		]);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain("not published");
		expect(warn.mock.calls[0]?.[0]).toContain(draft);
		expect(warn.mock.calls[0]?.[0]).not.toContain(published);
	});

	it.each([
		["image フィールドが無い", {}],
		["値が文字列", { image: "data:image/webp;base64,UklGRhYAAABXRUJQ" }],
		["寸法が 0", { image: imageValue({ width: 0 }) }],
		["知らないキーがある", { image: imageValue({ id: "01J8Z3K4M5N6P7Q8R9S0000001" }) }],
		["mimeType が WebP でない", { image: imageValue({ mimeType: "image/png" }) }],
		[
			"src が PNG の data URL",
			{ image: imageValue({ src: "data:image/png;base64,iVBORw0KGgo=" }) },
		],
		["src が外部の URL", { image: imageValue({ src: "https://example.com/a.webp" }) }],
		[
			"src が固定上限(500,000)を超える",
			{ image: imageValue({ src: `${WEBP_DATA_URL}${"A".repeat(500_000)}` }) },
		],
	])("値が不正(%s)なら null にし、警告を出す", async (_case, data) => {
		const [bad, good] = [imageId(1), imageId(2)];
		const get = fakeGet([contentItem(bad, { data }), contentItem(good)]);
		const { ctx, warn } = previewContext([bad, good], get);

		const response = await handlePreview(ctx);

		expect(response.items).toStrictEqual([
			{ id: bad, image: null },
			{ id: good, image: imageValue() },
		]);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain("invalid value");
		expect(warn.mock.calls[0]?.[0]).toContain(bad);
	});

	it("固定上限ちょうど(500,000 文字)の src は返す", async () => {
		const id = imageId(1);
		const src = `${WEBP_DATA_URL}${"A".repeat(500_000 - WEBP_DATA_URL.length)}`;
		const get = fakeGet([contentItem(id, { data: { image: imageValue({ src }) } })]);
		const { ctx } = previewContext([id], get);

		const response = await handlePreview(ctx);

		expect(response.items[0]?.image?.src).toHaveLength(500_000);
	});

	it("get を並行に呼ぶ(1 件ずつ応答を待たない)", async () => {
		const ids = range(PREVIEW_MAX_IDS).map(imageId);
		const pending: (() => void)[] = [];
		const get = vi.fn<ContentAccess["get"]>(
			(_collection, id) => new Promise((resolve) => pending.push(() => resolve(contentItem(id)))),
		);
		const { ctx } = previewContext(ids, get);

		const result = handlePreview(ctx);
		// どの get もまだ応答していないうちに、すべての ID の get が呼ばれている
		expect(get).toHaveBeenCalledTimes(PREVIEW_MAX_IDS);
		for (const resolve of pending) resolve();

		expect((await result).items.map((item) => item.id)).toStrictEqual(ids);
	});

	it("取得に失敗したら、null にせずに失敗を投げる", async () => {
		const [ok, broken] = [imageId(1), imageId(2)];
		const failure = new Error("D1_ERROR: network connection lost");
		const get = vi.fn<ContentAccess["get"]>(async (_collection, id) => {
			if (id === broken) throw failure;
			return contentItem(id);
		});
		const { ctx } = previewContext([ok, broken], get);

		await expect(handlePreview(ctx)).rejects.toBe(failure);
	});

	it("ctx.content が無い(capability content:read を宣言していない)なら失敗する", async () => {
		const ctx: PreviewRouteContext = { input: { ids: [imageId(1)] }, log: { warn: vi.fn<Warn>() } };

		await expect(handlePreview(ctx)).rejects.toThrow("content:read");
	});

	it("応答は、JSON にしてもスキーマ(previewResponseSchema)に合う", async () => {
		const ids = range(PREVIEW_MAX_IDS).map(imageId);
		const get = fakeGet(ids.slice(0, 7).map((id) => contentItem(id)));
		const { ctx } = previewContext(ids, get);

		const response = await handlePreview(ctx);

		expect(previewResponseSchema.parse(JSON.parse(JSON.stringify(response)))).toStrictEqual(
			response,
		);
		expect(response.items.filter((item) => item.image === null)).toHaveLength(3);
	});
});

describe("handleThumbnails", () => {
	it("imageRefs のサムネイルと本体の寸法だけを返す(参照元などは返さない)", async () => {
		const id = imageId(1);
		const getMany = fakeGetMany(new Map([[id, refsRecord()]]));
		const { ctx, warn } = thumbnailsContext([id], getMany);

		const response = await handleThumbnails(ctx);

		expect(response).toStrictEqual({
			items: [{ id, thumbnail: { thumb: THUMB_DATA_URL, width: 1280, height: 853 } }],
		});
		expect(getMany.mock.calls).toStrictEqual([[[id]]]);
		expect(warn).not.toHaveBeenCalled();
	});

	it("items は要求の順で、重複を除く(getMany が返す順番に左右されない)", async () => {
		const [a, b, c] = [imageId(1), imageId(2), imageId(3)];
		const getMany = fakeGetMany(
			new Map([
				[a, refsRecord({ width: 1 })],
				[b, refsRecord({ width: 2 })],
				[c, refsRecord({ width: 3 })],
			]),
		);
		const { ctx } = thumbnailsContext([b, c, b, a, c], getMany);

		const response = await handleThumbnails(ctx);

		expect(response.items.map((item) => [item.id, item.thumbnail?.width])).toStrictEqual([
			[b, 2],
			[c, 3],
			[a, 1],
		]);
		expect(getMany.mock.calls).toStrictEqual([[[b, c, a]]]);
	});

	it("imageRefs に無い画像は thumbnail を null にし、警告は出さない", async () => {
		const [found, gone] = [imageId(1), imageId(2)];
		const getMany = fakeGetMany(new Map([[found, refsRecord()]]));
		const { ctx, warn } = thumbnailsContext([gone, found], getMany);

		const response = await handleThumbnails(ctx);

		expect(response.items.map((item) => [item.id, item.thumbnail === null])).toStrictEqual([
			[gone, true],
			[found, false],
		]);
		expect(warn).not.toHaveBeenCalled();
	});

	it.each([
		["記録が null", null],
		["記録が文字列", "thumb"],
		["thumb が無い", refsRecord({ thumb: undefined })],
		[
			"thumb が WebP の data URL でない",
			refsRecord({ thumb: "data:image/png;base64,iVBORw0KGgo=" }),
		],
		["thumb が上限(8,000)を超える", refsRecord({ thumb: `${THUMB_DATA_URL}${"A".repeat(8_000)}` })],
		["寸法が 0", refsRecord({ height: 0 })],
		["寸法が文字列", refsRecord({ width: "1280" })],
	])("記録が不正(%s)なら null にし、警告を出す", async (_case, record) => {
		const [bad, good] = [imageId(1), imageId(2)];
		const getMany = fakeGetMany(
			new Map<string, unknown>([
				[bad, record],
				[good, refsRecord()],
			]),
		);
		const { ctx, warn } = thumbnailsContext([bad, good], getMany);

		const response = await handleThumbnails(ctx);

		expect(response.items).toStrictEqual([
			{ id: bad, thumbnail: null },
			{ id: good, thumbnail: { thumb: THUMB_DATA_URL, width: 1280, height: 853 } },
		]);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain(bad);
		expect(warn.mock.calls[0]?.[0]).not.toContain(good);
	});

	it("参照元の値が不正でも、サムネイルは返す(使わない項目は確かめない)", async () => {
		const id = imageId(1);
		const getMany = fakeGetMany(new Map([[id, refsRecord({ owners: "broken", createdAt: 0 })]]));
		const { ctx, warn } = thumbnailsContext([id], getMany);

		const response = await handleThumbnails(ctx);

		expect(response.items[0]?.thumbnail).toStrictEqual({
			thumb: THUMB_DATA_URL,
			width: 1280,
			height: 853,
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it.each([
		[1, [1]],
		[50, [50]],
		[51, [50, 1]],
		[100, [50, 50]],
	])("ID %i 件は、getMany を %j 件ずつに分けて呼ぶ", async (count, sizes) => {
		const ids = range(count).map(imageId);
		const getMany = fakeGetMany(new Map(ids.map((id) => [id, refsRecord()])));
		const { ctx } = thumbnailsContext(ids, getMany);

		const response = await handleThumbnails(ctx);

		expect(getMany.mock.calls.map(([part]) => part.length)).toStrictEqual(sizes);
		expect(getMany.mock.calls.flatMap(([part]) => part)).toStrictEqual(ids);
		expect(response.items.every((item) => item.thumbnail !== null)).toBe(true);
	});

	it("1 回の getMany のバインド変数は、D1 の上限(100 個)に収まる", async () => {
		expect(IMAGE_REFS_BATCH_SIZE + GET_MANY_BINDINGS_BESIDES_IDS).toBeLessThanOrEqual(
			D1_MAX_BINDINGS,
		);
		// 偽物の getMany は、上限を超えると D1 と同じく失敗する
		const ids = range(THUMBNAILS_MAX_IDS).map(imageId);
		const getMany = fakeGetMany(new Map(ids.map((id) => [id, refsRecord()])));
		await expect(getMany(ids)).rejects.toThrow("too many SQL variables");
		getMany.mockClear();

		const { ctx } = thumbnailsContext(ids, getMany);
		const response = await handleThumbnails(ctx);

		expect(response.items).toHaveLength(THUMBNAILS_MAX_IDS);
		for (const [part] of getMany.mock.calls) {
			expect(part.length + GET_MANY_BINDINGS_BESIDES_IDS).toBeLessThanOrEqual(D1_MAX_BINDINGS);
		}
	});

	it("重複を除いた件数で分ける(重複を含めて 60 件、重複を除いて 50 件なら 1 回)", async () => {
		const unique = range(50).map(imageId);
		const ids = [...unique, ...unique.slice(0, 10)];
		const getMany = fakeGetMany(new Map(unique.map((id) => [id, refsRecord()])));
		const { ctx } = thumbnailsContext(ids, getMany);

		const response = await handleThumbnails(ctx);

		expect(getMany).toHaveBeenCalledTimes(1);
		expect(response.items.map((item) => item.id)).toStrictEqual(unique);
	});

	it("getMany を並行に呼ぶ", async () => {
		const ids = range(THUMBNAILS_MAX_IDS).map(imageId);
		const pending: (() => void)[] = [];
		const getMany = vi.fn<GetMany>(
			(part) =>
				new Promise((resolve) =>
					pending.push(() => resolve(new Map(part.map((id) => [id, refsRecord()])))),
				),
		);
		const { ctx } = thumbnailsContext(ids, getMany);

		const result = handleThumbnails(ctx);
		expect(getMany).toHaveBeenCalledTimes(2);
		for (const resolve of pending) resolve();

		expect((await result).items).toHaveLength(THUMBNAILS_MAX_IDS);
	});

	it("取得に失敗したら、失敗を投げる", async () => {
		const failure = new Error("D1_ERROR: network connection lost");
		const getMany = vi.fn<GetMany>(async () => {
			throw failure;
		});
		const { ctx } = thumbnailsContext([imageId(1)], getMany);

		await expect(handleThumbnails(ctx)).rejects.toBe(failure);
	});

	it("ctx.storage.imageRefs が無い(ストレージを宣言していない)なら失敗する", async () => {
		const ctx: ThumbnailsRouteContext = {
			input: { ids: [imageId(1)] },
			storage: {},
			log: { warn: vi.fn<Warn>() },
		};

		await expect(handleThumbnails(ctx)).rejects.toThrow("imageRefs");
	});

	it("応答は、JSON にしてもスキーマ(thumbnailsResponseSchema)に合う", async () => {
		const ids = range(THUMBNAILS_MAX_IDS).map(imageId);
		const getMany = fakeGetMany(new Map(ids.slice(0, 80).map((id) => [id, refsRecord()])));
		const { ctx } = thumbnailsContext(ids, getMany);

		const response = await handleThumbnails(ctx);

		expect(thumbnailsResponseSchema.parse(JSON.parse(JSON.stringify(response)))).toStrictEqual(
			response,
		);
		expect(response.items.filter((item) => item.thumbnail === null)).toHaveLength(20);
	});
});
