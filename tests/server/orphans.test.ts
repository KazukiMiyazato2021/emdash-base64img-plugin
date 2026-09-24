import {
	PluginRouteError,
	createHookPipeline,
	definePlugin,
	type ContentDeleteEvent,
	type HookPipeline,
	type PluginContext,
	type PluginHooks,
	type RouteContext,
	type StorageCollection,
} from "emdash";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
	IMAGE_DELETED_HOOK_PRIORITY,
	imageDeletedHooks,
	removeImageRefs,
	removeImageRefsAfterDelete,
	type ImageDeletedContext,
	type ImageRefsRemover,
} from "../../src/server/hooks/image-deleted";
import {
	IMAGES_LIST_CURSOR_MAX_LENGTH,
	IMAGES_LIST_MAX_ITEMS,
	IMAGES_LIST_MAX_OWNERS,
	IMAGES_LIST_QUERY_BUDGET,
	LIST_QUERY_COSTS,
	decodeImagesListCursor,
	encodeImagesListCursor,
	listImagesPage,
	type ImageRefsPageStore,
	type ImageRefsQueryOptions,
	type ImagesListCursor,
} from "../../src/server/orphans";
import {
	IMAGES_LIST_MAX_BODY_BYTES,
	IMAGES_TRASH_MAX_BODY_BYTES,
	handleImagesList,
	handleImagesTrash,
	imagesListRoute,
	imagesTrashRoute,
	type ImageRefsExistence,
	type ImagesListRouteContext,
	type ImagesTrashRouteContext,
} from "../../src/server/routes/images-admin";
import { ROUTE_PERMISSIONS } from "../../src/shared/constants";
import {
	entryIdSchema,
	imagesListRequestSchema,
	imagesListResponseSchema,
	imagesTrashRequestSchema,
	imagesTrashResponseSchema,
} from "../../src/shared/schema";
import type {
	Base64ImageRef,
	ImageListItem,
	ImageOwner,
	ImagesListRequest,
	ImagesListResponse,
	ImagesTrashRequest,
} from "../../src/shared/types";

// ---------------------------------------------------------------------------
// 偽の EmDash(クエリ数は docs/emdash-plugin-content-query-counts.md の SQLite の実測に合わせる)
// ---------------------------------------------------------------------------

const B64 = "b64_images";
const THUMB = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4";
const BASE_TIME = Date.UTC(2026, 8, 24, 12, 0, 0);

/** n 秒後の日時(大きいほど新しい) */
function at(seconds: number): string {
	return new Date(BASE_TIME + seconds * 1000).toISOString();
}

function imageId(n: number): string {
	return `01J8Z3K4M5N6P7Q8R9S0IMG${String(n).padStart(3, "0")}`;
}

function postId(n: number): string {
	return `01J8Z3K4M5N6P7Q8R9S0PST${String(n).padStart(3, "0")}`;
}

function ref(id: string, overrides: Record<string, unknown> = {}): Base64ImageRef {
	return {
		v: 1,
		id,
		locale: "ja",
		width: 1280,
		height: 853,
		alt: "",
		...overrides,
	} as Base64ImageRef;
}

function owner(entryId: string, field = "cover", overrides: Partial<ImageOwner> = {}): ImageOwner {
	return { collection: "posts", entryId, locale: "ja", field, ...overrides };
}

function record(owners: readonly unknown[], extra: Record<string, unknown> = {}) {
	return {
		owners,
		bytes: 74_668,
		width: 1280,
		height: 853,
		thumb: THUMB,
		createdAt: at(0),
		createdBy: "01J8USER0000000000000000AA",
		...extra,
	};
}

interface FakeEntry {
	data: Record<string, unknown>;
	status: string;
	draftRevisionId: string | null;
	trashed: boolean;
}

/** 偽の `ctx.content.get` が返すエントリ(EmDash の `ContentItem` の形) */
interface FakeItem {
	id: string;
	type: string;
	slug: null;
	status: string;
	locale: string;
	data: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	publishedAt: null;
	draftRevisionId: string | null;
}

interface FakeRevision {
	id: string;
	collection: string;
	entryId: string;
	data: Record<string, unknown>;
	createdAt: string;
}

type ContentGet = (collection: string, id: string) => Promise<FakeItem | null>;
type ContentGetRevision = (
	collection: string,
	id: string,
	revisionId: string,
) => Promise<FakeRevision | null>;
type ContentGetTrashed = (
	collection: string,
	id: string,
) => Promise<{ item: FakeItem; _rev: string } | null>;
type ContentDelete = (collection: string, id: string) => Promise<boolean>;
type ListCollections = () => Promise<{ slug: string }[]>;
type RefsQuery = (
	options: ImageRefsQueryOptions,
) => Promise<{ items: { id: string; data: unknown }[]; hasMore: boolean }>;
type RefsExists = (id: string) => Promise<boolean>;
type RefsDelete = (id: string) => Promise<boolean>;

/** SQLite の `json_extract` の値(比べ方: NULL < 数値 < 文字列) */
type SqlValue = { t: 0 } | { t: 1; v: number } | { t: 2; v: string };

function extract(data: unknown, field: string): SqlValue {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return { t: 0 };
	const value = (data as Record<string, unknown>)[field];
	if (value === null || value === undefined) return { t: 0 };
	if (typeof value === "number") return { t: 1, v: value };
	if (typeof value === "boolean") return { t: 1, v: value ? 1 : 0 };
	if (typeof value === "string") return { t: 2, v: value };
	return { t: 2, v: JSON.stringify(value) }; // オブジェクト・配列は JSON の文字列
}

function compareSql(a: SqlValue, b: SqlValue): number {
	if (a.t !== b.t) return a.t - b.t;
	if (a.t === 0 || b.t === 0) return 0;
	return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
}

function textValue(text: string): SqlValue {
	return { t: 2, v: text };
}

/** 文字列の境界との比較(NULL はどの条件にも合わない) */
function inRange(value: SqlValue, range: ImageRefsQueryOptions["where"]["createdAt"]): boolean {
	if (value.t === 0) return false;
	if (range.gte !== undefined && compareSql(value, textValue(range.gte)) < 0) return false;
	if (range.lt !== undefined && compareSql(value, textValue(range.lt)) >= 0) return false;
	if (range.lte !== undefined && compareSql(value, textValue(range.lte)) > 0) return false;
	return true;
}

/**
 * 偽の EmDash。`ctx.content` / `ctx.schema` / `ctx.storage.imageRefs` を作り、呼び出しとクエリ数を数える。
 * - `get`: 見つかれば 3(SEO ありのコレクション)/ 2(SEO なし)、ゴミ箱・無ければ 1。コレクションが無ければ例外
 * - `getRevision`: 3(エントリがゴミ箱・リビジョンが無ければ 1)
 * - `getTrashedVersioned`: ゴミ箱 4(`b64_images`)/ 6(ほか)、無い 2、ゴミ箱に入っていない 9(下書きのある `posts` の実測)
 * - `delete`: 移せたら 7(`b64_images`)/ 8(ほか)、移せなければ(ゴミ箱に入っている・無い)3
 * - `listCollections` 2、`imageRefs` の `query` / `exists` / `delete` は 1
 * - `imageRefs.query` は SQLite と同じく、`json_extract` の値で比べて並べる(NULL が先、同じ値は ID の大きい順)
 */
class FakeWorld {
	queries = 0;
	readonly collections = new Map<string, { seo: boolean }>([
		["posts", { seo: true }],
		["pages", { seo: false }],
		[B64, { seo: false }],
	]);
	readonly entries = new Map<string, FakeEntry>();
	readonly revisions = new Map<string, Record<string, unknown>>();
	readonly refs = new Map<string, string>();
	readonly calls = {
		get: [] as string[],
		getRevision: [] as string[],
		getTrashedVersioned: [] as string[],
		delete: [] as string[],
		listCollections: 0,
		query: [] as ImageRefsQueryOptions[],
	};
	/** `get` を失敗させる(データベースのエラーの代わり) */
	getError: ((collection: string, id: string) => Error | undefined) | undefined;

	readonly content = {
		get: vi.fn<ContentGet>(async (collection, id) => {
			this.calls.get.push(`${collection}/${id}`);
			const error = this.getError?.(collection, id);
			if (error !== undefined) throw error;
			const info = this.collections.get(collection);
			if (info === undefined) {
				this.queries += 1;
				throw new Error(`SQLITE_ERROR: no such table: ec_${collection}`);
			}
			const entry = this.entries.get(`${collection}/${id}`);
			if (entry === undefined || entry.trashed) {
				this.queries += 1;
				return null;
			}
			this.queries += info.seo ? 3 : 2;
			return this.item(collection, id, entry);
		}),
		getRevision: vi.fn<ContentGetRevision>(async (collection, id, revisionId) => {
			this.calls.getRevision.push(`${collection}/${id}`);
			const entry = this.entries.get(`${collection}/${id}`);
			const data = this.revisions.get(revisionId);
			if (entry === undefined || entry.trashed || data === undefined) {
				this.queries += 1;
				return null;
			}
			this.queries += 3;
			return {
				id: revisionId,
				collection,
				entryId: id,
				data: structuredClone(data),
				createdAt: at(0),
			};
		}),
		getTrashedVersioned: vi.fn<ContentGetTrashed>(async (collection, id) => {
			this.calls.getTrashedVersioned.push(`${collection}/${id}`);
			const entry = this.entries.get(`${collection}/${id}`);
			if (entry === undefined) {
				this.queries += 2;
				return null;
			}
			if (!entry.trashed) {
				this.queries += 9;
				return null;
			}
			this.queries += collection === B64 ? 4 : 6;
			return { item: this.item(collection, id, entry), _rev: "rev" };
		}),
		delete: vi.fn<ContentDelete>(async (collection, id) => {
			this.calls.delete.push(`${collection}/${id}`);
			const entry = this.entries.get(`${collection}/${id}`);
			if (entry === undefined || entry.trashed) {
				this.queries += 3;
				return false;
			}
			entry.trashed = true;
			this.queries += collection === B64 ? 7 : 8;
			return true;
		}),
	};

	readonly schema = {
		listCollections: vi.fn<ListCollections>(async () => {
			this.calls.listCollections += 1;
			this.queries += 2;
			return [...this.collections.keys()].map((slug) => ({ slug }));
		}),
	};

	readonly imageRefs = {
		query: vi.fn<RefsQuery>(async (options) => {
			this.calls.query.push(options);
			this.queries += 1;
			const rows = [...this.refs]
				.map(([id, json]) => ({ id, data: JSON.parse(json) as unknown }))
				.filter((row) => inRange(extract(row.data, "createdAt"), options.where.createdAt));
			rows.sort((a, b) => {
				const va = extract(a.data, "createdAt");
				const vb = extract(b.data, "createdAt");
				const nullRank = Number(vb.t === 0) - Number(va.t === 0); // desc: NULL が先
				if (nullRank !== 0) return nullRank;
				const byValue = compareSql(vb, va);
				if (byValue !== 0) return byValue;
				return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
			});
			return { items: rows.slice(0, options.limit), hasMore: rows.length > options.limit };
		}),
		exists: vi.fn<RefsExists>(async (id) => {
			this.queries += 1;
			return this.refs.has(id);
		}),
		delete: vi.fn<RefsDelete>(async (id) => {
			this.queries += 1;
			return this.refs.delete(id);
		}),
	};

	private item(collection: string, id: string, entry: FakeEntry): FakeItem {
		return {
			id,
			type: collection,
			slug: null,
			status: entry.status,
			locale: "ja",
			data: structuredClone(entry.data),
			createdAt: at(0),
			updatedAt: at(0),
			publishedAt: null,
			draftRevisionId: entry.draftRevisionId,
		};
	}

	/** 画像エントリと `imageRefs` の記録を作る */
	addImage(
		id: string,
		options: {
			createdAt?: string;
			owners?: readonly unknown[];
			entry?: "active" | "trashed" | "missing";
			/** 画像エントリの `status`(EmDash の値。既定は `published`) */
			status?: string;
			record?: Record<string, unknown>;
		} = {},
	): void {
		if (options.entry !== "missing") {
			this.entries.set(`${B64}/${id}`, {
				data: { image: { src: "data:image/webp;base64,AAAA" } },
				status: options.status ?? "published",
				draftRevisionId: null,
				trashed: options.entry === "trashed",
			});
		}
		this.refs.set(
			id,
			JSON.stringify(
				record(options.owners ?? [], {
					createdAt: options.createdAt ?? at(Number(id.slice(-3))),
					...options.record,
				}),
			),
		);
	}

	/** 参照元のエントリを作る。`draft` があれば下書きのリビジョンを作る(管理画面の保存と同じく `_slug` が入る) */
	addEntry(
		id: string,
		data: Record<string, unknown>,
		options: { collection?: string; draft?: Record<string, unknown>; trashed?: boolean } = {},
	): void {
		const collection = options.collection ?? "posts";
		let draftRevisionId: string | null = null;
		if (options.draft !== undefined) {
			draftRevisionId = `REV${id}`;
			this.revisions.set(draftRevisionId, { _slug: "slug", ...options.draft });
		}
		this.entries.set(`${collection}/${id}`, {
			data,
			status: "published",
			draftRevisionId,
			trashed: options.trashed === true,
		});
	}

	/** 記録の `owners` に足す(参照元の記録 T20 の代わり) */
	appendOwner(imageIdValue: string, value: unknown): void {
		const json = this.refs.get(imageIdValue);
		if (json === undefined) throw new Error(`no record ${imageIdValue}`);
		const data = JSON.parse(json) as { owners: unknown[] };
		data.owners.push(value);
		this.refs.set(imageIdValue, JSON.stringify(data));
	}
}

type Warn = (message: string, data?: unknown) => void;

function listContext(world: FakeWorld, cursor?: string) {
	const warn = vi.fn<Warn>();
	const ctx: ImagesListRouteContext = {
		input: cursor === undefined ? {} : { cursor },
		content: world.content,
		schema: world.schema,
		storage: { imageRefs: world.imageRefs },
		log: { warn },
	};
	return { ctx, warn };
}

interface ListResult {
	readonly response: ImagesListResponse;
	/** ルートの固定費を含むクエリ数 */
	readonly queries: number;
	readonly warn: ReturnType<typeof vi.fn<Warn>>;
}

/** 一覧のルートを 1 回呼ぶ。応答の形と、クエリ数が予算以下であることを毎回確かめる */
async function list(world: FakeWorld, cursor?: string): Promise<ListResult> {
	const before = world.queries;
	const { ctx, warn } = listContext(world, cursor);
	const response = await handleImagesList(ctx);
	const queries = LIST_QUERY_COSTS.route + world.queries - before;
	expect(imagesListResponseSchema.safeParse(response).success).toBe(true);
	expect(queries).toBeLessThanOrEqual(IMAGES_LIST_QUERY_BUDGET);
	for (const item of response.items) {
		// 公開の状態は active のときだけ。全体の件数は、載せた参照元の件数以上
		expect(item.entryPublication === null).toBe(item.entryStatus !== "active");
		expect(item.ownersTotal).toBeGreaterThanOrEqual(item.owners.length);
	}
	// 次のカーソルは、画面がそのまま送り返せる(リクエストのスキーマに合う)
	expect(imagesListRequestSchema.safeParse({ cursor: response.nextCursor }).success).toBe(true);
	return { response, queries, warn };
}

/** 最後のページまで読む */
async function listAll(world: FakeWorld, maxRequests = 100) {
	const items: ImageListItem[] = [];
	const pages: ListResult[] = [];
	let cursor: string | undefined;
	for (let request = 0; request < maxRequests; request += 1) {
		// oxlint-disable-next-line no-await-in-loop -- 次のページのカーソルは、前のページの応答で決まる
		const page = await list(world, cursor);
		pages.push(page);
		items.push(...page.response.items);
		cursor = page.response.nextCursor;
		if (cursor === undefined) return { items, pages };
	}
	throw new Error(`paging did not end within ${maxRequests} requests`);
}

function itemOf(response: ImagesListResponse, id: string): ImageListItem {
	const item = response.items.find((candidate) => candidate.id === id);
	if (item === undefined) throw new Error(`${id} is not in the page`);
	return item;
}

// ---------------------------------------------------------------------------
// ルートの宣言
// ---------------------------------------------------------------------------

describe("ルートの宣言", () => {
	it("一覧: POST、content:read_drafts(Contributor 以上)、body の上限、入力のスキーマ", () => {
		expect(imagesListRoute.permission).toBe("content:read_drafts");
		expect(imagesListRoute.permission).toBe(ROUTE_PERMISSIONS.imagesList);
		expect(imagesListRoute.methods).toEqual(["POST"]);
		expect(imagesListRoute.request).toEqual({ body: "json", maxBytes: IMAGES_LIST_MAX_BODY_BYTES });
		expect(imagesListRoute.input).toBe(imagesListRequestSchema);
		expect(imagesListRoute.handler).toBe(handleImagesList);
	});

	it("ゴミ箱への移動: POST、content:create(Contributor 以上。省略すると Admin だけになる)", () => {
		expect(imagesTrashRoute.permission).toBe("content:create");
		expect(imagesTrashRoute.permission).toBe(ROUTE_PERMISSIONS.imagesTrash);
		expect(imagesTrashRoute.methods).toEqual(["POST"]);
		expect(imagesTrashRoute.request).toEqual({
			body: "json",
			maxBytes: IMAGES_TRASH_MAX_BODY_BYTES,
		});
		expect(imagesTrashRoute.input).toBe(imagesTrashRequestSchema);
		expect(imagesTrashRoute.handler).toBe(handleImagesTrash);
	});

	it("body の上限は、最大の入力(空白なし)に 1 KiB を足した値", () => {
		const longestCursor = "A".repeat(IMAGES_LIST_CURSOR_MAX_LENGTH);
		expect(imagesListRequestSchema.safeParse({ cursor: longestCursor }).success).toBe(true);
		expect(imagesListRequestSchema.safeParse({ cursor: `${longestCursor}A` }).success).toBe(false);
		expect(IMAGES_LIST_MAX_BODY_BYTES).toBe(
			JSON.stringify({ cursor: longestCursor }).length + 1024,
		);

		const longestId = "0".repeat(128);
		expect(entryIdSchema.safeParse(longestId).success).toBe(true);
		expect(entryIdSchema.safeParse(`${longestId}0`).success).toBe(false);
		expect(IMAGES_TRASH_MAX_BODY_BYTES).toBe(JSON.stringify({ id: longestId }).length + 1024);
	});

	it("EmDash の RouteContext をハンドラーの ctx として渡せる", () => {
		expectTypeOf<RouteContext<ImagesListRequest>>().toExtend<ImagesListRouteContext>();
		expectTypeOf<RouteContext<ImagesTrashRequest>>().toExtend<ImagesTrashRouteContext>();
		expectTypeOf<StorageCollection>().toExtend<ImageRefsPageStore>();
		expectTypeOf<StorageCollection>().toExtend<ImageRefsExistence>();
	});
});

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

describe("判定: 参照元ごとの状態と usage", () => {
	it("列の値に画像があれば in_use", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1))] });
		world.addEntry(postId(1), { title: "A", cover: ref(imageId(1)) });
		const { response } = await list(world);
		expect(response.items).toEqual([
			{
				id: imageId(1),
				thumb: THUMB,
				width: 1280,
				height: 853,
				bytes: 74_668,
				createdAt: at(1),
				entryStatus: "active",
				entryPublication: "published",
				usage: "in_use",
				owners: [{ ...owner(postId(1)), status: "in_use" }],
				ownersTotal: 1,
			},
		]);
		expect(response.nextCursor).toBeUndefined();
	});

	it("列の値に無くても、下書きにあれば in_use(未公開のエントリで画像を足した)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1))] });
		world.addEntry(postId(1), { cover: null }, { draft: { cover: ref(imageId(1)) } });
		const { response } = await list(world);
		expect(itemOf(response, imageId(1)).usage).toBe("in_use");
		expect(world.calls.getRevision).toEqual([`posts/${postId(1)}`]);
	});

	it("公開版から外して下書きだけにある / 下書きで外して公開版にある、のどちらも in_use", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1))] });
		world.addImage(imageId(2), { owners: [owner(postId(2))] });
		world.addEntry(postId(1), { cover: ref(imageId(9)) }, { draft: { cover: ref(imageId(1)) } });
		world.addEntry(postId(2), { cover: ref(imageId(2)) }, { draft: { cover: null } });
		const { response } = await list(world);
		expect(itemOf(response, imageId(1)).usage).toBe("in_use");
		expect(itemOf(response, imageId(2)).usage).toBe("in_use");
	});

	it("列の値と下書きのどちらにも無ければ detached", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1))] });
		world.addEntry(postId(1), { cover: ref(imageId(9)) }, { draft: { cover: null } });
		const { response } = await list(world);
		expect(itemOf(response, imageId(1))).toMatchObject({
			usage: "detached",
			owners: [{ status: "detached" }],
		});
	});

	it("参照元がゴミ箱に入った・無い(完全削除)なら owner_deleted", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1)), owner(postId(2))] });
		world.addEntry(postId(1), { cover: ref(imageId(1)) }, { trashed: true });
		const { response } = await list(world);
		expect(itemOf(response, imageId(1))).toMatchObject({
			usage: "owner_deleted",
			owners: [{ status: "owner_deleted" }, { status: "owner_deleted" }],
		});
		expect(world.calls.getRevision).toEqual([]);
	});

	it("参照元が無ければ no_owner(アップロードしたが保存されなかった)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		const { response } = await list(world);
		expect(itemOf(response, imageId(1))).toMatchObject({ usage: "no_owner", owners: [] });
		expect(world.calls.listCollections).toBe(0);
	});

	it("usage は in_use → owner_deleted → detached の順で決まる(参照元の並びによらない)", async () => {
		const world = new FakeWorld();
		world.addEntry(postId(1), { cover: ref(imageId(9)) }); // detached
		world.addEntry(postId(3), { cover: ref(imageId(1)), gallery: [ref(imageId(2))] }); // in_use
		world.addImage(imageId(1), { owners: [owner(postId(1)), owner(postId(2)), owner(postId(3))] });
		world.addImage(imageId(2), { owners: [owner(postId(1)), owner(postId(2))] });
		world.addImage(imageId(3), { owners: [owner(postId(1))] });
		const { response } = await list(world);
		expect(itemOf(response, imageId(1)).usage).toBe("in_use");
		expect(itemOf(response, imageId(1)).owners.map((item) => item.status)).toEqual([
			"detached",
			"owner_deleted",
			"in_use",
		]);
		expect(itemOf(response, imageId(2)).usage).toBe("owner_deleted");
		expect(itemOf(response, imageId(3)).usage).toBe("detached");
	});

	it("ギャラリーは要素ごとに見る(形の合わない要素は飛ばす)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1), "gallery")] });
		world.addImage(imageId(2), { owners: [owner(postId(1), "gallery")] });
		world.addEntry(postId(1), {
			gallery: [{ id: imageId(2) }, ref(imageId(9)), ref(imageId(1))],
		});
		const { response } = await list(world);
		expect(itemOf(response, imageId(1)).usage).toBe("in_use");
		expect(itemOf(response, imageId(2)).usage).toBe("detached");
	});

	it("単一画像かギャラリーかは値の形で決める(widget を変えても、参照が残っていれば in_use)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1), "cover")] });
		world.addImage(imageId(2), { owners: [owner(postId(1), "gallery")] });
		world.addEntry(postId(1), { cover: [ref(imageId(1))], gallery: ref(imageId(2)) });
		const { response } = await list(world);
		expect(itemOf(response, imageId(1)).usage).toBe("in_use");
		expect(itemOf(response, imageId(2)).usage).toBe("in_use");
	});

	it("フィールドは自分のプロパティだけを読む(constructor など)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1), "constructor")] });
		world.addEntry(postId(1), {});
		const { response } = await list(world);
		expect(itemOf(response, imageId(1)).usage).toBe("detached");
	});

	it("同じエントリは 1 回だけ読む(cover とギャラリー、ほかの画像、ロケールだけ違う参照元)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), {
			owners: [
				owner(postId(1), "cover"),
				owner(postId(1), "gallery"),
				owner(postId(1), "cover", { locale: "en" }),
			],
		});
		world.addImage(imageId(2), { owners: [owner(postId(1), "gallery")] });
		world.addEntry(postId(1), { cover: ref(imageId(1)), gallery: [ref(imageId(2))] });
		const { response, queries } = await list(world);
		expect(world.calls.get.filter((call) => call.startsWith("posts/"))).toEqual([
			`posts/${postId(1)}`,
		]);
		expect(
			itemOf(response, imageId(1)).owners.map((item) => [item.field, item.locale, item.status]),
		).toEqual([
			["cover", "ja", "in_use"],
			["gallery", "ja", "detached"],
			["cover", "en", "in_use"],
		]);
		// 固定費 1 + query 1 + 画像 2 枚 × 2 + エントリ 1 件 × 3
		expect(queries).toBe(1 + 1 + 2 * 2 + 3);
	});

	it("列の値だけで全部見つかれば、下書きは読まない", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1))] });
		world.addImage(imageId(2), { owners: [owner(postId(1), "gallery")] });
		world.addEntry(
			postId(1),
			{ cover: ref(imageId(1)), gallery: [ref(imageId(2))] },
			{ draft: { cover: null, gallery: [] } },
		);
		const { response, queries } = await list(world);
		expect(response.items.map((item) => item.usage)).toEqual(["in_use", "in_use"]);
		expect(world.calls.getRevision).toEqual([]);
		expect(queries).toBe(1 + 1 + 2 * 2 + 3);
	});

	it("ほかの画像のために下書きを読むときは、同じエントリの判定に下書きも使う", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1))] });
		world.addImage(imageId(2), { owners: [owner(postId(1), "gallery")] });
		world.addEntry(
			postId(1),
			{ cover: ref(imageId(1)) },
			{ draft: { gallery: [ref(imageId(2))] } },
		);
		const { response } = await list(world);
		expect(response.items.map((item) => item.usage)).toEqual(["in_use", "in_use"]);
		expect(world.calls.getRevision).toEqual([`posts/${postId(1)}`]);
	});

	it("参照元のコレクションが消されていたら owner_deleted(コレクションの一覧は 1 回だけ読む)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), {
			owners: [
				owner(postId(1), "cover", { collection: "events" }),
				owner(postId(2), "cover", { collection: "events" }),
			],
		});
		world.addImage(imageId(2), { owners: [owner(postId(3), "cover", { collection: "news" })] });
		const { response } = await list(world);
		expect(response.items.map((item) => item.usage)).toEqual(["owner_deleted", "owner_deleted"]);
		expect(world.calls.listCollections).toBe(1);
	});

	it("コレクションがあるのに get が失敗したら、例外をそのまま投げる(削除されたと誤らない)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1))] });
		world.addEntry(postId(1), { cover: ref(imageId(1)) });
		world.getError = (collection) =>
			collection === "posts" ? new Error("D1_ERROR: network") : undefined;
		const { ctx } = listContext(world);
		await expect(handleImagesList(ctx)).rejects.toThrow("D1_ERROR: network");
	});
});

describe("判定: 画像エントリの状態", () => {
	it("active / trashed / missing。getTrashedVersioned は get が null のときだけ呼ぶ", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		world.addImage(imageId(2), { entry: "trashed" });
		world.addImage(imageId(3), { entry: "missing" });
		const { response, queries } = await list(world);
		expect(response.items.map((item) => [item.id, item.entryStatus])).toEqual([
			[imageId(3), "missing"],
			[imageId(2), "trashed"],
			[imageId(1), "active"],
		]);
		expect(world.calls.getTrashedVersioned).toEqual([
			`${B64}/${imageId(3)}`,
			`${B64}/${imageId(2)}`,
		]);
		// 固定費 1 + query 1 + missing 1 + 2 + trashed 1 + 4 + active 2
		expect(queries).toBe(1 + 1 + 3 + 5 + 2);
	});

	it("アップロードの途中で失敗した画像(ゴミ箱の下書き・参照元なし)も一覧に出る(T18)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { entry: "trashed", owners: [] });
		const { response } = await list(world);
		expect(itemOf(response, imageId(1))).toMatchObject({
			entryStatus: "trashed",
			usage: "no_owner",
		});
	});
});

describe("判定: 画像エントリの公開の状態(T21-2)", () => {
	it("get の status から決める。published / draft / scheduled はそのまま、知らない値は draft。クエリは増えない", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(4), { status: "published" });
		world.addImage(imageId(3), { status: "draft" });
		world.addImage(imageId(2), { status: "scheduled" });
		world.addImage(imageId(1), { status: "archived" });
		const { response, queries } = await list(world);
		expect(response.items.map((item) => [item.id, item.entryPublication])).toEqual([
			[imageId(4), "published"],
			[imageId(3), "draft"],
			[imageId(2), "scheduled"],
			[imageId(1), "draft"],
		]);
		expect(world.calls.getTrashedVersioned).toEqual([]);
		// 固定費 1 + query 1 + get 2 × 4(公開の状態のために読むものは無い)
		expect(queries).toBe(2 + 4 * 2);
	});

	it("ゴミ箱・無い画像は null(ゴミ箱に入る前に公開していても)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(2), { entry: "trashed", status: "published" });
		world.addImage(imageId(1), { entry: "missing" });
		const { response } = await list(world);
		expect(response.items.map((item) => [item.entryStatus, item.entryPublication])).toEqual([
			["trashed", null],
			["missing", null],
		]);
	});
});

describe("参照元の全体の件数(T21-2)", () => {
	it(`載せるのは先頭の ${IMAGES_LIST_MAX_OWNERS} 件、ownersTotal は全体の件数`, async () => {
		const world = new FakeWorld();
		// 1 件の投稿の 25 個のフィールド(エントリは 1 件なので、1 リクエストで調べられる)
		const fields = Array.from({ length: 25 }, (_, index) => `f${index + 1}`);
		world.addImage(imageId(1), { owners: fields.map((field) => owner(postId(1), field)) });
		world.addEntry(postId(1), { f25: ref(imageId(1)) });
		const { response } = await list(world);
		const item = itemOf(response, imageId(1));
		expect(item.owners).toHaveLength(IMAGES_LIST_MAX_OWNERS);
		expect(item.ownersTotal).toBe(25);
		expect(item.usage).toBe("in_use");
	});

	it("4 つのキーが同じものは 1 件。壊れた要素と、locale だけが壊れた要素は数えない", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), {
			owners: [
				owner(postId(1)),
				owner(postId(1)),
				owner(postId(1), "gallery"),
				owner(postId(1), "cover", { locale: "en" }),
				null,
				{ collection: "posts", entryId: postId(2), field: "cover" },
				owner(postId(3), "cover", { locale: "" }),
			],
		});
		world.addEntry(postId(1), { cover: ref(imageId(1)) });
		world.addEntry(postId(2), { cover: null });
		world.addEntry(postId(3), { cover: null });
		const { response } = await list(world);
		const item = itemOf(response, imageId(1));
		expect(item.owners.map((listed) => [listed.field, listed.locale])).toEqual([
			["cover", "ja"],
			["gallery", "ja"],
			["cover", "en"],
		]);
		expect(item.ownersTotal).toBe(3);
	});

	it("参照元が無ければ 0", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		const { response } = await list(world);
		expect(itemOf(response, imageId(1))).toMatchObject({ owners: [], ownersTotal: 0 });
	});
});

describe("判定: 記録の読み方", () => {
	it("collection / entryId / field が読めない要素は調べずに飛ばし、ログに出す", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), {
			owners: [
				null,
				"posts",
				{ collection: "posts", entryId: "../x", locale: "ja", field: "cover" },
				{ collection: "posts", entryId: postId(1), locale: "ja" },
				owner(postId(2)),
			],
		});
		world.addEntry(postId(2), { cover: ref(imageId(1)) });
		const { response, warn } = await list(world);
		expect(itemOf(response, imageId(1))).toMatchObject({
			usage: "in_use",
			owners: [{ entryId: postId(2), status: "in_use" }],
		});
		expect(world.calls.get.filter((call) => call.startsWith("posts/"))).toEqual([
			`posts/${postId(2)}`,
		]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("ignored owners"), {
			ids: [imageId(1)],
			count: 1,
		});
	});

	it("locale だけが壊れた要素は、usage には使うが一覧には載せない", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), {
			owners: [owner(postId(1), "cover", { locale: "" }), owner(postId(2))],
		});
		world.addEntry(postId(1), { cover: ref(imageId(1)) });
		world.addEntry(postId(2), { cover: null });
		const { response } = await list(world);
		expect(itemOf(response, imageId(1))).toMatchObject({
			usage: "in_use",
			owners: [{ entryId: postId(2), status: "detached" }],
		});
	});

	it("4 つのキーが同じ要素は 1 つだけ載せる", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1)), owner(postId(1))] });
		world.addEntry(postId(1), { cover: ref(imageId(1)) });
		const { response } = await list(world);
		expect(itemOf(response, imageId(1)).owners).toHaveLength(1);
	});

	it(`一覧に載せる参照元は先頭の ${IMAGES_LIST_MAX_OWNERS} 件まで。usage はすべてから決める`, async () => {
		const world = new FakeWorld();
		const owners: ImageOwner[] = [];
		for (let n = 1; n <= 12; n += 1) {
			owners.push(owner(postId(n), "cover"), owner(postId(n), "gallery"));
			world.addEntry(postId(n), { cover: null, gallery: n === 12 ? [ref(imageId(1))] : [] });
		}
		world.addImage(imageId(1), { owners });
		const { response } = await list(world);
		const item = itemOf(response, imageId(1));
		expect(item.owners).toHaveLength(IMAGES_LIST_MAX_OWNERS);
		expect(item.owners.every((listed) => listed.status === "detached")).toBe(true);
		expect(item.usage).toBe("in_use"); // 24 番目の要素(一覧に載らない)が使用中
	});

	it("応答に載せられない記録は一覧から外し、ログに出す(次のページには進む)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		world.addImage(imageId(2), { record: { thumb: "https://example.com/a.webp" } });
		world.addImage(imageId(3), { record: { bytes: undefined } });
		world.addImage(imageId(4), { record: { createdAt: `${at(4)}x` } });
		world.addImage(imageId(5), { record: { owners: { 0: owner(postId(1)) } } });
		world.refs.set("bad/id", JSON.stringify(record([], { createdAt: at(6) })));
		world.addImage(imageId(7));
		const { response, warn } = await list(world);
		expect(response.items.map((item) => item.id)).toEqual([imageId(7), imageId(1)]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipped imageRefs records"), {
			ids: ["bad/id", imageId(5), `${imageId(4)}`, imageId(3), imageId(2)],
			count: 5,
		});
	});

	it("createdAt が無い・数値・オブジェクトの記録は読まない(位置に使えないため)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		world.addImage(imageId(2), { record: { createdAt: null } });
		world.addImage(imageId(3), { record: { createdAt: 1_700_000_000 } });
		world.addImage(imageId(4), { record: { createdAt: { at: 1 } } });
		const { items } = await listAll(world);
		expect(items.map((item) => item.id)).toEqual([imageId(1)]);
	});

	it("createdAt が数字で始まらない文字列の記録は読まない(1 ページより多くても、ページ送りが止まらない)", async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= 3; n += 1) world.addImage(imageId(n));
		// 文字列として比べると、どの日時よりも大きい(新しい順の先頭に来る)
		for (let n = 11; n <= 11 + IMAGES_LIST_MAX_ITEMS; n += 1) {
			world.addImage(imageId(n), { record: { createdAt: `later-${n}` } });
		}
		const { items, pages } = await listAll(world);
		expect(items.map((item) => item.id)).toEqual([imageId(3), imageId(2), imageId(1)]);
		expect(pages).toHaveLength(1);
		expect(pages[0]?.warn).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// ページ送り
// ---------------------------------------------------------------------------

describe("ページ送り", () => {
	it(`新しい順に ${IMAGES_LIST_MAX_ITEMS} 枚ずつ。すべての画像が 1 回ずつ出る`, async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= 25; n += 1) world.addImage(imageId(n));
		const { items, pages } = await listAll(world);
		expect(pages.map((page) => page.response.items.length)).toEqual([10, 10, 5]);
		expect(items.map((item) => item.id)).toEqual(
			Array.from({ length: 25 }, (_, index) => imageId(25 - index)),
		);
	});

	it("同じ createdAt の記録が多くても、ID の大きい順に 1 回ずつ出る", async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= 35; n += 1) world.addImage(imageId(n), { createdAt: at(0) });
		world.addImage(imageId(90), { createdAt: at(-1) });
		const { items } = await listAll(world);
		expect(items.map((item) => item.id)).toEqual([
			...Array.from({ length: 35 }, (_, index) => imageId(35 - index)),
			imageId(90),
		]);
	});

	it(`同じ createdAt の記録が 100 件を超えると、残りを飛ばして進む(ログに出す)`, async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= 105; n += 1) world.addImage(imageId(n), { createdAt: at(0) });
		world.addImage(imageId(900), { createdAt: at(-1) });
		const warns: unknown[] = [];
		let cursor: string | undefined;
		const seen: string[] = [];
		for (let request = 0; request < 30; request += 1) {
			// oxlint-disable-next-line no-await-in-loop -- 次のページのカーソルは、前のページの応答で決まる
			const page = await list(world, cursor);
			seen.push(...page.response.items.map((item) => item.id));
			warns.push(...page.warn.mock.calls.map((call) => call[0]));
			cursor = page.response.nextCursor;
			if (cursor === undefined) break;
		}
		expect(cursor).toBeUndefined();
		expect(new Set(seen).size).toBe(seen.length);
		expect(seen).toContain(imageId(900));
		expect(seen.length).toBeGreaterThanOrEqual(101);
		expect(warns).toContainEqual(expect.stringContaining("share the createdAt"));
	});

	it("最後に読んだ記録が消えても(完全削除)、次のページは続きから始まる", async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= 15; n += 1) world.addImage(imageId(n));
		const first = await list(world);
		const lastId = first.response.items.at(-1)?.id;
		expect(lastId).toBe(imageId(6));
		world.refs.delete(imageId(6));
		const second = await list(world, first.response.nextCursor);
		expect(second.response.items.map((item) => item.id)).toEqual(
			[5, 4, 3, 2, 1].map((n) => imageId(n)),
		);
	});

	it("読んでいる間に足された画像は、続きのページには出ない(重複しない)", async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= 15; n += 1) world.addImage(imageId(n));
		const first = await list(world);
		world.addImage(imageId(50), { createdAt: at(50) });
		const second = await list(world, first.response.nextCursor);
		expect(second.response.items.map((item) => item.id)).toEqual(
			[5, 4, 3, 2, 1].map((n) => imageId(n)),
		);
		expect(second.response.nextCursor).toBeUndefined();
	});

	it("記録が 1 件も無ければ、空の一覧", async () => {
		const world = new FakeWorld();
		const { response, queries } = await list(world);
		expect(response).toEqual({ items: [] });
		expect(queries).toBe(2);
	});

	it("ちょうど 1 ページ分なら、nextCursor は無い", async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= IMAGES_LIST_MAX_ITEMS; n += 1) world.addImage(imageId(n));
		const { response } = await list(world);
		expect(response.items).toHaveLength(IMAGES_LIST_MAX_ITEMS);
		expect(response.nextCursor).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// クエリ数の予算
// ---------------------------------------------------------------------------

describe("クエリ数の予算", () => {
	it("最悪の組み合わせ(画像がゴミ箱、参照元はそれぞれ別の投稿で下書きあり)でも予算以下。1 ページ 8 枚", async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= 20; n += 1) {
			world.addImage(imageId(n), { entry: "trashed", owners: [owner(postId(n))] });
			world.addEntry(postId(n), { cover: null }, { draft: { cover: ref(imageId(n)) } });
		}
		const { pages, items } = await listAll(world);
		expect(pages.map((page) => page.response.items.length)).toEqual([8, 8, 4]);
		// 固定費 1 + query 1 + 8 × (画像 5 + 参照元 6)
		expect(pages[0]?.queries).toBe(2 + 8 * 11);
		expect(items.every((item) => item.usage === "in_use" && item.entryStatus === "trashed")).toBe(
			true,
		);
	});

	it("参照元がそれぞれ別の投稿で、公開済み・下書きなしなら、実際のクエリは 1 ページ 42(見積もりで 8 枚)", async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= 10; n += 1) {
			world.addImage(imageId(n), { owners: [owner(postId(n))] });
			world.addEntry(postId(n), { cover: ref(imageId(n)) });
		}
		const first = await list(world);
		expect(first.response.items).toHaveLength(8);
		expect(first.queries).toBe(2 + 8 * (2 + 3));
	});

	it("参照元がすべて同じ投稿(ギャラリー)なら 10 枚", async () => {
		const world = new FakeWorld();
		const gallery = Array.from({ length: 10 }, (_, index) => ref(imageId(index + 1)));
		for (let n = 1; n <= 10; n += 1)
			world.addImage(imageId(n), { owners: [owner(postId(1), "gallery")] });
		world.addEntry(postId(1), { gallery }, { draft: { gallery } });
		const { response, queries } = await list(world);
		expect(response.items).toHaveLength(10);
		expect(queries).toBe(2 + 10 * 2 + 3);
	});

	it("見積もりは、予算を超える直前の画像で止める(境界。コレクションの一覧の 2 も入る)", async () => {
		const world = new FakeWorld();
		// 固定費 1 + query 1 = 2。1 枚目: 画像 5 + コレクションの一覧 2 + 参照元 6 × 13 = 85 で 87。
		// 参照元なしの画像(5)を足すと 92、97、102(超える)。コレクションの一覧を見積もらないと 4 枚目も入る
		const owners = Array.from({ length: 13 }, (_, index) => owner(postId(index + 1)));
		for (let n = 1; n <= 13; n += 1) world.addEntry(postId(n), { cover: ref(imageId(5)) });
		world.addImage(imageId(5), { owners });
		for (let n = 1; n <= 4; n += 1) world.addImage(imageId(n));
		const first = await list(world);
		expect(first.response.items.map((item) => item.id)).toEqual([
			imageId(5),
			imageId(4),
			imageId(3),
		]);
		const second = await list(world, first.response.nextCursor);
		expect(second.response.items.map((item) => item.id)).toEqual([imageId(2), imageId(1)]);
		const page = await listImagesPage(
			{
				content: world.content,
				schema: world.schema,
				imageRefs: world.imageRefs,
				log: { warn: vi.fn<Warn>() },
			},
			null,
		);
		expect(page.reservedQueries).toBe(2 + 85 + 5 + 5);
	});

	it("listImagesPage は、見積もりで確保したクエリ数を返す(実際の数はそれ以下)", async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= 12; n += 1) {
			world.addImage(imageId(n), {
				entry: n % 3 === 0 ? "trashed" : "active",
				owners: [owner(postId(n))],
			});
			world.addEntry(
				postId(n),
				{ cover: ref(imageId(n)) },
				n % 2 === 0 ? { draft: { cover: null } } : {},
			);
		}
		const before = world.queries;
		const page = await listImagesPage(
			{
				content: world.content,
				schema: world.schema,
				imageRefs: world.imageRefs,
				log: { warn: vi.fn<Warn>() },
			},
			null,
		);
		expect(page.reservedQueries).toBeLessThanOrEqual(IMAGES_LIST_QUERY_BUDGET);
		expect(LIST_QUERY_COSTS.route + world.queries - before).toBeLessThanOrEqual(
			page.reservedQueries,
		);
		expect(page.heavy).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 参照元の多い画像
// ---------------------------------------------------------------------------

describe("参照元の多い画像(1 枚で予算を超える)", () => {
	function heavyWorld(count: number, entryData: (n: number) => Record<string, unknown>) {
		const world = new FakeWorld();
		const owners = Array.from({ length: count }, (_, index) => owner(postId(index + 1)));
		for (let n = 1; n <= count; n += 1) world.addEntry(postId(n), entryData(n));
		world.addImage(imageId(5), { owners });
		return world;
	}

	it("参照元をリクエストに分けて調べ、終わるまでは items が空で nextCursor がある", async () => {
		// 40 件とも外されている: 15 + 16 + 9 件に分かれる
		const world = heavyWorld(40, () => ({ cover: null }));
		world.addImage(imageId(1));
		const { pages, items } = await listAll(world);
		expect(pages.map((page) => page.response.items.length)).toEqual([0, 0, 1, 1]);
		expect(items.map((item) => item.id)).toEqual([imageId(5), imageId(1)]);
		const heavy = itemOf({ items }, imageId(5));
		expect(heavy.usage).toBe("detached");
		expect(heavy.owners).toHaveLength(IMAGES_LIST_MAX_OWNERS);
		expect(heavy.owners.every((listed) => listed.status === "detached")).toBe(true);
		expect(world.calls.get.filter((call) => call.startsWith("posts/"))).toHaveLength(40);
	});

	it("一覧に載せる参照元の状態がそろい、どれかが使用中なら、残りは調べない", async () => {
		const world = heavyWorld(40, (n) => ({ cover: n === 2 ? ref(imageId(5)) : null }));
		const { pages, items } = await listAll(world);
		expect(pages.map((page) => page.response.items.length)).toEqual([0, 1]);
		expect(items[0]).toMatchObject({ usage: "in_use", entryStatus: "active" });
		expect(items[0]?.owners[1]).toMatchObject({ entryId: postId(2), status: "in_use" });
		// 1 回目 15 件、2 回目 16 件で、一覧に載せる 20 件がそろったところで終わる
		expect(world.calls.get.filter((call) => call.startsWith("posts/"))).toHaveLength(31);
	});

	it("一覧に載らない参照元だけが使用中でも、usage は in_use", async () => {
		const world = heavyWorld(40, (n) => ({ cover: n === 38 ? ref(imageId(5)) : null }));
		const { items } = await listAll(world);
		expect(items[0]?.usage).toBe("in_use");
		expect(items[0]?.owners.every((listed) => listed.status === "detached")).toBe(true);
	});

	it("画像エントリの状態は最初のリクエストで調べ、カーソルに持つ", async () => {
		const world = heavyWorld(40, () => ({ cover: null }));
		world.entries.get(`${B64}/${imageId(5)}`)!.trashed = true;
		const { items } = await listAll(world);
		expect(items[0]?.entryStatus).toBe("trashed");
		expect(world.calls.getTrashedVersioned).toEqual([`${B64}/${imageId(5)}`]);
	});

	it("公開の状態も最初のリクエストで調べ、カーソルに持つ(途中で変わっても読み直さない)", async () => {
		const world = heavyWorld(40, () => ({ cover: null }));
		world.entries.get(`${B64}/${imageId(5)}`)!.status = "draft";
		const first = await list(world);
		expect(first.response.items).toEqual([]);
		world.entries.get(`${B64}/${imageId(5)}`)!.status = "published";
		const { items } = await listAllFrom(world, first.response.nextCursor);
		expect(items[0]).toMatchObject({ entryStatus: "active", entryPublication: "draft" });
		expect(world.calls.get.filter((call) => call.startsWith(`${B64}/`))).toHaveLength(1);
	});

	it("全体の件数は、調べ終えた項目に入る(40 件)", async () => {
		const world = heavyWorld(40, () => ({ cover: null }));
		const { items } = await listAll(world);
		expect(items[0]?.owners).toHaveLength(IMAGES_LIST_MAX_OWNERS);
		expect(items[0]?.ownersTotal).toBe(40);
	});

	it("途中で参照元が足されたら、最初から調べ直す", async () => {
		const world = heavyWorld(40, () => ({ cover: null }));
		const first = await list(world);
		expect(first.response.items).toEqual([]);
		world.addEntry(postId(41), { cover: ref(imageId(5)) });
		world.appendOwner(imageId(5), owner(postId(41)));
		const second = await list(world, first.response.nextCursor);
		expect(second.response.items).toEqual([]);
		const { items } = await listAllFrom(world, second.response.nextCursor);
		expect(items[0]).toMatchObject({ id: imageId(5), usage: "in_use" });
		// 1 回目の 15 件 + 調べ直した 41 件
		expect(world.calls.get.filter((call) => call.startsWith("posts/"))).toHaveLength(15 + 41);
	});

	it("途中で画像の記録が消えたら(完全削除)、続きの画像から普通に読む", async () => {
		const world = heavyWorld(40, () => ({ cover: null }));
		world.addImage(imageId(1));
		const first = await list(world);
		world.refs.delete(imageId(5));
		const second = await list(world, first.response.nextCursor);
		expect(second.response.items.map((item) => item.id)).toEqual([imageId(1)]);
	});

	it("ページの途中に来たら、その前で止め、次のリクエストで扱う", async () => {
		const world = heavyWorld(40, () => ({ cover: ref(imageId(5)) }));
		world.addImage(imageId(7));
		world.addImage(imageId(6));
		const first = await list(world);
		expect(first.response.items.map((item) => item.id)).toEqual([imageId(7), imageId(6)]);
		const rest = await listAllFrom(world, first.response.nextCursor);
		expect(rest.items.map((item) => item.id)).toEqual([imageId(5)]);
	});

	it("どのリクエストも予算以下(参照元はすべて下書きあり)", async () => {
		const world = new FakeWorld();
		const owners = Array.from({ length: 30 }, (_, index) => owner(postId(index + 1)));
		for (let n = 1; n <= 30; n += 1) {
			world.addEntry(postId(n), { cover: null }, { draft: { cover: null } });
		}
		world.addImage(imageId(5), { owners, entry: "trashed" });
		const { pages, items } = await listAll(world);
		expect(pages.length).toBeGreaterThan(1);
		for (const page of pages) expect(page.queries).toBeLessThanOrEqual(IMAGES_LIST_QUERY_BUDGET);
		expect(items[0]).toMatchObject({ usage: "detached", entryStatus: "trashed" });
	});
});

async function listAllFrom(world: FakeWorld, cursor: string | undefined) {
	const items: ImageListItem[] = [];
	let next = cursor;
	for (let request = 0; request < 50 && next !== undefined; request += 1) {
		// oxlint-disable-next-line no-await-in-loop -- 次のページのカーソルは、前のページの応答で決まる
		const page = await list(world, next);
		items.push(...page.response.items);
		next = page.response.nextCursor;
	}
	expect(next).toBeUndefined();
	return { items };
}

// ---------------------------------------------------------------------------
// カーソル
// ---------------------------------------------------------------------------

/** base64url(カーソルと同じ書き方) */
function b64url(text: string): string {
	return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("カーソル", () => {
	it("位置と途中の状態を、そのまま読み戻せる", () => {
		const cursor: ImagesListCursor = {
			after: { createdAt: at(3), id: imageId(3) },
			heavy: {
				id: imageId(2),
				ownerCount: 40,
				checkedEntries: 15,
				listed: "uxd.................",
				rest: "d",
				entry: { entryStatus: "trashed", entryPublication: null },
			},
		};
		const encoded = encodeImagesListCursor(cursor);
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeImagesListCursor(encoded)).toEqual({ ok: true, cursor });
		expect(decodeImagesListCursor(undefined)).toEqual({ ok: true, cursor: null });
	});

	it.each([
		{ entryStatus: "active", entryPublication: "published" },
		{ entryStatus: "active", entryPublication: "draft" },
		{ entryStatus: "active", entryPublication: "scheduled" },
		{ entryStatus: "trashed", entryPublication: null },
		{ entryStatus: "missing", entryPublication: null },
	] as const)("途中の状態の画像エントリ($entryStatus / $entryPublication)を読み戻せる", (entry) => {
		const cursor: ImagesListCursor = {
			heavy: { id: imageId(2), ownerCount: 1, checkedEntries: 0, listed: ".", rest: "", entry },
		};
		expect(decodeImagesListCursor(encodeImagesListCursor(cursor))).toEqual({ ok: true, cursor });
	});

	it("ASCII 以外の値も読み戻せる", () => {
		const cursor: ImagesListCursor = { after: { createdAt: "2026-01-01日本🗾", id: "画像" } };
		expect(decodeImagesListCursor(encodeImagesListCursor(cursor))).toEqual({ ok: true, cursor });
	});

	it("正しい形の値は読める(下の不正な値の比較の基準)", () => {
		expect(
			decodeImagesListCursor(b64url(JSON.stringify({ v: 2, a: [at(0), imageId(1)] }))),
		).toEqual({
			ok: true,
			cursor: { after: { createdAt: at(0), id: imageId(1) } },
		});
	});

	it.each([
		["使えない文字", "abc$"],
		["base64 でない", "A"],
		["JSON でない", b64url("not json")],
		["前の版(1)", b64url(JSON.stringify({ v: 1, a: [at(0), imageId(1)] }))],
		["知らない版(3)", b64url(JSON.stringify({ v: 3, a: [at(0), imageId(1)] }))],
		["知らないキー", b64url(JSON.stringify({ v: 2, a: [at(0), imageId(1)], x: 1 }))],
		["位置も途中の状態も無い", b64url(JSON.stringify({ v: 2 }))],
		["位置の createdAt が数字で始まらない", b64url(JSON.stringify({ v: 2, a: ["x", imageId(1)] }))],
		[
			"途中の状態の文字が不正",
			b64url(JSON.stringify({ v: 2, h: [imageId(1), 1, 0, "?", "", "p"] })),
		],
		[
			"途中の状態が長すぎる",
			b64url(JSON.stringify({ v: 2, h: [imageId(1), 1, 0, ".".repeat(21), "", "p"] })),
		],
		[
			"途中の状態の画像エントリの状態が前の版の文字(a)",
			b64url(JSON.stringify({ v: 2, h: [imageId(1), 1, 0, ".", "", "a"] })),
		],
		["長すぎる", "A".repeat(IMAGES_LIST_CURSOR_MAX_LENGTH + 1)],
	])("%s なら 400 INVALID_CURSOR", async (_label, cursor) => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		const { ctx } = listContext(world, cursor);
		const error = await handleImagesList(ctx).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(PluginRouteError);
		expect(error).toMatchObject({ code: "INVALID_CURSOR", status: 400 });
		expect(world.calls.query).toEqual([]);
	});

	it(`${IMAGES_LIST_CURSOR_MAX_LENGTH} 文字を超えるカーソルは、中身が正しくても読まない`, () => {
		const long = encodeImagesListCursor({ after: { createdAt: at(1), id: "X".repeat(1600) } });
		expect(long.length).toBeGreaterThan(IMAGES_LIST_CURSOR_MAX_LENGTH);
		expect(decodeImagesListCursor(long)).toMatchObject({ ok: false });
		const short = encodeImagesListCursor({ after: { createdAt: at(1), id: "X".repeat(1400) } });
		expect(short.length).toBeLessThanOrEqual(IMAGES_LIST_CURSOR_MAX_LENGTH);
		expect(decodeImagesListCursor(short)).toMatchObject({ ok: true });
	});

	it("位置に使えない記録(カーソルに入らないほど長い createdAt)が最後なら、その前の記録を位置にする", async () => {
		const world = new FakeWorld();
		for (let n = 1; n <= 9; n += 1) world.addImage(imageId(20 + n), { createdAt: at(100 + n) });
		// 日時として不正で載せられず、長すぎて位置にも使えない記録
		world.addImage(imageId(10), { createdAt: `${at(50).slice(0, -1)}${"0".repeat(3000)}` });
		// 9 枚のあとには入らない(5 + 2 + 6 × 9 = 61)
		const owners = Array.from({ length: 9 }, (_, index) => owner(postId(index + 1)));
		for (let n = 1; n <= 9; n += 1) world.addEntry(postId(n), { cover: ref(imageId(5)) });
		world.addImage(imageId(5), { createdAt: at(10), owners });

		const first = await list(world);
		expect(first.response.items.map((item) => item.id)).toEqual(
			Array.from({ length: 9 }, (_, index) => imageId(29 - index)),
		);
		expect(decodeImagesListCursor(first.response.nextCursor)).toEqual({
			ok: true,
			cursor: { after: { createdAt: at(101), id: imageId(21) } },
		});
		const second = await list(world, first.response.nextCursor);
		expect(second.response.items.map((item) => item.id)).toEqual([imageId(5)]);
		expect(second.warn).toHaveBeenCalledWith(expect.stringContaining("skipped imageRefs records"), {
			ids: [imageId(10)],
			count: 1,
		});
	});
});

// ---------------------------------------------------------------------------
// 足りない宣言
// ---------------------------------------------------------------------------

describe("足りない宣言(プラグインの定義の誤り)", () => {
	it.each([
		["content", { content: undefined }, "content:read"],
		[
			"getRevision",
			{ content: { get: vi.fn<ContentGet>(), getTrashedVersioned: vi.fn<ContentGetTrashed>() } },
			"content:revisions:read",
		],
		[
			"getTrashedVersioned",
			{ content: { get: vi.fn<ContentGet>(), getRevision: vi.fn<ContentGetRevision>() } },
			"content:restore",
		],
		["schema", { schema: undefined }, "schema:read"],
		["imageRefs", { storage: {} }, "imageRefs"],
	])("一覧: %s が無ければ、宣言を促す例外(500)", async (_label, override, message) => {
		const world = new FakeWorld();
		const { ctx } = listContext(world);
		await expect(handleImagesList({ ...ctx, ...override })).rejects.toThrow(message);
	});

	it.each([
		["content", { content: undefined }, "content:write"],
		["delete", { content: { getTrashedVersioned: vi.fn<ContentGetTrashed>() } }, "content:write"],
		["getTrashedVersioned", { content: { delete: vi.fn<ContentDelete>() } }, "content:restore"],
		["imageRefs", { storage: {} }, "imageRefs"],
	])("ゴミ箱への移動: %s が無ければ、宣言を促す例外(500)", async (_label, override, message) => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		const { ctx } = trashContext(world, imageId(1));
		await expect(handleImagesTrash({ ...ctx, ...override })).rejects.toThrow(message);
		expect(world.calls.delete).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// ゴミ箱への移動
// ---------------------------------------------------------------------------

/** `user` に null を渡すと、利用者の無い呼び出しにする */
function trashContext(world: FakeWorld, id: string, user: { id: string } | null = { id: "U1" }) {
	const info = vi.fn<Warn>();
	const ctx: ImagesTrashRouteContext = {
		input: { id },
		user: user ?? undefined,
		content: world.content,
		storage: { imageRefs: world.imageRefs },
		log: { info },
	};
	return { ctx, info };
}

describe("ゴミ箱への移動", () => {
	it("画像エントリをゴミ箱に移し、誰が移したかをログに出す(クエリ 9)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		const { ctx, info } = trashContext(world, imageId(1));
		const before = world.queries;
		const response = await handleImagesTrash(ctx);
		expect(response).toEqual({ id: imageId(1), trashed: true });
		expect(imagesTrashResponseSchema.safeParse(response).success).toBe(true);
		expect(world.entries.get(`${B64}/${imageId(1)}`)?.trashed).toBe(true);
		expect(world.refs.has(imageId(1))).toBe(true); // 記録は完全削除まで残す
		expect(info).toHaveBeenCalledWith(`Moved image ${imageId(1)} to the trash`, {
			id: imageId(1),
			userId: "U1",
		});
		expect(LIST_QUERY_COSTS.route + world.queries - before).toBe(1 + 1 + 7);
	});

	it("使用中の画像も移す(使用中かは確かめない。画面が確認してから呼ぶ)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { owners: [owner(postId(1))] });
		world.addEntry(postId(1), { cover: ref(imageId(1)) });
		const { ctx } = trashContext(world, imageId(1));
		await expect(handleImagesTrash(ctx)).resolves.toEqual({ id: imageId(1), trashed: true });
		expect(world.calls.get).toEqual([]);
		// 一覧では、ゴミ箱に入った使用中の画像になる
		const { response } = await list(world);
		expect(itemOf(response, imageId(1))).toMatchObject({ entryStatus: "trashed", usage: "in_use" });
	});

	it("もうゴミ箱に入っていれば、成功として返す(二度押し・ほかの人が先に移した)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { entry: "trashed" });
		const { ctx, info } = trashContext(world, imageId(1));
		const before = world.queries;
		await expect(handleImagesTrash(ctx)).resolves.toEqual({ id: imageId(1), trashed: true });
		expect(world.calls.getTrashedVersioned).toEqual([`${B64}/${imageId(1)}`]);
		expect(info).not.toHaveBeenCalled();
		// 記録 1 + delete(移せない)3 + getTrashedVersioned 4。ルートの固定費を足して 9(spike の実測と同じ)
		expect(LIST_QUERY_COSTS.route + world.queries - before).toBe(1 + 1 + 3 + 4);
	});

	it("画像エントリが無ければ 404 IMAGE_NOT_FOUND", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1), { entry: "missing" });
		const { ctx } = trashContext(world, imageId(1));
		const before = world.queries;
		const error = await handleImagesTrash(ctx).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(PluginRouteError);
		expect(error).toMatchObject({ code: "IMAGE_NOT_FOUND", status: 404 });
		// 記録 1 + delete 3 + getTrashedVersioned(無い)2。ルートの固定費を足して 7(spike の実測と同じ)
		expect(LIST_QUERY_COSTS.route + world.queries - before).toBe(1 + 1 + 3 + 2);
	});

	it("imageRefs に記録の無い画像(seed など)は、移さずに 404 IMAGE_NOT_FOUND", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		world.refs.delete(imageId(1));
		const { ctx } = trashContext(world, imageId(1));
		await expect(handleImagesTrash(ctx)).rejects.toMatchObject({
			code: "IMAGE_NOT_FOUND",
			status: 404,
		});
		expect(world.calls.delete).toEqual([]);
		expect(world.entries.get(`${B64}/${imageId(1)}`)?.trashed).toBe(false);
	});

	it("利用者の無い呼び出し(API トークンなど)でも移す。ログの userId は null", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		const { ctx, info } = trashContext(world, imageId(1), null);
		await handleImagesTrash(ctx);
		expect(info).toHaveBeenCalledWith(expect.any(String), { id: imageId(1), userId: null });
	});
});

// ---------------------------------------------------------------------------
// 完全削除の検知
// ---------------------------------------------------------------------------

function deletedContext(world: FakeWorld) {
	const error = vi.fn<Warn>();
	const ctx: ImageDeletedContext = { storage: { imageRefs: world.imageRefs }, log: { error } };
	return { ctx, error };
}

describe("完全削除の検知(content:afterDelete)", () => {
	it("b64_images の完全削除で、imageRefs の記録を消す(1 クエリ)。一覧から消える", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		world.addImage(imageId(2));
		const { ctx, error } = deletedContext(world);
		const before = world.queries;
		await expect(
			removeImageRefs({ id: imageId(1), collection: B64, permanent: true }, ctx),
		).resolves.toBe("removed");
		expect(world.queries - before).toBe(1);
		expect(world.refs.has(imageId(1))).toBe(false);
		expect(error).not.toHaveBeenCalled();
		const { response } = await list(world);
		expect(response.items.map((item) => item.id)).toEqual([imageId(2)]);
	});

	it("ゴミ箱への移動(permanent: false)とほかのコレクションは何もしない(0 クエリ)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		const { ctx } = deletedContext(world);
		await expect(
			removeImageRefs({ id: imageId(1), collection: B64, permanent: false }, ctx),
		).resolves.toBe("ignored");
		await expect(
			removeImageRefs({ id: imageId(1), collection: "posts", permanent: true }, ctx),
		).resolves.toBe("ignored");
		expect(world.queries).toBe(0);
		expect(world.refs.has(imageId(1))).toBe(true);
	});

	it("記録が無ければ not-found(seed の画像など。ログは出さない)", async () => {
		const world = new FakeWorld();
		const { ctx, error } = deletedContext(world);
		await expect(
			removeImageRefs({ id: imageId(1), collection: B64, permanent: true }, ctx),
		).resolves.toBe("not-found");
		expect(error).not.toHaveBeenCalled();
	});

	it("消せなければ failed でログに出し、例外は投げない", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		world.imageRefs.delete.mockRejectedValueOnce(new Error("D1_ERROR"));
		const { ctx, error } = deletedContext(world);
		await expect(
			removeImageRefsAfterDelete({ id: imageId(1), collection: B64, permanent: true }, ctx),
		).resolves.toBeUndefined();
		expect(error).toHaveBeenCalledWith(expect.stringContaining("failed to remove"), {
			collection: B64,
			id: imageId(1),
			error: "Error: D1_ERROR",
		});
	});

	it("ストレージの宣言が無ければ failed でログに出す", async () => {
		const error = vi.fn<Warn>();
		await expect(
			removeImageRefs(
				{ id: imageId(1), collection: B64, permanent: true },
				{ storage: {}, log: { error } },
			),
		).resolves.toBe("failed");
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining("imageRefs is missing"),
			expect.anything(),
		);
	});
});

/** 既定の設定(優先度 100・errorPolicy "abort")で、例外を投げる afterDelete を持つプラグイン */
function throwingPlugin(calls: string[]) {
	return definePlugin({
		id: "other-plugin",
		version: "0.0.0",
		capabilities: ["content:read"],
		hooks: {
			"content:afterDelete": async () => {
				calls.push("other-plugin");
				throw new Error("other plugin failed");
			},
		},
	});
}

describe("hook の登録(T29): EmDash の HookPipeline で実行する", () => {
	function pipelineWith(ctx: ImageDeletedContext, calls: string[]): HookPipeline {
		const plugin = definePlugin({
			id: "base64-image",
			version: "0.0.0",
			capabilities: ["content:read"],
			hooks: { ...imageDeletedHooks },
		});
		// 先に登録したプラグインが、同じ優先度なら先に実行される。例外を投げるプラグインを先に登録する
		const pipeline = createHookPipeline([throwingPlugin(calls), plugin]);
		// hook に渡す ctx を偽の ctx にする(本物はデータベースから作る)
		(pipeline as unknown as { getContext(): unknown }).getContext = () => ctx;
		return pipeline;
	}

	it("既定の優先度のプラグインが例外を投げても、記録は消える(先に実行される)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		const calls: string[] = [];
		const pipeline = pipelineWith(deletedContext(world).ctx, calls);
		await expect(pipeline.runContentAfterDelete(imageId(1), B64, true)).rejects.toThrow(
			"other plugin failed",
		);
		expect(calls).toEqual(["other-plugin"]);
		expect(world.refs.has(imageId(1))).toBe(false);
	});

	it("記録を消せなくても例外を投げないので、後に続くプラグインを止めない", async () => {
		const calls: string[] = [];
		const plugin = definePlugin({
			id: "base64-image",
			version: "0.0.0",
			capabilities: ["content:read"],
			hooks: { ...imageDeletedHooks },
		});
		const later = definePlugin({
			id: "later-plugin",
			version: "0.0.0",
			capabilities: ["content:read"],
			hooks: {
				"content:afterDelete": {
					priority: 200,
					handler: async () => {
						calls.push("later-plugin");
					},
				},
			},
		});
		const error = vi.fn<Warn>();
		const pipeline = createHookPipeline([plugin, later]);
		const failing: ImageDeletedContext = {
			storage: { imageRefs: { delete: async () => Promise.reject(new Error("D1_ERROR")) } },
			log: { error },
		};
		(pipeline as unknown as { getContext(): unknown }).getContext = () => failing;
		const results = await pipeline.runContentAfterDelete(imageId(1), B64, true);
		expect(results.map((result) => result.success)).toEqual([true, true]);
		expect(error).toHaveBeenCalledOnce();
		expect(calls).toEqual(["later-plugin"]);
	});

	it(`優先度は既定(100)より先の ${IMAGE_DELETED_HOOK_PRIORITY}、errorPolicy は "continue" として解決される`, () => {
		const plugin = definePlugin({
			id: "base64-image",
			version: "0.0.0",
			capabilities: ["content:read"],
			hooks: { ...imageDeletedHooks },
		});
		expect(plugin.hooks["content:afterDelete"]).toMatchObject({
			priority: IMAGE_DELETED_HOOK_PRIORITY,
			errorPolicy: "continue",
		});
		expect(IMAGE_DELETED_HOOK_PRIORITY).toBeLessThan(100);
	});

	it("capability content:read が無いと、EmDash は hook を登録しない(T29 は宣言する)", async () => {
		const world = new FakeWorld();
		world.addImage(imageId(1));
		const plugin = definePlugin({
			id: "base64-image",
			version: "0.0.0",
			capabilities: [],
			hooks: { ...imageDeletedHooks },
		});
		const pipeline = createHookPipeline([plugin]);
		(pipeline as unknown as { getContext(): unknown }).getContext = () => deletedContext(world).ctx;
		await pipeline.runContentAfterDelete(imageId(1), B64, true);
		expect(world.refs.has(imageId(1))).toBe(true);
	});
});

describe("型", () => {
	it("EmDash の content:afterDelete の handler として、そのまま登録できる(T29)", () => {
		expectTypeOf(removeImageRefsAfterDelete).toExtend<
			(event: ContentDeleteEvent, ctx: PluginContext) => Promise<void>
		>();
		expectTypeOf(imageDeletedHooks).toExtend<Pick<PluginHooks, "content:afterDelete">>();
		expectTypeOf<StorageCollection>().toExtend<ImageRefsRemover>();
	});
});
