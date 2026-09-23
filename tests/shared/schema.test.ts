import type { MediaValue, PluginRoute } from "emdash";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import { ROUTE_PERMISSIONS, type RouteKey } from "../../src/shared/constants";
import {
	Base64ImageError,
	CLIENT_ERROR_CODES,
	HOST_ERROR_CODES,
	NOTICE_CODES,
	SERVER_ERROR_CODES,
	isBase64ImageError,
	isKnownErrorCode,
	routeErrorBodySchema,
} from "../../src/shared/errors";
import { getWidgetKind, normalizeFieldOptions } from "../../src/shared/options";
import {
	base64ImageEntrySchema,
	base64ImageGallerySchema,
	base64ImageRefSchema,
	imageListItemSchema,
	imageRefsRecordSchema,
	imagesListRequestSchema,
	isBase64ImageGallery,
	isBase64ImageRef,
	previewRequestSchema,
	previewResponseSchema,
	routeSuccessBodySchema,
	thumbnailsRequestSchema,
	uploadRequestSchema,
	uploadResponseSchema,
} from "../../src/shared/schema";
import type { Base64ImageRef, ResolvedBase64Image, UploadRequest } from "../../src/shared/types";

// スキーマは形だけを確かめるので、data URL の中身は本物の WebP でなくてよい(中身の検証は T11)。
const WEBP_DATA_URL = "data:image/webp;base64,UklGRhYAAABXRUJQ";
const IMAGE_ID = "01J8Z3K4M5N6P7Q8R9S0T1V2W3";
const ENTRY_ID = "01J8Z3K4M5N6P7Q8R9S0T1V2W4";

function ref(overrides: Record<string, unknown> = {}) {
	return {
		v: 1,
		id: IMAGE_ID,
		locale: "ja",
		width: 1280,
		height: 853,
		alt: "説明文",
		...overrides,
	};
}

function entry(overrides: Record<string, unknown> = {}) {
	return {
		src: WEBP_DATA_URL,
		mimeType: "image/webp",
		width: 1280,
		height: 853,
		filename: "IMG_0001.jpg",
		meta: { v: 1, bytes: 74_668, quality: 0.77 },
		...overrides,
	};
}

function owner(overrides: Record<string, unknown> = {}) {
	return { collection: "posts", entryId: ENTRY_ID, locale: "ja", field: "cover", ...overrides };
}

function refsRecord(overrides: Record<string, unknown> = {}) {
	return {
		owners: [owner()],
		bytes: 74_668,
		width: 1280,
		height: 853,
		thumb: WEBP_DATA_URL,
		createdAt: "2026-09-23T12:00:00.000Z",
		createdBy: "01J8Z3K4M5N6P7Q8R9S0T1V2W5",
		...overrides,
	};
}

function upload(overrides: Record<string, unknown> = {}, target: Record<string, unknown> = {}) {
	return {
		dataUrl: WEBP_DATA_URL,
		thumb: WEBP_DATA_URL,
		width: 1280,
		height: 853,
		quality: 0.77,
		filename: "IMG_0001.jpg",
		target: { collection: "posts", field: "cover", entryId: ENTRY_ID, locale: "ja", ...target },
		...overrides,
	};
}

function listItem(overrides: Record<string, unknown> = {}) {
	return {
		id: IMAGE_ID,
		thumb: WEBP_DATA_URL,
		width: 1280,
		height: 853,
		bytes: 74_668,
		createdAt: "2026-09-23T12:00:00.000Z",
		entryStatus: "active",
		usage: "in_use",
		owners: [{ ...owner(), status: "in_use" }],
		...overrides,
	};
}

/** 検証に失敗した箇所(ドット区切りのパス。値そのものなら空文字)。通れば空の配列 */
function issuePaths(schema: z.ZodType, value: unknown): string[] {
	const result = schema.safeParse(value);
	return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

function ids(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `img${i}`);
}

describe("参照(仕様書 5.2)", () => {
	it("仕様書の形を受け付け、type guard も true を返す", () => {
		expect(issuePaths(base64ImageRefSchema, ref())).toEqual([]);
		expect(isBase64ImageRef(ref())).toBe(true);
	});

	it("alt は空文字(装飾画像)から 1,000 文字まで", () => {
		expect(issuePaths(base64ImageRefSchema, ref({ alt: "" }))).toEqual([]);
		expect(issuePaths(base64ImageRefSchema, ref({ alt: "あ".repeat(1_000) }))).toEqual([]);
		expect(issuePaths(base64ImageRefSchema, ref({ alt: "あ".repeat(1_001) }))).toEqual(["alt"]);
	});

	it("alt の文字数は Unicode のコードポイントで数える(UTF-16 で 2 単位の文字も 1 文字)", () => {
		expect(issuePaths(base64ImageRefSchema, ref({ alt: "😀".repeat(1_000) }))).toEqual([]);
		expect(issuePaths(base64ImageRefSchema, ref({ alt: "😀".repeat(1_001) }))).toEqual(["alt"]);
	});

	it.each([1, 16_383])("寸法 %s を受け付ける", (size) => {
		expect(issuePaths(base64ImageRefSchema, ref({ width: size, height: size }))).toEqual([]);
	});

	it.each([0, -1, 16_384, 1.5, "1280", null])("寸法 %j を拒否する", (size) => {
		expect(issuePaths(base64ImageRefSchema, ref({ width: size }))).toEqual(["width"]);
		expect(issuePaths(base64ImageRefSchema, ref({ height: size }))).toEqual(["height"]);
	});

	it("v が 1 でなければ拒否する(将来の版と区別する)", () => {
		expect(issuePaths(base64ImageRefSchema, ref({ v: 2 }))).toEqual(["v"]);
		expect(issuePaths(base64ImageRefSchema, ref({ v: "1" }))).toEqual(["v"]);
	});

	it.each(["v", "id", "locale", "width", "height", "alt"])("%s が欠けていれば拒否する", (key) => {
		const value: Record<string, unknown> = ref();
		delete value[key];
		expect(issuePaths(base64ImageRefSchema, value)).toEqual([key]);
	});

	it("知らないキーを拒否する(参照に画像本体を持たせない)", () => {
		expect(issuePaths(base64ImageRefSchema, ref({ src: WEBP_DATA_URL }))).toEqual([""]);
	});

	it.each([IMAGE_ID, "img_cover-1", "a", "A".repeat(128)])("ID %s を受け付ける", (id) => {
		expect(issuePaths(base64ImageRefSchema, ref({ id }))).toEqual([]);
	});

	it.each(["", "a/b", "..", ".a", "__proto__", "-a", "a b", "a.b", "A".repeat(129)])(
		"ID %j を拒否する(URL のパスに入れても別のパスにならない)",
		(id) => {
			expect(issuePaths(base64ImageRefSchema, ref({ id }))).toEqual(["id"]);
		},
	);

	it.each(["ja", "en", "en-US", "pt-BR", "es-419", "zh-Hant", "zh-Hant-TW"])(
		"ロケール %s を受け付ける(EmDash と同じ規則)",
		(locale) => {
			expect(issuePaths(base64ImageRefSchema, ref({ locale }))).toEqual([]);
		},
	);

	it.each(["", "j", "ja_JP", "japanese", "ja-", "-ja"])("ロケール %j を拒否する", (locale) => {
		expect(issuePaths(base64ImageRefSchema, ref({ locale }))).toEqual(["locale"]);
	});

	it("参照でない値には false を返す", () => {
		for (const value of [null, undefined, IMAGE_ID, [ref()], {}, ref({ v: 2 })]) {
			expect(isBase64ImageRef(value)).toBe(false);
		}
	});
});

describe("ギャラリー(仕様書 5.2)", () => {
	it("参照の配列を受け付ける(空の配列も)", () => {
		expect(isBase64ImageGallery([])).toBe(true);
		expect(isBase64ImageGallery([ref(), ref({ id: "img2" })])).toBe(true);
	});

	it("固定上限の 20 枚まで", () => {
		const refs = ids(21).map((id) => ref({ id }));
		expect(issuePaths(base64ImageGallerySchema, refs.slice(0, 20))).toEqual([]);
		expect(issuePaths(base64ImageGallerySchema, refs)).toEqual([""]);
	});

	it("不正な参照を含むと、その位置を示して拒否する", () => {
		expect(issuePaths(base64ImageGallerySchema, [ref(), ref({ alt: 1 })])).toEqual(["1.alt"]);
	});

	it("参照 1 つはギャラリーではなく、ギャラリーは参照ではない", () => {
		expect(isBase64ImageGallery(ref())).toBe(false);
		expect(isBase64ImageRef([ref()])).toBe(false);
	});
});

describe("画像エントリ(仕様書 5.1)", () => {
	it("仕様書の形を受け付ける(filename と画質は省略できる)", () => {
		expect(issuePaths(base64ImageEntrySchema, entry())).toEqual([]);
		const minimal: Record<string, unknown> = entry({ meta: { v: 1, bytes: 74_668 } });
		delete minimal.filename;
		expect(issuePaths(base64ImageEntrySchema, minimal)).toEqual([]);
	});

	it("src は固定上限の 500,000 バイトまで", () => {
		expect(issuePaths(base64ImageEntrySchema, entry({ src: "a".repeat(500_000) }))).toEqual([]);
		expect(issuePaths(base64ImageEntrySchema, entry({ src: "a".repeat(500_001) }))).toEqual([
			"src",
		]);
		expect(issuePaths(base64ImageEntrySchema, entry({ src: "" }))).toEqual(["src"]);
	});

	it("src は ASCII 以外・空白を含めない(長さをバイト数として数えるため)", () => {
		// 「é」は 1 コードポイントだが UTF-8 では 2 バイト。zod の max はコードポイントで数えるので、ASCII に限る
		const nonAscii = `${"a".repeat(499_999)}é`;
		expect(issuePaths(base64ImageEntrySchema, entry({ src: nonAscii }))).toEqual(["src"]);
		expect(issuePaths(base64ImageEntrySchema, entry({ src: `${WEBP_DATA_URL} ` }))).toEqual([
			"src",
		]);
		expect(issuePaths(base64ImageEntrySchema, entry({ src: `${WEBP_DATA_URL}\n` }))).toEqual([
			"src",
		]);
	});

	it("WebP 以外の MIME タイプを拒否する", () => {
		expect(issuePaths(base64ImageEntrySchema, entry({ mimeType: "image/png" }))).toEqual([
			"mimeType",
		]);
	});

	it("id を持たない(エントリ ID は作成が終わるまで決まらない)", () => {
		expect(issuePaths(base64ImageEntrySchema, entry({ id: IMAGE_ID }))).toEqual([""]);
	});

	it("meta の版・バイト数・画質を確かめる", () => {
		const withMeta = (meta: Record<string, unknown>) =>
			issuePaths(base64ImageEntrySchema, entry({ meta: { v: 1, bytes: 74_668, ...meta } }));
		expect(withMeta({ v: 2 })).toEqual(["meta.v"]);
		expect(withMeta({ bytes: 0 })).toEqual(["meta.bytes"]);
		expect(withMeta({ bytes: 1.5 })).toEqual(["meta.bytes"]);
		expect(withMeta({ quality: 0 })).toEqual([]);
		expect(withMeta({ quality: 1 })).toEqual([]);
		expect(withMeta({ quality: 1.01 })).toEqual(["meta.quality"]);
		expect(withMeta({ quality: -0.01 })).toEqual(["meta.quality"]);
		expect(withMeta({ storageKey: "x" })).toEqual(["meta"]);
	});

	it("filename は 1〜255 文字", () => {
		expect(issuePaths(base64ImageEntrySchema, entry({ filename: "a".repeat(255) }))).toEqual([]);
		expect(issuePaths(base64ImageEntrySchema, entry({ filename: "a".repeat(256) }))).toEqual([
			"filename",
		]);
		expect(issuePaths(base64ImageEntrySchema, entry({ filename: "" }))).toEqual(["filename"]);
	});
});

describe("参照元メタデータ imageRefs(仕様書 5.3)", () => {
	it("仕様書の形を受け付ける(参照元が無いものも)", () => {
		expect(issuePaths(imageRefsRecordSchema, refsRecord())).toEqual([]);
		expect(issuePaths(imageRefsRecordSchema, refsRecord({ owners: [] }))).toEqual([]);
	});

	it("サムネイルは data URL 全体で 8,000 バイトまで(ASCII だけ)", () => {
		expect(issuePaths(imageRefsRecordSchema, refsRecord({ thumb: "a".repeat(8_000) }))).toEqual([]);
		expect(issuePaths(imageRefsRecordSchema, refsRecord({ thumb: "a".repeat(8_001) }))).toEqual([
			"thumb",
		]);
		expect(issuePaths(imageRefsRecordSchema, refsRecord({ thumb: "é".repeat(8_000) }))).toEqual([
			"thumb",
		]);
	});

	it("createdAt は ISO 8601 の日時", () => {
		expect(
			issuePaths(imageRefsRecordSchema, refsRecord({ createdAt: "2026-09-23T12:00:00Z" })),
		).toEqual([]);
		for (const createdAt of ["2026-09-23", "not a date", 1_790_000_000_000]) {
			expect(issuePaths(imageRefsRecordSchema, refsRecord({ createdAt }))).toEqual(["createdAt"]);
		}
	});

	it("参照元の各項目を確かめる", () => {
		const withOwner = (overrides: Record<string, unknown>) =>
			issuePaths(imageRefsRecordSchema, refsRecord({ owners: [owner(), owner(overrides)] }));
		expect(withOwner({ field: "Cover" })).toEqual(["owners.1.field"]);
		expect(withOwner({ collection: "a".repeat(64) })).toEqual(["owners.1.collection"]);
		expect(withOwner({ entryId: "a/b" })).toEqual(["owners.1.entryId"]);
		expect(withOwner({ locale: undefined })).toEqual(["owners.1.locale"]);
	});
});

describe("アップロードの入力(仕様書 7 章)", () => {
	it("仕様書の形を受け付ける", () => {
		expect(issuePaths(uploadRequestSchema, upload())).toEqual([]);
	});

	it("新規エントリでは entryId と locale を省略できる", () => {
		const target = { collection: "posts", field: "cover" };
		expect(issuePaths(uploadRequestSchema, upload({ target }))).toEqual([]);
	});

	it("data URL は 500,000 バイト、サムネイルは 8,000 バイトまで", () => {
		expect(issuePaths(uploadRequestSchema, upload({ dataUrl: "a".repeat(500_000) }))).toEqual([]);
		expect(issuePaths(uploadRequestSchema, upload({ dataUrl: "a".repeat(500_001) }))).toEqual([
			"dataUrl",
		]);
		expect(issuePaths(uploadRequestSchema, upload({ thumb: "a".repeat(8_001) }))).toEqual([
			"thumb",
		]);
	});

	it("画質は必須で 0〜1", () => {
		expect(issuePaths(uploadRequestSchema, upload({ quality: undefined }))).toEqual(["quality"]);
		expect(issuePaths(uploadRequestSchema, upload({ quality: 1.5 }))).toEqual(["quality"]);
	});

	it("保存先の slug は EmDash の規則(英小文字で始まる英小文字・数字・_ で 63 文字まで)", () => {
		expect(issuePaths(uploadRequestSchema, upload({}, { collection: "a".repeat(63) }))).toEqual([]);
		expect(issuePaths(uploadRequestSchema, upload({}, { collection: "a".repeat(64) }))).toEqual([
			"target.collection",
		]);
		expect(issuePaths(uploadRequestSchema, upload({}, { collection: "Posts" }))).toEqual([
			"target.collection",
		]);
		expect(issuePaths(uploadRequestSchema, upload({}, { field: "cover-image" }))).toEqual([
			"target.field",
		]);
	});

	it("知らないキーを拒否する", () => {
		expect(issuePaths(uploadRequestSchema, upload({ bytes: 1 }))).toEqual([""]);
		expect(issuePaths(uploadRequestSchema, upload({}, { slug: "x" }))).toEqual(["target"]);
	});

	it("応答の参照は、そのままフィールドの値として通る", () => {
		const response = uploadResponseSchema.parse({ ref: ref({ alt: "" }) });
		expect(isBase64ImageRef(response.ref)).toBe(true);
	});
});

describe("プレビュー取得・サムネイル取得", () => {
	it("プレビューは 1 回に 1〜10 件", () => {
		expect(issuePaths(previewRequestSchema, { ids: ids(1) })).toEqual([]);
		expect(issuePaths(previewRequestSchema, { ids: ids(10) })).toEqual([]);
		expect(issuePaths(previewRequestSchema, { ids: [] })).toEqual(["ids"]);
		expect(issuePaths(previewRequestSchema, { ids: ids(11) })).toEqual(["ids"]);
	});

	it("サムネイルは 1 回に 1〜100 件(一覧の 1 ページ分)", () => {
		expect(issuePaths(thumbnailsRequestSchema, { ids: ids(100) })).toEqual([]);
		expect(issuePaths(thumbnailsRequestSchema, { ids: ids(101) })).toEqual(["ids"]);
	});

	it("見つからない画像は null で返す", () => {
		const body = {
			items: [
				{ id: IMAGE_ID, image: entry() },
				{ id: "img2", image: null },
			],
		};
		expect(issuePaths(previewResponseSchema, body)).toEqual([]);
	});
});

describe("画像管理の一覧(仕様書 9 章・11.5)", () => {
	it("参照元ごとの状態・画像の状態とは別に、画像エントリ自身の状態を必ず持つ", () => {
		expect(
			issuePaths(
				imageListItemSchema,
				listItem({
					entryStatus: "trashed",
					usage: "owner_deleted",
					owners: [{ ...owner(), status: "owner_deleted" }],
				}),
			),
		).toEqual([]);
		expect(issuePaths(imageListItemSchema, listItem({ entryStatus: undefined }))).toEqual([
			"entryStatus",
		]);
	});

	it.each(["active", "trashed", "missing"])("画像エントリの状態 %s を受け付ける", (entryStatus) => {
		expect(issuePaths(imageListItemSchema, listItem({ entryStatus }))).toEqual([]);
	});

	it("参照元が無い画像は no_owner にでき、参照元ごとの状態には no_owner を使わない", () => {
		expect(issuePaths(imageListItemSchema, listItem({ usage: "no_owner", owners: [] }))).toEqual(
			[],
		);
		expect(
			issuePaths(imageListItemSchema, listItem({ owners: [{ ...owner(), status: "no_owner" }] })),
		).toEqual(["owners.0.status"]);
	});

	it("カーソルは省略でき、空文字は拒否する", () => {
		expect(issuePaths(imagesListRequestSchema, {})).toEqual([]);
		expect(issuePaths(imagesListRequestSchema, { cursor: "" })).toEqual(["cursor"]);
	});
});

describe("フィールドの options(仕様書 13.2)", () => {
	const DEFAULTS = {
		maxStoredBytes: 100_000,
		maxEdge: 1_600,
		minQuality: 0.6,
		minEdge: 480,
		maxItems: 10,
	};

	it("options が無い・オブジェクトでないときは、すべて既定値にする", () => {
		for (const options of [undefined, null, "x", 1, [], [{ value: "a", label: "A" }]]) {
			expect(normalizeFieldOptions(options)).toEqual(DEFAULTS);
		}
	});

	it("書かれた項目を使い、残りを既定値で補う", () => {
		expect(normalizeFieldOptions({ maxStoredBytes: 200_000, maxItems: 5 })).toEqual({
			...DEFAULTS,
			maxStoredBytes: 200_000,
			maxItems: 5,
		});
	});

	it("上限を超える値は上限に丸める(保存サイズは固定上限の 500,000)", () => {
		expect(
			normalizeFieldOptions({
				maxStoredBytes: 600_000,
				maxEdge: 10_000,
				minQuality: 0.95,
				minEdge: 5_000,
				maxItems: 100,
			}),
		).toEqual({
			maxStoredBytes: 500_000,
			maxEdge: 4_096,
			minQuality: 0.92,
			minEdge: 4_096,
			maxItems: 20,
		});
	});

	it("下限を下回る値は下限に丸める", () => {
		expect(
			normalizeFieldOptions({
				maxStoredBytes: 0,
				maxEdge: 10,
				minQuality: -1,
				minEdge: 1,
				maxItems: 0,
			}),
		).toEqual({ maxStoredBytes: 10_000, maxEdge: 96, minQuality: 0, minEdge: 96, maxItems: 1 });
	});

	it("範囲の端の値はそのまま使う", () => {
		const upper = { maxStoredBytes: 500_000, maxEdge: 4_096, minQuality: 0.92, minEdge: 4_096 };
		expect(normalizeFieldOptions({ ...upper, maxItems: 20 })).toEqual({ ...upper, maxItems: 20 });
		const lower = { maxStoredBytes: 10_000, maxEdge: 96, minQuality: 0, minEdge: 96 };
		expect(normalizeFieldOptions({ ...lower, maxItems: 1 })).toEqual({ ...lower, maxItems: 1 });
	});

	it("整数の項目は小数点以下を切り捨て、画質はそのまま使う", () => {
		expect(
			normalizeFieldOptions({
				maxStoredBytes: 100_000.9,
				maxEdge: 1_600.5,
				minQuality: 0.755,
				minEdge: 480.9,
				maxItems: 10.9,
			}),
		).toEqual({
			maxStoredBytes: 100_000,
			maxEdge: 1_600,
			minQuality: 0.755,
			minEdge: 480,
			maxItems: 10,
		});
	});

	it.each([
		"200000",
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		null,
		true,
		{},
	])("数値でない値・有限でない値 %j は既定値にする", (value) => {
		expect(
			normalizeFieldOptions({
				maxStoredBytes: value,
				maxEdge: value,
				minQuality: value,
				minEdge: value,
				maxItems: value,
			}),
		).toEqual(DEFAULTS);
	});

	it("minEdge は maxEdge 以下にする", () => {
		expect(normalizeFieldOptions({ maxEdge: 400 })).toMatchObject({ maxEdge: 400, minEdge: 400 });
		expect(normalizeFieldOptions({ maxEdge: 800, minEdge: 1_000 })).toMatchObject({
			maxEdge: 800,
			minEdge: 800,
		});
		expect(normalizeFieldOptions({ maxEdge: 800, minEdge: 500 })).toMatchObject({
			maxEdge: 800,
			minEdge: 500,
		});
	});

	it("継承したプロパティは読まない", () => {
		const options: unknown = Object.create({ maxItems: 5 });
		expect(normalizeFieldOptions(options)).toEqual(DEFAULTS);
	});
});

describe("widget の判定", () => {
	it("このプラグインの widget の種類を返す", () => {
		expect(getWidgetKind("base64-image:image")).toBe("image");
		expect(getWidgetKind("base64-image:gallery")).toBe("gallery");
	});

	it.each(["base64-image:other", "color:image", "image", "base64-image:", undefined, null])(
		"%j は null にする",
		(widget) => {
			expect(getWidgetKind(widget)).toBeNull();
		},
	);
});

describe("エラーコード", () => {
	const allCodes: string[] = [
		...SERVER_ERROR_CODES,
		...CLIENT_ERROR_CODES,
		...HOST_ERROR_CODES,
		...NOTICE_CODES,
	];

	it("SCREAMING_SNAKE_CASE で、重複が無い", () => {
		for (const code of allCodes) {
			expect(code).toMatch(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/);
		}
		expect(new Set(allCodes).size).toBe(allCodes.length);
	});

	it("このプラグインと EmDash のエラーコードだけを既知とする(注意のコードは含めない)", () => {
		expect(isKnownErrorCode("IMAGE_TOO_LARGE")).toBe(true);
		expect(isKnownErrorCode("INPUT_HEIC_REJECTED")).toBe(true);
		expect(isKnownErrorCode("FORBIDDEN")).toBe(true);
		expect(isKnownErrorCode("GIF_FIRST_FRAME_ONLY")).toBe(false);
		expect(isKnownErrorCode("SOMETHING_ELSE")).toBe(false);
		expect(isKnownErrorCode(404)).toBe(false);
	});

	it("Base64ImageError はコード・メッセージ・追加情報・原因を持つ", () => {
		const cause = new Error("toBlob returned null");
		const error = new Base64ImageError("ENCODE_FAILED", "Failed to encode", {
			details: { width: 1280 },
			cause,
		});
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("Base64ImageError");
		expect(error.code).toBe("ENCODE_FAILED");
		expect(error.message).toBe("Failed to encode");
		expect(error.details).toEqual({ width: 1280 });
		expect(error.cause).toBe(cause);
		expect(new Base64ImageError("IMAGE_NOT_FOUND").message).toBe("IMAGE_NOT_FOUND");
	});

	it("別に読み込まれたモジュールで作られたエラーも Base64ImageError と判定する", () => {
		expect(isBase64ImageError(new Base64ImageError("IMAGE_TOO_LARGE"))).toBe(true);
		const copy = Object.assign(new Error("x"), {
			name: "Base64ImageError",
			code: "IMAGE_TOO_LARGE",
		});
		expect(isBase64ImageError(copy)).toBe(true);
		const unknownCode = Object.assign(new Error("x"), { name: "Base64ImageError", code: "OTHER" });
		expect(isBase64ImageError(unknownCode)).toBe(false);
		expect(isBase64ImageError(new Error("IMAGE_TOO_LARGE"))).toBe(false);
		expect(isBase64ImageError({ name: "Base64ImageError", code: "IMAGE_TOO_LARGE" })).toBe(false);
	});
});

describe("ルートの応答の形", () => {
	it("エラーの body(EmDash 0.39.1 の PluginRouteError を変換した形)を読める", () => {
		const body = {
			success: false,
			error: { code: "IMAGE_TOO_LARGE", message: "dataUrl exceeds 100000 bytes" },
		};
		expect(routeErrorBodySchema.parse(body)).toEqual(body);
	});

	it("成功の body から data を取り出し、エラーの body は成功として読まない", () => {
		const schema = routeSuccessBodySchema(uploadResponseSchema);
		expect(schema.parse({ success: true, data: { ref: ref() } }).data.ref.id).toBe(IMAGE_ID);
		expect(
			issuePaths(schema, { success: false, error: { code: "FORBIDDEN", message: "Forbidden" } }),
		).toContain("success");
	});
});

describe("型(tsc で確かめる)", () => {
	it("サイト側の値(画像エントリ + id + alt)は EmDash の MediaValue に代入できる", () => {
		expectTypeOf<ResolvedBase64Image>().toExtend<MediaValue>();
	});

	it("type guard で unknown を参照の型に絞り込める", () => {
		expectTypeOf(isBase64ImageRef).guards.toEqualTypeOf<Base64ImageRef>();
	});

	it("アップロードの入力のスキーマを、ルートの input にそのまま渡せる", () => {
		expectTypeOf(uploadRequestSchema).toExtend<NonNullable<PluginRoute<UploadRequest>["input"]>>();
	});

	it("ルートの permission は、どれも EmDash の Permission", () => {
		expectTypeOf<(typeof ROUTE_PERMISSIONS)[RouteKey]>().toExtend<
			NonNullable<PluginRoute["permission"]>
		>();
	});
});
