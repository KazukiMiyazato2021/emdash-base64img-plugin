// 管理画面の文言の仕組み(src/client/i18n.ts)、エラーコードの文言(src/client/error-messages.ts)、
// API クライアント(src/client/api.ts)のテスト。fetch はモックにする。
// 型のテスト(`@ts-expect-error` と `expectTypeOf`)は、`npm run build` の tsc で確かめる。

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
	deleteImagePermanently,
	errorCodeForStatus,
	fetchPreviews,
	fetchThumbnails,
	listImages,
	trashImage,
	uploadImage,
} from "../../src/client/api";
import {
	ERROR_MESSAGES,
	NOTICE_MESSAGES,
	UNKNOWN_ERROR_MESSAGES,
	getErrorCode,
	getErrorMessage,
	getNoticeMessage,
	useErrorMessage,
} from "../../src/client/error-messages";
import {
	LOCALES,
	defineMessages,
	getDocumentLocale,
	resolveLocale,
	subscribeDocumentLocale,
	useLocale,
	useMessages,
} from "../../src/client/i18n";
import { PREVIEW_MAX_IDS, THUMBNAILS_MAX_IDS } from "../../src/shared/constants";
import {
	Base64ImageError,
	CLIENT_ERROR_CODES,
	HOST_ERROR_CODES,
	NOTICE_CODES,
	SERVER_ERROR_CODES,
	isBase64ImageError,
	type KnownErrorCode,
	type NoticeCode,
} from "../../src/shared/errors";
import type { Base64ImageRef, UploadRequest } from "../../src/shared/types";

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

const IMAGE_ID = "01J8Z3K4M5N6P7Q8R9S0T1V2W3";
// スキーマは形だけを確かめるので、data URL の中身は本物の WebP でなくてよい。
const WEBP_DATA_URL = "data:image/webp;base64,UklGRhYAAABXRUJQ";
const PLUGIN_API = "/_emdash/api/plugins/base64-image";
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

const REF: Base64ImageRef = { v: 1, id: IMAGE_ID, locale: "ja", width: 1280, height: 853, alt: "" };

function uploadRequest(overrides: Partial<UploadRequest> = {}): UploadRequest {
	return {
		dataUrl: WEBP_DATA_URL,
		thumb: WEBP_DATA_URL,
		width: 1280,
		height: 853,
		quality: 0.77,
		filename: "IMG_0001.jpg",
		target: { collection: "posts", field: "cover", entryId: "01J8Z3K4M5N6P7Q8R9S0T1V2W4" },
		...overrides,
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function success(data: unknown): Response {
	return jsonResponse({ success: true, data });
}

/** EmDash の `apiError` の形(`references/emdash/packages/core/src/api/error.ts:31-43`) */
function apiError(code: string, status: number, message = "Something failed"): Response {
	return jsonResponse({ success: false, error: { code, message } }, status);
}

/** ブラウザが `redirect: "manual"` で返す応答(status 0。Response のコンストラクターでは作れない) */
function opaqueRedirect(): Response {
	return {
		type: "opaqueredirect",
		status: 0,
		ok: false,
		redirected: false,
		headers: new Headers(),
		text: () => Promise.resolve(""),
	} as unknown as Response;
}

/** MutationObserver の通知(マイクロタスク)を待つ */
function flushMutations(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function setLang(lang: string): Promise<void> {
	return act(async () => {
		document.documentElement.lang = lang;
		await flushMutations();
	});
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("reject されなかった");
}

/** reject された値が Base64ImageError であることを確かめて返す(コードは呼んだ側で確かめる) */
async function captureApiError(promise: Promise<unknown>): Promise<Base64ImageError> {
	const error = await captureError(promise);
	if (!isBase64ImageError(error)) throw new Error(`Base64ImageError ではない: ${String(error)}`);
	return error;
}

const fetchMock = vi.fn<typeof fetch>();

function sentRequest(index = -1): { url: string; init: RequestInit; headers: Headers } {
	const call = fetchMock.mock.calls.at(index);
	if (!call) throw new Error("fetch が呼ばれていない");
	const [input, init = {}] = call;
	return { url: String(input), init, headers: new Headers(init.headers) };
}

function sentIds(): string[][] {
	return fetchMock.mock.calls.map(
		([, init]) => (JSON.parse(String(init?.body)) as { ids: string[] }).ids,
	);
}

beforeEach(() => {
	// 前のテストの描画は tests/setup/dom.ts の cleanup で片付いている(購読も解除されている)。
	document.documentElement.removeAttribute("lang");
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 文言の仕組み(i18n.ts)
// ---------------------------------------------------------------------------

describe("resolveLocale", () => {
	it.each([
		["ja", "ja"],
		["ja-JP", "ja"],
		["JA", "ja"],
		[" ja ", "ja"],
		["ja_JP", "ja"],
		["en", "en"],
		["en-GB", "en"],
		["EN-us", "en"],
		// ja / en 以外は英語
		["fr", "en"],
		["zh-TW", "en"],
		// 主言語のサブタグで比べる(`ja` で始まるだけの言語は日本語ではない)
		["jv", "en"],
		["jav", "en"],
		["", "en"],
		[null, "en"],
		[undefined, "en"],
	])("%j → %s", (lang, expected) => {
		expect(resolveLocale(lang)).toBe(expected);
	});
});

describe("getDocumentLocale", () => {
	it("<html lang> から言語を決める", () => {
		expect(getDocumentLocale()).toBe("en");
		document.documentElement.lang = "ja-JP";
		expect(getDocumentLocale()).toBe("ja");
		document.documentElement.lang = "de";
		expect(getDocumentLocale()).toBe("en");
	});
});

describe("subscribeDocumentLocale", () => {
	it("lang 属性が変わると呼ばれ、ほかの属性の変化では呼ばれない。解除すると呼ばれない", async () => {
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribeDocumentLocale(listener);
		try {
			document.documentElement.setAttribute("dir", "rtl");
			await flushMutations();
			expect(listener).not.toHaveBeenCalled();

			document.documentElement.lang = "ja";
			await flushMutations();
			expect(listener).toHaveBeenCalledTimes(1);
		} finally {
			unsubscribe();
			document.documentElement.removeAttribute("dir");
		}
		document.documentElement.lang = "en";
		await flushMutations();
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("1 つを解除しても残りの購読には通知が届き、すべて解除したあとも購読し直せる", async () => {
		const first = vi.fn<() => void>();
		const second = vi.fn<() => void>();
		const unsubscribeFirst = subscribeDocumentLocale(first);
		const unsubscribeSecond = subscribeDocumentLocale(second);
		unsubscribeFirst();

		document.documentElement.lang = "ja";
		await flushMutations();
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);

		unsubscribeSecond();
		const third = vi.fn<() => void>();
		const unsubscribeThird = subscribeDocumentLocale(third);
		try {
			document.documentElement.lang = "en";
			await flushMutations();
			expect(third).toHaveBeenCalledTimes(1);
			expect(second).toHaveBeenCalledTimes(1);
		} finally {
			unsubscribeThird();
		}
	});

	it("同じ関数を 2 回購読しても、それぞれを別に解除できる", async () => {
		const listener = vi.fn<() => void>();
		const unsubscribeA = subscribeDocumentLocale(listener);
		const unsubscribeB = subscribeDocumentLocale(listener);
		try {
			document.documentElement.lang = "ja";
			await flushMutations();
			expect(listener).toHaveBeenCalledTimes(2);

			unsubscribeA();
			document.documentElement.lang = "en";
			await flushMutations();
			expect(listener).toHaveBeenCalledTimes(3);
		} finally {
			unsubscribeA();
			unsubscribeB();
		}
	});
});

describe("useLocale", () => {
	it("描画したときの <html lang> を返し、lang が変わると再描画する", async () => {
		document.documentElement.lang = "ja";
		const { result } = renderHook(() => useLocale());
		expect(result.current).toBe("ja");

		await setLang("en-GB");
		expect(result.current).toBe("en");

		await setLang("ja-JP");
		expect(result.current).toBe("ja");
	});

	it("言語が変わらない lang の書き換え(en → en-GB)では再描画しない", async () => {
		document.documentElement.lang = "en";
		let renders = 0;
		const { result } = renderHook(() => {
			renders += 1;
			return useLocale();
		});
		const rendersBefore = renders;

		await setLang("en-GB");
		expect(result.current).toBe("en");
		expect(renders).toBe(rendersBefore);
	});
});

const WIDGET_MESSAGES = defineMessages({
	ja: {
		select: "ファイルを選択",
		remaining: (count: number) => `あと ${count} 枚追加できます`,
	},
	en: {
		select: "Select a file",
		remaining: (count) => `You can add ${count} more`,
	},
});

describe("defineMessages / useMessages", () => {
	it("今の言語の辞書を返し、言語が変わると切り替わる", async () => {
		document.documentElement.lang = "ja";
		const { result } = renderHook(() => useMessages(WIDGET_MESSAGES));
		expect(result.current.select).toBe("ファイルを選択");
		expect(result.current.remaining(3)).toBe("あと 3 枚追加できます");

		await setLang("en");
		expect(result.current.select).toBe("Select a file");
		expect(result.current.remaining(3)).toBe("You can add 3 more");
	});

	it("辞書の形は ja から推論し、文字列リテラルは string に広げる(型のテスト)", () => {
		expectTypeOf(WIDGET_MESSAGES.ja.select).toEqualTypeOf<string>();
		expectTypeOf(WIDGET_MESSAGES.en.select).toEqualTypeOf<string>();
		expectTypeOf(WIDGET_MESSAGES.en.remaining).toEqualTypeOf<(count: number) => string>();
		expectTypeOf<keyof typeof WIDGET_MESSAGES>().toEqualTypeOf<"ja" | "en">();
	});

	it("辞書をそのまま返す", () => {
		const dictionary = { ja: { title: "画像" }, en: { title: "Image" } };
		expect(defineMessages(dictionary)).toBe(dictionary);
	});

	it("ja と en のキーや値の型が揃っていなければ型エラーになる(型のテスト)", () => {
		expectTypeOf(defineMessages).returns.toHaveProperty("ja");
		defineMessages({
			ja: { title: "画像", note: "注意" },
			// @ts-expect-error en にキー(note)が足りない
			en: { title: "Image" },
		});
		defineMessages({
			ja: { title: "画像" },
			// @ts-expect-error en に余分なキーがある
			en: { title: "Image", extra: "Extra" },
		});
		defineMessages({
			ja: { remaining: (count: number) => `あと ${count} 枚` },
			// @ts-expect-error 関数の引数の型が違う
			en: { remaining: (count: string) => `${count} more` },
		});
		defineMessages({
			ja: { remaining: (count: number) => `あと ${count} 枚` },
			// @ts-expect-error 関数の代わりに文字列
			en: { remaining: "more" },
		});
		defineMessages<{ title: string; note: string }>({
			// @ts-expect-error 型引数で明示した形に ja が足りない
			ja: { title: "画像" },
			en: { title: "Image", note: "Note" },
		});
		// @ts-expect-error 値は文字列か、文字列を返す関数
		defineMessages({ ja: { count: 1 }, en: { count: 1 } });
	});
});

// ---------------------------------------------------------------------------
// エラーコードの文言(error-messages.ts)
// ---------------------------------------------------------------------------

const ERROR_CODES: readonly KnownErrorCode[] = [
	...SERVER_ERROR_CODES,
	...CLIENT_ERROR_CODES,
	...HOST_ERROR_CODES,
];

describe("エラーコードの文言", () => {
	it("辞書のキーは、すべてのエラーコード(型のテスト)", () => {
		expectTypeOf<keyof (typeof ERROR_MESSAGES)["ja"]>().toEqualTypeOf<KnownErrorCode>();
		expectTypeOf<keyof (typeof NOTICE_MESSAGES)["en"]>().toEqualTypeOf<NoticeCode>();
	});

	it.each(LOCALES)("%s の辞書のキーは、T03 のエラーコードと過不足なく一致する", (locale) => {
		expect(Object.keys(ERROR_MESSAGES[locale]).toSorted()).toEqual([...ERROR_CODES].toSorted());
	});

	it.each(ERROR_CODES)("%s に ja / en の文言がある", (code) => {
		const ja = ERROR_MESSAGES.ja[code];
		const en = ERROR_MESSAGES.en[code];
		expect(ja).toMatch(JAPANESE);
		expect(en).not.toMatch(JAPANESE);
		expect(en.trim()).not.toBe("");
		expect([ja, en]).not.toContain(code);
	});

	it.each(LOCALES)("%s の注意の辞書のキーは、NOTICE_CODES と過不足なく一致する", (locale) => {
		expect(Object.keys(NOTICE_MESSAGES[locale]).toSorted()).toEqual([...NOTICE_CODES].toSorted());
	});

	it.each(NOTICE_CODES)("注意 %s に ja / en の文言がある", (code) => {
		expect(getNoticeMessage(code, "ja")).toMatch(JAPANESE);
		expect(getNoticeMessage(code, "en")).not.toMatch(JAPANESE);
		expect(getNoticeMessage(code, "en").trim()).not.toBe("");
	});

	it("HEIC の案内は、仕様書 6.5 のとおり「互換性優先」と JPEG への書き出しを伝える", () => {
		expect(ERROR_MESSAGES.ja.INPUT_HEIC_REJECTED).toContain(
			"iPhone のカメラ設定を「互換性優先」にするか、JPEG に書き出してください",
		);
		expect(ERROR_MESSAGES.en.INPUT_HEIC_REJECTED).toContain("Most Compatible");
		expect(ERROR_MESSAGES.en.INPUT_HEIC_REJECTED).toContain("JPEG");
	});

	it("INVALID_TARGET の文言は、フィールドの誤りと、エントリの言語がサイトに無いこと(T18)の両方を伝える", () => {
		expect(ERROR_MESSAGES.ja.INVALID_TARGET).toContain("このプラグインの画像フィールドではない");
		expect(ERROR_MESSAGES.ja.INVALID_TARGET).toContain(
			"エントリの言語がサイトに設定されていません",
		);
		expect(ERROR_MESSAGES.en.INVALID_TARGET).toContain("not an image field of this plugin");
		expect(ERROR_MESSAGES.en.INVALID_TARGET).toContain("locale is not configured for the site");
	});

	it("固定の上限を文言に差し込む", () => {
		expect(ERROR_MESSAGES.ja.INPUT_FILE_TOO_LARGE).toContain("上限 40MB");
		expect(ERROR_MESSAGES.en.INPUT_FILE_TOO_LARGE).toContain("maximum 40 MB");
		expect(ERROR_MESSAGES.ja.INPUT_TOO_MANY_PIXELS).toContain("上限 6,400 万画素");
		expect(ERROR_MESSAGES.en.INPUT_TOO_MANY_PIXELS).toContain("maximum 64 megapixels");
		expect(ERROR_MESSAGES.ja.ALT_TOO_LONG).toContain("1,000 文字以内");
		expect(ERROR_MESSAGES.en.ALT_TOO_LONG).toContain("1,000 characters");
	});
});

describe("getErrorCode / getErrorMessage", () => {
	it("Base64ImageError はコードの文言にする", () => {
		const error = new Base64ImageError("IMAGE_NOT_FOUND");
		expect(getErrorCode(error)).toBe("IMAGE_NOT_FOUND");
		expect(getErrorMessage(error, "ja")).toBe(ERROR_MESSAGES.ja.IMAGE_NOT_FOUND);
		expect(getErrorMessage(error, "en")).toBe(ERROR_MESSAGES.en.IMAGE_NOT_FOUND);
	});

	it("文言のあるコードを code に持つオブジェクト(EmDash の ApiResponseError など)も読む", () => {
		const error = Object.assign(new Error("Insufficient permissions"), {
			code: "FORBIDDEN",
			status: 403,
		});
		expect(getErrorCode(error)).toBe("FORBIDDEN");
		expect(getErrorMessage(error, "ja")).toBe(ERROR_MESSAGES.ja.FORBIDDEN);
	});

	it.each([
		["コードの無い Error", new Error("boom")],
		["知らないコード", { code: "SAVE_REJECTED" }],
		["文字列", "IMAGE_NOT_FOUND"],
		["null", null],
		["中断(AbortError)", new DOMException("aborted", "AbortError")],
	])("コードが分からなければ「予期しないエラー」: %s", (_label, error) => {
		expect(getErrorCode(error)).toBeNull();
		expect(getErrorMessage(error, "ja")).toBe(UNKNOWN_ERROR_MESSAGES.ja.unknown);
		expect(getErrorMessage(error, "en")).toBe(UNKNOWN_ERROR_MESSAGES.en.unknown);
	});

	it("useErrorMessage は今の言語の文言を返し、エラーが無ければ undefined", async () => {
		document.documentElement.lang = "ja";
		const { result, rerender } = renderHook(({ error }) => useErrorMessage(error), {
			initialProps: { error: null as unknown },
		});
		expect(result.current).toBeUndefined();

		rerender({ error: new Base64ImageError("NETWORK_ERROR") });
		expect(result.current).toBe(ERROR_MESSAGES.ja.NETWORK_ERROR);

		await setLang("en");
		expect(result.current).toBe(ERROR_MESSAGES.en.NETWORK_ERROR);
	});
});

// ---------------------------------------------------------------------------
// API クライアント(api.ts)
// ---------------------------------------------------------------------------

interface CallCase {
	name: string;
	call: () => Promise<unknown>;
	url: string;
	method: "POST" | "DELETE";
	body: unknown;
	data: unknown;
}

const CALLS: CallCase[] = [
	{
		name: "uploadImage",
		call: () => uploadImage(uploadRequest()),
		url: `${PLUGIN_API}/upload`,
		method: "POST",
		body: uploadRequest(),
		data: { ref: REF },
	},
	{
		name: "fetchPreviews",
		call: () => fetchPreviews([IMAGE_ID]),
		url: `${PLUGIN_API}/preview`,
		method: "POST",
		body: { ids: [IMAGE_ID] },
		data: { items: [{ id: IMAGE_ID, image: null }] },
	},
	{
		name: "fetchThumbnails",
		call: () => fetchThumbnails([IMAGE_ID]),
		url: `${PLUGIN_API}/thumbnails`,
		method: "POST",
		body: { ids: [IMAGE_ID] },
		data: { items: [{ id: IMAGE_ID, thumbnail: null }] },
	},
	{
		name: "listImages",
		call: () => listImages({ cursor: "next-page" }),
		url: `${PLUGIN_API}/images/list`,
		method: "POST",
		body: { cursor: "next-page" },
		data: { items: [] },
	},
	{
		name: "trashImage",
		call: () => trashImage(IMAGE_ID),
		url: `${PLUGIN_API}/images/trash`,
		method: "POST",
		body: { id: IMAGE_ID },
		data: { id: IMAGE_ID, trashed: true },
	},
	{
		name: "deleteImagePermanently",
		call: () => deleteImagePermanently(IMAGE_ID),
		url: `/_emdash/api/content/b64_images/${IMAGE_ID}/permanent`,
		method: "DELETE",
		body: undefined,
		data: { deleted: true, id: IMAGE_ID },
	},
];

describe("送り方(URL・メソッド・CSRF ヘッダー・cookie)", () => {
	it.each(CALLS)("$name", async ({ call, url, method, body, data }) => {
		fetchMock.mockResolvedValue(success(data));

		await expect(call()).resolves.toEqual(data);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const sent = sentRequest();
		expect(sent.url).toBe(url);
		expect(sent.init.method).toBe(method);
		expect(sent.headers.get("X-EmDash-Request")).toBe("1");
		expect(sent.init.credentials).toBe("same-origin");
		expect(sent.init.redirect).toBe("manual");
		// body があるときだけ JSON として送る(完全削除は body も Content-Type も付けない)。
		const sentBody = sent.init.body === undefined ? undefined : JSON.parse(String(sent.init.body));
		expect(sentBody).toEqual(body);
		expect(sent.headers.get("Content-Type")).toBe(body === undefined ? null : "application/json");
	});

	it("listImages は引数を省くと先頭のページを求める", async () => {
		fetchMock.mockResolvedValue(success({ items: [], nextCursor: "c2" }));
		await expect(listImages()).resolves.toEqual({ items: [], nextCursor: "c2" });
		expect(JSON.parse(String(sentRequest().init.body))).toEqual({});
	});
});

describe("成功の応答", () => {
	it("data を T03 のスキーマで確かめ、知らないキーは落とす", async () => {
		fetchMock.mockResolvedValue(success({ ref: REF, extra: "ignored" }));
		await expect(uploadImage(uploadRequest())).resolves.toEqual({ ref: REF });
	});

	it.each([
		["data の形が違う", () => success({ ref: { ...REF, width: 0 } })],
		["data が無い", () => jsonResponse({ success: true })],
		["success が無い", () => jsonResponse({ data: { ref: REF } })],
		[
			"成功のステータスなのにエラーの形",
			() => jsonResponse({ success: false, error: { code: "IMAGE_TOO_LARGE", message: "x" } }),
		],
		["JSON でない", () => new Response("<!doctype html><title>Login</title>", { status: 200 })],
		["body が空", () => new Response(null, { status: 200 })],
	])("形が合わなければ UNEXPECTED_RESPONSE: %s", async (_label, response) => {
		fetchMock.mockResolvedValue(response());
		const error = await captureApiError(uploadImage(uploadRequest()));
		expect(error.code).toBe("UNEXPECTED_RESPONSE");
		expect(error.details).toEqual({ status: 200 });
	});

	it("完全削除の data の形が違えば UNEXPECTED_RESPONSE", async () => {
		fetchMock.mockResolvedValue(success({ deleted: false, id: IMAGE_ID }));
		expect((await captureApiError(deleteImagePermanently(IMAGE_ID))).code).toBe(
			"UNEXPECTED_RESPONSE",
		);
	});
});

describe("エラーの応答(EmDash の { success: false, error: { code, message } })", () => {
	it("このプラグインのコードはそのまま使い、HTTP ステータスと元のコードを details に入れる", async () => {
		fetchMock.mockResolvedValue(apiError("IMAGE_TOO_LARGE", 400, "dataUrl exceeds 100000 bytes"));
		const error = await captureApiError(uploadImage(uploadRequest()));
		expect(error.code).toBe("IMAGE_TOO_LARGE");
		expect(error.message).toBe("dataUrl exceeds 100000 bytes");
		expect(error.details).toEqual({ status: 400, responseCode: "IMAGE_TOO_LARGE" });
	});

	it.each([
		["INVALID_TARGET", 400],
		["IMAGE_NOT_FOUND", 404],
		["UPLOAD_FAILED", 500],
		["VALIDATION_ERROR", 400],
		["CSRF_REJECTED", 403],
		["FORBIDDEN", 403],
		["INSUFFICIENT_SCOPE", 403],
		["NOT_FOUND", 404],
		["METHOD_NOT_ALLOWED", 405],
		["INVALID_PLUGIN_REQUEST", 413],
		["INTERNAL_ERROR", 500],
		["NOT_CONFIGURED", 500],
	] as const)("%s(HTTP %i)はそのコードにする", async (code, status) => {
		fetchMock.mockResolvedValue(apiError(code, status));
		expect((await captureApiError(uploadImage(uploadRequest()))).code).toBe(code);
	});

	it.each([
		[
			"プラグインのルート(未ログイン)",
			() => apiError("UNAUTHORIZED", 401, "Authentication required"),
		],
		["標準 API の middleware(未ログイン)", () => apiError("NOT_AUTHENTICATED", 401)],
		["標準 API の middleware(利用者が消えた)", () => apiError("NOT_FOUND", 401, "User not found")],
		["API トークンが無効", () => apiError("INVALID_TOKEN", 401)],
		["外部の認証(text/plain)", () => new Response("Authentication failed", { status: 401 })],
	])("401 は body に関係なく UNAUTHORIZED: %s", async (_label, response) => {
		fetchMock.mockResolvedValue(response());
		expect((await captureApiError(deleteImagePermanently(IMAGE_ID))).code).toBe("UNAUTHORIZED");
	});

	it.each([
		// 標準 API の middleware(無効にされた利用者)
		["ACCOUNT_DISABLED", 403, "FORBIDDEN"],
		// permission の宣言が不正なルート
		["INVALID_PLUGIN_ROUTE", 500, "INTERNAL_ERROR"],
		["RATE_LIMITED", 429, "UNEXPECTED_RESPONSE"],
		["SAVE_REJECTED", 422, "VALIDATION_ERROR"],
		// ブラウザ側のコードは、応答に入っていても使わない
		["NETWORK_ERROR", 400, "VALIDATION_ERROR"],
		["BROWSER_UNSUPPORTED", 500, "INTERNAL_ERROR"],
	] as const)(
		"知らないコード %s(HTTP %i)は HTTP ステータスから %s にする",
		async (responseCode, status, code) => {
			fetchMock.mockResolvedValue(apiError(responseCode, status));
			const error = await captureApiError(uploadImage(uploadRequest()));
			expect(error.code).toBe(code);
			expect(error.details).toEqual({ status, responseCode });
		},
	);

	it("標準 API の details 付きのエラーも読める", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{
					success: false,
					error: { code: "VALIDATION_ERROR", message: "Invalid", details: { issues: [] } },
				},
				400,
			),
		);
		expect((await captureApiError(trashImage(IMAGE_ID))).code).toBe("VALIDATION_ERROR");
	});
});

describe("HTTP ステータスだけが分かる応答", () => {
	it.each([
		[400, "VALIDATION_ERROR"],
		[401, "UNAUTHORIZED"],
		[403, "FORBIDDEN"],
		[404, "NOT_FOUND"],
		[405, "METHOD_NOT_ALLOWED"],
		[408, "UNEXPECTED_RESPONSE"],
		[409, "UNEXPECTED_RESPONSE"],
		[413, "INVALID_PLUGIN_REQUEST"],
		[415, "INVALID_PLUGIN_REQUEST"],
		[422, "VALIDATION_ERROR"],
		[429, "UNEXPECTED_RESPONSE"],
		[500, "INTERNAL_ERROR"],
		[502, "INTERNAL_ERROR"],
		[503, "INTERNAL_ERROR"],
		[504, "INTERNAL_ERROR"],
	] as const)("HTTP %i(HTML の body)→ %s", async (status, code) => {
		fetchMock.mockResolvedValue(
			new Response("<html><body>Error</body></html>", {
				status,
				headers: { "Content-Type": "text/html" },
			}),
		);
		const error = await captureApiError(uploadImage(uploadRequest()));
		expect(error.code).toBe(code);
		expect(error.details).toEqual({ status });
	});

	it("エラーの形でない JSON も、HTTP ステータスから決める", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: "Forbidden" }, 403));
		const error = await captureApiError(listImages());
		expect(error.code).toBe("FORBIDDEN");
		expect(error.details).toEqual({ status: 403 });
	});

	it("errorCodeForStatus は 5xx を INTERNAL_ERROR、範囲外を UNEXPECTED_RESPONSE にする", () => {
		expect(errorCodeForStatus(599)).toBe("INTERNAL_ERROR");
		expect(errorCodeForStatus(600)).toBe("UNEXPECTED_RESPONSE");
		expect(errorCodeForStatus(418)).toBe("UNEXPECTED_RESPONSE");
		expect(errorCodeForStatus(0)).toBe("UNEXPECTED_RESPONSE");
	});
});

describe("リダイレクト", () => {
	it("ブラウザの opaqueredirect(status 0)は UNAUTHORIZED", async () => {
		fetchMock.mockResolvedValue(opaqueRedirect());
		const error = await captureApiError(uploadImage(uploadRequest()));
		expect(error.code).toBe("UNAUTHORIZED");
		expect(error.details).toEqual({ status: 0 });
	});

	it("3xx をそのまま受け取ったときも UNAUTHORIZED", async () => {
		fetchMock.mockResolvedValue(
			new Response(null, { status: 302, headers: { Location: "/_emdash/admin/login" } }),
		);
		expect((await captureApiError(deleteImagePermanently(IMAGE_ID))).code).toBe("UNAUTHORIZED");
	});
});

describe("通信のエラー", () => {
	it("fetch が失敗したら NETWORK_ERROR(元のエラーを cause に持つ)", async () => {
		const failure = new TypeError("Failed to fetch");
		fetchMock.mockRejectedValue(failure);
		const error = await captureApiError(uploadImage(uploadRequest()));
		expect(error.code).toBe("NETWORK_ERROR");
		expect(error.cause).toBe(failure);
	});

	it("body の読み込みに失敗したら NETWORK_ERROR", async () => {
		const failure = new TypeError("terminated");
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(failure);
			},
		});
		fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
		const error = await captureApiError(fetchThumbnails([IMAGE_ID]));
		expect(error.code).toBe("NETWORK_ERROR");
		expect(error.cause).toBe(failure);
	});

	it("API のエラーを、今の言語の文言にできる", async () => {
		fetchMock.mockResolvedValue(apiError("FORBIDDEN", 403, "Insufficient permissions"));
		const error = await captureError(deleteImagePermanently(IMAGE_ID));
		expect(getErrorMessage(error, "ja")).toBe("この操作を行う権限がありません。");
		expect(getErrorMessage(error, "en")).toBe("You do not have permission to do this.");
	});
});

describe("キャンセル(AbortSignal)", () => {
	it("中断済みの signal なら、送らずに signal.reason で reject する", async () => {
		const controller = new AbortController();
		const reason = new Error("cancelled by user");
		controller.abort(reason);

		const calls = [
			() => uploadImage(uploadRequest(), { signal: controller.signal }),
			() => fetchPreviews([], { signal: controller.signal }),
			() => fetchThumbnails([IMAGE_ID], { signal: controller.signal }),
			() => listImages({}, { signal: controller.signal }),
			() => trashImage(IMAGE_ID, { signal: controller.signal }),
			() => deleteImagePermanently(IMAGE_ID, { signal: controller.signal }),
		];
		await Promise.all(calls.map((call) => expect(call()).rejects.toBe(reason)));
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("signal を fetch に渡し、応答を待つ間に中断されたら signal.reason で reject する", async () => {
		// fetch は中断されると AbortError などで reject する。どんなエラーでも signal.reason に置き換わることを確かめる。
		fetchMock.mockImplementation(
			(_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new TypeError("aborted")), {
						once: true,
					});
				}),
		);
		const controller = new AbortController();
		const promise = uploadImage(uploadRequest(), { signal: controller.signal });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(sentRequest().init.signal).toBe(controller.signal);

		controller.abort();
		const error = await captureError(promise);
		expect(error).toBe(controller.signal.reason);
		expect((error as DOMException).name).toBe("AbortError");
	});

	it("body を読む間に中断されたら signal.reason で reject する(NETWORK_ERROR にしない)", async () => {
		const reason = new Error("cancelled by user");
		fetchMock.mockImplementation(async (_input, init) => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('{"success":true,'));
					init?.signal?.addEventListener(
						"abort",
						() => controller.error(new TypeError("terminated")),
						{
							once: true,
						},
					);
				},
			});
			return new Response(body, { status: 200 });
		});
		const controller = new AbortController();
		const promise = fetchPreviews([IMAGE_ID], { signal: controller.signal });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

		controller.abort(reason);
		await expect(promise).rejects.toBe(reason);
	});

	it("body を読み終えた直後に中断されたときも signal.reason で reject する", async () => {
		const controller = new AbortController();
		const reason = new Error("cancelled by user");
		fetchMock.mockResolvedValue({
			type: "basic",
			status: 200,
			ok: true,
			text: () => {
				controller.abort(reason);
				return Promise.resolve(JSON.stringify({ success: true, data: { ref: REF } }));
			},
		} as unknown as Response);
		await expect(uploadImage(uploadRequest(), { signal: controller.signal })).rejects.toBe(reason);
	});
});

describe("送る前の入力の確認", () => {
	it.each([
		["寸法が 0", () => uploadImage(uploadRequest({ width: 0 }))],
		["data URL が ASCII でない", () => uploadImage(uploadRequest({ dataUrl: "data:画像" }))],
		["ID が不正(プレビュー)", () => fetchPreviews(["../etc"])],
		["ID が不正(ゴミ箱)", () => trashImage("a/b")],
		["カーソルが空", () => listImages({ cursor: "" })],
		["ID が不正(完全削除。パスを変えうる)", () => deleteImagePermanently("..")],
		["ID が空(完全削除)", () => deleteImagePermanently("")],
	])("T03 のスキーマに合わなければ、送らずに VALIDATION_ERROR: %s", async (_label, call) => {
		const error = await captureApiError(call());
		expect(error.code).toBe("VALIDATION_ERROR");
		expect(error.cause).toBeDefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("ID の分割", () => {
	/** 送られた ID のとおりに items を返す。前の塊ほど遅く返す(並べ替えを確かめるため) */
	function echoItems(item: (id: string) => unknown) {
		fetchMock.mockImplementation(async (_input, init) => {
			const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
			const index = fetchMock.mock.calls.length;
			await new Promise((resolve) => setTimeout(resolve, (5 - index) * 5));
			return success({ items: ids.map((id) => item(id)) });
		});
	}

	const ids = Array.from({ length: PREVIEW_MAX_IDS * 2 + 3 }, (_, i) => `img${i}`);

	it("プレビューは重複を除いて PREVIEW_MAX_IDS 件ずつ送り、items を要求の順につなげる", async () => {
		echoItems((id) => ({ id, image: null }));

		const result = await fetchPreviews([...ids, ids[0]!, ids[5]!]);

		const sent = sentIds();
		expect(sent).toHaveLength(Math.ceil(ids.length / PREVIEW_MAX_IDS));
		for (const chunk of sent) expect(chunk.length).toBeLessThanOrEqual(PREVIEW_MAX_IDS);
		expect(sent.flat()).toEqual(ids);
		expect(result.items.map((item) => item.id)).toEqual(ids);
	});

	it("サムネイルは THUMBNAILS_MAX_IDS 件ずつ送る", async () => {
		echoItems((id) => ({ id, thumbnail: null }));
		const many = Array.from({ length: THUMBNAILS_MAX_IDS + 1 }, (_, i) => `row${i}`);

		const result = await fetchThumbnails(many);

		expect(sentIds().map((chunk) => chunk.length)).toEqual([THUMBNAILS_MAX_IDS, 1]);
		expect(result.items.map((item) => item.id)).toEqual(many);
	});

	it("ID が空なら送らない", async () => {
		await expect(fetchPreviews([])).resolves.toEqual({ items: [] });
		await expect(fetchThumbnails([])).resolves.toEqual({ items: [] });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("どれか 1 つが失敗したら、そのエラーで reject する", async () => {
		fetchMock.mockResolvedValueOnce(success({ items: [] }));
		fetchMock.mockResolvedValueOnce(apiError("INTERNAL_ERROR", 500));
		fetchMock.mockResolvedValue(success({ items: [] }));
		expect((await captureApiError(fetchPreviews(ids))).code).toBe("INTERNAL_ERROR");
	});
});
