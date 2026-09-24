// アップロード処理のフック(src/admin/hooks/)のテスト。
// - デコードは、createDecodeImage に偽の createImageBitmap を渡す。File は、ヘッダーだけの本物のバイト列で作る
//   (形式と画素数の判定は本物のまま動く。T12)。
// - 圧縮とサムネイルは、本物の compressImage / createThumbnail に偽のエンコーダーを渡す(T13)。
// - 通信は本物の uploadImage / fetchPreviews を使い、fetch を vi.stubGlobal で差し替える(T14)。
// - フックは Testing Library の renderHook で動かす。非同期の状態の変化は waitFor で待ち、
//   最後まで進める操作は act の中で行う(act の外で状態が変わると、React が console.error で警告する。
//   afterEach で console.error を見張り、テストを失敗にする)。
// - StrictMode は `reactStrictMode: true` で掛ける(`wrapper` で包むと、初回のマウントで effect が 2 回動かない。
//   docs/react-hook-testing-pitfalls.md)。

import { act, renderHook, waitFor } from "@testing-library/react";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type Mock,
	type MockInstance,
} from "vitest";

import {
	PAINT_TIMEOUT_MS,
	buildUploadRequest,
	isUploadPhase,
	processImageFile,
	readRouterSearchString,
	resolveUploadTarget,
	toUploadFilename,
	useImageUpload,
	usePreviewImages,
	useUploadQueue,
	useUploadTarget,
	waitForPaint,
	type ImageUpload,
	type UploadDependencies,
	type UploadedImage,
	type UploadOutcome,
	type UploadPhase,
	type UploadQueue,
	type UploadTargetResolution,
	type UseImageUploadOptions,
	type UseUploadQueueOptions,
} from "../../src/admin/hooks";
import { createDecodeImage } from "../../src/client/input";
import { MAX_FILENAME_LENGTH, PREVIEW_MAX_IDS } from "../../src/shared/constants";
import { decodeWebpDataUrl } from "../../src/shared/data-url";
import { isBase64ImageError } from "../../src/shared/errors";
import { normalizeFieldOptions } from "../../src/shared/options";
import type {
	CompressImage,
	CompressionResult,
	DecodeImage,
	WebpEncoder,
} from "../../src/shared/pipeline";
import type { Base64ImageEntry, UploadRequest, UploadTarget } from "../../src/shared/types";

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

const ENTRY_ID = "01J8Z3K4M5N6P7Q8R9S0T1V2W4";
const IMAGE_ID = "01J8Z3K4M5N6P7Q8R9S0T1V2W3";
const PLUGIN_API = "/_emdash/api/plugins/base64-image";
const EDIT_PATH = `/_emdash/admin/content/posts/${ENTRY_ID}`;
const TARGET: UploadTarget = {
	collection: "posts",
	field: "cover",
	entryId: ENTRY_ID,
	locale: "ja",
};
const RESOLVED: UploadTargetResolution = { ok: true, target: TARGET };
const DEFAULT_OPTIONS = normalizeFieldOptions(undefined);

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
	consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	window.history.replaceState(null, "", "/");
	// act の外での状態の変化などの警告が出ていないこと(投げると、そのテストが失敗する)
	const warnings = consoleError.mock.calls.map((args) => args.map(String).join(" "));
	consoleError.mockRestore();
	if (warnings.length > 0) throw new Error(`console.error was called:\n${warnings.join("\n")}`);
});

function deferred<T = void>(): PromiseWithResolvers<T> {
	return Promise.withResolvers<T>();
}

/** マイクロタスクとタイマー 1 回分を進める */
function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

function codeOf(error: unknown): string | undefined {
	return isBase64ImageError(error) ? error.code : undefined;
}

// ---------------------------------------------------------------------------
// 入力ファイル(ヘッダーだけの本物のバイト列)
// ---------------------------------------------------------------------------

const u32be = (value: number): number[] => [
	(value >>> 24) & 0xff,
	(value >>> 16) & 0xff,
	(value >>> 8) & 0xff,
	value & 0xff,
];
const u16le = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

/** シグネチャと IHDR・IEND だけの PNG */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** ビット深度 8、RGBA、圧縮・フィルター・インターレースは 0 */
const PNG_IHDR_TAIL = [8, 6, 0, 0, 0];

function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
	return Uint8Array.from([
		...PNG_SIGNATURE,
		...u32be(13),
		...ascii("IHDR"),
		...u32be(width),
		...u32be(height),
		...PNG_IHDR_TAIL,
		...u32be(0),
		...u32be(0),
		...ascii("IEND"),
		...u32be(0),
	]);
}

/** 論理画面だけの GIF(フレームが無いので、寸法は論理画面のもの) */
function gifBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
	return Uint8Array.from([...ascii("GIF89a"), ...u16le(width), ...u16le(height), 0, 0, 0, 0x3b]);
}

/** iPhone の HEIC と同じ ftyp(major brand `heic`、compatible brands `mif1` `heic`) */
function heicBytes(): Uint8Array<ArrayBuffer> {
	return Uint8Array.from([
		...u32be(24),
		...ascii("ftyp"),
		...ascii("heic"),
		...u32be(0),
		...ascii("mif1"),
		...ascii("heic"),
	]);
}

/** 偽の createImageBitmap が返す寸法 */
const decodedSizes = new WeakMap<Blob, { readonly width: number; readonly height: number }>();

function pngFile(name = "photo.png", width = 4000, height = 3000): File {
	const file = new File([pngBytes(width, height)], name, { type: "image/png" });
	decodedSizes.set(file, { width, height });
	return file;
}

function gifFile(name = "anim.gif", width = 120, height = 80): File {
	const file = new File([gifBytes(width, height)], name, { type: "image/gif" });
	decodedSizes.set(file, { width, height });
	return file;
}

function heicFile(name = "IMG_0001.HEIC"): File {
	return new File([heicBytes()], name, { type: "image/heic" });
}

// ---------------------------------------------------------------------------
// 偽の createImageBitmap とエンコーダー
// ---------------------------------------------------------------------------

interface FakeBitmap {
	width: number;
	height: number;
	readonly close: Mock<() => void>;
}

interface FakeDecoding {
	readonly decodeImage: DecodeImage;
	/** 作った ImageBitmap(作った順) */
	readonly bitmaps: FakeBitmap[];
	/** デコードを始めたファイルの名前(始めた順) */
	readonly started: string[];
}

/** createDecodeImage に偽の createImageBitmap を渡したもの。`gate` を渡すと、デコードの完了をそこで待たせる */
function fakeDecoding(gate?: (file: File) => Promise<void>): FakeDecoding {
	const bitmaps: FakeBitmap[] = [];
	const started: string[] = [];
	const decodeImage = createDecodeImage({
		createImageBitmap: async (image) => {
			const file = image as File;
			started.push(file.name);
			await gate?.(file);
			const size = decodedSizes.get(file) ?? { width: 8, height: 6 };
			const bitmap: FakeBitmap = {
				...size,
				close: vi.fn<() => void>(() => {
					bitmap.width = 0;
					bitmap.height = 0;
				}),
			};
			bitmaps.push(bitmap);
			return bitmap as unknown as ImageBitmap;
		},
	});
	return { decodeImage, bitmaps, started };
}

interface EncodeCall {
	readonly width: number;
	readonly height: number;
	readonly quality: number;
}

interface FakeEncoding {
	readonly encoder: WebpEncoder;
	readonly calls: EncodeCall[];
}

/**
 * 偽のエンコーダー。画質が `fitQuality` 以下なら長辺と同じバイト数(予算に収まる)、超えると 80,000 バイト
 * (本体の 74,982 バイトとサムネイルの 5,982 バイトのどちらも超える)の Blob を返す。
 * 既定の options(長辺 1600px、画質 0.60〜0.92)では、本体は 1600px・画質 0.77、サムネイルは 96px・0.77 になる。
 */
function fakeEncoder(
	fitQuality = 0.77,
	before?: (call: EncodeCall) => void | Promise<void>,
): FakeEncoding {
	const calls: EncodeCall[] = [];
	const encoder: WebpEncoder = async ({ width, height, quality }) => {
		const call = { width, height, quality };
		calls.push(call);
		await before?.(call);
		const size = quality <= fitQuality + 1e-9 ? Math.max(width, height) : 80_000;
		return new Blob([new Uint8Array(size)], { type: "image/webp" });
	};
	return { encoder, calls };
}

/** 長辺 96px 以下は、どの画質でもサムネイルの予算(5,982 バイト)を超える Blob を返すエンコーダー */
const oversizedThumbnailEncoder: WebpEncoder = async ({ width, height }) =>
	new Blob([new Uint8Array(Math.max(width, height) <= 96 ? 6_000 : 1_000)], {
		type: "image/webp",
	});

interface TestPipeline {
	readonly dependencies: UploadDependencies;
	readonly decoding: FakeDecoding;
	readonly encoding: FakeEncoding;
}

/** 偽のデコードとエンコーダー。描画は待たない */
function testPipeline(
	options: {
		readonly decoding?: FakeDecoding;
		readonly encoding?: FakeEncoding;
		readonly overrides?: UploadDependencies;
	} = {},
): TestPipeline {
	const decoding = options.decoding ?? fakeDecoding();
	const encoding = options.encoding ?? fakeEncoder();
	return {
		decoding,
		encoding,
		dependencies: {
			decodeImage: decoding.decodeImage,
			encoder: encoding.encoder,
			waitForPaint: () => Promise.resolve(),
			...options.overrides,
		},
	};
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

interface FetchCall {
	readonly url: string;
	readonly init: RequestInit;
	readonly body: unknown;
}

function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
	const calls: FetchCall[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
			const call: FetchCall = {
				url: String(input),
				init,
				body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
			};
			calls.push(call);
			return handler(call);
		}),
	);
	return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function success(data: unknown): Response {
	return jsonResponse({ success: true, data });
}

function routeError(code: string, status: number): Response {
	return jsonResponse({ success: false, error: { code, message: "failed" } }, status);
}

/** アップロード用ルートの成功の応答。寸法は要求のまま、`alt` は空 */
function uploaded(call: FetchCall): Response {
	const request = call.body as UploadRequest;
	return success({
		ref: {
			v: 1,
			id: IMAGE_ID,
			locale: "en",
			width: request.width,
			height: request.height,
			alt: "",
		},
	});
}

/** 中断されるまで応答しない(中断されたら、本物の fetch と同じく signal.reason で reject する) */
function hangUntilAborted(call: FetchCall): Promise<Response> {
	return new Promise((_resolve, reject) => {
		const { signal } = call.init;
		signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}

interface Gate {
	readonly call: FetchCall;
	readonly resolve: (response: Response) => void;
}

/** 外から応答を返すまで待つ fetch。中断されたら signal.reason で reject する */
function gatedFetch(): { readonly gates: Gate[]; readonly calls: FetchCall[] } {
	const gates: Gate[] = [];
	const calls = stubFetch(
		(call) =>
			new Promise<Response>((resolve, reject) => {
				const { signal } = call.init;
				signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
				gates.push({ call, resolve });
			}),
	);
	return { gates, calls };
}

function uploadBody(call: FetchCall | undefined): UploadRequest {
	if (call === undefined) throw new Error("the request was not sent");
	return call.body as UploadRequest;
}

function webpBytesOf(dataUrl: string): number {
	const decoded = decodeWebpDataUrl(dataUrl);
	if (decoded.ok === false) throw new Error(`not a WebP data URL: ${decoded.reason}`);
	return decoded.bytes.length;
}

// ---------------------------------------------------------------------------
// 保存先(URL と widget の id)
// ---------------------------------------------------------------------------

function at(path: string): { pathname: string; search: string } {
	const url = new URL(path, "http://localhost");
	return { pathname: url.pathname, search: url.search };
}

describe("resolveUploadTarget", () => {
	it("既存のエントリの編集画面では、collection・entryId・locale を URL から、field を id から求める", () => {
		expect(resolveUploadTarget("field-cover", at(`${EDIT_PATH}?locale=ja`))).toStrictEqual({
			ok: true,
			target: { collection: "posts", field: "cover", entryId: ENTRY_ID, locale: "ja" },
		});
	});

	it("新規作成の画面(/new)では、entryId も locale も入れない", () => {
		expect(
			resolveUploadTarget("field-cover", at("/_emdash/admin/content/posts/new?locale=ja")),
		).toStrictEqual({ ok: true, target: { collection: "posts", field: "cover" } });
		expect(
			resolveUploadTarget("field-cover", at("/_emdash/admin/content/posts/new")),
		).toStrictEqual({ ok: true, target: { collection: "posts", field: "cover" } });
	});

	it("?locale= が無ければ、entryId も入れない(ダッシュボードやサイトのツールバーから開いたとき)", () => {
		expect(resolveUploadTarget("field-cover", at(EDIT_PATH))).toStrictEqual({
			ok: true,
			target: { collection: "posts", field: "cover" },
		});
	});

	it("翻訳の編集画面では、翻訳のエントリ ID とロケールになる", () => {
		const translationId = "01J8Z3K4M5N6P7Q8R9S0T1V2W5";
		expect(
			resolveUploadTarget(
				"field-gallery",
				at(`/_emdash/admin/content/pages/${translationId}?locale=en-US&field=gallery`),
			),
		).toStrictEqual({
			ok: true,
			target: { collection: "pages", field: "gallery", entryId: translationId, locale: "en-US" },
		});
	});

	it("パスの各部分のパーセントエンコードを戻し、末尾の / を許す", () => {
		expect(
			resolveUploadTarget(
				"field-cover",
				at(`/_emdash/admin/content/p%6Fsts/${ENTRY_ID}/?locale=ja`),
			),
		).toStrictEqual(RESOLVED);
	});

	it.each([
		["日本語の slug", "%E3%81%82"],
		["ドットを含む", "my.post"],
		["壊れたパーセントエンコード", "%E3%81"],
		["129 文字", "a".repeat(129)],
	])(
		"2 つ目がエントリ ID の形でなければ(%s)、entryId も locale も入れずに求める",
		(_label, segment) => {
			expect(
				resolveUploadTarget("field-cover", at(`/_emdash/admin/content/posts/${segment}?locale=ja`)),
			).toStrictEqual({ ok: true, target: { collection: "posts", field: "cover" } });
		},
	);

	it("エントリ ID の形の slug は entryId として入る(管理画面の中の移動は ID を使う。サーバーが確かめる)", () => {
		expect(
			resolveUploadTarget(
				"field-cover",
				at("/_emdash/admin/content/posts/my-first-post?locale=ja"),
			),
		).toStrictEqual({
			ok: true,
			target: { collection: "posts", field: "cover", entryId: "my-first-post", locale: "ja" },
		});
	});

	// 35 文字(ルートが i18n の無いサイトで受け付ける長さ)と 36 文字。どちらも localeSchema には合う
	const LOCALE_35 = "en-abcdefgh-abcdefgh-abcdefgh-abcde";
	const LOCALE_36 = `${LOCALE_35}f`;

	it.each([
		["ja", "ja"],
		["JA", "JA"],
		["en-US", "en-US"],
		["zh-Hant-TW", "zh-Hant-TW"],
		[LOCALE_35, LOCALE_35],
		[LOCALE_36, undefined],
		["ja_JP", undefined],
		["j", undefined],
		["", undefined],
	])("?locale=%s は、送れる値のときだけ entryId と組にして入れる", (value, expected) => {
		const resolution = resolveUploadTarget(
			"field-cover",
			at(`${EDIT_PATH}?locale=${encodeURIComponent(value)}`),
		);
		expect(resolution).toStrictEqual({
			ok: true,
			target:
				expected === undefined
					? { collection: "posts", field: "cover" }
					: { collection: "posts", field: "cover", entryId: ENTRY_ID, locale: expected },
		});
	});

	it.each(["cover", "field-", "field-Cover", "field-1cover", "field-cover-image", "Field-cover"])(
		"widget の id が field-<slug> でなければ invalid-field-id(%s)",
		(fieldId) => {
			const resolution = resolveUploadTarget(fieldId, at(EDIT_PATH));
			expect(resolution).toMatchObject({ ok: false, problem: "invalid-field-id" });
		},
	);

	it.each([
		"/_emdash/admin",
		"/_emdash/admin/",
		"/_emdash/admin/content/posts",
		"/_emdash/admin/content/posts/new/extra",
		"/_emdash/admin/plugins/base64-image/images",
		"/_emdash/admin/content-types/posts/new",
		"/blog/_emdash/admin/content/posts/new",
		"/_emdash/admin/content/Posts/new",
		"/_emdash/admin/content/%E6%8A%95%E7%A8%BF/new",
		"/_emdash/admin/content/%ZZ/new",
		"",
	])("コンテンツの新規作成・編集の画面でなければ not-content-editor(%s)", (path) => {
		const resolution = resolveUploadTarget("field-cover", { pathname: path, search: "" });
		expect(resolution).toMatchObject({ ok: false, problem: "not-content-editor" });
	});
});

describe("readRouterSearchString(管理画面のルーターと同じ読み方)", () => {
	it.each([
		["?locale=ja", "ja"],
		["locale=ja", "ja"],
		["?field=title&locale=ja", "ja"],
		["?locale=en-US", "en-US"],
		// TanStack Router は JSON として読めれば JSON.parse する
		["?locale=%22ja%22", "ja"],
		["?locale=%5B%22ja%22%5D", undefined],
		["?locale=null", undefined],
		// true / false と数値の形の文字列は、文字列にならない
		["?locale=true", undefined],
		["?locale=false", undefined],
		["?locale=1", undefined],
		["?locale=1e3", undefined],
		["?locale=%2012", undefined],
		// JSON の数値でない形は、文字列のまま
		["?locale=0x10", "0x10"],
		["?locale=NaN", "NaN"],
		["?locale=Infinity", "Infinity"],
		["?locale=", ""],
		// 同じ名前が 2 つあると配列になり、管理画面は使わない
		["?locale=ja&locale=en", undefined],
		["", undefined],
	])("%s → %s", (search, expected) => {
		expect(readRouterSearchString(search, "locale")).toBe(expected);
	});
});

describe("useUploadTarget", () => {
	it("今の URL と id から求める", () => {
		window.history.pushState(null, "", `${EDIT_PATH}?locale=ja`);
		const { result } = renderHook(() => useUploadTarget("field-cover"));
		expect(result.current).toStrictEqual(RESOLVED);
	});

	it("描画し直すと、変わった URL を読む(新規作成を保存すると編集画面に移る)", () => {
		window.history.pushState(null, "", "/_emdash/admin/content/posts/new?locale=ja");
		const { result, rerender } = renderHook(() => useUploadTarget("field-cover"));
		expect(result.current).toStrictEqual({
			ok: true,
			target: { collection: "posts", field: "cover" },
		});
		window.history.pushState(null, "", `${EDIT_PATH}?locale=ja`);
		rerender();
		expect(result.current).toStrictEqual(RESOLVED);
	});

	it("戻る・進む(popstate)では、描画を待たずに読み直す", () => {
		window.history.pushState(null, "", `${EDIT_PATH}?locale=ja`);
		const { result } = renderHook(() => useUploadTarget("field-cover"));
		window.history.pushState(null, "", "/_emdash/admin/content/posts");
		act(() => {
			window.dispatchEvent(new PopStateEvent("popstate"));
		});
		expect(result.current).toMatchObject({ ok: false, problem: "not-content-editor" });
	});

	it("URL と id が変わらなければ同じ値を返し、id が変われば求め直す", () => {
		window.history.pushState(null, "", `${EDIT_PATH}?locale=ja`);
		const { result, rerender } = renderHook(({ id }) => useUploadTarget(id), {
			initialProps: { id: "field-cover" },
		});
		const first = result.current;
		rerender({ id: "field-cover" });
		expect(result.current).toBe(first);
		rerender({ id: "field-gallery" });
		expect(result.current).toStrictEqual({ ok: true, target: { ...TARGET, field: "gallery" } });
	});
});

// ---------------------------------------------------------------------------
// 1 枚の処理(React に依存しない部分)
// ---------------------------------------------------------------------------

function process(
	file: File,
	pipeline: TestPipeline,
	options: {
		readonly signal?: AbortSignal;
		readonly fieldOptions?: ReturnType<typeof normalizeFieldOptions>;
		readonly phases?: UploadPhase[];
	} = {},
): Promise<UploadedImage> {
	return processImageFile(file, {
		target: TARGET,
		fieldOptions: options.fieldOptions ?? DEFAULT_OPTIONS,
		signal: options.signal ?? new AbortController().signal,
		onPhase: (phase) => options.phases?.push(phase),
		dependencies: pipeline.dependencies,
	});
}

describe("processImageFile", () => {
	it("デコード・圧縮・サムネイルのあと、アップロード用ルートに 1 回送り、参照と画像エントリを返す", async () => {
		const calls = stubFetch(uploaded);
		const pipeline = testPipeline();

		const image = await process(pngFile("IMG_0001.png"), pipeline);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(`${PLUGIN_API}/upload`);
		expect(calls[0]?.init.method).toBe("POST");
		const body = uploadBody(calls[0]);
		expect(body).toStrictEqual({
			dataUrl: expect.stringMatching(/^data:image\/webp;base64,/),
			thumb: expect.stringMatching(/^data:image\/webp;base64,/),
			width: 1600,
			height: 1200,
			quality: 0.77,
			filename: "IMG_0001.png",
			target: TARGET,
		});
		// 本体は長辺 1600px、サムネイルは 96px で収まった Blob(偽のエンコーダーは長辺と同じバイト数)
		expect(webpBytesOf(body.dataUrl)).toBe(1600);
		expect(webpBytesOf(body.thumb)).toBe(96);
		expect(image).toStrictEqual({
			ref: { v: 1, id: IMAGE_ID, locale: "en", width: 1600, height: 1200, alt: "" },
			entry: {
				src: body.dataUrl,
				mimeType: "image/webp",
				width: 1600,
				height: 1200,
				filename: "IMG_0001.png",
				meta: { v: 1, bytes: 1600, quality: 0.77 },
			},
			notices: [],
		});
	});

	it("段階を順に知らせる(デコード → 圧縮とその途中経過 → サムネイル → 送信)", async () => {
		stubFetch(uploaded);
		const phases: UploadPhase[] = [];
		const inner = fakeEncoder();
		// サムネイルのエンコード(長辺 96px)を始めた時点で、知らされていた段階
		const beforeThumbnail: string[] = [];
		const encoder: WebpEncoder = async (request) => {
			if (Math.max(request.width, request.height) <= 96 && beforeThumbnail.length === 0) {
				beforeThumbnail.push(...phases.map((phase) => phase.status));
			}
			return inner.encoder(request);
		};
		const pipeline = testPipeline({ encoding: { encoder, calls: inner.calls } });

		await process(pngFile(), pipeline, { phases });

		const compressing = Array.from({ length: 8 }, () => "compressing");
		expect(phases.map((phase) => phase.status)).toStrictEqual([
			"decoding",
			...compressing,
			"thumbnail",
			"uploading",
		]);
		expect(beforeThumbnail).toStrictEqual(["decoding", ...compressing, "thumbnail"]);
		expect(phases[1]).toStrictEqual({ status: "compressing", notices: [], progress: null });
		expect(phases[2]).toStrictEqual({
			status: "compressing",
			notices: [],
			progress: { width: 1600, height: 1200, quality: 0.6, attempt: 1 },
		});
		expect(phases[8]).toMatchObject({ progress: { quality: 0.77, attempt: 7 } });
		const compressed = { width: 1600, height: 1200, quality: 0.77, storedBytes: 23 + 4 * 534 };
		expect(phases[9]).toStrictEqual({ status: "thumbnail", notices: [], compressed });
		expect(phases[10]).toStrictEqual({ status: "uploading", notices: [], compressed });
	});

	it.each([
		["decoding", true],
		["compressing", true],
		["thumbnail", true],
		["uploading", true],
		["idle", false],
		["queued", false],
		["done", false],
		["error", false],
		["cancelled", false],
	])("isUploadPhase({ status: %s }) → %s", (status, expected) => {
		expect(isUploadPhase({ status })).toBe(expected);
	});

	it("デコードした画像は、送信を待たずに(送る前に)1 回だけ閉じる", async () => {
		const pipeline = testPipeline();
		const closedBeforeUpload: boolean[] = [];
		stubFetch((call) => {
			closedBeforeUpload.push(pipeline.decoding.bitmaps[0]?.close.mock.calls.length === 1);
			return uploaded(call);
		});

		await process(pngFile(), pipeline);

		expect(closedBeforeUpload).toStrictEqual([true]);
		expect(pipeline.decoding.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
	});

	it("描画を待ってから、デコードを始める(Firefox はデコードの間、画面を止める)", async () => {
		stubFetch(uploaded);
		const paint = deferred();
		const pipeline = testPipeline({ overrides: { waitForPaint: () => paint.promise } });
		const phases: UploadPhase[] = [];

		const processing = process(pngFile(), pipeline, { phases });
		await tick();
		expect(phases.map((phase) => phase.status)).toStrictEqual(["decoding"]);
		expect(pipeline.decoding.started).toStrictEqual([]);

		paint.resolve();
		await processing;
		expect(pipeline.decoding.started).toStrictEqual(["photo.png"]);
	});

	it("丸めた options で圧縮する(長辺と画質の下限)", async () => {
		stubFetch(uploaded);
		const pipeline = testPipeline();

		await process(pngFile(), pipeline, {
			fieldOptions: normalizeFieldOptions({ maxEdge: 800, minQuality: 0.7 }),
		});

		expect(pipeline.encoding.calls[0]).toStrictEqual({ width: 800, height: 600, quality: 0.7 });
	});

	it("GIF は注意(GIF_FIRST_FRAME_ONLY)を、圧縮・送信の段階と結果で返す", async () => {
		stubFetch(uploaded);
		const phases: UploadPhase[] = [];

		const image = await process(gifFile(), testPipeline(), { phases });

		expect(image.notices).toStrictEqual(["GIF_FIRST_FRAME_ONLY"]);
		expect(phases.at(-1)).toMatchObject({ status: "uploading", notices: ["GIF_FIRST_FRAME_ONLY"] });
		expect(phases[1]).toMatchObject({ status: "compressing", notices: ["GIF_FIRST_FRAME_ONLY"] });
	});

	describe("ファイル名", () => {
		it("空なら送らず、画像エントリにも入れない", async () => {
			const calls = stubFetch(uploaded);

			const image = await process(pngFile(""), testPipeline());

			expect(uploadBody(calls[0])).not.toHaveProperty("filename");
			expect(image.entry).not.toHaveProperty("filename");
		});

		it(`${MAX_FILENAME_LENGTH} 文字(コードポイント)を超えたら切る。サロゲートペアの途中では切らない`, async () => {
			const calls = stubFetch(uploaded);

			const image = await process(pngFile(`${"😀".repeat(300)}.png`), testPipeline());

			expect(uploadBody(calls[0]).filename).toBe("😀".repeat(MAX_FILENAME_LENGTH));
			expect(image.entry.filename).toBe("😀".repeat(MAX_FILENAME_LENGTH));
		});

		it.each([
			["", undefined],
			["a.png", "a.png"],
			["a".repeat(MAX_FILENAME_LENGTH), "a".repeat(MAX_FILENAME_LENGTH)],
			["a".repeat(MAX_FILENAME_LENGTH + 1), "a".repeat(MAX_FILENAME_LENGTH)],
			["写真.jpg", "写真.jpg"],
			[`${"😀".repeat(MAX_FILENAME_LENGTH)}`, "😀".repeat(MAX_FILENAME_LENGTH)],
			[`${"😀".repeat(MAX_FILENAME_LENGTH - 1)}ab`, `${"😀".repeat(MAX_FILENAME_LENGTH - 1)}a`],
		])("toUploadFilename(%#)", (name, expected) => {
			expect(toUploadFilename(name)).toBe(expected);
		});
	});

	it("buildUploadRequest は filename が undefined なら入れない", () => {
		const compression: CompressionResult = {
			dataUrl: "data:image/webp;base64,AAAA",
			width: 10,
			height: 8,
			quality: 0.8,
			storedBytes: 27,
			webpBytes: 3,
			attempts: 1,
		};
		const thumbnail = {
			dataUrl: "data:image/webp;base64,BBBB",
			width: 10,
			height: 8,
			storedBytes: 27,
		};
		expect(buildUploadRequest(compression, thumbnail, undefined, TARGET)).toStrictEqual({
			dataUrl: compression.dataUrl,
			thumb: thumbnail.dataUrl,
			width: 10,
			height: 8,
			quality: 0.8,
			target: TARGET,
		});
		expect(buildUploadRequest(compression, thumbnail, "a.png", TARGET)).toMatchObject({
			filename: "a.png",
		});
	});

	describe("失敗", () => {
		it("受け付けない形式(HEIC)は、デコード・圧縮・送信をしない", async () => {
			const calls = stubFetch(uploaded);
			const pipeline = testPipeline();

			const error = await caught(process(heicFile(), pipeline));

			expect(codeOf(error)).toBe("INPUT_HEIC_REJECTED");
			expect(pipeline.decoding.started).toStrictEqual([]);
			expect(pipeline.encoding.calls).toStrictEqual([]);
			expect(calls).toStrictEqual([]);
		});

		it("本体を予算に収められなければ、送らずにデコードした画像を閉じる", async () => {
			const calls = stubFetch(uploaded);
			const pipeline = testPipeline({ encoding: fakeEncoder(0.5) });

			const error = await caught(process(pngFile(), pipeline));

			expect(codeOf(error)).toBe("COMPRESSION_OVER_BUDGET");
			expect(calls).toStrictEqual([]);
			expect(pipeline.decoding.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
		});

		it("サムネイルを作れなければ、送らずにデコードした画像を閉じる", async () => {
			const calls = stubFetch(uploaded);
			const pipeline = testPipeline({
				encoding: { encoder: oversizedThumbnailEncoder, calls: [] },
			});

			const error = await caught(process(pngFile(), pipeline));

			expect(codeOf(error)).toBe("THUMB_OVER_BUDGET");
			expect(calls).toStrictEqual([]);
			expect(pipeline.decoding.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
		});

		it("ルートのエラーは、そのコードで reject する(デコードした画像は閉じてある)", async () => {
			stubFetch(() => routeError("INVALID_TARGET", 400));
			const pipeline = testPipeline();

			const error = await caught(process(pngFile(), pipeline));

			expect(codeOf(error)).toBe("INVALID_TARGET");
			expect(pipeline.decoding.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
		});

		it("encoder を渡さなければ canvas のエンコーダーを使う(jsdom には無いので ENCODE_FAILED)", async () => {
			const calls = stubFetch(uploaded);
			const decoding = fakeDecoding();

			const error = await caught(
				processImageFile(pngFile(), {
					target: TARGET,
					fieldOptions: DEFAULT_OPTIONS,
					signal: new AbortController().signal,
					dependencies: {
						decodeImage: decoding.decodeImage,
						waitForPaint: () => Promise.resolve(),
					},
				}),
			);

			expect(codeOf(error)).toBe("ENCODE_FAILED");
			expect(calls).toStrictEqual([]);
			expect(decoding.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
		});
	});

	describe("中断", () => {
		it("始める前に中断されていたら、何もせずに signal.reason で reject する", async () => {
			const calls = stubFetch(uploaded);
			const pipeline = testPipeline();
			const controller = new AbortController();
			controller.abort();
			const phases: UploadPhase[] = [];

			const error = await caught(
				process(pngFile(), pipeline, { signal: controller.signal, phases }),
			);

			expect(error).toBe(controller.signal.reason);
			expect(phases).toStrictEqual([]);
			expect(pipeline.decoding.started).toStrictEqual([]);
			expect(calls).toStrictEqual([]);
		});

		it("描画を待つ間に中断されたら、デコードしない", async () => {
			const paint = deferred();
			const pipeline = testPipeline({ overrides: { waitForPaint: () => paint.promise } });
			const controller = new AbortController();

			const processing = process(pngFile(), pipeline, { signal: controller.signal });
			controller.abort();
			paint.resolve();

			expect(await caught(processing)).toBe(controller.signal.reason);
			expect(pipeline.decoding.started).toStrictEqual([]);
		});

		it("描画を待つ間に中断されたら、中断を見ない decodeImage も呼ばない", async () => {
			const paint = deferred();
			const decodeImage = vi.fn<DecodeImage>(() => Promise.reject(new Error("must not decode")));
			const pipeline = testPipeline({
				overrides: { waitForPaint: () => paint.promise, decodeImage },
			});
			const controller = new AbortController();

			const processing = process(pngFile(), pipeline, { signal: controller.signal });
			controller.abort();
			paint.resolve();

			expect(await caught(processing)).toBe(controller.signal.reason);
			expect(decodeImage).not.toHaveBeenCalled();
		});

		it("デコード中に中断されたら、待たずに reject し、あとで届いた ImageBitmap を閉じる(Chromium)", async () => {
			const decoded = deferred();
			const decoding = fakeDecoding(() => decoded.promise);
			const pipeline = testPipeline({ decoding });
			const controller = new AbortController();

			const processing = process(pngFile(), pipeline, { signal: controller.signal });
			await vi.waitFor(() => expect(decoding.started).toHaveLength(1));
			controller.abort();
			expect(await caught(processing)).toBe(controller.signal.reason);

			decoded.resolve();
			await vi.waitFor(() => expect(decoding.bitmaps[0]?.close).toHaveBeenCalledTimes(1));
			expect(pipeline.encoding.calls).toStrictEqual([]);
		});

		it("中断のあとでデコードが resolve しても(Firefox)、圧縮せずに閉じてから reject する", async () => {
			const calls = stubFetch(uploaded);
			const controller = new AbortController();
			const close = vi.fn<() => void>();
			// Firefox 155 は、デコードの間に押された中断を、デコードが終わってから届ける(decodeImage が resolve する)
			const decodeImage: DecodeImage = async (file) => {
				controller.abort();
				return {
					source: {} as CanvasImageSource,
					width: 4000,
					height: 3000,
					mimeType: "image/png",
					filename: file.name,
					fileBytes: file.size,
					notices: [],
					close,
				};
			};
			const pipeline = testPipeline({ overrides: { decodeImage } });
			const phases: UploadPhase[] = [];

			const error = await caught(
				process(pngFile(), pipeline, { signal: controller.signal, phases }),
			);

			expect(error).toBe(controller.signal.reason);
			expect(close).toHaveBeenCalledTimes(1);
			// 圧縮の段階を知らせない(圧縮の関数を呼ぶ前に中断を確かめる)
			expect(phases.map((phase) => phase.status)).toStrictEqual(["decoding"]);
			expect(pipeline.encoding.calls).toStrictEqual([]);
			expect(calls).toStrictEqual([]);
		});

		it("圧縮中に中断されたら、送らずに閉じて reject する", async () => {
			const calls = stubFetch(uploaded);
			const controller = new AbortController();
			const encoding = fakeEncoder(0.77, () => {
				controller.abort();
			});
			const pipeline = testPipeline({ encoding });

			const error = await caught(process(pngFile(), pipeline, { signal: controller.signal }));

			expect(error).toBe(controller.signal.reason);
			expect(encoding.calls).toHaveLength(1);
			expect(pipeline.decoding.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
			expect(calls).toStrictEqual([]);
		});

		it("送信中に中断されたら、応答を待たずに reject する", async () => {
			const calls = stubFetch(hangUntilAborted);
			const controller = new AbortController();

			const processing = process(pngFile(), testPipeline(), { signal: controller.signal });
			await vi.waitFor(() => expect(calls).toHaveLength(1));
			controller.abort();

			expect(await caught(processing)).toBe(controller.signal.reason);
			expect(calls[0]?.init.signal?.aborted).toBe(true);
		});
	});
});

/** requestAnimationFrame を、呼ばれたコールバックを貯めるだけのものにする(描画は起きない) */
function stubAnimationFrames(): FrameRequestCallback[] {
	const frames: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	return frames;
}

/** promise が resolve したかを、あとから同期で見られるようにする */
function track(promise: Promise<void>): { readonly done: () => boolean } {
	let settled = false;
	const mark = async (): Promise<void> => {
		await promise;
		settled = true;
	};
	void mark();
	return { done: () => settled };
}

describe("waitForPaint", () => {
	it("2 回目の requestAnimationFrame のあとのタイマーで resolve する(React のコミットのあとの描画を待つ)", async () => {
		const frames = stubAnimationFrames();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

		const waiting = track(waitForPaint());
		await vi.advanceTimersByTimeAsync(0);
		expect(waiting.done()).toBe(false);
		expect(frames).toHaveLength(1);

		// 1 回目のフレームのあとでは、まだ resolve しない(そのフレームには、状態の変化が描画されていないことがある)
		frames[0]?.(0);
		await vi.advanceTimersByTimeAsync(0);
		expect(waiting.done()).toBe(false);
		expect(frames).toHaveLength(2);

		frames[1]?.(16);
		await Promise.resolve();
		expect(waiting.done()).toBe(false);
		await vi.advanceTimersByTimeAsync(0);
		expect(waiting.done()).toBe(true);
	});

	it(`requestAnimationFrame が呼ばれなくても(背景のタブ)、${PAINT_TIMEOUT_MS}ms で resolve する`, async () => {
		stubAnimationFrames();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

		const waiting = track(waitForPaint());
		await vi.advanceTimersByTimeAsync(PAINT_TIMEOUT_MS - 1);
		expect(waiting.done()).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(waiting.done()).toBe(true);
	});

	it("requestAnimationFrame が無い環境でも resolve する", async () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

		const waiting = track(waitForPaint());
		await vi.advanceTimersByTimeAsync(PAINT_TIMEOUT_MS);
		expect(waiting.done()).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// useImageUpload
// ---------------------------------------------------------------------------

function renderImageUpload(
	options: Partial<UseImageUploadOptions> & { dependencies: UploadDependencies },
) {
	return renderHook((props: UseImageUploadOptions) => useImageUpload(props), {
		initialProps: { target: RESOLVED, ...options },
	});
}

/** act の外で upload を始める(途中の状態を waitFor で見るため)。状態の最初の変化(decoding)は act の中で起きる */
function start(current: ImageUpload, file: File): Promise<UploadOutcome> {
	let outcome: Promise<UploadOutcome> | undefined;
	act(() => {
		outcome = current.upload(file);
	});
	if (outcome === undefined) throw new Error("upload was not called");
	return outcome;
}

describe("useImageUpload", () => {
	it("最初は idle", () => {
		const { result } = renderImageUpload({ dependencies: testPipeline().dependencies });
		expect(result.current.state).toStrictEqual({ status: "idle" });
		expect(result.current.file).toBeNull();
		expect(result.current.busy).toBe(false);
	});

	it("1 枚を処理すると done になり、結果にも状態にも参照と画像エントリが入る", async () => {
		const calls = stubFetch(uploaded);
		const { result } = renderImageUpload({ dependencies: testPipeline().dependencies });
		const file = pngFile();

		let outcome: UploadOutcome | undefined;
		await act(async () => {
			outcome = await result.current.upload(file);
		});

		expect(outcome).toMatchObject({
			status: "done",
			image: { ref: { id: IMAGE_ID, width: 1600, height: 1200, alt: "" } },
		});
		expect(result.current.state).toStrictEqual(outcome);
		expect(result.current.file).toBe(file);
		expect(result.current.busy).toBe(false);
		expect(uploadBody(calls[0]).target).toStrictEqual(TARGET);
	});

	it("処理中は、段階(decoding → compressing → thumbnail → uploading)を状態として返す", async () => {
		const { gates } = gatedFetch();
		const decodeGate = deferred();
		const encodeGate = deferred();
		const thumbnailGate = deferred();
		const decoding = fakeDecoding(() => decodeGate.promise);
		const encoding = fakeEncoder(0.77, (call) => {
			if (Math.max(call.width, call.height) <= 96) return thumbnailGate.promise;
			return call.quality === 0.6 ? encodeGate.promise : undefined;
		});
		const { result } = renderImageUpload({
			dependencies: testPipeline({ decoding, encoding }).dependencies,
		});

		const outcome = start(result.current, pngFile());
		expect(result.current.state).toStrictEqual({ status: "decoding" });
		expect(result.current.busy).toBe(true);

		decodeGate.resolve();
		await waitFor(() =>
			expect(result.current.state).toStrictEqual({
				status: "compressing",
				notices: [],
				progress: { width: 1600, height: 1200, quality: 0.6, attempt: 1 },
			}),
		);

		const compressed = { width: 1600, height: 1200, quality: 0.77, storedBytes: 2159 };
		encodeGate.resolve();
		await waitFor(() =>
			expect(result.current.state).toStrictEqual({ status: "thumbnail", notices: [], compressed }),
		);
		expect(result.current.busy).toBe(true);

		thumbnailGate.resolve();
		await waitFor(() =>
			expect(result.current.state).toStrictEqual({ status: "uploading", notices: [], compressed }),
		);
		expect(result.current.busy).toBe(true);

		await act(async () => {
			gates[0]?.resolve(uploaded(gates[0].call));
			await outcome;
		});
		expect(result.current.state.status).toBe("done");
		expect(result.current.busy).toBe(false);
	});

	it("失敗したら error になる(結果も error。値を変えるための done は返さない)", async () => {
		stubFetch(() => routeError("IMAGE_TOO_LARGE", 400));
		const { result } = renderImageUpload({ dependencies: testPipeline().dependencies });

		let outcome: UploadOutcome | undefined;
		await act(async () => {
			outcome = await result.current.upload(pngFile());
		});

		expect(outcome?.status).toBe("error");
		expect(result.current.state.status).toBe("error");
		const error = result.current.state.status === "error" ? result.current.state.error : undefined;
		expect(codeOf(error)).toBe("IMAGE_TOO_LARGE");
		expect(result.current.busy).toBe(false);
	});

	it("キャンセルすると idle に戻り、結果は cancelled(エラーにしない)。送信も中断する", async () => {
		const calls = stubFetch(hangUntilAborted);
		const { result } = renderImageUpload({ dependencies: testPipeline().dependencies });

		const outcome = start(result.current, pngFile());
		await waitFor(() => expect(result.current.state.status).toBe("uploading"));
		act(() => {
			result.current.cancel();
		});

		expect(result.current.state).toStrictEqual({ status: "idle" });
		expect(result.current.file).toBeNull();
		await act(async () => {
			expect(await outcome).toStrictEqual({ status: "cancelled" });
		});
		expect(calls[0]?.init.signal?.aborted).toBe(true);
		expect(result.current.state).toStrictEqual({ status: "idle" });
	});

	it("圧縮中にキャンセルすると、送らずにデコードした画像を閉じる", async () => {
		const calls = stubFetch(uploaded);
		const encodeGate = deferred();
		const encoding = fakeEncoder(0.77, () => encodeGate.promise);
		const pipeline = testPipeline({ encoding });
		const { result } = renderImageUpload({ dependencies: pipeline.dependencies });

		const outcome = start(result.current, pngFile());
		await waitFor(() => expect(result.current.state.status).toBe("compressing"));
		act(() => {
			result.current.cancel();
		});
		await act(async () => {
			expect(await outcome).toStrictEqual({ status: "cancelled" });
		});

		expect(calls).toStrictEqual([]);
		expect(pipeline.decoding.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
		expect(result.current.state).toStrictEqual({ status: "idle" });
	});

	it("デコード中のキャンセルがデコードのあとに届いても(Firefox)、圧縮せずに閉じる", async () => {
		const calls = stubFetch(uploaded);
		const decodeStarted = deferred();
		const decodeGate = deferred();
		const close = vi.fn<() => void>();
		// signal を見ない(Firefox では、デコードの間の中断が間に合わず resolve する)
		const decodeImage: DecodeImage = async (file) => {
			decodeStarted.resolve();
			await decodeGate.promise;
			return {
				source: {} as CanvasImageSource,
				width: 4000,
				height: 3000,
				mimeType: "image/png",
				filename: file.name,
				fileBytes: file.size,
				notices: [],
				close,
			};
		};
		const pipeline = testPipeline({ overrides: { decodeImage } });
		const { result } = renderImageUpload({ dependencies: pipeline.dependencies });

		const outcome = start(result.current, pngFile());
		await act(async () => {
			await decodeStarted.promise;
		});
		act(() => {
			result.current.cancel();
		});
		await act(async () => {
			decodeGate.resolve();
			expect(await outcome).toStrictEqual({ status: "cancelled" });
		});

		expect(close).toHaveBeenCalledTimes(1);
		expect(pipeline.encoding.calls).toStrictEqual([]);
		expect(calls).toStrictEqual([]);
		expect(result.current.state).toStrictEqual({ status: "idle" });
	});

	it("キャンセルのあとに届いた途中経過では、状態を変えない", async () => {
		const compressStarted = deferred();
		// 中断されると、あとから途中経過を 1 回知らせてから reject する圧縮の関数
		const compressImage: CompressImage = (_image, options) =>
			new Promise((_resolve, reject) => {
				compressStarted.resolve();
				const { signal } = options;
				signal?.addEventListener(
					"abort",
					() => {
						setTimeout(() => {
							options.onProgress?.({ width: 1600, height: 1200, quality: 0.6, attempt: 1 });
							reject(signal.reason);
						}, 0);
					},
					{ once: true },
				);
			});
		const pipeline = testPipeline({ overrides: { compressImage } });
		const { result } = renderImageUpload({ dependencies: pipeline.dependencies });

		const outcome = start(result.current, pngFile());
		await act(async () => {
			await compressStarted.promise;
		});
		act(() => {
			result.current.cancel();
		});
		await act(async () => {
			expect(await outcome).toStrictEqual({ status: "cancelled" });
		});

		expect(result.current.state).toStrictEqual({ status: "idle" });
		expect(pipeline.decoding.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
	});

	it("処理中に別のファイルを渡すと、前の処理を中断してから始める(差し替え)", async () => {
		const calls = stubFetch((call) =>
			calls.length === 1 ? hangUntilAborted(call) : uploaded(call),
		);
		const { result } = renderImageUpload({ dependencies: testPipeline().dependencies });
		const first = pngFile("first.png");
		const second = pngFile("second.png");

		const firstOutcome = start(result.current, first);
		await waitFor(() => expect(result.current.state.status).toBe("uploading"));
		let secondOutcome: UploadOutcome | undefined;
		await act(async () => {
			secondOutcome = await result.current.upload(second);
		});

		await act(async () => {
			expect(await firstOutcome).toStrictEqual({ status: "cancelled" });
		});
		expect(secondOutcome?.status).toBe("done");
		expect(calls[0]?.init.signal?.aborted).toBe(true);
		expect(calls.map((call) => uploadBody(call).filename)).toStrictEqual([
			"first.png",
			"second.png",
		]);
		expect(result.current.state.status).toBe("done");
		expect(result.current.file).toBe(second);
	});

	it("送信の関数が中断に応えなくても、キャンセルを優先する(結果は cancelled、状態は idle)", async () => {
		const sent = deferred<{ ref: UploadedImage["ref"] }>();
		const pipeline = testPipeline({ overrides: { uploadImage: () => sent.promise } });
		const { result } = renderImageUpload({ dependencies: pipeline.dependencies });

		const outcome = start(result.current, pngFile());
		await waitFor(() => expect(result.current.state.status).toBe("uploading"));
		act(() => {
			result.current.cancel();
		});
		await act(async () => {
			sent.resolve({
				ref: { v: 1, id: IMAGE_ID, locale: "en", width: 1600, height: 1200, alt: "" },
			});
			expect(await outcome).toStrictEqual({ status: "cancelled" });
		});

		expect(result.current.state).toStrictEqual({ status: "idle" });
	});

	it("reset は処理中なら中断し、idle に戻す", async () => {
		const calls = stubFetch(hangUntilAborted);
		const { result } = renderImageUpload({ dependencies: testPipeline().dependencies });

		const outcome = start(result.current, pngFile());
		await waitFor(() => expect(result.current.state.status).toBe("uploading"));
		act(() => {
			result.current.reset();
		});

		expect(result.current.state).toStrictEqual({ status: "idle" });
		await act(async () => {
			expect(await outcome).toStrictEqual({ status: "cancelled" });
		});
		expect(calls[0]?.init.signal?.aborted).toBe(true);
	});

	it("アンマウントすると中断する(結果は cancelled)", async () => {
		const calls = stubFetch(hangUntilAborted);
		const { result, unmount } = renderImageUpload({ dependencies: testPipeline().dependencies });

		const outcome = start(result.current, pngFile());
		await waitFor(() => expect(calls).toHaveLength(1));
		unmount();

		expect(await outcome).toStrictEqual({ status: "cancelled" });
		expect(calls[0]?.init.signal?.aborted).toBe(true);
	});

	it("保存先を求められなければ INVALID_TARGET で失敗し、デコードもしない", async () => {
		const calls = stubFetch(uploaded);
		const pipeline = testPipeline();
		const { result } = renderImageUpload({
			dependencies: pipeline.dependencies,
			target: resolveUploadTarget("field-cover", at("/_emdash/admin/plugins/base64-image")),
		});

		let outcome: UploadOutcome | undefined;
		await act(async () => {
			outcome = await result.current.upload(pngFile());
		});

		expect(outcome?.status).toBe("error");
		expect(codeOf(outcome?.status === "error" ? outcome.error : undefined)).toBe("INVALID_TARGET");
		expect(pipeline.decoding.started).toStrictEqual([]);
		expect(calls).toStrictEqual([]);
	});

	it("widget の options を丸めて使い(配列なら既定値)、props が変わったら次の upload から新しい値を使う", async () => {
		const calls = stubFetch(uploaded);
		const pipeline = testPipeline();
		const { result, rerender } = renderImageUpload({
			dependencies: pipeline.dependencies,
			options: [{ value: "a", label: "A" }],
		});

		await act(async () => {
			await result.current.upload(pngFile());
		});
		expect(pipeline.encoding.calls[0]).toMatchObject({ width: 1600, height: 1200 });

		const galleryTarget: UploadTargetResolution = {
			ok: true,
			target: { collection: "pages", field: "gallery" },
		};
		rerender({
			target: galleryTarget,
			options: { maxEdge: 800 },
			dependencies: pipeline.dependencies,
		});
		const before = pipeline.encoding.calls.length;
		await act(async () => {
			await result.current.upload(pngFile());
		});
		expect(pipeline.encoding.calls[before]).toMatchObject({ width: 800, height: 600 });
		expect(uploadBody(calls[1]).target).toStrictEqual({ collection: "pages", field: "gallery" });
	});

	it("cancel は処理中でなければ何もしない。reset は done / error を idle に戻す", async () => {
		stubFetch(() => routeError("IMAGE_TOO_LARGE", 400));
		const { result } = renderImageUpload({ dependencies: testPipeline().dependencies });
		await act(async () => {
			await result.current.upload(pngFile());
		});
		expect(result.current.state.status).toBe("error");

		act(() => {
			result.current.cancel();
		});
		expect(result.current.state.status).toBe("error");

		act(() => {
			result.current.reset();
		});
		expect(result.current.state).toStrictEqual({ status: "idle" });
		expect(result.current.file).toBeNull();
	});

	it("upload・cancel・reset は描画し直しても同じ関数", () => {
		const { result, rerender } = renderImageUpload({ dependencies: testPipeline().dependencies });
		const { upload, cancel, reset } = result.current;
		rerender({ target: RESOLVED, dependencies: testPipeline().dependencies });
		expect(result.current.upload).toBe(upload);
		expect(result.current.cancel).toBe(cancel);
		expect(result.current.reset).toBe(reset);
	});

	it("StrictMode(effect が 2 回動く)でも処理できる", async () => {
		stubFetch(uploaded);
		const dependencies = testPipeline().dependencies;
		const { result } = renderHook(() => useImageUpload({ target: RESOLVED, dependencies }), {
			reactStrictMode: true,
		});

		let outcome: UploadOutcome | undefined;
		await act(async () => {
			outcome = await result.current.upload(pngFile());
		});

		expect(outcome?.status).toBe("done");
		expect(result.current.state.status).toBe("done");
	});
});

// ---------------------------------------------------------------------------
// useUploadQueue
// ---------------------------------------------------------------------------

interface QueueHarness {
	readonly result: { readonly current: UploadQueue };
	readonly uploadedImages: { readonly image: UploadedImage; readonly file: File }[];
	readonly unmount: () => void;
}

function renderQueue(
	dependencies: UploadDependencies,
	overrides: Partial<UseUploadQueueOptions> = {},
): QueueHarness {
	const uploadedImages: { image: UploadedImage; file: File }[] = [];
	const { result, unmount } = renderHook(() =>
		useUploadQueue({
			target: RESOLVED,
			onUploaded: (image, file) => {
				uploadedImages.push({ image, file });
			},
			dependencies,
			...overrides,
		}),
	);
	return { result, uploadedImages, unmount };
}

function statusOf(queue: UploadQueue, name: string): string | undefined {
	return queue.items.find((item) => item.file.name === name)?.state.status;
}

function errorCodeOf(queue: UploadQueue, name: string): string | undefined {
	const state = queue.items.find((item) => item.file.name === name)?.state;
	return state?.status === "error" ? codeOf(state.error) : undefined;
}

describe("useUploadQueue", () => {
	it("複数のファイルを 1 枚ずつ順に処理し、終わるたびに onUploaded を呼ぶ", async () => {
		const log: string[] = [];
		const decoding = fakeDecoding(async (file) => {
			log.push(`decode:${file.name}`);
		});
		stubFetch((call) => {
			log.push(`upload:${uploadBody(call).filename ?? ""}`);
			return uploaded(call);
		});
		const { result, uploadedImages } = renderQueue(testPipeline({ decoding }).dependencies);
		const files = [pngFile("a.png"), pngFile("b.png"), pngFile("c.png")];

		act(() => {
			result.current.enqueue(files);
		});
		expect(result.current.items.map((item) => item.state.status)).toStrictEqual([
			"queued",
			"queued",
			"queued",
		]);
		expect(result.current.pendingCount).toBe(3);
		await waitFor(() => expect(uploadedImages).toHaveLength(3));

		// 前のファイルの送信が終わってから、次のファイルのデコードを始める
		expect(log).toStrictEqual([
			"decode:a.png",
			"upload:a.png",
			"decode:b.png",
			"upload:b.png",
			"decode:c.png",
			"upload:c.png",
		]);
		expect(uploadedImages.map((entry) => entry.file)).toStrictEqual(files);
		expect(uploadedImages[0]?.image.ref.id).toBe(IMAGE_ID);
		expect(result.current.items).toStrictEqual([]);
		expect(result.current.busy).toBe(false);
	});

	it("処理中のファイル(current)と、ひと続きの処理で終えた数(finishedCount・uploadedCount)を返す", async () => {
		const { gates } = gatedFetch();
		const { result, uploadedImages } = renderQueue(testPipeline().dependencies);
		const counts = () => ({
			current: result.current.current?.file.name ?? null,
			finished: result.current.finishedCount,
			uploaded: result.current.uploadedCount,
			pending: result.current.pendingCount,
		});

		act(() => {
			result.current.enqueue([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
		});
		expect(counts()).toStrictEqual({ current: null, finished: 0, uploaded: 0, pending: 3 });
		await waitFor(() => expect(gates).toHaveLength(1));
		expect(counts()).toStrictEqual({ current: "a.png", finished: 0, uploaded: 0, pending: 3 });
		expect(result.current.current?.state.status).toBe("uploading");

		// 1 枚目は失敗、2 枚目と 3 枚目は成功
		await act(async () => {
			gates[0]?.resolve(routeError("IMAGE_TOO_LARGE", 400));
			await vi.waitFor(() => expect(gates).toHaveLength(2));
		});
		expect(counts()).toStrictEqual({ current: "b.png", finished: 1, uploaded: 0, pending: 2 });
		await act(async () => {
			gates[1]?.resolve(uploaded(gates[1].call));
			await vi.waitFor(() => expect(gates).toHaveLength(3));
		});
		expect(counts()).toStrictEqual({ current: "c.png", finished: 2, uploaded: 1, pending: 1 });
		await act(async () => {
			gates[2]?.resolve(uploaded(gates[2].call));
			await vi.waitFor(() => expect(uploadedImages).toHaveLength(2));
		});
		expect(counts()).toStrictEqual({ current: null, finished: 3, uploaded: 2, pending: 0 });
		expect(result.current.busy).toBe(false);

		// 次のひと続きの処理を始めると 0 に戻す(失敗の表示が残っていても)
		act(() => {
			result.current.enqueue([pngFile("d.png")]);
		});
		expect(counts()).toStrictEqual({ current: null, finished: 0, uploaded: 0, pending: 1 });
		await act(async () => {
			await vi.waitFor(() => expect(gates).toHaveLength(4));
			gates[3]?.resolve(uploaded(gates[3].call));
			await vi.waitFor(() => expect(uploadedImages).toHaveLength(3));
		});
		expect(counts()).toStrictEqual({ current: null, finished: 1, uploaded: 1, pending: 0 });
	});

	it("処理中に受け付けたファイルは、同じひと続きの処理として数える", async () => {
		const { gates } = gatedFetch();
		const { result, uploadedImages } = renderQueue(testPipeline().dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png"), pngFile("b.png")]);
		});
		await act(async () => {
			await vi.waitFor(() => expect(gates).toHaveLength(1));
			gates[0]?.resolve(uploaded(gates[0].call));
			await vi.waitFor(() => expect(gates).toHaveLength(2));
		});
		expect(result.current.finishedCount).toBe(1);
		act(() => {
			result.current.enqueue([pngFile("c.png")]);
		});
		expect([result.current.finishedCount, result.current.pendingCount]).toStrictEqual([1, 2]);

		await act(async () => {
			gates[1]?.resolve(uploaded(gates[1].call));
			await vi.waitFor(() => expect(gates).toHaveLength(3));
			gates[2]?.resolve(uploaded(gates[2].call));
			await vi.waitFor(() => expect(uploadedImages).toHaveLength(3));
		});
		expect([result.current.finishedCount, result.current.uploadedCount]).toStrictEqual([3, 3]);
	});

	it("受け付けないファイル(HEIC)は、ほかのファイルの処理を待たずに失敗にする", async () => {
		const { gates } = gatedFetch();
		const { result, uploadedImages } = renderQueue(testPipeline().dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png"), heicFile("b.heic"), pngFile("c.png")]);
		});
		await waitFor(() => expect(statusOf(result.current, "b.heic")).toBe("error"));
		expect(errorCodeOf(result.current, "b.heic")).toBe("INPUT_HEIC_REJECTED");
		// その時点で、1 枚目はまだ送信を終えていない
		expect(uploadedImages).toStrictEqual([]);
		await waitFor(() => expect(statusOf(result.current, "a.png")).toBe("uploading"));
		expect(result.current.pendingCount).toBe(2);

		await act(async () => {
			gates[0]?.resolve(uploaded(gates[0].call));
			await vi.waitFor(() => expect(gates).toHaveLength(2));
			gates[1]?.resolve(uploaded(gates[1].call));
			await vi.waitFor(() => expect(uploadedImages).toHaveLength(2));
		});
		expect(uploadedImages.map((entry) => entry.file.name)).toStrictEqual(["a.png", "c.png"]);
		expect(result.current.items.map((item) => item.file.name)).toStrictEqual(["b.heic"]);
		expect(result.current.pendingCount).toBe(0);
	});

	it("limit を超える分は GALLERY_TOO_MANY_ITEMS にする(受け付けないファイルは数えない)", async () => {
		stubFetch(uploaded);
		const { result, uploadedImages } = renderQueue(testPipeline().dependencies);

		act(() => {
			result.current.enqueue(
				[pngFile("a.png"), heicFile("x.heic"), pngFile("b.png"), pngFile("c.png")],
				{ limit: 2 },
			);
		});
		await waitFor(() => expect(uploadedImages).toHaveLength(2));

		expect(uploadedImages.map((entry) => entry.file.name)).toStrictEqual(["a.png", "b.png"]);
		expect(errorCodeOf(result.current, "x.heic")).toBe("INPUT_HEIC_REJECTED");
		expect(errorCodeOf(result.current, "c.png")).toBe("GALLERY_TOO_MANY_ITEMS");
	});

	it("limit が 0 以下なら、どのファイルも処理しない", async () => {
		const calls = stubFetch(uploaded);
		const { result } = renderQueue(testPipeline().dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png")], { limit: 0 });
		});
		await waitFor(() =>
			expect(errorCodeOf(result.current, "a.png")).toBe("GALLERY_TOO_MANY_ITEMS"),
		);
		expect(calls).toStrictEqual([]);
	});

	it("1 枚が失敗しても、次のファイルを処理する", async () => {
		const calls = stubFetch((call) =>
			calls.length === 1 ? routeError("IMAGE_TOO_LARGE", 400) : uploaded(call),
		);
		const { result, uploadedImages } = renderQueue(testPipeline().dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png"), pngFile("b.png")]);
		});
		await waitFor(() => expect(uploadedImages).toHaveLength(1));

		expect(uploadedImages[0]?.file.name).toBe("b.png");
		expect(errorCodeOf(result.current, "a.png")).toBe("IMAGE_TOO_LARGE");
		expect(result.current.pendingCount).toBe(0);
		expect(result.current.busy).toBe(false);
	});

	it("処理中に受け付けたファイルは、後ろに並べて処理する", async () => {
		const { gates } = gatedFetch();
		const { result, uploadedImages } = renderQueue(testPipeline().dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png")]);
		});
		await waitFor(() => expect(statusOf(result.current, "a.png")).toBe("uploading"));
		act(() => {
			result.current.enqueue([pngFile("b.png")]);
		});
		// 受け付けたときの判定が終わっても、1 枚目の送信が終わるまでは始めない
		await act(async () => {
			await tick();
			await tick();
		});
		expect(statusOf(result.current, "b.png")).toBe("queued");
		expect(gates).toHaveLength(1);

		await act(async () => {
			gates[0]?.resolve(uploaded(gates[0].call));
			await vi.waitFor(() => expect(gates).toHaveLength(2));
			gates[1]?.resolve(uploaded(gates[1].call));
			await vi.waitFor(() => expect(uploadedImages).toHaveLength(2));
		});
		expect(uploadedImages.map((entry) => entry.file.name)).toStrictEqual(["a.png", "b.png"]);
	});

	it("remove: 処理待ちのファイルは処理せず、処理中のファイルは中断して次に進む(エラーにしない)", async () => {
		const { gates, calls } = gatedFetch();
		const pipeline = testPipeline();
		const { result, uploadedImages } = renderQueue(pipeline.dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
		});
		await waitFor(() => expect(statusOf(result.current, "a.png")).toBe("uploading"));
		const keyOf = (name: string) =>
			result.current.items.find((item) => item.file.name === name)?.key ?? "";

		act(() => {
			result.current.remove(keyOf("b.png"));
			result.current.remove(keyOf("a.png"));
		});
		expect(calls[0]?.init.signal?.aborted).toBe(true);
		expect(result.current.items.map((item) => item.file.name)).toStrictEqual(["c.png"]);

		await act(async () => {
			await vi.waitFor(() => expect(gates).toHaveLength(2));
			gates[1]?.resolve(uploaded(gates[1].call));
			await vi.waitFor(() => expect(uploadedImages).toHaveLength(1));
		});
		expect(uploadedImages[0]?.file.name).toBe("c.png");
		expect(pipeline.decoding.started).toStrictEqual(["a.png", "c.png"]);
		expect(result.current.items).toStrictEqual([]);
		// 取り消したファイルは、処理を終えた数に入れない
		expect([result.current.finishedCount, result.current.uploadedCount]).toStrictEqual([1, 1]);
	});

	it("送信の関数が中断に応えなくても、取り消したファイルは onUploaded に渡さない", async () => {
		const sent = deferred<{ ref: UploadedImage["ref"] }>();
		const pipeline = testPipeline({ overrides: { uploadImage: () => sent.promise } });
		const { result, uploadedImages } = renderQueue(pipeline.dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png")]);
		});
		await waitFor(() => expect(statusOf(result.current, "a.png")).toBe("uploading"));
		act(() => {
			result.current.remove(result.current.items[0]?.key ?? "");
		});
		await act(async () => {
			sent.resolve({
				ref: { v: 1, id: IMAGE_ID, locale: "en", width: 1600, height: 1200, alt: "" },
			});
			await tick();
		});

		expect(uploadedImages).toStrictEqual([]);
		expect(result.current.items).toStrictEqual([]);
	});

	it("remove と clearErrors で失敗の表示を消す", async () => {
		const { result } = renderQueue(testPipeline().dependencies);

		act(() => {
			result.current.enqueue([heicFile("a.heic"), heicFile("b.heic"), heicFile("c.heic")]);
		});
		await waitFor(() =>
			expect(result.current.items.map((item) => item.state.status)).toStrictEqual([
				"error",
				"error",
				"error",
			]),
		);
		act(() => {
			result.current.remove(result.current.items[0]?.key ?? "");
		});
		expect(result.current.items.map((item) => item.file.name)).toStrictEqual(["b.heic", "c.heic"]);
		act(() => {
			result.current.clearErrors();
		});
		expect(result.current.items).toStrictEqual([]);
	});

	it("clearErrors は、処理待ちと処理中のファイルを残す", async () => {
		const { gates } = gatedFetch();
		const { result, uploadedImages } = renderQueue(testPipeline().dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png"), heicFile("x.heic")]);
		});
		await waitFor(() => expect(statusOf(result.current, "x.heic")).toBe("error"));
		await waitFor(() => expect(statusOf(result.current, "a.png")).toBe("uploading"));
		act(() => {
			result.current.clearErrors();
		});
		expect(result.current.items.map((item) => item.file.name)).toStrictEqual(["a.png"]);

		await act(async () => {
			gates[0]?.resolve(uploaded(gates[0].call));
			await vi.waitFor(() => expect(uploadedImages).toHaveLength(1));
		});
	});

	it("cancelAll: 処理待ちと処理中を取り消し、失敗の表示は残す", async () => {
		const calls = stubFetch(hangUntilAborted);
		const pipeline = testPipeline();
		const { result, uploadedImages } = renderQueue(pipeline.dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png"), heicFile("x.heic"), pngFile("b.png")]);
		});
		await waitFor(() => expect(statusOf(result.current, "a.png")).toBe("uploading"));
		act(() => {
			result.current.cancelAll();
		});

		expect(result.current.items.map((item) => item.file.name)).toStrictEqual(["x.heic"]);
		expect(calls[0]?.init.signal?.aborted).toBe(true);
		await act(async () => {
			await tick();
		});
		expect(pipeline.decoding.started).toStrictEqual(["a.png"]);
		expect(uploadedImages).toStrictEqual([]);
		expect(result.current.finishedCount).toBe(0);
		expect(result.current.current).toBeNull();
	});

	it("受け付けたときの判定の途中で cancelAll しても、そのファイルは処理しない", async () => {
		const calls = stubFetch(uploaded);
		const inspected = deferred();
		const pipeline = testPipeline({
			overrides: {
				inspectInputFile: async () => {
					await inspected.promise;
					return { format: "png", mimeType: "image/png", dimensions: null, notices: [] };
				},
			},
		});
		const { result } = renderQueue(pipeline.dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png")]);
		});
		act(() => {
			result.current.cancelAll();
		});
		await act(async () => {
			inspected.resolve();
			await tick();
		});

		expect(result.current.items).toStrictEqual([]);
		expect(pipeline.decoding.started).toStrictEqual([]);
		expect(calls).toStrictEqual([]);
	});

	it("アンマウントすると、処理中のファイルを中断し、次のファイルを処理しない", async () => {
		const calls = stubFetch(hangUntilAborted);
		const pipeline = testPipeline();
		const { result, uploadedImages, unmount } = renderQueue(pipeline.dependencies);

		act(() => {
			result.current.enqueue([pngFile("a.png"), pngFile("b.png")]);
		});
		await waitFor(() => expect(calls).toHaveLength(1));
		unmount();
		await tick();
		await tick();

		expect(calls[0]?.init.signal?.aborted).toBe(true);
		expect(pipeline.decoding.started).toStrictEqual(["a.png"]);
		expect(uploadedImages).toStrictEqual([]);
	});

	it("保存先を求められなければ、各ファイルを INVALID_TARGET で失敗にする", async () => {
		const calls = stubFetch(uploaded);
		const { result } = renderQueue(testPipeline().dependencies, {
			target: resolveUploadTarget("title", at(EDIT_PATH)),
		});

		act(() => {
			result.current.enqueue([pngFile("a.png"), pngFile("b.png")]);
		});
		await waitFor(() => expect(errorCodeOf(result.current, "b.png")).toBe("INVALID_TARGET"));
		expect(errorCodeOf(result.current, "a.png")).toBe("INVALID_TARGET");
		expect(calls).toStrictEqual([]);
	});

	it("onUploaded が例外を投げたら、そのファイルの失敗として残す", async () => {
		stubFetch(uploaded);
		const failure = new Error("widget failed");
		const { result } = renderQueue(testPipeline().dependencies, {
			onUploaded: () => {
				throw failure;
			},
		});

		act(() => {
			result.current.enqueue([pngFile("a.png")]);
		});
		await waitFor(() => expect(statusOf(result.current, "a.png")).toBe("error"));
		const state = result.current.items[0]?.state;
		expect(state?.status === "error" ? state.error : undefined).toBe(failure);
	});

	it("FileList のような ArrayLike も受け付け、空なら何もしない", async () => {
		stubFetch(uploaded);
		const { result, uploadedImages } = renderQueue(testPipeline().dependencies);
		const file = pngFile("a.png");
		const fileList = { length: 1, 0: file } as ArrayLike<File>;

		act(() => {
			result.current.enqueue([]);
		});
		expect(result.current.items).toStrictEqual([]);
		act(() => {
			result.current.enqueue(fileList);
		});
		await waitFor(() => expect(uploadedImages).toHaveLength(1));
	});

	it("StrictMode(effect が 2 回動く)でも処理できる", async () => {
		stubFetch(uploaded);
		const dependencies = testPipeline().dependencies;
		const names: string[] = [];
		const { result } = renderHook(
			() =>
				useUploadQueue({
					target: RESOLVED,
					onUploaded: (_image, file) => {
						names.push(file.name);
					},
					dependencies,
				}),
			{ reactStrictMode: true },
		);

		act(() => {
			result.current.enqueue([pngFile("a.png"), pngFile("b.png")]);
		});

		await waitFor(() => expect(names).toStrictEqual(["a.png", "b.png"]));
		expect(result.current.items).toStrictEqual([]);
	});
});

// ---------------------------------------------------------------------------
// usePreviewImages
// ---------------------------------------------------------------------------

const ID_A = "01J8Z3K4M5N6P7Q8R9S0T1V2WA";
const ID_B = "01J8Z3K4M5N6P7Q8R9S0T1V2WB";
const ID_C = "01J8Z3K4M5N6P7Q8R9S0T1V2WC";

function entryFor(id: string): Base64ImageEntry {
	return {
		src: `data:image/webp;base64,${id}`,
		mimeType: "image/webp",
		width: 1280,
		height: 853,
		meta: { v: 1, bytes: 60_000, quality: 0.77 },
	};
}

/** プレビューのルート。`missing` の ID は image: null、`absent` の ID は応答に含めない */
function previewRoute(
	options: { readonly missing?: readonly string[]; readonly absent?: readonly string[] } = {},
) {
	return (call: FetchCall): Response => {
		const { ids } = call.body as { ids: string[] };
		return success({
			items: ids
				.filter((id) => !options.absent?.includes(id))
				.map((id) => ({ id, image: options.missing?.includes(id) ? null : entryFor(id) })),
		});
	};
}

function requestedIds(calls: readonly FetchCall[]): string[][] {
	return calls.map((call) => (call.body as { ids: string[] }).ids);
}

describe("usePreviewImages", () => {
	it("ID の画像を preview ルートから取得する(取得中は loading)", async () => {
		const calls = stubFetch(previewRoute({ missing: [ID_B] }));
		const { result } = renderHook(() => usePreviewImages([ID_A, ID_B]));

		expect([...result.current.previews.values()]).toStrictEqual([
			{ status: "loading" },
			{ status: "loading" },
		]);
		await waitFor(() =>
			expect(result.current.previews.get(ID_A)).toStrictEqual({
				status: "loaded",
				image: entryFor(ID_A),
			}),
		);
		expect(result.current.previews.get(ID_B)).toStrictEqual({ status: "missing" });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(`${PLUGIN_API}/preview`);
		expect(requestedIds(calls)).toStrictEqual([[ID_A, ID_B]]);
	});

	it("応答に無い ID は missing。エントリ ID の形でない ID は取得せずに missing", async () => {
		const calls = stubFetch(previewRoute({ absent: [ID_B] }));
		const { result } = renderHook(() => usePreviewImages([ID_A, ID_B, "not/an id"]));

		expect(result.current.previews.get("not/an id")).toStrictEqual({ status: "missing" });
		await waitFor(() =>
			expect(result.current.previews.get(ID_B)).toStrictEqual({ status: "missing" }),
		);
		expect(result.current.previews.get(ID_A)?.status).toBe("loaded");
		expect(requestedIds(calls)).toStrictEqual([[ID_A, ID_B]]);
	});

	it(`${PREVIEW_MAX_IDS} 件ずつに分けて並行に送り、重複は除く`, async () => {
		const calls = stubFetch(previewRoute());
		const ids = Array.from(
			{ length: 12 },
			(_, index) => `01J8Z3K4M5N6P7Q8R9S0T1V2${String(index).padStart(2, "0")}`,
		);
		const { result } = renderHook(() => usePreviewImages([...ids, ids[0] ?? ""]));

		await waitFor(() =>
			expect(
				[...result.current.previews.values()].every((state) => state.status === "loaded"),
			).toBe(true),
		);
		expect([...result.current.previews.keys()]).toStrictEqual(ids);
		expect(requestedIds(calls)).toStrictEqual([ids.slice(0, 10), ids.slice(10)]);
	});

	it("並べ替えや同じ ID での再描画では取得し直さず、増えた ID だけを取得する", async () => {
		const calls = stubFetch(previewRoute());
		const { result, rerender } = renderHook(({ ids }) => usePreviewImages(ids), {
			initialProps: { ids: [ID_A, ID_B] as readonly string[] },
		});
		await waitFor(() => expect(result.current.previews.get(ID_B)?.status).toBe("loaded"));

		rerender({ ids: [ID_B, ID_A] });
		expect([...result.current.previews.keys()]).toStrictEqual([ID_B, ID_A]);
		rerender({ ids: [ID_B, ID_A, ID_C] });
		await waitFor(() => expect(result.current.previews.get(ID_C)?.status).toBe("loaded"));

		expect(requestedIds(calls)).toStrictEqual([[ID_A, ID_B], [ID_C]]);
	});

	it("prime した画像は取得しない(アップロードしたばかりの画像)", async () => {
		const calls = stubFetch(previewRoute());
		const { result, rerender } = renderHook(({ ids }) => usePreviewImages(ids), {
			initialProps: { ids: [] as readonly string[] },
		});

		const image = entryFor(ID_A);
		act(() => {
			result.current.prime(ID_A, image);
		});
		rerender({ ids: [ID_A] });

		expect(result.current.previews.get(ID_A)).toStrictEqual({ status: "loaded", image });
		await act(async () => {
			await tick();
		});
		expect(calls).toStrictEqual([]);
	});

	it("取得に失敗したら error。retry で取得し直す", async () => {
		const calls = stubFetch((call) =>
			calls.length === 1 ? routeError("INTERNAL_ERROR", 500) : previewRoute()(call),
		);
		const { result } = renderHook(() => usePreviewImages([ID_A]));

		await waitFor(() => expect(result.current.previews.get(ID_A)?.status).toBe("error"));
		const state = result.current.previews.get(ID_A);
		expect(codeOf(state?.status === "error" ? state.error : undefined)).toBe("INTERNAL_ERROR");

		act(() => {
			result.current.retry();
		});
		expect(result.current.previews.get(ID_A)).toStrictEqual({ status: "loading" });
		await waitFor(() => expect(result.current.previews.get(ID_A)?.status).toBe("loaded"));
		expect(calls).toHaveLength(2);
	});

	it("1 回分の要求が失敗しても、ほかの要求の結果は使う", async () => {
		const ids = Array.from(
			{ length: 11 },
			(_, index) => `01J8Z3K4M5N6P7Q8R9S0T1V2${String(index).padStart(2, "0")}`,
		);
		stubFetch((call) =>
			(call.body as { ids: string[] }).ids.length === 1
				? routeError("INTERNAL_ERROR", 500)
				: previewRoute()(call),
		);
		const { result } = renderHook(() => usePreviewImages(ids));

		await waitFor(() => expect(result.current.previews.get(ids[10] ?? "")?.status).toBe("error"));
		await waitFor(() => expect(result.current.previews.get(ids[0] ?? "")?.status).toBe("loaded"));
	});

	it("取得の途中で prime された画像は、取得の結果で上書きしない", async () => {
		const { gates } = gatedFetch();
		const { result } = renderHook(() => usePreviewImages([ID_A]));
		await waitFor(() => expect(gates).toHaveLength(1));

		const image = entryFor(ID_B);
		act(() => {
			result.current.prime(ID_A, image);
		});
		await act(async () => {
			gates[0]?.resolve(routeError("INTERNAL_ERROR", 500));
			await tick();
		});

		expect(result.current.previews.get(ID_A)).toStrictEqual({ status: "loaded", image });
	});

	it("アンマウントすると、取得中の要求を中断する", async () => {
		const calls = stubFetch(hangUntilAborted);
		const { unmount } = renderHook(() => usePreviewImages([ID_A]));
		await waitFor(() => expect(calls).toHaveLength(1));

		unmount();

		expect(calls[0]?.init.signal?.aborted).toBe(true);
	});

	it("StrictMode(effect が 2 回動く)でも、取得を終えて表示する(中断した要求をエラーにしない)", async () => {
		// 本物の fetch と同じく、中断されたら signal.reason で reject する
		const calls = stubFetch(
			(call) =>
				new Promise<Response>((resolve, reject) => {
					const { signal } = call.init;
					const timer = setTimeout(() => resolve(previewRoute()(call)), 0);
					signal?.addEventListener(
						"abort",
						() => {
							clearTimeout(timer);
							reject(signal.reason);
						},
						{ once: true },
					);
				}),
		);
		// `wrapper` で <StrictMode> を包むと、初回のマウントで effect が 2 回動かない(React 19.2.4)。
		// ルートを <StrictMode> にする `reactStrictMode` を使う
		const { result } = renderHook(() => usePreviewImages([ID_A]), { reactStrictMode: true });

		await waitFor(() => expect(result.current.previews.get(ID_A)?.status).toBe("loaded"));
		// 1 回目の effect の要求は中断され、2 回目の effect が取得し直す
		expect(calls.map((call) => call.init.signal?.aborted)).toStrictEqual([true, false]);
	});
});

// ---------------------------------------------------------------------------
// 組み合わせ(T27 の使い方)
// ---------------------------------------------------------------------------

describe("useImageUpload と usePreviewImages を組み合わせる", () => {
	it("アップロードした画像を prime すると、参照を値にしてもプレビューを取得しない", async () => {
		const calls = stubFetch(uploaded);
		const dependencies = testPipeline().dependencies;
		const { result, rerender } = renderHook(
			({ ids }) => ({
				upload: useImageUpload({ target: RESOLVED, dependencies }),
				previews: usePreviewImages(ids),
			}),
			{ initialProps: { ids: [] as readonly string[] } },
		);

		let outcome: UploadOutcome | undefined;
		await act(async () => {
			outcome = await result.current.upload.upload(pngFile());
		});
		if (outcome?.status !== "done") throw new Error("upload failed");
		const { image } = outcome;
		act(() => {
			result.current.previews.prime(image.ref.id, image.entry);
		});
		rerender({ ids: [image.ref.id] });

		expect(result.current.previews.previews.get(IMAGE_ID)).toStrictEqual({
			status: "loaded",
			image: image.entry,
		});
		expect(calls.map((call) => call.url)).toStrictEqual([`${PLUGIN_API}/upload`]);
	});
});
