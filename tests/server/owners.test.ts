import {
	createHookPipeline,
	definePlugin,
	type ContentHookEvent,
	type ContentPublishStateChangeEvent,
	type HookPipeline,
	type PluginContext,
	type PluginHooks,
	type StorageCollection,
} from "emdash";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
	MAX_APPEND_ATTEMPTS,
	OWNER_HOOK_PRIORITY,
	imageOwnerHooks,
	readReferencedImageIds,
	recordImageOwnersAfterPublish,
	recordImageOwnersAfterSave,
	trackImageOwners,
	type ImageRefsStore,
	type OwnerHookContext,
	type OwnerHookEvent,
	type VersionedRecord,
} from "../../src/server/hooks/owners";
import { IMAGE_REFS_BATCH_SIZE } from "../../src/server/image-refs";
import type { FieldSchemaLike } from "../../src/server/validate";
import { MAX_ITEMS_LIMIT } from "../../src/shared/constants";
import { imageRefsRecordSchema } from "../../src/shared/schema";
import type { Base64ImageRef, ImageOwner } from "../../src/shared/types";

/** D1 のバインド変数の上限(1 クエリ 100 個) */
const D1_MAX_BINDINGS = 100;
/** `getMany` が ID のほかに使うバインド変数(`plugin_id` と `collection`) */
const BINDINGS_BESIDES_IDS = 2;

const POSTS_FIELDS: FieldSchemaLike[] = [
	{ slug: "title", type: "string" },
	{ slug: "cover", type: "json", widget: "base64-image:image" },
	{ slug: "gallery", type: "json", widget: "base64-image:gallery", options: { maxItems: 3 } },
	// ほかのプラグインの widget を使う json フィールド
	{ slug: "accent", type: "json", widget: "color:picker" },
	// 型が json でないのに、widget だけがこのプラグインのもの(設定の誤り)
	{ slug: "caption", type: "string", widget: "base64-image:image" },
];

const ENTRY_A = "01J8Z3K4M5N6P7Q8R9S0ENTRYA";
const ENTRY_B = "01J8Z3K4M5N6P7Q8R9S0ENTRYB";

function imageId(n: number): string {
	return `01J8Z3K4M5N6P7Q8R9S0${String(n).padStart(6, "0")}`;
}

const IMG_1 = imageId(1);
const IMG_2 = imageId(2);
const IMG_3 = imageId(3);

function ref(id: string, overrides: Record<string, unknown> = {}): Base64ImageRef {
	return {
		v: 1,
		id,
		locale: "ja",
		width: 1280,
		height: 853,
		alt: "説明文",
		...overrides,
	} as Base64ImageRef;
}

function owner(field: string, entryId = ENTRY_A, overrides: Partial<ImageOwner> = {}): ImageOwner {
	return { collection: "posts", entryId, locale: "ja", field, ...overrides };
}

/** `imageRefsRecordSchema` に合う記録 */
function record(
	owners: unknown[] = [],
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		owners,
		bytes: 74_668,
		width: 1280,
		height: 853,
		thumb: "data:image/webp;base64,UklGRiIAAABXRUJQVlA4",
		createdAt: "2026-09-24T12:00:00.000Z",
		createdBy: "01J8USER0000000000000000AA",
		...extra,
	};
}

/**
 * 保存・公開したエントリの event。`content` は EmDash と同じく、エントリ全体(`id` / `locale` / `data`、
 * 更新のときは `liveData`)。
 */
function event(
	data: unknown,
	options: { liveData?: unknown; id?: unknown; locale?: unknown; collection?: string } = {},
): OwnerHookEvent {
	const content: Record<string, unknown> = {
		id: "id" in options ? options.id : ENTRY_A,
		type: options.collection ?? "posts",
		status: "draft",
		locale: "locale" in options ? options.locale : "ja",
		data,
	};
	if ("liveData" in options) content["liveData"] = options.liveData;
	return { collection: options.collection ?? "posts", content };
}

/** 次のタスクに処理を譲る(データベースの読み書きの待ち時間の代わり) */
function nextTask(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 偽の `imageRefs`。EmDash 0.39.1 の `PluginStorageRepository` と同じく:
 * - `getMany` は見つかった ID だけを持つ Map を返す。D1 と同じく、バインド変数(ID の数 + 2)が 100 個を超えると失敗する
 * - どの書き込みでも版(`revision`)が変わる。`compareAndSet` は、版が一致したときだけ書く(`null` は無いときだけ作る)
 * - 値は JSON にして保存する(`serializeConditionalValue`)。読み出しは毎回 JSON から作り直す
 *   (`references/emdash/packages/core/src/database/repositories/plugin-storage.ts:174-223`)
 */
class FakeImageRefs implements ImageRefsStore {
	readonly calls = {
		getMany: [] as string[][],
		getVersioned: [] as string[],
		compareAndSet: [] as string[],
	};
	/** 読み書きのたびに次のタスクへ譲る(並行に動く hook の読み書きを交互にする) */
	interleave = false;
	/** `compareAndSet` の直前に呼ぶ(ほかの書き込みを割り込ませる) */
	beforeCompareAndSet: ((id: string) => void) | undefined;
	/** `getVersioned` の直前に呼ぶ */
	beforeGetVersioned: ((id: string) => void) | undefined;
	/** 例外を投げる操作と ID */
	failOn: { method: "getMany" | "getVersioned" | "compareAndSet"; id?: string } | undefined;

	private readonly rows = new Map<string, { json: string; revision: string }>();
	private revisions = 0;

	/** ほかの経路(アップロードのルートの `put` など)での書き込み。版が変わる */
	write(id: string, value: unknown): void {
		this.rows.set(id, { json: JSON.stringify(value), revision: this.nextRevision() });
	}

	remove(id: string): void {
		this.rows.delete(id);
	}

	read(id: string): unknown {
		const row = this.rows.get(id);
		return row === undefined ? undefined : JSON.parse(row.json);
	}

	owners(id: string): unknown {
		return (this.read(id) as { owners?: unknown } | undefined)?.owners;
	}

	get writes(): number {
		return this.revisions;
	}

	async getMany(ids: string[]): Promise<Map<string, unknown>> {
		this.calls.getMany.push([...ids]);
		await this.pause();
		this.maybeFail("getMany");
		if (ids.length + BINDINGS_BESIDES_IDS > D1_MAX_BINDINGS) {
			throw new Error("D1_ERROR: too many SQL variables");
		}
		const found = new Map<string, unknown>();
		for (const id of ids) {
			const row = this.rows.get(id);
			if (row !== undefined) found.set(id, JSON.parse(row.json));
		}
		return found;
	}

	async getVersioned(id: string): Promise<VersionedRecord | null> {
		this.calls.getVersioned.push(id);
		this.beforeGetVersioned?.(id);
		await this.pause();
		this.maybeFail("getVersioned", id);
		const row = this.rows.get(id);
		return row === undefined ? null : { value: JSON.parse(row.json), revision: row.revision };
	}

	async compareAndSet(
		id: string,
		expectedRevision: string | null,
		data: unknown,
	): Promise<{ applied: true; revision: string } | { applied: false }> {
		this.calls.compareAndSet.push(id);
		this.beforeCompareAndSet?.(id);
		await this.pause();
		this.maybeFail("compareAndSet", id);
		const json = JSON.stringify(data);
		const row = this.rows.get(id);
		const matches =
			expectedRevision === null ? row === undefined : row?.revision === expectedRevision;
		if (!matches) return { applied: false };
		const revision = this.nextRevision();
		this.rows.set(id, { json, revision });
		return { applied: true, revision };
	}

	private nextRevision(): string {
		this.revisions += 1;
		return `rev-${this.revisions}`;
	}

	private async pause(): Promise<void> {
		if (this.interleave) await nextTask();
	}

	private maybeFail(method: "getMany" | "getVersioned" | "compareAndSet", id?: string): void {
		const failOn = this.failOn;
		if (failOn === undefined || failOn.method !== method) return;
		if (failOn.id !== undefined && failOn.id !== id) return;
		throw new Error(`database is locked (${method})`);
	}
}

interface LogCall {
	readonly message: string;
	readonly data: unknown;
}

interface FakeOptions {
	/** `getCollection` が返すフィールド。null ならコレクションが無い */
	fields?: FieldSchemaLike[] | null;
	/** false なら `ctx.schema` が無い(capability `schema:read` が無い) */
	schema?: false;
	/** false なら `ctx.storage.imageRefs` が無い(ストレージを宣言していない) */
	storage?: false;
	/** `getCollection` が投げる例外 */
	getCollectionError?: Error;
}

function fakeContext(options: FakeOptions = {}) {
	const store = new FakeImageRefs();
	const calls = { getCollection: [] as string[] };
	const logs = { warn: [] as LogCall[], error: [] as LogCall[] };
	const fields = options.fields === undefined ? POSTS_FIELDS : options.fields;
	const ctx: OwnerHookContext = {
		schema:
			options.schema === false
				? undefined
				: {
						async getCollection(slug) {
							calls.getCollection.push(slug);
							await (store.interleave ? nextTask() : Promise.resolve());
							if (options.getCollectionError) throw options.getCollectionError;
							return fields === null ? null : { fields };
						},
					},
		storage: options.storage === false ? {} : { imageRefs: store },
		log: {
			warn: (message, data) => logs.warn.push({ message, data }),
			error: (message, data) => logs.error.push({ message, data }),
		},
	};
	/** hook が使ったクエリの数(`getCollection` は 2、ほかは 1 回 1。`docs/emdash-plugin-content-query-counts.md`) */
	const queries = () =>
		calls.getCollection.length * 2 +
		store.calls.getMany.length +
		store.calls.getVersioned.length +
		store.calls.compareAndSet.length;
	return { ctx, store, calls, logs, queries };
}

function outcomes(result: { images: ReadonlyMap<string, string> }): Record<string, string> {
	return Object.fromEntries(result.images);
}

describe("trackImageOwners: 読み飛ばすもの(クエリなし)", () => {
	it("b64_images の保存では、何も読まない", async () => {
		const { ctx, store, queries } = fakeContext();
		store.write(IMG_1, record());
		const result = await trackImageOwners(
			event({ image: { src: "data:image/webp;base64,AA" } }, { collection: "b64_images" }),
			ctx,
			"content:afterPublish",
		);
		expect(result.skipped).toBe("image-collection");
		expect(queries()).toBe(0);
	});

	it.each([
		["画像のフィールドが空", { title: "T", cover: null, gallery: [] }],
		[
			"標準の画像フィールドの値(MediaValue)",
			{ title: "T", photo: { id: "media1", src: "/a.jpg" } },
		],
		["参照の形に合わない値", { cover: ref(IMG_1, { v: 2 }), gallery: [ref(IMG_2, { alt: 1 })] }],
		["data がオブジェクトでない", "not an object"],
	])("参照の形の値が無ければ、フィールド定義も記録も読まない(%s)", async (_label, data) => {
		const { ctx, queries } = fakeContext();
		const result = await trackImageOwners(event(data), ctx, "content:afterSave");
		expect(result.skipped).toBe("no-references");
		expect(queries()).toBe(0);
	});

	it.each([
		["ID が無い", { id: undefined }],
		["ロケールが null", { locale: null }],
		["ID に使えない文字", { id: "../posts" }],
	])(
		"エントリの ID・ロケールが参照元の形に合わなければ、記録せずに警告する(%s)",
		async (_label, entry) => {
			const { ctx, logs, queries } = fakeContext();
			const result = await trackImageOwners(
				event({ cover: ref(IMG_1) }, entry),
				ctx,
				"content:afterSave",
			);
			expect(result.skipped).toBe("invalid-entry");
			expect(queries()).toBe(0);
			expect(logs.warn).toHaveLength(1);
			expect(logs.warn[0]?.message).toContain("entry ID or locale is invalid");
		},
	);

	it("参照がこのプラグインの widget のフィールドに無ければ、記録を読まない(フィールド定義の 2 だけ)", async () => {
		const { ctx, store, queries } = fakeContext();
		const result = await trackImageOwners(
			// accent はほかのプラグインの widget、caption は json でない、notes は定義に無いフィールド
			event({ accent: ref(IMG_1), caption: ref(IMG_2), notes: [ref(IMG_3)] }),
			ctx,
			"content:afterSave",
		);
		expect(result.skipped).toBe("no-image-fields");
		expect(store.calls.getMany).toEqual([]);
		expect(queries()).toBe(2);
	});

	it("コレクションが無ければ、記録を読まない", async () => {
		const { ctx, store } = fakeContext({ fields: null });
		const result = await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(result.skipped).toBe("no-image-fields");
		expect(store.calls.getMany).toEqual([]);
	});
});

describe("trackImageOwners: 追記", () => {
	it("作成: 参照している画像の owners に、参照元(collection / entryId / locale / field)を追記する", async () => {
		const { ctx, store, calls, queries } = fakeContext();
		store.write(IMG_1, record());
		store.write(IMG_2, record());
		store.write(IMG_3, record());
		const result = await trackImageOwners(
			event({ title: "T", cover: ref(IMG_1), gallery: [ref(IMG_2), ref(IMG_3)] }),
			ctx,
			"content:afterSave",
		);
		expect(outcomes(result)).toEqual({
			[IMG_1]: "appended",
			[IMG_2]: "appended",
			[IMG_3]: "appended",
		});
		expect(store.owners(IMG_1)).toEqual([owner("cover")]);
		expect(store.owners(IMG_2)).toEqual([owner("gallery")]);
		expect(store.owners(IMG_3)).toEqual([owner("gallery")]);
		expect(calls.getCollection).toEqual(["posts"]);
		// フィールド定義 2 + getMany 1 + 画像ごとに getVersioned と compareAndSet
		expect(store.calls.getMany).toEqual([[IMG_1, IMG_2, IMG_3]]);
		expect(queries()).toBe(2 + 1 + 3 * 2);
	});

	it("記録済みの参照元は重複させず、書き込まない(ふつうの保存・自動保存はフィールド定義 2 + getMany 1)", async () => {
		const { ctx, store, queries } = fakeContext();
		store.write(IMG_1, record([owner("cover")]));
		const writesBefore = store.writes;
		const result = await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(outcomes(result)).toEqual({ [IMG_1]: "unchanged" });
		expect(store.writes).toBe(writesBefore);
		expect(store.calls.getVersioned).toEqual([]);
		expect(queries()).toBe(3);
	});

	it("既存の参照元を残し、まだ無い参照元だけを後ろに足す(別のエントリ・別のフィールドは別の参照元)", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record([owner("cover", ENTRY_B), owner("gallery")]));
		await trackImageOwners(
			event({ cover: ref(IMG_1), gallery: [ref(IMG_1)] }),
			ctx,
			"content:afterSave",
		);
		expect(store.owners(IMG_1)).toEqual([
			owner("cover", ENTRY_B),
			owner("gallery"),
			owner("cover"),
		]);
	});

	it("ロケールが違えば、別の参照元として記録する", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record([owner("cover", ENTRY_A, { locale: "en" })]));
		await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(store.owners(IMG_1)).toEqual([
			owner("cover", ENTRY_A, { locale: "en" }),
			owner("cover"),
		]);
	});

	it("下書き(data)と列の値(liveData)の両方から参照を集める", async () => {
		const { ctx, store } = fakeContext();
		for (const id of [IMG_1, IMG_2, IMG_3]) store.write(id, record());
		// 公開済みの投稿で、下書きの cover を IMG_1 から IMG_2 に差し替え、ギャラリーを空にした
		const result = await trackImageOwners(
			event(
				{ cover: ref(IMG_2), gallery: [] },
				{ liveData: { cover: ref(IMG_1), gallery: [ref(IMG_3)] } },
			),
			ctx,
			"content:afterSave",
		);
		expect(outcomes(result)).toEqual({
			[IMG_1]: "appended",
			[IMG_2]: "appended",
			[IMG_3]: "appended",
		});
		expect(store.owners(IMG_1)).toEqual([owner("cover")]);
		expect(store.owners(IMG_3)).toEqual([owner("gallery")]);
	});

	it("列の値(liveData)にだけ参照があっても、読み飛ばさない", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record());
		const result = await trackImageOwners(
			event({ cover: null }, { liveData: { cover: ref(IMG_1) } }),
			ctx,
			"content:afterSave",
		);
		expect(outcomes(result)).toEqual({ [IMG_1]: "appended" });
	});

	it("同じ画像を cover とギャラリーで使うと、参照元 2 つを 1 回で書く。ギャラリーの重複は 1 つにする", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record());
		await trackImageOwners(
			event({ cover: ref(IMG_1), gallery: [ref(IMG_1), ref(IMG_1, { alt: "別の alt" })] }),
			ctx,
			"content:afterSave",
		);
		expect(store.owners(IMG_1)).toEqual([owner("cover"), owner("gallery")]);
		expect(store.calls.compareAndSet).toEqual([IMG_1]);
	});

	it("ギャラリーの形の合わない要素は飛ばし、ほかの要素は記録する", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record());
		store.write(IMG_3, record());
		await trackImageOwners(
			event({ gallery: [ref(IMG_1), { id: IMG_2 }, "x", ref(IMG_3)] }),
			ctx,
			"content:afterSave",
		);
		expect(store.calls.getMany).toEqual([[IMG_1, IMG_3]]);
	});

	it("記録のほかのキー(知らないキーを含む)は、読んだまま残す", async () => {
		const { ctx, store } = fakeContext();
		const stored = record([], { futureKey: { nested: [1, 2] } });
		store.write(IMG_1, stored);
		await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(store.read(IMG_1)).toEqual({ ...stored, owners: [owner("cover")] });
	});

	it("afterPublish でも、公開したデータ(data)から記録する", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record());
		await recordImageOwnersAfterPublish(event({ cover: ref(IMG_1) }), ctx);
		expect(store.owners(IMG_1)).toEqual([owner("cover")]);
	});

	it("50 件ずつ getMany を呼ぶ(D1 のバインド変数の上限を超えない)", async () => {
		const galleries = Array.from({ length: 6 }, (_, index) => `g${index + 1}`);
		const fields: FieldSchemaLike[] = galleries.map((slug) => ({
			slug,
			type: "json",
			widget: "base64-image:gallery",
		}));
		const { ctx, store } = fakeContext({ fields });
		const data: Record<string, Base64ImageRef[]> = {};
		let n = 0;
		for (const slug of galleries) {
			data[slug] = Array.from({ length: MAX_ITEMS_LIMIT }, () => ref(imageId((n += 1))));
		}
		for (let i = 1; i <= n; i += 1) store.write(imageId(i), record());
		const result = await trackImageOwners(event(data), ctx, "content:afterSave");
		expect(n).toBe(120);
		expect(store.calls.getMany.map((ids) => ids.length)).toEqual([
			IMAGE_REFS_BATCH_SIZE,
			IMAGE_REFS_BATCH_SIZE,
			120 - 2 * IMAGE_REFS_BATCH_SIZE,
		]);
		expect([...result.images.values()].every((outcome) => outcome === "appended")).toBe(true);
	});
});

describe("trackImageOwners: 記録が無い・壊れている", () => {
	it("記録が無い画像(seed の画像など)には記録を作らず、ほかの画像は記録して、警告を 1 回出す", async () => {
		const { ctx, store, logs } = fakeContext();
		store.write(IMG_2, record());
		const result = await trackImageOwners(
			event({ cover: ref(IMG_1), gallery: [ref(IMG_2), ref(IMG_3)] }),
			ctx,
			"content:afterPublish",
		);
		expect(outcomes(result)).toEqual({
			[IMG_1]: "missing",
			[IMG_2]: "appended",
			[IMG_3]: "missing",
		});
		expect(store.read(IMG_1)).toBeUndefined();
		expect(store.read(IMG_3)).toBeUndefined();
		expect(logs.warn).toHaveLength(1);
		expect(logs.warn[0]?.message).toContain("without an imageRefs record");
		expect(logs.warn[0]?.data).toMatchObject({
			hook: "content:afterPublish",
			collection: "posts",
			entryId: ENTRY_A,
			ids: [IMG_1, IMG_3],
			count: 2,
		});
		expect(logs.error).toEqual([]);
	});

	it.each([
		["記録がオブジェクトでない", "not a record"],
		["記録が配列", [owner("cover")]],
		["owners が配列でない", record(undefined, { owners: { 0: "x" } })],
	])("%s: 書き込まず、エラーのログを出す", async (_label, stored) => {
		const { ctx, store, logs } = fakeContext();
		store.write(IMG_1, stored);
		const writesBefore = store.writes;
		const result = await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(outcomes(result)).toEqual({ [IMG_1]: "broken" });
		expect(store.writes).toBe(writesBefore);
		expect(store.read(IMG_1)).toEqual(stored);
		expect(logs.error).toHaveLength(1);
		expect(logs.error[0]?.data).toMatchObject({ ids: [IMG_1], count: 1 });
	});

	it("owners が無い記録には owners を作る(ほかが正しければ警告しない)", async () => {
		const { ctx, store, logs } = fakeContext();
		const { owners: _omitted, ...withoutOwners } = record();
		store.write(IMG_1, withoutOwners);
		await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(store.read(IMG_1)).toEqual({ ...withoutOwners, owners: [owner("cover")] });
		expect(imageRefsRecordSchema.safeParse(store.read(IMG_1)).success).toBe(true);
		expect(logs.warn).toEqual([]);
	});

	it("スキーマに合わない記録でも、owners が配列なら追記し(形の壊れた参照元も残す)、警告を出す", async () => {
		const { ctx, store, logs } = fakeContext();
		const malformed = { collection: "posts", entryId: ENTRY_B };
		store.write(IMG_1, record([malformed], { thumb: 123 }));
		const result = await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(outcomes(result)).toEqual({ [IMG_1]: "appended" });
		expect(store.read(IMG_1)).toEqual(record([malformed, owner("cover")], { thumb: 123 }));
		expect(logs.warn).toHaveLength(1);
		expect(logs.warn[0]?.message).toContain("do not match the schema");
		expect(logs.warn[0]?.data).toMatchObject({ ids: [IMG_1] });
	});

	it("形の壊れた既存の参照元でも、4 つのキーが同じなら記録済みとして扱う", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record([{ ...owner("cover"), extra: true }]));
		const result = await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(outcomes(result)).toEqual({ [IMG_1]: "unchanged" });
	});
});

describe("trackImageOwners: 同時の書き込み", () => {
	it("同じ画像を参照するエントリが同時に保存されても、どの参照元も消えない", async () => {
		const { ctx, store } = fakeContext();
		store.interleave = true;
		store.write(IMG_1, record());
		const entries = Array.from(
			{ length: MAX_APPEND_ATTEMPTS },
			(_, index) => `01J8Z3K4M5N6P7Q8R9S0ENTRY${index}`,
		);
		const results = await Promise.all(
			entries.map((id) =>
				trackImageOwners(event({ cover: ref(IMG_1) }, { id }), ctx, "content:afterSave"),
			),
		);
		expect(results.map((result) => result.images.get(IMG_1))).toEqual(
			entries.map(() => "appended"),
		);
		const recorded = (store.owners(IMG_1) as ImageOwner[]).map((item) => item.entryId);
		expect(recorded.toSorted()).toEqual(entries.toSorted());
		// 版が変わっていて読み直した分、compareAndSet は呼ばれる
		expect(store.calls.compareAndSet.length).toBeGreaterThan(entries.length);
	});

	it("版を読んでから書くまでにほかの参照元が足されたら、読み直して両方を残す", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record());
		let raced = false;
		store.beforeCompareAndSet = (id) => {
			if (raced) return;
			raced = true;
			store.write(id, record([owner("gallery", ENTRY_B)]));
		};
		const result = await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(outcomes(result)).toEqual({ [IMG_1]: "appended" });
		expect(store.owners(IMG_1)).toEqual([owner("gallery", ENTRY_B), owner("cover")]);
		expect(store.calls.getVersioned).toEqual([IMG_1, IMG_1]);
	});

	it("同じ参照元がほかの hook で先に書かれたら、読み直して書かずに終える(afterSave と afterPublish の重なり)", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record());
		let raced = false;
		store.beforeCompareAndSet = (id) => {
			if (raced) return;
			raced = true;
			store.write(id, record([owner("cover")]));
		};
		const result = await trackImageOwners(
			event({ cover: ref(IMG_1) }),
			ctx,
			"content:afterPublish",
		);
		expect(outcomes(result)).toEqual({ [IMG_1]: "unchanged" });
		expect(store.owners(IMG_1)).toEqual([owner("cover")]);
	});

	it("記録を読んでから書くまでに記録が消えたら(完全削除)、記録を作り直さない", async () => {
		const { ctx, store, logs } = fakeContext();
		store.write(IMG_1, record());
		store.beforeGetVersioned = (id) => store.remove(id);
		const result = await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(outcomes(result)).toEqual({ [IMG_1]: "missing" });
		expect(store.read(IMG_1)).toBeUndefined();
		expect(logs.warn).toHaveLength(1);
	});

	it(`版が変わり続けたら、${MAX_APPEND_ATTEMPTS} 回であきらめて警告を出す`, async () => {
		const { ctx, store, logs } = fakeContext();
		store.write(IMG_1, record());
		store.write(IMG_2, record());
		store.beforeCompareAndSet = (id) => {
			if (id === IMG_1) store.write(id, record());
		};
		const result = await trackImageOwners(
			event({ cover: ref(IMG_1), gallery: [ref(IMG_2)] }),
			ctx,
			"content:afterSave",
		);
		expect(outcomes(result)).toEqual({ [IMG_1]: "conflict", [IMG_2]: "appended" });
		expect(store.calls.getVersioned.filter((id) => id === IMG_1)).toHaveLength(MAX_APPEND_ATTEMPTS);
		expect(logs.warn).toHaveLength(1);
		expect(logs.warn[0]?.message).toContain("kept changing");
		expect(logs.warn[0]?.data).toMatchObject({ ids: [IMG_1], count: 1 });
	});
});

describe("trackImageOwners: 失敗しても例外を投げない", () => {
	it.each([
		["ctx.schema が無い", { schema: false } as const, "schema:read"],
		["imageRefs が無い", { storage: false } as const, "imageRefs"],
		["フィールド定義の読み出しの失敗", { getCollectionError: new Error("D1_ERROR") }, "D1_ERROR"],
	])("%s: エラーのログを出して終える", async (_label, options, expected) => {
		const { ctx, logs } = fakeContext(options);
		const result = await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(result.error).toBeInstanceOf(Error);
		expect(logs.error).toHaveLength(1);
		expect(logs.error[0]?.message).toContain("failed to record image owners");
		expect(JSON.stringify(logs.error[0]?.data)).toContain(expected);
	});

	it("記録の読み出し(getMany)の失敗", async () => {
		const { ctx, store, logs } = fakeContext();
		store.write(IMG_1, record());
		store.failOn = { method: "getMany" };
		const result = await trackImageOwners(event({ cover: ref(IMG_1) }), ctx, "content:afterSave");
		expect(result.error).toBeInstanceOf(Error);
		expect(logs.error[0]?.data).toMatchObject({ entryId: ENTRY_A });
	});

	it.each(["getVersioned", "compareAndSet"] as const)(
		"1 枚の %s が失敗しても、ほかの画像は記録する",
		async (method) => {
			const { ctx, store, logs } = fakeContext();
			store.write(IMG_1, record());
			store.write(IMG_2, record());
			store.failOn = { method, id: IMG_1 };
			const result = await trackImageOwners(
				event({ cover: ref(IMG_1), gallery: [ref(IMG_2)] }),
				ctx,
				"content:afterSave",
			);
			expect(outcomes(result)).toEqual({ [IMG_1]: "failed", [IMG_2]: "appended" });
			expect(store.owners(IMG_2)).toEqual([owner("gallery")]);
			expect(logs.error).toHaveLength(1);
			expect(logs.error[0]?.data).toMatchObject({ ids: [IMG_1], count: 1 });
			const data = logs.error[0]?.data as { error?: unknown } | undefined;
			expect(String(data?.error)).toContain(method);
		},
	);

	it("hook の本体(afterSave / afterPublish)は、失敗しても resolve する", async () => {
		const { ctx } = fakeContext({ getCollectionError: new Error("boom") });
		await expect(recordImageOwnersAfterSave(event({ cover: ref(IMG_1) }), ctx)).resolves.toBe(
			undefined,
		);
		await expect(recordImageOwnersAfterPublish(event({ cover: ref(IMG_1) }), ctx)).resolves.toBe(
			undefined,
		);
	});
});

describe("readReferencedImageIds", () => {
	it("単一画像は参照の形の値だけ、ギャラリーは参照の形の要素だけを返す", () => {
		expect(readReferencedImageIds(ref(IMG_1), "image")).toEqual([IMG_1]);
		expect(readReferencedImageIds([ref(IMG_1)], "image")).toEqual([]);
		expect(readReferencedImageIds(ref(IMG_1, { alt: "x".repeat(1001) }), "image")).toEqual([]);
		expect(readReferencedImageIds([ref(IMG_1), null, ref(IMG_2), ref(IMG_1)], "gallery")).toEqual([
			IMG_1,
			IMG_2,
			IMG_1,
		]);
		expect(readReferencedImageIds(ref(IMG_1), "gallery")).toEqual([]);
		expect(readReferencedImageIds(undefined, "gallery")).toEqual([]);
	});
});

/** 既定の設定(優先度 100・errorPolicy "abort")で、例外を投げる afterSave / afterPublish を持つプラグイン */
function throwingPlugin(calls: string[]) {
	return definePlugin({
		id: "other-plugin",
		version: "0.0.0",
		capabilities: ["content:read"],
		hooks: {
			"content:afterSave": async () => {
				calls.push("other-plugin");
				throw new Error("other plugin failed");
			},
			"content:afterPublish": async () => {
				calls.push("other-plugin");
				throw new Error("other plugin failed");
			},
		},
	});
}

describe("hook の登録(T29): EmDash の HookPipeline で実行する", () => {
	function pipelineWith(ctx: OwnerHookContext, calls: string[]): HookPipeline {
		const plugin = definePlugin({
			id: "base64-image",
			version: "0.0.0",
			capabilities: ["schema:read", "content:read"],
			hooks: { ...imageOwnerHooks },
		});
		// 先に登録したプラグインが、同じ優先度なら先に実行される。例外を投げるプラグインを先に登録する
		const pipeline = createHookPipeline([throwingPlugin(calls), plugin]);
		// hook に渡す ctx を偽の ctx にする(本物はデータベースから作る)
		(pipeline as unknown as { getContext(pluginId: string): unknown }).getContext = () => ctx;
		return pipeline;
	}

	it("既定の優先度のプラグインの afterSave が例外を投げても、参照元は記録される(先に実行される)", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record());
		const calls: string[] = [];
		const pipeline = pipelineWith(ctx, calls);
		const content = { id: ENTRY_A, locale: "ja", data: { cover: ref(IMG_1) } };
		await expect(pipeline.runContentAfterSave(content, "posts", true)).rejects.toThrow(
			"other plugin failed",
		);
		expect(calls).toEqual(["other-plugin"]);
		expect(store.owners(IMG_1)).toEqual([owner("cover")]);
	});

	it("afterPublish も同じ(一括公開)", async () => {
		const { ctx, store } = fakeContext();
		store.write(IMG_1, record());
		const pipeline = pipelineWith(ctx, []);
		const content = { id: ENTRY_A, locale: "ja", status: "published", data: { cover: ref(IMG_1) } };
		await expect(pipeline.runContentAfterPublish(content, "posts")).rejects.toThrow(
			"other plugin failed",
		);
		expect(store.owners(IMG_1)).toEqual([owner("cover")]);
	});

	it("記録に失敗しても例外を投げないので、後に続くプラグインを止めない", async () => {
		const { ctx } = fakeContext({ getCollectionError: new Error("D1_ERROR") });
		const calls: string[] = [];
		const pipeline = pipelineWith(ctx, calls);
		await expect(
			pipeline.runContentAfterSave(
				{ id: ENTRY_A, locale: "ja", data: { cover: ref(IMG_1) } },
				"posts",
				true,
			),
		).rejects.toThrow("other plugin failed");
		expect(calls).toEqual(["other-plugin"]);
	});

	it(`優先度は既定(100)より先の ${OWNER_HOOK_PRIORITY}、errorPolicy は "continue" として解決される`, () => {
		const plugin = definePlugin({
			id: "base64-image",
			version: "0.0.0",
			capabilities: ["content:read"],
			hooks: { ...imageOwnerHooks },
		});
		for (const name of ["content:afterSave", "content:afterPublish"] as const) {
			expect(plugin.hooks[name]).toMatchObject({
				priority: OWNER_HOOK_PRIORITY,
				errorPolicy: "continue",
			});
		}
	});
});

describe("型", () => {
	it("EmDash の content:afterSave / content:afterPublish の handler として、そのまま登録できる(T29)", () => {
		expectTypeOf(recordImageOwnersAfterSave).toExtend<
			(event: ContentHookEvent, ctx: PluginContext) => Promise<void>
		>();
		expectTypeOf(recordImageOwnersAfterPublish).toExtend<
			(event: ContentPublishStateChangeEvent, ctx: PluginContext) => Promise<void>
		>();
		expectTypeOf(imageOwnerHooks).toExtend<
			Pick<PluginHooks, "content:afterSave" | "content:afterPublish">
		>();
	});

	it("EmDash の StorageCollection を imageRefs として渡せる", () => {
		expectTypeOf<StorageCollection>().toExtend<ImageRefsStore>();
	});
});
