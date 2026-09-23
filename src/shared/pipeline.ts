/**
 * ブラウザ側の圧縮処理のインターフェース(仕様書 4.2、6 章)。
 *
 * アップロード処理のフック(T23)が、次の順に呼ぶ。ここでは、その間で受け渡す値と関数の形だけを決める。
 * 1. `DecodeImage`: 入力の判定とデコード(T12)
 * 2. `CompressImage`: リサイズと画質の探索(T13)
 * 3. `CreateThumbnail`: サムネイルの生成(T13)
 * 4. `UploadImage`: アップロード用ルートの呼び出し(T14)
 *
 * - 失敗したら `Base64ImageError`(errors.ts)で reject する。
 * - `signal` が中断されたら、`signal.reason` で reject する(`AbortSignal#throwIfAborted` と同じ)。
 */

import type { NoticeCode } from "./errors";
import type { FieldOptions } from "./options";
import type { UploadRequest, UploadResponse } from "./types";

/** canvas に描ける画像と、その寸法(px) */
export interface ImageSource {
	/** 通常は `ImageBitmap`。テストでは偽物を型変換して渡す */
	readonly source: CanvasImageSource;
	readonly width: number;
	readonly height: number;
}

/** 入力ファイルをデコードした結果。`width` / `height` は EXIF の向きを反映したあとの寸法 */
export interface DecodedImage extends ImageSource {
	/** 入力ファイルの MIME タイプ */
	readonly mimeType: string;
	/** 入力ファイルの名前(空のこともある) */
	readonly filename: string;
	/** 入力ファイルのバイト数 */
	readonly fileBytes: number;
	/** 利用者に伝える注意(GIF が静止画になる、など) */
	readonly notices: readonly NoticeCode[];
	/** デコード結果のメモリを解放する(`ImageBitmap#close`)。何度呼んでもよい */
	close(): void;
}

export interface DecodeOptions {
	readonly signal?: AbortSignal;
}

/**
 * 入力ファイルの形式と上限を判定し、デコードする(T12。仕様書 6.5)。
 * 受け付けない形式や上限を超えるものは、コード `INPUT_*` で reject する。
 */
export type DecodeImage = (file: File, options?: DecodeOptions) => Promise<DecodedImage>;

/** エンコーダーへの 1 回分の指示。`source` 全体を `width` × `height` に縮めて描き、WebP にする */
export interface EncodeRequest {
	readonly source: CanvasImageSource;
	readonly width: number;
	readonly height: number;
	/** 画質(0〜1) */
	readonly quality: number;
	readonly signal?: AbortSignal;
}

/**
 * 差し替えできるエンコーダー。既定は canvas の `toBlob("image/webp", quality)`(T13)。
 * 返した Blob の `type` が `image/webp` でなければ、呼び出し側が非対応のブラウザ(Safari など)とみなす。
 * テストでは、任意の大きさと `type` の Blob を返す偽物に差し替える。
 */
export type WebpEncoder = (request: EncodeRequest) => Promise<Blob>;

/** 圧縮の途中経過(画面の「圧縮中… 1280px / 画質 0.74」に使う) */
export interface CompressProgress {
	readonly width: number;
	readonly height: number;
	readonly quality: number;
	/** 何回目のエンコードか(1 から数える) */
	readonly attempt: number;
}

export type CompressOptions = Pick<
	FieldOptions,
	"maxStoredBytes" | "maxEdge" | "minQuality" | "minEdge"
> & {
	/** 省略すると canvas のエンコーダーを使う */
	readonly encoder?: WebpEncoder;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: CompressProgress) => void;
};

export interface CompressionResult {
	/** `data:image/webp;base64,` で始まる data URL */
	readonly dataUrl: string;
	readonly width: number;
	readonly height: number;
	/** 採用した画質 */
	readonly quality: number;
	/** 保存サイズ(`dataUrl` の長さ。バイト) */
	readonly storedBytes: number;
	/** WebP 本体のバイト数 */
	readonly webpBytes: number;
	/** エンコードした回数 */
	readonly attempts: number;
}

/**
 * 長辺を `maxEdge` 以下に縮め、`maxStoredBytes` に収まる最高の画質を探す(T13。仕様書 6.3)。
 * `minEdge` を下回っても収まらなければ `COMPRESSION_OVER_BUDGET`、WebP を作れないブラウザでは
 * `BROWSER_UNSUPPORTED` で reject する。
 */
export type CompressImage = (
	image: ImageSource,
	options: CompressOptions,
) => Promise<CompressionResult>;

export interface ThumbnailOptions {
	/** 省略すると canvas のエンコーダーを使う */
	readonly encoder?: WebpEncoder;
	readonly signal?: AbortSignal;
}

export interface ThumbnailResult {
	/** `data:image/webp;base64,` で始まる data URL */
	readonly dataUrl: string;
	readonly width: number;
	readonly height: number;
	/** 保存サイズ(`dataUrl` の長さ。バイト) */
	readonly storedBytes: number;
}

/**
 * 長辺 `THUMB_EDGE` 程度で、data URL の長さが `THUMB_MAX_STORED_BYTES` 以下のサムネイルを作る(T13。仕様書 6.4)。
 * 収まらなければ `THUMB_OVER_BUDGET` で reject する。
 */
export type CreateThumbnail = (
	image: ImageSource,
	options?: ThumbnailOptions,
) => Promise<ThumbnailResult>;

export interface UploadOptions {
	readonly signal?: AbortSignal;
}

/** アップロード用ルートを呼ぶ(T14)。ルートのエラーは、応答の `error.code` を持つ `Base64ImageError` で reject する */
export type UploadImage = (
	request: UploadRequest,
	options?: UploadOptions,
) => Promise<UploadResponse>;
