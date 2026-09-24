/**
 * 単一画像の widget(`base64-image:image`。仕様書 11.2)。
 *
 * EmDash 0.39.1 の管理画面は、フィールドの `widget` が `base64-image:image` のとき、管理画面の入口の `fields.image` を
 * `ImageFieldProps` の props で描く(`references/emdash/packages/admin/src/components/ContentEditor.tsx:1818-1843`)。
 * 登録は T30(`src/admin.tsx` の `export const fields = { image: ImageField, … }`)。使い方は tasks/T27-image-widget.md の「結果」。
 *
 * - 値(`json` フィールドのデータ)は、どんな形でもありうる(seed・手での書き換え)。`null` / `undefined` は画像なし、
 *   参照の形(`isBase64ImageRef`)は画像あり、それ以外は「値が正しくない」として表示し、削除ボタンで外せるようにする
 *   (参照の形でない値は、保存 hook が拒否する。仕様書 8 章③)。
 * - 処理と状態は T23 のフック(`./hooks`)、表示は T22 の部品(`./parts`)を使う。値を変えるのは、アップロードが成功したとき・
 *   代替テキストの入力・削除のときだけ。失敗とキャンセルでは値を変えない。
 * - 処理中は、進捗とキャンセルボタンだけを出す(仕様書 11.2 の「処理中」)。キャンセル・失敗のあとは、処理を始める前の表示に戻す。
 * - 差し替えた画像の代替テキストは空にする(ルートの応答の `alt` のまま)。前の画像の説明を、新しい画像に黙って残さないため。
 * - フォーカス: フォーカスのあった要素が表示の切り替えで消えたら(処理の開始と終了・削除・エラーを閉じる)、今の表示の主な要素へ移す。
 * - 編集ロック中は、EmDash がフィールドを `<fieldset disabled>` で包むので、ボタンと入力欄はブラウザが無効にする。
 *   枠へのドロップだけは届くので、ここで受け付けない。
 */

import { Button } from "@cloudflare/kumo";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";

import { defineMessages, useMessages } from "../client/i18n";
import type { NoticeCode } from "../shared/errors";
import { isBase64ImageRef } from "../shared/schema";
import type { Base64ImageRef } from "../shared/types";
import {
	isUploadPhase,
	useImageUpload,
	usePreviewImages,
	useUploadTarget,
	type ImageUploadState,
} from "./hooks";
import {
	AltTextInput,
	ErrorMessage,
	FileSelectButton,
	ImageDropZone,
	ImageInfo,
	ImageNotFound,
	ImagePreview,
	UploadNotices,
	UploadProgress,
	WarningIcon,
	type UploadProgressInfo,
} from "./parts";

const messages = defineMessages({
	ja: {
		replace: "差し替え",
		remove: "削除",
		invalidTitle: "画像の値が正しくありません",
		invalidDetail:
			"このフィールドの値は、画像の参照の形ではありません(seed や手での書き換えなど)。このままでは保存できないため、削除ボタンで外してから、画像を追加し直してください。",
		previewFailed: "プレビューを読み込めませんでした",
		retry: "再読み込み",
	},
	en: {
		replace: "Replace",
		remove: "Remove",
		invalidTitle: "Invalid image value",
		invalidDetail:
			"The value of this field is not an image reference (for example, it was seeded or edited by hand). The entry cannot be saved as it is, so remove it with the Remove button and add the image again.",
		previewFailed: "Could not load the preview",
		retry: "Retry",
	},
});

// 管理画面の CSS にあるクラスだけを使う(tests/admin/ImageField.test.tsx で確かめる)。
// 値が正しくないときの枠は、T22 の「画像が見つかりません」(`ImageNotFound`)の大きい枠と同じ見た目にした。
const INVALID_BOX_CLASS =
	"flex min-h-20 items-center justify-center gap-2 rounded-lg border bg-kumo-tint text-kumo-subtle";
const HELP_TEXT_CLASS = "text-xs leading-4 text-kumo-subtle";
const ACTIONS_CLASS = "flex flex-wrap items-center gap-2";

/**
 * EmDash の管理画面が plugin widget に渡す props(`ContentEditor.tsx:1818-1843`)。
 * `readOnly` は渡らない(編集ロックは、祖先の `<fieldset disabled>` で伝わる)。
 */
export interface ImageFieldProps {
	/** フィールドの値。参照の形とは限らない(seed や手での書き換え) */
	readonly value: unknown;
	/** 値を変える。参照(`Base64ImageRef`)か、画像を外すときは `null` を渡す */
	readonly onChange: (value: unknown) => void;
	/** フィールドの表示名 */
	readonly label: string;
	/** `field-<フィールドの slug>`(`ContentEditor.tsx:1791`)。アップロードの保存先を求めるのに使う */
	readonly id: string;
	/** フィールド定義の `options`(`maxStoredBytes` など)。`normalizeFieldOptions` で丸めて使う */
	readonly options?: unknown;
	/** 受け取るが使わない(必須の確認は EmDash の保存が行う) */
	readonly required?: boolean | undefined;
	/** 受け取るが使わない */
	readonly validation?: unknown;
	/** 受け取るが使わない(EmDash 0.39.1 は、plugin widget に値を渡さない) */
	readonly minimal?: boolean | undefined;
}

/** フィールドの値を読んだ結果 */
export type ImageFieldValue =
	/** 画像なし(`null` / `undefined`。保存 hook も「画像なし」として通す) */
	| { readonly kind: "empty" }
	/** 参照の形の値 */
	| { readonly kind: "image"; readonly ref: Base64ImageRef }
	/** 参照の形でない値(空文字・`{}`・キーの足りない参照など)。このままでは保存できない */
	| { readonly kind: "invalid" };

const EMPTY_VALUE: ImageFieldValue = { kind: "empty" };
const INVALID_VALUE: ImageFieldValue = { kind: "invalid" };

/** フィールドの値を読む。`null` / `undefined` は画像なし、参照の形は画像あり、ほかは正しくない値 */
export function readImageFieldValue(value: unknown): ImageFieldValue {
	if (value === null || value === undefined) return EMPTY_VALUE;
	return isBase64ImageRef(value) ? { kind: "image", ref: value } : INVALID_VALUE;
}

/** 主な表示。`busy` は処理中(進捗とキャンセルボタンだけ)、`missing` は参照先の画像が見つからない */
type FieldView = "busy" | "empty" | "image" | "missing" | "invalid";

const NO_IDS: readonly string[] = [];
const NO_NOTICES: readonly NoticeCode[] = [];

/** 処理中の段階を、T22 の `UploadProgress` の形にする。処理中でなければ null */
function progressOf(state: ImageUploadState, file: File | null): UploadProgressInfo | null {
	if (!isUploadPhase(state)) return null;
	return {
		stage: state.status,
		compress: state.status === "compressing" ? (state.progress ?? undefined) : undefined,
		filename: file?.name,
	};
}

/** 表示する注意(GIF は最初のフレームだけ、など)。処理中と、追加したあと */
function noticesOf(state: ImageUploadState): readonly NoticeCode[] {
	if (state.status === "done") return state.image.notices;
	if (isUploadPhase(state) && state.status !== "decoding") return state.notices;
	return NO_NOTICES;
}

/**
 * 編集ロック中か。EmDash 0.39.1 は、フィールドを `<fieldset disabled={readOnly}>` で包む(`ContentEditor.tsx:1336`)。
 * 無効な fieldset の中の fieldset は `:disabled` に当たる(HTML の「disabled fieldset」)。
 */
function isInsideDisabledFieldset(root: HTMLFieldSetElement | null): boolean {
	return root !== null && root.matches(":disabled");
}

/** 単一画像の widget */
export function ImageField({ value, onChange, label, id, options }: ImageFieldProps) {
	const t = useMessages(messages);
	const field = readImageFieldValue(value);
	const ref = field.kind === "image" ? field.ref : null;

	const target = useUploadTarget(id);
	const {
		state,
		file,
		busy,
		upload: uploadFile,
		cancel: cancelUpload,
		reset: resetUpload,
	} = useImageUpload({ target, options });
	const { previews, prime, retry } = usePreviewImages(ref === null ? NO_IDS : [ref.id]);
	const preview = ref === null ? undefined : previews.get(ref.id);
	const loaded = preview?.status === "loaded" ? preview.image : undefined;

	const view: FieldView = busy
		? "busy"
		: field.kind === "image"
			? preview?.status === "missing"
				? "missing"
				: "image"
			: field.kind;

	const rootRef = useRef<HTMLFieldSetElement>(null);
	const zoneRef = useRef<HTMLButtonElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const altRef = useRef<HTMLInputElement>(null);
	const replaceRef = useRef<HTMLButtonElement>(null);
	const missingRemoveRef = useRef<HTMLButtonElement>(null);
	const invalidRemoveRef = useRef<HTMLButtonElement>(null);
	const invalidTitleId = useId();
	const invalidDetailId = useId();

	const uploadAndApply = useCallback(
		async (selected: File) => {
			// reject しない。失敗は state に残って ErrorMessage が出し、中断は何もしない。どちらも値は変えない
			const outcome = await uploadFile(selected);
			if (outcome.status !== "done") return;
			const { ref: uploaded, entry } = outcome.image;
			// 手元の data URL を表示する(プレビューを取得し直さない)
			prime(uploaded.id, entry);
			// 応答の参照をそのまま値にする。`alt` は空、`locale` は画像エントリのロケール(編集中のエントリのものではない)
			onChange(uploaded);
		},
		[uploadFile, prime, onChange],
	);

	const handleFiles = useCallback(
		(files: File[]) => {
			const selected = files[0];
			if (selected === undefined || isInsideDisabledFieldset(rootRef.current)) return;
			void uploadAndApply(selected);
		},
		[uploadAndApply],
	);

	const remove = useCallback(() => {
		// 前のアップロードの注意・完了の読み上げ・エラーも消す
		resetUpload();
		onChange(null);
	}, [resetUpload, onChange]);

	const changeAlt = useCallback(
		(alt: string) => {
			if (ref !== null) onChange({ ...ref, alt });
		},
		[ref, onChange],
	);

	// フォーカスのあった要素が、表示の切り替えで消えたら(押したボタンが消える)、今の表示の主な要素へ移す。
	// 消えた要素にフォーカスがあったかは、最後にフォーカスを受けた要素が DOM から外れ、フォーカスが body に戻ったことで判断する
	// (要素が消えたときの blur / focusout はブラウザで違うので使わない)。ほかのフィールドにフォーカスがあれば動かさない。
	const lastFocusedRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		// fieldset は常に描画するので、最初に 1 回だけ登録する(fieldset への onFocus は oxlint の jsx-a11y が拒む)
		const root = rootRef.current;
		if (root === null) return undefined;
		const remember = (event: FocusEvent): void => {
			if (event.target instanceof HTMLElement) lastFocusedRef.current = event.target;
		};
		root.addEventListener("focusin", remember);
		return () => root.removeEventListener("focusin", remember);
	}, []);
	useLayoutEffect(() => {
		const last = lastFocusedRef.current;
		if (last === null || last.isConnected) return;
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		lastFocusedRef.current = null;
		const next =
			view === "busy"
				? cancelRef.current
				: view === "empty"
					? zoneRef.current
					: view === "missing"
						? missingRemoveRef.current
						: view === "invalid"
							? invalidRemoveRef.current
							: // 追加したばかりの画像は代替テキストへ。キャンセル・失敗・エラーを閉じたあとは差し替えのボタンへ
								state.status === "done"
								? altRef.current
								: replaceRef.current;
		next?.focus();
	});

	let main: ReactNode = null;
	if (view === "empty") {
		main = <ImageDropZone onFiles={handleFiles} label={label} buttonRef={zoneRef} />;
	} else if (view === "missing") {
		main = <ImageNotFound onRemove={remove} removeButtonRef={missingRemoveRef} />;
	} else if (view === "invalid") {
		main = (
			<div className="grid gap-2">
				<div className={INVALID_BOX_CLASS}>
					<WarningIcon size={24} />
					<p id={invalidTitleId} className="text-sm font-medium">
						{t.invalidTitle}
					</p>
				</div>
				<p id={invalidDetailId} className={HELP_TEXT_CLASS}>
					{t.invalidDetail}
				</p>
				<div className={ACTIONS_CLASS}>
					<Button
						ref={invalidRemoveRef}
						variant="secondary-destructive"
						size="sm"
						aria-describedby={`${invalidTitleId} ${invalidDetailId}`}
						onClick={remove}
					>
						{t.remove}
					</Button>
				</div>
			</div>
		);
	} else if (view === "image" && ref !== null) {
		main = (
			<div className="grid gap-2">
				{preview?.status === "error" ? (
					<div className="grid gap-2">
						<ErrorMessage error={preview.error} title={t.previewFailed} />
						<div className={ACTIONS_CLASS}>
							<Button variant="secondary" size="sm" onClick={retry}>
								{t.retry}
							</Button>
						</div>
					</div>
				) : (
					<ImagePreview src={loaded?.src} width={ref.width} height={ref.height} />
				)}
				<ImageInfo
					width={ref.width}
					height={ref.height}
					storedBytes={loaded?.src.length}
					quality={loaded?.meta.quality}
				/>
				<AltTextInput value={ref.alt} onChange={changeAlt} inputRef={altRef} />
				<div className={ACTIONS_CLASS}>
					<FileSelectButton onFiles={handleFiles} buttonRef={replaceRef}>
						{t.replace}
					</FileSelectButton>
					<Button variant="secondary-destructive" size="sm" onClick={remove}>
						{t.remove}
					</Button>
				</div>
			</div>
		);
	}

	const progress = progressOf(state, file);
	const notices = noticesOf(state);
	const failed = state.status === "error";

	return (
		// fieldset と legend で、中の入力欄とボタンをフィールドの表示名でまとめる(role="group" は oxlint が fieldset を求める)。
		// 余白・枠は管理画面の CSS の preflight が消している。`m-0` などを付けると、EmDash のフィールドの間隔(space-y-6)より強くなる
		<fieldset ref={rootRef} id={id} className="min-w-0">
			<legend className="text-base font-medium text-kumo-default">{label}</legend>
			{/*
			 * 進捗・注意・エラーの 3 つは常に描画する(読み上げの領域を先に DOM に置く。T22)。中身が無いときは高さ 0 だが、
			 * grid の gap は高さ 0 の要素にも付き、フィールドの下に余白が残る。そのため gap は使わず、見えるものがあるときだけ
			 * 上に余白を付ける。進捗は処理中だけ出て、そのとき上の表示(main)は無いので、余白は要らない
			 */}
			<div className="mt-2">
				{main}
				<UploadProgress
					progress={progress}
					onCancel={cancelUpload}
					completed={state.status === "done" ? 1 : 0}
					cancelButtonRef={cancelRef}
				/>
				<div className={notices.length === 0 ? undefined : "mt-2"}>
					<UploadNotices notices={notices} />
				</div>
				<div className={failed ? "mt-2" : undefined}>
					<ErrorMessage error={failed ? state.error : null} onDismiss={resetUpload} />
				</div>
			</div>
		</fieldset>
	);
}
