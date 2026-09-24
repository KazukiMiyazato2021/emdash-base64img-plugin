import {
	ContentSaveRejectedError,
	isContentSaveRejection,
	type ContentHookEvent,
	type PluginContext,
	type PluginHooks,
} from "emdash";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
	IMAGE_REFS_BATCH_SIZE,
	MAX_LISTED_ISSUES,
	getImageFields,
	validateReferencesBeforeSave,
	type ReferenceFieldInfo,
	type ReferenceHookContext,
} from "../../src/server/hooks/references";
import { MAX_ALT_LENGTH, MAX_ITEMS_LIMIT } from "../../src/shared/constants";
import type { Base64ImageRef } from "../../src/shared/types";

/** D1 のバインド変数の上限(1 クエリ 100 個) */
const D1_MAX_BINDINGS = 100;
/** `getMany` が ID のほかに使うバインド変数(`plugin_id` と `collection`) */
const BINDINGS_BESIDES_IDS = 2;

function imageField(slug: string, label = "", options?: unknown): ReferenceFieldInfo {
	return { slug, label, type: "json", widget: "base64-image:image", options };
}

function galleryField(slug: string, label = "", options?: unknown): ReferenceFieldInfo {
	return { slug, label, type: "json", widget: "base64-image:gallery", options };
}

const POSTS_FIELDS: ReferenceFieldInfo[] = [
	{ slug: "title", label: "Title", type: "string" },
	imageField("cover", "Cover", { maxStoredBytes: 100_000 }),
	galleryField("gallery", "Gallery", { maxItems: 3 }),
	{ slug: "accent", label: "Accent", type: "json", widget: "color:picker" },
	// 型が json でないのに、widget だけがこのプラグインのもの(設定の誤り。管理画面は型を見ずに widget を割り当てる)
	{ slug: "caption", label: "Caption", type: "string", widget: "base64-image:image" },
];

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

function imageId(n: number): string {
	return `01J8Z3K4M5N6P7Q8R9S0${String(n).padStart(6, "0")}`;
}

interface FakeOptions {
	/** `getCollection` が返すフィールド。null ならコレクションが無い */
	fields?: ReferenceFieldInfo[] | null;
	/** `imageRefs` にある画像 ID */
	stored?: Iterable<string>;
	/** false なら `ctx.schema` が無い(capability `schema:read` が無い) */
	schema?: false;
	/** false なら `ctx.storage.imageRefs` が無い(ストレージを宣言していない) */
	storage?: false;
	/** `getMany` が投げる例外(データベースの失敗) */
	getManyError?: Error;
}

/**
 * 偽の ctx。`getMany` は EmDash 0.39.1 と同じく、見つかった ID だけを持つ Map を返す
 * (`WHERE id IN (...)`。`packages/core/src/database/repositories/plugin-storage.ts:271`)。
 * D1 と同じく、バインド変数(ID の数 + 2)が 100 個を超えると失敗する。
 */
function fakeContext(options: FakeOptions = {}) {
	const calls = { getCollection: [] as string[], getMany: [] as string[][] };
	const stored = new Set(options.stored ?? []);
	const fields = options.fields === undefined ? POSTS_FIELDS : options.fields;
	const ctx: ReferenceHookContext = {
		schema:
			options.schema === false
				? undefined
				: {
						async getCollection(slug) {
							calls.getCollection.push(slug);
							return fields === null ? null : { fields };
						},
					},
		storage:
			options.storage === false
				? {}
				: {
						imageRefs: {
							async getMany(ids) {
								calls.getMany.push([...ids]);
								if (options.getManyError) throw options.getManyError;
								if (ids.length + BINDINGS_BESIDES_IDS > D1_MAX_BINDINGS) {
									throw new Error("D1_ERROR: too many SQL variables");
								}
								return new Map(
									ids.filter((id) => stored.has(id)).map((id) => [id, { owners: [] }]),
								);
							},
						},
					},
	};
	return { ctx, calls };
}

function save(content: Record<string, unknown>, collection = "posts") {
	return { collection, content };
}

async function rejection(promise: Promise<void>): Promise<ContentSaveRejectedError> {
	const error: unknown = await promise.then(
		() => undefined,
		(reason: unknown) => reason,
	);
	expect(error).toBeInstanceOf(ContentSaveRejectedError);
	return error as ContentSaveRejectedError;
}

const JAPANESE = /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u;

/** `message` を日本語の行と英語の行に分ける(日本語の行が先に並び、英語の行には日本語の文字が無い) */
function splitLanguages(message: string): { ja: string[]; en: string[] } {
	const lines = message.split("\n");
	const firstEnglish = lines.findIndex((line) => !JAPANESE.test(line));
	expect(firstEnglish).toBeGreaterThan(0);
	expect(lines.slice(firstEnglish).some((line) => JAPANESE.test(line))).toBe(false);
	return { ja: lines.slice(0, firstEnglish), en: lines.slice(firstEnglish) };
}

describe("validateReferencesBeforeSave: 対象とクエリ", () => {
	it("b64_images は対象外で、フィールド定義も読まない", async () => {
		const { ctx, calls } = fakeContext();
		await expect(
			validateReferencesBeforeSave(save({ image: "not an entry" }, "b64_images"), ctx),
		).resolves.toBeUndefined();
		expect(calls.getCollection).toEqual([]);
	});

	it("送られたデータが空なら、クエリをしない", async () => {
		const { ctx, calls } = fakeContext();
		await validateReferencesBeforeSave(save({}), ctx);
		expect(calls).toEqual({ getCollection: [], getMany: [] });
	});

	it("このプラグインの widget が無いコレクションは、フィールド定義を 1 回読むだけ", async () => {
		const { ctx, calls } = fakeContext({
			fields: [
				{ slug: "title", label: "Title", type: "string" },
				{ slug: "body", label: "Body", type: "json" },
			],
		});
		await validateReferencesBeforeSave(save({ title: "x", body: { v: 1 } }, "pages"), ctx);
		expect(calls).toEqual({ getCollection: ["pages"], getMany: [] });
	});

	it("コレクションが見つからなければ、何もしない", async () => {
		const { ctx, calls } = fakeContext({ fields: null });
		await validateReferencesBeforeSave(save({ cover: "not a ref" }), ctx);
		expect(calls.getMany).toEqual([]);
	});

	it("送られていないフィールドは検証しない(部分更新)", async () => {
		const { ctx, calls } = fakeContext();
		await validateReferencesBeforeSave(save({ title: "renamed" }), ctx);
		expect(calls.getMany).toEqual([]);
	});

	it("ほかのプラグインの widget のフィールドは検証しない", async () => {
		const { ctx, calls } = fakeContext();
		await validateReferencesBeforeSave(save({ accent: { v: 99 } }), ctx);
		expect(calls.getMany).toEqual([]);
	});

	it.each([
		["文字列", "any caption"],
		["参照の形の値", ref("imgZ")],
	])(
		"json 以外の型のフィールドは、widget がこのプラグインのものでも検証しない(%s)",
		async (_, caption) => {
			const { ctx, calls } = fakeContext();
			await expect(validateReferencesBeforeSave(save({ caption }), ctx)).resolves.toBeUndefined();
			expect(calls.getMany).toEqual([]);
		},
	);

	it.each([
		["null", { cover: null, gallery: null }],
		["undefined と空の配列", { cover: undefined, gallery: [] }],
	])("%s は「画像なし」として通し、存在を確かめない", async (_, content) => {
		const { ctx, calls } = fakeContext();
		await validateReferencesBeforeSave(save(content), ctx);
		expect(calls.getMany).toEqual([]);
	});

	it("正しい参照は通す。フィールドをまたいで重複した ID は 1 回だけ確かめる", async () => {
		const { ctx, calls } = fakeContext({ stored: ["imgA", "imgB"] });
		await validateReferencesBeforeSave(
			save({ title: "x", cover: ref("imgA"), gallery: [ref("imgA"), ref("imgB")] }),
			ctx,
		);
		expect(calls.getCollection).toEqual(["posts"]);
		expect(calls.getMany).toEqual([["imgA", "imgB"]]);
	});
});

describe("validateReferencesBeforeSave: 参照の形", () => {
	it.each([
		["文字列", "imgA", "", ""],
		["配列", [ref("imgA")], "", ""],
		["id が無い", { ...ref("imgA"), id: undefined }, "(キー: id)", " (keys: id)"],
		[
			"知らないキー",
			{ ...ref("imgA"), src: "data:image/webp;base64,AAAA" },
			"(キー: src)",
			" (keys: src)",
		],
		["v が 2", ref("imgA", { v: 2 }), "(キー: v)", " (keys: v)"],
		["幅が 0", ref("imgA", { width: 0 }), "(キー: width)", " (keys: width)"],
		["ロケールが不正", ref("imgA", { locale: "日本語" }), "(キー: locale)", " (keys: locale)"],
		["ID に / を含む", ref("../imgA"), "(キー: id)", " (keys: id)"],
	])("%s は拒否し、フィールドと問題のあるキーを書く", async (_, cover, jaKeys, enKeys) => {
		const { ctx, calls } = fakeContext({ stored: ["imgA"] });
		const error = await rejection(validateReferencesBeforeSave(save({ cover }), ctx));
		expect(splitLanguages(error.message)).toEqual({
			ja: [`画像フィールド「Cover」(cover): 画像の参照の形式が正しくありません${jaKeys}。`],
			en: [`Image field "Cover" (cover): the image reference is invalid${enKeys}.`],
		});
		// 形の正しい参照が無いので、存在は確かめない
		expect(calls.getMany).toEqual([]);
	});

	it(`代替テキストは ${MAX_ALT_LENGTH} 文字(コードポイント)まで通す`, async () => {
		const { ctx } = fakeContext({ stored: ["imgA"] });
		// 絵文字は UTF-16 では 2 単位。コードポイントで数えるので 1,000 文字として通る
		const alt = "😀".repeat(MAX_ALT_LENGTH);
		await expect(
			validateReferencesBeforeSave(save({ cover: ref("imgA", { alt }) }), ctx),
		).resolves.toBeUndefined();
	});

	it("代替テキストが長すぎるときは、上限と文字数(コードポイント)を書く", async () => {
		const { ctx } = fakeContext({ stored: ["imgA"] });
		const alt = "😀".repeat(MAX_ALT_LENGTH + 1);
		const error = await rejection(
			validateReferencesBeforeSave(save({ cover: ref("imgA", { alt }) }), ctx),
		);
		expect(splitLanguages(error.message)).toEqual({
			ja: ["画像フィールド「Cover」(cover): 代替テキストが 1,000 文字を超えています(1,001 文字)。"],
			en: [
				'Image field "Cover" (cover): the alternative text is longer than 1,000 characters (1,001).',
			],
		});
	});

	it("代替テキストのほかにも問題があれば、形の問題として並べる", async () => {
		const { ctx } = fakeContext({ stored: ["imgA"] });
		const cover = ref("imgA", { alt: "a".repeat(MAX_ALT_LENGTH + 1), width: -1 });
		const error = await rejection(validateReferencesBeforeSave(save({ cover }), ctx));
		expect(error.message).toContain("(キー: width, alt)");
		expect(error.message).not.toContain("代替テキストが");
	});
});

describe("validateReferencesBeforeSave: ギャラリー", () => {
	it("配列でなければ拒否する", async () => {
		const { ctx } = fakeContext({ stored: ["imgA"] });
		const error = await rejection(
			validateReferencesBeforeSave(save({ gallery: ref("imgA") }), ctx),
		);
		expect(splitLanguages(error.message)).toEqual({
			ja: ["画像フィールド「Gallery」(gallery): 値が画像の参照の配列ではありません。"],
			en: ['Image field "Gallery" (gallery): the value is not an array of image references.'],
		});
	});

	it("maxItems(3)枚までは通し、超えたら枚数と上限を書く。超えたときは 1 枚ずつの検証も存在の確認もしない", async () => {
		const three = ["imgA", "imgB", "imgC"];
		const ok = fakeContext({ stored: three });
		await validateReferencesBeforeSave(save({ gallery: three.map((id) => ref(id)) }), ok.ctx);
		expect(ok.calls.getMany).toEqual([three]);

		const ng = fakeContext({ stored: three });
		const gallery = [...three.map((id) => ref(id)), "not a ref"];
		const error = await rejection(validateReferencesBeforeSave(save({ gallery }), ng.ctx));
		expect(splitLanguages(error.message)).toEqual({
			ja: ["画像フィールド「Gallery」(gallery): 画像が 4 枚あり、上限の 3 枚を超えています。"],
			en: ['Image field "Gallery" (gallery): 4 images exceed the limit of 3.'],
		});
		expect(ng.calls.getMany).toEqual([]);
	});

	it("maxItems は normalizeFieldOptions で解釈する(省略は 10 枚、上限は 20 枚)", async () => {
		const ids = Array.from({ length: MAX_ITEMS_LIMIT + 1 }, (_, i) => imageId(i));
		const fields = (options: unknown): ReferenceFieldInfo[] => [
			galleryField("gallery", "Gallery", options),
		];
		const gallery = (count: number) => ids.slice(0, count).map((id) => ref(id));

		await validateReferencesBeforeSave(
			save({ gallery: gallery(10) }),
			fakeContext({ fields: fields(undefined), stored: ids }).ctx,
		);
		const byDefault = await rejection(
			validateReferencesBeforeSave(
				save({ gallery: gallery(11) }),
				fakeContext({ fields: fields(undefined), stored: ids }).ctx,
			),
		);
		expect(byDefault.message).toContain("上限の 10 枚");

		await validateReferencesBeforeSave(
			save({ gallery: gallery(MAX_ITEMS_LIMIT) }),
			fakeContext({ fields: fields({ maxItems: 50 }), stored: ids }).ctx,
		);
		const clamped = await rejection(
			validateReferencesBeforeSave(
				save({ gallery: gallery(MAX_ITEMS_LIMIT + 1) }),
				fakeContext({ fields: fields({ maxItems: 50 }), stored: ids }).ctx,
			),
		);
		expect(clamped.message).toContain(`上限の ${MAX_ITEMS_LIMIT} 枚`);
	});

	it("同じ画像の重複は、何枚目が何枚目と同じかを書く。存在は重複を除いて確かめる", async () => {
		const { ctx, calls } = fakeContext({ stored: ["imgA", "imgB"] });
		const error = await rejection(
			validateReferencesBeforeSave(
				save({ gallery: [ref("imgA"), ref("imgB"), ref("imgA", { alt: "別の説明" })] }),
				ctx,
			),
		);
		expect(splitLanguages(error.message)).toEqual({
			ja: ["画像フィールド「Gallery」(gallery)の 3 枚目: 1 枚目と同じ画像です(ID: imgA)。"],
			en: ['Image field "Gallery" (gallery), item 3: the same image as item 1 (ID: imgA).'],
		});
		expect(calls.getMany).toEqual([["imgA", "imgB"]]);
	});

	it("不正な 1 枚があっても、ほかの画像の存在は確かめる", async () => {
		const { ctx, calls } = fakeContext({ stored: ["imgA"] });
		const error = await rejection(
			validateReferencesBeforeSave(save({ gallery: [ref("imgA"), 42, ref("imgZ")] }), ctx),
		);
		expect(splitLanguages(error.message).ja).toEqual([
			"画像フィールド「Gallery」(gallery)の 2 枚目: 画像の参照の形式が正しくありません。",
			"画像フィールド「Gallery」(gallery)の 3 枚目: 画像が見つかりません(ID: imgZ)。",
			"見つからない画像は、完全に削除されたか、このプラグインでアップロードされていません(seed など)。画像を外すか、選び直してください。",
		]);
		expect(calls.getMany).toEqual([["imgA", "imgZ"]]);
	});
});

describe("validateReferencesBeforeSave: 画像の存在(imageRefs)", () => {
	it("imageRefs に無い画像は、参照している場所ごとに書き、原因と対処を 1 回だけ添える", async () => {
		const { ctx } = fakeContext({ stored: ["imgA"] });
		const error = await rejection(
			validateReferencesBeforeSave(
				save({ cover: ref("imgZ"), gallery: [ref("imgA"), ref("imgZ")] }),
				ctx,
			),
		);
		expect(splitLanguages(error.message)).toEqual({
			ja: [
				"画像フィールド「Cover」(cover): 画像が見つかりません(ID: imgZ)。",
				"画像フィールド「Gallery」(gallery)の 2 枚目: 画像が見つかりません(ID: imgZ)。",
				"見つからない画像は、完全に削除されたか、このプラグインでアップロードされていません(seed など)。画像を外すか、選び直してください。",
			],
			en: [
				'Image field "Cover" (cover): image not found (ID: imgZ).',
				'Image field "Gallery" (gallery), item 2: image not found (ID: imgZ).',
				"Missing images were deleted permanently or not uploaded through this plugin (for example, seeded). Remove or replace them.",
			],
		});
	});

	it(`ID は ${IMAGE_REFS_BATCH_SIZE} 件ずつに分けて確かめる(D1 のバインド変数の上限を超えない)`, async () => {
		// ギャラリー 6 つ × 20 枚 = 異なる画像 120 枚
		const fields = Array.from({ length: 6 }, (_, f) =>
			galleryField(`gallery_${f}`, `Gallery ${f}`, { maxItems: MAX_ITEMS_LIMIT }),
		);
		const ids = Array.from({ length: 120 }, (_, i) => imageId(i));
		const content = Object.fromEntries(
			fields.map((field, f) => [
				field.slug,
				ids.slice(f * MAX_ITEMS_LIMIT, (f + 1) * MAX_ITEMS_LIMIT).map((id) => ref(id)),
			]),
		);
		const { ctx, calls } = fakeContext({ fields, stored: ids });
		await validateReferencesBeforeSave(save(content), ctx);

		expect(calls.getMany).toHaveLength(Math.ceil(ids.length / IMAGE_REFS_BATCH_SIZE));
		for (const batch of calls.getMany) {
			expect(batch.length).toBeLessThanOrEqual(IMAGE_REFS_BATCH_SIZE);
		}
		const requested = calls.getMany.flat();
		expect(requested).toHaveLength(ids.length);
		expect(new Set(requested)).toEqual(new Set(ids));
	});

	it("分けたあとの呼び出しで見つからない画像も拒否する", async () => {
		const fields = Array.from({ length: 3 }, (_, f) =>
			galleryField(`gallery_${f}`, "", { maxItems: MAX_ITEMS_LIMIT }),
		);
		const ids = Array.from({ length: 60 }, (_, i) => imageId(i));
		const content = Object.fromEntries(
			fields.map((field, f) => [
				field.slug,
				ids.slice(f * MAX_ITEMS_LIMIT, (f + 1) * MAX_ITEMS_LIMIT).map((id) => ref(id)),
			]),
		);
		// 最後の 1 枚(2 回目の getMany に入る)だけが無い
		const { ctx } = fakeContext({ fields, stored: ids.slice(0, -1) });
		const error = await rejection(validateReferencesBeforeSave(save(content), ctx));
		expect(splitLanguages(error.message).ja[0]).toBe(
			`画像フィールド「gallery_2」の 20 枚目: 画像が見つかりません(ID: ${ids.at(-1)})。`,
		);
	});
});

describe("validateReferencesBeforeSave: message", () => {
	it("問題は、見つかった順ではなく、フィールドの定義の順・何枚目かの順に並べる", async () => {
		// cover の「画像が無い」は存在の確認のあとで見つかるが、gallery の形の問題より先に並ぶ
		const { ctx } = fakeContext({ stored: [] });
		const error = await rejection(
			validateReferencesBeforeSave(save({ gallery: [ref("imgB"), "x"], cover: ref("imgZ") }), ctx),
		);
		expect(splitLanguages(error.message).en).toEqual([
			'Image field "Cover" (cover): image not found (ID: imgZ).',
			'Image field "Gallery" (gallery), item 1: image not found (ID: imgB).',
			'Image field "Gallery" (gallery), item 2: the image reference is invalid.',
			"Missing images were deleted permanently or not uploaded through this plugin (for example, seeded). Remove or replace them.",
		]);
	});

	it(`並べるのは ${MAX_LISTED_ISSUES} 件までで、残りは件数だけを書く`, async () => {
		const slugs = ["a", "b", "c", "d", "e"];
		const { ctx } = fakeContext({
			fields: slugs.map((slug) => imageField(slug)),
		});
		const invalid = (count: number) =>
			Object.fromEntries(slugs.slice(0, count).map((slug) => [slug, 1]));

		const five = await rejection(validateReferencesBeforeSave(save(invalid(5)), ctx));
		const { ja, en } = splitLanguages(five.message);
		expect(ja).toEqual([
			"画像フィールド「a」: 画像の参照の形式が正しくありません。",
			"画像フィールド「b」: 画像の参照の形式が正しくありません。",
			"画像フィールド「c」: 画像の参照の形式が正しくありません。",
			"ほかに 2 件の問題があります。",
		]);
		expect(en.at(-1)).toBe("2 more problems are not shown.");

		const four = await rejection(validateReferencesBeforeSave(save(invalid(4)), ctx));
		expect(splitLanguages(four.message).en.at(-1)).toBe("1 more problem is not shown.");

		const three = await rejection(validateReferencesBeforeSave(save(invalid(3)), ctx));
		expect(splitLanguages(three.message).en).toHaveLength(MAX_LISTED_ISSUES);
	});

	it("表示名が無いか slug と同じなら、slug だけを書く", async () => {
		const { ctx } = fakeContext({
			fields: [imageField("hero", ""), imageField("thumb", "thumb")],
		});
		const error = await rejection(validateReferencesBeforeSave(save({ hero: 1, thumb: 2 }), ctx));
		expect(splitLanguages(error.message)).toEqual({
			ja: [
				"画像フィールド「hero」: 画像の参照の形式が正しくありません。",
				"画像フィールド「thumb」: 画像の参照の形式が正しくありません。",
			],
			en: [
				'Image field "hero": the image reference is invalid.',
				'Image field "thumb": the image reference is invalid.',
			],
		});
	});

	it("知らないキーが多くても、キーは 5 つまで・1 つ 40 文字までにする", async () => {
		const { ctx } = fakeContext();
		const longKey = "k".repeat(1000);
		const extra = Object.fromEntries(
			[longKey, "b", "c", "d", "e", "f", "g"].map((key) => [key, 1]),
		);
		const error = await rejection(
			validateReferencesBeforeSave(save({ cover: { ...ref("imgA"), ...extra } }), ctx),
		);
		expect(splitLanguages(error.message).en).toEqual([
			`Image field "Cover" (cover): the image reference is invalid (keys: ${"k".repeat(40)}…, b, c, d, e, …).`,
		]);
	});
});

describe("validateReferencesBeforeSave: 投げるエラー", () => {
	it("拒否は ContentSaveRejectedError で投げる(EmDash が SAVE_REJECTED と message を返す)", async () => {
		const { ctx } = fakeContext();
		const error = await rejection(validateReferencesBeforeSave(save({ cover: "x" }), ctx));
		expect(isContentSaveRejection(error)).toBe(true);
	});

	it("ctx.schema が無い(schema:read が無い)ときは、保存の拒否ではない Error を投げる", async () => {
		const { ctx } = fakeContext({ schema: false });
		const error: unknown = await validateReferencesBeforeSave(save({ cover: null }), ctx).then(
			() => undefined,
			(reason: unknown) => reason,
		);
		expect(error).toBeInstanceOf(Error);
		expect(isContentSaveRejection(error)).toBe(false);
		expect((error as Error).message).toContain("schema:read");
	});

	it("imageRefs が無いときは、確かめる参照があるときだけ Error を投げる", async () => {
		const { ctx } = fakeContext({ storage: false });
		await expect(
			validateReferencesBeforeSave(save({ cover: null, gallery: [] }), ctx),
		).resolves.toBeUndefined();
		const error: unknown = await validateReferencesBeforeSave(
			save({ cover: ref("imgA") }),
			ctx,
		).then(
			() => undefined,
			(reason: unknown) => reason,
		);
		expect(isContentSaveRejection(error)).toBe(false);
		expect((error as Error).message).toContain("imageRefs");
	});

	it("imageRefs の読み出しの失敗は、そのまま投げる(保存の拒否にしない)", async () => {
		const failure = new Error("D1_ERROR: network");
		const { ctx } = fakeContext({ getManyError: failure });
		await expect(validateReferencesBeforeSave(save({ cover: ref("imgA") }), ctx)).rejects.toBe(
			failure,
		);
	});
});

describe("getImageFields", () => {
	it("このプラグインの widget を使う json フィールドだけを、定義の順に取り出す(型が json でない caption は除く)", () => {
		expect(getImageFields(POSTS_FIELDS)).toEqual([
			{ slug: "cover", label: "Cover", kind: "image", options: { maxStoredBytes: 100_000 } },
			{ slug: "gallery", label: "Gallery", kind: "gallery", options: { maxItems: 3 } },
		]);
	});
});

describe("型", () => {
	it("EmDash の content:beforeSave の handler としてそのまま登録できる(T29)", () => {
		expectTypeOf(validateReferencesBeforeSave).toExtend<
			(event: ContentHookEvent, ctx: PluginContext) => Promise<Record<string, unknown> | void>
		>();
		expectTypeOf({ handler: validateReferencesBeforeSave }).toExtend<
			NonNullable<PluginHooks["content:beforeSave"]>
		>();
	});
});
