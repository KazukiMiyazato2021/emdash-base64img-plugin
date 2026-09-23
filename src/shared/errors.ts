/**
 * エラーコード(SCREAMING_SNAKE_CASE)と、ルートの応答で使うエラーの形。
 *
 * - ルート: ハンドラーは EmDash の `PluginRouteError(code, message, ERROR_HTTP_STATUS[code])` を投げる。
 *   EmDash はこれを、HTTP ステータスと body `{ success: false, error: { code, message } }` に変換する。
 *   `PluginRouteError` の `details` は応答に含まれない(EmDash 0.39.1 で実測。`docs/emdash-plugin-route-errors.md`)。
 *   そのため、画面に出す文言はコードだけで決める。`message` は英語で、ログと調査に使う。
 * - 保存 hook: `ContentSaveRejectedError(message)` を投げる。EmDash はコード `SAVE_REJECTED` と `message` だけを返すので、
 *   どのフィールドの何が問題かを `message` に書く。
 * - ブラウザ側: 入力の判定・圧縮・通信のエラーは `Base64ImageError` で投げ、画面はコードから文言を選ぶ。
 */

import { z } from "zod";

/** このプラグインのサーバー側(ルート・保存 hook・検証)で使うコード */
export const SERVER_ERROR_CODES = [
	// 保存先のコレクション・フィールドが無い、またはこのプラグインの widget ではない(仕様書 8 章①)
	"INVALID_TARGET",
	// 画像本体(仕様書 8 章①②)
	"IMAGE_DATA_INVALID",
	"IMAGE_TOO_LARGE",
	"IMAGE_DIMENSIONS_MISMATCH",
	"IMAGE_EDGE_TOO_LONG",
	"IMAGE_ENTRY_INVALID",
	// サムネイル(仕様書 8 章①)
	"THUMB_DATA_INVALID",
	"THUMB_TOO_LARGE",
	// 参照(仕様書 8 章③)
	"REFERENCE_INVALID",
	"ALT_TOO_LONG",
	"GALLERY_TOO_MANY_ITEMS",
	"GALLERY_DUPLICATE_ITEM",
	// 画像が無い(`imageRefs` に無い・ゴミ箱に入っている・削除された)
	"IMAGE_NOT_FOUND",
	// 画像管理の一覧のカーソルが不正
	"INVALID_CURSOR",
	// `b64_images` コレクションが無い(仕様書 13.1)
	"IMAGE_COLLECTION_MISSING",
	// 画像エントリの作成・公開・メタデータの保存に失敗した(仕様書 7 章)
	"UPLOAD_FAILED",
] as const;
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

/** ルートで `PluginRouteError` を投げるときの HTTP ステータス */
export const ERROR_HTTP_STATUS = {
	INVALID_TARGET: 400,
	IMAGE_DATA_INVALID: 400,
	IMAGE_TOO_LARGE: 400,
	IMAGE_DIMENSIONS_MISMATCH: 400,
	IMAGE_EDGE_TOO_LONG: 400,
	IMAGE_ENTRY_INVALID: 400,
	THUMB_DATA_INVALID: 400,
	THUMB_TOO_LARGE: 400,
	REFERENCE_INVALID: 400,
	ALT_TOO_LONG: 400,
	GALLERY_TOO_MANY_ITEMS: 400,
	GALLERY_DUPLICATE_ITEM: 400,
	IMAGE_NOT_FOUND: 404,
	INVALID_CURSOR: 400,
	IMAGE_COLLECTION_MISSING: 500,
	UPLOAD_FAILED: 500,
} as const satisfies Record<ServerErrorCode, 400 | 404 | 500>;

/** ブラウザ側(入力の判定・圧縮・通信)で使うコード。サーバーには送らない */
export const CLIENT_ERROR_CODES = [
	// 入力(仕様書 6.5)
	"INPUT_HEIC_REJECTED",
	"INPUT_SVG_REJECTED",
	"INPUT_FORMAT_REJECTED",
	"INPUT_DECODE_FAILED",
	"INPUT_FILE_TOO_LARGE",
	"INPUT_TOO_MANY_PIXELS",
	// 圧縮(仕様書 6.1〜6.4)
	// canvas が WebP を作れない(Safari など。仕様書 6.1)
	"BROWSER_UNSUPPORTED",
	// canvas からの画像の書き出しに失敗した
	"ENCODE_FAILED",
	// `minEdge` まで縮めても `maxStoredBytes` に収まらない(仕様書 6.3)
	"COMPRESSION_OVER_BUDGET",
	// サムネイルの data URL が `THUMB_MAX_STORED_BYTES` に収まらない(仕様書 6.4)
	"THUMB_OVER_BUDGET",
	// 通信
	"NETWORK_ERROR",
	"UNEXPECTED_RESPONSE",
] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

/** このプラグインのエラーコード */
export type ErrorCode = ServerErrorCode | ClientErrorCode;

/**
 * EmDash 0.39.1 が、プラグインのルートと、画面から呼ぶ標準 API(完全削除
 * `DELETE /_emdash/api/content/b64_images/{id}/permanent`)で返すコード。
 * 画面の文言を用意するために並べている(このプラグインは投げない)。
 */
export const HOST_ERROR_CODES = [
	// 401: ログインしていない
	"UNAUTHORIZED",
	// 403: ルートの permission に足りない
	"FORBIDDEN",
	// 403: `X-EmDash-Request: 1` ヘッダーが無い
	"CSRF_REJECTED",
	// 403: API トークンに admin スコープが無い
	"INSUFFICIENT_SCOPE",
	// 404: ルートが無い・プラグインが無効・(標準 API の完全削除で)ゴミ箱に入っていない
	"NOT_FOUND",
	// 405
	"METHOD_NOT_ALLOWED",
	// 400: ルートの `input` スキーマに合わない
	"VALIDATION_ERROR",
	// 400 / 413 / 415: body を読めない・大きすぎる
	"INVALID_PLUGIN_REQUEST",
	// 500: ハンドラーの想定外の例外(`message` は固定の文になる)
	"INTERNAL_ERROR",
	// 500: EmDash が初期化されていない
	"NOT_CONFIGURED",
	// 500: 完全削除に失敗した(標準 API)
	"CONTENT_DELETE_ERROR",
] as const;
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

/** 画面で文言を用意するコード */
export type KnownErrorCode = ErrorCode | HostErrorCode;

/** 利用者に伝える注意(エラーではない) */
export const NOTICE_CODES = [
	// GIF は最初のフレームだけの静止画になる(仕様書 6.5)
	"GIF_FIRST_FRAME_ONLY",
] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<string>([
	...SERVER_ERROR_CODES,
	...CLIENT_ERROR_CODES,
	...HOST_ERROR_CODES,
]);

/** 文言を用意しているコードか(ルートの応答の `error.code` を確かめるのに使う) */
export function isKnownErrorCode(value: unknown): value is KnownErrorCode {
	return typeof value === "string" && KNOWN_ERROR_CODES.has(value);
}

/** エラーの追加情報(文言への差し込みとログに使う) */
export type ErrorDetails = Readonly<Record<string, string | number>>;

export interface Base64ImageErrorOptions {
	details?: ErrorDetails;
	cause?: unknown;
}

/**
 * このプラグインの処理で起きたエラー。
 * サーバー側では、ルートは `PluginRouteError` に、保存 hook は `ContentSaveRejectedError` に変換して投げる。
 */
export class Base64ImageError extends Error {
	override readonly name = "Base64ImageError";
	readonly code: KnownErrorCode;
	readonly details: ErrorDetails | undefined;

	constructor(code: KnownErrorCode, message: string = code, options: Base64ImageErrorOptions = {}) {
		super(message, "cause" in options ? { cause: options.cause } : undefined);
		this.code = code;
		this.details = options.details;
	}
}

/** `Base64ImageError` か。バンドラーがモジュールを複製したときのため、名前とコードでも確かめる */
export function isBase64ImageError(error: unknown): error is Base64ImageError {
	if (error instanceof Base64ImageError) return true;
	return (
		error instanceof Error &&
		error.name === "Base64ImageError" &&
		isKnownErrorCode((error as { code?: unknown }).code)
	);
}

/** ルートがエラーを返したときの body(HTTP ステータスは 4xx / 5xx) */
export const routeErrorBodySchema = z.object({
	success: z.literal(false),
	error: z.object({
		code: z.string(),
		message: z.string(),
	}),
});
export type RouteErrorBody = z.infer<typeof routeErrorBodySchema>;
