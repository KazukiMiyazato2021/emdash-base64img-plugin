/**
 * 管理画面が使うデータ取得のルート(仕様書 11.2・11.4)。
 *
 * - `preview`: 画像エントリ(`b64_images`)の本体を返す。widget が保存済みの画像を表示するのに使う(T22・T27・T28)。
 * - `thumbnails`: プラグインストレージ `imageRefs` のサムネイルを返す。コンテンツ一覧の列が使う(T24)。
 *
 * どちらも permission は `content:read`(Subscriber 以上)で、POST + JSON の body で ID を受け取る(`ROUTES`)。
 * 応答の `items` は、要求した ID から重複を除き、要求の順に並べる。見つからない画像は `null` にする。
 *
 * 登録は T29 が行う:
 * `definePlugin({ capabilities: ["content:read", …], storage: { imageRefs: … }, routes: { [ROUTES.preview]: previewRoute, [ROUTES.thumbnails]: thumbnailsRoute } })`
 */

import type { ContentAccess, LogAccess, PluginRoute, StorageCollection } from "emdash";

import {
	IMAGE_COLLECTION,
	IMAGE_FIELD,
	IMAGE_REFS_STORAGE,
	PREVIEW_MAX_IDS,
	ROUTE_PERMISSIONS,
	THUMBNAILS_MAX_IDS,
} from "../../shared/constants";
import { WEBP_DATA_URL_PREFIX } from "../../shared/data-url";
import {
	base64ImageEntrySchema,
	previewRequestSchema,
	thumbnailSchema,
	thumbnailsRequestSchema,
} from "../../shared/schema";
import type {
	Base64ImageEntry,
	PreviewItem,
	PreviewRequest,
	PreviewResponse,
	Thumbnail,
	ThumbnailItem,
	ThumbnailsRequest,
	ThumbnailsResponse,
} from "../../shared/types";
import { getManyInBatches } from "../image-refs";

// ---------------------------------------------------------------------------
// 上限
// ---------------------------------------------------------------------------

/** 画像エントリの ID の最大の長さ(`entryIdSchema` と同じ。テストで確かめる) */
const ENTRY_ID_MAX_LENGTH = 128;

/** body の上限に足す余裕(バイト)。空白や改行を入れた JSON を送るクライアントのため */
const BODY_MARGIN_BYTES = 1_024;

/**
 * `{"ids":[…]}` の body の上限(バイト)。
 * ID の最大数だけ最大の長さの ID を並べた、空白なしの JSON(画面の `JSON.stringify` と同じ形)の大きさに、余裕を足す。
 * ID は ASCII なので、文字数とバイト数が同じになる。
 * 宣言しないと、EmDash は body を上限なしに読む(docs/emdash-plugin-route-body-limit.md)。
 */
function idsBodyMaxBytes(maxIds: number): number {
	const ids = Array.from({ length: maxIds }, () => "0".repeat(ENTRY_ID_MAX_LENGTH));
	return JSON.stringify({ ids }).length + BODY_MARGIN_BYTES;
}

/** プレビュー取得の body の上限(バイト)。10 件なら 1,319 + 1,024 = 2,343 */
export const PREVIEW_MAX_BODY_BYTES = idsBodyMaxBytes(PREVIEW_MAX_IDS);

/** サムネイル取得の body の上限(バイト)。100 件なら 13,109 + 1,024 = 14,133 */
export const THUMBNAILS_MAX_BODY_BYTES = idsBodyMaxBytes(THUMBNAILS_MAX_IDS);

/** サイトに表示される画像エントリの `status`(サイトの取得は既定で `published` だけを読む。`loader.ts:1233`) */
const PUBLISHED_STATUS = "published";

// ログと例外のメッセージには、プラグイン ID を付けない。EmDash が `[plugin:base64-image]` を付けて出す。

// ---------------------------------------------------------------------------
// ハンドラーが使う ctx
// ---------------------------------------------------------------------------

/**
 * プレビュー取得のハンドラーが使う ctx の部分。ルートでは EmDash の `RouteContext<PreviewRequest>` が渡る。
 * `content` は、プラグインが capability `content:read` を宣言したときだけ入る。
 */
export interface PreviewRouteContext {
	readonly input: PreviewRequest;
	readonly content?: Pick<ContentAccess, "get"> | undefined;
	readonly log: Pick<LogAccess, "warn">;
}

/**
 * サムネイル取得のハンドラーが使う ctx の部分。ルートでは EmDash の `RouteContext<ThumbnailsRequest>` が渡る。
 * `storage` には、プラグインが宣言したストレージ(`imageRefs`)が入る。
 */
export interface ThumbnailsRouteContext {
	readonly input: ThumbnailsRequest;
	readonly storage: Readonly<Record<string, Pick<StorageCollection, "getMany"> | undefined>>;
	readonly log: Pick<LogAccess, "warn">;
}

/** `ctx.content.get` の結果のうち、この処理が使う部分 */
interface ContentEntry {
	readonly status: string;
	readonly data: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// プレビュー取得(`ROUTES.preview`。仕様書 11.2)
// ---------------------------------------------------------------------------

/**
 * 画像エントリの本体を返す。
 *
 * - ID ごとに `ctx.content.get("b64_images", id)` を並行に呼ぶ。見つかった画像は 1 件 2 クエリ、
 *   見つからない画像は 1 クエリ(docs/emdash-plugin-content-query-counts.md)。
 * - `image` を `null` にするのは、サイトに表示されない画像: ゴミ箱に入った・無い(`get` がどちらも `null`)、
 *   公開していない、値が不正(seed や手での書き換えは保存 hook を通らない)、`src` が WebP の data URL でない。
 *   ゴミ箱と無い画像は区別しない(`getTrashedVersioned` には capability `content:restore` が要り、widget は区別しない)。
 * - 取得の失敗(データベースのエラー)は、そのまま投げる(EmDash が 500 `INTERNAL_ERROR` にする)。
 *   `null` にすると、widget が「画像が見つかりません」と表示し、編集者が参照を外してしまうため。
 */
export async function handlePreview(ctx: PreviewRouteContext): Promise<PreviewResponse> {
	const content = ctx.content;
	if (content === undefined) {
		throw new Error(`ctx.content is missing. Declare the "content:read" capability.`);
	}

	const unpublished: string[] = [];
	const invalid: string[] = [];
	const items = await Promise.all(
		uniqueIds(ctx.input.ids).map(async (id): Promise<PreviewItem> => {
			const entry: ContentEntry | null = await content.get(IMAGE_COLLECTION, id);
			if (entry === null) return { id, image: null };
			if (entry.status !== PUBLISHED_STATUS) {
				unpublished.push(id);
				return { id, image: null };
			}
			const image = parseImageEntry(entry.data[IMAGE_FIELD]);
			if (image === null) invalid.push(id);
			return { id, image };
		}),
	);

	if (unpublished.length > 0) {
		ctx.log.warn(
			`${unpublished.length} image(s) in "${IMAGE_COLLECTION}" are not published; returning null: ${unpublished.join(", ")}`,
		);
	}
	if (invalid.length > 0) {
		ctx.log.warn(
			`${invalid.length} image(s) in "${IMAGE_COLLECTION}" have an invalid value; returning null: ${invalid.join(", ")}`,
		);
	}
	return { items };
}

/** 画像エントリの値を確かめる。形(スキーマ)と、`src` が WebP の data URL であること(サイト側の T15 と同じ) */
function parseImageEntry(value: unknown): Base64ImageEntry | null {
	const parsed = base64ImageEntrySchema.safeParse(value);
	// `=== false` で比べる(利用者の設定で strictNullChecks が無効でも絞り込まれるように。T04-1)。
	if (parsed.success === false) return null;
	return parsed.data.src.startsWith(WEBP_DATA_URL_PREFIX) ? parsed.data : null;
}

export const previewRoute: PluginRoute<PreviewRequest> = {
	permission: ROUTE_PERMISSIONS.preview, // "content:read"(Subscriber 以上)
	methods: ["POST"],
	request: { body: "json", maxBytes: PREVIEW_MAX_BODY_BYTES },
	input: previewRequestSchema,
	handler: handlePreview,
};

// ---------------------------------------------------------------------------
// サムネイル取得(`ROUTES.thumbnails`。仕様書 11.4)
// ---------------------------------------------------------------------------

/**
 * `imageRefs` のサムネイルと本体の寸法を返す。
 *
 * - ID を `IMAGE_REFS_BATCH_SIZE`(50)件ずつに分けて、`getMany` を並行に呼ぶ(`getManyInBatches`。100 件で 2 クエリ)。
 * - `thumbnail` を `null` にするのは、`imageRefs` に無い画像(完全削除した・記録が無い)と、記録の値が不正な画像。
 *   ゴミ箱に入った画像は `imageRefs` に残るので、サムネイルを返す(`b64_images` を 1 件ずつ読まないと区別できない)。
 * - 取得の失敗は、そのまま投げる(EmDash が 500 `INTERNAL_ERROR` にする)。
 */
export async function handleThumbnails(ctx: ThumbnailsRouteContext): Promise<ThumbnailsResponse> {
	const imageRefs = ctx.storage[IMAGE_REFS_STORAGE];
	if (imageRefs === undefined) {
		throw new Error(
			`ctx.storage.${IMAGE_REFS_STORAGE} is missing. Declare it in the plugin's storage.`,
		);
	}

	const ids = uniqueIds(ctx.input.ids);
	const records = await getManyInBatches(imageRefs, ids);

	const invalid: string[] = [];
	const items = ids.map((id): ThumbnailItem => {
		if (!records.has(id)) return { id, thumbnail: null };
		const thumbnail = parseThumbnail(records.get(id));
		if (thumbnail === null) invalid.push(id);
		return { id, thumbnail };
	});

	if (invalid.length > 0) {
		ctx.log.warn(
			`${invalid.length} record(s) in "${IMAGE_REFS_STORAGE}" have no valid thumbnail; returning null: ${invalid.join(", ")}`,
		);
	}
	return { items };
}

/**
 * `imageRefs` の記録から、サムネイルと本体の寸法だけを取り出す(`thumbnailSchema` は知らないキーを落とす)。
 * `owners` などほかの項目は確かめない(サムネイルの表示に使わないため)。
 */
function parseThumbnail(record: unknown): Thumbnail | null {
	const parsed = thumbnailSchema.safeParse(record);
	if (parsed.success === false) return null;
	return parsed.data.thumb.startsWith(WEBP_DATA_URL_PREFIX) ? parsed.data : null;
}

export const thumbnailsRoute: PluginRoute<ThumbnailsRequest> = {
	permission: ROUTE_PERMISSIONS.thumbnails, // "content:read"(Subscriber 以上)
	methods: ["POST"],
	request: { body: "json", maxBytes: THUMBNAILS_MAX_BODY_BYTES },
	input: thumbnailsRequestSchema,
	handler: handleThumbnails,
};

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** 重複を除き、最初に現れた順に並べる */
function uniqueIds(ids: readonly string[]): string[] {
	return [...new Set(ids)];
}
