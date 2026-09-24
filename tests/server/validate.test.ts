import { readFileSync } from "node:fs";

import type { CollectionSchemaInfo } from "emdash";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
	IMAGE_ENTRY_LIMITS,
	VALIDATION_ERROR_CODES,
	getFieldWidgetKind,
	resolveUploadTarget,
	validateImageEntry,
	validateUpload,
	validateUploadImages,
	type CollectionSchemaLike,
	type FieldSchemaLike,
	type ImageLimits,
	type UploadImagesInput,
	type UploadInputLike,
	type ValidationReason,
} from "../../src/server/validate";
import {
	DEFAULT_FIELD_OPTIONS,
	MAX_EDGE_LIMIT,
	MAX_STORED_BYTES_LIMIT,
	SCHEMA_VERSION,
	THUMB_EDGE,
	THUMB_MAX_STORED_BYTES,
	WEBP_MAX_DIMENSION,
	WEBP_MIME_TYPE,
	WIDGET_IDS,
} from "../../src/shared/constants";
import {
	decodeBase64,
	storedBytesForWebp,
	toWebpDataUrl,
	type DataUrlErrorReason,
} from "../../src/shared/data-url";
import { ERROR_HTTP_STATUS, SERVER_ERROR_CODES } from "../../src/shared/errors";
import { normalizeFieldOptions } from "../../src/shared/options";
import type { UploadRequest } from "../../src/shared/types";
import type { WebpErrorReason } from "../../src/shared/webp";

// ---------------------------------------------------------------------------
// テスト用の WebP
// ---------------------------------------------------------------------------

/** tests/fixtures/webp/ の WebP(作り方は同じディレクトリの README.md) */
function fixture(name: string): Uint8Array {
	return Uint8Array.from(readFileSync(new URL(`../fixtures/webp/${name}`, import.meta.url)));
}

function fromBase64(base64: string): Uint8Array {
	const decoded = decodeBase64(base64);
	if (decoded.ok === false) throw new Error("テストの base64 が不正");
	return decoded.bytes;
}

/**
 * Chromium 153(Playwright 1.63.0、headless)の canvas の `toBlob("image/webp", 0.8)` の出力。
 * 不透明のグラデーション(右に行くほど赤、下に行くほど緑)を描いた。どれも `VP8X` + `ICCP`(464 バイト)+ `VP8 ` で、
 * 寸法は `VP8X` のキャンバスと `VP8 ` のフレームヘッダーの両方にある(webpinfo 1.6.0 で確かめた)。
 */
const CHROMIUM_96X64 = fromBase64(
	"UklGRgoDAABXRUJQVlA4WAoAAAAgAAAAXwAAPwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggHAEAADAKAJ0BKmAAQAA+bTaXSKQjIiIldAgAgA2JYgGEAhKQiFQfJ04I6fUOQsXhX4yTdFOTKTlw7c3f////oteGjdOqmx5UVfvafCde2fv5xIGDkLQKi/P////fAAD++A/j/df//1yFUObfcBLT/88uLqmtfUyXrgyxB+IaHDMag/t8nDozFRa9rqLdnVipQGYxpuJfulHz8c2UrvefBFRAmBhREM3auqyP9MEeoIdTPZpTDbIglUB6HOXuzpY6DodC1ejANVn6AwpPnJsAiBWtmB2x3kCByoZWeNwOIlOpttaYkvXS9gLJMOChKfgI7VRCTnkX6IVeR1gWESpS0poAst3tFczM7YMRPur0GaWjLTAlYwt/JUrYxk3SgAAA",
);
/** 縦長(長辺は高さ) */
const CHROMIUM_65X97 = fromBase64(
	"UklGRmQDAABXRUJQVlA4WAoAAAAgAAAAQAAAYAAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggdgEAANANAJ0BKkEAYQA+bSyPRbU2oRr4ruVoBsSgGEAgzLnmlfTcz0ZB+riJzFYCChVqS2s2tPN0e/CGG0gGBD/Fxu/fu/5y1nBxsfX1AjL/C1M/VGlqejCogz+5De4PdrIoo0rRydbZdX2Myc0WQtpkR47yDYdLdVHAAP79nh0kTUKSP/89M9JvLfLVN8dfpSE743b2MBg997+OPD5i3nPfczqZLjCx50EOPl+I3X2V5yGIhwIo3yRJXhg+lo6AvA/EdXzeNL6hpysZE/j1D57mF4j7ROU3zpDyUWQylUlYjU3+/7NlQNDPso9jVj1kiYb4IQjZ14pabTRNQhdADbNrdYkmeEf06KblujVF0eaHf76N/14Nib8ebwQ55z2sZ0l9HwBGAheLYsH23n9FE627qUjLyfTBCucTKQTfW4fM7aAb6xkI96qumy93xwsDpkeNDgARpA2wQrnE0mfF9QrNf5L3HXMsjOpJea58Xw71iRLgvcK1AAAA",
);
/** 長辺が `MAX_EDGE_LIMIT`(4,096)ちょうど */
const CHROMIUM_4096X1 = fromBase64(
	"UklGRmYDAABXRUJQVlA4WAoAAAAgAAAA/w8AAAAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggeAEAABASAJ0BKgAQAQA+bTaZSaQjIqEgKACADYlpbuE7dfawGH95BvlFvMegAT2Ae+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ycKAD+9sar/+hJ///E2f//E2f7aXvftP0a7n5JxEQxoJXRX8oqtEEP7VgS18i9vv8MIhzti+7N+qch8digxegyYkYQ5MWgfDTYpwKx/0hZEllnWln19Vo6v8LRWLNEIs3Ef0TDXIBh83FdutMF7vInUTddhix1/8c2dI3V4yNBJBdcwLXYo4JyWq9vz81drrHTbB6dJ0zwGUbb2cmMlUeGDoynKdepXIY0Q0fw3IIZ6GbAtS+prEFYazVuHJe/JgkS2Krq+OWWtfLBrgiW9i0sfqJ+S1jO8DHrXydBhd7pwAA=",
);
/** 長辺が `MAX_EDGE_LIMIT` + 1 */
const CHROMIUM_4097X1 = fromBase64(
	"UklGRmoDAABXRUJQVlA4WAoAAAAgAAAAABAAAAAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggfAEAADASAJ0BKgEQAQA+bTaZSaQjIqEgKACADYlpbuE7dfawGH95BvlFvMegAT2Ae+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ycfwAA/vbGq//oSf//xNn//xNn+2l737T9Gu5+ScREMaCV0V/KKrRBD+1YEtfIvb7/DCIc7YvuzfqhTUuGV//JCBxtop78v0RvOtxt9zZIWRJZZ1pZ9fVaOr/C0VizRCLNxH9Ew1yAYfNxXbrTBe7yJ1EswmpHXENe9iHV4yNBJBdbc6leG98Nx980AedQbr0m3uNVfiaz+QpJUpriXu/GFV4BilDDRlmayuuMceEezKOGlAB8stYm5qUWhu6bo8ZEdYGPVZAtKdLpQdOWUvX/1nK/OAKXbiJubWU5DDI1TveIuAAA",
);

const LOSSY = fixture("lossy.webp"); // VP8、300 × 199
const LOSSLESS = fixture("lossless.webp"); // VP8L、257 × 129
const LOSSY_ALPHA = fixture("lossy-alpha.webp"); // VP8X + ALPH + VP8、261 × 173
const LOSSLESS_ALPHA = fixture("lossless-alpha.webp"); // VP8L(透過)、131 × 67
const LOSSLESS_XMP = fixture("lossless-xmp.webp"); // VP8X + VP8L + XMP、63 × 37
const ANIMATED = fixture("animated.webp"); // VP8X + ANIM + ANMF × 2、97 × 61(キャンバス)

/** 受け付ける WebP(形式・寸法) */
const STILL_IMAGES = [
	{ name: "lossy.webp(VP8)", bytes: LOSSY, width: 300, height: 199 },
	{ name: "lossless.webp(VP8L)", bytes: LOSSLESS, width: 257, height: 129 },
	{ name: "lossy-alpha.webp(VP8X + ALPH + VP8)", bytes: LOSSY_ALPHA, width: 261, height: 173 },
	{ name: "lossless-alpha.webp(VP8L、透過)", bytes: LOSSLESS_ALPHA, width: 131, height: 67 },
	{ name: "lossless-xmp.webp(VP8X + VP8L + XMP)", bytes: LOSSLESS_XMP, width: 63, height: 37 },
	{ name: "Chromium の canvas(VP8X + ICCP + VP8)", bytes: CHROMIUM_96X64, width: 96, height: 64 },
	{ name: "Chromium の canvas(縦長)", bytes: CHROMIUM_65X97, width: 65, height: 97 },
] as const;

function ascii(text: string): Uint8Array {
	return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/** RIFF のサイズ欄を、データ長に合う値にしたコピー */
function withRiffSize(bytes: Uint8Array): Uint8Array {
	const copy = bytes.slice();
	new DataView(copy.buffer).setUint32(4, copy.length - 8, true);
	return copy;
}

/** `offset` からのバイトを書き換えたコピー */
function patch(bytes: Uint8Array, offset: number, values: readonly number[]): Uint8Array {
	const copy = bytes.slice();
	copy.set(values, offset);
	return copy;
}

/**
 * 拡張形式(`VP8X`)の WebP の末尾に `XMP ` チャンク(中身は 0)を足し、`VP8X` の XMP フラグを立てて、
 * 全体を `size` バイトにする。実際の WebP から、境界の大きさの WebP を作るため。
 * RIFF のチャンクは偶数バイトなので、`size` は偶数に限る。
 * この形は、libwebp 1.6.0 の dwebp でデコードでき、webpinfo もエラー・警告を出さない。
 */
function padWebp(webp: Uint8Array, size: number): Uint8Array {
	const payload = size - webp.length - 8;
	if (String.fromCharCode(...webp.subarray(12, 16)) !== "VP8X") {
		throw new Error("拡張形式の WebP だけを伸ばせる");
	}
	if (payload < 0 || payload % 2 !== 0) throw new RangeError(`${webp.length} → ${size} は作れない`);
	const out = new Uint8Array(size);
	out.set(webp);
	out.set(ascii("XMP "), webp.length);
	const view = new DataView(out.buffer);
	view.setUint32(webp.length + 4, payload, true);
	view.setUint32(4, size - 8, true);
	view.setUint8(20, view.getUint8(20) | 0x04);
	return out;
}

/**
 * `VP8L` の中身の先頭(シグネチャと寸法)だけを持つ WebP。圧縮データの代わりは 0。
 * 16,384px の WebP はエンコーダーで作れない(libwebp の上限は 16,383px)ので、ヘッダーを組み立てる。
 */
function vp8lHeaderOnly(width: number, height: number): Uint8Array {
	const payload = new Uint8Array(16);
	payload[0] = 0x2f;
	new DataView(payload.buffer).setUint32(1, ((width - 1) | ((height - 1) << 14)) >>> 0, true);
	const size = new Uint8Array(4);
	new DataView(size.buffer).setUint32(0, payload.length, true);
	return withRiffSize(
		concat(ascii("RIFF"), new Uint8Array(4), ascii("WEBP"), ascii("VP8L"), size, payload),
	);
}

// 境界の大きさの WebP(data URL の長さ = 23 + 4 × ceil(B / 3)。B は偶数に限る)
const THUMB_7999 = toWebpDataUrl(padWebp(CHROMIUM_96X64, 5_982));
const THUMB_8003 = toWebpDataUrl(padWebp(CHROMIUM_96X64, 5_984));
const IMAGE_99999 = toWebpDataUrl(padWebp(CHROMIUM_96X64, 74_982));
const IMAGE_100003 = toWebpDataUrl(padWebp(CHROMIUM_96X64, 74_984));
const IMAGE_499999 = toWebpDataUrl(padWebp(CHROMIUM_96X64, 374_982));
const IMAGE_500003 = toWebpDataUrl(padWebp(CHROMIUM_96X64, 374_984));

// ---------------------------------------------------------------------------
// 入力を作る
// ---------------------------------------------------------------------------

const TARGET = { collection: "posts", field: "cover" } as const;

function field(overrides: Partial<FieldSchemaLike> = {}): FieldSchemaLike {
	return { slug: TARGET.field, type: "json", widget: WIDGET_IDS.image, ...overrides };
}

function posts(...fields: readonly FieldSchemaLike[]): CollectionSchemaLike {
	return {
		slug: TARGET.collection,
		fields: [{ slug: "title", type: "string" }, ...fields],
	};
}

/** 既定の options のフィールドを持つコレクション */
const POSTS = posts(field());

/** アップロードの入力(ルートの `ctx.input` と同じ型)。既定は lossy.webp とそのサムネイル */
function upload(overrides: Partial<UploadRequest> = {}): UploadRequest {
	return {
		dataUrl: toWebpDataUrl(LOSSY),
		thumb: toWebpDataUrl(CHROMIUM_96X64),
		width: 300,
		height: 199,
		quality: 0.77,
		target: { ...TARGET },
		...overrides,
	};
}

/** 画像本体だけを差し替えたアップロードの入力 */
function uploadImage(webp: Uint8Array, width: number, height: number): UploadRequest {
	return upload({ dataUrl: toWebpDataUrl(webp), width, height });
}

/** options を指定したフィールドへのアップロードを検証する */
function validateWithOptions(input: UploadRequest, options: Record<string, unknown>) {
	return validateUpload(input, posts(field({ options })));
}

/** 画像エントリの値(`b64_images` の `image`) */
function entry(
	webp: Uint8Array,
	width: number,
	height: number,
	overrides: Record<string, unknown> = {},
) {
	return {
		src: toWebpDataUrl(webp),
		mimeType: WEBP_MIME_TYPE,
		width,
		height,
		filename: "IMG_0001.jpg",
		meta: { v: SCHEMA_VERSION, bytes: webp.length, quality: 0.77 },
		...overrides,
	};
}

/** data URL だけを差し替えた画像エントリの値(寸法と meta.bytes は CHROMIUM_96X64 のもの) */
function entryWithSrc(src: string) {
	return { ...entry(CHROMIUM_96X64, 96, 64), src };
}

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ① 保存先のフィールド
// ---------------------------------------------------------------------------

describe("getFieldWidgetKind", () => {
	it.each([
		[{ type: "json", widget: WIDGET_IDS.image }, "image"],
		[{ type: "json", widget: WIDGET_IDS.gallery }, "gallery"],
		[{ type: "json", widget: undefined }, null],
		[{ type: "json", widget: "other-plugin:image" }, null],
		[{ type: "json", widget: "base64-image:unknown" }, null],
		// widget は型を見ずに割り当てられるが、参照を保存できるのは json フィールドだけ
		[{ type: "string", widget: WIDGET_IDS.image }, null],
		[{ type: "image", widget: WIDGET_IDS.image }, null],
	] as const)("%o → %s", (overrides, expected) => {
		expect(getFieldWidgetKind(field(overrides))).toBe(expected);
	});
});

describe("resolveUploadTarget", () => {
	it("このプラグインの widget の json フィールドなら、種類と補完した options を返す", () => {
		expect(resolveUploadTarget(POSTS, TARGET)).toEqual({
			ok: true,
			kind: "image",
			options: DEFAULT_FIELD_OPTIONS,
		});
		const gallery = posts(
			field({ widget: WIDGET_IDS.gallery, options: { maxStoredBytes: 200_000, maxItems: 5 } }),
		);
		expect(resolveUploadTarget(gallery, TARGET)).toEqual({
			ok: true,
			kind: "gallery",
			options: { ...DEFAULT_FIELD_OPTIONS, maxStoredBytes: 200_000, maxItems: 5 },
		});
	});

	it("options は normalizeFieldOptions で丸める(固定上限を超えない)", () => {
		const result = resolveUploadTarget(
			posts(field({ options: { maxStoredBytes: 10_000_000, maxEdge: 99_999, minQuality: "x" } })),
			TARGET,
		);
		expect(result).toMatchObject({
			ok: true,
			options: {
				maxStoredBytes: MAX_STORED_BYTES_LIMIT,
				maxEdge: MAX_EDGE_LIMIT,
				minQuality: DEFAULT_FIELD_OPTIONS.minQuality,
			},
		});
	});

	// options は DB の JSON を parse しただけの値なので、オブジェクトとは限らない
	it.each([null, [], "100000", 5])("options が %o なら既定値にする", (options) => {
		expect(resolveUploadTarget(posts(field({ options })), TARGET)).toEqual({
			ok: true,
			kind: "image",
			options: DEFAULT_FIELD_OPTIONS,
		});
	});

	it.each<[string, CollectionSchemaLike | null, ValidationReason]>([
		["コレクションが無い", null, "COLLECTION_NOT_FOUND"],
		["別のコレクションのスキーマ", { slug: "pages", fields: [field()] }, "COLLECTION_MISMATCH"],
		["フィールドが無い", posts(field({ slug: "gallery" })), "FIELD_NOT_FOUND"],
		["widget が無い", posts(field({ widget: undefined })), "NOT_PLUGIN_WIDGET"],
		["ほかのプラグインの widget", posts(field({ widget: "color:picker" })), "NOT_PLUGIN_WIDGET"],
		[
			"前後に空白がある widget",
			posts(field({ widget: ` ${WIDGET_IDS.image}` })),
			"NOT_PLUGIN_WIDGET",
		],
		["json でないフィールド", posts(field({ type: "string" })), "NOT_JSON_FIELD"],
		["EmDash の image フィールド", posts(field({ type: "image" })), "NOT_JSON_FIELD"],
	])("%s → INVALID_TARGET", (_label, collection, reason) => {
		const result = resolveUploadTarget(collection, TARGET);
		expect(result).toMatchObject({ ok: false, code: "INVALID_TARGET", reason });
		if (result.ok === true) return;
		expect(result.message).toContain(`"${TARGET.collection}`);
	});

	it("受け付けるフィールドは getFieldWidgetKind と一致する", () => {
		const types = ["json", "string", "text", "image", "repeater"];
		const widgets = [undefined, WIDGET_IDS.image, WIDGET_IDS.gallery, "other:image"];
		for (const type of types) {
			for (const widget of widgets) {
				const candidate = field({ type, widget });
				const result = resolveUploadTarget(posts(candidate), TARGET);
				expect(result.ok).toBe(getFieldWidgetKind(candidate) !== null);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// ① 画像本体とサムネイル
// ---------------------------------------------------------------------------

describe("validateUpload: 受け付けるもの", () => {
	it.each(STILL_IMAGES)("$name", ({ bytes, width, height }) => {
		const input = uploadImage(bytes, width, height);
		const result = validateUpload(input, POSTS);
		expect(result).toMatchObject({
			ok: true,
			kind: "image",
			options: DEFAULT_FIELD_OPTIONS,
			image: {
				storedBytes: input.dataUrl.length,
				webpBytes: bytes.length,
				info: { width, height, animated: false },
			},
			thumb: { webpBytes: CHROMIUM_96X64.length, info: { width: 96, height: 64 } },
		});
		expect(input.dataUrl).toHaveLength(storedBytesForWebp(bytes.length));
	});

	it("Chromium の canvas の形(VP8X + ICCP + VP8)は、寸法を VP8X から読んで受け付ける", () => {
		const result = validateUpload(uploadImage(CHROMIUM_96X64, 96, 64), POSTS);
		expect(result).toMatchObject({
			ok: true,
			image: { info: { format: "extended", width: 96, height: 64, hasAlpha: false } },
		});
	});

	it("サムネイルの寸法は画像本体と違ってよい(本体の縦横比で表示する)", () => {
		const input = upload({ thumb: toWebpDataUrl(LOSSLESS_XMP) });
		expect(validateUpload(input, POSTS)).toMatchObject({
			ok: true,
			thumb: { info: { width: 63, height: 37 } },
		});
	});

	it("validateUploadImages は、FieldOptions をそのまま上限に使える", () => {
		const result = validateUploadImages(upload(), normalizeFieldOptions({ maxEdge: 300 }));
		expect(result).toMatchObject({ ok: true, image: { info: { width: 300 } } });
	});
});

describe("画像本体の保存サイズ(既定の maxStoredBytes 100,000)", () => {
	// data URL の長さは 23 + 4 × ceil(B / 3) なので、正しい data URL は 99,999 の次が 100,003。
	// 100,000 / 100,001 文字は、正しい data URL に文字を足して作り、長さの確認(デコードの前)を試す。

	it("保存 99,999 バイト(WebP 74,982 B)は受け付ける", () => {
		expect(IMAGE_99999).toHaveLength(99_999);
		const result = validateUpload(upload({ dataUrl: IMAGE_99999, width: 96, height: 64 }), POSTS);
		expect(result).toMatchObject({ ok: true, image: { storedBytes: 99_999, webpBytes: 74_982 } });
	});

	it("100,000 文字は長さの確認を通る(base64 として不正なので IMAGE_DATA_INVALID)", () => {
		const dataUrl = `${IMAGE_99999}A`;
		expect(dataUrl).toHaveLength(100_000);
		const result = validateUpload(upload({ dataUrl, width: 96, height: 64 }), POSTS);
		expect(result).toMatchObject({
			ok: false,
			code: "IMAGE_DATA_INVALID",
			reason: "INVALID_BASE64",
		});
	});

	it("100,001 文字は IMAGE_TOO_LARGE", () => {
		const dataUrl = `${IMAGE_99999}AA`;
		expect(dataUrl).toHaveLength(100_001);
		const result = validateUpload(upload({ dataUrl, width: 96, height: 64 }), POSTS);
		expect(result).toMatchObject({
			ok: false,
			code: "IMAGE_TOO_LARGE",
			reason: "STORED_BYTES_OVER_LIMIT",
			message: "dataUrl is 100001 bytes, which exceeds the limit of 100000 bytes",
			details: { storedBytes: 100_001, maxStoredBytes: 100_000 },
		});
	});

	it("保存 100,003 バイト(WebP 74,984 B)の正しい WebP は IMAGE_TOO_LARGE", () => {
		const result = validateUpload(upload({ dataUrl: IMAGE_100003, width: 96, height: 64 }), POSTS);
		expect(result).toMatchObject({ ok: false, code: "IMAGE_TOO_LARGE" });
	});

	it("上限ちょうどは受け付け、1 バイト小さい上限では拒否する", () => {
		const input = upload({ dataUrl: IMAGE_99999, width: 96, height: 64 });
		expect(validateWithOptions(input, { maxStoredBytes: 99_999 })).toMatchObject({ ok: true });
		expect(validateWithOptions(input, { maxStoredBytes: 99_998 })).toMatchObject({
			ok: false,
			code: "IMAGE_TOO_LARGE",
			details: { storedBytes: 99_999, maxStoredBytes: 99_998 },
		});
	});
});

describe("画像本体の固定上限(500,000)", () => {
	// options の maxStoredBytes が大きくても、normalizeFieldOptions で 500,000 に丸める
	const WIDE = { maxStoredBytes: 10_000_000 };

	it("保存 499,999 バイト(WebP 374,982 B)は受け付ける", () => {
		expect(IMAGE_499999).toHaveLength(499_999);
		const input = upload({ dataUrl: IMAGE_499999, width: 96, height: 64 });
		expect(validateWithOptions(input, WIDE)).toMatchObject({
			ok: true,
			image: { storedBytes: 499_999, webpBytes: 374_982 },
		});
	});

	it("500,000 文字は長さの確認を通り、500,001 文字は IMAGE_TOO_LARGE", () => {
		const at = upload({ dataUrl: `${IMAGE_499999}A`, width: 96, height: 64 });
		expect(at.dataUrl).toHaveLength(500_000);
		expect(validateWithOptions(at, WIDE)).toMatchObject({
			ok: false,
			code: "IMAGE_DATA_INVALID",
			reason: "INVALID_BASE64",
		});

		const over = upload({ dataUrl: `${IMAGE_499999}AA`, width: 96, height: 64 });
		expect(over.dataUrl).toHaveLength(500_001);
		expect(validateWithOptions(over, WIDE)).toMatchObject({
			ok: false,
			code: "IMAGE_TOO_LARGE",
			details: { storedBytes: 500_001, maxStoredBytes: MAX_STORED_BYTES_LIMIT },
		});
	});

	it("保存 500,003 バイトの正しい WebP は IMAGE_TOO_LARGE", () => {
		const input = upload({ dataUrl: IMAGE_500003, width: 96, height: 64 });
		expect(validateWithOptions(input, WIDE)).toMatchObject({ ok: false, code: "IMAGE_TOO_LARGE" });
	});

	it("丸めていない上限を渡されても、500,000 を超えるものは受け付けない", () => {
		const limits: ImageLimits = { maxStoredBytes: 1_000_000, maxEdge: 1_600 };
		const input = upload({ dataUrl: IMAGE_500003, width: 96, height: 64 });
		expect(validateUploadImages(input, limits)).toMatchObject({
			ok: false,
			code: "IMAGE_TOO_LARGE",
			details: { maxStoredBytes: MAX_STORED_BYTES_LIMIT },
		});
		const fits = upload({ dataUrl: IMAGE_499999, width: 96, height: 64 });
		expect(validateUploadImages(fits, limits)).toMatchObject({ ok: true });
	});

	it("上限が NaN なら拒否する", () => {
		expect(
			validateUploadImages(upload(), { maxStoredBytes: Number.NaN, maxEdge: 1_600 }),
		).toMatchObject({ ok: false, code: "IMAGE_TOO_LARGE" });
	});
});

describe("長さはデコードする前に確かめる", () => {
	it("上限を超える文字列は、中身が不正でも IMAGE_TOO_LARGE / THUMB_TOO_LARGE になる", () => {
		expect(validateUpload(upload({ dataUrl: "x".repeat(100_001) }), POSTS)).toMatchObject({
			ok: false,
			code: "IMAGE_TOO_LARGE",
		});
		expect(validateUpload(upload({ thumb: " ".repeat(8_001) }), POSTS)).toMatchObject({
			ok: false,
			code: "THUMB_TOO_LARGE",
		});
	});

	it("上限を超える data URL は、base64 のデコーダーに渡さない", () => {
		const fromBase64Spy = vi.spyOn(Uint8Array, "fromBase64");
		const atobSpy = vi.spyOn(globalThis, "atob");
		const huge = `data:image/webp;base64,${"A".repeat(4_000_000)}`;

		expect(validateUpload(upload({ dataUrl: huge }), POSTS)).toMatchObject({
			ok: false,
			code: "IMAGE_TOO_LARGE",
		});
		expect(validateUpload(upload({ thumb: huge }), POSTS)).toMatchObject({
			ok: false,
			code: "THUMB_TOO_LARGE",
		});
		expect(validateImageEntry(entryWithSrc(huge))).toMatchObject({
			ok: false,
			code: "IMAGE_TOO_LARGE",
		});
		// デコードされたのは、2 回目の画像本体(lossy.webp)だけ
		const decodedLengths = fromBase64Spy.mock.calls.map(([base64]) => base64.length);
		expect(decodedLengths).toEqual([
			toWebpDataUrl(LOSSY).length - "data:image/webp;base64,".length,
		]);
		expect(atobSpy).not.toHaveBeenCalled();
	});
});

describe("寸法の一致", () => {
	it.each([
		["幅が 1 大きい", 301, 199],
		["高さが 1 小さい", 300, 198],
		["幅と高さが逆", 199, 300],
		["0", 0, 0],
		["負の値", -300, -199],
		["小数", 300.5, 199],
		["NaN", Number.NaN, 199],
	])("%s → IMAGE_DIMENSIONS_MISMATCH", (_label, width, height) => {
		const result = validateUpload(upload({ width, height }), POSTS);
		expect(result).toMatchObject({
			ok: false,
			code: "IMAGE_DIMENSIONS_MISMATCH",
			reason: "DIMENSIONS_MISMATCH",
			details: { webpWidth: 300, webpHeight: 199 },
		});
		if (result.ok === true) return;
		expect(result.message).toContain("(300x199)");
	});

	it("Chromium の canvas の寸法も VP8X から読んで比べる", () => {
		const input = upload({ dataUrl: toWebpDataUrl(CHROMIUM_96X64), width: 64, height: 96 });
		expect(validateUpload(input, POSTS)).toMatchObject({
			ok: false,
			code: "IMAGE_DIMENSIONS_MISMATCH",
		});
	});
});

describe("画像本体の長辺", () => {
	it("長辺が maxEdge ちょうどなら受け付け、1px でも超えれば IMAGE_EDGE_TOO_LONG(横長)", () => {
		expect(validateWithOptions(upload(), { maxEdge: 300 })).toMatchObject({ ok: true });
		expect(validateWithOptions(upload(), { maxEdge: 299 })).toMatchObject({
			ok: false,
			code: "IMAGE_EDGE_TOO_LONG",
			reason: "EDGE_OVER_LIMIT",
			message: "The longest edge of dataUrl (300px) exceeds the limit of 299px",
			details: { edge: 300, maxEdge: 299 },
		});
	});

	it("縦長の画像は高さを長辺として比べる", () => {
		const input = uploadImage(CHROMIUM_65X97, 65, 97);
		expect(validateWithOptions(input, { maxEdge: 97 })).toMatchObject({ ok: true });
		expect(validateWithOptions(input, { maxEdge: 96 })).toMatchObject({
			ok: false,
			code: "IMAGE_EDGE_TOO_LONG",
			details: { edge: 97, maxEdge: 96 },
		});
	});

	it("options の maxEdge が大きくても、MAX_EDGE_LIMIT(4,096)を超えない", () => {
		const wide = { maxEdge: 99_999 };
		expect(validateWithOptions(uploadImage(CHROMIUM_4096X1, 4_096, 1), wide)).toMatchObject({
			ok: true,
		});
		expect(validateWithOptions(uploadImage(CHROMIUM_4097X1, 4_097, 1), wide)).toMatchObject({
			ok: false,
			code: "IMAGE_EDGE_TOO_LONG",
			details: { edge: 4_097, maxEdge: MAX_EDGE_LIMIT },
		});
	});

	it("丸めていない上限を渡されても、WebP の寸法の上限(16,383px)を超えるものは受け付けない", () => {
		const limits: ImageLimits = { maxStoredBytes: 100_000, maxEdge: 20_000 };
		const at = {
			...upload(),
			dataUrl: toWebpDataUrl(vp8lHeaderOnly(16_383, 1)),
			width: 16_383,
			height: 1,
		};
		expect(validateUploadImages(at, limits)).toMatchObject({ ok: true });
		const over = { ...at, dataUrl: toWebpDataUrl(vp8lHeaderOnly(16_384, 1)), width: 16_384 };
		expect(validateUploadImages(over, limits)).toMatchObject({
			ok: false,
			code: "IMAGE_EDGE_TOO_LONG",
			details: { edge: 16_384, maxEdge: WEBP_MAX_DIMENSION },
		});
	});

	it("上限が NaN なら拒否する", () => {
		expect(
			validateUploadImages(upload(), { maxStoredBytes: 100_000, maxEdge: Number.NaN }),
		).toMatchObject({ ok: false, code: "IMAGE_EDGE_TOO_LONG" });
	});
});

describe("アニメーションの WebP は受け付けない", () => {
	it("画像本体 → IMAGE_DATA_INVALID、サムネイル → THUMB_DATA_INVALID", () => {
		expect(validateUpload(uploadImage(ANIMATED, 97, 61), POSTS)).toMatchObject({
			ok: false,
			code: "IMAGE_DATA_INVALID",
			reason: "ANIMATED",
			message: "dataUrl is an animated WebP; only still images are accepted",
		});
		expect(validateUpload(upload({ thumb: toWebpDataUrl(ANIMATED) }), POSTS)).toMatchObject({
			ok: false,
			code: "THUMB_DATA_INVALID",
			reason: "ANIMATED",
		});
		expect(validateImageEntry(entry(ANIMATED, 97, 61))).toMatchObject({
			ok: false,
			code: "IMAGE_DATA_INVALID",
			reason: "ANIMATED",
		});
	});
});

describe("T04 の理由と、エラーコードの対応", () => {
	// 理由ごとに、実際の WebP を壊した data URL(どれも ASCII の印字可能文字で、画像エントリのスキーマは通る)。
	// 型で T04 の理由を網羅する(理由が増えると型エラーになる)。
	const lossyUrl = toWebpDataUrl(LOSSY);
	const BROKEN: Record<DataUrlErrorReason | WebpErrorReason, string> = {
		NOT_WEBP_DATA_URL: lossyUrl.replace("image/webp", "image/png"),
		INVALID_BASE64: `${lossyUrl.slice(0, 40)}-${lossyUrl.slice(41)}`,
		TOO_SHORT: toWebpDataUrl(LOSSY.slice(0, 12)),
		NOT_WEBP: toWebpDataUrl(patch(LOSSY, 8, [...ascii("WEBX")])),
		RIFF_SIZE_MISMATCH: toWebpDataUrl(concat(LOSSY, new Uint8Array(2))),
		// 単純形式(VP8 だけ)の後ろに、ほかのチャンク
		MALFORMED_CHUNK: toWebpDataUrl(
			withRiffSize(concat(LOSSY, ascii("JUNK"), Uint8Array.of(2, 0, 0, 0, 0, 0))),
		),
		UNSUPPORTED_FORMAT: toWebpDataUrl(patch(LOSSY, 12, [...ascii("ABCD")])),
		// VP8 の開始コード(9d 01 2a)の 1 バイト目
		INVALID_VP8_HEADER: toWebpDataUrl(patch(LOSSY, 23, [0x00])),
		// VP8L のシグネチャ(0x2f)
		INVALID_VP8L_HEADER: toWebpDataUrl(patch(LOSSLESS, 20, [0x00])),
		// VP8X のキャンバスの面積が 2^32 以上
		INVALID_VP8X_HEADER: toWebpDataUrl(
			patch(CHROMIUM_96X64, 24, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
		),
		// VP8X + ICCP だけ(VP8 のチャンクはオフセット 494 から)
		MISSING_IMAGE_DATA: toWebpDataUrl(withRiffSize(CHROMIUM_96X64.slice(0, 494))),
		// VP8X のキャンバスの幅を 97 にする(VP8 は 96)
		CANVAS_SIZE_MISMATCH: toWebpDataUrl(patch(CHROMIUM_96X64, 24, [96])),
	};
	const cases = Object.entries(BROKEN) as [DataUrlErrorReason | WebpErrorReason, string][];

	it.each(cases)("%s: 画像本体 → IMAGE_DATA_INVALID", (reason, dataUrl) => {
		const result = validateUpload(upload({ dataUrl }), POSTS);
		expect(result).toMatchObject({ ok: false, code: "IMAGE_DATA_INVALID", reason });
		if (result.ok === true) return;
		expect(result.message).toMatch(new RegExp(`^dataUrl .+ \\(${reason}\\)$`));
		expect(result.details).toEqual({ webpReason: reason });
	});

	it.each(cases)("%s: サムネイル → THUMB_DATA_INVALID", (reason, thumb) => {
		expect(validateUpload(upload({ thumb }), POSTS)).toMatchObject({
			ok: false,
			code: "THUMB_DATA_INVALID",
			reason,
		});
	});

	it.each(cases)("%s: 画像エントリの src → IMAGE_DATA_INVALID", (reason, src) => {
		const result = validateImageEntry(entryWithSrc(src));
		expect(result).toMatchObject({ ok: false, code: "IMAGE_DATA_INVALID", reason });
		if (result.ok === true) return;
		expect(result.message).toMatch(/^src /);
	});
});

describe("サムネイル", () => {
	it("保存 7,999 バイト(WebP 5,982 B)は受け付ける", () => {
		expect(THUMB_7999).toHaveLength(7_999);
		expect(validateUpload(upload({ thumb: THUMB_7999 }), POSTS)).toMatchObject({
			ok: true,
			thumb: { storedBytes: 7_999, webpBytes: 5_982 },
		});
	});

	it("8,000 文字は長さの確認を通り、8,001 文字は THUMB_TOO_LARGE", () => {
		const at = `${THUMB_7999}A`;
		expect(at).toHaveLength(8_000);
		expect(validateUpload(upload({ thumb: at }), POSTS)).toMatchObject({
			ok: false,
			code: "THUMB_DATA_INVALID",
			reason: "INVALID_BASE64",
		});
		const over = `${THUMB_7999}AA`;
		expect(validateUpload(upload({ thumb: over }), POSTS)).toMatchObject({
			ok: false,
			code: "THUMB_TOO_LARGE",
			reason: "STORED_BYTES_OVER_LIMIT",
			details: { storedBytes: 8_001, maxStoredBytes: THUMB_MAX_STORED_BYTES },
		});
	});

	it("保存 8,003 バイトの正しい WebP は、フィールドの maxStoredBytes に関係なく THUMB_TOO_LARGE", () => {
		const input = upload({ thumb: THUMB_8003 });
		expect(validateWithOptions(input, { maxStoredBytes: MAX_STORED_BYTES_LIMIT })).toMatchObject({
			ok: false,
			code: "THUMB_TOO_LARGE",
		});
	});

	it("長辺は 96px まで。超えると THUMB_DATA_INVALID(縦長は高さで比べる)", () => {
		expect(validateUpload(upload({ thumb: toWebpDataUrl(CHROMIUM_96X64) }), POSTS)).toMatchObject({
			ok: true,
		});
		expect(validateUpload(upload({ thumb: toWebpDataUrl(CHROMIUM_65X97) }), POSTS)).toMatchObject({
			ok: false,
			code: "THUMB_DATA_INVALID",
			reason: "EDGE_OVER_LIMIT",
			message: `The longest edge of thumb (97px) exceeds ${THUMB_EDGE}px`,
			details: { edge: 97, maxEdge: THUMB_EDGE },
		});
		expect(validateUpload(upload({ thumb: toWebpDataUrl(LOSSY) }), POSTS)).toMatchObject({
			ok: false,
			code: "THUMB_DATA_INVALID",
			details: { edge: 300 },
		});
	});
});

describe("確かめる順番", () => {
	it("保存先 → 画像本体 → サムネイルの順に、最初の問題を返す", () => {
		const bothBroken = upload({ dataUrl: "x".repeat(200_000), thumb: "y".repeat(9_000) });
		expect(validateUpload(bothBroken, null)).toMatchObject({ code: "INVALID_TARGET" });
		expect(validateUpload(bothBroken, POSTS)).toMatchObject({ code: "IMAGE_TOO_LARGE" });

		const imageInvalid = upload({ dataUrl: toWebpDataUrl(ANIMATED), thumb: "y".repeat(9_000) });
		expect(validateUpload(imageInvalid, POSTS)).toMatchObject({ code: "IMAGE_DATA_INVALID" });

		const dimensionsAndThumb = upload({ width: 1, thumb: toWebpDataUrl(ANIMATED) });
		expect(validateUpload(dimensionsAndThumb, POSTS)).toMatchObject({
			code: "IMAGE_DIMENSIONS_MISMATCH",
		});
	});

	it("寸法の一致を、長辺より先に確かめる", () => {
		// 申告も実際も上限を超えるが、寸法が違うことを先に返す
		const input = uploadImage(CHROMIUM_4097X1, 4_096, 1);
		expect(validateWithOptions(input, { maxEdge: 4_096 })).toMatchObject({
			code: "IMAGE_DIMENSIONS_MISMATCH",
		});
	});
});

// ---------------------------------------------------------------------------
// ② 画像エントリの値
// ---------------------------------------------------------------------------

describe("validateImageEntry: 受け付けるもの", () => {
	it.each(STILL_IMAGES)("$name", ({ bytes, width, height }) => {
		const value = entry(bytes, width, height);
		expect(validateImageEntry(value)).toEqual({
			ok: true,
			entry: value,
			image: {
				storedBytes: value.src.length,
				webpBytes: bytes.length,
				info: expect.objectContaining({ width, height, animated: false }),
			},
		});
	});

	it("filename と meta.quality は省略できる", () => {
		const { filename: _filename, ...withoutFilename } = entry(LOSSY, 300, 199);
		const value = { ...withoutFilename, meta: { v: SCHEMA_VERSION, bytes: LOSSY.length } };
		expect(validateImageEntry(value)).toMatchObject({ ok: true });
	});

	it("上限は固定上限(保存 500,000 バイト・長辺 4,096px)", () => {
		expect(IMAGE_ENTRY_LIMITS).toEqual({
			maxStoredBytes: MAX_STORED_BYTES_LIMIT,
			maxEdge: MAX_EDGE_LIMIT,
		});
		const at = entry(padWebp(CHROMIUM_96X64, 374_982), 96, 64);
		expect(at.src).toBe(IMAGE_499999);
		expect(validateImageEntry(at)).toMatchObject({ ok: true, image: { storedBytes: 499_999 } });
		expect(validateImageEntry(entry(CHROMIUM_4096X1, 4_096, 1))).toMatchObject({ ok: true });
	});
});

describe("validateImageEntry: 拒否するもの", () => {
	it("保存 500,003 バイトの正しい WebP → IMAGE_TOO_LARGE", () => {
		const value = entry(padWebp(CHROMIUM_96X64, 374_984), 96, 64);
		expect(validateImageEntry(value)).toMatchObject({
			ok: false,
			code: "IMAGE_TOO_LARGE",
			message: "src is 500003 bytes, which exceeds the limit of 500000 bytes",
		});
	});

	it("500,001 文字の src は、スキーマより先に IMAGE_TOO_LARGE になる", () => {
		// スキーマ(max 500,000)で先に確かめると IMAGE_ENTRY_INVALID になる
		const src = `${IMAGE_499999}AA`;
		expect(validateImageEntry(entryWithSrc(src))).toMatchObject({
			ok: false,
			code: "IMAGE_TOO_LARGE",
			details: { storedBytes: 500_001, maxStoredBytes: MAX_STORED_BYTES_LIMIT },
		});
		// 500,000 文字はスキーマと長さの確認を通り、base64 の確認で拒否される
		expect(validateImageEntry(entryWithSrc(`${IMAGE_499999}A`))).toMatchObject({
			ok: false,
			code: "IMAGE_DATA_INVALID",
			reason: "INVALID_BASE64",
		});
	});

	it("長辺が 4,097px → IMAGE_EDGE_TOO_LONG", () => {
		expect(validateImageEntry(entry(CHROMIUM_4097X1, 4_097, 1))).toMatchObject({
			ok: false,
			code: "IMAGE_EDGE_TOO_LONG",
			message: "The longest edge of src (4097px) exceeds the limit of 4096px",
		});
	});

	it("width / height が WebP と違う → IMAGE_DIMENSIONS_MISMATCH", () => {
		expect(validateImageEntry(entry(LOSSY, 199, 300))).toMatchObject({
			ok: false,
			code: "IMAGE_DIMENSIONS_MISMATCH",
			message: "width x height (199x300) does not match the WebP in src (300x199)",
		});
	});

	it.each([
		["1 大きい", LOSSY.length + 1],
		["1 小さい", LOSSY.length - 1],
		["data URL の長さ", toWebpDataUrl(LOSSY).length],
	])("meta.bytes が WebP 本体のバイト数と違う(%s)→ IMAGE_ENTRY_INVALID", (_label, bytes) => {
		const value = entry(LOSSY, 300, 199, { meta: { v: SCHEMA_VERSION, bytes } });
		expect(validateImageEntry(value)).toMatchObject({
			ok: false,
			code: "IMAGE_ENTRY_INVALID",
			reason: "META_BYTES_MISMATCH",
			details: { metaBytes: bytes, webpBytes: LOSSY.length },
		});
	});

	const valid = entry(LOSSY, 300, 199);
	it.each<[string, unknown, string]>([
		["null", null, "(value)"],
		["undefined", undefined, "(value)"],
		["文字列", valid.src, "(value)"],
		["配列", [valid], "(value)"],
		["src が無い", { ...valid, src: undefined }, "src"],
		["src に空白", { ...valid, src: `${valid.src.slice(0, 40)} ${valid.src.slice(41)}` }, "src"],
		["mimeType が違う", { ...valid, mimeType: "image/png" }, "mimeType"],
		["width が文字列", { ...valid, width: "300" }, "width"],
		["width が 0", { ...valid, width: 0 }, "width"],
		["height が上限(16,383)を超える", { ...valid, height: 16_384 }, "height"],
		["知らないキー(id)", { ...valid, id: "01J8Z3K4M5N6P7Q8R9S0T1V2W3" }, "(value)"],
		["meta が無い", { ...valid, meta: undefined }, "meta"],
		["meta.v が 2", { ...valid, meta: { ...valid.meta, v: 2 } }, "meta.v"],
		["meta.bytes が 0", { ...valid, meta: { ...valid.meta, bytes: 0 } }, "meta.bytes"],
		[
			"meta.quality が 1 を超える",
			{ ...valid, meta: { ...valid.meta, quality: 1.5 } },
			"meta.quality",
		],
		["filename が空", { ...valid, filename: "" }, "filename"],
		["filename が 256 文字", { ...valid, filename: "a".repeat(256) }, "filename"],
	])("%s → IMAGE_ENTRY_INVALID", (_label, value, path) => {
		const result = validateImageEntry(value);
		expect(result).toMatchObject({ ok: false, code: "IMAGE_ENTRY_INVALID", reason: "ENTRY_SHAPE" });
		if (result.ok === true) return;
		expect(result.message).toMatch(/^The image entry is invalid: /);
		expect(result.message).toContain(`${path}: `);
	});

	it("スキーマの問題は 3 件まで書き、残りは件数にする", () => {
		const result = validateImageEntry({ src: 1, mimeType: 2, width: "a", height: "b", meta: 3 });
		expect(result).toMatchObject({
			ok: false,
			code: "IMAGE_ENTRY_INVALID",
			details: { issues: 5 },
		});
		if (result.ok === true) return;
		expect(result.message).toMatch(/; and 2 more$/);
	});
});

/** T18 が作る画像エントリの値(仕様書 7 章: dataUrl をそのまま src にし、meta.bytes は WebP 本体のバイト数) */
function entryFromUpload(input: UploadRequest, webpBytes: number) {
	return {
		src: input.dataUrl,
		mimeType: WEBP_MIME_TYPE,
		width: input.width,
		height: input.height,
		meta: { v: SCHEMA_VERSION, bytes: webpBytes, quality: input.quality },
	};
}

describe("① を通った値は ② も通る", () => {
	it.each([
		...STILL_IMAGES.map(
			({ name, bytes, width, height }) => [name, uploadImage(bytes, width, height)] as const,
		),
		["保存 499,999 バイト", upload({ dataUrl: IMAGE_499999, width: 96, height: 64 })] as const,
		["長辺 4,096px", uploadImage(CHROMIUM_4096X1, 4_096, 1)] as const,
	])("%s", (_label, input) => {
		// どのフィールドの options でも受け付けうる最大の options で ① を通す
		const checked = validateWithOptions(input, { maxStoredBytes: 10_000_000, maxEdge: 99_999 });
		expect(checked).toMatchObject({ ok: true });
		if (checked.ok === false) return;
		expect(validateImageEntry(entryFromUpload(input, checked.image.webpBytes))).toMatchObject({
			ok: true,
		});
	});

	it("options をどう丸めても、① の上限は ② の上限を超えない", () => {
		for (const options of [{}, { maxStoredBytes: 1e12, maxEdge: 1e12 }, { maxEdge: -1 }]) {
			const normalized = normalizeFieldOptions(options);
			expect(normalized.maxStoredBytes).toBeLessThanOrEqual(IMAGE_ENTRY_LIMITS.maxStoredBytes);
			expect(normalized.maxEdge).toBeLessThanOrEqual(IMAGE_ENTRY_LIMITS.maxEdge);
		}
		expect(IMAGE_ENTRY_LIMITS.maxEdge).toBeLessThanOrEqual(WEBP_MAX_DIMENSION);
	});
});

// ---------------------------------------------------------------------------
// 型とコード
// ---------------------------------------------------------------------------

describe("型とエラーコード", () => {
	it("エラーコードはどれも T03 のサーバーのコードで、ルートでは 400", () => {
		for (const code of VALIDATION_ERROR_CODES) {
			expect(SERVER_ERROR_CODES).toContain(code);
			expect(ERROR_HTTP_STATUS[code]).toBe(400);
		}
	});

	it("EmDash の CollectionSchemaInfo とルートの入力(UploadRequest)をそのまま渡せる", () => {
		expectTypeOf<CollectionSchemaInfo>().toExtend<CollectionSchemaLike>();
		expectTypeOf<CollectionSchemaInfo["fields"][number]>().toExtend<FieldSchemaLike>();
		expectTypeOf<UploadRequest>().toExtend<UploadInputLike>();
		expectTypeOf<UploadRequest>().toExtend<UploadImagesInput>();
		expectTypeOf(normalizeFieldOptions({})).toExtend<ImageLimits>();
	});

	it("失敗は ok === false で絞り込める", () => {
		const result = validateUpload(upload(), null);
		expect(result.ok).toBe(false);
		if (result.ok === true) return;
		expectTypeOf(result.code).toEqualTypeOf<(typeof VALIDATION_ERROR_CODES)[number]>();
		expect(result.code).toBe("INVALID_TARGET");
	});
});
