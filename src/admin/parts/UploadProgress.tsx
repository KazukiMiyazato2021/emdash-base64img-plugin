/**
 * 処理状況の表示(仕様書 11.2 の「処理中」、11.3 の「それぞれの進捗を表示」)。
 *
 * - 見える行: 「圧縮中… 1280px / 画質 0.74 [キャンセル]」。値は画質を探すたびに変わる。
 * - 読み上げ: 画面に出さない `<output>`(暗黙の role は `status`。`aria-live="polite"`)に、段階が変わったときだけ
 *   変わる文を入れる。画質を探すたびに読み上げると、読み上げが追いつかないため。
 * - 読み上げの領域は、処理していないときも残す。領域が先に DOM に無いと、読み上げない支援技術があるため。
 *   そのため、widget はこの部品を処理の有無にかかわらず描画しておく(`progress` が `null` のときは行を出さない)。
 * - キャンセルボタンを押したあと、行は消える。フォーカスの戻し先(ドロップゾーンのボタンなど)は widget が決める。
 */

import { Button, Loader } from "@cloudflare/kumo";
import type { Ref } from "react";

import { defineMessages, useMessages } from "../../client/i18n";
import type { CompressProgress } from "../../shared/pipeline";
import { formatQuality, longEdge } from "./format";

/**
 * 処理の段階(`src/shared/pipeline.ts` の順)。
 * `decoding`: 入力の判定とデコード(T12)、`compressing`: 縮小と画質の探索(T13)、
 * `thumbnail`: サムネイルの生成(T13)、`uploading`: ルートへの送信(T14)
 */
export const UPLOAD_STAGES = ["decoding", "compressing", "thumbnail", "uploading"] as const;
export type UploadStage = (typeof UPLOAD_STAGES)[number];

export interface UploadProgressInfo {
	/** 処理の段階 */
	readonly stage: UploadStage;
	/** 圧縮の途中経過(`stage` が `compressing` のとき。T13 の `onProgress` に渡る値) */
	readonly compress?: CompressProgress | undefined;
	/** 処理しているファイルの名前 */
	readonly filename?: string | undefined;
	/** 何枚目か(1 から数える)。ギャラリーで複数のファイルを順に処理するとき、`total` と一緒に渡す */
	readonly index?: number | undefined;
	/** 順に処理するファイルの枚数 */
	readonly total?: number | undefined;
}

export interface UploadProgressProps {
	/** 処理の状況。`null` なら行を出さない(読み上げの領域だけを残す) */
	readonly progress: UploadProgressInfo | null;
	/** キャンセルボタンで呼ぶ。省略するとボタンを出さない */
	readonly onCancel?: (() => void) | undefined;
	/**
	 * 直前の処理で追加した枚数。`progress` が `null` のときに「画像を追加しました」と読み上げる。
	 * 0 か省略なら何も読み上げない。
	 */
	readonly completed?: number | undefined;
	/** キャンセルボタンの ref(処理を始めたときに、フォーカスを移すなど) */
	readonly cancelButtonRef?: Ref<HTMLButtonElement> | undefined;
}

const messages = defineMessages({
	ja: {
		decoding: "読み込み中…",
		compressing: "圧縮中…",
		compressingDetail: (edge: number, quality: string) => `圧縮中… ${edge}px / 画質 ${quality}`,
		thumbnail: "サムネイルを作成中…",
		uploading: "アップロード中…",
		position: (index: number, total: number) => `${index} / ${total} 枚目`,
		cancel: "キャンセル",
		announceDecoding: "画像を読み込んでいます。",
		announceCompressing: "画像を圧縮しています。",
		announceThumbnail: "サムネイルを作成しています。",
		announceUploading: "画像をアップロードしています。",
		announcePosition: (index: number, total: number) => `${total} 枚中 ${index} 枚目: `,
		completed: (count: number) =>
			count === 1 ? "画像を追加しました。" : `${count} 枚の画像を追加しました。`,
	},
	en: {
		decoding: "Reading…",
		compressing: "Compressing…",
		compressingDetail: (edge, quality) => `Compressing… ${edge}px / quality ${quality}`,
		thumbnail: "Creating a thumbnail…",
		uploading: "Uploading…",
		position: (index, total) => `Image ${index} of ${total}`,
		cancel: "Cancel",
		announceDecoding: "Reading the image.",
		announceCompressing: "Compressing the image.",
		announceThumbnail: "Creating a thumbnail.",
		announceUploading: "Uploading the image.",
		announcePosition: (index, total) => `Image ${index} of ${total}: `,
		completed: (count) => (count === 1 ? "Image added." : `${count} images added.`),
	},
});

type ProgressMessages = (typeof messages)["ja"];

interface Position {
	readonly index: number;
	readonly total: number;
}

/** 何枚目か。1 枚だけを処理するとき(`total` が 1 以下・省略)は出さない */
function positionOf(progress: UploadProgressInfo): Position | null {
	const { index, total } = progress;
	return index !== undefined && total !== undefined && total > 1 ? { index, total } : null;
}

/** 見える行の、段階の文(圧縮中は長辺と画質を含む) */
function visibleStageText(t: ProgressMessages, progress: UploadProgressInfo): string {
	if (progress.stage === "compressing") {
		const compress = progress.compress;
		return compress === undefined
			? t.compressing
			: t.compressingDetail(
					longEdge(compress.width, compress.height),
					formatQuality(compress.quality),
				);
	}
	if (progress.stage === "decoding") return t.decoding;
	if (progress.stage === "thumbnail") return t.thumbnail;
	return t.uploading;
}

/** 読み上げる文。段階と何枚目かだけで決め、画質を探すたびには変えない */
function announcementText(
	t: ProgressMessages,
	progress: UploadProgressInfo | null,
	completed: number | undefined,
): string {
	if (progress === null) {
		return completed !== undefined && completed > 0 ? t.completed(completed) : "";
	}
	const position = positionOf(progress);
	const prefix = position === null ? "" : t.announcePosition(position.index, position.total);
	if (progress.stage === "decoding") return prefix + t.announceDecoding;
	if (progress.stage === "compressing") return prefix + t.announceCompressing;
	if (progress.stage === "thumbnail") return prefix + t.announceThumbnail;
	return prefix + t.announceUploading;
}

/** 処理状況の行と、読み上げの領域 */
export function UploadProgress({
	progress,
	onCancel,
	completed,
	cancelButtonRef,
}: UploadProgressProps) {
	const t = useMessages(messages);
	const position = progress === null ? null : positionOf(progress);
	return (
		<div className="grid gap-2">
			{/* `output` の暗黙の role は `status`。支援技術によらず読み上げられるよう、`aria-live` も明示する */}
			<output aria-live="polite" className="sr-only">
				{announcementText(t, progress, completed)}
			</output>
			{progress === null ? null : (
				<div className="flex flex-wrap items-center gap-2 text-sm" data-stage={progress.stage}>
					<span aria-hidden="true" className="flex items-center text-kumo-subtle">
						<Loader size="sm" />
					</span>
					{position === null ? null : (
						<span className="tabular-nums">{t.position(position.index, position.total)}</span>
					)}
					{progress.filename === undefined || progress.filename === "" ? null : (
						<span className="min-w-0 truncate text-kumo-subtle">{progress.filename}</span>
					)}
					<span className="tabular-nums">{visibleStageText(t, progress)}</span>
					{onCancel === undefined ? null : (
						<Button ref={cancelButtonRef} variant="secondary" size="sm" onClick={onCancel}>
							{t.cancel}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
