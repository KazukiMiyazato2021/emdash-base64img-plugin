/**
 * 本体の画像の縮小・画質の探索・WebP へのエンコード(仕様書 6.1〜6.3)。
 *
 * - `compressImage`: 長辺を `maxEdge` 以下に縮め、data URL の長さが `maxStoredBytes` 以下に収まる最高の画質を探す。
 * - `searchWithinBudget`: 探索と縮小の判断。エンコーダーを受け取る純粋なロジックで、サムネイル(thumbnail.ts)も使う。
 * - `createCanvasWebpEncoder`: ブラウザに依存する部分(`createImageBitmap` での縮小と canvas の `toBlob`)。
 *   jsdom には canvas も `createImageBitmap` も無いので、テストでは `WebpEncoder` を偽物に差し替える。
 *
 * 縮小の方法と探索の順番は、T05 の測定で決めた(docs/canvas-webp-encoding.md の「T13 への申し送り」)。
 */

import { MAX_QUALITY, SHRINK_FACTOR, WEBP_MIME_TYPE } from "../shared/constants";
import { maxWebpBytesForBudget, storedBytesForWebp, toWebpDataUrl } from "../shared/data-url";
import { Base64ImageError, isBase64ImageError } from "../shared/errors";
import { normalizeFieldOptions } from "../shared/options";
import type {
	CompressImage,
	CompressProgress,
	EncodeRequest,
	ImageSource,
	WebpEncoder,
} from "../shared/pipeline";

// ---------------------------------------------------------------------------
// 本体の圧縮(仕様書 6.3)
// ---------------------------------------------------------------------------

/**
 * 長辺を `maxEdge` 以下に縮め(拡大はしない)、data URL の長さが `maxStoredBytes` 以下に収まる最高の画質を探す。
 *
 * - options は `normalizeFieldOptions` で丸めてから使う。サーバーの検証と同じ上限にするため。
 * - `encoder` を省略すると、canvas のエンコーダー(`createCanvasWebpEncoder`)を呼び出しごとに作って使う。
 * - `onProgress` は、エンコードの直前に毎回呼ぶ(画面の「圧縮中… 1280px / 画質 0.74」)。
 * - 探索中に収まった Blob をそのまま data URL にする。最後にエンコードし直さない。
 * - 失敗したら `Base64ImageError` で reject する: `minEdge` まで縮めても収まらない → `COMPRESSION_OVER_BUDGET`、
 *   Blob の type が `image/webp` でない(Safari)→ `BROWSER_UNSUPPORTED`、エンコーダーの失敗 → `ENCODE_FAILED`。
 * - `signal` が中断されたら、次のエンコードを始めずに `signal.reason` で reject する。縮小・エンコード・data URL の
 *   読み込みの途中なら、その完了を待たない。
 */
export const compressImage: CompressImage = async (image, options) => {
	const { signal, onProgress } = options;
	signal?.throwIfAborted();
	const { maxStoredBytes, maxEdge, minEdge, minQuality } = normalizeFieldOptions(options);
	const outcome = await searchWithinBudget(
		image,
		{ maxStoredBytes, maxEdge, minEdge, minQuality },
		{ encoder: options.encoder ?? createCanvasWebpEncoder(), signal, onProgress },
	);
	if (!outcome.ok) {
		throw new Base64ImageError(
			"COMPRESSION_OVER_BUDGET",
			`The image does not fit in ${maxStoredBytes} bytes even at ${outcome.lastEdge}px and quality ${minQuality}`,
			{
				details: {
					maxStoredBytes,
					minEdge,
					minQuality,
					lastEdge: outcome.lastEdge,
					lastStoredBytes: outcome.lastStoredBytes,
					attempts: outcome.attempts,
				},
			},
		);
	}
	const { fit, attempts } = outcome;
	const { dataUrl, webpBytes } = await readWebpDataUrl(fit.blob, signal);
	return {
		dataUrl,
		width: fit.width,
		height: fit.height,
		quality: fit.quality,
		storedBytes: dataUrl.length,
		webpBytes,
		attempts,
	};
};

// ---------------------------------------------------------------------------
// 探索と縮小の判断(純粋なロジック)
// ---------------------------------------------------------------------------

/** `searchWithinBudget` の条件。`compressImage` は丸めた options を、サムネイルは固定の値を渡す */
export interface BudgetSearchParams {
	/** data URL の長さの上限(バイト) */
	readonly maxStoredBytes: number;
	/** 最初に試す長辺の上限(px)。元の長辺のほうが短ければ、元の長辺から始める(拡大しない) */
	readonly maxEdge: number;
	/** 縮小していく長辺の下限(px)。次の長辺がこれを下回ったら、収まらなかったとする */
	readonly minEdge: number;
	/** 画質の下限(0〜`MAX_QUALITY`)。`minQuality` → `MAX_QUALITY` → 0.01 刻みの二分探索の順に試す */
	readonly minQuality: number;
}

export interface BudgetSearchContext {
	/** 1 回の探索の中では順に呼ぶ(同時には呼ばない) */
	readonly encoder: WebpEncoder;
	readonly signal?: AbortSignal | undefined;
	/** エンコードの直前に呼ぶ */
	readonly onProgress?: ((progress: CompressProgress) => void) | undefined;
}

/** 予算に収まったエンコードの結果 */
export interface BudgetFit {
	/** エンコーダーが返した Blob(type は `image/webp`)。これをそのまま保存する */
	readonly blob: Blob;
	readonly width: number;
	readonly height: number;
	readonly quality: number;
}

export type BudgetSearchOutcome =
	| { readonly ok: true; readonly fit: BudgetFit; readonly attempts: number }
	| {
			readonly ok: false;
			/** 最後に試した長辺(px) */
			readonly lastEdge: number;
			/** 最後に試した長辺で、画質の下限にしたときの保存サイズ(バイト) */
			readonly lastStoredBytes: number;
			readonly attempts: number;
	  };

/**
 * 仕様書 6.3 の手順 2〜5 で、予算に収まるエンコード結果を探す。
 *
 * 1. 長辺を `edgeSequence` の順に試す(`min(maxEdge, 元の長辺)` から 0.8 倍ずつ、`minEdge` 以上のあいだ)。
 * 2. 各長辺で `findHighestQuality` の順に画質を試す。画質の下限で収まらなければ、1 回で次の長辺に移る。
 * 3. どの長辺でも収まらなければ `ok: false` を返す(エラーの種類は呼び出し側が決める)。
 *
 * エンコーダーの失敗と `BROWSER_UNSUPPORTED` は、そのまま reject する。
 * 中断されたら、次のエンコードを始めずに(エンコード中なら完了を待たずに)`signal.reason` で reject する。
 */
export async function searchWithinBudget(
	image: ImageSource,
	params: BudgetSearchParams,
	context: BudgetSearchContext,
): Promise<BudgetSearchOutcome> {
	const { encoder, signal, onProgress } = context;
	assertImageSize(image);
	assertSearchParams(params);
	const maxWebpBytes = maxWebpBytesForBudget(params.maxStoredBytes);
	const ladder = qualityLadder(params.minQuality);
	const edges = edgeSequence(Math.max(image.width, image.height), params.maxEdge, params.minEdge);
	let attempts = 0;
	let lastEdge = 0;
	let lastStoredBytes = 0;

	for (const edge of edges) {
		const { width, height } = fitLongEdge(image.width, image.height, edge);
		// oxlint-disable-next-line no-await-in-loop -- 収まらなかったときだけ次の長辺を試すので、順に待つ
		const found = await findHighestQuality(ladder, async (quality) => {
			// 中断されたあとは、進捗も知らせない
			signal?.throwIfAborted();
			attempts += 1;
			onProgress?.({ width, height, quality, attempt: attempts });
			const blob = await encodeOnce(encoder, {
				source: image.source,
				width,
				height,
				quality,
				signal,
			});
			lastEdge = edge;
			lastStoredBytes = storedBytesForWebp(blob.size);
			return blob.size <= maxWebpBytes ? blob : null;
		});
		if (found !== null) {
			return {
				ok: true,
				fit: { blob: found.blob, width, height, quality: found.quality },
				attempts,
			};
		}
	}
	return { ok: false, lastEdge, lastStoredBytes, attempts };
}

/**
 * 試す長辺の列(px)。
 *
 * - 最初は `min(maxEdge, longEdge)`。拡大はしない。元の長辺が `minEdge` より短い画像も、元の大きさで 1 回は試す。
 * - その後は 0.8 倍して四捨五入した長辺を、`minEdge` 以上のあいだ続ける(既定なら 1600 → 1280 → 1024 → 819 → 655 → 524)。
 */
export function edgeSequence(longEdge: number, maxEdge: number, minEdge: number): number[] {
	const first = Math.min(maxEdge, longEdge);
	const edges = [first];
	for (let edge = shrinkEdge(first); edge >= minEdge && edge >= 1; edge = shrinkEdge(edge)) {
		edges.push(edge);
	}
	return edges;
}

/** 長辺を 0.8 倍して四捨五入する。小さい長辺で同じ値が続かないよう、少なくとも 1px は縮める */
function shrinkEdge(edge: number): number {
	return Math.min(edge - 1, Math.round(edge * SHRINK_FACTOR));
}

/** 縦横比を保ったまま、長辺を `edge` にした寸法。短辺は四捨五入し、1px 以上にする */
export function fitLongEdge(
	width: number,
	height: number,
	edge: number,
): { width: number; height: number } {
	if (width >= height) {
		return { width: edge, height: Math.max(1, Math.round((height * edge) / width)) };
	}
	return { width: Math.max(1, Math.round((width * edge) / height)), height: edge };
}

/** 試す画質の列(昇順)。`at(0)` が `minQuality`、それより後は 0.01 刻みで `MAX_QUALITY` まで */
export interface QualityLadder {
	readonly length: number;
	at(index: number): number;
}

/** 画質の刻み(0.01)の逆数 */
const QUALITY_STEPS_PER_UNIT = 100;
const MAX_QUALITY_STEP = Math.round(MAX_QUALITY * QUALITY_STEPS_PER_UNIT);

/**
 * `minQuality` と、それより大きい 0.01 刻みの画質(`MAX_QUALITY` まで)の列。
 * `minQuality` が 0.01 刻みでなくても(例: 0.655)、最初はその値を試す。
 */
export function qualityLadder(minQuality: number): QualityLadder {
	// 浮動小数点の誤差(0.6 × 100 = 60.000…1 など)で、minQuality と同じ画質を 2 回試さないよう、余裕を持たせる
	const firstStep = Math.floor(minQuality * QUALITY_STEPS_PER_UNIT + 1e-6) + 1;
	return {
		length: 1 + Math.max(0, MAX_QUALITY_STEP - firstStep + 1),
		at: (index) => (index === 0 ? minQuality : (firstStep + index - 1) / QUALITY_STEPS_PER_UNIT),
	};
}

/**
 * 1 つの長辺で、`attempt` が Blob を返す(= 予算に収まる)最高の画質を探す。
 *
 * - 順番: 画質の下限 → `MAX_QUALITY` → その間を 0.01 刻みで二分探索(下限が 0.60 なら最大 2 + 5 回)。
 *   下限で収まらなければ 1 回で終わる(T05 の minFirst)。
 * - サイズは画質に対して完全には単調でない(T05 で最大 158 B の逆転)。そのため二分探索の答えは、真の最高画質より
 *   低いことがある。返すのは、実際に収まった Blob とその画質だけ。
 * - 下限でも収まらなければ null。
 */
async function findHighestQuality(
	ladder: QualityLadder,
	attempt: (quality: number) => Promise<Blob | null>,
): Promise<{ quality: number; blob: Blob } | null> {
	let low = 0;
	const lowest = await attempt(ladder.at(low));
	if (lowest === null) return null;
	let best = { quality: ladder.at(low), blob: lowest };

	let high = ladder.length - 1;
	if (high === low) return best;
	const highest = await attempt(ladder.at(high));
	if (highest !== null) return { quality: ladder.at(high), blob: highest };

	// low は収まった位置、high は収まらなかった位置
	while (high - low > 1) {
		const middle = Math.floor((low + high) / 2);
		// oxlint-disable-next-line no-await-in-loop -- 二分探索は、前の結果で次に試す画質が決まるので、順に待つ
		const blob = await attempt(ladder.at(middle));
		if (blob === null) {
			high = middle;
		} else {
			low = middle;
			best = { quality: ladder.at(middle), blob };
		}
	}
	return best;
}

/** エンコーダーを 1 回呼ぶ。Blob の type が `image/webp` でなければ、非対応のブラウザ(Safari など)とみなす */
async function encodeOnce(encoder: WebpEncoder, request: EncodeRequest): Promise<Blob> {
	const { signal } = request;
	// onProgress の中で中断されたときは、エンコーダーを呼ばない
	signal?.throwIfAborted();
	let blob: Blob;
	try {
		blob = await abortable(encoder(request), signal);
	} catch (error) {
		// 中断で失敗したときは(abortable が reject した場合を含む)、ENCODE_FAILED に包まずに signal.reason にする
		signal?.throwIfAborted();
		throw isBase64ImageError(error)
			? error
			: new Base64ImageError("ENCODE_FAILED", "The WebP encoder failed", { cause: error });
	}
	if (blob.type !== WEBP_MIME_TYPE) {
		throw new Base64ImageError(
			"BROWSER_UNSUPPORTED",
			`The browser produced "${blob.type}" instead of ${WEBP_MIME_TYPE}`,
			{ details: { type: blob.type } },
		);
	}
	return blob;
}

/**
 * 探索で収まった Blob を、保存する data URL にする(エンコードし直さない)。
 * 中断されたら、読み込みの完了を待たずに `signal.reason` で reject する。
 */
export async function readWebpDataUrl(
	blob: Blob,
	signal?: AbortSignal,
): Promise<{ dataUrl: string; webpBytes: number }> {
	let buffer: ArrayBuffer;
	try {
		buffer = await abortable(blob.arrayBuffer(), signal);
	} catch (error) {
		// 中断で失敗したときは、ENCODE_FAILED に包まずに signal.reason にする
		signal?.throwIfAborted();
		throw new Base64ImageError("ENCODE_FAILED", "Could not read the encoded WebP", {
			cause: error,
		});
	}
	const bytes = new Uint8Array(buffer);
	return { dataUrl: toWebpDataUrl(bytes), webpBytes: bytes.length };
}

function assertImageSize(image: ImageSource): void {
	if (!isPositiveInteger(image.width) || !isPositiveInteger(image.height)) {
		throw new Base64ImageError(
			"ENCODE_FAILED",
			`Invalid image size: ${image.width}x${image.height}`,
		);
	}
}

/** 呼び出し側の誤り(丸めていない値など)を早めに見つける。画質は必ず 0〜`MAX_QUALITY` の範囲で渡すため */
function assertSearchParams({ maxEdge, minEdge, minQuality }: BudgetSearchParams): void {
	if (!isPositiveInteger(maxEdge) || !isPositiveInteger(minEdge)) {
		throw new RangeError(`maxEdge and minEdge must be positive integers: ${maxEdge}, ${minEdge}`);
	}
	if (!(minQuality >= 0 && minQuality <= MAX_QUALITY)) {
		throw new RangeError(`minQuality must be between 0 and ${MAX_QUALITY}: ${minQuality}`);
	}
}

function isPositiveInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 1;
}

// ---------------------------------------------------------------------------
// 中断
// ---------------------------------------------------------------------------

/**
 * `promise` の結果を返す。先に `signal` が中断されたら、`promise` を待たずに `signal.reason` で reject する。
 * `toBlob` や `createImageBitmap` は途中で止められないので、キャンセルの操作にすぐ応えるために使う。
 * 中断のあとで `promise` が値を返したら、`discard` に渡す(`ImageBitmap#close` など)。
 */
export function abortable<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
	discard?: (value: T) => void,
): Promise<T> {
	if (signal === undefined) return promise;
	return new Promise<T>((resolve, reject) => {
		const onAbort = (): void => {
			reject(signal.reason);
		};
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
		// 中断で先に reject したあとも promise の結果を受け取り、値は discard に渡し、失敗は握りつぶす(未処理の reject にしない)
		const settle = async (): Promise<void> => {
			try {
				const value = await promise;
				if (signal.aborted) discard?.(value);
				else resolve(value);
			} catch (error) {
				reject(error);
			} finally {
				signal.removeEventListener("abort", onAbort);
			}
		};
		void settle();
	});
}

// ---------------------------------------------------------------------------
// canvas のエンコーダー(ブラウザに依存する部分)
// ---------------------------------------------------------------------------

/** エンコードに使う canvas(`HTMLCanvasElement` のうち、使う部分だけ) */
export interface EncoderCanvas {
	width: number;
	height: number;
	getContext(contextId: "2d"): EncoderCanvasContext | null;
	toBlob(callback: BlobCallback, type?: string, quality?: unknown): void;
}

/** エンコードに使う 2D コンテキスト(`CanvasRenderingContext2D` のうち、使う部分だけ) */
export interface EncoderCanvasContext {
	drawImage(image: CanvasImageSource, dx: number, dy: number): void;
}

/** `createCanvasWebpEncoder` が使うブラウザの機能。テストでは偽物を渡す */
export interface CanvasEncoderEnvironment {
	/** 既定は `globalThis.createImageBitmap` */
	readonly createImageBitmap?: (
		image: ImageBitmapSource,
		options: ImageBitmapOptions,
	) => Promise<ImageBitmap>;
	/** 既定は `document.createElement("canvas")` */
	readonly createCanvas?: () => EncoderCanvas;
}

/**
 * canvas の WebP エンコーダー(仕様書 6.1・6.3)。
 *
 * 1. `createImageBitmap(source, { resizeWidth, resizeHeight, resizeQuality: "high" })` で縮小する。
 *    Firefox 155 は `imageSmoothingQuality` を持たず、`drawImage` で 2 倍以上縮小するとエイリアシングが出るため(T05)。
 * 2. 同じ大きさの canvas に 1:1 で描き、縮小した ImageBitmap はすぐに閉じる。
 * 3. `toBlob(callback, "image/webp", quality)` でエンコードする。画質は必ず 0〜1 の値を渡す
 *    (省略や範囲外はブラウザの既定値になる)。範囲外なら RangeError。
 *
 * - 直前と同じ `source`・寸法なら、描いた canvas を使い回して縮小を省く(同じ長辺で画質だけを変えて試すため)。
 *   そのため、1 つのエンコーダーを同時に複数の処理で使わない。
 * - `toBlob` が null を返したら、または 2D コンテキストが無ければ `ENCODE_FAILED`。
 * - `signal` が中断されたら、縮小やエンコードの完了を待たずに `signal.reason` で reject する。
 */
export function createCanvasWebpEncoder(environment: CanvasEncoderEnvironment = {}): WebpEncoder {
	const resize =
		environment.createImageBitmap ??
		((image: ImageBitmapSource, options: ImageBitmapOptions) => createImageBitmap(image, options));
	const createCanvas =
		environment.createCanvas ?? ((): EncoderCanvas => document.createElement("canvas"));
	let canvas: EncoderCanvas | undefined;
	/** canvas に描いてある画像。無ければ undefined */
	let drawn: { source: CanvasImageSource; width: number; height: number } | undefined;

	return async ({ source, width, height, quality, signal }) => {
		signal?.throwIfAborted();
		if (!(Number.isFinite(quality) && quality >= 0 && quality <= 1)) {
			throw new RangeError(`quality must be between 0 and 1: ${quality}`);
		}
		if (
			canvas === undefined ||
			drawn?.source !== source ||
			drawn.width !== width ||
			drawn.height !== height
		) {
			drawn = undefined;
			const resized = await abortable(
				resize(source, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" }),
				signal,
				(bitmap) => {
					bitmap.close();
				},
			);
			try {
				canvas ??= createCanvas();
				canvas.width = width;
				canvas.height = height;
				const context = canvas.getContext("2d");
				if (context === null) {
					throw new Base64ImageError("ENCODE_FAILED", "The canvas 2D context is not available");
				}
				context.drawImage(resized, 0, 0);
			} finally {
				resized.close();
			}
			drawn = { source, width, height };
		}
		return canvasToWebpBlob(canvas, quality, signal);
	};
}

function canvasToWebpBlob(
	canvas: EncoderCanvas,
	quality: number,
	signal: AbortSignal | undefined,
): Promise<Blob> {
	const encoding = new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob === null) {
					reject(new Base64ImageError("ENCODE_FAILED", "canvas.toBlob returned null"));
				} else {
					resolve(blob);
				}
			},
			WEBP_MIME_TYPE,
			quality,
		);
	});
	return abortable(encoding, signal);
}
