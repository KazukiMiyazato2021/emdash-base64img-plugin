/**
 * プラグインストレージ `imageRefs`(画像 ID → 参照元・サムネイルなどの記録。仕様書 5.3)を読む共通の処理。
 *
 * プレビュー・サムネイル取得のルート(T17)、参照を持つコレクションの保存 hook(T16)、参照元の記録(T20)などが、
 * 複数の画像 ID の記録をまとめて読むときに使う。
 */

/**
 * 1 回の `getMany` に入れる画像 ID の数。
 * EmDash 0.39.1 の `getMany` は ID を分けずに IN 句に入れ、バインド変数を「ID の数 + 2」個使う(`plugin_id` と
 * `collection`。`references/emdash/packages/core/src/database/repositories/plugin-storage.ts:271-288`)。
 * D1 の上限は 1 クエリ 100 個で、99 件から例外になる(T17 の実測。docs/emdash-plugin-preview-thumbnail-routes.md)。
 * EmDash 自身の IN 句の分割単位(`SQL_BATCH_SIZE`、`utils/chunks.ts:17`)と同じ 50 件ずつに分ける。
 */
export const IMAGE_REFS_BATCH_SIZE = 50;

/** `getMany` を持つストレージ。EmDash の `StorageCollection` をそのまま渡せる */
export interface GetManyStorage<T = unknown> {
	/** 見つかった ID だけを持つ Map を返す */
	getMany(ids: string[]): Promise<ReadonlyMap<string, T>>;
}

/**
 * ID の重複を除き、`IMAGE_REFS_BATCH_SIZE` 件ずつ `getMany` を並行に呼んで、結果を 1 つの Map にまとめる。
 * 見つからない ID は Map に入らない。ID が空なら呼ばない。取得の失敗は、そのまま reject する。
 */
export async function getManyInBatches<T>(
	storage: GetManyStorage<T>,
	ids: readonly string[],
): Promise<Map<string, T>> {
	const unique = [...new Set(ids)];
	const batches: string[][] = [];
	for (let start = 0; start < unique.length; start += IMAGE_REFS_BATCH_SIZE) {
		batches.push(unique.slice(start, start + IMAGE_REFS_BATCH_SIZE));
	}
	const results = await Promise.all(batches.map((batch) => storage.getMany(batch)));
	const found = new Map<string, T>();
	for (const result of results) {
		for (const [id, value] of result) found.set(id, value);
	}
	return found;
}
