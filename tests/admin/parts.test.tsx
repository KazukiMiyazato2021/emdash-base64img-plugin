import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ERROR_MESSAGES, NOTICE_MESSAGES } from "../../src/client/error-messages";
import {
	AltTextInput,
	ErrorMessage,
	FileSelectButton,
	formatKilobytes,
	formatQuality,
	getPreviewDisplaySize,
	getTransferFiles,
	IMAGE_FILE_ACCEPT,
	ImageDropZone,
	ImageInfo,
	ImageNotFound,
	ImagePreview,
	isAbortError,
	longEdge,
	UPLOAD_STAGES,
	UploadNotices,
	UploadProgress,
	type UploadProgressInfo,
} from "../../src/admin/parts";
import { MAX_ALT_LENGTH } from "../../src/shared/constants";
import { Base64ImageError } from "../../src/shared/errors";
import { ADMIN_CSS, collectClassNames, findMissingClasses, sourceTokens } from "./admin-css";

// ---------------------------------------------------------------------------
// 共通の道具
// ---------------------------------------------------------------------------

beforeEach(() => {
	document.documentElement.lang = "ja";
});

/** 描画したあとで `<html lang>` を変える(MutationObserver の通知を待つ。docs/emdash-admin-locale-lang.md) */
async function changeLang(lang: string): Promise<void> {
	await act(async () => {
		document.documentElement.lang = lang;
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

/** `onFiles` のモック */
function filesHandler() {
	return vi.fn<(files: File[]) => void>();
}

/** `onChange(value)` のモック */
function textHandler() {
	return vi.fn<(value: string) => void>();
}

/** 引数の無いコールバック(`onCancel` / `onDismiss` / `onRemove`)のモック */
function callback() {
	return vi.fn<() => void>();
}

function imageFile(name = "photo.jpg", type = "image/jpeg"): File {
	return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type });
}

interface FakeTransferInit {
	readonly files?: readonly File[];
	/** 省略すると `files` から作る */
	readonly items?: readonly { kind: string; type: string; getAsFile: () => File | null }[];
	/** 省略すると、ファイルがあれば `["Files"]` */
	readonly types?: readonly string[];
}

/** jsdom には DataTransfer が無いので、部品が読むプロパティだけを持つ偽物を作る */
function fakeTransfer({ files = [], items, types }: FakeTransferInit = {}): DataTransfer {
	return {
		files: [...files],
		items: items ?? files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
		types: types ?? (files.length > 0 ? ["Files"] : []),
		dropEffect: "none",
	} as unknown as DataTransfer;
}

function getFileInput(container: HTMLElement): HTMLInputElement {
	const input = container.querySelector('input[type="file"]');
	if (!(input instanceof HTMLInputElement)) throw new Error("file input not found");
	return input;
}

/** ドロップゾーンの枠(ドラッグのイベントを受ける要素) */
function getZone(container: HTMLElement): HTMLElement {
	const button = within(container).getAllByRole("button")[0];
	const zone = button?.parentElement;
	if (!(zone instanceof HTMLElement)) throw new Error("zone not found");
	return zone;
}

// ---------------------------------------------------------------------------
// ImageDropZone
// ---------------------------------------------------------------------------

describe("ImageDropZone", () => {
	it("ボタン 1 つの入力欄で、名前にフィールドの表示名、説明に貼り付けの案内がある", () => {
		const { container } = render(<ImageDropZone onFiles={filesHandler()} label="カバー" />);

		const button = screen.getByRole("button", { name: "カバー: ファイルを選択" });
		expect(button).toHaveAttribute("type", "button");
		expect(button).toHaveAccessibleDescription(expect.stringContaining("Ctrl+V(Mac は ⌘V)"));
		expect(button).toHaveTextContent("画像をドロップ / 貼り付け");
		expect(screen.getAllByRole("button")).toHaveLength(1);

		const input = getFileInput(container);
		expect(input).toHaveAttribute("accept", "image/*");
		expect(input.multiple).toBe(false);
		// 画面にも、支援技術のツリーにも出さない(ボタンから開く)
		expect(input.hidden).toBe(true);
	});

	it("表示名が無いときは、ボタンの名前は「ファイルを選択」", () => {
		render(<ImageDropZone onFiles={filesHandler()} />);

		expect(screen.getByRole("button", { name: "ファイルを選択" })).toBeInTheDocument();
	});

	it("英語で表示し、言語が変わると文言が変わる", async () => {
		document.documentElement.lang = "en";
		render(<ImageDropZone onFiles={filesHandler()} label="Cover" />);

		const button = screen.getByRole("button", { name: "Cover: Select a file" });
		expect(button).toHaveTextContent("Drop or paste an image");
		expect(button).toHaveAccessibleDescription(expect.stringContaining("Ctrl+V (⌘V on Mac)"));

		await changeLang("ja");
		expect(screen.getByRole("button", { name: "Cover: ファイルを選択" })).toHaveTextContent(
			"画像をドロップ / 貼り付け",
		);
	});

	it("multiple では複数のファイルを選べ、文言に「複数可」が付く", () => {
		const { container } = render(<ImageDropZone onFiles={filesHandler()} multiple />);

		expect(screen.getByRole("button", { name: "ファイルを選択" })).toHaveTextContent(
			"画像をドロップ / 貼り付け(複数可)",
		);
		expect(getFileInput(container).multiple).toBe(true);
	});

	it("キーボードだけで、Tab で移って Enter / Space でファイルの選択を開ける", async () => {
		const user = userEvent.setup();
		const { container } = render(<ImageDropZone onFiles={filesHandler()} label="カバー" />);
		const click = vi.spyOn(getFileInput(container), "click").mockImplementation(() => {});

		await user.tab();
		expect(screen.getByRole("button", { name: "カバー: ファイルを選択" })).toHaveFocus();

		await user.keyboard("{Enter}");
		expect(click).toHaveBeenCalledTimes(1);
		await user.keyboard(" ");
		expect(click).toHaveBeenCalledTimes(2);
	});

	it("クリックで押されたときも、ボタンが自分でフォーカスを取る(ファイルの選択を閉じたあとに貼り付けられる)", () => {
		const { container } = render(<ImageDropZone onFiles={filesHandler()} />);
		const click = vi.spyOn(getFileInput(container), "click").mockImplementation(() => {});
		const button = screen.getByRole("button");

		// fireEvent.click はフォーカスを動かさない(クリックでボタンにフォーカスを移さない Safari などと同じ)
		fireEvent.click(button);

		expect(click).toHaveBeenCalledTimes(1);
		expect(button).toHaveFocus();
	});

	it("選んだファイルを onFiles に渡し、同じファイルを選び直せるよう入力欄の値を空にする", async () => {
		const user = userEvent.setup();
		const onFiles = filesHandler();
		const { container } = render(<ImageDropZone onFiles={onFiles} />);
		const input = getFileInput(container);
		const file = imageFile();

		await user.upload(input, file);

		expect(onFiles).toHaveBeenCalledTimes(1);
		expect(onFiles).toHaveBeenCalledWith([file]);
		expect(input.value).toBe("");
	});

	it("ファイルのドラッグ中は枠の色を変え、ドロップしたファイルを onFiles に渡す", () => {
		const onFiles = filesHandler();
		const { container } = render(<ImageDropZone onFiles={onFiles} />);
		const zone = getZone(container);
		const file = imageFile();
		const transfer = fakeTransfer({ files: [file] });

		expect(zone).toHaveClass("bg-kumo-control");
		expect(zone.style.borderColor).toBe("");

		// dragenter も止める(止めた要素がドロップ先になる。HTML のドラッグ・アンド・ドロップの処理モデル)
		expect(fireEvent.dragEnter(zone, { dataTransfer: transfer })).toBe(false);
		expect(zone).toHaveAttribute("data-dragging", "true");
		expect(zone).toHaveClass("bg-kumo-tint");
		// 枠の色はクラスでは付かない(管理画面の CSS の `*` の border-color が勝つ)ので、style で付ける
		expect(zone.style.borderColor).toBe("var(--color-kumo-brand)");

		// dragover を止めないと、ブラウザがファイルを開いて編集中のページから移動してしまう
		expect(fireEvent.dragOver(zone, { dataTransfer: transfer })).toBe(false);
		expect(transfer.dropEffect).toBe("copy");

		expect(fireEvent.drop(zone, { dataTransfer: transfer })).toBe(false);
		expect(onFiles).toHaveBeenCalledWith([file]);
		expect(zone).not.toHaveAttribute("data-dragging");
		expect(zone).toHaveClass("bg-kumo-control");
		expect(zone.style.borderColor).toBe("");
	});

	it("枠の中の要素に出入りしても、枠から出るまではドラッグ中の表示を保つ", () => {
		const { container } = render(<ImageDropZone onFiles={filesHandler()} />);
		const zone = getZone(container);
		const button = screen.getByRole("button");
		const transfer = fakeTransfer({ files: [imageFile()] });

		fireEvent.dragEnter(zone, { dataTransfer: transfer });
		fireEvent.dragEnter(button, { dataTransfer: transfer });
		fireEvent.dragLeave(zone, { dataTransfer: transfer });
		expect(zone).toHaveAttribute("data-dragging", "true");

		fireEvent.dragLeave(button, { dataTransfer: transfer });
		expect(zone).not.toHaveAttribute("data-dragging");
	});

	it("ファイルでないもの(文字列)のドラッグは受け付けない", () => {
		const onFiles = filesHandler();
		const { container } = render(<ImageDropZone onFiles={onFiles} />);
		const zone = getZone(container);
		const transfer = fakeTransfer({ types: ["text/plain"] });

		fireEvent.dragEnter(zone, { dataTransfer: transfer });
		expect(zone).not.toHaveAttribute("data-dragging");
		expect(fireEvent.dragOver(zone, { dataTransfer: transfer })).toBe(true);
		fireEvent.drop(zone, { dataTransfer: transfer });
		expect(onFiles).not.toHaveBeenCalled();
	});

	it("画像以外のファイルもそのまま渡す(形式の判定はアップロードの処理が行い、HEIC などに案内を出す)", () => {
		const onFiles = filesHandler();
		const { container } = render(<ImageDropZone onFiles={onFiles} />);
		const heic = imageFile("IMG_0001.HEIC", "image/heic");
		const text = new File(["hello"], "memo.txt", { type: "text/plain" });

		fireEvent.drop(getZone(container), { dataTransfer: fakeTransfer({ files: [heic] }) });
		fireEvent.drop(getZone(container), { dataTransfer: fakeTransfer({ files: [text] }) });

		expect(onFiles.mock.calls).toEqual([[[heic]], [[text]]]);
	});

	it("単一画像で複数のファイルをドロップすると、onFiles を呼ばずに「1 枚ずつ」と知らせる", async () => {
		const user = userEvent.setup();
		const onFiles = filesHandler();
		const { container } = render(<ImageDropZone onFiles={onFiles} />);
		const zone = getZone(container);
		vi.spyOn(getFileInput(container), "click").mockImplementation(() => {});

		fireEvent.drop(zone, {
			dataTransfer: fakeTransfer({ files: [imageFile("a.jpg"), imageFile("b.jpg")] }),
		});
		expect(onFiles).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toHaveTextContent("画像は 1 枚ずつ追加してください。");

		// 次に受け取れたら、知らせを消す
		const file = imageFile("c.jpg");
		fireEvent.drop(zone, { dataTransfer: fakeTransfer({ files: [file] }) });
		expect(onFiles).toHaveBeenCalledWith([file]);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();

		// ファイルの選択を開いたときも消す
		fireEvent.drop(zone, {
			dataTransfer: fakeTransfer({ files: [imageFile("a.jpg"), imageFile("b.jpg")] }),
		});
		expect(screen.getByRole("alert")).toBeInTheDocument();
		await user.click(screen.getByRole("button"));
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("ギャラリー(multiple)では、複数のファイルをまとめて渡す", () => {
		const onFiles = filesHandler();
		const { container } = render(<ImageDropZone onFiles={onFiles} multiple />);
		const files = [
			imageFile("a.jpg"),
			imageFile("b.png", "image/png"),
			imageFile("c.gif", "image/gif"),
		];

		fireEvent.drop(getZone(container), { dataTransfer: fakeTransfer({ files }) });

		expect(onFiles).toHaveBeenCalledWith(files);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("ボタンにフォーカスがある状態の貼り付けで、クリップボードのファイルを受け取る", async () => {
		const user = userEvent.setup();
		const onFiles = filesHandler();
		render(<ImageDropZone onFiles={onFiles} label="カバー" />);
		const file = imageFile("image.png", "image/png");

		await user.tab();
		const button = screen.getByRole("button", { name: "カバー: ファイルを選択" });
		expect(button).toHaveFocus();
		const notPrevented = fireEvent.paste(button, {
			clipboardData: fakeTransfer({ files: [file] }),
		});

		expect(onFiles).toHaveBeenCalledWith([file]);
		expect(notPrevented).toBe(false);
	});

	it("貼り付けが body に届くブラウザでも、フォーカスが枠の中なら受け取る", () => {
		const onFiles = filesHandler();
		render(<ImageDropZone onFiles={onFiles} />);
		const file = imageFile("image.png", "image/png");

		screen.getByRole("button").focus();
		fireEvent.paste(document.body, { clipboardData: fakeTransfer({ files: [file] }) });

		expect(onFiles).toHaveBeenCalledWith([file]);
	});

	it("イベントの対象が枠の中なら、フォーカスが外にあっても受け取る(選択範囲のある要素に届けるブラウザのため)", () => {
		const onFiles = filesHandler();
		const { container } = render(
			<div>
				<ImageDropZone onFiles={onFiles} />
				<button type="button">ほかのボタン</button>
			</div>,
		);
		const file = imageFile("image.png", "image/png");

		screen.getByRole("button", { name: "ほかのボタン" }).focus();
		fireEvent.paste(getZone(container), { clipboardData: fakeTransfer({ files: [file] }) });

		expect(onFiles).toHaveBeenCalledWith([file]);
	});

	it("`files` が空で `items` にだけファイルがある貼り付けも受け取る", () => {
		const onFiles = filesHandler();
		render(<ImageDropZone onFiles={onFiles} />);
		const file = imageFile("image.png", "image/png");
		const clipboardData = fakeTransfer({
			items: [
				{ kind: "string", type: "text/html", getAsFile: () => null },
				{ kind: "file", type: "image/png", getAsFile: () => file },
			],
			types: ["Files", "text/html"],
		});

		screen.getByRole("button").focus();
		fireEvent.paste(screen.getByRole("button"), { clipboardData });

		expect(onFiles).toHaveBeenCalledWith([file]);
	});

	it("ファイルの種類があるのに取り出せない貼り付けは、「読み取れませんでした」と知らせる", async () => {
		const onFiles = filesHandler();
		render(<ImageDropZone onFiles={onFiles} />);
		// Firefox 155(ヘッドレス)の実測と同じ形: types は Files、files は空、items の getAsFile は null
		const unreadable = fakeTransfer({
			items: [{ kind: "file", type: "image/png", getAsFile: () => null }],
			types: ["Files"],
		});

		screen.getByRole("button").focus();
		expect(fireEvent.paste(document.body, { clipboardData: unreadable })).toBe(false);

		expect(onFiles).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"クリップボードの画像を読み取れませんでした。ファイルを選択するか、画像をドロップしてください。",
		);

		await changeLang("en");
		expect(screen.getByRole("alert")).toHaveTextContent(
			"The image on the clipboard could not be read. Select a file or drop the image instead.",
		);

		// 次に受け取れたら、知らせを消す
		const file = imageFile("image.png", "image/png");
		fireEvent.paste(screen.getByRole("button"), { clipboardData: fakeTransfer({ files: [file] }) });
		expect(onFiles).toHaveBeenCalledWith([file]);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("文字だけの貼り付けと、フォーカスが枠の外にあるときの貼り付けは無視する", () => {
		const onFiles = filesHandler();
		render(
			<div>
				<ImageDropZone onFiles={onFiles} />
				<button type="button">ほかのボタン</button>
			</div>,
		);
		const zoneButton = screen.getByRole("button", { name: "ファイルを選択" });
		const other = screen.getByRole("button", { name: "ほかのボタン" });

		zoneButton.focus();
		const textOnly = fakeTransfer({
			items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
			types: ["text/plain"],
		});
		expect(fireEvent.paste(zoneButton, { clipboardData: textOnly })).toBe(true);

		other.focus();
		const withFile = fakeTransfer({ files: [imageFile()] });
		expect(fireEvent.paste(other, { clipboardData: withFile })).toBe(true);
		expect(fireEvent.paste(document.body, { clipboardData: withFile })).toBe(true);

		expect(onFiles).not.toHaveBeenCalled();
	});

	it("disabled のときは、ボタンを押せず、ドロップ・貼り付けも受け取らない(ドロップの既定の動作は止める)", () => {
		const onFiles = filesHandler();
		const { container } = render(<ImageDropZone onFiles={onFiles} disabled />);
		const zone = getZone(container);
		const button = screen.getByRole("button");
		const transfer = fakeTransfer({ files: [imageFile()] });

		expect(button).toBeDisabled();
		expect(getFileInput(container)).toBeDisabled();

		fireEvent.dragEnter(zone, { dataTransfer: transfer });
		expect(zone).not.toHaveAttribute("data-dragging");
		expect(zone.style.borderColor).toBe("");
		expect(fireEvent.dragOver(zone, { dataTransfer: transfer })).toBe(false);
		expect(transfer.dropEffect).toBe("none");
		expect(fireEvent.drop(zone, { dataTransfer: transfer })).toBe(false);

		// 貼り付けは監視しない(既定の動作も止めない)
		expect(fireEvent.paste(zone, { clipboardData: transfer })).toBe(true);
		const unreadable = fakeTransfer({
			items: [{ kind: "file", type: "image/png", getAsFile: () => null }],
			types: ["Files"],
		});
		expect(fireEvent.paste(zone, { clipboardData: unreadable })).toBe(true);
		expect(onFiles).not.toHaveBeenCalled();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("補足の文を枠の下に出し、ボタンの説明にも含める", () => {
		render(<ImageDropZone onFiles={filesHandler()} multiple description="あと 3 枚追加できます" />);

		expect(screen.getByText("あと 3 枚追加できます")).toBeVisible();
		expect(screen.getByRole("button")).toHaveAccessibleDescription(
			expect.stringContaining("あと 3 枚追加できます"),
		);
	});

	it("buttonRef と id をボタンに渡す(処理のあとでフォーカスを戻せる)", () => {
		const ref = createRef<HTMLButtonElement>();
		render(<ImageDropZone onFiles={filesHandler()} id="field-cover" buttonRef={ref} />);

		expect(ref.current).toBe(screen.getByRole("button"));
		expect(ref.current).toHaveAttribute("id", "field-cover");
		ref.current?.focus();
		expect(screen.getByRole("button")).toHaveFocus();
	});

	it("アンマウントすると、document の貼り付けの監視をやめる", () => {
		const add = vi.spyOn(document, "addEventListener");
		const remove = vi.spyOn(document, "removeEventListener");
		const { unmount } = render(<ImageDropZone onFiles={filesHandler()} />);
		const pasteListeners = add.mock.calls.filter(([type]) => type === "paste").map(([, fn]) => fn);
		expect(pasteListeners.length).toBeGreaterThan(0);

		unmount();

		const removed = remove.mock.calls.filter(([type]) => type === "paste").map(([, fn]) => fn);
		expect(removed).toEqual(expect.arrayContaining(pasteListeners));
		add.mockRestore();
		remove.mockRestore();
	});
});

describe("getTransferFiles", () => {
	it("files を優先し、無ければ items のファイルを使う。null なら空", () => {
		const a = imageFile("a.jpg");
		const b = imageFile("b.jpg");

		expect(getTransferFiles(null)).toEqual([]);
		expect(getTransferFiles(undefined)).toEqual([]);
		expect(getTransferFiles(fakeTransfer({ files: [a] }))).toEqual([a]);
		expect(
			getTransferFiles(
				fakeTransfer({
					items: [
						{ kind: "file", type: "image/jpeg", getAsFile: () => b },
						{ kind: "file", type: "image/jpeg", getAsFile: () => null },
						{ kind: "string", type: "text/plain", getAsFile: () => null },
					],
				}),
			),
		).toEqual([b]);
	});
});

// ---------------------------------------------------------------------------
// FileSelectButton
// ---------------------------------------------------------------------------

describe("FileSelectButton", () => {
	it("押す(Enter)とファイルの選択を開き、選んだファイルを onFiles に渡す", async () => {
		const user = userEvent.setup();
		const onFiles = filesHandler();
		const { container } = render(<FileSelectButton onFiles={onFiles}>差し替え</FileSelectButton>);
		const input = getFileInput(container);
		const click = vi.spyOn(input, "click").mockImplementation(() => {});
		const file = imageFile();

		await user.tab();
		expect(screen.getByRole("button", { name: "差し替え" })).toHaveFocus();
		await user.keyboard("{Enter}");
		expect(click).toHaveBeenCalledTimes(1);

		await user.upload(input, file);
		expect(onFiles).toHaveBeenCalledWith([file]);
		expect(input).toHaveAttribute("accept", IMAGE_FILE_ACCEPT);
		expect(input.multiple).toBe(false);
		expect(input.value).toBe("");
	});

	it("aria-label・multiple・id・buttonRef を渡せる", () => {
		const ref = createRef<HTMLButtonElement>();
		const { container } = render(
			<FileSelectButton
				onFiles={filesHandler()}
				multiple
				aria-label="画像 2 を差し替え"
				id="replace-2"
				buttonRef={ref}
			>
				差し替え
			</FileSelectButton>,
		);

		const button = screen.getByRole("button", { name: "画像 2 を差し替え" });
		expect(ref.current).toBe(button);
		expect(button).toHaveAttribute("id", "replace-2");
		expect(getFileInput(container).multiple).toBe(true);
	});

	it("disabled のときは押せず、ファイルを渡さない", async () => {
		const user = userEvent.setup();
		const onFiles = filesHandler();
		const { container } = render(
			<FileSelectButton onFiles={onFiles} disabled>
				差し替え
			</FileSelectButton>,
		);

		expect(screen.getByRole("button", { name: "差し替え" })).toBeDisabled();
		expect(getFileInput(container)).toBeDisabled();
		await user.upload(getFileInput(container), imageFile());
		expect(onFiles).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// UploadProgress
// ---------------------------------------------------------------------------

const COMPRESSING: UploadProgressInfo = {
	stage: "compressing",
	compress: { width: 1280, height: 853, quality: 0.74, attempt: 3 },
};

describe("UploadProgress", () => {
	it("処理していないときは行を出さず、読み上げの領域(aria-live)だけを残す", () => {
		render(<UploadProgress progress={null} onCancel={callback()} />);

		const status = screen.getByRole("status");
		expect(status).toHaveAttribute("aria-live", "polite");
		expect(status).toHaveTextContent("");
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("圧縮中は長辺と画質を見せ、読み上げは段階だけにする", () => {
		render(<UploadProgress progress={COMPRESSING} onCancel={callback()} />);

		expect(screen.getByText("圧縮中… 1280px / 画質 0.74")).toBeVisible();
		expect(screen.getByRole("status")).toHaveTextContent("画像を圧縮しています。");
		// Kumo の Loader は role="status" を持つので、読み上げのツリーから隠す(読み上げの領域は 1 つ)
		expect(screen.getAllByRole("status")).toHaveLength(1);
	});

	it("縦長の画像では長辺(高さ)を出す", () => {
		render(
			<UploadProgress
				progress={{
					stage: "compressing",
					compress: { width: 853, height: 1280, quality: 0.6, attempt: 1 },
				}}
			/>,
		);

		expect(screen.getByText("圧縮中… 1280px / 画質 0.60")).toBeInTheDocument();
	});

	it("画質を探すたびに行は変わるが、読み上げの文は変えない(同じ要素のまま)", () => {
		const { rerender } = render(<UploadProgress progress={COMPRESSING} />);
		const status = screen.getByRole("status");

		rerender(
			<UploadProgress
				progress={{
					stage: "compressing",
					compress: { width: 1024, height: 683, quality: 0.81, attempt: 4 },
				}}
			/>,
		);

		expect(screen.getByText("圧縮中… 1024px / 画質 0.81")).toBeInTheDocument();
		expect(screen.getByRole("status")).toBe(status);
		expect(status).toHaveTextContent("画像を圧縮しています。");
	});

	it.each([
		["decoding", "読み込み中…", "画像を読み込んでいます。"],
		["compressing", "圧縮中…", "画像を圧縮しています。"],
		["thumbnail", "サムネイルを作成中…", "サムネイルを作成しています。"],
		["uploading", "アップロード中…", "画像をアップロードしています。"],
	] as const)("段階 %s の文(ja)", (stage, visible, announce) => {
		render(<UploadProgress progress={{ stage }} />);

		expect(screen.getByText(visible)).toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent(announce);
	});

	it("段階の一覧は pipeline の順", () => {
		expect(UPLOAD_STAGES).toEqual(["decoding", "compressing", "thumbnail", "uploading"]);
	});

	it("複数を順に処理するときは何枚目かを出し、読み上げにも含める。1 枚だけなら出さない", () => {
		const { rerender } = render(
			<UploadProgress
				progress={{ ...COMPRESSING, index: 2, total: 5, filename: "IMG_0002.jpg" }}
			/>,
		);

		expect(screen.getByText("2 / 5 枚目")).toBeInTheDocument();
		expect(screen.getByText("IMG_0002.jpg")).toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("5 枚中 2 枚目: 画像を圧縮しています。");

		rerender(<UploadProgress progress={{ stage: "uploading", index: 1, total: 1 }} />);
		expect(screen.queryByText(/枚目/)).not.toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent(/^画像をアップロードしています。$/);
	});

	it("キャンセルボタンは、クリックでもキーボードでも onCancel を呼ぶ。onCancel が無ければ出さない", async () => {
		const user = userEvent.setup();
		const onCancel = callback();
		const { rerender } = render(<UploadProgress progress={COMPRESSING} onCancel={onCancel} />);

		const cancel = screen.getByRole("button", { name: "キャンセル" });
		await user.tab();
		expect(cancel).toHaveFocus();
		await user.keyboard("{Enter}");
		await user.keyboard(" ");
		await user.click(cancel);
		expect(onCancel).toHaveBeenCalledTimes(3);

		rerender(<UploadProgress progress={COMPRESSING} />);
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("cancelButtonRef でキャンセルボタンにフォーカスを移せる", () => {
		const ref = createRef<HTMLButtonElement>();
		render(<UploadProgress progress={COMPRESSING} onCancel={callback()} cancelButtonRef={ref} />);

		ref.current?.focus();
		expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus();
	});

	it("処理が終わったら、追加した枚数を読み上げる(読み上げの領域は同じ要素のまま)", () => {
		const { rerender } = render(<UploadProgress progress={{ stage: "uploading" }} />);
		const status = screen.getByRole("status");

		rerender(<UploadProgress progress={null} completed={1} />);
		expect(screen.getByRole("status")).toBe(status);
		expect(status).toHaveTextContent("画像を追加しました。");

		rerender(<UploadProgress progress={null} completed={3} />);
		expect(status).toHaveTextContent("3 枚の画像を追加しました。");

		rerender(<UploadProgress progress={null} completed={0} />);
		expect(status).toHaveTextContent("");
	});

	it("英語の文", () => {
		document.documentElement.lang = "en";
		const { rerender } = render(
			<UploadProgress progress={{ ...COMPRESSING, index: 2, total: 5 }} onCancel={callback()} />,
		);

		expect(screen.getByText("Compressing… 1280px / quality 0.74")).toBeInTheDocument();
		expect(screen.getByText("Image 2 of 5")).toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("Image 2 of 5: Compressing the image.");
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

		rerender(<UploadProgress progress={null} completed={1} />);
		expect(screen.getByRole("status")).toHaveTextContent("Image added.");
		rerender(<UploadProgress progress={null} completed={2} />);
		expect(screen.getByRole("status")).toHaveTextContent("2 images added.");
	});

	it("処理中だけ、行の下に保存の案内を出す。読み上げの領域には入れず、キャンセルボタンの説明にする", () => {
		const hintText = "処理が終わってから保存してください。";
		const { rerender } = render(<UploadProgress progress={null} onCancel={callback()} />);
		expect(screen.queryByText(hintText)).not.toBeInTheDocument();

		rerender(<UploadProgress progress={COMPRESSING} onCancel={callback()} />);
		const hint = screen.getByText(hintText);
		expect(hint).toBeVisible();
		// 進捗の行のすぐ下
		expect(hint.previousElementSibling).toHaveAttribute("data-stage", "compressing");
		// 段階が変わるたびに読まないよう、aria-live の領域の外に置く
		expect(hint.closest("[aria-live]")).toBeNull();
		expect(screen.getByRole("status")).not.toHaveTextContent(hintText);
		// キャンセルボタン(処理を始めると widget がフォーカスを移す)の説明として読まれる
		expect(screen.getByRole("button", { name: "キャンセル" })).toHaveAccessibleDescription(
			hintText,
		);

		// 段階が変わっても、同じ要素のまま出しておく
		rerender(<UploadProgress progress={{ stage: "uploading" }} onCancel={callback()} />);
		expect(screen.getByText(hintText)).toBe(hint);
		expect(screen.getByRole("status")).toHaveTextContent(/^画像をアップロードしています。$/);

		// 処理が終わったら消す(完了の読み上げにも入れない)
		rerender(<UploadProgress progress={null} completed={1} onCancel={callback()} />);
		expect(screen.queryByText(hintText)).not.toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent(/^画像を追加しました。$/);

		// キャンセルボタンが無くても、案内は出す
		rerender(<UploadProgress progress={COMPRESSING} />);
		expect(screen.getByText(hintText)).toBeVisible();
	});

	it("保存の案内の英語の文", async () => {
		document.documentElement.lang = "en";
		render(<UploadProgress progress={COMPRESSING} onCancel={callback()} />);

		expect(screen.getByText("Save after processing finishes.")).toBeVisible();
		expect(screen.getByRole("button", { name: "Cancel" })).toHaveAccessibleDescription(
			"Save after processing finishes.",
		);
		await changeLang("ja");
		expect(screen.getByText("処理が終わってから保存してください。")).toBeInTheDocument();
	});
});

// ---------------------------------------------------------------------------
// ImagePreview / ImageInfo
// ---------------------------------------------------------------------------

const DATA_URL = "data:image/webp;base64,UklGRhYAAABXRUJQVlA4";

describe("ImagePreview", () => {
	it("img に src と本来の width / height を付け、表示の幅は高さ 192px に収まるよう CSS で決める", () => {
		render(<ImagePreview src={DATA_URL} width={1280} height={853} />);

		const img = screen.getByRole("presentation");
		expect(img.tagName).toBe("IMG");
		expect(img).toHaveAttribute("src", DATA_URL);
		expect(img).toHaveAttribute("width", "1280");
		expect(img).toHaveAttribute("height", "853");
		expect(img).toHaveAttribute("alt", "");
		// 1280 × 192 / 853 = 288.1
		expect(img.style.width).toBe("288px");
		expect(img.style.height).toBe("auto");
		expect(img).toHaveClass("max-w-full");
	});

	it("alt を渡せる", () => {
		render(<ImagePreview src={DATA_URL} width={10} height={10} alt="赤い花" />);

		expect(screen.getByRole("img", { name: "赤い花" })).toBeInTheDocument();
	});

	it("small は 96px の枠に収める", () => {
		render(<ImagePreview src={DATA_URL} width={1280} height={853} size="small" />);

		const img = screen.getByRole("presentation");
		expect(img.style.width).toBe("96px");
		expect(img).toHaveAttribute("data-size", "small");
	});

	it("src が無いときは、同じ大きさの枠に「プレビューを読み込み中」を出す", async () => {
		render(<ImagePreview src={undefined} width={1280} height={853} />);

		expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
		const loading = screen.getByRole("status", { name: "プレビューを読み込み中" });
		const box = loading.parentElement;
		expect(box?.style.width).toBe("288px");
		expect(box?.getAttribute("style")).toContain("aspect-ratio: 1280 / 853");

		await changeLang("en");
		expect(screen.getByRole("status", { name: "Loading preview" })).toBeInTheDocument();
	});
});

describe("getPreviewDisplaySize", () => {
	it.each([
		// [幅, 高さ, 大きさ, 表示の幅, 表示の高さ]
		[1280, 853, "large", 288, 192],
		[853, 1280, "large", 128, 192],
		[4000, 1000, "large", 768, 192],
		[120, 80, "large", 120, 80], // 拡大しない
		[1280, 853, "small", 96, 64],
		[600, 900, "small", 64, 96],
		[50, 40, "small", 50, 40],
		[4000, 10, "small", 96, 1], // 1px を下回らない
	] as const)("%i×%i(%s)→ %i×%i", (width, height, size, expectedWidth, expectedHeight) => {
		expect(getPreviewDisplaySize(width, height, size)).toEqual({
			width: expectedWidth,
			height: expectedHeight,
		});
	});
});

describe("ImageInfo", () => {
	it("寸法・保存サイズ・画質を 1 行で出す", () => {
		render(<ImageInfo width={1280} height={853} storedBytes={98_234} quality={0.77} />);

		expect(screen.getByText("1280×853 · 保存サイズ 98.2KB · 画質 0.77")).toBeInTheDocument();
	});

	it("分からない値は省く", () => {
		const { rerender } = render(<ImageInfo width={1280} height={853} quality={0.6} />);
		expect(screen.getByText("1280×853 · 画質 0.60")).toBeInTheDocument();

		rerender(<ImageInfo width={1280} height={853} storedBytes={100_000} />);
		expect(screen.getByText("1280×853 · 保存サイズ 100.0KB")).toBeInTheDocument();

		rerender(<ImageInfo width={96} height={64} />);
		expect(screen.getByText("96×64")).toBeInTheDocument();
	});

	it("英語の文", () => {
		document.documentElement.lang = "en";
		render(<ImageInfo width={1280} height={853} storedBytes={98_234} quality={0.77} />);

		expect(screen.getByText("1280×853 · Stored size 98.2 KB · Quality 0.77")).toBeInTheDocument();
	});
});

describe("書式", () => {
	it("KB は 10 進(1,000 バイト)で小数 1 桁、画質は小数 2 桁、長辺は大きい方", () => {
		expect(formatKilobytes(98_234)).toBe("98.2");
		expect(formatKilobytes(99_999)).toBe("100.0");
		expect(formatKilobytes(8_000)).toBe("8.0");
		expect(formatQuality(0.6)).toBe("0.60");
		expect(formatQuality(0.92)).toBe("0.92");
		expect(longEdge(1280, 853)).toBe(1280);
		expect(longEdge(853, 1280)).toBe(1280);
	});
});

// ---------------------------------------------------------------------------
// AltTextInput
// ---------------------------------------------------------------------------

function AltHarness({
	initial = "",
	onChange,
}: {
	initial?: string;
	onChange: (value: string) => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<AltTextInput
			value={value}
			onChange={(next) => {
				onChange(next);
				setValue(next);
			}}
		/>
	);
}

describe("AltTextInput", () => {
	it("ラベルは「代替テキスト」。空欄のときは装飾画像として扱われることを説明に出し、入力すると消す", async () => {
		const user = userEvent.setup();
		const onChange = textHandler();
		render(<AltHarness onChange={onChange} />);

		const input = screen.getByRole("textbox", { name: "代替テキスト" });
		expect(input).toHaveAccessibleDescription(expect.stringContaining("装飾画像として扱われます"));

		await user.tab();
		expect(input).toHaveFocus();
		await user.keyboard("赤い花");

		expect(onChange).toHaveBeenLastCalledWith("赤い花");
		expect(input).toHaveValue("赤い花");
		expect(input).not.toHaveAccessibleDescription(expect.stringContaining("装飾画像"));
		expect(screen.queryByText(/装飾画像/)).not.toBeInTheDocument();
	});

	it("空白だけのときも、装飾画像として扱われると出す", () => {
		render(<AltTextInput value="   " onChange={textHandler()} />);

		expect(screen.getByRole("textbox")).toHaveAccessibleDescription(
			expect.stringContaining("装飾画像として扱われます"),
		);
	});

	it("上限は MAX_ALT_LENGTH(maxlength)", () => {
		render(<AltTextInput value="" onChange={textHandler()} />);

		expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", String(MAX_ALT_LENGTH));
	});

	it("itemLabel でどの画像の欄かをラベルに加え、id・disabled・inputRef を渡せる", () => {
		const ref = createRef<HTMLInputElement>();
		render(
			<AltTextInput
				value="説明"
				onChange={textHandler()}
				itemLabel="画像 2"
				id="alt-2"
				disabled
				inputRef={ref}
			/>,
		);

		const input = screen.getByRole("textbox", { name: "代替テキスト(画像 2)" });
		expect(input).toHaveAttribute("id", "alt-2");
		expect(input).toBeDisabled();
		expect(ref.current).toBe(input);
	});

	it("英語の文", () => {
		document.documentElement.lang = "en";
		const { rerender } = render(<AltTextInput value="" onChange={textHandler()} />);

		expect(screen.getByRole("textbox", { name: "Alternative text" })).toHaveAccessibleDescription(
			"When left empty, the image is treated as decorative (screen readers skip it).",
		);
		rerender(<AltTextInput value="" onChange={textHandler()} itemLabel="image 2" />);
		expect(screen.getByRole("textbox", { name: "Alternative text (image 2)" })).toBeInTheDocument();
	});

	it("入力欄(<input>)に min-w-0 を付ける(狭い列で、Kumo の包みの grid の最小幅にしない)", () => {
		render(<AltTextInput value="" onChange={textHandler()} itemLabel="画像 2" />);

		const input = screen.getByRole("textbox", { name: "代替テキスト(画像 2)" });
		expect(input.tagName).toBe("INPUT");
		expect(input).toHaveClass("min-w-0");
		// Kumo の Input は className を <input> に付ける(ラベルと説明を包む要素には付かない)
		const field = input.parentElement;
		expect(field).not.toBeNull();
		expect(field).toContainElement(screen.getByText("代替テキスト(画像 2)"));
		expect(field).not.toHaveClass("min-w-0");
		expect(ADMIN_CSS).toContain(".min-w-0{min-width:");
	});
});

// ---------------------------------------------------------------------------
// ErrorMessage
// ---------------------------------------------------------------------------

describe("ErrorMessage", () => {
	it("エラーが無いときは、空の role=alert の領域だけを残す(エラーが入ると同じ要素に出る)", () => {
		const { rerender } = render(<ErrorMessage error={null} />);
		const alert = screen.getByRole("alert");
		expect(alert).toBeEmptyDOMElement();

		rerender(<ErrorMessage error={new Base64ImageError("COMPRESSION_OVER_BUDGET")} />);
		expect(screen.getByRole("alert")).toBe(alert);
		expect(alert).toHaveTextContent(ERROR_MESSAGES.ja.COMPRESSION_OVER_BUDGET);
	});

	it("コードから文言を決め、コードの分からないエラーは「予期しないエラー」にする", () => {
		const { rerender } = render(
			<ErrorMessage error={new Base64ImageError("INPUT_HEIC_REJECTED")} />,
		);
		expect(screen.getByRole("alert")).toHaveTextContent(ERROR_MESSAGES.ja.INPUT_HEIC_REJECTED);

		rerender(<ErrorMessage error={{ code: "NETWORK_ERROR" }} />);
		expect(screen.getByRole("alert")).toHaveTextContent(ERROR_MESSAGES.ja.NETWORK_ERROR);

		rerender(<ErrorMessage error={new Error("boom")} />);
		expect(screen.getByRole("alert")).toHaveTextContent("予期しないエラーが発生しました。");
	});

	it("中断(AbortError)はエラーとして出さない", () => {
		const controller = new AbortController();
		controller.abort();
		const { rerender } = render(<ErrorMessage error={controller.signal.reason} />);
		expect(screen.getByRole("alert")).toBeEmptyDOMElement();

		rerender(<ErrorMessage error={new DOMException("The operation was aborted.", "AbortError")} />);
		expect(screen.getByRole("alert")).toBeEmptyDOMElement();

		// 時間切れ(TimeoutError)は中断ではない
		rerender(<ErrorMessage error={new DOMException("timed out", "TimeoutError")} />);
		expect(screen.getByRole("alert")).toHaveTextContent("予期しないエラーが発生しました。");
	});

	it("見出しと閉じるボタン(キーボードでも押せる)", async () => {
		const user = userEvent.setup();
		const onDismiss = callback();
		render(
			<ErrorMessage
				error={new Base64ImageError("INPUT_DECODE_FAILED")}
				title="IMG_0001.jpg"
				onDismiss={onDismiss}
			/>,
		);

		expect(screen.getByRole("alert")).toHaveTextContent("IMG_0001.jpg");
		const dismiss = screen.getByRole("button", { name: "エラーを閉じる" });
		expect(dismiss).toHaveTextContent("閉じる");
		await user.tab();
		expect(dismiss).toHaveFocus();
		await user.keyboard("{Enter}");
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("閉じるボタンは onDismiss が無ければ出さない", () => {
		render(<ErrorMessage error={new Base64ImageError("ENCODE_FAILED")} />);

		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("英語で出し、言語が変わると文言が変わる", async () => {
		document.documentElement.lang = "en";
		render(
			<ErrorMessage error={new Base64ImageError("BROWSER_UNSUPPORTED")} onDismiss={callback()} />,
		);

		expect(screen.getByRole("alert")).toHaveTextContent(ERROR_MESSAGES.en.BROWSER_UNSUPPORTED);
		expect(screen.getByRole("button", { name: "Dismiss the error" })).toBeInTheDocument();

		await changeLang("ja");
		expect(screen.getByRole("alert")).toHaveTextContent(ERROR_MESSAGES.ja.BROWSER_UNSUPPORTED);
	});
});

describe("isAbortError", () => {
	it("name が AbortError のものだけ", () => {
		const controller = new AbortController();
		controller.abort();

		expect(isAbortError(controller.signal.reason)).toBe(true);
		expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
		expect(isAbortError({ name: "AbortError" })).toBe(true);
		expect(isAbortError(new Error("AbortError"))).toBe(false);
		expect(isAbortError(new Base64ImageError("NETWORK_ERROR"))).toBe(false);
		expect(isAbortError("AbortError")).toBe(false);
		expect(isAbortError(null)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// ImageNotFound
// ---------------------------------------------------------------------------

describe("ImageNotFound", () => {
	it("「画像が見つかりません」を文字で出し、削除ボタンの説明に理由を結び付ける", async () => {
		const user = userEvent.setup();
		const onRemove = callback();
		render(<ImageNotFound onRemove={onRemove} />);

		expect(screen.getByText("画像が見つかりません")).toBeVisible();
		expect(screen.getByText(/ゴミ箱に移されたか、削除された可能性があります/)).toBeVisible();
		const remove = screen.getByRole("button", { name: "削除" });
		expect(remove).toHaveAccessibleDescription(expect.stringContaining("画像が見つかりません"));
		expect(remove).toHaveAccessibleDescription(
			expect.stringContaining("削除ボタンで外してください"),
		);

		await user.click(remove);
		await user.tab();
		await user.tab({ shift: true });
		expect(remove).toHaveFocus();
		await user.keyboard("{Enter}");
		expect(onRemove).toHaveBeenCalledTimes(2);
	});

	it("small ではギャラリーの 96px の枠に収め、長い説明は読み上げ用にだけ残す", () => {
		const { container } = render(
			<ImageNotFound onRemove={callback()} size="small" removeLabel="画像 2 を削除" />,
		);

		const remove = screen.getByRole("button", { name: "画像 2 を削除" });
		expect(remove).toHaveTextContent("削除");
		expect(remove).toHaveAccessibleDescription(
			expect.stringContaining("削除された可能性があります"),
		);
		expect(screen.getByText(/削除された可能性があります/)).toHaveClass("sr-only");
		const box = container.querySelector<HTMLElement>('[data-size="small"] > div');
		expect(box?.style.width).toBe("96px");
		expect(box?.style.height).toBe("96px");
	});

	it("removeButtonRef で削除ボタンにフォーカスを移せる", () => {
		const ref = createRef<HTMLButtonElement>();
		render(<ImageNotFound onRemove={callback()} removeButtonRef={ref} />);

		ref.current?.focus();
		expect(screen.getByRole("button", { name: "削除" })).toHaveFocus();
	});

	it("英語の文", () => {
		document.documentElement.lang = "en";
		render(<ImageNotFound onRemove={callback()} />);

		expect(screen.getByText("Image not found")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Remove" })).toHaveAccessibleDescription(
			expect.stringContaining("moved to the trash or deleted"),
		);
	});
});

// ---------------------------------------------------------------------------
// UploadNotices
// ---------------------------------------------------------------------------

describe("UploadNotices", () => {
	it("注意の文を出し、同じコードは 1 回だけにする。領域(aria-live)は注意が無くても残す", () => {
		const { container, rerender } = render(<UploadNotices notices={[]} />);
		const region = container.querySelector('[aria-live="polite"]');
		expect(region).toBeEmptyDOMElement();

		rerender(
			<UploadNotices notices={["GIF_FIRST_FRAME_ONLY", "GIF_FIRST_FRAME_ONLY"]} title="anim.gif" />,
		);
		expect(container.querySelector('[aria-live="polite"]')).toBe(region);
		expect(
			within(region as HTMLElement).getAllByText(NOTICE_MESSAGES.ja.GIF_FIRST_FRAME_ONLY),
		).toHaveLength(1);
		expect(region).toHaveTextContent("anim.gif");
	});

	it("英語の文", () => {
		document.documentElement.lang = "en";
		render(<UploadNotices notices={["GIF_FIRST_FRAME_ONLY"]} />);

		expect(screen.getByText(NOTICE_MESSAGES.en.GIF_FIRST_FRAME_ONLY)).toBeInTheDocument();
	});
});

// ---------------------------------------------------------------------------
// 管理画面の CSS
// ---------------------------------------------------------------------------

// EmDash の管理画面の CSS はビルド済みで、プラグインのファイルは Tailwind の対象にならない。部品が使うクラスが、
// その CSS にあることを確かめる(確かめ方は tests/admin/admin-css.ts。そのテストは admin-css.test.ts)。

describe("管理画面の CSS", () => {
	it("枠の色は、層(@layer)の外の `*` の規則が決める(ドラッグ中の枠の色を style で付ける理由)", () => {
		const rule = "*{border-color:var(--color-kumo-line)}";
		const at = ADMIN_CSS.indexOf(rule);
		expect(at).toBeGreaterThan(-1);
		// 規則の前で波括弧が閉じきっている = どの @layer の中でもない
		let depth = 0;
		for (const char of ADMIN_CSS.slice(0, at)) {
			if (char === "{") depth += 1;
			else if (char === "}") depth -= 1;
		}
		expect(depth).toBe(0);
		// クラスの規則は @layer utilities の中にあり、層の外の規則に負ける
		const utilities = ADMIN_CSS.indexOf("@layer utilities{");
		expect(utilities).toBeGreaterThan(-1);
		expect(ADMIN_CSS.indexOf(".border-kumo-brand{", utilities)).toBeGreaterThan(utilities);
	});

	it("部品が使うクラスは、すべて管理画面の CSS にある", () => {
		const { container } = render(
			<div>
				<ImageDropZone
					onFiles={filesHandler()}
					label="カバー"
					description="あと 3 枚追加できます"
				/>
				<ImageDropZone onFiles={filesHandler()} disabled />
				<FileSelectButton onFiles={filesHandler()}>差し替え</FileSelectButton>
				<UploadProgress
					progress={{ ...COMPRESSING, index: 2, total: 3, filename: "a.jpg" }}
					onCancel={callback()}
				/>
				<ImagePreview src={DATA_URL} width={1280} height={853} />
				<ImagePreview src={undefined} width={1280} height={853} size="small" />
				<ImageInfo width={1280} height={853} storedBytes={98_234} quality={0.77} />
				<AltTextInput value="" onChange={textHandler()} />
				<ErrorMessage
					error={new Base64ImageError("ENCODE_FAILED")}
					title="a.jpg"
					onDismiss={callback()}
				/>
				<ImageNotFound onRemove={callback()} />
				<ImageNotFound onRemove={callback()} size="small" />
				<UploadNotices notices={["GIF_FIRST_FRAME_ONLY"]} />
			</div>,
		);
		// ドラッグ中の枠と「1 枚ずつ」の知らせも描画する
		const zone = getZone(container);
		fireEvent.dragEnter(zone, { dataTransfer: fakeTransfer({ files: [imageFile()] }) });
		fireEvent.drop(zone, {
			dataTransfer: fakeTransfer({ files: [imageFile("a.jpg"), imageFile("b.jpg")] }),
		});
		fireEvent.dragEnter(zone, { dataTransfer: fakeTransfer({ files: [imageFile()] }) });
		expect(zone).toHaveAttribute("data-dragging", "true");
		expect(screen.getByText("画像は 1 枚ずつ追加してください。")).toBeInTheDocument();

		const names = collectClassNames(container);
		expect(names).toEqual(
			expect.arrayContaining(["bg-kumo-tint", "emdash-media-transparency-grid", "sr-only"]),
		);
		const missing = findMissingClasses(container, sourceTokens("src/admin/parts"));
		// 部品のソースに書いたクラスは、すべて管理画面の CSS にある
		expect(missing.fromSource).toEqual([]);
		// CSS に無い残りは、Kumo が自分で付けるクラスだけ(Kumo 2.6.0 の Input の `disabled:text-kumo-disabled` は、
		// テーマに `kumo-disabled` の色が無く、CSS が作られない。管理画面の Input も同じ)
		expect(missing.unknown).toEqual([]);
	});
});
