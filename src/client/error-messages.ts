/**
 * エラーコードと注意のコードに対応する、画面に出す文言(ja / en)。
 *
 * - ルートの応答の `details` は画面に届かない(`docs/emdash-plugin-route-errors.md`)ので、文言はコードだけで決める。
 *   上限の値など、フィールドごとに違う値は、部品が自分の辞書で補う。
 * - `src/shared/errors.ts` にコードを足すと、ここの辞書が型エラーになる(`Record<KnownErrorCode, string>`)。
 *   `tests/client/api.test.ts` も、すべてのコードに ja / en の文言があることを確かめる。
 */

import {
	IMAGE_COLLECTION,
	MAX_ALT_LENGTH,
	MAX_INPUT_FILE_BYTES,
	MAX_INPUT_PIXELS,
} from "../shared/constants";
import {
	isBase64ImageError,
	isKnownErrorCode,
	type KnownErrorCode,
	type NoticeCode,
} from "../shared/errors";
import { defineMessages, useLocale, type Locale } from "./i18n";

const formatInteger = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format;

/** 代替テキストの上限(「1,000」) */
const ALT_LIMIT = formatInteger(MAX_ALT_LENGTH);
/** 入力ファイルの上限(MB。「40」) */
const INPUT_FILE_LIMIT_MB = formatInteger(MAX_INPUT_FILE_BYTES / 1_000_000);
/** 入力画像の画素数の上限(万画素。「6,400」) */
const INPUT_PIXELS_LIMIT_MAN = formatInteger(MAX_INPUT_PIXELS / 10_000);
/** 入力画像の画素数の上限(メガピクセル。「64」) */
const INPUT_PIXELS_LIMIT_MP = formatInteger(MAX_INPUT_PIXELS / 1_000_000);

/** エラーコードの文言。このプラグインのコード(サーバー・ブラウザ)と、EmDash が返すコード */
export const ERROR_MESSAGES = defineMessages<Record<KnownErrorCode, string>>({
	ja: {
		// サーバー(このプラグインのルート・保存 hook)
		// INVALID_TARGET は、保存先のフィールドの誤りと、`target.locale` がサイトのロケールでないとき(T18)の両方で返る
		INVALID_TARGET:
			"保存先が正しくありません。フィールドが見つからないか、このプラグインの画像フィールドではないか、編集中のエントリの言語がサイトに設定されていません。フィールドとサイトの言語の設定を確認してください。",
		IMAGE_DATA_INVALID: "画像のデータが正しくありません。画像を選び直してください。",
		IMAGE_TOO_LARGE: "画像の保存サイズが上限を超えています。",
		IMAGE_DIMENSIONS_MISMATCH: "画像の寸法が画像のデータと一致しません。",
		IMAGE_EDGE_TOO_LONG: "画像の長辺が上限を超えています。",
		IMAGE_ENTRY_INVALID: "画像エントリの値が正しくありません。",
		THUMB_DATA_INVALID: "サムネイルのデータが正しくありません。",
		THUMB_TOO_LARGE: "サムネイルの保存サイズが上限を超えています。",
		REFERENCE_INVALID: "画像の参照の形式が正しくありません。",
		ALT_TOO_LONG: `代替テキストは ${ALT_LIMIT} 文字以内にしてください。`,
		GALLERY_TOO_MANY_ITEMS: "ギャラリーの画像の枚数が上限を超えています。",
		GALLERY_DUPLICATE_ITEM: "ギャラリーに同じ画像が重複しています。",
		IMAGE_NOT_FOUND: "画像が見つかりません。ゴミ箱に移されたか、削除された可能性があります。",
		INVALID_CURSOR: "一覧の読み込み位置が正しくありません。一覧を最初から読み込み直してください。",
		IMAGE_COLLECTION_MISSING: `画像を保存するコレクション ${IMAGE_COLLECTION} がありません。サイトの設定を確認してください。`,
		UPLOAD_FAILED: "画像の保存に失敗しました。もう一度お試しください。",
		// ブラウザ(入力の判定・圧縮・通信)
		INPUT_HEIC_REJECTED:
			"HEIC / HEIF の画像は使えません。iPhone のカメラ設定を「互換性優先」にするか、JPEG に書き出してください。",
		INPUT_SVG_REJECTED: "SVG の画像は使えません。PNG か JPEG に書き出してから選んでください。",
		INPUT_FORMAT_REJECTED:
			"この形式の画像は使えません。JPEG / PNG / WebP / AVIF / GIF / BMP の画像を選んでください。",
		INPUT_DECODE_FAILED:
			"画像を読み込めませんでした。ファイルが壊れているか、このブラウザが読み込めない形式です。",
		INPUT_FILE_TOO_LARGE: `ファイルが大きすぎます(上限 ${INPUT_FILE_LIMIT_MB}MB)。`,
		INPUT_TOO_MANY_PIXELS: `画像の画素数が多すぎます(上限 ${INPUT_PIXELS_LIMIT_MAN} 万画素)。`,
		BROWSER_UNSUPPORTED:
			"このブラウザは非対応です(画像を WebP に変換できません)。Chrome、Edge、Firefox を使ってください。",
		ENCODE_FAILED: "画像の変換に失敗しました。もう一度お試しください。",
		COMPRESSION_OVER_BUDGET:
			"画像を上限のサイズまで圧縮できませんでした。細部の少ない画像にするか、切り抜いてから選んでください。",
		THUMB_OVER_BUDGET:
			"サムネイルを上限のサイズまで圧縮できませんでした。別の画像を選んでください。",
		NETWORK_ERROR:
			"サーバーと通信できませんでした。ネットワークの接続を確認して、もう一度お試しください。",
		UNEXPECTED_RESPONSE:
			"サーバーから予期しない応答がありました。時間をおいて、もう一度お試しください。",
		// EmDash(プラグインのルートと標準 API)
		UNAUTHORIZED:
			"ログインしていないか、ログインの有効期限が切れています。ページを再読み込みして、ログインし直してください。",
		FORBIDDEN: "この操作を行う権限がありません。",
		CSRF_REJECTED: "リクエストが拒否されました(CSRF 対策)。ページを再読み込みしてください。",
		INSUFFICIENT_SCOPE: "API トークンに必要な権限(admin スコープ)がありません。",
		NOT_FOUND:
			"対象が見つかりません。すでに削除されたか、プラグインが無効になっている可能性があります。ページを再読み込みしてください。",
		METHOD_NOT_ALLOWED: "サーバーがこのリクエストの方法(HTTP メソッド)を受け付けませんでした。",
		VALIDATION_ERROR:
			"送信した内容をサーバーが受け付けませんでした。ページを再読み込みして、もう一度お試しください。",
		INVALID_PLUGIN_REQUEST: "送信したデータが大きすぎるか、形式が正しくありません。",
		INTERNAL_ERROR: "サーバーでエラーが発生しました。時間をおいて、もう一度お試しください。",
		NOT_CONFIGURED: "EmDash の準備ができていません。サイトの設定を確認してください。",
		CONTENT_DELETE_ERROR: "画像を完全に削除できませんでした。もう一度お試しください。",
	},
	en: {
		INVALID_TARGET:
			"The destination is invalid: the field does not exist, is not an image field of this plugin, or the entry's locale is not configured for the site. Check the field settings and the site's locales.",
		IMAGE_DATA_INVALID: "The image data is invalid. Please select the image again.",
		IMAGE_TOO_LARGE: "The image exceeds the maximum stored size.",
		IMAGE_DIMENSIONS_MISMATCH: "The image dimensions do not match the image data.",
		IMAGE_EDGE_TOO_LONG: "The longest edge of the image exceeds the limit.",
		IMAGE_ENTRY_INVALID: "The image entry is invalid.",
		THUMB_DATA_INVALID: "The thumbnail data is invalid.",
		THUMB_TOO_LARGE: "The thumbnail exceeds the maximum stored size.",
		REFERENCE_INVALID: "The image reference is invalid.",
		ALT_TOO_LONG: `Alternative text must be ${ALT_LIMIT} characters or fewer.`,
		GALLERY_TOO_MANY_ITEMS: "The gallery has more images than allowed.",
		GALLERY_DUPLICATE_ITEM: "The gallery contains the same image more than once.",
		IMAGE_NOT_FOUND: "Image not found. It may have been moved to the trash or deleted.",
		INVALID_CURSOR: "The list position is invalid. Reload the list from the beginning.",
		IMAGE_COLLECTION_MISSING: `The ${IMAGE_COLLECTION} collection for storing images does not exist. Check the site configuration.`,
		UPLOAD_FAILED: "Failed to save the image. Please try again.",
		INPUT_HEIC_REJECTED:
			"HEIC/HEIF images are not supported. Set your iPhone camera format to “Most Compatible”, or export the photo as JPEG.",
		INPUT_SVG_REJECTED: "SVG images are not supported. Export the image as PNG or JPEG first.",
		INPUT_FORMAT_REJECTED:
			"This image format is not supported. Use a JPEG, PNG, WebP, AVIF, GIF, or BMP image.",
		INPUT_DECODE_FAILED:
			"The image could not be read. The file may be corrupted, or this browser cannot decode its format.",
		INPUT_FILE_TOO_LARGE: `The file is too large (maximum ${INPUT_FILE_LIMIT_MB} MB).`,
		INPUT_TOO_MANY_PIXELS: `The image has too many pixels (maximum ${INPUT_PIXELS_LIMIT_MP} megapixels).`,
		BROWSER_UNSUPPORTED:
			"This browser is not supported (it cannot convert images to WebP). Use Chrome, Edge, or Firefox.",
		ENCODE_FAILED: "Failed to convert the image. Please try again.",
		COMPRESSION_OVER_BUDGET:
			"The image could not be compressed to fit the size limit. Try an image with less detail, or crop it first.",
		THUMB_OVER_BUDGET:
			"The thumbnail could not be compressed to fit the size limit. Try another image.",
		NETWORK_ERROR: "Could not reach the server. Check your network connection and try again.",
		UNEXPECTED_RESPONSE: "The server returned an unexpected response. Please try again later.",
		UNAUTHORIZED:
			"You are not signed in, or your session has expired. Reload the page and sign in again.",
		FORBIDDEN: "You do not have permission to do this.",
		CSRF_REJECTED: "The request was rejected by the CSRF protection. Reload the page.",
		INSUFFICIENT_SCOPE: "The API token does not have the required admin scope.",
		NOT_FOUND:
			"Not found. It may already have been deleted, or the plugin may be disabled. Reload the page.",
		METHOD_NOT_ALLOWED: "The server does not accept this request method.",
		VALIDATION_ERROR: "The server rejected the submitted data. Reload the page and try again.",
		INVALID_PLUGIN_REQUEST: "The submitted data is too large or malformed.",
		INTERNAL_ERROR: "A server error occurred. Please try again later.",
		NOT_CONFIGURED: "EmDash is not set up yet. Check the site configuration.",
		CONTENT_DELETE_ERROR: "Failed to permanently delete the image. Please try again.",
	},
});

/** 注意のコードの文言(エラーではない。仕様書 6.5) */
export const NOTICE_MESSAGES = defineMessages<Record<NoticeCode, string>>({
	ja: {
		GIF_FIRST_FRAME_ONLY:
			"GIF は最初のフレームだけの静止画になります(アニメーションは保存されません)。",
	},
	en: {
		GIF_FIRST_FRAME_ONLY:
			"GIFs are converted to a still image of the first frame (the animation is not kept).",
	},
});

/** コードが分からないエラー(プログラムの誤りなど)の文言 */
export const UNKNOWN_ERROR_MESSAGES = defineMessages({
	ja: { unknown: "予期しないエラーが発生しました。" },
	en: { unknown: "An unexpected error occurred." },
});

/**
 * エラーのコード。`Base64ImageError`(`api.ts` などが投げる)のほか、
 * 文言を用意しているコードを `code` に持つオブジェクト(EmDash の管理画面の `ApiResponseError` など)も読む。
 */
export function getErrorCode(error: unknown): KnownErrorCode | null {
	if (isBase64ImageError(error)) return error.code;
	if (typeof error === "object" && error !== null && "code" in error) {
		const { code } = error;
		if (isKnownErrorCode(code)) return code;
	}
	return null;
}

/** エラーを画面に出す文言にする。コードが分からなければ「予期しないエラー」 */
export function getErrorMessage(error: unknown, locale: Locale): string {
	const code = getErrorCode(error);
	return code === null ? UNKNOWN_ERROR_MESSAGES[locale].unknown : ERROR_MESSAGES[locale][code];
}

/** 注意のコードを画面に出す文言にする */
export function getNoticeMessage(code: NoticeCode, locale: Locale): string {
	return NOTICE_MESSAGES[locale][code];
}

/** 今の言語で、エラーを画面に出す文言にする。`error` が null / undefined なら undefined */
export function useErrorMessage(error: unknown): string | undefined {
	const locale = useLocale();
	return error === null || error === undefined ? undefined : getErrorMessage(error, locale);
}
