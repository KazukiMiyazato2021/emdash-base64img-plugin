/**
 * サムネイルの生成(仕様書 6.4)。
 *
 * 本体と同じ探索(encode.ts の `searchWithinBudget`)を、サムネイル用の固定の条件で行う。
 * - 長辺は `THUMB_EDGE`(96px)。元の画像のほうが小さければ、元の大きさ(拡大しない)。
 * - data URL の長さを `THUMB_MAX_STORED_BYTES`(8,000 バイト。WebP 本体で 5,982 バイト)以下にする。
 * - 画質は本体の既定と同じ 0.60〜0.92 の範囲で、同じ順番に探す。T05 の写真 5 枚は 96px・0.60〜0.92 で 474〜3,288 B だった
 *   ので、通常は 0.92 に 2 回のエンコードで決まる。
 * - 96px の画質 0.60 でも収まらない画像(細かい透過のノイズなど)に備えて、本体と同じく 0.8 倍ずつ縮める。
 *   長辺が `THUMB_MIN_EDGE`(48px)を下回ったら `THUMB_OVER_BUDGET`。
 */

import { DEFAULT_FIELD_OPTIONS, THUMB_EDGE, THUMB_MAX_STORED_BYTES } from "../shared/constants";
import { Base64ImageError } from "../shared/errors";
import type { CreateThumbnail } from "../shared/pipeline";
import { createCanvasWebpEncoder, readWebpDataUrl, searchWithinBudget } from "./encode";

/** サムネイルを縮めていく長辺の下限(px)。`THUMB_EDGE` の半分 */
export const THUMB_MIN_EDGE = THUMB_EDGE / 2;

/** サムネイルの画質の下限。本体の `minQuality` の既定値と同じ */
export const THUMB_MIN_QUALITY = DEFAULT_FIELD_OPTIONS.minQuality;

/**
 * 長辺 `THUMB_EDGE` 程度で、data URL の長さが `THUMB_MAX_STORED_BYTES` 以下のサムネイルを作る。
 *
 * - `encoder` を省略すると、canvas のエンコーダー(`createCanvasWebpEncoder`)を呼び出しごとに作って使う。
 * - 失敗したら `Base64ImageError` で reject する: 収まらない → `THUMB_OVER_BUDGET`、
 *   Blob の type が `image/webp` でない → `BROWSER_UNSUPPORTED`、エンコーダーの失敗 → `ENCODE_FAILED`。
 * - `signal` が中断されたら、次のエンコードを始めずに `signal.reason` で reject する。縮小・エンコード・data URL の
 *   読み込みの途中なら、その完了を待たない。
 */
export const createThumbnail: CreateThumbnail = async (image, options = {}) => {
	const { signal } = options;
	signal?.throwIfAborted();
	const outcome = await searchWithinBudget(
		image,
		{
			maxStoredBytes: THUMB_MAX_STORED_BYTES,
			maxEdge: THUMB_EDGE,
			minEdge: THUMB_MIN_EDGE,
			minQuality: THUMB_MIN_QUALITY,
		},
		{ encoder: options.encoder ?? createCanvasWebpEncoder(), signal },
	);
	// `=== false` で比べる(利用者の設定で strictNullChecks が無効でも絞り込まれるように)。
	if (outcome.ok === false) {
		throw new Base64ImageError(
			"THUMB_OVER_BUDGET",
			`The thumbnail does not fit in ${THUMB_MAX_STORED_BYTES} bytes even at ${outcome.lastEdge}px`,
			{
				details: {
					maxStoredBytes: THUMB_MAX_STORED_BYTES,
					lastEdge: outcome.lastEdge,
					lastStoredBytes: outcome.lastStoredBytes,
					attempts: outcome.attempts,
				},
			},
		);
	}
	const { fit } = outcome;
	const { dataUrl } = await readWebpDataUrl(fit.blob, signal);
	return { dataUrl, width: fit.width, height: fit.height, storedBytes: dataUrl.length };
};
