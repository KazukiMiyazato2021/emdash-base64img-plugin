/**
 * base64-image プラグインの共有定数。
 *
 * ブラウザ(管理画面)・Workers(サーバー)・サイト側のどこからでも読み込める。
 * 値の出典は仕様書(`plans/base64-image-plugin-spec.md`)の章で示す。
 */

// ---------------------------------------------------------------------------
// 名前
// ---------------------------------------------------------------------------

/** プラグイン ID(仕様書 14 章) */
export const PLUGIN_ID = "base64-image";

/** widget の種類 */
export const WIDGET_KINDS = ["image", "gallery"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/** フィールド定義の `widget` に書く値(`<プラグイン ID>:<種類>`。仕様書 13.1) */
export const WIDGET_IDS = {
	image: "base64-image:image",
	gallery: "base64-image:gallery",
} as const satisfies Record<WidgetKind, `${typeof PLUGIN_ID}:${WidgetKind}`>;

/** 画像本体を置く非表示コレクション(仕様書 5.1) */
export const IMAGE_COLLECTION = "b64_images";

/** `b64_images` の `json` フィールド。値は `Base64ImageEntry`(仕様書 5.1) */
export const IMAGE_FIELD = "image";

/** 参照元などのメタデータを置くプラグインストレージ。キーは画像 ID、値は `ImageRefsRecord`(仕様書 5.3) */
export const IMAGE_REFS_STORAGE = "imageRefs";

/** 参照の `v` と、画像エントリの `meta.v` に入れるスキーマのバージョン */
export const SCHEMA_VERSION = 1;

/** 保存する画像の MIME タイプ */
export const WEBP_MIME_TYPE = "image/webp";

// ---------------------------------------------------------------------------
// 固定上限(フィールドの options では広げられない)
// ---------------------------------------------------------------------------

/**
 * 保存する data URL(先頭の `data:image/webp;base64,` を含む全体)の長さの固定上限(バイト)。
 * フィールドの `maxStoredBytes` はこれを超えない(仕様書 8 章①、13.2)。
 */
export const MAX_STORED_BYTES_LIMIT = 500_000;

/** `maxStoredBytes` の下限(バイト) */
export const MIN_STORED_BYTES_LIMIT = 10_000;

/**
 * サムネイルの data URL(先頭の `data:image/webp;base64,` を含む全体)の長さの上限(バイト。仕様書 5.3、6.4、8 章①)。
 * `maxStoredBytes` と同じく、保存する文字列の長さで数える。WebP 本体に直すと 5,982 バイト以下
 * (`23 + 4 × ceil(B / 3) ≤ 8,000`)。
 */
export const THUMB_MAX_STORED_BYTES = 8_000;

/** サムネイルの長辺(px)の目安(仕様書 6.4) */
export const THUMB_EDGE = 96;

/**
 * 代替テキストの最大文字数(仕様書 5.2)。Unicode のコードポイントで数える(zod 4.5 の `max` の数え方)。
 * HTML の `maxlength` は UTF-16 のコード単位で数えるので、入力欄に付けると、入力欄の制限のほうが厳しいか同じになる。
 */
export const MAX_ALT_LENGTH = 1_000;

/** 画質の上限。画質は `minQuality` からこの値までの範囲で探す(仕様書 6.3) */
export const MAX_QUALITY = 0.92;

/** 画質の下限まで下げても収まらないときに、長辺に掛ける倍率(仕様書 6.3) */
export const SHRINK_FACTOR = 0.8;

/** `maxEdge` / `minEdge` の上限(px) */
export const MAX_EDGE_LIMIT = 4_096;

/** `maxEdge` / `minEdge` の下限(px)。本体をサムネイルより小さくしない */
export const MIN_EDGE_LIMIT = THUMB_EDGE;

/** ギャラリーの枚数の固定上限。`maxItems` はこれを超えない */
export const MAX_ITEMS_LIMIT = 20;

/** WebP で表せる寸法の上限(px。libwebp の `WEBP_MAX_DIMENSION`)。値の形の検証に使う */
export const WEBP_MAX_DIMENSION = 16_383;

/** 元のファイル名の最大長(文字) */
export const MAX_FILENAME_LENGTH = 255;

// ---------------------------------------------------------------------------
// 入力画像(ブラウザ側。仕様書 6.5)
// ---------------------------------------------------------------------------

/** 入力ファイルの上限(バイト。40MB) */
export const MAX_INPUT_FILE_BYTES = 40_000_000;

/** 入力画像の画素数の上限(6,400 万画素) */
export const MAX_INPUT_PIXELS = 64_000_000;

// ---------------------------------------------------------------------------
// フィールドの options(仕様書 13.2)
// ---------------------------------------------------------------------------

/** options を省略したときの値 */
export const DEFAULT_FIELD_OPTIONS = {
	maxStoredBytes: 100_000,
	maxEdge: 1_600,
	minQuality: 0.6,
	minEdge: 480,
	maxItems: 10,
} as const;

/**
 * options の範囲。範囲外の値は `normalizeFieldOptions`(options.ts)が範囲内に丸める。
 * `minEdge` は、さらに `maxEdge` 以下に丸める。
 */
export const FIELD_OPTION_RANGES = {
	maxStoredBytes: { min: MIN_STORED_BYTES_LIMIT, max: MAX_STORED_BYTES_LIMIT },
	maxEdge: { min: MIN_EDGE_LIMIT, max: MAX_EDGE_LIMIT },
	minQuality: { min: 0, max: MAX_QUALITY },
	minEdge: { min: MIN_EDGE_LIMIT, max: MAX_EDGE_LIMIT },
	maxItems: { min: 1, max: MAX_ITEMS_LIMIT },
} as const;

// ---------------------------------------------------------------------------
// プラグインのルート(`/_emdash/api/plugins/base64-image/<名前>`)
// ---------------------------------------------------------------------------

/**
 * ルートの名前。どれも POST で呼び、入力は JSON の body で渡す。
 * GET / DELETE では入力が query 文字列から作られ(値が文字列になり、1 つだけの値は配列にならない)、スキーマの形と合わないため。
 */
export const ROUTES = {
	upload: "upload",
	preview: "preview",
	thumbnails: "thumbnails",
	imagesList: "images/list",
	imagesTrash: "images/trash",
} as const;
export type RouteKey = keyof typeof ROUTES;

/**
 * 各ルートに宣言する `permission`。省略すると Admin だけになるので、必ず宣言する。
 * - `upload` / `imagesTrash`: Contributor 以上(仕様書 7 章・10 章、T06)
 * - `preview` / `thumbnails`: `content:read`(T17)
 * - `imagesList`: Contributor 以上。Contributor もゴミ箱に移せるので、一覧も読めるようにする(T06)
 */
export const ROUTE_PERMISSIONS = {
	upload: "content:create",
	preview: "content:read",
	thumbnails: "content:read",
	imagesList: "content:read_drafts",
	imagesTrash: "content:create",
} as const satisfies Record<RouteKey, string>;

/**
 * 1 回のプレビュー取得で送る画像 ID の上限。超える分は分けて送る。
 * `ctx.content.get` は 1 件につき 2 クエリなので、D1 の 1 リクエスト 50 クエリに余裕を残す。
 */
export const PREVIEW_MAX_IDS = 10;

/** 1 回のサムネイル取得で送る画像 ID の上限(コンテンツ一覧の 1 ページ = 100 行) */
export const THUMBNAILS_MAX_IDS = 100;
