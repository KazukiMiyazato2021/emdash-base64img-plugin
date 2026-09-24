/**
 * 値の zod スキーマと type guard(仕様書 5・7・9・11 章)。
 *
 * - スキーマは値の形(型・必須・範囲)だけを確かめる。data URL の中身(`data:image/webp;base64,` で始まる WebP か、
 *   寸法が合うか)、フィールドごとの上限(`maxStoredBytes` / `maxEdge` / `maxItems`)、ギャラリーの重複は、
 *   検証ロジック(T11・T16)が確かめる。
 * - 保存する値とルートへの入力は `z.strictObject`(知らないキーを拒否する)。
 *   ルートの応答とプラグインストレージの値は `z.object`(知らないキーは落とす)。
 */

import { z } from "zod";

import {
	MAX_ALT_LENGTH,
	MAX_FILENAME_LENGTH,
	MAX_ITEMS_LIMIT,
	MAX_STORED_BYTES_LIMIT,
	PREVIEW_MAX_IDS,
	SCHEMA_VERSION,
	THUMB_MAX_STORED_BYTES,
	THUMBNAILS_MAX_IDS,
	WEBP_MAX_DIMENSION,
	WEBP_MIME_TYPE,
} from "./constants";

// ---------------------------------------------------------------------------
// 部品
// ---------------------------------------------------------------------------

/** コレクション・フィールドの slug(EmDash と同じ規則) */
export const slugSchema = z
	.string()
	.max(63)
	.regex(/^[a-z][a-z0-9_]*$/);

/**
 * エントリ ID。EmDash が作る ID は ULID(26 文字)。seed で slug を省いたエントリは、seed に書いた `id` がそのまま ID になる。
 * そのため ULID に限らず、英数字で始まり、英数字・`_`・`-` だけからなる 128 文字までを受け付ける
 * (`/` と `.` を含まないので、URL のパスに入れても別のパスを指さない)。
 */
export const entryIdSchema = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z_-]{0,127}$/);

/** ロケール(BCP 47。EmDash の `LOCALE_CODE_PATTERN` と同じ規則で、大文字・小文字はそのまま保つ) */
export const localeSchema = z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i);

/** 画像の寸法(px) */
export const dimensionSchema = z.int().min(1).max(WEBP_MAX_DIMENSION);

/** 代替テキスト。空文字は装飾画像として扱う */
export const altSchema = z.string().max(MAX_ALT_LENGTH);

/** 圧縮時の画質(0〜1) */
export const qualitySchema = z.number().min(0).max(1);

/** 元のファイル名 */
export const filenameSchema = z.string().min(1).max(MAX_FILENAME_LENGTH);

/**
 * data URL に使える文字(空白を除く ASCII の印字可能文字)。
 * zod 4.5 は文字列の長さを Unicode のコードポイントで数える(`node_modules/zod/v4/core/checks.js:331`)。
 * ASCII だけならコードポイントの数とバイト数が一致するので、長さの上限をバイトの上限として使える。
 */
const DATA_URL_PATTERN = /^[\x21-\x7E]+$/;

/** 画像本体の data URL。長さは固定上限(バイト)まで */
export const imageDataUrlSchema = z.string().max(MAX_STORED_BYTES_LIMIT).regex(DATA_URL_PATTERN);

/** サムネイルの data URL。長さは上限(バイト)まで */
export const thumbDataUrlSchema = z.string().max(THUMB_MAX_STORED_BYTES).regex(DATA_URL_PATTERN);

/** WebP 本体のバイト数。data URL より必ず小さいので、data URL の固定上限で抑える */
export const webpBytesSchema = z.int().min(1).max(MAX_STORED_BYTES_LIMIT);

/** 日時(ISO 8601、UTC。`Date#toISOString()` の形) */
export const isoDateTimeSchema = z.iso.datetime();

// ---------------------------------------------------------------------------
// 画像エントリ(`b64_images` の `image` フィールドの値。仕様書 5.1)
// ---------------------------------------------------------------------------

export const base64ImageMetaSchema = z.strictObject({
	/** スキーマのバージョン */
	v: z.literal(SCHEMA_VERSION),
	/** WebP 本体のバイト数 */
	bytes: webpBytesSchema,
	/** 圧縮時の画質。ブラウザが申告した値で、表示だけに使う */
	quality: qualitySchema.optional(),
});

/**
 * 画像エントリの値。`id` は持たない(エントリ ID は、作成が終わるまで決まらないため)。
 * 読み出すときにエントリ ID を `id` に入れると、EmDash の `MediaValue` に代入できる形になる。
 */
export const base64ImageEntrySchema = z.strictObject({
	src: imageDataUrlSchema,
	mimeType: z.literal(WEBP_MIME_TYPE),
	width: dimensionSchema,
	height: dimensionSchema,
	filename: filenameSchema.optional(),
	meta: base64ImageMetaSchema,
});

// ---------------------------------------------------------------------------
// 参照(投稿側のフィールドの値。仕様書 5.2)
// ---------------------------------------------------------------------------

/** 単一画像のフィールド(`base64-image:image`)の値 */
export const base64ImageRefSchema = z.strictObject({
	v: z.literal(SCHEMA_VERSION),
	/** 画像エントリの ID */
	id: entryIdSchema,
	/** 画像エントリのロケール */
	locale: localeSchema,
	width: dimensionSchema,
	height: dimensionSchema,
	alt: altSchema,
});

/** ギャラリーのフィールド(`base64-image:gallery`)の値。枚数はフィールドの `maxItems` でも抑える(T16) */
export const base64ImageGallerySchema = z.array(base64ImageRefSchema).max(MAX_ITEMS_LIMIT);

/** 値が参照の形か。`json` フィールドの値(型は `unknown`)を絞り込む(仕様書 12 章) */
export function isBase64ImageRef(value: unknown): value is z.infer<typeof base64ImageRefSchema> {
	return base64ImageRefSchema.safeParse(value).success;
}

/** 値がギャラリーの形か */
export function isBase64ImageGallery(
	value: unknown,
): value is z.infer<typeof base64ImageGallerySchema> {
	return base64ImageGallerySchema.safeParse(value).success;
}

// ---------------------------------------------------------------------------
// 参照元メタデータ(プラグインストレージ `imageRefs` の値。キーは画像 ID。仕様書 5.3)
// ---------------------------------------------------------------------------

/** 画像を参照しているエントリとフィールド */
export const imageOwnerSchema = z.object({
	collection: slugSchema,
	entryId: entryIdSchema,
	locale: localeSchema,
	field: slugSchema,
});

export const imageRefsRecordSchema = z.object({
	/** 追記だけを行う(仕様書 9 章) */
	owners: z.array(imageOwnerSchema),
	/** WebP 本体のバイト数 */
	bytes: webpBytesSchema,
	width: dimensionSchema,
	height: dimensionSchema,
	thumb: thumbDataUrlSchema,
	createdAt: isoDateTimeSchema,
	/** アップロードした利用者の ID */
	createdBy: z.string().min(1),
});

// ---------------------------------------------------------------------------
// ルートの入出力。入力は JSON の body で、応答は EmDash が `{ success: true, data }` で包む
// ---------------------------------------------------------------------------

// アップロード(`ROUTES.upload`。仕様書 7 章)

/** 保存先。`entryId` と `locale` は分かるときだけ送る(新規エントリには `entryId` が無い) */
export const uploadTargetSchema = z.strictObject({
	collection: slugSchema,
	field: slugSchema,
	entryId: entryIdSchema.optional(),
	locale: localeSchema.optional(),
});

export const uploadRequestSchema = z.strictObject({
	dataUrl: imageDataUrlSchema,
	thumb: thumbDataUrlSchema,
	width: dimensionSchema,
	height: dimensionSchema,
	/** 圧縮時の画質(画像エントリの `meta.quality` に保存する) */
	quality: qualitySchema,
	filename: filenameSchema.optional(),
	target: uploadTargetSchema,
});

/** 作った画像への参照(`alt` は空)。widget はこれをそのままフィールドの値にできる */
export const uploadResponseSchema = z.object({
	ref: base64ImageRefSchema,
});

// プレビュー取得(`ROUTES.preview`。仕様書 11.2)

export const previewRequestSchema = z.strictObject({
	ids: z.array(entryIdSchema).min(1).max(PREVIEW_MAX_IDS),
});

/** `image` は、画像が見つからない(ゴミ箱に入った・削除された)とき null */
export const previewItemSchema = z.object({
	id: entryIdSchema,
	image: base64ImageEntrySchema.nullable(),
});

/** `items` は、要求した ID から重複を除き、要求の順に並べる */
export const previewResponseSchema = z.object({
	items: z.array(previewItemSchema),
});

// サムネイル取得(`ROUTES.thumbnails`。仕様書 11.4)

export const thumbnailsRequestSchema = z.strictObject({
	ids: z.array(entryIdSchema).min(1).max(THUMBNAILS_MAX_IDS),
});

/** `width` / `height` は本体の寸法(サムネイルの縦横比を決めるのに使う) */
export const thumbnailSchema = z.object({
	thumb: thumbDataUrlSchema,
	width: dimensionSchema,
	height: dimensionSchema,
});

/** `thumbnail` は、`imageRefs` に無いとき null */
export const thumbnailItemSchema = z.object({
	id: entryIdSchema,
	thumbnail: thumbnailSchema.nullable(),
});

/** `items` は、要求した ID から重複を除き、要求の順に並べる */
export const thumbnailsResponseSchema = z.object({
	items: z.array(thumbnailItemSchema),
});

// 画像管理の一覧(`ROUTES.imagesList`。仕様書 9 章・11.5)

/** 参照元ごとの状態: 使用中 / 参照元が削除された(ゴミ箱に入った場合を含む)/ 参照元から外された */
export const ownerStatusSchema = z.enum(["in_use", "owner_deleted", "detached"]);

/**
 * 画像ごとの状態(状態バッジ)。参照元が無ければ `no_owner`。
 * あれば、参照元ごとの状態のうち `in_use` → `owner_deleted` → `detached` の順で最初に見つかったもの
 * (参照元がゴミ箱から戻されると画像がまた必要になるので、`owner_deleted` を `detached` より先にする)。
 */
export const imageUsageSchema = z.enum(["in_use", "owner_deleted", "detached", "no_owner"]);

/**
 * 画像エントリ自身の状態。参照元ごとの状態とは別に持つ。
 * - `active`: ゴミ箱に入っていない
 * - `trashed`: ゴミ箱に入っている。完全削除のボタンは、この画像にだけ出す(T06)
 * - `missing`: `b64_images` にエントリが無い(`imageRefs` だけが残っている)
 */
export const imageEntryStatusSchema = z.enum(["active", "trashed", "missing"]);

/**
 * 画像エントリの公開の状態(サイトに出るか)。値は EmDash 0.39.1 の `status` と同じ名前(T21-2)。
 * - `published`: サイトに出る(サイトの取得は、`status` が `published` でゴミ箱に入っていないものだけ)
 * - `draft`: 出ない。公開の前に止まった画像と、ゴミ箱から戻した画像(戻すと必ず下書きになる)
 * - `scheduled`: 出ない。予約の日時が来ると、EmDash の定期処理が公開する
 */
export const imageEntryPublicationSchema = z.enum(["published", "draft", "scheduled"]);

export const imagesListRequestSchema = z.strictObject({
	/** 前の応答の `nextCursor`。省略すると先頭から */
	cursor: z.string().min(1).max(2048).optional(),
});

export const imageListOwnerSchema = imageOwnerSchema.extend({
	status: ownerStatusSchema,
});

export const imageListItemSchema = z.object({
	id: entryIdSchema,
	thumb: thumbDataUrlSchema,
	width: dimensionSchema,
	height: dimensionSchema,
	/** WebP 本体のバイト数 */
	bytes: webpBytesSchema,
	createdAt: isoDateTimeSchema,
	entryStatus: imageEntryStatusSchema,
	/** 画像エントリの公開の状態。`entryStatus` が `active` のときだけ値があり、`trashed` / `missing` では null */
	entryPublication: imageEntryPublicationSchema.nullable(),
	usage: imageUsageSchema,
	/** 参照元(記録の順に先頭から 20 件まで。4 つのキーが同じものは 1 件) */
	owners: z.array(imageListOwnerSchema),
	/** 参照元の全体の件数(`owners` と同じ数え方。`owners` の件数以上) */
	ownersTotal: z.int().min(0),
});

/** `nextCursor` が無ければ最後のページ */
export const imagesListResponseSchema = z.object({
	items: z.array(imageListItemSchema),
	nextCursor: z.string().min(1).optional(),
});

// ゴミ箱への移動(`ROUTES.imagesTrash`。仕様書 10 章)

export const imagesTrashRequestSchema = z.strictObject({
	id: entryIdSchema,
});

export const imagesTrashResponseSchema = z.object({
	id: entryIdSchema,
	trashed: z.literal(true),
});

// ---------------------------------------------------------------------------
// 応答の包み
// ---------------------------------------------------------------------------

/** 成功したときの body(`{ success: true, data }`)。エラーのときの形は errors.ts の `routeErrorBodySchema` */
export function routeSuccessBodySchema<T extends z.ZodType>(data: T) {
	return z.object({
		success: z.literal(true),
		data,
	});
}
