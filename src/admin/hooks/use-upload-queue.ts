/**
 * ギャラリーの widget 用に、複数のファイルを 1 枚ずつ順に処理するフック(仕様書 11.3)。表示は持たない。
 *
 * - `enqueue(files)` で受け付けたファイルを、先にまとめて `inspectInputFile`(T12)で判定する。HEIC などの受け付けない
 *   ファイルは、ほかのファイルの処理を待たずに失敗にする(1 件 1ms 前後)。
 * - 判定を通ったファイルを、受け付けた順に 1 枚ずつ処理する(同時に処理するのは 1 枚)。1 リクエストで 1 枚だけ送る
 *   (仕様書 7 章)。
 * - 1 枚が終わるたびに `onUploaded` を呼ぶ。widget はここで参照に代替テキストを入れて、フィールドの値に加える。
 * - 一覧(`items`)には、処理待ち・処理中・失敗のファイルだけを残す。成功したものは `onUploaded` に渡して一覧から消す。
 *   取り消したもの(`remove`・`cancelAll`・アンマウント)は、エラーにせずに消す。
 * - 進捗の「2 / 3 枚目」と、終わったあとの「3 枚の画像を追加しました」のために、ひと続きの処理(処理待ちも処理中も
 *   無いときに受け付けてから、それが無くなるまで)で処理を終えた数(`finishedCount`)と、アップロードした数
 *   (`uploadedCount`)を数える。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Base64ImageError } from "../../shared/errors";
import { normalizeFieldOptions } from "../../shared/options";
import {
	inspectorOf,
	isUploadPhase,
	processImageFile,
	uploadTargetError,
	type UploadDependencies,
	type UploadPhase,
	type UploadedImage,
} from "./process-image";
import type { UploadTargetResolution } from "./upload-target";
import { useLatest } from "./use-latest";

/** 一覧のファイルの状態 */
export type UploadQueueItemState =
	/** 処理を待っている(受け付けた直後の判定の間も含む) */
	| { readonly status: "queued" }
	| UploadPhase
	/** 失敗。文言は `useErrorMessage(error)`(T14)。`remove(key)` で一覧から消す */
	| { readonly status: "error"; readonly error: unknown };

export interface UploadQueueItem {
	/** 一覧の中で一意なキー(React の `key` に使える) */
	readonly key: string;
	readonly file: File;
	readonly state: UploadQueueItemState;
}

/** 処理中のファイル */
export interface ProcessingUploadQueueItem extends UploadQueueItem {
	readonly state: UploadPhase;
}

export interface EnqueueOptions {
	/**
	 * 今回受け付けるファイルのうち、処理する枚数の上限。判定を通ったファイルだけを数え、受け付けた順に数える。
	 * 超えた分は `GALLERY_TOO_MANY_ITEMS` で失敗にする。省略すると制限しない。
	 * ギャラリーでは `maxItems - 値の枚数 - pendingCount` を渡す。
	 */
	readonly limit?: number | undefined;
}

export interface UseUploadQueueOptions {
	/** 保存先(`useUploadTarget(id)` の結果)。`ok === false` なら、各ファイルは `INVALID_TARGET` で失敗する */
	readonly target: UploadTargetResolution;
	/** widget の props の `options`。`normalizeFieldOptions` で丸めて使う */
	readonly options?: unknown;
	/** 1 枚のアップロードが終わるたびに、処理した順に呼ぶ(最後に描画したときの関数を呼ぶ) */
	readonly onUploaded: (image: UploadedImage, file: File) => void;
	/** 処理に使う関数の差し替え(テスト用) */
	readonly dependencies?: UploadDependencies | undefined;
}

export interface UploadQueue {
	/** 処理待ち・処理中・失敗のファイル(受け付けた順) */
	readonly items: readonly UploadQueueItem[];
	/** 処理中のファイル(`items` のうち、状態が `UploadPhase` のもの)。無ければ null */
	readonly current: ProcessingUploadQueueItem | null;
	/** 処理待ちと処理中のファイルの数 */
	readonly pendingCount: number;
	/** 処理待ちか処理中のファイルがあるか */
	readonly busy: boolean;
	/**
	 * 今のひと続きの処理で、処理を終えたファイルの数(成功と失敗)。受け付けたときの判定で失敗したファイルと、
	 * 取り消したファイルは数えない。次のひと続きの処理を始める(処理待ちも処理中も無いときに `enqueue` する)と 0 に戻る。
	 * 進捗の「2 / 3 枚目」は `finishedCount + 1` / `finishedCount + pendingCount`。
	 */
	readonly finishedCount: number;
	/** 今のひと続きの処理で、アップロードを終えた(`onUploaded` に渡した)ファイルの数 */
	readonly uploadedCount: number;
	/** ファイルを受け付ける(`FileList` も渡せる) */
	enqueue(files: ArrayLike<File> | Iterable<File>, options?: EnqueueOptions): void;
	/** 一覧から消す。処理待ちなら処理しない、処理中なら中断する、失敗なら表示を消す */
	remove(key: string): void;
	/** 処理待ちと処理中のファイルをすべて取り消す(失敗の表示は残す) */
	cancelAll(): void;
	/** 失敗の表示をすべて消す */
	clearErrors(): void;
}

interface Entry extends UploadQueueItem {
	/** 受け付けたときの判定(`inspectInputFile`)が終わったか */
	readonly inspected: boolean;
}

interface Snapshot {
	readonly entries: readonly Entry[];
	/** 今のひと続きの処理で、処理を終えた数 */
	readonly finished: number;
	/** 今のひと続きの処理で、アップロードした数 */
	readonly uploaded: number;
}

const QUEUED: UploadQueueItemState = { status: "queued" };
const EMPTY: Snapshot = { entries: [], finished: 0, uploaded: 0 };

export function useUploadQueue(options: UseUploadQueueOptions): UploadQueue {
	const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
	/** 非同期の処理が読む、最新の状態 */
	const snapshotRef = useRef<Snapshot>(EMPTY);
	const latest = useLatest(options);
	const mountedRef = useRef(false);
	const nextKeyRef = useRef(0);
	/** 処理中のファイル */
	const currentRef = useRef<{ readonly key: string; readonly controller: AbortController } | null>(
		null,
	);
	const pumpingRef = useRef(false);

	const commit = useCallback((next: Snapshot) => {
		snapshotRef.current = next;
		setSnapshot(next);
	}, []);

	// 状態はファイルのキーごとに変えるので、一覧から消したファイル(取り消したもの)の状態は、あとから変わらない
	const commitEntries = useCallback(
		(entries: readonly Entry[]) => {
			commit({ ...snapshotRef.current, entries });
		},
		[commit],
	);

	const updateEntry = useCallback(
		(key: string, state: UploadQueueItemState) => {
			commitEntries(withState(snapshotRef.current.entries, key, state));
		},
		[commitEntries],
	);

	const removeEntry = useCallback(
		(key: string) => {
			commitEntries(snapshotRef.current.entries.filter((entry) => entry.key !== key));
		},
		[commitEntries],
	);

	/** 判定の終わった処理待ちのファイルを、1 枚ずつ順に処理する。すでに動いていれば何もしない。reject はしない */
	const pump = useCallback(async (): Promise<void> => {
		/** 1 枚を処理する。reject はしない */
		const run = async (entry: Entry): Promise<void> => {
			const controller = new AbortController();
			currentRef.current = { key: entry.key, controller };
			const { signal } = controller;
			const { target, options: fieldOptions, dependencies } = latest.current;
			try {
				if (target.ok === false) throw uploadTargetError(target);
				const image = await processImageFile(entry.file, {
					target: target.target,
					fieldOptions: normalizeFieldOptions(fieldOptions),
					signal,
					onPhase: (phase: UploadPhase) => {
						updateEntry(entry.key, phase);
					},
					dependencies,
				});
				// 送信の関数が中断に応えなくても、取り消したファイルは値に加えない
				signal.throwIfAborted();
				// 先に値に加えてから一覧から消す(onUploaded が例外を投げたら、そのファイルの失敗として見せる)
				latest.current.onUploaded(image, entry.file);
				const { entries, finished, uploaded } = snapshotRef.current;
				commit({
					entries: entries.filter((item) => item.key !== entry.key),
					finished: finished + 1,
					uploaded: uploaded + 1,
				});
			} catch (error) {
				// 取り消したファイル(remove・cancelAll・アンマウント)は、中断した時点で一覧から消してある。数えもしない
				if (signal.aborted) return;
				const { entries, finished, uploaded } = snapshotRef.current;
				commit({
					entries: withState(entries, entry.key, { status: "error", error }),
					finished: finished + 1,
					uploaded,
				});
			} finally {
				if (currentRef.current?.controller === controller) currentRef.current = null;
			}
		};

		if (pumpingRef.current) return;
		pumpingRef.current = true;
		// run は reject しないので、この繰り返しは途中で投げない
		while (mountedRef.current) {
			const next = snapshotRef.current.entries.find(
				(entry) => entry.inspected && entry.state.status === "queued",
			);
			if (next === undefined) break;
			// oxlint-disable-next-line no-await-in-loop -- 1 枚ずつ順に処理する(仕様書 11.3)
			await run(next);
		}
		pumpingRef.current = false;
	}, [commit, latest, updateEntry]);

	/** 受け付けたファイルを、先にまとめて判定する。受け付けないものと、上限を超えたものは失敗にする */
	const inspect = useCallback(
		async (added: readonly Entry[], limit: number | undefined): Promise<void> => {
			const inspectInputFile = inspectorOf(latest.current.dependencies);
			const results = await Promise.all(
				added.map((entry) =>
					inspectInputFile(entry.file).then(
						() => ({ ok: true as const }),
						(error: unknown) => ({ ok: false as const, error }),
					),
				),
			);
			const max = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(limit));
			const decided = new Map<string, UploadQueueItemState>();
			let accepted = 0;
			added.forEach((entry, index) => {
				const result = results[index];
				if (result !== undefined && result.ok === false) {
					decided.set(entry.key, { status: "error", error: result.error });
				} else if (accepted < max) {
					accepted += 1;
					decided.set(entry.key, QUEUED);
				} else {
					decided.set(entry.key, { status: "error", error: tooManyFilesError(max) });
				}
			});
			// 判定の間に消されたファイル(remove・cancelAll)は、そのまま消えている
			commitEntries(
				snapshotRef.current.entries.map((entry) => {
					const state = decided.get(entry.key);
					return state === undefined ? entry : { ...entry, state, inspected: true };
				}),
			);
			void pump();
		},
		[commitEntries, latest, pump],
	);

	const enqueue = useCallback(
		(files: ArrayLike<File> | Iterable<File>, enqueueOptions: EnqueueOptions = {}) => {
			const added: Entry[] = Array.from(files, (file) => {
				nextKeyRef.current += 1;
				return { key: `upload-${nextKeyRef.current}`, file, state: QUEUED, inspected: false };
			});
			if (added.length === 0) return;
			const { entries, finished, uploaded } = snapshotRef.current;
			// 処理待ちも処理中も無ければ、ひと続きの処理を新しく始める
			const starting = !entries.some(isPending);
			commit({
				entries: [...entries, ...added],
				finished: starting ? 0 : finished,
				uploaded: starting ? 0 : uploaded,
			});
			void inspect(added, enqueueOptions.limit);
		},
		[commit, inspect],
	);

	const remove = useCallback(
		(key: string) => {
			const current = currentRef.current;
			if (current !== null && current.key === key) {
				currentRef.current = null;
				current.controller.abort();
			}
			removeEntry(key);
		},
		[removeEntry],
	);

	const cancelAll = useCallback(() => {
		const current = currentRef.current;
		currentRef.current = null;
		current?.controller.abort();
		commitEntries(snapshotRef.current.entries.filter((entry) => !isPending(entry)));
	}, [commitEntries]);

	const clearErrors = useCallback(() => {
		commitEntries(snapshotRef.current.entries.filter(isPending));
	}, [commitEntries]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			currentRef.current?.controller.abort();
			currentRef.current = null;
		};
	}, []);

	return useMemo(() => {
		const { entries, finished, uploaded } = snapshot;
		const items = entries.map(({ key, file, state }) => ({ key, file, state }));
		const pendingCount = entries.filter(isPending).length;
		return {
			items,
			current: findCurrent(entries),
			pendingCount,
			busy: pendingCount > 0,
			finishedCount: finished,
			uploadedCount: uploaded,
			enqueue,
			remove,
			cancelAll,
			clearErrors,
		};
	}, [snapshot, enqueue, remove, cancelAll, clearErrors]);
}

/** キーのファイルの状態を変えた一覧。キーが無ければ(取り消したファイル)、何も変えない */
function withState(
	entries: readonly Entry[],
	key: string,
	state: UploadQueueItemState,
): readonly Entry[] {
	return entries.map((entry) => (entry.key === key ? { ...entry, state } : entry));
}

/** 処理待ちか処理中か(失敗でないか) */
function isPending(entry: Entry): boolean {
	return entry.state.status !== "error";
}

function findCurrent(entries: readonly Entry[]): ProcessingUploadQueueItem | null {
	for (const { key, file, state } of entries) {
		if (isUploadPhase(state)) return { key, file, state };
	}
	return null;
}

function tooManyFilesError(limit: number): Base64ImageError {
	return new Base64ImageError(
		"GALLERY_TOO_MANY_ITEMS",
		`Only ${limit} more image(s) can be added to the gallery`,
		{ details: { limit } },
	);
}
