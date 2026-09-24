/**
 * 画像を受け取る部品(仕様書 11.1〜11.3)。
 *
 * - `ImageDropZone`: 画像が無いとき(単一画像)や、画像を足すとき(ギャラリー)の入力欄。
 *   ファイルの選択・ドロップ・貼り付けの 3 通りで画像を受け取る。
 * - `FileSelectButton`: ファイルの選択だけを行うボタン(単一画像の「差し替え」など)。
 *
 * キーボードでは、ボタンに Tab で移り、Enter / Space でファイルの選択を開く。貼り付けは、ボタンにフォーカスがある状態で
 * Ctrl+V(Mac は ⌘V)。ドロップはポインターの操作なので、キーボードではファイルの選択と貼り付けで同じことを行う。
 *
 * 受け取ったファイルは、形式を確かめずに `onFiles` に渡す。形式と上限の判定はアップロードの処理
 * (T12 の `inspectInputFile` / `decodeImage`)が行い、HEIC などに案内を出す。
 */

import { Button } from "@cloudflare/kumo";
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type ChangeEvent,
	type DragEvent,
	type MouseEvent,
	type ReactNode,
	type Ref,
	type RefObject,
} from "react";

import { defineMessages, useMessages } from "../../client/i18n";
import { UploadIcon } from "./icons";

/**
 * ファイルの選択の `accept`。MIME タイプを並べると HEIC を選べなくなり、HEIC の案内を出せない
 * (tasks/T12-input-decode.md の「後続タスク向けのメモ」)。
 */
export const IMAGE_FILE_ACCEPT = "image/*";

const messages = defineMessages({
	ja: {
		drop: "画像をドロップ / 貼り付け",
		dropMultiple: "画像をドロップ / 貼り付け(複数可)",
		select: "ファイルを選択",
		selectMultiple: "ファイルを選択",
		named: (label: string, action: string) => `${label}: ${action}`,
		pasteHint:
			"画像をここにドロップするか、このボタンにフォーカスがある状態で Ctrl+V(Mac は ⌘V)を押して、コピーした画像を貼り付けることもできます。",
		oneAtATime: "画像は 1 枚ずつ追加してください。",
		unreadable:
			"クリップボードの画像を読み取れませんでした。ファイルを選択するか、画像をドロップしてください。",
	},
	en: {
		drop: "Drop or paste an image",
		dropMultiple: "Drop or paste images",
		select: "Select a file",
		selectMultiple: "Select files",
		named: (label, action) => `${label}: ${action}`,
		pasteHint:
			"You can also drop an image here, or paste a copied image with Ctrl+V (⌘V on Mac) while this button has focus.",
		oneAtATime: "Add one image at a time.",
		unreadable:
			"The image on the clipboard could not be read. Select a file or drop the image instead.",
	},
});

// 管理画面の CSS(`@emdash-cms/admin/dist/styles.css`)にあるクラスだけを使う(tests/admin/parts.test.tsx で確かめる)。
// 枠は EmDash の `ImageDropTarget` と同じ見た目にした。
const ZONE_CLASS = "rounded-xl border-2 border-dashed bg-kumo-control";
const ZONE_DRAGGING_CLASS = "rounded-xl border-2 border-dashed bg-kumo-tint";
/**
 * ドラッグ中の枠の色。管理画面の CSS は、層(`@layer`)の外に `* { border-color: var(--color-kumo-line) }` を持ち、
 * `@layer utilities` の `border-kumo-brand` より常に強い(`references/emdash/packages/admin/src/styles.css:83-85`)。
 * そのため、クラスではなく style で付ける。
 */
const ZONE_DRAGGING_STYLE = { borderColor: "var(--color-kumo-brand)" } as const;
const ZONE_BUTTON_CLASS =
	"h-auto min-h-32 w-full flex-col items-center justify-center gap-2 rounded-[10px] px-4 py-5 text-center text-base text-kumo-subtle";
const SELECT_TEXT_CLASS =
	"font-medium text-kumo-default underline decoration-kumo-line decoration-2 underline-offset-4";
const HELP_TEXT_CLASS = "text-xs leading-4 text-kumo-subtle";
const ERROR_TEXT_CLASS = "text-xs leading-4 text-kumo-danger";

/**
 * ドロップ・貼り付けの `DataTransfer` から、ファイルを取り出す。`files` が空なら、`items` の中のファイルを使う
 * (Firefox 155 の貼り付けでは、`files` が空で `items` にだけファイルの項目があった)。ファイルが無ければ空の配列。
 */
export function getTransferFiles(transfer: DataTransfer | null | undefined): File[] {
	if (transfer === null || transfer === undefined) return [];
	const files = Array.from(transfer.files);
	if (files.length > 0) return files;
	const fromItems: File[] = [];
	for (const item of Array.from(transfer.items)) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file !== null) fromItems.push(file);
	}
	return fromItems;
}

/**
 * ファイルを運んでいるか(文字列やリンクのドラッグ・貼り付けではない)。dragenter / dragover では `files` が読めないので
 * `types` を見る
 */
function carriesFiles(transfer: DataTransfer | null): boolean {
	return transfer !== null && Array.from(transfer.types).includes("Files");
}

function isInside(container: HTMLElement, node: EventTarget | null): boolean {
	return node instanceof Node && container.contains(node);
}

function hasContent(node: ReactNode): boolean {
	return node !== undefined && node !== null && node !== false && node !== "";
}

interface FileInputProps {
	readonly inputRef: RefObject<HTMLInputElement | null>;
	readonly multiple: boolean;
	readonly disabled: boolean;
	readonly onFiles: (files: File[]) => void;
}

/** 画面に出さないファイルの入力欄。ボタンから `click()` で開く */
function FileInput({ inputRef, multiple, disabled, onFiles }: FileInputProps) {
	const handleChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const input = event.currentTarget;
			const files = Array.from(input.files ?? []);
			// 同じファイルを選び直したときにも change が起きるよう、値を空にする
			input.value = "";
			if (files.length > 0) onFiles(files);
		},
		[onFiles],
	);
	return (
		<input
			ref={inputRef}
			type="file"
			accept={IMAGE_FILE_ACCEPT}
			multiple={multiple}
			disabled={disabled}
			hidden
			onChange={handleChange}
		/>
	);
}

export interface ImageDropZoneProps {
	/**
	 * 選択・ドロップ・貼り付けで受け取ったファイル(1 つ以上)。`multiple` でなければ 1 つだけ。
	 * 形式は確かめていない(画像でないファイルも渡る)。
	 */
	readonly onFiles: (files: File[]) => void;
	/** 複数のファイルを受け付ける(ギャラリー)。既定は `false` */
	readonly multiple?: boolean | undefined;
	/** 受け付けない(処理中・枚数の上限に達した)。ボタンは押せなくなり、ドロップと貼り付けも無視する */
	readonly disabled?: boolean | undefined;
	/** フィールドの表示名。ボタンの名前に付ける(「カバー: ファイルを選択」) */
	readonly label?: string | undefined;
	/** 入力欄の下に出す補足(ギャラリーの「あと 3 枚追加できます」など)。ボタンの説明にもなる */
	readonly description?: ReactNode;
	/** ボタンの `id` */
	readonly id?: string | undefined;
	/** ボタンの ref(処理のあとでフォーカスを戻すときなど) */
	readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
}

/** 枠の下に出す知らせ。`tooMany`: 単一画像に複数のファイル、`unreadable`: クリップボードのファイルを読めない */
type ZoneNotice = "tooMany" | "unreadable";

/**
 * 画像のドロップゾーン。枠の全体が 1 つのボタンで、押すとファイルの選択を開く。
 * - 単一画像(`multiple` なし)で複数のファイルがドロップ・貼り付けされたら、`onFiles` を呼ばずに「1 枚ずつ」と知らせる。
 * - 貼り付けにファイルの種類(`Files`)があるのにファイルを取り出せないときは、「読み取れませんでした」と知らせる。
 */
export function ImageDropZone({
	onFiles,
	multiple = false,
	disabled = false,
	label,
	description,
	id,
	buttonRef,
}: ImageDropZoneProps) {
	const t = useMessages(messages);
	const zoneRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const dragDepth = useRef(0);
	const [dragging, setDragging] = useState(false);
	const [notice, setNotice] = useState<ZoneNotice | null>(null);
	const hintId = useId();
	const descriptionId = useId();

	const receive = useCallback(
		(files: File[]) => {
			if (disabled || files.length === 0) return;
			if (!multiple && files.length > 1) {
				setNotice("tooMany");
				return;
			}
			setNotice(null);
			onFiles(files);
		},
		[disabled, multiple, onFiles],
	);

	// 貼り付けを受け取る要素はブラウザで違う(実測。docs/admin-image-input-browser-behavior.md)。
	// Chromium 153 はフォーカスのあるボタンに、Firefox 155 は body(か選択範囲のある要素)に届ける。
	// どちらでも拾えるよう document で受け、イベントの対象かフォーカスのある要素がこの枠の中のときだけ扱う。
	useEffect(() => {
		if (disabled) return undefined;
		const handlePaste = (event: ClipboardEvent) => {
			const zone = zoneRef.current;
			if (zone === null) return;
			if (!isInside(zone, event.target) && !isInside(zone, document.activeElement)) return;
			const files = getTransferFiles(event.clipboardData);
			if (files.length === 0) {
				// 文字だけの貼り付けは無視する。ファイルがあるはずなのに取り出せないときは知らせる
				if (carriesFiles(event.clipboardData)) {
					event.preventDefault();
					setNotice("unreadable");
				}
				return;
			}
			event.preventDefault();
			receive(files);
		};
		document.addEventListener("paste", handlePaste);
		return () => document.removeEventListener("paste", handlePaste);
	}, [disabled, receive]);

	const openPicker = useCallback((event: MouseEvent<HTMLButtonElement>) => {
		// クリックしたボタンにフォーカスが移るかは、ブラウザと OS で違う(MDN の <button> の「Clicking and focus」。
		// Safari は移さない)。ファイルの選択を閉じたあとで貼り付けを受け取れるよう、自分でフォーカスを取る
		event.currentTarget.focus();
		setNotice(null);
		inputRef.current?.click();
	}, []);

	const handleDragEnter = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			if (!carriesFiles(event.dataTransfer)) return;
			event.preventDefault();
			dragDepth.current += 1;
			if (!disabled) setDragging(true);
		},
		[disabled],
	);

	const handleDragOver = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			if (!carriesFiles(event.dataTransfer)) return;
			// 既定の動作(ブラウザがファイルを開いて、編集中のページから移動する)を止める
			event.preventDefault();
			event.dataTransfer.dropEffect = disabled ? "none" : "copy";
		},
		[disabled],
	);

	const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
		if (!carriesFiles(event.dataTransfer)) return;
		// 枠の中の要素に出入りしても消えないよう、入った回数と出た回数を数える
		dragDepth.current = Math.max(0, dragDepth.current - 1);
		if (dragDepth.current === 0) setDragging(false);
	}, []);

	const handleDrop = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			if (!carriesFiles(event.dataTransfer)) return;
			event.preventDefault();
			event.stopPropagation();
			dragDepth.current = 0;
			setDragging(false);
			receive(getTransferFiles(event.dataTransfer));
		},
		[receive],
	);

	const action = multiple ? t.selectMultiple : t.select;
	const showDescription = hasContent(description);
	const describedBy = showDescription ? `${hintId} ${descriptionId}` : hintId;

	return (
		<div className="grid gap-2">
			<div
				ref={zoneRef}
				className={dragging ? ZONE_DRAGGING_CLASS : ZONE_CLASS}
				style={dragging ? ZONE_DRAGGING_STYLE : undefined}
				data-dragging={dragging ? "true" : undefined}
				onDragEnter={handleDragEnter}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
			>
				<Button
					ref={buttonRef}
					id={id}
					variant="ghost"
					className={ZONE_BUTTON_CLASS}
					disabled={disabled}
					aria-label={label === undefined ? action : t.named(label, action)}
					aria-describedby={describedBy}
					onClick={openPicker}
				>
					<UploadIcon size={32} />
					<span className="font-normal">{multiple ? t.dropMultiple : t.drop}</span>
					<span className={SELECT_TEXT_CLASS}>{action}</span>
				</Button>
				<FileInput inputRef={inputRef} multiple={multiple} disabled={disabled} onFiles={receive} />
			</div>
			<span id={hintId} className="sr-only">
				{t.pasteHint}
			</span>
			{showDescription ? (
				<div id={descriptionId} className={HELP_TEXT_CLASS}>
					{description}
				</div>
			) : null}
			{notice === null ? null : (
				<p role="alert" className={ERROR_TEXT_CLASS}>
					{notice === "tooMany" ? t.oneAtATime : t.unreadable}
				</p>
			)}
		</div>
	);
}

export interface FileSelectButtonProps {
	/** 選択したファイル(1 つ以上)。形式は確かめていない */
	readonly onFiles: (files: File[]) => void;
	/** ボタンの文字(「差し替え」など) */
	readonly children: ReactNode;
	/** 複数のファイルを選べるようにする。既定は `false` */
	readonly multiple?: boolean | undefined;
	readonly disabled?: boolean | undefined;
	/** Kumo の Button の見た目。既定は `secondary` */
	readonly variant?: "primary" | "secondary" | "ghost" | "outline" | undefined;
	/** Kumo の Button の大きさ。既定は `sm` */
	readonly size?: "xs" | "sm" | "base" | "lg" | undefined;
	/** 文字の前に出すアイコン */
	readonly icon?: ReactNode;
	readonly id?: string | undefined;
	/** 文字だけでは何のボタンか分からないときの名前(ギャラリーの「画像 2 を差し替え」など) */
	readonly "aria-label"?: string | undefined;
	readonly "aria-describedby"?: string | undefined;
	readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
}

/** ファイルの選択を開くボタン(Kumo の Button)。キーボードでは Enter / Space で開く */
export function FileSelectButton({
	onFiles,
	children,
	multiple = false,
	disabled = false,
	variant = "secondary",
	size = "sm",
	icon,
	id,
	"aria-label": ariaLabel,
	"aria-describedby": ariaDescribedBy,
	buttonRef,
}: FileSelectButtonProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const openPicker = useCallback(() => {
		inputRef.current?.click();
	}, []);
	const receive = useCallback(
		(files: File[]) => {
			if (!disabled) onFiles(files);
		},
		[disabled, onFiles],
	);
	return (
		<>
			<Button
				ref={buttonRef}
				id={id}
				variant={variant}
				size={size}
				icon={icon}
				disabled={disabled}
				aria-label={ariaLabel}
				aria-describedby={ariaDescribedBy}
				onClick={openPicker}
			>
				{children}
			</Button>
			<FileInput inputRef={inputRef} multiple={multiple} disabled={disabled} onFiles={receive} />
		</>
	);
}
