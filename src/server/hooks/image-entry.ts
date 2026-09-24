/**
 * `b64_images` の保存 hook(`content:beforeSave`。仕様書 8 章②)。
 *
 * - `b64_images` 以外のコレクションでは何もしない(参照を持つコレクションは T16 の `validateReferencesBeforeSave`)。
 * - 作成(`isNew: true`)では、`image` の値を T11 の `validateImageEntry`(固定上限: 保存 500,000 バイト・
 *   長辺 4,096px)で確かめる。REST・MCP・管理画面の新規作成と、アップロードのルート(T18)の
 *   `ctx.content.create` のどれでも呼ばれる。`image` が無い・`null` の値も拒否する
 *   (EmDash だけに任せると、省略は 400、`null` は列の NOT NULL で 500 になる)。
 * - 更新(`isNew: false`)では、`image` が送られてきたら、値によらず拒否する(仕様書 5.1・10 章「画像エントリは、
 *   作成したあと変更しない」)。参照の寸法と `imageRefs` のサムネイル・バイト数・寸法は、作成したときの画像のもので、
 *   `b64_images`(`supports: []`)の更新は、公開中の値をそのまま書き換えるため。`image` が送られてこない更新
 *   (`data: {}` など)では何もしない。管理画面の標準の編集画面は、保存・自動保存・「Publish now」のたびに
 *   `image` を送るので、`b64_images` のエントリはそこから保存・公開できない(「Unpublish」は通る)。
 * - 拒否は `ContentSaveRejectedError` で投げる。EmDash は 422 `SAVE_REJECTED` と `message` を返し、管理画面は
 *   保存の失敗の通知に `message` をそのまま出す(改行は空白になる)。hook は管理画面の言語を知らないので、
 *   T16 と同じく、日本語と英語を、この順に 1 行ずつ書く。英語の行には T11 の `message` をそのまま使う。
 * - ctx は使わない(T16 の hook と同じ `(event, ctx)` で呼べるように、引数だけ受け取る)。クエリもしない。
 */

import { ContentSaveRejectedError } from "emdash";

import { IMAGE_COLLECTION, IMAGE_FIELD } from "../../shared/constants";
import type { DataUrlErrorReason } from "../../shared/data-url";
import { base64ImageEntrySchema } from "../../shared/schema";
import type { WebpErrorReason } from "../../shared/webp";
import { validateImageEntry, type ValidationFailure } from "../validate";

/** この hook が読む event(EmDash の `ContentHookEvent` の一部)。`ContentHookEvent` をそのまま渡せる */
export interface ImageEntryHookEvent {
	/** 保存するデータ。更新では、送られてきたフィールドだけ */
	readonly content: Readonly<Record<string, unknown>>;
	readonly collection: string;
	/** 作成なら true、更新なら false */
	readonly isNew: boolean;
}

/**
 * `content:beforeSave` の本体。問題が無ければ何も返さない(保存するデータは変えない)。
 * 問題があれば `ContentSaveRejectedError` を投げる。
 *
 * @param _ctx 使わない。T16 の `validateReferencesBeforeSave(event, ctx)` と同じ形で呼べるように受け取る
 */
export async function validateImageEntryBeforeSave(
	event: ImageEntryHookEvent,
	_ctx?: unknown,
): Promise<void> {
	if (event.collection !== IMAGE_COLLECTION) return;
	const value = event.content[IMAGE_FIELD];

	if (event.isNew === false) {
		// JSON では送られないのと同じ(`undefined` の値は JSON に書けない)。
		if (value === undefined) return;
		throw new ContentSaveRejectedError(formatLines(CHANGE_REJECTED));
	}

	const result = validateImageEntry(value);
	if (result.ok === false) {
		throw new ContentSaveRejectedError(
			formatLines({ ja: invalidJa(result, value), en: invalidEn(result) }),
		);
	}
}

// ---------------------------------------------------------------------------
// message(日本語と英語)
// ---------------------------------------------------------------------------

type Language = "ja" | "en";

/** 問題の場所(行の先頭) */
const LOCATION: Readonly<Record<Language, string>> = {
	ja: `画像エントリ(${IMAGE_COLLECTION}.${IMAGE_FIELD})`,
	en: `Image entry (${IMAGE_COLLECTION}.${IMAGE_FIELD})`,
};

/**
 * `message` の言語の順番。hook は管理画面の言語を知らない(event・ctx・リクエストの文脈のどれにも無い)ので、
 * T16 と同じ固定の順にする。
 */
const LANGUAGES: readonly Language[] = ["ja", "en"];

/** 更新で `image` が送られてきたとき */
const CHANGE_REJECTED: Readonly<Record<Language, string>> = {
	ja: "作成したあとは変更できません。別の画像にするときは、新しい画像をアップロードしてください。",
	en: "it cannot be changed after it is created. To use a different image, upload a new one.",
};

/** 1 行に 1 つの言語を書く。管理画面の通知では、改行は空白になる */
function formatLines(problems: Readonly<Record<Language, string>>): string {
	return LANGUAGES.map((language) => `${LOCATION[language]}: ${problems[language]}`).join("\n");
}

/**
 * 英語の行に入れる T11 の `message` の長さの上限。スキーマの問題の文には、知らないキーの名前がそのまま入る
 * (zod の `unrecognized_keys`)ので、大量・長大なキーを送られても `message` を長くしない。
 * 上限と実際の値を書いた T11 の文(100〜200 文字)は切らずに入る長さにする。
 */
export const MAX_DETAIL_LENGTH = 300;

/** 英語の行: T11 の `message`(値の名前・上限・実際の値を書いた英語)をそのまま使う */
function invalidEn(failure: ValidationFailure): string {
	const message =
		failure.message.length > MAX_DETAIL_LENGTH
			? `${failure.message.slice(0, MAX_DETAIL_LENGTH)}…`
			: failure.message;
	return /[.…]$/.test(message) ? message : `${message}.`;
}

const formatNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format;

/** `details` の数値を、桁区切りを付けて書く(無いときは「?」。T11 が項目の名前を変えたときに気付けるよう、空にはしない) */
function detail(failure: ValidationFailure, key: string): string {
	const value = failure.details[key];
	if (typeof value === "number") return formatNumber(value);
	return value === undefined ? "?" : value;
}

/**
 * T04 の理由(`src` が静止画の WebP の data URL でない)の日本語。キーを理由の型で網羅するので、
 * T04 が理由を増やすと型エラーになる(T11 の `WEBP_REASON_TEXT` と同じ)。
 */
const WEBP_REASON_JA: Readonly<Record<DataUrlErrorReason | WebpErrorReason, string>> = {
	NOT_WEBP_DATA_URL: "src が「data:image/webp;base64,」で始まっていません",
	INVALID_BASE64: "src の「data:image/webp;base64,」のあとが、正しい base64 ではありません",
	TOO_SHORT: "src の WebP が短すぎます",
	NOT_WEBP: "src に RIFF / WEBP のシグネチャがありません",
	RIFF_SIZE_MISMATCH: "src の RIFF のサイズ欄が、データの長さと一致しません",
	MALFORMED_CHUNK: "src の WebP のチャンクが正しくないか、余分なチャンクがあります",
	UNSUPPORTED_FORMAT: "src の最初のチャンクが VP8 / VP8L / VP8X ではありません",
	INVALID_VP8_HEADER: "src の VP8 のフレームヘッダーが正しくありません",
	INVALID_VP8L_HEADER: "src の VP8L のヘッダーが正しくありません",
	INVALID_VP8X_HEADER: "src の VP8X のヘッダーが正しくありません",
	MISSING_IMAGE_DATA: "src の VP8X のあとに画像データがありません",
	CANVAS_SIZE_MISMATCH: "src の VP8X のキャンバスの寸法が、画像データの寸法と一致しません",
};

function isWebpReason(reason: string): reason is DataUrlErrorReason | WebpErrorReason {
	return Object.hasOwn(WEBP_REASON_JA, reason);
}

/** 日本語の行: T11 の理由(`reason`)と `details` から書く */
function invalidJa(failure: ValidationFailure, value: unknown): string {
	switch (failure.reason) {
		case "STORED_BYTES_OVER_LIMIT":
			return `src の長さが ${detail(failure, "storedBytes")} バイトで、上限の ${detail(failure, "maxStoredBytes")} バイトを超えています。`;
		case "ENTRY_SHAPE": {
			const keys = invalidKeys(value);
			return keys.length === 0
				? "値が画像エントリのオブジェクトではありません。"
				: `値の形が正しくありません(キー: ${formatKeys(keys)})。`;
		}
		case "ANIMATED":
			return "src がアニメーションの WebP です。静止画だけを保存できます。";
		case "DIMENSIONS_MISMATCH":
			return `width × height(${detail(failure, "width")} × ${detail(failure, "height")})が、src の WebP の寸法(${detail(failure, "webpWidth")} × ${detail(failure, "webpHeight")})と一致しません。`;
		case "EDGE_OVER_LIMIT":
			return `src の長辺(${detail(failure, "edge")}px)が、上限の ${detail(failure, "maxEdge")}px を超えています。`;
		case "META_BYTES_MISMATCH":
			return `meta.bytes(${detail(failure, "metaBytes")})が、src の WebP 本体のバイト数(${detail(failure, "webpBytes")})と一致しません。`;
		default:
			if (isWebpReason(failure.reason)) {
				return `${WEBP_REASON_JA[failure.reason]}(${failure.reason})。`;
			}
			// 保存先の理由(`INVALID_TARGET`)は、アップロードの検証(①)だけのもので、ここには来ない
			return `値が正しくありません(${failure.reason})。`;
	}
}

/** `message` に入れるキーの数と長さの上限(T16 と同じ) */
const MAX_LISTED_KEYS = 5;
const MAX_KEY_LENGTH = 40;

/**
 * 形の合わないキーを、`meta.bytes` のようなパスで並べる。値そのものがオブジェクトでなければ空にする。
 * T11 の結果には問題の一覧が無いので、スキーマで確かめ直す(拒否するときだけ。`src` の長さは T11 が先に確かめている)。
 */
function invalidKeys(value: unknown): string[] {
	const parsed = base64ImageEntrySchema.safeParse(value);
	if (parsed.success === true) return [];
	const keys = new Set<string>();
	for (const issue of parsed.error.issues) {
		const path = issue.path.map(String);
		if (issue.code === "unrecognized_keys") {
			for (const key of issue.keys) keys.add([...path, key].join("."));
			continue;
		}
		if (path.length === 0) return [];
		keys.add(path.join("."));
	}
	return [...keys];
}

function formatKeys(keys: readonly string[]): string {
	const listed = keys
		.slice(0, MAX_LISTED_KEYS)
		.map((key) => (key.length > MAX_KEY_LENGTH ? `${key.slice(0, MAX_KEY_LENGTH)}…` : key));
	return keys.length > MAX_LISTED_KEYS ? `${listed.join(", ")}, …` : listed.join(", ");
}
