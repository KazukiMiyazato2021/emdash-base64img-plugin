/**
 * サイト側で、参照から画像エントリ(`b64_images`)を解決する処理(仕様書 12 章)。
 *
 * - 参照の `locale` ごとに、重複を除いて並べ替えた ID を 50 件ずつ取得する。`locale` は必ず渡す。
 * - 結果は `entry.data.id` をキーにした Map にする(返る順番は要求の順ではなく、既定以外のロケールの
 *   `entry.id` は `ja/…` のようになるため)。
 * - 同じ画像を alt の違う複数の参照が指すことがあるので、alt は Map に入れず、`get(ref)` で参照ごとに付ける。
 * - 見つからない画像・値が不正な画像・取得に失敗した画像は描画しない。どれも警告ログを出す。
 *
 * 取得の関数(EmDash の `getEmDashCollection`)は引数で受け取る。このモジュールは `emdash` を読み込まない。
 */

import { IMAGE_COLLECTION, IMAGE_FIELD, PLUGIN_ID } from "../shared/constants";
import { WEBP_DATA_URL_PREFIX } from "../shared/data-url";
import { base64ImageEntrySchema, isBase64ImageRef } from "../shared/schema";
import type { Base64ImageEntry, Base64ImageRef, ResolvedBase64Image } from "../shared/types";

/**
 * 1 回の取得に入れる ID の数。D1 のバインド変数は 1 クエリ 100 個までで、locale を指定した取得は
 * 「ID の数 + 7」個を使う。EmDash 自身の IN 句の分割単位(`SQL_BATCH_SIZE`)と同じ 50 にする(T09)。
 */
const BATCH_SIZE = 50;

const LOG_PREFIX = `[${PLUGIN_ID}]`;

/** 取得の結果のうち、この処理が使う部分(EmDash の `CollectionResult`) */
export interface LoadCollectionResult {
	readonly entries: readonly { readonly data: unknown }[];
	/** 失敗したとき。EmDash は例外を投げず、`entries: []` とこれを返す */
	readonly error?: unknown;
}

/**
 * 画像エントリの取得。EmDash の `getEmDashCollection` を、この処理が使う引数と戻り値に絞った型。
 * `collection` を `string` にしているのは、サイトが生成する型(`EmDashCollections`)に左右されないようにするため。
 */
export type LoadCollection = (
	collection: string,
	filter: { where: { id: string[] }; locale: string },
) => Promise<LoadCollectionResult>;

/** `resolveBase64Images` の結果 */
export interface ResolvedBase64Images {
	/**
	 * 参照が指す画像を、その参照の `alt` を付けて返す(`MediaValue` に代入できる)。呼ぶたびに新しいオブジェクトを返す。
	 * 画像は参照の `locale` と `id` で引く。見つからない・値が不正・取得に失敗した画像と、参照の形でない値には `undefined` を返す。
	 */
	get(ref: Base64ImageRef): ResolvedBase64Image | undefined;
}

/** 1 回の取得 */
interface Batch {
	readonly locale: string;
	/** 重複を除いて並べ替えた ID(50 件まで) */
	readonly ids: string[];
}

/**
 * 参照が指す画像エントリをまとめて取得する。`load` には EmDash の `getEmDashCollection` を渡す(`src/astro.ts`)。
 * 参照の形でない値は取得しない。
 */
export async function resolveBase64ImagesWith(
	load: LoadCollection,
	refs: readonly Base64ImageRef[],
): Promise<ResolvedBase64Images> {
	const loaded = await Promise.all(
		planBatches(refs).map(async (batch) => ({ batch, result: await loadBatch(load, batch) })),
	);

	/** ロケール → 画像 ID → 画像エントリの値 */
	const images = new Map<string, Map<string, Base64ImageEntry>>();
	for (const { batch, result } of loaded) {
		const found = images.get(batch.locale) ?? new Map<string, Base64ImageEntry>();
		images.set(batch.locale, found);
		collectBatch(batch, result, found);
	}

	return {
		get(ref) {
			if (!isBase64ImageRef(ref)) return undefined;
			const image = images.get(ref.locale)?.get(ref.id);
			return image && { ...image, id: ref.id, alt: ref.alt };
		},
	};
}

/**
 * 参照をロケールごとにまとめ、ID の重複を除いて並べ替え、50 件ずつに分ける。
 * 並べ替えるのは、同じリクエストで同じ参照を解決し直したときに、EmDash がフィルターの同じ呼び出しを 1 回にまとめるため
 * (ID の順番が違うと別の呼び出しになる。T09)。
 */
function planBatches(refs: readonly Base64ImageRef[]): Batch[] {
	const idsByLocale = new Map<string, Set<string>>();
	for (const ref of refs) {
		if (!isBase64ImageRef(ref)) continue;
		const ids = idsByLocale.get(ref.locale) ?? new Set<string>();
		idsByLocale.set(ref.locale, ids.add(ref.id));
	}

	// `toSorted` は ES2023 なので使わない(利用者の lib が ES2022 でも型が通るように。T04-1)。
	const locales = [...idsByLocale.keys()];
	locales.sort();
	const batches: Batch[] = [];
	for (const locale of locales) {
		const ids = [...(idsByLocale.get(locale) ?? [])];
		ids.sort();
		for (let start = 0; start < ids.length; start += BATCH_SIZE) {
			batches.push({ locale, ids: ids.slice(start, start + BATCH_SIZE) });
		}
	}
	return batches;
}

/** 1 回分を取得する。例外は `error` と同じに扱う(画像のためにページの描画を止めない) */
async function loadBatch(load: LoadCollection, batch: Batch): Promise<LoadCollectionResult> {
	try {
		return await load(IMAGE_COLLECTION, { where: { id: batch.ids }, locale: batch.locale });
	} catch (error) {
		return { entries: [], error };
	}
}

/** 1 回分の結果から、要求した ID の正しい値を `found` に入れる。描画できない ID は警告ログに出す */
function collectBatch(
	batch: Batch,
	result: LoadCollectionResult,
	found: Map<string, Base64ImageEntry>,
): void {
	const source = `"${IMAGE_COLLECTION}" (locale "${batch.locale}")`;
	if (result.error !== undefined) {
		console.warn(
			`${LOG_PREFIX} Failed to load ${batch.ids.length} image(s) from ${source}; not rendering: ${batch.ids.join(", ")}`,
			result.error,
		);
		return;
	}

	const requested = new Set(batch.ids);
	const invalid = new Set<string>();
	for (const { data } of result.entries) {
		if (typeof data !== "object" || data === null) continue;
		const id = readProperty(data, "id");
		if (typeof id !== "string" || !requested.has(id)) continue;
		const image = parseImageValue(readProperty(data, IMAGE_FIELD));
		if (image) found.set(id, image);
		else invalid.add(id);
	}

	const invalidIds = batch.ids.filter((id) => invalid.has(id) && !found.has(id));
	if (invalidIds.length > 0) {
		console.warn(
			`${LOG_PREFIX} ${invalidIds.length} image(s) in ${source} have an invalid value; not rendering: ${invalidIds.join(", ")}`,
		);
	}
	const missingIds = batch.ids.filter((id) => !found.has(id) && !invalid.has(id));
	if (missingIds.length > 0) {
		console.warn(
			`${LOG_PREFIX} ${missingIds.length} image(s) not found in ${source}; not rendering: ${missingIds.join(", ")}`,
		);
	}
}

function readProperty(data: object, key: string): unknown {
	return (data as Record<string, unknown>)[key];
}

/**
 * 画像エントリの値を確かめる。seed や手での書き換えは保存 hook を通らないので、形(スキーマ)と、
 * `src` が WebP の data URL であることを確かめる。data URL の中身(base64・WebP のヘッダー)は、描画のたびには確かめない。
 */
function parseImageValue(value: unknown): Base64ImageEntry | undefined {
	const parsed = base64ImageEntrySchema.safeParse(value);
	// `=== false` で比べる(利用者の設定で strictNullChecks が無効でも絞り込まれるように。T04-1)。
	if (parsed.success === false) return undefined;
	return parsed.data.src.startsWith(WEBP_DATA_URL_PREFIX) ? parsed.data : undefined;
}
