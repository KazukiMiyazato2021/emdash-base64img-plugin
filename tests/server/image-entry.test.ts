import { readFileSync } from "node:fs";

import {
	ContentSaveRejectedError,
	isContentSaveRejection,
	type ContentHookEvent,
	type PluginContext,
	type PluginHooks,
} from "emdash";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
	MAX_DETAIL_LENGTH,
	validateImageEntryBeforeSave,
	type ImageEntryHookEvent,
} from "../../src/server/hooks/image-entry";
import { validateReferencesBeforeSave } from "../../src/server/hooks/references";
import {
	validateImageEntry,
	validateUpload,
	type ValidationFailure,
} from "../../src/server/validate";
import {
	IMAGE_COLLECTION,
	MAX_EDGE_LIMIT,
	MAX_STORED_BYTES_LIMIT,
	SCHEMA_VERSION,
	WEBP_MIME_TYPE,
	WIDGET_IDS,
} from "../../src/shared/constants";
import { toWebpDataUrl, type DataUrlErrorReason } from "../../src/shared/data-url";
import type { Base64ImageEntry, UploadRequest } from "../../src/shared/types";
import type { WebpErrorReason } from "../../src/shared/webp";

// ---------------------------------------------------------------------------
// validateImageEntry(T11)の差し替え
// ---------------------------------------------------------------------------

/**
 * `validateImageEntry` の呼び出しを数え、`result` があればその結果を返す(無ければ本物を呼ぶ)。
 * 実際の値では作れない理由(保存先の理由など)の文言と、更新では検証しないことを確かめるために使う。
 */
const stub = vi.hoisted(() => ({ result: undefined as unknown, calls: 0 }));

vi.mock("../../src/server/validate", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/server/validate")>();
	return {
		...actual,
		validateImageEntry: (value: unknown) => {
			stub.calls += 1;
			return stub.result === undefined ? actual.validateImageEntry(value) : stub.result;
		},
	};
});

afterEach(() => {
	stub.result = undefined;
	stub.calls = 0;
});

// ---------------------------------------------------------------------------
// テスト用の WebP(作り方は tests/fixtures/webp/README.md)
// ---------------------------------------------------------------------------

function fixture(name: string): Uint8Array {
	return Uint8Array.from(readFileSync(new URL(`../fixtures/webp/${name}`, import.meta.url)));
}

const LOSSY = fixture("lossy.webp"); // VP8、300 × 199、778 バイト
const LOSSLESS = fixture("lossless.webp"); // VP8L、257 × 129
const LOSSY_ALPHA = fixture("lossy-alpha.webp"); // VP8X + ALPH + VP8、261 × 173
const LOSSLESS_ALPHA = fixture("lossless-alpha.webp"); // VP8L(透過)、131 × 67
const LOSSLESS_XMP = fixture("lossless-xmp.webp"); // VP8X + VP8L + XMP、63 × 37
const ANIMATED = fixture("animated.webp"); // VP8X + ANIM + ANMF × 2、97 × 61

function ascii(text: string): Uint8Array {
	return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/**
 * 拡張形式(`VP8X`)の WebP の末尾に `XMP ` チャンク(中身は 0)を足し、`VP8X` の XMP フラグを立てて、
 * 全体を `size` バイト(偶数)にする(tests/server/validate.test.ts と同じ作り方)。
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

/** `VP8L` のヘッダー(シグネチャと寸法)だけを持つ WebP。検証はヘッダーだけを読むので、長辺の境界に使える */
function vp8lHeaderOnly(width: number, height: number): Uint8Array {
	const out = new Uint8Array(12 + 8 + 16);
	out.set(ascii("RIFF"), 0);
	out.set(ascii("WEBP"), 8);
	out.set(ascii("VP8L"), 12);
	const view = new DataView(out.buffer);
	view.setUint32(4, out.length - 8, true);
	view.setUint32(16, 16, true);
	out[20] = 0x2f;
	view.setUint32(21, ((width - 1) | ((height - 1) << 14)) >>> 0, true);
	return out;
}

/** 画像エントリの値(`b64_images` の `image`) */
function entry(
	webp: Uint8Array,
	width: number,
	height: number,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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

const VALID = entry(LOSSY, 300, 199);

// ---------------------------------------------------------------------------
// event と ctx
// ---------------------------------------------------------------------------

function create(
	content: Record<string, unknown>,
	collection = IMAGE_COLLECTION,
): ImageEntryHookEvent {
	return { collection, isNew: true, content };
}

function update(
	content: Record<string, unknown>,
	collection = IMAGE_COLLECTION,
): ImageEntryHookEvent {
	return { collection, isNew: false, content };
}

/** この hook は ctx を使わない(クエリをしない)。何かを読んだら失敗する ctx を渡す */
const UNUSED_CTX = new Proxy(
	{},
	{
		get(_, key) {
			throw new Error(`ctx.${String(key)} を読んだ`);
		},
	},
);

function run(event: ImageEntryHookEvent): Promise<void> {
	return validateImageEntryBeforeSave(event, UNUSED_CTX);
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
const JA_PREFIX = "画像エントリ(b64_images.image): ";
const EN_PREFIX = "Image entry (b64_images.image): ";

/** `message` は 2 行で、1 行目が日本語、2 行目が英語(日本語の文字が無い) */
function lines(message: string): { ja: string; en: string } {
	const [ja = "", en = "", ...rest] = message.split("\n");
	expect(rest).toEqual([]);
	expect(ja.startsWith(JA_PREFIX)).toBe(true);
	expect(en.startsWith(EN_PREFIX)).toBe(true);
	expect(ja).toMatch(JAPANESE);
	expect(en).not.toMatch(JAPANESE);
	return { ja: ja.slice(JA_PREFIX.length), en: en.slice(EN_PREFIX.length) };
}

async function rejectedLines(event: ImageEntryHookEvent): Promise<{ ja: string; en: string }> {
	return lines((await rejection(run(event))).message);
}

/** 作成の拒否の英語の行は、T11 の `message` に句点を付けたもの */
function t11Message(value: unknown): string {
	const result = validateImageEntry(value);
	if (result.ok === true) throw new Error("テストの値が T11 の検証を通ってしまう");
	return result.message;
}

// ---------------------------------------------------------------------------
// 対象
// ---------------------------------------------------------------------------

describe("validateImageEntryBeforeSave: 対象", () => {
	it.each([
		["作成", create({ image: "not an entry" }, "posts")],
		["更新", update({ image: VALID }, "posts")],
		["image の無い作成", create({ title: "x" }, "pages")],
	])("b64_images 以外のコレクションでは何もしない(%s)", async (_, event) => {
		await expect(run(event)).resolves.toBeUndefined();
		expect(stub.calls).toBe(0);
	});

	it("ctx を使わない(クエリをしない。作成・拒否・更新のどれでも)", async () => {
		await expect(run(create({ image: VALID }))).resolves.toBeUndefined();
		await rejection(run(create({ image: null })));
		await rejection(run(update({ image: VALID })));
		await expect(run(update({}))).resolves.toBeUndefined();
	});

	it("ctx を省略しても呼べる", async () => {
		await expect(validateImageEntryBeforeSave(create({ image: VALID }))).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 作成
// ---------------------------------------------------------------------------

describe("validateImageEntryBeforeSave: 作成(isNew: true)", () => {
	it.each([
		["lossy.webp(VP8)", entry(LOSSY, 300, 199)],
		["lossless.webp(VP8L)", entry(LOSSLESS, 257, 129)],
		["lossy-alpha.webp(VP8X + ALPH + VP8)", entry(LOSSY_ALPHA, 261, 173)],
		["lossless-alpha.webp(VP8L、透過)", entry(LOSSLESS_ALPHA, 131, 67)],
		["lossless-xmp.webp(VP8X + VP8L + XMP)", entry(LOSSLESS_XMP, 63, 37)],
		[
			"filename と quality なし",
			entry(LOSSY, 300, 199, {
				filename: undefined,
				meta: { v: SCHEMA_VERSION, bytes: LOSSY.length },
			}),
		],
	])("正しい値は通り、保存するデータを変えない(%s)", async (_, image) => {
		const content = { image };
		await expect(run(create(content))).resolves.toBeUndefined();
		expect(content).toEqual({ image });
		expect(stub.calls).toBe(1);
	});

	it("image のほかのフィールドは見ない", async () => {
		await expect(run(create({ image: VALID, title: 1 }))).resolves.toBeUndefined();
	});

	it("固定上限ちょうど(src 499,999 文字)は通り、超える(500,003 文字)と拒否する", async () => {
		const atLimit = entry(padWebp(LOSSY_ALPHA, 374_982), 261, 173);
		expect((atLimit["src"] as string).length).toBe(MAX_STORED_BYTES_LIMIT - 1);
		await expect(run(create({ image: atLimit }))).resolves.toBeUndefined();

		const over = entry(padWebp(LOSSY_ALPHA, 374_984), 261, 173);
		expect((over["src"] as string).length).toBe(500_003);
		const { ja, en } = await rejectedLines(create({ image: over }));
		expect(ja).toBe("src の長さが 500,003 バイトで、上限の 500,000 バイトを超えています。");
		expect(en).toBe("src is 500003 bytes, which exceeds the limit of 500000 bytes.");
	});

	it("長辺は固定上限(4,096px)まで通り、超えると拒否する", async () => {
		const at = vp8lHeaderOnly(MAX_EDGE_LIMIT, 1);
		await expect(run(create({ image: entry(at, MAX_EDGE_LIMIT, 1) }))).resolves.toBeUndefined();

		const over = vp8lHeaderOnly(MAX_EDGE_LIMIT + 1, 1);
		const { ja, en } = await rejectedLines(create({ image: entry(over, MAX_EDGE_LIMIT + 1, 1) }));
		expect(ja).toBe("src の長辺(4,097px)が、上限の 4,096px を超えています。");
		expect(en).toBe("The longest edge of src (4097px) exceeds the limit of 4096px.");
	});

	it("アップロードのルート(T18)が作る値は通る(① を通った値)", async () => {
		const input: UploadRequest = {
			dataUrl: toWebpDataUrl(padWebp(LOSSY_ALPHA, 374_982)),
			thumb: toWebpDataUrl(LOSSLESS_XMP),
			width: 261,
			height: 173,
			quality: 0.6,
			filename: "a".repeat(255),
			target: { collection: "posts", field: "cover" },
		};
		const checked = validateUpload(input, {
			slug: "posts",
			fields: [
				{
					slug: "cover",
					type: "json",
					widget: WIDGET_IDS.image,
					options: { maxStoredBytes: MAX_STORED_BYTES_LIMIT, maxEdge: MAX_EDGE_LIMIT },
				},
			],
		});
		if (checked.ok === false) throw new Error(checked.message);
		const image: Base64ImageEntry = {
			src: input.dataUrl,
			mimeType: WEBP_MIME_TYPE,
			width: input.width,
			height: input.height,
			...(input.filename === undefined ? {} : { filename: input.filename }),
			meta: { v: SCHEMA_VERSION, bytes: checked.image.webpBytes, quality: input.quality },
		};
		await expect(run(create({ image }))).resolves.toBeUndefined();
	});

	it.each<[string, Record<string, unknown>]>([
		["image が無い", {}],
		["undefined", { image: undefined }],
		["null", { image: null }],
		["文字列", { image: "data:image/webp;base64,UklGR" }],
		["数値", { image: 1 }],
		["配列", { image: [VALID] }],
	])("値が画像エントリのオブジェクトでなければ拒否する(%s)", async (_, content) => {
		const { ja, en } = await rejectedLines(create(content));
		expect(ja).toBe("値が画像エントリのオブジェクトではありません。");
		expect(en).toBe(`${t11Message(content["image"])}.`);
	});

	it.each([
		["meta が無い", { ...VALID, meta: undefined }, "meta"],
		["知らないキー", { ...VALID, id: "01ABC", alt: "x" }, "id, alt"],
		["mimeType と width", { ...VALID, mimeType: "image/png", width: 0 }, "mimeType, width"],
		["meta.v", { ...VALID, meta: { v: 2, bytes: LOSSY.length } }, "meta.v"],
		["meta の知らないキー", { ...VALID, meta: { v: 1, bytes: LOSSY.length, q: 1 } }, "meta.q"],
		["filename が空", { ...VALID, filename: "" }, "filename"],
	])("値の形が合わなければ、問題のキーを並べて拒否する(%s)", async (_, image, keys) => {
		const { ja, en } = await rejectedLines(create({ image }));
		expect(ja).toBe(`値の形が正しくありません(キー: ${keys})。`);
		expect(en).toBe(`${t11Message(image)}.`);
	});

	it("meta.bytes が WebP 本体のバイト数と違えば拒否する", async () => {
		const { ja, en } = await rejectedLines(
			create({ image: { ...VALID, meta: { v: 1, bytes: 777 } } }),
		);
		expect(ja).toBe("meta.bytes(777)が、src の WebP 本体のバイト数(778)と一致しません。");
		expect(en).toBe("meta.bytes (777) does not match the size of the WebP in src (778 bytes).");
	});

	it("width / height が WebP の寸法と違えば拒否する", async () => {
		const { ja, en } = await rejectedLines(
			create({ image: { ...VALID, width: 199, height: 300 } }),
		);
		expect(ja).toBe("width × height(199 × 300)が、src の WebP の寸法(300 × 199)と一致しません。");
		expect(en).toBe("width x height (199x300) does not match the WebP in src (300x199).");
	});

	it("アニメーションの WebP は拒否する", async () => {
		const { ja, en } = await rejectedLines(create({ image: entry(ANIMATED, 97, 61) }));
		expect(ja).toBe("src がアニメーションの WebP です。静止画だけを保存できます。");
		expect(en).toBe("src is an animated WebP; only still images are accepted.");
	});

	it.each([
		[
			"PNG の data URL",
			"data:image/png;base64,iVBORw0KGgo=",
			"src が「data:image/webp;base64,」で始まっていません(NOT_WEBP_DATA_URL)。",
		],
		[
			"base64 でない",
			"data:image/webp;base64,@@@@",
			"src の「data:image/webp;base64,」のあとが、正しい base64 ではありません(INVALID_BASE64)。",
		],
		[
			"RIFF / WEBP でない",
			toWebpDataUrl(
				Uint8Array.from([...ascii("RIFF"), 12, 0, 0, 0, ...ascii("WAVEfmt "), 0, 0, 0, 0]),
			),
			"src に RIFF / WEBP のシグネチャがありません(NOT_WEBP)。",
		],
	])(
		"src が静止画の WebP の data URL でなければ、理由を添えて拒否する(%s)",
		async (_, src, expected) => {
			const image = { ...VALID, src };
			const { ja, en } = await rejectedLines(create({ image }));
			expect(ja).toBe(expected);
			expect(en).toBe(`${t11Message(image)}.`);
		},
	);
});

// ---------------------------------------------------------------------------
// 更新
// ---------------------------------------------------------------------------

describe("validateImageEntryBeforeSave: 更新(isNew: false)", () => {
	it.each([
		["同じ値", VALID],
		["別の正しい値", entry(LOSSLESS, 257, 129)],
		["不正な値", { ...VALID, width: 1 }],
		["null", null],
		["空のオブジェクト", {}],
		["空文字", ""],
	])("image が送られてきたら、値によらず拒否し、中身は検証しない(%s)", async (_, image) => {
		const { ja, en } = await rejectedLines(update({ image }));
		expect(ja).toBe(
			"作成したあとは変更できません。別の画像にするときは、新しい画像をアップロードしてください。",
		);
		expect(en).toBe(
			"it cannot be changed after it is created. To use a different image, upload a new one.",
		);
		expect(stub.calls).toBe(0);
	});

	it.each([
		["data が空", {}],
		["image のほかのフィールドだけ", { title: "renamed" }],
		["image が undefined(JSON では送られないのと同じ)", { image: undefined }],
	])("image が送られてこなければ何もしない(%s)", async (_, content) => {
		await expect(run(update(content))).resolves.toBeUndefined();
		expect(stub.calls).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// message
// ---------------------------------------------------------------------------

/** T04 の理由(`src` が静止画の WebP の data URL でない)。型で網羅を確かめる */
const T04_REASONS = [
	"NOT_WEBP_DATA_URL",
	"INVALID_BASE64",
	"TOO_SHORT",
	"NOT_WEBP",
	"RIFF_SIZE_MISMATCH",
	"MALFORMED_CHUNK",
	"UNSUPPORTED_FORMAT",
	"INVALID_VP8_HEADER",
	"INVALID_VP8L_HEADER",
	"INVALID_VP8X_HEADER",
	"MISSING_IMAGE_DATA",
	"CANVAS_SIZE_MISMATCH",
] as const satisfies readonly (DataUrlErrorReason | WebpErrorReason)[];

function failure(overrides: Partial<ValidationFailure>): ValidationFailure {
	return {
		ok: false,
		code: "IMAGE_DATA_INVALID",
		reason: "NOT_WEBP",
		message: "src does not have the RIFF/WEBP signature (NOT_WEBP)",
		details: {},
		...overrides,
	};
}

describe("validateImageEntryBeforeSave: message", () => {
	it("T04 の理由の一覧は、型の理由をすべて含む", () => {
		expectTypeOf<
			Exclude<DataUrlErrorReason | WebpErrorReason, (typeof T04_REASONS)[number]>
		>().toBeNever();
	});

	it.each(T04_REASONS)("T04 の理由 %s は、日本語の文に理由を添える", async (reason) => {
		stub.result = failure({ reason, message: `src is broken (${reason})` });
		const { ja, en } = await rejectedLines(create({ image: VALID }));
		expect(ja).toMatch(new RegExp(`^src .+\\(${reason}\\)。$`, "u"));
		expect(ja).not.toContain("値が正しくありません");
		expect(en).toBe(`src is broken (${reason}).`);
	});

	it("T04 の理由ごとの日本語の文は、互いに違う", async () => {
		// hook は最初の await より前に validateImageEntry を呼ぶので、呼ぶ直前に差し替えた結果が使われる
		const pending = T04_REASONS.map((reason) => {
			stub.result = failure({ reason });
			return rejectedLines(create({ image: VALID })).then(({ ja }) =>
				ja.replace(`(${reason})`, ""),
			);
		});
		const texts = new Set(await Promise.all(pending));
		expect(texts.size).toBe(T04_REASONS.length);
	});

	it("画像エントリの検証では出ない理由(保存先の理由)は、理由だけを書く", async () => {
		stub.result = failure({
			code: "INVALID_TARGET",
			reason: "FIELD_NOT_FOUND",
			message: 'Field "posts.cover" does not exist',
		});
		const { ja, en } = await rejectedLines(create({ image: VALID }));
		expect(ja).toBe("値が正しくありません(FIELD_NOT_FOUND)。");
		expect(en).toBe('Field "posts.cover" does not exist.');
	});

	it("details に数値が無ければ「?」、文字列ならそのまま書く", async () => {
		stub.result = failure({
			code: "IMAGE_TOO_LARGE",
			reason: "STORED_BYTES_OVER_LIMIT",
			message: "src is too large",
			details: { maxStoredBytes: "500000" },
		});
		const { ja } = await rejectedLines(create({ image: VALID }));
		expect(ja).toBe("src の長さが ? バイトで、上限の 500000 バイトを超えています。");
	});

	it("英語の行は、T11 の message が句点か「…」で終わっていれば、句点を足さない", async () => {
		stub.result = failure({ message: "already a sentence." });
		expect((await rejectedLines(create({ image: VALID }))).en).toBe("already a sentence.");
	});

	it("長大な知らないキーが大量にあっても、日本語はキー 5 つ・1 つ 40 文字まで、英語は T11 の message の先頭だけにする", async () => {
		const keys = Array.from({ length: 1000 }, (_, i) => `k${i}_${"x".repeat(200)}`);
		const image = { ...VALID, ...Object.fromEntries(keys.map((key) => [key, 1])) };
		const message = (await rejection(run(create({ image })))).message;
		const { ja, en } = lines(message);
		const shown = keys.slice(0, 5).map((key) => `${key.slice(0, 40)}…`);
		expect(ja).toBe(`値の形が正しくありません(キー: ${shown.join(", ")}, …)。`);
		expect(en).toBe(`${t11Message(image).slice(0, MAX_DETAIL_LENGTH)}…`);
		expect(message.length).toBeLessThan(700);
	});
});

// ---------------------------------------------------------------------------
// 投げるエラーと型
// ---------------------------------------------------------------------------

describe("validateImageEntryBeforeSave: 投げるエラー", () => {
	it.each([
		["作成", create({ image: null })],
		["更新", update({ image: VALID })],
	])(
		"拒否は ContentSaveRejectedError で投げる(EmDash が 422 SAVE_REJECTED と message を返す。%s)",
		async (_, event) => {
			const error = await rejection(run(event));
			expect(isContentSaveRejection(error)).toBe(true);
		},
	);
});

/** T29 の登録のしかた: content:beforeSave は 1 つのプラグインに 1 つなので、T19 と T16 を振り分ける */
async function t29BeforeSave(event: ContentHookEvent, ctx: PluginContext): Promise<void> {
	if (event.collection === IMAGE_COLLECTION) return validateImageEntryBeforeSave(event, ctx);
	return validateReferencesBeforeSave(event, ctx);
}

describe("型", () => {
	it("EmDash の content:beforeSave の handler としてそのまま登録できる", () => {
		expectTypeOf(validateImageEntryBeforeSave).toExtend<
			(event: ContentHookEvent, ctx: PluginContext) => Promise<Record<string, unknown> | void>
		>();
		expectTypeOf({ handler: validateImageEntryBeforeSave }).toExtend<
			NonNullable<PluginHooks["content:beforeSave"]>
		>();
	});

	it("T29 の 1 つの handler で、T16 の hook と振り分けて登録できる", () => {
		expectTypeOf({ handler: t29BeforeSave }).toExtend<
			NonNullable<PluginHooks["content:beforeSave"]>
		>();
	});
});
