/**
 * widget(単一画像 T27・ギャラリー T28)が共通で使う UI 部品(仕様書 11.1〜11.3)。
 *
 * - 部品は表示と操作だけを受け持ち、値とコールバックを props で受け取る。アップロードの処理(T23 のフック)や
 *   API の呼び出しは持たない。
 * - 文言は各部品のファイルに ja / en で持ち、`<html lang>` で切り替える(T14 の `useMessages`)。
 * - 見た目は Kumo(`@cloudflare/kumo`)の部品と、EmDash の管理画面の CSS にあるクラスだけで作る。
 *   管理画面の CSS はビルド済みで、プラグインのファイルは Tailwind の対象にならないため。
 * - 部品の一覧と使い方は tasks/T22-widget-parts.md の「結果」。
 */

export { AltTextInput, type AltTextInputProps } from "./AltTextInput";
export {
	FileSelectButton,
	getTransferFiles,
	IMAGE_FILE_ACCEPT,
	ImageDropZone,
	type FileSelectButtonProps,
	type ImageDropZoneProps,
} from "./DropZone";
export { ErrorMessage, isAbortError, type ErrorMessageProps } from "./ErrorMessage";
export { formatKilobytes, formatQuality, longEdge } from "./format";
export { ImageMissingIcon, UploadIcon, WarningIcon } from "./icons";
export { ImageNotFound, type ImageNotFoundProps } from "./ImageNotFound";
export {
	getPreviewDisplaySize,
	ImageInfo,
	ImagePreview,
	PREVIEW_BOXES,
	type ImageInfoProps,
	type ImagePreviewProps,
	type PreviewSize,
} from "./ImagePreview";
export { UploadNotices, type UploadNoticesProps } from "./UploadNotices";
export {
	UPLOAD_STAGES,
	UploadProgress,
	type UploadProgressInfo,
	type UploadProgressProps,
	type UploadStage,
} from "./UploadProgress";
