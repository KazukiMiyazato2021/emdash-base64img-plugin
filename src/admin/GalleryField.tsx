/**
 * ギャラリーの widget(`base64-image:gallery`。仕様書 11.3)。
 *
 * - 値は画像の参照の配列(仕様書 5.2)。`json` フィールドなので、どんな値も来うる(`readGalleryValue`)。
 *   - `null` / `undefined` は画像なし。
 *   - 配列の要素のうち参照の形(T03 の `isBase64ImageRef`)でないものは、その場所に「データが正しくありません」と出し、
 *     削除と並べ替えだけをできるようにする。値を勝手に直したり捨てたりしない(保存は T16 の hook が拒否する)。
 *   - 同じ画像が 2 回以上あれば、2 回目以降に注意を出す(保存は T16 の hook が拒否する)。
 *   - 配列でない値は、値を空にするボタン(参照 1 つなら 1 枚目にするボタンも)を出し、直すまで画像を追加させない。
 * - 画像の追加: ドロップゾーン(複数可。T22)で受け取り、T23 の `useUploadQueue` で 1 枚ずつ処理する。1 枚が終わるたびに
 *   値の後ろに足す。`maxItems` を超える分は、フックの `limit` で処理せずに失敗にする。処理中は追加できない。
 * - 並べ替え: ↑↓ ボタン(キーボード)と、ドラッグ(HTML の Drag and Drop。つまみと縮小画像をつかむ)。
 *   並べ替えたら読み上げの領域(`<output>`)で伝える。フォーカスは押したボタンに残る(行の要素が動いて外れても、
 *   React DOM がコミットのあとで戻す)。端のボタンは `aria-disabled` にする(`disabled` だとフォーカスが外れる)。
 * - フォーカスは、この widget の中で最後にフォーカスを受けた要素が、表示の切り替えで消えた・無効になったときだけ移す
 *   (処理の開始はキャンセル、終了は処理を始めた場所、削除は次の画像の見出し)。ほかのフィールドからは奪わない。
 * - 1 枚ずつ: 代替テキスト・差し替え(代替テキストは空にする。T27 と同じ)・削除。削除したら、次の画像の見出しに
 *   フォーカスを移す。
 * - 編集ロック中(EmDash がフィールドを `<fieldset disabled>` で包む)は、ボタンと入力欄をブラウザが無効にする。
 *   ファイルのドロップと、つまみのドラッグは、この widget が受け付けない(`isLocked`)。
 * - 表示の部品は T22(`./parts`)、処理と状態は T23(`./hooks`)。この部品は値の読み書きと組み立てだけを持つ。
 *
 * 管理画面の入口(T30)は `fields.gallery` にこの `GalleryField` を登録する(tasks/T28-gallery-widget.md の「結果」)。
 */

import { Button, Label } from "@cloudflare/kumo";
import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent,
	type ReactNode,
} from "react";

import { defineMessages, useMessages } from "../client/i18n";
import type { NoticeCode } from "../shared/errors";
import { normalizeFieldOptions } from "../shared/options";
import { isBase64ImageRef } from "../shared/schema";
import type { Base64ImageRef } from "../shared/types";
import {
	usePreviewImages,
	useUploadQueue,
	useUploadTarget,
	type PreviewState,
	type UploadDependencies,
	type UploadedImage,
	type UploadQueue,
	type UploadQueueItem,
} from "./hooks";
import {
	AltTextInput,
	ErrorMessage,
	FileSelectButton,
	ImageDropZone,
	ImageInfo,
	ImageNotFound,
	ImagePreview,
	PREVIEW_BOXES,
	UploadNotices,
	UploadProgress,
	WarningIcon,
	type UploadProgressInfo,
} from "./parts";

// ---------------------------------------------------------------------------
// 文言
// ---------------------------------------------------------------------------

const messages = defineMessages({
	ja: {
		count: (count: number, max: number) => `${count} / ${max} 枚`,
		remaining: (remaining: number, max: number) =>
			`あと ${remaining} 枚追加できます(最大 ${max} 枚)。`,
		full: (max: number) => `上限の ${max} 枚に達しています。追加するには、画像を削除してください。`,
		over: (max: number, over: number) =>
			`上限の ${max} 枚を ${over} 枚超えています。保存するには、${over} 枚削除してください。`,
		unsupportedZone: "値を直すまで、画像を追加できません。",
		item: (position: number) => `画像 ${position}`,
		moveUp: "↑",
		moveDown: "↓",
		moveUpLabel: (position: number) => `画像 ${position} を上へ移動`,
		moveDownLabel: (position: number) => `画像 ${position} を下へ移動`,
		replace: "差し替え",
		replaceLabel: (position: number) => `画像 ${position} を差し替え`,
		remove: "削除",
		removeLabel: (position: number) => `画像 ${position} を削除`,
		dragHint: "ドラッグして並べ替えます",
		moved: (from: number, to: number, total: number) =>
			`画像を ${from} 番目から ${to} 番目に移動しました(全 ${total} 枚)。`,
		removed: (position: number, total: number) =>
			`${position} 番目の画像を削除しました(残り ${total} 枚)。`,
		replaced: (position: number) => `${position} 番目の画像を差し替えました。`,
		duplicate: (first: number) =>
			`同じ画像が ${first} 番目にもあります。保存するには、どちらかを削除してください。`,
		invalid: "データが正しくありません",
		invalidDetail:
			"この画像の値は形が正しくないため、表示も編集もできません。保存するには、削除してください。",
		previewFailed: "読み込めませんでした",
		previewFailedTitle: "プレビューを読み込めませんでした",
		retry: "もう一度読み込む",
		dismissAll: "エラーをすべて閉じる",
		unsupported:
			"このフィールドの値が、ギャラリーの形(画像の参照の一覧)ではありません。保存するには、値を空にしてください。",
		unsupportedSingle:
			"このフィールドの値が、ギャラリーの形ではなく、画像 1 枚の参照です。ギャラリーの 1 枚目にするか、値を空にしてください。",
		useSingle: "1 枚目にする",
		clear: "値を空にする",
		cleared: "値を空にしました。",
		converted: "画像をギャラリーの 1 枚目にしました。",
	},
	en: {
		count: (count, max) => `${count} / ${max} images`,
		remaining: (remaining, max) => `You can add ${remaining} more (up to ${max}).`,
		full: (max) => `The gallery is full (${max} images). Remove an image to add another.`,
		over: (max, over) =>
			`The gallery has ${over} more ${over === 1 ? "image" : "images"} than the limit of ${max}. Remove ${over} to save the entry.`,
		unsupportedZone: "Fix the value before adding images.",
		item: (position) => `Image ${position}`,
		moveUp: "↑",
		moveDown: "↓",
		moveUpLabel: (position) => `Move image ${position} up`,
		moveDownLabel: (position) => `Move image ${position} down`,
		replace: "Replace",
		replaceLabel: (position) => `Replace image ${position}`,
		remove: "Remove",
		removeLabel: (position) => `Remove image ${position}`,
		dragHint: "Drag to reorder",
		moved: (from, to, total) => `Moved the image from position ${from} to ${to} of ${total}.`,
		removed: (position, total) =>
			`Removed image ${position}. ${total} ${total === 1 ? "image" : "images"} left.`,
		replaced: (position) => `Replaced image ${position}.`,
		duplicate: (first) =>
			`The same image is also at position ${first}. Remove one of them to save the entry.`,
		invalid: "Invalid data",
		invalidDetail:
			"This item is not a valid image reference, so it cannot be shown or edited. Remove it to save the entry.",
		previewFailed: "Could not load",
		previewFailedTitle: "Could not load the previews",
		retry: "Try again",
		dismissAll: "Dismiss all errors",
		unsupported:
			"The value of this field is not a gallery (a list of image references). Clear the value to save the entry.",
		unsupportedSingle:
			"The value of this field is a single image reference, not a gallery. Use it as the first image, or clear the value.",
		useSingle: "Use as the first image",
		clear: "Clear the value",
		cleared: "Cleared the value.",
		converted: "Moved the image into the gallery as the first image.",
	},
});

type GalleryMessages = (typeof messages)["ja"];

// ---------------------------------------------------------------------------
// 見た目(管理画面の CSS にあるクラスだけを使う。tests/admin/GalleryField.test.tsx で確かめる)
// ---------------------------------------------------------------------------

const ROW_CLASS = "flex gap-3 rounded-lg border bg-kumo-base p-2";
const HANDLE_CLASS = "flex shrink-0 cursor-grab select-none items-start gap-1 text-kumo-subtle";
/** 縮小画像の代わりに出す小さな枠(`ImageNotFound` の `small` と同じ見た目) */
const SMALL_BOX_CLASS =
	"flex flex-col items-center justify-center gap-1 rounded-lg border bg-kumo-tint px-2 text-center text-kumo-subtle";
const SMALL_BOX_STYLE = {
	width: `${PREVIEW_BOXES.small.width}px`,
	height: `${PREVIEW_BOXES.small.height}px`,
} as const;
const HELP_TEXT_CLASS = "text-xs leading-4 text-kumo-subtle";
/** 押しても何もしないボタン(`aria-disabled`)。Kumo が `disabled` のときに付けるものと同じ */
const INERT_BUTTON_CLASS = "cursor-not-allowed opacity-50";
/**
 * ドラッグで落とす位置の線。枠の色のクラスは、管理画面の CSS の層の外の `*` の `border-color` に負けるので、
 * 影(box-shadow)を style で付ける(docs/emdash-admin-plugin-ui-styling.md)
 */
const DROP_BEFORE_STYLE = { boxShadow: "0 -3px 0 0 var(--color-kumo-brand)" } as const;
const DROP_AFTER_STYLE = { boxShadow: "0 3px 0 0 var(--color-kumo-brand)" } as const;
/** 縮小画像は、つまみと一緒にドラッグする(画像そのもののドラッグ・右クリックは受けない) */
const PASS_THROUGH_STYLE = { pointerEvents: "none" } as const;

/**
 * 並べ替えのドラッグで運ぶデータの種類。ファイルのドラッグ(`Files`)と区別する。
 * `dragover` では中身を読めないので、種類と、この widget の中で始まったドラッグか(ref)で判定する
 */
export const GALLERY_DRAG_TYPE = "application/x-base64-image-gallery-item";

// ---------------------------------------------------------------------------
// 値の読み方
// ---------------------------------------------------------------------------

/** ギャラリーの 1 枚(値の配列の要素) */
export type GalleryEntry =
	| {
			readonly kind: "image";
			/** 描画のキー。値から決まる(`image:<画像 ID>`。同じ画像の 2 回目以降は `#2` などを付ける) */
			readonly key: string;
			readonly ref: Base64ImageRef;
			/** 同じ画像が前にもあれば、その位置(1 から) */
			readonly duplicateOf: number | undefined;
	  }
	/** 参照の形でない要素。削除と並べ替えだけができる */
	| { readonly kind: "invalid"; readonly key: string };

/** フィールドの値を読んだ結果 */
export type GalleryValue =
	| {
			readonly kind: "list";
			/** 値の配列(`null` / `undefined` は空の配列)。書き換えるときは、これを写して変える */
			readonly elements: readonly unknown[];
			readonly entries: readonly GalleryEntry[];
	  }
	/** 配列でない値。`single` は、値が参照 1 つのときの参照 */
	| { readonly kind: "unsupported"; readonly single: Base64ImageRef | null };

type GalleryList = Extract<GalleryValue, { readonly kind: "list" }>;

const EMPTY_LIST: GalleryList = { kind: "list", elements: [], entries: [] };

/**
 * フィールドの値(`json`。どんな値も来うる)を読む。値は変えない。
 * - `null` / `undefined` は画像なし。配列でない値は `unsupported`。
 * - 配列の要素は 1 つずつ `isBase64ImageRef` で判定する(壊れた要素があっても、ほかの画像は使える)。
 */
export function readGalleryValue(value: unknown): GalleryValue {
	if (value === null || value === undefined) return EMPTY_LIST;
	if (!Array.isArray(value)) {
		return { kind: "unsupported", single: isBase64ImageRef(value) ? value : null };
	}
	const elements: readonly unknown[] = value;
	const firstPosition = new Map<string, number>();
	const keyCounts = new Map<string, number>();
	const entries = elements.map((element, index): GalleryEntry => {
		if (isBase64ImageRef(element)) {
			const duplicateOf = firstPosition.get(element.id);
			if (duplicateOf === undefined) firstPosition.set(element.id, index + 1);
			return {
				kind: "image",
				key: uniqueKey(keyCounts, `image:${element.id}`),
				ref: element,
				duplicateOf,
			};
		}
		return { kind: "invalid", key: uniqueKey(keyCounts, `invalid:${describeValue(element)}`) };
	});
	return { kind: "list", elements, entries };
}

/** 同じ元の文字列の 2 回目以降に `#2` などを付ける */
function uniqueKey(counts: Map<string, number>, base: string): string {
	const count = (counts.get(base) ?? 0) + 1;
	counts.set(base, count);
	return count === 1 ? base : `${base}#${count}`;
}

/** 壊れた要素のキーの元(値の JSON)。並べ替えても変わらないよう、位置ではなく中身から作る */
function describeValue(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

/** 配列の `from` 番目の要素を `to` 番目に動かした配列 */
function moveElement(elements: readonly unknown[], from: number, to: number): unknown[] {
	const next = [...elements];
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}

// ---------------------------------------------------------------------------
// props
// ---------------------------------------------------------------------------

/**
 * EmDash 0.39.1 の管理画面が plugin の field widget に渡す props(`references/emdash/packages/admin/src/components/
 * ContentEditor.tsx:1819-1843`)と、テスト用の `dependencies`。
 */
export interface GalleryFieldProps {
	/** フィールドの値(`json`。どんな値も来うる) */
	readonly value: unknown;
	/** 新しい値(参照の配列)で呼ぶ */
	readonly onChange: (value: unknown) => void;
	/** フィールドの表示名 */
	readonly label: string;
	/**
	 * `field-<slug>`。アップロードの保存先のフィールドは、ここから求める(T23 の `useUploadTarget`)。
	 * ドロップゾーンのボタンの `id` にもする(編集画面の `?field=<slug>` は、この id の要素にフォーカスする)
	 */
	readonly id: string;
	/** 必須か(EmDash が渡す。この widget は使わない) */
	readonly required?: boolean | undefined;
	/** フィールド定義の `options`。`maxItems` などを `normalizeFieldOptions` で読む(仕様書 13.2) */
	readonly options?: unknown;
	/** フィールド定義の `validation`(EmDash が渡す。この widget は使わない) */
	readonly validation?: unknown;
	/** true なら、表示名と枚数を画面に出さない(読み上げには残す) */
	readonly minimal?: boolean | undefined;
	/** 処理に使う関数の差し替え(テスト用。EmDash は渡さない。T23 の `UploadDependencies`) */
	readonly dependencies?: UploadDependencies | undefined;
}

// ---------------------------------------------------------------------------
// 部品の中で使う型
// ---------------------------------------------------------------------------

/** 読み上げる文。同じ文が続いても読まれるよう、`id` を変えて中身の要素を作り直す */
interface Announcement {
	readonly id: number;
	readonly text: string;
}

/** ひと続きの処理。追加(ドロップゾーン)か、1 枚の差し替えか */
type BatchKind = "add" | "replace";

interface BatchState {
	readonly kind: BatchKind;
	/** 値に足した枚数(読み上げの「3 枚の画像を追加しました」) */
	readonly added: number;
}

/** 処理を終えた画像の注意(GIF など)。ひと続きの処理が終わっても、次の処理を始めるまで出しておく */
interface NoticeEntry {
	readonly key: string;
	readonly filename: string;
	readonly notices: readonly NoticeCode[];
}

/** 処理を始めた場所(処理が終わってキャンセルボタンが消えたとき、フォーカスを戻す先) */
type FocusOrigin = { readonly kind: "zone" } | { readonly kind: "replace"; readonly index: number };

/** 描画のあとでフォーカスを移す先 */
type FocusTarget =
	/** 何枚目かの見出し(0 から) */
	| { readonly kind: "title"; readonly index: number }
	/** 失敗したファイルのエラーの「閉じる」ボタン(フックの項目のキー) */
	| { readonly kind: "dismiss"; readonly key: string }
	| { readonly kind: "zone" };

interface PendingFocus {
	readonly target: FocusTarget;
	/**
	 * いつ移すか。`value`: 値が変わった描画のあと(onChange の結果を親が描き直してから)。
	 * `render`: 次の描画のあと(フックの状態の変化など)
	 */
	readonly when: "value" | "render";
	/** 求めたときの値(`value` のとき、これと違う値で描画されたら移す) */
	readonly from: unknown;
}

/** ドラッグで落とす位置(行のキーと、その前か後か) */
interface DropTarget {
	readonly key: string;
	readonly position: "before" | "after";
}

const IDLE_BATCH: BatchState = { kind: "add", added: 0 };
const NO_ENTRIES: readonly GalleryEntry[] = [];
const NO_NOTICES: readonly NoticeCode[] = [];

// ---------------------------------------------------------------------------
// widget
// ---------------------------------------------------------------------------

/** ギャラリーの widget。管理画面の入口(T30)が `fields.gallery` に登録する */
export function GalleryField({
	value,
	onChange,
	label,
	id,
	options,
	minimal = false,
	dependencies,
}: GalleryFieldProps) {
	const t = useMessages(messages);
	const baseId = useId();
	const labelId = `${baseId}-label`;

	const { maxItems } = normalizeFieldOptions(options);
	const gallery = useMemo(() => readGalleryValue(value), [value]);
	const entries = gallery.kind === "list" ? gallery.entries : NO_ENTRIES;
	const count = entries.length;
	const imageIds = useMemo(
		() => entries.flatMap((entry) => (entry.kind === "image" ? [entry.ref.id] : [])),
		[entries],
	);
	const { previews, prime, retry } = usePreviewImages(imageIds);
	const target = useUploadTarget(id);

	const rootRef = useRef<HTMLDivElement>(null);
	const zoneButtonRef = useRef<HTMLButtonElement>(null);
	const cancelButtonRef = useRef<HTMLButtonElement>(null);
	/** 最新の値。onChange で送った値は、親が描き直す前からここに入れる(続けて届くアップロードを後ろに足すため) */
	const valueRef = useRef<unknown>(value);
	/** 最後に描画した props の値。これが変わったときだけ `valueRef` を props に合わせる */
	const renderedValueRef = useRef<unknown>(value);
	/** 差し替えのファイルと、差し替える画像の ID */
	const replaceTargetsRef = useRef(new Map<File, string>());
	const originRef = useRef<FocusOrigin>({ kind: "zone" });
	const pendingFocusRef = useRef<PendingFocus | null>(null);
	const wasBusyRef = useRef(false);
	const announceSeqRef = useRef(0);
	const noticeSeqRef = useRef(0);
	/** ドラッグしている行のキー(この widget の中で始まったドラッグだけを受け付ける) */
	const dragKeyRef = useRef<string | null>(null);
	const dropTargetRef = useRef<DropTarget | null>(null);

	const [announcement, setAnnouncement] = useState<Announcement | null>(null);
	const [batch, setBatch] = useState<BatchState>(IDLE_BATCH);
	const [batchNotices, setBatchNotices] = useState<readonly NoticeEntry[]>([]);
	const [dragKey, setDragKey] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

	/** 非同期の処理(アップロードの完了)から読む、最後に描画したときの値 */
	const latestRef = useRef({ onChange, t, prime, items: [] as readonly UploadQueueItem[] });

	const commit = useCallback((next: readonly unknown[]) => {
		const copy = [...next];
		valueRef.current = copy;
		latestRef.current.onChange(copy);
	}, []);

	const announce = useCallback((text: string) => {
		announceSeqRef.current += 1;
		setAnnouncement({ id: announceSeqRef.current, text });
	}, []);

	const requestFocus = useCallback((focusTarget: FocusTarget, when: PendingFocus["when"]) => {
		pendingFocusRef.current = { target: focusTarget, when, from: renderedValueRef.current };
	}, []);

	/** アップロードが 1 枚終わるたびに呼ばれる(フックが続けて呼ぶので、値は `valueRef` から読む) */
	const handleUploaded = useCallback(
		(image: UploadedImage, file: File) => {
			const latest = latestRef.current;
			const replacedId = replaceTargetsRef.current.get(file);
			replaceTargetsRef.current.delete(file);
			// 手元の data URL を表示する(プレビューを取得しない)。値に入れる前に登録する
			latest.prime(image.ref.id, image.entry);
			if (image.notices.length > 0) {
				noticeSeqRef.current += 1;
				const entry: NoticeEntry = {
					key: `notice-${noticeSeqRef.current}`,
					filename: file.name,
					notices: image.notices,
				};
				setBatchNotices((previous) => [...previous, entry]);
			}
			const current = readGalleryValue(valueRef.current);
			const list = current.kind === "list" ? current : EMPTY_LIST;
			if (replacedId !== undefined) {
				const index = list.entries.findIndex(
					(entry) => entry.kind === "image" && entry.ref.id === replacedId,
				);
				const replaced = list.entries[index];
				if (replaced !== undefined && replaced.kind === "image") {
					// ref.locale は画像エントリのロケールなので書き換えない。代替テキストは空にする
					// (前の画像の説明を、新しい画像に黙って残さない。T27 の単一画像の widget と同じ)
					const next = [...list.elements];
					next[index] = { ...image.ref, alt: "" };
					commit(next);
					originRef.current = { kind: "replace", index };
					announce(latest.t.replaced(index + 1));
					return;
				}
			}
			// 差し替える画像が無くなっていたら(値が外から変わったとき)、後ろに足す。アップロードした画像を捨てない
			commit([...list.elements, { ...image.ref, alt: "" }]);
			setBatch((previous) => ({ ...previous, added: previous.added + 1 }));
		},
		[announce, commit],
	);

	const queue = useUploadQueue({ target, options, onUploaded: handleUploaded, dependencies });
	const { enqueue, remove: removeQueued, cancelAll, clearErrors } = queue;
	const busy = queue.busy;

	// 描画が確定したら、非同期の処理が読む値を入れる。値は props が変わったときだけ合わせる
	// (自分の状態だけが変わった描画では、送ったばかりの値を古い props で上書きしない)
	useLayoutEffect(() => {
		latestRef.current = { onChange, t, prime, items: queue.items };
		if (value !== renderedValueRef.current) {
			renderedValueRef.current = value;
			valueRef.current = value;
		}
	});

	/** 候補のうち、最初にフォーカスできるもの(つながっていて、`disabled` でない)にフォーカスする */
	const focusFirst = useCallback((candidates: readonly (HTMLElement | null)[]) => {
		for (const candidate of candidates) {
			if (candidate === null || !candidate.isConnected || isDisabled(candidate)) continue;
			candidate.focus();
			return;
		}
	}, []);

	const lastTitle = useCallback(() => {
		const titles = rootRef.current?.querySelectorAll<HTMLElement>("[data-gallery-title]");
		return titles === undefined || titles.length === 0 ? null : (titles[titles.length - 1] ?? null);
	}, []);

	const resolveFocusTarget = useCallback(
		(focusTarget: FocusTarget): HTMLElement | null => {
			if (focusTarget.kind === "title") {
				return document.getElementById(titleIdOf(baseId, focusTarget.index));
			}
			if (focusTarget.kind === "dismiss") {
				const box = document.getElementById(errorIdOf(baseId, focusTarget.key));
				return box?.querySelector("button") ?? null;
			}
			return zoneButtonRef.current;
		},
		[baseId],
	);

	// 描画のあとで、求めておいたフォーカスを移す(処理の開始・終了のフォーカスより先に行う)
	useLayoutEffect(() => {
		const pending = pendingFocusRef.current;
		if (pending === null) return;
		if (pending.when === "value" && pending.from === value) return;
		pendingFocusRef.current = null;
		focusFirst([resolveFocusTarget(pending.target), zoneButtonRef.current, lastTitle()]);
	});

	// この widget の中で最後にフォーカスを受けた要素(T27 と同じく、根の focusin で覚える。根の onFocus は oxlint の
	// jsx-a11y が拒む)。処理の開始と終了で、その要素が無効になった・消えたときだけフォーカスを移す
	const lastFocusedRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		const root = rootRef.current;
		if (root === null) return undefined;
		const remember = (event: FocusEvent): void => {
			if (event.target instanceof HTMLElement) lastFocusedRef.current = event.target;
		};
		root.addEventListener("focusin", remember);
		return () => root.removeEventListener("focusin", remember);
	}, []);

	// 処理を始めたら、押したボタン(処理中は押せない)からキャンセルボタンへ移す。処理が終わってキャンセルボタンが
	// 消えたら、処理を始めた場所へ戻す。ほかの場所(代替テキスト・ほかのフィールド)にフォーカスがあれば動かさない。
	// ファイルをマウスでドロップしただけ(この widget にフォーカスが無かった)なら、処理を始めても動かさない
	useLayoutEffect(() => {
		const wasBusy = wasBusyRef.current;
		wasBusyRef.current = busy;
		if (busy === wasBusy || !isFocusLost(lastFocusedRef.current)) return;
		if (busy) {
			focusFirst([cancelButtonRef.current]);
			return;
		}
		const origin = originRef.current;
		focusFirst([
			origin.kind === "replace" ? document.getElementById(replaceIdOf(baseId, origin.index)) : null,
			zoneButtonRef.current,
			lastTitle(),
		]);
	}, [busy, baseId, focusFirst, lastTitle]);

	// ---- 値の変更(どれも最新の値 `valueRef` から作る) ----

	/** 最新の値の配列。配列でない値のときは null(変更しない) */
	const currentList = (): GalleryList | null => {
		const current = readGalleryValue(valueRef.current);
		return current.kind === "list" ? current : null;
	};

	/**
	 * `key` の行を `toOf(今の位置, 最新の値)` の位置に動かす。フォーカスは動かさない(行の要素が動いて外れても、
	 * React DOM がコミットのあとでフォーカスのあった要素に戻す)
	 */
	const moveTo = (key: string, toOf: (from: number, list: GalleryList) => number) => {
		const list = currentList();
		if (list === null) return;
		const from = list.entries.findIndex((entry) => entry.key === key);
		if (from === -1) return;
		const to = toOf(from, list);
		// 範囲の外: 親が値をまだ描き直していない間に、同じ行のボタンをもう一度押したときなど
		if (to < 0 || to >= list.elements.length || to === from) return;
		const next = moveElement(list.elements, from, to);
		commit(next);
		announce(t.moved(from + 1, to + 1, next.length));
	};

	const handleMove = (key: string, delta: -1 | 1) => {
		moveTo(key, (from) => from + delta);
	};

	/** 差し替えを待っているファイルを取り消す(差し替える画像を消したとき) */
	const cancelReplacementsOf = (imageId: string) => {
		for (const [file, replacedId] of replaceTargetsRef.current) {
			if (replacedId !== imageId) continue;
			replaceTargetsRef.current.delete(file);
			const item = latestRef.current.items.find(
				(queued) => queued.file === file && queued.state.status !== "error",
			);
			if (item !== undefined) removeQueued(item.key);
		}
	};

	const handleRemove = (key: string) => {
		const list = currentList();
		if (list === null) return;
		const index = list.entries.findIndex((entry) => entry.key === key);
		const entry = list.entries[index];
		if (entry === undefined) return;
		if (entry.kind === "image") cancelReplacementsOf(entry.ref.id);
		const next = list.elements.filter((_element, position) => position !== index);
		// 同じ位置の(次の)画像、最後の画像を消したら前の画像、無くなったらドロップゾーンへ
		requestFocus(
			next.length === 0
				? { kind: "zone" }
				: { kind: "title", index: Math.min(index, next.length - 1) },
			"value",
		);
		commit(next);
		announce(t.removed(index + 1, next.length));
	};

	const handleAltChange = (key: string, alt: string) => {
		const list = currentList();
		if (list === null) return;
		const index = list.entries.findIndex((entry) => entry.key === key);
		const entry = list.entries[index];
		if (entry === undefined || entry.kind !== "image") return;
		const next = [...list.elements];
		next[index] = { ...entry.ref, alt };
		commit(next);
	};

	/** ひと続きの処理を始める。前の処理のエラーと注意は消す */
	const startBatch = (kind: BatchKind, origin: FocusOrigin) => {
		clearErrors();
		replaceTargetsRef.current.clear();
		originRef.current = origin;
		setBatch({ kind, added: 0 });
		setBatchNotices([]);
	};

	const handleAddFiles = (files: File[]) => {
		// 配列でない値・処理中・上限に達したときは、ドロップゾーンが disabled なので呼ばれない(`busy` の確認は、
		// 下の `limit` が処理待ちを引かない前提のため)。編集ロック中は disabled にならないので、ここで止める
		const list = currentList();
		if (list === null || busy || isLocked(rootRef.current)) return;
		startBatch("add", { kind: "zone" });
		// 上限を超える分は、フックが処理せずに GALLERY_TOO_MANY_ITEMS の失敗にする(ファイルごとに出す。仕様書 11.3)
		enqueue(files, { limit: maxItems - list.entries.length });
	};

	const handleReplace = (key: string, files: File[]) => {
		const file = files[0];
		const list = currentList();
		if (file === undefined || list === null || busy || isLocked(rootRef.current)) return;
		const index = list.entries.findIndex((entry) => entry.key === key);
		const entry = list.entries[index];
		if (entry === undefined || entry.kind !== "image") return;
		startBatch("replace", { kind: "replace", index });
		replaceTargetsRef.current.set(file, entry.ref.id);
		enqueue([file], { limit: 1 });
	};

	const handleClear = () => {
		requestFocus({ kind: "zone" }, "value");
		commit([]);
		announce(t.cleared);
	};

	const handleUseSingle = (ref: Base64ImageRef) => {
		requestFocus({ kind: "title", index: 0 }, "value");
		commit([ref]);
		announce(t.converted);
	};

	const failed = failedItems(queue.items);

	const handleDismiss = (key: string) => {
		const index = failed.findIndex((item) => item.key === key);
		const neighbor = failed[index + 1] ?? failed[index - 1];
		requestFocus(
			neighbor === undefined ? { kind: "zone" } : { kind: "dismiss", key: neighbor.key },
			"render",
		);
		removeQueued(key);
	};

	const handleDismissAll = () => {
		requestFocus({ kind: "zone" }, "render");
		clearErrors();
	};

	const handleRetry = () => {
		requestFocus({ kind: "zone" }, "render");
		retry();
	};

	// ---- ドラッグ(HTML の Drag and Drop) ----

	const endDrag = () => {
		dragKeyRef.current = null;
		dropTargetRef.current = null;
		setDragKey(null);
		setDropTarget(null);
	};

	const handleDragStart = (key: string, event: DragEvent<HTMLElement>) => {
		// 編集ロック中は、つまみ(ボタンではないので fieldset で無効にならない)のドラッグを始めさせない
		if (isLocked(rootRef.current)) {
			event.preventDefault();
			return;
		}
		// Firefox は setData が無いとドラッグを始めない。種類で並べ替えのドラッグと分かるようにする
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData(GALLERY_DRAG_TYPE, key);
		dragKeyRef.current = key;
		setDragKey(key);
	};

	const updateDropTarget = (next: DropTarget | null) => {
		const previous = dropTargetRef.current;
		if (previous?.key === next?.key && previous?.position === next?.position) return;
		dropTargetRef.current = next;
		setDropTarget(next);
	};

	const handleListDragOver = (event: DragEvent<HTMLDivElement>) => {
		if (
			dragKeyRef.current === null ||
			!carriesGalleryItem(event.dataTransfer) ||
			isLocked(rootRef.current)
		) {
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		const row = findRow(event.target);
		// 行の間(隙間)では、直前の位置のままにする
		if (row === null) return;
		const rect = row.element.getBoundingClientRect();
		const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
		updateDropTarget({ key: row.key, position });
	};

	const handleListDragLeave = (event: DragEvent<HTMLDivElement>) => {
		if (dragKeyRef.current === null) return;
		const related = event.relatedTarget;
		if (related instanceof Node && event.currentTarget.contains(related)) return;
		updateDropTarget(null);
	};

	const handleListDrop = (event: DragEvent<HTMLDivElement>) => {
		const dragged = dragKeyRef.current;
		if (dragged === null || !carriesGalleryItem(event.dataTransfer)) return;
		event.preventDefault();
		const drop = dropTargetRef.current;
		endDrag();
		if (drop === null) return;
		moveTo(dragged, (from, list) => {
			const targetIndex = list.entries.findIndex((entry) => entry.key === drop.key);
			return targetIndex === -1 ? from : insertionIndex(from, targetIndex, drop.position);
		});
	};

	// ---- 表示 ----

	const pendingAdds = busy && batch.kind === "add" ? queue.pendingCount : 0;
	const remaining = Math.max(0, maxItems - count - pendingAdds);
	const canAdd = gallery.kind === "list" && !busy && remaining > 0;
	const progress = progressOf(queue);
	const currentState = queue.current?.state;
	const currentNotices =
		currentState === undefined || currentState.status === "decoding"
			? NO_NOTICES
			: currentState.notices;
	const previewError = firstPreviewError(imageIds, previews);
	const draggedIndex = dragKey === null ? -1 : entries.findIndex((entry) => entry.key === dragKey);

	let zoneDescription: ReactNode;
	if (gallery.kind === "unsupported") zoneDescription = t.unsupportedZone;
	else if (count > maxItems)
		zoneDescription = (
			<span className="text-kumo-danger">{t.over(maxItems, count - maxItems)}</span>
		);
	else if (count === maxItems) zoneDescription = t.full(maxItems);
	else zoneDescription = t.remaining(remaining, maxItems);

	// 根に gap と余白のクラスを付けない。読み上げ・注意・エラーの領域は常に描画し(読み上げの領域を先に DOM に置く。T22)、
	// 中身が無いと高さ 0 になる。grid の gap は高さ 0 の要素にも付き、フィールドの下に余白が残る(フィールドの間隔は
	// EmDash の space-y-6)。そのため、見えるものがあるときだけ上に mt-2 を付ける(T27 と同じ)
	return (
		<div ref={rootRef}>
			<div className={minimal ? "sr-only" : "flex flex-wrap items-baseline justify-between gap-2"}>
				<Label>
					<span id={labelId}>{label}</span>
				</Label>
				<span className="text-xs leading-4 text-kumo-subtle tabular-nums">
					{t.count(count, maxItems)}
				</span>
			</div>

			{/* 並べ替え・削除などの読み上げ。同じ文が続いても読まれるよう、中身の要素を作り直す */}
			<output aria-live="polite" className="sr-only">
				{announcement === null ? null : <span key={announcement.id}>{announcement.text}</span>}
			</output>

			{gallery.kind === "unsupported" ? (
				<div className="mt-2">
					<UnsupportedValue
						single={gallery.single}
						t={t}
						onClear={handleClear}
						onUseSingle={handleUseSingle}
					/>
				</div>
			) : null}

			{entries.length === 0 ? null : (
				// ドラッグの受け口は一覧を包む div に置く(行の間の隙間に落としても受け取る)
				<div
					className="mt-2"
					onDragOver={handleListDragOver}
					onDragLeave={handleListDragLeave}
					onDrop={handleListDrop}
				>
					<ul aria-labelledby={labelId} className="grid gap-2">
						{entries.map((entry, index) => (
							<GalleryRow
								key={entry.key}
								entry={entry}
								index={index}
								total={entries.length}
								preview={entry.kind === "image" ? previews.get(entry.ref.id) : undefined}
								titleId={titleIdOf(baseId, index)}
								replaceId={replaceIdOf(baseId, index)}
								busy={busy}
								dragging={entry.key === dragKey}
								indicator={indicatorOf(entry.key, index, draggedIndex, dropTarget)}
								t={t}
								onMove={handleMove}
								onRemove={handleRemove}
								onAltChange={handleAltChange}
								onReplace={handleReplace}
								onDragStart={handleDragStart}
								onDragEnd={endDrag}
							/>
						))}
					</ul>
				</div>
			)}

			<div className="mt-2">
				<ImageDropZone
					multiple
					id={id}
					label={label}
					disabled={!canAdd}
					description={zoneDescription}
					buttonRef={zoneButtonRef}
					onFiles={handleAddFiles}
				/>
			</div>

			{/* 進捗の行は処理中だけ見える。完了の枚数は、処理中でないときだけ読み上げられる(T22) */}
			<div className={progress === null ? undefined : "mt-2"}>
				<UploadProgress
					progress={progress}
					onCancel={cancelAll}
					completed={batch.added}
					cancelButtonRef={cancelButtonRef}
				/>
			</div>
			{batchNotices.map((entry) => (
				<div key={entry.key} className="mt-2">
					<UploadNotices notices={entry.notices} title={entry.filename} />
				</div>
			))}
			<div className={currentNotices.length === 0 ? undefined : "mt-2"}>
				<UploadNotices notices={currentNotices} title={queue.current?.file.name} />
			</div>
			<div className={previewError === null ? undefined : "mt-2"}>
				<ErrorMessage
					error={previewError}
					title={previewError === null ? undefined : t.previewFailedTitle}
				/>
			</div>
			{previewError === null ? null : (
				<div className="mt-2">
					<Button variant="secondary" size="sm" onClick={handleRetry}>
						{t.retry}
					</Button>
				</div>
			)}

			{/* 受け付けたファイルごとのエラー。処理を待っている間から領域を置いておく */}
			{queue.items.map((item) => (
				<div
					key={item.key}
					id={errorIdOf(baseId, item.key)}
					className={item.state.status === "error" ? "mt-2" : undefined}
				>
					<ErrorMessage
						error={item.state.status === "error" ? item.state.error : null}
						title={item.file.name}
						onDismiss={() => handleDismiss(item.key)}
					/>
				</div>
			))}
			{failed.length < 2 ? null : (
				<div className="mt-2">
					<Button variant="secondary" size="sm" onClick={handleDismissAll}>
						{t.dismissAll}
					</Button>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// 1 枚分の行
// ---------------------------------------------------------------------------

interface GalleryRowProps {
	readonly entry: GalleryEntry;
	/** 何枚目か(0 から) */
	readonly index: number;
	readonly total: number;
	/** プレビューの状態(画像の行だけ) */
	readonly preview: PreviewState | undefined;
	/** 見出しの id(削除のあとなどにフォーカスを移す) */
	readonly titleId: string;
	/** 差し替えのボタンの id(差し替えのあとでフォーカスを戻す) */
	readonly replaceId: string;
	/** 処理中(差し替えを押せない) */
	readonly busy: boolean;
	/** この行をドラッグしている */
	readonly dragging: boolean;
	/** ドラッグで落とす位置の線 */
	readonly indicator: DropTarget["position"] | null;
	readonly t: GalleryMessages;
	readonly onMove: (key: string, delta: -1 | 1) => void;
	readonly onRemove: (key: string) => void;
	readonly onAltChange: (key: string, alt: string) => void;
	readonly onReplace: (key: string, files: File[]) => void;
	readonly onDragStart: (key: string, event: DragEvent<HTMLElement>) => void;
	readonly onDragEnd: () => void;
}

function GalleryRow({
	entry,
	index,
	total,
	preview,
	titleId,
	replaceId,
	busy,
	dragging,
	indicator,
	t,
	onMove,
	onRemove,
	onAltChange,
	onReplace,
	onDragStart,
	onDragEnd,
}: GalleryRowProps) {
	const position = index + 1;
	const { key } = entry;
	const image = entry.kind === "image" ? entry : null;
	/** 画像が見つからない(「画像が見つかりません」の部品が、削除ボタンを持つ) */
	const missing = image !== null && preview?.status === "missing";
	/** 表示と編集ができる画像(読み込み中・読み込めなかった画像を含む) */
	const editable = image !== null && !missing ? image : null;
	const loaded = preview?.status === "loaded" ? preview.image : undefined;
	const noteId = `${titleId}-note`;
	let note: string | null = null;
	if (entry.kind === "invalid") note = t.invalidDetail;
	else if (entry.duplicateOf !== undefined) note = t.duplicate(entry.duplicateOf);

	let thumbnail: ReactNode = null;
	if (entry.kind === "invalid") {
		thumbnail = (
			<div className={SMALL_BOX_CLASS} style={SMALL_BOX_STYLE}>
				<WarningIcon size={20} />
				<span className="text-xs leading-4">{t.invalid}</span>
			</div>
		);
	} else if (editable !== null) {
		thumbnail = (
			<div style={PASS_THROUGH_STYLE}>
				{preview?.status === "error" ? (
					<div className={SMALL_BOX_CLASS} style={SMALL_BOX_STYLE}>
						<WarningIcon size={20} />
						<span className="text-xs leading-4">{t.previewFailed}</span>
					</div>
				) : (
					<ImagePreview
						size="small"
						src={loaded?.src}
						width={editable.ref.width}
						height={editable.ref.height}
					/>
				)}
			</div>
		);
	}

	// 要素の並びは、どの状態でも同じにする(プレビューの状態が変わっても、↑↓ などのボタンを作り直さない)
	return (
		<li
			className={dragging ? `${ROW_CLASS} opacity-50` : ROW_CLASS}
			style={
				indicator === "before"
					? DROP_BEFORE_STYLE
					: indicator === "after"
						? DROP_AFTER_STYLE
						: undefined
			}
			data-gallery-key={key}
		>
			<div
				draggable
				className={HANDLE_CLASS}
				title={t.dragHint}
				data-gallery-handle=""
				onDragStart={(event) => onDragStart(key, event)}
				onDragEnd={onDragEnd}
			>
				<span className="pt-1">
					<GripIcon />
				</span>
				{thumbnail}
			</div>
			{missing ? (
				<ImageNotFound
					size="small"
					removeLabel={t.removeLabel(position)}
					onRemove={() => onRemove(key)}
				/>
			) : null}
			<div className="grid min-w-0 flex-1 content-start gap-2">
				<div className="flex flex-wrap items-baseline gap-2">
					<p id={titleId} tabIndex={-1} data-gallery-title="" className="text-sm font-medium">
						{t.item(position)}
					</p>
					{editable === null ? null : (
						<ImageInfo
							width={editable.ref.width}
							height={editable.ref.height}
							storedBytes={loaded?.src.length}
							quality={loaded?.meta.quality}
						/>
					)}
				</div>
				{note === null ? null : (
					<p
						id={noteId}
						className={
							entry.kind === "invalid" ? HELP_TEXT_CLASS : "text-xs leading-4 text-kumo-danger"
						}
					>
						{note}
					</p>
				)}
				{editable === null ? null : (
					<AltTextInput
						itemLabel={t.item(position)}
						value={editable.ref.alt}
						onChange={(alt) => onAltChange(key, alt)}
					/>
				)}
				<div className="flex flex-wrap items-center gap-2">
					<MoveButton
						text={t.moveUp}
						label={t.moveUpLabel(position)}
						inert={index === 0}
						onPress={() => onMove(key, -1)}
					/>
					<MoveButton
						text={t.moveDown}
						label={t.moveDownLabel(position)}
						inert={index === total - 1}
						onPress={() => onMove(key, 1)}
					/>
					{editable === null ? null : (
						<FileSelectButton
							id={replaceId}
							aria-label={t.replaceLabel(position)}
							disabled={busy}
							onFiles={(files) => onReplace(key, files)}
						>
							{t.replace}
						</FileSelectButton>
					)}
					{missing ? null : (
						<Button
							variant="secondary-destructive"
							size="sm"
							aria-label={t.removeLabel(position)}
							aria-describedby={note === null ? undefined : noteId}
							onClick={() => onRemove(key)}
						>
							{t.remove}
						</Button>
					)}
				</div>
			</div>
		</li>
	);
}

interface MoveButtonProps {
	readonly text: string;
	readonly label: string;
	/**
	 * 端の画像(それ以上動かせない)。フォーカスのあるボタンを `disabled` にすると、次の描画でフォーカスが外れる
	 * (↓ を押し続けて末尾に着いたとき)ので、`aria-disabled` にして何もしない
	 */
	readonly inert: boolean;
	readonly onPress: () => void;
}

function MoveButton({ text, label, inert, onPress }: MoveButtonProps) {
	return (
		<Button
			variant="secondary"
			size="sm"
			shape="square"
			aria-label={label}
			{...(inert ? { "aria-disabled": true, className: INERT_BUTTON_CLASS } : {})}
			onClick={() => {
				if (!inert) onPress();
			}}
		>
			{text}
		</Button>
	);
}

interface UnsupportedValueProps {
	readonly single: Base64ImageRef | null;
	readonly t: GalleryMessages;
	readonly onClear: () => void;
	readonly onUseSingle: (ref: Base64ImageRef) => void;
}

/** 配列でない値のときの案内と、直すボタン */
function UnsupportedValue({ single, t, onClear, onUseSingle }: UnsupportedValueProps) {
	return (
		<div className="grid gap-2 rounded-lg border bg-kumo-tint p-3">
			<p className="text-sm text-kumo-default">
				{single === null ? t.unsupported : t.unsupportedSingle}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				{single === null ? null : (
					<Button variant="secondary" size="sm" onClick={() => onUseSingle(single)}>
						{t.useSingle}
					</Button>
				)}
				<Button variant="secondary-destructive" size="sm" onClick={onClear}>
					{t.clear}
				</Button>
			</div>
		</div>
	);
}

/** 6 つの点のつまみ(飾り。読み上げない) */
function GripIcon() {
	return (
		<svg
			width={16}
			height={16}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
			focusable="false"
		>
			<circle cx="9" cy="6" r="1.5" />
			<circle cx="15" cy="6" r="1.5" />
			<circle cx="9" cy="12" r="1.5" />
			<circle cx="15" cy="12" r="1.5" />
			<circle cx="9" cy="18" r="1.5" />
			<circle cx="15" cy="18" r="1.5" />
		</svg>
	);
}

// ---------------------------------------------------------------------------
// 補助
// ---------------------------------------------------------------------------

/** 何枚目か(0 から)の見出しの id。削除のあとなどに、同じ位置の画像へフォーカスを移すのに使う */
function titleIdOf(baseId: string, index: number): string {
	return `${baseId}-title-${index}`;
}

/** 何枚目か(0 から)の差し替えボタンの id */
function replaceIdOf(baseId: string, index: number): string {
	return `${baseId}-replace-${index}`;
}

/** 受け付けたファイル(フックの項目のキー)ごとのエラーの領域の id */
function errorIdOf(baseId: string, key: string): string {
	return `${baseId}-error-${key}`;
}

/** 処理中の表示(T22 の `UploadProgress`)。受け付けたときの判定の間(`current` が無い)も「読み込み中」として出す */
function progressOf(queue: UploadQueue): UploadProgressInfo | null {
	if (!queue.busy) return null;
	const index = queue.finishedCount + 1;
	const total = queue.finishedCount + queue.pendingCount;
	const current = queue.current;
	if (current === null) return { stage: "decoding", index, total };
	const state = current.state;
	return {
		stage: state.status,
		compress: state.status === "compressing" ? (state.progress ?? undefined) : undefined,
		filename: current.file.name,
		index,
		total,
	};
}

interface FailedItem {
	readonly key: string;
	readonly filename: string;
	readonly error: unknown;
}

/** 失敗したファイル(受け付けた順) */
function failedItems(items: readonly UploadQueueItem[]): FailedItem[] {
	const failures: FailedItem[] = [];
	for (const item of items) {
		if (item.state.status === "error") {
			failures.push({ key: item.key, filename: item.file.name, error: item.state.error });
		}
	}
	return failures;
}

/** プレビューの取得の失敗のうち最初のもの。無ければ null */
function firstPreviewError(
	ids: readonly string[],
	previews: ReadonlyMap<string, PreviewState>,
): unknown {
	for (const imageId of ids) {
		const state = previews.get(imageId);
		if (state?.status === "error") return state.error;
	}
	return null;
}

/** 行の `from` 番目を、`target` 番目の行の前か後に落としたときの、動かしたあとの位置 */
function insertionIndex(from: number, target: number, position: DropTarget["position"]): number {
	const insertion = position === "before" ? target : target + 1;
	return insertion > from ? insertion - 1 : insertion;
}

/** 落とす位置の線を出すか。動かない位置(自分の前後)には出さない */
function indicatorOf(
	key: string,
	index: number,
	draggedIndex: number,
	drop: DropTarget | null,
): DropTarget["position"] | null {
	if (drop === null || drop.key !== key || draggedIndex === -1) return null;
	return insertionIndex(draggedIndex, index, drop.position) === draggedIndex ? null : drop.position;
}

/** 並べ替えのドラッグか(ファイルや文字のドラッグではない) */
function carriesGalleryItem(transfer: DataTransfer | null): boolean {
	return transfer !== null && Array.from(transfer.types).includes(GALLERY_DRAG_TYPE);
}

/** イベントの対象を含む行。行の間の隙間などでは null */
function findRow(
	eventTarget: EventTarget | null,
): { readonly element: HTMLElement; readonly key: string } | null {
	if (!(eventTarget instanceof Element)) return null;
	const element = eventTarget.closest<HTMLElement>("[data-gallery-key]");
	const key = element?.dataset["galleryKey"];
	return element === null || key === undefined ? null : { element, key };
}

/** 押せない・入力できない要素か(`disabled` のボタンと、無効な fieldset の中のボタン・入力欄) */
function isDisabled(element: HTMLElement): boolean {
	return element.matches(":disabled");
}

/**
 * 編集ロック中か。EmDash 0.39.1 は、ほかの人が編集中のエントリでは、フィールドを `<fieldset disabled>` で包む
 * (`ContentEditor.tsx:1336`。widget に readOnly は渡さない)。ボタンと入力欄はブラウザが無効にするが、
 * ドロップゾーンの枠へのファイルのドロップと、つまみ(div)のドラッグは止まらないので、この widget が受け付けない
 */
function isLocked(root: HTMLElement | null): boolean {
	return root !== null && root.closest("fieldset:disabled") !== null;
}

/**
 * この widget の中のフォーカスが、表示の切り替えで失われたか。最後にフォーカスを受けた要素(`last`)が消えたか
 * `disabled` になり(処理中はドロップゾーンと差し替えを押せない)、フォーカスが body に戻った(か、その要素に残っている。
 * 無効になった要素からフォーカスが外れるのは次の描画の時点)とき。ほかの要素にフォーカスがあれば false(奪わない)
 */
function isFocusLost(last: HTMLElement | null): boolean {
	if (last === null || (last.isConnected && !isDisabled(last))) return false;
	const active = document.activeElement;
	return active === null || active === document.body || active === last;
}
