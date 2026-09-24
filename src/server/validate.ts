/**
 * サーバー側の検証(仕様書 8 章の ① と ②)。
 *
 * - ① アップロード用ルート(T18): `validateUpload`。保存先のフィールド(`resolveUploadTarget`)を確かめ、
 *   そのフィールドの options で、画像本体とサムネイルの data URL(`validateUploadImages`)を確かめる。
 * - ② `b64_images` の `content:beforeSave`(T19): `validateImageEntry`。画像エントリの値を、固定上限
 *   (`IMAGE_ENTRY_LIMITS`)で確かめる。
 *
 * どれも EmDash の ctx を受け取らない純粋な関数で、例外は投げずに結果の値を返す。呼び出し側は
 * `result.ok === false` で判別し、ルートは `PluginRouteError(code, message, ERROR_HTTP_STATUS[code])` を、
 * 保存 hook は `ContentSaveRejectedError(message)` を投げる(投げる例外の種類が呼び出し側ごとに違うため)。
 *
 * data URL の検証の順番: 長さ(デコードする前。大きな文字列をデコードしない)→ data URL と WebP のヘッダー
 * → 静止画か → 寸法の一致 → 長辺。
 */

import {
	MAX_EDGE_LIMIT,
	MAX_STORED_BYTES_LIMIT,
	THUMB_EDGE,
	THUMB_MAX_STORED_BYTES,
	WEBP_MAX_DIMENSION,
	type WidgetKind,
} from "../shared/constants";
import { parseWebpDataUrl, type DataUrlErrorReason } from "../shared/data-url";
import type { ErrorDetails, ServerErrorCode } from "../shared/errors";
import { getWidgetKind, normalizeFieldOptions, type FieldOptions } from "../shared/options";
import { base64ImageEntrySchema } from "../shared/schema";
import type { Base64ImageEntry } from "../shared/types";
import type { WebpErrorReason, WebpInfo } from "../shared/webp";

// ---------------------------------------------------------------------------
// 結果の型
// ---------------------------------------------------------------------------

/** この検証が返すエラーコード(`ServerErrorCode` の一部)。`ERROR_HTTP_STATUS` では、どれも 400 */
export const VALIDATION_ERROR_CODES = [
	"INVALID_TARGET",
	"IMAGE_DATA_INVALID",
	"IMAGE_TOO_LARGE",
	"IMAGE_DIMENSIONS_MISMATCH",
	"IMAGE_EDGE_TOO_LONG",
	"IMAGE_ENTRY_INVALID",
	"THUMB_DATA_INVALID",
	"THUMB_TOO_LARGE",
] as const satisfies readonly ServerErrorCode[];
export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

/** 保存先を受け付けない理由(コードは、どれも `INVALID_TARGET`) */
export type TargetRejectionReason =
	| "COLLECTION_NOT_FOUND"
	| "COLLECTION_MISMATCH"
	| "FIELD_NOT_FOUND"
	| "NOT_PLUGIN_WIDGET"
	| "NOT_JSON_FIELD";

/**
 * 失敗の詳しい理由(ログと調査に使う。画面の文言はコードで決める)。
 * data URL と WebP の理由は T04 のもの(`DataUrlErrorReason` / `WebpErrorReason`)をそのまま入れる。
 */
export type ValidationReason =
	| TargetRejectionReason
	| DataUrlErrorReason
	| WebpErrorReason
	/** data URL の長さが上限を超える(デコードする前に確かめる) */
	| "STORED_BYTES_OVER_LIMIT"
	/** アニメーションの WebP(静止画だけを受け付ける) */
	| "ANIMATED"
	/** 申告された width / height が、WebP のヘッダーの寸法と違う */
	| "DIMENSIONS_MISMATCH"
	/** 長辺が上限を超える */
	| "EDGE_OVER_LIMIT"
	/** 画像エントリの値の形がスキーマに合わない */
	| "ENTRY_SHAPE"
	/** 画像エントリの `meta.bytes` が、WebP 本体のバイト数と違う */
	| "META_BYTES_MISMATCH";

/** 検証の失敗。`result.ok === false` で判別する */
export interface ValidationFailure<Code extends ValidationErrorCode = ValidationErrorCode> {
	readonly ok: false;
	readonly code: Code;
	readonly reason: ValidationReason;
	/**
	 * 英語。どの値の何が問題かを、上限と実際の値を添えて書く(data URL の中身は入れない)。
	 * ルートの `PluginRouteError` と保存 hook の `ContentSaveRejectedError` に、そのまま渡せる。
	 */
	readonly message: string;
	/** ログ用の追加情報(上限・実際の値など)。ルートの応答には入らない */
	readonly details: ErrorDetails;
}

/** 検証を通った data URL の情報 */
export interface CheckedWebp {
	/** data URL の長さ(バイト。ASCII なので文字数と同じ) */
	readonly storedBytes: number;
	/** WebP 本体のバイト数。画像エントリの `meta.bytes` と `imageRefs.bytes` に入れる値 */
	readonly webpBytes: number;
	/** WebP のヘッダーから読んだ情報(寸法・形式・透過) */
	readonly info: WebpInfo;
}

// ---------------------------------------------------------------------------
// 入力の型(EmDash と共有の型をそのまま渡せる、必要な部分だけの形)
// ---------------------------------------------------------------------------

/**
 * フィールド定義のうち、検証に使う部分。EmDash 0.39.1 の `ctx.schema.getCollection` が返す
 * `CollectionSchemaInfo.fields` の要素(`FieldSchemaInfo`)をそのまま渡せる。
 * `options` は DB の JSON を parse しただけの値なので、型に関係なく `unknown` として読む。
 */
export interface FieldSchemaLike {
	readonly slug: string;
	readonly type: string;
	readonly widget?: string | undefined;
	readonly options?: unknown;
}

/** コレクションの定義のうち、検証に使う部分(`CollectionSchemaInfo` をそのまま渡せる) */
export interface CollectionSchemaLike {
	readonly slug: string;
	readonly fields: readonly FieldSchemaLike[];
}

/** 保存先(アップロードの入力の `target`。`UploadTarget` をそのまま渡せる) */
export interface UploadTargetLike {
	readonly collection: string;
	readonly field: string;
}

/** アップロードの入力のうち、画像の検証に使う項目 */
export interface UploadImagesInput {
	readonly dataUrl: string;
	readonly thumb: string;
	readonly width: number;
	readonly height: number;
}

/** アップロードの入力のうち、検証に使う項目(ルートの `ctx.input` = `UploadRequest` をそのまま渡せる) */
export interface UploadInputLike extends UploadImagesInput {
	readonly target: UploadTargetLike;
}

/** 画像本体に当てる上限。`FieldOptions`(`normalizeFieldOptions` の結果)をそのまま渡せる */
export interface ImageLimits {
	/** data URL の長さの上限(バイト)。`MAX_STORED_BYTES_LIMIT` を超える値は、`MAX_STORED_BYTES_LIMIT` として扱う */
	readonly maxStoredBytes: number;
	/** 長辺の上限(px)。`WEBP_MAX_DIMENSION` を超える値は、`WEBP_MAX_DIMENSION` として扱う */
	readonly maxEdge: number;
}

// ---------------------------------------------------------------------------
// ① 保存先のフィールド
// ---------------------------------------------------------------------------

export type UploadTargetResult =
	| { readonly ok: true; readonly kind: WidgetKind; readonly options: FieldOptions }
	| ValidationFailure<"INVALID_TARGET">;

/**
 * フィールドが、このプラグインの widget を使う `json` フィールドなら、その種類を返す。そうでなければ null。
 *
 * 管理画面は、フィールドの型を見ずに widget を割り当てる。そのため `json` 以外のフィールドにも widget を
 * 指定できてしまうが、参照(オブジェクト)をそのまま保存できるのは `json` フィールドだけなので、型も確かめる。
 */
export function getFieldWidgetKind(field: FieldSchemaLike): WidgetKind | null {
	return field.type === "json" ? getWidgetKind(field.widget) : null;
}

/**
 * アップロードの保存先(`target.collection` の `target.field`)が、このプラグインの widget を使う `json`
 * フィールドかを確かめ、適用する options(`normalizeFieldOptions` で補完・丸めたもの)を返す。
 *
 * @param collection `ctx.schema.getCollection(target.collection)` の結果(コレクションが無ければ null)
 */
export function resolveUploadTarget(
	collection: CollectionSchemaLike | null,
	target: UploadTargetLike,
): UploadTargetResult {
	const name = `${target.collection}.${target.field}`;
	if (collection === null) {
		return fail(
			"INVALID_TARGET",
			"COLLECTION_NOT_FOUND",
			`Collection "${target.collection}" does not exist`,
			{ collection: target.collection },
		);
	}
	if (collection.slug !== target.collection) {
		// 呼び出し側の誤り(別のコレクションのスキーマを渡した)。受け付けずに止める
		return fail(
			"INVALID_TARGET",
			"COLLECTION_MISMATCH",
			`The schema of collection "${collection.slug}" was passed for "${target.collection}"`,
			{ collection: target.collection, schema: collection.slug },
		);
	}
	const field = collection.fields.find((candidate) => candidate.slug === target.field);
	if (field === undefined) {
		return fail("INVALID_TARGET", "FIELD_NOT_FOUND", `Field "${name}" does not exist`, {
			collection: target.collection,
			field: target.field,
		});
	}
	const kind = getWidgetKind(field.widget);
	if (kind === null) {
		return fail(
			"INVALID_TARGET",
			"NOT_PLUGIN_WIDGET",
			`Field "${name}" does not use a base64-image widget`,
			{ collection: target.collection, field: target.field, widget: String(field.widget ?? "") },
		);
	}
	if (field.type !== "json") {
		return fail(
			"INVALID_TARGET",
			"NOT_JSON_FIELD",
			`Field "${name}" uses a base64-image widget, but its type is "${field.type}" instead of "json"`,
			{ collection: target.collection, field: target.field, type: field.type },
		);
	}
	return { ok: true, kind, options: normalizeFieldOptions(field.options) };
}

// ---------------------------------------------------------------------------
// ① 画像本体とサムネイル
// ---------------------------------------------------------------------------

export type UploadImagesResult =
	| { readonly ok: true; readonly image: CheckedWebp; readonly thumb: CheckedWebp }
	| ValidationFailure;

/**
 * アップロードの画像本体(`dataUrl`)とサムネイル(`thumb`)を確かめる(仕様書 8 章①)。
 *
 * - 画像本体: 長さ ≤ `limits.maxStoredBytes` → 静止画の WebP の data URL → ヘッダーの寸法が `width` / `height`
 *   と一致 → 長辺 ≤ `limits.maxEdge`。
 * - サムネイル: 長さ ≤ `THUMB_MAX_STORED_BYTES` → 静止画の WebP の data URL → 長辺 ≤ `THUMB_EDGE`(仕様書 6.4)。
 * - 画像本体を先に確かめ、最初に見つかった問題を返す。
 */
export function validateUploadImages(
	input: UploadImagesInput,
	limits: ImageLimits,
): UploadImagesResult {
	const image = checkImage(input.dataUrl, input, limits, UPLOAD_IMAGE);
	if (image.ok === false) return image;
	const thumb = checkThumb(input.thumb);
	if (thumb.ok === false) return thumb;
	return { ok: true, image: image.webp, thumb: thumb.webp };
}

export type UploadValidationResult =
	| {
			readonly ok: true;
			readonly kind: WidgetKind;
			/** 保存先のフィールドの options(補完・丸めたもの) */
			readonly options: FieldOptions;
			readonly image: CheckedWebp;
			readonly thumb: CheckedWebp;
	  }
	| ValidationFailure;

/**
 * アップロード用ルートの検証(仕様書 8 章①)。保存先のフィールドを確かめてから、そのフィールドの options で
 * 画像本体とサムネイルを確かめる。
 *
 * `input` はルートの `input` スキーマ(`uploadRequestSchema`)を通ったものを想定するが、この関数だけでも
 * 長さ・中身・寸法を確かめる(スキーマを通っていない値でも、上限を超えるものは受け付けない)。
 *
 * @param collection `ctx.schema.getCollection(input.target.collection)` の結果
 */
export function validateUpload(
	input: UploadInputLike,
	collection: CollectionSchemaLike | null,
): UploadValidationResult {
	const target = resolveUploadTarget(collection, input.target);
	if (target.ok === false) return target;
	const images = validateUploadImages(input, target.options);
	if (images.ok === false) return images;
	return {
		ok: true,
		kind: target.kind,
		options: target.options,
		image: images.image,
		thumb: images.thumb,
	};
}

// ---------------------------------------------------------------------------
// ② 画像エントリの値
// ---------------------------------------------------------------------------

/**
 * 画像エントリの値(②)に当てる上限。値には保存先のフィールドが無いので、どのフィールドの options でも ① が
 * 受け付けうる最大(`maxStoredBytes` と `maxEdge` の範囲の上限 = 固定上限)にする。① を通った値は必ず ② も通る。
 */
export const IMAGE_ENTRY_LIMITS: ImageLimits = {
	maxStoredBytes: MAX_STORED_BYTES_LIMIT,
	maxEdge: MAX_EDGE_LIMIT,
};

export type ImageEntryResult =
	| {
			readonly ok: true;
			/** スキーマを通った値 */
			readonly entry: Base64ImageEntry;
			readonly image: CheckedWebp;
	  }
	| ValidationFailure;

/**
 * `b64_images` の `image` フィールドの値を確かめる(仕様書 8 章②。API / MCP / 管理画面など、どこからの書き込みにも使う)。
 *
 * 1. `src` の長さ ≤ `IMAGE_ENTRY_LIMITS.maxStoredBytes`(スキーマより先に。大きな文字列に正規表現を掛けない)
 * 2. 値の形(`base64ImageEntrySchema`。知らないキーは拒否する)
 * 3. `src` が静止画の WebP の data URL で、寸法が `width` / `height` と一致し、長辺 ≤ `IMAGE_ENTRY_LIMITS.maxEdge`
 * 4. `meta.bytes` が WebP 本体のバイト数と一致する(`meta.quality` はブラウザの申告なので確かめない。仕様書 5.1)
 */
export function validateImageEntry(value: unknown): ImageEntryResult {
	const src = isRecord(value) ? value["src"] : undefined;
	if (typeof src === "string") {
		const tooLarge = checkLength(src, ENTRY_IMAGE, IMAGE_ENTRY_LIMITS.maxStoredBytes);
		if (tooLarge !== undefined) return tooLarge;
	}

	const parsed = base64ImageEntrySchema.safeParse(value);
	// `=== false` で比べる(利用者の設定で strictNullChecks が無効でも絞り込まれるように)。
	if (parsed.success === false) {
		const { issues } = parsed.error;
		return fail(
			"IMAGE_ENTRY_INVALID",
			"ENTRY_SHAPE",
			`The image entry is invalid: ${formatIssues(issues)}`,
			{ issues: issues.length },
		);
	}
	const entry = parsed.data;

	const image = checkImage(entry.src, entry, IMAGE_ENTRY_LIMITS, ENTRY_IMAGE);
	if (image.ok === false) return image;
	if (entry.meta.bytes !== image.webp.webpBytes) {
		return fail(
			"IMAGE_ENTRY_INVALID",
			"META_BYTES_MISMATCH",
			`meta.bytes (${entry.meta.bytes}) does not match the size of the WebP in src (${image.webp.webpBytes} bytes)`,
			{ metaBytes: entry.meta.bytes, webpBytes: image.webp.webpBytes },
		);
	}
	return { ok: true, entry, image: image.webp };
}

// ---------------------------------------------------------------------------
// data URL の検証(① と ② で共通)
// ---------------------------------------------------------------------------

/** 検証する data URL の名前(メッセージに書く)と、失敗したときのコード */
interface Subject {
	readonly name: string;
	readonly tooLarge: "IMAGE_TOO_LARGE" | "THUMB_TOO_LARGE";
	readonly invalid: "IMAGE_DATA_INVALID" | "THUMB_DATA_INVALID";
}

const UPLOAD_IMAGE: Subject = {
	name: "dataUrl",
	tooLarge: "IMAGE_TOO_LARGE",
	invalid: "IMAGE_DATA_INVALID",
};
const UPLOAD_THUMB: Subject = {
	name: "thumb",
	tooLarge: "THUMB_TOO_LARGE",
	invalid: "THUMB_DATA_INVALID",
};
const ENTRY_IMAGE: Subject = {
	name: "src",
	tooLarge: "IMAGE_TOO_LARGE",
	invalid: "IMAGE_DATA_INVALID",
};

type Checked = { readonly ok: true; readonly webp: CheckedWebp } | ValidationFailure;

/**
 * T04 の理由をメッセージにする文。キーを理由の型で網羅するので、T04 が理由を増やすと型エラーになる。
 * コードは理由によらず `IMAGE_DATA_INVALID` / `THUMB_DATA_INVALID`(画面では「画像を選び直す」しかないため)。
 */
const WEBP_REASON_TEXT: Readonly<Record<DataUrlErrorReason | WebpErrorReason, string>> = {
	NOT_WEBP_DATA_URL: 'does not start with "data:image/webp;base64,"',
	INVALID_BASE64: "is not valid base64 after the prefix",
	TOO_SHORT: "is too short to be a WebP file",
	NOT_WEBP: "does not have the RIFF/WEBP signature",
	RIFF_SIZE_MISMATCH: "has a RIFF size that does not match the data length",
	MALFORMED_CHUNK: "has malformed or extra chunks",
	UNSUPPORTED_FORMAT: "does not start with a VP8, VP8L or VP8X chunk",
	INVALID_VP8_HEADER: "has an invalid VP8 frame header",
	INVALID_VP8L_HEADER: "has an invalid VP8L header",
	INVALID_VP8X_HEADER: "has an invalid VP8X header",
	MISSING_IMAGE_DATA: "has no image data after the VP8X chunk",
	CANVAS_SIZE_MISMATCH: "has a VP8X canvas size that differs from the image data",
};

/** 画像本体(① の `dataUrl`、② の `src`)。寸法は `declared`(申告された width / height)と比べる */
function checkImage(
	dataUrl: string,
	declared: { readonly width: number; readonly height: number },
	limits: ImageLimits,
	subject: Subject,
): Checked {
	const maxStoredBytes = Math.min(limits.maxStoredBytes, MAX_STORED_BYTES_LIMIT);
	const parsed = parseStillWebp(dataUrl, subject, maxStoredBytes);
	if (parsed.ok === false) return parsed;

	const { width, height } = parsed.webp.info;
	if (declared.width !== width || declared.height !== height) {
		return fail(
			"IMAGE_DIMENSIONS_MISMATCH",
			"DIMENSIONS_MISMATCH",
			`width x height (${declared.width}x${declared.height}) does not match the WebP in ${subject.name} (${width}x${height})`,
			{ width: declared.width, height: declared.height, webpWidth: width, webpHeight: height },
		);
	}
	const maxEdge = Math.min(limits.maxEdge, WEBP_MAX_DIMENSION);
	const edge = Math.max(width, height);
	// 上限が NaN のときも拒否するよう、「以下でない」で比べる
	if (!(edge <= maxEdge)) {
		return fail(
			"IMAGE_EDGE_TOO_LONG",
			"EDGE_OVER_LIMIT",
			`The longest edge of ${subject.name} (${edge}px) exceeds the limit of ${maxEdge}px`,
			{ edge, maxEdge },
		);
	}
	return parsed;
}

/** サムネイル。寸法の申告は無いので、長辺だけを確かめる(仕様書 6.4: 長辺 96px まで、拡大しない) */
function checkThumb(thumb: string): Checked {
	const parsed = parseStillWebp(thumb, UPLOAD_THUMB, THUMB_MAX_STORED_BYTES);
	if (parsed.ok === false) return parsed;
	const edge = Math.max(parsed.webp.info.width, parsed.webp.info.height);
	if (!(edge <= THUMB_EDGE)) {
		// 画面の文言は「サムネイルのデータが正しくありません」。ブラウザは THUMB_EDGE より大きいサムネイルを作らない
		return fail(
			UPLOAD_THUMB.invalid,
			"EDGE_OVER_LIMIT",
			`The longest edge of thumb (${edge}px) exceeds ${THUMB_EDGE}px`,
			{ edge, maxEdge: THUMB_EDGE },
		);
	}
	return parsed;
}

/** 長さを確かめてから、静止画の WebP の data URL として解析する */
function parseStillWebp(dataUrl: string, subject: Subject, maxStoredBytes: number): Checked {
	const tooLarge = checkLength(dataUrl, subject, maxStoredBytes);
	if (tooLarge !== undefined) return tooLarge;

	const parsed = parseWebpDataUrl(dataUrl);
	if (parsed.ok === false) {
		return fail(
			subject.invalid,
			parsed.reason,
			`${subject.name} ${WEBP_REASON_TEXT[parsed.reason]} (${parsed.reason})`,
			{ webpReason: parsed.reason },
		);
	}
	if (parsed.info.animated) {
		// このプラグインは静止画しか作らない(GIF も最初のフレームだけにする。仕様書 6.5)
		return fail(
			subject.invalid,
			"ANIMATED",
			`${subject.name} is an animated WebP; only still images are accepted`,
			{ width: parsed.info.width, height: parsed.info.height },
		);
	}
	return {
		ok: true,
		webp: { storedBytes: dataUrl.length, webpBytes: parsed.bytes.length, info: parsed.info },
	};
}

/**
 * data URL の長さが上限以下か。デコードする前に呼ぶ。
 * data URL は ASCII なので、文字数がバイト数になる(ASCII 以外が混じっていれば、あとの base64 の確認で拒否される)。
 */
function checkLength(
	dataUrl: string,
	subject: Subject,
	maxStoredBytes: number,
): ValidationFailure | undefined {
	// 上限が NaN のときも拒否するよう、「以下なら通す」の形で比べる
	if (dataUrl.length <= maxStoredBytes) return undefined;
	return fail(
		subject.tooLarge,
		"STORED_BYTES_OVER_LIMIT",
		`${subject.name} is ${dataUrl.length} bytes, which exceeds the limit of ${maxStoredBytes} bytes`,
		{ storedBytes: dataUrl.length, maxStoredBytes },
	);
}

// ---------------------------------------------------------------------------
// 小さな部品
// ---------------------------------------------------------------------------

function fail<Code extends ValidationErrorCode>(
	code: Code,
	reason: ValidationReason,
	message: string,
	details: ErrorDetails,
): ValidationFailure<Code> {
	return { ok: false, code, reason, message, details };
}

/** メッセージに書く、スキーマの問題の数の上限 */
const MAX_REPORTED_ISSUES = 3;

/** zod の問題を「パス: 内容」の形で並べる(例: `meta.bytes: Too small: expected number to be >=1`) */
function formatIssues(
	issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): string {
	const shown = issues
		.slice(0, MAX_REPORTED_ISSUES)
		.map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
	const rest = issues.length - shown.length;
	return rest > 0 ? `${shown.join("; ")}; and ${rest} more` : shown.join("; ");
}

function formatPath(path: readonly PropertyKey[]): string {
	return path.length === 0 ? "(value)" : path.map((key) => String(key)).join(".");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
