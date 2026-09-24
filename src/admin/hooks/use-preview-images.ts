/**
 * 保存済みの画像の本体を、プラグインのルート(`preview`)から取得するフック(仕様書 11.2)。表示は持たない。
 *
 * - 渡された ID のうち、まだ持っていないものだけを取得する。取得中の ID は、もう一度は取得しない。
 *   並べ替え(ID の順番だけが変わる)や、同じ ID での再描画では取得しない。
 * - 1 回の要求は `PREVIEW_MAX_IDS`(10)件まで。超える分は分けて並行に送る(20 枚のギャラリーは 2 回。T17)。
 *   1 回の要求が失敗しても、ほかの要求の結果は使う。
 * - `image: null`(ゴミ箱に入った・削除された・公開されていない・値が不正。T17)と、応答に無い ID は `missing`
 *   (「画像が見つかりません」)。エントリ ID の形でない ID は、取得せずに `missing` にする。
 * - アップロードしたばかりの画像は `prime(id, entry)` で登録すると、取得せずに手元の data URL を表示できる。
 * - アンマウントしたら、取得中の要求を中断する。
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { fetchPreviews } from "../../client/api";
import { PREVIEW_MAX_IDS } from "../../shared/constants";
import { entryIdSchema } from "../../shared/schema";
import type { Base64ImageEntry } from "../../shared/types";

/** 画像ごとのプレビューの状態 */
export type PreviewState =
	| { readonly status: "loading" }
	| { readonly status: "loaded"; readonly image: Base64ImageEntry }
	/** 画像が見つからない(「画像が見つかりません」と削除ボタンを出す) */
	| { readonly status: "missing" }
	/** 取得に失敗した(通信のエラーなど)。文言は `useErrorMessage(error)`、取得し直すのは `retry()` */
	| { readonly status: "error"; readonly error: unknown };

export interface PreviewImages {
	/** 渡した ID ごとの状態(重複は除き、渡した順) */
	readonly previews: ReadonlyMap<string, PreviewState>;
	/** アップロードしたばかりの画像を登録する(`UploadedImage` の `ref.id` と `entry`)。その ID は取得しない */
	prime(id: string, image: Base64ImageEntry): void;
	/** 取得に失敗した画像(今渡している ID のうち `error` のもの)を取得し直す */
	retry(): void;
}

const LOADING: PreviewState = { status: "loading" };
const MISSING: PreviewState = { status: "missing" };

export function usePreviewImages(ids: readonly string[]): PreviewImages {
	const [store] = useState(createPreviewStore);
	const states = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	// 同じ ID の並びなら同じ配列を使い、effect を動かさない
	const key = JSON.stringify(uniqueIds(ids));
	const wanted = useMemo(() => JSON.parse(key) as readonly string[], [key]);

	useEffect(() => {
		store.activate();
		return store.dispose;
	}, [store]);

	useEffect(() => {
		store.want(wanted);
	}, [store, wanted]);

	return useMemo(() => {
		const previews = new Map<string, PreviewState>(
			wanted.map((id) => [id, states.get(id) ?? (isEntryId(id) ? LOADING : MISSING)]),
		);
		return { previews, prime: store.prime, retry: store.retry };
	}, [states, store, wanted]);
}

// ---------------------------------------------------------------------------
// 取得した状態の置き場所(React の外)
// ---------------------------------------------------------------------------

interface PreviewStore {
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => ReadonlyMap<string, PreviewState>;
	/** 今の ID を伝える。持っていない ID を取得する */
	readonly want: (ids: readonly string[]) => void;
	readonly prime: (id: string, image: Base64ImageEntry) => void;
	readonly retry: () => void;
	/** 部品が表示されたら呼ぶ */
	readonly activate: () => void;
	/** 部品が消えたら呼ぶ。取得中の要求を中断し、その ID を「持っていない」に戻す(もう一度表示されたら取得し直す) */
	readonly dispose: () => void;
}

interface PreviewRequest {
	readonly ids: readonly string[];
	readonly controller: AbortController;
}

function createPreviewStore(): PreviewStore {
	let states: ReadonlyMap<string, PreviewState> = new Map();
	let wanted: readonly string[] = [];
	let active = false;
	const listeners = new Set<() => void>();
	const requests = new Set<PreviewRequest>();

	/** 状態を変えて知らせる。`undefined` は「持っていない」に戻す */
	const apply = (changes: readonly (readonly [string, PreviewState | undefined])[]): void => {
		if (changes.length === 0) return;
		const next = new Map(states);
		for (const [id, state] of changes) {
			if (state === undefined) next.delete(id);
			else next.set(id, state);
		}
		states = next;
		for (const listener of listeners) listener();
	};

	/** 取得中のまま(`prime` などで変わっていない)の ID だけを変える */
	const settle = (ids: readonly string[], stateOf: (id: string) => PreviewState): void => {
		apply(ids.filter((id) => states.get(id) === LOADING).map((id) => [id, stateOf(id)]));
	};

	/** 1 回分(`PREVIEW_MAX_IDS` 件まで)を取得する。reject はしない */
	const fetchChunk = async (request: PreviewRequest): Promise<void> => {
		requests.add(request);
		const { signal } = request.controller;
		try {
			// 中断されたら、応答を読み終えていても reject する(T14 の `fetchPreviews`)
			const response = await fetchPreviews(request.ids, { signal });
			const found = new Map(response.items.map((item) => [item.id, item.image]));
			settle(request.ids, (id) => {
				const image = found.get(id);
				return image === undefined || image === null ? MISSING : { status: "loaded", image };
			});
		} catch (error) {
			// 中断した要求の ID は、dispose で「持っていない」に戻してあり、次の要求が取得中にしていることがある
			if (signal.aborted) return;
			settle(request.ids, () => ({ status: "error", error }));
		} finally {
			requests.delete(request);
		}
	};

	const load = (ids: readonly string[]): void => {
		apply(ids.map((id) => [id, LOADING]));
		for (let start = 0; start < ids.length; start += PREVIEW_MAX_IDS) {
			void fetchChunk({
				ids: ids.slice(start, start + PREVIEW_MAX_IDS),
				controller: new AbortController(),
			});
		}
	};

	const want = (ids: readonly string[]): void => {
		wanted = ids;
		if (!active) return;
		const unknown = ids.filter((id) => !states.has(id));
		apply(unknown.filter((id) => !isEntryId(id)).map((id) => [id, MISSING]));
		const fetchable = unknown.filter(isEntryId);
		if (fetchable.length > 0) load(fetchable);
	};

	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot: () => states,
		want,
		prime(id, image) {
			apply([[id, { status: "loaded", image }]]);
		},
		retry() {
			if (!active) return;
			const failed = wanted.filter((id) => states.get(id)?.status === "error");
			if (failed.length > 0) load(failed);
		},
		activate() {
			active = true;
			want(wanted);
		},
		dispose() {
			active = false;
			const aborted: string[] = [];
			for (const request of requests) {
				request.controller.abort();
				aborted.push(...request.ids);
			}
			requests.clear();
			apply(aborted.filter((id) => states.get(id) === LOADING).map((id) => [id, undefined]));
		},
	};
}

function uniqueIds(ids: readonly string[]): string[] {
	return [...new Set(ids)];
}

function isEntryId(id: string): boolean {
	return entryIdSchema.safeParse(id).success;
}
