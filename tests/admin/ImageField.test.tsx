// 単一画像の widget(src/admin/ImageField.tsx。T27)のテスト。
//
// - 本物のフック(T23)・部品(T22)・API クライアント(T14)・入力の判定とデコード(T12)・圧縮とサムネイル(T13)を通す。
//   jsdom に無いブラウザの機能だけを偽物にする: `createImageBitmap`(デコードと縮小)、canvas の `getContext` / `toBlob`
//   (WebP のエンコード)、`fetch`(アップロードとプレビューのルート)。
// - EmDash の管理画面と同じく、`onChange` で受け取った値を `value` に戻す親(`renderField` の中の部品)で描く。
// - 管理画面の URL(`/_emdash/admin/content/posts/<ID>?locale=ja`)は `history.replaceState` で作る(アップロードの保存先)。
// - act の外での状態の変化(React の警告)があれば、テストを失敗にする(console.error を見張る。docs/react-hook-testing-pitfalls.md)。

import type { PluginAdminModule } from "@emdash-cms/admin";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { ImageField, readImageFieldValue } from "../../src/admin/ImageField";
import { ERROR_MESSAGES, NOTICE_MESSAGES } from "../../src/client/error-messages";
import { MAX_ALT_LENGTH } from "../../src/shared/constants";
import { uploadRequestSchema } from "../../src/shared/schema";
import type { Base64ImageEntry, Base64ImageRef, UploadRequest } from "../../src/shared/types";
import { findMissingClasses, sourceTokens } from "./admin-css";

// ---------------------------------------------------------------------------
// 値
// ---------------------------------------------------------------------------

/** 編集中の投稿のエントリ ID */
const ENTRY_ID = "01J8Z3K4M5N6P7Q8R9S0T1V2W4";
/** 保存済みの画像の ID */
const SAVED_ID = "01J8Z3K4M5N6P7Q8R9S0IMG000";
/** アップロードで作られる画像の ID */
const NEW_ID = "01J8Z3K4M5N6P7Q8R9S0IMG001";
const EDIT_URL = `/_emdash/admin/content/posts/${ENTRY_ID}?locale=ja`;
/**
 * 画像エントリのロケール(サイトの既定)。編集中のエントリ(`?locale=ja`)と違う値にして、widget が書き換えないことを確かめる
 */
const IMAGE_LOCALE = "en";
/** 保存済みの画像の data URL。長さ 98,200(保存サイズ 98.2KB)。スキーマは形だけを確かめるので、中身は WebP でなくてよい */
const SAVED_SRC = `data:image/webp;base64,${"A".repeat(98_200 - 23)}`;

const SAVED_REF: Base64ImageRef = {
	v: 1,
	id: SAVED_ID,
	locale: IMAGE_LOCALE,
	width: 1280,
	height: 853,
	alt: "赤い花",
};

const SAVED_ENTRY: Base64ImageEntry = {
	src: SAVED_SRC,
	mimeType: "image/webp",
	width: 1280,
	height: 853,
	meta: { v: 1, bytes: 73_632, quality: 0.77 },
};

/** 参照の形でない値(seed や手での書き換え)。どれも保存 hook が拒否する */
const INVALID_VALUES: readonly (readonly [string, unknown])[] = [
	["空文字", ""],
	["文字列(画像の ID)", SAVED_ID],
	["数値", 0],
	["false", false],
	["空の配列", []],
	["ギャラリーの形(参照の配列)", [SAVED_REF]],
	["空のオブジェクト", {}],
	["alt が無い", { v: 1, id: SAVED_ID, locale: IMAGE_LOCALE, width: 1280, height: 853 }],
	["知らないキーがある", { ...SAVED_REF, src: SAVED_SRC }],
	["バージョンが違う", { ...SAVED_REF, v: 2 }],
	["ID の形でない", { ...SAVED_REF, id: "../posts" }],
	["寸法が 0", { ...SAVED_REF, width: 0 }],
	["代替テキストが上限を超える", { ...SAVED_REF, alt: "あ".repeat(MAX_ALT_LENGTH + 1) }],
];

// ---------------------------------------------------------------------------
// 偽のサーバー(本物の API クライアントが送る fetch を受ける)
// ---------------------------------------------------------------------------

const PLUGIN_API = "/_emdash/api/plugins/base64-image";
const UPLOAD_URL = `${PLUGIN_API}/upload`;
const PREVIEW_URL = `${PLUGIN_API}/preview`;

interface SentRequest {
	readonly url: string;
	readonly method: string;
	readonly body: unknown;
	readonly signal: AbortSignal | undefined;
}

type Handler = (request: SentRequest) => Response | Promise<Response>;

const routes = new Map<string, Handler>();
const sent: SentRequest[] = [];
const fetchMock = vi.fn<typeof fetch>();
/** プレビューのルートが返す画像(無い ID は `image: null`) */
const savedImages = new Map<string, Base64ImageEntry>();

function route(url: string, handler: Handler): void {
	routes.set(url, handler);
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function success(data: unknown): Response {
	return json({ success: true, data });
}

function apiError(code: string, status: number): Response {
	return json({ success: false, error: { code, message: `${code} (test)` } }, status);
}

/** アップロードのルート。入力をルートと同じスキーマで確かめ、送られた寸法で参照を返す(`alt` は空、`locale` は画像のもの) */
function acceptUpload(request: SentRequest): Response {
	const parsed = uploadRequestSchema.safeParse(request.body);
	if (parsed.success === false) return apiError("VALIDATION_ERROR", 400);
	const { width, height } = parsed.data;
	return success({ ref: { v: 1, id: NEW_ID, locale: IMAGE_LOCALE, width, height, alt: "" } });
}

/** プレビューのルート(`savedImages` から返す) */
function servePreviews(request: SentRequest): Response {
	const { ids } = request.body as { ids: string[] };
	return success({ items: ids.map((id) => ({ id, image: savedImages.get(id) ?? null })) });
}

interface GatedHandler {
	readonly handler: Handler;
	/** 応答を返させる */
	readonly release: () => void;
}

/**
 * 応答の時をテストから決める。既定では、中断されたら fetch と同じく reject する。
 * `ignoreAbort` なら中断に応えず、`release` のあとで応答する(中断のあとに届く応答)。
 */
function gated(handler: Handler, { ignoreAbort = false } = {}): GatedHandler {
	const gate = Promise.withResolvers<void>();
	return {
		handler: (request) =>
			new Promise<Response>((resolve, reject) => {
				if (!ignoreAbort) {
					request.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("The operation was aborted.", "AbortError")),
						{ once: true },
					);
				}
				void gate.promise.then(() => resolve(handler(request)));
			}),
		release: () => gate.resolve(),
	};
}

function requestsTo(url: string): SentRequest[] {
	return sent.filter((request) => request.url === url);
}

function uploadBodies(): UploadRequest[] {
	return requestsTo(UPLOAD_URL).map((request) => request.body as UploadRequest);
}

// ---------------------------------------------------------------------------
// 偽のブラウザの機能(createImageBitmap と canvas)
// ---------------------------------------------------------------------------

/** 偽のエンコーダーが予算に収める最高の画質。既定の options では、本体は 1600px・0.77、サムネイルは 96px・0.77 になる */
const FIT_QUALITY = 0.77;

interface EncodeCall {
	readonly width: number;
	readonly height: number;
	readonly quality: number;
}

/** 偽の createImageBitmap がデコードで返す寸法 */
const decodedSizes = new WeakMap<Blob, { readonly width: number; readonly height: number }>();
/** デコードの完了を待たせる(テストごとに設定する) */
let decodeGate: (() => Promise<void>) | undefined;
/** エンコード(`toBlob`)の完了を待たせる(テストごとに設定する) */
let encodeGate: ((call: EncodeCall, index: number) => Promise<void> | undefined) | undefined;
const encodeCalls: EncodeCall[] = [];
const bitmaps: { width: number; height: number }[] = [];

function fakeBitmap(width: number, height: number): ImageBitmap {
	const bitmap = {
		width,
		height,
		close: () => {
			bitmap.width = 0;
			bitmap.height = 0;
		},
	};
	bitmaps.push(bitmap);
	return bitmap as unknown as ImageBitmap;
}

/**
 * - `createImageBitmap(file)`(デコード): `decodedSizes` の寸法の ImageBitmap。`createImageBitmap(bitmap, { resizeWidth, … })`
 *   (縮小): その寸法の ImageBitmap。
 * - canvas の `toBlob`: 画質が `FIT_QUALITY` 以下なら長辺と同じバイト数(予算に収まる)、超えると 80,000 バイト
 *   (本体の 74,982 バイトとサムネイルの 5,982 バイトのどちらも超える)の WebP の Blob。
 */
function installBrowserFakes(): void {
	vi.stubGlobal("createImageBitmap", async (image: unknown, options?: ImageBitmapOptions) => {
		if (image instanceof Blob) {
			await decodeGate?.();
			const size = decodedSizes.get(image) ?? { width: 8, height: 6 };
			return fakeBitmap(size.width, size.height);
		}
		return fakeBitmap(options?.resizeWidth ?? 1, options?.resizeHeight ?? 1);
	});
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
		() => ({ drawImage: () => {} }) as never,
	);
	vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function toBlob(
		this: HTMLCanvasElement,
		callback: BlobCallback,
		_type?: string,
		quality?: unknown,
	) {
		const call: EncodeCall = { width: this.width, height: this.height, quality: Number(quality) };
		const index = encodeCalls.push(call) - 1;
		const deliver = async (): Promise<void> => {
			await encodeGate?.(call, index);
			const size = call.quality <= FIT_QUALITY + 1e-9 ? Math.max(call.width, call.height) : 80_000;
			callback(new Blob([new Uint8Array(size)], { type: "image/webp" }));
		};
		void deliver();
	});
}

/** PNG のシグネチャ */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** IHDR の残り(ビット深度 8、RGBA、圧縮・フィルター・インターレースは 0) */
const PNG_IHDR_TAIL = [8, 6, 0, 0, 0];

// ---------------------------------------------------------------------------
// 入力ファイル(ヘッダーだけの本物のバイト列。形式と画素数の判定は本物のまま動く)
// ---------------------------------------------------------------------------

const u32be = (value: number): number[] => [
	(value >>> 24) & 0xff,
	(value >>> 16) & 0xff,
	(value >>> 8) & 0xff,
	value & 0xff,
];
const u16le = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

/** シグネチャと IHDR・IEND だけの PNG(ビット深度 8、RGBA) */
function pngFile(name = "photo.png", width = 4000, height = 3000): File {
	const bytes = Uint8Array.from([
		...PNG_SIGNATURE,
		...u32be(13),
		...ascii("IHDR"),
		...u32be(width),
		...u32be(height),
		...PNG_IHDR_TAIL,
		...u32be(0),
		...u32be(0),
		...ascii("IEND"),
		...u32be(0),
	]);
	const file = new File([bytes], name, { type: "image/png" });
	decodedSizes.set(file, { width, height });
	return file;
}

/** 論理画面だけの GIF */
function gifFile(name = "anim.gif", width = 120, height = 80): File {
	const bytes = Uint8Array.from([
		...ascii("GIF89a"),
		...u16le(width),
		...u16le(height),
		0,
		0,
		0,
		0x3b,
	]);
	const file = new File([bytes], name, { type: "image/gif" });
	decodedSizes.set(file, { width, height });
	return file;
}

/** iPhone の HEIC と同じ ftyp(major brand `heic`) */
function heicFile(name = "IMG_0001.HEIC"): File {
	const bytes = Uint8Array.from([
		...u32be(24),
		...ascii("ftyp"),
		...ascii("heic"),
		...u32be(0),
		...ascii("mif1"),
		...ascii("heic"),
	]);
	return new File([bytes], name, { type: "image/heic" });
}

/** jsdom には DataTransfer が無いので、ドロップゾーンが読むプロパティだけを持つ偽物を作る(T22 のテストと同じ) */
function fakeTransfer(files: readonly File[]): DataTransfer {
	return {
		files: [...files],
		items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
		types: files.length > 0 ? ["Files"] : [],
		dropEffect: "none",
	} as unknown as DataTransfer;
}

// ---------------------------------------------------------------------------
// 描画と操作の道具
// ---------------------------------------------------------------------------

interface RenderFieldOptions {
	readonly value?: unknown;
	readonly options?: unknown;
	readonly id?: string;
	readonly label?: string;
	/** `reactStrictMode`(effect を 2 回動かす) */
	readonly strict?: boolean;
	/** widget を包む要素(編集ロックの `<fieldset disabled>`、ほかの入力欄など) */
	readonly wrap?: (field: ReactNode) => ReactNode;
}

/** EmDash の管理画面と同じく、`onChange` で受け取った値を `value` に戻す親の中で描く */
function renderField({
	value = null,
	options,
	id = "field-cover",
	label = "カバー",
	strict = false,
	wrap,
}: RenderFieldOptions = {}) {
	const onChange = vi.fn<(value: unknown) => void>();
	function Editor() {
		const [current, setCurrent] = useState<unknown>(value);
		const field = (
			<ImageField
				value={current}
				onChange={(next) => {
					onChange(next);
					setCurrent(next);
				}}
				label={label}
				id={id}
				options={options}
			/>
		);
		return <>{wrap === undefined ? field : wrap(field)}</>;
	}
	const user = userEvent.setup();
	const view = render(<Editor />, { reactStrictMode: strict });
	return { ...view, onChange, user };
}

function fileInput(container: HTMLElement): HTMLInputElement {
	const inputs = container.querySelectorAll('input[type="file"]');
	if (inputs.length !== 1 || !(inputs[0] instanceof HTMLInputElement)) {
		throw new Error(`expected one file input, found ${inputs.length}`);
	}
	return inputs[0];
}

function dropZone(name = "カバー: ファイルを選択"): HTMLElement {
	return screen.getByRole("button", { name });
}

/** ドロップゾーンの枠(ドラッグのイベントを受ける要素) */
function dropFrame(): HTMLElement {
	const frame = dropZone().parentElement;
	if (frame === null) throw new Error("drop frame not found");
	return frame;
}

function previewImage(): HTMLImageElement | null {
	return document.querySelector("fieldset img");
}

/** 処理の読み上げの領域(`UploadProgress` の `<output>`) */
function announcement(): string {
	const region = document.querySelector("output[aria-live]");
	if (region === null) throw new Error("live region not found");
	return region.textContent ?? "";
}

/** widget の最後の `role="alert"`(アップロードのエラーの領域。`ErrorMessage` は常に描画する) */
function uploadErrorRegion(): HTMLElement {
	const regions = screen.getAllByRole("alert");
	const region = regions.at(-1);
	if (region === undefined) throw new Error("alert region not found");
	return region;
}

function altInput(name = "代替テキスト"): HTMLElement {
	return screen.getByRole("textbox", { name });
}

async function changeLang(lang: string): Promise<void> {
	await act(async () => {
		document.documentElement.lang = lang;
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

/** 非同期の処理(タイマーとマイクロタスク)を少し進める。何も起きないことを確かめるときに使う */
async function settle(ms = 150): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
}

/** 保存済みの画像の値で描き、プレビューを読み込み終えるまで待つ */
async function renderSaved(options: RenderFieldOptions = {}) {
	savedImages.set(SAVED_ID, SAVED_ENTRY);
	const view = renderField({ value: SAVED_REF, ...options });
	await waitFor(() => expect(previewImage()).toHaveAttribute("src", SAVED_SRC));
	return view;
}

/** アップロードが終わる(値が変わる)まで待つ */
async function waitForChange(onChange: ReturnType<typeof renderField>["onChange"], times = 1) {
	await waitFor(() => expect(onChange).toHaveBeenCalledTimes(times));
}

// ---------------------------------------------------------------------------
// 共通の準備
// ---------------------------------------------------------------------------

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
	document.documentElement.lang = "ja";
	window.history.replaceState(null, "", EDIT_URL);
	routes.clear();
	sent.length = 0;
	savedImages.clear();
	encodeCalls.length = 0;
	bitmaps.length = 0;
	decodeGate = undefined;
	encodeGate = undefined;
	route(UPLOAD_URL, acceptUpload);
	route(PREVIEW_URL, servePreviews);
	fetchMock.mockReset();
	fetchMock.mockImplementation(async (input, init = {}) => {
		const url = String(input);
		const request: SentRequest = {
			url,
			method: init.method ?? "GET",
			body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
			signal: init.signal ?? undefined,
		};
		sent.push(request);
		const handler = routes.get(url);
		if (handler === undefined) return apiError("NOT_FOUND", 404);
		return handler(request);
	});
	vi.stubGlobal("fetch", fetchMock);
	installBrowserFakes();
	consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
	// 先に描画を片付ける(アンマウントの警告も数える。ここで投げても、次のテストに DOM を残さない。
	// docs/react-effect-lint-and-vitest-hooks.md)
	cleanup();
	const warnings = consoleError.mock.calls.map((args) => args.map(String).join(" "));
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	window.history.replaceState(null, "", "/");
	if (warnings.length > 0) throw new Error(`console.error was called:\n${warnings.join("\n")}`);
});

// ---------------------------------------------------------------------------
// 値の読み方
// ---------------------------------------------------------------------------

describe("readImageFieldValue", () => {
	it("null と undefined は画像なし、参照の形は画像あり(値そのものを使う)", () => {
		expect(readImageFieldValue(null)).toEqual({ kind: "empty" });
		expect(readImageFieldValue(undefined)).toEqual({ kind: "empty" });
		const read = readImageFieldValue(SAVED_REF);
		expect(read).toEqual({ kind: "image", ref: SAVED_REF });
		expect(read.kind === "image" ? read.ref : null).toBe(SAVED_REF);
	});

	it.each(INVALID_VALUES)("参照の形でない値は、正しくない値: %s", (_name, value) => {
		expect(readImageFieldValue(value)).toEqual({ kind: "invalid" });
	});
});

// ---------------------------------------------------------------------------
// 空のとき
// ---------------------------------------------------------------------------

describe("空のとき", () => {
	it("フィールドの表示名のグループに、単一画像のドロップゾーンを出す(プレビューは取得しない)", () => {
		const { container } = renderField();

		const group = screen.getByRole("group", { name: "カバー" });
		expect(group.tagName).toBe("FIELDSET");
		// EmDash の ?field=cover(サイトのツールバーから開いたとき)が探す id
		expect(group).toHaveAttribute("id", "field-cover");
		expect(within(group).getByRole("button", { name: "カバー: ファイルを選択" })).toBeEnabled();
		expect(within(group).getAllByRole("button")).toHaveLength(1);
		const input = fileInput(container);
		// MIME タイプを並べると HEIC を選べず、HEIC の案内を出せない(T12)
		expect(input).toHaveAttribute("accept", "image/*");
		expect(input.multiple).toBe(false);
		// 読み上げの領域とエラーの領域は、処理の前から置いておく(中身は空)
		expect(announcement()).toBe("");
		expect(uploadErrorRegion()).toBeEmptyDOMElement();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("EmDash が渡すほかの props(required・validation・minimal・seed の options)を受け取っても、同じように描く", () => {
		const onChange = vi.fn<(value: unknown) => void>();
		render(
			<ImageField
				value={undefined}
				onChange={onChange}
				label="カバー"
				id="field-cover"
				required
				options={{ maxStoredBytes: 100_000 }}
				validation={{}}
				minimal={false}
			/>,
		);

		expect(dropZone()).toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("英語で表示し、言語が変わると文言が変わる", async () => {
		document.documentElement.lang = "en";
		renderField({ label: "Cover" });

		expect(screen.getByRole("group", { name: "Cover" })).toBeInTheDocument();
		expect(dropZone("Cover: Select a file")).toHaveTextContent("Drop or paste an image");

		await changeLang("ja");
		expect(dropZone("Cover: ファイルを選択")).toHaveTextContent("画像をドロップ / 貼り付け");
	});
});

// ---------------------------------------------------------------------------
// アップロード
// ---------------------------------------------------------------------------

describe("アップロード", () => {
	it("選んだ画像を、読み込み → 圧縮 → サムネイル → アップロードの順に処理し、応答の参照をそのまま値にする", async () => {
		const decoding = Promise.withResolvers<void>();
		decodeGate = () => decoding.promise;
		const encoding = Promise.withResolvers<void>();
		const thumbnail = Promise.withResolvers<void>();
		let thumbnailGated = false;
		encodeGate = (call, index) => {
			// 本体の最初のエンコードと、サムネイル(長辺 96px)の最初のエンコードで待たせる
			if (index === 0) return encoding.promise;
			if (!thumbnailGated && Math.max(call.width, call.height) <= 96) {
				thumbnailGated = true;
				return thumbnail.promise;
			}
			return undefined;
		};
		const uploading = gated(acceptUpload);
		route(UPLOAD_URL, uploading.handler);
		const { container, onChange, user } = renderField();

		await user.upload(fileInput(container), pngFile("photo.png"));

		// 読み込み中(デコードの前に描画する。T12・T23)。ドロップゾーンの代わりに進捗とキャンセルボタンを出す
		await waitFor(() => expect(screen.getByText("読み込み中…")).toBeInTheDocument());
		expect(announcement()).toBe("画像を読み込んでいます。");
		expect(screen.getByText("photo.png")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "カバー: ファイルを選択" })).toBeNull();
		expect(screen.getByRole("button", { name: "キャンセル" })).toBeInTheDocument();

		decoding.resolve();
		await waitFor(() => expect(screen.getByText("圧縮中… 1600px / 画質 0.60")).toBeInTheDocument());
		expect(announcement()).toBe("画像を圧縮しています。");

		encoding.resolve();
		await waitFor(() => expect(screen.getByText("サムネイルを作成中…")).toBeInTheDocument());
		expect(announcement()).toBe("サムネイルを作成しています。");

		thumbnail.resolve();
		await waitFor(() => expect(screen.getByText("アップロード中…")).toBeInTheDocument());
		expect(announcement()).toBe("画像をアップロードしています。");
		expect(onChange).not.toHaveBeenCalled();

		uploading.release();
		await waitForChange(onChange);

		// 応答の参照をそのまま値にする(`alt` は空、`locale` は画像エントリのロケール。編集中のエントリの ja に書き換えない)
		expect(onChange).toHaveBeenCalledWith({
			v: 1,
			id: NEW_ID,
			locale: IMAGE_LOCALE,
			width: 1600,
			height: 1200,
			alt: "",
		});
		// 送った内容: 保存先は URL と widget の id から(T23)。ルートの入力のスキーマに合う
		const [body] = uploadBodies();
		expect(uploadBodies()).toHaveLength(1);
		expect(uploadRequestSchema.safeParse(body).success).toBe(true);
		expect(body?.target).toEqual({
			collection: "posts",
			field: "cover",
			entryId: ENTRY_ID,
			locale: "ja",
		});
		expect(body).toMatchObject({ width: 1600, height: 1200, quality: 0.77, filename: "photo.png" });

		// 追加したばかりの画像は、送った data URL をそのまま表示する(プレビューを取得しない)
		const image = previewImage();
		expect(image).toHaveAttribute("src", body?.dataUrl);
		expect(image).toHaveAttribute("width", "1600");
		expect(image).toHaveAttribute("height", "1200");
		expect(requestsTo(PREVIEW_URL)).toHaveLength(0);
		// 保存サイズは data URL の長さ(1,600 バイトの WebP → 2,159 バイト)
		expect(body?.dataUrl).toHaveLength(2_159);
		expect(screen.getByText("1600×1200 · 保存サイズ 2.2KB · 画質 0.77")).toBeInTheDocument();
		expect(announcement()).toBe("画像を追加しました。");
		expect(screen.queryByRole("button", { name: "キャンセル" })).toBeNull();
		// 代替テキストは空で、装飾画像の注意を出す
		expect(altInput()).toHaveValue("");
		expect(altInput()).toHaveAccessibleDescription(expect.stringContaining("装飾画像"));
		expect(screen.getByRole("button", { name: "差し替え" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
		expect(uploadErrorRegion()).toBeEmptyDOMElement();
	});

	it.each([
		[
			"ドロップ",
			(file: File) => {
				fireEvent.drop(dropFrame(), { dataTransfer: fakeTransfer([file]) });
			},
		],
		[
			"貼り付け(ボタンにフォーカスがあるとき)",
			(file: File) => {
				const zone = dropZone();
				zone.focus();
				fireEvent.paste(zone, { clipboardData: fakeTransfer([file]) });
			},
		],
	])("%sした画像もアップロードする", async (_name, give) => {
		const { onChange } = renderField();

		give(pngFile("given.png", 800, 600));
		await waitForChange(onChange);

		expect(uploadBodies()[0]).toMatchObject({ filename: "given.png", width: 800, height: 600 });
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: NEW_ID, alt: "" }));
	});

	it("複数のファイルをドロップされたら、受け付けずに「1 枚ずつ」と出す(アップロードしない)", async () => {
		const { onChange } = renderField();

		fireEvent.drop(dropFrame(), {
			dataTransfer: fakeTransfer([pngFile("a.png"), pngFile("b.png")]),
		});
		await settle();

		expect(screen.getByText("画像は 1 枚ずつ追加してください。")).toBeInTheDocument();
		expect(dropZone()).toBeInTheDocument();
		expect(requestsTo(UPLOAD_URL)).toHaveLength(0);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("フィールドの options(長辺の上限など)で圧縮する", async () => {
		const { container, onChange, user } = renderField({ options: { maxEdge: 800 } });

		await user.upload(fileInput(container), pngFile("photo.png", 4000, 3000));
		await waitForChange(onChange);

		expect(uploadBodies()[0]).toMatchObject({ width: 800, height: 600 });
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 600 }));
	});

	it("GIF は、最初のフレームだけになることを処理中から注意として出す。削除すると消す", async () => {
		const uploading = gated(acceptUpload);
		route(UPLOAD_URL, uploading.handler);
		const { container, onChange, user } = renderField();
		const notice = NOTICE_MESSAGES.ja.GIF_FIRST_FRAME_ONLY;

		await user.upload(fileInput(container), gifFile("anim.gif"));
		await waitFor(() => expect(screen.getByText("アップロード中…")).toBeInTheDocument());
		expect(screen.getByText(notice)).toBeInTheDocument();

		uploading.release();
		await waitForChange(onChange);
		expect(screen.getByText(notice)).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "削除" }));
		expect(screen.queryByText(notice)).toBeNull();
		expect(announcement()).toBe("");
	});

	it("新規作成の画面では、保存先に entryId と locale を入れない(T23)", async () => {
		window.history.replaceState(null, "", "/_emdash/admin/content/posts/new");
		const { container, onChange, user } = renderField();

		await user.upload(fileInput(container), pngFile());
		await waitForChange(onChange);

		expect(uploadBodies()[0]?.target).toEqual({ collection: "posts", field: "cover" });
	});

	it.each([
		["コンテンツの編集画面でない", "/_emdash/admin/plugins/base64-image/images", "field-cover"],
		["widget の id が field-<slug> でない", EDIT_URL, "cover"],
	])(
		"保存先を求められないとき(%s)は、送らずに INVALID_TARGET の文言を出す",
		async (_name, url, id) => {
			window.history.replaceState(null, "", url);
			const { container, onChange, user } = renderField({ id });

			await user.upload(fileInput(container), pngFile());

			await waitFor(() =>
				expect(uploadErrorRegion()).toHaveTextContent(ERROR_MESSAGES.ja.INVALID_TARGET),
			);
			expect(requestsTo(UPLOAD_URL)).toHaveLength(0);
			expect(onChange).not.toHaveBeenCalled();
			expect(dropZone()).toBeInTheDocument();
		},
	);
});

// ---------------------------------------------------------------------------
// 失敗
// ---------------------------------------------------------------------------

describe("失敗", () => {
	it("受け付けない形式(HEIC)は、案内を出して値を変えない(送らない)", async () => {
		const { container, onChange, user } = renderField();

		await user.upload(fileInput(container), heicFile());

		await waitFor(() =>
			expect(uploadErrorRegion()).toHaveTextContent(ERROR_MESSAGES.ja.INPUT_HEIC_REJECTED),
		);
		expect(dropZone()).toBeInTheDocument();
		expect(requestsTo(UPLOAD_URL)).toHaveLength(0);
		expect(onChange).not.toHaveBeenCalled();
		expect(announcement()).toBe("");
	});

	it.each([
		// 作った画像エントリを、ルートがゴミ箱に移したあとのエラー(T18)
		["UPLOAD_FAILED", 500],
		// 保存 hook が作成を拒否した(T18)
		["IMAGE_ENTRY_INVALID", 400],
	] as const)("ルートの %s は、コードごとの文言を出して値を変えない", async (code, status) => {
		route(UPLOAD_URL, () => apiError(code, status));
		const { container, onChange, user } = renderField();

		await user.upload(fileInput(container), pngFile());

		await waitFor(() => expect(uploadErrorRegion()).toHaveTextContent(ERROR_MESSAGES.ja[code]));
		expect(requestsTo(UPLOAD_URL)).toHaveLength(1);
		expect(onChange).not.toHaveBeenCalled();
		expect(dropZone()).toBeInTheDocument();
		expect(previewImage()).toBeNull();
	});

	it("エラーは閉じられ、次のアップロードを始めると消える", async () => {
		route(UPLOAD_URL, () => apiError("UPLOAD_FAILED", 500));
		const { container, onChange, user } = renderField();

		await user.upload(fileInput(container), pngFile());
		await waitFor(() => expect(uploadErrorRegion()).not.toBeEmptyDOMElement());
		await user.click(screen.getByRole("button", { name: "エラーを閉じる" }));
		expect(uploadErrorRegion()).toBeEmptyDOMElement();

		await user.upload(fileInput(container), pngFile());
		await waitFor(() => expect(uploadErrorRegion()).not.toBeEmptyDOMElement());
		route(UPLOAD_URL, acceptUpload);
		await user.upload(fileInput(container), pngFile());
		await waitFor(() => expect(screen.getByText("読み込み中…")).toBeInTheDocument());
		expect(uploadErrorRegion()).toBeEmptyDOMElement();
		await waitForChange(onChange);
	});
});

// ---------------------------------------------------------------------------
// キャンセル
// ---------------------------------------------------------------------------

describe("キャンセル", () => {
	it("読み込み中のキャンセルは、エラーにせず処理の前の表示に戻す(値は変えない)", async () => {
		const decoding = Promise.withResolvers<void>();
		decodeGate = () => decoding.promise;
		const { container, onChange, user } = renderField();

		await user.upload(fileInput(container), pngFile());
		await waitFor(() => expect(screen.getByText("読み込み中…")).toBeInTheDocument());
		await user.click(screen.getByRole("button", { name: "キャンセル" }));

		expect(dropZone()).toBeInTheDocument();
		expect(screen.queryByText("読み込み中…")).toBeNull();
		expect(announcement()).toBe("");
		expect(uploadErrorRegion()).toBeEmptyDOMElement();

		// あとで届いたデコードの結果は閉じられ、先へ進まない
		decoding.resolve();
		await settle();
		expect(bitmaps.every((bitmap) => bitmap.width === 0)).toBe(true);
		expect(encodeCalls).toHaveLength(0);
		expect(requestsTo(UPLOAD_URL)).toHaveLength(0);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("アップロード中のキャンセルは要求を中断し、あとで応答が届いても値を変えない", async () => {
		const uploading = gated(acceptUpload, { ignoreAbort: true });
		route(UPLOAD_URL, uploading.handler);
		const { container, onChange, user } = renderField();

		await user.upload(fileInput(container), pngFile());
		await waitFor(() => expect(screen.getByText("アップロード中…")).toBeInTheDocument());
		await user.click(screen.getByRole("button", { name: "キャンセル" }));

		const [request] = requestsTo(UPLOAD_URL);
		expect(request?.signal?.aborted).toBe(true);
		expect(dropZone()).toBeInTheDocument();

		uploading.release();
		await settle();
		expect(onChange).not.toHaveBeenCalled();
		expect(dropZone()).toBeInTheDocument();
		expect(uploadErrorRegion()).toBeEmptyDOMElement();
	});
});

// ---------------------------------------------------------------------------
// 保存済みの画像
// ---------------------------------------------------------------------------

describe("保存済みの画像", () => {
	it("プレビューをルートから取得して表示し、寸法・保存サイズ・画質と代替テキストを出す", async () => {
		savedImages.set(SAVED_ID, SAVED_ENTRY);
		const previewing = gated(servePreviews);
		route(PREVIEW_URL, previewing.handler);
		const { container } = renderField({ value: SAVED_REF });

		// 取得の間は、同じ大きさの枠に読み込み中を出す。代替テキストとボタンはすぐに使える
		expect(screen.getByRole("status", { name: "プレビューを読み込み中" })).toBeInTheDocument();
		expect(previewImage()).toBeNull();
		expect(screen.getByText("1280×853")).toBeInTheDocument();
		expect(altInput()).toHaveValue("赤い花");
		expect(altInput()).not.toHaveAccessibleDescription(expect.stringContaining("装飾画像"));

		previewing.release();
		await waitFor(() => expect(previewImage()).toHaveAttribute("src", SAVED_SRC));
		expect(previewImage()).toHaveAttribute("width", "1280");
		expect(previewImage()).toHaveAttribute("height", "853");
		expect(screen.getByText("1280×853 · 保存サイズ 98.2KB · 画質 0.77")).toBeInTheDocument();
		expect(requestsTo(PREVIEW_URL).map((request) => request.body)).toEqual([{ ids: [SAVED_ID] }]);
		expect(screen.getByRole("button", { name: "差し替え" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "カバー: ファイルを選択" })).toBeNull();
		// 差し替えのファイルの選択も、HEIC を選べる `image/*` で 1 枚
		expect(fileInput(container)).toHaveAttribute("accept", "image/*");
		expect(fileInput(container).multiple).toBe(false);
	});

	it("代替テキストの入力は、参照の alt だけを変えた値にする", async () => {
		const { onChange, user } = await renderSaved();

		await user.clear(altInput());
		expect(onChange).toHaveBeenLastCalledWith({ ...SAVED_REF, alt: "" });
		expect(altInput()).toHaveAccessibleDescription(expect.stringContaining("装飾画像"));

		await user.type(altInput(), "青い空");
		expect(onChange).toHaveBeenLastCalledWith({ ...SAVED_REF, alt: "青い空" });
		expect(altInput()).toHaveValue("青い空");
		expect(requestsTo(UPLOAD_URL)).toHaveLength(0);
	});

	it("削除すると値を null にし、ドロップゾーンに戻す", async () => {
		const { onChange, user } = await renderSaved();

		await user.click(screen.getByRole("button", { name: "削除" }));

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith(null);
		expect(dropZone()).toBeInTheDocument();
		expect(previewImage()).toBeNull();
	});

	it("差し替えた画像は、新しい参照を値にし、前の代替テキストを残さない", async () => {
		const { container, onChange, user } = await renderSaved();

		await user.upload(fileInput(container), pngFile("new.png", 1600, 900));
		// 処理中は、前の画像・代替テキスト・ボタンを出さない
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "キャンセル" })).toBeInTheDocument(),
		);
		expect(previewImage()).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();

		await waitForChange(onChange);
		expect(onChange).toHaveBeenCalledWith({
			v: 1,
			id: NEW_ID,
			locale: IMAGE_LOCALE,
			width: 1600,
			height: 900,
			alt: "",
		});
		expect(previewImage()).toHaveAttribute("src", uploadBodies()[0]?.dataUrl);
		expect(altInput()).toHaveValue("");
		// 新しい画像のプレビューは取得しない(保存済みの画像の 1 回だけ)
		expect(requestsTo(PREVIEW_URL)).toHaveLength(1);
	});

	it("差し替えのキャンセルと失敗では、前の画像と代替テキストのまま(値を変えない)", async () => {
		const decoding = Promise.withResolvers<void>();
		decodeGate = () => decoding.promise;
		const { container, onChange, user } = await renderSaved();

		await user.upload(fileInput(container), pngFile());
		await waitFor(() => expect(screen.getByText("読み込み中…")).toBeInTheDocument());
		await user.click(screen.getByRole("button", { name: "キャンセル" }));
		expect(previewImage()).toHaveAttribute("src", SAVED_SRC);
		expect(altInput()).toHaveValue("赤い花");

		decodeGate = undefined;
		decoding.resolve();
		await user.upload(fileInput(container), heicFile());
		await waitFor(() =>
			expect(uploadErrorRegion()).toHaveTextContent(ERROR_MESSAGES.ja.INPUT_HEIC_REJECTED),
		);
		expect(previewImage()).toHaveAttribute("src", SAVED_SRC);
		expect(altInput()).toHaveValue("赤い花");
		expect(onChange).not.toHaveBeenCalled();
	});

	it("プレビューの画像が見つからない(image: null)ときは「画像が見つかりません」と削除ボタンだけを出す", async () => {
		const { onChange, user } = renderField({ value: SAVED_REF });

		await waitFor(() => expect(screen.getByText("画像が見つかりません")).toBeInTheDocument());
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.queryByRole("button", { name: "差し替え" })).toBeNull();
		const remove = screen.getByRole("button", { name: "削除" });
		expect(remove).toHaveAccessibleDescription(expect.stringContaining("ゴミ箱"));

		await user.click(remove);
		expect(onChange).toHaveBeenCalledWith(null);
		expect(dropZone()).toBeInTheDocument();
	});

	it("プレビューの取得に失敗したら、エラーと再読み込みのボタンを出し、押すと取得し直す", async () => {
		savedImages.set(SAVED_ID, SAVED_ENTRY);
		route(PREVIEW_URL, () => apiError("INTERNAL_ERROR", 500));
		const { onChange, user } = renderField({ value: SAVED_REF });

		await waitFor(() =>
			expect(screen.getByText("プレビューを読み込めませんでした")).toBeInTheDocument(),
		);
		expect(screen.getByText(ERROR_MESSAGES.ja.INTERNAL_ERROR)).toBeInTheDocument();
		// 値は正しいので、代替テキストとボタンは使える
		expect(altInput()).toHaveValue("赤い花");
		expect(screen.getByRole("button", { name: "差し替え" })).toBeInTheDocument();

		route(PREVIEW_URL, servePreviews);
		await user.click(screen.getByRole("button", { name: "再読み込み" }));
		await waitFor(() => expect(previewImage()).toHaveAttribute("src", SAVED_SRC));
		expect(screen.queryByText("プレビューを読み込めませんでした")).toBeNull();
		expect(requestsTo(PREVIEW_URL)).toHaveLength(2);
		expect(onChange).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// 正しくない値
// ---------------------------------------------------------------------------

describe("正しくない値", () => {
	it.each(INVALID_VALUES)(
		"%s は「画像の値が正しくありません」と削除ボタンを出し、削除で null にする",
		async (_name, value) => {
			const { onChange, user } = renderField({ value });

			expect(screen.getByText("画像の値が正しくありません")).toBeInTheDocument();
			const remove = screen.getByRole("button", { name: "削除" });
			expect(remove).toHaveAccessibleDescription(
				expect.stringContaining("このままでは保存できないため"),
			);
			expect(screen.queryByRole("textbox")).toBeNull();
			expect(screen.queryByRole("button", { name: "カバー: ファイルを選択" })).toBeNull();
			// 参照の形でない値のプレビューは取得しない
			expect(fetchMock).not.toHaveBeenCalled();

			await user.click(remove);
			expect(onChange).toHaveBeenCalledWith(null);
			expect(dropZone()).toBeInTheDocument();
		},
	);
});

// ---------------------------------------------------------------------------
// キーボードとフォーカス
// ---------------------------------------------------------------------------

describe("キーボードとフォーカス", () => {
	it("Tab でドロップゾーンに移り、Enter でファイルの選択を開く", async () => {
		const { container, user } = renderField();
		const click = vi.spyOn(fileInput(container), "click").mockImplementation(() => {});

		await user.tab();
		expect(dropZone()).toHaveFocus();
		await user.keyboard("{Enter}");
		expect(click).toHaveBeenCalledTimes(1);
	});

	it("キーボードで始めると、処理中はキャンセルボタンへ、追加したあとは代替テキストへフォーカスを移す", async () => {
		const decoding = Promise.withResolvers<void>();
		decodeGate = () => decoding.promise;
		const { container, onChange, user } = renderField();
		vi.spyOn(fileInput(container), "click").mockImplementation(() => {});

		await user.tab();
		await user.keyboard("{Enter}");
		// ファイルの選択を閉じた(ファイルを選んだ)ときの change。フォーカスはドロップゾーンのまま
		fireEvent.change(fileInput(container), { target: { files: [pngFile()] } });
		await waitFor(() => expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus());

		decoding.resolve();
		await waitForChange(onChange);
		expect(altInput()).toHaveFocus();
	});

	it("キャンセル・失敗・エラーを閉じたあとは、ドロップゾーンへフォーカスを戻す", async () => {
		const decoding = Promise.withResolvers<void>();
		decodeGate = () => decoding.promise;
		const { container, user } = renderField();

		dropZone().focus();
		fireEvent.drop(dropFrame(), { dataTransfer: fakeTransfer([pngFile()]) });
		await waitFor(() => expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus());
		await user.keyboard("{Enter}");
		expect(dropZone()).toHaveFocus();

		decodeGate = undefined;
		decoding.resolve();
		dropZone().focus();
		fireEvent.drop(dropFrame(), { dataTransfer: fakeTransfer([heicFile()]) });
		await waitFor(() => expect(uploadErrorRegion()).not.toBeEmptyDOMElement());
		expect(dropZone()).toHaveFocus();

		await user.click(screen.getByRole("button", { name: "エラーを閉じる" }));
		expect(dropZone()).toHaveFocus();
		expect(container).toBeInTheDocument();
	});

	it("差し替えのキャンセル・失敗のあとは差し替えのボタンへ、削除のあとはドロップゾーンへフォーカスを移す", async () => {
		const { container, onChange, user } = await renderSaved();
		vi.spyOn(fileInput(container), "click").mockImplementation(() => {});
		const decoding = Promise.withResolvers<void>();
		decodeGate = () => decoding.promise;

		await user.click(screen.getByRole("button", { name: "差し替え" }));
		fireEvent.change(fileInput(container), { target: { files: [pngFile()] } });
		await waitFor(() => expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus());
		await user.keyboard("{Enter}");
		expect(screen.getByRole("button", { name: "差し替え" })).toHaveFocus();

		decodeGate = undefined;
		decoding.resolve();
		fireEvent.change(fileInput(container), { target: { files: [heicFile()] } });
		await waitFor(() => expect(uploadErrorRegion()).not.toBeEmptyDOMElement());
		expect(screen.getByRole("button", { name: "差し替え" })).toHaveFocus();

		await user.click(screen.getByRole("button", { name: "削除" }));
		expect(onChange).toHaveBeenCalledWith(null);
		expect(dropZone()).toHaveFocus();
	});

	it("画像が見つからない・値が正しくないときの削除のあとも、ドロップゾーンへフォーカスを移す", async () => {
		const missing = renderField({ value: SAVED_REF });
		await waitFor(() => expect(screen.getByText("画像が見つかりません")).toBeInTheDocument());
		await missing.user.click(screen.getByRole("button", { name: "削除" }));
		expect(dropZone()).toHaveFocus();
		missing.unmount();

		const invalid = renderField({ value: "broken" });
		await invalid.user.click(screen.getByRole("button", { name: "削除" }));
		expect(dropZone()).toHaveFocus();
	});

	it("ほかのフィールドにフォーカスがあるときは、処理の開始・終了でフォーカスを動かさない", async () => {
		const { onChange } = renderField({
			wrap: (field) => (
				<>
					<input aria-label="タイトル" />
					{field}
				</>
			),
		});
		const title = screen.getByRole("textbox", { name: "タイトル" });
		// 一度ドロップゾーンにフォーカスしてから、ほかのフィールドへ移った(最後にフォーカスを受けた widget の要素が消える)
		dropZone().focus();
		title.focus();

		fireEvent.drop(dropFrame(), { dataTransfer: fakeTransfer([pngFile()]) });
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "キャンセル" })).toBeInTheDocument(),
		);
		expect(title).toHaveFocus();
		await waitForChange(onChange);
		expect(title).toHaveFocus();
	});

	it("設定済みのときは、代替テキスト → 差し替え → 削除の順に Tab で移る", async () => {
		const { user } = await renderSaved();

		await user.tab();
		expect(altInput()).toHaveFocus();
		await user.tab();
		expect(screen.getByRole("button", { name: "差し替え" })).toHaveFocus();
		await user.tab();
		expect(screen.getByRole("button", { name: "削除" })).toHaveFocus();
	});

	it("プレビューの読み込み中に代替テキストにフォーカスがあり、画像が見つからないと分かったら、削除ボタンへ移す", async () => {
		const previewing = gated(servePreviews);
		route(PREVIEW_URL, previewing.handler);
		renderField({ value: SAVED_REF });
		altInput().focus();

		previewing.release();
		await waitFor(() => expect(screen.getByText("画像が見つかりません")).toBeInTheDocument());
		expect(screen.getByRole("button", { name: "削除" })).toHaveFocus();
	});

	it("代替テキストにフォーカスがあるときに、値が外から正しくない値に変わったら、削除ボタンへ移す", async () => {
		savedImages.set(SAVED_ID, SAVED_ENTRY);
		const onChange = vi.fn<(value: unknown) => void>();
		const field = (value: unknown) => (
			<ImageField value={value} onChange={onChange} label="カバー" id="field-cover" />
		);
		const { rerender } = render(field(SAVED_REF));
		await waitFor(() => expect(previewImage()).toHaveAttribute("src", SAVED_SRC));
		altInput().focus();

		// 管理画面がリビジョンの復元などで値を差し替えたとき
		rerender(field({ broken: true }));

		expect(screen.getByRole("button", { name: "削除" })).toHaveFocus();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("利用者がフォーカスを外した(body に戻した)あとは、再描画でフォーカスを奪わない", async () => {
		savedImages.set(SAVED_ID, SAVED_ENTRY);
		const previewing = gated(servePreviews);
		route(PREVIEW_URL, previewing.handler);
		renderField({ value: SAVED_REF });
		altInput().focus();
		altInput().blur();
		expect(document.body).toHaveFocus();

		previewing.release();
		await waitFor(() => expect(previewImage()).toHaveAttribute("src", SAVED_SRC));
		expect(document.body).toHaveFocus();
	});
});

// ---------------------------------------------------------------------------
// 編集ロック(EmDash の <fieldset disabled>)
// ---------------------------------------------------------------------------

/** EmDash 0.39.1 の編集画面と同じく、フィールドを無効な fieldset で包む(`ContentEditor.tsx:1336`) */
function locked(field: ReactNode): ReactNode {
	return <fieldset disabled>{field}</fieldset>;
}

describe("編集ロック中(EmDash がフィールドを <fieldset disabled> で包む)", () => {
	it("ボタンは無効になり、枠へのドロップも受け付けない(値を変えず、送らない)", async () => {
		const { onChange } = renderField({ wrap: locked });

		expect(dropZone()).toBeDisabled();
		fireEvent.drop(dropFrame(), { dataTransfer: fakeTransfer([pngFile()]) });
		await settle();

		expect(screen.queryByText("読み込み中…")).toBeNull();
		expect(requestsTo(UPLOAD_URL)).toHaveLength(0);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("設定済みの画像の代替テキストとボタンも無効になる", async () => {
		await renderSaved({ wrap: locked });

		expect(altInput()).toBeDisabled();
		expect(screen.getByRole("button", { name: "差し替え" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
	});
});

// ---------------------------------------------------------------------------
// 英語
// ---------------------------------------------------------------------------

describe("英語", () => {
	beforeEach(() => {
		document.documentElement.lang = "en";
	});

	it("設定済みの画像の表示とボタン", async () => {
		await renderSaved({ label: "Cover" });

		expect(screen.getByRole("group", { name: "Cover" })).toBeInTheDocument();
		expect(screen.getByText("1280×853 · Stored size 98.2 KB · Quality 0.77")).toBeInTheDocument();
		expect(altInput("Alternative text")).toHaveValue("赤い花");
		expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();

		await changeLang("ja");
		expect(screen.getByRole("button", { name: "差し替え" })).toBeInTheDocument();
	});

	it("正しくない値・プレビューの失敗・処理中", async () => {
		const invalid = renderField({ value: {} });
		expect(screen.getByText("Invalid image value")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Remove" })).toHaveAccessibleDescription(
			expect.stringContaining("cannot be saved"),
		);
		invalid.unmount();

		route(PREVIEW_URL, () => apiError("INTERNAL_ERROR", 500));
		const failed = renderField({ value: SAVED_REF });
		await waitFor(() => expect(screen.getByText("Could not load the preview")).toBeInTheDocument());
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
		failed.unmount();

		const decoding = Promise.withResolvers<void>();
		decodeGate = () => decoding.promise;
		const { container, user } = renderField();
		await user.upload(fileInput(container), pngFile());
		await waitFor(() => expect(screen.getByText("Reading…")).toBeInTheDocument());
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		decoding.resolve();
	});
});

// ---------------------------------------------------------------------------
// StrictMode・登録
// ---------------------------------------------------------------------------

describe("StrictMode と登録", () => {
	it("StrictMode(effect が 2 回動く)でも、プレビューの取得・アップロード・フォーカスの移動が動く", async () => {
		savedImages.set(SAVED_ID, SAVED_ENTRY);
		const { container, onChange, user } = renderField({ value: SAVED_REF, strict: true });
		await waitFor(() => expect(previewImage()).toHaveAttribute("src", SAVED_SRC));

		vi.spyOn(fileInput(container), "click").mockImplementation(() => {});
		await user.click(screen.getByRole("button", { name: "差し替え" }));
		fireEvent.change(fileInput(container), { target: { files: [pngFile()] } });
		await waitFor(() => expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus());
		await waitForChange(onChange);

		expect(requestsTo(UPLOAD_URL)).toHaveLength(1);
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: NEW_ID }));
		expect(altInput()).toHaveFocus();
	});

	it("管理画面の入口の fields に、型の注釈なしでそのまま入れる(PluginAdminModule の fields には代入できない)", () => {
		const fields = { image: ImageField };
		// EmDash 0.39.1 の `PluginAdminModule["fields"]` は `Record<string, ComponentType>`(props なし)で、必須の props を
		// 持つ widget は代入できない。T30 は型の注釈を付けずに export する(EmDash の field-kit の `admin.tsx` も同じ)。
		// EmDash が型を直したら、この行が型エラー(使われない @ts-expect-error)になる
		// @ts-expect-error -- props のある部品は ComponentType<{}> に代入できない
		const typed: NonNullable<PluginAdminModule["fields"]> = fields;
		expect(typed["image"]).toBe(ImageField);
	});
});

// ---------------------------------------------------------------------------
// 見た目のクラス
// ---------------------------------------------------------------------------

describe("管理画面の CSS", () => {
	const tokens = sourceTokens("src/admin/ImageField.tsx", "src/admin/parts");

	function expectKnownClasses(container: HTMLElement): void {
		const missing = findMissingClasses(container, tokens);
		expect(missing.fromSource).toEqual([]);
		expect(missing.unknown).toEqual([]);
	}

	it("空・処理中・エラー・注意・追加したあとの表示で、使うクラスがすべて管理画面の CSS にある", async () => {
		const decoding = Promise.withResolvers<void>();
		decodeGate = () => decoding.promise;
		const { container, onChange, user } = renderField();
		expectKnownClasses(container);

		await user.upload(fileInput(container), gifFile());
		await waitFor(() => expect(screen.getByText("読み込み中…")).toBeInTheDocument());
		expectKnownClasses(container);

		decoding.resolve();
		await waitForChange(onChange);
		expect(screen.getByText(NOTICE_MESSAGES.ja.GIF_FIRST_FRAME_ONLY)).toBeInTheDocument();
		expectKnownClasses(container);

		decodeGate = undefined;
		await user.upload(fileInput(container), heicFile());
		await waitFor(() => expect(uploadErrorRegion()).not.toBeEmptyDOMElement());
		expectKnownClasses(container);
	});

	it("保存済み・見つからない・値が正しくない・プレビューの失敗の表示で、使うクラスがすべて管理画面の CSS にある", async () => {
		const saved = await renderSaved();
		expectKnownClasses(saved.container);
		saved.unmount();

		savedImages.clear();
		const missing = renderField({ value: SAVED_REF });
		await waitFor(() => expect(screen.getByText("画像が見つかりません")).toBeInTheDocument());
		expectKnownClasses(missing.container);
		missing.unmount();

		const invalid = renderField({ value: {} });
		expectKnownClasses(invalid.container);
		invalid.unmount();

		route(PREVIEW_URL, () => apiError("INTERNAL_ERROR", 500));
		const failed = renderField({ value: SAVED_REF });
		await waitFor(() =>
			expect(screen.getByText("プレビューを読み込めませんでした")).toBeInTheDocument(),
		);
		expectKnownClasses(failed.container);
	});
});
