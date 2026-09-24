/**
 * 画像管理のルート(仕様書 9 章の判定、10 章のゴミ箱への移動、11.5 の画像管理ページ)。
 *
 * - `images/list`(`imagesListRoute`): `imageRefs` の画像を新しい順に 1 ページずつ返す。画像ごとに、画像エントリの
 *   状態(`entryStatus`)・参照元ごとの状態・状態バッジ(`usage`)を付ける。判定とページ送りは `src/server/orphans.ts`。
 *   permission は `content:read_drafts`(Contributor 以上。Contributor もゴミ箱に移せるので一覧を読めるようにする。T06)。
 * - `images/trash`(`imagesTrashRoute`): 画像エントリをゴミ箱に移す(`ctx.content.delete`。ソフト削除)。permission は
 *   `content:create`(Contributor 以上。T06)。`ctx.content.delete` は呼び出した利用者の権限を確かめないので、権限の確認は
 *   このルートの `permission` だけになる。
 *   - 使用中の画像も移す(使用中かどうかは確かめない)。画面(T25)が、一覧の `usage` を見て確認してから呼ぶ(仕様書 10 章)。
 *   - `imageRefs` に記録のある画像だけを扱う(一覧に出る画像だけ。seed などで作った画像は、標準の API で扱う)。
 *   - もうゴミ箱に入っていれば、成功として返す(二度押しや、ほかの人が先に移したとき)。画像エントリが無ければ 404。
 *   - 完全削除は、画面が標準の API を管理者の権限で呼ぶ(T14 の `deleteImagePermanently`)。記録は
 *     `content:afterDelete`(`src/server/hooks/image-deleted.ts`)が消す。
 *
 * 登録は T29 が行う(使う capability とストレージは下の ctx の型に書いた):
 * `definePlugin({ capabilities: ["schema:read", "content:read", "content:write", "content:revisions:read", "content:restore", …],
 *   storage: { imageRefs: { indexes: ["createdAt"] } },
 *   routes: { [ROUTES.imagesList]: imagesListRoute, [ROUTES.imagesTrash]: imagesTrashRoute } })`
 */

import type { LogAccess, PluginRoute } from "emdash";
import { PluginRouteError } from "emdash";

import { IMAGE_COLLECTION, IMAGE_REFS_STORAGE, ROUTE_PERMISSIONS } from "../../shared/constants";
import { ERROR_HTTP_STATUS } from "../../shared/errors";
import { imagesListRequestSchema, imagesTrashRequestSchema } from "../../shared/schema";
import type {
	ImagesListRequest,
	ImagesListResponse,
	ImagesTrashRequest,
	ImagesTrashResponse,
} from "../../shared/types";
import {
	IMAGES_LIST_CURSOR_MAX_LENGTH,
	decodeImagesListCursor,
	listImagesPage,
	type CollectionListing,
	type ImageRefsPageStore,
	type JudgeContentAccess,
	type OwnerEntryLike,
	type RevisionLike,
} from "../orphans";

// ログと例外のメッセージには、プラグイン ID を付けない。EmDash が `[plugin:base64-image]` を付けて出す。

// ---------------------------------------------------------------------------
// body の上限
// ---------------------------------------------------------------------------

/** 画像エントリの ID の最大の長さ(`entryIdSchema` と同じ。テストで確かめる) */
const ENTRY_ID_MAX_LENGTH = 128;

/** body の上限に足す余裕(バイト)。空白や改行を入れた JSON を送るクライアントのため */
const BODY_MARGIN_BYTES = 1_024;

/**
 * 一覧の body の上限(バイト)。最大の長さのカーソル(ASCII)を入れた空白なしの JSON に、余裕を足す。
 * 宣言しないと、EmDash は body を上限なしに読む(docs/emdash-plugin-route-body-limit.md)。
 */
export const IMAGES_LIST_MAX_BODY_BYTES =
	JSON.stringify({ cursor: "A".repeat(IMAGES_LIST_CURSOR_MAX_LENGTH) }).length + BODY_MARGIN_BYTES;

/** ゴミ箱への移動の body の上限(バイト)。最大の長さの ID を入れた空白なしの JSON に、余裕を足す */
export const IMAGES_TRASH_MAX_BODY_BYTES =
	JSON.stringify({ id: "0".repeat(ENTRY_ID_MAX_LENGTH) }).length + BODY_MARGIN_BYTES;

// ---------------------------------------------------------------------------
// 一覧(`ROUTES.imagesList`)
// ---------------------------------------------------------------------------

/**
 * 一覧が使う content の操作(EmDash の `ContentAccess` の一部)。
 * - `get`: capability `content:read`(`definePlugin` が足す)
 * - `getRevision`: capability `content:revisions:read`
 * - `getTrashedVersioned`: capability `content:restore`(ゴミ箱から戻す `restore` の権限も含む。このプラグインは呼ばない)
 */
export interface ImagesListContentAccess {
	get(collection: string, id: string): Promise<OwnerEntryLike | null>;
	getRevision?(collection: string, id: string, revisionId: string): Promise<RevisionLike | null>;
	getTrashedVersioned?(collection: string, id: string): Promise<unknown>;
}

/**
 * 一覧のハンドラーが使う ctx。ルートでは EmDash の `RouteContext<ImagesListRequest>` が渡る(型のテストで確かめる)。
 * - `schema`: capability `schema:read`(消されたコレクションの参照元の判定に使う)
 * - `storage[IMAGE_REFS_STORAGE]`: ストレージ `imageRefs`(インデックス `createdAt` で並べて読む)
 */
export interface ImagesListRouteContext {
	readonly input: ImagesListRequest;
	readonly content?: ImagesListContentAccess | undefined;
	readonly schema?: CollectionListing | undefined;
	readonly storage: { readonly [name: string]: ImageRefsPageStore | undefined };
	readonly log: Pick<LogAccess, "warn">;
}

/**
 * 一覧を 1 ページ返す(`src/server/orphans.ts` の `listImagesPage`)。
 * - カーソルが読めなければ 400 `INVALID_CURSOR`(画面は最初から読み直す)。
 * - 取得の失敗(データベースのエラー)は、そのまま投げる(EmDash が 500 `INTERNAL_ERROR` にする)。
 *   途中まで調べた結果を返すと、使われている画像を「使われていない」と誤って見せることがあるため。
 */
export async function handleImagesList(ctx: ImagesListRouteContext): Promise<ImagesListResponse> {
	const content = requireJudgeContent(ctx.content);
	const schema = ctx.schema;
	if (schema === undefined) throw missingCapability("ctx.schema", "schema:read");
	const imageRefs = ctx.storage[IMAGE_REFS_STORAGE];
	if (imageRefs === undefined) throw missingStorage();

	const decoded = decodeImagesListCursor(ctx.input.cursor);
	if (decoded.ok === false) {
		throw new PluginRouteError("INVALID_CURSOR", decoded.message, ERROR_HTTP_STATUS.INVALID_CURSOR);
	}
	const page = await listImagesPage({ content, schema, imageRefs, log: ctx.log }, decoded.cursor);
	return page.response;
}

function requireJudgeContent(content: ImagesListContentAccess | undefined): JudgeContentAccess {
	if (content === undefined) throw missingCapability("ctx.content", "content:read");
	if (content.getRevision === undefined) {
		throw missingCapability("ctx.content.getRevision", "content:revisions:read");
	}
	if (content.getTrashedVersioned === undefined) {
		throw missingCapability("ctx.content.getTrashedVersioned", "content:restore");
	}
	// 上で、省略できるメソッドがどちらもあることを確かめた
	return content as JudgeContentAccess;
}

export const imagesListRoute: PluginRoute<ImagesListRequest> = {
	permission: ROUTE_PERMISSIONS.imagesList, // "content:read_drafts"(Contributor 以上)
	methods: ["POST"],
	request: { body: "json", maxBytes: IMAGES_LIST_MAX_BODY_BYTES },
	input: imagesListRequestSchema,
	handler: handleImagesList,
};

// ---------------------------------------------------------------------------
// ゴミ箱への移動(`ROUTES.imagesTrash`)
// ---------------------------------------------------------------------------

/**
 * ゴミ箱への移動が使う content の操作(EmDash の `ContentAccess` の一部)。
 * - `delete`: capability `content:write`。ゴミ箱に移せたら true、もう入っている・無ければ false
 * - `getTrashedVersioned`: capability `content:restore`(`delete` が false のときだけ呼ぶ)
 */
export interface ImagesTrashContentAccess {
	delete?(collection: string, id: string): Promise<boolean>;
	getTrashedVersioned?(collection: string, id: string): Promise<unknown>;
}

/** プラグインストレージ `imageRefs` のうち、ゴミ箱への移動が使う部分(EmDash の `StorageCollection` をそのまま渡せる) */
export interface ImageRefsExistence {
	exists(id: string): Promise<boolean>;
}

/**
 * ゴミ箱への移動のハンドラーが使う ctx。ルートでは EmDash の `RouteContext<ImagesTrashRequest>` が渡る。
 * - `user`: private ルートでは EmDash が認証済みの利用者を入れる(ログに出す)
 * - `storage[IMAGE_REFS_STORAGE]`: ストレージ `imageRefs`
 */
export interface ImagesTrashRouteContext {
	readonly input: ImagesTrashRequest;
	readonly user?: { readonly id: string } | undefined;
	readonly content?: ImagesTrashContentAccess | undefined;
	readonly storage: { readonly [name: string]: ImageRefsExistence | undefined };
	readonly log: Pick<LogAccess, "info">;
}

/**
 * 画像エントリをゴミ箱に移す。クエリは、移せたとき 9(ルートの固定費 1、`exists` 1、`delete` 7。SQLite の実測)。
 * - `imageRefs` に記録が無ければ、404 `IMAGE_NOT_FOUND`(`delete` は呼ばない。2)。
 * - `delete` が false のとき、ゴミ箱に入っていれば成功として返す(9)。無ければ 404 `IMAGE_NOT_FOUND`(7)。
 */
export async function handleImagesTrash(
	ctx: ImagesTrashRouteContext,
): Promise<ImagesTrashResponse> {
	const content = ctx.content;
	if (content === undefined || content.delete === undefined) {
		throw missingCapability("ctx.content.delete", "content:write");
	}
	if (content.getTrashedVersioned === undefined) {
		throw missingCapability("ctx.content.getTrashedVersioned", "content:restore");
	}
	const imageRefs = ctx.storage[IMAGE_REFS_STORAGE];
	if (imageRefs === undefined) throw missingStorage();

	const id = ctx.input.id;
	if (!(await imageRefs.exists(id))) {
		throw imageNotFound(
			`Image ${id} is not managed by this plugin (no ${IMAGE_REFS_STORAGE} record)`,
		);
	}
	if (await content.delete(IMAGE_COLLECTION, id)) {
		ctx.log.info(`Moved image ${id} to the trash`, { id, userId: ctx.user?.id ?? null });
		return { id, trashed: true };
	}
	const trashed = await content.getTrashedVersioned(IMAGE_COLLECTION, id);
	if (trashed !== null && trashed !== undefined) return { id, trashed: true };
	throw imageNotFound(`Image entry ${id} does not exist in "${IMAGE_COLLECTION}"`);
}

export const imagesTrashRoute: PluginRoute<ImagesTrashRequest> = {
	permission: ROUTE_PERMISSIONS.imagesTrash, // "content:create"(Contributor 以上。T06)
	methods: ["POST"],
	request: { body: "json", maxBytes: IMAGES_TRASH_MAX_BODY_BYTES },
	input: imagesTrashRequestSchema,
	handler: handleImagesTrash,
};

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

function imageNotFound(message: string): PluginRouteError {
	return new PluginRouteError("IMAGE_NOT_FOUND", message, ERROR_HTTP_STATUS.IMAGE_NOT_FOUND);
}

/** プラグインの定義の誤り(EmDash が 500 `INTERNAL_ERROR` にし、メッセージをサーバーのログに出す) */
function missingCapability(what: string, capability: string): Error {
	return new Error(`${what} is missing. Declare the "${capability}" capability.`);
}

function missingStorage(): Error {
	return new Error(
		`ctx.storage.${IMAGE_REFS_STORAGE} is missing. Declare it in the plugin's storage.`,
	);
}
