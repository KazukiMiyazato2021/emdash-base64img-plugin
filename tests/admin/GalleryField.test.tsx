// ギャラリーの widget(src/admin/GalleryField.tsx。T28)のテスト。
// - 処理と状態は本物の T23 のフック、表示は本物の T22 の部品を使う。
// - デコードは createDecodeImage に偽の createImageBitmap を渡し、File はヘッダーだけの本物のバイト列で作る(T23 と同じ)。
//   圧縮とサムネイルは本物の compressImage / createThumbnail に偽のエンコーダーを渡す。どれも widget の `dependencies` で渡す。
// - 通信は本物の API クライアント(src/client/api.ts)を通し、fetch を偽のサーバーに差し替える(preview と upload)。
// - act の外での状態の変化(React の警告)があれば、テストを失敗にする(console.error を見張る。
//   docs/react-hook-testing-pitfalls.md、docs/react-effect-lint-and-vitest-hooks.md)。

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	createRef,
	StrictMode,
	useImperativeHandle,
	useState,
	type ReactNode,
	type Ref,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import {
	GALLERY_DRAG_TYPE,
	GalleryField,
	readGalleryValue,
	type GalleryFieldProps,
} from "../../src/admin/GalleryField";
import type { UploadDependencies } from "../../src/admin/hooks";
import { ERROR_MESSAGES, NOTICE_MESSAGES } from "../../src/client/error-messages";
import { createDecodeImage } from "../../src/client/input";
import type { WebpEncoder } from "../../src/shared/pipeline";
import type { Base64ImageEntry, Base64ImageRef, UploadRequest } from "../../src/shared/types";
import { findMissingClasses, sourceTokens } from "./admin-css";

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

const ENTRY_ID = "01J8Z3K4M5N6P7Q8R9S0T1V2W4";
const EDIT_URL = `/_emdash/admin/content/posts/${ENTRY_ID}?locale=ja`;
const PLUGIN_API = "/_emdash/api/plugins/base64-image";
const PREVIEW_URL = `${PLUGIN_API}/preview`;
const UPLOAD_URL = `${PLUGIN_API}/upload`;

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
	document.documentElement.lang = "ja";
	window.history.replaceState(null, "", EDIT_URL);
	consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
	// 先に描画を片付ける(下で投げると、tests/setup/dom.ts の cleanup が呼ばれない)
	cleanup();
	vi.unstubAllGlobals();
	window.history.replaceState(null, "", "/");
	const warnings = consoleError.mock.calls.map((args) => args.map(String).join(" "));
	consoleError.mockRestore();
	if (warnings.length > 0) throw new Error(`console.error was called:\n${warnings.join("\n")}`);
});

/** 描画したあとで `<html lang>` を変える(MutationObserver の通知を待つ) */
async function changeLang(lang: string): Promise<void> {
	await act(async () => {
		document.documentElement.lang = lang;
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function imageRef(id: string, overrides: Partial<Base64ImageRef> = {}): Base64ImageRef {
	return { v: 1, id, locale: "ja", width: 1280, height: 853, alt: `${id} の説明`, ...overrides };
}

/** 保存済みの画像エントリ(`preview` の応答)。スキーマは形だけを確かめるので、中身は本物の WebP でなくてよい */
function imageEntry(id: string, width = 1280, height = 853): Base64ImageEntry {
	return {
		src: `data:image/webp;base64,UklGR${id}`,
		mimeType: "image/webp",
		width,
		height,
		meta: { v: 1, bytes: 1000, quality: 0.8 },
	};
}

/** 保存済みの画像 img1〜img9 のプレビュー(どれも見つかる) */
const PREVIEWS: Readonly<Record<string, Base64ImageEntry>> = Object.fromEntries(
	Array.from({ length: 9 }, (_unused, index) => {
		const id = `img${index + 1}`;
		return [id, imageEntry(id)];
	}),
);

function deferred<T = void>(): PromiseWithResolvers<T> {
	return Promise.withResolvers<T>();
}

// ---------------------------------------------------------------------------
// 偽のサーバー(fetch)
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function success(data: unknown): Response {
	return json({ success: true, data });
}

function routeError(code: string, status: number): Response {
	return json({ success: false, error: { code, message: "failed" } }, status);
}

interface UploadCall {
	readonly request: UploadRequest;
	readonly signal: AbortSignal | undefined;
}

interface ServerInit {
	/** preview の応答。無い ID は応答に入れない(missing になる)。null は「見つからない」 */
	readonly previews?: Readonly<Record<string, Base64ImageEntry | null>>;
	/** preview の要求を受けたときの応答(省略すると `previews` から作る) */
	readonly preview?: (ids: readonly string[]) => Response | Promise<Response>;
	/** upload の応答(省略すると、`new1`・`new2`… の参照を返す) */
	readonly upload?: (call: UploadCall, index: number) => Response | Promise<Response>;
}

interface Server {
	readonly previewRequests: string[][];
	readonly uploads: UploadCall[];
}

/** アップロード用ルートの成功の応答。ID は `new1` から順に、`locale` は画像エントリのロケール(`en`) */
function uploaded(call: UploadCall, index: number): Response {
	return success({
		ref: {
			v: 1,
			id: `new${index + 1}`,
			locale: "en",
			width: call.request.width,
			height: call.request.height,
			alt: "",
		},
	});
}

function installServer(init: ServerInit = {}): Server {
	const server: Server = { previewRequests: [], uploads: [] };
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, requestInit: RequestInit = {}) => {
			const url = String(input);
			const body: unknown =
				typeof requestInit.body === "string" ? JSON.parse(requestInit.body) : undefined;
			if (url === PREVIEW_URL) {
				const ids = (body as { ids: string[] }).ids;
				server.previewRequests.push(ids);
				if (init.preview !== undefined) return init.preview(ids);
				const previews = init.previews ?? {};
				return success({
					items: ids
						.filter((id) => Object.hasOwn(previews, id))
						.map((id) => ({ id, image: previews[id] ?? null })),
				});
			}
			if (url === UPLOAD_URL) {
				const call: UploadCall = {
					request: body as UploadRequest,
					signal: requestInit.signal ?? undefined,
				};
				server.uploads.push(call);
				const index = server.uploads.length - 1;
				return (init.upload ?? uploaded)(call, index);
			}
			throw new Error(`unexpected request: ${url}`);
		}),
	);
	return server;
}

/** 中断されるまで応答しない(本物の fetch と同じく signal.reason で reject する) */
function hangUntilAborted(call: UploadCall): Promise<Response> {
	return new Promise((_resolve, reject) => {
		call.signal?.addEventListener("abort", () => reject(call.signal?.reason), { once: true });
	});
}

// ---------------------------------------------------------------------------
// 入力ファイルと、偽のデコード・エンコーダー(T23 のテストと同じ作り方)
// ---------------------------------------------------------------------------

const u32be = (value: number): number[] => [
	(value >>> 24) & 0xff,
	(value >>> 16) & 0xff,
	(value >>> 8) & 0xff,
	value & 0xff,
];
const u16le = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
	return Uint8Array.from([
		0x89,
		0x50,
		0x4e,
		0x47,
		0x0d,
		0x0a,
		0x1a,
		0x0a,
		...u32be(13),
		...ascii("IHDR"),
		...u32be(width),
		...u32be(height),
		8,
		6,
		0,
		0,
		0,
		...u32be(0),
		...u32be(0),
		...ascii("IEND"),
		...u32be(0),
	]);
}

function gifBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
	return Uint8Array.from([...ascii("GIF89a"), ...u16le(width), ...u16le(height), 0, 0, 0, 0x3b]);
}

function heicBytes(): Uint8Array<ArrayBuffer> {
	return Uint8Array.from([
		...u32be(24),
		...ascii("ftyp"),
		...ascii("heic"),
		...u32be(0),
		...ascii("mif1"),
		...ascii("heic"),
	]);
}

const decodedSizes = new WeakMap<Blob, { readonly width: number; readonly height: number }>();

function pngFile(name: string, width = 2000, height = 1500): File {
	const file = new File([pngBytes(width, height)], name, { type: "image/png" });
	decodedSizes.set(file, { width, height });
	return file;
}

function gifFile(name: string, width = 120, height = 80): File {
	const file = new File([gifBytes(width, height)], name, { type: "image/gif" });
	decodedSizes.set(file, { width, height });
	return file;
}

function heicFile(name: string): File {
	return new File([heicBytes()], name, { type: "image/heic" });
}

/**
 * 偽のエンコーダー。画質 0.77 以下なら長辺と同じバイト数(予算に収まる)、超えると 80,000 バイトの Blob を返す。
 * 本体は 1600px・画質 0.77、サムネイルは 96px になる
 */
const fakeEncoder: WebpEncoder = async ({ width, height, quality }) =>
	new Blob([new Uint8Array(quality <= 0.77 + 1e-9 ? Math.max(width, height) : 80_000)], {
		type: "image/webp",
	});

/** widget に渡す処理の差し替え。`gate` を渡すと、デコードの完了をそこで待たせる */
function testDependencies(gate?: (file: File) => Promise<void>): UploadDependencies {
	return {
		decodeImage: createDecodeImage({
			createImageBitmap: async (image) => {
				const file = image as File;
				await gate?.(file);
				const size = decodedSizes.get(file) ?? { width: 8, height: 6 };
				return { ...size, close: () => {} } as unknown as ImageBitmap;
			},
		}),
		encoder: fakeEncoder,
		waitForPaint: () => Promise.resolve(),
	};
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

interface HarnessHandle {
	/** 親の状態として、値を外から変える(保存のあとに EmDash が値を入れ直すときなど) */
	readonly setValue: (value: unknown) => void;
}

interface HarnessProps extends Partial<Omit<GalleryFieldProps, "value" | "onChange">> {
	readonly initial: unknown;
	readonly onValue?: (value: unknown) => void;
	readonly ref?: Ref<HarnessHandle>;
}

/** EmDash の編集画面と同じく、onChange の値を親の状態に入れて描き直す */
function Harness({ initial, onValue, ref, ...props }: HarnessProps) {
	const [value, setValue] = useState<unknown>(initial);
	useImperativeHandle(ref, () => ({ setValue }), []);
	return (
		<GalleryField
			label="ギャラリー"
			id="field-gallery"
			dependencies={testDependencies()}
			{...props}
			value={value}
			onChange={(next) => {
				onValue?.(next);
				setValue(next);
			}}
		/>
	);
}

/** `wrap` は widget を包む要素(編集ロックの `<fieldset disabled>` など) */
function renderGallery(
	props: HarnessProps,
	wrap: (field: ReactNode) => ReactNode = (field) => field,
) {
	const onValue = vi.fn<(value: unknown) => void>();
	const utils = render(wrap(<Harness onValue={onValue} {...props} />));
	return { ...utils, onValue, lastValue: () => onValue.mock.lastCall?.[0] };
}

/** ドロップゾーンのファイルの入力欄(複数可のもの) */
function zoneInput(container: HTMLElement): HTMLInputElement {
	const input = container.querySelector('input[type="file"][multiple]');
	if (!(input instanceof HTMLInputElement)) throw new Error("zone input not found");
	return input;
}

/** 差し替えのボタンの隣にあるファイルの入力欄 */
function replaceInput(button: HTMLElement): HTMLInputElement {
	const input = button.parentElement?.querySelector('input[type="file"]:not([multiple])');
	if (!(input instanceof HTMLInputElement)) throw new Error("replace input not found");
	return input;
}

/** 読み上げの領域(並べ替え・削除など)。UploadProgress のものは後ろにある */
function galleryAnnouncer(container: HTMLElement): HTMLOutputElement {
	const output = container.querySelector("output[aria-live]");
	if (!(output instanceof HTMLOutputElement)) throw new Error("announcer not found");
	return output;
}

/** 一覧の行(`li`)の見出しの文字 */
function rowTitles(): string[] {
	const list = screen.queryByRole("list", { name: "ギャラリー" });
	if (list === null) return [];
	return within(list)
		.getAllByRole("listitem")
		.map((item) => item.querySelector("[data-gallery-title]")?.textContent ?? "");
}

function idsOf(value: unknown): unknown[] {
	return Array.isArray(value)
		? value.map((element: unknown) =>
				typeof element === "object" && element !== null && "id" in element ? element.id : element,
			)
		: [];
}

/** 読み上げの領域(処理状況。T22 の UploadProgress のもの) */
function progressAnnouncer(container: HTMLElement): HTMLOutputElement {
	const output = container.querySelectorAll("output[aria-live]")[1];
	if (!(output instanceof HTMLOutputElement)) throw new Error("progress announcer not found");
	return output;
}

function zoneButton(name = "ギャラリー: ファイルを選択"): HTMLElement {
	return screen.getByRole("button", { name });
}

/**
 * ファイルの選択で受け取る(ボタンにフォーカスがある状態で、ファイルを選び終えたところ)。
 * user.upload は隠れた入力欄にフォーカスを移すので、実際のブラウザと合わせるため change を直接送る
 */
function selectFiles(input: HTMLInputElement, files: readonly File[]): void {
	fireEvent.change(input, { target: { files: [...files] } });
}

/** ドロップゾーンの枠にファイルをドロップする(jsdom に DataTransfer が無いので、部品が読むものだけの偽物) */
function dropFiles(files: readonly File[]): void {
	const zone = zoneButton().parentElement;
	if (zone === null) throw new Error("zone not found");
	fireEvent.drop(zone, {
		dataTransfer: {
			files: [...files],
			items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
			types: ["Files"],
		},
	});
}

/** 行の見出しにフォーカスがあるか */
function expectFocusOnTitle(text: string): void {
	const active = document.activeElement;
	expect(active).toHaveAttribute("data-gallery-title");
	expect(active).toHaveTextContent(text);
}

/** 失敗したファイルのエラー(見出しがファイル名の `role="alert"` の領域) */
function errorFor(filename: string): HTMLElement {
	const alert = screen.getByText(filename).closest<HTMLElement>('[role="alert"]');
	if (alert === null) throw new Error(`error for ${filename} not found`);
	return alert;
}

/** 中身のある `role="alert"` の領域の文字 */
function alertTexts(): string[] {
	return screen
		.queryAllByRole("alert")
		.map((alert) => alert.textContent ?? "")
		.filter((text) => text !== "");
}

// ---- ドラッグ(jsdom に DragEvent と DataTransfer が無いので、MouseEvent に偽の dataTransfer を付ける) ----

interface FakeDragTransfer {
	readonly types: readonly string[];
	effectAllowed: string;
	dropEffect: string;
	readonly setData: (type: string, value: string) => void;
	readonly getData: (type: string) => string;
}

/** 並べ替えのドラッグの DataTransfer。`setData` した種類が `types` に入る */
function dragTransfer(initialTypes: readonly string[] = []): FakeDragTransfer {
	const data = new Map<string, string>(initialTypes.map((type) => [type, ""]));
	return {
		get types() {
			return [...data.keys()];
		},
		effectAllowed: "uninitialized",
		dropEffect: "none",
		setData: vi.fn<(type: string, value: string) => void>((type, value) => {
			data.set(type, value);
		}),
		getData: (type: string) => data.get(type) ?? "",
	};
}

/** ドラッグのイベントを送る。戻り値のイベントで `defaultPrevented` を調べる */
function dispatchDrag(
	type: "dragstart" | "dragover" | "dragleave" | "drop" | "dragend",
	target: Element,
	transfer: FakeDragTransfer,
	init: { readonly clientY?: number; readonly relatedTarget?: EventTarget | null } = {},
): MouseEvent {
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientY: init.clientY ?? 0,
		relatedTarget: init.relatedTarget ?? null,
	});
	Object.defineProperty(event, "dataTransfer", { value: transfer });
	fireEvent(target, event);
	return event;
}

/** 一覧の行。高さ 100px で縦に並んでいることにする(jsdom は配置を計算しない) */
function layoutRows(): HTMLElement[] {
	const rows = within(screen.getByRole("list", { name: "ギャラリー" })).getAllByRole("listitem");
	rows.forEach((row, index) => {
		vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: index * 100,
			top: index * 100,
			bottom: index * 100 + 100,
			left: 0,
			right: 500,
			width: 500,
			height: 100,
			toJSON: () => ({}),
		});
	});
	return rows;
}

function handleOf(row: HTMLElement): HTMLElement {
	const handle = row.querySelector<HTMLElement>("[data-gallery-handle]");
	if (handle === null) throw new Error("handle not found");
	return handle;
}

// ---------------------------------------------------------------------------
// 値の読み方
// ---------------------------------------------------------------------------

describe("readGalleryValue", () => {
	it("null / undefined は画像なし(空の一覧)", () => {
		expect(readGalleryValue(null)).toEqual({ kind: "list", elements: [], entries: [] });
		expect(readGalleryValue(undefined)).toEqual({ kind: "list", elements: [], entries: [] });
	});

	it("参照の要素は画像、それ以外は壊れた要素として、位置を保って読む", () => {
		const first = imageRef("img1");
		const second = imageRef("img2");
		const value = [first, { id: "broken" }, second, "text"];
		const read = readGalleryValue(value);
		expect(read.kind).toBe("list");
		if (read.kind !== "list") return;
		expect(read.elements).toBe(value);
		expect(read.entries.map((entry) => entry.kind)).toEqual([
			"image",
			"invalid",
			"image",
			"invalid",
		]);
		expect(read.entries[0]).toEqual({
			kind: "image",
			key: "image:img1",
			ref: first,
			duplicateOf: undefined,
		});
		expect(read.entries[1]?.key).toBe('invalid:{"id":"broken"}');
		expect(read.entries[3]?.key).toBe('invalid:"text"');
	});

	it("同じ画像の 2 回目以降は、最初の位置を持ち、キーが重ならない", () => {
		const read = readGalleryValue([
			imageRef("img1"),
			imageRef("img2"),
			imageRef("img1"),
			imageRef("img1"),
		]);
		if (read.kind !== "list") throw new Error("not a list");
		expect(read.entries.map((entry) => entry.key)).toEqual([
			"image:img1",
			"image:img2",
			"image:img1#2",
			"image:img1#3",
		]);
		expect(
			read.entries.map((entry) => (entry.kind === "image" ? entry.duplicateOf : null)),
		).toEqual([undefined, undefined, 1, 1]);
		// 同じ中身の壊れた要素も、キーが重ならない
		const broken = readGalleryValue([1, 1]);
		if (broken.kind !== "list") throw new Error("not a list");
		expect(broken.entries.map((entry) => entry.key)).toEqual(["invalid:1", "invalid:1#2"]);
	});

	it("配列でない値は unsupported。参照 1 つなら、その参照を持つ", () => {
		const single = imageRef("img1");
		expect(readGalleryValue(single)).toEqual({ kind: "unsupported", single });
		expect(readGalleryValue("text")).toEqual({ kind: "unsupported", single: null });
		expect(readGalleryValue({ items: [] })).toEqual({ kind: "unsupported", single: null });
		expect(readGalleryValue(0)).toEqual({ kind: "unsupported", single: null });
	});

	it("知らないキーや形の違う値の参照は、壊れた要素になる(T03 の isBase64ImageRef)", () => {
		const read = readGalleryValue([
			{ ...imageRef("img1"), extra: true },
			{ ...imageRef("img2"), v: 2 },
			{ ...imageRef("img3"), alt: "a".repeat(1001) },
			imageRef("bad id"),
		]);
		if (read.kind !== "list") throw new Error("not a list");
		expect(read.entries.map((entry) => entry.kind)).toEqual([
			"invalid",
			"invalid",
			"invalid",
			"invalid",
		]);
	});
});

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

describe("表示", () => {
	it("空の値では、複数を受け付けるドロップゾーンと、あと何枚追加できるかを出す", () => {
		installServer();
		const { container } = renderGallery({ initial: null });

		const zone = screen.getByRole("button", { name: "ギャラリー: ファイルを選択" });
		expect(zone).toHaveAttribute("id", "field-gallery");
		expect(zone).toBeEnabled();
		expect(zone).toHaveAccessibleDescription(
			expect.stringContaining("あと 10 枚追加できます(最大 10 枚)。"),
		);
		expect(zoneInput(container)).toHaveAttribute("accept", "image/*");
		expect(screen.getByText("0 / 10 枚")).toBeInTheDocument();
		expect(screen.queryByRole("list")).not.toBeInTheDocument();
	});

	it("保存済みの画像を、見出し・縮小画像・情報・代替テキストで 1 枚ずつ出す", async () => {
		const server = installServer({
			previews: { img1: imageEntry("img1"), img2: imageEntry("img2", 800, 600) },
		});
		const { container } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2", { width: 800, height: 600, alt: "" })],
		});

		expect(rowTitles()).toEqual(["画像 1", "画像 2"]);
		expect(screen.getByText("2 / 10 枚")).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "代替テキスト(画像 1)" })).toHaveValue(
			"img1 の説明",
		);
		expect(screen.getByRole("textbox", { name: "代替テキスト(画像 2)" })).toHaveValue("");
		await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
		const images = Array.from(container.querySelectorAll("img"));
		expect(images.map((image) => image.getAttribute("src"))).toEqual([
			imageEntry("img1").src,
			imageEntry("img2").src,
		]);
		// 寸法は参照の値。保存サイズは data URL の長さ、画質は画像エントリの meta.quality
		expect(images[0]).toHaveAttribute("width", "1280");
		expect(screen.getByText(`1280×853 · 保存サイズ 0.0KB · 画質 0.80`)).toBeInTheDocument();
		expect(server.previewRequests).toEqual([["img1", "img2"]]);
		// 1 枚ずつの操作に、どの画像かが分かる名前が付く
		for (const name of [
			"画像 1 を上へ移動",
			"画像 1 を下へ移動",
			"画像 1 を差し替え",
			"画像 1 を削除",
			"画像 2 を削除",
		]) {
			expect(screen.getByRole("button", { name })).toBeInTheDocument();
		}
		expect(screen.getByRole("button", { name: "画像 2 を差し替え" })).toHaveTextContent("差し替え");
	});
});

describe("表示(値の問題)", () => {
	it("見つからない画像は「画像が見つかりません」と削除ボタンを出し、押すと値から外す", async () => {
		installServer({ previews: { img1: imageEntry("img1"), img2: null } });
		const { lastValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const user = userEvent.setup();

		// img2 は image: null、img3 は応答に無い。どちらも「画像が見つかりません」
		await waitFor(() => expect(screen.getAllByText("画像が見つかりません")).toHaveLength(2));
		expect(rowTitles()).toEqual(["画像 1", "画像 2", "画像 3"]);
		// 見つからない画像には、代替テキストと差し替えを出さない(並べ替えはできる)
		expect(screen.queryByRole("textbox", { name: "代替テキスト(画像 2)" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "画像 2 を差し替え" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "画像 2 を上へ移動" })).toBeInTheDocument();
		const remove = screen.getByRole("button", { name: "画像 2 を削除" });
		expect(remove).toHaveAccessibleDescription(expect.stringContaining("画像が見つかりません"));

		await user.click(remove);
		expect(idsOf(lastValue())).toEqual(["img1", "img3"]);
		expectFocusOnTitle("画像 2");
	});

	it("プレビューを取得できなければ、枠に「読み込めませんでした」、下にエラーと取得し直すボタンを出す", async () => {
		let fail = true;
		const server = installServer({
			preview: (ids) =>
				fail
					? routeError("INTERNAL_ERROR", 500)
					: success({ items: ids.map((id) => ({ id, image: imageEntry(id) })) }),
		});
		const { container } = renderGallery({ initial: [imageRef("img1"), imageRef("img2")] });
		const user = userEvent.setup();

		await waitFor(() => expect(screen.getAllByText("読み込めませんでした")).toHaveLength(2));
		expect(alertTexts()).toEqual([
			`プレビューを読み込めませんでした${ERROR_MESSAGES.ja.INTERNAL_ERROR}`,
		]);
		// 取得できなくても、代替テキスト・差し替え・削除はできる
		expect(screen.getByRole("textbox", { name: "代替テキスト(画像 1)" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "画像 1 を差し替え" })).toBeEnabled();

		fail = false;
		await user.click(screen.getByRole("button", { name: "もう一度読み込む" }));
		await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
		expect(server.previewRequests).toEqual([
			["img1", "img2"],
			["img1", "img2"],
		]);
		expect(alertTexts()).toEqual([]);
		expect(screen.queryByRole("button", { name: "もう一度読み込む" })).not.toBeInTheDocument();
		// 押したボタンが消えたので、ドロップゾーンへ移す
		expect(document.activeElement).toBe(zoneButton());
	});

	it("壊れた要素は、その位置に「データが正しくありません」と出し、削除と並べ替えだけをできるようにする", async () => {
		installServer({ previews: { img1: imageEntry("img1"), img2: imageEntry("img2") } });
		const broken = { id: "broken", note: "壊れた値" };
		const { lastValue } = renderGallery({
			initial: [imageRef("img1"), broken, imageRef("img2")],
		});
		const user = userEvent.setup();

		expect(rowTitles()).toEqual(["画像 1", "画像 2", "画像 3"]);
		expect(screen.getByText("3 / 10 枚")).toBeInTheDocument();
		expect(screen.getByText("データが正しくありません")).toBeInTheDocument();
		expect(
			screen.getByText(
				"この画像の値は形が正しくないため、表示も編集もできません。保存するには、削除してください。",
			),
		).toBeInTheDocument();
		expect(screen.queryByRole("textbox", { name: "代替テキスト(画像 2)" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "画像 2 を差し替え" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "画像 2 を下へ移動" })).toBeInTheDocument();

		// ほかの画像を編集しても、壊れた要素はその位置のまま残す(勝手に直さない・捨てない)
		await user.type(screen.getByRole("textbox", { name: "代替テキスト(画像 3)" }), "!");
		expect(lastValue()).toEqual([
			imageRef("img1"),
			broken,
			imageRef("img2", { alt: "img2 の説明!" }),
		]);
		expect((lastValue() as unknown[])[1]).toBe(broken);

		// 並べ替えもできる
		await user.click(screen.getByRole("button", { name: "画像 2 を上へ移動" }));
		expect(lastValue()).toEqual([
			broken,
			imageRef("img1"),
			imageRef("img2", { alt: "img2 の説明!" }),
		]);

		await user.click(screen.getByRole("button", { name: "画像 1 を削除" }));
		expect(idsOf(lastValue())).toEqual(["img1", "img2"]);
		expect(screen.queryByText("データが正しくありません")).not.toBeInTheDocument();
	});

	it("同じ画像が 2 回以上あれば、2 回目以降に注意を出す", async () => {
		const server = installServer({ previews: { img1: imageEntry("img1") } });
		renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img1", { alt: "" })],
		});

		expect(rowTitles()).toEqual(["画像 1", "画像 2", "画像 3"]);
		const warnings = screen.getAllByText(
			"同じ画像が 1 番目にもあります。保存するには、どちらかを削除してください。",
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.closest("li")).toBe(screen.getAllByRole("listitem")[2]);
		await waitFor(() => expect(server.previewRequests).toEqual([["img1", "img2"]]));
	});

	it("配列でない値は、値を空にするボタンを出し、直すまで画像を追加させない", async () => {
		installServer();
		const { container, lastValue } = renderGallery({ initial: "not a gallery" });
		const user = userEvent.setup();

		expect(
			screen.getByText(
				"このフィールドの値が、ギャラリーの形(画像の参照の一覧)ではありません。保存するには、値を空にしてください。",
			),
		).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "1 枚目にする" })).not.toBeInTheDocument();
		expect(zoneButton()).toBeDisabled();
		expect(zoneButton()).toHaveAccessibleDescription(
			expect.stringContaining("値を直すまで、画像を追加できません。"),
		);

		await user.click(screen.getByRole("button", { name: "値を空にする" }));
		expect(lastValue()).toEqual([]);
		expect(zoneButton()).toBeEnabled();
		expect(document.activeElement).toBe(zoneButton());
		expect(galleryAnnouncer(container)).toHaveTextContent("値を空にしました。");
	});

	it("参照 1 つの値は、ギャラリーの 1 枚目にできる", async () => {
		installServer({ previews: { img1: imageEntry("img1") } });
		const single = imageRef("img1");
		const { container, lastValue } = renderGallery({ initial: single });
		const user = userEvent.setup();

		expect(
			screen.getByText(
				"このフィールドの値が、ギャラリーの形ではなく、画像 1 枚の参照です。ギャラリーの 1 枚目にするか、値を空にしてください。",
			),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "1 枚目にする" }));
		expect(lastValue()).toEqual([single]);
		expect(rowTitles()).toEqual(["画像 1"]);
		expectFocusOnTitle("画像 1");
		expect(galleryAnnouncer(container)).toHaveTextContent("画像をギャラリーの 1 枚目にしました。");
	});

	it("上限(maxItems)に達したら追加できず、超えていたら何枚削除すればよいかを出す", () => {
		installServer();
		renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
			options: { maxItems: 3 },
		});
		expect(screen.getByText("3 / 3 枚")).toBeInTheDocument();
		expect(zoneButton()).toBeDisabled();
		expect(zoneButton()).toHaveAccessibleDescription(
			expect.stringContaining("上限の 3 枚に達しています。追加するには、画像を削除してください。"),
		);
		cleanup();

		renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3"), imageRef("img4")],
			options: { maxItems: 3 },
		});
		expect(screen.getByText("4 / 3 枚")).toBeInTheDocument();
		expect(zoneButton()).toBeDisabled();
		expect(zoneButton()).toHaveAccessibleDescription(
			expect.stringContaining(
				"上限の 3 枚を 1 枚超えています。保存するには、1 枚削除してください。",
			),
		);
		cleanup();

		// options は normalizeFieldOptions で読む(範囲外は丸め、オブジェクトでなければ既定値)
		renderGallery({ initial: null, options: { maxItems: 50 } });
		expect(screen.getByText("0 / 20 枚")).toBeInTheDocument();
		cleanup();
		renderGallery({ initial: null, options: [{ value: "a", label: "A" }] });
		expect(screen.getByText("0 / 10 枚")).toBeInTheDocument();
	});

	it("minimal では、表示名と枚数を画面に出さない(一覧の名前には使う)", () => {
		installServer();
		renderGallery({ initial: [imageRef("img1")], minimal: true });

		expect(screen.getByText("1 / 10 枚").parentElement).toHaveClass("sr-only");
		expect(screen.getByRole("list", { name: "ギャラリー" })).toBeInTheDocument();
	});

	it("英語で表示し、言語が変わると文言が変わる", async () => {
		document.documentElement.lang = "en";
		installServer({ previews: { img1: imageEntry("img1"), img3: null } });
		const { container } = renderGallery({
			initial: [imageRef("img1"), { broken: true }, imageRef("img3"), imageRef("img1")],
			label: "Gallery",
			options: { maxItems: 3 },
		});

		await waitFor(() => expect(screen.getByText("Image not found")).toBeInTheDocument());
		expect(screen.getByText("4 / 3 images")).toBeInTheDocument();
		expect(zoneButton("Gallery: Select files")).toHaveAccessibleDescription(
			expect.stringContaining(
				"The gallery has 1 more image than the limit of 3. Remove 1 to save the entry.",
			),
		);
		for (const name of [
			"Move image 1 up",
			"Move image 1 down",
			"Replace image 1",
			"Remove image 1",
		]) {
			expect(screen.getByRole("button", { name })).toBeInTheDocument();
		}
		expect(screen.getByRole("textbox", { name: "Alternative text (Image 1)" })).toBeInTheDocument();
		expect(screen.getByText("Invalid data")).toBeInTheDocument();
		expect(
			screen.getByText(
				"The same image is also at position 1. Remove one of them to save the entry.",
			),
		).toBeInTheDocument();
		// 画面の文字に日本語が混ざらない
		expect(container.textContent).not.toMatch(/[぀-ヿ一-鿿]/u);

		await changeLang("ja");
		expect(screen.getByText("4 / 3 枚")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "画像 1 を削除" })).toBeInTheDocument();
	});
});

describe("代替テキスト", () => {
	it("入力すると、その画像の alt だけを変えた値を渡す(ほかの要素とロケールはそのまま)", async () => {
		installServer({ previews: { img1: imageEntry("img1"), img2: imageEntry("img2") } });
		const first = imageRef("img1");
		const second = imageRef("img2", { locale: "en", alt: "" });
		const { lastValue } = renderGallery({ initial: [first, second] });
		const user = userEvent.setup();

		await user.type(screen.getByRole("textbox", { name: "代替テキスト(画像 2)" }), "夕日");
		expect(lastValue()).toEqual([first, { ...second, alt: "夕日" }]);
		expect((lastValue() as unknown[])[0]).toBe(first);
	});
});

describe("並べ替え(↑↓ ボタン)", () => {
	it("キーボードで ↓ を押すと 1 つ下へ動かし、同じボタンにフォーカスを残して読み上げる", async () => {
		installServer({ previews: PREVIEWS });
		const { container, lastValue, onValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const user = userEvent.setup();
		const down = screen.getByRole("button", { name: "画像 1 を下へ移動" });
		down.focus();

		await user.keyboard("{Enter}");
		expect(idsOf(lastValue())).toEqual(["img2", "img1", "img3"]);
		expect(screen.getByRole("textbox", { name: "代替テキスト(画像 2)" })).toHaveValue(
			"img1 の説明",
		);
		// 動かした画像のボタンにフォーカスが残る(名前は新しい位置になる)
		expect(document.activeElement).toBe(down);
		expect(down).toHaveAccessibleName("画像 2 を下へ移動");
		expect(galleryAnnouncer(container)).toHaveTextContent(
			"画像を 1 番目から 2 番目に移動しました(全 3 枚)。",
		);

		await user.keyboard(" ");
		expect(idsOf(lastValue())).toEqual(["img2", "img3", "img1"]);
		expect(document.activeElement).toBe(down);
		expect(down).toHaveAccessibleName("画像 3 を下へ移動");
		// 末尾の ↓ は押せないことを伝え(フォーカスは残す)、押しても何もしない
		expect(down).toHaveAttribute("aria-disabled", "true");
		expect(down).toBeEnabled();
		onValue.mockClear();
		await user.keyboard("{Enter}");
		expect(onValue).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(down);
	});

	it("↑ で 1 つ上へ動かす。先頭の ↑ は押せないことを伝え、押しても何もしない", async () => {
		installServer({ previews: PREVIEWS });
		const { container, lastValue, onValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const user = userEvent.setup();

		const firstUp = screen.getByRole("button", { name: "画像 1 を上へ移動" });
		expect(firstUp).toHaveAttribute("aria-disabled", "true");
		expect(firstUp).toHaveClass("cursor-not-allowed", "opacity-50");
		await user.click(firstUp);
		expect(onValue).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "画像 3 を下へ移動" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(screen.getByRole("button", { name: "画像 2 を上へ移動" })).not.toHaveAttribute(
			"aria-disabled",
		);

		const up = screen.getByRole("button", { name: "画像 3 を上へ移動" });
		await user.click(up);
		expect(idsOf(lastValue())).toEqual(["img1", "img3", "img2"]);
		expect(document.activeElement).toBe(up);
		await user.click(up);
		expect(idsOf(lastValue())).toEqual(["img3", "img1", "img2"]);
		expect(document.activeElement).toBe(up);
		expect(up).toHaveAccessibleName("画像 1 を上へ移動");
		expect(up).toHaveAttribute("aria-disabled", "true");
		expect(galleryAnnouncer(container)).toHaveTextContent(
			"画像を 2 番目から 1 番目に移動しました(全 3 枚)。",
		);
	});

	it("同じ文が続いても読まれるよう、読み上げの中身の要素を作り直す", async () => {
		installServer({ previews: PREVIEWS });
		const { container } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "画像 1 を下へ移動" }));
		const first = galleryAnnouncer(container).firstElementChild;
		await user.click(screen.getByRole("button", { name: "画像 1 を下へ移動" }));
		const second = galleryAnnouncer(container).firstElementChild;
		expect(first).toHaveTextContent("画像を 1 番目から 2 番目に移動しました(全 3 枚)。");
		expect(second).toHaveTextContent("画像を 1 番目から 2 番目に移動しました(全 3 枚)。");
		expect(second).not.toBe(first);
	});
});

describe("並べ替え(ドラッグ)", () => {
	it("つまみをドラッグして、ほかの行の下半分に落とすと、その後ろへ動かす", () => {
		installServer({ previews: PREVIEWS });
		const { container, lastValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const [first, , third] = layoutRows() as [HTMLElement, HTMLElement, HTMLElement];
		const handle = handleOf(first);
		expect(handle).toHaveAttribute("draggable", "true");
		expect(handle).toHaveAttribute("title", "ドラッグして並べ替えます");
		// 縮小画像は、つまみと一緒にドラッグする(画像そのもののドラッグを受けない)
		expect(handle.lastElementChild).toHaveStyle({ pointerEvents: "none" });

		const transfer = dragTransfer();
		const start = dispatchDrag("dragstart", handle, transfer);
		expect(start.defaultPrevented).toBe(false);
		expect(transfer.setData).toHaveBeenCalledWith(GALLERY_DRAG_TYPE, "image:img1");
		expect(transfer.effectAllowed).toBe("move");
		expect(first).toHaveClass("opacity-50");

		// 3 行目(200〜300px)の下半分。行の中の要素の上でも、行で判定する
		const over = dispatchDrag(
			"dragover",
			third.querySelector("[data-gallery-title]") ?? third,
			transfer,
			{ clientY: 280 },
		);
		expect(over.defaultPrevented).toBe(true);
		expect(transfer.dropEffect).toBe("move");
		expect(third.style.boxShadow).toBe("0 3px 0 0 var(--color-kumo-brand)");

		const drop = dispatchDrag("drop", third, transfer, { clientY: 280 });
		expect(drop.defaultPrevented).toBe(true);
		dispatchDrag("dragend", handle, transfer);
		expect(idsOf(lastValue())).toEqual(["img2", "img3", "img1"]);
		expect(galleryAnnouncer(container)).toHaveTextContent(
			"画像を 1 番目から 3 番目に移動しました(全 3 枚)。",
		);
		for (const row of screen.getAllByRole("listitem")) {
			expect(row).not.toHaveClass("opacity-50");
			expect(row.style.boxShadow).toBe("");
		}
	});

	it("上半分に落とすと、その前へ動かす", () => {
		installServer({ previews: PREVIEWS });
		const { lastValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const [first, , third] = layoutRows() as [HTMLElement, HTMLElement, HTMLElement];
		const transfer = dragTransfer();

		dispatchDrag("dragstart", handleOf(third), transfer);
		dispatchDrag("dragover", first, transfer, { clientY: 10 });
		expect(first.style.boxShadow).toBe("0 -3px 0 0 var(--color-kumo-brand)");
		dispatchDrag("drop", first, transfer, { clientY: 10 });
		expect(idsOf(lastValue())).toEqual(["img3", "img1", "img2"]);
	});

	it("動かない位置(自分の上・すぐ上の行の下半分)には線を出さず、落としても値を変えない", () => {
		installServer({ previews: PREVIEWS });
		const { onValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const [first, second] = layoutRows() as [HTMLElement, HTMLElement, HTMLElement];
		const transfer = dragTransfer();

		dispatchDrag("dragstart", handleOf(second), transfer);
		dispatchDrag("dragover", second, transfer, { clientY: 110 });
		expect(second.style.boxShadow).toBe("");
		dispatchDrag("dragover", first, transfer, { clientY: 90 });
		expect(first.style.boxShadow).toBe("");
		dispatchDrag("drop", first, transfer, { clientY: 90 });
		dispatchDrag("dragend", handleOf(second), transfer);
		expect(onValue).not.toHaveBeenCalled();
	});

	it("一覧の外へ出たら線を消し、落とさずに終えたら(Escape など)何も変えない", () => {
		installServer({ previews: PREVIEWS });
		const { onValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const [first, , third] = layoutRows() as [HTMLElement, HTMLElement, HTMLElement];
		const transfer = dragTransfer();
		const listBox = screen.getByRole("list", { name: "ギャラリー" }).parentElement as HTMLElement;

		dispatchDrag("dragstart", handleOf(first), transfer);
		dispatchDrag("dragover", third, transfer, { clientY: 280 });
		expect(third.style.boxShadow).not.toBe("");
		// 一覧の中の要素へ移るときは消さない
		dispatchDrag("dragleave", third, transfer, { relatedTarget: first });
		expect(third.style.boxShadow).not.toBe("");
		dispatchDrag("dragleave", listBox, transfer, { relatedTarget: document.body });
		expect(third.style.boxShadow).toBe("");
		dispatchDrag("dragend", handleOf(first), transfer);
		expect(first).not.toHaveClass("opacity-50");
		expect(onValue).not.toHaveBeenCalled();
	});

	it("並べ替えでないドラッグ(ファイル・ほかの widget の行)は、一覧では受け付けない", () => {
		installServer({ previews: PREVIEWS });
		const { onValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2")],
		});
		const [first, second] = layoutRows() as [HTMLElement, HTMLElement];

		// ファイルのドラッグ(Files)
		const files = dragTransfer(["Files"]);
		expect(dispatchDrag("dragover", second, files, { clientY: 190 }).defaultPrevented).toBe(false);
		expect(dispatchDrag("drop", second, files, { clientY: 190 }).defaultPrevented).toBe(false);
		// ほかのギャラリーで始まった並べ替え(この widget では dragstart が無い)
		const other = dragTransfer([GALLERY_DRAG_TYPE]);
		expect(dispatchDrag("dragover", second, other, { clientY: 190 }).defaultPrevented).toBe(false);
		dispatchDrag("drop", second, other, { clientY: 190 });
		expect(second.style.boxShadow).toBe("");
		expect(first.style.boxShadow).toBe("");
		expect(onValue).not.toHaveBeenCalled();
	});

	it("代替テキストの入力中に行が動いても、入力欄のフォーカスを保つ", async () => {
		installServer({ previews: PREVIEWS });
		const { lastValue } = renderGallery({ initial: [imageRef("img1"), imageRef("img2")] });
		const user = userEvent.setup();
		const input = screen.getByRole("textbox", { name: "代替テキスト(画像 1)" });
		input.focus();

		const [first, second] = layoutRows() as [HTMLElement, HTMLElement];
		const transfer = dragTransfer();
		dispatchDrag("dragstart", handleOf(first), transfer);
		dispatchDrag("dragover", second, transfer, { clientY: 190 });
		dispatchDrag("drop", second, transfer, { clientY: 190 });
		expect(idsOf(lastValue())).toEqual(["img2", "img1"]);
		expect(document.activeElement).toBe(input);
		await user.keyboard("!");
		expect(lastValue()).toEqual([imageRef("img2"), imageRef("img1", { alt: "img1 の説明!" })]);
	});
});

describe("削除", () => {
	it("値から外し、次の画像(最後なら前の画像、無くなればドロップゾーン)へフォーカスを移して読み上げる", async () => {
		installServer({ previews: PREVIEWS });
		const { container, lastValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "画像 2 を削除" }));
		expect(idsOf(lastValue())).toEqual(["img1", "img3"]);
		expectFocusOnTitle("画像 2");
		expect(screen.getByRole("textbox", { name: "代替テキスト(画像 2)" })).toHaveValue(
			"img3 の説明",
		);
		expect(galleryAnnouncer(container)).toHaveTextContent(
			"2 番目の画像を削除しました(残り 2 枚)。",
		);

		await user.click(screen.getByRole("button", { name: "画像 2 を削除" }));
		expect(idsOf(lastValue())).toEqual(["img1"]);
		expectFocusOnTitle("画像 1");

		await user.click(screen.getByRole("button", { name: "画像 1 を削除" }));
		// 空の配列にする(null にしない)
		expect(lastValue()).toEqual([]);
		expect(screen.queryByRole("list")).not.toBeInTheDocument();
		expect(document.activeElement).toBe(zoneButton());
		expect(galleryAnnouncer(container)).toHaveTextContent(
			"1 番目の画像を削除しました(残り 0 枚)。",
		);
	});

	it("プレビューの状態が変わっても(読み込み中 → 見つからない)、行のボタンを作り直さない", async () => {
		const response = deferred<Response>();
		installServer({ preview: () => response.promise });
		renderGallery({ initial: [imageRef("img1"), imageRef("img2")] });
		const down = screen.getByRole("button", { name: "画像 1 を下へ移動" });
		down.focus();

		await act(async () => {
			response.resolve(success({ items: [{ id: "img1", image: null }] }));
			await response.promise;
		});
		await waitFor(() => expect(screen.getAllByText("画像が見つかりません")).toHaveLength(2));
		expect(down.isConnected).toBe(true);
		expect(document.activeElement).toBe(down);
	});
});

// ---------------------------------------------------------------------------
// 追加(アップロード)
// ---------------------------------------------------------------------------

interface ManualUploads {
	/** 次の応答を返す(受けた順)。`respond` を省くと成功の応答 */
	release(index: number, respond?: (call: UploadCall, index: number) => Response): Promise<void>;
}

/** アップロードの応答を、テストから 1 つずつ返す */
function manualUploads(): { readonly server: Server; readonly uploads: ManualUploads } {
	const pending: PromiseWithResolvers<Response>[] = [];
	const server = installServer({
		previews: PREVIEWS,
		upload: (call) => {
			const gate = deferred<Response>();
			call.signal?.addEventListener("abort", () => gate.reject(call.signal?.reason), {
				once: true,
			});
			pending.push(gate);
			return gate.promise;
		},
	});
	return {
		server,
		uploads: {
			async release(index, respond = uploaded) {
				await waitFor(() => expect(server.uploads.length).toBeGreaterThan(index));
				const call = server.uploads[index] as UploadCall;
				await act(async () => {
					pending[index]?.resolve(respond(call, index));
					await new Promise((resolve) => setTimeout(resolve, 0));
				});
			},
		},
	};
}

describe("追加(アップロード)", () => {
	it("複数のファイルを 1 枚ずつ順に処理し、終わるたびに値の後ろへ足す", async () => {
		const { server, uploads } = manualUploads();
		const { container, lastValue } = renderGallery({ initial: [imageRef("img1")] });
		const zone = zoneButton();
		zone.focus();

		selectFiles(zoneInput(container), [pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
		// 処理中はドロップゾーンを押せず、フォーカスをキャンセルボタンへ移す
		await waitFor(() => expect(server.uploads).toHaveLength(1));
		expect(zone).toBeDisabled();
		const cancel = screen.getByRole("button", { name: "キャンセル" });
		expect(document.activeElement).toBe(cancel);
		expect(screen.getByText("1 / 3 枚目")).toBeInTheDocument();
		expect(screen.getByText("a.png")).toBeInTheDocument();
		expect(progressAnnouncer(container)).toHaveTextContent(
			"3 枚中 1 枚目: 画像をアップロードしています。",
		);
		// 処理中の枚数は「あと何枚」から引く
		expect(zone).toHaveAccessibleDescription(
			expect.stringContaining("あと 6 枚追加できます(最大 10 枚)。"),
		);

		// 1 枚目の応答が届くと値に足し、2 枚目を送る(同時に送るのは 1 枚)
		await uploads.release(0);
		expect(idsOf(lastValue())).toEqual(["img1", "new1"]);
		await waitFor(() => expect(server.uploads).toHaveLength(2));
		expect(screen.getByText("2 / 3 枚目")).toBeInTheDocument();
		await uploads.release(1);
		expect(idsOf(lastValue())).toEqual(["img1", "new1", "new2"]);
		await uploads.release(2);
		await waitFor(() => expect(zone).toBeEnabled());

		// 応答の参照をそのまま値にする(alt は空、locale は画像エントリのロケールのまま)
		expect(lastValue()).toEqual([
			imageRef("img1"),
			{ v: 1, id: "new1", locale: "en", width: 1600, height: 1200, alt: "" },
			{ v: 1, id: "new2", locale: "en", width: 1600, height: 1200, alt: "" },
			{ v: 1, id: "new3", locale: "en", width: 1600, height: 1200, alt: "" },
		]);
		expect(server.uploads.map((call) => call.request.filename)).toEqual([
			"a.png",
			"b.png",
			"c.png",
		]);
		expect(server.uploads[0]?.request.target).toEqual({
			collection: "posts",
			field: "gallery",
			entryId: ENTRY_ID,
			locale: "ja",
		});
		// 追加したばかりの画像は、手元の data URL を出す(プレビューを取得しない)
		expect(server.previewRequests).toEqual([["img1"]]);
		const images = Array.from(container.querySelectorAll("img"));
		expect(images.map((image) => image.getAttribute("src"))).toEqual([
			PREVIEWS["img1"]?.src,
			...server.uploads.map((call) => call.request.dataUrl),
		]);
		expect(rowTitles()).toEqual(["画像 1", "画像 2", "画像 3", "画像 4"]);
		expect(progressAnnouncer(container)).toHaveTextContent("3 枚の画像を追加しました。");
		expect(screen.queryByRole("button", { name: "キャンセル" })).not.toBeInTheDocument();
		// キャンセルボタンが消えたので、ドロップゾーンへ戻す
		expect(document.activeElement).toBe(zone);
		expect(zone).toHaveAccessibleDescription(
			expect.stringContaining("あと 6 枚追加できます(最大 10 枚)。"),
		);
	});

	it("1 枚が失敗しても残りを処理し、失敗したファイルは値に加えずにエラーを出す", async () => {
		const server = installServer({
			previews: PREVIEWS,
			upload: (call, index) =>
				index === 1 ? routeError("UPLOAD_FAILED", 500) : uploaded(call, index),
		});
		const { container, lastValue } = renderGallery({ initial: null });
		const user = userEvent.setup();
		zoneButton().focus();

		dropFiles([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
		await waitFor(() => expect(zoneButton()).toBeEnabled());
		expect(server.uploads).toHaveLength(3);
		expect(idsOf(lastValue())).toEqual(["new1", "new3"]);
		expect(errorFor("b.png")).toHaveTextContent(ERROR_MESSAGES.ja.UPLOAD_FAILED);
		expect(alertTexts()).toEqual([`b.png${ERROR_MESSAGES.ja.UPLOAD_FAILED}閉じる`]);
		expect(progressAnnouncer(container)).toHaveTextContent("2 枚の画像を追加しました。");
		expect(document.activeElement).toBe(zoneButton());

		// エラーを閉じると、ほかにエラーが無ければドロップゾーンへフォーカスを移す
		await user.click(within(errorFor("b.png")).getByRole("button", { name: "エラーを閉じる" }));
		expect(alertTexts()).toEqual([]);
		expect(document.activeElement).toBe(zoneButton());
	});

	it("HEIC などの受け付けない形式は、ほかのファイルの処理を待たずに失敗として出す", async () => {
		const { server, uploads } = manualUploads();
		const { lastValue } = renderGallery({ initial: null });

		dropFiles([pngFile("a.png"), heicFile("IMG_0001.HEIC"), pngFile("c.png")]);
		await waitFor(() =>
			expect(errorFor("IMG_0001.HEIC")).toHaveTextContent(ERROR_MESSAGES.ja.INPUT_HEIC_REJECTED),
		);
		// 1 枚目はまだ送信中
		expect(server.uploads).toHaveLength(1);
		expect(screen.getByText("1 / 2 枚目")).toBeInTheDocument();

		await uploads.release(0);
		await uploads.release(1);
		await waitFor(() => expect(zoneButton()).toBeEnabled());
		expect(idsOf(lastValue())).toEqual(["new1", "new2"]);
		expect(server.uploads.map((call) => call.request.filename)).toEqual(["a.png", "c.png"]);
	});

	it("上限を超える分は処理せず、ファイルごとに失敗として出す。上限に達したら、最後の画像へフォーカスを移す", async () => {
		const server = installServer({ previews: PREVIEWS });
		const { lastValue } = renderGallery({ initial: [imageRef("img1")], options: { maxItems: 3 } });
		const user = userEvent.setup();
		expect(zoneButton()).toHaveAccessibleDescription(
			expect.stringContaining("あと 2 枚追加できます(最大 3 枚)。"),
		);
		zoneButton().focus();

		dropFiles([pngFile("a.png"), pngFile("b.png"), pngFile("c.png"), pngFile("d.png")]);
		await waitFor(() => expect(idsOf(lastValue())).toEqual(["img1", "new1", "new2"]));
		await waitFor(() => expect(screen.queryByRole("button", { name: "キャンセル" })).toBeNull());
		expect(server.uploads).toHaveLength(2);
		for (const name of ["c.png", "d.png"]) {
			expect(errorFor(name)).toHaveTextContent(ERROR_MESSAGES.ja.GALLERY_TOO_MANY_ITEMS);
		}
		expect(zoneButton()).toBeDisabled();
		expect(zoneButton()).toHaveAccessibleDescription(
			expect.stringContaining("上限の 3 枚に達しています。追加するには、画像を削除してください。"),
		);
		// ドロップゾーンを押せないので、最後の画像の見出しへ
		expectFocusOnTitle("画像 3");

		// 2 件以上のエラーは、まとめて閉じられる
		await user.click(screen.getByRole("button", { name: "エラーをすべて閉じる" }));
		expect(alertTexts()).toEqual([]);
		expect(screen.queryByRole("button", { name: "エラーをすべて閉じる" })).not.toBeInTheDocument();
		expectFocusOnTitle("画像 3");
	});

	it("処理中でも並べ替え・削除・代替テキストはでき、終わった画像は最新の値の後ろに足す", async () => {
		const { server, uploads } = manualUploads();
		const { lastValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const user = userEvent.setup();

		dropFiles([pngFile("a.png")]);
		await waitFor(() => expect(server.uploads).toHaveLength(1));
		// 処理中は、差し替えとドロップゾーンを押せない
		expect(screen.getByRole("button", { name: "画像 1 を差し替え" })).toBeDisabled();
		expect(zoneButton()).toBeDisabled();

		await user.click(screen.getByRole("button", { name: "画像 1 を下へ移動" }));
		await user.click(screen.getByRole("button", { name: "画像 3 を削除" }));
		await user.type(screen.getByRole("textbox", { name: "代替テキスト(画像 1)" }), "!");
		expect(idsOf(lastValue())).toEqual(["img2", "img1"]);

		await uploads.release(0);
		expect(lastValue()).toEqual([
			imageRef("img2", { alt: "img2 の説明!" }),
			imageRef("img1"),
			{ v: 1, id: "new1", locale: "en", width: 1600, height: 1200, alt: "" },
		]);
	});

	it("処理中に値が外から変わったら(保存のあとなど)、終わった画像は新しい値の後ろに足す", async () => {
		const { server, uploads } = manualUploads();
		const harness = createRef<HarnessHandle>();
		const { lastValue } = renderGallery({ initial: [imageRef("img1")], ref: harness });

		dropFiles([pngFile("a.png")]);
		await waitFor(() => expect(server.uploads).toHaveLength(1));
		act(() => harness.current?.setValue([imageRef("img9")]));
		expect(rowTitles()).toEqual(["画像 1"]);
		await uploads.release(0);
		expect(idsOf(lastValue())).toEqual(["img9", "new1"]);
	});

	it("キャンセルすると、送信中の要求を中断し、値を変えずにドロップゾーンへフォーカスを戻す", async () => {
		const server = installServer({ previews: PREVIEWS, upload: hangUntilAborted });
		const { container, onValue } = renderGallery({ initial: [imageRef("img1")] });
		const user = userEvent.setup();
		zoneButton().focus();

		selectFiles(zoneInput(container), [pngFile("a.png"), pngFile("b.png")]);
		await waitFor(() => expect(server.uploads).toHaveLength(1));
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "キャンセル" }));

		await user.keyboard("{Enter}");
		await waitFor(() => expect(zoneButton()).toBeEnabled());
		expect(server.uploads[0]?.signal?.aborted).toBe(true);
		expect(server.uploads).toHaveLength(1);
		expect(onValue).not.toHaveBeenCalled();
		// キャンセルはエラーにしない
		expect(alertTexts()).toEqual([]);
		expect(progressAnnouncer(container)).toHaveTextContent("");
		expect(document.activeElement).toBe(zoneButton());
	});

	it("処理中にほかの場所へフォーカスを移していたら、終わったときに動かさない", async () => {
		const { server, uploads } = manualUploads();
		renderGallery({ initial: [imageRef("img1")] });
		zoneButton().focus();

		dropFiles([pngFile("a.png")]);
		await waitFor(() => expect(server.uploads).toHaveLength(1));
		const input = screen.getByRole("textbox", { name: "代替テキスト(画像 1)" });
		input.focus();
		await uploads.release(0);
		await waitFor(() => expect(zoneButton()).toBeEnabled());
		expect(document.activeElement).toBe(input);
	});

	it("新しい処理を始めると、前の処理のエラーと注意を消す", async () => {
		const server = installServer({ previews: PREVIEWS });
		const { lastValue } = renderGallery({ initial: null });

		dropFiles([heicFile("IMG_0001.HEIC"), gifFile("anim.gif")]);
		await waitFor(() => expect(idsOf(lastValue())).toEqual(["new1"]));
		await waitFor(() => expect(zoneButton()).toBeEnabled());
		expect(errorFor("IMG_0001.HEIC")).toHaveTextContent(ERROR_MESSAGES.ja.INPUT_HEIC_REJECTED);
		// GIF の注意は、処理が終わっても出しておく
		const notice = screen.getByText(NOTICE_MESSAGES.ja.GIF_FIRST_FRAME_ONLY);
		expect(notice.closest("[aria-live]")).toHaveTextContent("anim.gif");

		dropFiles([pngFile("a.png")]);
		await waitFor(() => expect(idsOf(lastValue())).toEqual(["new1", "new2"]));
		expect(screen.queryByText("IMG_0001.HEIC")).not.toBeInTheDocument();
		expect(screen.queryByText(NOTICE_MESSAGES.ja.GIF_FIRST_FRAME_ONLY)).not.toBeInTheDocument();
		expect(server.uploads).toHaveLength(2);
	});

	it("編集画面の外(保存先を求められない)では、ファイルごとに INVALID_TARGET を出し、送らない", async () => {
		window.history.replaceState(null, "", "/_emdash/admin/plugins/base64-image/images");
		const server = installServer({ previews: PREVIEWS });
		const { onValue } = renderGallery({ initial: null });

		dropFiles([pngFile("a.png")]);
		await waitFor(() =>
			expect(errorFor("a.png")).toHaveTextContent(ERROR_MESSAGES.ja.INVALID_TARGET),
		);
		expect(server.uploads).toHaveLength(0);
		expect(onValue).not.toHaveBeenCalled();
	});

	it("StrictMode でも、アップロードと並べ替えができる", async () => {
		const server = installServer({ previews: PREVIEWS });
		const onValue = vi.fn<(value: unknown) => void>();
		render(
			<StrictMode>
				<Harness initial={[imageRef("img1")]} onValue={onValue} />
			</StrictMode>,
		);
		const user = userEvent.setup();

		dropFiles([pngFile("a.png")]);
		await waitFor(() => expect(idsOf(onValue.mock.lastCall?.[0])).toEqual(["img1", "new1"]));
		await user.click(screen.getByRole("button", { name: "画像 2 を上へ移動" }));
		expect(idsOf(onValue.mock.lastCall?.[0])).toEqual(["new1", "img1"]);
		expect(server.uploads).toHaveLength(1);
		// StrictMode では effect が 2 回動き、1 回目の要求は中断される(T23)。追加した画像は取得しない
		expect(new Set(server.previewRequests.flat())).toEqual(new Set(["img1"]));
	});
});

// ---------------------------------------------------------------------------
// 差し替え
// ---------------------------------------------------------------------------

describe("差し替え", () => {
	it("その位置の参照を新しい画像にし(代替テキストは空にする)、差し替えボタンへフォーカスを戻す", async () => {
		const server = installServer({ previews: PREVIEWS });
		const { container, lastValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const replace = screen.getByRole("button", { name: "画像 2 を差し替え" });
		replace.focus();

		selectFiles(replaceInput(replace), [pngFile("new.png")]);
		await waitFor(() => expect(lastValue()).toBeDefined());
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "画像 2 を差し替え" })).toBeEnabled(),
		);
		// 前の画像の説明を、新しい画像に残さない(T27 と同じ)。ほかの画像の代替テキストはそのまま
		expect(lastValue()).toEqual([
			imageRef("img1"),
			{ v: 1, id: "new1", locale: "en", width: 1600, height: 1200, alt: "" },
			imageRef("img3"),
		]);
		expect(screen.getByRole("textbox", { name: "代替テキスト(画像 2)" })).toHaveValue("");
		expect(server.uploads).toHaveLength(1);
		expect(galleryAnnouncer(container)).toHaveTextContent("2 番目の画像を差し替えました。");
		// 差し替えは「追加しました」と読み上げない
		expect(progressAnnouncer(container)).toHaveTextContent("");
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "画像 2 を差し替え" }));
		expect(container.querySelectorAll("img")[1]).toHaveAttribute(
			"src",
			server.uploads[0]?.request.dataUrl,
		);
	});

	it("差し替えに失敗したら、値を変えずにエラーを出す", async () => {
		installServer({ previews: PREVIEWS });
		const { onValue } = renderGallery({ initial: [imageRef("img1")] });
		const replace = screen.getByRole("button", { name: "画像 1 を差し替え" });
		replace.focus();

		selectFiles(replaceInput(replace), [heicFile("IMG_0002.HEIC")]);
		await waitFor(() =>
			expect(errorFor("IMG_0002.HEIC")).toHaveTextContent(ERROR_MESSAGES.ja.INPUT_HEIC_REJECTED),
		);
		expect(onValue).not.toHaveBeenCalled();
	});

	it("差し替えを待っている画像を削除すると、差し替えを取り消す", async () => {
		const server = installServer({ previews: PREVIEWS, upload: hangUntilAborted });
		const { lastValue } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")],
		});
		const user = userEvent.setup();
		const replace = screen.getByRole("button", { name: "画像 2 を差し替え" });

		selectFiles(replaceInput(replace), [pngFile("new.png")]);
		await waitFor(() => expect(server.uploads).toHaveLength(1));
		await user.click(screen.getByRole("button", { name: "画像 2 を削除" }));
		expect(idsOf(lastValue())).toEqual(["img1", "img3"]);
		await waitFor(() => expect(zoneButton()).toBeEnabled());
		expect(server.uploads[0]?.signal?.aborted).toBe(true);
		expect(idsOf(lastValue())).toEqual(["img1", "img3"]);
		expect(alertTexts()).toEqual([]);
		expectFocusOnTitle("画像 2");
	});
});

// ---------------------------------------------------------------------------
// 編集ロック(EmDash の <fieldset disabled>)
// ---------------------------------------------------------------------------

/** EmDash 0.39.1 の編集画面と同じく、フィールドを fieldset で包む(`ContentEditor.tsx:1336`)。ロック中は disabled */
function inFieldset(field: ReactNode): ReactNode {
	return <fieldset>{field}</fieldset>;
}

function lockFieldset(container: HTMLElement): void {
	const fieldset = container.querySelector("fieldset");
	if (fieldset === null) throw new Error("fieldset not found");
	fieldset.disabled = true;
}

describe("編集ロック中(EmDash がフィールドを <fieldset disabled> で包む)", () => {
	it("ボタンと入力欄は無効になり、枠へのファイルのドロップを受け付けない(送らず、値を変えない)", async () => {
		const server = installServer({ previews: PREVIEWS });
		const { container, onValue } = renderGallery(
			{ initial: [imageRef("img1"), imageRef("img2")] },
			inFieldset,
		);
		lockFieldset(container);
		await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));

		expect(zoneButton()).toBeDisabled();
		for (const name of [
			"画像 1 を下へ移動",
			"画像 2 を上へ移動",
			"画像 1 を差し替え",
			"画像 2 を削除",
		]) {
			expect(screen.getByRole("button", { name })).toBeDisabled();
		}
		expect(screen.getByRole("textbox", { name: "代替テキスト(画像 1)" })).toBeDisabled();

		dropFiles([pngFile("a.png")]);
		// ロックの前に開いたファイルの選択画面から、ロックのあとで選ばれたとき
		selectFiles(zoneInput(container), [pngFile("b.png")]);
		selectFiles(replaceInput(screen.getByRole("button", { name: "画像 1 を差し替え" })), [
			pngFile("c.png"),
		]);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(server.uploads).toHaveLength(0);
		expect(screen.queryByRole("button", { name: "キャンセル" })).not.toBeInTheDocument();
		expect(onValue).not.toHaveBeenCalled();
	});

	it("つまみのドラッグを始めさせない。ロックの前に始まったドラッグも、落とす位置を受け付けない", () => {
		installServer({ previews: PREVIEWS });
		const { container, onValue } = renderGallery(
			{ initial: [imageRef("img1"), imageRef("img2"), imageRef("img3")] },
			inFieldset,
		);
		const [first, second, third] = layoutRows() as [HTMLElement, HTMLElement, HTMLElement];

		// ロックの前に 1 枚目のドラッグを始め、ロックされてから 3 枚目の下半分に落とす
		const early = dragTransfer();
		dispatchDrag("dragstart", handleOf(first), early);
		lockFieldset(container);
		expect(dispatchDrag("dragover", third, early, { clientY: 280 }).defaultPrevented).toBe(false);
		expect(third).not.toHaveAttribute("style");
		dispatchDrag("drop", third, early, { clientY: 280 });
		dispatchDrag("dragend", handleOf(first), early);
		expect(onValue).not.toHaveBeenCalled();

		// ロック中は、ドラッグを始めない(運ぶデータを入れず、行も薄くしない)
		const late = dragTransfer();
		expect(dispatchDrag("dragstart", handleOf(second), late).defaultPrevented).toBe(true);
		expect(late.types).toEqual([]);
		expect(second).not.toHaveClass("opacity-50");
	});
});

// ---------------------------------------------------------------------------
// 見た目
// ---------------------------------------------------------------------------

/**
 * 描画した DOM のクラスが、すべて管理画面の CSS にあること(T22-1 の補助)。
 * ソースの語は、この widget と、中で使う T22 の部品のもの
 */
function expectAllClassesInAdminCss(container: HTMLElement): void {
	const missing = findMissingClasses(
		container,
		sourceTokens("src/admin/GalleryField.tsx", "src/admin/parts"),
	);
	expect(missing.fromSource).toEqual([]);
	expect(missing.unknown).toEqual([]);
}

describe("見た目", () => {
	it("使うクラスは、管理画面の CSS にある(画像・見つからない・壊れた要素・重複・上限超え・ドラッグ中)", async () => {
		installServer({ previews: { img1: imageEntry("img1"), img2: null } });
		const { container } = renderGallery({
			initial: [imageRef("img1"), imageRef("img2"), { broken: true }, imageRef("img1")],
			options: { maxItems: 3 },
		});
		await waitFor(() => expect(screen.getByText("画像が見つかりません")).toBeInTheDocument());
		const [first, , third] = layoutRows() as [HTMLElement, HTMLElement, HTMLElement];
		const transfer = dragTransfer();
		dispatchDrag("dragstart", handleOf(first), transfer);
		dispatchDrag("dragover", third, transfer, { clientY: 280 });
		expect(first).toHaveClass("opacity-50");
		expectAllClassesInAdminCss(container);
	});

	it("使うクラスは、管理画面の CSS にある(配列でない値・プレビューの失敗・処理中・エラー)", async () => {
		installServer({ previews: PREVIEWS, upload: hangUntilAborted });
		const unsupported = renderGallery({ initial: imageRef("img1") });
		expectAllClassesInAdminCss(unsupported.container);
		cleanup();

		vi.unstubAllGlobals();
		installServer({ preview: () => routeError("INTERNAL_ERROR", 500), upload: hangUntilAborted });
		const { container } = renderGallery({ initial: [imageRef("img1")] });
		await screen.findByText("読み込めませんでした");
		dropFiles([heicFile("IMG_0001.HEIC"), gifFile("anim.gif"), pngFile("a.png")]);
		await waitFor(() =>
			expect(screen.getByText(NOTICE_MESSAGES.ja.GIF_FIRST_FRAME_ONLY)).toBeInTheDocument(),
		);
		await screen.findByText(ERROR_MESSAGES.ja.INPUT_HEIC_REJECTED);
		expect(screen.getByRole("button", { name: "キャンセル" })).toBeInTheDocument();
		expectAllClassesInAdminCss(container);
	});
});
