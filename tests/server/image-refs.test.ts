import type { StorageCollection } from "emdash";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
	IMAGE_REFS_BATCH_SIZE,
	getManyInBatches,
	type GetManyStorage,
} from "../../src/server/image-refs";

/** D1 のバインド変数の上限(1 クエリ 100 個) */
const D1_MAX_BINDINGS = 100;
/** `getMany` が ID のほかに使うバインド変数(`plugin_id` と `collection`) */
const GET_MANY_BINDINGS_BESIDES_IDS = 2;

interface ThumbRecord {
	id: string;
	thumb: string;
}
type GetMany<T = unknown> = (ids: string[]) => Promise<Map<string, T>>;

function imageId(n: number): string {
	return `01J8Z3K4M5N6P7Q8R9S0${String(n).padStart(6, "0")}`;
}

/**
 * `imageRefs` の偽物。`stored` にある ID の記録だけを返す。
 * EmDash 0.39.1 の `getMany` と同じく ID を分けずに 1 クエリにし、D1 の上限を超えると例外を投げる(T17 の実測)。
 */
function fakeImageRefs(stored: readonly string[]) {
	const records = new Map(stored.map((id) => [id, { id, thumb: `thumb:${id}` }]));
	const getMany = vi.fn<GetMany<ThumbRecord>>(async (ids) => {
		if (ids.length + GET_MANY_BINDINGS_BESIDES_IDS > D1_MAX_BINDINGS) {
			throw new Error("D1_ERROR: too many SQL variables");
		}
		const found = new Map<string, ThumbRecord>();
		for (const id of ids) {
			const record = records.get(id);
			if (record !== undefined) found.set(id, record);
		}
		return found;
	});
	return { getMany };
}

describe("getManyInBatches", () => {
	it("ID が空なら getMany を呼ばず、空の Map を返す", async () => {
		const storage = fakeImageRefs([imageId(1)]);

		const found = await getManyInBatches(storage, []);

		expect(storage.getMany).not.toHaveBeenCalled();
		expect(found.size).toBe(0);
	});

	it("見つかった ID の記録だけを返す(見つからない ID は Map に入らない)", async () => {
		const storage = fakeImageRefs([imageId(1), imageId(3)]);

		const found = await getManyInBatches(storage, [imageId(1), imageId(2), imageId(3)]);

		expect([...found.keys()].toSorted()).toStrictEqual([imageId(1), imageId(3)]);
		expect(found.get(imageId(3))).toStrictEqual({ id: imageId(3), thumb: `thumb:${imageId(3)}` });
	});

	it("重複した ID は 1 回だけ渡す", async () => {
		const storage = fakeImageRefs([imageId(1)]);

		await getManyInBatches(storage, [imageId(1), imageId(2), imageId(1), imageId(2)]);

		expect(storage.getMany.mock.calls).toStrictEqual([[[imageId(1), imageId(2)]]]);
	});

	it.each([
		[1, [1]],
		[IMAGE_REFS_BATCH_SIZE, [IMAGE_REFS_BATCH_SIZE]],
		[IMAGE_REFS_BATCH_SIZE + 1, [IMAGE_REFS_BATCH_SIZE, 1]],
		[2 * IMAGE_REFS_BATCH_SIZE + 1, [IMAGE_REFS_BATCH_SIZE, IMAGE_REFS_BATCH_SIZE, 1]],
	])("%i 件を %j 件ずつに分け、最初に現れた順のまま渡す", async (count, sizes) => {
		const ids = Array.from({ length: count }, (_, i) => imageId(count - i));
		const storage = fakeImageRefs(ids);

		const found = await getManyInBatches(storage, ids);

		const batches = storage.getMany.mock.calls.map(([batch]) => batch);
		expect(batches.map((batch) => batch.length)).toStrictEqual(sizes);
		expect(batches.flat()).toStrictEqual(ids);
		expect(found.size).toBe(count);
	});

	it("1 回の getMany を D1 のバインド変数の上限に収める(分けずに渡すと失敗する件数でも取得できる)", async () => {
		const ids = Array.from({ length: 150 }, (_, i) => imageId(i + 1));
		const storage = fakeImageRefs(ids);
		await expect(storage.getMany(ids)).rejects.toThrow("too many SQL variables");
		storage.getMany.mockClear();

		const found = await getManyInBatches(storage, ids);

		expect(IMAGE_REFS_BATCH_SIZE + GET_MANY_BINDINGS_BESIDES_IDS).toBeLessThanOrEqual(
			D1_MAX_BINDINGS,
		);
		expect(found.size).toBe(ids.length);
	});

	it("getMany は並行に呼ぶ(前の結果を待たずに次を呼ぶ)", async () => {
		const ids = Array.from({ length: 2 * IMAGE_REFS_BATCH_SIZE }, (_, i) => imageId(i + 1));
		const pending: (() => void)[] = [];
		const getMany = vi.fn<GetMany>(
			(batch) =>
				new Promise((resolve) => {
					pending.push(() => resolve(new Map(batch.map((id) => [id, {}]))));
				}),
		);

		const result = getManyInBatches({ getMany }, ids);

		expect(getMany).toHaveBeenCalledTimes(2);
		for (const resolve of pending) resolve();
		await expect(result).resolves.toHaveProperty("size", ids.length);
	});

	it("getMany が失敗したら、そのまま reject する", async () => {
		const error = new Error("D1_ERROR: database is locked");
		const getMany = vi.fn<GetMany>(async () => {
			throw error;
		});

		await expect(getManyInBatches({ getMany }, [imageId(1)])).rejects.toBe(error);
	});
});

describe("型(tsc で確かめる)", () => {
	it("EmDash の StorageCollection をそのまま渡せる", () => {
		expectTypeOf<StorageCollection<ThumbRecord>>().toExtend<GetManyStorage<ThumbRecord>>();
	});
});
