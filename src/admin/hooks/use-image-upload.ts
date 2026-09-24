/**
 * 単一画像の widget 用のアップロードのフック(仕様書 11.2)。表示は持たない(T22 の部品と T27 の widget が持つ)。
 *
 * - `upload(file)` で 1 枚を処理する。処理中に呼ぶと、前の処理を中断してから始める(差し替え)。
 * - 中断(`cancel()`・部品のアンマウント・差し替え)は、エラーの状態にしない。状態は `idle` に戻る。
 * - 失敗しても、フィールドの値は変えない(値を変えるのは widget。`upload` の結果が `done` のときだけ `onChange` する)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { normalizeFieldOptions } from "../../shared/options";
import {
	isUploadPhase,
	processImageFile,
	uploadTargetError,
	type UploadDependencies,
	type UploadOutcome,
	type UploadPhase,
	type UploadSettledState,
} from "./process-image";
import type { UploadTargetResolution } from "./upload-target";
import { useLatest } from "./use-latest";

/** `useImageUpload` の状態 */
export type ImageUploadState = { readonly status: "idle" } | UploadPhase | UploadSettledState;

export interface UseImageUploadOptions {
	/** 保存先(`useUploadTarget(id)` の結果)。`ok === false` なら、`upload` は `INVALID_TARGET` で失敗する */
	readonly target: UploadTargetResolution;
	/** widget の props の `options`(フィールド定義の options)。`normalizeFieldOptions` で丸めて使う */
	readonly options?: unknown;
	/** 処理に使う関数の差し替え(テスト用) */
	readonly dependencies?: UploadDependencies | undefined;
}

export interface ImageUpload {
	readonly state: ImageUploadState;
	/** 処理中、または最後に処理したファイル。`idle` なら null */
	readonly file: File | null;
	/** 処理中(`state` が `UploadPhase`。`isUploadPhase(state)` と同じ)か */
	readonly busy: boolean;
	/**
	 * ファイルを 1 枚処理してアップロードする。処理中なら、前の処理を中断してから始める(前の結果は `cancelled`)。
	 * reject はしない。結果が `done` なら、widget は `{ ...image.ref, alt }` をフィールドの値にする。
	 */
	upload(file: File): Promise<UploadOutcome>;
	/** 処理中なら中断して `idle` に戻す。処理中でなければ何もしない */
	cancel(): void;
	/** 処理中なら中断し、`done` / `error` の表示も消して `idle` に戻す */
	reset(): void;
}

interface Snapshot {
	readonly state: ImageUploadState;
	readonly file: File | null;
}

const IDLE: Snapshot = { state: { status: "idle" }, file: null };
const CANCELLED: UploadOutcome = { status: "cancelled" };

export function useImageUpload(options: UseImageUploadOptions): ImageUpload {
	const [snapshot, setSnapshot] = useState<Snapshot>(IDLE);
	const latest = useLatest(options);
	/** 処理中の中断用。処理中でなければ null。差し替え・キャンセル・アンマウントでは、必ずこれを中断する */
	const runRef = useRef<AbortController | null>(null);

	useEffect(
		() => () => {
			runRef.current?.abort();
			runRef.current = null;
		},
		[],
	);

	const upload = useCallback(
		async (file: File): Promise<UploadOutcome> => {
			runRef.current?.abort();
			const controller = new AbortController();
			runRef.current = controller;
			const { signal } = controller;
			// 中断(差し替え・キャンセル・アンマウント)のあとは、状態を変えない
			const show = (state: ImageUploadState): void => {
				if (!signal.aborted) setSnapshot({ state, file });
			};
			const { target, options: fieldOptions, dependencies } = latest.current;
			try {
				if (target.ok === false) throw uploadTargetError(target);
				const image = await processImageFile(file, {
					target: target.target,
					fieldOptions: normalizeFieldOptions(fieldOptions),
					signal,
					onPhase: show,
					dependencies,
				});
				// 送信が終わったあとに押された中断も、中断として扱う(作られた画像は未使用画像になる)
				signal.throwIfAborted();
				show({ status: "done", image });
				return { status: "done", image };
			} catch (error) {
				if (signal.aborted) return CANCELLED;
				show({ status: "error", error });
				return { status: "error", error };
			} finally {
				if (runRef.current === controller) runRef.current = null;
			}
		},
		[latest],
	);

	const cancel = useCallback(() => {
		const controller = runRef.current;
		if (controller === null) return;
		runRef.current = null;
		controller.abort();
		setSnapshot(IDLE);
	}, []);

	const reset = useCallback(() => {
		const controller = runRef.current;
		runRef.current = null;
		controller?.abort();
		setSnapshot(IDLE);
	}, []);

	const { state, file } = snapshot;
	return useMemo(
		() => ({ state, file, busy: isUploadPhase(state), upload, cancel, reset }),
		[state, file, upload, cancel, reset],
	);
}
