/**
 * widget(T27 の単一画像・T28 のギャラリー)が使う、アップロードとプレビューのフック(T23)。
 * 状態と処理だけを持ち、表示は持たない(表示の部品は `src/admin/parts/`。T22)。
 *
 * - `useUploadTarget(id)`: 管理画面の URL と widget の `id` から、アップロードの保存先を求める
 * - `useImageUpload({ target, options })`: 1 枚を処理する(差し替えは前の処理を中断する)
 * - `useUploadQueue({ target, options, onUploaded })`: 複数のファイルを 1 枚ずつ順に処理する
 * - `usePreviewImages(ids)`: 保存済みの画像のプレビューを取得する
 */

export {
	buildUploadRequest,
	isUploadPhase,
	PAINT_TIMEOUT_MS,
	processImageFile,
	toUploadFilename,
	uploadTargetError,
	waitForPaint,
	type CompressedSummary,
	type InspectInputFile,
	type ProcessImageOptions,
	type UploadDependencies,
	type UploadedImage,
	type UploadOutcome,
	type UploadPhase,
	type UploadSettledState,
} from "./process-image";
export {
	FIELD_ID_PREFIX,
	readRouterSearchString,
	resolveUploadTarget,
	useUploadTarget,
	type LocationLike,
	type UploadTargetProblem,
	type UploadTargetResolution,
} from "./upload-target";
export {
	useImageUpload,
	type ImageUpload,
	type ImageUploadState,
	type UseImageUploadOptions,
} from "./use-image-upload";
export { usePreviewImages, type PreviewImages, type PreviewState } from "./use-preview-images";
export {
	useUploadQueue,
	type EnqueueOptions,
	type ProcessingUploadQueueItem,
	type UploadQueue,
	type UploadQueueItem,
	type UploadQueueItemState,
	type UseUploadQueueOptions,
} from "./use-upload-queue";
