/**
 * T13: 縮小・画質の探索・サムネイル生成(src/client/encode.ts・thumbnail.ts)の単体テスト。
 *
 * jsdom には canvas も createImageBitmap も無いので、エンコーダーを偽物にする。
 * - 偽のエンコーダーは、寸法と画質から決めたバイト数の Blob を返す。先頭 4 バイトに呼び出しの番号(1 から)を入れ、
 *   採用された Blob がどの呼び出しのものかを data URL から確かめる(最後にエンコードし直さないことの確認)。
 * - canvas のエンコーダー(createCanvasWebpEncoder)は、createImageBitmap と canvas を偽物にして、呼び方を確かめる。
 */

import { describe, expect, it, vi, type Mock } from "vitest";

import {
	abortable,
	compressImage,
	createCanvasWebpEncoder,
	edgeSequence,
	fitLongEdge,
	qualityLadder,
	type CanvasEncoderEnvironment,
	type EncoderCanvas,
	type EncoderCanvasContext,
} from "../../src/client/encode";
import { THUMB_MIN_EDGE, THUMB_MIN_QUALITY, createThumbnail } from "../../src/client/thumbnail";
import {
	MAX_QUALITY,
	THUMB_EDGE,
	THUMB_MAX_STORED_BYTES,
	WEBP_MIME_TYPE,
} from "../../src/shared/constants";
import {
	WEBP_DATA_URL_PREFIX,
	decodeWebpDataUrl,
	maxWebpBytesForBudget,
	storedBytesForWebp,
} from "../../src/shared/data-url";
import { Base64ImageError } from "../../src/shared/errors";
import { normalizeFieldOptions } from "../../src/shared/options";
import type {
	CompressOptions,
	CompressProgress,
	ImageSource,
	WebpEncoder,
} from "../../src/shared/pipeline";

// ---------------------------------------------------------------------------
// テスト用の部品
// ---------------------------------------------------------------------------

/** 既定の options(仕様書 13.2) */
const OPTIONS = { maxStoredBytes: 100_000, maxEdge: 1_600, minQuality: 0.6, minEdge: 480 } as const;

/** 保存 100,000 バイトに収まる WebP 本体の上限(74,982 B) */
const LIMIT = maxWebpBytesForBudget(OPTIONS.maxStoredBytes);

/** サムネイルの WebP 本体の上限(5,982 B) */
const THUMB_LIMIT = maxWebpBytesForBudget(THUMB_MAX_STORED_BYTES);

/** 既定の長辺の列(2400px の画像。1600 → 0.8 倍ずつ → 524、次の 419 は minEdge 480 未満) */
const DEFAULT_EDGES = [1600, 1280, 1024, 819, 655, 524];

/** エンコーダーに渡される source(偽のエンコーダーは中身を見ない) */
const SOURCE = { name: "decoded image" } as unknown as CanvasImageSource;

function testImage(width: number, height: number, source = SOURCE): ImageSource {
	return { source, width, height };
}

interface SizeQuery {
	readonly width: number;
	readonly height: number;
	readonly longEdge: number;
	readonly quality: number;
}

/** 寸法と画質から、WebP 本体のバイト数を決める */
type SizeModel = (query: SizeQuery) => number;

interface EncoderCall extends SizeQuery {
	readonly source: CanvasImageSource;
	readonly signal: AbortSignal | undefined;
	/** 呼ばれた時点で届いていた進捗の数 */
	readonly progressCount: number;
}

interface FakeEncoder {
	readonly encoder: WebpEncoder;
	readonly calls: EncoderCall[];
	readonly progress: CompressProgress[];
	readonly onProgress: (progress: CompressProgress) => void;
}

/**
 * 偽のエンコーダー。`sizeOf` が返すバイト数の Blob を返す(type は既定で `image/webp`)。
 * Blob の先頭 4 バイトに呼び出しの番号(1 から)を入れる。
 */
function fakeEncoder(sizeOf: SizeModel, { type = WEBP_MIME_TYPE } = {}): FakeEncoder {
	const calls: EncoderCall[] = [];
	const progress: CompressProgress[] = [];
	const encoder: WebpEncoder = async ({ source, width, height, quality, signal }) => {
		const query = { width, height, longEdge: Math.max(width, height), quality };
		calls.push({ ...query, source, signal, progressCount: progress.length });
		const bytes = new Uint8Array(sizeOf(query));
		new DataView(bytes.buffer).setUint32(0, calls.length, true);
		return new Blob([bytes], { type });
	};
	return { encoder, calls, progress, onProgress: (item) => progress.push(item) };
}

/**
 * 長辺ごとに「収まる最高の画質」を決めたサイズのモデル。画質が 0.01 上がるごとに 100 B 増え、
 * `best[長辺]` の画質でちょうど `limit` になる(収まる)。`best` に無い長辺は、どの画質でも収まらない。
 */
function thresholdModel(best: Readonly<Record<number, number>>, limit = LIMIT): SizeModel {
	return ({ longEdge, quality }) => {
		const top = best[longEdge];
		if (top === undefined) return limit + 10_000;
		return limit + Math.round((quality - top) * 10_000);
	};
}

/** data URL の中身(偽のエンコーダーの Blob)から、何回目の呼び出しの Blob かを読む */
function callNumberOf(dataUrl: string): number {
	const decoded = decodeWebpDataUrl(dataUrl);
	if (!decoded.ok) throw new Error(`not a WebP data URL: ${decoded.reason}`);
	return new DataView(decoded.bytes.buffer, decoded.bytes.byteOffset).getUint32(0, true);
}

/** reject された理由を返す。resolve したらテストを失敗させる */
async function caught(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

function longEdges(calls: readonly SizeQuery[]): number[] {
	return calls.map((call) => call.longEdge);
}

function qualities(calls: readonly SizeQuery[]): number[] {
	return calls.map((call) => call.quality);
}

/** 同期的に例外を投げるエンコーダー(async でない関数の失敗) */
const throwingEncoder: WebpEncoder = () => {
	throw new TypeError("not a function");
};

/** `qualityLadder` の値を配列にする */
function ladderOf(minQuality: number): number[] {
	const ladder = qualityLadder(minQuality);
	return Array.from({ length: ladder.length }, (_, index) => ladder.at(index));
}

/** 0.01 刻みの画質か(`minQuality` 以外に試す値) */
function onQualityGrid(quality: number): boolean {
	return Math.abs(quality * 100 - Math.round(quality * 100)) < 1e-9;
}

function flushTasks(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

// ---------------------------------------------------------------------------
// 画質の探索
// ---------------------------------------------------------------------------

describe("compressImage: 画質の探索", () => {
	it("minQuality → 0.92 → 0.01 刻みの二分探索の順に試し、収まる最高の画質を選ぶ", async () => {
		const fake = fakeEncoder(thresholdModel({ 1600: 0.77 }));

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: fake.encoder,
		});

		expect(qualities(fake.calls)).toEqual([0.6, 0.92, 0.76, 0.84, 0.8, 0.78, 0.77]);
		expect(fake.calls.every((call) => call.width === 1600 && call.height === 1067)).toBe(true);
		expect(result).toMatchObject({
			width: 1600,
			height: 1067,
			quality: 0.77,
			webpBytes: LIMIT,
			storedBytes: 99_999,
			attempts: 7,
		});
		expect(result.dataUrl.startsWith(WEBP_DATA_URL_PREFIX)).toBe(true);
		expect(result.dataUrl).toHaveLength(result.storedBytes);
		expect(callNumberOf(result.dataUrl)).toBe(7);
	});

	it("0.92 で収まれば、2 回で終わる", async () => {
		const fake = fakeEncoder(thresholdModel({ 1600: 0.95 }));

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: fake.encoder,
		});

		expect(qualities(fake.calls)).toEqual([0.6, 0.92]);
		expect(result).toMatchObject({ width: 1600, quality: 0.92, attempts: 2 });
		expect(callNumberOf(result.dataUrl)).toBe(2);
	});

	it("収まった Blob を保持し、最後にエンコードし直さない", async () => {
		// 0.80 で収まり、そのあと 0.82・0.81 で収まらずに探索が終わる
		const fake = fakeEncoder(thresholdModel({ 1600: 0.8 }));

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: fake.encoder,
		});

		expect(qualities(fake.calls)).toEqual([0.6, 0.92, 0.76, 0.84, 0.8, 0.82, 0.81]);
		expect(result.quality).toBe(0.8);
		expect(result.attempts).toBe(7);
		// 採用したのは 5 回目(0.80)の Blob で、8 回目のエンコードは無い
		expect(callNumberOf(result.dataUrl)).toBe(5);
		expect(fake.calls).toHaveLength(7);
	});

	it("画質は必ず minQuality〜0.92 の値を明示して渡す", async () => {
		const fake = fakeEncoder(thresholdModel({ 1024: 0.9 }));

		await compressImage(testImage(4000, 3000), { ...OPTIONS, encoder: fake.encoder });

		expect(fake.calls.length).toBeGreaterThan(3);
		for (const quality of qualities(fake.calls)) {
			expect(quality).toBeTypeOf("number");
			expect(quality).toBeGreaterThanOrEqual(OPTIONS.minQuality);
			expect(quality).toBeLessThanOrEqual(MAX_QUALITY);
			expect(onQualityGrid(quality)).toBe(true);
		}
	});

	it("minQuality が 0.01 刻みでなくても、最初にその値を試し、そのあとは 0.01 刻みで探す", async () => {
		const fake = fakeEncoder(thresholdModel({ 1600: 0.66 }));

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			minQuality: 0.655,
			encoder: fake.encoder,
		});

		expect(qualities(fake.calls)).toEqual([0.655, 0.92, 0.78, 0.71, 0.68, 0.66, 0.67]);
		expect(result.quality).toBe(0.66);
	});

	it("minQuality が 0.92 なら、長辺ごとに 1 回だけ試す", async () => {
		const fake = fakeEncoder(thresholdModel({ 1280: 0.95 }));

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			minQuality: 0.92,
			encoder: fake.encoder,
		});

		expect(fake.calls.map((call) => [call.longEdge, call.quality])).toEqual([
			[1600, 0.92],
			[1280, 0.92],
		]);
		expect(result).toMatchObject({ width: 1280, quality: 0.92, attempts: 2 });
	});

	it("minQuality が 0 でも、0〜0.92 の範囲で探す", async () => {
		const fake = fakeEncoder(thresholdModel({ 1600: 0.33 }));

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			minQuality: 0,
			encoder: fake.encoder,
		});

		expect(qualities(fake.calls).slice(0, 2)).toEqual([0, 0.92]);
		expect(Math.min(...qualities(fake.calls))).toBe(0);
		expect(Math.max(...qualities(fake.calls))).toBe(0.92);
		expect(result.quality).toBe(0.33);
		// 0〜0.92 の 93 通りを、2 + 7 回以内で探す
		expect(result.attempts).toBeLessThanOrEqual(9);
	});

	it("保存サイズの境界: WebP 74,982 B(保存 99,999)は収まり、74,983 B(保存 100,003)は収まらない", async () => {
		const fake = fakeEncoder(({ quality }) => (quality <= 0.7 ? 74_982 : 74_983));

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: fake.encoder,
		});

		expect(result).toMatchObject({ quality: 0.7, webpBytes: 74_982, storedBytes: 99_999 });
		expect(storedBytesForWebp(74_983)).toBe(100_003);
	});

	it("予算は data URL の長さで判定する(maxStoredBytes 100,003 なら 74,983 B も収まる)", async () => {
		const fake = fakeEncoder(() => 74_983);

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			maxStoredBytes: 100_003,
			encoder: fake.encoder,
		});

		expect(result).toMatchObject({ quality: 0.92, storedBytes: 100_003, attempts: 2 });
	});
});

// ---------------------------------------------------------------------------
// 縮小
// ---------------------------------------------------------------------------

describe("compressImage: 縮小", () => {
	it("minQuality で収まらない長辺は 1 回で見切り、0.8 倍ずつ縮めて探す", async () => {
		const fake = fakeEncoder(thresholdModel({ 1024: 0.77 }));

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: fake.encoder,
		});

		expect(fake.calls.map((call) => [call.width, call.height, call.quality])).toEqual([
			[1600, 1067, 0.6],
			[1280, 853, 0.6],
			[1024, 683, 0.6],
			[1024, 683, 0.92],
			[1024, 683, 0.76],
			[1024, 683, 0.84],
			[1024, 683, 0.8],
			[1024, 683, 0.78],
			[1024, 683, 0.77],
		]);
		expect(result).toMatchObject({ width: 1024, height: 683, quality: 0.77, attempts: 9 });
		expect(callNumberOf(result.dataUrl)).toBe(9);
	});

	it("minEdge を下回るまで縮めても収まらなければ COMPRESSION_OVER_BUDGET", async () => {
		const fake = fakeEncoder(thresholdModel({}));

		const error = await caught(
			compressImage(testImage(2400, 1600), { ...OPTIONS, encoder: fake.encoder }),
		);

		expect(error).toBeInstanceOf(Base64ImageError);
		expect(error).toMatchObject({
			code: "COMPRESSION_OVER_BUDGET",
			details: {
				maxStoredBytes: 100_000,
				minEdge: 480,
				minQuality: 0.6,
				lastEdge: 524,
				lastStoredBytes: storedBytesForWebp(LIMIT + 10_000),
				attempts: 6,
			},
		});
		// 各長辺で 1 回ずつ(画質は minQuality)。480px 未満(419px)は試さない
		expect(longEdges(fake.calls)).toEqual(DEFAULT_EDGES);
		expect(qualities(fake.calls)).toEqual(DEFAULT_EDGES.map(() => 0.6));
	});

	it("拡大しない(元の長辺が maxEdge より短ければ、元の大きさから始める)", async () => {
		const fake = fakeEncoder(thresholdModel({ 800: 0.85 }));

		const result = await compressImage(testImage(800, 600), { ...OPTIONS, encoder: fake.encoder });

		expect(fake.calls[0]).toMatchObject({ width: 800, height: 600 });
		expect(result).toMatchObject({ width: 800, height: 600, quality: 0.85 });
	});

	it("縦長の画像は、高さを長辺として縮める", async () => {
		const fake = fakeEncoder(thresholdModel({ 1280: 0.8 }));

		const result = await compressImage(testImage(1600, 2400), {
			...OPTIONS,
			encoder: fake.encoder,
		});

		expect(fake.calls.slice(0, 2).map((call) => [call.width, call.height])).toEqual([
			[1067, 1600],
			[853, 1280],
		]);
		expect(result).toMatchObject({ width: 853, height: 1280, quality: 0.8 });
	});

	it("元の長辺が minEdge より短い画像も、元の大きさで 1 回は探す", async () => {
		const fits = fakeEncoder(thresholdModel({ 300: 0.85 }));
		const tooLarge = fakeEncoder(thresholdModel({}));

		const result = await compressImage(testImage(300, 200), { ...OPTIONS, encoder: fits.encoder });
		const error = await caught(
			compressImage(testImage(300, 200), { ...OPTIONS, encoder: tooLarge.encoder }),
		);

		expect(result).toMatchObject({ width: 300, height: 200, quality: 0.85 });
		expect(error).toMatchObject({ code: "COMPRESSION_OVER_BUDGET", details: { lastEdge: 300 } });
		expect(tooLarge.calls.map((call) => [call.width, call.height, call.quality])).toEqual([
			[300, 200, 0.6],
		]);
	});

	it("maxEdge・minEdge に合わせて、試す長辺の列が変わる", async () => {
		const fake = fakeEncoder(thresholdModel({}));

		const error = await caught(
			compressImage(testImage(2400, 1600), {
				...OPTIONS,
				maxEdge: 1000,
				minEdge: 600,
				encoder: fake.encoder,
			}),
		);

		expect(error).toMatchObject({ code: "COMPRESSION_OVER_BUDGET" });
		expect(longEdges(fake.calls)).toEqual([1000, 800, 640]);
	});

	it("options はサーバーと同じ normalizeFieldOptions で丸める(固定上限 500,000・maxEdge 4,096・画質 0.92)", async () => {
		// 保存 500,003 バイト(WebP 374,983 B)は、丸めずに 900,000 を使うと収まってしまう
		const fake = fakeEncoder(({ longEdge }) => (longEdge >= 3000 ? 374_983 : 374_982));

		const result = await compressImage(testImage(8000, 4000), {
			maxStoredBytes: 900_000,
			maxEdge: 10_000,
			minQuality: 2,
			minEdge: 1,
			encoder: fake.encoder,
		});

		expect(longEdges(fake.calls)).toEqual([4096, 3277, 2622]);
		expect(qualities(fake.calls)).toEqual([0.92, 0.92, 0.92]);
		expect(result).toMatchObject({ width: 2622, height: 1311, quality: 0.92 });
		expect(result.storedBytes).toBeLessThanOrEqual(500_000);
	});
});

// ---------------------------------------------------------------------------
// サイズの逆転(実際のエンコーダーは画質に対して完全には単調でない)
// ---------------------------------------------------------------------------

describe("compressImage: サイズの逆転", () => {
	it("画質を上げてサイズが減る箇所があっても、実際に収まった Blob だけを採用する", async () => {
		// 0.76 までは収まり、0.77 は収まらないが、0.78 はサイズが減って収まる(逆転)
		const sizes: Record<number, number> = { 0.77: LIMIT + 58, 0.78: LIMIT - 20 };
		const fake = fakeEncoder(({ quality }) => {
			const size = sizes[quality];
			if (size !== undefined) return size;
			return quality <= 0.76 ? LIMIT - 100 : LIMIT + 200;
		});

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: fake.encoder,
		});

		expect(qualities(fake.calls)).toEqual([0.6, 0.92, 0.76, 0.84, 0.8, 0.78, 0.79]);
		expect(result.quality).toBe(0.78);
		expect(result.webpBytes).toBe(LIMIT - 20);
		expect(result.storedBytes).toBeLessThanOrEqual(OPTIONS.maxStoredBytes);
		expect(callNumberOf(result.dataUrl)).toBe(6);
	});

	it("逆転で二分探索が真の最高画質を見逃しても、収まった画質の Blob を返す", async () => {
		// 0.76 までと 0.83 だけが収まる。二分探索は 0.83 を試さないので 0.76 になる(T05: 許容してよい)
		const fake = fakeEncoder(({ quality }) =>
			quality <= 0.76 || quality === 0.83 ? LIMIT - 10 : LIMIT + 10,
		);

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: fake.encoder,
		});

		expect(qualities(fake.calls)).toEqual([0.6, 0.92, 0.76, 0.84, 0.8, 0.78, 0.77]);
		expect(result.quality).toBe(0.76);
		expect(callNumberOf(result.dataUrl)).toBe(3);
	});

	it("ランダムなサイズ(逆転を含む)でも、収まらない Blob は採用せず、画質と長辺は範囲内に収まる", async () => {
		const summaries = await runCases(
			Array.from({ length: 200 }, (_, i) => randomCase(i + 1, 0.04)),
		);

		expect(summaries.flatMap((summary) => summary.violations)).toEqual([]);
		// ケースに、収まる・収まらない・縮小する・逆転のある場合が含まれている(テストの前提)
		expect(summaries.filter((summary) => summary.fitted).length).toBeGreaterThan(20);
		expect(summaries.filter((summary) => !summary.fitted).length).toBeGreaterThan(20);
		expect(summaries.filter((summary) => summary.edgesTried > 1).length).toBeGreaterThan(20);
		expect(summaries.filter((summary) => summary.inverted).length).toBeGreaterThan(20);
	});

	it("サイズが単調なら、最初に minQuality で収まる長辺で、収まる最高の画質を選ぶ(全探索と一致する)", async () => {
		const summaries = await runCases(
			Array.from({ length: 200 }, (_, i) => randomCase(i + 1001, 0)),
		);

		expect(summaries.flatMap((summary) => summary.violations)).toEqual([]);
		expect(summaries.filter((summary) => summary.fitted).length).toBeGreaterThan(20);
		expect(summaries.filter((summary) => summary.edgesTried > 1).length).toBeGreaterThan(20);
		expect(summaries.some((summary) => summary.inverted)).toBe(false);
	});
});

interface RandomCase {
	readonly seed: number;
	readonly width: number;
	readonly height: number;
	readonly options: Pick<CompressOptions, "maxStoredBytes" | "maxEdge" | "minQuality" | "minEdge">;
	readonly sizeOf: SizeModel;
	/** サイズが画質と長辺に対して単調か(単調なら全探索の答えと比べる) */
	readonly monotonic: boolean;
}

/**
 * 保存の固定上限 500,000 バイト(WebP 374,982 B)を必ず超えるサイズ。
 * 収まらないサイズは、どれだけ大きくても探索の判断は同じなので、偽の Blob をこの大きさで止める(メモリを使いすぎないため)
 */
const OVERSIZED_BYTES = 400_000;

/** 決まった種から、画像の寸法・options・サイズのモデルを作る。`noise` はサイズの揺れの幅(逆転を作る) */
function randomCase(seed: number, noise: number): RandomCase {
	const random = mulberry32(seed);
	const between = (min: number, max: number): number =>
		min + Math.floor(random() * (max - min + 1));
	const width = between(1, 5000);
	const height = between(1, 5000);
	const maxEdge = between(96, 4096);
	const minEdge = between(96, maxEdge);
	// minQuality は 0.01 刻みの値と、刻みでない値の両方を試す
	const minQuality = random() < 0.5 ? between(0, 92) / 100 : Math.round(random() * 920) / 1000;
	const maxStoredBytes = between(10_000, 500_000);
	const bytesPerPixel = 0.02 + random() * 1.5;
	const sizeOf: SizeModel = ({ width: w, height: h, quality }) => {
		const base = w * h * bytesPerPixel * (0.3 + 2.5 * quality ** 3);
		const jitter =
			noise === 0 ? 0 : (hashUnit(seed, w, h, Math.round(quality * 1000)) * 2 - 1) * noise;
		return Math.min(OVERSIZED_BYTES, Math.max(8, Math.round(base * (1 + jitter))));
	};
	return {
		seed,
		width,
		height,
		options: { maxStoredBytes, maxEdge, minQuality, minEdge },
		sizeOf,
		monotonic: noise === 0,
	};
}

interface CaseSummary {
	/** 守られなかった性質 */
	readonly violations: string[];
	/** 予算に収まったか */
	readonly fitted: boolean;
	/** 試した長辺の数 */
	readonly edgesTried: number;
	/** 最後に試した長辺で、画質を 0.01 上げるとサイズが減る箇所があったか */
	readonly inverted: boolean;
}

/** ケースを 1 件ずつ実行する(大きな Blob を同時に作らないため) */
async function runCases(cases: readonly RandomCase[]): Promise<CaseSummary[]> {
	const summaries: CaseSummary[] = [];
	for (const testCase of cases) {
		// oxlint-disable-next-line no-await-in-loop -- 大きな Blob を同時に作らないよう、1 件ずつ実行する
		summaries.push(await runCase(testCase));
	}
	return summaries;
}

/** 1 つのケースを実行し、守られなかった性質などをまとめて返す */
async function runCase(testCase: RandomCase): Promise<CaseSummary> {
	const { seed, width, height, options, sizeOf } = testCase;
	const fake = fakeEncoder(sizeOf);
	const limits = normalizeFieldOptions(options);
	const maxWebpBytes = maxWebpBytesForBudget(limits.maxStoredBytes);
	const edges = edgeSequence(Math.max(width, height), limits.maxEdge, limits.minEdge);
	const violations: string[] = [];
	const check = (ok: boolean, message: string): void => {
		if (!ok) violations.push(`seed ${seed}: ${message}`);
	};

	let result: Awaited<ReturnType<typeof compressImage>> | undefined;
	let error: unknown;
	try {
		result = await compressImage(testImage(width, height), { ...options, encoder: fake.encoder });
	} catch (caughtError) {
		error = caughtError;
	}

	// 画質は必ず範囲内で、minQuality か 0.01 刻みの値
	for (const call of fake.calls) {
		check(
			call.quality >= limits.minQuality && call.quality <= MAX_QUALITY,
			`quality ${call.quality} is out of range`,
		);
		check(
			call.quality === limits.minQuality || onQualityGrid(call.quality),
			`quality ${call.quality} is not on the 0.01 grid`,
		);
	}
	// 長辺は、長辺の列の順に使い、拡大しない
	const usedEdges = [...new Set(longEdges(fake.calls))];
	check(
		JSON.stringify(usedEdges) === JSON.stringify(edges.slice(0, usedEdges.length)),
		`edges ${JSON.stringify(usedEdges)} do not follow ${JSON.stringify(edges)}`,
	);
	check(
		fake.calls.every((call) => call.longEdge <= Math.max(width, height)),
		"the image was enlarged",
	);
	// 収まらなかった長辺は 1 回(minQuality)だけ。収まった長辺は 2 + ceil(log2(候補の数 - 1)) 回まで
	const ladder = qualityLadder(limits.minQuality);
	const maxAttemptsPerEdge = ladder.length === 1 ? 1 : 2 + Math.ceil(Math.log2(ladder.length - 1));
	for (const edge of usedEdges) {
		const count = fake.calls.filter((call) => call.longEdge === edge).length;
		const isLast = edge === usedEdges.at(-1);
		check(
			isLast && result !== undefined ? count <= maxAttemptsPerEdge : count === 1,
			`${count} attempts at ${edge}px`,
		);
	}

	// 最後に試した長辺で、画質を 0.01 上げるとサイズが減る箇所があるか(逆転を含むケースかどうか)
	const lastEdge = usedEdges.at(-1) ?? 0;
	const lastSize = fitLongEdge(width, height, lastEdge);
	const sizes = Array.from({ length: ladder.length }, (_, index) =>
		sizeOf({ ...lastSize, longEdge: lastEdge, quality: ladder.at(index) }),
	);
	const inverted = sizes.some((size, index) => index > 0 && size < (sizes[index - 1] ?? 0));
	const summary = (fitted: boolean): CaseSummary => ({
		violations,
		fitted,
		edgesTried: usedEdges.length,
		inverted,
	});

	if (result === undefined) {
		check(
			error instanceof Base64ImageError && error.code === "COMPRESSION_OVER_BUDGET",
			`unexpected error ${String(error)}`,
		);
		check(JSON.stringify(usedEdges) === JSON.stringify(edges), "gave up before trying every edge");
		check(
			fake.calls.every((call) => sizeOf(call) > maxWebpBytes),
			"gave up although an attempt fitted",
		);
		if (testCase.monotonic) {
			check(exhaustiveSearch(testCase, edges, maxWebpBytes) === null, "a fitting edge exists");
		}
		return summary(false);
	}

	// 採用した Blob は実際に呼んだエンコードのもので、収まっている。エンコードし直していない
	const adopted = fake.calls[callNumberOf(result.dataUrl) - 1];
	check(adopted !== undefined, "the adopted blob was not produced by the encoder");
	check(
		adopted?.quality === result.quality &&
			adopted.width === result.width &&
			adopted.height === result.height,
		"the result does not describe the adopted blob",
	);
	check(
		adopted !== undefined && sizeOf(adopted) <= maxWebpBytes,
		"the adopted blob is over budget",
	);
	check(result.storedBytes === result.dataUrl.length, "storedBytes is not the data URL length");
	check(
		result.storedBytes <= limits.maxStoredBytes,
		`stored ${result.storedBytes} B is over budget`,
	);
	check(result.attempts === fake.calls.length, "attempts does not match the encoder calls");

	if (testCase.monotonic) {
		const expected = exhaustiveSearch(testCase, edges, maxWebpBytes);
		check(
			expected !== null &&
				expected.width === result.width &&
				expected.height === result.height &&
				expected.quality === result.quality,
			`expected ${JSON.stringify(expected)}, got ${result.width}x${result.height} q${result.quality}`,
		);
	}
	return summary(true);
}

/** 全探索: minQuality で収まる最初の長辺で、収まる最高の画質 */
function exhaustiveSearch(
	testCase: RandomCase,
	edges: readonly number[],
	maxWebpBytes: number,
): { width: number; height: number; quality: number } | null {
	const minQuality = normalizeFieldOptions(testCase.options).minQuality;
	const candidates = [minQuality];
	for (let step = 0; step <= 92; step++) {
		if (step / 100 > minQuality + 1e-6) candidates.push(step / 100);
	}
	for (const edge of edges) {
		const size = fitLongEdge(testCase.width, testCase.height, edge);
		const fitting = candidates.filter(
			(quality) => testCase.sizeOf({ ...size, longEdge: edge, quality }) <= maxWebpBytes,
		);
		if (fitting.includes(minQuality)) return { ...size, quality: Math.max(...fitting) };
	}
	return null;
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/** 値の組から決まる 0〜1 の数(同じ条件なら同じサイズになるエンコーダーをまねる) */
function hashUnit(...values: number[]): number {
	let hash = 0x811c9dc5;
	for (const value of values) {
		hash = Math.imul(hash ^ value, 0x01000193);
		hash ^= hash >>> 13;
	}
	return (hash >>> 0) / 4_294_967_296;
}

// ---------------------------------------------------------------------------
// エラー
// ---------------------------------------------------------------------------

describe("compressImage: エラー", () => {
	it("Blob の type が image/webp でなければ、1 回目で BROWSER_UNSUPPORTED(Safari は PNG を返す)", async () => {
		const png = fakeEncoder(() => 1_000, { type: "image/png" });
		const untyped = fakeEncoder(() => 1_000, { type: "" });

		const pngError = await caught(
			compressImage(testImage(2400, 1600), { ...OPTIONS, encoder: png.encoder }),
		);
		const untypedError = await caught(
			compressImage(testImage(2400, 1600), { ...OPTIONS, encoder: untyped.encoder }),
		);

		expect(pngError).toBeInstanceOf(Base64ImageError);
		expect(pngError).toMatchObject({ code: "BROWSER_UNSUPPORTED", details: { type: "image/png" } });
		expect(png.calls).toHaveLength(1);
		expect(untypedError).toMatchObject({ code: "BROWSER_UNSUPPORTED", details: { type: "" } });
	});

	it("エンコーダーが失敗したら ENCODE_FAILED(元のエラーは cause)", async () => {
		const failure = new Error("encoder crashed");
		const rejecting: WebpEncoder = () => Promise.reject(failure);

		const rejected = await caught(
			compressImage(testImage(2400, 1600), { ...OPTIONS, encoder: rejecting }),
		);
		const thrown = await caught(
			compressImage(testImage(2400, 1600), { ...OPTIONS, encoder: throwingEncoder }),
		);

		expect(rejected).toBeInstanceOf(Base64ImageError);
		expect(rejected).toMatchObject({ code: "ENCODE_FAILED", cause: failure });
		expect(thrown).toMatchObject({ code: "ENCODE_FAILED", cause: expect.any(TypeError) });
	});

	it("エンコーダーが Base64ImageError で失敗したら、そのまま reject する", async () => {
		const failure = new Base64ImageError("BROWSER_UNSUPPORTED");
		const encoder: WebpEncoder = () => Promise.reject(failure);

		const error = await caught(compressImage(testImage(2400, 1600), { ...OPTIONS, encoder }));

		expect(error).toBe(failure);
	});

	it("encoder を省略すると canvas のエンコーダーを使う(canvas の無い jsdom では ENCODE_FAILED)", async () => {
		const error = await caught(compressImage(testImage(2400, 1600), { ...OPTIONS }));

		expect(error).toBeInstanceOf(Base64ImageError);
		expect(error).toMatchObject({ code: "ENCODE_FAILED" });
	});

	it("画像の寸法が正の整数でなければ、エンコーダーを呼ばずに ENCODE_FAILED", async () => {
		const fake = fakeEncoder(() => 1_000);

		const zero = await caught(
			compressImage(testImage(0, 100), { ...OPTIONS, encoder: fake.encoder }),
		);
		const fractional = await caught(
			compressImage(testImage(100.5, 100), { ...OPTIONS, encoder: fake.encoder }),
		);

		expect(zero).toMatchObject({ code: "ENCODE_FAILED" });
		expect(fractional).toMatchObject({ code: "ENCODE_FAILED" });
		expect(fake.calls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// キャンセル
// ---------------------------------------------------------------------------

describe("compressImage: キャンセル", () => {
	it("始める前に中断されていたら、何もせずに signal.reason で reject する(寸法の確認より先)", async () => {
		const fake = fakeEncoder(thresholdModel({ 1600: 0.8 }));
		const controller = new AbortController();
		const reason = new Error("cancelled by the editor");
		controller.abort(reason);
		const options = {
			...OPTIONS,
			encoder: fake.encoder,
			signal: controller.signal,
			onProgress: fake.onProgress,
		};

		const error = await caught(compressImage(testImage(2400, 1600), options));
		const invalidSizeError = await caught(compressImage(testImage(0, 0), options));

		expect(error).toBe(reason);
		expect(invalidSizeError).toBe(reason);
		expect(fake.calls).toHaveLength(0);
		expect(fake.progress).toHaveLength(0);
	});

	it("エンコード結果を見ている間に中断されたら、次の進捗を知らせず、次のエンコードもしない", async () => {
		const controller = new AbortController();
		const reason = new Error("cancelled");
		const fake = fakeEncoder(thresholdModel({ 1600: 0.77 }));
		const encoder: WebpEncoder = async (request) => {
			const blob = await fake.encoder(request);
			if (fake.calls.length !== 2) return blob;
			// 2 回目の Blob のサイズを読んだところで中断される
			const { size } = blob;
			return Object.defineProperty(blob, "size", {
				get: () => {
					controller.abort(reason);
					return size;
				},
			});
		};

		const error = await caught(
			compressImage(testImage(2400, 1600), {
				...OPTIONS,
				encoder,
				signal: controller.signal,
				onProgress: fake.onProgress,
			}),
		);

		expect(error).toBe(reason);
		expect(fake.calls).toHaveLength(2);
		expect(fake.progress.map((item) => item.attempt)).toEqual([1, 2]);
	});

	it("エンコードの途中で中断されたら、エンコーダーの完了を待たずに reject し、次を試さない", async () => {
		const controller = new AbortController();
		const reason = new Error("cancelled");
		const fake = fakeEncoder(thresholdModel({ 1600: 0.77 }));
		const started = Promise.withResolvers<void>();
		const hanging: WebpEncoder = (request) => {
			if (fake.calls.length === 2) {
				// 3 回目は終わらない(止められない toBlob をまねる)
				started.resolve();
				return new Promise<Blob>(() => {});
			}
			return fake.encoder(request);
		};

		const compressing = compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: hanging,
			signal: controller.signal,
		});
		await started.promise;
		controller.abort(reason);

		await expect(compressing).rejects.toBe(reason);
		expect(fake.calls).toHaveLength(2);
	});

	it("エンコーダーが中断を無視して Blob を返しても、その Blob は使わずに reject する", async () => {
		const controller = new AbortController();
		const reason = new Error("cancelled");
		const fake = fakeEncoder(thresholdModel({ 1600: 0.77 }));
		const encoder: WebpEncoder = async (request) => {
			const blob = await fake.encoder(request);
			if (fake.calls.length === 4) controller.abort(reason);
			return blob;
		};

		const error = await caught(
			compressImage(testImage(2400, 1600), { ...OPTIONS, encoder, signal: controller.signal }),
		);

		expect(error).toBe(reason);
		expect(fake.calls).toHaveLength(4);
	});

	it("エンコーダーに signal を渡す", async () => {
		const controller = new AbortController();
		const fake = fakeEncoder(thresholdModel({ 1600: 0.95 }));

		await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: fake.encoder,
			signal: controller.signal,
		});

		expect(fake.calls.every((call) => call.signal === controller.signal)).toBe(true);
	});

	it("次の長辺に移るとき(onProgress の中)で中断されたら、エンコーダーを呼ばない", async () => {
		const controller = new AbortController();
		const reason = new Error("cancelled");
		const fake = fakeEncoder(thresholdModel({ 1024: 0.8 }));

		const error = await caught(
			compressImage(testImage(2400, 1600), {
				...OPTIONS,
				encoder: fake.encoder,
				signal: controller.signal,
				onProgress: (progress) => {
					fake.onProgress(progress);
					if (progress.width === 1280) controller.abort(reason);
				},
			}),
		);

		expect(error).toBe(reason);
		expect(longEdges(fake.calls)).toEqual([1600]);
		expect(fake.progress.map((item) => item.width)).toEqual([1600, 1280]);
	});

	it("data URL を作る段階で中断されたら、読み込みの完了を待たずに reject する", async () => {
		const controller = new AbortController();
		const reason = new Error("cancelled");
		const fake = fakeEncoder(thresholdModel({ 1600: 0.95 }));
		const encoder: WebpEncoder = async (request) => {
			const blob = await fake.encoder(request);
			// 読み込みは終わらず、その間に中断される
			return Object.assign(blob, {
				arrayBuffer: () => {
					setTimeout(() => {
						controller.abort(reason);
					}, 0);
					return new Promise<ArrayBuffer>(() => {});
				},
			});
		};

		const error = await caught(
			compressImage(testImage(2400, 1600), { ...OPTIONS, encoder, signal: controller.signal }),
		);

		expect(error).toBe(reason);
		expect(fake.calls).toHaveLength(2);
	});

	it("理由を指定せずに中断したら、AbortError で reject する", async () => {
		const controller = new AbortController();
		controller.abort();
		const fake = fakeEncoder(thresholdModel({ 1600: 0.8 }));

		const error = await caught(
			compressImage(testImage(2400, 1600), {
				...OPTIONS,
				encoder: fake.encoder,
				signal: controller.signal,
			}),
		);

		expect(error).toBe(controller.signal.reason);
		expect(error).toMatchObject({ name: "AbortError" });
	});
});

// ---------------------------------------------------------------------------
// 進捗
// ---------------------------------------------------------------------------

describe("compressImage: 進捗", () => {
	it("エンコードの直前に、そのエンコードの寸法・画質・回数を知らせる", async () => {
		const fake = fakeEncoder(thresholdModel({ 1280: 0.77 }));

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: fake.encoder,
			onProgress: fake.onProgress,
		});

		expect(fake.progress).toEqual(
			fake.calls.map((call, index) => ({
				width: call.width,
				height: call.height,
				quality: call.quality,
				attempt: index + 1,
			})),
		);
		// エンコーダーが呼ばれた時点で、そのエンコードの進捗が届いている
		expect(fake.calls.map((call) => call.progressCount)).toEqual(
			fake.calls.map((_, index) => index + 1),
		);
		expect(fake.progress.at(-1)).toEqual({
			width: 1280,
			height: 853,
			quality: 0.77,
			attempt: 8,
		});
		expect(result.attempts).toBe(8);
	});
});

// ---------------------------------------------------------------------------
// 純粋な部品
// ---------------------------------------------------------------------------

describe("edgeSequence / fitLongEdge / qualityLadder", () => {
	it("長辺は min(maxEdge, 元の長辺) から 0.8 倍して四捨五入し、minEdge 以上のあいだ続ける", () => {
		expect(edgeSequence(2400, 1600, 480)).toEqual(DEFAULT_EDGES);
		expect(edgeSequence(1600, 1600, 1600)).toEqual([1600]);
		// ちょうど minEdge になる長辺は試す
		expect(edgeSequence(2000, 1000, 640)).toEqual([1000, 800, 640]);
		expect(edgeSequence(2000, 1000, 641)).toEqual([1000, 800]);
		expect(edgeSequence(300, 1600, 480)).toEqual([300]);
		expect(edgeSequence(4096, 4096, 96)).toEqual([
			4096, 3277, 2622, 2098, 1678, 1342, 1074, 859, 687, 550, 440, 352, 282, 226, 181, 145, 116,
		]);
		// 小さい長辺でも、必ず 1px 以上縮めて終わる
		expect(edgeSequence(10, 10, 1)).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
	});

	it("縦横比を保って長辺を合わせ、短辺は四捨五入して 1px 以上にする", () => {
		expect(fitLongEdge(2400, 1600, 1600)).toEqual({ width: 1600, height: 1067 });
		expect(fitLongEdge(1600, 2400, 1600)).toEqual({ width: 1067, height: 1600 });
		expect(fitLongEdge(1000, 1000, 512)).toEqual({ width: 512, height: 512 });
		expect(fitLongEdge(1200, 800, 1200)).toEqual({ width: 1200, height: 800 });
		expect(fitLongEdge(16_383, 1, 96)).toEqual({ width: 96, height: 1 });
		expect(fitLongEdge(1, 16_383, 96)).toEqual({ width: 1, height: 96 });
	});

	it("画質の列は minQuality と、それより大きい 0.01 刻みの値(0.92 まで)", () => {
		expect(ladderOf(0.6)).toHaveLength(33);
		expect(ladderOf(0.6).slice(0, 3)).toEqual([0.6, 0.61, 0.62]);
		expect(ladderOf(0.6).at(-1)).toBe(0.92);
		expect(ladderOf(0)).toHaveLength(93);
		expect(ladderOf(0.92)).toEqual([0.92]);
		expect(ladderOf(0.915)).toEqual([0.915, 0.92]);
		expect(ladderOf(0.655).slice(0, 3)).toEqual([0.655, 0.66, 0.67]);
		// 浮動小数点の誤差があっても、minQuality と同じ画質を 2 回試さない
		expect(ladderOf(0.1 + 0.2).slice(0, 2)).toEqual([0.1 + 0.2, 0.31]);
		expect(ladderOf(0.7 - 1e-12).slice(0, 2)).toEqual([0.7 - 1e-12, 0.71]);
	});
});

// ---------------------------------------------------------------------------
// サムネイル
// ---------------------------------------------------------------------------

describe("createThumbnail", () => {
	it("長辺 96px にして、data URL の長さ 8,000 バイト以下で最高の画質を選ぶ", async () => {
		const fake = fakeEncoder(({ quality }) => Math.round(1_000 + quality * 2_000));

		const result = await createThumbnail(testImage(2400, 1600), { encoder: fake.encoder });

		expect(fake.calls.map((call) => [call.width, call.height, call.quality])).toEqual([
			[96, 64, THUMB_MIN_QUALITY],
			[96, 64, 0.92],
		]);
		expect(result).toMatchObject({ width: 96, height: 64 });
		expect(result.dataUrl.startsWith(WEBP_DATA_URL_PREFIX)).toBe(true);
		expect(result.storedBytes).toBe(result.dataUrl.length);
		expect(result.storedBytes).toBeLessThanOrEqual(THUMB_MAX_STORED_BYTES);
		expect(callNumberOf(result.dataUrl)).toBe(2);
	});

	it("境界: WebP 5,982 B(保存 7,999)は収まり、5,983 B(保存 8,003)は収まらない", async () => {
		const fake = fakeEncoder(({ quality }) => (quality <= 0.8 ? THUMB_LIMIT : THUMB_LIMIT + 1));

		const result = await createThumbnail(testImage(2400, 1600), { encoder: fake.encoder });

		expect(THUMB_LIMIT).toBe(5_982);
		expect(result.storedBytes).toBe(7_999);
		expect(fake.calls[callNumberOf(result.dataUrl) - 1]?.quality).toBe(0.8);
		expect(storedBytesForWebp(THUMB_LIMIT + 1)).toBe(8_003);
	});

	it("縦長の画像は高さを 96px にし、96px より小さい画像は拡大しない", async () => {
		const portrait = fakeEncoder(() => 2_000);
		const small = fakeEncoder(() => 500);

		const portraitResult = await createThumbnail(testImage(1600, 2400), {
			encoder: portrait.encoder,
		});
		const smallResult = await createThumbnail(testImage(40, 30), { encoder: small.encoder });

		expect(portraitResult).toMatchObject({ width: 64, height: THUMB_EDGE });
		expect(smallResult).toMatchObject({ width: 40, height: 30 });
		expect(small.calls[0]).toMatchObject({ width: 40, height: 30 });
	});

	it("96px の画質 0.60 でも収まらなければ 0.8 倍ずつ縮め、収まった大きさで作る", async () => {
		const fake = fakeEncoder(thresholdModel({ 62: 0.7 }, THUMB_LIMIT));

		const result = await createThumbnail(testImage(2400, 1600), { encoder: fake.encoder });

		expect([...new Set(longEdges(fake.calls))]).toEqual([96, 77, 62]);
		expect(result).toMatchObject({ width: 62, height: 41 });
		expect(fake.calls[callNumberOf(result.dataUrl) - 1]?.quality).toBe(0.7);
	});

	it("48px を下回るまで縮めても収まらなければ THUMB_OVER_BUDGET", async () => {
		const fake = fakeEncoder(thresholdModel({}, THUMB_LIMIT));

		const error = await caught(createThumbnail(testImage(2400, 1600), { encoder: fake.encoder }));

		expect(THUMB_MIN_EDGE).toBe(48);
		expect(error).toBeInstanceOf(Base64ImageError);
		expect(error).toMatchObject({
			code: "THUMB_OVER_BUDGET",
			details: { maxStoredBytes: THUMB_MAX_STORED_BYTES, lastEdge: 50, attempts: 4 },
		});
		expect(longEdges(fake.calls)).toEqual([96, 77, 62, 50]);
		expect(qualities(fake.calls)).toEqual([0.6, 0.6, 0.6, 0.6]);
	});

	it("画質は 0.60〜0.92 の値を明示して渡す", async () => {
		const fake = fakeEncoder(thresholdModel({ 96: 0.83 }, THUMB_LIMIT));

		await createThumbnail(testImage(2400, 1600), { encoder: fake.encoder });

		expect(qualities(fake.calls)).toEqual([0.6, 0.92, 0.76, 0.84, 0.8, 0.82, 0.83]);
	});

	it("Blob の type が image/webp でなければ BROWSER_UNSUPPORTED", async () => {
		const fake = fakeEncoder(() => 1_000, { type: "image/png" });

		const error = await caught(createThumbnail(testImage(2400, 1600), { encoder: fake.encoder }));

		expect(error).toMatchObject({ code: "BROWSER_UNSUPPORTED" });
	});

	it("中断されたら signal.reason で reject する(始める前・エンコードの途中)", async () => {
		const before = new AbortController();
		const during = new AbortController();
		const reason = new Error("cancelled");
		before.abort(reason);
		const fake = fakeEncoder(() => 1_000);
		const aborting: WebpEncoder = async (request) => {
			during.abort(reason);
			return fake.encoder(request);
		};

		const beforeError = await caught(
			createThumbnail(testImage(2400, 1600), { encoder: fake.encoder, signal: before.signal }),
		);
		// 始める前に中断されていれば、寸法の確認より先に中断を返す
		const invalidSizeError = await caught(
			createThumbnail(testImage(0, 0), { encoder: fake.encoder, signal: before.signal }),
		);
		const duringError = await caught(
			createThumbnail(testImage(2400, 1600), { encoder: aborting, signal: during.signal }),
		);

		expect(beforeError).toBe(reason);
		expect(invalidSizeError).toBe(reason);
		expect(duringError).toBe(reason);
		expect(fake.calls).toHaveLength(1);
	});

	it("encoder を省略すると canvas のエンコーダーを使う(canvas の無い jsdom では ENCODE_FAILED)", async () => {
		const error = await caught(createThumbnail(testImage(2400, 1600)));

		expect(error).toMatchObject({ code: "ENCODE_FAILED" });
	});
});

// ---------------------------------------------------------------------------
// canvas のエンコーダー
// ---------------------------------------------------------------------------

interface FakeBitmap {
	readonly width: number;
	readonly height: number;
	readonly close: Mock<() => void>;
}

function fakeBitmap(width: number, height: number): FakeBitmap {
	return { width, height, close: vi.fn<() => void>() };
}

type CreateImageBitmap = (
	source: ImageBitmapSource,
	options?: ImageBitmapOptions,
) => Promise<ImageBitmap>;

/**
 * createImageBitmap と canvas の偽物。toBlob は、canvas の寸法と画質から `sizeOf` で決めたバイト数の Blob を、
 * 次のタスクで返す(`type` を指定すると、要求された type の代わりにそれを使う)。
 */
function fakeCanvasEnvironment(sizeOf: SizeModel = () => 1_000, { type }: { type?: string } = {}) {
	const bitmaps: FakeBitmap[] = [];
	const createImageBitmap = vi.fn<CreateImageBitmap>(async (_source, options = {}) => {
		const bitmap = fakeBitmap(options.resizeWidth ?? 0, options.resizeHeight ?? 0);
		bitmaps.push(bitmap);
		return bitmap as unknown as ImageBitmap;
	});
	const drawImage = vi.fn<EncoderCanvasContext["drawImage"]>();
	/** toBlob の呼び出し: [type, quality, canvas の幅, canvas の高さ] */
	const toBlobCalls: [string | undefined, unknown, number, number][] = [];
	const createCanvas = vi.fn<() => EncoderCanvas>(() => {
		const canvas: EncoderCanvas = {
			width: 300,
			height: 150,
			getContext: () => ({ drawImage }),
			toBlob: (callback, requestedType, quality) => {
				toBlobCalls.push([requestedType, quality, canvas.width, canvas.height]);
				const size = sizeOf({
					width: canvas.width,
					height: canvas.height,
					longEdge: Math.max(canvas.width, canvas.height),
					quality: Number(quality),
				});
				setTimeout(() => {
					callback(new Blob([new Uint8Array(size)], { type: type ?? requestedType }));
				}, 0);
			},
		};
		return canvas;
	});
	const environment = { createImageBitmap, createCanvas } satisfies CanvasEncoderEnvironment;
	return { environment, bitmaps, drawImage, toBlobCalls, createImageBitmap, createCanvas };
}

describe("createCanvasWebpEncoder", () => {
	it("createImageBitmap の resizeQuality: high で縮小し、同じ大きさの canvas に 1:1 で描いて toBlob する", async () => {
		const fake = fakeCanvasEnvironment();
		const encoder = createCanvasWebpEncoder(fake.environment);

		const blob = await encoder({ source: SOURCE, width: 1600, height: 1067, quality: 0.77 });

		expect(fake.createImageBitmap).toHaveBeenCalledExactlyOnceWith(SOURCE, {
			resizeWidth: 1600,
			resizeHeight: 1067,
			resizeQuality: "high",
		});
		const [resized] = fake.bitmaps;
		expect(fake.drawImage).toHaveBeenCalledExactlyOnceWith(resized, 0, 0);
		expect(fake.toBlobCalls).toEqual([[WEBP_MIME_TYPE, 0.77, 1600, 1067]]);
		// 縮小した ImageBitmap は、描いたらすぐに閉じる
		expect(resized?.close).toHaveBeenCalledOnce();
		expect(blob.type).toBe(WEBP_MIME_TYPE);
	});

	it("同じ画像・同じ寸法なら縮小を省き、画質だけを変えて toBlob する", async () => {
		const fake = fakeCanvasEnvironment();
		const encoder = createCanvasWebpEncoder(fake.environment);
		const other = { name: "another image" } as unknown as CanvasImageSource;

		await encoder({ source: SOURCE, width: 1600, height: 1067, quality: 0.6 });
		await encoder({ source: SOURCE, width: 1600, height: 1067, quality: 0.92 });
		await encoder({ source: SOURCE, width: 1600, height: 1067, quality: 0.76 });
		await encoder({ source: SOURCE, width: 1280, height: 853, quality: 0.6 });
		await encoder({ source: other, width: 1280, height: 853, quality: 0.6 });

		expect(fake.createImageBitmap.mock.calls.map(([source, options]) => [source, options])).toEqual(
			[
				[SOURCE, { resizeWidth: 1600, resizeHeight: 1067, resizeQuality: "high" }],
				[SOURCE, { resizeWidth: 1280, resizeHeight: 853, resizeQuality: "high" }],
				[other, { resizeWidth: 1280, resizeHeight: 853, resizeQuality: "high" }],
			],
		);
		expect(fake.toBlobCalls).toEqual([
			[WEBP_MIME_TYPE, 0.6, 1600, 1067],
			[WEBP_MIME_TYPE, 0.92, 1600, 1067],
			[WEBP_MIME_TYPE, 0.76, 1600, 1067],
			[WEBP_MIME_TYPE, 0.6, 1280, 853],
			[WEBP_MIME_TYPE, 0.6, 1280, 853],
		]);
		expect(fake.createCanvas).toHaveBeenCalledOnce();
		expect(fake.bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
	});

	it("compressImage と組み合わせると、長辺ごとに 1 回だけ縮小し、エンコードごとに toBlob する", async () => {
		const fake = fakeCanvasEnvironment(thresholdModel({ 1024: 0.77 }));

		const result = await compressImage(testImage(2400, 1600), {
			...OPTIONS,
			encoder: createCanvasWebpEncoder(fake.environment),
		});

		expect(result).toMatchObject({ width: 1024, height: 683, quality: 0.77, attempts: 9 });
		expect(fake.createImageBitmap.mock.calls.map(([, options]) => options?.resizeWidth)).toEqual([
			1600, 1280, 1024,
		]);
		expect(fake.toBlobCalls).toHaveLength(9);
		expect(fake.toBlobCalls.every(([type]) => type === WEBP_MIME_TYPE)).toBe(true);
	});

	it("toBlob が PNG を返すブラウザ(Safari)では、compressImage が BROWSER_UNSUPPORTED にする", async () => {
		const fake = fakeCanvasEnvironment(() => 1_000, { type: "image/png" });

		const error = await caught(
			compressImage(testImage(2400, 1600), {
				...OPTIONS,
				encoder: createCanvasWebpEncoder(fake.environment),
			}),
		);

		expect(error).toMatchObject({ code: "BROWSER_UNSUPPORTED", details: { type: "image/png" } });
		expect(fake.toBlobCalls).toHaveLength(1);
	});

	it("toBlob が null を返したら ENCODE_FAILED", async () => {
		const fake = fakeCanvasEnvironment();
		const canvas: EncoderCanvas = {
			width: 0,
			height: 0,
			getContext: () => ({ drawImage: fake.drawImage }),
			toBlob: (callback) => {
				callback(null);
			},
		};
		const encoder = createCanvasWebpEncoder({ ...fake.environment, createCanvas: () => canvas });

		const error = await caught(encoder({ source: SOURCE, width: 10, height: 10, quality: 0.8 }));

		expect(error).toBeInstanceOf(Base64ImageError);
		expect(error).toMatchObject({ code: "ENCODE_FAILED" });
	});

	it("2D コンテキストが無ければ ENCODE_FAILED にし、縮小した ImageBitmap は閉じる", async () => {
		const fake = fakeCanvasEnvironment();
		const canvas: EncoderCanvas = {
			width: 0,
			height: 0,
			getContext: () => null,
			toBlob: vi.fn<EncoderCanvas["toBlob"]>(),
		};
		const encoder = createCanvasWebpEncoder({ ...fake.environment, createCanvas: () => canvas });

		const error = await caught(encoder({ source: SOURCE, width: 10, height: 10, quality: 0.8 }));

		expect(error).toMatchObject({ code: "ENCODE_FAILED" });
		expect(fake.bitmaps[0]?.close).toHaveBeenCalledOnce();
		expect(canvas.toBlob).not.toHaveBeenCalled();
	});

	it("createImageBitmap が失敗したら、compressImage は ENCODE_FAILED にする", async () => {
		const failure = new DOMException("The source image could not be decoded.", "InvalidStateError");
		const encoder = createCanvasWebpEncoder({
			createImageBitmap: () => Promise.reject(failure),
			createCanvas: fakeCanvasEnvironment().environment.createCanvas,
		});

		const error = await caught(compressImage(testImage(2400, 1600), { ...OPTIONS, encoder }));

		expect(error).toMatchObject({ code: "ENCODE_FAILED", cause: failure });
	});

	it("画質が 0〜1 の数でなければ RangeError(省略・範囲外でブラウザの既定値にさせない)", async () => {
		const fake = fakeCanvasEnvironment();
		const encoder = createCanvasWebpEncoder(fake.environment);

		for (const quality of [Number.NaN, -0.01, 1.01, Number.POSITIVE_INFINITY]) {
			// oxlint-disable-next-line no-await-in-loop -- 1 つずつ確かめる
			await expect(encoder({ source: SOURCE, width: 10, height: 10, quality })).rejects.toThrow(
				RangeError,
			);
		}
		expect(fake.createImageBitmap).not.toHaveBeenCalled();
		expect(fake.toBlobCalls).toEqual([]);
	});

	it("始める前に中断されていたら、縮小を始めずに signal.reason で reject する", async () => {
		const fake = fakeCanvasEnvironment();
		const encoder = createCanvasWebpEncoder(fake.environment);
		const controller = new AbortController();
		const reason = new Error("cancelled");
		controller.abort(reason);

		const error = await caught(
			encoder({ source: SOURCE, width: 100, height: 50, quality: 0.8, signal: controller.signal }),
		);

		expect(error).toBe(reason);
		expect(fake.createImageBitmap).not.toHaveBeenCalled();
		expect(fake.toBlobCalls).toEqual([]);
	});

	it("縮小の途中で中断されたら完了を待たずに reject し、あとで届いた ImageBitmap を閉じる", async () => {
		const fake = fakeCanvasEnvironment();
		const pending = Promise.withResolvers<ImageBitmap>();
		const encoder = createCanvasWebpEncoder({
			...fake.environment,
			createImageBitmap: () => pending.promise,
		});
		const controller = new AbortController();
		const reason = new Error("cancelled");

		const encoding = encoder({
			source: SOURCE,
			width: 100,
			height: 50,
			quality: 0.8,
			signal: controller.signal,
		});
		controller.abort(reason);
		await expect(encoding).rejects.toBe(reason);
		const late = fakeBitmap(100, 50);
		pending.resolve(late as unknown as ImageBitmap);
		await flushTasks();

		expect(late.close).toHaveBeenCalledOnce();
		expect(fake.drawImage).not.toHaveBeenCalled();
		expect(fake.toBlobCalls).toEqual([]);
	});

	it("中断されて描けなかったときは、次の呼び出しで縮小し直す", async () => {
		const fake = fakeCanvasEnvironment();
		const encoder = createCanvasWebpEncoder(fake.environment);
		const controller = new AbortController();
		const request = { source: SOURCE, width: 100, height: 50, quality: 0.8 };

		const aborted = encoder({ ...request, signal: controller.signal });
		controller.abort();
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		await encoder(request);

		expect(fake.createImageBitmap).toHaveBeenCalledTimes(2);
		expect(fake.toBlobCalls).toEqual([[WEBP_MIME_TYPE, 0.8, 100, 50]]);
	});

	it("エンコードの途中で中断されたら、toBlob の完了を待たずに reject する", async () => {
		const fake = fakeCanvasEnvironment();
		const canvas: EncoderCanvas = {
			width: 0,
			height: 0,
			getContext: () => ({ drawImage: fake.drawImage }),
			// toBlob は止められず、ここでは終わらない
			toBlob: vi.fn<EncoderCanvas["toBlob"]>(),
		};
		const encoder = createCanvasWebpEncoder({ ...fake.environment, createCanvas: () => canvas });
		const controller = new AbortController();
		const reason = new Error("cancelled");

		const encoding = encoder({
			source: SOURCE,
			width: 100,
			height: 50,
			quality: 0.8,
			signal: controller.signal,
		});
		await vi.waitFor(() => {
			expect(canvas.toBlob).toHaveBeenCalledOnce();
		});
		controller.abort(reason);

		await expect(encoding).rejects.toBe(reason);
	});
});

describe("abortable", () => {
	it("signal が無ければ promise をそのまま返す", async () => {
		const promise = Promise.resolve(1);

		expect(abortable(promise, undefined)).toBe(promise);
		await expect(abortable(promise, undefined)).resolves.toBe(1);
	});

	it("中断されていなければ promise の結果を返す(値も失敗も)", async () => {
		const signal = new AbortController().signal;
		const failure = new Error("failed");

		await expect(abortable(Promise.resolve("value"), signal)).resolves.toBe("value");
		await expect(abortable(Promise.reject(failure), signal)).rejects.toBe(failure);
	});

	it("すでに中断されていたら signal.reason で reject し、あとで届いた値は discard に渡す", async () => {
		const controller = new AbortController();
		const reason = new Error("cancelled");
		controller.abort(reason);
		const discard = vi.fn<(value: string) => void>();

		await expect(abortable(Promise.resolve("late"), controller.signal, discard)).rejects.toBe(
			reason,
		);
		await flushTasks();

		expect(discard).toHaveBeenCalledExactlyOnceWith("late");
	});

	it("中断のあとで promise が失敗しても、未処理の reject にしない", async () => {
		const controller = new AbortController();
		const reason = new Error("cancelled");
		const pending = Promise.withResolvers<string>();
		const discard = vi.fn<(value: string) => void>();

		const wrapped = abortable(pending.promise, controller.signal, discard);
		controller.abort(reason);
		pending.reject(new Error("late failure"));

		await expect(wrapped).rejects.toBe(reason);
		await flushTasks();
		expect(discard).not.toHaveBeenCalled();
	});
});
