/**
 * WebP の data URL(`data:image/webp;base64,…`)の低レベル処理。
 *
 * - 保存サイズの計算(仕様書 6.2): data URL 全体の長さ = 23 + 4 × ceil(B / 3)。B は WebP 本体のバイト数。
 * - base64 のデコードとエンコード: `Uint8Array.fromBase64` / `toBase64` があれば使い、無ければ `atob` / `btoa`。
 * - data URL の分解と、WebP ヘッダーの解析までをまとめた `parseWebpDataUrl`(仕様書 8 章)。
 *
 * ブラウザ(管理画面)と Workers で動くので、`Buffer` など Node.js 専用の API は使わない。
 */

import { parseWebp, type WebpErrorReason, type WebpInfo } from "./webp";

/** 保存する data URL の接頭辞(23 文字) */
export const WEBP_DATA_URL_PREFIX = "data:image/webp;base64,";

/**
 * data URL として受け付けられない理由。
 * - `NOT_WEBP_DATA_URL`: `data:image/webp;base64,` で始まらない
 * - `INVALID_BASE64`: 接頭辞より後が、正しい base64 でない
 */
export type DataUrlErrorReason = "NOT_WEBP_DATA_URL" | "INVALID_BASE64";

export type Base64DecodeResult =
	| { readonly ok: true; readonly bytes: Uint8Array }
	| { readonly ok: false; readonly reason: "INVALID_BASE64" };

export type WebpDataUrlDecodeResult =
	| { readonly ok: true; readonly bytes: Uint8Array }
	| { readonly ok: false; readonly reason: DataUrlErrorReason };

export type WebpDataUrlParseResult =
	| { readonly ok: true; readonly bytes: Uint8Array; readonly info: WebpInfo }
	| { readonly ok: false; readonly reason: DataUrlErrorReason | WebpErrorReason };

const INVALID_BASE64 = { ok: false, reason: "INVALID_BASE64" } as const;

/**
 * `Uint8Array.fromBase64` / `toBase64` のうち、使う形だけを自前で宣言する。
 *
 * このプラグインは TS ソースのまま配布され、利用者の tsc が利用者の設定で `src` を検査する。
 * TypeScript 5.x や、lib を ES2022 などに絞った設定では、これらの型が lib に無い。
 * lib の型に頼らずに呼ぶことで、どの設定でも型が通るようにする(docs/git-dependency-ts-source.md)。
 */
interface Base64Uint8ArrayConstructor {
	readonly fromBase64?: (base64: string, options: { lastChunkHandling: "strict" }) => Uint8Array;
}
interface Base64Uint8Array {
	readonly toBase64?: () => string;
}

/** `btoa` の代わりに文字列を組み立てるとき、`String.fromCharCode` に 1 回で渡すバイト数 */
const BINARY_STRING_CHUNK = 0x2000;

/**
 * WebP 本体が `webpByteLength` バイトのときの、保存する data URL の長さ(すべて ASCII なので、バイト数と同じ)。
 *
 * 23 + 4 × ceil(B / 3)。例: 74,982 → 99,999、74,983 → 100,003。
 * @throws {RangeError} `webpByteLength` が 0 以上の整数でないとき
 */
export function storedBytesForWebp(webpByteLength: number): number {
	assertByteCount(webpByteLength, "webpByteLength");
	return WEBP_DATA_URL_PREFIX.length + 4 * Math.ceil(webpByteLength / 3);
}

/**
 * 保存する data URL を `maxStoredBytes` 以下にするための、WebP 本体の最大のバイト数(`storedBytesForWebp` の逆算)。
 *
 * 例: 100,000 → 74,982。
 * @throws {RangeError} `maxStoredBytes` が整数でないとき、または接頭辞の長さ(23)より小さいとき
 */
export function maxWebpBytesForBudget(maxStoredBytes: number): number {
	assertByteCount(maxStoredBytes, "maxStoredBytes");
	if (maxStoredBytes < WEBP_DATA_URL_PREFIX.length) {
		throw new RangeError(
			`maxStoredBytes は接頭辞の長さ(${WEBP_DATA_URL_PREFIX.length})以上にする: ${maxStoredBytes}`,
		);
	}
	// base64 は 3 バイトを 4 文字にする。予算に入る 4 文字の組の数 × 3 バイトが上限。
	return 3 * Math.floor((maxStoredBytes - WEBP_DATA_URL_PREFIX.length) / 4);
}

function assertByteCount(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} は 0 以上の整数にする: ${value}`);
	}
}

/**
 * 標準の base64(RFC 4648 4 章。`+` と `/`、`=` の詰め物あり)をデコードする。
 *
 * 次のものは不正として拒否する。`atob` と `Uint8Array.fromBase64` のどちらを使っても同じ結果にするため。
 * - 長さが 4 の倍数でない(詰め物の省略を含む)
 * - base64 の文字以外を含む(空白、URL 用の `-` / `_`、途中の `=` など)
 * - 詰め物の直前の文字で、使われない下位ビットが 0 でない(`QR==` など。正規の形でない)
 */
export function decodeBase64(base64: string): Base64DecodeResult {
	const length = base64.length;
	if (length % 4 !== 0) return INVALID_BASE64;
	let padding: 0 | 1 | 2 = 0;
	if (base64.endsWith("==")) padding = 2;
	else if (base64.endsWith("=")) padding = 1;
	if (padding !== 0 && !hasZeroUnusedBits(base64, padding)) return INVALID_BASE64;

	const bytes = decodeWithRuntime(base64);
	// atob と fromBase64 は、ASCII の空白(タブ・改行・改ページ・復帰・スペース)を黙って読み飛ばす。
	// 空白が混じっていれば、デコードしたバイト数が文字数から求めた値より少なくなるので、ここで拒否する。
	// 文字ごとの正規表現での検査より速い(docs/webp-data-url-validation.md)。
	if (bytes === undefined || bytes.length !== (length / 4) * 3 - padding) return INVALID_BASE64;
	return { ok: true, bytes };
}

/** 詰め物の直前の文字で、使われない下位ビット(`=` が 1 つなら 2 ビット、2 つなら 4 ビット)が 0 か */
function hasZeroUnusedBits(base64: string, padding: 1 | 2): boolean {
	const value = base64Value(base64.charCodeAt(base64.length - padding - 1));
	const unusedBits = padding === 1 ? 0b11 : 0b1111;
	return value >= 0 && (value & unusedBits) === 0;
}

/** base64 の 1 文字が表す 6 ビットの値。base64 の文字でなければ -1 */
function base64Value(code: number): number {
	if (code >= 0x41 && code <= 0x5a) return code - 0x41; // A-Z → 0〜25
	if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26; // a-z → 26〜51
	if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52; // 0-9 → 52〜61
	if (code === 0x2b) return 62; // +
	if (code === 0x2f) return 63; // /
	return -1;
}

/** 実行環境のデコーダーで base64 をデコードする。base64 として不正なら undefined */
function decodeWithRuntime(base64: string): Uint8Array | undefined {
	try {
		// 呼び出しのたびに確かめる(テストで、fromBase64 が無い環境を再現できるように)。
		const { fromBase64 } = Uint8Array as unknown as Base64Uint8ArrayConstructor;
		if (typeof fromBase64 === "function") {
			return fromBase64.call(Uint8Array, base64, { lastChunkHandling: "strict" });
		}
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	} catch (error) {
		// fromBase64 は SyntaxError を、atob は DOMException(InvalidCharacterError)を投げる。
		if (
			error instanceof SyntaxError ||
			(error instanceof DOMException && error.name === "InvalidCharacterError")
		) {
			return undefined;
		}
		throw error;
	}
}

/** バイト列を標準の base64(`=` の詰め物あり)にする */
export function encodeBase64(bytes: Uint8Array): string {
	const { toBase64 } = bytes as unknown as Base64Uint8Array;
	if (typeof toBase64 === "function") return toBase64.call(bytes);
	let binary = "";
	for (let i = 0; i < bytes.length; i += BINARY_STRING_CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + BINARY_STRING_CHUNK));
	}
	return btoa(binary);
}

/** WebP 本体のバイト列から、保存する data URL を作る(中身が WebP かどうかは確かめない) */
export function toWebpDataUrl(webp: Uint8Array): string {
	return WEBP_DATA_URL_PREFIX + encodeBase64(webp);
}

/**
 * WebP の data URL を分解して、WebP 本体のバイト列を返す。
 *
 * 接頭辞は `data:image/webp;base64,` と完全に一致すること(大文字・小文字も区別する)。
 * 長さの上限(`maxStoredBytes`)は、巨大な文字列をデコードしないよう、呼び出し側で先に確かめる。
 */
export function decodeWebpDataUrl(dataUrl: string): WebpDataUrlDecodeResult {
	if (!dataUrl.startsWith(WEBP_DATA_URL_PREFIX)) return { ok: false, reason: "NOT_WEBP_DATA_URL" };
	return decodeBase64(dataUrl.slice(WEBP_DATA_URL_PREFIX.length));
}

/**
 * WebP の data URL を分解し、WebP のヘッダーまで解析する(仕様書 8 章の「デコードした中身が WebP」の確認)。
 *
 * 寸法の一致・長辺・アニメーションを許すかどうかは、呼び出し側で `info` を見て決める。
 */
export function parseWebpDataUrl(dataUrl: string): WebpDataUrlParseResult {
	const decoded = decodeWebpDataUrl(dataUrl);
	// `=== false` で比べる。利用者の設定で strictNullChecks が無効だと、`!decoded.ok` では絞り込まれないため。
	if (decoded.ok === false) return decoded;
	const parsed = parseWebp(decoded.bytes);
	if (parsed.ok === false) return parsed;
	return { ok: true, bytes: decoded.bytes, info: parsed.info };
}
