import { readFileSync } from "node:fs";

import type { I18nConfig, RouteContext } from "emdash";
import { definePlugin, PluginRouteError } from "emdash";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
	DEFAULT_CONTENT_LOCALE,
	MAX_HOOK_MESSAGE_LENGTH,
	MAX_TARGET_LOCALE_LENGTH,
	UPLOAD_MAX_BODY_BYTES,
	createUploadHandler,
	defaultContentLocale,
	handleUpload,
	resolveTargetLocale,
	uploadRoute,
	type CreatedEntry,
	type I18nConfigLike,
	type ImageRefsWriter,
	type UploadContentAccess,
	type UploadRouteContext,
} from "../../src/server/routes/upload";
import { validateImageEntry, type CollectionSchemaLike } from "../../src/server/validate";
import {
	IMAGE_COLLECTION,
	IMAGE_REFS_STORAGE,
	MAX_FILENAME_LENGTH,
	MAX_STORED_BYTES_LIMIT,
	PLUGIN_ID,
	ROUTES,
	THUMB_MAX_STORED_BYTES,
	WEBP_MAX_DIMENSION,
	WIDGET_IDS,
} from "../../src/shared/constants";
import { toWebpDataUrl } from "../../src/shared/data-url";
import { ERROR_HTTP_STATUS } from "../../src/shared/errors";
import {
	imageRefsRecordSchema,
	uploadRequestSchema,
	uploadResponseSchema,
} from "../../src/shared/schema";
import type { ImageRefsRecord, UploadRequest } from "../../src/shared/types";

// ---------------------------------------------------------------------------
// テスト用の値
// ---------------------------------------------------------------------------

/** tests/fixtures/webp/ の WebP(作り方は同じディレクトリの README.md) */
function fixture(name: string): Uint8Array {
	return Uint8Array.from(readFileSync(new URL(`../fixtures/webp/${name}`, import.meta.url)));
}

/** 画像本体: VP8、300 × 199、778 バイト */
const MAIN = fixture("lossy.webp");
/** サムネイル: VP8X + VP8L + XMP、63 × 37 */
const THUMB = fixture("lossless-xmp.webp");

const IMAGE_ID = "01M38TESTIMAGE000000000001";
const POST_ID = "01M38TESTPOST0000000000001";
const USER_ID = "01M38TESTUSER0000000000001";
const REV = "MjoyMDI2LTA5LTI0VDEyOjM0OjU2Ljc4OVo=";
const NOW = new Date("2026-09-24T12:34:56.789Z");

/** `posts` のフィールド定義(playground の seed と同じ) */
const POSTS: CollectionSchemaLike = {
	slug: "posts",
	fields: [
		{ slug: "title", type: "string" },
		{ slug: "cover", type: "json", widget: WIDGET_IDS.image, options: { maxStoredBytes: 100_000 } },
		{
			slug: "gallery",
			type: "json",
			widget: WIDGET_IDS.gallery,
			options: { maxStoredBytes: 100_000, maxItems: 10 },
		},
	],
};

/** i18n を設定したサイト(既定のロケールは ja) */
const I18N: I18nConfigLike = { defaultLocale: "ja", locales: ["ja", "en-US"] };

function validInput(): UploadRequest {
	return {
		dataUrl: toWebpDataUrl(MAIN),
		thumb: toWebpDataUrl(THUMB),
		width: 300,
		height: 199,
		quality: 0.77,
		filename: "IMG_0001.jpg",
		target: { collection: "posts", field: "cover" },
	};
}

/** EmDash の content の操作が投げる例外の形(`references/emdash/packages/core/src/emdash-runtime.ts:2150`) */
function emdashError(code: string, message = `${code} happened`): Error {
	return Object.assign(new Error(message), { name: code, code });
}

// ---------------------------------------------------------------------------
// 偽の ctx
// ---------------------------------------------------------------------------

/** `ctx.content` の偽物の振る舞い */
interface ContentBehavior {
	readonly createError?: unknown;
	/** `create` が返すロケール(既定は "en") */
	readonly createdLocale?: string | null;
	/** `getVersioned` が返す値(既定は `{ _rev: REV }`) */
	readonly versioned?: { readonly _rev: string } | null;
	readonly getVersionedError?: unknown;
	readonly publishError?: unknown;
	/** `delete` の戻り値(既定は true) */
	readonly deleteResult?: boolean;
	readonly deleteError?: unknown;
}

/**
 * `ctx.content` の偽物。呼び出しを `events` に記録する。
 * メソッドは `this` を使うので、ハンドラーがメソッドを取り出して呼ぶと例外になる。EmDash 0.39.1 のネイティブの実装は
 * `this` に頼らない(`references/emdash/packages/core/src/plugins/context.ts:206-226`、`:757-`)が、型はメソッドなので、
 * `this` に頼る実装でも動くことをこの偽物で確かめる。
 */
class FakeContent implements Required<UploadContentAccess> {
	readonly created: { collection: string; data: Record<string, unknown> }[] = [];

	constructor(
		private readonly events: string[],
		private readonly behavior: ContentBehavior,
	) {}

	async create(collection: string, data: Record<string, unknown>): Promise<CreatedEntry> {
		this.events.push(`content.create:${collection}`);
		this.created.push({ collection, data: structuredClone(data) });
		if (this.behavior.createError !== undefined) throw this.behavior.createError;
		const locale = this.behavior.createdLocale;
		return { id: IMAGE_ID, locale: locale === undefined ? "en" : locale };
	}

	async getVersioned(collection: string, id: string): Promise<{ readonly _rev: string } | null> {
		this.events.push(`content.getVersioned:${collection}:${id}`);
		if (this.behavior.getVersionedError !== undefined) throw this.behavior.getVersionedError;
		return this.behavior.versioned === undefined ? { _rev: REV } : this.behavior.versioned;
	}

	async publish(collection: string, id: string, { _rev: rev }: { _rev: string }): Promise<unknown> {
		this.events.push(`content.publish:${collection}:${id}:${rev}`);
		if (this.behavior.publishError !== undefined) throw this.behavior.publishError;
		return { item: { id }, _rev: "next" };
	}

	async delete(collection: string, id: string): Promise<boolean> {
		this.events.push(`content.delete:${collection}:${id}`);
		if (this.behavior.deleteError !== undefined) throw this.behavior.deleteError;
		return this.behavior.deleteResult ?? true;
	}
}

/** `ctx.storage.imageRefs` の偽物(`this` を使う) */
class FakeImageRefs implements ImageRefsWriter {
	readonly records = new Map<string, ImageRefsRecord>();

	constructor(
		private readonly events: string[],
		private readonly putError: unknown,
	) {}

	async put(id: string, data: ImageRefsRecord): Promise<void> {
		this.events.push(`imageRefs.put:${id}`);
		if (this.putError !== undefined) throw this.putError;
		this.records.set(id, structuredClone(data));
	}
}

interface SetupOptions extends ContentBehavior {
	readonly input?: Partial<UploadRequest>;
	/** `ctx.schema.getCollection` が返す値(既定は `POSTS`) */
	readonly collection?: CollectionSchemaLike | null;
	readonly putError?: unknown;
	readonly i18n?: I18nConfigLike | null;
}

function setup(options: SetupOptions = {}) {
	const events: string[] = [];
	const content = new FakeContent(events, options);
	const imageRefs = new FakeImageRefs(events, options.putError);
	const getCollection = vi.fn<(slug: string) => Promise<CollectionSchemaLike | null>>(
		async (slug) => {
			events.push(`schema.getCollection:${slug}`);
			return options.collection === undefined ? POSTS : options.collection;
		},
	);
	const logError = vi.fn<(message: string, data?: unknown) => void>();
	const ctx: UploadRouteContext = {
		input: { ...validInput(), ...options.input },
		user: { id: USER_ID },
		schema: { getCollection },
		content,
		storage: { [IMAGE_REFS_STORAGE]: imageRefs },
		log: { error: logError },
	};
	const handler = createUploadHandler({
		getI18nConfig: () => options.i18n ?? null,
		now: () => NOW,
	});
	return {
		ctx,
		events,
		content,
		imageRefs,
		logError,
		run: (override: Partial<UploadRouteContext> = {}) => handler({ ...ctx, ...override }),
	};
}

/** Promise が reject した値(resolve したらテストを失敗させる) */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("resolve した(reject するはず)");
}

/** EmDash が HTTP の応答に変える `PluginRouteError` か */
function expectRouteError(error: unknown, code: string, status: number): PluginRouteError {
	expect(error).toBeInstanceOf(PluginRouteError);
	expect(error).toMatchObject({ code, status });
	return error as PluginRouteError;
}

/** 作成を始める前に止まったこと(何も作っていない) */
function expectNothingWritten(events: readonly string[]): void {
	expect(events.filter((event) => !event.startsWith("schema.getCollection:"))).toStrictEqual([]);
}

// ---------------------------------------------------------------------------
// ルートの宣言
// ---------------------------------------------------------------------------

describe("ルートの宣言", () => {
	it("content:create・POST・JSON の body(600,000 バイトまで)・入力のスキーマ・ハンドラーを宣言する", () => {
		expect(uploadRoute.permission).toBe("content:create");
		expect(uploadRoute.methods).toStrictEqual(["POST"]);
		expect(uploadRoute.request).toStrictEqual({ body: "json", maxBytes: UPLOAD_MAX_BODY_BYTES });
		expect(UPLOAD_MAX_BODY_BYTES).toBe(600_000);
		expect(uploadRoute.input).toBe(uploadRequestSchema);
		expect(uploadRoute.handler).toBe(handleUpload);
		expect(uploadRoute.public).toBeUndefined();
	});

	it("EmDash がルートに渡す ctx と i18n の設定を、そのまま受け取れる", () => {
		expectTypeOf<RouteContext<UploadRequest>>().toExtend<UploadRouteContext>();
		expectTypeOf<I18nConfig>().toExtend<I18nConfigLike>();
	});

	it("T29 の登録の形で definePlugin に渡せる(capability の名前が正しい)", () => {
		const plugin = definePlugin({
			id: PLUGIN_ID,
			version: "0.0.0",
			capabilities: ["schema:read", "content:write", "content:publish"],
			storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } },
			routes: { [ROUTES.upload]: uploadRoute },
		});
		expect(plugin.routes[ROUTES.upload]).toBe(uploadRoute);
		// content:write と content:publish は content:read を含む
		// (`references/emdash/packages/core/src/plugins/types.ts:84-95` の PLUGIN_CAPABILITY_IMPLICATIONS)
		expect(plugin.capabilities).toStrictEqual([
			"schema:read",
			"content:write",
			"content:publish",
			"content:read",
		]);
	});

	it("スキーマに合わない入力を拒否する(input の書き忘れは型エラーにならない)", () => {
		const input = uploadRoute.input;
		expect(input?.safeParse(validInput()).success).toBe(true);
		expect(input?.safeParse({ ...validInput(), width: 0 }).success).toBe(false);
		expect(input?.safeParse({ ...validInput(), extra: 1 }).success).toBe(false);
		const { target: _target, ...withoutTarget } = validInput();
		expect(input?.safeParse(withoutTarget).success).toBe(false);
	});
});

/** 固定上限まで詰めた、正しい入力(`target.locale` は i18n の無いサイトの上限の長さ) */
function largestInput(): UploadRequest {
	const prefix = "data:image/webp;base64,";
	return {
		dataUrl: prefix + "A".repeat(MAX_STORED_BYTES_LIMIT - prefix.length),
		thumb: prefix + "A".repeat(THUMB_MAX_STORED_BYTES - prefix.length),
		width: WEBP_MAX_DIMENSION,
		height: WEBP_MAX_DIMENSION,
		// JSON で最も長くなる形の画質(24 文字)
		quality: 0.0000012345678901234567,
		// UTF-8 で 4 バイトの文字(zod はコードポイントで数える)
		filename: "😀".repeat(MAX_FILENAME_LENGTH),
		target: {
			collection: "c".repeat(63),
			field: "f".repeat(63),
			entryId: "E".repeat(128),
			locale: "en-abcdefgh-abcdefgh-abcdefgh-abcde",
		},
	};
}

function utf8Bytes(text: string): number {
	return new TextEncoder().encode(text).length;
}

describe("body の上限", () => {
	it("固定上限の入力の body が上限に収まる(ASCII 以外を \\uXXXX で書いた JSON も)", () => {
		const input = largestInput();
		expect(input.target.locale).toHaveLength(MAX_TARGET_LOCALE_LENGTH);
		expect(uploadRequestSchema.safeParse(input).success).toBe(true);

		const json = JSON.stringify(input);
		const escaped = json.replace(
			/[\u0080-￿]/g,
			(c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
		expect(utf8Bytes(json)).toBe(509_475);
		expect(utf8Bytes(escaped)).toBe(511_515);
		expect(utf8Bytes(escaped)).toBeLessThanOrEqual(UPLOAD_MAX_BODY_BYTES);
	});
});

// ---------------------------------------------------------------------------
// ロケール
// ---------------------------------------------------------------------------

describe("ロケール", () => {
	it("画像エントリのロケールは、サイトの既定ロケール(i18n が無ければ en)", () => {
		expect(DEFAULT_CONTENT_LOCALE).toBe("en");
		expect(defaultContentLocale(null)).toBe("en");
		expect(defaultContentLocale(I18N)).toBe("ja");
	});

	it("target.locale を省くと、サイトの既定ロケール", () => {
		expect(resolveTargetLocale(undefined, null)).toStrictEqual({ ok: true, locale: "en" });
		expect(resolveTargetLocale(undefined, I18N)).toStrictEqual({ ok: true, locale: "ja" });
	});

	it("i18n のサイト: 設定されたロケールだけを受け付け、設定の表記にそろえる", () => {
		expect(resolveTargetLocale("ja", I18N)).toStrictEqual({ ok: true, locale: "ja" });
		expect(resolveTargetLocale("EN-us", I18N)).toStrictEqual({ ok: true, locale: "en-US" });
		expect(resolveTargetLocale("en", I18N).ok).toBe(false);
		expect(resolveTargetLocale("fr", I18N)).toStrictEqual({
			ok: false,
			message: 'target.locale "fr" is not configured for this site (configured: ja, en-US)',
		});
	});

	it("i18n の無いサイト: 形はスキーマに任せ、長さを 35 文字までにする(表記は変えない)", () => {
		expect(resolveTargetLocale("EN", null)).toStrictEqual({ ok: true, locale: "EN" });
		const longest = "en-abcdefgh-abcdefgh-abcdefgh-abcde";
		expect(longest).toHaveLength(MAX_TARGET_LOCALE_LENGTH);
		expect(resolveTargetLocale(longest, null)).toStrictEqual({ ok: true, locale: longest });
		expect(resolveTargetLocale(`${longest}f`, null)).toStrictEqual({
			ok: false,
			message: "target.locale is 36 characters long, which exceeds the limit of 35",
		});
	});

	it("メッセージに長いロケールをそのまま入れない", () => {
		const result = resolveTargetLocale(`en-${"abcdefgh-".repeat(50_000)}ab`, I18N);
		expect(result.ok).toBe(false);
		const message = result.ok === false ? result.message : "";
		expect(message).toContain("…");
		expect(message.length).toBeLessThan(200);
	});
});

// ---------------------------------------------------------------------------
// 正しいアップロード
// ---------------------------------------------------------------------------

describe("正しいアップロード", () => {
	it("検証 → 作成 → imageRefs → getVersioned → publish の順に呼び、参照を返す", async () => {
		const { run, events, logError } = setup();

		const response = await run();

		expect(response).toStrictEqual({
			ref: { v: 1, id: IMAGE_ID, locale: "en", width: 300, height: 199, alt: "" },
		});
		expect(uploadResponseSchema.safeParse(response).success).toBe(true);
		expect(events).toStrictEqual([
			"schema.getCollection:posts",
			`content.create:${IMAGE_COLLECTION}`,
			`imageRefs.put:${IMAGE_ID}`,
			`content.getVersioned:${IMAGE_COLLECTION}:${IMAGE_ID}`,
			`content.publish:${IMAGE_COLLECTION}:${IMAGE_ID}:${REV}`,
		]);
		expect(logError).not.toHaveBeenCalled();
	});

	it("画像エントリの値: meta.bytes は WebP 本体のバイト数。保存 hook の検証(②)も通る", async () => {
		const { run, content } = setup();
		const input = validInput();

		await run();

		expect(content.created).toHaveLength(1);
		const created = content.created[0];
		expect(created?.collection).toBe("b64_images");
		expect(created?.data).toStrictEqual({
			image: {
				src: input.dataUrl,
				mimeType: "image/webp",
				width: 300,
				height: 199,
				filename: "IMG_0001.jpg",
				meta: { v: 1, bytes: MAIN.length, quality: 0.77 },
			},
		});
		expect(MAIN.length).not.toBe(input.dataUrl.length);
		expect(validateImageEntry(created?.data["image"]).ok).toBe(true);
	});

	it("filename を送らなければ、画像エントリにも入れない", async () => {
		const { run, content } = setup({ input: { filename: undefined } });

		await run();

		const image = content.created[0]?.data["image"];
		expect(image).not.toHaveProperty("filename");
		expect(validateImageEntry(image).ok).toBe(true);
	});

	it("imageRefs の記録: WebP 本体のバイト数・寸法・サムネイル・作成日時・作成者。entryId が無ければ参照元は空", async () => {
		const { run, imageRefs } = setup();

		await run();

		const record = imageRefs.records.get(IMAGE_ID);
		expect(record).toStrictEqual({
			owners: [],
			bytes: MAIN.length,
			width: 300,
			height: 199,
			thumb: toWebpDataUrl(THUMB),
			createdAt: "2026-09-24T12:34:56.789Z",
			createdBy: USER_ID,
		});
		expect(imageRefsRecordSchema.safeParse(record).success).toBe(true);
	});

	it("target.entryId があれば、最初の参照元として記録する(ロケールを省けばサイトの既定ロケール)", async () => {
		const { run, imageRefs } = setup({
			input: { target: { collection: "posts", field: "gallery", entryId: POST_ID } },
		});

		await run();

		expect(imageRefs.records.get(IMAGE_ID)?.owners).toStrictEqual([
			{ collection: "posts", entryId: POST_ID, locale: "en", field: "gallery" },
		]);
	});

	it("i18n のサイト: 参照の locale は画像エントリのロケール(既定の ja)、参照元は target.locale(設定の表記)", async () => {
		const { run, imageRefs } = setup({
			i18n: I18N,
			createdLocale: "ja",
			input: { target: { collection: "posts", field: "cover", entryId: POST_ID, locale: "EN-us" } },
		});

		const response = await run();

		expect(response.ref.locale).toBe("ja");
		expect(imageRefs.records.get(IMAGE_ID)?.owners).toStrictEqual([
			{ collection: "posts", entryId: POST_ID, locale: "en-US", field: "cover" },
		]);
	});

	it("作成したエントリにロケールが無ければ(EmDash は必ず入れる)、サイトの既定ロケールを参照に入れる", async () => {
		const { run } = setup({ i18n: I18N, createdLocale: null });

		const response = await run();

		expect(response.ref.locale).toBe("ja");
	});
});

// ---------------------------------------------------------------------------
// 検証エラー
// ---------------------------------------------------------------------------

describe("検証エラー(400。何も作らない)", () => {
	const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
	const cases: readonly [string, SetupOptions, string][] = [
		[
			"このプラグインの widget でないフィールド",
			{ input: { target: { collection: "posts", field: "title" } } },
			"INVALID_TARGET",
		],
		[
			"無いフィールド",
			{ input: { target: { collection: "posts", field: "missing" } } },
			"INVALID_TARGET",
		],
		["無いコレクション", { collection: null }, "INVALID_TARGET"],
		["寸法が WebP と違う", { input: { width: 301 } }, "IMAGE_DIMENSIONS_MISMATCH"],
		["WebP でない data URL", { input: { dataUrl: png } }, "IMAGE_DATA_INVALID"],
		[
			"フィールドの maxStoredBytes(100,000)を超える",
			{ input: { dataUrl: `${toWebpDataUrl(MAIN)}${"A".repeat(100_000)}` } },
			"IMAGE_TOO_LARGE",
		],
		[
			"サムネイルの長辺が 96px を超える",
			{ input: { thumb: toWebpDataUrl(MAIN) } },
			"THUMB_DATA_INVALID",
		],
		[
			"i18n のサイトで、設定されていない target.locale",
			{ i18n: I18N, input: { target: { collection: "posts", field: "cover", locale: "fr" } } },
			"INVALID_TARGET",
		],
		[
			"i18n の無いサイトで、36 文字の target.locale",
			{
				input: {
					target: {
						collection: "posts",
						field: "cover",
						locale: "en-abcdefgh-abcdefgh-abcdefgh-abcdef",
					},
				},
			},
			"INVALID_TARGET",
		],
	];

	it.each(cases)("%s → %s", async (_name, options, code) => {
		const { run, events, logError } = setup(options);

		const error = await rejection(run());

		expectRouteError(error, code, 400);
		expect(ERROR_HTTP_STATUS[code as keyof typeof ERROR_HTTP_STATUS]).toBe(400);
		expectNothingWritten(events);
		expect(logError).not.toHaveBeenCalled();
	});

	it("ロケールは、フィールド定義を読む前に確かめる(クエリを使わない)", async () => {
		const { run, events } = setup({
			i18n: I18N,
			input: { target: { collection: "posts", field: "cover", locale: "fr" } },
		});

		await rejection(run());

		expect(events).toStrictEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 設定の誤り
// ---------------------------------------------------------------------------

describe("利用者・プラグインの定義・サイトの設定の誤り(何も作らない)", () => {
	it("ctx.user が無ければ 401 UNAUTHORIZED", async () => {
		const { run, events } = setup();

		expectRouteError(await rejection(run({ user: undefined })), "UNAUTHORIZED", 401);
		expect(events).toStrictEqual([]);
	});

	it.each([
		["ctx.schema が無い", { schema: undefined }, "schema:read"],
		["ctx.content が無い", { content: undefined }, "content:write"],
		["ctx.storage.imageRefs が無い", { storage: {} }, IMAGE_REFS_STORAGE],
	] as const)("%s → 通常の Error(EmDash が 500 にする)", async (_name, override, hint) => {
		const { run, events } = setup();

		const error = await rejection(run(override));

		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(PluginRouteError);
		expect((error as Error).message).toContain(hint);
		expect(events).toStrictEqual([]);
	});

	it("content:publish が無い(create と delete だけ)→ 作る前に通常の Error", async () => {
		const { run, content, events } = setup();
		const withoutPublish: UploadContentAccess = {
			create: (collection, data) => content.create(collection, data),
			delete: (collection, id) => content.delete(collection, id),
		};

		const error = await rejection(run({ content: withoutPublish }));

		expect(error).not.toBeInstanceOf(PluginRouteError);
		expect((error as Error).message).toContain("content:publish");
		expect(events).toStrictEqual([]);
	});

	it("content:write が無い(publish だけ)→ 通常の Error", async () => {
		const { run, content, events } = setup();
		const withoutWrite: UploadContentAccess = {
			getVersioned: (collection, id) => content.getVersioned(collection, id),
			publish: (collection, id, options) => content.publish(collection, id, options),
		};

		const error = await rejection(run({ content: withoutWrite }));

		expect((error as Error).message).toContain("content:write");
		expect(events).toStrictEqual([]);
	});

	it("サイトの既定ロケールが、参照に入らない値(Astro のロケールの path など)→ 作る前に通常の Error", async () => {
		const { run, events } = setup({
			i18n: { defaultLocale: "spanish", locales: ["spanish", "en"] },
		});

		const error = await rejection(run());

		expect(error).not.toBeInstanceOf(PluginRouteError);
		expect((error as Error).message).toContain('"spanish"');
		expect(events).toStrictEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 作成に失敗したとき
// ---------------------------------------------------------------------------

describe("作成に失敗したとき(後始末は要らない)", () => {
	it("保存 hook の拒否(SAVE_REJECTED の通常の Error で届く)→ 400 IMAGE_ENTRY_INVALID。hook のメッセージを添える", async () => {
		const hookMessage =
			"b64_images.image: meta.bytes (1) does not match the size of the WebP in src (778 bytes)";
		const { run, events, logError } = setup({
			createError: emdashError("SAVE_REJECTED", hookMessage),
		});

		const error = expectRouteError(await rejection(run()), "IMAGE_ENTRY_INVALID", 400);

		expect(ERROR_HTTP_STATUS.IMAGE_ENTRY_INVALID).toBe(400);
		expect(error.message).toBe(
			`The image entry was rejected by a content:beforeSave hook: ${hookMessage}`,
		);
		// 保存 hook は行を書く前に動くので、何も作られていない(後始末をしない)
		expect(events).toStrictEqual(["schema.getCollection:posts", "content.create:b64_images"]);
		expect(logError).toHaveBeenCalledTimes(1);
	});

	it("保存 hook の長いメッセージは、切り詰めて添える", async () => {
		const { run } = setup({ createError: emdashError("SAVE_REJECTED", "x".repeat(5_000)) });

		const error = expectRouteError(await rejection(run()), "IMAGE_ENTRY_INVALID", 400);

		expect(error.message).toBe(
			`The image entry was rejected by a content:beforeSave hook: ${"x".repeat(MAX_HOOK_MESSAGE_LENGTH)}…`,
		);
	});

	it("b64_images の形が違う(EmDash の VALIDATION_ERROR)→ 500 UPLOAD_FAILED", async () => {
		const { run, events } = setup({
			createError: emdashError(
				"VALIDATION_ERROR",
				"Unknown field 'image' in collection 'b64_images'",
			),
		});

		const error = expectRouteError(await rejection(run()), "UPLOAD_FAILED", 500);

		expect(error.message).toBe("Failed to create the image entry (VALIDATION_ERROR)");
		expect(events).toStrictEqual(["schema.getCollection:posts", "content.create:b64_images"]);
	});

	it("b64_images が無い(COLLECTION_NOT_FOUND)→ 500 IMAGE_COLLECTION_MISSING", async () => {
		const { run, events } = setup({
			createError: emdashError("COLLECTION_NOT_FOUND", "Collection 'b64_images' not found"),
		});

		const error = expectRouteError(await rejection(run()), "IMAGE_COLLECTION_MISSING", 500);

		expect(error.message).toBe('The "b64_images" collection does not exist');
		expect(events).toStrictEqual(["schema.getCollection:posts", "content.create:b64_images"]);
	});

	it("データベースのエラー → 500 UPLOAD_FAILED。元のメッセージは応答に入れず、ログに出す", async () => {
		const { run, logError } = setup({ createError: new Error("SQLITE_BUSY: secret detail") });

		const error = expectRouteError(await rejection(run()), "UPLOAD_FAILED", 500);

		expect(error.message).not.toContain("secret");
		expect(logError).toHaveBeenCalledWith(
			"Failed to create the image entry",
			expect.objectContaining({ message: "SQLITE_BUSY: secret detail" }),
		);
	});
});

// ---------------------------------------------------------------------------
// 作成のあとで失敗したとき
// ---------------------------------------------------------------------------

describe("作成のあとで失敗したとき(画像エントリをゴミ箱に移し、500 UPLOAD_FAILED)", () => {
	const trash = `content.delete:${IMAGE_COLLECTION}:${IMAGE_ID}`;

	it("imageRefs の保存に失敗 → ゴミ箱に移し、公開しない", async () => {
		const { run, events } = setup({ putError: new Error("D1_ERROR") });

		const error = expectRouteError(await rejection(run()), "UPLOAD_FAILED", 500);

		expect(error.message).toContain("moved to the trash");
		expect(events).toStrictEqual([
			"schema.getCollection:posts",
			"content.create:b64_images",
			`imageRefs.put:${IMAGE_ID}`,
			trash,
		]);
	});

	it("公開に失敗(ほかのプラグインの拒否など)→ imageRefs の記録は残し、ゴミ箱に移す", async () => {
		const { run, events, imageRefs } = setup({ publishError: emdashError("PUBLISH_REJECTED") });

		const error = expectRouteError(await rejection(run()), "UPLOAD_FAILED", 500);

		expect(error.message).toBe(
			`Failed to publish the image entry (PUBLISH_REJECTED); the image entry ${IMAGE_ID} was moved to the trash`,
		);
		expect(events.slice(-2)).toStrictEqual([
			`content.publish:${IMAGE_COLLECTION}:${IMAGE_ID}:${REV}`,
			trash,
		]);
		expect(imageRefs.records.has(IMAGE_ID)).toBe(true);
	});

	it("getVersioned が null → 公開せず、ゴミ箱に移す", async () => {
		const { run, events } = setup({ versioned: null });

		expectRouteError(await rejection(run()), "UPLOAD_FAILED", 500);

		expect(events.slice(-2)).toStrictEqual([
			`content.getVersioned:${IMAGE_COLLECTION}:${IMAGE_ID}`,
			trash,
		]);
	});

	it("getVersioned が例外 → ゴミ箱に移す", async () => {
		const { run, events } = setup({ getVersionedError: new Error("D1_ERROR") });

		expectRouteError(await rejection(run()), "UPLOAD_FAILED", 500);

		expect(events.at(-1)).toBe(trash);
	});

	it("作成したエントリのロケールが参照に入らない値 → imageRefs に記録せず、ゴミ箱に移す", async () => {
		const { run, events } = setup({ createdLocale: "not_a_locale" });

		expectRouteError(await rejection(run()), "UPLOAD_FAILED", 500);

		expect(events).toStrictEqual([
			"schema.getCollection:posts",
			"content.create:b64_images",
			trash,
		]);
	});

	it("ゴミ箱に移せなくても、同じ 500 UPLOAD_FAILED にしてログに出す", async () => {
		const { run, events, logError } = setup({
			publishError: emdashError("CONFLICT"),
			deleteError: new Error("D1_ERROR"),
		});

		expectRouteError(await rejection(run()), "UPLOAD_FAILED", 500);

		expect(events.at(-1)).toBe(trash);
		expect(logError).toHaveBeenCalledTimes(2);
		expect(logError).toHaveBeenLastCalledWith(
			`Failed to move the image entry ${IMAGE_ID} to the trash`,
			expect.objectContaining({ message: "D1_ERROR" }),
		);
	});

	it("ゴミ箱に移すエントリが見つからなければ、ログに出す", async () => {
		const { run, logError } = setup({ publishError: new Error("x"), deleteResult: false });

		expectRouteError(await rejection(run()), "UPLOAD_FAILED", 500);

		expect(logError).toHaveBeenLastCalledWith(
			`The image entry ${IMAGE_ID} to move to the trash was not found`,
		);
	});
});

// ---------------------------------------------------------------------------
// 既定のハンドラー
// ---------------------------------------------------------------------------

describe("handleUpload(ルートに登録する既定のハンドラー)", () => {
	/**
	 * EmDash 0.39.1 が i18n の設定を置く場所(`references/emdash/packages/core/src/i18n/config.ts:17`)。
	 * ミドルウェアが Astro の `i18n` から設定し、`emdash` の `getI18nConfig()` がここを読む。
	 */
	const I18N_CONFIG_KEY = Symbol.for("emdash:i18n-config");
	const store = globalThis as unknown as Record<symbol, unknown>;

	afterEach(() => {
		store[I18N_CONFIG_KEY] = undefined;
	});

	it("EmDash の i18n の設定を、リクエストのたびに読む", async () => {
		const input = { target: { collection: "posts", field: "cover", locale: "fr" } };

		store[I18N_CONFIG_KEY] = { defaultLocale: "ja", locales: ["ja", "en"] };
		const configured = setup({ input });
		expectRouteError(await rejection(handleUpload(configured.ctx)), "INVALID_TARGET", 400);

		store[I18N_CONFIG_KEY] = undefined;
		const unconfigured = setup({ input });
		const response = await handleUpload(unconfigured.ctx);
		expect(response.ref.id).toBe(IMAGE_ID);
	});
});
