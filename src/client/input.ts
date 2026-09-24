/**
 * 入力画像の判定とデコード(仕様書 6.5)。
 *
 * - `decodeImage`: 形式と上限を判定し、`createImageBitmap(file, { imageOrientation: "from-image" })` でデコードする。
 * - `inspectInputFile`: デコードの前の判定(形式・ファイルのバイト数・ヘッダーから読んだ画素数)。`decodeImage` が最初に呼ぶ。
 * - 形式は、ファイルの先頭のバイト(シグネチャ)で判定する。`File.type` は拡張子から決まり、拡張子が無ければ空、
 *   付け替えられていれば中身と違う値になる。そのため `File.type` は、先頭のバイトで判定できなかったときに、
 *   拒否の理由(HEIC・SVG・壊れた画像)を選ぶためだけに使う。
 * - 画素数は、デコードする前にヘッダーから読んだ寸法で確かめる。デコードすると 1 画素あたり約 4 バイトのメモリを使い、
 *   300KB の PNG でも 1GB になりうるため。ヘッダーから寸法を読めなかった画像は、デコードしたあとで確かめる。
 * - jsdom には `createImageBitmap` が無いので、テストでは `createDecodeImage` に偽物を渡す。
 *
 * 判定の方法は、Chromium 153・Firefox 155 での測定で決めた(docs/input-image-decode.md)。
 */

import { MAX_INPUT_FILE_BYTES, MAX_INPUT_PIXELS } from "../shared/constants";
import {
	Base64ImageError,
	isBase64ImageError,
	type ClientErrorCode,
	type ErrorDetails,
	type NoticeCode,
} from "../shared/errors";
import type { DecodeImage, DecodedImage } from "../shared/pipeline";
import { abortable } from "./encode";

// ---------------------------------------------------------------------------
// 形式
// ---------------------------------------------------------------------------

/** 受け付ける形式(仕様書 6.5)。GIF は最初のフレームだけの静止画になる */
export const ACCEPTED_FORMATS = ["jpeg", "png", "gif", "webp", "avif", "bmp"] as const;
export type AcceptedFormat = (typeof ACCEPTED_FORMATS)[number];

/** ファイルの先頭のバイトから判定できる形式。`heif` / `svg` / `tiff` は拒否する */
export type InputFormat = AcceptedFormat | "heif" | "svg" | "tiff";

/** 受け付ける形式の MIME タイプ(`DecodedImage#mimeType` に入れる) */
export const FORMAT_MIME_TYPES = {
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	bmp: "image/bmp",
} as const satisfies Record<AcceptedFormat, string>;

/** `File.type` から形式を引く表(小文字、パラメーターを除いたもの) */
const MIME_TYPE_FORMATS: ReadonlyMap<string, InputFormat> = new Map<string, InputFormat>([
	["image/jpeg", "jpeg"],
	["image/jpg", "jpeg"],
	["image/pjpeg", "jpeg"],
	["image/png", "png"],
	["image/apng", "png"],
	["image/x-png", "png"],
	["image/gif", "gif"],
	["image/webp", "webp"],
	["image/avif", "avif"],
	["image/bmp", "bmp"],
	["image/x-bmp", "bmp"],
	["image/x-ms-bmp", "bmp"],
	["image/heic", "heif"],
	["image/heif", "heif"],
	["image/heic-sequence", "heif"],
	["image/heif-sequence", "heif"],
	["image/svg+xml", "svg"],
	["image/tiff", "tiff"],
	["image/tiff-fx", "tiff"],
]);

/** `File.type` から形式を引く。知らない MIME タイプや空文字は null */
export function formatFromMimeType(mimeType: string): InputFormat | null {
	const essence = (mimeType.split(";")[0] ?? "").trim().toLowerCase();
	return MIME_TYPE_FORMATS.get(essence) ?? null;
}

function isAcceptedFormat(format: InputFormat | null): format is AcceptedFormat {
	return format !== null && (ACCEPTED_FORMATS as readonly string[]).includes(format);
}

// ---------------------------------------------------------------------------
// 先頭のバイトによる判定
// ---------------------------------------------------------------------------

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** AVIF の brand(ftyp の major brand か compatible brands にあれば AVIF) */
const AVIF_BRANDS: ReadonlySet<string> = new Set(["avif", "avis"]);

/**
 * HEIF(HEIC を含む)の brand。AVIF の brand が無く、これらのどれかがあれば HEIF とする。
 * iPhone の写真は `heic`、macOS の sips は `heix`、どちらも compatible brands に `mif1` を持つ(T12 で実測)。
 */
const HEIF_BRANDS: ReadonlySet<string> = new Set([
	"heic",
	"heix",
	"heim",
	"heis",
	"hevc",
	"hevx",
	"hevm",
	"hevs",
	"mif1",
	"msf1",
	"mif2",
	"miaf",
]);

/** BMP の DIB ヘッダーのバイト数として受け入れる値(12 = OS/2 1.x、16〜64 = OS/2 2.x、40〜124 = Windows) */
function isBmpHeaderSize(size: number): boolean {
	return size === 12 || (size >= 16 && size <= 124);
}

/** SVG を探す範囲(先頭からのバイト数) */
const SVG_SNIFF_BYTES = 4_096;

/**
 * ファイルの先頭のバイトから形式を判定する。どれにも当たらなければ null。
 *
 * - JPEG / PNG / GIF / WebP / BMP / TIFF はシグネチャ、AVIF と HEIF は `ftyp` ボックスの brand で判定する。
 *   Chromium・Firefox も、画像のデコードでは MIME タイプではなく中身で形式を決める(T12 で実測)。
 * - SVG は、BOM と空白の後が `<` で、先頭の 4,096 バイトの中に `<svg`(名前空間の接頭辞があってもよい)の要素があるもの。
 */
export function sniffImageFormat(head: Uint8Array): InputFormat | null {
	if (startsWithBytes(head, 0, JPEG_SIGNATURE)) return "jpeg";
	if (startsWithBytes(head, 0, PNG_SIGNATURE)) return "png";
	if (startsWithAscii(head, 0, "GIF87a") || startsWithAscii(head, 0, "GIF89a")) return "gif";
	if (startsWithAscii(head, 0, "RIFF") && startsWithAscii(head, 8, "WEBP")) return "webp";
	if (
		startsWithAscii(head, 0, "BM") &&
		head.length >= 18 &&
		isBmpHeaderSize(dataView(head).getUint32(14, true))
	) {
		return "bmp";
	}
	if (
		startsWithAscii(head, 0, "II*\0") ||
		startsWithAscii(head, 0, "MM\0*") ||
		startsWithAscii(head, 0, "II+\0") ||
		startsWithAscii(head, 0, "MM\0+")
	) {
		return "tiff";
	}
	const isobmff = sniffIsobmffBrand(head);
	if (isobmff !== null) return isobmff;
	if (looksLikeSvg(head)) return "svg";
	return null;
}

/** `ftyp` ボックスの brand から AVIF / HEIF を判定する。どちらでもなければ null(MP4 の動画など) */
function sniffIsobmffBrand(head: Uint8Array): "avif" | "heif" | null {
	// size(4)・"ftyp"(4)・major brand(4)・minor version(4)・compatible brands(4 × n)
	if (head.length < 16 || !startsWithAscii(head, 4, "ftyp")) return null;
	const size = dataView(head).getUint32(0);
	if (size < 16) return null;
	const brands = [fourCC(head, 8)];
	for (let offset = 16; offset + 4 <= Math.min(size, head.length); offset += 4) {
		brands.push(fourCC(head, offset));
	}
	if (brands.some((brand) => AVIF_BRANDS.has(brand))) return "avif";
	if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "heif";
	return null;
}

function looksLikeSvg(head: Uint8Array): boolean {
	// TextDecoder は UTF-8 の BOM を取り除く。バイナリは置換文字になるだけで、例外にはならない
	const text = new TextDecoder().decode(head.subarray(0, SVG_SNIFF_BYTES));
	return /^\s*</.test(text) && /<(?:[\w.-]+:)?svg[\s/>]/.test(text);
}

// ---------------------------------------------------------------------------
// 形式の判定(先頭のバイトと File.type)
// ---------------------------------------------------------------------------

/** 形式の判定で拒否するときのコード */
export type InputFormatRejection = Extract<
	ClientErrorCode,
	"INPUT_HEIC_REJECTED" | "INPUT_SVG_REJECTED" | "INPUT_FORMAT_REJECTED" | "INPUT_DECODE_FAILED"
>;

export type FormatJudgement =
	| { readonly ok: true; readonly format: AcceptedFormat }
	| { readonly ok: false; readonly code: InputFormatRejection };

/**
 * 受け付けるかを、先頭のバイトから判定した形式(`detected`)と `File.type` で決める。
 *
 * 1. 先頭のバイトで判定できたら、それだけで決める(`File.type` は見ない)。
 *    JPEG / PNG / GIF / WebP / AVIF / BMP は受け付ける。HEIF → `INPUT_HEIC_REJECTED`、SVG → `INPUT_SVG_REJECTED`、
 *    TIFF → `INPUT_FORMAT_REJECTED`。
 * 2. 判定できなければ、`File.type`(拡張子から決まる)で拒否の理由を選ぶ。デコードはしない。
 *    HEIC / HEIF → `INPUT_HEIC_REJECTED`、SVG → `INPUT_SVG_REJECTED`、受け付ける形式の MIME タイプなのに中身が
 *    合わない(壊れている)→ `INPUT_DECODE_FAILED`、それ以外(空・TIFF・ICO など)→ `INPUT_FORMAT_REJECTED`。
 */
export function judgeInputFormat(detected: InputFormat | null, mimeType: string): FormatJudgement {
	if (detected === null) {
		const hinted = formatFromMimeType(mimeType);
		if (isAcceptedFormat(hinted)) return { ok: false, code: "INPUT_DECODE_FAILED" };
		return { ok: false, code: rejectionFor(hinted) };
	}
	if (isAcceptedFormat(detected)) return { ok: true, format: detected };
	return { ok: false, code: rejectionFor(detected) };
}

function rejectionFor(
	format: "heif" | "svg" | "tiff" | null,
): "INPUT_HEIC_REJECTED" | "INPUT_SVG_REJECTED" | "INPUT_FORMAT_REJECTED" {
	if (format === "heif") return "INPUT_HEIC_REJECTED";
	if (format === "svg") return "INPUT_SVG_REJECTED";
	return "INPUT_FORMAT_REJECTED";
}

// ---------------------------------------------------------------------------
// ファイルの読み込み
// ---------------------------------------------------------------------------

/** ファイルの一部を読む */
export interface ByteReader {
	/** ファイルのバイト数 */
	readonly size: number;
	/** `offset` から `length` バイトを読む。ファイルの末尾を超える分は含めない(短い配列になる) */
	read(offset: number, length: number): Promise<Uint8Array>;
}

/** 1 回に読み込むバイト数。ヘッダーの多くは先頭の 64KiB に収まる */
const READ_WINDOW_BYTES = 64 * 1024;

/**
 * Blob を必要な部分だけ読む `ByteReader`。最後に読んだ 64KiB を覚えておき、その範囲の読み込みは再利用する。
 * `signal` が中断されたら、読み込みの完了を待たずに `signal.reason` で reject する。
 */
export function createBlobReader(blob: Blob, signal?: AbortSignal): ByteReader {
	let windowStart = 0;
	let cached = new Uint8Array(0);
	return {
		size: blob.size,
		async read(offset, length) {
			const start = Math.max(0, offset);
			const end = Math.min(blob.size, start + Math.max(0, length));
			if (start >= end) return new Uint8Array(0);
			if (start >= windowStart && end <= windowStart + cached.length) {
				return cached.subarray(start - windowStart, end - windowStart);
			}
			const windowEnd = Math.min(blob.size, start + Math.max(end - start, READ_WINDOW_BYTES));
			const buffer = await abortable(blob.slice(start, windowEnd).arrayBuffer(), signal);
			windowStart = start;
			cached = new Uint8Array(buffer);
			return cached.subarray(0, end - start);
		},
	};
}

// ---------------------------------------------------------------------------
// ヘッダーから寸法を読む
// ---------------------------------------------------------------------------

/** 画像の寸法(px) */
export interface ImageDimensions {
	readonly width: number;
	readonly height: number;
}

/**
 * ヘッダーを探すときに読み飛ばすセグメント・ブロック・ボックスの数の上限。
 * 超えたら寸法は分からないとして、デコードしたあとで画素数を確かめる。
 */
const MAX_HEADER_STEPS = 10_000;

/**
 * ヘッダーから、デコードしたときの寸法(の上限)を読む。読めなければ null。EXIF の向きは反映しない(画素数は同じ)。
 *
 * - JPEG: 最初の SOF(SOF0〜SOF15。DHT・DAC などを除く)の寸法。APP などのセグメントは長さで読み飛ばす。
 * - PNG: IHDR の寸法。
 * - GIF: 論理画面の寸法と、最初のフレームの右端・下端の大きいほう(Chromium・Firefox は、論理画面より大きい最初の
 *   フレームに合わせて画像を広げる。T12 で実測)。
 * - WebP: `VP8 ` / `VP8L` のフレームの寸法、または `VP8X` のキャンバスの寸法(libwebp の `WebPGetInfo` と同じ)。
 * - BMP: DIB ヘッダーの寸法(高さが負なら絶対値)。
 * - AVIF: `meta` / `iprp` / `ipco` の `ispe` のうち、面積が最大のもの(グリッド画像は全体の `ispe` が最大)。
 */
export async function readImageDimensions(
	reader: ByteReader,
	format: AcceptedFormat,
): Promise<ImageDimensions | null> {
	switch (format) {
		case "jpeg":
			return readJpegDimensions(reader);
		case "png":
			return readPngDimensions(reader);
		case "gif":
			return readGifDimensions(reader);
		case "webp":
			return readWebpDimensions(reader);
		case "bmp":
			return readBmpDimensions(reader);
		case "avif":
			return readAvifDimensions(reader);
		default:
			return null;
	}
}

/** SOF のマーカー(0xC0〜0xCF のうち、DHT 0xC4・JPG 0xC8・DAC 0xCC を除く) */
function isStartOfFrame(marker: number): boolean {
	return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

async function readJpegDimensions(reader: ByteReader): Promise<ImageDimensions | null> {
	// SOI(FF D8)の後から、マーカーを順にたどる
	let offset = 2;
	for (let step = 0; step < MAX_HEADER_STEPS; step += 1) {
		// マーカー(2)・長さ(2)・SOF の精度(1)・高さ(2)・幅(2)
		// oxlint-disable-next-line no-await-in-loop -- 次のマーカーの位置は、前のセグメントの長さで決まる
		const bytes = await reader.read(offset, 9);
		if (bytes.length < 2 || bytes[0] !== 0xff) return null;
		const marker = bytes[1] ?? 0;
		if (marker === 0xff) {
			// マーカーの前の詰め物
			offset += 1;
		} else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			// 長さを持たないマーカー(TEM・RST)
			offset += 2;
		} else if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) {
			// SOF より前の SOI・EOI・SOS は不正(寸法は分からない)
			return null;
		} else {
			if (bytes.length < 4) return null;
			const view = dataView(bytes);
			// 長さはマーカーの後の 2 バイトを含む。0 や 1 なら、次に読む位置が長さの欄の中になり、0xFF でないので null になる
			const length = view.getUint16(2);
			if (isStartOfFrame(marker)) {
				if (bytes.length < 9 || length < 7) return null;
				return positiveDimensions(view.getUint16(7), view.getUint16(5));
			}
			offset += 2 + length;
		}
	}
	return null;
}

async function readPngDimensions(reader: ByteReader): Promise<ImageDimensions | null> {
	// シグネチャ(8)・IHDR の長さ(4)・"IHDR"(4)・幅(4)・高さ(4)
	const bytes = await reader.read(0, 24);
	if (bytes.length < 24 || !startsWithAscii(bytes, 12, "IHDR")) return null;
	const view = dataView(bytes);
	return positiveDimensions(view.getUint32(16), view.getUint32(20));
}

async function readGifDimensions(reader: ByteReader): Promise<ImageDimensions | null> {
	// シグネチャ(6)・論理画面の幅(2)・高さ(2)・フラグ(1)・背景色(1)・縦横比(1)
	const header = await reader.read(0, 13);
	if (header.length < 13) return null;
	const view = dataView(header);
	const width = view.getUint16(6, true);
	const height = view.getUint16(8, true);
	const flags = view.getUint8(10);
	// グローバルカラーテーブル(3 × 2^(N+1) バイト)を飛ばす
	let offset = 13 + ((flags & 0x80) === 0 ? 0 : 3 * 2 ** ((flags & 0x07) + 1));
	for (let step = 0; step < MAX_HEADER_STEPS; step += 1) {
		// oxlint-disable-next-line no-await-in-loop -- 次のブロックの位置は、前のブロックの長さで決まる
		const block = await reader.read(offset, 10);
		const introducer = block[0];
		if (introducer === 0x2c && block.length >= 9) {
			// 最初のフレーム(イメージディスクリプター): 左(2)・上(2)・幅(2)・高さ(2)
			const frame = dataView(block);
			return positiveDimensions(
				Math.max(width, frame.getUint16(1, true) + frame.getUint16(5, true)),
				Math.max(height, frame.getUint16(3, true) + frame.getUint16(7, true)),
			);
		}
		if (introducer !== 0x21 || block.length < 3) break;
		// 拡張ブロック: 0x21・ラベル(1)の後に、長さ付きのサブブロックが 0 まで続く
		offset += 2;
		let length = block[2] ?? 0;
		while (length !== 0 && step < MAX_HEADER_STEPS) {
			offset += 1 + length;
			step += 1;
			// oxlint-disable-next-line no-await-in-loop -- 次のサブブロックの位置は、前のサブブロックの長さで決まる
			const next = await reader.read(offset, 1);
			if (next.length < 1) return positiveDimensions(width, height);
			length = next[0] ?? 0;
		}
		offset += 1;
	}
	return positiveDimensions(width, height);
}

async function readWebpDimensions(reader: ByteReader): Promise<ImageDimensions | null> {
	// RIFF ヘッダー(12)・最初のチャンクのヘッダー(8)・チャンクの先頭(10)
	const bytes = await reader.read(0, 30);
	if (bytes.length < 25) return null;
	const view = dataView(bytes);
	switch (fourCC(bytes, 12)) {
		case "VP8 ":
			// フレームタグ(3)・開始コード 9D 01 2A(3)・幅(2)・高さ(2)。上位 2 ビットは拡大の指定
			if (bytes.length < 30 || !startsWithBytes(bytes, 23, [0x9d, 0x01, 0x2a])) return null;
			return positiveDimensions(
				view.getUint16(26, true) & 0x3fff,
				view.getUint16(28, true) & 0x3fff,
			);
		case "VP8L": {
			// シグネチャ 0x2F(1)・幅 - 1(14 ビット)・高さ - 1(14 ビット)
			if (view.getUint8(20) !== 0x2f) return null;
			const bits = view.getUint32(21, true);
			return positiveDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
		}
		case "VP8X":
			// フラグ(1)・予約(3)・キャンバスの幅 - 1(3)・高さ - 1(3)
			if (bytes.length < 30) return null;
			return positiveDimensions(readUint24(view, 24) + 1, readUint24(view, 27) + 1);
		default:
			return null;
	}
}

async function readBmpDimensions(reader: ByteReader): Promise<ImageDimensions | null> {
	// ファイルヘッダー(14)・DIB ヘッダーのバイト数(4)・幅・高さ(OS/2 1.x は 2 バイトずつ、それ以外は 4 バイトずつ)
	const bytes = await reader.read(0, 26);
	if (bytes.length < 22) return null;
	const view = dataView(bytes);
	if (view.getUint32(14, true) === 12) {
		return positiveDimensions(view.getUint16(18, true), view.getUint16(20, true));
	}
	if (bytes.length < 26) return null;
	// 高さが負なら、上の行から並ぶ(寸法は絶対値)
	return positiveDimensions(Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true)));
}

/** ISOBMFF のボックス。`start` は中身の先頭、`end` はボックスの末尾 */
interface Box {
	readonly type: string;
	readonly start: number;
	readonly end: number;
}

async function readAvifDimensions(reader: ByteReader): Promise<ImageDimensions | null> {
	const steps = { count: 0 };
	const meta = await findBox(reader, 0, reader.size, "meta", steps);
	// meta は FullBox(バージョンとフラグの 4 バイトの後に子ボックスが続く)
	const iprp =
		meta === null ? null : await findBox(reader, meta.start + 4, meta.end, "iprp", steps);
	const ipco = iprp === null ? null : await findBox(reader, iprp.start, iprp.end, "ipco", steps);
	if (ipco === null) return null;
	let largest: ImageDimensions | null = null;
	let offset = ipco.start;
	while (offset < ipco.end && steps.count < MAX_HEADER_STEPS) {
		steps.count += 1;
		// oxlint-disable-next-line no-await-in-loop -- 次のボックスの位置は、前のボックスの大きさで決まる
		const box = await readBoxHeader(reader, offset, ipco.end);
		if (box === null) break;
		if (box.type === "ispe" && box.end - box.start >= 12) {
			// ispe は FullBox: バージョンとフラグ(4)・幅(4)・高さ(4)
			// oxlint-disable-next-line no-await-in-loop -- ispe の中身は、見つけたボックスごとに読む
			const bytes = await reader.read(box.start, 12);
			if (bytes.length === 12) {
				const view = dataView(bytes);
				const found = positiveDimensions(view.getUint32(4), view.getUint32(8));
				if (
					found !== null &&
					(largest === null || found.width * found.height > largest.width * largest.height)
				) {
					largest = found;
				}
			}
		}
		offset = box.end;
	}
	return largest;
}

/** `[start, end)` の範囲の子ボックスから、`type` のボックスを探す */
async function findBox(
	reader: ByteReader,
	start: number,
	end: number,
	type: string,
	steps: { count: number },
): Promise<Box | null> {
	let offset = start;
	while (offset < end && steps.count < MAX_HEADER_STEPS) {
		steps.count += 1;
		// oxlint-disable-next-line no-await-in-loop -- 次のボックスの位置は、前のボックスの大きさで決まる
		const box = await readBoxHeader(reader, offset, end);
		if (box === null) return null;
		if (box.type === type) return box;
		offset = box.end;
	}
	return null;
}

/** ボックスのヘッダー(大きさ(4)・種類(4)、大きさが 1 なら 64 ビットの大きさ(8)が続く)を読む。不正なら null */
async function readBoxHeader(
	reader: ByteReader,
	offset: number,
	limit: number,
): Promise<Box | null> {
	const bytes = await reader.read(offset, 16);
	if (bytes.length < 8) return null;
	const view = dataView(bytes);
	let size = view.getUint32(0);
	let headerSize = 8;
	if (size === 1) {
		if (bytes.length < 16) return null;
		size = view.getUint32(8) * 2 ** 32 + view.getUint32(12);
		headerSize = 16;
	} else if (size === 0) {
		// 0 は「親の末尾まで」
		size = limit - offset;
	}
	if (size < headerSize || offset + size > limit) return null;
	return { type: fourCC(bytes, 4), start: offset + headerSize, end: offset + size };
}

function positiveDimensions(width: number, height: number): ImageDimensions | null {
	return width > 0 && height > 0 ? { width, height } : null;
}

// ---------------------------------------------------------------------------
// デコードの前の判定
// ---------------------------------------------------------------------------

/** デコードの前の判定の結果 */
export interface InputInspection {
	/** 先頭のバイトから判定した形式 */
	readonly format: AcceptedFormat;
	/** 形式の MIME タイプ(`File.type` ではない) */
	readonly mimeType: string;
	/** ヘッダーから読んだ寸法(EXIF の向きは反映しない)。読めなければ null(デコードしたあとで画素数を確かめる) */
	readonly dimensions: ImageDimensions | null;
	/** 利用者に伝える注意。GIF は `GIF_FIRST_FRAME_ONLY`(アニメーションかどうかは見ない) */
	readonly notices: readonly NoticeCode[];
}

/**
 * デコードする前に、形式・ファイルのバイト数・画素数を判定する(仕様書 6.5)。
 *
 * 順番: 空のファイル → 形式(`judgeInputFormat`)→ ファイルのバイト数 → ヘッダーから読んだ画素数。
 * 形式を先に判定するのは、40MB を超える HEIC などに、変換の案内を出すため。読むのは先頭の 64KiB と、ヘッダーの場所だけ。
 *
 * 失敗したら `Base64ImageError` で reject する: 空・中身が合わない・読み込めない → `INPUT_DECODE_FAILED`、
 * HEIC / HEIF → `INPUT_HEIC_REJECTED`、SVG → `INPUT_SVG_REJECTED`、TIFF など → `INPUT_FORMAT_REJECTED`、
 * `MAX_INPUT_FILE_BYTES` を超える → `INPUT_FILE_TOO_LARGE`、`MAX_INPUT_PIXELS` を超える → `INPUT_TOO_MANY_PIXELS`。
 * `signal` が中断されたら、`signal.reason` で reject する。
 */
export async function inspectInputFile(file: File, signal?: AbortSignal): Promise<InputInspection> {
	signal?.throwIfAborted();
	const described = { mimeType: file.type, fileBytes: file.size };
	if (file.size === 0) {
		throw new Base64ImageError("INPUT_DECODE_FAILED", "The file is empty", { details: described });
	}
	const reader = createBlobReader(file, signal);
	try {
		const detected = sniffImageFormat(await reader.read(0, READ_WINDOW_BYTES));
		const details = { ...described, detectedFormat: detected ?? "unknown" };
		const judgement = judgeInputFormat(detected, file.type);
		// `=== false` で比べる(利用者の設定で strictNullChecks が無効でも絞り込まれるように)。
		if (judgement.ok === false) {
			throw new Base64ImageError(
				judgement.code,
				`Unsupported input: detected ${details.detectedFormat}, type "${file.type}"`,
				{ details },
			);
		}
		if (file.size > MAX_INPUT_FILE_BYTES) {
			throw new Base64ImageError(
				"INPUT_FILE_TOO_LARGE",
				`The file is larger than ${MAX_INPUT_FILE_BYTES} bytes`,
				{ details: { ...details, maxFileBytes: MAX_INPUT_FILE_BYTES } },
			);
		}
		const { format } = judgement;
		const dimensions = await readImageDimensions(reader, format);
		if (dimensions !== null) assertPixelLimit(dimensions, details);
		return {
			format,
			mimeType: FORMAT_MIME_TYPES[format],
			dimensions,
			notices: format === "gif" ? ["GIF_FIRST_FRAME_ONLY"] : [],
		};
	} catch (error) {
		// 中断で失敗したときは、signal.reason にする
		signal?.throwIfAborted();
		if (isBase64ImageError(error)) throw error;
		throw new Base64ImageError("INPUT_DECODE_FAILED", "Could not read the file", {
			cause: error,
			details: described,
		});
	}
}

function assertPixelLimit({ width, height }: ImageDimensions, details: ErrorDetails): void {
	if (width * height > MAX_INPUT_PIXELS) {
		throw new Base64ImageError(
			"INPUT_TOO_MANY_PIXELS",
			`The image has ${width}x${height} pixels (limit ${MAX_INPUT_PIXELS})`,
			{ details: { ...details, width, height, maxPixels: MAX_INPUT_PIXELS } },
		);
	}
}

// ---------------------------------------------------------------------------
// デコード
// ---------------------------------------------------------------------------

/** `createDecodeImage` が使うブラウザの機能。テストでは偽物を渡す */
export interface DecodeImageEnvironment {
	/** 既定は `globalThis.createImageBitmap` */
	readonly createImageBitmap?: (
		image: ImageBitmapSource,
		options: ImageBitmapOptions,
	) => Promise<ImageBitmap>;
}

/**
 * 入力ファイルを判定してデコードする関数(`DecodeImage`)を作る。
 *
 * 1. `inspectInputFile` で形式・ファイルのバイト数・ヘッダーの画素数を判定する。
 * 2. `createImageBitmap(file, { imageOrientation: "from-image" })` でデコードする。寸法は EXIF の向きを反映したもの。
 *    失敗したら `INPUT_DECODE_FAILED`(元のエラーは `cause`)。
 * 3. デコードした画素数が `MAX_INPUT_PIXELS` を超えたら(ヘッダーを読めなかった画像)、閉じてから `INPUT_TOO_MANY_PIXELS`。
 *
 * - `signal` が中断されたら、デコードの完了を待たずに `signal.reason` で reject する。あとで届いた ImageBitmap は閉じる。
 *   ただし Firefox 155 はデコードの間に主スレッドを止めるので、デコード中の中断はデコードが終わってから届き、
 *   この関数は resolve する。呼び出し側は、結果を必ず `close()` する(`try` / `finally`)。
 * - 返した `DecodedImage` の `close()` で ImageBitmap を閉じる。何度呼んでもよい。
 */
export function createDecodeImage(environment: DecodeImageEnvironment = {}): DecodeImage {
	const decode =
		environment.createImageBitmap ??
		((image: ImageBitmapSource, options: ImageBitmapOptions) => createImageBitmap(image, options));

	return async (file, options = {}) => {
		const { signal } = options;
		const inspection = await inspectInputFile(file, signal);
		const details = {
			mimeType: file.type,
			fileBytes: file.size,
			detectedFormat: inspection.format,
		};
		let bitmap: ImageBitmap;
		try {
			bitmap = await abortable(decode(file, { imageOrientation: "from-image" }), signal, (late) => {
				late.close();
			});
		} catch (error) {
			// 中断で失敗したときは、INPUT_DECODE_FAILED に包まずに signal.reason にする
			signal?.throwIfAborted();
			throw new Base64ImageError("INPUT_DECODE_FAILED", "The browser could not decode the image", {
				cause: error,
				details,
			});
		}
		const { width, height } = bitmap;
		try {
			if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
				throw new Base64ImageError("INPUT_DECODE_FAILED", `Invalid size: ${width}x${height}`, {
					details,
				});
			}
			// ヘッダーから寸法を読めなかった画像は、ここで初めて画素数が分かる
			assertPixelLimit({ width, height }, details);
		} catch (error) {
			bitmap.close();
			throw error;
		}
		return toDecodedImage(bitmap, file, inspection);
	};
}

function isPositiveInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 1;
}

function toDecodedImage(
	bitmap: ImageBitmap,
	file: File,
	inspection: InputInspection,
): DecodedImage {
	let closed = false;
	return {
		source: bitmap,
		width: bitmap.width,
		height: bitmap.height,
		mimeType: inspection.mimeType,
		filename: file.name,
		fileBytes: file.size,
		notices: inspection.notices,
		close() {
			if (closed) return;
			closed = true;
			bitmap.close();
		},
	};
}

/**
 * 入力ファイルの形式と上限を判定し、`createImageBitmap` でデコードする(仕様書 6.5)。
 * `createDecodeImage()` で作ったもの。エラーのコードと中断の扱いは `createDecodeImage` を参照。
 */
export const decodeImage: DecodeImage = createDecodeImage();

// ---------------------------------------------------------------------------
// バイト列の補助
// ---------------------------------------------------------------------------

function dataView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function startsWithBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
	if (bytes.length < offset + expected.length) return false;
	return expected.every((value, index) => bytes[offset + index] === value);
}

function startsWithAscii(bytes: Uint8Array, offset: number, text: string): boolean {
	if (bytes.length < offset + text.length) return false;
	for (let index = 0; index < text.length; index += 1) {
		if (bytes[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}

/** 4 バイトの種類(FourCC)を文字列にする */
function fourCC(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function readUint24(view: DataView, offset: number): number {
	return view.getUint16(offset, true) | (view.getUint8(offset + 2) << 16);
}
