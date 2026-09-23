/**
 * WebP のヘッダー解析(RIFF コンテナと `VP8 ` / `VP8L` / `VP8X` チャンク)。
 *
 * 画像をデコードせずに、寸法・透過・アニメーションの有無を読む。
 * サーバー側の検証(仕様書 8 章)とブラウザ側の圧縮処理の両方で使うので、Node.js 専用の API は使わない。
 *
 * 形式は RFC 9649(WebP Image Format)による。libwebp の `WebPGetFeatures` と同じ項目を確かめ、
 * さらに次の 2 点を厳しくしている(このプラグインが作る WebP は、どちらも満たす)。
 * - RIFF のサイズ欄とデータ長が一致すること(途中で切れたデータや、後ろに余計なデータがあるものを拒否する)。
 * - チャンクの並びがデータの末尾でちょうど終わること。単純形式(`VP8 ` / `VP8L`)では、チャンクが 1 つだけであること。
 */

/** WebP の最初のチャンクの種類。`lossy` = `VP8 `、`lossless` = `VP8L`、`extended` = `VP8X`(透過・メタデータ・アニメーション) */
export type WebpFormat = "lossy" | "lossless" | "extended";

/** WebP のヘッダーから読んだ情報 */
export interface WebpInfo {
	readonly format: WebpFormat;
	/** 幅(px)。アニメーションのときはキャンバスの幅 */
	readonly width: number;
	/** 高さ(px)。アニメーションのときはキャンバスの高さ */
	readonly height: number;
	/** 透過を含むか(`VP8X` の Alpha フラグ、`ALPH` チャンク、`VP8L` の alpha_is_used のいずれか) */
	readonly hasAlpha: boolean;
	/** アニメーションか(`VP8X` の Animation フラグ)。静止画だけを扱うかは呼び出し側で決める */
	readonly animated: boolean;
}

/**
 * WebP として受け付けられない理由。
 * - `TOO_SHORT`: RIFF ヘッダーと最初のチャンクヘッダー(20 バイト)に満たない
 * - `NOT_WEBP`: `RIFF` / `WEBP` のシグネチャが無い
 * - `RIFF_SIZE_MISMATCH`: RIFF のサイズ欄 + 8 がデータ長と違う
 * - `MALFORMED_CHUNK`: チャンクがデータの範囲を超える、末尾でちょうど終わらない、単純形式に余計なチャンクがある
 * - `UNSUPPORTED_FORMAT`: 最初のチャンクが `VP8 ` / `VP8L` / `VP8X` のどれでもない
 * - `INVALID_VP8_HEADER`: `VP8 ` のフレームヘッダーが不正(キーフレームでない、開始コードが違う、寸法が 0 など)
 * - `INVALID_VP8L_HEADER`: `VP8L` のヘッダーが不正(シグネチャ 0x2f が無い、版が 0 でない)
 * - `INVALID_VP8X_HEADER`: `VP8X` チャンクが不正(大きさが 10 バイトでない、キャンバスの面積が 2^32 以上)
 * - `MISSING_IMAGE_DATA`: `VP8X` の後に画像データのチャンク(`VP8 ` / `VP8L`、アニメーションでは `ANMF`)が無い
 * - `CANVAS_SIZE_MISMATCH`: `VP8X` のキャンバスの寸法と、画像データの寸法が違う
 */
export type WebpErrorReason =
	| "TOO_SHORT"
	| "NOT_WEBP"
	| "RIFF_SIZE_MISMATCH"
	| "MALFORMED_CHUNK"
	| "UNSUPPORTED_FORMAT"
	| "INVALID_VP8_HEADER"
	| "INVALID_VP8L_HEADER"
	| "INVALID_VP8X_HEADER"
	| "MISSING_IMAGE_DATA"
	| "CANVAS_SIZE_MISMATCH";

export type WebpParseResult =
	| { readonly ok: true; readonly info: WebpInfo }
	| { readonly ok: false; readonly reason: WebpErrorReason };

/** RIFF ヘッダー(`RIFF` + サイズ + `WEBP`)のバイト数 */
const RIFF_HEADER_SIZE = 12;
/** RIFF のサイズ欄が数えないバイト数(`RIFF` + サイズ欄) */
const RIFF_SIZE_EXCLUDED = 8;
/** チャンクヘッダー(FourCC + サイズ)のバイト数 */
const CHUNK_HEADER_SIZE = 8;
/** `VP8 ` のフレームヘッダー(フレームタグ 3 + 開始コード 3 + 幅 2 + 高さ 2)のバイト数 */
const VP8_FRAME_HEADER_SIZE = 10;
/** `VP8L` のヘッダー(シグネチャ 1 + 寸法などの 32 ビット)のバイト数 */
const VP8L_HEADER_SIZE = 5;
/** `VP8X` チャンクの中身のバイト数(固定) */
const VP8X_CHUNK_SIZE = 10;

const VP8L_SIGNATURE = 0x2f;
/** VP8 のキーフレームの開始コード(RFC 6386 9.1) */
const VP8_START_CODE = [0x9d, 0x01, 0x2a] as const;
const VP8X_FLAG_ALPHA = 0x10;
const VP8X_FLAG_ANIMATION = 0x02;
/** `VP8X` のキャンバスの面積の上限(幅 × 高さ ≤ 2^32 - 1) */
const MAX_CANVAS_AREA = 2 ** 32 - 1;

/** 4 文字の FourCC を、リトルエンディアンの 32 ビット値にする(`DataView.getUint32(offset, true)` と比べるため) */
function fourCC(tag: string): number {
	return (
		(tag.charCodeAt(0) |
			(tag.charCodeAt(1) << 8) |
			(tag.charCodeAt(2) << 16) |
			(tag.charCodeAt(3) << 24)) >>>
		0
	);
}

const RIFF = fourCC("RIFF");
const WEBP = fourCC("WEBP");
const VP8 = fourCC("VP8 ");
const VP8L = fourCC("VP8L");
const VP8X = fourCC("VP8X");
const ALPH = fourCC("ALPH");
const ANMF = fourCC("ANMF");

interface Chunk {
	/** FourCC(リトルエンディアンの 32 ビット値) */
	readonly type: number;
	/** 中身の先頭のオフセット(チャンクヘッダーの直後) */
	readonly offset: number;
	/** 中身のバイト数(詰め物の 1 バイトを含まない) */
	readonly size: number;
}

interface Size {
	readonly width: number;
	readonly height: number;
}

function fail(reason: WebpErrorReason): WebpParseResult {
	return { ok: false, reason };
}

function succeed(info: WebpInfo): WebpParseResult {
	return { ok: true, info };
}

/**
 * WebP のヘッダーを解析して、寸法・透過・アニメーションの有無を返す。
 *
 * 画像の圧縮データ自体は検証しない(デコードはしない)。例外は投げず、不正なデータには理由を返す。
 */
export function parseWebp(bytes: Uint8Array): WebpParseResult {
	if (bytes.byteLength < RIFF_HEADER_SIZE + CHUNK_HEADER_SIZE) return fail("TOO_SHORT");

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== RIFF || view.getUint32(8, true) !== WEBP) return fail("NOT_WEBP");
	if (view.getUint32(4, true) + RIFF_SIZE_EXCLUDED !== view.byteLength) {
		return fail("RIFF_SIZE_MISMATCH");
	}

	const chunks = readChunks(view);
	const first = chunks?.[0];
	if (chunks === undefined || first === undefined) return fail("MALFORMED_CHUNK");

	switch (first.type) {
		case VP8: {
			if (chunks.length !== 1) return fail("MALFORMED_CHUNK");
			const size = readVp8Size(view, first);
			if (size === undefined) return fail("INVALID_VP8_HEADER");
			return succeed({ format: "lossy", ...size, hasAlpha: false, animated: false });
		}
		case VP8L: {
			if (chunks.length !== 1) return fail("MALFORMED_CHUNK");
			const header = readVp8lHeader(view, first);
			if (header === undefined) return fail("INVALID_VP8L_HEADER");
			return succeed({ format: "lossless", ...header, animated: false });
		}
		case VP8X:
			return parseExtended(view, first, chunks.slice(1));
		default:
			return fail("UNSUPPORTED_FORMAT");
	}
}

/**
 * RIFF ヘッダーの後のチャンクを順に読む。
 * チャンクがデータの範囲を超えるか、末尾でちょうど終わらなければ undefined を返す。
 */
function readChunks(view: DataView): Chunk[] | undefined {
	const chunks: Chunk[] = [];
	let offset = RIFF_HEADER_SIZE;
	while (offset < view.byteLength) {
		if (offset + CHUNK_HEADER_SIZE > view.byteLength) return undefined;
		const type = view.getUint32(offset, true);
		const size = view.getUint32(offset + 4, true);
		const payload = offset + CHUNK_HEADER_SIZE;
		// 中身が奇数バイトなら、後ろに詰め物の 1 バイトが付く(RFC 9649 2.3)。
		const next = payload + size + (size % 2);
		if (next > view.byteLength) return undefined;
		chunks.push({ type, offset: payload, size });
		offset = next;
	}
	return chunks;
}

/** 拡張形式(`VP8X` で始まる)を解析する。`rest` は `VP8X` より後のチャンク */
function parseExtended(view: DataView, vp8x: Chunk, rest: readonly Chunk[]): WebpParseResult {
	if (vp8x.size !== VP8X_CHUNK_SIZE) return fail("INVALID_VP8X_HEADER");
	const flags = view.getUint8(vp8x.offset);
	const canvasWidth = readUint24(view, vp8x.offset + 4) + 1;
	const canvasHeight = readUint24(view, vp8x.offset + 7) + 1;
	if (canvasWidth * canvasHeight > MAX_CANVAS_AREA) return fail("INVALID_VP8X_HEADER");
	const flaggedAlpha = (flags & VP8X_FLAG_ALPHA) !== 0;

	if ((flags & VP8X_FLAG_ANIMATION) !== 0) {
		// libwebp と同じく、アニメーションの寸法はキャンバスの寸法とする。各フレームの中身は読まない。
		if (!rest.some((chunk) => chunk.type === ANMF)) return fail("MISSING_IMAGE_DATA");
		return succeed({
			format: "extended",
			width: canvasWidth,
			height: canvasHeight,
			hasAlpha: flaggedAlpha,
			animated: true,
		});
	}

	// 静止画: `ICCP` / `ALPH` / 未知のチャンクを飛ばして、最初の `VP8 ` / `VP8L` を画像データとする(libwebp と同じ)。
	const imageIndex = rest.findIndex((chunk) => chunk.type === VP8 || chunk.type === VP8L);
	const image = rest[imageIndex];
	if (image === undefined) return fail("MISSING_IMAGE_DATA");

	let size: Size;
	let hasAlpha = flaggedAlpha || rest.slice(0, imageIndex).some((chunk) => chunk.type === ALPH);
	if (image.type === VP8) {
		const vp8 = readVp8Size(view, image);
		if (vp8 === undefined) return fail("INVALID_VP8_HEADER");
		size = vp8;
	} else {
		const vp8l = readVp8lHeader(view, image);
		if (vp8l === undefined) return fail("INVALID_VP8L_HEADER");
		size = vp8l;
		hasAlpha ||= vp8l.hasAlpha;
	}
	// libwebp は、静止画のキャンバスと画像データの寸法が違うファイルをデコードしない。
	if (size.width !== canvasWidth || size.height !== canvasHeight) {
		return fail("CANVAS_SIZE_MISMATCH");
	}
	return succeed({
		format: "extended",
		width: size.width,
		height: size.height,
		hasAlpha,
		animated: false,
	});
}

/**
 * `VP8 ` のフレームヘッダー(RFC 6386 9.1、19.1)から寸法を読む。不正なら undefined。
 * 条件は libwebp の `VP8GetInfo` と同じ。
 */
function readVp8Size(view: DataView, chunk: Chunk): Size | undefined {
	if (chunk.size < VP8_FRAME_HEADER_SIZE) return undefined;
	const o = chunk.offset;
	const frameTag = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
	const isKeyFrame = (frameTag & 0x1) === 0;
	const version = (frameTag >> 1) & 0x7;
	const showFrame = (frameTag >> 4) & 0x1;
	const firstPartitionSize = frameTag >> 5;
	if (!isKeyFrame || version > 3 || showFrame !== 1 || firstPartitionSize >= chunk.size) {
		return undefined;
	}
	if (
		view.getUint8(o + 3) !== VP8_START_CODE[0] ||
		view.getUint8(o + 4) !== VP8_START_CODE[1] ||
		view.getUint8(o + 5) !== VP8_START_CODE[2]
	) {
		return undefined;
	}
	// 幅・高さは下位 14 ビット。上位 2 ビットは拡大の指定で、デコード後の寸法には影響しない。
	const width = view.getUint16(o + 6, true) & 0x3fff;
	const height = view.getUint16(o + 8, true) & 0x3fff;
	if (width === 0 || height === 0) return undefined;
	return { width, height };
}

/**
 * `VP8L` のヘッダー(RFC 9649 3.4)から寸法と alpha_is_used を読む。不正なら undefined。
 * 条件は libwebp の `VP8LGetInfo` と同じ。
 */
function readVp8lHeader(view: DataView, chunk: Chunk): (Size & { hasAlpha: boolean }) | undefined {
	if (chunk.size < VP8L_HEADER_SIZE) return undefined;
	if (view.getUint8(chunk.offset) !== VP8L_SIGNATURE) return undefined;
	// 下位ビットから順に、幅 - 1(14)・高さ - 1(14)・alpha_is_used(1)・版(3)。
	const bits = view.getUint32(chunk.offset + 1, true);
	if (bits >>> 29 !== 0) return undefined;
	return {
		width: (bits & 0x3fff) + 1,
		height: ((bits >>> 14) & 0x3fff) + 1,
		hasAlpha: ((bits >>> 28) & 0x1) === 1,
	};
}

function readUint24(view: DataView, offset: number): number {
	return view.getUint16(offset, true) | (view.getUint8(offset + 2) << 16);
}
