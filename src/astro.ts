/**
 * base64-image プラグインのサイト側の入口(仕様書 12 章)。Astro のページ・エンドポイント(サーバー側)で使う。
 *
 * - `resolveBase64Images(refs)`: ページで使う参照をまとめて渡し、描画に使う値を `images.get(ref)` で得る。
 * - `isBase64ImageRef` / `isBase64ImageGallery`: `json` フィールドの値(サイトの型では `unknown`)を参照に絞り込む。
 *
 * 読み込むのは、EmDash の `getEmDashCollection`(サイトのページも読み込む `emdash` 本体)と、共有の定数・スキーマ(zod)だけ。
 * `emdash` 本体を読み込むので、ブラウザ側のコード(React の island など)からは import しない。
 */

import { getEmDashCollection } from "emdash";

import type { Base64ImageRef } from "./shared/types";
import { resolveBase64ImagesWith, type ResolvedBase64Images } from "./site/resolve";

export { isBase64ImageGallery, isBase64ImageRef } from "./shared/schema";
export type { Base64ImageGallery, Base64ImageRef, ResolvedBase64Image } from "./shared/types";
export type { ResolvedBase64Images } from "./site/resolve";

/**
 * 参照が指す画像エントリ(`b64_images`)をまとめて取得する。
 *
 * - 参照の `locale` ごとに、ID を 50 件ずつ `getEmDashCollection("b64_images", { where: { id }, locale })` で取得する。
 *   同じ ID は 1 回だけ取得する。1 ページの参照は、まとめて 1 回で渡す。
 * - 結果の `get(ref)` は、参照が指す画像を、その参照の `alt` を付けて返す(`emdash/ui` の `Image` にそのまま渡せる)。
 * - 画像が見つからない(ゴミ箱に入った・削除された)、値が不正、取得に失敗したときは `get` が `undefined` を返し、
 *   ここで警告ログ(`console.warn`)を出す。例外は投げない。
 *
 * @example
 * ```astro
 * ---
 * import { getEmDashCollection } from "emdash";
 * import { Image } from "emdash/ui";
 * import { isBase64ImageRef, resolveBase64Images } from "emdash-plugin-base64-image/astro";
 *
 * const { entries } = await getEmDashCollection("posts", { limit: 10 });
 * const refs = entries.map((entry) => entry.data.cover).filter(isBase64ImageRef);
 * const images = await resolveBase64Images(refs);
 * ---
 * {entries.map((entry, i) => {
 * 	const ref = entry.data.cover;
 * 	const image = isBase64ImageRef(ref) ? images.get(ref) : undefined;
 * 	return image && <Image image={image} priority={i === 0} />;
 * })}
 * ```
 */
export function resolveBase64Images(
	refs: readonly Base64ImageRef[],
): Promise<ResolvedBase64Images> {
	return resolveBase64ImagesWith(getEmDashCollection, refs);
}
