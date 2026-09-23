import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	WEBP_DATA_URL_PREFIX,
	decodeBase64,
	decodeWebpDataUrl,
	encodeBase64,
	maxWebpBytesForBudget,
	parseWebpDataUrl,
	storedBytesForWebp,
	toWebpDataUrl,
} from "../../src/shared/data-url";
import { parseWebp, type WebpInfo } from "../../src/shared/webp";

// ---------------------------------------------------------------------------
// テスト用のデータ
// ---------------------------------------------------------------------------

/** tests/fixtures/webp/ の WebP(作り方は同じディレクトリの README.md) */
function fixture(name: string): Uint8Array {
	return Uint8Array.from(readFileSync(new URL(`../fixtures/webp/${name}`, import.meta.url)));
}

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

function u32le(value: number): Uint8Array {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, value, true);
	return out;
}

/** RIFF のチャンク。中身が奇数バイトなら、詰め物の 0 を足す(`pad: false` で省く) */
function chunk(fourCC: string, payload: Uint8Array, { pad = true } = {}): Uint8Array {
	const padding = pad && payload.length % 2 === 1 ? new Uint8Array(1) : new Uint8Array(0);
	return concat(ascii(fourCC), u32le(payload.length), payload, padding);
}

/** RIFF / WEBP のヘッダーを付ける。サイズ欄は、実際の長さに合う値にする */
function riffWebp(...chunks: readonly Uint8Array[]): Uint8Array {
	const body = concat(ascii("WEBP"), ...chunks);
	return concat(ascii("RIFF"), u32le(body.length), body);
}

/** RIFF のサイズ欄を書き換えたコピー(既定は、データ長に合う値) */
function withRiffSize(bytes: Uint8Array, size = bytes.length - 8): Uint8Array {
	const copy = bytes.slice();
	new DataView(copy.buffer).setUint32(4, size, true);
	return copy;
}

/** 1 バイトを書き換えたコピー */
function withByte(bytes: Uint8Array, index: number, value: number): Uint8Array {
	const copy = bytes.slice();
	copy[index] = value;
	return copy;
}

/**
 * `VP8 ` の中身。フレームヘッダー(10 バイト)の後ろは、圧縮データの代わりの 0。
 * 既定のフレームタグは、キーフレーム・版 0・表示する・最初のパーティション 1 バイト。
 * `size` がヘッダーより短いときは、ヘッダーの途中で切る。
 */
function vp8Payload(
	width: number,
	height: number,
	{ frameTag = (1 << 5) | (1 << 4), startCode = [0x9d, 0x01, 0x2a], size = 32 } = {},
): Uint8Array {
	const payload = new Uint8Array(Math.max(size, 10));
	const view = new DataView(payload.buffer);
	payload[0] = frameTag & 0xff;
	payload[1] = (frameTag >> 8) & 0xff;
	payload[2] = (frameTag >> 16) & 0xff;
	payload.set(startCode, 3);
	view.setUint16(6, width, true);
	view.setUint16(8, height, true);
	return payload.slice(0, size);
}

/**
 * `VP8L` の中身。ヘッダー(5 バイト)の後ろは、圧縮データの代わりの 0。
 * `size` がヘッダーより短いときは、ヘッダーの途中で切る。
 */
function vp8lPayload(
	width: number,
	height: number,
	{ alpha = false, version = 0, signature = 0x2f, size = 16 } = {},
): Uint8Array {
	const payload = new Uint8Array(Math.max(size, 5));
	const bits = ((width - 1) | ((height - 1) << 14) | (Number(alpha) << 28) | (version << 29)) >>> 0;
	payload[0] = signature;
	new DataView(payload.buffer).setUint32(1, bits, true);
	return payload.slice(0, size);
}

const FLAG_ALPHA = 0x10;
const FLAG_ANIMATION = 0x02;

/** `VP8X` の中身(10 バイト)。キャンバスの寸法は 24 ビットで、1 を引いて入れる */
function vp8xPayload(flags: number, width: number, height: number): Uint8Array {
	const payload = new Uint8Array(10);
	const view = new DataView(payload.buffer);
	payload[0] = flags;
	view.setUint16(4, (width - 1) & 0xffff, true);
	payload[6] = (width - 1) >>> 16;
	view.setUint16(7, (height - 1) & 0xffff, true);
	payload[9] = (height - 1) >>> 16;
	return payload;
}

/** 再現できる疑似乱数(mulberry32) */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface Fixture {
	readonly file: string;
	readonly chunks: string;
	readonly info: WebpInfo;
	/** 画像データのチャンクがファイルの最後にあるか(途中で切ったものが、どれも不正になるか) */
	readonly imageDataLast: boolean;
}

// 期待値は libwebp 1.6.0 の webpinfo の出力と同じ(README.md)。
const FIXTURES: readonly Fixture[] = [
	{
		file: "lossy.webp",
		chunks: "VP8",
		info: { format: "lossy", width: 300, height: 199, hasAlpha: false, animated: false },
		imageDataLast: true,
	},
	{
		file: "lossless.webp",
		chunks: "VP8L",
		info: { format: "lossless", width: 257, height: 129, hasAlpha: false, animated: false },
		imageDataLast: true,
	},
	{
		file: "lossy-alpha.webp",
		chunks: "VP8X + ALPH + VP8",
		info: { format: "extended", width: 261, height: 173, hasAlpha: true, animated: false },
		imageDataLast: true,
	},
	{
		file: "lossless-alpha.webp",
		chunks: "VP8L(alpha_is_used)",
		info: { format: "lossless", width: 131, height: 67, hasAlpha: true, animated: false },
		imageDataLast: true,
	},
	{
		file: "lossless-xmp.webp",
		chunks: "VP8X + VP8L + XMP",
		info: { format: "extended", width: 63, height: 37, hasAlpha: false, animated: false },
		imageDataLast: false,
	},
	{
		file: "animated.webp",
		chunks: "VP8X + ANIM + ANMF × 2",
		info: { format: "extended", width: 97, height: 61, hasAlpha: false, animated: true },
		imageDataLast: false,
	},
];

/** 最初のチャンクの中身の位置(RIFF ヘッダー 12 + チャンクヘッダー 8) */
const FIRST_PAYLOAD = 20;

// ---------------------------------------------------------------------------
// WebP のヘッダー解析
// ---------------------------------------------------------------------------

describe("parseWebp: cwebp で作った WebP", () => {
	it.each(FIXTURES)("$file($chunks)の形式と寸法を読める", ({ file, info }) => {
		expect(parseWebp(fixture(file))).toEqual({ ok: true, info });
	});

	it("XMP チャンクの中身が奇数バイトで、詰め物の 1 バイトが付いている(詰め物の読み飛ばしを試す)", () => {
		const bytes = fixture("lossless-xmp.webp");
		const view = new DataView(bytes.buffer);
		// VP8X(8 + 10)と VP8L のチャンクの後ろに XMP がある。
		const vp8lSize = view.getUint32(30 + 4, true);
		const xmpOffset = 30 + 8 + vp8lSize + (vp8lSize % 2);
		expect(String.fromCharCode(...bytes.subarray(xmpOffset, xmpOffset + 4))).toBe("XMP ");
		expect(view.getUint32(xmpOffset + 4, true) % 2).toBe(1);
		expect(bytes.at(-1)).toBe(0);
	});

	it("Uint8Array のビュー(byteOffset が 0 でない)でも読める", () => {
		const bytes = fixture("lossy-alpha.webp");
		const larger = new Uint8Array(bytes.length + 7);
		larger.set(bytes, 5);

		expect(parseWebp(larger.subarray(5, 5 + bytes.length))).toEqual(parseWebp(bytes));
		expect(parseWebp(larger.subarray(5, 5 + bytes.length)).ok).toBe(true);
	});
});

describe("parseWebp: 3 種類のチャンクの寸法の読み方", () => {
	it.each([
		[1, 1],
		[300, 199],
		[16383, 16383],
	])("VP8: 14 ビットの幅・高さ(%i × %i)", (width, height) => {
		expect(parseWebp(riffWebp(chunk("VP8 ", vp8Payload(width, height))))).toEqual({
			ok: true,
			info: { format: "lossy", width, height, hasAlpha: false, animated: false },
		});
	});

	it("VP8: 幅・高さの上位 2 ビット(拡大の指定)は寸法に含めない", () => {
		const bytes = riffWebp(chunk("VP8 ", vp8Payload(0xc000 | 300, 0x4000 | 199)));

		expect(parseWebp(bytes)).toMatchObject({ ok: true, info: { width: 300, height: 199 } });
	});

	it.each([
		[1, 1, false],
		[257, 129, true],
		[16384, 16384, false],
		[16384, 1, true],
	])(
		"VP8L: 14 ビットの「幅 - 1」「高さ - 1」と alpha_is_used(%i × %i、透過 %s)",
		(width, height, alpha) => {
			expect(parseWebp(riffWebp(chunk("VP8L", vp8lPayload(width, height, { alpha }))))).toEqual({
				ok: true,
				info: { format: "lossless", width, height, hasAlpha: alpha, animated: false },
			});
		},
	);

	it("VP8X: 24 ビットのキャンバスの寸法を読み、画像データの寸法と照合する", () => {
		const bytes = riffWebp(
			chunk("VP8X", vp8xPayload(0, 16384, 300)),
			chunk("VP8L", vp8lPayload(16384, 300)),
		);

		expect(parseWebp(bytes)).toEqual({
			ok: true,
			info: { format: "extended", width: 16384, height: 300, hasAlpha: false, animated: false },
		});
	});

	it("VP8X のアニメーション: キャンバスの寸法を返す(24 ビットの最大値 16,777,216 まで)", () => {
		const bytes = riffWebp(
			chunk("VP8X", vp8xPayload(FLAG_ANIMATION | FLAG_ALPHA, 2 ** 24, 255)),
			chunk("ANIM", new Uint8Array(6)),
			chunk("ANMF", new Uint8Array(16)),
		);

		expect(parseWebp(bytes)).toEqual({
			ok: true,
			info: { format: "extended", width: 2 ** 24, height: 255, hasAlpha: true, animated: true },
		});
	});

	it("VP8X の静止画: ICCP・ALPH・未知のチャンクを飛ばして、最初の VP8 / VP8L を画像データとする", () => {
		const bytes = riffWebp(
			chunk("VP8X", vp8xPayload(0, 40, 30)),
			chunk("ICCP", new Uint8Array(5)),
			chunk("ABCD", new Uint8Array(3)),
			chunk("ALPH", new Uint8Array(7)),
			chunk("VP8 ", vp8Payload(40, 30)),
			chunk("EXIF", new Uint8Array(9)),
		);

		// Alpha フラグが無くても、ALPH チャンクがあれば透過ありとする(libwebp と同じ)。
		expect(parseWebp(bytes)).toEqual({
			ok: true,
			info: { format: "extended", width: 40, height: 30, hasAlpha: true, animated: false },
		});
	});

	it("VP8X の静止画: VP8L の alpha_is_used でも透過ありとする", () => {
		const bytes = riffWebp(
			chunk("VP8X", vp8xPayload(0, 40, 30)),
			chunk("VP8L", vp8lPayload(40, 30, { alpha: true })),
		);

		expect(parseWebp(bytes)).toMatchObject({ ok: true, info: { hasAlpha: true } });
	});
});

describe("parseWebp: 壊れたデータ・短すぎるデータを拒否する", () => {
	const lossy = fixture("lossy.webp");

	it.each([0, 1, 11, 12, 19])("%i バイト → TOO_SHORT", (length) => {
		expect(parseWebp(lossy.subarray(0, length))).toEqual({ ok: false, reason: "TOO_SHORT" });
	});

	it.each([
		["RIFX(ビッグエンディアンの RIFF)", concat(ascii("RIFX"), lossy.subarray(4))],
		["RIFF / WAVE", concat(lossy.subarray(0, 8), ascii("WAVE"), lossy.subarray(12))],
		[
			"PNG",
			concat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), new Uint8Array(24)),
		],
		["JPEG", concat(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0), new Uint8Array(28))],
		["GIF", concat(ascii("GIF89a"), new Uint8Array(26))],
	])("%s → NOT_WEBP", (_label, bytes) => {
		expect(parseWebp(bytes)).toEqual({ ok: false, reason: "NOT_WEBP" });
	});

	it.each([
		["末尾が 1 バイト欠けている", lossy.subarray(0, lossy.length - 1)],
		["末尾が半分欠けている", lossy.subarray(0, lossy.length / 2)],
		["後ろに 1 バイト余計なデータがある", concat(lossy, new Uint8Array(1))],
		["後ろに空のチャンクがある", concat(lossy, chunk("JUNK", new Uint8Array(0)))],
		["サイズ欄が 2 大きい", withRiffSize(lossy, lossy.length - 8 + 2)],
		["サイズ欄が 2 小さい", withRiffSize(lossy, lossy.length - 8 - 2)],
		["サイズ欄が 0xffffffff", withRiffSize(lossy, 0xffffffff)],
	])("RIFF のサイズの矛盾: %s → RIFF_SIZE_MISMATCH", (_label, bytes) => {
		expect(parseWebp(bytes)).toEqual({ ok: false, reason: "RIFF_SIZE_MISMATCH" });
	});

	it.each([
		[
			"チャンクが途中で切れている(RIFF のサイズ欄は合わせた)",
			withRiffSize(lossy.subarray(0, lossy.length - 10)),
		],
		[
			"チャンクのサイズ欄が 0xffffffff",
			riffWebp(concat(ascii("VP8 "), u32le(0xffffffff), vp8Payload(8, 8))),
		],
		[
			"最後のチャンクの後ろに 8 バイト未満のデータがある",
			withRiffSize(concat(riffWebp(chunk("VP8 ", vp8Payload(8, 8))), new Uint8Array(4))),
		],
		[
			"奇数バイトのチャンクの詰め物が無い",
			riffWebp(chunk("VP8 ", vp8Payload(8, 8, { size: 31 }), { pad: false })),
		],
		[
			"単純形式(VP8)の後ろに別のチャンクがある",
			riffWebp(chunk("VP8 ", vp8Payload(8, 8)), chunk("EXIF", new Uint8Array(4))),
		],
		[
			"単純形式(VP8L)の後ろに別のチャンクがある",
			riffWebp(chunk("VP8L", vp8lPayload(8, 8)), chunk("VP8L", vp8lPayload(8, 8))),
		],
	])("チャンクの並びの矛盾: %s → MALFORMED_CHUNK", (_label, bytes) => {
		expect(parseWebp(bytes)).toEqual({ ok: false, reason: "MALFORMED_CHUNK" });
	});

	it.each([
		// lossy.webp のオフセット 12〜15 の "VP8 " の "8" を "9" にする。
		["VP9 ", withByte(lossy, 14, "9".charCodeAt(0))],
		[
			"VP8x(小文字)",
			riffWebp(chunk("VP8x", vp8xPayload(0, 8, 8)), chunk("VP8 ", vp8Payload(8, 8))),
		],
		["ALPH", riffWebp(chunk("ALPH", new Uint8Array(4)), chunk("VP8 ", vp8Payload(8, 8)))],
		["ANIM", riffWebp(chunk("ANIM", new Uint8Array(6)))],
	])("最初のチャンクが %s → UNSUPPORTED_FORMAT", (_label, bytes) => {
		expect(parseWebp(bytes)).toEqual({ ok: false, reason: "UNSUPPORTED_FORMAT" });
	});

	it.each([
		["開始コードが違う", withByte(lossy, FIRST_PAYLOAD + 3, 0x9c)],
		[
			"キーフレームでない",
			riffWebp(chunk("VP8 ", vp8Payload(8, 8, { frameTag: (1 << 5) | (1 << 4) | 1 }))),
		],
		[
			"版が 4",
			riffWebp(chunk("VP8 ", vp8Payload(8, 8, { frameTag: (1 << 5) | (1 << 4) | (4 << 1) }))),
		],
		["表示しないフレーム", riffWebp(chunk("VP8 ", vp8Payload(8, 8, { frameTag: 1 << 5 })))],
		[
			"最初のパーティションがチャンクより大きい",
			riffWebp(chunk("VP8 ", vp8Payload(8, 8, { frameTag: (32 << 5) | (1 << 4), size: 32 }))),
		],
		["幅が 0", riffWebp(chunk("VP8 ", vp8Payload(0, 8)))],
		["高さが 0(上位 2 ビットだけ立っている)", riffWebp(chunk("VP8 ", vp8Payload(8, 0xc000)))],
		["フレームヘッダーより短い(9 バイト)", riffWebp(chunk("VP8 ", vp8Payload(8, 8, { size: 9 })))],
		[
			"VP8X の中の VP8 が壊れている",
			riffWebp(
				chunk("VP8X", vp8xPayload(0, 8, 8)),
				chunk("VP8 ", vp8Payload(8, 8, { startCode: [0, 0, 0] })),
			),
		],
	])("VP8: %s → INVALID_VP8_HEADER", (_label, bytes) => {
		expect(parseWebp(bytes)).toEqual({ ok: false, reason: "INVALID_VP8_HEADER" });
	});

	it.each([
		["シグネチャが 0x2f でない", withByte(fixture("lossless.webp"), FIRST_PAYLOAD, 0x2e)],
		["版が 1", riffWebp(chunk("VP8L", vp8lPayload(8, 8, { version: 1 })))],
		["版が 7", riffWebp(chunk("VP8L", vp8lPayload(8, 8, { version: 7 })))],
		["ヘッダーより短い(4 バイト)", riffWebp(chunk("VP8L", vp8lPayload(8, 8, { size: 4 })))],
		[
			"VP8X の中の VP8L が壊れている",
			riffWebp(
				chunk("VP8X", vp8xPayload(0, 8, 8)),
				chunk("VP8L", vp8lPayload(8, 8, { signature: 0 })),
			),
		],
	])("VP8L: %s → INVALID_VP8L_HEADER", (_label, bytes) => {
		expect(parseWebp(bytes)).toEqual({ ok: false, reason: "INVALID_VP8L_HEADER" });
	});

	it.each([
		[
			"VP8X チャンクが 10 バイトでない",
			riffWebp(
				chunk("VP8X", concat(vp8xPayload(0, 8, 8), new Uint8Array(2))),
				chunk("VP8 ", vp8Payload(8, 8)),
			),
		],
		[
			"キャンバスの面積が 2^32 以上(16,777,216 × 256)",
			riffWebp(
				chunk("VP8X", vp8xPayload(FLAG_ANIMATION, 2 ** 24, 256)),
				chunk("ANMF", new Uint8Array(16)),
			),
		],
	])("VP8X: %s → INVALID_VP8X_HEADER", (_label, bytes) => {
		expect(parseWebp(bytes)).toEqual({ ok: false, reason: "INVALID_VP8X_HEADER" });
	});

	it.each([
		["VP8X だけ", riffWebp(chunk("VP8X", vp8xPayload(0, 8, 8)))],
		[
			"透過のデータ(ALPH)だけ",
			riffWebp(chunk("VP8X", vp8xPayload(FLAG_ALPHA, 8, 8)), chunk("ALPH", new Uint8Array(4))),
		],
		[
			"アニメーションに ANMF が無い",
			riffWebp(chunk("VP8X", vp8xPayload(FLAG_ANIMATION, 8, 8)), chunk("ANIM", new Uint8Array(6))),
		],
		[
			"静止画に ANMF しか無い",
			riffWebp(chunk("VP8X", vp8xPayload(0, 8, 8)), chunk("ANMF", new Uint8Array(16))),
		],
	])("画像データが無い: %s → MISSING_IMAGE_DATA", (_label, bytes) => {
		expect(parseWebp(bytes)).toEqual({ ok: false, reason: "MISSING_IMAGE_DATA" });
	});

	it.each([
		// lossy-alpha.webp の VP8X のオフセット 24〜26 は「幅 - 1」= 260(0x000104)。下位バイトを 0x05 にして、幅を 262 にする。
		["キャンバスの幅が 1 大きい", withByte(fixture("lossy-alpha.webp"), FIRST_PAYLOAD + 4, 0x05)],
		[
			"キャンバスの幅と高さが入れ替わっている",
			riffWebp(chunk("VP8X", vp8xPayload(0, 30, 40)), chunk("VP8L", vp8lPayload(40, 30))),
		],
	])("VP8X: %s → CANVAS_SIZE_MISMATCH", (_label, bytes) => {
		expect(parseWebp(bytes)).toEqual({ ok: false, reason: "CANVAS_SIZE_MISMATCH" });
	});

	it.each(FIXTURES.filter((f) => f.imageDataLast))(
		"$file を途中で切ったものは、RIFF のサイズ欄を合わせても、どこで切っても受け付けない",
		({ file }) => {
			const bytes = fixture(file);
			for (let length = 0; length < bytes.length; length++) {
				expect(parseWebp(bytes.subarray(0, length)).ok).toBe(false);
			}
			// RIFF のサイズ欄(オフセット 4〜7)を書き換えられる長さから。
			for (let length = 8; length < bytes.length; length++) {
				expect(parseWebp(withRiffSize(bytes.subarray(0, length))).ok).toBe(false);
			}
		},
	);

	it.each(FIXTURES)("$file のどこを切っても、バイトを書き換えても、例外を投げない", ({ file }) => {
		const bytes = fixture(file);
		for (let length = 8; length < bytes.length; length++) {
			expect(() => parseWebp(withRiffSize(bytes.subarray(0, length)))).not.toThrow();
		}
		const next = random(bytes.length);
		for (let round = 0; round < 500; round++) {
			const copy = bytes.slice();
			// 半分はヘッダーの付近(先頭 64 バイト)だけを書き換える。
			const range = round % 2 === 0 ? Math.min(64, copy.length) : copy.length;
			for (let n = 0; n < 1 + (round % 3); n++) {
				copy[Math.floor(next() * range)] = Math.floor(next() * 256);
			}
			const result = parseWebp(copy);
			const size = result.ok ? [result.info.width, result.info.height] : [1, 1];
			expect(size.every((v) => Number.isInteger(v) && v >= 1)).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// base64 と data URL
// ---------------------------------------------------------------------------

const fromBase64Descriptor = Object.getOwnPropertyDescriptor(Uint8Array, "fromBase64");
const toBase64Descriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "toBase64");

/** `Uint8Array.fromBase64` / `toBase64` が無い実行環境(古いブラウザなど)を再現する */
function hideNativeBase64(): void {
	Object.defineProperty(Uint8Array, "fromBase64", { value: undefined, configurable: true });
	// oxlint-disable-next-line no-extend-native -- toBase64 が無い実行環境を、テストの間だけ再現する(afterEach で元に戻す)
	Object.defineProperty(Uint8Array.prototype, "toBase64", { value: undefined, configurable: true });
}

function restoreNativeBase64(): void {
	if (fromBase64Descriptor) Object.defineProperty(Uint8Array, "fromBase64", fromBase64Descriptor);
	if (toBase64Descriptor) {
		// oxlint-disable-next-line no-extend-native -- hideNativeBase64 で消した元の toBase64 を戻す
		Object.defineProperty(Uint8Array.prototype, "toBase64", toBase64Descriptor);
	}
}

/** 不正な base64。どちらのデコーダーでも INVALID_BASE64 になること */
const INVALID_BASE64_CASES: ReadonlyArray<readonly [string, string]> = [
	["詰め物の省略(2 文字)", "QQ"],
	["詰め物の省略(3 文字)", "QUI"],
	["長さが 4 の倍数でない", "QUJDQ"],
	["スペース", "QUJD QUJ"],
	["改行", "QUJD\nQUJ"],
	["タブ", "QUJD\tQUJ"],
	["復帰", "QUJD\rQUJ"],
	["改ページ", "QUJD\fQUJ"],
	["空白だけ", "    "],
	["末尾の空白", "QUJDQUJD    "],
	["詰め物の前の空白", "QUJ DQ=="],
	["垂直タブ", "QU\vD"],
	["ノーブレークスペース", "QU D"],
	["URL 用の文字(-)", "QU-D"],
	["URL 用の文字(_)", "QU_D"],
	["記号", "QU!D"],
	["ASCII 以外", "QUあD"],
	["途中の詰め物", "QQ==QUJD"],
	["詰め物が 3 つ", "Q==="],
	["詰め物だけ", "===="],
	["先頭の詰め物", "=QUJ"],
	["正規でない(= の前の下位 2 ビットが 0 でない)", "QUJ="],
	["正規でない(== の前の下位 4 ビットが 0 でない)", "QR=="],
];

describe.each([
	{ runtime: "Uint8Array.fromBase64 / toBase64", native: true },
	{ runtime: "atob / btoa", native: false },
])("base64($runtime)", ({ native }) => {
	beforeEach(() => {
		if (!native) hideNativeBase64();
	});

	afterEach(() => {
		restoreNativeBase64();
		vi.restoreAllMocks();
	});

	it("この実行環境の関数でデコード・エンコードする", () => {
		const atob = vi.spyOn(globalThis, "atob");
		const btoa = vi.spyOn(globalThis, "btoa");

		expect(decodeBase64("QUJD")).toEqual({ ok: true, bytes: ascii("ABC") });
		expect(encodeBase64(ascii("ABC"))).toBe("QUJD");
		expect(atob).toHaveBeenCalledTimes(native ? 0 : 1);
		expect(btoa).toHaveBeenCalledTimes(native ? 0 : 1);
	});

	it.each([
		["", []],
		["QQ==", [0x41]],
		["QUI=", [0x41, 0x42]],
		["QUJD", [0x41, 0x42, 0x43]],
		["+/8=", [0xfb, 0xff]],
	])("%j をデコードできる", (base64, expected) => {
		expect(decodeBase64(base64)).toEqual({ ok: true, bytes: Uint8Array.from(expected) });
	});

	it.each(INVALID_BASE64_CASES)("%s → INVALID_BASE64", (_label, base64) => {
		expect(decodeBase64(base64)).toEqual({ ok: false, reason: "INVALID_BASE64" });
	});

	it("エンコードとデコードで元に戻る(0〜11 バイトと、256 通りのバイト値)", () => {
		const samples = [
			...Array.from({ length: 12 }, (_, n) =>
				Uint8Array.from({ length: n }, (_value, i) => (i * 97 + 13) & 0xff),
			),
			Uint8Array.from({ length: 256 }, (_, i) => i),
		];
		for (const bytes of samples) {
			const base64 = encodeBase64(bytes);
			// Node.js の Buffer を、別の実装の答えとして使う。
			expect(base64).toBe(Buffer.from(bytes).toString("base64"));
			expect(decodeBase64(base64)).toEqual({ ok: true, bytes });
		}
	});

	it.each(FIXTURES)("$file の data URL を分解して、元の WebP に戻せる", ({ file, info }) => {
		const bytes = fixture(file);
		const dataUrl = toWebpDataUrl(bytes);

		expect(dataUrl.startsWith(WEBP_DATA_URL_PREFIX)).toBe(true);
		expect(decodeWebpDataUrl(dataUrl)).toEqual({ ok: true, bytes });
		expect(parseWebpDataUrl(dataUrl)).toEqual({ ok: true, bytes, info });
	});
});

describe("decodeWebpDataUrl / parseWebpDataUrl", () => {
	const lossy = fixture("lossy.webp");
	const base64 = encodeBase64(lossy);

	it.each([
		["空文字", ""],
		["PNG の data URL", `data:image/png;base64,${base64}`],
		["大文字", `DATA:IMAGE/WEBP;BASE64,${base64}`],
		["base64 の指定が無い", `data:image/webp,${base64}`],
		["パラメーター付き", `data:image/webp;charset=utf-8;base64,${base64}`],
		["先頭に空白", ` ${WEBP_DATA_URL_PREFIX}${base64}`],
		["カンマが無い", `data:image/webp;base64${base64}`],
		["base64 だけ", base64],
	])("%s → NOT_WEBP_DATA_URL", (_label, dataUrl) => {
		expect(decodeWebpDataUrl(dataUrl)).toEqual({ ok: false, reason: "NOT_WEBP_DATA_URL" });
		expect(parseWebpDataUrl(dataUrl)).toEqual({ ok: false, reason: "NOT_WEBP_DATA_URL" });
	});

	it("base64 の途中に改行がある → INVALID_BASE64", () => {
		const dataUrl = `${WEBP_DATA_URL_PREFIX}${base64.slice(0, 76)}\n${base64.slice(76)}`;

		expect(parseWebpDataUrl(dataUrl)).toEqual({ ok: false, reason: "INVALID_BASE64" });
	});

	it("中身が WebP でない(PNG)→ NOT_WEBP", () => {
		const png = concat(
			Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
			new Uint8Array(24),
		);

		expect(parseWebpDataUrl(toWebpDataUrl(png))).toEqual({ ok: false, reason: "NOT_WEBP" });
	});

	it("途中で切れた WebP → RIFF_SIZE_MISMATCH", () => {
		const dataUrl = toWebpDataUrl(lossy.subarray(0, lossy.length - 3));

		expect(parseWebpDataUrl(dataUrl)).toEqual({ ok: false, reason: "RIFF_SIZE_MISMATCH" });
	});

	it("接頭辞だけ → TOO_SHORT", () => {
		expect(parseWebpDataUrl(WEBP_DATA_URL_PREFIX)).toEqual({ ok: false, reason: "TOO_SHORT" });
	});
});

// ---------------------------------------------------------------------------
// 保存サイズの計算(仕様書 6.2)
// ---------------------------------------------------------------------------

describe("保存サイズの計算(仕様書 6.2)", () => {
	it("接頭辞は data:image/webp;base64, の 23 文字", () => {
		expect(WEBP_DATA_URL_PREFIX).toBe("data:image/webp;base64,");
		expect(WEBP_DATA_URL_PREFIX).toHaveLength(23);
	});

	it("境界値: WebP 本体 74,982 バイトは保存 99,999 で予算 100,000 以内、74,983 バイトは 100,003 で予算外", () => {
		expect(maxWebpBytesForBudget(100_000)).toBe(74_982);
		expect(storedBytesForWebp(74_982)).toBe(99_999);
		expect(storedBytesForWebp(74_983)).toBe(100_003);
		// 実際に data URL を作っても同じ長さになる。
		expect(toWebpDataUrl(new Uint8Array(74_982))).toHaveLength(99_999);
		expect(toWebpDataUrl(new Uint8Array(74_983))).toHaveLength(100_003);
	});

	it.each([
		[0, 23],
		[1, 27],
		[2, 27],
		[3, 27],
		[4, 31],
		[74_668, 99_583], // 仕様書 付録 A.4 の p4(1024px・画質 77)
	])("WebP 本体 %i バイト → 保存 %i バイト", (webpBytes, stored) => {
		expect(storedBytesForWebp(webpBytes)).toBe(stored);
		expect(toWebpDataUrl(new Uint8Array(webpBytes))).toHaveLength(stored);
	});

	it("0〜300 バイトで、計算した保存サイズが実際の data URL の長さと一致する", () => {
		for (let n = 0; n <= 300; n++) {
			expect(storedBytesForWebp(n)).toBe(toWebpDataUrl(new Uint8Array(n)).length);
		}
	});

	it.each([
		[23, 0],
		[26, 0],
		[27, 3],
		[8_000, 5_982],
		[99_999, 74_982],
		[100_000, 74_982],
		[100_002, 74_982],
		[100_003, 74_985],
		[500_000, 374_982],
	])("予算 %i バイト → WebP 本体は %i バイトまで", (budget, maxWebp) => {
		expect(maxWebpBytesForBudget(budget)).toBe(maxWebp);
	});

	it("逆算した上限は予算に収まり、1 バイト増やすと収まらない(予算 23〜3,000 と主な値)", () => {
		const budgets = [
			...Array.from({ length: 3_000 - 23 + 1 }, (_, i) => 23 + i),
			7_999,
			8_000,
			8_001,
			99_999,
			100_000,
			100_001,
			499_999,
			500_000,
			500_001,
		];
		for (const budget of budgets) {
			const max = maxWebpBytesForBudget(budget);
			expect(storedBytesForWebp(max)).toBeLessThanOrEqual(budget);
			expect(storedBytesForWebp(max + 1)).toBeGreaterThan(budget);
		}
	});

	it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"WebP 本体のバイト数が 0 以上の整数でない(%s)→ RangeError",
		(value) => {
			expect(() => storedBytesForWebp(value)).toThrow(RangeError);
		},
	);

	it.each([22, 0, -1, 0.5, Number.NaN])("予算が 23 未満か整数でない(%s)→ RangeError", (value) => {
		expect(() => maxWebpBytesForBudget(value)).toThrow(RangeError);
	});
});
