/**
 * 管理画面から、このプラグインのルートと EmDash の標準 API を呼ぶクライアント(仕様書 7・10・11 章)。
 *
 * 送り方(EmDash 0.39.1 の管理画面の `apiFetch` と同じ。`references/emdash/packages/admin/src/lib/api/client.ts:17-21`):
 * - URL は同じオリジンの `/_emdash/api/...`。認証はログインのセッション cookie(`credentials: "same-origin"`)。
 * - CSRF 対策のヘッダー `X-EmDash-Request: 1` を必ず付ける。無いと 403 `CSRF_REJECTED` になる
 *   (`references/emdash/packages/core/src/plugins/http-route-dispatch.ts:75`、`astro/middleware/auth.ts:280-291`)。
 * - プラグインのルートは、どれも POST + JSON の body(`ROUTES`)。送る前に T03 のスキーマで確かめ、
 *   合わなければ送らずに `VALIDATION_ERROR` で reject する。
 * - リダイレクトは追わない(`redirect: "manual"`)。EmDash が API の要求をリダイレクトするのは、認証の middleware が
 *   例外を投げたとき(ログイン画面へ)だけなので、`UNAUTHORIZED` にする(`astro/middleware/auth.ts:732-736`。
 *   サイトのリダイレクト設定は `/_emdash` を対象にしない: `astro/middleware/redirect.ts:25`)。
 *   外部の認証(Cloudflare Access など)のログイン画面は別のオリジンにあり、追うと CORS で失敗して、通信のエラーと区別できない。
 *
 * 応答:
 * - 成功は `{ success: true, data }`。`data` を T03 のスキーマで確かめて返す。合わなければ `UNEXPECTED_RESPONSE`。
 * - 失敗は `Base64ImageError` で reject する。コードは次の順で決める。
 *   1. 401 は、body に関係なく `UNAUTHORIZED`(標準 API の middleware は `NOT_AUTHENTICATED` や、
 *      利用者が消えたときの `NOT_FOUND` を 401 で返すため)
 *   2. body が `{ success: false, error: { code, message } }` で、`code` がサーバーの返しうるコード
 *      (`SERVER_ERROR_CODES` / `HOST_ERROR_CODES`)なら、そのコード
 *   3. それ以外(知らないコード、JSON でない body)は、HTTP ステータスから決める(`errorCodeForStatus`)
 *   `details.status` に HTTP ステータス、`details.responseCode` に応答の元のコードを入れる。
 * - fetch 自体の失敗(と body の読み込みの失敗)は `NETWORK_ERROR`。
 * - `signal` が中断されたら、`signal.reason` で reject する(`AbortSignal#throwIfAborted` と同じ。`src/shared/pipeline.ts`)。
 */

import { z } from "zod";

import {
	IMAGE_COLLECTION,
	PLUGIN_ID,
	PREVIEW_MAX_IDS,
	ROUTES,
	THUMBNAILS_MAX_IDS,
	type RouteKey,
} from "../shared/constants";
import {
	Base64ImageError,
	HOST_ERROR_CODES,
	SERVER_ERROR_CODES,
	routeErrorBodySchema,
	type ErrorDetails,
	type HostErrorCode,
	type KnownErrorCode,
	type ServerErrorCode,
} from "../shared/errors";
import type { UploadImage } from "../shared/pipeline";
import {
	entryIdSchema,
	imagesListRequestSchema,
	imagesListResponseSchema,
	imagesTrashRequestSchema,
	imagesTrashResponseSchema,
	previewRequestSchema,
	previewResponseSchema,
	routeSuccessBodySchema,
	thumbnailsRequestSchema,
	thumbnailsResponseSchema,
	uploadRequestSchema,
	uploadResponseSchema,
} from "../shared/schema";
import type {
	ImagesListRequest,
	ImagesListResponse,
	ImagesTrashResponse,
	PreviewResponse,
	ThumbnailsResponse,
} from "../shared/types";

/** EmDash の API の起点(`references/emdash/packages/admin/src/lib/api/client.ts:11`) */
const API_BASE = "/_emdash/api";

/** このプラグインのルートの起点(`references/emdash/packages/core/src/astro/routes/api/plugins/[pluginId]/[...path].ts:4`) */
const PLUGIN_API_BASE = `${API_BASE}/plugins/${PLUGIN_ID}`;

/** CSRF 対策のヘッダー。値は `1` */
const CSRF_HEADER = "X-EmDash-Request";

/** 各関数の options */
export interface RequestOptions {
	readonly signal?: AbortSignal | undefined;
}

/** 標準の完全削除 API の応答の `data`(`references/emdash/packages/core/src/api/handlers/content.ts:1505-1508`) */
export const permanentDeleteResponseSchema = z.object({
	deleted: z.literal(true),
	id: entryIdSchema,
});
export type PermanentDeleteResponse = z.infer<typeof permanentDeleteResponseSchema>;

// ---------------------------------------------------------------------------
// 公開する関数
// ---------------------------------------------------------------------------

/** 画像を 1 枚アップロードし、参照(`alt` は空)を受け取る(`ROUTES.upload`。仕様書 7 章) */
export const uploadImage: UploadImage = (request, options = {}) =>
	callRoute("upload", uploadRequestSchema, request, uploadResponseSchema, options);

/**
 * 保存済みの画像の本体を取得する(`ROUTES.preview`。仕様書 11.2)。
 * ID は重複を除いて `PREVIEW_MAX_IDS` 件ずつに分けて送り、`items` を要求の順に並べて返す。ID が空なら送らない。
 */
export function fetchPreviews(
	ids: readonly string[],
	options: RequestOptions = {},
): Promise<PreviewResponse> {
	return callInChunks(ids, PREVIEW_MAX_IDS, options, (chunk) =>
		callRoute("preview", previewRequestSchema, { ids: chunk }, previewResponseSchema, options),
	);
}

/**
 * サムネイルを取得する(`ROUTES.thumbnails`。仕様書 11.4)。
 * ID は重複を除いて `THUMBNAILS_MAX_IDS` 件ずつに分けて送り、`items` を要求の順に並べて返す。ID が空なら送らない。
 */
export function fetchThumbnails(
	ids: readonly string[],
	options: RequestOptions = {},
): Promise<ThumbnailsResponse> {
	return callInChunks(ids, THUMBNAILS_MAX_IDS, options, (chunk) =>
		callRoute(
			"thumbnails",
			thumbnailsRequestSchema,
			{ ids: chunk },
			thumbnailsResponseSchema,
			options,
		),
	);
}

/** 画像管理の一覧を 1 ページ取得する(`ROUTES.imagesList`。仕様書 11.5)。次のページは `nextCursor` を渡す */
export function listImages(
	request: ImagesListRequest = {},
	options: RequestOptions = {},
): Promise<ImagesListResponse> {
	return callRoute(
		"imagesList",
		imagesListRequestSchema,
		request,
		imagesListResponseSchema,
		options,
	);
}

/** 画像をゴミ箱に移す(`ROUTES.imagesTrash`。仕様書 10 章。Contributor 以上) */
export function trashImage(id: string, options: RequestOptions = {}): Promise<ImagesTrashResponse> {
	return callRoute(
		"imagesTrash",
		imagesTrashRequestSchema,
		{ id },
		imagesTrashResponseSchema,
		options,
	);
}

/**
 * ゴミ箱に入った画像を完全に削除する。EmDash の標準 API
 * `DELETE /_emdash/api/content/b64_images/{id}/permanent` を、ログイン中の利用者の権限で呼ぶ(仕様書 10 章。管理者のみ)。
 * ゴミ箱に入っていない画像・無い画像は 404 `NOT_FOUND` になる。
 */
export async function deleteImagePermanently(
	id: string,
	options: RequestOptions = {},
): Promise<PermanentDeleteResponse> {
	options.signal?.throwIfAborted();
	// ID は URL のパスに入れるので、`/` や `.` を含まない形か確かめてから送る(`entryIdSchema`)。
	const validId = validateRequest(entryIdSchema, id);
	const url = `${API_BASE}/content/${IMAGE_COLLECTION}/${encodeURIComponent(validId)}/permanent`;
	return requestJson(url, "DELETE", undefined, permanentDeleteResponseSchema, options.signal);
}

/**
 * HTTP ステータスだけが分かるとき(body が JSON でない、知らないコードなど)のエラーコード。
 * 400 / 422 → `VALIDATION_ERROR`、401 → `UNAUTHORIZED`、403 → `FORBIDDEN`、404 → `NOT_FOUND`、
 * 405 → `METHOD_NOT_ALLOWED`、413 / 415 → `INVALID_PLUGIN_REQUEST`、5xx → `INTERNAL_ERROR`、
 * それ以外(408・409・429 など)→ `UNEXPECTED_RESPONSE`。
 */
export function errorCodeForStatus(status: number): KnownErrorCode {
	switch (status) {
		case 400:
		case 422:
			return "VALIDATION_ERROR";
		case 401:
			return "UNAUTHORIZED";
		case 403:
			return "FORBIDDEN";
		case 404:
			return "NOT_FOUND";
		case 405:
			return "METHOD_NOT_ALLOWED";
		case 413:
		case 415:
			return "INVALID_PLUGIN_REQUEST";
		default:
			return status >= 500 && status <= 599 ? "INTERNAL_ERROR" : "UNEXPECTED_RESPONSE";
	}
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** サーバーが応答の `error.code` で返しうるコード。ブラウザ側のコード(`CLIENT_ERROR_CODES`)は受け付けない */
const RESPONSE_ERROR_CODES: ReadonlySet<string> = new Set<string>([
	...SERVER_ERROR_CODES,
	...HOST_ERROR_CODES,
]);

function isResponseErrorCode(code: string): code is ServerErrorCode | HostErrorCode {
	return RESPONSE_ERROR_CODES.has(code);
}

/** 成功の包み。`data` の形は、ルートごとのスキーマで別に確かめる */
const successEnvelopeSchema = routeSuccessBodySchema(z.unknown());

/** プラグインのルートを POST + JSON で呼ぶ */
async function callRoute<Req extends z.ZodType, Res extends z.ZodType>(
	route: RouteKey,
	requestSchema: Req,
	input: z.input<Req>,
	responseSchema: Res,
	options: RequestOptions,
): Promise<z.output<Res>> {
	options.signal?.throwIfAborted();
	const body = validateRequest(requestSchema, input);
	const url = `${PLUGIN_API_BASE}/${ROUTES[route]}`;
	return requestJson(url, "POST", body, responseSchema, options.signal);
}

/** ID の重複を除き、`size` 件ずつに分けて並行して呼び、`items` を要求の順につなげる */
async function callInChunks<Item>(
	ids: readonly string[],
	size: number,
	options: RequestOptions,
	call: (chunk: string[]) => Promise<{ items: Item[] }>,
): Promise<{ items: Item[] }> {
	options.signal?.throwIfAborted();
	const unique = [...new Set(ids)];
	const chunks: string[][] = [];
	for (let start = 0; start < unique.length; start += size) {
		chunks.push(unique.slice(start, start + size));
	}
	const responses = await Promise.all(chunks.map((chunk) => call(chunk)));
	return { items: responses.flatMap((response) => response.items) };
}

/** 送る前に入力を確かめる。合わなければ送らずに `VALIDATION_ERROR` */
function validateRequest<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
	const parsed = schema.safeParse(input);
	if (parsed.success === false) {
		throw new Base64ImageError("VALIDATION_ERROR", "Request does not match the input schema", {
			cause: parsed.error,
		});
	}
	return parsed.data;
}

async function requestJson<S extends z.ZodType>(
	url: string,
	method: "POST" | "DELETE",
	body: unknown,
	dataSchema: S,
	signal: AbortSignal | undefined,
): Promise<z.output<S>> {
	signal?.throwIfAborted();
	const headers = new Headers({ [CSRF_HEADER]: "1" });
	if (body !== undefined) headers.set("Content-Type", "application/json");

	let response: Response;
	let text: string;
	try {
		// body と signal は、あるときだけ入れる(`RequestInit` の省略できるプロパティに `undefined` を入れない。
		// 利用者の設定で exactOptionalPropertyTypes が有効でも型が通るように。T04-1)。
		const init: RequestInit = { method, headers, credentials: "same-origin", redirect: "manual" };
		if (body !== undefined) init.body = JSON.stringify(body);
		if (signal !== undefined) init.signal = signal;
		// `fetch` は呼ぶときに読む(テストで `globalThis.fetch` を差し替えられるように)。
		response = await globalThis.fetch(url, init);
		text = await response.text();
	} catch (error) {
		signal?.throwIfAborted();
		throw new Base64ImageError("NETWORK_ERROR", `Request to ${url} failed`, { cause: error });
	}
	signal?.throwIfAborted();

	const status = response.status;
	if (response.type === "opaqueredirect" || (status >= 300 && status <= 399)) {
		throw new Base64ImageError("UNAUTHORIZED", `Request to ${url} was redirected`, {
			details: { status },
		});
	}

	const json = parseJson(text);
	if (!response.ok) throw errorFromResponse(url, status, json);

	// 包み(`{ success: true, data }`)と `data` の形を順に確かめる。
	// `=== false` で比べる(利用者の設定で strictNullChecks が無効でも絞り込まれるように。T04-1)。
	const envelope = successEnvelopeSchema.safeParse(json);
	if (envelope.success === false) throw unexpectedResponse(url, status, envelope.error);
	const parsed = dataSchema.safeParse(envelope.data.data);
	if (parsed.success === false) throw unexpectedResponse(url, status, parsed.error);
	return parsed.data;
}

function unexpectedResponse(url: string, status: number, cause: z.ZodError): Base64ImageError {
	return new Base64ImageError("UNEXPECTED_RESPONSE", `Unexpected response from ${url}`, {
		details: { status },
		cause,
	});
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function errorFromResponse(url: string, status: number, json: unknown): Base64ImageError {
	const parsed = routeErrorBodySchema.safeParse(json);
	const responseCode = parsed.success ? parsed.data.error.code : undefined;
	let code: KnownErrorCode;
	if (status === 401) {
		code = "UNAUTHORIZED";
	} else if (responseCode !== undefined && isResponseErrorCode(responseCode)) {
		code = responseCode;
	} else {
		code = errorCodeForStatus(status);
	}
	const details: ErrorDetails = responseCode === undefined ? { status } : { status, responseCode };
	const message = parsed.success
		? parsed.data.error.message
		: `Request to ${url} failed with HTTP ${status}`;
	return new Base64ImageError(code, message, { details });
}
