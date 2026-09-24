import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
	ContentSaveRejectedError,
	createHookPipeline,
	definePlugin,
	isContentSaveRejection,
	type ContentActionCallbacks,
	type ContentHookEvent,
	type HookPipeline,
	type PluginContext,
	type ResolvedPlugin,
} from "emdash";
import ts from "typescript";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { base64ImagePlugin, createPlugin } from "../../src/index";
import {
	IMAGE_DELETED_HOOK_PRIORITY,
	imageDeletedHooks,
} from "../../src/server/hooks/image-deleted";
import type { ReferenceFieldInfo } from "../../src/server/hooks/references";
import { OWNER_HOOK_PRIORITY, imageOwnerHooks } from "../../src/server/hooks/owners";
import {
	ADMIN_ENTRY,
	BEFORE_SAVE_HOOK_PRIORITY,
	PLUGIN_VERSION,
	checkImageCollection,
	createImageCollectionCheck,
	validateBeforeSave,
	type ImageCollectionCheckContext,
} from "../../src/server/plugin";
import { previewRoute, thumbnailsRoute } from "../../src/server/routes/admin-data";
import { imagesListRoute, imagesTrashRoute } from "../../src/server/routes/images-admin";
import { uploadRoute } from "../../src/server/routes/upload";
import { getFieldWidgetKind } from "../../src/server/validate";
import {
	IMAGE_COLLECTION,
	IMAGE_REFS_STORAGE,
	IMAGES_PAGE,
	PLUGIN_ID,
	ROUTES,
	SCHEMA_VERSION,
	WEBP_MIME_TYPE,
	WIDGET_IDS,
	WIDGET_KINDS,
} from "../../src/shared/constants";
import { toWebpDataUrl } from "../../src/shared/data-url";
import type { Base64ImageEntry, Base64ImageRef, ImageOwner } from "../../src/shared/types";

// ---------------------------------------------------------------------------
// テスト用の値
// ---------------------------------------------------------------------------

/** EmDash の hook の既定の priority(`references/emdash/packages/core/src/plugins/define-plugin.ts:270`) */
const DEFAULT_HOOK_PRIORITY = 100;

const POSTS_FIELDS: ReferenceFieldInfo[] = [
	{ slug: "title", label: "Title", type: "string" },
	{ slug: "cover", label: "Cover", type: "json", widget: WIDGET_IDS.image },
	{ slug: "gallery", label: "Gallery", type: "json", widget: WIDGET_IDS.gallery },
];
const IMAGE_FIELDS: ReferenceFieldInfo[] = [{ slug: "image", label: "Image", type: "json" }];

const ENTRY_A = "01J8Z3K4M5N6P7Q8R9S0ENTRYA";
const IMG_1 = "01J8Z3K4M5N6P7Q8R9S0000001";
const IMG_2 = "01J8Z3K4M5N6P7Q8R9S0000002";
const UNKNOWN_IMAGE = "01J8Z3K4M5N6P7Q8R9S0UNKNWN";

/** `tests/fixtures/webp/lossy.webp`(VP8、300 × 199、778 バイト) */
const LOSSY = Uint8Array.from(
	readFileSync(new URL("../fixtures/webp/lossy.webp", import.meta.url)),
);

/** 画像エントリの正しい値(T19 の検証を通る) */
function imageEntry(overrides: Partial<Base64ImageEntry> = {}): Base64ImageEntry {
	return {
		src: toWebpDataUrl(LOSSY),
		mimeType: WEBP_MIME_TYPE,
		width: 300,
		height: 199,
		meta: { v: SCHEMA_VERSION, bytes: LOSSY.length },
		...overrides,
	};
}

function ref(id: string): Base64ImageRef {
	return { v: SCHEMA_VERSION, id, locale: "ja", width: 300, height: 199, alt: "" };
}

function owner(field: string): ImageOwner {
	return { collection: "posts", entryId: ENTRY_A, locale: "ja", field };
}

/** `imageRefsRecordSchema` に合う記録 */
function refsRecord(owners: ImageOwner[] = []): Record<string, unknown> {
	return {
		owners,
		bytes: LOSSY.length,
		width: 300,
		height: 199,
		thumb: toWebpDataUrl(LOSSY),
		createdAt: "2026-09-24T12:00:00.000Z",
		createdBy: "01J8USER0000000000000000AA",
	};
}

// ---------------------------------------------------------------------------
// 偽のサイト(ctx)
// ---------------------------------------------------------------------------

interface Logged {
	readonly level: "error" | "warn" | "info" | "debug";
	readonly message: string;
	readonly data: unknown;
}

/**
 * 偽のサイト。`context()` が、このプラグインの部品が使う ctx(EmDash の `PluginContext` の一部)を返す。
 * - `schema.getCollection`: `collections` にあればフィールド定義を、無ければ null を返す
 * - `storage.imageRefs`: EmDash と同じく、書き込みのたびに版(`revision`)を変え、値は JSON にして持つ
 */
class FakeSite {
	readonly collections = new Map<string, ReferenceFieldInfo[]>([
		[IMAGE_COLLECTION, IMAGE_FIELDS],
		["posts", POSTS_FIELDS],
	]);
	readonly refs = new Map<string, { json: string; revision: number }>();
	readonly calls = {
		getCollection: [] as string[],
		compareAndSet: [] as string[],
		delete: [] as string[],
	};
	readonly logs: Logged[] = [];
	/** `getCollection("b64_images")` が投げる例外(データベースの失敗) */
	collectionError: Error | undefined;

	addRecord(id: string, record: Record<string, unknown> = refsRecord()): void {
		this.refs.set(id, { json: JSON.stringify(record), revision: 1 });
	}

	owners(id: string): unknown {
		const stored = this.refs.get(id);
		return stored === undefined
			? undefined
			: (JSON.parse(stored.json) as { owners: unknown }).owners;
	}

	/** b64_images の確認で読んだ回数 */
	imageCollectionReads(): number {
		return this.calls.getCollection.filter((slug) => slug === IMAGE_COLLECTION).length;
	}

	context() {
		const log = (level: Logged["level"]) => (message: string, data?: unknown) => {
			this.logs.push({ level, message, data });
		};
		return {
			schema: {
				getCollection: async (slug: string) => {
					this.calls.getCollection.push(slug);
					if (slug === IMAGE_COLLECTION && this.collectionError) throw this.collectionError;
					const fields = this.collections.get(slug);
					return fields === undefined ? null : { slug, fields };
				},
			},
			storage: {
				[IMAGE_REFS_STORAGE]: {
					getMany: async (ids: string[]) =>
						new Map(
							ids
								.filter((id) => this.refs.has(id))
								.map((id) => [id, JSON.parse(this.refs.get(id)!.json) as unknown]),
						),
					getVersioned: async (id: string) => {
						const stored = this.refs.get(id);
						return stored === undefined
							? null
							: { value: JSON.parse(stored.json) as unknown, revision: String(stored.revision) };
					},
					compareAndSet: async (id: string, expectedRevision: string | null, data: unknown) => {
						this.calls.compareAndSet.push(id);
						const stored = this.refs.get(id);
						const current = stored === undefined ? null : String(stored.revision);
						if (current !== expectedRevision) return { applied: false };
						this.refs.set(id, {
							json: JSON.stringify(data),
							revision: (stored?.revision ?? 0) + 1,
						});
						return { applied: true };
					},
					delete: async (id: string) => {
						this.calls.delete.push(id);
						return this.refs.delete(id);
					},
				},
			},
			log: { error: log("error"), warn: log("warn"), info: log("info"), debug: log("debug") },
		};
	}
}

/** EmDash の hook に渡すものとして、偽の ctx を使う(本物はデータベースから作る) */
function asPluginContext(site: FakeSite): PluginContext {
	return site.context() as unknown as PluginContext;
}

/** 本物の EmDash の HookPipeline に、プラグインを登録する。hook に渡す ctx だけを偽のサイトのものにする */
function pipelineWith(site: FakeSite, plugins: ResolvedPlugin[]): HookPipeline {
	const pipeline = createHookPipeline(plugins);
	(pipeline as unknown as { getContext(pluginId: string): unknown }).getContext = () =>
		site.context();
	return pipeline;
}

/** このプラグインの beforeSave の handler(`definePlugin` が解決したもの)を、偽の ctx で呼ぶ */
function beforeSave(plugin: ResolvedPlugin, site: FakeSite, event: ContentHookEvent) {
	const hook = plugin.hooks["content:beforeSave"];
	if (hook === undefined) throw new Error("content:beforeSave is not registered");
	return hook.handler(event, asPluginContext(site));
}

async function rejection(promise: Promise<unknown>): Promise<ContentSaveRejectedError> {
	const error: unknown = await promise.then(
		() => undefined,
		(reason: unknown) => reason,
	);
	expect(error).toBeInstanceOf(ContentSaveRejectedError);
	return error as ContentSaveRejectedError;
}

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 登録の中身
// ---------------------------------------------------------------------------

describe("createPlugin(): 登録の中身", () => {
	it("descriptor と同じ id・version・管理画面の入口を持つ", () => {
		const plugin = createPlugin();
		const descriptor = base64ImagePlugin();

		expect(plugin.id).toBe(PLUGIN_ID);
		expect(descriptor.id).toBe(PLUGIN_ID);
		expect(plugin.version).toBe(PLUGIN_VERSION);
		expect(descriptor.version).toBe(PLUGIN_VERSION);
		expect(plugin.admin.entry).toBe(ADMIN_ENTRY);
		expect(descriptor.adminEntry).toBe(ADMIN_ENTRY);
	});

	it("EmDash の HookPipeline が、5 つの hook をすべて登録する(登録に要る capability がそろっている)", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const pipeline = createHookPipeline([createPlugin()]);

		// beforeSave には content:write、after* には content:read が要る。無いと警告を出して黙って飛ばす
		expect(pipeline.getRegisteredHooks().toSorted()).toEqual([
			"content:afterDelete",
			"content:afterPublish",
			"content:afterSave",
			"content:beforeSave",
			"plugin:activate",
		]);
		expect(warn).not.toHaveBeenCalled();
	});

	it("EmDash が作る ctx に、ルートと hook が使うものがすべてある(capability とストレージの宣言)", () => {
		const context = emdashContext(createPlugin());
		const content = context.content as unknown as Record<string, unknown> | undefined;

		// [アクセサー, 要る capability・宣言, 使う部品]
		const required: Array<[unknown, string, string]> = [
			[context.schema?.getCollection, "schema:read", "T16・T18・T20・b64_images の確認"],
			[context.schema?.listCollections, "schema:read", "T21(消されたコレクション)"],
			[content?.["get"], "content:read", "T17 preview・T21 一覧"],
			[content?.["create"], "content:write", "T18 アップロード"],
			[content?.["delete"], "content:write", "T18 の後始末・T21 ゴミ箱"],
			[content?.["getVersioned"], "content:publish", "T18 アップロード"],
			[content?.["publish"], "content:publish", "T18 アップロード"],
			[content?.["getRevision"], "content:revisions:read", "T21 一覧(参照元の下書き)"],
			[content?.["getTrashedVersioned"], "content:restore", "T21 一覧・ゴミ箱"],
			[context.storage[IMAGE_REFS_STORAGE]?.getMany, "storage imageRefs", "T16・T17・T20"],
			[context.storage[IMAGE_REFS_STORAGE]?.query, "storage imageRefs", "T21 一覧"],
		];
		const missing = required
			.filter(([accessor]) => typeof accessor !== "function")
			.map(([, declaration, usedBy]) => `${declaration}(${usedBy})`);
		expect(missing).toEqual([]);
	});

	it("imageRefs の一覧の読み方(createdAt で絞って並べる。T21)を、EmDash のストレージが受け付ける(索引 createdAt)", async () => {
		const context = emdashContext(createPlugin());
		const imageRefs = context.storage[IMAGE_REFS_STORAGE];
		if (imageRefs === undefined) throw new Error("imageRefs is not declared");

		// 索引の無い項目なら、データベースを読む前に「non-indexed field」で拒否される。
		// 受け付けたときは、偽のデータベースに届いて DB_REACHED になる。
		await expect(
			imageRefs.query({
				where: { createdAt: { lte: "2026-09-24T12:00:00.000Z" } },
				orderBy: { createdAt: "desc" },
				limit: 10,
			}),
		).rejects.toThrow(DB_REACHED);
		await expect(imageRefs.query({ orderBy: { createdBy: "desc" } })).rejects.toThrow(
			"non-indexed field",
		);
	});

	it("ルート 5 つを、各タスクが export した定義のまま、ROUTES の名前で登録する", () => {
		const plugin = createPlugin();

		expect(Object.keys(plugin.routes).toSorted()).toEqual(Object.values(ROUTES).toSorted());
		expect(plugin.routes[ROUTES.upload]).toBe(uploadRoute);
		expect(plugin.routes[ROUTES.preview]).toBe(previewRoute);
		expect(plugin.routes[ROUTES.thumbnails]).toBe(thumbnailsRoute);
		expect(plugin.routes[ROUTES.imagesList]).toBe(imagesListRoute);
		expect(plugin.routes[ROUTES.imagesTrash]).toBe(imagesTrashRoute);
	});

	it(`beforeSave は errorPolicy "abort"(既定)で、priority は既定(${DEFAULT_HOOK_PRIORITY})より後の ${BEFORE_SAVE_HOOK_PRIORITY}`, () => {
		const hook = createPlugin().hooks["content:beforeSave"];

		expect(hook).toMatchObject({ errorPolicy: "abort", priority: BEFORE_SAVE_HOOK_PRIORITY });
		expect(BEFORE_SAVE_HOOK_PRIORITY).toBeGreaterThan(DEFAULT_HOOK_PRIORITY);
	});

	it("afterSave / afterPublish(T20)と afterDelete(T21)は、export された設定のまま(priority・errorPolicy を上書きしない)", () => {
		const { hooks } = createPlugin();

		for (const name of ["content:afterSave", "content:afterPublish"] as const) {
			expect(hooks[name]?.handler).toBe(imageOwnerHooks[name].handler);
			expect(hooks[name]).toMatchObject({ priority: OWNER_HOOK_PRIORITY, errorPolicy: "continue" });
		}
		expect(hooks["content:afterDelete"]?.handler).toBe(
			imageDeletedHooks["content:afterDelete"].handler,
		);
		expect(hooks["content:afterDelete"]).toMatchObject({
			priority: IMAGE_DELETED_HOOK_PRIORITY,
			errorPolicy: "continue",
		});
	});

	it("widget は WIDGET_KINDS の 2 つ。名前はフィールド定義の widget(WIDGET_IDS)の後ろの部分", () => {
		const widgets = createPlugin().admin.fieldWidgets ?? [];

		expect(widgets.map((widget) => widget.name)).toEqual([...WIDGET_KINDS]);
		for (const widget of widgets) {
			expect(Object.values(WIDGET_IDS)).toContain(`${PLUGIN_ID}:${widget.name}`);
			expect(widget.label).not.toBe("");
		}
	});

	it("widget の fieldTypes は、サーバーの検証(T11)がこのプラグインのフィールドとして扱う型だけ(json)", () => {
		const widgets = createPlugin().admin.fieldWidgets ?? [];

		for (const widget of widgets) {
			expect(widget.fieldTypes.length).toBeGreaterThan(0);
			for (const type of widget.fieldTypes) {
				// 宣言した型のフィールドで widget を使うと、アップロードと保存の検証の対象になる
				expect(
					getFieldWidgetKind({ slug: "field", type, widget: `${PLUGIN_ID}:${widget.name}` }),
				).toBe(widget.name);
			}
		}
	});

	it("画像管理ページは IMAGES_PAGE をそのまま登録する(値を書き写さない。ラベルは Lingui の ID)", () => {
		const { pages } = createPlugin().admin;

		expect(pages).toHaveLength(1);
		expect(pages?.[0]).toBe(IMAGES_PAGE);
	});

	it("createPlugin() を呼ぶたびに、別のプラグイン(b64_images の確認の状態も別)を作る", async () => {
		const first = createPlugin();
		const second = createPlugin();
		const site = new FakeSite();

		await beforeSave(first, site, { collection: "posts", content: { title: "a" }, isNew: true });
		await beforeSave(second, site, { collection: "posts", content: { title: "b" }, isNew: true });
		expect(site.imageCollectionReads()).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// beforeSave の振り分け(T19 と T16)
// ---------------------------------------------------------------------------

describe("validateBeforeSave: b64_images は T19、ほかは T16 に振り分ける", () => {
	it("b64_images の作成で、不正な画像を拒否する(T19)", async () => {
		const site = new FakeSite();
		const error = await rejection(
			validateBeforeSave(
				{
					collection: IMAGE_COLLECTION,
					isNew: true,
					content: { image: imageEntry({ width: 301 }) },
				},
				site.context(),
			),
		);

		expect(error.message).toMatch(/^画像エントリ\(b64_images\.image\)/);
		// T19 はクエリをしない(T16 のフィールド定義の読み出しにも回らない)
		expect(site.calls.getCollection).toEqual([]);
	});

	it("b64_images の更新で image が送られてきたら拒否する(T19)", async () => {
		const site = new FakeSite();
		const error = await rejection(
			validateBeforeSave(
				{ collection: IMAGE_COLLECTION, isNew: false, content: { image: imageEntry() } },
				site.context(),
			),
		);

		expect(error.message).toContain("作成したあとは変更できません");
	});

	it("b64_images の正しい作成は通す(値は変えない)", async () => {
		const site = new FakeSite();

		await expect(
			validateBeforeSave(
				{ collection: IMAGE_COLLECTION, isNew: true, content: { image: imageEntry() } },
				site.context(),
			),
		).resolves.toBeUndefined();
	});

	it("ほかのコレクションで、imageRefs に無い画像の参照を拒否する(T16)", async () => {
		const site = new FakeSite();
		site.addRecord(IMG_1);
		const error = await rejection(
			validateBeforeSave(
				{
					collection: "posts",
					isNew: true,
					content: { cover: ref(UNKNOWN_IMAGE), gallery: [ref(IMG_1)] },
				},
				site.context(),
			),
		);

		expect(error.message).toContain("画像フィールド「Cover」(cover)");
		expect(error.message).toContain(UNKNOWN_IMAGE);
		expect(site.calls.getCollection).toEqual(["posts"]);
	});

	it("ほかのコレクションで、b64_images の値の形(image)は確かめない(T19 に回さない)", async () => {
		const site = new FakeSite();

		// posts の image という名前の値は、このプラグインのフィールドではない
		await expect(
			validateBeforeSave(
				{ collection: "posts", isNew: true, content: { title: "a", image: "not an entry" } },
				site.context(),
			),
		).resolves.toBeUndefined();
	});

	it("ほかのコレクションの正しい参照は通す", async () => {
		const site = new FakeSite();
		site.addRecord(IMG_1);
		site.addRecord(IMG_2);

		await expect(
			validateBeforeSave(
				{ collection: "posts", isNew: true, content: { cover: ref(IMG_1), gallery: [ref(IMG_2)] } },
				site.context(),
			),
		).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// EmDash の HookPipeline で実行する
// ---------------------------------------------------------------------------

describe("hook を EmDash の HookPipeline で実行する", () => {
	it("beforeSave の拒否は捨てられずに、保存を止める(errorPolicy が abort)", async () => {
		const site = new FakeSite();
		const pipeline = pipelineWith(site, [createPlugin()]);

		const posts: unknown = await pipeline
			.runContentBeforeSave({ title: "a", cover: ref(UNKNOWN_IMAGE) }, "posts", true)
			.catch((error: unknown) => error);
		expect(isContentSaveRejection(posts)).toBe(true);

		const entry: unknown = await pipeline
			.runContentBeforeSave({ image: imageEntry({ height: 1 }) }, IMAGE_COLLECTION, true)
			.catch((error: unknown) => error);
		expect(isContentSaveRejection(entry)).toBe(true);
	});

	it("ほかのプラグインの beforeSave(既定の priority)が値を変えたあとの値を確かめる", async () => {
		const site = new FakeSite();
		site.addRecord(IMG_1);
		// 既定の priority で、cover を imageRefs に無い画像に書き換えるプラグイン。
		// このプラグインを先に登録する(priority が同じなら、先に登録したほうが先に実行される)
		const rewriter = definePlugin({
			id: "rewriter",
			version: "0.0.0",
			capabilities: ["content:write"],
			hooks: {
				"content:beforeSave": async (event) => ({ ...event.content, cover: ref(UNKNOWN_IMAGE) }),
			},
		});
		const pipeline = pipelineWith(site, [createPlugin(), rewriter]);

		const error: unknown = await pipeline
			.runContentBeforeSave({ title: "a", cover: ref(IMG_1) }, "posts", true)
			.catch((reason: unknown) => reason);
		expect(isContentSaveRejection(error)).toBe(true);
		expect((error as Error).message).toContain(UNKNOWN_IMAGE);
	});

	it("afterSave と afterPublish で、参照元を記録する(T20)", async () => {
		const site = new FakeSite();
		site.addRecord(IMG_1);
		site.addRecord(IMG_2);
		const pipeline = pipelineWith(site, [createPlugin()]);

		await pipeline.runContentAfterSave(
			{ id: ENTRY_A, locale: "ja", data: { cover: ref(IMG_1) } },
			"posts",
			true,
		);
		await pipeline.runContentAfterPublish(
			{ id: ENTRY_A, locale: "ja", status: "published", data: { gallery: [ref(IMG_2)] } },
			"posts",
		);

		expect(site.owners(IMG_1)).toEqual([owner("cover")]);
		expect(site.owners(IMG_2)).toEqual([owner("gallery")]);
	});

	it("afterDelete で、完全削除した画像の記録を消す(T21)。ゴミ箱への移動では消さない", async () => {
		const site = new FakeSite();
		site.addRecord(IMG_1);
		site.addRecord(IMG_2);
		const pipeline = pipelineWith(site, [createPlugin()]);

		await pipeline.runContentAfterDelete(IMG_1, IMAGE_COLLECTION, true);
		await pipeline.runContentAfterDelete(IMG_2, IMAGE_COLLECTION, false);

		expect(site.refs.has(IMG_1)).toBe(false);
		expect(site.refs.has(IMG_2)).toBe(true);
	});

	it("plugin:activate で b64_images を確かめ、無ければエラーのログを出す", async () => {
		const site = new FakeSite();
		site.collections.delete(IMAGE_COLLECTION);
		const pipeline = pipelineWith(site, [createPlugin()]);

		const results = await pipeline.runPluginActivate(PLUGIN_ID);

		expect(results.map((result) => result.success)).toEqual([true]);
		expect(site.logs).toEqual([
			{
				level: "error",
				message: expect.stringContaining(`"${IMAGE_COLLECTION}" collection does not exist`),
				data: { collection: IMAGE_COLLECTION, trigger: "plugin:activate" },
			},
		]);
	});

	it("plugin:activate は、b64_images があればログを出さない", async () => {
		const site = new FakeSite();
		const pipeline = pipelineWith(site, [createPlugin()]);

		await pipeline.runPluginActivate(PLUGIN_ID);

		expect(site.imageCollectionReads()).toBe(1);
		expect(site.logs).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// b64_images の確認(仕様書 13.1)
// ---------------------------------------------------------------------------

describe("最初の保存で b64_images を確かめる(beforeSave)", () => {
	it("最初の保存で 1 回だけ確かめ、無ければエラーのログを 1 回出す。保存は止めない", async () => {
		const site = new FakeSite();
		site.collections.delete(IMAGE_COLLECTION);
		const plugin = createPlugin();
		const save = (title: string) =>
			beforeSave(plugin, site, { collection: "posts", content: { title }, isNew: true });

		// 1 回目の確認が終わってから、次を保存する
		await expect(save("a")).resolves.toBeUndefined();
		await expect(save("b")).resolves.toBeUndefined();
		await expect(save("c")).resolves.toBeUndefined();

		expect(site.imageCollectionReads()).toBe(1);
		expect(site.logs).toEqual([
			{
				level: "error",
				message: expect.stringContaining(`"${IMAGE_COLLECTION}" collection does not exist`),
				data: { collection: IMAGE_COLLECTION, trigger: "content:beforeSave" },
			},
		]);
	});

	it("拒否する保存でも確かめ、拒否はそのまま返す", async () => {
		const site = new FakeSite();
		site.collections.delete(IMAGE_COLLECTION);

		await rejection(
			beforeSave(createPlugin(), site, {
				collection: "posts",
				content: { cover: ref(UNKNOWN_IMAGE) },
				isNew: true,
			}),
		);
		expect(site.logs.map((logged) => logged.level)).toEqual(["error"]);
	});

	it("b64_images への保存では確かめない(次のほかのコレクションの保存で確かめる)", async () => {
		const site = new FakeSite();
		const plugin = createPlugin();

		await beforeSave(plugin, site, {
			collection: IMAGE_COLLECTION,
			content: { image: imageEntry() },
			isNew: true,
		});
		expect(site.calls.getCollection).toEqual([]);

		await beforeSave(plugin, site, { collection: "posts", content: { title: "a" }, isNew: true });
		expect(site.imageCollectionReads()).toBe(1);
	});

	it("同時に来た最初の保存でも、確かめるのは 1 回", async () => {
		const site = new FakeSite();
		const plugin = createPlugin();

		await Promise.all(
			["a", "b", "c"].map((title) =>
				beforeSave(plugin, site, { collection: "posts", content: { title }, isNew: true }),
			),
		);
		expect(site.imageCollectionReads()).toBe(1);
	});

	it("確かめるのに失敗しても(データベースのエラー)、保存は止めずに警告を出す", async () => {
		const site = new FakeSite();
		site.collectionError = new Error("D1_ERROR: network");
		site.addRecord(IMG_1);

		await expect(
			beforeSave(createPlugin(), site, {
				collection: "posts",
				content: { cover: ref(IMG_1) },
				isNew: true,
			}),
		).resolves.toBeUndefined();
		expect(site.logs).toEqual([
			{
				level: "warn",
				message: expect.stringContaining(IMAGE_COLLECTION),
				data: expect.objectContaining({ error: "Error: D1_ERROR: network" }),
			},
		]);
	});
});

/** 確認が使う部分だけの ctx。`withSchema` が false なら `ctx.schema` が無い(capability `schema:read` が無い) */
function checkContext(site: FakeSite, withSchema = true): ImageCollectionCheckContext {
	const context = site.context();
	return { schema: withSchema ? context.schema : undefined, log: context.log };
}

describe("checkImageCollection / createImageCollectionCheck", () => {
	it("あれば exists で、ログを出さない", async () => {
		const site = new FakeSite();

		await expect(checkImageCollection(checkContext(site), "plugin:activate")).resolves.toBe(
			"exists",
		);
		expect(site.calls.getCollection).toEqual([IMAGE_COLLECTION]);
		expect(site.logs).toEqual([]);
	});

	it("無ければ missing で、作り方(seed・routable: false・json の image)を書いたエラーのログを出す", async () => {
		const site = new FakeSite();
		site.collections.delete(IMAGE_COLLECTION);

		await expect(checkImageCollection(checkContext(site), "content:beforeSave")).resolves.toBe(
			"missing",
		);
		expect(site.logs).toHaveLength(1);
		const [logged] = site.logs;
		expect(logged?.level).toBe("error");
		for (const hint of [
			"seed",
			"routable: false",
			'"image" field of type json',
			"IMAGE_COLLECTION_MISSING",
		]) {
			expect(logged?.message).toContain(hint);
		}
	});

	it("ctx.schema が無ければ unknown で、schema:read の宣言を促すエラーのログを出す", async () => {
		const site = new FakeSite();

		await expect(checkImageCollection(checkContext(site, false), "plugin:activate")).resolves.toBe(
			"unknown",
		);
		expect(site.logs).toEqual([
			{
				level: "error",
				message: expect.stringContaining('"schema:read"'),
				data: { collection: IMAGE_COLLECTION, trigger: "plugin:activate" },
			},
		]);
	});

	it("読み出しが例外を投げたら unknown で、警告を出す(例外は投げない)", async () => {
		const site = new FakeSite();
		site.collectionError = new TypeError("boom");

		await expect(checkImageCollection(checkContext(site), "plugin:activate")).resolves.toBe(
			"unknown",
		);
		expect(site.logs.map((logged) => [logged.level, logged.data])).toEqual([
			[
				"warn",
				{ collection: IMAGE_COLLECTION, trigger: "plugin:activate", error: "TypeError: boom" },
			],
		]);
	});

	it("1 回だけの確認は、2 回目から skipped で読まない。1 回目が unknown でもやり直さない", async () => {
		const site = new FakeSite();
		site.collectionError = new Error("D1_ERROR");
		const check = createImageCollectionCheck();

		await expect(check(checkContext(site), "content:beforeSave")).resolves.toBe("unknown");
		site.collectionError = undefined;
		await expect(check(checkContext(site), "content:beforeSave")).resolves.toBe("skipped");
		expect(site.imageCollectionReads()).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// サーバーの入口が読み込むもの
// ---------------------------------------------------------------------------

describe("サーバーの入口(src/index.ts)が読み込むもの", () => {
	it("src/server と src/shared だけを辿り、外部は emdash と zod だけ(管理画面の部品・React・Kumo を読み込まない)", () => {
		const { files, packages } = collectImports("src/index.ts");

		expect(files.filter((file) => !/^src\/(?:index\.ts$|server\/|shared\/)/.test(file))).toEqual(
			[],
		);
		expect(files).toContain("src/server/plugin.ts");
		expect(packages.toSorted()).toEqual(["emdash", "zod"]);
	});
});

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

describe("型", () => {
	it("createPlugin() は EmDash の ResolvedPlugin", () => {
		expectTypeOf(createPlugin).returns.toExtend<ResolvedPlugin>();
	});

	it("振り分けと確認に、EmDash の event と ctx をそのまま渡せる", () => {
		expectTypeOf(validateBeforeSave).toExtend<
			(event: ContentHookEvent, ctx: PluginContext) => Promise<void>
		>();
		expectTypeOf<PluginContext>().toExtend<ImageCollectionCheckContext>();
	});
});

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** 偽のデータベースに届いたことを示すエラーの文 */
const DB_REACHED = "DB_REACHED";

/**
 * EmDash の `PluginContextFactory`(HookPipeline が hook ごとに使うもの)で、プラグインの ctx を作る。
 * ctx はプラグインの capability とストレージの宣言だけで決まる。データベースは、使われたら DB_REACHED を投げる偽物にする。
 */
function emdashContext(plugin: ResolvedPlugin): PluginContext {
	const unusable = () => {
		throw new Error(DB_REACHED);
	};
	const db = new Proxy(
		{},
		{ get: (_target, property) => (property === "then" ? undefined : unusable) },
	);
	const contentActions = new Proxy({}, { get: () => unusable }) as ContentActionCallbacks;
	const pipeline = createHookPipeline([plugin], { db: db as never, contentActions });
	return (pipeline as unknown as { getContext(pluginId: string): PluginContext }).getContext(
		plugin.id,
	);
}

/**
 * `start` から相対パスの import を辿り、読み込むファイル(リポジトリのルートからのパス)と外部のパッケージを集める。
 * `import type` と `export … from` も含める(利用者のサイトの tsc は、型だけの import も辿る)。
 */
function collectImports(start: string): { files: string[]; packages: string[] } {
	const root = new URL("../../", import.meta.url);
	const files = new Set<string>();
	const packages = new Set<string>();
	const queue = [start];
	while (queue.length > 0) {
		const file = queue.pop()!;
		if (files.has(file)) continue;
		files.add(file);
		const source = readFileSync(new URL(file, root), "utf8");
		for (const { fileName } of ts.preProcessFile(source, true, true).importedFiles) {
			if (fileName.startsWith(".")) {
				queue.push(resolveSource(path.posix.join(path.posix.dirname(file), fileName), root));
			} else {
				packages.add(
					fileName.startsWith("@") ? fileName.split("/", 2).join("/") : fileName.split("/")[0]!,
				);
			}
		}
	}
	return { files: [...files], packages: [...packages] };
}

function resolveSource(base: string, root: URL): string {
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
		if (/\.tsx?$/.test(candidate) && existsSync(new URL(candidate, root))) return candidate;
	}
	throw new Error(`cannot resolve ${base}`);
}
