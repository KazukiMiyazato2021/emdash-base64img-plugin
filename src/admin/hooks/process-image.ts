/**
 * 1 枚の画像を「デコード → 圧縮 → サムネイル → アップロード」の順に処理する(仕様書 4.2、6 章、7 章)。
 *
 * React に依存しない部分。状態はフック(`useImageUpload`・`useUploadQueue`)が持ち、この関数を呼ぶ。
 * 各段階は `src/shared/pipeline.ts` の形の関数(T12・T13・T14)で、テストでは差し替えられる(`UploadDependencies`)。
 *
 * - 中断: `signal` が中断されたら、`signal.reason` で reject する(各段階の関数と同じ)。フックは、中断をエラーの状態にしない。
 * - デコードした画像(`DecodedImage`)は、圧縮とサムネイルが終わったら、成功・失敗・中断のどれでも必ず閉じる。
 *   Firefox 155 はデコードの間に主スレッドを止め、その間に押された中断はデコードのあとに届く(`decodeImage` が
 *   resolve する)ので、デコードのあとにも中断を確かめる(docs/input-image-decode.md)。
 * - Firefox ではデコードの間、画面が止まる。「読み込み中…」を先に描画するため、デコードの前に描画を 1 回待つ(`waitForPaint`)。
 */

import { uploadImage as defaultUploadImage } from "../../client/api";
import { compressImage as defaultCompressImage } from "../../client/encode";
import {
	decodeImage as defaultDecodeImage,
	inspectInputFile as defaultInspectInputFile,
	type InputInspection,
} from "../../client/input";
import { createThumbnail as defaultCreateThumbnail } from "../../client/thumbnail";
import { MAX_FILENAME_LENGTH, SCHEMA_VERSION, WEBP_MIME_TYPE } from "../../shared/constants";
import { Base64ImageError, type NoticeCode } from "../../shared/errors";
import type { FieldOptions } from "../../shared/options";
import type {
	CompressImage,
	CompressOptions,
	CompressProgress,
	CompressionResult,
	CreateThumbnail,
	DecodeImage,
	ThumbnailOptions,
	ThumbnailResult,
	UploadImage,
	WebpEncoder,
} from "../../shared/pipeline";
import type {
	Base64ImageEntry,
	Base64ImageRef,
	UploadRequest,
	UploadTarget,
} from "../../shared/types";
import type { UploadTargetResolution } from "./upload-target";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** デコードの前の判定(`inspectInputFile` の形。T12) */
export type InspectInputFile = (file: File, signal?: AbortSignal) => Promise<InputInspection>;

/**
 * 処理に使う関数。省略すると T12・T13・T14 の実装を使う。テストや、ほかの環境で差し替える。
 * jsdom には `createImageBitmap` と canvas が無いので、テストでは `decodeImage`(`createDecodeImage` に偽の
 * `createImageBitmap` を渡したもの)と `encoder` を渡す(docs/jsdom-browser-api-gaps.md)。
 */
export interface UploadDependencies {
	readonly decodeImage?: DecodeImage | undefined;
	readonly compressImage?: CompressImage | undefined;
	readonly createThumbnail?: CreateThumbnail | undefined;
	readonly uploadImage?: UploadImage | undefined;
	/** ギャラリーで、まとめて先に判定するときに使う(`useUploadQueue`) */
	readonly inspectInputFile?: InspectInputFile | undefined;
	/** `compressImage` と `createThumbnail` に渡すエンコーダー(2 つは順に呼ぶので、同じものでよい)。省略すると canvas */
	readonly encoder?: WebpEncoder | undefined;
	/** デコードの前に、画面の描画を待つ関数。省略すると `waitForPaint` */
	readonly waitForPaint?: (() => Promise<void>) | undefined;
}

/** 採用した圧縮の結果(画面の「1280×853 · 保存サイズ 98.2KB · 画質 0.77」に使う) */
export interface CompressedSummary {
	readonly width: number;
	readonly height: number;
	/** 採用した画質 */
	readonly quality: number;
	/** 保存サイズ(data URL の長さ。バイト) */
	readonly storedBytes: number;
}

/**
 * 処理中の段階。`status` は、表示の部品(T22 の `UploadProgress`)の `UploadStage` と同じ名前で、同じ順に進む。
 */
export type UploadPhase =
	/** 入力の判定とデコード(Firefox では、この間は画面が止まる) */
	| { readonly status: "decoding" }
	/** 本体の縮小と画質の探索 */
	| {
			readonly status: "compressing";
			readonly notices: readonly NoticeCode[];
			/** 直前に試したエンコード(「圧縮中… 1280px / 画質 0.74」)。最初のエンコードの前は null */
			readonly progress: CompressProgress | null;
	  }
	/** サムネイルの生成(本体の圧縮は終わっている) */
	| {
			readonly status: "thumbnail";
			readonly notices: readonly NoticeCode[];
			readonly compressed: CompressedSummary;
	  }
	/** ルートへの送信 */
	| {
			readonly status: "uploading";
			readonly notices: readonly NoticeCode[];
			readonly compressed: CompressedSummary;
	  };

/**
 * 状態が処理中の段階(`UploadPhase`)か。`useImageUpload` の `state` と、`useUploadQueue` の項目の `state` を絞り込む。
 */
export function isUploadPhase(state: { readonly status: string }): state is UploadPhase {
	const { status } = state;
	return (
		status === "decoding" ||
		status === "compressing" ||
		status === "thumbnail" ||
		status === "uploading"
	);
}

/** アップロードした画像 */
export interface UploadedImage {
	/**
	 * ルートが返した参照。`alt` は空なので、widget が代替テキストを入れてからフィールドの値にする。
	 * `locale` は画像エントリのロケール(サイトの既定ロケール)で、編集中のエントリのロケールではない。書き換えない
	 * (サイト側はこのロケールで画像を引く。T18)。
	 */
	readonly ref: Base64ImageRef;
	/**
	 * 保存した画像エントリと同じ形の値(`src` は送った data URL)。追加したばかりの画像は、これをそのまま表示する
	 * (仕様書 11.2)。`usePreviewImages` の `prime(ref.id, entry)` に渡すと、プレビューを取得し直さない。
	 */
	readonly entry: Base64ImageEntry;
	/** 利用者に伝える注意(GIF など)。文言は `getNoticeMessage(code, locale)`(T14) */
	readonly notices: readonly NoticeCode[];
}

/** 処理が終わった状態 */
export type UploadSettledState =
	| { readonly status: "done"; readonly image: UploadedImage }
	/** 失敗。文言は `useErrorMessage(error)`(T14)。中断はここに入らない */
	| { readonly status: "error"; readonly error: unknown };

/** `useImageUpload().upload(file)` の結果。reject はしない */
export type UploadOutcome = UploadSettledState | { readonly status: "cancelled" };

export interface ProcessImageOptions {
	readonly target: UploadTarget;
	/** `normalizeFieldOptions` で丸めた options */
	readonly fieldOptions: FieldOptions;
	readonly signal: AbortSignal;
	/** 段階が変わるたびと、圧縮の途中経過ごとに呼ぶ */
	readonly onPhase?: ((phase: UploadPhase) => void) | undefined;
	readonly dependencies?: UploadDependencies | undefined;
}

// ---------------------------------------------------------------------------
// 処理
// ---------------------------------------------------------------------------

/**
 * 画像ファイルを 1 枚処理して、アップロード用ルートに送る。
 *
 * 1. `decoding` を知らせ、描画を待つ。
 * 2. `decodeImage(file, { signal })`(形式・上限の判定とデコード。T12)。
 * 3. `compressing`: `compressImage`(長辺と画質の探索。T13)。`thumbnail`: `createThumbnail`(T13)。
 *    終わったらデコードした画像を閉じる。
 * 4. `uploading`: `uploadImage`(T14)。`quality` は採用した画質、`filename` は空なら送らず `MAX_FILENAME_LENGTH` 文字で切る。
 *
 * 失敗したら、各段階の `Base64ImageError` で reject する。中断されたら `signal.reason` で reject する。
 */
export async function processImageFile(
	file: File,
	options: ProcessImageOptions,
): Promise<UploadedImage> {
	const { target, fieldOptions, signal, onPhase, dependencies = {} } = options;
	const decode = dependencies.decodeImage ?? defaultDecodeImage;
	const compress = dependencies.compressImage ?? defaultCompressImage;
	const thumbnailOf = dependencies.createThumbnail ?? defaultCreateThumbnail;
	const upload = dependencies.uploadImage ?? defaultUploadImage;
	const { encoder } = dependencies;

	signal.throwIfAborted();
	onPhase?.({ status: "decoding" });
	await (dependencies.waitForPaint ?? waitForPaint)();
	signal.throwIfAborted();

	const decoded = await decode(file, { signal });
	let compression: CompressionResult;
	let compressed: CompressedSummary;
	let thumbnail: ThumbnailResult;
	const { notices } = decoded;
	try {
		// Firefox では、デコードの間に押された中断がここで届く(decodeImage は resolve している)
		signal.throwIfAborted();
		onPhase?.({ status: "compressing", notices, progress: null });
		const compressOptions: CompressOptions = {
			maxStoredBytes: fieldOptions.maxStoredBytes,
			maxEdge: fieldOptions.maxEdge,
			minQuality: fieldOptions.minQuality,
			minEdge: fieldOptions.minEdge,
			signal,
			onProgress: (progress) => {
				onPhase?.({ status: "compressing", notices, progress });
			},
		};
		const thumbnailOptions: ThumbnailOptions =
			encoder === undefined ? { signal } : { signal, encoder };
		compression = await compress(
			decoded,
			encoder === undefined ? compressOptions : { ...compressOptions, encoder },
		);
		compressed = summarize(compression);
		onPhase?.({ status: "thumbnail", notices, compressed });
		thumbnail = await thumbnailOf(decoded, thumbnailOptions);
	} finally {
		// デコードした画像は大きい(最大 6,400 万画素 × 4 バイト)ので、送信を待たずに閉じる
		decoded.close();
	}

	onPhase?.({ status: "uploading", notices, compressed });
	const filename = toUploadFilename(decoded.filename);
	const { ref } = await upload(buildUploadRequest(compression, thumbnail, filename, target), {
		signal,
	});
	return { ref, entry: toImageEntry(compression, filename), notices };
}

/**
 * アップロード用ルートへの入力を作る(仕様書 7 章)。
 * `quality` は採用した画質(画像エントリの `meta.quality` になる)。`filename` は undefined なら入れない。
 */
export function buildUploadRequest(
	compression: CompressionResult,
	thumbnail: ThumbnailResult,
	filename: string | undefined,
	target: UploadTarget,
): UploadRequest {
	const request: UploadRequest = {
		dataUrl: compression.dataUrl,
		thumb: thumbnail.dataUrl,
		width: compression.width,
		height: compression.height,
		quality: compression.quality,
		target,
	};
	if (filename !== undefined) request.filename = filename;
	return request;
}

/**
 * 送るファイル名。空なら undefined(送らない)。`MAX_FILENAME_LENGTH` 文字を超えたら切る。
 * 文字はコードポイントで数える(サーバーの `filenameSchema` と同じ数え方。docs/zod-string-length-code-points.md)。
 * サロゲートペアの途中では切らない。
 */
export function toUploadFilename(name: string): string | undefined {
	if (name === "") return undefined;
	const codePoints = Array.from(name);
	return codePoints.length <= MAX_FILENAME_LENGTH
		? name
		: codePoints.slice(0, MAX_FILENAME_LENGTH).join("");
}

/** 採用した圧縮の結果のうち、画面に出すもの */
function summarize(compression: CompressionResult): CompressedSummary {
	return {
		width: compression.width,
		height: compression.height,
		quality: compression.quality,
		storedBytes: compression.storedBytes,
	};
}

/** 保存される画像エントリと同じ形の値(`b64_images` の `image`。仕様書 5.1) */
function toImageEntry(
	compression: CompressionResult,
	filename: string | undefined,
): Base64ImageEntry {
	const entry: Base64ImageEntry = {
		src: compression.dataUrl,
		mimeType: WEBP_MIME_TYPE,
		width: compression.width,
		height: compression.height,
		meta: { v: SCHEMA_VERSION, bytes: compression.webpBytes, quality: compression.quality },
	};
	if (filename !== undefined) entry.filename = filename;
	return entry;
}

/** 保存先を求められなかったときのエラー(`INVALID_TARGET`) */
export function uploadTargetError(
	resolution: Extract<UploadTargetResolution, { readonly ok: false }>,
): Base64ImageError {
	return new Base64ImageError("INVALID_TARGET", resolution.message, {
		details: { problem: resolution.problem },
	});
}

// ---------------------------------------------------------------------------
// 描画を待つ
// ---------------------------------------------------------------------------

/**
 * 背景のタブでは `requestAnimationFrame` が呼ばれない。処理が止まらないよう、この時間(ミリ秒)で待つのをやめる。
 * 画面に見えていないので、描画を待つ意味も無い。
 */
export const PAINT_TIMEOUT_MS = 100;

/**
 * 状態の変化が描画されるまで待つ。デコードの前に呼び、「読み込み中…」を描画してから、Firefox が主スレッドを止める
 * デコードを始める。
 *
 * - `requestAnimationFrame` を 2 回重ね、2 回目の中で `setTimeout` を呼ぶ。2 回目のフレームの描画のあとに resolve する。
 * - 1 回だけでは足りない。React が状態の変化を反映する(コミットする)前にフレームが来ることが多く、そのフレームには
 *   「読み込み中…」が無い。1 回だけのときは、Chromium 153・Firefox 155 の 30 回のうち 20 回で、コミットのあとの
 *   最初のフレームより先にデコードが始まった。2 回では 30 回とも描画のあとだった(docs/upload-hook-browser-check.md)。
 */
export function waitForPaint(): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (): void => {
			if (settled) return;
			settled = true;
			clearTimeout(fallback);
			resolve();
		};
		const fallback = setTimeout(finish, PAINT_TIMEOUT_MS);
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					setTimeout(finish, 0);
				});
			});
		}
	});
}

// ---------------------------------------------------------------------------
// 補助
// ---------------------------------------------------------------------------

/** デコードの前の判定(既定は T12 の `inspectInputFile`) */
export function inspectorOf(dependencies: UploadDependencies | undefined): InspectInputFile {
	return dependencies?.inspectInputFile ?? defaultInspectInputFile;
}
