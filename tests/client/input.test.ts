/**
 * T12: 入力画像の判定とデコード(src/client/input.ts)の単体テスト。
 *
 * jsdom には createImageBitmap が無いので、判定のロジックとデコードの呼び出しを分けて確かめる。
 * - 判定(先頭のバイト・File.type・ヘッダーの寸法)は、テストの中で組み立てたバイト列の File で確かめる。
 *   WebP は T04 のフィクスチャ(tests/fixtures/webp)を使い、T04 の parseWebp と寸法が一致することも確かめる。
 * - デコードは、createDecodeImage に偽の createImageBitmap を渡して、呼び方・結果・エラー・中断を確かめる。
 * - 実ブラウザ(Chromium 153・Firefox 155)での結果は docs/input-image-decode.md。
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi, type Mock } from "vitest";

import {
	createBlobReader,
	createDecodeImage,
	decodeImage,
	formatFromMimeType,
	inspectInputFile,
	judgeInputFormat,
	readImageDimensions,
	sniffImageFormat,
	type AcceptedFormat,
	type ByteReader,
	type DecodeImageEnvironment,
	type InputFormat,
} from "../../src/client/input";
import { MAX_INPUT_FILE_BYTES, MAX_INPUT_PIXELS } from "../../src/shared/constants";
import { Base64ImageError } from "../../src/shared/errors";
import { parseWebp } from "../../src/shared/webp";

// ---------------------------------------------------------------------------
// バイト列を組み立てる部品
// ---------------------------------------------------------------------------

/** Blob に渡せるバイト列(`Uint8Array<ArrayBufferLike>` は `BlobPart` にならない) */
type Bytes = Uint8Array<ArrayBuffer>;

type Part = Uint8Array | readonly number[] | string;

function bytes(...parts: readonly Part[]): Bytes {
	const arrays = parts.map((part) =>
		typeof part === "string"
			? Uint8Array.from(part, (c) => c.charCodeAt(0))
			: Uint8Array.from(part),
	);
	const out = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
	let offset = 0;
	for (const array of arrays) {
		out.set(array, offset);
		offset += array.length;
	}
	return out;
}

const u16be = (value: number): number[] => [(value >>> 8) & 0xff, value & 0xff];
const u16le = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
const u24le = (value: number): number[] => [
	value & 0xff,
	(value >>> 8) & 0xff,
	(value >>> 16) & 0xff,
];
const u32be = (value: number): number[] => [
	(value >>> 24) & 0xff,
	(value >>> 16) & 0xff,
	(value >>> 8) & 0xff,
	value & 0xff,
];
const u32le = (value: number): number[] => [
	value & 0xff,
	(value >>> 8) & 0xff,
	(value >>> 16) & 0xff,
	(value >>> 24) & 0xff,
];
const zeros = (length: number): number[] => Array.from({ length }, () => 0);

function hex(text: string): Bytes {
	return Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

// JPEG ------------------------------------------------------------------------

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/** 長さ付きのセグメント(中身は fill で埋める) */
function segment(marker: number, payloadLength: number, fill = 0): number[] {
	return [
		0xff,
		marker,
		...u16be(payloadLength + 2),
		...Array.from({ length: payloadLength }, () => fill),
	];
}

/** SOF セグメント(3 成分) */
function sof(width: number, height: number, marker = 0xc0): number[] {
	return [0xff, marker, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3, ...zeros(9)];
}

function jpeg(...parts: readonly Part[]): Bytes {
	return bytes(SOI, ...parts, EOI);
}

// PNG -------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(width: number, height: number): Bytes {
	return bytes(
		PNG_SIGNATURE,
		u32be(13),
		"IHDR",
		u32be(width),
		u32be(height),
		[8, 6, 0, 0, 0],
		u32be(0),
		u32be(0),
		"IEND",
		u32be(0),
	);
}

// GIF -------------------------------------------------------------------------

interface GifOptions {
	readonly screen: readonly [number, number];
	/** グローバルカラーテーブルの大きさの指数 N(2^(N+1) 色)。null なら無し */
	readonly colorTableBits?: number | null;
	readonly blocks?: readonly (readonly number[])[];
}

function gif({ screen, colorTableBits = null, blocks = [] }: GifOptions): Bytes {
	const flags = colorTableBits === null ? 0 : 0x80 | colorTableBits;
	const table = colorTableBits === null ? [] : zeros(3 * 2 ** (colorTableBits + 1));
	return bytes(
		"GIF89a",
		u16le(screen[0]),
		u16le(screen[1]),
		[flags, 0, 0],
		table,
		...blocks,
		[0x3b],
	);
}

function gifFrame(left: number, top: number, width: number, height: number): number[] {
	return [
		0x2c,
		...u16le(left),
		...u16le(top),
		...u16le(width),
		...u16le(height),
		0,
		2,
		2,
		0x44,
		0x01,
		0,
	];
}

/** 拡張ブロック: 0x21・ラベル・長さ付きのサブブロック・終端の 0 */
function gifExtension(label: number, ...subBlocks: readonly (readonly number[])[]): number[] {
	const out = [0x21, label];
	for (const block of subBlocks) out.push(block.length, ...block);
	out.push(0);
	return out;
}

// WebP ------------------------------------------------------------------------

function riff(fourcc: string, payload: readonly number[]): Bytes {
	return bytes(
		"RIFF",
		u32le(4 + 8 + payload.length),
		"WEBP",
		fourcc,
		u32le(payload.length),
		payload,
	);
}

/** `VP8 `。上位 2 ビット(拡大の指定)を入れられる */
function webpVp8(width: number, height: number, scale = 0): Bytes {
	return riff("VP8 ", [
		0x10,
		0x02,
		0x00,
		0x9d,
		0x01,
		0x2a,
		...u16le(width | (scale << 14)),
		...u16le(height | (scale << 14)),
		...zeros(10),
	]);
}

function webpVp8l(width: number, height: number): Bytes {
	const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
	return riff("VP8L", [0x2f, ...u32le(bits), ...zeros(10)]);
}

function webpVp8x(width: number, height: number): Bytes {
	return riff("VP8X", [0x10, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]);
}

// BMP -------------------------------------------------------------------------

function bmp(headerSize: number, width: number, height: number): Bytes {
	const dib =
		headerSize === 12
			? [...u32le(12), ...u16le(width), ...u16le(height), ...u16le(1), ...u16le(24)]
			: [...u32le(headerSize), ...u32le(width), ...u32le(height), ...u16le(1), ...u16le(24)];
	const padded = [...dib, ...zeros(Math.max(0, headerSize - dib.length))];
	return bytes("BM", u32le(14 + padded.length), zeros(4), u32le(14 + padded.length), padded);
}

// ISOBMFF(AVIF / HEIF) --------------------------------------------------------

function box(type: string, ...payload: readonly Part[]): Bytes {
	const body = bytes(...payload);
	return bytes(u32be(8 + body.length), type, body);
}

/** バージョンとフラグ(4 バイト)を持つボックス */
function fullBox(type: string, ...payload: readonly Part[]): Bytes {
	return box(type, zeros(4), ...payload);
}

function ftyp(major: string, ...compatible: readonly string[]): Bytes {
	return box("ftyp", major, u32be(0), ...compatible);
}

function ispe(width: number, height: number): Bytes {
	return fullBox("ispe", u32be(width), u32be(height));
}

const HDLR = fullBox("hdlr", u32be(0), "pict", zeros(12), [0]);

/** AVIF: ftyp・meta(hdlr・iprp/ipco に子ボックス)・mdat */
function avif(...ipcoChildren: readonly Uint8Array[]): Bytes {
	return bytes(
		ftyp("avif", "mif1", "avif", "miaf"),
		fullBox("meta", HDLR, box("iprp", box("ipco", ...ipcoChildren))),
		box("mdat", [1, 2, 3, 4]),
	);
}

/**
 * T04 の WebP のフィクスチャ。jsdom の環境では URL が jsdom のものになり、node:fs が file: の URL として
 * 受け付けないので、パスで指定する
 */
const WEBP_FIXTURES = join(import.meta.dirname, "../fixtures/webp");

/** 実際のファイルの ftyp(T12 のサンプル。macOS の sips・heif-enc(x265 / aom)で作った) */
const REAL_FTYP = {
	heicSips: hex("000000246674797068656978000000006d6966314d6950724d6948416d69616668656978"),
	heicX265: hex("0000001c6674797068656963000000006d696631686569636d696166"),
	avif: hex("0000001c6674797061766966000000006d696631617669666d696166"),
};

// ファイル --------------------------------------------------------------------

function fileOf(content: Bytes, name = "image", type = ""): File {
	return new File([content], name, { type });
}

/** `size` だけを大きく見せる File(中身は小さいまま。上限の判定に使う) */
function withSize(file: File, size: number): File {
	Object.defineProperty(file, "size", { value: size });
	return file;
}

async function dimensionsOf(content: Bytes, format: AcceptedFormat) {
	return readImageDimensions(createBlobReader(new Blob([content])), format);
}

/** `read` を呼んだ回数を数える ByteReader(ヘッダーを探す手間の上限を確かめる) */
function countingReader(content: Bytes): { readonly reader: ByteReader; reads(): number } {
	const inner = createBlobReader(new Blob([content]));
	let count = 0;
	return {
		reader: {
			size: inner.size,
			read: (offset, length) => {
				count += 1;
				return inner.read(offset, length);
			},
		},
		reads: () => count,
	};
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

async function codeOf(promise: Promise<unknown>): Promise<string> {
	const error = await caught(promise);
	expect(error).toBeInstanceOf(Base64ImageError);
	return (error as Base64ImageError).code;
}

// 偽の createImageBitmap --------------------------------------------------------

interface FakeBitmap {
	width: number;
	height: number;
	readonly close: Mock<() => void>;
}

/** close() で幅と高さが 0 になる(実際の ImageBitmap と同じ) */
function fakeBitmap(width: number, height: number): FakeBitmap {
	const bitmap: FakeBitmap = {
		width,
		height,
		close: vi.fn<() => void>(() => {
			bitmap.width = 0;
			bitmap.height = 0;
		}),
	};
	return bitmap;
}

interface FakeDecoder {
	readonly environment: DecodeImageEnvironment;
	readonly calls: { image: ImageBitmapSource; options: ImageBitmapOptions }[];
}

function fakeDecoder(result: (image: ImageBitmapSource) => Promise<FakeBitmap>): FakeDecoder {
	const calls: FakeDecoder["calls"] = [];
	return {
		calls,
		environment: {
			createImageBitmap: async (image, options) => {
				calls.push({ image, options });
				return (await result(image)) as unknown as ImageBitmap;
			},
		},
	};
}

const decodesTo = (width: number, height: number) =>
	fakeDecoder(async () => fakeBitmap(width, height));

// ---------------------------------------------------------------------------
// 先頭のバイトによる判定
// ---------------------------------------------------------------------------

describe("sniffImageFormat", () => {
	const cases: [string, Uint8Array, InputFormat | null][] = [
		["JPEG", jpeg(sof(4, 2)), "jpeg"],
		["PNG", png(4, 2), "png"],
		["GIF87a", bytes("GIF87a", zeros(10)), "gif"],
		["GIF89a", gif({ screen: [4, 2] }), "gif"],
		["WebP(VP8)", webpVp8(4, 2), "webp"],
		["WebP(VP8L)", webpVp8l(4, 2), "webp"],
		["BMP(BITMAPINFOHEADER)", bmp(40, 4, 2), "bmp"],
		["BMP(BITMAPCOREHEADER)", bmp(12, 4, 2), "bmp"],
		["BMP(BITMAPV5HEADER)", bmp(124, 4, 2), "bmp"],
		["BMP(OS/2 2.x、16 バイト)", bmp(16, 4, 2), "bmp"],
		["TIFF(リトルエンディアン)", bytes("II*\0", zeros(8)), "tiff"],
		["TIFF(ビッグエンディアン)", bytes("MM\0*", zeros(8)), "tiff"],
		["BigTIFF", bytes("II+\0", zeros(8)), "tiff"],
		["BigTIFF(ビッグエンディアン)", bytes("MM\0+", zeros(8)), "tiff"],
		["AVIF(実際のファイル)", REAL_FTYP.avif, "avif"],
		["AVIF(major brand が mif1、compatible に avif)", ftyp("mif1", "miaf", "avif"), "avif"],
		["AVIF のシーケンス(avis)", ftyp("avis", "msf1", "avis"), "avif"],
		["HEIC(iPhone と同じ heic。heif-enc)", REAL_FTYP.heicX265, "heif"],
		["HEIC(macOS の sips。heix)", REAL_FTYP.heicSips, "heif"],
		["HEIF(mif1 だけ)", ftyp("mif1", "mif1"), "heif"],
		["HEIF のシーケンス(msf1)", ftyp("msf1", "msf1", "hevc"), "heif"],
		["SVG", bytes('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), "svg"],
		[
			"SVG(XML 宣言・コメント・DOCTYPE の後)",
			bytes(
				'<?xml version="1.0"?>\n<!-- c -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg>',
			),
			"svg",
		],
		["SVG(BOM と空白の後)", bytes([0xef, 0xbb, 0xbf], "\n  <svg\n width='1'>"), "svg"],
		["SVG(名前空間の接頭辞)", bytes('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>'), "svg"],
		["空", new Uint8Array(0), null],
		["ICO", bytes([0, 0, 1, 0, 1, 0], zeros(16)), null],
		["MP4(ftyp isom)", ftyp("isom", "isom", "mp41"), null],
		["テキスト", bytes("hello, world"), null],
		["HTML(svg を含まない)", bytes("<!doctype html><html><body>x</body></html>"), null],
		[
			"XML(svg 以外の要素。<svgfoo> は svg ではない)",
			bytes("<?xml version='1.0'?><svgfoo/>"),
			null,
		],
		["BM で始まるテキスト", bytes("BMW specifications"), null],
		["BMP のヘッダーの大きさが不正(13)", bmp(13, 4, 2), null],
		["BMP のヘッダーの大きさが不正(125)", bmp(125, 4, 2), null],
		["BMP のヘッダーが途中まで", bytes("BM", zeros(14)), null],
		["JPEG のシグネチャが 2 バイトだけ", bytes([0xff, 0xd8]), null],
		["PNG のシグネチャが 7 バイトだけ", bytes(PNG_SIGNATURE.slice(0, 7)), null],
		[
			"PNG のシグネチャの 8 バイト目が違う",
			bytes(PNG_SIGNATURE.slice(0, 7), [0x0b], zeros(8)),
			null,
		],
		["GIF のシグネチャが途中まで", bytes("GIF8"), null],
		["GIF のバージョンが不明", bytes("GIF90a", zeros(10)), null],
		["RIFF の WAVE", bytes("RIFF", u32le(4), "WAVE"), null],
		["ftyp が短すぎる(12 バイト)", bytes(u32be(12), "ftyp", "avif"), null],
		["ftyp の大きさが 16 未満", bytes(u32be(12), "ftyp", "avif", u32be(0)), null],
	];

	it.each(cases)("%s", (_name, head, expected) => {
		expect(sniffImageFormat(head)).toBe(expected);
	});

	it("AVIF の brand と HEIF の brand の両方があれば、AVIF とする", () => {
		expect(sniffImageFormat(ftyp("heic", "mif1", "heic", "avif"))).toBe("avif");
	});

	it("major brand だけでも判定する(compatible brands が空)", () => {
		expect(sniffImageFormat(ftyp("avif"))).toBe("avif");
		expect(sniffImageFormat(ftyp("heic"))).toBe("heif");
	});

	it.each(["avif", "avis"])("AVIF の brand %s だけで AVIF とする", (brand) => {
		expect(sniffImageFormat(ftyp("isom", brand))).toBe("avif");
	});

	it.each([
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
	])("HEIF の brand %s だけで HEIF とする", (brand) => {
		expect(sniffImageFormat(ftyp("isom", brand))).toBe("heif");
	});

	it("ftyp の大きさより後ろの brand は読まない", () => {
		// ftyp の大きさは 20(compatible brands は mif1 の 1 つだけ)。続く avif は次のボックスの中身
		const head = bytes(u32be(20), "ftyp", "mif1", u32be(0), "mif1", u32be(12), "free", "avif");
		expect(sniffImageFormat(head)).toBe("heif");
	});

	it("SVG は先頭の 4,096 バイトの中だけを探す", () => {
		const comment = `<!--${"x".repeat(4_096)}-->`;
		expect(sniffImageFormat(bytes(`${comment}<svg/>`))).toBeNull();
		expect(sniffImageFormat(bytes(`<!--${"x".repeat(4_000)}--><svg/>`))).toBe("svg");
	});

	it("SVG は、先頭が < でなければ判定しない", () => {
		expect(sniffImageFormat(bytes("text before <svg>"))).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// MIME タイプと形式の判定
// ---------------------------------------------------------------------------

describe("formatFromMimeType", () => {
	it.each([
		["image/jpeg", "jpeg"],
		["image/jpg", "jpeg"],
		["image/pjpeg", "jpeg"],
		["image/png", "png"],
		["image/apng", "png"],
		["image/gif", "gif"],
		["image/webp", "webp"],
		["image/avif", "avif"],
		["image/bmp", "bmp"],
		["image/x-ms-bmp", "bmp"],
		["image/heic", "heif"],
		["image/heif", "heif"],
		["image/heic-sequence", "heif"],
		["image/heif-sequence", "heif"],
		["image/svg+xml", "svg"],
		["image/tiff", "tiff"],
		["IMAGE/HEIC", "heif"],
		[" image/svg+xml ; charset=utf-8", "svg"],
		["", null],
		["image/x-icon", null],
		["image/vnd.microsoft.icon", null],
		["image/jxl", null],
		["application/octet-stream", null],
	] as const)("%j → %s", (mimeType, expected) => {
		expect(formatFromMimeType(mimeType)).toBe(expected);
	});
});

describe("judgeInputFormat", () => {
	it.each(["jpeg", "png", "gif", "webp", "avif", "bmp"] as const)(
		"中身が %s なら、File.type に関係なく受け付ける",
		(format) => {
			for (const mimeType of ["", "image/heic", "image/svg+xml", "text/plain", "image/png"]) {
				expect(judgeInputFormat(format, mimeType)).toEqual({ ok: true, format });
			}
		},
	);

	it.each([
		["heif", "image/jpeg", "INPUT_HEIC_REJECTED"],
		["heif", "", "INPUT_HEIC_REJECTED"],
		["svg", "image/png", "INPUT_SVG_REJECTED"],
		["svg", "", "INPUT_SVG_REJECTED"],
		["tiff", "image/jpeg", "INPUT_FORMAT_REJECTED"],
		["tiff", "image/tiff", "INPUT_FORMAT_REJECTED"],
	] as const)("中身が %s(File.type %j)なら %s", (detected, mimeType, code) => {
		expect(judgeInputFormat(detected, mimeType)).toEqual({ ok: false, code });
	});

	it.each([
		["image/heic", "INPUT_HEIC_REJECTED"],
		["image/heif", "INPUT_HEIC_REJECTED"],
		["image/svg+xml", "INPUT_SVG_REJECTED"],
		["image/jpeg", "INPUT_DECODE_FAILED"],
		["image/png", "INPUT_DECODE_FAILED"],
		["image/gif", "INPUT_DECODE_FAILED"],
		["image/webp", "INPUT_DECODE_FAILED"],
		["image/avif", "INPUT_DECODE_FAILED"],
		["image/bmp", "INPUT_DECODE_FAILED"],
		["image/tiff", "INPUT_FORMAT_REJECTED"],
		["image/x-icon", "INPUT_FORMAT_REJECTED"],
		["", "INPUT_FORMAT_REJECTED"],
		["text/plain", "INPUT_FORMAT_REJECTED"],
	] as const)("中身で判定できず File.type が %j なら %s", (mimeType, code) => {
		expect(judgeInputFormat(null, mimeType)).toEqual({ ok: false, code });
	});
});

// ---------------------------------------------------------------------------
// ファイルの読み込み
// ---------------------------------------------------------------------------

describe("createBlobReader", () => {
	const content = Uint8Array.from({ length: 200_000 }, (_, i) => i % 251);

	it("範囲を読み、末尾を超える分は含めない", async () => {
		const reader = createBlobReader(new Blob([content]));
		expect(reader.size).toBe(200_000);
		expect(Array.from(await reader.read(10, 3))).toEqual([10, 11, 12]);
		expect(Array.from(await reader.read(199_998, 10))).toEqual([199_998 % 251, 199_999 % 251]);
		expect((await reader.read(200_000, 10)).length).toBe(0);
		expect((await reader.read(5, 0)).length).toBe(0);
		expect(Array.from(await reader.read(-2, 3))).toEqual([0, 1, 2]);
	});

	it("最後に読んだ 64KiB の中は、読み込み直さない", async () => {
		const blob = new Blob([content]);
		const slice = vi.spyOn(blob, "slice");
		const reader = createBlobReader(blob);
		await reader.read(0, 4);
		await reader.read(100, 20);
		await reader.read(65_530, 6);
		expect(slice).toHaveBeenCalledTimes(1);
		expect(slice).toHaveBeenLastCalledWith(0, 65_536);
		// 範囲の外は、そこから 64KiB を読み込む
		expect(Array.from(await reader.read(65_535, 2))).toEqual([65_535 % 251, 65_536 % 251]);
		expect(slice).toHaveBeenCalledTimes(2);
		expect(slice).toHaveBeenLastCalledWith(65_535, 131_071);
		// 64KiB より大きい範囲は、その範囲を一度に読む
		expect((await reader.read(0, 100_000)).length).toBe(100_000);
		expect(slice).toHaveBeenLastCalledWith(0, 100_000);
	});

	it("末尾から先や長さ 0 の読み込みでは、Blob を読まず、覚えた範囲も捨てない", async () => {
		const blob = new Blob([content]);
		const slice = vi.spyOn(blob, "slice");
		const reader = createBlobReader(blob);
		await reader.read(150_000, 4);
		expect(slice).toHaveBeenCalledTimes(1);
		expect((await reader.read(200_000, 10)).length).toBe(0);
		expect((await reader.read(300_000, 10)).length).toBe(0);
		expect((await reader.read(5, 0)).length).toBe(0);
		expect(slice).toHaveBeenCalledTimes(1);
		expect(Array.from(await reader.read(150_001, 2))).toEqual([150_001 % 251, 150_002 % 251]);
		expect(slice).toHaveBeenCalledTimes(1);
	});

	it("中断されたら、読み込みの完了を待たずに signal.reason で reject する", async () => {
		const pending = { size: 10, slice: () => ({ arrayBuffer: () => new Promise(() => {}) }) };
		const controller = new AbortController();
		const reader = createBlobReader(pending as unknown as Blob, controller.signal);
		const reading = reader.read(0, 4);
		controller.abort();
		expect(await caught(reading)).toBe(controller.signal.reason);
	});
});

// ---------------------------------------------------------------------------
// ヘッダーから寸法を読む
// ---------------------------------------------------------------------------

describe("readImageDimensions: JPEG", () => {
	it("SOI の直後の SOF0 から幅と高さを読む", async () => {
		expect(await dimensionsOf(jpeg(sof(300, 199)), "jpeg")).toEqual({ width: 300, height: 199 });
	});

	it("APP0・APP1(EXIF)・DQT・DHT・COM を長さで読み飛ばす", async () => {
		const content = jpeg(
			segment(0xe0, 14, 0xc0),
			segment(0xe1, 3_000, 0xc0),
			segment(0xdb, 67),
			segment(0xc4, 30),
			segment(0xfe, 100, 0xff),
			sof(640, 480),
		);
		expect(await dimensionsOf(content, "jpeg")).toEqual({ width: 640, height: 480 });
	});

	it.each([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])(
		"SOF のマーカー 0x%s を読む",
		async (marker) => {
			expect(await dimensionsOf(jpeg(sof(33, 22, marker)), "jpeg")).toEqual({
				width: 33,
				height: 22,
			});
		},
	);

	it.each([0xc4, 0xc8, 0xcc])("0x%s は SOF ではない(長さで読み飛ばす)", async (marker) => {
		const content = jpeg(
			[0xff, marker, ...u16be(9), ...u16be(1_000), ...u16be(2_000), 0, 0, 0],
			sof(3, 2),
		);
		expect(await dimensionsOf(content, "jpeg")).toEqual({ width: 3, height: 2 });
	});

	it("マーカーの前の詰め物(0xFF)と、長さを持たないマーカー(TEM・RST)を読み飛ばす", async () => {
		const content = jpeg([0xff, 0xff, 0xff], [0xff, 0x01], [0xff, 0xd0], [0xff, 0xd7], sof(8, 6));
		expect(await dimensionsOf(content, "jpeg")).toEqual({ width: 8, height: 6 });
	});

	it("SOF が 64KiB より後ろにあっても読む", async () => {
		const content = jpeg(
			segment(0xfe, 60_000),
			segment(0xfe, 60_000),
			segment(0xe2, 60_000),
			sof(4000, 3000),
		);
		expect(await dimensionsOf(content, "jpeg")).toEqual({ width: 4000, height: 3000 });
	});

	it("幅・高さは 16 ビットの最大(65,535)まで読む", async () => {
		expect(await dimensionsOf(jpeg(sof(65_535, 65_535)), "jpeg")).toEqual({
			width: 65_535,
			height: 65_535,
		});
	});

	it.each([
		// SOS・EOI・SOI の後に長さらしい値を置き、読み飛ばすと SOF が見つかる形にする
		["SOF の前に SOS", jpeg(segment(0xda, 12), sof(8, 6))],
		["SOF の前に EOI", bytes(SOI, EOI, [0x00, 0x02], sof(8, 6))],
		["SOF の前に SOI", bytes(SOI, SOI, [0x00, 0x02], sof(8, 6))],
		["マーカーの位置に 0xFF 以外", bytes(SOI, [0x00], sof(8, 6))],
		["SOF が無いまま終わる", bytes(SOI, segment(0xe0, 14))],
		["セグメントの長さが 2 未満", bytes(SOI, [0xff, 0xe0, 0, 1], sof(8, 6))],
		["SOF の長さが 7 未満", bytes(SOI, [0xff, 0xc0, 0, 6, 8, 0, 6, 0, 8])],
		["SOF が途中で切れている", bytes(SOI, [0xff, 0xc0, 0, 17, 8, 0, 6, 0])],
		["長さの途中で切れている", bytes(SOI, [0xff, 0xe0, 0])],
		["高さが 0(DNL で後から決める形式)", jpeg(sof(8, 0))],
		["幅が 0", jpeg(sof(0, 6))],
	])("%s なら null", async (_name, content) => {
		expect(await dimensionsOf(content, "jpeg")).toBeNull();
	});

	it("SOF の前のセグメントが多すぎれば(10,000 個)、探すのをやめて null", async () => {
		const many = Array.from({ length: 10_000 }, () => segment(0xfe, 0)).flat();
		expect(await dimensionsOf(jpeg(many, sof(8, 6)), "jpeg")).toBeNull();
		expect(await dimensionsOf(jpeg(many.slice(4), sof(8, 6)), "jpeg")).toEqual({
			width: 8,
			height: 6,
		});
	});
});

describe("readImageDimensions: PNG", () => {
	it("IHDR の幅と高さを読む", async () => {
		expect(await dimensionsOf(png(300, 199), "png")).toEqual({ width: 300, height: 199 });
	});

	it("32 ビットの幅・高さをそのまま返す(上限の判定は呼び出し側)", async () => {
		expect(await dimensionsOf(png(0x7fff_ffff, 0xffff_ffff), "png")).toEqual({
			width: 0x7fff_ffff,
			height: 0xffff_ffff,
		});
	});

	it.each([
		["最初のチャンクが IHDR でない", bytes(PNG_SIGNATURE, u32be(13), "IHDX", u32be(8), u32be(6))],
		["IHDR が途中で切れている", png(8, 6).subarray(0, 23)],
		["幅が 0", png(0, 6)],
		["高さが 0", png(8, 0)],
	])("%s なら null", async (_name, content) => {
		expect(await dimensionsOf(content, "png")).toBeNull();
	});
});

describe("readImageDimensions: GIF", () => {
	it("論理画面と最初のフレームが同じなら、その寸法", async () => {
		const content = gif({ screen: [120, 80], blocks: [gifFrame(0, 0, 120, 80)] });
		expect(await dimensionsOf(content, "gif")).toEqual({ width: 120, height: 80 });
	});

	it("最初のフレームが論理画面より大きければ、フレームの右端・下端まで広げる", async () => {
		const content = gif({ screen: [10, 10], blocks: [gifFrame(5, 7, 120, 80)] });
		expect(await dimensionsOf(content, "gif")).toEqual({ width: 125, height: 87 });
	});

	it("最初のフレームが論理画面より小さければ、論理画面の寸法", async () => {
		const content = gif({ screen: [300, 200], blocks: [gifFrame(10, 10, 20, 20)] });
		expect(await dimensionsOf(content, "gif")).toEqual({ width: 300, height: 200 });
	});

	it("2 枚目以降のフレームは見ない", async () => {
		const content = gif({
			screen: [30, 20],
			blocks: [gifFrame(0, 0, 30, 20), gifFrame(0, 0, 999, 999)],
		});
		expect(await dimensionsOf(content, "gif")).toEqual({ width: 30, height: 20 });
	});

	it.each([0, 1, 7])("グローバルカラーテーブル(2^(%i+1) 色)を読み飛ばす", async (bits) => {
		const content = gif({ screen: [1, 1], colorTableBits: bits, blocks: [gifFrame(0, 0, 50, 40)] });
		expect(await dimensionsOf(content, "gif")).toEqual({ width: 50, height: 40 });
	});

	it("フレームの前の拡張ブロック(アプリケーション・グラフィック制御・コメント)を読み飛ばす", async () => {
		const netscape = gifExtension(0xff, [...bytes("NETSCAPE2.0")], [1, 0, 0]);
		const control = gifExtension(0xf9, [0, 10, 0, 0]);
		const comment = gifExtension(
			0xfe,
			Array.from({ length: 255 }, () => 0x2c),
			[0x2c, 0x21],
			[0x3b],
		);
		const content = gif({
			screen: [1, 1],
			colorTableBits: 1,
			blocks: [netscape, control, comment, gifFrame(0, 0, 64, 48)],
		});
		expect(await dimensionsOf(content, "gif")).toEqual({ width: 64, height: 48 });
	});

	it("フレームが無ければ(終端だけ)、論理画面の寸法", async () => {
		expect(await dimensionsOf(gif({ screen: [30, 20] }), "gif")).toEqual({ width: 30, height: 20 });
	});

	it("拡張ブロックの途中で切れていれば、論理画面の寸法", async () => {
		const content = gif({ screen: [30, 20], blocks: [gifExtension(0xfe, [1, 2, 3])] });
		expect(await dimensionsOf(content.subarray(0, content.length - 4), "gif")).toEqual({
			width: 30,
			height: 20,
		});
	});

	it("論理画面が 0x0 でも、最初のフレームがあればその寸法", async () => {
		const content = gif({ screen: [0, 0], blocks: [gifFrame(0, 0, 100, 50)] });
		expect(await dimensionsOf(content, "gif")).toEqual({ width: 100, height: 50 });
	});

	it("論理画面が 0x0 でフレームも無ければ null", async () => {
		expect(await dimensionsOf(gif({ screen: [0, 0] }), "gif")).toBeNull();
	});

	it("ヘッダーが途中で切れていれば null", async () => {
		expect(await dimensionsOf(bytes("GIF89a", u16le(8), u16le(6)), "gif")).toBeNull();
	});

	it("拡張ブロックのサブブロックが多すぎれば、探すのをやめて論理画面の寸法", async () => {
		const blocks = Array.from({ length: 10_000 }, () => [1]);
		const content = gif({
			screen: [30, 20],
			blocks: [gifExtension(0xfe, ...blocks), gifFrame(0, 0, 900, 900)],
		});
		expect(await dimensionsOf(content, "gif")).toEqual({ width: 30, height: 20 });
	});
});

describe("readImageDimensions: WebP", () => {
	it("VP8 のフレームの寸法(上位 2 ビットの拡大の指定は除く)", async () => {
		expect(await dimensionsOf(webpVp8(300, 199), "webp")).toEqual({ width: 300, height: 199 });
		expect(await dimensionsOf(webpVp8(300, 199, 3), "webp")).toEqual({ width: 300, height: 199 });
		expect(await dimensionsOf(webpVp8(16_383, 16_383), "webp")).toEqual({
			width: 16_383,
			height: 16_383,
		});
	});

	it("VP8L の寸法", async () => {
		expect(await dimensionsOf(webpVp8l(257, 129), "webp")).toEqual({ width: 257, height: 129 });
		expect(await dimensionsOf(webpVp8l(16_384, 1), "webp")).toEqual({ width: 16_384, height: 1 });
	});

	it("VP8L は 25 バイトのファイル(ヘッダーだけ)でも寸法を読む", async () => {
		const bits = (7 - 1) | ((5 - 1) << 14);
		const content = riff("VP8L", [0x2f, ...u32le(bits)]);
		expect(content.length).toBe(25);
		expect(await dimensionsOf(content, "webp")).toEqual({ width: 7, height: 5 });
	});

	it("VP8X のキャンバスの寸法(24 ビット)", async () => {
		expect(await dimensionsOf(webpVp8x(97, 61), "webp")).toEqual({ width: 97, height: 61 });
		expect(await dimensionsOf(webpVp8x(2 ** 24, 256), "webp")).toEqual({
			width: 2 ** 24,
			height: 256,
		});
	});

	it.each(readdirSync(WEBP_FIXTURES).filter((name) => name.endsWith(".webp")))(
		"T04 のフィクスチャ %s は、T04 の parseWebp と同じ寸法",
		async (name) => {
			const content = Uint8Array.from(readFileSync(join(WEBP_FIXTURES, name)));
			const parsed = parseWebp(content);
			expect(parsed.ok).toBe(true);
			if (parsed.ok === false) return;
			expect(await dimensionsOf(content, "webp")).toEqual({
				width: parsed.info.width,
				height: parsed.info.height,
			});
		},
	);

	it.each([
		[
			"VP8 の開始コードが違う",
			riff("VP8 ", [0x10, 0x02, 0, 0x9d, 0x01, 0x2b, ...u16le(8), ...u16le(6), ...zeros(10)]),
		],
		["VP8 の幅が 0", webpVp8(0, 6)],
		["VP8L のシグネチャが違う", riff("VP8L", [0x2e, ...u32le(0), ...zeros(10)])],
		["最初のチャンクが不明", riff("ALPH", zeros(20))],
		["VP8 が途中で切れている", webpVp8(8, 6).subarray(0, 29)],
		["VP8X が途中で切れている", webpVp8x(8, 6).subarray(0, 29)],
		["RIFF ヘッダーだけ", bytes("RIFF", u32le(4), "WEBP", "VP8L", u32le(5))],
	])("%s なら null", async (_name, content) => {
		expect(await dimensionsOf(content, "webp")).toBeNull();
	});
});

describe("readImageDimensions: BMP", () => {
	it("BITMAPINFOHEADER(40 バイト)の 32 ビットの幅と高さ", async () => {
		expect(await dimensionsOf(bmp(40, 300, 199), "bmp")).toEqual({ width: 300, height: 199 });
	});

	it("高さが負(上の行から並ぶ)なら、絶対値", async () => {
		expect(await dimensionsOf(bmp(40, 300, -199), "bmp")).toEqual({ width: 300, height: 199 });
		expect(await dimensionsOf(bmp(124, 5, -2_147_483_648), "bmp")).toEqual({
			width: 5,
			height: 2_147_483_648,
		});
	});

	it("BITMAPCOREHEADER(12 バイト)の 16 ビットの幅と高さ", async () => {
		expect(await dimensionsOf(bmp(12, 400, 200), "bmp")).toEqual({ width: 400, height: 200 });
	});

	it("BITMAPV5HEADER(124 バイト)", async () => {
		expect(await dimensionsOf(bmp(124, 70_000, 3), "bmp")).toEqual({ width: 70_000, height: 3 });
	});

	it.each([
		["BITMAPINFOHEADER が途中で切れている", bmp(40, 8, 6).subarray(0, 25)],
		["BITMAPCOREHEADER が途中で切れている", bmp(12, 8, 6).subarray(0, 21)],
		["幅が 0", bmp(40, 0, 6)],
	])("%s なら null", async (_name, content) => {
		expect(await dimensionsOf(content, "bmp")).toBeNull();
	});
});

describe("readImageDimensions: AVIF", () => {
	it("ipco の ispe の寸法", async () => {
		expect(await dimensionsOf(avif(ispe(400, 200)), "avif")).toEqual({ width: 400, height: 200 });
	});

	it("ispe が複数あれば、面積が最大のもの(グリッドの全体・サムネイル・タイル)", async () => {
		const content = avif(
			ispe(128, 128),
			box("pixi", [3, 8, 8, 8]),
			ispe(512, 384),
			ispe(96, 64),
			ispe(600, 100),
		);
		expect(await dimensionsOf(content, "avif")).toEqual({ width: 512, height: 384 });
	});

	it("meta が mdat より後ろにあっても、mdat を大きさで読み飛ばして探す", async () => {
		const content = bytes(
			ftyp("avif", "mif1", "avif"),
			box("mdat", zeros(100_000)),
			fullBox("meta", HDLR, box("iprp", box("ipco", ispe(64, 32)))),
		);
		expect(await dimensionsOf(content, "avif")).toEqual({ width: 64, height: 32 });
	});

	it("64 ビットの大きさのボックス(大きさ 1)を読み飛ばす", async () => {
		const large = bytes(u32be(1), "mdat", u32be(0), u32be(16 + 8), zeros(8));
		const content = bytes(
			ftyp("avif"),
			large,
			fullBox("meta", box("iprp", box("ipco", ispe(9, 7)))),
		);
		expect(await dimensionsOf(content, "avif")).toEqual({ width: 9, height: 7 });
	});

	it("大きさ 0 のボックスは、親の末尾までとする", async () => {
		const meta = fullBox("meta", box("iprp", box("ipco", ispe(11, 5))));
		const lastMeta = bytes(u32be(0), meta.subarray(4));
		expect(await dimensionsOf(bytes(ftyp("avif"), lastMeta), "avif")).toEqual({
			width: 11,
			height: 5,
		});
	});

	it("幅か高さが 0 の ispe は使わない", async () => {
		expect(await dimensionsOf(avif(ispe(0, 500), ispe(20, 10)), "avif")).toEqual({
			width: 20,
			height: 10,
		});
	});

	it.each([
		["meta が無い", bytes(ftyp("avif"), box("mdat", [1]))],
		["iprp が無い", bytes(ftyp("avif"), fullBox("meta", HDLR))],
		["ipco が無い", bytes(ftyp("avif"), fullBox("meta", box("iprp", fullBox("ipma"))))],
		["ispe が無い", avif(box("pixi", [3, 8, 8, 8]))],
		["ispe が短い", avif(fullBox("ispe", u32be(8)))],
		["ボックスの大きさがファイルを超える", bytes(ftyp("avif"), u32be(1_000), "meta", zeros(20))],
		[
			// 大きさ 4 のボックスを 4 バイト先へ読み進めると、正しい meta が見つかる形にしてある
			"ボックスの大きさがヘッダー(8 バイト)より小さい",
			bytes(ftyp("avif"), u32be(4), fullBox("meta", box("iprp", box("ipco", ispe(9, 7))))),
		],
		["64 ビットの大きさが途中で切れている", bytes(ftyp("avif"), u32be(1), "mdat", u32be(0))],
		["ボックスのヘッダーが途中で切れている", bytes(ftyp("avif"), u32be(100), "me")],
	])("%s なら null", async (_name, content) => {
		expect(await dimensionsOf(content, "avif")).toBeNull();
	});

	it("子ボックスの大きさが親を超えていれば、そこで探すのをやめる", async () => {
		const ipco = bytes(u32be(8 + 20 + 1), "ipco", ispe(30, 20), zeros(1));
		const broken = bytes(
			ftyp("avif"),
			fullBox("meta", box("iprp", ipco.subarray(0, ipco.length - 1))),
		);
		expect(await dimensionsOf(broken, "avif")).toBeNull();
	});

	it("ボックスが多すぎれば(合わせて 10,000 個)、探すのをやめて null", async () => {
		const meta = fullBox("meta", box("iprp", box("ipco", ispe(9, 7))));
		const free = (count: number) => Array.from({ length: count }, () => box("free"));
		// ftyp・free・meta・iprp・ipco・ispe の順に数える
		expect(await dimensionsOf(bytes(ftyp("avif"), ...free(9_995), meta), "avif")).toEqual({
			width: 9,
			height: 7,
		});
		expect(await dimensionsOf(bytes(ftyp("avif"), ...free(9_996), meta), "avif")).toBeNull();
	});

	it("ipco の子ボックスも数に含める(10,000 個を超えた先の ispe は読まない)", async () => {
		const children = (count: number) => Array.from({ length: count }, () => box("free"));
		// ftyp・meta・hdlr・iprp・ipco で 5 個、その後に free と ispe
		expect(await dimensionsOf(avif(...children(9_994), ispe(9, 7)), "avif")).toEqual({
			width: 9,
			height: 7,
		});
		expect(await dimensionsOf(avif(...children(9_995), ispe(9, 7)), "avif")).toBeNull();
	});
});

describe("readImageDimensions: ヘッダーを探す手間の上限", () => {
	// どの形式も、読み飛ばすセグメント・ブロック・ボックスは合わせて 10,000 個まで。20,000 個あっても読むのは約 10,000 回
	const LIMIT = 10_100;

	it("JPEG: SOF の前に 20,000 個のセグメント", async () => {
		const segments = Array.from({ length: 20_000 }, () => segment(0xfe, 0)).flat();
		const counted = countingReader(jpeg(segments, sof(8, 6)));
		expect(await readImageDimensions(counted.reader, "jpeg")).toBeNull();
		expect(counted.reads()).toBeLessThan(LIMIT);
	});

	it("GIF: 最初のフレームの前に 20,000 個のサブブロック", async () => {
		const subBlocks = Array.from({ length: 20_000 }, () => [1]);
		const counted = countingReader(
			gif({
				screen: [30, 20],
				blocks: [gifExtension(0xfe, ...subBlocks), gifFrame(0, 0, 900, 900)],
			}),
		);
		expect(await readImageDimensions(counted.reader, "gif")).toEqual({ width: 30, height: 20 });
		expect(counted.reads()).toBeLessThan(LIMIT);
	});

	it("AVIF: meta の前に 20,000 個のボックス", async () => {
		const free = Array.from({ length: 20_000 }, () => box("free"));
		const meta = fullBox("meta", box("iprp", box("ipco", ispe(9, 7))));
		const counted = countingReader(bytes(ftyp("avif"), ...free, meta));
		expect(await readImageDimensions(counted.reader, "avif")).toBeNull();
		expect(counted.reads()).toBeLessThan(LIMIT);
	});
});

// ---------------------------------------------------------------------------
// デコードの前の判定
// ---------------------------------------------------------------------------

describe("inspectInputFile", () => {
	it("中身で形式を決め、形式の MIME タイプとヘッダーの寸法を返す(File.type は見ない)", async () => {
		const inspection = await inspectInputFile(fileOf(png(300, 200), "photo.jpg", "image/jpeg"));
		expect(inspection).toEqual({
			format: "png",
			mimeType: "image/png",
			dimensions: { width: 300, height: 200 },
			notices: [],
		});
	});

	it.each([
		["jpeg", jpeg(sof(8, 6)), "image/jpeg"],
		["png", png(8, 6), "image/png"],
		["gif", gif({ screen: [8, 6] }), "image/gif"],
		["webp", webpVp8l(8, 6), "image/webp"],
		["avif", avif(ispe(8, 6)), "image/avif"],
		["bmp", bmp(40, 8, 6), "image/bmp"],
	] as const)("%s は拡張子も File.type も無くても受け付ける", async (format, content, mimeType) => {
		const inspection = await inspectInputFile(fileOf(content, "IMG_0001", ""));
		expect(inspection.format).toBe(format);
		expect(inspection.mimeType).toBe(mimeType);
		expect(inspection.dimensions).toEqual({ width: 8, height: 6 });
	});

	it("GIF には GIF_FIRST_FRAME_ONLY の注意を付ける", async () => {
		const inspection = await inspectInputFile(
			fileOf(gif({ screen: [8, 6] }), "a.gif", "image/gif"),
		);
		expect(inspection.notices).toEqual(["GIF_FIRST_FRAME_ONLY"]);
	});

	it("HEIC は、名前が .jpg で File.type が image/jpeg でも、中身で拒否する", async () => {
		const error = await caught(
			inspectInputFile(fileOf(REAL_FTYP.heicSips, "IMG_0001.jpg", "image/jpeg")),
		);
		expect(error).toBeInstanceOf(Base64ImageError);
		expect(error).toMatchObject({
			code: "INPUT_HEIC_REJECTED",
			details: {
				mimeType: "image/jpeg",
				detectedFormat: "heif",
				fileBytes: REAL_FTYP.heicSips.length,
			},
		});
	});

	it("File.type が空の HEIC も拒否する", async () => {
		expect(await codeOf(inspectInputFile(fileOf(REAL_FTYP.heicX265, "IMG_0001", "")))).toBe(
			"INPUT_HEIC_REJECTED",
		);
	});

	it.each([
		["SVG", bytes("<svg/>"), "a.svg", "image/svg+xml", "INPUT_SVG_REJECTED"],
		["SVG(File.type が空)", bytes("<svg/>"), "a", "", "INPUT_SVG_REJECTED"],
		["TIFF", bytes("II*\0", zeros(8)), "a.tif", "image/tiff", "INPUT_FORMAT_REJECTED"],
		["ICO", bytes([0, 0, 1, 0], zeros(16)), "a.ico", "image/x-icon", "INPUT_FORMAT_REJECTED"],
		[
			"中身の分からない .heic",
			bytes("????????????????"),
			"a.heic",
			"image/heic",
			"INPUT_HEIC_REJECTED",
		],
		[
			"中身の分からない .jpg",
			bytes("not a jpeg at all"),
			"a.jpg",
			"image/jpeg",
			"INPUT_DECODE_FAILED",
		],
		["中身も拡張子も分からない", bytes("not a jpeg at all"), "a.xyz", "", "INPUT_FORMAT_REJECTED"],
	])("%s は拒否する", async (_name, content, name, type, code) => {
		expect(await codeOf(inspectInputFile(fileOf(content, name, type)))).toBe(code);
	});

	it.each(["image/png", ""])("空のファイルは INPUT_DECODE_FAILED(File.type %j)", async (type) => {
		expect(await codeOf(inspectInputFile(fileOf(new Uint8Array(0), "a.png", type)))).toBe(
			"INPUT_DECODE_FAILED",
		);
	});

	it("ファイルが 40MB ちょうどなら受け付け、超えたら INPUT_FILE_TOO_LARGE", async () => {
		const atLimit = withSize(fileOf(jpeg(sof(8, 6)), "a.jpg", "image/jpeg"), MAX_INPUT_FILE_BYTES);
		expect((await inspectInputFile(atLimit)).format).toBe("jpeg");
		const over = withSize(fileOf(jpeg(sof(8, 6)), "a.jpg", "image/jpeg"), MAX_INPUT_FILE_BYTES + 1);
		const error = await caught(inspectInputFile(over));
		expect(error).toMatchObject({
			code: "INPUT_FILE_TOO_LARGE",
			details: { fileBytes: MAX_INPUT_FILE_BYTES + 1, maxFileBytes: MAX_INPUT_FILE_BYTES },
		});
	});

	it("40MB を超える HEIC には、大きさより先に HEIC の案内を出す", async () => {
		const file = withSize(
			fileOf(REAL_FTYP.heicX265, "a.heic", "image/heic"),
			MAX_INPUT_FILE_BYTES + 1,
		);
		expect(await codeOf(inspectInputFile(file))).toBe("INPUT_HEIC_REJECTED");
	});

	it("画素数が 6,400 万ちょうどなら受け付け、超えたら INPUT_TOO_MANY_PIXELS", async () => {
		expect((await inspectInputFile(fileOf(png(8_000, 8_000)))).dimensions).toEqual({
			width: 8_000,
			height: 8_000,
		});
		expect((await inspectInputFile(fileOf(png(MAX_INPUT_PIXELS, 1)))).format).toBe("png");
		const error = await caught(inspectInputFile(fileOf(png(8_000, 8_001), "big.png", "image/png")));
		expect(error).toMatchObject({
			code: "INPUT_TOO_MANY_PIXELS",
			details: { width: 8_000, height: 8_001, maxPixels: MAX_INPUT_PIXELS, detectedFormat: "png" },
		});
		expect(await codeOf(inspectInputFile(fileOf(png(MAX_INPUT_PIXELS + 1, 1))))).toBe(
			"INPUT_TOO_MANY_PIXELS",
		);
	});

	it.each([
		["JPEG", jpeg(sof(9_000, 8_000))],
		[
			"GIF(最初のフレームで広がる)",
			gif({ screen: [1, 1], blocks: [gifFrame(0, 0, 10_000, 6_401)] }),
		],
		["WebP", webpVp8x(16_000, 4_001)],
		["BMP", bmp(40, 8_001, -8_000)],
		["AVIF", avif(ispe(12_000, 6_000))],
	])("%s も、ヘッダーの寸法で画素数を確かめる", async (_name, content) => {
		expect(await codeOf(inspectInputFile(fileOf(content)))).toBe("INPUT_TOO_MANY_PIXELS");
	});

	it("ヘッダーから寸法を読めなければ、dimensions は null(デコードしたあとで確かめる)", async () => {
		const inspection = await inspectInputFile(fileOf(bytes(SOI, segment(0xe0, 14)), "a.jpg"));
		expect(inspection).toMatchObject({ format: "jpeg", dimensions: null });
	});

	it("読み込みに失敗したら INPUT_DECODE_FAILED(元のエラーは cause)", async () => {
		const failure = new DOMException("gone", "NotReadableError");
		const file = {
			name: "a.jpg",
			type: "image/jpeg",
			size: 100,
			slice: () => ({ arrayBuffer: () => Promise.reject(failure) }),
		} as unknown as File;
		const error = await caught(inspectInputFile(file));
		expect(error).toMatchObject({ code: "INPUT_DECODE_FAILED", cause: failure });
	});

	it("中断済みの signal なら、読み込まずに signal.reason で reject する", async () => {
		const file = fileOf(png(8, 6));
		const slice = vi.spyOn(file, "slice");
		const controller = new AbortController();
		controller.abort();
		expect(await caught(inspectInputFile(file, controller.signal))).toBe(controller.signal.reason);
		expect(slice).not.toHaveBeenCalled();
	});

	it("読み込みの途中で中断されたら、signal.reason で reject する(INPUT_DECODE_FAILED にしない)", async () => {
		const file = {
			name: "a.jpg",
			type: "image/jpeg",
			size: 100,
			slice: () => ({ arrayBuffer: () => new Promise(() => {}) }),
		} as unknown as File;
		const controller = new AbortController();
		const inspecting = inspectInputFile(file, controller.signal);
		controller.abort(new Error("cancelled by the user"));
		expect(await caught(inspecting)).toBe(controller.signal.reason);
	});
});

// ---------------------------------------------------------------------------
// デコード
// ---------------------------------------------------------------------------

describe("createDecodeImage", () => {
	it("File をそのまま createImageBitmap に渡し、imageOrientation は from-image", async () => {
		const fake = decodesTo(8, 6);
		const file = fileOf(png(8, 6), "a.png", "image/png");
		await createDecodeImage(fake.environment)(file);
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]?.image).toBe(file);
		expect(fake.calls[0]?.options).toEqual({ imageOrientation: "from-image" });
	});

	it("デコードした ImageBitmap の寸法(EXIF の向きを反映したもの)と、ファイルの情報を返す", async () => {
		const bitmap = fakeBitmap(200, 400);
		const fake = fakeDecoder(async () => bitmap);
		// ヘッダーは 400x200(向き 6 の JPEG)。返す寸法は ImageBitmap のもの
		const file = fileOf(jpeg(sof(400, 200)), "IMG_0001.JPG", "image/jpeg");
		const decoded = await createDecodeImage(fake.environment)(file);
		expect(decoded).toMatchObject({
			width: 200,
			height: 400,
			mimeType: "image/jpeg",
			filename: "IMG_0001.JPG",
			fileBytes: file.size,
			notices: [],
		});
		expect(decoded.source).toBe(bitmap);
	});

	it("mimeType は中身の形式のもの(File.type ではない)", async () => {
		const decoded = await createDecodeImage(decodesTo(8, 6).environment)(
			fileOf(png(8, 6), "a.jpg", "image/jpeg"),
		);
		expect(decoded.mimeType).toBe("image/png");
	});

	it("GIF には GIF_FIRST_FRAME_ONLY の注意を付ける", async () => {
		const decoded = await createDecodeImage(decodesTo(8, 6).environment)(
			fileOf(gif({ screen: [8, 6] }), "a.gif", "image/gif"),
		);
		expect(decoded.notices).toEqual(["GIF_FIRST_FRAME_ONLY"]);
	});

	it("close() は ImageBitmap を 1 回だけ閉じる(何度呼んでもよい)", async () => {
		const bitmap = fakeBitmap(8, 6);
		const decoded = await createDecodeImage(fakeDecoder(async () => bitmap).environment)(
			fileOf(png(8, 6)),
		);
		expect(bitmap.close).not.toHaveBeenCalled();
		decoded.close();
		decoded.close();
		expect(bitmap.close).toHaveBeenCalledTimes(1);
		// 閉じたあとも、寸法は最初の値のまま
		expect(decoded.width).toBe(8);
		expect(decoded.height).toBe(6);
	});

	it.each([
		["HEIC", fileOf(REAL_FTYP.heicSips, "a.jpg", "image/jpeg"), "INPUT_HEIC_REJECTED"],
		["SVG", fileOf(bytes("<svg/>"), "a.svg", "image/svg+xml"), "INPUT_SVG_REJECTED"],
		["TIFF", fileOf(bytes("MM\0*", zeros(8)), "a.tif", "image/tiff"), "INPUT_FORMAT_REJECTED"],
		["壊れた JPEG", fileOf(bytes("xxxx"), "a.jpg", "image/jpeg"), "INPUT_DECODE_FAILED"],
		["空のファイル", fileOf(new Uint8Array(0), "a.png", "image/png"), "INPUT_DECODE_FAILED"],
		["6,400 万画素を超える", fileOf(png(8_001, 8_000)), "INPUT_TOO_MANY_PIXELS"],
		[
			"40MB を超える",
			withSize(fileOf(png(8, 6)), MAX_INPUT_FILE_BYTES + 1),
			"INPUT_FILE_TOO_LARGE",
		],
	])("%s は、デコードせずに拒否する", async (_name, file, code) => {
		const fake = decodesTo(8, 6);
		expect(await codeOf(createDecodeImage(fake.environment)(file))).toBe(code);
		expect(fake.calls).toHaveLength(0);
	});

	it("デコードに失敗したら INPUT_DECODE_FAILED(元のエラーは cause)", async () => {
		const failure = new DOMException("The source image could not be decoded.", "InvalidStateError");
		const fake = fakeDecoder(async () => {
			throw failure;
		});
		const error = await caught(
			createDecodeImage(fake.environment)(fileOf(png(8, 6), "a.png", "image/png")),
		);
		expect(error).toBeInstanceOf(Base64ImageError);
		expect(error).toMatchObject({
			code: "INPUT_DECODE_FAILED",
			cause: failure,
			details: { detectedFormat: "png", mimeType: "image/png" },
		});
	});

	it("createImageBitmap が同期的に例外を投げても INPUT_DECODE_FAILED", async () => {
		const failure = new TypeError("unsupported option");
		const environment: DecodeImageEnvironment = {
			createImageBitmap: () => {
				throw failure;
			},
		};
		const error = await caught(createDecodeImage(environment)(fileOf(png(8, 6))));
		expect(error).toMatchObject({ code: "INPUT_DECODE_FAILED", cause: failure });
	});

	it("jsdom で既定の decodeImage を呼ぶと、createImageBitmap が無いので INPUT_DECODE_FAILED", async () => {
		expect(typeof globalThis.createImageBitmap).toBe("undefined");
		const error = await caught(decodeImage(fileOf(png(8, 6))));
		expect(error).toMatchObject({ code: "INPUT_DECODE_FAILED" });
		expect((error as Error).cause).toBeInstanceOf(ReferenceError);
	});

	it.each([
		[0, 6],
		[8, 0],
		[Number.NaN, 6],
		[8.5, 6],
	])("デコードした寸法が %sx%s なら、閉じてから INPUT_DECODE_FAILED", async (width, height) => {
		const bitmap = fakeBitmap(width, height);
		const error = await caught(
			createDecodeImage(fakeDecoder(async () => bitmap).environment)(fileOf(png(8, 6))),
		);
		expect(error).toMatchObject({ code: "INPUT_DECODE_FAILED" });
		expect(bitmap.close).toHaveBeenCalledTimes(1);
	});

	it("ヘッダーから寸法を読めなかった画像は、デコードしたあとで画素数を確かめ、超えたら閉じてから拒否する", async () => {
		const noSof = fileOf(bytes(SOI, segment(0xe0, 14)), "a.jpg", "image/jpeg");
		const big = fakeBitmap(8_000, 8_001);
		const error = await caught(createDecodeImage(fakeDecoder(async () => big).environment)(noSof));
		expect(error).toMatchObject({
			code: "INPUT_TOO_MANY_PIXELS",
			details: { width: 8_000, height: 8_001, maxPixels: MAX_INPUT_PIXELS },
		});
		expect(big.close).toHaveBeenCalledTimes(1);

		const limit = fakeBitmap(8_000, 8_000);
		const decoded = await createDecodeImage(fakeDecoder(async () => limit).environment)(noSof);
		expect(decoded.width * decoded.height).toBe(MAX_INPUT_PIXELS);
		expect(limit.close).not.toHaveBeenCalled();
	});

	it("中断済みの signal なら、デコードせずに signal.reason で reject する", async () => {
		const fake = decodesTo(8, 6);
		const controller = new AbortController();
		controller.abort();
		expect(
			await caught(
				createDecodeImage(fake.environment)(fileOf(png(8, 6)), { signal: controller.signal }),
			),
		).toBe(controller.signal.reason);
		expect(fake.calls).toHaveLength(0);
	});

	it("デコードの途中で中断されたら、完了を待たずに signal.reason で reject し、あとで届いた ImageBitmap を閉じる", async () => {
		const pending = Promise.withResolvers<FakeBitmap>();
		const fake = fakeDecoder(() => pending.promise);
		const controller = new AbortController();
		const decoding = createDecodeImage(fake.environment)(fileOf(png(8, 6)), {
			signal: controller.signal,
		});
		await vi.waitFor(() => {
			expect(fake.calls).toHaveLength(1);
		});
		controller.abort();
		expect(await caught(decoding)).toBe(controller.signal.reason);

		const late = fakeBitmap(8, 6);
		pending.resolve(late);
		await vi.waitFor(() => {
			expect(late.close).toHaveBeenCalledTimes(1);
		});
	});

	it("中断のあとでデコードが失敗しても、signal.reason で reject する", async () => {
		const pending = Promise.withResolvers<FakeBitmap>();
		const fake = fakeDecoder(() => pending.promise);
		const controller = new AbortController();
		const decoding = createDecodeImage(fake.environment)(fileOf(png(8, 6)), {
			signal: controller.signal,
		});
		await vi.waitFor(() => {
			expect(fake.calls).toHaveLength(1);
		});
		controller.abort();
		pending.reject(new DOMException("decode failed", "InvalidStateError"));
		expect(await caught(decoding)).toBe(controller.signal.reason);
	});

	it("判定の読み込みの途中で中断されたら、デコードしない", async () => {
		const fake = decodesTo(8, 6);
		const file = fileOf(png(8, 6));
		const read = Promise.withResolvers<ArrayBuffer>();
		vi.spyOn(file, "slice").mockReturnValue({ arrayBuffer: () => read.promise } as unknown as Blob);
		const controller = new AbortController();
		const decoding = createDecodeImage(fake.environment)(file, { signal: controller.signal });
		controller.abort();
		expect(await caught(decoding)).toBe(controller.signal.reason);
		read.resolve(png(8, 6).buffer as ArrayBuffer);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fake.calls).toHaveLength(0);
	});
});
